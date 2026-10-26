import React, { memo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors, Typography, Spacing, Radius, Shadow } from '@/constants/theme';
import { AIInsight } from '@/services/insightsService';

interface InsightCardProps {
  insight: AIInsight;
  onAction?: (insight: AIInsight) => void;
  compact?: boolean;
}

const priorityConfig = {
  critical: { color: Colors.danger, bg: Colors.dangerDim, icon: 'error' as const, label: 'CRITICAL' },
  high: { color: Colors.warning, bg: Colors.warningDim, icon: 'warning' as const, label: 'HIGH' },
  medium: { color: Colors.primary, bg: Colors.primaryDim, icon: 'info' as const, label: 'INFO' },
  low: { color: Colors.textSecondary, bg: Colors.surfaceHighlight, icon: 'lightbulb-outline' as const, label: 'LOW' },
};

const typeConfig = {
  opportunity: { icon: 'trending-up' as const, color: Colors.success },
  warning: { icon: 'warning' as const, color: Colors.danger },
  recommendation: { icon: 'lightbulb' as const, color: Colors.warning },
  anomaly: { icon: 'device-unknown' as const, color: Colors.warning },
  performance: { icon: 'analytics' as const, color: Colors.primary },
};

export const InsightCard = memo(({ insight, onAction, compact = false }: InsightCardProps) => {
  const priority = priorityConfig[insight.priority];
  const type = typeConfig[insight.type];

  return (
    <View style={[styles.card, compact && styles.cardCompact]}>
      <View style={[styles.iconWrap, { backgroundColor: priority.bg }]}>
        <MaterialIcons name={type.icon} size={compact ? 18 : 22} color={type.color} />
      </View>
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text style={styles.title} numberOfLines={compact ? 1 : 2}>{insight.title}</Text>
          <View style={[styles.priorityBadge, { backgroundColor: priority.bg }]}>
            <Text style={[styles.priorityText, { color: priority.color }]}>{priority.label}</Text>
          </View>
        </View>
        {!compact ? (
          <Text style={styles.detail} numberOfLines={3}>{insight.detail}</Text>
        ) : null}
        <View style={styles.footer}>
          {insight.estimatedValue ? (
            <Text style={styles.value}>£{insight.estimatedValue.toLocaleString()}</Text>
          ) : null}
          {insight.actionLabel && onAction ? (
            <Pressable
              onPress={() => onAction(insight)}
              style={({ pressed }) => [styles.actionBtn, pressed && { opacity: 0.7 }]}
            >
              <Text style={styles.actionText}>{insight.actionLabel}</Text>
              <MaterialIcons name="arrow-forward" size={12} color={Colors.primary} />
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
});
InsightCard.displayName = 'InsightCard';

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    padding: Spacing.base,
    flexDirection: 'row',
    gap: Spacing.md,
    ...Shadow.sm,
  },
  cardCompact: {
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  body: {
    flex: 1,
    gap: Spacing.xs,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
  },
  title: {
    flex: 1,
    fontSize: Typography.size.sm,
    fontWeight: Typography.weight.semibold,
    color: Colors.textPrimary,
    lineHeight: Typography.size.sm * 1.4,
  },
  detail: {
    fontSize: Typography.size.xs,
    color: Colors.textSecondary,
    lineHeight: Typography.size.xs * 1.5,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.xs,
  },
  value: {
    fontSize: Typography.size.sm,
    fontWeight: Typography.weight.bold,
    color: Colors.success,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  actionText: {
    fontSize: Typography.size.xs,
    fontWeight: Typography.weight.semibold,
    color: Colors.primary,
  },
  priorityBadge: {
    paddingHorizontal: Spacing.xs,
    paddingVertical: 2,
    borderRadius: Radius.xs,
  },
  priorityText: {
    fontSize: 9,
    fontWeight: Typography.weight.bold,
    letterSpacing: 0.5,
  },
});
