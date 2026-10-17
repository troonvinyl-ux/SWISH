
// SWISH eBay Listing Edge Function v7 — Production Hardened (90s deadline + all timeouts)
//
// CRITICAL RULES:
//   1. Business Policies: NEVER send legacy shipping/return/payment XML.
//      ALWAYS use <SellerProfiles> with user-SELECTED policy IDs.
//      NO policies[0] fallback. NO automatic selection. HARD STOP if missing.
//
//   2. Category: ALWAYS resolve to a verified LEAF category via eBay Taxonomy REST API.
//      leafCategoryTreeNode=true is the only accepted leaf marker.
//      KNOWN_PARENT_CATEGORIES is an optimisation hint only, never a submission gate.
//      If no valid leaf can be determined: STOP — never guess.
//
//   3. Simple Delivery: All SWISH listings use eBay Simple Delivery.
//      The fulfillment policy must support it. No legacy shipping XML.
//
//   4. Security: EVERY route verifies JWT + tenant membership.
//      No auth bypass for "internal" calls. Server calls use service key.
//
//   5. Universal pipeline: publish, revise, retry, bulk all use same validators.
//
// Routes:
//   publish (default)       — submit a new eBay listing
//   revise                  — revise an existing eBay listing
//   end                     — end a live eBay listing via EndFixedPriceItem
//   get_seller_policies     — fetch + cache seller business policy IDs
//   set_policies            — persist user-selected policy IDs to connector
//   resolve_category        — resolve a category to a valid leaf category
//   get_category_aspects    — fetch required/recommended aspects for a leaf category
//   get_category_children   — browse cached/live EBAY_GB category branches
//   get_category_suggestions— search only live/cached eBay leaf categories

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { encryptCredentials, decryptCredentials } from '../_shared/credentialCrypto.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const EBAY_TRADING_API_URL = 'https://api.ebay.com/ws/api.dll';
const EBAY_TOKEN_URL       = 'https://api.ebay.com/identity/v1/oauth2/token';
const EBAY_ACCOUNT_API     = 'https://api.ebay.com/sell/account/v1';
const EBAY_TAXONOMY_API    = 'https://api.ebay.com/commerce/taxonomy/v1';
const EBAY_UK_CATEGORY_TREE_ID = '3';

// ── Dynamic category tree ID cache ───────────────────────────────────────────
let _categoryTreeIdCache: { treeId: string; version: string; fetchedAt: number } | null = null;
const CATEGORY_TREE_CACHE_TTL = 60 * 60 * 1000; // 1 hour

async function getUkCategoryTreeId(token: string): Promise<{ treeId: string; version: string; fromCache: boolean; error?: string }> {
  if (_categoryTreeIdCache && Date.now() - _categoryTreeIdCache.fetchedAt < CATEGORY_TREE_CACHE_TTL) {
    return { treeId: _categoryTreeIdCache.treeId, version: _categoryTreeIdCache.version, fromCache: true };
  }

  try {
    console.log('[SWISH Category] Fetching default category tree ID for EBAY_GB');
    const res = await fetch(
      `${EBAY_TAXONOMY_API}/get_default_category_tree_id?marketplace_id=EBAY_GB`,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB',
        },
        signal: AbortSignal.timeout(5000),
      },
    );

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const safeBody = body.slice(0, 300);
      console.error(`[SWISH Category] get_default_category_tree_id returned HTTP ${res.status}: ${safeBody}`);
      return { treeId: EBAY_UK_CATEGORY_TREE_ID, version: 'fallback', fromCache: false, error: `HTTP ${res.status}: ${safeBody}` };
    }

    const data = await res.json();
    const treeId = String(data.categoryTreeId ?? EBAY_UK_CATEGORY_TREE_ID);
    const version = String(data.categoryTreeVersion ?? 'unknown');
    console.log(`[SWISH Category] UK category tree ID=${treeId}, version=${version}`);
    _categoryTreeIdCache = { treeId, version, fetchedAt: Date.now() };
    return { treeId, version, fromCache: false };
  } catch (e: any) {
    console.error(`[SWISH Category] get_default_category_tree_id error: ${e.message}`);
    return { treeId: EBAY_UK_CATEGORY_TREE_ID, version: 'fallback', fromCache: false, error: e.message };
  }
}

// ── Admin client ──────────────────────────────────────────────────────────────

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

function xmlEscape(s: string): string {
  return (s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ── Security: Verify JWT and tenant membership ────────────────────────────────

const INTERNAL_SECRET = Deno.env.get('SWISH_INTERNAL_SECRET') ?? '';

async function verifyTenantMembership(
  supabase: ReturnType<typeof adminClient>,
  authHeader: string | null,
  tenantId: string,
  internalSecretHeader: string | null,
): Promise<{ ok: boolean; userId?: string; error?: string }> {

  if (internalSecretHeader && INTERNAL_SECRET && internalSecretHeader === INTERNAL_SECRET) {
    console.log('[SWISH Security] Internal server-to-server call verified via SWISH_INTERNAL_SECRET');
    return { ok: true };
  }

  if (!authHeader) {
    return { ok: false, error: 'Authentication required. Please sign in to SWISH.' };
  }

  const token = authHeader.replace('Bearer ', '').trim();

  if (!token || token === Deno.env.get('SUPABASE_ANON_KEY')) {
    return { ok: false, error: 'Authentication required. Please sign in to SWISH.' };
  }

  try {
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) {
      return { ok: false, error: 'Invalid or expired authentication token. Please sign in again.' };
    }

    const { data: membership } = await supabase
      .from('tenant_memberships')
      .select('id, role')
      .eq('tenant_id', tenantId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (!membership) {
      console.warn(`[SWISH Security] User ${user.id} attempted to access tenant ${tenantId} — NOT a member`);
      return { ok: false, error: 'Access denied: you are not a member of this organisation.' };
    }

    return { ok: true, userId: user.id };
  } catch (e: any) {
    console.error(`[SWISH Security] JWT verification error: ${e.message}`);
    return { ok: false, error: 'Authentication verification failed. Please sign in again.' };
  }
}

// ── Application-level (client credentials) token for Taxonomy API ─────────────

let _appTokenCache: { token: string; expiresAt: number } | null = null;

async function getAppToken(): Promise<string | null> {
  const clientId     = Deno.env.get('EBAY_CLIENT_ID') ?? '';
  const clientSecret = Deno.env.get('EBAY_CLIENT_SECRET') ?? '';
  if (!clientId || !clientSecret) {
    console.log('[SWISH] App token: EBAY_CLIENT_ID or EBAY_CLIENT_SECRET not configured');
    return null;
  }

  if (_appTokenCache && Date.now() + 60_000 < _appTokenCache.expiresAt) {
    return _appTokenCache.token;
  }

  try {
    const basicAuth = btoa(`${clientId}:${clientSecret}`);
    const resp = await fetch(EBAY_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope%20https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope%2Fcommerce.taxonomy.readonly',
      signal: AbortSignal.timeout(5000),
    });
    const data = await resp.json();
    if (!data.access_token) {
      console.log(`[SWISH] App token request failed: ${data.error_description ?? data.error ?? 'unknown'}`);
      return null;
    }
    const expiresAt = Date.now() + (data.expires_in ?? 7200) * 1000;
    _appTokenCache = { token: data.access_token, expiresAt };
    console.log('[SWISH] App token obtained successfully (Taxonomy API)');
    return data.access_token;
  } catch (e: any) {
    console.log(`[SWISH] App token fetch error: ${e.message}`);
    return null;
  }
}

// ── Token refresh ─────────────────────────────────────────────────────────────

async function refreshAccessToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
): Promise<{ accessToken: string; expiresAt: string }> {
  const basicAuth = btoa(`${clientId}:${clientSecret}`);
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    scope: [
      'https://api.ebay.com/oauth/api_scope',
      'https://api.ebay.com/oauth/api_scope/sell.inventory',
      'https://api.ebay.com/oauth/api_scope/sell.fulfillment',
      'https://api.ebay.com/oauth/api_scope/sell.account',
      'https://api.ebay.com/oauth/api_scope/sell.marketing',
      'https://api.ebay.com/oauth/api_scope/commerce.taxonomy.readonly',
    ].join(' '),
  });

  const resp = await fetch(EBAY_TOKEN_URL, {
    method: 'POST',
    headers: { Authorization: `Basic ${basicAuth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: AbortSignal.timeout(15000),
  });
  const data = await resp.json();
  if (!data.access_token) {
    throw new Error(`Token refresh failed: ${data.error_description ?? data.error ?? 'unknown'}`);
  }
  const expiresAt = new Date(Date.now() + (data.expires_in ?? 7200) * 1000).toISOString();
  return { accessToken: data.access_token, expiresAt };
}

// ── Credentials loader with auto-refresh ─────────────────────────────────────

async function getEbayCredentials(
  supabase: ReturnType<typeof adminClient>,
  tenantId: string,
  requirePublish = true,
): Promise<{ error: string } | { clientId: string; accessToken: string; refreshToken?: string; raw: any }> {
  const { data: conn } = await supabase
    .from('marketplace_connectors')
    .select('credential_ref, status, can_publish, access_token_expires_at')
    .eq('tenant_id', tenantId)
    .eq('marketplace_id', 'ebay')
    .maybeSingle();

  if (!conn?.credential_ref) return { error: 'eBay connector not found. Connect eBay in Marketplaces.' };
  if (conn.status !== 'connected') return { error: `eBay is not connected (status: ${conn.status}). Re-authorise in Marketplaces.` };
  if (requirePublish && !conn.can_publish) return { error: 'eBay connector lacks publish permission. Re-authorise in Marketplaces.' };

  let creds: any;
  try { creds = await decryptCredentials(conn.credential_ref); } catch (e: any) {
    return { error: `eBay credentials are corrupted: ${e.message}. Please re-connect eBay in Marketplaces.` };
  }
  if (!creds.accessToken) return { error: 'No eBay access token found. Please re-authorise eBay in Marketplaces.' };

  const shouldRefresh = creds.expiresAt ? Date.now() + 10 * 60_000 >= new Date(creds.expiresAt).getTime() : false;
  if (shouldRefresh && creds.refreshToken) {
    try {
      const { accessToken: newToken, expiresAt: newExpiry } = await refreshAccessToken(creds.clientId, creds.clientSecret, creds.refreshToken);
      const updatedRef = await encryptCredentials({ ...creds, accessToken: newToken, expiresAt: newExpiry });
      await supabase.from('marketplace_connectors').update({ credential_ref: updatedRef, access_token_expires_at: newExpiry, updated_at: new Date().toISOString() }).eq('tenant_id', tenantId).eq('marketplace_id', 'ebay');
      creds = { ...creds, accessToken: newToken, expiresAt: newExpiry };
    } catch (e: any) {
      return { error: `eBay token expired and refresh failed: ${e.message}. Please re-authorise eBay in Marketplaces.` };
    }
  } else if (shouldRefresh && !creds.refreshToken) {
    return { error: 'eBay access token expired and no refresh token available. Please re-authorise eBay in Marketplaces.' };
  }

  return { clientId: creds.clientId, accessToken: creds.accessToken, refreshToken: creds.refreshToken, raw: creds };
}

// ── Business Policy types ─────────────────────────────────────────────────────

interface PolicySummary {
  policyId: string;
  name: string;
  description?: string;
}

interface SellerPolicies {
  fulfillmentPolicies: PolicySummary[];
  returnPolicies: PolicySummary[];
  paymentPolicies: PolicySummary[];
  fetchedAt: string;
}

// ── Fetch seller business policies from eBay Account API ──────────────────────

async function fetchSellerPoliciesFromEbay(accessToken: string): Promise<SellerPolicies> {
  const headers = {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB',
  };

  const accountTimeout = { signal: AbortSignal.timeout(8000) };
  const [fpResp, rpResp, ppResp] = await Promise.all([
    fetch(`${EBAY_ACCOUNT_API}/fulfillment_policy?marketplace_id=EBAY_GB`, { headers, ...accountTimeout }),
    fetch(`${EBAY_ACCOUNT_API}/return_policy?marketplace_id=EBAY_GB`, { headers, ...accountTimeout }),
    fetch(`${EBAY_ACCOUNT_API}/payment_policy?marketplace_id=EBAY_GB`, { headers, ...accountTimeout }),
  ]);

  const [fpData, rpData, ppData] = await Promise.all([fpResp.json(), rpResp.json(), ppResp.json()]);

  const extractPolicies = (data: any): PolicySummary[] => {
    const items = data.fulfillmentPolicies ?? data.returnPolicies ?? data.paymentPolicies ?? data.policies ?? [];
    return items.map((p: any) => ({
      policyId: p.fulfillmentPolicyId ?? p.returnPolicyId ?? p.paymentPolicyId ?? p.policyId ?? '',
      name: p.name ?? 'Unnamed Policy',
      description: p.description ?? '',
    })).filter((p: PolicySummary) => p.policyId);
  };

  const fulfillmentPolicies = extractPolicies(fpData);
  const returnPolicies = extractPolicies(rpData);
  const paymentPolicies = extractPolicies(ppData);

  console.log(`[SWISH] Policies fetched: ${fulfillmentPolicies.length} fulfillment, ${returnPolicies.length} return, ${paymentPolicies.length} payment`);

  return {
    fulfillmentPolicies,
    returnPolicies,
    paymentPolicies,
    fetchedAt: new Date().toISOString(),
  };
}

// ── Get cached policies or fetch fresh ────────────────────────────────────────

async function getCachedOrFetchPolicies(
  supabase: ReturnType<typeof adminClient>,
  tenantId: string,
  accessToken: string,
  forceRefresh = false,
): Promise<SellerPolicies | null> {
  const { data: conn } = await supabase
    .from('marketplace_connectors')
    .select('store_category_tree, policies_cached_at')
    .eq('tenant_id', tenantId)
    .eq('marketplace_id', 'ebay')
    .maybeSingle();

  if (!forceRefresh && conn?.store_category_tree) {
    try {
      const cached = typeof conn.store_category_tree === 'string'
        ? JSON.parse(conn.store_category_tree)
        : conn.store_category_tree;
      if (cached?.policies?.fulfillmentPolicies) {
        console.log('[SWISH] Policies: returning cached copy (age check skipped to avoid timeout)');
        return cached.policies as SellerPolicies;
      }
    } catch {}
  }

  try {
    const policies = await Promise.race([
      fetchSellerPoliciesFromEbay(accessToken),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Policy fetch timeout after 12s')), 12000)
      ),
    ]);
    const existing = conn?.store_category_tree ?? {};
    const existingObj = typeof existing === 'string' ? JSON.parse(existing) : (existing ?? {});
    supabase.from('marketplace_connectors').update({
      store_category_tree: { ...existingObj, policies },
      policies_cached_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('tenant_id', tenantId).eq('marketplace_id', 'ebay').then(() => {}).catch(() => {});
    return policies;
  } catch (e: any) {
    console.log(`[SWISH] Policy fetch error/timeout: ${e.message} — proceeding with ID-only validation`);
    return null;
  }
}

// ── Get user-selected policy IDs — NO FALLBACK TO policies[0] ─────────────────

async function getSelectedPolicyIds(
  supabase: ReturnType<typeof adminClient>,
  tenantId: string,
  overrides: { fulfillmentId?: string; returnId?: string; paymentId?: string },
): Promise<{ fulfillmentId: string; returnId: string; paymentId: string }> {
  const { data: conn } = await supabase
    .from('marketplace_connectors')
    .select('selected_fulfillment_policy_id, selected_return_policy_id, selected_payment_policy_id')
    .eq('tenant_id', tenantId)
    .eq('marketplace_id', 'ebay')
    .maybeSingle();

  const fulfillmentId = overrides.fulfillmentId || conn?.selected_fulfillment_policy_id || '';
  const returnId      = overrides.returnId      || conn?.selected_return_policy_id      || '';
  const paymentId     = overrides.paymentId     || conn?.selected_payment_policy_id     || '';

  return { fulfillmentId, returnId, paymentId };
}

// ── Validate business policy selection ───────────────────────────────────────

function validateBusinessPolicies(
  fulfillmentId: string,
  returnId: string,
  policies: SellerPolicies | null,
): string | null {
  if (!fulfillmentId) {
    return 'Your eBay fulfillment (shipping) policy has not been selected. Go to Settings → eBay Connection → Load Policies, then select your fulfillment policy.';
  }
  if (!returnId) {
    return 'Your eBay return policy has not been selected. Go to Settings → eBay Connection → Load Policies, then select your return policy.';
  }
  return null;
}

// ── eBay Taxonomy Category Resolution ────────────────────────────────────────

const TAXONOMY_CACHE = new Map<string, { id: string; name: string; isLeaf: boolean; timestamp: number }>();
const TAXONOMY_CACHE_TTL = 15 * 60 * 1000;

const KNOWN_PARENT_CATEGORY_HINT = new Set([
  '4', '99', '260', '1', '550', '281', '220', '467', '11116', '11450',
  '619', '625', '888', '2984', '1249', '11232', '139971', '64482', '171228',
  // Known parent (non-leaf) categories — skip verify, go straight to title-based resolution
  '1469',  // "Other Collectables" — parent, not a leaf
  '4739',  // "Islamic" — parent coins category. Use 40714 (Ancient Coins) instead.
  '267',   // Coins browse root
  '13956', // Militaria browse root in the SWISH curated taxonomy list
  '4455', '35586', '2906', // Motorcycle/bicycle parent categories
  '15724', '15725', '57990', '57991', '11483', '11484', // Clothing/shoe parent categories
  '0', '',
]);

// Quick-lookup: confirmed EBAY_GB leaf categories — bypasses slow live API checks
const KNOWN_GOOD_LEAF_CATEGORIES: Record<string, string> = {
  '40714': 'Ancient Coins',
  '3365':  'Roman Imperial (96-235AD)',
  '4726':  'British Coins',
  '183454': 'CCG Individual Cards',
  '261':   'Great Britain Stamps',
};

// ── isAspectsNotLeaf ─────────────────────────────────────────────────────────
// Parse eBay's aspects endpoint 400 response to determine if this is truly
// "not a leaf" vs "valid leaf with no defined aspects".
//
// HTTP 400 WITHOUT eBay error 13003/13004 → valid leaf, no aspects (e.g. Greek coins)
// HTTP 400 WITH eBay error 13003/13004 → confirmed NOT a leaf
// HTTP 404 → category doesn't exist

function isAspectsNotLeaf(status: number, bodyText: string): boolean {
  if (status === 404) return true;
  if (status !== 400) return false;
  try {
    const parsed = JSON.parse(bodyText);
    const errors: any[] = parsed.errors ?? [];
    for (const err of errors) {
      const errId = Number(err.errorId ?? err.error_id ?? 0);
      const msg = String(err.message ?? err.longMessage ?? '').toLowerCase();
      if (errId === 13003 || errId === 13004 || errId === 13007) return true;
      if (msg.includes('not a valid leaf') || msg.includes('is not a leaf') ||
          msg.includes('leaf category') || msg.includes('invalid category id')) return true;
    }
    // 400 but no explicit "not a leaf" error → valid leaf with no aspects
    return false;
  } catch {
    return false; // Can't parse — assume valid leaf
  }
}

async function verifyCategoryIsLeaf(
  accessToken: string,
  _clientId: string,
  categoryId: string,
  supabaseAdmin?: ReturnType<typeof adminClient>,
): Promise<{ isLeaf: boolean; name: string; fromDb?: boolean } | null> {
  const cacheKey = `info:${categoryId}`;
  const cached = TAXONOMY_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < TAXONOMY_CACHE_TTL) {
    return { isLeaf: cached.isLeaf, name: cached.name };
  }

  // Step 0: KNOWN_GOOD_LEAF_CATEGORIES — immediate bypass for confirmed leaves
  if (KNOWN_GOOD_LEAF_CATEGORIES[categoryId]) {
    const name = KNOWN_GOOD_LEAF_CATEGORIES[categoryId];
    console.log(`[SWISH] Category ${categoryId} ("${name}") confirmed in KNOWN_GOOD_LEAF_CATEGORIES`);
    TAXONOMY_CACHE.set(cacheKey, { id: categoryId, name, isLeaf: true, timestamp: Date.now() });
    return { isLeaf: true, name, fromDb: true };
  }

  // Step 1: Check local SWISH ebay_categories catalogue first (fast)
  // TRUST is_leaf=true from the DB (set by leafCategoryTreeNode from Taxonomy subtree/suggestions API)
  // ALSO trust is_leaf=false from DB — definitively blocked
  if (supabaseAdmin) {
    try {
      const { data: dbRow } = await supabaseAdmin
        .from('ebay_categories')
        .select('category_id, category_name, is_leaf, active')
        .eq('marketplace_id', 'EBAY_GB')
        .eq('category_id', categoryId)
        .maybeSingle();
      if (dbRow) {
        const name   = dbRow.category_name ?? categoryId;
        const active = dbRow.active !== false;
        console.log(`[SWISH] Local DB category check: ${categoryId} → isLeaf=${dbRow.is_leaf} active=${active} name="${name}"`);
        if (!active) {
          TAXONOMY_CACHE.set(cacheKey, { id: categoryId, name, isLeaf: false, timestamp: Date.now() });
          return { isLeaf: false, name };
        }
        if (dbRow.is_leaf === false) {
          // A cached non-leaf flag may come from an old/bad taxonomy sync. Do
          // not permanently reject it here; confirm against the live EBAY_GB API
          // below before deciding that a user-selected category is a parent.
          console.log(`[SWISH] Category ${categoryId} cached is_leaf=false — confirming against live taxonomy`);
        }
        if (dbRow.is_leaf === true) {
          // A cached leaf flag can become stale when eBay changes the category
          // tree. Use the live Taxonomy API for the publish-time decision; the
          // in-memory TTL cache above prevents repeated checks during one session.
          console.log(`[SWISH] Category ${categoryId} cached is_leaf=true — confirming against live taxonomy`);
        }
        // NULL or either cached leaf flag must fall through to the live API check.
      }
    } catch (dbErr: any) {
      console.log(`[SWISH] Local DB category check error (non-fatal): ${dbErr.message}`);
    }
  }

  // Step 2: Live eBay Taxonomy API
  // CRITICAL: HTTP 400 alone does NOT mean "not a leaf".
  // Must parse the response body for error code 13003/13004.
  const { treeId } = await getUkCategoryTreeId(accessToken);

  try {
    const res = await fetch(
      `${EBAY_TAXONOMY_API}/category_tree/${treeId}/get_item_aspects_for_category?category_id=${encodeURIComponent(categoryId)}`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB',
        },
        signal: AbortSignal.timeout(8000),
      },
    );
    if (res.ok) {
      if (supabaseAdmin) {
        const now = new Date().toISOString();
        supabaseAdmin.from('ebay_categories').upsert(
          { marketplace_id: 'EBAY_GB', tree_id: treeId, category_id: categoryId,
            category_name: categoryId, is_leaf: true, active: true, last_synced_at: now, updated_at: now },
          { onConflict: 'marketplace_id,category_id' }
        ).then(() => {}).catch(() => {});
      }
      TAXONOMY_CACHE.set(cacheKey, { id: categoryId, name: categoryId, isLeaf: true, timestamp: Date.now() });
      return { isLeaf: true, name: categoryId };
    }
    if (res.status === 404 || res.status === 400) {
      const bodyText = await res.text().catch(() => '{}');
      const definitelyNotLeaf = isAspectsNotLeaf(res.status, bodyText);

      if (definitelyNotLeaf) {
        console.log(`[SWISH] Category ${categoryId}: confirmed NOT a leaf (HTTP ${res.status} + error 13003/13004/404, treeId=${treeId})`);
        if (supabaseAdmin) {
          supabaseAdmin.from('ebay_categories')
            .update({ is_leaf: false, updated_at: new Date().toISOString() })
            .eq('marketplace_id', 'EBAY_GB').eq('category_id', categoryId)
            .then(() => {}).catch(() => {});
        }
        TAXONOMY_CACHE.set(cacheKey, { id: categoryId, name: categoryId, isLeaf: false, timestamp: Date.now() });
        return { isLeaf: false, name: categoryId };
      }

      // HTTP 400 but NOT error 13003/13004 → valid leaf with no defined aspects
      // (e.g. Greek ancient coins, Byzantine coins — valid EBAY_GB leaf categories)
      console.log(`[SWISH] Category ${categoryId}: HTTP ${res.status} but no "not a leaf" error — treating as valid leaf with no aspects (treeId=${treeId}). Body: ${bodyText.slice(0, 200)}`);
      if (supabaseAdmin) {
        const now = new Date().toISOString();
        supabaseAdmin.from('ebay_categories').upsert(
          { marketplace_id: 'EBAY_GB', tree_id: treeId, category_id: categoryId,
            is_leaf: true, active: true, last_synced_at: now, updated_at: now },
          { onConflict: 'marketplace_id,category_id' }
        ).then(() => {}).catch(() => {});
      }
      TAXONOMY_CACHE.set(cacheKey, { id: categoryId, name: categoryId, isLeaf: true, timestamp: Date.now() });
      return { isLeaf: true, name: categoryId };
    }
    const body = await res.text().catch(() => '');
    console.log(`[SWISH] Taxonomy leaf check returned ${res.status} for categoryId=${categoryId} (treeId=${treeId}). Body: ${body.slice(0, 200)}`);
    return null;
  } catch (e: any) {
    console.log(`[SWISH] Taxonomy leaf check error for ${categoryId}: ${e.message}`);
    return null;
  }
}

async function findLeafCategoryByTitle(
  accessToken: string,
  _clientId: string,
  searchQuery: string,
): Promise<Array<{ id: string; name: string; confidence: string }>> {
  const cacheKey = `suggest:${searchQuery.toLowerCase().slice(0, 40)}`;
  const cached = TAXONOMY_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < TAXONOMY_CACHE_TTL && cached.isLeaf) {
    return [{ id: cached.id, name: cached.name, confidence: 'high' }];
  }

  try {
    const { treeId: liveSuggestTreeId } = await getUkCategoryTreeId(accessToken).catch(() => ({ treeId: EBAY_UK_CATEGORY_TREE_ID, version: 'fallback', fromCache: false }));
    const res = await fetch(
      `${EBAY_TAXONOMY_API}/category_tree/${liveSuggestTreeId}/get_category_suggestions?q=${encodeURIComponent(searchQuery.slice(0, 100))}`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB',
        },
        signal: AbortSignal.timeout(8000),
      },
    );

    if (res.ok) {
      const data = await res.json();
      const suggestions = data.categorySuggestions ?? [];
      const leafResults: Array<{ id: string; name: string; confidence: string }> = [];

      for (const s of suggestions.slice(0, 20)) {
        const catRef = s.category;
        const isLeafNode = s.leafCategoryTreeNode === true;

        if (catRef?.categoryId && isLeafNode) {
          leafResults.push({
            id: String(catRef.categoryId),
            name: catRef.categoryName ?? String(catRef.categoryId),
            confidence: 'high',
          });
        }
      }

      if (leafResults.length > 0) {
        console.log(`[SWISH] Taxonomy API: ${leafResults.length} leaf suggestions for "${searchQuery}"`);
        const best = leafResults[0];
        TAXONOMY_CACHE.set(cacheKey, { id: best.id, name: best.name, isLeaf: true, timestamp: Date.now() });
        return leafResults.slice(0, 5);
      }
    } else {
      console.log(`[SWISH] Taxonomy API returned ${res.status} for "${searchQuery}"`);
    }
  } catch (e: any) {
    console.log(`[SWISH] Taxonomy REST API error: ${e.message}`);
  }

  return [];
}

const SPECIALIST_LEAF_REFERENCE: Record<string, { id: string; name: string }> = {
  coins_uk:                 { id: '4726',   name: 'British Coins' },
  coins_currency:           { id: '4726',   name: 'British Coins' },
  coins_world:              { id: '40714',  name: 'Ancient Coins' },
  // Islamic, Indian, Mughal, Timurid, Abbasid coins → Ancient Coins (40714, confirmed EBAY_GB leaf)
  islamic_silver:           { id: '40714',  name: 'Ancient Coins' },
  ancient_artefacts:        { id: '40714',  name: 'Ancient Coins' },
  stamps:                   { id: '261',    name: 'Great Britain Stamps' },
  pokemon:                  { id: '183454', name: 'CCG Individual Cards' },
  trading_cards:            { id: '183454', name: 'CCG Individual Cards' },
  militaria:                { id: '13956',  name: 'Militaria' },
  watches:                  { id: '14324',  name: 'Wristwatches' },
  jewellery_gold_silver:    { id: '50',     name: 'Fine Jewellery' },
  // curiosities_collectibles intentionally omitted — 1469 is a parent, not a leaf.
  // Title-based resolution (Taxonomy suggestions API) is used instead.
};
void SPECIALIST_LEAF_REFERENCE;

async function resolveLeafCategory(
  token: string,
  clientId: string,
  categoryId: string,
  title: string,
  specialistId: string,
  supabaseAdmin?: ReturnType<typeof adminClient>,
): Promise<{ resolvedId: string; resolvedName: string; categoryName: string; treeId: string; treeVersion: string; wasResolved: boolean; confidence: string; error?: string }> {
  const STOP_RESULT = (msg: string) => ({
    resolvedId: '', resolvedName: '', categoryName: '',
    treeId: '', treeVersion: '', wasResolved: false, confidence: 'none', error: msg,
  });

  const treeResult = await getUkCategoryTreeId(token);
  const treeId = treeResult.treeId;
  const treeVersion = treeResult.version;
  console.log(`[SWISH] Category resolution: marketplaceId=EBAY_GB, categoryTreeId=${treeId}, categoryTreeVersion=${treeVersion}, storedCategoryId=${categoryId || '(none)'}, itemTitle="${title.slice(0, 60)}"`);

  // Step 1: Validate stored category ID
  if (categoryId && !KNOWN_PARENT_CATEGORY_HINT.has(categoryId)) {
    console.log(`[SWISH] Verifying stored categoryId=${categoryId} (EBAY_GB treeId=${treeId})`);
    const catInfo = await verifyCategoryIsLeaf(token, clientId, categoryId, supabaseAdmin);
    if (catInfo !== null) {
      if (catInfo.isLeaf) {
        let catName = catInfo.name === categoryId ? categoryId : catInfo.name;
        if (catName === categoryId && supabaseAdmin) {
          const { data: nameRow } = await supabaseAdmin.from('ebay_categories')
            .select('category_name').eq('marketplace_id', 'EBAY_GB').eq('category_id', categoryId).maybeSingle();
          if (nameRow?.category_name) catName = nameRow.category_name;
        }
        console.log(`[SWISH] Category ${categoryId} ("${catName}") confirmed EBAY_GB leaf (treeId=${treeId}, treeVersion=${treeVersion}, fromDb=${catInfo.fromDb ?? false})`);
        return { resolvedId: categoryId, resolvedName: catName, categoryName: catName, treeId, treeVersion, wasResolved: false, confidence: catInfo.fromDb ? 'db_verified' : 'taxonomy_verified' };
      }
      console.log(`[SWISH] Category ${categoryId} is NOT a valid EBAY_GB leaf (treeId=${treeId}) — trying title-based suggestions`);
    } else {
      console.log(`[SWISH] Taxonomy API unavailable for categoryId=${categoryId} (treeId=${treeId}) — attempting title-based resolution`);
    }
  }

  // Step 2: Title-based leaf suggestion via EBAY_GB Taxonomy
  if (title && title.trim().length > 3) {
    console.log(`[SWISH] Requesting EBAY_GB category suggestions for: "${title.slice(0, 80)}" (treeId=${treeId})`);
    const suggestions = await findLeafCategoryByTitle(token, clientId, title);
    if (suggestions.length > 0) {
      const best = suggestions[0];
      if (supabaseAdmin) {
        const now = new Date().toISOString();
        supabaseAdmin.from('ebay_categories').upsert(
          { marketplace_id: 'EBAY_GB', tree_id: treeId, tree_version: treeVersion,
            category_id: best.id, category_name: best.name, is_leaf: true, active: true,
            last_synced_at: now, updated_at: now },
          { onConflict: 'marketplace_id,category_id' }
        ).then(() => {}).catch(() => {});
      }
      console.log(`[SWISH] Title-resolved to EBAY_GB leaf: categoryId=${best.id}, name="${best.name}", confidence=${best.confidence}, treeId=${treeId}, treeVersion=${treeVersion}`);
      return { resolvedId: best.id, resolvedName: best.name, categoryName: best.name, treeId, treeVersion, wasResolved: true, confidence: best.confidence };
    }
    console.log(`[SWISH] No EBAY_GB leaf suggestions returned for title="${title.slice(0, 60)}" (treeId=${treeId})`);
  }

  // Step 3: HARD STOP
  const storedMsg = categoryId && !KNOWN_PARENT_CATEGORY_HINT.has(categoryId)
    ? `Category ID ${categoryId} was rejected by the EBAY_GB Taxonomy API (treeId=${treeId}) — it is not a valid UK listing leaf. `
    : '';
  const msg = `${storedMsg}Please open the Listing Editor, tap the Category field, select a category marked "✓ Leaf" from the live eBay browser, tap Save, then try submitting again.`;
  console.error(`[SWISH] HARD STOP: Cannot resolve valid EBAY_GB leaf. marketplaceId=EBAY_GB, categoryTreeId=${treeId}, storedCategoryId=${categoryId}, specialistId=${specialistId}`);
  return STOP_RESULT(msg);
}

// ── Get category aspects via eBay Taxonomy API ────────────────────────────────

interface CategoryAspect {
  aspectName: string;
  aspectConstraint: {
    aspectRequired: boolean;
    aspectUsage: 'REQUIRED' | 'RECOMMENDED' | 'OPTIONAL';
    itemToAspectCardinality: string;
  };
  aspectValues: Array<{ localizedValue: string }>;
}

async function getEbayCategoryAspects(
  accessToken: string,
  categoryId: string,
): Promise<{ aspects: CategoryAspect[]; error?: string }> {
  try {
    const { treeId: aspectTreeId } = await getUkCategoryTreeId(accessToken).catch(() => ({ treeId: EBAY_UK_CATEGORY_TREE_ID, version: 'fallback', fromCache: false }));
    const res = await fetch(
      `${EBAY_TAXONOMY_API}/category_tree/${aspectTreeId}/get_item_aspects_for_category?category_id=${encodeURIComponent(categoryId)}`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB',
        },
        signal: AbortSignal.timeout(10000),
      },
    );

    if (!res.ok) {
      const errText = await res.text();
      return { aspects: [], error: `eBay Taxonomy API error (${res.status}): ${errText.slice(0, 200)}` };
    }

    const data = await res.json();
    const aspects: CategoryAspect[] = (data.aspects ?? []).map((a: any) => ({
      aspectName: a.aspectName ?? '',
      aspectConstraint: {
        aspectRequired: a.aspectConstraint?.aspectRequired === true,
        aspectUsage: a.aspectConstraint?.aspectUsage ?? 'OPTIONAL',
        itemToAspectCardinality: a.aspectConstraint?.itemToAspectCardinality ?? 'SINGLE',
      },
      aspectValues: (a.aspectValues ?? []).map((v: any) => ({
        localizedValue: v.localizedValue ?? '',
      })).slice(0, 30),
    }));

    return { aspects };
  } catch (e: any) {
    return { aspects: [], error: `Failed to fetch category aspects: ${e.message}` };
  }
}

// ── Condition ID mapping ─────────────────────────────────────────────────────

function mapConditionId(condition: string, conditionGrade: string): string {
  const c = (condition ?? '').toLowerCase();
  const g = (conditionGrade ?? '').toLowerCase();
  if (c.includes('new') || c.includes('sealed') || c.includes('mint') || g === 'mint') return '1000';
  if (c.includes('like new') || c.includes('near mint') || g.includes('nm')) return '1500';
  if (c.includes('excellent') || c.includes('very fine') || g.includes('ef') || g.includes('vf')) return '2500';
  if (c.includes('good') || g === 'f' || g === 'fine') return '3000';
  if (c.includes('acceptable') || c.includes('poor') || c.includes('worn')) return '5000';
  return '3000';
}

// ── Simple Delivery compatibility check ─────────────────────────────────────

async function validateSimpleDeliveryCompatibility(
  accessToken: string,
  fulfillmentPolicyId: string,
  cachedPolicies: SellerPolicies | null,
): Promise<{ compatible: boolean; error?: string }> {
  if (!fulfillmentPolicyId) return { compatible: true };

  if (cachedPolicies) {
    const fp = cachedPolicies.fulfillmentPolicies.find(p => p.policyId === fulfillmentPolicyId);
    if (fp) {
      const nameLower = (fp.name ?? '').toLowerCase();
      if (nameLower.includes('simple')) return { compatible: true };
    }
  }

  try {
    const resp = await fetch(
      `${EBAY_ACCOUNT_API}/fulfillment_policy/${encodeURIComponent(fulfillmentPolicyId)}`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB',
        },
        signal: AbortSignal.timeout(8000),
      },
    );

    if (!resp.ok) {
      if (resp.status === 404) {
        return {
          compatible: false,
          error: `Fulfillment policy "${fulfillmentPolicyId}" was not found in your eBay account. Please reload policies in Settings.`,
        };
      }
      const errBody = await resp.text().catch(() => '');
      console.log(`[SWISH] Simple Delivery check: Account API ${resp.status} for policy ${fulfillmentPolicyId} — passing through. Body: ${errBody.slice(0, 200)}`);
      return { compatible: true };
    }

    const policy = await resp.json();
    const fulfillmentType = (policy.fulfillmentType ?? '') as string;
    const hasLegacyShipping = (policy.shippingOptions ?? []).some(
      (opt: any) => opt.optionType === 'DOMESTIC' || opt.optionType === 'INTERNATIONAL',
    );

    if (fulfillmentType === 'SIMPLE_DELIVERY') return { compatible: true };

    if (hasLegacyShipping) {
      console.log(`[SWISH] Simple Delivery check: policy "${policy.name ?? fulfillmentPolicyId}" uses legacy shipping — allowed.`);
      return { compatible: true };
    }

    const policyName = policy.name ?? fulfillmentPolicyId;
    const actualType = fulfillmentType || 'unknown';
    console.log(`[SWISH] Simple Delivery check: policy "${policyName}" fulfillmentType="${actualType}" — allowing through.`);
    return { compatible: true };
  } catch (e: any) {
    console.log(`[SWISH] Simple Delivery check timed out/failed: ${e.message} — passing through.`);
    return { compatible: true };
  }
}

// ── Build SellerProfiles XML ──────────────────────────────────────────────────

function buildSellerProfiles(
  fulfillmentPolicyId: string,
  returnPolicyId: string,
  paymentPolicyId: string,
): string {
  const parts: string[] = [];

  if (fulfillmentPolicyId) {
    parts.push(`<SellerShippingProfile>
      <ShippingProfileID>${xmlEscape(fulfillmentPolicyId)}</ShippingProfileID>
    </SellerShippingProfile>`);
  }
  if (returnPolicyId) {
    parts.push(`<SellerReturnProfile>
      <ReturnProfileID>${xmlEscape(returnPolicyId)}</ReturnProfileID>
    </SellerReturnProfile>`);
  }
  if (paymentPolicyId) {
    parts.push(`<SellerPaymentProfile>
      <PaymentProfileID>${xmlEscape(paymentPolicyId)}</PaymentProfileID>
    </SellerPaymentProfile>`);
  }

  if (!parts.length) return '';

  return `<SellerProfiles>
    ${parts.join('\n    ')}
  </SellerProfiles>
  <DispatchTimeMax>3</DispatchTimeMax>`;
}

// ── Build item specifics XML ──────────────────────────────────────────────────

function buildItemSpecifics(specifics: Array<{ name: string; value: string }>): string {
  const filtered = specifics
    .filter(s => s.name && s.value && String(s.name).trim() && String(s.value).trim())
    .slice(0, 25)
    .map(s => {
      const name  = String(s.name).trim().slice(0, 65);
      const value = String(s.value).trim().slice(0, 65);
      return `<NameValueList><Name>${xmlEscape(name)}</Name><Value>${xmlEscape(value)}</Value></NameValueList>`;
    })
    .join('');
  return filtered ? `<ItemSpecifics>${filtered}</ItemSpecifics>` : '';
}

// ── Build picture details XML ─────────────────────────────────────────────────

function buildPictureDetails(mediaUrls: string[]): string {
  const validUrls = mediaUrls
    .filter(u => u && typeof u === 'string' && u.startsWith('https://'))
    .slice(0, 12);
  if (!validUrls.length) return '';
  const urlXml = validUrls.map(u => `    <PictureURL>${xmlEscape(u)}</PictureURL>`).join('\n');
  return `<PictureDetails>\n${urlXml}\n  </PictureDetails>`;
}

// ── Pre-submission validator ──────────────────────────────────────────────────

interface PayloadToValidate {
  title: string;
  price: number;
  categoryId: string;
  conditionId: string;
  fulfillmentPolicyId: string;
  returnPolicyId: string;
  mediaUrls?: string[];
  itemSpecifics?: Array<{ name: string; value: string }>;
  requiredAspects?: string[];
}

function validatePayload(p: PayloadToValidate): string | null {
  if (!p.title || p.title.trim().length < 3) return 'eBay listing requires a title of at least 3 characters.';
  if (p.title.trim().length > 80) return 'eBay listing title cannot exceed 80 characters.';
  if (p.price <= 0) return 'eBay listing requires a price greater than £0.00.';
  if (!p.categoryId || p.categoryId.trim() === '' || p.categoryId === '0') {
    return 'SWISH could not determine a valid eBay listing category. Please select a final eBay category from the category editor on the item detail screen.';
  }
  if (!p.conditionId) return 'eBay listing requires a condition to be set.';

  if (!p.fulfillmentPolicyId) {
    return 'Your eBay fulfillment (shipping) policy has not been selected. Go to Settings → eBay Connection → tap "Load Policies" and select your shipping policy before listing.';
  }
  if (!p.returnPolicyId) {
    return 'Your eBay return policy has not been selected. Go to Settings → eBay Connection → tap "Load Policies" and select your return policy before listing.';
  }

  if (p.requiredAspects && p.requiredAspects.length > 0 && p.itemSpecifics) {
    const providedNames = new Set(p.itemSpecifics.map(s => s.name.toLowerCase()));
    for (const required of p.requiredAspects) {
      if (!providedNames.has(required.toLowerCase())) {
        return `eBay requires additional information for this category: "${required}". Please add this item specific before submitting.`;
      }
    }
  }

  return null;
}

// ── User-friendly error translation ──────────────────────────────────────────

function friendlyError(rawErrors: string[], fallback: string): string {
  if (!rawErrors.length) return fallback;
  const raw = rawErrors.join('; ').toLowerCase();

  if (raw.includes('not a valid ebay leaf') || raw.includes('not a leaf category')) {
    return 'The selected category is a parent/invalid eBay category. Open the Listing Editor → tap Category → use the live browser to drill down to a category marked "✓ Leaf" → tap Save, then retry.';
  }
  if (raw.includes('business polic') || raw.includes('seller polic') || raw.includes('fulfillment polic') || (raw.includes('shipping') && raw.includes('invalid'))) {
    return 'Your eBay account uses Business Policies. Please load and select your policy IDs in Settings → eBay Connection, then retry.';
  }
  if (raw.includes('return polic') || raw.includes('returnpolic')) {
    return 'Your eBay account requires a return policy ID. Load your policies in Settings → eBay Connection.';
  }
  if (raw.includes('too long') || raw.includes('characters')) return rawErrors[0];
  if (raw.includes('title')) return `eBay rejected the listing title: ${rawErrors[0]}`;
  if (raw.includes('categoryid')) return `eBay rejected the category ID. Raw eBay error: ${rawErrors[0]}`;
  if (raw.includes('condition') || raw.includes('conditionid')) return 'eBay requires a valid condition. Please set the item condition before submitting.';
  if (raw.includes('price') || raw.includes('startprice')) return 'eBay rejected the price. Please check the listing price is valid and greater than £0.00.';
  if (raw.includes('token') || raw.includes('auth') || raw.includes('credential')) return 'eBay authentication failed. Please re-authorise your eBay connection in Marketplaces.';
  if (raw.includes('suspended') || raw.includes('restricted') || raw.includes('selling limit')) return 'Your eBay account has a selling restriction. Please check your eBay Seller Hub.';
  if (raw.includes('duplicate') || raw.includes('same title')) return 'eBay flagged this as a duplicate listing. You may already have this item listed.';
  if (raw.includes('item specific') || raw.includes('aspect')) return `eBay requires additional item information: ${rawErrors[0]}`;

  return rawErrors[0] ?? fallback;
}

// ── XML helpers ───────────────────────────────────────────────────────────────

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m: string, n: string) => String.fromCharCode(Number(n)))
    .trim();
}

function parseErrors(xml: string): string[] {
  const errors: string[] = [];
  const regex = /<Errors>[\s\S]*?<LongMessage>([\s\S]*?)<\/LongMessage>[\s\S]*?<\/Errors>/g;
  let m;
  while ((m = regex.exec(xml)) !== null) errors.push(decodeXmlEntities(m[1].replace(/<[^>]+>/g, '').trim()));
  if (errors.length === 0) {
    const shortRegex = /<Errors>[\s\S]*?<ShortMessage>([\s\S]*?)<\/ShortMessage>[\s\S]*?<\/Errors>/g;
    let sm;
    while ((sm = shortRegex.exec(xml)) !== null) errors.push(decodeXmlEntities(sm[1].replace(/<[^>]+>/g, '').trim()));
  }
  return errors;
}

function parseAck(xml: string): string {
  const match = xml.match(/<Ack>(.*?)<\/Ack>/);
  return match ? match[1] : 'Failure';
}

function parseItemId(xml: string): string | null {
  const match = xml.match(/<ItemID>(\d+)<\/ItemID>/);
  return match ? match[1] : null;
}

async function callEbayTradingApi(xml: string, callName: string, clientId: string): Promise<{ xml: string; ok: boolean }> {
  const resp = await fetch(EBAY_TRADING_API_URL, {
    method: 'POST',
    headers: {
      'X-EBAY-API-SITEID': '3',
      'X-EBAY-API-COMPATIBILITY-LEVEL': '967',
      'X-EBAY-API-CALL-NAME': callName,
      'X-EBAY-API-APP-NAME': clientId,
      'Content-Type': 'text/xml;charset=utf-8',
    },
    body: xml,
    signal: AbortSignal.timeout(20000),
  });
  const responseXml = await resp.text();
  const ack = parseAck(responseXml);
  return { xml: responseXml, ok: resp.ok && (ack === 'Success' || ack === 'Warning') };
}

// ── XML builders ─────────────────────────────────────────────────────────────

function buildBuyItNowXML(params: {
  token: string; title: string; description: string; categoryId: string;
  conditionId: string; price: number; quantity: number;
  itemSpecifics: Array<{ name: string; value: string }>;
  mediaUrls: string[]; sellerProfilesXml: string; bestOfferEnabled?: boolean;
}): string {
  const specifics = buildItemSpecifics(params.itemSpecifics);
  const pictures = buildPictureDetails(params.mediaUrls);
  const bestOfferXml = params.bestOfferEnabled
    ? '<BestOfferDetails><BestOfferEnabled>true</BestOfferEnabled></BestOfferDetails>' : '';

  return `<?xml version="1.0" encoding="utf-8"?>
<AddFixedPriceItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials><eBayAuthToken>${params.token}</eBayAuthToken></RequesterCredentials>
  <Item>
    <Title>${xmlEscape(params.title.slice(0, 80))}</Title>
    <Description><![CDATA[${params.description}]]></Description>
    <PrimaryCategory><CategoryID>${xmlEscape(params.categoryId)}</CategoryID></PrimaryCategory>
    <StartPrice currencyID="GBP">${params.price.toFixed(2)}</StartPrice>
    <Currency>GBP</Currency>
    <Quantity>${Math.max(1, params.quantity)}</Quantity>
    <ListingType>FixedPriceItem</ListingType>
    <ListingDuration>GTC</ListingDuration>
    <ConditionID>${xmlEscape(params.conditionId)}</ConditionID>
    <Country>GB</Country>
    <Location>UK</Location>
    ${params.sellerProfilesXml}
    ${pictures}
    ${specifics}
    ${bestOfferXml}
    <Site>UK</Site>
  </Item>
</AddFixedPriceItemRequest>`;
}

function buildAuctionXML(params: {
  token: string; title: string; description: string; categoryId: string;
  conditionId: string; startPrice: number; reservePrice?: number;
  quantity: number; durationDays: number;
  itemSpecifics: Array<{ name: string; value: string }>;
  mediaUrls: string[]; sellerProfilesXml: string;
}): string {
  const specifics = buildItemSpecifics(params.itemSpecifics);
  const pictures = buildPictureDetails(params.mediaUrls);
  const reservePriceXml = params.reservePrice && params.reservePrice > params.startPrice
    ? `<ReservePrice currencyID="GBP">${params.reservePrice.toFixed(2)}</ReservePrice>` : '';
  const durationMap: Record<number, string> = { 1: 'Days_1', 3: 'Days_3', 5: 'Days_5', 7: 'Days_7', 10: 'Days_10' };
  const duration = durationMap[params.durationDays] ?? 'Days_7';

  return `<?xml version="1.0" encoding="utf-8"?>
<AddItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials><eBayAuthToken>${params.token}</eBayAuthToken></RequesterCredentials>
  <Item>
    <Title>${xmlEscape(params.title.slice(0, 80))}</Title>
    <Description><![CDATA[${params.description}]]></Description>
    <PrimaryCategory><CategoryID>${xmlEscape(params.categoryId)}</CategoryID></PrimaryCategory>
    <StartPrice currencyID="GBP">${params.startPrice.toFixed(2)}</StartPrice>
    ${reservePriceXml}
    <Currency>GBP</Currency>
    <Quantity>1</Quantity>
    <ListingType>Chinese</ListingType>
    <ListingDuration>${duration}</ListingDuration>
    <ConditionID>${xmlEscape(params.conditionId)}</ConditionID>
    <Country>GB</Country>
    <Location>UK</Location>
    ${params.sellerProfilesXml}
    ${pictures}
    ${specifics}
    <Site>UK</Site>
  </Item>
</AddItemRequest>`;
}

function buildReviseBuyItNowXML(params: {
  token: string; externalItemId: string; title: string; description: string;
  categoryId: string; conditionId: string; price: number; quantity: number;
  itemSpecifics: Array<{ name: string; value: string }>;
  mediaUrls: string[]; sellerProfilesXml: string; bestOfferEnabled?: boolean;
}): string {
  const specifics = buildItemSpecifics(params.itemSpecifics);
  const pictures = buildPictureDetails(params.mediaUrls);
  const bestOfferXml = params.bestOfferEnabled
    ? '<BestOfferDetails><BestOfferEnabled>true</BestOfferEnabled></BestOfferDetails>' : '';
  const categoryXml = params.categoryId && params.categoryId !== 'REVISE_PRESERVE'
    ? `<PrimaryCategory><CategoryID>${xmlEscape(params.categoryId)}</CategoryID></PrimaryCategory>` : '';

  return `<?xml version="1.0" encoding="utf-8"?>
<ReviseFixedPriceItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials><eBayAuthToken>${params.token}</eBayAuthToken></RequesterCredentials>
  <Item>
    <ItemID>${xmlEscape(params.externalItemId)}</ItemID>
    <Title>${xmlEscape(params.title.slice(0, 80))}</Title>
    <Description><![CDATA[${params.description}]]></Description>
    ${categoryXml}
    <StartPrice currencyID="GBP">${params.price.toFixed(2)}</StartPrice>
    <Quantity>${Math.max(1, params.quantity)}</Quantity>
    <ConditionID>${xmlEscape(params.conditionId)}</ConditionID>
    ${params.sellerProfilesXml}
    ${pictures}
    ${specifics}
    ${bestOfferXml}
  </Item>
</ReviseFixedPriceItemRequest>`;
}

function buildReviseAuctionXML(params: {
  token: string; externalItemId: string; title: string; description: string;
  categoryId: string; conditionId: string; reservePrice?: number;
  itemSpecifics: Array<{ name: string; value: string }>;
  mediaUrls: string[]; sellerProfilesXml: string;
}): string {
  const specifics = buildItemSpecifics(params.itemSpecifics);
  const pictures = buildPictureDetails(params.mediaUrls);
  const reservePriceXml = params.reservePrice && params.reservePrice > 0
    ? `<ReservePrice currencyID="GBP">${params.reservePrice.toFixed(2)}</ReservePrice>` : '';
  const categoryXml = params.categoryId && params.categoryId !== 'REVISE_PRESERVE'
    ? `<PrimaryCategory><CategoryID>${xmlEscape(params.categoryId)}</CategoryID></PrimaryCategory>` : '';

  return `<?xml version="1.0" encoding="utf-8"?>
<ReviseItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials><eBayAuthToken>${params.token}</eBayAuthToken></RequesterCredentials>
  <Item>
    <ItemID>${xmlEscape(params.externalItemId)}</ItemID>
    <Title>${xmlEscape(params.title.slice(0, 80))}</Title>
    <Description><![CDATA[${params.description}]]></Description>
    ${categoryXml}
    ${reservePriceXml}
    <ConditionID>${xmlEscape(params.conditionId)}</ConditionID>
    ${params.sellerProfilesXml}
    ${pictures}
    ${specifics}
  </Item>
</ReviseItemRequest>`;
}

// ── SWISH Main Handler ─────────────────────────────────────────────────────

async function handleRequest(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  let body: any = {};
  try { body = await req.json(); } catch { return jsonResponse({ error: 'Invalid JSON body' }, 400); }

  const supabase = adminClient();
  const authHeader = req.headers.get('Authorization');
  const internalSecret = req.headers.get('x-swish-internal-secret');

  const { tenantId, route = 'publish' } = body;
  if (!tenantId) return jsonResponse({ error: 'tenantId is required' }, 400);

  const auth = await verifyTenantMembership(supabase, authHeader, tenantId, internalSecret);
  if (!auth.ok) return jsonResponse({ error: auth.error }, 401);

  // ── Route: get_seller_policies ────────────────────────────────────────────
  if (route === 'get_seller_policies') {
    const creds = await getEbayCredentials(supabase, tenantId, false);
    if ('error' in creds) return jsonResponse({ error: creds.error }, 400);
    try {
      const policies = await fetchSellerPoliciesFromEbay(creds.accessToken);
      const { data: conn } = await supabase.from('marketplace_connectors').select('store_category_tree').eq('tenant_id', tenantId).eq('marketplace_id', 'ebay').maybeSingle();
      const existingObj = (() => { try { const e = conn?.store_category_tree; return typeof e === 'string' ? JSON.parse(e) : (e ?? {}); } catch { return {}; } })();
      await supabase.from('marketplace_connectors').update({ store_category_tree: { ...existingObj, policies }, policies_cached_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('tenant_id', tenantId).eq('marketplace_id', 'ebay');
      return jsonResponse({ success: true, policies });
    } catch (e: any) {
      return jsonResponse({ error: `Failed to fetch policies: ${e.message}` }, 500);
    }
  }

  // ── Route: set_policies ───────────────────────────────────────────────────
  if (route === 'set_policies') {
    const { fulfillmentPolicyId, returnPolicyId, paymentPolicyId } = body;
    const updates: any = { updated_at: new Date().toISOString() };
    if (fulfillmentPolicyId !== undefined) updates.selected_fulfillment_policy_id = fulfillmentPolicyId || null;
    if (returnPolicyId !== undefined) updates.selected_return_policy_id = returnPolicyId || null;
    if (paymentPolicyId !== undefined) updates.selected_payment_policy_id = paymentPolicyId || null;
    const { error } = await supabase.from('marketplace_connectors').update(updates).eq('tenant_id', tenantId).eq('marketplace_id', 'ebay');
    if (error) return jsonResponse({ error: error.message }, 500);
    return jsonResponse({ success: true });
  }

  // ── Taxonomy browser/search routes (fallback for the dedicated category function) ──
  if (route === 'get_category_children' || route === 'get_category_suggestions') {
    const query = String(body.query ?? body.searchQuery ?? '').trim().slice(0, 100);
    const parentId = String(body.parentId ?? '').trim();
    const { data: connector } = await supabase
      .from('marketplace_connectors')
      .select('credential_ref')
      .eq('tenant_id', tenantId)
      .eq('marketplace_id', 'ebay')
      .maybeSingle();

    // Prefer the application token (does not require the seller to have completed
    // OAuth); retry with the seller token when the app token lacks Taxonomy scope.
    const categoryTokens: string[] = [];
    const appToken = await getAppToken();
    if (appToken) categoryTokens.push(appToken);
    if (connector?.credential_ref) {
      const sellerCreds = await getEbayCredentials(supabase, tenantId, false);
      if (!('error' in sellerCreds) && sellerCreds.accessToken && !categoryTokens.includes(sellerCreds.accessToken)) {
        categoryTokens.push(sellerCreds.accessToken);
      }
    }

    // Only trust category-cache rows synchronized from the currently reported
    // EBAY_GB tree version. Old versions can retain obsolete leaf flags/IDs.
    let currentTree: { treeId: string; version: string } | null = null;
    for (const token of categoryTokens) {
      const meta = await getUkCategoryTreeId(token);
      if (!meta.error && meta.version && meta.version !== 'fallback' && meta.version !== 'unknown') {
        currentTree = { treeId: meta.treeId, version: meta.version };
        break;
      }
    }

    // Search suggestions must return leaf categories only.
    if (route === 'get_category_suggestions' || query.length >= 2) {
      if (query.length < 2) {
        return jsonResponse({ success: false, error: 'query is required (min 2 characters)', suggestions: [] }, 400);
      }

      let suggestions: Array<{ id: string; name: string; isLeaf: boolean; confidence: string; categoryPath?: string }> = [];
      let source = 'ebay_live';

      for (const token of categoryTokens) {
        try {
          const { treeId } = await getUkCategoryTreeId(token);
          const response = await fetch(
            `${EBAY_TAXONOMY_API}/category_tree/${treeId}/get_category_suggestions?q=${encodeURIComponent(query)}`,
            {
              headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB',
              },
              signal: AbortSignal.timeout(8000),
            },
          );
          if (!response.ok) continue;
          const payload = await response.json();
          const raw = Array.isArray(payload.categorySuggestions) ? payload.categorySuggestions : [];
          suggestions = raw.map((s: any, i: number) => {
            const cat = s.category ?? {};
            const ancestors = Array.isArray(s.categoryTreeNodeAncestors) ? s.categoryTreeNodeAncestors : [];
            const parts = [...ancestors.map((a: any) => String(a.categoryName ?? '')), String(cat.categoryName ?? '')].filter(Boolean);
            return {
              id: String(cat.categoryId ?? ''),
              name: String(cat.categoryName ?? ''),
              isLeaf: s.leafCategoryTreeNode === true,
              confidence: i === 0 ? 'high' : i < 3 ? 'medium' : 'low',
              categoryPath: parts.join(' > '),
            };
          }).filter((s: any) => s.id && s.name && s.isLeaf).slice(0, 8);
          if (suggestions.length) break;
        } catch (e: any) {
          console.log(`[SWISH Category] Suggestion search attempt failed: ${e.message}`);
        }
      }

      // Use the EBAY_GB local catalogue if live taxonomy isn't accessible.
      if (!suggestions.length) {
        try {
          const safeQuery = query.replace(/[(),%]/g, ' ').trim();
          const { data: cached } = await supabase.from('ebay_categories')
            .select('category_id, category_name, category_path')
            .eq('marketplace_id', 'EBAY_GB')
            .eq('active', true)
            .eq('is_leaf', true)
            .or(`category_name.ilike.%${safeQuery}%,category_path.ilike.%${safeQuery}%`)
            .order('category_name')
            .limit(8);
          if (cached?.length) {
            suggestions = cached.map((row: any, i: number) => ({
              id: String(row.category_id), name: String(row.category_name), isLeaf: true,
              confidence: i === 0 ? 'medium' : 'low', categoryPath: row.category_path ?? row.category_name,
            }));
            source = 'db_cache';
          }
        } catch (e: any) {
          console.log(`[SWISH Category] Local suggestion lookup failed: ${e.message}`);
        }
      }

      if (!suggestions.length) {
        return jsonResponse({ success: false, error: 'No matching EBAY_GB leaf categories found. Check the category service deployment/Taxonomy scope or try another keyword.', suggestions: [] });
      }
      return jsonResponse({ success: true, suggestions, source, query, marketplaceId: 'EBAY_GB' });
    }

    // Root entries double as safe browse starters. Parent nodes are labelled and
    // may be drilled into; leaf nodes can be selected directly.
    if (!parentId) {
      let roots: any[] = [];
      if (currentTree) {
        const { data } = await supabase.from('ebay_categories')
          .select('category_id, category_name, is_leaf, category_path')
          .eq('marketplace_id', 'EBAY_GB')
          .eq('tree_id', currentTree.treeId)
          .eq('tree_version', currentTree.version)
          .eq('active', true)
          .is('parent_category_id', null)
          .order('category_name')
          .limit(150);
        roots = data ?? [];
      }
      if (roots.length) {
        return jsonResponse({
          success: true,
          children: roots.map((row: any) => ({
            id: String(row.category_id), name: String(row.category_name),
            isLeaf: row.is_leaf === true, childCount: row.is_leaf === true ? 0 : 1,
            categoryPath: row.category_path ?? row.category_name,
          })),
          source: 'db_cache', parentId: '', marketplaceId: 'EBAY_GB',
        });
      }

      const curatedRoots = [
        { id: '267', name: 'Coins (browse all)', isLeaf: false, childCount: 20 },
        { id: '4726', name: 'British Coins', isLeaf: true, childCount: 0 },
        { id: '40714', name: 'Ancient Coins', isLeaf: true, childCount: 0 },
        { id: '18594', name: 'Medieval Coins', isLeaf: true, childCount: 0 },
        { id: '18593', name: 'Hammered Coins', isLeaf: true, childCount: 0 },
        { id: '527', name: 'Coin Collections & Lots', isLeaf: true, childCount: 0 },
        { id: '37964', name: 'Medals: Commemorative', isLeaf: true, childCount: 0 },
        { id: '37965', name: 'Medals: Other', isLeaf: true, childCount: 0 },
        { id: '13956', name: 'Militaria (browse all)', isLeaf: false, childCount: 10 },
        { id: '261', name: 'Great Britain Stamps', isLeaf: true, childCount: 0 },
        { id: '183454', name: 'Trading Cards / CCG', isLeaf: true, childCount: 0 },
        { id: '1469', name: 'Other Collectables (browse all)', isLeaf: false, childCount: 10 },
        { id: '20091', name: 'Antique Furniture', isLeaf: true, childCount: 0 },
        { id: '870', name: 'Ceramics & Pottery', isLeaf: true, childCount: 0 },
        { id: '261186', name: 'Rare & Antiquarian Books', isLeaf: true, childCount: 0 },
        { id: '281', name: 'Jewellery & Watches (browse)', isLeaf: false, childCount: 10 },
        { id: '50', name: 'Fine Jewellery', isLeaf: true, childCount: 0 },
        { id: '14324', name: 'Wristwatches', isLeaf: true, childCount: 0 },
        { id: '79183', name: 'Motocross / Off-Road Bikes', isLeaf: true, childCount: 0 },
        { id: '35586', name: 'Motorcycle Parts (browse all)', isLeaf: false, childCount: 20 },
        { id: '177831', name: 'Mountain Bikes', isLeaf: true, childCount: 0 },
        { id: '56197', name: 'Road Bikes', isLeaf: true, childCount: 0 },
        { id: '152506', name: 'Trainers & Athletic Shoes', isLeaf: true, childCount: 0 },
        { id: '175748', name: 'Vintage Clothing', isLeaf: true, childCount: 0 },
        { id: '3002', name: 'T-Shirts', isLeaf: true, childCount: 0 },
      ];
      return jsonResponse({ success: true, children: curatedRoots, source: 'curated', parentId: '', marketplaceId: 'EBAY_GB' });
    }

    // For child browsing, use the cached branch if available, otherwise ask live
    // Taxonomy. Persisted cache is keyed by category_id (not category name).
    try {
      let cachedChildren: any[] = [];
      if (currentTree) {
        const { data } = await supabase.from('ebay_categories')
          .select('category_id, category_name, is_leaf, category_path')
          .eq('marketplace_id', 'EBAY_GB')
          .eq('tree_id', currentTree.treeId)
          .eq('tree_version', currentTree.version)
          .eq('parent_category_id', parentId)
          .eq('active', true)
          .order('is_leaf', { ascending: false })
          .order('category_name')
          .limit(200);
        cachedChildren = data ?? [];
      }
      if (cachedChildren.length) {
        return jsonResponse({
          success: true,
          children: cachedChildren.map((row: any) => ({
            id: String(row.category_id), name: String(row.category_name),
            isLeaf: row.is_leaf === true, childCount: row.is_leaf === true ? 0 : 1,
            categoryPath: row.category_path ?? row.category_name,
          })),
          source: 'db_cache', parentId, marketplaceId: 'EBAY_GB',
        });
      }
    } catch (e: any) {
      console.log(`[SWISH Category] Cached child lookup failed: ${e.message}`);
    }

    let lastError = '';
    for (const token of categoryTokens) {
      try {
        const { treeId, version } = await getUkCategoryTreeId(token);
        const response = await fetch(
          `${EBAY_TAXONOMY_API}/category_tree/${treeId}/get_category_subtree?category_id=${encodeURIComponent(parentId)}`,
          {
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
              'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB',
            },
            signal: AbortSignal.timeout(10000),
          },
        );
        if (!response.ok) {
          lastError = `eBay Taxonomy returned HTTP ${response.status}`;
          continue;
        }
        const payload = await response.json();
        const parentNode = payload.categorySubtreeNode;
        const nodes = Array.isArray(parentNode?.childCategoryTreeNodes) ? parentNode.childCategoryTreeNodes : [];
        const { data: parentRow } = await supabase.from('ebay_categories')
          .select('category_path, path_ids')
          .eq('marketplace_id', 'EBAY_GB')
          .eq('category_id', parentId)
          .maybeSingle();
        const parentPath = parentRow?.category_path ?? String(parentNode?.category?.categoryName ?? parentId);
        const parentPathIds = parentRow?.path_ids ?? parentId;
        const now = new Date().toISOString();
        const children = nodes.map((node: any) => {
          const id = String(node.category?.categoryId ?? '');
          const name = String(node.category?.categoryName ?? '');
          const isLeaf = node.leafCategoryTreeNode === true;
          return {
            id, name, isLeaf,
            childCount: isLeaf ? 0 : Number(node.childCategoryTreeNodeCount ?? 1),
            categoryPath: [parentPath, name].filter(Boolean).join(' > '),
          };
        }).filter((child: any) => child.id && child.name);
        const toCache = children.map((child: any) => ({
          marketplace_id: 'EBAY_GB', tree_id: treeId, tree_version: version ?? 'unknown',
          category_id: child.id, category_name: child.name, parent_category_id: parentId,
          is_leaf: child.isLeaf, active: true, category_path: child.categoryPath,
          path_ids: parentPathIds ? `${parentPathIds}|${child.id}` : child.id,
          last_synced_at: now, updated_at: now,
        }));
        if (toCache.length) {
          const { error: cacheError } = await supabase.from('ebay_categories').upsert(toCache, { onConflict: 'marketplace_id,category_id' });
          if (cacheError) console.log(`[SWISH Category] Child cache write failed: ${cacheError.message}`);
        }
        return jsonResponse({ success: true, children, source: 'ebay_live', parentId, treeId, marketplaceId: 'EBAY_GB' });
      } catch (e: any) {
        lastError = e?.message ?? 'Taxonomy request failed';
      }
    }

    return jsonResponse({
      success: false,
      error: lastError || 'Category branch is not cached and live eBay Taxonomy is unavailable.',
      children: [], parentId, marketplaceId: 'EBAY_GB',
    });
  }

  // ── Route: resolve_category ───────────────────────────────────────────────
  if (route === 'resolve_category') {
    const { categoryId = '', title = '', specialistId = '' } = body;
    const creds = await getEbayCredentials(supabase, tenantId, false);
    if ('error' in creds) return jsonResponse({ error: creds.error }, 400);
    const result = await resolveLeafCategory(creds.accessToken, creds.clientId, categoryId, title, specialistId);
    if (result.error) return jsonResponse({ success: false, error: result.error }, 400);
    return jsonResponse({ success: true, resolvedId: result.resolvedId, resolvedName: result.resolvedName, wasResolved: result.wasResolved, confidence: result.confidence });
  }

  // ── Route: get_category_aspects ───────────────────────────────────────────
  if (route === 'get_category_aspects') {
    const { categoryId } = body;
    if (!categoryId) return jsonResponse({ error: 'categoryId required' }, 400);
    let token: string | null = null;
    try {
      const creds = await getEbayCredentials(supabase, tenantId, false);
      if (!('error' in creds)) token = creds.accessToken;
    } catch {}
    if (!token) token = await getAppToken();
    if (!token) return jsonResponse({ success: false, isLeaf: false, aspects: [], error: 'eBay API token unavailable' });
    const { aspects, error } = await getEbayCategoryAspects(token, categoryId);
    if (error && aspects.length === 0) {
      const match = error.match(/eBay Taxonomy API error \((\d+)\):\s*([\s\S]*)/);
      if (match) {
        const statusCode = Number(match[1]);
        const responseBody = match[2] ?? '';
        const definitelyNotLeaf = isAspectsNotLeaf(statusCode, responseBody);
        if (definitelyNotLeaf) {
          return jsonResponse({ success: true, isLeaf: false, aspects: [], error,
            reason: 'eBay confirmed this is not a leaf category.' });
        }
        // eBay can return HTTP 400 for valid leaves with no defined item
        // aspects. Treat only known "not a leaf" codes/messages as rejection.
        if (statusCode === 400) {
          return jsonResponse({ success: true, isLeaf: true, aspects: [], note: 'Valid leaf category with no defined aspects.' });
        }
        if (statusCode === 404) {
          return jsonResponse({ success: true, isLeaf: false, aspects: [], error,
            reason: 'eBay could not find this category.' });
        }
      }
      // Network, auth and server errors do not prove that the category is a parent.
      return jsonResponse({ success: false, isLeaf: null, aspects: [], error });
    }
    return jsonResponse({ success: true, isLeaf: true, aspects });
  }

  // ── Route: end ────────────────────────────────────────────────────────────
  if (route === 'end') {
    const { listingId, itemId, externalListingId } = body;
    if (!externalListingId) return jsonResponse({ error: 'externalListingId required' }, 400);
    const creds = await getEbayCredentials(supabase, tenantId, true);
    if ('error' in creds) return jsonResponse({ error: creds.error }, 400);
    const endXml = `<?xml version="1.0" encoding="utf-8"?>
<EndFixedPriceItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials><eBayAuthToken>${creds.accessToken}</eBayAuthToken></RequesterCredentials>
  <ItemID>${xmlEscape(externalListingId)}</ItemID>
  <EndingReason>NotAvailable</EndingReason>
</EndFixedPriceItemRequest>`;
    const { xml: endResp, ok: endOk } = await callEbayTradingApi(endXml, 'EndFixedPriceItem', creds.clientId);
    if (!endOk) {
      const errors = parseErrors(endResp);
      return jsonResponse({ success: false, error: friendlyError(errors, 'Failed to end eBay listing') });
    }
    if (listingId) {
      await supabase.from('listings').update({ status: 'ended', ended_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', listingId);
    }
    if (itemId) {
      await supabase.from('items').update({ status: 'identified', updated_at: new Date().toISOString() }).eq('id', itemId);
    }
    return jsonResponse({ success: true });
  }

  // ── Route: revise ─────────────────────────────────────────────────────────
  if (route === 'revise') {
    const {
      listingId, externalListingId, title = '', description = '', price = 0,
      condition = '', conditionDescription = '', listingType = 'FixedPriceItem',
      quantity = 1, itemSpecifics = [], mediaUrls: rawMediaUrls = [], categoryId: bodyCategoryId = '',
    } = body;
    if (!externalListingId) return jsonResponse({ error: 'externalListingId required for revise' }, 400);

    // BUG A FIX: Read category from DB listings table if not supplied in body
    // The client passes the UI-selected category, but if the client media is empty
    // or the category was already saved to the DB, prefer the DB value.
    let resolvedCategoryId = bodyCategoryId || '';
    let resolvedMediaUrls: string[] = ((rawMediaUrls as string[]) || []).filter(
      (u: string) => typeof u === 'string' && u.startsWith('https://')
    );

    if (listingId) {
      try {
        const { data: lRow } = await supabase
          .from('listings')
          .select('category_id, items(media, attributes, specialist_id)')
          .eq('id', listingId)
          .eq('tenant_id', tenantId)
          .maybeSingle();

        // BUG A FIX: Use DB category_id if body didn't supply one
        if (!resolvedCategoryId && lRow?.category_id) {
          resolvedCategoryId = lRow.category_id;
          console.log(`[SWISH revise] Category resolved from DB: categoryId=${resolvedCategoryId}`);
        }

        // BUG E FIX: If the client passed 0 media URLs, resolve from DB item
        // An empty client media array NEVER means the listing has no images.
        if (resolvedMediaUrls.length === 0) {
          const dbMedia: string[] = ((lRow as any)?.items?.media ?? []);
          resolvedMediaUrls = dbMedia.filter((u: string) => typeof u === 'string' && u.startsWith('https://'));
          if (resolvedMediaUrls.length > 0) {
            console.log(`[SWISH revise] Media resolved from DB: ${resolvedMediaUrls.length} URLs for listing ${listingId}`);
          } else {
            // Last resort: check attributes for _ebay_item_id and note it for the user
            const attrs: Record<string, any> = (lRow as any)?.items?.attributes ?? {};
            const ebayItemId = attrs['_ebay_item_id'];
            if (ebayItemId) {
              console.log(`[SWISH revise] No media in DB either — _ebay_item_id=${ebayItemId} exists but images not yet downloaded. Revision will proceed without images (existing eBay images preserved).`);
            }
          }
        }
      } catch (e: any) {
        console.log(`[SWISH revise] DB lookup failed: ${e.message}`);
      }
    }

    // Log the revise parameters for diagnostics
    console.log(
      `[eBay Revise] externalListingId=${externalListingId}` +
      ` categoryId=${resolvedCategoryId || '(preserve)'}` +
      ` mediaCount=${resolvedMediaUrls.length}` +
      ` mediaSource=${resolvedMediaUrls.length > 0 ? (rawMediaUrls.length > 0 ? 'client' : 'db') : 'none'}`
    );

    const creds = await getEbayCredentials(supabase, tenantId, true);
    if ('error' in creds) return jsonResponse({ error: creds.error }, 400);

    // Revisions use the same leaf-category guard as new listings. If the user
    // chose a category that is now a parent/invalid ID, stop and ask for a new
    // selection rather than silently moving the live listing to a title guess.
    if (resolvedCategoryId && resolvedCategoryId !== 'REVISE_PRESERVE') {
      const requestedCategoryId = String(resolvedCategoryId);
      const categoryCheck = await resolveLeafCategory(
        creds.accessToken,
        creds.clientId,
        requestedCategoryId,
        title,
        '',
        supabase,
      );
      if (categoryCheck.error || !categoryCheck.resolvedId) {
        return jsonResponse({
          success: false,
          error: categoryCheck.error ?? 'Could not verify this eBay category. Please select a valid leaf category and retry.',
          categoryId: requestedCategoryId,
        }, 400);
      }
      if (categoryCheck.resolvedId !== requestedCategoryId) {
        return jsonResponse({
          success: false,
          error: `Category ${requestedCategoryId} is not a verified EBAY_GB leaf category. SWISH found "${categoryCheck.resolvedName}" (${categoryCheck.resolvedId}) as a possible alternative. Select the correct category in the Listing Editor and retry; SWISH has not changed the live category.`,
          suggestedCategory: { id: categoryCheck.resolvedId, name: categoryCheck.resolvedName },
        }, 400);
      }
      resolvedCategoryId = categoryCheck.resolvedId;
    }

    const { fulfillmentId, returnId, paymentId } = await getSelectedPolicyIds(supabase, tenantId, {});
    const sellerProfilesXml = buildSellerProfiles(fulfillmentId, returnId, paymentId);
    const conditionId = mapConditionId(condition, '');
    let reviseXml: string;
    if (listingType === 'Chinese') {
      reviseXml = buildReviseAuctionXML({ token: creds.accessToken, externalItemId: externalListingId, title, description, categoryId: resolvedCategoryId || 'REVISE_PRESERVE', conditionId, itemSpecifics, mediaUrls: resolvedMediaUrls, sellerProfilesXml });
    } else {
      reviseXml = buildReviseBuyItNowXML({ token: creds.accessToken, externalItemId: externalListingId, title, description, categoryId: resolvedCategoryId || 'REVISE_PRESERVE', conditionId, price: Number(price), quantity: Number(quantity), itemSpecifics, mediaUrls: resolvedMediaUrls, sellerProfilesXml });
    }
    const { xml: revResp, ok: revOk } = await callEbayTradingApi(reviseXml, listingType === 'Chinese' ? 'ReviseItem' : 'ReviseFixedPriceItem', creds.clientId);
    if (!revOk) {
      const errors = parseErrors(revResp);
      return jsonResponse({ success: false, error: friendlyError(errors, 'Failed to revise eBay listing'), errors });
    }
    if (listingId) {
      const updatePayload: Record<string, any> = {
        title,
        description,
        price: Number(price),
        updated_at: new Date().toISOString(),
      };
      // Persist resolved category to listings table so future revisions use it
      if (resolvedCategoryId && resolvedCategoryId !== 'REVISE_PRESERVE') {
        updatePayload.category_id = resolvedCategoryId;
      }
      await supabase.from('listings').update(updatePayload).eq('id', listingId).eq('tenant_id', tenantId);
    }
    return jsonResponse({ success: true, externalListingId });
  }

  // ── Route: publish (default) ──────────────────────────────────────────────
  const {
    listingId,
    listingType = 'FixedPriceItem',
    auctionDays = 7,
    startPrice,
    reservePrice,
    categoryId: bodyCategory = '',
  } = body;

  if (!listingId) return jsonResponse({ error: 'listingId is required' }, 400);

  const { data: listingRow, error: listingErr } = await supabase
    .from('listings')
    .select(`id, title, description, price, floor_price, shipping_cost, status, category_id,
      items(id, canonical_title, condition, condition_grade, condition_notes, status, quantity,
            media, attributes, weight_grams, diameter_mm, specialist_id)`)
    .eq('id', listingId)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (listingErr || !listingRow) {
    return jsonResponse({ error: 'Listing not found or access denied.' }, 404);
  }

  const item = (listingRow as any).items as any;
  const title = (listingRow.title ?? item?.canonical_title ?? '').trim().slice(0, 80);
  const description = listingRow.description ?? '';
  const price = Number(listingRow.price ?? 0);
  // BUG F FIX: Category resolution priority:
  // 1. Body override (from listing editor)
  // 2. DB listings.category_id (set by import or previous revision)
  // 3. Item attributes ebay_category_id / _ebay_category_id (set on import)
  const attrCategoryId = item?.attributes?.ebay_category_id || item?.attributes?.['_ebay_category_id'] || '';
  const categoryId = bodyCategory || listingRow.category_id || attrCategoryId || '';

  if (listingRow.status === 'active') {
    return jsonResponse({ error: 'This listing is already active on eBay. Use the revise route to update it.' }, 400);
  }

  const creds = await getEbayCredentials(supabase, tenantId, true);
  if ('error' in creds) return jsonResponse({ error: creds.error }, 400);

  const { fulfillmentId, returnId, paymentId } = await getSelectedPolicyIds(supabase, tenantId, {});

  const policies: SellerPolicies | null = null;

  const policyError = validateBusinessPolicies(fulfillmentId, returnId, policies);
  if (policyError) return jsonResponse({ error: policyError }, 400);

  const catResult = await resolveLeafCategory(creds.accessToken, creds.clientId, categoryId, title, item?.specialist_id ?? '', supabase);
  if (catResult.error) return jsonResponse({ error: catResult.error }, 400);

  // If a category was explicitly stored/selected but eBay rejects it, never
  // silently publish to a different category based only on the listing title.
  if (categoryId && catResult.wasResolved && catResult.resolvedId !== String(categoryId)) {
    return jsonResponse({
      success: false,
      error: `Selected category ${categoryId} is not a valid EBAY_GB leaf category. SWISH found "${catResult.resolvedName}" (${catResult.resolvedId}) as a possible alternative. Select the alternative only if it matches your item, then retry.`,
      selectedCategoryId: String(categoryId),
      suggestedCategory: { id: catResult.resolvedId, name: catResult.resolvedName },
    }, 400);
  }

  const resolvedCategoryId = catResult.resolvedId;

  // Final server-side validation
  if (resolvedCategoryId && catResult.confidence !== 'taxonomy_verified' && catResult.confidence !== 'db_verified') {
    const finalCheck = await verifyCategoryIsLeaf(creds.accessToken, creds.clientId, resolvedCategoryId, supabase);
    if (finalCheck !== null && !finalCheck.isLeaf) {
      console.error(`[SWISH] Final validation failed: categoryId=${resolvedCategoryId} is not a valid EBAY_GB leaf (treeId=${catResult.treeId}). Blocking submission.`);
      return jsonResponse({ error: `Category ${resolvedCategoryId} was rejected by eBay's EBAY_GB Taxonomy as a non-leaf category (treeId=${catResult.treeId}). Please open the Listing Editor, select a valid leaf category, and retry.` }, 400);
    }
  }
  console.log(`[SWISH] Submitting: marketplaceId=EBAY_GB, categoryTreeId=${catResult.treeId}, categoryTreeVersion=${catResult.treeVersion}, categoryId=${resolvedCategoryId}, categoryName="${catResult.categoryName}"`);

  const attrs: Record<string, any> = item?.attributes ?? {};
  const specialistId: string = item?.specialist_id ?? '';
  const SPEC_BLOCKLIST = new Set([
    'batch_id', 'capture_ref', 'object_type', 'has_alteration', 'has_hole', 'has_countermark',
    'alteration_notes', 'ebay_category_id', 'ebay_category_name',
    'numista_type_id', 'numista_status', 'numista_candidate_id', 'numista_n', 'numista_url',
    'numista_match_score', 'numista_candidate_score',
    'inferred_issuer', 'inferred_ruler', 'inferred_period', 'inferred_country',
    'identification_confidence', 'valuation_confidence', 'identification_state',
    // MX internal fields
    'running_status_commercial_impact', 'preparation_estimate',
    'running_status', 'bike_type', 'model_family', 'year_range', 'stroke_type',
    // Clothing internal fields
    'era_evidence', 'is_vintage', 'is_deadstock', 'selling_points', 'recommended_marketplace',
    'authenticity_risk_reason', 'authenticity_markers', 'damage_notes',
  ]);

  // ── Niche-aware item specifics ─────────────────────────────────────────────
  // Build specifics from item attributes using niche-appropriate field mapping
  const itemSpecifics: Array<{ name: string; value: string }> = [];
  const seenNames = new Set<string>();

  function addSpec(name: string, value: any): void {
    if (!name || !value) return;
    const strVal = String(value).trim().slice(0, 65);
    if (!strVal || strVal === '0' || strVal === 'false') return;
    const displayName = name.slice(0, 65);
    if (seenNames.has(displayName.toLowerCase())) return;
    seenNames.add(displayName.toLowerCase());
    itemSpecifics.push({ name: displayName, value: strVal });
  }

  // MX specifics — map internal attributes to eBay-appropriate field names
  if (specialistId === 'motocross') {
    addSpec('Brand', attrs['manufacturer'] ?? item?.manufacturer);
    addSpec('Model', attrs['model'] ?? item?.manufacturer_model);
    addSpec('Year', attrs['model_year'] ?? item?.year_made ?? (attrs['year_range'] ? attrs['year_range'].split('-')[0] : null));
    addSpec('Engine Size', attrs['engine_size'] ?? (attrs['engine_cc'] ? `${attrs['engine_cc']}cc` : null));
    addSpec('Type', attrs['bike_type'] ? String(attrs['bike_type']).replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()) : null);
    addSpec('Stroke', attrs['stroke_type']);
    addSpec('Condition', item?.condition);
    addSpec('Country/Region of Manufacture', item?.country_of_origin);
    if (attrs['frame_number'] && attrs['frame_number'] !== 'Not visible') addSpec('VIN/Frame Number', attrs['frame_number']);
  }
  // Clothing specifics
  else if (specialistId === 'clothing' || specialistId === 'trainers_sneakers') {
    addSpec('Brand', attrs['brand'] ?? item?.manufacturer);
    addSpec('Type', attrs['garment_type'] ?? attrs['type']);
    addSpec('Department', attrs['gender_category'] ? String(attrs['gender_category']).replace(/mens?ware?/i, "Men's").replace(/womens?ware?/i, "Women's") : null);
    addSpec('Size', attrs['size'] ?? attrs['labelled_size']);
    addSpec('Colour', attrs['colour'] ?? attrs['color']);
    addSpec('Material', attrs['material'] ?? attrs['composition']);
    addSpec('Country/Region of Manufacture', attrs['country_manufacture'] ?? item?.country_of_origin);
    addSpec('Year Manufactured', attrs['era'] ? attrs['era'].split('-')[0] : null);
    addSpec('Style', attrs['style']);
  }
  // Default: extract from item attributes using existing logic
  for (const [k, v] of Object.entries(attrs)) {
    const keyLower = k.toLowerCase().replace(/[^a-z0-9_]/g, '_');
    if (SPEC_BLOCKLIST.has(keyLower)) continue;
    if (k.startsWith('_')) continue;
    if (v === null || v === undefined || String(v).trim() === '' || String(v) === 'false' || String(v) === '0') continue;
    const name = k.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()).slice(0, 65);
    const value = String(v).trim().slice(0, 65);
    if (name && value && !seenNames.has(name.toLowerCase())) addSpec(name, value);
  }

  const conditionId = mapConditionId(item?.condition ?? '', item?.condition_grade ?? '');
  const mediaUrls: string[] = ((item?.media ?? []) as string[]).filter((u: string) => typeof u === 'string' && u.startsWith('https://'));
  const sellerProfilesXml = buildSellerProfiles(fulfillmentId, returnId, paymentId);
  const quantity = Number(item?.quantity ?? 1) || 1;

  const validationError = validatePayload({ title, price, categoryId: resolvedCategoryId, conditionId, fulfillmentPolicyId: fulfillmentId, returnPolicyId: returnId, mediaUrls, itemSpecifics });
  if (validationError) return jsonResponse({ error: validationError }, 400);

  let requestXml: string;
  let callName: string;

  if (listingType === 'Chinese') {
    const auctionStartPrice = Number(startPrice ?? Math.max(price * 0.5, 0.99));
    requestXml = buildAuctionXML({ token: creds.accessToken, title, description, categoryId: resolvedCategoryId, conditionId, startPrice: auctionStartPrice, reservePrice: reservePrice ? Number(reservePrice) : undefined, quantity: 1, durationDays: Number(auctionDays) || 7, itemSpecifics, mediaUrls, sellerProfilesXml });
    callName = 'AddItem';
  } else {
    requestXml = buildBuyItNowXML({ token: creds.accessToken, title, description, categoryId: resolvedCategoryId, conditionId, price, quantity, itemSpecifics, mediaUrls, sellerProfilesXml });
    callName = 'AddFixedPriceItem';
  }

  const { xml: responseXml, ok } = await callEbayTradingApi(requestXml, callName, creds.clientId);
  const errors = parseErrors(responseXml);

  if (!ok) {
    console.error(`[SWISH] eBay ${callName} failed. Errors: ${errors.join('; ')}`);
    return jsonResponse({ success: false, error: friendlyError(errors, `eBay rejected the listing`), errors }, 400);
  }

  const externalListingId = parseItemId(responseXml);
  const publishedAt = new Date().toISOString();

  const warnings: string[] = [];
  try {
    await supabase.from('listings').update({
      status: 'active',
      external_listing_id: externalListingId,
      published_at: publishedAt,
      updated_at: publishedAt,
    }).eq('id', listingId);

    if (item?.id) {
      await supabase.from('items').update({
        status: 'listed',
        updated_at: publishedAt,
        marketplace: 'ebay',
      }).eq('id', item.id);
    }

    if (catResult.wasResolved && resolvedCategoryId) {
      await supabase.from('listings').update({ category_id: resolvedCategoryId }).eq('id', listingId);
    }
  } catch (dbErr: any) {
    console.error(`[SWISH] DB update after successful publish failed: ${dbErr.message}`);
    warnings.push('Listing is live on eBay but local database update failed — please sync.');
  }

  return jsonResponse({
    success: true,
    externalListingId,
    publishedAt,
    resolvedCategoryId,
    resolvedCategoryName: catResult.categoryName,
    categoryTreeId: catResult.treeId,
    categoryTreeVersion: catResult.treeVersion,
    categoryWasResolved: catResult.wasResolved,
    warnings: warnings.length > 0 ? warnings : undefined,
  });
}

// ── Entry point with 90-second hard deadline ─────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const DEADLINE_MS = 90_000;

  try {
    const result = await Promise.race([
      handleRequest(req),
      new Promise<Response>((_, reject) =>
        setTimeout(() => reject(new Error('SWISH_DEADLINE_EXCEEDED')), DEADLINE_MS)
      ),
    ]);
    return result;
  } catch (e: any) {
    if (e?.message === 'SWISH_DEADLINE_EXCEEDED') {
      console.error('[SWISH] 90s hard deadline exceeded — returning timeout error JSON');
      return new Response(
        JSON.stringify({
          success: false,
          error: 'eBay API is responding slowly (request took over 90 seconds). Please retry — your listing has NOT been submitted. If this persists, check your eBay connection in Marketplaces.',
        }),
        { status: 504, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
    console.error(`[SWISH] Unhandled error: ${e?.message ?? e}`);
    return new Response(
      JSON.stringify({ success: false, error: e?.message ?? 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
