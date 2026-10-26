/**
 * Surplus Flip buying and inventory decision engine.
 *
 * Pure calculations only: no market values are invented here. The caller must
 * supply researched sold-price evidence, sell-through assumptions and costs.
 * Defaults are conservative placeholders and must be shown as assumptions.
 */

export type EvidenceConfidence = 'verified_sold_comps' | 'mixed_evidence' | 'asking_prices_only' | 'unknown';
export type BuyVerdict = 'BUY' | 'BUY_IF_NEGOTIATED' | 'DONT_BUY' | 'INSUFFICIENT_EVIDENCE';

export interface SurplusLine {
  id: string;
  title: string;
  quantity: number;
  /** Researched expected sale price per unit, not RRP. */
  expectedSalePrice: number;
  /** Estimated proportion of units sold within the forecast horizon, 0..1. */
  sellThroughRate: number;
  /** Expected recovery value for units not sold within the horizon, 0..1 of expectedSalePrice. */
  unsoldRecoveryRate?: number;
  evidence: EvidenceConfidence;
  /** Optional per-unit repair/prep, packaging and return/defect reserve. */
  prepCostPerUnit?: number;
  packagingCostPerUnit?: number;
  returnReservePerUnit?: number;
  shippingSubsidyPerUnit?: number;
  /** Expected marketplace fee rate, e.g. 0.13 for 13%. */
  marketplaceFeeRate?: number;
  marketplaceFixedFeePerSale?: number;
  /** Known restricted, unsafe, counterfeit or unlistable product flag. */
  blocked?: boolean;
}

export interface SurplusDealInput {
  lines: SurplusLine[];
  askingPurchasePrice: number;
  inboundFreight: number;
  otherLotCosts?: number;
  targetProfitMargin?: number; // on expected net revenue; default 20%
  minimumReturnOnCash?: number; // expected profit / cash invested; default 30%
  contingencyRate?: number; // applied to acquisition + freight + other lot costs; default 10%
  forecastHorizonDays?: number; // default 180
}

export interface LineEconomics {
  id: string;
  title: string;
  units: number;
  expectedUnitsSold: number;
  expectedUnsoldUnits: number;
  expectedGrossSales: number;
  expectedNetSalesAfterFeesAndSellingCosts: number;
  expectedUnsoldRecovery: number;
  estimatedContributionBeforeLotCost: number;
  evidence: EvidenceConfidence;
  warnings: string[];
}

export interface SurplusDealAnalysis {
  verdict: BuyVerdict;
  confidence: 'high' | 'medium' | 'low';
  askingPurchasePrice: number;
  recommendedMaximumPurchasePrice: number;
  totalCashRequiredAtAsk: number;
  expectedRevenue: number;
  expectedNetSales: number;
  expectedProfitAtAsk: number;
  expectedRoiAtAsk: number;
  downsideProfitAtAsk: number;
  downsideRoiAtAsk: number;
  breakEvenPurchasePrice: number;
  targetMarginPurchasePrice: number;
  lineItems: LineEconomics[];
  reasons: string[];
  warnings: string[];
  assumptions: Record<string, number | string>;
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const nonNegative = (value: number | undefined) => Math.max(0, Number.isFinite(value) ? (value ?? 0) : 0);
const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export function analyzeSurplusDeal(input: SurplusDealInput): SurplusDealAnalysis {
  const targetMargin = clamp01(input.targetProfitMargin ?? 0.2);
  const minimumRoi = Math.max(0, input.minimumReturnOnCash ?? 0.3);
  const contingencyRate = clamp01(input.contingencyRate ?? 0.1);
  const freight = nonNegative(input.inboundFreight);
  const otherCosts = nonNegative(input.otherLotCosts);
  const askingPrice = nonNegative(input.askingPurchasePrice);
  const lines: LineEconomics[] = [];
  const warnings: string[] = [];
  const reasons: string[] = [];

  if (!input.lines.length) warnings.push('No manifest product rows were supplied.');
  if (input.lines.some(line => line.quantity <= 0)) warnings.push('One or more rows have zero/invalid quantity.');
  if (input.lines.some(line => line.expectedSalePrice <= 0)) warnings.push('Some products have no researched expected sale price; their value is treated as £0 until evidence is supplied.');
  if (input.lines.some(line => line.evidence === 'asking_prices_only' || line.evidence === 'unknown')) {
    warnings.push('Some values are based on asking prices or have no evidence; these are not confirmed realised sale prices.');
  }
  if (input.lines.some(line => line.blocked)) warnings.push('At least one line is flagged as restricted, unsafe, counterfeit or not suitable for listing. Exclude it or confirm lawful saleability before buying.');

  for (const line of input.lines) {
    const quantity = Math.max(0, Math.floor(nonNegative(line.quantity)));
    const sellThrough = clamp01(line.sellThroughRate);
    const expectedUnitsSold = quantity * sellThrough;
    const expectedUnsoldUnits = quantity - expectedUnitsSold;
    const salePrice = nonNegative(line.expectedSalePrice);
    const feeRate = clamp01(line.marketplaceFeeRate ?? 0.13);
    const fixedFee = nonNegative(line.marketplaceFixedFeePerSale);
    const perUnitCosts = nonNegative(line.prepCostPerUnit)
      + nonNegative(line.packagingCostPerUnit)
      + nonNegative(line.returnReservePerUnit)
      + nonNegative(line.shippingSubsidyPerUnit);
    const grossSales = expectedUnitsSold * salePrice;
    const variableSellingCosts = expectedUnitsSold * (salePrice * feeRate + fixedFee + perUnitCosts);
    const netSales = grossSales - variableSellingCosts;
    const unsoldRecovery = expectedUnsoldUnits * salePrice * clamp01(line.unsoldRecoveryRate ?? 0.1);
    const lineWarnings: string[] = [];
    if (line.evidence !== 'verified_sold_comps') lineWarnings.push('Sale price evidence is not fully verified sold-comparable data.');
    if (sellThrough < 0.4) lineWarnings.push('Low expected sell-through; consider bundle or clearance value.');
    if (line.blocked) lineWarnings.push('Do not list until legality, safety and platform restrictions are cleared.');
    lines.push({
      id: line.id,
      title: line.title,
      units: quantity,
      expectedUnitsSold: roundMoney(expectedUnitsSold),
      expectedUnsoldUnits: roundMoney(expectedUnsoldUnits),
      expectedGrossSales: roundMoney(grossSales),
      expectedNetSalesAfterFeesAndSellingCosts: roundMoney(netSales),
      expectedUnsoldRecovery: roundMoney(unsoldRecovery),
      estimatedContributionBeforeLotCost: roundMoney(netSales + unsoldRecovery),
      evidence: line.evidence,
      warnings: lineWarnings,
    });
  }

  const expectedRevenue = lines.reduce((sum, line) => sum + line.expectedGrossSales + line.expectedUnsoldRecovery, 0);
  const expectedNetSales = lines.reduce((sum, line) => sum + line.estimatedContributionBeforeLotCost, 0);
  const contingency = (askingPrice + freight + otherCosts) * contingencyRate;
  const totalCashRequiredAtAsk = askingPrice + freight + otherCosts + contingency;
  const expectedProfitAtAsk = expectedNetSales - totalCashRequiredAtAsk;
  const expectedRoiAtAsk = totalCashRequiredAtAsk > 0 ? expectedProfitAtAsk / totalCashRequiredAtAsk : 0;

  // Downside case: 25% lower selling prices and 20 percentage-point lower sell-through.
  // It is a stress scenario, not a statistical guarantee.
  const downsideNet = input.lines.reduce((sum, line) => {
    const qty = Math.max(0, Math.floor(nonNegative(line.quantity)));
    const price = nonNegative(line.expectedSalePrice) * 0.75;
    const sold = qty * clamp01(line.sellThroughRate - 0.2);
    const unsold = qty - sold;
    const feeRate = clamp01(line.marketplaceFeeRate ?? 0.13);
    const costs = nonNegative(line.prepCostPerUnit) + nonNegative(line.packagingCostPerUnit)
      + nonNegative(line.returnReservePerUnit) + nonNegative(line.shippingSubsidyPerUnit);
    return sum + sold * (price * (1 - feeRate) - nonNegative(line.marketplaceFixedFeePerSale) - costs)
      + unsold * price * clamp01(line.unsoldRecoveryRate ?? 0.1);
  }, 0);
  const downsideProfitAtAsk = downsideNet - totalCashRequiredAtAsk;
  const downsideRoiAtAsk = totalCashRequiredAtAsk > 0 ? downsideProfitAtAsk / totalCashRequiredAtAsk : 0;

  const breakEvenPurchasePrice = Math.max(0, expectedNetSales - freight - otherCosts - contingencyRate * (freight + otherCosts)) / (1 + contingencyRate);
  const targetMarginPurchasePrice = Math.max(0,
    (expectedNetSales * (1 - targetMargin) - freight - otherCosts - contingencyRate * (freight + otherCosts)) / (1 + contingencyRate),
  );
  const roiLimitedPurchasePrice = Math.max(0,
    (expectedNetSales / (1 + minimumRoi) - freight - otherCosts - contingencyRate * (freight + otherCosts)) / (1 + contingencyRate),
  );
  const recommendedMaximumPurchasePrice = Math.min(targetMarginPurchasePrice, roiLimitedPurchasePrice);
  const verifiedShare = input.lines.length
    ? input.lines.filter(line => line.evidence === 'verified_sold_comps').length / input.lines.length
    : 0;
  const unknownShare = input.lines.length
    ? input.lines.filter(line => line.evidence === 'unknown' || line.evidence === 'asking_prices_only').length / input.lines.length
    : 1;
  const blockedShare = input.lines.length ? input.lines.filter(line => line.blocked).length / input.lines.length : 1;

  let confidence: SurplusDealAnalysis['confidence'] = 'low';
  if (verifiedShare >= 0.8 && unknownShare <= 0.1) confidence = 'high';
  else if (verifiedShare >= 0.5 && unknownShare <= 0.3) confidence = 'medium';

  let verdict: BuyVerdict;
  if (!input.lines.length || unknownShare >= 0.6 || expectedNetSales <= 0) {
    verdict = 'INSUFFICIENT_EVIDENCE';
    reasons.push('There is not enough reliable price evidence to make a responsible buy decision.');
  } else if (blockedShare > 0.15) {
    verdict = 'DONT_BUY';
    reasons.push('Too much of the lot is flagged as restricted, unsafe, counterfeit or not listable.');
  } else if (askingPrice <= recommendedMaximumPurchasePrice && expectedRoiAtAsk >= minimumRoi && downsideProfitAtAsk >= 0) {
    verdict = 'BUY';
    reasons.push('The asking price meets the target margin and return thresholds, and the downside scenario remains non-negative.');
  } else if (askingPrice <= breakEvenPurchasePrice && recommendedMaximumPurchasePrice > 0) {
    verdict = 'BUY_IF_NEGOTIATED';
    reasons.push('The lot may work only at a lower purchase price; negotiate at or below the recommended maximum.');
  } else {
    verdict = 'DONT_BUY';
    reasons.push('The asking price does not leave enough risk-adjusted profit after selling costs and contingency.');
  }

  if (expectedRoiAtAsk < minimumRoi) reasons.push('Expected return on cash is below the configured minimum of ' + Math.round(minimumRoi * 100) + '%.');
  if (downsideProfitAtAsk < 0) reasons.push('The stress scenario loses money at the asking price.');
  if (verifiedShare < 0.5) reasons.push('Fewer than half of the manifest lines have verified sold-comparable evidence.');
  if (input.lines.some(line => line.sellThroughRate < 0.4)) reasons.push('Some products are expected to sell slowly; include storage and markdown plans.');

  return {
    verdict,
    confidence,
    askingPurchasePrice: roundMoney(askingPrice),
    recommendedMaximumPurchasePrice: roundMoney(recommendedMaximumPurchasePrice),
    totalCashRequiredAtAsk: roundMoney(totalCashRequiredAtAsk),
    expectedRevenue: roundMoney(expectedRevenue),
    expectedNetSales: roundMoney(expectedNetSales),
    expectedProfitAtAsk: roundMoney(expectedProfitAtAsk),
    expectedRoiAtAsk: roundMoney(expectedRoiAtAsk),
    downsideProfitAtAsk: roundMoney(downsideProfitAtAsk),
    downsideRoiAtAsk: roundMoney(downsideRoiAtAsk),
    breakEvenPurchasePrice: roundMoney(breakEvenPurchasePrice),
    targetMarginPurchasePrice: roundMoney(targetMarginPurchasePrice),
    lineItems: lines,
    reasons,
    warnings,
    assumptions: {
      targetProfitMargin: targetMargin,
      minimumReturnOnCash: minimumRoi,
      contingencyRate,
      forecastHorizonDays: input.forecastHorizonDays ?? 180,
      defaultMarketplaceFeeRate: 0.13,
      defaultUnsoldRecoveryRate: 0.1,
      downsideSalePriceMultiplier: 0.75,
      downsideSellThroughReduction: 0.2,
    },
  };
}

export interface DeadStockInput {
  daysSinceListed: number;
  views: number;
  watchers: number;
  soldUnitsLast30Days: number;
  currentPrice: number;
  minimumAcceptableNet?: number;
  quantityAvailable: number;
  category?: string;
}

export type DeadStockAction = 'HOLD_AND_IMPROVE' | 'MARKDOWN_10_PERCENT' | 'MARKDOWN_20_PERCENT' | 'BUNDLE' | 'WHOLESALE_OR_LIQUIDATE' | 'REVIEW_DATA';

export function recommendDeadStockAction(input: DeadStockInput): { action: DeadStockAction; reason: string; suggestedPrice?: number } {
  const days = Math.max(0, input.daysSinceListed);
  const views = Math.max(0, input.views);
  const watchers = Math.max(0, input.watchers);
  const sold = Math.max(0, input.soldUnitsLast30Days);
  const qty = Math.max(0, input.quantityAvailable);
  const price = nonNegative(input.currentPrice);
  if (!price || !qty) return { action: 'REVIEW_DATA', reason: 'Price or available quantity is missing; reconcile stock before taking action.' };
  if (days < 21) return { action: 'HOLD_AND_IMPROVE', reason: 'Too early to call this dead stock; improve title, photos, specifics and price evidence first.' };
  if (sold > 0 || watchers >= 3) return { action: 'HOLD_AND_IMPROVE', reason: 'Recent sales or watcher interest suggests demand; improve conversion before discounting.' };
  if (days >= 90 && views < 10) return { action: 'WHOLESALE_OR_LIQUIDATE', reason: '90+ days listed with almost no views: weak demand or poor discoverability; compare clearance value against ongoing holding cost.' };
  if (days >= 60 && watchers === 0) return { action: 'BUNDLE', reason: '60+ days with no watchers: test a bundle or multi-buy offer to reduce handling and holding time.' };
  if (days >= 45) {
    const discount = days >= 75 ? 0.2 : 0.1;
    const suggestedPrice = roundMoney(price * (1 - discount));
    if (input.minimumAcceptableNet != null && suggestedPrice < input.minimumAcceptableNet) {
      return { action: 'BUNDLE', reason: 'A markdown would breach the minimum acceptable net; bundle or clear through a lower-cost channel instead.' };
    }
    return { action: discount === 0.2 ? 'MARKDOWN_20_PERCENT' : 'MARKDOWN_10_PERCENT', reason: 'Age threshold reached without enough demand; apply a controlled markdown and review again in 14 days.', suggestedPrice };
  }
  return { action: 'HOLD_AND_IMPROVE', reason: 'Continue monitoring and improve listing quality before reducing price.' };
}
