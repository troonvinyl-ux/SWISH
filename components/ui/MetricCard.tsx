import React, { memo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Colors, Typography, Spacing, Radius, Shadow } from '@/constants/theme';

interface MetricCardProps {
  label: string;
  value: string;
  subValue?: string;
  trend?: 'up' | 'down' | 'neutral';
  trendValue?: string;
  accent?: string;
  onPress?: () => void;
  compact?: boolean;
}

export const MetricCard = memo(({
  label,
  value,
  subValue,
  trend,
  trendValue,
  accent = Colors.primary,
  onPress,
  compact = false,
}: MetricCardProps) => {
  const trendColor = trend === 'up' ? Colors.success : trend === 'down' ? Colors.danger : Colors.textSecondary;
  const trendSymbol = trend === 'up' ? '↑' : trend === 'down' ? '↓' : '→';

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        compact && styles.cardCompact,
        pressed && onPress ? { opacity: 0.85, transform: [{ scale: 0.98 }] } : undefined,
      ]}
    >
      <View style={[styles.accentBar, { backgroundColor: accent }]} />
      <View style={styles.content}>
        <Text style={styles.label}>{label}</Text>
        <Text style={[styles.value, compact && styles.valueCompact]}>{value}</Text>
        {(subValue || trendValue) ? (
          <View style={styles.bottom}>
            {subValue ? <Text style={styles.subValue}>{subValue}</Text> : null}
            {trendValue ? (
              <Text style={[styles.trend, { color: trendColor }]}>
                {trendSymbol} {trendValue}
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>
    </Pressable>
  );
});
MetricCard.displayName = 'MetricCard';

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    overflow: 'hidden',
    flexDirection: 'row',
    ...Shadow.sm,
  },
  cardCompact: {
    minHeight: 70,
  },
  accentBar: {
    width: 3,
  },
  content: {
    flex: 1,
    padding: Spacing.base,
    paddingLeft: Spacing.md,
    gap: 2,
  },
  label: {
    fontSize: Typography.size.xs,
    fontWeight: Typography.weight.medium,
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  value: {
    fontSize: Typography.size.xl,
    fontWeight: Typography.weight.bold,
    color: Colors.textPrimary,
    includeFontPadding: false,
  },
  valueCompact: {
    fontSize: Typography.size.lg,
  },
  bottom: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginTop: 2,
  },
  subValue: {
    fontSize: Typography.size.xs,
    color: Colors.textTertiary,
  },
  trend: {
    fontSize: Typography.size.xs,
    fontWeight: Typography.weight.semibold,
  },
});
