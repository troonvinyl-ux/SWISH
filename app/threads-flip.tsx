
// Threads Flip — Dedicated Fashion / Clothing Niche Entry Point
//
// Design: Hot Pink / Black / Cream — "Turn fashion into opportunity."
// Tagline: IDENTIFY • VALUE • STYLE • SELL
// Categories: VINTAGE • DESIGNER • STREETWEAR • HIGH STREET • SUSTAINABLE • REAL PROFITS
// Tabs: Identify, Value, Style, Sell, Insights

import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, Pressable, ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import { getSupabaseClient, useAlert } from '@/template';
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
import { getMarketValue, type MarketValueResult } from '@/services/marketValueService';

// ── Threads Flip design tokens ────────────────────────────────────────────────
const TF = {
  black:       '#0C080C',
  surface:     '#160E16',
  surfaceHigh: '#201420',
  border:      '#301830',
  pink:        '#E91E8C',
  pinkBright:  '#FF3DAA',
  pinkDim:     '#250014',
  pinkMid:     '#C01870',
  cream:       '#FFF0F5',
  white:       '#F5EEF5',
  textPrimary: '#F5EEF5',
  textSub:     '#9A7090',
  textMuted:   '#5A3050',
  success:     '#4CAF50',
  danger:      '#E53935',
  warning:     '#FFC107',
  gold:        '#F5C842',
};

type TFTab = 'home' | 'identify' | 'value' | 'style' | 'sell' | 'insights';

const TABS: Array<{ id: TFTab; label: string; icon: string }> = [
  { id: 'identify', label: 'Identify',  icon: 'search'           },
  { id: 'value',    label: 'Value',     icon: 'bar-chart'        },
  { id: 'style',    label: 'Style',     icon: 'style'            },
  { id: 'sell',     label: 'Sell',      icon: 'sell'             },
  { id: 'insights', label: 'Insights',  icon: 'lightbulb'        },
];

const CLOTHING_CATEGORIES = [
  { id: 'vintage', label: 'Vintage', sub: 'Pre-1995 · Deadstock' },
  { id: 'designer', label: 'Designer', sub: 'Luxury · Authentication' },
  { id: 'streetwear', label: 'Streetwear', sub: 'Supreme · Nike · Brands' },
  { id: 'high_street', label: 'High Street', sub: 'M&S · Zara · Next' },
  { id: 'sustainable', label: 'Sustainable', sub: 'Pre-loved · Circular' },
  { id: 'trainers', label: 'Trainers', sub: 'Sneakers · Deadstock · Auth' },
  { id: 'accessories', label: 'Accessories', sub: 'Bags · Belts · Hats' },
  { id: 'sportswear', label: 'Sportswear', sub: 'Activewear · Athleisure' },
];

const TOP_BRANDS = ["Levi's", 'Nike', 'Carhartt', 'Ralph Lauren', 'Stone Island', 'The North Face', 'Adidas', 'Burberry', 'Prada', 'Supreme'];

// Editorial category photography. These Pexels images are free-to-use under the
// Pexels licence; attribution and source links are recorded in docs/threads-flip-screen-map.md.
const CLOTHING_CATEGORY_IMAGES: Record<string, string> = {
  vintage: 'https://images.pexels.com/photos/32734335/pexels-photo-32734335.jpeg?auto=compress&cs=tinysrgb&w=600',
  designer: 'https://images.pexels.com/photos/3927390/pexels-photo-3927390.jpeg?auto=compress&cs=tinysrgb&w=600',
  streetwear: 'https://images.pexels.com/photos/29790060/pexels-photo-29790060.jpeg?auto=compress&cs=tinysrgb&w=600',
  high_street: 'https://images.pexels.com/photos/3927390/pexels-photo-3927390.jpeg?auto=compress&cs=tinysrgb&w=600',
  sustainable: 'https://images.pexels.com/photos/32734335/pexels-photo-32734335.jpeg?auto=compress&cs=tinysrgb&w=600',
  trainers: 'https://images.pexels.com/photos/31078822/pexels-photo-31078822.jpeg?auto=compress&cs=tinysrgb&w=600',
  accessories: 'https://images.pexels.com/photos/31078822/pexels-photo-31078822.jpeg?auto=compress&cs=tinysrgb&w=600',
  sportswear: 'https://images.pexels.com/photos/29790060/pexels-photo-29790060.jpeg?auto=compress&cs=tinysrgb&w=600',
};

// ── Paywall ───────────────────────────────────────────────────────────────────
function TFPaywall({ onBack }: { onBack: () => void }) {
  const insets = useSafeAreaInsets();
  const { showAlert } = useAlert();
  const [upgrading, setUpgrading] = useState(false);

  const handleUpgrade = useCallback(async () => {
    setUpgrading(true);
    const { error } = await startCheckout('clothing');
    setUpgrading(false);
    if (error) showAlert('Checkout Failed', error);
  }, [showAlert]);

  const FEATURES = [
    { icon: 'photo-camera', label: 'Advanced AI identification engine' },
    { icon: 'bar-chart', label: 'Live market values & price trends' },
    { icon: 'auto-fix-high', label: 'Care & restoration guides' },
    { icon: 'sell', label: 'eBay & marketplace listing templates' },
    { icon: 'public', label: 'Style insights & recommendations' },
    { icon: 'verified', label: 'Authentication risk assessment' },
  ];

  return (
    <View style={[pw.container, { paddingTop: insets.top }]}>
      <StatusBar style="light" />
      <View style={pw.header}>
        <Pressable onPress={onBack} style={pw.backBtn} hitSlop={8}>
          <MaterialIcons name="arrow-back" size={20} color={TF.pink} />
        </Pressable>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={pw.title}>THREADS FLIP</Text>
          <Text style={pw.sub}>PRO</Text>
        </View>
        <View style={{ width: 36 }} />
      </View>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[pw.content, { paddingBottom: insets.bottom + 40 }]}>
        <View style={pw.hero}>
          <View style={pw.heroIcon}><MaterialIcons name="checkroom" size={48} color={TF.pink} /></View>
          <Text style={pw.heroTitle}>Turn fashion</Text>
          <Text style={pw.heroTitle}>into opportunity.</Text>
          <Text style={pw.heroTagline}>VINTAGE • DESIGNER • STREETWEAR • REAL PROFITS</Text>
        </View>
        <Pressable onPress={handleUpgrade} disabled={upgrading} style={({ pressed }) => [pw.upgradeBtn, pressed && { opacity: 0.88 }]}>
          <MaterialIcons name="workspace-premium" size={18} color={TF.black} />
          <View>
            <Text style={pw.upgradeBtnText}>{upgrading ? 'Opening checkout...' : 'Upgrade to Threads Flip Pro'}</Text>
            <Text style={pw.upgradeBtnSub}>£9.99 / month - Cancel any time</Text>
          </View>
          {upgrading ? <ActivityIndicator size="small" color={TF.black} style={{ marginLeft: 'auto' }} /> : <MaterialIcons name="arrow-forward" size={16} color={TF.black} style={{ marginLeft: 'auto' }} />}
        </Pressable>
        <View style={pw.featureCard}>
          <Text style={pw.featureTitle}>WHAT IS INCLUDED</Text>
          {FEATURES.map((f, i) => (
            <View key={f.label}>
              {i > 0 ? <View style={{ height: 1, backgroundColor: TF.border }} /> : null}
              <View style={pw.featureRow}>
                <View style={pw.featureIcon}><MaterialIcons name={f.icon as any} size={15} color={TF.pink} /></View>
                <Text style={pw.featureLabel}>{f.label}</Text>
                <MaterialIcons name="check-circle" size={14} color={TF.success} />
              </View>
            </View>
          ))}
        </View>
        <View style={pw.catsCard}>
          <Text style={pw.catsTitle}>CATEGORIES</Text>
          <View style={pw.catChips}>
            {CLOTHING_CATEGORIES.map(c => (
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
  container: { flex: 1, backgroundColor: TF.black },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.base, paddingVertical: Spacing.md, borderBottomWidth: 1, borderBottomColor: TF.border },
  backBtn: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: TF.pinkDim, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: TF.pink + '30' },
  title: { fontSize: Typography.size.lg, fontWeight: Typography.weight.extrabold, color: TF.pink, letterSpacing: 2 },
  sub: { fontSize: 9, color: TF.pink + 'AA', letterSpacing: 3 },
  content: { padding: Spacing.base, gap: Spacing.xl },
  hero: { alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.xl },
  heroIcon: { width: 90, height: 90, borderRadius: 45, backgroundColor: TF.pinkDim, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: TF.pink + '40', marginBottom: Spacing.md },
  heroTitle: { fontSize: Typography.size.xxl, fontWeight: Typography.weight.extrabold, color: TF.white, textAlign: 'center' },
  heroTagline: { fontSize: 9, color: TF.textSub, letterSpacing: 1, marginTop: 4, textAlign: 'center' },
  upgradeBtn: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: TF.pink, borderRadius: Radius.xxl, paddingVertical: Spacing.base, paddingHorizontal: Spacing.xl, shadowColor: TF.pink, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.45, shadowRadius: 16, elevation: 8 },
  upgradeBtnText: { fontSize: Typography.size.base, fontWeight: Typography.weight.extrabold, color: TF.black },
  upgradeBtnSub: { fontSize: Typography.size.xs, color: TF.black + 'AA' },
  featureCard: { backgroundColor: TF.surface, borderRadius: Radius.xxl, borderWidth: 1, borderColor: TF.border, overflow: 'hidden' },
  featureTitle: { fontSize: 9, fontWeight: Typography.weight.extrabold, color: TF.textMuted, textTransform: 'uppercase', letterSpacing: 0.8, padding: Spacing.md, backgroundColor: TF.surfaceHigh },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.md, paddingVertical: 12 },
  featureIcon: { width: 28, height: 28, borderRadius: Radius.sm, backgroundColor: TF.pinkDim, alignItems: 'center', justifyContent: 'center' },
  featureLabel: { flex: 1, fontSize: Typography.size.sm, color: TF.textPrimary },
  catsCard: { gap: Spacing.sm },
  catsTitle: { fontSize: 9, fontWeight: Typography.weight.extrabold, color: TF.textMuted, textTransform: 'uppercase', letterSpacing: 0.8 },
  catChips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  catChip: { paddingHorizontal: 10, paddingVertical: 5, backgroundColor: TF.surface, borderRadius: Radius.pill, borderWidth: 1, borderColor: TF.pink + '40' },
  catChipText: { fontSize: Typography.size.xs, color: TF.pink, fontWeight: Typography.weight.semibold },
  cancelBtn: { alignItems: 'center', paddingVertical: Spacing.sm },
  cancelText: { fontSize: Typography.size.sm, color: TF.textMuted },
});

// ── Home Tab ──────────────────────────────────────────────────────────────────
function HomeTab({ isPremium, onTabSelect, onUpgrade, tenant }: { isPremium: boolean; onTabSelect: (t: TFTab) => void; onUpgrade: () => void; tenant: any }) {
  const router = useRouter();
  const [itemCount, setItemCount] = useState<number | null>(null);
  const [heroImage, setHeroImage] = useState<string | null>(null);

  useEffect(() => {
    if (!tenant?.id) return;
    const supabase = getSupabaseClient();
    supabase.from('items').select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenant.id).in('specialist_id', ['clothing', 'trainers_sneakers'])
      .then(({ count }) => setItemCount(count ?? 0));
    supabase.from('items').select('media')
      .eq('tenant_id', tenant.id).in('specialist_id', ['clothing', 'trainers_sneakers'])
      .order('updated_at', { ascending: false }).limit(12)
      .then(({ data }) => {
        const firstPhoto = (data ?? []).map(item => Array.isArray(item.media) ? item.media[0] : null)
          .find((uri): uri is string => typeof uri === 'string' && uri.startsWith('https://'));
        setHeroImage(firstPhoto ?? null);
      });
  }, [tenant?.id]);

  const FEATURES = [
    { label: 'Scan Item', icon: 'photo-camera', tab: 'identify' as TFTab, pro: false },
    { label: 'My Wardrobe', icon: 'checkroom', route: '/(tabs)/inventory', pro: false },
    { label: 'Brands', icon: 'label', tab: 'identify' as TFTab, pro: false },
    { label: 'List & Sell', icon: 'sell', tab: 'sell' as TFTab, pro: false },
    { label: 'Profits', icon: 'bar-chart', tab: 'value' as TFTab, pro: true },
    { label: 'Insights', icon: 'lightbulb', tab: 'insights' as TFTab, pro: true },
  ];

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={ht.content}>
      <View style={ht.hero}>
        <View style={ht.heroLeft}>
          {heroImage ? <Image source={{ uri: heroImage }} style={ht.heroImage} contentFit="cover" transition={180} /> : <Image source={{ uri: CLOTHING_CATEGORY_IMAGES.vintage }} style={ht.heroImage} contentFit="cover" transition={180} />}
        </View>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={ht.brandText}>Threads<Text style={{ color: TF.pink }}> Flip</Text></Text>
          <Text style={ht.tagline}>Turn fashion into opportunity.</Text>
          <Text style={ht.subTagline}>IDENTIFY - VALUE - STYLE - SELL</Text>
          <View style={ht.categoryRow}>
            {['Vintage', 'Designer', 'Streetwear'].map(c => (
              <View key={c} style={ht.catChip}><Text style={ht.catChipText}>{c}</Text></View>
            ))}
          </View>
        </View>
        {isPremium ? <View style={ht.proBadge}><Text style={ht.proBadgeText}>PRO</Text></View> : null}
      </View>

      <View style={ht.statsRow}>
        {[
          { label: 'Items in Stock', value: itemCount !== null ? String(itemCount) : '-', color: TF.white },
          { label: 'Categories', value: String(CLOTHING_CATEGORIES.length), color: TF.pink },
          { label: 'AI Powered', value: 'Yes', color: TF.success },
        ].map((s, i) => (
          <View key={s.label} style={[ht.stat, i > 0 && { borderLeftWidth: 1, borderLeftColor: TF.border }]}>
            <Text style={[ht.statNum, { color: s.color }]}>{s.value}</Text>
            <Text style={ht.statLabel}>{s.label}</Text>
          </View>
        ))}
      </View>

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
              <View style={[ht.gridIcon, locked && { backgroundColor: TF.border }]}>
                <MaterialIcons name={locked ? 'lock' : f.icon as any} size={22} color={locked ? TF.textMuted : TF.pink} />
              </View>
              <Text style={[ht.gridLabel, locked && { color: TF.textMuted }]} numberOfLines={1}>{f.label}</Text>
              {locked ? <View style={ht.proTag}><Text style={ht.proTagText}>PRO</Text></View> : null}
            </Pressable>
          );
        })}
      </View>

      <Text style={ht.sectionLabel}>CATEGORIES</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: Spacing.sm, paddingVertical: 4 }}>
        {CLOTHING_CATEGORIES.map(cat => (
          <Pressable key={cat.id} onPress={() => onTabSelect('identify')} style={({ pressed }) => [ht.catCard, pressed && { opacity: 0.82 }]}>
            <Image source={{ uri: CLOTHING_CATEGORY_IMAGES[cat.id] ?? CLOTHING_CATEGORY_IMAGES.vintage }} style={ht.catImage} contentFit="cover" transition={180} />
            <Text style={ht.catLabel}>{cat.label}</Text>
            <Text style={ht.catSub}>{cat.sub}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {!isPremium ? (
        <Pressable onPress={onUpgrade} style={({ pressed }) => [ht.upgradeBanner, pressed && { opacity: 0.88 }]}>
          <MaterialIcons name="workspace-premium" size={18} color={TF.black} />
          <View style={{ flex: 1 }}>
            <Text style={ht.upgradeText}>Upgrade to Threads Flip Pro</Text>
            <Text style={ht.upgradeSub}>Live market values - Care guides - Listing templates</Text>
          </View>
          <Text style={ht.upgradePrice}>£9.99/mo</Text>
        </Pressable>
      ) : (
        <View style={ht.proConfirmed}>
          <MaterialIcons name="workspace-premium" size={15} color={TF.pink} />
          <Text style={ht.proConfirmedText}>Threads Flip Pro - all features unlocked</Text>
        </View>
      )}
    </ScrollView>
  );
}
const ht = StyleSheet.create({
  content: { padding: Spacing.base, gap: Spacing.lg, paddingBottom: 40 },
  sectionLabel: { fontSize: 9, fontWeight: Typography.weight.extrabold, color: TF.textMuted, textTransform: 'uppercase', letterSpacing: 0.8 },
  hero: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md, backgroundColor: TF.surface, borderRadius: Radius.xxl, padding: Spacing.base, borderWidth: 1, borderColor: TF.pink + '40' },
  heroLeft: { alignItems: 'center' },
  heroImage: { width: 76, height: 92, borderRadius: Radius.lg, borderWidth: 1, borderColor: TF.pink + '50' },
  heroIcon: { width: 56, height: 56, borderRadius: Radius.lg, backgroundColor: TF.pinkDim, alignItems: 'center', justifyContent: 'center' },
  brandText: { fontSize: 20, fontWeight: Typography.weight.extrabold, color: TF.white },
  tagline: { fontSize: Typography.size.xs, color: TF.textSub, lineHeight: 17 },
  subTagline: { fontSize: 8, color: TF.pink + '70', letterSpacing: 0.5 },
  categoryRow: { flexDirection: 'row', gap: 4, flexWrap: 'wrap', marginTop: 2 },
  catChip: { backgroundColor: TF.pinkDim, borderRadius: Radius.pill, paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1, borderColor: TF.pink + '30' },
  catChipText: { fontSize: 8, color: TF.pink, fontWeight: Typography.weight.semibold },
  proBadge: { backgroundColor: TF.pink, borderRadius: Radius.pill, paddingHorizontal: 8, paddingVertical: 3 },
  proBadgeText: { fontSize: 8, fontWeight: Typography.weight.extrabold, color: TF.black, letterSpacing: 1 },
  statsRow: { flexDirection: 'row', backgroundColor: TF.surface, borderRadius: Radius.xl, borderWidth: 1, borderColor: TF.border, padding: Spacing.md },
  stat: { flex: 1, alignItems: 'center', gap: 2 },
  statNum: { fontSize: Typography.size.xl, fontWeight: Typography.weight.extrabold },
  statLabel: { fontSize: 9, color: TF.textMuted, textTransform: 'uppercase', letterSpacing: 0.3 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  gridItem: { width: '31%', backgroundColor: TF.surface, borderRadius: Radius.xl, padding: Spacing.md, alignItems: 'center', gap: 6, borderWidth: 1, borderColor: TF.border, aspectRatio: 1, justifyContent: 'center' },
  gridIcon: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: TF.pinkDim, alignItems: 'center', justifyContent: 'center' },
  gridLabel: { fontSize: 9, fontWeight: Typography.weight.bold, color: TF.textPrimary, textAlign: 'center' },
  proTag: { backgroundColor: TF.pinkDim, borderRadius: Radius.pill, paddingHorizontal: 5, paddingVertical: 2 },
  proTagText: { fontSize: 7, fontWeight: Typography.weight.extrabold, color: TF.pink, letterSpacing: 0.5 },
  catCard: { backgroundColor: TF.surface, borderRadius: Radius.xl, padding: 7, gap: 5, alignItems: 'center', width: 116, borderWidth: 1, borderColor: TF.border, overflow: 'hidden' },
  catImage: { width: '100%', height: 82, borderRadius: Radius.md, backgroundColor: TF.surfaceHigh },
  catLabel: { fontSize: Typography.size.xs, fontWeight: Typography.weight.bold, color: TF.textPrimary, textAlign: 'center' },
  catSub: { fontSize: 8, color: TF.textMuted, textAlign: 'center', lineHeight: 12 },
  upgradeBanner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: TF.pink, borderRadius: Radius.xxl, paddingVertical: Spacing.base, paddingHorizontal: Spacing.lg, shadowColor: TF.pink, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.4, shadowRadius: 14, elevation: 6 },
  upgradeText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.extrabold, color: TF.black },
  upgradeSub: { fontSize: 10, color: TF.black + 'AA' },
  upgradePrice: { fontSize: Typography.size.base, fontWeight: Typography.weight.extrabold, color: TF.black },
  proConfirmed: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: TF.pinkDim, borderRadius: Radius.xl, padding: Spacing.md, borderWidth: 1, borderColor: TF.pink + '40' },
  proConfirmedText: { fontSize: Typography.size.sm, color: TF.pink, fontWeight: Typography.weight.semibold },
});

// ── Identify Tab — Full AI Identification Flow ────────────────────────────────
function IdentifyTab({
  capturedImages, reviewingPhotos, onReviewPhotos, onBackToCapture, onCapture, onRemoveImage, onIdentify, identifying,
  processingStatus, aiError, idResult, isSaving, savedItemId, isUploading,
  uploadProgress, onSave, onReset, isPremium, tenant,
}: {
  capturedImages: CapturedImage[];
  onCapture: (index: number) => void;
  onRemoveImage: (index: number) => void;
  onIdentify: () => void;
  onReviewPhotos: () => void;
  onBackToCapture: () => void;
  reviewingPhotos: boolean;
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

  const getClothingFields = (result: AIIdentificationResult) => ({
    brand: String(result.attributes?.brand ?? result.attributes?.brand_label ?? '').replace(/Not legible|Not established/gi, '').trim() || null,
    garmentType: String(result.attributes?.garment_type ?? '').replace(/Not established/gi, '').trim() || null,
    era: String(result.attributes?.era ?? result.attributes?.era_estimate ?? '').replace(/Not established/gi, '').trim() || null,
    size: String(result.attributes?.size ?? result.attributes?.labelled_size ?? '').replace(/Not legible|Not established/gi, '').trim() || null,
    composition: String(result.attributes?.composition ?? result.attributes?.fiber_composition ?? '').replace(/Not legible|Not established/gi, '').trim() || null,
    colour: String(result.attributes?.colour ?? result.attributes?.color_description ?? '').replace(/Not established/gi, '').trim() || null,
    countryManufacture: String(result.attributes?.country_manufacture ?? result.attributes?.country_of_origin ?? '').replace(/Not legible|Not established/gi, '').trim() || null,
    isVintage: result.attributes?.is_vintage === 'true' || result.attributes?.is_vintage === true,
    isDeadstock: result.attributes?.is_deadstock === 'true' || result.attributes?.is_deadstock === true,
    authRisk: String(result.attributes?.authenticity_risk_level ?? result.attributes?.authentication_risk_level ?? 'NOT_APPLICABLE'),
    authRiskReason: String(result.attributes?.authenticity_risk_reason ?? '').replace(/Not established/gi, '').trim() || null,
    marketplace: String(result.attributes?.recommended_marketplace ?? '').replace(/Not established/gi, '').trim() || null,
    damage: String(result.attributes?.damage_notes ?? '').replace(/Not established/gi, '').trim() || null,
  });

  const getAuthRiskColor = (risk: string) => {
    if (risk === 'LOW') return TF.success;
    if (risk === 'MEDIUM') return TF.warning;
    if (risk === 'HIGH') return TF.danger;
    return TF.textMuted;
  };

  if (!idResult) {
    const SLOTS = [
      { label: 'Front View', hint: 'Full front of the garment', primary: true },
      { label: 'Back View', hint: 'Show the full back and shape', primary: false },
      { label: 'Label / Tag', hint: 'Brand, size and care labels', primary: false },
      { label: 'Detail / Flaw', hint: 'Logo, fabric, damage or hardware', primary: false },
    ];
    const validImages = capturedImages.filter((image): image is CapturedImage => Boolean(image));
    const canIdentify = validImages.length > 0;
    if (identifying) return (
      <View testID="threads-flip-screen-05" accessibilityLabel="Threads Flip screen 05 AI identification" style={{ flex: 1, padding: Spacing.base, justifyContent: 'center', gap: Spacing.lg }}>
        <View style={id.processingHero}><View style={id.processingRing}><MaterialIcons name="checkroom" size={42} color={TF.pink} /></View><Text style={id.resultTitle}>Identifying Item…</Text><Text style={id.heroSub}>{processingStatus || 'Analysing your garment photos'}</Text></View>
        {['Analysing photos…', 'Identifying brand…', 'Reading label…', 'Determining category…', 'Finding item specifics…'].map((step, index) => <View key={step} style={id.aiRow}><MaterialIcons name={index === 0 ? 'radio-button-checked' : 'radio-button-unchecked'} size={16} color={index === 0 ? TF.pink : TF.textMuted} /><Text style={id.aiText}>{step}</Text></View>)}
      </View>
    );
    if (reviewingPhotos) return (
      <ScrollView testID="threads-flip-screen-04" accessibilityLabel="Threads Flip screen 04 photo checklist" showsVerticalScrollIndicator={false} contentContainerStyle={id.content}>
        <View style={id.hero}><MaterialIcons name="photo-library" size={26} color={TF.pink} /><View style={{ flex: 1 }}><Text style={id.heroTitle}>Item Photos</Text><Text style={id.heroSub}>Check each view before asking the AI to identify your item.</Text></View></View>
        {SLOTS.map((slot, idx) => { const img = capturedImages[idx] ?? null; return <Pressable key={slot.label} onPress={() => onCapture(idx)} style={id.checklistRow}>{img ? <Image source={{ uri: img.uri }} style={id.checklistThumb} contentFit="cover" /> : <View style={[id.checklistThumb, id.checklistPlaceholder]}><MaterialIcons name="add-a-photo" size={20} color={TF.textMuted} /></View>}<View style={{ flex: 1, gap: 3 }}><Text style={id.checklistTitle}>{slot.label}</Text><Text style={id.checklistHint}>{img ? 'Photo captured · tap to retake' : slot.hint}</Text></View><MaterialIcons name={img ? 'check-circle' : 'add-circle-outline'} size={20} color={img ? TF.success : TF.pink} /></Pressable>; })}
        <Text style={id.tipText}>A clear label photo helps identify the brand, size and material. Add all four views where possible.</Text>
        <View style={id.actions}><Pressable onPress={onBackToCapture} style={id.resetBtn}><Text style={id.resetText}>Back to Capture</Text></Pressable><Pressable onPress={onIdentify} disabled={!canIdentify} style={[id.primaryBtn, !canIdentify && { opacity: 0.45 }]}><MaterialIcons name="auto-awesome" size={16} color={TF.black} /><Text style={id.primaryBtnText}>Continue</Text></Pressable></View>
      </ScrollView>
    );
    return (
      <View testID="threads-flip-screen-03" accessibilityLabel="Threads Flip screen 03 scan and capture" style={{ flex: 1 }}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={id.content}>
          <View style={id.hero}>
            <MaterialIcons name="photo-camera" size={28} color={TF.pink} />
            <View style={{ flex: 1 }}>
              <Text style={id.heroTitle}>Identify Item</Text>
              <Text style={id.heroSub}>Photograph the label and garment - AI reads brand, era, size, composition, condition, and authentication risk</Text>
            </View>
          </View>

          <View style={id.photoGuidePanel}>
            <Text style={id.photoGuideTitle}>GET THE BEST IDENTIFICATION</Text>
            <View style={id.photoGuideGrid}>
              {[
                { icon: 'checkroom', title: 'Full garment', copy: 'Lay flat or hang straight. Show the complete shape.' },
                { icon: 'sell', title: 'Brand & size', copy: 'Flatten the neck or waist label. Keep every word sharp.' },
                { icon: 'local-laundry-service', title: 'Care label', copy: 'Show fabric composition and washing symbols.' },
                { icon: 'zoom-in', title: 'Details & flaws', copy: 'Close-ups of stitching, logos, wear and damage.' },
              ].map((guide) => (
                <View key={guide.title} style={id.photoGuideCard}>
                  <View style={id.photoGuideIcon}><MaterialIcons name={guide.icon as any} size={17} color={TF.pink} /></View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={id.photoGuideLabel}>{guide.title}</Text>
                    <Text style={id.photoGuideCopy}>{guide.copy}</Text>
                  </View>
                </View>
              ))}
            </View>
            <Text style={id.photoGuideFoot}>Use bright, even daylight. Avoid filters and keep the real garment colour.</Text>
          </View>

          {aiError ? (
            <View style={id.errorBanner}>
              <MaterialIcons
                name={aiError.includes('quota') ? 'workspace-premium' : 'error-outline'}
                size={15}
                color={aiError.includes('quota') ? TF.pink : TF.danger}
              />
              <Text style={[id.errorText, aiError.includes('quota') ? { color: TF.pink } : null]} numberOfLines={5}>
                {aiError}
              </Text>
              {aiError.includes('quota') && !isPremium ? (
                <Pressable onPress={() => router.push('/subscription' as any)} style={id.quotaBtn}>
                  <Text style={id.quotaBtnText}>Upgrade</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}

          <Text style={id.sectionLabel}>CAPTURE FOUR VIEWS</Text>
          <View style={id.photoGrid}>
            {SLOTS.map((slot, idx) => {
              const img = capturedImages[idx] ?? null;
              return (
                <View key={idx} style={idx === 0 ? id.slotLarge : id.slotSmall}>
                  <Pressable
                    onPress={() => onCapture(idx)}
                    style={({ pressed }) => [
                      id.slotInner,
                      img ? id.slotCaptured : id.slotEmpty,
                      idx === 0 && !img ? id.slotPrimary : null,
                      pressed && { opacity: 0.82 },
                    ]}
                  >
                    {img ? (
                      <>
                        <Image source={{ uri: img.uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
                        <View style={id.capturedBar}>
                          <MaterialIcons name="check-circle" size={10} color={TF.success} />
                          <Text style={id.capturedLabel} numberOfLines={1}>{slot.label}</Text>
                          <Pressable onPress={e => { e.stopPropagation(); onRemoveImage(idx); }} style={id.removeBtn} hitSlop={8}>
                            <MaterialIcons name="close" size={11} color="#fff" />
                          </Pressable>
                        </View>
                      </>
                    ) : (
                      <View style={id.emptySlot}>
                        <View style={[id.emptyIcon, idx === 0 ? id.emptyIconPrimary : null]}>
                          <MaterialIcons
                            name={idx === 0 ? 'add-a-photo' : 'add-photo-alternate'}
                            size={idx === 0 ? 28 : 20}
                            color={idx === 0 ? TF.pink : TF.textMuted}
                          />
                        </View>
                        <Text style={[id.emptyLabel, idx === 0 ? { color: TF.textPrimary } : null]} numberOfLines={1}>{slot.label}</Text>
                        <Text style={[id.optionalText, idx === 0 ? { color: TF.pink + 'BB' } : null]}>
                          {slot.primary ? 'Required' : 'Optional'}
                        </Text>
                        <Text style={id.hintText} numberOfLines={1}>{slot.hint}</Text>
                      </View>
                    )}
                  </Pressable>
                </View>
              );
            })}
          </View>

          <View style={id.tip}>
            <MaterialIcons name="lightbulb-outline" size={13} color={TF.pink} />
            <Text style={id.tipText}>
              Brand label photo is most important - flat, well-lit, legible. Add care label for era dating and composition.
            </Text>
          </View>

          <Text style={id.sectionLabel}>WHAT THE AI IDENTIFIES</Text>
          <View style={id.aiCard}>
            {[
              'Brand label (exact text character by character)',
              'Era dating from label font, care symbols, construction',
              'Fibre composition from care label',
              'Garment type and gender category',
              'Condition: staining, holes, fading, hardware',
              'Authentication risk (LOW / MEDIUM / HIGH)',
              'Recommended marketplace (eBay, Depop, Vinted)',
            ].map((item, i) => (
              <View key={i} style={id.aiRow}>
                <MaterialIcons name="check-circle" size={12} color={TF.pink} />
                <Text style={id.aiText}>{item}</Text>
              </View>
            ))}
          </View>

          <View style={{ height: 100 }} />
        </ScrollView>

        <View style={id.actionBar}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={id.actionCount}>{validImages.length} of 4 photos added</Text>
            <Text style={id.actionHint}>
              {validImages.length === 0 ? 'Start with a clear front view' : 'Review your photos before AI identification'}
            </Text>
          </View>
          <Pressable
            onPress={onReviewPhotos}
            disabled={!canIdentify || identifying}
            style={({ pressed }) => [
              id.identifyBtn,
              !canIdentify ? id.identifyBtnDisabled : null,
              pressed && canIdentify ? { opacity: 0.88 } : null,
            ]}
          >
            {identifying ? (
              <ActivityIndicator size="small" color={TF.black} />
            ) : (
              <MaterialIcons name="auto-awesome" size={18} color={canIdentify ? TF.black : TF.textMuted} />
            )}
            <Text style={[id.identifyBtnText, !canIdentify ? { color: TF.textMuted } : null]}>
              Review Photos
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const clothingFields = getClothingFields(idResult);
  const authRiskColor = getAuthRiskColor(clothingFields.authRisk);
  const confColor = idResult.confidence >= 0.75 ? TF.success : idResult.confidence >= 0.55 ? TF.warning : TF.danger;

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={id.content}>
      {savedItemId ? (
        <View style={id.savedBanner}>
          <MaterialIcons name="check-circle" size={18} color={TF.success} />
          <View style={{ flex: 1 }}>
            <Text style={id.savedText}>Saved to inventory</Text>
            {uploadProgress ? <Text style={id.savedSub}>{uploadProgress}</Text> : null}
          </View>
        </View>
      ) : null}

      <View testID="threads-flip-screen-06" accessibilityLabel="Threads Flip screen 06 identification result" style={id.resultHero}>
        <View style={id.resultIconWrap}>
          <MaterialIcons name="checkroom" size={32} color={TF.pink} />
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={id.resultTitle} numberOfLines={3}>{idResult.canonicalTitle}</Text>
          <View style={id.confRow}>
            <View style={[id.confDot, { backgroundColor: confColor }]} />
            <Text style={[id.confText, { color: confColor }]}>
              {Math.round(idResult.confidence * 100)}% confidence - {idResult.confidenceTier}
            </Text>
          </View>
        </View>
      </View>

      {capturedImages.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: Spacing.sm }}>
          {capturedImages.map((img, idx) => (
            <Image key={idx} source={{ uri: img.uri }} style={id.thumb} contentFit="cover" />
          ))}
        </ScrollView>
      ) : null}

      {clothingFields.authRisk !== 'NOT_APPLICABLE' ? (
        <View style={[id.authCard, { borderColor: authRiskColor + '50', backgroundColor: authRiskColor + '12' }]}>
          <MaterialIcons name="verified" size={18} color={authRiskColor} />
          <View style={{ flex: 1 }}>
            <Text style={id.authLabel}>Authentication Risk</Text>
            <Text style={[id.authStatus, { color: authRiskColor }]}>{clothingFields.authRisk}</Text>
            {clothingFields.authRiskReason ? (
              <Text style={id.authNote} numberOfLines={3}>{clothingFields.authRiskReason}</Text>
            ) : null}
          </View>
          {clothingFields.authRisk === 'HIGH' ? (
            <MaterialIcons name="warning" size={18} color={TF.danger} />
          ) : clothingFields.authRisk === 'LOW' ? (
            <MaterialIcons name="check-circle" size={18} color={TF.success} />
          ) : (
            <MaterialIcons name="help-outline" size={18} color={TF.warning} />
          )}
        </View>
      ) : null}

      <View style={id.specsCard}>
        <Text style={id.specsTitle}>ITEM DETAILS</Text>
        {[
          { label: 'Brand', value: clothingFields.brand, icon: 'label' as const },
          { label: 'Garment Type', value: clothingFields.garmentType, icon: 'checkroom' as const },
          { label: 'Era', value: clothingFields.era, icon: 'history' as const },
          { label: 'Size', value: clothingFields.size, icon: 'straighten' as const },
          { label: 'Composition', value: clothingFields.composition, icon: 'layers' as const },
          { label: 'Colour', value: clothingFields.colour, icon: 'palette' as const },
          { label: 'Made In', value: clothingFields.countryManufacture, icon: 'public' as const },
        ].filter(r => r.value).map((row, i) => (
          <View key={i} style={id.specRow}>
            <MaterialIcons name={row.icon} size={13} color={TF.textMuted} style={{ width: 18 }} />
            <Text style={id.specKey}>{row.label}</Text>
            <Text style={id.specValue} numberOfLines={1}>{row.value}</Text>
          </View>
        ))}
        <View style={{ flexDirection: 'row', gap: Spacing.xs, marginTop: Spacing.xs, flexWrap: 'wrap' }}>
          {clothingFields.isVintage ? (
            <View style={[id.tagChip, { backgroundColor: TF.gold + '20', borderColor: TF.gold + '50' }]}>
              <Text style={[id.tagText, { color: TF.gold }]}>VINTAGE</Text>
            </View>
          ) : null}
          {clothingFields.isDeadstock ? (
            <View style={[id.tagChip, { backgroundColor: TF.success + '20', borderColor: TF.success + '50' }]}>
              <Text style={[id.tagText, { color: TF.success }]}>DEADSTOCK</Text>
            </View>
          ) : null}
        </View>
      </View>

      <View testID="threads-flip-screen-07" accessibilityLabel="Threads Flip screen 07 condition and authentication" style={id.condCard}>
        <Text style={id.specsTitle}>CONDITION</Text>
        <Text style={id.condOverall}>{idResult.condition}</Text>
        {clothingFields.damage ? (
          <View style={id.condRow}>
            <Text style={id.condLabel}>Damage / Notes</Text>
            <Text style={[id.condVal, { color: TF.warning }]}>{clothingFields.damage}</Text>
          </View>
        ) : null}
        {clothingFields.marketplace ? (
          <View style={id.condRow}>
            <Text style={id.condLabel}>Best Marketplace</Text>
            <Text style={[id.condVal, { color: TF.pink }]}>{clothingFields.marketplace}</Text>
          </View>
        ) : null}
      </View>

      {idResult.warnings && idResult.warnings.length > 0 ? (
        <View style={id.warningsCard}>
          {idResult.warnings.slice(0, 3).map((w, i) => (
            <View key={i} style={id.warningRow}>
              <MaterialIcons name="warning" size={11} color={TF.warning} />
              <Text style={id.warningText} numberOfLines={3}>{w}</Text>
            </View>
          ))}
        </View>
      ) : null}

      <View style={id.actions}>
        <Pressable onPress={onReset} style={id.resetBtn}>
          <MaterialIcons name="refresh" size={16} color={TF.textSub} />
          <Text style={id.resetText}>New Scan</Text>
        </Pressable>
        {savedItemId ? (
          <Pressable onPress={() => router.push(`/create-listing?id=${savedItemId}` as any)} style={id.primaryBtn}>
            {isUploading ? <ActivityIndicator size="small" color={TF.black} /> : <MaterialIcons name="sell" size={16} color={TF.black} />}
            <Text style={id.primaryBtnText}>{isUploading ? 'Uploading...' : 'List on eBay'}</Text>
          </Pressable>
        ) : (
          <Pressable onPress={onSave} disabled={isSaving} style={id.primaryBtn}>
            {isSaving ? <ActivityIndicator size="small" color={TF.black} /> : <MaterialIcons name="add" size={16} color={TF.black} />}
            <Text style={id.primaryBtnText}>{isSaving ? 'Saving...' : 'Save to Inventory'}</Text>
          </Pressable>
        )}
      </View>

      {savedItemId ? (
        <Pressable onPress={() => router.push(`/item/${savedItemId}` as any)} style={({ pressed }) => [id.viewItemBtn, pressed && { opacity: 0.85 }]}>
          <MaterialIcons name="inventory-2" size={15} color={TF.pink} />
          <Text style={id.viewItemText}>View in Inventory</Text>
          <MaterialIcons name="chevron-right" size={15} color={TF.textMuted} />
        </Pressable>
      ) : null}

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const id = StyleSheet.create({
  processingHero: { alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.xl },
  processingRing: { width: 116, height: 116, borderRadius: 58, borderWidth: 3, borderColor: TF.pink, backgroundColor: TF.pinkDim, alignItems: 'center', justifyContent: 'center', shadowColor: TF.pink, shadowOpacity: 0.6, shadowRadius: 20, elevation: 8 },
  checklistRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.sm, backgroundColor: TF.surface, borderWidth: 1, borderColor: TF.border, borderRadius: Radius.lg },
  checklistThumb: { width: 64, height: 64, borderRadius: Radius.md },
  checklistPlaceholder: { backgroundColor: TF.surfaceHigh, alignItems: 'center', justifyContent: 'center' },
  checklistTitle: { fontSize: Typography.size.sm, color: TF.white, fontWeight: Typography.weight.bold },
  checklistHint: { fontSize: Typography.size.xs, color: TF.textSub },
  content: { padding: Spacing.base, gap: Spacing.md, paddingBottom: 40 },
  sectionLabel: { fontSize: 9, fontWeight: Typography.weight.extrabold, color: TF.textMuted, textTransform: 'uppercase', letterSpacing: 0.8 },
  hero: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: TF.surface, borderRadius: Radius.xl, padding: Spacing.base, borderWidth: 1, borderColor: TF.pink + '30' },
  heroTitle: { fontSize: Typography.size.xl, fontWeight: Typography.weight.extrabold, color: TF.white },
  heroSub: { fontSize: Typography.size.xs, color: TF.textSub, lineHeight: 17, marginTop: 3 },
  photoGuidePanel: { backgroundColor: TF.surface, borderWidth: 1, borderColor: TF.border, borderRadius: Radius.xl, padding: Spacing.md, gap: Spacing.sm },
  photoGuideTitle: { fontSize: 9, color: TF.pink, fontWeight: Typography.weight.extrabold, letterSpacing: 1 },
  photoGuideGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  photoGuideCard: { width: '47%', minHeight: 62, flexDirection: 'row', alignItems: 'flex-start', gap: 7, padding: 8, borderRadius: Radius.md, backgroundColor: TF.surfaceHigh },
  photoGuideIcon: { width: 28, height: 28, borderRadius: Radius.sm, backgroundColor: TF.pinkDim, alignItems: 'center', justifyContent: 'center' },
  photoGuideLabel: { fontSize: 10, color: TF.cream, fontWeight: Typography.weight.bold },
  photoGuideCopy: { fontSize: 8, color: TF.textSub, lineHeight: 12 },
  photoGuideFoot: { fontSize: 9, color: TF.textMuted, lineHeight: 13 },
  errorBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, backgroundColor: TF.pinkDim, borderRadius: Radius.md, padding: Spacing.md, borderWidth: 1, borderColor: TF.danger + '40' },
  errorText: { flex: 1, fontSize: Typography.size.xs, color: TF.danger, lineHeight: 17 },
  quotaBtn: { backgroundColor: TF.pinkDim, borderRadius: Radius.md, paddingHorizontal: Spacing.sm, paddingVertical: 4, borderWidth: 1, borderColor: TF.pink + '40' },
  quotaBtnText: { fontSize: 10, fontWeight: Typography.weight.bold, color: TF.pink },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  slotLarge: { width: '100%', aspectRatio: 1.5 },
  slotSmall: { width: '48%', aspectRatio: 1 },
  slotInner: { flex: 1, borderRadius: Radius.lg, overflow: 'hidden', position: 'relative' },
  slotEmpty: { backgroundColor: TF.surface, borderWidth: 1.5, borderStyle: 'dashed', borderColor: TF.border, alignItems: 'center', justifyContent: 'center' },
  slotPrimary: { borderColor: TF.pink + '60' },
  slotCaptured: { borderWidth: 2, borderColor: TF.success + '70', borderStyle: 'solid' },
  emptySlot: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: Spacing.sm },
  emptyIcon: { width: 48, height: 48, borderRadius: Radius.md, backgroundColor: TF.surfaceHigh, alignItems: 'center', justifyContent: 'center' },
  emptyIconPrimary: { backgroundColor: TF.pinkDim },
  emptyLabel: { fontSize: 11, fontWeight: Typography.weight.semibold, color: TF.textSub, textAlign: 'center' },
  optionalText: { fontSize: 8, color: TF.textMuted, textTransform: 'uppercase', letterSpacing: 0.2 },
  hintText: { fontSize: 9, color: TF.textMuted, textAlign: 'center', lineHeight: 13 },
  capturedBar: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.62)', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 5, gap: 4 },
  capturedLabel: { flex: 1, fontSize: 9, color: '#fff', fontWeight: Typography.weight.semibold },
  removeBtn: { backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 10, width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
  tip: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, backgroundColor: TF.pinkDim, borderRadius: Radius.md, padding: Spacing.md, borderWidth: 1, borderColor: TF.pink + '25' },
  tipText: { flex: 1, fontSize: 11, color: TF.pink, lineHeight: 16 },
  aiCard: { backgroundColor: TF.surface, borderRadius: Radius.xl, padding: Spacing.base, gap: Spacing.sm, borderWidth: 1, borderColor: TF.border },
  aiRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  aiText: { flex: 1, fontSize: Typography.size.xs, color: TF.textSub, lineHeight: 17 },
  actionBar: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: TF.surface, borderTopWidth: 1, borderTopColor: TF.border, padding: Spacing.base, flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  actionCount: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: TF.textPrimary },
  actionHint: { fontSize: Typography.size.xs, color: TF.textSub },
  identifyBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, backgroundColor: TF.pink, borderRadius: Radius.md, padding: Spacing.md, shadowColor: TF.pink, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.45, shadowRadius: 10, elevation: 6 },
  identifyBtnDisabled: { backgroundColor: TF.surfaceHigh, shadowOpacity: 0 },
  identifyBtnText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: TF.black },
  savedBanner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: '#0A2010', borderRadius: Radius.md, padding: Spacing.md, borderWidth: 1, borderColor: TF.success + '40' },
  savedText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: TF.success },
  savedSub: { fontSize: 10, color: TF.success + 'BB', marginTop: 2 },
  resultHero: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md, backgroundColor: TF.surface, borderRadius: Radius.xl, padding: Spacing.base, borderWidth: 1, borderColor: TF.pink + '40' },
  resultIconWrap: { width: 56, height: 56, borderRadius: Radius.lg, backgroundColor: TF.pinkDim, alignItems: 'center', justifyContent: 'center' },
  resultTitle: { fontSize: Typography.size.base, fontWeight: Typography.weight.bold, color: TF.white, lineHeight: 22 },
  confRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  confDot: { width: 7, height: 7, borderRadius: 4 },
  confText: { fontSize: Typography.size.xs, fontWeight: Typography.weight.semibold },
  thumb: { width: 80, height: 80, borderRadius: Radius.md },
  authCard: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, borderRadius: Radius.xl, padding: Spacing.base, borderWidth: 1 },
  authLabel: { fontSize: 9, fontWeight: Typography.weight.extrabold, color: TF.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  authStatus: { fontSize: Typography.size.base, fontWeight: Typography.weight.extrabold, lineHeight: 22, marginTop: 2 },
  authNote: { fontSize: Typography.size.xs, color: TF.textSub, lineHeight: 16, marginTop: 4 },
  specsCard: { backgroundColor: TF.surface, borderRadius: Radius.xl, padding: Spacing.base, borderWidth: 1, borderColor: TF.border, gap: 2 },
  specsTitle: { fontSize: 9, fontWeight: Typography.weight.extrabold, color: TF.textMuted, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: Spacing.sm },
  specRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: TF.border + '60' },
  specKey: { flex: 1, fontSize: Typography.size.xs, color: TF.textSub },
  specValue: { fontSize: Typography.size.xs, fontWeight: Typography.weight.semibold, color: TF.textPrimary, maxWidth: '55%', textAlign: 'right' },
  tagChip: { borderRadius: Radius.pill, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1 },
  tagText: { fontSize: 9, fontWeight: Typography.weight.extrabold, letterSpacing: 0.5 },
  condCard: { backgroundColor: TF.surface, borderRadius: Radius.xl, padding: Spacing.base, borderWidth: 1, borderColor: TF.border },
  condOverall: { fontSize: Typography.size.sm, color: TF.textPrimary, lineHeight: 18, marginBottom: Spacing.sm },
  condRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5, borderTopWidth: 1, borderTopColor: TF.border + '50' },
  condLabel: { fontSize: Typography.size.xs, color: TF.textSub },
  condVal: { fontSize: Typography.size.xs, fontWeight: Typography.weight.semibold, color: TF.textPrimary, maxWidth: '55%', textAlign: 'right' },
  warningsCard: { backgroundColor: TF.surfaceHigh, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.sm, borderWidth: 1, borderColor: TF.warning + '30' },
  warningRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  warningText: { flex: 1, fontSize: Typography.size.xs, color: TF.warning, lineHeight: 16 },
  actions: { flexDirection: 'row', gap: Spacing.sm },
  resetBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, padding: Spacing.md, borderRadius: Radius.md, backgroundColor: TF.surface, borderWidth: 1, borderColor: TF.border },
  resetText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: TF.textSub },
  primaryBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, backgroundColor: TF.pink, borderRadius: Radius.md, padding: Spacing.md, shadowColor: TF.pink, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.4, shadowRadius: 10, elevation: 5 },
  primaryBtnText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: TF.black },
  viewItemBtn: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: TF.surface, borderRadius: Radius.xl, padding: Spacing.base, borderWidth: 1, borderColor: TF.pink + '30' },
  viewItemText: { flex: 1, fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: TF.pink },
});

// ── Value Tab ─────────────────────────────────────────────────────────────────
function ValueTab({ idResult, tenant, onIdentify }: { idResult: AIIdentificationResult | null; tenant: any; onIdentify: () => void }) {
  const [marketData, setMarketData] = useState<MarketValueResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!idResult || !tenant?.id) {
      setMarketData(null);
      setError(null);
      setLoading(false);
      return;
    }
    let current = true;
    setMarketData(null);
    setLoading(true);
    setError(null);
    getMarketValue({
      tenantId: tenant.id,
      title: idResult.canonicalTitle,
      specialistId: idResult.specialistId,
      attributes: idResult.attributes ?? {},
      condition: idResult.condition,
      identificationConfidence: idResult.confidence,
      identificationTier: idResult.confidenceTier,
      applyToItem: false,
    }).then(({ result, error: requestError }) => {
      if (!current) return;
      setMarketData(result);
      setError(requestError);
    }).catch((requestError: unknown) => {
      if (current) setError(requestError instanceof Error ? requestError.message : 'Market value lookup failed');
    }).finally(() => {
      if (current) setLoading(false);
    });
    return () => { current = false; };
  }, [idResult, tenant?.id]);

  const money = (value: number | undefined) => typeof value === 'number' && value > 0
    ? new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(value)
    : '—';
  const valuation = marketData?.valuation;
  const sold = marketData?.soldMarket;
  const hasValuation = Boolean(valuation && (valuation.valuationLow > 0 || valuation.valuationMid > 0 || valuation.valuationHigh > 0));

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={vt.content}>
      <View style={vt.hero}>
        <MaterialIcons name="bar-chart" size={28} color={TF.pink} />
        <View style={{ flex: 1 }}>
          <Text style={vt.heroTitle}>Market Value</Text>
          <Text style={vt.heroSub}>Verified sold evidence · pricing intelligence</Text>
        </View>
      </View>

      {!idResult ? (
        <View style={vt.emptyCard}>
          <MaterialIcons name="search" size={34} color={TF.pink} />
          <Text style={vt.emptyTitle}>Identify an item first</Text>
          <Text style={vt.infoText}>Threads Flip will use the clothing specialist and current comparable sold-market evidence. Asking prices are kept separate from completed sales.</Text>
          <Pressable onPress={onIdentify} style={vt.actionBtn}><Text style={vt.actionBtnText}>Scan an Item →</Text></Pressable>
        </View>
      ) : (
        <>
          <View style={vt.valueCard}>
            <Text style={vt.valueName}>{idResult.canonicalTitle}</Text>
            {loading ? (
              <View style={vt.loading}><ActivityIndicator size="large" color={TF.pink} /><Text style={vt.infoText}>Checking current sold-market evidence…</Text></View>
            ) : error ? (
              <View style={vt.infoCard}><MaterialIcons name="info-outline" size={14} color={TF.pink} /><Text style={vt.infoText}>{error}</Text></View>
            ) : hasValuation && valuation ? (
              <>
                <View style={vt.priceRange}>
                  <Text style={vt.priceLabel}>Evidence-based resale range</Text>
                  <Text style={vt.priceMain}>{money(valuation.valuationLow)} – {money(valuation.valuationHigh)}</Text>
                  <Text style={vt.heroSub}>Suggested listing price: {money(valuation.recommendedListingPrice)}</Text>
                </View>
                <View style={vt.opportunitySection}>
                  <Text style={vt.oppTitle}>COMPLETED-SALE EVIDENCE</Text>
                  <View style={vt.oppRow}><Text style={vt.oppLabel}>Verified sold listings</Text><Text style={vt.oppValue}>{sold?.verifiedSoldCount ?? 0}</Text></View>
                  <View style={vt.oppRow}><Text style={vt.oppLabel}>Relevant sold matches</Text><Text style={vt.oppValue}>{sold?.relevantSoldCount ?? 0}</Text></View>
                  <View style={vt.oppRow}><Text style={vt.oppLabel}>Median sold price</Text><Text style={vt.oppValue}>{money(sold?.medianPrice)}</Text></View>
                  <View style={vt.oppRow}><Text style={vt.oppLabel}>Data quality</Text><Text style={[vt.oppValue, { color: TF.pink }]}>{sold?.dataQuality ?? 'insufficient'}</Text></View>
                </View>
                {marketData?.stats.recentSales.length ? (
                  <View style={vt.opportunitySection}>
                    <Text style={vt.oppTitle}>RECENT SOLD COMPARABLES</Text>
                    {marketData.stats.recentSales.slice(0, 3).map((sale, index) => (
                      <View key={index} style={vt.oppRow}>
                        <Text style={vt.oppLabel} numberOfLines={2}>{sale.title}</Text>
                        <Text style={vt.oppValue}>{money(sale.price)}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}
                {marketData?.activeAskingPrices.count ? (
                  <View style={vt.infoCard}>
                    <MaterialIcons name="info-outline" size={14} color={TF.pink} />
                    <Text style={vt.infoText}>Active asking prices are shown separately and are not treated as completed sales. {marketData.activeAskingPrices.note}</Text>
                  </View>
                ) : null}
                {valuation.valuationWarnings?.length ? (
                  <View style={vt.infoCard}><MaterialIcons name="warning" size={14} color={TF.warning} /><Text style={vt.infoText}>{valuation.valuationWarnings.join(' ')}</Text></View>
                ) : null}
              </>
            ) : (
              <View style={vt.infoCard}>
                <MaterialIcons name="info-outline" size={14} color={TF.pink} />
                <Text style={vt.infoText}>There is not enough relevant sold evidence to produce a reliable price range yet. Do not substitute active asking prices for sold prices.</Text>
              </View>
            )}
          </View>
          <View style={vt.infoCard}>
            <MaterialIcons name="account-balance-wallet" size={14} color={TF.pink} />
            <Text style={vt.infoText}>Net profit needs your actual acquisition cost, cleaning, postage and fees. Add those in the listing workflow before treating a margin as confirmed.</Text>
          </View>
        </>
      )}
    </ScrollView>
  );
}
const vt = StyleSheet.create({
  content: { padding: Spacing.base, gap: Spacing.lg, paddingBottom: 40 },
  sectionLabel: { fontSize: 9, fontWeight: Typography.weight.extrabold, color: TF.textMuted, textTransform: 'uppercase', letterSpacing: 0.8 },
  hero: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: TF.surface, borderRadius: Radius.xl, padding: Spacing.base, borderWidth: 1, borderColor: TF.pink + '30' },
  heroTitle: { fontSize: Typography.size.xl, fontWeight: Typography.weight.extrabold, color: TF.white },
  heroSub: { fontSize: Typography.size.xs, color: TF.textSub, marginTop: 2 },
  valueCard: { backgroundColor: TF.surface, borderRadius: Radius.xxl, padding: Spacing.base, gap: Spacing.md, borderWidth: 1, borderColor: TF.pink + '30' },
  valueName: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: TF.textSub },
  priceRange: { alignItems: 'center', gap: 4, paddingVertical: Spacing.sm },
  priceLabel: { fontSize: Typography.size.xs, color: TF.textMuted },
  priceMain: { fontSize: 28, fontWeight: Typography.weight.extrabold, color: TF.pink },
  opportunitySection: { gap: 4 },
  oppTitle: { fontSize: 9, fontWeight: Typography.weight.extrabold, color: TF.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  oppRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: TF.border + '60' },
  oppLabel: { fontSize: Typography.size.sm, color: TF.textSub },
  oppValue: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: TF.white },
  infoCard: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, backgroundColor: TF.pinkDim, borderRadius: Radius.md, padding: Spacing.md, borderWidth: 1, borderColor: TF.pink + '25' },
  infoText: { flex: 1, fontSize: Typography.size.xs, color: TF.pink, lineHeight: 17 },
  emptyCard: { alignItems: 'center', gap: Spacing.md, backgroundColor: TF.surface, borderRadius: Radius.xxl, padding: Spacing.xl, borderWidth: 1, borderColor: TF.border },
  emptyTitle: { fontSize: Typography.size.lg, fontWeight: Typography.weight.extrabold, color: TF.white },
  actionBtn: { backgroundColor: TF.pink, borderRadius: Radius.md, paddingHorizontal: Spacing.xl, paddingVertical: Spacing.md },
  actionBtnText: { color: TF.black, fontSize: Typography.size.sm, fontWeight: Typography.weight.extrabold },
  loading: { alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.xl },
});

// ── Style Tab ─────────────────────────────────────────────────────────────────
function StyleTab() {
  const CATEGORIES_INFO = [
    { id: 'vintage', label: 'Vintage Identification', icon: 'history', desc: 'Era dating from labels, care symbols, construction', color: TF.gold },
    { id: 'designer', label: 'Designer Authentication', icon: 'verified', desc: 'Authentication risk assessment from visible markers', color: TF.pink },
    { id: 'streetwear', label: 'Streetwear Trends', icon: 'trending-up', desc: 'What is trending and selling fastest right now', color: Colors.info },
    { id: 'care', label: 'Care & Cleaning', icon: 'local-laundry-service', desc: 'Care guides and restoration before selling', color: TF.success },
  ];
  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={st.content}>
      <View style={st.hero}>
        <MaterialIcons name="style" size={28} color={TF.pink} />
        <View style={{ flex: 1 }}>
          <Text style={st.heroTitle}>Style Guide</Text>
          <Text style={st.heroSub}>Brand recognition - Authentication - Trends - Care</Text>
        </View>
      </View>
      {CATEGORIES_INFO.map(cat => (
        <View key={cat.id} style={[st.catCard, { borderColor: cat.color + '40' }]}>
          <View style={[st.catIcon, { backgroundColor: cat.color + '20' }]}><MaterialIcons name={cat.icon as any} size={22} color={cat.color} /></View>
          <View style={{ flex: 1 }}>
            <Text style={st.catLabel}>{cat.label}</Text>
            <Text style={st.catDesc}>{cat.desc}</Text>
          </View>
        </View>
      ))}
      <Text style={st.sectionLabel}>TOP BRANDS FOR RESALE</Text>
      <View style={st.brandsGrid}>
        {TOP_BRANDS.map(brand => (
          <View key={brand} style={st.brandChip}>
            <Text style={st.brandChipText}>{brand}</Text>
          </View>
        ))}
      </View>
      <View style={st.authCard}>
        <Text style={st.sectionLabel}>AUTHENTICATION RISK LEVELS</Text>
        {[
          { level: 'LOW', desc: 'Strong markers present — likely authentic', color: TF.success },
          { level: 'MEDIUM', desc: 'Some markers present — inconclusive', color: TF.warning },
          { level: 'HIGH', desc: 'Suspicious markers — professional auth recommended', color: TF.danger },
        ].map(risk => (
          <View key={risk.level} style={st.riskRow}>
            <View style={[st.riskBadge, { backgroundColor: risk.color }]}><Text style={st.riskBadgeText}>{risk.level}</Text></View>
            <Text style={st.riskDesc}>{risk.desc}</Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}
const st = StyleSheet.create({
  content: { padding: Spacing.base, gap: Spacing.md, paddingBottom: 40 },
  sectionLabel: { fontSize: 9, fontWeight: Typography.weight.extrabold, color: TF.textMuted, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 },
  hero: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: TF.surface, borderRadius: Radius.xl, padding: Spacing.base, borderWidth: 1, borderColor: TF.pink + '30' },
  heroTitle: { fontSize: Typography.size.xl, fontWeight: Typography.weight.extrabold, color: TF.white },
  heroSub: { fontSize: Typography.size.xs, color: TF.textSub, marginTop: 2 },
  catCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: TF.surface, borderRadius: Radius.xl, padding: Spacing.base, borderWidth: 1 },
  catIcon: { width: 48, height: 48, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  catLabel: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: TF.white },
  catDesc: { fontSize: Typography.size.xs, color: TF.textSub, marginTop: 2, lineHeight: 16 },
  brandsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  brandChip: { paddingHorizontal: 10, paddingVertical: 5, backgroundColor: TF.surface, borderRadius: Radius.pill, borderWidth: 1, borderColor: TF.pink + '40' },
  brandChipText: { fontSize: Typography.size.xs, color: TF.pink, fontWeight: Typography.weight.semibold },
  authCard: { backgroundColor: TF.surface, borderRadius: Radius.xl, padding: Spacing.base, borderWidth: 1, borderColor: TF.border },
  riskRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: 8 },
  riskBadge: { borderRadius: Radius.pill, paddingHorizontal: 10, paddingVertical: 4, minWidth: 56, alignItems: 'center' },
  riskBadgeText: { fontSize: 9, fontWeight: Typography.weight.extrabold, color: '#000' },
  riskDesc: { flex: 1, fontSize: Typography.size.xs, color: TF.textSub, lineHeight: 16 },
});

// ── Sell Tab ──────────────────────────────────────────────────────────────────
function SellTab() {
  const router = useRouter();
  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={sl.content}>
      <View style={sl.hero}>
        <MaterialIcons name="sell" size={28} color={TF.pink} />
        <View style={{ flex: 1 }}>
          <Text style={sl.heroTitle}>Sell</Text>
          <Text style={sl.heroSub}>eBay - Depop - Vinted - Etsy - Global reach</Text>
        </View>
      </View>
      {[
        { icon: 'receipt-long', label: 'My Listings', sub: 'Drafts, live and ended clothing listings', color: '#E53238', route: '/ebay-admin' as any },
        { icon: 'checkroom', label: 'My Wardrobe', sub: 'All clothing items in inventory', color: TF.pink, route: '/(tabs)/inventory' as any },
        { icon: 'local-shipping', label: 'Orders', sub: 'Manage and dispatch orders', color: Colors.info, route: '/orders' as any },
        { icon: 'storefront', label: 'eBay Hub', sub: 'Messages, finances, returns', color: '#E53238', route: '/ebay-hub' as any },
      ].map(item => (
        <Pressable key={item.label} onPress={() => router.push(item.route)} style={({ pressed }) => [sl.card, pressed && { opacity: 0.85 }]}>
          <View style={[sl.cardIcon, { backgroundColor: item.color + '20' }]}><MaterialIcons name={item.icon as any} size={22} color={item.color} /></View>
          <View style={{ flex: 1 }}>
            <Text style={sl.cardLabel}>{item.label}</Text>
            <Text style={sl.cardSub}>{item.sub}</Text>
          </View>
          <MaterialIcons name="chevron-right" size={16} color={TF.textMuted} />
        </Pressable>
      ))}
      <View style={sl.platformsCard}>
        <Text style={sl.sectionLabel}>BEST PLATFORMS BY CATEGORY</Text>
        {[
          { cat: 'Vintage clothing', platform: 'Depop - eBay', tip: 'Story-led listings perform best' },
          { cat: 'Designer items', platform: 'eBay - Vestiaire', tip: 'Authentication proof essential' },
          { cat: 'Streetwear', platform: 'eBay - StockX - Depop', tip: 'Condition is everything' },
          { cat: 'High street', platform: 'Vinted - eBay', tip: 'Competitive pricing wins' },
          { cat: 'Trainers', platform: 'eBay - StockX - GOAT', tip: 'Deadstock commands huge premium' },
        ].map(row => (
          <View key={row.cat} style={sl.platformRow}>
            <View style={{ flex: 1 }}>
              <Text style={sl.platformCat}>{row.cat}</Text>
              <Text style={sl.platformName}>{row.platform}</Text>
            </View>
            <Text style={sl.platformTip} numberOfLines={2}>{row.tip}</Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}
const sl = StyleSheet.create({
  content: { padding: Spacing.base, gap: Spacing.md, paddingBottom: 40 },
  sectionLabel: { fontSize: 9, fontWeight: Typography.weight.extrabold, color: TF.textMuted, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: Spacing.sm },
  hero: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: TF.surface, borderRadius: Radius.xl, padding: Spacing.base, borderWidth: 1, borderColor: TF.pink + '30' },
  heroTitle: { fontSize: Typography.size.xl, fontWeight: Typography.weight.extrabold, color: TF.white },
  heroSub: { fontSize: Typography.size.xs, color: TF.textSub, marginTop: 2 },
  card: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: TF.surface, borderRadius: Radius.xl, padding: Spacing.base, borderWidth: 1, borderColor: TF.border },
  cardIcon: { width: 44, height: 44, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  cardLabel: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: TF.white },
  cardSub: { fontSize: Typography.size.xs, color: TF.textSub, marginTop: 2 },
  platformsCard: { backgroundColor: TF.surface, borderRadius: Radius.xl, padding: Spacing.base, borderWidth: 1, borderColor: TF.border },
  platformRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: TF.border + '60' },
  platformCat: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: TF.white },
  platformName: { fontSize: Typography.size.xs, color: TF.pink, marginTop: 2 },
  platformTip: { flex: 1, fontSize: Typography.size.xs, color: TF.textSub, textAlign: 'right', lineHeight: 16 },
});

// ── Insights Tab ──────────────────────────────────────────────────────────────
function InsightsTab() {
  const router = useRouter();
  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={ins.content}>
      <View style={ins.hero}>
        <MaterialIcons name="lightbulb" size={28} color={TF.pink} />
        <View style={{ flex: 1 }}>
          <Text style={ins.heroTitle}>Insights</Text>
          <Text style={ins.heroSub}>Trends - Opportunities - AI recommendations</Text>
        </View>
      </View>
      {[
        { icon: 'trending-up', label: 'Market Trends', sub: 'What is hot on eBay and Depop right now', route: '/money' as any },
        { icon: 'auto-awesome', label: 'AI Recommendations', sub: 'What to source, list, and discount this week', route: '/command-centre' as any },
        { icon: 'receipt', label: 'Orders & Sales', sub: 'Track performance and buyer feedback', route: '/orders' as any },
        { icon: 'price-change', label: 'Repricing', sub: 'Auto-adjust prices to beat the market', route: '/repricing' as any },
      ].map(item => (
        <Pressable key={item.label} onPress={() => router.push(item.route)} style={({ pressed }) => [ins.card, pressed && { opacity: 0.85 }]}>
          <View style={[ins.cardIcon, { backgroundColor: TF.pink + '20' }]}><MaterialIcons name={item.icon as any} size={20} color={TF.pink} /></View>
          <View style={{ flex: 1 }}>
            <Text style={ins.cardLabel}>{item.label}</Text>
            <Text style={ins.cardSub}>{item.sub}</Text>
          </View>
          <MaterialIcons name="chevron-right" size={16} color={TF.textMuted} />
        </Pressable>
      ))}
      <View style={ins.factsCard}>
        <Text style={ins.sectionLabel}>SELLER CHECKLIST</Text>
        {[
          'Compare completed sales in the same brand, model, size and condition.',
          'Photograph labels, care tags, flaws, measurements and fabric clearly.',
          'Check authenticity markers before describing an item as genuine.',
          'Include pit-to-pit, length, waist and inside-leg measurements where relevant.',
          'Calculate platform fees, postage, cleaning and packaging before pricing.',
          'Use accurate condition notes and disclose every visible defect.',
          'Review comparable sold listings again before accepting an offer.',
        ].map((fact, i) => (
          <View key={i} style={ins.factRow}>
            <MaterialIcons name="lightbulb-outline" size={12} color={TF.pink} />
            <Text style={ins.factText}>{fact}</Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}
const ins = StyleSheet.create({
  content: { padding: Spacing.base, gap: Spacing.md, paddingBottom: 40 },
  sectionLabel: { fontSize: 9, fontWeight: Typography.weight.extrabold, color: TF.textMuted, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: Spacing.sm },
  hero: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: TF.surface, borderRadius: Radius.xl, padding: Spacing.base, borderWidth: 1, borderColor: TF.pink + '30' },
  heroTitle: { fontSize: Typography.size.xl, fontWeight: Typography.weight.extrabold, color: TF.white },
  heroSub: { fontSize: Typography.size.xs, color: TF.textSub, marginTop: 2 },
  card: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: TF.surface, borderRadius: Radius.xl, padding: Spacing.base, borderWidth: 1, borderColor: TF.border },
  cardIcon: { width: 44, height: 44, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  cardLabel: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: TF.white },
  cardSub: { fontSize: Typography.size.xs, color: TF.textSub, marginTop: 2 },
  factsCard: { backgroundColor: TF.surface, borderRadius: Radius.xl, padding: Spacing.base, borderWidth: 1, borderColor: TF.border },
  factRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, paddingVertical: 5 },
  factText: { flex: 1, fontSize: Typography.size.xs, color: TF.textSub, lineHeight: 17 },
});

// ── Main Screen ───────────────────────────────────────────────────────────────
export default function ThreadsFlip({ isHomeTab = false }: { isHomeTab?: boolean } = {}) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const routeParams = useLocalSearchParams<{ tab?: string }>();
  const initialTab = (['home', 'identify', 'value', 'style', 'sell', 'insights'].includes(routeParams.tab ?? '') ? routeParams.tab : 'home') as TFTab;
  const { tenant } = useApp();
  const { isPremium } = useSubscription();
  const { showAlert } = useAlert();
  const [activeTab, setActiveTab] = useState<TFTab>(initialTab);
  const [showPaywall, setShowPaywall] = useState(false);

  // ── Identify Tab capture & AI state ──────────────────────────────────────
  const [capturedImages, setCapturedImages] = useState<CapturedImage[]>([]);
  const [reviewingPhotos, setReviewingPhotos] = useState(false);
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
    setCapturedImages(prev => { const next = [...prev]; delete next[index]; return next; });
  }, []);

  const handleIdentify = useCallback(async () => {
    const validImages = capturedImages.filter((image): image is CapturedImage => Boolean(image));
    if (validImages.length === 0) return;
    setReviewingPhotos(false);
    setIdentifying(true);
    setAiError(null);

    const statusMsgs = [
      'Preparing garment images...',
      'Routing to clothing specialist...',
      'AI vision analysis...',
      'Reading brand label...',
      'Assessing authentication risk...',
    ];
    for (const msg of statusMsgs) {
      setProcessingStatus(msg);
      await new Promise(r => setTimeout(r, 300));
    }

    const { result, error, quotaExceeded } = await identifyItemWithAI(
      validImages, 'clothing', undefined, undefined,
      { tenantId: tenant?.id },
    );

    setIdentifying(false);

    if (quotaExceeded) {
      setAiError(`Monthly quota reached (${quotaExceeded.used}/${quotaExceeded.limit} free identifications). Upgrade to Threads Flip Pro for unlimited identifications.`);
      return;
    }
    if (error || !result) {
      setAiError(error ?? 'Identification failed - please try again');
      return;
    }

    setIdResult(result);
    setSavedItemId(null);
    setIsUploading(false);
    setUploadProgress('');
  }, [capturedImages, tenant?.id]);

  const handleSaveClothing = useCallback(async () => {
    if (!idResult || !tenant) return;
    const validImages = capturedImages.filter((image): image is CapturedImage => Boolean(image));
    setIsSaving(true);
    const { item, error } = await saveIdentifiedItem(tenant.id, idResult, {
      mediaUris: validImages.map(i => i.uri),
    });
    setIsSaving(false);
    if (error || !item) { showAlert('Save Failed', error ?? 'Could not save item.'); return; }
    setSavedItemId(item.id);
    if (validImages.length > 0) {
      setIsUploading(true);
      setUploadProgress('Uploading photos...');
      try {
        const { urls } = await uploadItemImages(item.id, validImages);
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

  const handleResetIdentify = useCallback(() => {
    setCapturedImages([]);
    setReviewingPhotos(false);
    setIdResult(null);
    setAiError(null);
    setSavedItemId(null);
    setIsUploading(false);
    setUploadProgress('');
    setProcessingStatus('');
  }, []);

  const handleTabSelect = useCallback((tab: TFTab) => {
    const premiumTabs: TFTab[] = ['insights'];
    if (premiumTabs.includes(tab) && !isPremium) { setShowPaywall(true); return; }
    setActiveTab(tab);
  }, [isPremium]);

  if (showPaywall) return <TFPaywall onBack={() => setShowPaywall(false)} />;

  // Stable QA IDs make every Threads Flip state capturable against the numbered screen pack.
  const screenId = activeTab === 'home' ? '02'
    : activeTab === 'identify' ? (savedItemId ? '09' : idResult ? '06' : identifying ? '05' : reviewingPhotos ? '04' : '03')
    : activeTab === 'value' ? '08'
    : activeTab === 'style' ? 'TF-A'
    : activeTab === 'sell' ? 'TF-B' : 'TF-C';

  return (
    <View testID={'threads-flip-screen-' + screenId} accessibilityLabel={'Threads Flip screen ' + screenId} style={main.container}>
      <StatusBar style="light" />
      <View style={[main.header, { paddingTop: insets.top + Spacing.sm }]}>
        {!isHomeTab ? (
          <Pressable onPress={() => router.back()} style={main.backBtn} hitSlop={8}>
            <MaterialIcons name="arrow-back" size={20} color={TF.pink} />
          </Pressable>
        ) : (
          <View style={{ width: 36 }} />
        )}
        <Pressable onPress={() => setActiveTab('home')} style={main.logoArea} hitSlop={4}>
          <View style={main.logoIcon}><MaterialIcons name="checkroom" size={14} color={TF.pink} /></View>
          <View>
            <Text style={main.logoText}>Threads<Text style={{ color: TF.pink }}> Flip</Text></Text>
            <Text style={main.logoSub}>IDENTIFY - VALUE - STYLE - SELL</Text>
          </View>
          {isPremium ? <View style={main.proBadge}><Text style={main.proBadgeText}>PRO</Text></View> : null}
        </Pressable>
        <Pressable onPress={() => router.push('/(tabs)/inventory' as any)} style={main.myBtn} hitSlop={6}>
          <MaterialIcons name="checkroom" size={16} color={TF.pink} />
        </Pressable>
      </View>
      {activeTab !== 'home' ? <View style={main.tabBar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={main.tabBarContent}>
          {TABS.map(tab => {
            const active = activeTab === tab.id;
            const locked = ['insights'].includes(tab.id) && !isPremium;
            return (
              <Pressable key={tab.id} onPress={() => handleTabSelect(tab.id)} style={[main.tabItem, active && main.tabItemActive]}>
                <MaterialIcons name={(locked ? 'lock' : tab.icon) as any} size={14} color={active ? TF.pink : locked ? TF.textMuted : TF.textSub} />
                <Text style={[main.tabLabel, active && main.tabLabelActive, locked && { color: TF.textMuted }]}>{tab.label}</Text>
                {locked ? <View style={main.tabProPip} /> : null}
              </Pressable>
            );
          })}
        </ScrollView>
      </View> : null}
      <View style={{ flex: 1 }}>
        {activeTab === 'home' ? <HomeTab isPremium={isPremium} onTabSelect={handleTabSelect} onUpgrade={() => setShowPaywall(true)} tenant={tenant} /> : null}
        {activeTab === 'identify' ? (
          <IdentifyTab
            capturedImages={capturedImages}
            reviewingPhotos={reviewingPhotos}
            onReviewPhotos={() => setReviewingPhotos(true)}
            onBackToCapture={() => setReviewingPhotos(false)}
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
            onSave={handleSaveClothing}
            onReset={handleResetIdentify}
            isPremium={isPremium}
            tenant={tenant}
          />
        ) : null}
        {activeTab === 'value' ? <ValueTab idResult={idResult} tenant={tenant} onIdentify={() => handleTabSelect('identify')} /> : null}
        {activeTab === 'style' ? <StyleTab /> : null}
        {activeTab === 'sell' ? <SellTab /> : null}
        {activeTab === 'insights' ? <InsightsTab /> : null}
      </View>
      {!isPremium && activeTab !== 'home' ? (
        <View style={[main.upgradeBar, { paddingBottom: insets.bottom + 4 }]}>
          <MaterialIcons name="workspace-premium" size={13} color={TF.black} />
          <Text style={main.upgradeBarText}>Upgrade to Threads Flip Pro</Text>
          <Pressable onPress={() => setShowPaywall(true)} style={main.upgradeBarBtn}>
            <Text style={main.upgradeBarBtnText}>£9.99/mo</Text>
          </Pressable>
        </View>
      ) : <View style={{ height: insets.bottom }} />}
    </View>
  );
}

const main = StyleSheet.create({
  container: { flex: 1, backgroundColor: TF.black },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.base, paddingBottom: Spacing.sm, borderBottomWidth: 1, borderBottomColor: TF.border },
  backBtn: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: TF.pinkDim, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: TF.pink + '30' },
  logoArea: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginLeft: 2 },
  logoIcon: { width: 28, height: 28, borderRadius: 14, backgroundColor: TF.pinkDim, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: TF.pink + '50' },
  logoText: { fontSize: 14, fontWeight: Typography.weight.extrabold, color: TF.white, letterSpacing: 0.3 },
  logoSub: { fontSize: 7, color: TF.textMuted, letterSpacing: 0.8 },
  proBadge: { backgroundColor: TF.pink, borderRadius: Radius.pill, paddingHorizontal: 6, paddingVertical: 2 },
  proBadgeText: { fontSize: 7, fontWeight: Typography.weight.extrabold, color: TF.black, letterSpacing: 1 },
  myBtn: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: TF.pinkDim, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: TF.pink + '30' },
  tabBar: { backgroundColor: TF.surface, borderBottomWidth: 1, borderBottomColor: TF.border },
  tabBarContent: { paddingHorizontal: Spacing.sm, gap: 2, paddingVertical: 6 },
  tabItem: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: Spacing.md, paddingVertical: 7, borderRadius: Radius.md, position: 'relative' },
  tabItemActive: { backgroundColor: TF.pinkDim },
  tabLabel: { fontSize: 10, fontWeight: Typography.weight.semibold, color: TF.textMuted },
  tabLabelActive: { color: TF.pink },
  tabProPip: { width: 4, height: 4, borderRadius: 2, backgroundColor: TF.pinkMid, position: 'absolute', top: 4, right: 4 },
  upgradeBar: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: TF.pink, paddingHorizontal: Spacing.base, paddingTop: Spacing.sm },
  upgradeBarText: { flex: 1, fontSize: Typography.size.xs, fontWeight: Typography.weight.bold, color: TF.black },
  upgradeBarBtn: { backgroundColor: TF.black + '30', borderRadius: Radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
  upgradeBarBtnText: { fontSize: Typography.size.xs, fontWeight: Typography.weight.extrabold, color: TF.black },
});
