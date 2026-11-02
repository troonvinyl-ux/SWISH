// SWISH Profit Engine — Canonical Commercial Calculations
//
// THE SINGLE SOURCE OF TRUTH for all profit, ROI, margin, and fee calculations.
// Every screen that shows financial data MUST use these functions.
//
// Design principles:
//  - Always distinguishes ESTIMATED vs ACTUAL
//  - Carries confidence level and data sources
//  - Versioned for historical reproducibility (MODEL_VERSION)
//  - Never fabricates data — missing inputs are explicit nulls
//  - Fee calculations are category/marketplace-aware where possible

// ── Model version — increment when calculation changes ───────────────────────
export const PROFIT_ENGINE_VERSION = 'v1.3';

// ── eBay UK Fee Structure (2025) ─────────────────────────────────────────────
// Source: ebay.co.uk/help/selling/fees-credits-invoices/selling-fees
// These are best-available public rates. Always label as estimates.

interface EbayFeeRate {
  categoryHint: string;
  finalValueFee: number;
  fixedFee: number;
  fixedFeeUnderThreshold: number;
  fixedFeeThreshold: number;
  regulatoryOperatingFee: number;
  internationalFeeExtra: number;
  insertionFeePerMonth: number;
  tierThreshold?: number;
  aboveThresholdRate?: number;
  highValueThreshold?: number;
  highValueRate?: number;
}

// eBay UK business-seller rates, checked against the official fee table
// last updated 30 September 2026. Fees exclude VAT on the fee itself.
// The seller's actual category, shop terms, performance surcharges, VAT and
// international destination can change the result; estimates must stay labelled.
const EBAY_UK_FEE_DEFAULTS: EbayFeeRate = {
  categoryHint: 'general',
  finalValueFee: 0.129,       // Everything Else / Wholesale & Job Lots
  fixedFee: 0.40,             // orders over £10
  fixedFeeUnderThreshold: 0.30,
  fixedFeeThreshold: 10,
  regulatoryOperatingFee: 0.0035,
  internationalFeeExtra: 0,
  insertionFeePerMonth: 0,    // listing/shop fees are not transaction profit fees
};

const EBAY_CATEGORY_FEE_OVERRIDES: Record<string, Partial<EbayFeeRate>> = {
  coins: { finalValueFee: 0.109, categoryHint: 'coins', tierThreshold: 450, aboveThresholdRate: 0.03 },
  coins_uk: { finalValueFee: 0.109, categoryHint: 'coins', tierThreshold: 450, aboveThresholdRate: 0.03 },
  coins_world: { finalValueFee: 0.109, categoryHint: 'coins', tierThreshold: 450, aboveThresholdRate: 0.03 },
  coins_currency: { finalValueFee: 0.109, categoryHint: 'coins', tierThreshold: 450, aboveThresholdRate: 0.03 },
  islamic_silver: { finalValueFee: 0.109, categoryHint: 'coins', tierThreshold: 450, aboveThresholdRate: 0.03 },
  banknotes: { finalValueFee: 0.109, categoryHint: 'coins', tierThreshold: 450, aboveThresholdRate: 0.03 },
  gold: { finalValueFee: 0.109, categoryHint: 'coins', tierThreshold: 450, aboveThresholdRate: 0.03 },
  silver: { finalValueFee: 0.109, categoryHint: 'coins', tierThreshold: 450, aboveThresholdRate: 0.03 },
  ancient_artefacts: { finalValueFee: 0.109, categoryHint: 'collectables' },
  trading_cards: { finalValueFee: 0.109, categoryHint: 'collectables' },
  antiques: { finalValueFee: 0.109, categoryHint: 'antiques' },
  books: { finalValueFee: 0.099, categoryHint: 'books' },
  clothing: { finalValueFee: 0.119, categoryHint: 'clothing' },
  trainers_sneakers: { finalValueFee: 0.119, categoryHint: 'clothing / trainers', highValueThreshold: 100, highValueRate: 0.07 },
  beauty: { finalValueFee: 0.109, categoryHint: 'health and beauty' },
  tech: { finalValueFee: 0.099, categoryHint: 'computers / sound and vision' },
  bicycles: { finalValueFee: 0.109, categoryHint: 'sporting goods' },
  fossils: { finalValueFee: 0.109, categoryHint: 'collectables' },
  surplus_flip: { finalValueFee: 0.129, categoryHint: 'wholesale and job lots' },
  motocross: { finalValueFee: 0.129, categoryHint: 'general / motorsport item; verify leaf category' },
  stamps: { finalValueFee: 0.109, categoryHint: 'stamps' },
  jewellery: { finalValueFee: 0.149, categoryHint: 'jewellery', tierThreshold: 1000, aboveThresholdRate: 0.04 },
  jewellery_precious_metals: { finalValueFee: 0.149, categoryHint: 'jewellery', tierThreshold: 1000, aboveThresholdRate: 0.04 },
  watches: { finalValueFee: 0.129, categoryHint: 'watches', tierThreshold: 750, aboveThresholdRate: 0.03 },
  retro_games: { finalValueFee: 0.099, categoryHint: 'video games' },
  retro_consoles: { finalValueFee: 0.069, categoryHint: 'video game consoles', tierThreshold: 400, aboveThresholdRate: 0.02 },
  surplus_trader: { finalValueFee: 0.129, categoryHint: 'wholesale and job lots' },
};

export function getEbayFeeRate(specialistId?: string): EbayFeeRate {
  const override = specialistId ? EBAY_CATEGORY_FEE_OVERRIDES[specialistId] : undefined;
  return { ...EBAY_UK_FEE_DEFAULTS, ...(override ?? {}) };
}

// ── Core Profit Calculation ────────────────────────────────────────────────────

export interface ProfitInputs {
  salePrice: number;
  acquisitionCost: number;
  shippingCost?: number;         // postage cost paid by seller
  shippingRevenue?: number;      // postage/handling paid by buyer; included in eBay fee base and revenue
  packagingCost?: number;
  marketplaceFee?: number;        // if known exactly (e.g., from eBay financial API)
  marketplaceFeeRate?: number;    // 0-1, overrides the category final-value percentage only
  ebaySellerType?: 'business' | 'private'; // defaults to UK business estimate; private UK domestic sales have no final-value fee
  isInternationalSale?: boolean; // UK private sellers pay 3% on overseas delivery; business rates depend on destination
  internationalFeeRate?: number; // explicit destination-specific international rate for business/private estimates
  regulatoryOperatingFeeRate?: number; // optional UK business override; defaults to 0.35%
  otherCosts?: number;            // customs, storage, repairs, etc.
  labourHours?: number;           // estimated hours to source/clean/list/pack
  labourRatePerHour?: number;     // default £15/h if not specified
  specialistId?: string;          // for category-specific fee override
  isEstimate?: boolean;           // flag if inputs are estimated
  sourceNote?: string;            // e.g. "eBay financial API", "manual entry"
}

export interface ProfitResult {
  // Core financials
  salePrice: number;
  shippingRevenue: number;
  acquisitionCost: number;
  marketplaceFee: number;
  shippingCost: number;
  packagingCost: number;
  otherCosts: number;
  totalCosts: number;            // acquisition + all fees
  grossProfit: number;           // salePrice - totalCosts
  netRevenue: number;            // salePrice - marketplaceFee - shippingCost
  netProfit: number;             // netRevenue - acquisitionCost - other costs

  // Ratios
  grossMarginPct: number;        // grossProfit / salePrice (0-1)
  roi: number;                   // grossProfit / acquisitionCost

  // Labour efficiency
  labourHours: number | null;
  profitPerHour: number | null;
  labourCost: number | null;
  profitAfterLabour: number | null;

  // Capital efficiency
  capitalVelocityMonthly: number | null; // roi / months-in-stock (if known)

  // Metadata
  isEstimate: boolean;
  confidence: 'high' | 'medium' | 'low';
  feeRateUsed: number;
  modelVersion: string;
  calculatedAt: string;
  sourceNote?: string;

  // Debug
  inputs: ProfitInputs;
}

const DEFAULT_LABOUR_RATE = 15; // £15/h

export function calculateProfit(inputs: ProfitInputs): ProfitResult {
  const {
    salePrice,
    acquisitionCost,
    shippingCost = 0,
    shippingRevenue = 0,
    packagingCost = 0,
    otherCosts = 0,
    labourHours,
    labourRatePerHour = DEFAULT_LABOUR_RATE,
    specialistId,
    isEstimate = false,
    sourceNote,
  } = inputs;

  // ── Determine marketplace fee ────────────────────────────────────────────
  let marketplaceFee: number;
  let feeRateUsed: number;
  const grossRevenue = salePrice + shippingRevenue;
  const feeBase = Math.max(0, grossRevenue);
  const estimatedFees = inputs.marketplaceFee == null;

  if (!estimatedFees) {
    // Exact fee known (e.g., from eBay Finances API); do not add estimated components.
    marketplaceFee = inputs.marketplaceFee!;
    feeRateUsed = feeBase > 0 ? marketplaceFee / feeBase : 0;
  } else {
    const sellerType = inputs.ebaySellerType ?? 'business';
    const internationalRate = inputs.internationalFeeRate ??
      (inputs.isInternationalSale ? (sellerType === 'private' ? 0.03 : 0.02) : 0);

    if (sellerType === 'private') {
      // UK private sellers pay no domestic final-value or regulatory operating fee.
      // Overseas delivery attracts the 3% international fee; listing upgrades are excluded.
      feeRateUsed = internationalRate;
      marketplaceFee = feeBase * internationalRate;
    } else {
      const feeStructure = getEbayFeeRate(specialistId);
      const finalValueRate = inputs.marketplaceFeeRate ?? feeStructure.finalValueFee;
      const highValueRate = feeStructure.highValueThreshold != null && feeStructure.highValueRate != null && salePrice >= feeStructure.highValueThreshold
        ? feeStructure.highValueRate
        : finalValueRate;
      const tierThreshold = feeStructure.tierThreshold;
      const aboveThresholdRate = feeStructure.aboveThresholdRate;
      const finalValueFee = tierThreshold != null && aboveThresholdRate != null
        ? Math.min(feeBase, tierThreshold) * highValueRate + Math.max(0, feeBase - tierThreshold) * aboveThresholdRate
        : feeBase * highValueRate;
      const regulatoryRate = inputs.regulatoryOperatingFeeRate ?? feeStructure.regulatoryOperatingFee;
      const fixedFee = feeBase <= feeStructure.fixedFeeThreshold
        ? feeStructure.fixedFeeUnderThreshold
        : feeStructure.fixedFee;
      feeRateUsed = highValueRate + regulatoryRate + internationalRate;
      marketplaceFee = finalValueFee + feeBase * (regulatoryRate + internationalRate) + fixedFee;
    }
  }

  // ── Core calculations ────────────────────────────────────────────────────
  const netRevenue     = grossRevenue - marketplaceFee - shippingCost;
  const totalCosts     = acquisitionCost + marketplaceFee + shippingCost + packagingCost + otherCosts;
  const grossProfit    = grossRevenue - totalCosts;
  const netProfit      = netRevenue - acquisitionCost - packagingCost - otherCosts;

  const grossMarginPct = grossRevenue > 0 ? grossProfit / grossRevenue : 0;
  const roi            = acquisitionCost > 0 ? grossProfit / acquisitionCost : 0;

  // ── Labour efficiency ────────────────────────────────────────────────────
  const labourCost          = labourHours != null ? labourHours * labourRatePerHour : null;
  const profitAfterLabour   = labourCost != null ? grossProfit - labourCost : null;
  const profitPerHour       = labourHours != null && labourHours > 0
    ? grossProfit / labourHours
    : null;

  // ── Confidence ───────────────────────────────────────────────────────────
  let confidence: ProfitResult['confidence'] = 'high';
  const isEstimateResult = isEstimate || estimatedFees;
  if (isEstimateResult) confidence = 'medium';
  if (!acquisitionCost || acquisitionCost === 0) confidence = 'low';

  return {
    salePrice,
    shippingRevenue,
    acquisitionCost,
    marketplaceFee,
    shippingCost,
    packagingCost,
    otherCosts,
    totalCosts,
    grossProfit,
    netRevenue,
    netProfit,
    grossMarginPct,
    roi,
    labourHours: labourHours ?? null,
    profitPerHour,
    labourCost,
    profitAfterLabour,
    capitalVelocityMonthly: null, // requires daysInStock — computed separately
    isEstimate: isEstimateResult,
    confidence,
    feeRateUsed,
    modelVersion: PROFIT_ENGINE_VERSION,
    calculatedAt: new Date().toISOString(),
    sourceNote,
    inputs,
  };
}

// ── Acquisition Evaluation ────────────────────────────────────────────────────

export interface AcquisitionEvaluation {
  acquisitionCost: number;
  estimatedResaleValue: number;
  estimatedFees: number;
  estimatedShipping: number;
  estimatedPackaging: number;
  estimatedOtherCosts: number;
  estimatedGrossProfit: number;
  estimatedNetProfit: number;
  estimatedROI: number;
  estimatedMarginPct: number;
  labourHours: number | null;
  profitPerHour: number | null;
  capitalLockUpDays: number | null;
  capitalVelocityMonthly: number | null;

  verdict: 'strong_buy' | 'buy' | 'borderline' | 'avoid' | 'insufficient_data';
  verdictLabel: string;
  confidence: string;
  reasoning: string;
  warnings: string[];

  modelVersion: string;
  calculatedAt: string;
}

export function evaluateAcquisition(params: {
  acquisitionCost: number;
  estimatedResaleValue: number;
  shippingCost?: number;
  packagingCost?: number;
  otherCosts?: number;
  labourHours?: number;
  capitalLockUpDays?: number;
  specialistId?: string;
  confidence?: string;
  minROI?: number;
  minMargin?: number;
}): AcquisitionEvaluation {
  const {
    acquisitionCost,
    estimatedResaleValue,
    shippingCost = 3.50,
    packagingCost = 0.80,
    otherCosts = 0,
    labourHours,
    capitalLockUpDays,
    specialistId,
    confidence = 'medium',
    minROI = 0.30,
    minMargin = 0.20,
  } = params;

  const profit = calculateProfit({
    salePrice: estimatedResaleValue,
    acquisitionCost,
    shippingCost,
    packagingCost,
    otherCosts,
    labourHours,
    specialistId,
    isEstimate: true,
  });

  const warnings: string[] = [];
  if (profit.roi < minROI) {
    warnings.push(`ROI ${(profit.roi * 100).toFixed(0)}% is below your ${(minROI * 100).toFixed(0)}% target`);
  }
  if (profit.grossMarginPct < minMargin) {
    warnings.push(`Margin ${(profit.grossMarginPct * 100).toFixed(0)}% is below your ${(minMargin * 100).toFixed(0)}% minimum`);
  }
  if (profit.profitPerHour != null && profit.profitPerHour < 10) {
    warnings.push(`Low profit per hour: £${profit.profitPerHour.toFixed(2)}/h — consider if labour is worth it`);
  }
  if (capitalLockUpDays != null && capitalLockUpDays > 90) {
    warnings.push(`Long capital lock-up: ~${capitalLockUpDays} days to sell`);
  }

  // Capital velocity (ROI per month)
  const capitalVelocityMonthly = capitalLockUpDays != null && capitalLockUpDays > 0
    ? profit.roi / (capitalLockUpDays / 30)
    : null;

  let verdict: AcquisitionEvaluation['verdict'];
  let verdictLabel: string;
  let reasoning: string;

  if (acquisitionCost === 0 || estimatedResaleValue === 0) {
    verdict = 'insufficient_data';
    verdictLabel = 'Insufficient data';
    reasoning = 'Need both acquisition cost and estimated resale value to evaluate.';
  } else if (profit.roi >= 1.0 && profit.grossMarginPct >= 0.4 && warnings.length === 0) {
    verdict = 'strong_buy';
    verdictLabel = 'Strong buy';
    reasoning = `Exceptional ROI of ${(profit.roi * 100).toFixed(0)}% with ${(profit.grossMarginPct * 100).toFixed(0)}% margin and £${profit.grossProfit.toFixed(0)} gross profit.`;
  } else if (profit.roi >= minROI && profit.grossMarginPct >= minMargin && warnings.length <= 1) {
    verdict = 'buy';
    verdictLabel = 'Buy';
    reasoning = `ROI ${(profit.roi * 100).toFixed(0)}% meets ${(minROI * 100).toFixed(0)}% target. Est. profit £${profit.grossProfit.toFixed(0)}.${warnings.length ? ` Note: ${warnings[0]}` : ''}`;
  } else if (profit.roi >= minROI * 0.7 && warnings.length <= 2) {
    verdict = 'borderline';
    verdictLabel = 'Borderline';
    reasoning = `ROI ${(profit.roi * 100).toFixed(0)}% is below target. Est. profit £${profit.grossProfit.toFixed(0)}. Review: ${warnings.join('; ')}.`;
  } else {
    verdict = 'avoid';
    verdictLabel = 'Avoid';
    reasoning = `Does not meet minimum criteria. ROI ${(profit.roi * 100).toFixed(0)}%. Issues: ${warnings.join('; ')}.`;
  }

  return {
    acquisitionCost,
    estimatedResaleValue,
    estimatedFees: profit.marketplaceFee,
    estimatedShipping: profit.shippingCost,
    estimatedPackaging: profit.packagingCost,
    estimatedOtherCosts: profit.otherCosts,
    estimatedGrossProfit: profit.grossProfit,
    estimatedNetProfit: profit.netProfit,
    estimatedROI: profit.roi,
    estimatedMarginPct: profit.grossMarginPct,
    labourHours: profit.labourHours,
    profitPerHour: profit.profitPerHour,
    capitalLockUpDays: capitalLockUpDays ?? null,
    capitalVelocityMonthly,
    verdict,
    verdictLabel,
    confidence,
    reasoning,
    warnings,
    modelVersion: PROFIT_ENGINE_VERSION,
    calculatedAt: new Date().toISOString(),
  };
}

// ── Profit formatting helpers ────────────────────────────────────────────────

export function formatCurrency(v: number, compact = false): string {
  if (compact && Math.abs(v) >= 1000) {
    return `£${(v / 1000).toFixed(1)}k`;
  }
  return `£${Math.abs(v).toFixed(2)}`;
}

export function formatROI(roi: number): string {
  return `${(roi * 100).toFixed(0)}%`;
}

export function formatMargin(margin: number): string {
  return `${(margin * 100).toFixed(1)}%`;
}

export function profitConfidenceLabel(confidence: string): string {
  switch (confidence) {
    case 'high':    return 'High confidence';
    case 'medium':  return 'Estimated';
    case 'low':     return 'Approximate';
    case 'fallback': return 'Best guess';
    default:         return 'Unknown confidence';
  }
}

export function verdictColor(verdict: AcquisitionEvaluation['verdict']): string {
  switch (verdict) {
    case 'strong_buy': return '#00C896';
    case 'buy':        return '#34C759';
    case 'borderline': return '#FF9500';
    case 'avoid':      return '#FF3B30';
    default:           return '#8E8E93';
  }
}
