// Lifetime inventory evidence. The existing photo pipeline/RLS owns all storage writes.
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';
import { captureFromCamera, type CapturedImage } from './aiIdentificationService';
import { getItem, type Item } from './itemService';
import { persistCapturedItemPhotos } from './photoPersistenceService';
import { resolveProductionNiche } from './nicheRouting';
import { shouldAutoRemoveBackground, originalListingPhotos, processedItemPhotos, studioForOriginal } from '@/shared/smartStudio';
export type GalleryPhotoSource = 'camera' | 'library';
export interface InventoryGalleryScope { tenantId: string; nicheId: string; itemId: string }
export const GALLERY_BATCH_LIMIT = 8;
const assertCurrent = (isCurrent: () => boolean) => { if (!isCurrent()) throw new Error('Workspace changed. Reopen this item before adding photos.'); };
/** Prefer a verified cutout for each view, but never hide a newly added, unprocessed view. */
export function inventoryGalleryPhotos(media: readonly string[], attributes: Record<string, any>): string[] {
  return [...new Set([
    ...originalListingPhotos(media, attributes).map(uri => studioForOriginal(uri, attributes)?.enhancedUri ?? uri),
    ...processedItemPhotos(media, attributes),
  ])];
}
export async function readInventoryGalleryItem(scope: InventoryGalleryScope, isCurrent: () => boolean): Promise<Item> {
  assertCurrent(isCurrent);
  if (!scope.tenantId || !scope.itemId || !resolveProductionNiche(scope.nicheId)) throw new Error('Open a verified inventory item and niche first.');
  const result = await getItem(scope.itemId);
  assertCurrent(isCurrent);
  if (result.error || !result.item || result.item.id !== scope.itemId || result.item.tenantId !== scope.tenantId || resolveProductionNiche(result.item.specialistId) !== scope.nicheId) throw new Error(result.error ?? 'Photo access is unavailable in this account and niche.');
  // No status restriction: draft, live, sold and archived records all accept evidence.
  return result.item;
}
export async function chooseInventoryGalleryPhotos(scope: InventoryGalleryScope, source: GalleryPhotoSource, isCurrent: () => boolean): Promise<CapturedImage[]> {
  await readInventoryGalleryItem(scope, isCurrent);
  const batch = `gallery_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  if (source === 'camera') {
    const photo = await captureFromCamera();
    if (!photo || !isCurrent()) return [];
    return [{ ...photo, slotId: `${batch}_1`, slotLabel: 'Additional item photo' }];
  }
  if (Platform.OS !== 'web') {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) throw new Error('Photo library access is required. Allow it in device settings or take a photo.');
  }
  assertCurrent(isCurrent);
  const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsMultipleSelection: true, selectionLimit: GALLERY_BATCH_LIMIT, allowsEditing: false, quality: 1, base64: false, exif: false });
  if (picked.canceled || !isCurrent()) return [];
  if ((picked.assets?.length ?? 0) > GALLERY_BATCH_LIMIT) throw new Error(`Select up to ${GALLERY_BATCH_LIMIT} photos at a time. You can add more in another batch.`);
  return (picked.assets ?? []).map((asset, index) => ({ uri: asset.uri, width: asset.width, height: asset.height, slotId: `${batch}_${index + 1}`, slotLabel: `Additional item photo ${index + 1}` }));
}
export async function appendInventoryGalleryPhotos(scope: InventoryGalleryScope, photos: CapturedImage[], isCurrent: () => boolean): Promise<Item> {
  if (!photos.length || photos.length > GALLERY_BATCH_LIMIT) throw new Error(`Choose 1–${GALLERY_BATCH_LIMIT} photographs.`);
  await readInventoryGalleryItem(scope, isCurrent);
  // Mutates retained upload receipts on photos so same-item retries reuse verified objects.
  const saved = await persistCapturedItemPhotos(scope.tenantId, scope.itemId, photos, { processImages: shouldAutoRemoveBackground(scope.nicheId), appendOnly: true, isCurrent });
  assertCurrent(isCurrent);
  if (!saved.complete || saved.urls.length !== photos.length) throw new Error(saved.errors.join(' ') || 'Some photos could not be confirmed. Retry these photos on this item.');
  const item = await readInventoryGalleryItem(scope, isCurrent);
  if (saved.urls.some(url => !item.media.includes(url))) throw new Error('Gallery readback is pending. Retry these photos; no duplicate item will be created.');
  return item;
}
