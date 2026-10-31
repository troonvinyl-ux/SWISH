import fs from 'node:fs';
import path from 'node:path';
import { normaliseManifest } from '@/services/manifestParser';
import { DEFAULT_LOT_ASSUMPTIONS, evaluateManifestLot, toLotLines, type LotAssumptions } from '@/services/lotEconomicsService';
import { LOT_COST_GROUPS } from '@/constants/manifestExperience';
import { presentLotVerdict } from '@/services/manifestExperienceService';

const rows = () => {
  const result = toLotLines(normaliseManifest([['Title','Quantity','Unit RRP'],['Plain widget',10,100]]).rows);
  Object.assign(result[0], { price:50, conservativePrice:40, priceSource:'user_scenario' });
  return result;
};
const costs = (): LotAssumptions => ({ ...DEFAULT_LOT_ASSUMPTIONS, currentBid:100,
  inbound:0, storage:0, repair:0, reserve:0, labourMinutes:0, hourlyRate:0,
  feeRate:0, fixedFee:0, sellerPostage:0, buyerPostage:0, packaging:0,
  yieldRate:1, conservativeYield:1, sellThrough:1, conservativeSellThrough:1,
  targetProfit:0, targetRoi:0.5 });

describe('Pallet value is independent of a personal budget', () => {
  test('new sessions need neither a budget nor a minimum profit target', () => {
    expect(DEFAULT_LOT_ASSUMPTIONS).not.toHaveProperty('budget');
    expect(DEFAULT_LOT_ASSUMPTIONS.targetProfit).toBe(0);
    const result = evaluateManifestLot(rows(), costs());
    expect(result.errors).toEqual([]);
    expect(result.decision).toBe('opportunity');
    expect(result.recommendedMaxBid).toBe(266.66);
    expect(result.expected[0].profit).toBe(400);
    expect(result.best.profit).toBe(300);
  });
  test.each([null, undefined, 0, 0.01, 1, 500, 10000000, -1, NaN, Infinity])(
    'legacy budget %s cannot change calculations or the verdict', budget => {
      const baseline = evaluateManifestLot(rows(), costs());
      const result = evaluateManifestLot(rows(), { ...costs(), budget });
      expect(result).toEqual(baseline);
    },
  );
  test('tiny historical budgets never incorrectly label a profitable lot a swerve', () => {
    expect(evaluateManifestLot(rows(), { ...costs(), budget:1 }).decision).toBe('opportunity');
  });
  test('price, selling fees, buying charges and time still determine real scenario profit', () => {
    const result = evaluateManifestLot(rows(), { ...costs(), premiumRate:0.2, vatRate:0.2,
      inbound:20, storage:5, repair:10, reserve:5, labourMinutes:6, hourlyRate:20,
      feeRate:0.1, fixedFee:0.4, sellerPostage:3, buyerPostage:2, packaging:0.6 });
    const expected = result.expected[0];
    expect(result.bidMultiplier).toBeCloseTo(1.44);
    expect(result.labourCost).toBeCloseTo(20);
    expect(result.otherLotCosts).toBeCloseTo(40);
    expect(result.fixedLotCosts).toBeCloseTo(60);
    expect(expected.gross).toBeCloseTo(520);
    expect(expected.sellingCosts).toBeCloseTo(92);
    expect(expected.allInCost).toBeCloseTo(204);
    expect(expected.profit).toBeCloseTo(224);
    expect(expected.profit).toBeCloseTo(expected.gross - expected.sellingCosts - expected.allInCost!);
  });
});

describe('Suggested bid is not a binary claim of profitability', () => {
  test('positive usual profit and cautious loss are shown as risk, not both called unprofitable', () => {
    const input = rows();
    Object.assign(input[0], { quantity:1, price:718.08, conservativePrice:70.91 });
    const result = evaluateManifestLot(input, { ...costs(), inbound:50 });
    const display = presentLotVerdict(result);
    expect(display.expected.profit).toBeCloseTo(568.08, 2);
    expect(display.cautious.profit).toBeCloseTo(-79.09, 2);
    expect(result.recommendedMaxBid).toBe(0);
    expect(result.best.breakEvenHammer).toBe(20.91);
    expect(result.decision).toBe('caution');
    expect(display.title).toBe('Profit possible. Check the risk.');
    expect(display.message).toContain('cautious sale could leave a loss');
    expect(display.bidNote).toContain('chosen profit cushion');
  });
  test('exceeding a profit cushion while both cases are profitable is not called a loss', () => {
    const result = evaluateManifestLot(rows(), { ...costs(), currentBid:300 });
    expect(result.best.profit).toBe(100);
    expect(result.decision).toBe('caution');
    expect(presentLotVerdict(result).message).toContain('not the same as making a loss');
  });
  test('optional profit target affects only the cushion, not calculated profit', () => {
    const baseline = evaluateManifestLot(rows(), costs());
    const result = evaluateManifestLot(rows(), { ...costs(), targetProfit:1000 });
    expect(result.expected).toEqual(baseline.expected.map(s => ({ ...s, maxHammer:0 })));
    expect(result.best.profit).toBe(baseline.best.profit);
    expect(result.recommendedMaxBid).toBe(0);
    expect(result.decision).toBe('caution');
  });
  test('a lot losing money in the usual scenario still says swerve', () => {
    const result = evaluateManifestLot(rows(), { ...costs(), currentBid:600 });
    expect(result.expected[0].profit).toBe(-100);
    expect(result.decision).toBe('swerve');
  });
  test('break-even and suggested ceiling use the same scenario, with a cushion below break-even', () => {
    const result = evaluateManifestLot(rows(), costs());
    expect(result.best.breakEvenHammer).toBe(400);
    expect(result.recommendedMaxBid).toBeLessThan(result.best.breakEvenHammer);
    const atLimit = evaluateManifestLot(rows(), { ...costs(), currentBid:result.recommendedMaxBid });
    expect(atLimit.best.profit).toBeGreaterThan(0);
  });
  test('a zero ceiling caused by costs is explained rather than declaring stock worthless', () => {
    const result = evaluateManifestLot(rows(), { ...costs(), inbound:450 });
    expect(result.best.profitBeforeBid).toBe(-50);
    expect(result.recommendedMaxBid).toBe(0);
    expect(presentLotVerdict(result).bidNote).toContain('use up the cautious resale proceeds');
  });
  test('RRP-only guides never become verified profitable opportunities', () => {
    const input = rows(); input[0].priceSource = 'rrp_assumption';
    const result = evaluateManifestLot(input, costs());
    expect(result.decision).toBe('research');
    expect(presentLotVerdict(result).priceNote).toContain('not recent sales');
  });
  test('invalid economic inputs still fail closed even without a budget', () => {
    const result = evaluateManifestLot(rows(), { ...costs(), feeRate:1.1 });
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.recommendedMaxBid).toBe(0);
    expect(result.decision).toBe('research');
  });
  test('missing bid has unknown profit but a calculable suggested ceiling', () => {
    const result = evaluateManifestLot(rows(), { ...costs(), currentBid:null });
    expect(result.expected[0].profit).toBeNull();
    expect(result.recommendedMaxBid).toBe(266.66);
  });
  test('competition cannot raise the economic bid ceiling', () => {
    const baseline = evaluateManifestLot(rows(), costs());
    const result = evaluateManifestLot(rows(), { ...costs(), bidCount:999, minutesLeft:1 });
    expect(result.recommendedMaxBid).toBe(baseline.recommendedMaxBid);
  });
  test('safety exclusions still apply with no personal limit', () => {
    const input = rows(); input[0].title = 'Returned bike helmet';
    const result = evaluateManifestLot(input, costs());
    expect(result.excluded).toBe(10);
    expect(result.best.gross).toBe(0);
    expect(result.recommendedMaxBid).toBe(0);
  });
});

describe('Budget-free shared workspace contracts (not device tests)', () => {
  test('UI no longer asks for budget and explains costs and break-even', () => {
    const ui = fs.readFileSync(path.resolve(__dirname, '../../components/feature/ManifestOpportunityWorkspace.tsx'), 'utf8');
    expect(ui).not.toContain('draft.assumptions.budget');
    expect(ui).not.toContain('Total spending limit');
    expect(ui).not.toContain('Profit you want');
    expect(ui).toContain('Suggested maximum bid');
    expect(ui).toContain('Break-even bid');
    expect(ui).toContain('evaluation.labourCost');
  });
  test('optional target stays available without reintroducing a budget field', () => {
    const fields = LOT_COST_GROUPS.flatMap(group => group.fields.map(field => field.key));
    expect(fields).toContain('targetProfit');
    expect(fields).toContain('targetRoi');
    expect(fields).not.toContain('budget');
  });
});
