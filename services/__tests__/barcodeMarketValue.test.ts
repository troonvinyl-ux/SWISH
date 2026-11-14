jest.mock('@/template', () => ({ getSupabaseClient: jest.fn() }));
jest.mock('../marketValueService', () => ({ getMarketValue: jest.fn() }));
import fs from 'node:fs';
import { getSupabaseClient } from '@/template';
import { NICHE_MODULES } from '@/constants/niches';
import { barcodeMarketKey, barcodeMarketParams, getBarcodeMarketValue } from '../barcodeMarketValueService';
import { getMarketValue } from '../marketValueService';
import { marketValueAmount } from '../listingAutofillService';
import type { ProductLead } from '@/shared/quickList';
const lead: ProductLead = { id: 'ai:dvd', gtin: '5014503238124', title: 'Doctor Who – Series 3, Volume 1', brand: 'BBC DVD', model: 'Series 3 Volume 1', publisher: 'BBC', releaseYear: '2007', format: 'DVD', edition: '1 disc', region: '2', categoryId: '', categoryName: '', specifics: { Genre: 'Sci-Fi', Format: 'DVD', Tested: 'Yes', Condition: 'New', 'Market Price': '999', Authenticity: 'Confirmed' }, source: 'OnSpace AI', url: '', verificationStatus: 'ai_suggested', confidence: 0.79 };
const input = () => ({ tenantId: 'tenant', userId: 'user', nicheId: 'tech', scope: 'user:tenant:tech:1:scan', lead });
const market: any = { valuation: { valuationMid: 6.5, valuationLow: 3, valuationHigh: 9, recommendedListingPrice: 7, valuationConfidence: 'very_low', valuationMethod: 'ai_market_estimate_gemini_text', valuationWarnings: ['Model estimate, not verified sold data'] }, soldMarket: { relevantSoldCount: 0 }, activeAskingPrices: { relevantCount: 2 } };
beforeEach(() => {
  jest.clearAllMocks();
  (getSupabaseClient as jest.Mock).mockReturnValue({ auth: { getSession: jest.fn().mockResolvedValue({ data: { session: { user: { id: 'user' } } }, error: null }) } });
  (getMarketValue as jest.Mock).mockResolvedValue({ result: market, error: null });
});
test.each(['tech', 'collectibles', 'tunes_flip', 'trading_cards'] as const)('%s uses the shared listing engine with AI product metadata and no saved resource', async nicheId => {
  const before = JSON.stringify(lead);
  const result = await getBarcodeMarketValue({ ...input(), nicheId });
  expect(result.result).toBe(market);
  expect(getMarketValue).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'tenant', title: lead.title, specialistId: NICHE_MODULES[nicheId].defaultSpecialist, condition: '', identificationConfidence: 0.79, quickList: true, applyToItem: false, attributes: expect.objectContaining({ EAN: lead.gtin, format: 'DVD', region: '2', year: '2007', manufacturer: 'BBC DVD', model: 'Series 3 Volume 1' }) }));
  const params = (getMarketValue as jest.Mock).mock.calls[0][0];
  expect(params).not.toHaveProperty('itemId'); expect(params).not.toHaveProperty('imageUrls'); expect(params).not.toHaveProperty('imageBase64');
  for (const key of ['Tested', 'Condition', 'Market Price', 'Authenticity']) expect(params.attributes).not.toHaveProperty(key);
  expect(params.attributes._barcode_market_context.physicalConditionVerified).toBe(false);
  expect(JSON.stringify(lead)).toBe(before);
  expect(marketValueAmount(result.result)).toBe(6.5); // Same midpoint as listing UI, not the £7 selling recommendation.
});
test('invalid barcode/title and barcode-disabled niche do not call pricing', async () => {
  for (const entry of [{ ...input(), lead: { ...lead, gtin: 'invalid' } }, { ...input(), lead: { ...lead, title: '' } }, { ...input(), nicheId: 'stamps' }, { ...input(), nicheId: 'unknown' }]) expect((await getBarcodeMarketValue(entry)).result).toBeNull();
  expect(getMarketValue).not.toHaveBeenCalled();
});
test('completed pricing is not reused across requests and concurrent duplicate scans use one flight', async () => {
  const [a, b] = await Promise.all([getBarcodeMarketValue(input()), getBarcodeMarketValue(input())]);
  expect(a).toBe(b); expect(getMarketValue).toHaveBeenCalledTimes(1);
  await getBarcodeMarketValue(input()); expect(getMarketValue).toHaveBeenCalledTimes(2);
});
test('identity keys change with title, edition, region and specialist, not object property order', () => {
  const original = barcodeMarketKey('tenant', 'tech', lead);
  for (const patch of [{ title: 'Different DVD' }, { edition: '2 discs' }, { region: '1' }, { format: 'Blu-ray' }]) expect(barcodeMarketKey('tenant', 'tech', { ...lead, ...patch })).not.toBe(original);
  expect(barcodeMarketKey('tenant', 'collectibles', lead)).not.toBe(original);
  expect(barcodeMarketKey('tenant', 'tech', { ...lead, specifics: Object.fromEntries(Object.entries(lead.specifics).reverse()) })).toBe(original);
  expect(barcodeMarketParams('tenant', 'tech', { ...lead, confidence: NaN })?.identificationConfidence).toBe(0.6);
});
test('different accounts/scans cannot share a flight and an account change prevents the provider call', async () => {
  const session = (getSupabaseClient() as any).auth.getSession;
  session.mockResolvedValue({ data: { session: { user: { id: 'other' } } }, error: null });
  const result = await getBarcodeMarketValue(input()); expect(result.error).toMatch(/original account/); expect(getMarketValue).not.toHaveBeenCalled();
  session.mockResolvedValue({ data: { session: { user: { id: 'user' } } }, error: null });
  await Promise.all([getBarcodeMarketValue(input()), getBarcodeMarketValue({ ...input(), scope: 'new-module-epoch' })]); expect(getMarketValue).toHaveBeenCalledTimes(2);
});
test('provider errors are exposed without inventing a price, and retry calls the same shared function', async () => {
  (getMarketValue as jest.Mock).mockResolvedValueOnce({ result: null, error: 'eBay is not connected' });
  expect(await getBarcodeMarketValue(input())).toEqual({ result: null, error: 'eBay is not connected' });
  expect((await getBarcodeMarketValue(input())).result).toBe(market);
});
test('barcode result UI reuses the market summary in both entry points without blocking product confirmation', () => {
  const ui = fs.readFileSync('components/feature/BarcodeProductConfirmation.tsx', 'utf8');
  expect(ui).toContain('useBarcodeMarketValue(draft)'); expect(ui).toContain('<MarketValueSummary result={market.result}'); expect(ui).toContain('Checking market value'); expect(ui).toContain('Retry market value');
  expect(ui).toContain('disabled={busy||!draft.title.trim()}');
  for (const path of ['components/feature/UniversalBarcodeTool.tsx', 'components/feature/QuickListWorkspace.tsx']) expect(fs.readFileSync(path, 'utf8')).toContain('<BarcodeProductConfirmation');
});
test('shared server supports metadata-only estimates while preserving auth, existing model, source labels and non-write guard', () => {
  const edge = fs.readFileSync('supabase/functions/swish-market-value/index.ts', 'utf8');
  expect(edge).not.toContain("if (!apiKey || !baseUrl || (imageUrls.length === 0 && !inlineImageBase64))");
  for (const text of ['Product metadata only; no photographs', 'physical item', 'requirePaidNiche', 'verifyTenantAccess', "model: 'google/gemini-2.5-flash'", 'ai_market_estimate_gemini_text', 'E_ai_inference', 'if (applyToItem && itemId && valuation.valuationMid > 0)']) expect(edge).toContain(text);
});
