// SWISH Insights & Exception Centre
// AI insights, exception management, analytics, capital, specialist performance, predictions.

import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import { useInsightsAnalytics, useDashboard } from '@/hooks/useInsights';
import { useExceptions } from '@/hooks/useBusiness';
import { InsightCard } from '@/components/feature/InsightCard';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { Colors, Typography, Spacing, Radius, Shadow } from '@/constants/theme';
import { SPECIALISTS } from '@/constants/specialists';
import { SEVERITY_CONFIG, SwishException } from '@/services/exceptionService';

type Tab = 'overview' | 'exceptions' | 'capital' | 'specialists' | 'predictions';

const TABS: Array<{ id: Tab; label: string; icon: string }> = [
  { id: 'overview', label: 'Overview', icon: 'dashboard' },
  { id: 'exceptions', label: 'Exceptions', icon: 'warning' },
  { id: 'capital', label: 'Capital', icon: 'account-balance' },
  { id: 'specialists', label: 'Specialists', icon: 'category' },
  { id: 'predictions', label: 'Predictions', icon: 'timeline' },
];

function ExceptionItem({ exception, onResolve }: { exception: SwishException; onResolve: (id: string) => void }) {
  const router = useRouter();
  const cfg = SEVERITY_CONFIG[exception.severity];
  const isReprice = exception.exceptionType === 'stale_listings_reprice';
  return (
    <View style={[exStyles.card, { borderLeftColor: cfg.color }]}>
      <View style={exStyles.header}>
        <View style={[exStyles.icon, { backgroundColor: cfg.color + '20' }]}>
          <MaterialIcons name={cfg.icon as any} size={16} color={cfg.color} />
        </View>
        <View style={exStyles.flex}>
          <Text style={exStyles.title}>{exception.title}</Text>
          <Text style={exStyles.detail}>{exception.detail}</Text>
        </View>
        <View style={[exStyles.severityBadge, { backgroundColor: cfg.color + '20' }]}>
          <Text style={[exStyles.severityText, { color: cfg.color }]}>{cfg.label}</Text>
        </View>
      </View>
      <View style={exStyles.footer}>
        <Text style={exStyles.dateText}>
          {new Date(exception.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
        </Text>
        <View style={exStyles.footerActions}>
          {isReprice ? (
            <Pressable
              onPress={() => router.push('/repricing' as any)}
              style={({ pressed }) => [exStyles.actionBtn, exStyles.repriceBtnStyle, pressed && { opacity: 0.8 }]}
            >
              <MaterialIcons name="price-change" size={12} color={Colors.warning} />
              <Text style={[exStyles.actionBtnText, { color: Colors.warning }]}>Reprice</Text>
            </Pressable>
          ) : null}
          <Pressable
            onPress={() => onResolve(exception.id)}
            style={({ pressed }) => [exStyles.resolveBtn, pressed && { opacity: 0.8 }]}
          >
            <MaterialIcons name="check" size={12} color={Colors.success} />
            <Text style={exStyles.resolveBtnText}>Resolve</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const exStyles = StyleSheet.create({
  flex: { flex: 1 },
  card: {
    backgroundColor: Colors.surface, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.surfaceBorder,
    borderLeftWidth: 3, padding: Spacing.md, gap: Spacing.sm,
  },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  icon: { width: 32, height: 32, borderRadius: Radius.sm, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  title: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.textPrimary },
  detail: { fontSize: Typography.size.xs, color: Colors.textSecondary, marginTop: 2, lineHeight: 16 },
  severityBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: Radius.pill, flexShrink: 0 },
  severityText: { fontSize: 9, fontWeight: Typography.weight.bold, textTransform: 'uppercase', letterSpacing: 0.3 },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  footerActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  dateText: { fontSize: Typography.size.xs, color: Colors.textTertiary },
  actionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: Spacing.sm, paddingVertical: 3, borderRadius: Radius.pill,
  },
  repriceBtnStyle: { backgroundColor: Colors.warningDim },
  actionBtnText: { fontSize: Typography.size.xs, fontWeight: Typography.weight.semibold },
  resolveBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.successDim, borderRadius: Radius.pill,
    paddingHorizontal: Spacing.sm, paddingVertical: 3,
  },
  resolveBtnText: { fontSize: Typography.size.xs, color: Colors.success, fontWeight: Typography.weight.semibold },
});

export default function InsightsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const { metrics, insights, loading: dashLoading } = useDashboard();
  const { specialistPerf, capital, predictions, loading: analyticsLoading } = useInsightsAnalytics();
  const { exceptions, loading: exceptLoading, resolve, criticalCount, highCount } = useExceptions();

  const loading = dashLoading || analyticsLoading;

  const fmtCurrency = (v?: number) => v !== undefined ? `£${v.toLocaleString()}` : '—';
  const fmtPct = (v?: number) => v !== undefined ? `${(v * 100).toFixed(1)}%` : '—';

  const totalExceptions = exceptions.length;

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <View style={[styles.header, { paddingTop: insets.top + Spacing.base }]}>
        <View>
          <Text style={styles.title}>Insights</Text>
          <Text style={styles.subtitle}>Intelligence, exceptions & analytics</Text>
        </View>
        {(criticalCount + highCount) > 0 ? (
          <Pressable
            onPress={() => setActiveTab('exceptions')}
            style={styles.exceptAlert}
          >
            <View style={styles.exceptAlertDot} />
            <Text style={styles.exceptAlertText}>{criticalCount + highCount} urgent</Text>
          </Pressable>
        ) : null}
      </View>

      {/* Tab bar */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabBarScroll} contentContainerStyle={styles.tabBar}>
        {TABS.map(t => (
          <Pressable
            key={t.id}
            onPress={() => setActiveTab(t.id)}
            style={[styles.tab, activeTab === t.id && styles.tabActive]}
          >
            <MaterialIcons name={t.icon as any} size={14} color={activeTab === t.id ? Colors.primary : Colors.textTertiary} />
            <Text style={[styles.tabLabel, activeTab === t.id && styles.tabLabelActive]}>{t.label}</Text>
            {t.id === 'exceptions' && totalExceptions > 0 ? (
              <View style={styles.tabBadge}><Text style={styles.tabBadgeText}>{totalExceptions}</Text></View>
            ) : null}
          </Pressable>
        ))}
      </ScrollView>

      {loading ? (
        <View style={styles.loading}><ActivityIndicator color={Colors.primary} size="large" /></View>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 90 }]}
          showsVerticalScrollIndicator={false}
        >
          {/* ── Overview ── */}
          {activeTab === 'overview' ? (
            <View style={styles.section}>
              <View style={styles.headlineCard}>
                <View style={styles.headlineRow}>
                  {[
                    { label: 'Revenue', value: fmtCurrency(metrics?.totalRevenue), color: Colors.textPrimary },
                    { label: 'Profit', value: fmtCurrency(metrics?.totalProfit), color: Colors.success },
                    { label: 'Avg ROI', value: fmtPct(metrics?.averageROI), color: Colors.gold },
                  ].map((s, i) => (
                    <React.Fragment key={s.label}>
                      {i > 0 ? <View style={styles.headlineDivider} /> : null}
                      <View style={styles.headlineStat}>
                        <Text style={[styles.headlineValue, { color: s.color }]}>{s.value}</Text>
                        <Text style={styles.headlineLabel}>{s.label}</Text>
                      </View>
                    </React.Fragment>
                  ))}
                </View>
              </View>

              <SectionHeader title="AI Insights & Alerts" badge={insights.length} />
              {insights.slice(0, 5).map(i => <InsightCard key={i.id} insight={i} compact />)}

              <SectionHeader title="Operating Metrics" />
              <View style={styles.metricsTable}>
                {[
                  { label: 'Total Items', value: String(metrics?.totalItems ?? 0) },
                  { label: 'Listed', value: String(metrics?.listedItems ?? 0) },
                  { label: 'Sold', value: String(metrics?.soldItems ?? 0) },
                  { label: 'Sell-Through Rate', value: fmtPct(metrics?.sellThroughRate) },
                  { label: 'Avg Time to Sale', value: `${metrics?.averageTimeToSale?.toFixed(1) ?? '—'} days` },
                  { label: 'Profit / Labour Hour', value: fmtCurrency(metrics?.profitPerLabourHour) },
                  { label: 'Stale Items', value: String(metrics?.staleItemCount ?? 0), alert: (metrics?.staleItemCount ?? 0) > 0 },
                  { label: 'Exceptions', value: String(metrics?.exceptionCount ?? 0), alert: (metrics?.exceptionCount ?? 0) > 0 },
                ].map(row => (
                  <View key={row.label} style={styles.metricRow}>
                    <Text style={styles.metricRowLabel}>{row.label}</Text>
                    <Text style={[styles.metricRowValue, row.alert ? { color: Colors.warning } : undefined]}>{row.value}</Text>
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          {/* ── Exceptions ── */}
          {activeTab === 'exceptions' ? (
            <View style={styles.section}>
              <View style={styles.exceptionsSummary}>
                {[
                  { label: 'Critical', count: exceptions.filter(e => e.severity === 'critical').length, color: Colors.danger },
                  { label: 'High', count: exceptions.filter(e => e.severity === 'high').length, color: '#F97316' },
                  { label: 'Medium', count: exceptions.filter(e => e.severity === 'medium').length, color: Colors.warning },
                  { label: 'Low', count: exceptions.filter(e => e.severity === 'low').length, color: Colors.info },
                ].map(s => (
                  <View key={s.label} style={[styles.exceptionSummaryItem, { borderColor: s.color + '40' }]}>
                    <Text style={[styles.exceptionSummaryCount, { color: s.color }]}>{s.count}</Text>
                    <Text style={styles.exceptionSummaryLabel}>{s.label}</Text>
                  </View>
                ))}
              </View>

              {exceptions.length === 0 ? (
                <View style={styles.exceptionEmpty}>
                  <MaterialIcons name="check-circle" size={40} color={Colors.success} />
                  <Text style={styles.exceptionEmptyTitle}>All Clear</Text>
                  <Text style={styles.exceptionEmptyText}>No active exceptions. SWISH is operating normally.</Text>
                </View>
              ) : (
                <View style={styles.exceptionList}>
                  {exceptions
                    .sort((a, b) => {
                      const order = { critical: 0, high: 1, medium: 2, low: 3 };
                      return (order[a.severity] ?? 4) - (order[b.severity] ?? 4);
                    })
                    .map(e => (
                      <ExceptionItem key={e.id} exception={e} onResolve={resolve} />
                    ))
                  }
                </View>
              )}
            </View>
          ) : null}

          {/* ── Capital ── */}
          {activeTab === 'capital' ? (
            <View style={styles.section}>
              <SectionHeader title="Capital Overview" subtitle="Current deployment" />
              {capital ? (
                <>
                  <View style={styles.capitalHero}>
                    <Text style={styles.capitalHeroLabel}>Total Asset Value</Text>
                    <Text style={styles.capitalHeroValue}>{fmtCurrency(capital.tiedInAcquisitions)}</Text>
                    <Text style={styles.capitalHeroSub}>across all acquisitions</Text>
                  </View>
                  <View style={styles.capitalBreakdown}>
                    {[
                      { label: 'Cash Available', value: capital.available, color: Colors.success },
                      { label: 'In Stock (Value)', value: capital.tiedInStock, color: Colors.primary },
                    ].map(item => (
                      <View key={item.label} style={styles.capitalBarItem}>
                        <View style={styles.capitalBarLabel}>
                          <View style={[styles.capitalBarDot, { backgroundColor: item.color }]} />
                          <Text style={styles.capitalBarName}>{item.label}</Text>
                          <Text style={[styles.capitalBarValue, { color: item.color }]}>{fmtCurrency(item.value)}</Text>
                        </View>
                        <View style={styles.barTrack}>
                          <View style={[styles.barFill, {
                            width: `${Math.min(100, (item.value / Math.max(capital.available + capital.tiedInStock, 1)) * 100)}%` as any,
                            backgroundColor: item.color,
                          }]} />
                        </View>
                      </View>
                    ))}
                  </View>
                  <View style={styles.capitalMetrics}>
                    {[
                      { label: 'Unrealised Value', value: fmtCurrency(capital.unrealisedValue), color: Colors.gold },
                      { label: 'Expected Return', value: fmtCurrency(capital.expectedReturn), color: Colors.success },
                      { label: 'Return on Capital', value: fmtPct(capital.returnOnCapital), color: Colors.primary },
                    ].map(m => (
                      <View key={m.label} style={styles.capitalMetricCard}>
                        <Text style={[styles.capitalMetricValue, { color: m.color }]}>{m.value}</Text>
                        <Text style={styles.capitalMetricLabel}>{m.label}</Text>
                      </View>
                    ))}
                  </View>
                  <Pressable
                    onPress={() => router.push('/money' as any)}
                    style={({ pressed }) => [styles.viewMoneyBtn, pressed && { opacity: 0.85 }]}
                  >
                    <MaterialIcons name="account-balance" size={16} color={Colors.primary} />
                    <Text style={styles.viewMoneyBtnText}>Full Capital Dashboard</Text>
                    <MaterialIcons name="chevron-right" size={16} color={Colors.primary} />
                  </Pressable>
                </>
              ) : null}
            </View>
          ) : null}

          {/* ── Specialists ── */}
          {activeTab === 'specialists' ? (
            <View style={styles.section}>
              <SectionHeader title="Specialist Performance" subtitle="By vertical" />
              {specialistPerf.map(sp => {
                const config = SPECIALISTS[sp.specialistId as keyof typeof SPECIALISTS];
                return (
                  <View key={sp.specialistId} style={styles.specialistCard}>
                    <View style={styles.specialistCardHeader}>
                      <View style={[styles.specialistCardDot, { backgroundColor: config?.color ?? Colors.primary }]} />
                      <Text style={styles.specialistCardName}>{sp.name}</Text>
                      <Text style={styles.specialistCardItems}>{sp.itemCount} items</Text>
                    </View>
                    <View style={styles.specialistCardStats}>
                      {[
                        { label: 'Revenue', value: fmtCurrency(sp.totalRevenue) },
                        { label: 'Sold', value: String(sp.soldCount) },
                        { label: 'Margin', value: sp.averageMargin > 0 ? fmtPct(sp.averageMargin) : '—', color: sp.averageMargin > 0.35 ? Colors.success : Colors.warning },
                        { label: 'AI Accuracy', value: sp.predictionAccuracy > 0 ? fmtPct(sp.predictionAccuracy) : 'n/a', color: sp.predictionAccuracy > 0.7 ? Colors.success : Colors.textTertiary },
                      ].map(s => (
                        <View key={s.label} style={styles.specialistStat}>
                          <Text style={[styles.specialistStatValue, s.color ? { color: s.color } : undefined]}>{s.value}</Text>
                          <Text style={styles.specialistStatLabel}>{s.label}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                );
              })}
            </View>
          ) : null}

          {/* ── Predictions ── */}
          {activeTab === 'predictions' ? (
            <View style={styles.section}>
              <SectionHeader title="Prediction Performance" subtitle="AI model accuracy over time" />
              <View style={styles.predAccuracyHero}>
                <Text style={styles.predAccuracyLabel}>Current Overall Accuracy</Text>
                <Text style={styles.predAccuracyValue}>{predictions[0] ? fmtPct(predictions[0].overallAccuracy) : '—'}</Text>
                <Text style={styles.predAccuracySub}>{predictions[0]?.sampleSize ?? 0} transactions analysed</Text>
              </View>
              {predictions.map(p => (
                <View key={p.period} style={styles.predRecord}>
                  <View style={styles.predRecordHeader}>
                    <Text style={styles.predRecordPeriod}>{p.period}</Text>
                    <Text style={[styles.predRecordOverall, { color: p.overallAccuracy >= 0.7 ? Colors.success : Colors.warning }]}>
                      {fmtPct(p.overallAccuracy)} overall
                    </Text>
                  </View>
                  {[
                    { label: 'Valuation', value: p.valuationAccuracy },
                    { label: 'Sale Probability', value: p.saleProbAccuracy },
                    { label: 'Time to Sale', value: p.timeToSaleAccuracy },
                    { label: 'Fee Accuracy', value: p.feeAccuracy },
                  ].map(row => (
                    <View key={row.label} style={styles.predRow}>
                      <Text style={styles.predRowLabel}>{row.label}</Text>
                      <View style={styles.predRowBar}>
                        <View style={[styles.predRowFill, {
                          width: `${row.value * 100}%` as any,
                          backgroundColor: row.value >= 0.75 ? Colors.success : row.value >= 0.6 ? Colors.warning : Colors.danger,
                        }]} />
                      </View>
                      <Text style={styles.predRowPct}>{fmtPct(row.value)}</Text>
                    </View>
                  ))}
                </View>
              ))}
              <View style={styles.predNote}>
                <MaterialIcons name="info-outline" size={14} color={Colors.textTertiary} />
                <Text style={styles.predNoteText}>
                  Predictions improve as more transactions are recorded. Each completed sale feeds the learning engine.
                </Text>
              </View>
            </View>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    paddingHorizontal: Spacing.base, paddingBottom: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder,
    flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between',
  },
  title: { fontSize: Typography.size.xl, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  subtitle: { fontSize: Typography.size.xs, color: Colors.textTertiary, marginTop: 2 },
  exceptAlert: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: Colors.dangerDim, borderRadius: Radius.pill,
    paddingHorizontal: Spacing.sm, paddingVertical: 4,
  },
  exceptAlertDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.danger },
  exceptAlertText: { fontSize: Typography.size.xs, color: Colors.danger, fontWeight: Typography.weight.bold },

  tabBarScroll: { maxHeight: 48, borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder },
  tabBar: { flexDirection: 'row', gap: Spacing.xs, paddingHorizontal: Spacing.base, paddingVertical: Spacing.sm },
  tab: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs, borderRadius: Radius.pill,
  },
  tabActive: { backgroundColor: Colors.primaryDim },
  tabLabel: { fontSize: Typography.size.xs, color: Colors.textTertiary, fontWeight: Typography.weight.medium },
  tabLabelActive: { color: Colors.primary },
  tabBadge: {
    minWidth: 16, height: 16, borderRadius: Radius.pill,
    backgroundColor: Colors.danger, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3,
  },
  tabBadgeText: { fontSize: 9, fontWeight: Typography.weight.bold, color: Colors.textPrimary },

  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: Spacing.base },
  section: { gap: Spacing.lg },

  headlineCard: { backgroundColor: Colors.surface, borderRadius: Radius.xl, padding: Spacing.base, borderWidth: 1, borderColor: Colors.surfaceBorder, ...Shadow.sm },
  headlineRow: { flexDirection: 'row', alignItems: 'center' },
  headlineStat: { flex: 1, alignItems: 'center', gap: 2 },
  headlineDivider: { width: 1, height: 40, backgroundColor: Colors.surfaceBorder },
  headlineValue: { fontSize: Typography.size.xl, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  headlineLabel: { fontSize: Typography.size.xs - 1, color: Colors.textTertiary, textAlign: 'center' },

  metricsTable: { backgroundColor: Colors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceBorder, overflow: 'hidden' },
  metricRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: Spacing.md, paddingVertical: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder },
  metricRowLabel: { fontSize: Typography.size.sm, color: Colors.textSecondary },
  metricRowValue: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.textPrimary },

  // Exceptions
  exceptionsSummary: { flexDirection: 'row', gap: Spacing.sm },
  exceptionSummaryItem: { flex: 1, backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: Spacing.md, alignItems: 'center', gap: 4, borderWidth: 1 },
  exceptionSummaryCount: { fontSize: Typography.size.xl, fontWeight: Typography.weight.extrabold },
  exceptionSummaryLabel: { fontSize: Typography.size.xs - 1, color: Colors.textTertiary },
  exceptionEmpty: { alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.hero },
  exceptionEmptyTitle: { fontSize: Typography.size.lg, fontWeight: Typography.weight.semibold, color: Colors.success },
  exceptionEmptyText: { fontSize: Typography.size.sm, color: Colors.textTertiary, textAlign: 'center' },
  exceptionList: { gap: Spacing.sm },

  capitalHero: { backgroundColor: Colors.primaryDim, borderRadius: Radius.xl, padding: Spacing.xl, alignItems: 'center', gap: Spacing.xs, borderWidth: 1, borderColor: Colors.primary + '30' },
  capitalHeroLabel: { fontSize: Typography.size.xs, color: Colors.primary, textTransform: 'uppercase', letterSpacing: 0.5 },
  capitalHeroValue: { fontSize: Typography.size.xxxl, fontWeight: Typography.weight.extrabold, color: Colors.textPrimary },
  capitalHeroSub: { fontSize: Typography.size.xs, color: Colors.textTertiary },
  capitalBreakdown: { gap: Spacing.md },
  capitalBarItem: { gap: Spacing.xs },
  capitalBarLabel: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  capitalBarDot: { width: 8, height: 8, borderRadius: 4 },
  capitalBarName: { flex: 1, fontSize: Typography.size.sm, color: Colors.textSecondary },
  capitalBarValue: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold },
  barTrack: { height: 6, backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.pill, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: Radius.pill },
  capitalMetrics: { flexDirection: 'row', gap: Spacing.sm },
  capitalMetricCard: { flex: 1, backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: Spacing.md, alignItems: 'center', gap: 4, borderWidth: 1, borderColor: Colors.surfaceBorder },
  capitalMetricValue: { fontSize: Typography.size.md, fontWeight: Typography.weight.bold },
  capitalMetricLabel: { fontSize: Typography.size.xs - 1, color: Colors.textTertiary, textAlign: 'center' },
  viewMoneyBtn: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.primaryDim, borderRadius: Radius.md, padding: Spacing.md,
    borderWidth: 1, borderColor: Colors.primary + '40',
  },
  viewMoneyBtnText: { flex: 1, fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.primary },

  specialistCard: { backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.md, borderWidth: 1, borderColor: Colors.surfaceBorder },
  specialistCardHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  specialistCardDot: { width: 8, height: 8, borderRadius: 4 },
  specialistCardName: { flex: 1, fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.textPrimary },
  specialistCardItems: { fontSize: Typography.size.xs, color: Colors.textTertiary },
  specialistCardStats: { flexDirection: 'row' },
  specialistStat: { flex: 1, alignItems: 'center', gap: 2 },
  specialistStatValue: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  specialistStatLabel: { fontSize: Typography.size.xs - 1, color: Colors.textTertiary },

  predAccuracyHero: { backgroundColor: Colors.accentDim, borderRadius: Radius.xl, padding: Spacing.xl, alignItems: 'center', gap: 4, borderWidth: 1, borderColor: Colors.accent + '30' },
  predAccuracyLabel: { fontSize: Typography.size.xs, color: Colors.accent, textTransform: 'uppercase', letterSpacing: 0.5 },
  predAccuracyValue: { fontSize: Typography.size.xxxl, fontWeight: Typography.weight.extrabold, color: Colors.textPrimary },
  predAccuracySub: { fontSize: Typography.size.xs, color: Colors.textTertiary },
  predRecord: { backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.sm, borderWidth: 1, borderColor: Colors.surfaceBorder },
  predRecordHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  predRecordPeriod: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.textPrimary },
  predRecordOverall: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold },
  predRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  predRowLabel: { width: 110, fontSize: Typography.size.xs, color: Colors.textTertiary },
  predRowBar: { flex: 1, height: 4, backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.pill, overflow: 'hidden' },
  predRowFill: { height: '100%', borderRadius: Radius.pill },
  predRowPct: { width: 40, fontSize: Typography.size.xs, fontWeight: Typography.weight.semibold, color: Colors.textSecondary, textAlign: 'right' },
  predNote: { flexDirection: 'row', gap: Spacing.xs, backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.sm, padding: Spacing.sm },
  predNoteText: { fontSize: Typography.size.xs, color: Colors.textTertiary, flex: 1, lineHeight: 16 },
});
