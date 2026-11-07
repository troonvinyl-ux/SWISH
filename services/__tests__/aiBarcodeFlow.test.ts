// Mocked AI result and physical-evidence regressions. Not live AI accuracy or native-camera tests.
jest.mock('../listingEditorService', () => ({ invokeListingOperation: jest.fn() }));
import fs from 'node:fs';
import { invokeListingOperation } from '../listingEditorService';
import { lookupProductBarcode } from '../barcodeLookupService';
import { barcodeAgreesWithPhotos, enrichQuickIdentification } from '../quickListPolicyService';
import { NICHE_MODULES } from '@/constants/niches';
import type { ProductLead } from '@/shared/quickList';
const lead: ProductLead = { id: 'ai:5024866335279', gtin: '5024866335279', title: 'Colin McRae DiRT Xbox 360', brand: 'Codemasters', model: '', categoryId: '', categoryName: '', specifics: { Platform: 'Microsoft Xbox 360', Publisher: 'Codemasters', 'Release Year': '2007' }, source: 'OnSpace AI', url: 'https://catalogue.example/dirt', sourceUrls: ['https://catalogue.example/dirt'], summary: 'Platform: Microsoft Xbox 360 · Publisher: Codemasters', confidence: 0.9 };
const provider = invokeListingOperation as jest.Mock;
const physical = (attributesConfirmed: Record<string, string> = {}): any => ({ canonicalTitle: lead.title, specialistId: NICHE_MODULES.collectibles.defaultSpecialist, attributes: {}, attributesConfirmed, evidenceContradictory: [], condition: 'Used', conditionNotes: '' });
beforeEach(() => jest.clearAllMocks());
test('a barcode goes straight to the AI-backed route and preserves its sourced product details', async () => {
  provider.mockResolvedValue({ error: null, data: { status: 'candidates', products: [lead], message: 'AI barcode result · check against your item photos.' } });
  const result = await lookupProductBarcode('tenant', lead.gtin, 'ean13');
  expect(provider).toHaveBeenCalledTimes(1);
  expect(provider).toHaveBeenCalledWith({ route: 'barcode_lookup', tenantId: 'tenant', gtin: lead.gtin }, 'swish-ebay-browse');
  expect(result.products).toEqual([lead]); expect(result.message).toContain('AI barcode result');
  expect(result.error).toBeNull();
});
test('AI unknown results and provider failures do not fabricate an identity', async () => {
  provider.mockResolvedValueOnce({ error: null, data: { status: 'no_match', products: [], message: 'AI could not identify this barcode reliably.' } });
  expect((await lookupProductBarcode('tenant', lead.gtin)).status).toBe('no_match');
  provider.mockResolvedValueOnce({ error: null, data: { status: 'unavailable', products: [], message: 'OnSpace AI: unavailable.' } });
  const result = await lookupProductBarcode('tenant', lead.gtin);
  expect(result.error).toContain('OnSpace AI'); expect(result.products).toEqual([]);
});
test('a repeated barcode alone cannot confirm an AI title or platform', () => {
  expect(barcodeAgreesWithPhotos(lead, physical({ EAN: lead.gtin }))).toBe(false);
  expect(barcodeAgreesWithPhotos(lead, physical({ Platform: 'PlayStation 3', EAN: lead.gtin }))).toBe(false);
  expect(barcodeAgreesWithPhotos(lead, { ...physical({ Platform: 'Microsoft Xbox 360', EAN: lead.gtin }), canonicalTitle: 'LEGO Harry Potter Xbox 360' })).toBe(false);
  expect(barcodeAgreesWithPhotos(lead, physical({ Platform: 'Microsoft Xbox 360', EAN: '5051892055116' }))).toBe(false);
});
test('printed title and platform corroborate a proposal but do not auto-confirm unseen AI details', () => {
  const result = physical({ Platform: 'Microsoft Xbox 360' });
  expect(barcodeAgreesWithPhotos(lead, result)).toBe(true);
  const enriched = enrichQuickIdentification(result, 'collectibles', lead, {});
  expect(enriched.attributesConfirmed.Platform).toBe('Microsoft Xbox 360');
  expect(enriched.attributesConfirmed.Publisher).toBeUndefined();
  expect(enriched.attributesConfirmed['Release Year']).toBeUndefined();
  expect(enriched.attributesConfirmed.EAN).toBeUndefined();
  expect(enriched.attributes._quick_attribute_sources).toEqual(expect.arrayContaining([
    expect.objectContaining({ key: 'Platform', sources: ['ai_barcode_research'], accepted: true }),
    expect.objectContaining({ key: 'Publisher', sources: ['ai_barcode_research'], accepted: false }),
  ]));
  expect(barcodeAgreesWithPhotos(lead, { ...result, evidenceContradictory: ['Wrong edition'] })).toBe(false);
});
test('UI asks AI automatically without adding a review or publication step', () => {
  const ui = fs.readFileSync('components/feature/QuickListWorkspace.tsx', 'utf8');
  expect(ui).toContain('Asking AI…'); expect(ui).toContain('AI research suggestion'); expect(ui).toContain('state.lead.summary');
  expect(ui).toContain('label="View source"'); expect(ui).toContain('label="List now"'); expect(ui).toContain('label="Save for later"');
  const hook = fs.readFileSync('hooks/useQuickList.ts', 'utf8');
  expect(hook).toContain('await lookupQuickBarcode(tenant.id,value,type)');
  expect(hook).toContain('barcodeVersion!==barcodeSerial.current');
  const action = hook.slice(hook.indexOf('const barcode=useCallback'), hook.indexOf('const selectLead='));
  expect(action).not.toContain('publish('); expect(action).not.toContain('createQuickInventory(');
});
