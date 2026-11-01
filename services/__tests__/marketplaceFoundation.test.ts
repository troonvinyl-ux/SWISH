import * as fs from 'fs';
import * as path from 'path';
import {
  getMarketplaceImplementationStatus,
  isMarketplaceProductionReady,
} from '@/services/marketplaceReadiness';
import {
  marketplaceFinancialEventKey,
  supportsMarketplaceOperation,
  type MarketplaceCapabilities,
} from '@/services/marketplaceAdapter';

const root = path.resolve(__dirname, '../..');

describe('marketplace implementation readiness', () => {
  it('recognises eBay as the existing production integration', () => {
    expect(isMarketplaceProductionReady('ebay')).toBe(true);
    expect(getMarketplaceImplementationStatus('ebay')).toBe('production');
  });

  it('does not represent unimplemented automated channels as live integrations', () => {
    for (const id of ['amazon', 'vinted', 'etsy', 'depop', 'shopify', 'whatnot']) {
      expect(isMarketplaceProductionReady(id)).toBe(false);
      expect(getMarketplaceImplementationStatus(id)).toBe('planned');
    }
  });

  it('classifies assisted channels separately from automated publishing', () => {
    for (const id of ['facebook_marketplace', 'gumtree']) {
      expect(getMarketplaceImplementationStatus(id)).toBe('assisted');
      expect(isMarketplaceProductionReady(id)).toBe(false);
    }
  });

  it('defaults unknown channels to planned', () => {
    expect(getMarketplaceImplementationStatus('unknown_marketplace')).toBe('planned');
  });

  it('disables unsupported Etsy and Amazon connector capabilities in the commercial registry', () => {
    const service = fs.readFileSync(path.join(root, 'services/marketplaceService.ts'), 'utf8');
    expect((service.match(/list: false, publish: false, reprice: false, readOrders: false, fulfil: false/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(service).toContain('isMarketplaceProductionReady(marketplaceId)');
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

describe('normalized marketplace financial ledger migration', () => {
  const migration = fs.readFileSync(
    path.join(root, 'supabase/migrations/20261101232000_marketplace_financial_events.sql'),
    'utf8',
  );

  it('is additive and idempotent by tenant, marketplace and external transaction', () => {
    expect(migration).toContain('create table if not exists public.marketplace_financial_events');
    expect(migration).toContain('unique (tenant_id, marketplace_id, external_transaction_id)');
    expect(migration).toContain('marketplace_financial_events_tenant_date_idx');
  });

  it('restricts client access to tenant-scoped reads and service-role writes', () => {
    expect(migration).toContain('alter table public.marketplace_financial_events enable row level security');
    expect(migration).toContain('marketplace_financial_events.tenant_id in (select public.swish_user_tenant_ids())');
    expect(migration).toContain('revoke all on public.marketplace_financial_events from public, anon, authenticated');
    expect(migration).toContain('grant select on public.marketplace_financial_events to authenticated');
    expect(migration).toContain('grant all on public.marketplace_financial_events to service_role');
  });

  it('keeps existing eBay finance flows separate during initial rollout', () => {
    expect(migration).not.toContain('drop table');
    expect(migration).not.toContain('alter table public.ebay_financials');
    expect(migration).not.toContain('credential_ref');
  });
});
