// Bike Flipper — Dedicated Cycling Niche Entry Point
//
// Design: Neon Green/Black — "ANY BIKE. REAL DATA. BETTER DECISIONS. BIGGER PROFITS."
// Tagline: BUY SMART. BUILD BETTER. SELL STRONG. FIND • ASSESS • UPGRADE • FLIP
// Tabs: Find, Assess, Upgrade, Profits, Insights

import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, Pressable, ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import { useAlert, getSupabaseClient } from '@/template';
import { Colors, Typography, Spacing, Radius, Shadow } from '@/constants/theme';
import { useApp } from '@/hooks/useApp';
import { useSubscription } from '@/hooks/useSubscription';
import { startCheckout } from '@/services/subscriptionService';
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
import { Image } from 'expo-image';

// ── Bike Flipper design tokens ────────────────────────────────────────────────
const BF = {
  black:       '#080C08',
  surface:     '#101410',
  surfaceHigh: '#182018',
  border:      '#202E20',
  green:       '#6ED020',
  greenBright: '#90EE40',
  greenDim:    '#0A2000',
  greenMid:    '#58B018',
  white:       '#F0F5F0',
  textPrimary: '#F0F5F0',
  textSub:     '#7A9070',
  textMuted:   '#4A6040',
  success:     '#4CAF50',
  danger:      '#E53935',
  warning:     '#FFC107',
  info:        '#42A5F5',
};

type BFTab = 'home' | 'find' | 'assess' | 'upgrade' | 'profits' | 'insights';

const TABS: Array<{ id: BFTab; label: string; icon: string }> = [
  { id: 'find',     label: 'Find',     icon: 'search'           },
  { id: 'assess',   label: 'Assess',   icon: 'assignment'       },
  { id: 'upgrade',  label: 'Upgrade',  icon: 'build'            },
  { id: 'profits',  label: 'Profits',  icon: 'bar-chart'        },
  { id: 'insights', label: 'Insights', icon: 'lightbulb'        },
];

const BIKE_CATEGORIES = [
  { id: 'mtb', label: 'Mountain Bikes', sub: 'Full Suspension · Hardtail' },
  { id: 'trail', label: 'Trail Bikes', sub: 'Enduro · Downhill' },
  { id: 'road', label: 'Road Bikes', sub: 'Racing · Gravel · CX' },
  { id: 'hybrid', label: 'Hybrids', sub: 'City · Commuter · Touring' },
  { id: 'bmx', label: 'BMX', sub: 'Race · Freestyle · Street' },
  { id: 'electric', label: 'Electric', sub: 'eMTB · eCargo · Folding' },
  { id: 'kids', label: "Kids' Bikes", sub: '12" – 26" wheel' },
  { id: 'parts', label: 'Parts', sub: 'Wheels · Groupsets · Forks' },
];

// ── Bike Flip Score calculation ───────────────────────────────────────────────
function calculateBikeFlipScore(result: AIIdentificationResult): number {
  const base = Math.round(result.confidence * 100);
  let adj = 0;
  const cond = (result.condition ?? '').toLowerCase();
  if (cond.includes('excellent') || cond.includes('very good')) adj += 10;
  else if (cond.includes('good condition') || cond.includes('good overall')) adj += 5;
  else if (cond.includes('poor') || cond.includes('damaged') || cond.includes('cracked') || cond.includes('bent')) adj -= 22;
  else if (cond.includes('fair') || cond.includes('average')) adj -= 5;
  const rideable = String(result.attributes?.rideable_status ?? '').toLowerCase();
  if (rideable.includes('rideable') || rideable.includes('ready to ride')) adj += 12;
  else if (rideable.includes('non-rideable') || rideable.includes('needs work')) adj -= 15;
  const frameCond = String(result.attributes?.frame_condition ?? '').toLowerCase();
  if (frameCond.includes('cracked') || frameCond.includes('bent') || frameCond.includes('damaged')) adj -= 20;
  else if (frameCond.includes('excellent') || frameCond.includes('no damage')) adj += 6;
  adj -= Math.min(result.warnings?.length ?? 0, 3) * 4;
  return Math.max(10, Math.min(98, base + adj));
}

// ── Flip Score ────────────────────────────────────────────────────────────────
function FlipScore({ score }: { score: number }) {
  const color = score >= 75 ? BF.green : score >= 55 ? BF.warning : BF.danger;
  const label = score >= 75 ? 'BUY' : score >= 55 ? 'MAYBE' : 'PASS';
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
  circle: { width: 90, height: 90, borderRadius: 45, borderWidth: 3, alignItems: 'center', justifyContent: 'center', backgroundColor: BF.surfaceHigh },
  score: { fontSize: 28, fontWeight: Typography.weight.extrabold, lineHeight: 32 },
  outOf: { fontSize: 10, color: BF.textMuted },
  badge: { borderRadius: Radius.pill, paddingHorizontal: 8, paddingVertical: 2, marginTop: 2 },
  badgeText: { fontSize: 9, fontWeight: Typography.weight.extrabold, color: '#fff', letterSpacing: 0.5 },
});

// ── Condition row ─────────────────────────────────────────────────────────────
function ConditionRow({ label, icon, status }: { label: string; icon: string; status: 'good' | 'fair' | 'poor' }) {
  const colors = { good: BF.green, fair: BF.warning, poor: BF.danger };
  const widths = { good: '85%', fair: '55%', poor: '25%' };
  return (
    <View style={cr.row}>
      <MaterialIcons name={icon as any} size={14} color={BF.textMuted} style={{ width: 20 }} />
      <Text style={cr.label}>{label}</Text>
      <View style={cr.track}>
        <View style={[cr.fill, { width: widths[status] as any, backgroundColor: colors[status] }]} />
      </View>
      <Text style={[cr.status, { color: colors[status] }]}>{status.charAt(0).toUpperCase() + status.slice(1)}</Text>
    </View>
  );
}
const cr = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: 5 },
  label: { flex: 1, fontSize: Typography.size.sm, color: BF.textPrimary },
  track: { width: 80, height: 6, backgroundColor: BF.surfaceHigh, borderRadius: Radius.pill, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: Radius.pill },
  status: { width: 40, fontSize: 10, fontWeight: Typography.weight.semibold, textAlign: 'right' },
});

// ── Paywall ───────────────────────────────────────────────────────────────────
function BFPaywall({ onBack }: { onBack: () => void }) {
  const insets = useSafeAreaInsets();
  const { showAlert } = useAlert();
  const [upgrading, setUpgrading] = useState(false);

  const handleUpgrade = useCallback(async () => {
    setUpgrading(true);
    const { error } = await startCheckout('bikes');
    setUpgrading(false);
    if (error) showAlert('Checkout Failed', error);
  }, [showAlert]);

  const FEATURES = [
    { icon: 'search', label: 'Advanced AI identification engine' },
    { icon: 'bar-chart', label: 'Live market values from eBay' },
    { icon: 'build', label: 'Repair cost estimator' },
    { icon: 'sell', label: 'eBay-ready listing tools' },
    { icon: 'settings', label: 'Component compatibility checker' },
    { icon: 'trending-up', label: 'Profit tracking & analytics' },
  ];

  return (
    <View style={[pw.container, { paddingTop: insets.top }]}>
      <StatusBar style="light" />
      <View style={pw.header}>
        <Pressable onPress={onBack} style={pw.backBtn} hitSlop={8}>
          <MaterialIcons name="arrow-back" size={20} color={BF.green} />
        </Pressable>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={pw.title}>BIKE FLIPPER</Text>
          <Text style={pw.sub}>PRO</Text>
        </View>
        <View style={{ width: 36 }} />
      </View>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[pw.content, { paddingBottom: insets.bottom + 40 }]}>
        <View style={pw.hero}>
          <View style={pw.heroIcon}><MaterialIcons name="pedal-bike" size={48} color={BF.green} /></View>
          <Text style={pw.heroTitle}>ANY BIKE.</Text>
          <Text style={pw.heroTitle}>REAL DATA.</Text>
          <Text style={[pw.heroTitle, { color: BF.green }]}>BIGGER PROFITS.</Text>
          <Text style={pw.heroTagline}>BUY SMART • BUILD BETTER • SELL STRONG</Text>
        </View>
        <Pressable onPress={handleUpgrade} disabled={upgrading} style={({ pressed }) => [pw.upgradeBtn, pressed && { opacity: 0.88 }]}>
          <MaterialIcons name="workspace-premium" size={18} color={BF.black} />
          <View>
            <Text style={pw.upgradeBtnText}>{upgrading ? 'Opening checkout…' : 'Upgrade to Bike Flipper Pro'}</Text>
            <Text style={pw.upgradeBtnSub}>£9.99 / month · Cancel any time</Text>
          </View>
          {upgrading ? <ActivityIndicator size="small" color={BF.black} style={{ marginLeft: 'auto' }} /> : <MaterialIcons name="arrow-forward" size={16} color={BF.black} style={{ marginLeft: 'auto' }} />}
        </Pressable>
        <View style={pw.featureCard}>
          <Text style={pw.featureTitle}>WHAT IS INCLUDED</Text>
          {FEATURES.map((f, i) => (
            <View key={f.label}>
              {i > 0 ? <View style={{ height: 1, backgroundColor: BF.border }} /> : null}
              <View style={pw.featureRow}>
                <View style={pw.featureIcon}><MaterialIcons name={f.icon as any} size={15} color={BF.green} /></View>
                <Text style={pw.featureLabel}>{f.label}</Text>
                <MaterialIcons name="check-circle" size={14} color={BF.success} />
              </View>
            </View>
          ))}
        </View>
        <View style={pw.catsCard}>
          <Text style={pw.catsTitle}>SUPPORTED CATEGORIES</Text>
          <View style={pw.catChips}>
            {BIKE_CATEGORIES.map(c => (
              <View key={c.id} style={pw.catChip}><Text style={pw.catChipText}>{c.label}</Text></View>
            ))}
          </View>
        </View>
        <Pressable onPress={onBack} style={pw.cancelBtn}><Text style={pw.cancelText}>Go Back</Text></Pressable>
      </ScrollView>
    </View>
  );
}

const pw = StyleSheet.create({
  container: { flex: 1, backgroundColor: BF.black },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.base, paddingVertical: Spacing.md, borderBottomWidth: 1, borderBottomColor: BF.border },
  backBtn: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: BF.greenDim, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: BF.green + '30' },
  title: { fontSize: Typography.size.lg, fontWeight: Typography.weight.extrabold, color: BF.green, letterSpacing: 2 },
  sub: { fontSize: 9, color: BF.green + 'AA', letterSpacing: 3 },
  content: { padding: Spacing.base, gap: Spacing.xl },
  hero: { alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.xl },
  heroIcon: { width: 90, height: 90, borderRadius: 45, backgroundColor: BF.greenDim, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: BF.green + '40', marginBottom: Spacing.md },
  heroTitle: { fontSize: Typography.size.xxl, fontWeight: Typography.weight.extrabold, color: BF.white, textAlign: 'center' },
  heroTagline: { fontSize: 10, color: BF.textSub, letterSpacing: 1.5, marginTop: 4, textAlign: 'center' },
  upgradeBtn: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: BF.green, borderRadius: Radius.xxl, paddingVertical: Spacing.base, paddingHorizontal: Spacing.xl, shadowColor: BF.green, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.45, shadowRadius: 16, elevation: 8 },
  upgradeBtnText: { fontSize: Typography.size.base, fontWeight: Typography.weight.extrabold, color: BF.black },
  upgradeBtnSub: { fontSize: Typography.size.xs, color: BF.black + 'AA' },
  featureCard: { backgroundColor: BF.surface, borderRadius: Radius.xxl, borderWidth: 1, borderColor: BF.border, overflow: 'hidden' },
  featureTitle: { fontSize: 9, fontWeight: Typography.weight.extrabold, color: BF.textMuted, textTransform: 'uppercase', letterSpacing: 0.8, padding: Spacing.md, backgroundColor: BF.surfaceHigh },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.md, paddingVertical: 12 },
  featureIcon: { width: 28, height: 28, borderRadius: Radius.sm, backgroundColor: BF.greenDim, alignItems: 'center', justifyContent: 'center' },
  featureLabel: { flex: 1, fontSize: Typography.size.sm, color: BF.textPrimary },
  catsCard: { gap: Spacing.sm },
  catsTitle: { fontSize: 9, fontWeight: Typography.weight.extrabold, color: BF.textMuted, textTransform: 'uppercase', letterSpacing: 0.8 },
  catChips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  catChip: { paddingHorizontal: 10, paddingVertical: 5, backgroundColor: BF.surface, borderRadius: Radius.pill, borderWidth: 1, borderColor: BF.green + '40' },
  catChipText: { fontSize: Typography.size.xs, color: BF.green, fontWeight: Typography.weight.semibold },
  cancelBtn: { alignItems: 'center', paddingVertical: Spacing.sm },
  cancelText: { fontSize: Typography.size.sm, color: BF.textMuted },
});

// ── Home Tab ──────────────────────────────────────────────────────────────────
function HomeTab({ isPremium, onTabSelect, onUpgrade, tenant }: { isPremium: boolean; onTabSelect: (t: BFTab) => void; onUpgrade: () => void; tenant: any }) {
  const router = useRouter();
  const [bikeCount, setBikeCount] = useState<number | null>(null);

  useEffect(() => {
    if (!tenant?.id) return;
    getSupabaseClient()
      .from('items').select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenant.id).eq('specialist_id', 'bicycles')
      .then(({ count }) => setBikeCount(count ?? 0));
  }, [tenant?.id]);

  const FEATURES = [
    { label: 'Find a Bike', icon: 'search', tab: 'find' as BFTab, pro: false },
    { label: 'My Bikes', icon: 'pedal-bike', route: '/(tabs)/inventory', pro: false },
    { label: 'Assess', icon: 'assignment', tab: 'assess' as BFTab, pro: false },
    { label: 'Upgrade', icon: 'build', tab: 'upgrade' as BFTab, pro: false },
    { label: 'Profits', icon: 'bar-chart', tab: 'profits' as BFTab, pro: true },
    { label: 'Insights', icon: 'lightbulb', tab: 'insights' as BFTab, pro: true },
  ];

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={ht.content}>
      {/* Hero */}
      <View style={ht.hero}>
        <View style={ht.heroIcon}><MaterialIcons name="pedal-bike" size={36} color={BF.green} /></View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={ht.brandText}>BIKE<Text style={{ color: BF.green }}> FLIPPER</Text></Text>
          <Text style={ht.tagline}>BUY SMART • BUILD BETTER • SELL STRONG</Text>
          <Text style={ht.subTagline}>FIND • ASSESS • UPGRADE • FLIP</Text>
        </View>
        {isPremium ? <View style={ht.proBadge}><Text style={ht.proBadgeText}>PRO</Text></View> : null}
      </View>

      {/* Stats */}
      <View style={ht.statsRow}>
        {[
          { label: 'Bikes in Stock', value: bikeCount !== null ? String(bikeCount) : '—', color: BF.white },
          { label: 'Bike Types', value: '8', color: BF.green },
          { label: 'AI Powered', value: '✓', color: BF.success },
        ].map((s, i) => (
          <View key={s.label} style={[ht.stat, i > 0 && { borderLeftWidth: 1, borderLeftColor: BF.border }]}>
            <Text style={[ht.statNum, { color: s.color }]}>{s.value}</Text>
            <Text style={ht.statLabel}>{s.label}</Text>
          </View>
        ))}
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
              <View style={[ht.gridIcon, locked && { backgroundColor: BF.border }]}>
                <MaterialIcons name={locked ? 'lock' : f.icon as any} size={22} color={locked ? BF.textMuted : BF.green} />
              </View>
              <Text style={[ht.gridLabel, locked && { color: BF.textMuted }]} numberOfLines={1}>{f.label}</Text>
              {locked ? <View style={ht.proTag}><Text style={ht.proTagText}>PRO</Text></View> : null}
            </Pressable>
          );
        })}
      </View>

      {/* Category browser */}
      <Text style={ht.sectionLabel}>CATEGORIES</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: Spacing.sm, paddingVertical: 4 }}>
        {BIKE_CATEGORIES.map(cat => (
          <Pressable key={cat.id} onPress={() => onTabSelect('find')} style={({ pressed }) => [ht.catCard, pressed && { opacity: 0.82 }]}>
            <MaterialIcons name="pedal-bike" size={18} color={BF.green} />
            <Text style={ht.catLabel}>{cat.label}</Text>
            <Text style={ht.catSub}>{cat.sub}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {!isPremium ? (
        <Pressable onPress={onUpgrade} style={({ pressed }) => [ht.upgradeBanner, pressed && { opacity: 0.88 }]}>
          <MaterialIcons name="workspace-premium" size={18} color={BF.black} />
          <View style={{ flex: 1 }}>
            <Text style={ht.upgradeText}>Upgrade to Bike Flipper Pro</Text>
            <Text style={ht.upgradeSub}>£9.99/month · Advanced AI · Live market values</Text>
          </View>
          <Text style={ht.upgradePrice}>£9.99/mo</Text>
        </Pressable>
      ) : (
        <View style={ht.proConfirmed}>
          <MaterialIcons name="workspace-premium" size={15} color={BF.green} />
          <Text style={ht.proConfirmedText}>Bike Flipper Pro — all features unlocked</Text>
        </View>
      )}
    </ScrollView>
  );
}
const ht = StyleSheet.create({
  content: { padding: Spacing.base, gap: Spacing.lg, paddingBottom: 40 },
  sectionLabel: { fontSize: 9, fontWeight: Typography.weight.extrabold, color: BF.textMuted, textTransform: 'uppercase', letterSpacing: 0.8 },
  hero: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: BF.surface, borderRadius: Radius.xxl, padding: Spacing.base, borderWidth: 1, borderColor: BF.green + '40' },
  heroIcon: { width: 60, height: 60, borderRadius: Radius.lg, backgroundColor: BF.greenDim, alignItems: 'center', justifyContent: 'center' },
  brandText: { fontSize: 18, fontWeight: Typography.weight.extrabold, color: BF.white, letterSpacing: 0.5 },
  tagline: { fontSize: 9, color: BF.textSub, letterSpacing: 0.8 },
  subTagline: { fontSize: 8, color: BF.green + '70', letterSpacing: 0.5, marginTop: 1 },
  proBadge: { backgroundColor: BF.green, borderRadius: Radius.pill, paddingHorizontal: 8, paddingVertical: 3 },
  proBadgeText: { fontSize: 8, fontWeight: Typography.weight.extrabold, color: BF.black, letterSpacing: 1 },
  statsRow: { flexDirection: 'row', backgroundColor: BF.surface, borderRadius: Radius.xl, borderWidth: 1, borderColor: BF.border, padding: Spacing.md },
  stat: { flex: 1, alignItems: 'center', gap: 2 },
  statNum: { fontSize: Typography.size.xl, fontWeight: Typography.weight.extrabold },
  statLabel: { fontSize: 9, color: BF.textMuted, textTransform: 'uppercase', letterSpacing: 0.3 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  gridItem: { width: '31%', backgroundColor: BF.surface, borderRadius: Radius.xl, padding: Spacing.md, alignItems: 'center', gap: 6, borderWidth: 1, borderColor: BF.border, aspectRatio: 1, justifyContent: 'center' },
  gridIcon: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: BF.greenDim, alignItems: 'center', justifyContent: 'center' },
  gridLabel: { fontSize: 9, fontWeight: Typography.weight.bold, color: BF.textPrimary, textAlign: 'center' },
  proTag: { backgroundColor: BF.greenDim, borderRadius: Radius.pill, paddingHorizontal: 5, paddingVertical: 2 },
  proTagText: { fontSize: 7, fontWeight: Typography.weight.extrabold, color: BF.green, letterSpacing: 0.5 },
  catCard: { backgroundColor: BF.surface, borderRadius: Radius.xl, padding: Spacing.md, gap: 4, alignItems: 'center', width: 100, borderWidth: 1, borderColor: BF.border },
  catLabel: { fontSize: Typography.size.xs, fontWeight: Typography.weight.bold, color: BF.textPrimary, textAlign: 'center' },
  catSub: { fontSize: 8, color: BF.textMuted, textAlign: 'center', lineHeight: 12 },
  upgradeBanner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: BF.green, borderRadius: Radius.xxl, paddingVertical: Spacing.base, paddingHorizontal: Spacing.lg, shadowColor: BF.green, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.4, shadowRadius: 14, elevation: 6 },
  upgradeText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.extrabold, color: BF.black },
  upgradeSub: { fontSize: 10, color: BF.black + 'AA' },
  upgradePrice: { fontSize: Typography.size.base, fontWeight: Typography.weight.extrabold, color: BF.black },
  proConfirmed: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: BF.greenDim, borderRadius: Radius.xl, padding: Spacing.md, borderWidth: 1, borderColor: BF.green + '40' },
  proConfirmedText: { fontSize: Typography.size.sm, color: BF.green, fontWeight: Typography.weight.semibold },
});

// ── Find Tab — Full AI Identification Flow ────────────────────────────────────
function FindTab({
  capturedImages, onCapture, onRemoveImage, onIdentify, identifying,
  processingStatus, aiError, idResult, isSaving, savedItemId, isUploading,
  uploadProgress, onSave, onReset, isPremium, tenant,
}: {
  capturedImages: CapturedImage[];
  onCapture: (index: number) => void;
  onRemoveImage: (index: number) => void;
  onIdentify: () => void;
  identifying: boolean;
  processingStatus: string;
  aiError: string | null;
  idResult: AIIdentificationResult | null;
  isSaving: boolean;
  savedItemId: string | null;
  isUploading: boolean;
  uploadProgress: string;
  onSave: () => void;
  onReset: () => void;
  isPremium: boolean;
  tenant: any;
}) {
  const router = useRouter();

  const getBikeFields = (result: AIIdentificationResult) => ({
    brand: String(result.attributes?.manufacturer ?? result.attributes?.brand ?? '').replace(/Not established/i, '').trim() || null,
    model: String(result.attributes?.model ?? result.attributes?.model_name ?? '').replace(/Not established/i, '').trim() || null,
    frameType: String(result.attributes?.bike_type ?? result.attributes?.frame_type ?? '').replace(/Not established/i, '').replace(/_/g, ' ').trim() || null,
    yearRange: String(result.attributes?.year_range ?? '').replace(/Not established/i, '').trim() || null,
    frameSize: String(result.attributes?.frame_size ?? '').replace(/Not established/i, '').trim() || null,
    frameMaterial: String(result.attributes?.frame_material ?? '').replace(/Not established/i, '').trim() || null,
    groupset: String(result.attributes?.groupset ?? result.attributes?.drivetrain ?? '').replace(/Not established/i, '').trim() || null,
    wheelSize: String(result.attributes?.wheel_size ?? '').replace(/Not established/i, '').trim() || null,
    brakeType: String(result.attributes?.brake_type ?? result.attributes?.brakes ?? '').replace(/Not established/i, '').trim() || null,
    rideableStatus: String(result.attributes?.rideable_status ?? 'Unknown from images alone'),
    frameCond: String(result.attributes?.frame_condition ?? '').replace(/Not established/i, '').trim() || null,
    tyresCond: String(result.attributes?.tyres_condition ?? result.attributes?.tyre_condition ?? '').replace(/Not established/i, '').trim() || null,
    modifications: String(result.attributes?.modifications ?? '').replace(/Not established/i, '').trim() || null,
    prepEstimate: String(result.attributes?.preparation_estimate ?? result.attributes?.prep_needed ?? '').replace(/Not established/i, '').trim() || null,
  });

  const getRideableColor = (status: string) => {
    const s = status.toLowerCase();
    if (s.includes('rideable') || s.includes('ready')) return BF.success;
    if (s.includes('minor') || s.includes('service')) return BF.warning;
    if (s.includes('non-rideable') || s.includes('needs work') || s.includes('major')) return BF.danger;
    return BF.textMuted;
  };

  // ── Capture phase ──────────────────────────────────────────────────────────
  if (!idResult) {
    const canIdentify = capturedImages.length > 0;
    const MAX_PHOTOS = 4;
    return (
      <View style={{ flex: 1 }}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={ft.content}>
          <View style={ft.hero}>
            <MaterialIcons name="photo-camera" size={28} color={BF.green} />
            <View style={{ flex: 1 }}>
              <Text style={ft.heroTitle}>Find & Identify</Text>
              <Text style={ft.heroSub}>Photograph the bike — AI identifies make, model, year, groupset, frame material and generates a Flip Score</Text>
            </View>
          </View>

          {aiError ? (
            <View style={ft.errorBanner}>
              <MaterialIcons
                name={aiError.includes('quota') ? 'workspace-premium' : 'error-outline'}
                size={15}
                color={aiError.includes('quota') ? BF.green : BF.danger}
              />
              <Text style={[ft.errorText, aiError.includes('quota') && { color: BF.green }]} numberOfLines={5}>
                {aiError}
              </Text>
              {aiError.includes('quota') && !isPremium ? (
                <Pressable onPress={() => router.push('/subscription' as any)} style={ft.quotaBtn}>
                  <Text style={ft.quotaBtnText}>Upgrade</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}

          <Text style={ft.sectionLabel}>BIKE PHOTOS</Text>
          <View style={ft.photoGrid}>
            {Array.from({ length: MAX_PHOTOS }).map((_, idx) => {
              const img = capturedImages[idx] ?? null;
              const isFirst = idx === 0;
              return (
                <View key={idx} style={isFirst ? ft.slotLarge : ft.slotSmall}>
                  <Pressable
                    onPress={() => onCapture(idx)}
                    style={({ pressed }) => [
                      ft.slotInner,
                      img ? ft.slotCaptured : ft.slotEmpty,
                      isFirst && !img ? ft.slotPrimary : null,
                      pressed && { opacity: 0.82 },
                    ]}
                  >
                    {img ? (
                      <>
                        <Image source={{ uri: img.uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
                        <View style={ft.capturedBar}>
                          <MaterialIcons name="check-circle" size={10} color={BF.success} />
                          <Text style={ft.capturedLabel} numberOfLines={1}>Photo {idx + 1}</Text>
                          <Pressable
                            onPress={e => { e.stopPropagation(); onRemoveImage(idx); }}
                            style={ft.removeBtn} hitSlop={8}
                          >
                            <MaterialIcons name="close" size={11} color="#fff" />
                          </Pressable>
                        </View>
                      </>
                    ) : (
                      <View style={ft.emptySlot}>
                        <View style={[ft.emptyIcon, isFirst && ft.emptyIconPrimary]}>
                          <MaterialIcons
                            name={isFirst ? 'add-a-photo' : 'add-photo-alternate'}
                            size={isFirst ? 28 : 20}
                            color={isFirst ? BF.green : BF.textMuted}
                          />
                        </View>
                        <Text style={[ft.emptyLabel, isFirst && { color: BF.textPrimary }]} numberOfLines={1}>
                          {isFirst ? 'Main Photo' : `Photo ${idx + 1}`}
                        </Text>
                        <Text style={[ft.optionalText, isFirst && { color: BF.green + 'BB' }]}>
                          {isFirst ? 'Required' : 'Optional'}
                        </Text>
                      </View>
                    )}
                  </Pressable>
                </View>
              );
            })}
          </View>

          <View style={ft.tip}>
            <MaterialIcons name="lightbulb-outline" size={13} color={BF.green} />
            <Text style={ft.tipText}>
              Full side profile, head badge, and drivetrain shots give the best identification. Add a detail shot of the frame number or groupset markings.
            </Text>
          </View>

          <Text style={ft.sectionLabel}>WHAT THE AI IDENTIFIES</Text>
          <View style={ft.aiCard}>
            {[
              'Brand and model from head badge, decals and frame design',
              'Frame type (MTB, road, gravel, BMX, e-bike, hybrid)',
              'Year range from geometry, component spec and graphics',
              'Frame size from visible markings or geometry estimate',
              'Frame material (aluminium, carbon, steel, titanium)',
              'Groupset brand and level (Shimano, SRAM, Campagnolo)',
              'Wheel size and tyre condition',
              'Brake type (disc, rim, hydraulic, mechanical)',
              'Visible modifications and aftermarket upgrades',
              'Overall condition and rideability assessment',
            ].map((item, i) => (
              <View key={i} style={ft.aiRow}>
                <MaterialIcons name="check-circle" size={12} color={BF.green} />
                <Text style={ft.aiText}>{item}</Text>
              </View>
            ))}
          </View>

          <View style={{ height: 100 }} />
        </ScrollView>

        <View style={ft.actionBar}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={ft.actionCount}>{capturedImages.length} of 4 photos added</Text>
            <Text style={ft.actionHint}>
              {capturedImages.length === 0 ? 'Add at least 1 photo to identify' : 'Ready — tap Identify to analyse'}
            </Text>
          </View>
          <Pressable
            onPress={onIdentify}
            disabled={!canIdentify || identifying}
            style={({ pressed }) => [
              ft.identifyBtn,
              !canIdentify && ft.identifyBtnDisabled,
              pressed && canIdentify && { opacity: 0.88 },
            ]}
          >
            {identifying ? (
              <ActivityIndicator size="small" color={BF.black} />
            ) : (
              <MaterialIcons name="auto-awesome" size={18} color={canIdentify ? BF.black : BF.textMuted} />
            )}
            <Text style={[ft.identifyBtnText, !canIdentify && { color: BF.textMuted }]}>
              {identifying ? (processingStatus || 'Identifying...') : 'Identify Bike'}
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // ── Result view ───────────────────────────────────────────────────────────
  const bikeFields = getBikeFields(idResult);
  const flipScore = calculateBikeFlipScore(idResult);
  const rideableColor = getRideableColor(bikeFields.rideableStatus);
  const confColor = idResult.confidence >= 0.75 ? BF.success : idResult.confidence >= 0.55 ? BF.warning : BF.danger;

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={ft.content}>
      {savedItemId ? (
        <View style={ft.savedBanner}>
          <MaterialIcons name="check-circle" size={18} color={BF.success} />
          <View style={{ flex: 1 }}>
            <Text style={ft.savedText}>Saved to inventory</Text>
            {uploadProgress ? <Text style={ft.savedSub}>{uploadProgress}</Text> : null}
          </View>
        </View>
      ) : null}

      <View style={ft.resultHero}>
        <FlipScore score={flipScore} />
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={ft.resultTitle} numberOfLines={3}>{idResult.canonicalTitle}</Text>
          <View style={ft.confRow}>
            <View style={[ft.confDot, { backgroundColor: confColor }]} />
            <Text style={[ft.confText, { color: confColor }]}>
              {Math.round(idResult.confidence * 100)}% confidence · {idResult.confidenceTier}
            </Text>
          </View>
        </View>
      </View>

      {capturedImages.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: Spacing.sm }}>
          {capturedImages.map((img, idx) => (
            <Image key={idx} source={{ uri: img.uri }} style={ft.thumb} contentFit="cover" />
          ))}
        </ScrollView>
      ) : null}

      {/* Rideability — key commercial signal */}
      <View style={[ft.rideableCard, { borderColor: rideableColor + '50', backgroundColor: rideableColor + '12' }]}>
        <MaterialIcons name="pedal-bike" size={18} color={rideableColor} />
        <View style={{ flex: 1 }}>
          <Text style={ft.rideableLabel}>Rideability</Text>
          <Text style={[ft.rideableStatus, { color: rideableColor }]}>{bikeFields.rideableStatus}</Text>
        </View>
        {bikeFields.rideableStatus.toLowerCase().includes('rideable') || bikeFields.rideableStatus.toLowerCase().includes('ready') ? (
          <MaterialIcons name="check-circle" size={18} color={BF.success} />
        ) : bikeFields.rideableStatus.toLowerCase().includes('non-rideable') || bikeFields.rideableStatus.toLowerCase().includes('needs work') ? (
          <MaterialIcons name="build" size={18} color={BF.warning} />
        ) : (
          <MaterialIcons name="help-outline" size={18} color={BF.textMuted} />
        )}
      </View>

      <View style={ft.specsCard}>
        <Text style={ft.specsTitle}>BIKE SPECIFICATION</Text>
        {[
          { label: 'Brand', value: bikeFields.brand, icon: 'business' as const },
          { label: 'Model', value: bikeFields.model, icon: 'label' as const },
          { label: 'Bike Type', value: bikeFields.frameType, icon: 'pedal-bike' as const },
          { label: 'Year Range', value: bikeFields.yearRange, icon: 'calendar-today' as const },
          { label: 'Frame Size', value: bikeFields.frameSize, icon: 'straighten' as const },
          { label: 'Frame Material', value: bikeFields.frameMaterial, icon: 'layers' as const },
          { label: 'Groupset', value: bikeFields.groupset, icon: 'settings' as const },
          { label: 'Wheel Size', value: bikeFields.wheelSize, icon: 'radio-button-unchecked' as const },
          { label: 'Brakes', value: bikeFields.brakeType, icon: 'stop-circle' as const },
        ].filter(r => r.value).map((row, i) => (
          <View key={i} style={ft.specRow}>
            <MaterialIcons name={row.icon} size={13} color={BF.textMuted} style={{ width: 18 }} />
            <Text style={ft.specKey}>{row.label}</Text>
            <Text style={ft.specValue} numberOfLines={1}>{row.value}</Text>
          </View>
        ))}
      </View>

      <View style={ft.condCard}>
        <Text style={ft.specsTitle}>CONDITION</Text>
        <Text style={ft.condOverall}>{idResult.condition}</Text>
        {bikeFields.frameCond ? (
          <View style={ft.condRow}>
            <Text style={ft.condLabel}>Frame</Text>
            <Text style={ft.condVal}>{bikeFields.frameCond}</Text>
          </View>
        ) : null}
        {bikeFields.tyresCond ? (
          <View style={ft.condRow}>
            <Text style={ft.condLabel}>Tyres</Text>
            <Text style={ft.condVal}>{bikeFields.tyresCond}</Text>
          </View>
        ) : null}
        {bikeFields.prepEstimate ? (
          <View style={ft.condRow}>
            <Text style={ft.condLabel}>Work Needed</Text>
            <Text style={[ft.condVal, {
              color: bikeFields.prepEstimate.toLowerCase().includes('none') ? BF.success
                : bikeFields.prepEstimate.toLowerCase().includes('major') ? BF.danger
                : BF.warning,
            }]}>{bikeFields.prepEstimate}</Text>
          </View>
        ) : null}
      </View>

      {bikeFields.modifications ? (
        <View style={ft.modsCard}>
          <MaterialIcons name="build" size={13} color={BF.green} />
          <View style={{ flex: 1 }}>
            <Text style={ft.modsLabel}>UPGRADES & MODIFICATIONS</Text>
            <Text style={ft.modsText}>{bikeFields.modifications}</Text>
          </View>
        </View>
      ) : null}

      {idResult.warnings?.length > 0 ? (
        <View style={ft.warningsCard}>
          {idResult.warnings.slice(0, 3).map((w, i) => (
            <View key={i} style={ft.warningRow}>
              <MaterialIcons name="warning" size={11} color={BF.warning} />
              <Text style={ft.warningText} numberOfLines={3}>{w}</Text>
            </View>
          ))}
        </View>
      ) : null}

      <View style={ft.flipScoreGuide}>
        <Text style={ft.specsTitle}>FLIP SCORE GUIDE</Text>
        <View style={{ flexDirection: 'row', justifyContent: 'space-around' }}>
          {[{ score: 82, label: 'Strong buy' }, { score: 60, label: 'Negotiate' }, { score: 35, label: 'Pass' }].map(s => (
            <View key={s.score} style={{ alignItems: 'center', gap: 6 }}>
              <FlipScore score={s.score} />
              <Text style={{ fontSize: 10, color: BF.textSub }}>{s.label}</Text>
            </View>
          ))}
        </View>
      </View>

      <View style={ft.actions}>
        <Pressable onPress={onReset} style={ft.resetBtn}>
          <MaterialIcons name="refresh" size={16} color={BF.textSub} />
          <Text style={ft.resetText}>New Scan</Text>
        </Pressable>
        {savedItemId ? (
          <Pressable
            onPress={() => router.push(`/create-listing?id=${savedItemId}` as any)}
            style={ft.primaryBtn}
          >
            {isUploading ? <ActivityIndicator size="small" color={BF.black} /> : <MaterialIcons name="sell" size={16} color={BF.black} />}
            <Text style={ft.primaryBtnText}>{isUploading ? 'Uploading...' : 'List on eBay'}</Text>
          </Pressable>
        ) : (
          <Pressable onPress={onSave} disabled={isSaving} style={ft.primaryBtn}>
            {isSaving ? <ActivityIndicator size="small" color={BF.black} /> : <MaterialIcons name="add" size={16} color={BF.black} />}
            <Text style={ft.primaryBtnText}>{isSaving ? 'Saving...' : 'Save to Inventory'}</Text>
          </Pressable>
        )}
      </View>

      {savedItemId ? (
        <Pressable
          onPress={() => router.push(`/item/${savedItemId}` as any)}
          style={({ pressed }) => [ft.viewItemBtn, pressed && { opacity: 0.85 }]}
        >
          <MaterialIcons name="inventory-2" size={15} color={BF.green} />
          <Text style={ft.viewItemText}>View in Inventory</Text>
          <MaterialIcons name="chevron-right" size={15} color={BF.textMuted} />
        </Pressable>
      ) : null}

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const ft = StyleSheet.create({
  content: { padding: Spacing.base, gap: Spacing.md, paddingBottom: 40 },
  sectionLabel: { fontSize: 9, fontWeight: Typography.weight.extrabold, color: BF.textMuted, textTransform: 'uppercase', letterSpacing: 0.8 },
  hero: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: BF.surface, borderRadius: Radius.xl, padding: Spacing.base, borderWidth: 1, borderColor: BF.green + '30' },
  heroTitle: { fontSize: Typography.size.xl, fontWeight: Typography.weight.extrabold, color: BF.white },
  heroSub: { fontSize: Typography.size.xs, color: BF.textSub, lineHeight: 17, marginTop: 3 },

  errorBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, backgroundColor: BF.greenDim, borderRadius: Radius.md, padding: Spacing.md, borderWidth: 1, borderColor: BF.danger + '40' },
  errorText: { flex: 1, fontSize: Typography.size.xs, color: BF.danger, lineHeight: 17 },
  quotaBtn: { backgroundColor: BF.greenDim, borderRadius: Radius.md, paddingHorizontal: Spacing.sm, paddingVertical: 4, borderWidth: 1, borderColor: BF.green + '40' },
  quotaBtnText: { fontSize: 10, fontWeight: Typography.weight.bold, color: BF.green },

  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  slotLarge: { width: '100%', aspectRatio: 1.7 },
  slotSmall: { width: '31%', aspectRatio: 1 },
  slotInner: { flex: 1, borderRadius: Radius.lg, overflow: 'hidden', position: 'relative' },
  slotEmpty: { backgroundColor: BF.surface, borderWidth: 1.5, borderStyle: 'dashed', borderColor: BF.border, alignItems: 'center', justifyContent: 'center' },
  slotPrimary: { borderColor: BF.green + '60' },
  slotCaptured: { borderWidth: 2, borderColor: BF.success + '70', borderStyle: 'solid' },
  emptySlot: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 5, paddingHorizontal: Spacing.sm },
  emptyIcon: { width: 48, height: 48, borderRadius: Radius.md, backgroundColor: BF.surfaceHigh, alignItems: 'center', justifyContent: 'center' },
  emptyIconPrimary: { backgroundColor: BF.greenDim },
  emptyLabel: { fontSize: 11, fontWeight: Typography.weight.semibold, color: BF.textSub, textAlign: 'center' },
  optionalText: { fontSize: 8, color: BF.textMuted, textTransform: 'uppercase', letterSpacing: 0.2 },
  capturedBar: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.62)', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 5, gap: 4 },
  capturedLabel: { flex: 1, fontSize: 9, color: '#fff', fontWeight: Typography.weight.semibold },
  removeBtn: { backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 10, width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },

  tip: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, backgroundColor: BF.greenDim, borderRadius: Radius.md, padding: Spacing.md, borderWidth: 1, borderColor: BF.green + '25' },
  tipText: { flex: 1, fontSize: 11, color: BF.green, lineHeight: 16 },

  aiCard: { backgroundColor: BF.surface, borderRadius: Radius.xl, padding: Spacing.base, gap: Spacing.sm, borderWidth: 1, borderColor: BF.border },
  aiRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  aiText: { flex: 1, fontSize: Typography.size.xs, color: BF.textSub, lineHeight: 17 },

  actionBar: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: BF.surface, borderTopWidth: 1, borderTopColor: BF.border, padding: Spacing.base, flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  actionCount: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: BF.textPrimary },
  actionHint: { fontSize: Typography.size.xs, color: BF.textSub },
  identifyBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, backgroundColor: BF.green, borderRadius: Radius.md, padding: Spacing.md, shadowColor: BF.green, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.45, shadowRadius: 10, elevation: 6 },
  identifyBtnDisabled: { backgroundColor: BF.surfaceHigh, shadowOpacity: 0 },
  identifyBtnText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: BF.black },

  savedBanner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: '#0A2010', borderRadius: Radius.md, padding: Spacing.md, borderWidth: 1, borderColor: BF.success + '40' },
  savedText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: BF.success },
  savedSub: { fontSize: 10, color: BF.success + 'BB', marginTop: 2 },

  resultHero: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md, backgroundColor: BF.surface, borderRadius: Radius.xl, padding: Spacing.base, borderWidth: 1, borderColor: BF.green + '40' },
  resultTitle: { fontSize: Typography.size.base, fontWeight: Typography.weight.bold, color: BF.white, lineHeight: 22 },
  confRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  confDot: { width: 7, height: 7, borderRadius: 4 },
  confText: { fontSize: Typography.size.xs, fontWeight: Typography.weight.semibold },

  thumb: { width: 80, height: 80, borderRadius: Radius.md },

  rideableCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, borderRadius: Radius.xl, padding: Spacing.base, borderWidth: 1 },
  rideableLabel: { fontSize: 9, fontWeight: Typography.weight.extrabold, color: BF.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  rideableStatus: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, lineHeight: 18, marginTop: 2 },

  specsCard: { backgroundColor: BF.surface, borderRadius: Radius.xl, padding: Spacing.base, borderWidth: 1, borderColor: BF.border, gap: 2 },
  specsTitle: { fontSize: 9, fontWeight: Typography.weight.extrabold, color: BF.textMuted, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: Spacing.sm },
  specRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: BF.border + '60' },
  specKey: { flex: 1, fontSize: Typography.size.xs, color: BF.textSub },
  specValue: { fontSize: Typography.size.xs, fontWeight: Typography.weight.semibold, color: BF.textPrimary, maxWidth: '55%', textAlign: 'right' },

  condCard: { backgroundColor: BF.surface, borderRadius: Radius.xl, padding: Spacing.base, borderWidth: 1, borderColor: BF.border },
  condOverall: { fontSize: Typography.size.sm, color: BF.textPrimary, lineHeight: 18, marginBottom: Spacing.sm },
  condRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5, borderTopWidth: 1, borderTopColor: BF.border + '50' },
  condLabel: { fontSize: Typography.size.xs, color: BF.textSub },
  condVal: { fontSize: Typography.size.xs, fontWeight: Typography.weight.semibold, color: BF.textPrimary, maxWidth: '60%', textAlign: 'right' },

  modsCard: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, backgroundColor: BF.greenDim, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: BF.green + '30' },
  modsLabel: { fontSize: 9, fontWeight: Typography.weight.extrabold, color: BF.green, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3 },
  modsText: { fontSize: Typography.size.xs, color: BF.textSub, lineHeight: 17 },

  warningsCard: { backgroundColor: BF.surfaceHigh, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.sm, borderWidth: 1, borderColor: BF.warning + '30' },
  warningRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  warningText: { flex: 1, fontSize: Typography.size.xs, color: BF.warning, lineHeight: 16 },

  flipScoreGuide: { backgroundColor: BF.surface, borderRadius: Radius.xl, padding: Spacing.base, borderWidth: 1, borderColor: BF.border },

  actions: { flexDirection: 'row', gap: Spacing.sm },
  resetBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, padding: Spacing.md, borderRadius: Radius.md, backgroundColor: BF.surface, borderWidth: 1, borderColor: BF.border },
  resetText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: BF.textSub },
  primaryBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, backgroundColor: BF.green, borderRadius: Radius.md, padding: Spacing.md, shadowColor: BF.green, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.4, shadowRadius: 10, elevation: 5 },
  primaryBtnText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: BF.black },

  viewItemBtn: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: BF.surface, borderRadius: Radius.xl, padding: Spacing.base, borderWidth: 1, borderColor: BF.green + '30' },
  viewItemText: { flex: 1, fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: BF.green },
});

// ── Assess Tab ────────────────────────────────────────────────────────────────
function AssessTab() {
  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={as.content}>
      <View style={as.hero}>
        <MaterialIcons name="assignment" size={28} color={BF.green} />
        <View style={{ flex: 1 }}>
          <Text style={as.heroTitle}>Bike Assessment</Text>
          <Text style={as.heroSub}>Condition · Parts · Upgrades · Notes</Text>
        </View>
      </View>
      <Text style={as.sectionLabel}>CONDITION ASSESSMENT</Text>
      <View style={as.checkCard}>
        <Text style={[as.sectionLabel, { marginBottom: Spacing.sm }]}>Example — Scott Scale 50</Text>
        <ConditionRow label="Frame" icon="settings" status="good" />
        <ConditionRow label="Fork" icon="settings" status="fair" />
        <ConditionRow label="Wheels" icon="settings" status="good" />
        <ConditionRow label="Brakes" icon="settings" status="fair" />
        <ConditionRow label="Drivetrain" icon="settings" status="poor" />
        <ConditionRow label="Tyres" icon="settings" status="fair" />
      </View>
      <View style={as.costsCard}>
        <Text style={as.sectionLabel}>ESTIMATED REPAIR COSTS</Text>
        {[
          { label: 'Parts estimate', value: '£120 – £180' },
          { label: 'Labour (if needed)', value: '£50 – £100' },
          { label: 'Total estimated cost', value: '£170 – £280', bold: true },
        ].map(row => (
          <View key={row.label} style={[as.costRow, row.bold && { borderTopWidth: 1, borderTopColor: BF.border, marginTop: 4, paddingTop: 8 }]}>
            <Text style={[as.costLabel, row.bold && { fontWeight: Typography.weight.bold, color: BF.white }]}>{row.label}</Text>
            <Text style={[as.costValue, row.bold && { color: BF.green }]}>{row.value}</Text>
          </View>
        ))}
      </View>
      <View style={as.infoCard}>
        <MaterialIcons name="info-outline" size={14} color={BF.green} />
        <Text style={as.infoText}>Scan a bike to generate a personalised assessment with AI-rated component conditions and repair cost estimates.</Text>
      </View>
    </ScrollView>
  );
}
const as = StyleSheet.create({
  content: { padding: Spacing.base, gap: Spacing.lg, paddingBottom: 40 },
  sectionLabel: { fontSize: 9, fontWeight: Typography.weight.extrabold, color: BF.textMuted, textTransform: 'uppercase', letterSpacing: 0.8 },
  hero: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: BF.surface, borderRadius: Radius.xl, padding: Spacing.base, borderWidth: 1, borderColor: BF.green + '30' },
  heroTitle: { fontSize: Typography.size.xl, fontWeight: Typography.weight.extrabold, color: BF.white },
  heroSub: { fontSize: Typography.size.xs, color: BF.textSub, marginTop: 2 },
  checkCard: { backgroundColor: BF.surface, borderRadius: Radius.xl, padding: Spacing.base, borderWidth: 1, borderColor: BF.border },
  costsCard: { backgroundColor: BF.surface, borderRadius: Radius.xl, padding: Spacing.base, gap: Spacing.sm, borderWidth: 1, borderColor: BF.border },
  costRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 },
  costLabel: { fontSize: Typography.size.sm, color: BF.textSub },
  costValue: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: BF.white },
  infoCard: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, backgroundColor: BF.greenDim, borderRadius: Radius.md, padding: Spacing.md, borderWidth: 1, borderColor: BF.green + '25' },
  infoText: { flex: 1, fontSize: Typography.size.xs, color: BF.green, lineHeight: 17 },
});

// ── Upgrade Tab ───────────────────────────────────────────────────────────────
function UpgradeTab() {
  const router = useRouter();
  const UPGRADE_CATEGORIES = [
    { label: 'Wheels & Tyres', icon: 'radio-button-unchecked', sub: 'Rims, hubs, rubber — high ROI upgrades' },
    { label: 'Drivetrain', icon: 'settings', sub: 'Groupsets, cassettes, chains — cost vs value' },
    { label: 'Suspension', icon: 'unfold-more', sub: 'Forks, shocks — buyer appeal' },
    { label: 'Brakes', icon: 'stop-circle', sub: 'Hydraulic vs mechanical — safety & price' },
    { label: 'Cockpit', icon: 'horizontal-rule', sub: 'Bars, stem, grips — cheap improvements' },
    { label: 'Saddle & Post', icon: 'airline-seat-recline-normal', sub: 'Dropper posts add value to MTBs' },
  ];
  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={up.content}>
      <View style={up.hero}>
        <MaterialIcons name="build" size={28} color={BF.green} />
        <View style={{ flex: 1 }}>
          <Text style={up.heroTitle}>Parts & Upgrades</Text>
          <Text style={up.heroSub}>Compatibility checks · ROI estimator · Parts links</Text>
        </View>
      </View>
      <Text style={up.sectionLabel}>UPGRADE CATEGORIES</Text>
      {UPGRADE_CATEGORIES.map(cat => (
        <View key={cat.label} style={up.catCard}>
          <View style={[up.catIcon, { backgroundColor: BF.greenDim }]}><MaterialIcons name={cat.icon as any} size={20} color={BF.green} /></View>
          <View style={{ flex: 1 }}>
            <Text style={up.catLabel}>{cat.label}</Text>
            <Text style={up.catSub}>{cat.sub}</Text>
          </View>
          <MaterialIcons name="chevron-right" size={16} color={BF.textMuted} />
        </View>
      ))}
      <View style={up.roiCard}>
        <Text style={up.sectionLabel}>UPGRADE ROI GUIDE</Text>
        {[
          { upgrade: 'New tyres (£40)', addedValue: '+£60–80', roi: '50–100%', worth: true },
          { upgrade: 'Hydraulic brake bleed (£15)', addedValue: '+£50–80', roi: '200%+', worth: true },
          { upgrade: 'Full paint job (£200)', addedValue: '+£50', roi: 'Negative', worth: false },
          { upgrade: 'Clean & polish (£5)', addedValue: '+£30–50', roi: '500%+', worth: true },
        ].map(row => (
          <View key={row.upgrade} style={up.roiRow}>
            <View style={[up.roiDot, { backgroundColor: row.worth ? BF.green : BF.danger }]} />
            <View style={{ flex: 1 }}>
              <Text style={up.roiLabel}>{row.upgrade}</Text>
              <Text style={up.roiSub}>{row.addedValue}</Text>
            </View>
            <Text style={[up.roiValue, { color: row.worth ? BF.green : BF.danger }]}>{row.roi}</Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}
const up = StyleSheet.create({
  content: { padding: Spacing.base, gap: Spacing.md, paddingBottom: 40 },
  sectionLabel: { fontSize: 9, fontWeight: Typography.weight.extrabold, color: BF.textMuted, textTransform: 'uppercase', letterSpacing: 0.8 },
  hero: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: BF.surface, borderRadius: Radius.xl, padding: Spacing.base, borderWidth: 1, borderColor: BF.green + '30' },
  heroTitle: { fontSize: Typography.size.xl, fontWeight: Typography.weight.extrabold, color: BF.white },
  heroSub: { fontSize: Typography.size.xs, color: BF.textSub, marginTop: 2 },
  catCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: BF.surface, borderRadius: Radius.xl, padding: Spacing.base, borderWidth: 1, borderColor: BF.border },
  catIcon: { width: 44, height: 44, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  catLabel: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: BF.white },
  catSub: { fontSize: Typography.size.xs, color: BF.textSub, marginTop: 2 },
  roiCard: { backgroundColor: BF.surface, borderRadius: Radius.xl, padding: Spacing.base, gap: Spacing.sm, borderWidth: 1, borderColor: BF.border },
  roiRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: BF.border + '60' },
  roiDot: { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  roiLabel: { fontSize: Typography.size.sm, color: BF.textPrimary },
  roiSub: { fontSize: Typography.size.xs, color: BF.textSub },
  roiValue: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, minWidth: 60, textAlign: 'right' },
});

// ── Profits Tab ───────────────────────────────────────────────────────────────
function ProfitsTab() {
  const router = useRouter();
  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={pr.content}>
      <View style={pr.hero}>
        <MaterialIcons name="bar-chart" size={28} color={BF.green} />
        <View style={{ flex: 1 }}>
          <Text style={pr.heroTitle}>Profits</Text>
          <Text style={pr.heroSub}>Track earnings · Real market data · Performance</Text>
        </View>
      </View>
      {[
        { icon: 'account-balance-wallet', label: 'P&L Dashboard', sub: 'Revenue, costs and net profit tracking', route: '/money' as any },
        { icon: 'inventory-2', label: 'Bike Inventory', sub: 'Days in stock, target price, potential profit', route: '/(tabs)/inventory' as any },
        { icon: 'local-shipping', label: 'Orders', sub: 'Manage and fulfil buyer orders', route: '/orders' as any },
        { icon: 'price-change', label: 'Repricing', sub: 'Auto-adjust prices to market', route: '/repricing' as any },
      ].map(item => (
        <Pressable key={item.label} onPress={() => router.push(item.route)} style={({ pressed }) => [pr.card, pressed && { opacity: 0.85 }]}>
          <View style={[pr.cardIcon, { backgroundColor: BF.green + '20' }]}><MaterialIcons name={item.icon as any} size={22} color={BF.green} /></View>
          <View style={{ flex: 1 }}>
            <Text style={pr.cardLabel}>{item.label}</Text>
            <Text style={pr.cardSub}>{item.sub}</Text>
          </View>
          <MaterialIcons name="chevron-right" size={16} color={BF.textMuted} />
        </Pressable>
      ))}
      <View style={pr.exampleCard}>
        <Text style={pr.sectionLabel}>BUY DECISION EXAMPLE</Text>
        <View style={pr.exampleRow}><Text style={pr.exLabel}>Asking price</Text><Text style={pr.exValue}>£250</Text></View>
        <View style={pr.exampleRow}><Text style={pr.exLabel}>Market value (good condition)</Text><Text style={pr.exValue}>£450–600</Text></View>
        <View style={pr.exampleRow}><Text style={pr.exLabel}>Estimated repair costs</Text><Text style={pr.exValue}>£170–280</Text></View>
        <View style={pr.exampleRow}><Text style={pr.exLabel}>Likely selling price</Text><Text style={pr.exValue}>£600–750</Text></View>
        <View style={[pr.exampleRow, { borderTopWidth: 1, borderTopColor: BF.border, marginTop: 4, paddingTop: 8 }]}>
          <Text style={[pr.exLabel, { color: BF.white, fontWeight: Typography.weight.bold }]}>Expected profit</Text>
          <Text style={[pr.exValue, { color: BF.green, fontSize: Typography.size.base }]}>£180–270</Text>
        </View>
        <View style={pr.maxPurchase}>
          <Text style={pr.maxLabel}>Maximum sensible purchase price</Text>
          <Text style={pr.maxValue}>£320</Text>
        </View>
      </View>
    </ScrollView>
  );
}
const pr = StyleSheet.create({
  content: { padding: Spacing.base, gap: Spacing.md, paddingBottom: 40 },
  sectionLabel: { fontSize: 9, fontWeight: Typography.weight.extrabold, color: BF.textMuted, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: Spacing.sm },
  hero: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: BF.surface, borderRadius: Radius.xl, padding: Spacing.base, borderWidth: 1, borderColor: BF.green + '30' },
  heroTitle: { fontSize: Typography.size.xl, fontWeight: Typography.weight.extrabold, color: BF.white },
  heroSub: { fontSize: Typography.size.xs, color: BF.textSub, marginTop: 2 },
  card: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: BF.surface, borderRadius: Radius.xl, padding: Spacing.base, borderWidth: 1, borderColor: BF.border },
  cardIcon: { width: 44, height: 44, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  cardLabel: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: BF.white },
  cardSub: { fontSize: Typography.size.xs, color: BF.textSub, marginTop: 2 },
  exampleCard: { backgroundColor: BF.surface, borderRadius: Radius.xl, padding: Spacing.base, borderWidth: 1, borderColor: BF.border },
  exampleRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: BF.border + '60' },
  exLabel: { fontSize: Typography.size.sm, color: BF.textSub },
  exValue: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: BF.white },
  maxPurchase: { marginTop: Spacing.md, backgroundColor: BF.greenDim, borderRadius: Radius.lg, padding: Spacing.md, alignItems: 'center', borderWidth: 1, borderColor: BF.green + '30' },
  maxLabel: { fontSize: Typography.size.xs, color: BF.green, marginBottom: 4 },
  maxValue: { fontSize: 28, fontWeight: Typography.weight.extrabold, color: BF.green },
});

// ── Insights Tab ──────────────────────────────────────────────────────────────
function InsightsTab() {
  const router = useRouter();
  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={ins.content}>
      <View style={ins.hero}>
        <MaterialIcons name="lightbulb" size={28} color={BF.green} />
        <View style={{ flex: 1 }}>
          <Text style={ins.heroTitle}>Insights</Text>
          <Text style={ins.heroSub}>Market trends · Buying opportunities · AI recommendations</Text>
        </View>
      </View>
      {[
        { icon: 'trending-up', label: 'Market Trends', sub: 'Which bikes are hot on eBay right now', route: '/money' as any },
        { icon: 'auto-awesome', label: 'AI Recommendations', sub: 'What to buy, fix, and list this week', route: '/command-centre' as any },
        { icon: 'receipt', label: 'All Orders', sub: 'Track sales and buyer feedback', route: '/orders' as any },
      ].map(item => (
        <Pressable key={item.label} onPress={() => router.push(item.route)} style={({ pressed }) => [ins.card, pressed && { opacity: 0.85 }]}>
          <View style={[ins.cardIcon, { backgroundColor: BF.green + '20' }]}><MaterialIcons name={item.icon as any} size={20} color={BF.green} /></View>
          <View style={{ flex: 1 }}>
            <Text style={ins.cardLabel}>{item.label}</Text>
            <Text style={ins.cardSub}>{item.sub}</Text>
          </View>
          <MaterialIcons name="chevron-right" size={16} color={BF.textMuted} />
        </Pressable>
      ))}
      <View style={ins.factsCard}>
        <Text style={ins.sectionLabel}>BIKE FLIPPING FACTS</Text>
        {[
          'Full suspension MTBs £300–1500 have the largest buyer pool',
          'Cleaning alone can add 20-30% to perceived value',
          'Bikes with original receipts command 10-15% premium',
          'eBay Motors + Gumtree combined gives maximum exposure',
          'Spring and autumn are peak buying seasons for bikes',
          'Electric bikes are the fastest-growing segment',
          'Component upgrades rarely add value equal to cost',
        ].map((fact, i) => (
          <View key={i} style={ins.factRow}>
            <MaterialIcons name="lightbulb-outline" size={12} color={BF.green} />
            <Text style={ins.factText}>{fact}</Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}
const ins = StyleSheet.create({
  content: { padding: Spacing.base, gap: Spacing.md, paddingBottom: 40 },
  sectionLabel: { fontSize: 9, fontWeight: Typography.weight.extrabold, color: BF.textMuted, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: Spacing.sm },
  hero: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: BF.surface, borderRadius: Radius.xl, padding: Spacing.base, borderWidth: 1, borderColor: BF.green + '30' },
  heroTitle: { fontSize: Typography.size.xl, fontWeight: Typography.weight.extrabold, color: BF.white },
  heroSub: { fontSize: Typography.size.xs, color: BF.textSub, marginTop: 2 },
  card: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: BF.surface, borderRadius: Radius.xl, padding: Spacing.base, borderWidth: 1, borderColor: BF.border },
  cardIcon: { width: 44, height: 44, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  cardLabel: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: BF.white },
  cardSub: { fontSize: Typography.size.xs, color: BF.textSub, marginTop: 2 },
  factsCard: { backgroundColor: BF.surface, borderRadius: Radius.xl, padding: Spacing.base, borderWidth: 1, borderColor: BF.border },
  factRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, paddingVertical: 5 },
  factText: { flex: 1, fontSize: Typography.size.xs, color: BF.textSub, lineHeight: 17 },
});

// ── Main Screen ───────────────────────────────────────────────────────────────
export default function BikeFlipper({ isHomeTab = false }: { isHomeTab?: boolean } = {}) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { tenant } = useApp();
  const { isPremium } = useSubscription();
  const { showAlert } = useAlert();
  const [activeTab, setActiveTab] = useState<BFTab>('home');
  const [showPaywall, setShowPaywall] = useState(false);

  // ── Find Tab capture & AI state ────────────────────────────────────────────
  const [capturedImages, setCapturedImages] = useState<CapturedImage[]>([]);
  const [identifying, setIdentifying] = useState(false);
  const [processingStatus, setProcessingStatus] = useState('');
  const [aiError, setAiError] = useState<string | null>(null);
  const [idResult, setIdResult] = useState<AIIdentificationResult | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [savedItemId, setSavedItemId] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');

  const handleCapture = useCallback(async (index: number) => {
    let image: CapturedImage | null = await captureFromCamera();
    if (!image) image = await pickFromLibrary(`slot_${index}`, `Photo ${index + 1}`);
    if (!image) return;
    setCapturedImages(prev => {
      const next = [...prev];
      next[index] = { ...image!, slotId: `slot_${index}`, slotLabel: `Photo ${index + 1}` };
      return next;
    });
  }, []);

  const handleRemoveImage = useCallback((index: number) => {
    setCapturedImages(prev => prev.filter((_, i) => i !== index));
  }, []);

  const handleIdentify = useCallback(async () => {
    if (capturedImages.length === 0) return;
    setIdentifying(true);
    setAiError(null);

    const statusMsgs = [
      'Preparing bike images...',
      'Routing to bicycle specialist...',
      'AI vision analysis...',
      'Identifying make & model...',
      'Calculating Flip Score...',
    ];
    for (const msg of statusMsgs) {
      setProcessingStatus(msg);
      await new Promise(r => setTimeout(r, 300));
    }

    const { result, error, quotaExceeded } = await identifyItemWithAI(
      capturedImages, 'bicycles', undefined, undefined,
      { tenantId: tenant?.id },
    );

    setIdentifying(false);

    if (quotaExceeded) {
      setAiError(`Monthly quota reached (${quotaExceeded.used}/${quotaExceeded.limit} free identifications). Upgrade to Bike Flipper Pro for unlimited identifications.`);
      return;
    }
    if (error || !result) {
      setAiError(error ?? 'Identification failed — please try again');
      return;
    }

    setIdResult(result);
    setSavedItemId(null);
    setIsUploading(false);
    setUploadProgress('');
  }, [capturedImages, tenant?.id]);

  const handleSaveBike = useCallback(async () => {
    if (!idResult || !tenant) return;
    setIsSaving(true);
    const { item, error } = await saveIdentifiedItem(tenant.id, idResult, {
      mediaUris: capturedImages.map(i => i.uri),
    });
    setIsSaving(false);
    if (error || !item) { showAlert('Save Failed', error ?? 'Could not save bike.'); return; }
    setSavedItemId(item.id);
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
  }, [idResult, tenant, capturedImages, showAlert]);

  const handleResetFind = useCallback(() => {
    setCapturedImages([]);
    setIdResult(null);
    setAiError(null);
    setSavedItemId(null);
    setIsUploading(false);
    setUploadProgress('');
    setProcessingStatus('');
  }, []);

  const handleTabSelect = useCallback((tab: BFTab) => {
    const premiumTabs: BFTab[] = ['profits', 'insights'];
    if (premiumTabs.includes(tab) && !isPremium) { setShowPaywall(true); return; }
    setActiveTab(tab);
  }, [isPremium]);

  if (showPaywall) return <BFPaywall onBack={() => setShowPaywall(false)} />;

  return (
    <View style={main.container}>
      <StatusBar style="light" />
      <View style={[main.header, { paddingTop: insets.top + Spacing.sm }]}>
        {!isHomeTab ? (
          <Pressable onPress={() => router.back()} style={main.backBtn} hitSlop={8}>
            <MaterialIcons name="arrow-back" size={20} color={BF.green} />
          </Pressable>
        ) : (
          <View style={{ width: 36 }} />
        )}
        <Pressable onPress={() => setActiveTab('home')} style={main.logoArea} hitSlop={4}>
          <View style={main.logoIcon}><MaterialIcons name="pedal-bike" size={14} color={BF.green} /></View>
          <View>
            <Text style={main.logoText}>BIKE<Text style={{ color: BF.green }}> FLIPPER</Text></Text>
            <Text style={main.logoSub}>FIND • ASSESS • UPGRADE • FLIP</Text>
          </View>
          {isPremium ? <View style={main.proBadge}><Text style={main.proBadgeText}>PRO</Text></View> : null}
        </Pressable>
        <Pressable onPress={() => router.push('/(tabs)/inventory' as any)} style={main.myBtn} hitSlop={6}>
          <MaterialIcons name="pedal-bike" size={16} color={BF.green} />
        </Pressable>
      </View>
      <View style={main.tabBar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={main.tabBarContent}>
          {TABS.map(tab => {
            const active = activeTab === tab.id;
            const locked = ['profits', 'insights'].includes(tab.id) && !isPremium;
            return (
              <Pressable key={tab.id} onPress={() => handleTabSelect(tab.id)} style={[main.tabItem, active && main.tabItemActive]}>
                <MaterialIcons name={(locked ? 'lock' : tab.icon) as any} size={14} color={active ? BF.green : locked ? BF.textMuted : BF.textSub} />
                <Text style={[main.tabLabel, active && main.tabLabelActive, locked && { color: BF.textMuted }]}>{tab.label}</Text>
                {locked ? <View style={main.tabProPip} /> : null}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
      <View style={{ flex: 1 }}>
        {activeTab === 'home' ? <HomeTab isPremium={isPremium} onTabSelect={handleTabSelect} onUpgrade={() => setShowPaywall(true)} tenant={tenant} /> : null}
        {activeTab === 'find' ? (
          <FindTab
            capturedImages={capturedImages}
            onCapture={handleCapture}
            onRemoveImage={handleRemoveImage}
            onIdentify={handleIdentify}
            identifying={identifying}
            processingStatus={processingStatus}
            aiError={aiError}
            idResult={idResult}
            isSaving={isSaving}
            savedItemId={savedItemId}
            isUploading={isUploading}
            uploadProgress={uploadProgress}
            onSave={handleSaveBike}
            onReset={handleResetFind}
            isPremium={isPremium}
            tenant={tenant}
          />
        ) : null}
        {activeTab === 'assess' ? <AssessTab /> : null}
        {activeTab === 'upgrade' ? <UpgradeTab /> : null}
        {activeTab === 'profits' ? <ProfitsTab /> : null}
        {activeTab === 'insights' ? <InsightsTab /> : null}
      </View>
      {!isPremium && activeTab !== 'home' ? (
        <View style={[main.upgradeBar, { paddingBottom: insets.bottom + 4 }]}>
          <MaterialIcons name="workspace-premium" size={13} color={BF.black} />
          <Text style={main.upgradeBarText}>Upgrade to Bike Flipper Pro</Text>
          <Pressable onPress={() => setShowPaywall(true)} style={main.upgradeBarBtn}>
            <Text style={main.upgradeBarBtnText}>£9.99/mo</Text>
          </Pressable>
        </View>
      ) : <View style={{ height: insets.bottom }} />}
    </View>
  );
}

const main = StyleSheet.create({
  container: { flex: 1, backgroundColor: BF.black },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.base, paddingBottom: Spacing.sm, borderBottomWidth: 1, borderBottomColor: BF.border },
  backBtn: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: BF.greenDim, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: BF.green + '30' },
  logoArea: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginLeft: 2 },
  logoIcon: { width: 28, height: 28, borderRadius: 14, backgroundColor: BF.greenDim, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: BF.green + '50' },
  logoText: { fontSize: 14, fontWeight: Typography.weight.extrabold, color: BF.white, letterSpacing: 0.5 },
  logoSub: { fontSize: 7, color: BF.textMuted, letterSpacing: 0.8 },
  proBadge: { backgroundColor: BF.green, borderRadius: Radius.pill, paddingHorizontal: 6, paddingVertical: 2 },
  proBadgeText: { fontSize: 7, fontWeight: Typography.weight.extrabold, color: BF.black, letterSpacing: 1 },
  myBtn: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: BF.greenDim, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: BF.green + '30' },
  tabBar: { backgroundColor: BF.surface, borderBottomWidth: 1, borderBottomColor: BF.border },
  tabBarContent: { paddingHorizontal: Spacing.sm, gap: 2, paddingVertical: 6 },
  tabItem: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: Spacing.md, paddingVertical: 7, borderRadius: Radius.md, position: 'relative' },
  tabItemActive: { backgroundColor: BF.greenDim },
  tabLabel: { fontSize: 10, fontWeight: Typography.weight.semibold, color: BF.textMuted },
  tabLabelActive: { color: BF.green },
  tabProPip: { width: 4, height: 4, borderRadius: 2, backgroundColor: BF.greenMid, position: 'absolute', top: 4, right: 4 },
  upgradeBar: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: BF.green, paddingHorizontal: Spacing.base, paddingTop: Spacing.sm },
  upgradeBarText: { flex: 1, fontSize: Typography.size.xs, fontWeight: Typography.weight.bold, color: BF.black },
  upgradeBarBtn: { backgroundColor: BF.black + '30', borderRadius: Radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
  upgradeBarBtnText: { fontSize: Typography.size.xs, fontWeight: Typography.weight.extrabold, color: BF.black },
});
