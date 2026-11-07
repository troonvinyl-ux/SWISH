// Pure Edge photo-selection regressions. No database writes or provider requests.
import { availableListingPhotos, preferredListingPhotos, preferredStudioImage, selectedListingPhotos, processedListingPhotoIssue, SMART_STUDIO_VERSION, type StudioResult } from '../functions/_shared/smartStudio.ts';
const original = 'https://example.test/front.jpg';
const rear = 'https://example.test/rear.jpg';
const processed = 'https://example.test/front.png';
const entry: StudioResult = {
 version: SMART_STUDIO_VERSION, status: 'ready', originalUri: original, enhancedUri: processed,
 confidence: 1, warnings: [], quality: {
  sourcePixelsOnly: true, completeness: 'reviewed', boundary: 'reviewed', detailCheck: 'unchanged', background: 'transparent',
  method: 'backgrounderase', provider: 'BackgroundErase',
  checks: { validPng: true, dimensionsUnchanged: true, foregroundPresent: true, transparencyPresent: true },
 },
};
const attributes = { _smart_studio_images: { front: entry } };
function equal(actual: unknown, expected: unknown): void {
 if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Unexpected photo selection: ${JSON.stringify(actual)}`);
}
Deno.test('Edge presentation hides every original once one validated processed photo is ready', () => {
 const media = Object.freeze([rear,original]);
 equal(preferredListingPhotos(media,attributes),[processed]);
 equal(availableListingPhotos(media,attributes),[processed]);
 equal(preferredStudioImage(media,attributes),processed);
 equal(media,[rear,original]);
});
Deno.test('Edge upgrades old selections but preserves empty selections and unknown URL rejection', () => {
 equal(selectedListingPhotos([original,rear],attributes,[original,rear]),[processed]);
 equal(selectedListingPhotos([original,rear],attributes,[]),[]);
 equal(selectedListingPhotos([original],attributes,['https://foreign.test/image.jpg']),['https://foreign.test/image.jpg']);
});
Deno.test('originals remain fallback before successful processing; provenance checks are not relaxed', () => {
 equal(preferredListingPhotos([original,rear],{}),[original,rear]);
 equal(preferredListingPhotos([original],{ _smart_studio_images:{ front:{ ...entry,status:'review' } } }),[original]);
 equal(preferredListingPhotos([original],{ _smart_studio_images:{ front:{ ...entry,quality:{ ...entry.quality,checks:{ ...entry.quality.checks,foregroundPresent:false } } } } }),[original]);
});
Deno.test('a partially processed evidence set cannot publish by adding archived originals', () => {
 const scoped = { ...attributes,_photo_pipeline:{ expected:[{ url:original },{ url:rear }] } };
 const issue = processedListingPhotoIssue([original,rear],scoped,[processed]);
 if (!issue?.includes('every captured')) throw new Error('Missing processed evidence was not blocked.');
 equal(processedListingPhotoIssue([original],{ ...attributes,_photo_pipeline:{ expected:[{ url:original }] } },[processed]),null);
});
