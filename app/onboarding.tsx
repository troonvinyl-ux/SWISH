// SWISH V1 Onboarding — Subscriber Journey
// 3-step journey: Choose Niche → Store Details → Connect eBay
//
// Step 0 (new): Niche selection — subscriber chooses their primary trading niche.
//   This determines which application shell they enter after login.
//   The choice is persisted to AsyncStorage immediately so the entry route works
//   even before onboarding is completed.
//
// Step 1: Store Details (previously Step 0)
// Step 2: Connect eBay (previously Step 1)
//
// IMPORTANT: Subscribers connect their own eBay seller account via normal
// eBay OAuth. They are NEVER asked for developer credentials.
//
// After eBay connects, fetches live listing count and offers import CTA.

import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  TextInput, ActivityIndicator, KeyboardAvoidingView, Platform, Linking,
  Animated,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '@/template';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors, Typography, Spacing, Radius, Shadow } from '@/constants/theme';
import { useAlert } from '@/template';
import { useApp } from '@/hooks/useApp';
import { upsertBusinessConfig } from '@/services/businessConfigService';
import { getSupabaseClient } from '@/template';
import { FunctionsHttpError } from '@supabase/supabase-js';
import type { NicheId } from '@/constants/niches';
import { nicheToEntryRoute as resolveNicheEntryRoute } from '@/services/nicheRouting';
import { classifyListing, nicheToSpecialistId } from '@/services/nicheCategoryService';
import type { SpecialistId } from '@/constants/specialists';

const TOTAL_STEPS = 3;
const STEP_LABELS = ['Your Niche', 'Your Store', 'Connect eBay'];

// Onboarding shares the same fail-closed route resolver as the root router.
function nicheToEntryRoute(nicheId: NicheId): string {
  return resolveNicheEntryRoute(nicheId) ?? '/niche-select';
}

// The four primary subscriber niches available at onboarding
const ONBOARDING_NICHES: Array<{
  id: NicheId;
  name: string;
  tagline: string;
  icon: string;
  color: string;
  description: string;
}> = [
  {
    id: 'coins',
    name: 'Coin Flipper',
    tagline: 'Identify, value and flip coins & collectibles',
    icon: 'toll',
    color: '#F5C842',
    description: 'AI coin identification, Numista verification, eBay valuation, full order management.',
  },
  {
    id: 'motocross',
    name: 'Flipper MX',
    tagline: 'Buy, prep and flip motocross & off-road bikes',
    icon: 'two-wheeler',
    color: '#EF4444',
    description: 'MX bike AI identification, running-status valuation, eBay listing and profit tracking.',
  },
  {
    id: 'bicycles',
    name: 'Bike Flipper',
    tagline: 'Identify, value and flip bicycles',
    icon: 'pedal-bike',
    color: '#22C55E',
    description: 'Road, MTB, gravel and hybrid bike AI identification, parts & upgrade ROI, eBay listing.',
  },
  {
    id: 'clothing',
    name: 'Threads Flip',
    tagline: 'Source, identify and flip vintage & designer clothing',
    icon: 'checkroom',
    color: '#EC4899',
    description: 'Brand & era identification, Depop/eBay valuation, authentication risk, eBay listing.',
  },
];

type eBayConnectionStatus = 'idle' | 'authorizing' | 'polling' | 'connected' | 'error';

export default function OnboardingScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { showAlert } = useAlert();
  const { tenant, tenantLoading, reloadTenant, setActiveNiche, activeNicheId } = useApp();
  const { user } = useAuth();

  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);

  // Step 0: Niche selection
  const [selectedNiche, setSelectedNiche] = useState<NicheId>(
    (activeNicheId && activeNicheId !== 'general' ? activeNicheId : 'coins') as NicheId,
  );

  // Step 1: Business details
  const [businessName, setBusinessName] = useState('');
  const [currency, setCurrency] = useState('GBP');

  // Step 2: eBay connection
  const [ebayStatus, setEbayStatus] = useState<eBayConnectionStatus>('idle');
  const [ebayError, setEbayError] = useState<string | null>(null);
  const [pollCount, setPollCount] = useState(0);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Post-connection: listing count + import
  const [listingCount, setListingCount] = useState<number | null>(null);
  const [countLoading, setCountLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importDone, setImportDone] = useState(false);
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number } | null>(null);

  // Progress bar animation
  const progressAnim = useRef(new Animated.Value(0)).current;

  // Pre-fill business name
  useEffect(() => {
    if (user) {
      const name = user.username
        ? `${user.username}'s Store`
        : (user.email?.split('@')[0] ?? 'My') + "'s Store";
      setBusinessName(name);
    }
  }, [user?.id]);

  // Animate progress bar
  useEffect(() => {
    const pct = ((step + 1) / TOTAL_STEPS) * 100;
    Animated.timing(progressAnim, {
      toValue: pct,
      duration: 350,
      useNativeDriver: false,
    }).start();
  }, [step]);

  const stopPolling = useCallback(() => {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const checkEbayStatus = useCallback(async () => {
    if (!tenant?.id) return;
    const supabase = getSupabaseClient();
    const { data } = await supabase
      .from('marketplace_connectors')
      .select('status')
      .eq('tenant_id', tenant.id)
      .eq('marketplace_id', 'ebay')
      .maybeSingle();

    if (data?.status === 'connected') {
      setEbayStatus('connected');
      stopPolling();
      fetchEbayListingCount(tenant.id);
    }
  }, [tenant?.id, stopPolling]);

  const fetchEbayListingCount = useCallback(async (tenantId: string) => {
    setCountLoading(true);
    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase.functions.invoke('swish-ebay-browse', {
        body: { tenantId, route: 'count_active_listings' },
      });
      if (!error && data?.count != null) {
        setListingCount(data.count);
      } else {
        const { count } = await supabase
          .from('listings')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', tenantId)
          .eq('marketplace_id', 'ebay');
        setListingCount(count ?? 0);
      }
    } catch {
      setListingCount(0);
    } finally {
      setCountLoading(false);
    }
  }, []);

  const startPolling = useCallback(() => {
    setPollCount(0);
    setEbayStatus('polling');
    pollTimer.current = setInterval(async () => {
      setPollCount(n => n + 1);
      await checkEbayStatus();
    }, 3000);
  }, [checkEbayStatus]);

  // ── Step 0 → Step 1: save niche selection ────────────────────────────────

  const handleSaveStep0 = useCallback(() => {
    // Immediately commit the niche to AppContext (persists to AsyncStorage)
    setActiveNiche(selectedNiche);
    setStep(1);
  }, [selectedNiche, setActiveNiche]);

  // ── Step 1 → Step 2: save business details ────────────────────────────────

  const handleSaveStep1 = useCallback(async () => {
    if (!businessName.trim()) {
      showAlert('Store Name Required', 'Please enter a name for your store.');
      return;
    }
    setSaving(true);

    // Wait for tenant — retry up to 8s if still provisioning
    let activeTenant = tenant;
    if (!activeTenant) {
      for (let i = 0; i < 16; i++) {
        await new Promise(r => setTimeout(r, 500));
        await reloadTenant();
        break;
      }
      // Direct DB fallback
      try {
        const supabase = getSupabaseClient();
        const { data: memberships } = await supabase
          .from('tenant_memberships')
          .select('tenant_id')
          .eq('user_id', user?.id ?? '')
          .limit(1)
          .maybeSingle();
        if (memberships?.tenant_id) {
          const { data: t } = await supabase
            .from('tenants')
            .select('id, name, slug, subscription_tier, active_specialists, settings, created_at, updated_at')
            .eq('id', memberships.tenant_id)
            .maybeSingle();
          if (t) activeTenant = t as any;
        }
      } catch { /* non-blocking */ }
    }

    if (!activeTenant) {
      setSaving(false);
      showAlert('Account Not Ready', 'Your account is still being set up. Please wait a moment and try again.');
      return;
    }

    try {
      await upsertBusinessConfig(activeTenant.id, {
        currency,
        geography: currency === 'GBP' ? 'GB' : currency === 'USD' ? 'US' : 'EU',
        onboardingComplete: false,
        setupStep: 2,
      });
      const supabase = getSupabaseClient();
      await supabase.from('tenants').update({ name: businessName.trim() }).eq('id', activeTenant.id);
      await reloadTenant();
    } catch (e: any) {
      setSaving(false);
      showAlert('Save Failed', e?.message ?? 'Could not save store details. Please try again.');
      return;
    }

    setSaving(false);
    setStep(2);
  }, [businessName, currency, tenant, user?.id, showAlert, reloadTenant]);

  // ── Step 2: Connect eBay ──────────────────────────────────────────────────

  const handleConnectEbay = useCallback(async () => {
    if (!tenant?.id) return;
    setEbayError(null);
    setEbayStatus('authorizing');

    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase.functions.invoke('swish-ebay-oauth', {
        body: {
          action: 'start_subscriber_authorization',
          tenantId: tenant.id,
        },
      });

      if (error) {
        let msg = error.message;
        if (error instanceof FunctionsHttpError) {
          try { const t = await error.context?.text(); msg = t || msg; } catch {}
        }
        setEbayError(msg);
        setEbayStatus('error');
        return;
      }

      if (!data?.consentUrl) {
        setEbayError('Could not generate eBay authorisation link. Please try again.');
        setEbayStatus('error');
        return;
      }

      await Linking.openURL(data.consentUrl);
      startPolling();
    } catch (e: any) {
      setEbayError(e?.message ?? 'Unknown error');
      setEbayStatus('error');
    }
  }, [tenant, startPolling]);

  // ── Import listings ───────────────────────────────────────────────────────

  const handleImportListings = useCallback(async () => {
    if (!tenant?.id) return;
    setImporting(true);
    try {
      const supabase = getSupabaseClient();

      const { data: browseData, error: browseError } = await supabase.functions.invoke('swish-ebay-browse', {
        body: { tenantId: tenant.id, route: 'my_active_listings', limit: 400 },
      });

      if (browseError) {
        let msg = browseError.message;
        if (browseError instanceof FunctionsHttpError) {
          try { const t = await browseError.context?.text(); msg = t || msg; } catch {}
        }
        showAlert('Import Issue', `Could not fetch listings: ${msg}\n\nYou can import from eBay Hub after signing in.`);
        setImportDone(true);
        return;
      }

      const fetchedListings: any[] = browseData?.listings ?? [];
      if (fetchedListings.length === 0) {
        setImportResult({ imported: 0, skipped: 0 });
        setImportDone(true);
        return;
      }

      // Deduplicate against already-imported listings to prevent duplicates.
      // We check both external_listing_id (eBay item ID) to block exact re-imports.
      const { data: existingListings } = await supabase
        .from('listings')
        .select('external_listing_id')
        .eq('tenant_id', tenant.id)
        .eq('marketplace_id', 'ebay')
        .not('external_listing_id', 'is', null);

      const existingIds = new Set<string>(
        (existingListings ?? []).map((l: any) => l.external_listing_id).filter(Boolean),
      );

      // Resolve the subscriber's selected niche to a baseline NicheClassification
      // so the classification function can use it as a strong prior when a listing
      // cannot be classified from category/title evidence alone.
      type NicheClassification004 =
        | 'coins' | 'motocross' | 'bicycles' | 'clothing'
        | 'trading_cards' | 'antiques' | 'unclassified';

      const NICHE_TO_CLASSIFICATION: Record<NicheId, NicheClassification004> = {
        coins:        'coins',
        motocross:    'motocross',
        bicycles:     'bicycles',
        clothing:     'clothing',
        trading_cards:'trading_cards',
        antiques:     'antiques',
        fossils:      'unclassified',
        beauty:       'unclassified',
        general:      'unclassified',
      };

      const subscriberNicheClassification: NicheClassification004 =
        NICHE_TO_CLASSIFICATION[selectedNiche] ?? 'unclassified';

      let imported = 0;
      let skipped = 0;

      for (const listing of fetchedListings) {
        if (!listing.itemId || !listing.title) { skipped++; continue; }
        // Prevent duplicate imports — same eBay listing ID already in this tenant.
        if (existingIds.has(listing.itemId)) { skipped++; continue; }

        try {
          // ── Niche Classification ──────────────────────────────────────────
          // Priority order (highest confidence first):
          //   1. eBay category ID → nicheCategoryService.classifyListing()
          //   2. eBay category name → nicheCategoryService.classifyListing()
          //   3. Listing title pattern → nicheCategoryService.classifyListing()
          //   4. Subscriber's selected onboarding niche (used ONLY when the
          //      listing is 'unclassified' — prevents contamination of a coins
          //      subscriber's account with a stray bicycle listing they happened
          //      to sell once, while correctly assigning their own-niche items).
          //
          // If the listing is definitively classified as a DIFFERENT niche from
          // the subscriber's selection (e.g. a bike listing on a coins account),
          // the classification result is respected and 'curiosities_collectibles'
          // is used as the fallback specialist so the item is importable but
          // won't pollute the primary niche inventory view.

          const classification = classifyListing(
            listing.categoryId ?? listing.category_id ?? null,
            listing.categoryName ?? listing.category_name ?? null,
            listing.title,
            listing.description ?? null,
          );

          let resolvedNiche: NicheClassification004;

          // IMPORT SAFETY: onboarding import is scoped to the subscriber's selected
          // niche. Never assign an unclassified listing to the selected niche by
          // default: that caused unrelated items from a mixed eBay account to be
          // imported into (for example) Threads Flip.
          if (classification.niche === 'unclassified') {
            skipped++;
            continue;
          }
          if (classification.niche !== subscriberNicheClassification) {
            skipped++;
            continue;
          }
          resolvedNiche = classification.niche as NicheClassification004;

          // Map NicheClassification → SpecialistId
          const specialistId: SpecialistId = resolvedNiche === 'unclassified'
            ? 'curiosities_collectibles'
            : nicheToSpecialistId(resolvedNiche as any) as SpecialistId;

          // Identification confidence reflects classification quality:
          //   category_id evidence → 0.85 (reliable)
          //   category_name evidence → 0.75
          //   title pattern (high) → 0.65
          //   title pattern (medium) → 0.55
          //   subscriber niche fallback → 0.45
          //   unclassified → 0.30
          const CONFIDENCE_MAP: Record<string, number> = {
            category_id:     0.85,
            category_name:   0.75,
            title_high:      0.65,
            title_medium:    0.55,
          };
          const classificationConfidence = CONFIDENCE_MAP[classification.confidence]
            ?? (resolvedNiche !== 'unclassified' ? 0.45 : 0.30);

          const { data: itemRow, error: itemErr } = await supabase
            .from('items')
            .insert({
              tenant_id: tenant.id,
              canonical_title: listing.title.slice(0, 200),
              description: listing.description ?? '',
              specialist_id: specialistId,
              status: listing.ebayStatus === 'sold' ? 'sold' : 'listed',
              identification_source: 'user_confirmed',
              identification_confidence: classificationConfidence,
              expected_selling_price: listing.price ?? 0,
              media: listing.photos ?? (listing.galleryUrl ? [listing.galleryUrl] : []),
              inventory_origin: 'ebay_import',
              // Store classification metadata in attributes for traceability
              attributes: {
                ebay_category_id: listing.categoryId ?? listing.category_id ?? null,
                ebay_category_name: listing.categoryName ?? listing.category_name ?? null,
                classification_niche: resolvedNiche,
                classification_confidence: classification.confidence,
                classification_reason: classification.reason,
              },
            })
            .select('id')
            .single();

          if (itemErr) { skipped++; continue; }

          await supabase.from('listings').insert({
            tenant_id: tenant.id,
            item_id: itemRow.id,
            marketplace_id: 'ebay',
            external_listing_id: listing.itemId,
            title: listing.title.slice(0, 200),
            description: listing.description ?? '',
            price: listing.price ?? 0,
            floor_price: 0,
            ceiling_price: 0,
            shipping_cost: 0,
            status: listing.ebayStatus === 'sold' ? 'sold' : 'active',
            published_at: listing.listedAt ?? new Date().toISOString(),
            ended_at: listing.endedAt ?? null,
            import_source: 'onboarding_import',
            // Store eBay category for later use in listing submission
            category_id: listing.categoryId ?? listing.category_id ?? null,
          });

          existingIds.add(listing.itemId);
          imported++;
        } catch { skipped++; }
      }

      setImportResult({ imported, skipped });
      setImportDone(true);
    } catch (e: any) {
      showAlert('Import Failed', e?.message ?? 'Unknown error');
      setImportDone(true);
    } finally {
      setImporting(false);
    }
  }, [tenant?.id, selectedNiche, showAlert]);

  // ── Complete onboarding — route to correct niche entry point ──────────────

  const handleFinish = useCallback(async () => {
    if (!tenant) return;
    setSaving(true);
    await upsertBusinessConfig(tenant.id, {
      onboardingComplete: true,
      setupStep: TOTAL_STEPS,
    });
    setSaving(false);
    // Route via the explicit niche entry route, not directly to /(tabs)
    const entryRoute = nicheToEntryRoute(selectedNiche);
    router.replace(entryRoute as any);
  }, [tenant, router, selectedNiche]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={s.header}>
        <View style={s.logoRow}>
          <View style={s.logo}>
            <MaterialIcons name="storefront" size={20} color={Colors.background} />
          </View>
          <View>
            <Text style={s.appName}>SWISH</Text>
            <Text style={s.tagline}>eBay Seller Platform</Text>
          </View>
        </View>
        <View style={s.stepPill}>
          <Text style={s.stepPillText}>Step {step + 1} of {TOTAL_STEPS}</Text>
        </View>
      </View>

      {/* Step dots */}
      <View style={s.stepDotsRow}>
        {STEP_LABELS.map((label, i) => {
          const isCompleted = i < step;
          const isCurrent   = i === step;
          return (
            <React.Fragment key={i}>
              <View style={s.stepDotWrap}>
                <View style={[s.stepDot, isCompleted && s.stepDotCompleted, isCurrent && s.stepDotCurrent]}>
                  {isCompleted
                    ? <MaterialIcons name="check" size={10} color={Colors.background} />
                    : <Text style={[s.stepDotNum, isCurrent && { color: Colors.background }]}>{i + 1}</Text>
                  }
                </View>
                <Text style={[
                  s.stepDotLabel,
                  isCurrent && { color: Colors.primary, fontWeight: Typography.weight.semibold },
                  isCompleted && { color: Colors.success },
                ]}>{label}</Text>
              </View>
              {i < STEP_LABELS.length - 1 ? (
                <View style={[s.stepConnector, isCompleted && s.stepConnectorDone]} />
              ) : null}
            </React.Fragment>
          );
        })}
      </View>

      {/* Progress bar */}
      <View style={s.progressTrack}>
        <Animated.View style={[
          s.progressFill,
          { width: progressAnim.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] }) },
        ]} />
      </View>

      <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 120 }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >

          {/* ── Step 0: Niche Selection ──────────────────────────────── */}
          {step === 0 ? (
            <View style={s.stepContent}>
              <View style={[s.stepIcon, { backgroundColor: Colors.primaryDim }]}>
                <MaterialIcons name="category" size={32} color={Colors.primary} />
              </View>
              <Text style={s.stepTitle}>Choose Your Trading Niche</Text>
              <Text style={s.stepDesc}>
                Select the type of items you buy and sell. This determines your app experience — SWISH will show you the right identification, valuation, and listing tools for your niche.
              </Text>

              <View style={s.nicheGrid}>
                {ONBOARDING_NICHES.map(niche => {
                  const isSelected = selectedNiche === niche.id;
                  return (
                    <Pressable
                      key={niche.id}
                      onPress={() => setSelectedNiche(niche.id)}
                      style={({ pressed }) => [
                        s.nicheCard,
                        isSelected && { borderColor: niche.color, borderWidth: 2, backgroundColor: niche.color + '10' },
                        pressed && { opacity: 0.88, transform: [{ scale: 0.98 }] },
                      ]}
                    >
                      <View style={[s.nicheIcon, { backgroundColor: niche.color + '20' }]}>
                        <MaterialIcons name={niche.icon as any} size={28} color={niche.color} />
                      </View>
                      <View style={s.nicheInfo}>
                        <Text style={[s.nicheName, isSelected && { color: niche.color }]}>
                          {niche.name}
                        </Text>
                        <Text style={s.nicheTagline}>{niche.tagline}</Text>
                        <Text style={s.nicheDesc} numberOfLines={2}>{niche.description}</Text>
                      </View>
                      {isSelected ? (
                        <MaterialIcons name="check-circle" size={22} color={niche.color} />
                      ) : (
                        <MaterialIcons name="radio-button-unchecked" size={22} color={Colors.textTertiary} />
                      )}
                    </Pressable>
                  );
                })}
              </View>

              <View style={s.infoCard}>
                <MaterialIcons name="info-outline" size={14} color={Colors.info} />
                <Text style={s.infoText}>
                  You can switch niche at any time from Settings. Your inventory, eBay integration, and data are shared across all niches.
                </Text>
              </View>
            </View>
          ) : null}

          {/* ── Step 1: Store Details ──────────────────────────────── */}
          {step === 1 ? (
            <View style={s.stepContent}>
              <View style={[s.stepIcon, { backgroundColor: Colors.primaryDim }]}>
                <MaterialIcons name="business" size={32} color={Colors.primary} />
              </View>
              <Text style={s.stepTitle}>Your Store Details</Text>
              <Text style={s.stepDesc}>
                Tell SWISH about your eBay selling operation. You can update these anytime in Settings.
              </Text>

              <View style={s.field}>
                <Text style={s.fieldLabel}>Store / Business Name</Text>
                <TextInput
                  style={s.input}
                  value={businessName}
                  onChangeText={setBusinessName}
                  placeholder="e.g. KeenOnCoins, Sarah's Collectibles"
                  placeholderTextColor={Colors.textTertiary}
                  autoFocus
                  returnKeyType="done"
                />
              </View>

              <View style={s.field}>
                <Text style={s.fieldLabel}>Currency</Text>
                <View style={s.currencyRow}>
                  {[
                    { code: 'GBP', label: '£ GBP', flag: '🇬🇧' },
                    { code: 'USD', label: '$ USD', flag: '🇺🇸' },
                    { code: 'EUR', label: '€ EUR', flag: '🇪🇺' },
                  ].map(c => (
                    <Pressable
                      key={c.code}
                      onPress={() => setCurrency(c.code)}
                      style={[s.currencyChip, currency === c.code && s.currencyChipActive]}
                    >
                      <Text style={s.currencyFlag}>{c.flag}</Text>
                      <Text style={[s.currencyLabel, currency === c.code && { color: Colors.primary }]}>
                        {c.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                <Text style={s.fieldHint}>
                  UK sellers default to GBP — this affects how prices are displayed.
                </Text>
              </View>

              <View style={s.infoCard}>
                <MaterialIcons name="info-outline" size={14} color={Colors.info} />
                <Text style={s.infoText}>
                  That's all we need for now. Capital targets, risk settings, and automation can be configured later in Settings.
                </Text>
              </View>
            </View>
          ) : null}

          {/* ── Step 2: Connect eBay ───────────────────────────────── */}
          {step === 2 ? (
            <View style={s.stepContent}>
              <View style={[s.stepIcon, { backgroundColor: '#E5323815' }]}>
                <MaterialIcons name="storefront" size={32} color="#E53238" />
              </View>
              <Text style={s.stepTitle}>Connect Your eBay Account</Text>
              <Text style={s.stepDesc}>
                SWISH needs permission to access your eBay selling account so it can sync your listings, orders, and selling information.
              </Text>

              {/* Connected state */}
              {ebayStatus === 'connected' ? (
                <View style={s.connectedCard}>
                  <View style={s.connectedIconWrap}>
                    <MaterialIcons name="check-circle" size={40} color={Colors.success} />
                  </View>
                  <Text style={s.connectedTitle}>eBay Connected ✓</Text>
                  <Text style={s.connectedDesc}>
                    Your eBay seller account is now linked to SWISH.
                  </Text>
                  <View style={s.capGrid}>
                    {[
                      { icon: 'list-alt', label: 'Sync listings' },
                      { icon: 'publish', label: 'Create & publish' },
                      { icon: 'receipt-long', label: 'Read orders' },
                      { icon: 'price-change', label: 'Repricing' },
                      { icon: 'local-shipping', label: 'Fulfilment' },
                      { icon: 'sync', label: 'Auto-sync' },
                    ].map(cap => (
                      <View key={cap.label} style={s.capItem}>
                        <MaterialIcons name={cap.icon as any} size={14} color={Colors.success} />
                        <Text style={s.capLabel}>{cap.label}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              ) : null}

              {/* Import listings CTA */}
              {ebayStatus === 'connected' && !importDone ? (
                <View style={s.importCard}>
                  {countLoading ? (
                    <View style={s.importCountRow}>
                      <ActivityIndicator size="small" color={Colors.primary} />
                      <Text style={s.importCountText}>Checking your eBay listings...</Text>
                    </View>
                  ) : listingCount != null && listingCount > 0 ? (
                    <>
                      <View style={s.importFoundRow}>
                        <View style={[s.importFoundIconWrap, { backgroundColor: Colors.primaryDim }]}>
                          <MaterialIcons name="list-alt" size={22} color={Colors.primary} />
                        </View>
                        <View style={s.importFoundText}>
                          <Text style={s.importFoundCount}>
                            {listingCount} eBay listing{listingCount === 1 ? '' : 's'} found in your seller account
                          </Text>
                          <Text style={s.importFoundSub}>
                            Only listings classified as {ONBOARDING_NICHES.find(n => n.id === selectedNiche)?.name ?? 'your selected niche'} will be imported. Unrelated or unclassified listings are skipped.
                          </Text>
                        </View>
                      </View>
                      <Pressable
                        onPress={handleImportListings}
                        disabled={importing}
                        style={({ pressed }) => [s.importNowBtn, pressed && { opacity: 0.88 }]}
                      >
                        {importing
                          ? <ActivityIndicator size="small" color={Colors.background} />
                          : <MaterialIcons name="cloud-download" size={18} color={Colors.background} />
                        }
                        <Text style={s.importNowBtnText}>
                          {importing ? 'Importing...' : 'Import Matching Listings'}
                        </Text>
                      </Pressable>
                      <Pressable onPress={() => setImportDone(true)} style={s.importSkipBtn}>
                        <Text style={s.importSkipBtnText}>Not now — I will import later from eBay Hub</Text>
                      </Pressable>
                    </>
                  ) : (
                    <View style={s.importNoneRow}>
                      <MaterialIcons name="inventory" size={18} color={Colors.textTertiary} />
                      <Text style={s.importNoneText}>
                        No existing eBay listings found — you can start adding items from the Inventory screen.
                      </Text>
                    </View>
                  )}
                </View>
              ) : null}

              {/* Import success */}
              {ebayStatus === 'connected' && importDone && importResult ? (
                <View style={s.importSuccessCard}>
                  <MaterialIcons name="check-circle" size={20} color={Colors.success} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.importSuccessTitle}>
                      {importResult.imported > 0
                        ? `${importResult.imported} listing${importResult.imported === 1 ? '' : 's'} imported`
                        : 'Listings already up to date'}
                    </Text>
                    {importResult.skipped > 0 ? (
                      <Text style={s.importSuccessSub}>{importResult.skipped} skipped (already in SWISH)</Text>
                    ) : null}
                  </View>
                </View>
              ) : null}

              {/* Polling state */}
              {ebayStatus === 'polling' ? (
                <View style={s.pollingCard}>
                  <ActivityIndicator size="large" color="#E53238" />
                  <Text style={s.pollingTitle}>Waiting for eBay Authorisation</Text>
                  <Text style={s.pollingDesc}>
                    Complete the authorisation in your browser. SWISH is checking automatically ({pollCount} checks).
                  </Text>
                  <Pressable onPress={checkEbayStatus} style={s.checkNowBtn}>
                    <MaterialIcons name="refresh" size={14} color={Colors.primary} />
                    <Text style={s.checkNowText}>Check Now</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => { stopPolling(); setEbayStatus('idle'); setEbayError(null); }}
                    style={s.retryLink}
                  >
                    <Text style={s.retryLinkText}>Cancel and try again</Text>
                  </Pressable>
                </View>
              ) : null}

              {/* Error state */}
              {ebayStatus === 'error' && ebayError ? (
                <View style={s.errorCard}>
                  <MaterialIcons name="error-outline" size={16} color={Colors.danger} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.errorText}>{ebayError}</Text>
                    <Pressable
                      onPress={() => { setEbayStatus('idle'); setEbayError(null); }}
                      style={[s.retryLink, { marginTop: 8 }]}
                    >
                      <Text style={[s.retryLinkText, { color: Colors.primary }]}>Try again</Text>
                    </Pressable>
                  </View>
                </View>
              ) : null}

              {/* Idle: show Connect eBay button */}
              {(ebayStatus === 'idle' || ebayStatus === 'authorizing') ? (
                <>
                  <View style={s.permCard}>
                    <Text style={s.permCardTitle}>SWISH will be able to</Text>
                    {[
                      { icon: 'list-alt', text: 'View and manage your eBay listings' },
                      { icon: 'receipt-long', text: 'Read your orders and selling activity' },
                      { icon: 'price-change', text: 'Update listing prices and descriptions' },
                      { icon: 'local-shipping', text: 'Mark orders as despatched' },
                    ].map((item, i) => (
                      <View key={i} style={s.permRow}>
                        <View style={s.permIconWrap}>
                          <MaterialIcons name={item.icon as any} size={14} color={Colors.primary} />
                        </View>
                        <Text style={s.permText}>{item.text}</Text>
                      </View>
                    ))}
                  </View>

                  <Pressable
                    onPress={handleConnectEbay}
                    disabled={ebayStatus === 'authorizing'}
                    style={({ pressed }) => [
                      s.connectEbayBtn,
                      pressed && { opacity: 0.9 },
                      ebayStatus === 'authorizing' && { opacity: 0.7 },
                    ]}
                  >
                    {ebayStatus === 'authorizing'
                      ? <ActivityIndicator size="small" color={Colors.background} />
                      : <MaterialIcons name="storefront" size={20} color={Colors.background} />
                    }
                    <Text style={s.connectEbayBtnText}>
                      {ebayStatus === 'authorizing' ? 'Opening eBay...' : 'Connect eBay'}
                    </Text>
                  </Pressable>

                  <View style={s.privacyNote}>
                    <MaterialIcons name="lock" size={12} color={Colors.textTertiary} />
                    <Text style={s.privacyNoteText}>
                      You will be redirected to eBay to sign in and authorise SWISH. Your eBay password is never shared with SWISH.
                    </Text>
                  </View>
                </>
              ) : null}

              {/* Skip for now */}
              {ebayStatus !== 'connected' && ebayStatus !== 'polling' ? (
                <Pressable onPress={handleFinish} style={s.skipBtn}>
                  <Text style={s.skipBtnText}>Skip for now — I'll connect eBay later</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}

        </ScrollView>
      </KeyboardAvoidingView>

      {/* Bottom nav */}
      <View style={[s.navBar, { paddingBottom: insets.bottom + Spacing.md }]}>
        {step > 0 && ebayStatus !== 'connected' ? (
          <Pressable onPress={() => setStep(prev => prev - 1)} style={s.backBtn} hitSlop={8}>
            <MaterialIcons name="arrow-back" size={18} color={Colors.textSecondary} />
            <Text style={s.backBtnText}>Back</Text>
          </Pressable>
        ) : <View style={s.backBtnPlaceholder} />}

        {step === 0 ? (
          <Pressable
            onPress={handleSaveStep0}
            style={s.nextBtn}
          >
            <Text style={s.nextBtnText}>Continue</Text>
            <MaterialIcons name="arrow-forward" size={18} color={Colors.background} />
          </Pressable>
        ) : step === 1 ? (
          <Pressable
            onPress={handleSaveStep1}
            disabled={saving || tenantLoading}
            style={[s.nextBtn, (saving || tenantLoading) && { opacity: 0.7 }]}
          >
            {(saving || tenantLoading)
              ? <>
                  <ActivityIndicator size="small" color={Colors.background} />
                  <Text style={s.nextBtnText}>{tenantLoading ? 'Setting up...' : 'Saving...'}</Text>
                </>
              : <>
                  <Text style={s.nextBtnText}>Continue</Text>
                  <MaterialIcons name="arrow-forward" size={18} color={Colors.background} />
                </>
            }
          </Pressable>
        ) : ebayStatus === 'connected' &&
          (importDone || (listingCount != null && listingCount === 0) || (!countLoading && listingCount === null)) ? (
          <Pressable
            onPress={handleFinish}
            disabled={saving || importing}
            style={[s.nextBtn, { backgroundColor: Colors.success }, (saving || importing) && { opacity: 0.7 }]}
          >
            {saving
              ? <ActivityIndicator size="small" color={Colors.background} />
              : <>
                  <Text style={s.nextBtnText}>Start Selling</Text>
                  <MaterialIcons name="rocket-launch" size={18} color={Colors.background} />
                </>
            }
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.base, paddingVertical: Spacing.md, gap: Spacing.sm,
  },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  logo: {
    width: 38, height: 38, borderRadius: Radius.md,
    backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center',
  },
  appName: { fontSize: Typography.size.md, fontWeight: Typography.weight.extrabold, color: Colors.textPrimary, letterSpacing: 1 },
  tagline: { fontSize: Typography.size.xs, color: Colors.textTertiary },
  stepPill: {
    backgroundColor: Colors.primaryDim, borderRadius: Radius.pill,
    paddingHorizontal: Spacing.sm, paddingVertical: 3,
    borderWidth: 1, borderColor: Colors.primary + '40',
  },
  stepPillText: { fontSize: 10, fontWeight: Typography.weight.bold, color: Colors.primary },

  stepDotsRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: Spacing.xl, paddingVertical: Spacing.md,
  },
  stepDotWrap: { alignItems: 'center', gap: 5 },
  stepDot: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: Colors.surfaceHighlight, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: Colors.surfaceBorder,
  },
  stepDotCurrent: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  stepDotCompleted: { backgroundColor: Colors.success, borderColor: Colors.success },
  stepDotNum: { fontSize: 10, fontWeight: Typography.weight.bold, color: Colors.textTertiary },
  stepDotLabel: { fontSize: 10, color: Colors.textTertiary, textAlign: 'center' },
  stepConnector: {
    flex: 1, height: 2, backgroundColor: Colors.surfaceBorder,
    marginHorizontal: Spacing.xs, marginBottom: 14,
    borderRadius: Radius.pill,
  },
  stepConnectorDone: { backgroundColor: Colors.success },

  progressTrack: { height: 3, backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.pill },
  progressFill: { height: '100%' as any, backgroundColor: Colors.primary, borderRadius: Radius.pill },

  content: { padding: Spacing.base, gap: Spacing.xl },
  stepContent: { gap: Spacing.lg },
  stepIcon: {
    width: 64, height: 64, borderRadius: Radius.xl,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.surfaceBorder,
    alignSelf: 'flex-start',
  },
  stepTitle: { fontSize: Typography.size.xl, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  stepDesc: { fontSize: Typography.size.sm, color: Colors.textSecondary, lineHeight: 22 },

  // Niche selection grid
  nicheGrid: { gap: Spacing.sm },
  nicheCard: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.surface, borderRadius: Radius.xl,
    borderWidth: 1.5, borderColor: Colors.surfaceBorder,
    padding: Spacing.md, ...Shadow.sm,
  },
  nicheIcon: {
    width: 52, height: 52, borderRadius: Radius.lg,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  nicheInfo: { flex: 1, gap: 2 },
  nicheName: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  nicheTagline: { fontSize: Typography.size.xs, color: Colors.textTertiary, lineHeight: 15 },
  nicheDesc: { fontSize: 10, color: Colors.textTertiary, lineHeight: 14, marginTop: 2 },

  field: { gap: Spacing.sm },
  fieldLabel: { fontSize: Typography.size.xs, fontWeight: Typography.weight.semibold, color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 },
  fieldHint: { fontSize: Typography.size.xs, color: Colors.textTertiary, lineHeight: 16 },
  input: {
    backgroundColor: Colors.surface, borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.surfaceBorder,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.md,
    fontSize: Typography.size.base, color: Colors.textPrimary,
    includeFontPadding: false,
  },

  currencyRow: { flexDirection: 'row', gap: Spacing.sm },
  currencyChip: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.xs,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    backgroundColor: Colors.surface, borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.surfaceBorder,
  },
  currencyChipActive: { backgroundColor: Colors.primaryDim, borderColor: Colors.primary },
  currencyFlag: { fontSize: 16 },
  currencyLabel: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.textSecondary },

  infoCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm,
    backgroundColor: Colors.infoDim, borderRadius: Radius.xl, padding: Spacing.md,
    borderWidth: 1, borderColor: Colors.info + '30',
  },
  infoText: { flex: 1, fontSize: Typography.size.xs, color: Colors.textSecondary, lineHeight: 17 },

  permCard: {
    backgroundColor: Colors.surface, borderRadius: Radius.xl, padding: Spacing.base,
    borderWidth: 1, borderColor: Colors.surfaceBorder, gap: Spacing.sm,
  },
  permCardTitle: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.textPrimary, marginBottom: 4 },
  permRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  permIconWrap: {
    width: 26, height: 26, borderRadius: Radius.sm,
    backgroundColor: Colors.primaryDim, alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  permText: { flex: 1, fontSize: Typography.size.sm, color: Colors.textSecondary, lineHeight: 19 },

  connectEbayBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm,
    backgroundColor: '#E53238', borderRadius: Radius.md,
    paddingVertical: Spacing.base, paddingHorizontal: Spacing.xl,
    ...Shadow.md,
  },
  connectEbayBtnText: { fontSize: Typography.size.base, fontWeight: Typography.weight.bold, color: Colors.background },

  privacyNote: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.xs,
    paddingHorizontal: Spacing.sm,
  },
  privacyNoteText: { flex: 1, fontSize: 11, color: Colors.textTertiary, lineHeight: 16 },

  connectedCard: {
    backgroundColor: Colors.successDim, borderRadius: Radius.xxl, padding: Spacing.xl,
    borderWidth: 1, borderColor: Colors.success + '40',
    alignItems: 'center', gap: Spacing.md,
  },
  connectedIconWrap: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center',
  },
  connectedTitle: { fontSize: Typography.size.xl, fontWeight: Typography.weight.bold, color: Colors.success },
  connectedDesc: { fontSize: Typography.size.sm, color: Colors.textSecondary, textAlign: 'center', lineHeight: 20 },
  capGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs, justifyContent: 'center' },
  capItem: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.surface, borderRadius: Radius.pill,
    paddingHorizontal: Spacing.sm, paddingVertical: Spacing.xs,
  },
  capLabel: { fontSize: 10, color: Colors.success, fontWeight: Typography.weight.semibold },

  importCard: {
    backgroundColor: Colors.surface, borderRadius: Radius.xxl,
    borderWidth: 1, borderColor: Colors.surfaceBorder,
    padding: Spacing.base, gap: Spacing.md, ...Shadow.sm,
  },
  importCountRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm },
  importCountText: { fontSize: Typography.size.sm, color: Colors.textSecondary },
  importFoundRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md },
  importFoundIconWrap: {
    width: 48, height: 48, borderRadius: Radius.xl,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    borderWidth: 1, borderColor: Colors.primary + '30',
  },
  importFoundText: { flex: 1, gap: 4 },
  importFoundCount: { fontSize: Typography.size.md, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  importFoundSub: { fontSize: Typography.size.xs, color: Colors.textSecondary, lineHeight: 16 },
  importNowBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm,
    backgroundColor: Colors.primary, borderRadius: Radius.md,
    paddingVertical: Spacing.base, ...Shadow.glow,
  },
  importNowBtnText: { fontSize: Typography.size.base, fontWeight: Typography.weight.bold, color: Colors.background },
  importSkipBtn: { alignItems: 'center', paddingVertical: Spacing.xs },
  importSkipBtnText: { fontSize: Typography.size.xs, color: Colors.textTertiary, textDecorationLine: 'underline' },
  importNoneRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm,
    backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.md, padding: Spacing.md,
  },
  importNoneText: { flex: 1, fontSize: Typography.size.xs, color: Colors.textSecondary, lineHeight: 17 },
  importSuccessCard: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.successDim, borderRadius: Radius.xl, padding: Spacing.md,
    borderWidth: 1, borderColor: Colors.success + '40',
  },
  importSuccessTitle: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.success },
  importSuccessSub: { fontSize: Typography.size.xs, color: Colors.textSecondary, marginTop: 2 },

  pollingCard: {
    backgroundColor: Colors.surface, borderRadius: Radius.xxl, padding: Spacing.xl,
    borderWidth: 1, borderColor: '#E5323830',
    alignItems: 'center', gap: Spacing.md,
  },
  pollingTitle: { fontSize: Typography.size.lg, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  pollingDesc: { fontSize: Typography.size.sm, color: Colors.textSecondary, textAlign: 'center', lineHeight: 20 },
  checkNowBtn: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.xs,
    backgroundColor: Colors.primaryDim, borderRadius: Radius.md,
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm,
    borderWidth: 1, borderColor: Colors.primary + '40',
  },
  checkNowText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.primary },

  errorCard: {
    backgroundColor: Colors.dangerDim, borderRadius: Radius.xl, padding: Spacing.md,
    borderWidth: 1, borderColor: Colors.danger + '30',
    flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start',
  },
  errorText: { fontSize: Typography.size.xs, color: Colors.danger, lineHeight: 17, flex: 1 },

  retryLink: { paddingVertical: Spacing.xs },
  retryLinkText: { fontSize: Typography.size.xs, color: Colors.textTertiary, textDecorationLine: 'underline', textAlign: 'center' },

  skipBtn: { paddingVertical: Spacing.md, alignItems: 'center' },
  skipBtnText: { fontSize: Typography.size.sm, color: Colors.textTertiary, textDecorationLine: 'underline' },

  navBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.base, paddingTop: Spacing.md,
    borderTopWidth: 1, borderTopColor: Colors.surfaceBorder,
    backgroundColor: Colors.background, gap: Spacing.md,
  },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, paddingHorizontal: Spacing.sm, paddingVertical: Spacing.sm },
  backBtnText: { fontSize: Typography.size.sm, color: Colors.textSecondary },
  backBtnPlaceholder: { width: 80 },
  nextBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: Spacing.sm, backgroundColor: Colors.primary,
    borderRadius: Radius.md, paddingVertical: Spacing.base, ...Shadow.glow,
  },
  nextBtnText: { fontSize: Typography.size.base, fontWeight: Typography.weight.bold, color: Colors.background },
});
