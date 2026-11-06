import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/template';
import { useApp } from './useApp';
import { recoverCapturedItemPhotos } from '@/services/capturedPhotoRecoveryService';
import type { Item } from '@/services/itemService';
import { resolveProductionNiche } from '@/services/nicheRouting';

export function useInventoryPhotoRecovery(item: Item | null, onRecovered: (item: Item) => void) {
  const { user } = useAuth();
  const { tenant, activeNicheId, fixedNicheId, moduleEpoch, accessReady, moduleLoading, subscriptionLoading, triggerInventoryReload } = useApp();
  const nicheId = fixedNicheId ?? activeNicheId;
  const scope = `${user?.id ?? ''}:${tenant?.id ?? ''}:${nicheId}:${moduleEpoch}:${item?.id ?? ''}`;
  const current = useRef(scope); current.current = scope;
  const mounted = useRef(false);
  const attempted = useRef('');
  const locked = useRef('');
  const [state, setState] = useState<{ scope: string; busy: boolean; error: string | null }>({ scope: '', busy: false, error: null });
  const eligible = Boolean(user && tenant && accessReady && !moduleLoading && !subscriptionLoading && item && item.tenantId === tenant.id && !item.media.length &&
    resolveProductionNiche(item.specialistId) === nicheId);

  const retry = useCallback(async () => {
    if (!eligible || !tenant || !item || locked.current === scope) return;
    locked.current = scope;
    attempted.current = scope;
    setState({ scope, busy: true, error: null });
    try {
      const result = await recoverCapturedItemPhotos(tenant.id, item.id, nicheId);
      if (!mounted.current || current.current !== scope) return;
      if (result.error || !result.item) setState({ scope, busy: false, error: result.error ?? 'Photo recovery was not confirmed.' });
      else {
        setState({ scope, busy: false, error: null });
        onRecovered(result.item);
        triggerInventoryReload();
      }
    } catch (cause) {
      if (mounted.current && current.current === scope) setState({ scope, busy: false, error: cause instanceof Error ? cause.message : 'Could not recover photographs.' });
    } finally {
      if (locked.current === scope) locked.current = '';
    }
  }, [eligible, tenant?.id, item?.id, nicheId, scope, onRecovered, triggerInventoryReload]);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (eligible && attempted.current !== scope) void retry(); }, [eligible, scope, retry]);
  return { busy: state.scope === scope && state.busy, error: state.scope === scope ? state.error : null, retry };
}
