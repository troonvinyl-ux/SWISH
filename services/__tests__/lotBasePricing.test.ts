import fs from 'node:fs';
import path from 'node:path';
import { calculateLotBasePrice } from '@/services/lotBasePriceService';
import { suggestLotBid } from '@/services/lotBiddingService';
import { DEFAULT_LOT_ASSUMPTIONS, evaluateManifestLot, toLotLines } from '@/services/lotEconomicsService';
import { normaliseManifest } from '@/services/manifestParser';
import { presentBaseLotVerdict } from '@/services/manifestExperienceService';
const baseInput = () => ({ manifestRrp: 10000, eligibleRrp: 10000, inbound: 0, currentBid: null, premiumRate: 0, vatRate: 0 });
const source = (file: string) => fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8');
const rows = () => toLotLines(normaliseManifest([['Title','Quantity','Unit RRP'],['Plain widget',100,100]]).rows);
const bidding = () => ({ ceiling: 100, currentBid: 20, increment: 1, bidCount: null, minutesLeft: null });

describe('Fixed SWISH base maximum', () => {
  test('£10,000 retail becomes £4,000 resale and approximately £1,777.78 buying room', () => {
    const result = calculateLotBasePrice(baseInput());
    expect(result.resaleCeiling).toBe(4000);
    expect(result.landedPurchaseCeiling).toBeCloseTo(1777.777777, 5);
    expect(result.maximumHammerBid).toBe(1777.77); // ceiling is rounded down, not overbid by a penny
    expect(result.maximumHammerBid * 2.25).toBeLessThanOrEqual(4000);
    expect(result.status).toBe('needs_bid');
  });
  test('only inbound delivery reduces the base purchase price', () => {
    const result = calculateLotBasePrice({ ...baseInput(), inbound: 100 });
    expect(result.maximumPurchasePrice).toBe(1677.77);
    expect(result.maximumHammerBid).toBe(1677.77);
  });
  test('auction charges convert buying room to hammer without charging delivery twice', () => {
    const result = calculateLotBasePrice({ ...baseInput(), inbound:100, premiumRate:0.2, vatRate:0.2 });
    expect(result.maximumPurchasePrice).toBe(1677.77);
    expect(result.maximumHammerBid).toBe(1165.12);
    expect(result.maximumHammerBid * 1.44 + 100).toBeLessThanOrEqual(result.landedPurchaseCeiling);
  });
  test('default per-product draft price is 60% off retail', () => {
    expect(rows()[0].price).toBe(40);
    expect(DEFAULT_LOT_ASSUMPTIONS.sellerPostage).toBe(0);
  });
  test('budget, target profit, time, activity, outgoing postage and extra costs cannot move the base ceiling', () => {
    const baseline = evaluateManifestLot(rows(), DEFAULT_LOT_ASSUMPTIONS).base;
    const changed = evaluateManifestLot(rows(), { ...DEFAULT_LOT_ASSUMPTIONS, budget:1,
      targetProfit:9999, targetRoi:20, labourMinutes:100, hourlyRate:30, reserve:500,
      sellerPostage:5, buyerPostage:5, feeRate:0.2, packaging:10, bidCount:900, minutesLeft:1 }).base;
    expect(changed).toEqual(baseline);
    expect(baseline.maximumHammerBid).toBe(1757.77);
  });
  test('a zero cautious bid no longer replaces a positive base maximum', () => {
    const result = evaluateManifestLot(rows(), { ...DEFAULT_LOT_ASSUMPTIONS, currentBid:100, labourMinutes:100 });
    expect(result.recommendedMaxBid).toBe(0);
    expect(result.base.maximumHammerBid).toBe(1757.77);
    expect(presentBaseLotVerdict(result.base).title).toBe('Room below the base maximum');
  });
  test('safety exclusions reduce eligible retail, not safety safeguards', () => {
    const input = rows(); input[0].title = 'Returned bike helmet';
    const result = evaluateManifestLot(input, DEFAULT_LOT_ASSUMPTIONS);
    expect(result.base.manifestRrp).toBe(10000);
    expect(result.base.eligibleRrp).toBe(0);
    expect(result.base.maximumHammerBid).toBe(0);
  });
  test('total-only manifests recover the unit reference without counting quantity twice', () => {
    const input = toLotLines(normaliseManifest([['Title','Quantity','Total RRP'],['Widget',100,10000]]).rows);
    expect(input[0].unitRrp).toBe(100);
    expect(evaluateManifestLot(input, DEFAULT_LOT_ASSUMPTIONS).base.resaleCeiling).toBe(4000);
  });
  test('high delivery uses up buying room but does not call stock worthless', () => {
    const result = calculateLotBasePrice({ ...baseInput(), inbound:2000 });
    expect(result.status).toBe('no_room'); expect(result.resaleCeiling).toBe(4000);
  });
  test.each([NaN, Infinity, -1])('invalid retail price %s cannot produce a usable maximum', eligibleRrp => {
    expect(calculateLotBasePrice({ ...baseInput(), eligibleRrp }).status).toBe('invalid');
  });
});

describe('Manual bidding suggestions stay below intrinsic value', () => {
  test('missing bid still allows base valuation but never invents an opening offer', () => {
    expect(suggestLotBid({ ...bidding(), currentBid:null }).suggestedBid).toBeNull();
    expect(source('hooks/useManifestOpportunity.ts')).not.toContain("if (draft.assumptions.currentBid === null) { setError");
  });
  test('time remaining suggests watching rather than jumping to the maximum', () => {
    const advice = suggestLotBid({ ...bidding(), minutesLeft:120, bidCount:12 });
    expect(advice.action).toBe('wait'); expect(advice.nextBid).toBe(21); expect(advice.suggestedBid).toBeNull();
  });
  test('near closing uses only the smallest entered increase, not a made-up winning price', () => {
    expect(suggestLotBid({ ...bidding(), minutesLeft:2, bidCount:30 }).suggestedBid).toBe(21);
  });
  test('bid count is not falsely described as distinct bidders', () => {
    expect(suggestLotBid({ ...bidding(), bidCount:12 }).activity).toContain('does not tell us how many different bidders');
  });
  test('heavy activity and urgency cannot justify a bid above the ceiling', () => {
    const advice = suggestLotBid({ ...bidding(), currentBid:100, minutesLeft:1, bidCount:900 });
    expect(advice.action).toBe('pass'); expect(advice.suggestedBid).toBeNull();
  });
  test('exact next-bid ceiling is allowed; one penny above is not', () => {
    expect(suggestLotBid({ ...bidding(), ceiling:21 }).suggestedBid).toBe(21);
    expect(suggestLotBid({ ...bidding(), ceiling:20.99 }).suggestedBid).toBeNull();
  });
  test('ended and invalid auctions have no suggested bid', () => {
    expect(suggestLotBid({ ...bidding(), minutesLeft:0 }).action).toBe('ended');
    expect(suggestLotBid({ ...bidding(), increment:0 }).action).toBe('check');
    expect(suggestLotBid({ ...bidding(), blocked:true }).suggestedBid).toBeNull();
  });
  test('smallest-bid rounding never undercuts the entered increase', () => {
    const result = suggestLotBid({ ...bidding(), increment:0.005 });
    expect(result.suggestedBid).toBe(20.01);
  });
  test('simple UI shows one offer and its profit without a competing cautious ceiling', () => {
    const ui = source('components/feature/ManifestOpportunityWorkspace.tsx');
    expect(ui).toContain('Base maximum purchase price');
    expect(ui).toContain('evaluation.base.maximumHammerBid');
    expect(ui).toContain('simpleAdvice.suggestedBid');
    expect(ui).toContain('simpleAdvice.profit');
    expect(ui).not.toContain('Separate cautious buying guide');
    expect(ui).toContain('not take-home profit');
    expect(ui).not.toContain('50% of the supplier');
  });
});
