// SWISH — eBay Finances Screen v2
// Shows actual eBay financial data from Finances API where available,
// with transparent fallback to estimates when Managed Payments is not connected.

import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  ActivityIndicator, RefreshControl, Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import { getSupabaseClient } from '@/template';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { Colors, Typography, Spacing, Radius, Shadow } from '@/constants/theme';
import { useApp } from '@/hooks/useApp';
import { useAlert } from '@/template';

// ── Types ─────────────────────────────────────────────────────────────────────

interface FinanceSummary {
  grossSalesMonth: number;
  netRevenueMonth: number;
  feesMonth: number;
  profitMonth: number;
  salesCountMonth: number;
  grossSalesWeek: number;
  netRevenueWeek: number;
  grossSalesYear: number;
  netRevenueYear: number;
  avgSalePrice: number;
  avgMarginPct: number;
  // Real eBay Finances API data (null if not available)
  actualFees?: number;
  actualPayouts?: number;
  actualRefunds?: number;
  actualShippingLabels?: number;
  actualNetAfterFees?: number;
  financesApiAvailable: boolean;
  feeDataSource: 'actual_ebay' | 'estimate';
}

interface FundsSummaryAmount {
  value: string;
  currency: string;
}

interface FundsSummary {
  totalFunds?: FundsSummaryAmount;
  availableFunds?: FundsSummaryAmount;
  processingFunds?: FundsSummaryAmount;
  fundsOnHold?: FundsSummaryAmount;
}

interface SaleRecord {
  id: string;
  itemTitle: string;
  salePrice: number;
  marketplaceFee: number;
  shippingCost: number;
  netRevenue: number;
  profit: number;
  soldAt: string;
  feeSource: 'actual' | 'estimate';
}

type TimePeriod = 'week' | 'month' | 'quarter' | 'year';

const PERIOD_LABELS: Record<TimePeriod, string> = {
  week: '7 Days',
  month: 'This Month',
  quarter: '3 Months',
  year: 'This Year',
};

function periodStart(period: TimePeriod): string {
  const now = new Date();
  switch (period) {
    case 'week':    return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    case 'month':   return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    case 'quarter': return new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();
    case 'year':    return new Date(now.getFullYear(), 0, 1).toISOString();
  }
}

// ── Stat Row ──────────────────────────────────────────────────────────────────

function StatRow({ icon, label, value, sub, color = Colors.textPrimary, highlight = false, badge }: {
  icon: string; label: string; value: string; sub?: string; color?: string; highlight?: boolean; badge?: string;
}) {
  return (
    <View style={[sr.row, highlight && sr.rowHighlight]}>
      <View style={[sr.iconWrap, { backgroundColor: color + '20' }]}>
        <MaterialIcons name={icon as any} size={14} color={color} />
      </View>
      <View style={sr.content}>
        <Text style={sr.label}>{label}</Text>
        {sub ? <Text style={sr.sub}>{sub}</Text> : null}
      </View>
      <View style={sr.right}>
        <Text style={[sr.value, { color }]}>{value}</Text>
        {badge ? <View style={[sr.badge, { backgroundColor: color + '20' }]}><Text style={[sr.badgeText, { color }]}>{badge}</Text></View> : null}
      </View>
    </View>
  );
}

const sr = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.sm, paddingHorizontal: Spacing.base, borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder },
  rowHighlight: { backgroundColor: Colors.surfaceHighlight },
  iconWrap: { width: 30, height: 30, borderRadius: Radius.sm, alignItems: 'center', justifyContent: 'center' },
  content: { flex: 1 },
  label: { fontSize: Typography.size.sm, color: Colors.textSecondary },
  sub: { fontSize: 10, color: Colors.textTertiary, marginTop: 1 },
  right: { alignItems: 'flex-end', gap: 3 },
  value: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold },
  badge: { paddingHorizontal: 5, paddingVertical: 1, borderRadius: Radius.pill },
  badgeText: { fontSize: 8, fontWeight: Typography.weight.bold },
});

// ── Sale Row ──────────────────────────────────────────────────────────────────

function SaleRow({ sale }: { sale: SaleRecord }) {
  const profit = sale.profit ?? (sale.netRevenue - 0);
  const profitColor = profit > 0 ? Colors.success : Colors.danger;
  return (
    <View style={slr.row}>
      <View style={slr.content}>
        <Text style={slr.title} numberOfLines={1}>{sale.itemTitle}</Text>
        <View style={slr.metaRow}>
          <Text style={slr.date}>{new Date(sale.soldAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</Text>
          <View style={[slr.feeSourceBadge, { backgroundColor: sale.feeSource === 'actual' ? Colors.successDim : Colors.warningDim }]}>
            <Text style={[slr.feeSourceText, { color: sale.feeSource === 'actual' ? Colors.success : Colors.warning }]}>
              {sale.feeSource === 'actual' ? 'Actual fee' : 'Est. fee'}
            </Text>
          </View>
        </View>
      </View>
      <View style={slr.amounts}>
        <Text style={slr.price}>£{sale.salePrice.toFixed(2)}</Text>
        <View style={[slr.profitBadge, { backgroundColor: profitColor + '20' }]}>
          <Text style={[slr.profitText, { color: profitColor }]}>
            {profit >= 0 ? '+' : ''}£{profit.toFixed(2)}
          </Text>
        </View>
      </View>
    </View>
  );
}

const slr = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingHorizontal: Spacing.base, paddingVertical: Spacing.sm, borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder },
  content: { flex: 1, gap: 3 },
  title: { fontSize: Typography.size.sm, color: Colors.textPrimary, fontWeight: Typography.weight.medium },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  date: { fontSize: 10, color: Colors.textTertiary },
  feeSourceBadge: { paddingHorizontal: 5, paddingVertical: 1, borderRadius: Radius.pill },
  feeSourceText: { fontSize: 8, fontWeight: Typography.weight.bold },
  amounts: { alignItems: 'flex-end', gap: 3 },
  price: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.gold },
  profitBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: Radius.pill },
  profitText: { fontSize: 10, fontWeight: Typography.weight.bold },
});

// ── Main Screen ───────────────────────────────────────────────────────────────

export default function EbayFinancesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { tenant } = useApp();
  const { showAlert } = useAlert();

  const [summary, setSummary] = useState<FinanceSummary | null>(null);
  const [fundsSummary, setFundsSummary] = useState<FundsSummary | null>(null);
  const [fundsSummaryError, setFundsSummaryError] = useState<string | null>(null);
  const [sales, setSales] = useState<SaleRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [syncingFinances, setSyncingFinances] = useState(false);
  const [period, setPeriod] = useState<TimePeriod>('month');

  const loadData = useCallback(async () => {
    if (!tenant) return;
    const supabase = getSupabaseClient();
    const start = periodStart(period);
    const weekStart = periodStart('week');
    const yearStart = periodStart('year');
    const monthStart = periodStart('month');

    const [periodSales, weekSales, yearSales, recentSales, financialsTx] = await Promise.all([
      supabase.from('sales').select('sale_price, net_revenue, marketplace_fee, shipping_cost, profit, sold_at').eq('tenant_id', tenant.id).eq('marketplace_id', 'ebay').gte('sold_at', start),
      supabase.from('sales').select('sale_price, net_revenue').eq('tenant_id', tenant.id).eq('marketplace_id', 'ebay').gte('sold_at', weekStart),
      supabase.from('sales').select('sale_price, net_revenue').eq('tenant_id', tenant.id).eq('marketplace_id', 'ebay').gte('sold_at', yearStart),
      supabase.from('sales').select('*, items(canonical_title, media)').eq('tenant_id', tenant.id).eq('marketplace_id', 'ebay').gte('sold_at', monthStart).order('sold_at', { ascending: false }).limit(50),
      // Check if we have real eBay financial data
      supabase.from('ebay_financials').select('transaction_type, amount, ebay_order_id').eq('tenant_id', tenant.id).gte('transaction_date', monthStart),
    ]);

    const rows = periodSales.data ?? [];
    const gross = rows.reduce((s, r) => s + Number(r.sale_price ?? 0), 0);
    const net = rows.reduce((s, r) => s + Number(r.net_revenue ?? 0), 0);
    const fees = rows.reduce((s, r) => s + Number(r.marketplace_fee ?? 0), 0);
    const profit = rows.reduce((s, r) => s + Number(r.profit ?? 0), 0);
    const avgPrice = rows.length > 0 ? gross / rows.length : 0;
    const avgMargin = gross > 0 ? ((gross - fees) / gross) * 100 : 0;

    // Check real eBay financial data availability
    const txRows = financialsTx.data ?? [];
    const hasRealData = txRows.length > 0;
    const realFees = txRows.filter(r => r.transaction_type?.includes('FINAL_VALUE_FEE') && r.amount < 0).reduce((s, r) => s + Math.abs(Number(r.amount)), 0);
    const realPayouts = txRows.filter(r => r.transaction_type === 'PAYOUT').reduce((s, r) => s + Math.abs(Number(r.amount)), 0);
    const realRefunds = txRows.filter(r => r.transaction_type === 'REFUND').reduce((s, r) => s + Number(r.amount), 0);
    const realShipping = txRows.filter(r => r.transaction_type === 'SHIPPING_LABEL' && r.amount < 0).reduce((s, r) => s + Math.abs(Number(r.amount)), 0);

    // Map which orders have actual fees
    const orderIdsWithActualFees = new Set(
      txRows.filter(r => r.transaction_type?.includes('FINAL_VALUE_FEE') && r.ebay_order_id).map(r => r.ebay_order_id)
    );

    setSummary({
      grossSalesMonth: gross,
      netRevenueMonth: net,
      feesMonth: fees,
      profitMonth: profit,
      salesCountMonth: rows.length,
      grossSalesWeek: (weekSales.data ?? []).reduce((s, r) => s + Number(r.sale_price ?? 0), 0),
      netRevenueWeek: (weekSales.data ?? []).reduce((s, r) => s + Number(r.net_revenue ?? 0), 0),
      grossSalesYear: (yearSales.data ?? []).reduce((s, r) => s + Number(r.sale_price ?? 0), 0),
      netRevenueYear: (yearSales.data ?? []).reduce((s, r) => s + Number(r.net_revenue ?? 0), 0),
      avgSalePrice: avgPrice,
      avgMarginPct: avgMargin,
      actualFees: hasRealData ? realFees : undefined,
      actualPayouts: hasRealData ? realPayouts : undefined,
      actualRefunds: hasRealData ? realRefunds : undefined,
      actualShippingLabels: hasRealData ? realShipping : undefined,
      actualNetAfterFees: hasRealData ? gross - realFees + realRefunds : undefined,
      financesApiAvailable: hasRealData,
      feeDataSource: hasRealData ? 'actual_ebay' : 'estimate',
    });

    setSales((recentSales.data ?? []).map((r: any) => ({
      id: r.id,
      itemTitle: r.items?.canonical_title ?? 'Unknown Item',
      salePrice: Number(r.sale_price ?? 0),
      marketplaceFee: Number(r.marketplace_fee ?? 0),
      shippingCost: Number(r.shipping_cost ?? 0),
      netRevenue: Number(r.net_revenue ?? 0),
      profit: Number(r.profit ?? 0),
      soldAt: r.sold_at,
      feeSource: orderIdsWithActualFees.has(r.external_order_id) ? 'actual' : 'estimate',
    })));

    setLoading(false);
    setRefreshing(false);
  }, [tenant?.id, period]);

  useEffect(() => { loadData(); }, [loadData]);
  const onRefresh = useCallback(() => { setRefreshing(true); loadData(); }, [loadData]);

  // ── Sync eBay Finances API ─────────────────────────────────────────────────

  const handleSyncFinances = useCallback(async () => {
    if (!tenant) return;
    setSyncingFinances(true);
    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase.functions.invoke('swish-ebay-finances', {
        body: { tenantId: tenant.id, route: 'sync_transactions', daysBack: 90 },
      });

      if (error) {
        let msg = error.message;
        if (error instanceof FunctionsHttpError) {
          try { const t = await error.context?.text(); const p = t ? JSON.parse(t) : null; msg = p?.error ?? t ?? msg; } catch {}
        }
        showAlert('Finances Sync', msg);
        return;
      }

      if (!data?.success || !data?.financesApiAvailable) {
        showAlert(
          'eBay Finances API',
          data?.error ?? 'eBay Finances API is not available for your account.\n\nThis requires:\n• eBay Managed Payments\n• Re-authorising eBay with the sell.finances scope\n\nFee estimates (12.8%) are shown until real data is available.',
        );
        return;
      }

      // Fetch eBay's actual funds summary separately from historical transaction totals.
      const { data: fundsData, error: fundsInvokeError } = await supabase.functions.invoke('swish-ebay-finances', {
        body: { tenantId: tenant.id, route: 'get_funds_summary' },
      });
      if (fundsInvokeError || !fundsData?.success) {
        setFundsSummary(null);
        setFundsSummaryError(fundsData?.error ?? fundsInvokeError?.message ?? 'Available funds could not be retrieved.');
      } else {
        setFundsSummary(fundsData.fundsSummary as FundsSummary);
        setFundsSummaryError(null);
      }

      showAlert('Finances Synced', `${data.fetched} transactions synced. ${data.inserted} new, ${data.updated} updated.`);
      await loadData();
    } finally {
      setSyncingFinances(false);
    }
  }, [tenant, showAlert, loadData]);

  const fmtGBP = (v?: number) => v != null ? `£${v.toFixed(2)}` : '—';
  const formatFunds = (amount?: FundsSummaryAmount) => amount ? new Intl.NumberFormat('en-GB', { style: 'currency', currency: amount.currency || 'GBP' }).format(Number(amount.value ?? 0)) : '—';
  const hasRealData = summary?.financesApiAvailable ?? false;

  return (
    <View style={s.container}>
      <StatusBar style="light" />

      <View style={[s.header, { paddingTop: insets.top + Spacing.base }]}>
        <Pressable onPress={() => router.back()} style={s.backBtn} hitSlop={8}>
          <MaterialIcons name="arrow-back" size={20} color={Colors.textSecondary} />
        </Pressable>
        <View style={s.flex}>
          <Text style={s.title}>eBay Finances</Text>
          <Text style={s.subtitle}>
            {hasRealData ? 'Real eBay fee data' : 'Fee estimates (12.8%)'}
          </Text>
        </View>
        <Pressable onPress={handleSyncFinances} disabled={syncingFinances} style={[s.syncBtn, syncingFinances && { opacity: 0.7 }]} hitSlop={4}>
          {syncingFinances
            ? <ActivityIndicator size="small" color={Colors.accent} style={{ width: 14, height: 14 }} />
            : <MaterialIcons name="sync" size={14} color={Colors.accent} />}
          <Text style={s.syncBtnText}>{syncingFinances ? 'Syncing...' : 'Sync'}</Text>
        </Pressable>
        <Pressable onPress={() => router.push('/money' as any)} style={s.fullBtn} hitSlop={4}>
          <MaterialIcons name="account-balance" size={14} color={Colors.gold} />
          <Text style={s.fullBtnText}>P&L</Text>
        </Pressable>
      </View>

      {/* Fee data source banner */}
      <View style={[s.dataSourceBanner, { backgroundColor: hasRealData ? Colors.successDim : Colors.warningDim }]}>
        <MaterialIcons name={hasRealData ? 'check-circle' : 'info-outline'} size={13} color={hasRealData ? Colors.success : Colors.warning} />
        <Text style={[s.dataSourceText, { color: hasRealData ? Colors.success : Colors.warning }]}>
          {hasRealData
            ? 'Using real eBay fee data from Finances API'
            : 'Using estimated fees (12.8%). Tap Sync to load real eBay data — requires Managed Payments.'}
        </Text>
      </View>

      {/* Period selector */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.periodRow} style={{ borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder }}>
        {(Object.keys(PERIOD_LABELS) as TimePeriod[]).map(p => (
          <Pressable key={p} onPress={() => setPeriod(p)} style={[s.periodBtn, period === p && s.periodBtnActive]}>
            <Text style={[s.periodText, period === p && s.periodTextActive]}>{PERIOD_LABELS[p]}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {loading ? (
        <View style={s.loading}><ActivityIndicator color={Colors.primary} size="large" /></View>
      ) : (
        <ScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 80 }]} showsVerticalScrollIndicator={false} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}>

          {/* Summary hero cards */}
          <View style={s.heroRow}>
            <View style={s.heroCard}>
              <Text style={s.heroLabel}>Gross Sales</Text>
              <Text style={s.heroValue}>{fmtGBP(summary?.grossSalesMonth)}</Text>
              <Text style={s.heroSub}>{PERIOD_LABELS[period]}</Text>
            </View>
            <View style={[s.heroCard, { borderColor: Colors.success + '40' }]}>
              <Text style={s.heroLabel}>Net Revenue</Text>
              <Text style={[s.heroValue, { color: Colors.success }]}>{fmtGBP(summary?.netRevenueMonth)}</Text>
              <Text style={s.heroSub}>after fees</Text>
            </View>
          </View>

          {/* Live seller funds — distinct from historical sales/payout totals */}
          <View style={s.section}>
            <Text style={s.sectionTitle}>SELLER FUNDS</Text>
            <View style={s.sectionCard}>
              {fundsSummary ? (
                <>
                  <StatRow icon="account-balance-wallet" label="Available Funds" sub="Available to be paid out" value={formatFunds(fundsSummary.availableFunds)} color={Colors.success} highlight badge="LIVE" />
                  <StatRow icon="schedule" label="Processing Funds" value={formatFunds(fundsSummary.processingFunds)} color={Colors.info} />
                  <StatRow icon="pause-circle-outline" label="Funds on Hold" value={formatFunds(fundsSummary.fundsOnHold)} color={Colors.warning} />
                  <StatRow icon="payments" label="Total Pending Funds" value={formatFunds(fundsSummary.totalFunds)} color={Colors.primary} />
                </>
              ) : (
                <StatRow icon="account-balance-wallet" label="Available Funds" sub={fundsSummaryError ?? 'Tap Sync to retrieve live eBay funds'} value="—" color={Colors.textTertiary} />
              )}
            </View>
          </View>

          {/* Real Finances API data if available */}
          {hasRealData ? (
            <View style={s.section}>
              <View style={s.sectionHeader}>
                <Text style={s.sectionTitle}>ACTUAL eBay FEES — {PERIOD_LABELS[period].toUpperCase()}</Text>
                <View style={s.actualBadge}>
                  <MaterialIcons name="check-circle" size={10} color={Colors.success} />
                  <Text style={s.actualBadgeText}>Actual</Text>
                </View>
              </View>
              <View style={s.sectionCard}>
                <StatRow icon="sell" label="Gross Sales" value={fmtGBP(summary?.grossSalesMonth)} color={Colors.gold} highlight />
                <StatRow icon="receipt" label="eBay Final Value Fees" sub="Actual — from eBay Finances API" value={`-${fmtGBP(summary?.actualFees)}`} color={Colors.danger} badge="ACTUAL" />
                <StatRow icon="assignment-return" label="Refunds" value={fmtGBP(summary?.actualRefunds)} color={summary?.actualRefunds ? Colors.warning : Colors.textTertiary} />
                <StatRow icon="local-shipping" label="Shipping Labels" value={`-${fmtGBP(summary?.actualShippingLabels)}`} color={Colors.textTertiary} />
                <StatRow icon="account-balance-wallet" label="Net After Fees" value={fmtGBP(summary?.actualNetAfterFees)} color={Colors.success} highlight />
                <StatRow icon="payments" label="Total Payouts to Bank" value={fmtGBP(summary?.actualPayouts)} color={Colors.primary} />
              </View>
            </View>
          ) : null}

          {/* Standard breakdown (from sales table) */}
          <View style={s.section}>
            <Text style={s.sectionTitle}>
              {hasRealData ? 'SALES RECORD BREAKDOWN' : `${PERIOD_LABELS[period].toUpperCase()} BREAKDOWN (ESTIMATED FEES)`}
            </Text>
            <View style={s.sectionCard}>
              <StatRow icon="sell" label="Gross Sales" value={fmtGBP(summary?.grossSalesMonth)} color={Colors.gold} highlight />
              <StatRow
                icon="receipt"
                label={hasRealData ? 'eBay Fees (from records)' : 'eBay Fees (est. ~12.8%)'}
                sub={hasRealData ? 'May include orders with actual fees' : 'ESTIMATE — actual fees vary by category'}
                value={`-${fmtGBP(summary?.feesMonth)}`}
                color={Colors.danger}
                badge={hasRealData ? undefined : 'EST.'}
              />
              <StatRow icon="account-balance-wallet" label="Net Revenue" value={fmtGBP(summary?.netRevenueMonth)} color={Colors.success} highlight />
              <StatRow icon="trending-up" label="Orders" value={String(summary?.salesCountMonth ?? 0)} color={Colors.primary} />
              <StatRow icon="price-change" label="Avg Sale Price" value={fmtGBP(summary?.avgSalePrice)} color={Colors.textSecondary} />
              <StatRow icon="percent" label="Avg Margin" sub={hasRealData ? undefined : 'Based on estimated fees'} value={`${(summary?.avgMarginPct ?? 0).toFixed(1)}%`} color={Colors.info} />
            </View>
          </View>

          {/* Revenue comparison */}
          <View style={s.section}>
            <Text style={s.sectionTitle}>REVENUE COMPARISON</Text>
            <View style={s.sectionCard}>
              <StatRow icon="today" label="This Week" value={fmtGBP(summary?.grossSalesWeek)} sub={`Net ${fmtGBP(summary?.netRevenueWeek)}`} color={Colors.primary} />
              <StatRow icon="calendar-month" label="This Year" value={fmtGBP(summary?.grossSalesYear)} sub={`Net ${fmtGBP(summary?.netRevenueYear)}`} color={Colors.accent} />
            </View>
          </View>

          {/* Finances API info card */}
          {!hasRealData ? (
            <Pressable onPress={handleSyncFinances} style={s.apiCard}>
              <MaterialIcons name="account-balance" size={16} color={Colors.info} />
              <View style={{ flex: 1 }}>
                <Text style={s.apiCardTitle}>Connect eBay Finances API</Text>
                <Text style={s.apiCardText}>
                  Get exact fee data, payout records, and refund tracking. Requires eBay Managed Payments.
                  Tap to attempt sync — if unavailable, re-authorise eBay with the finances scope.
                </Text>
              </View>
              <MaterialIcons name="chevron-right" size={16} color={Colors.info} />
            </Pressable>
          ) : null}

          {/* Recent sales */}
          {sales.length > 0 ? (
            <View style={s.section}>
              <Text style={s.sectionTitle}>RECENT SALES</Text>
              <View style={s.sectionCard}>
                {sales.map(sale => <SaleRow key={sale.id} sale={sale} />)}
              </View>
            </View>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, paddingHorizontal: Spacing.base, paddingBottom: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder },
  backBtn: { width: 34, height: 34, borderRadius: Radius.md, backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.surfaceBorder },
  title: { fontSize: Typography.size.xl, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  subtitle: { fontSize: Typography.size.xs, color: Colors.textTertiary, marginTop: 1 },
  syncBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.accentDim, borderRadius: Radius.md, paddingHorizontal: Spacing.sm, paddingVertical: 6, borderWidth: 1, borderColor: Colors.accent + '40' },
  syncBtnText: { fontSize: Typography.size.xs, fontWeight: Typography.weight.semibold, color: Colors.accent },
  fullBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.goldDim, borderRadius: Radius.md, paddingHorizontal: Spacing.sm, paddingVertical: 6, borderWidth: 1, borderColor: Colors.gold + '40' },
  fullBtnText: { fontSize: Typography.size.xs, fontWeight: Typography.weight.semibold, color: Colors.gold },
  dataSourceBanner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, paddingHorizontal: Spacing.base, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder },
  dataSourceText: { flex: 1, fontSize: Typography.size.xs, fontWeight: Typography.weight.medium },
  periodRow: { flexDirection: 'row', gap: Spacing.xs, paddingHorizontal: Spacing.base, paddingVertical: Spacing.sm },
  periodBtn: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs + 2, borderRadius: Radius.pill, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.surfaceBorder },
  periodBtnActive: { backgroundColor: Colors.primaryDim, borderColor: Colors.primary + '50' },
  periodText: { fontSize: Typography.size.xs, color: Colors.textSecondary },
  periodTextActive: { color: Colors.primary, fontWeight: Typography.weight.semibold },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: Spacing.base, gap: Spacing.md },
  heroRow: { flexDirection: 'row', gap: Spacing.sm },
  heroCard: { flex: 1, backgroundColor: Colors.surface, borderRadius: Radius.xl, padding: Spacing.base, gap: 4, borderWidth: 1, borderColor: Colors.surfaceBorder, ...Shadow.sm },
  heroLabel: { fontSize: Typography.size.xs, color: Colors.textTertiary, fontWeight: Typography.weight.semibold, textTransform: 'uppercase' },
  heroValue: { fontSize: Typography.size.xxl, fontWeight: Typography.weight.extrabold, color: Colors.gold },
  heroSub: { fontSize: 10, color: Colors.textTertiary },
  section: { gap: 6 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionTitle: { flex: 1, fontSize: Typography.size.xs, fontWeight: Typography.weight.bold, color: Colors.textTertiary, letterSpacing: 0.6 },
  actualBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: Colors.successDim, borderRadius: Radius.pill, paddingHorizontal: 6, paddingVertical: 2 },
  actualBadgeText: { fontSize: 9, fontWeight: Typography.weight.bold, color: Colors.success },
  sectionCard: { backgroundColor: Colors.surface, borderRadius: Radius.xl, borderWidth: 1, borderColor: Colors.surfaceBorder, overflow: 'hidden', ...Shadow.sm },
  apiCard: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, backgroundColor: Colors.infoDim, borderRadius: Radius.xl, padding: Spacing.base, borderWidth: 1, borderColor: Colors.info + '30' },
  apiCardTitle: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.info, marginBottom: 3 },
  apiCardText: { fontSize: Typography.size.xs, color: Colors.textSecondary, lineHeight: 16 },
});
