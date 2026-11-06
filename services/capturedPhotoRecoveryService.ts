// Recover existing uploads only; no new inventory, image generation or marketplace calls.
import { getSupabaseClient } from '@/template';
import { getItem, type Item } from './itemService';
import { updateItemMedia } from './aiIdentificationService';
import { verifyStoredOriginal } from './originalImageService';
import { getProductionNicheSpecialistIds } from './nicheRouting';
import { SPECIALISTS } from '@/constants/specialists';
interface StoredCapture { path: string; slot: string; hash?: string; order: number }
const recoveries = new Map<string, Promise<{ item: Item | null; error: string | null }>>();

async function recover(tenantId: string, itemId: string, nicheId: string): Promise<{ item: Item | null; error: string | null }> {
  try {
    const specialists = getProductionNicheSpecialistIds(nicheId);
    if (!tenantId || !itemId || !specialists.length) throw new Error('A verified item and niche are required for photo recovery.');
    const loaded = await getItem(itemId);
    if (loaded.error || !loaded.item || loaded.item.tenantId !== tenantId || !specialists.includes(loaded.item.specialistId)) throw new Error(loaded.error ?? 'Item ownership could not be verified in this workspace.');
    const item = loaded.item;
    if (item.media.length) return loaded;
    if (!item.updatedAt) throw new Error('Reload the item before recovering its photographs.');
    const storage = getSupabaseClient().storage.from('item-images');
    const captures: StoredCapture[] = [];
    let hasOriginals = false;
    // Only this item's two documentary folders. Never recurse into studio/references.
    const list = async (folder: string, originals: boolean) => {
      for (let offset = 0; offset <= 900; offset += 100) {
        const page = await storage.list(folder, { limit: 100, offset, sortBy: { column: 'name', order: 'asc' } });
        if (page.error) throw new Error('Stored photographs could not be read. Retry captured photos.');
        for (const file of page.data ?? []) {
          if (!originals && !file.id && file.name === 'originals') hasOriginals = true;
          if (!file.id || typeof file.name !== 'string') continue;
          const match = originals ? file.name.match(/^([a-zA-Z0-9_-]{1,40})_([a-f0-9]{64})\.(?:jpg|jpeg|png|webp|gif)$/) : file.name.match(/^([1-9]\d*)_([a-zA-Z0-9_-]+)\.(?:jpg|jpeg|png|webp)$/i);
          if (!match) continue;
          captures.push({ path: `${folder}/${file.name}`, slot: originals ? match[1] : match[2], ...(originals ? { hash: match[2] } : {}), order: originals ? 1000 : Number(match[1]) });
        }
        if ((page.data?.length ?? 0) < 100) return;
      }
      throw new Error('Too many stored files to recover safely. Review the saved item.');
    };
    await list(itemId, false);
    if (hasOriginals) await list(`${itemId}/originals`, true);
    if (!captures.length) throw new Error('No uploaded original photos were found. Add photos to this saved item; do not create another item.');
    const hashed = captures.filter(capture => capture.hash);
    if (new Set(hashed.map(capture => capture.slot)).size !== hashed.length) throw new Error('Multiple originals exist for the same view. Review the saved item before choosing photos.');
    const slots = SPECIALISTS[item.specialistId]?.captureRequirements.map(slot => slot.id) ?? [];
    const selected = captures.filter(capture => capture.hash || !hashed.some(other => other.slot === capture.slot));
    if (selected.length > 12) throw new Error('More than 12 captured photos require manual review.');
    const rank = (capture: StoredCapture) => { const index = slots.indexOf(capture.slot); return index >= 0 ? index : capture.order; };
    selected.sort((a, b) => rank(a) - rank(b) || a.path.localeCompare(b.path, undefined, { numeric: true }));
    // Bounded sequential downloads; fingerprints prove unchanged bytes, not image fidelity.
    for (const capture of selected) if (capture.hash) await verifyStoredOriginal(capture.path, capture.hash);
    const urls = selected.map(capture => {
      const url = storage.getPublicUrl(capture.path).data?.publicUrl;
      if (!url?.startsWith('https://')) throw new Error('A stored original has no permanent URL.');
      return url;
    });
    await updateItemMedia(tenantId, itemId, urls, item.updatedAt);
    const check = await getItem(itemId);
    if (check.error || !check.item || check.item.tenantId !== tenantId || !specialists.includes(check.item.specialistId) || JSON.stringify(check.item.media) !== JSON.stringify(urls)) throw new Error(check.error ?? 'Recovered photo links could not be confirmed. Reload the saved item.');
    return check;
  } catch (cause) { return { item: null, error: cause instanceof Error ? cause.message : 'Photo recovery failed. Retry the saved item.' }; }
}

export function recoverCapturedItemPhotos(tenantId: string, itemId: string, nicheId: string): Promise<{ item: Item | null; error: string | null }> {
  const key = `${tenantId}:${nicheId}:${itemId}`;
  const existing = recoveries.get(key);
  if (existing) return existing;
  const pending = recover(tenantId, itemId, nicheId).finally(() => { if (recoveries.get(key) === pending) recoveries.delete(key); });
  recoveries.set(key, pending);
  return pending;
}
