// Coin Flipper — Production-hardened niche entry point
//
// V2 ADDITIONS (merged flows):
//   1. Islamic specialist chip in Capture tab — sets specialistId='islamic_silver'
//      and enables Zeno/Numista evidence pipeline in swish-identify
//   2. Quick Mode — fires camera repeatedly without switching tabs (multi-capture)
//   3. Specialist chips: General | Islamic | Roman | Greek (pre-filter specialist)
//
// PRODUCTION CHANGES (retained from v1):
//   1. Double-tap protection — isInFlight ref prevents concurrent AI calls
//   2. Save idempotency — savedItemId guard prevents duplicate inventory items
//   3. Capture UX fix — camera launches, on cancel user is shown a picker modal
//   4. Insights stats query scoped to coins specialist only
//   5. Accessibility labels on all interactive controls
//   6. Error states never display unconfirmed results
//   7. Quota error clearly maps to upgrade flow with correct counts
//   8. All loading states disable buttons (no double-submit possible)

import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, Pressable, ScrollView,
  ActivityIndicator, Linking, Alert, AccessibilityInfo,
  TextInput, Modal, FlatList,
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
import {
  IslamicBatchItem,
  IslamicIdentificationResult,
  processIslamicBatch,
  saveIslamicBatchToInventory,
  BatchSaveProgress,
  getConfidenceColor,
  getWorkflowLabel,
} from '@/services/islamicIdentificationService';
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
  islamic:     '#B8860B', // golden-brown for Islamic specialist
};

// ── Specialist definitions ────────────────────────────────────────────────────
interface SpecialistChip {
  id: string;
  label: string;
  icon: string;
  color: string;
  hint: string;
  specialistId: string;
  periodId?: string;
}

const SPECIALIST_CHIPS: SpecialistChip[] = [
  { id: 'general',  label: 'General',  icon: 'toll',              color: CF.gold,    hint: 'All coins — AI chooses best specialist',            specialistId: 'coins' },
  { id: 'islamic',  label: 'Islamic',  icon: 'toll',              color: CF.islamic, hint: 'Umayyad · Abbasid · Fatimid · Mughal · Tanka',       specialistId: 'islamic_silver', periodId: 'islamic' },
  { id: 'roman',    label: 'Roman',    icon: 'local-fire-department', color: '#CD7F32', hint: 'Republic · Imperial · Provincial',               specialistId: 'coins', periodId: 'roman' },
  { id: 'greek',    label: 'Greek',    icon: 'account-balance',   color: '#D4AF37', hint: 'Athens · Macedonian · Hellenistic',                  specialistId: 'coins', periodId: 'greek' },
  { id: 'byzantine',label: 'Byzantine',icon: 'auto-awesome',      color: '#DAA520', hint: 'Gold · Follis · Emperors',                            specialistId: 'coins', periodId: 'byzantine' },
  { id: 'ancient',  label: 'Ancient',  icon: 'brightness-7',      color: '#C8A028', hint: 'Lydian · Persian · Egyptian',                        specialistId: 'ancient_artefacts', periodId: 'persian' },
];

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

// ── Islamic batch counter ─────────────────────────────────────────────────────
let _islamicBatchCounter = 0;
function newIslamicBatchId() { return `islamic_${++_islamicBatchCounter}_${Date.now()}`; }

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
    { icon: 'toll',           label: 'Islamic specialist engine (Zeno + Numista)' },
    { icon: 'burst-mode',     label: 'Quick Capture — rapid multi-coin scanning' },
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

// ── Islamic Batch Card (mini) for Quick Mode ──────────────────────────────────
function IslamicBatchMiniCard({ item, onPress }: { item: IslamicBatchItem; onPress: () => void }) {
  const r = item.result;
  const confColor = r ? getConfidenceColor(r.confidenceTier) : Colors.textTertiary;
  return (
    <Pressable onPress={onPress} style={ibc.card}>
      <View style={ibc.imgWrap}>
        {item.images[0] ? (
          <Image source={{ uri: item.images[0] }} style={ibc.img} contentFit="cover" />
        ) : (
          <MaterialIcons name="toll" size={16} color={Colors.textTertiary} />
        )}
        {item.status === 'processing' ? (
          <View style={StyleSheet.absoluteFill}>
            <ActivityIndicator size="small" color="#fff" style={{ flex: 1 }} />
          </View>
        ) : null}
      </View>
      <View style={{ flex: 1 }}>
        {r ? (
          <>
            <Text style={ibc.title} numberOfLines={1}>{r.canonicalTitle}</Text>
            <View style={[ibc.confPill, { backgroundColor: confColor + '20' }]}>
              <Text style={[ibc.confTxt, { color: confColor }]}>{Math.round(r.confidence * 100)}%</Text>
            </View>
          </>
        ) : item.status === 'error' ? (
          <Text style={ibc.error} numberOfLines={1}>{item.error ?? 'Error'}</Text>
        ) : (
          <Text style={ibc.pending}>Pending</Text>
        )}
      </View>
      <MaterialIcons name="chevron-right" size={14} color={Colors.textTertiary} />
    </Pressable>
  );
}
const ibc = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: CF.surface, borderRadius: Radius.md, padding: Spacing.sm, borderWidth: 1, borderColor: CF.border },
  imgWrap: { width: 40, height: 40, borderRadius: Radius.sm, backgroundColor: CF.surfaceHigh, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  img: { width: '100%', height: '100%' },
  title: { fontSize: 11, fontWeight: Typography.weight.semibold, color: CF.textPrimary },
  confPill: { borderRadius: Radius.pill, paddingHorizontal: 5, paddingVertical: 2, alignSelf: 'flex-start', marginTop: 2 },
  confTxt: { fontSize: 9, fontWeight: Typography.weight.bold },
  error: { fontSize: 10, color: Colors.danger },
  pending: { fontSize: 10, color: CF.textMuted, fontStyle: 'italic' },
});

// ── Capture tab ───────────────────────────────────────────────────────────────
function CaptureTab({
  capturedImages, onCapture, onRemove, onIdentify, identifying,
  processingStatus, aiError, onTabSelect, isPremium,
  // Specialist mode
  selectedSpecialist, onSpecialistChange,
  // Quick mode
  quickMode, onToggleQuickMode, quickCaptures, onQuickCapture, onRunQuickBatch,
  quickRunning, quickDone, onClearQuick,
  // Islamic batch results
  islamicBatchItems, onIslamicItemPress,
}: {
  capturedImages: CapturedImage[]; onCapture: (slotId: string, slotLabel: string) => void;
  onRemove: (slotId: string) => void; onIdentify: () => void; identifying: boolean;
  processingStatus: string; aiError: string | null; onTabSelect: (t: CFTab) => void; isPremium: boolean;
  selectedSpecialist: SpecialistChip; onSpecialistChange: (s: SpecialistChip) => void;
  quickMode: boolean; onToggleQuickMode: () => void;
  quickCaptures: Array<{ id: string; uri: string; label?: string }>;
  onQuickCapture: () => void; onRunQuickBatch: () => void;
  quickRunning: boolean; quickDone: boolean; onClearQuick: () => void;
  islamicBatchItems: IslamicBatchItem[]; onIslamicItemPress: (item: IslamicBatchItem) => void;
}) {
  const router = useRouter();
  const isIslamic = selectedSpecialist.id === 'islamic';
  const canIdentify = capturedImages.length > 0;
  const hasRequired = COIN_SLOTS.filter(s => s.required).every(s => capturedImages.some(i => i.slotId === s.id));
  const accentColor = selectedSpecialist.color;

  return (
    <View style={{ flex: 1 }}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={ct.content}>

        {/* ── Specialist chip selector ── */}
        <View style={ct.specialistSection}>
          <Text style={ct.specialistLabel}>SPECIALIST</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={ct.specialistChips}>
            {SPECIALIST_CHIPS.map(chip => {
              const active = selectedSpecialist.id === chip.id;
              return (
                <Pressable
                  key={chip.id}
                  onPress={() => onSpecialistChange(chip)}
                  accessibilityRole="button"
                  accessibilityLabel={`${chip.label} specialist: ${chip.hint}`}
                  accessibilityState={{ selected: active }}
                  style={({ pressed }) => [
                    ct.specialistChip,
                    active && { backgroundColor: chip.color + '20', borderColor: chip.color + '80' },
                    pressed && { opacity: 0.82 },
                  ]}
                >
                  <MaterialIcons name={chip.icon as any} size={13} color={active ? chip.color : CF.textMuted} />
                  <Text style={[ct.specialistChipText, active && { color: chip.color, fontWeight: Typography.weight.bold }]}>
                    {chip.label}
                  </Text>
                  {chip.id === 'islamic' ? (
                    <View style={[ct.specialistChipBadge, { backgroundColor: CF.islamic + '30' }]}>
                      <Text style={[ct.specialistChipBadgeText, { color: CF.islamic }]}>Zeno</Text>
                    </View>
                  ) : null}
                </Pressable>
              );
            })}
          </ScrollView>
          {/* Active specialist hint */}
          <View style={ct.specialistHintRow}>
            <MaterialIcons name="info-outline" size={10} color={accentColor} />
            <Text style={[ct.specialistHintText, { color: accentColor }]}>{selectedSpecialist.hint}</Text>
          </View>
        </View>

        {/* ── Mode toggle: Standard vs Quick ── */}
        <View style={ct.modeRow}>
          <Pressable
            onPress={() => { if (quickMode) onToggleQuickMode(); }}
            style={[ct.modeBtn, !quickMode && { backgroundColor: accentColor + '20', borderColor: accentColor + '60' }]}
            accessibilityRole="button"
            accessibilityLabel="Standard mode — photograph one coin at a time"
            accessibilityState={{ selected: !quickMode }}
          >
            <MaterialIcons name="photo-camera" size={14} color={!quickMode ? accentColor : CF.textMuted} />
            <Text style={[ct.modeBtnText, !quickMode && { color: accentColor, fontWeight: Typography.weight.bold }]}>Standard</Text>
          </Pressable>
          <Pressable
            onPress={() => { if (!quickMode) onToggleQuickMode(); }}
            style={[ct.modeBtn, quickMode && { backgroundColor: accentColor + '20', borderColor: accentColor + '60' }]}
            accessibilityRole="button"
            accessibilityLabel="Quick mode — capture multiple coins rapidly without switching tabs"
            accessibilityState={{ selected: quickMode }}
          >
            <MaterialIcons name="burst-mode" size={14} color={quickMode ? accentColor : CF.textMuted} />
            <Text style={[ct.modeBtnText, quickMode && { color: accentColor, fontWeight: Typography.weight.bold }]}>Quick</Text>
            <View style={ct.modeNewPip}><Text style={ct.modeNewPipText}>NEW</Text></View>
          </Pressable>
        </View>

        {/* ── QUICK MODE ── */}
        {quickMode ? (
          <View style={ct.quickSection}>
            {/* Info banner */}
            <View style={[ct.quickInfoBanner, { borderColor: accentColor + '30', backgroundColor: accentColor + '10' }]}>
              <MaterialIcons name="burst-mode" size={13} color={accentColor} />
              <Text style={[ct.quickInfoText, { color: accentColor }]}>
                Quick Mode — fire camera repeatedly. Each tap captures one coin and adds it to the batch. Tap Run Identification when done.
              </Text>
            </View>

            {/* Capture button */}
            <Pressable
              onPress={onQuickCapture}
              disabled={quickRunning}
              accessibilityRole="button"
              accessibilityLabel="Capture next coin photo"
              style={({ pressed }) => [
                ct.quickCaptureBtn,
                { backgroundColor: accentColor, shadowColor: accentColor },
                (pressed || quickRunning) && { opacity: 0.8 },
              ]}
            >
              <MaterialIcons name="add-a-photo" size={22} color={CF.black} />
              <Text style={ct.quickCaptureBtnText}>
                {quickCaptures.length === 0 ? 'Capture First Coin' : `Capture Coin #${quickCaptures.length + 1}`}
              </Text>
            </Pressable>

            {/* Quick capture thumbnails */}
            {quickCaptures.length > 0 ? (
              <View style={ct.quickThumbs}>
                <View style={ct.quickThumbsHeader}>
                  <Text style={ct.quickThumbsTitle}>{quickCaptures.length} coin{quickCaptures.length !== 1 ? 's' : ''} captured</Text>
                  <Pressable onPress={onClearQuick} hitSlop={8} accessibilityLabel="Clear all quick captures">
                    <Text style={ct.quickClearText}>Clear</Text>
                  </Pressable>
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: Spacing.sm, paddingVertical: Spacing.xs }}>
                  {quickCaptures.map((cap, i) => (
                    <View key={cap.id} style={ct.quickThumb}>
                      <Image source={{ uri: cap.uri }} style={ct.quickThumbImg} contentFit="cover" />
                      <View style={ct.quickThumbNum}>
                        <Text style={ct.quickThumbNumText}>{i + 1}</Text>
                      </View>
                    </View>
                  ))}
                </ScrollView>
              </View>
            ) : null}

            {/* Islamic batch results */}
            {isIslamic && islamicBatchItems.length > 0 ? (
              <View style={ct.islamicBatchSection}>
                <Text style={[ct.quickThumbsTitle, { color: CF.islamic }]}>ISLAMIC IDENTIFICATIONS</Text>
                <View style={{ gap: Spacing.xs }}>
                  {islamicBatchItems.map(item => (
                    <IslamicBatchMiniCard key={item.id} item={item} onPress={() => onIslamicItemPress(item)} />
                  ))}
                </View>
              </View>
            ) : null}

            {/* Run batch */}
            {quickCaptures.length > 0 && !quickRunning && !quickDone ? (
              <Pressable
                onPress={onRunQuickBatch}
                accessibilityRole="button"
                accessibilityLabel={`Run AI identification on ${quickCaptures.length} captured coins`}
                style={({ pressed }) => [ct.quickRunBtn, pressed && { opacity: 0.85 }]}
              >
                <MaterialIcons name="auto-awesome" size={18} color={CF.black} />
                <Text style={ct.quickRunBtnText}>
                  Identify {quickCaptures.length} Coin{quickCaptures.length !== 1 ? 's' : ''}
                  {isIslamic ? ' · Islamic Engine' : ''}
                </Text>
              </Pressable>
            ) : quickRunning ? (
              <View style={[ct.quickRunBtn, { opacity: 0.75 }]}>
                <ActivityIndicator size="small" color={CF.black} />
                <Text style={ct.quickRunBtnText}>Running Islamic pipeline...</Text>
              </View>
            ) : quickDone ? (
              <View style={[ct.quickRunBtn, { backgroundColor: CF.success }]}>
                <MaterialIcons name="check-circle" size={18} color={CF.black} />
                <Text style={ct.quickRunBtnText}>Done! Tap coins above to review</Text>
              </View>
            ) : null}
          </View>
        ) : (
          /* ── STANDARD MODE ── */
          <>
            {/* Islamic specialist banner */}
            {isIslamic ? (
              <View style={ct.islamicBanner}>
                <MaterialIcons name="toll" size={14} color={CF.islamic} />
                <View style={{ flex: 1 }}>
                  <Text style={ct.islamicBannerTitle}>Islamic Silver Mode</Text>
                  <Text style={ct.islamicBannerSub}>AI + Zeno.ru + Numista evidence pipeline · Countermark detection</Text>
                </View>
                <View style={ct.zenoChip}>
                  <Text style={ct.zenoChipText}>Zeno</Text>
                </View>
              </View>
            ) : null}

            <View style={ct.progressBar}>
              <View style={[ct.progressDot, { backgroundColor: capturedImages.length >= 2 ? CF.success : accentColor }]} />
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
                      style={({ pressed }) => [ct.slotInner, img ? ct.slotCaptured : ct.slotEmpty, slot.required && !img ? { ...ct.slotRequired, borderColor: accentColor + '50' } : null, pressed && { opacity: 0.82 }]}
                    >
                      {img ? (
                        <>
                          <Image source={{ uri: img.uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
                          <View style={ct.capturedBar}>
                            <MaterialIcons name="check-circle" size={10} color={CF.success} />
                            <Text style={ct.capturedLabel} numberOfLines={1}>{slot.label}</Text>
                            <Pressable onPress={e => { e.stopPropagation?.(); onCapture(slot.id, slot.label); }} style={ct.retakeBtn} hitSlop={6} accessibilityLabel={`Retake ${slot.label} photo`} accessibilityRole="button">
                              <MaterialIcons name="refresh" size={12} color="#fff" />
                            </Pressable>
                          </View>
                          <Pressable onPress={e => { e.stopPropagation?.(); onRemove(slot.id); }} style={ct.removeBtn} hitSlop={6} accessibilityLabel={`Remove ${slot.label} photo`} accessibilityRole="button">
                            <MaterialIcons name="close" size={11} color="#fff" />
                          </Pressable>
                        </>
                      ) : (
                        <View style={ct.emptySlot}>
                          <View style={[ct.emptyIcon, slot.required ? { ...ct.emptyIconRequired, backgroundColor: accentColor + '25' } : null]}>
                            <MaterialIcons name="add-a-photo" size={isFirst ? 26 : 20} color={slot.required ? accentColor : CF.textMuted} />
                          </View>
                          <Text style={[ct.emptyLabel, slot.required && { color: CF.textPrimary }]} numberOfLines={1}>{slot.label}</Text>
                          {slot.required ? <View style={[ct.requiredPill, { backgroundColor: accentColor + '20' }]}><Text style={[ct.requiredText, { color: accentColor }]}>Required</Text></View> : <Text style={ct.optionalText}>Optional</Text>}
                          {slot.hint && isFirst ? <Text style={ct.slotHint} numberOfLines={2}>{slot.hint}</Text> : null}
                        </View>
                      )}
                    </Pressable>
                  </View>
                );
              })}
            </View>

            <View style={ct.tip}>
              <MaterialIcons name="lightbulb-outline" size={13} color={accentColor} />
              <Text style={[ct.tipText, { color: accentColor }]}>
                {isIslamic
                  ? 'For Islamic coins: obverse + reverse required. Weight (g) and diameter (mm) significantly improve accuracy. Notes about seller description help too.'
                  : 'Obverse + Reverse gives the AI the most evidence. Edge and Detail boost confidence further.'}
              </Text>
            </View>

            {/* User-supplied evidence is available to all coin specialists, not just Islamic mode. */}
            <View style={ct.islamicMeasureCard}>
              <Text style={ct.islamicMeasureTitle}>COIN EVIDENCE (optional — improves identification)</Text>
              <View style={ct.islamicMeasureRow}>
                <View style={ct.islamicMeasureField}>
                  <Text style={ct.islamicMeasureLabel}>Weight (g)</Text>
                  <TextInput
                    style={ct.islamicMeasureInput}
                    value={weightInput}
                    onChangeText={setWeightInput}
                    placeholder="e.g. 7.77"
                    placeholderTextColor={CF.textMuted}
                    keyboardType="decimal-pad"
                    accessibilityLabel="Coin weight in grams"
                  />
                </View>
                <View style={ct.islamicMeasureField}>
                  <Text style={ct.islamicMeasureLabel}>Diameter (mm)</Text>
                  <TextInput
                    style={ct.islamicMeasureInput}
                    value={diameterInput}
                    onChangeText={setDiameterInput}
                    placeholder="e.g. 20.5"
                    placeholderTextColor={CF.textMuted}
                    keyboardType="decimal-pad"
                    accessibilityLabel="Coin diameter in millimetres"
                  />
                </View>
              </View>
              <View style={ct.islamicMeasureRow}>
                <View style={ct.islamicMeasureField}>
                  <Text style={ct.islamicMeasureLabel}>Year / date</Text>
                  <TextInput
                    style={ct.islamicMeasureInput}
                    value={yearInput}
                    onChangeText={setYearInput}
                    placeholder="e.g. 2007"
                    placeholderTextColor={CF.textMuted}
                    accessibilityLabel="Coin year or date"
                  />
                </View>
                <View style={ct.islamicMeasureField}>
                  <Text style={ct.islamicMeasureLabel}>Metal (if known)</Text>
                  <TextInput
                    style={ct.islamicMeasureInput}
                    value={materialInput}
                    onChangeText={setMaterialInput}
                    placeholder="e.g. bimetallic"
                    placeholderTextColor={CF.textMuted}
                    accessibilityLabel="Coin material"
                  />
                </View>
              </View>
              <View style={ct.islamicMeasureField}>
                <Text style={ct.islamicMeasureLabel}>Edge legend / other visible text</Text>
                <TextInput
                  style={ct.islamicMeasureInput}
                  value={edgeLegendInput}
                  onChangeText={setEdgeLegendInput}
                  placeholder="Enter the edge inscription exactly as seen"
                  placeholderTextColor={CF.textMuted}
                  accessibilityLabel="Coin edge legend or visible inscription"
                />
              </View>
            </View>

            <View style={{ height: 100 }} />
          </>
        )}
      </ScrollView>

      {/* Standard mode action bar */}
      {!quickMode ? (
        <View style={ct.actionBar}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={ct.actionCount}>{capturedImages.length} photo{capturedImages.length === 1 ? '' : 's'} captured</Text>
            {!hasRequired ? <Text style={ct.actionHint}>Obverse and Reverse required</Text> : <Text style={ct.actionReady}>Ready to identify</Text>}
          </View>
          <Pressable
            onPress={onIdentify}
            disabled={!canIdentify || identifying}
            accessibilityRole="button"
            accessibilityLabel={identifying ? processingStatus || 'Identifying coin, please wait' : canIdentify ? `Identify ${isIslamic ? 'Islamic silver' : ''} coin with AI` : 'Add at least one photo before identifying'}
            accessibilityState={{ disabled: !canIdentify || identifying, busy: identifying }}
            style={({ pressed }) => [ct.identifyBtn, { backgroundColor: accentColor, shadowColor: accentColor }, !canIdentify && ct.identifyBtnDisabled, pressed && canIdentify ? { opacity: 0.88 } : null]}
          >
            {identifying
              ? <ActivityIndicator size="small" color={CF.black} accessibilityLabel="Identifying" />
              : <MaterialIcons name={isIslamic ? 'toll' : 'auto-awesome'} size={18} color={canIdentify ? CF.black : CF.textMuted} />}
            <Text style={[ct.identifyBtnText, !canIdentify && { color: CF.textMuted }]}>
              {identifying ? processingStatus || 'Identifying...' : isIslamic ? 'Identify (Islamic Engine)' : 'Identify Coin'}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
const ct = StyleSheet.create({
  content: { padding: Spacing.base, gap: Spacing.md },

  // Specialist chips
  specialistSection: { gap: 6 },
  specialistLabel: { fontSize: 9, fontWeight: Typography.weight.extrabold, color: CF.textMuted, textTransform: 'uppercase', letterSpacing: 0.8 },
  specialistChips: { flexDirection: 'row', gap: Spacing.xs, paddingVertical: 2 },
  specialistChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 7, borderRadius: Radius.pill, backgroundColor: CF.surface, borderWidth: 1, borderColor: CF.border },
  specialistChipText: { fontSize: 11, color: CF.textSub, fontWeight: Typography.weight.medium },
  specialistChipBadge: { borderRadius: Radius.pill, paddingHorizontal: 5, paddingVertical: 2 },
  specialistChipBadgeText: { fontSize: 8, fontWeight: Typography.weight.bold },
  specialistHintRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 4 },
  specialistHintText: { flex: 1, fontSize: 10, lineHeight: 14 },

  // Mode toggle
  modeRow: { flexDirection: 'row', gap: Spacing.sm, backgroundColor: CF.surfaceHigh, borderRadius: Radius.lg, padding: 4, borderWidth: 1, borderColor: CF.border },
  modeBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 8, borderRadius: Radius.md, borderWidth: 1, borderColor: 'transparent', position: 'relative' },
  modeBtnText: { fontSize: 12, color: CF.textMuted, fontWeight: Typography.weight.medium },
  modeNewPip: { position: 'absolute', top: 2, right: 6, backgroundColor: Colors.success, borderRadius: Radius.pill, paddingHorizontal: 3, paddingVertical: 1 },
  modeNewPipText: { fontSize: 6, fontWeight: Typography.weight.extrabold, color: '#fff', letterSpacing: 0.3 },

  // Quick mode
  quickSection: { gap: Spacing.md },
  quickInfoBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, borderRadius: Radius.md, padding: Spacing.md, borderWidth: 1 },
  quickInfoText: { flex: 1, fontSize: Typography.size.xs, lineHeight: 16 },
  quickCaptureBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, borderRadius: Radius.xl, paddingVertical: Spacing.lg, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.5, shadowRadius: 14, elevation: 8 },
  quickCaptureBtnText: { fontSize: Typography.size.base, fontWeight: Typography.weight.extrabold, color: CF.black },
  quickThumbs: { gap: Spacing.xs },
  quickThumbsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  quickThumbsTitle: { fontSize: 10, fontWeight: Typography.weight.bold, color: CF.textSub, textTransform: 'uppercase', letterSpacing: 0.4 },
  quickClearText: { fontSize: 10, color: Colors.danger, fontWeight: Typography.weight.semibold },
  quickThumb: { width: 64, height: 64, borderRadius: Radius.md, overflow: 'hidden', position: 'relative' },
  quickThumbImg: { width: '100%', height: '100%' },
  quickThumbNum: { position: 'absolute', bottom: 2, right: 2, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 8, width: 16, height: 16, alignItems: 'center', justifyContent: 'center' },
  quickThumbNumText: { fontSize: 8, fontWeight: Typography.weight.bold, color: '#fff' },
  islamicBatchSection: { gap: Spacing.xs },
  quickRunBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, backgroundColor: CF.gold, borderRadius: Radius.xl, paddingVertical: Spacing.base, shadowColor: CF.gold, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.5, shadowRadius: 12, elevation: 6 },
  quickRunBtnText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.extrabold, color: CF.black },

  // Islamic standard mode
  islamicBanner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: CF.islamic + '15', borderRadius: Radius.md, padding: Spacing.md, borderWidth: 1, borderColor: CF.islamic + '40' },
  islamicBannerTitle: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: CF.islamic },
  islamicBannerSub: { fontSize: 10, color: CF.islamic + 'BB', lineHeight: 14, marginTop: 2 },
  zenoChip: { backgroundColor: CF.islamic + '25', borderRadius: Radius.pill, paddingHorizontal: 7, paddingVertical: 3, borderWidth: 1, borderColor: CF.islamic + '50' },
  zenoChipText: { fontSize: 9, fontWeight: Typography.weight.bold, color: CF.islamic },

  islamicMeasureCard: { backgroundColor: CF.surfaceHigh, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.sm, borderWidth: 1, borderColor: CF.border },
  islamicMeasureTitle: { fontSize: 9, fontWeight: Typography.weight.extrabold, color: CF.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  islamicMeasureRow: { flexDirection: 'row', gap: Spacing.sm },
  islamicMeasureField: { flex: 1, gap: 4 },
  islamicMeasureLabel: { fontSize: 10, fontWeight: Typography.weight.semibold, color: CF.textSub },
  islamicMeasureInput: { backgroundColor: CF.surface, borderRadius: Radius.md, borderWidth: 1, borderColor: CF.border, paddingHorizontal: Spacing.sm, paddingVertical: 8, fontSize: Typography.size.xs, color: CF.textPrimary, includeFontPadding: false },

  // Standard mode shared
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
  identifyBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, backgroundColor: CF.gold, borderRadius: Radius.md, padding: Spacing.md, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.4, shadowRadius: 10, elevation: 6 },
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
      <View style={idS.empty}>
        <MaterialIcons name="search" size={44} color={CF.textMuted} />
        <Text style={idS.emptyTitle}>No Identification Yet</Text>
        <Text style={idS.emptySub}>Go to Capture tab to photograph and identify a coin</Text>
        <Pressable onPress={() => onTabSelect('capture')} style={idS.emptyBtn} accessibilityRole="button" accessibilityLabel="Start capturing photos">
          <MaterialIcons name="photo-camera" size={16} color={CF.black} />
          <Text style={idS.emptyBtnText}>Start Capture</Text>
        </Pressable>
      </View>
    );
  }
  const conf = result.confidence;
  const confColor = CONFIDENCE_COLOR(conf);
  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={idS.content}>
      {savedItemId ? (
        <View style={idS.savedBanner} accessibilityRole="alert" accessibilityLiveRegion="polite">
          <MaterialIcons name="check-circle" size={18} color={CF.success} />
          <View style={{ flex: 1 }}>
            <Text style={idS.savedText}>Saved to inventory</Text>
            {uploadProgress ? <Text style={idS.savedSub}>{uploadProgress}</Text> : null}
          </View>
        </View>
      ) : null}
      <View style={idS.resultCard}>
        <View style={[idS.confBadge, { borderColor: confColor }]}>
          <Text style={[idS.confPct, { color: confColor }]}>{Math.round(conf * 100)}%</Text>
          <Text style={[idS.confLabel, { color: confColor }]}>{conf >= 0.85 ? 'HIGH' : conf >= 0.65 ? 'MED' : 'LOW'}</Text>
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={idS.resultTitle}>{result.canonicalTitle}</Text>
          <Text style={idS.resultCondition}>{result.condition}{result.conditionGrade ? ` · ${result.conditionGrade}` : ''}</Text>
          <View style={idS.sourcRow}><MaterialIcons name="verified" size={11} color={CF.textMuted} /><Text style={idS.sourceText}>{result.identificationSource}</Text></View>
        </View>
      </View>
      {capturedImages.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: Spacing.sm }}>
          {capturedImages.map(img => <Image key={img.slotId} source={{ uri: img.uri }} style={idS.thumb} contentFit="cover" />)}
        </ScrollView>
      ) : null}
      {result.numistaStatus && result.numistaStatus !== 'unavailable' ? (
        <View style={[idS.numistaCard, { borderColor: (result.numistaStatus === 'verified' || result.numistaStatus === 'strong_match') ? CF.success + '40' : Colors.warning + '30' }]}>
          <MaterialIcons name={result.numistaStatus === 'verified' || result.numistaStatus === 'strong_match' ? 'verified' : 'help-outline'} size={13} color={result.numistaStatus === 'verified' || result.numistaStatus === 'strong_match' ? CF.success : Colors.warning} />
          <View style={{ flex: 1 }}>
            <Text style={idS.numistaStatus}>{String(result.numistaStatus).replace(/_/g, ' ').toUpperCase()}</Text>
            {result.numistaTitle ? <Text style={idS.numistaTitle} numberOfLines={2}>{result.numistaTitle}</Text> : null}
            {result.numistaN ? <Text style={idS.numistaRef}>{result.numistaN}</Text> : null}
          </View>
          {result.numistaMatchScore && result.numistaMatchScore > 0 ? <Text style={idS.numistaScore}>{result.numistaMatchScore}/100</Text> : null}
        </View>
      ) : null}
      {(result.evidenceSupporting.length > 0 || result.missingInformation.length > 0) ? (
        <View style={idS.evidenceCard}>
          <Text style={idS.evidenceTitle}>EVIDENCE</Text>
          {result.evidenceSupporting.slice(0, 4).map((e, i) => (<View key={i} style={idS.evidenceRow}><MaterialIcons name="check" size={11} color={CF.success} /><Text style={idS.evidenceText}>{e}</Text></View>))}
          {result.missingInformation.slice(0, 2).map((m, i) => (<View key={i} style={idS.evidenceRow}><MaterialIcons name="help-outline" size={11} color={Colors.warning} /><Text style={[idS.evidenceText, { color: Colors.warning }]}>{m}</Text></View>))}
        </View>
      ) : null}
      {Object.keys(result.attributes).length > 0 ? (
        <View style={idS.attrsCard}>
          <Text style={idS.evidenceTitle}>COIN ATTRIBUTES</Text>
          {Object.entries(result.attributes).filter(([k]) => !k.startsWith('_') && !['object_type', 'identification_state', 'numista_url'].includes(k)).slice(0, 12).map(([k, v]) => (
            <View key={k} style={idS.attrRow}>
              <Text style={idS.attrKey}>{k.replace(/_/g, ' ')}</Text>
              <Text style={idS.attrValue}>{String(v)}</Text>
            </View>
          ))}
        </View>
      ) : null}
      <View style={idS.actions}>
        <Pressable onPress={onReset} style={idS.resetBtn} accessibilityRole="button" accessibilityLabel="Start a new scan">
          <Text style={idS.resetText}>New Scan</Text>
        </Pressable>
        {savedItemId ? (
          <Pressable onPress={() => router.push(`/create-listing?id=${savedItemId}` as any)} style={idS.primaryBtn} accessibilityRole="button" accessibilityLabel={isUploading ? 'Uploading photos, please wait' : 'Create eBay listing for this coin'} accessibilityState={{ busy: isUploading }}>
            {isUploading ? <ActivityIndicator size="small" color={CF.black} /> : <MaterialIcons name="sell" size={18} color={CF.black} />}
            <Text style={idS.primaryBtnText}>{isUploading ? 'Uploading...' : 'List on eBay'}</Text>
          </Pressable>
        ) : (
          <Pressable onPress={onSave} disabled={saving} accessibilityRole="button" accessibilityLabel={saving ? 'Saving coin to inventory, please wait' : 'Save this coin to your inventory'} accessibilityState={{ disabled: saving, busy: saving }} style={idS.primaryBtn}>
            {saving ? <ActivityIndicator size="small" color={CF.black} /> : <MaterialIcons name="add" size={18} color={CF.black} />}
            <Text style={idS.primaryBtnText}>{saving ? 'Saving...' : 'Save to Inventory'}</Text>
          </Pressable>
        )}
      </View>
    </ScrollView>
  );
}
const idS = StyleSheet.create({
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
    { label: 'Zeno.ru', url: 'https://zeno.ru',        color: '#F44336' },
    { label: 'RSC',     url: 'https://www.wildwinds.com', color: '#2196F3' },
    { label: 'SNG',     url: 'https://sngenglish.com',  color: '#9C27B0' },
    { label: 'RIC',     url: 'https://numismatica-classica.lamoneta.it', color: '#FF9800' },
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

  const COIN_SPECIALISTS = ['coins', 'coins_uk', 'coins_world', 'islamic_silver', 'banknotes', 'gold', 'silver', 'ancient_artefacts', 'curiosities_collectibles'];

  useEffect(() => {
    if (!tenant?.id) { setLoading(false); return; }
    const supabase = getSupabaseClient();
    Promise.all([
      supabase.from('items').select('id, status, expected_selling_price').eq('tenant_id', tenant.id).in('specialist_id', COIN_SPECIALISTS),
      supabase.from('listings').select('id, items!inner(specialist_id)').eq('tenant_id', tenant.id).eq('status', 'active').in('items.specialist_id', COIN_SPECIALISTS),
      supabase.from('sales').select('sale_price, items!inner(specialist_id)').eq('tenant_id', tenant.id).in('items.specialist_id', COIN_SPECIALISTS),
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
    { icon: 'inventory-2',  label: 'Full Inventory',    sub: 'Browse all coins in stock',           color: CF.gold,        action: () => router.push('/(tabs)/inventory' as any) },
    { icon: 'trending-up',  label: 'Business Insights', sub: 'Revenue, profit, and performance',    color: Colors.info,    action: () => router.push('/money' as any) },
    { icon: 'price-change', label: 'Repricing Engine',  sub: 'Automatically adjust listing prices', color: Colors.warning, action: () => router.push('/repricing' as any) },
    { icon: 'receipt',      label: 'Orders',            sub: 'Manage and fulfil orders',            color: CF.success,     action: () => router.push('/orders' as any) },
  ];

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={ins.content}>
      {loading ? (
        <View style={{ alignItems: 'center', paddingVertical: Spacing.xl }} accessibilityLabel="Loading stats"><ActivityIndicator color={CF.gold} /></View>
      ) : stats ? (
        <View style={ins.statsGrid}>
          {[
            { label: 'Coins in Stock',  value: String(stats.items),               icon: 'toll',                    color: CF.gold   },
            { label: 'Active Listings', value: String(stats.listed),              icon: 'storefront',              color: Colors.info },
            { label: 'Total Sold',      value: String(stats.sold),                icon: 'check-circle',            color: CF.success },
            { label: 'Portfolio Value', value: `£${stats.totalValue.toFixed(0)}`, icon: 'account-balance-wallet',  color: CF.bronze },
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

  // ── Specialist selection ───────────────────────────────────────────────────
  // Defaults to 'general'. Selecting 'islamic' changes the AI pipeline.
  const [selectedSpecialist, setSelectedSpecialist] = useState<SpecialistChip>(SPECIALIST_CHIPS[0]);

  const handleSpecialistChange = useCallback((chip: SpecialistChip) => {
    setSelectedSpecialist(chip);
    // Sync period browser with the specialist
    if (chip.periodId) setSelectedPeriod(chip.periodId);
  }, []);

  // ── Capture state ───────────────────────────────────────────────────────────
  const [capturedImages, setCapturedImages] = useState<CapturedImage[]>([]);
  // Optional hard evidence for every coin identification (web and native).
  // These values must be sent to swish-identify rather than being UI-only.
  const [weightInput, setWeightInput] = useState('');
  const [diameterInput, setDiameterInput] = useState('');
  const [yearInput, setYearInput] = useState('');
  const [materialInput, setMaterialInput] = useState('');
  const [edgeLegendInput, setEdgeLegendInput] = useState('');

  // ── Quick Mode ─────────────────────────────────────────────────────────────
  // Multi-coin rapid-fire capture without leaving the Capture tab.
  const [quickMode, setQuickMode] = useState(false);
  const [quickCaptures, setQuickCaptures] = useState<Array<{ id: string; uri: string }>>([]);
  const [quickRunning, setQuickRunning] = useState(false);
  const [quickDone, setQuickDone] = useState(false);

  // Islamic batch items produced by Quick Mode
  const [islamicBatchItems, setIslamicBatchItems] = useState<IslamicBatchItem[]>([]);
  const [selectedIslamicItem, setSelectedIslamicItem] = useState<IslamicBatchItem | null>(null);

  // ── In-flight locks ─────────────────────────────────────────────────────────
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
      specialistId: selectedSpecialist.specialistId,
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
  }, [activeTab, idResult, tenant, selectedSpecialist.specialistId]);

  // ── Capture handler ─────────────────────────────────────────────────────────
  const handleCapture = useCallback(async (slotId: string, slotLabel: string) => {
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
    // Camera cancelled — offer library picker explicitly
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
              const existing = prev.findIndex(i => i.slotId !== slotId);
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

  // ── Quick Mode: single-shot capture (fire camera, add to batch) ─────────────
  const handleQuickCapture = useCallback(async () => {
    if (quickRunning) return;
    const cameraImg = await captureFromCamera();
    if (cameraImg) {
      setQuickCaptures(prev => [...prev, { id: `qc_${Date.now()}`, uri: cameraImg.uri }]);
      setQuickDone(false);
      return;
    }
    // Fallback: library
    Alert.alert('Capture Coin', 'Camera cancelled — choose from library?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Choose from Library', onPress: async () => {
          const libImg = await pickFromLibrary('quick', 'Coin');
          if (libImg) {
            setQuickCaptures(prev => [...prev, { id: `qc_${Date.now()}`, uri: libImg.uri }]);
            setQuickDone(false);
          }
        },
      },
    ]);
  }, [quickRunning]);

  const handleClearQuick = useCallback(() => {
    setQuickCaptures([]);
    setIslamicBatchItems([]);
    setQuickDone(false);
  }, []);

  // ── Quick Mode: run batch identification ────────────────────────────────────
  const handleRunQuickBatch = useCallback(async () => {
    if (!tenant || quickCaptures.length === 0 || quickRunning) return;
    setQuickRunning(true);
    setQuickDone(false);
    const isIslamic = selectedSpecialist.id === 'islamic';

    if (isIslamic) {
      // Islamic pipeline: use processIslamicBatch
      const batchItems: IslamicBatchItem[] = quickCaptures.map(cap => ({
        id: newIslamicBatchId(),
        images: [cap.uri],
        status: 'pending',
        label: `Coin ${quickCaptures.indexOf(cap) + 1}`,
      }));
      setIslamicBatchItems(batchItems.map(i => ({ ...i })));

      await processIslamicBatch(
        batchItems,
        tenant.id,
        (_processed, _total, updatedItem) => {
          setIslamicBatchItems(prev => prev.map(i => i.id === updatedItem.id ? updatedItem : i));
        },
      );

      // Auto-save to inventory
      const completed = batchItems.filter(i => i.status === 'complete');
      if (completed.length > 0) {
        await saveIslamicBatchToInventory(tenant.id, completed, () => {});
      }
    } else {
      // General pipeline: identify each capture individually
      for (const cap of quickCaptures) {
        if (isIdentifyInFlight.current) { await new Promise(r => setTimeout(r, 300)); continue; }
        isIdentifyInFlight.current = true;
        const tempImg: CapturedImage = { uri: cap.uri, slotId: 'obverse', slotLabel: 'Obverse', base64: undefined as any };
        const { result } = await identifyItemWithAI([tempImg], selectedSpecialist.specialistId, undefined, undefined, { tenantId: tenant.id });
        isIdentifyInFlight.current = false;
        if (result) {
          const { item } = await saveIdentifiedItem(tenant.id, result, { mediaUris: [cap.uri] });
          if (item && [cap.uri].length > 0) {
            try {
              const { urls } = await uploadItemImages(item.id, [tempImg]);
              if (urls.length > 0) await updateItemMedia(tenant.id, item.id, urls);
            } catch { /* non-blocking */ }
          }
        }
        await new Promise(r => setTimeout(r, 400));
      }
    }

    setQuickRunning(false);
    setQuickDone(true);
  }, [tenant, quickCaptures, quickRunning, selectedSpecialist]);

  // ── AI identification (standard mode) ──────────────────────────────────────
  const handleIdentify = useCallback(async () => {
    if (capturedImages.length === 0) return;
    if (isIdentifyInFlight.current) return;
    isIdentifyInFlight.current = true;

    setIdentifying(true);
    setScanMode('processing');
    setAiError(null);
    const isIslamic = selectedSpecialist.id === 'islamic';

    const statusMsgs = isIslamic
      ? ['Preparing coin images...', 'Islamic specialist routing...', 'AI vision analysis...', 'Searching Zeno.ru...', 'Cross-referencing Numista...']
      : ['Preparing coin images...', 'Routing to Numismatics specialist...', 'AI vision analysis...', 'Cross-referencing Numista...', 'Finalising identification...'];

    for (const msg of statusMsgs) {
      setProcessingStatus(msg);
      await new Promise(r => setTimeout(r, 350));
    }

    const { result, error, quotaExceeded } = await identifyItemWithAI(
      capturedImages,
      selectedSpecialist.specialistId,
      undefined,
      {
        ...(weightInput.trim() && Number.isFinite(Number(weightInput.replace(',', '.'))) && Number(weightInput.replace(',', '.')) > 0
          ? { weight: Number(weightInput.replace(',', '.')) } : {}),
        ...(diameterInput.trim() && Number.isFinite(Number(diameterInput.replace(',', '.'))) && Number(diameterInput.replace(',', '.')) > 0
          ? { diameter: Number(diameterInput.replace(',', '.')) } : {}),
        ...(yearInput.trim() ? { yearMade: yearInput.trim() } : {}),
        ...(materialInput.trim() ? { material: materialInput.trim() } : {}),
        ...(edgeLegendInput.trim() ? { edgeLegend: edgeLegendInput.trim() } : {}),
      },
      { tenantId: tenant?.id },
    );

    setIdentifying(false);
    setScanMode('idle');
    isIdentifyInFlight.current = false;

    if (quotaExceeded) {
      setAiError(
        `Monthly quota reached (${quotaExceeded.used}/${quotaExceeded.limit} free identifications). ` +
        `Upgrade to Coin Flipper Pro for unlimited identifications.`,
      );
      return;
    }
    if (error || !result) {
      setAiError(error ?? 'Identification failed — please try again');
      return;
    }

    setIdResult(result);
    setValuationResult(null);
    setValuationLoading(false);
    setValuationError(null);
    setSavedItemId(null);
    setActiveTab('identify');

    AccessibilityInfo.announceForAccessibility(
      `Identification complete: ${result.canonicalTitle}, confidence ${Math.round(result.confidence * 100)}%`,
    );
  }, [capturedImages, tenant?.id, setScanMode, selectedSpecialist, weightInput, diameterInput, yearInput, materialInput, edgeLegendInput]);

  // ── Save to inventory ───────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (!idResult || !tenant) return;
    if (savedItemId) { showAlert('Already Saved', 'This coin is already in your inventory.'); return; }
    if (isSaveInFlight.current) return;
    isSaveInFlight.current = true;

    setIsSaving(true);
    const { item, error } = await saveIdentifiedItem(tenant.id, idResult, { mediaUris: capturedImages.map(i => i.uri) });
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
    setSelectedSpecialist(SPECIALIST_CHIPS[0]);
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
        {/* Specialist indicator in header */}
        {activeTab === 'capture' && selectedSpecialist.id !== 'general' ? (
          <View style={[main.specialistIndicator, { backgroundColor: selectedSpecialist.color + '20', borderColor: selectedSpecialist.color + '50' }]}>
            <MaterialIcons name={selectedSpecialist.icon as any} size={11} color={selectedSpecialist.color} />
            <Text style={[main.specialistIndicatorText, { color: selectedSpecialist.color }]}>{selectedSpecialist.label}</Text>
          </View>
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.xs }}>
            <Pressable
              onPress={() => router.push('/deep-id-lab' as any)}
              style={main.myCoinsBtn}
              hitSlop={6}
              accessibilityLabel="Open Deep ID and Re-ID Lab"
              accessibilityRole="button"
            >
              <MaterialIcons name="science" size={17} color={CF.gold} />
            </Pressable>
            <Pressable onPress={() => router.push('/(tabs)/inventory' as any)} style={main.myCoinsBtn} hitSlop={6} accessibilityLabel="View my coin inventory" accessibilityRole="button">
              <MaterialIcons name="inventory-2" size={16} color={CF.gold} />
            </Pressable>
          </View>
        )}
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
                {/* Quick mode indicator on Capture tab */}
                {tab.id === 'capture' && quickMode ? (
                  <View style={main.quickPip}><MaterialIcons name="burst-mode" size={8} color={CF.gold} /></View>
                ) : null}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* ── Tab content ── */}
      <View style={{ flex: 1 }}>
        {activeTab === 'home' ? (
          <HomeTab onTabSelect={handleTabSelect} isPremium={isPremium} tenant={tenant} onUpgrade={() => setShowPaywall(true)} onPeriodSelect={p => { setSelectedPeriod(p); const chip = SPECIALIST_CHIPS.find(c => c.periodId === p); if (chip) setSelectedSpecialist(chip); }} selectedPeriod={selectedPeriod} />
        ) : activeTab === 'capture' ? (
          <CaptureTab
            capturedImages={capturedImages}
            onCapture={handleCapture}
            onRemove={handleRemoveImage}
            onIdentify={handleIdentify}
            identifying={identifying}
            processingStatus={processingStatus}
            aiError={aiError}
            onTabSelect={handleTabSelect}
            isPremium={isPremium}
            selectedSpecialist={selectedSpecialist}
            onSpecialistChange={handleSpecialistChange}
            quickMode={quickMode}
            onToggleQuickMode={() => { setQuickMode(v => !v); setQuickDone(false); }}
            quickCaptures={quickCaptures}
            onQuickCapture={handleQuickCapture}
            onRunQuickBatch={handleRunQuickBatch}
            quickRunning={quickRunning}
            quickDone={quickDone}
            onClearQuick={handleClearQuick}
            islamicBatchItems={islamicBatchItems}
            onIslamicItemPress={setSelectedIslamicItem}
          />
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

      {/* Islamic batch item detail modal (mini) */}
      {selectedIslamicItem ? (
        <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setSelectedIslamicItem(null)}>
          <View style={{ flex: 1, backgroundColor: Colors.background }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.base, paddingTop: Spacing.lg, borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder }}>
              <Pressable onPress={() => setSelectedIslamicItem(null)} hitSlop={8} style={{ width: 36, height: 36, borderRadius: Radius.md, backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center' }}>
                <MaterialIcons name="close" size={18} color={Colors.textSecondary} />
              </Pressable>
              <Text style={{ flex: 1, fontSize: Typography.size.base, fontWeight: Typography.weight.bold, color: Colors.textPrimary }} numberOfLines={1}>
                {selectedIslamicItem.result?.canonicalTitle ?? 'Islamic Coin'}
              </Text>
            </View>
            <ScrollView contentContainerStyle={{ padding: Spacing.base, gap: Spacing.md }}>
              {selectedIslamicItem.result ? (
                <>
                  <View style={{ backgroundColor: Colors.surface, borderRadius: Radius.xl, padding: Spacing.base, gap: Spacing.sm, borderWidth: 1, borderColor: Colors.surfaceBorder }}>
                    <Text style={{ fontSize: Typography.size.lg, fontWeight: Typography.weight.bold, color: Colors.textPrimary }}>{selectedIslamicItem.result.canonicalTitle}</Text>
                    <Text style={{ fontSize: Typography.size.sm, color: Colors.textSecondary }}>{selectedIslamicItem.result.coinFamily}</Text>
                    <View style={{ flexDirection: 'row', gap: Spacing.sm }}>
                      <View style={{ backgroundColor: getConfidenceColor(selectedIslamicItem.result.confidenceTier) + '20', borderRadius: Radius.pill, paddingHorizontal: 8, paddingVertical: 4 }}>
                        <Text style={{ fontSize: 11, fontWeight: Typography.weight.bold, color: getConfidenceColor(selectedIslamicItem.result.confidenceTier) }}>
                          {Math.round(selectedIslamicItem.result.confidence * 100)}% confidence
                        </Text>
                      </View>
                    </View>
                  </View>
                  {selectedIslamicItem.result.observations?.obverse ? (
                    <View style={{ backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: Spacing.md, gap: 4, borderWidth: 1, borderColor: Colors.surfaceBorder }}>
                      <Text style={{ fontSize: 9, fontWeight: Typography.weight.bold, color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5 }}>OBSERVATIONS</Text>
                      {selectedIslamicItem.result.observations.obverse ? <Text style={{ fontSize: Typography.size.xs, color: Colors.textSecondary }}>Obverse: {selectedIslamicItem.result.observations.obverse}</Text> : null}
                      {selectedIslamicItem.result.observations.reverse ? <Text style={{ fontSize: Typography.size.xs, color: Colors.textSecondary }}>Reverse: {selectedIslamicItem.result.observations.reverse}</Text> : null}
                      {selectedIslamicItem.result.observations.condition ? <Text style={{ fontSize: Typography.size.xs, color: Colors.textSecondary }}>Condition: {selectedIslamicItem.result.observations.condition}</Text> : null}
                    </View>
                  ) : null}
                  {selectedIslamicItem.result.warnings.length > 0 ? (
                    <View style={{ backgroundColor: Colors.warning + '10', borderRadius: Radius.md, padding: Spacing.md, gap: 4, borderWidth: 1, borderColor: Colors.warning + '30' }}>
                      {selectedIslamicItem.result.warnings.map((w, i) => (
                        <Text key={i} style={{ fontSize: Typography.size.xs, color: Colors.warning, lineHeight: 16 }}>⚠ {w}</Text>
                      ))}
                    </View>
                  ) : null}
                  <Text style={{ fontSize: Typography.size.xs, color: Colors.textTertiary, textAlign: 'center', fontStyle: 'italic', lineHeight: 16 }}>
                    {selectedIslamicItem.result.marketEvidenceNote}
                  </Text>
                </>
              ) : (
                <View style={{ alignItems: 'center', paddingVertical: 40, gap: Spacing.md }}>
                  <ActivityIndicator color={CF.islamic} />
                  <Text style={{ color: Colors.textTertiary }}>Identifying...</Text>
                </View>
              )}
            </ScrollView>
          </View>
        </Modal>
      ) : null}
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
  specialistIndicator: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: Radius.pill, paddingHorizontal: 8, paddingVertical: 5, borderWidth: 1 },
  specialistIndicatorText: { fontSize: 10, fontWeight: Typography.weight.bold },
  tabBar: { backgroundColor: CF.surface, borderBottomWidth: 1, borderBottomColor: CF.border },
  tabBarContent: { paddingHorizontal: Spacing.sm, gap: 2, paddingVertical: 6 },
  tabItem: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: Spacing.md, paddingVertical: 7, borderRadius: Radius.md, position: 'relative' },
  tabItemActive: { backgroundColor: CF.goldDim },
  tabLabel: { fontSize: 10, fontWeight: Typography.weight.semibold, color: CF.textMuted },
  tabLabelActive: { color: CF.gold },
  tabProPip: { width: 4, height: 4, borderRadius: 2, backgroundColor: CF.goldMid, position: 'absolute', top: 4, right: 4 },
  quickPip: { position: 'absolute', top: 2, right: 2, width: 12, height: 12, borderRadius: 6, backgroundColor: CF.gold + '30', alignItems: 'center', justifyContent: 'center' },
  upgradeBar: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: CF.gold, paddingHorizontal: Spacing.base, paddingTop: Spacing.sm },
  upgradeBarText: { flex: 1, fontSize: Typography.size.xs, fontWeight: Typography.weight.bold, color: CF.black },
  upgradeBarBtn: { backgroundColor: CF.black + '30', borderRadius: Radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
  upgradeBarBtnText: { fontSize: Typography.size.xs, fontWeight: Typography.weight.extrabold, color: CF.black },
});
