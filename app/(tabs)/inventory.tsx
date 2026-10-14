// SWISH Master Inventory — Niche-Aware Combined Stock + Listings Screen
//
// STATUS MODEL (single source of truth):
//   IN STOCK  — item exists, no listing or listing ended/failed
//   DRAFT     — listing.status = 'draft' in SWISH DB (not yet submitted to eBay)
//   LIVE      — listing.status = 'active' (submitted + confirmed on eBay)
//   SOLD      — item.status = 'sold' (via eBay order sync or manual mark)
//
// Items always flow: In Stock → Draft → Live → Sold
// The Listings tab in the bottom nav is now removed — this IS the listing screen.

import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, FlatList, Pressable,
  TextInput, ScrollView, ActivityIndicator, RefreshControl, Modal,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import { ItemImage } from '@/components';
import { useInventory } from '@/hooks/useInventory';
import {
  listItems, ITEM_LIFECYCLE, ACTIVE_INVENTORY_STATUSES, HISTORY_STATUSES, updateItem,
} from '@/services/itemService';
import {
  getAllListings, generateListing, saveListing, submitListingToMarketplace,
  endListing, getLiveListingCount, type ListingWithItem, type SubmitStep,
} from '@/services/listingService';
import { useApp } from '@/hooks/useApp';
import { useAlert } from '@/template';
import { getSupabaseClient } from '@/template';
import {
  fetchAndStoreEbayImages, tenantNeedsImageSync,
} from '@/services/ebayImageService';
import { Colors, Typography, Spacing, Radius, Shadow } from '@/constants/theme';
import BulkReValueSheet from '@/components/feature/BulkReValueSheet';
import BulkReIdentifyModal from '@/components/feature/BulkReIdentifyModal';
import { useBusinessConfig } from '@/hooks/useBusiness';
import { NICHES } from '@/constants/niches';

// ── Tab definition ────────────────────────────────────────────────────────────
type MasterTab = 'stock' | 'draft' | 'live' | 'sold';

const MASTER_TABS: Array<{ id: MasterTab; label: string; icon: string; color: string }> = [
  { id: 'stock',  label: 'In Stock', icon: 'inventory',    color: Colors.primary },
  { id: 'draft',  label: 'Draft',    icon: 'edit',         color: Colors.textSecondary },
  { id: 'live',   label: 'Live',     icon: 'storefront',   color: Colors.success },
  { id: 'sold',   label: 'Sold',     icon: 'check-circle', color: Colors.accent },
];

// ── Niche theme ────────────────────────────────────────────────────────────────

interface NicheTheme {
  accent: string;
  accentDim: string;
  icon: string;
  label: string;
  itemLabel: string;
  itemsLabel: string;
  specialistIds: string[];
  subFilters: Array<{ label: string; value: string; search: string }>;
  metaKeys: Array<{ key: string; label: string; icon: string; color?: string }>;
  scanRoute: string;
  uniqueBanner?: { icon: string; title: string; sub: string; route: string };
}

function getNicheTheme(activeNicheId: string | null | undefined): NicheTheme {
  const id = (activeNicheId ?? '').toLowerCase();

  if (id.includes('coin') || id === 'gold' || id === 'silver' || id === 'banknotes' || id === 'islamic_silver') {
    return {
      accent: '#F5C842', accentDim: '#2A2000', icon: 'toll',
      label: 'Coin Inventory', itemLabel: 'Coin', itemsLabel: 'Coins',
      specialistIds: ['coins', 'coins_uk', 'coins_world', 'islamic_silver', 'banknotes', 'gold', 'silver', 'ancient_artefacts'],
      subFilters: [
        { label: 'All Types', value: 'all', search: '' },
        { label: 'Silver', value: 'silver', search: 'silver' },
        { label: 'Gold', value: 'gold', search: 'gold' },
        { label: 'British', value: 'british', search: 'british' },
        { label: 'Ancient', value: 'ancient', search: 'ancient' },
        { label: 'Islamic', value: 'islamic', search: 'islamic' },
        { label: 'Roman', value: 'roman', search: 'roman' },
      ],
      metaKeys: [
        { key: 'ruler', label: '', icon: 'person', color: Colors.textTertiary },
        { key: 'denomination', label: '', icon: 'monetization-on', color: '#F5C842' },
        { key: 'year_made', label: '', icon: '', color: Colors.textTertiary },
      ],
      scanRoute: '/(tabs)/scan',
      uniqueBanner: { icon: 'toll', title: 'Islamic & Indian Silver', sub: 'Zeno · Numista · Evidence-based', route: '/islamic-batch' },
    };
  }
  if (id === 'motocross' || id === 'mx') {
    return {
      accent: '#FF5500', accentDim: '#2A0A00', icon: 'two-wheeler',
      label: 'MX Inventory', itemLabel: 'Bike', itemsLabel: 'MX Bikes',
      specialistIds: ['motocross'],
      subFilters: [
        { label: 'All MX', value: 'all', search: '' },
        { label: 'Running', value: 'running', search: 'rideable' },
        { label: 'Project', value: 'project', search: 'project' },
        { label: '2-Stroke', value: '2stroke', search: '2-stroke' },
        { label: '4-Stroke', value: '4stroke', search: '4-stroke' },
      ],
      metaKeys: [
        { key: 'manufacturer', label: '', icon: 'business', color: '#FF5500' },
        { key: 'engine_size', label: '', icon: 'speed', color: Colors.textTertiary },
        { key: 'year_made', label: '', icon: 'calendar-today', color: Colors.textTertiary },
      ],
      scanRoute: '/flipper-mx',
      uniqueBanner: { icon: 'calculate', title: 'MX Acquisition Calculator', sub: 'Price · Repair costs · Profit estimate', route: '/mx-acquisition' },
    };
  }
  if (id === 'bicycles' || id === 'cycling' || id === 'bikes') {
    return {
      accent: '#6ED020', accentDim: '#0A2000', icon: 'pedal-bike',
      label: 'Bike Inventory', itemLabel: 'Bike', itemsLabel: 'Bikes',
      specialistIds: ['bicycles'],
      subFilters: [
        { label: 'All Bikes', value: 'all', search: '' },
        { label: 'Mountain', value: 'mtb', search: 'mountain' },
        { label: 'Road', value: 'road', search: 'road' },
        { label: 'Electric', value: 'electric', search: 'electric' },
        { label: 'Parts', value: 'parts', search: 'parts' },
      ],
      metaKeys: [
        { key: 'manufacturer', label: '', icon: 'business', color: '#6ED020' },
        { key: 'frame_size', label: '', icon: 'straighten', color: Colors.textTertiary },
        { key: 'groupset', label: '', icon: 'settings', color: Colors.textTertiary },
      ],
      scanRoute: '/bike-flipper',
    };
  }
  if (id === 'clothing' || id === 'fashion' || id === 'trainers_sneakers' || id === 'trainers') {
    return {
      accent: '#E91E8C', accentDim: '#250014', icon: 'checkroom',
      label: 'Fashion Inventory', itemLabel: 'Item', itemsLabel: 'Items',
      specialistIds: ['clothing', 'trainers_sneakers'],
      subFilters: [
        { label: 'All Items', value: 'all', search: '' },
        { label: 'Vintage', value: 'vintage', search: 'vintage' },
        { label: 'Designer', value: 'designer', search: 'designer' },
        { label: 'Streetwear', value: 'streetwear', search: 'streetwear' },
        { label: 'Trainers', value: 'trainers', search: 'trainer' },
      ],
      metaKeys: [
        { key: 'brand', label: '', icon: 'label', color: '#E91E8C' },
        { key: 'era', label: '', icon: 'history', color: Colors.textTertiary },
        { key: 'size', label: '', icon: 'straighten', color: Colors.textTertiary },
      ],
      scanRoute: '/threads-flip',
    };
  }
  return {
    accent: Colors.primary, accentDim: Colors.primaryDim, icon: 'inventory',
    label: 'Inventory', itemLabel: 'Item', itemsLabel: 'Items',
    specialistIds: [], subFilters: [{ label: 'All', value: 'all', search: '' }], metaKeys: [],
    scanRoute: '/(tabs)/scan',
  };
}

// ── Niche meta chips ──────────────────────────────────────────────────────────

function NicheMetaRow({ item, theme }: { item: any; theme: NicheTheme }) {
  const attrs = item.attributes ?? {};
  const getValue = (key: string): string | null => {
    const direct: Record<string, string> = {
      ruler: item.ruler, denomination: item.denomination,
      year_made: item.year_made, country_of_origin: item.country_of_origin,
      manufacturer: item.manufacturer,
    };
    if (direct[key] !== undefined) return direct[key] || null;
    return attrs[key] ? String(attrs[key]) : null;
  };
  const chips = theme.metaKeys.map(mk => ({ ...mk, value: getValue(mk.key) })).filter(c => c.value);
  if (chips.length === 0) return null;
  return (
    <View style={nm.row}>
      {chips.map((chip, i) => (
        <View key={i} style={nm.chip}>
          {chip.icon ? <MaterialIcons name={chip.icon as any} size={9} color={chip.color ?? Colors.textTertiary} /> : null}
          <Text style={[nm.text, chip.color ? { color: chip.color } : null]} numberOfLines={1}>{chip.value}</Text>
        </View>
      ))}
    </View>
  );
}
const nm = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.sm, paddingHorizontal: 4, paddingVertical: 2 },
  text: { fontSize: 9, color: Colors.textTertiary, maxWidth: 80 },
});

// ── Unified Item+Listing Card ─────────────────────────────────────────────────

interface UnifiedItem {
  id: string;
  canonical_title?: string;
  canonicalTitle?: string;
  status: string;
  media?: string[];
  inventory_id?: string;
  catalogue_number?: string;
  attributes?: Record<string, any>;
  ruler?: string;
  denomination?: string;
  year_made?: string;
  manufacturer?: string;
  expected_selling_price?: number;
  valuation_mid?: number;
  sold_price?: number;
  sold_at?: string;
  condition?: string;
  // Joined listing fields
  listing_id?: string;
  listing_status?: string;
  listing_price?: number;
  listing_watchers?: number;
  external_listing_id?: string;
  listing_published_at?: string;
}

function UnifiedCard({
  item, tab, theme, onPress, onListPress, onSubmitPress, onEndPress,
}: {
  item: UnifiedItem;
  tab: MasterTab;
  theme: NicheTheme;
  onPress: (id: string) => void;
  onListPress?: (id: string) => void;
  onSubmitPress?: (item: UnifiedItem) => void;
  onEndPress?: (item: UnifiedItem) => void;
}) {
  const router = useRouter();
  const title = item.canonical_title ?? item.canonicalTitle ?? '';
  const hasPhoto = (item.media ?? []).length > 0;
  const price = item.listing_price ?? item.expected_selling_price ?? item.valuation_mid ?? 0;
  const isLive = tab === 'live';
  const isDraft = tab === 'draft';
  const isSold = tab === 'sold';
  const isStock = tab === 'stock';

  const tabAccent = isLive ? Colors.success : isDraft ? Colors.textSecondary : isSold ? Colors.accent : theme.accent;

  const soldDateStr = item.sold_at
    ? new Date(item.sold_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })
    : null;

  return (
    <Pressable
      onPress={() => onPress(item.id)}
      style={({ pressed }) => [uc.card, { borderLeftColor: tabAccent }, pressed && { opacity: 0.9 }]}
    >
      {/* Thumbnail */}
      <View style={uc.thumbWrap}>
        {hasPhoto ? (
          <ItemImage uri={item.media![0]} style={uc.thumb} contentFit="cover" transition={150} />
        ) : (
          <View style={[uc.thumbPlaceholder, { backgroundColor: theme.accentDim }]}>
            <MaterialIcons name={isLive ? 'storefront' : isSold ? 'check-circle' : theme.icon as any} size={20} color={tabAccent} />
          </View>
        )}
        {/* Status dot */}
        <View style={[uc.dot, { backgroundColor: tabAccent }]} />
        {/* eBay badge for live */}
        {isLive ? <View style={uc.ebayBadge}><Text style={uc.ebayBadgeText}>e</Text></View> : null}
        {/* Photo count */}
        {(item.media?.length ?? 0) >= 2 ? (
          <View style={uc.photoBadge}><MaterialIcons name="photo-library" size={8} color="#fff" /><Text style={uc.photoBadgeCount}>{item.media!.length}</Text></View>
        ) : null}
      </View>

      {/* Content */}
      <View style={uc.content}>
        {/* ID badges */}
        {(item.inventory_id || item.catalogue_number) ? (
          <View style={uc.badgeRow}>
            {item.inventory_id ? <View style={[uc.idBadge, { backgroundColor: theme.accentDim, borderColor: theme.accent + '40' }]}><Text style={[uc.idBadgeText, { color: theme.accent }]}>{item.inventory_id}</Text></View> : null}
            {item.catalogue_number ? <View style={uc.catBadge}><MaterialIcons name="tag" size={9} color={Colors.accent} /><Text style={uc.catBadgeText}>{item.catalogue_number}</Text></View> : null}
          </View>
        ) : null}

        {/* Title */}
        <Text style={[uc.title, isSold && { color: Colors.textTertiary }]} numberOfLines={2}>
          {title || (isLive ? 'No title — sync from eBay' : 'Untitled')}
        </Text>

        {/* Meta row */}
        {isLive ? (
          <View style={uc.liveRow}>
            {item.condition ? <Text style={uc.condText} numberOfLines={1}>{item.condition}</Text> : null}
            {(item.listing_watchers ?? 0) > 0 ? (
              <View style={uc.watchRow}><MaterialIcons name="star" size={9} color={Colors.gold} /><Text style={uc.watchText}>{item.listing_watchers}</Text></View>
            ) : null}
            {item.external_listing_id ? <Text style={uc.ebayIdText}>#{item.external_listing_id.slice(-6)}</Text> : null}
          </View>
        ) : isSold ? (
          <View style={uc.liveRow}>
            {soldDateStr ? <Text style={uc.soldDate}>{soldDateStr}</Text> : null}
          </View>
        ) : (
          <NicheMetaRow item={item} theme={theme} />
        )}

        {/* Bottom row — status chip + price */}
        <View style={uc.bottomRow}>
          <View style={[uc.statusChip, { backgroundColor: tabAccent + '20' }]}>
            <View style={[uc.statusDot, { backgroundColor: tabAccent }]} />
            <Text style={[uc.statusText, { color: tabAccent }]}>
              {isLive ? 'Live on eBay' : isDraft ? 'Draft' : isSold ? 'Sold' : 'In Stock'}
            </Text>
          </View>
          {isSold && item.sold_price ? (
            <Text style={[uc.price, { color: Colors.accent }]}>£{Number(item.sold_price).toFixed(2)}</Text>
          ) : price > 0 ? (
            <Text style={[uc.price, { color: isLive ? Colors.success : theme.accent }]}>£{Number(price).toFixed(2)}</Text>
          ) : null}
        </View>
      </View>

      {/* Action button */}
      {isStock ? (
        <Pressable
          onPress={e => { (e as any).stopPropagation?.(); onListPress?.(item.id); }}
          style={[uc.actionBtn, { backgroundColor: theme.accentDim, borderColor: theme.accent + '50' }]}
        >
          <MaterialIcons name="sell" size={11} color={theme.accent} />
          <Text style={[uc.actionBtnText, { color: theme.accent }]}>List</Text>
        </Pressable>
      ) : isDraft ? (
        <Pressable
          onPress={e => { (e as any).stopPropagation?.(); onSubmitPress?.(item); }}
          style={[uc.actionBtn, { backgroundColor: Colors.successDim, borderColor: Colors.success + '50' }]}
        >
          <MaterialIcons name="send" size={11} color={Colors.success} />
          <Text style={[uc.actionBtnText, { color: Colors.success }]}>Submit</Text>
        </Pressable>
      ) : isLive ? (
        <Pressable
          onPress={e => { (e as any).stopPropagation?.(); onEndPress?.(item); }}
          style={[uc.actionBtn, { backgroundColor: Colors.dangerDim, borderColor: Colors.danger + '50' }]}
        >
          <MaterialIcons name="stop" size={11} color={Colors.danger} />
          <Text style={[uc.actionBtnText, { color: Colors.danger }]}>End</Text>
        </Pressable>
      ) : null}

      <MaterialIcons name="chevron-right" size={16} color={Colors.textTertiary} />
    </Pressable>
  );
}

const uc = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surface, borderRadius: Radius.xl, padding: Spacing.md, borderWidth: 1, borderColor: Colors.surfaceBorder, borderLeftWidth: 3, ...Shadow.sm },
  thumbWrap: { position: 'relative', width: 60, height: 60, flexShrink: 0 },
  thumb: { width: 60, height: 60, borderRadius: Radius.md },
  thumbPlaceholder: { width: 60, height: 60, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  dot: { position: 'absolute', bottom: 2, right: 2, width: 8, height: 8, borderRadius: 4, borderWidth: 1.5, borderColor: Colors.surface },
  ebayBadge: { position: 'absolute', top: 2, left: 2, width: 14, height: 14, borderRadius: 7, backgroundColor: '#E53238', alignItems: 'center', justifyContent: 'center' },
  ebayBadgeText: { fontSize: 8, fontWeight: Typography.weight.extrabold, color: '#fff' },
  photoBadge: { position: 'absolute', top: 3, right: 3, flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: 'rgba(0,0,0,0.62)', borderRadius: Radius.pill, paddingHorizontal: 4, paddingVertical: 2 },
  photoBadgeCount: { fontSize: 8, fontWeight: Typography.weight.bold, color: '#fff' },
  content: { flex: 1, gap: 4 },
  badgeRow: { flexDirection: 'row', gap: 4, flexWrap: 'wrap' },
  idBadge: { borderRadius: Radius.sm, paddingHorizontal: 5, paddingVertical: 2, borderWidth: 1 },
  idBadgeText: { fontSize: 9, fontWeight: Typography.weight.bold, letterSpacing: 0.4 },
  catBadge: { flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: Colors.accentDim, borderRadius: Radius.sm, paddingHorizontal: 5, paddingVertical: 2 },
  catBadgeText: { fontSize: 9, color: Colors.accent, fontWeight: Typography.weight.semibold },
  title: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.textPrimary, lineHeight: 17 },
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  condText: { fontSize: 9, color: Colors.textTertiary, maxWidth: 80 },
  watchRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  watchText: { fontSize: 9, fontWeight: Typography.weight.bold, color: Colors.gold },
  ebayIdText: { fontSize: 9, color: Colors.textTertiary, fontStyle: 'italic' },
  soldDate: { fontSize: 9, color: Colors.accent },
  bottomRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  statusChip: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: Radius.pill, paddingHorizontal: 7, paddingVertical: 3 },
  statusDot: { width: 5, height: 5, borderRadius: 3 },
  statusText: { fontSize: 9, fontWeight: Typography.weight.bold },
  price: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, marginLeft: 'auto' as any },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: Radius.sm, paddingHorizontal: 7, paddingVertical: 5, borderWidth: 1, marginLeft: -Spacing.xs },
  actionBtnText: { fontSize: 10, fontWeight: Typography.weight.semibold },
});

// ── Submit progress modal ─────────────────────────────────────────────────────

const SUBMIT_STEPS: Array<{ id: SubmitStep; label: string; icon: string }> = [
  { id: 'verifying', label: 'Verifying listing', icon: 'fact-check' },
  { id: 'checking_policies', label: 'Checking eBay policies', icon: 'policy' },
  { id: 'resolving_category', label: 'Resolving category', icon: 'category' },
  { id: 'publishing', label: 'Publishing to eBay', icon: 'send' },
];

function SubmitModal({ visible, step, title, failed }: { visible: boolean; step: SubmitStep | null; title: string; failed: boolean }) {
  const isDone = step === 'done';
  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={sm.overlay}>
        <View style={sm.card}>
          <View style={sm.header}>
            {isDone ? <MaterialIcons name="check-circle" size={22} color={Colors.success} /> : failed ? <MaterialIcons name="error" size={22} color={Colors.danger} /> : <ActivityIndicator size="small" color={Colors.primary} />}
            <View style={{ flex: 1 }}>
              <Text style={sm.title}>{isDone ? 'Listed on eBay!' : failed ? 'Failed' : 'Submitting to eBay'}</Text>
              {title ? <Text style={sm.sub} numberOfLines={1}>{title}</Text> : null}
            </View>
          </View>
          {SUBMIT_STEPS.map(s => {
            const order = SUBMIT_STEPS.map(x => x.id);
            const ci = step ? order.indexOf(step) : -1;
            const si = order.indexOf(s.id);
            const state = isDone ? 'done' : (failed && step === s.id) ? 'failed' : si < ci ? 'done' : si === ci ? 'active' : 'idle';
            const col = state === 'done' ? Colors.success : state === 'active' ? Colors.primary : state === 'failed' ? Colors.danger : Colors.textTertiary;
            return (
              <View key={s.id} style={sm.step}>
                <View style={[sm.stepIcon, { backgroundColor: col + '20' }]}>
                  {state === 'active' ? <ActivityIndicator size="small" color={Colors.primary} style={{ width: 16, height: 16 }} /> : state === 'done' ? <MaterialIcons name="check" size={14} color={Colors.success} /> : <MaterialIcons name={s.icon as any} size={14} color={col} />}
                </View>
                <Text style={[sm.stepLabel, { color: col }]}>{s.label}</Text>
              </View>
            );
          })}
        </View>
      </View>
    </Modal>
  );
}
const sm = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center', padding: Spacing.xl },
  card: { backgroundColor: Colors.surface, borderRadius: Radius.xxl, padding: Spacing.lg, width: '100%', maxWidth: 380, gap: Spacing.md, borderWidth: 1, borderColor: Colors.surfaceBorder },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingBottom: Spacing.sm, borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder },
  title: { fontSize: Typography.size.base, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  sub: { fontSize: Typography.size.xs, color: Colors.textTertiary, marginTop: 2 },
  step: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  stepIcon: { width: 32, height: 32, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  stepLabel: { fontSize: Typography.size.sm, fontWeight: Typography.weight.medium },
});

// ── Main Screen ───────────────────────────────────────────────────────────────

export default function MasterInventoryScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { tenant, activeNicheId } = useApp();
  const { showAlert } = useAlert();
  const theme = useMemo(() => getNicheTheme(activeNicheId), [activeNicheId]);
  const { config: bizConfig } = useBusinessConfig();
  const autonomousMode = bizConfig?.auto_value === true || bizConfig?.automation_level === 'autonomous';

  const [activeTab, setActiveTab] = useState<MasterTab>('stock');
  const [search, setSearch] = useState('');
  const [nicheSubFilter, setNicheSubFilter] = useState('all');
  const [refreshing, setRefreshing] = useState(false);
  const [showReValue, setShowReValue] = useState(false);
  const [showBulkReIdentify, setShowBulkReIdentify] = useState(false);
  const [bulkReIdentifyProgress, setBulkReIdentifyProgress] = useState<any>(null);
  const [syncBanner, setSyncBanner] = useState<string | null>(null);
  const imageSyncRunning = useRef(false);

  // Draft/Live/Sold listings (fetched separately)
  const [listings, setListings] = useState<ListingWithItem[]>([]);
  const [listingsLoading, setListingsLoading] = useState(false);
  const [soldItems, setSoldItems] = useState<any[]>([]);
  const [soldLoading, setSoldLoading] = useState(false);

  // Submit modal
  const [submitVisible, setSubmitVisible] = useState(false);
  const [submitStep, setSubmitStep] = useState<SubmitStep | null>(null);
  const [submitTitle, setSubmitTitle] = useState('');
  const [submitFailed, setSubmitFailed] = useState(false);

  // Counts for tab badges
  const [tabCounts, setTabCounts] = useState({ stock: 0, draft: 0, live: 0, sold: 0 });

  // Niche sub-filter search term
  const nicheSubSearch = useMemo(() => {
    const f = theme.subFilters.find(sf => sf.value === nicheSubFilter);
    return f?.search ?? '';
  }, [nicheSubFilter, theme.subFilters]);

  // Inventory filter for "In Stock" — items with no active/draft listing
  const inventoryFilter = useMemo(() => {
    const f: any = { lifecycleGroup: 'active', statuses: ITEM_LIFECYCLE.DRAFT_STATUSES };
    const parts: string[] = [];
    if (search.trim()) parts.push(search.trim());
    if (nicheSubSearch) parts.push(nicheSubSearch);
    if (parts.length > 0) f.search = parts[0];
    if (theme.specialistIds.length > 0) f.specialistIds = theme.specialistIds;
    return f;
  }, [search, nicheSubSearch, theme.specialistIds]);

  const { items: rawStockItems, loading: stockLoading, stats, reload: reloadStock } = useInventory(inventoryFilter);

  // "In Stock" = items that have NO active or draft listing
  const stockItems = useMemo(() => {
    const listedItemIds = new Set(listings.map(l => l.itemId));
    return rawStockItems.filter((item: any) => !listedItemIds.has(item.id));
  }, [rawStockItems, listings]);

  const loadListings = useCallback(async (statusFilter?: string) => {
    if (!tenant?.id) return;
    setListingsLoading(true);
    const { listings: all } = await getAllListings(tenant.id, statusFilter);
    // Filter by niche specialist IDs
    const nicheListings = theme.specialistIds.length > 0
      ? all.filter(l => theme.specialistIds.includes(l.itemSpecialistId))
      : all;
    setListings(nicheListings);

    // Update counts
    const draftCount = nicheListings.filter(l => l.status === 'draft' || l.status === 'pending').length;
    const liveCount = nicheListings.filter(l => l.status === 'active').length;
    setTabCounts(prev => ({ ...prev, draft: draftCount, live: liveCount }));
    setListingsLoading(false);
  }, [tenant?.id, theme.specialistIds]);

  const loadSold = useCallback(async () => {
    if (!tenant?.id) return;
    setSoldLoading(true);
    const f: any = { statuses: ITEM_LIFECYCLE.SOLD_STATUSES };
    if (search.trim()) f.search = search.trim();
    if (theme.specialistIds.length > 0) f.specialistIds = theme.specialistIds;
    const { items: sold } = await listItems(tenant.id, f);
    setSoldItems(sold);
    setTabCounts(prev => ({ ...prev, sold: sold.length }));
    setSoldLoading(false);
  }, [tenant?.id, search, theme.specialistIds]);

  // Load data for the active tab
  useEffect(() => {
    if (activeTab === 'draft' || activeTab === 'live') loadListings();
    if (activeTab === 'sold') loadSold();
    if (activeTab === 'stock') {
      // Also load listings to know which items are already listed (for exclusion)
      loadListings();
    }
  }, [activeTab]);

  // Update stock count
  useEffect(() => {
    setTabCounts(prev => ({ ...prev, stock: stockItems.length }));
  }, [stockItems.length]);

  // Reset sub-filter on niche change
  useEffect(() => { setNicheSubFilter('all'); }, [activeNicheId]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([
      reloadStock?.(),
      loadListings(),
      activeTab === 'sold' ? loadSold() : Promise.resolve(),
    ]);
    setRefreshing(false);

    // Background eBay image sync
    if (tenant?.id && !imageSyncRunning.current) {
      imageSyncRunning.current = true;
      (async () => {
        try {
          const needs = await tenantNeedsImageSync(tenant.id);
          if (needs) {
            setSyncBanner('Syncing eBay images...');
            await fetchAndStoreEbayImages(tenant.id, { fixTitles: true });
            setSyncBanner(null);
            await reloadStock?.();
          }
        } catch { setSyncBanner(null); }
        finally { imageSyncRunning.current = false; }
      })();
    }
  }, [activeTab, reloadStock, loadListings, loadSold, tenant?.id]);

  // ── Tab data resolver ─────────────────────────────────────────────────────

  const tabData = useMemo((): UnifiedItem[] => {
    const searchLower = search.toLowerCase();

    if (activeTab === 'stock') {
      return stockItems.filter((item: any) => {
        if (!searchLower) return true;
        const t = (item.canonical_title ?? item.canonicalTitle ?? '').toLowerCase();
        return t.includes(searchLower);
      });
    }

    if (activeTab === 'draft') {
      return listings
        .filter(l => l.status === 'draft' || l.status === 'pending')
        .filter(l => !searchLower || l.itemTitle.toLowerCase().includes(searchLower) || l.title.toLowerCase().includes(searchLower))
        .map(l => ({
          id: l.itemId,
          canonical_title: l.itemTitle,
          status: 'identified',
          listing_id: l.id,
          listing_status: l.status,
          listing_price: l.price,
          external_listing_id: l.externalListingId,
        }));
    }

    if (activeTab === 'live') {
      return listings
        .filter(l => l.status === 'active')
        .filter(l => !searchLower || l.itemTitle.toLowerCase().includes(searchLower) || l.title.toLowerCase().includes(searchLower))
        .map(l => ({
          id: l.itemId,
          canonical_title: l.itemTitle,
          status: 'listed',
          listing_id: l.id,
          listing_status: l.status,
          listing_price: l.price,
          listing_watchers: l.watchers,
          external_listing_id: l.externalListingId,
          listing_published_at: l.publishedAt,
        }));
    }

    if (activeTab === 'sold') {
      return soldItems.filter((item: any) => {
        if (!searchLower) return true;
        const t = (item.canonical_title ?? item.canonicalTitle ?? '').toLowerCase();
        return t.includes(searchLower);
      });
    }

    return [];
  }, [activeTab, stockItems, listings, soldItems, search]);

  // ── Actions ───────────────────────────────────────────────────────────────

  const handleCreateListing = useCallback((itemId: string) => {
    router.push(`/create-listing?id=${itemId}` as any);
  }, [router]);

  const handleSubmitDraft = useCallback(async (item: UnifiedItem) => {
    if (!tenant || !item.listing_id) return;
    setSubmitTitle(item.canonical_title ?? 'Listing');
    setSubmitFailed(false);
    setSubmitStep('verifying');
    setSubmitVisible(true);

    const result = await submitListingToMarketplace(tenant.id, item.listing_id, step => setSubmitStep(step));

    if (result.success) {
      setSubmitStep('done');
      await new Promise(r => setTimeout(r, 1200));
      setSubmitVisible(false);
      showAlert('Listed on eBay', `Now live at £${item.listing_price?.toFixed(2)}.`);
      await loadListings();
      setActiveTab('live');
    } else {
      setSubmitFailed(true);
      await new Promise(r => setTimeout(r, 800));
      setSubmitVisible(false);
      showAlert('Submission Failed', result.failureReasons?.join('\n') ?? result.error ?? 'Submission failed.');
    }
  }, [tenant, loadListings, showAlert]);

  const handleEndListing = useCallback(async (item: UnifiedItem) => {
    if (!tenant || !item.listing_id) return;
    showAlert('End Listing', `Remove "${item.canonical_title?.slice(0, 40)}" from eBay?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'End Listing', style: 'destructive', onPress: async () => {
          const { error } = await endListing(item.listing_id!, item.id, tenant.id, item.external_listing_id);
          if (error) { showAlert('End Failed', error); return; }
          showAlert('Listing Ended', 'Item moved back to stock.');
          await loadListings();
          setActiveTab('stock');
        },
      },
    ]);
  }, [tenant, loadListings, showAlert]);

  const handleMarkSold = useCallback((itemId: string) => {
    if (!tenant) return;
    showAlert('Mark as Sold?', 'This will move the item to your sold history.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Mark Sold', onPress: async () => {
          await updateItem(itemId, { status: 'sold', soldAt: new Date().toISOString() }, tenant.id);
          await reloadStock?.();
        },
      },
    ]);
  }, [tenant, reloadStock, showAlert]);

  // ── Sync sold orders from eBay → inventory ────────────────────────────────
  // Niche-aware: only syncs orders for items belonging to the active niche

  const handleSyncSold = useCallback(async () => {
    if (!tenant?.id) return;
    setSyncBanner('Syncing sold orders from eBay...');
    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase.functions.invoke('swish-ebay-orders', {
        body: { tenantId: tenant.id, action: 'sync_sold' },
      });
      if (!error && data?.synced > 0) {
        setSyncBanner(`Synced ${data.synced} sold order${data.synced === 1 ? '' : 's'}`);
        setTimeout(() => setSyncBanner(null), 3000);
        await loadSold();
      } else {
        setSyncBanner(null);
      }
    } catch { setSyncBanner(null); }
  }, [tenant?.id, loadSold]);

  const isLoading = activeTab === 'stock' ? stockLoading : activeTab === 'sold' ? soldLoading : listingsLoading;
  const currentItems = tabData;

  // Filter draft/live by the niche listing data already filtered
  const draftListings = listings.filter(l => l.status === 'draft' || l.status === 'pending');
  const liveListings = listings.filter(l => l.status === 'active');

  return (
    <View style={s.container}>
      <StatusBar style="light" />

      {/* ── Header ── */}
      <View style={[s.header, { paddingTop: insets.top + Spacing.base, borderBottomColor: theme.accent + '30' }]}>
        <View style={[s.headerIcon, { backgroundColor: theme.accentDim }]}>
          <MaterialIcons name={theme.icon as any} size={18} color={theme.accent} />
        </View>
        <View style={s.flex}>
          <Text style={[s.headerTitle, { color: theme.accent }]}>{theme.label}</Text>
          <Text style={s.headerSub}>
            {tabCounts.stock} in stock · {tabCounts.draft} draft · {tabCounts.live} live · {tabCounts.sold} sold
          </Text>
        </View>
        <View style={s.headerActions}>
          {activeTab === 'sold' ? (
            <Pressable onPress={handleSyncSold} style={[s.hBtn, { backgroundColor: Colors.infoDim, borderColor: Colors.info + '40' }]} hitSlop={8}>
              <MaterialIcons name="sync" size={16} color={Colors.info} />
            </Pressable>
          ) : null}
          {activeTab === 'stock' && currentItems.length > 0 ? (
            <>
              <Pressable onPress={() => setShowReValue(true)} style={[s.hBtn, { backgroundColor: theme.accentDim, borderColor: theme.accent + '50' }]} hitSlop={8}>
                <MaterialIcons name="travel-explore" size={16} color={theme.accent} />
              </Pressable>
              <Pressable onPress={() => setShowBulkReIdentify(true)} style={[s.hBtn, { backgroundColor: Colors.accentDim, borderColor: Colors.accent + '60' }]} hitSlop={8}>
                <MaterialIcons name="auto-awesome" size={16} color={Colors.accent} />
              </Pressable>
            </>
          ) : null}
          <Pressable onPress={() => router.push(theme.scanRoute as any)} style={[s.hBtn, { backgroundColor: theme.accent }]} hitSlop={8}>
            <MaterialIcons name="add" size={18} color="#000" />
          </Pressable>
        </View>
      </View>

      {/* ── Master tabs ── */}
      <View style={s.masterTabs}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.masterTabsContent}>
          {MASTER_TABS.map(tab => {
            const isActive = activeTab === tab.id;
            const count = tabCounts[tab.id];
            return (
              <Pressable
                key={tab.id}
                onPress={() => setActiveTab(tab.id)}
                style={[s.masterTab, isActive && { backgroundColor: tab.color + '18', borderColor: tab.color + '60' }]}
              >
                <MaterialIcons name={tab.icon as any} size={14} color={isActive ? tab.color : Colors.textTertiary} />
                <Text style={[s.masterTabText, isActive && { color: tab.color, fontWeight: Typography.weight.semibold }]}>
                  {tab.label}
                </Text>
                {count > 0 ? (
                  <View style={[s.masterTabBadge, isActive && { backgroundColor: tab.color + '30' }]}>
                    <Text style={[s.masterTabBadgeText, isActive && { color: tab.color }]}>{count}</Text>
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* ── Search ── */}
      <View style={s.searchWrap}>
        <MaterialIcons name="search" size={16} color={Colors.textTertiary} style={{ marginLeft: Spacing.sm }} />
        <TextInput
          style={s.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder={`Search ${theme.itemsLabel.toLowerCase()}...`}
          placeholderTextColor={Colors.textTertiary}
          clearButtonMode="while-editing"
          returnKeyType="search"
        />
        {search.length > 0 ? (
          <Pressable onPress={() => setSearch('')} hitSlop={8} style={{ marginRight: Spacing.sm }}>
            <MaterialIcons name="close" size={14} color={Colors.textTertiary} />
          </Pressable>
        ) : null}
      </View>

      {/* ── Niche unique banner (stock tab only) ── */}
      {activeTab === 'stock' && theme.uniqueBanner ? (
        <Pressable
          onPress={() => router.push(theme.uniqueBanner!.route as any)}
          style={({ pressed }) => [s.nicheBanner, { borderColor: theme.accent + '20', backgroundColor: theme.accentDim }, pressed && { opacity: 0.85 }]}
        >
          <View style={[s.nicheBannerIcon, { backgroundColor: theme.accent + '15' }]}>
            <MaterialIcons name={theme.uniqueBanner.icon as any} size={18} color={theme.accent} />
          </View>
          <View style={s.flex}>
            <Text style={[s.nicheBannerTitle, { color: theme.accent }]}>{theme.uniqueBanner.title}</Text>
            <Text style={s.nicheBannerSub}>{theme.uniqueBanner.sub}</Text>
          </View>
          <MaterialIcons name="arrow-forward" size={14} color={theme.accent} />
        </Pressable>
      ) : null}

      {/* ── Niche sub-filters (stock tab only) ── */}
      {activeTab === 'stock' && theme.subFilters.length > 1 ? (
        <View style={s.filterOuter}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filterContent}>
            {theme.subFilters.map(sf => {
              const active = nicheSubFilter === sf.value;
              return (
                <Pressable key={sf.value} onPress={() => setNicheSubFilter(sf.value)} style={[s.filterChip, active && { backgroundColor: theme.accentDim, borderColor: theme.accent + '60' }]}>
                  <Text style={[s.filterLabel, active && { color: theme.accent, fontWeight: Typography.weight.semibold }]}>{sf.label}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      ) : null}

      {/* ── Tab-specific info bar ── */}
      {activeTab === 'draft' && draftListings.length > 0 ? (
        <View style={[s.infoBar, { backgroundColor: Colors.surfaceHighlight, borderBottomColor: Colors.surfaceBorder }]}>
          <MaterialIcons name="info-outline" size={11} color={Colors.textTertiary} />
          <Text style={s.infoBarText}>Draft listings are saved in SWISH only — tap Submit to publish to eBay</Text>
        </View>
      ) : null}

      {activeTab === 'live' && liveListings.length > 0 ? (
        <View style={[s.infoBar, { backgroundColor: Colors.successDim, borderBottomColor: Colors.success + '30' }]}>
          <MaterialIcons name="wifi-tethering" size={11} color={Colors.success} />
          <Text style={[s.infoBarText, { color: Colors.success }]}>{liveListings.length} item{liveListings.length !== 1 ? 's' : ''} live on eBay UK</Text>
        </View>
      ) : null}

      {activeTab === 'sold' ? (
        <View style={[s.infoBar, { backgroundColor: Colors.accentDim, borderBottomColor: Colors.accent + '30' }]}>
          <MaterialIcons name="sync" size={11} color={Colors.accent} />
          <Text style={[s.infoBarText, { color: Colors.accent }]}>Tap the sync icon to pull sold orders from eBay</Text>
        </View>
      ) : null}

      {/* ── Bulk modals ── */}
      <BulkReIdentifyModal
        visible={showBulkReIdentify}
        items={currentItems}
        tenantId={tenant?.id ?? ''}
        progress={bulkReIdentifyProgress}
        onProgress={setBulkReIdentifyProgress}
        onClose={() => { setShowBulkReIdentify(false); setBulkReIdentifyProgress(null); reloadStock?.(); }}
      />
      {tenant?.id ? (
        <BulkReValueSheet
          visible={showReValue}
          onClose={() => { setShowReValue(false); reloadStock?.(); }}
          tenantId={tenant.id}
          items={currentItems.map((i: any) => ({
            id: i.id,
            canonical_title: i.canonical_title ?? i.canonicalTitle ?? '',
            specialist_id: i.specialist_id ?? i.specialistId ?? 'curiosities_collectibles',
            condition: i.condition ?? '',
            attributes: i.attributes ?? {},
            media: i.media ?? [],
          })).filter((i: any) => i.canonical_title && i.canonical_title.length > 3)}
          autonomousMode={autonomousMode}
        />
      ) : null}

      {/* ── Submit modal ── */}
      <SubmitModal visible={submitVisible} step={submitStep} title={submitTitle} failed={submitFailed} />

      {/* ── Sync banner ── */}
      {syncBanner ? (
        <Pressable onPress={() => setSyncBanner(null)} style={[s.syncBanner, { backgroundColor: theme.accentDim, borderBottomColor: theme.accent + '30' }]}>
          <ActivityIndicator size="small" color={theme.accent} style={{ width: 14, height: 14 }} />
          <Text style={[s.syncBannerText, { color: theme.accent }]}>{syncBanner}</Text>
        </Pressable>
      ) : null}

      {/* ── Content ── */}
      {isLoading ? (
        <View style={s.loading}><ActivityIndicator color={theme.accent} size="large" /></View>
      ) : (
        <FlatList
          data={currentItems}
          keyExtractor={(i: any) => `${activeTab}-${i.id}-${i.listing_id ?? ''}`}
          contentContainerStyle={[s.list, { paddingBottom: insets.bottom + 100 }]}
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => <View style={{ height: Spacing.sm }} />}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.accent} />}
          renderItem={({ item }) => (
            <UnifiedCard
              item={item}
              tab={activeTab}
              theme={theme}
              onPress={id => router.push(`/stock-listing/${id}` as any)}
              onListPress={handleCreateListing}
              onSubmitPress={handleSubmitDraft}
              onEndPress={handleEndListing}
            />
          )}
          ListEmptyComponent={
            <View style={s.empty}>
              <View style={[s.emptyIcon, { backgroundColor: MASTER_TABS.find(t => t.id === activeTab)?.color ?? theme.accent + '20' }]}>
                <MaterialIcons name={MASTER_TABS.find(t => t.id === activeTab)?.icon as any ?? theme.icon} size={36} color={MASTER_TABS.find(t => t.id === activeTab)?.color ?? theme.accent} />
              </View>
              <Text style={s.emptyTitle}>
                {activeTab === 'stock' ? `No ${theme.itemsLabel.toLowerCase()} in stock`
                  : activeTab === 'draft' ? 'No draft listings'
                  : activeTab === 'live' ? 'Nothing live on eBay'
                  : `No sold ${theme.itemsLabel.toLowerCase()} yet`}
              </Text>
              <Text style={s.emptyText}>
                {activeTab === 'stock' ? `Add your first ${theme.itemLabel.toLowerCase()} via the scan tab`
                  : activeTab === 'draft' ? 'Go to In Stock and tap List on any item to create a draft'
                  : activeTab === 'live' ? 'Submit a draft listing to make it live on eBay'
                  : 'Sold items appear here after eBay sync or manual mark sold'}
              </Text>
              {activeTab === 'stock' ? (
                <Pressable onPress={() => router.push(theme.scanRoute as any)} style={[s.emptyBtn, { backgroundColor: theme.accent }]}>
                  <MaterialIcons name="add" size={15} color="#000" />
                  <Text style={s.emptyBtnText}>Add {theme.itemLabel}</Text>
                </Pressable>
              ) : activeTab === 'draft' ? (
                <Pressable onPress={() => setActiveTab('stock')} style={[s.emptyBtn, { backgroundColor: theme.accent }]}>
                  <MaterialIcons name="inventory" size={15} color="#000" />
                  <Text style={s.emptyBtnText}>Go to In Stock</Text>
                </Pressable>
              ) : activeTab === 'sold' ? (
                <Pressable onPress={handleSyncSold} style={[s.emptyBtn, { backgroundColor: Colors.accent }]}>
                  <MaterialIcons name="sync" size={15} color="#000" />
                  <Text style={s.emptyBtnText}>Sync from eBay</Text>
                </Pressable>
              ) : null}
            </View>
          }
        />
      )}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },

  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.base, paddingBottom: Spacing.md, borderBottomWidth: 1 },
  headerIcon: { width: 40, height: 40, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  headerTitle: { fontSize: Typography.size.xl, fontWeight: Typography.weight.bold },
  headerSub: { fontSize: Typography.size.xs, color: Colors.textTertiary, marginTop: 2 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  hBtn: { width: 34, height: 34, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },

  masterTabs: { borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder },
  masterTabsContent: { flexDirection: 'row', gap: Spacing.xs, paddingHorizontal: Spacing.base, paddingVertical: Spacing.sm },
  masterTab: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs + 3, borderRadius: Radius.md, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.surfaceBorder, minWidth: 80, justifyContent: 'center' },
  masterTabText: { fontSize: Typography.size.xs, color: Colors.textTertiary },
  masterTabBadge: { backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.pill, paddingHorizontal: 5, paddingVertical: 1, minWidth: 18, alignItems: 'center' },
  masterTabBadgeText: { fontSize: 9, fontWeight: Typography.weight.bold, color: Colors.textTertiary },

  searchWrap: { flexDirection: 'row', alignItems: 'center', marginHorizontal: Spacing.base, marginTop: Spacing.sm, marginBottom: Spacing.xs, backgroundColor: Colors.surface, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.surfaceBorder, height: 40 },
  searchInput: { flex: 1, fontSize: Typography.size.sm, color: Colors.textPrimary, paddingVertical: 0, paddingHorizontal: Spacing.xs, includeFontPadding: false },

  nicheBanner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginHorizontal: Spacing.base, marginBottom: Spacing.xs, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1 },
  nicheBannerIcon: { width: 36, height: 36, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  nicheBannerTitle: { fontSize: Typography.size.xs, fontWeight: Typography.weight.bold },
  nicheBannerSub: { fontSize: 9, color: Colors.textTertiary, lineHeight: 13 },

  filterOuter: { borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder },
  filterContent: { flexDirection: 'row', gap: Spacing.xs, paddingHorizontal: Spacing.base, paddingVertical: Spacing.sm },
  filterChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs + 2, borderRadius: Radius.pill, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.surfaceBorder },
  filterLabel: { fontSize: Typography.size.xs, color: Colors.textSecondary, fontWeight: Typography.weight.medium },

  infoBar: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.base, paddingVertical: 8, borderBottomWidth: 1 },
  infoBarText: { flex: 1, fontSize: 10, color: Colors.textTertiary, lineHeight: 14 },

  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { paddingHorizontal: Spacing.base, paddingTop: Spacing.sm },

  empty: { alignItems: 'center', paddingVertical: 60, paddingHorizontal: Spacing.xl, gap: Spacing.md },
  emptyIcon: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontSize: Typography.size.lg, fontWeight: Typography.weight.semibold, color: Colors.textSecondary, textAlign: 'center' },
  emptyText: { fontSize: Typography.size.sm, color: Colors.textTertiary, textAlign: 'center', lineHeight: 20 },
  emptyBtn: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, borderRadius: Radius.pill, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm },
  emptyBtnText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: '#000' },

  syncBanner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.base, paddingVertical: 8, borderBottomWidth: 1 },
  syncBannerText: { flex: 1, fontSize: Typography.size.xs, fontWeight: Typography.weight.medium },
});
