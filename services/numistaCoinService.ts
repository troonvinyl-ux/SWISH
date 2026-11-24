import { getSupabaseClient } from '@/template';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { normalizeNumistaNumber, readNumistaCoinReference, numistaCoinEntryIssue, makeCoinMeasurementReview, compareCoinMeasurements, type NumistaCoinReference } from '@/shared/numistaCoin';
import type { AIIdentificationResult, CapturedImage } from './aiIdentificationService';
import type { SpecialistId } from '@/constants/specialists';
import { preflightPhotos } from './photoQualityService';
import { prepareCapturedImages } from './sharedImagePreparationService';
import { getProductionNicheSpecialistIds } from './nicheRouting';
function numistaLookupMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return fallback;
  const row = payload as Record<string, unknown>;
  for (const value of [row.message, row.error]) {
    if (typeof value === 'string' && value.trim()) {
      // Explain a stale photo-only deployment instead of asking for images to load an N#.
      if (/at least one image is required/i.test(value)) return 'The server is treating this Numista lookup as photo identification. The SWISH identification gateway needs the catalogue-route update; your number and photos are retained.';
      return value.trim().slice(0, 500);
    }
  }
  return fallback;
}
/** Exact type lookup through the existing authenticated identification gateway. No client API key or AI lookup. */
export async function lookupNumistaCoin(tenantId: string, value: string): Promise<{ reference: NumistaCoinReference | null; error: string | null }> {
  const id = normalizeNumistaNumber(value);
  if (!tenantId || !id) return { reference: null, error: 'Enter a Numista N# number, for example N#274604.' };
  try {
    const { data, error } = await getSupabaseClient().functions.invoke('swish-identify', { body: { route: 'numista_type', tenantId, nicheId: 'coins', numistaId: id } });
    if (error) {
      let message = 'Numista reference lookup failed. Your photos are unchanged.';
      if (error instanceof FunctionsHttpError) {
        try { const text = await error.context.text(); message = numistaLookupMessage(JSON.parse(text), message); } catch { /* No gateway HTML or credentials. */ }
      }
      return { reference: null, error: message };
    }
    const reference = data?.reference as NumistaCoinReference | undefined;
    if (data?.error || !reference || reference.id !== id || typeof reference.title !== 'string' || !reference.title.trim() || !Number.isFinite(reference.fetchedAt)) return { reference: null, error: numistaLookupMessage(data, 'Numista returned no matching reference. Retry the same N# number.') };
    return { reference, error: null };
  } catch { return { reference: null, error: 'Numista could not be reached. Retry the same number; nothing was saved.' }; }
}
/** Seller-confirmed catalogue attribution, not an AI confidence/verification claim. */
export async function identifyCoinFromNumista(tenantId: string, specialistId: SpecialistId, images: CapturedImage[], answers: Record<string, string>, options: { allowPhotoWarnings?: boolean; presentationInParallel?: boolean } = {}): Promise<{ result: AIIdentificationResult | null; error: string | null }> {
  if (!tenantId || specialistId === 'banknotes' || !getProductionNicheSpecialistIds('coins').includes(specialistId)) return { result: null, error: 'Use a registered coin specialist for Numista number entry.' };
  const issue = numistaCoinEntryIssue(answers), reference = readNumistaCoinReference(answers);
  if (issue || !reference) return { result: null, error: issue ?? 'Load the Numista reference again.' };
  const obverse = images.find(image => /obverse|front/i.test(image.slotId)), reverse = images.find(image => /reverse|back/i.test(image.slotId));
  if (!obverse || !reverse || obverse.uri === reverse.uri) return { result: null, error: 'Add separate photographs of the actual coin obverse and reverse.' };
  const quality = await preflightPhotos(images, options.allowPhotoWarnings ?? false);
  if (quality.error) return { result: null, error: quality.error };
  if (!options.presentationInParallel) {
    const prepared = await prepareCapturedImages(images, { tenantId, nicheId: 'coins' });
    prepared.forEach((image, index) => Object.assign(images[index], image));
  }
  const review = makeCoinMeasurementReview(reference, answers), compared = compareCoinMeasurements(reference, answers.weight_g, answers.diameter_mm);
  const condition = answers._condition?.trim() || 'Used — seller to review wear, cleaning and damage';
  const conditionNotes = [`Actual coin weight: ${review.actualWeightGrams} g. Actual coin diameter: ${review.actualDiameterMm} mm.`, answers._condition_notes?.trim(), review.mismatchNotes ? `Measurement review: ${review.mismatchNotes}` : ''].filter(Boolean).join('\n');
  const fields: Record<string, string> = { catalogue_number: `N#${reference.id}`, weight_g: String(review.actualWeightGrams), diameter_mm: String(review.actualDiameterMm) };
  for (const key of ['denomination', 'ruler', 'mint', 'year', 'legend']) if (answers[key]?.trim()) fields[key] = answers[key].trim();
  return { error: null, result: {
    canonicalTitle: answers._title?.trim() || reference.title, specialistId, objectType: 'coin', identificationState: 'user_confirmed',
    confidence: 0, confidenceTier: 'unknown', confidenceReason: 'Numista type selected and physically reviewed by the seller. No automated accuracy or authenticity score was assigned.', identificationSource: 'user_confirmed',
    condition, conditionNotes, valuationLow: 0, valuationMid: 0, valuationHigh: 0, valuationConfidence: 'unknown', saleProb30d: null,
    attributes: { ...fields, supplied_weight_g: review.actualWeightGrams, supplied_diameter_mm: review.actualDiameterMm, numista_n: `N#${reference.id}`, numista_type_id: String(reference.id), numista_url: reference.url, _coin_measurement_review: review },
    attributesConfirmed: fields, attributesInferred: {}, evidenceSupporting: ['Seller confirmed both owned coin faces against the loaded Numista type.', `Seller measured weight ${review.actualWeightGrams} g.`, `Seller measured diameter ${review.actualDiameterMm} mm.`], evidenceContradictory: [],
    missingInformation: ['Authenticity, alloy, precise grade and unconfirmed date/mint/variety are not certified by a Numista type.'], warnings: [...compared.warnings, 'Catalogue match is seller-confirmed, not independent authentication.'],
    numistaN: `N#${reference.id}`, numistaTypeId: reference.id, numistaUrl: reference.url, numistaStatus: 'user_confirmed', suggestedDisposition: 'Review price, condition and the saved draft, then use List now on eBay.', dispositionDecision: 'sell_individual',
  } };
}
