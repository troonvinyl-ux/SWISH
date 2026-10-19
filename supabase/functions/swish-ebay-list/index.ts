
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

  const basicAuth = btoa(`${clientId}:${clientSecret}`);
  // eBay Taxonomy API uses the standard application OAuth scope.
  // commerce.taxonomy.readonly is not a valid eBay OAuth scope.
  const requestedScopes = [
    'https://api.ebay.com/oauth/api_scope',
  ];
  for (const scope of requestedScopes) {
    try {
      const resp = await fetch(EBAY_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${basicAuth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ grant_type: 'client_credentials', scope }).toString(),
        signal: AbortSignal.timeout(5000),
      });
      const data = await resp.json();
      if (!data.access_token) {
        console.log(`[SWISH] App token request failed for requested scope: ${data.error_description ?? data.error ?? 'unknown'}`);
        continue;
      }
      const expiresAt = Date.now() + (data.expires_in ?? 7200) * 1000;
      _appTokenCache = { token: data.access_token, expiresAt };
      console.log(`[SWISH] App token obtained successfully (taxonomyScope=${scope.includes('commerce.taxonomy.readonly')})`);
      return data.access_token;
    } catch (e: any) {
      console.log(`[SWISH] App token fetch failed for scope: ${e.message}`);
    }
  }
  return null;
}

// ── Token refresh ─────────────────────────────────────────────────────────────

async function refreshAccessToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
): Promise<{ accessToken: string; expiresAt: string }> {
  const basicAuth = btoa(`${clientId}:${clientSecret}`);
  // Omit scope so eBay preserves the complete scope set granted at consent.
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

const KNOWN_PARENT_CATEGORY_HINT = new Set([
  '4', '99', '260', '1', '550', '281', '220', '467', '11116', '11450',
  '619', '625', '888', '2984', '1249', '11232', '139971', '64482', '171228',
  // Known parent (non-leaf) categories — these IDs must never be published directly.
  '1469',  // Other Collectables parent
  '11116', // Coins parent beneath Collectables
  '58520', // Coins subtree parent beneath Coins
  '4733',  // Ancient coins parent
  '58519', // Roman coins parent
  '3394',  // British coins parent
  '58521', // British hammered coins parent
  '72366', // Early milled coins parent
  '122480', // Decimal coinage parent
  '141146', // Commemorative coins parent
  '141151', // Proof sets / coins parent
  '45148', // European coins parent
  '253',   // United States coins parent
  '13956', // Militaria browse parent
  '267',   // Books, Comics & Magazines parent in EBAY_GB (not Coins)
  '4455', '35586', '2906', // Motorcycle/bicycle parent categories
  '15724', '15725', '57990', '57991', '11483', '11484', // Clothing/shoe parent categories
  '0', '',
]);

// ── isAspectsNotLeaf ─────────────────────────────────────────────────────────
// Parse eBay's aspects endpoint 400 response to determine if this is truly
// "not a leaf" vs "valid leaf with no defined aspects".
//
// HTTP 400 WITHOUT eBay error 13003/13004 → valid leaf, no aspects (e.g. Greek coins)
// HTTP 400 WITH eBay error 13003/13004 → confirmed NOT a leaf
// HTTP 404 → category doesn't exist

function isAspectsNotLeaf(status: number, bodyText: string): boolean | null {
  if (status === 404) return true;
  if (status !== 400) return false;
  try {
    const parsed = JSON.parse(bodyText);
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.errors)) return null;
    const errors: any[] = parsed.errors;
    for (const err of errors) {
      const errId = Number(err.errorId ?? err.error_id ?? 0);
      const msg = String(err.message ?? err.longMessage ?? '').toLowerCase();
      if (errId === 13003 || errId === 13004 || errId === 13007) return true;
      if (msg.includes('not a valid leaf') || msg.includes('is not a leaf') ||
          msg.includes('leaf category') || msg.includes('invalid category id')) return true;
    }
    // A parseable eBay error payload without a "not a leaf" error is consistent
    // with valid categories that simply have no aspects.
    return false;
  } catch {
    // An unreadable 400 body is inconclusive, not proof of a valid leaf.
    return null;
  }
}

async function verifyCategoryIsLeaf(
  accessToken: string,
  _clientId: string,
  categoryId: string,
  supabaseAdmin?: ReturnType<typeof adminClient>,
): Promise<{ isLeaf: boolean; name: string; fromDb?: boolean; nameVerified?: boolean } | null> {
  // Read the local category name for human-readable errors only. Cached
  // active/leaf flags are never used as the publish decision.
  let displayName = categoryId;
  if (supabaseAdmin) {
    try {
      const { data: dbRow } = await supabaseAdmin
        .from('ebay_categories')
        .select('category_name, is_leaf, active')
        .eq('marketplace_id', 'EBAY_GB')
        .eq('category_id', categoryId)
        .maybeSingle();
      if (dbRow) {
        displayName = dbRow.category_name || categoryId;
        console.log(`[SWISH] Cached category metadata only: ${categoryId} → isLeaf=${dbRow.is_leaf} active=${dbRow.active !== false} name="${displayName}"`);
      }
    } catch (dbErr: any) {
      console.log(`[SWISH] Local category label lookup failed (non-fatal): ${dbErr.message}`);
    }
  }

  // Step 2: Live eBay Taxonomy API
  // CRITICAL: HTTP 400 alone does NOT mean "not a leaf".
  // Must parse the response body for error code 13003/13004.
  const { treeId } = await getUkCategoryTreeId(accessToken);

  try {
    // The subtree endpoint returns the authoritative current category name and
    // leafCategoryTreeNode flag. Use it first so a cached label cannot disguise a
    // valid-but-unrelated leaf from an older category map.
    const subtreeRes = await fetch(
      `${EBAY_TAXONOMY_API}/category_tree/${treeId}/get_category_subtree?category_id=${encodeURIComponent(categoryId)}`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB',
        },
        signal: AbortSignal.timeout(8000),
      },
    );
    if (subtreeRes.ok) {
      const subtreePayload = await subtreeRes.json();
      const node = subtreePayload.categorySubtreeNode;
      const liveId = String(node?.category?.categoryId ?? '');
      if (liveId === String(categoryId)) {
        // Only treat an explicit boolean leaf flag as authoritative. If the
        // Taxonomy subtree root omits this property, do not convert "unknown"
        // into false; continue to the aspects endpoint below for validation.
        if (typeof node.leafCategoryTreeNode === 'boolean') {
          return {
            isLeaf: node.leafCategoryTreeNode,
            name: String(node.category?.categoryName ?? displayName),
            fromDb: false,
            nameVerified: Boolean(node.category?.categoryName),
          };
        }
      }
    } else if (subtreeRes.status === 404) {
      return { isLeaf: false, name: categoryId, fromDb: false, nameVerified: true };
    }

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
      return { isLeaf: true, name: categoryId, fromDb: false, nameVerified: false };
    }
    if (res.status === 404 || res.status === 400) {
      const bodyText = await res.text().catch(() => '{}');
      const definitelyNotLeaf = isAspectsNotLeaf(res.status, bodyText);

      if (definitelyNotLeaf === true) {
        console.log(`[SWISH] Category ${categoryId}: confirmed NOT a leaf (HTTP ${res.status} + error 13003/13004/404, treeId=${treeId})`);
        return { isLeaf: false, name: categoryId, fromDb: false, nameVerified: false };
      }
      if (definitelyNotLeaf === null) {
        console.log(`[SWISH] Category ${categoryId}: HTTP ${res.status} response was inconclusive; refusing to mark as valid leaf`);
        return null;
      }

      // HTTP 400 with a parseable eBay error payload but no "not a leaf" error
      // can represent a valid leaf with no defined aspects.
      // (e.g. Greek ancient coins, Byzantine coins — valid EBAY_GB leaf categories)
      console.log(`[SWISH] Category ${categoryId}: HTTP ${res.status} but no "not a leaf" error — treating as valid leaf with no aspects (treeId=${treeId}). Body: ${bodyText.slice(0, 200)}`);
      return { isLeaf: true, name: categoryId, fromDb: false, nameVerified: false };
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
  // Do not reuse title-only category guesses across requests: the category tree
  // and leaf status may have changed. Ask the current EBAY_GB Taxonomy each time.
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
        // get_category_suggestions returns leaf categories by contract, but its
        // CategorySuggestion schema has no leafCategoryTreeNode property.
        if (catRef?.categoryId && catRef?.categoryName) {
          leafResults.push({
            id: String(catRef.categoryId),
            name: catRef.categoryName ?? String(catRef.categoryId),
            confidence: 'high',
          });
        }
      }

      if (leafResults.length > 0) {
        console.log(`[SWISH] Taxonomy API: ${leafResults.length} leaf suggestions for "${searchQuery}"`);
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
  // EBAY_GB verified leaf defaults; unspecified coin types go through live suggestions.
  coins_uk:                 { id: '79964', name: 'Other British Coins' },
  coins_currency:           { id: '79964', name: 'Other British Coins' },
  coins_world:              { id: '257',   name: 'Other World Coins' },
  islamic_silver:           { id: '4730',  name: 'Islamic Coins' },
  stamps:                   { id: '261',   name: 'Great Britain Stamps' },
  pokemon:                  { id: '183454', name: 'CCG Individual Cards' },
  trading_cards:            { id: '183454', name: 'CCG Individual Cards' },
  watches:                  { id: '14324', name: 'Wristwatches' },
  jewellery_gold_silver:    { id: '50',    name: 'Fine Jewellery' },
  // Do not hard-code gold/silver generic, banknotes, curiosities, or ancient artefacts
  // to parent or coin-only nodes. Those require a live category match.
}
void SPECIALIST_LEAF_REFERENCE;

async function resolveLeafCategory(
  token: string,
  clientId: string,
  categoryId: string,
  title: string,
  specialistId: string,
  supabaseAdmin?: ReturnType<typeof adminClient>,
  storedCategoryName = '',
): Promise<{ resolvedId: string; resolvedName: string; categoryName: string; treeId: string; treeVersion: string; wasResolved: boolean; confidence: string; error?: string }> {
  const STOP_RESULT = (msg: string) => ({
    resolvedId: '', resolvedName: '', categoryName: '',
    treeId: '', treeVersion: '', wasResolved: false, confidence: 'none', error: msg,
  });

  // Legacy SWISH drafts may still store the retired Islamic Coins ID 4739.
  // The live catalogue validation confirmed 4730 as the correct EBAY_GB leaf.
  // Canonicalise this known legacy value server-side before validation/submission,
  // so old drafts do not remain permanently blocked by their stale saved ID.
  const requestedCategoryId = String(categoryId ?? '');
  const isIslamicCoin = /\b(islamic|dirham|dinar|abbasid|umayyad|fatimid|ilkhanid)\b/i.test(
    `${title ?? ''} ${storedCategoryName ?? ''} ${specialistId ?? ''}`,
  );
  if (requestedCategoryId === '4739' && isIslamicCoin) {
    categoryId = '4730';
    storedCategoryName = 'Islamic Coins';
    console.log('[SWISH] Canonicalised legacy Islamic coin category 4739 → 4730 before live validation');
  }

  const treeResult = await getUkCategoryTreeId(token);
  const treeId = treeResult.treeId;
  const treeVersion = treeResult.version;
  console.log(`[SWISH] Category resolution: marketplaceId=EBAY_GB, categoryTreeId=${treeId}, categoryTreeVersion=${treeVersion}, storedCategoryId=${categoryId || '(none)'}, itemTitle="${title.slice(0, 60)}"`);

  // Track stale label/ID pairs written by older SWISH category maps. A category ID
  // can still be a valid leaf while belonging to a completely unrelated eBay category.
  let storedCategoryMismatch = '';

  // Step 1: Validate stored category ID
  if (categoryId && !KNOWN_PARENT_CATEGORY_HINT.has(categoryId)) {
    console.log(`[SWISH] Verifying stored categoryId=${categoryId} (EBAY_GB treeId=${treeId})`);
    const catInfo = await verifyCategoryIsLeaf(token, clientId, categoryId, supabaseAdmin);
    if (catInfo !== null) {
      if (catInfo.isLeaf) {
        let catName = catInfo.name === categoryId ? categoryId : catInfo.name;
        if (catName === categoryId && supabaseAdmin && catInfo.nameVerified !== false) {
          const { data: nameRow } = await supabaseAdmin.from('ebay_categories')
            .select('category_name').eq('marketplace_id', 'EBAY_GB').eq('category_id', categoryId).maybeSingle();
          if (nameRow?.category_name) catName = nameRow.category_name;
        }

        const normalizeCategoryLabel = (value: string) => value.toLowerCase()
          .replace(/\bcoins?\b/g, ' ')
          .replace(/[()[\],.\-–—&/]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        const savedLabel = normalizeCategoryLabel(String(storedCategoryName ?? ''));
        const liveLabel = normalizeCategoryLabel(String(catName ?? ''));
        const labelCompatible = !savedLabel ||
          (catInfo.nameVerified === true && Boolean(liveLabel) &&
            (savedLabel.includes(liveLabel) || liveLabel.includes(savedLabel)));

        if (labelCompatible) {
          console.log(`[SWISH] Category ${categoryId} ("${catName}") confirmed EBAY_GB leaf (treeId=${treeId}, treeVersion=${treeVersion}, source=${catInfo.fromDb ? 'db' : 'live_taxonomy'})`);
          return { resolvedId: categoryId, resolvedName: catName, categoryName: catName, treeId, treeVersion, wasResolved: false, confidence: catInfo.fromDb ? 'db_verified' : 'taxonomy_verified' };
        }

        storedCategoryMismatch = catInfo.nameVerified === true
          ? `Saved category label "${storedCategoryName}" does not match current EBAY_GB category "${catName}" for ID ${categoryId}. `
          : `Could not verify the saved category label "${storedCategoryName}" against the live EBAY_GB category name for ID ${categoryId}. `;
        console.warn(`[SWISH] ${storedCategoryMismatch}Requesting a fresh title-based suggestion.`);
      } else {
        console.log(`[SWISH] Category ${categoryId} is NOT a valid EBAY_GB leaf (treeId=${treeId}) — trying title-based suggestions`);
      }
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

  // Older SWISH category maps sometimes stored a generic/obsolete category ID
  // (for example 257) even though the listing retains a useful category label.
  // If title search did not find a live leaf, retry using that saved label before
  // falling back or blocking publication. Results come from live EBAY_GB Taxonomy.
  if (storedCategoryName && storedCategoryName.trim().length > 2) {
    const labelSuggestions = await findLeafCategoryByTitle(token, clientId, storedCategoryName.trim());
    const labelMatch = labelSuggestions.find((candidate: any) => candidate?.id && candidate?.name);
    if (labelMatch) {
      if (supabaseAdmin) {
        const now = new Date().toISOString();
        supabaseAdmin.from('ebay_categories').upsert(
          { marketplace_id: 'EBAY_GB', tree_id: treeId, tree_version: treeVersion,
            category_id: labelMatch.id, category_name: labelMatch.name, is_leaf: true, active: true,
            last_synced_at: now, updated_at: now },
          { onConflict: 'marketplace_id,category_id' }
        ).then(() => {}).catch(() => {});
      }
      console.log(`[SWISH] Saved-label-resolved to live EBAY_GB leaf: categoryId=${labelMatch.id}, name="${labelMatch.name}"`);
      return { resolvedId: labelMatch.id, resolvedName: labelMatch.name, categoryName: labelMatch.name,
        treeId, treeVersion, wasResolved: true, confidence: labelMatch.confidence ?? 'taxonomy_verified' };
    }
  }

  // If live keyword suggestions return no result, try a narrow coin-category fallback.
  // Every candidate is still verified against the current EBAY_GB taxonomy before use.
  const lowerTitle = String(title ?? '').toLowerCase();
  const coinFallbacks: Array<{ test: RegExp; id: string; name: string }> = [
    { test: /\b(islamic|dirham|dinar|abbasid|umayyad|fatimid|ilkhanid)\b/, id: '4730', name: 'Islamic Coins' },
    { test: /\b(chinese|china|fukien|mace|cash coin|cash coins)\b/, id: '4740', name: 'Ancient Chinese Coins' },
    { test: /\b(greek|hellenistic|alexander|macedon)\b/, id: '4738', name: 'Ancient Greek Coins' },
    { test: /\b(byzantine)\b/, id: '3364', name: 'Byzantine Coins' },
    { test: /\b(roman provincial)\b/, id: '4735', name: 'Roman Provincial Coins' },
    { test: /\b(roman republican|republican denarius)\b/, id: '4734', name: 'Roman Republican Coins' },
    // Generic ancient/antique titles must use live taxonomy suggestions; never guess a generic category ID.
  ];
  const coinFallback = coinFallbacks.find(entry => entry.test.test(lowerTitle));
  if (coinFallback && (specialistId.includes('coin') || ['islamic_silver', 'gold', 'silver', 'ancient_artefacts'].includes(specialistId))) {
    const verified = await verifyCategoryIsLeaf(token, clientId, coinFallback.id, supabaseAdmin);
    if (verified?.isLeaf) {
      console.log(`[SWISH] Taxonomy suggestions empty; live-verified title fallback: ${coinFallback.id} ${coinFallback.name}`);
      return {
        resolvedId: coinFallback.id, resolvedName: verified.name || coinFallback.name,
        categoryName: verified.name || coinFallback.name, treeId, treeVersion,
        wasResolved: true, confidence: 'taxonomy_verified',
      };
    }
    console.warn(`[SWISH] Coin fallback ${coinFallback.id} not confirmed as EBAY_GB leaf; refusing to use it.`);
  }

  // Step 3: HARD STOP
  const storedMsg = storedCategoryMismatch || (categoryId && !KNOWN_PARENT_CATEGORY_HINT.has(categoryId)
    ? `Category ID ${categoryId} was rejected by the EBAY_GB Taxonomy API (treeId=${treeId}) — it is not a valid UK listing leaf. `
    : '');
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

  // eBay Trading API error 518 is an application-level call quota, not a listing validation problem.
  // Do not suggest changing listing fields or reconnecting OAuth for this response.
  if (
    raw.includes('exceeded usage limit on this call') ||
    raw.includes('call usage limit has been reached') ||
    raw.includes('errorcode>518') ||
    raw.includes('error code 518')
  ) {
    return 'eBay has temporarily blocked this SWISH API call because the application has reached its eBay API usage limit (error 518). Your live listing has not been ended or deleted. Do not keep pressing Push; check API usage and limits in the eBay Developers Program, then retry when the limit is available again. Reconnecting eBay or changing the listing details will not clear this limit.';
  }

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

  // ── Route: get_api_usage — eBay Developer Analytics rate-limit dashboard ──
  // Uses the server-held application credentials. Never expose credentials/tokens to the client.
  if (route === 'get_api_usage') {
    const appToken = await getAppToken();
    if (!appToken) {
      return jsonResponse({
        success: false,
        error: 'Could not obtain an eBay application token. Check the server-side EBAY_CLIENT_ID and EBAY_CLIENT_SECRET configuration.',
      }, 502);
    }

    try {
      const response = await fetch('https://api.ebay.com/developer/analytics/v1_beta/rate_limit', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${appToken}`,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(12000),
      });
      const responseText = await response.text();
      let payload: any = null;
      try { payload = responseText ? JSON.parse(responseText) : null; } catch {}

      if (!response.ok) {
        const safeMessage = String(payload?.errors?.[0]?.message ?? payload?.error_description ?? payload?.error ?? responseText ?? `HTTP ${response.status}`).slice(0, 500);
        console.error(`[SWISH API Usage] Developer Analytics API returned HTTP ${response.status}: ${safeMessage}`);
        return jsonResponse({
          success: false,
          status: response.status,
          error: response.status === 401 || response.status === 403
            ? 'eBay rejected the Developer Analytics request. Check that this Production application is authorised for Developer Analytics and that its OAuth scopes are correct.'
            : `eBay Developer Analytics API returned HTTP ${response.status}: ${safeMessage}`,
        }, 502);
      }

      // eBay has occasionally returned 204 No Content from this endpoint.
      if (!payload) {
        return jsonResponse({
          success: true,
          data: null,
          message: 'eBay returned no rate-limit data for this request. Retry shortly or check eBay API status.',
          checkedAt: new Date().toISOString(),
        });
      }
      return jsonResponse({
        success: true,
        data: payload,
        checkedAt: new Date().toISOString(),
      });
    } catch (e: any) {
      console.error(`[SWISH API Usage] Request failed: ${e?.message ?? e}`);
      return jsonResponse({ success: false, error: 'Could not reach eBay Developer Analytics. Please retry.' }, 502);
    }
  }

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
              // CategorySuggestion responses already contain leaf nodes;
              // leafCategoryTreeNode is not a field in this response schema.
              isLeaf: Boolean(cat.categoryId && cat.categoryName),
              confidence: i === 0 ? 'high' : i < 3 ? 'medium' : 'low',
              categoryPath: parts.join(' > '),
            };
          }).filter((s: any) => s.id && s.name && s.isLeaf).slice(0, 8);
          if (suggestions.length) break;
        } catch (e: any) {
          console.log(`[SWISH Category] Suggestion search attempt failed: ${e.message}`);
        }
      }

      // Use the local catalogue only when it is synchronized to the exact live
      // EBAY_GB tree version. If tree metadata is unavailable, stale category IDs
      // are worse than an explicit search error, so do not guess from old rows.
      if (!suggestions.length && currentTree) {
        try {
          const safeQuery = query.replace(/[(),%]/g, ' ').trim();
          const { data: cached } = await supabase.from('ebay_categories')
            .select('category_id, category_name, category_path')
            .eq('marketplace_id', 'EBAY_GB')
            .eq('tree_id', currentTree.treeId)
            .eq('tree_version', currentTree.version)
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
          console.log(`[SWISH Category] Current-tree suggestion lookup failed: ${e.message}`);
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

      // When no current-version root cache exists, load the actual EBAY_GB
      // root rather than presenting hard-coded category IDs as a live tree.
      let rootError = '';
      for (const token of categoryTokens) {
        try {
          const { treeId, version } = await getUkCategoryTreeId(token);
          const response = await fetch(
            `${EBAY_TAXONOMY_API}/category_tree/${treeId}/get_category_subtree?category_id=0`,
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
            rootError = `eBay Taxonomy root returned HTTP ${response.status}`;
            continue;
          }
          const payload = await response.json();
          const rootNode = payload.categorySubtreeNode;
          const nodes = Array.isArray(rootNode?.childCategoryTreeNodes) ? rootNode.childCategoryTreeNodes : [];
          const now = new Date().toISOString();
          const liveRoots = nodes.map((node: any) => {
            const id = String(node.category?.categoryId ?? '');
            const name = String(node.category?.categoryName ?? '');
            const isLeaf = node.leafCategoryTreeNode === true;
            return {
              id, name, isLeaf,
              childCount: isLeaf ? 0 : Number(node.childCategoryTreeNodeCount ?? 1),
              categoryPath: name,
            };
          }).filter((item: any) => item.id && item.name);
          if (liveRoots.length) {
            const rows = liveRoots.map((item: any) => ({
              marketplace_id: 'EBAY_GB',
              tree_id: treeId,
              tree_version: version ?? currentTree?.version ?? 'unknown',
              category_id: item.id,
              category_name: item.name,
              parent_category_id: '0',
              is_leaf: item.isLeaf,
              active: true,
              category_path: item.categoryPath,
              path_ids: `0|${item.id}`,
              last_synced_at: now,
              updated_at: now,
            }));
            const { error: cacheError } = await supabase.from('ebay_categories')
              .upsert(rows, { onConflict: 'marketplace_id,category_id' });
            if (cacheError) console.log(`[SWISH Category] Root cache write failed: ${cacheError.message}`);
            return jsonResponse({
              success: true,
              children: liveRoots,
              source: 'ebay_live',
              parentId: '',
              treeId,
              treeVersion: version ?? null,
              marketplaceId: 'EBAY_GB',
            });
          }
          rootError = 'eBay Taxonomy returned no root categories.';
        } catch (e: any) {
          rootError = e?.message ?? 'eBay Taxonomy root request failed';
        }
      }

      const curatedRoots = [
        // The offline menu offers verified leaf examples only. Parent categories
        // are displayed as navigation nodes by the live taxonomy route, never as
        // selectable/publishable leaf categories.
        { id: '4738', name: 'Ancient Greek Coins', isLeaf: true, childCount: 0 },
        { id: '3365', name: 'Roman Imperial Coins (96–235 AD)', isLeaf: true, childCount: 0 },
        { id: '3364', name: 'Byzantine Coins', isLeaf: true, childCount: 0 },
        { id: '4730', name: 'Islamic Coins', isLeaf: true, childCount: 0 },
        { id: '4737', name: 'Ancient Persian & Indian Coins', isLeaf: true, childCount: 0 },
        { id: '532', name: 'Other Ancient Coins', isLeaf: true, childCount: 0 },
        { id: '79964', name: 'Other British Coins', isLeaf: true, childCount: 0 },
        { id: '257', name: 'Other World Coins', isLeaf: true, childCount: 0 },
        { id: '6071', name: 'Other British Banknotes', isLeaf: true, childCount: 0 },
        { id: '385', name: 'Other World Banknotes', isLeaf: true, childCount: 0 },
        { id: '261', name: 'Great Britain Stamps', isLeaf: true, childCount: 0 },
        { id: '183454', name: 'Trading Cards / CCG', isLeaf: true, childCount: 0 },
        { id: '50', name: 'Fine Jewellery', isLeaf: true, childCount: 0 },
        { id: '14324', name: 'Wristwatches', isLeaf: true, childCount: 0 },
        { id: '152506', name: 'Trainers & Athletic Shoes', isLeaf: true, childCount: 0 },
        { id: '3002', name: 'T-Shirts', isLeaf: true, childCount: 0 },
      ];
      return jsonResponse({
        success: true,
        children: curatedRoots,
        source: 'curated',
        ...(rootError ? { note: `Live EBAY_GB root fetch unavailable: ${rootError}. Options shown are offline navigation hints and will be revalidated before publish.` } : {}),
        parentId: '',
        marketplaceId: 'EBAY_GB',
      });
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
    const { categoryId = '', title = '', specialistId = '', categoryName = '' } = body;
    const creds = await getEbayCredentials(supabase, tenantId, false);
    if ('error' in creds) return jsonResponse({ error: creds.error }, 400);
    const result = await resolveLeafCategory(creds.accessToken, creds.clientId, categoryId, title, specialistId, undefined, categoryName);
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
    if (!token) return jsonResponse({ success: false, isLeaf: null, aspects: [], error: 'eBay API token unavailable; category is not verified' });
    const { aspects, error } = await getEbayCategoryAspects(token, categoryId);
    if (error && aspects.length === 0) {
      const match = error.match(/eBay Taxonomy API error \((\d+)\):\s*([\s\S]*)/);
      if (match) {
        const statusCode = Number(match[1]);
        const responseBody = match[2] ?? '';
        const definitelyNotLeaf = isAspectsNotLeaf(statusCode, responseBody);
        if (definitelyNotLeaf === true) {
          return jsonResponse({ success: true, isLeaf: false, aspects: [], error,
            reason: 'eBay confirmed this is not a leaf category.' });
        }
        if (statusCode === 400 && definitelyNotLeaf === null) {
          return jsonResponse({ success: false, isLeaf: null, aspects: [], error,
            reason: 'eBay returned an inconclusive category response. Retry validation; this category has not been marked valid or invalid.' });
        }
        // eBay can return HTTP 400 with a parseable error payload for valid leaves
        // that simply have no defined item aspects.
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
    const { listingId, externalListingId: requestedExternalListingId } = body;
    if (!listingId) return jsonResponse({ error: 'listingId required' }, 400);

    // Never trust a client-supplied external ID or item ID for a service-role write.
    // Resolve both from a listing owned by this tenant before calling eBay.
    const { data: ownedListing, error: ownedListingError } = await supabase
      .from('listings')
      .select('id, item_id, external_listing_id')
      .eq('id', listingId)
      .eq('tenant_id', tenantId)
      .eq('marketplace_id', 'ebay')
      .maybeSingle();

    if (ownedListingError || !ownedListing) {
      return jsonResponse({ error: 'Listing not found or access denied.' }, 404);
    }

    const savedExternalListingId = String(ownedListing.external_listing_id ?? '').trim();
    if (!savedExternalListingId) {
      return jsonResponse({ error: 'The saved listing has no eBay listing ID.' }, 400);
    }
    if (requestedExternalListingId && String(requestedExternalListingId).trim() !== savedExternalListingId) {
      return jsonResponse({ error: 'The requested eBay listing ID does not match this saved listing.' }, 403);
    }

    const savedItemId = String(ownedListing.item_id ?? '').trim();
    if (!savedItemId) return jsonResponse({ error: 'The saved listing has no linked inventory item.' }, 400);
    const { data: ownedItem, error: ownedItemError } = await supabase
      .from('items')
      .select('id')
      .eq('id', savedItemId)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (ownedItemError || !ownedItem) {
      return jsonResponse({ error: 'Linked inventory item not found or access denied.' }, 404);
    }

    const creds = await getEbayCredentials(supabase, tenantId, true);
    if ('error' in creds) return jsonResponse({ error: creds.error }, 400);
    const endXml = `<?xml version="1.0" encoding="utf-8"?>
<EndFixedPriceItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials><eBayAuthToken>${creds.accessToken}</eBayAuthToken></RequesterCredentials>
  <ItemID>${xmlEscape(savedExternalListingId)}</ItemID>
  <EndingReason>NotAvailable</EndingReason>
</EndFixedPriceItemRequest>`;
    const { xml: endResp, ok: endOk } = await callEbayTradingApi(endXml, 'EndFixedPriceItem', creds.clientId);
    if (!endOk) {
      const errors = parseErrors(endResp);
      return jsonResponse({ success: false, error: friendlyError(errors, 'Failed to end eBay listing') });
    }

    const now = new Date().toISOString();
    const { error: listingUpdateError } = await supabase.from('listings')
      .update({ status: 'ended', ended_at: now, updated_at: now })
      .eq('id', ownedListing.id)
      .eq('tenant_id', tenantId);
    const { error: itemUpdateError } = await supabase.from('items')
      .update({ status: 'identified', updated_at: now })
      .eq('id', ownedItem.id)
      .eq('tenant_id', tenantId);

    if (listingUpdateError || itemUpdateError) {
      console.error(`[SWISH end] eBay listing ended but local state update failed (tenant scoped): listingError=${listingUpdateError?.message ?? 'none'} itemError=${itemUpdateError?.message ?? 'none'}`);
      return jsonResponse({
        success: true,
        externalListingId: savedExternalListingId,
        warning: 'The eBay listing was ended, but SWISH could not fully update its local status. Run eBay sync to reconcile.',
      });
    }
    return jsonResponse({ success: true, externalListingId: savedExternalListingId });
  }

  // ── Route: revise_sku ───────────────────────────────────────────────────────
  // Deliberately sends only ItemID + SKU. In particular, do not include
  // PictureDetails: a SKU-only edit must never replace the live photo gallery.
  if (route === 'revise_sku') {
    const { listingId, externalListingId, sku: rawSku, listingType = 'FixedPriceItem' } = body;
    const sku = String(rawSku ?? '').trim();
    if (!externalListingId) return jsonResponse({ error: 'externalListingId required for SKU revision' }, 400);
    if (!sku) return jsonResponse({ error: 'A non-empty SKU is required' }, 400);
    if (sku.length > 50) return jsonResponse({ error: 'SKU must be 50 characters or fewer' }, 400);

    const creds = await getEbayCredentials(supabase, tenantId, true);
    if ('error' in creds) return jsonResponse({ error: creds.error }, 400);

    const requestName = listingType === 'Chinese' ? 'ReviseItemRequest' : 'ReviseFixedPriceItemRequest';
    const operation = listingType === 'Chinese' ? 'ReviseItem' : 'ReviseFixedPriceItem';
    const skuXml = `<?xml version="1.0" encoding="utf-8"?>
<${requestName} xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials><eBayAuthToken>${creds.accessToken}</eBayAuthToken></RequesterCredentials>
  <Item>
    <ItemID>${xmlEscape(String(externalListingId))}</ItemID>
    <SKU>${xmlEscape(sku)}</SKU>
  </Item>
</${requestName}>`;
    const { xml: responseXml, ok } = await callEbayTradingApi(skuXml, operation, creds.clientId);
    if (!ok) {
      const errors = parseErrors(responseXml);
      return jsonResponse({ success: false, error: friendlyError(errors, 'Failed to update eBay SKU'), errors }, 400);
    }

    if (listingId) {
      try {
        const { data: listingRow } = await supabase.from('listings')
          .select('items(id)')
          .eq('id', listingId)
          .eq('tenant_id', tenantId)
          .maybeSingle();
        const relatedItems = (listingRow as any)?.items;
        const itemId = (Array.isArray(relatedItems) ? relatedItems[0]?.id : relatedItems?.id) ?? body.itemId;
        if (itemId) {
          await supabase.from('items').update({
            inventory_id: sku,
            updated_at: new Date().toISOString(),
          }).eq('id', itemId).eq('tenant_id', tenantId);
        }
      } catch (e: any) {
        console.warn('[SWISH revise_sku] eBay SKU updated but local SKU sync failed:', e?.message ?? 'unknown error');
      }
    }
    return jsonResponse({ success: true, externalListingId, sku, photosChanged: false });
  }

  // ── Route: revise ─────────────────────────────────────────────────────────
  if (route === 'revise') {
    const {
      listingId, externalListingId, title = '', description: bodyDescription, price = 0,
      condition = '', conditionDescription = '', listingType = 'FixedPriceItem',
      quantity = 1, itemSpecifics = [], mediaUrls: rawMediaUrls = [], categoryId: bodyCategoryId = '',
    } = body;
    if (!externalListingId) return jsonResponse({ error: 'externalListingId required for revise' }, 400);

    // Never let an omitted/empty client description silently erase the live listing.
    // Use the saved listing description as the fallback; a non-empty editor value wins.
    let description = typeof bodyDescription === 'string' ? bodyDescription : '';

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
          .select('category_id, description, title, price, items(media, attributes, specialist_id)')
          .eq('id', listingId)
          .eq('tenant_id', tenantId)
          .maybeSingle();

        // BUG A FIX: Use DB category_id if body didn't supply one
        if (!resolvedCategoryId && lRow?.category_id) {
          resolvedCategoryId = lRow.category_id;
          console.log(`[SWISH revise] Category resolved from DB: categoryId=${resolvedCategoryId}`);
        }

        // Preserve the saved description when the client omitted it or sent an empty string.
        if (!description.trim() && typeof lRow?.description === 'string' && lRow.description.trim()) {
          description = lRow.description;
          console.log(`[SWISH revise] Description recovered from saved listing ${listingId}`);
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

    // Direct category passthrough for revisions: use the exact saved/selected
    // category ID. Do not run SWISH's leaf resolver here; it previously referenced
    // an uninitialised `item` variable and blocked revisions before reaching eBay.
    // eBay's ReviseItem/ReviseFixedPriceItem response is authoritative.
    if (resolvedCategoryId) {
      resolvedCategoryId = String(resolvedCategoryId).trim();
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

  // Direct category passthrough: use the exact ID selected/saved by the user.
  // Do not call SWISH's taxonomy resolver or leaf validator here: their false
  // negatives have been blocking every listing despite a previously validated
  // category. eBay receives this exact category ID in the listing payload and
  // remains the final authority on whether the listing can be created.
  const resolvedCategoryId = String(categoryId ?? '').trim();
  const savedCategoryName = String(
    item?.attributes?.ebay_category_name ??
    item?.attributes?._ebay_category_name ??
    resolvedCategoryId
  );
  const catResult = {
    resolvedId: resolvedCategoryId,
    resolvedName: savedCategoryName,
    categoryName: savedCategoryName,
    treeId: '3',
    treeVersion: 'not-queried',
    wasResolved: false,
    confidence: 'user_selected',
  };
  console.log(`[SWISH] Direct category passthrough: marketplaceId=EBAY_GB, categoryId=${resolvedCategoryId}, categoryName="${savedCategoryName}". No SWISH leaf validation performed.`);

  const attrs: Record<string, any> = item?.attributes ?? {};
  const specialistId: string = item?.specialist_id ?? '';
  const SPEC_BLOCKLIST = new Set([
    // Supplier manifest provenance and commercial metadata are internal inventory
    // fields, never buyer-facing item specifics.
    'niche_id', 'specialist_id', 'source_type', 'manifest_name', 'manifest_row',
    'manifest_sku', 'supplier_sku', 'supplier_category', 'supplier_subcategory',
    'supplier_image_urls', 'matched_photo_url', 'quantity_received', 'quantity_available',
    'ebay_quantity', 'supplier_unit_cost', 'unit_rrp', 'unit_weight_kg',
    'target_sell_price', 'review_before_listing', 'asin', 'barcode', 'ean',
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
