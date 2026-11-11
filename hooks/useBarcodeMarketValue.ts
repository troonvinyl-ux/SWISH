import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/template';
import { useApp } from './useApp';
import { barcodeMarketKey, getBarcodeMarketValue } from '@/services/barcodeMarketValueService';
import type { ProductLead } from '@/shared/quickList';
import type { MarketValueResult } from '@/services/marketValueService';
interface BarcodeMarketState { requestKey: string; loading: boolean; result: MarketValueResult | null; error: string }
export function useBarcodeMarketValue(lead: ProductLead) {
  const app = useApp(), { user } = useAuth();
  const tenantId = app.tenant?.id ?? '', nicheId = app.fixedNicheId ?? app.activeNicheId;
  const scope = `${user?.id ?? ''}:${tenantId}:${nicheId}:${app.moduleEpoch}`;
  const identity = barcodeMarketKey(tenantId, nicheId, lead);
  const ready = Boolean(identity && user?.id && app.accessReady && !app.moduleLoading);
  const [attempt, setAttempt] = useState(0);
  const requestKey = `${scope}:${identity}:${ready}:${attempt}`;
  const current = useRef(requestKey); current.current = requestKey;
  const latestLead = useRef(lead); latestLead.current = lead;
  const [state, setState] = useState<BarcodeMarketState>({ requestKey: '', loading: false, result: null, error: '' });
  useEffect(() => {
    let cancelled = false;
    const active = () => !cancelled && current.current === requestKey;
    if (!ready) { setState({ requestKey, loading: false, result: null, error: '' }); return; }
    setState({ requestKey, loading: true, result: null, error: '' });
    // Debounce edits; identity changes hide the old price immediately, before this timer fires.
    const timer = setTimeout(() => {
      if (!active()) return;
      void getBarcodeMarketValue({ tenantId, userId: user!.id, nicheId, scope, lead: latestLead.current }).then(response => {
        if (active()) setState({ requestKey, loading: false, result: response.result, error: response.error ?? '' });
      }).catch(() => {
        if (active()) setState({ requestKey, loading: false, result: null, error: 'Market value is unavailable. Retry pricing; product identification is unchanged.' });
      });
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [requestKey, ready, tenantId, user?.id, nicheId, scope]);
  const retry = useCallback(() => setAttempt(value => value + 1), []);
  const visible = state.requestKey === requestKey;
  return { result: visible && ready ? state.result : null, loading: ready && (!visible || state.loading), error: visible && ready ? state.error : '', ready, retry };
}
