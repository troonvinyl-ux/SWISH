// SWISH V1 Tab Navigation — 4-tab layout (eBay-first, simplified)
// Home | Scan | Stock | Listings
// Acquisitions and Insights are hidden from V1 navigation.

import { MaterialIcons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Platform, View, Text, StyleSheet, Pressable } from 'react-native';
import { useState, useEffect, useCallback } from 'react';
import { Colors, Typography, Spacing, Radius } from '@/constants/theme';
import { useApp } from '@/hooks/useApp';
import { getLiveListingCount } from '@/services/listingService';
import { IS_TV } from '@/hooks/useTVNavigation';

// ── Live listings count ───────────────────────────────────────────────────────

function useLiveListingCount() {
  const { tenant } = useApp();
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    if (!tenant?.id) return;
    const n = await getLiveListingCount(tenant.id);
    setCount(n);
  }, [tenant?.id]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 30_000);
    return () => clearInterval(interval);
  }, [refresh]);

  return count;
}

function TabLabel({ label, focused }: { label: string; focused: boolean }) {
  return (
    <Text
      style={[styles.tabLabel, focused && styles.tabLabelActive]}
      numberOfLines={1}
      allowFontScaling={false}
    >
      {label}
    </Text>
  );
}

/**
 * On Fire Stick / Android TV we show a persistent D-pad guide bar at the
 * bottom of the screen so the user knows which tab is active and can select
 * with OK / Enter.  On phones this component renders nothing.
 */
function TVTabHint() {
  if (!IS_TV) return null;
  return (
    <View style={styles.tvHint}>
      <Text style={styles.tvHintText}>
        ← → Navigate tabs  ·  ↑ ↓ Scroll  ·  OK Select  ·  ← Back
      </Text>
    </View>
  );
}

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const liveCount = useLiveListingCount();

  const tabBarStyle = {
    height: Platform.select({
      ios: insets.bottom + 64,
      android: insets.bottom + 64,
      default: 72,
    }),
    paddingTop: Spacing.sm,
    paddingBottom: Platform.select({
      ios: insets.bottom + Spacing.sm,
      android: insets.bottom + Spacing.sm,
      default: Spacing.sm,
    }),
    paddingHorizontal: Spacing.xs,
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.surfaceBorder,
  };

  return (
    <>
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle,
        tabBarActiveTintColor: Colors.primary,
        tabBarInactiveTintColor: Colors.textTertiary,
        tabBarShowLabel: false,
      }}
    >
      {/* ── Tab 1: Home Dashboard ── */}
      <Tabs.Screen
        name="index"
        options={{
          tabBarIcon: ({ color, focused }) => (
            <View style={[styles.tabItem, focused && styles.tabItemActive]}>
              <MaterialIcons name="dashboard" size={22} color={color} />
              <TabLabel label="Home" focused={focused} />
            </View>
          ),
        }}
      />

      {/* ── Tab 2: Scan (centre hero button) ── */}
      <Tabs.Screen
        name="scan"
        options={{
          tabBarIcon: ({ color, focused }) => (
            <View style={styles.scanTab}>
              <MaterialIcons name="qr-code-scanner" size={26} color={Colors.background} />
            </View>
          ),
        }}
      />

      {/* ── Tab 3: Stock / Inventory ── */}
      <Tabs.Screen
        name="inventory"
        options={{
          tabBarIcon: ({ color, focused }) => (
            <View style={[styles.tabItem, focused && styles.tabItemActive]}>
              <MaterialIcons name="toll" size={22} color={color} />
              <TabLabel label="Stock" focused={focused} />
            </View>
          ),
        }}
      />

      {/* ── Tab 4: Listings ── */}
      <Tabs.Screen
        name="listings"
        options={{
          tabBarIcon: ({ color, focused }) => (
            <View style={[styles.tabItem, focused && styles.tabItemActive]}>
              <View style={styles.iconWrap}>
                <MaterialIcons name="receipt-long" size={22} color={color} />
                {liveCount > 0 ? (
                  <View style={styles.liveBadge}>
                    <Text style={styles.liveBadgeText}>
                      {liveCount > 99 ? '99+' : String(liveCount)}
                    </Text>
                  </View>
                ) : null}
              </View>
              <TabLabel label="Listings" focused={focused} />
            </View>
          ),
        }}
      />

      {/* ── Hidden tabs (V2 — keep functional but not in nav) ── */}
      <Tabs.Screen
        name="acquisitions"
        options={{ href: null }}
      />
      <Tabs.Screen
        name="insights"
        options={{ href: null }}
      />
    </Tabs>
    <TVTabHint />
    </>
  );
}

const styles = StyleSheet.create({
  tabItem: {
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: IS_TV ? Spacing.lg : Spacing.sm,
    paddingVertical: IS_TV ? Spacing.sm : Spacing.xs,
    borderRadius: Radius.sm,
    minWidth: IS_TV ? 100 : 56,
  },
  tabItemActive: {
    backgroundColor: Colors.primaryDim,
    borderWidth: IS_TV ? 2 : 0,
    borderColor: IS_TV ? Colors.primary : 'transparent',
  },
  tvHint: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: Colors.surface,
    paddingVertical: Spacing.xs,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: Colors.surfaceBorder,
  },
  tvHintText: {
    fontSize: Typography.size.xs,
    color: Colors.textTertiary,
    letterSpacing: 0.3,
  },
  tabLabel: {
    fontSize: 10,
    fontWeight: Typography.weight.medium,
    color: Colors.textTertiary,
    letterSpacing: 0.2,
    textAlign: 'center',
  },
  tabLabelActive: {
    color: Colors.primary,
  },
  scanTab: {
    width: 52,
    height: 52,
    borderRadius: Radius.pill,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Platform.OS === 'ios' ? 8 : 0,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 8,
  },
  iconWrap: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  liveBadge: {
    position: 'absolute',
    top: -4,
    right: -6,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: Colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
    borderWidth: 1.5,
    borderColor: Colors.surface,
  },
  liveBadgeText: {
    fontSize: 8,
    fontWeight: Typography.weight.bold,
    color: '#FFFFFF',
    lineHeight: 10,
  },
});
