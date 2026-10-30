// Manual bidding guidance only. Bid counts are not distinct bidder counts.
export interface LotBiddingInput {
  ceiling: number; currentBid: number | null; increment: number;
  bidCount: number | null; minutesLeft: number | null; blocked?: boolean;
}
export interface LotBiddingAdvice {
  action: 'check' | 'wait' | 'consider' | 'pass' | 'ended';
  nextBid: number | null; suggestedBid: number | null;
  title: string; message: string; activity: string;
}
export function suggestLotBid(input: LotBiddingInput): LotBiddingAdvice {
  const unknown = input.currentBid === null;
  const invalid = input.blocked === true || !Number.isFinite(input.ceiling) || input.ceiling < 0
    || !Number.isFinite(input.increment) || input.increment <= 0
    || (!unknown && (!Number.isFinite(input.currentBid) || input.currentBid! < 0))
    || (input.bidCount !== null && (!Number.isInteger(input.bidCount) || input.bidCount < 0))
    || (input.minutesLeft !== null && (!Number.isFinite(input.minutesLeft) || input.minutesLeft < 0));
  const activity = input.bidCount === null ? 'Bidding activity not entered.'
    : `${input.bidCount} bids entered. This does not tell us how many different bidders there are.`;
  const result = (action: LotBiddingAdvice['action'], title: string, message: string,
    nextBid: number | null = null, suggestedBid: number | null = null): LotBiddingAdvice =>
    ({ action, title, message, nextBid, suggestedBid, activity });
  if (invalid) return result('check', 'Check your figures', 'Confirm the bid, next increase and costs before bidding.');
  if (input.minutesLeft === 0) return result('ended', 'Auction ended', 'Check the auction page. No bid is suggested for an ended auction.');
  if (unknown) return result('check', 'Add the current bid', 'Your base maximum is ready. Add the auction bid for a lower starting suggestion.');
  // Round upwards to avoid suggesting less than the entered minimum increase.
  const nextBid = Math.ceil((input.currentBid! + input.increment - 1e-8) * 100) / 100;
  if (nextBid > input.ceiling || input.ceiling <= 0) return result('pass', 'Do not chase this bid',
    'The next bid would exceed the base maximum. Wait for a cheaper lot rather than increasing the ceiling.', nextBid);
  if (input.minutesLeft !== null && input.minutesLeft > 15) return result('wait', 'Watch first. Keep room to buy lower.',
    input.bidCount !== null && input.bidCount > 0
      ? 'There are already bids and time remains. Check the products and watch the auction before joining in. Do not jump straight to your maximum.'
      : 'There is time to check the lot. There is no need to offer your maximum now. Recheck the price nearer the end.', nextBid);
  return result('consider', 'Start with the smallest next bid',
    input.minutesLeft === null ? 'If you choose to bid, start at the next allowed amount, not the ceiling. Check the time and auction rules first.'
      : input.bidCount !== null && input.bidCount > 0
        ? 'The auction is near its entered end time and has bids. If you choose to join, use the smallest allowed increase. Do not chase above your base maximum.'
        : 'The entered end time is close. If the checks are complete and you choose to bid, try the next allowed amount rather than the maximum.', nextBid, nextBid);
}
