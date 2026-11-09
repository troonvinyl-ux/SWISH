// Mocked service/contract regressions. No real AI, photos, seller calls or user records.
jest.mock('@/template', () => ({ getSupabaseClient: jest.fn() }));
jest.mock('../listingEditorService', () => ({ loadListingEditor: jest.fn() }));
jest.mock('../aiIdentificationService', () => ({ identifyItemWithAI: jest.fn(), captureFromCamera: jest.fn(), pickFromLibrary: jest.fn() }));
jest.mock('../photoPersistenceService', () => ({ persistCapturedItemPhotos: jest.fn() }));
jest.mock('../existingImageStudioService', () => ({ existingOriginalPhotos: jest.fn(item => item.media) }));
jest.mock('../itemService', () => ({ mapItem: jest.fn(row => ({ id: row.id, tenantId: row.tenant_id, specialistId: row.specialist_id, canonicalTitle: row.canonical_title, condition: row.condition, status: row.status, soldAt: row.sold_at, updatedAt: row.updated_at, attributes: row.attributes, media: row.media, customNotes: 'Internal note', valuationMid: 46.45 })) }));
import fs from 'node:fs';
import { getSupabaseClient } from '@/template';
import { loadListingEditor } from '../listingEditorService';
import { identifyItemWithAI } from '../aiIdentificationService';
import { persistCapturedItemPhotos } from '../photoPersistenceService';
import { analyseDraftEvidence, readDraftEvidence, saveDraftEvidence } from '../draftReidentificationService';
import { isPrivateIdentificationDraft, draftClueContext } from '@/shared/draftReidentification';
const scope = { tenantId: 'tenant', listingId: 'draft', nicheId: 'antiques', userId: 'user' };
const original = 'https://photos.test/original.jpg';
let row: any, siblings: any[], rpc: jest.Mock;
beforeEach(() => {
  jest.clearAllMocks(); siblings = [];
  row = { id: 'draft', status: 'draft', title: 'Existing seller title', description: 'Edited seller copy', price: 46.45, updated_at: 'listing-v1', items: { id: 'item', tenant_id: 'tenant', specialist_id: 'antiques', status: 'identified', canonical_title: 'Ceramic fragment', condition: 'Used', updated_at: 'item-v1', media: [original], attributes: {} } };
  (loadListingEditor as jest.Mock).mockImplementation(async () => ({ data: structuredClone(row), error: null }));
  const query: any = { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), then: (resolve: any) => Promise.resolve({ data: siblings, error: null }).then(resolve) };
  rpc = jest.fn(async (_name, args) => {
    row.items.attributes._draft_reidentification = { clues: args.p_clues, receipt: args.p_receipt };
    if (args.p_proposal) row.items.canonical_title = args.p_proposal.canonicalTitle;
    if (args.p_draft_title) row.title = args.p_draft_title;
    row.updated_at = 'listing-v2'; row.items.updated_at = 'item-v2';
    return { data: 'draft', error: null };
  });
  (getSupabaseClient as jest.Mock).mockReturnValue({ from: jest.fn(() => query), rpc, auth: { getSession: jest.fn(async () => ({ data: { session: { user: { id: 'user' } } }, error: null })) } });
  (identifyItemWithAI as jest.Mock).mockResolvedValue({ result: { canonicalTitle: 'Possible painted ceramic fragment' }, error: null });
});
test.each([
  {status:'active'}, {status:'live'}, {status:'sold'}, {status:'ended'}, {status:'publishing'},
  {status:'draft',external_listing_id:'123'}, {status:'draft',published_at:'today'},
  {status:'draft',publish_claim_id:'claim'}, {status:'draft',ended_at:'today'},
])('publication/history cannot use draft re-identification: %j', async state => {
  expect(isPrivateIdentificationDraft(state)).toBe(false);
  Object.assign(row, state);
  await expect(readDraftEvidence(scope)).rejects.toThrow(/unpublished draft/);
  expect(identifyItemWithAI).not.toHaveBeenCalled(); expect(rpc).not.toHaveBeenCalled();
});
test('pending unpublished draft is allowed; published sibling is blocked', async () => {
  row.status = 'pending'; expect(isPrivateIdentificationDraft(row)).toBe(true);
  siblings = [{status:'active',external_listing_id:'seller-id'}];
  await expect(readDraftEvidence(scope)).rejects.toThrow(/linked listing/);
});
test('new clues and selected originals reach existing AI as unverified hypotheses without any save', async () => {
  const snapshot = await readDraftEvidence(scope);
  await analyseDraftEvidence(scope, snapshot, [], [original], 'May be Apulian; underside mark looks modern', false, () => true);
  expect(identifyItemWithAI).toHaveBeenCalledWith([], 'antiques', undefined, expect.objectContaining({ customNotes: expect.stringContaining('NOT verified facts') }), expect.objectContaining({ existingImageUrls: [original], presentationInParallel: true, tenantId: 'tenant' }));
  expect((identifyItemWithAI as jest.Mock).mock.calls[0][3].customNotes).toContain('underside mark looks modern');
  expect(rpc).not.toHaveBeenCalled(); expect(persistCapturedItemPhotos).not.toHaveBeenCalled();
  expect(draftClueContext('Suspected Roman')).toContain('do not assume authenticity');
});
test('more than eight photos and foreign evidence never reach AI', async () => {
  const snapshot = await readDraftEvidence(scope);
  await expect(analyseDraftEvidence(scope,snapshot,[],Array(9).fill(original),'',true,()=>true)).rejects.toThrow(/eight/);
  await expect(analyseDraftEvidence(scope,snapshot,[],['https://foreign.test/a.jpg'],'',false,()=>true)).rejects.toThrow(/eight/);
  expect(identifyItemWithAI).not.toHaveBeenCalled();
});
test('reviewed apply uses exact versions, optionally preserves draft title, never rewrites seller price/description', async () => {
  const snapshot = await readDraftEvidence(scope);
  const proposal: any = { canonicalTitle:'Possible painted ceramic', specialistId:'antiques',confidence:0.54,evidenceSupporting:['Painted decoration'],evidenceContradictory:['Date unknown'],missingInformation:['Maker mark'],warnings:['Unverified age'],attributesConfirmed:{},attributesInferred:{} };
  const item = await saveDraftEvidence(scope,snapshot,[],'Seller clue',proposal,null,()=>true);
  expect(item.canonicalTitle).toBe(proposal.canonicalTitle);
  expect(rpc).toHaveBeenCalledWith('swish_apply_draft_reidentification',expect.objectContaining({p_item_version:'item-v1',p_listing_version:'listing-v1',p_draft_title:null,p_clues:'Seller clue'}));
  expect(row.price).toBe(46.45); expect(row.description).toBe('Edited seller copy'); expect(row.title).toBe('Existing seller title');
});
test('evidence-only save does not apply AI; oversized title does not truncate silently', async () => {
  const snapshot = await readDraftEvidence(scope);
  await expect(saveDraftEvidence(scope,snapshot,[],'hint',null,'x'.repeat(81),()=>true)).rejects.toThrow(/1–80/);
  expect(rpc).not.toHaveBeenCalled();
  await saveDraftEvidence(scope,snapshot,[],'hint',null,null,()=>true);
  expect(rpc).toHaveBeenCalledWith('swish_apply_draft_reidentification',expect.objectContaining({p_proposal:null,p_draft_title:null}));
  expect(row.items.canonical_title).toBe('Ceramic fragment');
});
test('human edits and changed sessions stop any evidence write', async () => {
  const snapshot = await readDraftEvidence(scope); row.items.updated_at='edited'; row.items.condition='Restored';
  await expect(saveDraftEvidence(scope,snapshot,[],'hint',null,null,()=>true)).rejects.toThrow(/changed/);
  await expect(saveDraftEvidence(scope,snapshot,[],'hint',null,null,()=>false)).rejects.toThrow(/Workspace changed/);
  expect(rpc).not.toHaveBeenCalled(); expect(persistCapturedItemPhotos).not.toHaveBeenCalled();
});
test('partial photo save cannot apply identification; photo-only retry uses same item and refreshed version', async () => {
  const snapshot = await readDraftEvidence(scope), image: any={uri:'file://detail.jpg',slotId:'reid_detail',slotLabel:'Detail'};
  (persistCapturedItemPhotos as jest.Mock).mockImplementation(async()=>{
    row.items.updated_at='photos-v2'; row.items.media.push('https://photos.test/detail.jpg'); row.items.attributes._photo_assets=[];
    return {complete:false,urls:[],errors:['upload failed']};
  });
  await expect(saveDraftEvidence(scope,snapshot,[image],'hint',null,null,()=>true)).rejects.toThrow(/upload failed/);
  expect(rpc).not.toHaveBeenCalled();
  (persistCapturedItemPhotos as jest.Mock).mockResolvedValue({complete:true,urls:['https://photos.test/detail.jpg'],errors:[]});
  await saveDraftEvidence(scope,snapshot,[image],'hint',null,null,()=>true);
  expect(persistCapturedItemPhotos).toHaveBeenLastCalledWith('tenant','item',[image]);
  expect(rpc).toHaveBeenCalledWith('swish_apply_draft_reidentification',expect.objectContaining({p_item_version:'photos-v2'}));
});
test('server denial/readback failure is not success or automatic retry', async () => {
  const snapshot=await readDraftEvidence(scope);
  rpc.mockResolvedValueOnce({data:null,error:{message:'Draft changed during review'}});
  await expect(saveDraftEvidence(scope,snapshot,[],'hint',null,null,()=>true)).rejects.toThrow(/changed/);
  expect(rpc).toHaveBeenCalledTimes(1);
  rpc.mockResolvedValueOnce({data:'draft',error:null});
  await expect(saveDraftEvidence(scope,snapshot,[],'hint',null,null,()=>true)).rejects.toThrow(/readback/);
});
test('source enforces draft locks/RLS, preserves seller fields and refreshes shared inventory', () => {
  const sql=fs.readFileSync('supabase/migrations/20261123_draft_reidentification.sql','utf8');
  for(const required of ['security invoker','swish_current_module','swish_can_access_niche','for update','l.publish_claim_id','x.publish_claim_id','p_item_version','p_listing_version','from public,anon'])expect(sql).toContain(required);
  expect(sql).not.toContain('security definer'); expect(sql).not.toMatch(/valuation_mid\s*=/); expect(sql).not.toMatch(/description\s*=/); expect(sql).not.toMatch(/price\s*=/); expect(sql).not.toMatch(/insert into public\.(items|listings)/);
  const hook=fs.readFileSync('hooks/useDraftReidentification.ts','utf8'); expect(hook).toContain('app.triggerInventoryReload()');expect(hook).toContain('app.moduleEpoch');expect(hook).toContain('setResult(null)');
  const screen=fs.readFileSync('app/ebay-listing-editor.tsx','utf8');expect(screen).toContain('privateDraft');expect(screen).toContain('Save & continue');expect(screen).toContain('Re-identify · add photos & clues');
});
