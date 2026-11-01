/**
 * Runtime implementation truth for marketplace surfaces.
 *
 * Commercial fit and fee estimates do not prove a working connector. Promote a
 * marketplace only after approved auth, publish, order, finance and isolation
 * paths are implemented and verified.
 */
export type MarketplaceImplementationStatus = 'production' | 'assisted' | 'planned';

export const MARKETPLACE_IMPLEMENTATION_STATUS: Record<string, MarketplaceImplementationStatus> = {
  ebay: 'production',
  facebook_marketplace: 'assisted',
  gumtree: 'assisted',
  amazon: 'planned',
  vinted: 'planned',
  etsy: 'planned',
  depop: 'planned',
  shopify: 'planned',
  whatnot: 'planned',
};

export function isMarketplaceProductionReady(marketplaceId: string): boolean {
  return MARKETPLACE_IMPLEMENTATION_STATUS[marketplaceId] === 'production';
}

export function getMarketplaceImplementationStatus(marketplaceId: string): MarketplaceImplementationStatus {
  return MARKETPLACE_IMPLEMENTATION_STATUS[marketplaceId] ?? 'planned';
}

export function getMarketplaceStatusLabel(marketplaceId: string): string {
  const status = getMarketplaceImplementationStatus(marketplaceId);
  if (status === 'production') return 'Connected integration';
  if (status === 'assisted') return 'Assisted workflow';
  return 'Integration planned';
}
