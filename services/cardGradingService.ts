// Deterministic user-entered scenarios only. No AI calls, price feeds or professional grade predictions.
export interface GradeScenario { id: string; label: string; probability: number; salePrice: number }
export interface CardGradingInput {
  rawSalePrice: number; purchaseCost: number; saleFeeRate: number; saleFixedFee: number;
  rawSaleShipping: number; gradedSaleShipping: number; gradingFee: number;
  insuredOutbound: number; insuredReturn: number; packagingCost: number;
  holdingDays: number; monthlyHoldingCost: number; annualCapitalRate: number;
  scenarios: GradeScenario[];
}
export interface CardGradingResult {
  rawProfit: number; expectedProfit: number; uplift: number; gradingCosts: number; holdingCost: number;
  expectedGross: number; probabilityBeatRaw: number; downsideProfit: number; upsideProfit: number;
  breakEvenGross: number; rawEquivalentGross: number;
  outcomes: Array<GradeScenario & { profit: number; uplift: number }>;
}
export function calculateCardGrading(input: CardGradingInput): CardGradingResult {
  const amounts = [input.rawSalePrice,input.purchaseCost,input.saleFixedFee,input.rawSaleShipping,input.gradedSaleShipping,input.gradingFee,input.insuredOutbound,input.insuredReturn,input.packagingCost,input.holdingDays,input.monthlyHoldingCost,input.annualCapitalRate];
  if (amounts.some(value => !Number.isFinite(value) || value < 0) || !Number.isFinite(input.saleFeeRate) || input.saleFeeRate < 0 || input.saleFeeRate >= 1) throw new Error('Enter non-negative costs and a selling fee below 100%.');
  if (input.scenarios.length < 2 || input.scenarios.length > 8 || new Set(input.scenarios.map(s => s.id)).size !== input.scenarios.length) throw new Error('Add two to eight distinct outcomes, including a lower-grade or ungraded return scenario.');
  if (input.scenarios.some(s => !s.label.trim() || !Number.isFinite(s.salePrice) || s.salePrice < 0 || !Number.isFinite(s.probability) || s.probability < 0 || s.probability > 1)) throw new Error('Every outcome needs a label, non-negative sale value and probability from 0% to 100%.');
  const total = input.scenarios.reduce((sum,s) => sum + s.probability,0);
  if (Math.abs(total - 1) > 0.000001) throw new Error(`Outcome probabilities must total 100% (currently ${(total * 100).toFixed(2)}%). They are not automatically normalised.`);
  const saleNet = (price: number) => price * (1 - input.saleFeeRate) - input.saleFixedFee;
  const gradingCosts = input.gradingFee + input.insuredOutbound + input.insuredReturn;
  const holdingCost = input.monthlyHoldingCost * input.holdingDays / 30 + (input.purchaseCost + gradingCosts) * input.annualCapitalRate * input.holdingDays / 365;
  const rawProfit = saleNet(input.rawSalePrice) - input.purchaseCost - input.rawSaleShipping - input.packagingCost;
  const gradedCosts = input.purchaseCost + gradingCosts + holdingCost + input.gradedSaleShipping + input.packagingCost;
  const outcomes = input.scenarios.map(s => { const profit = saleNet(s.salePrice) - gradedCosts; return { ...s, profit, uplift: profit - rawProfit }; });
  const possible = outcomes.filter(s => s.probability > 0);
  const expectedGross = outcomes.reduce((sum,s) => sum + s.salePrice * s.probability,0);
  const expectedProfit = outcomes.reduce((sum,s) => sum + s.profit * s.probability,0);
  const result = { rawProfit, expectedProfit, uplift: expectedProfit - rawProfit, gradingCosts, holdingCost, expectedGross,
    probabilityBeatRaw: outcomes.reduce((sum,s) => sum + (s.uplift > 0 ? s.probability : 0),0),
    downsideProfit: Math.min(...possible.map(s => s.profit)), upsideProfit: Math.max(...possible.map(s => s.profit)),
    breakEvenGross: (gradedCosts + input.saleFixedFee) / (1 - input.saleFeeRate),
    rawEquivalentGross: Math.max(0,(gradedCosts + input.saleFixedFee + rawProfit) / (1 - input.saleFeeRate)), outcomes };
  if (Object.values(result).some(value => typeof value === 'number' && !Number.isFinite(value))) throw new Error('These values are too large to calculate safely.');
  return result;
}
