// SWISH Valuation Guardrail Service
//
// PURPOSE:
//   Applies evidence-first guardrails to valuation results before they reach the UI.
//   Enforces:
//     1. Evidence provenance labelling — every source is explicitly classified
//     2. Evidence-gated valuation — insufficient/mismatched evidence blocks confident values
//     3. Identification/valuation confidence independence
//     4. Niche-specific quality rules
//     5. Active asking prices cannot substitute for verified sold prices
//
// This service is PURELY client-side validation — it does NOT call any APIs.
// It operates on MarketValueResult objects returned by getMarketValue().
//
// EVIDENCE CLASSES (A–E):
//   A. VERIFIED_SOLD     — Completed/sold marketplace transactions (eBay sold, Numista sales)
//   B. ACTIVE_ASKING     — Current marketplace asking/listing prices (NOT sold evidence)
//   C. REFERENCE_DATA    — Specialist catalogue/reference data (Numista type specs, etc.)
//   D. USER_PROVIDED     — Information the seller has directly supplied
//   E. AI_INFERENCE      — AI estimate or fallback — lowest evidential weight
//
// USAGE:
//   import { applyValuationGuardrails } from '@/services/valuationGuardrailService';
//   const guarded = applyValuationGuardrails(mvResult, { identificationConfidence: 0.75, specialistId: 'bicycles' });

import type { MarketValueResult, ValuationResult } from './marketValueService';

// ─────────────────────────────────────────────────────────────────────────────
// EVIDENCE PROVENANCE TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type EvidenceClass =
  | 'verified_sold'   // A: completed sale transactions
  | 'active_asking'   // B: current asking/listing prices
  | 'reference_data'  // C: catalogue / specialist reference
  | 'user_provided'   // D: seller-supplied information
  | 'ai_inference';   // E: AI estimate / fallback

export interface EvidenceSource {
  class: EvidenceClass;
  label: string;
  count: number;
  source: string;
  note: string;
  /** Whether this source was used in the final valuation calculation */
  usedInValuation: boolean;
  /** Whether this source was excluded from valuation and why */
  exclusionReason?: string;
}

export interface EvidenceProvenanceReport {
  sources: EvidenceSource[];
  primaryEvidenceClass: EvidenceClass | null;
  valuationSupportedByVerifiedSold: boolean;
  totalVerifiedSoldCount: number;
  totalRelevantVerifiedSold: number;
  hasActiveAskingPrices: boolean;
  hasReferenceData: boolean;
  activeAskingUsedAsProxy: boolean; // MUST always be false — guardrail violation detector
  summary: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// GUARDRAIL RESULT
// ─────────────────────────────────────────────────────────────────────────────

export type GuardrailDecision =
  | 'pass'              // Evidence meets quality thresholds — valuation is defensible
  | 'downgraded'        // Valuation retained but confidence reduced
  | 'range_only'        // Only a low/high range is defensible, not a precise mid
  | 'insufficient'      // Evidence is insufficient — no confident value can be stated
  | 'identification_conflict'; // ID confidence too low to support this valuation confidence

export interface ValuationGuardrailResult {
  /** Original result — unmodified */
  original: MarketValueResult;
  /** Guardrail decision */
  decision: GuardrailDecision;
  /** Final valuation after guardrail adjustments */
  guardedValuation: ValuationResult;
  /** Evidence provenance for the UI audit trail */
  evidenceProvenance: EvidenceProvenanceReport;
  /** Reasons for any downgrade/block */
  guardrailReasons: string[];
  /** Whether identification confidence limits the valuation confidence */
  identificationLimitsValuation: boolean;
  /** The effective valuation confidence after applying all guardrails */
  effectiveConfidence: string;
  /** Recommended UI treatment */
  displayMode: 'full' | 'indicative' | 'range' | 'no_data' | 'ask_only';
}

// ─────────────────────────────────────────────────────────────────────────────
// NICHE-SPECIFIC QUALITY RULES
// ─────────────────────────────────────────────────────────────────────────────

interface NicheQualityRule {
  minRelevantSoldForWeak: number;
  minRelevantSoldForModerate: number;
  minRelevantSoldForStrong: number;
  /** Can valuation proceed with zero sold but reference data? */
  allowReferenceOnlyValuation: boolean;
  /** Penalty applied when ID confidence < this threshold */
  idConfidencePenaltyThreshold: number;
  /** Max valuation confidence allowed when ID confidence is below threshold */
  maxConfidenceWhenIdLow: string;
}

const NICHE_QUALITY_RULES: Record<string, NicheQualityRule> = {
  coins: {
    minRelevantSoldForWeak: 1,
    minRelevantSoldForModerate: 3,
    minRelevantSoldForStrong: 8,
    allowReferenceOnlyValuation: false, // Numista specs ≠ market prices
    idConfidencePenaltyThreshold: 0.50,
    maxConfidenceWhenIdLow: 'low',
  },
  islamic_silver: {
    minRelevantSoldForWeak: 1,
    minRelevantSoldForModerate: 2,
    minRelevantSoldForStrong: 5,
    allowReferenceOnlyValuation: false,
    idConfidencePenaltyThreshold: 0.45,
    maxConfidenceWhenIdLow: 'very_low',
  },
  motocross: {
    minRelevantSoldForWeak: 2,
    minRelevantSoldForModerate: 4,
    minRelevantSoldForStrong: 8,
    allowReferenceOnlyValuation: false,
    idConfidencePenaltyThreshold: 0.55,
    maxConfidenceWhenIdLow: 'low',
  },
  bicycles: {
    minRelevantSoldForWeak: 2,
    minRelevantSoldForModerate: 4,
    minRelevantSoldForStrong: 8,
    allowReferenceOnlyValuation: false,
    idConfidencePenaltyThreshold: 0.55,
    maxConfidenceWhenIdLow: 'low',
  },
  clothing: {
    minRelevantSoldForWeak: 2,
    minRelevantSoldForModerate: 5,
    minRelevantSoldForStrong: 10,
    allowReferenceOnlyValuation: false,
    idConfidencePenaltyThreshold: 0.50,
    maxConfidenceWhenIdLow: 'low',
  },
  trainers_sneakers: {
    minRelevantSoldForWeak: 2,
    minRelevantSoldForModerate: 5,
    minRelevantSoldForStrong: 10,
    allowReferenceOnlyValuation: false,
    idConfidencePenaltyThreshold: 0.50,
    maxConfidenceWhenIdLow: 'low',
  },
  default: {
    minRelevantSoldForWeak: 1,
    minRelevantSoldForModerate: 3,
    minRelevantSoldForStrong: 7,
    allowReferenceOnlyValuation: false,
    idConfidencePenaltyThreshold: 0.50,
    maxConfidenceWhenIdLow: 'low',
  },
};

function getNicheRule(specialistId: string): NicheQualityRule {
  return NICHE_QUALITY_RULES[specialistId] ?? NICHE_QUALITY_RULES['default'];
}

// ─────────────────────────────────────────────────────────────────────────────
// CONFIDENCE ORDERING
// ─────────────────────────────────────────────────────────────────────────────

const CONFIDENCE_ORDER: Record<string, number> = {
  high: 5,
  medium: 4,
  low: 3,
  very_low: 2,
  insufficient_data: 1,
  unknown: 0,
};

function lowerConfidence(a: string, b: string): string {
  const aScore = CONFIDENCE_ORDER[a] ?? 0;
  const bScore = CONFIDENCE_ORDER[b] ?? 0;
  return aScore <= bScore ? a : b;
}

function confidenceFromCount(
  relevantCount: number,
  rule: NicheQualityRule,
): string {
  if (relevantCount >= rule.minRelevantSoldForStrong) return 'high';
  if (relevantCount >= rule.minRelevantSoldForModerate) return 'medium';
  if (relevantCount >= rule.minRelevantSoldForWeak) return 'low';
  return 'insufficient_data';
}

// ─────────────────────────────────────────────────────────────────────────────
// EVIDENCE PROVENANCE BUILDER
// ─────────────────────────────────────────────────────────────────────────────

function buildEvidenceProvenance(
  result: MarketValueResult,
  specialistId: string,
): EvidenceProvenanceReport {
  const sources: EvidenceSource[] = [];

  // ── A: Verified sold — eBay ────────────────────────────────────────────────
  const ebaySoldTotal = result.soldMarket?.verifiedSoldCount ?? 0;
  const ebaySoldRelevant = result.soldMarket?.relevantSoldCount ?? 0;
  const ebaySoldExcluded = result.soldMarket?.excludedSoldCount ?? (ebaySoldTotal - ebaySoldRelevant);

  sources.push({
    class: 'verified_sold',
    label: 'eBay Verified Sold',
    count: ebaySoldTotal,
    source: 'eBay Finding API (findCompletedItems, SoldItemsOnly=true)',
    note: ebaySoldRelevant > 0
      ? `${ebaySoldRelevant} relevant of ${ebaySoldTotal} found (${ebaySoldExcluded} excluded by relevance scoring)`
      : ebaySoldTotal > 0
        ? `${ebaySoldTotal} sold listings found but NONE were relevant — too dissimilar to target item`
        : 'No completed/sold eBay listings found for this item',
    usedInValuation: ebaySoldRelevant > 0,
    exclusionReason: ebaySoldRelevant === 0 && ebaySoldTotal > 0
      ? 'All found listings scored below relevance threshold — wrong denomination, brand, model, or type'
      : ebaySoldTotal === 0
        ? 'No eBay sold listings returned for this search'
        : undefined,
  });

  // ── A: Verified sold — Numista sales records ───────────────────────────────
  const numistaSalesAvailable = result.numistaSales?.available === true;
  const numistaSalesRelevant = result.numistaSales?.relevantCount ?? 0;
  const numistaSalesTotal = result.numistaSales?.totalFetched ?? 0;
  const numistaSalesError = result.numistaSales?.error;

  if (result.numistaSales !== null && result.numistaSales !== undefined) {
    sources.push({
      class: 'verified_sold',
      label: 'Numista Sales Records',
      count: numistaSalesTotal,
      source: 'Numista API /types/{id}/sales_records',
      note: numistaSalesError
        ? `Numista sales unavailable: ${numistaSalesError}`
        : numistaSalesAvailable && numistaSalesRelevant > 0
          ? `${numistaSalesRelevant} relevant of ${numistaSalesTotal} fetched — auction house and collector sales`
          : numistaSalesAvailable
            ? 'Numista sales found but none relevant after condition filtering'
            : 'Numista sales records not retrieved (type not verified or API plan limitation)',
      usedInValuation: numistaSalesAvailable && numistaSalesRelevant > 0 && !numistaSalesError,
      exclusionReason: numistaSalesError
        ? numistaSalesError
        : numistaSalesAvailable && numistaSalesRelevant === 0
          ? 'No sales matched condition filter'
          : !numistaSalesAvailable
            ? 'Numista type not verified or sales API unavailable'
            : undefined,
    });
  }

  // ── B: Active asking prices ────────────────────────────────────────────────
  const activeCount = result.activeAskingPrices?.count ?? 0;
  const activeRelevant = result.activeAskingPrices?.relevantCount ?? 0;

  sources.push({
    class: 'active_asking',
    label: 'eBay Active Asking Prices',
    count: activeCount,
    source: 'eBay Browse API (active listings — NOT sold)',
    note: activeCount > 0
      ? `${activeCount} active listings at median £${result.activeAskingPrices?.medianAskingPrice ?? 0} — ASKING PRICES ONLY, not used in valuation`
      : 'No active listings found',
    usedInValuation: false, // NEVER used in valuation — rule enforced here
    exclusionReason: 'Active asking prices are NOT verified sold prices. They are displayed for market context only and are explicitly excluded from valuation calculations.',
  });

  // ── C: Reference data — Numista type specification ─────────────────────────
  if (result.numista !== null && result.numista !== undefined) {
    const accepted = result.numista.accepted === true;
    sources.push({
      class: 'reference_data',
      label: 'Numista Type Specification',
      count: 1,
      source: `Numista catalogue — ${result.numista.numistaN ?? 'unknown'}`,
      note: accepted
        ? `Verified type match (score ${result.numista.matchScore}/100) — specification data (weight, diameter, composition, issue range). NOTE: Type specs are catalogue reference, NOT market prices.`
        : `Candidate type match (score ${result.numista.matchScore}/100) — not fully confirmed. Specification data treated as indicative only.`,
      usedInValuation: false, // Numista SPECS are not used in valuation directly — only Numista SALES are
      exclusionReason: 'Numista type specification provides identification reference and physical specs, not realised market prices. Only Numista sales records are used in valuation.',
    });
  }

  // ── E: AI inference ────────────────────────────────────────────────────────
  // The valuation engine is deterministic once data is loaded; however the
  // identification that drives the search is AI-produced. We document this.
  const totalVerifiedSold = ebaySoldRelevant + (numistaSalesRelevant > 0 ? numistaSalesRelevant : 0);
  if (totalVerifiedSold === 0) {
    sources.push({
      class: 'ai_inference',
      label: 'AI Fallback',
      count: 0,
      source: 'No verified sold data available',
      note: 'No verified sold comparables were found. Any valuation shown is based on insufficient evidence and should not be treated as a market price.',
      usedInValuation: false,
      exclusionReason: 'AI inference is not used as a substitute for verified sold data in SWISH v3+.',
    });
  }

  const isCoin = ['coins', 'islamic_silver', 'banknotes', 'gold', 'silver', 'ancient_artefacts'].includes(specialistId);

  const primarySource = sources.find(s =>
    s.class === 'verified_sold' && s.usedInValuation && s.count > 0,
  );

  const totalRelevantVerifiedSold = ebaySoldRelevant + (numistaSalesRelevant > 0 ? numistaSalesRelevant : 0);

  // Safety check: active asking prices must NEVER be used as proxy
  const activeUsedAsProxy = false; // Structural guarantee — never set to true

  let summary: string;
  if (totalRelevantVerifiedSold >= 8) {
    summary = `Strong evidence: ${totalRelevantVerifiedSold} verified sold comparables`;
  } else if (totalRelevantVerifiedSold >= 3) {
    summary = `Moderate evidence: ${totalRelevantVerifiedSold} verified sold comparables`;
  } else if (totalRelevantVerifiedSold >= 1) {
    summary = `Weak evidence: only ${totalRelevantVerifiedSold} verified sold comparable${totalRelevantVerifiedSold === 1 ? '' : 's'} — treat valuation as indicative`;
  } else if (activeCount > 0) {
    summary = `No verified sold data — ${activeCount} active asking prices exist but are NOT used in valuation`;
  } else {
    summary = 'No comparable sold data found — valuation cannot be established';
  }

  return {
    sources,
    primaryEvidenceClass: primarySource ? 'verified_sold' : totalRelevantVerifiedSold === 0 && activeCount > 0 ? 'active_asking' : null,
    valuationSupportedByVerifiedSold: totalRelevantVerifiedSold > 0,
    totalVerifiedSoldCount: ebaySoldTotal + numistaSalesTotal,
    totalRelevantVerifiedSold,
    hasActiveAskingPrices: activeCount > 0,
    hasReferenceData: result.numista !== null && result.numista !== undefined,
    activeAskingUsedAsProxy: activeUsedAsProxy,
    summary,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN GUARDRAIL FUNCTION
// ─────────────────────────────────────────────────────────────────────────────

export interface GuardrailOptions {
  /**
   * Identification confidence from swish-identify (0–1).
   * This is INDEPENDENT from valuation confidence.
   * A low ID confidence can limit valuation confidence even if sold data is strong.
   */
  identificationConfidence: number;
  /** Specialist ID for niche-specific rules */
  specialistId: string;
  /**
   * Whether to show asking-price-only guidance when no sold data exists.
   * Default: true
   */
  showAskingPriceGuidance?: boolean;
}

export function applyValuationGuardrails(
  result: MarketValueResult,
  options: GuardrailOptions,
): ValuationGuardrailResult {
  const {
    identificationConfidence,
    specialistId,
    showAskingPriceGuidance = true,
  } = options;

  const rule = getNicheRule(specialistId);
  const provenance = buildEvidenceProvenance(result, specialistId);
  const reasons: string[] = [];

  // ── 1. Count relevant verified sold evidence ──────────────────────────────
  const relevantSold = provenance.totalRelevantVerifiedSold;
  const originalValuation = result.valuation;
  const originalConfidence = originalValuation?.valuationConfidence ?? 'insufficient_data';

  // ── 2. Evidence-gated valuation ───────────────────────────────────────────
  // Determine the maximum confidence supportable by the sold evidence alone
  const evidenceSupportedConfidence = confidenceFromCount(relevantSold, rule);

  // ── 3. Identification / valuation confidence independence ─────────────────
  // ID confidence and valuation confidence are COMPLETELY INDEPENDENT dimensions.
  // A strong image match does not validate market comparables.
  // Weak ID confidence limits the confidence we can attach to a market value
  // because the search query itself may not represent the actual item.
  let idLimitedConfidence: string = evidenceSupportedConfidence;
  const idLimitsValuation = identificationConfidence < rule.idConfidencePenaltyThreshold;

  if (idLimitsValuation) {
    idLimitedConfidence = lowerConfidence(evidenceSupportedConfidence, rule.maxConfidenceWhenIdLow);
    reasons.push(
      `Identification confidence (${Math.round(identificationConfidence * 100)}%) is below the ` +
      `${Math.round(rule.idConfidencePenaltyThreshold * 100)}% threshold for this niche. ` +
      `Valuation confidence capped at "${rule.maxConfidenceWhenIdLow}" — the item match is uncertain, ` +
      `so search results may not represent this specific item.`,
    );
  }

  // ── 4. Active asking prices must NEVER substitute for sold prices ─────────
  // This is a structural rule that the edge function also enforces, but we
  // re-validate it here as defence-in-depth.
  if (provenance.activeAskingUsedAsProxy) {
    // This should never trigger given the structural guarantee, but document it
    reasons.push(
      'GUARDRAIL VIOLATION DETECTED: Active asking prices were marked as used in valuation. ' +
      'This is not permitted — asking prices ≠ verified sold prices. Valuation blocked.',
    );
  }

  const activeAskingMedian = result.activeAskingPrices?.medianAskingPrice ?? 0;
  const activeAskingCount = result.activeAskingPrices?.count ?? 0;

  // ── 5. Numista reference data cannot substitute for sold data ─────────────
  const hasNumistaTypeOnly = provenance.hasReferenceData && !provenance.valuationSupportedByVerifiedSold;
  if (hasNumistaTypeOnly && !rule.allowReferenceOnlyValuation) {
    reasons.push(
      'Numista catalogue specifications (weight, diameter, composition, issue range) are reference data only. ' +
      'They are NOT market prices. A Numista type match does not establish realised market value.',
    );
  }

  // ── 6. Determine final effective confidence ───────────────────────────────
  // Min of: original server-computed confidence, evidence-supported confidence, id-limited confidence
  const effectiveConfidence = lowerConfidence(
    lowerConfidence(originalConfidence, evidenceSupportedConfidence),
    idLimitedConfidence,
  );

  if (effectiveConfidence !== originalConfidence) {
    reasons.push(
      `Valuation confidence downgraded from "${originalConfidence}" to "${effectiveConfidence}" ` +
      `by guardrail evaluation (evidence count: ${relevantSold}, ID confidence: ${Math.round(identificationConfidence * 100)}%).`,
    );
  }

  // ── 7. Determine guardrail decision ──────────────────────────────────────
  let decision: GuardrailDecision;
  let displayMode: ValuationGuardrailResult['displayMode'];

  if (effectiveConfidence === 'insufficient_data' || relevantSold === 0) {
    if (activeAskingCount > 0 && showAskingPriceGuidance) {
      decision = 'insufficient';
      displayMode = 'ask_only';
      reasons.push(
        `No verified sold data was found. ${activeAskingCount} active asking prices exist at ` +
        `median £${activeAskingMedian}, shown for context only. ` +
        'These are NOT sold prices and should NOT be used as the sole basis for pricing.',
      );
    } else {
      decision = 'insufficient';
      displayMode = 'no_data';
      reasons.push('No verified sold comparables found and no active asking prices available. Market value cannot be established.');
    }
  } else if (idLimitsValuation && identificationConfidence < 0.30) {
    decision = 'identification_conflict';
    displayMode = 'indicative';
    reasons.push(
      `Very low identification confidence (${Math.round(identificationConfidence * 100)}%) means ` +
      'the market comparables may not represent this item at all. ' +
      'The valuation range is shown as highly indicative only.',
    );
  } else if (effectiveConfidence !== originalConfidence) {
    decision = 'downgraded';
    displayMode = relevantSold >= rule.minRelevantSoldForWeak ? 'indicative' : 'range';
  } else if (effectiveConfidence === 'low' || effectiveConfidence === 'very_low') {
    decision = 'downgraded';
    displayMode = 'indicative';
  } else {
    decision = 'pass';
    displayMode = 'full';
  }

  // ── 8. Build guarded valuation ─────────────────────────────────────────────
  // We apply the effective confidence and add any guardrail warnings to the
  // existing warnings array — we never modify prices since those come from
  // real market data.
  const guardedWarnings = [
    ...(originalValuation?.valuationWarnings ?? []),
    ...reasons,
  ];

  // When decision is 'insufficient' or 'identification_conflict', zero out
  // the recommended listing price to prevent it being used as a market price
  const guardedRecommendedPrice =
    (decision === 'insufficient' || decision === 'identification_conflict')
      ? 0
      : (originalValuation?.recommendedListingPrice ?? 0);

  const guardedListingRationale =
    decision === 'insufficient'
      ? `Insufficient verified sold data — no listing price recommendation. ${provenance.summary}`
      : decision === 'identification_conflict'
        ? `Identification confidence too low (${Math.round(identificationConfidence * 100)}%) to support listing price recommendation.`
        : originalValuation?.listingPriceRationale ?? '';

  const guardedValuation: ValuationResult = {
    ...(originalValuation ?? {
      valuationLow: 0,
      valuationMid: 0,
      valuationHigh: 0,
      valuationMethod: 'no_data',
      fairMarketValue: 0,
      currentAskingMarketMid: activeAskingMedian,
      recommendedListingFormat: 'BuyItNow',
      auctionStartPrice: undefined,
      saleProb30d: null,
    }),
    valuationConfidence: effectiveConfidence,
    valuationWarnings: guardedWarnings,
    recommendedListingPrice: guardedRecommendedPrice,
    listingPriceRationale: guardedListingRationale,
    // currentAskingMarketMid is preserved for display — it is never used in valuation
    currentAskingMarketMid: activeAskingMedian,
  };

  return {
    original: result,
    decision,
    guardedValuation,
    evidenceProvenance: provenance,
    guardrailReasons: reasons,
    identificationLimitsValuation: idLimitsValuation,
    effectiveConfidence,
    displayMode,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// UTILITY: Human-readable evidence summary for UI
// ─────────────────────────────────────────────────────────────────────────────

export function getEvidenceSummaryLabel(provenance: EvidenceProvenanceReport): string {
  const { totalRelevantVerifiedSold, hasActiveAskingPrices, activeAskingUsedAsProxy } = provenance;

  if (activeAskingUsedAsProxy) {
    return 'Warning: asking prices used as sold data — unreliable';
  }
  if (totalRelevantVerifiedSold >= 10) return `${totalRelevantVerifiedSold} verified sales`;
  if (totalRelevantVerifiedSold >= 5) return `${totalRelevantVerifiedSold} verified sales`;
  if (totalRelevantVerifiedSold >= 3) return `${totalRelevantVerifiedSold} verified sales — moderate evidence`;
  if (totalRelevantVerifiedSold === 2) return '2 verified sales — weak evidence';
  if (totalRelevantVerifiedSold === 1) return '1 verified sale — very weak evidence';
  if (hasActiveAskingPrices) return 'Asking prices only — no sold data';
  return 'No comparable data found';
}

export function getEvidenceClassLabel(cls: EvidenceClass): string {
  switch (cls) {
    case 'verified_sold': return 'Verified sold transaction';
    case 'active_asking': return 'Active asking price (not sold)';
    case 'reference_data': return 'Catalogue/reference data';
    case 'user_provided':  return 'User-supplied information';
    case 'ai_inference':   return 'AI inference/estimate';
    default: return 'Unknown evidence class';
  }
}
