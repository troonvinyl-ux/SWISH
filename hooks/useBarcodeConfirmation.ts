import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { useAuth } from '@/template';
import { useApp } from './useApp';
import { confirmBarcodeProduct, retainBarcodePhoto } from '@/services/barcodeConfirmationService';
import type { CapturedImage } from '@/services/aiIdentificationService';
import type { ProductLead, QuickListNiche } from '@/shared/quickList';
import { resolveProductionNiche } from '@/services/nicheRouting';
export function useBarcodeConfirmation(lead: ProductLead | null, sessionId: string, initialImages: CapturedImage[] = [], existingItemId?: string) {
  const app = useApp(), { user } = useAuth(), router = useRouter();
  const nicheId = resolveProductionNiche(app.fixedNicheId ?? app.activeNicheId);
  const scope = `${user?.id}:${app.tenant?.id}:${nicheId}:${app.moduleEpoch}:${sessionId}`;
  const current = useRef(scope); current.current = scope;
  const [extraImages, setExtraImages] = useState<CapturedImage[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const lock = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { setExtraImages([]); setError(''); setBusy(false); }, [scope]);
  const active = useCallback(() => mounted.current && current.current === scope, [scope]);
  const addPhotos = useCallback(async (source: 'camera' | 'library') => {
    if (lock.current || !lead || !sessionId || initialImages.length + extraImages.length >= 8) return;
    lock.current = true; setBusy(true); setError('');
    try { const image = await retainBarcodePhoto(source, initialImages.length + extraImages.length); if (image && active()) setExtraImages(previous => [...previous, image]); }
    catch (cause) { if (active()) setError(cause instanceof Error ? cause.message : 'Photo could not be retained. Try again.'); }
    finally { lock.current = false; if (active()) setBusy(false); }
  }, [lead, sessionId, initialImages.length, extraImages.length, active]);
  const confirm = useCallback(async (product: ProductLead = lead!) => {
    if (lock.current || !product || !user?.id || !app.tenant?.id || !nicheId || !app.accessReady || app.moduleLoading || !sessionId) return false;
    lock.current = true; setBusy(true); setError('');
    try {
      const result = await confirmBarcodeProduct({ tenantId: app.tenant.id, userId: user.id, nicheId: nicheId as QuickListNiche, sessionId, lead: product, images: [...initialImages, ...extraImages], existingItemId, isCurrent: active });
      if (!active()) return false;
      app.triggerInventoryReload(); router.push({ pathname: '/ebay-listing-editor', params: { id: result.listingId } } as any); return true;
    } catch (cause) { if (active()) { app.triggerInventoryReload(); setError(cause instanceof Error ? cause.message : 'Product save not confirmed. Retry this same scan.'); } return false; }
    finally { lock.current = false; if (active()) setBusy(false); }
  }, [lead, user?.id, app.tenant?.id, nicheId, app.accessReady, app.moduleLoading, app.triggerInventoryReload, sessionId, initialImages, extraImages, existingItemId, active, router]);
  return { busy, error, photoCount: initialImages.length + extraImages.length, addPhotos, confirm };
}
