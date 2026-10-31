/**
 * Shared contract for marketplace integrations.
 *
 * Adapters are server-side implementations. Never pass credentials or raw
 * provider tokens through these client-safe types. OAuth, signing, retries,
 * rate limiting and provider API calls belong in Supabase Edge Functions.
 */
import type { MarketplaceId } from '@/services/marketplaceService';

export type MarketplaceOperation =
  | 'connect'
  | 'publish'
  | 'revise'
  | 'end'
  | 'read_orders'
  | 'fulfil'
  | 'read_finances';

export interface MarketplaceCapabilities {
  connect: boolean;
  publish: boolean;
  revise: boolean;
  end: boolean;
  readOrders: boolean;
  fulfil: boolean;
  readFinances: boolean;
}

export interface NormalizedMarketplaceListing {
  externalListingId: string;
  title: string;
  price: number;
  currency: string;
  status: 'draft' | 'active' | 'ended' | 'sold' | 'unknown';
  listingUrl?: string;
  updatedAt?: string;
}

export interface NormalizedMarketplaceOrder {
  externalOrderId: string;
  externalListingId?: string;
  buyerReference?: string;
  saleAmount: number;
  shippingAmount?: number;
  currency: string;
  orderedAt: string;
  fulfilmentStatus: 'awaiting_dispatch' | 'packing' | 'dispatched' | 'delivered' | 'cancelled' | 'unknown';
}

export type MarketplaceFinancialEventType =
  | 'sale'
  | 'marketplace_fee'
  | 'payment_processing_fee'
  | 'shipping_label'
  | 'refund'
  | 'chargeback'
  | 'payout'
  | 'adjustment'
  | 'tax'
  | 'other';

export interface NormalizedMarketplaceFinancialEvent {
  marketplaceId: MarketplaceId;
  externalTransactionId: string;
  externalOrderId?: string;
  eventType: MarketplaceFinancialEventType;
  amount: number;
  currency: string;
  feeType?: string;
  payoutId?: string;
  payoutStatus?: string;
  occurredAt: string;
  /** Source classification only; do not attach raw provider payloads or secrets. */
  source: 'api' | 'csv_import' | 'manual';
}

export interface MarketplaceAdapter {
  readonly marketplaceId: MarketplaceId;
  readonly capabilities: MarketplaceCapabilities;
  publishListing?(tenantId: string, listingId: string): Promise<NormalizedMarketplaceListing>;
  reviseListing?(tenantId: string, listingId: string): Promise<NormalizedMarketplaceListing>;
  endListing?(tenantId: string, listingId: string): Promise<void>;
  importOrders?(tenantId: string, since: string): Promise<NormalizedMarketplaceOrder[]>;
  importFinancialEvents?(tenantId: string, since: string): Promise<NormalizedMarketplaceFinancialEvent[]>;
}

export function supportsMarketplaceOperation(
  capabilities: MarketplaceCapabilities,
  operation: MarketplaceOperation,
): boolean {
  const capabilityByOperation: Record<MarketplaceOperation, keyof MarketplaceCapabilities> = {
    connect: 'connect',
    publish: 'publish',
    revise: 'revise',
    end: 'end',
    read_orders: 'readOrders',
    fulfil: 'fulfil',
    read_finances: 'readFinances',
  };
  return capabilities[capabilityByOperation[operation]] === true;
}

/** Stable idempotency key for provider events; never use amount/date as identity. */
export function marketplaceFinancialEventKey(
  marketplaceId: string,
  externalTransactionId: string,
): string {
  return `${marketplaceId}:${externalTransactionId.trim()}`;
}
