import {
  getMarketplaceImplementationStatus,
  isMarketplaceProductionReady,
} from '@/services/marketplaceReadiness';
import {
  marketplaceFinancialEventKey,
  supportsMarketplaceOperation,
  type MarketplaceCapabilities,
} from '@/services/marketplaceAdapter';

describe('marketplace implementation readiness', () => {
  it('recognises eBay as the existing production integration', () => {
    expect(isMarketplaceProductionReady('ebay')).toBe(true);
    expect(getMarketplaceImplementationStatus('ebay')).toBe('production');
  });

  it('does not represent Amazon or Vinted as live integrations', () => {
    expect(isMarketplaceProductionReady('amazon')).toBe(false);
    expect(getMarketplaceImplementationStatus('amazon')).toBe('planned');
    expect(isMarketplaceProductionReady('vinted')).toBe(false);
    expect(getMarketplaceImplementationStatus('vinted')).toBe('planned');
  });

  it('classifies Facebook as assisted rather than automated publishing', () => {
    expect(getMarketplaceImplementationStatus('facebook_marketplace')).toBe('assisted');
    expect(isMarketplaceProductionReady('facebook_marketplace')).toBe(false);
  });

  it('defaults unknown channels to planned', () => {
    expect(getMarketplaceImplementationStatus('unknown_marketplace')).toBe('planned');
  });
});

describe('marketplace adapter contract helpers', () => {
  const capabilities: MarketplaceCapabilities = {
    connect: true,
    publish: true,
    revise: false,
    end: false,
    readOrders: true,
    fulfil: false,
    readFinances: false,
  };

  it('maps operations to the correct explicit capability', () => {
    expect(supportsMarketplaceOperation(capabilities, 'connect')).toBe(true);
    expect(supportsMarketplaceOperation(capabilities, 'publish')).toBe(true);
    expect(supportsMarketplaceOperation(capabilities, 'revise')).toBe(false);
    expect(supportsMarketplaceOperation(capabilities, 'read_orders')).toBe(true);
    expect(supportsMarketplaceOperation(capabilities, 'read_finances')).toBe(false);
  });

  it('creates stable transaction keys without relying on amount or date', () => {
    expect(marketplaceFinancialEventKey('ebay', ' TX-123 ')).toBe('ebay:TX-123');
  });
});
