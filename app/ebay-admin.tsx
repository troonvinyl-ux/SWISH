// KEENONCOINS — eBay Admin v2 (Complete)
// The micro eBay dashboard. Everything available in the real eBay seller hub.
//
// ✅ Buy It Now (Fixed Price) listings — GTC
// ✅ Auction listings (1/3/5/7/10 day with start price + reserve)
// ✅ eBay Simple Delivery as default shipping method
// ✅ Create new listing from any inventory item
// ✅ Inline price / shipping / title edit on all draft listings
// ✅ End Listing, Relist, Publish/Submit
// ✅ View on eBay, live views/watchers stats
// ✅ Inventory item status vs listing status mismatch detection
// ✅ Sync Status (auto-correct all item statuses from listing/order state)
// ✅ Import Orders from eBay
// ✅ Fulfilment quick-actions: mark dispatched, add tracking, mark delivered
// ✅ Status tabs: All / Active / Draft / Verified / Ended / Sold / Failed
// ✅ Search by KC ID, catalogue no., title, folder, eBay ID

import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  View, Text, StyleSheet, FlatList, Pressable,
  TextInput, ScrollView, ActivityIndicator, RefreshControl,
  Linking, Modal, KeyboardAvoidingView, Platform, Animated,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { ItemImage } from '@/components';
import { getSupabaseClient } from '@/template';
import { Colors, Typography, Spacing, Radius, Shadow } from '@/constants/theme';
import { useApp } from '@/hooks/useApp';
import { getProductionNicheSpecialistIds } from '@/services/nicheRouting';
import { useAlert } from '@/template';
import { FunctionsHttpError } from '@supabase/supabase-js';
import {
  endListing, updateListingPrice, submitListingToMarketplace,
  createManualListing, type ListingFormat,
} from '@/services/listingService';

// ── Image refresh helper (mirrors ebay-import.tsx fetchAndUpdateEbayImages) ──

interface ImageRefreshProgress {
  current: number;
  total: number;
  updated: number;
  failed: number;
  done: boolean;
}

// Helper: is a URL a real permanent image?
function isValidImageUrl(url: string): boolean {
  if (!url) return false;
  if (!url.startsWith('https://')) return false;
  if (url.startsWith('file://')) return false;
  return true;
}

/**
 * Downloads eBay images and stores them permanently in Supabase Storage.
 * Uses a two-phase approach:
 *  1. Fetch eBay CDN URLs via Trading API (fast, shows something immediately)
 *  2. Download actual image bytes server-side and store in Supabase Storage (permanent)
 */
async function refreshAllEbayImages(
  tenantId: string,
  onProgress: (p: ImageRefreshProgress) => void,
): Promise<void> {
  const supabase = getSupabaseClient();

  // Find all listings with external eBay IDs
  const { data: listingRows } = await supabase
    .from('listings')
    .select('id, item_id, external_listing_id')
    .eq('tenant_id', tenantId)
    .not('external_listing_id', 'is', null)
    .neq('external_listing_id', '');

  if (!listingRows?.length) {
    onProgress({ current: 0, total: 0, updated: 0, failed: 0, done: true });
    return;
  }

  // Find items without permanent Supabase Storage images
  const { data: itemRows } = await supabase
    .from('items')
    .select('id, media')
    .eq('tenant_id', tenantId)
    .in('id', listingRows.map(l => l.item_id));

  const needsImageIds = new Set(
    (itemRows ?? [])
      .filter(i => {
        if (!i.media || i.media.length === 0) return true;
        return !i.media.some((u: string) => isValidImageUrl(u) && u.includes('supabase'));
      })
      .map(i => i.id),
  );

  const targets = listingRows.filter(l => needsImageIds.has(l.item_id));
  const total = targets.length;

  if (total === 0) {
    onProgress({ current: 0, total: 0, updated: 0, failed: 0, done: true });
    return;
  }

  onProgress({ current: 0, total, updated: 0, failed: 0, done: false });

  // Phase 1: Get eBay CDN URLs and save as interim (gives user immediate visual feedback)
  const ebayIds = targets.map(t => t.external_listing_id).filter(Boolean);
  const BATCH_SIZE = 20;
  const urlMap = new Map<string, string>();

  for (let b = 0; b < ebayIds.length; b += BATCH_SIZE) {
    const batch = ebayIds.slice(b, b + BATCH_SIZE);
    try {
      const { data: batchData } = await supabase.functions.invoke('swish-ebay-browse', {
        body: { route: 'fetch_item_images', tenantId, itemIds: batch },
      });
      const results: Record<string, string | null> = batchData?.results ?? {};
      for (const [id, url] of Object.entries(results)) {
        if (url) urlMap.set(id, url);
      }
    } catch (e: any) {
      console.warn(`Image fetch batch ${b}:`, e?.message);
    }
    onProgress({ current: Math.min(b + BATCH_SIZE, total), total, updated: 0, failed: 0, done: false });
  }

  // Save eBay CDN URLs as interim
  let interim = 0;
  for (const t of targets) {
    const url = urlMap.get(t.external_listing_id);
    if (url) {
      await supabase.from('items')
        .update({ media: [url], updated_at: new Date().toISOString() })
        .eq('id', t.item_id);
      interim++;
    }
  }

  onProgress({ current: total, total, updated: interim, failed: total - interim, done: false });

  // Phase 2: Download images permanently via edge function (server-side, no CORS issues)
  try {
    const { data: dlData } = await supabase.functions.invoke('swish-image-download', {
      body: { tenantId, fixTitles: true },
    });
    const downloaded = dlData?.imagesDownloaded ?? 0;
    const failed = dlData?.imagesFailed ?? 0;
    const titlesFixed = dlData?.titlesFixed ?? 0;
    onProgress({
      current: total,
      total,
      updated: downloaded > 0 ? downloaded : interim,
      failed,
      done: true,
    });
    if (titlesFixed > 0) {
      console.log(`Also fixed ${titlesFixed} blank item titles`);
    }
  } catch (e: any) {
    // Non-fatal — CDN URLs already saved as interim
    onProgress({ current: total, total, updated: interim, failed: total - interim, done: true });
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface EbayListing {
  id: string;
  itemId: string;
  title: string;
  price: number;
  shippingCost: number;
  status: string;
  externalListingId?: string;
  views: number;
  watchers: number;
  publishedAt?: string;
  createdAt: string;
  updatedAt: string;
  // Joined item fields
  inventoryId?: string;
  catalogueNumber?: string;
  folderNumber?: string;
  pocketPosition?: string;
  storageLocation?: string;
  itemTitle: string;
  itemMedia: string[];
  itemStatus: string;
  condition?: string;
  ruler?: string;
  denomination?: string;
  countryOfOrigin?: string;
}

interface InventoryItem {
  id: string;
  inventoryId?: string;
  canonicalTitle: string;
  status: string;
  media: string[];
  expectedSellingPrice: number;
  catalogueNumber?: string;
  folderNumber?: string;
  condition?: string;
}

type StatusTab = 'all' | 'active' | 'draft' | 'pending' | 'ended' | 'sold' | 'failed';

const STATUS_TABS: Array<{ id: StatusTab; label: string; color: string }> = [
  { id: 'all',     label: 'All',     color: Colors.textSecondary },
  { id: 'active',  label: 'Active',  color: Colors.success },
  { id: 'draft',   label: 'Draft',   color: Colors.textTertiary },
  { id: 'pending', label: 'Verified',color: Colors.primary },
  { id: 'ended',   label: 'Ended',   color: Colors.warning },
  { id: 'sold',    label: 'Sold',    color: Colors.accent },
  { id: 'failed',  label: 'Failed',  color: Colors.danger },
];

const STATUS_COLORS: Record<string, string> = {
  active: Colors.success, draft: Colors.textTertiary, pending: Colors.primary,
  ended: Colors.warning, sold: Colors.accent, failed: Colors.danger,
};

const ITEM_STATUS_COLORS: Record<string, string> = {
  listed: Colors.success, active: Colors.success, sold: Colors.accent,
  identified: Colors.primary, review_required: Colors.danger, held: Colors.warning,
  new: Colors.textTertiary, captured: Colors.textTertiary, priced: Colors.info,
  disposed: Colors.textTertiary,
};

const ITEM_STATUS_LABELS: Record<string, string> = {
  listed: 'Listed', active: 'Listed', sold: 'Sold', identified: 'Available',
  review_required: 'Review', held: 'Held', new: 'New', captured: 'Captured',
  priced: 'Priced', disposed: 'Disposed',
};

function isStatusMatch(listingStatus: string, itemStatus: string): boolean {
  if (!itemStatus) return true;
  if (listingStatus === 'active')  return itemStatus === 'listed' || itemStatus === 'active';
  if (listingStatus === 'sold')    return itemStatus === 'sold';
  if (listingStatus === 'ended')   return itemStatus === 'identified' || itemStatus === 'available';
  if (listingStatus === 'draft' || listingStatus === 'pending' || listingStatus === 'failed')
    return !['listed', 'active', 'sold'].includes(itemStatus);
  return true;
}

// ── Create Listing Modal ──────────────────────────────────────────────────────

function CreateListingModal({
  visible,
  onClose,
  onCreated,
  tenantId,
  showAlert,
}: {
  visible: boolean;
  onClose: () => void;
  onCreated: () => void;
  tenantId: string;
  showAlert: (title: string, message?: string, buttons?: any[]) => void;
}) {
  const [step, setStep] = useState<'pick_item' | 'configure'>('pick_item');
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [itemSearch, setItemSearch] = useState('');
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);

  // Configure step
  const [listingType, setListingType] = useState<ListingFormat>('FixedPriceItem');
  const [title, setTitle] = useState('');
  const [price, setPrice] = useState('');
  const [shippingCost, setShippingCost] = useState('0');
  const [auctionDays, setAuctionDays] = useState<3 | 5 | 7 | 10>(7);
  const [startPrice, setStartPrice] = useState('');
  const [reservePrice, setReservePrice] = useState('');
  const [description, setDescription] = useState('');
  const [creating, setCreating] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setStep('pick_item');
    setSelectedItem(null);
    setItemSearch('');
    setItems([]);
  }, [visible]);

  useEffect(() => {
    if (!visible || step !== 'pick_item') return;
    const load = async () => {
      setLoadingItems(true);
      const supabase = getSupabaseClient();
      const q = itemSearch.trim();
      let query = supabase
        .from('items')
        .select('id, inventory_id, canonical_title, status, media, expected_selling_price, catalogue_number, folder_number, condition')
        .eq('tenant_id', tenantId)
        .not('status', 'in', '("sold","disposed")')
        .order('updated_at', { ascending: false })
        .limit(50);

      if (q) {
        query = query.or(`canonical_title.ilike.%${q}%,inventory_id.ilike.%${q}%,catalogue_number.ilike.%${q}%`);
      }

      const { data } = await query;
      setItems((data ?? []).map((r: any) => ({
        id: r.id,
        inventoryId: r.inventory_id ?? undefined,
        canonicalTitle: r.canonical_title,
        status: r.status,
        media: r.media ?? [],
        expectedSellingPrice: Number(r.expected_selling_price ?? 0),
        catalogueNumber: r.catalogue_number ?? undefined,
        folderNumber: r.folder_number ?? undefined,
        condition: r.condition ?? undefined,
      })));
      setLoadingItems(false);
    };
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
  }, [visible, step, itemSearch, tenantId]);

  const handleSelectItem = useCallback((item: InventoryItem) => {
    setSelectedItem(item);
    setTitle(item.canonicalTitle.slice(0, 80));
    setPrice(item.expectedSellingPrice > 0 ? item.expectedSellingPrice.toFixed(2) : '');
    setStartPrice(item.expectedSellingPrice > 0 ? (item.expectedSellingPrice * 0.2).toFixed(2) : '');
    setDescription('');
    setStep('configure');
  }, []);

  const handleCreateDraft = useCallback(async () => {
    if (!selectedItem) return;
    const p = parseFloat(price);
    if (!title.trim() || isNaN(p) || p <= 0) {
      showAlert('Missing Fields', 'Title and price are required.');
      return;
    }
    setCreating(true);
    const { listing, error } = await createManualListing({
      tenantId, itemId: selectedItem.id, marketplaceId: 'ebay',
      title: title.trim(), description: description.trim(),
      price: p, shippingCost: parseFloat(shippingCost) || 0,
    });
    setCreating(false);
    if (error || !listing) { showAlert('Failed', error ?? 'Could not create listing.'); return; }
    onCreated();
    onClose();
  }, [selectedItem, title, description, price, shippingCost, tenantId, showAlert, onCreated, onClose]);

  const handleCreateAndSubmit = useCallback(async () => {
    if (!selectedItem) return;
    const p  = parseFloat(price);
    const sp = parseFloat(startPrice);
    const rp = parseFloat(reservePrice) || 0;
    if (!title.trim() || isNaN(p) || p <= 0) {
      showAlert('Missing Fields', 'Title and price are required.');
      return;
    }
    if (listingType === 'Chinese' && (isNaN(sp) || sp <= 0)) {
      showAlert('Missing Fields', 'Start price is required for auctions.');
      return;
    }
    setSubmitting(true);

    // Create draft first
    const { listing, error } = await createManualListing({
      tenantId, itemId: selectedItem.id, marketplaceId: 'ebay',
      title: title.trim(), description: description.trim(),
      price: p, shippingCost: parseFloat(shippingCost) || 0,
    });

    if (error || !listing) {
      setSubmitting(false);
      showAlert('Failed', error ?? 'Could not create listing.');
      return;
    }

    // Submit to eBay immediately
    const result = await submitListingToMarketplace(tenantId, listing.id, undefined, {
      listingType,
      auctionDays,
      startPrice: listingType === 'Chinese' ? sp : undefined,
      reservePrice: rp > 0 ? rp : undefined,
    });

    setSubmitting(false);

    if (result.success) {
      showAlert('Live on eBay', `${listingType === 'Chinese' ? 'Auction' : 'Buy It Now'} listing is now live.`);
      onCreated();
      onClose();
    } else {
      showAlert('Submission Failed', result.failureReasons?.join('\n') ?? result.error ?? 'Unknown error');
    }
  }, [selectedItem, title, description, price, shippingCost, listingType, auctionDays, startPrice, reservePrice, tenantId, showAlert, onCreated, onClose]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: Colors.background }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {/* Modal Header */}
        <View style={ml.header}>
          <Pressable onPress={onClose} style={ml.closeBtn} hitSlop={8}>
            <MaterialIcons name="close" size={20} color={Colors.textSecondary} />
          </Pressable>
          <View style={ml.flex}>
            <Text style={ml.headerTitle}>
              {step === 'pick_item' ? 'Select Item to List' : 'Configure eBay Listing'}
            </Text>
            {step === 'configure' && selectedItem ? (
              <Text style={ml.headerSub} numberOfLines={1}>{selectedItem.canonicalTitle}</Text>
            ) : null}
          </View>
          {step === 'configure' ? (
            <Pressable onPress={() => setStep('pick_item')} hitSlop={8} style={ml.backStepBtn}>
              <MaterialIcons name="arrow-back" size={16} color={Colors.primary} />
              <Text style={ml.backStepText}>Change</Text>
            </Pressable>
          ) : null}
        </View>

        {/* STEP 1: Pick item */}
        {step === 'pick_item' ? (
          <View style={{ flex: 1 }}>
            <View style={ml.searchWrap}>
              <MaterialIcons name="search" size={15} color={Colors.textTertiary} style={{ marginLeft: Spacing.sm }} />
              <TextInput
                style={ml.searchInput}
                value={itemSearch}
                onChangeText={setItemSearch}
                placeholder="KC ID, title, catalogue no..."
                placeholderTextColor={Colors.textTertiary}
                autoFocus
              />
            </View>
            {loadingItems ? (
              <View style={ml.loadingCenter}>
                <ActivityIndicator color={Colors.primary} />
              </View>
            ) : (
              <FlatList
                data={items}
                keyExtractor={i => i.id}
                contentContainerStyle={{ padding: Spacing.base, gap: Spacing.sm }}
                renderItem={({ item }) => (
                  <Pressable
                    onPress={() => handleSelectItem(item)}
                    style={({ pressed }) => [ml.itemRow, pressed && { opacity: 0.85 }]}
                  >
                    {item.media.length > 0 ? (
                      <ItemImage uri={item.media[0]} style={ml.itemThumb} contentFit="cover" />
                    ) : (
                      <View style={[ml.itemThumb, ml.itemThumbPlaceholder]}>
                        <MaterialIcons name="toll" size={18} color={Colors.textTertiary} />
                      </View>
                    )}
                    <View style={{ flex: 1, gap: 3 }}>
                      {item.inventoryId ? (
                        <Text style={ml.itemKcId}>{item.inventoryId}</Text>
                      ) : null}
                      <Text style={ml.itemName} numberOfLines={2}>{item.canonicalTitle}</Text>
                      <View style={{ flexDirection: 'row', gap: 6 }}>
                        {item.expectedSellingPrice > 0 ? (
                          <Text style={ml.itemPrice}>£{item.expectedSellingPrice.toFixed(2)}</Text>
                        ) : null}
                        <Text style={ml.itemStatus}>{item.status}</Text>
                      </View>
                    </View>
                    <MaterialIcons name="chevron-right" size={18} color={Colors.textTertiary} />
                  </Pressable>
                )}
                ListEmptyComponent={
                  <View style={ml.loadingCenter}>
                    <Text style={ml.emptyText}>No items found{itemSearch ? ` for "${itemSearch}"` : ''}</Text>
                  </View>
                }
              />
            )}
          </View>
        ) : null}

        {/* STEP 2: Configure listing */}
        {step === 'configure' ? (
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ padding: Spacing.base, gap: Spacing.lg, paddingBottom: 120 }}
            keyboardShouldPersistTaps="handled"
          >
            {/* Format selector */}
            <View style={ml.sectionLabel}>
              <Text style={ml.sectionTitle}>LISTING TYPE</Text>
            </View>
            <View style={ml.formatRow}>
              <Pressable
                onPress={() => setListingType('FixedPriceItem')}
                style={[ml.formatBtn, listingType === 'FixedPriceItem' && ml.formatBtnActive]}
              >
                <MaterialIcons
                  name="sell"
                  size={20}
                  color={listingType === 'FixedPriceItem' ? Colors.primary : Colors.textTertiary}
                />
                <Text style={[ml.formatBtnLabel, listingType === 'FixedPriceItem' && { color: Colors.primary }]}>
                  Buy It Now
                </Text>
                <Text style={ml.formatBtnDesc}>Fixed price · Good Till Cancelled</Text>
              </Pressable>
              <Pressable
                onPress={() => setListingType('Chinese')}
                style={[ml.formatBtn, listingType === 'Chinese' && ml.formatBtnActive]}
              >
                <MaterialIcons
                  name="gavel"
                  size={20}
                  color={listingType === 'Chinese' ? Colors.accent : Colors.textTertiary}
                />
                <Text style={[ml.formatBtnLabel, listingType === 'Chinese' && { color: Colors.accent }]}>
                  Auction
                </Text>
                <Text style={ml.formatBtnDesc}>Timed auction · Bidding</Text>
              </Pressable>
            </View>

            {/* Title */}
            <View style={ml.field}>
              <Text style={ml.fieldLabel}>LISTING TITLE <Text style={ml.required}>*</Text></Text>
              <TextInput
                style={ml.fieldInput}
                value={title}
                onChangeText={v => setTitle(v.slice(0, 80))}
                placeholder="e.g. 1887 Victorian Crown EF · Silver Coin"
                placeholderTextColor={Colors.textTertiary}
                maxLength={80}
              />
              <Text style={ml.charCount}>{title.length}/80</Text>
            </View>

            {/* Price / Start Price */}
            {listingType === 'FixedPriceItem' ? (
              <View style={ml.field}>
                <Text style={ml.fieldLabel}>LISTING PRICE (£) <Text style={ml.required}>*</Text></Text>
                <TextInput
                  style={ml.fieldInput}
                  value={price}
                  onChangeText={setPrice}
                  keyboardType="decimal-pad"
                  placeholder="0.00"
                  placeholderTextColor={Colors.textTertiary}
                />
              </View>
            ) : (
              <>
                <View style={ml.field}>
                  <Text style={ml.fieldLabel}>START PRICE (£) <Text style={ml.required}>*</Text></Text>
                  <TextInput
                    style={ml.fieldInput}
                    value={startPrice}
                    onChangeText={setStartPrice}
                    keyboardType="decimal-pad"
                    placeholder="0.99"
                    placeholderTextColor={Colors.textTertiary}
                  />
                  <Text style={ml.fieldHint}>Low start attracts bidders — reserve price protects your floor</Text>
                </View>
                <View style={ml.field}>
                  <Text style={ml.fieldLabel}>RESERVE PRICE (£) <Text style={ml.optional}>optional</Text></Text>
                  <TextInput
                    style={ml.fieldInput}
                    value={reservePrice}
                    onChangeText={setReservePrice}
                    keyboardType="decimal-pad"
                    placeholder="Leave blank for no reserve"
                    placeholderTextColor={Colors.textTertiary}
                  />
                </View>
                {/* Auction duration */}
                <View style={ml.field}>
                  <Text style={ml.fieldLabel}>AUCTION DURATION</Text>
                  <View style={ml.durationRow}>
                    {([3, 5, 7, 10] as const).map(d => (
                      <Pressable
                        key={d}
                        onPress={() => setAuctionDays(d)}
                        style={[ml.durationChip, auctionDays === d && ml.durationChipActive]}
                      >
                        <Text style={[ml.durationChipText, auctionDays === d && { color: Colors.accent }]}>
                          {d}d
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              </>
            )}

            {/* Shipping */}
            <View style={ml.field}>
              <View style={ml.fieldLabelRow}>
                <Text style={ml.fieldLabel}>SHIPPING COST (£)</Text>
                <View style={ml.simpleDeliveryBadge}>
                  <MaterialIcons name="local-shipping" size={9} color={Colors.success} />
                  <Text style={ml.simpleDeliveryText}>eBay Simple Delivery</Text>
                </View>
              </View>
              <TextInput
                style={ml.fieldInput}
                value={shippingCost}
                onChangeText={setShippingCost}
                keyboardType="decimal-pad"
                placeholder="0.00 = Free Shipping"
                placeholderTextColor={Colors.textTertiary}
              />
              <Text style={ml.fieldHint}>Uses UK_SimpleDelivery — eBay calculates the best shipping option automatically</Text>
            </View>

            {/* Description */}
            <View style={ml.field}>
              <Text style={ml.fieldLabel}>DESCRIPTION</Text>
              <TextInput
                style={[ml.fieldInput, { minHeight: 80, textAlignVertical: 'top', paddingTop: Spacing.sm }]}
                value={description}
                onChangeText={setDescription}
                placeholder="Condition details, provenance, dimensions..."
                placeholderTextColor={Colors.textTertiary}
                multiline
              />
            </View>

            {/* Action buttons */}
            <View style={ml.actionRow}>
              <Pressable onPress={handleCreateDraft} disabled={creating || submitting} style={ml.draftBtn}>
                {creating
                  ? <ActivityIndicator size="small" color={Colors.textSecondary} style={{ width: 14, height: 14 }} />
                  : <MaterialIcons name="save" size={14} color={Colors.textSecondary} />
                }
                <Text style={ml.draftBtnText}>Save Draft</Text>
              </Pressable>
              <Pressable onPress={handleCreateAndSubmit} disabled={creating || submitting} style={ml.submitBtn}>
                {submitting
                  ? <ActivityIndicator size="small" color={Colors.background} style={{ width: 14, height: 14 }} />
                  : <MaterialIcons name={listingType === 'Chinese' ? 'gavel' : 'publish'} size={14} color={Colors.background} />
                }
                <Text style={ml.submitBtnText}>
                  {submitting ? 'Listing...' : listingType === 'Chinese' ? 'List Auction' : 'List Buy It Now'}
                </Text>
              </Pressable>
            </View>
          </ScrollView>
        ) : null}
      </KeyboardAvoidingView>
    </Modal>
  );
}

const ml = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingHorizontal: Spacing.base, paddingTop: Spacing.lg, paddingBottom: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder,
  },
  closeBtn: {
    width: 34, height: 34, borderRadius: Radius.md,
    backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.surfaceBorder,
  },
  flex: { flex: 1 },
  headerTitle: { fontSize: Typography.size.md, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  headerSub: { fontSize: Typography.size.xs, color: Colors.textTertiary, marginTop: 1 },
  backStepBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: Spacing.sm, paddingVertical: 5,
    backgroundColor: Colors.primaryDim, borderRadius: Radius.sm,
  },
  backStepText: { fontSize: Typography.size.xs, color: Colors.primary, fontWeight: Typography.weight.semibold },

  searchWrap: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: Spacing.base, marginVertical: Spacing.sm,
    backgroundColor: Colors.surface, borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.surfaceBorder, height: 40,
  },
  searchInput: {
    flex: 1, fontSize: Typography.size.sm, color: Colors.textPrimary,
    paddingVertical: 0, paddingHorizontal: Spacing.xs, includeFontPadding: false,
  },
  loadingCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 40 },
  emptyText: { fontSize: Typography.size.sm, color: Colors.textTertiary },

  itemRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.surface, borderRadius: Radius.xl, padding: Spacing.md,
    borderWidth: 1, borderColor: Colors.surfaceBorder,
  },
  itemThumb: { width: 52, height: 52, borderRadius: Radius.md },
  itemThumbPlaceholder: {
    backgroundColor: Colors.surfaceHighlight,
    alignItems: 'center', justifyContent: 'center',
  },
  itemKcId: { fontSize: 9, fontWeight: Typography.weight.bold, color: Colors.primary, letterSpacing: 0.4 },
  itemName: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.textPrimary, lineHeight: 17 },
  itemPrice: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.gold },
  itemStatus: { fontSize: 9, color: Colors.textTertiary, textTransform: 'capitalize', marginLeft: 'auto' as any },

  sectionLabel: { paddingBottom: 2 },
  sectionTitle: { fontSize: Typography.size.xs, fontWeight: Typography.weight.bold, color: Colors.textTertiary, letterSpacing: 0.6 },

  formatRow: { flexDirection: 'row', gap: Spacing.sm },
  formatBtn: {
    flex: 1, backgroundColor: Colors.surface, borderRadius: Radius.xl,
    borderWidth: 2, borderColor: Colors.surfaceBorder, padding: Spacing.md,
    alignItems: 'center', gap: Spacing.xs,
  },
  formatBtnActive: { borderColor: Colors.primary, backgroundColor: Colors.primaryDim },
  formatBtnLabel: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.textSecondary },
  formatBtnDesc: { fontSize: 9, color: Colors.textTertiary, textAlign: 'center' },

  field: { gap: 6 },
  fieldLabelRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, justifyContent: 'space-between' },
  fieldLabel: { fontSize: Typography.size.xs, fontWeight: Typography.weight.bold, color: Colors.textTertiary, letterSpacing: 0.5 },
  fieldInput: {
    backgroundColor: Colors.surface, borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.surfaceBorder,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    fontSize: Typography.size.sm, color: Colors.textPrimary, includeFontPadding: false,
  },
  fieldHint: { fontSize: 10, color: Colors.textTertiary, lineHeight: 14 },
  charCount: { fontSize: 10, color: Colors.textTertiary, textAlign: 'right' },
  required: { color: Colors.danger },
  optional: { color: Colors.textTertiary, fontWeight: Typography.weight.regular, fontSize: 9 },

  simpleDeliveryBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: Colors.successDim, borderRadius: Radius.pill,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  simpleDeliveryText: { fontSize: 9, color: Colors.success, fontWeight: Typography.weight.bold },

  durationRow: { flexDirection: 'row', gap: Spacing.sm },
  durationChip: {
    flex: 1, height: 40, borderRadius: Radius.md,
    backgroundColor: Colors.surface, borderWidth: 2, borderColor: Colors.surfaceBorder,
    alignItems: 'center', justifyContent: 'center',
  },
  durationChipActive: { borderColor: Colors.accent, backgroundColor: Colors.accentDim },
  durationChipText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.textTertiary },

  actionRow: { flexDirection: 'row', gap: Spacing.sm },
  draftBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xs,
    backgroundColor: Colors.surface, borderRadius: Radius.md, paddingVertical: Spacing.md,
    borderWidth: 1, borderColor: Colors.surfaceBorder,
  },
  draftBtnText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.textSecondary },
  submitBtn: {
    flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xs,
    backgroundColor: Colors.primary, borderRadius: Radius.md, paddingVertical: Spacing.md,
  },
  submitBtnText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.background },
});

// ── Dispatch Modal ─────────────────────────────────────────────────────────────

function DispatchModal({
  visible,
  listing,
  onClose,
  onDispatched,
  showAlert,
}: {
  visible: boolean;
  listing: EbayListing | null;
  onClose: () => void;
  onDispatched: (orderId: string, tracking: string, carrier: string) => void;
  showAlert: (title: string, message?: string, buttons?: any[]) => void;
}) {
  const [tracking, setTracking] = useState('');
  const [carrier, setCarrier] = useState('Royal Mail');
  const [saving, setSaving] = useState(false);
  const { tenant, activeNicheId } = useApp();

  useEffect(() => { if (visible) { setTracking(''); setCarrier('Royal Mail'); } }, [visible]);

  const handleConfirm = useCallback(async () => {
    if (!listing || !tenant) return;
    setSaving(true);
    const supabase = getSupabaseClient();

    // Find related order
    const { data: orders } = await supabase
      .from('orders')
      .select('id')
      .eq('tenant_id', tenant.id)
      .eq('item_id', listing.itemId)
      .in('fulfilment_status', ['awaiting_dispatch', 'packing', 'label_created'])
      .limit(1);

    const orderId = orders?.[0]?.id;

    if (orderId) {
      await supabase.from('orders').update({
        fulfilment_status: 'dispatched',
        tracking_number:   tracking || null,
        carrier:           carrier || null,
        dispatched_at:     new Date().toISOString(),
        updated_at:        new Date().toISOString(),
      }).eq('id', orderId);
    }

    setSaving(false);
    onDispatched(orderId ?? '', tracking, carrier);
    onClose();
  }, [listing, tenant, tracking, carrier, onDispatched, onClose]);

  if (!listing) return null;

  const CARRIERS = ['Royal Mail', 'Evri', 'DPD', 'Parcelforce', 'Yodel', 'DHL'];

  return (
    <Modal visible={visible} transparent animationType="slide">
      <Pressable style={dm.overlay} onPress={onClose}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <Pressable style={dm.sheet} onPress={() => {}}>
            <View style={dm.handle} />
            <Text style={dm.title}>Mark Dispatched</Text>
            <Text style={dm.itemName} numberOfLines={2}>{listing.title}</Text>
            {listing.inventoryId ? (
              <Text style={dm.kcId}>{listing.inventoryId} · {listing.folderNumber ? `Folder ${listing.folderNumber}` : ''}</Text>
            ) : null}

            {/* Carrier chips */}
            <Text style={dm.label}>CARRIER</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={dm.carrierRow}>
              {CARRIERS.map(c => (
                <Pressable
                  key={c}
                  onPress={() => setCarrier(c)}
                  style={[dm.carrierChip, carrier === c && dm.carrierChipActive]}
                >
                  <Text style={[dm.carrierChipText, carrier === c && { color: Colors.primary }]}>{c}</Text>
                </Pressable>
              ))}
            </ScrollView>

            {/* Tracking number */}
            <Text style={dm.label}>TRACKING NUMBER (optional)</Text>
            <TextInput
              style={dm.trackingInput}
              value={tracking}
              onChangeText={setTracking}
              placeholder="e.g. JD000000000GB"
              placeholderTextColor={Colors.textTertiary}
              autoCapitalize="characters"
            />

            {/* Buttons */}
            <View style={dm.btnRow}>
              <Pressable onPress={onClose} style={dm.cancelBtn}>
                <Text style={dm.cancelBtnText}>Cancel</Text>
              </Pressable>
              <Pressable onPress={handleConfirm} disabled={saving} style={dm.confirmBtn}>
                {saving
                  ? <ActivityIndicator size="small" color={Colors.background} style={{ width: 14, height: 14 }} />
                  : <MaterialIcons name="local-shipping" size={14} color={Colors.background} />
                }
                <Text style={dm.confirmBtnText}>{saving ? 'Marking...' : 'Mark Dispatched'}</Text>
              </Pressable>
            </View>
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}

const dm = StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: Colors.overlay80,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.surfaceElevated, borderTopLeftRadius: Radius.xxl, borderTopRightRadius: Radius.xxl,
    padding: Spacing.xl, paddingBottom: Spacing.xxl, gap: Spacing.md,
    borderTopWidth: 1, borderColor: Colors.surfaceBorder,
  },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.surfaceBorder, alignSelf: 'center', marginBottom: 4 },
  title: { fontSize: Typography.size.xl, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  itemName: { fontSize: Typography.size.sm, color: Colors.textSecondary, lineHeight: 18 },
  kcId: { fontSize: Typography.size.xs, color: Colors.primary, fontWeight: Typography.weight.semibold },
  label: { fontSize: 10, fontWeight: Typography.weight.bold, color: Colors.textTertiary, letterSpacing: 0.5, marginBottom: -4 },
  carrierRow: { flexDirection: 'row', gap: Spacing.xs, paddingVertical: 2 },
  carrierChip: {
    paddingHorizontal: Spacing.md, paddingVertical: 7, borderRadius: Radius.pill,
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.surfaceBorder,
  },
  carrierChipActive: { backgroundColor: Colors.primaryDim, borderColor: Colors.primary + '60' },
  carrierChipText: { fontSize: Typography.size.xs, color: Colors.textSecondary, fontWeight: Typography.weight.medium },
  trackingInput: {
    backgroundColor: Colors.surface, borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.surfaceBorder,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    fontSize: Typography.size.sm, color: Colors.textPrimary, includeFontPadding: false,
  },
  btnRow: { flexDirection: 'row', gap: Spacing.sm, marginTop: 4 },
  cancelBtn: {
    flex: 1, paddingVertical: Spacing.md, borderRadius: Radius.md,
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.surfaceBorder,
    alignItems: 'center', justifyContent: 'center',
  },
  cancelBtnText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.textSecondary },
  confirmBtn: {
    flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xs,
    paddingVertical: Spacing.md, borderRadius: Radius.md, backgroundColor: Colors.primary,
  },
  confirmBtnText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.background },
});

// ── Submit with Auction Modal ─────────────────────────────────────────────────

function AuctionSubmitModal({
  visible,
  listing,
  onClose,
  onSubmitted,
  tenantId,
  showAlert,
}: {
  visible: boolean;
  listing: EbayListing | null;
  onClose: () => void;
  onSubmitted: (listing: EbayListing) => void;
  tenantId: string;
  showAlert: (title: string, message?: string, buttons?: any[]) => void;
}) {
  const [listingType, setListingType] = useState<ListingFormat>('FixedPriceItem');
  const [auctionDays, setAuctionDays] = useState<3 | 5 | 7 | 10>(7);
  const [startPrice, setStartPrice] = useState('');
  const [reservePrice, setReservePrice] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (visible && listing) {
      setListingType('FixedPriceItem');
      setStartPrice((listing.price * 0.2).toFixed(2));
      setReservePrice('');
    }
  }, [visible, listing]);

  const handleSubmit = useCallback(async () => {
    if (!listing) return;
    if (listingType === 'Chinese') {
      const sp = parseFloat(startPrice);
      if (isNaN(sp) || sp <= 0) { showAlert('Required', 'Enter a start price for the auction.'); return; }
    }
    setSubmitting(true);
    const result = await submitListingToMarketplace(tenantId, listing.id, undefined, {
      listingType,
      auctionDays,
      startPrice: listingType === 'Chinese' ? parseFloat(startPrice) : undefined,
      reservePrice: parseFloat(reservePrice) > 0 ? parseFloat(reservePrice) : undefined,
    });
    setSubmitting(false);
    if (result.success) {
      onSubmitted({ ...listing, status: 'active', externalListingId: result.externalListingId ?? listing.externalListingId });
      onClose();
    } else {
      showAlert('Submission Failed', result.failureReasons?.join('\n') ?? result.error ?? 'Unknown error');
    }
  }, [listing, listingType, auctionDays, startPrice, reservePrice, tenantId, showAlert, onSubmitted, onClose]);

  if (!listing) return null;

  return (
    <Modal visible={visible} transparent animationType="slide">
      <Pressable style={dm.overlay} onPress={onClose}>
        <Pressable style={[dm.sheet, { paddingBottom: Spacing.xxxl ?? Spacing.xxl + Spacing.lg }]} onPress={() => {}}>
          <View style={dm.handle} />
          <Text style={dm.title}>List on eBay</Text>
          <Text style={dm.itemName} numberOfLines={2}>{listing.title}</Text>
          <Text style={[dm.label, { marginTop: 4 }]}>LISTING TYPE</Text>
          <View style={ml.formatRow}>
            <Pressable
              onPress={() => setListingType('FixedPriceItem')}
              style={[ml.formatBtn, listingType === 'FixedPriceItem' && ml.formatBtnActive]}
            >
              <MaterialIcons name="sell" size={18} color={listingType === 'FixedPriceItem' ? Colors.primary : Colors.textTertiary} />
              <Text style={[ml.formatBtnLabel, listingType === 'FixedPriceItem' && { color: Colors.primary }]}>Buy It Now</Text>
              <Text style={ml.formatBtnDesc}>£{listing.price.toFixed(2)} · GTC</Text>
            </Pressable>
            <Pressable
              onPress={() => setListingType('Chinese')}
              style={[ml.formatBtn, listingType === 'Chinese' && { ...ml.formatBtnActive, borderColor: Colors.accent, backgroundColor: Colors.accentDim }]}
            >
              <MaterialIcons name="gavel" size={18} color={listingType === 'Chinese' ? Colors.accent : Colors.textTertiary} />
              <Text style={[ml.formatBtnLabel, listingType === 'Chinese' && { color: Colors.accent }]}>Auction</Text>
              <Text style={ml.formatBtnDesc}>Timed bidding</Text>
            </Pressable>
          </View>

          {listingType === 'Chinese' ? (
            <>
              <Text style={dm.label}>AUCTION DURATION</Text>
              <View style={ml.durationRow}>
                {([3, 5, 7, 10] as const).map(d => (
                  <Pressable key={d} onPress={() => setAuctionDays(d)} style={[ml.durationChip, auctionDays === d && ml.durationChipActive]}>
                    <Text style={[ml.durationChipText, auctionDays === d && { color: Colors.accent }]}>{d}d</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={dm.label}>START PRICE (£) *</Text>
              <TextInput
                style={dm.trackingInput}
                value={startPrice}
                onChangeText={setStartPrice}
                keyboardType="decimal-pad"
                placeholder="0.99"
                placeholderTextColor={Colors.textTertiary}
              />
              <Text style={dm.label}>RESERVE PRICE (£) — optional</Text>
              <TextInput
                style={dm.trackingInput}
                value={reservePrice}
                onChangeText={setReservePrice}
                keyboardType="decimal-pad"
                placeholder="Leave blank for no reserve"
                placeholderTextColor={Colors.textTertiary}
              />
            </>
          ) : null}

          <View style={[dm.btnRow, { marginTop: 8 }]}>
            <Pressable onPress={onClose} style={dm.cancelBtn}>
              <Text style={dm.cancelBtnText}>Cancel</Text>
            </Pressable>
            <Pressable onPress={handleSubmit} disabled={submitting} style={[dm.confirmBtn, { backgroundColor: listingType === 'Chinese' ? Colors.accent : Colors.primary }]}>
              {submitting
                ? <ActivityIndicator size="small" color={Colors.background} style={{ width: 14, height: 14 }} />
                : <MaterialIcons name={listingType === 'Chinese' ? 'gavel' : 'publish'} size={14} color={Colors.background} />
              }
              <Text style={dm.confirmBtnText}>{submitting ? 'Listing...' : listingType === 'Chinese' ? 'Start Auction' : 'List Buy It Now'}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ── Listing Row ───────────────────────────────────────────────────────────────

function ListingRow({
  item,
  editingPriceId, priceEditValue, savingPriceId,
  endingId, submittingId, dispatchingId,
  onEditPrice, onPriceChange, onSavePrice, onCancelEdit,
  onEnd, onRelist, onSubmit, onViewOnEbay, onNavigateItem, onDispatch,
}: {
  item: EbayListing;
  editingPriceId: string | null; priceEditValue: string; savingPriceId: string | null;
  endingId: string | null; submittingId: string | null; dispatchingId: string | null;
  onEditPrice: (id: string, current: number) => void;
  onPriceChange: (v: string) => void;
  onSavePrice: (id: string, itemId: string) => void;
  onCancelEdit: () => void;
  onEnd: (listing: EbayListing) => void;
  onRelist: (listing: EbayListing) => void;
  onSubmit: (listing: EbayListing) => void;
  onViewOnEbay: (listing: EbayListing) => void;
  onNavigateItem: (listing: EbayListing) => void;
  onDispatch: (listing: EbayListing) => void;
}) {
  const router = useRouter();
  const statusColor  = STATUS_COLORS[item.status] ?? Colors.textTertiary;
  const isActive     = item.status === 'active';
  const isDraft      = item.status === 'draft' || item.status === 'needs_correction';
  const isVerified   = item.status === 'pending';
  const isEnded      = item.status === 'ended';
  const isSold       = item.status === 'sold';
  const isEditingPrice = editingPriceId === item.id;
  const isSavingPrice  = savingPriceId === item.id;
  const isEnding       = endingId === item.id;
  const isSubmitting   = submittingId === item.id;
  const isDispatching  = dispatchingId === item.id;
  const hasPhoto = item.itemMedia.length > 0;

  const itemStatusColor = ITEM_STATUS_COLORS[item.itemStatus] ?? Colors.textTertiary;
  const itemStatusLabel = ITEM_STATUS_LABELS[item.itemStatus] ?? item.itemStatus;
  const statusMismatch  = !!item.itemStatus && !isStatusMatch(item.status, item.itemStatus);

  return (
    <View style={[row.card, statusMismatch && row.cardMismatch]}>
      <View style={[row.stripe, { backgroundColor: statusMismatch ? Colors.warning : statusColor }]} />

      <View style={row.body}>
        {/* Top: photo + meta */}
        <View style={row.topRow}>
          {hasPhoto ? (
            <ItemImage uri={item.itemMedia[0]} style={row.photo} contentFit="cover" transition={150} />
          ) : (
            <View style={row.photoPlaceholder}>
              <MaterialIcons name="toll" size={18} color={Colors.textTertiary} />
            </View>
          )}
          <View style={{ flex: 1, gap: 4 }}>
            <View style={row.badges}>
              {item.inventoryId ? (
                <View style={row.kcBadge}>
                  <Text style={row.kcBadgeText}>{item.inventoryId}</Text>
                </View>
              ) : null}
              {item.catalogueNumber ? (
                <View style={row.catBadge}>
                  <MaterialIcons name="tag" size={9} color={Colors.accent} />
                  <Text style={row.catBadgeText}>{item.catalogueNumber}</Text>
                </View>
              ) : null}
              {item.folderNumber ? (
                <View style={row.folderBadge}>
                  <MaterialIcons name="folder" size={9} color={Colors.textTertiary} />
                  <Text style={row.folderBadgeText}>
                    F{item.folderNumber}{item.pocketPosition ? ` · P${item.pocketPosition}` : ''}
                  </Text>
                </View>
              ) : null}
              <View style={[row.statusPill, { backgroundColor: statusColor + '20' }]}>
                <View style={[row.statusDot, { backgroundColor: statusColor }]} />
                <Text style={[row.statusText, { color: statusColor }]}>
                  {item.status === 'pending' ? 'Verified' : item.status}
                </Text>
              </View>
            </View>
            <Text style={row.title} numberOfLines={2}>{item.title}</Text>

            {/* Dual status sync indicator */}
            {item.itemStatus ? (
              <View style={[row.dualStatusRow, statusMismatch && row.dualStatusRowMismatch]}>
                <View style={row.dualStatusGroup}>
                  <Text style={row.dualStatusLabel}>Listing</Text>
                  <View style={[row.dualStatusPill, { backgroundColor: statusColor + '18', borderColor: statusColor + '50' }]}>
                    <View style={[row.dualStatusDot, { backgroundColor: statusColor }]} />
                    <Text style={[row.dualStatusText, { color: statusColor }]}>
                      {item.status === 'pending' ? 'verified' : item.status}
                    </Text>
                  </View>
                </View>
                <MaterialIcons
                  name={statusMismatch ? 'sync-problem' : 'compare-arrows'}
                  size={10}
                  color={statusMismatch ? Colors.warning : Colors.textTertiary}
                />
                <View style={row.dualStatusGroup}>
                  <Text style={row.dualStatusLabel}>Inventory</Text>
                  <View style={[row.dualStatusPill, { backgroundColor: itemStatusColor + '18', borderColor: itemStatusColor + '50' }]}>
                    <View style={[row.dualStatusDot, { backgroundColor: itemStatusColor }]} />
                    <Text style={[row.dualStatusText, { color: itemStatusColor }]}>{itemStatusLabel.toLowerCase()}</Text>
                  </View>
                </View>
                {statusMismatch ? (
                  <View style={row.mismatchChip}>
                    <MaterialIcons name="warning" size={9} color={Colors.warning} />
                    <Text style={row.mismatchChipText}>Sync needed</Text>
                  </View>
                ) : (
                  <View style={row.syncedChip}>
                    <MaterialIcons name="check" size={9} color={Colors.success} />
                    <Text style={row.syncedChipText}>In sync</Text>
                  </View>
                )}
              </View>
            ) : null}

            {/* Coin meta */}
            {(item.ruler || item.denomination || item.countryOfOrigin) ? (
              <View style={row.coinMeta}>
                {item.ruler ? <Text style={row.metaText}>{item.ruler}</Text> : null}
                {item.denomination ? <Text style={[row.metaText, { color: Colors.gold }]}>{item.denomination}</Text> : null}
                {item.countryOfOrigin ? <Text style={row.metaText}>{item.countryOfOrigin}</Text> : null}
              </View>
            ) : null}
          </View>
        </View>

        {/* Price row */}
        <View style={row.priceRow}>
          {isEditingPrice ? (
            <View style={row.priceEdit}>
              <Text style={row.priceCurrency}>£</Text>
              <TextInput
                style={row.priceInput}
                value={priceEditValue}
                onChangeText={onPriceChange}
                keyboardType="decimal-pad"
                autoFocus
                selectTextOnFocus
              />
              <Pressable
                onPress={() => onSavePrice(item.id, item.itemId)}
                disabled={isSavingPrice}
                style={row.priceSaveBtn}
              >
                {isSavingPrice
                  ? <ActivityIndicator size="small" color={Colors.background} style={{ width: 14, height: 14 }} />
                  : <MaterialIcons name="check" size={14} color={Colors.background} />
                }
              </Pressable>
              <Pressable onPress={onCancelEdit} style={row.priceCancelBtn} hitSlop={6}>
                <MaterialIcons name="close" size={14} color={Colors.textSecondary} />
              </Pressable>
            </View>
          ) : (
            <Pressable
              onPress={() => !isSold && onEditPrice(item.id, item.price)}
              style={row.priceDisplay}
              hitSlop={4}
              disabled={isSold}
            >
              <Text style={row.priceValue}>£{item.price.toFixed(2)}</Text>
              {!isSold ? <MaterialIcons name="edit" size={11} color={Colors.textTertiary} /> : null}
            </Pressable>
          )}
          {item.shippingCost > 0 ? (
            <Text style={row.shippingText}>+ £{item.shippingCost.toFixed(2)} P&P</Text>
          ) : (
            <View style={row.freeShippingChip}>
              <MaterialIcons name="local-shipping" size={9} color={Colors.success} />
              <Text style={row.freeShippingText}>Free · Simple Delivery</Text>
            </View>
          )}
          {isActive && (item.views > 0 || item.watchers > 0) ? (
            <View style={row.stats}>
              {item.views > 0 ? (
                <View style={row.statChip}>
                  <MaterialIcons name="visibility" size={9} color={Colors.textTertiary} />
                  <Text style={row.statText}>{item.views}</Text>
                </View>
              ) : null}
              {item.watchers > 0 ? (
                <View style={row.statChip}>
                  <MaterialIcons name="star-outline" size={9} color={Colors.gold} />
                  <Text style={[row.statText, { color: Colors.gold }]}>{item.watchers}</Text>
                </View>
              ) : null}
            </View>
          ) : null}
          <Text style={row.dateText}>
            {item.publishedAt
              ? new Date(item.publishedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
              : new Date(item.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
          </Text>
        </View>

        {/* Action buttons */}
        <View style={row.actions}>
          {isActive ? (
            <>
              <Pressable onPress={() => onViewOnEbay(item)} style={row.actionBtn}>
                <MaterialIcons name="open-in-new" size={11} color={Colors.accent} />
                <Text style={[row.actionBtnText, { color: Colors.accent }]}>View</Text>
              </Pressable>
              <Pressable
                onPress={() => onDispatch(item)}
                disabled={isDispatching}
                style={[row.actionBtn, { backgroundColor: Colors.warningDim, borderColor: Colors.warning + '40' }]}
              >
                <MaterialIcons name="local-shipping" size={11} color={Colors.warning} />
                <Text style={[row.actionBtnText, { color: Colors.warning }]}>Dispatch</Text>
              </Pressable>
              <Pressable
                onPress={() => onEnd(item)}
                disabled={isEnding}
                style={[row.actionBtn, row.actionBtnDanger]}
              >
                {isEnding
                  ? <ActivityIndicator size="small" color={Colors.danger} style={{ width: 11, height: 11 }} />
                  : <MaterialIcons name="stop-circle" size={11} color={Colors.danger} />
                }
                <Text style={[row.actionBtnText, { color: Colors.danger }]}>End</Text>
              </Pressable>
            </>
          ) : null}
          {(isDraft || isVerified) ? (
            <Pressable
              onPress={() => onSubmit(item)}
              disabled={isSubmitting}
              style={[row.actionBtn, row.actionBtnPrimary]}
            >
              {isSubmitting
                ? <ActivityIndicator size="small" color={Colors.background} style={{ width: 11, height: 11 }} />
                : <MaterialIcons name="publish" size={11} color={Colors.background} />
              }
              <Text style={[row.actionBtnText, { color: Colors.background }]}>
                {isSubmitting ? 'Listing...' : 'List on eBay'}
              </Text>
            </Pressable>
          ) : null}
          {isEnded ? (
            <Pressable onPress={() => onRelist(item)} style={[row.actionBtn, row.actionBtnInfo]}>
              <MaterialIcons name="refresh" size={11} color={Colors.info} />
              <Text style={[row.actionBtnText, { color: Colors.info }]}>Relist</Text>
            </Pressable>
          ) : null}
          {isSold ? (
            <View style={[row.actionBtn, { backgroundColor: Colors.successDim, borderColor: Colors.success + '40' }]}>
              <MaterialIcons name="check-circle" size={11} color={Colors.success} />
              <Text style={[row.actionBtnText, { color: Colors.success }]}>Sold</Text>
            </View>
          ) : null}
          {/* Always: open listing editor */}
          <Pressable
            onPress={() => router.push((`/ebay-listing-editor?id=${item.id}`) as any)}
            style={[row.actionBtn, { backgroundColor: Colors.primaryDim, borderColor: Colors.primary + '40' }]}
          >
            <MaterialIcons name="edit" size={11} color={Colors.primary} />
            <Text style={[row.actionBtnText, { color: Colors.primary }]}>Edit</Text>
          </Pressable>
          {/* Always: navigate to inventory item */}
          <Pressable onPress={() => onNavigateItem(item)} style={row.actionBtn}>
            <MaterialIcons name="toll" size={11} color={Colors.primary} />
            <Text style={[row.actionBtnText, { color: Colors.primary }]}>Item</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const row = StyleSheet.create({
  card: {
    flexDirection: 'row', backgroundColor: Colors.surface,
    borderRadius: Radius.xl, overflow: 'hidden',
    borderWidth: 1, borderColor: Colors.surfaceBorder, ...Shadow.sm,
  },
  stripe: { width: 4, flexShrink: 0 },
  cardMismatch: { borderColor: Colors.warning + '80' },
  body: { flex: 1, padding: Spacing.md, gap: Spacing.sm },
  topRow: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start' },
  photo: { width: 56, height: 56, borderRadius: Radius.md },
  photoPlaceholder: {
    width: 56, height: 56, borderRadius: Radius.md,
    backgroundColor: Colors.surfaceHighlight, alignItems: 'center', justifyContent: 'center',
  },
  badges: { flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' },
  kcBadge: {
    backgroundColor: Colors.primaryDim, borderRadius: Radius.sm,
    paddingHorizontal: 5, paddingVertical: 2, borderWidth: 1, borderColor: Colors.primary + '40',
  },
  kcBadgeText: { fontSize: 9, fontWeight: Typography.weight.bold, color: Colors.primary, letterSpacing: 0.4 },
  catBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    backgroundColor: Colors.accentDim, borderRadius: Radius.sm, paddingHorizontal: 5, paddingVertical: 2,
  },
  catBadgeText: { fontSize: 9, color: Colors.accent, fontWeight: Typography.weight.semibold },
  folderBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.sm, paddingHorizontal: 5, paddingVertical: 2,
  },
  folderBadgeText: { fontSize: 9, color: Colors.textTertiary },
  statusPill: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 5, paddingVertical: 2, borderRadius: Radius.pill,
  },
  statusDot: { width: 5, height: 5, borderRadius: 3 },
  statusText: { fontSize: 9, fontWeight: Typography.weight.bold, textTransform: 'capitalize' },
  title: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.textPrimary, lineHeight: 17 },
  coinMeta: { flexDirection: 'row', gap: 5, flexWrap: 'wrap' },
  metaText: {
    fontSize: 9, color: Colors.textTertiary,
    backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.sm, paddingHorizontal: 4, paddingVertical: 2,
  },
  dualStatusRow: {
    flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap',
    backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.sm,
    paddingHorizontal: 7, paddingVertical: 4,
  },
  dualStatusRowMismatch: {
    backgroundColor: Colors.warningDim, borderWidth: 1, borderColor: Colors.warning + '30',
  },
  dualStatusGroup: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dualStatusLabel: { fontSize: 9, color: Colors.textTertiary, fontWeight: Typography.weight.medium },
  dualStatusPill: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 5, paddingVertical: 2, borderRadius: Radius.pill, borderWidth: 1,
  },
  dualStatusDot: { width: 4, height: 4, borderRadius: 2 },
  dualStatusText: { fontSize: 9, fontWeight: Typography.weight.bold },
  mismatchChip: {
    flexDirection: 'row', alignItems: 'center', gap: 3, marginLeft: 'auto' as any,
    backgroundColor: Colors.warning + '25', borderRadius: Radius.pill,
    paddingHorizontal: 5, paddingVertical: 2, borderWidth: 1, borderColor: Colors.warning + '50',
  },
  mismatchChipText: { fontSize: 9, color: Colors.warning, fontWeight: Typography.weight.bold },
  syncedChip: {
    flexDirection: 'row', alignItems: 'center', gap: 3, marginLeft: 'auto' as any,
    backgroundColor: Colors.success + '15', borderRadius: Radius.pill, paddingHorizontal: 5, paddingVertical: 2,
  },
  syncedChipText: { fontSize: 9, color: Colors.success, fontWeight: Typography.weight.medium },

  priceRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flexWrap: 'wrap' },
  priceEdit: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.md,
    paddingHorizontal: Spacing.sm, paddingVertical: 4,
    borderWidth: 1, borderColor: Colors.primary,
  },
  priceCurrency: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.primary },
  priceInput: { minWidth: 60, fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.textPrimary, includeFontPadding: false },
  priceSaveBtn: { width: 22, height: 22, borderRadius: Radius.sm, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  priceCancelBtn: { width: 22, height: 22, borderRadius: Radius.sm, alignItems: 'center', justifyContent: 'center' },
  priceDisplay: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  priceValue: { fontSize: Typography.size.md, fontWeight: Typography.weight.bold, color: Colors.gold },
  shippingText: { fontSize: 10, color: Colors.textTertiary },
  freeShippingChip: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: Colors.successDim, borderRadius: Radius.pill,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  freeShippingText: { fontSize: 9, color: Colors.success, fontWeight: Typography.weight.semibold },
  stats: { flexDirection: 'row', gap: 4, marginLeft: 'auto' as any },
  statChip: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.sm, paddingHorizontal: 4, paddingVertical: 2,
  },
  statText: { fontSize: 9, color: Colors.textTertiary, fontWeight: Typography.weight.medium },
  dateText: { fontSize: 9, color: Colors.textTertiary, marginLeft: 'auto' as any },

  actions: { flexDirection: 'row', gap: Spacing.xs, flexWrap: 'wrap' },
  actionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: Spacing.sm, paddingVertical: 5, borderRadius: Radius.sm,
    backgroundColor: Colors.surfaceHighlight, borderWidth: 1, borderColor: Colors.surfaceBorder,
  },
  actionBtnText: { fontSize: 10, fontWeight: Typography.weight.semibold, color: Colors.textSecondary },
  actionBtnPrimary: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  actionBtnDanger: { backgroundColor: Colors.dangerDim, borderColor: Colors.danger + '40' },
  actionBtnInfo: { backgroundColor: Colors.infoDim, borderColor: Colors.info + '40' },
});

// ── Main Screen ───────────────────────────────────────────────────────────────

export default function EbayAdminScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { tenant, activeNicheId } = useApp();
  const { showAlert } = useAlert();

  const [listings, setListings] = useState<EbayListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<StatusTab>('all');
  const [search, setSearch] = useState('');

  const [editingPriceId, setEditingPriceId] = useState<string | null>(null);
  const [priceEditValue, setPriceEditValue] = useState('');
  const [savingPriceId, setSavingPriceId] = useState<string | null>(null);
  const [endingId, setEndingId] = useState<string | null>(null);
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [dispatchingId, setDispatchingId] = useState<string | null>(null);
  const [importingOrders, setImportingOrders] = useState(false);
  const [syncingStatus, setSyncingStatus] = useState(false);

  // Image refresh state
  const [imageRefreshing, setImageRefreshing] = useState(false);
  const [imageProgress, setImageProgress] = useState<ImageRefreshProgress | null>(null);

  // Batch submit state
  const [submittingAll, setSubmittingAll] = useState(false);
  const [submitAllProgress, setSubmitAllProgress] = useState<{
    current: number; total: number; succeeded: number; failed: number;
    errors: string[];
  } | null>(null);

  // Modals
  const [showCreate, setShowCreate] = useState(false);
  const [dispatchListing, setDispatchListing] = useState<EbayListing | null>(null);
  const [auctionListing, setAuctionListing] = useState<EbayListing | null>(null);

  // ── Load ──────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    if (!tenant) return;
    const supabase = getSupabaseClient();

    // Strict niche isolation: the shared eBay account can contain listings
    // for every SWISH product, but this screen must only show the active niche.
    // If no niche is selected, fail closed rather than leaking cross-niche stock.
    const specialistIds = getProductionNicheSpecialistIds(activeNicheId);
    if (specialistIds.length === 0) {
      setListings([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const { data, error } = await supabase
      .from('listings')
      .select(`*, items!inner(id, canonical_title, specialist_id, status, condition, inventory_id, catalogue_number, folder_number, pocket_position, storage_location, media, ruler, denomination, country_of_origin)`)
      .eq('tenant_id', tenant.id)
      .eq('marketplace_id', 'ebay')
      .in('items.specialist_id', specialistIds)
      .order('updated_at', { ascending: false })
      .limit(500);

    if (error) { showAlert('Load Error', error.message); setLoading(false); setRefreshing(false); return; }

    setListings((data ?? []).map((r: any) => ({
      id: r.id,
      itemId: r.item_id,
      title: r.title,
      price: Number(r.price ?? 0),
      shippingCost: Number(r.shipping_cost ?? 0),
      status: r.status,
      externalListingId: r.external_listing_id ?? undefined,
      views: Number(r.views ?? 0),
      watchers: Number(r.watchers ?? 0),
      publishedAt: r.published_at ?? undefined,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      inventoryId: r.items?.inventory_id ?? undefined,
      catalogueNumber: r.items?.catalogue_number ?? undefined,
      folderNumber: r.items?.folder_number ?? undefined,
      pocketPosition: r.items?.pocket_position ?? undefined,
      storageLocation: r.items?.storage_location ?? undefined,
      itemTitle: r.items?.canonical_title ?? r.title,
      itemMedia: r.items?.media ?? [],
      itemStatus: r.items?.status ?? '',
      condition: r.items?.condition ?? undefined,
      ruler: r.items?.ruler ?? undefined,
      denomination: r.items?.denomination ?? undefined,
      countryOfOrigin: r.items?.country_of_origin ?? undefined,
    })));

    setLoading(false);
    setRefreshing(false);
  }, [tenant?.id, activeNicheId, showAlert]);

  useEffect(() => { load(); }, [load]);

  const onRefresh = useCallback(async () => { setRefreshing(true); await load(); }, [load]);

  // ── Filter ────────────────────────────────────────────────────────────────

  const displayed = useMemo(() => {
    let result = listings;
    if (activeTab !== 'all') result = result.filter(l => l.status === activeTab);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(l =>
        l.inventoryId?.toLowerCase().includes(q) ||
        l.catalogueNumber?.toLowerCase().includes(q) ||
        l.title.toLowerCase().includes(q) ||
        l.folderNumber?.toLowerCase().includes(q) ||
        l.externalListingId?.includes(q) ||
        l.ruler?.toLowerCase().includes(q) ||
        l.denomination?.toLowerCase().includes(q)
      );
    }
    return result;
  }, [listings, activeTab, search]);

  const tabCounts = useMemo(() => {
    const counts: Record<string, number> = { all: listings.length };
    for (const l of listings) { counts[l.status] = (counts[l.status] ?? 0) + 1; }
    return counts;
  }, [listings]);

  // ── Inline price edit ─────────────────────────────────────────────────────

  const handleEditPrice = useCallback((id: string, current: number) => {
    setEditingPriceId(id); setPriceEditValue(current.toFixed(2));
  }, []);

  const handleSavePrice = useCallback(async (id: string, itemId: string) => {
    const newPrice = parseFloat(priceEditValue);
    if (isNaN(newPrice) || newPrice < 0) { showAlert('Invalid Price', 'Enter a valid price.'); return; }
    setSavingPriceId(id);
    const { error } = await updateListingPrice(id, newPrice);
    setSavingPriceId(null);
    if (error) { showAlert('Update Failed', error); return; }
    setListings(prev => prev.map(l => l.id === id ? { ...l, price: newPrice } : l));
    setEditingPriceId(null);
  }, [priceEditValue, showAlert]);

  // ── End listing ───────────────────────────────────────────────────────────

  const handleEnd = useCallback((listing: EbayListing) => {
    const isLive = listing.status === 'active' && listing.externalListingId;
    showAlert(
      'End eBay Listing',
      isLive
        ? `This will remove listing #${listing.externalListingId} from eBay immediately. Continue?`
        : `Remove "${listing.title.slice(0, 50)}" from SWISH?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'End Listing', style: 'destructive',
          onPress: async () => {
            setEndingId(listing.id);
            const { error } = await endListing(
              listing.id,
              listing.itemId,
              tenant?.id,
              listing.externalListingId,
            );
            setEndingId(null);
            if (error) { showAlert('Error', error); return; }
            setListings(prev => prev.map(l => l.id === listing.id ? { ...l, status: 'ended' } : l));
            if (isLive) showAlert('Listing Ended', `eBay listing #${listing.externalListingId} has been removed.`);
          },
        },
      ]
    );
  }, [tenant?.id, showAlert]);

  // ── Relist ────────────────────────────────────────────────────────────────

  const handleRelist = useCallback((listing: EbayListing) => {
    showAlert('Relist Item', 'Go to the inventory item to generate a new listing.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Go to Item', onPress: () => router.push(`/stock-listing/${listing.itemId}` as any) },
    ]);
  }, [router, showAlert]);

  // ── Submit (with auction modal) ────────────────────────────────────────────

  const handleSubmit = useCallback((listing: EbayListing) => {
    setAuctionListing(listing);
  }, []);

  // ── Dispatch ──────────────────────────────────────────────────────────────

  const handleDispatch = useCallback((listing: EbayListing) => {
    setDispatchListing(listing);
  }, []);

  const handleDispatched = useCallback((orderId: string, tracking: string, carrier: string) => {
    showAlert(
      'Dispatched',
      `Item marked as dispatched.${tracking ? `\nTracking: ${tracking} via ${carrier}` : ''}`,
    );
  }, [showAlert]);

  // ── Sync status ───────────────────────────────────────────────────────────

  const handleSyncStatus = useCallback(async () => {
    if (!tenant) return;
    setSyncingStatus(true);
    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase.rpc('swish_sync_item_statuses', { p_tenant_id: tenant.id });
      if (error) { showAlert('Sync Failed', error.message); return; }
      const result = data as { sold: number; listed: number; available: number; total: number };
      if (result.total === 0) {
        showAlert('Already In Sync', 'All item statuses are correct — no changes needed.');
      } else {
        showAlert('Status Sync Complete', `Updated ${result.total} item${result.total === 1 ? '' : 's'}:\n• ${result.listed} → Listed\n• ${result.sold} → Sold\n• ${result.available} → Available`);
        await load();
      }
    } finally { setSyncingStatus(false); }
  }, [tenant, showAlert, load]);

  // ── Submit all drafts ────────────────────────────────────────────────────────

  const handleSubmitAllDrafts = useCallback(async () => {
    if (!tenant) return;
    const drafts = listings.filter(l => l.status === 'draft' || l.status === 'pending');
    if (drafts.length === 0) {
      showAlert('No Drafts', 'There are no draft or verified listings to submit.');
      return;
    }

    showAlert(
      `Submit ${drafts.length} Listing${drafts.length === 1 ? '' : 's'}`,
      `This will submit all ${drafts.length} draft/verified listing${drafts.length === 1 ? '' : 's'} to eBay in sequence. This may take a few minutes.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Submit All',
          onPress: async () => {
            setSubmittingAll(true);
            setSubmitAllProgress({ current: 0, total: drafts.length, succeeded: 0, failed: 0, errors: [] });

            let succeeded = 0;
            let failed = 0;
            const errors: string[] = [];

            for (let i = 0; i < drafts.length; i++) {
              const listing = drafts[i];
              setSubmitAllProgress({ current: i + 1, total: drafts.length, succeeded, failed, errors: [...errors] });

              const result = await submitListingToMarketplace(tenant.id, listing.id);
              if (result.success) {
                succeeded++;
                setListings(prev => prev.map(l =>
                  l.id === listing.id
                    ? { ...l, status: 'active', externalListingId: result.externalListingId ?? l.externalListingId }
                    : l
                ));
              } else {
                failed++;
                const errMsg = result.failureReasons?.join('; ') ?? result.error ?? 'Unknown error';
                errors.push(`${listing.title.slice(0, 30)}: ${errMsg}`);
              }
            }

            setSubmitAllProgress({ current: drafts.length, total: drafts.length, succeeded, failed, errors });
            setSubmittingAll(false);

            const summary = `${succeeded} listed successfully${failed > 0 ? `\n${failed} failed` : ''}${
              errors.length > 0 ? '\n\nErrors:\n' + errors.slice(0, 5).join('\n') : ''
            }`;
            showAlert(
              failed === 0 ? 'All Listed on eBay ✓' : `${succeeded} Listed, ${failed} Failed`,
              summary,
            );
          },
        },
      ],
    );
  }, [tenant, listings, showAlert]);

  // ── Refresh all eBay images ─────────────────────────────────────────────────

  const handleRefreshImages = useCallback(async () => {
    if (!tenant || imageRefreshing) return;
    setImageRefreshing(true);
    setImageProgress({ current: 0, total: 0, updated: 0, failed: 0, done: false });
    try {
      await refreshAllEbayImages(tenant.id, p => setImageProgress(p));
    } catch (e: any) {
      showAlert('Image Refresh Failed', e?.message ?? 'Unknown error');
    } finally {
      setImageRefreshing(false);
    }
  }, [tenant, imageRefreshing, showAlert]);

  // ── Import orders ──────────────────────────────────────────────────────────

  const handleImportOrders = useCallback(async () => {
    if (!tenant) return;
    setImportingOrders(true);
    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase.functions.invoke('swish-ebay-orders', {
        body: { tenantId: tenant.id, daysBack: 90 },
      });
      if (error) {
        let msg = error.message;
        if (error instanceof FunctionsHttpError) {
          try { const t = await error.context?.text(); const p = t ? JSON.parse(t) : null; msg = p?.error ?? t ?? msg; } catch {}
        }
        showAlert('Import Failed', msg); return;
      }
      const { imported = 0, matched = 0, skipped = 0, total = 0 } = data ?? {};
      showAlert('Import Complete', `${total} orders processed:\n• ${imported} imported\n• ${matched} matched to inventory\n• ${skipped} skipped`);
      if (imported > 0) await load();
    } finally { setImportingOrders(false); }
  }, [tenant, showAlert, load]);

  // ── View on eBay ──────────────────────────────────────────────────────────

  const handleViewOnEbay = useCallback((listing: EbayListing) => {
    if (listing.externalListingId) {
      Linking.openURL(`https://www.ebay.co.uk/itm/${listing.externalListingId}`);
    }
  }, []);

  // ── Stats ─────────────────────────────────────────────────────────────────

  const mismatchCount = useMemo(() => listings.filter(l => l.itemStatus && !isStatusMatch(l.status, l.itemStatus)).length, [listings]);
  const totalActive  = tabCounts['active'] ?? 0;
  const totalRevenue = listings.filter(l => l.status === 'sold').reduce((s, l) => s + l.price, 0);
  const draftCount   = (tabCounts['draft'] ?? 0) + (tabCounts['pending'] ?? 0);

  return (
    <View style={s.container}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={[s.header, { paddingTop: insets.top + Spacing.base }]}>
        <Pressable onPress={() => router.back()} style={s.backBtn} hitSlop={8}>
          <MaterialIcons name="arrow-back" size={20} color={Colors.textSecondary} />
        </Pressable>
        <View style={s.flex}>
          <View style={s.titleRow}>
            <View style={s.ebayBadge}>
              <Text style={s.ebayBadgeText}>eBay</Text>
            </View>
            <Text style={s.title}>Admin</Text>
          </View>
          <Text style={s.subtitle}>
            {totalActive} active · {listings.length} total · £{totalRevenue.toFixed(0)} sold
            {mismatchCount > 0 ? ` · ${mismatchCount} ⚠` : ''}
          </Text>
        </View>

        {/* Create new listing */}
        <Pressable
          onPress={() => setShowCreate(true)}
          style={[s.headerBtn, { backgroundColor: Colors.primary, borderColor: Colors.primary }]}
          hitSlop={4}
        >
          <MaterialIcons name="add" size={14} color={Colors.background} />
          <Text style={[s.headerBtnText, { color: Colors.background }]}>List Item</Text>
        </Pressable>

        {/* Sync Status */}
        <Pressable
          onPress={handleSyncStatus}
          disabled={syncingStatus}
          style={[s.headerBtn, { backgroundColor: Colors.primaryDim, borderColor: Colors.primary + '50' }]}
          hitSlop={4}
        >
          {syncingStatus
            ? <ActivityIndicator size="small" color={Colors.primary} style={{ width: 14, height: 14 }} />
            : <MaterialIcons name="sync" size={14} color={Colors.primary} />
          }
          <Text style={[s.headerBtnText, { color: Colors.primary }]}>
            {syncingStatus ? '...' : 'Sync'}
          </Text>
        </Pressable>

        {/* Import Orders */}
        <Pressable
          onPress={handleImportOrders}
          disabled={importingOrders}
          style={[s.headerBtn, { backgroundColor: Colors.successDim, borderColor: Colors.success + '50' }]}
          hitSlop={4}
        >
          {importingOrders
            ? <ActivityIndicator size="small" color={Colors.success} style={{ width: 14, height: 14 }} />
            : <MaterialIcons name="receipt-long" size={14} color={Colors.success} />
          }
          <Text style={[s.headerBtnText, { color: Colors.success }]}>
            {importingOrders ? '...' : 'Orders'}
          </Text>
        </Pressable>

        {/* Submit All Drafts */}
        {draftCount > 0 ? (
          <Pressable
            onPress={handleSubmitAllDrafts}
            disabled={submittingAll}
            style={[s.headerBtn, { backgroundColor: Colors.accentDim, borderColor: Colors.accent + '50' }]}
            hitSlop={4}
          >
            {submittingAll
              ? <ActivityIndicator size="small" color={Colors.accent} style={{ width: 14, height: 14 }} />
              : <MaterialIcons name="publish" size={14} color={Colors.accent} />
            }
            <Text style={[s.headerBtnText, { color: Colors.accent }]}>
              {submittingAll ? '...' : `List All (${draftCount})`}
            </Text>
          </Pressable>
        ) : null}

        {/* Import listings */}
        <Pressable
          onPress={() => router.push('/ebay-import' as any)}
          style={s.headerBtn}
          hitSlop={4}
        >
          <MaterialIcons name="cloud-download" size={14} color={Colors.info} />
          <Text style={s.headerBtnText}>Import</Text>
        </Pressable>

        {/* eBay Hub */}
        <Pressable
          onPress={() => router.push('/ebay-hub' as any)}
          style={[s.headerBtn, { backgroundColor: '#E5323815', borderColor: '#E5323840' }]}
          hitSlop={4}
        >
          <MaterialIcons name="storefront" size={14} color="#E53238" />
          <Text style={[s.headerBtnText, { color: '#E53238' }]}>Hub</Text>
        </Pressable>
      </View>

      {/* ── Refresh Images Banner ──────────────────────────────────────────── */}
      <Pressable
        onPress={imageProgress?.done ? () => setImageProgress(null) : handleRefreshImages}
        disabled={imageRefreshing}
        style={({ pressed }) => [
          s.imageBanner,
          imageProgress?.done ? s.imageBannerDone : null,
          pressed && !imageRefreshing && { opacity: 0.88 },
        ]}
      >
        <View style={s.imageBannerLeft}>
          {imageRefreshing ? (
            <ActivityIndicator size="small" color={imageProgress?.done ? Colors.success : Colors.accent} />
          ) : imageProgress?.done ? (
            <MaterialIcons name="check-circle" size={16} color={Colors.success} />
          ) : (
            <MaterialIcons name="image-search" size={16} color={Colors.accent} />
          )}
          <View style={{ flex: 1 }}>
            <Text style={[s.imageBannerTitle, imageProgress?.done && { color: Colors.success }]}>
              {imageProgress?.done
                ? `Images stored · ${imageProgress.updated} permanent · ${imageProgress.failed} not found`
                : imageRefreshing
                ? imageProgress && imageProgress.current < imageProgress.total
                  ? `Fetching from eBay... ${imageProgress.current}/${imageProgress.total}`
                  : 'Downloading & storing permanently...'
                : 'Download & Store eBay Images'}
            </Text>
            {!imageProgress ? (
              <Text style={s.imageBannerSub}>
                Downloads photos from eBay and stores permanently in SWISH
              </Text>
            ) : imageProgress.done ? (
              <Text style={s.imageBannerSub}>Tap to dismiss</Text>
            ) : null}
          </View>
        </View>

        {/* Progress bar or action buttons */}
        {imageRefreshing && imageProgress && imageProgress.total > 0 ? (
          <View style={s.imageBannerProgressWrap}>
            <View style={s.imageBannerTrack}>
              <View
                style={[
                  s.imageBannerFill,
                  { width: `${Math.round((imageProgress.current / imageProgress.total) * 100)}%` as any },
                ]}
              />
            </View>
            <Text style={s.imageBannerPct}>
              {Math.round((imageProgress.current / imageProgress.total) * 100)}%
            </Text>
          </View>
        ) : imageProgress?.done ? (
          <View style={s.imageBannerDoneRow}>
            {imageProgress.failed > 0 ? (
              <Pressable
                onPress={(e) => { e.stopPropagation?.(); handleRefreshImages(); }}
                style={({ pressed }) => [s.imageBannerRetryBtn, pressed && { opacity: 0.8 }]}
                hitSlop={4}
              >
                <MaterialIcons name="refresh" size={10} color={Colors.warning} />
                <Text style={s.imageBannerRetryText}>Retry {imageProgress.failed}</Text>
              </Pressable>
            ) : null}
            <MaterialIcons name="close" size={14} color={Colors.success + 'AA'} />
          </View>
        ) : (
          <MaterialIcons name="chevron-right" size={16} color={Colors.accent} />
        )}
      </Pressable>

      {/* eBay Simple Delivery info banner */}
      <View style={s.simpleDeliveryBanner}>
        <MaterialIcons name="local-shipping" size={12} color={Colors.success} />
        <Text style={s.simpleDeliveryBannerText}>
          All new listings use <Text style={{ fontWeight: Typography.weight.bold }}>eBay Simple Delivery</Text> — eBay calculates the best shipping rate automatically
        </Text>
      </View>

      {/* Search bar */}
      <View style={s.searchWrap}>
        <MaterialIcons name="search" size={15} color={Colors.textTertiary} style={{ marginLeft: Spacing.sm }} />
        <TextInput
          style={s.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="KC ID, catalogue, title, folder, eBay ID..."
          placeholderTextColor={Colors.textTertiary}
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
        {search.length > 0 ? (
          <Pressable onPress={() => setSearch('')} hitSlop={8} style={{ marginRight: Spacing.sm }}>
            <MaterialIcons name="close" size={14} color={Colors.textTertiary} />
          </Pressable>
        ) : null}
      </View>

      {/* Status tabs */}
      <View style={s.tabsOuter}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.tabsContent}>
          {STATUS_TABS.map(tab => {
            const active = activeTab === tab.id;
            const count  = tab.id === 'all' ? listings.length : (tabCounts[tab.id] ?? 0);
            return (
              <Pressable
                key={tab.id}
                onPress={() => setActiveTab(tab.id)}
                style={[s.tab, active && s.tabActive]}
              >
                <Text style={[s.tabLabel, active && { color: tab.color }]}>{tab.label}</Text>
                {count > 0 ? (
                  <View style={[s.tabCount, { backgroundColor: active ? tab.color + '20' : Colors.surfaceHighlight }]}>
                    <Text style={[s.tabCountText, active && { color: tab.color }]}>{count}</Text>
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {loading ? (
        <View style={s.loading}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={s.loadingText}>Loading eBay listings...</Text>
        </View>
      ) : (
        <FlatList
          data={displayed}
          keyExtractor={l => l.id}
          contentContainerStyle={[s.list, { paddingBottom: insets.bottom + 100 }]}
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => <View style={{ height: Spacing.sm }} />}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />
          }
          renderItem={({ item }) => (
            <ListingRow
              item={item}
              editingPriceId={editingPriceId}
              priceEditValue={priceEditValue}
              savingPriceId={savingPriceId}
              endingId={endingId}
              submittingId={submittingId}
              dispatchingId={dispatchingId}
              onEditPrice={handleEditPrice}
              onPriceChange={setPriceEditValue}
              onSavePrice={handleSavePrice}
              onCancelEdit={() => setEditingPriceId(null)}
              onEnd={handleEnd}
              onRelist={handleRelist}
              onSubmit={handleSubmit}
              onViewOnEbay={handleViewOnEbay}
              onNavigateItem={l => router.push(`/stock-listing/${l.itemId}` as any)}
              onDispatch={handleDispatch}
            />
          )}
          ListEmptyComponent={
            <View style={s.empty}>
              <MaterialIcons name="storefront" size={48} color={Colors.textTertiary} />
              <Text style={s.emptyTitle}>
                {search ? 'No listings found' : activeTab === 'all' ? 'No eBay Listings' : `No ${activeTab} listings`}
              </Text>
              <Text style={s.emptyText}>
                {search
                  ? `No listings match "${search}"`
                  : 'Create a new listing or import from eBay to get started.'}
              </Text>
              {!search ? (
                <View style={{ flexDirection: 'row', gap: Spacing.sm }}>
                  <Pressable onPress={() => setShowCreate(true)} style={s.emptyBtn}>
                    <MaterialIcons name="add" size={16} color={Colors.background} />
                    <Text style={s.emptyBtnText}>List Item</Text>
                  </Pressable>
                  <Pressable onPress={() => router.push('/ebay-import' as any)} style={[s.emptyBtn, { backgroundColor: Colors.info }]}>
                    <MaterialIcons name="cloud-download" size={16} color={Colors.background} />
                    <Text style={s.emptyBtnText}>Import eBay</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          }
        />
      )}

      {/* Submit All Drafts Progress Overlay */}
      {submittingAll && submitAllProgress ? (
        <View style={s.progressOverlay}>
          <View style={s.progressCard}>
            <ActivityIndicator size="large" color={Colors.accent} />
            <Text style={s.progressTitle}>Submitting to eBay...</Text>
            <Text style={s.progressCount}>
              {submitAllProgress.current} of {submitAllProgress.total}
            </Text>
            <View style={s.progressBar}>
              <View
                style={[
                  s.progressBarFill,
                  { width: `${Math.round((submitAllProgress.current / submitAllProgress.total) * 100)}%` as any, backgroundColor: Colors.accent },
                ]}
              />
            </View>
            <View style={s.progressStats}>
              <View style={s.progressStat}>
                <MaterialIcons name="check-circle" size={14} color={Colors.success} />
                <Text style={[s.progressStatText, { color: Colors.success }]}>{submitAllProgress.succeeded} listed</Text>
              </View>
              {submitAllProgress.failed > 0 ? (
                <View style={s.progressStat}>
                  <MaterialIcons name="error" size={14} color={Colors.danger} />
                  <Text style={[s.progressStatText, { color: Colors.danger }]}>{submitAllProgress.failed} failed</Text>
                </View>
              ) : null}
            </View>
            <Text style={s.progressNote}>Do not close this screen while submitting...</Text>
          </View>
        </View>
      ) : null}

      {/* Create Listing Modal */}
      <CreateListingModal
        visible={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={() => load()}
        tenantId={tenant?.id ?? ''}
        showAlert={showAlert}
      />

      {/* Dispatch Modal */}
      <DispatchModal
        visible={!!dispatchListing}
        listing={dispatchListing}
        onClose={() => setDispatchListing(null)}
        onDispatched={handleDispatched}
        showAlert={showAlert}
      />

      {/* Auction / BIN Submit Modal */}
      <AuctionSubmitModal
        visible={!!auctionListing}
        listing={auctionListing}
        onClose={() => setAuctionListing(null)}
        onSubmitted={updated => {
          setListings(prev => prev.map(l => l.id === updated.id ? updated : l));
          showAlert('Live on eBay', `Listing is now live at £${updated.price.toFixed(2)}.`);
        }}
        tenantId={tenant?.id ?? ''}
        showAlert={showAlert}
      />
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },

  header: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.xs,
    paddingHorizontal: Spacing.base, paddingBottom: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder,
  },
  backBtn: {
    width: 34, height: 34, borderRadius: Radius.md,
    backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.surfaceBorder,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  ebayBadge: {
    backgroundColor: Colors.accentDim, borderRadius: Radius.sm,
    paddingHorizontal: 7, paddingVertical: 2, borderWidth: 1, borderColor: Colors.accent + '50',
  },
  ebayBadgeText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.extrabold, color: Colors.accent, letterSpacing: 0.5 },
  title: { fontSize: Typography.size.xl, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  subtitle: { fontSize: Typography.size.xs - 1, color: Colors.textTertiary, marginTop: 2 },
  headerBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: Colors.infoDim, borderRadius: Radius.md,
    paddingHorizontal: Spacing.sm, paddingVertical: 6,
    borderWidth: 1, borderColor: Colors.info + '40',
  },
  headerBtnText: { fontSize: Typography.size.xs - 1, fontWeight: Typography.weight.semibold, color: Colors.info },

  // ── Image refresh banner ──────────────────────────────────────────────────
  imageBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    gap: Spacing.sm,
    backgroundColor: Colors.accentDim,
    paddingHorizontal: Spacing.base, paddingVertical: Spacing.sm,
    borderBottomWidth: 1, borderBottomColor: Colors.accent + '30',
  },
  imageBannerDone: {
    backgroundColor: Colors.successDim,
    borderBottomColor: Colors.success + '30',
  },
  imageBannerLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  imageBannerTitle: {
    fontSize: Typography.size.xs, fontWeight: Typography.weight.bold, color: Colors.accent,
  },
  imageBannerSub: {
    fontSize: 10, color: Colors.accent + 'AA', marginTop: 1,
  },
  imageBannerProgressWrap: { alignItems: 'flex-end', gap: 3, minWidth: 68 },
  imageBannerTrack: {
    height: 4, width: 68, backgroundColor: Colors.accent + '30',
    borderRadius: Radius.pill, overflow: 'hidden',
  },
  imageBannerFill: { height: '100%', backgroundColor: Colors.accent, borderRadius: Radius.pill },
  imageBannerPct: { fontSize: 9, color: Colors.accent, fontWeight: Typography.weight.bold },
  imageBannerDoneRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  imageBannerRetryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: Colors.warningDim, borderRadius: Radius.pill,
    paddingHorizontal: 7, paddingVertical: 4,
    borderWidth: 1, borderColor: Colors.warning + '50',
  },
  imageBannerRetryText: { fontSize: 10, fontWeight: Typography.weight.bold, color: Colors.warning },

  simpleDeliveryBanner: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingHorizontal: Spacing.base, paddingVertical: 7,
    backgroundColor: Colors.successDim,
    borderBottomWidth: 1, borderBottomColor: Colors.success + '30',
  },
  simpleDeliveryBannerText: { flex: 1, fontSize: 10, color: Colors.success, lineHeight: 14 },

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

  tabsOuter: { borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder },
  tabsContent: {
    flexDirection: 'row', gap: Spacing.xs,
    paddingHorizontal: Spacing.base, paddingVertical: Spacing.sm,
  },
  tab: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs + 2,
    borderRadius: Radius.pill, backgroundColor: Colors.surface,
    borderWidth: 1, borderColor: Colors.surfaceBorder,
  },
  tabActive: { backgroundColor: Colors.surfaceHighlight },
  tabLabel: { fontSize: Typography.size.xs, color: Colors.textSecondary, fontWeight: Typography.weight.medium },
  tabCount: { paddingHorizontal: 5, paddingVertical: 1, borderRadius: Radius.pill, minWidth: 18, alignItems: 'center' },
  tabCountText: { fontSize: 9, fontWeight: Typography.weight.bold, color: Colors.textTertiary },

  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md },
  loadingText: { fontSize: Typography.size.sm, color: Colors.textTertiary },
  list: { padding: Spacing.base },

  progressOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: Colors.overlay80,
    alignItems: 'center', justifyContent: 'center', zIndex: 200,
  },
  progressCard: {
    backgroundColor: Colors.surfaceElevated, borderRadius: Radius.xxl,
    padding: Spacing.xxl, gap: Spacing.md, alignItems: 'center',
    width: '82%', borderWidth: 1, borderColor: Colors.surfaceBorder,
  },
  progressTitle: { fontSize: Typography.size.lg, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  progressCount: { fontSize: Typography.size.xl, fontWeight: Typography.weight.extrabold, color: Colors.accent },
  progressBar: {
    height: 6, width: '100%', backgroundColor: Colors.surfaceHighlight,
    borderRadius: Radius.pill, overflow: 'hidden',
  },
  progressBarFill: { height: '100%', borderRadius: Radius.pill },
  progressStats: { flexDirection: 'row', gap: Spacing.lg },
  progressStat: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  progressStatText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold },
  progressNote: { fontSize: Typography.size.xs, color: Colors.textTertiary, textAlign: 'center' },

  empty: { alignItems: 'center', gap: Spacing.md, paddingVertical: 60, paddingHorizontal: Spacing.xl },
  emptyTitle: { fontSize: Typography.size.lg, fontWeight: Typography.weight.semibold, color: Colors.textSecondary },
  emptyText: { fontSize: Typography.size.sm, color: Colors.textTertiary, textAlign: 'center', lineHeight: 20 },
  emptyBtn: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.xs,
    backgroundColor: Colors.primary, borderRadius: Radius.pill,
    paddingHorizontal: Spacing.xl, paddingVertical: Spacing.sm,
  },
  emptyBtnText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.background },
});
