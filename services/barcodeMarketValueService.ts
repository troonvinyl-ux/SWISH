// Barcode results are priced by the existing shared engine, without saving an item or requiring photos.
import { getSupabaseClient } from '@/template';
import { NICHE_MODULES } from '@/constants/niches';
import { nicheBarcodeAllowed } from '@/shared/nichePolicy';
import { normalizeProductBarcode, type ProductLead } from '@/shared/quickList';
import { getMarketValue, type MarketValueResult } from './marketValueService';
import { quickSemanticKey } from './quickListReuseService';
export interface BarcodeMarketInput { tenantId: string; userId: string; nicheId: string; scope: string; lead: ProductLead }
type MarketResponse = { result: MarketValueResult | null; error: string | null };
const identityText = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
/** AI/catalogue details are search context only, never a condition assessment or source of prices. */
export function barcodeMarketParams(tenantId: string, nicheId: string, lead: ProductLead): Parameters<typeof getMarketValue>[0] | null {
  const niche = NICHE_MODULES[nicheId as keyof typeof NICHE_MODULES];
  const gtin = normalizeProductBarcode(lead.gtin);
  if (!tenantId.trim() || !niche || !nicheBarcodeAllowed(nicheId) || !gtin || identityText(lead.title).length < 3) return null;
  const specifics = Object.fromEntries(Object.entries(lead.specifics ?? {}).filter(([name, value]) =>
    !name.startsWith('_') && !/condition|authentic|tested|grade|price|valu|quantity|complet|warranty/i.test(name) && identityText(value)));
  const attributes: Record<string, unknown> = { ...specifics, barcode: gtin, EAN: gtin, product_name: identityText(lead.title) };
  // Normalize returned fields for the same specialist query builder used by listing valuation.
  const aliases: Record<string, string[]> = { artist: ['Artist'], release_title: ['Release Title'], catalogue_number: ['Catalogue Number', 'Catalog Number'], country: ['Country', 'Country of Manufacture'], label: ['Label', 'Record Label', 'Publisher'], format: ['Format'], edition: ['Edition'], region: ['Region Code'], year: ['Release Year'] };
  for (const [name, choices] of Object.entries(aliases)) {
    const value = choices.map(choice => identityText(specifics[choice])).find(Boolean);
    if (value) attributes[name] = value;
  }
  for (const [name, value] of Object.entries({ brand: lead.brand, manufacturer: lead.brand, model: lead.model, publisher: lead.publisher, label: lead.publisher, year: lead.releaseYear, release_date: lead.releaseDate, format: lead.format, edition: lead.edition, region: lead.region, product_category: lead.productCategory })) {
    if (identityText(value)) attributes[name] = identityText(value);
  }
  attributes._barcode_market_context = { verificationStatus: lead.verificationStatus ?? 'ai_suggested', physicalConditionVerified: false, authenticityVerified: false };
  const confidence = Number.isFinite(lead.confidence) ? Math.max(0, Math.min(1, lead.confidence!)) : 0.6;
  return { tenantId, title: identityText(lead.title), specialistId: niche.defaultSpecialist, attributes, condition: '', identificationConfidence: confidence, identificationTier: 'medium', applyToItem: false, quickList: true };
}
export function barcodeMarketKey(tenantId: string, nicheId: string, lead: ProductLead): string {
  const params = barcodeMarketParams(tenantId, nicheId, lead);
  return params ? quickSemanticKey(params) : '';
}
// Collapse only concurrent reads. Completed results are not an authorization or offline catalogue cache.
const flights = new Map<string, Promise<MarketResponse>>();
export function getBarcodeMarketValue(input: BarcodeMarketInput): Promise<MarketResponse> {
  const params = barcodeMarketParams(input.tenantId, input.nicheId, input.lead);
  if (!params || !input.userId || !input.scope) return Promise.resolve({ result: null, error: 'Review the product title and barcode in an active specialist before researching value.' });
  const key = quickSemanticKey({ userId: input.userId, scope: input.scope, params });
  const pending = flights.get(key); if (pending) return pending;
  const task = (async (): Promise<MarketResponse> => {
    try {
      const session = await getSupabaseClient().auth.getSession();
      if (session.error || session.data.session?.user.id !== input.userId) return { result: null, error: 'Sign in to the original account before researching market value.' };
      return await getMarketValue(params);
    } catch { return { result: null, error: 'Market value is unavailable. Retry pricing; product identification is unchanged.' }; }
  })().finally(() => { if (flights.get(key) === task) flights.delete(key); });
  flights.set(key, task); return task;
}
