// Pure formatting and source contracts only. No AI, database mutation or eBay requests.
import fs from 'node:fs';
import { buildEbayDescriptionHtml, LISTING_DESCRIPTION_NOTE } from '@/shared/listingDescription';
import { descriptionText, descriptionXml } from '@/shared/ebayRevisionContract';
import { editListingDescription, projectListingDescription, restoreFlattenedDescription } from '../listingDescriptionService';
const source = (file: string) => fs.readFileSync(file, 'utf8');
const body = 'Doctor Who & Christmas.\n\nCase wear is visible.\nDisc not playback tested.';
const specifics = { Brand: 'BBC DVD', Format: 'DVD', 'Region Code': 'DVD: 2 (Europe, Japan, Middle East...)' };
const html = buildEbayDescriptionHtml({ description: body, item_specifics: specifics }, 'tech');
function previousEditorFlatten(value: string): string {
  return value.split(/<br\s*\/?\s*>|<\/(?:p|div|h[1-6]|tr)>|\r?\n/gi).map(part => descriptionText(part)).filter(Boolean).join('\n\n');
}
function historicalLayout(description: string, values: Record<string, string>, label: string): string {
  const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const rows = Object.entries(values).map(([name, value]) => '<tr><td style="padding:8px;border:1px solid #dddddd;font-weight:bold;width:38%;">' + escape(name) + '</td><td style="padding:8px;border:1px solid #dddddd;">' + escape(value) + '</td></tr>').join('');
  return '<div style="font-family:Arial,Helvetica,sans-serif;color:#222222;font-size:14px;line-height:1.55;max-width:100%;">' +
    '<h2 style="font-size:18px;margin:0 0 12px;">Item description</h2>' +
    '<div style="padding:12px;border:1px solid #dddddd;">' + escape(description).replace(/\r\n|\r|\n/g, '<br />') + '</div>' +
    (rows ? '<h3 style="font-size:15px;margin:18px 0 8px;">Item details</h3><table style="border-collapse:collapse;width:100%;"><tbody>' + rows + '</tbody></table>' : '') +
    '<h3 style="font-size:15px;margin:18px 0 8px;">Please note</h3>' + '<p style="margin:0;">' + LISTING_DESCRIPTION_NOTE + '</p>' +
    '<div style="margin-top:18px;padding:6px 10px;background:#202329;color:#f3c928;text-align:center;font-family:Arial,Helvetica,sans-serif;font-size:10px;line-height:1.3;letter-spacing:0.5px;"><strong>' + label + '</strong><span style="color:#ffffff;">&nbsp; | &nbsp;POWERED BY SWISHFLIP</span></div></div>';
}
test.each([['tech', 'TECH FLIP'], ['coins', 'COIN FLIP'], ['stamps', 'STAMP FLIP'], ['antiques', 'ANTIQUE FLIP'], ['clothing', 'THREADS FLIP'], ['tunes_flip', 'SWISH LISTING']])('%s retains the original HTML template byte for byte', (niche, label) => {
  expect(buildEbayDescriptionHtml({ description: body, item_specifics: specifics }, niche)).toBe(historicalLayout(body, specifics, label));
});
test('the shared generation template and backend deployment asset are byte identical', () => {
  expect(source('shared/listingDescription.ts')).toBe(source('supabase/functions/_shared/listingDescription.ts'));
  expect(source('supabase/functions/swish-list-generate/index.ts')).toContain("import { buildEbayDescriptionHtml } from '../_shared/listingDescription.ts'");
  expect(source('scripts/sync-backend-registry.mjs')).toContain("'listingDescription.ts'");
});
test('native editing projects only the narrative, not headings, table or footer', () => {
  const model = projectListingDescription(html);
  expect(model.mode).toBe('template');
  expect(model.text).toBe(body);
  expect(model.body).toBe(body);
  expect(model.details).toEqual(Object.entries(specifics).map(([name, value]) => ({ name, value })));
  expect(model.note).toBe(LISTING_DESCRIPTION_NOTE);
  expect(model.credit).toBe('TECH FLIP | POWERED BY SWISHFLIP');
  expect(model.text).not.toContain('POWERED BY');
});
test('no-op editing leaves all markup, spacing, entities and styles byte identical', () => {
  const padded = '\n  ' + html + '\n';
  expect(editListingDescription(padded, projectListingDescription(padded).text)).toBe(padded);
});
test('narrative edits preserve the complete saved envelope, old specifics and original credit', () => {
  const before = projectListingDescription(html);
  const text = 'Reviewed wording.\n\nDisc not tested; scratches are visible.';
  const changed = editListingDescription(html, text);
  const after = projectListingDescription(changed);
  expect(changed.slice(0, before.start)).toBe(html.slice(0, before.start));
  expect(changed.slice(after.end)).toBe(html.slice(before.end));
  expect(after.text).toBe(text); expect(after.details).toEqual(before.details);
  expect(after.note).toBe(before.note); expect(after.credit).toBe(before.credit);
});
test('typed markup and special characters become escaped narrative, not active HTML', () => {
  const typed = 'A & B <script>alert(1)</script> "quoted" > 0\nBuyer\'s copy.';
  const changed = editListingDescription(html, typed);
  expect(changed).not.toContain('<script>');
  expect(changed).toContain('&lt;script&gt;');
  expect(projectListingDescription(changed).text).toBe(typed);
});
test('custom HTML is never silently converted or reconstructed', () => {
  const custom = '<div style="color:red"><h1>Custom listing</h1><p>A <strong>bold</strong> claim.</p></div>';
  expect(projectListingDescription(custom).mode).toBe('source');
  expect(projectListingDescription(custom).text).toBe(custom);
  expect(editListingDescription(custom, custom)).toBe(custom);
  const styledNarrative = html.replace('Doctor Who &amp; Christmas.', '<strong>Doctor Who</strong> &amp; Christmas.');
  expect(projectListingDescription(styledNarrative).mode).toBe('source');
  expect(editListingDescription(styledNarrative, styledNarrative)).toBe(styledNarrative);
});
test('plain descriptions remain unchanged until an explicit edit or formatting repair', () => {
  const text = 'First paragraph.\n\nUntested disc.';
  expect(projectListingDescription(text).mode).toBe('plain');
  expect(editListingDescription(text, text)).toBe(text);
  expect(restoreFlattenedDescription(text)).toBeNull();
});
test('explicit repair restores flattened layout while preserving every written word', () => {
  const flattened = previousEditorFlatten(html);
  const restored = restoreFlattenedDescription(flattened, Object.entries(specifics).map(([name, value]) => ({ name, value })));
  expect(restored).not.toBeNull();
  expect(restored).toContain('<table'); expect(restored).toContain('<strong>TECH FLIP</strong>');
  expect(descriptionText(restored!)).toBe(descriptionText(flattened));
  const model = projectListingDescription(restored!);
  expect(model.mode).toBe('template'); expect(model.note).toBe(LISTING_DESCRIPTION_NOTE);
  expect(model.details).toEqual(Object.entries(specifics).map(([name, value]) => ({ name, value })));
  expect(model.text).toContain('Disc not playback tested.');
});
test('repair keeps old table values even if current inventory values differ', () => {
  const flattened = previousEditorFlatten(html);
  const restored = restoreFlattenedDescription(flattened, [{ name: 'Format', value: 'Vinyl' }, { name: 'Brand', value: 'Changed brand' }]);
  expect(projectListingDescription(restored!).details).toContainEqual({ name: 'Format', value: 'DVD' });
  expect(restored).not.toContain('Changed brand'); expect(restored).not.toContain('Vinyl');
  expect(descriptionText(restored!)).toBe(descriptionText(flattened));
});
test('unknown cell boundaries stay intact instead of inventing names or values', () => {
  const flattened = previousEditorFlatten(html);
  const restored = restoreFlattenedDescription(flattened);
  expect(restored).toContain('colspan="2"');
  expect(projectListingDescription(restored!).details[0]).toEqual({ name: '', value: 'Brand BBC DVD' });
  expect(descriptionText(restored!)).toBe(descriptionText(flattened));
});
test.each(['Item description No note TECH FLIP | POWERED BY SWISHFLIP', 'Item description No credit Please note Buyer note', 'Item description Please note TECH FLIP | POWERED BY SWISHFLIP'])('ambiguous/incomplete plain layout is not repaired: %s', text => {
  expect(restoreFlattenedDescription(text)).toBeNull();
});
test('formatted content still travels through the existing exact XML transport', () => {
  const xml = descriptionXml(html);
  expect(xml).toContain('&lt;table'); expect(xml).toContain('&lt;strong&gt;TECH FLIP');
  expect(xml).toContain('&amp;amp;');
  const hook = source('hooks/useListingEditor.ts');
  expect(hook).toContain("description:row.description??''");
  expect(hook).not.toContain('descriptionText(');
  expect(source('services/listingCopyService.ts')).toContain("input.field === 'description' ? raw : raw.trim()");
  expect(source('services/listingEditorService.ts')).toContain('description: input.description');
});
test('the uniform field retains the AI action, editable text, explicit repair and a read-only preview', () => {
  const field = source('components/feature/ListingDescriptionField.tsx');
  expect(source('components/feature/ListingCopyFields.tsx')).toContain('<ListingDescriptionField');
  expect(field).toContain('onGenerate={onGenerate}'); expect(field).toContain('onChange={field.changeText}');
  expect(field).toContain('Preview formatting'); expect(field).toContain('Restore formatting');
  expect(field).toContain('onPress={field.restore}');
  const service = source('services/listingDescriptionService.ts');
  expect(service).not.toMatch(/getSupabaseClient|\.from\(|\.rpc\(|\.invoke\(/);
  const hook = source('hooks/useListingDescription.ts');
  expect(hook).not.toMatch(/generateListing|submitListing|reviseSavedListing|saveListing/);
});
