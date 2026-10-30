import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { AppState } from 'react-native';
import { useApp } from './useApp';
import { listItems, getItemStatusCounts, ITEM_LIFECYCLE, type ItemFilter } from '@/services/itemService';
import { getProductionNicheSpecialistIds } from '@/services/nicheRouting';

export interface InventoryStats {
  activeTotal: number; draftCount: number; liveCount: number;
  soldCount: number; archivedCount: number; grandTotal: number;
}
interface Snapshot { scope: string; items: any[]; counts: Record<string, number>; error: string | null; loading: boolean }

/** Polling is the supported OnSpace Cloud mechanism; no Realtime dependency. */
export function useInventory(filter: ItemFilter = {}) {
  const { tenant, activeNicheId, fixedNicheId, inventoryReloadSignal, subscriptionLoading } = useApp();
  const niche = fixedNicheId ?? activeNicheId;
  const filterKey = JSON.stringify(filter);
  const scope = `${tenant?.id ?? ''}:${niche}:${filterKey}`;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const requestId = useRef(0);
  const inFlight = useRef<string | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot>({ scope: '', items: [], counts: {}, error: null, loading: false });

  const load = useCallback(async () => {
    if (!tenant?.id || subscriptionLoading || inFlight.current === scope) return;
    const version = ++requestId.current;
    inFlight.current = scope;
    const allowList = getProductionNicheSpecialistIds(niche);
    const requested = filter.specialistIds ?? (filter.specialistId ? [filter.specialistId] : allowList);
    const effectiveFilter: ItemFilter = { ...filter, specialistId: undefined,
      specialistIds: requested.filter(id => allowList.includes(id)) };
    if (!effectiveFilter.lifecycleGroup && !effectiveFilter.statuses && !effectiveFilter.status && !effectiveFilter.reviewRequired) effectiveFilter.lifecycleGroup = 'active';
    setSnapshot(prev => prev.scope === scope ? { ...prev, loading: true } : { scope, items: [], counts: {}, error: null, loading: true });
    try {
      const [result, counts] = await Promise.all([
        listItems(tenant.id, effectiveFilter), getItemStatusCounts(tenant.id, effectiveFilter.specialistIds),
      ]);
      if (scopeRef.current !== scope || requestId.current !== version) return;
      if (result.error) throw new Error(result.error);
      setSnapshot({ scope, items: result.items, counts, error: null, loading: false });
    } catch (error: any) {
      if (scopeRef.current === scope && requestId.current === version) {
        setSnapshot({ scope, items:[], counts:{}, loading:false, error:error?.message ?? 'Inventory refresh failed' });
      }
    } finally {
      if (inFlight.current === scope) inFlight.current = null;
    }
  }, [tenant?.id, niche, filterKey, scope, subscriptionLoading]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => { void load(); }, 30_000);
    const foreground = AppState.addEventListener('change', state => { if (state === 'active') void load(); });
    return () => { clearInterval(timer); foreground.remove(); requestId.current++; };
  }, [load]);
  useEffect(() => { if (inventoryReloadSignal > 0) void load(); }, [inventoryReloadSignal, load]);

  // Never render a previous tenant/niche snapshot while a new request is pending.
  const items = snapshot.scope === scope ? snapshot.items : [];
  const statusGroups = snapshot.scope === scope ? snapshot.counts : {};
  const stats = useMemo((): InventoryStats => {
    const sum = (statuses: readonly string[]) => statuses.reduce((total, status) => total + (statusGroups[status] ?? 0), 0);
    const draftCount = sum(ITEM_LIFECYCLE.DRAFT_STATUSES);
    const liveCount = sum(ITEM_LIFECYCLE.LIVE_STATUSES);
    return { draftCount, liveCount, activeTotal: draftCount + liveCount,
      soldCount: sum(ITEM_LIFECYCLE.SOLD_STATUSES), archivedCount: sum(ITEM_LIFECYCLE.ARCHIVED_STATUSES),
      grandTotal: Object.values(statusGroups).reduce((a, b) => a + b, 0) };
  }, [statusGroups]);
  const totalValue = useMemo(() => items.reduce((sum, item) => sum + (item.valuationMid > 0 ? item.valuationMid : item.expectedSellingPrice ?? 0), 0), [items]);
  return { items, stats, statusGroups, totalValue, reviewCount: statusGroups.review_required ?? 0,
    loading: Boolean(tenant?.id) && (snapshot.scope !== scope || snapshot.loading),
    syncError: snapshot.scope === scope ? snapshot.error : null, reload: load };
}
