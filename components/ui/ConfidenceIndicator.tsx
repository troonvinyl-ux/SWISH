import React, { memo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors, Typography, Spacing, Radius } from '@/constants/theme';
import { ConfidenceTier, EvidenceSource } from '@/constants/config';

interface ConfidenceBarProps {
  value: number; // 0-1
  tier?: ConfidenceTier;
  showLabel?: boolean;
  compact?: boolean;
}

function tierFromValue(value: number): ConfidenceTier {
  if (value >= 0.9) return 'very_high';
  if (value >= 0.75) return 'high';
  if (value >= 0.55) return 'medium';
  if (value >= 0.35) return 'low';
  return 'very_low';
}

const tierColor: Record<ConfidenceTier, string> = {
  very_high: Colors.success,
  high: Colors.success,
  medium: Colors.warning,
  low: Colors.danger,
  very_low: Colors.danger,
  unknown: Colors.textTertiary,
};

const tierLabel: Record<ConfidenceTier, string> = {
  very_high: 'Very High',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  very_low: 'Very Low',
  unknown: 'Unknown',
};

export const ConfidenceBar = memo(({ value, tier, showLabel = true, compact = false }: ConfidenceBarProps) => {
  const t = tier ?? tierFromValue(value);
  const color = tierColor[t];
  const pct = Math.round(value * 100);

  return (
    <View style={[styles.container, compact && styles.containerCompact]}>
      {showLabel ? (
        <View style={styles.labelRow}>
          <Text style={styles.label}>Confidence</Text>
          <Text style={[styles.value, { color }]}>{tierLabel[t]} · {pct}%</Text>
        </View>
      ) : null}
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${pct}%` as any, backgroundColor: color }]} />
      </View>
    </View>
  );
});
ConfidenceBar.displayName = 'ConfidenceBar';

interface EvidenceBadgeProps {
  source: EvidenceSource;
}

const sourceConfig: Record<EvidenceSource, { label: string; color: string }> = {
  detected: { label: 'AI Detected', color: Colors.primary },
  inferred: { label: 'Inferred', color: Colors.warning },
  researched: { label: 'Researched', color: Colors.info },
  user_confirmed: { label: 'User Confirmed', color: Colors.success },
  verified: { label: 'Verified', color: Colors.accent },
  unknown: { label: 'Unknown', color: Colors.textTertiary },
};

export const EvidenceBadge = memo(({ source }: EvidenceBadgeProps) => {
  const cfg = sourceConfig[source];
  return (
    <View style={[styles.evidenceBadge, { borderColor: cfg.color }]}>
      <View style={[styles.evidenceDot, { backgroundColor: cfg.color }]} />
      <Text style={[styles.evidenceText, { color: cfg.color }]}>{cfg.label}</Text>
    </View>
  );
});
EvidenceBadge.displayName = 'EvidenceBadge';

const styles = StyleSheet.create({
  container: {
    gap: Spacing.xs,
  },
  containerCompact: {},
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  label: {
    fontSize: Typography.size.xs,
    color: Colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  value: {
    fontSize: Typography.size.xs,
    fontWeight: Typography.weight.semibold,
  },
  track: {
    height: 4,
    backgroundColor: Colors.surfaceHighlight,
    borderRadius: Radius.pill,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: Radius.pill,
  },
  evidenceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
    borderRadius: Radius.pill,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  evidenceDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
  },
  evidenceText: {
    fontSize: Typography.size.xs,
    fontWeight: Typography.weight.medium,
  },
});
