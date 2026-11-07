// Mocked regressions only; no real marketplace writes or installed-device tests.
jest.mock('@/template', () => ({ getSupabaseClient: jest.fn() }));
jest.mock('@/services/businessConfigService', () => ({ getBusinessConfig: jest.fn() }));
jest.mock('@/services/verificationService', () => ({ verifyListing: jest.fn() }));
jest.mock('@/services/listingEditorService', () => ({ checkAntiqueListing: jest.fn() }));
jest.mock('@/shared/specialistIntelligence', () => ({ evaluateSpecialistSafety: () => ({ blocked: false, reasons: [] }) }));
import fs from 'node:fs';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { getSupabaseClient } from '@/template';
import { verifyListing } from '@/services/verificationService';
import { checkAntiqueListing } from '@/services/listingEditorService';
import { mapListingPublication, readListingPublication, reconcileListingPublication } from '../listingPublicationService';
import { submitListingToMarketplace } from '../listingService';
import { NICHE_MODULES, PRODUCTION_NICHE_IDS } from '@/constants/niches';
const externalId = '800882306822';
const draft: any = { id: 'draft', item_id: 'item', status: 'draft', external_listing_id: null, publish_claim_id: null, category_id: '176984', items: { tenant_id: 'tenant', specialist_id: 'vinyl_records', status: 'review_required', attributes: { ebay_category_id: '176984', ebay_category_name: 'CDs' } } };
const live = (itemStatus = 'listed') => ({ ...draft, status: 'active', external_listing_id: externalId, items: { ...draft.items, status: itemStatus } });
function setup(rows: any[] = [live()], result: any = { data: null, error: null }) {
  const queries: any[] = [];
  const from = jest.fn(() => {
    const q: any = {};
    ['select', 'eq'].forEach(method => { q[method] = jest.fn(() => q); });
    const value = rows.shift();
    q.maybeSingle = jest.fn().mockResolvedValue(value?.__error ? { data: null, error: { message: value.__error } } : { data: value, error: null });
    queries.push(q); return q;
  });
  const invoke = jest.fn().mockResolvedValue(result);
  (getSupabaseClient as jest.Mock).mockReturnValue({ from, functions: { invoke } });
  (verifyListing as jest.Mock).mockResolvedValue({ verification: { overallPassed: true, warnings: [], failureReasons: [] }, error: null });
  (checkAntiqueListing as jest.Mock).mockResolvedValue({ ready: true, error: null });
  return { from, invoke, queries };
}
function submissionSetup(result: any, readback = live(), secondReadback = readback) {
  return setup([draft, draft, { selected_fulfillment_policy_id: 'shipping', selected_return_policy_id: 'returns' }, readback, secondReadback], result);
}
beforeEach(() => jest.clearAllMocks());
test('saved eBay publication and lagging inventory are distinct states', () => {
  const state = mapListingPublication(live('review_required'));
  expect(state.recorded).toBe(true); expect(state.live).toBe(true); expect(state.reconciled).toBe(false);
});
test.each(PRODUCTION_NICHE_IDS)('%s uses the same publication evidence contract', niche => {
  const state = mapListingPublication({ ...live(), items: { ...live().items, specialist_id: NICHE_MODULES[niche].defaultSpecialist } });
  expect(state.nicheId).toBe(niche); expect(state.reconciled).toBe(true);
});
test('saved identities are read in the tenant and marketplace boundary', async () => {
  const { queries } = setup();
  expect((await readListingPublication('tenant', 'draft')).error).toBeNull();
  expect(queries[0].eq).toHaveBeenCalledWith('tenant_id', 'tenant');
  expect(queries[0].eq).toHaveBeenCalledWith('marketplace_id', 'ebay');
});
test('mismatched tenant records cannot be used for status recovery', async () => {
  const { invoke } = setup([{ ...live(), items: { ...draft.items, tenant_id: 'other' } }]);
  expect((await reconcileListingPublication('tenant', 'draft', 'tunes_flip')).error).toBeTruthy(); expect(invoke).not.toHaveBeenCalled();
});
test('an already-active listing never reaches verification or another publish', async () => {
  const { invoke } = setup([live('review_required')]);
  const result = await submitListingToMarketplace('tenant', 'draft');
  expect(result).toMatchObject({ success: true, accepted: true, reconciliationPending: true, externalListingId: externalId });
  expect(invoke).not.toHaveBeenCalled(); expect(verifyListing).not.toHaveBeenCalled();
});
test('an ended existing listing cannot be submitted again as a draft', async () => {
  const { invoke } = setup([{ ...live('identified'), status: 'ended', ended_at: '2026-11-05' }]);
  const result = await submitListingToMarketplace('tenant', 'draft');
  expect(result.success).toBe(false); expect(result.accepted).toBe(true); expect(invoke).not.toHaveBeenCalled();
});
test('a pending claim blocks publishing rather than inviting a retry', async () => {
  const { invoke } = setup([{ ...draft, publish_claim_id: 'claim' }]);
  expect((await submitListingToMarketplace('tenant', 'draft')).publicationUnconfirmed).toBe(true); expect(invoke).not.toHaveBeenCalled();
});
test('provider success remains success when item transition is lagging', async () => {
  const { invoke } = submissionSetup({ data: { success: true, externalListingId: externalId }, error: null }, live('review_required'));
  const result = await submitListingToMarketplace('tenant', 'draft');
  expect(result).toMatchObject({ success: true, accepted: true, reconciliationPending: true, externalListingId: externalId });
  expect(result.error).toBeUndefined(); expect(invoke).toHaveBeenCalledTimes(1);
});
test('temporary readback errors never undo known eBay acceptance', async () => {
  submissionSetup({ data: { success: true, externalListingId: externalId }, error: null }, { __error: 'read unavailable' });
  expect(await submitListingToMarketplace('tenant', 'draft')).toMatchObject({ success: true, accepted: true, reconciliationPending: true });
});
test('bounded read retry clears pending once linked inventory catches up', async () => {
  submissionSetup({ data: { success: true, externalListingId: externalId }, error: null }, live('review_required'), live());
  expect(await submitListingToMarketplace('tenant', 'draft')).toMatchObject({ success: true, reconciliationPending: false });
});
test('a mismatched saved ID does not pass reconciliation', async () => {
  submissionSetup({ data: { success: true, externalListingId: externalId }, error: null }, { ...live(), external_listing_id: '123' });
  expect(await submitListingToMarketplace('tenant', 'draft')).toMatchObject({ success: true, reconciliationPending: true, externalListingId: externalId });
});
test('success without a provider ID stays unconfirmed, not ready to republish', async () => {
  submissionSetup({ data: { success: true }, error: null }, draft);
  expect(await submitListingToMarketplace('tenant', 'draft')).toMatchObject({ success: false, publicationUnconfirmed: true });
});
test('concurrent callers share a single publish request', async () => {
  const { invoke } = submissionSetup({ data: { success: true, externalListingId: externalId }, error: null });
  const first = submitListingToMarketplace('tenant', 'draft'); const second = submitListingToMarketplace('tenant', 'draft');
  expect(first).toBe(second); await Promise.all([first, second]); expect(invoke).toHaveBeenCalledTimes(1);
});
test('parallel connector read failure blocks publication without claiming missing consent', async () => {
  const { invoke } = setup([draft, draft, { __error: 'Connection pool unavailable' }]);
  const result = await submitListingToMarketplace('tenant', 'draft');
  expect(result.success).toBe(false);expect(result.error).toContain('policies could not be read');
  expect(invoke).not.toHaveBeenCalled();
});
test('publication has no cosmetic wait and keeps every existing gate', () => {
  const source = fs.readFileSync('services/listingService.ts', 'utf8');
  expect(source).toContain('const [listingRead, connectorRead] = await Promise.all');
  expect(source).not.toContain('brief pause so UI registers');
  for(const gate of ['claimPending','verifyListing','checkAntiqueListing','evaluateSpecialistSafety','selected_fulfillment_policy_id','selected_return_policy_id'])expect(source).toContain(gate);
});
test('explicit eBay rejection remains a genuine failure', async () => {
  submissionSetup({ data: { success: false, error: 'Invalid price' }, error: null });
  expect(await submitListingToMarketplace('tenant', 'draft')).toMatchObject({ success: false, error: 'Invalid price' });
});
test('network failure after dispatch resolves saved acceptance without republishing', async () => {
  const { invoke } = submissionSetup(null, live()); invoke.mockRejectedValueOnce(new Error('Network timeout'));
  expect(await submitListingToMarketplace('tenant', 'draft')).toMatchObject({ success: true, accepted: true }); expect(invoke).toHaveBeenCalledTimes(1);
});
test('timeout without evidence disables further submission', async () => {
  const { invoke } = submissionSetup(null, draft); invoke.mockRejectedValueOnce(new Error('Network timeout'));
  expect(await submitListingToMarketplace('tenant', 'draft')).toMatchObject({ success: false, publicationUnconfirmed: true }); expect(invoke).toHaveBeenCalledTimes(1);
});
test('HTTP gateway errors never expose HTML or imply an eBay rejection', async () => {
  const response = new Response('<html>Gateway timeout</html>', { status: 504 });
  submissionSetup({ data: null, error: new FunctionsHttpError(response) }, draft);
  const result = await submitListingToMarketplace('tenant', 'draft');
  expect(result.publicationUnconfirmed).toBe(true); expect(result.error).not.toContain('<html>');
});
test('recovery uses one status-only operation on the saved identity', async () => {
  const { invoke } = setup([live('review_required'), live()], { data: { success: true, results: [{ listingId: 'draft', status: 'active' }] }, error: null });
  expect((await reconcileListingPublication('tenant', 'draft', 'tunes_flip')).error).toBeNull();
  expect(invoke).toHaveBeenCalledWith('swish-ebay-listing-status', { body: { tenantId: 'tenant', nicheId: 'tunes_flip', listingIds: ['draft'] } });
  expect(invoke).toHaveBeenCalledTimes(1);
});
test('recovery cannot cross niche boundaries or publish an unlinked draft', async () => {
  let client = setup(); expect((await reconcileListingPublication('tenant', 'draft', 'coins')).error).toBeTruthy(); expect(client.invoke).not.toHaveBeenCalled();
  client = setup([draft]); expect((await reconcileListingPublication('tenant', 'draft', 'tunes_flip')).error).toContain('saved eBay ID'); expect(client.invoke).not.toHaveBeenCalled();
});
test('incomplete status sync stays pending and preserves saved identity', async () => {
  setup([live('review_required')], { data: { success: false, results: [{ listingId: 'draft', error: 'Sync unavailable' }] }, error: null });
  const result = await reconcileListingPublication('tenant', 'draft', 'tunes_flip');
  expect(result.error).toBe('Sync unavailable'); expect(result.publication?.externalListingId).toBe(externalId);
});
test('sync readback must confirm stock status before clearing pending', async () => {
  setup([live('review_required'), live('review_required')], { data: { success: true, results: [{ listingId: 'draft', status: 'active' }] }, error: null });
  expect((await reconcileListingPublication('tenant', 'draft', 'tunes_flip')).error).toContain('still need review');
});
test('schema-resolution migration adds no client access, data changes or authorization bypass', () => {
  const sql = fs.readFileSync('supabase/migrations/20261109_publish_lifecycle_auth_usage.sql', 'utf8');
  expect(sql).toContain('grant usage on schema auth to service_role');
  expect(sql).not.toMatch(/grant\s+.*\s+on\s+(all\s+tables|auth\.users)/i); expect(sql).not.toMatch(/\b(update|delete|insert)\s+(into\s+)?public\./i);
});
test('preflight exposes pending sync instead of Retry for known or uncertain publication', () => {
  const ui = fs.readFileSync('app/listing-preflight.tsx', 'utf8');
  expect(ui).toContain('const canSubmit = !publicationLocked'); expect(ui).toContain('<ListingPublicationCard');
  const acceptedBranch = ui.slice(ui.indexOf('} else if (result.accepted || result.publicationUnconfirmed)'), ui.indexOf("'Submission Failed'"));
  expect(acceptedBranch).toContain('Synchronise existing listing'); expect(acceptedBranch).not.toContain("text: 'Retry'");
  const recovery = fs.readFileSync('services/listingPublicationService.ts', 'utf8');
  expect(recovery).not.toContain("invoke('swish-ebay-list',"); expect(recovery).not.toContain('.update(');
});
