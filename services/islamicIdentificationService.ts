// Existing dedicated Islamic/Indian batch workflow. Shared scanner/re-ID Numista image search lives in aiIdentificationService.
import { getSupabaseClient } from '@/template';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { preflightPhotos } from './photoQualityService';
import { prepareCapturedImages } from './sharedImagePreparationService';
import { prepareImageForAI, uploadItemImages, updateItemMedia, type CapturedImage } from './aiIdentificationService';
const islamicCaptures = (uris: string[]): CapturedImage[] => uris.map((uri, index) => ({ uri, slotId: index === 0 ? 'obverse' : index === 1 ? 'reverse' : `detail_${index}`, slotLabel: index === 0 ? 'Obverse' : index === 1 ? 'Reverse' : `Detail ${index}` }));
export interface IslamicCoinInput {
  images?: string[];
  existingImageUrls?: string[];
  weight?: number;
  diameter?: number;
  notes?: string;
  tenantId: string;
  itemId?: string;
  allowPhotoWarnings?: boolean;
}
export interface ZenoCandidate {
  zenoId: string; title: string; dynasty?: string; denomination?: string; weight?: number;
  referenceUrl: string; matchScore: number; matchFactors: string[]; contradictions: string[];
}
export interface ZenoSearchResult {
  available: boolean; query: string; candidates: ZenoCandidate[]; searchUrl: string; error?: string; totalFound: number;
}
export interface NumistaCandidate {
  typeId: number; numistaN: string; numistaUrl: string; title: string; weight?: number; diameter?: number;
  matchScore: number; matchFactors: string[]; contradictions: string[];
}
export interface NumistaSearchResult {
  available: boolean; query: string; candidates: NumistaCandidate[]; error?: string; totalFound: number;
}
export interface EnhancedCandidate {
  candidateId: string; label: string; dynasty?: string; ruler?: string; denomination?: string; mint?: string;
  dateAH?: string; dateCE?: string; sourceEvidence: string[]; zenoMatches: string[]; numistaMatches: string[];
  supportingFeatures: string[]; contradictions: string[]; confidence: number;
  confidenceTier: 'high' | 'medium' | 'low' | 'very_low' | 'insufficient'; notes: string;
}
export interface CountermarkAnalysis {
  status: 'confirmed' | 'possible' | 'none' | 'uncertain'; description: string; possibleAuthority?: string;
  possibleRuler?: string; possibleDate?: string; possibleType?: string; inscription?: string; symbol?: string;
  imageQualitySufficient: boolean; requiresBetterImage: boolean; notes: string;
}
export interface HostCoin {
  dynasty?: string; ruler?: string; denomination?: string; mint?: string; approximateDate?: string;
  catalogueReference?: string; confidence: number; notes: string;
}
export interface IslamicIdentificationResult {
  objectType: string; coinFamily: string; denomination?: string; approximateDate?: string;
  identificationState: 'observation_only' | 'candidate' | 'source_supported' | 'verified';
  canonicalTitle: string; confidence: number; confidenceTier: 'high' | 'medium' | 'low' | 'very_low' | 'insufficient'; confidenceReason: string;
  observations: {
    obverse: string; reverse: string; edge?: string; inscriptionObverse?: string; inscriptionReverse?: string;
    scriptType?: string; visibleCharacters?: string; estimatedWeight?: string; estimatedDiameter?: string;
    metalColour?: string; condition: string; conditionGrade?: string; conditionNotes: string;
  };
  countermark: CountermarkAnalysis; hostCoin?: HostCoin; candidates: EnhancedCandidate[]; selectedCandidateId?: string;
  zenoSearch: ZenoSearchResult[]; numistaSearch: NumistaSearchResult; sourceEvidenceSummary: string[];
  sourceContradictions: string[]; attributes: Record<string, any>; warnings: string[]; missingInformation: string[];
  evidenceSupporting: string[]; evidenceContradictory: string[]; nextActions: string[];
  valuationLow: 0; valuationMid: 0; valuationHigh: 0; valuationConfidence: 'insufficient_data'; marketEvidenceNote: string;
  batchFlags: { requiresSpecialistReview: boolean; flagReason?: string; priority: 'high' | 'medium' | 'low'; workflowStatus: 'identification_complete' | 'more_info_required' | 'specialist_review' | 'low_commercial_priority' };
}
export interface IslamicBatchItem {
  id: string; itemId?: string; images: string[]; existingImageUrls?: string[]; weight?: number; diameter?: number;
  notes?: string; label?: string; status: 'pending' | 'processing' | 'complete' | 'error'; result?: IslamicIdentificationResult; error?: string;
}
export interface IslamicBatchResult {
  processed: number; succeeded: number; failed: number; items: IslamicBatchItem[];
  specialistReviewRequired: IslamicBatchItem[]; moreInfoRequired: IslamicBatchItem[]; countermarked: IslamicBatchItem[]; complete: IslamicBatchItem[];
}
export async function identifyIslamicSilver(input: IslamicCoinInput): Promise<{ result: IslamicIdentificationResult | null; error: string | null }> {
  const supabase = getSupabaseClient();
  try {
    const preflight = await preflightPhotos([...(input.images ?? []), ...(input.existingImageUrls ?? [])].map((uri, index) => ({ uri, slotLabel: `Coin photo ${index + 1}` })), input.allowPhotoWarnings ?? false);
    if (preflight.error) return { result: null, error: preflight.error };
    await prepareCapturedImages(islamicCaptures(input.images ?? []), { tenantId: input.tenantId, nicheId: 'coins' });
    const originals: string[] = [];
    for (const uri of input.images ?? []) originals.push(await prepareImageForAI(uri));
    const { data, error } = await supabase.functions.invoke('swish-islamic-identify', {
      body: { images: originals, existingImageUrls: input.existingImageUrls, weight: input.weight, diameter: input.diameter, notes: input.notes, tenantId: input.tenantId, itemId: input.itemId, isBatch: false },
    });
    if (error) {
      let errorMessage = error.message;
      if (error instanceof FunctionsHttpError) {
        try {
          const statusCode = error.context?.status ?? 500;
          const textContent = await error.context?.text();
          try { const parsed = JSON.parse(textContent || '{}'); errorMessage = `[Code: ${statusCode}] ${parsed.error || textContent || error.message}`; }
          catch { errorMessage = `[Code: ${statusCode}] ${textContent || error.message}`; }
        } catch { errorMessage = error.message; }
      }
      return { result: null, error: errorMessage };
    }
    return { result: data.identification as IslamicIdentificationResult, error: null };
  } catch (e: any) { return { result: null, error: e.message ?? 'Unknown error' }; }
}
export async function processIslamicBatch(items: IslamicBatchItem[], tenantId: string, onProgress: (processed: number, total: number, currentItem: IslamicBatchItem) => void, signal?: AbortSignal): Promise<IslamicBatchResult> {
  const results: IslamicBatchItem[] = [];
  let succeeded = 0, failed = 0;
  for (let i = 0; i < items.length; i++) {
    if (signal?.aborted) break;
    const item = { ...items[i], status: 'processing' as const };
    onProgress(i, items.length, item);
    const { result, error } = await identifyIslamicSilver({ images: item.images, existingImageUrls: item.existingImageUrls, weight: item.weight, diameter: item.diameter, notes: item.notes, tenantId, itemId: item.itemId });
    if (error || !result) { results.push({ ...item, status: 'error', error: error ?? 'Identification failed' }); failed++; }
    else { results.push({ ...item, status: 'complete', result }); succeeded++; }
    onProgress(i + 1, items.length, results[results.length - 1]);
    if (i < items.length - 1) await new Promise(resolve => setTimeout(resolve, 800));
  }
  return {
    processed: results.length, succeeded, failed, items: results,
    specialistReviewRequired: results.filter(r => r.result?.batchFlags.requiresSpecialistReview || r.result?.batchFlags.workflowStatus === 'specialist_review'),
    moreInfoRequired: results.filter(r => r.result?.batchFlags.workflowStatus === 'more_info_required'),
    countermarked: results.filter(r => r.result?.countermark.status === 'confirmed' || r.result?.countermark.status === 'possible'),
    complete: results.filter(r => r.result?.batchFlags.workflowStatus === 'identification_complete'),
  };
}
export function getConfidenceColor(tier: IslamicIdentificationResult['confidenceTier']): string {
  switch (tier) { case 'high': return '#22C55E'; case 'medium': return '#F59E0B'; case 'low': return '#F97316'; case 'very_low': return '#EF4444'; case 'insufficient': return '#6B7280'; default: return '#6B7280'; }
}
export function getIdentificationStateLabel(state: IslamicIdentificationResult['identificationState']): string {
  switch (state) { case 'observation_only': return 'Observations Only'; case 'candidate': return 'Candidate (AI Only)'; case 'source_supported': return 'Source Supported'; case 'verified': return 'Verified'; default: return 'Unknown'; }
}
export function getCountermarkLabel(status: CountermarkAnalysis['status']): string {
  switch (status) { case 'confirmed': return 'Countermark Detected'; case 'possible': return 'Possible Countermark'; case 'none': return 'No Countermark'; case 'uncertain': return 'Countermark Uncertain'; default: return 'Not Assessed'; }
}
export function getWorkflowLabel(status: IslamicIdentificationResult['batchFlags']['workflowStatus']): string {
  switch (status) { case 'identification_complete': return 'Identification Complete'; case 'more_info_required': return 'More Info Required'; case 'specialist_review': return 'Specialist Review'; case 'low_commercial_priority': return 'Low Priority'; default: return 'Pending'; }
}
export function countZenoMatches(zenoSearch: ZenoSearchResult[]): number { return zenoSearch.filter(r => r.available && r.candidates.length > 0).length; }
export interface SaveIslamicItemOptions { weight?: number; diameter?: number; label?: string; notes?: string; acquisitionId?: string }
export interface SaveIslamicItemResult { itemId: string | null; mediaUrls: string[]; error: string | null }
async function uploadIslamicImages(itemId: string, localUris: string[]): Promise<string[]> {
  const upload = await uploadItemImages(itemId, islamicCaptures(localUris));
  if (upload.errors.length) throw new Error(upload.errors.join(' '));
  return upload.urls;
}
export async function saveIslamicCoinToInventory(tenantId: string, batchItem: IslamicBatchItem, options: SaveIslamicItemOptions = {}): Promise<SaveIslamicItemResult> {
  if (!batchItem.result) return { itemId: null, mediaUrls: [], error: 'No identification result to save' };
  const supabase = getSupabaseClient(), r = batchItem.result;
  const attributes: Record<string, any> = { ...r.attributes, specialist_id: 'islamic_silver', identification_state: r.identificationState, coin_family: r.coinFamily, object_type: r.objectType, countermark_detected: r.countermark.status !== 'none', countermark_status: r.countermark.status };
  if (r.countermark.status !== 'none') {
    if (r.countermark.description) attributes.countermark_description = r.countermark.description;
    if (r.countermark.possibleAuthority) attributes.countermark_authority = r.countermark.possibleAuthority;
    if (r.countermark.possibleRuler) attributes.countermark_ruler = r.countermark.possibleRuler;
    if (r.countermark.possibleDate) attributes.countermark_date = r.countermark.possibleDate;
    if (r.countermark.inscription) attributes.countermark_inscription = r.countermark.inscription;
  }
  if (r.hostCoin) {
    if (r.hostCoin.dynasty) attributes.host_coin_dynasty = r.hostCoin.dynasty;
    if (r.hostCoin.ruler) attributes.host_coin_ruler = r.hostCoin.ruler;
    if (r.hostCoin.denomination) attributes.host_coin_denomination = r.hostCoin.denomination;
    if (r.hostCoin.approximateDate) attributes.host_coin_date = r.hostCoin.approximateDate;
  }
  if (r.sourceEvidenceSummary.length > 0) attributes.source_evidence = r.sourceEvidenceSummary.slice(0, 5).join(' | ');
  if (r.zenoSearch.some(z => z.available && z.candidates.length > 0)) {
    attributes.zeno_searched = true;
    const topZeno = r.zenoSearch.flatMap(z => z.candidates).sort((a, b) => b.matchScore - a.matchScore)[0];
    if (topZeno && topZeno.matchScore >= 20) { attributes.zeno_reference = attributes.zeno_reference ?? topZeno.zenoId; attributes.zeno_url = attributes.zeno_url ?? topZeno.referenceUrl; attributes.zeno_title = attributes.zeno_title ?? topZeno.title; }
  }
  if (r.numistaSearch.available && r.numistaSearch.candidates.length > 0) {
    const topNumista = r.numistaSearch.candidates[0];
    if (topNumista.matchScore >= 20) { attributes.numista_candidate_id = attributes.numista_candidate_id ?? String(topNumista.typeId); attributes.numista_n = attributes.numista_n ?? topNumista.numistaN; attributes.numista_url = attributes.numista_url ?? topNumista.numistaUrl; }
  }
  const weightGrams = options.weight ?? batchItem.weight, diameterMm = options.diameter ?? batchItem.diameter;
  if (weightGrams) attributes.weight_grams = weightGrams;
  if (diameterMm) attributes.diameter_mm = diameterMm;
  const status = r.batchFlags.workflowStatus === 'more_info_required' || r.confidence < 0.35 ? 'review_required' : 'identified';
  const insertPayload: Record<string, any> = {
    tenant_id: tenantId, canonical_title: r.canonicalTitle, specialist_id: 'islamic_silver', status, disposition_decision: 'pending', identification_confidence: r.confidence,
    identification_source: r.identificationState === 'source_supported' || r.identificationState === 'verified' ? 'verified' : 'detected',
    condition: r.observations.condition || '', condition_grade: r.observations.conditionGrade ?? '', condition_notes: r.observations.conditionNotes || '', attributes, warnings: r.warnings,
    tags: ['islamic_silver', r.coinFamily?.toLowerCase().replace(/\s+/g, '_') ?? 'unclassified'].filter(Boolean), media: [], valuation_low: 0, valuation_mid: 0, valuation_high: 0,
    valuation_confidence: 'low', expected_selling_price: 0, expected_net: 0, expected_profit: 0, description: options.notes ?? batchItem.notes ?? '', custom_notes: options.label ?? batchItem.label ?? '',
  };
  if (r.candidates[0]?.ruler) insertPayload.ruler = r.candidates[0].ruler;
  if (r.candidates[0]?.denomination) insertPayload.denomination = r.candidates[0].denomination;
  if (r.candidates[0]?.mint) insertPayload.mint = r.candidates[0].mint;
  if (r.approximateDate) insertPayload.period = r.approximateDate;
  if (weightGrams) insertPayload.weight_grams = weightGrams;
  if (diameterMm) insertPayload.diameter_mm = diameterMm;
  const { data, error: insertError } = batchItem.itemId
    ? await supabase.from('items').select('id').eq('id', batchItem.itemId).eq('tenant_id', tenantId).eq('specialist_id', 'islamic_silver').single()
    : await supabase.from('items').insert(insertPayload).select('id').single();
  if (insertError || !data) return { itemId: null, mediaUrls: [], error: insertError?.message ?? 'Insert failed' };
  const itemId = data.id as string;
  batchItem.itemId = itemId;
  const allImageUris = [...(batchItem.images ?? []), ...(batchItem.existingImageUrls ?? [])].filter(Boolean);
  let mediaUrls: string[] = [];
  if (allImageUris.length > 0) {
    try { mediaUrls = await uploadIslamicImages(itemId, allImageUris); if (mediaUrls.length) await updateItemMedia(tenantId, itemId, mediaUrls); }
    catch (cause) { return { itemId, mediaUrls, error: `Inventory is saved; original images need retry. ${cause instanceof Error ? cause.message : 'Upload failed.'}` }; }
  }
  return { itemId, mediaUrls, error: null };
}
export interface BatchSaveProgress { saved: number; total: number; failed: number; currentLabel?: string }
export async function saveIslamicBatchToInventory(tenantId: string, items: IslamicBatchItem[], onProgress?: (progress: BatchSaveProgress) => void): Promise<{ savedIds: string[]; failed: number; errors: string[] }> {
  const eligibleItems = items.filter(i => i.status === 'complete' && i.result && !i.itemId);
  const savedIds: string[] = [], errors: string[] = [];
  let failed = 0;
  for (let i = 0; i < eligibleItems.length; i++) {
    const item = eligibleItems[i];
    onProgress?.({ saved: i, total: eligibleItems.length, failed, currentLabel: item.label ?? `Coin ${i + 1}` });
    const { itemId, error } = await saveIslamicCoinToInventory(tenantId, item, optionsForBatch());
    if (itemId) savedIds.push(itemId); else { failed++; errors.push(`${item.label ?? item.id}: ${error ?? 'Unknown error'}`); }
  }
  onProgress?.({ saved: savedIds.length, total: eligibleItems.length, failed });
  return { savedIds, failed, errors };
}
function optionsForBatch(): SaveIslamicItemOptions { return {}; }
