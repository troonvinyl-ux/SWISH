// SWISH Inventory Screen — Niche-Aware
//
// Every element adapts to the active niche:
//   - Theme colours, icons, labels
//   - Filtered to show only that niche's specialist_id items
//   - Niche-specific meta chips on cards (bike fields, MX fields, clothing fields, coin fields)
//   - Niche-specific sub-filters
//   - Niche-specific empty states and CTAs
//
// ACTIVE VIEW: Draft + Live items
// HISTORY VIEW: Sold + Archived items

import React, { useState, useCallback, useMemo, useRef } from 'react';
import {
  View, Text, StyleSheet, FlatList, Pressable,
  TextInput, ScrollView, ActivityIndicator, RefreshControl,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import { ItemImage } from '@/components';
import { useInventory } from '@/hooks/useInventory';
import {
  listItems, ITEM_LIFECYCLE, ACTIVE_INVENTORY_STATUSES, HISTORY_STATUSES,
} from '@/services/itemService';
import { useApp } from '@/hooks/useApp';
import { getSupabaseClient } from '@/template';
import {
  fetchAndStoreEbayImages, tenantNeedsImageSync,
} from '@/services/ebayImageService';
import { Colors, Typography, Spacing, Radius, Shadow } from '@/constants/theme';
import BulkReValueSheet from '@/components/feature/BulkReValueSheet';
import BulkReIdentifyModal from '@/components/feature/BulkReIdentifyModal';
import { useBusinessConfig } from '@/hooks/useBusiness';

// ── Niche theme resolver ──────────────────────────────────────────────────────

interface NicheTheme {
  accent: string;
  accentDim: string;
  icon: string;
  label: string;
  itemLabel: string;
  itemsLabel: string;
  specialistIds: string[];   // filter inventory to these specialists
  subFilters: Array<{ label: string; value: string; search: string }>;
  metaKeys: Array<{ key: string; label: string; icon: string; color?: string }>;
  scanRoute: string;
  uniqueBanner?: {
    icon: string; title: string; sub: string; route: string;
  };
}

function getNicheTheme(activeNicheId: string | null | undefined): NicheTheme {
  const id = (activeNicheId ?? '').toLowerCase();

  if (id.includes('coin') || id === 'gold' || id === 'silver' || id === 'banknotes' || id === 'islamic_silver') {
    return {
      accent: '#F5C842',
      accentDim: '#2A2000',
      icon: 'toll',
      label: 'Coin Inventory',
      itemLabel: 'Coin',
      itemsLabel: 'Coins',
      specialistIds: ['coins', 'coins_uk', 'coins_world', 'islamic_silver', 'banknotes', 'gold', 'silver', 'ancient_artefacts', 'curiosities_collectibles'],
      subFilters: [
        { label: 'All Types', value: 'all', search: '' },
        { label: 'Silver', value: 'silver', search: 'silver' },
        { label: 'Gold', value: 'gold', search: 'gold' },
        { label: 'British', value: 'british', search: 'british' },
        { label: 'Ancient', value: 'ancient', search: 'ancient' },
        { label: 'Islamic', value: 'islamic', search: 'islamic' },
        { label: 'Medieval', value: 'medieval', search: 'medieval' },
        { label: 'Roman', value: 'roman', search: 'roman' },
      ],
      metaKeys: [
        { key: 'ruler', label: '', icon: 'person', color: Colors.textTertiary },
        { key: 'denomination', label: '', icon: 'monetization-on', color: '#F5C842' },
        { key: 'year_made', label: '', icon: '', color: Colors.textTertiary },
        { key: 'country_of_origin', label: '', icon: 'place', color: Colors.textTertiary },
      ],
      scanRoute: '/(tabs)/scan',
      uniqueBanner: {
        icon: 'toll', title: 'Islamic & Indian Silver',
        sub: 'Zeno · Numista · Evidence-based · Countermark analysis',
        route: '/islamic-batch',
      },
    };
  }

  if (id === 'motocross' || id === 'mx') {
    return {
      accent: '#FF5500',
      accentDim: '#2A0A00',
      icon: 'two-wheeler',
      label: 'MX Inventory',
      itemLabel: 'Bike',
      itemsLabel: 'MX Bikes',
      specialistIds: ['motocross'],
      subFilters: [
        { label: 'All MX', value: 'all', search: '' },
        { label: 'Running', value: 'running', search: 'rideable' },
        { label: 'Project', value: 'project', search: 'project' },
        { label: '2-Stroke', value: '2stroke', search: '2-stroke' },
        { label: '4-Stroke', value: '4stroke', search: '4-stroke' },
        { label: 'Parts', value: 'parts', search: 'parts' },
      ],
      metaKeys: [
        { key: 'manufacturer', label: '', icon: 'business', color: '#FF5500' },
        { key: 'engine_size', label: '', icon: 'speed', color: Colors.textTertiary },
        { key: 'year_made', label: '', icon: 'calendar-today', color: Colors.textTertiary },
        { key: 'rideable_status', label: '', icon: 'two-wheeler', color: '#FF5500' },
      ],
      scanRoute: '/flipper-mx',
      uniqueBanner: {
        icon: 'calculate', title: 'MX Acquisition Calculator',
        sub: 'Price · Repair costs · Profit estimate before you buy',
        route: '/mx-acquisition',
      },
    };
  }

  if (id === 'bicycles' || id === 'cycling' || id === 'bikes') {
    return {
      accent: '#6ED020',
      accentDim: '#0A2000',
      icon: 'pedal-bike',
      label: 'Bike Inventory',
      itemLabel: 'Bike',
      itemsLabel: 'Bikes',
      specialistIds: ['bicycles', 'cycling'],
      subFilters: [
        { label: 'All Bikes', value: 'all', search: '' },
        { label: 'Mountain', value: 'mtb', search: 'mountain' },
        { label: 'Road', value: 'road', search: 'road' },
        { label: 'Hybrid', value: 'hybrid', search: 'hybrid' },
        { label: 'BMX', value: 'bmx', search: 'bmx' },
        { label: 'Electric', value: 'electric', search: 'electric' },
        { label: 'Parts', value: 'parts', search: 'parts' },
      ],
      metaKeys: [
        { key: 'manufacturer', label: '', icon: 'business', color: '#6ED020' },
        { key: 'frame_size', label: '', icon: 'straighten', color: Colors.textTertiary },
        { key: 'groupset', label: '', icon: 'settings', color: Colors.textTertiary },
        { key: 'wheel_size', label: '', icon: 'radio-button-unchecked', color: Colors.textTertiary },
      ],
      scanRoute: '/bike-flipper',
      uniqueBanner: undefined,
    };
  }

  if (id === 'clothing' || id === 'fashion' || id === 'trainers_sneakers' || id === 'trainers') {
    return {
      accent: '#E91E8C',
      accentDim: '#250014',
      icon: 'checkroom',
      label: 'Fashion Inventory',
      itemLabel: 'Item',
      itemsLabel: 'Items',
      specialistIds: ['clothing', 'trainers_sneakers'],
      subFilters: [
        { label: 'All Items', value: 'all', search: '' },
        { label: 'Vintage', value: 'vintage', search: 'vintage' },
        { label: 'Designer', value: 'designer', search: 'designer' },
        { label: 'Streetwear', value: 'streetwear', search: 'streetwear' },
        { label: 'Trainers', value: 'trainers', search: 'trainer' },
        { label: 'Accessories', value: 'accessories', search: 'accessory' },
      ],
      metaKeys: [
        { key: 'brand', label: '', icon: 'label', color: '#E91E8C' },
        { key: 'era', label: '', icon: 'history', color: Colors.textTertiary },
        { key: 'size', label: '', icon: 'straighten', color: Colors.textTertiary },
        { key: 'authenticity_risk_level', label: '', icon: 'verified', color: Colors.textTertiary },
      ],
      scanRoute: '/threads-flip',
      uniqueBanner: undefined,
    };
  }

  // Default / general
  return {
    accent: Colors.primary,
    accentDim: Colors.primaryDim,
    icon: 'inventory',
    label: 'Inventory',
    itemLabel: 'Item',
    itemsLabel: 'Items',
    specialistIds: [],   // empty = no specialist filter
    subFilters: [
      { label: 'All', value: 'all', search: '' },
    ],
    metaKeys: [],
    scanRoute: '/(tabs)/scan',
    uniqueBanner: undefined,
  };
}

// ── Status helpers ────────────────────────────────────────────────────────────

function getLifecycleChip(status: string): { label: string; color: string } {
  if (ITEM_LIFECYCLE.LIVE_STATUSES.includes(status)) return { label: 'Live', color: Colors.success };
  if (ITEM_LIFECYCLE.SOLD_STATUSES.includes(status)) return { label: 'Sold', color: Colors.accent };
  if (ITEM_LIFECYCLE.ARCHIVED_STATUSES.includes(status)) return { label: 'Archived', color: Colors.textTertiary };
  if (status === 'review_required') return { label: 'Review', color: Colors.danger };
  return { label: 'Draft', color: Colors.primary };
}

function getDraftSubLabel(status: string): string {
  const map: Record<string, string> = {
    new: 'New', captured: 'Captured', identified: 'Identified',
    priced: 'Ready to List', review_required: 'Needs Review',
  };
  return map[status] ?? status;
}

// ── Niche meta chip row ───────────────────────────────────────────────────────

function NicheMetaRow({ item, theme }: { item: any; theme: NicheTheme }) {
  const attrs = item.attributes ?? {};

  const getValue = (key: string): string | null => {
    // Direct fields first
    const directMap: Record<string, string> = {
      ruler: item.ruler, denomination: item.denomination,
      year_made: item.year_made, country_of_origin: item.country_of_origin,
      manufacturer: item.manufacturer,
    };
    if (directMap[key] !== undefined) return directMap[key] || null;
    return attrs[key] ? String(attrs[key]) : null;
  };

  const chips = theme.metaKeys
    .map(mk => ({ ...mk, value: getValue(mk.key) }))
    .filter(c => c.value);

  if (chips.length === 0) return null;

  return (
    <View style={nm.row}>
      {chips.map((chip, i) => (
        <View key={i} style={nm.chip}>
          {chip.icon ? (
            <MaterialIcons name={chip.icon as any} size={9} color={chip.color ?? Colors.textTertiary} />
          ) : null}
          <Text style={[nm.text, chip.color ? { color: chip.color } : null]} numberOfLines={1}>
            {chip.value}
          </Text>
        </View>
      ))}
    </View>
  );
}

const nm = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.sm,
    paddingHorizontal: 4, paddingVertical: 2,
  },
  text: { fontSize: 9, color: Colors.textTertiary, maxWidth: 80 },
});

// ── Niche Item Card ───────────────────────────────────────────────────────────

function NicheItemCard({ item, onPress, theme }: { item: any; onPress: (id: string) => void; theme: NicheTheme }) {
  const router = useRouter();
  const chip = getLifecycleChip(item.status);
  const hasPhoto = item.media && item.media.length > 0;
  const isLive = chip.label === 'Live';
  const isSold = chip.label === 'Sold';
  const isDraft = chip.label === 'Draft' || chip.label === 'Review';

  const ebayPrice = item.listing_price ? Number(item.listing_price) : null;
  const ebayWatchers = item.listing_watchers != null ? Number(item.listing_watchers) : null;

  return (
    <Pressable
      onPress={() => onPress(item.id)}
      style={({ pressed }) => [
        cs.card,
        { borderLeftWidth: 3, borderLeftColor: isLive ? Colors.success : isSold ? Colors.accent : theme.accent + '60' },
        pressed && { opacity: 0.9, transform: [{ scale: 0.99 }] },
        isSold && { opacity: 0.7 },
      ]}
    >
      {/* Thumbnail */}
      <View style={cs.thumbWrap}>
        {hasPhoto ? (
          <ItemImage uri={item.media[0]} style={cs.thumb} contentFit="cover" transition={150} />
        ) : (
          <View style={[cs.thumbPlaceholder, { backgroundColor: theme.accentDim }]}>
            <MaterialIcons
              name={isDraft ? theme.icon as any : isLive ? 'storefront' : 'check-circle'}
              size={20}
              color={isDraft ? theme.accent : isLive ? Colors.success : Colors.accent}
            />
          </View>
        )}
        <View style={[cs.statusDot, { backgroundColor: chip.color }]} />
        {isLive ? (
          <View style={cs.ebayDot}><Text style={cs.ebayDotText}>e</Text></View>
        ) : null}
        {(item.media?.length ?? 0) >= 2 ? (
          <View style={cs.photoBadge}>
            <MaterialIcons name="photo-library" size={8} color="#fff" />
            <Text style={cs.photoBadgeText}>{item.media.length}</Text>
          </View>
        ) : null}
      </View>

      {/* Content */}
      <View style={cs.content}>
        {/* ID badges */}
        <View style={cs.topRow}>
          {item.inventory_id ? (
            <View style={[cs.idBadge, { backgroundColor: theme.accentDim, borderColor: theme.accent + '40' }]}>
              <Text style={[cs.idBadgeText, { color: theme.accent }]}>{item.inventory_id}</Text>
            </View>
          ) : null}
          {item.catalogue_number ? (
            <View style={cs.catBadge}>
              <MaterialIcons name="tag" size={9} color={Colors.accent} />
              <Text style={cs.catBadgeText}>{item.catalogue_number}</Text>
            </View>
          ) : null}
        </View>

        {/* Title */}
        {(() => {
          const title = item.canonicalTitle || item.canonical_title || '';
          return title && title.length > 2 ? (
            <Text style={[cs.title, isSold && { color: Colors.textTertiary }]} numberOfLines={2}>{title}</Text>
          ) : (
            <Text style={[cs.title, { color: isLive ? Colors.warning : Colors.textTertiary, fontStyle: 'italic' }]} numberOfLines={1}>
              {isLive ? 'Sync from eBay to get title' : 'No title'}
            </Text>
          );
        })()}

        {/* eBay stats (live) or niche meta (draft) */}
        {isLive ? (
          <View style={cs.ebayRow}>
            {item.condition ? (
              <View style={cs.condChip}><Text style={cs.condText} numberOfLines={1}>{item.condition}</Text></View>
            ) : null}
            {(ebayWatchers ?? 0) > 0 ? (
              <View style={cs.statChip}>
                <MaterialIcons name="star" size={9} color={Colors.gold} />
                <Text style={[cs.statText, { color: Colors.gold }]}>{ebayWatchers}</Text>
              </View>
            ) : null}
          </View>
        ) : (
          <NicheMetaRow item={item} theme={theme} />
        )}

        {/* Bottom row */}
        <View style={cs.bottomRow}>
          <View style={[cs.statusChip, { backgroundColor: chip.color + '20' }]}>
            <View style={[cs.statusDotSmall, { backgroundColor: chip.color }]} />
            <Text style={[cs.statusText, { color: chip.color }]}>
              {chip.label === 'Draft' ? getDraftSubLabel(item.status) : chip.label}
            </Text>
          </View>
          {isSold && item.sold_price ? (
            <Text style={cs.soldPrice}>Sold £{Number(item.sold_price).toFixed(2)}</Text>
          ) : isLive && ebayPrice ? (
            <Text style={[cs.price, { color: theme.accent }]}>£{ebayPrice.toFixed(2)}</Text>
          ) : item.expected_selling_price > 0 ? (
            <Text style={[cs.price, { color: theme.accent }]}>£{Number(item.expected_selling_price).toFixed(2)}</Text>
          ) : null}
        </View>
      </View>

      {/* Create listing shortcut */}
      {!isLive && !isSold && chip.label !== 'Archived' ? (
        <Pressable
          onPress={e => { (e as any).stopPropagation?.(); router.push(`/create-listing?id=${item.id}` as any); }}
          style={({ pressed }) => [cs.listBtn, { borderColor: theme.accent + '40', backgroundColor: theme.accentDim }, pressed && { opacity: 0.8 }]}
        >
          <MaterialIcons name="sell" size={11} color={theme.accent} />
          <Text style={[cs.listBtnText, { color: theme.accent }]}>List</Text>
        </Pressable>
      ) : null}

      <MaterialIcons name="chevron-right" size={16} color={Colors.textTertiary} />
    </Pressable>
  );
}

const cs = StyleSheet.create({
  card: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.surface, borderRadius: Radius.xl,
    padding: Spacing.md, borderWidth: 1, borderColor: Colors.surfaceBorder,
    ...Shadow.sm,
  },
  thumbWrap: { position: 'relative', width: 60, height: 60, flexShrink: 0 },
  thumb: { width: 60, height: 60, borderRadius: Radius.md },
  thumbPlaceholder: {
    width: 60, height: 60, borderRadius: Radius.md,
    alignItems: 'center', justifyContent: 'center',
  },
  statusDot: {
    position: 'absolute', bottom: 2, right: 2,
    width: 8, height: 8, borderRadius: 4,
    borderWidth: 1.5, borderColor: Colors.surface,
  },
  statusDotSmall: { width: 5, height: 5, borderRadius: 3 },
  ebayDot: {
    position: 'absolute', top: 2, left: 2,
    width: 14, height: 14, borderRadius: 7,
    backgroundColor: '#E53238', alignItems: 'center', justifyContent: 'center',
  },
  ebayDotText: { fontSize: 8, fontWeight: Typography.weight.extrabold, color: '#fff' },
  photoBadge: {
    position: 'absolute', top: 3, right: 3,
    flexDirection: 'row', alignItems: 'center', gap: 2,
    backgroundColor: 'rgba(0,0,0,0.62)', borderRadius: Radius.pill,
    paddingHorizontal: 4, paddingVertical: 2,
  },
  photoBadgeText: { fontSize: 8, fontWeight: Typography.weight.bold, color: '#fff' },

  content: { flex: 1, gap: 4 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' },
  idBadge: { borderRadius: Radius.sm, paddingHorizontal: 5, paddingVertical: 2, borderWidth: 1 },
  idBadgeText: { fontSize: 9, fontWeight: Typography.weight.bold, letterSpacing: 0.4 },
  catBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    backgroundColor: Colors.accentDim, borderRadius: Radius.sm,
    paddingHorizontal: 5, paddingVertical: 2,
  },
  catBadgeText: { fontSize: 9, color: Colors.accent, fontWeight: Typography.weight.semibold },

  title: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.textPrimary, lineHeight: 17 },
  ebayRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  condChip: { backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.sm, paddingHorizontal: 5, paddingVertical: 2, maxWidth: 100 },
  condText: { fontSize: 9, color: Colors.textTertiary },
  statChip: { flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.sm, paddingHorizontal: 4, paddingVertical: 2 },
  statText: { fontSize: 9, fontWeight: Typography.weight.semibold },

  bottomRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  statusChip: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: Radius.pill, paddingHorizontal: 7, paddingVertical: 3 },
  statusText: { fontSize: 9, fontWeight: Typography.weight.bold },
  price: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, marginLeft: 'auto' as any },
  soldPrice: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.accent, marginLeft: 'auto' as any },

  listBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: Radius.sm, paddingHorizontal: 7, paddingVertical: 4, borderWidth: 1, marginLeft: -Spacing.xs },
  listBtnText: { fontSize: 10, fontWeight: Typography.weight.semibold },
});

// ── History card (compact) ────────────────────────────────────────────────────

function HistoryCard({ item, onPress, theme }: { item: any; onPress: (id: string) => void; theme: NicheTheme }) {
  const chip = getLifecycleChip(item.status);
  const hasPhoto = item.media && item.media.length > 0;
  const soldAt = item.sold_at
    ? new Date(item.sold_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })
    : null;

  return (
    <Pressable onPress={() => onPress(item.id)} style={({ pressed }) => [hc.card, pressed && { opacity: 0.85 }]}>
      {hasPhoto ? (
        <ItemImage uri={item.media[0]} style={hc.thumb} contentFit="cover" transition={100} />
      ) : (
        <View style={[hc.thumb, hc.thumbPlaceholder]}>
          <MaterialIcons name={theme.icon as any} size={16} color={theme.accent} />
        </View>
      )}
      <View style={hc.content}>
        <Text style={hc.title} numberOfLines={1}>{item.canonical_title}</Text>
        <View style={hc.meta}>
          {soldAt ? <Text style={hc.date}>{soldAt}</Text> : null}
          {item.inventory_id ? <Text style={hc.id}>{item.inventory_id}</Text> : null}
        </View>
      </View>
      <View style={hc.right}>
        {item.sold_price ? (
          <Text style={hc.price}>£{Number(item.sold_price).toFixed(2)}</Text>
        ) : item.expected_selling_price > 0 ? (
          <Text style={hc.price}>£{Number(item.expected_selling_price).toFixed(2)}</Text>
        ) : null}
        <View style={[hc.chip, { backgroundColor: chip.color + '20' }]}>
          <Text style={[hc.chipText, { color: chip.color }]}>{chip.label}</Text>
        </View>
      </View>
    </Pressable>
  );
}

const hc = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.sm },
  thumb: { width: 44, height: 44, borderRadius: Radius.md, flexShrink: 0 },
  thumbPlaceholder: { backgroundColor: Colors.surfaceHighlight, alignItems: 'center', justifyContent: 'center' },
  content: { flex: 1, gap: 3 },
  title: { fontSize: Typography.size.sm, fontWeight: Typography.weight.medium, color: Colors.textSecondary },
  meta: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  date: { fontSize: 10, color: Colors.textTertiary },
  id: { fontSize: 10, color: Colors.textTertiary, fontStyle: 'italic' },
  right: { alignItems: 'flex-end', gap: 4 },
  price: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.textSecondary },
  chip: { borderRadius: Radius.pill, paddingHorizontal: 7, paddingVertical: 3 },
  chipText: { fontSize: 9, fontWeight: Typography.weight.semibold },
});

// ── Main Screen ───────────────────────────────────────────────────────────────

type ViewMode = 'active' | 'history';
type ActiveFilter = 'all' | 'draft' | 'live' | 'needs_id' | 'needs_value' | 'review';
type HistoryFilter = 'all' | 'sold' | 'archived';

export default function InventoryScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { tenant, activeNicheId } = useApp();
  const theme = useMemo(() => getNicheTheme(activeNicheId), [activeNicheId]);

  const [viewMode, setViewMode] = useState<ViewMode>('active');
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>('all');
  const [nicheSubFilter, setNicheSubFilter] = useState('all');
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>('all');
  const [search, setSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [historyItems, setHistoryItems] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [showReValue, setShowReValue] = useState(false);
  const [showBulkReIdentify, setShowBulkReIdentify] = useState(false);
  const [bulkReIdentifyProgress, setBulkReIdentifyProgress] = useState<any>(null);
  const [syncBanner, setSyncBanner] = useState<string | null>(null);
  const imageSyncRunning = useRef(false);
  const { config: bizConfig } = useBusinessConfig();
  const autonomousMode = bizConfig?.auto_value === true || bizConfig?.automation_level === 'autonomous';

  // Build niche sub-filter search term
  const nicheSubSearch = useMemo(() => {
    const f = theme.subFilters.find(sf => sf.value === nicheSubFilter);
    return f?.search ?? '';
  }, [nicheSubFilter, theme.subFilters]);

  // Build inventory filter
  const inventoryFilter = useMemo(() => {
    const f: any = {};
    if (activeFilter === 'draft') f.statuses = ITEM_LIFECYCLE.DRAFT_STATUSES;
    else if (activeFilter === 'live') f.statuses = ITEM_LIFECYCLE.LIVE_STATUSES;
    else if (activeFilter === 'review') f.statuses = ['review_required'];
    else f.lifecycleGroup = 'active';

    // Combine search + niche sub-filter
    const parts: string[] = [];
    if (search.trim()) parts.push(search.trim());
    if (nicheSubSearch) parts.push(nicheSubSearch);
    if (parts.length > 0) f.search = parts[0];

    // Niche specialist filter
    if (theme.specialistIds.length > 0) {
      f.specialistIds = theme.specialistIds;
    }

    return f;
  }, [activeFilter, search, nicheSubSearch, theme.specialistIds]);

  const { items: rawItems, loading, stats, statusGroups, reload } = useInventory(inventoryFilter);

  // Post-filter for needs_id / needs_value
  const items = useMemo(() => {
    if (activeFilter === 'needs_id') {
      return rawItems.filter((i: any) => !i.identificationConfidence || Number(i.identificationConfidence) < 0.50);
    }
    if (activeFilter === 'needs_value') {
      return rawItems.filter((i: any) => !i.valuationMid && !i.valuation_mid);
    }
    return rawItems;
  }, [rawItems, activeFilter]);

  const needsIdCount = useMemo(() => rawItems.filter((i: any) => !i.identificationConfidence || Number(i.identificationConfidence) < 0.50).length, [rawItems]);
  const needsValueCount = useMemo(() => rawItems.filter((i: any) => !i.valuationMid && !i.valuation_mid).length, [rawItems]);

  const loadHistory = useCallback(async () => {
    if (!tenant?.id) return;
    setHistoryLoading(true);
    let statuses: string[];
    if (historyFilter === 'sold') statuses = ITEM_LIFECYCLE.SOLD_STATUSES;
    else if (historyFilter === 'archived') statuses = ITEM_LIFECYCLE.ARCHIVED_STATUSES;
    else statuses = HISTORY_STATUSES;

    const f: any = { statuses };
    if (search.trim()) f.search = search.trim();
    if (theme.specialistIds.length > 0) f.specialistIds = theme.specialistIds;

    const { items: hist } = await listItems(tenant.id, f);
    setHistoryItems(hist);
    setHistoryLoaded(true);
    setHistoryLoading(false);
  }, [tenant?.id, historyFilter, search, theme.specialistIds]);

  const handleViewMode = useCallback((mode: ViewMode) => {
    setViewMode(mode);
    if (mode === 'history') loadHistory();
  }, [loadHistory]);

  const handleHistoryFilter = useCallback((f: HistoryFilter) => {
    setHistoryFilter(f);
    setHistoryLoaded(false);
  }, []);

  React.useEffect(() => {
    if (viewMode === 'history' && !historyLoaded) loadHistory();
  }, [viewMode, historyLoaded, loadHistory]);

  // Reset sub-filter when niche changes
  React.useEffect(() => {
    setNicheSubFilter('all');
  }, [activeNicheId]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    if (viewMode === 'active') await reload?.();
    else { setHistoryLoaded(false); await loadHistory(); }
    setRefreshing(false);

    if (viewMode === 'active' && tenant?.id && !imageSyncRunning.current) {
      imageSyncRunning.current = true;
      const tenantId = tenant.id;
      (async () => {
        try {
          const needs = await tenantNeedsImageSync(tenantId);
          if (needs) {
            setSyncBanner('Syncing eBay images...');
            await fetchAndStoreEbayImages(tenantId, { fixTitles: true });
            setSyncBanner(null);
            await reload?.();
          }
        } catch { setSyncBanner(null); }
        finally { imageSyncRunning.current = false; }
      })();
    }
  }, [viewMode, reload, loadHistory, tenant?.id]);

  const ACTIVE_FILTERS: Array<{ label: string; value: ActiveFilter; color: string; count: number }> = [
    { label: 'All', value: 'all', color: theme.accent, count: stats.activeTotal },
    { label: 'Draft', value: 'draft', color: Colors.textSecondary, count: stats.draftCount },
    { label: 'Live', value: 'live', color: Colors.success, count: stats.liveCount },
    { label: 'Needs ID', value: 'needs_id', color: Colors.warning, count: needsIdCount },
    { label: 'Needs Value', value: 'needs_value', color: Colors.gold, count: needsValueCount },
    { label: 'Review', value: 'review', color: Colors.danger, count: statusGroups?.['review_required'] ?? 0 },
  ];

  const HISTORY_FILTERS: Array<{ label: string; value: HistoryFilter; color: string; count: number }> = [
    { label: 'All History', value: 'all', color: Colors.textSecondary, count: stats.soldCount + stats.archivedCount },
    { label: 'Sold', value: 'sold', color: Colors.accent, count: stats.soldCount },
    { label: 'Archived', value: 'archived', color: Colors.textTertiary, count: stats.archivedCount },
  ];

  return (
    <View style={s.container}>
      <StatusBar style="light" />

      {/* ── Niche-branded header ────────────────────────────────────── */}
      <View style={[s.header, { paddingTop: insets.top + Spacing.base, borderBottomColor: theme.accent + '30' }]}>
        <View style={[s.headerIcon, { backgroundColor: theme.accentDim }]}>
          <MaterialIcons name={theme.icon as any} size={18} color={theme.accent} />
        </View>
        <View style={s.headerText}>
          <Text style={[s.title, { color: theme.accent }]}>{theme.label}</Text>
          <Text style={s.subtitle}>
            {viewMode === 'active'
              ? `${stats.activeTotal} active · ${stats.draftCount} draft · ${stats.liveCount} live`
              : `${historyItems.length} ${historyFilter} items`}
          </Text>
        </View>
        <View style={s.headerActions}>
          {viewMode === 'active' && stats.activeTotal > 0 ? (
            <Pressable onPress={() => setShowReValue(true)} style={[s.hBtn, { backgroundColor: theme.accentDim, borderColor: theme.accent + '50' }]} hitSlop={8}>
              <MaterialIcons name="travel-explore" size={16} color={theme.accent} />
            </Pressable>
          ) : null}
          {viewMode === 'active' && items.length > 0 ? (
            <Pressable onPress={() => setShowBulkReIdentify(true)} style={[s.hBtn, { backgroundColor: Colors.accentDim, borderColor: Colors.accent + '60' }]} hitSlop={8}>
              <MaterialIcons name="auto-awesome" size={16} color={Colors.accent} />
            </Pressable>
          ) : null}
          <Pressable onPress={() => router.push(theme.scanRoute as any)} style={[s.hBtn, { backgroundColor: theme.accent }]} hitSlop={8}>
            <MaterialIcons name="add" size={18} color="#000" />
          </Pressable>
        </View>
      </View>

      {/* ── Stats strip ─────────────────────────────────────────────── */}
      <View style={[s.statsStrip, { borderBottomColor: theme.accent + '20' }]}>
        {[
          { label: 'Active', value: stats.activeTotal, color: theme.accent, mode: 'active' as ViewMode },
          { label: 'Draft', value: stats.draftCount, color: Colors.textSecondary, mode: 'active' as ViewMode },
          { label: 'Live', value: stats.liveCount, color: Colors.success, mode: 'active' as ViewMode },
          { label: 'Sold', value: stats.soldCount, color: Colors.accent, mode: 'history' as ViewMode },
        ].map((st, i) => (
          <Pressable
            key={st.label}
            onPress={() => handleViewMode(st.mode)}
            style={[s.statItem, viewMode === st.mode && i === 0 ? s.statItemActive : viewMode === st.mode && i === 3 ? s.statItemActive : null]}
          >
            <Text style={[s.statVal, { color: st.color }]}>{st.value}</Text>
            <Text style={s.statLabel}>{st.label}</Text>
          </Pressable>
        ))}
      </View>

      {/* ── View mode tabs ───────────────────────────────────────────── */}
      <View style={s.modeTabs}>
        <Pressable
          onPress={() => handleViewMode('active')}
          style={[s.modeTab, viewMode === 'active' && { backgroundColor: theme.accentDim, borderColor: theme.accent + '50' }]}
        >
          <MaterialIcons name="inventory" size={14} color={viewMode === 'active' ? theme.accent : Colors.textTertiary} />
          <Text style={[s.modeTabText, viewMode === 'active' && { color: theme.accent, fontWeight: Typography.weight.semibold }]}>
            Active {theme.itemsLabel}
          </Text>
          {stats.activeTotal > 0 ? (
            <View style={[s.modeTabBadge, viewMode === 'active' && { backgroundColor: theme.accent + '30' }]}>
              <Text style={[s.modeTabBadgeText, viewMode === 'active' && { color: theme.accent }]}>{stats.activeTotal}</Text>
            </View>
          ) : null}
        </Pressable>
        <Pressable
          onPress={() => handleViewMode('history')}
          style={[s.modeTab, viewMode === 'history' && { backgroundColor: Colors.accentDim, borderColor: Colors.accent + '50' }]}
        >
          <MaterialIcons name="history" size={14} color={viewMode === 'history' ? Colors.accent : Colors.textTertiary} />
          <Text style={[s.modeTabText, viewMode === 'history' && { color: Colors.accent, fontWeight: Typography.weight.semibold }]}>
            History
          </Text>
          {stats.soldCount > 0 ? (
            <View style={[s.modeTabBadge, viewMode === 'history' && { backgroundColor: Colors.accentDim }]}>
              <Text style={[s.modeTabBadgeText, viewMode === 'history' && { color: Colors.accent }]}>{stats.soldCount + stats.archivedCount}</Text>
            </View>
          ) : null}
        </Pressable>
      </View>

      {/* ── Search ───────────────────────────────────────────────────── */}
      <View style={s.searchWrap}>
        <MaterialIcons name="search" size={16} color={Colors.textTertiary} style={{ marginLeft: Spacing.sm }} />
        <TextInput
          style={s.searchInput}
          value={search}
          onChangeText={v => { setSearch(v); if (viewMode === 'history') setHistoryLoaded(false); }}
          placeholder={`Search ${theme.itemsLabel.toLowerCase()}...`}
          placeholderTextColor={Colors.textTertiary}
          clearButtonMode="while-editing"
          returnKeyType="search"
        />
        {search.length > 0 ? (
          <Pressable onPress={() => { setSearch(''); if (viewMode === 'history') setHistoryLoaded(false); }} hitSlop={8} style={{ marginRight: Spacing.sm }}>
            <MaterialIcons name="close" size={14} color={Colors.textTertiary} />
          </Pressable>
        ) : null}
      </View>

      {/* ── Unique niche banner ──────────────────────────────────────── */}
      {viewMode === 'active' && theme.uniqueBanner ? (
        <Pressable
          onPress={() => router.push(theme.uniqueBanner!.route as any)}
          style={({ pressed }) => [s.nicheBanner, { borderColor: theme.accent + '20', backgroundColor: theme.accentDim }, pressed && { opacity: 0.85 }]}
        >
          <View style={[s.nicheBannerIcon, { backgroundColor: theme.accent + '15' }]}>
            <MaterialIcons name={theme.uniqueBanner.icon as any} size={18} color={theme.accent} />
          </View>
          <View style={s.nicheBannerText}>
            <Text style={[s.nicheBannerTitle, { color: theme.accent }]}>{theme.uniqueBanner.title}</Text>
            <Text style={s.nicheBannerSub}>{theme.uniqueBanner.sub}</Text>
          </View>
          <MaterialIcons name="arrow-forward" size={14} color={theme.accent} />
        </Pressable>
      ) : null}

      {/* ── Status sub-filters ───────────────────────────────────────── */}
      <View style={s.filterOuter}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filterContent}>
          {(viewMode === 'active' ? ACTIVE_FILTERS : HISTORY_FILTERS).map(f => {
            const active = viewMode === 'active' ? activeFilter === f.value : historyFilter === f.value;
            return (
              <Pressable
                key={f.value}
                onPress={() => viewMode === 'active' ? setActiveFilter(f.value as ActiveFilter) : handleHistoryFilter(f.value as HistoryFilter)}
                style={[s.filterChip, active && { backgroundColor: f.color + '20', borderColor: f.color + '50' }]}
              >
                <View style={[s.filterDot, { backgroundColor: active ? f.color : Colors.textTertiary }]} />
                <Text style={[s.filterLabel, active && { color: f.color }]}>{f.label}</Text>
                {f.count > 0 ? <Text style={[s.filterCount, active && { color: f.color }]}>{f.count}</Text> : null}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* ── Niche-specific sub-filters ───────────────────────────────── */}
      {viewMode === 'active' && theme.subFilters.length > 1 ? (
        <View style={[s.filterOuter, { borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder }]}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filterContent}>
            {theme.subFilters.map(sf => {
              const active = nicheSubFilter === sf.value;
              return (
                <Pressable
                  key={sf.value}
                  onPress={() => setNicheSubFilter(sf.value)}
                  style={[s.filterChip, active && { backgroundColor: theme.accentDim, borderColor: theme.accent + '60' }]}
                >
                  <Text style={[s.filterLabel, active && { color: theme.accent, fontWeight: Typography.weight.semibold }]}>
                    {sf.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      ) : null}

      {/* ── Bulk modals ──────────────────────────────────────────────── */}
      <BulkReIdentifyModal
        visible={showBulkReIdentify}
        items={items}
        tenantId={tenant?.id ?? ''}
        progress={bulkReIdentifyProgress}
        onProgress={setBulkReIdentifyProgress}
        onClose={() => { setShowBulkReIdentify(false); setBulkReIdentifyProgress(null); reload?.(); }}
      />
      {tenant?.id ? (
        <BulkReValueSheet
          visible={showReValue}
          onClose={() => { setShowReValue(false); reload?.(); }}
          tenantId={tenant.id}
          items={items.map((i: any) => ({
            id: i.id,
            canonical_title: i.canonicalTitle ?? '',
            specialist_id: i.specialistId ?? 'curiosities_collectibles',
            condition: i.condition ?? '',
            attributes: i.attributes ?? {},
            media: i.media ?? [],
          })).filter((i: any) => i.canonical_title && i.canonical_title.length > 3)}
          autonomousMode={autonomousMode}
        />
      ) : null}

      {/* ── Sync banner ──────────────────────────────────────────────── */}
      {syncBanner ? (
        <Pressable onPress={() => setSyncBanner(null)} style={[s.syncBanner, { borderBottomColor: theme.accent + '30', backgroundColor: theme.accentDim }]}>
          <ActivityIndicator size="small" color={theme.accent} style={{ width: 14, height: 14 }} />
          <Text style={[s.syncBannerText, { color: theme.accent }]}>{syncBanner}</Text>
          <MaterialIcons name="close" size={12} color={theme.accent} />
        </Pressable>
      ) : null}

      {/* ── Content ──────────────────────────────────────────────────── */}
      {viewMode === 'active' ? (
        loading ? (
          <View style={s.loading}><ActivityIndicator color={theme.accent} size="large" /></View>
        ) : (
          <FlatList
            data={items}
            keyExtractor={(i: any) => i.id}
            contentContainerStyle={[s.list, { paddingBottom: insets.bottom + 100 }]}
            showsVerticalScrollIndicator={false}
            ItemSeparatorComponent={() => <View style={{ height: Spacing.sm }} />}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.accent} />}
            renderItem={({ item }) => (
              <NicheItemCard item={item} onPress={id => router.push(`/stock-listing/${id}` as any)} theme={theme} />
            )}
            ListEmptyComponent={
              <View style={s.empty}>
                <View style={[s.emptyIcon, { backgroundColor: theme.accentDim }]}>
                  <MaterialIcons name={theme.icon as any} size={40} color={theme.accent} />
                </View>
                <Text style={[s.emptyTitle, { color: theme.accent }]}>
                  {search ? `No ${theme.itemsLabel.toLowerCase()} found` : `No ${theme.itemsLabel.toLowerCase()} yet`}
                </Text>
                <Text style={s.emptyText}>
                  {search
                    ? `No active ${theme.itemsLabel.toLowerCase()} match "${search}"`
                    : `Scan or identify your first ${theme.itemLabel.toLowerCase()} to get started`}
                </Text>
                <Pressable onPress={() => router.push(theme.scanRoute as any)} style={[s.emptyBtn, { backgroundColor: theme.accent }]}>
                  <MaterialIcons name="add" size={15} color="#000" />
                  <Text style={s.emptyBtnText}>Add {theme.itemLabel}</Text>
                </Pressable>
              </View>
            }
          />
        )
      ) : (
        historyLoading ? (
          <View style={s.loading}><ActivityIndicator color={Colors.accent} size="large" /></View>
        ) : (
          <FlatList
            data={historyItems}
            keyExtractor={(i: any) => i.id}
            contentContainerStyle={[s.list, { paddingBottom: insets.bottom + 100 }]}
            showsVerticalScrollIndicator={false}
            ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: Colors.surfaceBorder, marginLeft: 44 + Spacing.md }} />}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.accent} />}
            renderItem={({ item }) => (
              <HistoryCard item={item} onPress={id => router.push(`/stock-listing/${id}` as any)} theme={theme} />
            )}
            ListEmptyComponent={
              <View style={s.empty}>
                <View style={[s.emptyIcon, { backgroundColor: Colors.accentDim }]}>
                  <MaterialIcons name="history" size={40} color={Colors.accent} />
                </View>
                <Text style={s.emptyTitle}>{historyFilter === 'sold' ? `No sold ${theme.itemsLabel.toLowerCase()} yet` : 'No history yet'}</Text>
                <Text style={s.emptyText}>{historyFilter === 'sold' ? `${theme.itemsLabel} appear here once marked as sold` : 'Archived items appear here'}</Text>
              </View>
            }
          />
        )
      )}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },

  header: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingHorizontal: Spacing.base, paddingBottom: Spacing.md,
    borderBottomWidth: 1,
  },
  headerIcon: { width: 40, height: 40, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  headerText: { flex: 1 },
  title: { fontSize: Typography.size.xl, fontWeight: Typography.weight.bold },
  subtitle: { fontSize: Typography.size.xs, color: Colors.textTertiary, marginTop: 2 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  hBtn: { width: 34, height: 34, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },

  statsStrip: {
    flexDirection: 'row', paddingHorizontal: Spacing.base, paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
  },
  statItem: { flex: 1, alignItems: 'center', gap: 2 },
  statItemActive: {},
  statVal: { fontSize: Typography.size.md, fontWeight: Typography.weight.bold },
  statLabel: { fontSize: 9, color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.3 },

  modeTabs: {
    flexDirection: 'row', gap: Spacing.sm,
    paddingHorizontal: Spacing.base, paddingVertical: Spacing.sm,
    borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder,
  },
  modeTab: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: Spacing.xs, paddingVertical: Spacing.xs + 2,
    borderRadius: Radius.md, backgroundColor: Colors.surface,
    borderWidth: 1, borderColor: Colors.surfaceBorder,
  },
  modeTabText: { fontSize: Typography.size.xs, color: Colors.textTertiary, fontWeight: Typography.weight.medium },
  modeTabBadge: { backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.pill, paddingHorizontal: 5, paddingVertical: 1 },
  modeTabBadgeText: { fontSize: 9, fontWeight: Typography.weight.bold, color: Colors.textTertiary },

  searchWrap: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: Spacing.base, marginTop: Spacing.sm, marginBottom: Spacing.xs,
    backgroundColor: Colors.surface, borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.surfaceBorder, height: 40,
  },
  searchInput: {
    flex: 1, fontSize: Typography.size.sm, color: Colors.textPrimary,
    paddingVertical: 0, paddingHorizontal: Spacing.xs, includeFontPadding: false,
  },

  nicheBanner: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    marginHorizontal: Spacing.base, marginBottom: Spacing.xs,
    borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1,
  },
  nicheBannerIcon: { width: 36, height: 36, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  nicheBannerText: { flex: 1, gap: 2 },
  nicheBannerTitle: { fontSize: Typography.size.xs, fontWeight: Typography.weight.bold },
  nicheBannerSub: { fontSize: 9, color: Colors.textTertiary, lineHeight: 13 },

  filterOuter: {},
  filterContent: { flexDirection: 'row', gap: Spacing.xs, paddingHorizontal: Spacing.base, paddingVertical: Spacing.sm },
  filterChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs + 2,
    borderRadius: Radius.pill, backgroundColor: Colors.surface,
    borderWidth: 1, borderColor: Colors.surfaceBorder,
  },
  filterDot: { width: 5, height: 5, borderRadius: 3 },
  filterLabel: { fontSize: Typography.size.xs, color: Colors.textSecondary, fontWeight: Typography.weight.medium },
  filterCount: { fontSize: 10, color: Colors.textTertiary, fontWeight: Typography.weight.bold },

  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { paddingHorizontal: Spacing.base, paddingTop: Spacing.sm },

  empty: { alignItems: 'center', paddingVertical: 60, paddingHorizontal: Spacing.xl, gap: Spacing.md },
  emptyIcon: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontSize: Typography.size.lg, fontWeight: Typography.weight.semibold, color: Colors.textSecondary, textAlign: 'center' },
  emptyText: { fontSize: Typography.size.sm, color: Colors.textTertiary, textAlign: 'center', lineHeight: 20 },
  emptyBtn: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.xs,
    borderRadius: Radius.pill, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm,
  },
  emptyBtnText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: '#000' },

  syncBanner: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingHorizontal: Spacing.base, paddingVertical: 8,
    borderBottomWidth: 1,
  },
  syncBannerText: { flex: 1, fontSize: Typography.size.xs, fontWeight: Typography.weight.medium },
});
