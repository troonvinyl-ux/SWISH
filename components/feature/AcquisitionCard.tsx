import React, { memo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors, Typography, Spacing, Radius, Shadow } from '@/constants/theme';
import { Acquisition, AcquisitionStatus, calculateAcquisitionSummary } from '@/services/acquisitionService';

interface AcquisitionCardProps {
  acquisition: Acquisition;
  onPress?: (id: string) => void;
}

const statusConfig: Record<AcquisitionStatus, { color: string; label: string }> = {
  pending: { color: Colors.textSecondary, label: 'Pending' },
  processing: { color: Colors.warning, label: 'Processing' },
  partially_processed: { color: Colors.info, label: 'Partial' },
  processed: { color: Colors.primary, label: 'Processed' },
  selling: { color: Colors.success, label: 'Selling' },
  completed: { color: Colors.accent, label: 'Completed' },
  closed: { color: Colors.textTertiary, label: 'Closed' },
};

export const AcquisitionCard = memo(({ acquisition, onPress }: AcquisitionCardProps) => {
  const summary = calculateAcquisitionSummary(acquisition);
  const status = statusConfig[acquisition.status] ?? { color: Colors.textSecondary, label: acquisition.status };
  const progressPct = Math.min(100, Math.round(summary.progressPercent));
  const roi = (summary.expectedROI * 100).toFixed(0);

  return (
    <Pressable
      onPress={() => onPress?.(acquisition.id)}
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.9, transform: [{ scale: 0.99 }] }]}
    >
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.title} numberOfLines={1}>{acquisition.title}</Text>
          <Text style={styles.source}>{acquisition.source} · {acquisition.acquisitionDate}</Text>
        </View>
        <View style={[styles.statusBadge, { borderColor: status.color }]}>
          <Text style={[styles.statusText, { color: status.color }]}>{status.label}</Text>
        </View>
      </View>

      {/* Metrics row */}
      <View style={styles.metricsRow}>
        <View style={styles.metric}>
          <Text style={styles.metricLabel}>Cost</Text>
          <Text style={styles.metricValue}>£{acquisition.purchasePrice.toLocaleString()}</Text>
        </View>
        <View style={styles.metricDivider} />
        <View style={styles.metric}>
          <Text style={styles.metricLabel}>Expected Profit</Text>
          <Text style={[styles.metricValue, { color: Colors.success }]}>
            £{summary.expectedProfit.toLocaleString()}
          </Text>
        </View>
        <View style={styles.metricDivider} />
        <View style={styles.metric}>
          <Text style={styles.metricLabel}>ROI</Text>
          <Text style={[styles.metricValue, { color: Colors.gold }]}>{roi}%</Text>
        </View>
        <View style={styles.metricDivider} />
        <View style={styles.metric}>
          <Text style={styles.metricLabel}>Items</Text>
          <Text style={styles.metricValue}>{acquisition.itemCount}</Text>
        </View>
      </View>

      {/* Progress */}
      <View style={styles.progressSection}>
        <View style={styles.progressLabelRow}>
          <Text style={styles.progressLabel}>Processing Progress</Text>
          <Text style={styles.progressPct}>{progressPct}%</Text>
        </View>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progressPct}%` as any }]} />
        </View>
        <View style={styles.progressStats}>
          <Text style={styles.progressStat}>{acquisition.processedCount} processed</Text>
          <Text style={styles.progressStat}>{acquisition.listedCount} listed</Text>
          <Text style={styles.progressStat}>{acquisition.soldCount} sold</Text>
        </View>
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    padding: Spacing.base,
    gap: Spacing.md,
    ...Shadow.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  headerLeft: {
    flex: 1,
  },
  title: {
    fontSize: Typography.size.base,
    fontWeight: Typography.weight.semibold,
    color: Colors.textPrimary,
  },
  source: {
    fontSize: Typography.size.xs,
    color: Colors.textTertiary,
    marginTop: 2,
  },
  statusBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  statusText: {
    fontSize: Typography.size.xs,
    fontWeight: Typography.weight.semibold,
  },
  metricsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surfaceElevated,
    borderRadius: Radius.md,
    padding: Spacing.md,
  },
  metric: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  metricDivider: {
    width: 1,
    height: 28,
    backgroundColor: Colors.surfaceBorder,
  },
  metricLabel: {
    fontSize: Typography.size.xs - 1,
    color: Colors.textTertiary,
    textAlign: 'center',
  },
  metricValue: {
    fontSize: Typography.size.sm,
    fontWeight: Typography.weight.bold,
    color: Colors.textPrimary,
    textAlign: 'center',
  },
  progressSection: {
    gap: Spacing.xs,
  },
  progressLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  progressLabel: {
    fontSize: Typography.size.xs,
    color: Colors.textTertiary,
  },
  progressPct: {
    fontSize: Typography.size.xs,
    fontWeight: Typography.weight.semibold,
    color: Colors.primary,
  },
  progressTrack: {
    height: 4,
    backgroundColor: Colors.surfaceHighlight,
    borderRadius: Radius.pill,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: Colors.primary,
    borderRadius: Radius.pill,
  },
  progressStats: {
    flexDirection: 'row',
    gap: Spacing.base,
  },
  progressStat: {
    fontSize: Typography.size.xs - 1,
    color: Colors.textTertiary,
  },
});
