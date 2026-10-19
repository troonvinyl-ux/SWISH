// islamicIdentificationService.ts
// Frontend service for Islamic & Indian Silver identification pipeline.
// Calls the swish-islamic-identify edge function which:
//   1. Uses AI visual analysis to generate candidates
//   2. Searches Zeno.ru for comparative examples
//   3. Searches Numista for catalogue references
//   4. Reconciles evidence and produces conservative identifications
//   5. Analyses countermarks separately from host coins

import { getSupabaseClient } from '@/template';
import { FunctionsHttpError } from '@supabase/supabase-js';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface IslamicCoinInput {
  images?: string[];             // base64 or data URIs
  existingImageUrls?: string[];  // stored HTTPS URLs
  weight?: number;               // grams — IMPORTANT evidence
  diameter?: number;             // mm
  notes?: string;                // user notes/context
  tenantId: string;
  itemId?: string;               // if updating existing item
}

export interface ZenoCandidate {
  zenoId: string;
  title: string;
  dynasty?: string;
  denomination?: string;
  weight?: number;
  referenceUrl: string;
  matchScore: number;
  matchFactors: string[];
  contradictions: string[];
}

export interface ZenoSearchResult {
  available: boolean;
  query: string;
  candidates: ZenoCandidate[];
  searchUrl: string;
  error?: string;
  totalFound: number;
}

export interface NumistaCandidate {
  typeId: number;
  numistaN: string;
  numistaUrl: string;
  title: string;
  weight?: number;
  diameter?: number;
  matchScore: number;
  matchFactors: string[];
  contradictions: string[];
}

export interface NumistaSearchResult {
  available: boolean;
  query: string;
  candidates: NumistaCandidate[];
  error?: string;
  totalFound: number;
}

export interface EnhancedCandidate {
  candidateId: string;
  label: string;
  dynasty?: string;
  ruler?: string;
  denomination?: string;
  mint?: string;
  dateAH?: string;
  dateCE?: string;
  sourceEvidence: string[];
  zenoMatches: string[];
  numistaMatches: string[];
  supportingFeatures: string[];
  contradictions: string[];
  confidence: number;
  confidenceTier: 'high' | 'medium' | 'low' | 'very_low' | 'insufficient';
  notes: string;
}

export interface CountermarkAnalysis {
  status: 'confirmed' | 'possible' | 'none' | 'uncertain';
  description: string;
  possibleAuthority?: string;
  possibleRuler?: string;
  possibleDate?: string;
  possibleType?: string;
  inscription?: string;
  symbol?: string;
  imageQualitySufficient: boolean;
  requiresBetterImage: boolean;
  notes: string;
}

export interface HostCoin {
  dynasty?: string;
  ruler?: string;
  denomination?: string;
  mint?: string;
  approximateDate?: string;
  catalogueReference?: string;
  confidence: number;
  notes: string;
}

export interface IslamicIdentificationResult {
  objectType: string;
  coinFamily: string;
  denomination?: string;
  approximateDate?: string;
  identificationState: 'observation_only' | 'candidate' | 'source_supported' | 'verified';
  canonicalTitle: string;
  confidence: number;
  confidenceTier: 'high' | 'medium' | 'low' | 'very_low' | 'insufficient';
  confidenceReason: string;
  observations: {
    obverse: string;
    reverse: string;
    edge?: string;
    inscriptionObverse?: string;
    inscriptionReverse?: string;
    scriptType?: string;
    visibleCharacters?: string;
    estimatedWeight?: string;
    estimatedDiameter?: string;
    metalColour?: string;
    condition: string;
    conditionGrade?: string;
    conditionNotes: string;
  };
  countermark: CountermarkAnalysis;
  hostCoin?: HostCoin;
  candidates: EnhancedCandidate[];
  selectedCandidateId?: string;
  zenoSearch: ZenoSearchResult[];
  numistaSearch: NumistaSearchResult;
  sourceEvidenceSummary: string[];
  sourceContradictions: string[];
  attributes: Record<string, any>;
  warnings: string[];
  missingInformation: string[];
  evidenceSupporting: string[];
  evidenceContradictory: string[];
  nextActions: string[];
  valuationLow: 0;
  valuationMid: 0;
  valuationHigh: 0;
  valuationConfidence: 'insufficient_data';
  marketEvidenceNote: string;
  batchFlags: {
    requiresSpecialistReview: boolean;
    flagReason?: string;
    priority: 'high' | 'medium' | 'low';
    workflowStatus: 'identification_complete' | 'more_info_required' | 'specialist_review' | 'low_commercial_priority';
  };
}

export interface IslamicBatchItem {
  id: string;           // local ID for UI
  itemId?: string;      // database item ID
  images: string[];
  existingImageUrls?: string[];
  weight?: number;
  diameter?: number;
  notes?: string;
  label?: string;       // user label e.g. "Coin 1"
  status: 'pending' | 'processing' | 'complete' | 'error';
  result?: IslamicIdentificationResult;
  error?: string;
}

export interface IslamicBatchResult {
  processed: number;
  succeeded: number;
  failed: number;
  items: IslamicBatchItem[];
  specialistReviewRequired: IslamicBatchItem[];
  moreInfoRequired: IslamicBatchItem[];
  countermarked: IslamicBatchItem[];
  complete: IslamicBatchItem[];
}

// ─────────────────────────────────────────────────────────────────────────────
// SINGLE COIN IDENTIFICATION
// ─────────────────────────────────────────────────────────────────────────────

export async function identifyIslamicSilver(
  input: IslamicCoinInput,
): Promise<{ result: IslamicIdentificationResult | null; error: string | null }> {
  const supabase = getSupabaseClient();

  try {
    const { data, error } = await supabase.functions.invoke('swish-islamic-identify', {
      body: {
        images: input.images,
        existingImageUrls: input.existingImageUrls,
        weight: input.weight,
        diameter: input.diameter,
        notes: input.notes,
        tenantId: input.tenantId,
        itemId: input.itemId,
        isBatch: false,
      },
    });

    if (error) {
      let errorMessage = error.message;
      if (error instanceof FunctionsHttpError) {
        try {
          const statusCode = error.context?.status ?? 500;
          const textContent = await error.context?.text();
          try {
            const parsed = JSON.parse(textContent || '{}');
            errorMessage = `[Code: ${statusCode}] ${parsed.error || textContent || error.message}`;
          } catch {
            errorMessage = `[Code: ${statusCode}] ${textContent || error.message}`;
          }
        } catch {
          errorMessage = error.message;
        }
      }
      return { result: null, error: errorMessage };
    }

    return { result: data.identification as IslamicIdentificationResult, error: null };
  } catch (e: any) {
    return { result: null, error: e.message ?? 'Unknown error' };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// BATCH PROCESSING
// Processes each coin individually with delay between requests.
// Returns comprehensive batch results with workflow classifications.
// ─────────────────────────────────────────────────────────────────────────────

export async function processIslamicBatch(
  items: IslamicBatchItem[],
  tenantId: string,
  onProgress: (processed: number, total: number, currentItem: IslamicBatchItem) => void,
  signal?: AbortSignal,
): Promise<IslamicBatchResult> {
  const results: IslamicBatchItem[] = [];
  let succeeded = 0;
  let failed = 0;

  for (let i = 0; i < items.length; i++) {
    if (signal?.aborted) break;

    const item = { ...items[i], status: 'processing' as const };
    onProgress(i, items.length, item);

    const { result, error } = await identifyIslamicSilver({
      images: item.images,
      existingImageUrls: item.existingImageUrls,
      weight: item.weight,
      diameter: item.diameter,
      notes: item.notes,
      tenantId,
      itemId: item.itemId,
    });

    if (error || !result) {
      results.push({ ...item, status: 'error', error: error ?? 'Identification failed' });
      failed++;
    } else {
      results.push({ ...item, status: 'complete', result });
      succeeded++;
    }

    // Progress callback with completed item
    onProgress(i + 1, items.length, results[results.length - 1]);

    // Polite delay between items
    if (i < items.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 800));
    }
  }

  // Classify results
  const specialistReviewRequired = results.filter(
    r => r.result?.batchFlags.requiresSpecialistReview || r.result?.batchFlags.workflowStatus === 'specialist_review',
  );
  const moreInfoRequired = results.filter(
    r => r.result?.batchFlags.workflowStatus === 'more_info_required',
  );
  const countermarked = results.filter(
    r => r.result?.countermark.status === 'confirmed' || r.result?.countermark.status === 'possible',
  );
  const complete = results.filter(
    r => r.result?.batchFlags.workflowStatus === 'identification_complete',
  );

  return {
    processed: results.length,
    succeeded,
    failed,
    items: results,
    specialistReviewRequired,
    moreInfoRequired,
    countermarked,
    complete,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

// Confidence colour for UI
export function getConfidenceColor(tier: IslamicIdentificationResult['confidenceTier']): string {
  switch (tier) {
    case 'high': return '#22C55E';       // green
    case 'medium': return '#F59E0B';     // amber
    case 'low': return '#F97316';        // orange
    case 'very_low': return '#EF4444';   // red
    case 'insufficient': return '#6B7280'; // grey
    default: return '#6B7280';
  }
}

// Identification state label
export function getIdentificationStateLabel(state: IslamicIdentificationResult['identificationState']): string {
  switch (state) {
    case 'observation_only': return 'Observations Only';
    case 'candidate': return 'Candidate (AI Only)';
    case 'source_supported': return 'Source Supported';
    case 'verified': return 'Verified';
    default: return 'Unknown';
  }
}

// Countermark status label
export function getCountermarkLabel(status: CountermarkAnalysis['status']): string {
  switch (status) {
    case 'confirmed': return 'Countermark Detected';
    case 'possible': return 'Possible Countermark';
    case 'none': return 'No Countermark';
    case 'uncertain': return 'Countermark Uncertain';
    default: return 'Not Assessed';
  }
}

// Workflow status label
export function getWorkflowLabel(status: IslamicIdentificationResult['batchFlags']['workflowStatus']): string {
  switch (status) {
    case 'identification_complete': return 'Identification Complete';
    case 'more_info_required': return 'More Info Required';
    case 'specialist_review': return 'Specialist Review';
    case 'low_commercial_priority': return 'Low Priority';
    default: return 'Pending';
  }
}

// Count how many Zeno results actually found matching candidates
export function countZenoMatches(zenoSearch: ZenoSearchResult[]): number {
  return zenoSearch.filter(r => r.available && r.candidates.length > 0).length;
}

// ─────────────────────────────────────────────────────────────────────────────
// SAVE TO INVENTORY
// Creates an item record in the database from a completed identification.
// Uploads local images to Supabase Storage when present.
// ─────────────────────────────────────────────────────────────────────────────

export interface SaveIslamicItemOptions {
  weight?: number;
  diameter?: number;
  label?: string;
  notes?: string;
  acquisitionId?: string;
}

export interface SaveIslamicItemResult {
  itemId: string | null;
  mediaUrls: string[];
  error: string | null;
}

async function uploadIslamicImages(
  itemId: string,
  localUris: string[],
): Promise<string[]> {
  const supabase = getSupabaseClient();
  const uploadedUrls: string[] = [];

  for (let i = 0; i < localUris.length; i++) {
    const uri = localUris[i];
    // Skip already-uploaded HTTPS URLs
    if (uri.startsWith('https://')) {
      uploadedUrls.push(uri);
      continue;
    }
    try {
      let arrayBuffer: ArrayBuffer;
      let mimeType = 'image/jpeg';

      if (uri.startsWith('data:')) {
        // Base64 data URI — decode directly without fetch (fetch cannot load data: URIs on React Native)
        const commaIdx = uri.indexOf(',');
        if (commaIdx === -1) continue;
        const header = uri.slice(0, commaIdx); // e.g. "data:image/jpeg;base64"
        const base64Data = uri.slice(commaIdx + 1);
        const detectedMime = header.match(/data:([^;]+)/)?.[1];
        if (detectedMime) mimeType = detectedMime;
        // Decode base64 → Uint8Array → ArrayBuffer
        const binary = atob(base64Data);
        const bytes = new Uint8Array(binary.length);
        for (let b = 0; b < binary.length; b++) bytes[b] = binary.charCodeAt(b);
        arrayBuffer = bytes.buffer;
      } else {
        // Local file URI — use fetch (works on device for file:// URIs)
        const resp = await fetch(uri);
        if (!resp.ok) continue;
        const blob = await resp.blob();
        arrayBuffer = await blob.arrayBuffer();
        const ext = uri.split('.').pop()?.toLowerCase() ?? 'jpg';
        mimeType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
      }

      const ext = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
      const path = `${itemId}/islamic_${i + 1}_${Date.now()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from('item-images')
        .upload(path, arrayBuffer, { contentType: mimeType, upsert: true });

      if (!uploadError) {
        const { data: urlData } = supabase.storage
          .from('item-images')
          .getPublicUrl(path);
        if (urlData?.publicUrl) uploadedUrls.push(urlData.publicUrl);
      } else {
        console.log(`[SWISH] Islamic image upload failed (${path}): ${uploadError.message}`);
      }
    } catch (e: any) {
      console.log(`[SWISH] Islamic image upload error (item ${itemId}, image ${i}): ${e?.message}`);
      // Non-fatal — skip this image
    }
  }

  return uploadedUrls;
}

export async function saveIslamicCoinToInventory(
  tenantId: string,
  batchItem: IslamicBatchItem,
  options: SaveIslamicItemOptions = {},
): Promise<SaveIslamicItemResult> {
  if (!batchItem.result) {
    return { itemId: null, mediaUrls: [], error: 'No identification result to save' };
  }

  const supabase = getSupabaseClient();
  const r = batchItem.result;

  // Build rich attributes record
  const attributes: Record<string, any> = {
    ...r.attributes,
    specialist_id: 'islamic_silver',
    identification_state: r.identificationState,
    coin_family: r.coinFamily,
    object_type: r.objectType,
    countermark_detected: r.countermark.status !== 'none',
    countermark_status: r.countermark.status,
  };

  // Countermark detail
  if (r.countermark.status !== 'none') {
    if (r.countermark.description) attributes['countermark_description'] = r.countermark.description;
    if (r.countermark.possibleAuthority) attributes['countermark_authority'] = r.countermark.possibleAuthority;
    if (r.countermark.possibleRuler) attributes['countermark_ruler'] = r.countermark.possibleRuler;
    if (r.countermark.possibleDate) attributes['countermark_date'] = r.countermark.possibleDate;
    if (r.countermark.inscription) attributes['countermark_inscription'] = r.countermark.inscription;
  }

  // Host coin
  if (r.hostCoin) {
    if (r.hostCoin.dynasty) attributes['host_coin_dynasty'] = r.hostCoin.dynasty;
    if (r.hostCoin.ruler) attributes['host_coin_ruler'] = r.hostCoin.ruler;
    if (r.hostCoin.denomination) attributes['host_coin_denomination'] = r.hostCoin.denomination;
    if (r.hostCoin.approximateDate) attributes['host_coin_date'] = r.hostCoin.approximateDate;
  }

  // Source evidence chains
  if (r.sourceEvidenceSummary.length > 0) {
    attributes['source_evidence'] = r.sourceEvidenceSummary.slice(0, 5).join(' | ');
  }
  if (r.zenoSearch.some(z => z.available && z.candidates.length > 0)) {
    attributes['zeno_searched'] = true;
    const topZeno = r.zenoSearch
      .flatMap(z => z.candidates)
      .sort((a, b) => b.matchScore - a.matchScore)[0];
    if (topZeno && topZeno.matchScore >= 20) {
      attributes['zeno_reference'] = attributes['zeno_reference'] ?? topZeno.zenoId;
      attributes['zeno_url'] = attributes['zeno_url'] ?? topZeno.referenceUrl;
      attributes['zeno_title'] = attributes['zeno_title'] ?? topZeno.title;
    }
  }
  if (r.numistaSearch.available && r.numistaSearch.candidates.length > 0) {
    const topNumista = r.numistaSearch.candidates[0];
    if (topNumista.matchScore >= 20) {
      attributes['numista_candidate_id'] = attributes['numista_candidate_id'] ?? String(topNumista.typeId);
      attributes['numista_n'] = attributes['numista_n'] ?? topNumista.numistaN;
      attributes['numista_url'] = attributes['numista_url'] ?? topNumista.numistaUrl;
    }
  }

  // Physical measurements
  const weightGrams = options.weight ?? batchItem.weight;
  const diameterMm = options.diameter ?? batchItem.diameter;
  if (weightGrams) attributes['weight_grams'] = weightGrams;
  if (diameterMm) attributes['diameter_mm'] = diameterMm;

  // Status: use 'identified' for well-identified coins, 'review_required' for low confidence
  const status = r.batchFlags.workflowStatus === 'more_info_required' || r.confidence < 0.35
    ? 'review_required'
    : 'identified';

  // Build insert payload
  const insertPayload: Record<string, any> = {
    tenant_id: tenantId,
    canonical_title: r.canonicalTitle,
    specialist_id: 'islamic_silver',
    status,
    disposition_decision: 'pending',
    identification_confidence: r.confidence,
    identification_source: r.identificationState === 'source_supported' || r.identificationState === 'verified'
      ? 'verified' : 'detected',
    condition: r.observations.condition || '',
    condition_grade: r.observations.conditionGrade ?? '',
    condition_notes: r.observations.conditionNotes || '',
    attributes,
    warnings: r.warnings,
    tags: ['islamic_silver', r.coinFamily?.toLowerCase().replace(/\s+/g, '_') ?? 'unclassified'].filter(Boolean),
    media: [], // populated after upload
    valuation_low: 0,
    valuation_mid: 0,
    valuation_high: 0,
    valuation_confidence: 'low',
    expected_selling_price: 0,
    expected_net: 0,
    expected_profit: 0,
    description: options.notes ?? batchItem.notes ?? '',
    custom_notes: options.label ?? batchItem.label ?? '',
  };

  // Coin-specific fields
  if (r.candidates[0]?.ruler) insertPayload['ruler'] = r.candidates[0].ruler;
  if (r.candidates[0]?.denomination) insertPayload['denomination'] = r.candidates[0].denomination;
  if (r.candidates[0]?.mint) insertPayload['mint'] = r.candidates[0].mint;
  if (r.approximateDate) insertPayload['period'] = r.approximateDate;
  if (weightGrams) insertPayload['weight_grams'] = weightGrams;
  if (diameterMm) insertPayload['diameter_mm'] = diameterMm;

  const { data, error: insertError } = await supabase
    .from('items')
    .insert(insertPayload)
    .select('id')
    .single();

  if (insertError || !data) {
    return { itemId: null, mediaUrls: [], error: insertError?.message ?? 'Insert failed' };
  }

  const itemId = data.id as string;

  // Upload images
  const allImageUris = [
    ...(batchItem.images ?? []),
    ...(batchItem.existingImageUrls ?? []),
  ].filter(Boolean);

  let mediaUrls: string[] = [];
  if (allImageUris.length > 0) {
    mediaUrls = await uploadIslamicImages(itemId, allImageUris);
    if (mediaUrls.length > 0) {
      await supabase
        .from('items')
        .update({ media: mediaUrls })
        .eq('id', itemId);
    }
  }

  return { itemId, mediaUrls, error: null };
}

export interface BatchSaveProgress {
  saved: number;
  total: number;
  failed: number;
  currentLabel?: string;
}

export async function saveIslamicBatchToInventory(
  tenantId: string,
  items: IslamicBatchItem[],
  onProgress?: (progress: BatchSaveProgress) => void,
): Promise<{ savedIds: string[]; failed: number; errors: string[] }> {
  const eligibleItems = items.filter(i => i.status === 'complete' && i.result && !i.itemId);
  const savedIds: string[] = [];
  const errors: string[] = [];
  let failed = 0;

  for (let i = 0; i < eligibleItems.length; i++) {
    const item = eligibleItems[i];
    onProgress?.({ saved: i, total: eligibleItems.length, failed, currentLabel: item.label ?? `Coin ${i + 1}` });

    const { itemId, error } = await saveIslamicCoinToInventory(tenantId, item);
    if (itemId) {
      savedIds.push(itemId);
    } else {
      failed++;
      errors.push(`${item.label ?? item.id}: ${error ?? 'Unknown error'}`);
    }
  }

  onProgress?.({ saved: savedIds.length, total: eligibleItems.length, failed });
  return { savedIds, failed, errors };
}
