import { calculateSurplusMaximumBid } from '@/services/surplusAuctionBidEngine';

describe('SurplusFlip maximum auction bid', () => {
  const base = {
    maximumAllInAcquisitionBudget: 750,
    currentBid: 400,
    buyerPremiumRate: 0.2,
    vatOnPremiumRate: 0.2,
    fixedAuctionCosts: 0,
    transportAndOtherCosts: 0,
    nowIso: '2026-10-26T12:00:00.000Z',
    closesAtIso: '2026-10-26T12:30:00.000Z',
    evidenceSufficient: true,
    bidIncrement: 1,
    safetyBufferRate: 0,
  };

  it('limits the hammer bid to the all-in budget after premium and VAT', () => {
    const result = calculateSurplusMaximumBid(base);
    expect(result.maximumBid).toBe(604);
    expect(result.estimatedAllInCostAtMaximumBid).toBeLessThanOrEqual(750);
    expect(result.estimatedAllInCostAtMaximumBid).toBeGreaterThan(740);
  });

  it('tells the buyer to pass when current bid exceeds the ceiling', () => {
    const result = calculateSurplusMaximumBid({ ...base, currentBid: 700 });
    expect(result.status).toBe('OVER_LIMIT');
    expect(result.recommendation).toContain('PASS');
  });

  it('refuses to recommend a bid when there is no manifest evidence', () => {
    const result = calculateSurplusMaximumBid({ ...base, evidenceSufficient: false });
    expect(result.status).toBe('NO_BID_INSUFFICIENT_EVIDENCE');
  });

  it('reports a closed auction when close time has passed', () => {
    const result = calculateSurplusMaximumBid({
      ...base,
      nowIso: '2026-10-26T13:00:00.000Z',
      closesAtIso: '2026-10-26T12:30:00.000Z',
    });
    expect(result.timeBand).toBe('CLOSED');
    expect(result.secondsRemaining).toBe(0);
  });
});
