// SWISH — eBay Seller Hub
// Complete eBay operating system embedded in SWISH.
// The user should not need Seller Hub for normal operations.
//
// Navigation hub linking to all eBay sections:
//   Overview | Listings | Orders | Messages | Offers
//   Returns | Cases | Finances | Analytics | Account | Sync | Log

import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import { getSupabaseClient } from '@/template';
import { Colors, Typography, Spacing, Radius, Shadow } from '@/constants/theme';
import { useApp } from '@/hooks/useApp';
import { getProductionNicheSpecialistIds, resolveProductionNiche } from '@/services/nicheRouting';
import { useMemo } from 'react';
import { useAlert } from '@/template';

// ── Types ─────────────────────────────────────────────────────────────────────

interface EbayMetrics {
  isConnected: boolean;
  tokenExpiry: string | null;
  tokenHealthy: boolean;
  sellerAccount: string;
  lastSync: string | null;
  activeListings: number;
  draftListings: number;
  endedListings: number;
  totalListings: number;
  gmv: number;
  awaitingDispatch: number;
  dispatchedToday: number;
  totalOrdersThisMonth: number;
  revenueToday: number;
  revenueWeek: number;
  revenueMonth: number;
  unreadMessages: number;
  openReturns: number;
  openCases: number;
  pendingOffers: number;
  awaitingSellerAction: number;
  pendingPayout: number;
  totalFeesMonth: number;
  netProfitMonth: number;
  feedbackScore: number;
  positivePercent: number;
}

interface ActionItem {
  id: string;
  priority: 'critical' | 'high' | 'medium';
  icon: string;
  title: string;
  count: number;
  route: string;
  color: string;
}

// ── Load metrics from DB ───────────────────────────────────────────────────────

function emptyEbayMetrics(): EbayMetrics {
  return {
    isConnected: false, tokenExpiry: null, tokenHealthy: false, sellerAccount: '',
    lastSync: null, activeListings: 0, draftListings: 0, endedListings: 0,
    totalListings: 0, gmv: 0, awaitingDispatch: 0, dispatchedToday: 0,
    totalOrdersThisMonth: 0, revenueToday: 0, revenueWeek: 0, revenueMonth: 0,
    unreadMessages: 0, openReturns: 0, openCases: 0, pendingOffers: 0,
    awaitingSellerAction: 0, pendingPayout: 0, totalFeesMonth: 0, netProfitMonth: 0,
    feedbackScore: 0, positivePercent: 100,
  };
}

async function loadEbayMetrics(tenantId: string, specialistIds?: string[]): Promise<EbayMetrics> {
  const supabase = getSupabaseClient();
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  // Build niche-filtered listing, order and sales queries. Seller-account-level
  // messages, returns, offers and financial transactions remain account-wide;
  // item-linked operational and revenue counts must respect the active niche.
  let listingQuery = supabase
    .from('listings')
    .select('status, items!inner(specialist_id)')
    .eq('tenant_id', tenantId)
    .eq('marketplace_id', 'ebay');

  if (specialistIds) {
    if (specialistIds.length === 0) {
      return emptyEbayMetrics();
    }
    listingQuery = listingQuery.in('items.specialist_id', specialistIds) as any;
  }

  const salesQuery = (fromDate: string) => {
    let query = supabase
      .from('sales')
      .select(specialistIds ? 'sale_price, net_revenue, items!inner(specialist_id)' : 'sale_price, net_revenue')
      .eq('tenant_id', tenantId)
      .eq('marketplace_id', 'ebay')
      .gte('sold_at', fromDate);
    if (specialistIds) query = query.in('items.specialist_id', specialistIds) as any;
    return query;
  };

  let ordersQuery = supabase
    .from('orders')
    .select(specialistIds ? 'id, fulfilment_status, dispatched_at, items!inner(specialist_id)' : 'id, fulfilment_status, dispatched_at')
    .eq('tenant_id', tenantId)
    .eq('marketplace_id', 'ebay')
    .in('fulfilment_status', ['awaiting_dispatch', 'packing', 'label_created']);
  if (specialistIds) ordersQuery = ordersQuery.in('items.specialist_id', specialistIds) as any;

  const [
    connectorRes, listingCountsRes, ordersDispatchRes,
    salesTodayRes, salesWeekRes, salesMonthRes,
    messagesRes, returnsRes, casesRes, offersRes, financialsRes, feedbackRes,
  ] = await Promise.all([
    supabase.from('marketplace_connectors').select('status, access_token_expires_at, seller_account_id, last_sync_at').eq('tenant_id', tenantId).eq('marketplace_id', 'ebay').maybeSingle(),
    listingQuery,
    ordersQuery,
    salesQuery(todayStart),
    salesQuery(weekStart),
    salesQuery(monthStart),
    supabase.from('ebay_messages').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('is_read', false).eq('direction', 'inbound'),
    supabase.from('ebay_returns').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).neq('status', 'closed'),
    supabase.from('ebay_cases').select('id, status').eq('tenant_id', tenantId).neq('status', 'closed').neq('status', 'resolved'),
    supabase.from('ebay_offers').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('status', 'pending'),
    supabase.from('ebay_financials').select('amount, transaction_type').eq('tenant_id', tenantId).gte('transaction_date', monthStart),
    supabase.from('ebay_feedback').select('rating').eq('tenant_id', tenantId),
  ]);

  const connector = connectorRes.data;
  const isConnected = connector?.status === 'connected';
  const tokenExpiry = connector?.access_token_expires_at ?? null;
  const tokenHealthy = tokenExpiry ? new Date(tokenExpiry) > new Date(Date.now() + 60 * 60 * 1000) : false;
  // Apply niche filter to listing rows
  const allListingRows = listingCountsRes.data ?? [];
  const listingRows = specialistIds && specialistIds.length > 0
    ? allListingRows.filter(l => specialistIds.includes((l as any).items?.specialist_id ?? ''))
    : allListingRows;
  const activeListings = listingRows.filter(l => l.status === 'active').length;
  const draftListings = listingRows.filter(l => l.status === 'draft' || l.status === 'pending').length;
  const endedListings = listingRows.filter(l => l.status === 'ended').length;
  const awaitingDispatch = ordersDispatchRes.data?.length ?? 0;
  const sumRevenue = (rows: any[]) => rows.reduce((s, r) => s + Number(r.sale_price ?? 0), 0);
  const revenueToday = sumRevenue(salesTodayRes.data ?? []);
  const revenueWeek = sumRevenue(salesWeekRes.data ?? []);
  const revenueMonth = sumRevenue(salesMonthRes.data ?? []);
  const totalOrdersThisMonth = salesMonthRes.data?.length ?? 0;
  const unreadMessages = messagesRes.count ?? 0;
  const openReturns = returnsRes.count ?? 0;
  const openCases = casesRes.data?.length ?? 0;
  const awaitingSellerCases = casesRes.data?.filter(c => c.status === 'awaiting_seller').length ?? 0;
  const pendingOffers = offersRes.count ?? 0;
  const financials = financialsRes.data ?? [];
  const pendingPayout = financials.filter(f => f.transaction_type === 'sale').reduce((s, f) => s + Number(f.amount ?? 0), 0);
  const totalFeesMonth = Math.abs(financials.filter(f => f.transaction_type === 'fee').reduce((s, f) => s + Number(f.amount ?? 0), 0));
  const netProfitMonth = salesMonthRes.data?.reduce((s, r) => s + Number(r.net_revenue ?? 0), 0) ?? 0;
  const feedbackRows = feedbackRes.data ?? [];
  const positiveCount = feedbackRows.filter(f => f.rating === 'Positive').length;
  const positivePercent = feedbackRows.length > 0 ? Math.round((positiveCount / feedbackRows.length) * 100) : 100;

  return {
    isConnected, tokenExpiry, tokenHealthy,
    sellerAccount: connector?.seller_account_id ?? '',
    lastSync: connector?.last_sync_at ?? null,
    activeListings, draftListings, endedListings,
    totalListings: listingRows.length, gmv: 0,
    awaitingDispatch, dispatchedToday: 0, totalOrdersThisMonth,
    revenueToday, revenueWeek, revenueMonth,
    unreadMessages, openReturns, openCases, pendingOffers,
    awaitingSellerAction: awaitingSellerCases,
    pendingPayout, totalFeesMonth, netProfitMonth,
    feedbackScore: feedbackRows.length, positivePercent,
  };
}

// ── Connection Health Banner ──────────────────────────────────────────────────

function ConnectionBanner({
  metrics, onReconnect, onRefreshToken, refreshingToken,
}: {
  metrics: EbayMetrics;
  onReconnect: () => void;
  onRefreshToken: () => void;
  refreshingToken: boolean;
}) {
  if (!metrics.isConnected) {
    return (
      <Pressable onPress={onReconnect} style={[b.banner, b.bannerDisconnected]}>
        <MaterialIcons name="link-off" size={16} color={Colors.danger} />
        <View style={b.flex}>
          <Text style={[b.bannerTitle, { color: Colors.danger }]}>eBay Not Connected</Text>
          <Text style={b.bannerSub}>Tap to set up OAuth connection</Text>
        </View>
        <MaterialIcons name="chevron-right" size={16} color={Colors.danger} />
      </Pressable>
    );
  }

  const tokenExpiryDate = metrics.tokenExpiry ? new Date(metrics.tokenExpiry) : null;
  const msLeft = tokenExpiryDate ? tokenExpiryDate.getTime() - Date.now() : null;
  const tokenDaysLeft = msLeft !== null ? Math.floor(msLeft / (1000 * 60 * 60 * 24)) : null;
  const tokenHoursLeft = msLeft !== null ? Math.floor(msLeft / (1000 * 60 * 60)) : null;
  const tokenExpired = msLeft !== null ? msLeft <= 0 : false;
  const tokenWarning = msLeft !== null && msLeft > 0 && msLeft < 3 * 24 * 60 * 60 * 1000;

  const expiryLabel = tokenExpired
    ? 'Expired'
    : tokenDaysLeft === 0 ? `Expires in ${tokenHoursLeft}h`
    : tokenDaysLeft === 1 ? 'Expires tomorrow'
    : tokenDaysLeft !== null ? `Expires in ${tokenDaysLeft}d`
    : null;

  if (tokenExpired) {
    return (
      <Pressable onPress={onReconnect} style={[b.banner, b.bannerWarning]}>
        <MaterialIcons name="warning" size={16} color={Colors.warning} />
        <View style={b.flex}>
          <Text style={[b.bannerTitle, { color: Colors.warning }]}>Token Expired</Text>
          <Text style={b.bannerSub}>Re-authorise eBay to restore functionality</Text>
        </View>
        <View style={b.reconnectBtn}><Text style={b.reconnectBtnText}>Reconnect</Text></View>
      </Pressable>
    );
  }

  if (tokenWarning) {
    return (
      <Pressable onPress={onRefreshToken} style={[b.banner, b.bannerWarning]}>
        <MaterialIcons name="access-time" size={16} color={Colors.warning} />
        <View style={b.flex}>
          <Text style={[b.bannerTitle, { color: Colors.warning }]}>{expiryLabel}</Text>
          <Text style={b.bannerSub}>Tap to silently refresh eBay token</Text>
        </View>
        <View style={b.reconnectBtn}>
          {refreshingToken ? (
            <ActivityIndicator size="small" color={Colors.background} style={{ width: 40, height: 16 }} />
          ) : (
            <Text style={b.reconnectBtnText}>Refresh</Text>
          )}
        </View>
      </Pressable>
    );
  }

  return (
    <View style={[b.banner, b.bannerConnected]}>
      <View style={b.connectedDot} />
      <View style={b.flex}>
        <Text style={[b.bannerTitle, { color: Colors.success }]}>
          eBay Connected{metrics.sellerAccount ? ` · ${metrics.sellerAccount}` : ''}
        </Text>
        <Text style={b.bannerSub}>
          {expiryLabel ? `${expiryLabel} · ` : 'Token valid · '}
          {metrics.lastSync ? `Synced ${new Date(metrics.lastSync).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : 'Not yet synced'}
        </Text>
      </View>
      <MaterialIcons name="check-circle" size={16} color={Colors.success} />
    </View>
  );
}

const b = StyleSheet.create({
  flex: { flex: 1 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.base, paddingVertical: Spacing.md, borderBottomWidth: 1 },
  bannerConnected: { backgroundColor: Colors.successDim, borderBottomColor: Colors.success + '30' },
  bannerDisconnected: { backgroundColor: Colors.dangerDim, borderBottomColor: Colors.danger + '30' },
  bannerWarning: { backgroundColor: Colors.warningDim, borderBottomColor: Colors.warning + '30' },
  bannerTitle: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold },
  bannerSub: { fontSize: Typography.size.xs, color: Colors.textTertiary, marginTop: 1 },
  connectedDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.success },
  reconnectBtn: { backgroundColor: Colors.warning, borderRadius: Radius.sm, paddingHorizontal: Spacing.sm, paddingVertical: 4 },
  reconnectBtnText: { fontSize: Typography.size.xs, fontWeight: Typography.weight.bold, color: Colors.background },
});

// ── Metric Card ───────────────────────────────────────────────────────────────

function MetricCard({ icon, label, value, subValue, color = Colors.textPrimary, onPress }: {
  icon: string; label: string; value: string; subValue?: string; color?: string; onPress?: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [mc.card, pressed && onPress && { opacity: 0.85 }]}>
      <MaterialIcons name={icon as any} size={18} color={color} />
      <Text style={[mc.value, { color }]}>{value}</Text>
      <Text style={mc.label}>{label}</Text>
      {subValue ? <Text style={mc.sub}>{subValue}</Text> : null}
    </Pressable>
  );
}

const mc = StyleSheet.create({
  card: { flex: 1, backgroundColor: Colors.surface, borderRadius: Radius.xl, padding: Spacing.md, gap: 4, borderWidth: 1, borderColor: Colors.surfaceBorder, alignItems: 'flex-start', ...Shadow.sm, minWidth: 100 },
  value: { fontSize: Typography.size.xl, fontWeight: Typography.weight.extrabold },
  label: { fontSize: Typography.size.xs, color: Colors.textTertiary },
  sub: { fontSize: 9, color: Colors.textTertiary, marginTop: 1 },
});

// ── Action Centre ─────────────────────────────────────────────────────────────

function ActionCentre({ actions }: { actions: ActionItem[] }) {
  const router = useRouter();
  const urgent = actions.filter(a => a.count > 0);
  if (urgent.length === 0) return null;

  return (
    <View style={ac.section}>
      <View style={ac.header}>
        <MaterialIcons name="notifications-active" size={14} color={Colors.warning} />
        <Text style={ac.headerTitle}>Action Required</Text>
        <View style={ac.countBadge}><Text style={ac.countBadgeText}>{urgent.length}</Text></View>
      </View>
      <View style={ac.list}>
        {urgent.map(a => (
          <Pressable key={a.id} onPress={() => router.push(a.route as any)} style={({ pressed }) => [ac.row, pressed && { opacity: 0.85 }, a.priority === 'critical' && ac.rowCritical]}>
            <View style={[ac.iconWrap, { backgroundColor: a.color + '20' }]}><MaterialIcons name={a.icon as any} size={14} color={a.color} /></View>
            <Text style={ac.rowText}>{a.title}</Text>
            <View style={[ac.badge, { backgroundColor: a.color + '25' }]}><Text style={[ac.badgeText, { color: a.color }]}>{a.count}</Text></View>
            <MaterialIcons name="chevron-right" size={14} color={Colors.textTertiary} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const ac = StyleSheet.create({
  section: { backgroundColor: Colors.surface, borderRadius: Radius.xl, borderWidth: 1, borderColor: Colors.surfaceBorder, overflow: 'hidden', ...Shadow.sm },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.base, paddingVertical: Spacing.sm, backgroundColor: Colors.warningDim, borderBottomWidth: 1, borderBottomColor: Colors.warning + '25' },
  headerTitle: { flex: 1, fontSize: Typography.size.xs, fontWeight: Typography.weight.bold, color: Colors.warning, textTransform: 'uppercase', letterSpacing: 0.5 },
  countBadge: { backgroundColor: Colors.warning, borderRadius: Radius.pill, paddingHorizontal: 6, paddingVertical: 2, minWidth: 20, alignItems: 'center' },
  countBadgeText: { fontSize: 9, fontWeight: Typography.weight.extrabold, color: Colors.background },
  list: { paddingVertical: Spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.base, paddingVertical: Spacing.sm, borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder },
  rowCritical: { backgroundColor: Colors.dangerDim + '60' },
  iconWrap: { width: 28, height: 28, borderRadius: Radius.sm, alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1, fontSize: Typography.size.sm, color: Colors.textSecondary },
  badge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: Radius.pill },
  badgeText: { fontSize: Typography.size.xs, fontWeight: Typography.weight.bold },
});

// ── Hub Card ──────────────────────────────────────────────────────────────────

interface HubSection {
  id: string; icon: string; title: string; description: string;
  route: string; color: string; badge?: string | number; badgeColor?: string;
  available: boolean; apiNote?: string;
}

function HubCard({ section }: { section: HubSection }) {
  const router = useRouter();
  return (
    <Pressable onPress={() => router.push(section.route as any)} style={({ pressed }) => [hc.card, !section.available && hc.cardUnavailable, pressed && { opacity: 0.85 }]}>
      <View style={[hc.iconWrap, { backgroundColor: section.color + '20' }]}>
        <MaterialIcons name={section.icon as any} size={20} color={section.available ? section.color : Colors.textTertiary} />
      </View>
      <View style={hc.content}>
        <View style={hc.titleRow}>
          <Text style={[hc.title, !section.available && { color: Colors.textSecondary }]}>{section.title}</Text>
          {section.badge !== undefined && section.badge !== 0 ? (
            <View style={[hc.badge, { backgroundColor: (section.badgeColor ?? Colors.danger) + '25' }]}>
              <Text style={[hc.badgeText, { color: section.badgeColor ?? Colors.danger }]}>{section.badge}</Text>
            </View>
          ) : null}
          {!section.available ? <View style={hc.unavailBadge}><Text style={hc.unavailText}>API</Text></View> : null}
        </View>
        <Text style={hc.desc} numberOfLines={1}>{section.description}</Text>
        {section.apiNote && !section.available ? <Text style={hc.apiNote}>{section.apiNote}</Text> : null}
      </View>
      <MaterialIcons name="chevron-right" size={14} color={Colors.textTertiary} />
    </Pressable>
  );
}

const hc = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surface, borderRadius: Radius.xl, padding: Spacing.base, borderWidth: 1, borderColor: Colors.surfaceBorder, ...Shadow.sm },
  cardUnavailable: { opacity: 0.7 },
  iconWrap: { width: 44, height: 44, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  content: { flex: 1, gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  desc: { fontSize: Typography.size.xs, color: Colors.textTertiary },
  badge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: Radius.pill },
  badgeText: { fontSize: 9, fontWeight: Typography.weight.extrabold },
  unavailBadge: { backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.pill, paddingHorizontal: 5, paddingVertical: 2 },
  unavailText: { fontSize: 9, color: Colors.textTertiary, fontWeight: Typography.weight.semibold },
  apiNote: { fontSize: 9, color: Colors.textTertiary, marginTop: 1 },
});

// ── Main Screen ───────────────────────────────────────────────────────────────

// ── Niche theme for eBay Hub header ─────────────────────────────────────────
function useNicheHubStyle(activeNicheId: string | null | undefined) {
  return useMemo(() => {
    const niche = resolveProductionNiche(activeNicheId);
    const specialistIds = getProductionNicheSpecialistIds(activeNicheId);
    if (niche === 'motocross') return { accent: '#FF5500', icon: 'two-wheeler' as const, label: 'MX', specialistIds };
    if (niche === 'bicycles') return { accent: '#6ED020', icon: 'pedal-bike' as const, label: 'Bikes', specialistIds };
    if (niche === 'clothing') return { accent: '#E91E8C', icon: 'checkroom' as const, label: 'Fashion', specialistIds };
    if (niche === 'surplus_flip') return { accent: '#14B8A6', icon: 'inventory-2' as const, label: 'Surplus', specialistIds };
    if (niche === 'coins') return { accent: Colors.primary, icon: 'toll' as const, label: 'Coins', specialistIds };
    return { accent: Colors.primary, icon: 'toll' as const, label: 'Select niche', specialistIds: [] as string[] };
  }, [activeNicheId]);
}

export default function EbayHubScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { tenant, activeNicheId } = useApp();
  const { showAlert } = useAlert();
  const supabase = getSupabaseClient();
  const nicheStyle = useNicheHubStyle(activeNicheId);

  const [metrics, setMetrics] = useState<EbayMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tokenRefreshing, setTokenRefreshing] = useState(false);

  // ── eBay Sync state ────────────────────────────────────────────────────────
  interface HubSyncState {
    phase: 'idle' | 'running' | 'done' | 'error';
    current: number; total: number; updated: number; images: number;
    titles: number; failed: number; errorMsg?: string; requiresReauth?: boolean;
  }
  const EMPTY_SYNC: HubSyncState = { phase: 'idle', current: 0, total: 0, updated: 0, images: 0, titles: 0, failed: 0 };
  const [hubSync, setHubSync] = useState<HubSyncState>(EMPTY_SYNC);

  // ── Image download to Storage state ───────────────────────────────────────
  interface ImgDlState {
    state: 'idle' | 'running' | 'done' | 'error';
    downloaded: number; failed: number; notFound: number;
    errorMsg?: string; requiresReauth?: boolean;
  }
  const EMPTY_IMGDL: ImgDlState = { state: 'idle', downloaded: 0, failed: 0, notFound: 0 };
  const [hubImgDl, setHubImgDl] = useState<ImgDlState>(EMPTY_IMGDL);

  const load = useCallback(async () => {
    if (!tenant) return;
    try {
      const m = await loadEbayMetrics(tenant.id, nicheStyle.specialistIds);
      setMetrics(m);
    } catch (e: any) {
      showAlert('Load Error', e?.message ?? 'Failed to load eBay metrics');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [tenant?.id, showAlert, nicheStyle.specialistIds]);

  // ── Silent token refresh ──────────────────────────────────────────────────
  const handleTokenRefresh = useCallback(async () => {
    if (!tenant?.id || tokenRefreshing) return;
    setTokenRefreshing(true);
    try {
      const { data, error } = await supabase.functions.invoke('swish-ebay-sync', {
        body: { tenantId: tenant.id, mode: 'refresh_token_only' },
      });
      if (error || !data?.success) router.push('/marketplaces' as any);
      const m = await loadEbayMetrics(tenant.id, nicheStyle.specialistIds);
      setMetrics(m);
    } catch {
      router.push('/marketplaces' as any);
    } finally {
      setTokenRefreshing(false);
    }
  }, [tenant?.id, tokenRefreshing, supabase, router, load, nicheStyle.specialistIds]);

  // ── Sync with eBay ────────────────────────────────────────────────────────
  const handleHubSync = useCallback(async () => {
    if (!tenant?.id || hubSync.phase === 'running') return;
    setHubSync({ ...EMPTY_SYNC, phase: 'running' });
    setHubImgDl(EMPTY_IMGDL);
    try {
      const { data, error } = await supabase.functions.invoke('swish-ebay-sync', {
        body: { tenantId: tenant.id, mode: 'full' },
      });
      if (error) {
        let msg = error.message ?? 'Unknown error';
        try { const t = await (error as any).context?.text?.(); if (t) { try { const p = JSON.parse(t); msg = p.error ?? t; } catch { msg = t; } } } catch {}
        const isReauth = msg.includes('REQUIRES_REAUTH') || msg.includes('re-authoris');
        setHubSync(prev => ({ ...prev, phase: 'error', errorMsg: msg, requiresReauth: isReauth }));
        return;
      }
      setHubSync({
        phase: 'done',
        current: data?.processed ?? 0, total: data?.processed ?? 0,
        updated: data?.updated ?? 0, images: data?.imagesFetched ?? 0,
        titles: data?.titlesFixed ?? 0, failed: data?.failed ?? 0,
        requiresReauth: data?.requiresReauth ?? false,
      });
      // Reset image download so the button appears fresh
      setHubImgDl(EMPTY_IMGDL);
      load();
    } catch (e: any) {
      setHubSync(prev => ({ ...prev, phase: 'error', errorMsg: e?.message ?? 'Sync failed' }));
    }
  }, [tenant?.id, hubSync.phase, supabase, load]);

  // ── Download Images to Storage (second phase) ─────────────────────────────
  const handleHubImageDownload = useCallback(async () => {
    if (!tenant?.id || hubImgDl.state === 'running') return;
    setHubImgDl({ ...EMPTY_IMGDL, state: 'running' });
    try {
      const { data, error } = await supabase.functions.invoke('swish-image-download', {
        body: { tenantId: tenant.id, fixTitles: false },
      });
      if (error) {
        let msg = error.message ?? 'Unknown error';
        try { const t = await (error as any).context?.text?.(); if (t) { try { const p = JSON.parse(t); msg = p.error ?? t; } catch { msg = t; } } } catch {}
        setHubImgDl({ ...EMPTY_IMGDL, state: 'error', errorMsg: msg, requiresReauth: msg.includes('re-authoris') || msg.includes('REQUIRES_REAUTH') });
        return;
      }
      setHubImgDl({
        state: 'done',
        downloaded: data?.imagesDownloaded ?? 0,
        failed: data?.imagesFailed ?? 0,
        notFound: data?.imagesNotFound ?? 0,
        requiresReauth: data?.requiresReauth ?? false,
      });
      load();
    } catch (e: any) {
      setHubImgDl({ ...EMPTY_IMGDL, state: 'error', errorMsg: e?.message ?? 'Download failed' });
    }
  }, [tenant?.id, hubImgDl.state, supabase, load]);

  useEffect(() => { load(); }, [load]);
  const onRefresh = useCallback(() => { setRefreshing(true); load(); }, [load]);

  // ── Actions ────────────────────────────────────────────────────────────────
  const actions: ActionItem[] = metrics ? [
    metrics.awaitingDispatch > 0 && { id: 'dispatch', priority: 'critical' as const, icon: 'local-shipping', title: `${metrics.awaitingDispatch} order${metrics.awaitingDispatch > 1 ? 's' : ''} waiting to be dispatched`, count: metrics.awaitingDispatch, route: '/dispatch', color: Colors.danger },
    metrics.awaitingSellerAction > 0 && { id: 'cases', priority: 'critical' as const, icon: 'gavel', title: `${metrics.awaitingSellerAction} case${metrics.awaitingSellerAction > 1 ? 's' : ''} awaiting your response`, count: metrics.awaitingSellerAction, route: '/ebay-cases', color: Colors.danger },
    metrics.openReturns > 0 && { id: 'returns', priority: 'high' as const, icon: 'assignment-return', title: `${metrics.openReturns} return${metrics.openReturns > 1 ? 's' : ''} require attention`, count: metrics.openReturns, route: '/ebay-returns', color: Colors.warning },
    metrics.unreadMessages > 0 && { id: 'messages', priority: 'high' as const, icon: 'mail', title: `${metrics.unreadMessages} unread message${metrics.unreadMessages > 1 ? 's' : ''} from buyers`, count: metrics.unreadMessages, route: '/ebay-messages', color: Colors.info },
    metrics.pendingOffers > 0 && { id: 'offers', priority: 'medium' as const, icon: 'local-offer', title: `${metrics.pendingOffers} offer${metrics.pendingOffers > 1 ? 's' : ''} awaiting response`, count: metrics.pendingOffers, route: '/ebay-offers', color: Colors.accent },
    metrics.draftListings > 0 && { id: 'drafts', priority: 'medium' as const, icon: 'drafts', title: `${metrics.draftListings} listing${metrics.draftListings > 1 ? 's' : ''} ready to publish`, count: metrics.draftListings, route: '/ebay-admin', color: Colors.primary },
  ].filter(Boolean) as ActionItem[] : [];

  // ── Hub sections ──────────────────────────────────────────────────────────
  const sections: HubSection[] = [
    { id: 'listings', icon: 'receipt-long', title: 'Listings', description: `${metrics?.activeListings ?? 0} active · ${metrics?.draftListings ?? 0} draft`, route: '/ebay-admin', color: Colors.primary, badge: metrics?.draftListings ?? 0, badgeColor: Colors.warning, available: true },
    { id: 'orders', icon: 'shopping-bag', title: 'Orders', description: `${metrics?.awaitingDispatch ?? 0} awaiting dispatch · ${metrics?.totalOrdersThisMonth ?? 0} this month`, route: '/orders', color: Colors.success, badge: metrics?.awaitingDispatch ?? 0, badgeColor: Colors.danger, available: true },
    { id: 'dispatch', icon: 'local-shipping', title: 'Dispatch', description: 'Pick, pack and dispatch orders with proof photos', route: '/dispatch', color: Colors.warning, badge: metrics?.awaitingDispatch ?? 0, badgeColor: Colors.danger, available: true },
    { id: 'messages', icon: 'mail', title: 'Messages', description: 'Buyer communications with AI reply assistant', route: '/ebay-messages', color: Colors.info, badge: metrics?.unreadMessages ?? 0, badgeColor: Colors.danger, available: true },
    { id: 'offers', icon: 'local-offer', title: 'Offers & Negotiation', description: 'Send targeted offers to watchers via Negotiation API', route: '/ebay-offers', color: Colors.accent, badge: metrics?.pendingOffers ?? 0, badgeColor: Colors.accent, available: true },
    { id: 'returns', icon: 'assignment-return', title: 'Returns', description: `${metrics?.openReturns ?? 0} open return requests`, route: '/ebay-returns', color: Colors.warning, badge: metrics?.openReturns ?? 0, badgeColor: Colors.warning, available: true },
    { id: 'cases', icon: 'gavel', title: 'Cases & Disputes', description: `${metrics?.openCases ?? 0} open cases`, route: '/ebay-cases', color: Colors.danger, badge: metrics?.openCases ?? 0, badgeColor: Colors.danger, available: true },
    { id: 'finances', icon: 'account-balance-wallet', title: 'Finances', description: 'Payouts, fees, and transaction history', route: '/ebay-finances', color: Colors.gold, available: true },
    { id: 'analytics', icon: 'insights', title: 'Analytics', description: 'Traffic, conversion, impressions, and performance', route: '/ebay-analytics', color: Colors.success, available: true },
    { id: 'csv', icon: 'upload-file', title: 'CSV Import', description: 'Bootstrap historical data from eBay exports', route: '/ebay-csv', color: Colors.primary, available: true },
    { id: 'import', icon: 'cloud-download', title: 'API Import', description: 'Import live listings via eBay Trading API', route: '/ebay-import', color: Colors.info, available: true },
    { id: 'draft-roundtrip-test', icon: 'sync-alt', title: 'Draft Category Round-Trip Test', description: 'Test category sync using an unpublished eBay draft (test harness in progress)', route: '/ebay-draft-sync-test', color: Colors.warning, available: true },
    { id: 'marketing', icon: 'campaign', title: 'Marketing', description: 'Promoted listings and seller promotions', route: '/ebay-hub', color: Colors.accent, available: false, apiNote: 'Requires eBay Marketing API approval' },
    { id: 'account', icon: 'manage-accounts', title: 'Account & Policies', description: 'Business policies, selling limits, payment', route: '/ebay-account', color: Colors.textSecondary, available: true },
    { id: 'sync', icon: 'sync', title: 'Sync Engine', description: 'Synchronise listings, orders, and inventory', route: '/ebay-admin', color: Colors.primary, available: true },
    { id: 'categories', icon: 'category', title: 'Category Catalogue', description: 'Manage & sync EBAY_GB category catalogue', route: '/ebay-category-admin', color: Colors.accent, available: true },
    { id: 'log', icon: 'history', title: 'Activity Log', description: 'Full eBay API audit trail', route: '/ebay-log', color: Colors.textSecondary, available: true },
  ];

  if (loading) {
    return (
      <View style={s.loadingContainer}>
        <StatusBar style="light" />
        <View style={[s.header, { paddingTop: insets.top + Spacing.base }]}>
          <Pressable onPress={() => router.back()} style={s.backBtn} hitSlop={8}>
            <MaterialIcons name="arrow-back" size={20} color={Colors.textSecondary} />
          </Pressable>
          <Text style={s.title}>eBay Hub</Text>
        </View>
        <View style={s.loading}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={s.loadingText}>Loading eBay Seller Hub...</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={s.container}>
      <StatusBar style="light" />

      {/* Header — niche-aware */}
      <View style={[s.header, { paddingTop: insets.top + Spacing.base, borderBottomColor: nicheStyle.accent + '30' }]}>
        <Pressable onPress={() => router.back()} style={s.backBtn} hitSlop={8}>
          <MaterialIcons name="arrow-back" size={20} color={Colors.textSecondary} />
        </Pressable>
        <View style={s.flex}>
          <View style={s.titleRow}>
            <View style={[s.ebayBadge, { backgroundColor: nicheStyle.accent + '18', borderColor: nicheStyle.accent + '50' }]}>
              <MaterialIcons name={nicheStyle.icon} size={12} color={nicheStyle.accent} />
              <Text style={[s.ebayBadgeText, { color: nicheStyle.accent }]}>eBay</Text>
            </View>
            <Text style={[s.title, { color: nicheStyle.accent }]}>{nicheStyle.label} Seller Hub</Text>
          </View>
          <Text style={s.subtitle}>
            {metrics?.activeListings ?? 0} {nicheStyle.label.toLowerCase()} listings · £{((metrics?.revenueMonth ?? 0)).toFixed(0)} this month
          </Text>
        </View>
        <Pressable onPress={() => router.push('/marketplaces' as any)} style={s.settingsBtn} hitSlop={8}>
          <MaterialIcons name="settings" size={16} color={Colors.textSecondary} />
        </Pressable>
      </View>

      {/* Connection Banner */}
      {metrics ? (
        <ConnectionBanner
          metrics={metrics}
          onReconnect={() => router.push('/marketplaces' as any)}
          onRefreshToken={handleTokenRefresh}
          refreshingToken={tokenRefreshing}
        />
      ) : null}

      <ScrollView
        contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 80 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
      >
        {/* ── Sync with eBay Panel ─────────────────────────────────────── */}
        <View style={s.syncPanel}>
          <View style={s.syncPanelHeader}>
            <View style={s.syncPanelIcon}>
              <MaterialIcons name="sync" size={18} color="#E53238" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.syncPanelTitle}>Sync with eBay</Text>
              <Text style={s.syncPanelDesc}>Update all titles, descriptions and item specifics from eBay</Text>
            </View>
          </View>

          {/* Sync running */}
          {hubSync.phase === 'running' ? (
            <View style={s.syncRunning}>
              <ActivityIndicator size="small" color="#E53238" />
              <Text style={s.syncRunningText}>Syncing eBay listings…</Text>
            </View>
          ) : null}

          {/* Sync done */}
          {hubSync.phase === 'done' ? (
            <View style={s.syncResult}>
              {hubSync.requiresReauth ? (
                <Pressable onPress={() => router.push('/marketplaces' as any)} style={s.syncReauthBanner}>
                  <MaterialIcons name="link-off" size={12} color={Colors.danger} />
                  <Text style={s.syncReauthText}>Re-authorise eBay required</Text>
                  <MaterialIcons name="chevron-right" size={12} color={Colors.danger} />
                </Pressable>
              ) : null}
              <View style={s.syncResultRow}>
                {([
                  { icon: 'check-circle' as const, color: hubSync.updated > 0 ? Colors.success : Colors.textTertiary, label: 'Updated', value: hubSync.updated },
                  { icon: 'photo-library' as const, color: hubSync.images > 0 ? Colors.info : Colors.textTertiary, label: 'Images', value: hubSync.images },
                  { icon: 'title' as const, color: hubSync.titles > 0 ? Colors.warning : Colors.textTertiary, label: 'Titles', value: hubSync.titles },
                  { icon: 'error-outline' as const, color: hubSync.failed > 0 ? Colors.danger : Colors.textTertiary, label: 'Failed', value: hubSync.failed },
                ]).map(m => (
                  <View key={m.label} style={s.syncMetric}>
                    <MaterialIcons name={m.icon} size={14} color={m.color} />
                    <Text style={[s.syncMetricValue, { color: m.color }]}>{m.value}</Text>
                    <Text style={s.syncMetricLabel}>{m.label}</Text>
                  </View>
                ))}
              </View>

              {/* ── Download Images to Storage (second phase) ── */}
              {hubImgDl.state === 'idle' ? (
                <Pressable onPress={handleHubImageDownload} style={({ pressed }) => [s.imgDlBtn, pressed && { opacity: 0.8 }]}>
                  <MaterialIcons name="cloud-download" size={15} color={Colors.background} />
                  <Text style={s.imgDlBtnText}>Download Images to Storage</Text>
                </Pressable>
              ) : hubImgDl.state === 'running' ? (
                <View style={[s.imgDlBtn, { opacity: 0.75 }]}>
                  <ActivityIndicator size="small" color={Colors.background} style={{ width: 15, height: 15 }} />
                  <Text style={s.imgDlBtnText}>Downloading images…</Text>
                </View>
              ) : hubImgDl.state === 'done' ? (
                <View style={s.imgDlResult}>
                  {hubImgDl.requiresReauth ? (
                    <Pressable onPress={() => router.push('/marketplaces' as any)} style={s.syncReauthBanner}>
                      <MaterialIcons name="link-off" size={12} color={Colors.danger} />
                      <Text style={s.syncReauthText}>Re-authorise eBay required</Text>
                      <MaterialIcons name="chevron-right" size={12} color={Colors.danger} />
                    </Pressable>
                  ) : null}
                  <View style={s.syncResultRow}>
                    <View style={s.syncMetric}><MaterialIcons name="check-circle" size={13} color={hubImgDl.downloaded > 0 ? Colors.success : Colors.textTertiary} /><Text style={[s.syncMetricValue, { color: hubImgDl.downloaded > 0 ? Colors.success : Colors.textTertiary }]}>{hubImgDl.downloaded}</Text><Text style={s.syncMetricLabel}>Saved</Text></View>
                    <View style={s.syncMetric}><MaterialIcons name="search-off" size={13} color={Colors.textTertiary} /><Text style={[s.syncMetricValue, { color: Colors.textTertiary }]}>{hubImgDl.notFound}</Text><Text style={s.syncMetricLabel}>Not Found</Text></View>
                    <View style={s.syncMetric}><MaterialIcons name="error-outline" size={13} color={hubImgDl.failed > 0 ? Colors.danger : Colors.textTertiary} /><Text style={[s.syncMetricValue, { color: hubImgDl.failed > 0 ? Colors.danger : Colors.textTertiary }]}>{hubImgDl.failed}</Text><Text style={s.syncMetricLabel}>Failed</Text></View>
                  </View>
                  <Text style={[s.syncPanelDesc, { textAlign: 'center' }]}>Images permanently stored in Supabase Storage</Text>
                </View>
              ) : hubImgDl.state === 'error' ? (
                <View style={s.syncError}>
                  <MaterialIcons name="error" size={13} color={Colors.danger} />
                  <Text style={s.syncErrorText} numberOfLines={2}>{hubImgDl.errorMsg}</Text>
                  <Pressable onPress={() => setHubImgDl(EMPTY_IMGDL)} hitSlop={8}><Text style={[s.syncDismissText, { color: Colors.primary }]}>Retry</Text></Pressable>
                </View>
              ) : null}

              <Pressable onPress={() => { setHubSync(EMPTY_SYNC); setHubImgDl(EMPTY_IMGDL); }} style={s.syncDismiss} hitSlop={8}>
                <Text style={s.syncDismissText}>Dismiss</Text>
              </Pressable>
            </View>
          ) : null}

          {/* Sync error */}
          {hubSync.phase === 'error' ? (
            <View style={s.syncError}>
              <MaterialIcons name="error" size={13} color={Colors.danger} />
              <Text style={s.syncErrorText} numberOfLines={2}>{hubSync.errorMsg}</Text>
              <Pressable onPress={() => setHubSync(EMPTY_SYNC)} hitSlop={8}>
                <Text style={[s.syncDismissText, { color: Colors.primary }]}>Retry</Text>
              </Pressable>
            </View>
          ) : null}

          {/* Sync button */}
          {hubSync.phase === 'idle' || hubSync.phase === 'error' ? (
            <Pressable onPress={handleHubSync} style={({ pressed }) => [s.syncBtn, pressed && { opacity: 0.8 }]}>
              <MaterialIcons name="sync" size={16} color={Colors.background} />
              <Text style={s.syncBtnText}>Sync with eBay</Text>
            </Pressable>
          ) : hubSync.phase === 'running' ? (
            <View style={[s.syncBtn, { opacity: 0.7 }]}>
              <ActivityIndicator size="small" color={Colors.background} style={{ width: 16, height: 16 }} />
              <Text style={s.syncBtnText}>Syncing…</Text>
            </View>
          ) : null}
        </View>

        {/* ── Top Metrics Grid ── */}
        <View style={s.sectionLabel}><Text style={s.sectionTitle}>TODAY</Text></View>
        <View style={s.metricsRow}>
          <MetricCard icon="sell" label="Revenue" value={`£${(metrics?.revenueToday ?? 0).toFixed(0)}`} subValue="today" color={Colors.gold} onPress={() => router.push('/ebay-finances' as any)} />
          <MetricCard icon="local-shipping" label="Dispatch" value={String(metrics?.awaitingDispatch ?? 0)} subValue="awaiting" color={metrics?.awaitingDispatch ? Colors.danger : Colors.success} onPress={() => router.push('/dispatch' as any)} />
          <MetricCard icon="mail" label="Messages" value={String(metrics?.unreadMessages ?? 0)} subValue="unread" color={metrics?.unreadMessages ? Colors.info : Colors.textTertiary} onPress={() => router.push('/ebay-messages' as any)} />
        </View>
        <View style={s.metricsRow}>
          <MetricCard icon="storefront" label="Active" value={String(metrics?.activeListings ?? 0)} subValue="listings" color={Colors.success} onPress={() => router.push('/ebay-admin' as any)} />
          <MetricCard icon="trending-up" label="This Week" value={`£${(metrics?.revenueWeek ?? 0).toFixed(0)}`} color={Colors.primary} />
          <MetricCard icon="calendar-month" label="This Month" value={`£${(metrics?.revenueMonth ?? 0).toFixed(0)}`} color={Colors.accent} />
        </View>

        {/* ── Action Centre ── */}
        {actions.length > 0 ? (
          <>
            <View style={s.sectionLabel}><Text style={s.sectionTitle}>ACTION REQUIRED</Text></View>
            <ActionCentre actions={actions} />
          </>
        ) : (
          <View style={s.allClearCard}>
            <MaterialIcons name="check-circle" size={20} color={Colors.success} />
            <Text style={s.allClearText}>All clear — no actions required</Text>
          </View>
        )}

        {/* ── Hub Sections ── */}
        <View style={s.sectionLabel}><Text style={s.sectionTitle}>SELLER OPERATIONS</Text></View>
        {sections.map(sec => <HubCard key={sec.id} section={sec} />)}

        {/* ── API Note ── */}
        <View style={s.apiNoteCard}>
          <MaterialIcons name="info-outline" size={14} color={Colors.textTertiary} />
          <Text style={s.apiNoteText}>
            Sections marked "API" require additional eBay partner approval. All other
            sections use the eBay Trading API, Fulfillment API, and Browse API with
            your existing OAuth credentials.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  loadingContainer: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },

  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.base, paddingBottom: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder },
  backBtn: { width: 34, height: 34, borderRadius: Radius.md, backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.surfaceBorder },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  ebayBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: Radius.sm, paddingHorizontal: 7, paddingVertical: 2, borderWidth: 1 },
  ebayBadgeText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.extrabold, letterSpacing: 0.5 },
  title: { fontSize: Typography.size.xl, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  subtitle: { fontSize: Typography.size.xs - 1, color: Colors.textTertiary, marginTop: 2 },
  settingsBtn: { width: 34, height: 34, borderRadius: Radius.md, backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.surfaceBorder },

  content: { padding: Spacing.base, gap: Spacing.md },
  sectionLabel: { marginBottom: -4 },
  sectionTitle: { fontSize: Typography.size.xs, fontWeight: Typography.weight.bold, color: Colors.textTertiary, letterSpacing: 0.6, textTransform: 'uppercase' },
  metricsRow: { flexDirection: 'row', gap: Spacing.sm },
  allClearCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.successDim, borderRadius: Radius.xl, padding: Spacing.base, borderWidth: 1, borderColor: Colors.success + '30' },
  allClearText: { fontSize: Typography.size.sm, color: Colors.success, fontWeight: Typography.weight.medium },

  // Sync Panel
  syncPanel: { backgroundColor: Colors.surface, borderRadius: Radius.xl, borderWidth: 1, borderColor: '#E5323840', padding: Spacing.base, gap: Spacing.md, ...Shadow.sm },
  syncPanelHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md },
  syncPanelIcon: { width: 36, height: 36, borderRadius: Radius.sm, backgroundColor: '#E5323815', alignItems: 'center', justifyContent: 'center' },
  syncPanelTitle: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.textPrimary },
  syncPanelDesc: { fontSize: Typography.size.xs, color: Colors.textTertiary, marginTop: 2, lineHeight: 16 },
  syncRunning: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  syncRunningText: { fontSize: Typography.size.sm, color: '#E53238', fontWeight: Typography.weight.medium },
  syncResult: { gap: Spacing.sm },
  syncReauthBanner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.dangerDim, borderRadius: Radius.md, padding: Spacing.sm, borderWidth: 1, borderColor: Colors.danger + '40' },
  syncReauthText: { flex: 1, fontSize: Typography.size.xs, color: Colors.danger },
  syncResultRow: { flexDirection: 'row', justifyContent: 'space-around' },
  syncMetric: { alignItems: 'center', gap: 3 },
  syncMetricValue: { fontSize: Typography.size.lg, fontWeight: Typography.weight.bold },
  syncMetricLabel: { fontSize: 9, color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.4 },
  syncDismiss: { alignSelf: 'center' },
  syncDismissText: { fontSize: Typography.size.xs, color: Colors.textTertiary, textDecorationLine: 'underline' },
  syncError: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.dangerDim, borderRadius: Radius.md, padding: Spacing.sm },
  syncErrorText: { flex: 1, fontSize: Typography.size.xs, color: Colors.danger, lineHeight: 15 },
  syncBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, backgroundColor: '#E53238', borderRadius: Radius.md, paddingVertical: Spacing.md },
  syncBtnText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.background },

  // Image download second phase
  imgDlBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, backgroundColor: Colors.info, borderRadius: Radius.md, paddingVertical: 10 },
  imgDlBtnText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.background },
  imgDlResult: { gap: Spacing.sm, backgroundColor: Colors.successDim + '50', borderRadius: Radius.md, padding: Spacing.sm, borderWidth: 1, borderColor: Colors.success + '25' },

  apiNoteCard: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.md, padding: Spacing.md, marginTop: Spacing.sm },
  apiNoteText: { flex: 1, fontSize: Typography.size.xs, color: Colors.textTertiary, lineHeight: 16 },

  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md },
  loadingText: { fontSize: Typography.size.sm, color: Colors.textTertiary },
});
