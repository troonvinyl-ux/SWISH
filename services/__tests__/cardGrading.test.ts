import { calculateCardGrading,type CardGradingInput } from '@/services/cardGradingService';
const input:CardGradingInput={ rawSalePrice:100,purchaseCost:40,saleFeeRate:0.1,saleFixedFee:0.4,rawSaleShipping:4,gradedSaleShipping:6,gradingFee:25,insuredOutbound:10,insuredReturn:10,packagingCost:2,holdingDays:90,monthlyHoldingCost:3,annualCapitalRate:0.1,scenarios:[{ id:'high',label:'User grade 10 scenario',probability:0.2,salePrice:300 },{ id:'lower',label:'User grade 8 scenario',probability:0.6,salePrice:150 },{ id:'returned',label:'Ungraded return',probability:0.2,salePrice:100 }] };
describe('Card Flipper grading scenarios, not professional grading predictions',()=>{
  test('accounts for all fees, insured round-trip shipping and capital holding cost',()=>{
    const result=calculateCardGrading(input);
    expect(result.rawProfit).toBeCloseTo(100*0.9-0.4-40-4-2);
    expect(result.gradingCosts).toBe(45);
    expect(result.holdingCost).toBeCloseTo(9+85*0.1*90/365);
    expect(result.expectedGross).toBeCloseTo(170);
    expect(result.expectedProfit).toBeCloseTo(170*0.9-0.4-40-45-result.holdingCost-6-2);
  });
  test('ungraded return incurs sunk grading costs instead of optimistic refund',()=>{ const result=calculateCardGrading(input);expect(result.outcomes[2].profit).toBeLessThan(result.rawProfit); });
  test('probability beating raw is computed from scenario profit, not grade labels',()=>{ const result=calculateCardGrading(input);expect(result.probabilityBeatRaw).toBe(0.2);expect(result.outcomes[0].uplift).toBeGreaterThan(0); });
  test('holding and insurance can reverse a positive gross grading uplift',()=>{ const result=calculateCardGrading({ ...input,gradingFee:300 });expect(result.uplift).toBeLessThan(0); });
  test('break-even gross solves the full net equation',()=>{ const result=calculateCardGrading(input);const cost=40+45+result.holdingCost+6+2+0.4;expect(result.breakEvenGross*0.9).toBeCloseTo(cost);expect(result.rawEquivalentGross*0.9-cost).toBeCloseTo(result.rawProfit); });
  test('does not silently normalise incomplete probability totals',()=>{ expect(()=>calculateCardGrading({ ...input,scenarios:input.scenarios.map(s=>({ ...s,probability:0.2 })) })).toThrow('100%'); });
  test.each([-1,NaN,Infinity,1])('rejects invalid selling fee %s',fee=>{ expect(()=>calculateCardGrading({ ...input,saleFeeRate:fee })).toThrow(); });
  test.each([-1,NaN,Infinity])('rejects invalid grading costs %s',cost=>{ expect(()=>calculateCardGrading({ ...input,gradingFee:cost })).toThrow(); });
  test('zero purchase/holding cost is supported, zero probability outcomes are not worst-case risks',()=>{ const result=calculateCardGrading({ ...input,purchaseCost:0,holdingDays:0,scenarios:[{ id:'a',label:'Outcome A',probability:1,salePrice:100 },{ id:'b',label:'Excluded outcome',probability:0,salePrice:0 }] });expect(result.downsideProfit).toBe(result.upsideProfit);expect(result.holdingCost).toBe(0); });
  test('invalid prices, labels, duplicate identities and probability bounds fail',()=>{ for(const scenarios of [[{ ...input.scenarios[0],probability:1.1 },input.scenarios[1]],[{ ...input.scenarios[0],salePrice:NaN },input.scenarios[1]],[{ ...input.scenarios[0],label:'' },input.scenarios[1]],[input.scenarios[0],input.scenarios[0]]]) expect(()=>calculateCardGrading({ ...input,scenarios })).toThrow(); });
});
