import {
  marketplaceFinancialEventKey,
  supportsMarketplaceOperation,
  type MarketplaceCapabilities,
} from '../marketplaceAdapter';

describe('shared marketplace adapter contracts', () => {
  const capabilities: MarketplaceCapabilities = {
    connect: true,
    publish: true,
    revise: false,
    end: false,
    readOrders: true,
    fulfil: false,
    readFinances: false,
  };

  it('maps each operation to its explicit capability flag', () => {
    expect(supportsMarketplaceOperation(capabilities, 'connect')).toBe(true);
    expect(supportsMarketplaceOperation(capabilities, 'publish')).toBe(true);
    expect(supportsMarketplaceOperation(capabilities, 'revise')).toBe(false);
    expect(supportsMarketplaceOperation(capabilities, 'end')).toBe(false);
    expect(supportsMarketplaceOperation(capabilities, 'read_orders')).toBe(true);
    expect(supportsMarketplaceOperation(capabilities, 'fulfil')).toBe(false);
    expect(supportsMarketplaceOperation(capabilities, 'read_finances')).toBe(false);
  });

  it('uses the external transaction id for stable idempotency keys', () => {
    expect(marketplaceFinancialEventKey('ebay', ' TX-123 ')).toBe('ebay:TX-123');
    expect(marketplaceFinancialEventKey('amazon', 'TX-123')).toBe('amazon:TX-123');
  });
});
