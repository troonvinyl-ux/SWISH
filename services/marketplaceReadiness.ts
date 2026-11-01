/**
 * Runtime implementation truth for marketplace surfaces.
 *
 * A marketplace definition in marketplaceService describes commercial fit;
 * it does NOT prove that SWISH has a working connector. Keep this registry
 * conservative and only promote a channel after its adapter, auth, sync and
 * regression tests are deployed.
 */
export type MarketplaceImplementationStatus = 'production' | 'assisted' | 'planned';

export const MARKETPLACE_IMPLEMENTATION_STATUS: Record<string, MarketplaceImplementationStatus> = {
  ebay: 'production',
  facebook_marketplace: 'assisted',
  amazon: 'planned',
  vinted: 'planned',
  etsy: 'planned',
  depop: 'planned',
  gumtree: 'assisted',
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
