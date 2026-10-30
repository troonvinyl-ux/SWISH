import React, { memo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors, Typography, Spacing, Radius } from '@/constants/theme';

type BadgeVariant = 'primary' | 'success' | 'warning' | 'danger' | 'gold' | 'neutral' | 'info' | 'accent';

interface BadgeProps {
  label: string;
  variant?: BadgeVariant;
  size?: 'sm' | 'md';
}

const variantStyles: Record<BadgeVariant, { bg: string; text: string }> = {
  primary: { bg: Colors.primaryDim, text: Colors.primary },
  success: { bg: Colors.successDim, text: Colors.success },
  warning: { bg: Colors.warningDim, text: Colors.warning },
  danger: { bg: Colors.dangerDim, text: Colors.danger },
  gold: { bg: Colors.goldDim, text: Colors.gold },
  neutral: { bg: Colors.surfaceHighlight, text: Colors.textSecondary },
  info: { bg: Colors.infoDim, text: Colors.info },
  accent: { bg: Colors.accentDim, text: Colors.accent },
};

export const Badge = memo(({ label, variant = 'neutral', size = 'sm' }: BadgeProps) => {
  const style = variantStyles[variant];
  return (
    <View style={[styles.badge, size === 'md' && styles.badgeMd, { backgroundColor: style.bg }]}>
      <Text style={[styles.text, size === 'md' && styles.textMd, { color: style.text }]}>
        {label}
      </Text>
    </View>
  );
});

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xxs + 1,
    borderRadius: Radius.pill,
    alignSelf: 'flex-start',
  },
  badgeMd: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
  },
  text: {
    fontSize: Typography.size.xs,
    fontWeight: Typography.weight.semibold,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  textMd: {
    fontSize: Typography.size.sm,
  },
});
