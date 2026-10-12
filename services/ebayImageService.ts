// SWISH — Canonical eBay Image Service
//
// Single shared service used by ALL screens:
//   Settings (Data & Sync), Inventory (pull-to-refresh), AppContext
//
// Calls swish-image-download edge function which implements the ONE canonical
// image pipeline (v3):
//   eBay URL → download ALL images → validate → upload Storage → verify →
//   permanent URL → items.media + _ebay_img_count stored in attributes
//
// KEY FIX in v3:
//   - itemNeedsImages() now reads _ebay_img_count from item attributes
//   - An item is only "complete" if ALL eBay images have permanent Storage URLs
//   - Items with 1/8 stored are now correctly detected as PARTIAL
//   - tenantNeedsImageSync() / countItemsNeedingImageSync() use attributes too
//
// RULES:
//   - isPermanentImageUrl()  — only Supabase/OnSpace Storage URLs count
//   - isEbayCdnUrl()         — never treated as stored
//   - itemNeedsImages()      — checks ALL images + known remote count
//   - tenantNeedsImageSync() — scans ALL items, never a 20-item sample

import { getSupabaseClient } from '@/template';

export interface ImageFetchProgress {
  phase: 'idle' | 'running' | 'done' | 'error';
  current: number;
  total: number;
  imagesDownloaded: number;
  imagesAlreadyStored: number;
  imagesFailed: number;
  imagesNotFound: number;
  authFailures: number;
  titlesFixed: number;
  requiresReauth: boolean;
  errorMsg?: string;
  itemsComplete?: number;
  itemsPartial?: number;
  itemsFailed?: number;
  imagesSkipped?: number;
}

export type ImageFetchProgressCallback = (p: ImageFetchProgress) => void;

/**
 * True ONLY if the URL is permanently stored in Supabase/OnSpace Storage.
 * eBay CDN URLs are explicitly NOT permanent.
 */
export function isPermanentImageUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  return (url.includes('supabase') && url.includes('storage')) ||
         (url.includes('onspace') && url.includes('storage'));
}

/**
 * True if the URL is an eBay CDN URL (temporary, not permanently stored).
 */
export function isEbayCdnUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  return url.includes('ebayimg.com') ||
         url.includes('thumbs.ebaystatic.com') ||
         url.includes('i.ebayimg.com') ||
         url.includes('p.ebayimg.com');
}

/**
 * Returns true if an item's media array is incomplete and needs image fetching.
 *
 * CRITICAL FIX (v3): An item is NOT complete merely because some permanent URLs exist.
 * The _ebay_img_count attribute records how many images eBay has. If stored < remote,
 * the item is PARTIAL and needs the missing images downloaded.
 *
 * Without this check, items with 1/8 permanent URLs looked "complete" to the bulk
 * scan because all existing URLs passed the permanence check — the issue causing
 * all listings to show only ONE image after a partial sync.
 *
 * @param media       - items.media array
 * @param attributes  - items.attributes (optional, used to read _ebay_img_count)
 */
export function itemNeedsImages(media: string[], attributes?: Record<string, any> | null): boolean {
  if (!media || media.length === 0) return true;

  // Any CDN URL = incomplete (existing bad data to repair)
  if (media.some(u => isEbayCdnUrl(u))) return true;

  // Any non-permanent URL = incomplete
  if (media.some(u => u && typeof u === 'string' && !isPermanentImageUrl(u))) return true;

  // Check stored count against known eBay remote count
  const knownEbayCount = typeof attributes?._ebay_img_count === 'number'
    ? (attributes._ebay_img_count as number)
    : null;

  if (knownEbayCount !== null) {
    const permanentCount = media.filter(u => isPermanentImageUrl(u)).length;
    // If we know eBay had N images and we only have M < N stored, partial sync
    if (permanentCount < knownEbayCount) return true;
  } else {
    // No _ebay_img_count yet (pre-v3 items).
    // Be conservative: include items with ≤ 4 permanent images for re-verification.
    // Most eBay listings have multiple photos, so 1-4 permanent might be partial.
    const permanentCount = media.filter(u => isPermanentImageUrl(u)).length;
    if (permanentCount > 0 && permanentCount <= 4) return true;
  }

  return false;
}

/**
 * Fetch and permanently store eBay images for all (or specific) items.
 *
 * Uses the ONE canonical swish-image-download pipeline:
 *   eBay URL → download ALL → validate → upload → verify → permanent URL → DB
 *
 * After successful sync, edge function stores _ebay_img_count in items.attributes
 * so future itemNeedsImages() calls can detect partial image sets correctly.
 */
export async function fetchAndStoreEbayImages(
  tenantId: string,
  options: {
    itemIds?: string[];
    fixTitles?: boolean;
    onProgress?: ImageFetchProgressCallback;
  } = {},
): Promise<ImageFetchProgress> {
  const { itemIds, fixTitles = true, onProgress } = options;
  const supabase = getSupabaseClient();

  const progress: ImageFetchProgress = {
    phase: 'running',
    current: 0,
    total: 0,
    imagesDownloaded: 0,
    imagesAlreadyStored: 0,
    imagesFailed: 0,
    imagesNotFound: 0,
    authFailures: 0,
    titlesFixed: 0,
    requiresReauth: false,
  };

  onProgress?.({ ...progress });

  try {
    const body: any = { tenantId, fixTitles };
    if (itemIds && itemIds.length > 0) body.itemIds = itemIds;

    const { data, error } = await supabase.functions.invoke('swish-image-download', { body });

    if (error) {
      let msg = error.message ?? 'Unknown error';
      try {
        const text = await (error as any).context?.text?.();
        if (text) {
          try { const parsed = JSON.parse(text); msg = parsed.error ?? text; } catch { msg = text; }
        }
      } catch {}
      const isReauth = msg.includes('re-authoris') || msg.includes('requiresReauth') || msg.includes('401');
      const result: ImageFetchProgress = { ...progress, phase: 'error', requiresReauth: isReauth, errorMsg: msg };
      onProgress?.(result);
      return result;
    }

    const result: ImageFetchProgress = {
      phase: 'done',
      current:             data?.processed          ?? 0,
      total:               data?.processed          ?? 0,
      imagesDownloaded:    data?.imagesDownloaded    ?? 0,
      imagesAlreadyStored: data?.imagesAlreadyStored ?? 0,
      imagesFailed:        data?.imagesFailed        ?? 0,
      imagesNotFound:      data?.imagesNotFound      ?? 0,
      authFailures:        data?.authFailures        ?? 0,
      titlesFixed:         data?.titlesFixed         ?? 0,
      requiresReauth:      data?.requiresReauth      ?? false,
      itemsComplete:       data?.itemsComplete       ?? 0,
      itemsPartial:        data?.itemsPartial        ?? 0,
      itemsFailed:         data?.itemsFailed         ?? 0,
      imagesSkipped:       data?.imagesSkipped       ?? 0,
    };
    onProgress?.(result);
    return result;
  } catch (e: any) {
    const result: ImageFetchProgress = {
      ...progress,
      phase: 'error',
      errorMsg: e?.message ?? 'Failed to run image sync',
    };
    onProgress?.(result);
    return result;
  }
}

/**
 * Determines whether the tenant has items that genuinely need image synchronisation.
 *
 * Scans ALL items (paginated, no sample limit).
 * Returns true if ANY item needs work per the updated itemNeedsImages() rules,
 * which now includes partial-sync detection via _ebay_img_count.
 */
export async function tenantNeedsImageSync(tenantId: string): Promise<boolean> {
  const supabase = getSupabaseClient();
  const PAGE_SIZE = 200;
  let page = 0;

  while (true) {
    const { data: pageData, error } = await supabase
      .from('items')
      .select('id, media, attributes')
      .eq('tenant_id', tenantId)
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (error) break;
    if (!pageData || pageData.length === 0) break;

    for (const item of pageData) {
      if (itemNeedsImages(item.media ?? [], item.attributes)) return true;
    }

    if (pageData.length < PAGE_SIZE) break;
    page++;
  }

  return false;
}

/**
 * Returns items that have a known eBay image count (_ebay_img_count) but fewer
 * permanent Storage URLs than that count — i.e. confirmed partial syncs.
 *
 * These are items where a previous sync completed partially (e.g. 2/8 stored)
 * and we know exactly how many are missing because _ebay_img_count was recorded.
 */
export async function getPartialImageItems(
  tenantId: string,
): Promise<{ count: number; itemIds: string[] }> {
  const supabase = getSupabaseClient();
  const PAGE_SIZE = 200;
  const itemIds: string[] = [];
  let page = 0;

  while (true) {
    const { data: pageData, error } = await supabase
      .from('items')
      .select('id, media, attributes')
      .eq('tenant_id', tenantId)
      .not('attributes->_ebay_img_count', 'is', null)
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (error || !pageData || pageData.length === 0) break;

    for (const item of pageData) {
      const media: string[] = Array.isArray(item.media) ? item.media : [];
      const attrs: Record<string, any> =
        item.attributes && typeof item.attributes === 'object' ? item.attributes : {};
      const knownEbayCount =
        typeof attrs._ebay_img_count === 'number' ? (attrs._ebay_img_count as number) : null;

      if (knownEbayCount === null || knownEbayCount === 0) continue;

      const permanentCount = media.filter(u => isPermanentImageUrl(u)).length;
      if (permanentCount < knownEbayCount) itemIds.push(item.id);
    }

    if (pageData.length < PAGE_SIZE) break;
    page++;
  }

  return { count: itemIds.length, itemIds };
}

/**
 * Returns a count of items needing image sync for the tenant.
 * Uses the updated itemNeedsImages() that detects partial sets.
 */
export async function countItemsNeedingImageSync(tenantId: string): Promise<number> {
  const supabase = getSupabaseClient();
  const PAGE_SIZE = 200;
  let count = 0;
  let page = 0;

  while (true) {
    const { data: pageData, error } = await supabase
      .from('items')
      .select('id, media, attributes')
      .eq('tenant_id', tenantId)
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (error || !pageData || pageData.length === 0) break;

    for (const item of pageData) {
      if (itemNeedsImages(item.media ?? [], item.attributes)) count++;
    }

    if (pageData.length < PAGE_SIZE) break;
    page++;
  }

  return count;
}
