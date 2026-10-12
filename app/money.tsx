// SWISH Money Screen — Capital & Wealth Builder
// Full capital lifecycle: cash → acquisitions → inventory → sales → profit → reinvestment.
// Goal progress tracker, capital allocation, ROI gauge, transaction history.

import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors, Typography, Spacing, Radius, Shadow } from '@/constants/theme';
import { useCapital, useBusinessConfig } from '@/hooks/useBusiness';

// ── Helpers ────────────────────────────────────────────────────────────────

const fmt = (v?: number) => v !== undefined ? `£${v.toLocaleString()}` : '—';
const fmtS = (v?: number) => {
  if (v === undefined) return '—';
  if (v >= 1000) return `£${(v / 1000).toFixed(1)}k`;
  return `£${v.toFixed(0)}`;
};
const fmtPct = (v?: number) => v !== undefined ? `${(v * 100).toFixed(1)}%` : '—';

function ROIGauge({ roi, target = 0.3 }: { roi: number; target?: number }) {
  const fill = Math.min(100, Math.max(0, roi * 100));
  const color = roi >= target ? Colors.success : roi >= 0 ? Colors.warning : Colors.danger;
  return (
    <View style={gaugeStyles.wrap}>
      <View style={gaugeStyles.track}>
        <View style={[gaugeStyles.fill, { width: `${fill}%` as any, backgroundColor: color }]} />
        <View style={[gaugeStyles.target, { left: `${target * 100}%` as any }]} />
      </View>
      <View style={gaugeStyles.labels}>
        <Text style={gaugeStyles.value}>
          <Text style={{ color, fontWeight: '700' }}>{roi >= 0 ? '+' : ''}{(roi * 100).toFixed(1)}%</Text>
          {' ROI'}
        </Text>
        <Text style={gaugeStyles.hint}>{(target * 100).toFixed(0)}% target</Text>
      </View>
    </View>
  );
}
const gaugeStyles = StyleSheet.create({
  wrap: { gap: Spacing.xs },
  track: {
    height: 8, backgroundColor: Colors.surfaceHighlight,
    borderRadius: Radius.pill, overflow: 'visible', position: 'relative',
  },
  fill: { position: 'absolute', top: 0, left: 0, height: '100%', borderRadius: Radius.pill },
  target: {
    position: 'absolute', top: -4, bottom: -4, width: 2,
    backgroundColor: Colors.textTertiary, borderRadius: 1,
  },
  labels: { flexDirection: 'row', justifyContent: 'space-between' },
  value: { fontSize: Typography.size.xs, color: Colors.textTertiary },
  hint: { fontSize: Typography.size.xs, color: Colors.textTertiary },
});

function CapitalBar({ items }: {
  items: Array<{ label: string; value: number; total: number; color: string }>;
}) {
  const total = items.reduce((s, i) => s + i.value, 0);
  return (
    <View style={capitalBarStyles.wrap}>
      <View style={capitalBarStyles.bar}>
        {items.map(item => {
          const pct = total > 0 ? (item.value / total) * 100 : 0;
          return (
            <View key={item.label} style={[capitalBarStyles.segment, { flex: Math.max(pct, 1), backgroundColor: item.color }]} />
          );
        })}
      </View>
      <View style={capitalBarStyles.legend}>
        {items.map(item => (
          <View key={item.label} style={capitalBarStyles.legendItem}>
            <View style={[capitalBarStyles.legendDot, { backgroundColor: item.color }]} />
            <Text style={capitalBarStyles.legendLabel}>{item.label}</Text>
            <Text style={[capitalBarStyles.legendValue, { color: item.color }]}>{fmtS(item.value)}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}
const capitalBarStyles = StyleSheet.create({
  wrap: { gap: Spacing.md },
  bar: {
    height: 12, borderRadius: Radius.pill, flexDirection: 'row',
    overflow: 'hidden', backgroundColor: Colors.surfaceHighlight,
  },
  segment: { height: '100%' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendLabel: { fontSize: Typography.size.xs, color: Colors.textTertiary },
  legendValue: { fontSize: Typography.size.xs, fontWeight: Typography.weight.bold },
});

// ── Goal Progress Card ────────────────────────────────────────────────────

function GoalCard({ onSetup }: { onSetup: () => void }) {
  const { state, config, goalProgress } = useCapital();

  if (!config || !config.onboardingComplete) {
    return (
      <Pressable onPress={onSetup} style={goalStyles.setupCard}>
        <MaterialIcons name="flag" size={28} color={Colors.primary} />
        <View style={goalStyles.flex}>
          <Text style={goalStyles.setupTitle}>Set Your Financial Goal</Text>
          <Text style={goalStyles.setupDesc}>Tell SWISH how much you want to make and by when.</Text>
        </View>
        <MaterialIcons name="chevron-right" size={20} color={Colors.primary} />
      </Pressable>
    );
  }

  const progress = goalProgress;
  if (!progress) return null;

  const totalCapital = (state?.availableCash ?? 0) + (state?.capitalInStock ?? 0);
  const targetCapital = config.targetCapital ?? config.startingCapital * 2.5;
  const progressPct = Math.min(100, Math.max(0, ((totalCapital - config.startingCapital) / (targetCapital - config.startingCapital)) * 100));
  const progressColor = progress.onTrack ? Colors.success : Colors.warning;

  return (
    <View style={goalStyles.card}>
      <View style={goalStyles.cardHeader}>
        <View style={goalStyles.goalIcon}>
          <MaterialIcons name="flag" size={16} color={Colors.gold} />
        </View>
        <Text style={goalStyles.cardTitle}>Goal Progress</Text>
        <View style={[goalStyles.trackBadge, { backgroundColor: progress.onTrack ? Colors.successDim : Colors.warningDim }]}>
          <Text style={[goalStyles.trackText, { color: progress.onTrack ? Colors.success : Colors.warning }]}>
            {progress.onTrack ? 'On Track' : 'Behind'}
          </Text>
        </View>
      </View>

      <View style={goalStyles.mainRow}>
        <View style={goalStyles.mainLeft}>
          <Text style={goalStyles.currentLabel}>Current Capital</Text>
          <Text style={goalStyles.currentValue}>{fmt(totalCapital)}</Text>
          <Text style={goalStyles.currentSub}>Target: {fmt(targetCapital)}</Text>
        </View>
        <View style={goalStyles.mainRight}>
          <Text style={[goalStyles.pctValue, { color: progressColor }]}>{Math.round(progressPct)}%</Text>
          <Text style={goalStyles.pctLabel}>to goal</Text>
        </View>
      </View>

      <View style={goalStyles.progressTrack}>
        <View style={[goalStyles.progressFill, {
          width: `${progressPct}%` as any,
          backgroundColor: progressColor,
        }]} />
      </View>

      <View style={goalStyles.statsRow}>
        <View style={goalStyles.statItem}>
          <Text style={goalStyles.statValue}>{progress.daysRemaining}d</Text>
          <Text style={goalStyles.statLabel}>Remaining</Text>
        </View>
        <View style={goalStyles.statItem}>
          <Text style={[goalStyles.statValue, { color: progress.capitalGrowth >= 0 ? Colors.success : Colors.danger }]}>
            {progress.capitalGrowth >= 0 ? '+' : ''}{fmtS(progress.capitalGrowth)}
          </Text>
          <Text style={goalStyles.statLabel}>Growth So Far</Text>
        </View>
        <View style={goalStyles.statItem}>
          <Text style={goalStyles.statValue}>{fmtS(progress.projectedFinalCapital)}</Text>
          <Text style={goalStyles.statLabel}>Projected Final</Text>
        </View>
      </View>
    </View>
  );
}

const goalStyles = StyleSheet.create({
  flex: { flex: 1 },
  setupCard: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.primaryDim, borderRadius: Radius.xl,
    padding: Spacing.base, borderWidth: 1, borderColor: Colors.primary + '30',
  },
  setupTitle: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.textPrimary },
  setupDesc: { fontSize: Typography.size.xs, color: Colors.textTertiary, marginTop: 2 },
  card: {
    backgroundColor: Colors.surface, borderRadius: Radius.xl,
    padding: Spacing.base, gap: Spacing.md,
    borderWidth: 1, borderColor: Colors.surfaceBorder, ...Shadow.sm,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  goalIcon: {
    width: 28, height: 28, borderRadius: Radius.sm,
    backgroundColor: Colors.goldDim, alignItems: 'center', justifyContent: 'center',
  },
  cardTitle: { flex: 1, fontSize: Typography.size.xs, fontWeight: Typography.weight.semibold, color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5 },
  trackBadge: { paddingHorizontal: Spacing.sm, paddingVertical: 3, borderRadius: Radius.pill },
  trackText: { fontSize: Typography.size.xs, fontWeight: Typography.weight.bold },
  mainRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  mainLeft: { gap: 3 },
  currentLabel: { fontSize: Typography.size.xs - 1, color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.3 },
  currentValue: { fontSize: Typography.size.xxl, fontWeight: Typography.weight.extrabold, color: Colors.textPrimary },
  currentSub: { fontSize: Typography.size.xs, color: Colors.textTertiary },
  mainRight: { alignItems: 'flex-end', gap: 2 },
  pctValue: { fontSize: Typography.size.xxxl, fontWeight: Typography.weight.extrabold },
  pctLabel: { fontSize: Typography.size.xs, color: Colors.textTertiary },
  progressTrack: { height: 8, backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.pill, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: Radius.pill },
  statsRow: { flexDirection: 'row', justifyContent: 'space-around' },
  statItem: { alignItems: 'center', gap: 2 },
  statValue: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  statLabel: { fontSize: Typography.size.xs - 1, color: Colors.textTertiary },
});

// ── Main Screen ─────────────────────────────────────────────────────────────

export default function MoneyScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { state, transactions, config, loading, reload } = useCapital();
  const [activeTab, setActiveTab] = useState<'overview' | 'flow' | 'history'>('overview');

  const totalCapital = (state?.availableCash ?? 0) + (state?.capitalInStock ?? 0);
  const txTypeColor = (type: string) => {
    if (type === 'sale_revenue' || type === 'deposit') return Colors.success;
    if (type === 'acquisition_spend' || type === 'withdrawal') return Colors.danger;
    return Colors.textSecondary;
  };
  const txTypeIcon = (type: string) => {
    if (type === 'sale_revenue') return 'payments';
    if (type === 'acquisition_spend') return 'shopping-bag';
    if (type === 'deposit') return 'add-circle';
    if (type === 'withdrawal') return 'remove-circle';
    return 'swap-horiz';
  };

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      <View style={[styles.header, { paddingTop: insets.top + Spacing.base }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
          <MaterialIcons name="arrow-back" size={20} color={Colors.textSecondary} />
        </Pressable>
        <Pressable onPress={() => router.replace('/(tabs)' as any)} style={styles.homeBtn} hitSlop={8}>
          <MaterialIcons name="dashboard" size={16} color={Colors.textTertiary} />
        </Pressable>
        <View>
          <Text style={styles.title}>Capital & Wealth</Text>
          <Text style={styles.subtitle}>Your complete financial picture</Text>
        </View>
      </View>

      {/* Tab bar */}
      <View style={styles.tabBar}>
        {(['overview', 'flow', 'history'] as const).map(t => (
          <Pressable key={t} onPress={() => setActiveTab(t)} style={[styles.tab, activeTab === t && styles.tabActive]}>
            <Text style={[styles.tabText, activeTab === t && styles.tabTextActive]}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </Text>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <View style={styles.loading}><ActivityIndicator color={Colors.primary} size="large" /></View>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 90 }]}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} tintColor={Colors.primary} />}
        >
          {activeTab === 'overview' ? (
            <>
              {/* Goal Progress */}
              <GoalCard onSetup={() => router.push('/onboarding' as any)} />

              {/* Capital Allocation */}
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Capital Allocation</Text>
              </View>
              <View style={styles.card}>
                <CapitalBar items={[
                  { label: 'Available Cash', value: state?.availableCash ?? 0, total: totalCapital, color: Colors.success },
                  { label: 'In Stock', value: state?.capitalInStock ?? 0, total: totalCapital, color: Colors.primary },
                ]} />
              </View>

              {/* Key metrics grid */}
              <View style={styles.metricsGrid}>
                {[
                  { label: 'Total Invested', value: fmt(state?.totalInvested), color: Colors.warning, icon: 'payments' },
                  { label: 'Revenue', value: fmt(state?.totalRevenue), color: Colors.success, icon: 'trending-up' },
                  { label: 'Net Profit', value: fmt(state?.totalProfit), color: Colors.success, icon: 'account-balance' },
                  { label: 'Fees Paid', value: fmt(state?.totalFees), color: Colors.danger, icon: 'receipt' },
                  { label: 'Inventory Value', value: fmt(state?.totalInventoryValue), color: Colors.gold, icon: 'inventory-2' },
                  { label: 'Capital Velocity', value: state?.capitalVelocity !== undefined ? fmtPct(state.capitalVelocity) + '/mo' : '—', color: Colors.accent, icon: 'speed' },
                ].map(m => (
                  <View key={m.label} style={styles.metricTile}>
                    <MaterialIcons name={m.icon as any} size={16} color={m.color} />
                    <Text style={[styles.metricValue, { color: m.color }]}>{m.value}</Text>
                    <Text style={styles.metricLabel}>{m.label}</Text>
                  </View>
                ))}
              </View>

              {/* ROI Gauge */}
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Return on Investment</Text>
              </View>
              <View style={styles.card}>
                <ROIGauge roi={state?.roi ?? 0} target={config?.minROIThreshold ?? 0.3} />
              </View>
            </>
          ) : null}

          {activeTab === 'flow' ? (
            <>
              {/* Capital Flow Diagram */}
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Capital Flow</Text>
              </View>

              <View style={styles.flowCard}>
                {[
                  {
                    label: 'Starting Capital',
                    value: config?.startingCapital ?? 0,
                    icon: 'account-balance-wallet',
                    color: Colors.primary,
                    arrow: true,
                  },
                  {
                    label: 'Total Invested in Stock',
                    value: -(state?.totalInvested ?? 0),
                    icon: 'shopping-bag',
                    color: Colors.warning,
                    arrow: true,
                  },
                  {
                    label: 'Total Revenue Received',
                    value: state?.totalRevenue ?? 0,
                    icon: 'payments',
                    color: Colors.success,
                    arrow: true,
                  },
                  {
                    label: 'Fees & Shipping Paid',
                    value: -(state?.totalFees ?? 0),
                    icon: 'receipt',
                    color: Colors.danger,
                    arrow: true,
                  },
                  {
                    label: 'Net Profit',
                    value: state?.totalProfit ?? 0,
                    icon: 'trending-up',
                    color: (state?.totalProfit ?? 0) >= 0 ? Colors.success : Colors.danger,
                    arrow: false,
                  },
                ].map((row, idx) => (
                  <View key={row.label}>
                    <View style={styles.flowRow}>
                      <View style={[styles.flowIconWrap, { backgroundColor: row.color + '20' }]}>
                        <MaterialIcons name={row.icon as any} size={18} color={row.color} />
                      </View>
                      <Text style={styles.flowLabel}>{row.label}</Text>
                      <Text style={[styles.flowValue, { color: row.color }]}>
                        {row.value >= 0 ? '+' : ''}{fmt(Math.abs(row.value))}
                      </Text>
                    </View>
                    {row.arrow ? <View style={styles.flowArrow}><Text style={styles.flowArrowText}>↓</Text></View> : null}
                  </View>
                ))}

                <View style={styles.flowSummary}>
                  <Text style={styles.flowSummaryLabel}>Available Capital</Text>
                  <Text style={[styles.flowSummaryValue, {
                    color: (state?.availableCash ?? 0) >= 0 ? Colors.success : Colors.danger,
                  }]}>
                    {fmt(state?.availableCash)}
                  </Text>
                </View>
              </View>

              {/* Reinvestment Recommendation */}
              {(state?.availableCash ?? 0) > 0 ? (
                <View style={styles.reinvestCard}>
                  <View style={styles.reinvestHeader}>
                    <MaterialIcons name="auto-awesome" size={14} color={Colors.accent} />
                    <Text style={styles.reinvestTitle}>Reinvestment Recommendation</Text>
                  </View>
                  <Text style={styles.reinvestText}>
                    You have <Text style={{ color: Colors.success, fontWeight: '700' }}>{fmt(state?.availableCash)}</Text> available.
                    Based on your business performance, deploying this in acquisitions similar to your best-performing category could generate an estimated{' '}
                    <Text style={{ color: Colors.gold, fontWeight: '700' }}>
                      {fmt((state?.availableCash ?? 0) * (config?.minROIThreshold ?? 0.3))} additional profit
                    </Text>{' '}
                    at your target ROI threshold.
                  </Text>
                  <Pressable
                    onPress={() => router.push('/opportunities' as any)}
                    style={({ pressed }) => [styles.reinvestBtn, pressed && { opacity: 0.85 }]}
                  >
                    <MaterialIcons name="search" size={14} color={Colors.background} />
                    <Text style={styles.reinvestBtnText}>Find Opportunities</Text>
                  </Pressable>
                </View>
              ) : null}
            </>
          ) : null}

          {activeTab === 'history' ? (
            <>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Transaction History</Text>
              </View>

              {transactions.length === 0 ? (
                <View style={styles.emptyHistory}>
                  <MaterialIcons name="history" size={40} color={Colors.textTertiary} />
                  <Text style={styles.emptyHistoryTitle}>No Transactions Yet</Text>
                  <Text style={styles.emptyHistoryText}>Transactions will appear here as you buy and sell.</Text>
                </View>
              ) : (
                <View style={styles.txList}>
                  {transactions.map(tx => (
                    <View key={tx.id} style={styles.txRow}>
                      <View style={[styles.txIcon, { backgroundColor: txTypeColor(tx.type) + '20' }]}>
                        <MaterialIcons name={txTypeIcon(tx.type) as any} size={16} color={txTypeColor(tx.type)} />
                      </View>
                      <View style={styles.txInfo}>
                        <Text style={styles.txDesc} numberOfLines={1}>{tx.description}</Text>
                        <Text style={styles.txDate}>
                          {new Date(tx.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </Text>
                      </View>
                      <Text style={[styles.txAmount, { color: txTypeColor(tx.type) }]}>
                        {tx.amount >= 0 ? '+' : ''}{fmt(tx.amount)}
                      </Text>
                    </View>
                  ))}
                </View>
              )}
            </>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.base, paddingBottom: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder },
  backBtn: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.surfaceBorder },
  homeBtn: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.surfaceBorder },
  title: { fontSize: Typography.size.xl, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  subtitle: { fontSize: Typography.size.xs, color: Colors.textTertiary, marginTop: 2 },

  tabBar: {
    flexDirection: 'row', paddingHorizontal: Spacing.base, paddingVertical: Spacing.sm,
    gap: Spacing.xs, borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder,
  },
  tab: { flex: 1, alignItems: 'center', paddingVertical: Spacing.sm, borderRadius: Radius.md },
  tabActive: { backgroundColor: Colors.primaryDim },
  tabText: { fontSize: Typography.size.xs, color: Colors.textTertiary, fontWeight: Typography.weight.medium },
  tabTextActive: { color: Colors.primary },

  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: Spacing.base, gap: Spacing.xl },

  sectionHeader: { flexDirection: 'row', alignItems: 'center' },
  sectionTitle: { fontSize: Typography.size.xs, fontWeight: Typography.weight.semibold, color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.6 },

  card: {
    backgroundColor: Colors.surface, borderRadius: Radius.xl,
    padding: Spacing.base, borderWidth: 1, borderColor: Colors.surfaceBorder, ...Shadow.sm,
  },

  metricsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  metricTile: {
    flex: 1, minWidth: '30%', backgroundColor: Colors.surface, borderRadius: Radius.lg,
    padding: Spacing.md, alignItems: 'center', gap: 4,
    borderWidth: 1, borderColor: Colors.surfaceBorder,
  },
  metricValue: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, textAlign: 'center' },
  metricLabel: { fontSize: Typography.size.xs - 1, color: Colors.textTertiary, textAlign: 'center' },

  // Flow
  flowCard: {
    backgroundColor: Colors.surface, borderRadius: Radius.xl,
    padding: Spacing.base, gap: 0,
    borderWidth: 1, borderColor: Colors.surfaceBorder, ...Shadow.sm,
  },
  flowRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingVertical: Spacing.md,
  },
  flowIconWrap: { width: 36, height: 36, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  flowLabel: { flex: 1, fontSize: Typography.size.sm, color: Colors.textSecondary },
  flowValue: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold },
  flowArrow: { alignItems: 'center', paddingVertical: 2 },
  flowArrowText: { fontSize: Typography.size.sm, color: Colors.textTertiary },
  flowSummary: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    borderTopWidth: 2, borderTopColor: Colors.surfaceBorder, paddingTop: Spacing.md, marginTop: Spacing.sm,
  },
  flowSummaryLabel: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.textPrimary },
  flowSummaryValue: { fontSize: Typography.size.xl, fontWeight: Typography.weight.extrabold },

  reinvestCard: {
    backgroundColor: Colors.accentDim, borderRadius: Radius.xl,
    padding: Spacing.base, gap: Spacing.md,
    borderWidth: 1, borderColor: Colors.accent + '30',
  },
  reinvestHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  reinvestTitle: { fontSize: Typography.size.xs, fontWeight: Typography.weight.semibold, color: Colors.accent, textTransform: 'uppercase', letterSpacing: 0.4 },
  reinvestText: { fontSize: Typography.size.sm, color: Colors.textSecondary, lineHeight: 20 },
  reinvestBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: Spacing.xs, backgroundColor: Colors.accent, borderRadius: Radius.md,
    paddingVertical: Spacing.md,
  },
  reinvestBtnText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.background },

  // History
  emptyHistory: { alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.hero },
  emptyHistoryTitle: { fontSize: Typography.size.base, fontWeight: Typography.weight.semibold, color: Colors.textSecondary },
  emptyHistoryText: { fontSize: Typography.size.sm, color: Colors.textTertiary, textAlign: 'center' },
  txList: {
    backgroundColor: Colors.surface, borderRadius: Radius.xl,
    borderWidth: 1, borderColor: Colors.surfaceBorder, overflow: 'hidden',
  },
  txRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingHorizontal: Spacing.base, paddingVertical: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder,
  },
  txIcon: { width: 36, height: 36, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  txInfo: { flex: 1, gap: 2 },
  txDesc: { fontSize: Typography.size.sm, color: Colors.textPrimary },
  txDate: { fontSize: Typography.size.xs, color: Colors.textTertiary },
  txAmount: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold },
});
