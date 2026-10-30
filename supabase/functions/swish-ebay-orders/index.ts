// SWISH — eBay Orders Import Edge Function v2
//
// CRITICAL CHANGES v2:
//   1. Calls eBay Fulfillment REST API (getOrders) as primary source
//   2. Falls back to Trading API GetOrders for legacy compatibility
//   3. Marketplace fees sourced from ebay_financials when available (never estimated as "exact")
//   4. Estimated 12.8% fee is always labelled ESTIMATE — never presented as exact
//   5. Idempotent: running twice never creates duplicate orders
//   6. All eBay order IDs stored in external_order_id for deduplication
//   7. Logs every operation to ebay_sync_log
//
// POST body:
//   { tenantId: string, daysBack?: number (default 30), mode?: 'fulfillment_api' | 'trading_api' | 'both' }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { encryptCredentials, decryptCredentials } from '../_shared/credentialCrypto.ts';
import registry from '../../../niche-modules.json' with { type: 'json' };
import { corsHeaders } from '../_shared/cors.ts';

const EBAY_TRADING_API_URL   = 'https://api.ebay.com/ws/api.dll';
const EBAY_FULFILLMENT_API   = 'https://api.ebay.com/sell/fulfillment/v1';
const EBAY_TOKEN_URL         = 'https://api.ebay.com/identity/v1/oauth2/token';

function adminClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );
}

function nicheForSpecialist(specialistId: string | null | undefined): string | null {
  if (!specialistId) return null;
  const products = (registry as any).products as Record<string, { specialists: string[]; legacySpecialists: string[] }>;
  const matches = Object.entries(products)
    .filter(([, product]) => [...product.specialists, ...product.legacySpecialists].includes(specialistId))
    .map(([nicheId]) => nicheId);
  return matches.length === 1 ? matches[0] : null;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function xmlEscape(s: string): string {
  return (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function toEbayDate(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, '.000Z');
}

// ── Token refresh ──────────────────────────────────────────────────────────────

async function refreshAccessToken(
  clientId: string, clientSecret: string, refreshToken: string,
): Promise<{ accessToken: string; expiresAt: string }> {
  const basicAuth = btoa(`${clientId}:${clientSecret}`);
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });

  const resp = await fetch(EBAY_TOKEN_URL, {
    method: 'POST',
    headers: { Authorization: `Basic ${basicAuth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: AbortSignal.timeout(15000),
  });
  const data = await resp.json();
  if (!data.access_token) throw new Error(`Token refresh failed: ${data.error_description ?? data.error ?? 'unknown'}`);
  const expiresAt = new Date(Date.now() + (data.expires_in ?? 7200) * 1000).toISOString();
  return { accessToken: data.access_token, expiresAt };
}

// ── Load + refresh credentials ─────────────────────────────────────────────────

async function getCredentials(tenantId: string): Promise<{
  accessToken: string; clientId: string; credentials: any;
}> {
  const supabase = adminClient();
  const { data: conn } = await supabase
    .from('marketplace_connectors')
    .select('credential_ref, status, access_token_expires_at')
    .eq('tenant_id', tenantId).eq('marketplace_id', 'ebay').maybeSingle();

  if (!conn?.credential_ref) throw new Error('eBay connector not found. Connect eBay in Marketplaces.');
  if (conn.status !== 'connected') throw new Error(`eBay not connected (status: ${conn.status}).`);

  let creds: any;
  try { creds = await decryptCredentials(conn.credential_ref); } catch (e: any) {
    throw new Error(`eBay credentials malformed: ${e.message}. Re-connect eBay.`);
  }
  if (!creds.accessToken) throw new Error('No eBay access token. Re-authorise eBay.');

  const shouldRefresh = creds.expiresAt ? Date.now() + 5 * 60_000 >= new Date(creds.expiresAt).getTime() : false;
  if (shouldRefresh && creds.refreshToken) {
    const { accessToken: newToken, expiresAt: newExpiry } = await refreshAccessToken(creds.clientId, creds.clientSecret, creds.refreshToken);
    creds = { ...creds, accessToken: newToken, expiresAt: newExpiry };
    const updatedRef = await encryptCredentials(creds);
    await supabase.from('marketplace_connectors').update({
      credential_ref: updatedRef, access_token_expires_at: newExpiry, updated_at: new Date().toISOString(),
    }).eq('tenant_id', tenantId).eq('marketplace_id', 'ebay');
  }

  return { accessToken: creds.accessToken, clientId: creds.clientId, credentials: creds };
}

// ── eBay Fulfillment REST API orders ──────────────────────────────────────────
// This is the CURRENT supported eBay Orders API (replaces Trading GetOrders for new sellers)

interface FulfillmentOrder {
  orderId: string;
  legacyOrderId?: string;
  orderStatus: string;
  // eBay Fulfillment API returns `orderFulfillmentStatus` (not `fulfillmentStatus`).
  // Keep the legacy alias optional for any previously-normalized payloads.
  orderFulfillmentStatus?: string;
  fulfillmentStatus?: string;
  createdAt: string;
  lastUpdatedAt: string;
  buyer: { username: string; buyerRegistrationAddress?: any };
  lineItems: Array<{
    lineItemId: string;
    legacyItemId?: string;
    title: string;
    quantity: number;
    lineItemCost: { value: string; currency: string };
    deliveryCost: { shippingCost: { value: string; currency: string } };
  }>;
  pricingSummary: {
    priceSubtotal: { value: string; currency: string };
    deliveryCost: { value: string; currency: string };
    total: { value: string; currency: string };
  };
  fulfillmentStartInstructions: Array<{
    fulfillmentInstructionsType: string;
    shippingStep?: {
      shipTo?: {
        fullName?: string;
        contactAddress?: {
          addressLine1?: string; addressLine2?: string;
          city?: string; stateOrProvince?: string; postalCode?: string; countryCode?: string;
        };
      };
    };
  }>;
}

async function fetchFulfillmentOrders(
  accessToken: string,
  daysBack: number,
): Promise<{ orders: FulfillmentOrder[]; apiError?: string }> {
  const fromDate = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();
  const allOrders: FulfillmentOrder[] = [];
  let offset = 0;
  const limit = 200;
  let hasMore = true;

  while (hasMore) {
    try {
      const url = new URL(`${EBAY_FULFILLMENT_API}/order`);
      url.searchParams.set('filter', `creationdate:[${fromDate}..],orderfulfillmentstatus:{NOT_STARTED|IN_PROGRESS|FULFILLED}`);
      url.searchParams.set('limit', String(limit));
      url.searchParams.set('offset', String(offset));

      const resp = await fetch(url.toString(), {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB',
        },
        signal: AbortSignal.timeout(20000),
      });

      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        // 403 = Managed Payments not enabled or scope not granted
        if (resp.status === 403 || resp.status === 401) {
          console.log(`[SWISH Orders] Fulfillment API ${resp.status}: ${errText.slice(0, 200)}`);
          return { orders: [], apiError: `Fulfillment API not available (${resp.status}) — falling back to Trading API` };
        }
        console.log(`[SWISH Orders] Fulfillment API ${resp.status}: ${errText.slice(0, 200)}`);
        return { orders: allOrders, apiError: `Fulfillment API HTTP ${resp.status}` };
      }

      const data = await resp.json();
      const pageOrders: FulfillmentOrder[] = data.orders ?? [];
      allOrders.push(...pageOrders);

      const total = data.total ?? 0;
      offset += limit;
      hasMore = offset < total && pageOrders.length > 0;

      if (hasMore) await new Promise(r => setTimeout(r, 100));
    } catch (e: any) {
      console.log(`[SWISH Orders] Fulfillment API error: ${e.message}`);
      return { orders: allOrders, apiError: e.message };
    }
  }

  return { orders: allOrders };
}

// ── Trading API GetOrders (fallback / legacy) ──────────────────────────────────

function xmlExtract(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
  return m ? m[1].trim() : '';
}

function xmlExtractAll(xml: string, tag: string): string[] {
  const results: string[] = [];
  const re = new RegExp(`<${tag}[^>]*>[\\s\\S]*?<\\/${tag}>`, 'g');
  let m;
  while ((m = re.exec(xml)) !== null) results.push(m[0]);
  return results;
}

async function fetchTradingOrders(
  accessToken: string, clientId: string, daysBack: number,
): Promise<{ orders: TradingOrder[]; error?: string }> {
  const toDate = new Date();
  const fromDate = new Date(toDate.getTime() - daysBack * 24 * 60 * 60 * 1000);
  const allBlocks: string[] = [];
  let page = 1, totalPages = 1;

  do {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<GetOrdersRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials><eBayAuthToken>${accessToken}</eBayAuthToken></RequesterCredentials>
  <CreateTimeFrom>${xmlEscape(toEbayDate(fromDate))}</CreateTimeFrom>
  <CreateTimeTo>${xmlEscape(toEbayDate(toDate))}</CreateTimeTo>
  <OrderStatus>Completed</OrderStatus>
  <Pagination><EntriesPerPage>100</EntriesPerPage><PageNumber>${page}</PageNumber></Pagination>
</GetOrdersRequest>`;

    try {
      const resp = await fetch(EBAY_TRADING_API_URL, {
        method: 'POST',
        headers: {
          'X-EBAY-API-SITEID': '3', 'X-EBAY-API-COMPATIBILITY-LEVEL': '967',
          'X-EBAY-API-CALL-NAME': 'GetOrders', 'X-EBAY-API-APP-NAME': clientId,
          'Content-Type': 'text/xml;charset=utf-8',
        },
        body: xml, signal: AbortSignal.timeout(30000),
      });
      const resXml = await resp.text();
      if (page === 1) {
        const pagesStr = resXml.match(/<TotalNumberOfPages>(\d+)<\/TotalNumberOfPages>/)?.[1];
        totalPages = Math.min(parseInt(pagesStr ?? '1') || 1, 20);
      }
      const ack = xmlExtract(resXml, 'Ack');
      if (ack === 'Failure') {
        const errMsg = xmlExtract(xmlExtract(resXml, 'Errors'), 'LongMessage');
        return { orders: [], error: `GetOrders: ${errMsg}` };
      }
      allBlocks.push(...xmlExtractAll(resXml, 'Order'));
      if (page < totalPages) await new Promise(r => setTimeout(r, 150));
      page++;
    } catch (e: any) {
      return { orders: allBlocks.map(parseTradingOrder).filter(Boolean) as TradingOrder[], error: e.message };
    }
  } while (page <= totalPages);

  return { orders: allBlocks.map(parseTradingOrder).filter(Boolean) as TradingOrder[] };
}

interface TradingOrder {
  orderId: string;
  buyerUsername: string;
  buyerEmail: string;
  createdAt: string;
  salePrice: number;
  shippingCost: number;
  shippingAddress: Record<string, string>;
  ebayItemIds: string[];
  trackingNumber: string;
  carrier: string;
}

function parseTradingOrder(block: string): TradingOrder | null {
  const orderId = xmlExtract(block, 'OrderID');
  if (!orderId) return null;
  const salePrice = parseFloat(xmlExtract(block, 'AmountPaid') || '0');
  const shippingCost = parseFloat(xmlExtract(block, 'ShippingServiceCost') || '0');
  const addressBlock = xmlExtract(block, 'ShippingAddress');
  const shipBlock = xmlExtract(block, 'ShippingDetails');
  const txBlocks = xmlExtractAll(block, 'Transaction');
  const ebayItemIds = txBlocks.map(t => xmlExtract(xmlExtract(t, 'Item'), 'ItemID')).filter(Boolean);

  return {
    orderId,
    buyerUsername: xmlExtract(block, 'UserID') || xmlExtract(block, 'BuyerUserID'),
    buyerEmail: xmlExtract(block, 'Email'),
    createdAt: xmlExtract(block, 'CreatedTime'),
    salePrice,
    shippingCost,
    shippingAddress: {
      name: xmlExtract(addressBlock, 'Name'),
      street: xmlExtract(addressBlock, 'Street1'),
      city: xmlExtract(addressBlock, 'CityName'),
      county: xmlExtract(addressBlock, 'StateOrProvince'),
      postcode: xmlExtract(addressBlock, 'PostalCode'),
      country: xmlExtract(addressBlock, 'CountryName'),
    },
    ebayItemIds,
    trackingNumber: xmlExtract(shipBlock, 'ShipmentTrackingNumber'),
    carrier: xmlExtract(shipBlock, 'ShippingCarrierUsed'),
  };
}

// ── Import orders to SWISH DB ─────────────────────────────────────────────────

// Reconcile existing orders too. The former early-continue path left sold items Live.
// Multi-quantity listings stay available until GetItem confirms no units remain.
async function reconcileSoldOrder(
  supabase: ReturnType<typeof adminClient>, tenantId: string, itemId: string, listingId: string,
  soldAt: string, salePrice: number,
): Promise<string | null> {
  const { data: item, error: readError } = await supabase.from('items').select('status, quantity')
    .eq('id', itemId).eq('tenant_id', tenantId).maybeSingle();
  if (readError || !item) return 'Sold inventory could not be verified';
  if (Number(item.quantity ?? 1) > 1) return null;
  const { error: listingError } = await supabase.from('listings').update({status:'sold', ended_at:soldAt,updated_at:new Date().toISOString()})
    .eq('id',listingId).eq('item_id',itemId).eq('tenant_id',tenantId).eq('marketplace_id','ebay');
  if (listingError) return 'Sold listing status could not be saved';
  const { error: itemError } = await supabase.from('items').update({status:'sold',sold_price:salePrice,sold_at:soldAt,marketplace:'ebay',updated_at:new Date().toISOString()})
    .eq('id',itemId).eq('tenant_id',tenantId);
  return itemError ? 'Sold inventory status could not be saved' : null;
}

async function importFulfillmentOrders(
  supabase: ReturnType<typeof adminClient>,
  tenantId: string,
  ffOrders: FulfillmentOrder[],
  listingByEbayId: Map<string, { listingId: string; itemId: string; price: number; shippingCost: number; categoryId: string | null; specialistId: string | null; nicheId: string | null }>,
  existingOrderIds: Set<string>,
  logId: string,
): Promise<{ imported: number; skipped: number; errors: string[] }> {
  let imported = 0, skipped = 0;
  const errors: string[] = [];

  for (const order of ffOrders) {
    try {
      const orderId = order.orderId;
      if (!orderId) { skipped++; continue; }

      const totalStr = order.pricingSummary?.total?.value ?? '0';
      const salePrice = parseFloat(totalStr) || 0;
      // IMPORTANT: eBay Fulfillment API does NOT include final value fees.
      // Those come from the Finances API. We label this as ESTIMATE.
      const marketplaceFee = Math.round(salePrice * 0.128 * 100) / 100; // ESTIMATE
      const shippingCost = parseFloat(order.pricingSummary?.deliveryCost?.value ?? '0') || 0;
      const netRevenue = Math.round((salePrice - marketplaceFee - shippingCost) * 100) / 100;

      const buyer = order.buyer;
      const shipInstr = order.fulfillmentStartInstructions?.[0];
      const shipTo = shipInstr?.shippingStep?.shipTo;
      const addr = shipTo?.contactAddress;
      const buyerAddress = addr ? {
        name: shipTo?.fullName ?? '',
        street: addr.addressLine1 ?? '',
        city: addr.city ?? '',
        county: addr.stateOrProvince ?? '',
        postcode: addr.postalCode ?? '',
        country: addr.countryCode ?? '',
      } : {};

      // Match listing by legacy item ID
      let matchedItemId: string | null = null;
      let matchedListingId: string | null = null;
      for (const li of order.lineItems ?? []) {
        const legacyId = li.legacyItemId ?? '';
        if (legacyId) {
          const match = listingByEbayId.get(legacyId);
          if (match) { matchedItemId = match.itemId; matchedListingId = match.listingId; break; }
        }
      }

      // Niche-scoped listing map: do not import unrelated or unmatched orders.
      if (!matchedItemId || !matchedListingId) { skipped++; continue; }
      // Multi-line orders cannot be attributed to one canonical item without allocation.
      if ((order.lineItems ?? []).length !== 1) { errors.push(`Order ${orderId}: multi-line allocation requires review`); skipped++; continue; }
      // Map the current eBay state before deciding whether to insert or refresh.
      const ff = (order.orderFulfillmentStatus ?? order.fulfillmentStatus ?? '').toUpperCase();
      const fulfilmentStatus = ff === 'FULFILLED' ? 'dispatched' : 'awaiting_dispatch';
      const { data: existingRow } = await supabase.from('orders')
        .select('id, fulfilment_status, tracking_number, carrier, dispatched_at, marketplace_fee')
        .eq('tenant_id', tenantId).eq('marketplace_id', 'ebay').eq('external_order_id', orderId)
        .maybeSingle();

      if (existingRow) {
        // Sync must refresh existing orders too; otherwise later dispatches never reach SWISH.
        const updatePayload: Record<string, unknown> = {
          buyer_name: buyer?.username ?? shipTo?.fullName ?? null,
          buyer_address: buyerAddress,
          fulfilment_status: existingRow.fulfilment_status === 'delivered' || existingRow.fulfilment_status === 'completed'
            ? existingRow.fulfilment_status : fulfilmentStatus,
          sale_price: salePrice,
          shipping_cost: shippingCost,
          net_revenue: Math.round((salePrice - Number(existingRow.marketplace_fee ?? marketplaceFee) - shippingCost) * 100) / 100,
          updated_at: new Date().toISOString(),
        };
        if (fulfilmentStatus === 'dispatched' && !existingRow.dispatched_at) {
          updatePayload.dispatched_at = order.lastUpdatedAt || new Date().toISOString();
        }
        const { error: updateErr } = await supabase.from('orders').update(updatePayload)
          .eq('id', existingRow.id).eq('tenant_id', tenantId);
        if (updateErr) errors.push(`Order ${orderId} status refresh: ${updateErr.message}`);
        else {
          const reconcileError = await reconcileSoldOrder(supabase, tenantId, matchedItemId, matchedListingId, order.createdAt, salePrice);
          if (reconcileError) errors.push(`Order ${orderId}: ${reconcileError}`);
          skipped++;
        }
        existingOrderIds.add(orderId);
        continue;
      }

      const { data: inserted, error: insertErr } = await supabase.from('orders').insert({
        tenant_id: tenantId, item_id: matchedItemId, listing_id: matchedListingId,
        marketplace_id: 'ebay', external_order_id: orderId,
        buyer_name: buyer?.username ?? shipTo?.fullName ?? null,
        buyer_email: null, buyer_address: buyerAddress,
        status: 'completed',
        fulfilment_status: fulfilmentStatus,
        sale_price: salePrice, marketplace_fee: marketplaceFee,
        shipping_cost: shippingCost, net_revenue: netRevenue,
        tracking_number: null, carrier: null,
        dispatched_at: fulfilmentStatus === 'dispatched' ? order.lastUpdatedAt : null,
        notes: 'fee_note:ESTIMATE_12.8pct',
        created_at: order.createdAt, updated_at: new Date().toISOString(),
      }).select('id').single();

      if (insertErr) {
        if (insertErr.code === '23505') { skipped++; }
        else { errors.push(`Order ${orderId}: ${insertErr.message}`); skipped++; }
        continue;
      }

      if (matchedItemId) {
        const { data: curItem } = await supabase.from('items').select('status, acquired_cost').eq('id', matchedItemId).eq('tenant_id', tenantId).maybeSingle();
        const acquiredCost = Number(curItem?.acquired_cost ?? 0);
        const reconcileError = await reconcileSoldOrder(supabase, tenantId, matchedItemId, matchedListingId!, order.createdAt, salePrice);
        if (reconcileError) errors.push(`Order reconciliation: ${reconcileError}`);
        await supabase.from('sales').insert({
          tenant_id: tenantId, item_id: matchedItemId, listing_id: matchedListingId,
          niche_id: [...listingByEbayId.values()].find(l => l.listingId === matchedListingId)?.nicheId ?? null,
          specialist_id: [...listingByEbayId.values()].find(l => l.listingId === matchedListingId)?.specialistId ?? null,
          category_id: [...listingByEbayId.values()].find(l => l.listingId === matchedListingId)?.categoryId ?? null,
          marketplace_id: 'ebay', sale_price: salePrice, marketplace_fee: marketplaceFee,
          shipping_cost: shippingCost, net_revenue: netRevenue,
          profit: Math.round((netRevenue - acquiredCost) * 100) / 100,
          predicted_profit: 0, sold_at: order.createdAt, external_order_id: orderId,
        });
        // Record lifecycle event
        await supabase.from('item_lifecycle_events').insert({
          tenant_id: tenantId, item_id: matchedItemId,
          from_status: curItem?.status ?? 'listed', to_status: 'sold',
          triggered_by: 'ebay_orders_sync', notes: `eBay order ${orderId} · £${salePrice.toFixed(2)}`,
        });
      }

      existingOrderIds.add(orderId);
      imported++;
    } catch (e: any) {
      errors.push(`Parse error: ${e.message}`);
      skipped++;
    }
  }

  return { imported, skipped, errors };
}

async function importTradingOrders(
  supabase: ReturnType<typeof adminClient>,
  tenantId: string,
  tradingOrders: TradingOrder[],
  listingByEbayId: Map<string, { listingId: string; itemId: string; price: number; shippingCost: number; categoryId: string | null; specialistId: string | null; nicheId: string | null }>,
  existingOrderIds: Set<string>,
): Promise<{ imported: number; skipped: number; errors: string[] }> {
  let imported = 0, skipped = 0;
  const errors: string[] = [];

  for (const order of tradingOrders) {
    try {
      if (!order.orderId) { skipped++; continue; }

      let matchedItemId: string | null = null, matchedListingId: string | null = null;
      let salePrice = order.salePrice;
      for (const ebayItemId of order.ebayItemIds) {
        const match = listingByEbayId.get(ebayItemId);
        if (match) { matchedItemId = match.itemId; matchedListingId = match.listingId; salePrice = order.salePrice; break; }
      }

      if (!matchedItemId || !matchedListingId) { skipped++; continue; }
      if (order.ebayItemIds.length !== 1) { errors.push(`Order ${order.orderId}: multi-line allocation requires review`); skipped++; continue; }
      // ESTIMATE: never presented as exact fee
      const marketplaceFee = Math.round(salePrice * 0.128 * 100) / 100;
      const shippingCost = order.shippingCost;
      const netRevenue = Math.round((salePrice - marketplaceFee - shippingCost) * 100) / 100;

      const orderAge = Date.now() - new Date(order.createdAt || Date.now()).getTime();
      // Do not infer completion from order age. Only tracking/explicit eBay state may advance it.
      const fulfilmentStatus = order.trackingNumber ? 'dispatched' : 'awaiting_dispatch';
      const { data: existingRow } = await supabase.from('orders')
        .select('id, fulfilment_status, tracking_number, carrier, dispatched_at, marketplace_fee')
        .eq('tenant_id', tenantId).eq('marketplace_id', 'ebay').eq('external_order_id', order.orderId)
        .maybeSingle();

      if (existingRow) {
        const updatePayload: Record<string, unknown> = {
          buyer_name: order.shippingAddress.name || order.buyerUsername || null,
          buyer_email: order.buyerEmail || null,
          buyer_address: order.shippingAddress,
          sale_price: salePrice,
          shipping_cost: shippingCost,
          net_revenue: Math.round((salePrice - Number(existingRow.marketplace_fee ?? marketplaceFee) - shippingCost) * 100) / 100,
          fulfilment_status: existingRow.fulfilment_status === 'delivered' || existingRow.fulfilment_status === 'completed'
            ? existingRow.fulfilment_status
            : order.trackingNumber ? 'dispatched' : existingRow.fulfilment_status,
          updated_at: new Date().toISOString(),
        };
        if (order.trackingNumber) updatePayload.tracking_number = order.trackingNumber;
        if (order.carrier) updatePayload.carrier = order.carrier;
        if (order.trackingNumber && !existingRow.dispatched_at) updatePayload.dispatched_at = order.createdAt || new Date().toISOString();
        const { error: updateErr } = await supabase.from('orders').update(updatePayload)
          .eq('id', existingRow.id).eq('tenant_id', tenantId);
        if (updateErr) errors.push(`Order ${order.orderId} status refresh: ${updateErr.message}`);
        else {
          const reconcileError = await reconcileSoldOrder(supabase, tenantId, matchedItemId, matchedListingId, order.createdAt, salePrice);
          if (reconcileError) errors.push(`Order ${order.orderId}: ${reconcileError}`);
          skipped++;
        }
        existingOrderIds.add(order.orderId);
        continue;
      }

      const { data: inserted, error: insertErr } = await supabase.from('orders').insert({
        tenant_id: tenantId, item_id: matchedItemId, listing_id: matchedListingId,
        marketplace_id: 'ebay', external_order_id: order.orderId,
        buyer_name: order.shippingAddress.name || order.buyerUsername || null,
        buyer_email: order.buyerEmail || null, buyer_address: order.shippingAddress,
        status: 'completed', fulfilment_status: fulfilmentStatus,
        sale_price: salePrice, marketplace_fee: marketplaceFee,
        shipping_cost: shippingCost, net_revenue: netRevenue,
        tracking_number: order.trackingNumber || null, carrier: order.carrier || null,
        dispatched_at: order.trackingNumber ? order.createdAt : null,
        notes: 'fee_note:ESTIMATE_12.8pct',
        created_at: order.createdAt, updated_at: new Date().toISOString(),
      }).select('id').single();

      if (insertErr) {
        if (insertErr.code === '23505') { skipped++; } else { errors.push(`Order ${order.orderId}: ${insertErr.message}`); skipped++; }
        continue;
      }

      if (matchedItemId) {
        const { data: curItem } = await supabase.from('items').select('status, acquired_cost').eq('id', matchedItemId).eq('tenant_id', tenantId).maybeSingle();
        const acquiredCost = Number(curItem?.acquired_cost ?? 0);
        const profit = Math.round((netRevenue - acquiredCost) * 100) / 100;
        const reconcileError = await reconcileSoldOrder(supabase, tenantId, matchedItemId, matchedListingId!, order.createdAt, salePrice);
        if (reconcileError) errors.push(`Order reconciliation: ${reconcileError}`);
        await supabase.from('sales').insert({
          tenant_id: tenantId, item_id: matchedItemId, listing_id: matchedListingId,
          niche_id: [...listingByEbayId.values()].find(l => l.listingId === matchedListingId)?.nicheId ?? null,
          specialist_id: [...listingByEbayId.values()].find(l => l.listingId === matchedListingId)?.specialistId ?? null,
          category_id: [...listingByEbayId.values()].find(l => l.listingId === matchedListingId)?.categoryId ?? null,
          marketplace_id: 'ebay', sale_price: salePrice, marketplace_fee: marketplaceFee,
          shipping_cost: shippingCost, net_revenue: netRevenue, profit,
          predicted_profit: 0, sold_at: order.createdAt, external_order_id: order.orderId,
        });
        await supabase.from('item_lifecycle_events').insert({
          tenant_id: tenantId, item_id: matchedItemId,
          from_status: curItem?.status ?? 'listed', to_status: 'sold',
          triggered_by: 'ebay_orders_trading_sync', notes: `eBay order ${order.orderId} · £${salePrice.toFixed(2)}`,
        });
      }

      existingOrderIds.add(order.orderId);
      imported++;
    } catch (e: any) {
      errors.push(`Parse error: ${e.message}`);
      skipped++;
    }
  }

  return { imported, skipped, errors };
}

// ── Main handler ───────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  try {
    const body = await req.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) return jsonResponse({ error: 'Request body must be an object' }, 400);
    const { tenantId, daysBack = 90, mode = 'both', nicheId, specialistIds } = body;
    if (typeof tenantId !== 'string' || !/^[0-9a-f-]{36}$/i.test(tenantId)) return jsonResponse({ error: 'tenantId is required' }, 400);
    if (!Number.isInteger(daysBack) || daysBack < 1 || daysBack > 365 || !['both','fulfillment_api','trading_api'].includes(mode)) return jsonResponse({ error: 'Invalid order sync parameters' }, 400);
    const products = registry.products as Record<string, { specialists: string[]; legacySpecialists: string[] }>;
    if (nicheId !== undefined && (typeof nicheId !== 'string' || !Object.prototype.hasOwnProperty.call(products,nicheId))) return jsonResponse({ error: 'Unknown niche' }, 400);
    const known = Object.values(products).flatMap(product => [...product.specialists, ...product.legacySpecialists]);
    if (specialistIds !== undefined && (!Array.isArray(specialistIds) || specialistIds.some((id: unknown) => typeof id !== 'string' || !known.includes(id)))) return jsonResponse({ error: 'Invalid specialist scope' }, 400);
    const scopeIds: string[] | undefined = nicheId ? [...products[nicheId].specialists, ...products[nicheId].legacySpecialists] : specialistIds;
    if (nicheId && specialistIds?.some((id: string) => !scopeIds!.includes(id))) return jsonResponse({ error: 'Specialist does not belong to niche' }, 400);

    const supabase = adminClient();

    // Security: verify caller
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return jsonResponse({ error: 'Authentication required.' }, 401);
    const authToken = authHeader.replace('Bearer ', '').trim();
    if (!authToken || authToken === Deno.env.get('SUPABASE_ANON_KEY')) return jsonResponse({ error: 'Authentication required.' }, 401);
    try {
      const userClient = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', { global: { headers: { Authorization: authHeader } } });
      const { data: { user }, error: uErr } = await userClient.auth.getUser();
      if (uErr || !user) return jsonResponse({ error: 'Invalid authentication token.' }, 401);
      const { data: member } = await supabase.from('tenant_memberships').select('id').eq('tenant_id', tenantId).eq('user_id', user.id).maybeSingle();
      if (!member) return jsonResponse({ error: 'Access denied.' }, 403);
    } catch (e: any) {
      return jsonResponse({ error: 'Authentication could not be verified.' }, 401);
    }

    if (scopeIds?.length === 0) return jsonResponse({ success: true, imported: 0, skipped: 0 });
    // Start sync log
    const { data: syncLog } = await supabase.from('ebay_sync_log').insert({
      tenant_id: tenantId, sync_type: 'orders', status: 'running',
      started_at: new Date().toISOString(), metadata: { daysBack, mode },
    }).select('id').single();
    const logId = syncLog?.id ?? '';

    let creds: { accessToken: string; clientId: string; credentials: any };
    try { creds = await getCredentials(tenantId); } catch (e: any) {
      if (logId) await supabase.from('ebay_sync_log').update({ status: 'failed', error_message: e.message, completed_at: new Date().toISOString() }).eq('id', logId);
      return jsonResponse({ error: e.message }, 400);
    }

    // Load existing listings for matching
    let listingQuery = supabase
      .from('listings')
      .select('id, item_id, external_listing_id, price, shipping_cost, category_id, items!inner(specialist_id)')
      .eq('tenant_id', tenantId).eq('items.tenant_id', tenantId).eq('marketplace_id', 'ebay')
      .not('external_listing_id', 'is', null);
    if (scopeIds) listingQuery = listingQuery.in('items.specialist_id', scopeIds);
    const { data: listingsData, error: listingError } = await listingQuery;
    if (listingError) return jsonResponse({ error: 'Listing scope could not be verified' }, 503);

    const listingByEbayId = new Map<string, { listingId: string; itemId: string; price: number; shippingCost: number; categoryId: string | null; specialistId: string | null; nicheId: string | null }>();
    for (const l of listingsData ?? []) {
      if (l.external_listing_id) listingByEbayId.set(l.external_listing_id, {
        listingId: l.id, itemId: l.item_id, price: Number(l.price ?? 0), shippingCost: Number(l.shipping_cost ?? 0), categoryId: l.category_id == null ? null : String(l.category_id), specialistId: (l as any).items?.specialist_id ?? null, nicheId: nicheForSpecialist((l as any).items?.specialist_id),
      });
    }

    // Load existing order IDs to prevent duplicates
    const { data: existingOrdersData } = await supabase
      .from('orders').select('external_order_id').eq('tenant_id', tenantId).eq('marketplace_id', 'ebay').not('external_order_id', 'is', null);
    const existingOrderIds = new Set<string>((existingOrdersData ?? []).map(o => o.external_order_id).filter(Boolean));

    let totalImported = 0, totalSkipped = 0;
    const allErrors: string[] = [];
    let ffApiUsed = false, tradingApiUsed = false;

    // ── Try Fulfillment REST API first ──────────────────────────────────────
    if (mode === 'fulfillment_api' || mode === 'both') {
      const { orders: ffOrders, apiError } = await fetchFulfillmentOrders(creds.accessToken, daysBack);
      if (!apiError) {
        ffApiUsed = true;
        const result = await importFulfillmentOrders(supabase, tenantId, ffOrders, listingByEbayId, existingOrderIds, logId);
        totalImported += result.imported;
        totalSkipped += result.skipped;
        allErrors.push(...result.errors);
        console.log(`[SWISH Orders] Fulfillment API: fetched=${ffOrders.length} imported=${result.imported} skipped=${result.skipped}`);
      } else if (apiError) {
        console.log(`[SWISH Orders] Fulfillment API unavailable: ${apiError} — will try Trading API`);
        allErrors.push(`Fulfillment API: ${apiError}`);
      }
    }

    // ── Fall back to Trading API if needed ──────────────────────────────────
    if (mode === 'trading_api' || (mode === 'both' && !ffApiUsed)) {
      const { orders: tradingOrders, error: tradingErr } = await fetchTradingOrders(creds.accessToken, creds.clientId, daysBack);
      if (!tradingErr) {
        tradingApiUsed = true;
        const result = await importTradingOrders(supabase, tenantId, tradingOrders, listingByEbayId, existingOrderIds);
        totalImported += result.imported;
        totalSkipped += result.skipped;
        allErrors.push(...result.errors);
        console.log(`[SWISH Orders] Trading API: fetched=${tradingOrders.length} imported=${result.imported} skipped=${result.skipped}`);
      } else {
        allErrors.push(`Trading API: ${tradingErr}`);
      }
    }

    // Update sync log
    if (logId) {
      await supabase.from('ebay_sync_log').update({
        status: allErrors.length > 0 && totalImported === 0 ? 'failed' : 'completed',
        records_created: totalImported, records_skipped: totalSkipped,
        errors: allErrors.slice(0, 20),
        completed_at: new Date().toISOString(),
        metadata: { daysBack, mode, ffApiUsed, tradingApiUsed },
      }).eq('id', logId);
    }

    return jsonResponse({
      success: ffApiUsed || tradingApiUsed, imported: totalImported, skipped: totalSkipped,
      partial: allErrors.length > 0,
      error: !ffApiUsed && !tradingApiUsed ? 'Neither eBay orders API completed successfully' : undefined,
      total: totalImported + totalSkipped,
      matched: totalImported, // All imports are potentially matched
      errors: allErrors.slice(0, 10),
      apiUsed: ffApiUsed ? 'fulfillment_rest' : tradingApiUsed ? 'trading_xml' : 'none',
      feeNote: 'Marketplace fees are ESTIMATED at ~12.8%. Actual eBay fees vary by category, item price, and seller subscription level. Use Finances sync for exact figures.',
    });
  } catch (err: any) {
    console.error('swish-ebay-orders unhandled error:', err.message);
    return jsonResponse({ error: 'Unable to synchronize eBay orders. Please retry.' }, 500);
  }
});
