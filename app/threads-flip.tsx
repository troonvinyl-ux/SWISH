
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
  textMuted:     '#5A3050',
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

const TOP_BRANDS = ['Levi\'s', 'Nike', 'Carhartt', 'Ralph Lauren', 'Stone Island', 'The North Face', 'Adidas', 'Burberry', 'Prada', 'Supreme'];

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
            <Text style={pw.upgradeBtnText}>{upgrading ? 'Opening checkout…' : 'Upgrade to Threads Flip Pro'}</Text>
            <Text style={pw.upgradeBtnSub}>£9.99 / month · Cancel any time</Text>
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

  useEffect(() => {
    if (!tenant?.id) return;
    getSupabaseClient()
      .from('items').select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenant.id).eq('specialist_id', 'clothing')
      .then(({ count }) => setItemCount(count ?? 0));
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
      {/* Hero */}
      <View style={ht.hero}>
        <View style={ht.heroLeft}>
          <View style={ht.heroIcon}><MaterialIcons name="checkroom" size={32} color={TF.pink} /></View>
        </View>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={ht.brandText}>Threads<Text style={{ color: TF.pink }}> Flip</Text></Text>
          <Text style={ht.tagline}>Turn fashion into opportunity.</Text>
          <Text style={ht.subTagline}>IDENTIFY • VALUE • STYLE • SELL</Text>
          <View style={ht.categoryRow}>
            {['Vintage', 'Designer', 'Streetwear'].map(c => (
              <View key={c} style={ht.catChip}><Text style={ht.catChipText}>{c}</Text></View>
            ))}
          </View>
        </View>
        {isPremium ? <View style={ht.proBadge}><Text style={ht.proBadgeText}>PRO</Text></View> : null}
      </View>

      {/* Stats */}
      <View style={ht.statsRow}>
        {[
          { label: 'Items in Stock', value: itemCount !== null ? String(itemCount) : '—', color: TF.white },
          { label: 'Categories', value: '8', color: TF.pink },
          { label: 'AI Powered', value: '✓', color: TF.success },
        ].map((s, i) => (
          <View key={s.label} style={[ht.stat, i > 0 && { borderLeftWidth: 1, borderLeftColor: TF.border }]}>
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
              <View style={[ht.gridIcon, locked && { backgroundColor: TF.border }]}>
                <MaterialIcons name={locked ? 'lock' : f.icon as any} size={22} color={locked ? TF.textMuted : TF.pink} />
              </View>
              <Text style={[ht.gridLabel, locked && { color: TF.textMuted }]} numberOfLines={1}>{f.label}</Text>
              {locked ? <View style={ht.proTag}><Text style={ht.proTagText}>PRO</Text></View> : null}
            </Pressable>
          );
        })}
      </View>

      {/* Category scroller */}
      <Text style={ht.sectionLabel}>CATEGORIES</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: Spacing.sm, paddingVertical: 4 }}>
        {CLOTHING_CATEGORIES.map(cat => (
          <Pressable key={cat.id} onPress={() => onTabSelect('identify')} style={({ pressed }) => [ht.catCard, pressed && { opacity: 0.82 }]}>
            <MaterialIcons name="checkroom" size={16} color={TF.pink} />
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
            <Text style={ht.upgradeSub}>Live market values · Care guides · Listing templates</Text>
          </View>
          <Text style={ht.upgradePrice}>£9.99/mo</Text>
        </Pressable>
      ) : (
        <View style={ht.proConfirmed}>
          <MaterialIcons name="workspace-premium" size={15} color={TF.pink} />
          <Text style={ht.proConfirmedText}>Threads Flip Pro — all features unlocked</Text>
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
  catCard: { backgroundColor: TF.surface, borderRadius: Radius.xl, padding: Spacing.md, gap: 4, alignItems: 'center', width: 100, borderWidth: 1, borderColor: TF.border },
  catLabel: { fontSize: Typography.size.xs, fontWeight: Typography.weight.bold, color: TF.textPrimary, textAlign: 'center' },
  catSub: { fontSize: 8, color: TF.textMuted, textAlign: 'center', lineHeight: 12 },
  upgradeBanner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: TF.pink, borderRadius: Radius.xxl, paddingVertical: Spacing.base, paddingHorizontal: Spacing.lg, shadowColor: TF.pink, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.4, shadowRadius: 14, elevation: 6 },
  upgradeText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.extrabold, color: TF.black },
  upgradeSub: { fontSize: 10, color: TF.black + 'AA' },
  upgradePrice: { fontSize: Typography.size.base, fontWeight: Typography.weight.extrabold, color: TF.black },
  proConfirmed: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: TF.pinkDim, borderRadius: Radius.xl, padding: Spacing.md, borderWidth: 1, borderColor: TF.pink + '40' },
  proConfirmedText: { fontSize: Typography.size.sm, color: TF.pink, fontWeight: Typography.weight.semibold },
});

// ── Identify Tab ──────────────────────────────────────────────────────────────
function IdentifyTab() {
  const router = useRouter();
  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={id.content}>
      <View style={id.hero}>
        <MaterialIcons name="photo-camera" size={28} color={TF.pink} />
        <View style={{ flex: 1 }}>
          <Text style={id.heroTitle}>Scan & Identify</Text>
          <Text style={id.heroSub}>Photograph the label and garment — AI reads brand, era, composition, condition, and authentication risk</Text>
        </View>
      </View>
      <View style={id.methodRow}>
        {[
          { icon: 'photo-camera', label: 'Photo', desc: 'Photograph label & garment' },
          { icon: 'image', label: 'Gallery', desc: 'From photo library' },
          { icon: 'link', label: 'Link', desc: 'eBay / Vinted listing' },
          { icon: 'edit', label: 'Manual', desc: 'Enter details manually' },
        ].map(m => (
          <Pressable key={m.label} onPress={() => router.navigate('/(tabs)/scan')} style={({ pressed }) => [id.methodCard, pressed && { opacity: 0.82 }]}>
            <View style={id.methodIcon}><MaterialIcons name={m.icon as any} size={22} color={TF.pink} /></View>
            <Text style={id.methodLabel}>{m.label}</Text>
            <Text style={id.methodDesc}>{m.desc}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={id.sectionLabel}>EXAMPLE IDENTIFICATION</Text>
      <View style={id.exampleCard}>
        <View style={id.exampleHeader}>
          <View style={id.exampleThumb}><MaterialIcons name="checkroom" size={22} color={TF.pink} /></View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={id.exampleTitle}>Levi's Vintage Denim Jacket</Text>
            <Text style={id.exampleSub}>Type III · 1980s</Text>
            <View style={[id.confBadge, { backgroundColor: TF.success }]}><Text style={id.confText}>95%</Text></View>
          </View>
        </View>
        {[
          { label: 'Brand', value: "Levi's" },
          { label: 'Era', value: '1980s' },
          { label: 'Style', value: 'Type III (Trucker)' },
          { label: 'Material', value: 'Denim (Cotton)' },
          { label: 'Condition', value: 'Excellent' },
          { label: 'Authentication', value: 'LOW RISK', color: TF.success },
        ].map(row => (
          <View key={row.label} style={id.attrRow}>
            <Text style={id.attrKey}>{row.label}</Text>
            <Text style={[id.attrValue, row.color ? { color: row.color } : {}]}>{row.value}</Text>
          </View>
        ))}
      </View>
      <Text style={id.sectionLabel}>POSSIBLE MATCHES</Text>
      <View style={id.matchCard}>
        {[
          { name: "Levi's Vintage Denim Jacket", sub: 'Type III · 1980s', conf: 95 },
          { name: 'Carhartt Detroit Jacket', sub: 'Work wear · 1990s', conf: 87 },
          { name: 'Ralph Lauren Denim Shirt', sub: 'Casual · 1990s', conf: 82 },
          { name: 'Vintage Nike Windbreaker', sub: 'Sportswear · 1990s', conf: 76 },
        ].map(m => (
          <View key={m.name} style={id.matchRow}>
            <View style={id.matchThumb}><MaterialIcons name="checkroom" size={16} color={TF.pink} /></View>
            <View style={{ flex: 1 }}>
              <Text style={id.matchName}>{m.name}</Text>
              <Text style={id.matchSub}>{m.sub}</Text>
            </View>
            <View style={[id.confBadge, { backgroundColor: m.conf >= 90 ? TF.success : m.conf >= 80 ? TF.warning : TF.danger }]}>
              <Text style={id.confText}>{m.conf}%</Text>
            </View>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}
const id = StyleSheet.create({
  content: { padding: Spacing.base, gap: Spacing.lg, paddingBottom: 40 },
  sectionLabel: { fontSize: 9, fontWeight: Typography.weight.extrabold, color: TF.textMuted, textTransform: 'uppercase', letterSpacing: 0.8 },
  hero: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: TF.surface, borderRadius: Radius.xl, padding: Spacing.base, borderWidth: 1, borderColor: TF.pink + '30' },
  heroTitle: { fontSize: Typography.size.xl, fontWeight: Typography.weight.extrabold, color: TF.white },
  heroSub: { fontSize: Typography.size.xs, color: TF.textSub, lineHeight: 17, marginTop: 3 },
  methodRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  methodCard: { width: '48%', backgroundColor: TF.surface, borderRadius: Radius.xl, padding: Spacing.base, gap: Spacing.sm, borderWidth: 1, borderColor: TF.border },
  methodIcon: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: TF.pinkDim, alignItems: 'center', justifyContent: 'center' },
  methodLabel: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: TF.white },
  methodDesc: { fontSize: Typography.size.xs, color: TF.textSub },
  exampleCard: { backgroundColor: TF.surface, borderRadius: Radius.xl, padding: Spacing.md, borderWidth: 1, borderColor: TF.pink + '30' },
  exampleHeader: { flexDirection: 'row', gap: Spacing.md, marginBottom: Spacing.md, alignItems: 'center' },
  exampleThumb: { width: 48, height: 48, borderRadius: Radius.md, backgroundColor: TF.pinkDim, alignItems: 'center', justifyContent: 'center' },
  exampleTitle: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: TF.white },
  exampleSub: { fontSize: Typography.size.xs, color: TF.textSub },
  confBadge: { borderRadius: Radius.pill, paddingHorizontal: 8, paddingVertical: 3, alignSelf: 'flex-start' },
  confText: { fontSize: 10, fontWeight: Typography.weight.extrabold, color: '#000' },
  attrRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: TF.border + '60' },
  attrKey: { fontSize: Typography.size.sm, color: TF.textSub },
  attrValue: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: TF.white },
  matchCard: { backgroundColor: TF.surface, borderRadius: Radius.xl, padding: Spacing.md, gap: Spacing.sm, borderWidth: 1, borderColor: TF.border },
  matchRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: 4 },
  matchThumb: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: TF.pinkDim, alignItems: 'center', justifyContent: 'center' },
  matchName: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: TF.white },
  matchSub: { fontSize: Typography.size.xs, color: TF.textSub },
});

// ── Value Tab ─────────────────────────────────────────────────────────────────
function ValueTab() {
  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={vt.content}>
      <View style={vt.hero}>
        <MaterialIcons name="bar-chart" size={28} color={TF.pink} />
        <View style={{ flex: 1 }}>
          <Text style={vt.heroTitle}>Value & Profit</Text>
          <Text style={vt.heroSub}>Resale Value · Costs · Trends</Text>
        </View>
      </View>
      <Text style={vt.sectionLabel}>EXAMPLE — VALUE ANALYSIS</Text>
      <View style={vt.valueCard}>
        <Text style={vt.valueName}>Levi's Vintage Denim Jacket · 1980s</Text>
        <View style={vt.priceRange}>
          <Text style={vt.priceLabel}>Estimated Resale Value</Text>
          <Text style={vt.priceMain}>£70 – £140</Text>
        </View>
        <View style={vt.opportunitySection}>
          <Text style={vt.oppTitle}>SELLING OPPORTUNITY</Text>
          {[
            { label: 'Typical Buy Price', value: '£10 – £25' },
            { label: 'Cleaning / Minor Repairs', value: '£5' },
            { label: 'Total Investment', value: '£25', bold: false },
            { label: 'Likely Selling Price', value: '£100', bold: false },
            { label: 'Potential Profit', value: '£60 – £75', pink: true },
          ].map(row => (
            <View key={row.label} style={vt.oppRow}>
              <Text style={[vt.oppLabel, row.bold && { fontWeight: Typography.weight.bold, color: TF.white }]}>{row.label}</Text>
              <Text style={[vt.oppValue, row.pink && { color: TF.pink, fontWeight: Typography.weight.extrabold }]}>{row.value}</Text>
            </View>
          ))}
        </View>
      </View>
      <Text style={vt.sectionLabel}>RECENT EBAY SALES</Text>
      <View style={vt.salesCard}>
        {[
          { item: "Levi's Type III Trucker", price: '£125', date: '12 Mar 2024' },
          { item: "Levi's Vintage Denim Jacket", price: '£98', date: '5 Mar 2024' },
          { item: "Levi's 80s Denim Jacket", price: '£110', date: '28 Feb 2024' },
        ].map(sale => (
          <View key={sale.date} style={vt.saleRow}>
            <View style={{ flex: 1 }}>
              <Text style={vt.saleItem}>{sale.item}</Text>
              <Text style={vt.saleDate}>{sale.date}</Text>
            </View>
            <Text style={vt.salePrice}>{sale.price}</Text>
          </View>
        ))}
      </View>
      <View style={vt.infoCard}>
        <MaterialIcons name="info-outline" size={14} color={TF.pink} />
        <Text style={vt.infoText}>Identify an item first to get real eBay sold prices and a personalised profit estimate.</Text>
      </View>
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
  salesCard: { backgroundColor: TF.surface, borderRadius: Radius.xl, padding: Spacing.md, borderWidth: 1, borderColor: TF.border },
  saleRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: TF.border + '60' },
  saleItem: { fontSize: Typography.size.sm, color: TF.white },
  saleDate: { fontSize: Typography.size.xs, color: TF.textMuted },
  salePrice: { fontSize: Typography.size.base, fontWeight: Typography.weight.extrabold, color: TF.pink },
  infoCard: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, backgroundColor: TF.pinkDim, borderRadius: Radius.md, padding: Spacing.md, borderWidth: 1, borderColor: TF.pink + '25' },
  infoText: { flex: 1, fontSize: Typography.size.xs, color: TF.pink, lineHeight: 17 },
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
          <Text style={st.heroSub}>Brand recognition · Authentication · Trends · Care</Text>
        </View>
      </View>
      {CATEGORIES_INFO.map(cat => (
        <Pressable key={cat.id} style={({ pressed }) => [st.catCard, { borderColor: cat.color + '40' }, pressed && { opacity: 0.85 }]}>
          <View style={[st.catIcon, { backgroundColor: cat.color + '20' }]}><MaterialIcons name={cat.icon as any} size={22} color={cat.color} /></View>
          <View style={{ flex: 1 }}>
            <Text style={st.catLabel}>{cat.label}</Text>
            <Text style={st.catDesc}>{cat.desc}</Text>
          </View>
          <MaterialIcons name="chevron-right" size={16} color={TF.textMuted} />
        </Pressable>
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
          <Text style={sl.heroSub}>eBay · Depop · Vinted · Etsy · Global reach</Text>
        </View>
      </View>
      {[
        { icon: 'receipt-long', label: 'My Listings', sub: 'Active and draft eBay listings', color: '#E53238', route: '/(tabs)/listings' as any },
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
          { cat: 'Vintage clothing', platform: 'Depop · eBay', tip: 'Story-led listings perform best' },
          { cat: 'Designer items', platform: 'eBay · Vestiaire', tip: 'Authentication proof essential' },
          { cat: 'Streetwear', platform: 'eBay · StockX · Depop', tip: 'Condition is everything' },
          { cat: 'High street', platform: 'Vinted · eBay', tip: 'Competitive pricing wins' },
          { cat: 'Trainers', platform: 'eBay · StockX · GOAT', tip: 'Deadstock commands huge premium' },
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
          <Text style={ins.heroSub}>Trends · Opportunities · AI recommendations</Text>
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
        <Text style={ins.sectionLabel}>FASHION FLIPPING FACTS</Text>
        {[
          'Levi\'s 501s sell every 3 minutes on eBay globally',
          'Vintage band tees can yield 10x+ on charity shop finds',
          'Authentication evidence doubles sale price on designer items',
          'Good photography is worth more than any listing upgrade',
          'Stone Island sells fastest in autumn and winter',
          'Deadstock with tags commands 30-50% premium',
          'Depop buyers skew younger — use trend-aware language',
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
export default function ThreadsFlip() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { tenant } = useApp();
  const { isPremium } = useSubscription();
  const [activeTab, setActiveTab] = useState<TFTab>('home');
  const [showPaywall, setShowPaywall] = useState(false);

  const handleTabSelect = useCallback((tab: TFTab) => {
    const premiumTabs: TFTab[] = ['insights'];
    if (premiumTabs.includes(tab) && !isPremium) { setShowPaywall(true); return; }
    setActiveTab(tab);
  }, [isPremium]);

  if (showPaywall) return <TFPaywall onBack={() => setShowPaywall(false)} />;

  return (
    <View style={main.container}>
      <StatusBar style="light" />
      <View style={[main.header, { paddingTop: insets.top + Spacing.sm }]}>
        <Pressable onPress={() => router.back()} style={main.backBtn} hitSlop={8}>
          <MaterialIcons name="arrow-back" size={20} color={TF.pink} />
        </Pressable>
        <Pressable onPress={() => setActiveTab('home')} style={main.logoArea} hitSlop={4}>
          <View style={main.logoIcon}><MaterialIcons name="checkroom" size={14} color={TF.pink} /></View>
          <View>
            <Text style={main.logoText}>Threads<Text style={{ color: TF.pink }}> Flip</Text></Text>
            <Text style={main.logoSub}>IDENTIFY • VALUE • STYLE • SELL</Text>
          </View>
          {isPremium ? <View style={main.proBadge}><Text style={main.proBadgeText}>PRO</Text></View> : null}
        </Pressable>
        <Pressable onPress={() => router.push('/(tabs)/inventory' as any)} style={main.myBtn} hitSlop={6}>
          <MaterialIcons name="checkroom" size={16} color={TF.pink} />
        </Pressable>
      </View>
      <View style={main.tabBar}>
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
      </View>
      <View style={{ flex: 1 }}>
        {activeTab === 'home' ? <HomeTab isPremium={isPremium} onTabSelect={handleTabSelect} onUpgrade={() => setShowPaywall(true)} tenant={tenant} /> : null}
        {activeTab === 'identify' ? <IdentifyTab /> : null}
        {activeTab === 'value' ? <ValueTab /> : null}
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
