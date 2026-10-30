// SWISH Scan Tab — Niche-Aware Capture Router
//
// SWISH is the invisible platform. This tab routes each subscriber directly
// to their niche's capture / identification workflow. No generic SWISH scanner.
//
// Coin subscriber   → Coin Flipper capture flow
// MX subscriber     → Flipper MX find/identify flow
// Bike subscriber   → Bike Flipper find/identify flow
// Fashion subscriber → Threads Flip identify flow

import React, { useEffect } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors, Typography, Spacing, Radius, Shadow } from '@/constants/theme';
import { useApp } from '@/hooks/useApp';
import { useSubscription } from '@/hooks/useSubscription';

// ── Map active niche to its product ──────────────────────────────────────────

type NicheProduct = 'coins' | 'mx' | 'bikes' | 'clothing' | 'cards' | 'antiques' | 'fossils' | 'beauty' | 'tech' | 'surplus' | 'general';

function getNicheProduct(nicheId: string | null | undefined): NicheProduct {
  const id = (nicheId ?? '').toLowerCase();
  if (id.includes('coin') || id === 'gold' || id === 'silver' || id === 'banknotes' || id === 'islamic_silver') return 'coins';
  if (id === 'motocross' || id === 'mx') return 'mx';
  if (id === 'bicycles' || id === 'cycling' || id === 'bikes') return 'bikes';
  if (id === 'clothing' || id === 'fashion' || id === 'trainers_sneakers' || id === 'trainers') return 'clothing';
  if (id === 'surplus_flip' || id === 'catalog_flip' || id === 'catalog_surplus' || id === 'surplus_trader') return 'surplus';
  if (id === 'trading_cards' || id === 'pokemon_cards' || id === 'cards' || id === 'card_flipper') return 'cards';
  if (id === 'antiques' || id === 'antique_flipper') return 'antiques';
  if (id === 'fossils' || id === 'fossil_flipper') return 'fossils';
  if (id === 'beauty' || id === 'beauty_flipper') return 'beauty';
  if (id === 'tech' || id === 'technology' || id === 'tech_flipper' || id === 'retro_games' || id === 'retro_consoles') return 'tech';
  return 'general';
}

// ── Per-niche capture card config ─────────────────────────────────────────────

interface NicheCaptureConfig {
  title: string;
  subtitle: string;
  tagline: string;
  icon: string;
  color: string;
  bgColor: string;
  dimColor: string;
  route: string;
  captureOptions: Array<{
    icon: string;
    label: string;
    desc: string;
  }>;
  aiCapabilities: string[];
}

const NICHE_CAPTURE: Record<NicheProduct, NicheCaptureConfig> = {
  coins: {
    title: 'Coin Flipper',
    subtitle: 'AI Coin Identification',
    tagline: 'ANCIENT COINS • REAL VALUES • SMARTER DECISIONS',
    icon: 'toll',
    color: '#F5C842',
    bgColor: '#09080A',
    dimColor: '#2A2000',
    route: '/coin-flipper',
    captureOptions: [
      { icon: 'photo-camera', label: 'Obverse', desc: 'Head / front face — required' },
      { icon: 'photo-camera', label: 'Reverse', desc: 'Tail / back face — required' },
      { icon: 'center-focus-strong', label: 'Edge', desc: 'Milled / lettered — optional' },
      { icon: 'zoom-in', label: 'Detail', desc: 'Inscription / date — optional' },
    ],
    aiCapabilities: [
      'Object classification (coin, medal, token, banknote)',
      'Numista catalogue cross-reference',
      'Denomination, issuer and period identification',
      'Condition assessment and grading',
      'Visible legend transcription (character by character)',
      'Weight and diameter contradiction detection',
      'Islamic, Roman, Greek, British specialist routing',
    ],
  },
  mx: {
    title: 'Flipper MX',
    subtitle: 'AI Bike Identification',
    tagline: 'DIRT BIKES • REAL DATA • BIGGER PROFITS',
    icon: 'two-wheeler',
    color: '#FF5500',
    bgColor: '#0A0A08',
    dimColor: '#2A1500',
    route: '/flipper-mx',
    captureOptions: [
      { icon: 'photo-camera', label: 'Side Profile', desc: 'Full bike side — required' },
      { icon: 'photo-camera', label: 'Tank Badge', desc: 'Brand / manufacturer logo' },
      { icon: 'photo-camera', label: 'Engine', desc: 'Engine size decal / cylinder' },
      { icon: 'photo-camera', label: 'Frame / VIN', desc: 'Frame number plate' },
    ],
    aiCapabilities: [
      'Manufacturer from tank badge and shroud graphics',
      'Model family (SX vs XCW vs enduro vs pit bike)',
      'Year range from plastics generation',
      'Engine size from visible decals',
      '2-stroke vs 4-stroke identification',
      'Running status (most important commercial signal)',
      'Visible modifications and aftermarket parts',
    ],
  },
  bikes: {
    title: 'Bike Flipper',
    subtitle: 'AI Bicycle Identification',
    tagline: 'ANY BIKE • REAL DATA • BIGGER PROFITS',
    icon: 'pedal-bike',
    color: '#6ED020',
    bgColor: '#080C08',
    dimColor: '#0A2000',
    route: '/bike-flipper',
    captureOptions: [
      { icon: 'photo-camera', label: 'Full Bike', desc: 'Side profile — required' },
      { icon: 'photo-camera', label: 'Head Badge', desc: 'Brand decal / badge' },
      { icon: 'photo-camera', label: 'Components', desc: 'Groupset / drivetrain' },
      { icon: 'photo-camera', label: 'Frame Detail', desc: 'Frame number / size stamp' },
    ],
    aiCapabilities: [
      'Brand and model identification from badges',
      'Frame size, material and year range',
      'Groupset identification (Shimano, SRAM, Campagnolo)',
      'Fork type and suspension assessment',
      'Wheel size and tyre condition',
      'Component condition and upgrade potential',
      'Flip Score from condition and market data',
    ],
  },
  clothing: {
    title: 'Threads Flip',
    subtitle: 'AI Fashion Identification',
    tagline: 'VINTAGE • DESIGNER • STREETWEAR • REAL PROFITS',
    icon: 'checkroom',
    color: '#E91E8C',
    bgColor: '#0C080C',
    dimColor: '#250014',
    route: '/threads-flip',
    captureOptions: [
      { icon: 'photo-camera', label: 'Brand Label', desc: 'Internal neck/waist label — required' },
      { icon: 'photo-camera', label: 'Care Label', desc: 'Composition and care symbols' },
      { icon: 'photo-camera', label: 'Garment Front', desc: 'Full front view of item' },
      { icon: 'photo-camera', label: 'Detail / Flaw', desc: 'Any damage, staining, hardware' },
    ],
    aiCapabilities: [
      'Brand label reading (exact characters)',
      'Era dating from label style, care symbols, construction',
      'Fibre composition from care label',
      'Garment type and gender category',
      'Condition assessment and visible damage',
      'Authentication risk level (LOW / MEDIUM / HIGH)',
      'Recommended marketplace and selling strategy',
    ],
  },
  surplus: {
    title: 'Surplus Flip',
    subtitle: 'AI Surplus & Wholesale Identification',
    tagline: 'BUY SMART • PRICE FAST • TURN STOCK QUICKLY',
    icon: 'inventory-2',
    color: '#38BDF8',
    bgColor: '#070B10',
    dimColor: '#0B2634',
    route: '/surplus-flip',
    captureOptions: [
      { icon: 'photo-camera', label: 'Lot / Manifest', desc: 'Capture the full lot or manifest' },
      { icon: 'photo-camera', label: 'Item Labels', desc: 'Brand, model, SKU and barcode' },
      { icon: 'photo-camera', label: 'Condition', desc: 'Damage, seals and packaging' },
      { icon: 'photo-camera', label: 'Auction Details', desc: 'Current bid, fees and time remaining' },
    ],
    aiCapabilities: [
      'Manifest and lot item extraction',
      'Retail-price and resale-value estimation',
      'Fees, shipping and risk-adjusted bid ceiling',
      'Fast-turnover maximum purchase recommendation',
      'Lot-level margin and cash-recovery analysis',
    ],
  },
  cards: {
    title: 'Card Flipper',
    subtitle: 'AI Trading Card Identification',
    tagline: 'IDENTIFY • GRADE • VALUE • FLIP',
    icon: 'style',
    color: '#FACC15',
    bgColor: '#0B0A05',
    dimColor: '#2A2200',
    route: '/create-listing',
    captureOptions: [
      { icon: 'photo-camera', label: 'Card Front', desc: 'Full card face, straight-on' },
      { icon: 'photo-camera', label: 'Card Back', desc: 'Show back and centering' },
      { icon: 'photo-camera', label: 'Corners', desc: 'Close-up of all four corners' },
      { icon: 'photo-camera', label: 'Surface', desc: 'Foil, scratches and wear' },
    ],
    aiCapabilities: ['Card and set identification', 'Rarity and edition extraction', 'Condition and grading guidance', 'Market value and listing preparation'],
  },
  antiques: {
    title: 'Antique Flipper',
    subtitle: 'AI Antique Identification',
    tagline: 'MAKER • PERIOD • CONDITION • VALUE',
    icon: 'museum',
    color: '#D97706',
    bgColor: '#100A05',
    dimColor: '#2A1605',
    route: '/create-listing',
    captureOptions: [
      { icon: 'photo-camera', label: 'Main View', desc: 'Full item from the front' },
      { icon: 'photo-camera', label: 'Maker Marks', desc: 'Hallmarks, stamps and signatures' },
      { icon: 'photo-camera', label: 'Reverse', desc: 'Underside and construction' },
      { icon: 'photo-camera', label: 'Condition', desc: 'Damage, repairs and wear' },
    ],
    aiCapabilities: ['Object and maker identification', 'Period and material clues', 'Condition and restoration assessment', 'Evidence-based resale valuation'],
  },
  fossils: {
    title: 'Fossil Flipper',
    subtitle: 'AI Fossil & Mineral Identification',
    tagline: 'SPECIES • PERIOD • PROVENANCE • VALUE',
    icon: 'yard',
    color: '#8B5CF6',
    bgColor: '#0B0712',
    dimColor: '#211238',
    route: '/create-listing',
    captureOptions: [
      { icon: 'photo-camera', label: 'Specimen', desc: 'Full specimen with clear focus' },
      { icon: 'photo-camera', label: 'Detail', desc: 'Distinctive features and texture' },
      { icon: 'photo-camera', label: 'Scale', desc: 'Include a size reference' },
      { icon: 'photo-camera', label: 'Locality', desc: 'Record provenance when known' },
    ],
    aiCapabilities: ['Fossil or mineral classification', 'Species and geological-period clues', 'Condition and completeness assessment', 'Provenance-aware valuation'],
  },
  beauty: {
    title: 'Beauty Flipper',
    subtitle: 'AI Beauty Product Identification',
    tagline: 'BRAND • BATCH • CONDITION • VALUE',
    icon: 'spa',
    color: '#F472B6',
    bgColor: '#10070D',
    dimColor: '#2A1020',
    route: '/create-listing',
    captureOptions: [
      { icon: 'photo-camera', label: 'Product Front', desc: 'Brand and product name' },
      { icon: 'photo-camera', label: 'Back Label', desc: 'Ingredients and barcode' },
      { icon: 'photo-camera', label: 'Batch / Expiry', desc: 'Batch code and expiry date' },
      { icon: 'photo-camera', label: 'Seal', desc: 'Show whether packaging is unopened' },
    ],
    aiCapabilities: ['Brand and product identification', 'Packaging and authenticity clues', 'Expiry and condition checks', 'Resale listing preparation'],
  },
  tech: {
    title: 'Tech Flipper',
    subtitle: 'AI Technology Identification',
    tagline: 'MODEL • SPECS • CONDITION • VALUE',
    icon: 'devices',
    color: '#06B6D4',
    bgColor: '#050D10',
    dimColor: '#0B2630',
    route: '/create-listing',
    captureOptions: [
      { icon: 'photo-camera', label: 'Device', desc: 'Full product view' },
      { icon: 'photo-camera', label: 'Model Label', desc: 'Model and specification label' },
      { icon: 'photo-camera', label: 'Accessories', desc: 'Cables, chargers and included parts' },
      { icon: 'photo-camera', label: 'Condition', desc: 'Damage and tested status' },
    ],
    aiCapabilities: ['Brand and model identification', 'Specification extraction', 'Condition and completeness assessment', 'Resale value and listing preparation'],
  },
  general: {
    title: 'SWISH Scanner',
    subtitle: 'AI Item Identification',
    tagline: 'IDENTIFY • VALUE • LIST • SELL',
    icon: 'search',
    color: Colors.primary,
    bgColor: Colors.background,
    dimColor: Colors.primaryDim,
    route: '/create-listing',
    captureOptions: [
      { icon: 'photo-camera', label: 'Photo', desc: 'Photograph the item' },
      { icon: 'image', label: 'Gallery', desc: 'From photo library' },
      { icon: 'link', label: 'URL', desc: 'eBay listing link' },
      { icon: 'edit', label: 'Manual', desc: 'Enter details manually' },
    ],
    aiCapabilities: [
      'Object classification and specialist routing',
      'Condition assessment from visible evidence',
      'Attribute extraction and cataloguing',
      'Evidence-based confidence scoring',
    ],
  },
};

// ── Scan Screen ───────────────────────────────────────────────────────────────

export default function ScanScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { activeNicheId, fixedNicheId } = useApp();
  const { isPremium } = useSubscription();

  // Branded APK identity takes precedence over saved account preferences.
  // This prevents a master account's Coins preference opening the coin scanner
  // inside a clothing/MX/bike installation.
  const product = getNicheProduct(fixedNicheId ?? activeNicheId);
  const config = NICHE_CAPTURE[product];

  const handleOpenNiche = () => {
    // The Scan tab is an action, not a second landing page. Open the active
    // niche directly in capture mode; keep other niche routes unchanged.
    if (product === 'coins') {
      router.replace('/coin-flipper?tab=capture' as any);
      return;
    }
    router.push(config.route as any);
  };

  return (
    <View style={[s.container, { backgroundColor: config.bgColor }]}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={[s.header, { paddingTop: insets.top + Spacing.md }]}>
        <View style={[s.nicheIcon, { backgroundColor: config.dimColor }]}>
          <MaterialIcons name={config.icon as any} size={22} color={config.color} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[s.headerTitle, { color: config.color }]}>{config.title}</Text>
          <Text style={s.headerSub}>{config.subtitle}</Text>
        </View>
        {isPremium ? (
          <View style={[s.proBadge, { backgroundColor: config.color }]}>
            <Text style={s.proBadgeText}>PRO</Text>
          </View>
        ) : null}
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 40 }]}
      >
        {/* Hero CTA */}
        <Pressable
          onPress={handleOpenNiche}
          style={({ pressed }) => [s.heroCTA, { borderColor: config.color + '50', shadowColor: config.color }, pressed && { opacity: 0.88, transform: [{ scale: 0.98 }] }]}
        >
          <View style={[s.heroCTAIcon, { backgroundColor: config.dimColor }]}>
            <MaterialIcons name="photo-camera" size={36} color={config.color} />
          </View>
          <Text style={[s.heroCTATitle, { color: config.color }]}>Start Scanning</Text>
          <Text style={s.heroCTASub}>{config.tagline}</Text>
          <View style={[s.heroCTABtn, { backgroundColor: config.color }]}>
            <MaterialIcons name="arrow-forward" size={16} color={config.bgColor} />
            <Text style={[s.heroCTABtnText, { color: config.bgColor }]}>Open {config.title}</Text>
          </View>
        </Pressable>

        {/* Capture guidance */}
        <View style={s.sectionLabel}>
          <View style={[s.sectionDot, { backgroundColor: config.color }]} />
          <Text style={s.sectionLabelText}>WHAT TO PHOTOGRAPH</Text>
        </View>
        <View style={s.captureGrid}>
          {config.captureOptions.map((opt, i) => (
            <View key={i} style={[s.captureCard, { borderColor: config.color + '25' }]}>
              <View style={[s.captureIcon, { backgroundColor: config.dimColor }]}>
                <MaterialIcons name={opt.icon as any} size={20} color={config.color} />
              </View>
              <Text style={s.captureLabel}>{opt.label}</Text>
              <Text style={s.captureDesc}>{opt.desc}</Text>
            </View>
          ))}
        </View>

        {/* AI capabilities */}
        <View style={s.sectionLabel}>
          <View style={[s.sectionDot, { backgroundColor: config.color }]} />
          <Text style={s.sectionLabelText}>WHAT THE AI IDENTIFIES</Text>
        </View>
        <View style={[s.aiCard, { borderColor: config.color + '20' }]}>
          {config.aiCapabilities.map((cap, i) => (
            <View key={i} style={s.aiRow}>
              <MaterialIcons name="check-circle" size={12} color={config.color} />
              <Text style={s.aiText}>{cap}</Text>
            </View>
          ))}
        </View>

        {/* Quick links */}
        <View style={s.sectionLabel}>
          <View style={[s.sectionDot, { backgroundColor: config.color }]} />
          <Text style={s.sectionLabelText}>QUICK ACTIONS</Text>
        </View>
        <View style={s.quickLinks}>
          {[
            { icon: 'inventory-2', label: 'My Inventory', route: '/(tabs)/inventory' },
            { icon: 'receipt-long', label: 'My Listings', route: '/(tabs)/listings' },
            { icon: 'savings', label: 'Should I Buy This?', route: '/buy-decision' },
            { icon: 'storefront', label: 'eBay Hub', route: '/ebay-hub' },
            { icon: 'cloud-download', label: 'Import eBay', route: '/ebay-import' },
          ].map(link => (
            <Pressable
              key={link.label}
              onPress={() => router.push(link.route as any)}
              style={({ pressed }) => [s.quickLink, pressed && { opacity: 0.82 }]}
            >
              <View style={[s.quickLinkIcon, { backgroundColor: config.dimColor }]}>
                <MaterialIcons name={link.icon as any} size={18} color={config.color} />
              </View>
              <Text style={s.quickLinkLabel}>{link.label}</Text>
              <MaterialIcons name="chevron-right" size={14} color="#555" />
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.base,
    paddingBottom: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  nicheIcon: {
    width: 40,
    height: 40,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: Typography.size.base,
    fontWeight: Typography.weight.extrabold,
    letterSpacing: 0.5,
  },
  headerSub: {
    fontSize: Typography.size.xs,
    color: 'rgba(255,255,255,0.45)',
    marginTop: 2,
  },
  proBadge: {
    borderRadius: Radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  proBadgeText: {
    fontSize: 8,
    fontWeight: Typography.weight.extrabold,
    color: '#000',
    letterSpacing: 1,
  },

  content: { padding: Spacing.base, gap: Spacing.xl },

  heroCTA: {
    alignItems: 'center',
    gap: Spacing.md,
    borderRadius: Radius.xxl,
    padding: Spacing.xl,
    borderWidth: 1,
    backgroundColor: 'rgba(255,255,255,0.04)',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 8,
  },
  heroCTAIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.sm,
  },
  heroCTATitle: {
    fontSize: Typography.size.xxl,
    fontWeight: Typography.weight.extrabold,
    letterSpacing: 0.5,
  },
  heroCTASub: {
    fontSize: 9,
    color: 'rgba(255,255,255,0.45)',
    letterSpacing: 1.5,
    textAlign: 'center',
  },
  heroCTABtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    borderRadius: Radius.xxl,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xl,
    marginTop: Spacing.sm,
  },
  heroCTABtnText: {
    fontSize: Typography.size.sm,
    fontWeight: Typography.weight.extrabold,
  },

  sectionLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  sectionDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
  },
  sectionLabelText: {
    fontSize: 9,
    fontWeight: Typography.weight.extrabold,
    color: 'rgba(255,255,255,0.35)',
    letterSpacing: 0.8,
  },

  captureGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  captureCard: {
    width: '48%',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: Radius.xl,
    padding: Spacing.md,
    gap: Spacing.xs,
    borderWidth: 1,
  },
  captureIcon: {
    width: 36,
    height: 36,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  captureLabel: {
    fontSize: Typography.size.sm,
    fontWeight: Typography.weight.semibold,
    color: 'rgba(255,255,255,0.9)',
  },
  captureDesc: {
    fontSize: Typography.size.xs,
    color: 'rgba(255,255,255,0.4)',
    lineHeight: 16,
  },

  aiCard: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: Radius.xl,
    padding: Spacing.base,
    gap: Spacing.sm,
    borderWidth: 1,
  },
  aiRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
  },
  aiText: {
    flex: 1,
    fontSize: Typography.size.xs,
    color: 'rgba(255,255,255,0.55)',
    lineHeight: 17,
  },

  quickLinks: {
    gap: Spacing.sm,
  },
  quickLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: Radius.xl,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  quickLinkIcon: {
    width: 36,
    height: 36,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickLinkLabel: {
    flex: 1,
    fontSize: Typography.size.sm,
    fontWeight: Typography.weight.semibold,
    color: 'rgba(255,255,255,0.8)',
  },
});
