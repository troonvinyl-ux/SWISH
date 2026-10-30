import type { ManifestProduct } from './manifestParser';
export const LOT_ENGINE_VERSION = 'manifest-lot-v1';
export interface LotLine extends ManifestProduct {
  include: boolean; price: number; conservativePrice: number; priceSource: 'rrp_assumption' | 'user_scenario';
  packSize: number; packPrice: number; inspected: boolean; safetyConfirmed: boolean;
  categoryId?: string; categoryName?: string; specifics?: Array<{ name: string; value: string }>;
  requiredSpecifics?: string[]; taxonomyChecked?: boolean;
}
export interface LotAssumptions {
  currentBid: number | null; bidCount: number | null; minutesLeft: number | null; increment: number;
  premiumRate: number; vatRate: number; inbound: number; storage: number; repair: number; reserve: number;
  feeRate: number; fixedFee: number; sellerPostage: number; buyerPostage: number; packaging: number;
  labourMinutes: number; hourlyRate: number; yieldRate: number; conservativeYield: number;
  sellThrough: number; conservativeSellThrough: number; bundleDiscount: number;
  targetProfit: number; targetRoi: number; budget: number; wholeLotPrice: number; wholeLotConservative: number;
}
export const DEFAULT_LOT_ASSUMPTIONS: LotAssumptions = {
  currentBid: null, bidCount: null, minutesLeft: null, increment: 1, premiumRate: 0, vatRate: 0,
  inbound: 20, storage: 0, repair: 0, reserve: 10, feeRate: 0.15, fixedFee: 0.4,
  sellerPostage: 3.5, buyerPostage: 0, packaging: 0.6, labourMinutes: 12, hourlyRate: 15,
  yieldRate: 0.65, conservativeYield: 0.45, sellThrough: 0.85, conservativeSellThrough: 0.6,
  bundleDiscount: 0.1, targetProfit: 50, targetRoi: 0.5, budget: 500, wholeLotPrice: 0, wholeLotConservative: 0,
};
export function toLotLines(rows: ManifestProduct[]): LotLine[] {
  return rows.map(row => ({ ...row, include: row.quantity > 0 && row.currency === 'GBP', price: row.unitRrp * 0.5,
    conservativePrice: row.unitRrp * 0.3, priceSource: 'rrp_assumption', packSize: 1, packPrice: 0,
    inspected: false, safetyConfirmed: false }));
}
export function lotSafetyNotes(row: LotLine): string[] {
  const text = `${row.title} ${row.category}`.toLowerCase(); const notes: string[] = [];
  if (/helmet|harness|child.*seat|car seat/.test(text)) notes.push('Safety-critical return: exclude resale until provenance, impact history and safety are verified by a competent person.');
  if (/heated|electric|rechargeable|battery|lamp|charger/.test(text)) notes.push('Check electrical/battery safety, recall status, charger and function. Supplier claims are not test evidence.');
  if (/massager|pain relief/.test(text)) notes.push('Do not copy unverified therapeutic claims; check suitability and product restrictions.');
  if (/cosmetic|perfume|skincare/.test(text)) notes.push('Check original packaging, expiry, hygiene and marketplace restrictions.');
  return notes;
}
export function lineBlocked(row: LotLine): boolean {
  return /helmet|harness|child.*seat|car seat/i.test(row.title) && !row.safetyConfirmed;
}
export interface LotScenario {
  strategy: 'individual' | 'grouped' | 'whole'; gross: number; sellingCosts: number; netBeforePurchase: number;
  expectedOrders: number; allInCost: number | null; profit: number | null; roi: number | null;
  maxHammer: number; breakEvenHammer: number;
}
export interface LotEvaluation {
  expected: LotScenario[]; conservative: LotScenario[]; best: LotScenario; recommendedMaxBid: number;
  decision: 'research' | 'opportunity' | 'swerve' | 'ended'; reasoning: string[]; errors: string[];
  fixedLotCosts: number; bidMultiplier: number; units: number; rrp: number; unpriced: number; excluded: number;
}
const pennyFloor = (n: number) => Math.max(0, Math.floor((n + 1e-8) * 100) / 100);
export function evaluateManifestLot(lines: LotLine[], a: LotAssumptions): LotEvaluation {
  const errors: string[] = [];
  for (const [name, value] of Object.entries(a)) {
    const optional = ['currentBid','bidCount','minutesLeft'].includes(name);
    if (value === null && !optional || value !== null && (!Number.isFinite(value) || value < 0 || value > 10000000)) errors.push(`Invalid ${name}; use a finite non-negative value.`);
  }
  for (const name of ['premiumRate','vatRate','feeRate','yieldRate','conservativeYield','sellThrough','conservativeSellThrough','bundleDiscount'] as const) if (a[name] > 1) errors.push(`${name} must be between 0 and 100%.`);
  if (a.bidCount !== null && !Number.isInteger(a.bidCount)) errors.push('Number of bids must be a whole number.');
  if (a.feeRate >= 1 || a.increment <= 0) errors.push('Fee rate must be below 100%; bid increment must be positive.');
  if (a.conservativeYield > a.yieldRate || a.conservativeSellThrough > a.sellThrough || a.wholeLotConservative > a.wholeLotPrice) errors.push('Conservative recovery and prices must not exceed the expected scenario.');
  lines.forEach(row => { if (![row.quantity,row.price,row.conservativePrice,row.packSize,row.packPrice].every(v => Number.isFinite(v) && v >= 0 && v <= 10000000) || !Number.isInteger(row.quantity) || !Number.isInteger(row.packSize) || row.packSize < 1 || row.conservativePrice > row.price) errors.push(`Invalid quantity, pack size or price range: ${row.sku || row.title}.`); });
  const units = lines.reduce((sum, row) => sum + row.quantity, 0);
  const fixedLotCosts = a.inbound + a.storage + a.repair + a.reserve + units * a.labourMinutes / 60 * a.hourlyRate;
  const bidMultiplier = (1 + a.premiumRate) * (1 + a.vatRate);
  const eligible = lines.filter(row => row.include && row.quantity > 0 && row.currency === 'GBP' && !lineBlocked(row));
  const scenario = (strategy: LotScenario['strategy'], conservative: boolean): LotScenario => {
    const yieldRate = conservative ? a.conservativeYield : a.yieldRate;
    const sellThrough = conservative ? a.conservativeSellThrough : a.sellThrough;
    let gross = 0, orders = 0;
    const sale = (price: number, count: number) => { gross += (price + a.buyerPostage) * count; orders += count; };
    if (strategy === 'whole') { const p = conservative ? a.wholeLotConservative : a.wholeLotPrice; if (p > 0) sale(p, sellThrough); }
    else for (const row of eligible) {
      const price = conservative ? row.conservativePrice : row.price;
      if (price <= 0) continue;
      if (strategy === 'grouped' && row.packSize > 1) {
        const packs = Math.floor(row.quantity / row.packSize), remainder = row.quantity % row.packSize;
        const packPrice = row.packPrice > 0 ? row.packPrice * (conservative && row.price > 0 ? row.conservativePrice / row.price : 1) : price * row.packSize * (1 - a.bundleDiscount);
        sale(packPrice, packs * yieldRate * sellThrough); sale(price, remainder * yieldRate * sellThrough);
      } else sale(price, row.quantity * yieldRate * sellThrough);
    }
    const sellingCosts = gross * a.feeRate + orders * (a.fixedFee + a.sellerPostage + a.packaging);
    const netBeforePurchase = gross - sellingCosts;
    const allInCost = a.currentBid === null ? null : a.currentBid * bidMultiplier + fixedLotCosts;
    const profit = allInCost === null ? null : netBeforePurchase - allInCost;
    const capAllIn = Math.min(netBeforePurchase - a.targetProfit, netBeforePurchase / (1 + a.targetRoi), a.budget);
    return { strategy, gross, sellingCosts, netBeforePurchase, expectedOrders: orders, allInCost, profit,
      roi: profit !== null && allInCost !== null && allInCost > 0 ? profit / allInCost : null,
      maxHammer: errors.length ? 0 : pennyFloor((capAllIn - fixedLotCosts) / bidMultiplier),
      breakEvenHammer: errors.length ? 0 : pennyFloor((netBeforePurchase - fixedLotCosts) / bidMultiplier) };
  };
  const expected = (['individual','grouped','whole'] as const).map(s => scenario(s, false));
  const conservative = (['individual','grouped','whole'] as const).map(s => scenario(s, true));
  const usableConservative = conservative.filter(s => s.strategy !== 'whole' || a.wholeLotConservative > 0);
  const best = usableConservative.reduce((prev, cur) => cur.netBeforePurchase > prev.netBeforePurchase ? cur : prev, conservative[0]);
  const recommendedMaxBid = best.maxHammer;
  const unpriced = eligible.filter(row => row.price <= 0 || row.priceSource === 'rrp_assumption').length;
  const excluded = lines.filter(row => !eligible.includes(row)).reduce((sum, row) => sum + row.quantity, 0);
  let decision: LotEvaluation['decision'] = 'research';
  if (a.minutesLeft === 0) decision = 'ended';
  else if (!errors.length && a.currentBid !== null && (recommendedMaxBid <= 0 || a.currentBid + a.increment > recommendedMaxBid)) decision = 'swerve';
  else if (!errors.length && a.currentBid !== null && unpriced === 0 && recommendedMaxBid > 0 && eligible.length > 0) decision = 'opportunity';
  const reasoning = [
    `Maximum hammer bid uses the conservative ${best.strategy} exit, after all entered costs, your profit/ROI targets and all-in budget.`,
    'Bid count and time remaining describe competition/urgency, not intrinsic value; they never raise the cap. No bids are placed.',
    'Recovery and sell-through percentages are user assumptions, not measured sales probabilities. Fractional orders are expected outcomes, not stock counts.',
  ];
  if (unpriced) reasoning.push(`${unpriced} lines still rely on RRP assumptions or missing prices. Validate comparable prices before bidding.`);
  if (a.currentBid === null) reasoning.push('Enter the current hammer bid to assess this live opportunity.');
  if (excluded) reasoning.push(`${excluded} units excluded from individual/group revenue; inspection labour and full lot purchase costs remain. Whole-lot scenarios require your own compliant lot valuation.`);
  if (a.minutesLeft !== null && a.minutesLeft > 0 && a.minutesLeft < 15) reasoning.push('Little inspection/research time remains. Do not skip checks or chase a bid.');
  return { expected, conservative, best, recommendedMaxBid, decision, reasoning, errors, fixedLotCosts, bidMultiplier,
    units, rrp: lines.reduce((sum, row) => sum + row.totalRrp, 0), unpriced, excluded };
}
