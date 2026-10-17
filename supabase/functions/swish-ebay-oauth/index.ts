// SWISH eBay OAuth 2.0 Edge Function v2
//
// Routes:
//
//   POST { action: 'start_subscriber_authorization', tenantId }
//     → SUBSCRIBER FLOW: uses server-side SWISH app credentials (never sent to client)
//     → verifies authenticated SWISH user + tenant membership
//     → creates one-time OAuth session, returns { consentUrl }
//
//   POST { action: 'authorize', tenantId, clientId, clientSecret, ruName }
//     → ADMIN/DEVELOPER FLOW: caller supplies custom credentials
//     → verifies authenticated SWISH user + tenant membership
//     → stores encrypted credentials, creates session, returns { consentUrl }
//
//   GET  ?route=callback&code=xxx&state=<nonce>
//     → validates nonce against oauth_sessions (one-time-use, 15-min expiry)
//     → retrieves tenant + credentials from DB
//     → exchanges code for tokens, marks connector connected, returns HTML page
//
// SECURITY:
//   - SWISH eBay app credentials (EBAY_CLIENT_ID, EBAY_CLIENT_SECRET, EBAY_RU_NAME)
//     are read from Edge Function secrets ONLY — never sent to the mobile client
//   - All access token / refresh token values stored AES-256-GCM encrypted
//   - state nonce is single-use with 15-minute expiry

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { encryptCredentials, decryptCredentials } from '../_shared/credentialCrypto.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

const EBAY_AUTH_URL  = 'https://auth.ebay.com/oauth2/authorize';
const EBAY_TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token';
const CALLBACK_URL   = 'https://iwgaqieyoahmcjfziwga.backend.onspace.ai/functions/v1/swish-ebay-oauth?route=callback';

const EBAY_SCOPES = [
  'https://api.ebay.com/oauth/api_scope/sell.inventory',
  'https://api.ebay.com/oauth/api_scope/sell.fulfillment',
  'https://api.ebay.com/oauth/api_scope/sell.account',
  'https://api.ebay.com/oauth/api_scope/sell.finances',
  'https://api.ebay.com/oauth/api_scope/sell.marketing',
  'https://api.ebay.com/oauth/api_scope/commerce.identity.readonly',
  // Required by the EBAY_GB live category browser and publish-time leaf validator.
  // Existing sellers must re-authorise once to grant this additional scope.
  'https://api.ebay.com/oauth/api_scope/commerce.taxonomy.readonly',
  // v7: Terapeak / Sell Analytics — enables GET /sell/analytics/v1/product_research/sell
  // Provides genuine historical sold price data (same as eBay Seller Hub Product Research).
  // Existing connected accounts will not have this scope until they re-authorise.
  'https://api.ebay.com/oauth/api_scope/sell.analytics.readonly',
].join(' ');

// ── Helpers ───────────────────────────────────────────────────────────────────

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

function htmlResponse(html: string, status = 200) {
  return new Response(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

function generateStateNonce(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── JWT + tenant membership verification ─────────────────────────────────────

async function verifyUserAndTenant(
  authHeader: string | null,
  tenantId: string,
  supabase: ReturnType<typeof adminClient>,
): Promise<{ ok: boolean; userId?: string; error?: string; status?: number }> {
  if (!authHeader) return { ok: false, error: 'Authentication required. Please sign in to SWISH.', status: 401 };
  const token = authHeader.replace('Bearer ', '').trim();
  if (!token || token === Deno.env.get('SUPABASE_ANON_KEY')) {
    return { ok: false, error: 'Authentication required. Please sign in to SWISH.', status: 401 };
  }
  const userClient = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: { user }, error: authErr } = await userClient.auth.getUser();
  if (authErr || !user) {
    return { ok: false, error: 'Invalid or expired authentication token. Please sign in again.', status: 401 };
  }
  const { data: membership } = await supabase
    .from('tenant_memberships')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!membership) {
    console.warn(`[SWISH Security] swish-ebay-oauth: User ${user.id} attempted tenant ${tenantId} — not a member`);
    return { ok: false, error: 'Access denied: you are not a member of this organisation.', status: 403 };
  }
  return { ok: true, userId: user.id };
}

// ── Create OAuth session and return consent URL ───────────────────────────────
// Shared by both subscriber and admin flows.

async function createOAuthSession(
  supabase: ReturnType<typeof adminClient>,
  tenantId: string,
  clientId: string,
  clientSecret: string,
  ruName: string,
  sellerAccountId: string,
): Promise<{ consentUrl: string; error?: string }> {
  // Upsert connector record with encrypted credentials
  const credentialRef = await encryptCredentials({
    clientId:        clientId.trim(),
    clientSecret:    clientSecret.trim(),
    ruName:          ruName.trim(),
    sellerAccountId: sellerAccountId.trim(),
  });

  const { error: upsertErr } = await supabase
    .from('marketplace_connectors')
    .upsert({
      tenant_id:      tenantId,
      marketplace_id: 'ebay',
      display_name:   'eBay',
      status:         'disconnected',
      credential_ref: credentialRef,
      seller_account_id: sellerAccountId.trim(),
      updated_at:     new Date().toISOString(),
    }, { onConflict: 'tenant_id,marketplace_id' });

  if (upsertErr) {
    console.error('Connector upsert error:', upsertErr.message);
    return { consentUrl: '', error: `Database error: ${upsertErr.message}` };
  }

  const stateNonce = generateStateNonce();
  const expiresAt  = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  const { error: sessionErr } = await supabase
    .from('oauth_sessions')
    .insert({
      state:      stateNonce,
      tenant_id:  tenantId,
      provider:   'ebay',
      expires_at: expiresAt,
      used:       false,
    });

  if (sessionErr) {
    console.error('OAuth session insert error:', sessionErr.message);
    return { consentUrl: '', error: `Could not create OAuth session: ${sessionErr.message}` };
  }

  const params = new URLSearchParams({
    client_id:     clientId.trim(),
    response_type: 'code',
    redirect_uri:  ruName.trim(),
    scope:         EBAY_SCOPES,
    state:         stateNonce,
  });

  const consentUrl = `${EBAY_AUTH_URL}?${params.toString()}`;
  console.log(`[swish-ebay-oauth] OAuth session created for tenant ${tenantId}, expires=${expiresAt}`);
  return { consentUrl };
}

// ════════════════════════════════════════════════════════════════════════════════
// ACTION: start_subscriber_authorization
// ════════════════════════════════════════════════════════════════════════════════
// This is the normal subscriber flow.
// The SWISH eBay application credentials are read from server secrets ONLY.
// The mobile client never sees clientId/clientSecret/ruName.

async function handleSubscriberAuthorization(
  body: { tenantId: string },
  authHeader: string | null,
): Promise<Response> {
  const { tenantId } = body;
  if (!tenantId) return jsonResponse({ error: 'tenantId is required' }, 400);

  const supabase = adminClient();
  const verify = await verifyUserAndTenant(authHeader, tenantId, supabase);
  if (!verify.ok) return jsonResponse({ error: verify.error }, verify.status ?? 403);

  // Load SWISH eBay application credentials from Edge Function secrets
  const clientId     = Deno.env.get('EBAY_CLIENT_ID')     ?? '';
  const clientSecret = Deno.env.get('EBAY_CLIENT_SECRET') ?? '';
  const ruName       = Deno.env.get('EBAY_RU_NAME')       ?? '';

  if (!clientId || !clientSecret || !ruName) {
    console.error('[swish-ebay-oauth] SWISH eBay app credentials not configured. Set EBAY_CLIENT_ID, EBAY_CLIENT_SECRET, EBAY_RU_NAME in Edge Function secrets.');
    return jsonResponse({
      error: 'eBay integration is not yet configured for this SWISH instance. Please contact support.',
    }, 503);
  }

  const { consentUrl, error } = await createOAuthSession(
    supabase, tenantId, clientId, clientSecret, ruName, '',
  );

  if (error) return jsonResponse({ error }, 500);
  return jsonResponse({ consentUrl, callbackUrl: CALLBACK_URL });
}

// ════════════════════════════════════════════════════════════════════════════════
// ACTION: authorize (admin/developer custom credentials flow — unchanged)
// ════════════════════════════════════════════════════════════════════════════════

async function handleAuthorize(
  body: {
    tenantId: string;
    clientId: string;
    clientSecret: string;
    ruName: string;
    sellerAccountId?: string;
  },
  authHeader: string | null,
): Promise<Response> {
  const { tenantId, clientId, clientSecret, ruName, sellerAccountId } = body;

  if (!tenantId || !clientId || !clientSecret || !ruName) {
    return jsonResponse({ error: 'tenantId, clientId, clientSecret and ruName are all required' }, 400);
  }

  const supabase = adminClient();
  const verify = await verifyUserAndTenant(authHeader, tenantId, supabase);
  if (!verify.ok) return jsonResponse({ error: verify.error }, verify.status ?? 403);

  if (clientId.trim() === clientSecret.trim()) {
    return jsonResponse({
      error: 'Cert ID (Client Secret) appears identical to App ID. These must be different values.',
    }, 400);
  }

  console.log(`[swish-ebay-oauth] authorize: clientId length=${clientId?.length ?? 0}, ruName length=${ruName?.length ?? 0}`);

  const { consentUrl, error } = await createOAuthSession(
    supabase, tenantId, clientId, clientSecret, ruName, sellerAccountId ?? '',
  );

  if (error) return jsonResponse({ error }, 500);
  return jsonResponse({ consentUrl, callbackUrl: CALLBACK_URL });
}

// ════════════════════════════════════════════════════════════════════════════════
// CALLBACK HANDLER — unchanged, works for both flows
// ════════════════════════════════════════════════════════════════════════════════

async function handleCallback(url: URL): Promise<Response> {
  const code        = url.searchParams.get('code');
  const stateNonce  = url.searchParams.get('state');
  const errParam    = url.searchParams.get('error');
  const errDesc     = url.searchParams.get('error_description');

  if (errParam) {
    console.error('eBay OAuth error param:', errParam, errDesc);
    return htmlResponse(errorPage(
      'Authorisation Declined',
      errDesc ?? errParam,
      'eBay returned an error. Return to SWISH and try again.',
    ));
  }

  if (!code) {
    return htmlResponse(errorPage(
      'Missing Code',
      'No authorisation code was received from eBay.',
      'Return to SWISH and authorise via the Connect eBay button.',
    ));
  }

  if (!stateNonce) {
    console.error('Callback arrived with no state parameter');
    return htmlResponse(errorPage(
      'Missing State',
      'The security state parameter was not returned by eBay.',
      'Return to SWISH and start a new eBay connection.',
    ));
  }

  const supabase = adminClient();

  const { data: session, error: sessionFetchErr } = await supabase
    .from('oauth_sessions')
    .select('id, tenant_id, expires_at, used')
    .eq('state', stateNonce)
    .eq('provider', 'ebay')
    .maybeSingle();

  if (sessionFetchErr) {
    console.error('OAuth session lookup error:', sessionFetchErr.message);
    return htmlResponse(errorPage('Session Lookup Failed', 'Could not retrieve the OAuth session.', sessionFetchErr.message));
  }

  if (!session) {
    console.error('No OAuth session found for state nonce');
    return htmlResponse(errorPage(
      'Session Not Found',
      'No valid OAuth session exists for this authorisation attempt.',
      'The session may have expired (15-minute limit). Return to SWISH and try again.',
    ));
  }

  if (session.used) {
    console.error('OAuth session already used for tenant:', session.tenant_id);
    return htmlResponse(errorPage(
      'Session Already Used',
      'This authorisation code has already been processed.',
      'Your eBay account may already be connected. Check the Marketplaces screen in SWISH.',
    ));
  }

  if (new Date(session.expires_at) < new Date()) {
    console.error('OAuth session expired for tenant:', session.tenant_id);
    return htmlResponse(errorPage(
      'Session Expired',
      'This authorisation session has expired (15-minute limit).',
      'Return to SWISH and connect eBay again.',
    ));
  }

  const tenantId = session.tenant_id;

  // Mark session used immediately (one-time-use protection)
  await supabase
    .from('oauth_sessions')
    .update({ used: true, used_at: new Date().toISOString() })
    .eq('id', session.id);

  // Retrieve stored credentials
  const { data: connectorRow, error: fetchErr } = await supabase
    .from('marketplace_connectors')
    .select('credential_ref')
    .eq('tenant_id', tenantId)
    .eq('marketplace_id', 'ebay')
    .maybeSingle();

  if (fetchErr || !connectorRow?.credential_ref) {
    console.error('Connector credential fetch error:', fetchErr?.message ?? 'no credential_ref');
    return htmlResponse(errorPage(
      'Credentials Not Found',
      'Could not retrieve eBay credentials for this account.',
      'Return to SWISH and try connecting again.',
    ));
  }

  let credentials: { clientId: string; clientSecret: string; ruName: string; sellerAccountId?: string };
  try {
    credentials = await decryptCredentials(connectorRow.credential_ref) as any;
  } catch (e: any) {
    console.error('credential_ref decrypt error for tenant:', tenantId, e.message);
    return htmlResponse(errorPage('Invalid Credentials', 'Stored credentials could not be decrypted.', 'Return to SWISH and try connecting again.'));
  }

  const { clientId, clientSecret, ruName, sellerAccountId } = credentials;

  if (!clientId || !clientSecret || !ruName) {
    return htmlResponse(errorPage(
      'Incomplete Credentials',
      'One or more required credentials are missing.',
      'Return to SWISH and try connecting again.',
    ));
  }

  if (clientId.trim() === clientSecret.trim()) {
    return htmlResponse(errorPage(
      'Incorrect Credentials',
      'Stored credentials appear to be invalid.',
      'Return to SWISH and try connecting again.',
    ));
  }

  // Exchange authorisation code for tokens
  const basicAuth = btoa(`${clientId.trim()}:${clientSecret.trim()}`);
  const tokenBody = new URLSearchParams({
    grant_type:   'authorization_code',
    code,
    redirect_uri: ruName.trim(),
  });

  console.log(`[swish-ebay-oauth] Token exchange for tenant ${tenantId}`);

  let tokenData: {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };

  try {
    const tokenResponse = await fetch(EBAY_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${basicAuth}`,
        'Content-Type':  'application/x-www-form-urlencoded',
      },
      body: tokenBody.toString(),
    });
    tokenData = await tokenResponse.json();
  } catch (networkErr: any) {
    console.error('Token exchange network error:', networkErr.message);
    return htmlResponse(errorPage('Network Error', 'Could not reach the eBay token endpoint.', networkErr.message));
  }

  if (tokenData.error || !tokenData.access_token) {
    console.error('eBay token exchange error:', JSON.stringify({ error: tokenData.error, desc: tokenData.error_description }));
    const hint = tokenData.error === 'invalid_client'
      ? 'eBay rejected the application credentials. Contact SWISH support if this persists.'
      : tokenData.error === 'invalid_grant'
      ? 'The authorisation code has already been used or expired. Return to SWISH and connect again.'
      : 'Return to SWISH and try connecting again.';
    return htmlResponse(errorPage(
      'Token Exchange Failed',
      tokenData.error_description ?? tokenData.error ?? 'eBay did not return an access token.',
      hint,
    ));
  }

  const expiresAt = tokenData.expires_in
    ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
    : null;

  // Store tokens encrypted
  const updatedCredentialRef = await encryptCredentials({
    clientId:     clientId.trim(),
    clientSecret: clientSecret.trim(),
    ruName:       ruName.trim(),
    accessToken:  tokenData.access_token,
    refreshToken: tokenData.refresh_token ?? null,
    expiresAt,
  });

  // Mark connector connected
  const { error: updateErr } = await supabase
    .from('marketplace_connectors')
    .update({
      status:                   'connected',
      credential_ref:           updatedCredentialRef,
      access_token_expires_at:  expiresAt,
      seller_account_id:        sellerAccountId ?? '',
      can_list:                 true,
      can_publish:              true,
      can_reprice:              true,
      can_read_orders:          true,
      can_fulfil:               true,
      can_search_opportunities: true,
      can_buy:                  false,
      can_bid:                  false,
      can_make_offer:           false,
      connected_at:             new Date().toISOString(),
      last_error:               null,
      updated_at:               new Date().toISOString(),
    })
    .eq('tenant_id', tenantId)
    .eq('marketplace_id', 'ebay');

  if (updateErr) {
    console.error('Connector update error:', updateErr.message);
    return htmlResponse(errorPage(
      'Database Error',
      `Tokens obtained but could not be saved: ${updateErr.message}`,
      'Contact SWISH support.',
    ));
  }

  console.log(`[swish-ebay-oauth] OAuth completed successfully for tenant: ${tenantId}`);
  return htmlResponse(successPage());
}

// ── HTML Pages ────────────────────────────────────────────────────────────────

function successPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>eBay Connected — SWISH</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
           background: #09090E; color: #F1F2F4; min-height: 100vh;
           display: flex; align-items: center; justify-content: center; padding: 24px; }
    .card { background: #111218; border: 1px solid #1E2028; border-radius: 20px;
            padding: 40px 32px; max-width: 440px; width: 100%; text-align: center; }
    .icon { width: 72px; height: 72px; border-radius: 36px; background: #0D2B1A;
            display: flex; align-items: center; justify-content: center;
            margin: 0 auto 24px; font-size: 36px; }
    h1 { font-size: 22px; font-weight: 700; margin-bottom: 12px; color: #22C55E; }
    p  { font-size: 15px; color: #8B8FA8; line-height: 1.6; margin-bottom: 8px; }
    .caps { background: #0D2B1A; border-radius: 12px; padding: 16px; margin: 20px 0; text-align: left; }
    .cap  { display: flex; align-items: center; gap: 8px; font-size: 13px; color: #8B8FA8; margin-bottom: 6px; }
    .cap:last-child { margin-bottom: 0; }
    .dot  { width: 8px; height: 8px; border-radius: 4px; background: #22C55E; flex-shrink: 0; }
    .close-hint { margin-top: 20px; font-size: 13px; color: #50535E; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">✅</div>
    <h1>eBay Connected!</h1>
    <p>Your eBay seller account has been authorised. You can close this window and return to SWISH.</p>
    <div class="caps">
      <div class="cap"><span class="dot"></span>Sync and manage your eBay listings</div>
      <div class="cap"><span class="dot"></span>Read and process your orders</div>
      <div class="cap"><span class="dot"></span>AI identification and valuation</div>
      <div class="cap"><span class="dot"></span>Automated repricing</div>
      <div class="cap"><span class="dot"></span>Market intelligence</div>
    </div>
    <p class="close-hint">← Return to SWISH to continue setup.</p>
  </div>
</body>
</html>`;
}

function errorPage(title: string, message: string, hint: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Connection Error — SWISH</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
           background: #09090E; color: #F1F2F4; min-height: 100vh;
           display: flex; align-items: center; justify-content: center; padding: 24px; }
    .card { background: #111218; border: 1px solid #1E2028; border-radius: 20px;
            padding: 40px 32px; max-width: 440px; width: 100%; text-align: center; }
    .icon { width: 72px; height: 72px; border-radius: 36px; background: #2A0F0F;
            display: flex; align-items: center; justify-content: center;
            margin: 0 auto 24px; font-size: 36px; }
    h1 { font-size: 20px; font-weight: 700; margin-bottom: 12px; color: #EF4444; }
    p  { font-size: 14px; color: #8B8FA8; line-height: 1.6; margin-bottom: 8px; }
    .hint { background: #2E200A; border-radius: 10px; padding: 14px; margin-top: 16px;
            font-size: 13px; color: #F59E0B; text-align: left; line-height: 1.6; }
    .back { margin-top: 20px; font-size: 13px; color: #50535E; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">❌</div>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(message)}</p>
    ${hint ? `<div class="hint">${escapeHtml(hint)}</div>` : ''}
    <p class="back">Return to SWISH and try again.</p>
  </div>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Entry point ───────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const url        = new URL(req.url);
  const isCallback = url.searchParams.get('route') === 'callback';

  try {
    if (req.method === 'GET' && isCallback) return await handleCallback(url);

    if (req.method === 'POST') {
      const body        = await req.json();
      const authHeader  = req.headers.get('Authorization');

      if (body.action === 'start_subscriber_authorization') {
        return await handleSubscriberAuthorization(body, authHeader);
      }
      if (body.action === 'authorize') {
        return await handleAuthorize(body, authHeader);
      }
      return jsonResponse({ error: 'Unknown action' }, 400);
    }

    return jsonResponse({ error: 'Method not allowed' }, 405);
  } catch (err: any) {
    console.error('[swish-ebay-oauth] unhandled error:', err.message);
    if (isCallback) {
      return htmlResponse(errorPage('Unexpected Error', err.message ?? 'An internal error occurred.', 'Return to SWISH and try again.'));
    }
    return jsonResponse({ error: err.message ?? 'Internal error' }, 500);
  }
});
