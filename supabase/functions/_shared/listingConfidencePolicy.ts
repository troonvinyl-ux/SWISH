import { specialistNiche } from './specialistRegistry.ts';
export interface ListingConfidenceGateResult {
 allowed: boolean; specialistId: string; confidence: number; threshold: number;
 code?: 'REGISTERED_SPECIALIST_REQUIRED'; reason?: string;
 advisory?: string;
}
/** AI certainty is information, not permission to sell. Real eligibility, seller
 * fields, photos, account authorization and duplicate prevention remain separate. */
export function assessListingConfidence(specialistIdInput: unknown, confidenceInput: unknown, identificationStateInput: unknown): ListingConfidenceGateResult {
 const specialistId = String(specialistIdInput ?? '').trim().toLowerCase();
 const parsed = Number(confidenceInput ?? 0);
 const confidence = Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : 0;
 const state = String(identificationStateInput ?? '').trim().toLowerCase();
 if (!specialistNiche(specialistId)) return { allowed: false, specialistId, confidence, threshold: 0, code: 'REGISTERED_SPECIALIST_REQUIRED', reason: 'This item needs a registered specialist workspace. Reopen its original niche; no eBay request was sent.' };
 return { allowed: true, specialistId, confidence, threshold: 0,
  ...(confidence < 0.95 || state === 'observation_only' ? { advisory: `AI identification confidence ${Math.round(confidence * 100)}% is advisory only. Review factual listing claims and disclose uncertain attribution; no higher model score is required.` } : {}) };
}
