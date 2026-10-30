// SWISH Bulk Silver Capture Station
// Rapid batch workflow: photograph → measure → AI identify → market value → eBay list
// Uses the existing identification, valuation, inventory, and eBay integration.

import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  TextInput, ActivityIndicator, Alert, FlatList,
  Platform, Dimensions, KeyboardAvoidingView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { Colors, Typography, Spacing, Radius, Shadow } from '@/constants/theme';
import { useApp } from '@/hooks/useApp';
import { useAlert } from '@/template';
import { getSupabaseClient } from '@/template';
import {
  createBatch,
  getActiveBatches,
  completeBatch,
  computeCommercialDecision,
  computeBatchGroups,
  computeBatchSummary,
  generateCaptureRef,
  todayDateString,
  SilverBatch,
  CoinCapture,
  CaptureGroup,
  BatchSummary,
  SaleStrategy,
  CommercialDecision,
} from '@/services/silverBatchService';
import {
  identifyItemWithAI,
  uploadItemImages,
  updateItemMedia,
  saveIdentifiedItem,
  CapturedImage,
} from '@/services/aiIdentificationService';
import { getMarketValue } from '@/services/marketValueService';
import { generateListing, saveListing } from '@/services/listingService';

const { width: SCREEN_W } = Dimensions.get('window');

// ─────────────────────────────────────────────────────────────────────────────
// STEP TYPES
// ─────────────────────────────────────────────────────────────────────────────

type Step =
  | 'home'           // New batch / resume
  | 'batch_setup'    // Create new batch
  | 'capture'        // Rapid coin capture
  | 'processing'     // AI analysis + valuation (batch)
  | 'results'        // Batch summary
  | 'review'         // Per-coin review
  | 'submitting';    // Creating eBay listings

// ─────────────────────────────────────────────────────────────────────────────
// IMAGE QUALITY VALIDATOR
// ─────────────────────────────────────────────────────────────────────────────

interface ImageQualityResult {
  ok: boolean;
  warnings: string[];
}

async function validateImageQuality(uri: string): Promise<ImageQualityResult> {
  // Basic heuristic: compress and check resulting size
  try {
    const result = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: 400 } }],
      { compress: 0.5, format: ImageManipulator.SaveFormat.JPEG, base64: true }
    );
    const b64 = result.base64 ?? '';
    const sizeKb = (b64.length * 3) / 4 / 1024;
    const warnings: string[] = [];
    if (sizeKb < 5) warnings.push('Image may be too dark or blurry');
    return { ok: warnings.length === 0, warnings };
  } catch {
    return { ok: true, warnings: [] };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// STRATEGY BADGE
// ─────────────────────────────────────────────────────────────────────────────

function StrategyBadge({ strategy, small }: { strategy: SaleStrategy; small?: boolean }) {
  const cfg: Record<SaleStrategy, { label: string; color: string; icon: string }> = {
    bin:       { label: 'Buy It Now', color: Colors.primary, icon: 'sell' },
    auction:   { label: 'Auction',    color: Colors.gold,    icon: 'gavel' },
    group:     { label: 'Group Lot',  color: Colors.info,    icon: 'layers' },
    mixed_lot: { label: 'Study Lot',  color: Colors.textSecondary, icon: 'inventory-2' },
    hold:      { label: 'Hold',       color: Colors.warning,  icon: 'pause' },
  };
  const c = cfg[strategy] ?? cfg.mixed_lot;
  const sz = small ? 10 : 12;
  return (
    <View style={[sb.badge, { backgroundColor: c.color + '20', borderColor: c.color + '50' }]}>
      <MaterialIcons name={c.icon as any} size={sz} color={c.color} />
      <Text style={[sb.label, { color: c.color, fontSize: small ? 8 : 10 }]}>{c.label}</Text>
    </View>
  );
}

const sb = StyleSheet.create({
  badge: { flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: Radius.pill, paddingHorizontal: 7, paddingVertical: 3, borderWidth: 1 },
  label: { fontWeight: Typography.weight.bold, letterSpacing: 0.3 },
});

// ─────────────────────────────────────────────────────────────────────────────
// CONFIDENCE BADGE
// ─────────────────────────────────────────────────────────────────────────────

function ConfBadge({ confidence }: { confidence: number }) {
  const color = confidence >= 0.80 ? Colors.success : confidence >= 0.55 ? Colors.warning : Colors.danger;
  const label = confidence >= 0.80 ? 'High' : confidence >= 0.55 ? 'Med' : 'Low';
  return (
    <View style={[cb.badge, { borderColor: color + '50', backgroundColor: color + '15' }]}>
      <Text style={[cb.pct, { color }]}>{Math.round(confidence * 100)}%</Text>
      <Text style={[cb.label, { color }]}>{label}</Text>
    </View>
  );
}

const cb = StyleSheet.create({
  badge: { alignItems: 'center', borderRadius: Radius.sm, paddingHorizontal: 6, paddingVertical: 4, borderWidth: 1, minWidth: 40 },
  pct: { fontSize: 12, fontWeight: Typography.weight.bold },
  label: { fontSize: 8, fontWeight: Typography.weight.semibold, textTransform: 'uppercase', letterSpacing: 0.3 },
});

// ─────────────────────────────────────────────────────────────────────────────
// IMAGE SLOT BUTTON
// ─────────────────────────────────────────────────────────────────────────────

function ImageSlot({
  label, uri, required, large, onCapture, onLibrary, onRetake, warnings,
}: {
  label: string; uri?: string; required?: boolean; large?: boolean;
  onCapture: () => void; onLibrary: () => void; onRetake?: () => void;
  warnings?: string[];
}) {
  const h = large ? 160 : 100;
  const iconSz = large ? 28 : 20;
  return (
    <View style={{ width: large ? '100%' : '31%', marginBottom: Spacing.sm }}>
      {uri ? (
        <View style={[is.captured, { height: h }]}>
          <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
          {warnings && warnings.length > 0 ? (
            <View style={is.warnBadge}>
              <MaterialIcons name="warning" size={10} color={Colors.warning} />
              <Text style={is.warnText}>{warnings[0].slice(0, 30)}</Text>
            </View>
          ) : (
            <View style={is.okBadge}><MaterialIcons name="check-circle" size={11} color={Colors.success} /></View>
          )}
          <Pressable onPress={onCapture} style={is.retakeBtn} hitSlop={4}>
            <MaterialIcons name="refresh" size={13} color="#fff" />
            <Text style={is.retakeTxt}>Retake</Text>
          </Pressable>
        </View>
      ) : (
        <View style={[is.empty, { height: h }, required && is.emptyRequired]}>
          <View style={is.captureActions}>
            <Pressable onPress={onCapture} style={is.captureBtn} hitSlop={6}>
              <MaterialIcons name="photo-camera" size={iconSz} color={required ? Colors.primary : Colors.textTertiary} />
            </Pressable>
            <Pressable onPress={onLibrary} style={is.captureBtn} hitSlop={6}>
              <MaterialIcons name="photo-library" size={iconSz - 4} color={Colors.textTertiary} />
            </Pressable>
          </View>
          <Text style={[is.slotLabel, required && { color: Colors.textPrimary }]}>{label}</Text>
          {required ? (
            <View style={is.reqPill}><Text style={is.reqText}>Required</Text></View>
          ) : (
            <Text style={is.optText}>Optional</Text>
          )}
        </View>
      )}
    </View>
  );
}

const is = StyleSheet.create({
  empty: { borderRadius: Radius.lg, borderWidth: 1.5, borderStyle: 'dashed', borderColor: Colors.surfaceBorder, backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center', gap: 4 },
  emptyRequired: { borderColor: Colors.primary + '60' },
  captured: { borderRadius: Radius.lg, overflow: 'hidden', borderWidth: 2, borderColor: Colors.success + '70', position: 'relative' },
  captureActions: { flexDirection: 'row', gap: Spacing.sm },
  captureBtn: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.primaryDim, alignItems: 'center', justifyContent: 'center' },
  slotLabel: { fontSize: 11, fontWeight: Typography.weight.semibold, color: Colors.textSecondary, textAlign: 'center' },
  reqPill: { backgroundColor: Colors.primaryDim, borderRadius: Radius.pill, paddingHorizontal: 6, paddingVertical: 2 },
  reqText: { fontSize: 8, color: Colors.primary, fontWeight: Typography.weight.bold, textTransform: 'uppercase' },
  optText: { fontSize: 8, color: Colors.textTertiary, textTransform: 'uppercase' },
  okBadge: { position: 'absolute', top: 6, right: 6, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 10, padding: 3 },
  warnBadge: { position: 'absolute', top: 6, left: 6, right: 6, flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: 'rgba(0,0,0,0.65)', borderRadius: Radius.sm, padding: 4 },
  warnText: { fontSize: 8, color: Colors.warning, flex: 1 },
  retakeBtn: { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: 'rgba(0,0,0,0.6)', paddingVertical: 5 },
  retakeTxt: { fontSize: 10, color: '#fff', fontWeight: Typography.weight.semibold },
});

// ─────────────────────────────────────────────────────────────────────────────
// COIN REVIEW CARD
// ─────────────────────────────────────────────────────────────────────────────

function CoinReviewCard({
  capture, index, onApprove, onEdit, onRemove,
}: {
  capture: CoinCapture;
  index: number;
  onApprove: (id: string) => void;
  onEdit: (capture: CoinCapture) => void;
  onRemove: (id: string) => void;
}) {
  const conf = capture.aiConfidence ?? 0;
  const strategy = capture.userSaleStrategy ?? capture.saleStrategy ?? 'mixed_lot';
  const price = capture.userPrice ?? capture.recommendedPrice ?? 0;
  const title = capture.userTitle ?? capture.listingTitle ?? capture.aiTitle ?? 'Unidentified Silver Coin';
  const isApproved = capture.userApproved;

  const images = [capture.obverseUri, capture.reverseUri, capture.countermarkUri].filter(Boolean) as string[];

  return (
    <View style={[rc.card, isApproved && rc.cardApproved]}>
      {/* Header */}
      <View style={rc.header}>
        <View style={rc.captureRef}>
          <Text style={rc.captureRefText}>{capture.captureRef}</Text>
        </View>
        {conf > 0 ? <ConfBadge confidence={conf} /> : null}
        <StrategyBadge strategy={strategy} small />
        {isApproved ? (
          <View style={rc.approvedBadge}>
            <MaterialIcons name="check-circle" size={13} color={Colors.success} />
          </View>
        ) : null}
      </View>

      {/* Images */}
      {images.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={rc.imagesRow}>
          {images.map((uri, i) => (
            <Image key={i} source={{ uri }} style={rc.thumb} contentFit="cover" transition={100} />
          ))}
        </ScrollView>
      ) : null}

      {/* Identification */}
      <Text style={rc.title} numberOfLines={2}>{title}</Text>
      {capture.weightGrams || capture.diameterMm ? (
        <Text style={rc.measurements}>
          {capture.weightGrams ? `${capture.weightGrams}g` : ''}
          {capture.weightGrams && capture.diameterMm ? ' · ' : ''}
          {capture.diameterMm ? `${capture.diameterMm}mm` : ''}
          {capture.numistaMatchScore && capture.numistaMatchScore >= 70 ? ` · ${capture.numistaN ?? 'Numista match'}` : ''}
        </Text>
      ) : null}

      {/* Market */}
      {capture.valuationMid && capture.valuationMid > 0 ? (
        <View style={rc.marketRow}>
          <Text style={rc.marketRange}>
            £{(capture.valuationLow ?? 0).toFixed(0)}–£{(capture.valuationHigh ?? 0).toFixed(0)}
          </Text>
          {price > 0 ? (
            <View style={rc.priceChip}>
              <Text style={rc.priceLabel}>
                {strategy === 'auction' ? 'Start' : 'BIN'} £{price.toFixed(2)}
              </Text>
            </View>
          ) : null}
          {capture.valuationComparables ? (
            <Text style={rc.comparables}>{capture.valuationComparables} sold</Text>
          ) : null}
        </View>
      ) : (
        <Text style={rc.noMarketData}>
          {capture.status === 'analysed' ? 'Run valuation to get pricing' : 'No market data'}
        </Text>
      )}

      {/* Warnings */}
      {(capture.aiWarnings ?? []).length > 0 ? (
        <View style={rc.warningRow}>
          <MaterialIcons name="warning" size={10} color={Colors.warning} />
          <Text style={rc.warningText} numberOfLines={1}>{capture.aiWarnings![0]}</Text>
        </View>
      ) : null}

      {/* Actions */}
      <View style={rc.actions}>
        <Pressable onPress={() => onRemove(capture.id)} style={rc.removeBtn} hitSlop={4}>
          <MaterialIcons name="close" size={14} color={Colors.danger} />
        </Pressable>
        <Pressable onPress={() => onEdit(capture)} style={rc.editBtn}>
          <MaterialIcons name="edit" size={13} color={Colors.primary} />
          <Text style={rc.editBtnText}>Edit</Text>
        </Pressable>
        {!isApproved ? (
          <Pressable onPress={() => onApprove(capture.id)} style={rc.approveBtn}>
            <MaterialIcons name="check" size={14} color={Colors.background} />
            <Text style={rc.approveBtnText}>Approve</Text>
          </Pressable>
        ) : (
          <View style={rc.approvedPill}>
            <MaterialIcons name="check-circle" size={13} color={Colors.success} />
            <Text style={rc.approvedPillText}>Approved</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const rc = StyleSheet.create({
  card: { backgroundColor: Colors.surface, borderRadius: Radius.xl, padding: Spacing.md, gap: Spacing.sm, borderWidth: 1, borderColor: Colors.surfaceBorder, ...Shadow.sm },
  cardApproved: { borderColor: Colors.success + '50', backgroundColor: Colors.successDim },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, flexWrap: 'wrap' },
  captureRef: { backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.sm, paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1, borderColor: Colors.surfaceBorder },
  captureRefText: { fontSize: 9, fontWeight: Typography.weight.bold, color: Colors.textTertiary, letterSpacing: 0.3 },
  approvedBadge: { marginLeft: 'auto' as any },
  imagesRow: { flexDirection: 'row', gap: Spacing.xs, paddingVertical: 2 },
  thumb: { width: 56, height: 56, borderRadius: Radius.sm },
  title: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.textPrimary, lineHeight: 18 },
  measurements: { fontSize: Typography.size.xs, color: Colors.textTertiary },
  marketRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flexWrap: 'wrap' },
  marketRange: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  priceChip: { backgroundColor: Colors.primaryDim, borderRadius: Radius.pill, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: Colors.primary + '40' },
  priceLabel: { fontSize: Typography.size.xs, fontWeight: Typography.weight.bold, color: Colors.primary },
  comparables: { fontSize: 10, color: Colors.textTertiary },
  noMarketData: { fontSize: Typography.size.xs, color: Colors.textTertiary, fontStyle: 'italic' },
  warningRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, backgroundColor: Colors.warningDim, borderRadius: Radius.sm, padding: Spacing.xs },
  warningText: { flex: 1, fontSize: 10, color: Colors.warning },
  actions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.xs },
  removeBtn: { width: 32, height: 32, borderRadius: Radius.md, backgroundColor: Colors.dangerDim, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.danger + '30' },
  editBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.md, paddingVertical: Spacing.sm, borderWidth: 1, borderColor: Colors.surfaceBorder },
  editBtnText: { fontSize: Typography.size.xs, color: Colors.primary, fontWeight: Typography.weight.semibold },
  approveBtn: { flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: Colors.primary, borderRadius: Radius.md, paddingVertical: Spacing.sm },
  approveBtnText: { fontSize: Typography.size.xs, color: Colors.background, fontWeight: Typography.weight.bold },
  approvedPill: { flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: Colors.successDim, borderRadius: Radius.md, paddingVertical: Spacing.sm, borderWidth: 1, borderColor: Colors.success + '40' },
  approvedPillText: { fontSize: Typography.size.xs, color: Colors.success, fontWeight: Typography.weight.bold },
});

// ─────────────────────────────────────────────────────────────────────────────
// MAIN SCREEN
// ─────────────────────────────────────────────────────────────────────────────

export default function SilverBatchScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { tenant } = useApp();
  const { showAlert } = useAlert();

  const [step, setStep] = useState<Step>('home');
  const [activeBatches, setActiveBatches] = useState<SilverBatch[]>([]);
  const [loadingBatches, setLoadingBatches] = useState(true);

  // Batch setup state
  const [batchName, setBatchName] = useState('');
  const [batchRef, setBatchRef] = useState('');
  const [batchNotes, setBatchNotes] = useState('');
  const [expectedCount, setExpectedCount] = useState('');
  const [creatingBatch, setCreatingBatch] = useState(false);
  const [currentBatch, setCurrentBatch] = useState<SilverBatch | null>(null);

  // Captures — the heart of the session
  const [captures, setCaptures] = useState<CoinCapture[]>([]);
  const [currentCaptureIdx, setCurrentCaptureIdx] = useState(0);
  const [batchDate] = useState(todayDateString);

  // Current coin being captured
  const [obverseUri, setObverseUri] = useState<string | undefined>();
  const [reverseUri, setReverseUri] = useState<string | undefined>();
  const [countermarkUri, setCountermarkUri] = useState<string | undefined>();
  const [obverseWarnings, setObverseWarnings] = useState<string[]>([]);
  const [reverseWarnings, setReverseWarnings] = useState<string[]>([]);
  const [weight, setWeight] = useState('');
  const [diameter, setDiameter] = useState('');
  const [coinNotes, setCoinNotes] = useState('');
  const [savingCoin, setSavingCoin] = useState(false);

  // Processing
  const [processingIdx, setProcessingIdx] = useState(0);
  const [processingTotal, setProcessingTotal] = useState(0);
  const [processingStatus, setProcessingStatus] = useState('');
  const [processingErrors, setProcessingErrors] = useState<string[]>([]);

  // Results / review
  const [batchSummary, setBatchSummary] = useState<BatchSummary | null>(null);
  const [groups, setGroups] = useState<CaptureGroup[]>([]);
  const [reviewFilter, setReviewFilter] = useState<SaleStrategy | 'all'>('all');
  const [editingCapture, setEditingCapture] = useState<CoinCapture | null>(null);

  // Submitting
  const [submitIdx, setSubmitIdx] = useState(0);
  const [submitTotal, setSubmitTotal] = useState(0);
  const [submitErrors, setSubmitErrors] = useState<string[]>([]);
  const [submitDone, setSubmitDone] = useState(false);

  // ── Load active batches ─────────────────────────────────────────────────────

  useEffect(() => {
    if (!tenant) return;
    setLoadingBatches(true);
    getActiveBatches(tenant.id).then(({ batches }) => {
      setActiveBatches(batches);
      setLoadingBatches(false);
    });
  }, [tenant]);

  // ── Capture helpers ─────────────────────────────────────────────────────────

  const captureImage = useCallback(async (
    slot: 'obverse' | 'reverse' | 'countermark'
  ) => {
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
      allowsEditing: true,
      exif: false,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const uri = result.assets[0].uri;
    const quality = await validateImageQuality(uri);
    if (slot === 'obverse') { setObverseUri(uri); setObverseWarnings(quality.warnings); }
    else if (slot === 'reverse') { setReverseUri(uri); setReverseWarnings(quality.warnings); }
    else { setCountermarkUri(uri); }
  }, []);

  const pickImage = useCallback(async (
    slot: 'obverse' | 'reverse' | 'countermark'
  ) => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
      allowsEditing: true,
      exif: false,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const uri = result.assets[0].uri;
    const quality = await validateImageQuality(uri);
    if (slot === 'obverse') { setObverseUri(uri); setObverseWarnings(quality.warnings); }
    else if (slot === 'reverse') { setReverseUri(uri); setReverseWarnings(quality.warnings); }
    else { setCountermarkUri(uri); }
  }, []);

  // ── Save current coin and move to next ─────────────────────────────────────

  const handleSaveCoin = useCallback(async (andNext: boolean = true) => {
    if (!obverseUri) {
      showAlert('Obverse Required', 'Please capture the front (obverse) of the coin.');
      return;
    }
    if (!weight) {
      showAlert('Weight Required', 'Please enter the coin weight in grams.');
      return;
    }
    if (!diameter) {
      showAlert('Diameter Required', 'Please enter the coin diameter in mm.');
      return;
    }

    setSavingCoin(true);
    const seq = currentCaptureIdx + 1;
    const captureRef = generateCaptureRef(batchDate, seq);

    const newCapture: CoinCapture = {
      id: `capture_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      batchId: currentBatch?.id ?? 'local',
      tenantId: tenant?.id ?? '',
      captureRef,
      sequenceNumber: seq,
      status: 'ready',
      obverseUri,
      reverseUri,
      countermarkUri,
      permanentUrls: [],
      weightGrams: parseFloat(weight),
      diameterMm: parseFloat(diameter),
      notes: coinNotes || undefined,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    setCaptures(prev => [...prev, newCapture]);
    setSavingCoin(false);

    if (andNext) {
      // Clear for next coin
      setObverseUri(undefined);
      setReverseUri(undefined);
      setCountermarkUri(undefined);
      setObverseWarnings([]);
      setReverseWarnings([]);
      setWeight('');
      setDiameter('');
      setCoinNotes('');
      setCurrentCaptureIdx(seq);
    }
  }, [obverseUri, reverseUri, countermarkUri, weight, diameter, coinNotes, currentCaptureIdx, batchDate, currentBatch, tenant, showAlert]);

  // ── AI Analysis loop ────────────────────────────────────────────────────────

  const runAnalysis = useCallback(async () => {
    if (!tenant) return;
    setStep('processing');
    setProcessingIdx(0);
    setProcessingTotal(captures.length);
    setProcessingErrors([]);

    const updatedCaptures = [...captures];

    for (let i = 0; i < captures.length; i++) {
      const cap = captures[i];
      setProcessingIdx(i + 1);
      setProcessingStatus(`Analysing ${cap.captureRef} — AI identification...`);

      // Build CapturedImage array for identification
      const capturedImages: CapturedImage[] = [];
      if (cap.obverseUri) capturedImages.push({ uri: cap.obverseUri, slotId: 'obverse', slotLabel: 'Obverse' });
      if (cap.reverseUri) capturedImages.push({ uri: cap.reverseUri, slotId: 'reverse', slotLabel: 'Reverse' });
      if (cap.countermarkUri) capturedImages.push({ uri: cap.countermarkUri, slotId: 'countermark', slotLabel: 'Countermark' });

      const knownAttrs = {
        weight: cap.weightGrams,
        diameter: cap.diameterMm,
        material: 'Silver',
        customNotes: [
          'This is a silver coin from a bulk silver collection.',
          cap.notes ?? '',
          cap.countermarkUri ? 'There may be a countermark — analyse it carefully.' : '',
        ].filter(Boolean).join(' '),
      };

      let updated: CoinCapture = { ...cap, status: 'analysing' };

      // ── Step 1: Identification ──
      try {
        const { result: idResult, error: idErr } = await identifyItemWithAI(
          capturedImages,
          'curiosities_collectibles',
          'Bulk silver batch — Islamic/ancient silver coins, record all evidence, be conservative',
          knownAttrs,
          { tenantId: tenant.id }
        );

        if (idErr || !idResult) {
          setProcessingErrors(prev => [...prev, `${cap.captureRef}: ${idErr ?? 'AI failed'}`]);
          updated = { ...updated, status: 'error' };
          updatedCaptures[i] = updated;
          setCaptures([...updatedCaptures]);
          continue;
        }

        // Countermark analysis — extract from evidence
        let countermarkNote = '';
        if (cap.countermarkUri) {
          const cmEvidence = idResult.evidenceSupporting.find(e =>
            e.toLowerCase().includes('countermark') || e.toLowerCase().includes('overstrike') || e.toLowerCase().includes('punch')
          );
          countermarkNote = cmEvidence ?? 'Possible countermark detected — requires specialist verification';
        }

        updated = {
          ...updated,
          status: 'analysed',
          aiTitle: idResult.canonicalTitle,
          aiConfidence: idResult.confidence,
          aiConfidenceTier: idResult.confidenceTier,
          aiObjectType: idResult.objectType,
          aiIdentificationState: idResult.identificationState,
          aiAttributes: idResult.attributes,
          aiEvidenceSupporting: idResult.evidenceSupporting,
          aiMissingInformation: idResult.missingInformation,
          aiWarnings: idResult.warnings,
          aiCountermarkAnalysis: countermarkNote || undefined,
          numistaN: idResult.numistaN ?? undefined,
          numistaMatchScore: idResult.numistaMatchScore ?? 0,
          numistaMatchTier: idResult.numistaMatchTier ?? 'rejected',
          numistaTitle: idResult.numistaTitle ?? undefined,
        };

        // ── Step 2: Market valuation ──
        setProcessingStatus(`Analysing ${cap.captureRef} — searching eBay sold data...`);
        const numistaTypeId = idResult.numistaTypeId ?? undefined;

        const { result: mvResult } = await getMarketValue({
          tenantId: tenant.id,
          title: idResult.canonicalTitle,
          specialistId: 'curiosities_collectibles',
          attributes: {
            ...idResult.attributes,
            weight: cap.weightGrams,
            diameter: cap.diameterMm,
          },
          condition: idResult.condition,
          identificationConfidence: idResult.confidence,
          identificationTier: idResult.confidenceTier,
          numistaTypeId: numistaTypeId ?? null,
          numistaMatchScore: idResult.numistaMatchScore ?? 0,
          numistaMatchTier: idResult.numistaMatchTier ?? 'no_match',
          applyToItem: false,
        });

        if (mvResult) {
          const val = mvResult.valuation;
          updated = {
            ...updated,
            status: 'priced',
            valuationLow: val.valuationLow,
            valuationMid: val.valuationMid,
            valuationHigh: val.valuationHigh,
            valuationConfidence: val.valuationConfidence,
            valuationComparables: mvResult.soldMarket?.relevantSoldCount ?? 0,
            valuationMethod: val.valuationMethod,
            recommendedPrice: val.recommendedListingPrice,
            recommendedFormat: val.recommendedListingFormat,
            auctionStartPrice: val.auctionStartPrice,
          };
        } else {
          updated = { ...updated, status: 'priced' };
        }

        // ── Step 3: Commercial decision ──
        const decision = computeCommercialDecision(updated);
        updated = {
          ...updated,
          commercialScore: decision.score,
          saleStrategy: decision.strategy,
          recommendedPrice: decision.recommendedPrice || updated.recommendedPrice,
          auctionStartPrice: decision.auctionStartPrice || updated.auctionStartPrice,
          listingTitle: decision.listingTitle,
          groupId: decision.groupSuggestion,
        };

      } catch (e: any) {
        setProcessingErrors(prev => [...prev, `${cap.captureRef}: ${e?.message ?? 'Error'}`]);
        updated = { ...updated, status: 'error' };
      }

      updatedCaptures[i] = updated;
      setCaptures([...updatedCaptures]);

      // Brief pause to avoid hammering edge functions
      await new Promise(r => setTimeout(r, 500));
    }

    // Compute groups and summary
    const finalCaptures = updatedCaptures;
    const summary = computeBatchSummary(finalCaptures);
    const batchGroups = computeBatchGroups(finalCaptures);

    setBatchSummary(summary);
    setGroups(batchGroups);
    setCaptures(finalCaptures);
    setStep('results');
  }, [tenant, captures]);

  // ── Approve all ─────────────────────────────────────────────────────────────

  const handleApproveAll = useCallback(() => {
    setCaptures(prev => prev.map(c => ({ ...c, userApproved: true })));
  }, []);

  const handleApproveOne = useCallback((id: string) => {
    setCaptures(prev => prev.map(c => c.id === id ? { ...c, userApproved: true } : c));
  }, []);

  const handleRemoveCapture = useCallback((id: string) => {
    showAlert('Remove Coin', 'Remove this capture from the batch?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => {
        setCaptures(prev => prev.filter(c => c.id !== id));
      }},
    ]);
  }, [showAlert]);

  // ── eBay listing submission ─────────────────────────────────────────────────

  const handleCreateListings = useCallback(async () => {
    if (!tenant) return;
    const approved = captures.filter(c => c.userApproved);
    if (approved.length === 0) {
      showAlert('No Approved Coins', 'Approve at least one coin before creating listings.');
      return;
    }

    setStep('submitting');
    setSubmitIdx(0);
    setSubmitTotal(approved.length);
    setSubmitErrors([]);
    setSubmitDone(false);

    const supabase = getSupabaseClient();

    for (let i = 0; i < approved.length; i++) {
      const cap = approved[i];
      setSubmitIdx(i + 1);

      try {
        // 1. Upload images to Storage
        const toUpload: CapturedImage[] = [];
        if (cap.obverseUri && !cap.obverseUri.startsWith('https://'))
          toUpload.push({ uri: cap.obverseUri, slotId: 'obverse', slotLabel: 'Obverse' });
        if (cap.reverseUri && !cap.reverseUri.startsWith('https://'))
          toUpload.push({ uri: cap.reverseUri, slotId: 'reverse', slotLabel: 'Reverse' });
        if (cap.countermarkUri && !cap.countermarkUri.startsWith('https://'))
          toUpload.push({ uri: cap.countermarkUri, slotId: 'countermark', slotLabel: 'Countermark' });

        // Create a temp item ID for upload path
        const tempId = cap.itemId ?? `silver_${cap.id.slice(0, 16)}`;
        let permanentUrls: string[] = [];

        if (toUpload.length > 0) {
          const { urls } = await uploadItemImages(tempId, toUpload);
          permanentUrls = urls;
        }

        // 2. Save to SWISH inventory (items table)
        if (!cap.itemId) {
          const { data: itemRow, error: itemErr } = await supabase.from('items').insert({
            tenant_id: tenant.id,
            canonical_title: cap.userTitle ?? cap.listingTitle ?? cap.aiTitle ?? 'Unidentified Silver Coin',
            specialist_id: 'curiosities_collectibles',
            status: 'identified',
            identification_confidence: cap.aiConfidence ?? 0.3,
            identification_source: 'detected',
            condition: 'See photographs',
            valuation_low: cap.valuationLow ?? 0,
            valuation_mid: cap.valuationMid ?? 0,
            valuation_high: cap.valuationHigh ?? 0,
            valuation_confidence: cap.valuationConfidence ?? 'insufficient_data',
            expected_selling_price: cap.userPrice ?? cap.recommendedPrice ?? 0,
            expected_net: ((cap.userPrice ?? cap.recommendedPrice ?? 0) * 0.8725),
            expected_profit: ((cap.userPrice ?? cap.recommendedPrice ?? 0) * 0.8725),
            weight_grams: cap.weightGrams ?? null,
            diameter_mm: cap.diameterMm ?? null,
            material: 'Silver',
            media: permanentUrls,
            attributes: {
              ...(cap.aiAttributes ?? {}),
              metal: 'Silver',
              fineness: 'Unknown',
              capture_ref: cap.captureRef,
              batch_id: cap.batchId,
              ...(cap.countermarkUri ? { has_countermark: true, countermark_analysis: cap.aiCountermarkAnalysis } : {}),
            },
            warnings: cap.aiWarnings ?? [],
          }).select('id').single();

          if (!itemErr && itemRow) {
            cap.itemId = itemRow.id;
            // Update permanent URL association
            if (permanentUrls.length > 0) {
              await updateItemMedia(tenant.id, itemRow.id, permanentUrls);
            }
          }
        }

        // 3. Save draft listing
        if (cap.itemId) {
          const strategy = cap.userSaleStrategy ?? cap.saleStrategy ?? 'mixed_lot';
          const price = cap.userPrice ?? cap.recommendedPrice ?? 0;
          const listingTitle = (cap.userTitle ?? cap.listingTitle ?? cap.aiTitle ?? 'Silver Coin').slice(0, 80);

          await supabase.from('listings').insert({
            tenant_id: tenant.id,
            item_id: cap.itemId,
            marketplace_id: 'ebay',
            title: listingTitle,
            description: buildListingDescription(cap),
            price,
            floor_price: price * 0.7,
            ceiling_price: price * 1.3,
            shipping_cost: 0,
            status: 'draft',
            ...(cap.categoryId ? { category_id: cap.categoryId } : {}),
          });
        }

        // Update capture with item ID
        setCaptures(prev => prev.map(c =>
          c.id === cap.id ? { ...c, itemId: cap.itemId, status: 'listed' } : c
        ));

      } catch (e: any) {
        setSubmitErrors(prev => [...prev, `${cap.captureRef}: ${e?.message ?? 'Error'}`]);
      }

      await new Promise(r => setTimeout(r, 300));
    }

    // Complete the batch
    if (currentBatch) {
      const summary = computeBatchSummary(captures);
      await completeBatch(tenant.id, currentBatch.id, {
        totalCoins: summary.totalCaptures,
        individualCount: summary.individualBIN,
        auctionCount: summary.individualAuction,
        groupedCount: summary.grouped,
        mixedLotCount: summary.mixedLot,
        estimatedLow: summary.estimatedGrossLow,
        estimatedHigh: summary.estimatedGrossHigh,
      });
    }

    setSubmitDone(true);
  }, [tenant, captures, currentBatch, showAlert]);

  // ── Review helpers ──────────────────────────────────────────────────────────

  const filteredCaptures = useMemo(() => {
    if (reviewFilter === 'all') return captures;
    return captures.filter(c => (c.userSaleStrategy ?? c.saleStrategy) === reviewFilter);
  }, [captures, reviewFilter]);

  // ── Batch setup ─────────────────────────────────────────────────────────────

  const handleCreateBatch = useCallback(async () => {
    if (!tenant) return;
    if (!batchName.trim()) { showAlert('Batch Name Required', 'Enter a name for this batch.'); return; }
    if (!expectedCount || parseInt(expectedCount) < 1) { showAlert('Count Required', 'Enter the expected number of coins.'); return; }

    setCreatingBatch(true);
    const { batch, error } = await createBatch(tenant.id, {
      name: batchName.trim(),
      reference: batchRef.trim() || undefined,
      notes: batchNotes.trim() || undefined,
      expectedCount: parseInt(expectedCount),
    });
    setCreatingBatch(false);

    if (error || !batch) {
      showAlert('Failed', error ?? 'Could not create batch.');
      return;
    }

    setCurrentBatch(batch);
    setCaptures([]);
    setCurrentCaptureIdx(0);
    setStep('capture');
  }, [tenant, batchName, batchRef, batchNotes, expectedCount, showAlert]);

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <View style={s.container}>
      <StatusBar style="light" />

      {/* ── HEADER ── */}
      <View style={[s.header, { paddingTop: insets.top + Spacing.sm }]}>
        <Pressable onPress={() => {
          if (step === 'home') router.back();
          else if (step === 'capture' && captures.length > 0) {
            showAlert('Leave Capture?', 'Captured coins will be saved. Continue?', [
              { text: 'Stay', style: 'cancel' },
              { text: 'Leave', onPress: () => setStep('home') },
            ]);
          }
          else if (step === 'batch_setup') setStep('home');
          else if (step === 'capture') setStep('home');
          else if (step === 'results' || step === 'review') setStep('results');
        }} style={s.backBtn} hitSlop={8}>
          <MaterialIcons name="arrow-back" size={20} color={Colors.textSecondary} />
        </Pressable>
        <View style={s.headerCenter}>
          <MaterialIcons name="toll" size={15} color={Colors.gold} />
          <Text style={s.headerTitle}>
            {step === 'home' ? 'BULK SILVER CAPTURE' :
             step === 'batch_setup' ? 'NEW BATCH' :
             step === 'capture' ? `CAPTURING · #${currentCaptureIdx + 1}` :
             step === 'processing' ? 'ANALYSING BATCH' :
             step === 'results' ? 'BATCH RESULTS' :
             step === 'review' ? 'REVIEW & APPROVE' :
             step === 'submitting' ? 'CREATING LISTINGS' : 'SILVER BATCH'}
          </Text>
        </View>
        {step === 'capture' && captures.length > 0 ? (
          <Pressable onPress={() => setStep('review')} style={s.headerAction} hitSlop={4}>
            <Text style={s.headerActionText}>{captures.length} saved</Text>
            <MaterialIcons name="chevron-right" size={14} color={Colors.primary} />
          </Pressable>
        ) : <View style={{ width: 80 }} />}
      </View>

      {/* ══════════════════════════════════════════════════════════════════════
          STEP: HOME
          ══════════════════════════════════════════════════════════════════════ */}
      {step === 'home' ? (
        <ScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 80 }]}>
          {/* Hero */}
          <View style={home.hero}>
            <View style={home.heroIcon}>
              <MaterialIcons name="toll" size={36} color={Colors.gold} />
            </View>
            <Text style={home.heroTitle}>Bulk Silver Capture Station</Text>
            <Text style={home.heroSub}>
              Rapidly photograph, measure, and analyse batches of silver coins. Evidence-based AI identification + eBay sold-market pricing + automatic listing strategy.
            </Text>
          </View>

          {/* Key features */}
          {[
            { icon: 'photo-camera', label: 'Rapid capture', desc: 'Obverse · Reverse · Countermark' },
            { icon: 'straighten', label: 'Physical measurements', desc: 'Weight (g) · Diameter (mm) — hard evidence' },
            { icon: 'auto-awesome', label: 'AI identification', desc: 'Evidence-based, conservative — never invented' },
            { icon: 'bar-chart', label: 'eBay sold data', desc: 'Verified comparables — not asking prices' },
            { icon: 'sell', label: 'Commercial strategy', desc: 'BIN · Auction · Group lots · Study lots' },
          ].map(f => (
            <View key={f.icon} style={home.featureRow}>
              <View style={home.featureIcon}>
                <MaterialIcons name={f.icon as any} size={16} color={Colors.gold} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={home.featureLabel}>{f.label}</Text>
                <Text style={home.featureDesc}>{f.desc}</Text>
              </View>
            </View>
          ))}

          {/* Active batches */}
          {loadingBatches ? (
            <ActivityIndicator size="small" color={Colors.primary} style={{ marginTop: Spacing.lg }} />
          ) : activeBatches.length > 0 ? (
            <View style={home.resumeSection}>
              <Text style={home.resumeLabel}>RESUME BATCH</Text>
              {activeBatches.map(batch => (
                <Pressable
                  key={batch.id}
                  onPress={() => { setCurrentBatch(batch); setStep('capture'); }}
                  style={({ pressed }) => [home.resumeCard, pressed && { opacity: 0.8 }]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={home.resumeCardName}>{batch.name}</Text>
                    <Text style={home.resumeCardMeta}>
                      {batch.captureCount} coins · {new Date(batch.createdAt).toLocaleDateString('en-GB')}
                    </Text>
                  </View>
                  <MaterialIcons name="chevron-right" size={18} color={Colors.primary} />
                </Pressable>
              ))}
            </View>
          ) : null}

          <Pressable onPress={() => setStep('batch_setup')} style={home.newBatchBtn}>
            <MaterialIcons name="add-circle" size={20} color={Colors.background} />
            <Text style={home.newBatchBtnText}>Start New Silver Batch</Text>
          </Pressable>

          <View style={home.disclaimer}>
            <MaterialIcons name="info-outline" size={13} color={Colors.textTertiary} />
            <Text style={home.disclaimerText}>
              This station is optimised for Islamic, ancient, and medieval silver coins. All identifications are evidence-based — the system will never invent attributions. Conservative by design.
            </Text>
          </View>
        </ScrollView>
      ) : null}

      {/* ══════════════════════════════════════════════════════════════════════
          STEP: BATCH SETUP
          ══════════════════════════════════════════════════════════════════════ */}
      {step === 'batch_setup' ? (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <ScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 100 }]}>
            <View style={bs.card}>
              <Text style={bs.cardTitle}>BATCH INFORMATION</Text>
              <View style={bs.fieldGroup}>
                <Text style={bs.fieldLabel}>Batch Name *</Text>
                <TextInput
                  style={bs.input}
                  value={batchName}
                  onChangeText={setBatchName}
                  placeholder="e.g. Islamic Silver Batch — Oct 2026"
                  placeholderTextColor={Colors.textTertiary}
                  returnKeyType="next"
                />
              </View>
              <View style={bs.fieldGroup}>
                <Text style={bs.fieldLabel}>Source / Reference</Text>
                <TextInput
                  style={bs.input}
                  value={batchRef}
                  onChangeText={setBatchRef}
                  placeholder="e.g. Lot 142 — Estate Sale"
                  placeholderTextColor={Colors.textTertiary}
                />
              </View>
              <View style={bs.fieldGroup}>
                <Text style={bs.fieldLabel}>Expected Coin Count *</Text>
                <TextInput
                  style={bs.input}
                  value={expectedCount}
                  onChangeText={setExpectedCount}
                  placeholder="e.g. 120"
                  keyboardType="number-pad"
                  placeholderTextColor={Colors.textTertiary}
                />
              </View>
              <View style={bs.fieldGroup}>
                <Text style={bs.fieldLabel}>Notes</Text>
                <TextInput
                  style={[bs.input, { minHeight: 70, textAlignVertical: 'top' }]}
                  value={batchNotes}
                  onChangeText={setBatchNotes}
                  placeholder="Any notes about this batch..."
                  placeholderTextColor={Colors.textTertiary}
                  multiline
                  numberOfLines={3}
                />
              </View>
            </View>

            <View style={bs.metalCard}>
              <MaterialIcons name="info-outline" size={14} color={Colors.gold} />
              <View style={{ flex: 1 }}>
                <Text style={bs.metalTitle}>Metal: Silver — Fineness Unknown</Text>
                <Text style={bs.metalNote}>
                  The system assumes silver based on your declaration. Fineness will be recorded as "Unknown" unless independently established. Do not assume sterling, 90%, or any specific purity.
                </Text>
              </View>
            </View>
          </ScrollView>
          <View style={[s.actionBar, { paddingBottom: insets.bottom + Spacing.sm }]}>
            <Pressable
              onPress={handleCreateBatch}
              disabled={creatingBatch}
              style={[s.primaryBtn, creatingBatch && { opacity: 0.7 }]}
            >
              {creatingBatch
                ? <ActivityIndicator size="small" color={Colors.background} />
                : <MaterialIcons name="play-arrow" size={18} color={Colors.background} />}
              <Text style={s.primaryBtnText}>{creatingBatch ? 'Creating...' : 'Start Batch'}</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      ) : null}

      {/* ══════════════════════════════════════════════════════════════════════
          STEP: CAPTURE
          ══════════════════════════════════════════════════════════════════════ */}
      {step === 'capture' ? (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <ScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 130 }]} showsVerticalScrollIndicator={false}>
            {/* Progress indicator */}
            <View style={cap.progressBar}>
              <MaterialIcons name="toll" size={13} color={Colors.gold} />
              <Text style={cap.progressText}>
                Coin #{currentCaptureIdx + 1}
                {currentBatch?.expectedCount ? ` of ${currentBatch.expectedCount} expected` : ''}
              </Text>
              <Text style={cap.savedCount}>{captures.length} saved</Text>
            </View>

            {/* Images */}
            <Text style={cap.sectionLabel}>PHOTOGRAPHS</Text>
            <View style={cap.imagesGrid}>
              <ImageSlot
                label="OBVERSE (Front)" uri={obverseUri} required large
                warnings={obverseWarnings}
                onCapture={() => captureImage('obverse')}
                onLibrary={() => pickImage('obverse')}
              />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs, flex: 1 }}>
                <ImageSlot
                  label="REVERSE" uri={reverseUri} required
                  warnings={reverseWarnings}
                  onCapture={() => captureImage('reverse')}
                  onLibrary={() => pickImage('reverse')}
                />
                <ImageSlot
                  label="COUNTERMARK" uri={countermarkUri}
                  onCapture={() => captureImage('countermark')}
                  onLibrary={() => pickImage('countermark')}
                />
                <View style={{ width: '31%' }} />
              </View>
            </View>

            {/* Measurements */}
            <Text style={cap.sectionLabel}>MEASUREMENTS — REQUIRED</Text>
            <View style={cap.measureCard}>
              <View style={cap.measureField}>
                <Text style={cap.measureLabel}>Weight (g) *</Text>
                <View style={cap.measureInputWrap}>
                  <TextInput
                    style={cap.measureInput}
                    value={weight}
                    onChangeText={setWeight}
                    keyboardType="decimal-pad"
                    placeholder="e.g. 2.73"
                    placeholderTextColor={Colors.textTertiary}
                    returnKeyType="next"
                  />
                  <Text style={cap.measureUnit}>g</Text>
                </View>
              </View>
              <View style={cap.measureField}>
                <Text style={cap.measureLabel}>Diameter (mm) *</Text>
                <View style={cap.measureInputWrap}>
                  <TextInput
                    style={cap.measureInput}
                    value={diameter}
                    onChangeText={setDiameter}
                    keyboardType="decimal-pad"
                    placeholder="e.g. 24.1"
                    placeholderTextColor={Colors.textTertiary}
                    returnKeyType="done"
                  />
                  <Text style={cap.measureUnit}>mm</Text>
                </View>
              </View>
            </View>

            <View style={cap.measureNote}>
              <MaterialIcons name="info-outline" size={12} color={Colors.primary} />
              <Text style={cap.measureNoteText}>
                Weight and diameter are hard evidence — they directly influence identification confidence and valuation. Enter actual measurements, not estimates.
              </Text>
            </View>

            {/* Notes */}
            <TextInput
              style={cap.notesInput}
              value={coinNotes}
              onChangeText={setCoinNotes}
              placeholder="Coin notes (optional) — visible features, countermark description..."
              placeholderTextColor={Colors.textTertiary}
              multiline
              numberOfLines={2}
            />
          </ScrollView>

          {/* Action bar */}
          <View style={[s.actionBar, { paddingBottom: insets.bottom + Spacing.sm }]}>
            {captures.length > 0 ? (
              <Pressable onPress={() => {
                showAlert('Process Batch', `Analyse ${captures.length} captured coin${captures.length === 1 ? '' : 's'} with AI?`, [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Process Now', onPress: runAnalysis },
                ]);
              }} style={[s.secondaryBtn, { flex: 1 }]}>
                <MaterialIcons name="auto-awesome" size={16} color={Colors.accent} />
                <Text style={s.secondaryBtnText}>Process {captures.length} coin{captures.length === 1 ? '' : 's'}</Text>
              </Pressable>
            ) : null}
            <Pressable
              onPress={() => handleSaveCoin(true)}
              disabled={savingCoin}
              style={[s.primaryBtn, { flex: captures.length > 0 ? 2 : 4 }, savingCoin && { opacity: 0.7 }]}
            >
              {savingCoin
                ? <ActivityIndicator size="small" color={Colors.background} />
                : <MaterialIcons name="navigate-next" size={20} color={Colors.background} />}
              <Text style={s.primaryBtnText}>{savingCoin ? 'Saving...' : 'Save & Next Coin'}</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      ) : null}

      {/* ══════════════════════════════════════════════════════════════════════
          STEP: PROCESSING
          ══════════════════════════════════════════════════════════════════════ */}
      {step === 'processing' ? (
        <View style={proc.container}>
          <View style={proc.progressOuter}>
            <View style={proc.iconRing}>
              <ActivityIndicator size="large" color={Colors.gold} />
            </View>
          </View>
          <Text style={proc.title}>Analysing Batch</Text>
          <Text style={proc.coinLabel}>
            Coin {processingIdx} of {processingTotal}
          </Text>
          <Text style={proc.status}>{processingStatus}</Text>

          {/* Progress bar */}
          <View style={proc.barOuter}>
            <View style={[proc.barInner, { width: `${processingTotal > 0 ? (processingIdx / processingTotal) * 100 : 0}%` as any }]} />
          </View>

          <View style={proc.steps}>
            {[
              { label: 'AI Vision Analysis', icon: 'auto-awesome' },
              { label: 'Numista Catalogue Check', icon: 'verified' },
              { label: 'eBay Sold Market Data', icon: 'shopping-bag' },
              { label: 'Commercial Decision', icon: 'sell' },
            ].map((s2, i) => {
              const done = processingIdx > Math.ceil(processingTotal * (i / 4));
              return (
                <View key={s2.label} style={[proc.stepRow, done && proc.stepRowDone]}>
                  <MaterialIcons
                    name={s2.icon as any}
                    size={14}
                    color={done ? Colors.success : Colors.textTertiary}
                  />
                  <Text style={[proc.stepLabel, done && { color: Colors.success }]}>{s2.label}</Text>
                  {done ? <MaterialIcons name="check" size={13} color={Colors.success} /> : null}
                </View>
              );
            })}
          </View>

          <View style={proc.aiBadge}>
            <MaterialIcons name="auto-awesome" size={11} color={Colors.accent} />
            <Text style={proc.aiBadgeText}>OnSpace AI · Evidence-based identification · Conservative by design</Text>
          </View>

          {processingErrors.length > 0 ? (
            <View style={proc.errorBanner}>
              <MaterialIcons name="warning" size={13} color={Colors.warning} />
              <Text style={proc.errorText}>{processingErrors.length} error{processingErrors.length === 1 ? '' : 's'} — coins will be flagged for review</Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {/* ══════════════════════════════════════════════════════════════════════
          STEP: RESULTS
          ══════════════════════════════════════════════════════════════════════ */}
      {step === 'results' && batchSummary ? (
        <ScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 100 }]}>
          {/* Summary header */}
          <View style={res.header}>
            <View style={res.headerIcon}>
              <MaterialIcons name="check-circle" size={28} color={Colors.success} />
            </View>
            <Text style={res.headerTitle}>Batch Analysis Complete</Text>
            <Text style={res.headerSub}>{currentBatch?.name}</Text>
          </View>

          {/* Total */}
          <View style={res.totalCard}>
            <Text style={res.totalCount}>{batchSummary.totalCaptures}</Text>
            <Text style={res.totalLabel}>Coins Processed</Text>
          </View>

          {/* Strategy breakdown */}
          <View style={res.strategyGrid}>
            {[
              { label: 'Buy It Now', count: batchSummary.individualBIN, icon: 'sell', color: Colors.primary, strategy: 'bin' as SaleStrategy },
              { label: 'Auction', count: batchSummary.individualAuction, icon: 'gavel', color: Colors.gold, strategy: 'auction' as SaleStrategy },
              { label: 'Group Lots', count: batchSummary.grouped, icon: 'layers', color: Colors.info, strategy: 'group' as SaleStrategy },
              { label: 'Study Lots', count: batchSummary.mixedLot, icon: 'inventory-2', color: Colors.textSecondary, strategy: 'mixed_lot' as SaleStrategy },
            ].map(item => (
              <Pressable
                key={item.strategy}
                onPress={() => { setReviewFilter(item.strategy); setStep('review'); }}
                style={[res.strategyCard, { borderColor: item.color + '40' }]}
              >
                <MaterialIcons name={item.icon as any} size={22} color={item.color} />
                <Text style={[res.strategyCount, { color: item.color }]}>{item.count}</Text>
                <Text style={res.strategyLabel}>{item.label}</Text>
              </Pressable>
            ))}
          </View>

          {/* Value estimate */}
          {(batchSummary.estimatedGrossHigh > 0) ? (
            <View style={res.valueCard}>
              <Text style={res.valueLabel}>ESTIMATED GROSS VALUE</Text>
              <Text style={res.valueRange}>
                £{batchSummary.estimatedGrossLow.toFixed(0)} – £{batchSummary.estimatedGrossHigh.toFixed(0)}
              </Text>
              <Text style={res.valueNote}>
                Evidence-based range — not a guarantee. Based on {batchSummary.totalCaptures} coins with available sold-market data.
              </Text>
            </View>
          ) : null}

          {/* Confidence breakdown */}
          <View style={res.confCard}>
            <Text style={res.confLabel}>IDENTIFICATION CONFIDENCE</Text>
            <View style={res.confRow}>
              <View style={[res.confChip, { backgroundColor: Colors.success + '20' }]}>
                <Text style={[res.confNum, { color: Colors.success }]}>{batchSummary.highConfidenceCount}</Text>
                <Text style={res.confChipLabel}>High ≥80%</Text>
              </View>
              <View style={[res.confChip, { backgroundColor: Colors.warning + '20' }]}>
                <Text style={[res.confNum, { color: Colors.warning }]}>{batchSummary.mediumConfidenceCount}</Text>
                <Text style={res.confChipLabel}>Medium</Text>
              </View>
              <View style={[res.confChip, { backgroundColor: Colors.danger + '20' }]}>
                <Text style={[res.confNum, { color: Colors.danger }]}>{batchSummary.lowConfidenceCount}</Text>
                <Text style={res.confChipLabel}>Low</Text>
              </View>
            </View>
            <View style={res.confMetaRow}>
              {batchSummary.withNumista > 0 ? (
                <View style={res.metaChip}>
                  <MaterialIcons name="verified" size={10} color={Colors.success} />
                  <Text style={res.metaChipText}>{batchSummary.withNumista} Numista verified</Text>
                </View>
              ) : null}
              <View style={res.metaChip}>
                <MaterialIcons name="straighten" size={10} color={Colors.primary} />
                <Text style={res.metaChipText}>{batchSummary.withMeasurements} with measurements</Text>
              </View>
            </View>
          </View>

          {processingErrors.length > 0 ? (
            <View style={res.errorCard}>
              <MaterialIcons name="warning" size={14} color={Colors.warning} />
              <View style={{ flex: 1 }}>
                <Text style={res.errorTitle}>{processingErrors.length} Analysis Errors</Text>
                {processingErrors.slice(0, 3).map((e, i) => (
                  <Text key={i} style={res.errorItem}>{e}</Text>
                ))}
              </View>
            </View>
          ) : null}

          {/* Anti-optimism note */}
          <View style={res.disclaimer}>
            <MaterialIcons name="info-outline" size={12} color={Colors.textTertiary} />
            <Text style={res.disclaimerText}>
              Valuations are based on verified eBay sold comparables only. Where market data is insufficient, no price has been invented. Review each coin before approving.
            </Text>
          </View>
        </ScrollView>
      ) : null}

      {/* Results action bar */}
      {step === 'results' ? (
        <View style={[s.actionBar, { paddingBottom: insets.bottom + Spacing.sm }]}>
          <Pressable onPress={() => { setReviewFilter('all'); setStep('review'); }} style={[s.primaryBtn, { flex: 3 }]}>
            <MaterialIcons name="checklist" size={16} color={Colors.background} />
            <Text style={s.primaryBtnText}>Review & Approve ({captures.length})</Text>
          </Pressable>
        </View>
      ) : null}

      {/* ══════════════════════════════════════════════════════════════════════
          STEP: REVIEW
          ══════════════════════════════════════════════════════════════════════ */}
      {step === 'review' ? (
        <>
          {/* Filter bar */}
          <View style={rev.filterBar}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={rev.filterContent}>
              {(['all', 'bin', 'auction', 'group', 'mixed_lot'] as const).map(f => {
                const counts: Record<string, number> = {
                  all: captures.length,
                  bin: captures.filter(c => (c.userSaleStrategy ?? c.saleStrategy) === 'bin').length,
                  auction: captures.filter(c => (c.userSaleStrategy ?? c.saleStrategy) === 'auction').length,
                  group: captures.filter(c => (c.userSaleStrategy ?? c.saleStrategy) === 'group').length,
                  mixed_lot: captures.filter(c => (c.userSaleStrategy ?? c.saleStrategy) === 'mixed_lot').length,
                };
                const labels: Record<string, string> = { all: 'All', bin: 'BIN', auction: 'Auction', group: 'Groups', mixed_lot: 'Study' };
                return (
                  <Pressable
                    key={f}
                    onPress={() => setReviewFilter(f)}
                    style={[rev.filterChip, reviewFilter === f && rev.filterChipActive]}
                  >
                    <Text style={[rev.filterChipText, reviewFilter === f && { color: Colors.primary }]}>
                      {labels[f]} ({counts[f] ?? 0})
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>

          <FlatList
            data={filteredCaptures}
            keyExtractor={item => item.id}
            renderItem={({ item, index }) => (
              <View style={{ paddingHorizontal: Spacing.base, marginBottom: Spacing.md }}>
                <CoinReviewCard
                  capture={item}
                  index={index}
                  onApprove={handleApproveOne}
                  onEdit={setEditingCapture}
                  onRemove={handleRemoveCapture}
                />
              </View>
            )}
            ListHeaderComponent={
              <View style={{ padding: Spacing.base, gap: Spacing.sm }}>
                <Text style={rev.reviewTitle}>
                  {filteredCaptures.length} coin{filteredCaptures.length === 1 ? '' : 's'} · {captures.filter(c => c.userApproved).length} approved
                </Text>
              </View>
            }
            ListFooterComponent={<View style={{ height: 100 }} />}
          />

          <View style={[s.actionBar, { paddingBottom: insets.bottom + Spacing.sm }]}>
            <Pressable onPress={handleApproveAll} style={[s.secondaryBtn, { flex: 1 }]}>
              <MaterialIcons name="done-all" size={16} color={Colors.primary} />
              <Text style={s.secondaryBtnText}>Approve All</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                const approvedCount = captures.filter(c => c.userApproved).length;
                if (approvedCount === 0) { showAlert('None Approved', 'Approve at least one coin first.'); return; }
                showAlert(
                  `Create ${approvedCount} Listings?`,
                  `Save ${approvedCount} approved coin${approvedCount === 1 ? '' : 's'} to SWISH inventory and create draft eBay listings. You can still edit before submitting.`,
                  [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Create Listings', onPress: handleCreateListings },
                  ]
                );
              }}
              style={[s.primaryBtn, { flex: 2 }]}
            >
              <MaterialIcons name="publish" size={16} color={Colors.background} />
              <Text style={s.primaryBtnText}>
                Create Listings ({captures.filter(c => c.userApproved).length})
              </Text>
            </Pressable>
          </View>
        </>
      ) : null}

      {/* ══════════════════════════════════════════════════════════════════════
          STEP: SUBMITTING
          ══════════════════════════════════════════════════════════════════════ */}
      {step === 'submitting' ? (
        <View style={sub.container}>
          {!submitDone ? (
            <>
              <ActivityIndicator size="large" color={Colors.primary} />
              <Text style={sub.title}>Creating Draft Listings</Text>
              <Text style={sub.progress}>{submitIdx} of {submitTotal}</Text>
              <View style={sub.barOuter}>
                <View style={[sub.barInner, { width: `${submitTotal > 0 ? (submitIdx / submitTotal) * 100 : 0}%` as any }]} />
              </View>
              <Text style={sub.note}>Uploading images · Saving to inventory · Creating eBay drafts</Text>
            </>
          ) : (
            <>
              <MaterialIcons name="check-circle" size={52} color={Colors.success} />
              <Text style={sub.doneTitle}>Listings Created!</Text>
              <Text style={sub.doneCount}>
                {submitTotal - submitErrors.length} draft listings saved to SWISH inventory.
              </Text>
              {submitErrors.length > 0 ? (
                <Text style={sub.errorCount}>{submitErrors.length} error{submitErrors.length === 1 ? '' : 's'} — check inventory.</Text>
              ) : null}
              <Text style={sub.doneNote}>
                Review and edit listings in the SWISH Listings tab before submitting to eBay.
              </Text>
              <View style={sub.doneActions}>
                <Pressable onPress={() => router.push('/(tabs)/listings' as any)} style={sub.primaryBtn}>
                  <MaterialIcons name="receipt-long" size={16} color={Colors.background} />
                  <Text style={sub.primaryBtnText}>View Listings</Text>
                </Pressable>
                <Pressable onPress={() => router.push('/(tabs)/inventory' as any)} style={sub.secondaryBtn}>
                  <MaterialIcons name="toll" size={16} color={Colors.primary} />
                  <Text style={sub.secondaryBtnText}>View Inventory</Text>
                </Pressable>
              </View>
            </>
          )}
        </View>
      ) : null}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// LISTING DESCRIPTION BUILDER
// ─────────────────────────────────────────────────────────────────────────────

function buildListingDescription(cap: CoinCapture): string {
  const conf = cap.aiConfidence ?? 0;
  const confLabel = conf >= 0.80 ? 'High confidence identification' : conf >= 0.55 ? 'Probable identification' : conf >= 0.35 ? 'Possible identification — requires verification' : 'Uncertain — sold for research/study';

  const lines: string[] = [
    `**${cap.userTitle ?? cap.listingTitle ?? cap.aiTitle ?? 'Silver Coin'}**`,
    '',
    `**Identification:** ${confLabel} (${Math.round(conf * 100)}% confidence)`,
  ];

  if (cap.weightGrams) lines.push(`**Weight:** ${cap.weightGrams}g (user-measured)`);
  if (cap.diameterMm) lines.push(`**Diameter:** ${cap.diameterMm}mm (user-measured)`);
  lines.push('**Metal:** Silver (fineness not established)');

  if (cap.numistaN && (cap.numistaMatchScore ?? 0) >= 70) {
    lines.push(`**Numista Reference:** ${cap.numistaN} — ${cap.numistaTitle ?? ''}`);
  }

  if (cap.aiEvidenceSupporting && cap.aiEvidenceSupporting.length > 0) {
    lines.push('', '**Supporting Evidence:**');
    cap.aiEvidenceSupporting.slice(0, 4).forEach(e => lines.push(`• ${e}`));
  }

  if (cap.aiMissingInformation && cap.aiMissingInformation.length > 0) {
    lines.push('', '**Unresolved:**');
    cap.aiMissingInformation.slice(0, 3).forEach(m => lines.push(`• ${m}`));
  }

  if (cap.countermarkUri && cap.aiCountermarkAnalysis) {
    lines.push('', `**Countermark:** ${cap.aiCountermarkAnalysis}`);
  }

  if (cap.aiWarnings && cap.aiWarnings.length > 0) {
    lines.push('', '**Condition Notes:**');
    cap.aiWarnings.slice(0, 3).forEach(w => lines.push(`• ${w}`));
  }

  lines.push(
    '',
    'Sold as seen. Please review all photographs carefully before purchasing.',
    conf < 0.55 ? 'This coin has not been definitively identified and is sold for study/research purposes.' : '',
  );

  return lines.filter(Boolean).join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.base, paddingBottom: Spacing.sm, borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder },
  backBtn: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.surfaceBorder },
  headerCenter: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xs },
  headerTitle: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.textPrimary, letterSpacing: 0.8 },
  headerAction: { flexDirection: 'row', alignItems: 'center', gap: 3, minWidth: 80, justifyContent: 'flex-end' },
  headerActionText: { fontSize: Typography.size.xs, color: Colors.primary, fontWeight: Typography.weight.semibold },
  content: { padding: Spacing.base, gap: Spacing.lg },
  actionBar: { flexDirection: 'row', gap: Spacing.sm, padding: Spacing.base, backgroundColor: Colors.surface, borderTopWidth: 1, borderTopColor: Colors.surfaceBorder },
  primaryBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, backgroundColor: Colors.primary, borderRadius: Radius.md, paddingVertical: Spacing.md, ...Shadow.glow },
  primaryBtnText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.background },
  secondaryBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, backgroundColor: Colors.primaryDim, borderRadius: Radius.md, paddingVertical: Spacing.md, borderWidth: 1, borderColor: Colors.primary + '40' },
  secondaryBtnText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.primary },
});

const home = StyleSheet.create({
  hero: { alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.xl, backgroundColor: Colors.surface, borderRadius: Radius.xl, borderWidth: 1, borderColor: Colors.gold + '30', padding: Spacing.xl },
  heroIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: Colors.goldDim, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: Colors.gold + '40' },
  heroTitle: { fontSize: Typography.size.xl, fontWeight: Typography.weight.bold, color: Colors.textPrimary, textAlign: 'center' },
  heroSub: { fontSize: Typography.size.sm, color: Colors.textSecondary, textAlign: 'center', lineHeight: 20 },
  featureRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md, backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.surfaceBorder },
  featureIcon: { width: 32, height: 32, borderRadius: Radius.sm, backgroundColor: Colors.goldDim, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  featureLabel: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.textPrimary },
  featureDesc: { fontSize: Typography.size.xs, color: Colors.textTertiary, marginTop: 2 },
  resumeSection: { gap: Spacing.sm },
  resumeLabel: { fontSize: 9, fontWeight: Typography.weight.bold, color: Colors.textTertiary, letterSpacing: 0.5, textTransform: 'uppercase' },
  resumeCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.primary + '30' },
  resumeCardName: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.primary },
  resumeCardMeta: { fontSize: Typography.size.xs, color: Colors.textTertiary, marginTop: 2 },
  newBatchBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, backgroundColor: Colors.gold, borderRadius: Radius.xl, paddingVertical: Spacing.lg, ...Shadow.sm },
  newBatchBtnText: { fontSize: Typography.size.base, fontWeight: Typography.weight.bold, color: Colors.background },
  disclaimer: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.md, padding: Spacing.sm },
  disclaimerText: { flex: 1, fontSize: 10, color: Colors.textTertiary, lineHeight: 15 },
});

const bs = StyleSheet.create({
  card: { backgroundColor: Colors.surface, borderRadius: Radius.xl, padding: Spacing.md, gap: Spacing.md, borderWidth: 1, borderColor: Colors.surfaceBorder },
  cardTitle: { fontSize: 10, fontWeight: Typography.weight.bold, color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5 },
  fieldGroup: { gap: Spacing.xs },
  fieldLabel: { fontSize: Typography.size.xs, fontWeight: Typography.weight.semibold, color: Colors.textSecondary },
  input: { backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.surfaceBorder, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, fontSize: Typography.size.sm, color: Colors.textPrimary, includeFontPadding: false },
  metalCard: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, backgroundColor: Colors.goldDim, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.gold + '30' },
  metalTitle: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.gold, marginBottom: 4 },
  metalNote: { fontSize: Typography.size.xs, color: Colors.gold + 'BB', lineHeight: 16 },
});

const cap = StyleSheet.create({
  progressBar: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.goldDim, borderRadius: Radius.md, padding: Spacing.sm, borderWidth: 1, borderColor: Colors.gold + '30' },
  progressText: { flex: 1, fontSize: Typography.size.xs, color: Colors.gold, fontWeight: Typography.weight.semibold },
  savedCount: { fontSize: Typography.size.xs, color: Colors.gold + 'AA', fontWeight: Typography.weight.medium },
  sectionLabel: { fontSize: 9, fontWeight: Typography.weight.bold, color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5 },
  imagesGrid: { gap: Spacing.sm },
  measureCard: { flexDirection: 'row', gap: Spacing.md, backgroundColor: Colors.surface, borderRadius: Radius.xl, padding: Spacing.base, borderWidth: 1, borderColor: Colors.primary + '30' },
  measureField: { flex: 1, gap: Spacing.xs },
  measureLabel: { fontSize: Typography.size.xs, fontWeight: Typography.weight.semibold, color: Colors.textSecondary },
  measureInputWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.surfaceBorder, paddingHorizontal: Spacing.sm },
  measureInput: { flex: 1, fontSize: Typography.size.xl, fontWeight: Typography.weight.bold, color: Colors.textPrimary, paddingVertical: Spacing.md, includeFontPadding: false },
  measureUnit: { fontSize: Typography.size.xs, color: Colors.textTertiary, fontWeight: Typography.weight.semibold },
  measureNote: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, backgroundColor: Colors.primaryDim, borderRadius: Radius.md, padding: Spacing.sm, borderWidth: 1, borderColor: Colors.primary + '30' },
  measureNoteText: { flex: 1, fontSize: 10, color: Colors.primary, lineHeight: 15 },
  notesInput: { backgroundColor: Colors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceBorder, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, fontSize: Typography.size.sm, color: Colors.textPrimary, minHeight: 60, textAlignVertical: 'top', includeFontPadding: false },
});

const proc = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.lg, padding: Spacing.xl },
  progressOuter: { position: 'relative', width: 80, height: 80, alignItems: 'center', justifyContent: 'center' },
  iconRing: { width: 80, height: 80, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: Typography.size.xl, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  coinLabel: { fontSize: Typography.size.base, color: Colors.gold, fontWeight: Typography.weight.semibold },
  status: { fontSize: Typography.size.sm, color: Colors.textSecondary, textAlign: 'center' },
  barOuter: { width: '100%', height: 6, backgroundColor: Colors.surfaceHighlight, borderRadius: 3, overflow: 'hidden' },
  barInner: { height: '100%', backgroundColor: Colors.gold, borderRadius: 3 },
  steps: { alignSelf: 'stretch', gap: Spacing.sm },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surface, borderRadius: Radius.md, padding: Spacing.sm, borderWidth: 1, borderColor: Colors.surfaceBorder },
  stepRowDone: { borderColor: Colors.success + '40', backgroundColor: Colors.successDim },
  stepLabel: { flex: 1, fontSize: Typography.size.xs, color: Colors.textTertiary },
  aiBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: Colors.accentDim, borderRadius: Radius.pill, paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs },
  aiBadgeText: { fontSize: 10, color: Colors.accent },
  errorBanner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.warningDim, borderRadius: Radius.md, padding: Spacing.sm, borderWidth: 1, borderColor: Colors.warning + '40', alignSelf: 'stretch' },
  errorText: { flex: 1, fontSize: Typography.size.xs, color: Colors.warning },
});

const res = StyleSheet.create({
  header: { alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.lg },
  headerIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: Colors.successDim, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: Colors.success + '50' },
  headerTitle: { fontSize: Typography.size.xl, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  headerSub: { fontSize: Typography.size.sm, color: Colors.textSecondary },
  totalCard: { alignItems: 'center', backgroundColor: Colors.surface, borderRadius: Radius.xl, padding: Spacing.xl, borderWidth: 1, borderColor: Colors.surfaceBorder },
  totalCount: { fontSize: 48, fontWeight: Typography.weight.bold, color: Colors.primary },
  totalLabel: { fontSize: Typography.size.sm, color: Colors.textSecondary, marginTop: 4 },
  strategyGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  strategyCard: { flex: 1, minWidth: '45%', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surface, borderRadius: Radius.xl, padding: Spacing.md, borderWidth: 1 },
  strategyCount: { fontSize: 28, fontWeight: Typography.weight.bold },
  strategyLabel: { fontSize: Typography.size.xs, color: Colors.textSecondary, textAlign: 'center' },
  valueCard: { backgroundColor: Colors.goldDim, borderRadius: Radius.xl, padding: Spacing.xl, alignItems: 'center', gap: Spacing.sm, borderWidth: 1, borderColor: Colors.gold + '40' },
  valueLabel: { fontSize: 10, fontWeight: Typography.weight.bold, color: Colors.gold, textTransform: 'uppercase', letterSpacing: 0.5 },
  valueRange: { fontSize: Typography.size.xxl ?? 24, fontWeight: Typography.weight.bold, color: Colors.gold },
  valueNote: { fontSize: 10, color: Colors.gold + 'AA', textAlign: 'center', lineHeight: 14 },
  confCard: { backgroundColor: Colors.surface, borderRadius: Radius.xl, padding: Spacing.md, gap: Spacing.md, borderWidth: 1, borderColor: Colors.surfaceBorder },
  confLabel: { fontSize: 9, fontWeight: Typography.weight.bold, color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5 },
  confRow: { flexDirection: 'row', gap: Spacing.sm },
  confChip: { flex: 1, alignItems: 'center', borderRadius: Radius.lg, padding: Spacing.sm, gap: 2 },
  confNum: { fontSize: 22, fontWeight: Typography.weight.bold },
  confChipLabel: { fontSize: 9, color: Colors.textTertiary },
  confMetaRow: { flexDirection: 'row', gap: Spacing.sm, flexWrap: 'wrap' },
  metaChip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.pill, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: Colors.surfaceBorder },
  metaChipText: { fontSize: 10, color: Colors.textSecondary },
  errorCard: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, backgroundColor: Colors.warningDim, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.warning + '40' },
  errorTitle: { fontSize: Typography.size.xs, fontWeight: Typography.weight.bold, color: Colors.warning, marginBottom: 4 },
  errorItem: { fontSize: 10, color: Colors.warning + 'AA', lineHeight: 15 },
  disclaimer: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.md, padding: Spacing.sm },
  disclaimerText: { flex: 1, fontSize: 10, color: Colors.textTertiary, lineHeight: 15 },
});

const rev = StyleSheet.create({
  filterBar: { borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder, backgroundColor: Colors.surface },
  filterContent: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.base, paddingVertical: Spacing.xs, gap: Spacing.xs },
  filterChip: { backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.pill, paddingHorizontal: Spacing.md, paddingVertical: 6, borderWidth: 1, borderColor: Colors.surfaceBorder },
  filterChipActive: { backgroundColor: Colors.primaryDim, borderColor: Colors.primary + '60' },
  filterChipText: { fontSize: Typography.size.xs, color: Colors.textSecondary, fontWeight: Typography.weight.medium },
  reviewTitle: { fontSize: Typography.size.sm, color: Colors.textTertiary, fontWeight: Typography.weight.semibold },
});

const sub = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.xl, padding: Spacing.xl },
  title: { fontSize: Typography.size.xl, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  progress: { fontSize: Typography.size.base, color: Colors.primary, fontWeight: Typography.weight.semibold },
  barOuter: { width: '100%', height: 6, backgroundColor: Colors.surfaceHighlight, borderRadius: 3, overflow: 'hidden' },
  barInner: { height: '100%', backgroundColor: Colors.primary, borderRadius: 3 },
  note: { fontSize: Typography.size.xs, color: Colors.textTertiary, textAlign: 'center' },
  doneTitle: { fontSize: Typography.size.xxl ?? 24, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  doneCount: { fontSize: Typography.size.base, color: Colors.success, textAlign: 'center' },
  errorCount: { fontSize: Typography.size.sm, color: Colors.warning, textAlign: 'center' },
  doneNote: { fontSize: Typography.size.xs, color: Colors.textSecondary, textAlign: 'center', lineHeight: 18, paddingHorizontal: Spacing.xl },
  doneActions: { gap: Spacing.sm, alignSelf: 'stretch' },
  primaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, backgroundColor: Colors.primary, borderRadius: Radius.md, paddingVertical: Spacing.md, ...Shadow.glow },
  primaryBtnText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.background },
  secondaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, backgroundColor: Colors.surface, borderRadius: Radius.md, paddingVertical: Spacing.md, borderWidth: 1, borderColor: Colors.surfaceBorder },
  secondaryBtnText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.primary },
});
