// Provider-response regression tests; no real eBay requests or native-camera verification.
jest.mock('../listingEditorService', () => ({ invokeListingOperation: jest.fn() }));
import fs from 'node:fs';
import { invokeListingOperation } from '../listingEditorService';
import { lookupProductBarcode } from '../barcodeLookupService';
import { specificBarcodeLead, barcodeAgreesWithPhotos, enrichQuickIdentification } from '../quickListPolicyService';
import { NICHE_MODULES } from '@/constants/niches';
import type { ProductLead } from '@/shared/quickList';

// Shape of the real eBay response observed in backend logs: valid EAN/title but no MPN/model.
const game: ProductLead = { id: 'v1|336601445604|0', title: 'XBOX - LEGO HARRY POTTER YEARS 1-4 - XBOX CLASSICS', gtin: '5051892055116', brand: '', model: '', categoryId: '139973', categoryName: 'Video Games', specifics: { Platform: 'Microsoft Xbox 360' }, source: 'eBay Browse', url: 'https://www.ebay.co.uk/itm/336601445604' };
const provider = invokeListingOperation as jest.Mock;
beforeEach(() => jest.clearAllMocks());

test('an exact GTIN game with no model survives the client lookup', async () => {
  provider.mockResolvedValue({ error: null, data: { status: 'candidates', products: [game] } });
  expect(specificBarcodeLead(game)).toBe(true);
  const result = await lookupProductBarcode('tenant', game.gtin, 'ean13');
  expect(result.status).toBe('candidates');
  expect(result.products).toEqual([game]);
  expect(result.error).toBeNull();
  expect(provider).toHaveBeenCalledWith({ route: 'barcode_lookup', tenantId: 'tenant', gtin: game.gtin }, 'swish-ebay-browse');
});

test('a book ISBN converted to EAN is accepted without a brand or model', async () => {
  const book = { ...game, gtin: '9780306406157', title: 'Catalogue book', specifics: {} };
  provider.mockResolvedValue({ error: null, data: { status: 'candidates', products: [book] } });
  const result = await lookupProductBarcode('tenant', '0306406152');
  expect(result.products).toEqual([book]);
  expect(result.gtin).toBe(book.gtin);
});

test('invalid check digits never call the provider', async () => {
  expect((await lookupProductBarcode('tenant', '4006381333932')).status).toBe('invalid');
  expect(provider).not.toHaveBeenCalled();
  expect(specificBarcodeLead({ ...game, gtin: '4006381333932' })).toBe(false);
});

test('successful no match and connection/authorization failures have distinct outcomes', async () => {
  provider.mockResolvedValueOnce({ error: null, data: { products: [], status: 'no_match' } });
  const empty = await lookupProductBarcode('tenant', game.gtin);
  expect(empty.status).toBe('no_match'); expect(empty.error).toBeNull(); expect(empty.message).toContain('AI');
  provider.mockResolvedValueOnce({ error: '[HTTP 403] Account differs from the active module.', data: null });
  const denied = await lookupProductBarcode('tenant', game.gtin);
  expect(denied.status).toBe('unavailable'); expect(denied.error).toContain('403');
  provider.mockResolvedValueOnce({ error: null, data: { products: [], status: 'unavailable', message: 'eBay authorization unavailable.' } });
  expect((await lookupProductBarcode('tenant', game.gtin)).error).toContain('authorization unavailable');
});

test('malformed and wrong-GTIN responses cannot become fabricated matches or empty results', async () => {
  provider.mockResolvedValueOnce({ error: null, data: { products: [{ ...game, gtin: '4006381333931' }], status: 'candidates' } });
  const wrong = await lookupProductBarcode('tenant', game.gtin);
  expect(wrong.products).toEqual([]); expect(wrong.status).toBe('unavailable');
  provider.mockResolvedValueOnce({ error: null, data: {} });
  expect((await lookupProductBarcode('tenant', game.gtin)).status).toBe('unavailable');
});

test('showing a model-free lead does not bypass photo or edition corroboration', () => {
  const result: any = { specialistId: NICHE_MODULES.collectibles.defaultSpecialist, attributes: {}, attributesConfirmed: {}, evidenceContradictory: [], condition: 'Used', conditionNotes: '' };
  expect(barcodeAgreesWithPhotos(game, result)).toBe(false);
  const enriched = enrichQuickIdentification(result, 'collectibles', game, {});
  expect(enriched.attributesConfirmed.Platform).toBeUndefined();
  expect(enriched.attributes._quick_barcode_match).toBe(false);
  expect(barcodeAgreesWithPhotos(game, { ...result, attributesConfirmed: { EAN: game.gtin } })).toBe(true);
  expect(barcodeAgreesWithPhotos(game, { ...result, attributesConfirmed: { EAN: game.gtin }, evidenceContradictory: ['Wrong edition'] })).toBe(false);
});

test('barcode lookup queries catalogue plus AI before seller-connector checks and preserves module policy', () => {
  const server = fs.readFileSync('supabase/functions/swish-ebay-browse/index.ts', 'utf8');
  const route = server.indexOf("if (route === 'barcode_lookup')");
  expect(route).toBeGreaterThan(server.indexOf('Authentication required. Please sign in'));
  expect(route).toBeLessThan(server.indexOf('// ── Get connector credentials'));
  expect(server).toContain("nicheBarcodeAllowed(String(body.nicheId ?? ''))");
  expect(server).toContain('await lookupUniversalBarcode(');
  const barcodeRoute = server.slice(route, server.indexOf('// ── Get connector credentials'));
  expect(barcodeRoute).toContain("Deno.env.get('ONSPACE_AI_API_KEY')");
  expect(barcodeRoute).toContain('getApplicationToken');
  expect(barcodeRoute).toContain('lookupBarcodeProducts');
  expect(barcodeRoute).toContain("p_feature:'barcode_lookup'");
  expect(server).not.toContain("Barcode Quick List is only available in Collectibles.");
  const camera = fs.readFileSync('hooks/useQuickListCamera.ts', 'utf8');
  expect(camera).toContain('!flow.barcodeLookup.code');
  const ui = fs.readFileSync('components/feature/QuickListWorkspace.tsx', 'utf8');
  expect(ui).toContain('flow.barcodeLookup.code'); expect(ui).toContain('Scan another barcode');
});
