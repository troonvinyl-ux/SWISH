import type { LotBasePrice } from './lotBasePriceService';
import type { LotBiddingAdvice } from './lotBiddingService';

// Same fixed SWISH price rule, no personal budget or hidden recovery deductions.
export function simpleLotAdvice(base: LotBasePrice, bidding: LotBiddingAdvice, stale = false) {
  const actionable = !stale && base.status !== 'invalid' && bidding.action !== 'ended' && bidding.action !== 'pass';
  const candidate = actionable ? bidding.suggestedBid ?? (bidding.action === 'wait' ? bidding.nextBid : null) : null;
  const suggestedBid = candidate !== null && Number.isFinite(candidate) && candidate >= 0 && candidate <= base.maximumHammerBid ? candidate : null;
  const referenceBid = suggestedBid ?? (base.status !== 'invalid' ? base.maximumHammerBid : null);
  const profit = referenceBid === null ? null : Math.round((base.resaleCeiling - referenceBid * base.buyingMultiplier - base.delivery) * 100) / 100;
  return { suggestedBid, referenceBid, profit,
    profitLabel: suggestedBid === null ? 'Profit at the ceiling' : 'Profit at this bid',
    bidLabel: bidding.action === 'wait' ? 'Try this nearer the end' : 'Suggested next bid',
    title: stale ? 'Refresh the auction first' : bidding.action === 'ended' ? 'This auction has ended'
      : base.status === 'invalid' ? 'Check your figures' : base.maximumHammerBid <= 0 ? 'No buying room on this one'
      : bidding.action === 'pass' ? 'Do not chase this one' : bidding.action === 'wait' ? 'Watch now. Bid later.'
      : suggestedBid === null ? 'Your buying ceiling is ready' : 'Aim to win for less',
    message: stale ? 'Update the saved bid and time before bidding.' : bidding.action === 'ended' ? 'No bid is suggested. Your saved price guide is still available.' : bidding.action === 'pass' ? 'The next bid is above the buying ceiling. Try another lot.'
      : base.maximumHammerBid <= 0 ? 'Delivery or excluded stock uses up the buying allowance.'
      : suggestedBid === null ? 'Add the current bid for a lower starting suggestion.' : bidding.action === 'wait' ? 'There is time left. Recheck the live price before placing this bid.'
      : 'Use the smallest allowed increase. Stop at your ceiling.',
  };
}
