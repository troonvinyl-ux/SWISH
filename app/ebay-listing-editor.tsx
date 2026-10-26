// SWISH — eBay Listing Editor
// Full listing editor screen for any eBay listing in the database.
// Supports all editable fields: title, description, price, shipping,
// category, condition, item specifics, photos, type, duration.
// Saves changes locally then offers 'Revise on eBay' via Trading API.
//
// v2: Live eBay Taxonomy category browser (drilldown + search)
//     Numista-based category auto-suggestion when verified match exists

import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  TextInput, ActivityIndicator, KeyboardAvoidingView,
  Platform, Modal, Alert,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { ItemImage } from '@/components';
import { getSupabaseClient } from '@/template';
import { Colors, Typography, Spacing, Radius, Shadow } from '@/constants/theme';
import { useApp } from '@/hooks/useApp';
import { useAlert } from '@/template';
import { FunctionsHttpError } from '@supabase/supabase-js';

// ── Types ─────────────────────────────────────────────────────────────────────

type ListingType = 'FixedPriceItem' | 'Chinese';
type AuctionDays = 3 | 5 | 7 | 10;

interface ItemSpecific {
  id: string;
  name: string;
  value: string;
}

interface ListingEditorData {
  // SWISH listing fields
  listingId: string;
  itemId: string;
  externalListingId?: string;
  status: string;

  // Editable fields
  title: string;
  subtitle: string;
  description: string;
  price: string;
  shippingCost: string;
  quantity: string;
  sku: string;
  categoryId: string;
  categoryName: string;
  condition: string;
  conditionDescription: string;
  listingType: ListingType;
  auctionDays: AuctionDays;
  startPrice: string;
  reservePrice: string;
  bestOfferEnabled: boolean;
  bestOfferMinPrice: string;
  dispatchDays: string;
  floorPrice: string;
  ceilingPrice: string;

  // Item specifics
  itemSpecifics: ItemSpecific[];

  // Media
  media: string[];

  // Source/SWISH intelligence
  itemTitle: string;
  itemCondition: string;
  itemValuationMid: number;
  specialistId: string;
  inventoryId?: string;
  attributes: Record<string, any>;

  // Internal: Numista-based category suggestion
  _numistaSuggestedCat?: { id: string; name: string };
}

// ── Numista → eBay leaf category mapping ─────────────────────────────────────
// Maps Numista data / specialist IDs to known eBay UK leaf categories.
// Used to auto-suggest the correct category when a Numista match is verified.

const NUMISTA_TO_EBAY_CATEGORY: Record<string, { id: string; name: string }> = {
  // These are final EBAY_GB leaf categories, not parent categories.
  coins_uk:                 { id: '79964', name: 'Other British Coins' },
  coins_currency:           { id: '79964', name: 'Other British Coins' },
  coins_world:              { id: '257',   name: 'Other World Coins' },
  stamps:                   { id: '261',   name: 'Great Britain Stamps' },
  pokemon:                  { id: '183454', name: 'CCG Individual Cards' },
  trading_cards:            { id: '183454', name: 'CCG Individual Cards' },
  watches:                  { id: '14324',  name: 'Wristwatches' },
  jewellery_gold_silver:    { id: '50',     name: 'Fine Jewellery' },

  // Specific ancient coin periods first; a date-free "Roman Imperial" must be browsed.
  'roman imperial 235': { id: '122472', name: 'Roman Imperial Coins (235–476 AD)' },
  'roman imperial 96':  { id: '3365',   name: 'Roman Imperial Coins (96–235 AD)' },
  'roman imperial 27':  { id: '122471', name: 'Roman Imperial Coins (27 BC–96 AD)' },
  'roman provincial':   { id: '4735',   name: 'Roman Provincial Coins' },
  'roman republican':   { id: '4734',   name: 'Roman Republican Coins' },
  'roman republic':     { id: '4734',   name: 'Roman Republican Coins' },
  byzantine:            { id: '3364',   name: 'Byzantine Coins' },
  greek:                { id: '4738',   name: 'Ancient Greek Coins' },
  chinese:              { id: '4740',   name: 'Ancient Chinese Coins' },

  // Islamic coins must win over broader geographic/period words in the title.
  abbasid:              { id: '4730',   name: 'Islamic Coins' },
  umayyad:              { id: '4730',   name: 'Islamic Coins' },
  fatimid:              { id: '4730',   name: 'Islamic Coins' },
  ilkhanid:             { id: '4730',   name: 'Islamic Coins' },
  islamic:              { id: '4730',   name: 'Islamic Coins' },
  dirham:               { id: '4730',   name: 'Islamic Coins' },
  dinar:                { id: '4730',   name: 'Islamic Coins' },
  mughal:               { id: '4737',   name: 'Ancient Persian & Indian Coins' },
  persian:              { id: '4737',   name: 'Ancient Persian & Indian Coins' },
  indian:               { id: '4737',   name: 'Ancient Persian & Indian Coins' },
  rupee:                { id: '4737',   name: 'Ancient Persian & Indian Coins' },

  // Specific British periods use the final child categories, never parent nodes.
  celtic:               { id: '122475', name: 'Celtic Coins (c.100 BC–c.100 AD)' },
  'anglo saxon':        { id: '58523',  name: 'Anglo-Saxon Coins (c.600–1066)' },
  norman:               { id: '122476', name: 'Norman Coins (1066–1154)' },
  'later medieval':     { id: '47389',  name: 'Later Medieval British Coins' },
  medieval:             { id: '47389',  name: 'Later Medieval British Coins' },
  tudor:                { id: '58524',  name: 'Tudor Coins (1485–1603)' },
  stuart:               { id: '122477', name: 'Stuart & Commonwealth Coins' },
  hammered:             { id: '58522',  name: 'Other British Hammered Coins' },
  'two pounds':         { id: '122488', name: 'British Two Pound Coins' },
  'two pound':          { id: '122488', name: 'British Two Pound Coins' },
  '50p':                { id: '122486', name: 'British 50p Coins' },
  'one pound':          { id: '122487', name: 'British One Pound Coins' },
  decimal:              { id: '3407',   name: 'Other British Decimal Coinage' },
  // Generic ancient coins require a live taxonomy selection; do not guess a category ID.
}

function getNumistaSuggestedCategory(attrs: Record<string, any>, specialistId: string): { id: string; name: string } | null {
  const COIN_SPECIALISTS = new Set([
    'coins', 'coins_uk', 'coins_currency', 'coins_world', 'islamic_silver',
    'gold', 'silver',
  ]);
  if (!COIN_SPECIALISTS.has(specialistId)) return NUMISTA_TO_EBAY_CATEGORY[specialistId] ?? null;

  const normalize = (value: unknown) => String(value ?? '')
    .toLowerCase()
    .replace(/[()[\],.\-–—]/g, ' ')
    .replace(/\bcoins?\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const numistaCategory = normalize(attrs['numista_category']);
  const title = normalize(attrs['canonical_title']);
  // Explicit order matters: specific subtype and period rules precede broad
  // geography/era labels. Generic Roman Imperial has no guessed default because
  // eBay UK has three separate time-period leaves.
  const priority = [
    'roman imperial 235', 'roman imperial 96', 'roman imperial 27',
    'roman provincial', 'roman republican', 'roman republic',
    'byzantine', 'greek', 'chinese',
    'abbasid', 'umayyad', 'fatimid', 'ilkhanid', 'islamic', 'dirham', 'dinar',
    'mughal', 'persian', 'indian', 'rupee',
    'celtic', 'anglo saxon', 'norman', 'later medieval', 'tudor', 'stuart',
    'hammered', 'two pounds', 'two pound', '50p', 'one pound', 'decimal', 'ancient',
  ];

  for (const value of [numistaCategory, title]) {
    if (!value) continue;
    for (const keyword of priority) {
      if (value.includes(keyword)) return NUMISTA_TO_EBAY_CATEGORY[keyword] ?? null;
    }
  }

  if (specialistId === 'coins_uk' || specialistId === 'coins_currency') {
    return NUMISTA_TO_EBAY_CATEGORY[specialistId];
  }
  if (specialistId === 'coins_world') return NUMISTA_TO_EBAY_CATEGORY.coins_world;
  if (specialistId === 'islamic_silver') return NUMISTA_TO_EBAY_CATEGORY.islamic;
  return null;
}

// ── eBay Category static fallback list ───────────────────────────────────────

// eBay UK Trading-API-verified leaf categories — universal, niche-spanning list
// Add categories relevant to all SWISH niches: coins, MX, bicycles, clothing etc.
const EBAY_CATEGORIES = [
  // Offline EBAY_GB starter options only. Every selected ID is revalidated against live
  // eBay Taxonomy at publish time; these labels never override the live category response.
  // EBAY_GB coin leaf categories from eBay UK's published hierarchy.
  { id: '4738', name: 'Ancient Greek Coins' },
  { id: '122471', name: 'Roman Imperial Coins (27 BC–96 AD)' },
  { id: '3365', name: 'Roman Imperial Coins (96–235 AD)' },
  { id: '122472', name: 'Roman Imperial Coins (235–476 AD)' },
  { id: '4734', name: 'Roman Republican Coins' },
  { id: '4735', name: 'Roman Provincial Coins' },
  { id: '3364', name: 'Byzantine Coins' },
  { id: '4740', name: 'Ancient Chinese Coins' },
  { id: '4730', name: 'Islamic Coins' },
  { id: '4737', name: 'Ancient Persian & Indian Coins' },
  { id: '93500', name: 'Ancient Coin Collections & Bulk Lots' },
  { id: '122475', name: 'Celtic Coins (c.100 BC–c.100 AD)' },
  { id: '58523', name: 'Anglo-Saxon Coins (c.600–1066)' },
  { id: '122476', name: 'Norman Coins (1066–1154)' },
  { id: '47389', name: 'Later Medieval British Coins' },
  { id: '58524', name: 'Tudor Coins (1485–1603)' },
  { id: '122477', name: 'Stuart & Commonwealth Coins' },
  { id: '58522', name: 'Other British Hammered Coins' },
  { id: '122486', name: 'British 50p Coins' },
  { id: '122487', name: 'British One Pound Coins' },
  { id: '122488', name: 'British Two Pound Coins' },
  { id: '3407', name: 'Other British Decimal Coinage' },
  { id: '93508', name: 'British Coin Collections & Bulk Lots' },
  { id: '79964', name: 'Other British Coins' },
  { id: '539', name: 'French Coins' },
  { id: '540', name: 'German Coins' },
  { id: '45152', name: 'Greek Modern Coins' },
  { id: '93509', name: 'European Coin Collections & Bulk Lots' },
  { id: '93510', name: 'World Coin Collections & Bulk Lots' },
  { id: '257', name: 'Other World Coins' },
  { id: '177652', name: 'Gold Bullion Coins' },
  { id: '177653', name: 'Silver Bullion Coins' },
  { id: '47188', name: 'Tokens, Medals & Badges' },
  { id: '620', name: 'Exonumia' },
  { id: '10968', name: 'Notgeld & Emergency Currency' },
  { id: '6071', name: 'Other British Banknotes' },
  { id: '385', name: 'Other World Banknotes' },
  { id: '261', name: 'Great Britain Stamps' },
  { id: '183454', name: 'Trading Cards / CCG' },
  { id: '20091', name: 'Antique Furniture' },
  { id: '870', name: 'Ceramics & Pottery' },
  { id: '261186', name: 'Rare & Antiquarian Books' },
  { id: '50', name: 'Fine Jewellery' },
  { id: '14324', name: 'Wristwatches' },
  { id: '14325', name: 'Pocket Watches' },
  { id: '79183', name: 'Motocross / Off-Road Bikes' },
  { id: '10767', name: 'Motocross Bikes' },
  { id: '10768', name: 'Enduro Bikes' },
  { id: '47002', name: 'Pit Bikes & Minimoto' },
  { id: '10750', name: 'Motorcycle Accessories' },
  { id: '50434', name: 'Motorcycle Clothing, Helmets & Protection' },
  { id: '26455', name: 'Motorcycle Engines & Engine Parts' },
  { id: '26459', name: 'Motorcycle Frame & Chassis' },
  { id: '26456', name: 'Motorcycle Suspension & Steering' },
  { id: '26457', name: 'Motorcycle Wheels & Tyres' },
  { id: '50370', name: 'Motorcycle Exhausts' },
  { id: '26460', name: 'Motorcycle Bodywork & Fairings' },
  { id: '25634', name: 'Motorcycle Brakes' },
  { id: '25633', name: 'Motorcycle Electrical' },
  { id: '177831', name: 'Complete Mountain Bikes' },
  { id: '56197', name: 'Complete Road Bikes' },
  { id: '177832', name: 'Electric Bikes' },
  { id: '48647', name: 'BMX Bikes' },
  { id: '56199', name: 'Hybrid & City Bikes' },
  { id: '56198', name: 'Folding Bikes' },
  { id: '15279', name: 'Bicycle Frames' },
  { id: '15274', name: 'Bicycle Wheels' },
  { id: '15278', name: 'Bicycle Brakes' },
  { id: '15272', name: 'Bicycle Gears & Derailleurs' },
  { id: '46060', name: 'Bicycle Saddles & Seat Posts' },
  { id: '56203', name: 'Bicycle Handlebars, Stems & Headsets' },
  { id: '56200', name: 'Cycle Computers' },
  { id: '15275', name: 'Bicycle Tyres & Tubes' },
  { id: '152506', name: 'Trainers & Athletic Shoes' },
  { id: '175748', name: 'Vintage & Rare Clothing' },
  { id: '50995', name: 'Hoodies & Sweatshirts' },
  { id: '3002', name: 'T-Shirts' },
  { id: '57988', name: 'Jeans' },
  { id: '14890', name: 'Dresses' },
  { id: '63848', name: 'Jackets & Coats' },
  { id: '172131', name: 'Sportswear' },
  { id: '169741', name: 'Activewear' },
];

// Hint shown in the static fallback
const STATIC_FALLBACK_NOTE = 'Live eBay API unavailable — showing fallback list with medal categories. Tap “Retry Live” when connected to browse the full category tree and verify leaf IDs.';

const CONDITION_OPTIONS = [
  { value: 'New',        id: '1000' },
  { value: 'Like New',   id: '1500' },
  { value: 'Excellent',  id: '2500' },
  { value: 'Very Good',  id: '3000' },
  { value: 'Good',       id: '4000' },
  { value: 'Acceptable', id: '5000' },
];

const DISPATCH_DAYS_OPTIONS = [1, 2, 3, 5, 7];

// ── Section Header ─────────────────────────────────────────────────────────────

function SectionHeader({ icon, title, badge }: { icon: string; title: string; badge?: string }) {
  return (
    <View style={sec.row}>
      <View style={sec.iconWrap}>
        <MaterialIcons name={icon as any} size={14} color={Colors.primary} />
      </View>
      <Text style={sec.title}>{title}</Text>
      {badge ? (
        <View style={sec.badge}>
          <Text style={sec.badgeText}>{badge}</Text>
        </View>
      ) : null}
    </View>
  );
}

const sec = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingBottom: 2 },
  iconWrap: {
    width: 26, height: 26, borderRadius: Radius.sm,
    backgroundColor: Colors.primaryDim, alignItems: 'center', justifyContent: 'center',
  },
  title: { flex: 1, fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  badge: {
    backgroundColor: Colors.primaryDim, borderRadius: Radius.pill,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  badgeText: { fontSize: 9, fontWeight: Typography.weight.bold, color: Colors.primary },
});

// ── Field Label ────────────────────────────────────────────────────────────────

function FieldLabel({ label, hint, required }: { label: string; hint?: string; required?: boolean }) {
  return (
    <View style={{ gap: 1 }}>
      <Text style={fl.label}>
        {label}
        {required ? <Text style={fl.req}> *</Text> : null}
      </Text>
      {hint ? <Text style={fl.hint}>{hint}</Text> : null}
    </View>
  );
}

const fl = StyleSheet.create({
  label: { fontSize: 10, fontWeight: Typography.weight.bold, color: Colors.textTertiary, letterSpacing: 0.5 },
  hint: { fontSize: 10, color: Colors.textTertiary + 'CC', lineHeight: 13 },
  req: { color: Colors.danger },
});

// ── Category Picker Modal — Live eBay Taxonomy Browser ────────────────────────
// Drills into eBay UK category tree via the Taxonomy API (get_category_children route).
// Falls back to static curated list if eBay API is unavailable.

type LiveCat = { id: string; name: string; isLeaf: boolean; childCount: number };
type BreadcrumbItem = { id: string; name: string };

function CategoryPickerModal({
  visible,
  current,
  onSelect,
  onClose,
  tenantId,
  numistaSuggestion,
}: {
  visible: boolean;
  current: string;
  onSelect: (id: string, name: string) => void;
  onClose: () => void;
  tenantId?: string;
  numistaSuggestion?: { id: string; name: string } | null;
}) {
  const supabase = getSupabaseClient();
  const [customId, setCustomId] = useState('');
  const [search, setSearch] = useState('');
  const [liveCategories, setLiveCategories] = useState<LiveCat[]>([]);
  const [liveLoading, setLiveLoading] = useState(false);
  const [mode, setMode] = useState<'live' | 'static'>('live');
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbItem[]>([]);
  const [curatedSource, setCuratedSource] = useState(false);

  const loadLiveCategories = useCallback(async (parentId: string) => {
    if (!tenantId) { setMode('static'); return; }
    setLiveLoading(true);
    try {
      // Try the dedicated category function, then fall back on transport
      // errors and HTTP-200 error payloads (supabase.functions.invoke does not throw).
      let data: any = null;
      let error: any = null;
      try {
        const primary = await supabase.functions.invoke('swish-ebay-category', {
          body: { route: 'get_category_children', tenantId, parentId },
        });
        data = primary.data;
        error = primary.error;
      } catch (e: any) {
        error = e;
      }

      if (error || !data?.success || data?.source === 'curated' || data?.source === 'curated_verified') {
        try {
          const fallback = await supabase.functions.invoke('swish-ebay-list', {
            body: { route: 'get_category_children', tenantId, parentId },
          });
          if (!fallback.error && fallback.data?.success) {
            data = fallback.data;
            error = null;
          } else {
            error = fallback.error ?? error;
            if (fallback.data) data = fallback.data;
          }
        } catch (e: any) {
          error = error ?? e;
        }
      }
      if (error) {
        // FunctionsHttpError carries the actual response body — extract it
        let errMsg = 'eBay category API unavailable.';
        if (error instanceof FunctionsHttpError) {
          try {
            const txt = await error.context?.text();
            const parsed = txt ? JSON.parse(txt) : null;
            errMsg = parsed?.error ?? parsed?.message ?? txt ?? error.message;
          } catch {
            errMsg = error.message;
          }
        } else {
          errMsg = (error as any)?.message ?? errMsg;
        }
        console.log('[SWISH CategoryPicker] invoke error:', errMsg);
        setMode('static');
      } else if (!data?.success) {
        console.log('[SWISH CategoryPicker] success=false:', data?.error);
        // scopeError means we can try search instead of full fallback
        if (data?.scopeError) {
          setMode('static');
        } else {
          setMode('static');
        }
      } else {
        setLiveCategories(data.children ?? []);
        setMode('live');
        // curated/curated_verified = pre-verified list served when taxonomy scope not granted
        const isCurated = data.source === 'curated' || data.source === 'curated_verified';
        setCuratedSource(isCurated);
        if (isCurated) {
          console.log('[SWISH CategoryPicker] curated list received from edge function');
        }
      }
    } catch (e: any) {
      console.log('[SWISH CategoryPicker] fetch error:', e?.message);
      setMode('static');
    } finally {
      setLiveLoading(false);
    }
  }, [tenantId, supabase]);

  useEffect(() => {
    if (visible) {
      setBreadcrumbs([]);
      setSearch('');
      setCustomId('');
      setCuratedSource(false);
      loadLiveCategories('');
    }
  }, [visible]);

  const handleDrillDown = useCallback((cat: LiveCat) => {
    if (cat.isLeaf) {
      onSelect(cat.id, cat.name);
      onClose();
      return;
    }
    // Parent category — browse into it (user can select it directly from header)
    setBreadcrumbs(prev => [...prev, { id: cat.id, name: cat.name }]);
    setSearch('');
    loadLiveCategories(cat.id);
  }, [loadLiveCategories, onSelect, onClose]);

  // Allow selecting the current browse level (parent category like "Asia")
  // eBay accepts parent categories such as 534 (Asia), 4 (World Coins), etc.
  const handleSelectCurrentLevel = useCallback(() => {
    if (breadcrumbs.length === 0) return;
    const current = breadcrumbs[breadcrumbs.length - 1];
    onSelect(current.id, current.name);
    onClose();
  }, [breadcrumbs, onSelect, onClose]);

  const handleBack = useCallback(() => {
    const newCrumbs = breadcrumbs.slice(0, -1);
    setBreadcrumbs(newCrumbs);
    setSearch('');
    loadLiveCategories(newCrumbs.length > 0 ? newCrumbs[newCrumbs.length - 1].id : '');
  }, [breadcrumbs, loadLiveCategories]);

  const handleBreadcrumbNav = useCallback((index: number) => {
    if (index < 0) {
      setBreadcrumbs([]);
      loadLiveCategories('');
    } else {
      const newCrumbs = breadcrumbs.slice(0, index + 1);
      setBreadcrumbs(newCrumbs);
      loadLiveCategories(newCrumbs[newCrumbs.length - 1].id);
    }
    setSearch('');
  }, [breadcrumbs, loadLiveCategories]);

  const liveFiltered = search.trim().length > 0
    ? liveCategories.filter(c =>
        c.name.toLowerCase().includes(search.toLowerCase()) ||
        c.id.includes(search.trim())
      )
    : liveCategories;

  const staticFiltered = search.trim().length > 0
    ? EBAY_CATEGORIES.filter(c =>
        c.name.toLowerCase().includes(search.toLowerCase()) ||
        c.id.includes(search.trim())
      )
    : EBAY_CATEGORIES;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <View style={{ flex: 1, backgroundColor: Colors.background }}>

        {/* Header */}
        <View style={cp.header}>
          <Pressable onPress={onClose} style={cp.closeBtn} hitSlop={8}>
            <MaterialIcons name="close" size={18} color={Colors.textSecondary} />
          </Pressable>
          <Text style={cp.title}>eBay Category</Text>
          {mode === 'live' ? (
            curatedSource ? (
              <View style={[cp.liveBadge, { backgroundColor: Colors.infoDim ?? (Colors.info + '15') }]}>
                <MaterialIcons name="verified" size={10} color={Colors.info} />
                <Text style={[cp.liveBadgeText, { color: Colors.info }]}>Curated EBAY_GB</Text>
              </View>
            ) : (
              <View style={cp.liveBadge}>
                <View style={cp.liveDot} />
                <Text style={cp.liveBadgeText}>Live API</Text>
              </View>
            )
          ) : (
            <Pressable onPress={() => { setBreadcrumbs([]); loadLiveCategories(''); }} style={cp.retryBtn}>
              <MaterialIcons name="refresh" size={12} color={Colors.info} />
              <Text style={cp.retryBtnText}>Retry Live</Text>
            </Pressable>
          )}
        </View>

        {/* Numista suggestion banner */}
        {numistaSuggestion ? (
          <Pressable
            onPress={() => { onSelect(numistaSuggestion.id, numistaSuggestion.name); onClose(); }}
            style={cp.numistaBanner}
          >
            <MaterialIcons name="verified" size={14} color={Colors.success} />
            <View style={{ flex: 1 }}>
              <Text style={cp.numistaBannerTitle}>Numista Suggested</Text>
              <Text style={cp.numistaBannerSub}>{numistaSuggestion.name} · ID {numistaSuggestion.id}</Text>
            </View>
            <View style={cp.numistaBannerUse}>
              <Text style={cp.numistaBannerUseText}>Use</Text>
            </View>
          </Pressable>
        ) : null}

        {/* Breadcrumbs */}
        {breadcrumbs.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ maxHeight: 38 }}
            contentContainerStyle={cp.breadcrumbContent}
          >
            <Pressable onPress={() => handleBreadcrumbNav(-1)} style={cp.breadcrumbItem}>
              <MaterialIcons name="home" size={11} color={Colors.primary} />
            </Pressable>
            {breadcrumbs.map((crumb, idx) => (
              <React.Fragment key={crumb.id}>
                <MaterialIcons name="chevron-right" size={12} color={Colors.textTertiary} />
                <Pressable
                  onPress={() => handleBreadcrumbNav(idx)}
                  style={[cp.breadcrumbItem, idx === breadcrumbs.length - 1 && cp.breadcrumbItemActive]}
                >
                  <Text style={[cp.breadcrumbText, idx === breadcrumbs.length - 1 && { color: Colors.primary }]}
                    numberOfLines={1}>{crumb.name}</Text>
                </Pressable>
              </React.Fragment>
            ))}
          </ScrollView>
        ) : null}

        {/* Search bar */}
        <View style={cp.searchWrap}>
          <MaterialIcons name="search" size={16} color={Colors.textTertiary} />
          <TextInput
            style={cp.searchInput}
            value={search}
            onChangeText={setSearch}
            placeholder="Search e.g. Victorian, Ancient, Coin..."
            placeholderTextColor={Colors.textTertiary}
            clearButtonMode="while-editing"
            autoCorrect={false}
          />
          {search.length > 0 ? (
            <Pressable onPress={() => setSearch('')} hitSlop={8}>
              <MaterialIcons name="cancel" size={16} color={Colors.textTertiary} />
            </Pressable>
          ) : null}
        </View>

        {/* Back row + Select This Category button */}
        {breadcrumbs.length > 0 ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.base, paddingVertical: Spacing.xs, gap: Spacing.sm }}>
            <Pressable onPress={handleBack} style={[cp.backRow, { flex: 1, margin: 0, padding: 0 }]}>
              <MaterialIcons name="arrow-back" size={15} color={Colors.primary} />
              <Text style={cp.backRowText}>
                Back to {breadcrumbs.length > 1 ? breadcrumbs[breadcrumbs.length - 2].name : 'Root'}
              </Text>
            </Pressable>
            <Pressable onPress={handleSelectCurrentLevel} style={cp.selectCurrentBtn}>
              <MaterialIcons name="sell" size={11} color={Colors.background} />
              <Text style={cp.selectCurrentBtnText}>Use &quot;{breadcrumbs[breadcrumbs.length - 1].name}&quot;</Text>
            </Pressable>
          </View>
        ) : null}

        <ScrollView
          contentContainerStyle={{ paddingHorizontal: Spacing.base, paddingVertical: Spacing.md, gap: Spacing.xs }}
          showsVerticalScrollIndicator={false}
        >

          {/* Loading */}
          {liveLoading ? (
            <View style={cp.loadingRow}>
              <ActivityIndicator size="small" color={Colors.primary} />
              <Text style={cp.loadingText}>Loading eBay categories...</Text>
            </View>
          ) : null}

          {/* Live categories */}
          {mode === 'live' && !liveLoading ? (
            liveFiltered.length === 0 ? (
              <View style={cp.noResults}>
                <MaterialIcons name="search-off" size={22} color={Colors.textTertiary} />
                <Text style={cp.noResultsText}>
                  {search ? `No categories match "${search}"` : 'No sub-categories found'}
                </Text>
              </View>
            ) : liveFiltered.map(cat => (
              <Pressable
                key={cat.id}
                onPress={() => handleDrillDown(cat)}
                style={[cp.row, current === cat.id && cp.rowActive]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[cp.name, current === cat.id && { color: Colors.primary }]}>{cat.name}</Text>
                  <Text style={cp.id}>
                    ID: {cat.id} · {cat.isLeaf ? '✓ Leaf — select this' : `${cat.childCount} sub-categories`}
                  </Text>
                </View>
                {current === cat.id ? (
                  <MaterialIcons name="check-circle" size={18} color={Colors.primary} />
                ) : cat.isLeaf ? (
                  <MaterialIcons name="sell" size={15} color={Colors.success} />
                ) : (
                  <MaterialIcons name="chevron-right" size={18} color={Colors.textTertiary} />
                )}
              </Pressable>
            ))
          ) : null}

          {/* Static fallback */}
          {mode === 'static' && !liveLoading ? (
            <>
              <View style={cp.staticNote}>
                <MaterialIcons name="info-outline" size={12} color={Colors.info} />
                <Text style={cp.staticNoteText}>{STATIC_FALLBACK_NOTE}</Text>
              </View>
              {staticFiltered.length === 0 ? (
                <View style={cp.noResults}>
                  <MaterialIcons name="search-off" size={22} color={Colors.textTertiary} />
                  <Text style={cp.noResultsText}>No categories match &quot;{search}&quot;</Text>
                </View>
              ) : null}
              {staticFiltered.map(cat => (
                <Pressable
                  key={cat.id}
                  onPress={() => { onSelect(cat.id, cat.name); onClose(); }}
                  style={[cp.row, current === cat.id && cp.rowActive]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[cp.name, current === cat.id && { color: Colors.primary }]}>{cat.name}</Text>
                    <Text style={cp.id}>Category ID: {cat.id}</Text>
                  </View>
                  {current === cat.id ? (
                    <MaterialIcons name="check-circle" size={18} color={Colors.primary} />
                  ) : null}
                </Pressable>
              ))}
            </>
          ) : null}

          {/* Custom ID input */}
          <View style={cp.customSection}>
            <Text style={cp.customLabel}>CUSTOM CATEGORY ID</Text>
            <View style={cp.customRow}>
              <TextInput
                style={cp.customInput}
                value={customId}
                onChangeText={setCustomId}
                keyboardType="number-pad"
                placeholder="e.g. 4738"
                placeholderTextColor={Colors.textTertiary}
              />
              <Pressable
                onPress={() => {
                  if (customId.trim()) {
                    onSelect(customId.trim(), `Custom (${customId.trim()})`);
                    onClose();
                  }
                }}
                style={cp.customBtn}
              >
                <Text style={cp.customBtnText}>Use</Text>
              </Pressable>
            </View>
            <Text style={cp.customHint}>
              Live categories from eBay Taxonomy API · leaf categories marked ✓
            </Text>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const cp = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingHorizontal: Spacing.base, paddingTop: Spacing.lg, paddingBottom: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder,
  },
  closeBtn: {
    width: 32, height: 32, borderRadius: Radius.md,
    backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.surfaceBorder,
  },
  title: { flex: 1, fontSize: Typography.size.md, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  liveBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.successDim, borderRadius: Radius.pill, paddingHorizontal: 8, paddingVertical: 3,
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.success },
  liveBadgeText: { fontSize: 9, fontWeight: Typography.weight.bold, color: Colors.success },
  retryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.infoDim, borderRadius: Radius.pill, paddingHorizontal: 8, paddingVertical: 3,
  },
  retryBtnText: { fontSize: 9, color: Colors.info, fontWeight: Typography.weight.semibold },
  numistaBanner: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    marginHorizontal: Spacing.base, marginTop: Spacing.sm,
    backgroundColor: Colors.successDim, borderRadius: Radius.lg, padding: Spacing.md,
    borderWidth: 1, borderColor: Colors.success + '40',
  },
  numistaBannerTitle: { fontSize: Typography.size.xs, fontWeight: Typography.weight.bold, color: Colors.success },
  numistaBannerSub: { fontSize: 10, color: Colors.textSecondary, marginTop: 1 },
  numistaBannerUse: {
    backgroundColor: Colors.success, borderRadius: Radius.sm,
    paddingHorizontal: Spacing.sm, paddingVertical: 4,
  },
  numistaBannerUseText: { fontSize: 10, fontWeight: Typography.weight.bold, color: Colors.background },
  breadcrumbContent: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: Spacing.base, paddingVertical: Spacing.xs,
  },
  breadcrumbItem: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.pill,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  breadcrumbItemActive: { backgroundColor: Colors.primaryDim },
  breadcrumbText: {
    fontSize: 10, color: Colors.primary, fontWeight: Typography.weight.medium, maxWidth: 100,
  },
  backRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.xs,
    paddingHorizontal: Spacing.base, paddingVertical: Spacing.xs,
  },
  backRowText: { fontSize: Typography.size.xs, color: Colors.primary, fontWeight: Typography.weight.semibold },
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    marginHorizontal: Spacing.base, marginTop: Spacing.sm, marginBottom: Spacing.xs,
    backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.surfaceBorder,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
  },
  searchInput: {
    flex: 1, fontSize: Typography.size.sm, color: Colors.textPrimary,
    includeFontPadding: false, paddingVertical: 0,
  },
  loadingRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    justifyContent: 'center', paddingVertical: Spacing.xl,
  },
  loadingText: { fontSize: Typography.size.sm, color: Colors.textTertiary },
  staticNote: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: Colors.infoDim, borderRadius: Radius.sm, padding: Spacing.sm,
    marginBottom: Spacing.xs,
  },
  staticNoteText: { fontSize: 10, color: Colors.info },
  noResults: { alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.xl },
  noResultsText: { fontSize: Typography.size.sm, color: Colors.textTertiary, textAlign: 'center' },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    padding: Spacing.md, borderRadius: Radius.xl,
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.surfaceBorder,
    marginBottom: Spacing.xs,
  },
  rowActive: { borderColor: Colors.primary, backgroundColor: Colors.primaryDim },
  name: { fontSize: Typography.size.sm, color: Colors.textPrimary, fontWeight: Typography.weight.medium },
  id: { fontSize: 10, color: Colors.textTertiary, marginTop: 2 },
  customSection: { marginTop: Spacing.md, gap: 6 },
  customLabel: { fontSize: 9, fontWeight: Typography.weight.bold, color: Colors.textTertiary, letterSpacing: 0.5 },
  customRow: { flexDirection: 'row', gap: Spacing.sm },
  customInput: {
    flex: 1, backgroundColor: Colors.surface, borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.surfaceBorder,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    fontSize: Typography.size.sm, color: Colors.textPrimary, includeFontPadding: false,
  },
  customBtn: {
    backgroundColor: Colors.primary, borderRadius: Radius.md,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    alignItems: 'center', justifyContent: 'center',
  },
  customBtnText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.background },
  customHint: { fontSize: 10, color: Colors.textTertiary, lineHeight: 14 },
  selectCurrentBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.primary, borderRadius: Radius.pill,
    paddingHorizontal: Spacing.sm, paddingVertical: 5, flexShrink: 0,
  },
  selectCurrentBtnText: { fontSize: 9, fontWeight: Typography.weight.bold, color: Colors.background },
});

// ── AI Category Suggestion Modal ────────────────────────────────────────────────
// Calls swish-ebay-list get_category_suggestions route with listing title as keyword.
// Displays top 5 suggested eBay leaf categories with IDs and confidence.

interface AICatSuggestion {
  id: string;
  name: string;
  confidence: string;
  isLeaf: boolean;
}

function AICategorySuggestModal({
  visible,
  title,
  tenantId,
  onSelect,
  onClose,
}: {
  visible: boolean;
  title: string;
  tenantId?: string;
  onSelect: (id: string, name: string) => void;
  onClose: () => void;
}) {
  const supabase = getSupabaseClient();
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<AICatSuggestion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState(title);
  const [searched, setSearched] = useState(false);

  const runSearch = useCallback(async (q: string) => {
    if (!tenantId || !q.trim()) return;
    setLoading(true);
    setError(null);
    setSuggestions([]);
    setSearched(false);
    try {
      // Try the dedicated taxonomy function, then fall back on both transport
      // errors and unsuccessful response bodies.
      let data: any = null;
      let fnErr: any = null;
      try {
        const primary = await supabase.functions.invoke('swish-ebay-category', {
          body: { route: 'get_category_suggestions', tenantId, query: q.trim().slice(0, 100) },
        });
        data = primary.data;
        fnErr = primary.error;
      } catch (e: any) {
        fnErr = e;
      }

      if (fnErr || !data?.success || data?.source === 'curated' || data?.source === 'curated_verified' || data?.source === 'curated_fallback' || data?.source === 'db_cache_offline') {
        try {
          const fallback = await supabase.functions.invoke('swish-ebay-list', {
            body: { route: 'get_category_suggestions', tenantId, query: q.trim().slice(0, 100) },
          });
          if (!fallback.error && fallback.data?.success) {
            data = fallback.data;
            fnErr = null;
          } else {
            fnErr = fallback.error ?? fnErr;
            if (fallback.data) data = fallback.data;
          }
        } catch (e: any) {
          fnErr = fnErr ?? e;
        }
      }
      if (fnErr) {
        let msg = fnErr.message;
        if (fnErr instanceof FunctionsHttpError) {
          try { const txt = await fnErr.context?.text(); const p = txt ? JSON.parse(txt) : null; msg = p?.error ?? txt ?? msg; } catch {}
        }
        // If route doesn't exist yet, fall back to browse children and filter
        if (msg.includes('404') || msg.includes('route') || msg.includes('not found')) {
          await runFallbackSearch(q);
        } else {
          setError(msg);
          setLoading(false);
          setSearched(true);
        }
        return;
      }

      // Handle both response formats:
      // { success: true, suggestions: [...] }  — if the route returns this format
      // { children: [...], success: true }      — if the route returns children format
      // { suggestions: [...] }                  — direct suggestions
      const rawSuggestions: AICatSuggestion[] =
        data?.suggestions ??
        (data?.children ?? []).filter((c: any) => c.isLeaf).map((c: any) => ({
          id: c.id, name: c.name, confidence: 'high', isLeaf: true,
        })) ?? [];

      if (data?.error && rawSuggestions.length === 0) {
        setError(data.error);
      } else if (rawSuggestions.length === 0) {
        setError('No matching eBay leaf categories found. Try a shorter or different keyword.');
      } else {
        setSuggestions(rawSuggestions.slice(0, 5));
      }
    } catch (e: any) {
      setError(e?.message ?? 'Request failed');
    } finally {
      setLoading(false);
      setSearched(true);
    }
  }, [tenantId, supabase]);

  // Fallback: use keyword search via get_category_children with query
  const runFallbackSearch = useCallback(async (q: string) => {
    try {
      const { data } = await supabase.functions.invoke('swish-ebay-list', {
        body: { route: 'get_category_children', tenantId, parentId: '', searchQuery: q.trim().slice(0, 60) },
      });
      const fallback: AICatSuggestion[] = (data?.children ?? []).filter((c: any) => c.isLeaf).map((c: any) => ({
        id: c.id, name: c.name, confidence: 'medium', isLeaf: true,
      })).slice(0, 5);
      if (fallback.length > 0) {
        setSuggestions(fallback);
      } else {
        setError('No matching eBay leaf categories found. Try the category browser above.');
      }
    } catch {
      setError('Category search unavailable. Use the category browser instead.');
    } finally {
      setLoading(false);
      setSearched(true);
    }
  }, [tenantId, supabase]);

  useEffect(() => {
    if (visible) {
      setQuery(title);
      setSuggestions([]);
      setError(null);
      setSearched(false);
      if (title.trim().length > 3) runSearch(title);
    }
  }, [visible]); // intentionally omit runSearch to only re-trigger on open

  const confidenceColor = (c: string) =>
    c === 'high' ? Colors.success : c === 'medium' ? Colors.warning : Colors.textTertiary;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: Colors.background }}>
        {/* Header */}
        <View style={acs.header}>
          <Pressable onPress={onClose} style={acs.closeBtn} hitSlop={8}>
            <MaterialIcons name="close" size={18} color={Colors.textSecondary} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={acs.title}>AI Category Suggestion</Text>
            <Text style={acs.subtitle}>Top eBay leaf categories matched via Taxonomy API</Text>
          </View>
          <View style={acs.aiBadge}>
            <MaterialIcons name="auto-awesome" size={10} color={Colors.accent} />
            <Text style={acs.aiBadgeText}>Live API</Text>
          </View>
        </View>

        {/* Search bar */}
        <View style={acs.searchWrap}>
          <MaterialIcons name="search" size={16} color={Colors.textTertiary} />
          <TextInput
            style={acs.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Enter listing title or keyword..."
            placeholderTextColor={Colors.textTertiary}
            returnKeyType="search"
            onSubmitEditing={() => runSearch(query)}
          />
          <Pressable
            onPress={() => runSearch(query)}
            disabled={loading || !query.trim()}
            style={[acs.searchBtn, (!query.trim() || loading) && { opacity: 0.5 }]}
          >
            {loading
              ? <ActivityIndicator size="small" color={Colors.background} style={{ width: 14, height: 14 }} />
              : <MaterialIcons name="search" size={14} color={Colors.background} />}
          </Pressable>
        </View>

        <View style={acs.disclaimer}>
          <MaterialIcons name="info-outline" size={11} color={Colors.info} />
          <Text style={acs.disclaimerText}>
            Fetched live from eBay Taxonomy API. Only leaf categories (✓ Leaf) can be submitted. Tap any to select it.
          </Text>
        </View>

        <ScrollView contentContainerStyle={acs.listContent} showsVerticalScrollIndicator={false}>
          {loading ? (
            <View style={acs.loadingRow}>
              <ActivityIndicator size="large" color={Colors.primary} />
              <Text style={acs.loadingText}>Searching eBay Taxonomy...</Text>
            </View>
          ) : error ? (
            <View style={acs.errorCard}>
              <MaterialIcons name="warning" size={16} color={Colors.warning} />
              <Text style={acs.errorText}>{error}</Text>
            </View>
          ) : suggestions.length === 0 && searched ? (
            <View style={acs.emptyState}>
              <MaterialIcons name="search-off" size={28} color={Colors.textTertiary} />
              <Text style={acs.emptyText}>No leaf categories found. Try a different keyword above.</Text>
            </View>
          ) : (
            suggestions.map((cat, i) => (
              <Pressable
                key={cat.id}
                onPress={() => { onSelect(cat.id, cat.name); onClose(); }}
                style={({ pressed }) => [acs.catRow, pressed && { opacity: 0.75 }]}
              >
                <View style={acs.rankBadge}>
                  <Text style={acs.rankText}>{i + 1}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <View style={acs.catNameRow}>
                    <Text style={acs.catName} numberOfLines={2}>{cat.name}</Text>
                    {cat.isLeaf ? (
                      <View style={acs.leafBadge}>
                        <MaterialIcons name="sell" size={9} color={Colors.success} />
                        <Text style={acs.leafText}>✓ Leaf</Text>
                      </View>
                    ) : null}
                  </View>
                  <View style={acs.catMeta}>
                    <Text style={acs.catId}>ID: {cat.id}</Text>
                    <View style={[acs.confBadge, { backgroundColor: confidenceColor(cat.confidence) + '20' }]}>
                      <Text style={[acs.confText, { color: confidenceColor(cat.confidence) }]}>
                        {cat.confidence} match
                      </Text>
                    </View>
                  </View>
                </View>
                <MaterialIcons name="check-circle-outline" size={22} color={Colors.primary} />
              </Pressable>
            ))
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const acs = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingHorizontal: Spacing.base, paddingTop: Spacing.lg, paddingBottom: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder,
  },
  closeBtn: {
    width: 32, height: 32, borderRadius: Radius.md, backgroundColor: Colors.surface,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.surfaceBorder,
  },
  title: { fontSize: Typography.size.md, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  subtitle: { fontSize: 10, color: Colors.textTertiary, marginTop: 2 },
  aiBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: Colors.accentDim, borderRadius: Radius.pill,
    paddingHorizontal: 7, paddingVertical: 3, borderWidth: 1, borderColor: Colors.accent + '40',
  },
  aiBadgeText: { fontSize: 9, fontWeight: Typography.weight.bold, color: Colors.accent },
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    marginHorizontal: Spacing.base, marginTop: Spacing.md, marginBottom: Spacing.xs,
    backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.surfaceBorder,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs,
  },
  searchInput: { flex: 1, fontSize: Typography.size.sm, color: Colors.textPrimary, includeFontPadding: false, paddingVertical: 6 },
  searchBtn: {
    backgroundColor: Colors.primary, borderRadius: Radius.sm,
    paddingHorizontal: Spacing.sm, paddingVertical: 6,
    alignItems: 'center', justifyContent: 'center',
  },
  disclaimer: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 5,
    marginHorizontal: Spacing.base, marginBottom: Spacing.sm,
    backgroundColor: Colors.infoDim ?? (Colors.info + '15'), borderRadius: Radius.sm, padding: 7,
  },
  disclaimerText: { flex: 1, fontSize: 9, color: Colors.info, lineHeight: 13 },
  listContent: { paddingHorizontal: Spacing.base, paddingVertical: Spacing.md, gap: Spacing.sm, paddingBottom: 48 },
  loadingRow: { alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.xl },
  loadingText: { fontSize: Typography.size.sm, color: Colors.textTertiary },
  errorCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm,
    backgroundColor: Colors.warningDim, borderRadius: Radius.lg, padding: Spacing.md,
    borderWidth: 1, borderColor: Colors.warning + '40',
  },
  errorText: { flex: 1, fontSize: Typography.size.sm, color: Colors.warning, lineHeight: 18 },
  emptyState: { alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.xl },
  emptyText: { fontSize: Typography.size.sm, color: Colors.textTertiary, textAlign: 'center' },
  catRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.surface, borderRadius: Radius.xl, padding: Spacing.md,
    borderWidth: 1, borderColor: Colors.surfaceBorder,
  },
  rankBadge: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: Colors.primaryDim,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.primary + '40',
    flexShrink: 0,
  },
  rankText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.primary },
  catNameRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.xs, flexWrap: 'wrap', marginBottom: 3 },
  catName: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.textPrimary, flex: 1 },
  leafBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: Radius.pill,
    paddingHorizontal: 6, paddingVertical: 2,
    backgroundColor: Colors.success + '20', borderWidth: 1, borderColor: Colors.success + '50',
  },
  leafText: { fontSize: 9, fontWeight: Typography.weight.bold, color: Colors.success },
  catMeta: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  catId: { fontSize: 10, color: Colors.textTertiary },
  confBadge: { borderRadius: Radius.pill, paddingHorizontal: 6, paddingVertical: 2 },
  confText: { fontSize: 9, fontWeight: Typography.weight.semibold, textTransform: 'capitalize' },
});

// ── Item Specifics Editor ─────────────────────────────────────────────────────

const SPEC_CHAR_LIMIT = 65;

function SpecCharCount({ text }: { text: string }) {
  const len = text.length;
  const over = len > SPEC_CHAR_LIMIT;
  const near = len >= 55 && !over;
  if (len === 0) return null;
  return (
    <Text style={[
      ise.charCount,
      near && { color: Colors.warning },
      over && { color: Colors.danger },
    ]}>
      {over ? `eBay limit: ${SPEC_CHAR_LIMIT} chars` : `${len}/${SPEC_CHAR_LIMIT}`}
    </Text>
  );
}

function ItemSpecificsEditor({
  specifics,
  onChange,
}: {
  specifics: ItemSpecific[];
  onChange: (specs: ItemSpecific[]) => void;
}) {
  const add = () => {
    onChange([...specifics, { id: Date.now().toString(), name: '', value: '' }]);
  };

  const remove = (id: string) => {
    onChange(specifics.filter(s => s.id !== id));
  };

  const update = (id: string, field: 'name' | 'value', text: string) => {
    onChange(specifics.map(s => s.id === id ? { ...s, [field]: text } : s));
  };

  const overLimitCount = specifics.filter(
    s => s.name.length > SPEC_CHAR_LIMIT || s.value.length > SPEC_CHAR_LIMIT
  ).length;

  return (
    <View style={ise.container}>
      {overLimitCount > 0 ? (
        <View style={ise.overLimitBanner}>
          <MaterialIcons name="warning" size={13} color={Colors.danger} />
          <Text style={ise.overLimitText}>
            {overLimitCount} item specific{overLimitCount > 1 ? 's' : ''} exceed{overLimitCount === 1 ? 's' : ''} the 65-character eBay limit. Values will be auto-truncated on submit.
          </Text>
        </View>
      ) : null}

      {specifics.map(spec => {
        const nameOver = spec.name.length > SPEC_CHAR_LIMIT;
        const valueOver = spec.value.length > SPEC_CHAR_LIMIT;
        return (
          <View key={spec.id} style={ise.specBlock}>
            <View style={ise.row}>
              <View style={ise.nameWrap}>
                <TextInput
                  style={[ise.input, ise.nameInput, nameOver && ise.inputOver]}
                  value={spec.name}
                  onChangeText={t => update(spec.id, 'name', t)}
                  placeholder="Name"
                  placeholderTextColor={Colors.textTertiary}
                />
                <SpecCharCount text={spec.name} />
              </View>
              <View style={ise.valueWrap}>
                <TextInput
                  style={[ise.input, ise.valueInput, valueOver && ise.inputOver]}
                  value={spec.value}
                  onChangeText={t => update(spec.id, 'value', t)}
                  placeholder="Value"
                  placeholderTextColor={Colors.textTertiary}
                />
                <SpecCharCount text={spec.value} />
              </View>
              <Pressable onPress={() => remove(spec.id)} hitSlop={8} style={ise.removeBtn}>
                <MaterialIcons name="close" size={14} color={Colors.danger} />
              </Pressable>
            </View>
          </View>
        );
      })}
      <Pressable onPress={add} style={ise.addBtn}>
        <MaterialIcons name="add" size={14} color={Colors.primary} />
        <Text style={ise.addBtnText}>Add Item Specific</Text>
      </Pressable>
      <Text style={ise.hint}>Max 25 item specifics · 65 chars per name/value. eBay uses these for search filtering.</Text>
    </View>
  );
}

const ise = StyleSheet.create({
  container: { gap: Spacing.xs },
  overLimitBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 6,
    backgroundColor: Colors.dangerDim ?? (Colors.danger + '15'), borderRadius: Radius.md,
    padding: Spacing.sm, borderWidth: 1, borderColor: Colors.danger + '40',
  },
  overLimitText: { flex: 1, fontSize: 10, color: Colors.danger, lineHeight: 14 },
  specBlock: { gap: 0 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.xs },
  nameWrap: { width: 112, gap: 2 },
  valueWrap: { flex: 1, gap: 2 },
  input: {
    backgroundColor: Colors.surface, borderRadius: Radius.sm,
    borderWidth: 1, borderColor: Colors.surfaceBorder,
    paddingHorizontal: Spacing.sm, paddingVertical: 7,
    fontSize: Typography.size.xs, color: Colors.textPrimary, includeFontPadding: false,
  },
  inputOver: { borderColor: Colors.danger, backgroundColor: Colors.danger + '0D' },
  nameInput: { width: '100%' },
  valueInput: {},
  charCount: { fontSize: 9, color: Colors.textTertiary, textAlign: 'right', paddingRight: 2 },
  removeBtn: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center', marginTop: 5 },
  addBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingVertical: 7, paddingHorizontal: Spacing.sm,
    backgroundColor: Colors.primaryDim, borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.primary + '30',
    alignSelf: 'flex-start',
  },
  addBtnText: { fontSize: Typography.size.xs, color: Colors.primary, fontWeight: Typography.weight.semibold },
  hint: { fontSize: 10, color: Colors.textTertiary, lineHeight: 14 },
});

// ── Comparison Badge ──────────────────────────────────────────────────────────

function ComparisonBadge({
  swishValue,
  ebayValue,
}: {
  label: string;
  swishValue: string;
  ebayValue?: string;
}) {
  const differs = ebayValue && ebayValue !== swishValue;
  return (
    <View style={cb.row}>
      <View style={cb.item}>
        <Text style={cb.source}>SWISH</Text>
        <Text style={cb.value}>{swishValue}</Text>
      </View>
      {ebayValue ? (
        <>
          <MaterialIcons
            name={differs ? 'sync-problem' : 'check'}
            size={12}
            color={differs ? Colors.warning : Colors.success}
          />
          <View style={cb.item}>
            <Text style={cb.source}>eBay Live</Text>
            <Text style={[cb.value, differs && { color: Colors.warning }]}>{ebayValue}</Text>
          </View>
        </>
      ) : null}
    </View>
  );
}

const cb = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  item: { gap: 1 },
  source: { fontSize: 8, fontWeight: Typography.weight.bold, color: Colors.textTertiary, letterSpacing: 0.4 },
  value: { fontSize: Typography.size.xs, color: Colors.textSecondary, fontWeight: Typography.weight.medium },
});

// ── Main Screen ───────────────────────────────────────────────────────────────

export default function EbayListingEditorScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { tenant } = useApp();
  const { showAlert } = useAlert();
  const { id: listingId } = useLocalSearchParams<{ id: string }>();

  const [data, setData] = useState<ListingEditorData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [revising, setRevising] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const [showAISuggest, setShowAISuggest] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [generatingTitle, setGeneratingTitle] = useState(false);
  const [generatingDesc, setGeneratingDesc] = useState(false);

  const originalRef = useRef<ListingEditorData | null>(null);

  // ── Load listing ────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    // Guard: invalid/missing listingId must never cause an infinite spinner
    if (!tenant) { setLoading(false); return; }
    if (!listingId || typeof listingId !== 'string' || listingId.trim() === '') {
      // No valid listing ID — show error and allow back navigation
      setLoading(false);
      return;
    }
    const supabase = getSupabaseClient();

    const { data: row, error } = await supabase
      .from('listings')
      .select(`
        *,
        items(
          id, canonical_title, description, condition, condition_grade,
          specialist_id, quantity, sku, inventory_id, attributes, media,
          valuation_mid, expected_selling_price,
          catalogue_number,
          ruler, denomination, country_of_origin, period, mint,
          weight_grams, dimensions_mm, material, manufacturer, year_made,
          folder_number, storage_location
        )
      `)
      .eq('id', listingId)
      .eq('tenant_id', tenant.id)
      .maybeSingle();

    if (error || !row) {
      showAlert('Load Error', error?.message ?? 'Listing not found');
      router.back();
      return;
    }

    const item = row.items as any;
    const attrs = item?.attributes ?? {};

    // ── Item Specifics: blocked internal keys (never send to eBay) ─────────────
    // Lowercase set — matched case-insensitively
    const BLOCKED_KEYS = new Set([
      // Internal tracking / batch fields
      'batch_id', 'batchid', 'capture_ref', 'captureref',
      // Object classification (internal AI fields)
      'object_type', 'objecttype', 'identification_state', 'identificationstate',
      'identification_source', 'identificationsource',
      // Alteration / condition flags (go in description, not specifics)
      'has_hole', 'hashole', 'has_alteration', 'hasalteration',
      'alteration_notes', 'alterationnotes',
      'has_countermark', 'hascountermark',
      // eBay internal category fields (not eBay specifics)
      'ebay_category_id', 'ebaycategoryid', 'ebay_category_name', 'ebaycategoryname',
      // Numista internal reference fields
      'numista_type_id', 'numistatypeid', 'numista_candidate_id',
      'numista_status', 'numistastatus', 'numista_match_score',
      'numista_n', 'numistan', 'numista_url', 'numistaurl',
      'numista_candidate_score', 'numista_match_tier',
      // Inferred duplicates — the non-inferred version is kept separately
      'inferred_issuer', 'inferredissuer',
      'inferred_ruler', 'inferredruler',
      'inferred_monarch', 'inferredmonarch',
      'inferred_period', 'inferredperiod',
      'inferred_country', 'inferredcountry',
      'inferred_denomination', 'inferreddenomination',
      'inferred_event', 'inferredevent',
      // Valuation / commercial fields
      'valuation_confidence', 'valuationconfidence',
      'identification_confidence', 'identificationconfidence',
      // Fineness = Unknown is noise
      // (kept — user can delete)
    ]);

    // ── Canonical name mapping: many AI keys map to one display name ───────────
    // Maps raw key (lowercase, no spaces/underscores) → canonical display name
    const CANONICAL: Record<string, string> = {
      // Metal / Material
      'metal': 'Metal', 'material': 'Metal', 'materialtype': 'Metal',
      'composition': 'Metal', 'metaltype': 'Metal',
      // Issuer / Ruler
      'issuer': 'Issuer', 'ruler': 'Ruler', 'monarch': 'Ruler',
      'rulerdepicted': 'Ruler', 'emperordepicted': 'Ruler',
      // Period / Era
      'period': 'Period', 'era': 'Period', 'historicalperiod': 'Period',
      // Country
      'country': 'Country/Region of Manufacture',
      'countryoforigin': 'Country/Region of Manufacture',
      'origin': 'Country/Region of Manufacture',
      'region': 'Region',
      // Denomination
      'denomination': 'Denomination', 'facevalue': 'Denomination',
      // Year
      'year': 'Year', 'yearmade': 'Year', 'date': 'Year',
      // Mint
      'mint': 'Mint', 'minthouse': 'Mint',
      // Weight
      'weight': 'Weight', 'weightg': 'Weight',
      // Diameter
      'diameter': 'Diameter', 'diametermm': 'Diameter',
    };

    function canonicalKey(raw: string): string {
      return raw.toLowerCase().replace(/[^a-z0-9]/g, '');
    }

    function isBlocked(raw: string): boolean {
      const k = canonicalKey(raw);
      // Direct blocklist
      if (BLOCKED_KEYS.has(k) || BLOCKED_KEYS.has(raw.toLowerCase())) return true;
      // Block "inferred *" prefix — catches any future inferred fields
      if (k.startsWith('inferred')) return true;
      // Block raw snake_case internal flags
      if (/^(has|is|object|identification|valuation|numista|ebay|batch|capture)/.test(k)) return true;
      return false;
    }

    // ── Build specifics: dedup by canonical name (first occurrence wins) ───────
    const seenCanonical = new Map<string, true>(); // canonical display name → seen
    const attrSpecifics: ItemSpecific[] = [];
    let specIdx = 0;

    for (const [k, v] of Object.entries(attrs)) {
      if (isBlocked(k)) continue;
      const rawVal = v;
      if (rawVal === null || rawVal === undefined) continue;
      const strVal = String(rawVal).trim();
      if (!strVal || strVal === 'false' || strVal === '0') continue;
      // Skip array values (not suitable for eBay specifics)
      if (Array.isArray(rawVal)) continue;
      // Skip long free-text values (>65 chars would need truncation)
      // But keep them if they're short enough
      const truncVal = strVal.length > 65 ? strVal.slice(0, 65) : strVal;

      const ck = canonicalKey(k);
      const displayName = CANONICAL[ck] ??
        k.replace(/_/g, ' ').split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

      // Dedup: skip if we already have a spec with this canonical display name
      if (seenCanonical.has(displayName)) continue;
      seenCanonical.set(displayName, true);

      attrSpecifics.push({ id: `attr_${specIdx++}`, name: displayName, value: truncVal });
    }

    // ── Merge in explicit item fields (only if not already present) ─────────────
    const coinFields: Array<[string, string | undefined]> = [
      ['Country/Region of Manufacture', item?.country_of_origin],
      ['Year', item?.year_made],
      ['Ruler', item?.ruler],
      ['Denomination', item?.denomination],
      ['Period', item?.period],
      ['Mint', item?.mint],
      ['Metal', item?.material],  // 'Material' DB field → 'Metal' display name
      ['Manufacturer', item?.manufacturer],
    ];
    for (const [name, val] of coinFields) {
      if (val && !seenCanonical.has(name)) {
        seenCanonical.set(name, true);
        attrSpecifics.push({ id: `coin_${name}`, name, value: String(val).slice(0, 65) });
      }
    }

    // Determine category — priority: saved attrs > Numista suggestion > specialist default
    // Niche-aware specialist → eBay category mapping
    // IMPORTANT: curiosities_collectibles is intentionally absent — we must NOT
    // silently assign "Ancient Coins" to non-coin niches (bikes, MX, clothing etc.).
    // If the specialist_id is curiosities_collectibles and no category is stored,
    // the user will be prompted to select a category via the live picker.
    const specCategoryMap: Record<string, { id: string; name: string }> = {
      // ── Coins & Numismatics: final leaves, never browse parents ───────────
      coins_uk:                 { id: '79964', name: 'Other British Coins' },
      coins_currency:           { id: '79964', name: 'Other British Coins' },
      coins_world:              { id: '257',   name: 'Other World Coins' },
      islamic_silver:           { id: '4730',  name: 'Islamic Coins' },
      banknotes:                { id: '6071',  name: 'Other British Banknotes' },
      gold:                     { id: '177652', name: 'Gold Bullion Coins' },
      silver:                   { id: '177653', name: 'Silver Bullion Coins' },
      // ── Collectibles ─────────────────────────────────────────────────────
      stamps:                   { id: '261',    name: 'Great Britain Stamps' },
      pokemon_cards:            { id: '183454', name: 'CCG Individual Cards' },
      trading_cards:            { id: '183454', name: 'CCG Individual Cards' },
      vintage_electronics:      { id: '293',    name: 'Vintage Electronics' },
      antique_furniture:        { id: '20091',  name: 'Antique Furniture' },
      jewellery_gold_silver:    { id: '50',     name: 'Fine Jewellery' },
      jewellery_precious_metals:{ id: '50',     name: 'Fine Jewellery' },
      books_rare:               { id: '261186', name: 'Rare & Antiquarian Books' },
      toys_vintage:             { id: '220',    name: 'Vintage Toys' },
      watches:                  { id: '14324',  name: 'Wristwatches' },
      ceramics_pottery:         { id: '870',    name: 'Ceramics & Pottery' },
      // Avoid guessed defaults for parent categories such as Militaria, Art,
      // Men's Clothing, and Ancient Artefacts. Use live taxonomy suggestions.
      // ── Motocross & Off-Road ─────────────────────────────────────────────
      motocross:                { id: '79183',  name: 'Motocross / Off-Road Bikes' },
      // ── Bicycles ─────────────────────────────────────────────────────────
      bicycles:                 { id: '177831', name: 'Mountain Bikes' },
      // ── Clothing ─────────────────────────────────────────────────────────
      trainers_sneakers:        { id: '152506', name: 'Trainers & Athletic Shoes' },
      // curiosities_collectibles intentionally absent — user must choose via live category search
    };

    // BUG FIX: Read category_id from the listings table FIRST (set by import/editor save),
    // then fall back to item attributes. This ensures imported listings always show
    // the correct eBay category rather than generic fallback.
    const dbCatId   = row.category_id   ? String(row.category_id)   : null;
    const savedCatId   = dbCatId ?? (attrs['ebay_category_id']   ? String(attrs['ebay_category_id'])   : null);
    // Resolve category name: prefer attrs (most specific), then look up from ebay_categories table
    let savedCatName: string | null = attrs['ebay_category_name'] ? String(attrs['ebay_category_name']) : null;
    if (!savedCatName && dbCatId) {
      // Try to resolve the name from the local ebay_categories cache
      const { data: catRow } = await supabase
        .from('ebay_categories')
        .select('category_name')
        .eq('marketplace_id', 'EBAY_GB')
        .eq('category_id', dbCatId)
        .maybeSingle();
      if (catRow?.category_name && catRow.category_name !== dbCatId) {
        savedCatName = catRow.category_name;
      } else {
        savedCatName = `Category ${dbCatId}`;
      }
    }

    // Numista category suggestion (for items with verified Numista match)
    const hasNumistaMatch = attrs['numista_type_id'] &&
      (attrs['numista_status'] === 'verified' ||
       attrs['numista_status'] === 'strong_match' ||
       attrs['numista_status'] === 'candidate');
    const numistaSuggestedCat = hasNumistaMatch
      ? getNumistaSuggestedCategory(attrs, item?.specialist_id ?? '')
      : null;

    const defaultCat = savedCatId && savedCatName
      ? { id: savedCatId, name: savedCatName }
      : numistaSuggestedCat
      ?? specCategoryMap[item?.specialist_id ?? '']
      // If no specialist default exists (e.g. curiosities_collectibles, bicycles,
      // motocross), leave the category blank so the user is required to select one.
      // Never silently assign an unrelated category.
      ?? null;

    const editorData: ListingEditorData = {
      listingId: row.id,
      itemId: row.item_id,
      externalListingId: row.external_listing_id ?? undefined,
      status: row.status,
      title: row.title ?? item?.canonical_title ?? '',
      subtitle: '',
      description: row.description ?? item?.description ?? '',
      price: (Number(row.price ?? 0)).toFixed(2),
      shippingCost: (Number(row.shipping_cost ?? 0)).toFixed(2),
      quantity: String(item?.quantity ?? 1),
      // Prefer the established custom item/SKU field, then fall back to the
      // internal inventory reference so existing records are auto-populated.
      sku: String(item?.sku ?? item?.inventory_id ?? '').trim(),
      categoryId: defaultCat?.id ?? '',
      categoryName: defaultCat?.name ?? '',
      condition: item?.condition ?? 'Very Good',
      conditionDescription: item?.condition_grade ?? '',
      listingType: 'FixedPriceItem',
      auctionDays: 7,
      startPrice: (Number(row.price ?? 0) * 0.2).toFixed(2),
      reservePrice: '',
      bestOfferEnabled: false,
      bestOfferMinPrice: '',
      dispatchDays: '3',
      floorPrice: (Number(row.floor_price ?? 0)).toFixed(2),
      ceilingPrice: (Number(row.ceiling_price ?? 0)).toFixed(2),
      // Keep every valid eBay-specific candidate; truncating to 25 silently drops listing attributes.
      itemSpecifics: attrSpecifics,
      media: item?.media ?? [],
      itemTitle: item?.canonical_title ?? '',
      itemCondition: item?.condition ?? '',
      itemValuationMid: Number(item?.valuation_mid ?? 0),
      specialistId: item?.specialist_id ?? '',
      inventoryId: item?.inventory_id ?? undefined,
      attributes: attrs,
      _numistaSuggestedCat: numistaSuggestedCat ?? undefined,
    };

    setData(editorData);
    originalRef.current = JSON.parse(JSON.stringify(editorData));
    setHasChanges(false);
    setLoading(false);
  }, [tenant?.id, listingId, showAlert, router]);

  useEffect(() => { load(); }, [load]);

  const update = useCallback(<K extends keyof ListingEditorData>(key: K, value: ListingEditorData[K]) => {
    setData(prev => {
      if (!prev) return prev;
      setHasChanges(true);
      return { ...prev, [key]: value };
    });
  }, []);

  // Save category selection back to item attributes for future pre-population
  const handleCategorySelect = useCallback(async (id: string, name: string) => {
    update('categoryId', id);
    update('categoryName', name);
    if (!data?.itemId || !tenant) return;
    const supabase = getSupabaseClient();

    // Save category to item attributes for future pre-population
    const { data: itemRow } = await supabase
      .from('items')
      .select('attributes')
      .eq('id', data.itemId)
      .maybeSingle();
    const existing = itemRow?.attributes ?? {};
    await supabase
      .from('items')
      .update({
        attributes: { ...existing, ebay_category_id: id, ebay_category_name: name },
        updated_at: new Date().toISOString(),
      })
      .eq('id', data.itemId)
      .eq('tenant_id', tenant.id);

    // Also immediately persist category_id to the listings table so submission can find it
    if (data?.listingId) {
      await supabase
        .from('listings')
        .update({ category_id: id, updated_at: new Date().toISOString() })
        .eq('id', data.listingId)
        .eq('tenant_id', tenant.id);
    }
  }, [data?.itemId, data?.listingId, tenant, update]);

  // ── Save locally ────────────────────────────────────────────────────────────

  const handleSaveLocal = useCallback(async () => {
    if (!data || !tenant) return;
    setSaving(true);
    const supabase = getSupabaseClient();

    const { error } = await supabase
      .from('listings')
      .update({
        title: data.title.slice(0, 80),
        description: data.description,
        price: parseFloat(data.price) || 0,
        shipping_cost: parseFloat(data.shippingCost) || 0,
        floor_price: parseFloat(data.floorPrice) || 0,
        ceiling_price: parseFloat(data.ceilingPrice) || 0,
        // Always persist the currently selected category — this is what the edge function reads
        category_id: data.categoryId || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', data.listingId)
      .eq('tenant_id', tenant.id);

    setSaving(false);

    if (error) { showAlert('Save Failed', error.message); return; }

    await supabase
      .from('items')
      .update({
        condition: data.condition,
        condition_grade: data.conditionDescription,
        quantity: parseInt(data.quantity) || 1,
        sku: data.sku.trim() || null,
        inventory_id: data.sku.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', data.itemId)
      .eq('tenant_id', tenant.id);

    setHasChanges(false);
    originalRef.current = JSON.parse(JSON.stringify(data));
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 2500);
  }, [data, tenant, showAlert]);

  // ── SKU-only revision: do not send listing photos or other listing fields ───────

  const handleReviseSkuOnEbay = useCallback(async () => {
    if (!data || !tenant) return;
    if (!data.externalListingId) {
      showAlert('Not Live on eBay', 'This listing has not been published to eBay yet.');
      return;
    }
    const sku = data.sku.trim();
    if (!sku) {
      showAlert('SKU Required', 'Enter a SKU in the SKU / SWISH ID field before updating eBay.');
      return;
    }
    showAlert(
      'Update SKU only?',
      `Set the eBay custom label (SKU) for listing #${data.externalListingId} to "${sku}"? This sends only the SKU change and will not revise listing photos or other listing fields.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Update SKU',
          onPress: async () => {
            setRevising(true);
            const supabase = getSupabaseClient();
            try {
              const { data: result, error } = await supabase.functions.invoke('swish-ebay-list', {
                body: {
                  route: 'revise_sku',
                  tenantId: tenant.id,
                  listingId: data.listingId,
                  itemId: data.itemId,
                  externalListingId: data.externalListingId,
                  sku,
                  listingType: data.listingType,
                },
              });
              if (error) {
                let msg = error.message;
                if (error instanceof FunctionsHttpError) {
                  try { const txt = await error.context?.text(); const p = txt ? JSON.parse(txt) : null; msg = p?.error ?? txt ?? msg; } catch {}
                }
                if (msg.includes('This listing is already active on eBay. Use the revise route to update it.')) {
                  showAlert(
                    'SKU-only route not deployed',
                    'The running swish-ebay-list Edge Function is older than the code in GitHub and is treating this as a new listing. No SKU or photo changes were made. Redeploy swish-ebay-list from the current main branch, then retry Update SKU on eBay only. Do not use Revise on eBay as a workaround.'
                  );
                } else {
                  showAlert('SKU Update Failed', msg);
                }
                return;
              }
              if (result?.success) {
                const { error: itemSkuError } = await supabase.from('items').update({
                  sku,
                  inventory_id: sku,
                  updated_at: new Date().toISOString(),
                }).eq('id', data.itemId).eq('tenant_id', tenant.id);
                if (itemSkuError) {
                  showAlert('SKU Sync Warning', `eBay accepted SKU ${sku}, but SWISH could not save it locally: ${itemSkuError.message}`);
                }
                setData(prev => prev ? { ...prev, sku } : prev);
                setHasChanges(false);
                showAlert('SKU Updated', `eBay listing #${data.externalListingId} now has SKU ${sku}. Photos and other listing fields were not sent.`);
              } else {
                showAlert('SKU Update Failed', result?.error ?? 'Unknown error from eBay');
              }
            } catch (e: any) {
              showAlert('SKU Update Failed', e?.message ?? 'Unknown error');
            } finally {
              setRevising(false);
            }
          },
        },
      ],
    );
  }, [data, tenant, showAlert]);

  // ── Revise on eBay ────────────────────────────────────────────────────────────

  const handleReviseOnEbay = useCallback(async () => {
    if (!data || !tenant) return;
    if (!data.externalListingId) {
      showAlert('Not Live on eBay', 'This listing has not been published to eBay yet.');
      return;
    }

    const price = parseFloat(data.price);
    if (!data.title.trim() || isNaN(price) || price <= 0) {
      showAlert('Missing Fields', 'Title and price are required before revising.');
      return;
    }

    showAlert(
      'Revise on eBay?',
      `Push changes to eBay listing #${data.externalListingId}? This will update title, description, price, category, condition, and item specifics on eBay immediately.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Revise Listing',
          onPress: async () => {
            await handleSaveLocal();
            setRevising(true);
            const supabase = getSupabaseClient();
            try {
              const { data: result, error } = await supabase.functions.invoke('swish-ebay-list', {
                body: {
                  route: 'revise',
                  tenantId: tenant.id,
                  listingId: data.listingId,
                  externalListingId: data.externalListingId,
                  title: data.title.slice(0, 80),
                  description: data.description,
                  price,
                  categoryId: data.categoryId,
                  condition: data.condition,
                  conditionDescription: data.conditionDescription,
                  listingType: data.listingType,
                  quantity: parseInt(data.quantity) || 1,
                  sku: data.sku.trim(),
                  startPrice: parseFloat(data.startPrice) || undefined,
                  reservePrice: parseFloat(data.reservePrice) || undefined,
                  bestOfferEnabled: data.bestOfferEnabled,
                  dispatchDays: parseInt(data.dispatchDays) || 3,
                  itemSpecifics: data.itemSpecifics.filter(s => s.name && s.value),
                  mediaUrls: data.media.filter(u => u.startsWith('https://')),
                },
              });

              if (error) {
                let msg = error.message;
                if (error instanceof FunctionsHttpError) {
                  try { const txt = await error.context?.text(); const p = txt ? JSON.parse(txt) : null; msg = p?.error ?? txt ?? msg; } catch {}
                }
                showAlert('Revision Failed', msg);
                return;
              }

              if (result?.success) {
                showAlert('Listing Revised', `eBay listing #${data.externalListingId} updated successfully.${result.warnings?.length > 0 ? '\n\nWarnings:\n' + result.warnings.join('\n') : ''}`);
                setHasChanges(false);
              } else {
                showAlert('Revision Failed', result?.error ?? 'Unknown error from eBay');
              }
            } catch (e: any) {
              showAlert('Revision Failed', e?.message ?? 'Unknown error');
            } finally {
              setRevising(false);
            }
          },
        },
      ]
    );
  }, [data, tenant, showAlert, handleSaveLocal]);

  // ── Render ──────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={[s.container, { alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={{ color: Colors.textTertiary, marginTop: Spacing.md }}>Loading listing...</Text>
      </View>
    );
  }

  // No valid listing ID or listing not found — show clear error with back option
  if (!data) {
    return (
      <View style={[s.container, { alignItems: 'center', justifyContent: 'center', padding: Spacing.xl ?? 24 }]}>
        <MaterialIcons name="error-outline" size={40} color={Colors.textTertiary} />
        <Text style={{ color: Colors.textSecondary, fontSize: Typography.size.base, fontWeight: Typography.weight.bold, marginTop: Spacing.md, textAlign: 'center' }}>
          {listingId ? 'Listing Not Found' : 'No Listing Selected'}
        </Text>
        <Text style={{ color: Colors.textTertiary, fontSize: Typography.size.sm, marginTop: Spacing.sm, textAlign: 'center', lineHeight: 20 }}>
          {listingId
            ? 'This listing could not be loaded. It may have been deleted or you may not have access.'
            : 'A listing ID is required to open the editor. Please create or select a listing first.'}
        </Text>
        <Pressable
          onPress={() => router.back()}
          style={{ marginTop: Spacing.lg, backgroundColor: Colors.primary, borderRadius: Radius.md, paddingHorizontal: Spacing.xl ?? 24, paddingVertical: Spacing.md }}
        >
          <Text style={{ color: Colors.background, fontWeight: Typography.weight.bold, fontSize: Typography.size.sm }}>Go Back</Text>
        </Pressable>
      </View>
    );
  }

  const isActive = data.status === 'active';
  const isDraft = data.status === 'draft' || data.status === 'pending';
  const charCountColor = data.title.length > 70 ? Colors.warning : data.title.length === 80 ? Colors.danger : Colors.textTertiary;

  return (
    <KeyboardAvoidingView style={s.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={[s.header, { paddingTop: insets.top + Spacing.base }]}>
        <Pressable
          onPress={() => {
            if (hasChanges) {
              showAlert('Unsaved Changes', 'You have unsaved changes. Save before leaving?', [
                { text: 'Discard', style: 'destructive', onPress: () => router.back() },
                { text: 'Save', onPress: async () => { await handleSaveLocal(); router.back(); } },
                { text: 'Cancel', style: 'cancel' },
              ]);
            } else {
              router.back();
            }
          }}
          style={s.backBtn}
          hitSlop={8}
        >
          <MaterialIcons name="arrow-back" size={20} color={Colors.textSecondary} />
        </Pressable>

        <View style={s.flex}>
          <Text style={s.title} numberOfLines={1}>
            {data.inventoryId ? `${data.inventoryId} · ` : ''}Edit Listing
          </Text>
          <View style={s.statusRow}>
            <View style={[s.statusPill, {
              backgroundColor: isActive ? Colors.successDim : isDraft ? Colors.primaryDim : Colors.surfaceHighlight,
            }]}>
              <View style={[s.statusDot, { backgroundColor: isActive ? Colors.success : isDraft ? Colors.primary : Colors.textTertiary }]} />
              <Text style={[s.statusText, { color: isActive ? Colors.success : isDraft ? Colors.primary : Colors.textTertiary }]}>
                {data.status === 'pending' ? 'Verified' : data.status}
              </Text>
            </View>
            {data.externalListingId ? <Text style={s.ebayId}>#{data.externalListingId}</Text> : null}
            {hasChanges ? (
              <View style={s.unsavedBadge}><Text style={s.unsavedText}>Unsaved</Text></View>
            ) : saveSuccess ? (
              <View style={s.savedBadge}>
                <MaterialIcons name="check" size={9} color={Colors.success} />
                <Text style={s.savedText}>Saved</Text>
              </View>
            ) : null}
          </View>
        </View>

        <Pressable onPress={handleSaveLocal} disabled={saving || !hasChanges} style={[s.saveBtn, !hasChanges && { opacity: 0.45 }]} hitSlop={4}>
          {saving ? <ActivityIndicator size="small" color={Colors.primary} style={{ width: 14, height: 14 }} /> : <MaterialIcons name="save" size={14} color={Colors.primary} />}
          <Text style={s.saveBtnText}>{saving ? 'Saving...' : 'Save'}</Text>
        </Pressable>

        <Pressable onPress={handleReviseOnEbay} disabled={revising} style={[s.reviseBtn, !data.externalListingId && { opacity: 0.5 }]} hitSlop={4}>
          {revising ? <ActivityIndicator size="small" color={Colors.background} style={{ width: 14, height: 14 }} /> : <MaterialIcons name="published-with-changes" size={14} color={Colors.background} />}
          <Text style={s.reviseBtnText}>{revising ? 'Revising...' : 'Revise on eBay'}</Text>
        </Pressable>
      </View>

      {/* SWISH intelligence banner */}
      {data.itemValuationMid > 0 ? (
        <Pressable onPress={() => update('price', data.itemValuationMid.toFixed(2))} style={({ pressed }) => [s.intelligenceBanner, pressed && { opacity: 0.8 }]}>
          <MaterialIcons name="auto-awesome" size={12} color={Colors.gold} />
          <Text style={s.intelligenceText}>
            SWISH valuation: £{data.itemValuationMid.toFixed(2)} mid · Current: £{data.price}
            {parseFloat(data.price) < data.itemValuationMid * 0.7 ? ' · Below floor' : ''}
            {parseFloat(data.price) > data.itemValuationMid * 1.5 ? ' · Above ceiling' : ''}
            {' · Tap to use SWISH price'}
          </Text>
          <MaterialIcons name="price-change" size={14} color={Colors.gold} />
        </Pressable>
      ) : null}

      {/* Numista category banner (when auto-suggested but not yet saved) */}
      {data._numistaSuggestedCat && !data.attributes['ebay_category_id'] ? (
        <Pressable
          onPress={() => handleCategorySelect(data._numistaSuggestedCat!.id, data._numistaSuggestedCat!.name)}
          style={s.numistaCatBanner}
        >
          <MaterialIcons name="verified" size={13} color={Colors.success} />
          <Text style={s.numistaCatBannerText}>
            Numista suggests: <Text style={{ fontWeight: Typography.weight.bold }}>{data._numistaSuggestedCat.name}</Text> · Tap to use
          </Text>
          <MaterialIcons name="check" size={14} color={Colors.success} />
        </Pressable>
      ) : null}

      <ScrollView
        contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 100 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >

        {/* PHOTOS */}
        <View style={s.section}>
          <SectionHeader icon="photo-library" title="Photos" badge={`${data.media.length} images`} />
          {data.media.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.photoRow}>
              {data.media.map((uri, i) => (
                <View key={i} style={s.photoWrap}>
                  <ItemImage uri={uri} style={s.photo} contentFit="cover" />
                  {i === 0 ? (
                    <View style={s.mainPhotoBadge}><Text style={s.mainPhotoText}>Main</Text></View>
                  ) : null}
                </View>
              ))}
            </ScrollView>
          ) : (
            <View style={s.noPhotos}>
              <MaterialIcons name="add-photo-alternate" size={28} color={Colors.textTertiary} />
              <Text style={s.noPhotosText}>No photos — use Re-Identify on the item to add photos</Text>
            </View>
          )}
          <Text style={s.photoHint}>
            Photos are managed on the inventory item screen. eBay supports up to 12 photos.
            {data.media.filter(u => u.startsWith('https://')).length < data.media.length
              ? ` (${data.media.filter(u => !u.startsWith('https://')).length} local photo(s) cannot be sent to eBay)`
              : ''}
          </Text>
        </View>

        {/* LISTING TYPE */}
        <View style={s.section}>
          <SectionHeader icon="sell" title="Listing Type" />
          <View style={s.typeRow}>
            <Pressable onPress={() => update('listingType', 'FixedPriceItem')} style={[s.typeBtn, data.listingType === 'FixedPriceItem' && s.typeBtnActive]}>
              <MaterialIcons name="sell" size={18} color={data.listingType === 'FixedPriceItem' ? Colors.primary : Colors.textTertiary} />
              <Text style={[s.typeBtnLabel, data.listingType === 'FixedPriceItem' && { color: Colors.primary }]}>Buy It Now</Text>
              <Text style={s.typeBtnDesc}>Fixed price · Good Till Cancelled</Text>
            </Pressable>
            <Pressable onPress={() => update('listingType', 'Chinese')} style={[s.typeBtn, data.listingType === 'Chinese' && { ...s.typeBtnActive, borderColor: Colors.accent, backgroundColor: Colors.accentDim }]}>
              <MaterialIcons name="gavel" size={18} color={data.listingType === 'Chinese' ? Colors.accent : Colors.textTertiary} />
              <Text style={[s.typeBtnLabel, data.listingType === 'Chinese' && { color: Colors.accent }]}>Auction</Text>
              <Text style={s.typeBtnDesc}>Timed bidding</Text>
            </Pressable>
          </View>
          {data.listingType === 'Chinese' ? (
            <>
              <FieldLabel label="AUCTION DURATION" />
              <View style={s.durationRow}>
                {([3, 5, 7, 10] as AuctionDays[]).map(d => (
                  <Pressable key={d} onPress={() => update('auctionDays', d)} style={[s.durationChip, data.auctionDays === d && s.durationChipActive]}>
                    <Text style={[s.durationText, data.auctionDays === d && { color: Colors.accent }]}>{d}d</Text>
                  </Pressable>
                ))}
              </View>
            </>
          ) : null}
        </View>

        {/* TITLE & DESCRIPTION */}
        <View style={s.section}>
          <SectionHeader icon="title" title="Title & Description" />
          <View style={s.descLabelRow}>
            <FieldLabel label="LISTING TITLE" required hint="Max 80 characters. Front-load keywords: item type, date, grade, rarity." />
            <Pressable
              onPress={async () => {
                if (!tenant || !data) return;
                setGeneratingTitle(true);
                try {
                  const supabase = getSupabaseClient();
                  const { data: fnData, error: fnErr } = await supabase.functions.invoke('swish-list-generate', {
                    body: { item_id: data.itemId, tenant_id: tenant.id, marketplace_id: 'ebay', fields: ['title'] },
                  });
                  if (fnErr || !fnData?.listing?.title) {
                    let msg = fnErr?.message ?? 'Could not generate title';
                    if (fnErr instanceof FunctionsHttpError) {
                      try { const t = await fnErr.context?.text(); const p = t ? JSON.parse(t) : null; msg = p?.error ?? t ?? msg; } catch {}
                    }
                    showAlert('AI Title Failed', msg);
                  } else {
                    update('title', String(fnData.listing.title).slice(0, 80));
                  }
                } catch (e: any) {
                  showAlert('AI Title Failed', e?.message ?? 'Unknown error');
                } finally {
                  setGeneratingTitle(false);
                }
              }}
              disabled={generatingTitle}
              style={({ pressed }) => [s.aiDescBtn, pressed && { opacity: 0.75 }, generatingTitle && { opacity: 0.6 }]}
              hitSlop={6}
            >
              {generatingTitle
                ? <ActivityIndicator size="small" color={Colors.accent} style={{ width: 11, height: 11 }} />
                : <MaterialIcons name="auto-awesome" size={11} color={Colors.accent} />}
              <Text style={s.aiDescBtnText}>{generatingTitle ? 'Generating...' : 'Generate with AI'}</Text>
            </Pressable>
          </View>
          <TextInput style={[s.input, { marginTop: 4 }]} value={data.title} onChangeText={v => update('title', v.slice(0, 80))} placeholder="e.g. 1887 Victorian Crown EF Silver Coin · Great Britain" placeholderTextColor={Colors.textTertiary} maxLength={80} />
          <View style={s.titleFooter}>
            <Text style={[s.charCount, { color: charCountColor }]}>{data.title.length}/80</Text>
            {data.title !== data.itemTitle ? (
              <Pressable onPress={() => update('title', data.itemTitle)} hitSlop={6}><Text style={s.resetLink}>Reset to item title</Text></Pressable>
            ) : null}
          </View>
          <View style={{ height: Spacing.sm }} />
          <FieldLabel label="SUBTITLE" hint="Optional. Appears below title in search results (additional fee applies)." />
          <TextInput style={[s.input, { marginTop: 4 }]} value={data.subtitle} onChangeText={v => update('subtitle', v.slice(0, 55))} placeholder="Optional subtitle (55 chars max)" placeholderTextColor={Colors.textTertiary} maxLength={55} />
          <View style={{ height: Spacing.sm }} />
          <View style={s.descLabelRow}>
            <FieldLabel label="DESCRIPTION" required hint="Describe condition, provenance, dimensions, defects, and history." />
            <Pressable
              onPress={async () => {
                if (!tenant || !data) return;
                setGeneratingDesc(true);
                try {
                  const supabase = getSupabaseClient();
                  const { data: fnData, error: fnErr } = await supabase.functions.invoke('swish-list-generate', {
                    body: { item_id: data.itemId, tenant_id: tenant.id, marketplace_id: 'ebay', fields: ['description'] },
                  });
                  if (fnErr || !fnData?.listing?.description) {
                    let msg = fnErr?.message ?? 'Could not generate description';
                    if (fnErr instanceof FunctionsHttpError) {
                      try { const t = await fnErr.context?.text(); const p = t ? JSON.parse(t) : null; msg = p?.error ?? t ?? msg; } catch {}
                    }
                    showAlert('AI Description Failed', msg);
                  } else {
                    update('description', fnData.listing.description);
                  }
                } catch (e: any) {
                  showAlert('AI Description Failed', e?.message ?? 'Unknown error');
                } finally {
                  setGeneratingDesc(false);
                }
              }}
              disabled={generatingDesc}
              style={({ pressed }) => [s.aiDescBtn, pressed && { opacity: 0.75 }, generatingDesc && { opacity: 0.6 }]}
              hitSlop={6}
            >
              {generatingDesc
                ? <ActivityIndicator size="small" color={Colors.accent} style={{ width: 11, height: 11 }} />
                : <MaterialIcons name="auto-awesome" size={11} color={Colors.accent} />}
              <Text style={s.aiDescBtnText}>{generatingDesc ? 'Generating...' : 'Generate with AI'}</Text>
            </Pressable>
          </View>
          <TextInput style={[s.input, s.descInput, { marginTop: 4 }]} value={data.description} onChangeText={v => update('description', v)} placeholder="Detailed description..." placeholderTextColor={Colors.textTertiary} multiline textAlignVertical="top" />
          <Text style={s.charCountRight}>{data.description.length} chars</Text>
        </View>

        {/* PRICING */}
        <View style={s.section}>
          <SectionHeader icon="price-change" title="Pricing" />
          {data.listingType === 'FixedPriceItem' ? (
            <View style={s.priceGrid}>
              <View style={s.priceField}>
                <FieldLabel label="LISTING PRICE (£)" required />
                <View style={s.priceInputWrap}><Text style={s.priceCurrency}>£</Text><TextInput style={s.priceInput} value={data.price} onChangeText={v => update('price', v)} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={Colors.textTertiary} /></View>
              </View>
              <View style={s.priceField}>
                <FieldLabel label="FLOOR PRICE (£)" hint="Min auto-reprice" />
                <View style={s.priceInputWrap}><Text style={s.priceCurrency}>£</Text><TextInput style={s.priceInput} value={data.floorPrice} onChangeText={v => update('floorPrice', v)} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={Colors.textTertiary} /></View>
              </View>
              <View style={s.priceField}>
                <FieldLabel label="CEILING PRICE (£)" hint="Max auto-reprice" />
                <View style={s.priceInputWrap}><Text style={s.priceCurrency}>£</Text><TextInput style={s.priceInput} value={data.ceilingPrice} onChangeText={v => update('ceilingPrice', v)} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={Colors.textTertiary} /></View>
              </View>
            </View>
          ) : (
            <View style={s.priceGrid}>
              <View style={s.priceField}>
                <FieldLabel label="START PRICE (£)" required />
                <View style={s.priceInputWrap}><Text style={s.priceCurrency}>£</Text><TextInput style={s.priceInput} value={data.startPrice} onChangeText={v => update('startPrice', v)} keyboardType="decimal-pad" placeholder="0.99" placeholderTextColor={Colors.textTertiary} /></View>
              </View>
              <View style={s.priceField}>
                <FieldLabel label="RESERVE (£)" hint="Optional floor" />
                <View style={s.priceInputWrap}><Text style={s.priceCurrency}>£</Text><TextInput style={s.priceInput} value={data.reservePrice} onChangeText={v => update('reservePrice', v)} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={Colors.textTertiary} /></View>
              </View>
            </View>
          )}
          {data.listingType === 'FixedPriceItem' ? (
            <View style={s.toggleRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.toggleLabel}>Best Offer</Text>
                <Text style={s.toggleHint}>Allow buyers to make offers below your asking price</Text>
              </View>
              <Pressable onPress={() => update('bestOfferEnabled', !data.bestOfferEnabled)} style={[s.toggle, data.bestOfferEnabled && s.toggleActive]} hitSlop={8}>
                <Text style={[s.toggleText, data.bestOfferEnabled && { color: Colors.primary }]}>{data.bestOfferEnabled ? 'On' : 'Off'}</Text>
              </Pressable>
            </View>
          ) : null}
          {data.itemValuationMid > 0 ? (
            <ComparisonBadge label="Price vs Valuation" swishValue={`£${data.price}`} ebayValue={`£${data.itemValuationMid.toFixed(2)} est.`} />
          ) : null}
        </View>

        {/* SHIPPING */}
        <View style={s.section}>
          <SectionHeader icon="local-shipping" title="Shipping" />
          <View style={s.simpleDeliveryCard}>
            <MaterialIcons name="check-circle" size={14} color={Colors.success} />
            <View style={{ flex: 1 }}>
              <Text style={s.simpleDeliveryText}><Text style={{ fontWeight: Typography.weight.bold }}>Simple Delivery — Buyer Pays</Text></Text>
              <Text style={[s.simpleDeliveryText, { marginTop: 3, color: Colors.textSecondary }]}>Shipping cost is charged to the buyer via eBay Simple Delivery. SWISH does not use free shipping or seller-paid postage.</Text>
              <Text style={[s.simpleDeliveryText, { marginTop: 3, color: Colors.textTertiary }]}>To adjust: update your eBay fulfillment policy in Seller Hub.</Text>
            </View>
          </View>
          <View style={s.priceGrid}>
            <View style={s.priceField}>
              <FieldLabel label="DISPATCH DAYS" hint="Business days to dispatch" />
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 5, paddingVertical: 2 }}>
                {DISPATCH_DAYS_OPTIONS.map(d => (
                  <Pressable key={d} onPress={() => update('dispatchDays', String(d))} style={[s.durationChip, data.dispatchDays === String(d) && s.durationChipActive]}>
                    <Text style={[s.durationText, data.dispatchDays === String(d) && { color: Colors.primary }]}>{d}d</Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          </View>
        </View>

        {/* CATEGORY & CONDITION */}
        <View style={s.section}>
          <SectionHeader icon="category" title="Category & Condition" />
          <FieldLabel label="EBAY CATEGORY" />
          {/* Show warning if no category is set — requires user action before publishing */}
          {!data.categoryId && (
            <View style={[s.revisionNote, { borderColor: Colors.warning + '30', backgroundColor: Colors.warningDim, marginBottom: 0 }]}>
              <MaterialIcons name="warning" size={14} color={Colors.warning} />
              <Text style={[s.revisionNoteText, { color: Colors.warning }]}>
                No category selected. Tap &quot;Suggest with AI&quot; or browse the live eBay category tree to choose a valid leaf category before publishing.
              </Text>
            </View>
          )}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, marginBottom: Spacing.xs }}>
            <Pressable
              onPress={() => setShowAISuggest(true)}
              style={({ pressed }) => [s.aiSuggestBtn, pressed && { opacity: 0.8 }]}
              hitSlop={4}
            >
              <MaterialIcons name="auto-awesome" size={12} color={Colors.accent} />
              <Text style={s.aiSuggestBtnText}>Suggest with AI</Text>
            </Pressable>
            <Text style={{ fontSize: 9, color: Colors.textTertiary }}>or browse below</Text>
          </View>
          <Pressable onPress={() => setShowCategoryPicker(true)} style={s.categorySelector}>
            <View style={{ flex: 1 }}>
              <Text style={s.categoryName}>{data.categoryName}</Text>
              <Text style={s.categoryId}>Category ID: {data.categoryId}</Text>
            </View>
            <MaterialIcons name="chevron-right" size={18} color={Colors.textTertiary} />
          </Pressable>
          <View style={{ height: Spacing.sm }} />
          <FieldLabel label="CONDITION" required />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.conditionRow}>
            {CONDITION_OPTIONS.map(c => (
              <Pressable key={c.id} onPress={() => update('condition', c.value)} style={[s.conditionChip, data.condition === c.value && s.conditionChipActive]}>
                <Text style={[s.conditionText, data.condition === c.value && { color: Colors.primary }]}>{c.value}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <View style={{ height: Spacing.sm }} />
          <FieldLabel label="CONDITION DESCRIPTION" hint="Grade, notes on wear, defects, authentication" />
          <TextInput style={[s.input, { marginTop: 4 }]} value={data.conditionDescription} onChangeText={v => update('conditionDescription', v)} placeholder="e.g. EF/aVF, small rim nick at 3 o'clock, full original lustre" placeholderTextColor={Colors.textTertiary} />
        </View>

        {/* INVENTORY */}
        <View style={s.section}>
          <SectionHeader icon="inventory" title="Inventory" />
          <View style={s.priceGrid}>
            <View style={s.priceField}>
              <FieldLabel label="SKU / SWISH ID" hint="Internal reference on eBay order" />
              <TextInput style={s.input} value={data.sku} onChangeText={v => update('sku', v)} placeholder="KC-0001" placeholderTextColor={Colors.textTertiary} autoCapitalize="characters" />
              <Pressable onPress={handleReviseSkuOnEbay} disabled={revising || !data.externalListingId} style={[s.saveBtn, { borderColor: Colors.gold, marginTop: 8, alignSelf: 'flex-start' }, (!data.externalListingId || revising) && { opacity: 0.5 }]} hitSlop={4}>
                {revising ? <ActivityIndicator size="small" color={Colors.gold} style={{ width: 14, height: 14 }} /> : <MaterialIcons name="sell" size={14} color={Colors.gold} />}
                <Text style={[s.saveBtnText, { color: Colors.gold }]}>{revising ? 'Updating SKU...' : 'Update SKU on eBay only'}</Text>
              </Pressable>
            </View>
            <View style={s.priceField}>
              <FieldLabel label="QUANTITY" hint="Number available (BIN only)" />
              <TextInput style={s.input} value={data.quantity} onChangeText={v => update('quantity', v)} keyboardType="number-pad" placeholder="1" placeholderTextColor={Colors.textTertiary} />
            </View>
          </View>
        </View>

        {/* ITEM SPECIFICS */}
        <View style={s.section}>
          <SectionHeader icon="list" title="Item Specifics" badge={`${data.itemSpecifics.length}/25`} />
          <Text style={s.specificsNote}>Item specifics improve search visibility. eBay uses these for filtering and the item summary panel.</Text>
          <ItemSpecificsEditor specifics={data.itemSpecifics} onChange={specs => update('itemSpecifics', specs)} />
        </View>

        {/* SWISH INTELLIGENCE */}
        {(data.itemValuationMid > 0 || data.specialistId) ? (
          <View style={s.section}>
            <SectionHeader icon="auto-awesome" title="SWISH Intelligence" />
            <View style={s.intelligenceCard}>
              {data.itemValuationMid > 0 ? (
                <View style={s.intelRow}>
                  <MaterialIcons name="show-chart" size={13} color={Colors.gold} />
                  <Text style={s.intelLabel}>Valuation</Text>
                  <Text style={s.intelValue}>£{data.itemValuationMid.toFixed(2)} mid estimate</Text>
                </View>
              ) : null}
              {data.specialistId ? (
                <View style={s.intelRow}>
                  <MaterialIcons name="category" size={13} color={Colors.accent} />
                  <Text style={s.intelLabel}>Specialist</Text>
                  <Text style={s.intelValue}>{data.specialistId.replace(/_/g, ' ')}</Text>
                </View>
              ) : null}
              {data.inventoryId ? (
                <View style={s.intelRow}>
                  <MaterialIcons name="tag" size={13} color={Colors.primary} />
                  <Text style={s.intelLabel}>SWISH ID</Text>
                  <Text style={[s.intelValue, { color: Colors.primary, fontWeight: Typography.weight.bold }]}>{data.inventoryId}</Text>
                </View>
              ) : null}
              <View style={s.intelRow}>
                <MaterialIcons name="photo-library" size={13} color={Colors.textTertiary} />
                <Text style={s.intelLabel}>Photos</Text>
                <Text style={s.intelValue}>
                  {data.media.filter(u => u.startsWith('https://')).length} eBay-ready
                  {data.media.filter(u => !u.startsWith('https://')).length > 0 ? ` + ${data.media.filter(u => !u.startsWith('https://')).length} local` : ''}
                </Text>
              </View>
            </View>
          </View>
        ) : null}

        {/* REVISION NOTE */}
        {!data.externalListingId ? (
          <View style={s.revisionNote}>
            <MaterialIcons name="info-outline" size={14} color={Colors.info} />
            <Text style={s.revisionNoteText}>This listing is not yet live on eBay. Save changes here, then use &quot;List on eBay&quot; from the Admin screen to publish it.</Text>
          </View>
        ) : (
          <View style={[s.revisionNote, { borderColor: Colors.success + '30', backgroundColor: Colors.successDim }]}>
            <MaterialIcons name="published-with-changes" size={14} color={Colors.success} />
            <View style={{ flex: 1 }}>
              <Text style={[s.revisionNoteText, { color: Colors.success }]}>Live on eBay · Listing #{data.externalListingId}</Text>
              <Text style={[s.revisionNoteText, { color: Colors.textSecondary, marginTop: 2 }]}>Tap &quot;Revise on eBay&quot; to push all changes to the live listing.</Text>
            </View>
          </View>
        )}

        {/* BOTTOM ACTIONS */}
        <View style={s.bottomActions}>
          <Pressable onPress={handleSaveLocal} disabled={saving || !hasChanges} style={[s.bottomSaveBtn, !hasChanges && { opacity: 0.45 }]}>
            {saving ? <ActivityIndicator size="small" color={Colors.primary} style={{ width: 16, height: 16 }} /> : <MaterialIcons name="save" size={16} color={Colors.primary} />}
            <Text style={s.bottomSaveBtnText}>{saving ? 'Saving...' : 'Save Changes Locally'}</Text>
          </Pressable>
          <Pressable onPress={handleReviseOnEbay} disabled={revising || !data.externalListingId} style={[s.bottomReviseBtn, !data.externalListingId && { opacity: 0.35 }]}>
            {revising ? <ActivityIndicator size="small" color={Colors.background} style={{ width: 16, height: 16 }} /> : <MaterialIcons name="published-with-changes" size={16} color={Colors.background} />}
            <Text style={s.bottomReviseBtnText}>{revising ? 'Revising...' : data.externalListingId ? 'Revise on eBay' : 'Not Yet Live'}</Text>
          </Pressable>
        </View>
      </ScrollView>

      {/* AI Category Suggestion Modal */}
      <AICategorySuggestModal
        visible={showAISuggest}
        title={data?.title ?? ''}
        tenantId={tenant?.id}
        onSelect={handleCategorySelect}
        onClose={() => setShowAISuggest(false)}
      />

      {/* Category Picker Modal */}
      <CategoryPickerModal
        visible={showCategoryPicker}
        current={data.categoryId}
        onSelect={handleCategorySelect}
        onClose={() => setShowCategoryPicker(false)}
        tenantId={tenant?.id}
        numistaSuggestion={data._numistaSuggestedCat ?? null}
      />
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.xs,
    paddingHorizontal: Spacing.base, paddingBottom: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder, flexWrap: 'nowrap',
  },
  backBtn: {
    width: 34, height: 34, borderRadius: Radius.md,
    backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.surfaceBorder, flexShrink: 0,
  },
  title: { fontSize: Typography.size.base, fontWeight: Typography.weight.bold, color: Colors.textPrimary, maxWidth: 160 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2, flexWrap: 'wrap' },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 5, paddingVertical: 2, borderRadius: Radius.pill },
  statusDot: { width: 5, height: 5, borderRadius: 3 },
  statusText: { fontSize: 9, fontWeight: Typography.weight.bold, textTransform: 'capitalize' },
  ebayId: { fontSize: 9, color: Colors.textTertiary },
  unsavedBadge: { backgroundColor: Colors.warningDim, borderRadius: Radius.pill, paddingHorizontal: 5, paddingVertical: 2, borderWidth: 1, borderColor: Colors.warning + '40' },
  unsavedText: { fontSize: 9, color: Colors.warning, fontWeight: Typography.weight.bold },
  savedBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: Colors.successDim, borderRadius: Radius.pill, paddingHorizontal: 5, paddingVertical: 2 },
  savedText: { fontSize: 9, color: Colors.success, fontWeight: Typography.weight.bold },
  saveBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: Colors.primaryDim, borderRadius: Radius.md, paddingHorizontal: Spacing.sm, paddingVertical: 6, borderWidth: 1, borderColor: Colors.primary + '50', flexShrink: 0 },
  saveBtnText: { fontSize: Typography.size.xs, fontWeight: Typography.weight.semibold, color: Colors.primary },
  reviseBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: Colors.primary, borderRadius: Radius.md, paddingHorizontal: Spacing.sm, paddingVertical: 6, flexShrink: 0 },
  reviseBtnText: { fontSize: Typography.size.xs, fontWeight: Typography.weight.bold, color: Colors.background },
  intelligenceBanner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.goldDim, paddingHorizontal: Spacing.base, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: Colors.gold + '30' },
  intelligenceText: { flex: 1, fontSize: 10, color: Colors.gold, lineHeight: 14 },
  numistaCatBanner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.successDim, paddingHorizontal: Spacing.base, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: Colors.success + '20' },
  numistaCatBannerText: { flex: 1, fontSize: 11, color: Colors.success, lineHeight: 15 },
  descLabelRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: Spacing.sm },
  aiDescBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.accentDim, borderRadius: Radius.pill,
    paddingHorizontal: Spacing.sm, paddingVertical: 4,
    borderWidth: 1, borderColor: Colors.accent + '40',
    flexShrink: 0,
  },
  aiDescBtnText: { fontSize: 10, color: Colors.accent, fontWeight: Typography.weight.semibold },
  content: { padding: Spacing.base, gap: Spacing.lg },
  section: { backgroundColor: Colors.surface, borderRadius: Radius.xxl, padding: Spacing.base, gap: Spacing.sm, borderWidth: 1, borderColor: Colors.surfaceBorder, ...Shadow.sm },
  photoRow: { gap: Spacing.sm, paddingVertical: Spacing.xs },
  photoWrap: { position: 'relative' },
  photo: { width: 80, height: 80, borderRadius: Radius.md },
  mainPhotoBadge: { position: 'absolute', bottom: 4, left: 4, backgroundColor: Colors.primary, borderRadius: Radius.pill, paddingHorizontal: 5, paddingVertical: 2 },
  mainPhotoText: { fontSize: 8, fontWeight: Typography.weight.bold, color: Colors.background },
  noPhotos: { height: 80, backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.xl, alignItems: 'center', justifyContent: 'center', gap: 6, flexDirection: 'row' },
  noPhotosText: { fontSize: Typography.size.xs, color: Colors.textTertiary, flex: 1 },
  photoHint: { fontSize: 10, color: Colors.textTertiary, lineHeight: 14 },
  typeRow: { flexDirection: 'row', gap: Spacing.sm },
  typeBtn: { flex: 1, backgroundColor: Colors.surface, borderRadius: Radius.xl, borderWidth: 2, borderColor: Colors.surfaceBorder, padding: Spacing.md, alignItems: 'center', gap: Spacing.xs },
  typeBtnActive: { borderColor: Colors.primary, backgroundColor: Colors.primaryDim },
  typeBtnLabel: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.textSecondary },
  typeBtnDesc: { fontSize: 9, color: Colors.textTertiary, textAlign: 'center' },
  durationRow: { flexDirection: 'row', gap: Spacing.sm, marginTop: 2 },
  durationChip: { flex: 1, height: 36, borderRadius: Radius.md, backgroundColor: Colors.surfaceHighlight, borderWidth: 1.5, borderColor: Colors.surfaceBorder, alignItems: 'center', justifyContent: 'center' },
  durationChipActive: { borderColor: Colors.primary, backgroundColor: Colors.primaryDim },
  durationText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.textTertiary },
  input: { backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.surfaceBorder, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, fontSize: Typography.size.sm, color: Colors.textPrimary, includeFontPadding: false },
  descInput: { minHeight: 120, lineHeight: 20 },
  titleFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 },
  charCount: { fontSize: 10 },
  charCountRight: { fontSize: 10, color: Colors.textTertiary, textAlign: 'right', marginTop: 2 },
  resetLink: { fontSize: 10, color: Colors.primary },
  priceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  priceField: { flex: 1, minWidth: 100, gap: 4 },
  priceInputWrap: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.surfaceBorder, paddingHorizontal: Spacing.sm, paddingVertical: Spacing.sm },
  priceCurrency: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.textSecondary },
  priceInput: { flex: 1, fontSize: Typography.size.sm, color: Colors.textPrimary, includeFontPadding: false, paddingVertical: 0 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.md, padding: Spacing.md },
  toggleLabel: { fontSize: Typography.size.sm, color: Colors.textPrimary, fontWeight: Typography.weight.medium },
  toggleHint: { fontSize: 10, color: Colors.textTertiary, marginTop: 1 },
  toggle: { paddingHorizontal: Spacing.md, paddingVertical: 5, borderRadius: Radius.pill, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.surfaceBorder },
  toggleActive: { backgroundColor: Colors.primaryDim, borderColor: Colors.primary + '60' },
  toggleText: { fontSize: Typography.size.xs, color: Colors.textSecondary, fontWeight: Typography.weight.semibold },
  simpleDeliveryCard: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, backgroundColor: Colors.successDim, borderRadius: Radius.md, padding: Spacing.sm, borderWidth: 1, borderColor: Colors.success + '30' },
  simpleDeliveryText: { flex: 1, fontSize: 10, color: Colors.success, lineHeight: 15 },
  categorySelector: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.md, padding: Spacing.md, borderWidth: 1, borderColor: Colors.surfaceBorder },
  aiSuggestBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: Colors.accentDim, borderRadius: Radius.pill,
    paddingHorizontal: Spacing.sm, paddingVertical: 5,
    borderWidth: 1, borderColor: Colors.accent + '40',
  },
  aiSuggestBtnText: { fontSize: 11, color: Colors.accent, fontWeight: Typography.weight.semibold },
  categoryName: { fontSize: Typography.size.sm, color: Colors.textPrimary, fontWeight: Typography.weight.medium },
  categoryId: { fontSize: 10, color: Colors.textTertiary, marginTop: 2 },
  conditionRow: { flexDirection: 'row', gap: Spacing.xs, paddingVertical: 2 },
  conditionChip: { paddingHorizontal: Spacing.md, paddingVertical: 7, borderRadius: Radius.pill, backgroundColor: Colors.surfaceHighlight, borderWidth: 1.5, borderColor: Colors.surfaceBorder },
  conditionChipActive: { borderColor: Colors.primary, backgroundColor: Colors.primaryDim },
  conditionText: { fontSize: Typography.size.xs, color: Colors.textSecondary, fontWeight: Typography.weight.medium },
  specificsNote: { fontSize: 10, color: Colors.textTertiary, lineHeight: 14 },
  intelligenceCard: { backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.xl, padding: Spacing.md, gap: Spacing.xs },
  intelRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  intelLabel: { width: 80, fontSize: Typography.size.xs, color: Colors.textTertiary },
  intelValue: { flex: 1, fontSize: Typography.size.xs, color: Colors.textSecondary },
  revisionNote: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, backgroundColor: Colors.infoDim, borderRadius: Radius.xl, padding: Spacing.base, borderWidth: 1, borderColor: Colors.info + '30' },
  revisionNoteText: { flex: 1, fontSize: Typography.size.xs, color: Colors.textSecondary, lineHeight: 17 },
  bottomActions: { flexDirection: 'column', gap: Spacing.sm, paddingTop: Spacing.sm },
  bottomSaveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, backgroundColor: Colors.surface, borderRadius: Radius.md, paddingVertical: Spacing.base, borderWidth: 1.5, borderColor: Colors.primary },
  bottomSaveBtnText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.primary },
  bottomReviseBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, backgroundColor: Colors.primary, borderRadius: Radius.md, paddingVertical: Spacing.base },
  bottomReviseBtnText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.background },
});
