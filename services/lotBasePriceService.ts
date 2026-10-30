import { LOT_RESALE_SHARE, LOT_BUYING_MULTIPLE } from '@/constants/lotPricing';

export interface LotBasePriceInput {
  manifestRrp: number; eligibleRrp: number; inbound: number;
  currentBid: number | null; premiumRate: number; vatRate: number;
  invalid?: boolean;
}
export interface LotBasePrice {
  manifestRrp: number; eligibleRrp: number; resaleCeiling: number;
  landedPurchaseCeiling: number; maximumPurchasePrice: number; maximumHammerBid: number;
  delivery: number; buyingMultiplier: number; profitAtCurrentBid: number | null;
  status: 'invalid' | 'no_value' | 'no_room' | 'needs_bid' | 'within_limit' | 'above_limit';
}
const floorMoney = (amount: number) => Math.max(0, Math.floor((amount + 1e-8) * 100) / 100);
export function calculateLotBasePrice(input: LotBasePriceInput): LotBasePrice {
  const values = [input.manifestRrp, input.eligibleRrp, input.inbound, input.premiumRate, input.vatRate];
  const invalid = input.invalid === true || values.some(value => !Number.isFinite(value) || value < 0 || value > 10000000)
    || input.eligibleRrp > input.manifestRrp + 0.02 || input.premiumRate > 1 || input.vatRate > 1
    || (input.currentBid !== null && (!Number.isFinite(input.currentBid) || input.currentBid < 0 || input.currentBid > 10000000));
  const resaleCeiling = invalid ? 0 : input.eligibleRrp * LOT_RESALE_SHARE;
  const landedPurchaseCeiling = resaleCeiling / LOT_BUYING_MULTIPLE;
  const maximumPurchasePrice = invalid ? 0 : floorMoney(landedPurchaseCeiling - input.inbound);
  const buyingMultiplier = invalid ? 1 : (1 + input.premiumRate) * (1 + input.vatRate);
  // Round only at the end, so delivery and auction charges are not deducted twice.
  const maximumHammerBid = invalid ? 0 : floorMoney((landedPurchaseCeiling - input.inbound) / buyingMultiplier);
  const profitAtCurrentBid = invalid || input.currentBid === null ? null
    : resaleCeiling - input.currentBid * buyingMultiplier - input.inbound;
  const status: LotBasePrice['status'] = invalid ? 'invalid'
    : resaleCeiling <= 0 ? 'no_value' : maximumHammerBid <= 0 ? 'no_room'
      : input.currentBid === null ? 'needs_bid'
        : input.currentBid <= maximumHammerBid ? 'within_limit' : 'above_limit';
  return { manifestRrp: invalid ? 0 : input.manifestRrp, eligibleRrp: invalid ? 0 : input.eligibleRrp,
    resaleCeiling, landedPurchaseCeiling, maximumPurchasePrice, maximumHammerBid,
    delivery: invalid ? 0 : input.inbound, buyingMultiplier, profitAtCurrentBid, status };
}
