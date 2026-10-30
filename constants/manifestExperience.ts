import type { LotAssumptions } from '@/services/lotEconomicsService';
export type ManifestPhase = 'choosing' | 'reading' | 'checking' | 'planning' | 'saving' | 'categories';
export const MANIFEST_PHASES: Record<ManifestPhase, { title: string; detail: string; icon: string }> = {
  choosing: { title: 'Bring on your manifest…', detail: 'Choose the list that came with your lot.', icon: 'upload-file' },
  reading: { title: 'Fetching your manifest…', detail: 'Opening your file and reading the products.', icon: 'description' },
  checking: { title: 'Checking your manifest…', detail: 'Counting products and spotting details to double-check.', icon: 'fact-check' },
  planning: { title: 'Finding the best way to sell…', detail: 'Comparing singles, packs and the whole lot. A little magic, a lot of maths.', icon: 'auto-awesome' },
  saving: { title: 'Getting your lot ready…', detail: 'Saving your purchase and preparing listings for your review.', icon: 'inventory-2' },
  categories: { title: 'Finding its place on eBay…', detail: 'Checking where this product belongs and what buyers need to know.', icon: 'storefront' },
};
export const LOT_STEPS = ['Add your list', 'Tell us the bid', 'See your plan'] as const;
export const SALE_OPTIONS = [
  { id: 'individual', label: 'One by one', hint: 'Sell each product separately', icon: 'sell' },
  { id: 'grouped', label: 'In packs', hint: 'Group identical products together', icon: 'widgets' },
  { id: 'whole', label: 'The whole lot', hint: 'One sale for everything', icon: 'inventory-2' },
] as const;
export interface LotCostField { key: Exclude<keyof LotAssumptions, 'budget'>; label: string; percent?: boolean }
export const LOT_COST_GROUPS: Array<{ title: string; hint: string; fields: LotCostField[] }> = [
  { title: 'Buying & getting it home', hint: 'Check the auction checkout for extra fees. Zero is not confirmation that a fee is free.', fields: [
    { key:'increment',label:'Amount the next bid goes up (£)' }, { key:'premiumRate',label:'Auction buyer fee (%)',percent:true },
    { key:'vatRate',label:'Auction tax you cannot reclaim (%)',percent:true }, { key:'storage',label:'Storage costs (£)' },
    { key:'repair',label:'Testing & repairs (£)' }, { key:'reserve',label:'Set aside for returns & losses (£)' },
  ] },
  { title: 'Selling & posting', hint: 'These are editable estimates, not an eBay fee quote. Add any insurance or extra taxes to your costs.', fields: [
    { key:'feeRate',label:'Selling fees (%)',percent:true }, { key:'fixedFee',label:'Extra fee per order (£)' },
    { key:'sellerPostage',label:'Your postage per order (£)' }, { key:'buyerPostage',label:'Postage the buyer pays (£)' },
    { key:'packaging',label:'Packaging per order (£)' }, { key:'labourMinutes',label:'Minutes of work per product' },
    { key:'hourlyRate',label:'What your time is worth (£/hour)' },
  ] },
  { title: 'Extra room for profit', hint: 'Optional preferences for the suggested bid. They do not change the pallet’s profit figures. A 50% cushion means aiming for £1 profit per £2 of buying costs and valued time.', fields: [
    { key:'targetRoi',label:'Profit cushion for the suggested bid (%)',percent:true },
    { key:'targetProfit',label:'Optional minimum profit (£)' },
  ] },
  { title: 'Allow for the unexpected', hint: 'Choose how much might be usable and sell in your planned selling period. These are your estimates, not measured demand.', fields: [
    { key:'yieldRate',label:'Products likely to be sellable (%)',percent:true }, { key:'conservativeYield',label:'Sellable in a cautious case (%)',percent:true },
    { key:'sellThrough',label:'Sellable stock likely to sell (%)',percent:true }, { key:'conservativeSellThrough',label:'Likely to sell in a cautious case (%)',percent:true },
    { key:'bundleDiscount',label:'Discount when selling in packs (%)',percent:true },
  ] },
  { title: 'Selling it all together', hint: 'Leave at zero if you have no realistic price for selling the whole lot.', fields: [
    { key:'wholeLotPrice',label:'Whole-lot selling price (£)' }, { key:'wholeLotConservative',label:'Cautious whole-lot price (£)' },
  ] },
];
