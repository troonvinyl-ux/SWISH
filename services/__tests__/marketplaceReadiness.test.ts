import * as fs from 'fs';
import * as path from 'path';
import {
  getMarketplaceImplementationStatus,
  getMarketplaceStatusLabel,
  isMarketplaceProductionReady,
} from '../marketplaceReadiness';

describe('marketplace implementation truth', () => {
  test('only eBay is represented as a production integration', () => {
    expect(isMarketplaceProductionReady('ebay')).toBe(true);
    expect(getMarketplaceImplementationStatus('ebay')).toBe('production');
    expect(getMarketplaceStatusLabel('ebay')).toBe('Production integration');
    for (const id of ['amazon', 'vinted', 'etsy', 'depop', 'shopify', 'whatnot']) {
      expect(isMarketplaceProductionReady(id)).toBe(false);
      expect(getMarketplaceImplementationStatus(id)).toBe('planned');
    }
  });

  test('assisted channels are not advertised as automated integrations', () => {
    expect(getMarketplaceImplementationStatus('facebook_marketplace')).toBe('assisted');
    expect(getMarketplaceImplementationStatus('gumtree')).toBe('assisted');
    expect(isMarketplaceProductionReady('facebook_marketplace')).toBe(false);
    expect(isMarketplaceProductionReady('gumtree')).toBe(false);
  });

  test('unknown channels default to planned', () => {
    expect(getMarketplaceImplementationStatus('unknown_marketplace')).toBe('planned');
    expect(getMarketplaceStatusLabel('unknown_marketplace')).toBe('Integration planned');
  });

  test('recommendations require both production readiness and a connected publish-capable connector', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../marketplaceService.ts'), 'utf8');
    expect(source).toContain('isMarketplaceProductionReady(marketplaceId)');
    expect(source).toContain("connector?.status === 'connected'");
    expect(source).toContain('(connector?.canPublish ?? false)');
    expect(source).toContain("list: false, publish: false, reprice: false, readOrders: false, fulfil: false");
  });
});
