// Pure/mocked regression coverage. No seller mutations or credentials.
jest.mock('@/template', () => ({ getSupabaseClient: jest.fn() }));
import fs from 'node:fs';
import { getSupabaseClient } from '@/template';
import { PRODUCTION_NICHE_IDS } from '@/constants/niches';
import { descriptionXml, descriptionText, verifyRevisionContent, revisionFailure, type LiveListingContent } from '@/shared/ebayRevisionContract';
import { reviseSavedListing, inspectLiveListing } from '@/services/ebayRevisionService';
const expected = { externalListingId: '800878483330', title: "Harrods 2000 Christmas Bear 'Nicholas'", description: '<div>Annual Christmas Bear, named &#39;Nicholas&#39;.<br/>Tags present.</div>', price: 35 };
const live = (): LiveListingContent => ({ ...expected, sellerPrice: 35, currency: 'GBP', listingType: 'FixedPriceItem', checkedAt: '2026-11-05T15:46:34Z' });
const source = (path: string) => fs.readFileSync(path, 'utf8');
describe('Shared revision description and price contract', () => {
  test.each(PRODUCTION_NICHE_IDS)('%s uses one verified editor and seller-content backend (no niche-specific fallback)', () => {
    expect(verifyRevisionContent(live(), expected)).toEqual([]);
    expect(source('hooks/useListingEditor.ts')).toContain('reviseSavedListing(snapshot.tenantId, snapshot.listingId)');
    expect(source('app/stock-listing/[id].tsx')).not.toContain("body: { route: 'revise'");
    expect(source('app/settings.tsx')).toContain('reviseSavedListing(tenantId, row.id)');
  });
  test('sends full HTML exactly once through escaped XML, including terminators and entities', () => {
    const description = '<p title="a&b">Nicholas &#39;Bear&#39; & ]]> £35</p>';
    const xml = descriptionXml(description);
    expect(xml).toContain('&lt;p title=&quot;a&amp;b&quot;&gt;');
    expect(xml).toContain('&amp;#39;Bear&amp;#39;');
    expect(xml).toContain(']]&gt;');
    expect(xml).not.toContain('<![CDATA[');
    expect(() => descriptionXml('')).toThrow(/non-empty/);
  });
  test('harmless HTML sanitisation and entities preserve every buyer-facing word', () => {
    expect(verifyRevisionContent({ ...live(), description: "<p>Annual Christmas Bear, named 'Nicholas'. Tags present.</p>" }, expected)).toEqual([]);
    expect(descriptionText('&lt;real text&gt; &amp; &#x1F43B;')).toBe('<real text> & 🐻');
  });
  test('the old generic description is a failure, not success from Ack', () => {
    expect(verifyRevisionContent({ ...live(), description: 'Condition: good · Keep as identified.' }, expected)).toContain('The live eBay description does not match the saved description.');
  });
  test.each([42,36.75])('a seller price of %s cannot be treated as £35 or silently corrected for assumed buyer fees', sellerPrice => {
    expect(verifyRevisionContent({ ...live(), sellerPrice }, expected)).toContain('The live eBay seller price does not match the saved price.');
  });
  test('missing readback, wrong identity and wrong currency fail closed', () => {
    expect(revisionFailure({ success: true })).toMatch(/not verified/);
    expect(revisionFailure({ success: true, verified: true, warnings: [] })).toBeNull();
    expect(revisionFailure({ success: true, verified: true, warnings: ['eBay restriction'] })).toBeNull();
    expect(revisionFailure({success:true,verified:true,warnings:['Final Value Fee waived.']})).toBeNull();
    expect(verifyRevisionContent({ ...live(), currency: 'USD', externalListingId: 'different' }, expected)).toHaveLength(2);
  });
  test('no deprecated DescriptionReviseMode or raw credentials in the shared transport helper', () => {
    const contract = source('shared/ebayRevisionContract.ts');
    expect(contract).not.toContain('DescriptionReviseMode');
    expect(contract).not.toContain('accessToken');
    expect(contract).toBe(source('supabase/functions/_shared/ebayRevisionContract.ts'));
  });
});
describe('Mocked shared eBay operation outcomes', () => {
  beforeEach(() => jest.clearAllMocks());
  test('push sends saved listing identities only, never an inventory description or inferred price', async () => {
    const invoke = jest.fn().mockResolvedValue({ data: { success: true, verified: true, live: live(), warnings: [] }, error: null });
    (getSupabaseClient as jest.Mock).mockReturnValue({ functions: { invoke } });
    expect((await reviseSavedListing('tenant', 'listing')).error).toBeNull();
    expect(invoke).toHaveBeenCalledWith('swish-ebay-list', { body: { route: 'revise', tenantId: 'tenant', listingId: 'listing', useSavedListing: true } });
  });
  test('accepted-but-unverified returns live mismatch data and an error', async () => {
    (getSupabaseClient as jest.Mock).mockReturnValue({ functions: { invoke: jest.fn().mockResolvedValue({ data: { success: false, accepted: true, verified: false, live: { ...live(), sellerPrice: 42 }, error: 'Price mismatch' }, error: null }) } });
    const result = await reviseSavedListing('tenant', 'listing');
    expect(result.error).toBe('Price mismatch'); expect(result.data.live.sellerPrice).toBe(42);
  });
  test('legacy success without new verification evidence is not shown as a successful update', async () => {
    (getSupabaseClient as jest.Mock).mockReturnValue({ functions: { invoke: jest.fn().mockResolvedValue({ data: { success: true }, error: null }) } });
    expect((await reviseSavedListing('tenant', 'listing')).error).toMatch(/not verified/);
  });
  test('a timeout never retries a marketplace write', async () => {
    const invoke = jest.fn().mockRejectedValue(new Error('Network timeout'));
    (getSupabaseClient as jest.Mock).mockReturnValue({ functions: { invoke } });
    expect((await reviseSavedListing('tenant', 'listing')).error).toMatch(/unconfirmed/); expect(invoke).toHaveBeenCalledTimes(1);
  });
  test('read-only live check has no saved-copy or inventory mutations', async () => {
    const invoke = jest.fn().mockResolvedValue({ data: { success: true, live: live() }, error: null });
    const from = jest.fn();
    (getSupabaseClient as jest.Mock).mockReturnValue({ functions: { invoke }, from });
    expect((await inspectLiveListing('tenant', 'listing')).live?.sellerPrice).toBe(35);
    expect(invoke).toHaveBeenCalledWith('swish-ebay-list', { body: { route: 'inspect_live', tenantId: 'tenant', listingId: 'listing', useSavedListing: true } });
    expect(from).not.toHaveBeenCalled();
  });
});
describe('Server source safeguards (not live acceptance)', () => {
  test('description and seller price come from saved listing, not caller inventory values', () => {
    const server = source('supabase/functions/swish-ebay-list/index.ts');
    expect(server).toContain("const description = String(ownedListing.description ?? '')");
    expect(server).toContain('verifyRevisionContent(live, { externalListingId, title, description, price })');
    expect(server).toContain("eq('updated_at', ownedListing.updated_at)");
    expect(server).toContain("'revise_sku', 'inspect_live'");
    expect(server).toContain('REVISION_FIELD_MISMATCH');
    expect(server).toContain('REVISION_READBACK_REQUIRED');
    expect(server).toContain('startPrice: price');
    expect(source('supabase/functions/_shared/ebayLiveContent.ts')).toContain('item.StartPrice ??');
    expect(source('supabase/functions/swish-ebay-sync/index.ts')).toContain('description:content.description');
  });
});
