/** Shared seller-content revision contract. No credentials, network or React. */
export interface LiveListingContent {
  externalListingId: string; title: string; description: string; sellerPrice: number;
  currency: string; listingType: string; checkedAt: string;
}
export function descriptionXml(description: string): string {
  if (typeof description !== 'string' || !description.trim()) throw new Error('A non-empty saved description is required.');
  // Escape the XML transport exactly once. eBay receives the original HTML string,
  // including entities and literal CDATA terminators; no nested CDATA or truncation.
  const escaped = description.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  return `<Description>${escaped}</Description>`;
}
export function descriptionText(value: string): string {
  const text = value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ');
  const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (whole, entity: string) => {
    if (entity[0] !== '#') return entities[entity.toLowerCase()] ?? whole;
    const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    return Number.isInteger(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  }).replace(/\s+/g, ' ').trim();
}
export function verifyRevisionContent(live: LiveListingContent, expected: { externalListingId: string; title: string; description: string; price: number }): string[] {
  const failures: string[] = [];
  if (live.externalListingId !== expected.externalListingId) failures.push('eBay returned a different listing identity.');
  if (live.title.trim() !== expected.title.trim()) failures.push('The live eBay title does not match the saved listing.');
  const exact = live.description.replace(/\r\n/g, '\n').trim() === expected.description.replace(/\r\n/g, '\n').trim();
  // eBay may sanitize harmless HTML/CSS. Buyer-facing words must still agree in full,
  // not merely contain an old substring. No invented or missing words are accepted.
  if (!exact && (!descriptionText(expected.description) || descriptionText(live.description) !== descriptionText(expected.description))) failures.push('The live eBay description does not match the saved description.');
  if (live.currency !== 'GBP' || !Number.isFinite(live.sellerPrice) || Math.round(live.sellerPrice * 100) !== Math.round(expected.price * 100)) failures.push('The live eBay seller price does not match the saved price.');
  return failures;
}
export function revisionFailure(data: any): string | null {
  if (!data?.success) return data?.error ?? 'eBay revision was not confirmed.';
  if (data.verified !== true) return 'eBay acknowledged the request, but live description and price were not verified. Check live eBay details before retrying.';
  const warnings = [data.warning, ...(Array.isArray(data.warnings) ? data.warnings : [])].filter(Boolean);
  return warnings.length ? warnings.join('\n') : null;
}
