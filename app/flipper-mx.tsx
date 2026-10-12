
// Flipper MX — Dedicated Motocross Niche Entry Point
//
// Design: Orange/Black — "DIRT BIKES. REAL DATA. BIGGER PROFITS."
// Tagline: FIND > FIX > FLIP > REPEAT
// Tabs: Find, Fix & Prep, List & Sell, Profits, Insights
//
// ARCHITECTURE: Presentation layer wrapping shared SWISH engine.
// All AI, valuation, and listing calls go through identical shared services.

import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, Pressable, ScrollView,
  ActivityIndicator, Linking,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import { getSupabaseClient } from '@/template';
import { Colors, Typography, Spacing, Radius, Shadow } from '@/constants/theme';
import { useApp } from '@/hooks/useApp';
import { useSubscription } from '@/hooks/useSubscription';
import { useAlert } from '@/template';
import { startCheckout } from '@/services/subscriptionService';

// ── Flipper MX design tokens ──────────────────────────────────────────────────
const MX = {
  black:       '#0A0A08',
  surface:     '#141410',
  surfaceHigh: '#1E1E18',
  border:      '#2E2E20',
  orange:      '#FF5500',
  orangeBright:'#FF7733',
  orangeDim:   '#2A1500',
  orangeMid:   '#CC4400',
  white:       '#F5F5F0',
  textPrimary: '#F5F5F0',
  textSub:     '#9A9070',
  textMuted:   '#5A5040',
  success:     '#4CAF50',
  danger:      '#E53935',
  warning:     '#FFC107',
  info:        '#42A5F5',
};

type MXTab = 'home' | 'find' | 'fix_prep' | 'list_sell' | 'profits' | 'insights';

const TABS: Array<{ id: MXTab; label: string; icon: string }> = [
  { id: 'find',      label: 'Find',      icon: 'search'          },
  { id: 'fix_prep',  label: 'Fix & Prep', icon: 'build'          },
  { id: 'list_sell', label: 'List & Sell', icon: 'sell'          },
  { id: 'profits',   label: 'Profits',   icon: 'bar-chart'       },
  { id: 'insights',  label: 'Insights',  icon: 'psychology'      },
];

const BIKE_TYPES = [
  { id: 'motocross', label: 'Motocross', sub: 'SX · MX · Indoor' },
  { id: 'enduro', label: 'Enduro', sub: 'XC · XCW · Trail' },
  { id: 'supermoto', label: 'Supermoto', sub: 'Road · Track' },
  { id: 'pit_bike', label: 'Pit Bike', sub: 'Mini · 50cc · 110cc' },
  { id: 'vintage', label: 'Vintage', sub: 'Pre-2000 · Classic' },
  { id: 'electric', label: 'Electric', sub: 'KTM Freeride · Sur-Ron' },
];

const MANUFACTURERS = ['KTM', 'Husqvarna', 'Yamaha', 'Honda', 'Kawasaki', 'Suzuki', 'Beta', 'Sherco', 'Gas Gas', 'TM'];

// ── Flip Score circle ─────────────────────────────────────────────────────────
function FlipScore({ score }: { score: number }) {
  const color = score >= 80 ? MX.success : score >= 60 ? MX.warning : MX.danger;
  const label = score >= 80 ? 'BUY' : score >= 60 ? 'MAYBE' : 'PASS';
  return (
    <View style={[fs.circle, { borderColor: color }]}>
      <Text style={[fs.score, { color }]}>{score}</Text>
      <Text style={fs.outOf}>/100</Text>
      <View style={[fs.badge, { backgroundColor: color }]}>
        <Text style={fs.badgeText}>{label}</Text>
      </View>
    </View>
  );
}
const fs = StyleSheet.create({
  circle: { width: 90, height: 90, borderRadius: 45, borderWidth: 3, alignItems: 'center', justifyContent: 'center', backgroundColor: MX.surfaceHigh, gap: 0 },
  score: { fontSize: 28, fontWeight: Typography.weight.extrabold, lineHeight: 32 },
  outOf: { fontSize: 10, color: MX.textMuted },
  badge: { borderRadius: Radius.pill, paddingHorizontal: 8, paddingVertical: 2, marginTop: 2 },
  badgeText: { fontSize: 9, fontWeight: Typography.weight.extrabold, color: '#fff', letterSpacing: 0.5 },
});

// ── Condition bar ─────────────────────────────────────────────────────────────
function ConditionBar({ label, status }: { label: string; status: 'good' | 'fair' | 'poor' | 'replace' }) {
  const colors = { good: MX.success, fair: MX.warning, poor: MX.danger, replace: '#FF1744' };
  const widths = { good: '85%', fair: '55%', poor: '30%', replace: '15%' };
  return (
    <View style={cb.row}>
      <View style={cb.iconWrap}>
        <MaterialIcons name="settings" size={12} color={MX.textMuted} />
      </View>
      <Text style={cb.label}>{label}</Text>
      <View style={cb.track}>
        <View style={[cb.fill, { width: widths[status] as any, backgroundColor: colors[status] }]} />
      </View>
      <Text style={[cb.status, { color: colors[status] }]}>{status.charAt(0).toUpperCase() + status.slice(1)}</Text>
    </View>
  );
}
const cb = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: 5 },
  iconWrap: { width: 20, alignItems: 'center' },
  label: { flex: 1, fontSize: Typography.size.sm, color: MX.textPrimary },
  track: { width: 80, height: 6, backgroundColor: MX.surfaceHigh, borderRadius: Radius.pill, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: Radius.pill },
  status: { width: 50, fontSize: 10, fontWeight: Typography.weight.semibold, textAlign: 'right' },
});

// ── Paywall ───────────────────────────────────────────────────────────────────
function MXPaywall({ onBack }: { onBack: () => void }) {
  const insets = useSafeAreaInsets();
  const { showAlert } = useAlert();
  const [upgrading, setUpgrading] = useState(false);

  const handleUpgrade = useCallback(async () => {
    setUpgrading(true);
    const { error } = await startCheckout('motocross');
    setUpgrading(false);
    if (error) showAlert('Checkout Failed', error);
  }, [showAlert]);

  const FEATURES = [
    { icon: 'psychology', label: 'Custom & modded bike engine' },
    { icon: 'build', label: 'Repair cost database' },
    { icon: 'bar-chart', label: 'Real market values from eBay' },
    { icon: 'sell', label: 'Advanced eBay listing tools' },
    { icon: 'construction', label: 'Build & modification analysis' },
    { icon: 'auto-awesome', label: 'AI insights & recommendations' },
  ];

  return (
    <View style={[pw.container, { paddingTop: insets.top }]}>
      <StatusBar style="light" />
      <View style={pw.header}>
        <Pressable onPress={onBack} style={pw.backBtn} hitSlop={8}>
          <MaterialIcons name="arrow-back" size={20} color={MX.orange} />
        </Pressable>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={pw.title}>FLIPPER MX</Text>
          <Text style={pw.sub}>PRO</Text>
        </View>
        <View style={{ width: 36 }} />
      </View>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[pw.content, { paddingBottom: insets.bottom + 40 }]}>
        <View style={pw.hero}>
          <View style={pw.heroIcon}>
            <MaterialIcons name="two-wheeler" size={48} color={MX.orange} />
          </View>
          <Text style={pw.heroTitle}>DIRT BIKES.</Text>
          <Text style={pw.heroTitle}>REAL DATA.</Text>
          <Text style={[pw.heroTitle, { color: MX.orange }]}>BIGGER PROFITS.</Text>
          <Text style={pw.heroTagline}>FIND {'>'} FIX {'>'} FLIP {'>'} REPEAT</Text>
        </View>
        <Pressable
          onPress={handleUpgrade}
          disabled={upgrading}
          style={({ pressed }) => [pw.upgradeBtn, pressed && { opacity: 0.88 }]}
        >
          <MaterialIcons name="workspace-premium" size={18} color={MX.black} />
          <View>
            <Text style={pw.upgradeBtnText}>{upgrading ? 'Opening checkout…' : 'Upgrade to Flipper MX Pro'}</Text>
            <Text style={pw.upgradeBtnSub}>£9.99 / month · Cancel any time</Text>
          </View>
          {upgrading ? <ActivityIndicator size="small" color={MX.black} style={{ marginLeft: 'auto' }} /> : <MaterialIcons name="arrow-forward" size={16} color={MX.black} style={{ marginLeft: 'auto' }} />}
        </Pressable>
        <View style={pw.featureCard}>
          <Text style={pw.featureTitle}>WHAT IS INCLUDED</Text>
          {FEATURES.map((f, i) => (
            <View key={f.label}>
              {i > 0 ? <View style={{ height: 1, backgroundColor: MX.border }} /> : null}
              <View style={pw.featureRow}>
                <View style={pw.featureIcon}><MaterialIcons name={f.icon as any} size={15} color={MX.orange} /></View>
                <Text style={pw.featureLabel}>{f.label}</Text>
                <MaterialIcons name="check-circle" size={14} color={MX.success} />
              </View>
            </View>
          ))}
        </View>
        <View style={pw.brandsCard}>
          <Text style={pw.brandsTitle}>SUPPORTED BRANDS</Text>
          <View style={pw.brandChips}>
            {MANUFACTURERS.map(m => (
              <View key={m} style={pw.brandChip}><Text style={pw.brandChipText}>{m}</Text></View>
            ))}
          </View>
        </View>
        <Pressable onPress={onBack} style={pw.cancelBtn}>
          <Text style={pw.cancelText}>Go Back</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const pw = StyleSheet.create({
  container: { flex: 1, backgroundColor: MX.black },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.base, paddingVertical: Spacing.md, borderBottomWidth: 1, borderBottomColor: MX.border },
  backBtn: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: MX.orangeDim, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: MX.orange + '30' },
  title: { fontSize: Typography.size.lg, fontWeight: Typography.weight.extrabold, color: MX.orange, letterSpacing: 2 },
  sub: { fontSize: 9, color: MX.orange + 'AA', letterSpacing: 3 },
  content: { padding: Spacing.base, gap: Spacing.xl },
  hero: { alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.xl },
  heroIcon: { width: 90, height: 90, borderRadius: 45, backgroundColor: MX.orangeDim, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: MX.orange + '40', marginBottom: Spacing.md },
  heroTitle: { fontSize: Typography.size.xxl, fontWeight: Typography.weight.extrabold, color: MX.white, textAlign: 'center' },
  heroTagline: { fontSize: 11, color: MX.textSub, letterSpacing: 2, marginTop: 4 },
  upgradeBtn: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: MX.orange, borderRadius: Radius.xxl, paddingVertical: Spacing.base, paddingHorizontal: Spacing.xl, shadowColor: MX.orange, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.45, shadowRadius: 16, elevation: 8 },
  upgradeBtnText: { fontSize: Typography.size.base, fontWeight: Typography.weight.extrabold, color: MX.black },
  upgradeBtnSub: { fontSize: Typography.size.xs, color: MX.black + 'AA' },
  featureCard: { backgroundColor: MX.surface, borderRadius: Radius.xxl, borderWidth: 1, borderColor: MX.border, overflow: 'hidden' },
  featureTitle: { fontSize: 9, fontWeight: Typography.weight.extrabold, color: MX.textMuted, textTransform: 'uppercase', letterSpacing: 0.8, padding: Spacing.md, backgroundColor: MX.surfaceHigh },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.md, paddingVertical: 12 },
  featureIcon: { width: 28, height: 28, borderRadius: Radius.sm, backgroundColor: MX.orangeDim, alignItems: 'center', justifyContent: 'center' },
  featureLabel: { flex: 1, fontSize: Typography.size.sm, color: MX.textPrimary },
  brandsCard: { gap: Spacing.sm },
  brandsTitle: { fontSize: 9, fontWeight: Typography.weight.extrabold, color: MX.textMuted, textTransform: 'uppercase', letterSpacing: 0.8 },
  brandChips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  brandChip: { paddingHorizontal: 10, paddingVertical: 5, backgroundColor: MX.surface, borderRadius: Radius.pill, borderWidth: 1, borderColor: MX.orange + '40' },
  brandChipText: { fontSize: Typography.size.xs, color: MX.orange, fontWeight: Typography.weight.semibold },
  cancelBtn: { alignItems: 'center', paddingVertical: Spacing.sm },
  cancelText: { fontSize: Typography.size.sm, color: MX.textMuted },
});

// ── Home Tab ──────────────────────────────────────────────────────────────────
function HomeTab({ isPremium, onTabSelect, onUpgrade, tenant }: { isPremium: boolean; onTabSelect: (t: MXTab) => void; onUpgrade: () => void; tenant: any }) {
  const router = useRouter();
  const [bikeCount, setBikeCount] = useState<number | null>(null);

  useEffect(() => {
    if (!tenant?.id) return;
    getSupabaseClient()
      .from('items').select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenant.id).eq('specialist_id', 'motocross')
      .then(({ count }) => setBikeCount(count ?? 0));
  }, [tenant?.id]);

  const FEATURES = [
    { label: 'Find a Bike', icon: 'search', tab: 'find' as MXTab, pro: false },
    { label: 'My Bikes', icon: 'two-wheeler', route: '/(tabs)/inventory', pro: false },
    { label: 'Fix & Prep', icon: 'build', tab: 'fix_prep' as MXTab, pro: false },
    { label: 'List & Sell', icon: 'sell', tab: 'list_sell' as MXTab, pro: false },
    { label: 'Profits', icon: 'bar-chart', tab: 'profits' as MXTab, pro: true },
    { label: 'Insights', icon: 'psychology', tab: 'insights' as MXTab, pro: true },
  ];

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={ht.content}>
      {/* Hero */}
      <View style={ht.hero}>
        <View style={ht.heroIcon}>
          <MaterialIcons name="two-wheeler" size={40} color={MX.orange} />
        </View>
        <View style={ht.heroText}>
          <Text style={ht.brandMX}>FLIPPER<Text style={{ color: MX.orange }}> MX</Text></Text>
          <Text style={ht.tagline}>FIND {'>'} FIX {'>'} FLIP {'>'} REPEAT</Text>
          <Text style={ht.subTagline}>DIRT BIKES • REAL DATA • BIGGER PROFITS</Text>
        </View>
        {isPremium ? <View style={ht.proBadge}><Text style={ht.proBadgeText}>PRO</Text></View> : null}
      </View>

      {/* Stats strip */}
      <View style={ht.statsStrip}>
        <View style={ht.stat}>
          <Text style={ht.statNum}>{bikeCount !== null ? bikeCount : '—'}</Text>
          <Text style={ht.statLabel}>Bikes in Stock</Text>
        </View>
        <View style={ht.statDivider} />
        <View style={ht.stat}>
          <Text style={[ht.statNum, { color: MX.orange }]}>£9.99</Text>
          <Text style={ht.statLabel}>Pro / Month</Text>
        </View>
        <View style={ht.statDivider} />
        <View style={ht.stat}>
          <Text style={[ht.statNum, { color: MX.success }]}>AI</Text>
          <Text style={ht.statLabel}>Powered</Text>
        </View>
      </View>

      {/* Feature grid */}
      <Text style={ht.sectionLabel}>TOOLS</Text>
      <View style={ht.grid}>
        {FEATURES.map(f => {
          const locked = f.pro && !isPremium;
          return (
            <Pressable
              key={f.label}
              onPress={() => {
                if (locked) { onUpgrade(); return; }
                if ((f as any).route) { router.push((f as any).route as any); return; }
                if (f.tab) onTabSelect(f.tab);
              }}
              style={({ pressed }) => [ht.gridItem, pressed && { opacity: 0.8, transform: [{ scale: 0.97 }] }]}
            >
              <View style={[ht.gridIcon, locked && { backgroundColor: MX.border }]}>
                <MaterialIcons name={locked ? 'lock' : f.icon as any} size={22} color={locked ? MX.textMuted : MX.orange} />
              </View>
              <Text style={[ht.gridLabel, locked && { color: MX.textMuted }]} numberOfLines={1}>{f.label}</Text>
              {locked ? <View style={ht.proTag}><Text style={ht.proTagText}>PRO</Text></View> : null}
            </Pressable>
          );
        })}
      </View>

      {/* Bike type browser */}
      <Text style={ht.sectionLabel}>BIKE TYPES</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={ht.bikeTypeRow}>
        {BIKE_TYPES.map(bt => (
          <Pressable
            key={bt.id}
            onPress={() => onTabSelect('find')}
            style={({ pressed }) => [ht.bikeTypeCard, pressed && { opacity: 0.82 }]}
          >
            <MaterialIcons name="two-wheeler" size={20} color={MX.orange} />
            <Text style={ht.bikeTypeLabel}>{bt.label}</Text>
            <Text style={ht.bikeTypeSub}>{bt.sub}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* Upgrade or pro banner */}
      {!isPremium ? (
        <Pressable onPress={onUpgrade} style={({ pressed }) => [ht.upgradeBanner, pressed && { opacity: 0.88 }]}>
          <MaterialIcons name="workspace-premium" size={18} color={MX.black} />
          <View style={{ flex: 1 }}>
            <Text style={ht.upgradeBannerText}>Upgrade to Flipper MX Pro</Text>
            <Text style={ht.upgradeBannerSub}>Custom builds · Repair database · Advanced listing tools</Text>
          </View>
          <Text style={ht.upgradeBannerPrice}>£9.99/mo</Text>
        </Pressable>
      ) : (
        <View style={ht.proConfirmed}>
          <MaterialIcons name="workspace-premium" size={15} color={MX.orange} />
          <Text style={ht.proConfirmedText}>Flipper MX Pro — all features unlocked</Text>
        </View>
      )}
    </ScrollView>
  );
}

const ht = StyleSheet.create({
  content: { padding: Spacing.base, gap: Spacing.lg, paddingBottom: 40 },
  sectionLabel: { fontSize: 9, fontWeight: Typography.weight.extrabold, color: MX.textMuted, textTransform: 'uppercase', letterSpacing: 0.8 },
  hero: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: MX.surface, borderRadius: Radius.xxl, padding: Spacing.base, borderWidth: 1, borderColor: MX.orange + '40' },
  heroIcon: { width: 64, height: 64, borderRadius: Radius.lg, backgroundColor: MX.orangeDim, alignItems: 'center', justifyContent: 'center' },
  heroText: { flex: 1, gap: 2 },
  brandMX: { fontSize: 20, fontWeight: Typography.weight.extrabold, color: MX.white, letterSpacing: 1 },
  tagline: { fontSize: 10, color: MX.textSub, letterSpacing: 1 },
  subTagline: { fontSize: 8, color: MX.orange + '80', letterSpacing: 0.5, marginTop: 2 },
  proBadge: { backgroundColor: MX.orange, borderRadius: Radius.pill, paddingHorizontal: 8, paddingVertical: 3 },
  proBadgeText: { fontSize: 8, fontWeight: Typography.weight.extrabold, color: MX.black, letterSpacing: 1 },
  statsStrip: { flexDirection: 'row', backgroundColor: MX.surface, borderRadius: Radius.xl, borderWidth: 1, borderColor: MX.border, padding: Spacing.md, alignItems: 'center' },
  stat: { flex: 1, alignItems: 'center', gap: 2 },
  statNum: { fontSize: Typography.size.xl, fontWeight: Typography.weight.extrabold, color: MX.white },
  statLabel: { fontSize: 9, color: MX.textMuted, textTransform: 'uppercase', letterSpacing: 0.3 },
  statDivider: { width: 1, height: 32, backgroundColor: MX.border },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  gridItem: { width: '31%', backgroundColor: MX.surface, borderRadius: Radius.xl, padding: Spacing.md, alignItems: 'center', gap: 6, borderWidth: 1, borderColor: MX.border, aspectRatio: 1, justifyContent: 'center' },
  gridIcon: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: MX.orangeDim, alignItems: 'center', justifyContent: 'center' },
  gridLabel: { fontSize: 9, fontWeight: Typography.weight.bold, color: MX.textPrimary, textAlign: 'center' },
  proTag: { backgroundColor: MX.orangeDim, borderRadius: Radius.pill, paddingHorizontal: 5, paddingVertical: 2 },
  proTagText: { fontSize: 7, fontWeight: Typography.weight.extrabold, color: MX.orange, letterSpacing: 0.5 },
  bikeTypeRow: { paddingVertical: Spacing.xs, gap: Spacing.sm },
  bikeTypeCard: { backgroundColor: MX.surface, borderRadius: Radius.xl, padding: Spacing.md, gap: 4, alignItems: 'center', width: 90, borderWidth: 1, borderColor: MX.border },
  bikeTypeLabel: { fontSize: Typography.size.xs, fontWeight: Typography.weight.bold, color: MX.textPrimary, textAlign: 'center' },
  bikeTypeSub: { fontSize: 8, color: MX.textMuted, textAlign: 'center', lineHeight: 12 },
  upgradeBanner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: MX.orange, borderRadius: Radius.xxl, paddingVertical: Spacing.base, paddingHorizontal: Spacing.lg, shadowColor: MX.orange, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.4, shadowRadius: 14, elevation: 6 },
  upgradeBannerText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.extrabold, color: MX.black },
  upgradeBannerSub: { fontSize: 10, color: MX.black + 'AA' },
  upgradeBannerPrice: { fontSize: Typography.size.base, fontWeight: Typography.weight.extrabold, color: MX.black },
  proConfirmed: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: MX.orangeDim, borderRadius: Radius.xl, padding: Spacing.md, borderWidth: 1, borderColor: MX.orange + '40' },
  proConfirmedText: { fontSize: Typography.size.sm, color: MX.orange, fontWeight: Typography.weight.semibold },
});

// ── Find Tab ──────────────────────────────────────────────────────────────────
function FindTab({ onTabSelect }: { onTabSelect: (t: MXTab) => void }) {
  const router = useRouter();
  const CAPTURE_METHODS = [
    { icon: 'photo-camera', label: 'Photo', desc: 'Photograph the bike' },
    { icon: 'image', label: 'Screenshot', desc: 'Import a listing screenshot' },
    { icon: 'link', label: 'Link', desc: 'eBay / Facebook URL' },
    { icon: 'edit', label: 'Manual', desc: 'Enter details manually' },
  ];
  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={ft.content}>
      <View style={ft.hero}>
        <MaterialIcons name="search" size={32} color={MX.orange} />
        <View style={{ flex: 1 }}>
          <Text style={ft.heroTitle}>Find a Bike</Text>
          <Text style={ft.heroSub}>Photograph or import a listing — AI identifies make, model, year and gives you a Flip Score</Text>
        </View>
      </View>
      <Text style={ft.sectionLabel}>HOW TO ADD A BIKE</Text>
      <View style={ft.methodGrid}>
        {CAPTURE_METHODS.map(m => (
          <Pressable
            key={m.label}
            onPress={() => router.navigate('/(tabs)/scan')}
            style={({ pressed }) => [ft.methodCard, pressed && { opacity: 0.82, transform: [{ scale: 0.98 }] }]}
          >
            <View style={ft.methodIcon}><MaterialIcons name={m.icon as any} size={24} color={MX.orange} /></View>
            <Text style={ft.methodLabel}>{m.label}</Text>
            <Text style={ft.methodDesc}>{m.desc}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={ft.sectionLabel}>WHAT THE AI IDENTIFIES</Text>
      <View style={ft.aiCard}>
        {[
          'Manufacturer from tank badge & shroud graphics',
          'Model family (SX vs XCW vs enduro vs pit bike)',
          'Year range from plastics generation & graphics',
          'Engine size from visible decals & displacement badges',
          '2-stroke vs 4-stroke from exhaust configuration',
          'Visible frame/VIN numbers (copied exactly)',
          'Running status from available evidence',
          'Visible modifications & aftermarket parts',
          'Condition: frame, forks, plastics, wheels, tyres',
        ].map((item, i) => (
          <View key={i} style={ft.aiRow}>
            <MaterialIcons name="check-circle" size={12} color={MX.orange} />
            <Text style={ft.aiText}>{item}</Text>
          </View>
        ))}
      </View>
      <View style={ft.flipScoreDemo}>
        <Text style={ft.sectionLabel}>FLIP SCORE — WHAT IT MEANS</Text>
        <View style={{ flexDirection: 'row', gap: Spacing.md, marginTop: Spacing.sm }}>
          {[{ score: 86, label: 'Good buy' }, { score: 62, label: 'Negotiate hard' }, { score: 38, label: 'Risky — pass' }].map(s => (
            <View key={s.score} style={{ alignItems: 'center', gap: 6, flex: 1 }}>
              <FlipScore score={s.score} />
              <Text style={{ fontSize: 10, color: MX.textSub, textAlign: 'center' }}>{s.label}</Text>
            </View>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}
const ft = StyleSheet.create({
  content: { padding: Spacing.base, gap: Spacing.lg, paddingBottom: 40 },
  sectionLabel: { fontSize: 9, fontWeight: Typography.weight.extrabold, color: MX.textMuted, textTransform: 'uppercase', letterSpacing: 0.8 },
  hero: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: MX.surface, borderRadius: Radius.xl, padding: Spacing.base, borderWidth: 1, borderColor: MX.orange + '30' },
  heroTitle: { fontSize: Typography.size.xl, fontWeight: Typography.weight.extrabold, color: MX.white },
  heroSub: { fontSize: Typography.size.xs, color: MX.textSub, lineHeight: 17, marginTop: 3 },
  methodGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  methodCard: { width: '48%', backgroundColor: MX.surface, borderRadius: Radius.xl, padding: Spacing.base, gap: Spacing.sm, borderWidth: 1, borderColor: MX.border },
  methodIcon: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: MX.orangeDim, alignItems: 'center', justifyContent: 'center' },
  methodLabel: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: MX.white },
  methodDesc: { fontSize: Typography.size.xs, color: MX.textSub },
  aiCard: { backgroundColor: MX.surface, borderRadius: Radius.xl, padding: Spacing.base, gap: Spacing.sm, borderWidth: 1, borderColor: MX.border },
  aiRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  aiText: { flex: 1, fontSize: Typography.size.xs, color: MX.textSub, lineHeight: 17 },
  flipScoreDemo: { backgroundColor: MX.surface, borderRadius: Radius.xl, padding: Spacing.base, borderWidth: 1, borderColor: MX.border },
});

// ── Fix & Prep Tab ────────────────────────────────────────────────────────────
function FixPrepTab() {
  const CHECKLIST = [
    { label: 'Engine', status: 'fair' as const },
    { label: 'Frame', status: 'good' as const },
    { label: 'Suspension', status: 'fair' as const },
    { label: 'Plastics', status: 'good' as const },
    { label: 'Brakes', status: 'poor' as const },
    { label: 'Wheels', status: 'good' as const },
    { label: 'Chain & Sprockets', status: 'replace' as const },
    { label: 'Electrics', status: 'fair' as const },
  ];
  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={fx.content}>
      <View style={fx.header}>
        <MaterialIcons name="build" size={28} color={MX.orange} />
        <View style={{ flex: 1 }}>
          <Text style={fx.headerTitle}>Fix & Prep</Text>
          <Text style={fx.headerSub}>Condition assessment · Repair costs · Parts links</Text>
        </View>
      </View>
      <Text style={fx.sectionLabel}>CONDITION ASSESSMENT TEMPLATE</Text>
      <View style={fx.checkCard}>
        <Text style={fx.checkCardTitle}>Example — 2018 KTM 250 SX-F</Text>
        {CHECKLIST.map(item => <ConditionBar key={item.label} label={item.label} status={item.status} />)}
      </View>
      <View style={fx.costsCard}>
        <Text style={fx.sectionLabel}>ESTIMATED REPAIR COSTS</Text>
        {[
          { label: 'Brake pads front & rear', cost: '£45' },
          { label: 'Chain & sprocket kit', cost: '£120' },
          { label: 'Suspension service', cost: '£180' },
          { label: 'Air filter & oil', cost: '£30' },
        ].map(item => (
          <View key={item.label} style={fx.costRow}>
            <Text style={fx.costLabel}>{item.label}</Text>
            <Text style={fx.costValue}>{item.cost}</Text>
          </View>
        ))}
        <View style={[fx.costRow, fx.totalRow]}>
          <Text style={[fx.costLabel, { fontWeight: Typography.weight.bold, color: MX.white }]}>Total Estimate</Text>
          <Text style={[fx.costValue, { color: MX.orange, fontSize: Typography.size.base }]}>£375</Text>
        </View>
      </View>
      <View style={fx.infoCard}>
        <MaterialIcons name="info-outline" size={14} color={MX.orange} />
        <Text style={fx.infoText}>
          Scan a bike first to generate a personalised Fix & Prep checklist with AI-assessed condition ratings and estimated repair costs.
        </Text>
      </View>
    </ScrollView>
  );
}
const fx = StyleSheet.create({
  content: { padding: Spacing.base, gap: Spacing.lg, paddingBottom: 40 },
  sectionLabel: { fontSize: 9, fontWeight: Typography.weight.extrabold, color: MX.textMuted, textTransform: 'uppercase', letterSpacing: 0.8 },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: MX.surface, borderRadius: Radius.xl, padding: Spacing.base, borderWidth: 1, borderColor: MX.orange + '30' },
  headerTitle: { fontSize: Typography.size.xl, fontWeight: Typography.weight.extrabold, color: MX.white },
  headerSub: { fontSize: Typography.size.xs, color: MX.textSub, marginTop: 2 },
  checkCard: { backgroundColor: MX.surface, borderRadius: Radius.xl, padding: Spacing.base, borderWidth: 1, borderColor: MX.border },
  checkCardTitle: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: MX.orange, marginBottom: Spacing.sm },
  costsCard: { backgroundColor: MX.surface, borderRadius: Radius.xl, padding: Spacing.base, gap: Spacing.sm, borderWidth: 1, borderColor: MX.border },
  costRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: MX.border + '60' },
  totalRow: { borderBottomWidth: 0, marginTop: 4, paddingTop: 8, borderTopWidth: 1, borderTopColor: MX.border },
  costLabel: { fontSize: Typography.size.sm, color: MX.textSub },
  costValue: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: MX.white },
  infoCard: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, backgroundColor: MX.orangeDim, borderRadius: Radius.md, padding: Spacing.md, borderWidth: 1, borderColor: MX.orange + '25' },
  infoText: { flex: 1, fontSize: Typography.size.xs, color: MX.orange, lineHeight: 17 },
});

// ── List & Sell Tab ───────────────────────────────────────────────────────────
function ListSellTab() {
  const router = useRouter();
  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={ls.content}>
      <View style={ls.header}>
        <MaterialIcons name="sell" size={28} color={MX.orange} />
        <View style={{ flex: 1 }}>
          <Text style={ls.headerTitle}>List & Sell</Text>
          <Text style={ls.headerSub}>eBay-ready listings · Photo optimiser · Listing templates</Text>
        </View>
      </View>
      {[
        { icon: 'receipt-long', label: 'All Listings', sub: 'Manage your active and draft eBay listings', color: '#E53238', route: '/(tabs)/listings' as any },
        { icon: 'inventory-2', label: 'Bike Inventory', sub: 'All MX bikes in stock', color: MX.orange, route: '/(tabs)/inventory' as any },
        { icon: 'local-shipping', label: 'Orders & Dispatch', sub: 'Manage and fulfil buyer orders', color: Colors.info, route: '/orders' as any },
        { icon: 'storefront', label: 'eBay Hub', sub: 'Full seller hub — messages, finances, returns', color: '#E53238', route: '/ebay-hub' as any },
      ].map(item => (
        <Pressable key={item.label} onPress={() => router.push(item.route)} style={({ pressed }) => [ls.actionCard, pressed && { opacity: 0.85 }]}>
          <View style={[ls.actionIcon, { backgroundColor: item.color + '20' }]}><MaterialIcons name={item.icon as any} size={22} color={item.color} /></View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={ls.actionLabel}>{item.label}</Text>
            <Text style={ls.actionSub}>{item.sub}</Text>
          </View>
          <MaterialIcons name="chevron-right" size={16} color={MX.textMuted} />
        </Pressable>
      ))}
      <View style={ls.tipsCard}>
        <Text style={ls.tipsTitle}>MX LISTING TIPS</Text>
        {[
          'Always state running status prominently — it is the #1 buyer question',
          'Include year range not just one year if uncertain',
          'List modifications separately — buyers search for aftermarket parts',
          'Service history and receipts significantly increase sale price',
          'Free delivery attracts more watchers on sub-£500 bikes',
          'eBay Motors section performs better than general for MX bikes',
        ].map((tip, i) => (
          <View key={i} style={ls.tip}>
            <View style={[ls.tipDot, { backgroundColor: MX.orange }]} />
            <Text style={ls.tipText}>{tip}</Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}
const ls = StyleSheet.create({
  content: { padding: Spacing.base, gap: Spacing.md, paddingBottom: 40 },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: MX.surface, borderRadius: Radius.xl, padding: Spacing.base, borderWidth: 1, borderColor: MX.orange + '30' },
  headerTitle: { fontSize: Typography.size.xl, fontWeight: Typography.weight.extrabold, color: MX.white },
  headerSub: { fontSize: Typography.size.xs, color: MX.textSub, marginTop: 2 },
  actionCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: MX.surface, borderRadius: Radius.xl, padding: Spacing.base, borderWidth: 1, borderColor: MX.border },
  actionIcon: { width: 48, height: 48, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  actionLabel: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: MX.white },
  actionSub: { fontSize: Typography.size.xs, color: MX.textSub },
  tipsCard: { backgroundColor: MX.surface, borderRadius: Radius.xl, borderWidth: 1, borderColor: MX.border, overflow: 'hidden' },
  tipsTitle: { fontSize: 9, fontWeight: Typography.weight.extrabold, color: MX.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, padding: Spacing.md, backgroundColor: MX.surfaceHigh },
  tip: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, paddingHorizontal: Spacing.md, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: MX.border + '60' },
  tipDot: { width: 5, height: 5, borderRadius: 3, marginTop: 5, flexShrink: 0 },
  tipText: { flex: 1, fontSize: Typography.size.xs, color: MX.textSub, lineHeight: 17 },
});

// ── Profits Tab ───────────────────────────────────────────────────────────────
function ProfitsTab({ tenant }: { tenant: any }) {
  const router = useRouter();
  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={pr.content}>
      <View style={pr.header}>
        <MaterialIcons name="bar-chart" size={28} color={MX.orange} />
        <View style={{ flex: 1 }}>
          <Text style={pr.headerTitle}>Profits</Text>
          <Text style={pr.headerSub}>Profit calculator · Track performance · Real market data</Text>
        </View>
      </View>
      {[
        { icon: 'account-balance-wallet', label: 'P&L Dashboard', sub: 'Revenue, costs and net profit', color: MX.orange, route: '/money' as any },
        { icon: 'trending-up', label: 'Business Insights', sub: 'Performance trends and recommendations', color: Colors.info, route: '/money' as any },
        { icon: 'price-change', label: 'Repricing Engine', sub: 'Auto-adjust listing prices to market', color: Colors.warning, route: '/repricing' as any },
      ].map(item => (
        <Pressable key={item.label} onPress={() => router.push(item.route)} style={({ pressed }) => [pr.card, pressed && { opacity: 0.85 }]}>
          <View style={[pr.cardIcon, { backgroundColor: item.color + '20' }]}><MaterialIcons name={item.icon as any} size={22} color={item.color} /></View>
          <View style={{ flex: 1 }}>
            <Text style={pr.cardLabel}>{item.label}</Text>
            <Text style={pr.cardSub}>{item.sub}</Text>
          </View>
          <MaterialIcons name="chevron-right" size={16} color={MX.textMuted} />
        </Pressable>
      ))}
      <View style={pr.calcCard}>
        <Text style={pr.calcTitle}>PROFIT CALCULATOR EXAMPLE</Text>
        {[
          { label: 'Purchase Price', value: '£2,450', color: MX.white },
          { label: 'Repair Estimate', value: '£180', color: MX.white },
          { label: 'Total Investment', value: '£2,630', color: MX.white },
          { label: 'Likely Selling Price', value: '£3,150', color: MX.white },
          { label: 'eBay Fees (~12%)', value: '£378', color: MX.danger },
          { label: 'Expected Profit', value: '£142', color: MX.success },
        ].map(row => (
          <View key={row.label} style={pr.calcRow}>
            <Text style={pr.calcLabel}>{row.label}</Text>
            <Text style={[pr.calcValue, { color: row.color }]}>{row.value}</Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}
const pr = StyleSheet.create({
  content: { padding: Spacing.base, gap: Spacing.md, paddingBottom: 40 },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: MX.surface, borderRadius: Radius.xl, padding: Spacing.base, borderWidth: 1, borderColor: MX.orange + '30' },
  headerTitle: { fontSize: Typography.size.xl, fontWeight: Typography.weight.extrabold, color: MX.white },
  headerSub: { fontSize: Typography.size.xs, color: MX.textSub, marginTop: 2 },
  card: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: MX.surface, borderRadius: Radius.xl, padding: Spacing.base, borderWidth: 1, borderColor: MX.border },
  cardIcon: { width: 48, height: 48, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  cardLabel: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: MX.white },
  cardSub: { fontSize: Typography.size.xs, color: MX.textSub, marginTop: 2 },
  calcCard: { backgroundColor: MX.surface, borderRadius: Radius.xl, padding: Spacing.base, borderWidth: 1, borderColor: MX.border },
  calcTitle: { fontSize: 9, fontWeight: Typography.weight.extrabold, color: MX.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: Spacing.md },
  calcRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: MX.border + '60' },
  calcLabel: { fontSize: Typography.size.sm, color: MX.textSub },
  calcValue: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold },
});

// ── Insights Tab ──────────────────────────────────────────────────────────────
function InsightsTab({ tenant }: { tenant: any }) {
  const router = useRouter();
  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={ins.content}>
      <View style={ins.header}>
        <MaterialIcons name="psychology" size={28} color={MX.orange} />
        <View style={{ flex: 1 }}>
          <Text style={ins.headerTitle}>Insights</Text>
          <Text style={ins.headerSub}>Price trends · Buying opportunities · AI recommendations</Text>
        </View>
      </View>
      {[
        { icon: 'trending-up', label: 'Market Trends', sub: 'Which bikes are trending up or down on eBay', color: Colors.info, route: '/money' as any },
        { icon: 'auto-awesome', label: 'AI Recommendations', sub: 'SWISH intelligence — what to buy, fix, sell now', color: MX.orange, route: '/command-centre' as any },
        { icon: 'inventory-2', label: 'My Bikes', sub: 'Days in stock, target price, potential profit', color: MX.success, route: '/(tabs)/inventory' as any },
      ].map(item => (
        <Pressable key={item.label} onPress={() => router.push(item.route)} style={({ pressed }) => [ins.card, pressed && { opacity: 0.85 }]}>
          <View style={[ins.cardIcon, { backgroundColor: item.color + '20' }]}><MaterialIcons name={item.icon as any} size={22} color={item.color} /></View>
          <View style={{ flex: 1 }}>
            <Text style={ins.cardLabel}>{item.label}</Text>
            <Text style={ins.cardSub}>{item.sub}</Text>
          </View>
          <MaterialIcons name="chevron-right" size={16} color={MX.textMuted} />
        </Pressable>
      ))}
      <View style={ins.factCard}>
        <Text style={ins.factTitle}>MX MARKET FACTS</Text>
        {[
          'Running vs non-running bikes differ by 40-60% in value',
          'KTM and Husqvarna consistently command premium prices',
          '4-stroke 250-450cc bikes have the largest buyer pool',
          'Bikes with service history sell faster at higher prices',
          'Spring (Mar-May) is peak buying season — stock up in winter',
          'Aftermarket exhaust (FMF/Akrapovic) adds perceived value',
        ].map((fact, i) => (
          <View key={i} style={ins.factRow}>
            <MaterialIcons name="lightbulb-outline" size={12} color={MX.orange} />
            <Text style={ins.factText}>{fact}</Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}
const ins = StyleSheet.create({
  content: { padding: Spacing.base, gap: Spacing.md, paddingBottom: 40 },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: MX.surface, borderRadius: Radius.xl, padding: Spacing.base, borderWidth: 1, borderColor: MX.orange + '30' },
  headerTitle: { fontSize: Typography.size.xl, fontWeight: Typography.weight.extrabold, color: MX.white },
  headerSub: { fontSize: Typography.size.xs, color: MX.textSub, marginTop: 2 },
  card: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: MX.surface, borderRadius: Radius.xl, padding: Spacing.base, borderWidth: 1, borderColor: MX.border },
  cardIcon: { width: 48, height: 48, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  cardLabel: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: MX.white },
  cardSub: { fontSize: Typography.size.xs, color: MX.textSub, marginTop: 2 },
  factCard: { backgroundColor: MX.surface, borderRadius: Radius.xl, padding: Spacing.base, gap: Spacing.sm, borderWidth: 1, borderColor: MX.border },
  factTitle: { fontSize: 9, fontWeight: Typography.weight.extrabold, color: MX.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  factRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  factText: { flex: 1, fontSize: Typography.size.xs, color: MX.textSub, lineHeight: 17 },
});

// ── Main Screen ───────────────────────────────────────────────────────────────
export default function FlipperMXScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { tenant } = useApp();
  const { isPremium } = useSubscription();
  const [activeTab, setActiveTab] = useState<MXTab>('home');
  const [showPaywall, setShowPaywall] = useState(false);

  const handleTabSelect = useCallback((tab: MXTab) => {
    const premiumTabs: MXTab[] = ['profits', 'insights'];
    if (premiumTabs.includes(tab) && !isPremium) { setShowPaywall(true); return; }
    setActiveTab(tab);
  }, [isPremium]);

  if (showPaywall) return <MXPaywall onBack={() => setShowPaywall(false)} />;

  return (
    <View style={main.container}>
      <StatusBar style="light" />
      {/* Header */}
      <View style={[main.header, { paddingTop: insets.top + Spacing.sm }]}>
        <Pressable onPress={() => router.back()} style={main.backBtn} hitSlop={8}>
          <MaterialIcons name="arrow-back" size={20} color={MX.orange} />
        </Pressable>
        <Pressable onPress={() => setActiveTab('home')} style={main.logoArea} hitSlop={4}>
          <View style={main.logoIcon}><MaterialIcons name="two-wheeler" size={14} color={MX.orange} /></View>
          <View>
            <Text style={main.logoText}>FLIPPER<Text style={{ color: MX.orange }}> MX</Text></Text>
            <Text style={main.logoSub}>FIND • FIX • FLIP • REPEAT</Text>
          </View>
          {isPremium ? <View style={main.proBadge}><Text style={main.proBadgeText}>PRO</Text></View> : null}
        </Pressable>
        <Pressable onPress={() => router.push('/(tabs)/inventory' as any)} style={main.myBtn} hitSlop={6}>
          <MaterialIcons name="two-wheeler" size={16} color={MX.orange} />
        </Pressable>
      </View>
      {/* Tab bar */}
      <View style={main.tabBar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={main.tabBarContent}>
          {TABS.map(tab => {
            const active = activeTab === tab.id;
            const locked = ['profits', 'insights'].includes(tab.id) && !isPremium;
            return (
              <Pressable key={tab.id} onPress={() => handleTabSelect(tab.id)} style={[main.tabItem, active && main.tabItemActive]}>
                <MaterialIcons name={(locked ? 'lock' : tab.icon) as any} size={14} color={active ? MX.orange : locked ? MX.textMuted : MX.textSub} />
                <Text style={[main.tabLabel, active && main.tabLabelActive, locked && { color: MX.textMuted }]}>{tab.label}</Text>
                {locked ? <View style={main.tabProPip} /> : null}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
      {/* Content */}
      <View style={{ flex: 1 }}>
        {activeTab === 'home' ? <HomeTab isPremium={isPremium} onTabSelect={handleTabSelect} onUpgrade={() => setShowPaywall(true)} tenant={tenant} /> : null}
        {activeTab === 'find' ? <FindTab onTabSelect={handleTabSelect} /> : null}
        {activeTab === 'fix_prep' ? <FixPrepTab /> : null}
        {activeTab === 'list_sell' ? <ListSellTab /> : null}
        {activeTab === 'profits' ? <ProfitsTab tenant={tenant} /> : null}
        {activeTab === 'insights' ? <InsightsTab tenant={tenant} /> : null}
      </View>
      {/* Upgrade bar */}
      {!isPremium && activeTab !== 'home' ? (
        <View style={[main.upgradeBar, { paddingBottom: insets.bottom + 4 }]}>
          <MaterialIcons name="workspace-premium" size={13} color={MX.black} />
          <Text style={main.upgradeBarText}>Upgrade to Flipper MX Pro</Text>
          <Pressable onPress={() => setShowPaywall(true)} style={main.upgradeBarBtn}>
            <Text style={main.upgradeBarBtnText}>£9.99/mo</Text>
          </Pressable>
        </View>
      ) : <View style={{ height: insets.bottom }} />}
    </View>
  );
}

const main = StyleSheet.create({
  container: { flex: 1, backgroundColor: MX.black },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.base, paddingBottom: Spacing.sm, borderBottomWidth: 1, borderBottomColor: MX.border },
  backBtn: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: MX.orangeDim, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: MX.orange + '30' },
  logoArea: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginLeft: 2 },
  logoIcon: { width: 28, height: 28, borderRadius: 14, backgroundColor: MX.orangeDim, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: MX.orange + '50' },
  logoText: { fontSize: 14, fontWeight: Typography.weight.extrabold, color: MX.white, letterSpacing: 0.5 },
  logoSub: { fontSize: 7, color: MX.textMuted, letterSpacing: 0.8 },
  proBadge: { backgroundColor: MX.orange, borderRadius: Radius.pill, paddingHorizontal: 6, paddingVertical: 2 },
  proBadgeText: { fontSize: 7, fontWeight: Typography.weight.extrabold, color: MX.black, letterSpacing: 1 },
  myBtn: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: MX.orangeDim, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: MX.orange + '30' },
  tabBar: { backgroundColor: MX.surface, borderBottomWidth: 1, borderBottomColor: MX.border },
  tabBarContent: { paddingHorizontal: Spacing.sm, gap: 2, paddingVertical: 6 },
  tabItem: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: Spacing.md, paddingVertical: 7, borderRadius: Radius.md, position: 'relative' },
  tabItemActive: { backgroundColor: MX.orangeDim },
  tabLabel: { fontSize: 10, fontWeight: Typography.weight.semibold, color: MX.textMuted },
  tabLabelActive: { color: MX.orange },
  tabProPip: { width: 4, height: 4, borderRadius: 2, backgroundColor: MX.orangeMid, position: 'absolute', top: 4, right: 4 },
  upgradeBar: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: MX.orange, paddingHorizontal: Spacing.base, paddingTop: Spacing.sm },
  upgradeBarText: { flex: 1, fontSize: Typography.size.xs, fontWeight: Typography.weight.bold, color: MX.black },
  upgradeBarBtn: { backgroundColor: MX.black + '30', borderRadius: Radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
  upgradeBarBtnText: { fontSize: Typography.size.xs, fontWeight: Typography.weight.extrabold, color: MX.black },
});
