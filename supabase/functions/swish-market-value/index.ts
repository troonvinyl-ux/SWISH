// SWISH Market Value & Pricing Intelligence Edge Function v8
//
// v8 — FIXES:
//   1. Terapeak 404 (errorId 2002 "Resource not found") now caught silently —
//      this means the eBay account doesn't have a Terapeak/eBay Store subscription.
//      It is treated identically to 403 (no scope): falls back to Browse + Gemini.
//   2. Browse API fallback with broader queries when primary returns 0 results.
//      For niche/rare items, removes marketplace restriction on 2nd attempt.
//   3. Gemini estimate → listing price fix: medium/low confidence now always
//      produces a recommended listing price (was incorrectly returning 0).
//   4. Terapeak error no longer shown as a loud warning in the UI (moved to
//      a silent audit-trail note unless it was previously unavailable).
//
// NEW IN v7:
//   Source D: eBay Terapeak / Sell Analytics API
//   GET /sell/analytics/v1/product_research/sell
//
//   This is the SAME data powering eBay Seller Hub → Research → Product Research.
//   It requires the `sell.analytics.readonly` OAuth scope, added in v7.
//
//   Terapeak returns:
//     - averageSoldPrice     — true average of completed sale prices
//     - conditionDistributions — sold count + avg price per condition bucket
//     - salesHistogram        — daily/weekly sold volume trend
//     - soldQuantity          — total items sold in period
//     - sellThroughRate       — % of listed items that sold
//     - liveListings          — active listing count
//
//   Evidence class: A (verified completed/sold transactions).
//   This is the only source in SWISH that provides genuine historical sold data.
//
// SCOPE UPGRADE REQUIRED:
//   Existing connected accounts were authorised with the old scope set.
//   They will receive HTTP 403 from Terapeak until they re-authorise.
//   v7 detects this and falls back to Browse API + Gemini automatically,
//   then sets teapeakNeedsReauth=true in the response so the UI can prompt.
//
// THREE-SOURCE STRATEGY (priority order):
//   1. TERAPEAK  — genuine sold data (class A) — primary valuation signal
//   2. BROWSE API — active asking prices (class B) — market context only
//   3. GEMINI    — AI training estimate (class E) — fallback when both unavailable
//
// All three sources are always labelled accurately. Terapeak data is clearly
// distinguished as verified sold evidence. Browse/Gemini remain accurately
// labelled as asking prices / AI inference.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { decryptCredentials, encryptCredentials } from '../_shared/credentialCrypto.ts';

const EBAY_TOKEN_URL      = 'https://api.ebay.com/identity/v1/oauth2/token';
const EBAY_BROWSE_BASE    = 'https://api.ebay.com/buy/browse/v1';
const EBAY_ANALYTICS_BASE = 'https://api.ebay.com/sell/analytics/v1';
const EBAY_GLOBAL_ID      = 'EBAY_GB';
const TERAPEAK_SCOPE      = 'https://api.ebay.com/oauth/api_scope/sell.analytics.readonly';

function adminClient() {
  return createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
}
function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ── Auth ──────────────────────────────────────────────────────────────────────
async function verifyTenantAccess(
  supabase: ReturnType<typeof adminClient>, authHeader: string | null, tenantId: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!authHeader) return { ok: false, error: 'Authentication required.' };
  const token = authHeader.replace('Bearer ', '').trim();
  if (!token || token === Deno.env.get('SUPABASE_ANON_KEY')) return { ok: false, error: 'Authentication required.' };
  try {
    const userClient = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error } = await userClient.auth.getUser();
    if (error || !user) return { ok: false, error: 'Invalid authentication token.' };
    const { data: member } = await supabase.from('tenant_memberships').select('id').eq('tenant_id', tenantId).eq('user_id', user.id).maybeSingle();
    if (!member) return { ok: false, error: 'Access denied.' };
    return { ok: true };
  } catch { return { ok: false, error: 'Authentication could not be verified.' }; }
}

// Resolve item specialists to the four production product boundaries.
// Legacy collectible records remain in Coins for compatibility; unknown IDs
// do not gain access to an item's valuation context.
function productForSpecialist(specialistId: string | null | undefined): string | null {
  const id = String(specialistId ?? '').trim().toLowerCase();
  if (['surplus_flip', 'surplus_trader', 'catalog_flip', 'catalog_surplus'].includes(id)) return 'surplus_flip';
  if ([
    'coins', 'coins_uk', 'coins_world', 'coins_currency', 'islamic_silver',
    'banknotes', 'gold', 'silver', 'ancient_artefacts',
    'jewellery_precious_metals', 'curiosities_collectibles',
  ].includes(id) || id.includes('coin')) return 'coins';
  if (id === 'motocross' || id === 'mx' || id === 'flipper_mx') return 'motocross';
  if (id === 'bicycles' || id === 'cycling' || id === 'bike_flipper') return 'bicycles';
  if (id === 'clothing' || id === 'trainers_sneakers' || id === 'trainers') return 'clothing';
  return null;
}

// ── Currency ──────────────────────────────────────────────────────────────────
function toGBP(price: number, currency: string): number {
  const rates: Record<string, number> = {
    GBP: 1, USD: 0.79, EUR: 0.85, AUD: 0.51, CAD: 0.58,
    JPY: 0.0053, CHF: 0.89, SEK: 0.072, DKK: 0.114, NOK: 0.070,
  };
  return price * (rates[(currency ?? 'GBP').toUpperCase()] ?? 1);
}

// ── Title sanitisation ────────────────────────────────────────────────────────
// ── Supplemental structured reference: CANOA ancient coin catalogue ───────────
// Public JSON catalogue only; reference candidates never count as sold-price data.
// Museum image URLs are intentionally not copied into SWISH because image rights
// remain with the holding institutions. Failures are non-fatal and time-bounded.
interface CanoaCoinCandidate {
  id?: number;
  title: string;
  catalogueNumber?: string;
  ruler?: string;
  mint?: string;
  denomination?: string;
  material?: string;
  dateFrom?: number | null;
  dateTo?: number | null;
  specimenCount?: number;
  url?: string;
}
async function searchCanoaCoinTypes(query: string): Promise<{ available: boolean; query: string; items: CanoaCoinCandidate[]; error?: string }> {
  const empty = { available: false, query, items: [] as CanoaCoinCandidate[] };
  if (!query || query.trim().length < 3) return empty;

  // Try the full label first; if its extra detail is too restrictive for CANOA's
  // token search, retry once with a shorter phrase. Never loop or bulk-crawl.
  const words = query.trim().split(" ").filter(Boolean);
  const fallbackQuery = words.slice(0, Math.min(4, words.length)).join(" ");
  const queries = [query.trim().slice(0, 100)];
  if (fallbackQuery.length >= 3 && fallbackQuery.toLowerCase() !== queries[0].toLowerCase()) {
    queries.push(fallbackQuery.slice(0, 100));
  }

  for (const candidateQuery of queries) {
    try {
      const params = new URLSearchParams({ q: candidateQuery, per_page: "8" });
      const response = await fetch(`https://canoanumis.org/api/coins?${params.toString()}`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(7000),
      });
      if (!response.ok) {
        if (candidateQuery === queries[queries.length - 1]) return { ...empty, error: `CANOA HTTP ${response.status}` };
        continue;
      }
      const data = await response.json();
      const raw = Array.isArray(data.results) ? data.results : [];
      const items = raw.map((item: any): CanoaCoinCandidate => ({
        id: item.id != null && Number.isFinite(Number(item.id)) ? Number(item.id) : undefined,
        title: String(item.label ?? item.pref_label ?? "").slice(0, 180),
        catalogueNumber: typeof item.ocre_id === "string" && item.ocre_id ? item.ocre_id.slice(0, 80) : undefined,
        ruler: typeof item.authority === "string" && item.authority ? item.authority.slice(0, 100) : undefined,
        mint: typeof item.mint === "string" && item.mint ? item.mint.slice(0, 100) : undefined,
        denomination: typeof item.denomination === "string" && item.denomination ? item.denomination.slice(0, 80) : undefined,
        material: typeof item.material === "string" && item.material ? item.material.slice(0, 80) : undefined,
        dateFrom: item.date_from != null && item.date_from !== "" && Number.isFinite(Number(item.date_from)) ? Number(item.date_from) : null,
        dateTo: item.date_to != null && item.date_to !== "" && Number.isFinite(Number(item.date_to)) ? Number(item.date_to) : null,
        specimenCount: item.specimen_count != null && Number.isFinite(Number(item.specimen_count)) ? Number(item.specimen_count) : undefined,
        url: typeof item.url === "string" && item.url.startsWith("/") ? `https://canoanumis.org${item.url}` : (typeof item.url === "string" && item.url.startsWith("https://") ? item.url : undefined),
      })).filter((item: CanoaCoinCandidate) => item.title && item.url);
      if (items.length > 0) return { available: true, query: candidateQuery, items: items.slice(0, 8) };
    } catch (error: any) {
      if (candidateQuery === queries[queries.length - 1]) {
        return { ...empty, error: error?.name === "TimeoutError" ? "CANOA request timed out" : "CANOA reference search unavailable" };
      }
    }
  }
  return { ...empty, available: true, query: queries[queries.length - 1] };
}

function sanitiseTitle(raw: string): string {
  return raw
    .replace(/PROVISIONAL\s*/gi, '')
    .replace(/[£\$€]\s*\d+(?:[.,]\d+)?/g, ' ')
    .replace(/\b(spares?\s*\/\s*repairs?|for parts?|not working|project bike?|parts only|see desc(?:ription)?|fast delivery|free postage|inc(?:luding)?\s+p&p|\+p&p|collection only|buyer collects?)\b/gi, ' ')
    .replace(/[–—|#+]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ══════════════════════════════════════════════════════════════════════════════
// CONNECTOR CREDENTIALS + TOKEN REFRESH
// ══════════════════════════════════════════════════════════════════════════════

interface ConnectorCreds {
  clientId: string;
  clientSecret: string;
  ruName: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: string | null;
  /** True if the stored token was issued with sell.analytics.readonly scope */
  hasAnalyticsScope: boolean;
}

async function getAndRefreshConnectorCreds(
  supabase: ReturnType<typeof adminClient>,
  tenantId: string,
): Promise<ConnectorCreds | null> {
  const { data: conn } = await supabase
    .from('marketplace_connectors')
    .select('credential_ref, status, access_token_expires_at')
    .eq('tenant_id', tenantId)
    .eq('marketplace_id', 'ebay')
    .maybeSingle();

  if (!conn?.credential_ref || conn.status !== 'connected') {
    console.log(`[SWISH Market v7] No connected eBay connector for tenant ${tenantId}`);
    return null;
  }

  let creds: any;
  try { creds = await decryptCredentials(conn.credential_ref); }
  catch { console.log('[SWISH Market v7] Credential decryption failed.'); return null; }

  if (!creds?.accessToken || !creds?.clientId) {
    console.log(`[SWISH Market v7] Missing accessToken or clientId`);
    return null;
  }

  // Refresh if within 10 minutes of expiry or already expired
  const expiresAt = creds.expiresAt ? new Date(creds.expiresAt) : null;
  const needsRefresh = !expiresAt || expiresAt.getTime() - Date.now() < 10 * 60 * 1000;

  if (needsRefresh && creds.refreshToken) {
    console.log(`[SWISH Market v7] Token expired/near-expiry — refreshing`);
    try {
      const basicAuth = btoa(`${creds.clientId}:${creds.clientSecret}`);
      const resp = await fetch(EBAY_TOKEN_URL, {
        method: 'POST',
        headers: { Authorization: `Basic ${basicAuth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: creds.refreshToken }).toString(),
        signal: AbortSignal.timeout(10000),
      });
      if (resp.ok) {
        const tokenData = await resp.json();
        if (tokenData.access_token) {
          const newExpiry = tokenData.expires_in ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString() : null;
          // Preserve hasAnalyticsScope flag from before refresh — scope set doesn't change on refresh
          creds = { ...creds, accessToken: tokenData.access_token, expiresAt: newExpiry };
          const newCredRef = await encryptCredentials(creds);
          await supabase.from('marketplace_connectors').update({
            credential_ref: newCredRef,
            access_token_expires_at: newExpiry,
            updated_at: new Date().toISOString(),
          }).eq('tenant_id', tenantId).eq('marketplace_id', 'ebay');
          console.log(`[SWISH Market v7] Token refreshed, new expiry=${newExpiry}`);
        }
      } else {
        console.log(`[SWISH Market v7] Token refresh failed (${resp.status})`);
      }
    } catch (e: any) {
      console.log('[SWISH Market v7] Token refresh failed unexpectedly.');
    }
  }

  return {
    clientId: String(creds.clientId ?? ''),
    clientSecret: String(creds.clientSecret ?? ''),
    ruName: String(creds.ruName ?? ''),
    accessToken: String(creds.accessToken ?? ''),
    refreshToken: String(creds.refreshToken ?? ''),
    expiresAt: creds.expiresAt ?? null,
    // hasAnalyticsScope is set to true once the user re-authorises with the new scope set
    hasAnalyticsScope: creds.hasAnalyticsScope === true,
  };
}

// ── App token (for visual search) ─────────────────────────────────────────────
async function getEbayAppToken(clientId: string, clientSecret: string): Promise<string | null> {
  try {
    const basicAuth = btoa(`${clientId}:${clientSecret}`);
    const resp = await fetch(EBAY_TOKEN_URL, {
      method: 'POST',
      headers: { Authorization: `Basic ${basicAuth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', scope: 'https://api.ebay.com/oauth/api_scope' }).toString(),
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.access_token ?? null;
  } catch { return null; }
}

// ══════════════════════════════════════════════════════════════════════════════
// SOURCE A: TERAPEAK PRODUCT RESEARCH API
// ══════════════════════════════════════════════════════════════════════════════
// GET /sell/analytics/v1/product_research/sell
// Requires scope: sell.analytics.readonly
//
// Returns genuine historical sold transaction data — the same data shown in
// eBay Seller Hub → Research → Product Research.
//
// Evidence class: A (verified completed/sold marketplace transactions).

export interface TeapeakResult {
  available: boolean;
  needsReauth: boolean;           // true if 403 — user must re-authorise with new scope
  httpStatus?: number;
  error?: string;

  // Aggregate sold statistics
  averageSoldPrice: number;       // GBP, IQR-cleaned mean
  medianConditionPrice: number;   // median across condition buckets
  soldQuantity: number;           // total items sold in period
  sellThroughRate: number | null; // 0–1
  liveListings: number;           // active listing count at time of query

  // Price distribution
  priceMin: number;
  priceMax: number;
  priceRangeDisplay: string;

  // Condition breakdown
  conditionDistributions: Array<{
    conditionId: string;
    conditionName: string;
    soldQuantity: number;
    averageSoldPrice: number;
  }>;

  // Sales trend (most recent 12 data points)
  salesTrend: Array<{
    date: string;
    soldQuantity: number;
    averagePrice: number;
  }>;

  // Top sold listings (from conditionDistributions detail)
  topSoldListings: Array<{
    title: string;
    price: number;
    currency: string;
    condition: string;
  }>;

  // Metadata
  query: string;
  metricPeriod: string;
  marketplace: string;
  retrievedAt: string;
  dataSource: 'terapeak_product_research';
}

async function callTerapeak(
  accessToken: string,
  query: string,
  metricPeriod: 'PREVIOUS_3_MONTHS' | 'PREVIOUS_7_DAYS' | 'PREVIOUS_30_DAYS' = 'PREVIOUS_3_MONTHS',
): Promise<TeapeakResult> {
  const noResult: TeapeakResult = {
    available: false, needsReauth: false, averageSoldPrice: 0, medianConditionPrice: 0,
    soldQuantity: 0, sellThroughRate: null, liveListings: 0,
    priceMin: 0, priceMax: 0, priceRangeDisplay: 'No data',
    conditionDistributions: [], salesTrend: [], topSoldListings: [],
    query, metricPeriod, marketplace: EBAY_GLOBAL_ID,
    retrievedAt: new Date().toISOString(), dataSource: 'terapeak_product_research',
  };

  if (!accessToken || !query || query.length < 3) {
    return { ...noResult, error: 'Missing access token or query' };
  }

  const params = new URLSearchParams({
    q: query.slice(0, 100),
    marketplace_id: EBAY_GLOBAL_ID,
    metric_period: metricPeriod,
  });

  const url = `${EBAY_ANALYTICS_BASE}/product_research/sell?${params.toString()}`;
  console.log(`[SWISH Market v7] Terapeak: "${query}" period=${metricPeriod} marketplace=${EBAY_GLOBAL_ID}`);

  try {
    const resp = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(20000),
    });

    // 403: token was not issued with sell.analytics.readonly scope → user needs to re-authorise
    if (resp.status === 403) {
      const errText = await resp.text();
      console.log(`[SWISH Market v8] Terapeak 403 — scope not granted. User must re-authorise. Response: ${errText.slice(0, 200)}`);
      return { ...noResult, needsReauth: true, httpStatus: 403, error: 'Terapeak scope not granted — re-authorise eBay in Marketplaces settings' };
    }

    // 401: token expired (shouldn't happen after refresh above)
    if (resp.status === 401) {
      console.log(`[SWISH Market v8] Terapeak 401 — token invalid`);
      return { ...noResult, needsReauth: true, httpStatus: 401, error: 'Token invalid — re-authorise eBay' };
    }

    // 404: eBay error 2002 "Resource not found" — account does not have Terapeak/eBay Store subscription.
    // This is NOT an error in SWISH — it just means Terapeak is unavailable for this account tier.
    // Treat identically to 403: silent fallback to Browse + Gemini, no loud warning.
    if (resp.status === 404) {
      const errText = await resp.text();
      console.log(`[SWISH Market v8] Terapeak 404 — account does not have Terapeak access (no eBay Store subscription or endpoint unavailable). Falling back silently to Browse + Gemini. Response: ${errText.slice(0, 200)}`);
      // Check if errorId 2002 (Resource not found — typical for no-subscription accounts)
      const is2002 = errText.includes('2002') || errText.includes('Resource not found');
      return { ...noResult, httpStatus: 404, needsReauth: false, error: is2002 ? 'Terapeak not available — eBay Store subscription required' : `Terapeak 404: ${errText.slice(0, 80)}` };
    }

    if (!resp.ok) {
      const errText = await resp.text();
      console.log(`[SWISH Market v8] Terapeak HTTP ${resp.status}: ${errText.slice(0, 250)}`);
      return { ...noResult, httpStatus: resp.status, error: `Terapeak ${resp.status}: ${errText.slice(0, 120)}` };
    }

    const data = await resp.json();

    // Parse the Sell Analytics API response structure
    // Reference: https://developer.ebay.com/api-docs/sell/analytics/resources/product_research/methods/getProductResearchStatistics
    const stats = data.productStatistics ?? data;

    // Aggregate sold price
    const avgPriceRaw = stats.averageSoldPrice ?? stats.averagePrice ?? {};
    const avgSoldPrice = toGBP(
      parseFloat(String(avgPriceRaw.value ?? avgPriceRaw ?? 0)) || 0,
      String(avgPriceRaw.currency ?? 'GBP'),
    );

    const soldQty = parseInt(String(stats.soldQuantity ?? stats.totalSoldQuantity ?? 0), 10) || 0;
    const liveListings = parseInt(String(stats.liveListings ?? stats.activeListing ?? 0), 10) || 0;
    const sellThroughRate = stats.sellThroughRate != null ? parseFloat(String(stats.sellThroughRate)) || null : null;

    // Price range
    const priceRange = stats.soldPriceRange ?? stats.priceRange ?? {};
    const priceMin = toGBP(parseFloat(String(priceRange.min?.value ?? priceRange.minimum ?? 0)) || 0, String(priceRange.min?.currency ?? 'GBP'));
    const priceMax = toGBP(parseFloat(String(priceRange.max?.value ?? priceRange.maximum ?? 0)) || 0, String(priceRange.max?.currency ?? 'GBP'));

    // Condition distributions
    const conditionDists = (stats.conditionDistributions ?? []).map((c: any) => ({
      conditionId: String(c.conditionId ?? c.condition ?? ''),
      conditionName: String(c.conditionFriendlyName ?? c.conditionName ?? c.conditionId ?? 'Unknown'),
      soldQuantity: parseInt(String(c.soldQuantity ?? 0), 10) || 0,
      averageSoldPrice: toGBP(
        parseFloat(String(c.averageSoldPrice?.value ?? c.averagePrice?.value ?? c.averageSoldPrice ?? 0)) || 0,
        String(c.averageSoldPrice?.currency ?? c.averagePrice?.currency ?? 'GBP'),
      ),
    })).filter((c: any) => c.soldQuantity > 0);

    // Compute median condition price across condition buckets with sales
    const condPrices = conditionDists.map((c: any) => c.averageSoldPrice).filter((p: number) => p > 0).sort((a: number, b: number) => a - b);
    const medianCondPrice = condPrices.length > 0 ? condPrices[Math.floor(condPrices.length / 2)] : avgSoldPrice;

    // Sales histogram / trend
    const histogram = stats.salesHistogram ?? stats.histogram ?? stats.salesTrend ?? [];
    const salesTrend = (Array.isArray(histogram) ? histogram : []).slice(-12).map((point: any) => ({
      date: String(point.date ?? point.startDate ?? ''),
      soldQuantity: parseInt(String(point.soldQuantity ?? point.quantity ?? 0), 10) || 0,
      averagePrice: toGBP(
        parseFloat(String(point.averageSoldPrice?.value ?? point.price?.value ?? point.averagePrice ?? 0)) || 0,
        String(point.averageSoldPrice?.currency ?? point.price?.currency ?? 'GBP'),
      ),
    }));

    // Top sold listings (if available in response)
    const topListings = (stats.topListings ?? stats.recentSales ?? []).slice(0, 8).map((l: any) => ({
      title: String(l.title ?? '').slice(0, 80),
      price: toGBP(parseFloat(String(l.price?.value ?? l.soldPrice?.value ?? l.soldPrice ?? 0)) || 0, String(l.price?.currency ?? l.soldPrice?.currency ?? 'GBP')),
      currency: 'GBP',
      condition: String(l.conditionFriendlyName ?? l.condition ?? ''),
    })).filter((l: any) => l.price > 0);

    console.log(`[SWISH Market v8] Terapeak: sold=${soldQty} avg=£${avgSoldPrice.toFixed(2)} live=${liveListings} conditions=${conditionDists.length}`);

    // Determine if we have meaningful sold data
    if (soldQty === 0 && avgSoldPrice === 0) {
      return { ...noResult, available: false, liveListings, error: 'No sold data found for this query in the selected period' };
    }

    return {
      available: true,
      needsReauth: false,
      httpStatus: 200,
      averageSoldPrice: Math.round(avgSoldPrice * 100) / 100,
      medianConditionPrice: Math.round(medianCondPrice * 100) / 100,
      soldQuantity: soldQty,
      sellThroughRate,
      liveListings,
      priceMin: Math.round(priceMin * 100) / 100,
      priceMax: Math.round(priceMax * 100) / 100,
      priceRangeDisplay: priceMin > 0 && priceMax > 0 ? `£${priceMin.toFixed(0)}–£${priceMax.toFixed(0)}` : `£${avgSoldPrice.toFixed(0)}`,
      conditionDistributions: conditionDists,
      salesTrend,
      topSoldListings: topListings,
      query,
      metricPeriod,
      marketplace: EBAY_GLOBAL_ID,
      retrievedAt: new Date().toISOString(),
      dataSource: 'terapeak_product_research',
    };

  } catch (e: any) {
    console.log('[SWISH Market v8] Terapeak request failed unexpectedly.');
    return { ...noResult, error: 'Sold-data lookup is temporarily unavailable.' };
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// SOURCE B: eBay BROWSE API — ACTIVE LISTINGS (user OAuth)
// ══════════════════════════════════════════════════════════════════════════════
// Evidence class: B (active asking prices — NOT sold prices)

interface BrowseSearchResult {
  available: boolean;
  items: Array<{ title: string; price: number; currency: string; condition: string; url: string; imageUrl: string; listingType: string }>;
  totalFound: number;
  query: string;
  error?: string;
  httpStatus?: number;
}

async function searchEbayBrowse(
  accessToken: string,
  query: string,
  maxResults = 50,
  skipMarketplaceFilter = false,
  fallbackToken?: string | null,
): Promise<BrowseSearchResult> {
  const noResult: BrowseSearchResult = { available: false, items: [], totalFound: 0, query };
  if (!accessToken || !query || query.length < 3) return noResult;

  const params = new URLSearchParams({ q: query.slice(0, 100), limit: String(Math.min(maxResults, 100)), fieldgroups: 'MATCHING_ITEMS' });
  const marketplaceLog = skipMarketplaceFilter ? 'GLOBAL' : EBAY_GLOBAL_ID;
  console.log(`[SWISH Market v8] Browse API: "${query}" marketplace=${marketplaceLog}`);

  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    };
    // Only add marketplace restriction when not doing a global fallback search
    if (!skipMarketplaceFilter) headers['X-EBAY-C-MARKETPLACE-ID'] = EBAY_GLOBAL_ID;

    let resp = await fetch(`${EBAY_BROWSE_BASE}/item_summary/search?${params}`, {
      headers,
      signal: AbortSignal.timeout(15000),
    });

    // Retry authentication failures with the application token before reporting a dead search.
    if (!resp.ok && (resp.status === 401 || resp.status === 403) && fallbackToken && fallbackToken !== accessToken) {
      const firstStatus = resp.status;
      await resp.text();
      console.log(`[SWISH Market v8] Browse user-token request returned ${firstStatus}; retrying with application token`);
      const fallbackHeaders: Record<string, string> = {
        Authorization: `Bearer ${fallbackToken}`,
        'Content-Type': 'application/json',
      };
      if (!skipMarketplaceFilter) fallbackHeaders['X-EBAY-C-MARKETPLACE-ID'] = EBAY_GLOBAL_ID;
      resp = await fetch(`${EBAY_BROWSE_BASE}/item_summary/search?${params}`, {
        headers: fallbackHeaders,
        signal: AbortSignal.timeout(15000),
      });
    }
    if (!resp.ok) {
      const errText = await resp.text();
      console.log(`[SWISH Market v8] Browse API ${resp.status}: ${errText.slice(0, 200)}`);
      return { ...noResult, error: `Browse ${resp.status}`, httpStatus: resp.status };
    }
    const data = await resp.json();
    const rawItems = data.itemSummaries ?? [];
    const items = rawItems.slice(0, maxResults).map((item: any) => ({
      title: item.title ?? '', price: toGBP(Number(item.price?.value ?? 0), item.price?.currency ?? 'GBP'),
      currency: item.price?.currency ?? 'GBP', condition: item.condition ?? '',
      url: item.itemWebUrl ?? '', imageUrl: item.image?.imageUrl ?? '',
      listingType: (item.buyingOptions ?? []).includes('AUCTION') ? 'Auction' : 'FixedPrice',
    })).filter((i: any) => i.price > 0 && i.title);
    console.log(`[SWISH Market v8] Browse API: ${items.length} items (total ${data.total ?? items.length}) marketplace=${marketplaceLog}`);
    return { available: true, items, totalFound: Number(data.total ?? items.length), query };
  } catch (e: any) {
    console.log('[SWISH Market v8] Browse request failed unexpectedly.');
    return { ...noResult, error: 'Active-listing lookup is temporarily unavailable.' };
  }
}

// ── SOURCE B2: eBay Marketplace Insights — individual sold items (when approved) ──
// This API is restricted to approved applications. If SWISH's app is not approved,
// the function reports the access status and the engine continues with other sources.
interface SoldListingSearchResult {
  available: boolean;
  items: Array<{ title: string; price: number; currency: string; condition: string; soldDate: string; url: string; imageUrl: string; itemId: string }>;
  totalFound: number;
  error?: string;
  httpStatus?: number;
}
async function searchEbaySoldListings(appToken: string | null, query: string, maxResults = 50): Promise<SoldListingSearchResult> {
  const empty: SoldListingSearchResult = { available: false, items: [], totalFound: 0 };
  if (!appToken || query.trim().length < 3) return { ...empty, error: 'Missing app token or query' };
  const params = new URLSearchParams({ q: query.slice(0, 100), limit: String(Math.min(maxResults, 100)) });
  try {
    const resp = await fetch(`https://api.ebay.com/buy/marketplace_insights/v1_beta/item_sales/search?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${appToken}`,
        Accept: 'application/json',
        'X-EBAY-C-MARKETPLACE-ID': EBAY_GLOBAL_ID,
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) {
      const message = (await resp.text()).slice(0, 220);
      console.log(`[SWISH Market] Marketplace Insights HTTP ${resp.status}: ${message}`);
      return { ...empty, httpStatus: resp.status, error: resp.status === 403
        ? 'Marketplace Insights sold-item API access is not enabled for this eBay developer application'
        : `Marketplace Insights ${resp.status}` };
    }
    const data = await resp.json();
    const raw = data.itemSales ?? data.itemSummaries ?? data.items ?? data.sales ?? [];
    const items = (Array.isArray(raw) ? raw : []).map((item: any) => {
      const priceObj = item.price ?? item.lastSoldPrice ?? item.soldPrice ?? {};
      const price = toGBP(Number(priceObj.value ?? priceObj.amount ?? priceObj ?? 0), String(priceObj.currency ?? item.currency ?? 'GBP'));
      return {
        title: String(item.title ?? item.itemTitle ?? '').slice(0, 180),
        price,
        currency: 'GBP',
        condition: String(item.condition ?? item.conditionId ?? ''),
        soldDate: String(item.lastSoldDate ?? item.soldDate ?? item.saleDate ?? item.lastSoldDateTime ?? ''),
        url: String(item.itemWebUrl ?? item.itemUrl ?? item.url ?? ''),
        imageUrl: String(item.image?.imageUrl ?? item.imageUrl ?? item.thumbnailImages?.[0]?.imageUrl ?? ''),
        itemId: String(item.itemId ?? item.legacyItemId ?? ''),
      };
    }).filter((item: any) => item.title && item.price > 0);
    return { available: true, items, totalFound: Number(data.total ?? data.totalItems ?? items.length) };
  } catch (e: any) {
    return { ...empty, error: `Marketplace Insights: ${e?.message ?? 'request failed'}` };
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// SOURCE C: eBay VISUAL SEARCH (app token)
// ══════════════════════════════════════════════════════════════════════════════
interface VisualSearchResult {
  available: boolean;
  items: Array<{ title: string; price: number; currency: string; imageUrl: string; url: string }>;
  totalFound: number;
  error?: string;
}

async function runEbayVisualSearch(imageInput: string, appToken: string): Promise<VisualSearchResult> {
  const noResult: VisualSearchResult = { available: false, items: [], totalFound: 0 };
  if (!appToken || !imageInput) return noResult;
  try {
    let imageBase64 = '';
    if (/^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(imageInput)) {
      imageBase64 = imageInput.slice(imageInput.indexOf(',') + 1).replace(/\s/g, '');
    } else if (/^[A-Za-z0-9+/]+=*$/.test(imageInput) && imageInput.length > 100) {
      imageBase64 = imageInput;
    } else {
      const imgResp = await fetch(imageInput, { signal: AbortSignal.timeout(10000) });
      if (!imgResp.ok) return { ...noResult, error: `Image fetch ${imgResp.status}` };
      const imgBytes = new Uint8Array(await imgResp.arrayBuffer());
      let binary = '';
      const chunkSize = 8192;
      for (let i = 0; i < imgBytes.length; i += chunkSize) binary += String.fromCharCode(...imgBytes.slice(i, i + chunkSize));
      imageBase64 = btoa(binary);
    }
    if (imageBase64.length < 100) return { ...noResult, error: 'Image too small' };
    if (imageBase64.length > 7_000_000) return { ...noResult, error: 'Image exceeds eBay visual-search size limit' };
    const resp = await fetch(`${EBAY_BROWSE_BASE}/item_summary/search_by_image?limit=10&fieldgroups=MATCHING_ITEMS`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${appToken}`, 'X-EBAY-C-MARKETPLACE-ID': EBAY_GLOBAL_ID, 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: imageBase64 }), signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) return { ...noResult, error: `Visual search ${resp.status}` };
    const data = await resp.json();
    const items = (data.itemSummaries ?? []).map((item: any) => ({
      title: item.title ?? '', price: toGBP(Number(item.price?.value ?? 0), item.price?.currency ?? 'GBP'),
      currency: item.price?.currency ?? 'GBP', imageUrl: item.image?.imageUrl ?? '', url: item.itemWebUrl ?? '',
    })).filter((i: any) => i.price > 0);
    console.log(`[SWISH Market v7] Visual search: ${items.length} items`);
    return { available: true, items, totalFound: Number(data.total ?? items.length) };
  } catch { return { ...noResult, error: 'Visual search is temporarily unavailable.' }; }
}

// ══════════════════════════════════════════════════════════════════════════════
// SOURCE D: GEMINI VISION — AI MARKET ESTIMATE
// ══════════════════════════════════════════════════════════════════════════════
// Evidence class: E (AI inference from training data — NOT sold prices)

interface GeminiMarketResult {
  available: boolean;
  searchTerms: string[];
  estimatedLow: number; estimatedMid: number; estimatedHigh: number;
  confidence: 'high' | 'medium' | 'low' | 'insufficient';
  itemDescription: string; marketContext: string; valuationBasis: string; comparableDescription: string;
  error?: string;
}

async function runGeminiMarketResearch(imageUrls: string[], title: string, specialistId: string, attributes: Record<string, any>, condition: string, inlineImageBase64 = ''): Promise<GeminiMarketResult> {
  const noResult: GeminiMarketResult = {
    available: false, searchTerms: [], estimatedLow: 0, estimatedMid: 0, estimatedHigh: 0,
    confidence: 'insufficient', itemDescription: '', marketContext: '', valuationBasis: '', comparableDescription: '',
  };
  const apiKey = Deno.env.get('ONSPACE_AI_API_KEY');
  const baseUrl = Deno.env.get('ONSPACE_AI_BASE_URL');
  if (!apiKey || !baseUrl || (imageUrls.length === 0 && !inlineImageBase64)) return { ...noResult, error: 'Gemini not configured or no images' };

  const nicheContext = specialistId === 'bicycles' ? 'bicycle or cycling component sold on eBay UK'
    : specialistId === 'motocross' ? 'motocross or off-road motorcycle sold on eBay UK'
    : (specialistId === 'clothing' || specialistId === 'trainers_sneakers') ? 'vintage/branded clothing or trainers sold on eBay UK or Depop'
    : (specialistId.includes('coin') || ['islamic_silver','ancient_artefacts','gold','silver'].includes(specialistId)) ? 'coin, medal, or precious metal collectible sold on eBay UK'
    : 'collectible or resale item sold on eBay UK';

  const knownInfo = Object.entries(attributes)
    .filter(([, v]) => v && String(v).trim() && !['Not established','Not supplied','Not legible','unknown'].includes(String(v)))
    .map(([k, v]) => `${k}: ${v}`).join(', ');

  const prompt = `You are an expert eBay UK reseller. This is a ${nicheContext}.
ITEM: "${sanitiseTitle(title)}" | Condition: "${condition || 'Unknown'}" | ${knownInfo || 'No attributes'}
Return ONLY valid JSON:
{
  "itemDescription":"Brief item description",
  "searchTerms":["Specific eBay UK query 1","Broader query 2","Category fallback 3"],
  "estimatedLow":0,"estimatedMid":0,"estimatedHigh":0,
  "confidence":"high|medium|low|insufficient",
  "marketContext":"Demand, typical buyers, typical sell speed on eBay UK",
  "valuationBasis":"How estimate derived from eBay UK sold prices in training data",
  "comparableDescription":"What to search for on eBay"
}
estimatedLow/Mid/High: typical eBay UK SOLD prices (not asking). 0 if unable to estimate.`;

  try {
    const messageContent: any[] = [{ type: 'text', text: prompt }];
    if (inlineImageBase64 && inlineImageBase64.length <= 7_000_000) {
      const dataUrl = inlineImageBase64.startsWith('data:image/')
        ? inlineImageBase64
        : `data:image/jpeg;base64,${inlineImageBase64}`;
      messageContent.push({ type: 'image_url', image_url: { url: dataUrl } });
    }
    for (const url of imageUrls.slice(0, inlineImageBase64 ? 2 : 3)) {
      if (url.startsWith('https://')) messageContent.push({ type: 'image_url', image_url: { url } });
    }
    console.log(`[SWISH Market v8] Gemini vision: ${imageUrls.length + (inlineImageBase64 ? 1 : 0)} images`);
    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: 'google/gemini-2.5-flash', messages: [{ role: 'user', content: messageContent }], temperature: 0.1, max_tokens: 700 }),
      signal: AbortSignal.timeout(25000),
    });
    if (!resp.ok) return { ...noResult, error: `Gemini ${resp.status}` };
    const data = await resp.json();
    const raw = data.choices?.[0]?.message?.content ?? '';
    let parsed: any;
    try { parsed = JSON.parse(raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()); }
    catch { return { ...noResult, error: 'Gemini JSON parse error' }; }
    const result: GeminiMarketResult = {
      available: true,
      searchTerms: (Array.isArray(parsed.searchTerms) ? parsed.searchTerms : []).filter((s: any) => typeof s === 'string' && s.length > 3).slice(0, 3),
      estimatedLow: Math.max(0, Number(parsed.estimatedLow ?? 0)),
      estimatedMid: Math.max(0, Number(parsed.estimatedMid ?? 0)),
      estimatedHigh: Math.max(0, Number(parsed.estimatedHigh ?? 0)),
      confidence: ['high','medium','low','insufficient'].includes(parsed.confidence) ? parsed.confidence : 'low',
      itemDescription: String(parsed.itemDescription ?? '').slice(0, 300),
      marketContext: String(parsed.marketContext ?? '').slice(0, 300),
      valuationBasis: String(parsed.valuationBasis ?? '').slice(0, 300),
      comparableDescription: String(parsed.comparableDescription ?? '').slice(0, 200),
    };
    console.log(`[SWISH Market v8] Gemini: mid=£${result.estimatedMid} conf=${result.confidence}`);
    return result;
  } catch { return { ...noResult, error: 'AI market estimate is temporarily unavailable.' }; }
}

// ══════════════════════════════════════════════════════════════════════════════
// SEARCH QUERY BUILDER
// ══════════════════════════════════════════════════════════════════════════════
function buildSearchQueries(title: string, attributes: Record<string, any>, specialistId: string, geminiTerms: string[]): string[] {
  const queries: string[] = [];
  const sanitised = sanitiseTitle(title);

  const isBike = specialistId === 'bicycles' || specialistId === 'cycling';
  const isMX = specialistId === 'motocross';
  const isClothing = specialistId === 'clothing' || specialistId === 'trainers_sneakers';
  const isCoin = specialistId.includes('coin') || ['islamic_silver','ancient_artefacts','gold','silver','banknotes'].includes(specialistId);

  // Always put direct, deterministic coin searches ahead of AI-generated terms.
  // Rare coin names often produce weak Gemini keywords, but the user's own words
  // and common numismatic variants are still useful eBay queries.
  if (isCoin && sanitised.length >= 4) {
    const titleLower = sanitised.toLowerCase();
    const coinQueries = [sanitised];
    if (!/\bcoin\b/i.test(sanitised)) coinQueries.push(`${sanitised} coin`);
    // Generic rupee searches need broad denomination variants: eBay titles often
    // say "Indian", "British India", or "1 Rupee" rather than "silver rupee coin".
    if (/\brupees?\b/i.test(titleLower)) {
      coinQueries.push(
        'Indian silver rupee coin',
        'British India silver 1 rupee',
        'silver 1 rupee coin',
        'India 1 rupee silver'
      );
    }

    // Keep deterministic, domain-specific variants before Gemini terms. The
    // function only sends five queries, so fallbacks added later can otherwise
    // be silently truncated and never reach eBay.
    if (/jammu/.test(titleLower) && /kashmir/.test(titleLower)) {
      coinQueries.push(
        'Jammu Kashmir coin',
        'Kashmir rupee silver coin',
        'Ranbir Singh Kashmir rupee',
        'Kashmir rupee coin'
      );
    } else if (/kashmir/.test(titleLower)) {
      coinQueries.push('Kashmir coin', 'Kashmir rupee silver coin', 'Kashmir rupee coin');
    }
    if (/\btanka?s?\b/i.test(titleLower)) {
      coinQueries.push(
        `${sanitised} silver coin`,
        'Islamic silver tanka coin',
        'silver tanka coin'
      );
    }
    if (/\bdirham?s?\b/i.test(titleLower)) {
      coinQueries.push(`${sanitised} Islamic silver coin`, 'Islamic silver dirham coin');
    }
    for (const q of coinQueries) {
      const clean = q.slice(0, 100);
      if (clean.length >= 4 && !queries.includes(clean)) queries.push(clean);
    }
  }

  for (const term of geminiTerms) {
    if (term.length >= 4 && !queries.includes(term)) queries.push(term.slice(0, 100));
  }

  if (isBike) {
    const brand = String(attributes?.manufacturer ?? attributes?.brand ?? '').trim();
    const model = String(attributes?.model ?? attributes?.model_name ?? '').trim();
    const year = String(attributes?.year_range ?? attributes?.year_made ?? '').trim().split('-')[0];
    const frameType = String(attributes?.bike_type ?? attributes?.frame_type ?? '').trim();
    if (brand && model) { const q = [brand, model, year].filter(Boolean).join(' ').slice(0, 100); if (!queries.includes(q)) queries.push(q); }
    if (brand && frameType) { const q = `${brand} ${frameType}`.slice(0, 80); if (!queries.includes(q)) queries.push(q); }
    if (brand) { const q = `${brand} bicycle frame`.slice(0, 60); if (!queries.includes(q)) queries.push(q); }
  }
  if (isMX) {
    const make = String(attributes?.manufacturer ?? attributes?.brand ?? attributes?.make ?? '').trim();
    const model = String(attributes?.model ?? attributes?.model_family ?? '').trim();
    const engine = String(attributes?.engine_size ?? attributes?.displacement ?? '').replace(/[^0-9]/g, '');
    const year = String(attributes?.year_range ?? attributes?.year ?? '').split('-')[0].trim();
    if (make && engine) { const q = [make, model, year, engine ? engine + 'cc' : ''].filter(Boolean).join(' ').slice(0, 100); if (!queries.includes(q)) queries.push(q); }
    if (make) { const q = `${make} motocross`.slice(0, 60); if (!queries.includes(q)) queries.push(q); }
  }
  if (isClothing) {
    const brand = String(attributes?.brand ?? '').trim();
    const garment = String(attributes?.garment_type ?? attributes?.item_type ?? '').trim();
    const era = String(attributes?.era ?? '').trim();
    if (brand && garment) { const q = [brand, garment, era].filter(Boolean).join(' ').slice(0, 100); if (!queries.includes(q)) queries.push(q); }
    if (brand) { const q = `vintage ${brand} ${garment || 'clothing'}`.slice(0, 80); if (!queries.includes(q)) queries.push(q); }
  }
  if (isCoin) {
    // Place/state-only searches are common in coin research. Convert geographic
    // labels into useful numismatic queries instead of searching the raw label
    // (which often produces no eBay matches, e.g. "Jammu & Kashmir (Princely State)").
    if (!attributes?.ruler && !attributes?.denomination) {
      const titleLower = sanitised.toLowerCase();
      if (/jammu/.test(titleLower) && /kashmir/.test(titleLower)) {
        for (const q of [
          'Jammu Kashmir coin',
          'Kashmir rupee silver coin',
          'Ranbir Singh Kashmir rupee',
        ]) if (!queries.includes(q)) queries.push(q);
      } else if (/kashmir/.test(titleLower)) {
        for (const q of ['Kashmir coin', 'Kashmir rupee silver coin']) {
          if (!queries.includes(q)) queries.push(q);
        }
      }
    }
    if (specialistId === 'islamic_silver') {
      const dynasty = String(attributes?.dynasty ?? attributes?.period ?? '').trim();
      const denom = String(attributes?.denomination ?? attributes?.coin_type ?? '').trim();
      if (dynasty && denom) { const q = `${dynasty} ${denom} silver coin`.slice(0, 100); if (!queries.includes(q)) queries.push(q); }
      // More specific secondary: dynasty-only + denom for rare items
      if (dynasty && dynasty.length > 3) { const q = `${dynasty} silver coin`.slice(0, 80); if (!queries.includes(q)) queries.push(q); }
      if (denom && denom.length > 2) { const q = `${denom} Islamic silver coin`.slice(0, 80); if (!queries.includes(q)) queries.push(q); }
      // Broad category fallback for rare Islamic coins
      if (!queries.some(q => q.toLowerCase().includes('islamic'))) queries.push('Islamic silver coin dirham tanka');
      // Very broad numismatic fallback (ensures eBay returns something for scoring)
      if (!queries.some(q => q.toLowerCase().includes('ancient'))) queries.push('ancient Islamic silver coin');
    } else if (specialistId === 'ancient_artefacts') {
      const period = String(attributes?.period ?? attributes?.dynasty ?? '').trim();
      const type = String(attributes?.object_type ?? attributes?.denomination ?? '').trim();
      if (period && type) { const q = `${period} ${type}`.slice(0, 80); if (!queries.includes(q)) queries.push(q); }
      if (period) { const q = `${period} ancient artefact`.slice(0, 60); if (!queries.includes(q)) queries.push(q); }
    } else {
      const ruler = String(attributes?.ruler ?? '').trim();
      const denom = String(attributes?.denomination ?? '').trim();
      const year = String(attributes?.year_made ?? '').trim();
      const mint = String(attributes?.mint ?? '').trim();
      if (ruler && denom) { const q = [ruler, denom, year].filter(Boolean).join(' ').slice(0, 100); if (!queries.includes(q)) queries.push(q); }
      // Broader ruler-only fallback for rare coins
      if (ruler && ruler.length > 4 && !queries.some(q => q.includes(ruler) && !q.includes(denom))) {
        const q = `${ruler} coin`.slice(0, 60);
        if (!queries.includes(q)) queries.push(q);
      }
    }
  }
  // Short clean title as next-to-last resort
  // For rare/niche items, strip the dynasty/ruler from front to get the coin type
  const cleanTitle = sanitised.slice(0, 80);
  if (cleanTitle.length >= 4 && !queries.includes(cleanTitle)) queries.push(cleanTitle);
  // 2-3 word version as absolute fallback (most likely to return eBay results)
  const shortWords = cleanTitle.split(' ').filter(w => w.length > 3).slice(0, 3).join(' ');
  if (shortWords.length >= 4 && !queries.includes(shortWords)) queries.push(shortWords);

  return queries.filter((q, i, arr) => q.length >= 3 && arr.indexOf(q) === i).slice(0, 5);
}

// ══════════════════════════════════════════════════════════════════════════════
// RELEVANCE SCORING (for Browse API active listings)
// ══════════════════════════════════════════════════════════════════════════════
function scoreListing(title: string, price: number, targetTitle: string, targetAttrs: Record<string, any>, specialistId: string): { score: number; reason: string } {
  const compLower = title.toLowerCase();
  const targetLower = sanitiseTitle(targetTitle).toLowerCase();
  const targetWords = targetLower.split(/\s+/).filter(w => w.length > 2);
  const matched = targetWords.filter(w => compLower.includes(w));
  const overlap = targetWords.length > 0 ? matched.length / targetWords.length : 0;
  let score = 0.40;
  if (overlap >= 0.70) score += 0.25; else if (overlap >= 0.50) score += 0.15; else if (overlap >= 0.35) score += 0.07; else if (overlap >= 0.20) score += 0.02; else score -= 0.15;

  const isBike = specialistId === 'bicycles' || specialistId === 'cycling';
  const isMX = specialistId === 'motocross';
  const isClothing = specialistId === 'clothing' || specialistId === 'trainers_sneakers';
  const isCoin = specialistId.includes('coin') || ['islamic_silver','ancient_artefacts','gold','silver'].includes(specialistId);

  if (isBike) { const brand = String(targetAttrs?.manufacturer ?? targetAttrs?.brand ?? '').toLowerCase(); const model = String(targetAttrs?.model ?? '').toLowerCase(); if (brand && compLower.includes(brand)) score += 0.15; if (model && model.length > 2 && compLower.includes(model.split(' ')[0])) score += 0.10; }
  if (isMX) { const make = String(targetAttrs?.manufacturer ?? targetAttrs?.brand ?? '').toLowerCase(); const engine = String(targetAttrs?.engine_size ?? '').replace(/[^0-9]/g, ''); if (make && compLower.includes(make)) score += 0.18; if (engine && compLower.includes(engine)) score += 0.10; }
  if (isClothing) { const brand = String(targetAttrs?.brand ?? '').toLowerCase(); if (brand && compLower.includes(brand)) score += 0.20; }
  if (isCoin) {
    const denom = String(targetAttrs?.denomination ?? '').toLowerCase();
    const ruler = String(targetAttrs?.ruler ?? '').toLowerCase();
    if (denom && denom.length > 1 && compLower.includes(denom)) score += 0.15;
    if (ruler && ruler.length > 2 && compLower.includes(ruler.split(' ').pop() ?? ruler)) score += 0.12;
    if (specialistId === 'islamic_silver' && ['islamic','dirham','dinar','tanka','tanker','umayyad','abbasid','fatimid','silver coin','arabic'].some(k => compLower.includes(k))) score += 0.18;
  }
  if (price > 5000) score -= 0.10;
  return { score: Math.max(0, Math.min(1, score)), reason: `${Math.round(overlap * 100)}% title match` };
}

// ══════════════════════════════════════════════════════════════════════════════
// VALUATION COMPUTATION — v7 TERAPEAK-FIRST STRATEGY
// ══════════════════════════════════════════════════════════════════════════════

interface ComputedValuation {
  valuationLow: number; valuationMid: number; valuationHigh: number;
  valuationConfidence: string; valuationMethod: string; valuationWarnings: string[];
  recommendedListingPrice: number;
  recommendedListingFormat: 'Auction' | 'BuyItNow' | 'BuyItNow_WithBestOffer';
  listingPriceRationale: string;
  saleProb30d: number | null; fairMarketValue: number; currentAskingMarketMid: number;
  auctionStartPrice?: number;
  insufficientSoldEvidence: boolean;
  primaryEvidenceSource: 'terapeak' | 'marketplace_insights' | 'browse_ai_blend' | 'ai_estimate_only' | 'none';
}

function computeValuation(params: {
  terapeak: TeapeakResult;
  browseResults: BrowseSearchResult[];
  gemini: GeminiMarketResult;
  visualSearch: VisualSearchResult;
  targetTitle: string; targetAttrs: Record<string, any>;
  specialistId: string; identificationConfidence: number;
  identificationTier: string; condition: string;
}): ComputedValuation {
  const { terapeak, browseResults, gemini, visualSearch, targetTitle, targetAttrs, specialistId, identificationConfidence, condition } = params;

  const noVal: ComputedValuation = {
    valuationLow: 0, valuationMid: 0, valuationHigh: 0,
    valuationConfidence: 'insufficient_data', valuationMethod: 'no_data',
    valuationWarnings: ['INSUFFICIENT SOLD-MARKET EVIDENCE — no comparable sold data available.'],
    recommendedListingPrice: 0, recommendedListingFormat: 'BuyItNow',
    listingPriceRationale: 'INSUFFICIENT SOLD-MARKET EVIDENCE. Research manually on eBay Seller Hub before listing.',
    saleProb30d: null, fairMarketValue: 0, currentAskingMarketMid: 0,
    insufficientSoldEvidence: true, primaryEvidenceSource: 'none',
  };

  const warnings: string[] = [];

  // ── CASE 1: TERAPEAK — genuine sold data (class A) ─────────────────────────
  // This is the primary valuation signal. Used when Terapeak returns sold data.
  if (terapeak.available && terapeak.averageSoldPrice > 0) {
    const avg = terapeak.averageSoldPrice;
    const median = terapeak.medianConditionPrice > 0 ? terapeak.medianConditionPrice : avg;
    const soldQty = terapeak.soldQuantity;

    // IQR estimate: use price range if available, else ±30% around average
    const pMin = terapeak.priceMin > 0 ? terapeak.priceMin : avg * 0.65;
    const pMax = terapeak.priceMax > 0 ? terapeak.priceMax : avg * 1.35;

    // Conservative low: 25th-pct estimate; high: 85th-pct estimate
    const valuationLow  = Math.round(Math.max(pMin, avg * 0.70) * 100) / 100;
    const valuationMid  = Math.round(median * 100) / 100;
    const valuationHigh = Math.round(Math.min(pMax, avg * 1.30) * 100) / 100;

    // Confidence based on sold quantity and sell-through rate
    const conf = soldQty >= 20 ? 'high'
      : soldQty >= 8  ? 'medium'
      : soldQty >= 3  ? 'low'
      : 'very_low';

    // Lower confidence further if identification confidence is weak
    const adjConf = identificationConfidence < 0.50 && conf === 'high' ? 'medium'
      : identificationConfidence < 0.40 ? 'very_low' : conf;

    // Recommend listing price: 5-8% below median (eBay fees ≈ 12.9%, so mid net ≈ 87%)
    const listPrice = Math.round(valuationMid * 0.95 * 100) / 100;

    // Sell-through informs format recommendation
    const sth = terapeak.sellThroughRate ?? 0;
    const format: 'Auction' | 'BuyItNow' | 'BuyItNow_WithBestOffer' = sth > 0.60 ? 'BuyItNow' : sth > 0.30 ? 'BuyItNow_WithBestOffer' : 'Auction';

    warnings.push(`TERAPEAK: ${soldQty} verified sold items on EBAY_GB in the last 3 months (avg £${avg.toFixed(2)}). This is genuine historical sold data.`);
    if (terapeak.conditionDistributions.length > 0) {
      const condStr = terapeak.conditionDistributions.map(c => `${c.conditionName}: avg £${c.averageSoldPrice.toFixed(0)} (${c.soldQuantity} sold)`).join(' | ');
      warnings.push(`Condition breakdown: ${condStr}`);
    }
    if (terapeak.sellThroughRate !== null) warnings.push(`Sell-through rate: ${Math.round(terapeak.sellThroughRate * 100)}% (${terapeak.liveListings} active listings)`);

    return {
      valuationLow, valuationMid, valuationHigh,
      valuationConfidence: adjConf, valuationMethod: 'terapeak_verified_sold_data',
      valuationWarnings: warnings,
      recommendedListingPrice: listPrice, recommendedListingFormat: format,
      listingPriceRationale: `${soldQty} verified sold items on eBay GB (avg £${avg.toFixed(2)}, range £${pMin.toFixed(0)}–£${pMax.toFixed(0)}). Recommended list price: £${listPrice.toFixed(2)} (5% below median). ${format === 'Auction' ? 'Low sell-through — consider auction format.' : 'Good sell-through — BIN recommended.'}`,
      saleProb30d: terapeak.sellThroughRate != null ? Math.min(terapeak.sellThroughRate, 0.99) : null,
      fairMarketValue: valuationMid, currentAskingMarketMid: 0,
      insufficientSoldEvidence: false, primaryEvidenceSource: 'terapeak',
    };
  }

  // ── CASE 2: BROWSE + GEMINI (Terapeak unavailable/no results) ─────────────
  const allActive: Array<{ title: string; price: number; score: number; listingType: string }> = [];
  const seenKeys = new Set<string>();
  const totalBrowseRaw = browseResults.reduce((sum, r) => sum + r.items.length, 0);
  const MIN_RELEVANCE = totalBrowseRaw < 10 ? 0.28 : 0.35;

  for (const result of browseResults) {
    for (const item of result.items) {
      const key = `${Math.round(item.price)}-${item.title.slice(0, 20)}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      const { score } = scoreListing(item.title, item.price, targetTitle, targetAttrs, specialistId);
      if (score >= MIN_RELEVANCE) allActive.push({ title: item.title, price: item.price, score, listingType: item.listingType });
    }
  }

  const askingPrices = [...allActive.map(i => i.price), ...visualSearch.items.map(i => i.price)].sort((a, b) => a - b);
  const askingMedian = askingPrices.length > 0 ? askingPrices[Math.floor(askingPrices.length / 2)] : 0;
  const relevantActiveCount = allActive.length;

  // Why Terapeak failed — only surface as a warning if re-auth is needed.
  // 404 (no eBay Store subscription) is silent — it's an account tier limitation, not an error.
  if (terapeak.needsReauth) {
    warnings.push(`TERAPEAK UNAVAILABLE: Re-authorise eBay in Marketplaces to unlock Terapeak sold data (sell.analytics.readonly scope required).`);
  }
  // 404 errors (no subscription) logged to console only — not surfaced to user

  if (relevantActiveCount >= 5 && gemini.available && gemini.estimatedMid > 0) {
    const activePrices = allActive.map(i => i.price).sort((a, b) => a - b);
    const n = activePrices.length;
    const askMedian = activePrices[Math.floor(n / 2)];
    const blendedMid = Math.round((askMedian * 0.50 + gemini.estimatedMid * 0.50) * 100) / 100;
    const blendedLow = Math.round(Math.min(activePrices[Math.floor(n * 0.15)], gemini.estimatedLow > 0 ? gemini.estimatedLow : activePrices[0]) * 100) / 100;
    const blendedHigh = Math.round(Math.max(activePrices[Math.floor(n * 0.85)], gemini.estimatedHigh > 0 ? gemini.estimatedHigh : activePrices[n - 1]) * 100) / 100;
    warnings.push(`EVIDENCE: ${relevantActiveCount} active eBay listings (ASKING prices, not sold). Blended with AI estimate. No verified sold data.`);
    warnings.push(`AI estimate basis: ${gemini.valuationBasis}`);
    return {
      valuationLow: blendedLow, valuationMid: blendedMid, valuationHigh: blendedHigh,
      valuationConfidence: gemini.confidence === 'high' ? 'low' : 'very_low',
      valuationMethod: 'active_asking_prices_and_ai_estimate', valuationWarnings: warnings,
      recommendedListingPrice: Math.round(blendedMid * 0.93 * 100) / 100, recommendedListingFormat: 'BuyItNow_WithBestOffer',
      listingPriceRationale: `INDICATIVE ONLY: ${relevantActiveCount} active listings (median asking £${Math.round(askMedian)}) + AI estimate £${gemini.estimatedMid}. No verified sold data. Re-authorise eBay for Terapeak sold data.`,
      saleProb30d: null, fairMarketValue: blendedMid, currentAskingMarketMid: Math.round(askMedian * 100) / 100,
      insufficientSoldEvidence: true, primaryEvidenceSource: 'browse_ai_blend',
    };
  }

  if (gemini.available && gemini.estimatedMid > 0) {
    // Map Gemini confidence → valuation confidence label
    // FIX v8: medium/low confidence now always produces a listing price recommendation.
    // Only 'insufficient' blocks a price recommendation.
    const confMap: Record<string, string> = { high: 'low', medium: 'very_low', low: 'very_low', insufficient: 'insufficient_data' };
    const activeCount = browseResults.reduce((sum, r) => sum + r.items.length, 0);
    if (activeCount > 0) warnings.push(`${activeCount} eBay active listings found (none were relevant comparables for this niche item).`);
    warnings.push(`AI estimate basis: ${gemini.valuationBasis}`);
    warnings.push('EVIDENCE: AI training-data estimate only. Not verified sold prices. Use as a guide only.');
    const valConf = confMap[gemini.confidence] ?? 'very_low';
    // FIX: always produce a listing price for high/medium/low Gemini confidence.
    // Previously 'insufficient_data' (from 'insufficient' Gemini conf) blocked price;
    // all other cases now always produce a price.
    const isInsufficientConf = gemini.confidence === 'insufficient';
    const listPrice = isInsufficientConf ? 0 : Math.round(gemini.estimatedMid * 0.93 * 100) / 100;
    return {
      valuationLow: gemini.estimatedLow, valuationMid: gemini.estimatedMid, valuationHigh: gemini.estimatedHigh,
      valuationConfidence: valConf, valuationMethod: 'ai_market_estimate_gemini_vision', valuationWarnings: warnings,
      recommendedListingPrice: listPrice, recommendedListingFormat: 'BuyItNow_WithBestOffer',
      listingPriceRationale: isInsufficientConf
        ? 'AI confidence too low to recommend a listing price. Research on eBay Seller Hub for comparable sold items.'
        : `AI estimate (${gemini.confidence} confidence): £${gemini.estimatedMid} (range £${gemini.estimatedLow}–£${gemini.estimatedHigh}). ${gemini.marketContext} Recommended start: £${listPrice.toFixed(2)} (7% below AI mid estimate). Enable Terapeak for verified sold data.`,
      saleProb30d: null, fairMarketValue: gemini.estimatedMid, currentAskingMarketMid: Math.round(askingMedian * 100) / 100,
      insufficientSoldEvidence: true, primaryEvidenceSource: 'ai_estimate_only',
    };
  }

  return noVal;
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN HANDLER
// ══════════════════════════════════════════════════════════════════════════════
Deno.serve(async (req: Request) => {
  try {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  let body: any;
  try { body = await req.json(); } catch { return jsonResponse({ error: 'Invalid JSON' }, 400); }

  const {
    tenantId, itemId, title,
    specialistId = 'curiosities_collectibles', attributes = {}, condition = '',
    identificationConfidence = 0.5, identificationTier = 'medium',
    numistaTypeId, numistaMatchScore = 0, numistaMatchTier = 'no_match',
    applyToItem = false, imageUrls: callerImageUrls, imageBase64: callerImageBase64,
  } = body;

  if (!tenantId) return jsonResponse({ error: 'tenantId is required' }, 400);
  if (typeof title !== 'string' || title.trim().length < 3) return jsonResponse({ error: 'title is required (min 3 chars)' }, 400);
  if (typeof specialistId !== 'string' || !specialistId.trim()) return jsonResponse({ error: 'specialistId must be a non-empty string' }, 400);

  const supabase = adminClient();
  const authHeader = req.headers.get('Authorization');
  const sec = await verifyTenantAccess(supabase, authHeader, tenantId);
  if (!sec.ok) return jsonResponse({ error: sec.error }, authHeader ? 403 : 401);

  const cleanTitle = sanitiseTitle(title);
  console.log(`[SWISH Market v7] title="${cleanTitle}" specialist=${specialistId}`);

  // ── Credentials + token refresh ────────────────────────────────────────────
  const creds = await getAndRefreshConnectorCreds(supabase, tenantId);
  if (!creds) {
    return jsonResponse({ error: 'eBay is not connected. Connect eBay in Marketplaces to enable market valuation.' }, 400);
  }
  console.log(`[SWISH Market v7] Token: expires=${creds.expiresAt} hasAnalyticsScope=${creds.hasAnalyticsScope}`);

  // ── Item ownership and niche isolation ─────────────────────────────────────
  // Always verify an item ID, even when the caller also supplies image URLs.
  // Otherwise a request could attach another niche's item ID to a different
  // specialist context while still passing tenant-level access checks.
  let itemRow: any = null;
  if (itemId) {
    const { data, error } = await supabase.from('items')
      .select('media, specialist_id')
      .eq('id', itemId)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (error || !data) return jsonResponse({ error: 'Item not found in this tenant.' }, 404);
    itemRow = data;

    const itemProduct = productForSpecialist(itemRow.specialist_id);
    const requestedProduct = productForSpecialist(specialistId);
    if (!itemProduct || !requestedProduct || itemProduct !== requestedProduct) {
      return jsonResponse({ error: 'Item and valuation specialist belong to different products.' }, 403);
    }
  }

  // ── Item images ────────────────────────────────────────────────────────────
  let imageUrls: string[] = [];
  if (Array.isArray(callerImageUrls) && callerImageUrls.length > 0) {
    imageUrls = callerImageUrls.filter((u: string) => typeof u === 'string' && u.startsWith('https://'));
  } else if (itemId) {
    imageUrls = ((itemRow?.media ?? []) as string[]).filter(u => typeof u === 'string' && u.startsWith('https://'));
  }
  // Research Centre sends a local image as a data URL. Keep it in-memory only:
  // it is never persisted to the database or written to logs.
  const inlineImageBase64 = typeof callerImageBase64 === 'string'
    && /^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(callerImageBase64)
    && callerImageBase64.length <= 7_000_000
      ? callerImageBase64
      : '';
  console.log(`[SWISH Market v8] Images: ${imageUrls.length + (inlineImageBase64 ? 1 : 0)}`);

  // ── Phase 1: Gemini + App token (parallel, non-blocking) ──────────────────
  const [gemini, appToken] = await Promise.all([
    runGeminiMarketResearch(imageUrls, cleanTitle, specialistId, attributes, condition, inlineImageBase64),
    getEbayAppToken(creds.clientId, creds.clientSecret),
  ]);
  console.log(`[SWISH Market v7] Gemini: available=${gemini.available} mid=£${gemini.estimatedMid} conf=${gemini.confidence}`);

  // CANOA covers ancient-world reference catalogues; keep it supplementary and
  // non-blocking. Modern/princely-state and Islamic coin coverage may be absent.
  const isCoinResearch = specialistId.toLowerCase().includes('coin')
    || ['islamic_silver', 'ancient_artefacts', 'gold', 'silver', 'banknotes'].includes(specialistId);
  const canoaPromise = isCoinResearch
    ? searchCanoaCoinTypes(cleanTitle)
    : Promise.resolve({ available: false, query: cleanTitle, items: [] as CanoaCoinCandidate[] });

  // ── Build search queries ───────────────────────────────────────────────────
  const searchQueries = buildSearchQueries(cleanTitle, attributes, specialistId, gemini.searchTerms);
  console.log(`[SWISH Market v7] Queries: ${searchQueries.map((q, i) => `[${i + 1}] "${q}"`).join(', ')}`);

  // ── Phase 2: Terapeak + Browse + Visual (parallel first query) ────────────
  const primaryQuery = searchQueries[0];

  const [teapeakResult, firstBrowseResult, visualSearch, firstSoldSearch] = await Promise.all([
    callTerapeak(creds.accessToken, primaryQuery, 'PREVIOUS_3_MONTHS'),
    searchEbayBrowse(creds.accessToken, primaryQuery, 50, false, appToken),
    (appToken && (inlineImageBase64 || imageUrls.length > 0)) ? runEbayVisualSearch(inlineImageBase64 || imageUrls[0], appToken) : Promise.resolve<VisualSearchResult>({ available: false, items: [], totalFound: 0 }),
    searchEbaySoldListings(appToken, primaryQuery, 50),
  ]);

  // Mark credential as having analytics scope if Terapeak succeeded
  if (teapeakResult.available && !creds.hasAnalyticsScope) {
    try {
      const currentCreds = await decryptCredentials((await supabase.from('marketplace_connectors').select('credential_ref').eq('tenant_id', tenantId).eq('marketplace_id', 'ebay').maybeSingle()).data?.credential_ref ?? '');
      const updated = await encryptCredentials({ ...currentCreds, hasAnalyticsScope: true });
      await supabase.from('marketplace_connectors').update({ credential_ref: updated }).eq('tenant_id', tenantId).eq('marketplace_id', 'ebay');
    } catch {}
  }

  // ── Fallback Browse queries — sequential with marketplace expansion ─────────
  // Active listings are valuable market context even when Terapeak is connected
  // but has no matching sales. For rare coins, never gate active-search fallback
  // on the API's "available" flag: available can mean the request succeeded but
  // returned no useful sold evidence.
  //   1. If the primary query returns fewer than 8 active listings, try the
  //      deterministic coin variants and Gemini alternatives with EBAY_GB filter.
  //   2. If still < 5 results, try the broadest query without marketplace filter
  //      to include international listings.
  const browseResults: BrowseSearchResult[] = [firstBrowseResult];
  const needsMoreBrowse = firstBrowseResult.items.length < 8 && searchQueries.length > 1;
  if (needsMoreBrowse) {
    for (const query of searchQueries.slice(1)) {
      await sleep(500);
      const result = await searchEbayBrowse(creds.accessToken, query, 40, false, appToken);
      browseResults.push(result);
      const totalSoFar = browseResults.reduce((sum, r) => sum + r.items.length, 0);
      if (totalSoFar >= 12) break;
    }
    // If still very thin results, try the broadest query without marketplace restriction
    // to surface international listings (useful for rare Islamic/ancient coins)
    const totalAfterFallbacks = browseResults.reduce((sum, r) => sum + r.items.length, 0);
    if (totalAfterFallbacks < 5) {
      const broadQuery = searchQueries[searchQueries.length - 1]; // last = broadest
      console.log(`[SWISH Market v8] Very thin results (${totalAfterFallbacks}) — trying global Browse (no marketplace filter): "${broadQuery}"`);
      await sleep(400);
      const globalResult = await searchEbayBrowse(creds.accessToken, broadQuery, 30, true, appToken);
      if (globalResult.items.length > 0) {
        browseResults.push(globalResult);
        console.log(`[SWISH Market v8] Global Browse returned ${globalResult.items.length} additional items`);
      }
    }
  }

  // If Terapeak returned zero but didn't 403/404, try a broader Terapeak query
  let teapeakBroadResult: TeapeakResult | null = null;
  if (!teapeakResult.available && !teapeakResult.needsReauth && teapeakResult.httpStatus !== 404 && searchQueries.length > 1) {
    console.log(`[SWISH Market v8] Terapeak zero results — trying broader query "${searchQueries[1]}"`);
    teapeakBroadResult = await callTerapeak(creds.accessToken, searchQueries[1], 'PREVIOUS_3_MONTHS');
  }

  const finalTerapeak = teapeakResult.available ? teapeakResult : (teapeakBroadResult?.available ? teapeakBroadResult : teapeakResult);

  // If the primary sold query is empty, try one more specific query before giving up.
  let finalSoldSearch = firstSoldSearch;
  if ((!finalSoldSearch.available || finalSoldSearch.items.length === 0) && searchQueries.length > 1) {
    finalSoldSearch = await searchEbaySoldListings(appToken, searchQueries[1], 50);
  }
  const totalBrowseItems = browseResults.reduce((sum, r) => sum + r.items.length, 0);
  console.log(`[SWISH Market v8] Browse total: ${totalBrowseItems} items across ${browseResults.length} queries`);
  console.log(`[SWISH Market v8] Terapeak: available=${finalTerapeak.available} sold=${finalTerapeak.soldQuantity} avg=£${finalTerapeak.averageSoldPrice} needsReauth=${finalTerapeak.needsReauth} httpStatus=${finalTerapeak.httpStatus}`);
  console.log(`[SWISH Market v8] Marketplace Insights: available=${finalSoldSearch.available} soldItems=${finalSoldSearch.items.length} httpStatus=${finalSoldSearch.httpStatus ?? 'n/a'}`);

  // ── MX running status ──────────────────────────────────────────────────────
  const isMX = specialistId === 'motocross';
  const MX_MULTIPLIERS: Record<string, number> = {
    'Runs and rides (stated)': 1.00, 'Runs & Rides': 1.00, 'Runs (stated)': 0.85,
    'Non-running (stated)': 0.55, 'Non-Running': 0.55, 'Project': 0.50,
    'Non-running (visible evidence)': 0.50, 'Unknown from images alone': 0.70, 'Unknown': 0.70,
  };
  const mxRunningStatus = isMX ? (attributes?.running_status ?? 'Unknown') : null;
  const mxMultiplier = isMX ? (MX_MULTIPLIERS[mxRunningStatus ?? ''] ?? 0.70) : 1.0;

  // ── Compute valuation ──────────────────────────────────────────────────────
  let valuation = computeValuation({
    terapeak: finalTerapeak, browseResults, gemini, visualSearch,
    targetTitle: cleanTitle, targetAttrs: attributes,
    specialistId, identificationConfidence, identificationTier, condition,
  });

  const soldComparableItems = finalSoldSearch.items
    .map(item => ({ ...item, score: scoreListing(item.title, item.price, cleanTitle, attributes, specialistId).score }))
    .filter(item => item.score >= 0.35)
    .filter((item, index, all) => all.findIndex(other =>
      other.itemId && item.itemId ? other.itemId === item.itemId :
      other.title.toLowerCase() === item.title.toLowerCase() && other.price === item.price
    ) === index)
    .sort((a, b) => a.price - b.price);
  if ((!finalTerapeak.available || finalTerapeak.averageSoldPrice <= 0) && soldComparableItems.length > 0) {
    const prices = soldComparableItems.map(item => item.price);
    const median = prices[Math.floor(prices.length / 2)];
    const low = prices[Math.floor((prices.length - 1) * 0.15)];
    const high = prices[Math.floor((prices.length - 1) * 0.85)];
    const confidence = soldComparableItems.length >= 8 ? 'medium' : soldComparableItems.length >= 3 ? 'low' : 'very_low';
    const idAdjustedConfidence = identificationConfidence < 0.4 ? 'very_low' : identificationConfidence < 0.5 && confidence === 'medium' ? 'low' : confidence;
    const listPrice = Math.round(median * 0.95 * 100) / 100;
    valuation = {
      valuationLow: Math.round(low * 100) / 100,
      valuationMid: Math.round(median * 100) / 100,
      valuationHigh: Math.round(high * 100) / 100,
      valuationConfidence: idAdjustedConfidence,
      valuationMethod: 'marketplace_insights_verified_sold_comparables',
      valuationWarnings: [
        `Marketplace Insights returned ${soldComparableItems.length} title-relevant sold listings; active asking prices were excluded from this estimate.`,
        ...(identificationConfidence < 0.5 ? ['Identification confidence is limited; treat the valuation range cautiously.'] : []),
      ],
      recommendedListingPrice: listPrice,
      recommendedListingFormat: 'BuyItNow_WithBestOffer',
      listingPriceRationale: `${soldComparableItems.length} relevant sold listings; median £${median.toFixed(2)}, indicative range £${low.toFixed(2)}–£${high.toFixed(2)}. Recommended starting price £${listPrice.toFixed(2)}.`,
      saleProb30d: null,
      fairMarketValue: median,
      currentAskingMarketMid: 0,
      insufficientSoldEvidence: soldComparableItems.length < 3,
      primaryEvidenceSource: 'marketplace_insights',
    };
  }

  if (isMX && mxMultiplier < 1.0 && valuation.valuationMid > 0) {
    const m = mxMultiplier;
    valuation = {
      ...valuation,
      valuationLow: Math.round(valuation.valuationLow * m * 100) / 100,
      valuationMid: Math.round(valuation.valuationMid * m * 100) / 100,
      valuationHigh: Math.round(valuation.valuationHigh * m * 100) / 100,
      fairMarketValue: Math.round(valuation.fairMarketValue * m * 100) / 100,
      recommendedListingPrice: Math.round(valuation.recommendedListingPrice * m * 100) / 100,
      listingPriceRationale: `${valuation.listingPriceRationale} [Running status: ${mxRunningStatus} = ${Math.round(m * 100)}% of comparables]`,
    };
  }

  // ── Apply to item ──────────────────────────────────────────────────────────
  let applied = false;
  if (applyToItem && itemId && valuation.valuationMid > 0) {
    try {
      await supabase.from('items').update({
        valuation_low: valuation.valuationLow, valuation_mid: valuation.valuationMid,
        valuation_high: valuation.valuationHigh, valuation_confidence: valuation.valuationConfidence,
        expected_selling_price: valuation.recommendedListingPrice,
        sale_prob_30d: valuation.saleProb30d, updated_at: new Date().toISOString(),
      }).eq('id', itemId).eq('tenant_id', tenantId);
      applied = true;
    } catch { console.log('[SWISH Market v7] Auto-apply failed.'); }
  }

  // ── Top comparables for audit trail ───────────────────────────────────────
  const allActiveFlat = browseResults.flatMap(r => r.items);
  const topComparables = allActiveFlat
    .map(i => { const { score, reason } = scoreListing(i.title, i.price, cleanTitle, attributes, specialistId); return { ...i, score, reason }; })
    .sort((a, b) => b.score - a.score)
    .slice(0, 12)
    .map(i => ({ title: i.title.slice(0, 80), price: i.price, currency: i.currency, condition: i.condition, listingType: i.listingType, score: Math.round(i.score * 100), url: i.url, itemUrl: i.url, imageUrl: i.imageUrl, evidenceClass: 'B_active_asking_price' }));
  const relevantActiveCount = topComparables.filter(i => i.score >= 28).length;

  console.log(`[SWISH Market v8] Final: mid=£${valuation.valuationMid} conf=${valuation.valuationConfidence} method=${valuation.primaryEvidenceSource} teapeakSold=${finalTerapeak.soldQuantity} listPrice=£${valuation.recommendedListingPrice}`);

  // ── Build response ─────────────────────────────────────────────────────────
  return jsonResponse({
    success: true,
    version: 'v9',
    searchQuery: searchQueries[0],
    searchQueriesUsed: searchQueries,
    valuation,

    verifiedSoldResearch: {
      source: soldComparableItems.length > 0 && (!finalTerapeak.available || finalTerapeak.averageSoldPrice <= 0)
        ? 'ebay_marketplace_insights'
        : finalTerapeak.available ? 'ebay_product_research_aggregate' : 'none',
      available: soldComparableItems.length > 0 || finalTerapeak.available,
      accessStatus: finalSoldSearch.httpStatus ?? null,
      accessError: finalSoldSearch.error ?? null,
      query: finalSoldSearch.items.length > 0 ? primaryQuery : finalSoldSearch.error ? primaryQuery : null,
      soldCount: soldComparableItems.length > 0 && (!finalTerapeak.available || finalTerapeak.averageSoldPrice <= 0)
        ? soldComparableItems.length : finalTerapeak.soldQuantity,
      averageSoldPrice: soldComparableItems.length > 0 && (!finalTerapeak.available || finalTerapeak.averageSoldPrice <= 0)
        ? Math.round(soldComparableItems.reduce((sum, item) => sum + item.price, 0) / soldComparableItems.length * 100) / 100
        : finalTerapeak.averageSoldPrice,
      medianSoldPrice: soldComparableItems.length > 0 && (!finalTerapeak.available || finalTerapeak.averageSoldPrice <= 0)
        ? soldComparableItems[Math.floor(soldComparableItems.length / 2)].price
        : finalTerapeak.medianConditionPrice,
      lowSoldPrice: soldComparableItems.length > 0 && (!finalTerapeak.available || finalTerapeak.averageSoldPrice <= 0)
        ? soldComparableItems[0].price : finalTerapeak.priceMin,
      highSoldPrice: soldComparableItems.length > 0 && (!finalTerapeak.available || finalTerapeak.averageSoldPrice <= 0)
        ? soldComparableItems[soldComparableItems.length - 1].price : finalTerapeak.priceMax,
      items: soldComparableItems.slice(0, 12).map(item => ({
        title: item.title, price: item.price, currency: item.currency, condition: item.condition,
        soldDate: item.soldDate, itemUrl: item.url, imageUrl: item.imageUrl, itemId: item.itemId,
        relevanceScore: Math.round(item.score * 100),
      })),
      note: soldComparableItems.length > 0
        ? 'Sold item prices are from eBay Marketplace Insights and filtered for title relevance.'
        : finalTerapeak.available
          ? 'Product Research provides aggregate sold statistics; individual sold items were not returned.'
          : 'Individual sold-item access depends on eBay Marketplace Insights API approval. Active listings are not sold evidence.',
    },

    // ── TERAPEAK — GENUINE SOLD DATA (class A) ───────────────────────────────
    // This is the primary valuation signal in v7.
    // Available when the eBay account has been authorised with sell.analytics.readonly scope.
    teapeakProductResearch: {
      available: finalTerapeak.available,
      needsReauth: finalTerapeak.needsReauth,
      evidenceClass: 'A_verified_sold_transactions',
      evidenceNote: finalTerapeak.available
        ? 'Genuine historical sold transaction data from eBay Seller Hub / Terapeak Product Research. This is the same data shown in eBay Research tab.'
        : finalTerapeak.needsReauth
          ? 'Terapeak requires re-authorisation with sell.analytics.readonly scope. Reconnect eBay in Marketplaces settings.'
          : finalTerapeak.httpStatus === 404
            ? 'Terapeak not available for this account (eBay Store subscription required). Using AI estimate + Browse API instead.'
            : finalTerapeak.error ?? 'Terapeak returned no sold data for this query',
      soldQuantity: finalTerapeak.soldQuantity,
      averageSoldPrice: finalTerapeak.averageSoldPrice,
      medianConditionPrice: finalTerapeak.medianConditionPrice,
      priceRange: finalTerapeak.priceRangeDisplay,
      priceMin: finalTerapeak.priceMin,
      priceMax: finalTerapeak.priceMax,
      sellThroughRate: finalTerapeak.sellThroughRate,
      liveListings: finalTerapeak.liveListings,
      conditionDistributions: finalTerapeak.conditionDistributions,
      salesTrend: finalTerapeak.salesTrend.slice(0, 6),
      topSoldListings: finalTerapeak.topSoldListings,
      query: finalTerapeak.query,
      metricPeriod: finalTerapeak.metricPeriod,
      retrievedAt: finalTerapeak.retrievedAt,
    },

    // ── SOLD MARKET (legacy field — now populated from Terapeak when available) ─
    soldMarket: {
      verifiedSoldCount: finalTerapeak.soldQuantity,
      relevantSoldCount: finalTerapeak.soldQuantity,   // Terapeak pre-filters by query
      excludedSoldCount: 0,
      medianPrice: finalTerapeak.medianConditionPrice > 0 ? finalTerapeak.medianConditionPrice : finalTerapeak.averageSoldPrice,
      weightedMedianPrice: finalTerapeak.averageSoldPrice,
      lowPrice: finalTerapeak.priceMin,
      highPrice: finalTerapeak.priceMax,
      auctionMedian: 0,
      binMedian: finalTerapeak.averageSoldPrice,
      auctionShare: 0,
      dateRange: finalTerapeak.available ? `Last 3 months (${finalTerapeak.metricPeriod})` : 'unknown',
      dataQuality: finalTerapeak.available
        ? (finalTerapeak.soldQuantity >= 20 ? 'strong' : finalTerapeak.soldQuantity >= 5 ? 'moderate' : 'weak')
        : 'insufficient',
      dataQualityReason: finalTerapeak.available
        ? `Terapeak Product Research: ${finalTerapeak.soldQuantity} verified sales on EBAY_GB in the last 3 months`
        : finalTerapeak.needsReauth
          ? 'Re-authorise eBay with sell.analytics.readonly scope to enable Terapeak sold data'
          : `Terapeak: ${finalTerapeak.error ?? 'no data'}`,
      exceptionalSales: finalTerapeak.topSoldListings.filter(l => l.price > finalTerapeak.averageSoldPrice * 1.5).map(l => ({ title: l.title, price: l.price, date: '' })),
      sampleExclusions: [],
      teapeakActive: finalTerapeak.available,
    },

    // ── GEMINI (class E) ─────────────────────────────────────────────────────
    geminiMarketResearch: gemini.available ? {
      available: true, evidenceClass: 'E_ai_inference',
      evidenceNote: 'AI market estimate from Gemini Vision — NOT verified eBay sold transactions.',
      itemDescription: gemini.itemDescription, marketContext: gemini.marketContext,
      valuationBasis: gemini.valuationBasis, comparableDescription: gemini.comparableDescription,
      estimatedRange: { low: gemini.estimatedLow, mid: gemini.estimatedMid, high: gemini.estimatedHigh },
      confidence: gemini.confidence, searchTermsGenerated: gemini.searchTerms,
    } : { available: false },

    // ── BROWSE API (class B) ─────────────────────────────────────────────────
    browseApiResults: {
      evidenceClass: 'B_active_asking',
      evidenceNote: 'Active eBay listings (asking prices only — not verified sold transactions).',
      totalFetched: totalBrowseItems,
      totalFound: firstBrowseResult.totalFound,
      relevantCount: relevantActiveCount,
      queries: browseResults.map(r => ({ query: r.query, fetched: r.items.length, totalFound: r.totalFound, error: r.error ?? null })),
      topItems: topComparables.slice(0, 5),
    },

    // ── VISUAL SEARCH (class B) ──────────────────────────────────────────────
    visualSearch: {
      available: visualSearch.available, evidenceClass: 'B_active_asking',
      evidenceNote: 'Visually similar active listings — asking prices only.',
      totalFound: visualSearch.totalFound,
      items: visualSearch.items.slice(0, 6).map(i => ({ title: i.title.slice(0, 80), price: i.price, currency: i.currency, imageUrl: i.imageUrl, url: i.url })),
    },

    // CANOA is catalogue evidence only: never a price source and never a confirmed attribution.
    canoaReference: await canoaPromise,

    numistaSales: null,

    combinedEvidence: {
      numistaRelevant: 0,
      ebayRelevant: finalTerapeak.soldQuantity,      // Terapeak = genuine sold
      browseApiRelevant: relevantActiveCount,
      geminiAvailable: gemini.available,
      total: finalTerapeak.soldQuantity + relevantActiveCount,
      combinedMedian: valuation.valuationMid,
      combinedLow: valuation.valuationLow,
      combinedHigh: valuation.valuationHigh,
      insufficientSoldEvidence: valuation.insufficientSoldEvidence,
      primaryEvidenceSource: valuation.primaryEvidenceSource,
      teapeakActive: finalTerapeak.available,
    },

    activeAskingPrices: {
      note: 'Active eBay listings — asking prices only (not sold evidence).',
      count: totalBrowseItems, relevantCount: relevantActiveCount,
      medianAskingPrice: valuation.currentAskingMarketMid,
      lowAskingPrice: allActiveFlat.length > 0 ? Math.min(...allActiveFlat.map(i => i.price)) : 0,
      highAskingPrice: allActiveFlat.length > 0 ? Math.max(...allActiveFlat.map(i => i.price)) : 0,
    },

    numista: numistaTypeId ? {
      typeId: numistaTypeId, numistaN: `N#${numistaTypeId}`,
      numistaUrl: `https://numista.com/${numistaTypeId}`,
      matchScore: numistaMatchScore, matchTier: numistaMatchTier,
      accepted: ['verified','strong_match'].includes(numistaMatchTier),
    } : null,

    dataSource: {
      teapeakSold: finalTerapeak.soldQuantity,
      teapeakAvgPrice: finalTerapeak.averageSoldPrice,
      teapeakActive: finalTerapeak.available,
      teapeakNeedsReauth: finalTerapeak.needsReauth,
      findingApiTotal: 0,
      findingApiStatus: 'REMOVED_IN_V8_REPLACED_BY_TERAPEAK',
      browseApiActive: totalBrowseItems,
      browseApiAuthMethod: 'user_oauth_token',
      numistaFound: 0, currencyConversions: [],
      marketplace: EBAY_GLOBAL_ID, imageUrlsUsed: imageUrls.length,
      geminiVisionUsed: gemini.available,
      apiConnectionStatus: {
        teapeakReached: finalTerapeak.httpStatus !== undefined,
        teapeakStatus: finalTerapeak.httpStatus ?? null,
        teapeakNeedsReauth: finalTerapeak.needsReauth,
        browseApiReached: !firstBrowseResult.error || firstBrowseResult.items.length > 0,
        browseApiError: firstBrowseResult.error ?? null,
        appTokenObtained: !!appToken,
        userTokenUsed: !!creds.accessToken,
        tokenExpiry: creds.expiresAt,
        marketplaceScoped: EBAY_GLOBAL_ID,
      },
    },

    auditTrail: {
      timestamp: new Date().toISOString(),
      searchQueries, canonicalTitle: cleanTitle,
      identificationConfidence, identificationTier,
      numistaTypeId: numistaTypeId ?? null, numistaMatchScore, numistaMatchTier,
      condition, specialistId, marketplace: EBAY_GLOBAL_ID,
      imageUrlsAnalysed: imageUrls.length, geminiVisionAvailable: gemini.available,
      geminiConfidence: gemini.confidence, geminiSearchTerms: gemini.searchTerms,
      teapeakAvailable: finalTerapeak.available,
      teapeakSoldQty: finalTerapeak.soldQuantity,
      teapeakAvgPrice: finalTerapeak.averageSoldPrice,
      teapeakNeedsReauth: finalTerapeak.needsReauth,
      browseApiFetched: totalBrowseItems, browseApiRelevant: relevantActiveCount,
      verifiedSoldData: finalTerapeak.soldQuantity,
      insufficientSoldEvidence: valuation.insufficientSoldEvidence,
      primaryEvidenceSource: valuation.primaryEvidenceSource,
      topComparables, valuationConfidence: valuation.valuationConfidence,
      valuationMethod: valuation.valuationMethod, valuationWarnings: valuation.valuationWarnings,
    },

    autonomousMode: false, applied,

    // ── Legacy compatibility ──────────────────────────────────────────────────
    stats: {
      count: finalTerapeak.available ? finalTerapeak.soldQuantity : relevantActiveCount,
      low: valuation.valuationLow, mid: valuation.valuationMid, high: valuation.valuationHigh,
      mean: valuation.valuationMid, auctionWinRate: 0,
      medianAuctionPrice: 0, medianBinPrice: valuation.valuationMid,
      dataQuality: valuation.valuationConfidence === 'high' ? 'high' : valuation.valuationConfidence === 'medium' ? 'medium' : valuation.valuationConfidence === 'low' ? 'low' : 'insufficient',
      recentSales: [
        ...soldComparableItems.slice(0, 10).map(item => ({
          title: item.title, price: item.price, currency: item.currency, listingType: 'Sold',
          condition: item.condition, url: item.url, sellSummary: 'Sold (Marketplace Insights)' as const, endDate: item.soldDate,
        })),
        ...finalTerapeak.topSoldListings.map(l => ({ title: l.title, price: l.price, currency: 'GBP', listingType: l.condition, condition: l.condition, url: '', sellSummary: 'Sold (Product Research)' as const, endDate: '' })),
        ...topComparables.slice(0, Math.max(0, 10 - soldComparableItems.length - finalTerapeak.topSoldListings.length)).map(c => ({ title: c.title, price: c.price, currency: 'GBP', listingType: c.listingType, condition: '', url: (c as any).url, sellSummary: 'Active (asking price)' as const, endDate: '' })),
      ].slice(0, 10),
    },
    recommendation: {
      recommendedFormat: valuation.recommendedListingFormat,
      recommendedPrice: valuation.recommendedListingPrice,
      auctionStartPrice: valuation.auctionStartPrice,
      confidenceScore: valuation.valuationConfidence === 'high' ? 0.90 : valuation.valuationConfidence === 'medium' ? 0.70 : valuation.valuationConfidence === 'low' ? 0.45 : 0.20,
      quickSaleRatio: 0.95,
      reasoning: valuation.listingPriceRationale,
      keyFactors: [
        finalTerapeak.available ? `TERAPEAK: ${finalTerapeak.soldQuantity} verified eBay GB sales, avg £${finalTerapeak.averageSoldPrice.toFixed(2)} (last 3 months)` : `TERAPEAK: ${finalTerapeak.needsReauth ? 'Re-authorise eBay to enable' : 'No data — ' + (finalTerapeak.error ?? 'unavailable')}`,
        relevantActiveCount > 0 ? `${relevantActiveCount} relevant active eBay listings (asking prices)` : 'No relevant active listings found',
        gemini.available ? `AI estimate: £${gemini.estimatedMid} (${gemini.confidence} confidence)` : 'Gemini vision unavailable',
        valuation.valuationMid > 0 ? `Valuation: £${valuation.valuationLow}–£${valuation.valuationHigh}` : 'INSUFFICIENT SOLD-MARKET EVIDENCE',
        valuation.insufficientSoldEvidence ? 'Re-authorise eBay with sell.analytics.readonly scope for verified sold data' : 'Valuation based on Terapeak verified sold data',
      ].filter(Boolean),
      warningFlags: valuation.valuationWarnings,
    },
  });
  } catch (err: any) {
    // Do not expose runtime exception text, which may contain provider or request details.
    console.error('[SWISH Market v8] Unhandled valuation error.');
    return jsonResponse({ error: 'Market valuation failed. Please retry.' }, 500);
  }
});
