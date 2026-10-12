import React, { ReactNode } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Colors, Typography, Spacing } from '@/constants/theme';

interface ScreenWrapperProps {
  children: ReactNode;
  title?: string;
  subtitle?: string;
  scrollable?: boolean;
  onRefresh?: () => void;
  refreshing?: boolean;
  rightSlot?: ReactNode;
  noPadding?: boolean;
}

export function ScreenWrapper({
  children,
  title,
  subtitle,
  scrollable = true,
  onRefresh,
  refreshing = false,
  rightSlot,
  noPadding = false,
}: ScreenWrapperProps) {
  const insets = useSafeAreaInsets();

  const header = (title || rightSlot) ? (
    <View style={[styles.header, { paddingTop: insets.top + Spacing.base }]}>
      <View style={styles.headerLeft}>
        {title ? <Text style={styles.title}>{title}</Text> : null}
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {rightSlot ? <View style={styles.rightSlot}>{rightSlot}</View> : null}
    </View>
  ) : null;

  if (!scrollable) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <StatusBar style="light" />
        {header}
        <View style={[styles.content, noPadding && styles.noPadding]}>
          {children}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + 80 },
          noPadding && styles.noPadding,
        ]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          onRefresh ? (
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={Colors.primary}
            />
          ) : undefined
        }
      >
        {header ? (
          <View style={{ paddingTop: insets.top }}>
            {header}
          </View>
        ) : null}
        {children}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    paddingHorizontal: Spacing.base,
    paddingBottom: Spacing.md,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  headerLeft: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: Typography.size.xl,
    fontWeight: Typography.weight.bold,
    color: Colors.textPrimary,
  },
  subtitle: {
    fontSize: Typography.size.sm,
    color: Colors.textSecondary,
  },
  rightSlot: {
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: Spacing.base,
  },
  noPadding: {
    paddingHorizontal: 0,
  },
});
