import { withEdgeFunctionLogging } from '../_shared/edgeFunctionLogging.ts';
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

import { createClient } from 'npm:@supabase/supabase-js@2';
import { encryptCredentials, decryptCredentials } from '../_shared/credentialCrypto.ts';
import { readEbayIdentity } from '../_shared/ebayAccountEngine.ts';
import { assertVerifiedLegacySeller } from '../_shared/ebayAccountPolicy.ts';

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
  // Taxonomy API uses the standard OAuth scope (oauth/api_scope); commerce.taxonomy.readonly is invalid.
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
    headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
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
  requireOwnerOrAdmin = false,
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
    .select('id, role, is_owner')
    .eq('tenant_id', tenantId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!membership) {
    console.warn(`[SWISH Security] swish-ebay-oauth: User ${user.id} attempted tenant ${tenantId} — not a member`);
    return { ok: false, error: 'Access denied: you are not a member of this organisation.', status: 403 };
  }
  if (requireOwnerOrAdmin && !(
    membership.is_owner === true ||
    membership.role === 'owner' ||
    membership.role === 'admin'
  )) {
    console.warn(`[SWISH Security] swish-ebay-oauth: User ${user.id} attempted privileged eBay credential setup for tenant ${tenantId}`);
    return { ok: false, error: 'Owner or admin role required to configure custom eBay application credentials.', status: 403 };
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
  // Stage encrypted credentials on the one-time consent session ONLY.
  // Cancelling/expiring consent leaves the current connector and tokens intact.
  const credentialRef = await encryptCredentials({
    clientId:        clientId.trim(),
    clientSecret:    clientSecret.trim(),
    ruName:          ruName.trim(),
    sellerAccountId: sellerAccountId.trim(),
  });

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
      pending_credential_ref: credentialRef,
    });

  if (sessionErr) {
    console.error('OAuth session insert error:', sessionErr.message);
    return { consentUrl: '', error: 'Unable to start eBay authorization. Please retry or contact support.' };
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

// Existing-seller identity recovery: requires verified member owner/admin, no new
// OAuth consent and no eBay listing request. Only reconciles the current token.
async function handleVerifyConnectedIdentity(
  body: {tenantId?: string}, authHeader: string | null,
): Promise<Response> {
 const tenantId=typeof body.tenantId==='string'?body.tenantId:'';
 if(!tenantId)return jsonResponse({error:'A SWISH account is required.'},400);
 const db=adminClient();
 const auth=await verifyUserAndTenant(authHeader,tenantId,db,true);
 if(!auth.ok)return jsonResponse({error:auth.error},auth.status??403);
 const {data:connector,error:readError}=await db.from('marketplace_connectors')
  .select('id,credential_ref,status,seller_account_id,access_token_expires_at')
  .eq('tenant_id',tenantId).eq('marketplace_id','ebay').maybeSingle();
 if(readError)return jsonResponse({error:'The linked eBay account could not be read.'},503);
 if(!connector||connector.status!=='connected'||!connector.credential_ref)
  return jsonResponse({error:'Connect and verify your existing eBay account before reading seller identity.'},409);
 let creds:Record<string,unknown>;
 try{creds=await decryptCredentials(connector.credential_ref);}
 catch{return jsonResponse({error:'Stored eBay authorization could not be verified securely.'},409);}
 // The native app and web use the same legacy encrypted connector for
 // existing seller consent. Refresh that consent server-side rather than
 // forcing a second eBay login just to recover an unrecorded seller name.
 let accessToken=typeof creds.accessToken==='string'?creds.accessToken:'';
 let expiresAt=String(creds.expiresAt??connector.access_token_expires_at??'');
 let refreshed=false;
 if(!accessToken||!Number.isFinite(Date.parse(expiresAt))||Date.parse(expiresAt)<=Date.now()+300000){
  const refreshToken=typeof creds.refreshToken==='string'?creds.refreshToken:'';
  const clientId=typeof creds.clientId==='string'?creds.clientId:'';
  const clientSecret=typeof creds.clientSecret==='string'?creds.clientSecret:'';
  if(!refreshToken||!clientId||!clientSecret)
   return jsonResponse({error:'This eBay connection has no valid refresh consent. Re-authorise the SAME seller account to verify identity; existing records are retained.'},409);
  let tokenResult:Response;
  try{
   tokenResult=await fetch(EBAY_TOKEN_URL,{
    method:'POST',
    headers:{Authorization:`Basic ${btoa(`${clientId}:${clientSecret}`)}`,'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({grant_type:'refresh_token',refresh_token:refreshToken}).toString(),
    signal:AbortSignal.timeout(12000),
   });
  }catch{return jsonResponse({error:'eBay token refresh could not be reached. Existing authorisation was preserved; try verification again later.'},503);}
  const tokenPayload=await tokenResult.json().catch(()=>({}));
  if(!tokenResult.ok||typeof tokenPayload.access_token!=='string'||!tokenPayload.access_token){
   return jsonResponse({error:tokenPayload.error==='invalid_grant'
    ? 'Existing eBay consent has expired or been revoked. Re-authorise the SAME seller account.'
    : 'eBay did not confirm a token refresh. Existing authorisation was preserved.'},tokenPayload.error==='invalid_grant'?401:503);
  }
  accessToken=tokenPayload.access_token;
  expiresAt=new Date(Date.now()+Math.max(1,Number(tokenPayload.expires_in)||7200)*1000).toISOString();
  refreshed=true;
 }
 let identity:{userId:string;username:string};
 try{
  identity=await readEbayIdentity(accessToken);
  assertVerifiedLegacySeller(identity,connector.seller_account_id,creds.ebayUserId);
 }catch{return jsonResponse({error:'eBay could not verify this seller identity, identity access is missing, or the connected account is different. No account was changed.'},409);}
 if(!refreshed&&connector.seller_account_id===identity.username&&creds.ebayUserId===identity.userId)
  return jsonResponse({success:true,sellerAccountId:identity.username,verified:true,persisted:true});
 const encrypted=await encryptCredentials({...creds,accessToken,expiresAt,ebayUserId:identity.userId,sellerAccountId:identity.username});
 let update=db.from('marketplace_connectors')
  .update({seller_account_id:identity.username,credential_ref:encrypted,...(refreshed?{access_token_expires_at:expiresAt}:{}),updated_at:new Date().toISOString()})
  .eq('id',connector.id).eq('tenant_id',tenantId).eq('marketplace_id','ebay')
  .eq('status','connected').eq('credential_ref',connector.credential_ref);
 update=connector.seller_account_id==null?update.is('seller_account_id',null):update.eq('seller_account_id',connector.seller_account_id);
 const {data:confirmed,error:writeError}=await update.select('id').maybeSingle();
 if(writeError||!confirmed)return jsonResponse({error:'The eBay connector changed while checking identity. Reload account health; no replacement connection was created.'},409);
 return jsonResponse({success:true,sellerAccountId:identity.username,verified:true,persisted:true});
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
  const verify = await verifyUserAndTenant(authHeader, tenantId, supabase, true);
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
    .select('id, tenant_id, expires_at, used, pending_credential_ref')
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

  // Atomic single-use claim: simultaneous callbacks cannot exchange twice.
  const { data: claimed, error: claimError } = await supabase
    .from('oauth_sessions')
    .update({ used: true, used_at: new Date().toISOString() })
    .eq('id', session.id).eq('used', false).gt('expires_at', new Date().toISOString())
    .select('id').maybeSingle();
  if (claimError || !claimed) return htmlResponse(errorPage('Session Unavailable', 'This consent attempt was already claimed or expired.', 'Check your existing connection; no active credentials were replaced.'), 409);

  // Retrieve stored credentials
  const { data: connectorRow, error: fetchErr } = await supabase
    .from('marketplace_connectors')
    .select('credential_ref,seller_account_id')
    .eq('tenant_id', tenantId)
    .eq('marketplace_id', 'ebay')
    .maybeSingle();

  const stagedCredentialRef = session.pending_credential_ref ?? connectorRow?.credential_ref;
  if (fetchErr || !stagedCredentialRef) {
    console.error('Connector credential fetch error:', fetchErr?.message ?? 'no credential_ref');
    return htmlResponse(errorPage(
      'Credentials Not Found',
      'Could not retrieve eBay credentials for this account.',
      'Return to SWISH and try connecting again.',
    ));
  }

  let credentials: { clientId: string; clientSecret: string; ruName: string; sellerAccountId?: string };
  try {
    credentials = await decryptCredentials(stagedCredentialRef) as any;
  } catch (e: any) {
    console.error('[swish-ebay-oauth] staged credentials unavailable');
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
      signal: AbortSignal.timeout(15000),
    });
    tokenData = await tokenResponse.json();
    if (!tokenResponse.ok) tokenData.access_token = undefined;
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

  // Verify the actual authorised eBay identity, not a browser/staged label.
  // A different account cannot silently take over an existing tenant connector.
  let verifiedIdentity: {userId:string;username:string};
  try {
    verifiedIdentity = await readEbayIdentity(tokenData.access_token);
    assertVerifiedLegacySeller(verifiedIdentity,sellerAccountId,null);
    if(connectorRow?.credential_ref){
      const previous = await decryptCredentials(connectorRow.credential_ref);
      assertVerifiedLegacySeller(verifiedIdentity,connectorRow.seller_account_id,previous.ebayUserId);
    }
  } catch {
    return htmlResponse(errorPage('eBay Identity Not Confirmed','The seller account could not be verified or does not match the existing linked account.','Return to SWISH and check the linked eBay account before trying again.'),409);
  }

  // Store tokens encrypted
  const updatedCredentialRef = await encryptCredentials({
    clientId:     clientId.trim(),
    clientSecret: clientSecret.trim(),
    ruName:       ruName.trim(),
    accessToken:  tokenData.access_token,
    refreshToken: tokenData.refresh_token ?? null,
    expiresAt,
    sellerAccountId: verifiedIdentity.username,
    ebayUserId: verifiedIdentity.userId,
    hasAnalyticsScope: true,
  });

  // Successful consent is the only operation that may replace active credentials.
  const { error: updateErr } = await supabase
    .from('marketplace_connectors')
    .upsert({
      tenant_id:                tenantId,
      marketplace_id:           'ebay',
      display_name:             'eBay',
      status:                   'connected',
      credential_ref:           updatedCredentialRef,
      access_token_expires_at:  expiresAt,
      seller_account_id:        verifiedIdentity.username,
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
    }, { onConflict: 'tenant_id,marketplace_id' });

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

Deno.serve(withEdgeFunctionLogging('swish-ebay-oauth', async (req: Request) => {
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
      if (body.action === 'verify_connected_identity') {
        return await handleVerifyConnectedIdentity(body, authHeader);
      }
      if (body.action === 'authorize') {
        return await handleAuthorize(body, authHeader);
      }
      return jsonResponse({ error: 'Unknown action' }, 400);
    }

    return jsonResponse({ error: 'Method not allowed' }, 405);
  } catch (err: any) {
    console.error('[swish-ebay-oauth] request failed');
    if (isCallback) {
      return htmlResponse(errorPage('Unexpected Error', 'The connection could not be completed.', 'Your existing authorisation is preserved. Return to SWISH and retry.'), 500);
    }
    return jsonResponse({ error: 'The connection could not be completed. Existing authorisations are preserved.' }, 500);
  }
}));
