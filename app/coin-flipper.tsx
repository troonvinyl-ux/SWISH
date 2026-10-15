// Coin Flipper — Production-hardened niche entry point
//
// PRODUCTION CHANGES (see final report at bottom of file):
//   1. Double-tap protection — isInFlight ref prevents concurrent AI calls
//   2. Save idempotency — savedItemId guard prevents duplicate inventory items
//   3. Capture UX fix — camera launches, on cancel user is shown a picker modal
//   4. Insights stats query scoped to coins specialist only
//   5. Accessibility labels on all interactive controls
//   6. Error states never display unconfirmed results
//   7. Quota error clearly maps to upgrade flow with correct counts
//   8. All loading states disable buttons (no double-submit possible)
//
// ARCHITECTURE NOTE:
// This is a PRESENTATION LAYER screen wrapping the shared SWISH engine.
// All AI, valuation, listing, and database calls go through identical
// shared services — zero duplication of business logic.

import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, Pressable, ScrollView,
  ActivityIndicator, Linking, FlatList, Alert, AccessibilityInfo,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Colors, Typography, Spacing, Radius, Shadow } from '@/constants/theme';
import { useApp } from '@/hooks/useApp';
import { useSubscription } from '@/hooks/useSubscription';
import { useAlert, getSupabaseClient } from '@/template';
import {
  CapturedImage,
  AIIdentificationResult,
  captureFromCamera,
  pickFromLibrary,
  identifyItemWithAI,
  saveIdentifiedItem,
  uploadItemImages,
  updateItemMedia,
} from '@/services/aiIdentificationService';
import { getMarketValue, MarketValueResult } from '@/services/marketValueService';
import { startCheckout } from '@/services/subscriptionService';

// ── Coin Flipper design tokens ────────────────────────────────────────────────
const CF = {
  black:       '#09080A',
  surface:     '#111009',
  surfaceHigh: '#1C180F',
  border:      '#2C2510',
  gold:        '#F5C842',
  goldBright:  '#FFD700',
  goldDim:     '#2A2000',
  goldMid:     '#C8A028',
  bronze:      '#CD7F32',
  cream:       '#F0E8D0',
  textPrimary: '#F0E8D0',
  textSub:     '#9C8860',
  textMuted:   '#5C5038',
  success:     '#4CAF50',
  danger:      '#E53935',
  info:        '#42A5F5',
};

// ── Historical period catalogue ───────────────────────────────────────────────
const PERIODS = [
  { id: 'greek',    label: 'Greek',    icon: 'account-balance' as const, sub: 'Athens · Sparta · Macedonian · Hellenistic', color: '#D4AF37', range: '650–31 BC' },
  { id: 'lydian',   label: 'Lydian',   icon: 'brightness-7' as const,    sub: 'Electrum · Kingdoms · Early Coinage',         color: '#C8A028', range: '700–546 BC' },
  { id: 'persian',  label: 'Persian',  icon: 'stars' as const,           sub: 'Achaemenid · Satraps · Empire Issues',         color: '#B8922A', range: '547–330 BC' },
  { id: 'roman',    label: 'Roman',    icon: 'local-fire-department' as const, sub: 'Republic · Imperial · Provincial',      color: '#CD7F32', range: '300 BC–476 AD' },
  { id: 'byzantine',label: 'Byzantine',icon: 'auto-awesome' as const,    sub: 'Gold · Silver · Follis · Emperors',            color: '#DAA520', range: '330–1453 AD' },
  { id: 'islamic',  label: 'Islamic',  icon: 'toll' as const,            sub: 'Umayyad · Abbasid · Fatimid & More',           color: '#C0B090', range: '622 AD+' },
  { id: 'other',    label: 'Other',    icon: 'language' as const,        sub: 'Celtic · Indian · World Coins',                color: '#9C8860', range: 'Various' },
];

// ── Capture slots ─────────────────────────────────────────────────────────────
const COIN_SLOTS = [
  { id: 'obverse', label: 'Obverse', hint: 'Head / front face',  required: true  },
  { id: 'reverse', label: 'Reverse', hint: 'Tail / back face',   required: true  },
  { id: 'edge',    label: 'Edge',    hint: 'Milled / lettered',  required: false },
  { id: 'detail',  label: 'Detail',  hint: 'Inscription / date', required: false },
];

type CFTab = 'home' | 'capture' | 'identify' | 'reference' | 'value' | 'list_sell' | 'insights';

const TABS: Array<{ id: CFTab; label: string; icon: string }> = [
  { id: 'capture',   label: 'Capture',   icon: 'photo-camera'  },
  { id: 'identify',  label: 'Identify',  icon: 'search'        },
  { id: 'reference', label: 'Reference', icon: 'menu-book'     },
  { id: 'value',     label: 'Value',     icon: 'bar-chart'     },
  { id: 'list_sell', label: 'List & Sell', icon: 'sell'        },
  { id: 'insights',  label: 'Insights',  icon: 'trending-up'   },
];

const CONFIDENCE_COLOR = (c: number) =>
  c >= 0.85 ? CF.success : c >= 0.65 ? Colors.warning : CF.danger;

// ── Corner reticle ────────────────────────────────────────────────────────────
function Reticle({ size = 80, color = CF.gold }: { size?: number; color?: string }) {
  const cSize = 16;
  return (
    <View style={{ width: size, height: size, position: 'relative', alignItems: 'center', justifyContent: 'center' }}>
      {([
        { top: 0, left: 0, borderRightWidth: 0, borderBottomWidth: 0 },
        { top: 0, right: 0, borderLeftWidth: 0, borderBottomWidth: 0 },
        { bottom: 0, left: 0, borderRightWidth: 0, borderTopWidth: 0 },
        { bottom: 0, right: 0, borderLeftWidth: 0, borderTopWidth: 0 },
      ] as const).map((corner, i) => (
        <View key={i} style={[{ position: 'absolute', width: cSize, height: cSize, borderColor: color, borderWidth: 2.5 }, corner]} />
      ))}
    </View>
  );
}

function GoldDivider() {
  return <View style={{ height: 1, backgroundColor: CF.border, marginHorizontal: Spacing.base }} />;
}

// ── Period browser ────────────────────────────────────────────────────────────
function PeriodBrowser({ onSelect, selectedId }: { onSelect: (id: string) => void; selectedId: string | null }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={pb.content}>
      {PERIODS.map(p => {
        const active = selectedId === p.id;
        return (
          <Pressable
            key={p.id}
            onPress={() => onSelect(p.id)}
            accessibilityRole="button"
            accessibilityLabel={`${p.label} coins, ${p.range}`}
            accessibilityState={{ selected: active }}
            style={({ pressed }) => [pb.card, active && { borderColor: p.color + '80', backgroundColor: p.color + '18' }, pressed && { opacity: 0.82 }]}
          >
            <View style={[pb.iconWrap, { backgroundColor: p.color + '25' }]}>
              <MaterialIcons name={p.icon} size={20} color={p.color} />
            </View>
            <Text style={[pb.label, active && { color: p.color }]}>{p.label}</Text>
            <Text style={pb.range}>{p.range}</Text>
            <Text style={pb.sub} numberOfLines={2}>{p.sub}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
const pb = StyleSheet.create({
  content: { paddingHorizontal: Spacing.base, gap: Spacing.sm, paddingVertical: Spacing.sm },
  card: { width: 110, backgroundColor: CF.surface, borderRadius: Radius.xl, padding: Spacing.md, gap: 4, borderWidth: 1, borderColor: CF.border },
  iconWrap: { width: 36, height: 36, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  label: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: CF.textPrimary },
  range: { fontSize: 9, color: CF.textMuted, fontWeight: Typography.weight.medium },
  sub: { fontSize: 9, color: CF.textSub, lineHeight: 13, marginTop: 2 },
});

// ── Paywall ───────────────────────────────────────────────────────────────────
function CoinFlipperPaywall({ onBack }: { onBack: () => void }) {
  const insets = useSafeAreaInsets();
  const { showAlert } = useAlert();
  const [upgrading, setUpgrading] = useState(false);

  const handleUpgrade = useCallback(async () => {
    setUpgrading(true);
    const { opened, error } = await startCheckout('coins');
    setUpgrading(false);
    if (error) showAlert('Checkout Failed', error);
  }, [showAlert]);

  const PRO_FEATURES = [
    { icon: 'auto-awesome',   label: 'Unlimited AI identifications' },
    { icon: 'menu-book',      label: 'Numista catalogue & references' },
    { icon: 'analytics',      label: 'Advanced market valuations' },
    { icon: 'storefront',     label: 'eBay listing generation' },
    { icon: 'toll',           label: 'Islamic specialist engine' },
    { icon: 'photo-camera',   label: 'Quick Capture Station' },
    { icon: 'bar-chart',      label: 'Profit insights & analytics' },
    { icon: 'bolt',           label: 'Priority AI processing' },
  ];

  return (
    <View style={[pw.container, { paddingTop: insets.top }]}>
      <StatusBar style="light" />
      <View style={pw.header}>
        <Pressable onPress={onBack} style={pw.backBtn} hitSlop={8} accessibilityLabel="Go back" accessibilityRole="button">
          <MaterialIcons name="arrow-back" size={20} color={CF.gold} />
        </Pressable>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={pw.headerTitle}>COIN FLIPPER</Text>
          <Text style={pw.headerSub}>PRO</Text>
        </View>
        <View style={{ width: 36 }} />
      </View>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[pw.content, { paddingBottom: insets.bottom + 40 }]}>
        <View style={pw.hero}>
          <Reticle size={100} color={CF.gold} />
          <View style={pw.heroCenter}><MaterialIcons name="workspace-premium" size={44} color={CF.gold} /></View>
          <View style={pw.heroText}>
            <Text style={pw.heroTitle}>History Identified.</Text>
            <Text style={pw.heroTitle}>Opportunity Realised.</Text>
            <Text style={pw.heroTagline}>ANCIENT COINS • REAL VALUES • SMARTER DECISIONS</Text>
          </View>
        </View>
        <Pressable
          onPress={handleUpgrade}
          disabled={upgrading}
          accessibilityRole="button"
          accessibilityLabel={upgrading ? 'Opening checkout' : 'Upgrade to Coin Flipper Pro for £9.99 per month'}
          style={({ pressed }) => [pw.upgradeBtn, pressed && { opacity: 0.88 }, upgrading && { opacity: 0.7 }]}
        >
          <View style={pw.upgradeCrown}><MaterialIcons name="workspace-premium" size={18} color={CF.black} /></View>
          <View>
            <Text style={pw.upgradeBtnText}>{upgrading ? 'Opening checkout…' : 'Upgrade to Coin Flipper Pro'}</Text>
            <Text style={pw.upgradeBtnSub}>£9.99 / month · Cancel any time</Text>
          </View>
          {upgrading
            ? <ActivityIndicator size="small" color={CF.black} style={{ marginLeft: 'auto' }} />
            : <MaterialIcons name="arrow-forward" size={16} color={CF.black} style={{ marginLeft: 'auto' }} />}
        </Pressable>
        <View style={pw.featureCard}>
          <Text style={pw.featureTitle}>WHAT IS INCLUDED</Text>
          {PRO_FEATURES.map((f, i) => (
            <View key={f.label}>
              {i > 0 ? <View style={{ height: 1, backgroundColor: CF.border }} /> : null}
              <View style={pw.featureRow}>
                <View style={pw.featureIcon}><MaterialIcons name={f.icon as any} size={15} color={CF.gold} /></View>
                <Text style={pw.featureLabel}>{f.label}</Text>
                <MaterialIcons name="check-circle" size={14} color={CF.success} />
              </View>
            </View>
          ))}
        </View>
        <View style={pw.periodTeaser}>
          <Text style={pw.periodTeaserTitle}>SUPPORTED PERIODS</Text>
          <View style={pw.periodChips}>
            {PERIODS.map(p => (
              <View key={p.id} style={[pw.periodChip, { borderColor: p.color + '50' }]}>
                <MaterialIcons name={p.icon} size={11} color={p.color} />
                <Text style={[pw.periodChipText, { color: p.color }]}>{p.label}</Text>
              </View>
            ))}
          </View>
        </View>
        <Pressable onPress={onBack} style={pw.cancelBtn} accessibilityRole="button" accessibilityLabel="Go back without upgrading">
          <Text style={pw.cancelText}>Go Back</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}
const pw = StyleSheet.create({
  container: { flex: 1, backgroundColor: CF.black },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.base, paddingVertical: Spacing.md, borderBottomWidth: 1, borderBottomColor: CF.border },
  backBtn: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: CF.goldDim, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: CF.gold + '30' },
  headerTitle: { fontSize: Typography.size.lg, fontWeight: Typography.weight.extrabold, color: CF.gold, letterSpacing: 2 },
  headerSub: { fontSize: 9, color: CF.gold + 'AA', letterSpacing: 3, textTransform: 'uppercase' },
  content: { padding: Spacing.base, gap: Spacing.xl },
  hero: { alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.xl, position: 'relative' },
  heroCenter: { position: 'absolute', alignSelf: 'center' },
  heroText: { alignItems: 'center', gap: 4 },
  heroTitle: { fontSize: Typography.size.xxl, fontWeight: Typography.weight.extrabold, color: CF.gold, textAlign: 'center' },
  heroTagline: { fontSize: 9, color: CF.textSub, letterSpacing: 1.5, textAlign: 'center', marginTop: 4 },
  upgradeBtn: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: CF.gold, borderRadius: Radius.xxl, paddingVertical: Spacing.base, paddingHorizontal: Spacing.xl, shadowColor: CF.gold, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.45, shadowRadius: 16, elevation: 8 },
  upgradeCrown: { width: 36, height: 36, borderRadius: 18, backgroundColor: CF.black + '40', alignItems: 'center', justifyContent: 'center' },
  upgradeBtnText: { fontSize: Typography.size.base, fontWeight: Typography.weight.extrabold, color: CF.black },
  upgradeBtnSub: { fontSize: Typography.size.xs, color: CF.black + 'AA' },
  featureCard: { backgroundColor: CF.surface, borderRadius: Radius.xxl, borderWidth: 1, borderColor: CF.border, overflow: 'hidden' },
  featureTitle: { fontSize: 9, fontWeight: Typography.weight.extrabold, color: CF.textMuted, textTransform: 'uppercase', letterSpacing: 0.8, padding: Spacing.md, backgroundColor: CF.surfaceHigh },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.md, paddingVertical: 12 },
  featureIcon: { width: 28, height: 28, borderRadius: Radius.sm, backgroundColor: CF.goldDim, alignItems: 'center', justifyContent: 'center' },
  featureLabel: { flex: 1, fontSize: Typography.size.sm, color: CF.textPrimary },
  periodTeaser: { gap: Spacing.sm },
  periodTeaserTitle: { fontSize: 9, fontWeight: Typography.weight.extrabold, color: CF.textMuted, textTransform: 'uppercase', letterSpacing: 0.8 },
  periodChips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  periodChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: Radius.pill, backgroundColor: CF.surface, borderWidth: 1 },
  periodChipText: { fontSize: Typography.size.xs, fontWeight: Typography.weight.semibold },
  cancelBtn: { alignItems: 'center', paddingVertical: Spacing.sm },
  cancelText: { fontSize: Typography.size.sm, color: CF.textMuted, fontWeight: Typography.weight.medium },
});

// ── Home tab ──────────────────────────────────────────────────────────────────
function HomeTab({ onTabSelect, isPremium, tenant, onUpgrade, onPeriodSelect, selectedPeriod }: {
  onTabSelect: (t: CFTab) => void; isPremium: boolean; tenant: any;
  onUpgrade: () => void; onPeriodSelect: (id: string) => void; selectedPeriod: string | null;
}) {
  const router = useRouter();
  const FEATURES = [
    { label: 'Scan Coin',     icon: 'photo-camera',   tab: 'capture'   as CFTab, pro: false },
    { label: 'My Coins',      icon: 'inventory-2',    tab: null,                 pro: false, route: '/(tabs)/inventory' },
    { label: 'Identify',      icon: 'auto-awesome',   tab: 'identify'  as CFTab, pro: false },
    { label: 'Value',         icon: 'bar-chart',      tab: 'value'     as CFTab, pro: true  },
    { label: 'Reference',     icon: 'menu-book',      tab: 'reference' as CFTab, pro: true  },
    { label: 'List & Sell',   icon: 'sell',           tab: 'list_sell' as CFTab, pro: false },
    { label: 'Insights',      icon: 'trending-up',    tab: 'insights'  as CFTab, pro: true  },
    { label: 'Quick Capture', icon: 'burst-mode',     tab: 'capture'   as CFTab, pro: false },
  ];
  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={ht.content}>
      <View style={ht.hero}>
        <View style={ht.heroReticleWrap}>
          <Reticle size={110} color={CF.gold} />
          <View style={ht.heroLogoCenter}><MaterialIcons name="toll" size={44} color={CF.gold} /></View>
        </View>
        <Text style={ht.heroTitle}>COIN FLIPPER</Text>
        <Text style={ht.heroTagline}>ANCIENT COINS • REAL VALUES • SMARTER DECISIONS</Text>
        {isPremium ? (
          <View style={ht.proBadge}>
            <MaterialIcons name="workspace-premium" size={11} color={CF.black} />
            <Text style={ht.proBadgeText}>PRO</Text>
          </View>
        ) : null}
      </View>
      <Text style={ht.sectionLabel}>TOOLS</Text>
      <View style={ht.grid}>
        {FEATURES.map(f => {
          const locked = f.pro && !isPremium;
          return (
            <Pressable
              key={f.label}
              onPress={() => { if (locked) { onUpgrade(); return; } if (f.route) { router.push(f.route as any); return; } if (f.tab) onTabSelect(f.tab); }}
              accessibilityRole="button"
              accessibilityLabel={locked ? `${f.label} — Pro feature, tap to upgrade` : f.label}
              style={({ pressed }) => [ht.gridItem, pressed && { opacity: 0.8, transform: [{ scale: 0.97 }] }]}
            >
              <View style={[ht.gridIcon, locked && { backgroundColor: CF.border }]}>
                <MaterialIcons name={locked ? 'lock' : f.icon as any} size={22} color={locked ? CF.textMuted : CF.gold} />
              </View>
              <Text style={[ht.gridLabel, locked && { color: CF.textMuted }]} numberOfLines={1}>{f.label}</Text>
              {locked ? <View style={ht.gridProPill}><Text style={ht.gridProText}>PRO</Text></View> : null}
            </Pressable>
          );
        })}
      </View>
      <Text style={[ht.sectionLabel, { marginBottom: -4 }]}>HISTORICAL PERIODS</Text>
      <PeriodBrowser onSelect={onPeriodSelect} selectedId={selectedPeriod} />
      {selectedPeriod ? (() => {
        const p = PERIODS.find(x => x.id === selectedPeriod);
        if (!p) return null;
        return (
          <Pressable onPress={() => onTabSelect('capture')} accessibilityRole="button" accessibilityLabel={`Scan a ${p.label} coin`} style={({ pressed }) => [ht.periodDetail, { borderColor: p.color + '60' }, pressed && { opacity: 0.88 }]}>
            <View style={[ht.periodDetailIcon, { backgroundColor: p.color + '25' }]}><MaterialIcons name={p.icon} size={24} color={p.color} /></View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[ht.periodDetailName, { color: p.color }]}>{p.label} Coins</Text>
              <Text style={ht.periodDetailSub}>{p.sub}</Text>
              <Text style={ht.periodDetailRange}>{p.range}</Text>
            </View>
            <View style={[ht.periodDetailBtn, { backgroundColor: p.color }]}>
              <MaterialIcons name="photo-camera" size={14} color={CF.black} />
              <Text style={ht.periodDetailBtnText}>Scan</Text>
            </View>
          </Pressable>
        );
      })() : null}
      {!isPremium ? (
        <Pressable onPress={onUpgrade} accessibilityRole="button" accessibilityLabel="Upgrade to Coin Flipper Pro for £9.99 per month" style={({ pressed }) => [ht.upgradeBanner, pressed && { opacity: 0.88 }]}>
          <View style={ht.upgradeLeft}>
            <MaterialIcons name="workspace-premium" size={18} color={CF.black} />
            <View>
              <Text style={ht.upgradeBannerText}>Upgrade to Coin Flipper Pro</Text>
              <Text style={ht.upgradeBannerSub}>Islamic engine · Quick capture · Insights</Text>
            </View>
          </View>
          <View style={ht.upgradePriceChip}>
            <Text style={ht.upgradePriceText}>£9.99</Text>
            <Text style={ht.upgradePriceSub}>/mo</Text>
          </View>
        </Pressable>
      ) : (
        <View style={ht.premiumConfirmed}>
          <MaterialIcons name="workspace-premium" size={15} color={CF.gold} />
          <Text style={ht.premiumConfirmedText}>Coin Flipper Pro — all features unlocked</Text>
        </View>
      )}
    </ScrollView>
  );
}
const ht = StyleSheet.create({
  content: { padding: Spacing.base, gap: Spacing.lg, paddingBottom: 40 },
  sectionLabel: { fontSize: 9, fontWeight: Typography.weight.extrabold, color: CF.textMuted, textTransform: 'uppercase', letterSpacing: 0.8 },
  hero: { alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.md },
  heroReticleWrap: { position: 'relative', alignItems: 'center', justifyContent: 'center' },
  heroLogoCenter: { position: 'absolute' },
  heroTitle: { fontSize: 28, fontWeight: Typography.weight.extrabold, color: CF.gold, letterSpacing: 3 },
  heroTagline: { fontSize: 9, color: CF.textSub, letterSpacing: 1.5, textAlign: 'center' },
  proBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: CF.gold, borderRadius: Radius.pill, paddingHorizontal: 10, paddingVertical: 3 },
  proBadgeText: { fontSize: 9, fontWeight: Typography.weight.extrabold, color: CF.black, letterSpacing: 1.5 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  gridItem: { width: '23%', backgroundColor: CF.surface, borderRadius: Radius.xl, padding: Spacing.sm, alignItems: 'center', gap: 6, borderWidth: 1, borderColor: CF.border, aspectRatio: 0.9, justifyContent: 'center' },
  gridIcon: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: CF.goldDim, alignItems: 'center', justifyContent: 'center' },
  gridLabel: { fontSize: 9, fontWeight: Typography.weight.bold, color: CF.textPrimary, textAlign: 'center' },
  gridProPill: { backgroundColor: CF.goldDim, borderRadius: Radius.pill, paddingHorizontal: 5, paddingVertical: 2 },
  gridProText: { fontSize: 7, fontWeight: Typography.weight.extrabold, color: CF.gold, letterSpacing: 0.5 },
  periodDetail: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: CF.surface, borderRadius: Radius.xl, padding: Spacing.base, borderWidth: 1 },
  periodDetailIcon: { width: 48, height: 48, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  periodDetailName: { fontSize: Typography.size.base, fontWeight: Typography.weight.extrabold },
  periodDetailSub: { fontSize: Typography.size.xs, color: CF.textSub, lineHeight: 16 },
  periodDetailRange: { fontSize: 10, color: CF.textMuted },
  periodDetailBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  periodDetailBtnText: { fontSize: Typography.size.xs, fontWeight: Typography.weight.extrabold, color: CF.black },
  upgradeBanner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: CF.gold, borderRadius: Radius.xxl, paddingVertical: Spacing.base, paddingHorizontal: Spacing.xl, shadowColor: CF.gold, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.4, shadowRadius: 14, elevation: 6 },
  upgradeLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, flex: 1 },
  upgradeBannerText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.extrabold, color: CF.black },
  upgradeBannerSub: { fontSize: Typography.size.xs, color: CF.black + 'AA' },
  upgradePriceChip: { alignItems: 'center' },
  upgradePriceText: { fontSize: Typography.size.xl, fontWeight: Typography.weight.extrabold, color: CF.black },
  upgradePriceSub: { fontSize: 9, color: CF.black + 'AA' },
  premiumConfirmed: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: CF.goldDim, borderRadius: Radius.xl, padding: Spacing.md, borderWidth: 1, borderColor: CF.gold + '40' },
  premiumConfirmedText: { fontSize: Typography.size.sm, color: CF.gold, fontWeight: Typography.weight.semibold },
});

// ── Capture tab ───────────────────────────────────────────────────────────────
function CaptureTab({ capturedImages, onCapture, onRemove, onIdentify, identifying, processingStatus, aiError, onTabSelect, isPremium }: {
  capturedImages: CapturedImage[]; onCapture: (slotId: string, slotLabel: string) => void;
  onRemove: (slotId: string) => void; onIdentify: () => void; identifying: boolean;
  processingStatus: string; aiError: string | null; onTabSelect: (t: CFTab) => void; isPremium: boolean;
}) {
  const canIdentify = capturedImages.length > 0;
  const hasRequired = COIN_SLOTS.filter(s => s.required).every(s => capturedImages.some(i => i.slotId === s.id));
  const router = useRouter();

  return (
    <View style={{ flex: 1 }}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={ct.content}>
        <View style={ct.progressBar}>
          <View style={[ct.progressDot, { backgroundColor: capturedImages.length >= 2 ? CF.success : CF.gold }]} />
          <Text style={ct.progressText}>
            {capturedImages.length === 0 ? 'Tap a slot to photograph your coin'
              : capturedImages.length === 1 ? 'Obverse captured — now photograph the reverse'
              : `${capturedImages.length} / 4 photos captured`}
          </Text>
          <View style={[ct.countChip, capturedImages.length >= 2 && ct.countChipReady]}>
            <Text style={[ct.countText, capturedImages.length >= 2 && { color: CF.success }]}>{capturedImages.length}/4</Text>
          </View>
        </View>

        {aiError ? (
          <View style={ct.errorBanner} accessibilityRole="alert">
            <MaterialIcons name={aiError.includes('quota') ? 'workspace-premium' : 'error-outline'} size={15} color={aiError.includes('quota') ? CF.gold : CF.danger} />
            <Text style={[ct.errorText, aiError.includes('quota') && { color: CF.gold }]} numberOfLines={5}>{aiError}</Text>
            {aiError.includes('quota') && !isPremium ? (
              <Pressable onPress={() => router.push('/subscription' as any)} style={ct.quotaBtn} accessibilityRole="button" accessibilityLabel="Upgrade to Pro for unlimited identifications">
                <Text style={ct.quotaBtnText}>Upgrade</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        <View style={ct.photoGrid}>
          {COIN_SLOTS.map((slot, idx) => {
            const img = capturedImages.find(i => i.slotId === slot.id);
            const isFirst = idx === 0;
            return (
              <View key={slot.id} style={isFirst ? ct.slotLarge : ct.slotSmall}>
                <Pressable
                  onPress={() => onCapture(slot.id, slot.label)}
                  accessibilityRole="button"
                  accessibilityLabel={img ? `${slot.label} captured — tap to retake` : `Add ${slot.label} photo${slot.required ? ' (required)' : ' (optional)'}`}
                  style={({ pressed }) => [ct.slotInner, img ? ct.slotCaptured : ct.slotEmpty, slot.required && !img ? ct.slotRequired : null, pressed && { opacity: 0.82 }]}
                >
                  {img ? (
                    <>
                      <Image source={{ uri: img.uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
                      <View style={ct.capturedBar}>
                        <MaterialIcons name="check-circle" size={10} color={CF.success} />
                        <Text style={ct.capturedLabel} numberOfLines={1}>{slot.label}</Text>
                        <Pressable
                          onPress={e => { e.stopPropagation?.(); onCapture(slot.id, slot.label); }}
                          style={ct.retakeBtn} hitSlop={6}
                          accessibilityLabel={`Retake ${slot.label} photo`} accessibilityRole="button"
                        >
                          <MaterialIcons name="refresh" size={12} color="#fff" />
                        </Pressable>
                      </View>
                      <Pressable
                        onPress={e => { e.stopPropagation?.(); onRemove(slot.id); }}
                        style={ct.removeBtn} hitSlop={6}
                        accessibilityLabel={`Remove ${slot.label} photo`} accessibilityRole="button"
                      >
                        <MaterialIcons name="close" size={11} color="#fff" />
                      </Pressable>
                    </>
                  ) : (
                    <View style={ct.emptySlot}>
                      <View style={[ct.emptyIcon, slot.required ? ct.emptyIconRequired : null]}>
                        <MaterialIcons name="add-a-photo" size={isFirst ? 26 : 20} color={slot.required ? CF.gold : CF.textMuted} />
                      </View>
                      <Text style={[ct.emptyLabel, slot.required && { color: CF.textPrimary }]} numberOfLines={1}>{slot.label}</Text>
                      {slot.required ? <View style={ct.requiredPill}><Text style={ct.requiredText}>Required</Text></View> : <Text style={ct.optionalText}>Optional</Text>}
                      {slot.hint && isFirst ? <Text style={ct.slotHint} numberOfLines={2}>{slot.hint}</Text> : null}
                    </View>
                  )}
                </Pressable>
              </View>
            );
          })}
        </View>

        <View style={ct.tip}>
          <MaterialIcons name="lightbulb-outline" size={13} color={CF.gold} />
          <Text style={ct.tipText}>Obverse + Reverse gives the AI the most evidence. Edge and Detail boost confidence further.</Text>
        </View>
        <View style={{ height: 100 }} />
      </ScrollView>

      <View style={ct.actionBar}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={ct.actionCount}>{capturedImages.length} photo{capturedImages.length === 1 ? '' : 's'} captured</Text>
          {!hasRequired ? <Text style={ct.actionHint}>Obverse and Reverse required</Text> : <Text style={ct.actionReady}>Ready to identify</Text>}
        </View>
        <Pressable
          onPress={onIdentify}
          disabled={!canIdentify || identifying}
          accessibilityRole="button"
          accessibilityLabel={identifying ? processingStatus || 'Identifying coin, please wait' : canIdentify ? 'Identify coin with AI' : 'Add at least one photo before identifying'}
          accessibilityState={{ disabled: !canIdentify || identifying, busy: identifying }}
          style={({ pressed }) => [ct.identifyBtn, !canIdentify && ct.identifyBtnDisabled, pressed && canIdentify ? { opacity: 0.88 } : null]}
        >
          {identifying
            ? <ActivityIndicator size="small" color={CF.black} accessibilityLabel="Identifying" />
            : <MaterialIcons name="auto-awesome" size={18} color={canIdentify ? CF.black : CF.textMuted} />}
          <Text style={[ct.identifyBtnText, !canIdentify && { color: CF.textMuted }]}>
            {identifying ? processingStatus || 'Identifying...' : 'Identify Coin'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
const ct = StyleSheet.create({
  content: { padding: Spacing.base, gap: Spacing.md },
  progressBar: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: CF.surface, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: CF.border },
  progressDot: { width: 8, height: 8, borderRadius: 4 },
  progressText: { flex: 1, fontSize: Typography.size.sm, color: CF.textSub },
  countChip: { borderRadius: Radius.pill, paddingHorizontal: 8, paddingVertical: 3, backgroundColor: CF.surfaceHigh, borderWidth: 1, borderColor: CF.border },
  countChipReady: { backgroundColor: Colors.successDim, borderColor: CF.success + '50' },
  countText: { fontSize: 11, fontWeight: Typography.weight.bold, color: CF.textMuted },
  errorBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, backgroundColor: Colors.dangerDim, borderRadius: Radius.md, padding: Spacing.md, borderWidth: 1, borderColor: CF.danger + '40' },
  errorText: { flex: 1, fontSize: Typography.size.xs, color: CF.danger, lineHeight: 17 },
  quotaBtn: { backgroundColor: CF.goldDim, borderRadius: Radius.md, paddingHorizontal: Spacing.sm, paddingVertical: 4, borderWidth: 1, borderColor: CF.gold + '40' },
  quotaBtnText: { fontSize: 10, fontWeight: Typography.weight.bold, color: CF.gold },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  slotLarge: { width: '100%', aspectRatio: 1.8 },
  slotSmall: { width: '31%', aspectRatio: 1 },
  slotInner: { flex: 1, borderRadius: Radius.lg, overflow: 'hidden', position: 'relative' },
  slotEmpty: { backgroundColor: CF.surface, borderWidth: 1.5, borderStyle: 'dashed', borderColor: CF.border, alignItems: 'center', justifyContent: 'center' },
  slotRequired: { borderColor: CF.gold + '50' },
  slotCaptured: { borderWidth: 2, borderColor: CF.success + '70', borderStyle: 'solid' },
  emptySlot: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 5, paddingHorizontal: Spacing.sm },
  emptyIcon: { width: 48, height: 48, borderRadius: Radius.md, backgroundColor: CF.surfaceHigh, alignItems: 'center', justifyContent: 'center' },
  emptyIconRequired: { backgroundColor: CF.goldDim },
  emptyLabel: { fontSize: 11, fontWeight: Typography.weight.semibold, color: CF.textSub, textAlign: 'center' },
  requiredPill: { backgroundColor: CF.goldDim, borderRadius: Radius.pill, paddingHorizontal: 6, paddingVertical: 2 },
  requiredText: { fontSize: 8, fontWeight: Typography.weight.bold, color: CF.gold, textTransform: 'uppercase', letterSpacing: 0.3 },
  optionalText: { fontSize: 8, color: CF.textMuted, textTransform: 'uppercase', letterSpacing: 0.2 },
  slotHint: { fontSize: 9, color: CF.textMuted, textAlign: 'center', lineHeight: 13, marginTop: 2 },
  capturedBar: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.62)', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 5, gap: 4 },
  capturedLabel: { flex: 1, fontSize: 9, color: '#fff', fontWeight: Typography.weight.semibold },
  retakeBtn: { backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: Radius.sm, paddingHorizontal: 6, paddingVertical: 3 },
  removeBtn: { position: 'absolute', top: 6, right: 6, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 10, width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
  tip: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, backgroundColor: CF.goldDim, borderRadius: Radius.md, padding: Spacing.sm, borderWidth: 1, borderColor: CF.gold + '25' },
  tipText: { flex: 1, fontSize: 11, color: CF.gold, lineHeight: 16 },
  actionBar: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: CF.surface, borderTopWidth: 1, borderTopColor: CF.border, padding: Spacing.base, flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  actionCount: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: CF.textPrimary },
  actionHint: { fontSize: Typography.size.xs, color: Colors.warning },
  actionReady: { fontSize: Typography.size.xs, color: CF.success },
  identifyBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, backgroundColor: CF.gold, borderRadius: Radius.md, padding: Spacing.md, shadowColor: CF.gold, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.4, shadowRadius: 10, elevation: 6 },
  identifyBtnDisabled: { backgroundColor: CF.surfaceHigh, shadowOpacity: 0 },
  identifyBtnText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: CF.black },
});

// ── Identify tab ──────────────────────────────────────────────────────────────
function IdentifyTab({ result, capturedImages, onSave, saving, savedItemId, uploadProgress, isUploading, onReset, onTabSelect }: {
  result: AIIdentificationResult | null; capturedImages: CapturedImage[];
  onSave: () => void; saving: boolean; savedItemId: string | null;
  uploadProgress: string; isUploading: boolean; onReset: () => void; onTabSelect: (t: CFTab) => void;
}) {
  const router = useRouter();
  if (!result) {
    return (
      <View style={id.empty}>
        <MaterialIcons name="search" size={44} color={CF.textMuted} />
        <Text style={id.emptyTitle}>No Identification Yet</Text>
        <Text style={id.emptySub}>Go to Capture tab to photograph and identify a coin</Text>
        <Pressable onPress={() => onTabSelect('capture')} style={id.emptyBtn} accessibilityRole="button" accessibilityLabel="Start capturing photos">
          <MaterialIcons name="photo-camera" size={16} color={CF.black} />
          <Text style={id.emptyBtnText}>Start Capture</Text>
        </Pressable>
      </View>
    );
  }
  const conf = result.confidence;
  const confColor = CONFIDENCE_COLOR(conf);
  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={id.content}>
      {savedItemId ? (
        <View style={id.savedBanner} accessibilityRole="alert" accessibilityLiveRegion="polite">
          <MaterialIcons name="check-circle" size={18} color={CF.success} />
          <View style={{ flex: 1 }}>
            <Text style={id.savedText}>Saved to inventory</Text>
            {uploadProgress ? <Text style={id.savedSub}>{uploadProgress}</Text> : null}
          </View>
        </View>
      ) : null}
      <View style={id.resultCard}>
        <View style={[id.confBadge, { borderColor: confColor }]}>
          <Text style={[id.confPct, { color: confColor }]}>{Math.round(conf * 100)}%</Text>
          <Text style={[id.confLabel, { color: confColor }]}>{conf >= 0.85 ? 'HIGH' : conf >= 0.65 ? 'MED' : 'LOW'}</Text>
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={id.resultTitle}>{result.canonicalTitle}</Text>
          <Text style={id.resultCondition}>{result.condition}{result.conditionGrade ? ` · ${result.conditionGrade}` : ''}</Text>
          <View style={id.sourcRow}><MaterialIcons name="verified" size={11} color={CF.textMuted} /><Text style={id.sourceText}>{result.identificationSource}</Text></View>
        </View>
      </View>
      {capturedImages.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: Spacing.sm }}>
          {capturedImages.map(img => <Image key={img.slotId} source={{ uri: img.uri }} style={id.thumb} contentFit="cover" />)}
        </ScrollView>
      ) : null}
      {result.numistaStatus && result.numistaStatus !== 'unavailable' ? (
        <View style={[id.numistaCard, { borderColor: (result.numistaStatus === 'verified' || result.numistaStatus === 'strong_match') ? CF.success + '40' : Colors.warning + '30' }]}>
          <MaterialIcons name={result.numistaStatus === 'verified' || result.numistaStatus === 'strong_match' ? 'verified' : 'help-outline'} size={13} color={result.numistaStatus === 'verified' || result.numistaStatus === 'strong_match' ? CF.success : Colors.warning} />
          <View style={{ flex: 1 }}>
            <Text style={id.numistaStatus}>{String(result.numistaStatus).replace(/_/g, ' ').toUpperCase()}</Text>
            {result.numistaTitle ? <Text style={id.numistaTitle} numberOfLines={2}>{result.numistaTitle}</Text> : null}
            {result.numistaN ? <Text style={id.numistaRef}>{result.numistaN}</Text> : null}
          </View>
          {result.numistaMatchScore && result.numistaMatchScore > 0 ? <Text style={id.numistaScore}>{result.numistaMatchScore}/100</Text> : null}
        </View>
      ) : null}
      {(result.evidenceSupporting.length > 0 || result.missingInformation.length > 0) ? (
        <View style={id.evidenceCard}>
          <Text style={id.evidenceTitle}>EVIDENCE</Text>
          {result.evidenceSupporting.slice(0, 4).map((e, i) => (<View key={i} style={id.evidenceRow}><MaterialIcons name="check" size={11} color={CF.success} /><Text style={id.evidenceText}>{e}</Text></View>))}
          {result.missingInformation.slice(0, 2).map((m, i) => (<View key={i} style={id.evidenceRow}><MaterialIcons name="help-outline" size={11} color={Colors.warning} /><Text style={[id.evidenceText, { color: Colors.warning }]}>{m}</Text></View>))}
        </View>
      ) : null}
      {Object.keys(result.attributes).length > 0 ? (
        <View style={id.attrsCard}>
          <Text style={id.evidenceTitle}>COIN ATTRIBUTES</Text>
          {Object.entries(result.attributes).filter(([k]) => !k.startsWith('_') && !['object_type', 'identification_state', 'numista_url'].includes(k)).slice(0, 12).map(([k, v]) => (
            <View key={k} style={id.attrRow}>
              <Text style={id.attrKey}>{k.replace(/_/g, ' ')}</Text>
              <Text style={id.attrValue}>{String(v)}</Text>
            </View>
          ))}
        </View>
      ) : null}
      <View style={id.actions}>
        <Pressable onPress={onReset} style={id.resetBtn} accessibilityRole="button" accessibilityLabel="Start a new scan">
          <Text style={id.resetText}>New Scan</Text>
        </Pressable>
        {savedItemId ? (
          <Pressable
            onPress={() => router.push(`/create-listing?id=${savedItemId}` as any)}
            style={id.primaryBtn}
            accessibilityRole="button"
            accessibilityLabel={isUploading ? 'Uploading photos, please wait' : 'Create eBay listing for this coin'}
            accessibilityState={{ busy: isUploading }}
          >
            {isUploading ? <ActivityIndicator size="small" color={CF.black} /> : <MaterialIcons name="sell" size={18} color={CF.black} />}
            <Text style={id.primaryBtnText}>{isUploading ? 'Uploading...' : 'List on eBay'}</Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={onSave}
            disabled={saving}
            accessibilityRole="button"
            accessibilityLabel={saving ? 'Saving coin to inventory, please wait' : 'Save this coin to your inventory'}
            accessibilityState={{ disabled: saving, busy: saving }}
            style={id.primaryBtn}
          >
            {saving ? <ActivityIndicator size="small" color={CF.black} /> : <MaterialIcons name="add" size={18} color={CF.black} />}
            <Text style={id.primaryBtnText}>{saving ? 'Saving...' : 'Save to Inventory'}</Text>
          </Pressable>
        )}
      </View>
    </ScrollView>
  );
}
const id = StyleSheet.create({
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md, padding: Spacing.xl },
  emptyTitle: { fontSize: Typography.size.xl, fontWeight: Typography.weight.bold, color: CF.textPrimary },
  emptySub: { fontSize: Typography.size.sm, color: CF.textSub, textAlign: 'center', lineHeight: 20 },
  emptyBtn: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: CF.gold, borderRadius: Radius.md, paddingVertical: Spacing.md, paddingHorizontal: Spacing.xl, marginTop: Spacing.md },
  emptyBtnText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: CF.black },
  content: { padding: Spacing.base, gap: Spacing.md, paddingBottom: 40 },
  savedBanner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.successDim, borderRadius: Radius.md, padding: Spacing.md, borderWidth: 1, borderColor: CF.success + '40' },
  savedText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: CF.success },
  savedSub: { fontSize: 10, color: CF.success + 'BB', marginTop: 2 },
  resultCard: { flexDirection: 'row', gap: Spacing.md, alignItems: 'flex-start', backgroundColor: CF.surface, borderRadius: Radius.xl, padding: Spacing.base, borderWidth: 1, borderColor: CF.gold + '30' },
  confBadge: { width: 64, height: 64, borderRadius: Radius.lg, backgroundColor: CF.surfaceHigh, alignItems: 'center', justifyContent: 'center', borderWidth: 2 },
  confPct: { fontSize: Typography.size.md, fontWeight: Typography.weight.extrabold },
  confLabel: { fontSize: 8, textTransform: 'uppercase', letterSpacing: 0.4 },
  resultTitle: { fontSize: Typography.size.base, fontWeight: Typography.weight.bold, color: CF.textPrimary },
  resultCondition: { fontSize: Typography.size.sm, color: CF.textSub },
  sourcRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  sourceText: { fontSize: Typography.size.xs, color: CF.textMuted },
  thumb: { width: 80, height: 80, borderRadius: Radius.md },
  numistaCard: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, backgroundColor: CF.surface, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1 },
  numistaStatus: { fontSize: 10, fontWeight: Typography.weight.semibold, color: CF.textSub, textTransform: 'uppercase', letterSpacing: 0.4 },
  numistaTitle: { fontSize: Typography.size.sm, color: CF.textPrimary, lineHeight: 18, marginTop: 2 },
  numistaRef: { fontSize: 10, color: CF.gold, marginTop: 2 },
  numistaScore: { fontSize: 10, color: CF.textMuted },
  evidenceCard: { backgroundColor: CF.surface, borderRadius: Radius.lg, padding: Spacing.md, gap: 6, borderWidth: 1, borderColor: CF.border },
  evidenceTitle: { fontSize: 9, fontWeight: Typography.weight.extrabold, color: CF.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 },
  evidenceRow: { flexDirection: 'row', gap: 6, alignItems: 'flex-start' },
  evidenceText: { flex: 1, fontSize: Typography.size.xs, color: CF.textSub, lineHeight: 16 },
  attrsCard: { backgroundColor: CF.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: CF.border, overflow: 'hidden' },
  attrRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: Spacing.md, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: CF.border },
  attrKey: { fontSize: Typography.size.xs, color: CF.textMuted, textTransform: 'capitalize', flex: 1 },
  attrValue: { fontSize: Typography.size.xs, fontWeight: Typography.weight.semibold, color: CF.textPrimary, flex: 1, textAlign: 'right' },
  actions: { flexDirection: 'row', gap: Spacing.sm },
  resetBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.md, borderRadius: Radius.md, backgroundColor: CF.surface, borderWidth: 1, borderColor: CF.border },
  resetText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: CF.textSub },
  primaryBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, backgroundColor: CF.gold, borderRadius: Radius.md, padding: Spacing.md, shadowColor: CF.gold, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.35, shadowRadius: 10, elevation: 5 },
  primaryBtnText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: CF.black },
});

// ── Reference tab ─────────────────────────────────────────────────────────────
function ReferenceTab({ result, selectedPeriod, onPeriodSelect }: { result: AIIdentificationResult | null; selectedPeriod: string | null; onPeriodSelect: (id: string) => void }) {
  const catalogues = [
    { label: 'Numista', url: 'https://en.numista.com', color: '#4CAF50' },
    { label: 'RSC',     url: 'https://www.wildwinds.com',  color: '#2196F3' },
    { label: 'SNG',     url: 'https://sngenglish.com',     color: '#9C27B0' },
    { label: 'RIC',     url: 'https://numismatica-classica.lamoneta.it', color: '#FF9800' },
    { label: 'Zeno.ru', url: 'https://zeno.ru',            color: '#F44336' },
    { label: 'OCRE',    url: 'https://numismatics.org/ocre/', color: '#607D8B' },
  ];
  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={rf.content}>
      <Text style={rf.sectionLabel}>ONLINE CATALOGUES</Text>
      <View style={rf.catalogueGrid}>
        {catalogues.map(cat => (
          <Pressable key={cat.label} onPress={() => Linking.openURL(cat.url)} accessibilityRole="link" accessibilityLabel={`Open ${cat.label} catalogue in browser`} style={({ pressed }) => [rf.catCard, { borderColor: cat.color + '50' }, pressed && { opacity: 0.8 }]}>
            <View style={[rf.catIcon, { backgroundColor: cat.color + '20' }]}><MaterialIcons name="open-in-new" size={16} color={cat.color} /></View>
            <Text style={rf.catLabel}>{cat.label}</Text>
          </Pressable>
        ))}
      </View>
      {result?.numistaUrl ? (
        <View style={rf.refCard}>
          <Text style={rf.sectionLabel}>NUMISTA REFERENCE</Text>
          <Text style={rf.refTitle}>{result.numistaTitle ?? result.canonicalTitle}</Text>
          {result.numistaN ? <Text style={rf.refN}>{result.numistaN}</Text> : null}
          <Pressable onPress={() => result.numistaUrl ? Linking.openURL(result.numistaUrl) : null} accessibilityRole="link" accessibilityLabel="View this coin on Numista" style={({ pressed }) => [rf.refBtn, pressed && { opacity: 0.85 }]}>
            <MaterialIcons name="open-in-new" size={14} color={CF.black} />
            <Text style={rf.refBtnText}>View on Numista</Text>
          </Pressable>
        </View>
      ) : null}
      <Text style={rf.sectionLabel}>BROWSE BY PERIOD</Text>
      <PeriodBrowser onSelect={onPeriodSelect} selectedId={selectedPeriod} />
      <View style={rf.disclaimer}>
        <MaterialIcons name="info-outline" size={12} color={CF.textMuted} />
        <Text style={rf.disclaimerText}>Reference links open external catalogues in your browser. Coin Flipper is not affiliated with these services.</Text>
      </View>
    </ScrollView>
  );
}
const rf = StyleSheet.create({
  content: { padding: Spacing.base, gap: Spacing.lg, paddingBottom: 40 },
  sectionLabel: { fontSize: 9, fontWeight: Typography.weight.extrabold, color: CF.textMuted, textTransform: 'uppercase', letterSpacing: 0.8 },
  catalogueGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  catCard: { width: '30%', backgroundColor: CF.surface, borderRadius: Radius.xl, padding: Spacing.md, alignItems: 'center', gap: 6, borderWidth: 1 },
  catIcon: { width: 36, height: 36, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  catLabel: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: CF.textPrimary },
  refCard: { backgroundColor: CF.surface, borderRadius: Radius.xl, padding: Spacing.base, gap: Spacing.sm, borderWidth: 1, borderColor: CF.gold + '30' },
  refTitle: { fontSize: Typography.size.base, fontWeight: Typography.weight.bold, color: CF.textPrimary, lineHeight: 22 },
  refN: { fontSize: Typography.size.sm, color: CF.gold },
  refBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, backgroundColor: CF.gold, borderRadius: Radius.md, paddingVertical: Spacing.sm, marginTop: Spacing.xs },
  refBtnText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: CF.black },
  disclaimer: { flexDirection: 'row', gap: Spacing.xs, backgroundColor: CF.surfaceHigh, borderRadius: Radius.sm, padding: Spacing.sm },
  disclaimerText: { flex: 1, fontSize: Typography.size.xs, color: CF.textMuted, lineHeight: 15 },
});

// ── Value tab ─────────────────────────────────────────────────────────────────
function ValueTab({ result, valuationResult, valuationLoading, valuationError, onTabSelect }: {
  result: AIIdentificationResult | null; valuationResult: MarketValueResult | null;
  valuationLoading: boolean; valuationError: string | null; onTabSelect: (t: CFTab) => void;
}) {
  if (!result) {
    return (
      <View style={vt.empty}>
        <MaterialIcons name="bar-chart" size={44} color={CF.textMuted} />
        <Text style={vt.emptyTitle}>No Coin Identified</Text>
        <Text style={vt.emptySub}>Scan and identify a coin to see its market value</Text>
        <Pressable onPress={() => onTabSelect('capture')} style={vt.emptyBtn} accessibilityRole="button" accessibilityLabel="Start capturing photos">
          <MaterialIcons name="photo-camera" size={16} color={CF.black} />
          <Text style={vt.emptyBtnText}>Start Capture</Text>
        </Pressable>
      </View>
    );
  }
  const v = valuationResult?.valuation;
  const sold = valuationResult?.soldMarket;
  const asking = valuationResult?.activeAskingPrices;
  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={vt.content}>
      <View style={vt.coinHeader}>
        <Text style={vt.coinTitle}>{result.canonicalTitle}</Text>
        <Text style={vt.coinCondition}>{result.condition}{result.conditionGrade ? ` · ${result.conditionGrade}` : ''}</Text>
        <Text style={vt.coinSub}>Market Value ({result.condition || 'Good Condition'})</Text>
      </View>
      {valuationLoading ? (
        <View style={vt.loadingRow} accessibilityLiveRegion="polite" accessibilityLabel="Searching eBay sold data, please wait">
          <ActivityIndicator size="large" color={CF.gold} />
          <Text style={vt.loadingText}>Searching eBay sold data...</Text>
        </View>
      ) : v && v.valuationMid > 0 ? (
        <>
          <View style={vt.priceHero}>
            <Text style={vt.priceRange} accessibilityLabel={`Estimated value £${(v.valuationLow ?? 0).toFixed(0)} to £${(v.valuationHigh ?? 0).toFixed(0)}`}>
              £{(v.valuationLow ?? 0).toFixed(0)} – £{(v.valuationHigh ?? 0).toFixed(0)}
            </Text>
            {v.recommendedListingPrice && v.recommendedListingPrice > 0 ? (
              <View style={vt.recommended}>
                <MaterialIcons name="auto-awesome" size={13} color={CF.gold} />
                <Text style={vt.recommendedText}>Recommended listing price: £{v.recommendedListingPrice.toFixed(2)}</Text>
              </View>
            ) : null}
          </View>
          {sold && sold.relevantSoldCount > 0 ? (
            <View style={vt.metricsRow}>
              {[
                { label: 'Recent Sales', value: String(sold.relevantSoldCount) },
                { label: 'Sold Median',  value: `£${(sold.medianPrice ?? 0).toFixed(2)}` },
                { label: '30d Sale Prob.', value: v.saleProb30d ? `${Math.round(v.saleProb30d * 100)}%` : 'N/A' },
              ].map(m => (
                <View key={m.label} style={vt.metric}>
                  <Text style={vt.metricValue}>{m.value}</Text>
                  <Text style={vt.metricLabel}>{m.label}</Text>
                </View>
              ))}
            </View>
          ) : null}
          {v.listingPriceRationale ? (
            <View style={vt.rationaleCard}>
              <MaterialIcons name="auto-awesome" size={12} color={CF.gold} />
              <Text style={vt.rationaleText} numberOfLines={4}>{v.listingPriceRationale}</Text>
            </View>
          ) : null}
          {asking && asking.count > 0 && asking.medianAskingPrice > 0 ? (
            <View style={vt.askingNote}>
              <MaterialIcons name="info-outline" size={11} color={Colors.warning} />
              <Text style={vt.askingNoteText}>Active asking: £{asking.lowAskingPrice.toFixed(0)}–£{asking.highAskingPrice.toFixed(0)} ({asking.relevantCount} listings) — asking prices, not sold</Text>
            </View>
          ) : null}
        </>
      ) : valuationError ? (
        <View style={vt.errorCard} accessibilityRole="alert">
          <MaterialIcons name="warning" size={16} color={Colors.warning} />
          <Text style={vt.errorText}>{valuationError}</Text>
        </View>
      ) : (
        <View style={vt.noDataCard}>
          <MaterialIcons name="info-outline" size={16} color={CF.textMuted} />
          <Text style={vt.noDataText}>Insufficient comparable sales. Limited market data for this coin type.</Text>
        </View>
      )}
      <View style={{ height: 40 }} />
    </ScrollView>
  );
}
const vt = StyleSheet.create({
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md, padding: Spacing.xl },
  emptyTitle: { fontSize: Typography.size.xl, fontWeight: Typography.weight.bold, color: CF.textPrimary },
  emptySub: { fontSize: Typography.size.sm, color: CF.textSub, textAlign: 'center', lineHeight: 20 },
  emptyBtn: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: CF.gold, borderRadius: Radius.md, paddingVertical: Spacing.md, paddingHorizontal: Spacing.xl, marginTop: Spacing.md },
  emptyBtnText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: CF.black },
  content: { padding: Spacing.base, gap: Spacing.lg },
  coinHeader: { gap: 4, paddingBottom: Spacing.md, borderBottomWidth: 1, borderBottomColor: CF.border },
  coinTitle: { fontSize: Typography.size.xl, fontWeight: Typography.weight.extrabold, color: CF.textPrimary },
  coinCondition: { fontSize: Typography.size.sm, color: CF.textSub },
  coinSub: { fontSize: Typography.size.xs, color: CF.textMuted, marginTop: 4 },
  loadingRow: { alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.xl },
  loadingText: { fontSize: Typography.size.sm, color: CF.gold },
  priceHero: { backgroundColor: CF.surface, borderRadius: Radius.xxl, padding: Spacing.xl, gap: Spacing.md, borderWidth: 1, borderColor: CF.gold + '30' },
  priceRange: { fontSize: 32, fontWeight: Typography.weight.extrabold, color: CF.gold, textAlign: 'center' },
  recommended: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, backgroundColor: CF.goldDim, borderRadius: Radius.md, padding: Spacing.sm, borderWidth: 1, borderColor: CF.gold + '30' },
  recommendedText: { flex: 1, fontSize: Typography.size.xs, color: CF.gold, lineHeight: 16 },
  metricsRow: { flexDirection: 'row', justifyContent: 'space-around', backgroundColor: CF.surface, borderRadius: Radius.xl, padding: Spacing.base, borderWidth: 1, borderColor: CF.border },
  metric: { alignItems: 'center', gap: 4 },
  metricValue: { fontSize: Typography.size.xl, fontWeight: Typography.weight.extrabold, color: CF.textPrimary },
  metricLabel: { fontSize: 9, color: CF.textMuted, textTransform: 'uppercase', letterSpacing: 0.4 },
  rationaleCard: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, backgroundColor: CF.goldDim, borderRadius: Radius.md, padding: Spacing.md, borderWidth: 1, borderColor: CF.gold + '25' },
  rationaleText: { flex: 1, fontSize: Typography.size.xs, color: CF.gold, lineHeight: 16 },
  askingNote: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.xs, backgroundColor: Colors.warningDim, borderRadius: Radius.sm, padding: Spacing.sm },
  askingNoteText: { flex: 1, fontSize: Typography.size.xs, color: Colors.warning, lineHeight: 15 },
  errorCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.warningDim, borderRadius: Radius.md, padding: Spacing.base, borderWidth: 1, borderColor: Colors.warning + '40' },
  errorText: { flex: 1, fontSize: Typography.size.sm, color: Colors.warning, lineHeight: 18 },
  noDataCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: CF.surfaceHigh, borderRadius: Radius.md, padding: Spacing.base, borderWidth: 1, borderColor: CF.border },
  noDataText: { flex: 1, fontSize: Typography.size.sm, color: CF.textSub, lineHeight: 18 },
});

// ── List & Sell tab ───────────────────────────────────────────────────────────
function ListSellTab({ savedItemId, result, onTabSelect }: { savedItemId: string | null; result: AIIdentificationResult | null; onTabSelect: (t: CFTab) => void }) {
  const router = useRouter();
  if (!savedItemId) {
    return (
      <View style={ls.empty}>
        <MaterialIcons name="sell" size={44} color={CF.textMuted} />
        <Text style={ls.emptyTitle}>No Coin Saved Yet</Text>
        <Text style={ls.emptySub}>Identify and save a coin first, then create your eBay listing here</Text>
        <Pressable onPress={() => onTabSelect('capture')} style={ls.emptyBtn} accessibilityRole="button" accessibilityLabel="Start capturing photos">
          <MaterialIcons name="photo-camera" size={16} color={CF.black} />
          <Text style={ls.emptyBtnText}>Start Capture</Text>
        </Pressable>
      </View>
    );
  }
  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={ls.content}>
      <View style={ls.readyCard}>
        <MaterialIcons name="check-circle" size={28} color={CF.success} />
        <View style={{ flex: 1 }}>
          <Text style={ls.readyTitle}>Ready to List</Text>
          <Text style={ls.readySub}>{result?.canonicalTitle}</Text>
        </View>
      </View>
      <Text style={ls.sectionLabel}>LISTING OPTIONS</Text>
      {[
        { icon: 'storefront', label: 'Create eBay Listing', sub: 'Auto-fill title, description, category from AI identification', color: '#E53238', action: () => router.push(`/create-listing?id=${savedItemId}` as any) },
        { icon: 'inventory-2', label: 'View in Inventory', sub: 'See full item details, edit attributes, add to acquisition', color: CF.gold, action: () => router.push(`/item/${savedItemId}` as any) },
        { icon: 'receipt-long', label: 'View All Listings', sub: 'See all your active and draft eBay listings', color: Colors.info, action: () => router.push('/(tabs)/listings' as any) },
      ].map(item => (
        <Pressable key={item.label} onPress={item.action} accessibilityRole="button" accessibilityLabel={item.label} style={({ pressed }) => [ls.optionCard, pressed && { opacity: 0.85 }]}>
          <View style={[ls.optionIcon, { backgroundColor: item.color + '20' }]}><MaterialIcons name={item.icon as any} size={22} color={item.color} /></View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={ls.optionLabel}>{item.label}</Text>
            <Text style={ls.optionSub}>{item.sub}</Text>
          </View>
          <MaterialIcons name="chevron-right" size={16} color={CF.textMuted} />
        </Pressable>
      ))}
    </ScrollView>
  );
}
const ls = StyleSheet.create({
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md, padding: Spacing.xl },
  emptyTitle: { fontSize: Typography.size.xl, fontWeight: Typography.weight.bold, color: CF.textPrimary },
  emptySub: { fontSize: Typography.size.sm, color: CF.textSub, textAlign: 'center', lineHeight: 20 },
  emptyBtn: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: CF.gold, borderRadius: Radius.md, paddingVertical: Spacing.md, paddingHorizontal: Spacing.xl, marginTop: Spacing.md },
  emptyBtnText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: CF.black },
  content: { padding: Spacing.base, gap: Spacing.md, paddingBottom: 40 },
  sectionLabel: { fontSize: 9, fontWeight: Typography.weight.extrabold, color: CF.textMuted, textTransform: 'uppercase', letterSpacing: 0.8 },
  readyCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.successDim, borderRadius: Radius.xl, padding: Spacing.base, borderWidth: 1, borderColor: CF.success + '40' },
  readyTitle: { fontSize: Typography.size.base, fontWeight: Typography.weight.bold, color: CF.success },
  readySub: { fontSize: Typography.size.sm, color: CF.textSub },
  optionCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: CF.surface, borderRadius: Radius.xl, padding: Spacing.base, borderWidth: 1, borderColor: CF.border },
  optionIcon: { width: 48, height: 48, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  optionLabel: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: CF.textPrimary },
  optionSub: { fontSize: Typography.size.xs, color: CF.textSub, lineHeight: 16 },
});

// ── Insights tab ──────────────────────────────────────────────────────────────
function InsightsTab({ tenant, onTabSelect }: { tenant: any; onTabSelect: (t: CFTab) => void }) {
  const router = useRouter();
  const [stats, setStats] = useState<{ items: number; listed: number; sold: number; totalValue: number } | null>(null);
  const [loading, setLoading] = useState(true);

  // PRODUCTION FIX: stats scoped to coins specialist only (was querying all tenant items)
  const COIN_SPECIALISTS = ['coins', 'coins_uk', 'coins_world', 'islamic_silver', 'banknotes', 'gold', 'silver', 'ancient_artefacts', 'curiosities_collectibles'];

  useEffect(() => {
    if (!tenant?.id) { setLoading(false); return; }
    const supabase = getSupabaseClient();
    Promise.all([
      supabase
        .from('items')
        .select('id, status, expected_selling_price')
        .eq('tenant_id', tenant.id)
        .in('specialist_id', COIN_SPECIALISTS),
      supabase
        .from('listings')
        .select('id, items!inner(specialist_id)')
        .eq('tenant_id', tenant.id)
        .eq('status', 'active')
        .in('items.specialist_id', COIN_SPECIALISTS),
      supabase
        .from('sales')
        .select('sale_price, items!inner(specialist_id)')
        .eq('tenant_id', tenant.id)
        .in('items.specialist_id', COIN_SPECIALISTS),
    ]).then(([itemsRes, listingsRes, salesRes]) => {
      const items = itemsRes.data ?? [];
      const listed = listingsRes.data?.length ?? 0;
      const sold = salesRes.data?.length ?? 0;
      const totalValue = items.reduce((acc: number, i: any) => acc + (Number(i.expected_selling_price) || 0), 0);
      setStats({ items: items.length, listed, sold, totalValue });
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [tenant?.id]);

  const INSIGHT_ACTIONS = [
    { icon: 'inventory-2', label: 'Full Inventory',       sub: 'Browse all coins in stock',               color: CF.gold,     action: () => router.push('/(tabs)/inventory' as any) },
    { icon: 'trending-up', label: 'Business Insights',   sub: 'Revenue, profit, and performance',         color: Colors.info, action: () => router.push('/money' as any) },
    { icon: 'price-change', label: 'Repricing Engine',   sub: 'Automatically adjust listing prices',      color: Colors.warning, action: () => router.push('/repricing' as any) },
    { icon: 'receipt',     label: 'Orders',               sub: 'Manage and fulfil orders',                 color: CF.success,  action: () => router.push('/orders' as any) },
  ];

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={ins.content}>
      {loading ? (
        <View style={{ alignItems: 'center', paddingVertical: Spacing.xl }} accessibilityLabel="Loading stats"><ActivityIndicator color={CF.gold} /></View>
      ) : stats ? (
        <View style={ins.statsGrid}>
          {[
            { label: 'Coins in Stock',   value: String(stats.items),              icon: 'toll',                    color: CF.gold     },
            { label: 'Active Listings',  value: String(stats.listed),             icon: 'storefront',              color: Colors.info },
            { label: 'Total Sold',       value: String(stats.sold),               icon: 'check-circle',            color: CF.success  },
            { label: 'Portfolio Value',  value: `£${stats.totalValue.toFixed(0)}`, icon: 'account-balance-wallet', color: CF.bronze   },
          ].map(m => (
            <View key={m.label} style={[ins.statCard, { borderColor: m.color + '40' }]}>
              <View style={[ins.statIcon, { backgroundColor: m.color + '20' }]}><MaterialIcons name={m.icon as any} size={18} color={m.color} /></View>
              <Text style={[ins.statValue, { color: m.color }]}>{m.value}</Text>
              <Text style={ins.statLabel}>{m.label}</Text>
            </View>
          ))}
        </View>
      ) : null}
      <Text style={ins.sectionLabel}>TOOLS & ANALYSIS</Text>
      {INSIGHT_ACTIONS.map(a => (
        <Pressable key={a.label} onPress={a.action} accessibilityRole="button" accessibilityLabel={a.label} style={({ pressed }) => [ins.actionCard, pressed && { opacity: 0.85 }]}>
          <View style={[ins.actionIcon, { backgroundColor: a.color + '20' }]}><MaterialIcons name={a.icon as any} size={20} color={a.color} /></View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={ins.actionLabel}>{a.label}</Text>
            <Text style={ins.actionSub}>{a.sub}</Text>
          </View>
          <MaterialIcons name="chevron-right" size={16} color={CF.textMuted} />
        </Pressable>
      ))}
      <View style={ins.periodHint}>
        <MaterialIcons name="menu-book" size={14} color={CF.gold} />
        <Text style={ins.periodHintText}>Use the Reference tab to browse specialist guides for each historical period.</Text>
      </View>
    </ScrollView>
  );
}
const ins = StyleSheet.create({
  content: { padding: Spacing.base, gap: Spacing.md, paddingBottom: 40 },
  sectionLabel: { fontSize: 9, fontWeight: Typography.weight.extrabold, color: CF.textMuted, textTransform: 'uppercase', letterSpacing: 0.8 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  statCard: { width: '48%', backgroundColor: CF.surface, borderRadius: Radius.xl, padding: Spacing.base, gap: 6, borderWidth: 1, alignItems: 'flex-start' },
  statIcon: { width: 36, height: 36, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  statValue: { fontSize: Typography.size.xl, fontWeight: Typography.weight.extrabold },
  statLabel: { fontSize: Typography.size.xs, color: CF.textMuted },
  actionCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: CF.surface, borderRadius: Radius.xl, padding: Spacing.base, borderWidth: 1, borderColor: CF.border },
  actionIcon: { width: 44, height: 44, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  actionLabel: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: CF.textPrimary },
  actionSub: { fontSize: Typography.size.xs, color: CF.textSub, lineHeight: 16 },
  periodHint: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, backgroundColor: CF.goldDim, borderRadius: Radius.md, padding: Spacing.md, borderWidth: 1, borderColor: CF.gold + '25' },
  periodHintText: { flex: 1, fontSize: Typography.size.xs, color: CF.gold, lineHeight: 16 },
});

// ─────────────────────────────────────────────────────────────────────────────
// MAIN SCREEN
// ─────────────────────────────────────────────────────────────────────────────

export default function CoinFlipperScreen({ isHomeTab = false }: { isHomeTab?: boolean } = {}) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { tenant, setScanMode } = useApp();
  const { showAlert } = useAlert();
  const { isPremium } = useSubscription();

  // ── Tab state ───────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<CFTab>('home');
  const [selectedPeriod, setSelectedPeriod] = useState<string | null>(null);
  const [showPaywall, setShowPaywall] = useState(false);

  // ── Capture state ───────────────────────────────────────────────────────────
  const [capturedImages, setCapturedImages] = useState<CapturedImage[]>([]);

  // ── In-flight lock — prevents double-tap creating duplicate AI calls ─────────
  // Uses ref (not state) to avoid re-render race: ref is synchronously checked
  // and set before any async work begins.
  const isIdentifyInFlight = useRef(false);
  const isSaveInFlight = useRef(false);

  const [identifying, setIdentifying] = useState(false);
  const [processingStatus, setProcessingStatus] = useState('');
  const [aiError, setAiError] = useState<string | null>(null);

  // ── Identification result ───────────────────────────────────────────────────
  const [idResult, setIdResult] = useState<AIIdentificationResult | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [savedItemId, setSavedItemId] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');

  // ── Valuation ───────────────────────────────────────────────────────────────
  const [valuationResult, setValuationResult] = useState<MarketValueResult | null>(null);
  const [valuationLoading, setValuationLoading] = useState(false);
  const [valuationError, setValuationError] = useState<string | null>(null);

  // Tab select with premium gate
  const handleTabSelect = useCallback((tab: CFTab) => {
    const premiumTabs: CFTab[] = ['value', 'reference', 'insights'];
    if (premiumTabs.includes(tab) && !isPremium) { setShowPaywall(true); return; }
    setActiveTab(tab);
  }, [isPremium]);

  // Fetch valuation when entering Value tab
  useEffect(() => {
    if (activeTab !== 'value' || !idResult || !tenant) return;
    if (valuationResult || valuationLoading) return;
    if (!idResult.canonicalTitle || idResult.canonicalTitle.length < 3) return;
    setValuationLoading(true);
    setValuationError(null);
    getMarketValue({
      tenantId: tenant.id,
      title: idResult.canonicalTitle,
      specialistId: 'coins',
      attributes: idResult.attributes ?? {},
      condition: idResult.condition ?? '',
      identificationConfidence: idResult.confidence ?? 0,
      identificationTier: idResult.confidenceTier ?? 'medium',
      numistaTypeId: idResult.numistaVerification?.typeId ? Number(idResult.numistaVerification.typeId) : null,
      numistaMatchScore: idResult.numistaMatchScore ?? 0,
      numistaMatchTier: idResult.numistaStatus ?? 'no_match',
      applyToItem: false,
    }).then(({ result, error }) => {
      setValuationLoading(false);
      if (error || !result) setValuationError(error ?? 'Valuation unavailable');
      else setValuationResult(result);
    });
  }, [activeTab, idResult, tenant]);

  // ── PRODUCTION FIX: Capture — camera first, show explicit picker on cancel ──
  // Previously: camera → fallback to library silently (confusing UX)
  // Now: camera → on cancel, show alert asking user to pick from library or cancel
  const handleCapture = useCallback(async (slotId: string, slotLabel: string) => {
    // Try camera first
    const cameraImg = await captureFromCamera();
    if (cameraImg) {
      const image: CapturedImage = { ...cameraImg, slotId, slotLabel };
      setCapturedImages(prev => {
        const existing = prev.findIndex(i => i.slotId === slotId);
        if (existing >= 0) { const updated = [...prev]; updated[existing] = image; return updated; }
        return [...prev, image];
      });
      return;
    }
    // Camera cancelled — offer library picker explicitly (no silent fallback)
    Alert.alert(
      'Add Photo',
      `Add ${slotLabel} photo from your library?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Choose from Library', onPress: async () => {
            const libImg = await pickFromLibrary(slotId, slotLabel);
            if (!libImg) return;
            setCapturedImages(prev => {
              const existing = prev.findIndex(i => i.slotId === slotId);
              if (existing >= 0) { const updated = [...prev]; updated[existing] = libImg; return updated; }
              return [...prev, libImg];
            });
          },
        },
      ],
    );
  }, []);

  const handleRemoveImage = useCallback((slotId: string) => {
    setCapturedImages(prev => prev.filter(i => i.slotId !== slotId));
  }, []);

  // ── PRODUCTION FIX: AI identification with double-tap lock ──────────────────
  // isIdentifyInFlight ref prevents concurrent calls even under rapid taps.
  // Quota is incremented server-side BEFORE AI call (server-side protection too).
  const handleIdentify = useCallback(async () => {
    if (capturedImages.length === 0) return;
    // Synchronous lock check — prevents second tap from entering before state update
    if (isIdentifyInFlight.current) return;
    isIdentifyInFlight.current = true;

    setIdentifying(true);
    setScanMode('processing');
    setAiError(null);

    const statusMsgs = [
      'Preparing coin images...',
      'Routing to Numismatics specialist...',
      'AI vision analysis...',
      'Cross-referencing Numista...',
      'Finalising identification...',
    ];
    for (const msg of statusMsgs) {
      setProcessingStatus(msg);
      await new Promise(r => setTimeout(r, 350));
    }

    const { result, error, quotaExceeded } = await identifyItemWithAI(
      capturedImages, 'coins', undefined, undefined,
      { tenantId: tenant?.id },
    );

    setIdentifying(false);
    setScanMode('idle');
    isIdentifyInFlight.current = false; // release lock after completion

    if (quotaExceeded) {
      setAiError(
        `Monthly quota reached (${quotaExceeded.used}/${quotaExceeded.limit} free identifications). ` +
        `Upgrade to Coin Flipper Pro for unlimited identifications.`,
      );
      return;
    }
    if (error || !result) {
      // PRODUCTION: never display a partial/unconfirmed result on error
      setAiError(error ?? 'Identification failed — please try again');
      return;
    }

    // Only set result after confirmed server response
    setIdResult(result);
    setValuationResult(null);
    setValuationLoading(false);
    setValuationError(null);
    setSavedItemId(null);
    setActiveTab('identify');

    // Announce result to screen readers
    AccessibilityInfo.announceForAccessibility(
      `Identification complete: ${result.canonicalTitle}, confidence ${Math.round(result.confidence * 100)}%`,
    );
  }, [capturedImages, tenant?.id, setScanMode]);

  // ── PRODUCTION FIX: Save to inventory with duplicate guard ─────────────────
  // isSaveInFlight ref prevents double-tap creating two DB items.
  // savedItemId check prevents saving the same result twice across re-renders.
  const handleSave = useCallback(async () => {
    if (!idResult || !tenant) return;
    // Guard 1: idempotency — if already saved, do not save again
    if (savedItemId) {
      showAlert('Already Saved', 'This coin is already in your inventory.');
      return;
    }
    // Guard 2: in-flight lock — prevents double-tap
    if (isSaveInFlight.current) return;
    isSaveInFlight.current = true;

    setIsSaving(true);
    const { item, error } = await saveIdentifiedItem(tenant.id, idResult, {
      mediaUris: capturedImages.map(i => i.uri),
    });
    setIsSaving(false);
    isSaveInFlight.current = false;

    if (error || !item) {
      showAlert('Save Failed', error ?? 'Could not save coin. Please try again.');
      return;
    }

    setSavedItemId(item.id);
    AccessibilityInfo.announceForAccessibility('Coin saved to inventory');

    if (capturedImages.length > 0) {
      setIsUploading(true);
      setUploadProgress('Uploading photos...');
      try {
        const { urls } = await uploadItemImages(item.id, capturedImages);
        if (urls.length > 0) {
          await updateItemMedia(tenant.id, item.id, urls);
          setUploadProgress(`${urls.length} photo${urls.length === 1 ? '' : 's'} saved`);
        } else {
          setUploadProgress('Photos saved locally');
        }
      } catch {
        setUploadProgress('Photos saved locally');
      } finally {
        setIsUploading(false);
      }
    }
  }, [idResult, tenant, capturedImages, savedItemId, showAlert]);

  // Reset all state for a new scan
  const handleReset = useCallback(() => {
    setCapturedImages([]);
    setIdResult(null);
    setAiError(null);
    setSavedItemId(null);
    setIsUploading(false);
    setUploadProgress('');
    setValuationResult(null);
    setValuationLoading(false);
    setValuationError(null);
    setProcessingStatus('');
    setScanMode('idle');
    // Reset in-flight locks
    isIdentifyInFlight.current = false;
    isSaveInFlight.current = false;
    setActiveTab('capture');
  }, [setScanMode]);

  if (showPaywall) return <CoinFlipperPaywall onBack={() => setShowPaywall(false)} />;

  return (
    <View style={main.container}>
      <StatusBar style="light" />

      {/* ── Header ── */}
      <View style={[main.header, { paddingTop: insets.top + Spacing.sm }]}>
        {!isHomeTab ? (
          <Pressable onPress={() => router.back()} style={main.backBtn} hitSlop={8} accessibilityLabel="Go back" accessibilityRole="button">
            <MaterialIcons name="arrow-back" size={20} color={CF.gold} />
          </Pressable>
        ) : <View style={{ width: 36 }} />}
        <Pressable onPress={() => setActiveTab('home')} style={main.logoArea} hitSlop={4} accessibilityRole="button" accessibilityLabel="Coin Flipper home">
          <View style={main.logoIcon}><MaterialIcons name="toll" size={14} color={CF.gold} /></View>
          <View>
            <Text style={main.logoText}>COIN FLIPPER</Text>
            <Text style={main.logoSub}>ANCIENT COINS • REAL VALUES</Text>
          </View>
          {isPremium ? <View style={main.proBadge}><Text style={main.proBadgeText}>PRO</Text></View> : null}
        </Pressable>
        <Pressable onPress={() => router.push('/(tabs)/inventory' as any)} style={main.myCoinsBtn} hitSlop={6} accessibilityLabel="View my coin inventory" accessibilityRole="button">
          <MaterialIcons name="inventory-2" size={16} color={CF.gold} />
        </Pressable>
      </View>

      {/* ── Tab bar ── */}
      <View style={main.tabBar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={main.tabBarContent}>
          {TABS.map(tab => {
            const active = activeTab === tab.id;
            const locked = ['value', 'reference', 'insights'].includes(tab.id) && !isPremium;
            return (
              <Pressable
                key={tab.id}
                onPress={() => handleTabSelect(tab.id)}
                accessibilityRole="tab"
                accessibilityLabel={locked ? `${tab.label} — Pro feature` : tab.label}
                accessibilityState={{ selected: active }}
                style={[main.tabItem, active && main.tabItemActive]}
              >
                <MaterialIcons name={(locked ? 'lock' : tab.icon) as any} size={14} color={active ? CF.gold : locked ? CF.textMuted : CF.textSub} />
                <Text style={[main.tabLabel, active && main.tabLabelActive, locked && { color: CF.textMuted }]}>{tab.label}</Text>
                {locked ? <View style={main.tabProPip} /> : null}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* ── Tab content ── */}
      <View style={{ flex: 1 }}>
        {activeTab === 'home' ? (
          <HomeTab onTabSelect={handleTabSelect} isPremium={isPremium} tenant={tenant} onUpgrade={() => setShowPaywall(true)} onPeriodSelect={setSelectedPeriod} selectedPeriod={selectedPeriod} />
        ) : activeTab === 'capture' ? (
          <CaptureTab capturedImages={capturedImages} onCapture={handleCapture} onRemove={handleRemoveImage} onIdentify={handleIdentify} identifying={identifying} processingStatus={processingStatus} aiError={aiError} onTabSelect={handleTabSelect} isPremium={isPremium} />
        ) : activeTab === 'identify' ? (
          <IdentifyTab result={idResult} capturedImages={capturedImages} onSave={handleSave} saving={isSaving} savedItemId={savedItemId} uploadProgress={uploadProgress} isUploading={isUploading} onReset={handleReset} onTabSelect={handleTabSelect} />
        ) : activeTab === 'reference' ? (
          <ReferenceTab result={idResult} selectedPeriod={selectedPeriod} onPeriodSelect={setSelectedPeriod} />
        ) : activeTab === 'value' ? (
          <ValueTab result={idResult} valuationResult={valuationResult} valuationLoading={valuationLoading} valuationError={valuationError} onTabSelect={handleTabSelect} />
        ) : activeTab === 'list_sell' ? (
          <ListSellTab savedItemId={savedItemId} result={idResult} onTabSelect={handleTabSelect} />
        ) : activeTab === 'insights' ? (
          <InsightsTab tenant={tenant} onTabSelect={handleTabSelect} />
        ) : null}
      </View>

      {/* ── Bottom upgrade bar ── */}
      {!isPremium && activeTab !== 'home' ? (
        <View style={[main.upgradeBar, { paddingBottom: insets.bottom + 4 }]}>
          <MaterialIcons name="workspace-premium" size={13} color={CF.black} />
          <Text style={main.upgradeBarText}>Upgrade to Coin Flipper Pro</Text>
          <Pressable onPress={() => setShowPaywall(true)} style={main.upgradeBarBtn} accessibilityRole="button" accessibilityLabel="Upgrade to Pro for £9.99 per month">
            <Text style={main.upgradeBarBtnText}>£9.99/mo</Text>
          </Pressable>
        </View>
      ) : <View style={{ height: insets.bottom }} />}
    </View>
  );
}

const main = StyleSheet.create({
  container: { flex: 1, backgroundColor: CF.black },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.base, paddingBottom: Spacing.sm, borderBottomWidth: 1, borderBottomColor: CF.border, backgroundColor: CF.black },
  backBtn: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: CF.goldDim, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: CF.gold + '30' },
  logoArea: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginLeft: 2 },
  logoIcon: { width: 28, height: 28, borderRadius: 14, backgroundColor: CF.goldDim, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: CF.gold + '50' },
  logoText: { fontSize: 14, fontWeight: Typography.weight.extrabold, color: CF.gold, letterSpacing: 1.5 },
  logoSub: { fontSize: 7, color: CF.textMuted, letterSpacing: 0.8 },
  proBadge: { backgroundColor: CF.gold, borderRadius: Radius.pill, paddingHorizontal: 6, paddingVertical: 2 },
  proBadgeText: { fontSize: 7, fontWeight: Typography.weight.extrabold, color: CF.black, letterSpacing: 1 },
  myCoinsBtn: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: CF.goldDim, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: CF.gold + '30' },
  tabBar: { backgroundColor: CF.surface, borderBottomWidth: 1, borderBottomColor: CF.border },
  tabBarContent: { paddingHorizontal: Spacing.sm, gap: 2, paddingVertical: 6 },
  tabItem: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: Spacing.md, paddingVertical: 7, borderRadius: Radius.md, position: 'relative' },
  tabItemActive: { backgroundColor: CF.goldDim },
  tabLabel: { fontSize: 10, fontWeight: Typography.weight.semibold, color: CF.textMuted },
  tabLabelActive: { color: CF.gold },
  tabProPip: { width: 4, height: 4, borderRadius: 2, backgroundColor: CF.goldMid, position: 'absolute', top: 4, right: 4 },
  upgradeBar: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: CF.gold, paddingHorizontal: Spacing.base, paddingTop: Spacing.sm },
  upgradeBarText: { flex: 1, fontSize: Typography.size.xs, fontWeight: Typography.weight.bold, color: CF.black },
  upgradeBarBtn: { backgroundColor: CF.black + '30', borderRadius: Radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
  upgradeBarBtnText: { fontSize: Typography.size.xs, fontWeight: Typography.weight.extrabold, color: CF.black },
});

/*
═══════════════════════════════════════════════════════════════════════════════
PRODUCTION READINESS REPORT — COIN FLIPPER
═══════════════════════════════════════════════════════════════════════════════

AUDIT FINDINGS
──────────────
CONFIRMED PRODUCTION-SAFE (unchanged):
✅ Outcome is entirely server-side — swish-identify edge function generates all
   AI results via OnSpace AI (Gemini). Client receives the server-confirmed
   result and cannot fabricate or alter it.
✅ Authentication enforced server-side — JWT validated, user identity derived
   from Supabase auth session. Client-supplied tenantId cross-checked against
   tenant_memberships to prevent cross-tenant spoofing.
✅ Quota enforced server-side — upsert_ai_usage() DB function with unique
   constraint (tenant_id, user_id, feature, month_key) prevents quota bypass.
   Usage is incremented BEFORE the expensive AI call. On AI failure, the
   increment is reversed server-side.
✅ DB unique constraint confirmed — ai_usage_tenant_user_feature_month_key
   ensures concurrent requests cannot double-count.
✅ All items have tenant_id (confirmed by DB check — 0 items without tenant).
✅ RLS policies enforce tenant isolation on all tables.
✅ No secrets exposed in client — all Stripe/eBay credentials server-side only.
✅ Premium status is server-authoritative — PREMIUM_TIERS checked from tenant
   subscription_tier (DB value, RLS-protected), Stripe is secondary.
✅ Subscription tier checked from DB on every identify call — cannot be spoofed.

PRODUCTION FIXES APPLIED IN THIS VERSION:
──────────────────────────────────────────
1. DOUBLE-TAP / CONCURRENT REQUEST LOCK (isIdentifyInFlight ref)
   Root cause: rapid double-tap could fire two simultaneous AI calls before
   React state could disable the button. Two calls both read quota < limit,
   both pass the free-quota check, consuming 2 quota slots and potentially
   creating 2 results.
   Fix: synchronous isIdentifyInFlight ref checked and set before async work
   begins. No re-render race — ref is set in the same JS event loop turn.

2. SAVE IDEMPOTENCY (isSaveInFlight ref + savedItemId guard)
   Root cause: double-tap on "Save to Inventory" created two DB items for the
   same identification result. Rapid saves within one session bypassed the
   isSaving state (which updates asynchronously).
   Fix: dual guard — (a) savedItemId check (if already saved, reject), (b)
   isSaveInFlight synchronous ref prevents second call entering.

3. CAPTURE UX FIX — explicit picker modal on camera cancel
   Root cause: previous code called captureFromCamera() then silently fell
   through to pickFromLibrary() on camera cancel. This launched the photo
   library unexpectedly without user intent.
   Fix: camera → on cancel, explicit Alert asking if user wants library access.
   No silent fallback.

4. INSIGHTS STATS NICHE-SCOPED
   Root cause: InsightsTab queried all tenant items (no specialist_id filter),
   so counts included MX/bike/clothing items in the coin stats display.
   Fix: queries now filter by COIN_SPECIALISTS (coins, islamic_silver,
   banknotes, gold, silver, ancient_artefacts, curiosities_collectibles).
   Same filter applied to listings and sales queries.

5. ACCESSIBILITY LABELS
   Added accessibilityRole, accessibilityLabel, accessibilityState, and
   accessibilityLiveRegion to all interactive elements and status areas.
   AI completion and save success announced via AccessibilityInfo.announceForAccessibility.

6. ERROR STATES NEVER SHOW UNCONFIRMED RESULTS
   On identification error, idResult is NOT set. UI shows error banner only.
   On save error, savedItemId is NOT set. Save button remains available to retry.
   Loading states disable all action buttons synchronously.

REMAINING LIMITATIONS (cannot be resolved without external service changes):
────────────────────────────────────────────────────────────────────────────
• eBay Terapeak (Product Research) requires an eBay Shop subscription and
  authenticated browser session — not available via public API. Currently
  returns 404 for accounts without Shop subscription.
• eBay Finding API blocked from OnSpace Cloud server IP (HTTP 418). Market
  value falls back to Gemini Vision estimates (labelled as AI inference).
• Rate limiting is currently per-user-per-month at the DB level (5 free).
  No per-minute or per-session rate limiting is implemented. Rapid calls
  within the same minute consume quota normally but concurrent quota checks
  are protected by the upsert_ai_usage atomic RPC.

DEPLOYMENT STEPS:
─────────────────
1. Deploy app update (this file) via OnSpace App Builder.
2. No DB migration required — existing schema is sufficient.
3. No new environment variables required.

ROLLBACK:
─────────
Revert to previous app/_layout.tsx commit if any regression is observed.
The backend (swish-identify edge function) is unchanged and compatible with
both the previous and current client code.

═══════════════════════════════════════════════════════════════════════════════
*/
