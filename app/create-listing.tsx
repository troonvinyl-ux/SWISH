// SWISH Create Listing — Three-Stage Listing Flow
//
// STAGE 1: IMAGES + AI ANALYSIS + EBAY VISUAL SEARCH (parallel)
//   → SWISH identifies the object
//   → eBay searchByImage finds visually similar GB listings
//   → User reviews combined evidence
//   → User confirms/changes eBay category
//
// STAGE 2: CATEGORY-SPECIFIC ITEM SPECIFICS
//   → Category confirmed
//   → AI pre-populates relevant fields
//   → User reviews/edits
//
// STAGE 3: PRICING + DELIVERY + SUBMIT
//   → Description
//   → Pricing (three distinct concepts: Market Value / Suggested / Listing Price)
//   → Simple Delivery — Buyer Pays
//   → Review + Submit
//
// HIERARCHY:
//   1. User-confirmed information (wins)
//   2. Verified SWISH information
//   3. SWISH AI candidate information
//   4. eBay visual-search evidence (evidence only, never authority)
//
// IMPORTANT:
//   - eBay visual search results are similar items, NOT confirmed identification.
//   - eBay asking prices are NEVER treated as realised sale prices.
//   - eBay visual search failure does NOT block listing creation.
//   - No credentials are exposed to the client.

import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  ActivityIndicator, Linking, TextInput, Modal,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Colors, Typography, Spacing, Radius, Shadow } from '@/constants/theme';
import { useApp } from '@/hooks/useApp';
import { useAlert } from '@/template';
import { getItem, Item } from '@/services/itemService';
import { generateListing, saveListing, getItemListings } from '@/services/listingService';
import type { SavedListing } from '@/services/listingService';
import {
  searchEbayByImage,
  EbayVisualSearchResult,
  EbayVisualItem,
  deriveCategorySuggestion,
  formatAskingPriceRange,
  hasUsefulCategoryEvidence,
} from '@/services/ebayVisualSearchService';
import { getSupabaseClient } from '@/template';
import { FunctionsHttpError } from '@supabase/supabase-js';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

type Stage = 'analyse' | 'category' | 'specifics' | 'pricing' | 'review';

interface CategoryConfirmation {
  id: string;
  name: string;
  source: 'swish' | 'ebay_visual' | 'user' | 'combined';
}

// ─────────────────────────────────────────────────────────────────────────────
// INLINE CATEGORY PICKER MODAL
// Embedded directly in CreateListing so it works BEFORE any listing is created.
// Uses the same swish-ebay-list get_category_children route as the editor.
// ─────────────────────────────────────────────────────────────────────────────

type LiveCat = { id: string; name: string; isLeaf: boolean; childCount: number };
type BreadcrumbItem = { id: string; name: string };

// Static fallback categories shown when the live eBay Taxonomy API is unavailable.
const EBAY_CATEGORY_FALLBACK = [
  // Offline EBAY_GB starter options only. Every selected ID is revalidated against live
  // eBay Taxonomy at publish time; these labels never override the live category response.
  { id: '4726', name: 'British Coins' },
  { id: '40714', name: 'Ancient Coins' },
  { id: '4738', name: 'Ancient Coins: Greek' },
  { id: '4159', name: 'Ancient Coins: Byzantine' },
  { id: '3365', name: 'Roman Imperial Coins (96–235 AD)' },
  { id: '4157', name: 'Roman Coins' },
  { id: '4740', name: 'Ancient Coins: Roman Imperial' },
  { id: '4741', name: 'Ancient Coins: Roman Republic' },
  { id: '4742', name: 'Ancient Coins: Celtic' },
  { id: '4743', name: 'Ancient Coins: Judean' },
  { id: '4744', name: 'Ancient Coins: Other' },
  { id: '18594', name: 'Medieval Coins' },
  { id: '18593', name: 'Hammered Coins' },
  { id: '527', name: 'Coin Collections & Lots' },
  { id: '4138', name: 'US Coins' },
  { id: '4735', name: 'World Coins' },
  { id: '4734', name: 'Australian Coins' },
  { id: '29539', name: 'Bullion (Gold / Silver Coins)' },
  { id: '47188', name: 'Tokens, Medals & Badges' },
  { id: '620', name: 'Exonumia' },
  { id: '10968', name: 'Notgeld & Emergency Currency' },
  { id: '14486', name: 'British Banknotes' },
  { id: '14487', name: 'World Banknotes' },
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

function InlineCategoryPicker({
  visible,
  currentId,
  tenantId,
  onSelect,
  onClose,
}: {
  visible: boolean;
  currentId: string;
  tenantId?: string;
  onSelect: (id: string, name: string) => void;
  onClose: () => void;
}) {
  const supabase = getSupabaseClient();
  const [mode, setMode] = useState<'live' | 'static' | 'error'>('live');
  const [liveCategories, setLiveCategories] = useState<LiveCat[]>([]);
  const [liveLoading, setLiveLoading] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbItem[]>([]);
  const [search, setSearch] = useState('');
  const [customId, setCustomId] = useState('');
  const [remoteSuggestionsActive, setRemoteSuggestionsActive] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadCategories = useCallback(async (parentId: string) => {
    if (!tenantId) {
      setMode('static');
      return;
    }
    setLiveLoading(true);
    setLiveError(null);

    // 15-second timeout guard — eliminates infinite spinner
    const timeoutId = setTimeout(() => {
      setLiveLoading(false);
      setLiveError('Request timed out after 15 seconds.');
      setMode('static');
    }, 15000);
    timeoutRef.current = timeoutId;

    try {
      // Try the dedicated taxonomy function first, then fall back on both
      // transport errors and HTTP-200 { success:false } responses.
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

      if (error || !data?.success || data?.source === 'curated' || data?.source === 'curated_verified' || data?.source === 'db_cache') {
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
      clearTimeout(timeoutId);

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
        setMode('static');
        setLiveError(errMsg);
        return;
      }

      // Edge function always returns HTTP 200; success/failure in body
      if (!data?.success) {
        setMode('static');
        setLiveError(data?.error ?? 'eBay category API unavailable.');
        return;
      }

      setLiveCategories(data.children ?? []);
      // Offline starter lists are navigation fallback only; final publish must verify live
      setMode('live');
      // Show a note if eBay returned a curated list instead of full tree
      if (data.source === 'curated' || data.source === 'curated_verified') {
        setLiveError('Showing offline category starters because live eBay Taxonomy is unavailable. Each selected category must be verified live before publishing. Reconnect eBay if the live browser keeps failing.');
      }
    } catch (e: any) {
      clearTimeout(timeoutId);
      setMode('static');
      setLiveError(e?.message ?? 'Network error.');
    } finally {
      clearTimeout(timeoutId);
      setLiveLoading(false);
    }
  }, [tenantId]);

  const searchLiveCategories = useCallback(async (rawQuery: string) => {
    const query = rawQuery.trim().slice(0, 100);
    if (!tenantId || query.length < 2) {
      setLiveError('Enter at least 2 characters to search eBay categories.');
      return;
    }
    setLiveLoading(true);
    setLiveError(null);
    try {
      let data: any = null;
      let error: any = null;
      try {
        const primary = await supabase.functions.invoke('swish-ebay-category', {
          body: { route: 'get_category_suggestions', tenantId, query },
        });
        data = primary.data;
        error = primary.error;
      } catch (e: any) {
        error = e;
      }
      if (error || !data?.success || data?.source === 'curated' || data?.source === 'curated_verified' || data?.source === 'curated_fallback' || data?.source === 'db_cache_offline' || data?.source === 'db_cache') {
        try {
          const fallback = await supabase.functions.invoke('swish-ebay-list', {
            body: { route: 'get_category_suggestions', tenantId, query },
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
      if (error || !data?.success) {
        setRemoteSuggestionsActive(false);
        setLiveError(data?.error ?? error?.message ?? 'eBay category search is unavailable.');
        return;
      }
      const suggestions = Array.isArray(data.suggestions) ? data.suggestions : [];
      const cats: LiveCat[] = suggestions
        .filter((cat: any) => cat?.id && cat?.name && cat.isLeaf === true)
        .map((cat: any) => ({
          id: String(cat.id), name: String(cat.name), isLeaf: true, childCount: 0,
        }));
      if (!cats.length) {
        setRemoteSuggestionsActive(false);
        setLiveError('No verified eBay leaf categories matched that search. Try a broader term.');
        return;
      }
      setBreadcrumbs([]);
      setLiveCategories(cats);
      setRemoteSuggestionsActive(true);
      setMode('live');
      setLiveError(data.source === 'db_cache' || data.source === 'curated' || data.source === 'curated_fallback'
        ? 'Showing cached/curated eBay categories. Confirm the category before publishing.'
        : null);
    } catch (e: any) {
      setRemoteSuggestionsActive(false);
      setLiveError(e?.message ?? 'eBay category search failed.');
    } finally {
      setLiveLoading(false);
    }
  }, [tenantId, supabase]);

  // Reset and load when modal opens
  useEffect(() => {
    if (!visible) return;
    setBreadcrumbs([]);
    setSearch('');
    setCustomId('');
    setRemoteSuggestionsActive(false);
    setLiveError(null);
    loadCategories('');
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [visible]);

  const handleDrillDown = useCallback((cat: LiveCat) => {
    if (cat.isLeaf) {
      onSelect(cat.id, cat.name);
      onClose();
      return;
    }
    setBreadcrumbs(prev => [...prev, { id: cat.id, name: cat.name }]);
    setSearch('');
    loadCategories(cat.id);
  }, [loadCategories, onSelect, onClose]);

  const handleBack = useCallback(() => {
    const newCrumbs = breadcrumbs.slice(0, -1);
    setBreadcrumbs(newCrumbs);
    setSearch('');
    loadCategories(newCrumbs.length > 0 ? newCrumbs[newCrumbs.length - 1].id : '');
  }, [breadcrumbs, loadCategories]);

  const handleBreadcrumbNav = useCallback((index: number) => {
    const newCrumbs = index < 0 ? [] : breadcrumbs.slice(0, index + 1);
    setBreadcrumbs(newCrumbs);
    setSearch('');
    loadCategories(newCrumbs.length > 0 ? newCrumbs[newCrumbs.length - 1].id : '');
  }, [breadcrumbs, loadCategories]);

  const handleRetryLive = useCallback(() => {
    setBreadcrumbs([]);
    setSearch('');
    loadCategories('');
  }, [loadCategories]);

  const liveFiltered = remoteSuggestionsActive
    ? liveCategories
    : search.trim()
      ? liveCategories.filter(c =>
          c.name.toLowerCase().includes(search.toLowerCase()) || c.id.includes(search.trim())
        )
      : liveCategories;

  const staticFiltered = search.trim()
    ? EBAY_CATEGORY_FALLBACK.filter(c =>
        c.name.toLowerCase().includes(search.toLowerCase()) || c.id.includes(search.trim())
      )
    : EBAY_CATEGORY_FALLBACK;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: Colors.background }}>

        {/* Header */}
        <View style={icp.header}>
          <Pressable onPress={onClose} style={icp.closeBtn} hitSlop={8}>
            <MaterialIcons name="close" size={18} color={Colors.textSecondary} />
          </Pressable>
          <Text style={icp.title}>Select eBay Category</Text>
          {mode === 'live' && !liveLoading ? (
            <View style={icp.liveBadge}>
              <View style={icp.liveDot} />
              <Text style={icp.liveBadgeText}>Live API</Text>
            </View>
          ) : mode !== 'live' ? (
            <Pressable onPress={handleRetryLive} style={icp.retryBtn} hitSlop={6}>
              <MaterialIcons name="refresh" size={12} color={Colors.info} />
              <Text style={icp.retryBtnText}>Retry Live</Text>
            </Pressable>
          ) : null}
        </View>

        {/* Breadcrumbs */}
        {breadcrumbs.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ maxHeight: 40 }}
            contentContainerStyle={icp.breadcrumbContent}
          >
            <Pressable onPress={() => handleBreadcrumbNav(-1)} style={icp.breadcrumbItem}>
              <MaterialIcons name="home" size={11} color={Colors.primary} />
            </Pressable>
            {breadcrumbs.map((crumb, idx) => (
              <React.Fragment key={crumb.id}>
                <MaterialIcons name="chevron-right" size={12} color={Colors.textTertiary} />
                <Pressable
                  onPress={() => handleBreadcrumbNav(idx)}
                  style={[icp.breadcrumbItem, idx === breadcrumbs.length - 1 && icp.breadcrumbItemActive]}
                >
                  <Text
                    style={[icp.breadcrumbText, idx === breadcrumbs.length - 1 && { color: Colors.primary }]}
                    numberOfLines={1}
                  >{crumb.name}</Text>
                </Pressable>
              </React.Fragment>
            ))}
          </ScrollView>
        ) : null}

        {/* Search bar */}
        <View style={icp.searchWrap}>
          <MaterialIcons name="search" size={16} color={Colors.textTertiary} />
          <TextInput
            style={icp.searchInput}
            value={search}
            onChangeText={value => {
              setSearch(value);
              setRemoteSuggestionsActive(false);
            }}
            onSubmitEditing={() => searchLiveCategories(search)}
            returnKeyType="search"
            placeholder="Search e.g. Mughal Rupee, Medal, Militaria..."
            placeholderTextColor={Colors.textTertiary}
            autoCorrect={false}
          />
          {search.length > 0 ? (
            <Pressable onPress={() => setSearch('')} hitSlop={8}>
              <MaterialIcons name="cancel" size={16} color={Colors.textTertiary} />
            </Pressable>
          ) : null}
        </View>

        {/* Back row */}
        {breadcrumbs.length > 0 ? (
          <Pressable onPress={handleBack} style={icp.backRow}>
            <MaterialIcons name="arrow-back" size={15} color={Colors.primary} />
            <Text style={icp.backRowText}>
              Back to {breadcrumbs.length > 1 ? breadcrumbs[breadcrumbs.length - 2].name : 'Root categories'}
            </Text>
          </Pressable>
        ) : null}

        {/* Info/error banner */}
        {liveError ? (
          <View style={[icp.errorBanner, mode === 'live' && { backgroundColor: Colors.infoDim ?? (Colors.info + '15'), borderColor: Colors.info + '40' }]}>
            <MaterialIcons name={mode === 'live' ? 'info-outline' : 'wifi-off'} size={13} color={mode === 'live' ? Colors.info : Colors.warning} />
            <Text style={[icp.errorBannerText, mode === 'live' && { color: Colors.info }]} numberOfLines={3}>
              {liveError}
            </Text>
            {mode !== 'live' ? (
              <Pressable onPress={handleRetryLive} hitSlop={8}>
                <Text style={icp.retryLink}>Retry</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        <ScrollView
          contentContainerStyle={icp.listContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Loading state */}
          {liveLoading ? (
            <View style={icp.loadingRow}>
              <ActivityIndicator size="small" color={Colors.primary} />
              <Text style={icp.loadingText}>Loading eBay categories...</Text>
            </View>
          ) : null}

          {/* Live categories */}
          {mode === 'live' && !liveLoading ? (
            liveFiltered.length === 0 ? (
              <View style={icp.emptyState}>
                <MaterialIcons name="search-off" size={24} color={Colors.textTertiary} />
                <Text style={icp.emptyText}>
                  {search ? `No categories match "${search}"` : 'No sub-categories found'}
                </Text>
              </View>
            ) : (
              liveFiltered.map(cat => (
                <Pressable
                  key={cat.id}
                  onPress={() => handleDrillDown(cat)}
                  style={({ pressed }) => [icp.row, pressed && { opacity: 0.75 }, currentId === cat.id && icp.rowActive]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[icp.catName, currentId === cat.id && { color: Colors.primary }]}>{cat.name}</Text>
                    <Text style={icp.catId}>
                      ID: {cat.id} · {cat.isLeaf ? '✓ Leaf — tap to select' : `${cat.childCount} sub-categories`}
                    </Text>
                  </View>
                  {currentId === cat.id ? (
                    <MaterialIcons name="check-circle" size={18} color={Colors.primary} />
                  ) : cat.isLeaf ? (
                    <MaterialIcons name="sell" size={15} color={Colors.success} />
                  ) : (
                    <MaterialIcons name="chevron-right" size={18} color={Colors.textTertiary} />
                  )}
                </Pressable>
              ))
            )
          ) : null}

          {/* Static fallback */}
          {mode === 'static' && !liveLoading ? (
            <>
              <View style={icp.staticNote}>
                <MaterialIcons name="info-outline" size={12} color={Colors.info} />
                <Text style={icp.staticNoteText}>
                  Showing offline category list. Tap "Retry Live" to browse the full eBay category tree when connected.
                </Text>
              </View>
              {staticFiltered.length === 0 ? (
                <View style={icp.emptyState}>
                  <MaterialIcons name="search-off" size={24} color={Colors.textTertiary} />
                  <Text style={icp.emptyText}>No categories match "{search}"</Text>
                </View>
              ) : (
                staticFiltered.map(cat => (
                  <Pressable
                    key={cat.id}
                    onPress={() => { onSelect(cat.id, cat.name); onClose(); }}
                    style={({ pressed }) => [icp.row, pressed && { opacity: 0.75 }, currentId === cat.id && icp.rowActive]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[icp.catName, currentId === cat.id && { color: Colors.primary }]}>{cat.name}</Text>
                      <Text style={icp.catId}>Category ID: {cat.id}</Text>
                    </View>
                    {currentId === cat.id ? (
                      <MaterialIcons name="check-circle" size={18} color={Colors.primary} />
                    ) : null}
                  </Pressable>
                ))
              )}
            </>
          ) : null}

          {/* Custom ID entry */}
          <View style={icp.customSection}>
            <Text style={icp.customLabel}>CUSTOM CATEGORY ID</Text>
            <View style={icp.customRow}>
              <TextInput
                style={icp.customInput}
                value={customId}
                onChangeText={setCustomId}
                keyboardType="number-pad"
                placeholder="e.g. 40714"
                placeholderTextColor={Colors.textTertiary}
              />
              <Pressable
                onPress={() => {
                  const trimmed = customId.trim();
                  if (trimmed) { onSelect(trimmed, `Custom ID: ${trimmed}`); onClose(); }
                }}
                style={icp.customBtn}
                disabled={!customId.trim()}
              >
                <Text style={icp.customBtnText}>Use</Text>
              </Pressable>
            </View>
            <Text style={icp.customHint}>For advanced use — enter a known eBay leaf category ID</Text>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const icp = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.base, paddingTop: Spacing.lg, paddingBottom: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder },
  closeBtn: { width: 32, height: 32, borderRadius: Radius.md, backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.surfaceBorder },
  title: { flex: 1, fontSize: Typography.size.md, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  liveBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.successDim, borderRadius: Radius.pill, paddingHorizontal: 8, paddingVertical: 3 },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.success },
  liveBadgeText: { fontSize: 9, fontWeight: Typography.weight.bold, color: Colors.success },
  retryBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.infoDim ?? (Colors.info + '15'), borderRadius: Radius.pill, paddingHorizontal: 8, paddingVertical: 3 },
  retryBtnText: { fontSize: 9, color: Colors.info, fontWeight: Typography.weight.semibold },
  breadcrumbContent: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: Spacing.base, paddingVertical: Spacing.xs },
  breadcrumbItem: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.pill, paddingHorizontal: 8, paddingVertical: 3 },
  breadcrumbItemActive: { backgroundColor: Colors.primaryDim },
  breadcrumbText: { fontSize: 10, color: Colors.primary, fontWeight: Typography.weight.medium, maxWidth: 100 },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, paddingHorizontal: Spacing.base, paddingVertical: Spacing.xs },
  backRowText: { fontSize: Typography.size.xs, color: Colors.primary, fontWeight: Typography.weight.semibold },
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginHorizontal: Spacing.base, marginTop: Spacing.sm, marginBottom: Spacing.xs, backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.surfaceBorder, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  searchInput: { flex: 1, fontSize: Typography.size.sm, color: Colors.textPrimary, includeFontPadding: false, paddingVertical: 0 },
  errorBanner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, marginHorizontal: Spacing.base, marginTop: Spacing.xs, backgroundColor: Colors.warningDim ?? (Colors.warning + '15'), borderRadius: Radius.md, padding: Spacing.sm, borderWidth: 1, borderColor: Colors.warning + '40' },
  errorBannerText: { flex: 1, fontSize: 10, color: Colors.warning, lineHeight: 14 },
  retryLink: { fontSize: 10, color: Colors.primary, fontWeight: Typography.weight.bold },
  listContent: { paddingHorizontal: Spacing.base, paddingVertical: Spacing.md, gap: Spacing.xs, paddingBottom: 48 },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, justifyContent: 'center', paddingVertical: Spacing.xxl ?? 32 },
  loadingText: { fontSize: Typography.size.sm, color: Colors.textTertiary },
  staticNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 5, backgroundColor: Colors.infoDim ?? (Colors.info + '15'), borderRadius: Radius.sm, padding: Spacing.sm, marginBottom: Spacing.xs },
  staticNoteText: { flex: 1, fontSize: 10, color: Colors.info, lineHeight: 14 },
  emptyState: { alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.xl ?? 24 },
  emptyText: { fontSize: Typography.size.sm, color: Colors.textTertiary, textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md, borderRadius: Radius.xl, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.surfaceBorder, marginBottom: Spacing.xs },
  rowActive: { borderColor: Colors.primary, backgroundColor: Colors.primaryDim },
  catName: { fontSize: Typography.size.sm, color: Colors.textPrimary, fontWeight: Typography.weight.medium },
  catId: { fontSize: 10, color: Colors.textTertiary, marginTop: 2 },
  customSection: { marginTop: Spacing.md, gap: 6 },
  customLabel: { fontSize: 9, fontWeight: Typography.weight.bold, color: Colors.textTertiary, letterSpacing: 0.5 },
  customRow: { flexDirection: 'row', gap: Spacing.sm },
  customInput: { flex: 1, backgroundColor: Colors.surface, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.surfaceBorder, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, fontSize: Typography.size.sm, color: Colors.textPrimary, includeFontPadding: false },
  customBtn: { backgroundColor: Colors.primary, borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, alignItems: 'center', justifyContent: 'center' },
  customBtnText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.background },
  customHint: { fontSize: 10, color: Colors.textTertiary, lineHeight: 14 },
});

// ─────────────────────────────────────────────────────────────────────────────
// EBAY SIMILAR ITEMS PANEL
// ─────────────────────────────────────────────────────────────────────────────

function EbaySimilarItemsPanel({
  result,
  expanded,
  onToggle,
}: {
  result: EbayVisualSearchResult;
  expanded: boolean;
  onToggle: () => void;
}) {
  if (!result.available && !result.error) return null;

  const priceRange = formatAskingPriceRange(result.items);
  const displayItems = expanded ? result.items : result.items.slice(0, 3);

  return (
    <View style={ev.panel}>
      <Pressable onPress={onToggle} style={ev.header}>
        <View style={ev.headerLeft}>
          <View style={[ev.iconWrap, { backgroundColor: result.available ? Colors.info + '20' : Colors.surfaceHighlight }]}>
            <MaterialIcons
              name={result.available ? 'storefront' : 'search-off'}
              size={14}
              color={result.available ? Colors.info : Colors.textTertiary}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[ev.title, { color: result.available ? Colors.info : Colors.textTertiary }]}>
              eBay Visual Matches
            </Text>
            {result.available ? (
              <Text style={ev.subtitle}>
                {result.totalResults} similar listing{result.totalResults !== 1 ? 's' : ''} found on eBay GB
                {result.topCategory ? ` · ${result.topCategory.name}` : ''}
              </Text>
            ) : (
              <Text style={ev.subtitle}>{result.error ?? 'eBay visual search unavailable'}</Text>
            )}
          </View>
        </View>
        {result.available && result.items.length > 0 ? (
          <MaterialIcons name={expanded ? 'expand-less' : 'expand-more'} size={18} color={Colors.textTertiary} />
        ) : null}
      </Pressable>

      {/* Important disclaimer */}
      {result.available && result.items.length > 0 ? (
        <View style={ev.disclaimer}>
          <MaterialIcons name="info-outline" size={11} color={Colors.textTertiary} />
          <Text style={ev.disclaimerText}>
            These are visually similar eBay listings — not confirmed matches. Use as category/context evidence only.
          </Text>
        </View>
      ) : null}

      {/* Price range note */}
      {result.available && priceRange ? (
        <View style={ev.priceNote}>
          <MaterialIcons name="price-tag" size={11} color={Colors.warning} />
          <Text style={ev.priceNoteText}>
            {priceRange} — current asking prices only, not realised sales
          </Text>
        </View>
      ) : null}

      {/* Category signal */}
      {result.available && result.topCategory && result.topCategory.count >= 2 ? (
        <View style={ev.catSignal}>
          <MaterialIcons name="category" size={11} color={Colors.success} />
          <Text style={ev.catSignalText}>
            Most common category: <Text style={{ fontWeight: Typography.weight.bold, color: Colors.success }}>{result.topCategory.name}</Text> ({result.topCategory.count} of {result.items.length} results)
          </Text>
        </View>
      ) : null}

      {/* Item list */}
      {result.available && displayItems.length > 0 ? (
        <View style={ev.itemsList}>
          {displayItems.map((item, i) => (
            <Pressable
              key={item.itemId || i}
              onPress={() => item.itemWebUrl ? Linking.openURL(item.itemWebUrl) : null}
              style={({ pressed }) => [ev.item, pressed && { opacity: 0.8 }]}
              disabled={!item.itemWebUrl}
            >
              {item.image ? (
                <Image source={{ uri: item.image }} style={ev.itemImage} contentFit="cover" transition={100} />
              ) : (
                <View style={[ev.itemImage, ev.itemImagePlaceholder]}>
                  <MaterialIcons name="image-not-supported" size={16} color={Colors.textTertiary} />
                </View>
              )}
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={ev.itemTitle} numberOfLines={2}>{item.title}</Text>
                <View style={ev.itemMeta}>
                  {item.price.value > 0 ? (
                    <Text style={ev.itemPrice}>£{item.price.value.toFixed(2)}</Text>
                  ) : null}
                  {item.condition ? <Text style={ev.itemCond}>{item.condition}</Text> : null}
                  {item.primaryCategoryName ? (
                    <View style={ev.catChip}>
                      <Text style={ev.catChipText} numberOfLines={1}>{item.primaryCategoryName}</Text>
                    </View>
                  ) : null}
                </View>
              </View>
              {item.itemWebUrl ? (
                <MaterialIcons name="open-in-new" size={12} color={Colors.textTertiary} style={{ flexShrink: 0 }} />
              ) : null}
            </Pressable>
          ))}
        </View>
      ) : null}

      {/* Show more / less */}
      {result.available && result.items.length > 3 ? (
        <Pressable onPress={onToggle} style={ev.showMoreBtn}>
          <Text style={ev.showMoreTxt}>
            {expanded ? 'Show fewer' : `Show all ${result.items.length} similar listings`}
          </Text>
          <MaterialIcons name={expanded ? 'expand-less' : 'expand-more'} size={14} color={Colors.info} />
        </Pressable>
      ) : null}
    </View>
  );
}

const ev = StyleSheet.create({
  panel: { backgroundColor: Colors.surface, borderRadius: Radius.xl, borderWidth: 1, borderColor: Colors.info + '30', overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: Spacing.md, gap: Spacing.sm },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flex: 1 },
  iconWrap: { width: 28, height: 28, borderRadius: Radius.sm, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 10, fontWeight: Typography.weight.bold, textTransform: 'uppercase', letterSpacing: 0.6 },
  subtitle: { fontSize: Typography.size.xs, color: Colors.textTertiary, marginTop: 1 },
  disclaimer: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.xs, marginHorizontal: Spacing.md, marginBottom: Spacing.xs, backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.sm, padding: Spacing.xs },
  disclaimerText: { flex: 1, fontSize: 9, color: Colors.textTertiary, lineHeight: 13 },
  priceNote: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.xs, marginHorizontal: Spacing.md, marginBottom: Spacing.xs },
  priceNoteText: { flex: 1, fontSize: 10, color: Colors.warning, lineHeight: 14 },
  catSignal: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.xs, marginHorizontal: Spacing.md, marginBottom: Spacing.sm, backgroundColor: Colors.successDim, borderRadius: Radius.sm, padding: Spacing.xs },
  catSignalText: { flex: 1, fontSize: 10, color: Colors.textSecondary, lineHeight: 14 },
  itemsList: { gap: 1, borderTopWidth: 1, borderTopColor: Colors.surfaceBorder },
  item: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, padding: Spacing.sm, borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder + '60' },
  itemImage: { width: 52, height: 52, borderRadius: Radius.sm, flexShrink: 0 },
  itemImagePlaceholder: { backgroundColor: Colors.surfaceHighlight, alignItems: 'center', justifyContent: 'center' },
  itemTitle: { fontSize: Typography.size.xs, color: Colors.textSecondary, lineHeight: 16 },
  itemMeta: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, flexWrap: 'wrap' },
  itemPrice: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  itemCond: { fontSize: 9, color: Colors.textTertiary },
  catChip: { backgroundColor: Colors.info + '15', borderRadius: Radius.pill, paddingHorizontal: 5, paddingVertical: 2, borderWidth: 1, borderColor: Colors.info + '30' },
  catChipText: { fontSize: 8, color: Colors.info, fontWeight: Typography.weight.semibold, maxWidth: 120 },
  showMoreBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, padding: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.surfaceBorder },
  showMoreTxt: { fontSize: Typography.size.xs, color: Colors.info, fontWeight: Typography.weight.semibold },
});

// ─────────────────────────────────────────────────────────────────────────────
// COMBINED ANALYSIS SUMMARY
// ─────────────────────────────────────────────────────────────────────────────

function CombinedAnalysisSummary({
  item,
  ebayResult,
  confirmedCategory,
  onCategoryChange,
}: {
  item: Item;
  ebayResult: EbayVisualSearchResult | null;
  confirmedCategory: CategoryConfirmation | null;
  onCategoryChange: () => void;
}) {
  const idConf = item.identificationConfidence ?? 0;
  const confColor = idConf >= 0.75 ? Colors.success : idConf >= 0.50 ? Colors.warning : Colors.danger;
  const ebayTopCat = ebayResult ? deriveCategorySuggestion(ebayResult) : null;
  const ebayCount = ebayResult?.items.length ?? 0;

  // Detect discrepancy between SWISH category and eBay category
  const swishCatName = item.attributes?.['ebay_category_name'] as string | undefined;
  const ebayTopCatName = ebayTopCat?.name;
  const hasDiscrepancy = swishCatName && ebayTopCatName &&
    !swishCatName.toLowerCase().includes(ebayTopCatName.toLowerCase()) &&
    !ebayTopCatName.toLowerCase().includes(swishCatName.toLowerCase());

  return (
    <View style={cas.container}>
      <Text style={cas.sectionLabel}>COMBINED SWISH ANALYSIS</Text>

      {/* SWISH row */}
      <View style={cas.row}>
        <View style={[cas.sourceIcon, { backgroundColor: Colors.accent + '20' }]}>
          <MaterialIcons name="auto-awesome" size={12} color={Colors.accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={cas.sourceLabel}>SWISH Identification</Text>
          <Text style={cas.sourceValue} numberOfLines={2}>{item.canonicalTitle}</Text>
          <View style={[cas.confPill, { backgroundColor: confColor + '15', borderColor: confColor + '40' }]}>
            <Text style={[cas.confTxt, { color: confColor }]}>{Math.round(idConf * 100)}% confidence</Text>
          </View>
        </View>
      </View>

      {/* eBay row */}
      {ebayResult ? (
        <View style={cas.row}>
          <View style={[cas.sourceIcon, { backgroundColor: ebayResult.available ? Colors.info + '20' : Colors.surfaceHighlight }]}>
            <MaterialIcons name="storefront" size={12} color={ebayResult.available ? Colors.info : Colors.textTertiary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={cas.sourceLabel}>eBay Visual Search</Text>
            {ebayResult.available ? (
              <>
                <Text style={cas.sourceValue}>{ebayCount} similar listing{ebayCount !== 1 ? 's' : ''} found</Text>
                {ebayTopCat ? <Text style={[cas.sourceSubval, { color: Colors.info }]}>Top category: {ebayTopCat.name}</Text> : null}
              </>
            ) : (
              <Text style={[cas.sourceValue, { color: Colors.textTertiary }]}>Unavailable</Text>
            )}
          </View>
        </View>
      ) : null}

      {/* Category discrepancy warning */}
      {hasDiscrepancy ? (
        <View style={cas.discrepancyBanner}>
          <MaterialIcons name="compare-arrows" size={13} color={Colors.warning} />
          <View style={{ flex: 1 }}>
            <Text style={cas.discrepancyTitle}>Category discrepancy</Text>
            <Text style={cas.discrepancyText}>
              SWISH suggests: <Text style={{ fontWeight: Typography.weight.bold }}>{swishCatName}</Text>
              {'\n'}eBay visual results: <Text style={{ fontWeight: Typography.weight.bold }}>{ebayTopCatName}</Text>
            </Text>
          </View>
        </View>
      ) : null}

      {/* Category selection */}
      <View style={cas.catSection}>
        <Text style={cas.catLabel}>SUGGESTED EBAY CATEGORY</Text>
        {confirmedCategory ? (
          <View style={cas.catConfirmed}>
            <View style={{ flex: 1 }}>
              <Text style={cas.catName}>{confirmedCategory.name}</Text>
              <Text style={cas.catSource}>
                {confirmedCategory.source === 'user' ? 'User selected'
                  : confirmedCategory.source === 'combined' ? 'SWISH + eBay evidence'
                  : confirmedCategory.source === 'ebay_visual' ? 'eBay visual matches'
                  : 'SWISH suggestion'}
              </Text>
            </View>
            <Pressable onPress={onCategoryChange} style={cas.changeCatBtn} hitSlop={6}>
              <MaterialIcons name="edit" size={12} color={Colors.primary} />
              <Text style={cas.changeCatBtnTxt}>Change</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable onPress={onCategoryChange} style={cas.selectCatBtn}>
            <MaterialIcons name="category" size={14} color={Colors.warning} />
            <Text style={cas.selectCatBtnTxt}>Select eBay category before continuing</Text>
            <MaterialIcons name="chevron-right" size={16} color={Colors.warning} />
          </Pressable>
        )}
      </View>
    </View>
  );
}

const cas = StyleSheet.create({
  container: { backgroundColor: Colors.surface, borderRadius: Radius.xl, padding: Spacing.md, gap: Spacing.md, borderWidth: 1, borderColor: Colors.surfaceBorder },
  sectionLabel: { fontSize: 9, fontWeight: Typography.weight.bold, color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  sourceIcon: { width: 26, height: 26, borderRadius: Radius.sm, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  sourceLabel: { fontSize: 9, fontWeight: Typography.weight.bold, color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 2 },
  sourceValue: { fontSize: Typography.size.sm, color: Colors.textPrimary, lineHeight: 18 },
  sourceSubval: { fontSize: Typography.size.xs, marginTop: 2 },
  confPill: { flexDirection: 'row', alignItems: 'center', borderRadius: Radius.pill, paddingHorizontal: 7, paddingVertical: 3, borderWidth: 1, alignSelf: 'flex-start', marginTop: 4 },
  confTxt: { fontSize: 9, fontWeight: Typography.weight.bold, letterSpacing: 0.3 },
  discrepancyBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, backgroundColor: Colors.warningDim, borderRadius: Radius.md, padding: Spacing.sm, borderWidth: 1, borderColor: Colors.warning + '40' },
  discrepancyTitle: { fontSize: Typography.size.xs, fontWeight: Typography.weight.bold, color: Colors.warning, marginBottom: 2 },
  discrepancyText: { fontSize: Typography.size.xs, color: Colors.warning + 'BB', lineHeight: 15 },
  catSection: { gap: Spacing.sm },
  catLabel: { fontSize: 9, fontWeight: Typography.weight.bold, color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5 },
  catConfirmed: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.primaryDim, borderRadius: Radius.md, padding: Spacing.md, borderWidth: 1, borderColor: Colors.primary + '40' },
  catName: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  catSource: { fontSize: 10, color: Colors.textTertiary, marginTop: 2 },
  changeCatBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.surface, borderRadius: Radius.sm, paddingHorizontal: Spacing.sm, paddingVertical: 5, borderWidth: 1, borderColor: Colors.surfaceBorder },
  changeCatBtnTxt: { fontSize: 10, color: Colors.primary, fontWeight: Typography.weight.semibold },
  selectCatBtn: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.warningDim, borderRadius: Radius.md, padding: Spacing.md, borderWidth: 1, borderColor: Colors.warning + '40' },
  selectCatBtnTxt: { flex: 1, fontSize: Typography.size.xs, color: Colors.warning, fontWeight: Typography.weight.semibold },
});

// ─────────────────────────────────────────────────────────────────────────────
// MAIN SCREEN
// ─────────────────────────────────────────────────────────────────────────────

export default function CreateListingScreen() {
  const { id: itemId } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { tenant } = useApp();
  const { showAlert } = useAlert();

  const [item, setItem] = useState<Item | null>(null);
  const [loading, setLoading] = useState(true);
  const [stage, setStage] = useState<Stage>('analyse');

  // Analysis state
  const [swishAnalysisDone, setSwishAnalysisDone] = useState(false);
  const [ebaySearchRunning, setEbaySearchRunning] = useState(false);
  const [ebaySearchDone, setEbaySearchDone] = useState(false);
  const [ebayResult, setEbayResult] = useState<EbayVisualSearchResult | null>(null);
  const [ebayExpanded, setEbayExpanded] = useState(false);

  // Category state
  const [confirmedCategory, setConfirmedCategory] = useState<CategoryConfirmation | null>(null);
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);

  // Listing generation
  const [generatingListing, setGeneratingListing] = useState(false);
  const [generatedListing, setGeneratedListing] = useState<SavedListing | null>(null);
  const [existingListings, setExistingListings] = useState<SavedListing[]>([]);

  // Used to avoid duplicate eBay searches for same image
  const ebaySearchedHashRef = useRef<string | null>(null);

  // ── Load item ───────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    if (!itemId) { setLoading(false); return; }
    const [itemRes, listingsRes] = await Promise.all([
      getItem(itemId),
      getItemListings(itemId),
    ]);
    const loadedItem = itemRes.item;
    setItem(loadedItem);
    setExistingListings(listingsRes.listings);
    setLoading(false);

    if (!loadedItem) return;

    // Pre-populate category from existing item attributes
    const savedCatId = loadedItem.attributes?.['ebay_category_id'] as string | undefined;
    const savedCatName = loadedItem.attributes?.['ebay_category_name'] as string | undefined;
    if (savedCatId && savedCatName) {
      setConfirmedCategory({ id: savedCatId, name: savedCatName, source: 'swish' });
    }

    // Mark SWISH analysis as done (item already identified)
    setSwishAnalysisDone(true);

    // Kick off eBay visual search in parallel
    runEbayVisualSearch(loadedItem);
  }, [itemId, tenant]);

  useEffect(() => { load(); }, [load]);

  // ── eBay Visual Search ───────────────────────────────────────────────────────

  const runEbayVisualSearch = useCallback(async (loadedItem: Item, categoryId?: string) => {
    if (!tenant) return;
    if (ebaySearchRunning) return;

    // Get primary image
    const media = loadedItem.media ?? [];
    const primaryImage = media.find(u => u.startsWith('https://')) ?? null;
    if (!primaryImage) {
      setEbayResult({ available: false, items: [], totalResults: 0, topCategory: null, categoryDistribution: [], marketplace: 'EBAY_GB', retrievedAt: new Date().toISOString(), error: 'No stored image available for visual search' });
      setEbaySearchDone(true);
      return;
    }

    // Avoid re-searching same image unless category filter changes
    const hashKey = `${primaryImage}::${categoryId ?? 'none'}`;
    if (ebaySearchedHashRef.current === hashKey) return;
    ebaySearchedHashRef.current = hashKey;

    setEbaySearchRunning(true);
    setEbaySearchDone(false);

    const result = await searchEbayByImage({
      tenantId: tenant.id,
      imageUri: primaryImage,
      categoryId,
      limit: 8,
    });

    setEbayResult(result);
    setEbaySearchRunning(false);
    setEbaySearchDone(true);

    // Auto-suggest category from eBay results if none confirmed yet
    if (result.available && !confirmedCategory) {
      const ebayTopCat = deriveCategorySuggestion(result);
      const savedCatId = loadedItem.attributes?.['ebay_category_id'] as string | undefined;
      const savedCatName = loadedItem.attributes?.['ebay_category_name'] as string | undefined;

      if (savedCatId && savedCatName) {
        // Determine source based on whether eBay agrees
        const source = ebayTopCat?.name &&
          (savedCatName.toLowerCase().includes(ebayTopCat.name.toLowerCase()) ||
           ebayTopCat.name.toLowerCase().includes(savedCatName.toLowerCase()))
          ? 'combined' : 'swish';
        setConfirmedCategory({ id: savedCatId, name: savedCatName, source });
      } else if (ebayTopCat) {
        setConfirmedCategory({ id: ebayTopCat.id, name: ebayTopCat.name, source: 'ebay_visual' });
      }
    } else if (result.available && confirmedCategory) {
      // Update source to 'combined' if eBay agrees with confirmed category
      const ebayTopCat = deriveCategorySuggestion(result);
      if (ebayTopCat &&
          (confirmedCategory.name.toLowerCase().includes(ebayTopCat.name.toLowerCase()) ||
           ebayTopCat.name.toLowerCase().includes(confirmedCategory.name.toLowerCase()))) {
        setConfirmedCategory(prev => prev ? { ...prev, source: 'combined' } : prev);
      }
    }
  }, [tenant, ebaySearchRunning, confirmedCategory]);

  // ── Category change — opens inline picker, NO navigation to listing editor ─

  const handleCategoryChange = useCallback(() => {
    setShowCategoryPicker(true);
  }, []);

  // ── Category selected from inline picker ─────────────────────────────────

  const handleCategorySelected = useCallback(async (catId: string, catName: string) => {
    setConfirmedCategory({ id: catId, name: catName, source: 'user' });
    // Persist to item attributes so the listing editor + edge function can read it
    if (item && tenant) {
      const supabase = getSupabaseClient();
      const existing = item.attributes ?? {};
      await supabase.from('items').update({
        attributes: { ...existing, ebay_category_id: catId, ebay_category_name: catName },
        updated_at: new Date().toISOString(),
      }).eq('id', item.id).eq('tenant_id', tenant.id);
      // Also update the local item state so UI reflects immediately
      setItem(prev => prev ? {
        ...prev,
        attributes: { ...(prev.attributes ?? {}), ebay_category_id: catId, ebay_category_name: catName },
      } : prev);
    }
    // Re-search eBay with category filter for better evidence (non-blocking)
    if (item && ebaySearchDone) {
      ebaySearchedHashRef.current = null;
      runEbayVisualSearch(item, catId);
    }
  }, [item, tenant, ebaySearchDone, runEbayVisualSearch]);

  // ── Legacy handleConfirmCategory kept for backwards compat ───────────────
  const handleConfirmCategory = useCallback(async (catId?: string, catName?: string) => {
    if (catId && catName) await handleCategorySelected(catId, catName);
    setStage('specifics');
  }, [handleCategorySelected]);

  // ── Generate listing ───────────────────────────────────────────────────────

  const handleGenerateListing = useCallback(async () => {
    if (!item || !tenant) return;
    setGeneratingListing(true);

    const { listing, error } = await generateListing(item.id, tenant.id, 'ebay');
    if (error || !listing) {
      showAlert('Generation Failed', error ?? 'Could not generate listing.');
      setGeneratingListing(false);
      return;
    }

    const { listing: saved, error: saveErr } = await saveListing(tenant.id, item.id, listing, 'ebay', confirmedCategory?.id);
    setGeneratingListing(false);
    if (saveErr || !saved) {
      showAlert('Save Failed', saveErr ?? 'Could not save listing.');
      return;
    }

    setGeneratedListing(saved);
    // Navigate to the listing editor for full review
    router.push(`/ebay-listing-editor?id=${saved.id}` as any);
  }, [item, tenant, showAlert, router, confirmedCategory]);

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={s.container}>
        <ActivityIndicator size="large" color={Colors.primary} style={{ marginTop: 120 }} />
      </View>
    );
  }

  if (!item) {
    return (
      <View style={[s.container, s.center]}>
        <MaterialIcons name="error-outline" size={40} color={Colors.textTertiary} />
        <Text style={s.emptyText}>Item not found</Text>
        <Pressable onPress={() => router.back()} style={s.backLink}>
          <Text style={s.backLinkTxt}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  const primaryImage = (item.media ?? []).find(u => u.startsWith('https://')) ?? (item.media ?? [])[0] ?? null;
  const allAnalysisDone = swishAnalysisDone && (ebaySearchDone || (!ebaySearchRunning && !primaryImage));
  const hasExistingListing = existingListings.length > 0;

  return (
    <View style={s.container}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={[s.header, { paddingTop: insets.top + Spacing.sm }]}>
        <Pressable onPress={() => router.back()} style={s.headerBtn} hitSlop={8}>
          <MaterialIcons name="arrow-back" size={20} color={Colors.textSecondary} />
        </Pressable>
        <View style={s.flex}>
          <Text style={s.headerTitle}>Create Listing</Text>
          <Text style={s.headerSub} numberOfLines={1}>{item.canonicalTitle}</Text>
        </View>
        {hasExistingListing ? (
          <Pressable onPress={() => router.push(`/ebay-listing-editor?id=${existingListings[0].id}` as any)} style={s.headerAction} hitSlop={4}>
            <MaterialIcons name="edit" size={14} color={Colors.primary} />
            <Text style={s.headerActionTxt}>Edit</Text>
          </Pressable>
        ) : null}
      </View>

      {/* Stage progress strip */}
      <View style={s.stageStrip}>
        {(['analyse', 'specifics', 'review'] as Stage[]).map((st, i) => {
          const stageOrder: Stage[] = ['analyse', 'specifics', 'review'];
          const idx = stageOrder.indexOf(stage);
          const thisIdx = i;
          const done = thisIdx < idx;
          const active = thisIdx === idx;
          return (
            <View key={st} style={s.stagePillWrap}>
              <View style={[s.stagePill, active && s.stagePillActive, done && s.stagePillDone]}>
                <Text style={[s.stagePillTxt, active && s.stagePillTxtActive, done && s.stagePillTxtDone]}>
                  {i + 1}
                </Text>
              </View>
              <Text style={[s.stageLabel, active && { color: Colors.primary }]}>
                {st === 'analyse' ? 'Analyse' : st === 'specifics' ? 'Category' : 'Review'}
              </Text>
              {i < 2 ? <View style={[s.stageLine, done && s.stageLineDone]} /> : null}
            </View>
          );
        })}
      </View>

      <ScrollView
        contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 120 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── STAGE 1: ANALYSE ── */}

        {/* Photos */}
        <View style={s.card}>
          <View style={s.cardHeader}>
            <View style={[s.cardIconWrap, { backgroundColor: Colors.primary + '20' }]}>
              <MaterialIcons name="photo-library" size={13} color={Colors.primary} />
            </View>
            <Text style={[s.cardTitle, { color: Colors.primary }]}>PHOTOS</Text>
            <Text style={s.cardMeta}>{item.media?.length ?? 0} images</Text>
          </View>
          {primaryImage ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.photoStrip}>
              {(item.media ?? []).slice(0, 6).map((uri, i) => (
                <Image key={i} source={{ uri }} style={s.photo} contentFit="cover" transition={100} />
              ))}
            </ScrollView>
          ) : (
            <View style={s.noPhoto}>
              <MaterialIcons name="add-photo-alternate" size={22} color={Colors.textTertiary} />
              <Text style={s.noPhotoTxt}>No photos — Re-Identify on the item screen to add photos</Text>
            </View>
          )}
        </View>

        {/* SWISH Analysis */}
        <View style={s.card}>
          <View style={s.cardHeader}>
            <View style={[s.cardIconWrap, { backgroundColor: Colors.accent + '20' }]}>
              <MaterialIcons name="auto-awesome" size={13} color={Colors.accent} />
            </View>
            <Text style={[s.cardTitle, { color: Colors.accent }]}>SWISH ANALYSIS</Text>
            {swishAnalysisDone ? (
              <View style={s.donePill}>
                <MaterialIcons name="check" size={10} color={Colors.success} />
                <Text style={s.donePillTxt}>Done</Text>
              </View>
            ) : (
              <ActivityIndicator size="small" color={Colors.accent} style={{ width: 14, height: 14 }} />
            )}
          </View>
          <Text style={s.swishTitle}>{item.canonicalTitle}</Text>
          {(() => {
            const idConf = item.identificationConfidence ?? 0;
            const cc = idConf >= 0.75 ? Colors.success : idConf >= 0.50 ? Colors.warning : Colors.danger;
            return (
              <View style={[s.confPill, { backgroundColor: cc + '15', borderColor: cc + '40' }]}>
                <Text style={[s.confTxt, { color: cc }]}>
                  {Math.round(idConf * 100)}% · {idConf >= 0.75 ? 'High' : idConf >= 0.50 ? 'Medium' : 'Low'} confidence
                </Text>
              </View>
            );
          })()}
        </View>

        {/* eBay Visual Search */}
        <View style={s.card}>
          <View style={s.cardHeader}>
            <View style={[s.cardIconWrap, { backgroundColor: Colors.info + '20' }]}>
              <MaterialIcons name="image-search" size={13} color={Colors.info} />
            </View>
            <Text style={[s.cardTitle, { color: Colors.info }]}>EBAY VISUAL SEARCH</Text>
            {ebaySearchRunning ? (
              <View style={s.runningRow}>
                <ActivityIndicator size="small" color={Colors.info} style={{ width: 14, height: 14 }} />
                <Text style={s.runningTxt}>Searching eBay GB...</Text>
              </View>
            ) : ebaySearchDone ? (
              <View style={s.donePill}>
                <MaterialIcons name="check" size={10} color={Colors.success} />
                <Text style={s.donePillTxt}>Done</Text>
              </View>
            ) : !primaryImage ? (
              <Text style={s.cardMeta}>No image available</Text>
            ) : null}
          </View>

          {ebaySearchRunning && !ebayResult ? (
            <View style={s.searchingNote}>
              <Text style={s.searchingNoteTxt}>
                Searching for visually similar eBay GB listings…
              </Text>
            </View>
          ) : ebayResult ? (
            <EbaySimilarItemsPanel
              result={ebayResult}
              expanded={ebayExpanded}
              onToggle={() => setEbayExpanded(e => !e)}
            />
          ) : !primaryImage ? (
            <View style={s.searchingNote}>
              <Text style={[s.searchingNoteTxt, { color: Colors.textTertiary }]}>
                Add photos to enable eBay visual search
              </Text>
            </View>
          ) : null}
        </View>

        {/* Combined summary + category */}
        {swishAnalysisDone ? (
          <CombinedAnalysisSummary
            item={item}
            ebayResult={ebayResult}
            confirmedCategory={confirmedCategory}
            onCategoryChange={handleCategoryChange}
          />
        ) : null}

        {/* Inline category picker — opened directly, no listing ID needed */}
        <InlineCategoryPicker
          visible={showCategoryPicker}
          currentId={confirmedCategory?.id ?? ''}
          tenantId={tenant?.id}
          onSelect={handleCategorySelected}
          onClose={() => setShowCategoryPicker(false)}
        />

        {/* Category confirmation gate */}
        {!confirmedCategory && swishAnalysisDone ? (
          <View style={s.gateCard}>
            <MaterialIcons name="warning" size={16} color={Colors.warning} />
            <Text style={s.gateTxt}>
              Select an eBay category before continuing. Category determines which item specifics are required.
            </Text>
          </View>
        ) : null}

        {/* ── STAGE 2: EXISTING LISTINGS OR GENERATE ── */}
        {hasExistingListing ? (
          <View style={s.card}>
            <View style={s.cardHeader}>
              <View style={[s.cardIconWrap, { backgroundColor: Colors.success + '20' }]}>
                <MaterialIcons name="check-circle" size={13} color={Colors.success} />
              </View>
              <Text style={[s.cardTitle, { color: Colors.success }]}>LISTING CREATED</Text>
            </View>
            {existingListings.map(listing => (
              <Pressable
                key={listing.id}
                onPress={() => router.push(`/ebay-listing-editor?id=${listing.id}` as any)}
                style={({ pressed }) => [s.listingRow, pressed && { opacity: 0.8 }]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={s.listingRowTitle} numberOfLines={1}>{listing.title}</Text>
                  <Text style={s.listingRowMeta}>
                    {listing.status} · £{listing.price.toFixed(2)}
                  </Text>
                </View>
                <MaterialIcons name="chevron-right" size={16} color={Colors.textTertiary} />
              </Pressable>
            ))}
          </View>
        ) : (
          <View style={s.card}>
            <View style={s.cardHeader}>
              <View style={[s.cardIconWrap, { backgroundColor: Colors.gold + '20' }]}>
                <MaterialIcons name="auto-fix-high" size={13} color={Colors.gold} />
              </View>
              <Text style={[s.cardTitle, { color: Colors.gold }]}>GENERATE LISTING</Text>
            </View>
            <Text style={s.generateNote}>
              SWISH will generate a title, description, and category-specific item specifics from the identification and eBay visual evidence.
            </Text>
          </View>
        )}

        {/* Delivery note */}
        <View style={s.deliveryCard}>
          <MaterialIcons name="check-circle" size={14} color={Colors.success} />
          <View style={{ flex: 1 }}>
            <Text style={s.deliveryTitle}>Simple Delivery — Buyer Pays</Text>
            <Text style={s.deliverySub}>Shipping handled by your eBay fulfillment policy</Text>
          </View>
        </View>

      </ScrollView>

      {/* Bottom action bar */}
      <View style={[s.actionBar, { paddingBottom: insets.bottom + Spacing.sm }]}>
        {hasExistingListing ? (
          <Pressable
            onPress={() => router.push(`/ebay-listing-editor?id=${existingListings[0].id}` as any)}
            style={s.primaryBtn}
          >
            <MaterialIcons name="edit" size={16} color={Colors.background} />
            <Text style={s.primaryBtnTxt}>Open Listing Editor</Text>
          </Pressable>
        ) : (
          <>
            {!confirmedCategory ? (
              <View style={s.primaryBtnDisabled}>
                <MaterialIcons name="category" size={16} color={Colors.textTertiary} />
                <Text style={s.primaryBtnDisabledTxt}>Select category to continue</Text>
              </View>
            ) : (
              <Pressable
                onPress={handleGenerateListing}
                disabled={generatingListing}
                style={[s.primaryBtn, generatingListing && { opacity: 0.7 }]}
              >
                {generatingListing ? (
                  <ActivityIndicator size="small" color={Colors.background} style={{ width: 16, height: 16 }} />
                ) : (
                  <MaterialIcons name="auto-awesome" size={16} color={Colors.background} />
                )}
                <Text style={s.primaryBtnTxt}>{generatingListing ? 'Generating...' : 'Generate Listing'}</Text>
              </Pressable>
            )}
          </>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },

  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.base, paddingBottom: Spacing.sm, borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder },
  headerBtn: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.surfaceBorder },
  headerTitle: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  headerSub: { fontSize: 10, color: Colors.textTertiary },
  headerAction: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: Colors.primaryDim, borderRadius: Radius.md, paddingHorizontal: Spacing.sm, paddingVertical: 6, borderWidth: 1, borderColor: Colors.primary + '40' },
  headerActionTxt: { fontSize: 10, color: Colors.primary, fontWeight: Typography.weight.semibold },

  stageStrip: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.base, paddingVertical: Spacing.sm, borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder, gap: 0 },
  stagePillWrap: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  stagePill: { width: 22, height: 22, borderRadius: 11, backgroundColor: Colors.surfaceHighlight, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.surfaceBorder },
  stagePillActive: { backgroundColor: Colors.primaryDim, borderColor: Colors.primary },
  stagePillDone: { backgroundColor: Colors.successDim, borderColor: Colors.success + '50' },
  stagePillTxt: { fontSize: 10, fontWeight: Typography.weight.bold, color: Colors.textTertiary },
  stagePillTxtActive: { color: Colors.primary },
  stagePillTxtDone: { color: Colors.success },
  stageLabel: { fontSize: 10, color: Colors.textTertiary, marginLeft: 4 },
  stageLine: { flex: 1, height: 1, backgroundColor: Colors.surfaceBorder, marginHorizontal: 4 },
  stageLineDone: { backgroundColor: Colors.success + '60' },

  content: { padding: Spacing.base, gap: Spacing.lg },

  card: { backgroundColor: Colors.surface, borderRadius: Radius.xl, padding: Spacing.md, gap: Spacing.sm, borderWidth: 1, borderColor: Colors.surfaceBorder, ...Shadow.sm },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  cardIconWrap: { width: 24, height: 24, borderRadius: Radius.sm, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { flex: 1, fontSize: 10, fontWeight: Typography.weight.bold, textTransform: 'uppercase', letterSpacing: 0.6 },
  cardMeta: { fontSize: 10, color: Colors.textTertiary },

  donePill: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: Colors.successDim, borderRadius: Radius.pill, paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1, borderColor: Colors.success + '30' },
  donePillTxt: { fontSize: 9, color: Colors.success, fontWeight: Typography.weight.bold },
  runningRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  runningTxt: { fontSize: 10, color: Colors.info, fontStyle: 'italic' },

  photoStrip: { flexDirection: 'row', gap: Spacing.sm, paddingVertical: 4 },
  photo: { width: 72, height: 72, borderRadius: Radius.md },
  noPhoto: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.md, padding: Spacing.md },
  noPhotoTxt: { flex: 1, fontSize: Typography.size.xs, color: Colors.textTertiary, lineHeight: 16 },

  swishTitle: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.textPrimary, lineHeight: 20 },
  confPill: { flexDirection: 'row', alignItems: 'center', borderRadius: Radius.pill, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, alignSelf: 'flex-start' },
  confTxt: { fontSize: 9, fontWeight: Typography.weight.bold, letterSpacing: 0.3 },

  searchingNote: { backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.md, padding: Spacing.md },
  searchingNoteTxt: { fontSize: Typography.size.xs, color: Colors.info, fontStyle: 'italic' },

  gateCard: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, backgroundColor: Colors.warningDim, borderRadius: Radius.xl, padding: Spacing.md, borderWidth: 1, borderColor: Colors.warning + '40' },
  gateTxt: { flex: 1, fontSize: Typography.size.xs, color: Colors.warning, lineHeight: 16 },

  listingRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.md, padding: Spacing.md, borderWidth: 1, borderColor: Colors.surfaceBorder },
  listingRowTitle: { fontSize: Typography.size.sm, color: Colors.textPrimary, fontWeight: Typography.weight.medium },
  listingRowMeta: { fontSize: 10, color: Colors.textTertiary, marginTop: 2, textTransform: 'capitalize' },

  generateNote: { fontSize: Typography.size.xs, color: Colors.textTertiary, lineHeight: 17 },

  deliveryCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.successDim, borderRadius: Radius.xl, padding: Spacing.md, borderWidth: 1, borderColor: Colors.success + '30' },
  deliveryTitle: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.success },
  deliverySub: { fontSize: 10, color: Colors.success + 'BB', marginTop: 1 },

  actionBar: { flexDirection: 'row', gap: Spacing.sm, padding: Spacing.base, backgroundColor: Colors.surface, borderTopWidth: 1, borderTopColor: Colors.surfaceBorder },
  primaryBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, backgroundColor: Colors.primary, borderRadius: Radius.md, paddingVertical: Spacing.md, ...Shadow.glow },
  primaryBtnTxt: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.background },
  primaryBtnDisabled: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.md, paddingVertical: Spacing.md, borderWidth: 1, borderColor: Colors.surfaceBorder },
  primaryBtnDisabledTxt: { fontSize: Typography.size.sm, color: Colors.textTertiary, fontWeight: Typography.weight.medium },

  emptyText: { fontSize: Typography.size.lg, color: Colors.textSecondary, marginTop: Spacing.md },
  backLink: { marginTop: Spacing.md, padding: Spacing.md },
  backLinkTxt: { fontSize: Typography.size.sm, color: Colors.primary },
});
