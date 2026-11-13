// Pure presentation and mocked persistence tests, not device or live eBay acceptance.
jest.mock('@/template', () => ({ getSupabaseClient: jest.fn() }));
jest.mock('../backendRequestService', () => ({ backendRead: jest.fn((_key: string, operation: (signal: AbortSignal) => unknown) => operation(new AbortController().signal)) }));
import fs from 'node:fs';
import { getSupabaseClient } from '@/template';
import { selectMainItemImage } from '../itemPhotoService';
import { SMART_STUDIO_VERSION, preferredListingPhotos, preferredStudioImage, availableListingPhotos, selectedListingPhotos, processedListingPhotoIssue, visibleCapturedPhotos, capturedPresentationUri, type StudioResult } from '@/shared/smartStudio';
import { backgroundEraseQuality } from './fixtures/backgroundEraseFixture';
import { PRODUCTION_NICHE_IDS } from '@/constants/niches';
const originals = ['https://example.test/front.jpg', 'https://example.test/back.jpg'];
const clean = ['https://example.test/front.png', 'https://example.test/back.png'];
const entry = (index: number): StudioResult => ({ version: SMART_STUDIO_VERSION, status: 'ready', originalUri: originals[index], enhancedUri: clean[index], confidence: 1, warnings: [], quality: backgroundEraseQuality });
const attrs = { _smart_studio_images: { front: entry(0), back: entry(1) } };
test.each(PRODUCTION_NICHE_IDS)('%s retains processed inventory while exposing both seller photo variants', () => {
 const media = Object.freeze([...originals]); const before = JSON.stringify(attrs);
 expect(preferredListingPhotos(media,attrs)).toEqual(clean);
 expect(availableListingPhotos(media,attrs)).toEqual([originals[0],clean[0],originals[1],clean[1]]);
 expect(preferredStudioImage(media,attrs)).toBe(clean[0]);
 expect(media).toEqual(originals); expect(JSON.stringify(attrs)).toBe(before);
});
test('partial processing hides every original, including an unprocessed original cover', () => {
 const partial = { _smart_studio_images: { back: entry(1) } };
 expect(preferredListingPhotos(originals,partial)).toEqual([clean[1]]);
 expect(preferredStudioImage(originals,partial)).toBe(clean[1]);
 expect(availableListingPhotos(originals,partial)).toContain(originals[0]);
});
test('fallback uses originals only when no accepted processed photo exists', () => {
 expect(preferredListingPhotos(originals,{})).toEqual(originals);
 for (const patch of [{ status:'review' }, { version:'legacy' }, { originalUri:'https://foreign.test/item.jpg' }, { enhancedUri:'file://unpersisted.png' }]) {
  expect(preferredListingPhotos(originals,{ _smart_studio_images:{ front:{ ...entry(0),...patch } } })).toEqual(originals);
 }
});
test('mixed arrays never duplicate photos or expose masks and derivative references', () => {
 const metadata = { _smart_studio_images:{ front:{ ...entry(0),maskUri:'https://example.test/mask.png' } } };
 expect(preferredListingPhotos([originals[0],clean[0],originals[1],clean[0],'https://example.test/mask.png'],metadata)).toEqual([clean[0]]);
});
test('explicit seller selections preserve originals, order and empty choices', () => {
 expect(selectedListingPhotos(originals,attrs,[originals[1],originals[0]])).toEqual([originals[1],originals[0]]);
 expect(selectedListingPhotos(originals,attrs,[])).toEqual([]);
 expect(selectedListingPhotos(originals,attrs,['https://foreign.test/image.jpg'])).toEqual(['https://foreign.test/image.jpg']);
 expect(selectedListingPhotos(originals,{ _smart_studio_images:{ back:entry(1) } },[originals[0]])).toEqual([originals[0]]);
});
test('seller photo subsets are allowed while foreign variants remain blocked', () => {
 const metadata = { ...attrs, _photo_pipeline:{ expected: originals.map(url => ({ url })) } };
 expect(processedListingPhotoIssue(originals,metadata,clean)).toBeNull();
 expect(processedListingPhotoIssue(originals,metadata,[clean[0]])).toBeNull();
 expect(processedListingPhotoIssue(originals,{ ...metadata,_smart_studio_images:{ front:entry(0) } },[clean[0]])).toBeNull();
 expect(processedListingPhotoIssue(originals,metadata,['https://foreign.test/x.jpg'])).toMatch(/attached/);
});
test('capture keeps every view visible while preferring each available processed preview', () => {
 const photos = [{ uri:originals[0],studio:entry(0) },{ uri:originals[1] }];
 expect(visibleCapturedPhotos(photos)).toEqual(photos);
 expect(capturedPresentationUri(visibleCapturedPhotos(photos)[1])).toBe(originals[1]);
 expect(capturedPresentationUri(visibleCapturedPhotos(photos)[0])).toBe(clean[0]);
 expect(photos[0].uri).toBe(originals[0]); expect(photos).toHaveLength(2);
 expect(visibleCapturedPhotos([{ uri:originals[1] }])).toEqual([{ uri:originals[1] }]);
});
test('processed cover selection reorders retained sources without deleting originals or publishing', async () => {
 const row = { id:'item',tenant_id:'tenant',specialist_id:'collectibles',media:originals,attributes:{ ...attrs,ebay_listing_media:originals },updated_at:'v1' };
 const read:any = {}; const write:any = {};
 for (const q of [read,write]) for (const method of ['select','eq','in','update']) q[method] = jest.fn(() => q);
 read.abortSignal = jest.fn(() => read); read.single = jest.fn().mockResolvedValue({ data:row,error:null });
 const nextAttrs = row.attributes;
 write.abortSignal = jest.fn(() => write); write.maybeSingle = jest.fn().mockResolvedValue({ data:{ ...row,media:[originals[1],originals[0]],attributes:nextAttrs },error:null });
 (getSupabaseClient as jest.Mock).mockReturnValue({ from:jest.fn().mockReturnValueOnce(read).mockReturnValue(write) });
 const result = await selectMainItemImage('tenant','collectibles','item',clean[1],originals);
 expect(result.error).toBeNull();
 expect(write.update).toHaveBeenCalledWith({ media:[originals[1],originals[0]] });
 expect(write.eq).toHaveBeenCalledWith('tenant_id','tenant'); expect(write.eq).toHaveBeenCalledWith('updated_at','v1');
 expect(result.item?.media).toHaveLength(2);
});
test('UI has no original-comparison toggles and server applies the same selection policy', () => {
 const gallery = fs.readFileSync('components/feature/ItemPhotoGallery.tsx','utf8');
 const controls = fs.readFileSync('components/feature/ExistingPhotoStudioControls.tsx','utf8');
 expect(gallery).toContain('inventoryGalleryPhotos(originalMedia, attributes)');
 expect(gallery).not.toContain('setOriginalView'); expect(controls).not.toContain('setShowOriginal');
 const server = fs.readFileSync('supabase/functions/swish-ebay-list/index.ts','utf8');
 expect(server).toContain('selectedListingPhotos(originalMedia,attrs');
 expect(server).toContain('processedListingPhotoIssue'); expect(server).toContain('verifyPresentationPhotos');
 expect(fs.readFileSync('shared/smartStudio.ts','utf8')).toBe(fs.readFileSync('supabase/functions/_shared/smartStudio.ts','utf8'));
});
