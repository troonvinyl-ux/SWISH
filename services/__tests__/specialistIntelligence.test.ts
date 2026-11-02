import { SPECIALIST_PROFILES,normalizeSpecialistAnalysis,mappedSpecialistSpecifics,evaluateSpecialistSafety } from '@/shared/specialistIntelligence';
import { NICHE_MODULES,PRODUCTION_NICHE_IDS } from '@/constants/niches';
import { calculateFlipIntelligence,type FlipInputs } from '@/services/flipIntelligenceService';
import type { MarketValueResult } from '@/services/marketValueService';
const basic:FlipInputs={ nicheId:'tech',identificationConfidence:0.9,market:null,purchaseCost:20,shippingCost:4,shippingRevenue:4,packagingCost:1,repairCost:5,otherCosts:2,feeRate:0.13,fixedFee:0.4,labourHours:1,labourRate:15,minProfit:10,minROI:0.3,budget:500,maxHoldingDays:90 };
const market={ valuation:{ valuationMid:100,valuationLow:80,valuationMethod:'marketplace_insights_verified_sold_comparables',valuationConfidence:'medium' },soldMarket:{ relevantSoldCount:8 },auditTrail:{ timestamp:'2026-10-30' } } as unknown as MarketValueResult;
describe('Shared researched specialist contracts',()=>{
  test.each(PRODUCTION_NICHE_IDS)('%s has substantive expertise without changing stable identity',id=>{
    const profile=SPECIALIST_PROFILES[id];expect(profile.nicheId).toBe(id);expect(NICHE_MODULES[id].specialists).toContain(NICHE_MODULES[id].defaultSpecialist);
    expect(profile.fields.length).toBeGreaterThanOrEqual(8);expect(profile.sources.length).toBeGreaterThan(0);expect(profile.recognition.length).toBeGreaterThan(100);expect(profile.valuationRules.length).toBeGreaterThan(100);
  });
  test('unsupported dimensions are unknown rather than photographic certification',()=>{
    const result=normalizeSpecialistAnalysis({ confidence:{ variant:0.8,authenticity:1,compatibility:1,valuation:1 },fields:{ model:{ value:'A123',basis:'verified' },ruler:{ value:'Invented' } } },SPECIALIST_PROFILES.tech,0.6);
    expect(result.confidence.authenticity).toBeNull();expect(result.confidence.compatibility).toBeNull();expect(result.confidence.valuation).toBeNull();expect(result.confidence.variant).toBe(0.8);
    expect(result.fields.ruler).toBeUndefined();expect(result.fields.model.basis).toBe('inferred');
  });
  test('quality and questions are bounded, deduplicated and uncertainty-specific',()=>{
    const result=normalizeSpecialistAnalysis({ fields:{ brand:{ value:'Trek',basis:'observed' } },followUps:[{ key:'brand',question:'Brand?' },{ key:'frame_size',question:'Measured frame size?',reason:'Rider fit requires measurement' },{ key:'frame_size',question:'Again?' },{ key:'ruler',question:'Coin ruler?' }] },SPECIALIST_PROFILES.bicycles,0.8);
    expect(result.followUps).toHaveLength(1);expect(result.followUps[0].key).toBe('frame_size');expect(result.quality.status).toBe('not_assessed');
  });
  test('inferred composition never becomes a confirmed marketplace specific',()=>{
    const specs=mappedSpecialistSpecifics(SPECIALIST_PROFILES.clothing,{ brand:'Nike',composition:'Cotton',_inferred_composition:'Cotton' });
    expect(specs.Brand).toBe('Nike');expect(specs.Material).toBeUndefined();expect(specs.Ruler).toBeUndefined();
  });
  test('Threads Flip maps required clothing attributes to their exact eBay item specifics',()=>{\n    const specs=mappedSpecialistSpecifics(SPECIALIST_PROFILES.clothing,{ department:\"Women's\",style:'Vintage',outer_shell_material:'Leather' });\n    expect(specs.Department).toBe(\"Women's\");expect(specs.Style).toBe('Vintage');expect(specs['Outer Shell Material']).toBe('Leather');\n  });\n  test('beauty exclusions and tech locks do not depend on a high model score',()=>{
    expect(evaluateSpecialistSafety('beauty',{ tester:true }).blocked).toBe(true);
    expect(evaluateSpecialistSafety('beauty',{ opened:true }).blocked).toBe(true);
    expect(evaluateSpecialistSafety('beauty',{ recall_status:'recalled' }).blocked).toBe(true);
    expect(evaluateSpecialistSafety('beauty',{ recall_status:'not recalled' }).blocked).toBe(false);
    expect(evaluateSpecialistSafety('tech',{ activation_lock:'locked' }).blocked).toBe(true);
  });
});
describe('Transparent flip economics',()=>{
  test('missing evidence cannot produce a strong buying score',()=>{ const result=calculateFlipIntelligence(basic);expect(result.score).toBeLessThan(50);expect(result.verdict).toBe('Research before buying');expect(result.holdingDays).toBeNull(); });
  test('manual high prices remain scenario-only even when sold comparisons exist',()=>{ const result=calculateFlipIntelligence({ ...basic,market,resalePrice:100000,conservativePrice:100000 });expect(result.confidence).toBe('scenario_only');expect(result.score).toBeLessThan(50); });
  test('fees use buyer-paid postage, not the seller postage cost',()=>{
    const result=calculateFlipIntelligence({ ...basic,market });expect(result.expected.marketplaceFee).toBeCloseTo(104*0.13+0.4);
    expect(result.expected.netProfit).toBeCloseTo(104-(104*0.13+0.4)-20-4-1-5-2);
    expect(result.expected.profitAfterLabour).toBeCloseTo(result.expected.netProfit-15);
  });
  test('break-even price includes labour and all configured costs',()=>{ const result=calculateFlipIntelligence({ ...basic,market });const expected=(20+0.4+4+1+5+2+15)/0.87-4;expect(result.breakEvenPrice).toBeCloseTo(expected,1); });
  test('lower lot yield lowers recovery and raises nominal break-even price',()=>{ const full=calculateFlipIntelligence({ ...basic,market });const half=calculateFlipIntelligence({ ...basic,market,sellableYield:0.5 });expect(half.maxBuyPrice).toBeLessThan(full.maxBuyPrice);expect(half.breakEvenPrice!).toBeCloseTo(full.breakEvenPrice!*2,1); });
  test('zero yield produces no feasible break-even price',()=>{ expect(calculateFlipIntelligence({ ...basic,market,sellableYield:0 }).breakEvenPrice).toBeNull(); });
  test('invalid costs and percentages fail without NaN outputs',()=>{ expect(()=>calculateFlipIntelligence({ ...basic,feeRate:1 })).toThrow();expect(()=>calculateFlipIntelligence({ ...basic,purchaseCost:NaN })).toThrow();expect(()=>calculateFlipIntelligence({ ...basic,identificationConfidence:NaN })).toThrow(); });
  test('high resale estimate never overrides a known product safety risk',()=>{ const result=calculateFlipIntelligence({ ...basic,market,nicheId:'beauty',attributes:{ tester:true } });expect(result.score).toBe(0);expect(result.verdict).toBe('Avoid / resolve safety risk'); });
});
