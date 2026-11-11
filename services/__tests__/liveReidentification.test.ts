// Mocked service and source contracts, not installed-device or real seller acceptance.
jest.mock('@/template', () => ({ getSupabaseClient: jest.fn() }));
jest.mock('../listingEditorService', () => ({ loadListingEditor: jest.fn() }));
jest.mock('../aiIdentificationService', () => ({ identifyItemWithAI: jest.fn(), captureFromCamera: jest.fn(), pickFromLibrary: jest.fn() }));
jest.mock('../photoPersistenceService', () => ({ persistCapturedItemPhotos: jest.fn() }));
jest.mock('../existingImageStudioService', () => ({ existingOriginalPhotos: jest.fn(item => item.media) }));
jest.mock('../itemService', () => ({ mapItem: jest.fn(row => ({ id: row.id, tenantId: row.tenant_id, specialistId: row.specialist_id, canonicalTitle: row.canonical_title, status: row.status, soldAt: row.sold_at, updatedAt: row.updated_at, attributes: row.attributes, media: row.media, condition: row.condition, customNotes: 'Private inventory note' })) }));
import fs from 'node:fs';
import { getSupabaseClient } from '@/template';
import { loadListingEditor } from '../listingEditorService';
import { identifyItemWithAI } from '../aiIdentificationService';
import { persistCapturedItemPhotos } from '../photoPersistenceService';
import { readDraftEvidence, analyseDraftEvidence, saveDraftEvidence } from '../draftReidentificationService';
import { isLiveIdentificationListing } from '@/shared/draftReidentification';
const scope = { tenantId: 'tenant', listingId: 'listing', nicheId: 'coins', userId: 'user', mode: 'live' as const };
const original = 'https://photos.test/coin.jpg';
const proposal: any = { specialistId: 'coins', canonicalTitle: 'Possible commemorative token', confidence: 0.72, identificationState: 'candidate', objectType: 'token', evidenceSupporting: ['Inscription'], evidenceContradictory: [], missingInformation: ['Reverse inscription'], warnings: ['Unverified date'], attributesConfirmed: {}, attributesInferred: {} };
let row: any, rpc: jest.Mock, seller: jest.Mock, session: jest.Mock;
beforeEach(() => {
  jest.clearAllMocks();
  row = { id: 'listing', status: 'active', marketplace_id: 'ebay', external_listing_id: '123456789', published_at: 'published', updated_at: 'listing-v1', title: 'Existing seller title', description: 'Edited seller description', price: 60, category_id: 'category', items: { id: 'item', tenant_id: 'tenant', specialist_id: 'coins', status: 'listed', updated_at: 'item-v1', canonical_title: 'Old coin ID', condition: 'Used', media: [original], attributes: { ebay_listing_media: [original], recalled: true } } };
  (loadListingEditor as jest.Mock).mockImplementation(async () => ({ data: structuredClone(row), error: null }));
  rpc = jest.fn(async (_name, args) => {
    row.items.attributes._live_reidentification = { clues: args.p_clues, receipt: args.p_receipt, reviewedTitle: args.p_reviewed_title, listingId: 'listing', externalListingId: '123456789' };
    if (args.p_proposal) row.items.canonical_title = args.p_proposal.canonicalTitle;
    row.items.updated_at = 'item-v2';
    return { data: 'listing', error: null };
  });
  seller = jest.fn();
  session = jest.fn(async () => ({ data: { session: { user: { id: 'user' } } }, error: null }));
  (getSupabaseClient as jest.Mock).mockReturnValue({ rpc, functions: { invoke: seller }, auth: { getSession: session } });
  (identifyItemWithAI as jest.Mock).mockResolvedValue({ result: proposal, error: null });
});
test('active eBay research is distinct from draft access', async () => {
  expect(isLiveIdentificationListing(row)).toBe(true);
  expect((await readDraftEvidence(scope)).mode).toBe('live');
  await expect(readDraftEvidence({ ...scope, mode: 'draft' })).rejects.toThrow(/unpublished draft/);
});
test.each([{ status: 'draft' }, { status: 'ended' }, { status: 'sold' }, { status: 'publishing' }, { external_listing_id: '' }, { ended_at: 'ended' }, { publish_claim_id: 'claim' }, { marketplace_id: 'other' }])('rejects unsafe live state %j before AI or writes', async change => {
  Object.assign(row, change);
  await expect(readDraftEvidence(scope)).rejects.toThrow(/active.*linked/);
  expect(rpc).not.toHaveBeenCalled(); expect(identifyItemWithAI).not.toHaveBeenCalled(); expect(seller).not.toHaveBeenCalled();
});
test.each([{ sold_at: 'sold' }, { status: 'archived' }, { tenant_id: 'other' }, { specialist_id: 'antiques' }])('sold or foreign items are excluded %j', async change => {
  Object.assign(row.items, change); await expect(readDraftEvidence(scope)).rejects.toThrow(/sold|workspace/);
});
test('photos and hints reach the existing specialist as unverified evidence only', async () => {
  const snapshot = await readDraftEvidence(scope);
  await analyseDraftEvidence(scope, snapshot, [], [original], 'May be a token; lettering looks different', false, () => true);
  expect(identifyItemWithAI).toHaveBeenCalledWith([], 'coins', undefined, expect.objectContaining({ customNotes: expect.stringContaining('NOT verified facts') }), expect.objectContaining({ tenantId: 'tenant', existingImageUrls: [original] }));
  expect(rpc).not.toHaveBeenCalled(); expect(seller).not.toHaveBeenCalled();
});
test('reviewed live save preserves seller copy, price, category, photo selection and external ID', async () => {
  const snapshot = await readDraftEvidence(scope), before = structuredClone(row);
  const saved = await saveDraftEvidence(scope, snapshot, [], 'Observed lettering', proposal, 'Reviewed token title', () => true);
  expect(saved.canonicalTitle).toBe(proposal.canonicalTitle);
  expect(rpc).toHaveBeenCalledWith('swish_apply_live_reidentification', expect.objectContaining({ p_item_version: 'item-v1', p_listing_version: 'listing-v1', p_reviewed_title: 'Reviewed token title', p_receipt: expect.stringMatching(/^live-reid-/) }));
  expect(rpc.mock.calls[0][1]).not.toHaveProperty('p_draft_title');
  for (const key of ['title','description','price','category_id','status','external_listing_id','updated_at']) expect(row[key]).toEqual(before[key]);
  expect(row.items.attributes.ebay_listing_media).toEqual([original]); expect(row.items.attributes.recalled).toBe(true);
  expect(seller).not.toHaveBeenCalled();
});
test('evidence-only save and session changes cannot revise or apply AI', async () => {
  const snapshot = await readDraftEvidence(scope);
  await saveDraftEvidence(scope, snapshot, [], 'New clue', null, null, () => true);
  expect(row.items.canonical_title).toBe('Old coin ID'); expect(seller).not.toHaveBeenCalled();
  rpc.mockClear(); session.mockResolvedValueOnce({ data: { session: { user: { id: 'different' } } }, error: null });
  await expect(saveDraftEvidence(scope, snapshot, [], '', proposal, null, () => true)).rejects.toThrow(/signed-in account changed/);
  expect(rpc).not.toHaveBeenCalled();
});
test('changed listing or item versions stop before photo or identification writes', async () => {
  const snapshot = await readDraftEvidence(scope); row.updated_at = 'other-version';
  await expect(saveDraftEvidence(scope, snapshot, [{ uri: 'file://detail' } as any], 'hint', proposal, null, () => true)).rejects.toThrow(/changed/);
  expect(persistCapturedItemPhotos).not.toHaveBeenCalled(); expect(rpc).not.toHaveBeenCalled();
});
test('added photos stay attached to the same item; partial saves cannot apply identification', async () => {
  const snapshot = await readDraftEvidence(scope), image: any = { uri: 'file://detail.jpg', slotId: 'detail', slotLabel: 'Detail' };
  (persistCapturedItemPhotos as jest.Mock).mockResolvedValueOnce({ complete: false, urls: [], errors: ['Upload failed'] });
  await expect(saveDraftEvidence(scope, snapshot, [image], 'hint', proposal, null, () => true)).rejects.toThrow(/Upload failed/); expect(rpc).not.toHaveBeenCalled();
  (persistCapturedItemPhotos as jest.Mock).mockImplementationOnce(async () => { row.items.media.push('https://photos.test/detail.jpg'); row.items.attributes._photo_assets = []; row.items.updated_at = 'photos-v2'; return { complete: true, urls: ['https://photos.test/detail.jpg'], errors: [] }; });
  await saveDraftEvidence(scope, snapshot, [image], 'hint', proposal, null, () => true);
  expect(persistCapturedItemPhotos).toHaveBeenLastCalledWith('tenant', 'item', [image]);
  expect(rpc).toHaveBeenCalledWith('swish_apply_live_reidentification', expect.objectContaining({ p_item_version: 'photos-v2' })); expect(seller).not.toHaveBeenCalled();
});
test('denied saves and unmatched readback are never reported as success or retried automatically', async () => {
  const snapshot = await readDraftEvidence(scope);
  rpc.mockResolvedValueOnce({ data: null, error: { message: 'Item changed' } });
  await expect(saveDraftEvidence(scope, snapshot, [], '', proposal, null, () => true)).rejects.toThrow(/changed/);
  rpc.mockResolvedValueOnce({ data: 'listing', error: null });
  await expect(saveDraftEvidence(scope, snapshot, [], '', proposal, null, () => true)).rejects.toThrow(/readback/); expect(rpc).toHaveBeenCalledTimes(2);
});
test('invoker schema preserves identity and seller fields; UI stages corrections then uses verified revision', () => {
  const sql = fs.readFileSync('supabase/migrations/20261124_live_reidentification.sql', 'utf8');
  for (const word of ['security invoker','swish_current_module','swish_can_access_niche','for update','p_item_version','p_listing_version','l.publish_claim_id','i.sold_at','unnest(coalesce(i.warnings','from public,anon']) expect(sql).toContain(word);
  expect(sql).not.toMatch(/update public\.listings|insert into public\.(items|listings)|valuation_mid\s*=|price\s*=|status\s*=/);
  const editor = fs.readFileSync('app/ebay-listing-editor.tsx', 'utf8'), actions = fs.readFileSync('components/feature/ListingReidentificationActions.tsx', 'utf8');
  expect(editor).toContain("mode={liveReid?'live':'draft'}"); expect(editor).toContain("editor.update('title'"); expect(editor).toContain('editor.revise(skuOnly)');
  expect(actions).toContain('Use reviewed title'); expect(actions).toContain('evidence?.externalListingId === externalListingId');
  expect(fs.readFileSync('hooks/useListingEditor.ts','utf8')).toContain('await reviseSavedListing');
});
