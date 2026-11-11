import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/template';
import { useApp } from './useApp';
import { appendInventoryGalleryPhotos, chooseInventoryGalleryPhotos, type GalleryPhotoSource } from '@/services/inventoryGalleryService';
import { resolveProductionNiche } from '@/services/nicheRouting';
import type { CapturedImage } from '@/services/aiIdentificationService';
import type { Item } from '@/services/itemService';
interface GalleryState { scope: string; busy: boolean; error: string | null; notice: string; retryCount: number }
export function useInventoryGallery(item: Item | null, onSaved: (item: Item) => void) {
  const { user } = useAuth();
  const app = useApp();
  const nicheId = resolveProductionNiche(app.fixedNicheId ?? app.activeNicheId);
  const scope = `${user?.id}:${app.tenant?.id}:${nicheId}:${app.moduleEpoch}:${item?.id}`;
  const ready = Boolean(user && app.tenant && item && nicheId && app.accessReady && !app.moduleLoading && !app.subscriptionLoading && item.tenantId === app.tenant.id && resolveProductionNiche(item.specialistId) === nicheId);
  const current = useRef({ scope, ready }); current.current = { scope, ready };
  const mounted = useRef(false), locked = useRef(false);
  const callback = useRef(onSaved); callback.current = onSaved;
  const pending = useRef<{ scope: string; photos: CapturedImage[] } | null>(null);
  const [state, setState] = useState<GalleryState>({ scope: '', busy: false, error: null, notice: '', retryCount: 0 });
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { pending.current = null; setState({ scope, busy: false, error: null, notice: '', retryCount: 0 }); }, [scope]);
  const run = useCallback(async (source?: GalleryPhotoSource) => {
    if (!ready || !app.tenant || !item || !nicheId || locked.current) return;
    // Resolve a failed batch before choosing more images; retries retain original roles/receipts.
    if (source && pending.current?.scope === scope) return;
    locked.current = true;
    const isCurrent = () => mounted.current && current.current.scope === scope && current.current.ready;
    setState({ scope, busy: true, error: null, notice: '', retryCount: pending.current?.photos.length ?? 0 });
    try {
      const target = { tenantId: app.tenant.id, nicheId, itemId: item.id };
      if (source) {
        const photos = await chooseInventoryGalleryPhotos(target, source, isCurrent);
        if (!isCurrent() || !photos.length) return;
        pending.current = { scope, photos };
      }
      const batch = pending.current;
      if (!batch || batch.scope !== scope || !isCurrent()) return;
      const saved = await appendInventoryGalleryPhotos(target, batch.photos, isCurrent);
      if (!isCurrent()) return;
      pending.current = null;
      callback.current(saved); app.triggerInventoryReload();
      setState({ scope, busy: false, error: null, notice: `${batch.photos.length} photo${batch.photos.length === 1 ? '' : 's'} added to this item. eBay is unchanged.`, retryCount: 0 });
    } catch (cause) {
      if (isCurrent()) setState({ scope, busy: false, error: cause instanceof Error ? cause.message : 'Photo addition was not confirmed.', notice: '', retryCount: pending.current?.scope === scope ? pending.current.photos.length : 0 });
    } finally {
      locked.current = false;
      if (isCurrent()) setState(previous => previous.scope === scope ? { ...previous, busy: false } : previous);
    }
  }, [scope, ready, app.tenant?.id, nicheId, item?.id, app.triggerInventoryReload]);
  const add = useCallback((source: GalleryPhotoSource) => run(source), [run]);
  const retry = useCallback(() => run(), [run]);
  const discardPending = useCallback(() => {
    if (locked.current || current.current.scope !== scope) return;
    pending.current = null;
    setState({ scope, busy: false, error: null, notice: 'Pending upload cleared. Any already saved photos are kept.', retryCount: 0 });
  }, [scope]);
  const visible = state.scope === scope ? state : { busy: false, error: null, notice: '', retryCount: 0 };
  return { ready, ...visible, add, retry, discardPending };
}
export type InventoryGalleryController = ReturnType<typeof useInventoryGallery>;
