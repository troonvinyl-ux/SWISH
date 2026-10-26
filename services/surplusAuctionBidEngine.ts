/**
 * SurplusFlip timed-auction bid calculator.
 *
 * This converts the maximum acquisition budget from the manifest valuation
 * engine into a maximum hammer bid after auction-specific charges. It never
 * fetches or invents live auction data: the UI must supply the current bid,
 * closing time, and the auction's published fee/VAT terms.
 */

export type BidStatus = 'BID_WITHIN_LIMIT' | 'AT_LIMIT' | 'OVER_LIMIT' | 'NO_BID_INSUFFICIENT_EVIDENCE';

export interface AuctionBidInput {
  /** Maximum total acquisition spend the deal model can support, including the hammer price and all acquisition costs. */
  maximumAllInAcquisitionBudget: number;
  currentBid: number;
  /** Buyer premium as a proportion of hammer price, e.g. 0.2 for 20%. */
  buyerPremiumRate: number;
  /** VAT applied to the buyer premium, commonly 0.2 where applicable. */
  vatOnPremiumRate?: number;
  /** VAT applied to hammer price, only when auction terms specify it. */
  vatOnHammerRate?: number;
  /** Fixed auction/admin charges, including VAT where applicable. */
  fixedAuctionCosts?: number;
  /** Collection/delivery and other costs not already included in the deal budget. */
  transportAndOtherCosts?: number;
  /** Current time and auction end as ISO timestamps. */
  nowIso: string;
  closesAtIso: string;
  /** Whether the underlying manifest valuation has enough evidence to bid. */
  evidenceSufficient: boolean;
  /** Optional auction bid increment; used to round the maximum down to a legal bid step. */
  bidIncrement?: number;
  /** Optional buffer kept back for uncertainty; e.g. 0.05 means 5%. */
  safetyBufferRate?: number;
}

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
  assumptions: Record<string, number | string | boolean>;
}

const money = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const nonNegative = (v: number | undefined) => Math.max(0, Number.isFinite(v) ? (v ?? 0) : 0);
const rate = (v: number | undefined) => Math.max(0, Math.min(1, Number.isFinite(v) ? (v ?? 0) : 0));

function allInHammerCost(hammer: number, input: AuctionBidInput): number {
  const premium = hammer * rate(input.buyerPremiumRate);
  const premiumVat = premium * rate(input.vatOnPremiumRate);
  const hammerVat = hammer * rate(input.vatOnHammerRate);
  return hammer + premium + premiumVat + hammerVat
    + nonNegative(input.fixedAuctionCosts) + nonNegative(input.transportAndOtherCosts);
}

export function calculateSurplusMaximumBid(input: AuctionBidInput): AuctionBidResult {
  const budget = nonNegative(input.maximumAllInAcquisitionBudget)
    * (1 - rate(input.safetyBufferRate));
  const current = nonNegative(input.currentBid);
  const now = Date.parse(input.nowIso);
  const closes = Date.parse(input.closesAtIso);
  const secondsRemaining = Number.isFinite(now) && Number.isFinite(closes)
    ? Math.max(0, Math.floor((closes - now) / 1000))
    : 0;
  const increment = nonNegative(input.bidIncrement);
  const variableMultiplier = 1 + rate(input.buyerPremiumRate)
    + rate(input.buyerPremiumRate) * rate(input.vatOnPremiumRate)
    + rate(input.vatOnHammerRate);
  const fixed = nonNegative(input.fixedAuctionCosts) + nonNegative(input.transportAndOtherCosts);
  const rawMaximum = Math.max(0, (budget - fixed) / variableMultiplier);
  const maximumBid = increment > 0
    ? money(Math.floor((rawMaximum + 1e-9) / increment) * increment)
    : money(rawMaximum);
  const estimatedAtCurrent = money(allInHammerCost(current, input));
  const estimatedAtMaximum = money(allInHammerCost(maximumBid, input));
  const headroom = money(maximumBid - current);
  const status: BidStatus = !input.evidenceSufficient
    ? 'NO_BID_INSUFFICIENT_EVIDENCE'
    : current > maximumBid ? 'OVER_LIMIT'
    : Math.abs(current - maximumBid) < 0.005 ? 'AT_LIMIT'
    : 'BID_WITHIN_LIMIT';
  const timeBand: AuctionBidResult['timeBand'] = secondsRemaining <= 0 ? 'CLOSED'
    : secondsRemaining < 60 ? 'UNDER_1_MIN'
    : secondsRemaining < 300 ? 'UNDER_5_MIN'
    : secondsRemaining < 3600 ? 'UNDER_1_HOUR'
    : 'OVER_1_HOUR';
  const recommendation = !input.evidenceSufficient
    ? 'DO NOT BID: reliable resale evidence is insufficient. Review the manifest or research more sold comparables.'
    : secondsRemaining <= 0
      ? 'Auction appears closed. Refresh the auction status before taking any action.'
      : status === 'OVER_LIMIT'
        ? 'PASS: the current bid is already above the calculated maximum. Do not chase the auction.'
        : status === 'AT_LIMIT'
          ? 'At the limit. Do not increase your bid beyond the maximum shown.'
          : 'Bid only up to the displayed maximum. Treat it as a hard ceiling, not a target.';
  return {
    status,
    maximumBid,
    currentBid: money(current),
    headroom,
    estimatedAllInCostAtCurrentBid: estimatedAtCurrent,
    estimatedAllInCostAtMaximumBid: estimatedAtMaximum,
    secondsRemaining,
    timeBand,
    recommendation,
    assumptions: {
      maximumAllInAcquisitionBudget: money(nonNegative(input.maximumAllInAcquisitionBudget)),
      safetyBufferRate: rate(input.safetyBufferRate),
      buyerPremiumRate: rate(input.buyerPremiumRate),
      vatOnPremiumRate: rate(input.vatOnPremiumRate),
      vatOnHammerRate: rate(input.vatOnHammerRate),
      fixedAuctionCosts: money(nonNegative(input.fixedAuctionCosts)),
      transportAndOtherCosts: money(nonNegative(input.transportAndOtherCosts)),
      bidIncrement: increment,
      liveBidAutomaticallyFetched: false,
    },
  };
}
