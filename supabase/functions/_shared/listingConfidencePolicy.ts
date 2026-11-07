import { specialistNiche } from './specialistRegistry.ts';
import { getNicheWorkflowPolicy } from './nichePolicy.ts';
export interface ListingConfidenceGateResult {
  allowed: boolean;
  specialistId: string;
  confidence: number;
  threshold: number;
  code?: 'IDENTIFICATION_REVIEW_REQUIRED' | 'COIN_CONFIDENCE_BELOW_THRESHOLD';
  reason?: string;
}

// Registry ownership and shared workflow policy replace an independent specialist allow-list.

/**
 * Server-side eBay publish policy. Coin listings require >=95% identification
 * confidence; observation-only records cannot be published in any niche.
 * Provisional non-coin identifications retain their disclosure flow.
 */
export function assessListingConfidence(
  specialistIdInput: unknown,
  confidenceInput: unknown,
  identificationStateInput: unknown,
): ListingConfidenceGateResult {
  const specialistId = String(specialistIdInput ?? '').trim().toLowerCase();
  const parsed = Number(confidenceInput ?? 0);
  const confidence = Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : 0;
  const state = String(identificationStateInput ?? '').trim().toLowerCase();
  const nicheId = specialistNiche(specialistId);
  const isCoin = nicheId === 'coins';
  const threshold = getNicheWorkflowPolicy(nicheId ?? '')?.publicationMinimum ?? 0.30;

  if (state === 'observation_only') {
    return {
      allowed: false, specialistId, confidence, threshold,
      code: 'IDENTIFICATION_REVIEW_REQUIRED',
      reason: 'This item is observation-only. Add clearer evidence and complete identification before publishing to eBay.',
    };
  }
  if (isCoin && confidence < threshold) {
    return {
      allowed: false, specialistId, confidence, threshold,
      code: 'COIN_CONFIDENCE_BELOW_THRESHOLD',
      reason: 'Coin identification must reach at least 95% confidence before it can be published to eBay. Re-identify with clearer photographs or complete specialist review.',
    };
  }
  if (!isCoin && confidence < threshold) {
    return {
      allowed: false, specialistId, confidence, threshold,
      code: 'IDENTIFICATION_REVIEW_REQUIRED',
      reason: 'Identification confidence is too low for eBay publication. Add clearer evidence and review the identification first.',
    };
  }
  return { allowed: true, specialistId, confidence, threshold };
}
