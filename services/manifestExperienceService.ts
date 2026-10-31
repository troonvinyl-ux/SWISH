import type { LotEvaluation, LotLine } from './lotEconomicsService';
import { LOT_COST_GROUPS } from '@/constants/manifestExperience';
export function lotMoney(value: number | null | undefined): string {
  return typeof value !== 'number' || !Number.isFinite(value) ? '—' : `£${value.toFixed(2)}`;
}
export function friendlyLotMessage(message: string): string {
  if (/Repeated SKU/.test(message)) return message.replace('Repeated SKU','Repeated product reference').replace('rows kept separate; review duplicate quantities.','check the quantities so you do not count the same stock twice.');
  if (/RRP is supplier/.test(message)) return 'The supplier’s retail prices are a guide, not what buyers will pay.';
  if (/Declared manifest total/.test(message)) return 'The supplier’s total does not match the product prices. Double-check the list.';
  if (/Quantity missing\/invalid/.test(message)) return 'Add the correct quantity before counting this product.';
  if (/EAN|Barcode shared/.test(message)) return 'The barcode needs checking against the product label before it can be used on eBay.';
  if (/Ungraded customer return/.test(message)) return 'This is an untested return. Check that it works and has all its parts.';
  if (/Supplier line total/.test(message)) return 'The quantity and price do not add up. Check this product’s figures.';
  if (/Resolution claim/.test(message)) return 'The camera details disagree. Check the real picture quality before listing.';
  if (/Accessory count/.test(message)) return 'The title and description give different accessory counts. Count what is actually included.';
  if (/Non-GBP/.test(message)) return 'Convert this product’s price to pounds before including it.';
  if (/Safety-critical return/.test(message)) return 'Do not resell this safety item until a qualified person has checked its history and safety.';
  if (/electrical\/battery safety/.test(message)) return 'Check it works, has a safe charger, and has not been recalled.';
  if (/therapeutic claims/.test(message)) return 'Do not copy unproven health claims. Check whether this product can be sold.';
  if (/expiry, hygiene/.test(message)) return 'Check seals, expiry dates, hygiene and selling restrictions.';
  for (const group of LOT_COST_GROUPS) for (const field of group.fields) {
    if (message.includes(field.key)) return `Check “${field.label}”. Use a valid amount${field.percent ? ' between 0 and 100%' : ''}.`;
  }
  if (/Invalid quantity, pack size or price range/.test(message)) return 'Check product quantities, pack sizes and prices. The cautious price cannot be higher than the usual price.';
  if (/Conservative recovery/.test(message)) return 'Your cautious figures cannot be higher than your usual estimates.';
  if (/Number of bids/.test(message)) return 'Enter a whole number of bids.';
  if (/currentBid/.test(message)) return 'Enter a valid current bid in pounds.';
  if (/bidCount/.test(message)) return 'Enter a valid number of bids.';
  if (/minutesLeft/.test(message)) return 'Enter valid minutes remaining. Use zero if the auction has ended.';
  if (/targetProfit|inbound/.test(message)) return 'Check your delivery cost and optional profit cushion. Use positive amounts or zero.';
  if (/Fee rate must/.test(message)) return 'Selling fees must be below 100%, and the next bid must go up by more than zero.';
  return message;
}
export function friendlyManifestError(message: string): string {
  if (/Enter the current bid/i.test(message)) return 'Add the current bid from the auction page, then we can show your plan.';
  if (/file size|5 MB|Split|Maximum 500|exceeds 2 MB/i.test(message)) return 'This list is too large. Try a smaller file or split it into two lists.';
  if (/header not found|No product rows|Unclosed CSV/i.test(message)) return 'We could not read the product list. Check that it includes product titles and quantities, then try again.';
  if (/sign.in|signed.in|business.*load|niche|Authentication|access|entitlement|permission/i.test(message)) return 'Your account needs checking before continuing. Sign in and check your access, then try again.';
  if (/actual paid|hammer|Current bids are not purchases/.test(message)) return 'Enter what you actually paid, only after buying or winning the lot.';
  if (/category|Category/.test(message)) return 'We could not check this product’s eBay category. Try again or finish it in the listing editor.';
  if (/Invalid|Conservative|Fee rate|Number of bids/.test(message)) return friendlyLotMessage(message);
  return 'We could not finish that step. Your list is still here. Check your connection and try again.';
}
export function presentLotVerdict(evaluation: LotEvaluation) {
  const expected = evaluation.expected.find(row => row.strategy === evaluation.best.strategy)!;
  const cautious = evaluation.best;
  const variants = {
    swerve: { title:'Swerve this one', message:'Even the usual selling estimate does not cover the bid and costs. A cheaper price or stronger resale evidence is needed.', tone:'warning' as const, icon:'front-hand' },
    caution: { title:'Profit possible. Check the risk.', message: cautious.profit !== null && cautious.profit <= 0
      ? 'The usual estimate shows a profit, but a cautious sale could leave a loss. Do not treat this as a safe buy.'
      : 'The pallet may make a profit, but the next bid is above the suggested limit for a profit cushion. That is not the same as making a loss.', tone:'warning' as const, icon:'warning-amber' },
    research: { title:'A closer look first', message:'Treat this as a guide. Check real selling prices and the condition before bidding.', tone:'warning' as const, icon:'search' },
    opportunity: { title:'There could be a flip here', message:'Your figures leave room below the limit. Check the products and auction fees before bidding.', tone:'success' as const, icon:'trending-up' },
    ended: { title:'This auction has ended', message:'The time you entered has run out. Check the auction before taking another step.', tone:'neutral' as const, icon:'schedule' },
  };
  return { ...variants[evaluation.decision], expected, cautious,
    priceNote: evaluation.unpriced > 0 ? 'Guide only: some prices are based on the supplier’s retail price, not recent sales.' : 'Based on your selling-price estimates. Profit is not guaranteed.',
    limitNote: 'Bid only · delivery, fees, possible losses and your time are already deducted when setting this limit. Your personal budget is not used.',
    bidNote: evaluation.recommendedMaxBid > 0
      ? 'This leaves a profit cushion in the cautious selling plan. It is not a guaranteed profit.'
      : cautious.profitBeforeBid <= 0
        ? 'No room for a cautious bid: estimated selling costs, delivery, losses and your time already use up the cautious resale proceeds.'
        : 'There is some resale value after costs, but not enough to meet the chosen profit cushion. Check the figures below.',
  };
}
export function bestManifestProducts(lines: LotLine[]): LotLine[] {
  // Sorting for convenience is not a bestseller/demand claim.
  return [...lines].sort((a,b) => b.price * b.quantity - a.price * a.quantity);
}


/** Human-readable explanation of the saved base buying ceiling. */
export function presentBaseLotVerdict(base: import('./lotBasePriceService').LotBasePrice) {
  const variants = {
    invalid: { title: 'Check the figures', message: 'Some amounts are invalid. Correct the figures before relying on this buying ceiling.', tone: 'warning' as const, icon: 'warning-amber' },
    no_value: { title: 'No resale value established', message: 'The eligible resale estimate does not support a buying price.', tone: 'warning' as const, icon: 'block' },
    no_room: { title: 'No room for a bid', message: 'Delivery and buying costs leave no positive hammer-price ceiling.', tone: 'warning' as const, icon: 'front-hand' },
    needs_bid: { title: 'Enter the current bid', message: 'Your maximum hammer bid is a ceiling, not a suggested opening bid.', tone: 'neutral' as const, icon: 'gavel' },
    within_limit: { title: 'Room below the base maximum', message: 'The entered bid is within the calculated base maximum. Recheck fees, condition and live auction details.', tone: 'success' as const, icon: 'check-circle' },
    above_limit: { title: 'Current bid is above the ceiling', message: 'The entered bid exceeds the calculated base maximum. Avoid increasing your bid on these figures.', tone: 'warning' as const, icon: 'trending-down' },
  };
  return { ...variants[base.status], maximumHammerBid: base.maximumHammerBid, maximumPurchasePrice: base.maximumPurchasePrice,
    resaleCeiling: base.resaleCeiling, delivery: base.delivery, profitAtCurrentBid: base.profitAtCurrentBid };
}
