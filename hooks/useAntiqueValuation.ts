import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from './useApp';
import { getItem, type Item } from '@/services/itemService';
import { getMarketValue, type MarketValueResult } from '@/services/marketValueService';
import { saveCaptureValuation } from '@/services/captureValuationService';
export function useAntiqueValuation(itemId: string) {
  const { tenant, activeNicheId, fixedNicheId, triggerInventoryReload } = useApp();
  const scope = `${tenant?.id}:${fixedNicheId ?? activeNicheId}:${itemId}`;
  const current = useRef(scope); current.current = scope;
  const lock = useRef(false);
  const [state, setState] = useState<{ scope: string; item: Item | null; result: MarketValueResult | null; loading: boolean; valuing: boolean; error: string }>({ scope: '', item: null, result: null, loading: false, valuing: false, error: '' });
  useEffect(() => {
    let cancelled = false;
    if (!tenant) return;
    setState({ scope, item: null, result: null, loading: true, valuing: false, error: '' });
    void getItem(itemId).then(response => {
      if (cancelled || current.current !== scope) return;
      const item = response.item;
      if (response.error || !item || item.tenantId !== tenant.id || !['antiques','books'].includes(item.specialistId) || (fixedNicheId ?? activeNicheId) !== 'antiques') {
        setState({ scope, item: null, result: null, loading: false, valuing: false, error: response.error ?? 'Item not found in your Antique workspace.' }); return;
      }
      setState({ scope, item, result: null, loading: false, valuing: false, error: '' });
    }).catch(() => { if (!cancelled && current.current === scope) setState(previous => ({ ...previous, loading: false, error: 'Item could not load.' })); });
    return () => { cancelled = true; };
  }, [scope, tenant?.id, itemId, fixedNicheId, activeNicheId]);
  const value = useCallback(async () => {
    if (!state.item || !tenant || lock.current || state.scope !== scope) return;
    lock.current = true; setState(previous => ({ ...previous, valuing: true, error: '' }));
    try {
      const item = state.item;
      const response = await getMarketValue({ tenantId: tenant.id, itemId: item.id, title: item.canonicalTitle, specialistId: item.specialistId, attributes: item.attributes, condition: item.condition, identificationConfidence: item.identificationConfidence, imageUrls: item.media, applyToItem: false });
      if (current.current !== scope) return;
      if (response.error || !response.result) throw new Error(response.error ?? 'No valuation evidence returned.');
      setState(previous => ({ ...previous, result: response.result }));
      if (response.result.valuation.valuationMid > 0) {
        const error = await saveCaptureValuation(tenant.id, item.id, response.result);
        if (error) throw new Error(error);
        if (current.current === scope) triggerInventoryReload();
      }
    } catch (cause) { if (current.current === scope) setState(previous => ({ ...previous, error: cause instanceof Error ? cause.message : 'Valuation failed. No successful save was inferred.' })); }
    finally { lock.current = false; if (current.current === scope) setState(previous => ({ ...previous, valuing: false })); }
  }, [state, tenant?.id, scope, triggerInventoryReload]);
  const visible = state.scope === scope;
  return { item: visible ? state.item : null, result: visible ? state.result : null, loading: !visible || state.loading, valuing: visible && state.valuing, error: visible ? state.error : '', value };
}
