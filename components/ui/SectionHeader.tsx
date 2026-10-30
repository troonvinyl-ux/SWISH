import React, { memo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Colors, Typography, Spacing } from '@/constants/theme';

interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  action?: string;
  onAction?: () => void;
  badge?: string | number;
}

export const SectionHeader = memo(({ title, subtitle, action, onAction, badge }: SectionHeaderProps) => (
  <View style={styles.row}>
    <View style={styles.left}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>{title}</Text>
        {badge !== undefined ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{badge}</Text>
          </View>
        ) : null}
      </View>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
    {action && onAction ? (
      <Pressable onPress={onAction} hitSlop={8}>
        <Text style={styles.action}>{action}</Text>
      </Pressable>
    ) : null}
  </View>
));

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: Spacing.md,
  },
  left: { flex: 1 },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  title: {
    fontSize: Typography.size.md,
    fontWeight: Typography.weight.semibold,
    color: Colors.textPrimary,
  },
  subtitle: {
    fontSize: Typography.size.xs,
    color: Colors.textTertiary,
    marginTop: 2,
  },
  badge: {
    backgroundColor: Colors.primaryDim,
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  badgeText: {
    fontSize: Typography.size.xs,
    fontWeight: Typography.weight.bold,
    color: Colors.primary,
  },
  action: {
    fontSize: Typography.size.sm,
    fontWeight: Typography.weight.medium,
    color: Colors.primary,
  },
});
