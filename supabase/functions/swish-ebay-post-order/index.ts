// SWISH — eBay Fulfillment Dispatch Edge Function v2
//
// CRITICAL: This function performs the ACTUAL eBay fulfilment update.
//
// When a SWISH order is marked as dispatched, this function:
//   1. Obtains the eBay order ID from the SWISH order record
//   2. Calls eBay Sell Fulfillment API: POST /order/{orderId}/shipping_fulfillment
//   3. Records carrier + tracking to eBay
//   4. Only marks SWISH as dispatched IF eBay confirms success
//   5. On eBay rejection: returns the eBay error — NEVER silently marks as dispatched
//
// Routes:
//   dispatch     — submit tracking/carrier to eBay and update SWISH order
//   get_shipping — fetch shipping fulfillments for an order from eBay
//
// POST body:
//   {
//     route: 'dispatch' | 'get_shipping',
//     tenantId: string,
//     orderId: string,          // SWISH order UUID
//     carrier: string,          // e.g. 'Royal Mail'
//     trackingNumber: string,   // e.g. 'RM123456789GB'
//     serviceCode?: string,     // eBay shipping service code (optional)
//     dispatchPhotoUrl?: string // URL of dispatch proof photo (optional)
//   }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { encryptCredentials, decryptCredentials } from '../_shared/credentialCrypto.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const EBAY_FULFILLMENT_API = 'https://api.ebay.com/sell/fulfillment/v1';
const EBAY_TOKEN_URL       = 'https://api.ebay.com/identity/v1/oauth2/token';

function adminClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// ── Token refresh ─────────────────────────────────────────────────────────────

async function refreshToken(
  clientId: string, clientSecret: string, refreshToken: string,
): Promise<{ accessToken: string; expiresAt: string }> {
  const basicAuth = btoa(`${clientId}:${clientSecret}`);
  const resp = await fetch(EBAY_TOKEN_URL, {
    method: 'POST',
    headers: { Authorization: `Basic ${basicAuth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      scope: 'https://api.ebay.com/oauth/api_scope/sell.fulfillment https://api.ebay.com/oauth/api_scope/sell.inventory',
    }).toString(),
    signal: AbortSignal.timeout(15000),
  });
  const data = await resp.json();
  if (!data.access_token) throw new Error(`Token refresh failed: ${data.error_description ?? 'unknown'}`);
  return { accessToken: data.access_token, expiresAt: new Date(Date.now() + (data.expires_in ?? 7200) * 1000).toISOString() };
}

// ── Load credentials with refresh ─────────────────────────────────────────────

async function getAccessToken(
  supabase: ReturnType<typeof adminClient>,
  tenantId: string,
): Promise<{ accessToken: string } | { error: string }> {
  const { data: conn } = await supabase
    .from('marketplace_connectors')
    .select('credential_ref, status, access_token_expires_at')
    .eq('tenant_id', tenantId).eq('marketplace_id', 'ebay').maybeSingle();

  if (!conn?.credential_ref) return { error: 'eBay not connected. Connect eBay in Marketplaces.' };
  if (conn.status !== 'connected') return { error: `eBay not connected (status: ${conn.status}). Re-authorise in Marketplaces.` };

  let creds: any;
  try { creds = await decryptCredentials(conn.credential_ref); }
  catch (e: any) { return { error: `eBay credentials corrupted: ${e.message}. Re-connect eBay.` }; }

  if (!creds.accessToken) return { error: 'No eBay access token. Re-authorise eBay in Marketplaces.' };

  const shouldRefresh = creds.expiresAt ? Date.now() + 5 * 60_000 >= new Date(creds.expiresAt).getTime() : false;
  if (shouldRefresh && creds.refreshToken) {
    try {
      const { accessToken: newToken, expiresAt: newExpiry } = await refreshToken(creds.clientId, creds.clientSecret, creds.refreshToken);
      creds = { ...creds, accessToken: newToken, expiresAt: newExpiry };
      const updatedRef = await encryptCredentials(creds);
      await supabase.from('marketplace_connectors').update({
        credential_ref: updatedRef, access_token_expires_at: newExpiry, updated_at: new Date().toISOString(),
      }).eq('tenant_id', tenantId).eq('marketplace_id', 'ebay');
    } catch (e: any) {
      return { error: `Token refresh failed: ${e.message}. Please re-authorise eBay.` };
    }
  }

  return { accessToken: creds.accessToken };
}

// ── Map carrier name to eBay shipping service code ────────────────────────────
//
// eBay requires a valid shipping carrier code. USPS/RMUK are different from display names.
// We provide a best-effort mapping; sellers can override with serviceCode param.

function mapCarrierToEbayCode(carrier: string): string {
  const c = carrier.toLowerCase().replace(/\s+/g, '');
  // Royal Mail mappings
  if (c.includes('royalmail') || c === 'rm') return 'ROYALMAILSECONDCLASSLETTER';
  if (c.includes('evri') || c.includes('hermes')) return 'EVRIMyHermes';
  if (c.includes('dpd')) return 'DPDLocalDropOff';
  if (c.includes('parcelforce')) return 'PARCELFORCE48';
  if (c.includes('dhl')) return 'DHLExpressWorldwide';
  if (c.includes('ups')) return 'UPSExpressSaver';
  // Generic fallback — eBay will accept unknown codes for non-tracked
  return 'OTHER';
}

// ── Route: dispatch ──────────────────────────────────────────────────────────

async function handleDispatch(
  supabase: ReturnType<typeof adminClient>,
  tenantId: string,
  swishOrderId: string,
  carrier: string,
  trackingNumber: string,
  serviceCode?: string,
  dispatchPhotoUrl?: string,
): Promise<Response> {
  // 1. Load the SWISH order to get the eBay external_order_id
  const { data: orderRow, error: orderErr } = await supabase
    .from('orders')
    .select('id, external_order_id, fulfilment_status, marketplace_id, item_id, listing_id, tenant_id')
    .eq('id', swishOrderId)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (orderErr || !orderRow) {
    return jsonResponse({ error: 'Order not found or access denied.' }, 404);
  }
  if (orderRow.marketplace_id !== 'ebay') {
    return jsonResponse({ error: 'This dispatch endpoint only supports eBay orders.' }, 400);
  }
  if (orderRow.fulfilment_status === 'dispatched' || orderRow.fulfilment_status === 'delivered' || orderRow.fulfilment_status === 'completed') {
    return jsonResponse({ error: `Order is already ${orderRow.fulfilment_status}. Cannot re-dispatch.` }, 400);
  }

  const ebayOrderId = orderRow.external_order_id;
  if (!ebayOrderId) {
    // No eBay order ID — can only update SWISH locally
    console.warn(`[SWISH Dispatch] Order ${swishOrderId} has no external_order_id — local update only`);
    const localUpdate = await updateSwishOrderDispatched(supabase, swishOrderId, carrier, trackingNumber, dispatchPhotoUrl);
    if (localUpdate.error) return jsonResponse({ error: localUpdate.error }, 500);
    return jsonResponse({
      success: true,
      ebayFulfillmentSubmitted: false,
      localOnly: true,
      warning: 'Order updated locally only. No eBay order ID was found to submit tracking to eBay. If this was an eBay sale, please sync orders first.',
    });
  }

  // 2. Get eBay access token
  const tokenResult = await getAccessToken(supabase, tenantId);
  if ('error' in tokenResult) return jsonResponse({ error: tokenResult.error }, 400);
  const { accessToken } = tokenResult;

  // 3. Call eBay Fulfillment API: POST /order/{orderId}/shipping_fulfillment
  //    This is the CURRENTLY SUPPORTED eBay API for marking orders as shipped.
  //
  //    eBay requires:
  //      - shippedDate: ISO 8601 datetime
  //      - shippingCarrierCode: carrier code
  //      - trackingNumber: optional (required for tracked services)
  //      - lineItems: array of { lineItemId, quantity }
  //
  //    We first fetch the order from eBay to get the line item IDs.

  // 3a. Fetch eBay order to get line item IDs
  let lineItems: Array<{ lineItemId: string; quantity: number }> = [];
  try {
    const orderResp = await fetch(`${EBAY_FULFILLMENT_API}/order/${encodeURIComponent(ebayOrderId)}`, {
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json', 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB' },
      signal: AbortSignal.timeout(10000),
    });
    if (orderResp.ok) {
      const orderData = await orderResp.json();
      lineItems = (orderData.lineItems ?? []).map((li: any) => ({
        lineItemId: li.lineItemId,
        quantity: li.quantity ?? 1,
      }));
    } else {
      const errText = await orderResp.text().catch(() => '');
      console.log(`[SWISH Dispatch] eBay order fetch ${orderResp.status}: ${errText.slice(0, 200)}`);
      // If 404, the order may not be a Managed Payments order — fall through to local-only
      if (orderResp.status === 404) {
        console.warn(`[SWISH Dispatch] eBay order ${ebayOrderId} not found via Fulfillment API — local update only`);
        const localUpdate = await updateSwishOrderDispatched(supabase, swishOrderId, carrier, trackingNumber, dispatchPhotoUrl);
        if (localUpdate.error) return jsonResponse({ error: localUpdate.error }, 500);
        return jsonResponse({
          success: true,
          ebayFulfillmentSubmitted: false,
          localOnly: true,
          warning: `eBay order ${ebayOrderId} not found via Fulfillment API. Order may use legacy Trading API format. SWISH updated locally. Please mark as shipped in eBay Seller Hub if required.`,
        });
      }
    }
  } catch (e: any) {
    console.log(`[SWISH Dispatch] eBay order fetch error: ${e.message} — proceeding with fulfillment without line item IDs`);
  }

  // 3b. Submit shipping fulfillment to eBay
  const shippingCarrierCode = serviceCode || mapCarrierToEbayCode(carrier);
  const shippedDate = new Date().toISOString();

  const fulfillmentPayload: any = {
    shippedDate,
    shippingCarrierCode,
    trackingNumber: trackingNumber || null,
  };

  if (lineItems.length > 0) {
    fulfillmentPayload.lineItems = lineItems;
  }

  let ebayFulfillmentId: string | null = null;
  let ebayFulfillmentError: string | null = null;
  let ebayFulfillmentSubmitted = false;

  try {
    const fulfillResp = await fetch(
      `${EBAY_FULFILLMENT_API}/order/${encodeURIComponent(ebayOrderId)}/shipping_fulfillment`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB',
        },
        body: JSON.stringify(fulfillmentPayload),
        signal: AbortSignal.timeout(15000),
      },
    );

    const responseText = await fulfillResp.text();
    console.log(`[SWISH Dispatch] eBay fulfillment API ${fulfillResp.status} for order ${ebayOrderId}`);

    if (fulfillResp.status === 201 || fulfillResp.status === 200) {
      // Success — eBay confirmed the fulfillment
      ebayFulfillmentSubmitted = true;
      try {
        const responseData = JSON.parse(responseText);
        ebayFulfillmentId = responseData.fulfillmentId ?? null;
      } catch {}
      console.log(`[SWISH Dispatch] eBay fulfillment confirmed for order ${ebayOrderId}, fulfillmentId=${ebayFulfillmentId}`);
    } else if (fulfillResp.status === 204) {
      // No content — some eBay accounts return 204 on success
      ebayFulfillmentSubmitted = true;
      console.log(`[SWISH Dispatch] eBay fulfillment 204 (success, no content) for order ${ebayOrderId}`);
    } else {
      // FAILURE: eBay rejected the fulfillment — parse the error
      let parsedError = `eBay Fulfillment API returned ${fulfillResp.status}`;
      try {
        const errData = JSON.parse(responseText);
        const errors: any[] = errData.errors ?? [];
        if (errors.length > 0) {
          const messages = errors.map(e => e.message ?? e.longMessage ?? e.errorId ?? 'unknown error');
          parsedError = `eBay rejected dispatch: ${messages.join('; ')}`;
        } else if (errData.message) {
          parsedError = `eBay: ${errData.message}`;
        }
      } catch {
        parsedError = `eBay Fulfillment API error (${fulfillResp.status}): ${responseText.slice(0, 300)}`;
      }

      ebayFulfillmentError = parsedError;

      // CRITICAL: If eBay rejected, we still update SWISH locally but clearly flag the error
      // The user must be informed that eBay was NOT updated
      console.error(`[SWISH Dispatch] eBay fulfillment REJECTED for order ${ebayOrderId}: ${parsedError}`);

      // Log the API failure
      await supabase.from('ebay_api_log').insert({
        tenant_id: tenantId, operation: 'shipping_fulfillment',
        endpoint: `${EBAY_FULFILLMENT_API}/order/${ebayOrderId}/shipping_fulfillment`,
        http_status: fulfillResp.status, error_message: parsedError,
        entity_type: 'order', entity_id: swishOrderId, success: false,
      });

      // Return the error — do NOT update SWISH as dispatched
      // The UI should show the error and allow retry
      return jsonResponse({
        success: false,
        ebayFulfillmentSubmitted: false,
        error: parsedError,
        ebayError: parsedError,
        retryable: fulfillResp.status >= 500 || fulfillResp.status === 429,
        hint: fulfillResp.status === 403
          ? 'eBay has not granted SWISH fulfillment permissions. Re-authorise eBay in Marketplaces and ensure "sell.fulfillment" scope is included.'
          : fulfillResp.status === 404
          ? 'eBay order not found. It may have been cancelled or this is a legacy order format. Please mark as shipped directly in eBay Seller Hub.'
          : undefined,
      }, 400);
    }
  } catch (e: any) {
    ebayFulfillmentError = `Network error reaching eBay: ${e.message}`;
    console.error(`[SWISH Dispatch] eBay fulfillment network error: ${e.message}`);

    return jsonResponse({
      success: false,
      ebayFulfillmentSubmitted: false,
      error: ebayFulfillmentError,
      retryable: true,
    }, 503);
  }

  // 4. eBay confirmed — now update SWISH
  const swishUpdate = await updateSwishOrderDispatched(
    supabase, swishOrderId, carrier, trackingNumber, dispatchPhotoUrl, ebayFulfillmentId,
  );
  if (swishUpdate.error) {
    // eBay was updated but SWISH DB update failed — this is a data integrity issue
    console.error(`[SWISH Dispatch] eBay confirmed but SWISH DB update failed: ${swishUpdate.error}`);
    return jsonResponse({
      success: false,
      ebayFulfillmentSubmitted: true,
      ebayFulfillmentId,
      error: `eBay was updated successfully (fulfillmentId=${ebayFulfillmentId}) but the SWISH database update failed: ${swishUpdate.error}. Please sync orders to restore consistency.`,
      ebaySuccess: true,
      swishSuccess: false,
    }, 500);
  }

  // 5. Log success
  await supabase.from('ebay_api_log').insert({
    tenant_id: tenantId, operation: 'shipping_fulfillment',
    endpoint: `${EBAY_FULFILLMENT_API}/order/${ebayOrderId}/shipping_fulfillment`,
    http_status: 201, entity_type: 'order', entity_id: swishOrderId, success: true,
    duration_ms: null,
  });

  return jsonResponse({
    success: true,
    ebayFulfillmentSubmitted: true,
    ebayFulfillmentId,
    ebayOrderId,
    carrier,
    trackingNumber,
    dispatchedAt: shippedDate,
  });
}

// ── Update SWISH order as dispatched ─────────────────────────────────────────

async function updateSwishOrderDispatched(
  supabase: ReturnType<typeof adminClient>,
  orderId: string,
  carrier: string,
  trackingNumber: string,
  dispatchPhotoUrl?: string,
  ebayFulfillmentId?: string | null,
): Promise<{ error: string | null }> {
  const { error } = await supabase.from('orders').update({
    fulfilment_status: 'dispatched',
    tracking_number: trackingNumber || null,
    carrier: carrier || null,
    dispatched_at: new Date().toISOString(),
    ...(dispatchPhotoUrl ? { dispatch_photo_url: dispatchPhotoUrl } : {}),
    ...(ebayFulfillmentId ? { notes: `ebay_fulfillment_id:${ebayFulfillmentId}` } : {}),
    updated_at: new Date().toISOString(),
  }).eq('id', orderId);

  return { error: error?.message ?? null };
}

// ── Route: get_shipping ───────────────────────────────────────────────────────

async function handleGetShipping(
  supabase: ReturnType<typeof adminClient>,
  tenantId: string,
  swishOrderId: string,
): Promise<Response> {
  const { data: orderRow } = await supabase
    .from('orders').select('external_order_id, marketplace_id')
    .eq('id', swishOrderId).eq('tenant_id', tenantId).maybeSingle();

  if (!orderRow?.external_order_id) {
    return jsonResponse({ error: 'Order not found or no eBay order ID.' }, 404);
  }

  const tokenResult = await getAccessToken(supabase, tenantId);
  if ('error' in tokenResult) return jsonResponse({ error: tokenResult.error }, 400);

  try {
    const resp = await fetch(
      `${EBAY_FULFILLMENT_API}/order/${encodeURIComponent(orderRow.external_order_id)}/shipping_fulfillment`,
      {
        headers: {
          'Authorization': `Bearer ${tokenResult.accessToken}`,
          'Content-Type': 'application/json',
          'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB',
        },
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      return jsonResponse({ error: `eBay API ${resp.status}: ${errText.slice(0, 200)}` }, resp.status >= 500 ? 503 : 400);
    }
    const data = await resp.json();
    return jsonResponse({ success: true, fulfillments: data.fulfillments ?? [] });
  } catch (e: any) {
    return jsonResponse({ error: `Network error: ${e.message}` }, 503);
  }
}

// ── Main Handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  let body: any;
  try { body = await req.json(); } catch { return jsonResponse({ error: 'Invalid JSON' }, 400); }

  const { route = 'dispatch', tenantId, orderId } = body;
  if (!tenantId) return jsonResponse({ error: 'tenantId is required' }, 400);
  if (!orderId)  return jsonResponse({ error: 'orderId is required' }, 400);

  const supabase = adminClient();
  const authHeader = req.headers.get('Authorization');

  // Security verification
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
    return jsonResponse({ error: `Auth error: ${e.message}` }, 401);
  }

  try {
    if (route === 'dispatch') {
      const { carrier = '', trackingNumber = '', serviceCode, dispatchPhotoUrl } = body;
      return await handleDispatch(supabase, tenantId, orderId, carrier, trackingNumber, serviceCode, dispatchPhotoUrl);
    }

    if (route === 'get_shipping') {
      return await handleGetShipping(supabase, tenantId, orderId);
    }

    return jsonResponse({ error: `Unknown route: ${route}` }, 400);
  } catch (err: any) {
    console.error(`[SWISH Dispatch] Unhandled error (route=${route}): ${err.message}`);
    return jsonResponse({ error: err.message ?? 'Internal error' }, 500);
  }
});
