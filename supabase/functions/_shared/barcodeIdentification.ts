// Barcode identity proposals. Catalogue verification refers to the barcode association, not the owned item's condition/authenticity.
export type BarcodeProvider = 'gemini' | 'openai';
export type BarcodeVerification = 'catalogue_verified' | 'ai_suggested';
export interface BarcodeMetadata {
  userEdited?: boolean; originalTitle?: string;
  verificationStatus?: BarcodeVerification; publisher?: string; releaseYear?: string; releaseDate?: string;
  format?: string; edition?: string; region?: string; productCategory?: string; suggestedEbayCategory?: string;
  fieldSources?: Record<string, string>; conflicts?: string[]; providers?: string[];
}
export const BARCODE_MODELS: Record<BarcodeProvider, string> = { gemini: 'google/gemini-3-flash-preview', openai: 'openai/gpt-5-mini' };
export const BARCODE_ENGINE_VERSION = 'barcode-v2';
export const barcodeProductSchema = {
  type: 'object', additionalProperties: false, required: ['status', 'products'],
  properties: {
    status: { type: 'string', enum: ['matched', 'no_match'] },
    products: { type: 'array', maxItems: 3, items: {
      type: 'object', additionalProperties: false,
      required: ['barcode', 'title', 'manufacturer', 'publisher', 'releaseYear', 'releaseDate', 'format', 'edition', 'region', 'category', 'attributes', 'suggestedEbayCategory', 'sourceUrls', 'confidence', 'verificationStatus'],
      properties: {
        barcode: { type: 'string' }, title: { type: 'string' },
        manufacturer: { type: ['string', 'null'] }, publisher: { type: ['string', 'null'] },
        releaseYear: { type: ['string', 'null'] }, releaseDate: { type: ['string', 'null'] },
        format: { type: ['string', 'null'] }, edition: { type: ['string', 'null'] }, region: { type: ['string', 'null'] },
        category: { type: ['string', 'null'] }, attributes: { type: 'object', additionalProperties: { type: 'string' } },
        suggestedEbayCategory: { type: ['string', 'null'] }, sourceUrls: { type: 'array', items: { type: 'string' }, maxItems: 4 },
        confidence: { type: 'number', minimum: 0, maximum: 1 }, verificationStatus: { type: 'string', enum: ['ai_suggested'] },
      },
    } },
  },
};
export interface BarcodeMergeLead extends BarcodeMetadata {
  id: string; title: string; gtin: string; brand: string; model: string; categoryId: string; categoryName: string;
  specifics: Record<string, string>; source: 'eBay Browse' | 'OnSpace AI' | 'Discogs'; url: string; sourceUrls?: string[]; summary?: string; confidence?: number;
}
const words = (title: string) => title.toLowerCase().replace(/\b(new|used|sealed|mint|free|postage|shipping|the|and)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
export function barcodeLeadsAgree(a: BarcodeMergeLead, b: BarcodeMergeLead): boolean {
  if (a.gtin.padStart(14, '0') !== b.gtin.padStart(14, '0')) return false;
  for (const key of ['format', 'edition', 'region']) {
    const left = a[key as 'format']?.toLowerCase(), right = b[key as 'format']?.toLowerCase();
    if (left && right && left !== right) return false;
  }
  for (const key of ['Platform', 'Format', 'Edition', 'Region Code', 'Size', 'Storage Capacity']) {
    const left = a.specifics[key]?.toLowerCase(), right = b.specifics[key]?.toLowerCase();
    if (left && right && left !== right) return false;
  }
  const left = new Set(words(a.title)), right = new Set(words(b.title));
  const numbers = (set: Set<string>) => [...set].filter(word => /^\d+$/.test(word)).sort().join(',');
  if (numbers(left) && numbers(right) && numbers(left) !== numbers(right)) return false;
  const overlap = [...left].filter(word => right.has(word)).length;
  return overlap >= 2 && overlap / Math.max(1, Math.min(left.size, right.size)) >= 0.8;
}
export function mergeBarcodeLeads(groups: readonly BarcodeMergeLead[][]): BarcodeMergeLead[] {
  const leads = groups.flat().slice().sort((a, b) => Number(b.verificationStatus === 'catalogue_verified') - Number(a.verificationStatus === 'catalogue_verified') || (b.confidence ?? 0) - (a.confidence ?? 0));
  const merged: BarcodeMergeLead[] = [];
  for (const lead of leads) {
    const existing = merged.find(row => barcodeLeadsAgree(row, lead));
    if (!existing) { merged.push({ ...lead, specifics: { ...lead.specifics }, fieldSources: { ...lead.fieldSources }, providers: [lead.source], conflicts: [] }); continue; }
    for (const [key, value] of Object.entries(lead.specifics)) {
      if (existing.specifics[key] && existing.specifics[key].toLowerCase() !== value.toLowerCase()) existing.conflicts!.push(`${key}: ${existing.specifics[key]} / ${value} (${lead.source})`);
      else if (!existing.specifics[key]) { existing.specifics[key] = value; existing.fieldSources![key] = lead.source; }
    }
    // AI-only supplements never inherit catalogue verification. Each field keeps its origin.
    for (const key of ['publisher', 'releaseYear', 'releaseDate', 'format', 'edition', 'region', 'productCategory', 'suggestedEbayCategory'] as const) {
      if (!existing[key] && lead[key]) { existing[key] = lead[key]; existing.fieldSources![key] = lead.source; }
    }
    existing.providers = [...new Set([...(existing.providers ?? []), lead.source])];
    existing.sourceUrls = [...new Set([...(existing.sourceUrls ?? (existing.url ? [existing.url] : [])), ...(lead.sourceUrls ?? [])])];
  }
  if (merged.length > 1) for (const lead of merged) lead.conflicts = [...(lead.conflicts ?? []), 'Other sources suggest a different product or edition. Check the selected match.'];
  return merged.slice(0, 6);
}
