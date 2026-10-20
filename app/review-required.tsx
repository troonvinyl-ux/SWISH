// SWISH — Review Required Queue
//
// Lists all items that need attention before they can be listed on eBay:
//   • status = 'review_required'
//   • identification confidence < 50%
//   • missing market value (valuationMid = 0)
//   • no eBay category confirmed
//
// Sorted: medals first (object_type = 'medal'), then by confidence ascending
// (lowest-confidence items most urgently need attention).
//
// Each card shows the specific reason(s) for review, links to the item's
// stock-listing screen, and — where the item has enough data — shows a
// 'Create Listing' shortcut.

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList, Pressable,
  ActivityIndicator, RefreshControl, ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Colors, Typography, Spacing, Radius, Shadow } from '@/constants/theme';
import { useApp } from '@/hooks/useApp';
import { listItems, Item, ACTIVE_INVENTORY_STATUSES } from '@/services/itemService';

// ─────────────────────────────────────────────────────────────────────────────
// REASON DERIVATION
// ─────────────────────────────────────────────────────────────────────────────

interface ReviewReason {
  code: string;
  label: string;
  icon: string;
  color: string;
  priority: number; // lower = more critical
}

function getReviewReasons(item: Item): ReviewReason[] {
  const reasons: ReviewReason[] = [];
  const idConf = item.identificationConfidence ?? 0;
  const objectType = item.attributes?.object_type as string | undefined;
  const hasCategory = !!(item.attributes?.ebay_category_id);
  const hasMarketValue = item.valuationMid > 0;

  // 1. Extremely low confidence — barely identified
  if (idConf < 0.30) {
    reasons.push({
      code: 'very_low_confidence',
      label: `Very low confidence: ${Math.round(idConf * 100)}% — manual identification needed`,
      icon: 'error',
      color: Colors.danger,
      priority: 1,
    });
  } else if (idConf < 0.50) {
    reasons.push({
      code: 'low_confidence',
      label: `Low confidence: ${Math.round(idConf * 100)}% — verify before listing`,
      icon: 'warning',
      color: Colors.warning,
      priority: 2,
    });
  }

  // 2. Medal / token — requires specific identification check
  if (objectType === 'medal') {
    reasons.push({
      code: 'medal_review',
      label: 'Medal — confirm event, person, and date before listing',
      icon: 'military-tech',
      color: Colors.gold,
      priority: 3,
    });
  } else if (objectType === 'token') {
    reasons.push({
      code: 'token_review',
      label: 'Token — confirm issuer and denomination before listing',
      icon: 'paid',
      color: Colors.gold,
      priority: 3,
    });
  }

  // 3. Missing market value
  if (!hasMarketValue) {
    reasons.push({
      code: 'no_market_value',
      label: 'Market value not established — run Re-Value',
      icon: 'bar-chart',
      color: Colors.primary,
      priority: 4,
    });
  }

  // 4. No eBay category
  if (!hasCategory) {
    reasons.push({
      code: 'no_category',
      label: 'No eBay category — required before listing',
      icon: 'category',
      color: Colors.info,
      priority: 5,
    });
  }

  // 5. Has alteration / hole
  if (item.attributes?.has_hole) {
    reasons.push({
      code: 'has_hole',
      label: 'Pierced/holed — must be disclosed in listing',
      icon: 'report',
      color: Colors.danger,
      priority: 2,
    });
  }

  // 6. Observation-only identification state
  const identState = item.attributes?.identification_state as string | undefined;
  if (identState === 'observation_only') {
    reasons.push({
      code: 'observation_only',
      label: 'Observation only — no catalogue or source confirmation',
      icon: 'visibility',
      color: Colors.textTertiary,
      priority: 6,
    });
  }

  // 7. Explicit review_required status with no other reason captured
  if (item.status === 'review_required' && reasons.length === 0) {
    reasons.push({
      code: 'status_review',
      label: 'Flagged for review — check identification and valuation',
      icon: 'flag',
      color: Colors.warning,
      priority: 5,
    });
  }

  return reasons.sort((a, b) => a.priority - b.priority);
}

// Whether an item is ready to list despite needing review (has identification + category)
function isReadyToList(item: Item): boolean {
  const idConf = item.identificationConfidence ?? 0;
  const hasCategory = !!(item.attributes?.ebay_category_id);
  return idConf >= 0.30 && hasCategory && item.status !== 'sold' && item.status !== 'listed' && item.status !== 'active';
}

// ─────────────────────────────────────────────────────────────────────────────
// SORT ORDER
// ─────────────────────────────────────────────────────────────────────────────

function getObjectTypeSortKey(item: Item): number {
  const t = item.attributes?.object_type as string | undefined;
  if (t === 'medal') return 0;
  if (t === 'token') return 1;
  if (t === 'coin') return 3;
  if (t === 'unknown' || !t) return 4;
  return 2;
}

function sortItems(items: Item[]): Item[] {
  return [...items].sort((a, b) => {
    // 1. Object type: medals first
    const typeDiff = getObjectTypeSortKey(a) - getObjectTypeSortKey(b);
    if (typeDiff !== 0) return typeDiff;
    // 2. Confidence: lowest first (most urgent)
    return (a.identificationConfidence ?? 0) - (b.identificationConfidence ?? 0);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// FILTER TABS
// ─────────────────────────────────────────────────────────────────────────────

type FilterTab = 'all' | 'low_confidence' | 'no_value' | 'no_category' | 'medals';

const FILTER_TABS: Array<{ id: FilterTab; label: string; icon: string }> = [
  { id: 'all', label: 'All', icon: 'list' },
  { id: 'low_confidence', label: 'Low Confidence', icon: 'warning' },
  { id: 'medals', label: 'Medals/Tokens', icon: 'military-tech' },
  { id: 'no_value', label: 'No Value', icon: 'bar-chart' },
  { id: 'no_category', label: 'No Category', icon: 'category' },
];

function filterItems(items: Item[], tab: FilterTab): Item[] {
  switch (tab) {
    case 'low_confidence':
      return items.filter(i => (i.identificationConfidence ?? 0) < 0.50);
    case 'medals':
      return items.filter(i => {
        const t = i.attributes?.object_type as string | undefined;
        return t === 'medal' || t === 'token';
      });
    case 'no_value':
      return items.filter(i => i.valuationMid === 0);
    case 'no_category':
      return items.filter(i => !i.attributes?.ebay_category_id);
    default:
      return items;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// REVIEW ITEM CARD
// ─────────────────────────────────────────────────────────────────────────────

function ReviewItemCard({ item, onPress }: { item: Item; onPress: (id: string) => void }) {
  const router = useRouter();
  const reasons = getReviewReasons(item);
  const topReason = reasons[0];
  const ready = isReadyToList(item);
  const idConf = item.identificationConfidence ?? 0;
  const confColor = idConf >= 0.50 ? Colors.warning : idConf >= 0.30 ? Colors.danger : Colors.danger;
  const referenceThumb = item.attributes?.swish_coin_reference_url as string | undefined;
  const hasPhoto = !!referenceThumb || (item.media ?? []).length > 0;
  const objectType = item.attributes?.object_type as string | undefined;

  const objectTypeBadge = objectType ? (
    objectType === 'medal' ? { label: 'Medal', color: Colors.gold } :
    objectType === 'token' ? { label: 'Token', color: Colors.accent } :
    objectType === 'coin' ? { label: 'Coin', color: Colors.primary } :
    null
  ) : null;

  return (
    <Pressable
      onPress={() => onPress(item.id)}
      style={({ pressed }) => [
        styles.card,
        pressed && { opacity: 0.92, transform: [{ scale: 0.99 }] },
      ]}
    >
      {/* Left: photo */}
      <View style={styles.cardThumb}>
        {hasPhoto ? (
          <Image
            source={{ uri: referenceThumb ?? item.media[0] }}
            style={styles.thumbImg}
            contentFit="cover"
            transition={150}
          />
        ) : (
          <View style={styles.thumbPlaceholder}>
            <MaterialIcons
              name={objectType === 'medal' ? 'military-tech' : 'toll'}
              size={18}
              color={Colors.textTertiary}
            />
          </View>
        )}
        {/* Object type badge */}
        {objectTypeBadge ? (
          <View style={[styles.typeBadge, { backgroundColor: objectTypeBadge.color + '20' }]}>
            <Text style={[styles.typeBadgeText, { color: objectTypeBadge.color }]}>{objectTypeBadge.label}</Text>
          </View>
        ) : null}
      </View>

      {/* Right: content */}
      <View style={styles.cardContent}>
        {/* IDs */}
        {item.inventoryId ? (
          <View style={styles.idBadge}>
            <Text style={styles.idBadgeText}>{item.inventoryId}</Text>
          </View>
        ) : null}

        {/* Title */}
        <Text style={styles.cardTitle} numberOfLines={2}>{item.canonicalTitle}</Text>

        {/* Confidence bar */}
        <View style={styles.confRow}>
          <View style={styles.confBarBg}>
            <View style={[styles.confBarFill, { width: `${Math.min(100, Math.round(idConf * 100))}%`, backgroundColor: confColor }]} />
          </View>
          <Text style={[styles.confLabel, { color: confColor }]}>{Math.round(idConf * 100)}%</Text>
        </View>

        {/* Top reason */}
        {topReason ? (
          <View style={[styles.reasonRow, { backgroundColor: topReason.color + '12', borderColor: topReason.color + '30' }]}>
            <MaterialIcons name={topReason.icon as any} size={11} color={topReason.color} style={{ flexShrink: 0 }} />
            <Text style={[styles.reasonText, { color: topReason.color }]} numberOfLines={2}>
              {topReason.label}
            </Text>
          </View>
        ) : null}

        {/* Additional reasons count */}
        {reasons.length > 1 ? (
          <Text style={styles.moreReasons}>+{reasons.length - 1} more issue{reasons.length - 1 > 1 ? 's' : ''}</Text>
        ) : null}

        {/* Bottom row: actions */}
        <View style={styles.cardActions}>
          <View style={styles.cardActionLeft}>
            {/* Market value indicator */}
            {item.valuationMid > 0 ? (
              <View style={styles.valueBadge}>
                <MaterialIcons name="bar-chart" size={9} color={Colors.gold} />
                <Text style={styles.valueBadgeText}>£{item.valuationLow.toFixed(0)}–£{item.valuationHigh.toFixed(0)}</Text>
              </View>
            ) : (
              <View style={[styles.valueBadge, { backgroundColor: Colors.surfaceHighlight }]}>
                <MaterialIcons name="bar-chart" size={9} color={Colors.textTertiary} />
                <Text style={[styles.valueBadgeText, { color: Colors.textTertiary }]}>No value</Text>
              </View>
            )}
          </View>

          {/* Create Listing button */}
          {ready ? (
            <Pressable
              onPress={(e) => { (e as any).stopPropagation?.(); router.push(`/create-listing?id=${item.id}` as any); }}
              style={({ pressed }) => [styles.createBtn, pressed && { opacity: 0.8 }]}
            >
              <MaterialIcons name="sell" size={10} color={Colors.primary} />
              <Text style={styles.createBtnText}>Create Listing</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      <MaterialIcons name="chevron-right" size={16} color={Colors.textTertiary} style={{ flexShrink: 0 }} />
    </Pressable>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN SCREEN
// ─────────────────────────────────────────────────────────────────────────────

export default function ReviewRequiredScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { tenant } = useApp();

  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeFilter, setActiveFilter] = useState<FilterTab>('all');

  const load = useCallback(async () => {
    if (!tenant?.id) return;

    // Fetch all active inventory items — then filter client-side for review criteria
    // (low confidence or review_required status) to avoid a complex server query
    const { items: all } = await listItems(tenant.id, { lifecycleGroup: 'active' });

    const reviewItems = all.filter(item =>
      item.status === 'review_required' ||
      (item.identificationConfidence ?? 0) < 0.50
    );

    setItems(sortItems(reviewItems));
    setLoading(false);
    setRefreshing(false);
  }, [tenant?.id]);

  useEffect(() => { load(); }, [load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load();
  }, [load]);

  const displayItems = useMemo(() => filterItems(items, activeFilter), [items, activeFilter]);

  // Stats
  const stats = useMemo(() => ({
    total: items.length,
    medals: items.filter(i => i.attributes?.object_type === 'medal' || i.attributes?.object_type === 'token').length,
    lowConf: items.filter(i => (i.identificationConfidence ?? 0) < 0.50).length,
    noValue: items.filter(i => i.valuationMid === 0).length,
    noCategory: items.filter(i => !i.attributes?.ebay_category_id).length,
    readyToList: items.filter(isReadyToList).length,
  }), [items]);

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + Spacing.sm }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
          <MaterialIcons name="arrow-back" size={20} color={Colors.textSecondary} />
        </Pressable>
        <View style={styles.flex}>
          <Text style={styles.title}>Review Required</Text>
          <Text style={styles.subtitle}>
            {loading ? 'Loading...' : `${stats.total} item${stats.total !== 1 ? 's' : ''} need attention`}
          </Text>
        </View>
        <Pressable onPress={() => router.push('/(tabs)/inventory' as any)} style={styles.inventoryBtn} hitSlop={4}>
          <MaterialIcons name="inventory" size={15} color={Colors.primary} />
          <Text style={styles.inventoryBtnText}>All Stock</Text>
        </Pressable>
      </View>

      {/* Stats strip */}
      {!loading && stats.total > 0 ? (
        <View style={styles.statsStrip}>
          <Pressable
            onPress={() => setActiveFilter('medals')}
            style={[styles.statItem, activeFilter === 'medals' && styles.statItemActive]}
          >
            <MaterialIcons name="military-tech" size={13} color={Colors.gold} />
            <Text style={[styles.statValue, { color: Colors.gold }]}>{stats.medals}</Text>
            <Text style={styles.statLabel}>Medals</Text>
          </Pressable>
          <View style={styles.statDivider} />
          <Pressable
            onPress={() => setActiveFilter('low_confidence')}
            style={[styles.statItem, activeFilter === 'low_confidence' && styles.statItemActive]}
          >
            <MaterialIcons name="warning" size={13} color={Colors.warning} />
            <Text style={[styles.statValue, { color: Colors.warning }]}>{stats.lowConf}</Text>
            <Text style={styles.statLabel}>Low Conf.</Text>
          </Pressable>
          <View style={styles.statDivider} />
          <Pressable
            onPress={() => setActiveFilter('no_value')}
            style={[styles.statItem, activeFilter === 'no_value' && styles.statItemActive]}
          >
            <MaterialIcons name="bar-chart" size={13} color={Colors.primary} />
            <Text style={[styles.statValue, { color: Colors.primary }]}>{stats.noValue}</Text>
            <Text style={styles.statLabel}>No Value</Text>
          </Pressable>
          <View style={styles.statDivider} />
          <Pressable
            onPress={() => setActiveFilter('no_category')}
            style={[styles.statItem, activeFilter === 'no_category' && styles.statItemActive]}
          >
            <MaterialIcons name="category" size={13} color={Colors.info} />
            <Text style={[styles.statValue, { color: Colors.info }]}>{stats.noCategory}</Text>
            <Text style={styles.statLabel}>No Cat.</Text>
          </Pressable>
        </View>
      ) : null}

      {/* Ready to list banner */}
      {!loading && stats.readyToList > 0 ? (
        <View style={styles.readyBanner}>
          <MaterialIcons name="sell" size={13} color={Colors.success} />
          <Text style={styles.readyBannerText}>
            {stats.readyToList} item{stats.readyToList !== 1 ? 's' : ''} ready to list — tap "Create Listing" to proceed
          </Text>
        </View>
      ) : null}

      {/* Filter tabs */}
      {!loading && items.length > 0 ? (
        <View style={styles.filterOuter}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterContent}>
            {FILTER_TABS.map(tab => {
              const active = activeFilter === tab.id;
              const count = filterItems(items, tab.id).length;
              return (
                <Pressable
                  key={tab.id}
                  onPress={() => setActiveFilter(tab.id)}
                  style={[styles.filterChip, active && styles.filterChipActive]}
                >
                  <Text style={[styles.filterLabel, active && styles.filterLabelActive]}>
                    {tab.label}
                  </Text>
                  {count > 0 && tab.id !== 'all' ? (
                    <View style={[styles.filterBadge, active && styles.filterBadgeActive]}>
                      <Text style={[styles.filterBadgeText, active && styles.filterBadgeTextActive]}>{count}</Text>
                    </View>
                  ) : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      ) : null}

      {/* Content */}
      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator size="large" color={Colors.warning} />
          <Text style={styles.loadingText}>Loading review queue...</Text>
        </View>
      ) : (
        <FlatList
          data={displayItems}
          keyExtractor={i => i.id}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 100 }]}
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => <View style={{ height: Spacing.sm }} />}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.warning} />
          }
          renderItem={({ item }) => (
            <ReviewItemCard item={item} onPress={id => router.push(`/stock-listing/${id}` as any)} />
          )}
          ListHeaderComponent={
            displayItems.length > 0 && activeFilter !== 'all' ? (
              <View style={styles.listHeader}>
                <MaterialIcons name="filter-list" size={13} color={Colors.textTertiary} />
                <Text style={styles.listHeaderText}>
                  Showing {displayItems.length} of {stats.total} items
                </Text>
                <Pressable onPress={() => setActiveFilter('all')} hitSlop={6}>
                  <Text style={styles.clearFilterText}>Clear filter</Text>
                </Pressable>
              </View>
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <View style={styles.emptyIcon}>
                <MaterialIcons
                  name={activeFilter === 'all' ? 'check-circle' : 'filter-list-off'}
                  size={40}
                  color={activeFilter === 'all' ? Colors.success : Colors.textTertiary}
                />
              </View>
              <Text style={styles.emptyTitle}>
                {activeFilter === 'all'
                  ? 'Nothing to review'
                  : `No items match this filter`}
              </Text>
              <Text style={styles.emptyText}>
                {activeFilter === 'all'
                  ? 'All items have sufficient identification confidence and market data.'
                  : `Try a different filter or tap "All" to see everything.`}
              </Text>
              {activeFilter !== 'all' ? (
                <Pressable onPress={() => setActiveFilter('all')} style={styles.emptyBtn}>
                  <Text style={styles.emptyBtnText}>Show All</Text>
                </Pressable>
              ) : (
                <Pressable onPress={() => router.push('/(tabs)/inventory' as any)} style={styles.emptyBtn}>
                  <Text style={styles.emptyBtnText}>Back to Inventory</Text>
                </Pressable>
              )}
            </View>
          }
        />
      )}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },

  header: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingHorizontal: Spacing.base, paddingBottom: Spacing.sm,
    borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: Radius.md,
    backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.surfaceBorder,
  },
  title: { fontSize: Typography.size.lg, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  subtitle: { fontSize: Typography.size.xs, color: Colors.textTertiary, marginTop: 1 },
  inventoryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.primaryDim, borderRadius: Radius.md,
    paddingHorizontal: Spacing.sm, paddingVertical: 7,
    borderWidth: 1, borderColor: Colors.primary + '40',
  },
  inventoryBtnText: { fontSize: Typography.size.xs, color: Colors.primary, fontWeight: Typography.weight.semibold },

  // Stats strip
  statsStrip: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: Spacing.sm, paddingHorizontal: Spacing.base,
    borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder,
  },
  statItem: {
    flex: 1, alignItems: 'center', gap: 2,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.md,
  },
  statItemActive: { backgroundColor: Colors.surfaceHighlight },
  statValue: { fontSize: Typography.size.md, fontWeight: Typography.weight.bold },
  statLabel: { fontSize: 9, color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.3 },
  statDivider: { width: 1, height: 32, backgroundColor: Colors.surfaceBorder },

  // Ready to list banner
  readyBanner: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.successDim, paddingHorizontal: Spacing.base, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: Colors.success + '30',
  },
  readyBannerText: { flex: 1, fontSize: Typography.size.xs, color: Colors.success, fontWeight: Typography.weight.medium },

  // Filter tabs
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
  filterChipActive: { backgroundColor: Colors.warningDim, borderColor: Colors.warning + '50' },
  filterLabel: { fontSize: Typography.size.xs, color: Colors.textSecondary, fontWeight: Typography.weight.medium },
  filterLabelActive: { color: Colors.warning, fontWeight: Typography.weight.semibold },
  filterBadge: {
    backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.pill,
    paddingHorizontal: 5, paddingVertical: 1,
  },
  filterBadgeActive: { backgroundColor: Colors.warning + '25' },
  filterBadgeText: { fontSize: 9, fontWeight: Typography.weight.bold, color: Colors.textTertiary },
  filterBadgeTextActive: { color: Colors.warning },

  // Loading
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md },
  loadingText: { fontSize: Typography.size.sm, color: Colors.textTertiary },

  // List
  list: { paddingHorizontal: Spacing.base, paddingTop: Spacing.sm },
  listHeader: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.xs,
    paddingBottom: Spacing.sm,
  },
  listHeaderText: { flex: 1, fontSize: Typography.size.xs, color: Colors.textTertiary },
  clearFilterText: { fontSize: Typography.size.xs, color: Colors.primary, fontWeight: Typography.weight.semibold },

  // Card
  card: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.surface, borderRadius: Radius.xl,
    padding: Spacing.md, borderWidth: 1, borderColor: Colors.surfaceBorder,
    ...Shadow.sm,
  },

  // Thumb
  cardThumb: { position: 'relative', width: 64, height: 64, flexShrink: 0 },
  thumbImg: { width: 64, height: 64, borderRadius: Radius.md },
  thumbPlaceholder: {
    width: 64, height: 64, borderRadius: Radius.md,
    backgroundColor: Colors.surfaceHighlight,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.surfaceBorder,
  },
  typeBadge: {
    position: 'absolute', bottom: -4, left: 0, right: 0,
    alignItems: 'center', borderRadius: Radius.pill,
    paddingHorizontal: 4, paddingVertical: 2,
  },
  typeBadgeText: { fontSize: 8, fontWeight: Typography.weight.bold, letterSpacing: 0.3 },

  // Content
  cardContent: { flex: 1, gap: Spacing.xs },
  idBadge: {
    backgroundColor: Colors.primaryDim, borderRadius: Radius.sm,
    paddingHorizontal: 5, paddingVertical: 2,
    alignSelf: 'flex-start',
    borderWidth: 1, borderColor: Colors.primary + '40',
  },
  idBadgeText: { fontSize: 9, fontWeight: Typography.weight.bold, color: Colors.primary, letterSpacing: 0.4 },
  cardTitle: {
    fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold,
    color: Colors.textPrimary, lineHeight: 17,
  },

  // Confidence bar
  confRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  confBarBg: {
    flex: 1, height: 4, borderRadius: 2,
    backgroundColor: Colors.surfaceHighlight, overflow: 'hidden',
  },
  confBarFill: { height: '100%', borderRadius: 2 },
  confLabel: { fontSize: 10, fontWeight: Typography.weight.bold, minWidth: 28, textAlign: 'right' },

  // Reason
  reasonRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.xs,
    borderRadius: Radius.sm, paddingHorizontal: 7, paddingVertical: 5,
    borderWidth: 1,
  },
  reasonText: { flex: 1, fontSize: 10, lineHeight: 14 },
  moreReasons: { fontSize: 9, color: Colors.textTertiary, fontStyle: 'italic' },

  // Card actions
  cardActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: 2 },
  cardActionLeft: { flex: 1 },
  valueBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: Colors.goldDim, borderRadius: Radius.pill,
    paddingHorizontal: 6, paddingVertical: 3,
    alignSelf: 'flex-start',
  },
  valueBadgeText: { fontSize: 9, color: Colors.gold, fontWeight: Typography.weight.semibold },
  createBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: Colors.primaryDim, borderRadius: Radius.pill,
    paddingHorizontal: Spacing.sm, paddingVertical: 4,
    borderWidth: 1, borderColor: Colors.primary + '40',
  },
  createBtnText: { fontSize: 9, color: Colors.primary, fontWeight: Typography.weight.semibold },

  // Empty state
  empty: { alignItems: 'center', paddingVertical: 60, paddingHorizontal: Spacing.xl, gap: Spacing.md },
  emptyIcon: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: Colors.successDim, alignItems: 'center', justifyContent: 'center',
  },
  emptyTitle: {
    fontSize: Typography.size.lg, fontWeight: Typography.weight.semibold,
    color: Colors.textSecondary, textAlign: 'center',
  },
  emptyText: {
    fontSize: Typography.size.sm, color: Colors.textTertiary,
    textAlign: 'center', lineHeight: 20,
  },
  emptyBtn: {
    backgroundColor: Colors.surface, borderRadius: Radius.pill,
    paddingHorizontal: Spacing.xl, paddingVertical: Spacing.sm,
    borderWidth: 1, borderColor: Colors.surfaceBorder, marginTop: Spacing.xs,
  },
  emptyBtnText: { fontSize: Typography.size.sm, color: Colors.primary, fontWeight: Typography.weight.semibold },
});
