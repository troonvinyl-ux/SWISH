import { normalizeProductBarcode, sameGtin, type ProductLead } from '@/shared/quickList';
import type { BarcodeProvider } from '@/shared/barcodeIdentification';
import { specificBarcodeLead } from './quickListPolicyService';
import { invokeListingOperation } from './listingEditorService';
export interface BarcodeLookupResult { gtin: string; products: ProductLead[]; status: 'candidates' | 'no_match' | 'unavailable' | 'invalid'; message: string; error: string | null; warnings?: string[]; durationMs?: number; cached?: boolean }
const flights = new Map<string, Promise<BarcodeLookupResult>>();
/** Cache is server-owned and authorization is checked on every HTTP request. Client only collapses concurrent duplicate reads. */
export function lookupProductBarcode(tenantId: string, value: string, type = '', provider?: BarcodeProvider, requestScope = ''): Promise<BarcodeLookupResult> {
  const gtin = normalizeProductBarcode(value, type);
  if (!gtin) { const message = 'Invalid EAN/UPC/ISBN check digit. Rescan or edit the barcode.'; return Promise.resolve({ gtin: '', products: [], status: 'invalid', message, error: message }); }
  const key = `${requestScope}:${tenantId}:${gtin.padStart(14, '0')}:${provider ?? 'default'}`;
  const pending = flights.get(key); if (pending) return pending;
  const task = lookup(tenantId, gtin, provider).finally(() => flights.delete(key)); flights.set(key, task); return task;
}
async function lookup(tenantId: string, gtin: string, provider?: BarcodeProvider): Promise<BarcodeLookupResult> {
  const response = await invokeListingOperation({ route: 'barcode_lookup', tenantId, gtin, ...(provider ? { provider } : {}) }, 'swish-ebay-browse');
  const data = response.data;
  if (response.error || !Array.isArray(data?.products) || !['candidates', 'no_match', 'unavailable'].includes(data?.status)) {
    const message = response.error || data?.message || 'Barcode lookup did not complete. Retry or add photos.';
    return { gtin, products: [], status: 'unavailable', message, error: message };
  }
  const products: ProductLead[] = data.products.filter((lead: ProductLead) => specificBarcodeLead(lead) && ['eBay Browse', 'OnSpace AI', 'Discogs'].includes(lead.source) && lead.specifics && typeof lead.specifics === 'object' && sameGtin(normalizeProductBarcode(lead.gtin) ?? '', gtin));
  if (!products.length && data.products.length) return { gtin, products: [], status: 'unavailable', message: 'Returned product identifiers differ from the barcode. Rescan or try another match.', error: 'The returned product identifier could not be validated.' };
  const message = typeof data.message === 'string' && data.message.trim() ? data.message.trim().slice(0, 400) : products.length ? 'Review the matching product and edition.' : 'Catalogue and AI returned no credible match. Edit details or add photos.';
  return { gtin, products, status: products.length ? 'candidates' : data.status, message, error: data.status === 'unavailable' && !products.length ? message : null, warnings: Array.isArray(data.warnings) ? data.warnings.filter((value: unknown) => typeof value === 'string').slice(0, 4) : [], durationMs: data.durationMs, cached: data.cached === true };
}
