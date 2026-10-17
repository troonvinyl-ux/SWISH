// SWISH — Safe eBay unpublished-offer round-trip diagnostic
// This function ONLY reads or updates an existing UNPUBLISHED Inventory API offer.
// It never creates an offer and never calls publishOffer.
// All credentials remain server-side and tenant membership is required.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { decryptCredentials, encryptCredentials } from '../_shared/credentialCrypto.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token';
const INVENTORY_URL = 'https://api.ebay.com/sell/inventory/v1';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
function adminClient() {
  return createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
}

async function getCredentials(db: ReturnType<typeof adminClient>, tenantId: string) {
  const { data: connector, error } = await db.from('marketplace_connectors')
    .select('credential_ref,status,access_token_expires_at')
    .eq('tenant_id', tenantId).eq('marketplace_id', 'ebay').maybeSingle();
  if (error || !connector?.credential_ref) throw new Error('eBay connector not found. Connect eBay in SWISH settings.');
  if (connector.status !== 'connected') throw new Error('eBay is not connected. Reconnect it in SWISH settings.');
  const credentials: any = await decryptCredentials(connector.credential_ref);
  if (!credentials.accessToken || !credentials.clientId || !credentials.clientSecret) {
    throw new Error('The connected eBay credentials are incomplete. Reconnect eBay in SWISH settings.');
  }
  const expiry = credentials.expiresAt ? new Date(credentials.expiresAt).getTime() : 0;
  if (expiry && Date.now() + 60_000 >= expiry) {
    if (!credentials.refreshToken) throw new Error('The eBay token expired and has no refresh token. Reconnect eBay.');
    const resp = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + btoa(credentials.clientId + ':' + credentials.clientSecret),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: credentials.refreshToken }).toString(),
      signal: AbortSignal.timeout(15000),
    });
    const tokenData: any = await resp.json().catch(() => ({}));
    if (!resp.ok || !tokenData.access_token) throw new Error('eBay token refresh failed. Reconnect eBay in SWISH settings.');
    credentials.accessToken = tokenData.access_token;
    credentials.expiresAt = new Date(Date.now() + Number(tokenData.expires_in ?? 7200) * 1000).toISOString();
    if (tokenData.refresh_token) credentials.refreshToken = tokenData.refresh_token;
    const encrypted = await encryptCredentials(credentials);
    await db.from('marketplace_connectors').update({
      credential_ref: encrypted,
      access_token_expires_at: credentials.expiresAt,
      updated_at: new Date().toISOString(),
    }).eq('tenant_id', tenantId).eq('marketplace_id', 'ebay');
  }
  return credentials;
}

async function ebayRequest(token: string, offerId: string, method: 'GET' | 'PUT', body?: unknown) {
  const response = await fetch(`${INVENTORY_URL}/offer/${encodeURIComponent(offerId)}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Content-Language': 'en-GB',
      'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15000),
  });
  const text = await response.text();
  let data: any = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { message: text.slice(0, 500) }; }
  if (!response.ok) {
    if (response.status === 403) throw new Error('eBay denied Inventory API access. The connected account may need sell.inventory re-authorisation.');
    throw new Error(`eBay Inventory API returned HTTP ${response.status}: ${String(data?.errors?.[0]?.message ?? data?.message ?? 'request failed').slice(0, 300)}`);
  }
  return data;
}

function safeOffer(offer: any) {
  return {
    offerId: String(offer?.offerId ?? ''),
    sku: String(offer?.sku ?? ''),
    marketplaceId: String(offer?.marketplaceId ?? ''),
    format: String(offer?.format ?? ''),
    status: String(offer?.status ?? ''),
    categoryId: String(offer?.categoryId ?? ''),
    listingDescription: String(offer?.listingDescription ?? ''),
    availableQuantity: offer?.availableQuantity ?? null,
    pricingSummary: offer?.pricingSummary ?? null,
    listingPolicies: offer?.listingPolicies ?? null,
    merchantLocationKey: String(offer?.merchantLocationKey ?? ''),
    warnings: Array.isArray(offer?.warnings) ? offer.warnings : [],
    errors: Array.isArray(offer?.errors) ? offer.errors : [],
  };
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'POST required.' }, 405);
  try {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Sign in to SWISH first.' }, 401);
    const body: any = await request.json();
    const tenantId = typeof body?.tenantId === 'string' ? body.tenantId : '';
    const offerId = typeof body?.offerId === 'string' ? body.offerId.trim() : '';
    const action = body?.action;
    if (!tenantId) return json({ error: 'Tenant is required.' }, 400);
    if (!['read_offer', 'round_trip_unpublished'].includes(action)) return json({ error: 'Unsupported test action.' }, 400);
    if (!offerId || offerId.length > 200 || /[\r\n]/.test(offerId)) return json({ error: 'Enter a valid eBay offer ID.' }, 400);

    const db = adminClient();
    const userClient = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return json({ error: 'Your SWISH session has expired. Sign in again.' }, 401);
    const { data: membership } = await db.from('tenant_memberships').select('id')
      .eq('tenant_id', tenantId).eq('user_id', user.id).maybeSingle();
    if (!membership) return json({ error: 'Access denied for this SWISH organisation.' }, 403);

    const credentials = await getCredentials(db, tenantId);
    const before = await ebayRequest(credentials.accessToken, offerId, 'GET');
    if (String(before?.offerId ?? '') !== offerId) return json({ error: 'eBay returned an unexpected offer. No changes were made.' }, 409);
    if (String(before?.marketplaceId ?? '') !== 'EBAY_GB') return json({ error: 'This test only supports EBAY_GB offers. No changes were made.' }, 400);
    if (String(before?.status ?? '').toUpperCase() !== 'UNPUBLISHED') {
      return json({
        error: 'Safety stop: this offer is not explicitly UNPUBLISHED, so SWISH will not update it.',
        offer: safeOffer(before),
        changed: false,
      }, 409);
    }

    if (action === 'read_offer') {
      return json({ ok: true, action, changed: false, offer: safeOffer(before) });
    }

    // Fetch the complete server-side offer, then PUT that same offer unchanged.
    // Do not trust a client-supplied offer body. This endpoint never publishes.
    const afterPut = await ebayRequest(credentials.accessToken, offerId, 'PUT', before);
    const after = await ebayRequest(credentials.accessToken, offerId, 'GET');
    if (String(after?.status ?? '').toUpperCase() !== 'UNPUBLISHED') {
      return json({
        ok: false,
        error: 'Safety verification failed: eBay no longer reports the offer as UNPUBLISHED. Do not continue testing.',
        before: safeOffer(before),
        after: safeOffer(after),
        changed: true,
      }, 409);
    }
    const beforeSafe = safeOffer(before);
    const afterSafe = safeOffer(after);
    const changedFields = Object.keys(beforeSafe).filter((key) =>
      JSON.stringify((beforeSafe as any)[key]) !== JSON.stringify((afterSafe as any)[key])
    );
    return json({
      ok: changedFields.length === 0,
      action,
      changed: true,
      before: beforeSafe,
      after: afterSafe,
      changedFields,
      message: changedFields.length === 0
        ? 'Unpublished offer round-trip verified; no tracked offer fields changed.'
        : 'Unpublished offer was updated, but tracked fields differ. Review the before/after values.',
      warnings: afterPut?.warnings ?? [],
    });
  } catch (error: any) {
    // Never log credentials or raw eBay request bodies.
    console.error('[SWISH Draft Round-Trip] Request failed:', String(error?.message ?? 'unknown').slice(0, 400));
    return json({ error: String(error?.message ?? 'Draft test failed.').slice(0, 500) }, 400);
  }
});
