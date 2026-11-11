// The only capture -> existing item-images -> canonical media/role persistence pipeline.
// Metadata retries never replay an upload, identification, valuation or marketplace write.
import { getSupabaseClient } from '@/template';
import { recordPrevention } from './performanceMonitoringService';
import type { CapturedImage } from './aiIdentificationService';
import { verifyStoredOriginal } from './originalImageService';
import { uploadCapturedPhoto } from './captureUploadService';
import { prepareCapturedImages } from './sharedImagePreparationService';
import { resolveProductionNiche } from './nicheRouting';
import { PHOTO_PIPELINE_VERSION, photoRoleId, mergePhotoAssets, photoPersistenceIssue, type PhotoAsset, type PhotoExpectation } from '@/shared/photoPersistence';
import { shouldAutoRemoveBackground, studioImageIsUsable } from '@/shared/smartStudio';
export interface PersistedCapturePhotos { urls: string[]; images: CapturedImage[]; errors: string[]; complete: boolean }
export interface PersistPhotoOptions { processImages?: boolean; appendOnly?: boolean; isCurrent?: () => boolean }
function assertCurrent(isCurrent?: () => boolean) { if (isCurrent && !isCurrent()) throw new Error('Workspace changed. Reopen the original item before retrying photos.'); }
const flights = new Map<string, Promise<PersistedCapturePhotos>>();
// PostgreSQL jsonb does not preserve object-key order. Compare semantic values.
function normalized(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalized);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([,entry]) => entry !== undefined).sort(([a],[b]) => a.localeCompare(b)).map(([key,entry]) => [key,normalized(entry)]));
  return value;
}
const jsonSame = (left: unknown, right: unknown): boolean => JSON.stringify(normalized(left)) === JSON.stringify(normalized(right));
async function readRow(tenantId: string, itemId: string) {
  const result = await getSupabaseClient().from('items').select('id,tenant_id,specialist_id,media,attributes,updated_at').eq('id', itemId).eq('tenant_id', tenantId).maybeSingle();
  if (result.error || !result.data || result.data.tenant_id !== tenantId || !resolveProductionNiche(result.data.specialist_id) || !result.data.updated_at) throw new Error(result.error?.message ?? 'Inventory ownership/version could not be verified for photo persistence.');
  return result.data;
}
/** Merge fresh metadata with CAS; never replace existing media or seller listing selections. */
async function commit(tenantId: string, itemId: string, assets: PhotoAsset[], expected: PhotoExpectation[] | null, images: readonly CapturedImage[], expectedUpdatedAt?: string, initialRow?: Awaited<ReturnType<typeof readRow>>, isCurrent?: () => boolean) {
  for (let attempt = 0; attempt < 3; attempt++) {
    assertCurrent(isCurrent);
    const row = attempt === 0 && initialRow ? initialRow : await readRow(tenantId, itemId);
    let check = row;
    if (expectedUpdatedAt && row.updated_at !== expectedUpdatedAt) throw new Error('Item changed during photo recovery. Reload before retrying.');
    const media: string[] = [...new Set([...(row.media ?? []), ...assets.map(asset => asset.url)])];
    const attributes = { ...(row.attributes ?? {}) };
    const oldAssets: PhotoAsset[] = Array.isArray(attributes._photo_assets) ? attributes._photo_assets : [];
    const linked = mergePhotoAssets(oldAssets, assets);
    if (assets.length) attributes._photo_assets = linked;
    if (expected) {
      const requirements = new Map<string, PhotoExpectation>();
      for (const entry of (Array.isArray(attributes._photo_pipeline?.expected) ? attributes._photo_pipeline.expected : [])) requirements.set(entry.slotId, entry);
      for (const entry of expected) requirements.set(entry.slotId, entry);
      const required = [...requirements.values()];
      attributes._photo_pipeline = { version: PHOTO_PIPELINE_VERSION, status: required.length && required.every(entry => entry.url && media.includes(entry.url)) ? 'complete' : 'retry_required', expected: required };
    }
    const studio = { ...(attributes._smart_studio_images ?? {}) };
    for (const image of images) if (image.originalStorageUri && media.includes(image.originalStorageUri) && studioImageIsUsable(image.studio)) studio[image.slotId] = { ...image.studio!, originalUri: image.originalStorageUri };
    if (Object.keys(studio).length) attributes._smart_studio_images = studio;
    if (!jsonSame(row.media ?? [], media) || !jsonSame(row.attributes ?? {}, attributes)) {
      assertCurrent(isCurrent);
      const saved = await getSupabaseClient().from('items').update({ media, attributes }).eq('id', itemId).eq('tenant_id', tenantId).eq('updated_at', row.updated_at).select('id,tenant_id,specialist_id,media,attributes,updated_at').maybeSingle();
      if (saved.error) throw new Error(`Photographs could not be linked to inventory: ${saved.error.message}`);
      if (!saved.data) { if (!expectedUpdatedAt && attempt < 2) continue; throw new Error('Item changed or access was denied. Reload and retry photos on this item.'); }
      // UPDATE RETURNING is server readback, including trigger-preserved media and attributes.
      if(saved.data.id!==itemId||saved.data.tenant_id!==tenantId||!saved.data.updated_at)throw new Error('Photo association ownership/readback was not confirmed.');
      check=saved.data;
    }
    if (assets.some(asset => !check.media?.includes(asset.url) || !check.attributes?._photo_assets?.some((entry: PhotoAsset) => entry.url === asset.url && entry.slotId === asset.slotId && (!asset.hash || asset.hash === entry.hash)))) throw new Error('Persisted original photo references/roles could not be confirmed. Retry this saved item.');
    if (expected && !jsonSame(check.attributes?._photo_pipeline, attributes._photo_pipeline)) throw new Error('Photo completeness readback could not be confirmed. Reload the saved item.');
    for (const image of images) if (image.originalStorageUri && studioImageIsUsable(image.studio) && check.attributes?._smart_studio_images?.[image.slotId]?.enhancedUri !== image.studio?.enhancedUri) throw new Error('Processed photo association could not be confirmed. Originals are retained.');
    return check;
  }
  throw new Error('Inventory changed repeatedly. Reload before linking photos.');
}
export async function linkPersistedItemPhotos(tenantId: string, itemId: string, urls: string[], expectedUpdatedAt?: string): Promise<void> {
  if (!tenantId?.trim() || !itemId?.trim()) throw new Error('Item and tenant are required to save photographs.');
  if (!Array.isArray(urls) || urls.some(url => typeof url !== 'string' || !url.startsWith('https://'))) throw new Error('Upload original photographs before linking them to inventory.');
  const assets = [...new Set(urls)].map((url, index) => ({ url, slotId: `legacy_${index + 1}`, slotLabel: `Stored photo ${index + 1}` }));
  const row = await readRow(tenantId, itemId);
  const fresh = assets.filter(asset => !row.attributes?._photo_assets?.some((entry: PhotoAsset) => entry.url === asset.url));
  const check = await commit(tenantId, itemId, fresh, null, [], expectedUpdatedAt, row);
  if (urls.some(url => !check.media?.includes(url))) throw new Error('Canonical photo links could not be confirmed after saving.');
}
async function persist(tenantId: string, itemId: string, source: CapturedImage[], processImages: boolean, options: PersistPhotoOptions): Promise<PersistedCapturePhotos> {
  const errors: string[] = [];const usedRoles = new Set<string>();
  const originals = source.map((image,index) => {
    const base = photoRoleId(image.slotId);let role = base;
    // Legacy galleries may reuse a generic detail/photo role. Keep all views under stable distinct IDs.
    if (usedRoles.has(role)) role = `${base.slice(0,32)}_${index + 1}`;
    while (usedRoles.has(role)) role = `${role.slice(0,35)}_next`;
    usedRoles.add(role);return { ...image, slotId: role };
  });
  try {
    assertCurrent(options.isCurrent);
    const row = await readRow(tenantId, itemId);
    assertCurrent(options.isCurrent);
    if (!originals.length) throw new Error('Capture original photographs before saving photo references.');
    // Finish/reuse cleanup before linking photos. Identification always uses image.uri, not the cutout.
    if (processImages && shouldAutoRemoveBackground(resolveProductionNiche(row.specialist_id) ?? undefined)) {
      const prepared = await prepareCapturedImages(originals, { tenantId, nicheId: resolveProductionNiche(row.specialist_id) ?? undefined });
      prepared.forEach((image, index) => { originals[index] = image; Object.assign(source[index], image); });
    }
    // Optional lifetime gallery evidence must never alter required capture completeness.
    if (!options.appendOnly) await commit(tenantId, itemId, [], originals.map(image => ({ slotId: image.slotId, slotLabel: image.slotLabel, ...(image.originalStorageUri && row.media?.includes(image.originalStorageUri) ? { url: image.originalStorageUri } : {}) })), [], undefined, row, options.isCurrent);
    // Two independent immutable uploads at a time: bound native memory while hiding network latency.
    let nextIndex = 0;
    const uploadWorker = async () => { for (;;) {
      const index = nextIndex++; if (index >= originals.length) return;
      const image = originals[index];
      try {
        assertCurrent(options.isCurrent);
        let saved: { url: string; hash?: string };
        const cached = image.originalStorageUri;
        if (cached && image.originalByteHash) {
          const path = decodeURIComponent(cached.split('/item-images/')[1] ?? '');
          const root = `${itemId}/originals/${image.slotId}_${image.originalByteHash}.`;
          const canonicalUrl = getSupabaseClient().storage.from('item-images').getPublicUrl(path).data?.publicUrl;
          if (!path.startsWith(root) || !/\.(jpg|jpeg|png|webp|gif)$/i.test(path) || canonicalUrl !== cached) throw new Error('Retained original belongs to another item, storage bucket or capture role.');
          await verifyStoredOriginal(path, image.originalByteHash);
          saved = { url: cached, hash: image.originalByteHash };
        } else saved = await uploadCapturedPhoto(itemId, image);
        originals[index] = { ...image, originalStorageUri: saved.url, originalByteHash: saved.hash };
        Object.assign(source[index], originals[index]);
      } catch (cause) {
        originals[index] = { ...image, originalStorageUri: undefined, originalByteHash: undefined };
        errors.push(`${image.slotLabel}: ${cause instanceof Error ? cause.message : 'Original upload failed.'}`);
      }
    } };
    await Promise.all(Array.from({length:Math.min(2,originals.length)},()=>uploadWorker()));
    const assets = originals.filter(image => image.originalStorageUri).map(image => ({ slotId: image.slotId, slotLabel: image.slotLabel, url: image.originalStorageUri!, ...(image.originalByteHash ? { hash: image.originalByteHash } : {}), ...(image.uploadCopy ? { uploadCopy: { kind: image.uploadCopy.kind, sourceHash: image.uploadCopy.sourceHash, dpi: image.uploadCopy.dpi, width: image.uploadCopy.width, height: image.uploadCopy.height } } : {}) }));
    const expected = originals.map(image => ({ slotId: image.slotId, slotLabel: image.slotLabel, ...(image.originalStorageUri ? { url: image.originalStorageUri } : {}) }));
    assertCurrent(options.isCurrent);
    // Re-read after the checkpoint write: its updated_at is no longer the initial row version.
    const check=await commit(tenantId, itemId, assets, options.appendOnly ? null : expected, originals, undefined, undefined, options.isCurrent);
    const issue = options.appendOnly ? null : photoPersistenceIssue(check.media ?? [], check.attributes ?? {});
    if (issue && !errors.length) errors.push(issue);
    return { urls: originals.filter(image => image.originalStorageUri).map(image => image.originalStorageUri!), images: originals, errors, complete: !errors.length && !issue };
  } catch (cause) {
    errors.push(cause instanceof Error ? cause.message : 'Photo persistence failed. Retained originals and identification are unchanged.');
    return { urls: originals.filter(image => image.originalStorageUri).map(image => image.originalStorageUri!), images: originals, errors, complete: false };
  }
}
export function persistCapturedItemPhotos(tenantId: string, itemId: string, images: CapturedImage[], options: PersistPhotoOptions = {}): Promise<PersistedCapturePhotos> {
  const key = `${tenantId}:${itemId}:${options.processImages !== false}:${options.appendOnly === true}:${JSON.stringify(images.map(image => [image.slotId, image.uri]))}`;
  const existing = flights.get(key); if (existing) { recordPrevention('photo_flight'); return existing; }
  const pending = persist(tenantId, itemId, images, options.processImages !== false, options).finally(() => { if (flights.get(key) === pending) flights.delete(key); });
  flights.set(key, pending); return pending;
}
