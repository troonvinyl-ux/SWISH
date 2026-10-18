// SWISH AI Identification Service
// Client-side: picks images, calls swish-identify edge function,
// then persists the result as a canonical Item in the database.
// Images are compressed before AI call (prevents 413), then uploaded
// to Supabase Storage so thumbnails are permanent across all devices.

import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';
import { Platform } from 'react-native';
import { getSupabaseClient } from '@/template';
import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js';
import { SpecialistId } from '@/constants/specialists';
import { EvidenceSource, ConfidenceTier, DispositionDecision } from '@/constants/config';
import { createItem, Item } from '@/services/itemService';

export interface CapturedImage {
  uri: string;
  base64?: string;
  slotId: string;
  slotLabel: string;
}

export interface NumistaVerification {
  status: 'verified' | 'strong_match' | 'candidate' | 'weak_match' | 'no_match' | 'unavailable';
  typeId?: number;
  numistaId?: number;
  numistaN?: string;
  numistaUrl?: string;
  title?: string;
  matchScore: number;
  matchTier: 'verified' | 'very_strong' | 'strong' | 'plausible' | 'weak' | 'rejected';
  matchFactors: string[];
  contradictions: string[];
  issuedFrom?: number;
  issuedTo?: number;
  composition?: string;
  weight?: number;
  diameter?: number;
  references: string[];
  suppliedWeight?: number;
  suppliedDiameter?: number;
  weightDifferencePercent?: number;
  diameterDifferenceMm?: number;
  physicalMatchGood: boolean;
}

// Quota information returned alongside identification results
export interface AIQuotaInfo {
  isPremium: boolean;
  used: number;
  limit: number | null;    // null = unlimited (premium)
  remaining: number | null; // null = unlimited (premium)
  monthKey: string;
}

// Structured quota-exceeded error
export interface QuotaExceededError {
  type: 'QUOTA_EXCEEDED';
  used: number;
  limit: number;
  message: string;
}

export interface AIIdentificationResult {
  canonicalTitle: string;
  specialistId: SpecialistId;
  objectType?: string;               // v4: coin|medal|token|jeton|commemorative_piece|banknote|jewellery|replica_reproduction|unknown
  identificationState?: string;      // v4: observation_only|candidate|verified
  confidence: number;
  confidenceTier: string;
  confidenceReason?: string;         // v4: WHY this confidence level
  identificationSource: EvidenceSource;
  condition: string;
  conditionGrade?: string;
  conditionNotes: string;
  hasHole?: boolean;                 // v4: explicit hole/piercing flag
  hasAlteration?: boolean;           // v4: explicit alteration flag
  alterationNotes?: string;          // v4: alteration description
  observedCharacteristics?: {        // v4: what is actually visible
    obverse?: string;
    reverse?: string;
    edge?: string;
    visibleInscription?: string;
    estimatedDiameter?: string;
    estimatedWeight?: string;
    colorAndMetal?: string;
  };
  candidateIdentification?: {        // v4: structured candidate
    primaryCandidate?: string;
    alternativeCandidates?: string[];
    whyCandidateSelected?: string;
    whyUncertain?: string;
  };
  coinFields?: {                     // v4: coin-specific (only when objectType=coin)
    denomination?: string;
    issuer?: string;
    country?: string;
    period?: string;
    mint?: string;
    composition?: string;
    obverseDescription?: string;
    reverseDescription?: string;
    legendFragment?: string;
    catalogueHint?: string;
  };
  medalFields?: {                    // v4: medal-specific (only when objectType=medal/token)
    subject?: string;
    personsDepicted?: string;
    issuer?: string;
    medallist?: string;
    approximateDate?: string;
    inscription?: string;
    material?: string;
    diameter?: string;
    weight?: string;
    reference?: string;
  };
  // Valuation is always 0 from identify; use swish-market-value for pricing
  valuationLow: number;
  valuationMid: number;
  valuationHigh: number;
  valuationConfidence: ConfidenceTier;
  valuationNote?: string;
  saleProb30d: number | null;
  // Evidence fields
  evidenceSupporting: string[];
  evidenceContradictory: string[];
  missingInformation: string[];
  attributesConfirmed: Record<string, any>;
  attributesInferred: Record<string, any>;
  attributes: Record<string, any>;
  warnings: string[];
  suggestedDisposition: string;
  dispositionDecision: DispositionDecision;
  // v3: Numista verification
  numistaVerification?: NumistaVerification | null;
  numistaStatus?: string;
  numistaTypeId?: number | null;
  numistaN?: string | null;
  numistaTitle?: string | null;
  numistaUrl?: string | null;
  numistaMatchScore?: number;
  numistaMatchTier?: string;
  // Quota
  quota?: AIQuotaInfo;
}

// ── Storage bucket name ────────────────────────────────────────────────────────
const ITEM_IMAGES_BUCKET = 'item-images';

// ── Image compression settings for AI payload ─────────────────────────────────
// Keeps total payload well under the 10MB Edge Function limit.
const AI_COMPRESS = { maxWidth: 1024, maxHeight: 1024, quality: 0.65 };

// Request camera + media library permissions
export async function requestMediaPermissions(): Promise<{ granted: boolean; error?: string }> {
  if (Platform.OS === 'web') return { granted: true };

  const camera = await ImagePicker.requestCameraPermissionsAsync();
  const media = await ImagePicker.requestMediaLibraryPermissionsAsync();

  if (!camera.granted && !media.granted) {
    return { granted: false, error: 'Camera and photo library permissions are required to scan items.' };
  }
  return { granted: true };
}

// Launch camera to capture one photo
export async function captureFromCamera(): Promise<CapturedImage | null> {
  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    quality: 0.85,
    base64: false,   // We compress separately, no need to load huge base64 here
    allowsEditing: false,
    exif: false,
  });

  if (result.canceled || !result.assets?.[0]) return null;

  const asset = result.assets[0];
  return {
    uri: asset.uri,
    slotId: 'camera_capture',
    slotLabel: 'Camera Capture',
  };
}

// Launch photo library picker
export async function pickFromLibrary(slotId: string, slotLabel: string): Promise<CapturedImage | null> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    quality: 0.85,
    base64: false,
    allowsEditing: false,
    exif: false,
  });

  if (result.canceled || !result.assets?.[0]) return null;

  const asset = result.assets[0];
  return {
    uri: asset.uri,
    slotId,
    slotLabel,
  };
}

// ── Compress image for AI payload ─────────────────────────────────────────────
// Resizes to max 1024px and reduces quality to keep payload small.
async function compressForAI(uri: string): Promise<string> {
  try {
    const result = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: AI_COMPRESS.maxWidth } }],
      {
        compress: AI_COMPRESS.quality,
        format: ImageManipulator.SaveFormat.JPEG,
        base64: true,
      }
    );
    const b64 = result.base64 ?? '';
    return b64.startsWith('data:') ? b64 : `data:image/jpeg;base64,${b64}`;
  } catch {
    // Fallback: read as-is
    return ensureBase64Raw(uri);
  }
}

// ── Raw base64 fallback (no compression) ─────────────────────────────────────
async function ensureBase64Raw(uri: string): Promise<string> {
  if (Platform.OS === 'web') {
    const response = await fetch(uri);
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }
  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return `data:image/jpeg;base64,${base64}`;
}

// ── Known attributes passed to Re-ID ─────────────────────────────────────────
export interface KnownItemAttributes {
  weight?: number;
  length?: number;
  width?: number;
  height?: number;
  diameter?: number;
  material?: string;
  manufacturer?: string;
  yearMade?: string;
  countryOfOrigin?: string;
  sku?: string;
  condition?: string;
  conditionGrade?: string;
  customNotes?: string;
  edgeLegend?: string;
  existingTitle?: string;
  existingAttributes?: Record<string, any>;
}

// ── Call the swish-identify edge function ─────────────────────────────────────
export async function identifyItemWithAI(
  images: CapturedImage[],
  specialistId: SpecialistId,
  acquisitionContext?: string,
  knownAttributes?: KnownItemAttributes,
  options?: {
    tenantId?: string;
    existingImageUrls?: string[];  // use stored URLs instead of re-uploading
  }
): Promise<{ result: AIIdentificationResult | null; error: string | null; quotaExceeded?: QuotaExceededError }> {
  try {
    // Compress any new captures; skip if using existing URLs only
    const base64Images = images.length > 0
      ? await Promise.all(images.map(img => compressForAI(img.uri)))
      : [];

    const supabase = getSupabaseClient();
    const { data, error } = await supabase.functions.invoke('swish-identify', {
      body: {
        images: base64Images.length > 0 ? base64Images : undefined,
        existingImageUrls: options?.existingImageUrls,
        specialistId,
        acquisitionContext,
        knownAttributes,
        tenantId: options?.tenantId,
      },
    });

    if (error) {
      let errorMessage = error.message;
      let rawBody: string | null = null;
      if (error instanceof FunctionsFetchError) {
        // A fetch error means the client never received an HTTP response. Preserve the
        // underlying transport detail so connection/CORS/deployment failures aren't
        // mistaken for an AI identification rejection.
        const transportDetail = error.context instanceof Error ? error.context.message : String(error.context ?? '');
        console.error('[SWISH swish-identify transport failure]', transportDetail || error.message);
        errorMessage = transportDetail
          ? `Could not reach the swish-identify Edge Function: ${transportDetail}. Check the connection and function availability, then retry.`
          : 'Could not reach the swish-identify Edge Function. Check the connection and function availability, then retry.';
      } else if (error instanceof FunctionsHttpError) {
        try {
          const statusCode = error.context?.status ?? 500;
          rawBody = await error.context?.text();
          // Check for quota-exceeded error (HTTP 402)
          if (statusCode === 402 && rawBody) {
            try {
              const parsed = JSON.parse(rawBody);
              if (parsed.error === 'FREE_QUOTA_EXCEEDED') {
                return {
                  result: null,
                  error: parsed.message ?? 'Monthly AI quota exceeded',
                  quotaExceeded: {
                    type: 'QUOTA_EXCEEDED',
                    used: parsed.quotaUsed ?? 5,
                    limit: parsed.quotaLimit ?? 5,
                    message: parsed.message ?? 'Monthly AI quota exceeded',
                  },
                };
              }
            } catch { /* not JSON */ }
          }
          errorMessage = `[Code: ${statusCode}] ${rawBody || error.message || 'Unknown error'}`;
        } catch {
          errorMessage = error.message || 'Failed to read response';
        }
      }
      return { result: null, error: errorMessage };
    }

    if (!data?.identification) {
      return { result: null, error: 'AI returned no identification data' };
    }

    const id = data.identification;
    const numistaV = data.numistaVerification ?? null;

    // ── Niche-context guard ────────────────────────────────────────────────
    // Prevent the AI edge function from silently overriding a caller-specified
    // niche-specific specialistId with a generic fallback (e.g. returning
    // 'curiosities_collectibles' for a bicycle identification request).
    // Rule: if the caller passed a niche-specific specialist and the AI returns
    // a generic specialist, retain the caller's niche specialist.
    const GENERIC_SPECIALISTS = new Set(['curiosities_collectibles', 'antiques']);
    const NICHE_SPECIFIC_SPECIALISTS = new Set([
      'bicycles', 'motocross', 'clothing', 'trainers_sneakers',
      'coins', 'islamic_silver', 'banknotes', 'gold', 'silver',
      'pokemon_cards', 'trading_cards', 'stamps', 'vinyl_records',
      'books', 'retro_games', 'retro_consoles',
    ]);
    const aiSpecialist = id.specialistId as SpecialistId | undefined;
    const resolvedSpecialistId: SpecialistId =
      NICHE_SPECIFIC_SPECIALISTS.has(specialistId) &&
      (!aiSpecialist || GENERIC_SPECIALISTS.has(aiSpecialist))
        ? specialistId                            // keep caller's niche specialist
        : (aiSpecialist ?? specialistId) as SpecialistId; // accept AI's specific value

    const result: AIIdentificationResult = {
      canonicalTitle: id.canonicalTitle ?? 'Unknown Item',
      specialistId: resolvedSpecialistId,
      // v4 fields
      objectType: id.objectType ?? undefined,
      identificationState: id.identificationState ?? undefined,
      confidenceReason: id.confidenceReason ?? undefined,
      hasHole: id.hasHole ?? false,
      hasAlteration: id.hasAlteration ?? false,
      alterationNotes: id.alterationNotes ?? undefined,
      observedCharacteristics: id.observedCharacteristics ?? undefined,
      candidateIdentification: id.candidateIdentification ?? undefined,
      coinFields: id.coinFields ?? undefined,
      medalFields: id.medalFields ?? undefined,
      //
      confidence: clamp(Number(id.confidence ?? 0.3), 0, 1),
      confidenceTier: id.confidenceTier ?? 'low',
      identificationSource: toEvidenceSource(id.identificationSource),
      condition: id.condition ?? 'Cannot be reliably graded from supplied images',
      conditionGrade: id.conditionGrade ?? undefined,
      conditionNotes: id.conditionNotes ?? '',
      valuationLow: 0,
      valuationMid: 0,
      valuationHigh: 0,
      valuationConfidence: 'unknown' as ConfidenceTier,
      valuationNote: id.valuationNote ?? 'Use Re-Value to get evidence-based market pricing',
      saleProb30d: id.saleProb30d ?? null,
      evidenceSupporting: Array.isArray(id.evidenceSupporting) ? id.evidenceSupporting : [],
      evidenceContradictory: Array.isArray(id.evidenceContradictory) ? id.evidenceContradictory : [],
      missingInformation: Array.isArray(id.missingInformation) ? id.missingInformation : [],
      attributesConfirmed: id.attributesConfirmed ?? {},
      attributesInferred: id.attributesInferred ?? {},
      attributes: id.attributes ?? {},
      warnings: Array.isArray(id.warnings) ? id.warnings : [],
      suggestedDisposition: id.suggestedDisposition ?? '',
      dispositionDecision: (id.dispositionDecision ?? 'sell_individual') as DispositionDecision,
      // v3/v4: Numista
      numistaVerification: numistaV,
      numistaStatus: id.numistaStatus ?? numistaV?.status ?? null,
      numistaTypeId: id.numistaTypeId ?? numistaV?.typeId ?? null,
      numistaN: id.numistaN ?? numistaV?.numistaN ?? null,
      numistaTitle: id.numistaTitle ?? numistaV?.title ?? null,
      numistaUrl: id.numistaUrl ?? numistaV?.numistaUrl ?? null,
      numistaMatchScore: id.numistaMatchScore ?? numistaV?.matchScore ?? 0,
      numistaMatchTier: id.numistaMatchTier ?? numistaV?.matchTier ?? 'rejected',
      quota: data.quota ?? undefined,
    };

    return { result, error: null };
  } catch (e: any) {
    return { result: null, error: e?.message ?? 'Identification failed' };
  }
}

// ── Upload images to Supabase Storage ─────────────────────────────────────────
// Uploads each local file:// URI to the item-images bucket and returns
// the permanent public https:// URLs.
export async function uploadItemImages(
  itemId: string,
  images: CapturedImage[]
): Promise<{ urls: string[]; errors: string[] }> {
  const supabase = getSupabaseClient();
  const urls: string[] = [];
  const errors: string[] = [];

  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    try {
      // Skip if already a remote URL
      if (img.uri.startsWith('https://') || img.uri.startsWith('http://')) {
        urls.push(img.uri);
        continue;
      }

      const fileName = `${itemId}/${i + 1}_${img.slotId}.jpg`;

      if (Platform.OS === 'web') {
        // Web: fetch blob and upload
        const response = await fetch(img.uri);
        const blob = await response.blob();
        const { error: uploadErr } = await supabase.storage
          .from(ITEM_IMAGES_BUCKET)
          .upload(fileName, blob, {
            contentType: 'image/jpeg',
            upsert: true,
          });
        if (uploadErr) {
          errors.push(`Slot ${img.slotLabel}: ${uploadErr.message}`);
          continue;
        }
      } else {
        // Native: read as base64 and convert to ArrayBuffer
        const base64 = await FileSystem.readAsStringAsync(img.uri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        const binaryStr = atob(base64);
        const bytes = new Uint8Array(binaryStr.length);
        for (let j = 0; j < binaryStr.length; j++) {
          bytes[j] = binaryStr.charCodeAt(j);
        }
        const { error: uploadErr } = await supabase.storage
          .from(ITEM_IMAGES_BUCKET)
          .upload(fileName, bytes.buffer, {
            contentType: 'image/jpeg',
            upsert: true,
          });
        if (uploadErr) {
          errors.push(`Slot ${img.slotLabel}: ${uploadErr.message}`);
          continue;
        }
      }

      // Get the public URL
      const { data: urlData } = supabase.storage
        .from(ITEM_IMAGES_BUCKET)
        .getPublicUrl(fileName);

      if (urlData?.publicUrl) {
        urls.push(urlData.publicUrl);
      }
    } catch (e: any) {
      errors.push(`Slot ${img.slotLabel}: ${e.message ?? 'Upload failed'}`);
    }
  }

  return { urls, errors };
}

// ── Update item media after upload ────────────────────────────────────────────
export async function updateItemMedia(
  tenantId: string,
  itemId: string,
  permanentUrls: string[]
): Promise<void> {
  const supabase = getSupabaseClient();
  await supabase
    .from('items')
    .update({
      media: permanentUrls,
      updated_at: new Date().toISOString(),
    })
    .eq('id', itemId)
    .eq('tenant_id', tenantId);
}

// ── Persist an AI identification result as a real database Item ───────────────
export async function saveIdentifiedItem(
  tenantId: string,
  result: AIIdentificationResult,
  options: {
    acquisitionId?: string;
    mediaUris?: string[];
    acquiredCost?: number;
  } = {}
): Promise<{ item: Item | null; error: string | null }> {
  // v2: identification engine no longer provides market values.
  // Valuation is 0 until swish-market-value (Re-Value) runs separately.
  // saleProb30d is null until evidence-based calculation.
  const acquiredCost = options.acquiredCost ?? 0;

  return createItem(tenantId, {
    canonicalTitle: result.canonicalTitle,
    specialistId: result.specialistId,
    acquisitionId: options.acquisitionId,
    description: buildDescription(result),
    // v4: status based on objectType + identificationState + confidence
    status: (result.identificationState === 'observation_only' || result.confidence < 0.30)
      ? 'review_required'
      : result.confidence >= 0.80 ? 'identified' : 'review_required',
    dispositionDecision: result.dispositionDecision,
    condition: result.condition,
    conditionGrade: result.conditionGrade,
    conditionNotes: result.conditionNotes,
    identificationConfidence: result.confidence,
    identificationSource: result.identificationSource,
    valuationLow: 0,
    valuationMid: 0,
    valuationHigh: 0,
    valuationConfidence: 'unknown' as ConfidenceTier,
    expectedSellingPrice: 0,
    expectedNet: 0,
    expectedProfit: -acquiredCost,
    saleProb30d: 0,
    attributes: {
      ...result.attributes,
      // Ensure objectType and identificationState are stored
      ...(result.objectType ? { object_type: result.objectType } : {}),
      ...(result.identificationState ? { identification_state: result.identificationState } : {}),
      ...(result.hasHole ? { has_hole: true } : {}),
      ...(result.hasAlteration ? { has_alteration: true } : {}),
      ...(result.alterationNotes ? { alteration_notes: result.alterationNotes } : {}),
    },
    media: options.mediaUris ?? [],
    warnings: result.warnings,
    tags: [],
    acquiredCost,
  });
}

function buildDescription(result: AIIdentificationResult): string {
  const parts: string[] = [];
  if (result.condition) parts.push(`Condition: ${result.condition}`);
  if (result.conditionGrade) parts.push(`Grade: ${result.conditionGrade}`);
  if (result.suggestedDisposition) parts.push(result.suggestedDisposition);
  return parts.join(' · ');
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

const EVIDENCE_SOURCES: EvidenceSource[] = ['detected', 'inferred', 'researched', 'user_confirmed', 'verified', 'unknown'];
const CONFIDENCE_TIERS: ConfidenceTier[] = ['very_high', 'high', 'medium', 'low', 'very_low', 'unknown'];

function toEvidenceSource(v: string | null | undefined): EvidenceSource {
  return EVIDENCE_SOURCES.includes(v as EvidenceSource) ? (v as EvidenceSource) : 'researched';
}

function toConfidenceTier(v: string | null | undefined): ConfidenceTier {
  return CONFIDENCE_TIERS.includes(v as ConfidenceTier) ? (v as ConfidenceTier) : 'medium';
}
