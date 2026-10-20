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
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import type { SpecialistId } from '@/constants/specialists';
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
  saveCoinReferenceImages,
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
import { processCoinImage, CoinImageTool } from '@/services/coinImageProcessing';
import { generateCoinImageReference } from '@/services/coinImageEnhancementService';

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
  specialistId: SpecialistId;
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
type QuickCoinResult = { id: string; label: string; images: string[]; status: 'pending' | 'complete' | 'error'; result?: AIIdentificationResult; error?: string; itemId?: string };

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
    { label: 'Scan Coin',     icon: 'photo-camera',   tab: 'capture'   as CFTab, pro: false, subtitle: 'Photograph both sides' },
    { label: 'My Coins',      icon: 'inventory-2',    tab: null,                 pro: false, route: '/(tabs)/inventory', subtitle: 'Your collection' },
    { label: 'Identify',      icon: 'auto-awesome',   tab: 'identify'  as CFTab, pro: false, subtitle: 'AI + catalogue evidence' },
    { label: 'Value',         icon: 'bar-chart',      tab: 'value'     as CFTab, pro: true, subtitle: 'Market evidence' },
    { label: 'Reference',     icon: 'menu-book',      tab: 'reference' as CFTab, pro: true, subtitle: 'Numista & catalogues' },
    { label: 'List & Sell',   icon: 'sell',           tab: 'list_sell' as CFTab, pro: false, subtitle: 'Create eBay listing' },
    { label: 'Insights',      icon: 'trending-up',    tab: 'insights'  as CFTab, pro: true, subtitle: 'Collection intelligence' },
    { label: 'Quick Capture', icon: 'burst-mode',     tab: 'capture'   as CFTab, pro: false, subtitle: 'Scan a batch', quick: true },
  ];
  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={ht.content}>
      <View style={ht.hero}>
        <View style={ht.heroReticleWrap}>
          <Reticle size={106} color={CF.gold} />
          <View style={ht.heroLogoCenter}><MaterialIcons name="toll" size={42} color={CF.gold} /></View>
        </View>
        <Text style={ht.heroTitle}>COIN FLIPPER</Text>
        <Text style={ht.heroTagline}>ANCIENT COINS • REAL VALUES • SMARTER DECISIONS</Text>
        <Text style={ht.heroPromise}>HISTORY IDENTIFIED. OPPORTUNITY REALISED.</Text>
        {isPremium ? (
          <View style={ht.proBadge}>
            <MaterialIcons name="workspace-premium" size={11} color={CF.black} />
            <Text style={ht.proBadgeText}>PRO</Text>
          </View>
        ) : null}
      </View>

      <View style={ht.sectionHeading}>
        <Text style={ht.sectionLabel}>YOUR COIN WORKFLOW</Text>
        <Text style={ht.sectionHint}>Capture · identify · verify · value · sell</Text>
      </View>
      <View style={ht.grid}>
        {FEATURES.map((f, index) => {
          const locked = f.pro && !isPremium;
          return (
            <Pressable
              key={f.label}
              onPress={() => { if (locked) { onUpgrade(); return; } if (f.route) { router.push(f.route as any); return; } if (f.tab) onTabSelect(f.tab); }}
              accessibilityRole="button"
              accessibilityLabel={locked ? `${f.label} — Pro feature, tap to upgrade` : f.label}
              style={({ pressed }) => [ht.gridItem, pressed && { opacity: 0.82, transform: [{ scale: 0.985 }] }]}
            >
              <View style={ht.gridTopRow}>
                <Text style={ht.gridIndex}>{String(index + 1).padStart(2, '0')}</Text>
                {locked ? <MaterialIcons name="lock" size={13} color={CF.textMuted} /> : f.quick ? <MaterialIcons name="bolt" size={13} color={CF.gold} /> : null}
              </View>
              <View style={[ht.gridIcon, locked && { backgroundColor: CF.border }]}>
                <MaterialIcons name={locked ? 'lock' : f.icon as any} size={23} color={locked ? CF.textMuted : CF.gold} />
              </View>
              <Text style={[ht.gridLabel, locked && { color: CF.textMuted }]} numberOfLines={1}>{f.label}</Text>
              <Text style={ht.gridSub} numberOfLines={2}>{f.subtitle}</Text>
              {locked ? <View style={ht.gridProPill}><Text style={ht.gridProText}>PRO</Text></View> : null}
            </Pressable>
          );
        })}
      </View>

      <View style={ht.sectionHeading}>
        <Text style={ht.sectionLabel}>BROWSE BY CIVILISATION</Text>
        <Text style={ht.sectionHint}>Choose a period to focus your next scan</Text>
      </View>
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
            <View style={{ flex: 1 }}>
              <Text style={ht.upgradeBannerText}>Unlock Coin Flipper Pro</Text>
              <Text style={ht.upgradeBannerSub}>Islamic specialist · advanced market evidence · deeper references</Text>
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
  sectionHeading: { gap: 4 },
  sectionLabel: { fontSize: 9, fontWeight: Typography.weight.extrabold, color: CF.goldMid, textTransform: 'uppercase', letterSpacing: 1.3 },
  sectionHint: { fontSize: 11, color: CF.textMuted, lineHeight: 15 },
  hero: { alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.xl, paddingHorizontal: Spacing.md, borderRadius: Radius.xxl, borderWidth: 1, borderColor: CF.border, backgroundColor: '#100D08' },
  heroReticleWrap: { position: 'relative', alignItems: 'center', justifyContent: 'center' },
  heroLogoCenter: { position: 'absolute' },
  heroTitle: { fontSize: 27, fontWeight: Typography.weight.extrabold, color: CF.gold, letterSpacing: 3.2 },
  heroTagline: { fontSize: 9, color: CF.textSub, letterSpacing: 1.4, textAlign: 'center' },
  heroPromise: { fontSize: 8, color: CF.goldMid, letterSpacing: 1.6, textAlign: 'center', marginTop: 2, fontWeight: Typography.weight.bold },
  proBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: CF.gold, borderRadius: Radius.pill, paddingHorizontal: 10, paddingVertical: 3, marginTop: 2 },
  proBadgeText: { fontSize: 9, fontWeight: Typography.weight.extrabold, color: CF.black, letterSpacing: 1.5 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  gridItem: { width: '48%', minHeight: 148, backgroundColor: CF.surface, borderRadius: Radius.xl, padding: Spacing.md, alignItems: 'flex-start', gap: 7, borderWidth: 1, borderColor: CF.border },
  gridTopRow: { width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  gridIndex: { fontSize: 9, color: CF.textMuted, letterSpacing: 1.2, fontWeight: Typography.weight.bold },
  gridIcon: { width: 42, height: 42, borderRadius: Radius.md, backgroundColor: CF.goldDim, alignItems: 'center', justifyContent: 'center' },
  gridLabel: { fontSize: 12, fontWeight: Typography.weight.bold, color: CF.textPrimary },
  gridSub: { fontSize: 10, color: CF.textSub, lineHeight: 14 },
  gridProPill: { backgroundColor: CF.goldDim, borderRadius: Radius.pill, paddingHorizontal: 6, paddingVertical: 2, position: 'absolute', top: 10, right: 10 },
  gridProText: { fontSize: 7, fontWeight: Typography.weight.extrabold, color: CF.gold, letterSpacing: 0.5 },
  periodDetail: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: CF.surface, borderRadius: Radius.xl, padding: Spacing.base, borderWidth: 1 },
  periodDetailIcon: { width: 48, height: 48, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  periodDetailName: { fontSize: Typography.size.base, fontWeight: Typography.weight.extrabold },
  periodDetailSub: { fontSize: Typography.size.xs, color: CF.textSub, lineHeight: 16 },
  periodDetailRange: { fontSize: 10, color: CF.textMuted },
  periodDetailBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  periodDetailBtnText: { fontSize: Typography.size.xs, fontWeight: Typography.weight.extrabold, color: CF.black },
  upgradeBanner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: CF.gold, borderRadius: Radius.xxl, paddingVertical: Spacing.base, paddingHorizontal: Spacing.lg, gap: Spacing.sm, shadowColor: CF.gold, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.32, shadowRadius: 14, elevation: 5 },
  upgradeLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, flex: 1 },
  upgradeBannerText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.extrabold, color: CF.black },
  upgradeBannerSub: { fontSize: 9, color: CF.black + 'AA', lineHeight: 13, marginTop: 2 },
  upgradePriceChip: { alignItems: 'center', marginLeft: 4 },
  upgradePriceText: { fontSize: Typography.size.xl, fontWeight: Typography.weight.extrabold, color: CF.black },
  upgradePriceSub: { fontSize: 9, color: CF.black + 'AA' },
  premiumConfirmed: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: CF.goldDim, borderRadius: Radius.xl, padding: Spacing.md, borderWidth: 1, borderColor: CF.gold + '40' },
  premiumConfirmedText: { fontSize: Typography.size.sm, color: CF.gold, fontWeight: Typography.weight.semibold },
});
// ── Capture tab ───────────────────────────────────────────────────────────────
function CaptureTab({
  capturedImages, onCapture, onRemove, onIdentify, onProcessImage, onRestoreImage, identifying,
  processingStatus, aiError, onTabSelect, isPremium,
  // Specialist mode
  selectedSpecialist, onSpecialistChange,
  // Quick mode
  quickMode, onToggleQuickMode, quickCaptures, onQuickCapture, onRunQuickBatch,
  quickRunning, quickDone, onClearQuick,
  quickIdentificationResults, selectedQuickResult, onQuickResultSelect, onCloseQuickResult,
  // Islamic batch results
  islamicBatchItems, selectedIslamicItem, onIslamicItemPress,
  // Optional physical evidence passed into the AI identification request
  weightInput, setWeightInput, diameterInput, setDiameterInput,
  yearInput, setYearInput, materialInput, setMaterialInput,
  edgeLegendInput, setEdgeLegendInput,
}: {
  capturedImages: CapturedImage[]; onCapture: (slotId: string, slotLabel: string) => void;
  onRemove: (slotId: string) => void; onIdentify: () => void;
  onProcessImage: (mode: CoinImageTool, slotId: string) => Promise<void>;
  onRestoreImage: (slotId: string) => void; identifying: boolean;
  processingStatus: string; aiError: string | null; onTabSelect: (t: CFTab) => void; isPremium: boolean;
  selectedSpecialist: SpecialistChip; onSpecialistChange: (s: SpecialistChip) => void;
  quickMode: boolean; onToggleQuickMode: () => void;
  quickCaptures: Array<{ id: string; uri: string; reverseUri?: string; label?: string }>;
  onQuickCapture: () => void; onRunQuickBatch: () => void;
  quickRunning: boolean; quickDone: boolean; onClearQuick: () => void;
  quickIdentificationResults: QuickCoinResult[]; selectedQuickResult: QuickCoinResult | null;
  onQuickResultSelect: (result: QuickCoinResult) => void; onCloseQuickResult: () => void;
  islamicBatchItems: IslamicBatchItem[]; selectedIslamicItem: IslamicBatchItem | null; onIslamicItemPress: (item: IslamicBatchItem | null) => void;
  weightInput: string; setWeightInput: (value: string) => void;
  diameterInput: string; setDiameterInput: (value: string) => void;
  yearInput: string; setYearInput: (value: string) => void;
  materialInput: string; setMaterialInput: (value: string) => void;
  edgeLegendInput: string; setEdgeLegendInput: (value: string) => void;
}) {
  const router = useRouter();
  const [activeSide, setActiveSide] = useState<'obverse' | 'reverse'>('obverse');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [captureToolNotice, setCaptureToolNotice] = useState<'detect' | 'enhance' | null>(null);
  const [processingImage, setProcessingImage] = useState(false);
  const isIslamic = selectedSpecialist.id === 'islamic';
  const incompleteQuickCoins = quickCaptures.filter(coin => !coin.reverseUri).length;
  const completeQuickCoins = quickCaptures.length - incompleteQuickCoins;
  const hasRequired = COIN_SLOTS.filter(s => s.required).every(s => capturedImages.some(i => i.slotId === s.id));
  const imageProcessing = capturedImages.some(i => (i.slotId === 'obverse' || i.slotId === 'reverse') && i.enhancementStatus === 'processing');
  const canIdentify = hasRequired && !imageProcessing;
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

            {aiError ? <View style={ct.errorBanner} accessibilityRole="alert"><MaterialIcons name="error-outline" size={15} color={CF.danger} /><Text style={ct.errorText} numberOfLines={5}>{aiError}</Text></View> : null}

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
                {quickCaptures.length === 0 ? 'Capture Obverse — Coin #1' : incompleteQuickCoins > 0 ? `Capture Reverse — Coin #${quickCaptures.findIndex(coin => !coin.reverseUri) + 1}` : `Capture Obverse — Coin #${quickCaptures.length + 1}`}
              </Text>
            </Pressable>

            {/* Quick capture thumbnails */}
            {quickCaptures.length > 0 ? (
              <View style={ct.quickThumbs}>
                <View style={ct.quickThumbsHeader}>
                  <Text style={ct.quickThumbsTitle}>{completeQuickCoins} complete · {incompleteQuickCoins} awaiting reverse</Text>
                  <Pressable onPress={onClearQuick} hitSlop={8} accessibilityLabel="Clear all quick captures">
                    <Text style={ct.quickClearText}>Clear</Text>
                  </Pressable>
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: Spacing.sm, paddingVertical: Spacing.xs }}>
                  {quickCaptures.map((cap, i) => {
                    const result = quickIdentificationResults.find(entry => entry.id === cap.id);
                    return (
                      <Pressable key={cap.id} onPress={() => { if (result) onQuickResultSelect(result); else { const islamicResult = islamicBatchItems.find(item => item.label === `Coin ${i + 1}`); if (islamicResult) onIslamicItemPress(islamicResult); } }} accessibilityRole="button" accessibilityLabel={result ? `Review ${result.label} identification` : `Coin ${i + 1}, ${cap.reverseUri ? 'awaiting identification' : 'reverse needed'}`} style={[ct.quickThumb, { flexDirection: 'row' }]}>
                        <View style={{ flex: 1, overflow: 'hidden' }}><Image source={{ uri: cap.uri }} style={ct.quickThumbImg} contentFit="cover" /><Text style={ct.quickSideLabel}>FRONT</Text></View>
                        <View style={{ flex: 1, overflow: 'hidden', backgroundColor: CF.surfaceHigh }}>{cap.reverseUri ? <Image source={{ uri: cap.reverseUri }} style={ct.quickThumbImg} contentFit="cover" /> : <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><MaterialIcons name="add-a-photo" size={14} color={CF.textMuted} /></View>}<Text style={ct.quickSideLabel}>{cap.reverseUri ? 'BACK' : 'ADD BACK'}</Text></View>
                        <View style={ct.quickThumbNum}><Text style={ct.quickThumbNumText}>{i + 1}</Text></View>
                        {result ? <View style={{ position: 'absolute', top: 2, right: 2, borderRadius: 8, backgroundColor: result.status === 'error' ? CF.danger : result.status === 'complete' ? CF.success : CF.gold, paddingHorizontal: 3, paddingVertical: 1 }}><Text style={{ fontSize: 7, fontWeight: Typography.weight.bold, color: CF.black }}>{result.status === 'error' ? '!' : result.status === 'complete' ? '✓' : '…'}</Text></View> : null}
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </View>
            ) : null}

            {selectedQuickResult ? (
              <View style={{ backgroundColor: CF.surface, borderColor: CF.gold + '55', borderWidth: 1, borderRadius: Radius.xl, padding: Spacing.md, gap: Spacing.sm }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }}>
                  <Text style={{ flex: 1, color: CF.gold, fontWeight: Typography.weight.bold, fontSize: Typography.size.base }}>{selectedQuickResult.label} · Review</Text>
                  <Pressable onPress={onCloseQuickResult} accessibilityRole="button" accessibilityLabel="Close coin review"><MaterialIcons name="close" size={18} color={CF.textPrimary} /></Pressable>
                </View>
                {selectedQuickResult.result ? <>
                  <Text style={{ color: CF.textPrimary, fontSize: Typography.size.sm, fontWeight: Typography.weight.bold }}>{selectedQuickResult.result.canonicalTitle}</Text>
                  <Text style={{ color: CF.textSub, fontSize: Typography.size.xs }}>{Math.round(selectedQuickResult.result.confidence * 100)}% confidence · {selectedQuickResult.result.identificationState ?? 'Candidate'}</Text>
                  <Text style={{ color: CF.textSub, fontSize: Typography.size.xs }}>Condition: {selectedQuickResult.result.condition || 'Not established'}</Text>
                  {selectedQuickResult.result.evidenceSupporting.slice(0, 3).map((evidence, i) => <Text key={i} style={{ color: CF.textSub, fontSize: Typography.size.xs }}>• {evidence}</Text>)}
                  {selectedQuickResult.itemId ? <Text style={{ color: CF.success, fontSize: Typography.size.xs }}>Saved to inventory</Text> : null}
                </> : <Text style={{ color: CF.textSub, fontSize: Typography.size.xs }}>{selectedQuickResult.error ?? 'Identification pending…'}</Text>}
                {selectedQuickResult.error && selectedQuickResult.result ? <Text style={{ color: Colors.warning, fontSize: Typography.size.xs }}>{selectedQuickResult.error}</Text> : null}
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
                {selectedIslamicItem ? (
                  <View style={{ backgroundColor: CF.surface, borderColor: CF.gold + '55', borderWidth: 1, borderRadius: Radius.xl, padding: Spacing.md, gap: Spacing.sm }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }}><Text style={{ flex: 1, color: CF.gold, fontWeight: Typography.weight.bold, fontSize: Typography.size.base }}>Review coin</Text><Pressable onPress={() => onIslamicItemPress(null)} accessibilityRole="button" accessibilityLabel="Close coin review"><MaterialIcons name="close" size={18} color={CF.textPrimary} /></Pressable></View>
                    {selectedIslamicItem.result ? <><Text style={{ color: CF.textPrimary, fontSize: Typography.size.sm, fontWeight: Typography.weight.bold }}>{selectedIslamicItem.result.canonicalTitle}</Text><Text style={{ color: CF.textSub, fontSize: Typography.size.xs }}>{Math.round(selectedIslamicItem.result.confidence * 100)}% confidence · {selectedIslamicItem.result.identificationState.replace(/_/g, ' ')}</Text><Text style={{ color: CF.textSub, fontSize: Typography.size.xs }}>Obverse: {selectedIslamicItem.result.observations.obverse || 'No observation returned'}</Text><Text style={{ color: CF.textSub, fontSize: Typography.size.xs }}>Reverse: {selectedIslamicItem.result.observations.reverse || 'No observation returned'}</Text><Text style={{ color: CF.textSub, fontSize: Typography.size.xs }}>Countermark: {selectedIslamicItem.result.countermark.description || selectedIslamicItem.result.countermark.status}</Text>{selectedIslamicItem.result.warnings.slice(0, 3).map((warning, i) => <Text key={i} style={{ color: Colors.warning, fontSize: Typography.size.xs }}>• {warning}</Text>)}</> : <Text style={{ color: selectedIslamicItem.status === 'error' ? CF.danger : CF.textSub, fontSize: Typography.size.xs }}>{selectedIslamicItem.error ?? (selectedIslamicItem.status === 'processing' ? 'Identification is still running…' : 'No result is available for this coin.')}</Text>}
                  </View>
                ) : null}
              </View>
            ) : null}

            {/* Run batch */}
            {quickCaptures.length > 0 && incompleteQuickCoins > 0 && !quickRunning ? (
              <View style={[ct.quickInfoBanner, { borderColor: accentColor + '50', backgroundColor: accentColor + '12' }]}><MaterialIcons name="flip" size={15} color={accentColor} /><Text style={[ct.quickInfoText, { color: accentColor }]}>Capture the reverse side of every coin before identification. {incompleteQuickCoins} coin{incompleteQuickCoins === 1 ? '' : 's'} still need the back.</Text></View>
            ) : null}
            {completeQuickCoins > 0 && incompleteQuickCoins === 0 && !quickRunning && !quickDone ? (
              <Pressable
                onPress={onRunQuickBatch}
                accessibilityRole="button"
                accessibilityLabel={`Run AI identification on ${completeQuickCoins} complete coins`}
                style={({ pressed }) => [ct.quickRunBtn, pressed && { opacity: 0.85 }]}
              >
                <MaterialIcons name="auto-awesome" size={18} color={CF.black} />
                <Text style={ct.quickRunBtnText}>
                  Identify {completeQuickCoins} Coin{completeQuickCoins !== 1 ? 's' : ''}
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
          /* ── STANDARD MODE: dedicated Coin Flipper capture experience ── */
          <>
            <View style={ct.captureHeader}>
              <Pressable onPress={() => onTabSelect('home')} style={ct.captureBack} accessibilityRole="button" accessibilityLabel="Back to Coin Flipper home">
                <MaterialIcons name="arrow-back" size={21} color={CF.textPrimary} />
              </Pressable>
              <Text style={ct.captureTitle}>CAPTURE COIN</Text>
              <View style={{ width: 36 }} />
            </View>

            <View style={ct.sideToggle}>
              {(['obverse', 'reverse'] as const).map(side => (
                <Pressable key={side} onPress={() => setActiveSide(side)} accessibilityRole="button" accessibilityState={{ selected: activeSide === side }} style={[ct.sideButton, activeSide === side && ct.sideButtonActive]}>
                  <Text style={[ct.sideButtonText, activeSide === side && ct.sideButtonTextActive]}>{side === 'obverse' ? 'Obverse' : 'Reverse'}</Text>
                </Pressable>
              ))}
            </View>

            {aiError ? (
              <View style={ct.errorBanner} accessibilityRole="alert">
                <MaterialIcons name="error-outline" size={15} color={CF.danger} />
                <Text style={ct.errorText} numberOfLines={4}>{aiError}</Text>
              </View>
            ) : null}

            <Pressable
              onPress={() => onCapture(activeSide, activeSide === 'obverse' ? 'Obverse' : 'Reverse')}
              accessibilityRole="button"
              accessibilityLabel={capturedImages.some(i => i.slotId === activeSide) ? `Retake ${activeSide} photo` : `Photograph ${activeSide}`}
              style={({ pressed }) => [ct.heroCapture, pressed && { opacity: 0.88 }]}
            >
              {capturedImages.find(i => i.slotId === activeSide) ? (
                <Image source={{ uri: capturedImages.find(i => i.slotId === activeSide)!.uri }} style={ct.heroCaptureImage} contentFit="contain" />
              ) : (
                <>
                  <View style={ct.framingGuide}>
                    <View style={[ct.corner, ct.cornerTL]} /><View style={[ct.corner, ct.cornerTR]} />
                    <View style={[ct.corner, ct.cornerBL]} /><View style={[ct.corner, ct.cornerBR]} />
                    <View style={ct.heroPlaceholder}>
                      <MaterialIcons name="photo-camera" size={58} color={CF.textPrimary} />
                      <Text style={ct.heroPlaceholderTitle}>Tap to photograph</Text>
                      <Text style={ct.heroPlaceholderSub}>{activeSide === 'obverse' ? 'Head / front face' : 'Tail / back face'}</Text>
                    </View>
                  </View>
                </>
              )}
              <View style={ct.heroCaptureBadge}>
                <MaterialIcons name={capturedImages.some(i => i.slotId === activeSide) ? 'check-circle' : 'add-a-photo'} size={14} color={CF.gold} />
                <Text style={ct.heroCaptureBadgeText}>{capturedImages.some(i => i.slotId === activeSide) ? 'Captured · Tap image to retake' : `Capture ${activeSide === 'obverse' ? 'Obverse' : 'Reverse'}`}</Text>
              </View>
            </Pressable>

            {capturedImages.find(i => i.slotId === activeSide)?.enhancementStatus === 'processing' ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4, paddingVertical: 8 }}>
                <ActivityIndicator size="small" color={CF.gold} />
                <Text style={{ color: CF.textSub, fontSize: 12 }}>Creating AI-rendered reference… original photo is preserved and unchanged.</Text>
              </View>
            ) : null}
            {capturedImages.find(i => i.slotId === activeSide)?.enhancedUri ? (
              <View style={{ gap: 6, padding: Spacing.sm, borderWidth: 1, borderColor: CF.gold + '50', borderRadius: Radius.lg, backgroundColor: CF.surface }}>
                <Text style={{ color: CF.gold, fontSize: 10, fontWeight: Typography.weight.extrabold, letterSpacing: 1 }}>AI-RENDERED REFERENCE · NOT THE ORIGINAL</Text>
                <Image source={{ uri: capturedImages.find(i => i.slotId === activeSide)!.enhancedUri! }} style={{ width: '100%', height: 220, borderRadius: Radius.md }} contentFit="contain" />
                <Text style={{ color: CF.textSub, fontSize: 10, lineHeight: 14 }}>Used as extra visual evidence during identification. Your original photo remains the one saved for listing.</Text>
              </View>
            ) : null}

            <View style={ct.captureTools}>
              <Pressable onPress={() => setCaptureToolNotice('detect')} style={ct.toolButton} accessibilityRole="button" accessibilityLabel="Auto detect coin boundary">
                <MaterialIcons name="center-focus-strong" size={22} color={CF.gold} />
                <Text style={ct.toolLabel}>Auto detect</Text>
              </Pressable>
              <Pressable onPress={() => setCaptureToolNotice('enhance')} style={ct.toolButton} accessibilityRole="button" accessibilityLabel="Enhance coin photo">
                <MaterialIcons name="contrast" size={22} color={CF.gold} />
                <Text style={ct.toolLabel}>Enhance</Text>
              </Pressable>
              <Pressable onPress={() => { setCaptureToolNotice(null); setShowAdvanced(v => !v); }} style={ct.toolButton} accessibilityRole="button" accessibilityLabel="Toggle high detail coin specifications">
                <MaterialIcons name="zoom-in" size={22} color={CF.gold} />
                <Text style={ct.toolLabel}>High detail</Text>
              </Pressable>
            </View>

            <View style={ct.captureProgress}>
              <Text style={ct.captureProgressText}>{capturedImages.filter(i => i.slotId === 'obverse' || i.slotId === 'reverse').length}/2 sides captured</Text>
              <View style={ct.captureProgressDots}>
                {(['obverse', 'reverse'] as const).map(side => <View key={side} style={[ct.captureProgressDot, capturedImages.some(i => i.slotId === side) && ct.captureProgressDotDone]} />)}
              </View>
            </View>

            {captureToolNotice ? (
              <View style={ct.advancedCard}>
                <Text style={ct.advancedTitle}>{captureToolNotice === 'detect' ? 'AUTO-DETECT COIN BOUNDARY' : 'ENHANCE PHOTO'}</Text>
                <Text style={ct.advancedHint}>
                  {captureToolNotice === 'detect'
                    ? 'Analyses background contrast and crops around the likely coin boundary with a safety margin. It will refuse uncertain detections rather than guess. Check that the full rim remains visible.'
                    : 'Creates a separate copy with restrained brightness and contrast adjustment. It does not invent detail; the original remains available to restore.'}
                </Text>
                {!capturedImages.some(i => i.slotId === activeSide) ? (
                  <Text style={ct.advancedHint}>Capture the {activeSide} first to use this tool.</Text>
                ) : (
                  <Pressable
                    disabled={processingImage}
                    onPress={async () => {
                      setProcessingImage(true);
                      try { await onProcessImage(captureToolNotice, activeSide); setCaptureToolNotice(null); }
                      catch (error) { Alert.alert(captureToolNotice === 'detect' ? 'Boundary not detected' : 'Enhancement failed', error instanceof Error ? error.message : 'The photo was not changed. Please try again.'); }
                      finally { setProcessingImage(false); }
                    }}
                    accessibilityRole="button"
                    accessibilityState={{ busy: processingImage, disabled: processingImage }}
                    style={[ct.toolButton, { alignSelf: 'stretch', backgroundColor: CF.gold, borderRadius: Radius.md, paddingHorizontal: Spacing.md, marginTop: Spacing.xs }]}
                  >
                    {processingImage ? <ActivityIndicator size="small" color={CF.black} /> : <MaterialIcons name={captureToolNotice === 'detect' ? 'center-focus-strong' : 'contrast'} size={16} color={CF.black} />}
                    <Text style={[ct.toolLabel, { color: CF.black }]}>{processingImage ? 'Processing photo…' : captureToolNotice === 'detect' ? 'Detect and crop coin' : 'Apply enhancement'}</Text>
                  </Pressable>
                )}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.md }}>
                  <Pressable onPress={() => { onRestoreImage(activeSide); setCaptureToolNotice(null); }} accessibilityRole="button" style={[ct.toolButton, { alignSelf: 'flex-start', paddingHorizontal: Spacing.md }]}><Text style={ct.toolLabel}>Restore original</Text></Pressable>
                  <Pressable onPress={() => setCaptureToolNotice(null)} accessibilityRole="button" style={[ct.toolButton, { alignSelf: 'flex-start', paddingHorizontal: Spacing.md }]}><Text style={ct.toolLabel}>Close</Text></Pressable>
                </View>
              </View>
            ) : null}

            {showAdvanced ? (
              <View style={ct.advancedCard}>
                <Text style={ct.advancedTitle}>SPECIALIST & COIN DETAILS</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={ct.specialistChips}>
                  {SPECIALIST_CHIPS.map(chip => {
                    const active = selectedSpecialist.id === chip.id;
                    return <Pressable key={chip.id} onPress={() => onSpecialistChange(chip)} style={[ct.specialistChip, active && { backgroundColor: chip.color + '20', borderColor: chip.color + '80' }]}><MaterialIcons name={chip.icon as any} size={13} color={active ? chip.color : CF.textMuted} /><Text style={[ct.specialistChipText, active && { color: chip.color }]}>{chip.label}</Text></Pressable>;
                  })}
                </ScrollView>
                <Text style={ct.advancedHint}>{selectedSpecialist.hint}</Text>
                <View style={ct.islamicMeasureRow}>
                  <View style={ct.islamicMeasureField}><Text style={ct.islamicMeasureLabel}>Weight (g)</Text><TextInput style={ct.islamicMeasureInput} value={weightInput} onChangeText={setWeightInput} placeholder="e.g. 7.77" placeholderTextColor={CF.textMuted} keyboardType="decimal-pad" /></View>
                  <View style={ct.islamicMeasureField}><Text style={ct.islamicMeasureLabel}>Diameter (mm)</Text><TextInput style={ct.islamicMeasureInput} value={diameterInput} onChangeText={setDiameterInput} placeholder="e.g. 24" placeholderTextColor={CF.textMuted} keyboardType="decimal-pad" /></View>
                </View>
                <View style={ct.islamicMeasureRow}>
                  <View style={ct.islamicMeasureField}><Text style={ct.islamicMeasureLabel}>Year / date</Text><TextInput style={ct.islamicMeasureInput} value={yearInput} onChangeText={setYearInput} placeholder="Optional" placeholderTextColor={CF.textMuted} /></View>
                  <View style={ct.islamicMeasureField}><Text style={ct.islamicMeasureLabel}>Material</Text><TextInput style={ct.islamicMeasureInput} value={materialInput} onChangeText={setMaterialInput} placeholder="Silver, bronze…" placeholderTextColor={CF.textMuted} /></View>
                </View>
                <View style={ct.islamicMeasureField}><Text style={ct.islamicMeasureLabel}>Edge / inscription notes</Text><TextInput style={ct.islamicMeasureInput} value={edgeLegendInput} onChangeText={setEdgeLegendInput} placeholder="Optional observations" placeholderTextColor={CF.textMuted} /></View>
              </View>
            ) : null}

            <Pressable
              onPress={onIdentify}
              disabled={!canIdentify || identifying}
              accessibilityRole="button"
              accessibilityLabel={identifying ? 'Identifying coin' : 'Identify coin'}
              accessibilityState={{ disabled: !canIdentify || identifying, busy: identifying }}
              style={[ct.identifyPrimary, (!canIdentify || identifying) && ct.identifyPrimaryDisabled]}
            >
              {identifying ? <ActivityIndicator size="small" color={CF.black} /> : <MaterialIcons name="auto-awesome" size={18} color={CF.black} />}
              <Text style={ct.identifyPrimaryText}>{identifying ? (processingStatus || 'Identifying…') : 'IDENTIFY COIN'}</Text>
            </Pressable>
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
  content: { padding: Spacing.base, gap: Spacing.md, paddingBottom: 112 },
  captureHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: Spacing.xs, paddingBottom: Spacing.sm },
  captureBack: { width: 36, height: 36, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  captureTitle: { fontSize: 16, fontWeight: Typography.weight.extrabold, color: CF.textPrimary, letterSpacing: 1 },
  sideToggle: { flexDirection: 'row', gap: 4, padding: 4, borderRadius: Radius.lg, backgroundColor: CF.surfaceHigh, borderWidth: 1, borderColor: CF.border },
  sideButton: { flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: Radius.md, backgroundColor: 'transparent' },
  sideButtonActive: { backgroundColor: CF.gold, shadowColor: CF.gold, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 6, elevation: 3 },
  sideButtonText: { color: CF.textSub, fontSize: 13, fontWeight: Typography.weight.bold },
  sideButtonTextActive: { color: CF.black },
  heroCapture: { height: 350, borderRadius: Radius.xl, backgroundColor: '#0D0C09', borderWidth: 1, borderColor: CF.border, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', position: 'relative' },
  heroCaptureImage: { width: '100%', height: '100%' },
  framingGuide: { width: '92%', height: '88%', alignItems: 'center', justifyContent: 'center' },
  corner: { position: 'absolute', width: 26, height: 26, borderColor: '#FFFFFF', borderWidth: 3 },
  cornerTL: { top: 0, left: 0, borderRightWidth: 0, borderBottomWidth: 0, borderTopLeftRadius: 8 },
  cornerTR: { top: 0, right: 0, borderLeftWidth: 0, borderBottomWidth: 0, borderTopRightRadius: 8 },
  cornerBL: { bottom: 0, left: 0, borderRightWidth: 0, borderTopWidth: 0, borderBottomLeftRadius: 8 },
  cornerBR: { bottom: 0, right: 0, borderLeftWidth: 0, borderTopWidth: 0, borderBottomRightRadius: 8 },
  heroPlaceholder: { alignItems: 'center', justifyContent: 'center', gap: Spacing.sm },
  heroPlaceholderTitle: { color: CF.textPrimary, fontSize: 17, fontWeight: Typography.weight.bold },
  heroPlaceholderSub: { color: CF.textMuted, fontSize: 12 },
  heroCaptureBadge: { position: 'absolute', bottom: 12, left: 12, right: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: 'rgba(0,0,0,0.76)', paddingVertical: 9, borderRadius: Radius.md },
  heroCaptureBadgeText: { color: CF.textPrimary, fontSize: 11, fontWeight: Typography.weight.semibold },
  captureTools: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', paddingVertical: Spacing.sm },
  toolButton: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: Spacing.xs },
  toolLabel: { color: CF.textSub, fontSize: 10, fontWeight: Typography.weight.medium },
  captureProgress: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: CF.surface, borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  identifyPrimary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, backgroundColor: CF.gold, borderRadius: Radius.md, paddingVertical: 15, marginTop: Spacing.xs, shadowColor: CF.gold, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 5 },
  identifyPrimaryDisabled: { backgroundColor: CF.surfaceHigh, shadowOpacity: 0, elevation: 0 },
  identifyPrimaryText: { fontSize: 14, fontWeight: Typography.weight.extrabold, color: CF.black, letterSpacing: 0.5 },
  captureProgressText: { color: CF.textSub, fontSize: 11 },
  captureProgressDots: { flexDirection: 'row', gap: 6 },
  captureProgressDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: CF.border },
  captureProgressDotDone: { backgroundColor: CF.success },
  advancedCard: { backgroundColor: CF.surface, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.sm, borderWidth: 1, borderColor: CF.border },
  advancedTitle: { fontSize: 10, fontWeight: Typography.weight.extrabold, color: CF.gold, letterSpacing: 0.7 },
  advancedHint: { color: CF.textSub, fontSize: 10, lineHeight: 15 },


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
  quickSideLabel: { position: 'absolute', bottom: 1, left: 1, right: 1, fontSize: 6, fontWeight: Typography.weight.bold, textAlign: 'center', color: '#fff', backgroundColor: 'rgba(0,0,0,0.65)', paddingVertical: 2 },
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

function IdentifyTab({ result, capturedImages, onSave, saving, savedItemId, uploadProgress, isUploading, onReset, onTabSelect, onProcessImage, onRestoreImage, onIdentify, identifying, valuationResult, valuationLoading, valuationError }: {
  result: AIIdentificationResult | null; capturedImages: CapturedImage[];
  onSave: () => void; saving: boolean; savedItemId: string | null;
  uploadProgress: string; isUploading: boolean; onReset: () => void; onTabSelect: (t: CFTab) => void;
  onProcessImage: (mode: CoinImageTool, slotId: string) => Promise<void>; onRestoreImage: (slotId: string) => void;
  onIdentify: () => void; identifying: boolean;
  valuationResult: MarketValueResult | null; valuationLoading: boolean; valuationError: string | null;
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
        <View style={{ gap: Spacing.sm }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: Spacing.sm }}>
            {capturedImages.map(img => (
              <View key={img.slotId} style={{ width: 112, gap: 5 }}>
                <Image source={{ uri: img.uri }} style={[idS.thumb, { width: 112, height: 112 }]} contentFit="cover" />
                <Text style={{ color: CF.textSub, fontSize: 10 }} numberOfLines={1}>{img.slotLabel || img.slotId} · ORIGINAL</Text>
                {img.enhancedUri ? (
                  <>
                    <Image source={{ uri: img.enhancedUri }} style={[idS.thumb, { width: 112, height: 112, borderColor: CF.gold, borderWidth: 1 }]} contentFit="cover" />
                    <Text style={{ color: CF.gold, fontSize: 9 }} numberOfLines={2}>AI-rendered reference</Text>
                  </>
                ) : img.enhancementStatus === 'processing' ? (
                  <View style={{ height: 112, alignItems: 'center', justifyContent: 'center', backgroundColor: CF.surface, borderRadius: Radius.md }}>
                    <ActivityIndicator size="small" color={CF.gold} />
                    <Text style={{ color: CF.textSub, fontSize: 9, marginTop: 5 }}>Rendering…</Text>
                  </View>
                ) : null}
                <Pressable onPress={() => onProcessImage('enhance', img.slotId).catch(error => Alert.alert('Image enhancement', error?.message ?? 'Could not enhance this photo.'))} style={idS.photoToolBtn} accessibilityRole="button" accessibilityLabel={`Enhance ${img.slotLabel || img.slotId} photo`}>
                  <MaterialIcons name="auto-fix-high" size={13} color={CF.gold} /><Text style={idS.photoToolText}>Enhance</Text>
                </Pressable>
                <Pressable onPress={() => onProcessImage('detect', img.slotId).catch(error => Alert.alert('Auto-crop', error?.message ?? 'Could not detect the coin boundary.'))} style={idS.photoToolBtn} accessibilityRole="button" accessibilityLabel={`Auto-crop ${img.slotLabel || img.slotId} photo`}>
                  <MaterialIcons name="crop-free" size={13} color={CF.gold} /><Text style={idS.photoToolText}>Auto-crop</Text>
                </Pressable>
                <Pressable onPress={() => onRestoreImage(img.slotId)} style={idS.photoToolBtn} accessibilityRole="button" accessibilityLabel={`Restore original ${img.slotLabel || img.slotId} photo`}>
                  <MaterialIcons name="restore" size={13} color={CF.textSub} /><Text style={[idS.photoToolText, { color: CF.textSub }]}>Original</Text>
                </Pressable>
              </View>
            ))}
          </ScrollView>
          <Pressable onPress={onIdentify} disabled={identifying} style={[idS.reidentifyBtn, identifying && { opacity: 0.55 }]} accessibilityRole="button" accessibilityLabel="Re-identify coin using the current photographs" accessibilityState={{ disabled: identifying, busy: identifying }}>
            {identifying ? <ActivityIndicator size="small" color={CF.black} /> : <MaterialIcons name="refresh" size={17} color={CF.black} />}
            <Text style={idS.valueCtaText}>{identifying ? 'Re-identifying…' : 'Re-identify with these photos'}</Text>
          </Pressable>
          <Text style={{ color: CF.textMuted, fontSize: 10, lineHeight: 14 }}>Enhancement and auto-crop create a new working image. Re-identify to refresh the attribution; use Original to restore the captured photo.</Text>
        </View>
      ) : null}
      {result.confidence < 0.30 && result.numistaStatus === 'no_match' ? (
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, backgroundColor: '#241508', borderRadius: Radius.xl, padding: Spacing.base, borderWidth: 1, borderColor: Colors.warning + '70' }} accessibilityRole="alert">
          <MaterialIcons name="warning-amber" size={19} color={Colors.warning} />
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={{ color: Colors.warning, fontSize: Typography.size.sm, fontWeight: Typography.weight.extrabold }}>Unconfirmed identification</Text>
            <Text style={{ color: CF.textPrimary, fontSize: Typography.size.sm, lineHeight: 19 }}>The catalogue found no match and confidence is very low. Do not treat a ruler, period or denomination as confirmed. Add the coin's measured weight and diameter and review clearer photos before listing.</Text>
          </View>
        </View>
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
      {(result.candidateIdentification?.whyCandidateSelected || result.candidateIdentification?.whyUncertain || (result.candidateIdentification?.alternativeCandidates?.length ?? 0) > 0 || result.evidenceContradictory.length > 0 || result.warnings.length > 0) ? (
        <View style={idS.reasoningCard}>
          <Text style={idS.evidenceTitle}>ATTRIBUTION REASONING</Text>
          {result.candidateIdentification?.whyCandidateSelected ? (
            <View style={{ gap: 4 }}>
              <Text style={idS.reasoningHeading}>Why this candidate?</Text>
              <Text style={idS.reasoningText}>{result.candidateIdentification.whyCandidateSelected}</Text>
            </View>
          ) : null}
          {result.candidateIdentification?.whyUncertain ? (
            <View style={{ gap: 4 }}>
              <Text style={idS.reasoningHeading}>What remains uncertain</Text>
              <Text style={idS.reasoningText}>{result.candidateIdentification.whyUncertain}</Text>
            </View>
          ) : null}
          {(result.candidateIdentification?.alternativeCandidates?.length ?? 0) > 0 ? (
            <View style={{ gap: 4 }}>
              <Text style={idS.reasoningHeading}>Alternative candidates</Text>
              {result.candidateIdentification!.alternativeCandidates!.slice(0, 3).map((candidate, i) => (
                <Text key={i} style={idS.reasoningText}>• {candidate}</Text>
              ))}
            </View>
          ) : null}
          {result.evidenceContradictory.length > 0 ? (
            <View style={{ gap: 4 }}>
              <Text style={idS.reasoningHeading}>Conflicting evidence</Text>
              {result.evidenceContradictory.slice(0, 4).map((item, i) => <Text key={i} style={[idS.reasoningText, { color: Colors.warning }]}>• {item}</Text>)}
            </View>
          ) : null}
          {result.warnings.length > 0 ? (
            <View style={{ gap: 4 }}>
              <Text style={idS.reasoningHeading}>Warnings</Text>
              {result.warnings.slice(0, 3).map((item, i) => <Text key={i} style={idS.reasoningText}>• {item}</Text>)}
            </View>
          ) : null}
        </View>
      ) : null}
      {result.numistaUrl || result.numistaVerification?.numistaUrl ? (
        <Pressable onPress={() => Linking.openURL(String(result.numistaUrl ?? result.numistaVerification?.numistaUrl))} style={idS.catalogueLink} accessibilityRole="link" accessibilityLabel="Open Numista catalogue reference">
          <MaterialIcons name="open-in-new" size={17} color={CF.gold} />
          <Text style={idS.catalogueLinkText}>Open Numista catalogue record</Text>
        </Pressable>
      ) : null}
      <Pressable onPress={() => onTabSelect('value')} style={idS.valueCta} accessibilityRole="button" accessibilityLabel="Estimate this coin's market value">
        <MaterialIcons name="bar-chart" size={18} color={CF.black} />
        <Text style={idS.valueCtaText}>Estimate Market Value</Text>
        <MaterialIcons name="arrow-forward" size={17} color={CF.black} />
      </Pressable>
      <View style={idS.marketPreview}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }}>
          <MaterialIcons name="bar-chart" size={17} color={CF.gold} />
          <Text style={idS.reasoningHeading}>MARKET VALUE</Text>
          {valuationLoading ? <ActivityIndicator size="small" color={CF.gold} /> : null}
        </View>
        {valuationLoading ? (
          <Text style={idS.reasoningText}>Checking completed sales and current asking prices…</Text>
        ) : valuationError ? (
          <Text style={[idS.reasoningText, { color: Colors.warning }]}>{valuationError} Open Value for details or retry.</Text>
        ) : valuationResult?.valuation ? (
          <>
            <Text style={idS.marketRange}>£{Number(valuationResult.valuation.valuationLow ?? 0).toFixed(0)}–£{Number(valuationResult.valuation.valuationHigh ?? 0).toFixed(0)}</Text>
            <Text style={idS.reasoningText}>Indicative market range · {String(valuationResult.valuation.valuationConfidence ?? 'unrated').replace(/_/g, ' ')}</Text>
            <View style={idS.marketMetrics}>
              <View style={{ flex: 1 }}>
                <Text style={idS.marketMetricLabel}>Relevant sold</Text>
                <Text style={idS.marketMetricValue}>{valuationResult.soldMarket?.relevantSoldCount ?? 0}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={idS.marketMetricLabel}>Sold median</Text>
                <Text style={idS.marketMetricValue}>£{Number(valuationResult.soldMarket?.medianPrice ?? 0).toFixed(2)}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={idS.marketMetricLabel}>Asking median</Text>
                <Text style={idS.marketMetricValue}>£{Number(valuationResult.activeAskingPrices?.medianAskingPrice ?? 0).toFixed(2)}</Text>
              </View>
            </View>
            <Text style={idS.reasoningText}>{(valuationResult.soldMarket?.relevantSoldCount ?? 0) > 0 ? 'Sold data is shown separately from active asking prices.' : 'No relevant completed sales were found; treat the estimate as provisional and do not confuse asking prices with realised sales.'}</Text>
          </>
        ) : (
          <Text style={idS.reasoningText}>A market estimate will appear here when pricing research finishes.</Text>
        )}
        <Pressable onPress={() => onTabSelect('value')} style={idS.marketDetailsBtn} accessibilityRole="button" accessibilityLabel="Open full market value research">
          <Text style={idS.catalogueLinkText}>View full pricing research</Text>
          <MaterialIcons name="arrow-forward" size={15} color={CF.gold} />
        </Pressable>
      </View>
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
  content: { padding: Spacing.base, gap: Spacing.md, paddingBottom: 96 },
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
  marketPreview: { backgroundColor: CF.surface, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.sm, borderWidth: 1, borderColor: CF.gold + '35' },
  marketRange: { fontSize: 27, fontWeight: Typography.weight.extrabold, color: CF.cream },
  marketMetrics: { flexDirection: 'row', gap: Spacing.sm, paddingVertical: Spacing.xs },
  marketMetricLabel: { color: CF.textMuted, fontSize: 10 },
  marketMetricValue: { color: CF.textPrimary, fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, marginTop: 3 },
  marketDetailsBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: Spacing.sm, borderTopWidth: 1, borderTopColor: CF.border },
  photoToolBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, borderRadius: Radius.sm, paddingVertical: 5, paddingHorizontal: 3, backgroundColor: CF.surfaceHigh, borderWidth: 1, borderColor: CF.border },
  photoToolText: { fontSize: 10, color: CF.gold, fontWeight: Typography.weight.semibold },
  reidentifyBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: CF.gold },
  numistaCard: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, backgroundColor: CF.surface, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1 },
  numistaStatus: { fontSize: 10, fontWeight: Typography.weight.semibold, color: CF.textSub, textTransform: 'uppercase', letterSpacing: 0.4 },
  numistaTitle: { fontSize: Typography.size.sm, color: CF.textPrimary, lineHeight: 18, marginTop: 2 },
  numistaRef: { fontSize: 10, color: CF.gold, marginTop: 2 },
  numistaScore: { fontSize: 10, color: CF.textMuted },
  evidenceCard: { backgroundColor: CF.surface, borderRadius: Radius.lg, padding: Spacing.md, gap: 6, borderWidth: 1, borderColor: CF.border },
  evidenceTitle: { fontSize: 9, fontWeight: Typography.weight.extrabold, color: CF.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 },
  evidenceRow: { flexDirection: 'row', gap: 6, alignItems: 'flex-start' },
  evidenceText: { flex: 1, fontSize: Typography.size.xs, color: CF.textSub, lineHeight: 16 },
  reasoningCard: { backgroundColor: CF.surface, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.md, borderWidth: 1, borderColor: CF.gold + '25' },
  reasoningHeading: { fontSize: Typography.size.xs, fontWeight: Typography.weight.bold, color: CF.cream },
  reasoningText: { fontSize: Typography.size.sm, lineHeight: 19, color: CF.textSub },
  catalogueLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, padding: Spacing.md, borderRadius: Radius.lg, borderWidth: 1, borderColor: CF.gold + '50', backgroundColor: CF.surface },
  catalogueLinkText: { color: CF.gold, fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold },
  valueCta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: CF.gold },
  valueCtaText: { color: CF.black, fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, flex: 1 },
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

// A render failure in the capture flow must not leave a blank white screen.
// Keep the failure visible and allow returning home without restarting the app.
class CaptureTabErrorBoundary extends React.Component<
  { children: React.ReactNode; onRetry: () => void },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('[Coin Flipper capture render error]', error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <View style={{ flex: 1, backgroundColor: CF.black, padding: Spacing.xl, justifyContent: 'center', gap: Spacing.md }}>
        <MaterialIcons name="warning" size={36} color={CF.gold} />
        <Text style={{ color: CF.gold, fontSize: Typography.size.lg, fontWeight: Typography.weight.bold }}>Scanner could not open</Text>
        <Text selectable style={{ color: CF.textPrimary, fontSize: Typography.size.sm, lineHeight: 20 }}>
          {this.state.error.message || 'An unexpected error occurred while opening the coin capture screen.'}
        </Text>
        <Pressable
          onPress={() => { this.setState({ error: null }); this.props.onRetry(); }}
          accessibilityRole="button"
          style={{ alignSelf: 'flex-start', backgroundColor: CF.gold, borderRadius: Radius.md, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md }}
        >
          <Text style={{ color: CF.black, fontWeight: Typography.weight.bold }}>Return to Coin Flipper</Text>
        </Pressable>
      </View>
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN SCREEN
// ─────────────────────────────────────────────────────────────────────────────

export default function CoinFlipperScreen({ isHomeTab = false }: { isHomeTab?: boolean } = {}) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ tab?: string }>();
  const { tenant, setScanMode, triggerInventoryReload } = useApp();
  const { showAlert } = useAlert();
  const { isPremium } = useSubscription();

  // ── Tab state ───────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<CFTab>(() => params.tab === 'capture' ? 'capture' : 'home');
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
  const originalImageUris = useRef<Record<string, string>>({});
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
  const [quickCaptures, setQuickCaptures] = useState<Array<{ id: string; uri: string; reverseUri?: string }>>([]);
  const [quickIdentificationResults, setQuickIdentificationResults] = useState<QuickCoinResult[]>([]);
  const [selectedQuickResult, setSelectedQuickResult] = useState<QuickCoinResult | null>(null);
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

  // Fetch valuation automatically for the identification report and refresh it when Value is opened.
  useEffect(() => {
    if ((activeTab !== 'identify' && activeTab !== 'value') || !idResult || !tenant) return;
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

  // Preserve every captured original and asynchronously create a separate AI
  // reference. The original URI remains canonical for inventory/eBay listings.
  const prepareCapturedPhoto = useCallback(async (image: CapturedImage): Promise<CapturedImage> => {
    originalImageUris.current[image.slotId] = image.uri;
    const pending: CapturedImage = { ...image, enhancementStatus: 'processing' };
    void generateCoinImageReference(image.uri).then((reference) => {
      setCapturedImages(prev => prev.map(current => current.slotId === image.slotId && current.uri === image.uri
        ? { ...current, enhancedUri: reference.enhancedUri, enhancementStatus: 'ready', enhancementWarning: reference.warning }
        : current));
    }).catch((error) => {
      console.warn('[CoinFlipper] AI coin reference generation unavailable; original photo retained.', error);
      setCapturedImages(prev => prev.map(current => current.slotId === image.slotId && current.uri === image.uri
        ? { ...current, enhancementStatus: 'failed', enhancementWarning: error instanceof Error ? error.message : 'AI image enhancement unavailable.' }
        : current));
    });
    return pending;
  }, []);

  // ── Capture handler ─────────────────────────────────────────────────────────
  const handleCapture = useCallback(async (slotId: string, slotLabel: string) => {
    const cameraImg = await captureFromCamera();
    if (cameraImg) {
      const image = await prepareCapturedPhoto({ ...cameraImg, slotId, slotLabel });
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
            const prepared = await prepareCapturedPhoto(libImg);
            setCapturedImages(prev => {
              const existing = prev.findIndex(i => i.slotId === slotId);
              if (existing >= 0) { const updated = [...prev]; updated[existing] = prepared; return updated; }
              return [...prev, prepared];
            });
          },
        },
      ],
    );
  }, [prepareCapturedPhoto]);

  const handleProcessImage = useCallback(async (mode: CoinImageTool, slotId: string) => {
    const current = capturedImages.find(image => image.slotId === slotId);
    if (!current) throw new Error('Capture this side of the coin first.');
    if (mode === 'enhance') {
      setCapturedImages(prev => prev.map(image => image.slotId === slotId ? { ...image, enhancementStatus: 'processing' } : image));
      try {
        const reference = await generateCoinImageReference(current.uri);
        setCapturedImages(prev => prev.map(image => image.slotId === slotId
          ? { ...image, enhancedUri: reference.enhancedUri, enhancementStatus: 'ready', enhancementWarning: reference.warning }
          : image));
      } catch (error) {
        setCapturedImages(prev => prev.map(image => image.slotId === slotId ? { ...image, enhancementStatus: 'failed' } : image));
        throw error;
      }
      return;
    }
    // Auto detect is non-destructive until reliable boundary detection is available.
    await processCoinImage(current.uri, 'detect');
  }, [capturedImages]);

  const handleRestoreImage = useCallback((slotId: string) => {
    const originalUri = originalImageUris.current[slotId];
    if (!originalUri) {
      Alert.alert('Original photo', 'This photo has not been processed, so there is no separate original to restore.');
      return;
    }
    setCapturedImages(prev => prev.map(image => image.slotId === slotId
      ? { ...image, uri: originalUri, base64: undefined }
      : image));
  }, []);

  const handleRemoveImage = useCallback((slotId: string) => {
    setCapturedImages(prev => prev.filter(i => i.slotId !== slotId));
    delete originalImageUris.current[slotId];
  }, []);

  // ── Quick Mode: single-shot capture (fire camera, add to batch) ─────────────
  const handleQuickCapture = useCallback(async () => {
    if (quickRunning) return;
    setQuickIdentificationResults([]);
    setSelectedQuickResult(null);
    const addSideToCoin = (uri: string) => {
      setQuickCaptures(prev => {
        const pendingIndex = prev.findIndex(coin => !coin.reverseUri);
        if (pendingIndex >= 0) {
          const next = [...prev];
          next[pendingIndex] = { ...next[pendingIndex], reverseUri: uri };
          return next;
        }
        return [...prev, { id: `qc_${Date.now()}`, uri }];
      });
      setQuickDone(false);
    };
    const cameraImg = await captureFromCamera();
    if (cameraImg) { addSideToCoin(cameraImg.uri); return; }
    Alert.alert('Capture Coin Side', 'Camera cancelled — choose this side from your library?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Choose from Library', onPress: async () => {
        const libImg = await pickFromLibrary('quick', 'Coin side');
        if (libImg) addSideToCoin(libImg.uri);
      } },
    ]);
  }, [quickRunning]);

  const handleClearQuick = useCallback(() => {
    setQuickCaptures([]);
    setIslamicBatchItems([]);
    setSelectedIslamicItem(null);
    setQuickIdentificationResults([]);
    setSelectedQuickResult(null);
    setQuickDone(false);
    setAiError(null);
  }, []);

  // ── Quick Mode: run batch identification ────────────────────────────────────
  const handleRunQuickBatch = useCallback(async () => {
    if (!tenant || quickCaptures.length === 0 || quickRunning) return;
    if (quickCaptures.some(coin => !coin.reverseUri)) {
      setAiError('Capture both the obverse and reverse for every coin before running identification.');
      return;
    }
    setQuickRunning(true);
    setQuickDone(false);
    setAiError(null);
    const isIslamic = selectedSpecialist.id === 'islamic';
    try {
      if (isIslamic) {
        const batchItems: IslamicBatchItem[] = quickCaptures.map((cap, index) => ({
          id: newIslamicBatchId(), images: [cap.uri, cap.reverseUri!], status: 'pending', label: `Coin ${index + 1}`,
        }));
        setIslamicBatchItems(batchItems);
        const batchResult = await processIslamicBatch(batchItems, tenant.id, (_processed, _total, updatedItem) => {
          setIslamicBatchItems(prev => prev.map(i => i.id === updatedItem.id ? updatedItem : i));
        });
        setIslamicBatchItems(batchResult.items);
        const completed = batchResult.items.filter(i => i.status === 'complete' && i.result);
        if (completed.length > 0) {
          const saveResult = await saveIslamicBatchToInventory(tenant.id, completed, () => {});
          if (saveResult.savedIds.length > 0) triggerInventoryReload();
          if (saveResult.failed > 0) setAiError(`Identified ${completed.length} coin(s), but ${saveResult.failed} could not be saved: ${saveResult.errors.slice(0, 2).join('; ')}`);
        }
        if (batchResult.failed > 0) setAiError(`${batchResult.failed} coin(s) failed identification. Tap each result to review the error.`);
      } else {
        const pendingResults: QuickCoinResult[] = quickCaptures.map((cap, index) => ({ id: cap.id, label: `Coin ${index + 1}`, images: [cap.uri, cap.reverseUri!], status: 'pending', error: 'Waiting for identification…' }));
        setQuickIdentificationResults(pendingResults);
        for (const [index, cap] of quickCaptures.entries()) {
          const coinImages: CapturedImage[] = [
            { uri: cap.uri, slotId: 'obverse', slotLabel: 'Obverse' },
            { uri: cap.reverseUri!, slotId: 'reverse', slotLabel: 'Reverse' },
          ];
          isIdentifyInFlight.current = true;
          try {
            const { result, error } = await identifyItemWithAI(coinImages, selectedSpecialist.specialistId, undefined, undefined, { tenantId: tenant.id });
            if (!result) {
              const message = error ?? 'Identification failed';
              setQuickIdentificationResults(prev => prev.map(entry => entry.id === cap.id ? { ...entry, status: 'error', error: message } : entry));
              setAiError(`Coin ${index + 1}: ${message}`);
              continue;
            }
            setQuickIdentificationResults(prev => prev.map(entry => entry.id === cap.id ? { ...entry, status: 'complete', result, error: undefined } : entry));
            const { item, error: saveError } = await saveIdentifiedItem(tenant.id, { ...result, specialistId: selectedSpecialist.specialistId }, { mediaUris: coinImages.map(img => img.uri) });
            if (!item) {
              const message = saveError ?? 'Unknown save error';
              setQuickIdentificationResults(prev => prev.map(entry => entry.id === cap.id ? { ...entry, error: `Identified but not saved: ${message}` } : entry));
              setAiError(`Coin ${index + 1} identified but not saved: ${message}`);
              continue;
            }
            setQuickIdentificationResults(prev => prev.map(entry => entry.id === cap.id ? { ...entry, itemId: item.id } : entry));
            // Ensure the shared Inventory screen reloads newly created coin records.
            triggerInventoryReload();
            try {
              const { urls } = await uploadItemImages(item.id, coinImages);
              if (urls.length > 0) await updateItemMedia(tenant.id, item.id, urls);
              // Rendered references are stored separately, never in the eBay media array.
              await saveCoinReferenceImages(tenant.id, item.id, coinImages);
            } catch { /* identification is saved; media upload can be retried separately */ }
          } catch (error: any) {
            const message = error?.message ?? 'Unexpected error while processing this coin';
            setQuickIdentificationResults(prev => prev.map(entry => entry.id === cap.id ? { ...entry, status: 'error', error: message } : entry));
            setAiError(`Coin ${index + 1}: ${message}`);
          } finally {
            isIdentifyInFlight.current = false;
          }
          await new Promise(r => setTimeout(r, 400));
        }
      }
    } catch (error: any) {
      setAiError(error?.message ?? 'Quick identification failed unexpectedly.');
    } finally {
      setQuickRunning(false);
      setQuickDone(true);
    }
  }, [tenant, quickCaptures, quickRunning, selectedSpecialist, triggerInventoryReload]);

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

    // Give the model the original and (when available) AI-rendered reference
    // as explicitly labelled evidence. Original photos remain canonical for saving/listing.
    const identificationImages: CapturedImage[] = capturedImages.flatMap((image) => [
      { ...image, base64: undefined },
      ...(image.enhancedUri ? [{
        ...image,
        uri: image.enhancedUri,
        slotId: `${image.slotId}_ai_reference`,
        slotLabel: `${image.slotLabel} — AI-rendered reference (not documentary evidence)`,
        base64: undefined,
        enhancedUri: undefined,
      }] : []),
    ]);
    const { result, error, quotaExceeded } = await identifyItemWithAI(
      identificationImages,
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

    // Keep user-supplied physical measurements and the catalogue evidence attached
    // to this identification so they survive saving and drive downstream valuation.
    // A Numista result remains a candidate unless the source pipeline explicitly
    // marks it verified; never silently promote a candidate to a confirmed identity.
    const suppliedWeight = weightInput.trim() ? Number(weightInput.replace(',', '.')) : undefined;
    const suppliedDiameter = diameterInput.trim() ? Number(diameterInput.replace(',', '.')) : undefined;
    const numistaVerification = result.numistaVerification ?? undefined;
    const enrichedResult: AIIdentificationResult = {
      ...result,
      attributes: {
        ...(result.attributes ?? {}),
        ...(Number.isFinite(suppliedWeight) && (suppliedWeight ?? 0) > 0 ? { weight_g: suppliedWeight, supplied_weight_g: suppliedWeight } : {}),
        ...(Number.isFinite(suppliedDiameter) && (suppliedDiameter ?? 0) > 0 ? { diameter_mm: suppliedDiameter, supplied_diameter_mm: suppliedDiameter } : {}),
        ...(yearInput.trim() ? { user_supplied_year: yearInput.trim() } : {}),
        ...(materialInput.trim() ? { user_supplied_material: materialInput.trim() } : {}),
        ...(edgeLegendInput.trim() ? { user_supplied_edge_or_legend: edgeLegendInput.trim() } : {}),
        ...(result.numistaTypeId || numistaVerification?.typeId ? { numista_type_id: Number(result.numistaTypeId ?? numistaVerification?.typeId) } : {}),
        ...(result.numistaN || numistaVerification?.numistaN ? { numista_n: result.numistaN ?? numistaVerification?.numistaN } : {}),
        ...(result.numistaUrl || numistaVerification?.numistaUrl ? { numista_url: result.numistaUrl ?? numistaVerification?.numistaUrl } : {}),
        ...(result.numistaTitle || numistaVerification?.title ? { numista_title: result.numistaTitle ?? numistaVerification?.title } : {}),
        ...(result.numistaMatchScore !== undefined || numistaVerification?.matchScore !== undefined ? { numista_match_score: Number(result.numistaMatchScore ?? numistaVerification?.matchScore ?? 0) } : {}),
        ...(result.numistaStatus || numistaVerification?.status ? { numista_status: result.numistaStatus ?? numistaVerification?.status } : {}),
        ...(result.numistaMatchTier || numistaVerification?.matchTier ? { numista_match_tier: result.numistaMatchTier ?? numistaVerification?.matchTier } : {}),
        ...(numistaVerification ? { numista_verification: numistaVerification } : {}),
        catalogue_reference_state: result.numistaStatus === 'verified' ? 'verified' : (result.numistaTypeId || numistaVerification?.typeId ? 'candidate' : 'not_found'),
      },
    };
    setIdResult(enrichedResult);
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
    const { item, error } = await saveIdentifiedItem(tenant.id, { ...idResult, specialistId: selectedSpecialist.specialistId }, { mediaUris: capturedImages.map(i => i.uri) });
    setIsSaving(false);
    isSaveInFlight.current = false;

    if (error || !item) {
      showAlert('Save Failed', error ?? 'Could not save coin. Please try again.');
      return;
    }

    setSavedItemId(item.id);
    // Refresh shared inventory lists after the database insert succeeds.
    triggerInventoryReload();
    AccessibilityInfo.announceForAccessibility('Coin saved to inventory');

    if (capturedImages.length > 0) {
      setIsUploading(true);
      setUploadProgress('Uploading photos...');
      try {
        const { urls } = await uploadItemImages(item.id, capturedImages);
        if (urls.length > 0) await updateItemMedia(tenant.id, item.id, urls);
        const referenceSave = await saveCoinReferenceImages(tenant.id, item.id, capturedImages);
        if (referenceSave.errors.length > 0) console.warn('[CoinFlipper] Some rendered references could not be saved separately.', referenceSave.errors);
        if (urls.length > 0) {
          setUploadProgress(`${urls.length} original photo${urls.length === 1 ? '' : 's'} saved${Object.keys(referenceSave.urls).length ? ' · rendered references saved separately' : ''}`);
        } else {
          setUploadProgress('Photos saved locally');
        }
      } catch {
        setUploadProgress('Photos saved locally');
      } finally {
        setIsUploading(false);
      }
    }
  }, [idResult, tenant, capturedImages, savedItemId, showAlert, triggerInventoryReload]);

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

      {activeTab !== 'capture' ? <>
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
      </> : <View style={{ height: insets.top }} />}

      {/* ── Tab content ── */}
      <View style={{ flex: 1 }}>
        {activeTab === 'home' ? (
          <HomeTab onTabSelect={handleTabSelect} isPremium={isPremium} tenant={tenant} onUpgrade={() => setShowPaywall(true)} onPeriodSelect={p => { setSelectedPeriod(p); const chip = SPECIALIST_CHIPS.find(c => c.periodId === p); if (chip) setSelectedSpecialist(chip); }} selectedPeriod={selectedPeriod} />
        ) : activeTab === 'capture' ? (
          <CaptureTabErrorBoundary onRetry={() => setActiveTab('home')}>
            <CaptureTab
            capturedImages={capturedImages}
            onCapture={handleCapture}
            onRemove={handleRemoveImage}
            onIdentify={handleIdentify}
            onProcessImage={handleProcessImage}
            onRestoreImage={handleRestoreImage}
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
            quickIdentificationResults={quickIdentificationResults}
            selectedQuickResult={selectedQuickResult}
            onQuickResultSelect={setSelectedQuickResult}
            onCloseQuickResult={() => setSelectedQuickResult(null)}
            onQuickCapture={handleQuickCapture}
            onRunQuickBatch={handleRunQuickBatch}
            quickRunning={quickRunning}
            quickDone={quickDone}
            onClearQuick={handleClearQuick}
            islamicBatchItems={islamicBatchItems}
            selectedIslamicItem={selectedIslamicItem}
            onIslamicItemPress={setSelectedIslamicItem}
            weightInput={weightInput}
            setWeightInput={setWeightInput}
            diameterInput={diameterInput}
            setDiameterInput={setDiameterInput}
            yearInput={yearInput}
            setYearInput={setYearInput}
            materialInput={materialInput}
            setMaterialInput={setMaterialInput}
            edgeLegendInput={edgeLegendInput}
            setEdgeLegendInput={setEdgeLegendInput}
            />
          </CaptureTabErrorBoundary>
        ) : activeTab === 'identify' ? (
          <IdentifyTab result={idResult} capturedImages={capturedImages} onSave={handleSave} saving={isSaving} savedItemId={savedItemId} uploadProgress={uploadProgress} isUploading={isUploading} onReset={handleReset} onTabSelect={handleTabSelect} onProcessImage={handleProcessImage} onRestoreImage={handleRestoreImage} onIdentify={handleIdentify} identifying={identifying} valuationResult={valuationResult} valuationLoading={valuationLoading} valuationError={valuationError} />
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
      {!isPremium && activeTab !== 'home' && activeTab !== 'capture' ? (
        <View style={[main.upgradeBar, { paddingBottom: insets.bottom + 4 }]}>
          <MaterialIcons name="workspace-premium" size={13} color={CF.black} />
          <Text style={main.upgradeBarText}>Upgrade to Coin Flipper Pro</Text>
          <Pressable onPress={() => setShowPaywall(true)} style={main.upgradeBarBtn} accessibilityRole="button" accessibilityLabel="Upgrade to Pro for £9.99 per month">
            <Text style={main.upgradeBarBtnText}>£9.99/mo</Text>
          </Pressable>
        </View>
      ) : <View style={{ height: insets.bottom }} />}

      {/* Islamic batch item detail modal (mini) */}
      {selectedIslamicItem && !quickMode ? (
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
