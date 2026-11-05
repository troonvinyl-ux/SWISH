import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/template';
import { useApp } from './useApp';
import { selectMainItemImage } from '@/services/itemPhotoService';
import { resolveProductionNiche } from '@/services/nicheRouting';
import type { Item } from '@/services/itemService';

export function useItemMainImage(item: Item | null, onSaved: (item: Item) => void) {
  const { user } = useAuth();
  const { tenant, activeNicheId, fixedNicheId, moduleEpoch, accessReady, moduleLoading, triggerInventoryReload } = useApp();
  const nicheId = resolveProductionNiche(fixedNicheId ?? activeNicheId);
  const scope = `${user?.id}:${tenant?.id}:${nicheId}:${moduleEpoch}:${item?.id}`;
  const current = useRef(scope); current.current = scope;
  const flight = useRef(false);
  const mounted = useRef(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { setError(null); setSaving(false); }, [scope]);
  const selectMain = useCallback(async (url: string) => {
    if (!item || !tenant || !nicheId || !user || !accessReady || moduleLoading || flight.current || item.tenantId !== tenant.id || resolveProductionNiche(item.specialistId) !== nicheId) return;
    flight.current = true; setSaving(true); setError(null);
    try {
      const result = await selectMainItemImage(tenant.id, nicheId, item.id, url, item.media);
      if (!mounted.current || current.current !== scope) return;
      if (result.error || !result.item) setError(result.error ?? 'The saved main image was not returned.');
      else { onSaved(result.item); triggerInventoryReload(); }
    } finally {
      flight.current = false;
      if (mounted.current && current.current === scope) setSaving(false);
    }
  }, [item, tenant?.id, nicheId, user?.id, accessReady, moduleLoading, scope, onSaved, triggerInventoryReload]);
  return { saving, error, selectMain };
}
