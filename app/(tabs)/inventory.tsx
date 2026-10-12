
// SWISH Inventory Screen — Active Inventory + History
//
// ACTIVE VIEW (default): Draft + Live items only
//   Draft  = new, captured, identified, priced (not yet on eBay)
//   Live   = listed, active (confirmed on eBay)
//
// HISTORY VIEW (tap History tab):
//   Sold     = sold, fulfilled, completed
//   Archived = held, bundled, scrapped, disposed
//
// Sold / Archived items NEVER appear in Active Inventory.

import React, { useState, useCallback, useMemo, useRef } from 'react';
import {
  View, Text, StyleSheet, FlatList, Pressable,
  TextInput, ScrollView, ActivityIndicator, RefreshControl, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import { ItemImage } from '@/components';
import { useInventory } from '@/hooks/useInventory';
import {
  listItems, ITEM_LIFECYCLE, ACTIVE_INVENTORY_STATUSES, HISTORY_STATUSES,
} from '@/services/itemService';
import { useApp } from '@/hooks/useApp';
import { getSupabaseClient } from '@/template';
import {
  fetchAndStoreEbayImages, tenantNeedsImageSync,
} from '@/services/ebayImageService';
import { Colors, Typography, Spacing, Radius, Shadow } from '@/constants/theme';
import BulkReValueSheet from '@/components/feature/BulkReValueSheet';
import BulkReIdentifyModal from '@/components/feature/BulkReIdentifyModal';
import { useBusinessConfig } from '@/hooks/useBusiness';
import { IS_TV } from '@/hooks/useTVNavigation';

// ── Lifecycle tab definition ──────────────────────────────────────────────────

type ViewMode = 'active' | 'history';
type ActiveFilter = 'all' | 'draft' | 'live' | 'needs_id' | 'needs_value' | 'review';
type HistoryFilter = 'all' | 'sold' | 'archived';
type CoinFilter = 'all' | 'silver' | 'gold' | 'ancient' | 'islamic' | 'medieval' | 'roman' | 'british';

// ── Status helpers ────────────────────────────────────────────────────────────

function getLifecycleChip(status: string): {
  label: string; color: string; icon: string;
} {
  const liveStatuses = ITEM_LIFECYCLE.LIVE_STATUSES;
  const soldStatuses = ITEM_LIFECYCLE.SOLD_STATUSES;
  const archivedStatuses = ITEM_LIFECYCLE.ARCHIVED_STATUSES;

  if (liveStatuses.includes(status)) {
    return { label: 'Live', color: Colors.success, icon: 'circle' };
  }
  if (soldStatuses.includes(status)) {
    return { label: 'Sold', color: Colors.accent, icon: 'check-circle' };
  }
  if (archivedStatuses.includes(status)) {
    return { label: status === 'held' ? 'Held' : 'Archived', color: Colors.textTertiary, icon: 'archive' };
  }
  if (status === 'review_required') {
    return { label: 'Review', color: Colors.danger, icon: 'error' };
  }
  if (status === 'error') {
    return { label: 'Error', color: Colors.danger, icon: 'error-outline' };
  }
  // All other pre-listed states = Draft
  return { label: 'Draft', color: Colors.primary, icon: 'edit-note' };
}

function getDraftSubLabel(status: string): string {
  const labels: Record<string, string> = {
    new: 'New',
    captured: 'Captured',
    identifying: 'Identifying',
    identified: 'Identified',
    researching: 'Researching',
    researched: 'Researched',
    assessing: 'Assessing',
    assessed: 'Assessed',
    pricing: 'Pricing',
    priced: 'Ready to List',
    listing: 'Creating Listing',
    review_required: 'Needs Review',
    error: 'Error',
  };
  return labels[status] ?? status;
}

// ── Item Card ─────────────────────────────────────────────────────────────────

function ItemCard({ item, onPress }: { item: any; onPress: (id: string) => void }) {
  const router = useRouter();
  const [tvFocused, setTVFocused] = useState(false);
  const chip = getLifecycleChip(item.status);
  const hasPhoto = item.media && item.media.length > 0;
  const isDraft = chip.label === 'Draft' || chip.label === 'Review' || chip.label === 'Error';
  const isLive = chip.label === 'Live';
  const isSold = chip.label === 'Sold';

  // eBay-enriched fields (from listing join if available)
  const ebayPrice = item.listing_price ? Number(item.listing_price) : null;
  const ebayWatchers = item.listing_watchers != null ? Number(item.listing_watchers) : null;
  const ebayViews = item.listing_views != null ? Number(item.listing_views) : null;
  const condition = item.condition ?? '';

  return (
    <Pressable
      onPress={() => onPress(item.id)}
      onFocus={() => setTVFocused(true)}
      onBlur={() => setTVFocused(false)}
      isTVSelectable={IS_TV}
      accessible
      accessibilityLabel={item.canonicalTitle || item.canonical_title || 'Inventory item'}
      style={({ pressed }) => [
        styles.card,
        pressed && { opacity: 0.9, transform: [{ scale: 0.99 }] },
        isSold && styles.cardSold,
        IS_TV && tvFocused && styles.cardTVFocused,
      ]}
    >
      {/* Photo */}
      <View style={styles.cardThumb}>
        {hasPhoto ? (
          <ItemImage
            uri={item.media[0]}
            style={[styles.thumbImg, isSold && styles.thumbSold]}
            contentFit="cover"
            transition={150}
          />
        ) : (
          <View style={[styles.thumbPlaceholder, isDraft && styles.thumbDraft]}>
            <MaterialIcons
              name={isDraft ? 'edit-note' : isSold ? 'check-circle' : isLive ? 'storefront' : 'photo-camera'}
              size={isLive ? 14 : 18}
              color={isDraft ? Colors.primary : isSold ? Colors.accent : isLive ? '#E53238' : Colors.textTertiary}
            />
            {isLive ? <Text style={styles.thumbNoImageText}>No img</Text> : null}
          </View>
        )}

        {/* Status dot */}
        <View style={[styles.statusDot, { backgroundColor: chip.color }]} />

        {/* Photo count */}
        {(item.media?.length ?? 0) >= 2 ? (
          <View style={styles.photoCountBadge}>
            <MaterialIcons name="photo-library" size={8} color="#fff" />
            <Text style={styles.photoCountText}>{item.media.length}</Text>
          </View>
        ) : null}

        {/* eBay indicator for live items */}
        {isLive ? (
          <View style={styles.ebayDot}>
            <Text style={styles.ebayDotText}>e</Text>
          </View>
        ) : null}
      </View>

      {/* Content */}
      <View style={styles.cardContent}>
        {/* IDs row */}
        <View style={styles.cardTopRow}>
          {item.inventory_id ? (
            <View style={styles.kcIdBadge}>
              <Text style={styles.kcIdText}>{item.inventory_id}</Text>
            </View>
          ) : null}
          {item.catalogue_number ? (
            <View style={styles.catBadge}>
              <MaterialIcons name="tag" size={9} color={Colors.accent} />
              <Text style={styles.catBadgeText}>{item.catalogue_number}</Text>
            </View>
          ) : null}
          {item.folder_number ? (
            <View style={styles.folderBadge}>
              <MaterialIcons name="folder" size={9} color={Colors.textTertiary} />
              <Text style={styles.folderBadgeText}>
                {item.folder_number}{item.pocket_position ? ` · ${item.pocket_position}` : ''}
              </Text>
            </View>
          ) : null}
        </View>

        {/* Title — warn if missing on a live item */}
        {(() => {
          const title = item.canonicalTitle || item.canonical_title || '';
          return title && title.length > 3 ? (
            <Text style={[styles.cardTitle, isSold && styles.cardTitleSold]} numberOfLines={2}>
              {title}
            </Text>
          ) : (
            <Text style={[styles.cardTitle, { color: isLive ? Colors.warning : Colors.textTertiary, fontStyle: 'italic' }]} numberOfLines={1}>
              {isLive ? 'Title pending — tap Sync with eBay' : 'No title'}
            </Text>
          );
        })()}

        {/* eBay stats row for Live items */}
        {isLive ? (
          <View style={styles.ebayDataRow}>
            {condition ? (
              <View style={styles.conditionChip}>
                <Text style={styles.conditionText} numberOfLines={1}>{condition}</Text>
              </View>
            ) : null}
            {(ebayWatchers ?? 0) > 0 ? (
              <View style={styles.ebayStatChip}>
                <MaterialIcons name="star" size={9} color={Colors.gold} />
                <Text style={[styles.ebayStatText, { color: Colors.gold }]}>{ebayWatchers}</Text>
              </View>
            ) : null}
            {(ebayViews ?? 0) > 0 ? (
              <View style={styles.ebayStatChip}>
                <MaterialIcons name="visibility" size={9} color={Colors.textTertiary} />
                <Text style={styles.ebayStatText}>{ebayViews}</Text>
              </View>
            ) : null}
          </View>
        ) : (
          /* Coin meta for non-live items */
          <View style={styles.coinMetaRow}>
            {item.ruler ? (
              <View style={styles.metaChip}>
                <MaterialIcons name="person" size={9} color={Colors.textTertiary} />
                <Text style={styles.metaChipText} numberOfLines={1}>{item.ruler}</Text>
              </View>
            ) : null}
            {item.denomination ? (
              <View style={styles.metaChip}>
                <MaterialIcons name="monetization-on" size={9} color={Colors.gold} />
                <Text style={[styles.metaChipText, { color: Colors.gold }]} numberOfLines={1}>
                  {item.denomination}
                </Text>
              </View>
            ) : null}
            {item.year_made ? (
              <View style={styles.metaChip}>
                <Text style={styles.metaChipText}>{item.year_made}</Text>
              </View>
            ) : null}
            {item.country_of_origin ? (
              <View style={styles.metaChip}>
                <MaterialIcons name="place" size={9} color={Colors.textTertiary} />
                <Text style={styles.metaChipText} numberOfLines={1}>{item.country_of_origin}</Text>
              </View>
            ) : null}
          </View>
        )}

        {/* Bottom row */}
        <View style={styles.cardBottomRow}>
          <View style={[styles.lifecycleChip, { backgroundColor: chip.color + '20' }]}>
            <View style={[styles.lifecycleDot, { backgroundColor: chip.color }]} />
            <Text style={[styles.lifecycleText, { color: chip.color }]}>
              {chip.label === 'Draft' ? getDraftSubLabel(item.status) : chip.label}
            </Text>
          </View>
          {isSold && item.sold_price ? (
            <Text style={styles.soldPrice}>Sold £{Number(item.sold_price).toFixed(2)}</Text>
          ) : isLive && ebayPrice ? (
            <Text style={styles.cardPrice}>£{ebayPrice.toFixed(2)}</Text>
          ) : item.expected_selling_price > 0 ? (
            <Text style={styles.cardPrice}>£{Number(item.expected_selling_price).toFixed(2)}</Text>
          ) : null}
        </View>
      </View>

      {/* Create Listing shortcut — shown for non-listed, non-sold draft items */}
      {chip.label !== 'Live' && chip.label !== 'Sold' && chip.label !== 'Archived' ? (
        <Pressable
          onPress={(e) => { (e as any).stopPropagation?.(); router.push(`/create-listing?id=${item.id}` as any); }}
          style={({ pressed }) => [styles.createListingBtn, pressed && { opacity: 0.8 }]}
        >
          <MaterialIcons name="sell" size={12} color={Colors.primary} />
          <Text style={styles.createListingBtnText}>Create Listing</Text>
        </Pressable>
      ) : null}

      <MaterialIcons name="chevron-right" size={16} color={Colors.textTertiary} />
    </Pressable>
  );
}

// ── History Item Card (compact) ───────────────────────────────────────────────

function HistoryItemCard({ item, onPress }: { item: any; onPress: (id: string) => void }) {
  const chip = getLifecycleChip(item.status);
  const hasPhoto = item.media && item.media.length > 0;
  const soldAt = item.sold_at
    ? new Date(item.sold_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })
    : null;

  return (
    <Pressable
      onPress={() => onPress(item.id)}
      style={({ pressed }) => [styles.histCard, pressed && { opacity: 0.85 }]}
    >
      {hasPhoto ? (
        <ItemImage uri={item.media[0]} style={styles.histThumb} contentFit="cover" transition={100} />
      ) : (
        <View style={[styles.histThumb, styles.histThumbPlaceholder]}>
          <MaterialIcons name="toll" size={16} color={Colors.textTertiary} />
        </View>
      )}
      <View style={styles.histContent}>
        <Text style={styles.histTitle} numberOfLines={1}>{item.canonical_title}</Text>
        <View style={styles.histMeta}>
          {soldAt ? <Text style={styles.histDate}>{soldAt}</Text> : null}
          {item.inventory_id ? <Text style={styles.histId}>{item.inventory_id}</Text> : null}
        </View>
      </View>
      <View style={styles.histRight}>
        {item.sold_price ? (
          <Text style={styles.histPrice}>£{Number(item.sold_price).toFixed(2)}</Text>
        ) : item.expected_selling_price > 0 ? (
          <Text style={styles.histPrice}>£{Number(item.expected_selling_price).toFixed(2)}</Text>
        ) : null}
        <View style={[styles.histChip, { backgroundColor: chip.color + '20' }]}>
          <Text style={[styles.histChipText, { color: chip.color }]}>{chip.label}</Text>
        </View>
      </View>
    </Pressable>
  );
}

// ── Main Screen ───────────────────────────────────────────────────────────────

export default function InventoryScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { tenant } = useApp();

  // View mode: active inventory or history
  const [viewMode, setViewMode] = useState<ViewMode>('active');

  // Active sub-filter
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>('all');
  const [coinFilter, setCoinFilter] = useState<CoinFilter>('all');

  // History sub-filter
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>('all');

  // Search
  const [search, setSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  // History data (separate fetch)
  const [historyItems, setHistoryItems] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);

  // Bulk Re-Value + Bulk Re-Identify sheet state
  const [showReValue, setShowReValue] = useState(false);
  const [showBulkReIdentify, setShowBulkReIdentify] = useState(false);
  const [bulkReIdentifyProgress, setBulkReIdentifyProgress] = useState<{ current: number; total: number; done: number; failed: number } | null>(null);
  const { config: bizConfig } = useBusinessConfig();
  const autonomousMode = bizConfig?.auto_value === true || bizConfig?.automation_level === 'autonomous' || bizConfig?.automation_level === 'auto_approval';

  // Guard: don't fire background image sync more than once per pull-to-refresh
  const imageSyncRunning = useRef(false);
  // Sync banner shown while background eBay sync is running
  const [syncBanner, setSyncBanner] = useState<string | null>(null);

  // Build active-inventory filter
  const activeInventoryFilter = useMemo(() => {
    const f: any = {};
    if (activeFilter === 'draft') f.statuses = ITEM_LIFECYCLE.DRAFT_STATUSES;
    else if (activeFilter === 'live') f.statuses = ITEM_LIFECYCLE.LIVE_STATUSES;
    else if (activeFilter === 'review') f.statuses = ['review_required'];
    else f.lifecycleGroup = 'active';
    // Build combined search term from text search + coin type filter
    const parts: string[] = [];
    if (search.trim()) parts.push(search.trim());
    if (coinFilter !== 'all') parts.push(coinFilter);
    if (parts.length > 0) f.search = parts[0]; // server handles single term ilike
    return f;
  }, [activeFilter, search, coinFilter]);

  const { items: rawItems, loading, stats, statusGroups, reload } = useInventory(activeInventoryFilter);

  // Client-side post-filter for needs_id / needs_value
  const items = useMemo(() => {
    if (activeFilter === 'needs_id') {
      return rawItems.filter((i: any) => !i.identificationConfidence || Number(i.identificationConfidence) < 0.50 || (i.canonicalTitle || i.canonical_title) === 'Unidentified Item');
    }
    if (activeFilter === 'needs_value') {
      return rawItems.filter((i: any) => !i.valuationMid && !i.valuation_mid);
    }
    return rawItems;
  }, [rawItems, activeFilter]);

  // Derived counts
  const needsIdCount = useMemo(() => rawItems.filter((i: any) => !i.identificationConfidence || Number(i.identificationConfidence) < 0.50).length, [rawItems]);
  const needsValueCount = useMemo(() => rawItems.filter((i: any) => !i.valuationMid && !i.valuation_mid).length, [rawItems]);

  // Load history when user taps that tab
  const loadHistory = useCallback(async () => {
    if (!tenant?.id) return;
    setHistoryLoading(true);
    let statuses: string[];
    if (historyFilter === 'sold') statuses = ITEM_LIFECYCLE.SOLD_STATUSES;
    else if (historyFilter === 'archived') statuses = ITEM_LIFECYCLE.ARCHIVED_STATUSES;
    else statuses = HISTORY_STATUSES;
    const f: any = { statuses };
    if (search.trim()) f.search = search.trim();
    const { items: hist } = await listItems(tenant.id, f);
    setHistoryItems(hist);
    setHistoryLoaded(true);
    setHistoryLoading(false);
  }, [tenant?.id, historyFilter, search]);

  const handleViewMode = useCallback((mode: ViewMode) => {
    setViewMode(mode);
    if (mode === 'history') loadHistory();
  }, [loadHistory]);

  // Re-load history when filter changes
  const handleHistoryFilter = useCallback((f: HistoryFilter) => {
    setHistoryFilter(f);
    setHistoryLoaded(false);
  }, []);

  // When historyFilter changes and we're in history mode, reload
  React.useEffect(() => {
    if (viewMode === 'history' && !historyLoaded) loadHistory();
  }, [viewMode, historyLoaded, loadHistory]);

  /**
   * Pull-to-refresh: reload inventory data, then silently check for items
   * that still have eBay CDN images (not permanently stored in Supabase Storage).
   * If any are found, fire swish-image-download in the background — fire and forget.
   */
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    if (viewMode === 'active') await reload?.();
    else { setHistoryLoaded(false); await loadHistory(); }
    setRefreshing(false);

    // Background image/data sync check
    if (viewMode === 'active' && tenant?.id && !imageSyncRunning.current) {
      imageSyncRunning.current = true;
      const tenantId = tenant.id;
      const supabase = getSupabaseClient();
      (async () => {
        try {
          const needs = await tenantNeedsImageSync(tenantId);
          if (needs) {
            setSyncBanner('Syncing eBay images in background...');
            await fetchAndStoreEbayImages(tenantId, { fixTitles: true });
            setSyncBanner(null);
            // Re-load items after sync so new images show immediately
            await reload?.();
          }
        } catch {
          setSyncBanner(null);
        } finally {
          imageSyncRunning.current = false;
        }
      })();
    }
  }, [viewMode, reload, loadHistory, tenant?.id]);

  // Active inventory display count
  const displayCount = viewMode === 'active' ? items.length : historyItems.length;

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      {/* ── Header ─────────────────────────────────────────────────── */}
      <View style={[styles.header, { paddingTop: insets.top + Spacing.base }]}>
        <View style={styles.headerLeft}>
          <Text style={styles.title}>
            {viewMode === 'active' ? 'Inventory' : 'History'}
          </Text>
          <Text style={styles.subtitle}>
            {viewMode === 'active'
              ? `${stats.activeTotal} active · ${stats.draftCount} draft · ${stats.liveCount} live`
              : `${historyItems.length} ${historyFilter === 'sold' ? 'sold' : historyFilter === 'archived' ? 'archived' : 'historical'} items`
            }
          </Text>
        </View>
        <View style={styles.headerRight}>
          {viewMode === 'active' && stats.activeTotal > 0 ? (
            <Pressable
              onPress={() => setShowReValue(true)}
              style={[styles.addBtn, styles.reValueBtn]}
              hitSlop={8}
            >
              <MaterialIcons name="travel-explore" size={16} color={Colors.primary} />
            </Pressable>
          ) : null}
          {viewMode === 'active' && items.length > 0 ? (
            <Pressable
              onPress={() => setShowBulkReIdentify(true)}
              style={[styles.addBtn, { backgroundColor: Colors.accentDim, borderWidth: 1, borderColor: Colors.accent + '60' }]}
              hitSlop={8}
            >
              <MaterialIcons name="auto-awesome" size={16} color={Colors.accent} />
            </Pressable>
          ) : null}
          {viewMode === 'active' ? (
            <Pressable
              onPress={() => router.push('/review-required' as any)}
              style={[styles.addBtn, styles.reviewBtn]}
              hitSlop={8}
            >
              <MaterialIcons name="warning" size={16} color={Colors.warning} />
            </Pressable>
          ) : null}
          {viewMode === 'active' ? (
            <Pressable
              onPress={() => router.navigate('/(tabs)/scan')}
              style={styles.addBtn}
              hitSlop={8}
            >
              <MaterialIcons name="add" size={18} color={Colors.background} />
            </Pressable>
          ) : null}
        </View>
      </View>

      {/* ── Lifecycle Stats Strip ──────────────────────────────────── */}
      <View style={styles.statsStrip}>
        <Pressable
          onPress={() => handleViewMode('active')}
          style={[styles.statItem, viewMode === 'active' && styles.statItemActive]}
        >
          <Text style={[styles.statValue, { color: Colors.primary }]}>
            {stats.activeTotal}
          </Text>
          <Text style={styles.statLabel}>Active</Text>
          {viewMode === 'active' ? <View style={styles.statActiveLine} /> : null}
        </Pressable>
        <Pressable
          onPress={() => { handleViewMode('active'); setActiveFilter('draft'); }}
          style={styles.statItem}
        >
          <Text style={[styles.statValue, { color: Colors.textSecondary }]}>
            {stats.draftCount}
          </Text>
          <Text style={styles.statLabel}>Draft</Text>
        </Pressable>
        <Pressable
          onPress={() => { handleViewMode('active'); setActiveFilter('live'); }}
          style={styles.statItem}
        >
          <Text style={[styles.statValue, { color: Colors.success }]}>
            {stats.liveCount}
          </Text>
          <Text style={styles.statLabel}>Live</Text>
        </Pressable>
        <Pressable
          onPress={() => handleViewMode('history')}
          style={[styles.statItem, viewMode === 'history' && styles.statItemActive]}
        >
          <Text style={[styles.statValue, { color: Colors.accent }]}>
            {stats.soldCount}
          </Text>
          <Text style={styles.statLabel}>Sold</Text>
          {viewMode === 'history' ? <View style={[styles.statActiveLine, { backgroundColor: Colors.accent }]} /> : null}
        </Pressable>
      </View>

      {/* ── View Mode Tabs ─────────────────────────────────────────── */}
      <View style={styles.modeTabs}>
        <Pressable
          onPress={() => handleViewMode('active')}
          style={[styles.modeTab, viewMode === 'active' && styles.modeTabActive]}
        >
          <MaterialIcons
            name="inventory"
            size={14}
            color={viewMode === 'active' ? Colors.primary : Colors.textTertiary}
          />
          <Text style={[styles.modeTabText, viewMode === 'active' && styles.modeTabTextActive]}>
            Active Inventory
          </Text>
          {stats.activeTotal > 0 ? (
            <View style={[styles.modeTabBadge, viewMode === 'active' && styles.modeTabBadgeActive]}>
              <Text style={[styles.modeTabBadgeText, viewMode === 'active' && { color: Colors.primary }]}>
                {stats.activeTotal}
              </Text>
            </View>
          ) : null}
        </Pressable>
        <Pressable
          onPress={() => handleViewMode('history')}
          style={[styles.modeTab, viewMode === 'history' && styles.modeTabActive]}
        >
          <MaterialIcons
            name="history"
            size={14}
            color={viewMode === 'history' ? Colors.accent : Colors.textTertiary}
          />
          <Text style={[styles.modeTabText, viewMode === 'history' && { color: Colors.accent }]}>
            History
          </Text>
          {stats.soldCount > 0 ? (
            <View style={[styles.modeTabBadge, viewMode === 'history' && { backgroundColor: Colors.accentDim }]}>
              <Text style={[styles.modeTabBadgeText, viewMode === 'history' && { color: Colors.accent }]}>
                {stats.soldCount + stats.archivedCount}
              </Text>
            </View>
          ) : null}
        </Pressable>
      </View>

      {/* ── Search ────────────────────────────────────────────────── */}
      <View style={styles.searchWrap}>
        <MaterialIcons name="search" size={16} color={Colors.textTertiary} style={{ marginLeft: Spacing.sm }} />
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={v => { setSearch(v); if (viewMode === 'history') setHistoryLoaded(false); }}
          placeholder="KC ID, catalogue no., folder, ruler, denomination..."
          placeholderTextColor={Colors.textTertiary}
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
        {search.length > 0 ? (
          <Pressable onPress={() => { setSearch(''); if (viewMode === 'history') setHistoryLoaded(false); }} hitSlop={8} style={{ marginRight: Spacing.sm }}>
            <MaterialIcons name="close" size={14} color={Colors.textTertiary} />
          </Pressable>
        ) : null}
      </View>

      {/* ── Islamic Silver Quick-Entry Banner ────────────────────── */}
      {viewMode === 'active' ? (
        <Pressable
          onPress={() => router.push('/islamic-batch' as any)}
          style={({ pressed }) => [styles.islamicBanner, pressed && { opacity: 0.85 }]}
        >
          <View style={styles.islamicBannerIcon}>
            <MaterialIcons name="toll" size={18} color="#A8B5C0" />
          </View>
          <View style={styles.islamicBannerText}>
            <Text style={styles.islamicBannerTitle}>Islamic & Indian Silver</Text>
            <Text style={styles.islamicBannerSub}>Zeno · Numista · Evidence-based · Countermark analysis</Text>
          </View>
          <View style={styles.islamicBannerArrow}>
            <MaterialIcons name="arrow-forward" size={14} color="#A8B5C0" />
          </View>
        </Pressable>
      ) : null}

      {/* ── Sub-filters ────────────────────────────────────────────── */}
      {viewMode === 'active' ? (
        <View style={styles.filterOuter}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterContent}>
            {([
              { label: 'All', value: 'all' as ActiveFilter, color: Colors.primary, count: stats.activeTotal },
              { label: 'Draft', value: 'draft' as ActiveFilter, color: Colors.textSecondary, count: stats.draftCount },
              { label: 'Live', value: 'live' as ActiveFilter, color: Colors.success, count: stats.liveCount },
              { label: 'Needs ID', value: 'needs_id' as ActiveFilter, color: Colors.warning, count: needsIdCount },
              { label: 'Needs Value', value: 'needs_value' as ActiveFilter, color: Colors.gold, count: needsValueCount },
              { label: 'Review', value: 'review' as ActiveFilter, color: Colors.danger, count: statusGroups?.['review_required'] ?? 0 },
            ] as Array<{ label: string; value: ActiveFilter; color: string; count: number }>).map(f => {
              const active = activeFilter === f.value;
              return (
                <Pressable
                  key={f.value}
                  onPress={() => setActiveFilter(f.value as ActiveFilter)}
                  style={[styles.filterChip, active && styles.filterChipActive]}
                >
                  <View style={[styles.filterDot, { backgroundColor: active ? f.color : Colors.textTertiary }]} />
                  <Text style={[styles.filterLabel, active && { color: f.color }]}>{f.label}</Text>
                  {(f.count ?? 0) > 0 ? (
                    <Text style={[styles.filterCount, active && { color: f.color }]}>{f.count}</Text>
                  ) : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      ) : (
        <View style={styles.filterOuter}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterContent}>
            {([
              { label: 'All History', value: 'all' as HistoryFilter, color: Colors.textSecondary },
              { label: 'Sold', value: 'sold' as HistoryFilter, color: Colors.accent },
              { label: 'Archived', value: 'archived' as HistoryFilter, color: Colors.textTertiary },
            ] as Array<{ label: string; value: HistoryFilter; color: string }>).map(f => {
              const active = historyFilter === f.value;
              const cnt = f.value === 'all'
                ? stats.soldCount + stats.archivedCount
                : f.value === 'sold' ? stats.soldCount
                : stats.archivedCount;
              return (
                <Pressable
                  key={f.value}
                  onPress={() => handleHistoryFilter(f.value)}
                  style={[styles.filterChip, active && styles.filterChipActive]}
                >
                  <View style={[styles.filterDot, { backgroundColor: active ? f.color : Colors.textTertiary }]} />
                  <Text style={[styles.filterLabel, active && { color: f.color }]}>{f.label}</Text>
                  {cnt > 0 ? (
                    <Text style={[styles.filterCount, active && { color: f.color }]}>{cnt}</Text>
                  ) : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      )}

      {/* ── Coin-type sub-filter (shown in active view) ─────────────── */}
      {viewMode === 'active' && items.length > 0 ? (
        <View style={{ borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ flexDirection: 'row', gap: Spacing.xs, paddingHorizontal: Spacing.base, paddingVertical: Spacing.xs }}>
            {([
              { label: 'All Types', value: 'all' as CoinFilter },
              { label: 'Silver', value: 'silver' as CoinFilter },
              { label: 'Gold', value: 'gold' as CoinFilter },
              { label: 'British', value: 'british' as CoinFilter },
              { label: 'Ancient', value: 'ancient' as CoinFilter },
              { label: 'Islamic', value: 'islamic' as CoinFilter },
              { label: 'Medieval', value: 'medieval' as CoinFilter },
              { label: 'Roman', value: 'roman' as CoinFilter },
            ] as Array<{ label: string; value: CoinFilter }>).map(f => (
              <Pressable
                key={f.value}
                onPress={() => setCoinFilter(f.value)}
                style={[{
                  paddingHorizontal: Spacing.sm, paddingVertical: 4, borderRadius: Radius.pill,
                  backgroundColor: coinFilter === f.value ? Colors.accentDim : Colors.surface,
                  borderWidth: 1, borderColor: coinFilter === f.value ? Colors.accent + '60' : Colors.surfaceBorder,
                }]}
              >
                <Text style={{ fontSize: 10, color: coinFilter === f.value ? Colors.accent : Colors.textTertiary, fontWeight: coinFilter === f.value ? Typography.weight.bold : Typography.weight.regular }}>
                  {f.label}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}

      {/* ── Bulk Re-Identify Modal ─────────────────────────────── */}
      <BulkReIdentifyModal
        visible={showBulkReIdentify}
        items={items}
        tenantId={tenant?.id ?? ''}
        progress={bulkReIdentifyProgress}
        onProgress={setBulkReIdentifyProgress}
        onClose={() => { setShowBulkReIdentify(false); setBulkReIdentifyProgress(null); reload?.(); }}
      />

      {/* ── Bulk Re-Value Sheet ─────────────────────────────────── */}
      {tenant?.id ? (
        <BulkReValueSheet
          visible={showReValue}
          onClose={() => { setShowReValue(false); reload?.(); }}
          tenantId={tenant.id}
          items={items.map(i => ({
            id: i.id,
            canonical_title: i.canonicalTitle ?? '',
            specialist_id: i.specialistId ?? 'curiosities_collectibles',
            condition: i.condition ?? '',
            attributes: i.attributes ?? {},
            media: i.media ?? [],
          })).filter(i => i.canonical_title && i.canonical_title.length > 3)}
          autonomousMode={autonomousMode}
        />
      ) : null}

      {/* ── Content ───────────────────────────────────────────────── */}
      {syncBanner ? (
        <Pressable onPress={() => setSyncBanner(null)} style={styles.syncBanner}>
          <ActivityIndicator size="small" color="#E53238" style={{ width: 14, height: 14 }} />
          <Text style={styles.syncBannerText}>{syncBanner}</Text>
          <MaterialIcons name="close" size={12} color="#E53238" />
        </Pressable>
      ) : null}

      {viewMode === 'active' ? (
          loading ? (
            <View style={styles.loading}>
              <ActivityIndicator color={Colors.primary} size="large" />
            </View>
          ) : (
            <FlatList
              data={items}
              keyExtractor={i => i.id}
              contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 100 }]}
              showsVerticalScrollIndicator={false}
              ItemSeparatorComponent={() => <View style={{ height: Spacing.sm }} />}
              refreshControl={
                <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />
              }
              renderItem={({ item }) => (
                <ItemCard item={item} onPress={id => router.push(`/stock-listing/${id}` as any)} />
              )}
              ListEmptyComponent={
                <View style={styles.empty}>
                  <View style={styles.emptyIconWrap}>
                    <MaterialIcons name="inventory" size={40} color={Colors.primary} />
                  </View>
                  <Text style={styles.emptyTitle}>
                    {search
                      ? 'No items found'
                      : activeFilter === 'live'
                      ? 'No live listings yet'
                      : activeFilter === 'draft'
                      ? 'No drafts'
                      : 'Active inventory is empty'
                    }
                  </Text>
                  <Text style={styles.emptyText}>
                    {search
                      ? `No active items match "${search}"`
                      : activeFilter === 'live'
                      ? 'Items appear here once published to eBay'
                      : activeFilter === 'draft'
                      ? 'Scan an item or import from eBay to start'
                      : 'Scan a new item or import your eBay inventory to get started'
                    }
                  </Text>
                  {activeFilter !== 'live' ? (
                    <View style={styles.emptyActions}>
                      <Pressable
                        onPress={() => router.navigate('/(tabs)/scan')}
                        style={styles.emptyPrimaryBtn}
                      >
                        <MaterialIcons name="qr-code-scanner" size={15} color={Colors.background} />
                        <Text style={styles.emptyPrimaryBtnText}>Scan Item</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => router.push('/ebay-import' as any)}
                        style={styles.emptySecondaryBtn}
                      >
                        <MaterialIcons name="cloud-download" size={15} color={Colors.primary} />
                        <Text style={styles.emptySecondaryBtnText}>Import eBay</Text>
                      </Pressable>
                    </View>
                  ) : null}
                </View>
              }
            />
          )
        ) : (
        /* History view */
        historyLoading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={Colors.accent} size="large" />
          </View>
        ) : (
          <FlatList
            data={historyItems}
            keyExtractor={i => i.id}
            contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 100 }]}
            showsVerticalScrollIndicator={false}
            ItemSeparatorComponent={() => <View style={styles.histDivider} />}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.accent} />
            }
            renderItem={({ item }) => (
              <HistoryItemCard item={item} onPress={id => router.push(`/stock-listing/${id}` as any)} />
            )}
            ListHeaderComponent={
              historyItems.length > 0 ? (
                <View style={styles.histHeader}>
                  <MaterialIcons name="history" size={14} color={Colors.textTertiary} />
                  <Text style={styles.histHeaderText}>
                    Historical records — {historyItems.length} item{historyItems.length === 1 ? '' : 's'}
                  </Text>
                </View>
              ) : null
            }
            ListEmptyComponent={
              <View style={styles.empty}>
                <View style={[styles.emptyIconWrap, { backgroundColor: Colors.accentDim }]}>
                  <MaterialIcons name="history" size={40} color={Colors.accent} />
                </View>
                <Text style={styles.emptyTitle}>
                  {historyFilter === 'sold' ? 'No sold items yet' : historyFilter === 'archived' ? 'Nothing archived' : 'No history yet'}
                </Text>
                <Text style={styles.emptyText}>
                  {historyFilter === 'sold'
                    ? 'Items appear here once marked as sold on eBay'
                    : 'Items you remove from sale will appear here'}
                </Text>
              </View>
            }
          />
        )
      )}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between',
    paddingHorizontal: Spacing.base, paddingBottom: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder,
  },
  headerLeft: { flex: 1 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  title: { fontSize: Typography.size.xl, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  subtitle: { fontSize: Typography.size.xs, color: Colors.textTertiary, marginTop: 2 },
  addBtn: {
    width: 34, height: 34, borderRadius: Radius.md,
    backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center',
  },
  reValueBtn: {
    backgroundColor: Colors.primaryDim,
    borderWidth: 1, borderColor: Colors.primary + '60',
  },
  reviewBtn: {
    backgroundColor: Colors.warningDim,
    borderWidth: 1, borderColor: Colors.warning + '60',
  },

  // Stats strip
  statsStrip: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.base, paddingVertical: Spacing.sm,
    borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder,
  },
  statItem: { flex: 1, alignItems: 'center', gap: 2, position: 'relative', paddingBottom: 4 },
  statItemActive: {},
  statActiveLine: {
    position: 'absolute', bottom: 0, left: 8, right: 8, height: 2,
    backgroundColor: Colors.primary, borderRadius: Radius.pill,
  },
  statValue: { fontSize: Typography.size.md, fontWeight: Typography.weight.bold },
  statLabel: { fontSize: 9, color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.3 },

  // Mode tabs
  modeTabs: {
    flexDirection: 'row', gap: Spacing.sm,
    paddingHorizontal: Spacing.base, paddingVertical: Spacing.sm,
    borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder,
  },
  modeTab: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: Spacing.xs, paddingVertical: Spacing.xs + 2,
    borderRadius: Radius.md, backgroundColor: Colors.surface,
    borderWidth: 1, borderColor: Colors.surfaceBorder,
  },
  modeTabActive: { backgroundColor: Colors.primaryDim, borderColor: Colors.primary + '50' },
  modeTabText: { fontSize: Typography.size.xs, color: Colors.textTertiary, fontWeight: Typography.weight.medium },
  modeTabTextActive: { color: Colors.primary, fontWeight: Typography.weight.semibold },
  modeTabBadge: {
    backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.pill,
    paddingHorizontal: 5, paddingVertical: 1,
  },
  modeTabBadgeActive: { backgroundColor: Colors.primaryDim },
  modeTabBadgeText: { fontSize: 9, fontWeight: Typography.weight.bold, color: Colors.textTertiary },

  // Search
  searchWrap: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: Spacing.base, marginTop: Spacing.sm, marginBottom: Spacing.xs,
    backgroundColor: Colors.surface, borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.surfaceBorder, height: 40,
  },
  searchInput: {
    flex: 1, fontSize: Typography.size.sm, color: Colors.textPrimary,
    paddingVertical: 0, paddingHorizontal: Spacing.xs, includeFontPadding: false,
  },

  // Sub-filters
  filterOuter: { borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder },
  filterContent: {
    flexDirection: 'row', gap: Spacing.xs,
    paddingHorizontal: Spacing.base, paddingVertical: Spacing.sm,
  },
  filterChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs + 2,
    borderRadius: Radius.pill, backgroundColor: Colors.surface,
    borderWidth: 1, borderColor: Colors.surfaceBorder,
  },
  filterChipActive: { backgroundColor: Colors.surfaceHighlight, borderColor: Colors.surfaceBorder },
  filterDot: { width: 5, height: 5, borderRadius: 3 },
  filterLabel: { fontSize: Typography.size.xs, color: Colors.textSecondary, fontWeight: Typography.weight.medium },
  filterCount: { fontSize: Typography.size.xs - 1, color: Colors.textTertiary, fontWeight: Typography.weight.bold },

  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { paddingHorizontal: Spacing.base, paddingTop: Spacing.sm },

  // ── Item Card ────────────────────────────────────────────────────
  card: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.surface, borderRadius: Radius.xl,
    padding: Spacing.md, borderWidth: 1, borderColor: Colors.surfaceBorder,
    ...Shadow.sm,
  },
  cardSold: { opacity: 0.7 },
  cardTVFocused: {
    borderColor: Colors.primary,
    borderWidth: 2,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.7,
    shadowRadius: 10,
    elevation: 10,
  },
  cardThumb: { position: 'relative', width: 60, height: 60, flexShrink: 0 },
  thumbImg: { width: 60, height: 60, borderRadius: Radius.md },
  thumbSold: { opacity: 0.6 },
  thumbPlaceholder: {
    width: 60, height: 60, borderRadius: Radius.md,
    backgroundColor: Colors.surfaceHighlight,
    alignItems: 'center', justifyContent: 'center',
  },
  thumbDraft: { backgroundColor: Colors.primaryDim, borderWidth: 1.5, borderColor: Colors.primary + '40' },
  statusDot: {
    position: 'absolute', bottom: 2, right: 2,
    width: 8, height: 8, borderRadius: 4,
    borderWidth: 1.5, borderColor: Colors.surface,
  },
  photoCountBadge: {
    position: 'absolute', top: 3, right: 3,
    flexDirection: 'row', alignItems: 'center', gap: 2,
    backgroundColor: 'rgba(0,0,0,0.62)', borderRadius: Radius.pill,
    paddingHorizontal: 4, paddingVertical: 2,
  },
  photoCountText: { fontSize: 8, fontWeight: Typography.weight.bold, color: '#fff', lineHeight: 10, includeFontPadding: false },
  ebayDot: {
    position: 'absolute', top: 2, left: 2,
    width: 14, height: 14, borderRadius: 7,
    backgroundColor: '#E53238', alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.surface,
  },
  ebayDotText: { fontSize: 8, fontWeight: Typography.weight.extrabold, color: '#fff', includeFontPadding: false },

  cardContent: { flex: 1, gap: 4 },
  cardTopRow: { flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' },
  kcIdBadge: {
    backgroundColor: Colors.primaryDim, borderRadius: Radius.sm,
    paddingHorizontal: 5, paddingVertical: 2,
    borderWidth: 1, borderColor: Colors.primary + '40',
  },
  kcIdText: { fontSize: 9, fontWeight: Typography.weight.bold, color: Colors.primary, letterSpacing: 0.4 },
  catBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    backgroundColor: Colors.accentDim, borderRadius: Radius.sm,
    paddingHorizontal: 5, paddingVertical: 2,
  },
  catBadgeText: { fontSize: 9, color: Colors.accent, fontWeight: Typography.weight.semibold },
  folderBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.sm,
    paddingHorizontal: 5, paddingVertical: 2,
  },
  folderBadgeText: { fontSize: 9, color: Colors.textTertiary },

  cardTitle: {
    fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold,
    color: Colors.textPrimary, lineHeight: 17,
  },
  cardTitleSold: { color: Colors.textTertiary },
  thumbNoImageText: { fontSize: 7, color: '#E53238', fontWeight: Typography.weight.bold, marginTop: 1 },
  ebayDataRow: { flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' },
  conditionChip: {
    backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.sm,
    paddingHorizontal: 5, paddingVertical: 2, maxWidth: 120,
  },
  conditionText: { fontSize: 9, color: Colors.textTertiary },
  ebayStatChip: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.sm,
    paddingHorizontal: 4, paddingVertical: 2,
  },
  ebayStatText: { fontSize: 9, color: Colors.textTertiary, fontWeight: Typography.weight.semibold },
  coinMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' },
  metaChip: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.sm,
    paddingHorizontal: 4, paddingVertical: 2,
  },
  metaChipText: { fontSize: 9, color: Colors.textTertiary, maxWidth: 80 },

  cardBottomRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flexWrap: 'wrap' },
  lifecycleChip: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: Radius.pill, paddingHorizontal: 7, paddingVertical: 3 },
  lifecycleDot: { width: 5, height: 5, borderRadius: 3 },
  lifecycleText: { fontSize: 9, fontWeight: Typography.weight.bold },
  cardPrice: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.gold, marginLeft: 'auto' },
  soldPrice: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.accent, marginLeft: 'auto' },

  // History card
  histCard: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingVertical: Spacing.sm, paddingHorizontal: 0,
  },
  histThumb: { width: 44, height: 44, borderRadius: Radius.md, flexShrink: 0 },
  histThumbPlaceholder: {
    backgroundColor: Colors.surfaceHighlight, alignItems: 'center', justifyContent: 'center',
  },
  histContent: { flex: 1, gap: 3 },
  histTitle: { fontSize: Typography.size.sm, fontWeight: Typography.weight.medium, color: Colors.textSecondary },
  histMeta: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  histDate: { fontSize: 10, color: Colors.textTertiary },
  histId: { fontSize: 10, color: Colors.textTertiary, fontStyle: 'italic' },
  histRight: { alignItems: 'flex-end', gap: 4 },
  histPrice: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.textSecondary },
  histChip: { borderRadius: Radius.pill, paddingHorizontal: 7, paddingVertical: 3 },
  histChipText: { fontSize: 9, fontWeight: Typography.weight.semibold },
  histDivider: { height: 1, backgroundColor: Colors.surfaceBorder, marginLeft: 44 + Spacing.md },
  histHeader: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.xs,
    paddingBottom: Spacing.sm,
  },
  histHeaderText: { fontSize: Typography.size.xs, color: Colors.textTertiary },

  // Empty state
  empty: {
    alignItems: 'center', paddingVertical: 60, paddingHorizontal: Spacing.xl, gap: Spacing.md,
  },
  emptyIconWrap: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: Colors.primaryDim, alignItems: 'center', justifyContent: 'center',
  },
  emptyTitle: { fontSize: Typography.size.lg, fontWeight: Typography.weight.semibold, color: Colors.textSecondary, textAlign: 'center' },
  emptyText: { fontSize: Typography.size.sm, color: Colors.textTertiary, textAlign: 'center', lineHeight: 20 },
  emptyActions: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.xs },
  emptyPrimaryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.xs,
    backgroundColor: Colors.primary, borderRadius: Radius.pill,
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm,
  },
  emptyPrimaryBtnText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.background },
  emptySecondaryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.xs,
    backgroundColor: Colors.surface, borderRadius: Radius.pill,
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm,
    borderWidth: 1, borderColor: Colors.primary + '50',
  },
  emptySecondaryBtnText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.primary },
  createListingBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.primaryDim,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: Colors.primary + '40',
    alignSelf: 'flex-start',
  },
  createListingBtnText: {
    fontSize: 10,
    fontWeight: Typography.weight.semibold,
    color: Colors.primary,
  },
  syncBanner: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: '#E5323812', paddingHorizontal: Spacing.base, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: '#E5323830',
  },
  syncBannerText: { flex: 1, fontSize: Typography.size.xs, color: '#E53238', fontWeight: Typography.weight.medium },

  // Islamic Silver banner
  islamicBanner: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    marginHorizontal: Spacing.base, marginTop: Spacing.sm,
    backgroundColor: '#1A2028', borderRadius: Radius.lg,
    padding: Spacing.md, borderWidth: 1, borderColor: '#A8B5C020',
  },
  islamicBannerIcon: {
    width: 36, height: 36, borderRadius: Radius.md,
    backgroundColor: '#A8B5C015', borderWidth: 1, borderColor: '#A8B5C030',
    alignItems: 'center', justifyContent: 'center',
  },
  islamicBannerText: { flex: 1, gap: 2 },
  islamicBannerTitle: {
    fontSize: Typography.size.xs, fontWeight: Typography.weight.bold,
    color: '#C8D5E0', letterSpacing: 0.2,
  },
  islamicBannerSub: {
    fontSize: 9, color: '#6B7A87', lineHeight: 13,
  },
  islamicBannerArrow: {
    width: 26, height: 26, borderRadius: Radius.sm,
    backgroundColor: '#A8B5C015', alignItems: 'center', justifyContent: 'center',
  },
});
