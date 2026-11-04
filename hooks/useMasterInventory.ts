import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { AppState, InteractionManager } from 'react-native';
import { useApp } from './useApp';
import { useAlert, useAuth } from '@/template';
import { useFocusEffect } from 'expo-router';
import { loadInventoryView, buildInventoryViews, buildAllInventoryRows, syncInventoryOrders, type InventoryViewItem, type InventoryTab } from '@/services/inventoryViewService';
import { submitListingToMarketplace, endListing, type SubmitStep } from '@/services/listingService';
import { fetchAndStoreEbayImages, itemNeedsImages } from '@/services/ebayImageService';
import type { Item } from '@/services/itemService';
import type { ListingWithItem } from '@/services/listingService';

export function useMasterInventory() {
  const { tenant, fixedNicheId, activeNicheId, inventoryReloadSignal, subscriptionLoading, accessReady, moduleLoading, moduleEpoch, accessError, tenantError, moduleError } = useApp();
  const { user } = useAuth();
  const ready = Boolean(user && tenant?.id && accessReady && !moduleLoading && !subscriptionLoading);
  const readyRef = useRef(ready); readyRef.current = ready;
  const alive = useRef(true);
  const nicheId = fixedNicheId ?? activeNicheId;
  const scope = `${user?.id ?? ''}:${tenant?.id ?? ''}:${nicheId}:${moduleEpoch}`;
  const scopeRef = useRef(scope); scopeRef.current = scope;
  const request = useRef(0); const pending = useRef<{ scope: string; promise: Promise<void> } | null>(null); const imagesStarted = useRef(new Set<string>());
  const { showAlert } = useAlert();
  const [snapshot, setSnapshot] = useState<{ scope: string; items: Item[]; listings: ListingWithItem[]; error: string | null }>({ scope: '', items: [], listings: [], error: null });
  const [loading, setLoading] = useState(false); const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<InventoryTab>('stock');
  const [submitStep, setSubmitStep] = useState<SubmitStep | null>(null); const [submitTitle, setSubmitTitle] = useState('');
  const [syncing, setSyncing] = useState(false);
  const reload = useCallback(async () => {
    if (!tenant?.id || !ready) return;
    if (pending.current?.scope === scope) return pending.current.promise;
    const version = ++request.current;
    setLoading(true);
    const task = (async () => { try {
      const result = await loadInventoryView(tenant.id, nicheId);
      if (!alive.current || !readyRef.current || scopeRef.current !== scope || request.current !== version) return;
      // Never replace a verified snapshot with a failed read disguised as empty.
      setSnapshot(previous => result.error ? { ...previous, scope, items: previous.scope === scope ? previous.items : [], listings: previous.scope === scope ? previous.listings : [], error: result.error } : { scope, ...result });
      // Restore automatic image persistence, scoped to verified items in this niche.
      const ids = result.items.filter(item => (item.attributes._ebay_item_id || item.marketplace === 'ebay') && itemNeedsImages(item.media, item.attributes)).map(item => item.id);
      if (!result.error && ids.length && !imagesStarted.current.has(scope)) {
        imagesStarted.current.add(scope);
        // Image repair is secondary work. Let navigation, scrolling and the
        // first inventory render finish before starting network/storage work.
        const imageTask = InteractionManager.runAfterInteractions(() => {
          if (scopeRef.current !== scope) return;
          void fetchAndStoreEbayImages(tenant.id, { itemIds: ids, fixTitles: true }).then(progress => {
            if (scopeRef.current === scope && progress.phase === 'error') showAlert('Image Sync Incomplete', progress.errorMsg);
          }).catch(error => {
            if (scopeRef.current === scope) showAlert('Image Sync Incomplete', error?.message ?? 'Image sync failed');
          });
        });
        // If the user changes niche or leaves inventory before interactions
        // settle, cancel the queued work rather than competing with the new screen.
        if (scopeRef.current !== scope) imageTask.cancel();
      }
    } catch (error: any) { if (alive.current && readyRef.current && scopeRef.current === scope && request.current === version) setSnapshot(previous => ({ scope, items: previous.scope === scope ? previous.items : [], listings: previous.scope === scope ? previous.listings : [], error: error?.message ?? 'Inventory could not be loaded' })); }
    finally { if (pending.current?.scope === scope) pending.current = null; if (alive.current && scopeRef.current === scope && request.current === version) setLoading(false); }
    })();
    pending.current = { scope, promise: task };
    return task;
  }, [tenant?.id, nicheId, scope, showAlert, ready]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; request.current++; pending.current = null; }; }, []);
  useFocusEffect(useCallback(() => { void reload(); }, [reload]));
  useEffect(() => { void reload(); const timer = setInterval(() => { if(AppState.currentState==='active')void reload(); }, 90_000); const sub = AppState.addEventListener('change', state => { if (state === 'active') void reload(); });
    // Subscription verification can restart the effect for an unchanged scope.
    // Keep its pending request valid instead of blocking a replacement for 90s.
    return () => { clearInterval(timer); sub.remove(); }; }, [reload]);
  useEffect(() => { if (inventoryReloadSignal > 0) void reload(); }, [inventoryReloadSignal, reload]);
  const views = useMemo(() => ready && snapshot.scope === scope ? buildInventoryViews(snapshot.items, snapshot.listings) : { stock: [], draft: [], live: [], sold: [] }, [snapshot, scope, ready]);
  const allItems = useMemo(() => ready && snapshot.scope === scope ? buildAllInventoryRows(snapshot.items, views) : [], [snapshot, scope, ready, views]);
  const refresh = useCallback(async () => { setRefreshing(true); try { await reload(); } finally { setRefreshing(false); } }, [reload]);
  const counts = useMemo(() => ({ stock: views.stock.length, draft: views.draft.length, live: views.live.length, sold: views.sold.length }), [views]);
  const submit = useCallback(async (item: InventoryViewItem) => {
    if (!tenant || !item.listing || submitStep) return;
    const actionScope = scope; setSubmitTitle(item.canonical_title); setSubmitStep('verifying');
    try {
      const result = await submitListingToMarketplace(tenant.id, item.listing.id, step => { if (scopeRef.current === actionScope) setSubmitStep(step); });
      if (scopeRef.current !== actionScope) return;
      if (!result.success) showAlert('Submission Not Confirmed', result.error ?? result.failureReasons?.join('\n'));
      else { setActiveTab('live'); if (result.warnings?.length) showAlert('eBay Listing Warnings', result.warnings.join('\n')); }
      await reload();
    } catch (error: any) { if (scopeRef.current === actionScope) showAlert('Submission Failed', error?.message ?? 'Retry after syncing eBay'); }
    finally { setSubmitStep(null); }
  }, [tenant?.id, scope, submitStep, showAlert, reload]);
  const end = useCallback((item: InventoryViewItem) => {
    if (!tenant || !item.listing) return;
    const listing = item.listing; const actionScope = scope;
    showAlert('End Listing', `Remove "${item.canonical_title.slice(0, 40)}" from eBay?`, [
      { text: 'Cancel', style: 'cancel' }, { text: 'End Listing', style: 'destructive', onPress: async () => {
        const result = await endListing(listing.id, item.id, tenant.id, listing.externalListingId);
        if (scopeRef.current !== actionScope) return;
        if (result.error) { showAlert('End Failed', result.error); return; }
        setActiveTab('stock'); await reload();
      } },
    ]);
  }, [tenant?.id, scope, showAlert, reload]);
  const syncSold = useCallback(async () => {
    if (!tenant || syncing) return;
    setSyncing(true);
    try { const result = await syncInventoryOrders(tenant.id, nicheId); if (scopeRef.current !== scope) return;
      if (result.error) showAlert('Order Sync Incomplete', result.error); else showAlert('Order Sync Complete', `${result.imported} new orders imported.`);
      await reload();
    } finally { setSyncing(false); }
  }, [tenant?.id, nicheId, scope, syncing, showAlert, reload]);
  return { nicheId, views, counts, allItems, activeTab, setActiveTab, reload, refresh, refreshing, submit, end, syncSold, syncing, submitStep, submitTitle,
    ready, scope,
    error: tenantError ?? accessError ?? (!ready ? moduleError : null) ?? (snapshot.scope === scope ? snapshot.error : null),
    loading: Boolean(tenant?.id) && (!ready || snapshot.scope !== scope || loading) };
}
