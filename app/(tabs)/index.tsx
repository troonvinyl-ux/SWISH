
// SWISH Dashboard — Command Centre Integration
// Real-time metrics + SWISH intelligence banner + quick actions
// v2.1

import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  RefreshControl, ActivityIndicator, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import { getSupabaseClient } from '@/template';
import { ItemImage } from '@/components';
import { Colors, Typography, Spacing, Radius, Shadow } from '@/constants/theme';
import { useApp } from '@/hooks/useApp';
import { ACTIVE_INVENTORY_STATUSES, ITEM_LIFECYCLE } from '@/services/itemService';
import { getIntelligenceSummary, type IntelligenceSummary } from '@/services/commercialEngine';
import { IS_TV } from '@/hooks/useTVNavigation';
import { NICHES } from '@/constants/niches';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(v?: number | null): string {
  if (v == null) return '—';
  if (v >= 1000) return `£${(v / 1000).toFixed(1)}k`;
  return `£${v.toFixed(0)}`;
}
function fmtDec(v?: number | null): string {
  if (v == null) return '—';
  return `£${v.toFixed(2)}`;
}
function fmtInt(v?: number | null): string {
  if (v == null) return '—';
  return String(v);
}

function startOf(days: number): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}

function dayLabel(offsetFromToday: number): string {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const d = new Date();
  d.setDate(d.getDate() - offsetFromToday);
  if (offsetFromToday === 0) return 'Today';
  if (offsetFromToday === 1) return 'Yest';
  return days[d.getDay()];
}

// ── Metrics types ─────────────────────────────────────────────────────────────

interface RecentSale {
  id: string;
  itemId: string;
  itemTitle: string;
  itemMedia: string[];
  salePrice: number;
  soldAt: string;
}

interface EbayHubMetrics {
  activeListings: number;
  revenueToday: number;
  awaitingDispatch: number;
  unreadMessages: number;
}

interface DashMetrics {
  totalItems: number;
  statusBreakdown: { listed: number; sold: number; available: number; newItems: number; other: number };
  revenueToday: number;
  revenueWeek: number;
  revenueMonth: number;
  profitToday: number;
  profitWeek: number;
  profitMonth: number;
  marginMonth: number | null;
  activeListingCount: number;
  activeListingGMV: number;
  draftListingCount: number;
  awaitingDispatch: number;
  avgSalePrice30d: number | null;
  totalSales30d: number;
  sparkline: number[];
  recentSales: RecentSale[];
}

// ── Data fetchers ─────────────────────────────────────────────────────────────

async function fetchEbayHubMetrics(tenantId: string): Promise<EbayHubMetrics> {
  const supabase = getSupabaseClient();
  const todayStart = startOf(0);
  const [listingsRes, salesTodayRes, dispatchRes, messagesRes] = await Promise.all([
    supabase.from('listings').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('marketplace_id', 'ebay').eq('status', 'active'),
    supabase.from('sales').select('net_revenue').eq('tenant_id', tenantId).gte('sold_at', todayStart),
    supabase.from('orders').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).in('fulfilment_status', ['awaiting_dispatch', 'packing', 'label_created']),
    supabase.from('ebay_messages').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('is_read', false).eq('direction', 'inbound'),
  ]);
  return {
    activeListings: listingsRes.count ?? 0,
    revenueToday: (salesTodayRes.data ?? []).reduce((s, r) => s + Number(r.net_revenue ?? 0), 0),
    awaitingDispatch: dispatchRes.count ?? 0,
    unreadMessages: messagesRes.count ?? 0,
  };
}

async function fetchDashMetrics(tenantId: string): Promise<DashMetrics> {
  const supabase = getSupabaseClient();
  const now = new Date();
  const todayStart = startOf(0);
  const weekStart  = startOf(6);
  const monthStart = startOf(29);

  const [itemsRes, listingsRes, ordersDispatchRes, salesTodayRes, salesWeekRes, salesMonthRes, sparklineRes, recentSalesRes] = await Promise.all([
    supabase.from('items').select('status').eq('tenant_id', tenantId).in('status', ACTIVE_INVENTORY_STATUSES),
    supabase.from('listings').select('status, price').eq('tenant_id', tenantId).in('status', ['active', 'draft', 'pending']),
    supabase.from('orders').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).in('fulfilment_status', ['awaiting_dispatch', 'packing', 'label_created']),
    supabase.from('sales').select('net_revenue').eq('tenant_id', tenantId).gte('sold_at', todayStart),
    supabase.from('sales').select('net_revenue').eq('tenant_id', tenantId).gte('sold_at', weekStart),
    supabase.from('sales').select('net_revenue, sale_price, sold_at, item_id, items(acquired_cost)').eq('tenant_id', tenantId).gte('sold_at', monthStart).order('sold_at', { ascending: false }),
    supabase.from('sales').select('net_revenue, sold_at, item_id, items(acquired_cost)').eq('tenant_id', tenantId).gte('sold_at', weekStart).order('sold_at', { ascending: true }),
    supabase.from('sales').select('id, item_id, sale_price, sold_at, items(canonical_title, media)').eq('tenant_id', tenantId).order('sold_at', { ascending: false }).limit(5),
  ]);

  const itemRows = itemsRes.data ?? [];
  const totalItems = itemRows.length;
  let listed = 0, available = 0, newItems = 0, other = 0;
  for (const r of itemRows) {
    if (ITEM_LIFECYCLE.LIVE_STATUSES.includes(r.status)) listed++;
    else if (r.status === 'identified' || r.status === 'priced' || r.status === 'assessed') available++;
    else if (r.status === 'new' || r.status === 'captured') newItems++;
    else other++;
  }

  const listingRows = listingsRes.data ?? [];
  let activeListingCount = 0, activeListingGMV = 0, draftListingCount = 0;
  for (const r of listingRows) {
    if (r.status === 'active') { activeListingCount++; activeListingGMV += Number(r.price ?? 0); }
    else draftListingCount++;
  }

  const awaitingDispatch = ordersDispatchRes.count ?? 0;
  const revenueToday = (salesTodayRes.data ?? []).reduce((s, r) => s + Number(r.net_revenue ?? 0), 0);
  const revenueWeek  = (salesWeekRes.data ?? []).reduce((s, r) => s + Number(r.net_revenue ?? 0), 0);
  const month30Rows  = salesMonthRes.data ?? [];
  const revenueMonth = month30Rows.reduce((s, r) => s + Number(r.net_revenue ?? 0), 0);
  const totalSales30d = month30Rows.length;
  const avgSalePrice30d = totalSales30d > 0 ? month30Rows.reduce((s, r) => s + Number(r.sale_price ?? r.net_revenue ?? 0), 0) / totalSales30d : null;

  const todayStartMs = new Date(todayStart).getTime();
  const weekStartMs  = new Date(weekStart).getTime();
  let profitToday = 0, profitWeek = 0, profitMonth = 0;
  for (const r of month30Rows) {
    const profit = Number(r.net_revenue ?? 0) - Number((r as any).items?.acquired_cost ?? 0);
    const ts = new Date(r.sold_at).getTime();
    profitMonth += profit;
    if (ts >= weekStartMs)  profitWeek  += profit;
    if (ts >= todayStartMs) profitToday += profit;
  }
  const marginMonth = revenueMonth > 0 ? (profitMonth / revenueMonth) * 100 : null;

  const sparkBuckets: number[] = [0, 0, 0, 0, 0, 0, 0];
  for (const r of sparklineRes.data ?? []) {
    const msFromToday = now.getTime() - new Date(r.sold_at).getTime();
    const daysAgo = Math.floor(msFromToday / (1000 * 60 * 60 * 24));
    const idx = 6 - daysAgo;
    if (idx >= 0 && idx < 7) sparkBuckets[idx] += Number(r.net_revenue ?? 0);
  }

  const recentSales: RecentSale[] = (recentSalesRes.data ?? []).map((r: any) => ({
    id: r.id, itemId: r.item_id,
    itemTitle: r.items?.canonical_title ?? 'Unknown Item',
    itemMedia: r.items?.media ?? [],
    salePrice: Number(r.sale_price ?? 0),
    soldAt: r.sold_at,
  }));

  return { totalItems, statusBreakdown: { listed, sold: 0, available, newItems, other }, revenueToday, revenueWeek, revenueMonth, profitToday, profitWeek, profitMonth, marginMonth, activeListingCount, activeListingGMV, draftListingCount, awaitingDispatch, avgSalePrice30d, totalSales30d, sparkline: sparkBuckets, recentSales };
}

// ── Sub-components ────────────────────────────────────────────────────────────

function RecentSaleRow({ sale, onPress }: { sale: RecentSale; onPress: () => void }) {
  const hasPhoto = sale.itemMedia.length > 0;
  const timeStr = (() => {
    const ms = Date.now() - new Date(sale.soldAt).getTime();
    const mins = Math.floor(ms / 60000);
    const hrs = Math.floor(ms / 3600000);
    const days = Math.floor(ms / 86400000);
    if (mins < 60) return `${mins}m ago`;
    if (hrs < 24) return `${hrs}h ago`;
    if (days < 7) return `${days}d ago`;
    return new Date(sale.soldAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  })();
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [rs.row, pressed && { opacity: 0.82 }]}>
      {hasPhoto ? (
        <ItemImage uri={sale.itemMedia[0]} style={rs.thumb} contentFit="cover" transition={150} />
      ) : (
        <View style={[rs.thumb, rs.thumbPlaceholder]}><MaterialIcons name="toll" size={18} color={Colors.textTertiary} /></View>
      )}
      <View style={rs.meta}>
        <Text style={rs.title} numberOfLines={2}>{sale.itemTitle}</Text>
        <Text style={rs.time}>{timeStr}</Text>
      </View>
      <View style={rs.priceCol}>
        <Text style={rs.price}>£{sale.salePrice.toFixed(2)}</Text>
        <View style={rs.soldBadge}><MaterialIcons name="check-circle" size={9} color={Colors.success} /><Text style={rs.soldText}>Sold</Text></View>
      </View>
      <MaterialIcons name="chevron-right" size={16} color={Colors.textTertiary} />
    </Pressable>
  );
}
const rs = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.sm },
  thumb: { width: 48, height: 48, borderRadius: Radius.md, flexShrink: 0 },
  thumbPlaceholder: { backgroundColor: Colors.surfaceHighlight, alignItems: 'center', justifyContent: 'center' },
  meta: { flex: 1, gap: 3 },
  title: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.textPrimary, lineHeight: 17 },
  time: { fontSize: 10, color: Colors.textTertiary },
  priceCol: { alignItems: 'flex-end', gap: 4 },
  price: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.gold },
  soldBadge: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  soldText: { fontSize: 9, color: Colors.success, fontWeight: Typography.weight.semibold },
});

function Sparkline({ data }: { data: number[] }) {
  const max = Math.max(...data, 1);
  const hasData = data.some(v => v > 0);
  return (
    <View style={spark.wrap}>
      {data.map((val, i) => {
        const pct = Math.max(val / max, val > 0 ? 0.08 : 0);
        const isToday = i === 6;
        return (
          <View key={i} style={spark.col}>
            <View style={spark.track}>
              <View style={[spark.bar, { height: `${Math.round(pct * 100)}%` as any }, isToday ? spark.barToday : (val > 0 ? spark.barFilled : spark.barEmpty)]} />
            </View>
            <Text style={[spark.label, isToday && spark.labelToday]}>{dayLabel(6 - i)}</Text>
          </View>
        );
      })}
      {!hasData ? <View style={spark.noDataOverlay}><Text style={spark.noDataText}>No sales yet</Text></View> : null}
    </View>
  );
}
const spark = StyleSheet.create({
  wrap: { flexDirection: 'row', gap: 5, height: 64, alignItems: 'flex-end', position: 'relative' },
  col: { flex: 1, alignItems: 'center', gap: 4 },
  track: { flex: 1, width: '100%', backgroundColor: Colors.surfaceHighlight, borderRadius: 4, overflow: 'hidden', justifyContent: 'flex-end' },
  bar: { width: '100%', borderRadius: 4 },
  barFilled: { backgroundColor: Colors.primary + '70' },
  barToday: { backgroundColor: Colors.primary },
  barEmpty: { backgroundColor: 'transparent' },
  label: { fontSize: 8, color: Colors.textTertiary, textAlign: 'center' },
  labelToday: { color: Colors.primary, fontWeight: Typography.weight.semibold },
  noDataOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  noDataText: { fontSize: Typography.size.xs, color: Colors.textTertiary, fontStyle: 'italic' },
});

function StatusPill({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <View style={pill.wrap}>
      <View style={[pill.dot, { backgroundColor: color }]} />
      <Text style={pill.count}>{count}</Text>
      <Text style={pill.label}>{label}</Text>
    </View>
  );
}
const pill = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 3 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  count: { fontSize: Typography.size.md, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  label: { fontSize: 9, color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.3 },
});

function ProfitRow({ label, value, isPositive }: { label: string; value: string; isPositive?: boolean }) {
  const color = isPositive === undefined ? Colors.textPrimary : isPositive ? Colors.success : Colors.danger;
  return (
    <View style={prf.row}>
      <Text style={prf.label}>{label}</Text>
      <Text style={[prf.value, { color }]}>{value}</Text>
    </View>
  );
}
const prf = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 5 },
  label: { fontSize: Typography.size.sm, color: Colors.textSecondary },
  value: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold },
});

function MetricTile({ label, value, sub, color, icon, onPress }: {
  label: string; value: string; sub?: string; color: string; icon: string; onPress?: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [mt.card, pressed && onPress && { opacity: 0.85 }]} disabled={!onPress}>
      <View style={[mt.iconWrap, { backgroundColor: color + '18' }]}><MaterialIcons name={icon as any} size={18} color={color} /></View>
      <Text style={[mt.value, { color }]}>{value}</Text>
      <Text style={mt.label}>{label}</Text>
      {sub ? <Text style={mt.sub}>{sub}</Text> : null}
    </Pressable>
  );
}
const mt = StyleSheet.create({
  card: { flex: 1, backgroundColor: Colors.surface, borderRadius: Radius.xl, padding: Spacing.md, alignItems: 'center', gap: Spacing.xs, borderWidth: 1, borderColor: Colors.surfaceBorder, ...Shadow.sm },
  iconWrap: { width: 36, height: 36, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  value: { fontSize: Typography.size.xl, fontWeight: Typography.weight.extrabold },
  label: { fontSize: 10, color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.3, textAlign: 'center' },
  sub: { fontSize: 9, color: Colors.textTertiary, textAlign: 'center' },
});

function QuickAction({ icon, label, badge, color, onPress, preferFocus }: {
  icon: string; label: string; badge?: string | number; color: string; onPress: () => void; preferFocus?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      hasTVPreferredFocus={IS_TV && preferFocus}
      isTVSelectable={IS_TV}
      accessible
      accessibilityLabel={label}
      style={({ pressed }) => [
        qa.btn,
        pressed && { opacity: 0.8, transform: [{ scale: 0.96 }] },
        IS_TV && focused && qa.btnFocused,
      ]}
    >
      <View style={[qa.iconWrap, { backgroundColor: color + '18' }, IS_TV && focused && { backgroundColor: color + '35' }]}>
        <MaterialIcons name={icon as any} size={IS_TV ? 28 : 22} color={color} />
        {badge != null && Number(badge) > 0 ? (
          <View style={qa.badge}><Text style={qa.badgeText}>{badge}</Text></View>
        ) : null}
      </View>
      <Text style={[qa.label, IS_TV && qa.labelTV]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}
const qa = StyleSheet.create({
  btn: { alignItems: 'center', gap: Spacing.xs, flex: 1, minWidth: 60 },
  btnFocused: {
    borderRadius: Radius.md,
    borderWidth: 2,
    borderColor: Colors.primary,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 8,
    elevation: 10,
  },
  iconWrap: { width: 52, height: 52, borderRadius: Radius.xl, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  badge: { position: 'absolute', top: -3, right: -3, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: Colors.danger, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3, borderWidth: 1.5, borderColor: Colors.background },
  badgeText: { fontSize: 8, fontWeight: Typography.weight.bold, color: '#fff' },
  label: { fontSize: 10, color: Colors.textSecondary, fontWeight: Typography.weight.medium, textAlign: 'center' },
  labelTV: { fontSize: 13 },
});

// ── SWISH Intelligence Banner ─────────────────────────────────────────────────

function IntelligenceBanner({
  intelligence, onPress,
}: {
  intelligence: IntelligenceSummary | null;
  onPress: () => void;
}) {
  if (!intelligence) return null;

  const alertCount = (intelligence.draftListings > 0 ? 1 : 0)
    + (intelligence.staleListing60d > 0 ? 1 : 0)
    + (intelligence.itemsNeedingImages > 0 ? 1 : 0)
    + (intelligence.stalePushCount > 0 ? 1 : 0);

  const alerts = [
    intelligence.draftListings > 0 && `${intelligence.draftListings} drafts to publish`,
    intelligence.staleListing60d > 0 && `${intelligence.staleListing60d} stale listings`,
    intelligence.itemsNeedingImages > 0 && `${intelligence.itemsNeedingImages} items need photos`,
    intelligence.stalePushCount > 0 && `${intelligence.stalePushCount} changes to push`,
  ].filter(Boolean) as string[];

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [ib.card, pressed && { opacity: 0.92 }]}>
      <View style={[ib.iconWrap, { backgroundColor: alertCount > 0 ? Colors.primaryDim : Colors.successDim }]}>
        <MaterialIcons
          name={alertCount > 0 ? 'auto-awesome' : 'check-circle'}
          size={20}
          color={alertCount > 0 ? Colors.primary : Colors.success}
        />
      </View>
      <View style={ib.flex}>
        <Text style={ib.title}>
          {alertCount > 0
            ? `SWISH has ${alertCount} recommendation${alertCount > 1 ? 's' : ''}`
            : 'All clear — nothing urgent'}
        </Text>
        <Text style={ib.sub} numberOfLines={1}>
          {alertCount > 0 ? alerts.join(' · ') : 'Tap to open Command Centre'}
        </Text>
      </View>
      <View style={[ib.badge, { backgroundColor: alertCount > 0 ? Colors.primary : Colors.success }]}>
        <Text style={ib.badgeText}>{alertCount > 0 ? String(alertCount) : '✓'}</Text>
      </View>
    </Pressable>
  );
}
const ib = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surface, borderRadius: Radius.xl, borderWidth: 1, borderColor: Colors.surfaceBorder, padding: Spacing.md, ...Shadow.sm },
  iconWrap: { width: 44, height: 44, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  flex: { flex: 1, gap: 3 },
  title: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.textPrimary },
  sub: { fontSize: Typography.size.xs, color: Colors.textTertiary },
  badge: { minWidth: 28, height: 28, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  badgeText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.extrabold, color: Colors.background },
});

// ── Coin Flipper dashboard card ─────────────────────────────────────────────

function CoinFlipperCard({ tenantId }: { tenantId: string }) {
  const router = useRouter();
  const [coinCount, setCoinCount] = useState<number | null>(null);

  useEffect(() => {
    if (!tenantId) return;
    const supabase = getSupabaseClient();
    supabase
      .from('items')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('specialist_id', 'coins')
      .then(({ count }) => setCoinCount(count ?? 0));
  }, [tenantId]);

  return (
    <Pressable
      onPress={() => router.push('/coin-flipper' as any)}
      style={({ pressed }) => [cfCard.card, pressed && { opacity: 0.88, transform: [{ scale: 0.98 }] }]}
    >
      {/* Left: reticle icon */}
      <View style={cfCard.iconWrap}>
        {/* Corner reticle decoration */}
        <View style={cfCard.reticleCornerTL} />
        <View style={cfCard.reticleCornerTR} />
        <View style={cfCard.reticleCornerBL} />
        <View style={cfCard.reticleCornerBR} />
        <MaterialIcons name="toll" size={24} color="#F5C842" />
      </View>

      {/* Centre: text */}
      <View style={cfCard.textWrap}>
        <View style={cfCard.titleRow}>
          <Text style={cfCard.title}>Coin Flipper</Text>
          <View style={cfCard.proBadge}>
            <MaterialIcons name="workspace-premium" size={9} color="#09080A" />
            <Text style={cfCard.proText}>PRO</Text>
          </View>
        </View>
        <Text style={cfCard.sub}>Capture · Identify · Reference · Value · List & Sell</Text>
        <Text style={cfCard.tagline}>ANCIENT COINS • REAL VALUES • SMARTER DECISIONS</Text>
      </View>

      {/* Right: coin count + CTA */}
      <View style={cfCard.right}>
        {coinCount !== null ? (
          <View style={cfCard.countWrap}>
            <Text style={cfCard.countNum}>{coinCount}</Text>
            <Text style={cfCard.countLabel}>coins</Text>
          </View>
        ) : (
          <ActivityIndicator size="small" color="#F5C842" style={{ width: 36, height: 36 }} />
        )}
        <View style={cfCard.ctaBtn}>
          <MaterialIcons name="photo-camera" size={11} color="#09080A" />
          <Text style={cfCard.ctaText}>Scan Coin</Text>
        </View>
      </View>
    </Pressable>
  );
}

const CF_GOLD = '#F5C842';
const CF_BLACK = '#09080A';
const CF_SURFACE = '#111009';
const CF_BORDER = '#2C2510';
const CF_GOLD_DIM = '#2A2000';
const CF_TEXT_SUB = '#9C8860';
const CORNER_SIZE = 10;
const CORNER_WIDTH = 2;

const cfCard = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: CF_BLACK,
    borderRadius: Radius.xl,
    padding: Spacing.base,
    borderWidth: 1,
    borderColor: CF_GOLD + '40',
    ...Shadow.sm,
    shadowColor: CF_GOLD,
    shadowOpacity: 0.12,
    shadowRadius: 12,
  },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: Radius.lg,
    backgroundColor: CF_GOLD_DIM,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    position: 'relative',
  },
  reticleCornerTL: {
    position: 'absolute', top: 3, left: 3,
    width: CORNER_SIZE, height: CORNER_SIZE,
    borderTopWidth: CORNER_WIDTH, borderLeftWidth: CORNER_WIDTH,
    borderColor: CF_GOLD,
  },
  reticleCornerTR: {
    position: 'absolute', top: 3, right: 3,
    width: CORNER_SIZE, height: CORNER_SIZE,
    borderTopWidth: CORNER_WIDTH, borderRightWidth: CORNER_WIDTH,
    borderColor: CF_GOLD,
  },
  reticleCornerBL: {
    position: 'absolute', bottom: 3, left: 3,
    width: CORNER_SIZE, height: CORNER_SIZE,
    borderBottomWidth: CORNER_WIDTH, borderLeftWidth: CORNER_WIDTH,
    borderColor: CF_GOLD,
  },
  reticleCornerBR: {
    position: 'absolute', bottom: 3, right: 3,
    width: CORNER_SIZE, height: CORNER_SIZE,
    borderBottomWidth: CORNER_WIDTH, borderRightWidth: CORNER_WIDTH,
    borderColor: CF_GOLD,
  },
  textWrap: { flex: 1, gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: {
    fontSize: Typography.size.sm,
    fontWeight: Typography.weight.extrabold,
    color: CF_GOLD,
    letterSpacing: 0.5,
  },
  proBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: CF_GOLD,
    borderRadius: Radius.pill,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  proText: { fontSize: 7, fontWeight: Typography.weight.extrabold, color: CF_BLACK, letterSpacing: 0.8 },
  sub: { fontSize: Typography.size.xs, color: CF_TEXT_SUB, lineHeight: 15 },
  tagline: { fontSize: 8, color: CF_GOLD + '60', letterSpacing: 0.8, marginTop: 1 },
  right: { alignItems: 'center', gap: 6, flexShrink: 0 },
  countWrap: { alignItems: 'center', gap: 1 },
  countNum: { fontSize: Typography.size.xl, fontWeight: Typography.weight.extrabold, color: CF_GOLD, lineHeight: 24 },
  countLabel: { fontSize: 8, color: CF_TEXT_SUB, textTransform: 'uppercase', letterSpacing: 0.4 },
  ctaBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: CF_GOLD,
    borderRadius: Radius.md,
    paddingHorizontal: 8,
    paddingVertical: 4,
    shadowColor: CF_GOLD,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 4,
  },
  ctaText: { fontSize: 9, fontWeight: Typography.weight.extrabold, color: CF_BLACK },
});

// ── Flipper MX dashboard card ───────────────────────────────────────────────

const MX_ORANGE = '#FF5500';
const MX_BLACK_BG = '#0A0A08';
const MX_DIM_BG = '#2A1500';
const MX_TEXT_S = '#9A9070';

function FlipperMXCard({ tenantId }: { tenantId: string }) {
  const router = useRouter();
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    if (!tenantId) return;
    getSupabaseClient()
      .from('items').select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId).eq('specialist_id', 'motocross')
      .then(({ count: c }) => setCount(c ?? 0));
  }, [tenantId]);
  return (
    <Pressable
      onPress={() => router.push('/flipper-mx' as any)}
      style={({ pressed }) => [mxCard.card, pressed && { opacity: 0.88, transform: [{ scale: 0.98 }] }]}
    >
      <View style={mxCard.iconWrap}>
        <MaterialIcons name="two-wheeler" size={24} color={MX_ORANGE} />
      </View>
      <View style={mxCard.textWrap}>
        <View style={mxCard.titleRow}>
          <Text style={mxCard.title}>Flipper MX</Text>
          <View style={mxCard.proBadge}>
            <MaterialIcons name="workspace-premium" size={9} color={MX_BLACK_BG} />
            <Text style={mxCard.proText}>PRO</Text>
          </View>
        </View>
        <Text style={mxCard.sub}>Find {'>'}  Fix {'>'}  Flip {'>'}  Repeat</Text>
        <Text style={mxCard.tagline}>DIRT BIKES  REAL DATA  BIGGER PROFITS</Text>
      </View>
      <View style={mxCard.right}>
        {count !== null ? (
          <View style={mxCard.countWrap}>
            <Text style={mxCard.countNum}>{count}</Text>
            <Text style={mxCard.countLabel}>bikes</Text>
          </View>
        ) : (
          <ActivityIndicator size="small" color={MX_ORANGE} style={{ width: 36, height: 36 }} />
        )}
        <View style={mxCard.ctaBtn}>
          <MaterialIcons name="search" size={11} color={MX_BLACK_BG} />
          <Text style={mxCard.ctaText}>Find Bike</Text>
        </View>
      </View>
    </Pressable>
  );
}

const mxCard = StyleSheet.create({
  card: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: MX_BLACK_BG, borderRadius: Radius.xl, padding: Spacing.base,
    borderWidth: 1, borderColor: MX_ORANGE + '40', ...Shadow.sm,
    shadowColor: MX_ORANGE, shadowOpacity: 0.1, shadowRadius: 10,
  },
  iconWrap: {
    width: 56, height: 56, borderRadius: Radius.lg,
    backgroundColor: MX_DIM_BG, alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    borderWidth: 1, borderColor: MX_ORANGE + '30',
  },
  textWrap: { flex: 1, gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { fontSize: Typography.size.sm, fontWeight: Typography.weight.extrabold, color: MX_ORANGE, letterSpacing: 0.4 },
  proBadge: { flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: MX_ORANGE, borderRadius: Radius.pill, paddingHorizontal: 5, paddingVertical: 2 },
  proText: { fontSize: 7, fontWeight: Typography.weight.extrabold, color: MX_BLACK_BG, letterSpacing: 0.8 },
  sub: { fontSize: Typography.size.xs, color: MX_TEXT_S, lineHeight: 15 },
  tagline: { fontSize: 8, color: MX_ORANGE + '60', letterSpacing: 0.6, marginTop: 1 },
  right: { alignItems: 'center', gap: 6, flexShrink: 0 },
  countWrap: { alignItems: 'center', gap: 1 },
  countNum: { fontSize: Typography.size.xl, fontWeight: Typography.weight.extrabold, color: MX_ORANGE, lineHeight: 24 },
  countLabel: { fontSize: 8, color: MX_TEXT_S, textTransform: 'uppercase', letterSpacing: 0.4 },
  ctaBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: MX_ORANGE, borderRadius: Radius.md, paddingHorizontal: 8, paddingVertical: 4,
    shadowColor: MX_ORANGE, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.4, shadowRadius: 6, elevation: 4,
  },
  ctaText: { fontSize: 9, fontWeight: Typography.weight.extrabold, color: MX_BLACK_BG },
});

// ── Bike Flipper dashboard card ───────────────────────────────────────────────

const BF_GREEN = '#6ED020';
const BF_BLACK_BG = '#080C08';
const BF_DIM_BG = '#0A2000';
const BF_TEXT_S = '#7A9070';

function BikeFlipperCard({ tenantId }: { tenantId: string }) {
  const router = useRouter();
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    if (!tenantId) return;
    getSupabaseClient()
      .from('items').select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId).eq('specialist_id', 'bicycles')
      .then(({ count: c }) => setCount(c ?? 0));
  }, [tenantId]);
  return (
    <Pressable
      onPress={() => router.push('/bike-flipper' as any)}
      style={({ pressed }) => [bfCard.card, pressed && { opacity: 0.88, transform: [{ scale: 0.98 }] }]}
    >
      <View style={bfCard.iconWrap}>
        <MaterialIcons name="pedal-bike" size={24} color={BF_GREEN} />
      </View>
      <View style={bfCard.textWrap}>
        <View style={bfCard.titleRow}>
          <Text style={bfCard.title}>Bike Flipper</Text>
          <View style={bfCard.proBadge}>
            <MaterialIcons name="workspace-premium" size={9} color={BF_BLACK_BG} />
            <Text style={bfCard.proText}>PRO</Text>
          </View>
        </View>
        <Text style={bfCard.sub}>Find  Assess  Upgrade  Flip</Text>
        <Text style={bfCard.tagline}>ANY BIKE  REAL DATA  BIGGER PROFITS</Text>
      </View>
      <View style={bfCard.right}>
        {count !== null ? (
          <View style={bfCard.countWrap}>
            <Text style={bfCard.countNum}>{count}</Text>
            <Text style={bfCard.countLabel}>bikes</Text>
          </View>
        ) : (
          <ActivityIndicator size="small" color={BF_GREEN} style={{ width: 36, height: 36 }} />
        )}
        <View style={bfCard.ctaBtn}>
          <MaterialIcons name="search" size={11} color={BF_BLACK_BG} />
          <Text style={bfCard.ctaText}>Find Bike</Text>
        </View>
      </View>
    </Pressable>
  );
}

const bfCard = StyleSheet.create({
  card: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: BF_BLACK_BG, borderRadius: Radius.xl, padding: Spacing.base,
    borderWidth: 1, borderColor: BF_GREEN + '40', ...Shadow.sm,
    shadowColor: BF_GREEN, shadowOpacity: 0.1, shadowRadius: 10,
  },
  iconWrap: {
    width: 56, height: 56, borderRadius: Radius.lg,
    backgroundColor: BF_DIM_BG, alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    borderWidth: 1, borderColor: BF_GREEN + '30',
  },
  textWrap: { flex: 1, gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { fontSize: Typography.size.sm, fontWeight: Typography.weight.extrabold, color: BF_GREEN, letterSpacing: 0.4 },
  proBadge: { flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: BF_GREEN, borderRadius: Radius.pill, paddingHorizontal: 5, paddingVertical: 2 },
  proText: { fontSize: 7, fontWeight: Typography.weight.extrabold, color: BF_BLACK_BG, letterSpacing: 0.8 },
  sub: { fontSize: Typography.size.xs, color: BF_TEXT_S, lineHeight: 15 },
  tagline: { fontSize: 8, color: BF_GREEN + '60', letterSpacing: 0.6, marginTop: 1 },
  right: { alignItems: 'center', gap: 6, flexShrink: 0 },
  countWrap: { alignItems: 'center', gap: 1 },
  countNum: { fontSize: Typography.size.xl, fontWeight: Typography.weight.extrabold, color: BF_GREEN, lineHeight: 24 },
  countLabel: { fontSize: 8, color: BF_TEXT_S, textTransform: 'uppercase', letterSpacing: 0.4 },
  ctaBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: BF_GREEN, borderRadius: Radius.md, paddingHorizontal: 8, paddingVertical: 4,
    shadowColor: BF_GREEN, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.4, shadowRadius: 6, elevation: 4,
  },
  ctaText: { fontSize: 9, fontWeight: Typography.weight.extrabold, color: BF_BLACK_BG },
});

// ── Threads Flip dashboard card ───────────────────────────────────────────────

const TF_PINK = '#E91E8C';
const TF_BLACK_BG = '#0C080C';
const TF_DIM_BG = '#250014';
const TF_TEXT_S = '#9A7090';

function ThreadsFlipCard({ tenantId }: { tenantId: string }) {
  const router = useRouter();
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    if (!tenantId) return;
    getSupabaseClient()
      .from('items').select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId).eq('specialist_id', 'clothing')
      .then(({ count: c }) => setCount(c ?? 0));
  }, [tenantId]);
  return (
    <Pressable
      onPress={() => router.push('/threads-flip' as any)}
      style={({ pressed }) => [tfCard.card, pressed && { opacity: 0.88, transform: [{ scale: 0.98 }] }]}
    >
      <View style={tfCard.iconWrap}>
        <MaterialIcons name="checkroom" size={24} color={TF_PINK} />
      </View>
      <View style={tfCard.textWrap}>
        <View style={tfCard.titleRow}>
          <Text style={tfCard.title}>Threads Flip</Text>
          <View style={tfCard.proBadge}>
            <MaterialIcons name="workspace-premium" size={9} color={TF_BLACK_BG} />
            <Text style={tfCard.proText}>PRO</Text>
          </View>
        </View>
        <Text style={tfCard.sub}>Identify  Value  Style  Sell  Insights</Text>
        <Text style={tfCard.tagline}>VINTAGE  DESIGNER  STREETWEAR  REAL PROFITS</Text>
      </View>
      <View style={tfCard.right}>
        {count !== null ? (
          <View style={tfCard.countWrap}>
            <Text style={tfCard.countNum}>{count}</Text>
            <Text style={tfCard.countLabel}>items</Text>
          </View>
        ) : (
          <ActivityIndicator size="small" color={TF_PINK} style={{ width: 36, height: 36 }} />
        )}
        <View style={tfCard.ctaBtn}>
          <MaterialIcons name="photo-camera" size={11} color={TF_BLACK_BG} />
          <Text style={tfCard.ctaText}>Scan Item</Text>
        </View>
      </View>
    </Pressable>
  );
}

const tfCard = StyleSheet.create({
  card: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: TF_BLACK_BG, borderRadius: Radius.xl, padding: Spacing.base,
    borderWidth: 1, borderColor: TF_PINK + '40', ...Shadow.sm,
    shadowColor: TF_PINK, shadowOpacity: 0.1, shadowRadius: 10,
  },
  iconWrap: {
    width: 56, height: 56, borderRadius: Radius.lg,
    backgroundColor: TF_DIM_BG, alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    borderWidth: 1, borderColor: TF_PINK + '30',
  },
  textWrap: { flex: 1, gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { fontSize: Typography.size.sm, fontWeight: Typography.weight.extrabold, color: TF_PINK, letterSpacing: 0.4 },
  proBadge: { flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: TF_PINK, borderRadius: Radius.pill, paddingHorizontal: 5, paddingVertical: 2 },
  proText: { fontSize: 7, fontWeight: Typography.weight.extrabold, color: TF_BLACK_BG, letterSpacing: 0.8 },
  sub: { fontSize: Typography.size.xs, color: TF_TEXT_S, lineHeight: 15 },
  tagline: { fontSize: 8, color: TF_PINK + '60', letterSpacing: 0.6, marginTop: 1 },
  right: { alignItems: 'center', gap: 6, flexShrink: 0 },
  countWrap: { alignItems: 'center', gap: 1 },
  countNum: { fontSize: Typography.size.xl, fontWeight: Typography.weight.extrabold, color: TF_PINK, lineHeight: 24 },
  countLabel: { fontSize: 8, color: TF_TEXT_S, textTransform: 'uppercase', letterSpacing: 0.4 },
  ctaBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: TF_PINK, borderRadius: Radius.md, paddingHorizontal: 8, paddingVertical: 4,
    shadowColor: TF_PINK, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.4, shadowRadius: 6, elevation: 4,
  },
  ctaText: { fontSize: 9, fontWeight: Typography.weight.extrabold, color: TF_BLACK_BG },
});

// ── Main Screen ───────────────────────────────────────────────────────────────

export default function DashboardScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { tenant, activeNiche } = useApp();

  const [metrics, setMetrics] = useState<DashMetrics | null>(null);
  const [ebayMetrics, setEbayMetrics] = useState<EbayHubMetrics | null>(null);
  const [intelligence, setIntelligence] = useState<IntelligenceSummary | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!tenant?.id) return;
    setLoading(true);
    try {
      const [m, e, intel] = await Promise.all([
        fetchDashMetrics(tenant.id),
        fetchEbayHubMetrics(tenant.id),
        getIntelligenceSummary(tenant.id),
      ]);
      setMetrics(m);
      setEbayMetrics(e);
      setIntelligence(intel);
    } catch (err) {
      console.error('Dashboard metrics error:', err);
    } finally {
      setLoading(false);
    }
  }, [tenant?.id]);

  useEffect(() => { load(); }, [load]);

  const now = new Date();
  const dateStr = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

  const intelAlertCount = intelligence
    ? (intelligence.draftListings > 0 ? 1 : 0) + (intelligence.staleListing60d > 0 ? 1 : 0) + (intelligence.itemsNeedingImages > 0 ? 1 : 0) + (intelligence.stalePushCount > 0 ? 1 : 0)
    : 0;

  return (
    <View style={s.container}>
      <StatusBar style="light" />
      <ScrollView
        style={s.scroll}
        contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={Colors.primary} />}
      >
        {/* ── Header ── */}
        <View style={[s.header, { paddingTop: insets.top + Spacing.base }]}>
          <View style={s.logoRow}>
            <Pressable
              onPress={() => router.push('/niche-select' as any)}
              style={({ pressed }) => [s.logoMark, { backgroundColor: activeNiche.color }, pressed && { opacity: 0.85 }]}
              hitSlop={4}
            >
              <MaterialIcons name={activeNiche.icon as any} size={18} color={Colors.background} />
            </Pressable>
            <Pressable onPress={() => router.push('/niche-select' as any)} style={s.flex} hitSlop={4}>
              <View style={s.appNameRow}>
                <Text style={[s.appName, { color: activeNiche.color }]}>{activeNiche.shortName.toUpperCase()}</Text>
                <MaterialIcons name="expand-more" size={14} color={Colors.textTertiary} />
              </View>
              <Text style={s.dateLine}>{dateStr}</Text>
            </Pressable>
            <Pressable onPress={() => router.push('/command-centre' as any)} hitSlop={8} style={[s.cmdBtn, intelAlertCount > 0 && s.cmdBtnAlert]}>
              <MaterialIcons name="auto-awesome" size={18} color={intelAlertCount > 0 ? Colors.primary : Colors.textTertiary} />
              {intelAlertCount > 0 ? <View style={s.cmdDot} /> : null}
            </Pressable>
            <Pressable onPress={() => router.push('/settings' as any)} hitSlop={8} style={s.settingsBtn}>
              <MaterialIcons name="settings" size={20} color={Colors.textTertiary} />
            </Pressable>
          </View>

          {/* Dispatch alert */}
          {!loading && metrics && metrics.awaitingDispatch > 0 ? (
            <Pressable onPress={() => router.push('/dispatch' as any)} style={({ pressed }) => [s.dispatchBanner, pressed && { opacity: 0.9 }]}>
              <View style={s.dispatchDot} />
              <Text style={s.dispatchText}>{metrics.awaitingDispatch} order{metrics.awaitingDispatch === 1 ? '' : 's'} awaiting dispatch</Text>
              <MaterialIcons name="local-shipping" size={14} color={Colors.warning} />
              <MaterialIcons name="chevron-right" size={14} color={Colors.warning} />
            </Pressable>
          ) : null}
        </View>

        {/* ── SWISH Intelligence Banner ── */}
        {!loading ? (
          <View style={s.section}>
            <IntelligenceBanner
              intelligence={intelligence}
              onPress={() => router.push('/command-centre' as any)}
            />
          </View>
        ) : null}

        {/* ── Coin Flipper entry point ── */}
        {!loading ? (
        <View style={s.section}>
          <CoinFlipperCard tenantId={tenant?.id ?? ''} />
        </View>
        ) : null}

        {/* ── Flipper MX entry point ── */}
        {!loading ? (
        <View style={s.section}>
          <FlipperMXCard tenantId={tenant?.id ?? ''} />
        </View>
        ) : null}

        {/* ── Bike Flipper entry point ── */}
        {!loading ? (
        <View style={s.section}>
          <BikeFlipperCard tenantId={tenant?.id ?? ''} />
        </View>
        ) : null}

        {/* ── Threads Flip entry point ── */}
        {!loading ? (
        <View style={s.section}>
          <ThreadsFlipCard tenantId={tenant?.id ?? ''} />
        </View>
        ) : null}

        {/* ── KeenOnCoins entry point ── */}
        {!loading ? (
        <View style={s.section}>
          <Pressable
            onPress={() => router.push('/keen-on-coins' as any)}
            style={({ pressed }) => [kocStyles.card, pressed && { opacity: 0.88, transform: [{ scale: 0.98 }] }]}
          >
            <View style={kocStyles.iconWrap}>
              <MaterialIcons name="toll" size={26} color={'#F5C842'} />
            </View>
            <View style={kocStyles.textWrap}>
              <Text style={kocStyles.title}>KeenOnCoins Scanner</Text>
              <Text style={kocStyles.sub}>Photograph · Numista catalogue · AI identification · eBay pricing</Text>
            </View>
            <View style={kocStyles.badge}>
              <Text style={kocStyles.badgeText}>Coins</Text>
              <MaterialIcons name="arrow-forward" size={12} color={'#F5C842'} />
            </View>
          </Pressable>
        </View>
        ) : null}

        {/* ── Revenue card ── */}
        <View style={s.section}>
          <View style={s.revenueCard}>
            <View style={s.revenueHeader}>
              <View>
                <Text style={s.revenueLabel}>REVENUE</Text>
                <Text style={s.revenueMain}>{loading ? '...' : fmt(metrics?.revenueMonth)}</Text>
                <Text style={s.revenueSubLabel}>last 30 days</Text>
              </View>
              <View style={s.revenueSide}>
                <View style={s.revenueStatChip}>
                  <MaterialIcons name="today" size={10} color={Colors.textTertiary} />
                  <Text style={s.revenueStatLabel}>Today</Text>
                  <Text style={[s.revenueStatValue, metrics?.revenueToday ? { color: Colors.success } : {}]}>{loading ? '—' : fmt(metrics?.revenueToday)}</Text>
                </View>
                <View style={s.revenueStatChip}>
                  <MaterialIcons name="date-range" size={10} color={Colors.textTertiary} />
                  <Text style={s.revenueStatLabel}>7 days</Text>
                  <Text style={[s.revenueStatValue, metrics?.revenueWeek ? { color: Colors.primary } : {}]}>{loading ? '—' : fmt(metrics?.revenueWeek)}</Text>
                </View>
                {metrics?.avgSalePrice30d != null ? (
                  <View style={s.revenueStatChip}>
                    <MaterialIcons name="sell" size={10} color={Colors.textTertiary} />
                    <Text style={s.revenueStatLabel}>Avg sale</Text>
                    <Text style={[s.revenueStatValue, { color: Colors.gold }]}>{fmtDec(metrics.avgSalePrice30d)}</Text>
                  </View>
                ) : null}
              </View>
            </View>
            <View style={s.sparklineWrap}>
              {loading ? <View style={s.sparklinePlaceholder}><ActivityIndicator size="small" color={Colors.primary} /></View>
                : <Sparkline data={metrics?.sparkline ?? [0, 0, 0, 0, 0, 0, 0]} />}
            </View>
            {!loading && metrics && metrics.totalSales30d > 0 ? (
              <View style={s.salesCountRow}>
                <MaterialIcons name="check-circle" size={11} color={Colors.success} />
                <Text style={s.salesCountText}>{metrics.totalSales30d} sale{metrics.totalSales30d === 1 ? '' : 's'} in last 30 days</Text>
              </View>
            ) : null}
          </View>
        </View>

        {/* ── Profit card ── */}
        <View style={s.section}>
          <View style={s.sectionHeader}>
            <Text style={s.sectionTitle}>GROSS PROFIT</Text>
            {!loading && metrics?.marginMonth != null ? (
              <View style={[s.marginBadge, { backgroundColor: metrics.marginMonth >= 30 ? Colors.successDim : metrics.marginMonth >= 10 ? Colors.warningDim : Colors.dangerDim }]}>
                <MaterialIcons name={metrics.marginMonth >= 30 ? 'trending-up' : metrics.marginMonth >= 10 ? 'trending-flat' : 'trending-down'} size={11} color={metrics.marginMonth >= 30 ? Colors.success : metrics.marginMonth >= 10 ? Colors.warning : Colors.danger} />
                <Text style={[s.marginBadgeText, { color: metrics.marginMonth >= 30 ? Colors.success : metrics.marginMonth >= 10 ? Colors.warning : Colors.danger }]}>{metrics.marginMonth.toFixed(1)}% margin</Text>
              </View>
            ) : null}
          </View>
          <View style={s.profitCard}>
            {loading ? <View style={{ paddingVertical: Spacing.lg, alignItems: 'center' }}><ActivityIndicator size="small" color={Colors.primary} /></View>
              : metrics ? (
                <>
                  <View style={s.profitHeadline}>
                    <View style={s.profitMainCol}>
                      <Text style={s.profitMainLabel}>30-DAY PROFIT</Text>
                      <Text style={[s.profitMainValue, { color: metrics.profitMonth >= 0 ? Colors.success : Colors.danger }]}>
                        {metrics.profitMonth >= 0 ? '+' : ''}{fmtDec(metrics.profitMonth)}
                      </Text>
                    </View>
                    <View style={s.profitDivider} />
                    <View style={s.profitBreakdown}>
                      <ProfitRow label="Today"      value={(metrics.profitToday >= 0 ? '+' : '') + fmtDec(metrics.profitToday)}  isPositive={metrics.profitToday >= 0} />
                      <View style={s.profitRowDivider} />
                      <ProfitRow label="This week"  value={(metrics.profitWeek >= 0 ? '+' : '') + fmtDec(metrics.profitWeek)}   isPositive={metrics.profitWeek >= 0} />
                      <View style={s.profitRowDivider} />
                      <ProfitRow label="This month" value={(metrics.profitMonth >= 0 ? '+' : '') + fmtDec(metrics.profitMonth)} isPositive={metrics.profitMonth >= 0} />
                    </View>
                  </View>
                  {metrics.marginMonth != null && metrics.revenueMonth > 0 ? (
                    <View style={s.marginGaugeWrap}>
                      <View style={s.marginGaugeTrack}>
                        <View style={[s.marginGaugeFill, { flex: Math.min(Math.max(metrics.marginMonth, 0), 100), backgroundColor: metrics.marginMonth >= 30 ? Colors.success : metrics.marginMonth >= 10 ? Colors.warning : Colors.danger }]} />
                        <View style={{ flex: Math.max(100 - Math.max(metrics.marginMonth, 0), 0) }} />
                      </View>
                      <Text style={s.marginGaugeLabel}>Revenue £{fmtDec(metrics.revenueMonth).replace('£', '')} · Profit £{fmtDec(metrics.profitMonth).replace('£', '')}</Text>
                    </View>
                  ) : metrics.totalSales30d === 0 ? (
                    <Text style={s.profitNoData}>No sales data — profit will appear once items are sold.</Text>
                  ) : null}
                </>
              ) : null}
          </View>
        </View>

        {/* ── List Next ── */}
        {!loading && metrics && metrics.statusBreakdown.available > 0 ? (
          <View style={s.section}>
            <View style={s.sectionHeader}>
              <Text style={s.sectionTitle}>LIST NEXT</Text>
              <Pressable onPress={() => router.navigate('/(tabs)/inventory')} hitSlop={4}><Text style={s.sectionLink}>See All Ready</Text></Pressable>
            </View>
            <Pressable
              onPress={() => router.navigate('/(tabs)/inventory')}
              style={({ pressed }) => [s.listNextCard, pressed && { opacity: 0.88 }]}
            >
              <View style={s.listNextIconWrap}>
                <MaterialIcons name="sell" size={20} color={Colors.primary} />
              </View>
              <View style={s.flex}>
                <Text style={s.listNextTitle}>
                  {metrics.statusBreakdown.available} item{metrics.statusBreakdown.available === 1 ? '' : 's'} ready to list
                </Text>
                <Text style={s.listNextSub}>Identified and valued · tap to open inventory and create listings</Text>
              </View>
              <MaterialIcons name="chevron-right" size={18} color={Colors.primary} />
            </Pressable>
          </View>
        ) : null}

        {/* ── Inventory ── */}
        <View style={s.section}>
          <View style={s.sectionHeader}>
            <Text style={s.sectionTitle}>ACTIVE INVENTORY</Text>
            <Pressable onPress={() => router.navigate('/(tabs)/inventory')} hitSlop={4}><Text style={s.sectionLink}>View All</Text></Pressable>
          </View>
          <View style={s.inventoryCard}>
            <View style={s.inventoryTopRow}>
              <View style={s.totalInventory}>
                <Text style={s.totalInventoryNumber}>{loading ? '—' : fmtInt(metrics?.totalItems)}</Text>
                <Text style={s.totalInventoryLabel}>Active Items</Text>
              </View>
              <View style={s.statusPillsRow}>
                {loading ? <ActivityIndicator size="small" color={Colors.textTertiary} /> : metrics ? (
                  <>
                    <StatusPill label="Listed" count={metrics.statusBreakdown.listed}   color={Colors.success} />
                    <StatusPill label="Ready"  count={metrics.statusBreakdown.available} color={Colors.primary} />
                    <StatusPill label="New"    count={metrics.statusBreakdown.newItems}  color={Colors.textTertiary} />
                    <StatusPill label="Other"  count={metrics.statusBreakdown.other}     color={Colors.textTertiary} />
                  </>
                ) : null}
              </View>
            </View>
            {!loading && metrics && metrics.totalItems > 0 ? (
              <View style={s.inventoryBar}>
                {metrics.statusBreakdown.listed > 0 ? <View style={[s.inventoryBarSegment, { flex: metrics.statusBreakdown.listed, backgroundColor: Colors.success }]} /> : null}
                {metrics.statusBreakdown.available > 0 ? <View style={[s.inventoryBarSegment, { flex: metrics.statusBreakdown.available, backgroundColor: Colors.primary + '80' }]} /> : null}
                {metrics.statusBreakdown.newItems > 0 ? <View style={[s.inventoryBarSegment, { flex: metrics.statusBreakdown.newItems, backgroundColor: Colors.surfaceHighlight }]} /> : null}
              </View>
            ) : null}
          </View>
        </View>

        {/* ── Live Activity ── */}
        <View style={s.section}>
          <View style={s.sectionHeader}><Text style={s.sectionTitle}>LIVE ACTIVITY</Text></View>
          <View style={s.metricsRow}>
            <MetricTile icon="receipt-long" label="Active" value={loading ? '—' : fmtInt(metrics?.activeListingCount)} sub={loading || !metrics ? undefined : `${fmt(metrics.activeListingGMV)} GMV`} color={Colors.success} onPress={() => router.navigate('/(tabs)/listings')} />
            <MetricTile icon="local-shipping" label="Dispatch" value={loading ? '—' : fmtInt(metrics?.awaitingDispatch)} sub="awaiting" color={metrics?.awaitingDispatch ? Colors.warning : Colors.textTertiary} onPress={() => router.push('/dispatch' as any)} />
            <MetricTile icon="edit-note" label="Drafts" value={loading ? '—' : fmtInt(metrics?.draftListingCount)} sub="to submit" color={Colors.textSecondary} onPress={() => router.push('/ebay-admin' as any)} />
          </View>
        </View>

        {/* ── Quick Actions ── */}
        <View style={s.section}>
          <View style={s.sectionHeader}><Text style={s.sectionTitle}>QUICK ACTIONS</Text></View>
          <View style={s.quickActionsGrid}>
            <QuickAction icon="qr-code-scanner" label="Scan Item" color={Colors.primary} onPress={() => router.navigate('/(tabs)/scan')} preferFocus />
            <QuickAction icon="storefront" label="eBay Hub" color={'#E53238'} onPress={() => router.push('/ebay-hub' as any)} />
            <QuickAction icon="receipt-long" label="Orders" badge={metrics?.awaitingDispatch} color={Colors.info} onPress={() => router.push('/orders' as any)} />
            <QuickAction icon="local-shipping" label="Dispatch" badge={metrics?.awaitingDispatch} color={Colors.warning} onPress={() => router.push('/dispatch' as any)} />
            <QuickAction icon="cloud-download" label="Import eBay" color={Colors.primary} onPress={() => router.push('/ebay-import' as any)} />
            <QuickAction icon="upload-file" label="CSV Import" color={Colors.accent} onPress={() => router.push('/ebay-csv' as any)} />
            <QuickAction icon="auto-awesome" label="Command" badge={intelAlertCount > 0 ? intelAlertCount : undefined} color={Colors.primary} onPress={() => router.push('/command-centre' as any)} />
            <QuickAction icon="settings" label="Settings" color={Colors.textSecondary} onPress={() => router.push('/settings' as any)} />
          </View>
        </View>

        {/* ── eBay Hub ── */}
        <View style={s.section}>
          <View style={s.sectionHeader}>
            <View style={s.ebayHubLabelRow}>
              <View style={s.ebayHubDot} /><Text style={s.sectionTitle}>eBay SELLER HUB</Text>
            </View>
            <Pressable onPress={() => router.push('/ebay-hub' as any)} hitSlop={4}><Text style={s.sectionLink}>Open Hub</Text></Pressable>
          </View>
          <Pressable onPress={() => router.push('/ebay-hub' as any)} style={({ pressed }) => [s.ebayHubCard, pressed && { opacity: 0.88 }]}>
            <View style={s.ebayHubHeader}>
              <View style={s.ebayHubBrand}>
                <View style={s.ebayHubIcon}><MaterialIcons name="storefront" size={18} color="#E53238" /></View>
                <View><Text style={s.ebayHubBrandName}>eBay</Text><Text style={s.ebayHubBrandSub}>Seller Hub</Text></View>
              </View>
              <View style={s.ebayHubLiveBadge}><View style={s.ebayHubLiveDot} /><Text style={s.ebayHubLiveText}>Live</Text></View>
            </View>
            <View style={s.ebayHubGrid}>
              {[
                { icon: 'receipt-long', value: loading || !ebayMetrics ? '—' : String(ebayMetrics.activeListings), label: 'Active', color: Colors.success, bg: Colors.successDim },
                { icon: 'sell', value: loading || !ebayMetrics ? '—' : fmt(ebayMetrics.revenueToday), label: 'Today', color: Colors.gold, bg: Colors.goldDim ?? Colors.warningDim },
                { icon: 'local-shipping', value: loading || !ebayMetrics ? '—' : String(ebayMetrics.awaitingDispatch), label: 'Dispatch', color: ebayMetrics && ebayMetrics.awaitingDispatch > 0 ? Colors.warning : Colors.textTertiary, bg: ebayMetrics && ebayMetrics.awaitingDispatch > 0 ? Colors.warningDim : Colors.surfaceHighlight },
                { icon: 'mail', value: loading || !ebayMetrics ? '—' : String(ebayMetrics.unreadMessages), label: 'Unread', color: ebayMetrics && ebayMetrics.unreadMessages > 0 ? Colors.danger : Colors.textTertiary, bg: ebayMetrics && ebayMetrics.unreadMessages > 0 ? Colors.dangerDim : Colors.surfaceHighlight },
              ].map((stat, idx) => (
                <View key={stat.label} style={[s.ebayHubStat, idx > 0 && s.ebayHubStatBordered]}>
                  <View style={[s.ebayHubStatIcon, { backgroundColor: stat.bg }]}><MaterialIcons name={stat.icon as any} size={14} color={stat.color} /></View>
                  <Text style={[s.ebayHubStatValue, { color: stat.label === 'Today' ? Colors.gold : Colors.textPrimary }]}>{stat.value}</Text>
                  <Text style={s.ebayHubStatLabel}>{stat.label}</Text>
                </View>
              ))}
            </View>
            <View style={s.ebayHubFooter}>
              <Text style={s.ebayHubFooterText}>Manage listings, orders, messages & finances</Text>
              <MaterialIcons name="chevron-right" size={16} color="#E53238" />
            </View>
          </Pressable>
        </View>

        {/* ── Recent Sales ── */}
        {!loading && metrics && metrics.recentSales.length > 0 ? (
          <View style={s.section}>
            <View style={s.sectionHeader}>
              <Text style={s.sectionTitle}>RECENT SALES</Text>
              <Pressable onPress={() => router.push('/orders' as any)} hitSlop={4}><Text style={s.sectionLink}>All Orders</Text></Pressable>
            </View>
            <View style={s.recentSalesCard}>
              {metrics.recentSales.map((sale, idx) => (
                <View key={sale.id}>
                  {idx > 0 ? <View style={s.saleDivider} /> : null}
                  <RecentSaleRow sale={sale} onPress={() => router.push(`/stock-listing/${sale.itemId}` as any)} />
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {/* ── Empty state ── */}
        {!loading && metrics?.totalItems === 0 ? (
          <View style={s.section}>
            <View style={s.emptyCard}>
              <View style={s.emptyIconWrap}><MaterialIcons name="toll" size={36} color={Colors.primary} /></View>
              <Text style={s.emptyTitle}>Ready to go</Text>
              <Text style={s.emptyText}>Import your eBay inventory or scan items to populate your dashboard.</Text>
              <View style={s.emptyActions}>
                <Pressable onPress={() => router.push('/ebay-import' as any)} style={[s.emptyBtn, { backgroundColor: Colors.primary }]}>
                  <MaterialIcons name="cloud-download" size={15} color={Colors.background} /><Text style={s.emptyBtnText}>Import eBay</Text>
                </Pressable>
                <Pressable onPress={() => router.navigate('/(tabs)/scan')} style={[s.emptyBtn, { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.surfaceBorder }]}>
                  <MaterialIcons name="qr-code-scanner" size={15} color={Colors.primary} /><Text style={[s.emptyBtnText, { color: Colors.primary }]}>Scan Item</Text>
                </Pressable>
              </View>
            </View>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { flex: 1 },
  flex: { flex: 1 },

  header: { paddingHorizontal: Spacing.base, paddingBottom: Spacing.base, gap: Spacing.sm, borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  logoMark: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' as const, ...Shadow.glow },
  appNameRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 3 },
  appName: { fontSize: Typography.size.lg, fontWeight: Typography.weight.extrabold, color: Colors.primary, letterSpacing: 1.2 },
  dateLine: { fontSize: Typography.size.xs, color: Colors.textTertiary, marginTop: 1 },
  cmdBtn: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.surfaceBorder, position: 'relative' },
  cmdBtnAlert: { borderColor: Colors.primary + '60', backgroundColor: Colors.primaryDim },
  cmdDot: { position: 'absolute', top: 5, right: 5, width: 7, height: 7, borderRadius: 4, backgroundColor: Colors.primary, borderWidth: 1.5, borderColor: Colors.background },
  settingsBtn: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.surfaceBorder },
  dispatchBanner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.warningDim, borderRadius: Radius.md, padding: Spacing.sm, borderWidth: 1, borderColor: Colors.warning + '40', paddingHorizontal: Spacing.md },
  dispatchDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: Colors.warning },
  dispatchText: { flex: 1, fontSize: Typography.size.xs, fontWeight: Typography.weight.semibold, color: Colors.warning },

  section: { paddingHorizontal: Spacing.base, paddingTop: Spacing.lg, gap: Spacing.md },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { fontSize: 10, fontWeight: Typography.weight.bold, color: Colors.textTertiary, letterSpacing: 0.8 },
  sectionLink: { fontSize: Typography.size.xs, color: Colors.primary, fontWeight: Typography.weight.semibold },

  marginBadge: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4, borderRadius: Radius.pill, paddingHorizontal: 8, paddingVertical: 4 },
  marginBadgeText: { fontSize: 10, fontWeight: Typography.weight.bold },

  profitCard: { backgroundColor: Colors.surface, borderRadius: Radius.xxl, borderWidth: 1, borderColor: Colors.surfaceBorder, padding: Spacing.lg, ...Shadow.sm },
  profitHeadline: { flexDirection: 'row' as const, gap: Spacing.md },
  profitMainCol: { justifyContent: 'center' as const, gap: 4, minWidth: 100 },
  profitMainLabel: { fontSize: 9, fontWeight: Typography.weight.bold, color: Colors.textTertiary, letterSpacing: 0.6 },
  profitMainValue: { fontSize: Typography.size.xxl, fontWeight: Typography.weight.extrabold, lineHeight: 38 },
  profitDivider: { width: 1, backgroundColor: Colors.surfaceBorder, marginVertical: 2 },
  profitBreakdown: { flex: 1, justifyContent: 'center' as const, gap: 0 },
  profitRowDivider: { height: 1, backgroundColor: Colors.surfaceBorder },
  marginGaugeWrap: { marginTop: Spacing.md, gap: 6 },
  marginGaugeTrack: { flexDirection: 'row' as const, height: 6, borderRadius: Radius.pill, backgroundColor: Colors.surfaceHighlight, overflow: 'hidden' as const },
  marginGaugeFill: { borderRadius: Radius.pill },
  marginGaugeLabel: { fontSize: 9, color: Colors.textTertiary },
  profitNoData: { fontSize: Typography.size.xs, color: Colors.textTertiary, fontStyle: 'italic' as const, paddingTop: Spacing.sm },

  revenueCard: { backgroundColor: Colors.surface, borderRadius: Radius.xxl, borderWidth: 1, borderColor: Colors.surfaceBorder, padding: Spacing.lg, gap: Spacing.md, ...Shadow.md },
  revenueHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: Spacing.md },
  revenueLabel: { fontSize: 10, fontWeight: Typography.weight.bold, color: Colors.textTertiary, letterSpacing: 0.8 },
  revenueMain: { fontSize: Typography.size.xxxl, fontWeight: Typography.weight.extrabold, color: Colors.textPrimary, lineHeight: 44 },
  revenueSubLabel: { fontSize: Typography.size.xs, color: Colors.textTertiary },
  revenueSide: { alignItems: 'flex-end', gap: Spacing.xs },
  revenueStatChip: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.md, paddingHorizontal: Spacing.sm, paddingVertical: 5, minWidth: 110 },
  revenueStatLabel: { fontSize: 10, color: Colors.textTertiary, flex: 1 },
  revenueStatValue: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  sparklineWrap: { height: 72 },
  sparklinePlaceholder: { height: 72, alignItems: 'center', justifyContent: 'center' },
  salesCountRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  salesCountText: { fontSize: Typography.size.xs, color: Colors.textTertiary },

  inventoryCard: { backgroundColor: Colors.surface, borderRadius: Radius.xxl, borderWidth: 1, borderColor: Colors.surfaceBorder, padding: Spacing.lg, gap: Spacing.md, ...Shadow.sm },
  inventoryTopRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.lg },
  totalInventory: { gap: 2, minWidth: 70 },
  totalInventoryNumber: { fontSize: Typography.size.xxxl, fontWeight: Typography.weight.extrabold, color: Colors.textPrimary, lineHeight: 44 },
  totalInventoryLabel: { fontSize: 10, color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.4 },
  statusPillsRow: { flex: 1, flexDirection: 'row', justifyContent: 'space-around', gap: Spacing.sm },
  inventoryBar: { flexDirection: 'row', height: 6, borderRadius: Radius.pill, overflow: 'hidden', gap: 1 },
  inventoryBarSegment: { borderRadius: Radius.pill },

  metricsRow: { flexDirection: 'row', gap: Spacing.sm },

  quickActionsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.base, backgroundColor: Colors.surface, borderRadius: Radius.xxl, borderWidth: 1, borderColor: Colors.surfaceBorder, padding: Spacing.lg, ...Shadow.sm },

  recentSalesCard: { backgroundColor: Colors.surface, borderRadius: Radius.xxl, borderWidth: 1, borderColor: Colors.surfaceBorder, paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs, ...Shadow.sm },
  saleDivider: { height: 1, backgroundColor: Colors.surfaceBorder, marginLeft: 48 + Spacing.md },

  ebayHubCard: { backgroundColor: Colors.surface, borderRadius: Radius.xxl, borderWidth: 1, borderColor: '#E5323830', overflow: 'hidden', ...Shadow.sm },
  ebayHubLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  ebayHubDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#E53238' },
  ebayHubHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.lg, paddingTop: Spacing.md, paddingBottom: Spacing.sm, borderBottomWidth: 1, borderBottomColor: '#E5323818' },
  ebayHubBrand: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  ebayHubIcon: { width: 34, height: 34, borderRadius: Radius.md, backgroundColor: '#E5323815', alignItems: 'center', justifyContent: 'center' },
  ebayHubBrandName: { fontSize: Typography.size.md, fontWeight: Typography.weight.extrabold, color: '#E53238', letterSpacing: 0.5 },
  ebayHubBrandSub: { fontSize: 9, color: Colors.textTertiary, fontWeight: Typography.weight.medium },
  ebayHubLiveBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: Colors.successDim, borderRadius: Radius.pill, paddingHorizontal: 8, paddingVertical: 4 },
  ebayHubLiveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.success },
  ebayHubLiveText: { fontSize: 9, fontWeight: Typography.weight.bold, color: Colors.success },
  ebayHubGrid: { flexDirection: 'row', paddingHorizontal: Spacing.sm, paddingVertical: Spacing.md },
  ebayHubStat: { flex: 1, alignItems: 'center', gap: 5, paddingVertical: Spacing.xs },
  ebayHubStatBordered: { borderLeftWidth: 1, borderLeftColor: Colors.surfaceBorder },
  ebayHubStatIcon: { width: 32, height: 32, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  ebayHubStatValue: { fontSize: Typography.size.lg, fontWeight: Typography.weight.extrabold, color: Colors.textPrimary },
  ebayHubStatLabel: { fontSize: 9, color: Colors.textTertiary, fontWeight: Typography.weight.medium, textTransform: 'uppercase', letterSpacing: 0.3 },
  ebayHubFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm, borderTopWidth: 1, borderTopColor: '#E5323818', backgroundColor: '#E523230A' },
  ebayHubFooterText: { fontSize: 10, color: Colors.textSecondary, flex: 1 },

  emptyCard: { backgroundColor: Colors.surface, borderRadius: Radius.xxl, borderWidth: 1, borderColor: Colors.surfaceBorder, borderStyle: 'dashed', padding: Spacing.xl, alignItems: 'center', gap: Spacing.md },
  listNextCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surface, borderRadius: Radius.xl, borderWidth: 1, borderColor: Colors.primary + '40', padding: Spacing.md, ...Shadow.sm },
  listNextIconWrap: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.primaryDim, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  listNextTitle: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.textPrimary },
  listNextSub: { fontSize: Typography.size.xs, color: Colors.textTertiary, marginTop: 2, lineHeight: 15 },
  emptyIconWrap: { width: 72, height: 72, borderRadius: 36, backgroundColor: Colors.primaryDim, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontSize: Typography.size.lg, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  emptyText: { fontSize: Typography.size.sm, color: Colors.textTertiary, textAlign: 'center', lineHeight: 20 },
  emptyActions: { flexDirection: 'row', gap: Spacing.sm },
  emptyBtn: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, borderRadius: Radius.pill, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm },
  emptyBtnText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.background },
});

const kocStyles = StyleSheet.create({
  card: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: '#14130D', borderRadius: Radius.xl,
    padding: Spacing.base, borderWidth: 1, borderColor: '#F5C84230',
    ...Shadow.sm,
  },
  iconWrap: {
    width: 52, height: 52, borderRadius: Radius.lg,
    backgroundColor: '#2A2000', alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: '#F5C84225', flexShrink: 0,
  },
  textWrap: { flex: 1, gap: 3 },
  title: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: '#F5C842' },
  sub: { fontSize: Typography.size.xs, color: '#8B7A40', lineHeight: 16 },
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#2A2000', borderRadius: Radius.pill,
    paddingHorizontal: Spacing.sm, paddingVertical: 5,
    borderWidth: 1, borderColor: '#F5C84225',
  },
  badgeText: { fontSize: 9, fontWeight: Typography.weight.bold, color: '#F5C842', textTransform: 'uppercase', letterSpacing: 0.5 },
});
