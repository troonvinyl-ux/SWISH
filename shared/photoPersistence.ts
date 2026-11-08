// Shared persisted-photo contract. No React, storage clients or temporary image state.
export const PHOTO_PIPELINE_VERSION = 'canonical-photos-v1';
// A cloud archive copy is not a byte-identical full-resolution original. No local URI is persisted.
export interface PhotoAsset { slotId: string; slotLabel: string; url: string; hash?: string; uploadCopy?: { kind: 'compressed_capture_copy'; sourceHash: string; dpi: 72; width: number; height: number } }
export interface PhotoExpectation { slotId: string; slotLabel: string; url?: string }
export function photoRoleId(value: string): string { return value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40) || 'photo'; }
export function mergePhotoAssets(previous: readonly PhotoAsset[], incoming: readonly PhotoAsset[]): PhotoAsset[] {
  const result = [...previous];
  for (const asset of incoming) {
    const index = result.findIndex(row => row.slotId === asset.slotId && row.url === asset.url);
    if (index < 0) result.push(asset); else result[index] = { ...result[index], ...asset };
  }
  return result;
}
/** Publication must use canonical media, never the capture-screen image count. */
export function photoPersistenceIssue(media: readonly string[], attributes: Record<string, any>): string | null {
  if (!Array.isArray(media) || !media.length || media.some(url => typeof url !== 'string' || !/^https:\/\//i.test(url))) return 'Save original photographs to this inventory item before preparing or publishing its listing.';
  const pipeline = attributes?._photo_pipeline;
  if (!pipeline) return null; // Existing persisted legacy/eBay images remain supported.
  if (pipeline.version !== PHOTO_PIPELINE_VERSION || pipeline.status !== 'complete' || !Array.isArray(pipeline.expected) || !pipeline.expected.length) return 'Original photo persistence is incomplete. Retry photos on the saved inventory item; identification is retained.';
  if (pipeline.expected.some((entry: PhotoExpectation) => !entry.url || !media.includes(entry.url))) return 'A required captured view is not linked to canonical inventory. Retry the saved item before listing.';
  return null;
}
