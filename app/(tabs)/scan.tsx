// SWISH Universal Scanner & Intake
// Real AI identification via OnSpace AI (Gemini 3 Flash vision).
// Captures images with device camera or photo library, routes through
// specialist framework, and persists results to the real database.

import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, Pressable, ScrollView,
  TextInput, ActivityIndicator, Linking, Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { SPECIALIST_LIST, SpecialistId, SPECIALISTS, SpecialistConfig } from '@/constants/specialists';
import { NICHES } from '@/constants/niches';
import { Colors, Typography, Spacing, Radius, Shadow } from '@/constants/theme';
import { getSupabaseClient } from '@/template';
import { useApp } from '@/hooks/useApp';
import { Platform } from 'react-native';
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
import {
  searchEbayByImage,
  EbayVisualSearchResult,
  formatAskingPriceRange,
} from '@/services/ebayVisualSearchService';
import { getMarketValue, MarketValueResult } from '@/services/marketValueService';
import { recordAIFeedback, FeedbackVerdict } from '@/services/aiLearningService';
import { recordPrediction } from '@/services/predictionService';
import { CONFIDENCE_THRESHOLDS } from '@/constants/config';

type ScanStep = 'choose_method' | 'select_specialist' | 'capture' | 'processing' | 'review' | 'measure';
type CaptureMethod = 'camera' | 'upload' | 'manual' | 'bulk';
type PermissionStatus = 'checking' | 'granted' | 'denied' | 'blocked';

const MAX_PHOTOS = 4;

// Derive up to 4 slot definitions from specialist captureRequirements
function getPhotoSlots(spec: SpecialistConfig | null): Array<{ id: string; label: string; hint?: string; required: boolean }> {
  if (!spec) {
    return [
      { id: 'photo_1', label: 'Photo 1', required: true },
      { id: 'photo_2', label: 'Photo 2', required: false },
      { id: 'photo_3', label: 'Photo 3', required: false },
      { id: 'photo_4', label: 'Photo 4', required: false },
    ];
  }
  const base = spec.captureRequirements.slice(0, MAX_PHOTOS).map(r => ({
    id: r.id,
    label: r.label,
    hint: r.hint,
    required: r.required,
  }));
  // Pad to MAX_PHOTOS with optional extra slots
  while (base.length < MAX_PHOTOS) {
    const n = base.length + 1;
    base.push({ id: `extra_${n}`, label: `Extra ${n - (spec.captureRequirements.length)}`, hint: 'Additional angle or detail', required: false });
  }
  return base;
}

// On TV, hide Camera Scan and Upload (no camera / gallery on Fire Stick)
const ALL_CAPTURE_METHODS = [
  { id: 'camera' as CaptureMethod, icon: 'photo-camera', label: 'Camera Scan', desc: 'Photograph items for AI identification', tvHidden: true },
  { id: 'upload' as CaptureMethod, icon: 'upload', label: 'Upload Media', desc: 'Import existing photos from library', tvHidden: true },
  { id: 'manual' as CaptureMethod, icon: 'edit', label: 'Manual Entry', desc: 'Enter item details manually', tvHidden: false },
  { id: 'bulk' as CaptureMethod, icon: 'burst-mode', label: 'Bulk Capture', desc: 'Process multiple items in sequence', tvHidden: false },
];
const CAPTURE_METHODS = IS_TV
  ? ALL_CAPTURE_METHODS.filter(m => !m.tvHidden)
  : ALL_CAPTURE_METHODS;

const CONFIDENCE_COLOR = (c: number) => {
  if (c >= 0.85) return Colors.success;
  if (c >= 0.65) return Colors.warning;
  return Colors.danger;
};

// ── Permission Gate ────────────────────────────────────────────────────────

function PermissionGate({ onGranted }: { onGranted: () => void }) {
  const insets = useSafeAreaInsets();
  const [requesting, setRequesting] = useState(false);
  const [wasBlocked, setWasBlocked] = useState(false);

  const handleRequest = useCallback(async () => {
    setRequesting(true);
    const camera = await ImagePicker.requestCameraPermissionsAsync();
    const media = await ImagePicker.requestMediaLibraryPermissionsAsync();
    setRequesting(false);

    if (camera.granted || media.granted) {
      onGranted();
      return;
    }
    // canAskAgain=false means OS has permanently blocked it
    if (!camera.canAskAgain && !media.canAskAgain) {
      setWasBlocked(true);
    }
  }, [onGranted]);

  const handleOpenSettings = useCallback(() => {
    Linking.openSettings();
  }, []);

  return (
    <View style={[pgStyles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      {/* Scan reticle illustration */}
      <View style={pgStyles.iconWrap}>
        <View style={pgStyles.reticle}>
          <View style={[pgStyles.corner, pgStyles.cornerTL]} />
          <View style={[pgStyles.corner, pgStyles.cornerTR]} />
          <View style={[pgStyles.corner, pgStyles.cornerBL]} />
          <View style={[pgStyles.corner, pgStyles.cornerBR]} />
          <MaterialIcons name={wasBlocked ? 'no-photography' : 'photo-camera'} size={40} color={wasBlocked ? Colors.textTertiary : Colors.primary} />
        </View>
      </View>

      <View style={pgStyles.textBlock}>
        <Text style={pgStyles.title}>
          {wasBlocked ? 'Camera Access Blocked' : 'Camera Access Required'}
        </Text>
        <Text style={pgStyles.body}>
          {wasBlocked
            ? 'SWISH needs camera and photo library access to scan and identify items. Please enable permissions in your device Settings, then return to SWISH.'
            : 'SWISH uses your camera and photo library to photograph items for AI identification. Your photos are only used for item identification — never stored or shared without your consent.'}
        </Text>
      </View>

      {wasBlocked ? (
        <View style={pgStyles.actions}>
          <Pressable
            onPress={handleOpenSettings}
            style={({ pressed }) => [pgStyles.primaryBtn, pressed && { opacity: 0.85 }]}
          >
            <MaterialIcons name="settings" size={18} color={Colors.background} />
            <Text style={pgStyles.primaryBtnText}>Open Settings</Text>
          </Pressable>
          <View style={pgStyles.blockedNote}>
            <MaterialIcons name="info-outline" size={13} color={Colors.textTertiary} />
            <Text style={pgStyles.blockedNoteText}>
              After enabling permissions in Settings, come back and tap the Scan tab again.
            </Text>
          </View>
        </View>
      ) : (
        <View style={pgStyles.actions}>
          <Pressable
            onPress={handleRequest}
            disabled={requesting}
            style={({ pressed }) => [pgStyles.primaryBtn, pressed && { opacity: 0.85 }, requesting && { opacity: 0.7 }]}
          >
            {requesting ? (
              <ActivityIndicator size="small" color={Colors.background} />
            ) : (
              <MaterialIcons name="photo-camera" size={18} color={Colors.background} />
            )}
            <Text style={pgStyles.primaryBtnText}>
              {requesting ? 'Requesting...' : 'Grant Camera Access'}
            </Text>
          </Pressable>
          <View style={pgStyles.permBullets}>
            {[
              { icon: 'photo-camera', text: 'Camera — photograph items for AI scanning' },
              { icon: 'photo-library', text: 'Photo Library — import existing images' },
            ].map(b => (
              <View key={b.icon} style={pgStyles.bullet}>
                <View style={pgStyles.bulletIcon}>
                  <MaterialIcons name={b.icon as any} size={13} color={Colors.primary} />
                </View>
                <Text style={pgStyles.bulletText}>{b.text}</Text>
              </View>
            ))}
          </View>
        </View>
      )}
    </View>
  );
}

const pgStyles = StyleSheet.create({
  container: {
    flex: 1, backgroundColor: Colors.background,
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: Spacing.xl, gap: Spacing.xl,
  },
  iconWrap: { alignItems: 'center', justifyContent: 'center' },
  reticle: {
    width: 120, height: 120, alignItems: 'center', justifyContent: 'center',
    position: 'relative',
  },
  corner: { position: 'absolute', width: 24, height: 24, borderColor: Colors.primary, borderWidth: 3 },
  cornerTL: { top: 0, left: 0, borderRightWidth: 0, borderBottomWidth: 0 },
  cornerTR: { top: 0, right: 0, borderLeftWidth: 0, borderBottomWidth: 0 },
  cornerBL: { bottom: 0, left: 0, borderRightWidth: 0, borderTopWidth: 0 },
  cornerBR: { bottom: 0, right: 0, borderLeftWidth: 0, borderTopWidth: 0 },
  textBlock: { alignItems: 'center', gap: Spacing.md },
  title: {
    fontSize: Typography.size.xl, fontWeight: Typography.weight.bold,
    color: Colors.textPrimary, textAlign: 'center',
  },
  body: {
    fontSize: Typography.size.sm, color: Colors.textSecondary,
    textAlign: 'center', lineHeight: 22,
  },
  actions: { alignSelf: 'stretch', gap: Spacing.md },
  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: Spacing.sm, backgroundColor: Colors.primary,
    borderRadius: Radius.md, paddingVertical: Spacing.base,
    ...Shadow.glow,
  },
  primaryBtnText: { fontSize: Typography.size.base, fontWeight: Typography.weight.bold, color: Colors.background },
  permBullets: {
    backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: Spacing.md,
    gap: Spacing.sm, borderWidth: 1, borderColor: Colors.surfaceBorder,
  },
  bullet: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  bulletIcon: {
    width: 30, height: 30, borderRadius: Radius.sm,
    backgroundColor: Colors.primaryDim, alignItems: 'center', justifyContent: 'center',
  },
  bulletText: { flex: 1, fontSize: Typography.size.sm, color: Colors.textSecondary, lineHeight: 19 },
  blockedNote: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm,
    backgroundColor: Colors.warningDim, borderRadius: Radius.md, padding: Spacing.md,
    borderWidth: 1, borderColor: Colors.warning + '40',
  },
  blockedNoteText: { flex: 1, fontSize: Typography.size.xs, color: Colors.textSecondary, lineHeight: 17 },
});

// ── Main Screen ─────────────────────────────────────────────────────────────

export default function ScanScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { tenant, setScanMode, activeNiche, activeNicheId } = useApp();

  const [permissionStatus, setPermissionStatus] = useState<PermissionStatus>('checking');
  const [step, setStep] = useState<ScanStep>('choose_method');
  const [selectedMethod, setSelectedMethod] = useState<CaptureMethod>('camera');
  const [selectedSpecialist, setSelectedSpecialist] = useState<SpecialistId | null>(null);
  const [capturedImages, setCapturedImages] = useState<CapturedImage[]>([]);
  const [processingStatus, setProcessingStatus] = useState('');
  const [idResult, setIdResult] = useState<AIIdentificationResult | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const [savedItemId, setSavedItemId] = useState<string | null>(null);
  const [specialistSearch, setSpecialistSearch] = useState('');
  const [aiError, setAiError] = useState<string | null>(null);
  const [feedbackVerdict, setFeedbackVerdict] = useState<FeedbackVerdict | null>(null);
  const [feedbackSaving, setFeedbackSaving] = useState(false);

  // Physical measurement verification
  const [measureWeight, setMeasureWeight] = useState('');
  const [measureDiameter, setMeasureDiameter] = useState('');
  const [measureChecking, setMeasureChecking] = useState(false);
  const [measureResult, setMeasureResult] = useState<{
    weightMatch: 'strong' | 'moderate' | 'weak' | 'contradiction' | 'unknown';
    diameterMatch: 'strong' | 'moderate' | 'weak' | 'contradiction' | 'unknown';
    catWeight?: number;
    catDiameter?: number;
    notes: string[];
  } | null>(null);

  // eBay visual search (triggered automatically on review step)
  const [ebayVisualResult, setEbayVisualResult] = useState<EbayVisualSearchResult | null>(null);
  const [ebayVisualLoading, setEbayVisualLoading] = useState(false);
  const [ebayVisualExpanded, setEbayVisualExpanded] = useState(false);

  // Market valuation (triggered automatically on review step)
  const [valuationResult, setValuationResult] = useState<MarketValueResult | null>(null);
  const [valuationLoading, setValuationLoading] = useState(false);
  const [valuationError, setValuationError] = useState<string | null>(null);

  const specialist = selectedSpecialist ? SPECIALISTS[selectedSpecialist] : null;

  // ── Permission check on mount ────────────────────────────────────────────────

  useEffect(() => {
    // Fire Stick / Android TV has no camera or photo library — skip permission check
    if (IS_TV) {
      setPermissionStatus('granted');
      return;
    }
    let mounted = true;
    async function checkPermissions() {
      if (Platform.OS === 'web') {
        if (mounted) setPermissionStatus('granted');
        return;
      }
      try {
        const camera = await ImagePicker.getCameraPermissionsAsync();
        const media = await ImagePicker.getMediaLibraryPermissionsAsync();
        if (!mounted) return;
        if (camera.granted || media.granted) {
          setPermissionStatus('granted');
        } else if (!camera.canAskAgain && !media.canAskAgain) {
          setPermissionStatus('blocked');
        } else {
          setPermissionStatus('denied');
        }
      } catch {
        if (mounted) setPermissionStatus('granted'); // fail open so app does not stall
      }
    }
    checkPermissions();
    return () => { mounted = false; };
  }, []);

  const handlePermissionGranted = useCallback(() => {
    setPermissionStatus('granted');
  }, []);

  // ── Navigation helpers ──────────────────────────────────────────────────────

  // Trigger eBay visual search + market valuation automatically when entering review step
  useEffect(() => {
    if (step !== 'review' || !idResult || !tenant) return;

    // ── eBay visual search ────────────────────────────────────────────────────
    const primaryImage = capturedImages[0]?.uri;
    if (primaryImage) {
      setEbayVisualResult(null);
      setEbayVisualLoading(true);
      searchEbayByImage({
        tenantId: tenant.id,
        imageDataUri: primaryImage.startsWith('data:') ? primaryImage : undefined,
        imageBase64: !primaryImage.startsWith('data:') && !primaryImage.startsWith('http') ? primaryImage : undefined,
        limit: 5,
      }).then(result => {
        setEbayVisualResult(result);
        setEbayVisualLoading(false);
      });
    }

    // ── Market valuation ─────────────────────────────────────────────────────
    // Only run if we haven't already fetched (avoids double-call on step re-entry)
    if (valuationResult || valuationLoading) return;
    if (!idResult.canonicalTitle || idResult.canonicalTitle.length < 3) return;

    setValuationLoading(true);
    setValuationError(null);
    getMarketValue({
      tenantId: tenant.id,
      title: idResult.canonicalTitle,
      specialistId: idResult.specialistId ?? 'curiosities_collectibles',
      attributes: idResult.attributes ?? {},
      condition: idResult.condition ?? '',
      identificationConfidence: idResult.confidence ?? 0,
      identificationTier: idResult.confidenceTier ?? 'medium',
      numistaTypeId: idResult.numistaVerification?.typeId ? Number(idResult.numistaVerification.typeId) : null,
      numistaMatchScore: idResult.numistaMatchScore ?? 0,
      numistaMatchTier: idResult.numistaStatus ?? 'no_match',
      applyToItem: false, // do not write to DB here — item may not be saved yet
    }).then(({ result, error }) => {
      setValuationLoading(false);
      if (error || !result) {
        setValuationError(error ?? 'Valuation unavailable');
      } else {
        setValuationResult(result);
      }
    });
  }, [step, idResult, tenant]); // intentionally omit capturedImages / valuationResult to avoid re-triggering

  const handleReset = useCallback(() => {
    setStep('choose_method');
    setSelectedMethod('camera');
    setSelectedSpecialist(null);
    setCapturedImages([]);
    setProcessingStatus('');
    setIdResult(null);
    setAiError(null);
    setSavedItemId(null);
    setIsUploading(false);
    setUploadProgress('');
    setScanMode('idle');
    setFeedbackVerdict(null);
    setFeedbackSaving(false);
    setEbayVisualResult(null);
    setEbayVisualLoading(false);
    setEbayVisualExpanded(false);
    setValuationResult(null);
    setValuationLoading(false);
    setValuationError(null);
    setMeasureWeight('');
    setMeasureDiameter('');
    setMeasureChecking(false);
    setMeasureResult(null);
  }, [setScanMode]);

  const handleMethodSelect = useCallback(async (methodId: CaptureMethod) => {
    setSelectedMethod(methodId);
    setStep('select_specialist');
  }, []);

  const handleSpecialistSelect = useCallback((id: SpecialistId) => {
    setSelectedSpecialist(id);
    setCapturedImages([]);
    setScanMode('capturing');
    setStep('capture');
  }, [setScanMode]);

  // ── Image capture ───────────────────────────────────────────────────────────

  const handleCaptureSlot = useCallback(async (slotId: string, slotLabel: string) => {
    // Fire Stick has no camera or photo library
    if (IS_TV) {
      Alert.alert('Camera Not Available', 'Fire Stick has no camera. Use Manual Entry or import from eBay.');
      return;
    }
    let image: CapturedImage | null = null;

    if (selectedMethod === 'camera') {
      image = await captureFromCamera();
    } else {
      image = await pickFromLibrary(slotId, slotLabel);
    }

    if (!image) return;

    // Replace existing capture for this slot or append
    setCapturedImages((prev) => {
      const existing = prev.findIndex((i) => i.slotId === slotId);
      if (existing >= 0) {
        const updated = [...prev];
        updated[existing] = { ...image!, slotId, slotLabel };
        return updated;
      }
      return [...prev, { ...image!, slotId, slotLabel }];
    });
  }, [selectedMethod]);

  const handleRemoveImage = useCallback((slotId: string) => {
    setCapturedImages(prev => prev.filter(i => i.slotId !== slotId));
  }, []);

  // ── AI Identification ───────────────────────────────────────────────────────

  const handleIdentify = useCallback(async () => {
    if (!selectedSpecialist || capturedImages.length === 0) return;

    setStep('processing');
    setScanMode('processing');
    setAiError(null);

    const steps = [
      'Preparing images...',
      'Routing to specialist engine...',
      'AI vision analysis...',
      'Cross-referencing research data...',
      'Generating valuation...',
    ];

    for (const s of steps) {
      setProcessingStatus(s);
      await new Promise((r) => setTimeout(r, 400));
    }

    const { result, error, quotaExceeded } = await identifyItemWithAI(
      capturedImages,
      selectedSpecialist,
      undefined,
      undefined,
      { tenantId: tenant?.id },
    );

    if (quotaExceeded) {
      setAiError(
        `Monthly quota reached (${quotaExceeded.used}/${quotaExceeded.limit} free identifications used). Upgrade to SWISH Premium for unlimited AI identifications.`,
      );
      setScanMode('idle');
      setStep('capture');
      return;
    }

    if (error || !result) {
      setAiError(error ?? 'Identification failed');
      setScanMode('idle');
      setStep('capture');
      return;
    }

    setIdResult(result);
    setScanMode('reviewing');
    // For coins: show measurement verification step before review
    const isCoin = result.objectType === 'coin' || !result.objectType;
    const hasNumistaData = result.numistaVerification && result.numistaVerification.status !== 'unavailable';
    if (isCoin && hasNumistaData) {
      setStep('measure');
    } else {
      setStep('review');
    }
  }, [selectedSpecialist, capturedImages, setScanMode]);

  // ── Measurement verification ─────────────────────────────────────────────────

  const handleConfirmMeasurements = useCallback(async () => {
    if (!idResult) return;
    setMeasureChecking(true);

    const catWeight = idResult.numistaVerification?.weight ?? null;
    const catDiameter = idResult.numistaVerification?.diameter ?? null;
    const userWeight = measureWeight ? parseFloat(measureWeight) : null;
    const userDiameter = measureDiameter ? parseFloat(measureDiameter) : null;

    const notes: string[] = [];
    let weightMatch: 'strong' | 'moderate' | 'weak' | 'contradiction' | 'unknown' = 'unknown';
    let diameterMatch: 'strong' | 'moderate' | 'weak' | 'contradiction' | 'unknown' = 'unknown';

    if (userWeight && catWeight) {
      const diffPct = Math.abs(userWeight - catWeight) / catWeight;
      if (diffPct <= 0.03) {
        weightMatch = 'strong';
        notes.push(`Weight MATCH: ${userWeight}g vs catalogue ${catWeight}g (${(diffPct * 100).toFixed(1)}% diff)`);
      } else if (diffPct <= 0.07) {
        weightMatch = 'moderate';
        notes.push(`Weight moderate match: ${userWeight}g vs catalogue ${catWeight}g (${(diffPct * 100).toFixed(1)}% diff)`);
      } else if (diffPct <= 0.12) {
        weightMatch = 'weak';
        notes.push(`Weight weak match: ${userWeight}g vs catalogue ${catWeight}g — ${(diffPct * 100).toFixed(1)}% variance`);
      } else {
        weightMatch = 'contradiction';
        notes.push(`Weight CONTRADICTION: ${userWeight}g vs catalogue ${catWeight}g (${(diffPct * 100).toFixed(1)}% — exceeds 12% threshold). Identification uncertain.`);
      }
    } else if (userWeight) {
      notes.push(`Weight recorded: ${userWeight}g — no catalogue spec to compare`);
    }

    if (userDiameter && catDiameter) {
      const diffMm = Math.abs(userDiameter - catDiameter);
      if (diffMm <= 0.5) {
        diameterMatch = 'strong';
        notes.push(`Diameter MATCH: ${userDiameter}mm vs catalogue ${catDiameter}mm (${diffMm.toFixed(1)}mm diff)`);
      } else if (diffMm <= 1.5) {
        diameterMatch = 'moderate';
        notes.push(`Diameter moderate match: ${userDiameter}mm vs catalogue ${catDiameter}mm`);
      } else if (diffMm <= 3.0) {
        diameterMatch = 'weak';
        notes.push(`Diameter weak match: ${userDiameter}mm vs catalogue ${catDiameter}mm (${diffMm.toFixed(1)}mm diff)`);
      } else {
        diameterMatch = 'contradiction';
        notes.push(`Diameter CONTRADICTION: ${userDiameter}mm vs catalogue ${catDiameter}mm (${diffMm.toFixed(1)}mm — exceeds 3mm threshold).`);
      }
    } else if (userDiameter) {
      notes.push(`Diameter recorded: ${userDiameter}mm — no catalogue spec to compare`);
    }

    setMeasureResult({ weightMatch, diameterMatch, catWeight: catWeight ?? undefined, catDiameter: catDiameter ?? undefined, notes });
    setMeasureChecking(false);

    // Update idResult with measurements for Re-Value
    if (userWeight || userDiameter) {
      const updatedAttrs = {
        ...(idResult.attributes ?? {}),
        ...(userWeight ? { weight: userWeight, measured_weight: userWeight } : {}),
        ...(userDiameter ? { diameter: userDiameter, measured_diameter: userDiameter } : {}),
      };
      setIdResult(prev => prev ? { ...prev, attributes: updatedAttrs } : prev);
    }
  }, [idResult, measureWeight, measureDiameter]);

  const handleSkipMeasurement = useCallback(() => {
    setStep('review');
  }, []);

  const handleProceedAfterMeasure = useCallback(() => {
    setStep('review');
  }, []);

  // ── Save to inventory ─────────────────────────────────────────────────────────

  const handleFeedback = useCallback(async (verdict: FeedbackVerdict) => {
    if (!idResult || !tenant) return;
    setFeedbackSaving(true);
    setFeedbackVerdict(verdict);
    await recordAIFeedback({
      tenantId: tenant.id,
      specialistId: (idResult.specialistId as any) ?? 'curiosities_collectibles',
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

    // Save item first with placeholder (local) URIs
    const { item, error } = await saveIdentifiedItem(tenant.id, idResult, {
      mediaUris: capturedImages.map((i) => i.uri),
    });

    setIsSaving(false);

    if (error || !item) {
      Alert.alert('Save Failed', error ?? 'Could not save item to inventory.', [{ text: 'OK' }]);
      return;
    }

    setSavedItemId(item.id);

    // If we already have a valuation result, apply it to the saved item immediately
    if (valuationResult) {
      const v = valuationResult.valuation;
      const s = valuationResult.soldMarket;
      const supabase = getSupabaseClient();
      await supabase
        .from('items')
        .update({
          valuation_low: v?.valuationLow ?? 0,
          valuation_mid: v?.valuationMid ?? 0,
          valuation_high: v?.valuationHigh ?? 0,
          valuation_confidence: v?.valuationConfidence ?? 'low',
          expected_selling_price: v?.recommendedListingPrice ?? v?.valuationMid ?? 0,
          expected_net: v?.fairMarketValue ?? v?.valuationMid ?? 0,
          sale_prob_30d: v?.saleProb30d ?? 0,
          updated_at: new Date().toISOString(),
        })
        .eq('id', item.id)
        .eq('tenant_id', tenant.id);
    }

    // Upload images to Storage in the background to replace file:// with https://
    if (capturedImages.length > 0) {
      setIsUploading(true);
      setUploadProgress('Uploading photos...');
      try {
        const { urls, errors } = await uploadItemImages(item.id, capturedImages);
        if (urls.length > 0) {
          await updateItemMedia(tenant.id, item.id, urls);
          setUploadProgress(`${urls.length} photo${urls.length === 1 ? '' : 's'} saved permanently`);
        } else {
          setUploadProgress('Photos saved locally');
        }
      } catch {
        setUploadProgress('Photos saved locally');
      } finally {
        setIsUploading(false);
      }
    }

    // Record baseline predictions — only if we have actual evidence-based values
    if (idResult.confidence > 0) {
      // Only record prediction if item was valued — identification alone gives no market value
      // Valuation predictions are recorded by swish-market-value when Re-Value is run
      const estimatedDays = 90; // conservative default until Re-Value runs
      recordPrediction(tenant.id, {
        entityType: 'item',
        entityId: item.id,
        predictionType: 'time_to_sale',
        predictedValue: estimatedDays,
        predictedConfidence: idResult.confidenceTier === 'high' || idResult.confidenceTier === 'very_high' ? 'medium' : 'low',
        predictedReasoning: `Identification confidence ${Math.round(idResult.confidence * 100)}% (${idResult.confidenceTier}) — run Re-Value for evidence-based pricing and sale probability`,
      }).catch(() => {});
    }
  }, [idResult, tenant, capturedImages]);

  // ── Derived ─────────────────────────────────────────────────────────────────

  const filteredSpecialists = SPECIALIST_LIST.filter((s) =>
    !specialistSearch ||
    s.name.toLowerCase().includes(specialistSearch.toLowerCase()) ||
    s.category.includes(specialistSearch.toLowerCase())
  );

  const photoSlots = getPhotoSlots(specialist);
  const captureSlots = specialist?.captureRequirements ?? [];
  const requiredSlots = photoSlots.filter(r => r.required);
  const capturedRequired = requiredSlots.filter(r => capturedImages.some(i => i.slotId === r.id)).length;
  const canIdentify = capturedImages.length > 0;

  // ── Render ───────────────────────────────────────────────────────────────────

  // Show spinner while we check the current permission state
  if (permissionStatus === 'checking') {
    return (
      <View style={[styles.container, { alignItems: 'center', justifyContent: 'center' }]}>
        <StatusBar style="light" />
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={{ color: Colors.textTertiary, fontSize: Typography.size.sm, marginTop: Spacing.md }}>
          Checking permissions...
        </Text>
      </View>
    );
  }

  // Show full-screen permission gate if not yet granted
  if (permissionStatus === 'denied' || permissionStatus === 'blocked') {
    return (
      <>
        <StatusBar style="light" />
        <PermissionGate onGranted={handlePermissionGranted} />
      </>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + Spacing.base }]}>
        {step !== 'choose_method' ? (
          <Pressable onPress={handleReset} style={styles.backBtn} hitSlop={8}>
            <MaterialIcons name="arrow-back" size={20} color={Colors.textSecondary} />
          </Pressable>
        ) : <View style={styles.backBtnPlaceholder} />}
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>
            {step === 'choose_method' && 'SCAN'}
            {step === 'select_specialist' && 'Select Specialist'}
            {step === 'capture' && `Capture${specialist ? ` — ${specialist.shortName}` : ''}`}
            {step === 'processing' && 'Analysing...'}
            {step === 'measure' && 'Physical Verification'}
            {step === 'review' && 'AI Result'}
          </Text>
        </View>
        <View style={styles.backBtnPlaceholder} />
      </View>

      {/* ── Step: Choose Method ── */}
      {step === 'choose_method' ? (
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 90 }]}>
          <View style={styles.scanHero}>
            <Image
              source={require('@/assets/images/scan-hero.jpg')}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              transition={300}
            />
            <View style={styles.scanHeroOverlay}>
              <View style={styles.scanReticle}>
                <View style={[styles.corner, styles.cornerTL]} />
                <View style={[styles.corner, styles.cornerTR]} />
                <View style={[styles.corner, styles.cornerBL]} />
                <View style={[styles.corner, styles.cornerBR]} />
              </View>
              <Text style={styles.scanHeroText}>AI-powered identification via OnSpace AI</Text>
            </View>
          </View>

          <Text style={styles.sectionTitle}>Choose Intake Method</Text>
          {IS_TV ? (
            <View style={[styles.conditionCard, { borderColor: Colors.warning + '40', marginBottom: -Spacing.sm }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }}>
                <MaterialIcons name="no-photography" size={18} color={Colors.warning} />
                <Text style={[styles.conditionCardTitle, { color: Colors.warning }]}>TV Mode — Camera Not Available</Text>
              </View>
              <Text style={styles.conditionCardText}>
                Fire Stick has no camera. Use Manual Entry to log items, or import your eBay inventory from the Dashboard.
              </Text>
            </View>
          ) : null}

          <View style={styles.methodGrid}>
            {CAPTURE_METHODS.map((m) => (
              <Pressable
                key={m.id}
                onPress={() => handleMethodSelect(m.id)}
                style={({ pressed }) => [styles.methodCard, pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] }]}
              >
                <View style={styles.methodIcon}>
                  <MaterialIcons name={m.icon as any} size={26} color={Colors.primary} />
                </View>
                <Text style={styles.methodLabel}>{m.label}</Text>
                <Text style={styles.methodDesc}>{m.desc}</Text>
              </Pressable>
            ))}
          </View>

          {/* Niche capture guide */}
          {activeNiche && activeNiche.captureInstructions.length > 0 ? (
            <View style={styles.nicheCaptureCard}>
              <View style={styles.nicheCaptureHeader}>
                <View style={[styles.nicheCaptureIcon, { backgroundColor: activeNiche.color + '25' }]}>
                  <MaterialIcons name={activeNiche.icon as any} size={14} color={activeNiche.color} />
                </View>
                <Text style={[styles.nicheCaptureTitle, { color: activeNiche.color }]}>
                  {activeNiche.shortName} Capture Guide
                </Text>
              </View>
              {activeNiche.captureInstructions.map((tip, i) => (
                <View key={i} style={styles.nicheCaptureRow}>
                  <MaterialIcons name="radio-button-unchecked" size={10} color={activeNiche.color + 'AA'} />
                  <Text style={styles.nicheCaptureText}>{tip}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {/* Niche-specific dedicated entry points */}
          {activeNicheId === 'coins' || !activeNicheId ? (
            <>
              {/* Coin Flipper */}
              <Pressable
                onPress={() => router.push('/coin-flipper' as any)}
                style={({ pressed }) => [styles.silverCapCard, { borderColor: '#3A3000', backgroundColor: '#09080A' }, pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] }]}
              >
                <View style={styles.silverCapLeft}>
                  <View style={[styles.silverCapIcon, { backgroundColor: '#2A200080', borderColor: '#F5C84230' }]}>
                    <MaterialIcons name="toll" size={22} color={'#F5C842'} />
                  </View>
                  <View style={styles.silverCapText}>
                    <Text style={[styles.silverCapTitle, { color: '#F5C842' }]}>Coin Flipper</Text>
                    <Text style={[styles.silverCapSub, { color: '#8B7A40' }]}>6-Tab Scanner · Numista · Value · List & Sell</Text>
                  </View>
                </View>
                <View style={[styles.silverCapBadge, { backgroundColor: '#F5C84220', borderColor: '#F5C84240' }]}>
                  <MaterialIcons name="workspace-premium" size={10} color={'#F5C842'} />
                  <Text style={[styles.silverCapBadgeText, { color: '#F5C842' }]}>Pro</Text>
                </View>
              </Pressable>
              {/* Bulk Silver Capture Station */}
              <Pressable
                onPress={() => router.push('/keen-on-coins' as any)}
                style={({ pressed }) => [styles.silverCapCard, { borderColor: '#8B7340', backgroundColor: '#0D0C08' }, pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] }]}
              >
                <View style={styles.silverCapLeft}>
                  <View style={[styles.silverCapIcon, { backgroundColor: '#2A200080', borderColor: '#F5C84230' }]}>
                    <MaterialIcons name="toll" size={22} color={'#F5C842'} />
                  </View>
                  <View style={styles.silverCapText}>
                    <Text style={[styles.silverCapTitle, { color: '#F5C842' }]}>KeenOnCoins Scanner</Text>
                    <Text style={[styles.silverCapSub, { color: '#8B7A40' }]}>Obverse · Reverse · Numista · AI Identification</Text>
                  </View>
                </View>
                <View style={[styles.silverCapBadge, { backgroundColor: '#2A200060', borderColor: '#F5C84230' }]}>
                  <Text style={[styles.silverCapBadgeText, { color: '#F5C842' }]}>Open</Text>
                  <MaterialIcons name="arrow-forward" size={12} color={'#F5C842'} />
                </View>
              </Pressable>
              {/* Bulk Silver Capture Station */}
              <Pressable
                onPress={() => router.push('/silver-batch' as any)}
                style={({ pressed }) => [styles.silverCapCard, pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] }]}
              >
                <View style={styles.silverCapLeft}>
                  <View style={styles.silverCapIcon}>
                    <MaterialIcons name="toll" size={22} color={Colors.gold} />
                  </View>
                  <View style={styles.silverCapText}>
                    <Text style={styles.silverCapTitle}>Bulk Silver Capture</Text>
                    <Text style={styles.silverCapSub}>Photograph · Measure · AI Identify · eBay Strategy</Text>
                  </View>
                </View>
                <View style={styles.silverCapBadge}>
                  <Text style={styles.silverCapBadgeText}>New</Text>
                  <MaterialIcons name="arrow-forward" size={12} color={Colors.gold} />
                </View>
              </Pressable>
              {/* Islamic & Indian Silver specialist card */}
              <Pressable
                onPress={() => router.push('/islamic-batch' as any)}
                style={({ pressed }) => [styles.islamicCard, pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] }]}
              >
                <View style={styles.islamicCardLeft}>
                  <View style={styles.islamicCardIcon}>
                    <MaterialIcons name="toll" size={22} color="#A8B5C0" />
                  </View>
                  <View style={styles.islamicCardText}>
                    <Text style={styles.islamicCardTitle}>Islamic & Indian Silver</Text>
                    <Text style={styles.islamicCardSub}>Timurid · Sultanate · Indo-Greek · Countermarks</Text>
                  </View>
                </View>
                <View style={styles.islamicCardBadge}>
                  <Text style={styles.islamicCardBadgeText}>Specialist</Text>
                  <MaterialIcons name="arrow-forward" size={12} color="#A8B5C0" />
                </View>
              </Pressable>
              <View style={styles.islamicCardFeatures}>
                {['Zeno.ru search', 'Numista catalogue', 'Countermark analysis', 'Batch up to 100'].map(f => (
                  <View key={f} style={styles.islamicFeatureChip}>
                    <View style={styles.islamicFeatureDot} />
                    <Text style={styles.islamicFeatureText}>{f}</Text>
                  </View>
                ))}
              </View>
            </>
          ) : null}

          {/* Flipper MX entry point */}
          {activeNicheId === 'motocross' ? (
            <Pressable
              onPress={() => router.push('/flipper-mx' as any)}
              style={({ pressed }) => [styles.silverCapCard, { borderColor: '#FF550040', backgroundColor: '#0A0A08' }, pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] }]}
            >
              <View style={styles.silverCapLeft}>
                <View style={[styles.silverCapIcon, { backgroundColor: '#2A150080', borderColor: '#FF550030' }]}>
                  <MaterialIcons name="two-wheeler" size={22} color={'#FF5500'} />
                </View>
                <View style={styles.silverCapText}>
                  <Text style={[styles.silverCapTitle, { color: '#FF5500' }]}>Flipper MX</Text>
                  <Text style={[styles.silverCapSub, { color: '#9A7050' }]}>Find › Fix › Flip › Repeat · Dirt Bikes · Real Data</Text>
                </View>
              </View>
              <View style={[styles.silverCapBadge, { backgroundColor: '#FF550020', borderColor: '#FF550040' }]}>
                <MaterialIcons name="workspace-premium" size={10} color={'#FF5500'} />
                <Text style={[styles.silverCapBadgeText, { color: '#FF5500' }]}>Pro</Text>
              </View>
            </Pressable>
          ) : null}

          {/* Bike Flipper entry point */}
          {activeNicheId === 'bicycles' ? (
            <Pressable
              onPress={() => router.push('/bike-flipper' as any)}
              style={({ pressed }) => [styles.silverCapCard, { borderColor: '#6ED02040', backgroundColor: '#080C08' }, pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] }]}
            >
              <View style={styles.silverCapLeft}>
                <View style={[styles.silverCapIcon, { backgroundColor: '#0A200080', borderColor: '#6ED02030' }]}>
                  <MaterialIcons name="pedal-bike" size={22} color={'#6ED020'} />
                </View>
                <View style={styles.silverCapText}>
                  <Text style={[styles.silverCapTitle, { color: '#6ED020' }]}>Bike Flipper</Text>
                  <Text style={[styles.silverCapSub, { color: '#7A9070' }]}>Find · Assess · Upgrade · Flip · Any Bike</Text>
                </View>
              </View>
              <View style={[styles.silverCapBadge, { backgroundColor: '#6ED02020', borderColor: '#6ED02040' }]}>
                <MaterialIcons name="workspace-premium" size={10} color={'#6ED020'} />
                <Text style={[styles.silverCapBadgeText, { color: '#6ED020' }]}>Pro</Text>
              </View>
            </Pressable>
          ) : null}

          {/* Threads Flip entry point */}
          {activeNicheId === 'clothing' ? (
            <Pressable
              onPress={() => router.push('/threads-flip' as any)}
              style={({ pressed }) => [styles.silverCapCard, { borderColor: '#E91E8C40', backgroundColor: '#0C080C' }, pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] }]}
            >
              <View style={styles.silverCapLeft}>
                <View style={[styles.silverCapIcon, { backgroundColor: '#25001480', borderColor: '#E91E8C30' }]}>
                  <MaterialIcons name="checkroom" size={22} color={'#E91E8C'} />
                </View>
                <View style={styles.silverCapText}>
                  <Text style={[styles.silverCapTitle, { color: '#E91E8C' }]}>Threads Flip</Text>
                  <Text style={[styles.silverCapSub, { color: '#9A7090' }]}>Identify · Value · Style · Sell · Vintage & Designer</Text>
                </View>
              </View>
              <View style={[styles.silverCapBadge, { backgroundColor: '#E91E8C20', borderColor: '#E91E8C40' }]}>
                <MaterialIcons name="workspace-premium" size={10} color={'#E91E8C'} />
                <Text style={[styles.silverCapBadgeText, { color: '#E91E8C' }]}>Pro</Text>
              </View>
            </Pressable>
          ) : null}

          <Text style={styles.sectionTitle}>Quick Specialists</Text>
          <View style={styles.quickSpecialists}>
            {/* Show niche-relevant specialists first */}
            {(() => {
              const nicheSpecialistIds = activeNiche?.specialists ?? [];
              const nicheSpecialists = nicheSpecialistIds
                .map((id: SpecialistId) => SPECIALISTS[id])
                .filter(Boolean);
              const otherSpecialists = SPECIALIST_LIST
                .filter(s => !nicheSpecialistIds.includes(s.id))
                .slice(0, Math.max(0, 8 - nicheSpecialists.length));
              return [...nicheSpecialists, ...otherSpecialists].slice(0, 8);
            })().map((s: SpecialistConfig) => (
              <Pressable
                key={s.id}
                onPress={() => {
                  setSelectedMethod('camera');
                  setSelectedSpecialist(s.id);
                  setCapturedImages([]);
                  setScanMode('capturing');
                  setStep('capture');
                }}
                style={[styles.quickChip, { borderColor: s.color + '60' }]}
              >
                <View style={[styles.quickDot, { backgroundColor: s.color }]} />
                <Text style={styles.quickLabel}>{s.shortName}</Text>
              </Pressable>
            ))}
          </View>
        </ScrollView>
      ) : null}

      {/* ── Step: Select Specialist ── */}
      {step === 'select_specialist' ? (
        <View style={styles.flex}>
          <View style={styles.searchWrap}>
            <MaterialIcons name="search" size={16} color={Colors.textTertiary} />
            <TextInput
              style={styles.searchInput}
              value={specialistSearch}
              onChangeText={setSpecialistSearch}
              placeholder="Search specialists..."
              placeholderTextColor={Colors.textTertiary}
              autoFocus
            />
          </View>
          <ScrollView contentContainerStyle={[styles.specialistList, { paddingBottom: insets.bottom + 90 }]}>
            <Pressable onPress={() => handleSpecialistSelect('curiosities_collectibles')} style={styles.autoDetectBtn}>
              <MaterialIcons name="auto-awesome" size={20} color={Colors.accent} />
              <View style={styles.flex}>
                <Text style={styles.autoDetectTitle}>Auto-Detect Specialist</Text>
                <Text style={styles.autoDetectSub}>SWISH AI will determine the category from your images</Text>
              </View>
              <MaterialIcons name="chevron-right" size={18} color={Colors.accent} />
            </Pressable>
            {filteredSpecialists.map((s) => (
              <Pressable
                key={s.id}
                onPress={() => handleSpecialistSelect(s.id)}
                style={({ pressed }) => [styles.specialistRow, pressed && { backgroundColor: Colors.surfaceElevated }]}
              >
                <View style={[styles.specialistColorBar, { backgroundColor: s.color }]} />
                <View style={styles.specialistRowInfo}>
                  <Text style={styles.specialistRowName}>{s.name}</Text>
                  <Text style={styles.specialistRowDesc} numberOfLines={1}>{s.description}</Text>
                </View>
                <View style={styles.specialistRowMeta}>
                  <Text style={styles.specialistCapCount}>{s.captureRequirements.length} shots</Text>
                  <MaterialIcons name="chevron-right" size={16} color={Colors.textTertiary} />
                </View>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}

      {/* ── Step: Capture ── */}
      {step === 'capture' && specialist ? (
        <View style={styles.flex}>
          <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 110 }]}>
            {/* Specialist banner */}
            <View style={[styles.specialistBanner, { borderColor: specialist.color + '40' }]}>
              <View style={[styles.specialistBannerDot, { backgroundColor: specialist.color }]} />
              <View style={styles.flex}>
                <Text style={styles.specialistBannerName}>{specialist.name}</Text>
                <Text style={styles.specialistBannerSub}>
                  {selectedMethod === 'camera' ? 'Tap a slot to open camera' : 'Tap a slot to select from library'}
                </Text>
              </View>
              {/* Photo counter chip */}
              <View style={[
                styles.photoCounterChip,
                capturedImages.length >= requiredSlots.length && capturedImages.length > 0
                  ? styles.photoCounterChipReady
                  : styles.photoCounterChipPending,
              ]}>
                <MaterialIcons
                  name="photo-library"
                  size={11}
                  color={capturedImages.length >= requiredSlots.length && capturedImages.length > 0 ? Colors.success : Colors.textTertiary}
                />
                <Text style={[
                  styles.photoCounterText,
                  capturedImages.length >= requiredSlots.length && capturedImages.length > 0 && styles.photoCounterTextReady,
                ]}>
                  {capturedImages.length} / {MAX_PHOTOS}
                </Text>
              </View>
            </View>

          {/* AI Error — with upgrade CTA for quota errors */}
            {aiError ? (
              <View style={styles.errorBanner}>
                <MaterialIcons name={aiError.includes('quota') || aiError.includes('Upgrade') ? 'workspace-premium' : 'error-outline'} size={16} color={aiError.includes('quota') || aiError.includes('Upgrade') ? Colors.gold : Colors.danger} />
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={[styles.errorText, aiError.includes('quota') || aiError.includes('Upgrade') ? { color: Colors.gold } : {}]} numberOfLines={4}>
                    {aiError}
                  </Text>
                  {(aiError.includes('quota') || aiError.includes('Upgrade')) ? (
                    <Pressable
                      onPress={() => router.push('/subscription' as any)}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', backgroundColor: Colors.gold + '30', borderRadius: Radius.md, paddingHorizontal: Spacing.sm, paddingVertical: 4, borderWidth: 1, borderColor: Colors.gold + '50' }}
                    >
                      <MaterialIcons name="workspace-premium" size={12} color={Colors.gold} />
                      <Text style={{ fontSize: 11, fontWeight: Typography.weight.bold, color: Colors.gold }}>Upgrade to Premium</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            ) : null}

            {/* Multi-photo grid: always show all 4 slots */}
            <View style={styles.multiPhotoGrid}>
              {photoSlots.map((slot, idx) => {
                const img = capturedImages.find(i => i.slotId === slot.id);
                const isFirst = idx === 0;
                return (
                  <View key={slot.id} style={isFirst ? styles.multiPhotoSlotLarge : styles.multiPhotoSlotSmall}>
                    <Pressable
                      onPress={() => handleCaptureSlot(slot.id, slot.label)}
                      style={({ pressed }) => [
                        styles.multiPhotoSlotInner,
                        img ? styles.multiPhotoSlotCaptured : styles.multiPhotoSlotEmpty,
                        slot.required && !img ? styles.multiPhotoSlotRequired : null,
                        pressed && { opacity: 0.82 },
                      ]}
                    >
                      {img ? (
                        <>
                          <Image source={{ uri: img.uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
                          {/* Re-take overlay on long press / retake button */}
                          <View style={styles.capturedOverlayBar}>
                            <View style={styles.capturedLabel}>
                              <MaterialIcons name="check-circle" size={10} color={Colors.success} />
                              <Text style={styles.capturedLabelText} numberOfLines={1}>{slot.label}</Text>
                            </View>
                            <Pressable
                              onPress={(e) => { e.stopPropagation(); handleCaptureSlot(slot.id, slot.label); }}
                              hitSlop={6}
                              style={styles.retakeBtn}
                            >
                              <MaterialIcons name="refresh" size={13} color='#fff' />
                            </Pressable>
                          </View>
                          {/* Remove button top-right */}
                          <Pressable
                            onPress={(e) => { e.stopPropagation(); handleRemoveImage(slot.id); }}
                            style={styles.removeBtn}
                            hitSlop={6}
                          >
                            <MaterialIcons name="close" size={12} color='#fff' />
                          </Pressable>
                        </>
                      ) : (
                        <View style={styles.emptySlotContent}>
                          <View style={[styles.emptySlotIcon, slot.required ? styles.emptySlotIconRequired : null]}>
                            <MaterialIcons
                              name={selectedMethod === 'camera' ? 'add-a-photo' : 'add-photo-alternate'}
                              size={isFirst ? 28 : 22}
                              color={slot.required ? Colors.primary : Colors.textTertiary}
                            />
                          </View>
                          <Text style={[styles.emptySlotLabel, slot.required && styles.emptySlotLabelRequired]} numberOfLines={1}>
                            {slot.label}
                          </Text>
                          {slot.required ? (
                            <View style={styles.requiredPill}>
                              <Text style={styles.requiredPillText}>Required</Text>
                            </View>
                          ) : (
                            <Text style={styles.optionalLabel}>Optional</Text>
                          )}
                          {slot.hint && isFirst ? (
                            <Text style={styles.slotHint} numberOfLines={2}>{slot.hint}</Text>
                          ) : null}
                        </View>
                      )}
                    </Pressable>
                  </View>
                );
              })}
            </View>

            {/* Tip banner */}
            <View style={styles.multiPhotoTip}>
              <MaterialIcons name="lightbulb-outline" size={13} color={Colors.warning} />
              <Text style={styles.multiPhotoTipText}>
                More photos = better AI accuracy. Capture both sides for coins and cards.
              </Text>
            </View>

          </ScrollView>

          {/* Action bar */}
          <View style={[styles.captureActionBar, { paddingBottom: insets.bottom + Spacing.base }]}>
            <View style={styles.captureProgressInfo}>
              <Text style={styles.captureProgress}>
                {capturedImages.length} photo{capturedImages.length === 1 ? '' : 's'} captured
              </Text>
              {capturedRequired < requiredSlots.length ? (
                <Text style={styles.captureRequiredHint}>
                  {requiredSlots.length - capturedRequired} required remaining
                </Text>
              ) : capturedImages.length < MAX_PHOTOS ? (
                <Text style={styles.captureExtraCount}>
                  Add up to {MAX_PHOTOS - capturedImages.length} more for better accuracy
                </Text>
              ) : (
                <Text style={styles.captureExtraCount}>All {MAX_PHOTOS} slots filled</Text>
              )}
            </View>
            <Pressable
              onPress={handleIdentify}
              style={({ pressed }) => [
                styles.identifyBtn,
                !canIdentify && styles.identifyBtnDisabled,
                pressed && canIdentify ? { opacity: 0.85 } : undefined,
              ]}
              disabled={!canIdentify}
            >
              <MaterialIcons name="auto-awesome" size={18} color={canIdentify ? Colors.background : Colors.textTertiary} />
              <Text style={[styles.identifyBtnText, !canIdentify && styles.identifyBtnTextDisabled]}>
                Identify with AI
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {/* ── Step: Processing ── */}
      {step === 'processing' ? (
        <View style={styles.processingView}>
          <View style={styles.processingIndicator}>
            <ActivityIndicator size="large" color={Colors.primary} />
            <View style={[styles.processingRing, { borderColor: Colors.primary + '30' }]} />
          </View>
          <Text style={styles.processingTitle}>AI Analysing Item</Text>
          <Text style={styles.processingText}>
            {processingStatus || 'Contacting OnSpace AI...'}
          </Text>
          <View style={styles.processingSteps}>
            {['Object detection', 'Specialist routing', 'Vision analysis', 'Research & valuation', 'Finalising result'].map((s) => (
              <View key={s} style={styles.processingStep}>
                <ActivityIndicator size="small" color={Colors.primary} />
                <Text style={styles.processingStepText}>{s}</Text>
              </View>
            ))}
          </View>
          <View style={styles.aiPoweredBadge}>
            <MaterialIcons name="auto-awesome" size={12} color={Colors.accent} />
            <Text style={styles.aiPoweredText}>Powered by OnSpace AI · Gemini 3 Flash</Text>
          </View>
        </View>
      ) : null}

      {/* ── Step: Measure — Physical Verification ── */}
      {step === 'measure' && idResult ? (
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 90 }]}>

          {/* Header */}
          <View style={styles.measureHeader}>
            <View style={styles.measureHeaderIcon}>
              <MaterialIcons name="straighten" size={22} color={Colors.primary} />
            </View>
            <Text style={styles.measureHeaderTitle}>Physical Verification</Text>
            <Text style={styles.measureHeaderSub}>
              Enter your measurements to verify against catalogue data. Measurements are hard evidence — contradictions will update the identification confidence.
            </Text>
          </View>

          {/* Catalogue spec (from Numista) */}
          {(idResult.numistaVerification?.weight || idResult.numistaVerification?.diameter) ? (
            <View style={styles.catalogueCard}>
              <Text style={styles.catalogueCardTitle}>CATALOGUE SPECIFICATION</Text>
              <Text style={styles.catalogueCardSub}>
                {idResult.numistaTitle ?? idResult.numistaVerification?.title ?? 'Numista catalogue type'}
                {idResult.numistaN ? ` · ${idResult.numistaN}` : ''}
              </Text>
              <View style={styles.catalogueSpecRow}>
                {idResult.numistaVerification?.weight ? (
                  <View style={styles.catalogueSpecItem}>
                    <Text style={styles.catalogueSpecLabel}>WEIGHT</Text>
                    <Text style={styles.catalogueSpecValue}>{idResult.numistaVerification.weight}g</Text>
                  </View>
                ) : null}
                {idResult.numistaVerification?.diameter ? (
                  <View style={styles.catalogueSpecItem}>
                    <Text style={styles.catalogueSpecLabel}>DIAMETER</Text>
                    <Text style={styles.catalogueSpecValue}>{idResult.numistaVerification.diameter}mm</Text>
                  </View>
                ) : null}
                {idResult.numistaVerification?.composition ? (
                  <View style={styles.catalogueSpecItem}>
                    <Text style={styles.catalogueSpecLabel}>COMPOSITION</Text>
                    <Text style={styles.catalogueSpecValue} numberOfLines={1}>{idResult.numistaVerification.composition}</Text>
                  </View>
                ) : null}
              </View>
            </View>
          ) : (
            <View style={styles.catalogueCard}>
              <Text style={styles.catalogueCardTitle}>CATALOGUE SPECIFICATION</Text>
              <Text style={[styles.catalogueCardSub, { color: Colors.textTertiary }]}>
                No catalogue weight/diameter data available — enter measurements for future reference.
              </Text>
            </View>
          )}

          {/* User measurement inputs */}
          <View style={styles.measureCard}>
            <Text style={styles.measureCardTitle}>YOUR MEASUREMENTS</Text>
            <View style={styles.measureRow}>
              <View style={styles.measureField}>
                <Text style={styles.measureFieldLabel}>Weight (g)</Text>
                <View style={styles.measureInputWrap}>
                  <TextInput
                    style={styles.measureInput}
                    value={measureWeight}
                    onChangeText={setMeasureWeight}
                    keyboardType="decimal-pad"
                    placeholder={idResult.numistaVerification?.weight ? `Expected ${idResult.numistaVerification.weight}g` : 'e.g. 5.00'}
                    placeholderTextColor={Colors.textTertiary}
                  />
                  <Text style={styles.measureUnit}>g</Text>
                </View>
              </View>
              <View style={styles.measureField}>
                <Text style={styles.measureFieldLabel}>Diameter (mm)</Text>
                <View style={styles.measureInputWrap}>
                  <TextInput
                    style={styles.measureInput}
                    value={measureDiameter}
                    onChangeText={setMeasureDiameter}
                    keyboardType="decimal-pad"
                    placeholder={idResult.numistaVerification?.diameter ? `Expected ${idResult.numistaVerification.diameter}mm` : 'e.g. 24.0'}
                    placeholderTextColor={Colors.textTertiary}
                  />
                  <Text style={styles.measureUnit}>mm</Text>
                </View>
              </View>
            </View>
          </View>

          {/* Measurement result */}
          {measureResult ? (
            <View style={styles.measureResultCard}>
              <Text style={styles.measureResultTitle}>VERIFICATION RESULT</Text>
              {measureResult.notes.map((note, i) => {
                const isContradiction = note.includes('CONTRADICTION');
                const isMatch = note.includes('MATCH') && !isContradiction;
                return (
                  <View key={i} style={[styles.measureResultRow, isContradiction && styles.measureResultRowBad, isMatch && styles.measureResultRowGood]}>
                    <MaterialIcons
                      name={isContradiction ? 'warning' : isMatch ? 'check-circle' : 'info-outline'}
                      size={13}
                      color={isContradiction ? Colors.danger : isMatch ? Colors.success : Colors.textTertiary}
                    />
                    <Text style={[styles.measureResultText, isContradiction && { color: Colors.danger }, isMatch && { color: Colors.success }]}>
                      {note}
                    </Text>
                  </View>
                );
              })}
              {(measureResult.weightMatch === 'contradiction' || measureResult.diameterMatch === 'contradiction') ? (
                <View style={styles.measureContraWarn}>
                  <MaterialIcons name="error" size={14} color={Colors.danger} />
                  <Text style={styles.measureContraWarnText}>
                    Physical measurements contradict the catalogue specification. The identification confidence has been capped. Consider Re-Identifying with updated measurements.
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null}

          {/* Action buttons */}
          <View style={styles.measureActions}>
            {!measureResult ? (
              <Pressable
                onPress={handleConfirmMeasurements}
                disabled={measureChecking || (!measureWeight && !measureDiameter)}
                style={[styles.measureConfirmBtn, (!measureWeight && !measureDiameter) && styles.measureConfirmBtnDisabled]}
              >
                {measureChecking ? <ActivityIndicator size="small" color={Colors.background} /> : <MaterialIcons name="check" size={16} color={Colors.background} />}
                <Text style={styles.measureConfirmBtnText}>
                  {measureChecking ? 'Checking...' : 'Confirm & Re-check Identification'}
                </Text>
              </Pressable>
            ) : (
              <Pressable onPress={handleProceedAfterMeasure} style={styles.measureProceedBtn}>
                <MaterialIcons name="arrow-forward" size={16} color={Colors.background} />
                <Text style={styles.measureProceedBtnText}>View Identification Result</Text>
              </Pressable>
            )}
            <Pressable onPress={handleSkipMeasurement} style={styles.measureSkipBtn}>
              <Text style={styles.measureSkipBtnText}>
                {measureResult ? 'Skip — proceed anyway' : 'Skip measurement (not required)'}
              </Text>
            </Pressable>
          </View>

          <View style={styles.disclaimer}>
            <MaterialIcons name="info-outline" size={13} color={Colors.textTertiary} />
            <Text style={styles.disclaimerText}>
              Physical measurements are optional but significantly improve identification accuracy. Weight and diameter are hard evidence — major contradictions may indicate a different coin type.
            </Text>
          </View>
        </ScrollView>
      ) : null}

      {/* ── Step: Review ── */}
      {step === 'review' && idResult ? (
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 90 }]}>

          {/* Saved confirmation */}
          {savedItemId ? (
            <View style={styles.savedBanner}>
              <MaterialIcons name="check-circle" size={18} color={Colors.success} />
              <View style={{ flex: 1 }}>
                <Text style={styles.savedBannerText}>Saved to inventory successfully</Text>
                {uploadProgress ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3 }}>
                    {isUploading ? <ActivityIndicator size="small" color={Colors.success} /> : null}
                    <Text style={{ fontSize: 11, color: Colors.success + 'CC' }}>{uploadProgress}</Text>
                  </View>
                ) : null}
              </View>
            </View>
          ) : null}

          {/* Result header */}
          <View style={styles.resultHeader}>
            <View style={[styles.resultConfidence, { borderColor: CONFIDENCE_COLOR(idResult.confidence) }]}>
              <Text style={[styles.resultConfidencePct, { color: CONFIDENCE_COLOR(idResult.confidence) }]}>
                {Math.round(idResult.confidence * 100)}%
              </Text>
              <Text style={[styles.resultConfidenceLabel, { color: CONFIDENCE_COLOR(idResult.confidence) }]}>
                {idResult.confidence >= 0.85 ? 'HIGH' : idResult.confidence >= 0.65 ? 'MED' : 'LOW'}
              </Text>
            </View>
            <View style={styles.resultHeaderInfo}>
              <Text style={styles.resultTitle}>{idResult.canonicalTitle}</Text>
              <Text style={styles.resultCondition}>
                {idResult.condition}{idResult.conditionGrade ? ` · ${idResult.conditionGrade}` : ''}
              </Text>
              <View style={styles.resultSourceRow}>
                <MaterialIcons name="verified" size={12} color={Colors.textTertiary} />
                <Text style={styles.resultSource}>{idResult.identificationSource}</Text>
                <View style={[styles.specialistTag, { backgroundColor: (SPECIALISTS[idResult.specialistId]?.color ?? Colors.primary) + '25' }]}>
                  <Text style={[styles.specialistTagText, { color: SPECIALISTS[idResult.specialistId]?.color ?? Colors.primary }]}>
                    {SPECIALISTS[idResult.specialistId]?.shortName ?? idResult.specialistId}
                  </Text>
                </View>
              </View>
            </View>
          </View>

          {/* Review required warning */}
          {idResult.confidence < CONFIDENCE_THRESHOLDS.assisted ? (
            <View style={styles.reviewWarning}>
              <MaterialIcons name="warning" size={16} color={Colors.warning} />
              <Text style={styles.reviewWarningText}>
                Low confidence identification — manual review recommended before listing.
              </Text>
            </View>
          ) : null}

          {/* Captured images strip */}
          {capturedImages.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.imageStrip} contentContainerStyle={styles.imageStripContent}>
              {capturedImages.map((img, idx) => (
                <Image key={img.slotId} source={{ uri: img.uri }} style={styles.imageStripThumb} contentFit="cover" />
              ))}
            </ScrollView>
          ) : null}

          {/* Numista verification result */}
          {idResult.numistaStatus && idResult.numistaStatus !== 'unavailable' ? (
            <View style={[styles.conditionCard, {
              borderColor: idResult.numistaStatus === 'verified' || idResult.numistaStatus === 'strong_match' ? Colors.success + '40'
                : idResult.numistaStatus === 'no_match' ? Colors.warning + '30'
                : Colors.primary + '30'
            }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <MaterialIcons
                  name={idResult.numistaStatus === 'verified' || idResult.numistaStatus === 'strong_match' ? 'verified' : idResult.numistaStatus === 'no_match' ? 'search-off' : 'help-outline'}
                  size={13}
                  color={idResult.numistaStatus === 'verified' || idResult.numistaStatus === 'strong_match' ? Colors.success : idResult.numistaStatus === 'no_match' ? Colors.warning : Colors.primary}
                />
                <Text style={[styles.conditionCardTitle, {
                  color: idResult.numistaStatus === 'verified' || idResult.numistaStatus === 'strong_match' ? Colors.success : idResult.numistaStatus === 'no_match' ? Colors.warning : Colors.primary
                }]}>
                  NUMISTA {idResult.numistaStatus === 'no_match' ? 'NO MATCH' : String(idResult.numistaStatus).replace(/_/g, ' ').toUpperCase()}
                  {idResult.numistaN ? ` · ${idResult.numistaN}` : ''}
                </Text>
                {idResult.numistaMatchScore && idResult.numistaMatchScore > 0 ? (
                  <Text style={{ fontSize: 10, color: Colors.textTertiary, marginLeft: 'auto' as any }}>{idResult.numistaMatchScore}/100</Text>
                ) : null}
              </View>
              {idResult.numistaTitle ? <Text style={styles.conditionCardText} numberOfLines={2}>{idResult.numistaTitle}</Text> : null}
              {idResult.numistaStatus === 'no_match' ? (
                <Text style={[styles.conditionCardText, { color: Colors.warning }]}>No matching Numista catalogue type. Run Re-Value to get eBay-only market data.</Text>
              ) : null}
            </View>
          ) : null}

          {/* Evidence summary */}
          {(idResult.evidenceSupporting.length > 0 || idResult.missingInformation.length > 0) ? (
            <View style={[styles.conditionCard, { borderColor: Colors.primary + '30' }]}>
              <Text style={styles.conditionCardTitle}>EVIDENCE ({idResult.evidenceSupporting.length} supporting · {idResult.missingInformation.length} unresolved)</Text>
              {idResult.evidenceSupporting.slice(0, 3).map((e, i) => (
                <View key={i} style={{ flexDirection: 'row', gap: 6, alignItems: 'flex-start' }}>
                  <MaterialIcons name="check" size={11} color={Colors.success} style={{ marginTop: 2 }} />
                  <Text style={[styles.conditionCardText, { fontSize: Typography.size.xs, lineHeight: 16 }]}>{e}</Text>
                </View>
              ))}
              {idResult.missingInformation.slice(0, 2).map((m, i) => (
                <View key={i} style={{ flexDirection: 'row', gap: 6, alignItems: 'flex-start' }}>
                  <MaterialIcons name="help-outline" size={11} color={Colors.warning} style={{ marginTop: 2 }} />
                  <Text style={[styles.conditionCardText, { fontSize: Typography.size.xs, lineHeight: 16, color: Colors.warning }]}>{m}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {/* Market Valuation — fetched automatically on entering review */}
          <View style={styles.valuationCard}>
            <View style={styles.valuationCardHeader}>
              <Text style={styles.valuationCardTitle}>PRICING</Text>
              {valuationLoading ? (
                <View style={[styles.valConfBadge, { backgroundColor: Colors.primaryDim, flexDirection: 'row', alignItems: 'center', gap: 5 }]}>
                  <ActivityIndicator size="small" color={Colors.primary} style={{ width: 12, height: 12 }} />
                  <Text style={[styles.valConfText, { color: Colors.primary }]}>fetching market data...</Text>
                </View>
              ) : valuationResult ? (
                <View style={[styles.valConfBadge, {
                  backgroundColor:
                    valuationResult.valuation?.valuationConfidence === 'high' ? Colors.successDim
                    : valuationResult.valuation?.valuationConfidence === 'medium' ? Colors.primaryDim
                    : Colors.warningDim,
                }]}>
                  <Text style={[styles.valConfText, {
                    color:
                      valuationResult.valuation?.valuationConfidence === 'high' ? Colors.success
                      : valuationResult.valuation?.valuationConfidence === 'medium' ? Colors.primary
                      : Colors.warning,
                    textTransform: 'uppercase',
                  }]}>
                    {valuationResult.valuation?.valuationConfidence ?? 'low'} confidence
                  </Text>
                </View>
              ) : (
                <View style={[styles.valConfBadge, { backgroundColor: Colors.surfaceBorder }]}>
                  <Text style={[styles.valConfText, { color: Colors.textTertiary }]}>no market data</Text>
                </View>
              )}
            </View>

            {/* Live valuation result */}
            {valuationResult ? (() => {
              const v = valuationResult.valuation;
              const s = valuationResult.soldMarket;
              const a = valuationResult.activeAskingPrices;
              const mid = v?.valuationMid ?? 0;
              const low = v?.valuationLow ?? 0;
              const high = v?.valuationHigh ?? 0;
              const recommended = v?.recommendedListingPrice ?? 0;
              const soldCount = s?.relevantSoldCount ?? 0;
              const soldMedian = s?.medianPrice ?? 0;
              return (
                <View style={{ gap: Spacing.sm }}>
                  {/* Price range */}
                  {mid > 0 ? (
                    <View style={styles.valuationRow}>
                      <View style={styles.valuationItem}>
                        <Text style={styles.valuationLabel}>Low</Text>
                        <Text style={styles.valuationValue}>£{low.toFixed(2)}</Text>
                      </View>
                      <View style={styles.valuationMidItem}>
                        <Text style={[styles.valuationLabel, { color: Colors.primary }]}>Suggested</Text>
                        <Text style={[styles.valuationValue, styles.valuationMidValue]}>£{recommended > 0 ? recommended.toFixed(2) : mid.toFixed(2)}</Text>
                      </View>
                      <View style={styles.valuationItem}>
                        <Text style={styles.valuationLabel}>High</Text>
                        <Text style={styles.valuationValue}>£{high.toFixed(2)}</Text>
                      </View>
                    </View>
                  ) : (
                    <View style={[styles.suggestionRow, { backgroundColor: Colors.warningDim }]}>
                      <MaterialIcons name="info-outline" size={14} color={Colors.warning} />
                      <Text style={[styles.suggestionText, { color: Colors.warning }]}>
                        Insufficient comparable sales data — no reliable price range available
                      </Text>
                    </View>
                  )}

                  {/* Sold evidence */}
                  {soldCount > 0 ? (
                    <View style={{ flexDirection: 'row', gap: Spacing.md, flexWrap: 'wrap' }}>
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text style={styles.valuationLabel}>Sold Comparables</Text>
                        <Text style={[styles.valuationValue, { fontSize: Typography.size.md }]}>{soldCount}</Text>
                      </View>
                      {soldMedian > 0 ? (
                        <View style={{ flex: 1, gap: 2 }}>
                          <Text style={styles.valuationLabel}>Sold Median</Text>
                          <Text style={[styles.valuationValue, { fontSize: Typography.size.md }]}>£{soldMedian.toFixed(2)}</Text>
                        </View>
                      ) : null}
                      {v?.saleProb30d != null && v.saleProb30d > 0 ? (
                        <View style={{ flex: 1, gap: 2 }}>
                          <Text style={styles.valuationLabel}>30d Sale Prob.</Text>
                          <Text style={[styles.valuationValue, { fontSize: Typography.size.md }]}>{Math.round(v.saleProb30d * 100)}%</Text>
                        </View>
                      ) : null}
                    </View>
                  ) : null}

                  {/* Asking market note */}
                  {a && a.count > 0 && a.medianAskingPrice > 0 ? (
                    <View style={[styles.suggestionRow, { backgroundColor: Colors.warningDim }]}>
                      <MaterialIcons name="price-tag" size={12} color={Colors.warning} />
                      <Text style={[styles.suggestionText, { color: Colors.warning }]}>
                        Active asking: £{a.lowAskingPrice.toFixed(2)}–£{a.highAskingPrice.toFixed(2)} ({a.relevantCount} listings) — asking prices, not sold prices
                      </Text>
                    </View>
                  ) : null}

                  {/* Rationale */}
                  {v?.listingPriceRationale ? (
                    <View style={[styles.suggestionRow, { backgroundColor: Colors.primaryDim }]}>
                      <MaterialIcons name="auto-awesome" size={12} color={Colors.primary} />
                      <Text style={[styles.suggestionText, { color: Colors.primary }]} numberOfLines={3}>
                        {v.listingPriceRationale}
                      </Text>
                    </View>
                  ) : null}

                  {/* Data quality warning */}
                  {(s?.dataQuality === 'insufficient' || s?.dataQuality === 'weak') ? (
                    <View style={[styles.suggestionRow, { backgroundColor: Colors.warningDim }]}>
                      <MaterialIcons name="warning" size={12} color={Colors.warning} />
                      <Text style={[styles.suggestionText, { color: Colors.warning }]} numberOfLines={2}>
                        {s.dataQualityReason ?? 'Limited comparable sales — treat valuation as an estimate'}
                      </Text>
                    </View>
                  ) : null}
                </View>
              );
            })() : valuationLoading ? (
              <View style={[styles.suggestionRow, { backgroundColor: Colors.primaryDim, justifyContent: 'center' }]}>
                <ActivityIndicator size="small" color={Colors.primary} />
                <Text style={[styles.suggestionText, { color: Colors.primary }]}>Searching eBay sold data...</Text>
              </View>
            ) : valuationError ? (
              <View style={[styles.suggestionRow, { backgroundColor: Colors.warningDim }]}>
                <MaterialIcons name="warning" size={14} color={Colors.warning} />
                <Text style={[styles.suggestionText, { color: Colors.warning }]} numberOfLines={3}>{valuationError}</Text>
              </View>
            ) : (
              <View style={[styles.suggestionRow, { backgroundColor: Colors.primaryDim }]}>
                <MaterialIcons name="travel-explore" size={14} color={Colors.primary} />
                <Text style={[styles.suggestionText, { color: Colors.primary }]}>
                  {idResult.valuationNote ?? 'Fetching market pricing...'}
                </Text>
              </View>
            )}

            {idResult.suggestedDisposition ? (
              <View style={styles.suggestionRow}>
                <MaterialIcons name="lightbulb" size={14} color={Colors.warning} />
                <Text style={styles.suggestionText}>{idResult.suggestedDisposition}</Text>
              </View>
            ) : null}
          </View>

          {/* Attributes */}
          {Object.keys(idResult.attributes).length > 0 ? (
            <>
              <Text style={styles.sectionTitle}>Identified Attributes</Text>
              <View style={styles.attributesCard}>
                {Object.entries(idResult.attributes).map(([k, v]) => (
                  <View key={k} style={styles.attributeRow}>
                    <Text style={styles.attributeKey}>{k.replace(/_/g, ' ')}</Text>
                    <Text style={styles.attributeValue}>{String(v)}</Text>
                  </View>
                ))}
              </View>
            </>
          ) : null}

          {/* Condition notes */}
          {idResult.conditionNotes ? (
            <View style={styles.conditionCard}>
              <Text style={styles.conditionCardTitle}>Condition Notes</Text>
              <Text style={styles.conditionCardText}>{idResult.conditionNotes}</Text>
            </View>
          ) : null}

          {/* Warnings */}
          {idResult.warnings.length > 0 ? (
            <View style={styles.warningsCard}>
              {idResult.warnings.map((w, i) => (
                <View key={i} style={styles.warningRow}>
                  <MaterialIcons name="warning" size={14} color={Colors.danger} />
                  <Text style={styles.warningText}>{w}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {/* Was this correct? feedback banner */}
          {savedItemId && feedbackVerdict === null ? (
            <View style={styles.feedbackBanner}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, flex: 1 }}>
                <MaterialIcons name="school" size={13} color={Colors.accent} />
                <Text style={{ fontSize: Typography.size.xs, color: Colors.textPrimary, fontWeight: Typography.weight.semibold }}>Was this correct?</Text>
              </View>
              <View style={{ flexDirection: 'row', gap: Spacing.xs }}>
                <Pressable onPress={() => handleFeedback('incorrect')} disabled={feedbackSaving}
                  style={({ pressed }) => [styles.fbBtnWrong, pressed && { opacity: 0.75 }]}>
                  <MaterialIcons name="close" size={13} color={Colors.danger} />
                  <Text style={{ fontSize: Typography.size.xs, fontWeight: Typography.weight.bold, color: Colors.danger }}>No</Text>
                </Pressable>
                <Pressable onPress={() => handleFeedback('correct')} disabled={feedbackSaving}
                  style={({ pressed }) => [styles.fbBtnCorrect, pressed && { opacity: 0.75 }]}>
                  {feedbackSaving ? <ActivityIndicator size="small" color={Colors.background} style={{ width: 13 }} /> : <MaterialIcons name="check" size={13} color={Colors.background} />}
                  <Text style={{ fontSize: Typography.size.xs, fontWeight: Typography.weight.bold, color: Colors.background }}>Yes!</Text>
                </Pressable>
              </View>
            </View>
          ) : savedItemId && feedbackVerdict !== null ? (
            <View style={[styles.feedbackBanner, { backgroundColor: Colors.successDim, borderColor: Colors.success + '40' }]}>
              <MaterialIcons name="check-circle" size={13} color={Colors.success} />
              <Text style={{ fontSize: Typography.size.xs, color: Colors.success, fontWeight: Typography.weight.medium }}>
                {feedbackVerdict === 'correct' ? 'Thanks! Feedback recorded.' : 'Noted — AI will learn from this.'}
              </Text>
            </View>
          ) : null}

          {/* ── eBay Similar Items (auto-searched in background) ── */}
          <View style={styles.ebayCard}>
            <Pressable
              onPress={() => setEbayVisualExpanded(e => !e)}
              style={styles.ebayCardHeader}
            >
              <View style={styles.ebayCardHeaderLeft}>
                <View style={styles.ebayIconWrap}>
                  <MaterialIcons name="image-search" size={12} color={Colors.info} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.ebayCardTitle}>eBay Visual Matches</Text>
                  {ebayVisualLoading ? (
                    <Text style={styles.ebayCardSub}>Searching eBay GB...</Text>
                  ) : ebayVisualResult?.available ? (
                    <Text style={styles.ebayCardSub}>
                      {ebayVisualResult.totalResults} similar listing{ebayVisualResult.totalResults !== 1 ? 's' : ''} found
                      {ebayVisualResult.topCategory ? ` · ${ebayVisualResult.topCategory.name}` : ''}
                    </Text>
                  ) : ebayVisualResult ? (
                    <Text style={[styles.ebayCardSub, { color: Colors.textTertiary }]}>
                      {ebayVisualResult.error ?? 'No matches found'}
                    </Text>
                  ) : null}
                </View>
              </View>
              {ebayVisualLoading ? (
                <ActivityIndicator size="small" color={Colors.info} style={{ width: 16, height: 16 }} />
              ) : ebayVisualResult?.available && (ebayVisualResult.items.length > 0) ? (
                <MaterialIcons
                  name={ebayVisualExpanded ? 'expand-less' : 'expand-more'}
                  size={16}
                  color={Colors.textTertiary}
                />
              ) : null}
            </Pressable>

            {/* Disclaimer — always visible when results present */}
            {ebayVisualResult?.available ? (
              <View style={styles.ebayDisclaimer}>
                <MaterialIcons name="info-outline" size={10} color={Colors.textTertiary} />
                <Text style={styles.ebayDisclaimerText}>
                  Similar listings — not confirmed identification. Use as category/context evidence only.
                </Text>
              </View>
            ) : null}

            {/* Price range note */}
            {ebayVisualResult?.available && ebayVisualResult.items.length > 0 ? (() => {
              const pr = formatAskingPriceRange(ebayVisualResult.items);
              return pr ? (
                <View style={styles.ebayPriceNote}>
                  <MaterialIcons name="price-tag" size={10} color={Colors.warning} />
                  <Text style={styles.ebayPriceNoteText}>{pr} — asking prices, not sold prices</Text>
                </View>
              ) : null;
            })() : null}

            {/* Results (collapsed: top 2, expanded: all 5) */}
            {ebayVisualResult?.available && ebayVisualResult.items.length > 0 && (
              <View style={styles.ebayItemsList}>
                {(ebayVisualExpanded ? ebayVisualResult.items : ebayVisualResult.items.slice(0, 2)).map((item, i) => (
                  <Pressable
                    key={item.itemId || i}
                    onPress={() => item.itemWebUrl ? Linking.openURL(item.itemWebUrl) : null}
                    style={({ pressed }) => [styles.ebayItem, pressed && { opacity: 0.78 }]}
                    disabled={!item.itemWebUrl}
                  >
                    {item.image ? (
                      <Image
                        source={{ uri: item.image }}
                        style={styles.ebayItemImg}
                        contentFit="cover"
                        transition={100}
                      />
                    ) : (
                      <View style={[styles.ebayItemImg, styles.ebayItemImgPlaceholder]}>
                        <MaterialIcons name="image-not-supported" size={14} color={Colors.textTertiary} />
                      </View>
                    )}
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={styles.ebayItemTitle} numberOfLines={2}>{item.title}</Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        {item.price.value > 0 ? (
                          <Text style={styles.ebayItemPrice}>£{item.price.value.toFixed(2)}</Text>
                        ) : null}
                        {item.primaryCategoryName ? (
                          <View style={styles.ebayCatChip}>
                            <Text style={styles.ebayCatChipText} numberOfLines={1}>{item.primaryCategoryName}</Text>
                          </View>
                        ) : null}
                      </View>
                    </View>
                    {item.itemWebUrl ? (
                      <MaterialIcons name="open-in-new" size={11} color={Colors.textTertiary} style={{ flexShrink: 0 }} />
                    ) : null}
                  </Pressable>
                ))}
                {!ebayVisualExpanded && ebayVisualResult.items.length > 2 ? (
                  <Pressable onPress={() => setEbayVisualExpanded(true)} style={styles.ebayShowMore}>
                    <Text style={styles.ebayShowMoreText}>Show all {ebayVisualResult.items.length} similar listings</Text>
                    <MaterialIcons name="expand-more" size={13} color={Colors.info} />
                  </Pressable>
                ) : null}
              </View>
            )}
          </View>

          {/* Disclaimer */}
          <View style={styles.disclaimer}>
            <MaterialIcons name="info-outline" size={14} color={Colors.textTertiary} />
            <Text style={styles.disclaimerText}>
              AI identification is a prediction. Verify before listing high-value items.
            </Text>
          </View>

          {/* Actions */}
          <View style={styles.reviewActions}>
            <Pressable
              style={({ pressed }) => [styles.actionBtn, styles.actionBtnSecondary, pressed && { opacity: 0.8 }]}
              onPress={handleReset}
            >
              <Text style={styles.actionBtnSecondaryText}>Scan Another</Text>
            </Pressable>
            {savedItemId ? (
              <Pressable
                style={({ pressed }) => [styles.actionBtn, styles.actionBtnPrimary, pressed && { opacity: 0.85 }]}
                onPress={() => router.push(`/create-listing?id=${savedItemId}` as any)}
              >
                {isUploading ? (
                  <ActivityIndicator size="small" color={Colors.background} />
                ) : (
                  <MaterialIcons name="sell" size={18} color={Colors.background} />
                )}
                <Text style={styles.actionBtnPrimaryText}>
                  {isUploading ? 'Uploading...' : 'Create Listing'}
                </Text>
              </Pressable>
            ) : (
              <Pressable
                style={({ pressed }) => [styles.actionBtn, styles.actionBtnPrimary, pressed && { opacity: 0.85 }]}
                onPress={handleSaveToInventory}
                disabled={isSaving}
              >
                {isSaving ? (
                  <ActivityIndicator size="small" color={Colors.background} />
                ) : (
                  <MaterialIcons name="add" size={18} color={Colors.background} />
                )}
                <Text style={styles.actionBtnPrimaryText}>
                  {isSaving ? 'Saving...' : 'Add to Inventory'}
                </Text>
              </Pressable>
            )}
          </View>
        </ScrollView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: Spacing.base, paddingBottom: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder,
  },
  backBtn: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center' },
  backBtnPlaceholder: { width: 36 },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: { fontSize: Typography.size.base, fontWeight: Typography.weight.bold, color: Colors.textPrimary, letterSpacing: 1 },

  content: { padding: Spacing.base, gap: Spacing.xl },
  sectionTitle: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: Spacing.sm },

  // Scan hero
  scanHero: { height: 180, borderRadius: Radius.xl, overflow: 'hidden', position: 'relative' },
  scanHeroOverlay: { flex: 1, backgroundColor: 'rgba(9,9,14,0.55)', alignItems: 'center', justifyContent: 'center', gap: Spacing.md },
  scanReticle: { width: 100, height: 100, position: 'relative' },
  corner: { position: 'absolute', width: 20, height: 20, borderColor: Colors.primary, borderWidth: 2.5 },
  cornerTL: { top: 0, left: 0, borderRightWidth: 0, borderBottomWidth: 0 },
  cornerTR: { top: 0, right: 0, borderLeftWidth: 0, borderBottomWidth: 0 },
  cornerBL: { bottom: 0, left: 0, borderRightWidth: 0, borderTopWidth: 0 },
  cornerBR: { bottom: 0, right: 0, borderLeftWidth: 0, borderTopWidth: 0 },
  scanHeroText: { fontSize: Typography.size.xs, color: Colors.textSecondary, letterSpacing: 0.3, textAlign: 'center' },

  // Methods
  methodGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  methodCard: {
    width: '48%', backgroundColor: Colors.surface, borderRadius: Radius.xl,
    borderWidth: 1, borderColor: Colors.surfaceBorder, padding: Spacing.base, gap: Spacing.sm, ...Shadow.sm,
  },
  methodIcon: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.primaryDim, alignItems: 'center', justifyContent: 'center' },
  methodLabel: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.textPrimary },
  methodDesc: { fontSize: Typography.size.xs, color: Colors.textTertiary, lineHeight: 16 },

  // Quick specialists
  quickSpecialists: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  quickChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs, borderRadius: Radius.pill, backgroundColor: Colors.surface, borderWidth: 1 },
  quickDot: { width: 6, height: 6, borderRadius: 3 },
  quickLabel: { fontSize: Typography.size.xs, color: Colors.textSecondary },

  // Specialist select
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, margin: Spacing.base, backgroundColor: Colors.surface, borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderWidth: 1, borderColor: Colors.surfaceBorder },
  searchInput: { flex: 1, fontSize: Typography.size.sm, color: Colors.textPrimary, includeFontPadding: false },
  specialistList: { paddingHorizontal: Spacing.base, gap: Spacing.xs },
  autoDetectBtn: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.accentDim, borderRadius: Radius.lg, padding: Spacing.base, borderWidth: 1, borderColor: Colors.accent + '40', marginBottom: Spacing.sm },
  autoDetectTitle: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.accent },
  autoDetectSub: { fontSize: Typography.size.xs, color: Colors.textSecondary },
  specialistRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surface, borderRadius: Radius.lg, overflow: 'hidden', borderWidth: 1, borderColor: Colors.surfaceBorder },
  specialistColorBar: { width: 4, alignSelf: 'stretch' },
  specialistRowInfo: { flex: 1, paddingVertical: Spacing.md, gap: 2 },
  specialistRowName: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.textPrimary },
  specialistRowDesc: { fontSize: Typography.size.xs, color: Colors.textTertiary },
  specialistRowMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingRight: Spacing.md },
  specialistCapCount: { fontSize: Typography.size.xs, color: Colors.textTertiary },

  // Capture step
  specialistBanner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1 },
  specialistBannerDot: { width: 10, height: 10, borderRadius: 5 },
  specialistBannerName: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  specialistBannerSub: { fontSize: Typography.size.xs, color: Colors.textTertiary },

  // Photo counter chip (replaces old badge)
  photoCounterChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderRadius: Radius.pill, paddingHorizontal: 8, paddingVertical: 5,
    borderWidth: 1,
  },
  photoCounterChipPending: {
    backgroundColor: Colors.surfaceHighlight,
    borderColor: Colors.surfaceBorder,
  },
  photoCounterChipReady: {
    backgroundColor: Colors.successDim,
    borderColor: Colors.success + '50',
  },
  photoCounterText: {
    fontSize: 11, fontWeight: Typography.weight.bold, color: Colors.textTertiary,
  },
  photoCounterTextReady: { color: Colors.success },

  errorBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, backgroundColor: Colors.dangerDim, borderRadius: Radius.md, padding: Spacing.md, borderWidth: 1, borderColor: Colors.danger + '40' },
  errorText: { flex: 1, fontSize: Typography.size.xs, color: Colors.danger, lineHeight: 18 },

  // Multi-photo grid layout
  multiPhotoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  // Large slot: takes full width (primary photo)
  multiPhotoSlotLarge: {
    width: '100%',
    aspectRatio: 1.8,
  },
  // Small slots: 3 equal columns for remaining 3 photos
  multiPhotoSlotSmall: {
    width: '31%',
    aspectRatio: 1,
  },
  multiPhotoSlotInner: {
    flex: 1,
    borderRadius: Radius.lg,
    overflow: 'hidden',
    position: 'relative',
  },
  multiPhotoSlotEmpty: {
    backgroundColor: Colors.surface,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: Colors.surfaceBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  multiPhotoSlotRequired: {
    borderColor: Colors.primary + '60',
  },
  multiPhotoSlotCaptured: {
    borderWidth: 2,
    borderColor: Colors.success + '70',
    borderStyle: 'solid',
  },
  emptySlotContent: {
    flex: 1, alignItems: 'center', justifyContent: 'center', gap: 5,
    paddingHorizontal: Spacing.sm,
  },
  emptySlotIcon: {
    width: 48, height: 48, borderRadius: Radius.md,
    backgroundColor: Colors.surfaceHighlight,
    alignItems: 'center', justifyContent: 'center',
  },
  emptySlotIconRequired: {
    backgroundColor: Colors.primaryDim,
  },
  emptySlotLabel: {
    fontSize: 11, fontWeight: Typography.weight.semibold,
    color: Colors.textSecondary, textAlign: 'center',
  },
  emptySlotLabelRequired: { color: Colors.textPrimary },
  requiredPill: {
    backgroundColor: Colors.primaryDim,
    borderRadius: Radius.pill,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  requiredPillText: {
    fontSize: 8, fontWeight: Typography.weight.bold,
    color: Colors.primary, textTransform: 'uppercase', letterSpacing: 0.3,
  },
  optionalLabel: {
    fontSize: 8, color: Colors.textTertiary,
    textTransform: 'uppercase', letterSpacing: 0.2,
  },
  slotHint: {
    fontSize: 9, color: Colors.textTertiary,
    textAlign: 'center', lineHeight: 13, marginTop: 2,
  },
  // Overlay bar at bottom of captured slot
  capturedOverlayBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: 'rgba(0,0,0,0.62)',
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 8, paddingVertical: 5, gap: 4,
  },
  capturedLabel: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4,
  },
  capturedLabelText: {
    fontSize: 9, color: '#fff', fontWeight: Typography.weight.semibold, flex: 1,
  },
  retakeBtn: {
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderRadius: Radius.sm,
    paddingHorizontal: 6, paddingVertical: 3,
    flexDirection: 'row', alignItems: 'center', gap: 3,
  },
  removeBtn: {
    position: 'absolute', top: 6, right: 6,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 10,
    width: 20, height: 20,
    alignItems: 'center', justifyContent: 'center',
  },

  multiPhotoTip: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm,
    backgroundColor: Colors.warningDim, borderRadius: Radius.md,
    padding: Spacing.sm, borderWidth: 1, borderColor: Colors.warning + '30',
  },
  multiPhotoTipText: {
    flex: 1, fontSize: 11, color: Colors.warning, lineHeight: 16,
  },

  captureActionBar: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: Colors.surface, borderTopWidth: 1, borderTopColor: Colors.surfaceBorder, padding: Spacing.base, flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  captureProgressInfo: { flex: 1, gap: 2 },
  captureProgress: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.textPrimary },
  captureRequiredHint: { fontSize: Typography.size.xs, color: Colors.warning },
  captureExtraCount: { fontSize: Typography.size.xs, color: Colors.primary },
  identifyBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, backgroundColor: Colors.primary, borderRadius: Radius.md, padding: Spacing.md, ...Shadow.glow },
  identifyBtnDisabled: { backgroundColor: Colors.surfaceHighlight, shadowOpacity: 0 },
  identifyBtnText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.background },
  identifyBtnTextDisabled: { color: Colors.textTertiary },

  // Processing
  processingView: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.xl, padding: Spacing.xl },
  processingIndicator: { position: 'relative', width: 80, height: 80, alignItems: 'center', justifyContent: 'center' },
  processingRing: { position: 'absolute', width: 80, height: 80, borderRadius: 40, borderWidth: 2 },
  processingTitle: { fontSize: Typography.size.xl, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  processingText: { fontSize: Typography.size.sm, color: Colors.textSecondary, textAlign: 'center' },
  processingSteps: { gap: Spacing.sm, alignSelf: 'stretch' },
  processingStep: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surface, borderRadius: Radius.md, padding: Spacing.md, borderWidth: 1, borderColor: Colors.surfaceBorder },
  processingStepText: { fontSize: Typography.size.sm, color: Colors.textSecondary },
  aiPoweredBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: Colors.accentDim, borderRadius: Radius.pill, paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs },
  aiPoweredText: { fontSize: Typography.size.xs, color: Colors.accent },

  // Review
  savedBanner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.successDim, borderRadius: Radius.md, padding: Spacing.md, borderWidth: 1, borderColor: Colors.success + '40' },
  savedBannerText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.success },

  resultHeader: { flexDirection: 'row', gap: Spacing.md, alignItems: 'flex-start', backgroundColor: Colors.surface, borderRadius: Radius.xl, padding: Spacing.base, borderWidth: 1, borderColor: Colors.surfaceBorder },
  resultConfidence: { width: 64, height: 64, borderRadius: Radius.lg, backgroundColor: Colors.surfaceElevated, alignItems: 'center', justifyContent: 'center', borderWidth: 2 },
  resultConfidencePct: { fontSize: Typography.size.md, fontWeight: Typography.weight.bold },
  resultConfidenceLabel: { fontSize: 8, textTransform: 'uppercase', letterSpacing: 0.4 },
  resultHeaderInfo: { flex: 1, gap: 4 },
  resultTitle: { fontSize: Typography.size.base, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  resultCondition: { fontSize: Typography.size.sm, color: Colors.textSecondary },
  resultSourceRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  resultSource: { fontSize: Typography.size.xs, color: Colors.textTertiary },
  specialistTag: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: Radius.sm },
  specialistTagText: { fontSize: 9, fontWeight: Typography.weight.bold, textTransform: 'uppercase', letterSpacing: 0.3 },

  reviewWarning: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.warningDim, borderRadius: Radius.md, padding: Spacing.md, borderWidth: 1, borderColor: Colors.warning + '40' },
  reviewWarningText: { flex: 1, fontSize: Typography.size.xs, color: Colors.warning },

  imageStrip: { marginHorizontal: -Spacing.base },
  imageStripContent: { paddingHorizontal: Spacing.base, gap: Spacing.sm },
  imageStripThumb: { width: 80, height: 80, borderRadius: Radius.md },

  valuationCard: { backgroundColor: Colors.surface, borderRadius: Radius.xl, padding: Spacing.base, gap: Spacing.md, borderWidth: 1, borderColor: Colors.surfaceBorder },
  valuationCardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  valuationCardTitle: { fontSize: Typography.size.xs, fontWeight: Typography.weight.semibold, color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5 },
  valConfBadge: { paddingHorizontal: Spacing.sm, paddingVertical: 2, borderRadius: Radius.pill },
  valConfText: { fontSize: Typography.size.xs, fontWeight: Typography.weight.semibold },
  valuationRow: { flexDirection: 'row', justifyContent: 'space-around' },
  valuationItem: { alignItems: 'center', gap: 2 },
  valuationMidItem: { backgroundColor: Colors.primaryDim, borderRadius: Radius.lg, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  valuationLabel: { fontSize: Typography.size.xs, color: Colors.textTertiary },
  valuationValue: { fontSize: Typography.size.xl, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  valuationMidValue: { fontSize: Typography.size.xxl, color: Colors.primary },
  saleProb: { fontSize: Typography.size.xs, color: Colors.textSecondary, textAlign: 'center' },
  suggestionRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, backgroundColor: Colors.warningDim, borderRadius: Radius.sm, padding: Spacing.sm },
  suggestionText: { fontSize: Typography.size.xs, color: Colors.warning, flex: 1 },

  attributesCard: { backgroundColor: Colors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceBorder, overflow: 'hidden' },
  attributeRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder },
  attributeKey: { fontSize: Typography.size.xs, color: Colors.textTertiary, textTransform: 'capitalize', flex: 1 },
  attributeValue: { fontSize: Typography.size.xs, fontWeight: Typography.weight.semibold, color: Colors.textPrimary },

  conditionCard: { backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.xs, borderWidth: 1, borderColor: Colors.surfaceBorder },
  conditionCardTitle: { fontSize: Typography.size.xs, fontWeight: Typography.weight.semibold, color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.4 },
  conditionCardText: { fontSize: Typography.size.sm, color: Colors.textSecondary, lineHeight: 20 },

  warningsCard: { backgroundColor: Colors.dangerDim, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.sm, borderWidth: 1, borderColor: Colors.danger + '30' },
  warningRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  warningText: { flex: 1, fontSize: Typography.size.xs, color: Colors.danger, lineHeight: 16 },

  disclaimer: { flexDirection: 'row', gap: Spacing.xs, backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.sm, padding: Spacing.sm },
  disclaimerText: { fontSize: Typography.size.xs, color: Colors.textTertiary, flex: 1, lineHeight: 16 },

  reviewActions: { flexDirection: 'row', gap: Spacing.sm },
  actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xs, padding: Spacing.md, borderRadius: Radius.md },
  actionBtnPrimary: { backgroundColor: Colors.primary, ...Shadow.glow },
  actionBtnPrimaryText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.background },
  actionBtnSecondary: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.surfaceBorder },
  actionBtnSecondaryText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.textSecondary },
  actionBtnSaved: { backgroundColor: Colors.successDim, borderWidth: 1, borderColor: Colors.success + '40' },
  actionBtnSavedText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.success },

  // Measurement step
  measureHeader: { alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.lg },
  measureHeaderIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: Colors.primaryDim, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: Colors.primary + '40' },
  measureHeaderTitle: { fontSize: Typography.size.xl, fontWeight: Typography.weight.bold, color: Colors.textPrimary, textAlign: 'center' },
  measureHeaderSub: { fontSize: Typography.size.sm, color: Colors.textSecondary, textAlign: 'center', lineHeight: 20, paddingHorizontal: Spacing.base },
  catalogueCard: { backgroundColor: Colors.surface, borderRadius: Radius.xl, padding: Spacing.base, gap: Spacing.sm, borderWidth: 1, borderColor: Colors.primary + '30' },
  catalogueCardTitle: { fontSize: 10, fontWeight: Typography.weight.bold, color: Colors.primary, textTransform: 'uppercase', letterSpacing: 0.5 },
  catalogueCardSub: { fontSize: Typography.size.sm, color: Colors.textSecondary, lineHeight: 18 },
  catalogueSpecRow: { flexDirection: 'row', gap: Spacing.md, flexWrap: 'wrap', marginTop: Spacing.xs },
  catalogueSpecItem: { flex: 1, backgroundColor: Colors.primaryDim, borderRadius: Radius.md, padding: Spacing.md, alignItems: 'center', gap: 4, minWidth: 80 },
  catalogueSpecLabel: { fontSize: 9, fontWeight: Typography.weight.bold, color: Colors.primary, textTransform: 'uppercase', letterSpacing: 0.4 },
  catalogueSpecValue: { fontSize: Typography.size.lg, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  measureCard: { backgroundColor: Colors.surface, borderRadius: Radius.xl, padding: Spacing.base, gap: Spacing.md, borderWidth: 1, borderColor: Colors.surfaceBorder },
  measureCardTitle: { fontSize: 10, fontWeight: Typography.weight.bold, color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5 },
  measureRow: { flexDirection: 'row', gap: Spacing.md },
  measureField: { flex: 1, gap: Spacing.xs },
  measureFieldLabel: { fontSize: Typography.size.xs, fontWeight: Typography.weight.semibold, color: Colors.textSecondary },
  measureInputWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.surfaceBorder, paddingHorizontal: Spacing.md, gap: Spacing.xs },
  measureInput: { flex: 1, fontSize: Typography.size.base, fontWeight: Typography.weight.bold, color: Colors.textPrimary, paddingVertical: Spacing.md, includeFontPadding: false },
  measureUnit: { fontSize: Typography.size.xs, color: Colors.textTertiary, fontWeight: Typography.weight.semibold },
  measureResultCard: { backgroundColor: Colors.surface, borderRadius: Radius.xl, padding: Spacing.base, gap: Spacing.sm, borderWidth: 1, borderColor: Colors.surfaceBorder },
  measureResultTitle: { fontSize: 10, fontWeight: Typography.weight.bold, color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5 },
  measureResultRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.md, padding: Spacing.sm },
  measureResultRowGood: { backgroundColor: Colors.successDim },
  measureResultRowBad: { backgroundColor: Colors.dangerDim },
  measureResultText: { flex: 1, fontSize: Typography.size.xs, color: Colors.textSecondary, lineHeight: 16 },
  measureContraWarn: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, backgroundColor: Colors.dangerDim, borderRadius: Radius.md, padding: Spacing.md, borderWidth: 1, borderColor: Colors.danger + '40', marginTop: Spacing.xs },
  measureContraWarnText: { flex: 1, fontSize: Typography.size.xs, color: Colors.danger, lineHeight: 16 },
  measureActions: { gap: Spacing.sm },
  measureConfirmBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, backgroundColor: Colors.primary, borderRadius: Radius.md, padding: Spacing.base, ...Shadow.glow },
  measureConfirmBtnDisabled: { backgroundColor: Colors.surfaceHighlight, shadowOpacity: 0 },
  measureConfirmBtnText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.background },
  measureProceedBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, backgroundColor: Colors.success, borderRadius: Radius.md, padding: Spacing.base },
  measureProceedBtnText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.background },
  measureSkipBtn: { alignItems: 'center', paddingVertical: Spacing.sm },
  measureSkipBtnText: { fontSize: Typography.size.xs, color: Colors.textTertiary, fontWeight: Typography.weight.medium },
  feedbackBanner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.accentDim, borderRadius: Radius.md, padding: Spacing.md, borderWidth: 1, borderColor: Colors.accent + '40' },
  fbBtnWrong: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.dangerDim, borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderWidth: 1, borderColor: Colors.danger + '40' },
  fbBtnCorrect: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.success, borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },

  // eBay visual search card
  ebayCard: { backgroundColor: Colors.surface, borderRadius: Radius.xl, borderWidth: 1, borderColor: Colors.info + '30', overflow: 'hidden' },
  ebayCardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: Spacing.md, gap: Spacing.sm },
  ebayCardHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flex: 1 },
  ebayIconWrap: { width: 26, height: 26, borderRadius: Radius.sm, backgroundColor: Colors.info + '20', alignItems: 'center', justifyContent: 'center' },
  ebayCardTitle: { fontSize: 10, fontWeight: Typography.weight.bold, color: Colors.info, textTransform: 'uppercase', letterSpacing: 0.5 },
  ebayCardSub: { fontSize: Typography.size.xs, color: Colors.textTertiary, marginTop: 1 },
  ebayDisclaimer: { flexDirection: 'row', alignItems: 'flex-start', gap: 4, marginHorizontal: Spacing.md, marginBottom: Spacing.xs, backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.sm, padding: Spacing.xs },
  ebayDisclaimerText: { flex: 1, fontSize: 9, color: Colors.textTertiary, lineHeight: 13 },
  ebayPriceNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 4, marginHorizontal: Spacing.md, marginBottom: Spacing.sm },
  ebayPriceNoteText: { flex: 1, fontSize: 10, color: Colors.warning, lineHeight: 14 },
  ebayItemsList: { borderTopWidth: 1, borderTopColor: Colors.surfaceBorder },
  ebayItem: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, padding: Spacing.sm, borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder + '60' },
  ebayItemImg: { width: 44, height: 44, borderRadius: Radius.sm, flexShrink: 0 },
  ebayItemImgPlaceholder: { backgroundColor: Colors.surfaceHighlight, alignItems: 'center', justifyContent: 'center' },
  ebayItemTitle: { fontSize: Typography.size.xs, color: Colors.textSecondary, lineHeight: 16 },
  ebayItemPrice: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  ebayCatChip: { backgroundColor: Colors.info + '15', borderRadius: Radius.pill, paddingHorizontal: 5, paddingVertical: 2, borderWidth: 1, borderColor: Colors.info + '30' },
  ebayCatChipText: { fontSize: 8, color: Colors.info, fontWeight: Typography.weight.semibold, maxWidth: 100 },
  ebayShowMore: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, padding: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.surfaceBorder },
  ebayShowMoreText: { fontSize: Typography.size.xs, color: Colors.info, fontWeight: Typography.weight.semibold },

  // Niche capture guide card
  nicheCaptureCard: {
    backgroundColor: Colors.surface, borderRadius: Radius.xl,
    borderWidth: 1, borderColor: Colors.surfaceBorder,
    overflow: 'hidden',
  },
  nicheCaptureHeader: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    padding: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder,
    backgroundColor: Colors.surfaceHighlight,
  },
  nicheCaptureIcon: {
    width: 26, height: 26, borderRadius: Radius.sm,
    alignItems: 'center', justifyContent: 'center',
  },
  nicheCaptureTitle: {
    fontSize: Typography.size.xs, fontWeight: Typography.weight.bold,
    textTransform: 'uppercase', letterSpacing: 0.4,
  },
  nicheCaptureRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm,
    paddingHorizontal: Spacing.md, paddingVertical: 6,
    borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder + '50',
  },
  nicheCaptureText: {
    flex: 1, fontSize: Typography.size.xs, color: Colors.textSecondary, lineHeight: 16,
  },

  silverCapCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#1A150A', borderRadius: Radius.xl,
    padding: Spacing.base, borderWidth: 1, borderColor: '#8B7340',
  },
  silverCapLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, flex: 1 },
  silverCapIcon: {
    width: 48, height: 48, borderRadius: Radius.lg,
    backgroundColor: Colors.goldDim, borderWidth: 1, borderColor: Colors.gold + '40',
    alignItems: 'center', justifyContent: 'center',
  },
  silverCapText: { flex: 1, gap: 3 },
  silverCapTitle: {
    fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.gold,
  },
  silverCapSub: {
    fontSize: Typography.size.xs, color: Colors.gold + '90', lineHeight: 15,
  },
  silverCapBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.gold + '20', borderRadius: Radius.pill,
    paddingHorizontal: Spacing.sm, paddingVertical: 5,
    borderWidth: 1, borderColor: Colors.gold + '40',
  },
  silverCapBadgeText: {
    fontSize: 9, fontWeight: Typography.weight.bold,
    color: Colors.gold, textTransform: 'uppercase', letterSpacing: 0.5,
  },
  // Islamic & Indian Silver
  islamicCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#141B22', borderRadius: Radius.xl,
    padding: Spacing.base, borderWidth: 1, borderColor: '#A8B5C025',
  },
  islamicCardLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, flex: 1 },
  islamicCardIcon: {
    width: 48, height: 48, borderRadius: Radius.lg,
    backgroundColor: '#A8B5C012', borderWidth: 1, borderColor: '#A8B5C025',
    alignItems: 'center', justifyContent: 'center',
  },
  islamicCardText: { flex: 1, gap: 3 },
  islamicCardTitle: {
    fontSize: Typography.size.sm, fontWeight: Typography.weight.bold,
    color: '#C8D5E0',
  },
  islamicCardSub: {
    fontSize: Typography.size.xs, color: '#5C6B78', lineHeight: 15,
  },
  islamicCardBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#A8B5C015', borderRadius: Radius.pill,
    paddingHorizontal: Spacing.sm, paddingVertical: 5,
    borderWidth: 1, borderColor: '#A8B5C025',
  },
  islamicCardBadgeText: {
    fontSize: 9, fontWeight: Typography.weight.bold,
    color: '#A8B5C0', textTransform: 'uppercase', letterSpacing: 0.5,
  },
  islamicCardFeatures: {
    flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs,
    marginTop: -Spacing.sm,
  },
  islamicFeatureChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#1A2028', borderRadius: Radius.pill,
    paddingHorizontal: Spacing.sm, paddingVertical: 4,
    borderWidth: 1, borderColor: '#2A3540',
  },
  islamicFeatureDot: {
    width: 4, height: 4, borderRadius: 2,
    backgroundColor: '#A8B5C060',
  },
  islamicFeatureText: {
    fontSize: 9, color: '#6B7A87', fontWeight: Typography.weight.medium,
  },
});
