// SWISH — eBay Tab
// This tab now serves as the eBay Hub entry point.
// All inventory + listing management is in the Stock tab (inventory.tsx).

import React from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors, Typography, Spacing, Radius, Shadow } from '@/constants/theme';
import { useApp } from '@/hooks/useApp';

const EBAY_ROUTES = [
  { icon: 'storefront', label: 'eBay Hub', sub: 'Orders, messages, offers', route: '/ebay-hub', color: '#E53238' },
  { icon: 'receipt-long', label: 'Orders', sub: 'Manage & fulfil orders', route: '/orders', color: Colors.success },
  { icon: 'message', label: 'Messages', sub: 'Buyer conversations', route: '/ebay-messages', color: Colors.info },
  { icon: 'local-offer', label: 'Offers', sub: 'Best Offer responses', route: '/ebay-offers', color: Colors.primary },
  { icon: 'analytics', label: 'Analytics', sub: 'Views, watchers, sales', route: '/ebay-analytics', color: Colors.accent },
  { icon: 'payments', label: 'Finances', sub: 'Payouts & fees', route: '/ebay-finances', color: Colors.gold },
  { icon: 'assignment-return', label: 'Returns', sub: 'Handle buyer returns', route: '/ebay-returns', color: Colors.warning },
  { icon: 'gavel', label: 'Cases', sub: 'eBay dispute cases', route: '/ebay-cases', color: Colors.danger },
  { icon: 'price-change', label: 'Repricing', sub: 'Auto-reprice rules', route: '/repricing', color: Colors.primary },
  { icon: 'sync', label: 'CSV Import', sub: 'Bulk eBay import', route: '/ebay-csv', color: Colors.textSecondary },
  { icon: 'account-circle', label: 'eBay Account', sub: 'Connection & policies', route: '/ebay-account', color: Colors.info },
  { icon: 'receipt', label: 'API Log', sub: 'Debug & audit trail', route: '/ebay-log', color: Colors.textTertiary },
];

export default function ListingsTabScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { tenant, activeNicheId, fixedNicheId } = useApp();

  const nicheId = (fixedNicheId ?? activeNicheId ?? '').toLowerCase();
  const isThreadsFlip = nicheId === 'clothing';
  const threads = { background: '#0C080C', surface: '#160E16', border: '#301830', pink: '#E91E8C', cream: '#FFF0F5', muted: '#9A7090' };
  const accentColor =
    nicheId.includes('coin') ? '#F5C842' :
    nicheId === 'motocross' ? '#FF5500' :
    nicheId === 'bicycles' ? '#6ED020' :
    nicheId === 'clothing' ? '#E91E8C' : Colors.primary;

  return (
    <View testID={isThreadsFlip ? 'threads-flip-screen-14' : undefined} accessibilityLabel={isThreadsFlip ? 'Threads Flip screen 14 Listings and eBay tools' : undefined} style={[s.container, isThreadsFlip && { backgroundColor: threads.background }]}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={[s.header, { paddingTop: insets.top + Spacing.base }, isThreadsFlip && { backgroundColor: threads.surface, borderBottomColor: threads.border }]}>
        <View style={[s.headerIcon, { backgroundColor: '#E53238' + '20' }]}>
          <MaterialIcons name="storefront" size={18} color="#E53238" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[s.headerTitle, { color: '#E53238' }]}>eBay Management</Text>
          <Text style={[s.headerSub, isThreadsFlip && { color: threads.muted }]}>Threads Flip · Orders · Messages · Analytics · Finances</Text>
        </View>
        <Pressable
          onPress={() => router.push('/ebay-hub' as any)}
          style={({ pressed }) => [s.hubBtn, pressed && { opacity: 0.85 }]}
        >
          <MaterialIcons name="dashboard" size={14} color="#000" />
          <Text style={s.hubBtnText}>Hub</Text>
        </Pressable>
      </View>

      {/* Info banner — direct users to Stock tab for listings */}
      <View style={[s.infoBanner, isThreadsFlip && { backgroundColor: threads.surface, borderColor: threads.border }]}>
        <MaterialIcons name="info-outline" size={13} color={accentColor} />
        <View style={{ flex: 1 }}>
          <Text style={[s.infoBannerTitle, { color: accentColor }]}>Listings are now in the Stock tab</Text>
          <Text style={s.infoBannerSub}>In Stock → Draft → Live → Sold, all in one place.</Text>
        </View>
        <Pressable
          onPress={() => router.replace('/(tabs)/inventory' as any)}
          style={[s.goStockBtn, { backgroundColor: accentColor }]}
        >
          <Text style={s.goStockBtnText}>Go to Stock</Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 100 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Quick-access grid */}
        <View style={s.grid}>
          {EBAY_ROUTES.map(route => (
            <Pressable
              key={route.route}
              onPress={() => router.push(route.route as any)}
              style={({ pressed }) => [s.card, pressed && { opacity: 0.85 }]}
            >
              <View style={[s.cardIcon, { backgroundColor: route.color + '18' }]}>
                <MaterialIcons name={route.icon as any} size={22} color={route.color} />
              </View>
              <Text style={s.cardLabel}>{route.label}</Text>
              <Text style={s.cardSub} numberOfLines={1}>{route.sub}</Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.base, paddingBottom: Spacing.md, borderBottomWidth: 1, borderBottomColor: '#E53238' + '30' },
  headerIcon: { width: 40, height: 40, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: Typography.size.xl, fontWeight: Typography.weight.bold },
  headerSub: { fontSize: Typography.size.xs, color: Colors.textTertiary, marginTop: 2 },
  hubBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#E53238', borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: 8 },
  hubBtnText: { fontSize: Typography.size.xs, fontWeight: Typography.weight.bold, color: '#000' },
  infoBanner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, margin: Spacing.base, backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.surfaceBorder, ...Shadow.sm },
  infoBannerTitle: { fontSize: Typography.size.xs, fontWeight: Typography.weight.bold },
  infoBannerSub: { fontSize: 10, color: Colors.textTertiary, lineHeight: 14, marginTop: 2 },
  goStockBtn: { borderRadius: Radius.md, paddingHorizontal: Spacing.sm, paddingVertical: 6 },
  goStockBtnText: { fontSize: 10, fontWeight: Typography.weight.bold, color: '#000' },
  content: { padding: Spacing.base, gap: Spacing.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md },
  card: { width: '47%', backgroundColor: Colors.surface, borderRadius: Radius.xl, padding: Spacing.md, gap: Spacing.sm, borderWidth: 1, borderColor: Colors.surfaceBorder, ...Shadow.sm },
  cardIcon: { width: 44, height: 44, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  cardLabel: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  cardSub: { fontSize: 10, color: Colors.textTertiary, lineHeight: 14 },
});
