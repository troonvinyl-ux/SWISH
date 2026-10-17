// SWISH — Listing Preflight Screen
// Pre-submission checklist and confirmation before submitting a listing to eBay.
// Runs swish-verify, checks business policies, category, images, price, and specifics.
// Shows pass/fail for each check, then allows submission.

import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator,
  TextInput, Modal, FlatList, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import { getSupabaseClient } from '@/template';
import { Colors, Typography, Spacing, Radius, Shadow } from '@/constants/theme';
import { useApp } from '@/hooks/useApp';
import { useAlert } from '@/template';
import { submitListingToMarketplace, SubmitStep, SubmitResult } from '@/services/listingService';

interface PreflightCheck {
  id: string;
  label: string;
  sublabel?: string;
  status: 'pending' | 'pass' | 'fail' | 'warn' | 'running';
  detail?: string;
}

export default function ListingPreflightScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { tenant } = useApp();
  const { showAlert } = useAlert();
  const { listingId, itemId } = useLocalSearchParams<{ listingId: string; itemId: string }>();

  const [checks, setChecks] = useState<PreflightCheck[]>([
    { id: 'title',       label: 'Title',            sublabel: 'Max 80 characters, meaningful content', status: 'pending' },
    { id: 'price',       label: 'Price',             sublabel: 'Greater than £0.00', status: 'pending' },
    { id: 'category',    label: 'eBay Category',     sublabel: 'Valid EBAY_GB leaf category', status: 'pending' },
    { id: 'condition',   label: 'Condition',         sublabel: 'Condition ID must be set', status: 'pending' },
    { id: 'images',      label: 'Photos',            sublabel: 'At least 1 permanent HTTPS image', status: 'pending' },
    { id: 'policies',    label: 'Business Policies', sublabel: 'Fulfillment + Return policies selected', status: 'pending' },
    { id: 'description', label: 'Description',       sublabel: 'Some description text present', status: 'pending' },
  ]);

  const [listingData, setListingData] = useState<any>(null);
  const [scanning, setScanning] = useState(true);
  const [scanError, setScanError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitStep, setSubmitStep] = useState<SubmitStep | null>(null);
  const [submitResult, setSubmitResult] = useState<SubmitResult | null>(null);

  // ── Category picker modal ─────────────────────────────────────────────────
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);
  const [catSearch, setCatSearch] = useState('');
  const [catSearchLoading, setCatSearchLoading] = useState(false);
  const [catSuggestions, setCatSuggestions] = useState<Array<{ id: string; name: string; path?: string; isLeaf: boolean }>>([]);
  const [catBrowseStack, setCatBrowseStack] = useState<Array<{ id: string; name: string }>>([{ id: '', name: 'All Categories' }]);
  const [catBrowseItems, setCatBrowseItems] = useState<Array<{ id: string; name: string; isLeaf: boolean; hasChildren: boolean }>>([]);
  const [catBrowseLoading, setCatBrowseLoading] = useState(false);
  const [catSaving, setCatSaving] = useState(false);
  const catSearchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updateCheck = useCallback((id: string, update: Partial<PreflightCheck>) => {
    setChecks(prev => prev.map(c => c.id === id ? { ...c, ...update } : c));
  }, []);

  // Re-run preflight when we return to this screen (e.g. after editor save)
  const hasRun = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (hasRun.current) {
        // Reset and rescan every time screen gains focus
        setChecks(prev => prev.map(c => ({ ...c, status: 'pending' as const })));
        setSubmitResult(null);
        setSubmitStep(null);
        runPreflight();
      }
      hasRun.current = true;
    }, [runPreflight]),
  );

  const runPreflight = useCallback(async () => {
    if (!listingId || !tenant) return;
    setScanning(true);
    setScanError(null);

    const supabase = getSupabaseClient();
    let allPass = true;

    try {
      const { data: row, error: rowErr } = await supabase
        .from('listings')
        .select('*, items(id, canonical_title, condition, condition_grade, media, attributes, specialist_id, quantity)')
        .eq('id', listingId)
        .eq('tenant_id', tenant.id)
        .maybeSingle();

      if (rowErr || !row) {
        setScanError(rowErr?.message ?? 'Listing not found');
        setScanning(false);
        return;
      }

      setListingData(row);
      const item = row.items as any;
      const attrs: Record<string, any> = item?.attributes ?? {};

      // ── Title ─────────────────────────────────────────────────────────────
      const title = row.title ?? '';
      if (!title || title.trim().length < 3) {
        updateCheck('title', { status: 'fail', detail: `Title is missing or too short (${title.length} chars)` });
        allPass = false;
      } else if (title.length > 80) {
        updateCheck('title', { status: 'fail', detail: `Title exceeds 80 characters (${title.length} chars)` });
        allPass = false;
      } else {
        updateCheck('title', { status: 'pass', detail: `"${title.slice(0, 60)}${title.length > 60 ? '...' : ''}" (${title.length}/80)` });
      }

      // ── Price ──────────────────────────────────────────────────────────────
      const price = Number(row.price ?? 0);
      if (price <= 0) {
        updateCheck('price', { status: 'fail', detail: 'Price must be greater than £0.00' });
        allPass = false;
      } else {
        updateCheck('price', { status: 'pass', detail: `£${price.toFixed(2)}` });
      }

      // ── Category — live leaf validation ─────────────────────────────────
      const categoryId = row.category_id ?? attrs['ebay_category_id'] ?? attrs['_ebay_category_id'] ?? '';
      const savedCategoryName = String(
        row.category_name ?? attrs['ebay_category_name'] ?? attrs['_ebay_category_name'] ?? ''
      ).trim();
      if (!categoryId) {
        updateCheck('category', { status: 'fail', detail: 'No eBay category set. Tap "Pick Category" to choose a valid leaf category.' });
        allPass = false;
      } else {
        // Validate against the current eBay category tree. Cached leaf flags can
        // be stale after a taxonomy update, so never pass preflight from DB alone.
        try {
          let validation: any = null;
          let validationError: any = null;
          try {
            const primary = await supabase.functions.invoke('swish-ebay-category', {
              body: {
                route: 'validate_category',
                tenantId: tenant.id,
                categoryId: String(categoryId),
                categoryName: savedCategoryName,
              },
            });
            validation = primary.data;
            validationError = primary.error;
          } catch (e: any) {
            validationError = e;
          }

          // The dedicated taxonomy function uses an application token. If that
          // token cannot verify a category, retry through the listing function,
          // which can use the connected seller token and the actual publish path.
          // Also run seller-token resolution whenever a saved label exists. This catches old
          // records where the ID still points to a valid leaf but the saved label belongs elsewhere.
          if (validationError || validation?.valid == null || savedCategoryName) {
            try {
              const fallback = await supabase.functions.invoke('swish-ebay-list', {
                body: {
                  route: 'resolve_category',
                  tenantId: tenant.id,
                  categoryId: String(categoryId),
                  categoryName: savedCategoryName,
                  title,
                  specialistId: item?.specialist_id ?? '',
                },
              });
              if (!fallback.error && fallback.data?.success && fallback.data?.resolvedId) {
                const resolvedId = String(fallback.data.resolvedId);
                if (resolvedId === String(categoryId)) {
                  validation = {
                    valid: true,
                    isLeaf: true,
                    categoryName: fallback.data.resolvedName ?? attrs['ebay_category_name'] ?? categoryId,
                    source: 'seller_token_taxonomy',
                  };
                  validationError = null;
                } else {
                  validation = {
                    valid: false,
                    isLeaf: false,
                    reason: `Selected category ${categoryId} could not be verified as a leaf. eBay suggests ${fallback.data.resolvedName ?? resolvedId} (ID ${resolvedId}); select it manually if it matches this item.`,
                  };
                  validationError = null;
                }
              } else {
                validationError = fallback.error ?? new Error(fallback.data?.error ?? 'Seller-token category validation unavailable');
                // If an old saved label exists, a plain leaf-ID pass is not enough
                // to prove the listing is in the intended category.
                if (savedCategoryName) {
                  validation = {
                    valid: null,
                    isLeaf: null,
                    reason: 'The category ID could not be matched to its saved label against the live seller taxonomy. Retry with eBay connected or choose the category again.',
                  };
                }
              }
            } catch (e: any) {
              validationError = validationError ?? e;
              if (savedCategoryName) {
                validation = {
                  valid: null,
                  isLeaf: null,
                  reason: 'The category ID could not be matched to its saved label against the live seller taxonomy. Retry with eBay connected or choose the category again.',
                };
              }
            }
          }

          if (validation?.valid === true && validation?.isLeaf === true) {
            updateCheck('category', {
              status: 'pass',
              detail: `${validation.categoryName ?? attrs['ebay_category_name'] ?? categoryId} (ID: ${categoryId}) ✓ Verified against current EBAY_GB Taxonomy`,
            });
          } else if (validation?.valid === false || validation?.isLeaf === false) {
            // Preflight taxonomy checks can disagree with the connected seller's
            // publish path. Treat this client-side result as advisory and let the
            // server-side publish route perform the final authoritative validation.
            // The edge function still blocks a category it cannot verify as a leaf.
            updateCheck('category', {
              status: 'warn',
              detail: `Preflight category warning: ${validation?.reason ?? `Category ID ${categoryId} was not verified as an EBAY_GB leaf.`} The publish service will perform its own final check; eBay submission will still stop if the category is invalid.`,
            });
          } else {
            updateCheck('category', {
              status: 'warn',
              detail: validation?.reason ?? validationError?.message ?? `Category ID ${categoryId} could not be verified right now. The publish function will retry validation before submission.`,
            });
          }
        } catch (e: any) {
          updateCheck('category', {
            status: 'warn',
            detail: `Live category validation is unavailable (${e?.message ?? 'unknown error'}). The publish function will retry validation before submission.`,
          });
        }
      }

      // ── Condition ──────────────────────────────────────────────────────────
      const condition = item?.condition ?? '';
      if (!condition) {
        updateCheck('condition', { status: 'warn', detail: 'No condition set — will default to "Very Good"' });
      } else {
        updateCheck('condition', { status: 'pass', detail: condition });
      }

      // ── Images ────────────────────────────────────────────────────────────
      const media: string[] = Array.isArray(item?.media) ? item.media : [];
      const permanentMedia = media.filter((u: string) => u?.startsWith('https://') && (u.includes('supabase') || u.includes('onspace')));
      const allHttpsMedia = media.filter((u: string) => u?.startsWith('https://'));
      if (permanentMedia.length > 0) {
        updateCheck('images', { status: 'pass', detail: `${permanentMedia.length} permanent image${permanentMedia.length === 1 ? '' : 's'} ready for eBay` });
      } else if (allHttpsMedia.length > 0) {
        updateCheck('images', { status: 'warn', detail: `${allHttpsMedia.length} HTTPS image${allHttpsMedia.length === 1 ? '' : 's'} found (not in permanent storage — eBay CDN URLs may expire)` });
      } else if (media.length > 0) {
        updateCheck('images', { status: 'warn', detail: `${media.length} local image${media.length === 1 ? '' : 's'} — not yet uploaded to permanent storage. Use "Fetch Image from eBay" on the item screen.` });
      } else {
        updateCheck('images', { status: 'warn', detail: 'No photos — listing will be submitted without images' });
      }

      // ── Business Policies ─────────────────────────────────────────────────
      const { data: conn } = await supabase
        .from('marketplace_connectors')
        .select('selected_fulfillment_policy_id, selected_return_policy_id, status')
        .eq('tenant_id', tenant.id)
        .eq('marketplace_id', 'ebay')
        .maybeSingle();

      if (!conn || conn.status !== 'connected') {
        updateCheck('policies', { status: 'fail', detail: 'eBay is not connected. Re-authorise in Marketplaces.' });
        allPass = false;
      } else if (!conn.selected_fulfillment_policy_id || !conn.selected_return_policy_id) {
        const missing: string[] = [];
        if (!conn.selected_fulfillment_policy_id) missing.push('Fulfillment (Shipping)');
        if (!conn.selected_return_policy_id) missing.push('Returns');
        updateCheck('policies', { status: 'fail', detail: `Missing policies: ${missing.join(', ')}. Go to Settings → eBay Connection → Load Policies.` });
        allPass = false;
      } else {
        updateCheck('policies', { status: 'pass', detail: 'Fulfillment + Return policies configured' });
      }

      // ── Description ────────────────────────────────────────────────────────
      const description = row.description ?? '';
      if (!description || description.trim().length < 10) {
        updateCheck('description', { status: 'warn', detail: 'Short description — consider adding more detail for better buyer confidence' });
      } else {
        updateCheck('description', { status: 'pass', detail: `${description.trim().length} characters` });
      }

    } catch (e: any) {
      setScanError(e?.message ?? 'Preflight scan failed');
    } finally {
      setScanning(false);
    }
  }, [listingId, tenant, updateCheck]);

  useEffect(() => { runPreflight(); }, [runPreflight]);

  // ── Category picker logic ─────────────────────────────────────────────────

  const loadCatBrowse = useCallback(async (parentId: string) => {
    if (!tenant?.id) return;
    setCatBrowseLoading(true);
    setCatBrowseItems([]);
    try {
      const supabase = getSupabaseClient();
      let data: any = null;
      let error: any = null;
      try {
        const primary = await supabase.functions.invoke('swish-ebay-category', {
          body: { route: 'get_category_children', tenantId: tenant.id, parentId: parentId || '' },
        });
        data = primary.data;
        error = primary.error;
      } catch (e: any) {
        error = e;
      }

      if (error || !data?.success || ['curated', 'curated_verified', 'db_cache'].includes(data?.source)) {
        try {
          const fallback = await supabase.functions.invoke('swish-ebay-list', {
            body: { route: 'get_category_children', tenantId: tenant.id, parentId: parentId || '' },
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
        setCatBrowseItems([]);
        showAlert('eBay Categories Unavailable', data?.error ?? error?.message ?? 'The eBay category service did not return a category list.');
        return;
      }

      const children = data?.children ?? data?.categories ?? [];
      setCatBrowseItems(children
        .filter((cat: any) => cat?.id || cat?.categoryId)
        .map((cat: any) => ({
          id: String(cat.categoryId ?? cat.id),
          name: String(cat.categoryName ?? cat.name ?? ''),
          isLeaf: cat.isLeaf === true || cat.leafCategoryTreeNode === true,
          hasChildren: cat.isLeaf !== true && cat.leafCategoryTreeNode !== true && Number(cat.childCount ?? 1) > 0,
        }))
        .filter((cat: any) => cat.name));
    } catch (e: any) {
      setCatBrowseItems([]);
      showAlert('eBay Categories Unavailable', e?.message ?? 'Could not load eBay categories.');
    } finally {
      setCatBrowseLoading(false);
    }
  }, [tenant?.id, showAlert]);

  const openCategoryPicker = useCallback(() => {
    setCatSearch('');
    setCatSuggestions([]);
    setCatBrowseStack([{ id: '', name: 'All Categories' }]);
    setCategoryPickerOpen(true);
    loadCatBrowse('');
  }, [loadCatBrowse]);

  const handleCatSearch = useCallback((text: string) => {
    setCatSearch(text);
    if (catSearchTimeout.current) clearTimeout(catSearchTimeout.current);
    if (!text.trim()) { setCatSuggestions([]); return; }
    catSearchTimeout.current = setTimeout(async () => {
      if (!tenant?.id) return;
      setCatSearchLoading(true);
      try {
        const supabase = getSupabaseClient();
        const query = text.trim().slice(0, 100);
        let data: any = null;
        let error: any = null;
        try {
          const primary = await supabase.functions.invoke('swish-ebay-category', {
            body: { route: 'get_category_suggestions', tenantId: tenant.id, query },
          });
          data = primary.data;
          error = primary.error;
        } catch (e: any) {
          error = e;
        }

        if (error || !data?.success || ['curated', 'curated_verified', 'db_cache_offline', 'curated_fallback', 'db_cache'].includes(data?.source)) {
          try {
            const fallback = await supabase.functions.invoke('swish-ebay-list', {
              body: { route: 'get_category_suggestions', tenantId: tenant.id, query },
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
          setCatSuggestions([]);
          showAlert('eBay Category Search Failed', data?.error ?? error?.message ?? 'Unable to search eBay categories.');
          return;
        }
        const sug = Array.isArray(data?.suggestions) ? data.suggestions : [];
        setCatSuggestions(sug
          .filter((s: any) => s?.id && s?.name && s.isLeaf === true)
          .map((s: any) => ({
            id: String(s.categoryId ?? s.id),
            name: String(s.categoryName ?? s.name),
            path: s.categoryPath ?? '',
            isLeaf: true,
          })));
      } catch (e: any) {
        setCatSuggestions([]);
        showAlert('eBay Category Search Failed', e?.message ?? 'Unable to search eBay categories.');
      } finally {
        setCatSearchLoading(false);
      }
    }, 500);
  }, [tenant?.id, showAlert]);

  const handleCatDrillDown = useCallback((item: { id: string; name: string; isLeaf: boolean; hasChildren: boolean }) => {
    if (item.isLeaf) {
      handleCatSelect(item.id, item.name);
    } else {
      setCatBrowseStack(prev => [...prev, { id: item.id, name: item.name }]);
      loadCatBrowse(item.id);
    }
  }, [loadCatBrowse]);

  const handleCatBack = useCallback(() => {
    if (catBrowseStack.length <= 1) return;
    const newStack = catBrowseStack.slice(0, -1);
    setCatBrowseStack(newStack);
    loadCatBrowse(newStack[newStack.length - 1].id);
  }, [catBrowseStack, loadCatBrowse]);

  const handleCatSelect = useCallback(async (catId: string, catName: string) => {
    if (!listingId || !tenant?.id || !catId) return;
    setCatSaving(true);
    try {
      const supabase = getSupabaseClient();
      // Persist the selected category to the correct tenant's listing/item records.
      const { data: savedListing, error: saveListingError } = await supabase.from('listings')
        .update({ category_id: catId, updated_at: new Date().toISOString() })
        .eq('id', listingId)
        .eq('tenant_id', tenant.id)
        .select('id, category_id')
        .maybeSingle();
      if (saveListingError) throw saveListingError;
      if (!savedListing || String(savedListing.category_id ?? '') !== String(catId)) {
        throw new Error('The selected eBay category did not persist to this SWISH listing. No submission was attempted.');
      }

      const { data: lRow, error: lookupError } = await supabase.from('listings')
        .select('item_id, items(id, attributes)')
        .eq('id', listingId)
        .eq('tenant_id', tenant.id)
        .maybeSingle();
      if (lookupError) throw lookupError;

      const itemId2 = (lRow as any)?.items?.id;
      const existingAttrs = (lRow as any)?.items?.attributes ?? {};
      if (itemId2) {
        const { error: saveItemError } = await supabase.from('items')
          .update({
            attributes: { ...existingAttrs, ebay_category_id: catId, ebay_category_name: catName },
            updated_at: new Date().toISOString(),
          })
          .eq('id', itemId2)
          .eq('tenant_id', tenant.id);
        if (saveItemError) throw saveItemError;

        // Read the chosen ID/name pair back so the submit path cannot proceed
        // with a stale category left in the linked item record.
        const { data: verifiedItem, error: verifyItemError } = await supabase
          .from('items')
          .select('attributes')
          .eq('id', itemId2)
          .eq('tenant_id', tenant.id)
          .maybeSingle();
        if (verifyItemError) throw verifyItemError;
        const savedAttrs = verifiedItem?.attributes ?? {};
        if (String(savedAttrs.ebay_category_id ?? '') !== String(catId) ||
            String(savedAttrs.ebay_category_name ?? '') !== String(catName)) {
          throw new Error('The selected eBay category did not persist to the linked SWISH item. No submission was attempted.');
        }
      }
      setCategoryPickerOpen(false);
      // Re-run preflight to reflect the new category
      setChecks(prev => prev.map(c => c.id === 'category' ? { ...c, status: 'pending' as const } : c));
      runPreflight();
    } catch (e: any) {
      showAlert('Save Failed', e?.message ?? 'Could not save category');
    }
    setCatSaving(false);
  }, [listingId, tenant?.id, runPreflight, showAlert]);

  const failCount = checks.filter(c => c.status === 'fail').length;
  const warnCount = checks.filter(c => c.status === 'warn').length;
  const passCount = checks.filter(c => c.status === 'pass').length;
  const canSubmit = !scanning && failCount === 0 && !submitting && !submitResult?.success;

  const handleSubmit = useCallback(async () => {
    if (!listingId || !tenant || !canSubmit) return;

    setSubmitting(true);

    const result = await submitListingToMarketplace(
      tenant.id,
      listingId,
      (step) => setSubmitStep(step),
    );

    setSubmitResult(result);
    setSubmitting(false);

    if (result.success) {
      showAlert(
        'Listed on eBay!',
        `Your listing is now live on eBay UK.${result.externalListingId ? `\n\nListing ID: ${result.externalListingId}` : ''}${result.warnings?.length ? `\n\nSWISH advisories (listing was still submitted):\n• ${result.warnings.join('\n• ')}` : ''}`,
        [{
          text: 'View Listing',
          onPress: () => {
            if (itemId) router.replace(`/stock-listing/${itemId}` as any);
            else router.back();
          },
        }],
      );
    } else {
      showAlert(
        'Submission Failed',
        result.error ?? 'eBay rejected the listing.',
        [
          { text: 'Retry', onPress: () => { setSubmitResult(null); setSubmitStep(null); } },
          { text: 'Cancel', style: 'cancel', onPress: () => router.back() },
        ],
      );
    }
  }, [listingId, tenant, canSubmit, showAlert, router, itemId]);

  const SUBMIT_STEPS = [
    { id: 'verifying',          label: 'Verifying listing', icon: 'fact-check' },
    { id: 'checking_policies',  label: 'Checking policies', icon: 'policy' },
    { id: 'resolving_category', label: 'Resolving category', icon: 'category' },
    { id: 'publishing',         label: 'Publishing to eBay', icon: 'send' },
  ];

  const stepOrder = SUBMIT_STEPS.map(s => s.id);
  const currentStepIdx = submitStep ? stepOrder.indexOf(submitStep) : -1;

  return (
    <View style={s.container}>
      <StatusBar style="light" />

      <View style={[s.header, { paddingTop: insets.top + Spacing.sm }]}>
        <Pressable onPress={() => router.back()} style={s.backBtn} hitSlop={8}>
          <MaterialIcons name="arrow-back" size={20} color={Colors.textSecondary} />
        </Pressable>
        <View style={s.flex}>
          <Text style={s.headerTitle}>Listing Preflight</Text>
          <Text style={s.headerSub} numberOfLines={1}>{listingData?.title ?? 'Checking...'}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 120 }]} showsVerticalScrollIndicator={false}>

        {/* Scan status */}
        {scanning ? (
          <View style={s.scanningCard}>
            <ActivityIndicator size="small" color={Colors.primary} />
            <Text style={s.scanningText}>Running preflight checks...</Text>
          </View>
        ) : scanError ? (
          <View style={s.errorCard}>
            <MaterialIcons name="error" size={16} color={Colors.danger} />
            <Text style={s.errorText}>{scanError}</Text>
          </View>
        ) : (
          <View style={s.summaryCard}>
            <View style={s.summaryRow}>
              {passCount > 0 ? (
                <View style={[s.summaryChip, { backgroundColor: Colors.successDim, borderColor: Colors.success + '40' }]}>
                  <MaterialIcons name="check-circle" size={12} color={Colors.success} />
                  <Text style={[s.summaryChipText, { color: Colors.success }]}>{passCount} Pass</Text>
                </View>
              ) : null}
              {warnCount > 0 ? (
                <View style={[s.summaryChip, { backgroundColor: Colors.warningDim, borderColor: Colors.warning + '40' }]}>
                  <MaterialIcons name="warning" size={12} color={Colors.warning} />
                  <Text style={[s.summaryChipText, { color: Colors.warning }]}>{warnCount} Warning</Text>
                </View>
              ) : null}
              {failCount > 0 ? (
                <View style={[s.summaryChip, { backgroundColor: Colors.dangerDim, borderColor: Colors.danger + '40' }]}>
                  <MaterialIcons name="cancel" size={12} color={Colors.danger} />
                  <Text style={[s.summaryChipText, { color: Colors.danger }]}>{failCount} Failed</Text>
                </View>
              ) : null}
            </View>
            {failCount === 0 ? (
              <Text style={[s.summaryStatus, { color: Colors.success }]}>
                {warnCount > 0 ? 'Ready to submit — review warnings below' : 'All checks passed — ready to submit'}
              </Text>
            ) : (
              <Text style={[s.summaryStatus, { color: Colors.danger }]}>
                {failCount} check{failCount === 1 ? '' : 's'} must be fixed before submitting
              </Text>
            )}
          </View>
        )}

        {/* Checks */}
        {checks.map(check => (
          <View key={check.id} style={[
            s.checkCard,
            check.status === 'pass' && s.checkCardPass,
            check.status === 'fail' && s.checkCardFail,
            check.status === 'warn' && s.checkCardWarn,
          ]}>
            <View style={s.checkIcon}>
              {check.status === 'running' ? (
                <ActivityIndicator size="small" color={Colors.primary} />
              ) : check.status === 'pass' ? (
                <MaterialIcons name="check-circle" size={18} color={Colors.success} />
              ) : check.status === 'fail' ? (
                <MaterialIcons name="cancel" size={18} color={Colors.danger} />
              ) : check.status === 'warn' ? (
                <MaterialIcons name="warning" size={18} color={Colors.warning} />
              ) : (
                <MaterialIcons name="radio-button-unchecked" size={18} color={Colors.textTertiary} />
              )}
            </View>
            <View style={s.flex}>
              <View style={s.checkLabelRow}>
              <Text style={[
                s.checkLabel,
                check.status === 'pass' && { color: Colors.success },
                check.status === 'fail' && { color: Colors.danger },
                check.status === 'warn' && { color: Colors.warning },
              ]}>
                {check.label}
              </Text>
              {/* Pick Category button — shown only when category check fails */}
              {check.id === 'category' && check.status === 'fail' ? (
                <Pressable
                  onPress={openCategoryPicker}
                  style={s.pickCatBtn}
                  hitSlop={4}
                >
                  <MaterialIcons name="category" size={11} color={Colors.primary} />
                  <Text style={s.pickCatBtnText}>Pick Category</Text>
                </Pressable>
              ) : null}
              </View>
              {check.sublabel ? <Text style={s.checkSublabel}>{check.sublabel}</Text> : null}
              {check.detail ? <Text style={[s.checkDetail, check.status === 'fail' && { color: Colors.danger }, check.status === 'warn' && { color: Colors.warning }]}>{check.detail}</Text> : null}
            </View>
          </View>
        ))}

        {/* Submit progress (when submitting) */}
        {submitting ? (
          <View style={s.submitProgressCard}>
            <Text style={s.submitProgressTitle}>Submitting to eBay...</Text>
            {SUBMIT_STEPS.map((step, idx) => {
              const state: 'idle' | 'active' | 'done' =
                submitStep === 'done' ? 'done'
                : idx < currentStepIdx ? 'done'
                : idx === currentStepIdx ? 'active'
                : 'idle';
              return (
                <View key={step.id} style={s.submitStep}>
                  <View style={[s.submitStepIcon, state === 'done' && s.submitStepIconDone, state === 'active' && s.submitStepIconActive]}>
                    {state === 'active' ? (
                      <ActivityIndicator size="small" color={Colors.primary} style={{ width: 14, height: 14 }} />
                    ) : state === 'done' ? (
                      <MaterialIcons name="check" size={12} color={Colors.success} />
                    ) : (
                      <MaterialIcons name={step.icon as any} size={12} color={Colors.textTertiary} />
                    )}
                  </View>
                  <Text style={[s.submitStepLabel, state === 'active' && { color: Colors.primary }, state === 'done' && { color: Colors.success }]}>
                    {step.label}
                  </Text>
                </View>
              );
            })}
          </View>
        ) : null}

        {/* Success state */}
        {submitResult?.success ? (
          <View style={s.successCard}>
            <MaterialIcons name="check-circle" size={32} color={Colors.success} />
            <Text style={s.successTitle}>Listed on eBay!</Text>
            {submitResult.externalListingId ? (
              <Text style={s.successSub}>Listing ID: {submitResult.externalListingId}</Text>
            ) : null}
          </View>
        ) : null}

        {/* Fix instructions for failures */}
        {failCount > 0 && !scanning ? (
          <View style={s.fixCard}>
            <MaterialIcons name="build" size={14} color={Colors.info} />
            <View style={s.flex}>
              <Text style={s.fixTitle}>How to fix</Text>
              {checks.filter(c => c.status === 'fail').map(c => (
                <Text key={c.id} style={s.fixItem}>
                  • {c.label}: {c.detail ?? 'Fix required'}
                </Text>
              ))}
            </View>
          </View>
        ) : null}

      </ScrollView>

      {/* ── Category Picker Modal ────────────────────────────────────────── */}
      <Modal
        visible={categoryPickerOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setCategoryPickerOpen(false)}
      >
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={s.modalContainer}>
            {/* Modal header */}
            <View style={s.modalHeader}>
              <View style={s.modalHeaderLeft}>
                {catBrowseStack.length > 1 ? (
                  <Pressable onPress={handleCatBack} style={s.modalBackBtn} hitSlop={8}>
                    <MaterialIcons name="arrow-back" size={18} color={Colors.textSecondary} />
                  </Pressable>
                ) : null}
                <View>
                  <Text style={s.modalTitle}>Pick eBay Category</Text>
                  <Text style={s.modalSub} numberOfLines={1}>
                    {catBrowseStack[catBrowseStack.length - 1]?.name ?? 'All Categories'}
                  </Text>
                </View>
              </View>
              <Pressable onPress={() => setCategoryPickerOpen(false)} style={s.modalCloseBtn} hitSlop={8}>
                <MaterialIcons name="close" size={20} color={Colors.textSecondary} />
              </Pressable>
            </View>

            {/* Search bar */}
            <View style={s.catSearchRow}>
              <MaterialIcons name="search" size={16} color={Colors.textTertiary} />
              <TextInput
                style={s.catSearchInput}
                value={catSearch}
                onChangeText={handleCatSearch}
                placeholder="Search categories (e.g. Ancient Coins)"
                placeholderTextColor={Colors.textTertiary}
                returnKeyType="search"
                clearButtonMode="while-editing"
              />
              {catSearchLoading ? <ActivityIndicator size="small" color={Colors.primary} style={{ width: 16, height: 16 }} /> : null}
            </View>

            {/* Leaf-only note */}
            <View style={s.catLeafNote}>
              <MaterialIcons name="info-outline" size={11} color={Colors.info} />
              <Text style={s.catLeafNoteText}>
                Tap a <Text style={{ color: Colors.success, fontWeight: '700' }}>✓ Leaf</Text> category to select it. Only leaf categories can be submitted to eBay.
              </Text>
            </View>

            {/* Results: search suggestions OR browse tree */}
            {catSearch.trim().length > 0 ? (
              // Search mode
              catSearchLoading ? (
                <View style={s.catCenterMsg}>
                  <ActivityIndicator color={Colors.primary} />
                  <Text style={s.catCenterText}>Searching eBay categories...</Text>
                </View>
              ) : catSuggestions.length === 0 ? (
                <View style={s.catCenterMsg}>
                  <MaterialIcons name="search-off" size={28} color={Colors.textTertiary} />
                  <Text style={s.catCenterText}>No results for "{catSearch}"</Text>
                  <Text style={s.catCenterSub}>Try a shorter keyword or browse below</Text>
                </View>
              ) : (
                <FlatList
                  data={catSuggestions}
                  keyExtractor={i => i.id}
                  contentContainerStyle={{ padding: Spacing.base, gap: Spacing.xs }}
                  renderItem={({ item }) => (
                    <Pressable
                      onPress={() => item.isLeaf ? handleCatSelect(item.id, item.name) : null}
                      style={[s.catItem, !item.isLeaf && s.catItemParent]}
                    >
                      <MaterialIcons
                        name={item.isLeaf ? 'sell' : 'folder-open'}
                        size={14}
                        color={item.isLeaf ? Colors.success : Colors.textTertiary}
                      />
                      <View style={s.flex}>
                        <Text style={[s.catItemName, item.isLeaf && { color: Colors.textPrimary }]}>{item.name}</Text>
                        {item.path ? <Text style={s.catItemPath} numberOfLines={1}>{item.path}</Text> : null}
                        <Text style={[s.catItemLeafTag, { color: item.isLeaf ? Colors.success : Colors.textTertiary }]}>
                          {item.isLeaf ? '✓ Leaf — tap to select' : 'Parent category — not selectable'}
                        </Text>
                      </View>
                      {item.isLeaf && catSaving ? (
                        <ActivityIndicator size="small" color={Colors.primary} style={{ width: 14, height: 14 }} />
                      ) : item.isLeaf ? (
                        <MaterialIcons name="check-circle-outline" size={16} color={Colors.success} />
                      ) : null}
                    </Pressable>
                  )}
                />
              )
            ) : (
              // Browse mode
              catBrowseLoading ? (
                <View style={s.catCenterMsg}>
                  <ActivityIndicator color={Colors.primary} />
                  <Text style={s.catCenterText}>Loading categories...</Text>
                </View>
              ) : catBrowseItems.length === 0 ? (
                <View style={s.catCenterMsg}>
                  <MaterialIcons name="folder-open" size={28} color={Colors.textTertiary} />
                  <Text style={s.catCenterText}>No categories found</Text>
                  <Text style={s.catCenterSub}>Try searching by keyword above</Text>
                </View>
              ) : (
                <FlatList
                  data={catBrowseItems}
                  keyExtractor={i => i.id}
                  contentContainerStyle={{ padding: Spacing.base, gap: Spacing.xs }}
                  renderItem={({ item }) => (
                    <Pressable
                      onPress={() => handleCatDrillDown(item)}
                      style={[s.catItem, item.isLeaf && s.catItemLeaf]}
                    >
                      <MaterialIcons
                        name={item.isLeaf ? 'sell' : (item.hasChildren ? 'chevron-right' : 'folder')}
                        size={14}
                        color={item.isLeaf ? Colors.success : Colors.primary}
                      />
                      <View style={s.flex}>
                        <Text style={[s.catItemName, item.isLeaf && { color: Colors.textPrimary }]}>{item.name}</Text>
                        <Text style={[s.catItemLeafTag, { color: item.isLeaf ? Colors.success : Colors.textTertiary }]}>
                          {item.isLeaf ? '✓ Leaf — tap to select' : 'Browse subcategories →'}
                        </Text>
                      </View>
                      {item.isLeaf && catSaving ? (
                        <ActivityIndicator size="small" color={Colors.primary} style={{ width: 14, height: 14 }} />
                      ) : !item.isLeaf ? (
                        <MaterialIcons name="chevron-right" size={16} color={Colors.textTertiary} />
                      ) : (
                        <MaterialIcons name="check-circle-outline" size={16} color={Colors.success} />
                      )}
                    </Pressable>
                  )}
                />
              )
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Bottom action bar */}
      <View style={[s.actionBar, { paddingBottom: insets.bottom + Spacing.sm }]}>
        <Pressable onPress={() => router.back()} style={s.cancelBtn} hitSlop={4}>
          <Text style={s.cancelBtnText}>Back</Text>
        </Pressable>
        <Pressable
          onPress={handleSubmit}
          disabled={!canSubmit}
          style={[s.submitBtn, !canSubmit && s.submitBtnDisabled]}
        >
          {submitting ? (
            <ActivityIndicator size="small" color={Colors.background} style={{ width: 16, height: 16 }} />
          ) : submitResult?.success ? (
            <MaterialIcons name="check-circle" size={16} color={Colors.background} />
          ) : (
            <MaterialIcons name="send" size={16} color={canSubmit ? Colors.background : Colors.textTertiary} />
          )}
          <Text style={[s.submitBtnText, !canSubmit && s.submitBtnTextDisabled]}>
            {submitting ? 'Submitting...'
              : submitResult?.success ? 'Listed!'
              : failCount > 0 ? `Fix ${failCount} issue${failCount === 1 ? '' : 's'} first`
              : 'Submit to eBay'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  // ── Category picker styles ─────────────────────────────────────────────────
  checkLabelRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flexWrap: 'wrap' },
  pickCatBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: Colors.primaryDim, borderRadius: Radius.pill,
    paddingHorizontal: Spacing.sm, paddingVertical: 3,
    borderWidth: 1, borderColor: Colors.primary + '50',
  },
  pickCatBtnText: { fontSize: 10, fontWeight: Typography.weight.bold, color: Colors.primary },
  modalContainer: { flex: 1, backgroundColor: Colors.background },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.base, paddingVertical: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder,
    paddingTop: 56,
  },
  modalHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flex: 1 },
  modalBackBtn: {
    width: 32, height: 32, borderRadius: Radius.md, backgroundColor: Colors.surface,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.surfaceBorder,
  },
  modalTitle: { fontSize: Typography.size.base, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  modalSub: { fontSize: Typography.size.xs, color: Colors.textTertiary, marginTop: 1 },
  modalCloseBtn: {
    width: 32, height: 32, borderRadius: Radius.pill, backgroundColor: Colors.surface,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.surfaceBorder,
  },
  catSearchRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    marginHorizontal: Spacing.base, marginVertical: Spacing.sm,
    backgroundColor: Colors.surface, borderRadius: Radius.lg,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    borderWidth: 1, borderColor: Colors.surfaceBorder,
  },
  catSearchInput: { flex: 1, fontSize: Typography.size.sm, color: Colors.textPrimary },
  catLeafNote: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 5,
    marginHorizontal: Spacing.base, marginBottom: Spacing.xs,
    backgroundColor: Colors.infoDim, borderRadius: Radius.sm,
    padding: Spacing.xs, borderWidth: 1, borderColor: Colors.info + '25',
  },
  catLeafNoteText: { flex: 1, fontSize: 10, color: Colors.info, lineHeight: 14 },
  catCenterMsg: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, padding: Spacing.xl },
  catCenterText: { fontSize: Typography.size.sm, color: Colors.textSecondary, textAlign: 'center' },
  catCenterSub: { fontSize: Typography.size.xs, color: Colors.textTertiary, textAlign: 'center' },
  catItem: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.surface, borderRadius: Radius.md,
    padding: Spacing.md, borderWidth: 1, borderColor: Colors.surfaceBorder,
  },
  catItemLeaf: { borderColor: Colors.success + '40', backgroundColor: Colors.successDim + '30' },
  catItemParent: { opacity: 0.65 },
  catItemName: { fontSize: Typography.size.sm, fontWeight: Typography.weight.medium, color: Colors.textSecondary },
  catItemPath: { fontSize: 10, color: Colors.textTertiary, marginTop: 1 },
  catItemLeafTag: { fontSize: 10, marginTop: 2 },
  //
  container: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingHorizontal: Spacing.base, paddingBottom: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder,
  },
  backBtn: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.surfaceBorder },
  headerTitle: { fontSize: Typography.size.base, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  headerSub: { fontSize: Typography.size.xs, color: Colors.textTertiary, marginTop: 2 },
  content: { padding: Spacing.base, gap: Spacing.sm },
  scanningCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surface, borderRadius: Radius.xl, padding: Spacing.base, borderWidth: 1, borderColor: Colors.surfaceBorder },
  scanningText: { fontSize: Typography.size.sm, color: Colors.textSecondary },
  errorCard: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, backgroundColor: Colors.dangerDim, borderRadius: Radius.xl, padding: Spacing.base, borderWidth: 1, borderColor: Colors.danger + '40' },
  errorText: { flex: 1, fontSize: Typography.size.sm, color: Colors.danger, lineHeight: 18 },
  summaryCard: { backgroundColor: Colors.surface, borderRadius: Radius.xl, padding: Spacing.base, gap: Spacing.sm, borderWidth: 1, borderColor: Colors.surfaceBorder },
  summaryRow: { flexDirection: 'row', gap: Spacing.sm, flexWrap: 'wrap' },
  summaryChip: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: Radius.pill, paddingHorizontal: Spacing.sm, paddingVertical: 4, borderWidth: 1 },
  summaryChipText: { fontSize: Typography.size.xs, fontWeight: Typography.weight.bold },
  summaryStatus: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold },
  checkCard: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, backgroundColor: Colors.surface, borderRadius: Radius.xl, padding: Spacing.md, borderWidth: 1, borderColor: Colors.surfaceBorder },
  checkCardPass: { borderColor: Colors.success + '40', backgroundColor: Colors.successDim },
  checkCardFail: { borderColor: Colors.danger + '40', backgroundColor: Colors.dangerDim },
  checkCardWarn: { borderColor: Colors.warning + '40', backgroundColor: Colors.warningDim },
  checkIcon: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 },
  checkLabel: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.textPrimary },
  checkSublabel: { fontSize: Typography.size.xs, color: Colors.textTertiary, marginTop: 2 },
  checkDetail: { fontSize: Typography.size.xs, color: Colors.textSecondary, marginTop: 3, lineHeight: 16 },
  submitProgressCard: { backgroundColor: Colors.surface, borderRadius: Radius.xl, padding: Spacing.base, gap: Spacing.sm, borderWidth: 1, borderColor: Colors.primary + '40' },
  submitProgressTitle: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.primary },
  submitStep: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  submitStepIcon: { width: 26, height: 26, borderRadius: Radius.sm, backgroundColor: Colors.surfaceHighlight, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.surfaceBorder },
  submitStepIconActive: { backgroundColor: Colors.primaryDim, borderColor: Colors.primary + '60' },
  submitStepIconDone: { backgroundColor: Colors.successDim, borderColor: Colors.success + '40' },
  submitStepLabel: { fontSize: Typography.size.xs, color: Colors.textTertiary },
  successCard: { alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.successDim, borderRadius: Radius.xl, padding: Spacing.xl, borderWidth: 1, borderColor: Colors.success + '40' },
  successTitle: { fontSize: Typography.size.xl, fontWeight: Typography.weight.bold, color: Colors.success },
  successSub: { fontSize: Typography.size.sm, color: Colors.success + 'BB' },
  fixCard: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, backgroundColor: Colors.infoDim, borderRadius: Radius.xl, padding: Spacing.base, borderWidth: 1, borderColor: Colors.info + '30' },
  fixTitle: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.info, marginBottom: Spacing.xs },
  fixItem: { fontSize: Typography.size.xs, color: Colors.textSecondary, lineHeight: 16, marginTop: 2 },
  actionBar: { flexDirection: 'row', gap: Spacing.sm, padding: Spacing.base, backgroundColor: Colors.surface, borderTopWidth: 1, borderTopColor: Colors.surfaceBorder },
  cancelBtn: { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md, borderRadius: Radius.md, backgroundColor: Colors.surfaceHighlight, borderWidth: 1, borderColor: Colors.surfaceBorder, alignItems: 'center', justifyContent: 'center' },
  cancelBtnText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.textSecondary },
  submitBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, backgroundColor: Colors.primary, borderRadius: Radius.md, paddingVertical: Spacing.md, ...Shadow.glow },
  submitBtnDisabled: { backgroundColor: Colors.surfaceHighlight, shadowOpacity: 0 },
  submitBtnText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.background },
  submitBtnTextDisabled: { color: Colors.textTertiary },
});
