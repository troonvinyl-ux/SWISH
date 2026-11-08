import { normalizeProductBarcode, sameGtin, type ProductLead } from '@/shared/quickList';
import { specificBarcodeLead } from './quickListPolicyService';
import { invokeListingOperation } from './listingEditorService';

export interface BarcodeLookupResult {
  gtin: string;
  products: ProductLead[];
  status: 'candidates' | 'no_match' | 'unavailable' | 'invalid';
  message: string;
  error: string | null;
}

/** The authenticated barcode route asks AI directly; a proposal is not physical-item evidence. */
export async function lookupProductBarcode(tenantId: string, value: string, type = ''): Promise<BarcodeLookupResult> {
  const gtin = normalizeProductBarcode(value, type);
  if (!gtin) {
    const message = 'Barcode is not a valid product GTIN. Use photo identification.';
    return { gtin: '', products: [], status: 'invalid', message, error: message };
  }
  const response = await invokeListingOperation({ route: 'barcode_lookup', tenantId, gtin }, 'swish-ebay-browse');
  const data = response.data;
  if (response.error || data?.status === 'unavailable' || !Array.isArray(data?.products) || !['candidates', 'no_match'].includes(data?.status)) {
    const message = response.error || data?.message || 'AI barcode research did not complete. Try again or use photos.';
    return { gtin, products: [], status: 'unavailable', message, error: message };
  }
  // Brand and MPN/model are optional on eBay (including games, books and toys).
  // The exact validated GTIN is sufficient to show a lead, not to approve physical evidence.
  const products: ProductLead[] = data.products.filter((lead: ProductLead) => specificBarcodeLead(lead) && ['eBay Browse', 'OnSpace AI'].includes(lead.source) && sameGtin(normalizeProductBarcode(lead.gtin) ?? '', gtin));
  if (!products.length && data.products.length) {
    const message = 'Barcode results were returned but their identifiers could not be verified. Try again or use photos.';
    return { gtin, products: [], status: 'unavailable', message, error: message };
  }
  return {
    gtin, products, status: products.length ? 'candidates' : 'no_match',
    message: typeof data.message === 'string' && data.message.trim() ? data.message.trim().slice(0, 300) : products.length ? 'Barcode result found. Check against your item photos.' : 'AI could not identify this barcode reliably. Take item photos to continue.',
    error: null,
  };
}
