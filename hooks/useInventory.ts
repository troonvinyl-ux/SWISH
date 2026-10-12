// useInventory — real OnSpace Cloud data
// Default behaviour: ACTIVE INVENTORY ONLY (Draft + Live)
// Sold / Archived items are excluded from the default view.
// Pass { lifecycleGroup: 'history' } to fetch historical records.
//
// For Live items, also fetches the associated eBay listing (price, watchers,
// views) and merges it into the item rows so inventory cards can display
// eBay-enriched data without a separate query per card.

import { useState, useEffect, useCallback } from 'react';
import { useApp } from './useApp';
import { getSupabaseClient } from '@/template';
import {
  Item, ItemFilter, listItems, getItemStatusCounts,
  ACTIVE_INVENTORY_STATUSES, ITEM_LIFECYCLE, HISTORY_STATUSES,
} from '@/services/itemService';

export interface InventoryStats {
  // Active counts
  activeTotal: number;   // Draft + Live
  draftCount: number;
  liveCount: number;
  // History counts
  soldCount: number;
  archivedCount: number;
  // Total across all statuses
  grandTotal: number;
}

/** Fetch eBay listing enrichment for a set of item IDs */
async function fetchListingEnrichment(tenantId: string, itemIds: string[]): Promise<Map<string, { price: number; watchers: number; views: number; externalId: string }>> {
  if (!itemIds.length) return new Map();
  const supabase = getSupabaseClient();
  const { data } = await supabase
    .from('listings')
    .select('item_id, price, watchers, views, external_listing_id')
    .eq('tenant_id', tenantId)
    .eq('marketplace_id', 'ebay')
    .in('status', ['active'])
    .in('item_id', itemIds);

  const map = new Map<string, { price: number; watchers: number; views: number; externalId: string }>();
  for (const row of data ?? []) {
    if (row.item_id && !map.has(row.item_id)) {
      map.set(row.item_id, {
        price: Number(row.price ?? 0),
        watchers: Number(row.watchers ?? 0),
        views: Number(row.views ?? 0),
        externalId: row.external_listing_id ?? '',
      });
    }
  }
  return map;
}

export function useInventory(filter: ItemFilter = {}) {
  const { tenant } = useApp();
  const appCtx = useApp();
  const inventoryReloadSignal = appCtx.inventoryReloadSignal;
  const [items, setItems] = useState<any[]>([]); // raw rows with optional listing_* fields
  const [loading, setLoading] = useState(false);
  const [statusGroups, setStatusGroups] = useState<Record<string, number>>({});

  const filterKey = JSON.stringify(filter);

  const load = useCallback(async () => {
    if (!tenant) return;
    setLoading(true);

    // Apply active-inventory-first default
    const effectiveFilter: ItemFilter = { ...filter };
    if (!effectiveFilter.lifecycleGroup && !effectiveFilter.statuses && !effectiveFilter.status && !effectiveFilter.reviewRequired) {
      effectiveFilter.lifecycleGroup = 'active';
    }

    const [itemsResult, counts] = await Promise.all([
      listItems(tenant.id, effectiveFilter),
      getItemStatusCounts(tenant.id, effectiveFilter.specialistIds),
    ]);

    setStatusGroups(counts);

    // For Live items, fetch listing enrichment (price, watchers, views)
    const liveItems = itemsResult.items.filter(i => ITEM_LIFECYCLE.LIVE_STATUSES.includes(i.status));
    const liveIds = liveItems.map(i => i.id);
    const enrichment = liveIds.length > 0 ? await fetchListingEnrichment(tenant.id, liveIds) : new Map();

    // Merge listing data into item rows as extra fields
    const enrichedItems = itemsResult.items.map(item => {
      const listing = enrichment.get(item.id);
      if (!listing) return item;
      return {
        ...item,
        listing_price: listing.price,
        listing_watchers: listing.watchers,
        listing_views: listing.views,
        listing_ebay_id: listing.externalId,
      };
    });

    setItems(enrichedItems);
    setLoading(false);
  }, [tenant?.id, filterKey]);

  // Also reload when AppContext signals a global inventory refresh (e.g. after Settings sync)
  useEffect(() => {
    if (inventoryReloadSignal > 0) load();
  }, [inventoryReloadSignal]);

  useEffect(() => {
    load();
  }, [load]);

  const totalValue = items.reduce((s: number, i: any) => s + (i.valuationMid > 0 ? i.valuationMid : i.expectedSellingPrice), 0);
  const reviewCount = statusGroups['review_required'] ?? 0;

  const stats: InventoryStats = {
    draftCount: ITEM_LIFECYCLE.DRAFT_STATUSES.reduce((s, st) => s + (statusGroups[st] ?? 0), 0),
    liveCount: ITEM_LIFECYCLE.LIVE_STATUSES.reduce((s, st) => s + (statusGroups[st] ?? 0), 0),
    soldCount: ITEM_LIFECYCLE.SOLD_STATUSES.reduce((s, st) => s + (statusGroups[st] ?? 0), 0),
    archivedCount: ITEM_LIFECYCLE.ARCHIVED_STATUSES.reduce((s, st) => s + (statusGroups[st] ?? 0), 0),
    activeTotal: 0,
    grandTotal: Object.values(statusGroups).reduce((s, v) => s + v, 0),
  };
  stats.activeTotal = stats.draftCount + stats.liveCount;

  return { items, loading, totalValue, reviewCount, statusGroups, stats, reload: load };
}
