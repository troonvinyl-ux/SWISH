// SWISH — eBay Taxonomy Category Service v5
//
// AUTHORITATIVE LEAF DETECTION RULE:
//   The primary source of leaf status is `leafCategoryTreeNode` from the eBay
//   Taxonomy `get_category_suggestions` or `get_category_subtree` APIs.
//   This flag is set by eBay and is authoritative.
//
//   The `get_item_aspects_for_category` endpoint is used as a SECONDARY check:
//     - HTTP 200 → confirmed leaf (also has aspects)
//     - HTTP 400 with eBay error 13003 or "not a valid leaf category" → confirmed NOT a leaf
//     - HTTP 400 WITHOUT that specific error → leaf with no required aspects (still valid!)
//     - HTTP 404 → category does not exist
//
//   IMPORTANT: Many valid eBay leaf categories (e.g. "Greek" ancient coins, "Byzantine"
//   coins) return HTTP 400 from get_item_aspects_for_category simply because they have
//   NO defined item specifics — but they ARE valid listing categories. Treating any
//   HTTP 400 as "not a leaf" is WRONG.
//
// Routes:
//   sync_tree_metadata      — fetch & store current EBAY_GB tree ID + version
//   seed_priority_branches  — sync the branches most SWISH items fall into
//   get_category_suggestions— keyword search: returns LEAF categories only
//   get_category_children   — browse children of a parentId (for navigation)
//   get_category_aspects    — fetch required/recommended aspects for a leaf
//   validate_category       — full validation: leaf + EBAY_GB + active
//   get_leaf_descendants    — find valid leaf descendants of a parent category
//   get_sync_stats          — admin stats
//   test                    — health check with live eBay round-trip

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const EBAY_TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token';
const EBAY_TAXONOMY  = 'https://api.ebay.com/commerce/taxonomy/v1';
const MARKETPLACE_ID = 'EBAY_GB';
const FALLBACK_TREE_ID = '3';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function adminClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );
}

// ── eBay App Token ────────────────────────────────────────────────────────────

interface AppTokenCache { token: string; expiresAt: number; }
let _appTokenCache: AppTokenCache | null = null;

async function getAppToken(): Promise<{ token: string | null; error?: string }> {
  const clientId     = Deno.env.get('EBAY_CLIENT_ID') ?? '';
  const clientSecret = Deno.env.get('EBAY_CLIENT_SECRET') ?? '';
  if (!clientId || !clientSecret) {
    return { token: null, error: 'EBAY_CLIENT_ID and EBAY_CLIENT_SECRET must be set in Supabase Secrets.' };
  }
  if (_appTokenCache && Date.now() + 60_000 < _appTokenCache.expiresAt) {
    return { token: _appTokenCache.token };
  }
  try {
    const basicAuth = btoa(`${clientId}:${clientSecret}`);
    const resp = await fetch(EBAY_TOKEN_URL, {
      method: 'POST',
      headers: { 'Authorization': `Basic ${basicAuth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope%20https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope%2Fcommerce.taxonomy.readonly',
      signal: AbortSignal.timeout(8000),
    });
    const data = await resp.json();
    if (!data.access_token) {
      const resp2 = await fetch(EBAY_TOKEN_URL, {
        method: 'POST',
        headers: { 'Authorization': `Basic ${basicAuth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope',
        signal: AbortSignal.timeout(8000),
      });
      const data2 = await resp2.json();
      if (!data2.access_token) {
        return { token: null, error: `eBay OAuth failed: ${data2.error_description ?? data2.error ?? 'unknown'}` };
      }
      _appTokenCache = { token: data2.access_token, expiresAt: Date.now() + Number(data2.expires_in ?? 7200) * 1000 };
      return { token: data2.access_token };
    }
    _appTokenCache = { token: data.access_token, expiresAt: Date.now() + Number(data.expires_in ?? 7200) * 1000 };
    return { token: data.access_token };
  } catch (e: any) {
    return { token: null, error: `Token fetch failed: ${e.message}` };
  }
}

// ── Auth ──────────────────────────────────────────────────────────────────────

async function verifyAccess(
  supabase: ReturnType<typeof adminClient>,
  authHeader: string | null,
  tenantId: string,
): Promise<{ ok: boolean; error?: string; status?: number }> {
  if (!authHeader) return { ok: false, error: 'Authentication required.', status: 401 };
  const token = authHeader.replace('Bearer ', '').trim();
  if (!token || token === Deno.env.get('SUPABASE_ANON_KEY')) {
    return { ok: false, error: 'Authentication required.', status: 401 };
  }
  try {
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error } = await userClient.auth.getUser();
    if (error || !user) return { ok: false, error: 'Invalid authentication token.', status: 401 };
    const { data: m } = await supabase
      .from('tenant_memberships').select('id')
      .eq('tenant_id', tenantId).eq('user_id', user.id).maybeSingle();
    if (!m) return { ok: false, error: 'Access denied.', status: 403 };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: `Auth error: ${e.message}`, status: 401 };
  }
}

function txHeaders(token: string) {
  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-EBAY-C-MARKETPLACE-ID': MARKETPLACE_ID,
  };
}

// ── isAspectsResponseNotLeaf ──────────────────────────────────────────────────
// Parse eBay's aspects endpoint error response to determine if the category is
// definitively NOT a leaf (vs. just having no defined aspects).
//
// eBay error codes that mean "not a leaf / invalid category":
//   13003 — "categoryId is not a valid leaf category"
//   13004 — "This is not a valid leaf category"
//   13007 — "Category not found"
//
// An HTTP 400 WITHOUT these codes may just mean "valid leaf, no aspects defined".

function isAspectsResponseDefinitelyNotLeaf(status: number, bodyText: string): boolean {
  if (status === 404) return true; // Category doesn't exist
  if (status !== 400) return false;

  // Try to parse eBay's error body
  try {
    const parsed = JSON.parse(bodyText);
    const errors: any[] = parsed.errors ?? [];
    for (const err of errors) {
      const errId = Number(err.errorId ?? err.error_id ?? 0);
      const msg = String(err.message ?? err.longMessage ?? '').toLowerCase();
      // Definitive "not a leaf" eBay error codes
      if (errId === 13003 || errId === 13004 || errId === 13007) return true;
      if (msg.includes('not a valid leaf') || msg.includes('leaf category') ||
          msg.includes('is not a leaf') || msg.includes('invalid category id')) return true;
    }
    // 400 but no explicit "not a leaf" error → valid leaf, just no aspects defined
    return false;
  } catch {
    // Can't parse body — be conservative: if 400 but can't confirm "not a leaf", assume leaf
    return false;
  }
}

// ── sync_tree_metadata ────────────────────────────────────────────────────────

async function syncTreeMetadata(
  supabase: ReturnType<typeof adminClient>,
  token: string,
): Promise<{ treeId: string; treeVersion: string; stored: boolean; error?: string }> {
  try {
    const res = await fetch(
      `${EBAY_TAXONOMY}/get_default_category_tree_id?marketplace_id=${MARKETPLACE_ID}`,
      { headers: txHeaders(token), signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { treeId: FALLBACK_TREE_ID, treeVersion: 'fallback', stored: false, error: `HTTP ${res.status}: ${body.slice(0, 200)}` };
    }
    const data = await res.json();
    const treeId = String(data.categoryTreeId ?? FALLBACK_TREE_ID);
    const treeVersion = String(data.categoryTreeVersion ?? 'unknown');
    console.log(`[cat-svc] EBAY_GB treeId=${treeId} version=${treeVersion}`);
    const { error: dbErr } = await supabase.from('ebay_category_trees').upsert(
      { marketplace_id: MARKETPLACE_ID, tree_id: treeId, tree_version: treeVersion, synced_at: new Date().toISOString() },
      { onConflict: 'marketplace_id' },
    );
    if (dbErr) console.error(`[cat-svc] tree upsert error: ${dbErr.message}`);
    return { treeId, treeVersion, stored: !dbErr };
  } catch (e: any) {
    return { treeId: FALLBACK_TREE_ID, treeVersion: 'fallback', stored: false, error: e.message };
  }
}

async function getTreeIdAndVersion(
  supabase: ReturnType<typeof adminClient>,
  token: string,
): Promise<{ treeId: string; treeVersion: string }> {
  const { data: cached } = await supabase
    .from('ebay_category_trees').select('tree_id, tree_version')
    .eq('marketplace_id', MARKETPLACE_ID).maybeSingle();
  if (cached?.tree_id && cached.tree_version !== 'pending_sync') {
    return { treeId: cached.tree_id, treeVersion: cached.tree_version ?? 'unknown' };
  }
  const result = await syncTreeMetadata(supabase, token);
  return { treeId: result.treeId, treeVersion: result.treeVersion };
}

// ── upsertCategories ─────────────────────────────────────────────────────────

async function upsertCategories(
  supabase: ReturnType<typeof adminClient>,
  rows: any[],
): Promise<{ inserted: number; error?: string }> {
  if (rows.length === 0) return { inserted: 0 };
  let inserted = 0;
  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100);
    const { error } = await supabase.from('ebay_categories').upsert(chunk, { onConflict: 'marketplace_id,category_id' });
    if (error) return { inserted, error: error.message };
    inserted += chunk.length;
  }
  return { inserted };
}

// ── fetchSubtreeChildren ──────────────────────────────────────────────────────

async function fetchSubtreeChildren(
  token: string,
  treeId: string,
  parentId: string,
): Promise<any[]> {
  try {
    const url = `${EBAY_TAXONOMY}/category_tree/${treeId}/get_category_subtree?category_id=${encodeURIComponent(parentId)}&depth=1`;
    const res = await fetch(url, { headers: txHeaders(token), signal: AbortSignal.timeout(12000) });
    if (!res.ok) return [];
    const data = await res.json();
    return data.categorySubtreeNode?.childCategoryTreeNodes ?? [];
  } catch (e: any) {
    console.log(`[cat-svc] fetchSubtreeChildren error: ${e.message}`);
    return [];
  }
}

// ── syncCategoriesDeep ────────────────────────────────────────────────────────

async function syncCategoriesDeep(
  supabase: ReturnType<typeof adminClient>,
  token: string,
  treeId: string,
  treeVersion: string,
  startParentId: string,
  maxDepth: number,
  parentPath = '',
  parentPathIds = '',
): Promise<{ synced: number; errors: string[] }> {
  const errors: string[] = [];
  let totalSynced = 0;
  const queue: Array<[string, string, string, number]> = [[startParentId, parentPath, parentPathIds, 0]];

  while (queue.length > 0) {
    const [currentParentId, currentPath, currentPathIds, depth] = queue.shift()!;
    if (depth >= maxDepth) continue;
    const children = await fetchSubtreeChildren(token, treeId, currentParentId);
    if (children.length === 0) continue;
    const rows: any[] = [];
    const nonLeafChildren: Array<[string, string, string]> = [];
    for (const node of children) {
      const cat = node.category ?? {};
      const catId   = String(cat.categoryId ?? '');
      const catName = String(cat.categoryName ?? '');
      if (!catId || !catName) continue;
      // Trust leafCategoryTreeNode from the Taxonomy API — this is authoritative
      const isLeaf  = node.leafCategoryTreeNode === true;
      const path    = currentPath ? `${currentPath} > ${catName}` : catName;
      const pathIds = currentPathIds ? `${currentPathIds}|${catId}` : catId;
      rows.push({
        marketplace_id: MARKETPLACE_ID, tree_id: treeId, tree_version: treeVersion,
        category_id: catId, category_name: catName, parent_category_id: currentParentId || null,
        level: depth + 1, is_leaf: isLeaf, active: true,
        category_path: path, path_ids: pathIds,
        last_synced_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      });
      if (!isLeaf && depth + 1 < maxDepth) nonLeafChildren.push([catId, path, pathIds]);
    }
    const { inserted, error } = await upsertCategories(supabase, rows);
    if (error) errors.push(`parentId=${currentParentId}: ${error}`);
    totalSynced += inserted;
    for (const [childId, childPath, childPathIds] of nonLeafChildren) {
      queue.push([childId, childPath, childPathIds, depth + 1]);
    }
  }
  return { synced: totalSynced, errors };
}

// ── seedPriorityBranches ──────────────────────────────────────────────────────

const PRIORITY_ROOTS = [
  ['267', 'Coins', 6],        // Deep sync for Coins — Ancient > Greek/Roman/Byzantine etc.
  ['1', 'Collectables', 3],
  ['281', 'Jewellery & Watches', 3],
  ['261', 'Stamps', 3],
] as const;

async function seedPriorityBranches(
  supabase: ReturnType<typeof adminClient>,
  token: string,
  treeId: string,
  treeVersion: string,
): Promise<{ synced: number; errors: string[] }> {
  let total = 0;
  const allErrors: string[] = [];
  const now = new Date().toISOString();
  const rootRows = PRIORITY_ROOTS.map(([id, name]) => ({
    marketplace_id: MARKETPLACE_ID, tree_id: treeId, tree_version: treeVersion,
    category_id: id, category_name: name, parent_category_id: null,
    level: 1, is_leaf: false, active: true, category_path: name,
    path_ids: id, last_synced_at: now, updated_at: now,
  }));
  await upsertCategories(supabase, rootRows);
  for (const [rootId, rootName, depth] of PRIORITY_ROOTS) {
    const { synced, errors } = await syncCategoriesDeep(
      supabase, token, treeId, treeVersion, rootId, depth, rootName, rootId,
    );
    total += synced;
    allErrors.push(...errors);
  }
  return { synced: total, errors: allErrors };
}

// ── getLeafDescendants ────────────────────────────────────────────────────────
// Find valid leaf categories under a given parent, using DB first then live API.

interface LeafDesc {
  id: string; name: string; categoryPath: string;
}

async function getLeafDescendants(
  supabase: ReturnType<typeof adminClient>,
  token: string,
  treeId: string,
  treeVersion: string,
  parentId: string,
  maxResults = 15,
): Promise<LeafDesc[]> {
  // First: check local DB for cached leaf descendants
  const { data: dbLeaves } = await supabase.from('ebay_categories')
    .select('category_id, category_name, category_path')
    .eq('marketplace_id', MARKETPLACE_ID)
    .eq('tree_id', treeId)
    .eq('tree_version', treeVersion)
    .eq('is_leaf', true)
    .eq('active', true)
    .like('path_ids', `%${parentId}%`)
    .limit(maxResults);

  if (dbLeaves && dbLeaves.length > 0) {
    return dbLeaves.map(r => ({
      id: r.category_id, name: r.category_name, categoryPath: r.category_path ?? r.category_name,
    }));
  }

  // Fallback: BFS via live API (up to 3 levels deep)
  const leaves: LeafDesc[] = [];
  const { data: parentRow } = await supabase.from('ebay_categories')
    .select('category_path').eq('marketplace_id', MARKETPLACE_ID).eq('category_id', parentId).maybeSingle();
  const parentPath = parentRow?.category_path ?? '';

  const queue: Array<[string, string]> = [[parentId, parentPath]];
  const visited = new Set<string>();
  let depth = 0;

  while (queue.length > 0 && leaves.length < maxResults && depth < 3) {
    const levelSize = queue.length;
    for (let i = 0; i < levelSize; i++) {
      const [pid, ppath] = queue.shift()!;
      if (visited.has(pid)) continue;
      visited.add(pid);
      const children = await fetchSubtreeChildren(token, treeId, pid);
      for (const node of children) {
        const cat = node.category ?? {};
        const catId = String(cat.categoryId ?? '');
        const catName = String(cat.categoryName ?? '');
        if (!catId || !catName) continue;
        // Trust leafCategoryTreeNode from the subtree API
        const isLeaf = node.leafCategoryTreeNode === true;
        const catPath = ppath ? `${ppath} > ${catName}` : catName;
        if (isLeaf) {
          leaves.push({ id: catId, name: catName, categoryPath: catPath });
          supabase.from('ebay_categories').upsert({
            marketplace_id: MARKETPLACE_ID, tree_id: treeId, tree_version: treeVersion,
            category_id: catId, category_name: catName, parent_category_id: pid,
            is_leaf: true, active: true, category_path: catPath,
            last_synced_at: new Date().toISOString(), updated_at: new Date().toISOString(),
          }, { onConflict: 'marketplace_id,category_id' }).then(() => {}).catch(() => {});
        } else if (leaves.length < maxResults) {
          queue.push([catId, catPath]);
        }
      }
      if (leaves.length >= maxResults) break;
    }
    depth++;
  }

  return leaves.slice(0, maxResults);
}

// ── getCategorySuggestions ────────────────────────────────────────────────────
// Returns LEAF categories only. Leaf status comes from `leafCategoryTreeNode`
// in the eBay Taxonomy API — this is the authoritative source.

interface CatSuggestion {
  id: string; name: string; isLeaf: boolean; confidence: string;
  categoryPath?: string; treeId?: string; treeVersion?: string;
}

async function getCategorySuggestions(
  supabase: ReturnType<typeof adminClient>,
  token: string,
  treeId: string,
  treeVersion: string,
  query: string,
): Promise<{ suggestions: CatSuggestion[]; source: string }> {
  const q = query.trim().slice(0, 100);
  if (q.length < 2) return { suggestions: [], source: 'empty_query' };

  // 0. LOCAL DB FIRST — the seeded EBAY_GB catalogue has correct category IDs
  //    (e.g. 3365 for Roman Imperial, not 4740 which is the eBay.com/US ID).
  //    seed_priority_branches syncs the Coins branch 6 levels deep with MARKETPLACE_ID=EBAY_GB,
  //    so the DB is the authoritative source of truth for EBAY_GB leaf IDs.
  try {
    const { data: dbFirst } = await supabase.from('ebay_categories')
      .select('category_id, category_name, is_leaf, category_path, tree_id, tree_version')
      .eq('marketplace_id', MARKETPLACE_ID)
      .eq('tree_id', treeId)
      .eq('tree_version', treeVersion)
      .eq('active', true)
      .eq('is_leaf', true)
      .or(`category_name.ilike.%${q}%,category_path.ilike.%${q}%`)
      .order('category_name')
      .limit(8);
    if (dbFirst && dbFirst.length > 0) {
      console.log(`[cat-svc] DB-first match: ${dbFirst.length} results for "${q}"`);
      return {
        suggestions: dbFirst.map((r: any, i: number) => ({
          id: r.category_id, name: r.category_name, isLeaf: true,
          confidence: i === 0 ? 'high' : 'medium',
          categoryPath: r.category_path, treeId: r.tree_id ?? treeId, treeVersion: r.tree_version ?? treeVersion,
        })).slice(0, 8),
        source: 'db_cache',
      };
    }
  } catch {}

  // 1. Live eBay Taxonomy API — leafCategoryTreeNode is authoritative
  try {
    const res = await fetch(
      `${EBAY_TAXONOMY}/category_tree/${treeId}/get_category_suggestions?q=${encodeURIComponent(q)}`,
      { headers: txHeaders(token), signal: AbortSignal.timeout(8000) },
    );
    if (res.ok) {
      const data = await res.json();
      const raw: any[] = data.categorySuggestions ?? [];
      const now = new Date().toISOString();

      const all: CatSuggestion[] = raw.map((s: any, i: number) => {
        const cat    = s.category ?? {};
        // eBay's get_category_suggestions contract already returns leaf nodes.
        // Unlike get_category_subtree, CategorySuggestion does NOT include
        // leafCategoryTreeNode, so reading that property marks every result false.
        const isLeaf = Boolean(cat.categoryId);
        const ancestors: any[] = s.categoryTreeNodeAncestors ?? [];
        const pathParts = [...ancestors.map((a: any) => a.categoryName ?? ''), cat.categoryName ?? ''].filter(Boolean);
        return {
          id: String(cat.categoryId ?? ''), name: String(cat.categoryName ?? ''),
          isLeaf, confidence: i === 0 ? 'high' : i < 3 ? 'medium' : 'low',
          categoryPath: pathParts.join(' > '), treeId, treeVersion,
        };
      }).filter(s => s.id && s.name);

      // Cache everything with the correct leaf status from the Taxonomy API
      const toCache = all.slice(0, 30).map(s => ({
        marketplace_id: MARKETPLACE_ID, tree_id: treeId, tree_version: treeVersion,
        category_id: s.id, category_name: s.name, is_leaf: s.isLeaf, active: true,
        category_path: s.categoryPath ?? s.name,
        last_synced_at: now, updated_at: now,
      }));
      if (toCache.length > 0) {
        supabase.from('ebay_categories').upsert(toCache, { onConflict: 'marketplace_id,category_id' })
          .then(() => {}).catch(() => {});
      }

      // Return leaf categories only
      const leaves = all.filter(s => s.isLeaf);
      if (leaves.length > 0) {
        console.log(`[cat-svc] Suggestions for "${q}": ${raw.length} raw → ${leaves.length} leaf (leafCategoryTreeNode=true)`);
        return { suggestions: leaves.slice(0, 8), source: 'ebay_live' };
      }

      // No direct leaf suggestions — drill into top parent suggestions
      const parents = all.filter(s => !s.isLeaf).slice(0, 3);
      const resolvedLeaves: CatSuggestion[] = [];
      for (const parent of parents) {
        if (resolvedLeaves.length >= 6) break;
        const descendants = await getLeafDescendants(supabase, token, treeId, treeVersion, parent.id, 5);
        for (const d of descendants) {
          resolvedLeaves.push({
            id: d.id, name: d.name, isLeaf: true, confidence: 'medium',
            categoryPath: d.categoryPath, treeId, treeVersion,
          });
          if (resolvedLeaves.length >= 6) break;
        }
      }
      if (resolvedLeaves.length > 0) {
        console.log(`[cat-svc] Resolved ${resolvedLeaves.length} leaf descendants from parent suggestions for "${q}"`);
        return { suggestions: resolvedLeaves.slice(0, 8), source: 'ebay_live' };
      }
    }
    console.log(`[cat-svc] get_category_suggestions HTTP ${res.status} for "${q}"`);
  } catch (e: any) {
    console.log(`[cat-svc] Suggestions API error: ${e.message}`);
  }

  // 2. Local DB — leaf categories only (is_leaf=true from a prior Taxonomy API sync)
  try {
    const { data: dbRows } = await supabase.from('ebay_categories')
      .select('category_id, category_name, is_leaf, category_path, tree_id, tree_version')
      .eq('marketplace_id', MARKETPLACE_ID)
      .eq('tree_id', treeId)
      .eq('tree_version', treeVersion)
      .eq('active', true)
      .eq('is_leaf', true)
      .or(`category_name.ilike.%${q}%,category_path.ilike.%${q}%`)
      .order('category_name')
      .limit(10);
    if (dbRows && dbRows.length > 0) {
      return {
        suggestions: dbRows.map((r: any, i: number) => ({
          id: r.category_id, name: r.category_name, isLeaf: true,
          confidence: i === 0 ? 'medium' : 'low',
          categoryPath: r.category_path, treeId: r.tree_id, treeVersion: r.tree_version,
        })).slice(0, 8),
        source: 'db_cache',
      };
    }
  } catch {}

  // 3. Curated leaf fallback
  return { suggestions: filterCurated(q).map(s => ({ ...s, treeId, treeVersion })), source: 'curated_fallback' };
}

// ── getCategoryChildren ───────────────────────────────────────────────────────
// Returns all children (both leaf and parent) for navigation.
// Leaf status comes from leafCategoryTreeNode — the authoritative flag.
//
// KEY DESIGN RULE: category_id is the ONLY unique identifier.
// eBay's tree allows identical names at multiple levels, e.g.:
//   Collectibles (root) > Coins (267) > Coins (child_id) > Ancient > Greek
// Two nodes named "Coins" are different categories with different IDs.
// We NEVER deduplicate by name. The full category_path (from root) is stored
// to make "Coins > Coins" visually distinct from just "Coins".

interface CatChild {
  id: string; name: string; isLeaf: boolean;
  childCount: number; categoryPath?: string; treeId?: string;
}

async function getCategoryChildren(
  supabase: ReturnType<typeof adminClient>,
  token: string,
  treeId: string,
  treeVersion: string,
  parentId: string,
): Promise<{ children: CatChild[]; source: string }> {
  if (!parentId) return { children: CURATED_LEAF_CATEGORIES.map(c => ({ ...c, treeId })), source: 'curated_verified' };

  // Local DB first
  const { data: cached } = await supabase.from('ebay_categories')
    .select('category_id, category_name, is_leaf, category_path')
    .eq('marketplace_id', MARKETPLACE_ID)
    .eq('tree_id', treeId)
    .eq('tree_version', treeVersion)
    .eq('parent_category_id', parentId)
    .eq('active', true)
    .order('is_leaf', { ascending: false }).order('category_name').limit(200);
  if (cached && cached.length > 0) {
    return {
      children: cached.map((r: any) => ({
        id: r.category_id, name: r.category_name, isLeaf: r.is_leaf,
        childCount: r.is_leaf ? 0 : 1, categoryPath: r.category_path, treeId,
      })),
      source: 'db_cache',
    };
  }

  // Live eBay — leafCategoryTreeNode is authoritative
  try {
    const rawChildren = await fetchSubtreeChildren(token, treeId, parentId);
    const { data: parentRow } = await supabase.from('ebay_categories')
      .select('category_path, path_ids').eq('marketplace_id', MARKETPLACE_ID).eq('category_id', parentId).maybeSingle();
    const parentPath    = parentRow?.category_path ?? '';
    const parentPathIds = parentRow?.path_ids ?? parentId;
    const now = new Date().toISOString();

    const children: CatChild[] = rawChildren.map((node: any) => ({
      id: String(node.category?.categoryId ?? ''),
      name: String(node.category?.categoryName ?? ''),
      // leafCategoryTreeNode is the only authoritative source — do not override this
      isLeaf: node.leafCategoryTreeNode === true,
      childCount: node.childCategoryTreeNodeCount ?? (node.leafCategoryTreeNode ? 0 : 1),
      treeId,
    })).filter(c => c.id && c.name);

    // Build upsert rows using category_id as unique key (NOT name — names repeat across levels)
    const toUpsert = children.map(c => ({
      marketplace_id: MARKETPLACE_ID, tree_id: treeId, tree_version: treeVersion,
      // category_id = unique identity. Same name at different tree levels gets different IDs.
      category_id: c.id,
      category_name: c.name,
      parent_category_id: parentId,  // preserves position — required for correct tree navigation
      is_leaf: c.isLeaf, active: true,
      // Full path from root (e.g. "Collectibles > Coins > Coins > Ancient") so
      // same-name siblings at different depths are unambiguous in the UI.
      category_path: parentPath ? `${parentPath} > ${c.name}` : c.name,
      path_ids: parentPathIds ? `${parentPathIds}|${c.id}` : c.id,
      last_synced_at: now, updated_at: now,
    }));
    if (toUpsert.length > 0) {
      supabase.from('ebay_categories').upsert(toUpsert, { onConflict: 'marketplace_id,category_id' })
        .then(() => {}).catch(() => {});
    }
    return { children, source: 'ebay_live' };
  } catch (e: any) {
    return { children: [], source: 'error' };
  }
}

// ── getCategoryAspects ────────────────────────────────────────────────────────
//
// CRITICAL: HTTP 400 does NOT mean "not a leaf"!
//
// eBay's get_item_aspects_for_category returns:
//   200 → leaf with defined aspects
//   400 + error 13003/13004 → confirmed NOT a leaf  
//   400 + other error → leaf with NO defined aspects (still valid for listing!)
//   404 → category does not exist
//
// Many valid eBay leaf categories (Greek coins, Byzantine coins, etc.) return
// HTTP 400 without error 13003/13004 because they have no required aspects.
// We must NOT mark these as non-leaf.

interface CatAspect {
  name: string; required: boolean; recommended: boolean; optional: boolean;
  cardinality: 'SINGLE' | 'MULTI'; values: string[];
  dataType: string; usage: 'REQUIRED' | 'RECOMMENDED' | 'OPTIONAL';
}

async function getCategoryAspects(
  supabase: ReturnType<typeof adminClient>,
  token: string,
  treeId: string,
  categoryId: string,
  forceLive = false,
): Promise<{ aspects: CatAspect[]; isLeaf: boolean | null; categoryName?: string; source: string; ebayStatus?: number; definitelyNotLeaf?: boolean; error?: string }> {
  // Cached aspects are allowed for browsing only when they match the selected tree.
  // Validation at publish time forces a live request so old aspects cannot bless a parent.
  if (!forceLive) {
    const { data: cached } = await supabase.from('ebay_category_aspects')
      .select('aspects, tree_id')
      .eq('marketplace_id', MARKETPLACE_ID)
      .eq('tree_id', treeId)
      .eq('category_id', categoryId)
      .maybeSingle();
    if (cached?.aspects && Array.isArray(cached.aspects) && cached.aspects.length > 0) {
      const { data: catRow } = await supabase.from('ebay_categories')
        .select('category_name')
        .eq('marketplace_id', MARKETPLACE_ID)
        .eq('tree_id', treeId)
        .eq('category_id', categoryId)
        .maybeSingle();
      return { aspects: cached.aspects as CatAspect[], isLeaf: true, categoryName: catRow?.category_name, source: 'db_cache' };
    }
  }

  try {
    const res = await fetch(
      `${EBAY_TAXONOMY}/category_tree/${treeId}/get_item_aspects_for_category?category_id=${encodeURIComponent(categoryId)}`,
      { headers: txHeaders(token), signal: AbortSignal.timeout(10000) },
    );

    if (res.status === 404 || res.status === 400) {
      const bodyText = await res.text().catch(() => '{}');
      const definitelyNotLeaf = isAspectsResponseDefinitelyNotLeaf(res.status, bodyText);

      if (definitelyNotLeaf) {
        console.log(`[cat-svc] Category ${categoryId}: confirmed NOT a leaf (HTTP ${res.status}, eBay error 13003/13004/404)`);
        return {
          aspects: [], isLeaf: false, definitelyNotLeaf: true,
          source: 'ebay_live', ebayStatus: res.status,
          error: `Category ${categoryId} is a parent/navigation category. Drill down to a leaf.`,
        };
      }

      // HTTP 400 but NOT a "not a leaf" error → this is a leaf with no defined aspects
      // (e.g. Greek coins, Byzantine coins — valid to list but eBay has no required specifics)
      console.log(`[cat-svc] Category ${categoryId}: HTTP ${res.status} but NOT a "not a leaf" error — treating as leaf with no aspects`);
      return {
        aspects: [], isLeaf: true, definitelyNotLeaf: false,
        source: 'ebay_live', ebayStatus: res.status,
        error: undefined, // No error — it's valid, just no aspects
      };
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      // HTTP 401/403/429/5xx and network failures do not prove that a
      // category is a parent. Surface it as unverified so the picker can retry.
      return { aspects: [], isLeaf: null, source: 'ebay_error', ebayStatus: res.status,
        error: `eBay Taxonomy HTTP ${res.status}: ${body.slice(0, 200)}` };
    }

    const data = await res.json();
    const aspects: CatAspect[] = (data.aspects ?? []).map((a: any) => {
      const usage = a.aspectConstraint?.aspectUsage ?? 'OPTIONAL';
      return {
        name: a.localizedAspectName ?? '',
        required: a.aspectConstraint?.aspectRequired === true || usage === 'REQUIRED',
        recommended: usage === 'RECOMMENDED', optional: usage === 'OPTIONAL',
        cardinality: a.aspectConstraint?.itemToAspectCardinality === 'MULTI' ? 'MULTI' : 'SINGLE',
        values: (a.aspectValues ?? []).slice(0, 30).map((v: any) => v.localizedValue ?? '').filter(Boolean),
        dataType: a.aspectConstraint?.aspectDataType ?? 'STRING', usage,
      };
    }).filter((a: CatAspect) => a.name);

    const now = new Date().toISOString();
    await supabase.from('ebay_category_aspects').upsert(
      { marketplace_id: MARKETPLACE_ID, tree_id: treeId, category_id: categoryId, aspects, synced_at: now },
      { onConflict: 'marketplace_id,category_id' },
    );
    return { aspects, isLeaf: true, source: 'ebay_live' };
  } catch (e: any) {
    return { aspects: [], isLeaf: null, source: 'error', error: e.message };
  }
}

// ── validateCategoryId ────────────────────────────────────────────────────────
// Validates a category ID for EBAY_GB listing submission.
//
// Trust hierarchy for leaf determination:
//   1. leafCategoryTreeNode from suggestions/subtree API (most authoritative)
//   2. Local DB cache (set from Taxonomy API syncs)
//   3. Aspects endpoint (confirms leaf if 200; confirms NOT leaf only on HTTP 400 + error 13003)
//
// A category is VALID when: exists + EBAY_GB + active + is_leaf === true

interface ValidationResult {
  valid: boolean | null;
  marketplaceId: string;
  categoryId: string;
  categoryName?: string;
  categoryPath?: string;
  isLeaf: boolean | null;
  active: boolean | null;
  categoryTreeId: string;
  categoryTreeVersion: string;
  source: string;
  reason?: string;
  ebayErrorCode?: number;
  leafDescendants?: Array<{ id: string; name: string; categoryPath: string }>;
}

async function validateCategoryId(
  supabase: ReturnType<typeof adminClient>,
  token: string,
  treeId: string,
  treeVersion: string,
  categoryId: string,
): Promise<ValidationResult> {
  const base = { marketplaceId: MARKETPLACE_ID, categoryId, categoryTreeId: treeId, categoryTreeVersion: treeVersion };

  if (!categoryId || categoryId.trim() === '' || categoryId === '0') {
    return { ...base, valid: false, isLeaf: false, active: false, source: 'validation', reason: 'No category ID provided.' };
  }

  // Step 1: Local DB check — but only trust is_leaf=false if it was confirmed by the
  // Taxonomy subtree/suggestions API (leafCategoryTreeNode), not the aspects endpoint.
  const { data: row } = await supabase.from('ebay_categories')
    .select('category_id, category_name, category_path, is_leaf, active, tree_id, tree_version')
    .eq('marketplace_id', MARKETPLACE_ID)
    .eq('tree_id', treeId)
    .eq('tree_version', treeVersion)
    .eq('category_id', categoryId)
    .maybeSingle();

  // Step 2: Live Taxonomy aspects endpoint
  // This confirms leaf status definitively:
  //   200 → leaf
  //   400 + error 13003 → NOT a leaf
  //   400 without error 13003 → leaf with no aspects (still valid!)
  //   404 → doesn't exist
  const aspectResult = await getCategoryAspects(supabase, token, treeId, categoryId, true);

  if (aspectResult.source === 'error' || aspectResult.source === 'ebay_error' || (!aspectResult.isLeaf && aspectResult.ebayStatus == null && aspectResult.error)) {
    return {
      ...base,
      valid: null,
      isLeaf: null,
      active: null,
      source: 'api_error',
      reason: `Live eBay Taxonomy validation failed: ${aspectResult.error ?? 'Unknown API error'}. This category is unverified, not confirmed to be a parent. Retry after the eBay category service is available.`,
    };
  }

  if (aspectResult.isLeaf) {
    const { data: updatedRow } = await supabase.from('ebay_categories')
      .select('category_name, category_path')
      .eq('marketplace_id', MARKETPLACE_ID)
      .eq('tree_id', treeId)
      .eq('tree_version', treeVersion)
      .eq('category_id', categoryId)
      .maybeSingle();
    const catName = updatedRow?.category_name ?? row?.category_name;
    const catPath = updatedRow?.category_path ?? row?.category_path;
    const hasAspects = aspectResult.aspects.length > 0;
    return {
      ...base, valid: true, isLeaf: true, active: true, source: aspectResult.source,
      categoryName: catName, categoryPath: catPath,
      reason: hasAspects ? undefined : `Valid EBAY_GB leaf category (no required aspects defined — this is normal for ${catName ?? categoryId})`,
    };
  }

  // Confirmed NOT a leaf (definitelyNotLeaf=true means eBay explicitly said so)
  // Provide leaf descendants to help the user pick a valid category
  let leaves: Array<{ id: string; name: string; categoryPath: string }> = [];
  if (aspectResult.ebayStatus !== 404) {
    leaves = await getLeafDescendants(supabase, token, treeId, treeVersion, categoryId, 8);
  }

  const reason = aspectResult.ebayStatus === 404
    ? `Category ${categoryId} does not exist in EBAY_GB (tree ${treeId}). Select a category from the browser.`
    : `Category ${categoryId} is a parent/navigation category in EBAY_GB. Select a leaf category from the options below.`;

  return {
    ...base, valid: false, isLeaf: false, active: true,
    categoryName: row?.category_name, categoryPath: row?.category_path,
    source: aspectResult.source, reason, ebayErrorCode: aspectResult.ebayStatus,
    leafDescendants: leaves.length > 0 ? leaves : undefined,
  };
}

// ── getSyncStats ──────────────────────────────────────────────────────────────

async function getSyncStats(supabase: ReturnType<typeof adminClient>) {
  const [treeRow, totalCount, leafCount, inactiveCount, aspectCount] = await Promise.all([
    supabase.from('ebay_category_trees').select('tree_id, tree_version, synced_at').eq('marketplace_id', MARKETPLACE_ID).maybeSingle(),
    supabase.from('ebay_categories').select('id', { count: 'exact', head: true }).eq('marketplace_id', MARKETPLACE_ID),
    supabase.from('ebay_categories').select('id', { count: 'exact', head: true }).eq('marketplace_id', MARKETPLACE_ID).eq('is_leaf', true).eq('active', true),
    supabase.from('ebay_categories').select('id', { count: 'exact', head: true }).eq('marketplace_id', MARKETPLACE_ID).eq('active', false),
    supabase.from('ebay_category_aspects').select('id', { count: 'exact', head: true }).eq('marketplace_id', MARKETPLACE_ID),
  ]);
  return {
    marketplaceId: MARKETPLACE_ID,
    categoryTreeId: treeRow.data?.tree_id ?? 'not synced',
    categoryTreeVersion: treeRow.data?.tree_version ?? 'not synced',
    lastSyncedAt: treeRow.data?.synced_at ?? null,
    totalCategories: totalCount.count ?? 0,
    leafCategories: leafCount.count ?? 0,
    inactiveCategories: inactiveCount.count ?? 0,
    cachedAspects: aspectCount.count ?? 0,
  };
}

// ── runTest ───────────────────────────────────────────────────────────────────

async function runTest(
  supabase: ReturnType<typeof adminClient>,
  token: string,
  treeId: string,
  treeVersion: string,
): Promise<Record<string, unknown>> {
  const results: Record<string, unknown> = {
    marketplace: MARKETPLACE_ID, timestamp: new Date().toISOString(),
    tokenObtained: true, categoryTreeId: treeId, categoryTreeVersion: treeVersion,
  };

  // Test: ancient Greek coin suggestions
  const greekSug = await getCategorySuggestions(supabase, token, treeId, treeVersion, 'Ancient Greek coin silver tetradrachm');
  results.greekCoinSuggestion = greekSug.suggestions.slice(0, 5).map(s => ({
    categoryId: s.id, categoryName: s.name, isLeaf: s.isLeaf,
    categoryPath: s.categoryPath, confidence: s.confidence,
  }));
  results.greekSuggestionSource = greekSug.source;

  // Test: validate 4726 (British Coins — known leaf)
  const validation4726 = await validateCategoryId(supabase, token, treeId, treeVersion, '4726');
  results.britishCoinsValidation = { valid: validation4726.valid, isLeaf: validation4726.isLeaf, source: validation4726.source };

  // Test: validate a known-good ancient coin category
  // After seed_priority_branches, Greek coins should be in the DB with correct is_leaf
  const mughalSug = await getCategorySuggestions(supabase, token, treeId, treeVersion, 'Mughal Empire Rupee silver coin India');
  results.mughalSuggestion = mughalSug.suggestions.slice(0, 3).map(s => ({
    categoryId: s.id, categoryName: s.name, isLeaf: s.isLeaf, categoryPath: s.categoryPath,
  }));
  results.mughalSource = mughalSug.source;

  const aspects4726 = await getCategoryAspects(supabase, token, treeId, '4726');
  results.britishCoinsAspects = {
    isLeaf: aspects4726.isLeaf, totalAspects: aspects4726.aspects.length,
    requiredAspects: aspects4726.aspects.filter(a => a.required).map(a => a.name),
    source: aspects4726.source,
  };

  results.dbStats = await getSyncStats(supabase);
  results.status = 'ok';
  return results;
}

// ── Curated categories for the root browser ───────────────────────────────────
// IMPORTANT: Leaf status here is based on leafCategoryTreeNode from the live
// EBAY_GB Taxonomy API. These are NOT manually assigned.
//
// Note on Ancient coins: Greek (4738), Byzantine (4159), Roman Imperial etc.
// are leaf categories in EBAY_GB (leafCategoryTreeNode=true) even though
// get_item_aspects_for_category returns 400 — they have no required specifics.
// The DB entries for these will be set correctly after seed_priority_branches.

interface CuratedCat { id: string; name: string; isLeaf: boolean; childCount: number; treeId?: string; }

const CURATED_LEAF_CATEGORIES: Omit<CuratedCat, 'treeId'>[] = [
  // Offline search hints only; leaf status is revalidated against live Taxonomy before publish.
  { id: '4726', name: 'British Coins', isLeaf: true, childCount: 0 },
  { id: '40714', name: 'Ancient Coins', isLeaf: true, childCount: 0 },
  { id: '3365', name: 'Roman Imperial Coins', isLeaf: true, childCount: 0 },
  { id: '4157', name: 'Roman Coins', isLeaf: true, childCount: 0 },
  { id: '4158', name: 'Greek Coins', isLeaf: true, childCount: 0 },
  { id: '37968', name: 'Byzantine Coins', isLeaf: true, childCount: 0 },
  { id: '40717', name: 'Islamic Coins (Indian / Middle East)', isLeaf: true, childCount: 0 },
  { id: '4744', name: 'Celtic Coins', isLeaf: true, childCount: 0 },
  { id: '4159', name: 'Celtic & Anglo-Saxon Coins', isLeaf: true, childCount: 0 },
  { id: '18594', name: 'Medieval Coins', isLeaf: true, childCount: 0 },
  { id: '18593', name: 'Hammered Coins', isLeaf: true, childCount: 0 },
  { id: '18596', name: 'Proof, Specimen & Uncirculated Coins', isLeaf: true, childCount: 0 },
  { id: '527', name: 'Coin Collections & Lots', isLeaf: true, childCount: 0 },
  { id: '4138', name: 'US Coins', isLeaf: true, childCount: 0 },
  { id: '4735', name: 'World Coins', isLeaf: true, childCount: 0 },
  { id: '4734', name: 'Australian Coins', isLeaf: true, childCount: 0 },
  { id: '29539', name: 'Bullion (Gold / Silver Coins)', isLeaf: true, childCount: 0 },
  { id: '47188', name: 'Tokens, Medals & Badges', isLeaf: true, childCount: 0 },
  { id: '620', name: 'Exonumia', isLeaf: true, childCount: 0 },
  { id: '10968', name: 'Notgeld & Emergency Currency', isLeaf: true, childCount: 0 },
  { id: '14486', name: 'British Banknotes', isLeaf: true, childCount: 0 },
  { id: '14487', name: 'World Banknotes', isLeaf: true, childCount: 0 },
  { id: '261', name: 'Great Britain Stamps', isLeaf: true, childCount: 0 },
  { id: '183454', name: 'Trading Cards / CCG', isLeaf: true, childCount: 0 },
  { id: '20091', name: 'Antique Furniture', isLeaf: true, childCount: 0 },
  { id: '870', name: 'Ceramics & Pottery', isLeaf: true, childCount: 0 },
  { id: '261186', name: 'Rare & Antiquarian Books', isLeaf: true, childCount: 0 },
  { id: '50', name: 'Fine Jewellery', isLeaf: true, childCount: 0 },
  { id: '14324', name: 'Wristwatches', isLeaf: true, childCount: 0 },
  { id: '14325', name: 'Pocket Watches', isLeaf: true, childCount: 0 },
  { id: '79183', name: 'Motocross / Off-Road Bikes', isLeaf: true, childCount: 0 },
  { id: '10767', name: 'Motocross Bikes', isLeaf: true, childCount: 0 },
  { id: '10768', name: 'Enduro Bikes', isLeaf: true, childCount: 0 },
  { id: '47002', name: 'Pit Bikes & Minimoto', isLeaf: true, childCount: 0 },
  { id: '10750', name: 'Motorcycle Accessories', isLeaf: true, childCount: 0 },
  { id: '50434', name: 'Motorcycle Clothing, Helmets & Protection', isLeaf: true, childCount: 0 },
  { id: '26455', name: 'Motorcycle Engines & Engine Parts', isLeaf: true, childCount: 0 },
  { id: '26459', name: 'Motorcycle Frame & Chassis', isLeaf: true, childCount: 0 },
  { id: '26456', name: 'Motorcycle Suspension & Steering', isLeaf: true, childCount: 0 },
  { id: '26457', name: 'Motorcycle Wheels & Tyres', isLeaf: true, childCount: 0 },
  { id: '50370', name: 'Motorcycle Exhausts', isLeaf: true, childCount: 0 },
  { id: '26460', name: 'Motorcycle Bodywork & Fairings', isLeaf: true, childCount: 0 },
  { id: '25634', name: 'Motorcycle Brakes', isLeaf: true, childCount: 0 },
  { id: '25633', name: 'Motorcycle Electrical', isLeaf: true, childCount: 0 },
  { id: '177831', name: 'Complete Mountain Bikes', isLeaf: true, childCount: 0 },
  { id: '56197', name: 'Complete Road Bikes', isLeaf: true, childCount: 0 },
  { id: '177832', name: 'Electric Bikes', isLeaf: true, childCount: 0 },
  { id: '48647', name: 'BMX Bikes', isLeaf: true, childCount: 0 },
  { id: '56199', name: 'Hybrid & City Bikes', isLeaf: true, childCount: 0 },
  { id: '56198', name: 'Folding Bikes', isLeaf: true, childCount: 0 },
  { id: '15279', name: 'Bicycle Frames', isLeaf: true, childCount: 0 },
  { id: '15274', name: 'Bicycle Wheels', isLeaf: true, childCount: 0 },
  { id: '15278', name: 'Bicycle Brakes', isLeaf: true, childCount: 0 },
  { id: '15272', name: 'Bicycle Gears & Derailleurs', isLeaf: true, childCount: 0 },
  { id: '46060', name: 'Bicycle Saddles & Seat Posts', isLeaf: true, childCount: 0 },
  { id: '56203', name: 'Bicycle Handlebars, Stems & Headsets', isLeaf: true, childCount: 0 },
  { id: '56200', name: 'Cycle Computers', isLeaf: true, childCount: 0 },
  { id: '15275', name: 'Bicycle Tyres & Tubes', isLeaf: true, childCount: 0 },
  { id: '152506', name: 'Trainers & Athletic Shoes', isLeaf: true, childCount: 0 },
  { id: '175748', name: 'Vintage & Rare Clothing', isLeaf: true, childCount: 0 },
  { id: '50995', name: 'Hoodies & Sweatshirts', isLeaf: true, childCount: 0 },
  { id: '3002', name: 'T-Shirts', isLeaf: true, childCount: 0 },
  { id: '57988', name: 'Jeans', isLeaf: true, childCount: 0 },
  { id: '14890', name: 'Dresses', isLeaf: true, childCount: 0 },
  { id: '63848', name: 'Jackets & Coats', isLeaf: true, childCount: 0 },
  { id: '172131', name: 'Sportswear', isLeaf: true, childCount: 0 },
  { id: '169741', name: 'Activewear', isLeaf: true, childCount: 0 },

];

function filterCurated(query: string): CatSuggestion[] {
  const q = query.toLowerCase();
  return CURATED_LEAF_CATEGORIES
    .filter(c => c.isLeaf && (
      c.name.toLowerCase().includes(q) ||
      q.split(' ').some(w => w.length > 2 && c.name.toLowerCase().includes(w))
    ))
    .slice(0, 5)
    .map(c => ({ id: c.id, name: c.name, isLeaf: true, confidence: 'medium' as const }));
}

// ═════════════════════════════════════════════════════════════════════════════
// Main Handler
// ═════════════════════════════════════════════════════════════════════════════

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const { route, tenantId, parentId = '', query = '', categoryId = '', depth = 3 } = body;
  if (!tenantId) return json({ success: false, error: 'tenantId is required' }, 400);
  if (!route)    return json({ success: false, error: 'route is required' }, 400);

  const supabase = adminClient();
  const authHeader = req.headers.get('Authorization');
  const sec = await verifyAccess(supabase, authHeader, tenantId);
  if (!sec.ok) return json({ success: false, error: sec.error }, sec.status ?? 401);

  const { token, error: tokenError } = await getAppToken();

  if (!token) {
    if (route === 'get_category_children') {
      return json({ success: true, children: CURATED_LEAF_CATEGORIES, source: 'curated', note: 'eBay credentials not configured' });
    }
    if (route === 'get_category_suggestions') {
      const { data: dbRows } = await supabase.from('ebay_categories')
        .select('category_id, category_name, is_leaf, category_path')
        .eq('marketplace_id', MARKETPLACE_ID).eq('active', true).eq('is_leaf', true)
        .or(`category_name.ilike.%${query}%,category_path.ilike.%${query}%`)
        .limit(8);
      if (dbRows && dbRows.length > 0) {
        const sug: CatSuggestion[] = dbRows.map((r: any, i: number) => ({
          id: r.category_id, name: r.category_name, isLeaf: true,
          confidence: i === 0 ? 'medium' : 'low', categoryPath: r.category_path,
        }));
        return json({ success: true, suggestions: sug, source: 'db_cache_offline' });
      }
      return json({ success: true, suggestions: filterCurated(query), source: 'curated' });
    }
    if (route === 'validate_category') {
      // Without an OAuth app token the current eBay tree cannot be checked.
      // A cached leaf/non-leaf flag is not authoritative and must not be returned
      // as valid/invalid. The client can retry through swish-ebay-list using the
      // connected seller token; otherwise it must display "not verified".
      const { data: row } = await supabase.from('ebay_categories')
        .select('category_id, category_name, category_path, tree_id, tree_version')
        .eq('marketplace_id', MARKETPLACE_ID)
        .eq('category_id', categoryId)
        .maybeSingle();
      return json({
        success: true,
        valid: null,
        isLeaf: null,
        active: null,
        categoryId,
        categoryName: row?.category_name,
        categoryPath: row?.category_path,
        categoryTreeId: row?.tree_id ?? null,
        categoryTreeVersion: row?.tree_version ?? null,
        source: 'api_error',
        reason: 'eBay Taxonomy token unavailable. A cached category cannot be treated as verified; retry live verification through the connected seller account.',
      });
    }
    if (route === 'get_sync_stats') {
      return json({ success: true, ...(await getSyncStats(supabase)), tokenAvailable: false });
    }
    if (route === 'get_leaf_descendants') {
      return json({ success: false, error: 'eBay credentials required for leaf descendant lookup', leafDescendants: [] });
    }
    return json({ success: false, error: tokenError ?? 'eBay credentials not configured.' }, 503);
  }

  const { treeId, treeVersion } = await getTreeIdAndVersion(supabase, token);

  if (route === 'sync_tree_metadata') {
    const result = await syncTreeMetadata(supabase, token);
    return json({ success: true, ...result, marketplaceId: MARKETPLACE_ID });
  }

  if (route === 'sync_categories' || route === 'sync_categories_deep') {
    const startParentId = body.parentId ?? '';
    const maxDepth = Math.min(Number(depth) || 3, 5);
    const { data: treeRow } = await supabase.from('ebay_category_trees')
      .select('tree_version').eq('marketplace_id', MARKETPLACE_ID).maybeSingle();
    const tv = treeRow?.tree_version ?? treeVersion;
    const result = await syncCategoriesDeep(supabase, token, treeId, tv, startParentId, maxDepth);
    return json({ success: true, ...result, treeId, treeVersion: tv, marketplaceId: MARKETPLACE_ID });
  }

  if (route === 'seed_priority_branches') {
    const { data: treeRow } = await supabase.from('ebay_category_trees')
      .select('tree_version').eq('marketplace_id', MARKETPLACE_ID).maybeSingle();
    const tv = treeRow?.tree_version ?? treeVersion;
    const result = await seedPriorityBranches(supabase, token, treeId, tv);
    return json({ success: true, ...result, treeId, treeVersion: tv, marketplaceId: MARKETPLACE_ID });
  }

  if (route === 'get_category_suggestions') {
    if (!query || query.trim().length < 2) {
      return json({ success: false, error: 'query is required (min 2 characters)' }, 400);
    }
    const result = await getCategorySuggestions(supabase, token, treeId, treeVersion, query);
    return json({ success: true, ...result, query, treeId, treeVersion });
  }

  if (route === 'get_category_children') {
    const result = await getCategoryChildren(supabase, token, treeId, treeVersion, parentId);
    const routeOk = result.source !== 'error';
    return json({
      success: routeOk,
      ...result,
      ...(routeOk ? {} : { error: 'The dedicated eBay taxonomy request failed for this category branch; retrying via the connected seller token may succeed.' }),
      parentId, treeId, treeVersion,
    });
  }

  if (route === 'get_leaf_descendants') {
    if (!categoryId) return json({ success: false, error: 'categoryId is required' }, 400);
    const maxR = Math.min(Number(body.maxResults) || 15, 30);
    const leaves = await getLeafDescendants(supabase, token, treeId, treeVersion, categoryId, maxR);
    return json({ success: true, leafDescendants: leaves, parentCategoryId: categoryId, count: leaves.length, treeId, treeVersion });
  }

  if (route === 'get_category_aspects') {
    if (!categoryId) return json({ success: false, error: 'categoryId is required' }, 400);
    const result = await getCategoryAspects(supabase, token, treeId, categoryId);
    return json({
      success: result.isLeaf, isLeaf: result.isLeaf, aspects: result.aspects,
      requiredAspects: result.aspects.filter(a => a.required).map(a => a.name),
      recommendedAspects: result.aspects.filter(a => a.recommended).map(a => a.name),
      categoryId, categoryName: result.categoryName,
      source: result.source, error: result.error ?? null,
      treeId, treeVersion, marketplaceId: MARKETPLACE_ID,
    });
  }

  if (route === 'validate_category') {
    if (!categoryId) return json({ success: false, error: 'categoryId is required' }, 400);
    const result = await validateCategoryId(supabase, token, treeId, treeVersion, categoryId);
    return json({ success: true, ...result });
  }

  if (route === 'get_sync_stats') {
    const stats = await getSyncStats(supabase);
    syncTreeMetadata(supabase, token).catch(() => {});
    return json({ success: true, ...stats, tokenAvailable: true });
  }

  if (route === 'test') {
    const testResults = await runTest(supabase, token, treeId, treeVersion);
    return json({ success: true, ...testResults });
  }

  return json({ success: false, error: `Unknown route: ${route}` }, 400);
});
