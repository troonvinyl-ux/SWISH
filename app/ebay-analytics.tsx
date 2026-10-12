// SWISH — eBay Analytics & Traffic
// Shows listing performance: impressions, views, watchers, conversion.
// Pulls from sales, listings, and items tables.
// Performance funnel visualisation per listing.

import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, FlatList, Pressable,
  ActivityIndicator, RefreshControl, ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import { getSupabaseClient } from '@/template';
import { Colors, Typography, Spacing, Radius, Shadow } from '@/constants/theme';
import { useApp } from '@/hooks/useApp';
import { ItemImage } from '@/components';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ListingAnalytics {
  id: string;
  title: string;
  price: number;
  views: number;
  watchers: number;
  status: string;
  publishedAt?: string;
  itemMedia: string[];
  daysListed: number;
  // Derived
  conversionScore: number; // 0-100
  attention: string; // none | low | medium | high
  suggestion?: string;
}

type SortBy = 'watchers' | 'views' | 'days' | 'price' | 'conversion';
type FilterType = 'all' | 'needs_attention' | 'high_performers' | 'no_activity';

// ── Funnel Bar ────────────────────────────────────────────────────────────────

function FunnelBar({ value, max, label, color }: { value: number; max: number; label: string; color: string }) {
  const width = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <View style={fb.row}>
      <Text style={fb.label}>{label}</Text>
      <View style={fb.track}>
        <View style={[fb.fill, { width: `${width}%` as any, backgroundColor: color }]} />
      </View>
      <Text style={[fb.value, { color }]}>{value}</Text>
    </View>
  );
}

const fb = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  label: { width: 64, fontSize: Typography.size.xs, color: Colors.textTertiary, textAlign: 'right' },
  track: { flex: 1, height: 8, backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.pill, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: Radius.pill },
  value: { width: 30, fontSize: Typography.size.xs, fontWeight: Typography.weight.bold, textAlign: 'right' },
});

// ── Analytics Row ─────────────────────────────────────────────────────────────

function AnalyticsRow({
  item,
  maxViews,
  maxWatchers,
}: {
  item: ListingAnalytics;
  maxViews: number;
  maxWatchers: number;
}) {
  const attentionColor = item.attention === 'high' ? Colors.danger
    : item.attention === 'medium' ? Colors.warning
    : item.attention === 'low' ? Colors.primary
    : Colors.textTertiary;

  return (
    <View style={ar.card}>
      <View style={ar.topRow}>
        {item.itemMedia.length > 0 ? (
          <ItemImage uri={item.itemMedia[0]} style={ar.photo} contentFit="cover" />
        ) : (
          <View style={ar.photoPlaceholder}>
            <MaterialIcons name="toll" size={14} color={Colors.textTertiary} />
          </View>
        )}
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={ar.title} numberOfLines={2}>{item.title}</Text>
          <View style={ar.metaRow}>
            <Text style={ar.price}>£{item.price.toFixed(2)}</Text>
            <Text style={ar.days}>{item.daysListed}d listed</Text>
            {item.attention !== 'none' ? (
              <View style={[ar.attentionBadge, { backgroundColor: attentionColor + '20' }]}>
                <MaterialIcons name="auto-awesome" size={8} color={attentionColor} />
                <Text style={[ar.attentionText, { color: attentionColor }]}>
                  {item.attention === 'high' ? 'Review pricing' : item.attention === 'medium' ? 'Improve listing' : 'Low activity'}
                </Text>
              </View>
            ) : null}
          </View>
        </View>
      </View>

      {/* Funnel */}
      <View style={ar.funnel}>
        <FunnelBar value={item.views} max={Math.max(maxViews, 1)} label="Views" color={Colors.primary} />
        <FunnelBar value={item.watchers} max={Math.max(maxWatchers, 1)} label="Watchers" color={Colors.accent} />
      </View>

      {item.suggestion ? (
        <View style={ar.suggestion}>
          <MaterialIcons name="lightbulb" size={11} color={Colors.gold} />
          <Text style={ar.suggestionText}>{item.suggestion}</Text>
        </View>
      ) : null}
    </View>
  );
}

const ar = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface, borderRadius: Radius.xl,
    padding: Spacing.md, gap: Spacing.sm,
    borderWidth: 1, borderColor: Colors.surfaceBorder, ...Shadow.sm,
  },
  topRow: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start' },
  photo: { width: 48, height: 48, borderRadius: Radius.md },
  photoPlaceholder: {
    width: 48, height: 48, borderRadius: Radius.md,
    backgroundColor: Colors.surfaceHighlight, alignItems: 'center', justifyContent: 'center',
  },
  title: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.textPrimary, lineHeight: 17 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  price: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.gold },
  days: { fontSize: 10, color: Colors.textTertiary },
  attentionBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    borderRadius: Radius.pill, paddingHorizontal: 5, paddingVertical: 2,
  },
  attentionText: { fontSize: 9, fontWeight: Typography.weight.semibold },
  funnel: { gap: Spacing.xs, paddingTop: Spacing.xs },
  suggestion: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 5,
    backgroundColor: Colors.goldDim, borderRadius: Radius.sm, padding: Spacing.xs + 2,
  },
  suggestionText: { flex: 1, fontSize: 10, color: Colors.gold, lineHeight: 14 },
});

// ── Main Screen ───────────────────────────────────────────────────────────────

export default function EbayAnalyticsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { tenant } = useApp();

  const [analytics, setAnalytics] = useState<ListingAnalytics[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sortBy, setSortBy] = useState<SortBy>('watchers');
  const [filter, setFilter] = useState<FilterType>('all');

  const load = useCallback(async () => {
    if (!tenant) return;
    const supabase = getSupabaseClient();

    const { data: listings } = await supabase
      .from('listings')
      .select('id, title, price, views, watchers, status, published_at, items(media, canonical_title)')
      .eq('tenant_id', tenant.id)
      .eq('marketplace_id', 'ebay')
      .eq('status', 'active')
      .order('watchers', { ascending: false })
      .limit(200);

    const now = Date.now();
    const rows: ListingAnalytics[] = (listings ?? []).map((r: any) => {
      const views = r.views ?? 0;
      const watchers = r.watchers ?? 0;
      const daysListed = r.published_at
        ? Math.floor((now - new Date(r.published_at).getTime()) / (1000 * 60 * 60 * 24))
        : 0;

      // Conversion score: watchers/views ratio, penalise zero activity
      const conversionScore = views > 0 ? Math.min(Math.round((watchers / views) * 100 * 5), 100) : 0;

      // Identify attention type
      let attention: ListingAnalytics['attention'] = 'none';
      let suggestion: string | undefined;

      if (daysListed > 14 && views === 0) {
        attention = 'high';
        suggestion = 'Zero views after 14+ days. Check title, category, and photos. Consider ending and relisting with improved content.';
      } else if (views > 20 && watchers === 0) {
        attention = 'high';
        suggestion = `High views (${views}) but no watchers — pricing may be too high or photos/description need improvement.`;
      } else if (watchers > 3 && views < 15) {
        attention = 'low';
        suggestion = `${watchers} watchers with low views — strong interest. Consider sending a discount offer to close the sale.`;
      } else if (daysListed > 30 && watchers > 0) {
        attention = 'medium';
        suggestion = `Listed for ${daysListed} days with ${watchers} watcher${watchers > 1 ? 's' : ''}. Try a small price reduction or send an offer.`;
      }

      return {
        id: r.id,
        title: r.items?.canonical_title ?? r.title,
        price: Number(r.price ?? 0),
        views,
        watchers,
        status: r.status,
        publishedAt: r.published_at ?? undefined,
        itemMedia: r.items?.media ?? [],
        daysListed,
        conversionScore,
        attention,
        suggestion,
      };
    });

    setAnalytics(rows);
    setLoading(false);
    setRefreshing(false);
  }, [tenant?.id]);

  useEffect(() => { load(); }, [load]);
  const onRefresh = useCallback(() => { setRefreshing(true); load(); }, [load]);

  const filtered = analytics.filter(a => {
    if (filter === 'needs_attention') return a.attention !== 'none';
    if (filter === 'high_performers') return a.watchers > 2 || a.conversionScore > 20;
    if (filter === 'no_activity') return a.views === 0 && a.watchers === 0;
    return true;
  }).sort((a, b) => {
    if (sortBy === 'watchers') return b.watchers - a.watchers;
    if (sortBy === 'views') return b.views - a.views;
    if (sortBy === 'days') return b.daysListed - a.daysListed;
    if (sortBy === 'price') return b.price - a.price;
    if (sortBy === 'conversion') return b.conversionScore - a.conversionScore;
    return 0;
  });

  const maxViews = Math.max(...analytics.map(a => a.views), 1);
  const maxWatchers = Math.max(...analytics.map(a => a.watchers), 1);
  const totalViews = analytics.reduce((s, a) => s + a.views, 0);
  const totalWatchers = analytics.reduce((s, a) => s + a.watchers, 0);
  const needsAttention = analytics.filter(a => a.attention !== 'none').length;

  return (
    <View style={s.container}>
      <StatusBar style="light" />

      <View style={[s.header, { paddingTop: insets.top + Spacing.base }]}>
        <Pressable onPress={() => router.back()} style={s.backBtn} hitSlop={8}>
          <MaterialIcons name="arrow-back" size={20} color={Colors.textSecondary} />
        </Pressable>
        <View style={s.flex}>
          <Text style={s.title}>Analytics</Text>
          <Text style={s.subtitle}>
            {analytics.length} active · {totalViews} views · {totalWatchers} watchers
          </Text>
        </View>
      </View>

      {/* Summary cards */}
      <View style={s.summaryRow}>
        {[
          { icon: 'visibility', label: 'Total Views', value: String(totalViews), color: Colors.primary },
          { icon: 'star', label: 'Watchers', value: String(totalWatchers), color: Colors.accent },
          { icon: 'notification-important', label: 'Need Action', value: String(needsAttention), color: needsAttention > 0 ? Colors.warning : Colors.textTertiary },
        ].map(c => (
          <View key={c.label} style={s.summaryCard}>
            <MaterialIcons name={c.icon as any} size={16} color={c.color} />
            <Text style={[s.summaryValue, { color: c.color }]}>{c.value}</Text>
            <Text style={s.summaryLabel}>{c.label}</Text>
          </View>
        ))}
      </View>

      {/* Filters */}
      <ScrollView
        horizontal showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.filterRow}
        style={{ borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder }}
      >
        {([
          { id: 'all', label: 'All' },
          { id: 'needs_attention', label: `Needs Action (${needsAttention})` },
          { id: 'high_performers', label: 'High Interest' },
          { id: 'no_activity', label: 'No Activity' },
        ] as { id: FilterType; label: string }[]).map(f => (
          <Pressable
            key={f.id}
            onPress={() => setFilter(f.id)}
            style={[s.filterBtn, filter === f.id && s.filterBtnActive]}
          >
            <Text style={[s.filterText, filter === f.id && s.filterTextActive]}>{f.label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* Sort */}
      <ScrollView
        horizontal showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.sortRow}
      >
        <Text style={s.sortLabel}>Sort:</Text>
        {([
          { id: 'watchers', label: 'Watchers' },
          { id: 'views', label: 'Views' },
          { id: 'days', label: 'Days Listed' },
          { id: 'price', label: 'Price' },
        ] as { id: SortBy; label: string }[]).map(so => (
          <Pressable
            key={so.id}
            onPress={() => setSortBy(so.id)}
            style={[s.sortBtn, sortBy === so.id && s.sortBtnActive]}
          >
            <Text style={[s.sortBtnText, sortBy === so.id && s.sortBtnTextActive]}>{so.label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {loading ? (
        <View style={s.loading}><ActivityIndicator color={Colors.primary} size="large" /></View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={a => a.id}
          contentContainerStyle={[s.list, { paddingBottom: insets.bottom + 80 }]}
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => <View style={{ height: Spacing.sm }} />}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
          renderItem={({ item }) => (
            <AnalyticsRow item={item} maxViews={maxViews} maxWatchers={maxWatchers} />
          )}
          ListEmptyComponent={
            <View style={s.empty}>
              <MaterialIcons name="insights" size={48} color={Colors.textTertiary} />
              <Text style={s.emptyTitle}>No active listings</Text>
              <Text style={s.emptyText}>Analytics are available for active eBay listings with view/watcher data.</Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingHorizontal: Spacing.base, paddingBottom: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder,
  },
  backBtn: {
    width: 34, height: 34, borderRadius: Radius.md,
    backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.surfaceBorder,
  },
  title: { fontSize: Typography.size.xl, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  subtitle: { fontSize: Typography.size.xs, color: Colors.textTertiary, marginTop: 1 },
  summaryRow: {
    flexDirection: 'row', gap: Spacing.sm,
    paddingHorizontal: Spacing.base, paddingVertical: Spacing.sm,
    borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder,
  },
  summaryCard: {
    flex: 1, backgroundColor: Colors.surface, borderRadius: Radius.xl,
    padding: Spacing.sm, gap: 3, alignItems: 'center',
    borderWidth: 1, borderColor: Colors.surfaceBorder,
  },
  summaryValue: { fontSize: Typography.size.lg, fontWeight: Typography.weight.extrabold },
  summaryLabel: { fontSize: 9, color: Colors.textTertiary },
  filterRow: { flexDirection: 'row', gap: Spacing.xs, paddingHorizontal: Spacing.base, paddingVertical: Spacing.sm },
  filterBtn: {
    paddingHorizontal: Spacing.md, paddingVertical: 5, borderRadius: Radius.pill,
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.surfaceBorder,
  },
  filterBtnActive: { backgroundColor: Colors.primaryDim, borderColor: Colors.primary + '50' },
  filterText: { fontSize: Typography.size.xs, color: Colors.textSecondary },
  filterTextActive: { color: Colors.primary, fontWeight: Typography.weight.semibold },
  sortRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, paddingHorizontal: Spacing.base, paddingVertical: Spacing.xs },
  sortLabel: { fontSize: Typography.size.xs, color: Colors.textTertiary, marginRight: 4 },
  sortBtn: { paddingHorizontal: Spacing.sm, paddingVertical: 4, borderRadius: Radius.pill, backgroundColor: Colors.surfaceHighlight },
  sortBtnActive: { backgroundColor: Colors.accentDim },
  sortBtnText: { fontSize: Typography.size.xs, color: Colors.textTertiary },
  sortBtnTextActive: { color: Colors.accent, fontWeight: Typography.weight.semibold },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: Spacing.base },
  empty: { alignItems: 'center', gap: Spacing.md, paddingVertical: 60, paddingHorizontal: Spacing.xl },
  emptyTitle: { fontSize: Typography.size.lg, fontWeight: Typography.weight.semibold, color: Colors.textSecondary },
  emptyText: { fontSize: Typography.size.sm, color: Colors.textTertiary, textAlign: 'center', lineHeight: 20 },
});
