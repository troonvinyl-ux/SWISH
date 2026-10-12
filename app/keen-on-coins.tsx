// KeenOnCoins — Dedicated coin scanner entry point
//
// ARCHITECTURE NOTE:
// KeenOnCoins is a PRESENTATION-LAYER wrapper around the shared SWISH engine.
// It does NOT contain its own AI identification or valuation logic.
// ALL intelligence calls go through the identical shared services:
//   - identifyItemWithAI()    → swish-identify edge function
//   - getMarketValue()        → swish-market-value edge function
//   - saveIdentifiedItem()    → canonical items table
//   - uploadItemImages()      → item-images Supabase Storage bucket
//
// The coins specialist, Numista verification, eBay visual search, and all
// backend services are IDENTICAL to those used by the SWISH coin scanner.
// One engine. One database. One set of images. No duplication.

import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, Pressable, ScrollView,
  TextInput, ActivityIndicator, Linking, Alert, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Colors, Typography, Spacing, Radius, Shadow } from '@/constants/theme';
import { getSupabaseClient } from '@/template';
import { useApp } from '@/hooks/useApp';
import { useAlert } from '@/template';
import { IS_TV } from '@/hooks/useTVNavigation';
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
import { getMarketValue, MarketValueResult } from '@/services/marketValueService';
import { searchEbayByImage, EbayVisualSearchResult, formatAskingPriceRange } from '@/services/ebayVisualSearchService';
import { recordAIFeedback, FeedbackVerdict } from '@/services/aiLearningService';
import { recordPrediction } from '@/services/predictionService';
import { CONFIDENCE_THRESHOLDS } from '@/constants/config';
import { SPECIALISTS } from '@/constants/specialists';

// ── KeenOnCoins brand colours ─────────────────────────────────────────────────
const KOC = {
  gold: '#F5C842',
  goldDim: '#2A2000',
  goldBright: '#FFD700',
  bronze: '#CD7F32',
  silver: '#C0C0C0',
  dark: '#0D0C08',
  surface: '#14130D',
  surfaceBorder: '#2A2510',
};

// ── Coin capture slots — always 4 structured slots ───────────────────────────
const COIN_SLOTS = [
  { id: 'obverse', label: 'Obverse', hint: 'Head / front face — fill the frame', required: true },
  { id: 'reverse', label: 'Reverse', hint: 'Tail / back face', required: true },
  { id: 'edge',    label: 'Edge',    hint: 'Milled or lettered edge', required: false },
  { id: 'detail',  label: 'Detail',  hint: 'Inscription, date, or damage close-up', required: false },
];

type KOCStep = 'home' | 'capture' | 'processing' | 'measure' | 'review';

const CONFIDENCE_COLOR = (c: number) => {
  if (c >= 0.85) return Colors.success;
  if (c >= 0.65) return Colors.warning;
  return Colors.danger;
};

// ── Compact measurement comparison ───────────────────────────────────────────
function matchGrade(diff: number, threshold1: number, threshold2: number, threshold3: number): 'strong' | 'moderate' | 'weak' | 'contradiction' {
  if (diff <= threshold1) return 'strong';
  if (diff <= threshold2) return 'moderate';
  if (diff <= threshold3) return 'weak';
  return 'contradiction';
}

export default function KeenOnCoinsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { tenant, setScanMode } = useApp();
  const { showAlert } = useAlert();

  const [step, setStep] = useState<KOCStep>('home');
  const [captureMethod, setCaptureMethod] = useState<'camera' | 'library'>('camera');
  const [capturedImages, setCapturedImages] = useState<CapturedImage[]>([]);
  const [processingStatus, setProcessingStatus] = useState('');
  const [idResult, setIdResult] = useState<AIIdentificationResult | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  // Save state
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const [savedItemId, setSavedItemId] = useState<string | null>(null);
  const [feedbackVerdict, setFeedbackVerdict] = useState<FeedbackVerdict | null>(null);
  const [feedbackSaving, setFeedbackSaving] = useState(false);

  // Physical measurement verification
  const [measureWeight, setMeasureWeight] = useState('');
  const [measureDiameter, setMeasureDiameter] = useState('');
  const [measureChecking, setMeasureChecking] = useState(false);
  const [measureResult, setMeasureResult] = useState<{
    weightMatch: string; diameterMatch: string;
    catWeight?: number; catDiameter?: number; notes: string[];
  } | null>(null);

  // Market valuation
  const [valuationResult, setValuationResult] = useState<MarketValueResult | null>(null);
  const [valuationLoading, setValuationLoading] = useState(false);
  const [valuationError, setValuationError] = useState<string | null>(null);

  // eBay visual search
  const [ebayVisualResult, setEbayVisualResult] = useState<EbayVisualSearchResult | null>(null);
  const [ebayVisualLoading, setEbayVisualLoading] = useState(false);
  const [ebayExpanded, setEbayExpanded] = useState(false);

  const coinsSpecialist = SPECIALISTS['coins'];

  // ── Entitlement check ─────────────────────────────────────────────────────
  // active_specialists = [] means all niches are available (default for new tenants).
  // If explicitly set and does not include 'coins', the tenant has not subscribed.
  const isEntitled = !tenant ||
    (tenant as any).active_specialists == null ||
    (tenant as any).active_specialists.length === 0 ||
    (tenant as any).active_specialists.includes('coins');

  // ── Auto-fetch valuation + eBay visual search on entering review ──────────
  useEffect(() => {
    if (step !== 'review' || !idResult || !tenant) return;

    // eBay visual search
    const primaryImage = capturedImages[0]?.uri;
    if (primaryImage) {
      setEbayVisualLoading(true);
      setEbayVisualResult(null);
      searchEbayByImage({
        tenantId: tenant.id,
        imageDataUri: primaryImage.startsWith('data:') ? primaryImage : undefined,
        imageBase64: !primaryImage.startsWith('data:') && !primaryImage.startsWith('http') ? primaryImage : undefined,
        limit: 5,
      }).then(r => { setEbayVisualResult(r); setEbayVisualLoading(false); });
    }

    // Market valuation — only fetch once
    if (valuationResult || valuationLoading) return;
    if (!idResult.canonicalTitle || idResult.canonicalTitle.length < 3) return;

    setValuationLoading(true);
    setValuationError(null);
    getMarketValue({
      tenantId: tenant.id,
      title: idResult.canonicalTitle,
      specialistId: 'coins',
      attributes: idResult.attributes ?? {},
      condition: idResult.condition ?? '',
      identificationConfidence: idResult.confidence ?? 0,
      identificationTier: idResult.confidenceTier ?? 'medium',
      numistaTypeId: idResult.numistaVerification?.typeId ? Number(idResult.numistaVerification.typeId) : null,
      numistaMatchScore: idResult.numistaMatchScore ?? 0,
      numistaMatchTier: idResult.numistaStatus ?? 'no_match',
      applyToItem: false,
    }).then(({ result, error }) => {
      setValuationLoading(false);
      if (error || !result) setValuationError(error ?? 'Valuation unavailable');
      else setValuationResult(result);
    });
  }, [step, idResult, tenant]);

  // ── Reset ─────────────────────────────────────────────────────────────────
  const handleReset = useCallback(() => {
    setStep('home');
    setCapturedImages([]);
    setProcessingStatus('');
    setIdResult(null);
    setAiError(null);
    setSavedItemId(null);
    setIsUploading(false);
    setUploadProgress('');
    setFeedbackVerdict(null);
    setFeedbackSaving(false);
    setMeasureWeight('');
    setMeasureDiameter('');
    setMeasureChecking(false);
    setMeasureResult(null);
    setValuationResult(null);
    setValuationLoading(false);
    setValuationError(null);
    setEbayVisualResult(null);
    setEbayVisualLoading(false);
    setEbayExpanded(false);
    setScanMode('idle');
  }, [setScanMode]);

  // ── Image capture ─────────────────────────────────────────────────────────
  const handleCaptureSlot = useCallback(async (slotId: string, slotLabel: string) => {
    let image: CapturedImage | null = null;
    if (captureMethod === 'camera') {
      image = await captureFromCamera();
    } else {
      image = await pickFromLibrary(slotId, slotLabel);
    }
    if (!image) return;
    setCapturedImages(prev => {
      const existing = prev.findIndex(i => i.slotId === slotId);
      if (existing >= 0) {
        const updated = [...prev];
        updated[existing] = { ...image!, slotId, slotLabel };
        return updated;
      }
      return [...prev, { ...image!, slotId, slotLabel }];
    });
  }, [captureMethod]);

  const handleRemoveImage = useCallback((slotId: string) => {
    setCapturedImages(prev => prev.filter(i => i.slotId !== slotId));
  }, []);

  // ── AI Identification ─────────────────────────────────────────────────────
  const handleIdentify = useCallback(async () => {
    if (capturedImages.length === 0) return;
    setStep('processing');
    setScanMode('processing');
    setAiError(null);

    const statusMessages = [
      'Preparing coin images...',
      'Routing to Coins & Numismatics specialist...',
      'AI vision analysis — obverse & reverse...',
      'Cross-referencing Numista catalogue...',
      'Checking eBay comparables...',
      'Finalising identification...',
    ];
    for (const msg of statusMessages) {
      setProcessingStatus(msg);
      await new Promise(r => setTimeout(r, 380));
    }

    const { result, error, quotaExceeded } = await identifyItemWithAI(
      capturedImages,
      'coins',
      undefined,
      undefined,
      { tenantId: tenant?.id },
    );

    if (quotaExceeded) {
      setAiError(
        `Monthly quota reached (${quotaExceeded.used}/${quotaExceeded.limit} free identifications used). Upgrade to SWISH Premium for unlimited AI identifications.`,
      );
      setStep('capture');
      return;
    }

    if (error || !result) {
      setAiError(error ?? 'Identification failed — please try again');
      setScanMode('idle');
      setStep('capture');
      return;
    }

    setIdResult(result);
    setScanMode('reviewing');

    // Show measurement verification if Numista catalogue data is available
    const hasNumistaData = result.numistaVerification && result.numistaVerification.status !== 'unavailable';
    if (hasNumistaData) {
      setStep('measure');
    } else {
      setStep('review');
    }
  }, [capturedImages, setScanMode]);

  // ── Physical measurement verification ─────────────────────────────────────
  const handleConfirmMeasurements = useCallback(async () => {
    if (!idResult) return;
    setMeasureChecking(true);

    const catWeight = idResult.numistaVerification?.weight ?? null;
    const catDiameter = idResult.numistaVerification?.diameter ?? null;
    const userWeight = measureWeight ? parseFloat(measureWeight) : null;
    const userDiameter = measureDiameter ? parseFloat(measureDiameter) : null;

    const notes: string[] = [];
    let weightMatch = 'unknown';
    let diameterMatch = 'unknown';

    if (userWeight && catWeight) {
      const diffPct = Math.abs(userWeight - catWeight) / catWeight;
      weightMatch = matchGrade(diffPct, 0.03, 0.07, 0.12);
      const symbol = weightMatch === 'strong' ? 'MATCH' : weightMatch === 'contradiction' ? 'CONTRADICTION' : 'match';
      notes.push(`Weight ${symbol}: ${userWeight}g vs catalogue ${catWeight}g (${(diffPct * 100).toFixed(1)}% diff)`);
    } else if (userWeight) {
      notes.push(`Weight recorded: ${userWeight}g — no catalogue spec to compare`);
    }

    if (userDiameter && catDiameter) {
      const diffMm = Math.abs(userDiameter - catDiameter);
      diameterMatch = matchGrade(diffMm, 0.5, 1.5, 3.0);
      const symbol = diameterMatch === 'strong' ? 'MATCH' : diameterMatch === 'contradiction' ? 'CONTRADICTION' : 'match';
      notes.push(`Diameter ${symbol}: ${userDiameter}mm vs catalogue ${catDiameter}mm (${diffMm.toFixed(1)}mm diff)`);
    } else if (userDiameter) {
      notes.push(`Diameter recorded: ${userDiameter}mm — no catalogue spec to compare`);
    }

    setMeasureResult({ weightMatch, diameterMatch, catWeight: catWeight ?? undefined, catDiameter: catDiameter ?? undefined, notes });
    setMeasureChecking(false);

    if (userWeight || userDiameter) {
      const updatedAttrs = {
        ...(idResult.attributes ?? {}),
        ...(userWeight ? { weight: userWeight, measured_weight: userWeight } : {}),
        ...(userDiameter ? { diameter: userDiameter, measured_diameter: userDiameter } : {}),
      };
      setIdResult(prev => prev ? { ...prev, attributes: updatedAttrs } : prev);
    }
  }, [idResult, measureWeight, measureDiameter]);

  // ── Save to inventory ─────────────────────────────────────────────────────
  const handleFeedback = useCallback(async (verdict: FeedbackVerdict) => {
    if (!idResult || !tenant) return;
    setFeedbackSaving(true);
    setFeedbackVerdict(verdict);
    await recordAIFeedback({
      tenantId: tenant.id,
      specialistId: 'coins',
      aiCanonicalTitle: idResult.canonicalTitle,
      aiAttributes: idResult.attributes ?? {},
      aiConfidence: idResult.confidence ?? 0,
      originalCanonicalTitle: idResult.canonicalTitle,
      originalAttributes: idResult.attributes ?? {},
      feedback: verdict,
      imageUrls: [],
    });
    setFeedbackSaving(false);
  }, [idResult, tenant]);

  const handleSaveToInventory = useCallback(async () => {
    if (!idResult || !tenant) return;
    setIsSaving(true);

    const { item, error } = await saveIdentifiedItem(tenant.id, idResult, {
      mediaUris: capturedImages.map(i => i.uri),
    });

    setIsSaving(false);

    if (error || !item) {
      showAlert('Save Failed', error ?? 'Could not save coin to inventory.');
      return;
    }

    setSavedItemId(item.id);

    // Apply valuation if already fetched
    if (valuationResult) {
      const v = valuationResult.valuation;
      const supabase = getSupabaseClient();
      await supabase.from('items').update({
        valuation_low: v?.valuationLow ?? 0,
        valuation_mid: v?.valuationMid ?? 0,
        valuation_high: v?.valuationHigh ?? 0,
        valuation_confidence: v?.valuationConfidence ?? 'low',
        expected_selling_price: v?.recommendedListingPrice ?? v?.valuationMid ?? 0,
        expected_net: v?.fairMarketValue ?? v?.valuationMid ?? 0,
        sale_prob_30d: v?.saleProb30d ?? 0,
        updated_at: new Date().toISOString(),
      }).eq('id', item.id).eq('tenant_id', tenant.id);
    }

    // Upload images in background
    if (capturedImages.length > 0) {
      setIsUploading(true);
      setUploadProgress('Uploading photos...');
      try {
        const { urls } = await uploadItemImages(item.id, capturedImages);
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

    if (idResult.confidence > 0) {
      recordPrediction(tenant.id, {
        entityType: 'item',
        entityId: item.id,
        predictionType: 'time_to_sale',
        predictedValue: 90,
        predictedConfidence: idResult.confidenceTier === 'high' || idResult.confidenceTier === 'very_high' ? 'medium' : 'low',
        predictedReasoning: `Coins specialist identification at ${Math.round(idResult.confidence * 100)}% confidence`,
      }).catch(() => {});
    }
  }, [idResult, tenant, capturedImages, valuationResult, showAlert]);

  // ── Paywall screen ───────────────────────────────────────────────────────
  if (tenant && !isEntitled) {
    return (
      <View style={s.container}>
        <StatusBar style="light" />
        <View style={[s.header, { paddingTop: insets.top + Spacing.sm }]}>
          <Pressable onPress={() => router.back()} style={s.backBtn} hitSlop={8}>
            <MaterialIcons name="arrow-back" size={20} color={KOC.gold} />
          </Pressable>
          <View style={s.headerCenter}>
            <View style={s.headerBrandRow}>
              <MaterialIcons name="toll" size={16} color={KOC.gold} />
              <Text style={s.headerBrand}>KeenOnCoins</Text>
            </View>
            <Text style={s.headerStep}>Subscription Required</Text>
          </View>
          <View style={{ width: 36 }} />
        </View>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[pw.container, { paddingBottom: insets.bottom + 40 }]}
        >
          {/* Lock icon hero */}
          <View style={pw.hero}>
            <View style={pw.lockRing}>
              <View style={[s.corner, s.cornerTL]} />
              <View style={[s.corner, s.cornerTR]} />
              <View style={[s.corner, s.cornerBL]} />
              <View style={[s.corner, s.cornerBR]} />
              <MaterialIcons name="lock" size={44} color={KOC.gold} />
            </View>
            <Text style={pw.heroTitle}>KeenOnCoins</Text>
            <Text style={pw.heroSub}>
              This feature requires an active KeenOnCoins subscription. Unlock the full coin scanner, Numista identification, and eBay pricing.
            </Text>
          </View>

          {/* What's included */}
          <View style={pw.featureCard}>
            <Text style={pw.featureTitle}>WHAT IS INCLUDED</Text>
            {[
              { icon: 'photo-camera', label: 'Obverse & Reverse coin photography' },
              { icon: 'auto-awesome', label: 'AI identification via Numista catalogue' },
              { icon: 'verified', label: 'Confidence scoring & attribution' },
              { icon: 'trending-up', label: 'eBay sold comparables & pricing' },
              { icon: 'inventory-2', label: 'Canonical inventory — no duplicates' },
              { icon: 'sell', label: 'One-tap eBay listing creation' },
            ].map((f, i) => (
              <View key={i} style={pw.featureRow}>
                <View style={pw.featureIcon}>
                  <MaterialIcons name={f.icon as any} size={14} color={KOC.gold} />
                </View>
                <Text style={pw.featureText}>{f.label}</Text>
              </View>
            ))}
          </View>

          {/* Tenant info — shows which plan they are on */}
          <View style={pw.planCard}>
            <Text style={pw.planTitle}>YOUR CURRENT PLAN</Text>
            <View style={pw.planRow}>
              <MaterialIcons name="card-membership" size={16} color={Colors.textSecondary} />
              <Text style={pw.planName}>
                {(tenant as any).subscription_tier
                  ? String((tenant as any).subscription_tier).charAt(0).toUpperCase() +
                    String((tenant as any).subscription_tier).slice(1)
                  : 'Starter'}
              </Text>
              <View style={pw.planBadge}>
                <Text style={pw.planBadgeText}>
                  {((tenant as any).active_specialists ?? []).length === 0
                    ? 'No niches enabled'
                    : `${((tenant as any).active_specialists ?? []).join(', ')}`}
                </Text>
              </View>
            </View>
            <Text style={pw.planSub}>
              KeenOnCoins is not included in your current plan.
            </Text>
          </View>

          {/* Upgrade CTA */}
          <Pressable
            onPress={() => router.push('/settings' as any)}
            style={({ pressed }) => [pw.upgradeBtn, pressed && { opacity: 0.88 }]}
          >
            <MaterialIcons name="star" size={18} color={KOC.dark} />
            <Text style={pw.upgradeBtnText}>Upgrade to KeenOnCoins</Text>
          </Pressable>

          <Text style={pw.upgradeNote}>
            Contact your account manager or visit Settings to upgrade your plan and unlock coin scanning.
          </Text>

          <Pressable onPress={() => router.back()} style={pw.cancelBtn}>
            <Text style={pw.cancelBtnText}>Go Back</Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  const hasRequiredImages = COIN_SLOTS.filter(s => s.required).every(
    s => capturedImages.some(i => i.slotId === s.id)
  );
  const canIdentify = capturedImages.length > 0;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <View style={s.container}>
      <StatusBar style="light" />

      {/* ── Header ── */}
      <View style={[s.header, { paddingTop: insets.top + Spacing.sm }]}>
        <Pressable
          onPress={step === 'home' ? () => router.back() : handleReset}
          style={s.backBtn}
          hitSlop={8}
        >
          <MaterialIcons name="arrow-back" size={20} color={KOC.gold} />
        </Pressable>
        <View style={s.headerCenter}>
          <View style={s.headerBrandRow}>
            <MaterialIcons name="toll" size={16} color={KOC.gold} />
            <Text style={s.headerBrand}>KeenOnCoins</Text>
          </View>
          <Text style={s.headerStep}>
            {step === 'home' && 'Coin Scanner'}
            {step === 'capture' && 'Photograph Coin'}
            {step === 'processing' && 'Identifying...'}
            {step === 'measure' && 'Verify Measurements'}
            {step === 'review' && 'Identification Result'}
          </Text>
        </View>
        <View style={{ width: 36 }} />
      </View>

      {/* ══════════ STEP: HOME ══════════ */}
      {step === 'home' ? (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 40 }]}
        >
          {/* Hero */}
          <View style={s.heroCard}>
            <View style={s.heroReticle}>
              <View style={[s.corner, s.cornerTL]} />
              <View style={[s.corner, s.cornerTR]} />
              <View style={[s.corner, s.cornerBL]} />
              <View style={[s.corner, s.cornerBR]} />
              <MaterialIcons name="toll" size={52} color={KOC.gold} />
            </View>
            <Text style={s.heroTitle}>Coin Scanner</Text>
            <Text style={s.heroSub}>
              Photograph obverse and reverse · AI identification via Numista catalogue · eBay pricing
            </Text>
          </View>

          {/* Capture method */}
          <Text style={s.sectionLabel}>CAPTURE METHOD</Text>
          <View style={s.methodRow}>
            {[
              { id: 'camera' as const, icon: 'photo-camera', label: 'Camera' },
              { id: 'library' as const, icon: 'photo-library', label: 'Photo Library' },
            ].map(m => (
              <Pressable
                key={m.id}
                onPress={() => setCaptureMethod(m.id)}
                style={[s.methodBtn, captureMethod === m.id && s.methodBtnActive]}
              >
                <MaterialIcons
                  name={m.icon as any}
                  size={20}
                  color={captureMethod === m.id ? KOC.gold : Colors.textTertiary}
                />
                <Text style={[s.methodBtnText, captureMethod === m.id && { color: KOC.gold }]}>
                  {m.label}
                </Text>
              </Pressable>
            ))}
          </View>

          {/* Capture guide */}
          <View style={s.guideCard}>
            <Text style={s.guideTitle}>PHOTOGRAPHY GUIDE</Text>
            {[
              { icon: 'flip', label: 'Obverse & Reverse', desc: 'Photograph both sides — required for identification' },
              { icon: 'wb-sunny', label: 'Even lighting', desc: 'Avoid glare and shadows — diffuse natural light is best' },
              { icon: 'crop-free', label: 'Fill the frame', desc: 'Coin should take up most of the image' },
              { icon: 'rotate-right', label: 'Edge shot', desc: 'Optional — useful for milled or lettered edges' },
              { icon: 'search', label: 'Detail close-up', desc: 'Optional — date, inscription, or key feature' },
            ].map((tip, i) => (
              <View key={i} style={s.guideTip}>
                <View style={s.guideTipIcon}>
                  <MaterialIcons name={tip.icon as any} size={14} color={KOC.gold} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.guideTipLabel}>{tip.label}</Text>
                  <Text style={s.guideTipDesc}>{tip.desc}</Text>
                </View>
              </View>
            ))}
          </View>

          {/* Capabilities */}
          <View style={s.capsCard}>
            <Text style={s.capsTitle}>WHAT THE SCANNER IDENTIFIES</Text>
            {[
              'Country, denomination, issuing authority, year, mint',
              'Obverse and reverse descriptions',
              'Numista catalogue match and reference number',
              'Condition grade (Sheldon P1–MS70 / hammered scale)',
              'Countermarks, overstrikes, and alterations',
              'eBay sold comparables and estimated selling range',
            ].map((cap, i) => (
              <View key={i} style={s.capRow}>
                <MaterialIcons name="check-circle" size={12} color={KOC.gold} />
                <Text style={s.capText}>{cap}</Text>
              </View>
            ))}
          </View>

          {/* Start button */}
          <Pressable
            onPress={() => { setCapturedImages([]); setStep('capture'); }}
            style={({ pressed }) => [s.startBtn, pressed && { opacity: 0.88 }]}
          >
            <MaterialIcons name="photo-camera" size={20} color={KOC.dark} />
            <Text style={s.startBtnText}>Start Scanning</Text>
          </Pressable>

          {/* Link to SWISH inventory */}
          <Pressable
            onPress={() => router.push('/(tabs)/inventory' as any)}
            style={s.inventoryLink}
          >
            <MaterialIcons name="inventory-2" size={14} color={Colors.textTertiary} />
            <Text style={s.inventoryLinkText}>View Coin Inventory</Text>
            <MaterialIcons name="chevron-right" size={14} color={Colors.textTertiary} />
          </Pressable>
        </ScrollView>
      ) : null}

      {/* ══════════ STEP: CAPTURE ══════════ */}
      {step === 'capture' ? (
        <View style={{ flex: 1 }}>
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 120 }]}
          >
            {/* Status bar */}
            <View style={s.captureBanner}>
              <View style={[s.captureDot, { backgroundColor: capturedImages.length >= 2 ? Colors.success : KOC.gold }]} />
              <Text style={s.captureBannerText}>
                {capturedImages.length === 0
                  ? 'Tap a slot to photograph your coin'
                  : capturedImages.length === 1
                  ? 'Obverse captured — now photograph the reverse'
                  : `${capturedImages.length} photos captured`}
              </Text>
              <View style={[s.captureCountChip, capturedImages.length >= 2 && s.captureCountChipReady]}>
                <MaterialIcons
                  name="photo-library"
                  size={11}
                  color={capturedImages.length >= 2 ? Colors.success : Colors.textTertiary}
                />
                <Text style={[s.captureCount, capturedImages.length >= 2 && { color: Colors.success }]}>
                  {capturedImages.length} / 4
                </Text>
              </View>
            </View>

            {/* AI error */}
            {aiError ? (
              <View style={s.errorBanner}>
                <MaterialIcons name="error-outline" size={15} color={Colors.danger} />
                <Text style={s.errorText}>{aiError}</Text>
              </View>
            ) : null}

            {/* Coin photo grid — large primary + 3 small */}
            <View style={s.photoGrid}>
              {COIN_SLOTS.map((slot, idx) => {
                const img = capturedImages.find(i => i.slotId === slot.id);
                const isFirst = idx === 0;
                return (
                  <View key={slot.id} style={isFirst ? s.photoSlotLarge : s.photoSlotSmall}>
                    <Pressable
                      onPress={() => handleCaptureSlot(slot.id, slot.label)}
                      style={({ pressed }) => [
                        s.photoSlotInner,
                        img ? s.photoSlotCaptured : s.photoSlotEmpty,
                        slot.required && !img ? s.photoSlotRequired : null,
                        pressed && { opacity: 0.82 },
                      ]}
                    >
                      {img ? (
                        <>
                          <Image source={{ uri: img.uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
                          <View style={s.capturedOverlay}>
                            <View style={s.capturedLabel}>
                              <MaterialIcons name="check-circle" size={10} color={Colors.success} />
                              <Text style={s.capturedLabelText} numberOfLines={1}>{slot.label}</Text>
                            </View>
                            <Pressable
                              onPress={e => { e.stopPropagation(); handleCaptureSlot(slot.id, slot.label); }}
                              hitSlop={6}
                              style={s.retakeBtn}
                            >
                              <MaterialIcons name="refresh" size={12} color="#fff" />
                            </Pressable>
                          </View>
                          <Pressable
                            onPress={e => { e.stopPropagation(); handleRemoveImage(slot.id); }}
                            style={s.removeBtn}
                            hitSlop={6}
                          >
                            <MaterialIcons name="close" size={11} color="#fff" />
                          </Pressable>
                        </>
                      ) : (
                        <View style={s.emptySlot}>
                          <View style={[s.emptySlotIcon, slot.required ? s.emptySlotIconRequired : null]}>
                            <MaterialIcons
                              name={captureMethod === 'camera' ? 'add-a-photo' : 'add-photo-alternate'}
                              size={isFirst ? 26 : 20}
                              color={slot.required ? KOC.gold : Colors.textTertiary}
                            />
                          </View>
                          <Text style={[s.emptySlotLabel, slot.required && { color: Colors.textPrimary }]} numberOfLines={1}>
                            {slot.label}
                          </Text>
                          {slot.required ? (
                            <View style={s.requiredPill}>
                              <Text style={s.requiredPillText}>Required</Text>
                            </View>
                          ) : (
                            <Text style={s.optionalLabel}>Optional</Text>
                          )}
                          {slot.hint && isFirst ? (
                            <Text style={s.slotHint} numberOfLines={2}>{slot.hint}</Text>
                          ) : null}
                        </View>
                      )}
                    </Pressable>
                  </View>
                );
              })}
            </View>

            {/* Tip */}
            <View style={s.tipBanner}>
              <MaterialIcons name="lightbulb-outline" size={13} color={KOC.gold} />
              <Text style={s.tipText}>
                Obverse + Reverse gives the AI the most evidence. Edge and Detail improve confidence further.
              </Text>
            </View>
          </ScrollView>

          {/* Action bar */}
          <View style={[s.actionBar, { paddingBottom: insets.bottom + Spacing.base }]}>
            <View style={s.actionBarInfo}>
              <Text style={s.actionBarCount}>
                {capturedImages.length} photo{capturedImages.length === 1 ? '' : 's'} captured
              </Text>
              {!hasRequiredImages ? (
                <Text style={s.actionBarHint}>Obverse and Reverse required</Text>
              ) : (
                <Text style={s.actionBarReady}>Ready to identify</Text>
              )}
            </View>
            <Pressable
              onPress={handleIdentify}
              disabled={!canIdentify}
              style={({ pressed }) => [
                s.identifyBtn,
                !canIdentify && s.identifyBtnDisabled,
                pressed && canIdentify ? { opacity: 0.88 } : null,
              ]}
            >
              <MaterialIcons name="auto-awesome" size={18} color={canIdentify ? KOC.dark : Colors.textTertiary} />
              <Text style={[s.identifyBtnText, !canIdentify && { color: Colors.textTertiary }]}>
                Identify Coin
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {/* ══════════ STEP: PROCESSING ══════════ */}
      {step === 'processing' ? (
        <View style={s.processingView}>
          <View style={s.processingOrb}>
            <ActivityIndicator size="large" color={KOC.gold} />
            <View style={[s.processingRing, { borderColor: KOC.gold + '25' }]} />
          </View>
          <Text style={s.processingTitle}>Identifying Coin</Text>
          <Text style={s.processingStatus}>{processingStatus}</Text>
          <View style={s.processingSteps}>
            {[
              { label: 'AI Vision Analysis', icon: 'visibility' },
              { label: 'Numista Catalogue Search', icon: 'search' },
              { label: 'Attribution & Grading', icon: 'verified' },
              { label: 'Market Valuation', icon: 'trending-up' },
            ].map(step => (
              <View key={step.label} style={s.processingStep}>
                <ActivityIndicator size="small" color={KOC.gold} style={{ width: 16, height: 16 }} />
                <Text style={s.processingStepText}>{step.label}</Text>
              </View>
            ))}
          </View>
          <View style={s.aiBadge}>
            <MaterialIcons name="auto-awesome" size={11} color={KOC.gold} />
            <Text style={s.aiBadgeText}>Coins & Numismatics Specialist · OnSpace AI</Text>
          </View>
        </View>
      ) : null}

      {/* ══════════ STEP: MEASURE ══════════ */}
      {step === 'measure' && idResult ? (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 40 }]}
        >
          <View style={s.measureHeader}>
            <View style={s.measureHeaderIcon}>
              <MaterialIcons name="straighten" size={22} color={KOC.gold} />
            </View>
            <Text style={s.measureTitle}>Physical Verification</Text>
            <Text style={s.measureSub}>
              Optional but strongly recommended. Weight and diameter are hard evidence — contradictions will update the confidence score.
            </Text>
          </View>

          {/* Catalogue spec */}
          {(idResult.numistaVerification?.weight || idResult.numistaVerification?.diameter) ? (
            <View style={s.catSpecCard}>
              <Text style={s.catSpecTitle}>NUMISTA CATALOGUE SPECIFICATION</Text>
              <Text style={s.catSpecSub} numberOfLines={2}>
                {idResult.numistaTitle ?? 'Matched type'}
                {idResult.numistaN ? ` · ${idResult.numistaN}` : ''}
              </Text>
              <View style={s.catSpecRow}>
                {idResult.numistaVerification?.weight ? (
                  <View style={s.catSpecItem}>
                    <Text style={s.catSpecLabel}>WEIGHT</Text>
                    <Text style={s.catSpecValue}>{idResult.numistaVerification.weight}g</Text>
                  </View>
                ) : null}
                {idResult.numistaVerification?.diameter ? (
                  <View style={s.catSpecItem}>
                    <Text style={s.catSpecLabel}>DIAMETER</Text>
                    <Text style={s.catSpecValue}>{idResult.numistaVerification.diameter}mm</Text>
                  </View>
                ) : null}
                {idResult.numistaVerification?.composition ? (
                  <View style={s.catSpecItem}>
                    <Text style={s.catSpecLabel}>COMPOSITION</Text>
                    <Text style={s.catSpecValue} numberOfLines={1}>{idResult.numistaVerification.composition}</Text>
                  </View>
                ) : null}
              </View>
            </View>
          ) : (
            <View style={s.catSpecCard}>
              <Text style={s.catSpecTitle}>NUMISTA CATALOGUE SPECIFICATION</Text>
              <Text style={[s.catSpecSub, { color: Colors.textTertiary }]}>No catalogue measurements available. Enter your measurements for future reference.</Text>
            </View>
          )}

          {/* Measurement inputs */}
          <View style={s.measureCard}>
            <Text style={s.measureCardTitle}>YOUR MEASUREMENTS</Text>
            <View style={s.measureInputRow}>
              <View style={s.measureField}>
                <Text style={s.measureFieldLabel}>Weight (g)</Text>
                <View style={s.measureInputWrap}>
                  <TextInput
                    style={s.measureInput}
                    value={measureWeight}
                    onChangeText={setMeasureWeight}
                    keyboardType="decimal-pad"
                    placeholder={idResult.numistaVerification?.weight ? `Expected ${idResult.numistaVerification.weight}g` : 'e.g. 5.00'}
                    placeholderTextColor={Colors.textTertiary}
                  />
                  <Text style={s.measureUnit}>g</Text>
                </View>
              </View>
              <View style={s.measureField}>
                <Text style={s.measureFieldLabel}>Diameter (mm)</Text>
                <View style={s.measureInputWrap}>
                  <TextInput
                    style={s.measureInput}
                    value={measureDiameter}
                    onChangeText={setMeasureDiameter}
                    keyboardType="decimal-pad"
                    placeholder={idResult.numistaVerification?.diameter ? `Expected ${idResult.numistaVerification.diameter}mm` : 'e.g. 24.0'}
                    placeholderTextColor={Colors.textTertiary}
                  />
                  <Text style={s.measureUnit}>mm</Text>
                </View>
              </View>
            </View>
          </View>

          {/* Result */}
          {measureResult ? (
            <View style={s.measureResultCard}>
              <Text style={s.measureResultTitle}>VERIFICATION RESULT</Text>
              {measureResult.notes.map((note, i) => {
                const isContradiction = note.includes('CONTRADICTION');
                const isMatch = note.includes('MATCH') && !isContradiction;
                return (
                  <View key={i} style={[s.measureResultRow, isContradiction && { backgroundColor: Colors.dangerDim }, isMatch && { backgroundColor: Colors.successDim }]}>
                    <MaterialIcons
                      name={isContradiction ? 'warning' : isMatch ? 'check-circle' : 'info-outline'}
                      size={12}
                      color={isContradiction ? Colors.danger : isMatch ? Colors.success : Colors.textTertiary}
                    />
                    <Text style={[s.measureResultText, isContradiction && { color: Colors.danger }, isMatch && { color: Colors.success }]}>
                      {note}
                    </Text>
                  </View>
                );
              })}
            </View>
          ) : null}

          {/* Actions */}
          <View style={s.measureActions}>
            {!measureResult ? (
              <Pressable
                onPress={handleConfirmMeasurements}
                disabled={measureChecking || (!measureWeight && !measureDiameter)}
                style={[s.measureConfirmBtn, (!measureWeight && !measureDiameter) && { opacity: 0.4 }]}
              >
                {measureChecking ? <ActivityIndicator size="small" color={KOC.dark} /> : <MaterialIcons name="check" size={16} color={KOC.dark} />}
                <Text style={s.measureConfirmBtnText}>
                  {measureChecking ? 'Checking...' : 'Verify Measurements'}
                </Text>
              </Pressable>
            ) : (
              <Pressable onPress={() => setStep('review')} style={s.measureProceedBtn}>
                <MaterialIcons name="arrow-forward" size={16} color={Colors.background} />
                <Text style={s.measureProceedText}>View Identification Result</Text>
              </Pressable>
            )}
            <Pressable onPress={() => setStep('review')} style={s.measureSkipBtn}>
              <Text style={s.measureSkipText}>
                {measureResult ? 'Proceed anyway' : 'Skip measurement (not required)'}
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      ) : null}

      {/* ══════════ STEP: REVIEW ══════════ */}
      {step === 'review' && idResult ? (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 40 }]}
        >
          {/* Saved confirmation */}
          {savedItemId ? (
            <View style={s.savedBanner}>
              <MaterialIcons name="check-circle" size={18} color={Colors.success} />
              <View style={{ flex: 1 }}>
                <Text style={s.savedBannerText}>Saved to inventory</Text>
                {uploadProgress ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 }}>
                    {isUploading ? <ActivityIndicator size="small" color={Colors.success} style={{ width: 12, height: 12 }} /> : null}
                    <Text style={{ fontSize: 11, color: Colors.success + 'CC' }}>{uploadProgress}</Text>
                  </View>
                ) : null}
              </View>
            </View>
          ) : null}

          {/* Result header */}
          <View style={s.resultCard}>
            <View style={[s.confidenceBadge, { borderColor: CONFIDENCE_COLOR(idResult.confidence) }]}>
              <Text style={[s.confidencePct, { color: CONFIDENCE_COLOR(idResult.confidence) }]}>
                {Math.round(idResult.confidence * 100)}%
              </Text>
              <Text style={[s.confidenceLabel, { color: CONFIDENCE_COLOR(idResult.confidence) }]}>
                {idResult.confidence >= 0.85 ? 'HIGH' : idResult.confidence >= 0.65 ? 'MED' : 'LOW'}
              </Text>
            </View>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={s.resultTitle}>{idResult.canonicalTitle}</Text>
              <Text style={s.resultCondition}>
                {idResult.condition}{idResult.conditionGrade ? ` · ${idResult.conditionGrade}` : ''}
              </Text>
              <View style={s.resultSourceRow}>
                <MaterialIcons name="verified" size={11} color={Colors.textTertiary} />
                <Text style={s.resultSource}>{idResult.identificationSource}</Text>
                <View style={s.coinsBadge}>
                  <MaterialIcons name="toll" size={9} color={KOC.gold} />
                  <Text style={s.coinsBadgeText}>Numismatics</Text>
                </View>
              </View>
            </View>
          </View>

          {/* Low confidence warning */}
          {idResult.confidence < CONFIDENCE_THRESHOLDS.assisted ? (
            <View style={s.warningCard}>
              <MaterialIcons name="warning" size={15} color={Colors.warning} />
              <Text style={s.warningText}>
                Low confidence — manual verification recommended. Run Re-Value after saving for eBay comparables.
              </Text>
            </View>
          ) : null}

          {/* Captured images strip */}
          {capturedImages.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -Spacing.base }} contentContainerStyle={{ paddingHorizontal: Spacing.base, gap: Spacing.sm }}>
              {capturedImages.map(img => (
                <Image key={img.slotId} source={{ uri: img.uri }} style={s.imageThumb} contentFit="cover" />
              ))}
            </ScrollView>
          ) : null}

          {/* Numista verification */}
          {idResult.numistaStatus && idResult.numistaStatus !== 'unavailable' ? (
            <View style={[s.numistaCard, {
              borderColor: (idResult.numistaStatus === 'verified' || idResult.numistaStatus === 'strong_match')
                ? Colors.success + '40' : Colors.warning + '30',
            }]}>
              <View style={s.numistaCardHeader}>
                <MaterialIcons
                  name={idResult.numistaStatus === 'verified' || idResult.numistaStatus === 'strong_match' ? 'verified' : idResult.numistaStatus === 'no_match' ? 'search-off' : 'help-outline'}
                  size={13}
                  color={idResult.numistaStatus === 'verified' || idResult.numistaStatus === 'strong_match' ? Colors.success : Colors.warning}
                />
                <Text style={[s.numistaCardTitle, {
                  color: idResult.numistaStatus === 'verified' || idResult.numistaStatus === 'strong_match' ? Colors.success : Colors.warning,
                }]}>
                  NUMISTA {idResult.numistaStatus === 'no_match' ? 'NO MATCH' : String(idResult.numistaStatus).replace(/_/g, ' ').toUpperCase()}
                  {idResult.numistaN ? ` · ${idResult.numistaN}` : ''}
                </Text>
                {idResult.numistaMatchScore && idResult.numistaMatchScore > 0 ? (
                  <Text style={s.numistaScore}>{idResult.numistaMatchScore}/100</Text>
                ) : null}
              </View>
              {idResult.numistaTitle ? (
                <Text style={s.numistaTitle} numberOfLines={2}>{idResult.numistaTitle}</Text>
              ) : null}
              {idResult.numistaStatus === 'no_match' ? (
                <Text style={[s.numistaTitle, { color: Colors.warning }]}>No Numista catalogue match found. Use Re-Value for eBay-only market data.</Text>
              ) : null}
            </View>
          ) : null}

          {/* Evidence */}
          {(idResult.evidenceSupporting.length > 0 || idResult.missingInformation.length > 0) ? (
            <View style={s.evidenceCard}>
              <Text style={s.evidenceTitle}>
                EVIDENCE · {idResult.evidenceSupporting.length} supporting · {idResult.missingInformation.length} unresolved
              </Text>
              {idResult.evidenceSupporting.slice(0, 4).map((e, i) => (
                <View key={i} style={s.evidenceRow}>
                  <MaterialIcons name="check" size={11} color={Colors.success} style={{ marginTop: 2 }} />
                  <Text style={s.evidenceText}>{e}</Text>
                </View>
              ))}
              {idResult.missingInformation.slice(0, 2).map((m, i) => (
                <View key={i} style={s.evidenceRow}>
                  <MaterialIcons name="help-outline" size={11} color={Colors.warning} style={{ marginTop: 2 }} />
                  <Text style={[s.evidenceText, { color: Colors.warning }]}>{m}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {/* Valuation */}
          <View style={s.valuationCard}>
            <View style={s.valuationHeader}>
              <Text style={s.valuationTitle}>PRICING</Text>
              {valuationLoading ? (
                <View style={[s.valBadge, { backgroundColor: Colors.primaryDim }]}>
                  <ActivityIndicator size="small" color={Colors.primary} style={{ width: 12, height: 12 }} />
                  <Text style={[s.valBadgeText, { color: Colors.primary }]}>fetching...</Text>
                </View>
              ) : valuationResult ? (
                <View style={[s.valBadge, {
                  backgroundColor: valuationResult.valuation?.valuationConfidence === 'high' ? Colors.successDim
                    : valuationResult.valuation?.valuationConfidence === 'medium' ? Colors.primaryDim : Colors.warningDim,
                }]}>
                  <Text style={[s.valBadgeText, {
                    color: valuationResult.valuation?.valuationConfidence === 'high' ? Colors.success
                      : valuationResult.valuation?.valuationConfidence === 'medium' ? Colors.primary : Colors.warning,
                    textTransform: 'uppercase',
                  }]}>
                    {valuationResult.valuation?.valuationConfidence ?? 'low'} confidence
                  </Text>
                </View>
              ) : (
                <View style={[s.valBadge, { backgroundColor: Colors.surfaceBorder }]}>
                  <Text style={[s.valBadgeText, { color: Colors.textTertiary }]}>no data</Text>
                </View>
              )}
            </View>

            {valuationResult ? (() => {
              const v = valuationResult.valuation;
              const sold = valuationResult.soldMarket;
              const asking = valuationResult.activeAskingPrices;
              const mid = v?.valuationMid ?? 0;
              const low = v?.valuationLow ?? 0;
              const high = v?.valuationHigh ?? 0;
              const recommended = v?.recommendedListingPrice ?? 0;
              const soldCount = sold?.relevantSoldCount ?? 0;
              const soldMedian = sold?.medianPrice ?? 0;
              return (
                <View style={{ gap: Spacing.sm }}>
                  {mid > 0 ? (
                    <View style={s.priceRow}>
                      <View style={s.priceItem}>
                        <Text style={s.priceLabel}>Low</Text>
                        <Text style={s.priceValue}>£{low.toFixed(2)}</Text>
                      </View>
                      <View style={s.priceMidItem}>
                        <Text style={[s.priceLabel, { color: KOC.gold }]}>Suggested</Text>
                        <Text style={[s.priceValue, { fontSize: Typography.size.xxl, color: KOC.gold }]}>
                          £{recommended > 0 ? recommended.toFixed(2) : mid.toFixed(2)}
                        </Text>
                      </View>
                      <View style={s.priceItem}>
                        <Text style={s.priceLabel}>High</Text>
                        <Text style={s.priceValue}>£{high.toFixed(2)}</Text>
                      </View>
                    </View>
                  ) : (
                    <View style={s.noDataRow}>
                      <MaterialIcons name="info-outline" size={13} color={Colors.warning} />
                      <Text style={s.noDataText}>Insufficient comparable sales — no reliable price range available</Text>
                    </View>
                  )}
                  {soldCount > 0 ? (
                    <View style={{ flexDirection: 'row', gap: Spacing.md, flexWrap: 'wrap' }}>
                      <View style={{ flex: 1 }}>
                        <Text style={s.priceLabel}>Sold comparables</Text>
                        <Text style={[s.priceValue, { fontSize: Typography.size.md }]}>{soldCount}</Text>
                      </View>
                      {soldMedian > 0 ? (
                        <View style={{ flex: 1 }}>
                          <Text style={s.priceLabel}>Sold median</Text>
                          <Text style={[s.priceValue, { fontSize: Typography.size.md }]}>£{soldMedian.toFixed(2)}</Text>
                        </View>
                      ) : null}
                      {v?.saleProb30d != null && v.saleProb30d > 0 ? (
                        <View style={{ flex: 1 }}>
                          <Text style={s.priceLabel}>30d sale prob.</Text>
                          <Text style={[s.priceValue, { fontSize: Typography.size.md }]}>{Math.round(v.saleProb30d * 100)}%</Text>
                        </View>
                      ) : null}
                    </View>
                  ) : null}
                  {asking && asking.count > 0 && asking.medianAskingPrice > 0 ? (
                    <View style={s.noDataRow}>
                      <MaterialIcons name="warning" size={11} color={Colors.warning} />
                      <Text style={[s.noDataText, { color: Colors.warning }]}>
                        Active asking: £{asking.lowAskingPrice.toFixed(2)}–£{asking.highAskingPrice.toFixed(2)} ({asking.relevantCount} listings) — asking prices, not sold prices
                      </Text>
                    </View>
                  ) : null}
                  {v?.listingPriceRationale ? (
                    <View style={[s.noDataRow, { backgroundColor: Colors.primaryDim }]}>
                      <MaterialIcons name="auto-awesome" size={11} color={Colors.primary} />
                      <Text style={[s.noDataText, { color: Colors.primary }]} numberOfLines={4}>{v.listingPriceRationale}</Text>
                    </View>
                  ) : null}
                  {(sold?.dataQuality === 'insufficient' || sold?.dataQuality === 'weak') ? (
                    <View style={s.noDataRow}>
                      <MaterialIcons name="warning" size={11} color={Colors.warning} />
                      <Text style={[s.noDataText, { color: Colors.warning }]} numberOfLines={2}>
                        {sold.dataQualityReason ?? 'Limited comparable sales — treat valuation as an estimate'}
                      </Text>
                    </View>
                  ) : null}
                </View>
              );
            })() : valuationLoading ? (
              <View style={[s.noDataRow, { justifyContent: 'center' }]}>
                <ActivityIndicator size="small" color={KOC.gold} />
                <Text style={[s.noDataText, { color: KOC.gold }]}>Searching eBay sold data...</Text>
              </View>
            ) : valuationError ? (
              <View style={s.noDataRow}>
                <MaterialIcons name="warning" size={13} color={Colors.warning} />
                <Text style={[s.noDataText, { color: Colors.warning }]} numberOfLines={3}>{valuationError}</Text>
              </View>
            ) : null}
          </View>

          {/* Coin attributes */}
          {Object.keys(idResult.attributes).length > 0 ? (
            <View style={s.attrsCard}>
              <Text style={s.attrsTitle}>COIN ATTRIBUTES</Text>
              {Object.entries(idResult.attributes)
                .filter(([k]) => !k.startsWith('_') && !['object_type', 'identification_state'].includes(k))
                .slice(0, 14)
                .map(([k, v]) => (
                  <View key={k} style={s.attrRow}>
                    <Text style={s.attrKey}>{k.replace(/_/g, ' ')}</Text>
                    <Text style={s.attrValue}>{String(v)}</Text>
                  </View>
                ))}
            </View>
          ) : null}

          {/* Condition notes */}
          {idResult.conditionNotes ? (
            <View style={s.conditionCard}>
              <Text style={s.conditionTitle}>CONDITION NOTES</Text>
              <Text style={s.conditionText}>{idResult.conditionNotes}</Text>
            </View>
          ) : null}

          {/* Warnings */}
          {idResult.warnings.length > 0 ? (
            <View style={s.warnCard}>
              {idResult.warnings.map((w, i) => (
                <View key={i} style={{ flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start' }}>
                  <MaterialIcons name="warning" size={13} color={Colors.danger} style={{ marginTop: 2 }} />
                  <Text style={{ flex: 1, fontSize: Typography.size.xs, color: Colors.danger, lineHeight: 16 }}>{w}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {/* Feedback */}
          {savedItemId && feedbackVerdict === null ? (
            <View style={s.feedbackCard}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, flex: 1 }}>
                <MaterialIcons name="school" size={13} color={Colors.accent} />
                <Text style={s.feedbackQuestion}>Was this identification correct?</Text>
              </View>
              <View style={{ flexDirection: 'row', gap: Spacing.xs }}>
                <Pressable onPress={() => handleFeedback('incorrect')} disabled={feedbackSaving}
                  style={({ pressed }) => [s.fbNo, pressed && { opacity: 0.75 }]}>
                  <MaterialIcons name="close" size={12} color={Colors.danger} />
                  <Text style={{ fontSize: 11, fontWeight: Typography.weight.bold, color: Colors.danger }}>No</Text>
                </Pressable>
                <Pressable onPress={() => handleFeedback('correct')} disabled={feedbackSaving}
                  style={({ pressed }) => [s.fbYes, pressed && { opacity: 0.75 }]}>
                  {feedbackSaving ? <ActivityIndicator size="small" color={Colors.background} style={{ width: 12 }} /> : <MaterialIcons name="check" size={12} color={Colors.background} />}
                  <Text style={{ fontSize: 11, fontWeight: Typography.weight.bold, color: Colors.background }}>Yes</Text>
                </Pressable>
              </View>
            </View>
          ) : savedItemId && feedbackVerdict !== null ? (
            <View style={[s.feedbackCard, { backgroundColor: Colors.successDim, borderColor: Colors.success + '40' }]}>
              <MaterialIcons name="check-circle" size={13} color={Colors.success} />
              <Text style={{ fontSize: 11, color: Colors.success, fontWeight: Typography.weight.medium }}>
                {feedbackVerdict === 'correct' ? 'Thanks — recorded.' : 'Noted — AI will learn from this.'}
              </Text>
            </View>
          ) : null}

          {/* eBay Visual Matches */}
          <View style={s.ebayCard}>
            <Pressable onPress={() => setEbayExpanded(e => !e)} style={s.ebayCardHeader}>
              <View style={s.ebayCardLeft}>
                <View style={s.ebayIconWrap}>
                  <MaterialIcons name="image-search" size={12} color={Colors.info} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.ebayCardTitle}>eBay Visual Matches</Text>
                  {ebayVisualLoading ? (
                    <Text style={s.ebayCardSub}>Searching eBay GB...</Text>
                  ) : ebayVisualResult?.available ? (
                    <Text style={s.ebayCardSub}>{ebayVisualResult.totalResults} similar listing{ebayVisualResult.totalResults !== 1 ? 's' : ''} found</Text>
                  ) : ebayVisualResult ? (
                    <Text style={[s.ebayCardSub, { color: Colors.textTertiary }]}>{ebayVisualResult.error ?? 'No matches found'}</Text>
                  ) : null}
                </View>
              </View>
              {ebayVisualLoading ? (
                <ActivityIndicator size="small" color={Colors.info} style={{ width: 16, height: 16 }} />
              ) : ebayVisualResult?.available && ebayVisualResult.items.length > 0 ? (
                <MaterialIcons name={ebayExpanded ? 'expand-less' : 'expand-more'} size={16} color={Colors.textTertiary} />
              ) : null}
            </Pressable>
            {ebayVisualResult?.available ? (
              <View style={s.ebayDisclaimer}>
                <MaterialIcons name="info-outline" size={10} color={Colors.textTertiary} />
                <Text style={s.ebayDisclaimerText}>Similar items only — not confirmed matches. Use as context evidence.</Text>
              </View>
            ) : null}
            {ebayVisualResult?.available && ebayVisualResult.items.length > 0 ? (() => {
              const pr = formatAskingPriceRange(ebayVisualResult.items);
              return pr ? (
                <View style={[s.ebayDisclaimer, { backgroundColor: Colors.warningDim + '60', borderColor: Colors.warning + '25' }]}>
                  <MaterialIcons name="warning" size={10} color={Colors.warning} />
                  <Text style={[s.ebayDisclaimerText, { color: Colors.warning }]}>{pr} — asking prices, not sold prices</Text>
                </View>
              ) : null;
            })() : null}
            {ebayVisualResult?.available && ebayVisualResult.items.length > 0 ? (
              <View style={{ borderTopWidth: 1, borderTopColor: Colors.surfaceBorder }}>
                {(ebayExpanded ? ebayVisualResult.items : ebayVisualResult.items.slice(0, 2)).map((item, i) => (
                  <Pressable
                    key={item.itemId || i}
                    onPress={() => item.itemWebUrl ? Linking.openURL(item.itemWebUrl) : null}
                    style={({ pressed }) => [s.ebayItem, pressed && { opacity: 0.78 }]}
                    disabled={!item.itemWebUrl}
                  >
                    {item.image ? (
                      <Image source={{ uri: item.image }} style={s.ebayItemImg} contentFit="cover" transition={100} />
                    ) : (
                      <View style={[s.ebayItemImg, { backgroundColor: Colors.surfaceHighlight, alignItems: 'center', justifyContent: 'center' }]}>
                        <MaterialIcons name="image-not-supported" size={14} color={Colors.textTertiary} />
                      </View>
                    )}
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={s.ebayItemTitle} numberOfLines={2}>{item.title}</Text>
                      {item.price.value > 0 ? <Text style={s.ebayItemPrice}>£{item.price.value.toFixed(2)}</Text> : null}
                    </View>
                    {item.itemWebUrl ? <MaterialIcons name="open-in-new" size={11} color={Colors.textTertiary} style={{ flexShrink: 0 }} /> : null}
                  </Pressable>
                ))}
                {!ebayExpanded && ebayVisualResult.items.length > 2 ? (
                  <Pressable onPress={() => setEbayExpanded(true)} style={s.ebayShowMore}>
                    <Text style={s.ebayShowMoreText}>Show all {ebayVisualResult.items.length} matches</Text>
                    <MaterialIcons name="expand-more" size={13} color={Colors.info} />
                  </Pressable>
                ) : null}
              </View>
            ) : null}
          </View>

          {/* Disclaimer */}
          <View style={s.disclaimer}>
            <MaterialIcons name="info-outline" size={13} color={Colors.textTertiary} />
            <Text style={s.disclaimerText}>
              AI identification is a prediction based on visual evidence. Verify with physical measurements and catalogue references before attributing high-value coins.
            </Text>
          </View>

          {/* Actions */}
          <View style={s.reviewActions}>
            <Pressable onPress={handleReset} style={s.scanAnotherBtn}>
              <Text style={s.scanAnotherText}>Scan Another</Text>
            </Pressable>
            {savedItemId ? (
              <Pressable onPress={() => router.push(`/create-listing?id=${savedItemId}` as any)} style={s.primaryAction}>
                {isUploading ? <ActivityIndicator size="small" color={KOC.dark} /> : <MaterialIcons name="sell" size={18} color={KOC.dark} />}
                <Text style={s.primaryActionText}>{isUploading ? 'Uploading...' : 'Create Listing'}</Text>
              </Pressable>
            ) : (
              <Pressable onPress={handleSaveToInventory} disabled={isSaving} style={s.primaryAction}>
                {isSaving ? <ActivityIndicator size="small" color={KOC.dark} /> : <MaterialIcons name="add" size={18} color={KOC.dark} />}
                <Text style={s.primaryActionText}>{isSaving ? 'Saving...' : 'Add to Inventory'}</Text>
              </Pressable>
            )}
          </View>
        </ScrollView>
      ) : null}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingHorizontal: Spacing.base, paddingBottom: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: KOC.goldDim,
    backgroundColor: KOC.dark,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: Radius.md,
    backgroundColor: KOC.goldDim, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: KOC.gold + '30',
  },
  headerCenter: { flex: 1, alignItems: 'center', gap: 2 },
  headerBrandRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headerBrand: { fontSize: Typography.size.base, fontWeight: Typography.weight.bold, color: KOC.gold, letterSpacing: 0.5 },
  headerStep: { fontSize: Typography.size.xs, color: Colors.textTertiary },

  content: { padding: Spacing.base, gap: Spacing.lg },
  sectionLabel: { fontSize: 10, fontWeight: Typography.weight.bold, color: Colors.textTertiary, letterSpacing: 0.8, textTransform: 'uppercase' },

  // Home step
  heroCard: {
    backgroundColor: KOC.dark, borderRadius: Radius.xxl,
    borderWidth: 1, borderColor: KOC.gold + '30',
    alignItems: 'center', padding: Spacing.xl, gap: Spacing.md,
  },
  heroReticle: { width: 100, height: 100, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  corner: { position: 'absolute', width: 22, height: 22, borderColor: KOC.gold, borderWidth: 2.5 },
  cornerTL: { top: 0, left: 0, borderRightWidth: 0, borderBottomWidth: 0 },
  cornerTR: { top: 0, right: 0, borderLeftWidth: 0, borderBottomWidth: 0 },
  cornerBL: { bottom: 0, left: 0, borderRightWidth: 0, borderTopWidth: 0 },
  cornerBR: { bottom: 0, right: 0, borderLeftWidth: 0, borderTopWidth: 0 },
  heroTitle: { fontSize: Typography.size.xl, fontWeight: Typography.weight.bold, color: KOC.gold },
  heroSub: { fontSize: Typography.size.sm, color: Colors.textSecondary, textAlign: 'center', lineHeight: 20 },

  methodRow: { flexDirection: 'row', gap: Spacing.sm },
  methodBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: Spacing.sm, backgroundColor: Colors.surface, borderRadius: Radius.md,
    paddingVertical: Spacing.md, borderWidth: 1, borderColor: Colors.surfaceBorder,
  },
  methodBtnActive: { borderColor: KOC.gold + '60', backgroundColor: KOC.goldDim },
  methodBtnText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.textTertiary },

  guideCard: {
    backgroundColor: Colors.surface, borderRadius: Radius.xl, borderWidth: 1,
    borderColor: Colors.surfaceBorder, overflow: 'hidden',
  },
  guideTitle: { fontSize: 10, fontWeight: Typography.weight.bold, color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5, padding: Spacing.md, paddingBottom: Spacing.sm, backgroundColor: Colors.surfaceHighlight },
  guideTip: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, padding: Spacing.sm, borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder + '60', paddingHorizontal: Spacing.md },
  guideTipIcon: { width: 28, height: 28, borderRadius: Radius.sm, backgroundColor: KOC.goldDim, alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2 },
  guideTipLabel: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.textPrimary },
  guideTipDesc: { fontSize: Typography.size.xs, color: Colors.textTertiary, lineHeight: 16, marginTop: 2 },

  capsCard: {
    backgroundColor: Colors.surface, borderRadius: Radius.xl, borderWidth: 1,
    borderColor: Colors.surfaceBorder, padding: Spacing.md, gap: Spacing.sm,
  },
  capsTitle: { fontSize: 10, fontWeight: Typography.weight.bold, color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5 },
  capRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  capText: { flex: 1, fontSize: Typography.size.xs, color: Colors.textSecondary, lineHeight: 17 },

  startBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: Spacing.sm, backgroundColor: KOC.gold,
    borderRadius: Radius.md, paddingVertical: Spacing.base,
    shadowColor: KOC.gold, shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4, shadowRadius: 12, elevation: 6,
  },
  startBtnText: { fontSize: Typography.size.base, fontWeight: Typography.weight.bold, color: KOC.dark },

  inventoryLink: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: Spacing.sm, padding: Spacing.md,
  },
  inventoryLinkText: { fontSize: Typography.size.sm, color: Colors.textTertiary },

  // Capture step
  captureBanner: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: Spacing.md,
    borderWidth: 1, borderColor: Colors.surfaceBorder,
  },
  captureDot: { width: 8, height: 8, borderRadius: 4 },
  captureBannerText: { flex: 1, fontSize: Typography.size.sm, fontWeight: Typography.weight.medium, color: Colors.textSecondary },
  captureCountChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderRadius: Radius.pill, paddingHorizontal: 8, paddingVertical: 4,
    backgroundColor: Colors.surfaceHighlight, borderWidth: 1, borderColor: Colors.surfaceBorder,
  },
  captureCountChipReady: { backgroundColor: Colors.successDim, borderColor: Colors.success + '50' },
  captureCount: { fontSize: 11, fontWeight: Typography.weight.bold, color: Colors.textTertiary },

  errorBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm,
    backgroundColor: Colors.dangerDim, borderRadius: Radius.md, padding: Spacing.md,
    borderWidth: 1, borderColor: Colors.danger + '40',
  },
  errorText: { flex: 1, fontSize: Typography.size.xs, color: Colors.danger, lineHeight: 17 },

  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  photoSlotLarge: { width: '100%', aspectRatio: 1.8 },
  photoSlotSmall: { width: '31%', aspectRatio: 1 },
  photoSlotInner: { flex: 1, borderRadius: Radius.lg, overflow: 'hidden', position: 'relative' },
  photoSlotEmpty: { backgroundColor: Colors.surface, borderWidth: 1.5, borderStyle: 'dashed', borderColor: Colors.surfaceBorder, alignItems: 'center', justifyContent: 'center' },
  photoSlotRequired: { borderColor: KOC.gold + '50' },
  photoSlotCaptured: { borderWidth: 2, borderColor: Colors.success + '70', borderStyle: 'solid' },
  emptySlot: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 5, paddingHorizontal: Spacing.sm },
  emptySlotIcon: { width: 48, height: 48, borderRadius: Radius.md, backgroundColor: Colors.surfaceHighlight, alignItems: 'center', justifyContent: 'center' },
  emptySlotIconRequired: { backgroundColor: KOC.goldDim },
  emptySlotLabel: { fontSize: 11, fontWeight: Typography.weight.semibold, color: Colors.textSecondary, textAlign: 'center' },
  requiredPill: { backgroundColor: KOC.goldDim, borderRadius: Radius.pill, paddingHorizontal: 6, paddingVertical: 2 },
  requiredPillText: { fontSize: 8, fontWeight: Typography.weight.bold, color: KOC.gold, textTransform: 'uppercase', letterSpacing: 0.3 },
  optionalLabel: { fontSize: 8, color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.2 },
  slotHint: { fontSize: 9, color: Colors.textTertiary, textAlign: 'center', lineHeight: 13, marginTop: 2 },
  capturedOverlay: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.62)', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 5, gap: 4 },
  capturedLabel: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4 },
  capturedLabelText: { fontSize: 9, color: '#fff', fontWeight: Typography.weight.semibold, flex: 1 },
  retakeBtn: { backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: Radius.sm, paddingHorizontal: 6, paddingVertical: 3 },
  removeBtn: { position: 'absolute', top: 6, right: 6, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 10, width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },

  tipBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, backgroundColor: KOC.goldDim, borderRadius: Radius.md, padding: Spacing.sm, borderWidth: 1, borderColor: KOC.gold + '25' },
  tipText: { flex: 1, fontSize: 11, color: KOC.gold, lineHeight: 16 },

  actionBar: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: Colors.surface, borderTopWidth: 1, borderTopColor: Colors.surfaceBorder, padding: Spacing.base, flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  actionBarInfo: { flex: 1, gap: 2 },
  actionBarCount: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.textPrimary },
  actionBarHint: { fontSize: Typography.size.xs, color: Colors.warning },
  actionBarReady: { fontSize: Typography.size.xs, color: Colors.success },
  identifyBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: Spacing.sm, backgroundColor: KOC.gold, borderRadius: Radius.md, padding: Spacing.md,
    shadowColor: KOC.gold, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.4, shadowRadius: 10, elevation: 6,
  },
  identifyBtnDisabled: { backgroundColor: Colors.surfaceHighlight, shadowOpacity: 0 },
  identifyBtnText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: KOC.dark },

  // Processing step
  processingView: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.xl, padding: Spacing.xl },
  processingOrb: { width: 80, height: 80, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  processingRing: { position: 'absolute', width: 80, height: 80, borderRadius: 40, borderWidth: 2 },
  processingTitle: { fontSize: Typography.size.xl, fontWeight: Typography.weight.bold, color: KOC.gold },
  processingStatus: { fontSize: Typography.size.sm, color: Colors.textSecondary, textAlign: 'center' },
  processingSteps: { gap: Spacing.sm, alignSelf: 'stretch' },
  processingStep: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surface, borderRadius: Radius.md, padding: Spacing.md, borderWidth: 1, borderColor: KOC.goldDim },
  processingStepText: { fontSize: Typography.size.sm, color: Colors.textSecondary },
  aiBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: KOC.goldDim, borderRadius: Radius.pill, paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs, borderWidth: 1, borderColor: KOC.gold + '30' },
  aiBadgeText: { fontSize: Typography.size.xs, color: KOC.gold },

  // Measure step
  measureHeader: { alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.lg },
  measureHeaderIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: KOC.goldDim, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: KOC.gold + '40' },
  measureTitle: { fontSize: Typography.size.xl, fontWeight: Typography.weight.bold, color: KOC.gold, textAlign: 'center' },
  measureSub: { fontSize: Typography.size.sm, color: Colors.textSecondary, textAlign: 'center', lineHeight: 20, paddingHorizontal: Spacing.base },
  catSpecCard: { backgroundColor: Colors.surface, borderRadius: Radius.xl, padding: Spacing.base, gap: Spacing.sm, borderWidth: 1, borderColor: KOC.gold + '30' },
  catSpecTitle: { fontSize: 10, fontWeight: Typography.weight.bold, color: KOC.gold, textTransform: 'uppercase', letterSpacing: 0.5 },
  catSpecSub: { fontSize: Typography.size.sm, color: Colors.textSecondary, lineHeight: 18 },
  catSpecRow: { flexDirection: 'row', gap: Spacing.md, flexWrap: 'wrap', marginTop: Spacing.xs },
  catSpecItem: { flex: 1, backgroundColor: KOC.goldDim, borderRadius: Radius.md, padding: Spacing.md, alignItems: 'center', gap: 4, minWidth: 80 },
  catSpecLabel: { fontSize: 9, fontWeight: Typography.weight.bold, color: KOC.gold, textTransform: 'uppercase', letterSpacing: 0.4 },
  catSpecValue: { fontSize: Typography.size.lg, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  measureCard: { backgroundColor: Colors.surface, borderRadius: Radius.xl, padding: Spacing.base, gap: Spacing.md, borderWidth: 1, borderColor: Colors.surfaceBorder },
  measureCardTitle: { fontSize: 10, fontWeight: Typography.weight.bold, color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5 },
  measureInputRow: { flexDirection: 'row', gap: Spacing.md },
  measureField: { flex: 1, gap: Spacing.xs },
  measureFieldLabel: { fontSize: Typography.size.xs, fontWeight: Typography.weight.semibold, color: Colors.textSecondary },
  measureInputWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.surfaceBorder, paddingHorizontal: Spacing.md, gap: Spacing.xs },
  measureInput: { flex: 1, fontSize: Typography.size.base, fontWeight: Typography.weight.bold, color: Colors.textPrimary, paddingVertical: Spacing.md, includeFontPadding: false },
  measureUnit: { fontSize: Typography.size.xs, color: Colors.textTertiary, fontWeight: Typography.weight.semibold },
  measureResultCard: { backgroundColor: Colors.surface, borderRadius: Radius.xl, padding: Spacing.base, gap: Spacing.sm, borderWidth: 1, borderColor: Colors.surfaceBorder },
  measureResultTitle: { fontSize: 10, fontWeight: Typography.weight.bold, color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5 },
  measureResultRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.md, padding: Spacing.sm },
  measureResultText: { flex: 1, fontSize: Typography.size.xs, color: Colors.textSecondary, lineHeight: 16 },
  measureActions: { gap: Spacing.sm },
  measureConfirmBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, backgroundColor: KOC.gold, borderRadius: Radius.md, padding: Spacing.base },
  measureConfirmBtnText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: KOC.dark },
  measureProceedBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, backgroundColor: Colors.success, borderRadius: Radius.md, padding: Spacing.base },
  measureProceedText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.background },
  measureSkipBtn: { alignItems: 'center', paddingVertical: Spacing.sm },
  measureSkipText: { fontSize: Typography.size.xs, color: Colors.textTertiary, fontWeight: Typography.weight.medium },

  // Review step
  savedBanner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.successDim, borderRadius: Radius.md, padding: Spacing.md, borderWidth: 1, borderColor: Colors.success + '40' },
  savedBannerText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.success },

  resultCard: { flexDirection: 'row', gap: Spacing.md, alignItems: 'flex-start', backgroundColor: Colors.surface, borderRadius: Radius.xl, padding: Spacing.base, borderWidth: 1, borderColor: KOC.gold + '25' },
  confidenceBadge: { width: 64, height: 64, borderRadius: Radius.lg, backgroundColor: Colors.surfaceElevated, alignItems: 'center', justifyContent: 'center', borderWidth: 2 },
  confidencePct: { fontSize: Typography.size.md, fontWeight: Typography.weight.bold },
  confidenceLabel: { fontSize: 8, textTransform: 'uppercase', letterSpacing: 0.4 },
  resultTitle: { fontSize: Typography.size.base, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  resultCondition: { fontSize: Typography.size.sm, color: Colors.textSecondary },
  resultSourceRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  resultSource: { fontSize: Typography.size.xs, color: Colors.textTertiary },
  coinsBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: KOC.goldDim, borderRadius: Radius.sm, paddingHorizontal: 5, paddingVertical: 2 },
  coinsBadgeText: { fontSize: 9, fontWeight: Typography.weight.bold, color: KOC.gold, textTransform: 'uppercase', letterSpacing: 0.3 },

  warningCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.warningDim, borderRadius: Radius.md, padding: Spacing.md, borderWidth: 1, borderColor: Colors.warning + '40' },
  warningText: { flex: 1, fontSize: Typography.size.xs, color: Colors.warning },

  imageThumb: { width: 80, height: 80, borderRadius: Radius.md },

  numistaCard: { backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.xs, borderWidth: 1 },
  numistaCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 3 },
  numistaCardTitle: { flex: 1, fontSize: Typography.size.xs, fontWeight: Typography.weight.semibold, textTransform: 'uppercase', letterSpacing: 0.4 },
  numistaScore: { fontSize: 10, color: Colors.textTertiary },
  numistaTitle: { fontSize: Typography.size.sm, color: Colors.textSecondary, lineHeight: 18 },

  evidenceCard: { backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.xs, borderWidth: 1, borderColor: Colors.surfaceBorder },
  evidenceTitle: { fontSize: 10, fontWeight: Typography.weight.semibold, color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 3 },
  evidenceRow: { flexDirection: 'row', gap: 6, alignItems: 'flex-start' },
  evidenceText: { flex: 1, fontSize: Typography.size.xs, color: Colors.textSecondary, lineHeight: 16 },

  valuationCard: { backgroundColor: Colors.surface, borderRadius: Radius.xl, padding: Spacing.base, gap: Spacing.md, borderWidth: 1, borderColor: Colors.surfaceBorder },
  valuationHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  valuationTitle: { fontSize: Typography.size.xs, fontWeight: Typography.weight.semibold, color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5 },
  valBadge: { paddingHorizontal: Spacing.sm, paddingVertical: 2, borderRadius: Radius.pill, flexDirection: 'row', alignItems: 'center', gap: 5 },
  valBadgeText: { fontSize: Typography.size.xs, fontWeight: Typography.weight.semibold },
  priceRow: { flexDirection: 'row', justifyContent: 'space-around' },
  priceItem: { alignItems: 'center', gap: 2 },
  priceMidItem: { backgroundColor: KOC.goldDim, borderRadius: Radius.lg, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, alignItems: 'center', gap: 2 },
  priceLabel: { fontSize: Typography.size.xs, color: Colors.textTertiary },
  priceValue: { fontSize: Typography.size.xl, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  noDataRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.xs, backgroundColor: Colors.warningDim, borderRadius: Radius.sm, padding: Spacing.sm },
  noDataText: { flex: 1, fontSize: Typography.size.xs, color: Colors.warning, lineHeight: 16 },

  attrsCard: { backgroundColor: Colors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceBorder, overflow: 'hidden' },
  attrsTitle: { fontSize: 10, fontWeight: Typography.weight.bold, color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5, padding: Spacing.md, paddingBottom: Spacing.sm, backgroundColor: Colors.surfaceHighlight },
  attrRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder },
  attrKey: { fontSize: Typography.size.xs, color: Colors.textTertiary, textTransform: 'capitalize', flex: 1 },
  attrValue: { fontSize: Typography.size.xs, fontWeight: Typography.weight.semibold, color: Colors.textPrimary, flex: 1, textAlign: 'right' },

  conditionCard: { backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.surfaceBorder },
  conditionTitle: { fontSize: 10, fontWeight: Typography.weight.bold, color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: Spacing.xs },
  conditionText: { fontSize: Typography.size.sm, color: Colors.textSecondary, lineHeight: 20 },

  warnCard: { backgroundColor: Colors.dangerDim, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.sm, borderWidth: 1, borderColor: Colors.danger + '30' },

  feedbackCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.accentDim, borderRadius: Radius.md, padding: Spacing.md, borderWidth: 1, borderColor: Colors.accent + '40' },
  feedbackQuestion: { fontSize: 11, color: Colors.textPrimary, fontWeight: Typography.weight.semibold },
  fbNo: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.dangerDim, borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderWidth: 1, borderColor: Colors.danger + '40' },
  fbYes: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.success, borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },

  ebayCard: { backgroundColor: Colors.surface, borderRadius: Radius.xl, borderWidth: 1, borderColor: Colors.info + '25', overflow: 'hidden' },
  ebayCardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: Spacing.md, gap: Spacing.sm },
  ebayCardLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flex: 1 },
  ebayIconWrap: { width: 26, height: 26, borderRadius: Radius.sm, backgroundColor: Colors.info + '20', alignItems: 'center', justifyContent: 'center' },
  ebayCardTitle: { fontSize: 10, fontWeight: Typography.weight.bold, color: Colors.info, textTransform: 'uppercase', letterSpacing: 0.5 },
  ebayCardSub: { fontSize: Typography.size.xs, color: Colors.textTertiary, marginTop: 1 },
  ebayDisclaimer: { flexDirection: 'row', alignItems: 'flex-start', gap: 4, marginHorizontal: Spacing.md, marginBottom: Spacing.xs, backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.sm, padding: Spacing.xs },
  ebayDisclaimerText: { flex: 1, fontSize: 9, color: Colors.textTertiary, lineHeight: 13 },
  ebayItem: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, padding: Spacing.sm, borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder + '60' },
  ebayItemImg: { width: 44, height: 44, borderRadius: Radius.sm, flexShrink: 0 },
  ebayItemTitle: { fontSize: Typography.size.xs, color: Colors.textSecondary, lineHeight: 16 },
  ebayItemPrice: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  ebayShowMore: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, padding: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.surfaceBorder },
  ebayShowMoreText: { fontSize: Typography.size.xs, color: Colors.info, fontWeight: Typography.weight.semibold },

  disclaimer: { flexDirection: 'row', gap: Spacing.xs, backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.sm, padding: Spacing.sm },
  disclaimerText: { fontSize: Typography.size.xs, color: Colors.textTertiary, flex: 1, lineHeight: 16 },

  reviewActions: { flexDirection: 'row', gap: Spacing.sm },
  scanAnotherBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.md, borderRadius: Radius.md, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.surfaceBorder },
  scanAnotherText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.textSecondary },
  primaryAction: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: Spacing.sm, backgroundColor: KOC.gold, borderRadius: Radius.md, padding: Spacing.md,
    shadowColor: KOC.gold, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.35, shadowRadius: 10, elevation: 5,
  },
  primaryActionText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: KOC.dark },
});

// ── Paywall styles ───────────────────────────────────────────────────────────────
const pw = StyleSheet.create({
  container: { padding: Spacing.base, gap: Spacing.lg },

  hero: {
    backgroundColor: KOC.dark, borderRadius: Radius.xxl,
    borderWidth: 1, borderColor: KOC.gold + '30',
    alignItems: 'center', padding: Spacing.xl, gap: Spacing.md,
  },
  lockRing: {
    width: 100, height: 100,
    alignItems: 'center', justifyContent: 'center', position: 'relative',
  },
  heroTitle: {
    fontSize: Typography.size.xl, fontWeight: Typography.weight.bold, color: KOC.gold,
  },
  heroSub: {
    fontSize: Typography.size.sm, color: Colors.textSecondary,
    textAlign: 'center', lineHeight: 20,
  },

  featureCard: {
    backgroundColor: Colors.surface, borderRadius: Radius.xl, borderWidth: 1,
    borderColor: Colors.surfaceBorder, overflow: 'hidden',
  },
  featureTitle: {
    fontSize: 10, fontWeight: Typography.weight.bold, color: Colors.textTertiary,
    textTransform: 'uppercase', letterSpacing: 0.5,
    padding: Spacing.md, paddingBottom: Spacing.sm,
    backgroundColor: Colors.surfaceHighlight,
  },
  featureRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    padding: Spacing.sm, paddingHorizontal: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder + '60',
  },
  featureIcon: {
    width: 28, height: 28, borderRadius: Radius.sm,
    backgroundColor: KOC.goldDim, alignItems: 'center', justifyContent: 'center',
  },
  featureText: {
    flex: 1, fontSize: Typography.size.sm, color: Colors.textSecondary, lineHeight: 18,
  },

  planCard: {
    backgroundColor: Colors.surface, borderRadius: Radius.xl, borderWidth: 1,
    borderColor: Colors.surfaceBorder, padding: Spacing.base, gap: Spacing.sm,
  },
  planTitle: {
    fontSize: 10, fontWeight: Typography.weight.bold, color: Colors.textTertiary,
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  planRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
  },
  planName: {
    fontSize: Typography.size.base, fontWeight: Typography.weight.bold,
    color: Colors.textPrimary, flex: 1,
  },
  planBadge: {
    backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.pill,
    paddingHorizontal: Spacing.sm, paddingVertical: 4,
    borderWidth: 1, borderColor: Colors.surfaceBorder,
    maxWidth: 160,
  },
  planBadgeText: {
    fontSize: 10, color: Colors.textTertiary, fontWeight: Typography.weight.medium,
  },
  planSub: {
    fontSize: Typography.size.xs, color: Colors.warning, lineHeight: 16,
  },

  upgradeBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: Spacing.sm, backgroundColor: KOC.gold,
    borderRadius: Radius.md, paddingVertical: Spacing.base,
    shadowColor: KOC.gold, shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4, shadowRadius: 12, elevation: 6,
  },
  upgradeBtnText: {
    fontSize: Typography.size.base, fontWeight: Typography.weight.bold, color: KOC.dark,
  },
  upgradeNote: {
    fontSize: Typography.size.xs, color: Colors.textTertiary,
    textAlign: 'center', lineHeight: 18,
    paddingHorizontal: Spacing.md,
  },

  cancelBtn: {
    alignItems: 'center', paddingVertical: Spacing.sm,
  },
  cancelBtnText: {
    fontSize: Typography.size.sm, color: Colors.textTertiary,
    fontWeight: Typography.weight.medium,
  },
});
