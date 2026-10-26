/**
 * SurplusFlip maximum hammer-bid calculator.
 * Live auction values are supplied by the caller; no bid or time is fabricated.
 */
export interface AuctionBidInput {
  maximumAllInAcquisitionBudget: number;
  currentBid: number;
  buyerPremiumRate: number;
  vatOnPremiumRate?: number;
  vatOnHammerRate?: number;
  fixedAuctionCosts?: number;
  transportAndOtherCosts?: number;
  nowIso: string;
  closesAtIso: string;
  evidenceSufficient: boolean;
  bidIncrement?: number;
  safetyBufferRate?: number;
}
export type BidStatus = 'BID_WITHIN_LIMIT' | 'AT_LIMIT' | 'OVER_LIMIT' | 'NO_BID_INSUFFICIENT_EVIDENCE';
export interface AuctionBidResult {
  status: BidStatus;
  maximumBid: number;
  currentBid: number;
  headroom: number;
  estimatedAllInCostAtCurrentBid: number;
  estimatedAllInCostAtMaximumBid: number;
  secondsRemaining: number;
  timeBand: 'CLOSED' | 'UNDER_1_MIN' | 'UNDER_5_MIN' | 'UNDER_1_HOUR' | 'OVER_1_HOUR';
  recommendation: string;
}
const money = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const nn = (v: number | undefined) => Math.max(0, Number.isFinite(v) ? (v ?? 0) : 0);
const rate = (v: number | undefined) => Math.max(0, Math.min(1, Number.isFinite(v) ? (v ?? 0) : 0));
function allIn(hammer: number, i: AuctionBidInput) {
  const premium = hammer * rate(i.buyerPremiumRate);
  return hammer + premium + premium * rate(i.vatOnPremiumRate)
    + hammer * rate(i.vatOnHammerRate) + nn(i.fixedAuctionCosts) + nn(i.transportAndOtherCosts);
}
export function calculateSurplusMaximumBid(i: AuctionBidInput): AuctionBidResult {
  const budget = nn(i.maximumAllInAcquisitionBudget) * (1 - rate(i.safetyBufferRate));
  const now = Date.parse(i.nowIso), close = Date.parse(i.closesAtIso);
  const secondsRemaining = Number.isFinite(now) && Number.isFinite(close) ? Math.max(0, Math.floor((close-now)/1000)) : 0;
  const fixed = nn(i.fixedAuctionCosts) + nn(i.transportAndOtherCosts);
  const multiplier = 1 + rate(i.buyerPremiumRate) + rate(i.buyerPremiumRate)*rate(i.vatOnPremiumRate) + rate(i.vatOnHammerRate);
  const raw = Math.max(0, (budget-fixed)/multiplier);
  const step = nn(i.bidIncrement);
  const maximumBid = step > 0 ? money(Math.floor((raw+1e-9)/step)*step) : money(raw);
  const currentBid = money(nn(i.currentBid));
  const headroom = money(maximumBid-currentBid);
  const status: BidStatus = !i.evidenceSufficient ? 'NO_BID_INSUFFICIENT_EVIDENCE'
    : currentBid > maximumBid ? 'OVER_LIMIT'
    : Math.abs(currentBid-maximumBid)<0.005 ? 'AT_LIMIT' : 'BID_WITHIN_LIMIT';
  const timeBand: AuctionBidResult['timeBand'] = secondsRemaining<=0?'CLOSED':secondsRemaining<60?'UNDER_1_MIN':secondsRemaining<300?'UNDER_5_MIN':secondsRemaining<3600?'UNDER_1_HOUR':'OVER_1_HOUR';
  const recommendation = !i.evidenceSufficient
    ? 'DO NOT BID: no manifest loaded. Load a manifest and review its totals first.'
    : secondsRemaining<=0 ? 'Auction appears closed. Refresh the auction listing before acting.'
    : status==='OVER_LIMIT' ? 'PASS: current bid is above the maximum. Do not chase it.'
    : status==='AT_LIMIT' ? 'At the limit. Do not bid higher.'
    : 'Bid only up to the maximum shown. Treat it as a hard ceiling, not a target.';
  return {
    status, maximumBid, currentBid, headroom,
    estimatedAllInCostAtCurrentBid:money(allIn(currentBid,i)),
    estimatedAllInCostAtMaximumBid:money(allIn(maximumBid,i)),
    secondsRemaining, timeBand, recommendation,
  };
}
