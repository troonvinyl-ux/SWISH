jest.mock('@/template',()=>({getSupabaseClient:jest.fn()}));
import { computeBasicDecomposition,evaluateManifestLot,DEFAULT_LOT_ASSUMPTIONS } from '@/services/decompositionService';
import { compileManifestDrafts } from '@/services/manifestListingService';
import { normaliseManifest } from '@/services/manifestParser';
import { toLotLines } from '@/services/lotEconomicsService';
jest.mock('expo-crypto',()=>({CryptoDigestAlgorithm:{SHA256:'sha256'},digestStringAsync:jest.fn()}));
describe('Decomposition remains shared and evidence-aware',()=>{
  const item={valuationMid:100,status:'identified',specialistId:'clothing',dispositionDecision:'sell_individual'};
  test('without a quoted whole-lot value the basic helper does not invent uplift',()=>{expect(computeBasicDecomposition([item],20).misBundlingLikely).toBe(false);});
  test('an explicitly supplied lot quote allows a genuine comparison',()=>{expect(computeBasicDecomposition([item],20,40).misBundlingLikely).toBe(true);expect(computeBasicDecomposition([item],20,90).misBundlingLikely).toBe(false);});
  test('shared API rejects a supposedly conservative whole-lot price above expected',()=>{const result=evaluateManifestLot([],{...DEFAULT_LOT_ASSUMPTIONS,wholeLotPrice:20,wholeLotConservative:50});expect(result.errors.length).toBeGreaterThan(0);expect(result.recommendedMaxBid).toBe(0);});
  test('oversized packs leave smaller residual quantities individual in both prediction and inventory',()=>{const lines=toLotLines(normaliseManifest([['Title','Quantity','Unit RRP'],['Widget',2,100]]).rows);lines[0].packSize=5;const plans=compileManifestDrafts(lines,DEFAULT_LOT_ASSUMPTIONS,'grouped');expect(plans).toHaveLength(1);expect(plans[0].physicalUnits).toBe(2);expect(plans[0].quantity).toBe(2);const result=evaluateManifestLot(lines,DEFAULT_LOT_ASSUMPTIONS);expect(result.expected[1].gross).toBe(result.expected[0].gross);});
});
