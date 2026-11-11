// Pure seller-facing projections and source contracts. Not device acceptance.
import fs from 'node:fs';
import { availableSpecificFields, missingRequiredSpecifics, suggestedSpecificValues, SPECIFIC_PICKER_LIMIT } from '../listingSpecificsPresentationService';
const aspects = [
  { name: 'Artist', required: true, values: ['ABBA', 'Various', 'The Who'], mode: 'FREE_TEXT' },
  { name: 'Genre', required: false, values: ['Soul', 'Rock'], mode: 'SELECTION_ONLY' },
  { name: 'Format', required: true, values: ['CD', 'Vinyl'] },
];
test('already supplied category fields are not repeated as metadata rows', () => {
  expect(missingRequiredSpecifics(aspects, [{ name: ' artist ', value: 'Various' }]).map(row => row.name)).toEqual(['Format']);
});
test('optional metadata does not enter the main required-fields form', () => {
  expect(missingRequiredSpecifics(aspects, []).map(row => row.name)).toEqual(['Artist', 'Format']);
});
test('empty required values stay editable without a duplicate field', () => {
  expect(missingRequiredSpecifics(aspects, [{ name: 'Artist', value: '' }]).map(row => row.name)).toEqual(['Format']);
});
test('missing required fields are deduplicated case-insensitively', () => {
  expect(missingRequiredSpecifics([...aspects, { ...aspects[0], name: 'artist' }], []).length).toBe(2);
});
test('category field choices remain searchable, omit existing fields and prioritise required fields', () => {
  expect(availableSpecificFields(aspects, [{ name: 'Artist', value: 'Various' }], '')).toEqual(['Format', 'Genre']);
  expect(availableSpecificFields(aspects, [], 'gen')).toEqual(['Genre']);
});
test('large artist catalogues are bounded, never rendered as a joined paragraph', () => {
  const catalogue = { ...aspects[0], values: Array.from({ length: 5000 }, (_, index) => `Artist ${index}`) };
  const result = suggestedSpecificValues(catalogue, '');
  expect(result.values.length).toBe(SPECIFIC_PICKER_LIMIT);
  expect(result.hasMore).toBe(true);
  expect(suggestedSpecificValues(catalogue, 'Artist 4999')).toEqual({ values: ['Artist 4999'], hasMore: false });
});
test('suggestions preserve exact provider values without editing saved input', () => {
  const aspect = { ...aspects[0], values: [' Various ', 'various', 'ABBA'] };
  expect(suggestedSpecificValues(aspect, 'VAR').values).toEqual([' Various ']);
  expect(aspect.values).toEqual([' Various ', 'various', 'ABBA']);
});
test('absent suggestions safely return no choices', () => {
  expect(suggestedSpecificValues(undefined, '')).toEqual({ values: [], hasMore: false });
});
test('shared editor removes taxonomy dump while preserving save, validation and photo picker', () => {
  const editor = fs.readFileSync('app/ebay-listing-editor.tsx', 'utf8');
  expect(editor).toContain('<ListingItemSpecifics');
  expect(editor).not.toContain('aspect.values.join');
  expect(editor).not.toContain('Supported values:');
  expect(editor).not.toContain('Variation support:');
  expect(editor).not.toContain('Stable inventory ID:');
  expect(editor).toContain('editor.save()');
  expect(editor).toContain('editor.requirementsReady');
  expect(editor).toContain('<ListingPhotoManager');
  const component = fs.readFileSync('components/feature/ListingItemSpecifics.tsx', 'utf8');
  expect(component).toContain('FlatList');
  expect(component).toContain('Search item specific values');
  expect(component).not.toContain('cardinality');
  expect(component).not.toContain('variations');
});
