// SWISH Acquisition Detail Screen
// Full decomposition view: cost analysis, ROI progress, processing funnel,
// linked inventory items, AI decomposition engine, and Add Items shortcut.

import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  ActivityIndicator, FlatList,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors, Typography, Spacing, Radius, Shadow } from '@/constants/theme';
import { Badge } from '@/components/ui/Badge';
import { ItemCard } from '@/components/feature/ItemCard';
import { useAcquisitionDetail } from '@/hooks/useAcquisitions';
import { calculateAcquisitionSummary, Acquisition } from '@/services/acquisitionService';
import { useAlert } from '@/template';
import { useApp } from '@/hooks/useApp';
import { SPECIALISTS } from '@/constants/specialists';

// ── Status config ─────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; variant: 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'primary' | 'accent' | 'gold' }> = {
  pending:              { label: 'Pending',             variant: 'neutral' },
  processing:           { label: 'Processing',          variant: 'info' },
  partially_processed:  { label: 'Partial',             variant: 'warning' },
  processed:            { label: 'Processed',           variant: 'primary' },
  selling:              { label: 'Selling',             variant: 'success' },
  completed:            { label: 'Completed',           variant: 'accent' },
  closed:               { label: 'Closed',              variant: 'neutral' },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(dateStr: string) {
  if (!dateStr) return '';
  try { return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); }
  catch { return dateStr; }
}

function roiColor(roi: number) {
  if (roi >= 0.5) return Colors.success;
  if (roi >= 0.2) return Colors.warning;
  if (roi >= 0) return Colors.textSecondary;
  return Colors.danger;
}

// ── FunnelBar ────────────────────────────────────────────────────────────────

function FunnelBar({ total, processed, listed, sold }: {
  total: number; processed: number; listed: number; sold: number;
}) {
  const safe = Math.max(total, 1);
  const processedPct = Math.min(100, (processed / safe) * 100);
  const listedPct    = Math.min(100, (listed    / safe) * 100);
  const soldPct      = Math.min(100, (sold      / safe) * 100);

  return (
    <View style={funnelStyles.wrap}>
      <View style={funnelStyles.track}>
        <View style={[funnelStyles.fill, funnelStyles.fillProcessed, { width: `${processedPct}%` as any }]} />
        <View style={[funnelStyles.fill, funnelStyles.fillListed,    { width: `${listedPct}%` as any }]} />
        <View style={[funnelStyles.fill, funnelStyles.fillSold,      { width: `${soldPct}%` as any }]} />
      </View>
      <View style={funnelStyles.legend}>
        {[
          { label: 'Processed', count: processed, color: Colors.primary },
          { label: 'Listed',    count: listed,    color: Colors.info },
          { label: 'Sold',      count: sold,      color: Colors.success },
        ].map((l) => (
          <View key={l.label} style={funnelStyles.legendItem}>
            <View style={[funnelStyles.legendDot, { backgroundColor: l.color }]} />
            <Text style={funnelStyles.legendLabel}>{l.label}</Text>
            <Text style={[funnelStyles.legendCount, { color: l.color }]}>{l.count}</Text>
          </View>
        ))}
        <View style={funnelStyles.legendItem}>
          <View style={[funnelStyles.legendDot, { backgroundColor: Colors.surfaceHighlight }]} />
          <Text style={funnelStyles.legendLabel}>Remaining</Text>
          <Text style={[funnelStyles.legendCount, { color: Colors.textTertiary }]}>
            {Math.max(0, total - processed)}
          </Text>
        </View>
      </View>
    </View>
  );
}

const funnelStyles = StyleSheet.create({
  wrap: { gap: Spacing.sm },
  track: {
    height: 12, backgroundColor: Colors.surfaceHighlight,
    borderRadius: Radius.pill, overflow: 'hidden',
    position: 'relative',
  },
  fill: {
    position: 'absolute', top: 0, left: 0, height: '100%',
    borderRadius: Radius.pill,
  },
  fillProcessed: { backgroundColor: Colors.primary + '60', zIndex: 1 },
  fillListed:    { backgroundColor: Colors.info    + '90', zIndex: 2 },
  fillSold:      { backgroundColor: Colors.success,         zIndex: 3 },
  legend: {
    flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 6, height: 6, borderRadius: 3 },
  legendLabel: { fontSize: Typography.size.xs, color: Colors.textTertiary },
  legendCount: { fontSize: Typography.size.xs, fontWeight: Typography.weight.bold },
});

// ── ROI Gauge ────────────────────────────────────────────────────────────────

function ROIGauge({ roi, label }: { roi: number; label: string }) {
  const pct = Math.min(100, Math.max(0, roi * 100));
  const color = roiColor(roi);
  return (
    <View style={roiStyles.wrap}>
      <View style={roiStyles.track}>
        <View style={[roiStyles.fill, { width: `${pct}%` as any, backgroundColor: color }]} />
        {/* Target line at 30% ROI */}
        <View style={[roiStyles.targetLine, { left: '30%' as any }]} />
      </View>
      <View style={roiStyles.labels}>
        <Text style={roiStyles.roiValue}>
          <Text style={[roiStyles.roiValueNum, { color }]}>{roi >= 0 ? '+' : ''}{(roi * 100).toFixed(1)}%</Text>
          {' ROI'}
        </Text>
        <Text style={roiStyles.targetHint}>30% target</Text>
      </View>
    </View>
  );
}

const roiStyles = StyleSheet.create({
  wrap: { gap: Spacing.xs },
  track: {
    height: 8, backgroundColor: Colors.surfaceHighlight,
    borderRadius: Radius.pill, overflow: 'visible', position: 'relative',
  },
  fill: {
    height: '100%', borderRadius: Radius.pill,
    position: 'absolute', top: 0, left: 0,
  },
  targetLine: {
    position: 'absolute', top: -3, bottom: -3,
    width: 2, backgroundColor: Colors.textTertiary,
    borderRadius: 1, zIndex: 4,
  },
  labels: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  roiValue: { fontSize: Typography.size.xs, color: Colors.textTertiary },
  roiValueNum: { fontWeight: Typography.weight.bold },
  targetHint: { fontSize: Typography.size.xs, color: Colors.textTertiary },
});

// ── Screen ────────────────────────────────────────────────────────────────────

export default function AcquisitionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { showAlert } = useAlert();
  const { setActiveAcquisitionId } = useApp();
  // Specialist filter for items list (driven by exit strategy chips)
  const [specialistFilter, setSpecialistFilter] = useState<string | null>(null);

  const {
    acquisition,
    items,
    decomposition,
    loading,
    decomposing,
    runDecomposition,
  } = useAcquisitionDetail(id ?? '');

  // Set active acquisition in app context so the scanner knows which acquisition to link to
  useEffect(() => {
    if (id) setActiveAcquisitionId(id);
    return () => { /* don't clear on unmount — scanner may still be using it */ };
  }, [id, setActiveAcquisitionId]);

  const handleAddItems = useCallback(() => {
    // Navigate to scan tab — acquisition context is already set
    router.navigate('/(tabs)/scan');
  }, [router]);

  const handleRunDecomposition = useCallback(async () => {
    try {
      await runDecomposition();
    } catch {
      showAlert('Analysis Failed', 'Could not run decomposition. Please retry.');
    }
  }, [runDecomposition, showAlert]);

  // ── Loading / error states ────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  if (!acquisition) {
    return (
      <View style={[styles.container, styles.centered]}>
        <MaterialIcons name="error-outline" size={48} color={Colors.textTertiary} />
        <Text style={styles.emptyTitle}>Acquisition not found</Text>
        <Pressable onPress={() => router.back()} style={styles.backLinkBtn}>
          <Text style={styles.backLinkText}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  const summary = calculateAcquisitionSummary(acquisition);
  const statusCfg = STATUS_CONFIG[acquisition.status] ?? { label: acquisition.status, variant: 'neutral' as const };
  const hasActualRevenue = acquisition.actualGrossRevenue > 0;

  // Progress metrics
  const processedPct = acquisition.itemCount > 0
    ? Math.round((acquisition.processedCount / acquisition.itemCount) * 100)
    : 0;

  // Item status buckets
  const reviewItems = items.filter((i) => i.status === 'review_required');
  const listedItems = items.filter((i) => i.status === 'listed' || i.status === 'active');
  const soldItems   = items.filter((i) => i.status === 'sold');
  const activeItems = items.filter((i) => !['sold', 'disposed', 'bundled', 'scrapped'].includes(i.status));
  // Filter items by specialist when a chip is active
  const filteredItems = specialistFilter
    ? items.filter((i) => i.specialistId === specialistFilter)
    : items;

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      {/* ── Header ── */}
      <View style={[styles.header, { paddingTop: insets.top + Spacing.sm }]}>
        <Pressable onPress={() => router.back()} style={styles.headerBackBtn} hitSlop={8}>
          <MaterialIcons name="arrow-back" size={20} color={Colors.textSecondary} />
        </Pressable>
        <Pressable onPress={() => router.replace('/(tabs)' as any)} style={styles.headerHomeBtn} hitSlop={8}>
          <MaterialIcons name="dashboard" size={16} color={Colors.textTertiary} />
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle} numberOfLines={1}>{acquisition.title}</Text>
          <View style={styles.headerMeta}>
            <Badge label={statusCfg.label} variant={statusCfg.variant} />
            {acquisition.source ? (
              <Text style={styles.headerSource}>{acquisition.source}</Text>
            ) : null}
            {acquisition.acquisitionDate ? (
              <Text style={styles.headerDate}>{formatDate(acquisition.acquisitionDate)}</Text>
            ) : null}
          </View>
        </View>
        <Pressable
          onPress={handleAddItems}
          style={styles.addItemsBtn}
          hitSlop={4}
        >
          <MaterialIcons name="add-a-photo" size={16} color={Colors.background} />
          <Text style={styles.addItemsBtnText}>Add Items</Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Financial Overview ── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Financial Overview</Text>
          <View style={styles.finGrid}>
            <View style={[styles.finCard, styles.finCardWide]}>
              <Text style={styles.finCardLabel}>Purchase Price</Text>
              <Text style={[styles.finCardValue, { color: Colors.warning }]}>
                £{acquisition.purchasePrice.toLocaleString()}
              </Text>
              {(acquisition.transportCost + acquisition.processingCostEstimate + acquisition.labourEstimate + acquisition.storageCost) > 0 ? (
                <Text style={styles.finCardSub}>
                  +£{(acquisition.transportCost + acquisition.processingCostEstimate + acquisition.labourEstimate + acquisition.storageCost).toLocaleString()} costs
                </Text>
              ) : null}
            </View>
            <View style={[styles.finCard, styles.finCardWide]}>
              <Text style={styles.finCardLabel}>Total Cost Basis</Text>
              <Text style={[styles.finCardValue, { color: Colors.danger }]}>
                £{summary.totalCost.toLocaleString()}
              </Text>
              <Text style={styles.finCardSub}>all-in</Text>
            </View>
          </View>

          <View style={styles.finGrid}>
            <View style={styles.finCard}>
              <Text style={styles.finCardLabel}>Exp. Revenue</Text>
              <Text style={[styles.finCardValue, { color: Colors.primary }]}>
                £{acquisition.expectedGrossRevenue.toLocaleString()}
              </Text>
            </View>
            <View style={styles.finCard}>
              <Text style={styles.finCardLabel}>Exp. Profit</Text>
              <Text style={[styles.finCardValue, { color: summary.expectedProfit >= 0 ? Colors.success : Colors.danger }]}>
                {summary.expectedProfit >= 0 ? '+' : ''}£{summary.expectedProfit.toLocaleString()}
              </Text>
            </View>
            <View style={styles.finCard}>
              <Text style={styles.finCardLabel}>Exp. ROI</Text>
              <Text style={[styles.finCardValue, { color: roiColor(summary.expectedROI) }]}>
                {(summary.expectedROI * 100).toFixed(0)}%
              </Text>
            </View>
          </View>

          {/* ROI gauge */}
          <View style={styles.roiCard}>
            <ROIGauge roi={summary.expectedROI} label="Expected ROI" />
          </View>

          {/* Actual results (if available) */}
          {hasActualRevenue ? (
            <View style={styles.actualResultsCard}>
              <View style={styles.actualResultsHeader}>
                <MaterialIcons name="check-circle" size={14} color={Colors.success} />
                <Text style={styles.actualResultsTitle}>Actual Results</Text>
              </View>
              <View style={styles.finGrid}>
                <View style={styles.finCardFlat}>
                  <Text style={styles.finCardLabel}>Gross Revenue</Text>
                  <Text style={[styles.finCardValueSm, { color: Colors.success }]}>
                    £{acquisition.actualGrossRevenue.toLocaleString()}
                  </Text>
                </View>
                <View style={styles.finCardFlat}>
                  <Text style={styles.finCardLabel}>Net Revenue</Text>
                  <Text style={[styles.finCardValueSm, { color: Colors.success }]}>
                    £{acquisition.actualNetRevenue.toLocaleString()}
                  </Text>
                </View>
                <View style={styles.finCardFlat}>
                  <Text style={styles.finCardLabel}>Actual Profit</Text>
                  <Text style={[styles.finCardValueSm, { color: acquisition.actualProfit >= 0 ? Colors.success : Colors.danger }]}>
                    {acquisition.actualProfit >= 0 ? '+' : ''}£{acquisition.actualProfit.toLocaleString()}
                  </Text>
                </View>
                <View style={styles.finCardFlat}>
                  <Text style={styles.finCardLabel}>Actual ROI</Text>
                  <Text style={[styles.finCardValueSm, { color: roiColor(Number(acquisition.actualROI)) }]}>
                    {(Number(acquisition.actualROI) * 100).toFixed(1)}%
                  </Text>
                </View>
              </View>
            </View>
          ) : null}

          {/* Costs breakdown */}
          {(acquisition.transportCost + acquisition.processingCostEstimate + acquisition.labourEstimate + acquisition.storageCost) > 0 ? (
            <View style={styles.costsCard}>
              <Text style={styles.costsTitle}>Cost Breakdown</Text>
              {[
                { label: 'Purchase',    value: acquisition.purchasePrice },
                { label: 'Transport',   value: acquisition.transportCost },
                { label: 'Processing',  value: acquisition.processingCostEstimate },
                { label: 'Labour Est.', value: acquisition.labourEstimate },
                { label: 'Storage',     value: acquisition.storageCost },
              ].filter((c) => c.value > 0).map((c) => (
                <View key={c.label} style={styles.costRow}>
                  <Text style={styles.costLabel}>{c.label}</Text>
                  <View style={styles.costBarWrap}>
                    <View style={[
                      styles.costBar,
                      { width: `${Math.round((c.value / summary.totalCost) * 100)}%` as any }
                    ]} />
                  </View>
                  <Text style={styles.costValue}>£{c.value.toLocaleString()}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>

        {/* ── Processing Funnel ── */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Processing Progress</Text>
            <Text style={styles.sectionMeta}>{processedPct}% complete</Text>
          </View>

          <View style={styles.countCard}>
            {/* Top: total items */}
            <View style={styles.countRow}>
              <View style={styles.countCell}>
                <Text style={[styles.countNum, { color: Colors.textPrimary }]}>{acquisition.itemCount}</Text>
                <Text style={styles.countLabel}>Total Items</Text>
              </View>
              <View style={[styles.countCell, styles.countCellHighlight]}>
                <Text style={[styles.countNum, { color: Colors.primary }]}>{acquisition.processedCount}</Text>
                <Text style={styles.countLabel}>Processed</Text>
              </View>
              <View style={styles.countCell}>
                <Text style={[styles.countNum, { color: Colors.info }]}>{acquisition.listedCount}</Text>
                <Text style={styles.countLabel}>Listed</Text>
              </View>
              <View style={styles.countCell}>
                <Text style={[styles.countNum, { color: Colors.success }]}>{acquisition.soldCount}</Text>
                <Text style={styles.countLabel}>Sold</Text>
              </View>
            </View>

            <FunnelBar
              total={acquisition.itemCount}
              processed={acquisition.processedCount}
              listed={acquisition.listedCount}
              sold={acquisition.soldCount}
            />

            {/* Alert row for review-needed items */}
            {reviewItems.length > 0 ? (
              <View style={styles.reviewAlert}>
                <MaterialIcons name="warning" size={13} color={Colors.warning} />
                <Text style={styles.reviewAlertText}>
                  {reviewItems.length} {reviewItems.length === 1 ? 'item needs' : 'items need'} manual review
                </Text>
              </View>
            ) : null}
          </View>
        </View>

        {/* ── Decomposition Engine ── */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Decomposition Engine</Text>
            <View style={styles.aiTag}>
              <MaterialIcons name="auto-awesome" size={10} color={Colors.accent} />
              <Text style={styles.aiTagText}>AI</Text>
            </View>
          </View>

          {!decomposition ? (
            <Pressable
              onPress={handleRunDecomposition}
              disabled={decomposing}
              style={({ pressed }) => [
                styles.decomposeBtn,
                decomposing && styles.decomposeBtnDisabled,
                pressed && !decomposing && { opacity: 0.85 },
              ]}
            >
              {decomposing ? (
                <>
                  <ActivityIndicator size="small" color={Colors.textPrimary} />
                  <Text style={styles.decomposeBtnText}>Analysing acquisition...</Text>
                </>
              ) : (
                <>
                  <MaterialIcons name="auto-awesome" size={18} color={Colors.textPrimary} />
                  <Text style={styles.decomposeBtnText}>Run AI Decomposition</Text>
                  <View style={styles.decomposeBtnBadge}>
                    <Text style={styles.decomposeBtnBadgeText}>FREE</Text>
                  </View>
                </>
              )}
            </Pressable>
          ) : (
            <View style={styles.decompositionCard}>

              {/* ── Mis-bundling Detection Banner ── */}
              {decomposition.misBundlingDetected ? (
                <View style={styles.misBundlingBanner}>
                  <MaterialIcons name="warning" size={16} color={Colors.danger} />
                  <View style={styles.decompFlex}>
                    <Text style={styles.misBundlingTitle}>Mis-bundling Detected</Text>
                    <Text style={styles.misBundlingDesc}>
                      Items in this acquisition appear to have been bundled below their combined value.
                      Selling individually will likely yield significantly higher returns.
                    </Text>
                  </View>
                  <View style={styles.misBundlingUpliftBadge}>
                    <Text style={styles.misBundlingUpliftText}>
                      +{(decomposition.upliftPct * 100).toFixed(0)}%
                    </Text>
                    <Text style={styles.misBundlingUpliftLabel}>uplift</Text>
                  </View>
                </View>
              ) : null}

              {/* ── Strategy summary ── */}
              <View style={styles.decompStrategy}>
                <MaterialIcons name="lightbulb" size={14} color={Colors.warning} />
                <Text style={styles.decompStrategyText}>{decomposition.suggestedStrategy}</Text>
              </View>

              {/* ── Approach badge ── */}
              <View style={styles.approachRow}>
                <View style={[styles.approachBadge, {
                  backgroundColor: decomposition.recommendedApproach === 'individual' ? Colors.successDim
                    : decomposition.recommendedApproach === 'bulk' ? Colors.primaryDim
                    : Colors.accentDim,
                }]}>
                  <MaterialIcons
                    name={decomposition.recommendedApproach === 'individual' ? 'list-alt'
                      : decomposition.recommendedApproach === 'bulk' ? 'inventory'
                      : 'auto-awesome'}
                    size={11}
                    color={decomposition.recommendedApproach === 'individual' ? Colors.success
                      : decomposition.recommendedApproach === 'bulk' ? Colors.primary
                      : Colors.accent}
                  />
                  <Text style={[styles.approachBadgeText, {
                    color: decomposition.recommendedApproach === 'individual' ? Colors.success
                      : decomposition.recommendedApproach === 'bulk' ? Colors.primary
                      : Colors.accent,
                  }]}>
                    {decomposition.recommendedApproach.charAt(0).toUpperCase() + decomposition.recommendedApproach.slice(1)} Approach Recommended
                  </Text>
                </View>
                <View style={[styles.confBadge, {
                  backgroundColor: decomposition.confidence === 'high' ? Colors.successDim
                    : decomposition.confidence === 'medium' ? Colors.warningDim
                    : Colors.infoDim,
                }]}>
                  <Text style={[styles.confBadgeText, {
                    color: decomposition.confidence === 'high' ? Colors.success
                      : decomposition.confidence === 'medium' ? Colors.warning
                      : Colors.info,
                  }]}>
                    {decomposition.confidence} confidence
                  </Text>
                </View>
              </View>

              {/* ── Prize Items Panel ── */}
              {decomposition.prizeItemCount > 0 ? (
                <View style={styles.prizePanel}>
                  <View style={styles.prizePanelHeader}>
                    <MaterialIcons name="star" size={14} color={Colors.gold} />
                    <Text style={styles.prizePanelTitle}>Prize Items</Text>
                    <View style={styles.prizeBadge}>
                      <Text style={styles.prizeBadgeText}>{decomposition.prizeItemCount} items</Text>
                    </View>
                    {/* Cost Coverage Badge */}
                    <View style={[styles.coverageBadge, {
                      backgroundColor: decomposition.prizeCoveragePct >= 1 ? Colors.successDim
                        : decomposition.prizeCoveragePct >= 0.5 ? Colors.warningDim
                        : Colors.dangerDim,
                    }]}>
                      <MaterialIcons
                        name={decomposition.prizeCoveragePct >= 1 ? 'check-circle' : 'trending-up'}
                        size={10}
                        color={decomposition.prizeCoveragePct >= 1 ? Colors.success
                          : decomposition.prizeCoveragePct >= 0.5 ? Colors.warning
                          : Colors.danger}
                      />
                      <Text style={[styles.coverageText, {
                        color: decomposition.prizeCoveragePct >= 1 ? Colors.success
                          : decomposition.prizeCoveragePct >= 0.5 ? Colors.warning
                          : Colors.danger,
                      }]}>
                        covers {(decomposition.prizeCoveragePct * 100).toFixed(0)}% of acquisition cost
                      </Text>
                    </View>
                  </View>
                  <View style={styles.prizeStatsRow}>
                    <View style={styles.prizeStat}>
                      <Text style={[styles.prizeStatValue, { color: Colors.gold }]}>
                        £{decomposition.prizeItemsValue.toLocaleString()}
                      </Text>
                      <Text style={styles.prizeStatLabel}>Combined Value</Text>
                    </View>
                    <View style={styles.prizeStatDivider} />
                    <View style={styles.prizeStat}>
                      <Text style={[styles.prizeStatValue, { color: Colors.success }]}>
                        £{(decomposition.prizeItemsValue / Math.max(decomposition.prizeItemCount, 1)).toFixed(0)}
                      </Text>
                      <Text style={styles.prizeStatLabel}>Avg per Prize</Text>
                    </View>
                    <View style={styles.prizeStatDivider} />
                    <View style={styles.prizeStat}>
                      <Text style={[styles.prizeStatValue, {
                        color: decomposition.prizeItemsValue > acquisition.purchasePrice ? Colors.success : Colors.warning,
                      }]}>
                        {decomposition.prizeItemsValue >= acquisition.purchasePrice ? 'Covered' : 'Partial'}
                      </Text>
                      <Text style={styles.prizeStatLabel}>Cost Recovery</Text>
                    </View>
                  </View>
                  {decomposition.prizeCoveragePct >= 1 ? (
                    <View style={styles.prizeNote}>
                      <MaterialIcons name="check-circle" size={12} color={Colors.success} />
                      <Text style={styles.prizeNoteText}>
                        Prize items alone cover the full acquisition cost. Everything else is pure profit.
                      </Text>
                    </View>
                  ) : (
                    <View style={styles.prizeNote}>
                      <MaterialIcons name="info-outline" size={12} color={Colors.info} />
                      <Text style={styles.prizeNoteText}>
                        Prize items recover {(decomposition.prizeCoveragePct * 100).toFixed(0)}% of your acquisition cost (£{acquisition.purchasePrice.toLocaleString()}). Remaining items contribute additional upside.
                      </Text>
                    </View>
                  )}
                </View>
              ) : null}

              {/* ── Value Uplift ── */}
              {decomposition.decompositionUplift > 0 ? (
                <View style={styles.upliftRow}>
                  <View style={styles.upliftCard}>
                    <Text style={styles.miniLabel}>BUNDLE VALUE</Text>
                    <Text style={styles.upliftValue}>£{decomposition.wholeBundleValue.toLocaleString()}</Text>
                  </View>
                  <View style={styles.upliftArrow}>
                    <MaterialIcons name="arrow-forward" size={14} color={Colors.textTertiary} />
                    <View style={styles.upliftBadge}>
                      <Text style={styles.upliftBadgeText}>+£{decomposition.decompositionUplift.toLocaleString()}</Text>
                    </View>
                  </View>
                  <View style={styles.upliftCard}>
                    <Text style={styles.miniLabel}>DECOMPOSED VALUE</Text>
                    <Text style={[styles.upliftValue, { color: Colors.success }]}>£{decomposition.decomposedValue.toLocaleString()}</Text>
                  </View>
                </View>
              ) : null}

              {/* ── Labour Economics — Side-by-Side ── */}
              {(decomposition.individualLabourHours > 0 || decomposition.bulkLabourHours > 0) ? (
                <View style={styles.labourSection}>
                  <Text style={styles.miniLabel}>LABOUR ECONOMICS</Text>
                  <View style={styles.labourGrid}>
                    {/* Individual */}
                    <View style={[styles.labourCard, decomposition.individualProfitPerHour >= decomposition.bulkProfitPerHour && styles.labourCardWinner]}>
                      {decomposition.individualProfitPerHour >= decomposition.bulkProfitPerHour ? (
                        <View style={styles.labourWinnerBadge}>
                          <MaterialIcons name="emoji-events" size={9} color={Colors.gold} />
                          <Text style={styles.labourWinnerText}>Best Value</Text>
                        </View>
                      ) : null}
                      <MaterialIcons name="list-alt" size={16} color={Colors.primary} />
                      <Text style={styles.labourCardTitle}>Individual</Text>
                      <Text style={[styles.labourCardRate, { color: Colors.primary }]}>
                        £{decomposition.individualProfitPerHour.toFixed(0)}/hr
                      </Text>
                      <Text style={styles.labourCardHours}>
                        ~{decomposition.individualLabourHours.toFixed(1)}h total
                      </Text>
                    </View>
                    {/* Bulk */}
                    <View style={[styles.labourCard, decomposition.bulkProfitPerHour > decomposition.individualProfitPerHour && styles.labourCardWinner]}>
                      {decomposition.bulkProfitPerHour > decomposition.individualProfitPerHour ? (
                        <View style={styles.labourWinnerBadge}>
                          <MaterialIcons name="emoji-events" size={9} color={Colors.gold} />
                          <Text style={styles.labourWinnerText}>Best Value</Text>
                        </View>
                      ) : null}
                      <MaterialIcons name="inventory" size={16} color={Colors.accent} />
                      <Text style={styles.labourCardTitle}>Bulk / Lot</Text>
                      <Text style={[styles.labourCardRate, { color: Colors.accent }]}>
                        £{decomposition.bulkProfitPerHour.toFixed(0)}/hr
                      </Text>
                      <Text style={styles.labourCardHours}>
                        ~{decomposition.bulkLabourHours.toFixed(1)}h total
                      </Text>
                    </View>
                  </View>
                  {decomposition.recommendedLabourHours > 0 ? (
                    <View style={styles.labourSummary}>
                      <MaterialIcons name="schedule" size={12} color={Colors.textTertiary} />
                      <Text style={styles.labourSummaryText}>
                        Recommended: ~{decomposition.recommendedLabourHours.toFixed(1)}h · £{decomposition.profitPerLabourHour.toFixed(0)}/hr effective rate
                      </Text>
                    </View>
                  ) : null}
                </View>
              ) : null}

              {/* ── Key Financials ── */}
              <View style={styles.decompMetrics}>
                <View style={styles.decompMetric}>
                  <Text style={styles.miniLabel}>EXPECTED PROFIT</Text>
                  <Text style={[styles.decompMetricValue, { color: Colors.success }]}>
                    +£{decomposition.expectedProfit.toLocaleString()}
                  </Text>
                </View>
                <View style={styles.decompMetric}>
                  <Text style={styles.miniLabel}>ROI</Text>
                  <Text style={[styles.decompMetricValue, { color: roiColor(decomposition.expectedROI) }]}>
                    {(decomposition.expectedROI * 100).toFixed(0)}%
                  </Text>
                </View>
                <View style={styles.decompMetric}>
                  <Text style={styles.miniLabel}>£/HOUR</Text>
                  <Text style={[styles.decompMetricValue, { color: Colors.gold }]}>
                    £{decomposition.profitPerLabourHour}
                  </Text>
                </View>
              </View>

              {/* ── Specialist Exit Strategy Chips ── */}
              {Object.keys(decomposition.specialistRoutes).length > 0 ? (
                <View style={styles.exitSection}>
                  <Text style={styles.miniLabel}>SPECIALIST EXIT STRATEGIES</Text>
                  <Text style={styles.exitSubtitle}>Tap a specialist to filter items below</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.exitChipRow}>
                    {/* "All" chip */}
                    <Pressable
                      onPress={() => setSpecialistFilter(null)}
                      style={[styles.exitChip, specialistFilter === null && styles.exitChipActive]}
                    >
                      <Text style={[styles.exitChipLabel, specialistFilter === null && styles.exitChipLabelActive]}>All Items</Text>
                      <View style={[styles.exitChipCount, specialistFilter === null && { backgroundColor: Colors.primary }]}>
                        <Text style={[styles.exitChipCountText, specialistFilter === null && { color: Colors.textPrimary }]}>{items.length}</Text>
                      </View>
                    </Pressable>
                    {Object.entries(decomposition.specialistRoutes).map(([specId, route]) => {
                      const spec = SPECIALISTS[specId as keyof typeof SPECIALISTS];
                      const isActive = specialistFilter === specId;
                      const strategyIcon = {
                        individual: 'list-alt', bundle: 'inventory', lot: 'category',
                        scrap: 'delete-outline', hold: 'pause-circle-outline',
                      }[route.strategy] ?? 'storefront';
                      return (
                        <Pressable
                          key={specId}
                          onPress={() => setSpecialistFilter(isActive ? null : specId)}
                          style={[styles.exitChip, isActive && styles.exitChipActive, isActive && spec && { borderColor: spec.color }]}
                        >
                          <View style={[styles.exitChipDot, { backgroundColor: spec?.color ?? Colors.primary }]} />
                          <View style={styles.exitChipContent}>
                            <Text style={[styles.exitChipLabel, isActive && styles.exitChipLabelActive, isActive && spec && { color: spec.color }]}>
                              {spec?.shortName ?? specId}
                            </Text>
                            <View style={styles.exitChipMeta}>
                              <MaterialIcons name={strategyIcon as any} size={9} color={Colors.textTertiary} />
                              <Text style={styles.exitChipStrategy}>
                                {route.strategy} · £{route.estimatedValue.toLocaleString()}
                              </Text>
                            </View>
                          </View>
                          <View style={[styles.exitChipCount, isActive && spec && { backgroundColor: spec.color }]}>
                            <Text style={[styles.exitChipCountText, isActive && { color: Colors.textPrimary }]}>{route.count}</Text>
                          </View>
                        </Pressable>
                      );
                    })}
                  </ScrollView>

                  {/* Active specialist route detail */}
                  {specialistFilter && decomposition.specialistRoutes[specialistFilter] ? (() => {
                    const route = decomposition.specialistRoutes[specialistFilter];
                    const spec = SPECIALISTS[specialistFilter as keyof typeof SPECIALISTS];
                    return (
                      <View style={[styles.routeDetail, spec && { borderColor: spec.color + '40', backgroundColor: spec.color + '08' }]}>
                        <View style={styles.routeDetailHeader}>
                          <View style={[styles.routeDetailDot, { backgroundColor: spec?.color ?? Colors.primary }]} />
                          <Text style={[styles.routeDetailTitle, spec && { color: spec.color }]}>
                            {spec?.name ?? specialistFilter} — {route.strategy.charAt(0).toUpperCase() + route.strategy.slice(1)} Strategy
                          </Text>
                        </View>
                        <Text style={styles.routeDetailNotes}>{route.notes}</Text>
                        <View style={styles.routeDetailStats}>
                          <View style={styles.routeDetailStat}>
                            <Text style={styles.routeDetailStatValue}>£{route.estimatedValue.toLocaleString()}</Text>
                            <Text style={styles.routeDetailStatLabel}>Est. Value</Text>
                          </View>
                          <View style={styles.routeDetailStat}>
                            <Text style={styles.routeDetailStatValue}>{route.count}</Text>
                            <Text style={styles.routeDetailStatLabel}>Items</Text>
                          </View>
                          {route.expectedLabourHours ? (
                            <View style={styles.routeDetailStat}>
                              <Text style={styles.routeDetailStatValue}>{route.expectedLabourHours.toFixed(1)}h</Text>
                              <Text style={styles.routeDetailStatLabel}>Labour</Text>
                            </View>
                          ) : null}
                          {route.profitPerHour ? (
                            <View style={styles.routeDetailStat}>
                              <Text style={[styles.routeDetailStatValue, { color: Colors.gold }]}>£{route.profitPerHour.toFixed(0)}/hr</Text>
                              <Text style={styles.routeDetailStatLabel}>£/Hour</Text>
                            </View>
                          ) : null}
                        </View>
                      </View>
                    );
                  })() : null}
                </View>
              ) : null}

              {/* ── Warnings ── */}
              {decomposition.warnings.map((w, i) => (
                <View key={i} style={styles.decompWarning}>
                  <MaterialIcons name="warning" size={12} color={Colors.warning} />
                  <Text style={styles.decompWarningText}>{w}</Text>
                </View>
              ))}

              {/* ── Collection Patterns ── */}
              {decomposition.collectionPatterns.length > 0 ? (
                <View style={styles.collectionPatterns}>
                  <Text style={styles.miniLabel}>COLLECTION PATTERNS</Text>
                  <View style={styles.patternChips}>
                    {decomposition.collectionPatterns.map((p, i) => (
                      <View key={i} style={styles.patternChip}>
                        <MaterialIcons name="insights" size={10} color={Colors.accent} />
                        <Text style={styles.patternChipText}>{p}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              ) : null}

              {/* ── Re-run ── */}
              <Pressable
                onPress={handleRunDecomposition}
                disabled={decomposing}
                style={styles.rerunBtn}
              >
                <MaterialIcons name="refresh" size={14} color={Colors.textTertiary} />
                <Text style={styles.rerunBtnText}>Re-run analysis</Text>
              </Pressable>
            </View>
          )}
        </View>

        {/* ── Tags & Notes ── */}
        {(acquisition.tags.length > 0 || acquisition.notes) ? (
          <View style={styles.section}>
            {acquisition.tags.length > 0 ? (
              <>
                <Text style={styles.sectionTitle}>Tags</Text>
                <View style={styles.tagsRow}>
                  {acquisition.tags.map((tag) => (
                    <View key={tag} style={styles.tagChip}>
                      <Text style={styles.tagText}>{tag}</Text>
                    </View>
                  ))}
                </View>
              </>
            ) : null}
            {acquisition.notes ? (
              <View style={styles.notesCard}>
                <Text style={styles.notesLabel}>Notes</Text>
                <Text style={styles.notesText}>{acquisition.notes}</Text>
              </View>
            ) : null}
          </View>
        ) : null}

        {/* ── Linked Inventory ── */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Items</Text>
            <View style={styles.itemCountBadge}>
              <Text style={styles.itemCountText}>{items.length}</Text>
            </View>
          </View>

          {/* Active specialist filter indicator */}
          {specialistFilter ? (
            <View style={styles.filterIndicator}>
              <MaterialIcons name="filter-list" size={13} color={Colors.primary} />
              <Text style={styles.filterIndicatorText}>
                Showing: {SPECIALISTS[specialistFilter as keyof typeof SPECIALISTS]?.shortName ?? specialistFilter} items ({filteredItems.length})
              </Text>
              <Pressable onPress={() => setSpecialistFilter(null)} style={styles.filterClearBtn} hitSlop={6}>
                <MaterialIcons name="close" size={13} color={Colors.primary} />
              </Pressable>
            </View>
          ) : null}

          {filteredItems.length === 0 && specialistFilter ? (
            <View style={styles.emptyItems}>
              <MaterialIcons name="filter-list" size={32} color={Colors.textTertiary} />
              <Text style={styles.emptyItemsTitle}>No items for this specialist</Text>
              <Text style={styles.emptyItemsText}>Items scanned and identified under this specialist will appear here.</Text>
              <Pressable onPress={() => setSpecialistFilter(null)} style={styles.emptyAddBtn}>
                <Text style={styles.emptyAddBtnText}>Show All Items</Text>
              </Pressable>
            </View>
          ) : items.length === 0 ? (
            <View style={styles.emptyItems}>
              <MaterialIcons name="photo-camera" size={32} color={Colors.textTertiary} />
              <Text style={styles.emptyItemsTitle}>No items yet</Text>
              <Text style={styles.emptyItemsText}>
                Tap &quot;Add Items&quot; to scan and identify items from this acquisition.
              </Text>
              <Pressable onPress={handleAddItems} style={styles.emptyAddBtn}>
                <MaterialIcons name="add-a-photo" size={16} color={Colors.background} />
                <Text style={styles.emptyAddBtnText}>Start Scanning</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.itemsList}>
              {/* Status summary strip */}
              {items.length > 3 ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.itemStatusStrip} contentContainerStyle={styles.itemStatusStripContent}>
                  {[
                    { label: 'Review', count: reviewItems.length, color: Colors.danger },
                    { label: 'Listed', count: listedItems.length, color: Colors.info },
                    { label: 'Sold',   count: soldItems.length,   color: Colors.success },
                    { label: 'Active', count: activeItems.length, color: Colors.primary },
                  ].filter((s) => s.count > 0).map((s) => (
                    <View key={s.label} style={[styles.itemStatusChip, { borderColor: s.color + '40' }]}>
                      <View style={[styles.itemStatusDot, { backgroundColor: s.color }]} />
                      <Text style={[styles.itemStatusCount, { color: s.color }]}>{s.count}</Text>
                      <Text style={styles.itemStatusLabel}>{s.label}</Text>
                    </View>
                  ))}
                </ScrollView>
              ) : null}

              {/* All items as ItemCards (filtered by specialist if active) */}
              {filteredItems.map((item) => (
                <ItemCard
                  key={item.id}
                  item={item}
                  onPress={(itemId) => router.push(`/stock-listing/${itemId}` as any)}
                />
              ))}
            </View>
          )}
        </View>

        {/* ── Metadata ── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Record</Text>
          <View style={styles.metaCard}>
            {[
              { label: 'Acquisition ID', value: acquisition.id },
              { label: 'Location',       value: acquisition.location || '—' },
              { label: 'Created',        value: formatDate(acquisition.createdAt) },
              { label: 'Last Updated',   value: formatDate(acquisition.updatedAt) },
            ].map(({ label, value }) => (
              <View key={label} style={styles.metaRow}>
                <Text style={styles.metaLabel}>{label}</Text>
                <Text style={styles.metaValue} numberOfLines={1}>{value}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* ── Add Items CTA (bottom) ── */}
        <Pressable
          onPress={handleAddItems}
          style={({ pressed }) => [styles.addItemsCtaBtn, pressed && { opacity: 0.85 }]}
        >
          <MaterialIcons name="add-a-photo" size={18} color={Colors.background} />
          <Text style={styles.addItemsCtaBtnText}>Add Items to This Acquisition</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  centered: { alignItems: 'center', justifyContent: 'center' },

  emptyTitle: { fontSize: Typography.size.lg, fontWeight: Typography.weight.semibold, color: Colors.textSecondary, marginTop: Spacing.md },
  backLinkBtn: { marginTop: Spacing.md, padding: Spacing.md },
  backLinkText: { fontSize: Typography.size.sm, color: Colors.primary },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: Spacing.base, paddingBottom: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder,
    gap: Spacing.sm,
  },
  headerBackBtn: {
    width: 36, height: 36, borderRadius: Radius.md,
    backgroundColor: Colors.surface,
    alignItems: 'center', justifyContent: 'center',
    flexShrink: 0, borderWidth: 1, borderColor: Colors.surfaceBorder,
  },
  headerHomeBtn: {
    width: 36, height: 36, borderRadius: Radius.md,
    backgroundColor: Colors.surface,
    alignItems: 'center', justifyContent: 'center',
    flexShrink: 0, borderWidth: 1, borderColor: Colors.surfaceBorder,
  },
  headerCenter: { flex: 1, gap: 3 },
  headerTitle: {
    fontSize: Typography.size.base,
    fontWeight: Typography.weight.bold,
    color: Colors.textPrimary,
  },
  headerMeta: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, flexWrap: 'wrap' },
  headerSource: { fontSize: Typography.size.xs, color: Colors.textTertiary },
  headerDate: { fontSize: Typography.size.xs, color: Colors.textTertiary },
  addItemsBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.primary, borderRadius: Radius.pill,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs + 2,
    flexShrink: 0, ...Shadow.glow,
  },
  addItemsBtnText: { fontSize: Typography.size.xs, fontWeight: Typography.weight.bold, color: Colors.background },

  // Content
  content: { padding: Spacing.base, gap: Spacing.xl },

  // Section
  section: { gap: Spacing.sm },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: {
    fontSize: Typography.size.xs,
    fontWeight: Typography.weight.semibold,
    color: Colors.textTertiary,
    textTransform: 'uppercase', letterSpacing: 0.6,
  },
  sectionMeta: { fontSize: Typography.size.xs, color: Colors.textTertiary, fontWeight: Typography.weight.semibold },
  miniLabel: {
    fontSize: 9, fontWeight: Typography.weight.bold,
    color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.6,
  },

  // Financial
  finGrid: { flexDirection: 'row', gap: Spacing.sm },
  finCard: {
    flex: 1, backgroundColor: Colors.surface, borderRadius: Radius.lg,
    padding: Spacing.md, alignItems: 'center', gap: 3,
    borderWidth: 1, borderColor: Colors.surfaceBorder, ...Shadow.sm,
  },
  finCardWide: { flex: 1 },
  finCardLabel: { fontSize: Typography.size.xs - 1, color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.3 },
  finCardValue: { fontSize: Typography.size.lg, fontWeight: Typography.weight.bold },
  finCardSub: { fontSize: Typography.size.xs - 1, color: Colors.textTertiary },
  finCardFlat: { flex: 1, alignItems: 'center', gap: 2 },
  finCardValueSm: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold },

  roiCard: {
    backgroundColor: Colors.surface, borderRadius: Radius.lg,
    padding: Spacing.md, borderWidth: 1, borderColor: Colors.surfaceBorder,
  },

  actualResultsCard: {
    backgroundColor: Colors.successDim, borderRadius: Radius.lg,
    padding: Spacing.md, gap: Spacing.sm,
    borderWidth: 1, borderColor: Colors.success + '40',
  },
  actualResultsHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  actualResultsTitle: { fontSize: Typography.size.xs, fontWeight: Typography.weight.semibold, color: Colors.success },

  costsCard: {
    backgroundColor: Colors.surface, borderRadius: Radius.lg,
    padding: Spacing.md, gap: Spacing.sm,
    borderWidth: 1, borderColor: Colors.surfaceBorder,
  },
  costsTitle: { fontSize: Typography.size.xs, fontWeight: Typography.weight.semibold, color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.4 },
  costRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  costLabel: { fontSize: Typography.size.xs, color: Colors.textTertiary, width: 70 },
  costBarWrap: {
    flex: 1, height: 6, backgroundColor: Colors.surfaceHighlight,
    borderRadius: Radius.pill, overflow: 'hidden',
  },
  costBar: {
    height: '100%', backgroundColor: Colors.primary + '70',
    borderRadius: Radius.pill,
  },
  costValue: { fontSize: Typography.size.xs, fontWeight: Typography.weight.semibold, color: Colors.textSecondary, width: 48, textAlign: 'right' },

  // Count card
  countCard: {
    backgroundColor: Colors.surface, borderRadius: Radius.xl,
    padding: Spacing.base, gap: Spacing.md,
    borderWidth: 1, borderColor: Colors.surfaceBorder, ...Shadow.sm,
  },
  countRow: { flexDirection: 'row', justifyContent: 'space-around' },
  countCell: { alignItems: 'center', gap: 3, flex: 1 },
  countCellHighlight: {
    backgroundColor: Colors.primaryDim, borderRadius: Radius.lg,
    paddingVertical: Spacing.xs,
  },
  countNum: { fontSize: Typography.size.xxl, fontWeight: Typography.weight.bold },
  countLabel: { fontSize: Typography.size.xs - 1, color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.3 },

  reviewAlert: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.xs,
    backgroundColor: Colors.warningDim, borderRadius: Radius.sm,
    paddingHorizontal: Spacing.sm, paddingVertical: Spacing.xs,
  },
  reviewAlertText: { fontSize: Typography.size.xs, color: Colors.warning, flex: 1 },

  // AI tag
  aiTag: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: Colors.accentDim, borderRadius: Radius.pill,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  aiTagText: { fontSize: 9, fontWeight: Typography.weight.bold, color: Colors.accent, letterSpacing: 0.3 },

  // Decomposition
  decomposeBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: Spacing.sm, backgroundColor: Colors.accent,
    borderRadius: Radius.xl, padding: Spacing.base, ...Shadow.md,
  },
  decomposeBtnDisabled: { opacity: 0.6 },
  decomposeBtnText: { fontSize: Typography.size.base, fontWeight: Typography.weight.semibold, color: Colors.textPrimary },
  decomposeBtnBadge: {
    backgroundColor: Colors.background + '60', borderRadius: Radius.pill,
    paddingHorizontal: Spacing.sm, paddingVertical: 2,
  },
  decomposeBtnBadgeText: { fontSize: 9, fontWeight: Typography.weight.bold, color: Colors.textPrimary, letterSpacing: 0.5 },

  decompositionCard: {
    backgroundColor: Colors.surface, borderRadius: Radius.xl,
    padding: Spacing.base, gap: Spacing.md,
    borderWidth: 1, borderColor: Colors.surfaceBorder, ...Shadow.sm,
  },
  decompStrategy: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm,
    backgroundColor: Colors.warningDim, borderRadius: Radius.md,
    padding: Spacing.md, borderWidth: 1, borderColor: Colors.warning + '30',
  },
  decompStrategyText: { flex: 1, fontSize: Typography.size.sm, color: Colors.warning, lineHeight: 20 },
  decompBreakdownTitle: { marginTop: Spacing.xs },
  decompGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  decompChip: {
    backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.md,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    alignItems: 'center', gap: 2,
  },
  decompChipCount: { fontSize: Typography.size.lg, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  decompChipLabel: { fontSize: Typography.size.xs - 1, color: Colors.textTertiary, textTransform: 'capitalize', textAlign: 'center' },
  decompMetrics: {
    flexDirection: 'row', justifyContent: 'space-around',
    borderTopWidth: 1, borderTopColor: Colors.surfaceBorder, paddingTop: Spacing.md,
  },
  decompMetric: { alignItems: 'center', gap: 4 },
  decompMetricValue: { fontSize: Typography.size.lg, fontWeight: Typography.weight.bold },
  decompWarning: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.xs,
    backgroundColor: Colors.warningDim, borderRadius: Radius.sm,
    padding: Spacing.sm, borderWidth: 1, borderColor: Colors.warning + '20',
  },
  decompWarningText: { flex: 1, fontSize: Typography.size.xs, color: Colors.warning },
  rerunBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xs,
    paddingVertical: Spacing.sm,
  },
  rerunBtnText: { fontSize: Typography.size.xs, color: Colors.textTertiary },

  // Mis-bundling banner
  misBundlingBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm,
    backgroundColor: Colors.dangerDim, borderRadius: Radius.lg, padding: Spacing.md,
    borderWidth: 1, borderColor: Colors.danger + '40',
  },
  decompFlex: { flex: 1 },
  misBundlingTitle: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.danger },
  misBundlingDesc: { fontSize: Typography.size.xs, color: Colors.textSecondary, marginTop: 2, lineHeight: 16 },
  misBundlingUpliftBadge: { alignItems: 'center', backgroundColor: Colors.danger + '20', borderRadius: Radius.md, paddingHorizontal: 8, paddingVertical: 4 },
  misBundlingUpliftText: { fontSize: Typography.size.base, fontWeight: Typography.weight.extrabold, color: Colors.danger },
  misBundlingUpliftLabel: { fontSize: 9, color: Colors.danger, textTransform: 'uppercase', letterSpacing: 0.3 },

  // Approach + confidence row
  approachRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, flexWrap: 'wrap' },
  approachBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: Radius.pill, paddingHorizontal: 8, paddingVertical: 3 },
  approachBadgeText: { fontSize: Typography.size.xs, fontWeight: Typography.weight.semibold },
  confBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: Radius.pill },
  confBadgeText: { fontSize: 9, fontWeight: Typography.weight.bold, textTransform: 'uppercase', letterSpacing: 0.3 },

  // Prize panel
  prizePanel: {
    backgroundColor: Colors.goldDim, borderRadius: Radius.lg, padding: Spacing.md,
    gap: Spacing.sm, borderWidth: 1, borderColor: Colors.gold + '40',
  },
  prizePanelHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, flexWrap: 'wrap' },
  prizePanelTitle: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.gold },
  prizeBadge: { backgroundColor: Colors.gold + '30', borderRadius: Radius.pill, paddingHorizontal: 6, paddingVertical: 2 },
  prizeBadgeText: { fontSize: 9, fontWeight: Typography.weight.bold, color: Colors.gold },
  coverageBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: Radius.pill, paddingHorizontal: 7, paddingVertical: 3 },
  coverageText: { fontSize: 10, fontWeight: Typography.weight.semibold },
  prizeStatsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around' },
  prizeStat: { alignItems: 'center', gap: 2, flex: 1 },
  prizeStatValue: { fontSize: Typography.size.md, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  prizeStatLabel: { fontSize: 9, color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.3 },
  prizeStatDivider: { width: 1, height: 28, backgroundColor: Colors.gold + '40' },
  prizeNote: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.xs, backgroundColor: Colors.background + '40', borderRadius: Radius.sm, padding: Spacing.xs + 2 },
  prizeNoteText: { flex: 1, fontSize: Typography.size.xs, color: Colors.textSecondary, lineHeight: 16 },

  // Value uplift row
  upliftRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.lg, padding: Spacing.md },
  upliftCard: { flex: 1, alignItems: 'center', gap: 2 },
  upliftValue: { fontSize: Typography.size.base, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  upliftArrow: { alignItems: 'center', gap: 2 },
  upliftBadge: { backgroundColor: Colors.successDim, borderRadius: Radius.pill, paddingHorizontal: 5, paddingVertical: 2 },
  upliftBadgeText: { fontSize: 9, fontWeight: Typography.weight.bold, color: Colors.success },

  // Labour economics
  labourSection: { gap: Spacing.sm },
  labourGrid: { flexDirection: 'row', gap: Spacing.sm },
  labourCard: {
    flex: 1, backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: Spacing.md,
    alignItems: 'center', gap: Spacing.xs,
    borderWidth: 1, borderColor: Colors.surfaceBorder,
  },
  labourCardWinner: { borderColor: Colors.gold + '60', backgroundColor: Colors.goldDim },
  labourWinnerBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: Colors.gold + '30', borderRadius: Radius.pill, paddingHorizontal: 5, paddingVertical: 2 },
  labourWinnerText: { fontSize: 8, fontWeight: Typography.weight.bold, color: Colors.gold, textTransform: 'uppercase', letterSpacing: 0.3 },
  labourCardTitle: { fontSize: Typography.size.xs, fontWeight: Typography.weight.semibold, color: Colors.textSecondary },
  labourCardRate: { fontSize: Typography.size.xl, fontWeight: Typography.weight.extrabold },
  labourCardHours: { fontSize: Typography.size.xs, color: Colors.textTertiary },
  labourSummary: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.sm, padding: Spacing.xs + 2 },
  labourSummaryText: { flex: 1, fontSize: Typography.size.xs, color: Colors.textTertiary },

  // Exit strategy chips
  exitSection: { gap: Spacing.xs },
  exitSubtitle: { fontSize: Typography.size.xs - 1, color: Colors.textTertiary, marginBottom: 2 },
  exitChipRow: { flexDirection: 'row', gap: Spacing.sm, paddingVertical: 4, paddingHorizontal: 2 },
  exitChip: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.xs,
    backgroundColor: Colors.surface, borderRadius: Radius.lg,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    borderWidth: 1, borderColor: Colors.surfaceBorder,
  },
  exitChipActive: { backgroundColor: Colors.primaryDim, borderColor: Colors.primary },
  exitChipDot: { width: 7, height: 7, borderRadius: 4, flexShrink: 0 },
  exitChipContent: { gap: 1 },
  exitChipLabel: { fontSize: Typography.size.xs, fontWeight: Typography.weight.semibold, color: Colors.textSecondary },
  exitChipLabelActive: { color: Colors.primary },
  exitChipMeta: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  exitChipStrategy: { fontSize: 9, color: Colors.textTertiary },
  exitChipCount: { minWidth: 18, height: 18, borderRadius: Radius.pill, backgroundColor: Colors.surfaceHighlight, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  exitChipCountText: { fontSize: 9, fontWeight: Typography.weight.bold, color: Colors.textTertiary },

  // Route detail card
  routeDetail: {
    backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.lg, padding: Spacing.md,
    gap: Spacing.sm, borderWidth: 1, borderColor: Colors.surfaceBorder,
    marginTop: Spacing.xs,
  },
  routeDetailHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  routeDetailDot: { width: 8, height: 8, borderRadius: 4 },
  routeDetailTitle: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.textPrimary },
  routeDetailNotes: { fontSize: Typography.size.xs, color: Colors.textSecondary, lineHeight: 17 },
  routeDetailStats: { flexDirection: 'row', justifyContent: 'space-around' },
  routeDetailStat: { alignItems: 'center', gap: 2 },
  routeDetailStatValue: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  routeDetailStatLabel: { fontSize: 9, color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.3 },

  // Collection patterns
  collectionPatterns: { gap: Spacing.xs },
  patternChips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  patternChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.accentDim, borderRadius: Radius.pill,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  patternChipText: { fontSize: Typography.size.xs, color: Colors.accent },

  // Filter indicator
  filterIndicator: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.xs,
    backgroundColor: Colors.primaryDim, borderRadius: Radius.md, padding: Spacing.sm,
    borderWidth: 1, borderColor: Colors.primary + '40',
  },
  filterIndicatorText: { flex: 1, fontSize: Typography.size.xs, color: Colors.primary, fontWeight: Typography.weight.medium },
  filterClearBtn: { padding: 2 },

  // Tags & notes
  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  tagChip: {
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs,
    backgroundColor: Colors.surface, borderRadius: Radius.pill,
    borderWidth: 1, borderColor: Colors.surfaceBorder,
  },
  tagText: { fontSize: Typography.size.xs, color: Colors.textSecondary },
  notesCard: {
    backgroundColor: Colors.surface, borderRadius: Radius.lg,
    padding: Spacing.md, gap: Spacing.xs,
    borderWidth: 1, borderColor: Colors.surfaceBorder,
  },
  notesLabel: { fontSize: Typography.size.xs, color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.4 },
  notesText: { fontSize: Typography.size.sm, color: Colors.textSecondary, lineHeight: 20 },

  // Items
  itemsList: { gap: Spacing.sm },
  itemStatusStrip: { marginHorizontal: -Spacing.base, maxHeight: 44 },
  itemStatusStripContent: {
    paddingHorizontal: Spacing.base, gap: Spacing.xs,
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: Spacing.xs,
  },
  itemStatusChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs,
    backgroundColor: Colors.surface, borderRadius: Radius.pill,
    borderWidth: 1,
  },
  itemStatusDot: { width: 5, height: 5, borderRadius: 3 },
  itemStatusCount: { fontSize: Typography.size.xs, fontWeight: Typography.weight.bold },
  itemStatusLabel: { fontSize: Typography.size.xs, color: Colors.textTertiary },

  emptyItems: {
    backgroundColor: Colors.surface, borderRadius: Radius.xl,
    padding: Spacing.xl, alignItems: 'center', gap: Spacing.md,
    borderWidth: 1, borderColor: Colors.surfaceBorder,
    borderStyle: 'dashed',
  },
  emptyItemsTitle: { fontSize: Typography.size.base, fontWeight: Typography.weight.semibold, color: Colors.textSecondary },
  emptyItemsText: { fontSize: Typography.size.sm, color: Colors.textTertiary, textAlign: 'center', lineHeight: 20 },
  emptyAddBtn: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.xs,
    backgroundColor: Colors.primary, borderRadius: Radius.pill,
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm, ...Shadow.glow,
  },
  emptyAddBtnText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.background },

  // Meta
  metaCard: {
    backgroundColor: Colors.surface, borderRadius: Radius.lg,
    padding: Spacing.md, gap: Spacing.xs,
    borderWidth: 1, borderColor: Colors.surfaceBorder,
  },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 2 },
  metaLabel: { fontSize: Typography.size.xs, color: Colors.textTertiary },
  metaValue: { fontSize: Typography.size.xs, color: Colors.textSecondary, flex: 1, textAlign: 'right' },

  // Bottom CTA
  addItemsCtaBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: Spacing.sm, backgroundColor: Colors.primary,
    borderRadius: Radius.xl, padding: Spacing.base + 2,
    ...Shadow.glow,
  },
  addItemsCtaBtnText: { fontSize: Typography.size.base, fontWeight: Typography.weight.bold, color: Colors.background },
  itemCountBadge: {
    minWidth: 22, height: 22, borderRadius: Radius.pill,
    backgroundColor: Colors.primaryDim, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 6,
  },
  itemCountText: { fontSize: Typography.size.xs, fontWeight: Typography.weight.bold, color: Colors.primary },
});
