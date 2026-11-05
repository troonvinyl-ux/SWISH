import { getSupabaseClient } from '@/template';
import { mapItem, type Item } from './itemService';
import { getProductionNicheSpecialistIds } from './nicheRouting';
import { backendRead } from './backendRequestService';

/** The first stored media URL is the canonical cover for inventory and listing payloads. */
export function moveMainImageFirst(media: readonly string[], selectedUrl: string): string[] {
  const index = media.indexOf(selectedUrl);
  if (index < 0) throw new Error('Select a photo already attached to this item.');
  // Preserve every other photo, including its original relative order.
  return [media[index], ...media.slice(0, index), ...media.slice(index + 1)];
}
export function mediaOrderMatches(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((url, index) => url === right[index]);
}
export async function selectMainItemImage(tenantId: string, nicheId: string, itemId: string, selectedUrl: string, expectedMedia: readonly string[]): Promise<{ item: Item | null; error: string | null }> {
  const specialists = getProductionNicheSpecialistIds(nicheId);
  if (!tenantId || !itemId || !specialists.length) return { item: null, error: 'A verified item and niche workspace are required.' };
  try {
    moveMainImageFirst(expectedMedia, selectedUrl);
    const client = getSupabaseClient();
    const { data: row } = await backendRead(`main-photo:${tenantId}:${nicheId}:${itemId}`, signal => client.from('items').select('*').eq('id', itemId).eq('tenant_id', tenantId).in('specialist_id', specialists).single().abortSignal(signal));
    if (!row || row.tenant_id !== tenantId || !specialists.includes(row.specialist_id)) throw new Error('This item is not available in the current workspace.');
    if (!mediaOrderMatches(row.media ?? [], expectedMedia)) throw new Error('Photos changed since this page loaded. Reload the item before choosing its main image.');
    const media = moveMainImageFirst(row.media ?? [], selectedUrl);
    const listingSelection = Array.isArray(row.attributes?.ebay_listing_media)
      ? row.attributes.ebay_listing_media.filter((url: unknown): url is string => typeof url === 'string' && media.includes(url)) as string[]
      : null;
    // Respect the seller's other selected listing photos; include the newly chosen cover first.
    const listingMedia = listingSelection ? moveMainImageFirst(listingSelection.includes(selectedUrl) ? listingSelection : [...listingSelection, selectedUrl], selectedUrl) : null;
    if (listingMedia && listingMedia.length > 12) throw new Error('The listing already has 12 selected photos. Deselect one in the listing editor before adding a different main photo.');
    const listingChanged = listingMedia !== null && !mediaOrderMatches(listingMedia, row.attributes.ebay_listing_media);
    if (mediaOrderMatches(media, row.media ?? []) && !listingChanged) return { item: mapItem(row), error: null };
    if (!row.updated_at) throw new Error('The item version is unavailable. Reload before changing its photos.');
    // A single tenant/niche/version-constrained write; no mutation replay, new table or RLS bypass.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const { data, error } = await client.from('items').update({ media, ...(listingMedia ? { attributes: { ...row.attributes, ebay_listing_media: listingMedia } } : {}) }).eq('id', itemId).eq('tenant_id', tenantId).in('specialist_id', specialists).eq('updated_at', row.updated_at).select('*').maybeSingle().abortSignal(controller.signal);
      if (error) throw new Error(error.message);
      if (!data) throw new Error('The item changed or access was denied. Reload before trying again.');
      if (!mediaOrderMatches(data.media ?? [], media) || (listingMedia && !mediaOrderMatches(data.attributes?.ebay_listing_media ?? [], listingMedia))) throw new Error('The saved photo order could not be confirmed. Reload the item.');
      return { item: mapItem(data), error: null };
    } finally { clearTimeout(timer); }
  } catch (cause) { return { item: null, error: cause instanceof Error ? cause.message : 'The main image could not be saved. Reload to confirm its current order before retrying.' }; }
}
