// Evidence-aware extension of the existing profit engine, not another inventory/AI stack.
import { calculateProfit, PROFIT_ENGINE_VERSION } from './profitEngine';
import type { MarketValueResult } from './marketValueService';
import { evaluateSpecialistSafety, type SpecialistAnalysis } from '@/shared/specialistIntelligence';
export interface FlipInputs {
  nicheId: string; identificationConfidence: number; market: MarketValueResult | null;
  analysis?: SpecialistAnalysis; attributes?: Record<string,unknown>;
  purchaseCost: number; resalePrice?: number; conservativePrice?: number;
  shippingCost: number; shippingRevenue: number; packagingCost: number; repairCost: number; otherCosts: number;
  feeRate: number; fixedFee: number; labourHours: number; labourRate: number;
  minProfit: number; minROI: number; budget: number; maxHoldingDays: number;
  holdingDays?: number; sellableYield?: number;
}
const money = (value: number) => Math.round(value * 100) / 100;
export function calculateFlipIntelligence(input: FlipInputs) {
  const numbers = [input.identificationConfidence,input.purchaseCost,input.shippingCost,input.shippingRevenue,input.packagingCost,input.repairCost,input.otherCosts,input.feeRate,input.fixedFee,input.labourHours,input.labourRate,input.minProfit,input.minROI,input.budget,input.maxHoldingDays];
  if (numbers.some(v=>!Number.isFinite(v) || v<0) || input.feeRate >= 1 || input.identificationConfidence>1 || (input.sellableYield != null && (!Number.isFinite(input.sellableYield) || input.sellableYield<0 || input.sellableYield>1))) throw new Error('Enter non-negative costs and a fee/yield rate in range.');
  if ([input.resalePrice,input.conservativePrice,input.holdingDays].some(v=>v!=null && (!Number.isFinite(v) || v<0))) throw new Error('Prices and holding period must be valid non-negative numbers.');
  const valuation = input.market?.valuation;
  const basePrice = input.resalePrice ?? valuation?.valuationMid ?? 0;
  const lowPrice = input.conservativePrice ?? valuation?.valuationLow ?? 0;
  if (!Number.isFinite(basePrice) || !Number.isFinite(lowPrice)) throw new Error('The market service returned invalid prices.');
  const yieldRate = input.sellableYield ?? 1;
  const expectedSale = basePrice * yieldRate; const conservativeSale = Math.min(lowPrice,basePrice) * yieldRate;
  const calc = (salePrice: number) => calculateProfit({
    salePrice: salePrice+input.shippingRevenue, acquisitionCost: input.purchaseCost,
    marketplaceFee: (salePrice+input.shippingRevenue)*input.feeRate+input.fixedFee,
    shippingCost: input.shippingCost, packagingCost: input.packagingCost,
    otherCosts: input.repairCost+input.otherCosts, labourHours: input.labourHours, labourRatePerHour: input.labourRate,
    isEstimate: true, sourceNote: 'User-configured fee and cost assumptions; projected, not realised profit.',
  });
  const expected = calc(expectedSale); const conservative = calc(conservativeSale);
  const labourCost = input.labourHours*input.labourRate;
  const recovery = conservativeSale+input.shippingRevenue-(conservativeSale+input.shippingRevenue)*input.feeRate-input.fixedFee-input.shippingCost-input.packagingCost-input.repairCost-input.otherCosts-labourCost;
  const maxBuyPrice = Math.max(0,Math.min(recovery-input.minProfit,recovery/(1+input.minROI),input.budget));
  const breakEvenPrice = yieldRate>0 ? Math.max(0,((input.purchaseCost+input.fixedFee+input.shippingCost+input.packagingCost+input.repairCost+input.otherCosts+labourCost)/(1-input.feeRate)-input.shippingRevenue)/yieldRate) : null;
  const sold = input.market?.soldMarket;
  const count = Math.max(0,Number(sold?.relevantSoldCount ?? 0));
  const method = valuation?.valuationMethod ?? '';
  // Neither AI narratives, catalogue matches nor active listings count as sold evidence.
  const soldBacked = count>0 && /verified_sold|sold_comparable|realised/i.test(method);
  const hasValue = expectedSale>0;
  const issues: string[] = [];
  if (!hasValue) issues.push('No usable resale estimate; research prices before buying.');
  if (!soldBacked) issues.push('No verified realised-sale basis. Asking prices and manual scenarios are not confirmed market value.');
  if (input.identificationConfidence<0.7) issues.push('Identity is uncertain; obtain the distinguishing evidence.');
  if (input.holdingDays==null) issues.push('Time to sell is unknown. Holding limit is a preference, not a prediction.');
  else if (input.holdingDays>input.maxHoldingDays) issues.push('Your assumed holding period exceeds your preference.');
  const safety = evaluateSpecialistSafety(input.nicheId,input.attributes ?? {}); issues.push(...safety.reasons);
  if (input.purchaseCost>input.budget) issues.push('Purchase cost exceeds your budget.');
  if ((conservative.profitAfterLabour ?? 0)<input.minProfit) issues.push('Conservative profit after labour is below your target.');
  const manualScenario = input.resalePrice != null || input.conservativePrice != null;
  if (manualScenario) issues.push('Manual resale overrides are scenario inputs, not verified prices.');
  const confidence = !manualScenario && soldBacked && ['high','medium'].includes(valuation?.valuationConfidence ?? '') && input.identificationConfidence>=0.7 ? 'evidence_supported' : 'scenario_only';
  const components = [
    { label:'Identification',points:Math.round(Math.min(1,input.identificationConfidence)*20),max:20 },
    { label:'Comparable evidence',points:soldBacked ? Math.min(25,count*3) : 0,max:25 },
    { label:'Conservative profit',points:(conservative.profitAfterLabour ?? 0)>=input.minProfit ? 20 : 0,max:20 },
    { label:'Conservative ROI',points:conservative.roi>=input.minROI ? 15 : 0,max:15 },
    { label:'Known holding period',points:input.holdingDays!=null && input.holdingDays<=input.maxHoldingDays ? 10 : 0,max:10 },
    { label:'Risk review',points:(input.analysis?.risks.length ?? 0)===0 && !safety.blocked ? 5 : 0,max:10 },
  ];
  let score = components.reduce((sum,c)=>sum+c.points,0);
  if (confidence==='scenario_only') score=Math.min(49,score);
  if (safety.blocked) score=0;
  const verdict = safety.blocked ? 'Avoid / resolve safety risk' : !hasValue || confidence==='scenario_only' ? 'Research before buying' : input.purchaseCost<=maxBuyPrice && input.purchaseCost<=input.budget ? 'Within conservative buying limit' : 'Negotiate / pass at this price';
  return { expected,conservative,maxBuyPrice:money(maxBuyPrice),breakEvenPrice:breakEvenPrice==null ? null : money(breakEvenPrice),score,components,verdict,issues,
    confidence,holdingDays:input.holdingDays ?? null,soldCount:count,evidenceSource:method || 'none',
    researchedAt:input.market?.auditTrail?.timestamp ?? null,modelVersion:PROFIT_ENGINE_VERSION+'-specialist-1',isEstimate:true as const };
}
