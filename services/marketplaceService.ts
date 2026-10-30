// SWISH Marketplace Connector Architecture
// Abstraction layer for all marketplaces: eBay, Etsy, Amazon, Vinted, Depop, etc.
// Day-1 architecture: eBay-first, but NOT eBay-only.
//
// STATUS:
// eBay Selling: REQUIRES CREDENTIALS (eBay Developer + OAuth tokens)
// eBay Buying/Bidding: REQUIRES eBay PARTNER/LIMITED-RELEASE API ACCESS
// Other marketplaces: ARCHITECTURE READY, CONNECTORS REQUIRE CREDENTIALS
//
// This service provides the complete connector framework. Capabilities gated
// by actual credential/permission availability at runtime.

import { getSupabaseClient } from '@/template';

// ── Marketplace Definitions ────────────────────────────────────────────────────

export type MarketplaceId =
  | 'ebay'
  | 'etsy'
  | 'amazon'
  | 'vinted'
  | 'depop'
  | 'gumtree'
  | 'shopify'
  | 'whatnot'
  | 'facebook_marketplace';

export interface MarketplaceDefinition {
  id: MarketplaceId;
  name: string;
  color: string;
  icon: string;
  description: string;
  feeStructure: string;
  estimatedFeeRate: number; // 0.0–1.0
  strengths: string[];
  bestFor: string[];
  authType: 'oauth2' | 'api_key' | 'manual';
  capabilities: {
    list: boolean;        // Can create/manage listings
    publish: boolean;     // Can publish live
    reprice: boolean;     // Can update prices programmatically
    readOrders: boolean;  // Can receive order notifications
    fulfil: boolean;      // Can update fulfilment/tracking
    buy: boolean;         // Can purchase items (requires special access)
    bid: boolean;         // Can place auction bids (eBay only, limited access)
    makeOffer: boolean;   // Can make offers to sellers
    searchOpportunities: boolean; // Can search for acquisition opportunities
  };
  requiredPermissions: string[];
  partnerApprovalRequired: boolean;
  apiDocsUrl: string;
}

export const MARKETPLACE_DEFINITIONS: Record<MarketplaceId, MarketplaceDefinition> = {
  ebay: {
    id: 'ebay',
    name: 'eBay',
    color: '#E53238',
    icon: 'storefront',
    description: 'World\'s largest resale marketplace. Ideal for most collectibles and general resale.',
    feeStructure: 'Final value fee ~12.75% + PayPal/Managed Payments fee',
    estimatedFeeRate: 0.1275,
    strengths: ['Largest audience', 'Auction format', 'Collector community', 'Global reach'],
    bestFor: ['Coins', 'Stamps', 'Trading cards', 'Vintage electronics', 'Most collectibles'],
    authType: 'oauth2',
    capabilities: {
      list: true,
      publish: true,
      reprice: true,
      readOrders: true,
      fulfil: true,
      buy: false,       // Programmatic purchasing: REQUIRES PARTNER API ACCESS
      bid: false,       // Automated bidding: REQUIRES PARTNER API ACCESS + special permissions
      makeOffer: false, // Making offers via API: REQUIRES PARTNER API ACCESS
      searchOpportunities: true, // Can search completed/active listings for valuation
    },
    requiredPermissions: ['sell.fulfillment', 'sell.inventory', 'sell.account', 'commerce.identity'],
    partnerApprovalRequired: true, // Buying/bidding requires eBay partner approval
    apiDocsUrl: 'https://developer.ebay.com/develop/apis',
  },
  etsy: {
    id: 'etsy',
    name: 'Etsy',
    color: '#F1641E',
    icon: 'storefront',
    description: 'Handmade, vintage, and unique items marketplace.',
    feeStructure: 'Listing fee $0.20 + 6.5% transaction fee',
    estimatedFeeRate: 0.065,
    strengths: ['Vintage buyers', 'Handmade community', 'International reach', 'Lower fees'],
    bestFor: ['Vintage clothing', 'Jewellery', 'Antiques', 'Curiosities', 'Art'],
    authType: 'oauth2',
    capabilities: {
      list: true, publish: true, reprice: true, readOrders: true, fulfil: true,
      buy: false, bid: false, makeOffer: false, searchOpportunities: false,
    },
    requiredPermissions: ['listings_r', 'listings_w', 'transactions_r', 'transactions_w'],
    partnerApprovalRequired: false,
    apiDocsUrl: 'https://developers.etsy.com/documentation',
  },
  amazon: {
    id: 'amazon',
    name: 'Amazon',
    color: '#FF9900',
    icon: 'storefront',
    description: 'World\'s largest e-commerce platform. Best for new/used books and media.',
    feeStructure: 'Referral fee 8–15% + FBA fees if applicable',
    estimatedFeeRate: 0.12,
    strengths: ['Massive audience', 'FBA fulfilment', 'Prime buyers', 'Strong for books/media'],
    bestFor: ['Books', 'Media', 'New items', 'Branded goods'],
    authType: 'oauth2',
    capabilities: {
      list: true, publish: true, reprice: true, readOrders: true, fulfil: true,
      buy: false, bid: false, makeOffer: false, searchOpportunities: false,
    },
    requiredPermissions: ['SellerId', 'AmazonSellerCentral'],
    partnerApprovalRequired: true,
    apiDocsUrl: 'https://developer-docs.amazon.com/sp-api/',
  },
  vinted: {
    id: 'vinted',
    name: 'Vinted',
    color: '#09B1A6',
    icon: 'storefront',
    description: 'European fashion resale platform. Zero seller fees, buyer pays.',
    feeStructure: 'Buyer pays protection fee (5% + £0.70). No seller fees.',
    estimatedFeeRate: 0.0, // Seller pays no fees
    strengths: ['Zero seller fees', 'Strong in UK/Europe', 'Fashion focus', 'Easy shipping'],
    bestFor: ['Clothing', 'Shoes', 'Accessories', 'Fashion items'],
    authType: 'api_key',
    capabilities: {
      list: false, publish: false, reprice: false, readOrders: false, fulfil: false,
      buy: false, bid: false, makeOffer: false, searchOpportunities: false,
    },
    requiredPermissions: ['Vinted API Partner Access'],
    partnerApprovalRequired: true,
    apiDocsUrl: 'https://vinted.com/api-documentation',
  },
  depop: {
    id: 'depop',
    name: 'Depop',
    color: '#FF4040',
    icon: 'storefront',
    description: 'Fashion-forward marketplace popular with Gen Z buyers.',
    feeStructure: '10% seller fee + payment processing',
    estimatedFeeRate: 0.10,
    strengths: ['Young audience', 'Fashion trends', 'Streetwear', 'Vintage'],
    bestFor: ['Trainers', 'Streetwear', 'Vintage fashion', 'Designer items'],
    authType: 'oauth2',
    capabilities: {
      list: false, publish: false, reprice: false, readOrders: false, fulfil: false,
      buy: false, bid: false, makeOffer: false, searchOpportunities: false,
    },
    requiredPermissions: ['Depop API Access — contact Depop for partner access'],
    partnerApprovalRequired: true,
    apiDocsUrl: 'https://developers.depop.com',
  },
  gumtree: {
    id: 'gumtree',
    name: 'Gumtree',
    color: '#008000',
    icon: 'storefront',
    description: 'UK classified ads. Good for large/heavy items, local sales.',
    feeStructure: 'Free for most categories, paid premium listings available',
    estimatedFeeRate: 0.0,
    strengths: ['Free listings', 'Local buyers', 'Large/heavy items', 'Quick local sales'],
    bestFor: ['Furniture', 'Large electronics', 'Local collections', 'Heavy items'],
    authType: 'manual',
    capabilities: {
      list: false, publish: false, reprice: false, readOrders: false, fulfil: false,
      buy: false, bid: false, makeOffer: false, searchOpportunities: false,
    },
    requiredPermissions: ['Manual listing only'],
    partnerApprovalRequired: false,
    apiDocsUrl: '',
  },
  shopify: {
    id: 'shopify',
    name: 'Shopify',
    color: '#96BF48',
    icon: 'storefront',
    description: 'Own-brand online store. Ideal for volume sellers building their brand.',
    feeStructure: 'Monthly subscription + payment processing fees',
    estimatedFeeRate: 0.02,
    strengths: ['Own brand', 'Custom domain', 'Full control', 'No marketplace competition'],
    bestFor: ['High volume', 'Brand building', 'Niche specialisation', 'Subscriptions'],
    authType: 'api_key',
    capabilities: {
      list: false, publish: false, reprice: false, readOrders: false, fulfil: false,
      buy: false, bid: false, makeOffer: false, searchOpportunities: false,
    },
    requiredPermissions: ['Shopify Partner API'],
    partnerApprovalRequired: false,
    apiDocsUrl: 'https://shopify.dev/api',
  },
  whatnot: {
    id: 'whatnot',
    name: 'Whatnot',
    color: '#7C3AED',
    icon: 'storefront',
    description: 'Live shopping platform popular for trading cards and collectibles.',
    feeStructure: '8% commission on sales',
    estimatedFeeRate: 0.08,
    strengths: ['Live auctions', 'Trading cards community', 'High engagement', 'Premium buyers'],
    bestFor: ['Pokémon cards', 'Sports cards', 'Collectibles', 'Live reveals'],
    authType: 'oauth2',
    capabilities: {
      list: false, publish: false, reprice: false, readOrders: false, fulfil: false,
      buy: false, bid: false, makeOffer: false, searchOpportunities: false,
    },
    requiredPermissions: ['Whatnot Seller API'],
    partnerApprovalRequired: true,
    apiDocsUrl: 'https://whatnot.com/api',
  },
  facebook_marketplace: {
    id: 'facebook_marketplace',
    name: 'Facebook Marketplace',
    color: '#1877F2',
    icon: 'storefront',
    description: 'Local and national selling via Facebook. Good for large/local items.',
    feeStructure: '5% selling fee for shipped items, free for local pickup',
    estimatedFeeRate: 0.05,
    strengths: ['Local reach', 'Large audience', 'Free for local', 'Facebook integration'],
    bestFor: ['Furniture', 'Local collections', 'House clearances', 'Large items'],
    authType: 'oauth2',
    capabilities: {
      list: false, publish: false, reprice: false, readOrders: false, fulfil: false,
      buy: false, bid: false, makeOffer: false, searchOpportunities: false,
    },
    requiredPermissions: ['Facebook Marketing API', 'Marketplace API'],
    partnerApprovalRequired: true,
    apiDocsUrl: 'https://developers.facebook.com/docs/marketplace',
  },
};

// ── Connector Database Operations ─────────────────────────────────────────────

export interface MarketplaceConnector {
  id: string;
  tenantId: string;
  marketplaceId: MarketplaceId;
  displayName: string;
  status: 'connected' | 'disconnected' | 'error' | 'requires_reauth' | 'suspended';
  canList: boolean;
  canPublish: boolean;
  canReprice: boolean;
  canReadOrders: boolean;
  canFulfil: boolean;
  canBuy: boolean;
  canBid: boolean;
  canMakeOffer: boolean;
  canSearchOpportunities: boolean;
  sellerAccountId?: string;
  lastSyncAt?: string;
  lastError?: string;
  connectedAt?: string;
  accessTokenExpiresAt?: string;
  updatedAt: string;
}

function mapConnector(row: any): MarketplaceConnector {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    marketplaceId: row.marketplace_id as MarketplaceId,
    displayName: row.display_name,
    status: row.status,
    canList: row.can_list ?? false,
    canPublish: row.can_publish ?? false,
    canReprice: row.can_reprice ?? false,
    canReadOrders: row.can_read_orders ?? false,
    canFulfil: row.can_fulfil ?? false,
    canBuy: row.can_buy ?? false,
    canBid: row.can_bid ?? false,
    canMakeOffer: row.can_make_offer ?? false,
    canSearchOpportunities: row.can_search_opportunities ?? false,
    sellerAccountId: row.seller_account_id ?? undefined,
    lastSyncAt: row.last_sync_at ?? undefined,
    lastError: row.last_error ?? undefined,
    connectedAt: row.connected_at ?? undefined,
    accessTokenExpiresAt: row.access_token_expires_at ?? undefined,
    updatedAt: row.updated_at,
  };
}

// Safe column list — credential_ref, access tokens, and refresh tokens are
// NEVER returned to the client. All credential access is server-side only.
const SAFE_CONNECTOR_COLUMNS =
  'id, tenant_id, marketplace_id, display_name, status, ' +
  'can_list, can_publish, can_reprice, can_read_orders, can_fulfil, ' +
  'can_buy, can_bid, can_make_offer, can_search_opportunities, ' +
  'seller_account_id, last_sync_at, last_error, connected_at, ' +
  'access_token_expires_at, updated_at';

export async function listConnectors(tenantId: string): Promise<{
  connectors: MarketplaceConnector[];
  error: string | null;
}> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('marketplace_connectors')
    .select(SAFE_CONNECTOR_COLUMNS)
    .eq('tenant_id', tenantId)
    .order('marketplace_id');

  if (error) return { connectors: [], error: error.message };
  return { connectors: (data ?? []).map(mapConnector), error: null };
}

export async function getOrCreateConnector(
  tenantId: string,
  marketplaceId: MarketplaceId
): Promise<{ connector: MarketplaceConnector | null; error: string | null }> {
  const supabase = getSupabaseClient();
  const definition = MARKETPLACE_DEFINITIONS[marketplaceId];

  const { data, error } = await supabase
    .from('marketplace_connectors')
    .upsert({
      tenant_id: tenantId,
      marketplace_id: marketplaceId,
      display_name: definition?.name ?? marketplaceId,
      status: 'disconnected',
    }, { onConflict: 'tenant_id,marketplace_id', ignoreDuplicates: true })
    .select(SAFE_CONNECTOR_COLUMNS)
    .maybeSingle();

  if (error) return { connector: null, error: error.message };
  // Fetch after upsert
  if (!data) {
    const { data: fetched, error: fetchErr } = await supabase
      .from('marketplace_connectors')
      .select(SAFE_CONNECTOR_COLUMNS)
      .eq('tenant_id', tenantId)
      .eq('marketplace_id', marketplaceId)
      .single();
    if (fetchErr) return { connector: null, error: fetchErr.message };
    return { connector: mapConnector(fetched), error: null };
  }

  return { connector: mapConnector(data), error: null };
}

export async function disconnectMarketplace(tenantId: string, marketplaceId: MarketplaceId): Promise<{ error: string | null }> {
  const { error } = await getSupabaseClient().rpc('swish_disconnect_marketplace', { p_tenant_id: tenantId, p_marketplace_id: marketplaceId });
  return { error: error?.message ?? null };
}

// ── Marketplace Selection Intelligence ───────────────────────────────────────

export interface MarketplaceRecommendation {
  marketplaceId: MarketplaceId;
  name: string;
  score: number;  // 0–100
  estimatedNetRevenue: number;
  estimatedFee: number;
  rationale: string;
  available: boolean;
  requiresCredentials: boolean;
}

export function recommendMarketplaces(
  specialistId: string,
  expectedSellingPrice: number,
  connectors: MarketplaceConnector[]
): MarketplaceRecommendation[] {
  const SPECIALIST_MARKETPLACE_SCORES: Record<string, Record<MarketplaceId, number>> = {
    coins:                    { ebay: 90, etsy: 60, amazon: 20, vinted: 0, depop: 0, gumtree: 20, shopify: 40, whatnot: 30, facebook_marketplace: 10 },
    pokemon_cards:            { ebay: 85, etsy: 40, amazon: 20, vinted: 0, depop: 20, gumtree: 10, shopify: 30, whatnot: 90, facebook_marketplace: 20 },
    trading_cards:            { ebay: 90, etsy: 30, amazon: 20, vinted: 0, depop: 20, gumtree: 10, shopify: 30, whatnot: 85, facebook_marketplace: 20 },
    stamps:                   { ebay: 90, etsy: 70, amazon: 15, vinted: 0, depop: 0, gumtree: 10, shopify: 30, whatnot: 20, facebook_marketplace: 10 },
    banknotes:                { ebay: 90, etsy: 60, amazon: 10, vinted: 0, depop: 0, gumtree: 15, shopify: 30, whatnot: 20, facebook_marketplace: 10 },
    retro_games:              { ebay: 95, etsy: 30, amazon: 50, vinted: 10, depop: 30, gumtree: 30, shopify: 40, whatnot: 40, facebook_marketplace: 30 },
    retro_consoles:           { ebay: 90, etsy: 20, amazon: 40, vinted: 10, depop: 30, gumtree: 50, shopify: 35, whatnot: 20, facebook_marketplace: 40 },
    antiques:                 { ebay: 80, etsy: 85, amazon: 10, vinted: 0, depop: 10, gumtree: 50, shopify: 40, whatnot: 20, facebook_marketplace: 30 },
    clothing:                 { ebay: 75, etsy: 70, amazon: 30, vinted: 90, depop: 85, gumtree: 20, shopify: 50, whatnot: 10, facebook_marketplace: 40 },
    trainers_sneakers:        { ebay: 85, etsy: 40, amazon: 20, vinted: 70, depop: 90, gumtree: 20, shopify: 50, whatnot: 10, facebook_marketplace: 30 },
    vinyl_records:            { ebay: 85, etsy: 75, amazon: 30, vinted: 10, depop: 20, gumtree: 25, shopify: 40, whatnot: 30, facebook_marketplace: 20 },
    books:                    { ebay: 80, etsy: 70, amazon: 90, vinted: 10, depop: 10, gumtree: 20, shopify: 40, whatnot: 10, facebook_marketplace: 20 },
    gold:                     { ebay: 85, etsy: 30, amazon: 10, vinted: 0, depop: 0, gumtree: 40, shopify: 30, whatnot: 10, facebook_marketplace: 20 },
    silver:                   { ebay: 85, etsy: 50, amazon: 10, vinted: 0, depop: 0, gumtree: 35, shopify: 30, whatnot: 10, facebook_marketplace: 20 },
    jewellery_precious_metals: { ebay: 80, etsy: 85, amazon: 20, vinted: 20, depop: 40, gumtree: 30, shopify: 50, whatnot: 20, facebook_marketplace: 20 },
    curiosities_collectibles:  { ebay: 85, etsy: 80, amazon: 20, vinted: 10, depop: 20, gumtree: 35, shopify: 40, whatnot: 30, facebook_marketplace: 25 },
    ancient_artefacts:        { ebay: 75, etsy: 65, amazon: 5, vinted: 0, depop: 0, gumtree: 20, shopify: 30, whatnot: 10, facebook_marketplace: 10 },
  };

  const scores = SPECIALIST_MARKETPLACE_SCORES[specialistId] ?? SPECIALIST_MARKETPLACE_SCORES['curiosities_collectibles'];

  const connectorMap = new Map(connectors.map(c => [c.marketplaceId, c]));

  return Object.entries(MARKETPLACE_DEFINITIONS)
    .map(([id, def]) => {
      const marketplaceId = id as MarketplaceId;
      const baseScore = scores[marketplaceId] ?? 30;
      const feeRate = def.estimatedFeeRate;
      const estimatedFee = expectedSellingPrice * feeRate;
      const estimatedNetRevenue = expectedSellingPrice - estimatedFee;
      const connector = connectorMap.get(marketplaceId);
      const available = connector?.status === 'connected' && (connector?.canPublish ?? false);

      let rationale = def.bestFor.join(', ');

      return {
        marketplaceId,
        name: def.name,
        score: baseScore,
        estimatedNetRevenue,
        estimatedFee,
        rationale,
        available,
        requiresCredentials: !available,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 5); // Top 5
}

// ── Connector Update ─────────────────────────────────────────────────────────────

export async function updateConnector(
  tenantId: string,
  marketplaceId: MarketplaceId,
  updates: {
    status?: MarketplaceConnector['status'];
    canList?: boolean;
    canPublish?: boolean;
    canReprice?: boolean;
    canReadOrders?: boolean;
    canFulfil?: boolean;
    canBuy?: boolean;
    canBid?: boolean;
    canMakeOffer?: boolean;
    canSearchOpportunities?: boolean;
    sellerAccountId?: string;
    connectedAt?: string;
    lastError?: string;
  }
): Promise<{ connector: MarketplaceConnector | null; error: string | null }> {
  const supabase = getSupabaseClient();

  // Ensure record exists first
  await getOrCreateConnector(tenantId, marketplaceId);

  const dbUpdates: Record<string, any> = { updated_at: new Date().toISOString() };
  if (updates.status !== undefined) dbUpdates.status = updates.status;
  if (updates.canList !== undefined) dbUpdates.can_list = updates.canList;
  if (updates.canPublish !== undefined) dbUpdates.can_publish = updates.canPublish;
  if (updates.canReprice !== undefined) dbUpdates.can_reprice = updates.canReprice;
  if (updates.canReadOrders !== undefined) dbUpdates.can_read_orders = updates.canReadOrders;
  if (updates.canFulfil !== undefined) dbUpdates.can_fulfil = updates.canFulfil;
  if (updates.canBuy !== undefined) dbUpdates.can_buy = updates.canBuy;
  if (updates.canBid !== undefined) dbUpdates.can_bid = updates.canBid;
  if (updates.canMakeOffer !== undefined) dbUpdates.can_make_offer = updates.canMakeOffer;
  if (updates.canSearchOpportunities !== undefined) dbUpdates.can_search_opportunities = updates.canSearchOpportunities;
  if (updates.sellerAccountId !== undefined) dbUpdates.seller_account_id = updates.sellerAccountId;
  if (updates.connectedAt !== undefined) dbUpdates.connected_at = updates.connectedAt;
  if (updates.lastError !== undefined) dbUpdates.last_error = updates.lastError;

  const { data, error } = await supabase
    .from('marketplace_connectors')
    .update(dbUpdates)
    .eq('tenant_id', tenantId)
    .eq('marketplace_id', marketplaceId)
    .select(SAFE_CONNECTOR_COLUMNS)
    .single();

  if (error) return { connector: null, error: error.message };
  return { connector: mapConnector(data), error: null };
}

// ── eBay Opportunity Search (architecture placeholder) ─────────────────────────
// REQUIRES: eBay Developer API credentials + OAuth token
// STATUS: ARCHITECTURE READY — REQUIRES CREDENTIALS

export interface eBayOpportunitySearch {
  query: string;
  categories?: string[];
  maxPrice?: number;
  minItems?: number;
  sortBy?: 'best_match' | 'price_low' | 'ending_soon';
}

export interface eBayListing {
  listingId: string;
  title: string;
  price: number;
  buyItNowPrice?: number;
  auctionEndTime?: string;
  condition: string;
  itemCount?: number;
  sellerFeedback: number;
  location: string;
  imageUrl?: string;
  listingUrl: string;
  isLot: boolean;
  isBulk: boolean;
  categories: string[];
}

export async function searcheBayOpportunities(
  input: eBayOpportunitySearch,
  _connector: MarketplaceConnector | null
): Promise<{ listings: eBayListing[]; error: string | null; requiresCredentials: boolean }> {
  // eBay programmatic searching requires:
  // 1. eBay Developer Account (free)
  // 2. OAuth Application Token (available with developer account)
  // 3. Browse API or Finding API access
  //
  // Autonomous PURCHASING/BIDDING additionally requires:
  // - eBay Partner Network approval
  // - Buy API access (limited release as of 2024)
  // - Additional compliance/compliance review
  //
  // This architecture is production-ready for the moment eBay credentials are configured.
  // To connect: Settings > Marketplaces > eBay > Connect

  if (!_connector || _connector.status !== 'connected') {
    return {
      listings: [],
      error: null,
      requiresCredentials: true,
    };
  }

  // When credentials are available, implement:
  // GET https://api.ebay.com/buy/browse/v1/item_summary/search?q=...
  // with Authorization: Bearer {access_token}
  // Filter: conditionIds, categoryIds, price range, itemGroupTypes (LOT)

  return {
    listings: [],
    error: 'eBay API credentials required. Configure in Settings > Marketplaces.',
    requiresCredentials: true,
  };
}
