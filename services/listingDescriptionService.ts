/** Read-only UI projection; edits retain the original HTML envelope, table and footer. */
import { descriptionText } from '@/shared/ebayRevisionContract';
import { buildEbayDescriptionHtml, escapeListingHtml } from '@/shared/listingDescription';
export interface DescriptionDetail { name: string; value: string }
export interface ListingDescriptionModel {
  mode: 'template' | 'plain' | 'source'; text: string; start: number; end: number;
  body: string; details: DescriptionDetail[]; note: string; credit: string;
}
function readableLines(html: string): string {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?\s*>|<\/(?:p|div|h[1-6]|tr|li)>/gi, '\n')
    .split('\n').map(line => descriptionText(line)).join('\n').trim();
}
export function projectListingDescription(html: string): ListingDescriptionModel {
  const match = /<h2\b[^>]*>\s*Item description\s*<\/h2>\s*<div\b[^>]*>([\s\S]*?)<\/div>/i.exec(html);
  const inner = match?.[1] ?? '';
  // The shared generator emits escaped narrative + BRs only. Never flatten custom rich markup for editing.
  const template = Boolean(match && !/<(?!br\s*\/?\s*>)/i.test(inner));
  const start = match ? match.index + match[0].indexOf('>', match[0].toLowerCase().indexOf('<div')) + 1 : -1;
  const details: DescriptionDetail[] = [];
  const table = /<table\b[^>]*>([\s\S]*?)<\/table>/i.exec(html)?.[1] ?? '';
  for (const row of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(cell => readableLines(cell[1]));
    if (cells.length) details.push({ name: cells.length > 1 ? cells[0] : '', value: cells.length > 1 ? cells.slice(1).join(' · ') : cells[0] });
  }
  const note = /<h3\b[^>]*>\s*Please note\s*<\/h3>\s*<p\b[^>]*>([\s\S]*?)<\/p>/i.exec(html)?.[1] ?? '';
  const credit = [...html.matchAll(/<div\b[^>]*>([\s\S]*?)<\/div>/gi)].map(found => found[1]).find(value => /POWERED BY SWISHFLIP/.test(value) && !/<(?:div|table|h[1-6])\b/i.test(value)) ?? '';
  const hasHtml = /<(?:div|p|table|h[1-6]|span|strong|b|br|ul|ol|li|script|style)\b/i.test(html);
  return { mode: template ? 'template' : hasHtml ? 'source' : 'plain', text: template ? readableLines(inner) : html,
    start, end: start < 0 ? -1 : start + inner.length, body: template ? readableLines(inner) : readableLines(html), details,
    note: readableLines(note), credit: readableLines(credit) };
}
export function editListingDescription(html: string, text: string): string {
  const model = projectListingDescription(html);
  if (text === model.text) return html; // No-op is byte-identical, including whitespace and all CSS/entities.
  if (model.mode !== 'template') return text; // Exact source editing, never automatic stripping.
  return html.slice(0, model.start) + escapeListingHtml(text).replace(/\r\n|\r|\n/g, '<br />') + html.slice(model.end);
}
/** Only recognises the previous editor's flattened branded layout. Never guesses missing words or specifications. */
export function restoreFlattenedDescription(text: string, specifics: DescriptionDetail[] = []): string | null {
  if (/<(?:div|p|table|h[1-6])\b/i.test(text) || !/^\s*Item description\b/.test(text)) return null;
  const footer = /\s+([A-Z][A-Z ]+\s*\|\s*POWERED BY SWISHFLIP)\s*$/.exec(text);
  if (!footer) return null;
  const beforeCredit = text.slice(0, footer.index);
  const noteStart = beforeCredit.lastIndexOf('Please note');
  if (noteStart < 0) return null;
  const note = beforeCredit.slice(noteStart + 'Please note'.length).trim();
  const content = beforeCredit.slice(0, noteStart).replace(/^\s*Item description\s*/, '').trim();
  const detailsStart = content.lastIndexOf('Item details');
  const narrative = (detailsStart < 0 ? content : content.slice(0, detailsStart)).trim();
  if (!narrative || !note) return null;
  const detailText = detailsStart < 0 ? '' : content.slice(detailsStart + 'Item details'.length).trim();
  const lines = detailText ? detailText.split(/\n+/).map(line => line.trim()).filter(Boolean) : [];
  const details = lines.map(line => {
    const specific = [...specifics].sort((a, b) => b.name.length - a.name.length).find(row => row.name && line.startsWith(row.name + ' '));
    // Use names only to find an existing cell boundary; keep the OLD written value, not current inventory metadata.
    return specific ? { name: specific.name, value: line.slice(specific.name.length).trim() } : { name: '', value: line };
  });
  const html = buildEbayDescriptionHtml({ description: narrative }, undefined, { details, note, credit: footer[1].trim() });
  // All buyer-facing words must survive; only markup/whitespace may change.
  return descriptionText(html) === descriptionText(text) ? html : null;
}
