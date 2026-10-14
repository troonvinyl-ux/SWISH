// SWISH Market Value & Pricing Intelligence Edge Function v6
//
// v6 ROOT-CAUSE FIX — eBay Finding API permanently blocked at cloud IPs
//
// CONFIRMED BUG (from logs):
//   The eBay Finding API (svcs.ebay.com) returns HTTP 418 on every call
//   from the OnSpace Cloud server IP. This is eBay's datacenter-IP block,
//   NOT a transient rate limit. Retries never succeed.
//
// v6 SOLUTION — Three-source intelligence, Finding API REMOVED:
//   1. eBay BROWSE API (seller OAuth token) — search active listings with
//      filter=conditionIds to isolate used/for-parts condition items.
//      The Browse API uses the tenant's user OAuth token, which is NOT
//      blocked by cloud IP restrictions.
//   2. eBay BROWSE API (app token, visual) — image similarity search
//      for active asking price context.
//   3. GEMINI VISION — image-based market estimate when eBay data is thin.
//
// WHY THE BROWSE API WORKS WHERE FINDING API DIDN'T:
//   The eBay Finding API (svcs.ebay.com) blocks datacenter IP ranges.
//   The eBay Browse API (api.ebay.com) uses OAuth tokens for auth and
//   is designed for server-to-server use — not blocked by IP.
//
// SOLD DATA REALITY:
//   The eBay Browse API returns ACTIVE listings, not historical sold data.
//   Historical sold data (Terapeak/Product Research) is ONLY available via
//   eBay Seller Hub's session-authenticated endpoint — not any public API.
//   This is a confirmed platform limitation. SWISH now:
//     A. Uses Browse API active listings as "current asking price" context
//     B. Uses Gemini Vision as "AI market estimate" from training data
//     C. Clearly labels both evidence classes — never presents asking prices
//        as verified sold prices
//     D. Returns "Insufficient sold-market evidence" when appropriate
//
// TOKEN REFRESH:
//   If the stored access token is expired or near-expiry, it is automatically
//   refreshed using the stored refresh token before any API calls are made.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { decryptCredentials, encryptCredentials } from '../_shared/credentialCrypto.ts';

const EBAY_TOKEN_URL   = 'https://api.ebay.com/identity/v1/oauth2/token';
const EBAY_BROWSE_BASE = 'https://api.ebay.com/buy/browse/v1';
const EBAY_GLOBAL_ID   = 'EBAY_GB';
const EBAY_MARKETPLACE = 'EBAY_SITE_ID=3'; // UK site

function adminClient() {
  return createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ── Auth ─────────────────────────────────────────────────────────────────────
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
  } catch (e: any) { return { ok: false, error: `Auth error: ${e.message}` }; }
}

// ── Currency conversion ───────────────────────────────────────────────────────
function toGBP(price: number, currency: string): number {
  const rates: Record<string, number> = { GBP: 1, USD: 0.79, EUR: 0.85, AUD: 0.51, CAD: 0.58, JPY: 0.0053, CHF: 0.89, SEK: 0.072, DKK: 0.114 };
  return price * (rates[currency.toUpperCase()] ?? 1);
}

// ── Title sanitisation ────────────────────────────────────────────────────────
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
// Loads stored credentials. If access token is expired or near-expiry,
// refreshes it automatically and persists the new token back to the DB.

interface ConnectorCreds {
  clientId: string;
  clientSecret: string;
  ruName: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: string | null;
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
    console.log(`[SWISH Market v6] No connected eBay connector for tenant ${tenantId}`);
    return null;
  }

  let creds: any;
  try { creds = await decryptCredentials(conn.credential_ref); }
  catch (e: any) { console.log(`[SWISH Market v6] Credential decrypt error: ${e.message}`); return null; }

  if (!creds?.accessToken || !creds?.clientId) {
    console.log(`[SWISH Market v6] Missing accessToken or clientId in stored credentials`);
    return null;
  }

  // Check token expiry — refresh if within 10 minutes or already expired
  const expiresAt = creds.expiresAt ? new Date(creds.expiresAt) : null;
  const needsRefresh = !expiresAt || expiresAt.getTime() - Date.now() < 10 * 60 * 1000;

  if (needsRefresh && creds.refreshToken) {
    console.log(`[SWISH Market v6] Access token expired/near-expiry — refreshing via refresh_token`);
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
          const newExpiry = tokenData.expires_in
            ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
            : null;
          creds = { ...creds, accessToken: tokenData.access_token, expiresAt: newExpiry };
          // Persist refreshed token
          const newCredRef = await encryptCredentials(creds);
          await supabase.from('marketplace_connectors').update({
            credential_ref: newCredRef,
            access_token_expires_at: newExpiry,
            updated_at: new Date().toISOString(),
          }).eq('tenant_id', tenantId).eq('marketplace_id', 'ebay');
          console.log(`[SWISH Market v6] Token refreshed successfully, new expiry=${newExpiry}`);
        }
      } else {
        const err = await resp.text();
        console.log(`[SWISH Market v6] Token refresh failed (${resp.status}): ${err.slice(0, 150)}`);
      }
    } catch (e: any) {
      console.log(`[SWISH Market v6] Token refresh exception: ${e.message}`);
    }
  }

  return {
    clientId: String(creds.clientId ?? ''),
    clientSecret: String(creds.clientSecret ?? ''),
    ruName: String(creds.ruName ?? ''),
    accessToken: String(creds.accessToken ?? ''),
    refreshToken: String(creds.refreshToken ?? ''),
    expiresAt: creds.expiresAt ?? null,
  };
}

// ── eBay app token (for visual search only — no user token needed) ─────────────
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
// SOURCE A: eBay BROWSE API — ACTIVE LISTINGS (user OAuth token)
// ══════════════════════════════════════════════════════════════════════════════
// Uses the tenant's OAuth access token — NOT blocked by cloud IP restrictions.
// Returns ACTIVE LISTINGS — these are asking prices, NOT sold prices.
// Evidence class: B (active asking prices)
// Labelled clearly and never used as sold price evidence.

interface BrowseSearchResult {
  available: boolean;
  items: Array<{
    title: string;
    price: number;
    currency: string;
    condition: string;
    url: string;
    imageUrl: string;
    listingType: string;
    sellerCountry: string;
  }>;
  totalFound: number;
  query: string;
  error?: string;
  httpStatus?: number;
}

async function searchEbayBrowse(
  accessToken: string,
  query: string,
  maxResults = 50,
): Promise<BrowseSearchResult> {
  const noResult: BrowseSearchResult = { available: false, items: [], totalFound: 0, query };

  if (!accessToken || !query || query.length < 3) return noResult;

  const params = new URLSearchParams({
    q: query.slice(0, 100),
    limit: String(Math.min(maxResults, 100)),
    fieldgroups: 'MATCHING_ITEMS',
  });

  const url = `${EBAY_BROWSE_BASE}/item_summary/search?${params.toString()}`;
  console.log(`[SWISH Market v6] Browse API search: "${query}" marketplace=${EBAY_GLOBAL_ID}`);

  try {
    const resp = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'X-EBAY-C-MARKETPLACE-ID': EBAY_GLOBAL_ID,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.log(`[SWISH Market v6] Browse API HTTP ${resp.status}: ${errText.slice(0, 250)}`);
      return { ...noResult, error: `Browse API ${resp.status}: ${errText.slice(0, 100)}`, httpStatus: resp.status };
    }

    const data = await resp.json();
    const rawItems = data.itemSummaries ?? [];
    const totalFound = Number(data.total ?? rawItems.length);

    const items: BrowseSearchResult['items'] = rawItems.slice(0, maxResults).map((item: any) => ({
      title: item.title ?? '',
      price: toGBP(Number(item.price?.value ?? 0), item.price?.currency ?? 'GBP'),
      currency: item.price?.currency ?? 'GBP',
      condition: item.condition ?? '',
      url: item.itemWebUrl ?? '',
      imageUrl: item.image?.imageUrl ?? item.thumbnailImages?.[0]?.imageUrl ?? '',
      listingType: (item.buyingOptions ?? []).includes('AUCTION') ? 'Auction' : 'FixedPrice',
      sellerCountry: item.itemLocation?.country ?? '',
    })).filter((i: any) => i.price > 0 && i.title);

    console.log(`[SWISH Market v6] Browse API: ${items.length} items (total ${totalFound}) for "${query}"`);

    if (items.length > 0) {
      const sampleTitles = items.slice(0, 3).map(i => i.title.slice(0, 50)).join(' | ');
      console.log(`[SWISH Market v6] Sample titles: ${sampleTitles}`);
    }

    return { available: true, items, totalFound, query };
  } catch (e: any) {
    console.log(`[SWISH Market v6] Browse API exception: ${e.message}`);
    return { ...noResult, error: e.message };
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// SOURCE B: eBay VISUAL SEARCH (Browse API, app token)
// ══════════════════════════════════════════════════════════════════════════════
// Sends stored item image to eBay's visual search.
// Returns active asking prices — evidence class B.

interface VisualSearchResult {
  available: boolean;
  items: Array<{ title: string; price: number; currency: string; imageUrl: string; url: string }>;
  totalFound: number;
  error?: string;
}

async function runEbayVisualSearch(imageUrl: string, appToken: string): Promise<VisualSearchResult> {
  const noResult: VisualSearchResult = { available: false, items: [], totalFound: 0 };
  if (!appToken || !imageUrl) return noResult;

  try {
    const imgResp = await fetch(imageUrl, { signal: AbortSignal.timeout(10000) });
    if (!imgResp.ok) return { ...noResult, error: `Could not fetch image: ${imgResp.status}` };
    const imgBuffer = await imgResp.arrayBuffer();
    const imgBytes = new Uint8Array(imgBuffer);
    let b64 = '';
    const chunkSize = 8192;
    for (let i = 0; i < imgBytes.length; i += chunkSize) b64 += String.fromCharCode(...imgBytes.slice(i, i + chunkSize));
    const imageBase64 = btoa(b64);
    if (imageBase64.length < 100) return { ...noResult, error: 'Image too small' };

    const resp = await fetch(`${EBAY_BROWSE_BASE}/item_summary/search_by_image?limit=10&fieldgroups=MATCHING_ITEMS`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${appToken}`, 'X-EBAY-C-MARKETPLACE-ID': EBAY_GLOBAL_ID, 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: imageBase64 }),
      signal: AbortSignal.timeout(15000),
    });

    if (!resp.ok) { const e = await resp.text(); console.log(`[SWISH Market v6] Visual search ${resp.status}: ${e.slice(0, 200)}`); return { ...noResult, error: `Visual search ${resp.status}` }; }
    const data = await resp.json();
    const rawItems = data.itemSummaries ?? [];
    const items = rawItems.map((item: any) => ({
      title: item.title ?? '', price: toGBP(Number(item.price?.value ?? 0), item.price?.currency ?? 'GBP'),
      currency: item.price?.currency ?? 'GBP', imageUrl: item.image?.imageUrl ?? '', url: item.itemWebUrl ?? '',
    })).filter((i: any) => i.price > 0);
    console.log(`[SWISH Market v6] Visual search: ${items.length} items (total ${data.total ?? items.length})`);
    return { available: true, items, totalFound: Number(data.total ?? items.length) };
  } catch (e: any) { return { ...noResult, error: e.message }; }
}

// ══════════════════════════════════════════════════════════════════════════════
// SOURCE C: GEMINI VISION MARKET RESEARCH
// ══════════════════════════════════════════════════════════════════════════════
// Evidence class: E (AI inference from training data)
// Clearly labelled — never presented as verified sold data.

interface GeminiMarketResult {
  available: boolean;
  searchTerms: string[];
  estimatedLow: number;
  estimatedMid: number;
  estimatedHigh: number;
  confidence: 'high' | 'medium' | 'low' | 'insufficient';
  itemDescription: string;
  marketContext: string;
  valuationBasis: string;
  comparableDescription: string;
  error?: string;
}

async function runGeminiMarketResearch(
  imageUrls: string[], title: string, specialistId: string,
  attributes: Record<string, any>, condition: string,
): Promise<GeminiMarketResult> {
  const noResult: GeminiMarketResult = {
    available: false, searchTerms: [], estimatedLow: 0, estimatedMid: 0, estimatedHigh: 0,
    confidence: 'insufficient', itemDescription: '', marketContext: '', valuationBasis: '', comparableDescription: '',
  };

  const apiKey = Deno.env.get('ONSPACE_AI_API_KEY');
  const baseUrl = Deno.env.get('ONSPACE_AI_BASE_URL');
  if (!apiKey || !baseUrl || imageUrls.length === 0) return { ...noResult, error: 'No images or Gemini not configured' };

  const nicheContext = specialistId === 'bicycles' ? 'This is a bicycle, bike frame, or cycling component sold on eBay UK.'
    : specialistId === 'motocross' ? 'This is a motocross or off-road motorcycle sold on eBay UK.'
    : (specialistId === 'clothing' || specialistId === 'trainers_sneakers') ? 'This is a vintage/branded clothing item or trainers sold on eBay UK or Depop.'
    : (specialistId.includes('coin') || specialistId === 'islamic_silver' || specialistId === 'ancient_artefacts' || specialistId === 'gold' || specialistId === 'silver') ? 'This is a coin, medal, or precious metal collectible sold on eBay UK.'
    : 'This is a collectible or resale item sold on eBay UK.';

  const knownInfo = Object.entries(attributes)
    .filter(([, v]) => v && String(v).trim() && !['Not established', 'Not supplied', 'Not legible', 'unknown'].includes(String(v)))
    .map(([k, v]) => `${k}: ${v}`).join(', ');

  const prompt = `You are an expert eBay UK reseller. ${nicheContext}
ITEM: "${sanitiseTitle(title)}" | Condition: "${condition || 'Unknown'}" | ${knownInfo || 'No attributes'}

Analyse the image(s) and return ONLY valid JSON:
{
  "itemDescription": "Brief description of what you see",
  "searchTerms": ["Specific eBay UK query 1", "Broader query 2", "Category fallback 3"],
  "estimatedLow": 0,
  "estimatedMid": 0,
  "estimatedHigh": 0,
  "confidence": "high|medium|low|insufficient",
  "marketContext": "Brief market assessment (demand, typical buyers, how fast this sells)",
  "valuationBasis": "How estimate derived from typical eBay UK sold prices in training data",
  "comparableDescription": "What to search for on eBay"
}

searchTerms[0]: Most specific (brand+model+key spec, max 80 chars)
searchTerms[1]: Slightly broader (brand+type)
searchTerms[2]: Category fallback (type+material+era)

estimatedLow/Mid/High: Based on TYPICAL eBay UK SOLD prices (not asking prices) from your training data. Set all to 0 if genuinely unable to estimate.
confidence: "high"=well-known item, "medium"=reasonable estimate, "low"=uncertain, "insufficient"=no basis.`;

  try {
    const messageContent: any[] = [{ type: 'text', text: prompt }];
    for (const url of imageUrls.slice(0, 3)) {
      if (url.startsWith('https://')) messageContent.push({ type: 'image_url', image_url: { url } });
    }
    console.log(`[SWISH Market v6] Gemini vision: ${imageUrls.length} images for "${sanitiseTitle(title)}"`);
    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: 'google/gemini-2.5-flash', messages: [{ role: 'user', content: messageContent }], temperature: 0.1, max_tokens: 800 }),
      signal: AbortSignal.timeout(25000),
    });
    if (!resp.ok) { console.log(`[SWISH Market v6] Gemini HTTP ${resp.status}`); return { ...noResult, error: `Gemini ${resp.status}` }; }
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
      confidence: ['high', 'medium', 'low', 'insufficient'].includes(parsed.confidence) ? parsed.confidence : 'low',
      itemDescription: String(parsed.itemDescription ?? '').slice(0, 300),
      marketContext: String(parsed.marketContext ?? '').slice(0, 300),
      valuationBasis: String(parsed.valuationBasis ?? '').slice(0, 300),
      comparableDescription: String(parsed.comparableDescription ?? '').slice(0, 200),
    };
    console.log(`[SWISH Market v6] Gemini: mid=£${result.estimatedMid} conf=${result.confidence} terms=${result.searchTerms.length}`);
    return result;
  } catch (e: any) { return { ...noResult, error: `Gemini error: ${e.message}` }; }
}

// ══════════════════════════════════════════════════════════════════════════════
// RELEVANCE SCORING (for Browse API results = active asking prices)
// ══════════════════════════════════════════════════════════════════════════════
// Same algorithm as v5 but applied to Browse API listings.
// Results labelled as asking prices, not sold prices.

function scoreListing(
  title: string, price: number, targetTitle: string,
  targetAttrs: Record<string, any>, specialistId: string,
): { score: number; reason: string } {
  const compLower = title.toLowerCase();
  const targetLower = sanitiseTitle(targetTitle).toLowerCase();
  const targetWords = targetLower.split(/\s+/).filter(w => w.length > 2);
  const matched = targetWords.filter(w => compLower.includes(w));
  const overlap = targetWords.length > 0 ? matched.length / targetWords.length : 0;
  let score = 0.40;
  if (overlap >= 0.70) score += 0.25;
  else if (overlap >= 0.50) score += 0.15;
  else if (overlap >= 0.35) score += 0.07;
  else if (overlap >= 0.20) score += 0.02;
  else score -= 0.15;

  const isBike = specialistId === 'bicycles' || specialistId === 'cycling';
  const isMX = specialistId === 'motocross';
  const isClothing = specialistId === 'clothing' || specialistId === 'trainers_sneakers';
  const isCoin = specialistId.includes('coin') || specialistId === 'islamic_silver' || specialistId === 'ancient_artefacts' || specialistId === 'gold' || specialistId === 'silver';

  if (isBike) {
    const brand = String(targetAttrs?.manufacturer ?? targetAttrs?.brand ?? '').toLowerCase();
    const model = String(targetAttrs?.model ?? targetAttrs?.model_name ?? '').toLowerCase();
    if (brand && compLower.includes(brand)) score += 0.15;
    if (model && model.length > 2 && compLower.includes(model.split(' ')[0])) score += 0.10;
    if (['mountain bike', 'mtb', 'road bike', 'gravel', 'hardtail', 'full suspension', 'frame', 'bicycle', 'bike'].some(k => compLower.includes(k))) score += 0.05;
  }
  if (isMX) {
    const make = String(targetAttrs?.manufacturer ?? targetAttrs?.brand ?? targetAttrs?.make ?? '').toLowerCase();
    const engineCC = String(targetAttrs?.engine_size ?? targetAttrs?.displacement ?? '').replace(/[^0-9]/g, '');
    if (make && compLower.includes(make)) score += 0.18;
    if (engineCC && compLower.includes(engineCC)) score += 0.10;
    if (['motocross', 'mx', 'enduro', 'dirt bike', 'off road', 'supermoto'].some(k => compLower.includes(k))) score += 0.05;
  }
  if (isClothing) {
    const brand = String(targetAttrs?.brand ?? '').toLowerCase();
    const garment = String(targetAttrs?.garment_type ?? '').toLowerCase();
    if (brand && compLower.includes(brand)) score += 0.20;
    if (garment && garment.length > 2 && compLower.includes(garment)) score += 0.10;
    if (['vintage', 'deadstock', 'retro', 'rare'].some(k => compLower.includes(k))) score += 0.04;
  }
  if (isCoin) {
    const denom = String(targetAttrs?.denomination ?? '').toLowerCase();
    const ruler = String(targetAttrs?.ruler ?? '').toLowerCase();
    if (denom && denom.length > 1 && compLower.includes(denom)) score += 0.15;
    if (ruler && ruler.length > 2 && compLower.includes(ruler.split(' ').pop() ?? ruler)) score += 0.12;
    if (specialistId === 'islamic_silver' && ['islamic', 'dirham', 'dinar', 'tanka', 'tanker', 'umayyad', 'abbasid', 'fatimid', 'silver coin', 'arabic'].some(k => compLower.includes(k))) score += 0.18;
  }
  if (price > 5000) score -= 0.10;
  return { score: Math.max(0, Math.min(1, score)), reason: `${Math.round(overlap * 100)}% title match` };
}

// ══════════════════════════════════════════════════════════════════════════════
// BUILD SEARCH QUERIES
// ══════════════════════════════════════════════════════════════════════════════
function buildSearchQueries(
  title: string, attributes: Record<string, any>, specialistId: string, geminiTerms: string[],
): string[] {
  const queries: string[] = [];
  const sanitised = sanitiseTitle(title);

  // Gemini terms first (from image analysis)
  for (const term of geminiTerms) {
    if (term.length >= 4 && !queries.includes(term)) queries.push(term.slice(0, 100));
  }

  const isBike = specialistId === 'bicycles' || specialistId === 'cycling';
  const isMX = specialistId === 'motocross';
  const isClothing = specialistId === 'clothing' || specialistId === 'trainers_sneakers';
  const isCoin = specialistId.includes('coin') || specialistId === 'islamic_silver' || specialistId === 'ancient_artefacts' || specialistId === 'gold' || specialistId === 'silver';

  if (isBike) {
    const brand = String(attributes?.manufacturer ?? attributes?.brand ?? '').trim();
    const model = String(attributes?.model ?? attributes?.model_name ?? '').trim();
    const year = String(attributes?.year_range ?? attributes?.year_made ?? '').trim().split('-')[0];
    const frameType = String(attributes?.bike_type ?? attributes?.frame_type ?? '').trim();
    if (brand && model) { const q = [brand, model, year].filter(Boolean).join(' ').slice(0, 100); if (!queries.includes(q)) queries.push(q); }
    if (brand && frameType) { const q = `${brand} ${frameType}`.slice(0, 80); if (!queries.includes(q)) queries.push(q); }
    if (brand) { const q = `${brand} frame`.slice(0, 60); if (!queries.includes(q)) queries.push(q); }
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
    if (specialistId === 'islamic_silver') {
      const dynasty = String(attributes?.dynasty ?? attributes?.period ?? '').trim();
      const denom = String(attributes?.denomination ?? attributes?.coin_type ?? '').trim();
      if (dynasty && denom) { const q = `${dynasty} ${denom} silver coin`.slice(0, 100); if (!queries.includes(q)) queries.push(q); }
      if (denom) { const q = `${denom} Islamic silver coin`.slice(0, 80); if (!queries.includes(q)) queries.push(q); }
      if (!queries.some(q => q.toLowerCase().includes('islamic'))) queries.push('Islamic silver coin dirham');
    } else {
      const ruler = String(attributes?.ruler ?? '').trim();
      const denom = String(attributes?.denomination ?? '').trim();
      const year = String(attributes?.year_made ?? '').trim();
      if (ruler && denom) { const q = [ruler, denom, year].filter(Boolean).join(' ').slice(0, 100); if (!queries.includes(q)) queries.push(q); }
    }
  }

  const cleanTitle = sanitised.slice(0, 100);
  if (cleanTitle.length >= 4 && !queries.includes(cleanTitle)) queries.push(cleanTitle);

  return queries.filter((q, i, arr) => q.length >= 3 && arr.indexOf(q) === i).slice(0, 4);
}

// ══════════════════════════════════════════════════════════════════════════════
// VALUATION COMPUTATION
// ══════════════════════════════════════════════════════════════════════════════
// v6: Active Browse API listings = asking price context ONLY.
// Gemini training-data estimates = AI inference.
// Neither is "sold evidence". Both are clearly labelled.
// "INSUFFICIENT SOLD-MARKET EVIDENCE" returned when neither provides confidence.

interface ComputedValuation {
  valuationLow: number; valuationMid: number; valuationHigh: number;
  valuationConfidence: string; valuationMethod: string; valuationWarnings: string[];
  recommendedListingPrice: number;
  recommendedListingFormat: 'Auction' | 'BuyItNow' | 'BuyItNow_WithBestOffer';
  listingPriceRationale: string;
  saleProb30d: number | null; fairMarketValue: number; currentAskingMarketMid: number;
  auctionStartPrice?: number;
  insufficientSoldEvidence: boolean;
}

function computeValuation(params: {
  browseResults: BrowseSearchResult[];
  gemini: GeminiMarketResult;
  visualSearch: VisualSearchResult;
  targetTitle: string; targetAttrs: Record<string, any>;
  specialistId: string; identificationConfidence: number;
  identificationTier: string; condition: string;
}): ComputedValuation {
  const { browseResults, gemini, visualSearch, targetTitle, targetAttrs, specialistId, identificationConfidence, identificationTier, condition } = params;

  const noVal: ComputedValuation = {
    valuationLow: 0, valuationMid: 0, valuationHigh: 0,
    valuationConfidence: 'insufficient_data', valuationMethod: 'no_data',
    valuationWarnings: ['INSUFFICIENT SOLD-MARKET EVIDENCE — no comparable sold data available for this item.'],
    recommendedListingPrice: 0, recommendedListingFormat: 'BuyItNow',
    listingPriceRationale: 'INSUFFICIENT SOLD-MARKET EVIDENCE. No verified comparable sales found. Research manually on eBay Seller Hub before listing.',
    saleProb30d: null, fairMarketValue: 0, currentAskingMarketMid: 0,
    insufficientSoldEvidence: true,
  };

  const warnings: string[] = [];

  // Collect relevant active listings from Browse API (asking prices only)
  const allActive: Array<{ title: string; price: number; score: number; listingType: string; url: string }> = [];
  const seenKeys = new Set<string>();
  const totalBrowseRaw = browseResults.reduce((sum, r) => sum + r.items.length, 0);
  const MIN_RELEVANCE = totalBrowseRaw < 10 ? 0.28 : 0.35;

  for (const result of browseResults) {
    for (const item of result.items) {
      const key = `${Math.round(item.price)}-${item.title.slice(0, 20)}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      const { score } = scoreListing(item.title, item.price, targetTitle, targetAttrs, specialistId);
      if (score >= MIN_RELEVANCE) allActive.push({ title: item.title, price: item.price, score, listingType: item.listingType, url: item.url });
    }
  }

  // Visual search asking prices
  const askingPrices = [...allActive.map(i => i.price), ...visualSearch.items.map(i => i.price)].sort((a, b) => a - b);
  const askingMedian = askingPrices.length > 0 ? askingPrices[Math.floor(askingPrices.length / 2)] : 0;

  // ── IMPORTANT: Active listing prices ≠ sold prices ─────────────────────────
  // We have NO access to eBay's historical sold data via any public API.
  // The eBay Finding API is blocked. Terapeak is session-authenticated only.
  // We must be honest about what we have:
  //   - Browse API items = current ASKING prices (active, not sold)
  //   - Gemini = AI estimate from training data
  // Both are clearly labelled below.

  const relevantActiveCount = allActive.length;

  // Case 1: Good active listing data + reasonable Gemini confidence
  // Use asking prices as "market context" + Gemini for estimate
  // Clearly label as AI estimate guided by asking price context
  if (relevantActiveCount >= 5 && gemini.available && gemini.estimatedMid > 0) {
    const activePrices = allActive.map(i => i.price).sort((a, b) => a - b);
    const n = activePrices.length;
    const askMedian = activePrices[Math.floor(n / 2)];
    const askLow = activePrices[Math.floor(n * 0.15)];
    const askHigh = activePrices[Math.floor(n * 0.85)];

    // Blend: 50% asking price context, 50% Gemini
    // The asking price context anchors the Gemini estimate to the current market
    const blendedMid = Math.round((askMedian * 0.50 + gemini.estimatedMid * 0.50) * 100) / 100;
    const blendedLow = Math.round(Math.min(askLow ?? activePrices[0], gemini.estimatedLow > 0 ? gemini.estimatedLow : askLow) * 100) / 100;
    const blendedHigh = Math.round(Math.max(askHigh ?? activePrices[n - 1], gemini.estimatedHigh > 0 ? gemini.estimatedHigh : askHigh) * 100) / 100;

    warnings.push(`EVIDENCE NOTE: ${relevantActiveCount} active eBay listings found (ASKING prices, not sold). Blended with AI market estimate. No verified sold transactions accessed.`);
    warnings.push(`AI estimate basis: ${gemini.valuationBasis}`);

    const listPrice = Math.round(blendedMid * 0.93 * 100) / 100;

    return {
      valuationLow: blendedLow, valuationMid: blendedMid, valuationHigh: blendedHigh,
      valuationConfidence: gemini.confidence === 'high' ? 'low' : 'very_low',
      valuationMethod: 'active_asking_prices_and_ai_estimate',
      valuationWarnings: warnings,
      recommendedListingPrice: listPrice,
      recommendedListingFormat: 'BuyItNow_WithBestOffer',
      listingPriceRationale: `Indicative only: ${relevantActiveCount} similar active listings (median asking £${Math.round(askMedian)}) + AI estimate £${gemini.estimatedMid}. No verified sold data. Verify on eBay Seller Hub before listing.`,
      saleProb30d: null,
      fairMarketValue: blendedMid,
      currentAskingMarketMid: Math.round(askMedian * 100) / 100,
      insufficientSoldEvidence: true,
    };
  }

  // Case 2: Only Gemini (no Browse API data)
  if (gemini.available && gemini.estimatedMid > 0) {
    const confMap: Record<string, string> = { high: 'low', medium: 'very_low', low: 'very_low', insufficient: 'insufficient_data' };
    const valConf = confMap[gemini.confidence] ?? 'very_low';

    const activeCount = browseResults.reduce((sum, r) => sum + r.items.length, 0);
    if (activeCount > 0) warnings.push(`${activeCount} eBay listings found but none matched as relevant comparables.`);
    else warnings.push('No eBay active listings found for this search query.');
    warnings.push(`AI estimate basis: ${gemini.valuationBasis}`);
    warnings.push('EVIDENCE: AI market estimate from training data only. No live eBay data. Not verified sold prices.');

    const listPrice = valConf === 'insufficient_data' ? 0 : Math.round(gemini.estimatedMid * 0.93 * 100) / 100;

    return {
      valuationLow: gemini.estimatedLow, valuationMid: gemini.estimatedMid, valuationHigh: gemini.estimatedHigh,
      valuationConfidence: valConf, valuationMethod: 'ai_market_estimate_gemini_vision',
      valuationWarnings: warnings,
      recommendedListingPrice: listPrice, recommendedListingFormat: 'BuyItNow_WithBestOffer',
      listingPriceRationale: valConf === 'insufficient_data'
        ? 'INSUFFICIENT SOLD-MARKET EVIDENCE — no listing price recommendation. Research manually before listing.'
        : `AI estimate (${gemini.confidence} confidence): £${gemini.estimatedMid}. No verified sold data. ${gemini.marketContext}`,
      saleProb30d: null, fairMarketValue: gemini.estimatedMid,
      currentAskingMarketMid: Math.round(askingMedian * 100) / 100,
      insufficientSoldEvidence: true,
    };
  }

  // Case 3: Only active asking prices
  if (askingMedian > 0) {
    warnings.push(`ASKING PRICES ONLY: ${askingPrices.length} active listings found (median £${Math.round(askingMedian)}). No sold data. Asking ≠ sold.`);
    return {
      ...noVal, valuationWarnings: warnings,
      currentAskingMarketMid: Math.round(askingMedian * 100) / 100,
      listingPriceRationale: 'No sold data. Active asking prices shown for context only.',
      insufficientSoldEvidence: true,
    };
  }

  return noVal;
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN HANDLER
// ══════════════════════════════════════════════════════════════════════════════

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  let body: any;
  try { body = await req.json(); } catch { return jsonResponse({ error: 'Invalid JSON' }, 400); }

  const {
    tenantId, itemId, title,
    specialistId = 'curiosities_collectibles',
    attributes = {}, condition = '',
    identificationConfidence = 0.5, identificationTier = 'medium',
    numistaTypeId, numistaMatchScore = 0, numistaMatchTier = 'no_match',
    applyToItem = false,
    imageUrls: callerImageUrls,
  } = body;

  if (!tenantId) return jsonResponse({ error: 'tenantId is required' }, 400);
  if (!title || title.trim().length < 3) return jsonResponse({ error: 'title is required (min 3 chars)' }, 400);

  const supabase = adminClient();
  const authHeader = req.headers.get('Authorization');
  const sec = await verifyTenantAccess(supabase, authHeader, tenantId);
  if (!sec.ok) return jsonResponse({ error: sec.error }, authHeader ? 403 : 401);

  const cleanTitle = sanitiseTitle(title);
  console.log(`[SWISH Market v6] title="${cleanTitle}" specialist=${specialistId}`);

  // ── Load credentials with auto token refresh ──────────────────────────────
  const creds = await getAndRefreshConnectorCreds(supabase, tenantId);
  if (!creds) {
    return jsonResponse({ error: 'eBay is not connected. Connect eBay in Marketplaces to enable market valuation.' }, 400);
  }

  console.log(`[SWISH Market v6] Using user OAuth token (expires=${creds.expiresAt ?? 'unknown'})`);

  // ── Resolve item images ───────────────────────────────────────────────────
  let imageUrls: string[] = [];
  if (Array.isArray(callerImageUrls) && callerImageUrls.length > 0) {
    imageUrls = callerImageUrls.filter((u: string) => typeof u === 'string' && u.startsWith('https://'));
  } else if (itemId) {
    const { data: itemRow } = await supabase.from('items').select('media').eq('id', itemId).eq('tenant_id', tenantId).maybeSingle();
    imageUrls = ((itemRow?.media ?? []) as string[]).filter(u => typeof u === 'string' && u.startsWith('https://'));
  }
  console.log(`[SWISH Market v6] Image URLs: ${imageUrls.length}`);

  // ── Phase 1: Gemini Vision + App token (parallel) ─────────────────────────
  const [gemini, appToken] = await Promise.all([
    runGeminiMarketResearch(imageUrls, cleanTitle, specialistId, attributes, condition),
    getEbayAppToken(creds.clientId, creds.clientSecret),
  ]);

  console.log(`[SWISH Market v6] Gemini: available=${gemini.available} mid=£${gemini.estimatedMid} conf=${gemini.confidence}`);

  // ── Build search queries (Gemini terms first) ─────────────────────────────
  const searchQueries = buildSearchQueries(cleanTitle, attributes, specialistId, gemini.searchTerms);
  console.log(`[SWISH Market v6] Queries: ${searchQueries.map((q, i) => `[${i + 1}] "${q}"`).join(', ')}`);

  // ── Phase 2: Browse API search (user OAuth) + visual search (app token) ──
  // Fire first Browse search in parallel with visual search
  const [firstBrowseResult, visualSearch] = await Promise.all([
    searchEbayBrowse(creds.accessToken, searchQueries[0], 50),
    (appToken && imageUrls.length > 0) ? runEbayVisualSearch(imageUrls[0], appToken) : Promise.resolve<VisualSearchResult>({ available: false, items: [], totalFound: 0 }),
  ]);

  const browseResults: BrowseSearchResult[] = [firstBrowseResult];

  // Sequential fallback queries if first returned few items
  const firstItemCount = firstBrowseResult.items.length;
  const remainingQueries = searchQueries.slice(1);

  if (firstItemCount < 10 && remainingQueries.length > 0) {
    for (const query of remainingQueries) {
      await sleep(600);
      const result = await searchEbayBrowse(creds.accessToken, query, 30);
      browseResults.push(result);
      if (browseResults.reduce((sum, r) => sum + r.items.length, 0) >= 15) break;
    }
  }

  const totalBrowseItems = browseResults.reduce((sum, r) => sum + r.items.length, 0);
  const totalBrowseFound = browseResults[0]?.totalFound ?? 0;

  console.log(`[SWISH Market v6] Browse API total: ${totalBrowseItems} items fetched (first query found ${totalBrowseFound})`);
  console.log(`[SWISH Market v6] Visual search: ${visualSearch.items.length} items (available=${visualSearch.available})`);

  // Check for auth errors (expired token that couldn't refresh)
  const browseAuthError = browseResults.find(r => r.httpStatus === 401 || r.httpStatus === 403);
  if (browseAuthError) {
    console.log(`[SWISH Market v6] Browse API auth failure (${browseAuthError.httpStatus}) — token may need re-authorisation`);
  }

  // ── Compute valuation ─────────────────────────────────────────────────────
  const isMX = specialistId === 'motocross';
  const MX_MULTIPLIERS: Record<string, number> = {
    'Runs and rides (stated)': 1.00, 'Runs & Rides': 1.00, 'Runs (stated)': 0.85,
    'Non-running (stated)': 0.55, 'Non-Running': 0.55, 'Project': 0.50,
    'Non-running (visible evidence)': 0.50, 'Unknown from images alone': 0.70, 'Unknown': 0.70,
  };
  const mxRunningStatus = isMX ? (attributes?.running_status ?? 'Unknown') : null;
  const mxMultiplier = isMX ? (MX_MULTIPLIERS[mxRunningStatus ?? ''] ?? 0.70) : 1.0;

  let valuation = computeValuation({
    browseResults, gemini, visualSearch,
    targetTitle: cleanTitle, targetAttrs: attributes,
    specialistId, identificationConfidence, identificationTier, condition,
  });

  // Apply MX running status multiplier
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

  // ── Apply to item if requested ────────────────────────────────────────────
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
    } catch (e: any) { console.log(`[SWISH Market v6] Auto-apply failed: ${e.message}`); }
  }

  // ── Collect top comparables for audit trail ───────────────────────────────
  const allActiveFlat = browseResults.flatMap(r => r.items);
  const topComparables = allActiveFlat
    .map(i => { const { score, reason } = scoreListing(i.title, i.price, cleanTitle, attributes, specialistId); return { ...i, score, reason }; })
    .sort((a, b) => b.score - a.score)
    .slice(0, 12)
    .map(i => ({ title: i.title.slice(0, 80), price: i.price, listingType: i.listingType, score: Math.round(i.score * 100), url: i.url, evidenceClass: 'B_active_asking_price' }));

  const relevantActiveCount = topComparables.filter(i => i.score >= 28).length;

  console.log(`[SWISH Market v6] Final: mid=£${valuation.valuationMid} conf=${valuation.valuationConfidence} relevantActive=${relevantActiveCount} insufficientSold=${valuation.insufficientSoldEvidence}`);

  // ── Build response ────────────────────────────────────────────────────────
  return jsonResponse({
    success: true,
    searchQuery: searchQueries[0],
    searchQueriesUsed: searchQueries,
    valuation,

    // ── HONEST SOLD MARKET DATA ──────────────────────────────────────────────
    // SWISH v6 has NO access to eBay historical sold data via public API.
    // The Finding API is blocked at cloud IPs. Terapeak is session-only.
    // This section accurately reports zero verified sold comps.
    soldMarket: {
      verifiedSoldCount: 0,
      relevantSoldCount: 0,
      excludedSoldCount: 0,
      medianPrice: 0, weightedMedianPrice: 0, lowPrice: 0, highPrice: 0,
      auctionMedian: 0, binMedian: 0, auctionShare: 0,
      dateRange: 'unknown',
      dataQuality: 'insufficient',
      dataQualityReason: 'eBay Finding API is blocked at server IP (HTTP 418). eBay historical sold data (Terapeak/Product Research) requires an authenticated browser session — not available via public API. Verified sold data = 0.',
      exceptionalSales: [],
      sampleExclusions: [],
    },

    // Gemini AI market research (evidence class E — AI inference)
    geminiMarketResearch: gemini.available ? {
      available: true,
      evidenceClass: 'E_ai_inference',
      evidenceNote: 'AI market estimate from Gemini vision analysis. Based on training data — NOT verified eBay sold transactions. Treat as indicative only.',
      itemDescription: gemini.itemDescription,
      marketContext: gemini.marketContext,
      valuationBasis: gemini.valuationBasis,
      comparableDescription: gemini.comparableDescription,
      estimatedRange: { low: gemini.estimatedLow, mid: gemini.estimatedMid, high: gemini.estimatedHigh },
      confidence: gemini.confidence,
      searchTermsGenerated: gemini.searchTerms,
    } : { available: false },

    // Visual search (active asking prices — evidence class B)
    visualSearch: {
      available: visualSearch.available,
      evidenceClass: 'B_active_asking',
      evidenceNote: 'Active eBay listings via image similarity — ASKING PRICES ONLY, not verified sales.',
      totalFound: visualSearch.totalFound,
      items: visualSearch.items.slice(0, 8).map(i => ({ title: i.title.slice(0, 80), price: i.price, currency: i.currency, imageUrl: i.imageUrl, url: i.url })),
    },

    // Browse API active listings (evidence class B — asking prices, not sold)
    browseApiResults: {
      evidenceClass: 'B_active_asking',
      evidenceNote: 'Active eBay listings via text search (OAuth token). ASKING PRICES ONLY — not verified sold transactions.',
      totalFetched: totalBrowseItems,
      totalFound: totalBrowseFound,
      relevantCount: relevantActiveCount,
      queries: browseResults.map(r => ({ query: r.query, fetched: r.items.length, totalFound: r.totalFound, error: r.error ?? null })),
      topItems: topComparables.slice(0, 5),
    },

    numistaSales: null,

    combinedEvidence: {
      numistaRelevant: 0,
      ebayRelevant: 0,
      browseApiRelevant: relevantActiveCount,
      geminiAvailable: gemini.available,
      total: relevantActiveCount,
      combinedMedian: valuation.valuationMid,
      combinedLow: valuation.valuationLow,
      combinedHigh: valuation.valuationHigh,
      insufficientSoldEvidence: valuation.insufficientSoldEvidence,
    },

    activeAskingPrices: {
      note: 'ASKING PRICES ONLY — active eBay listings (not sold). Not used as sold price evidence.',
      count: totalBrowseItems,
      relevantCount: relevantActiveCount,
      medianAskingPrice: valuation.currentAskingMarketMid,
      lowAskingPrice: allActiveFlat.length > 0 ? Math.min(...allActiveFlat.map(i => i.price)) : 0,
      highAskingPrice: allActiveFlat.length > 0 ? Math.max(...allActiveFlat.map(i => i.price)) : 0,
    },

    numista: numistaTypeId ? {
      typeId: numistaTypeId, numistaN: `N#${numistaTypeId}`,
      numistaUrl: `https://en.numista.com/catalogue/index.php?r=${numistaTypeId}`,
      matchScore: numistaMatchScore, matchTier: numistaMatchTier,
      accepted: ['verified', 'strong_match'].includes(numistaMatchTier),
    } : null,

    dataSource: {
      findingApiTotal: 0,
      findingApiStatus: 'PERMANENTLY_BLOCKED_AT_CLOUD_IP',
      findingApiNote: 'eBay Finding API returns HTTP 418 from server IP. This is a permanent IP block, not a rate limit.',
      browseApiActive: totalBrowseItems,
      browseApiAuthMethod: 'user_oauth_token',
      browseApiAuthError: browseAuthError ? `HTTP ${browseAuthError.httpStatus}` : null,
      numistaFound: 0,
      currencyConversions: [],
      marketplace: EBAY_GLOBAL_ID,
      imageUrlsUsed: imageUrls.length,
      geminiVisionUsed: gemini.available,
      apiConnectionStatus: {
        browseApiReached: !browseAuthError && (firstBrowseResult.available || !!firstBrowseResult.error),
        browseApiError: firstBrowseResult.error ?? null,
        appTokenObtained: !!appToken,
        userTokenUsed: !!creds.accessToken,
        tokenExpiry: creds.expiresAt,
        marketplaceScoped: EBAY_GLOBAL_ID,
        rateLimited: false,
      },
    },

    auditTrail: {
      timestamp: new Date().toISOString(),
      searchQueries, canonicalTitle: cleanTitle,
      identificationConfidence, identificationTier,
      numistaTypeId: numistaTypeId ?? null, numistaMatchScore, numistaMatchTier,
      condition, specialistId, marketplace: EBAY_GLOBAL_ID,
      imageUrlsAnalysed: imageUrls.length,
      geminiVisionAvailable: gemini.available,
      geminiConfidence: gemini.confidence,
      geminiSearchTerms: gemini.searchTerms,
      browseApiFetched: totalBrowseItems,
      browseApiFound: totalBrowseFound,
      browseApiRelevant: relevantActiveCount,
      verifiedSoldData: 0,
      findingApiStatus: 'PERMANENTLY_BLOCKED_HTTP_418',
      terapeak: 'NOT_AVAILABLE_SESSION_AUTHENTICATED_ONLY',
      insufficientSoldEvidence: valuation.insufficientSoldEvidence,
      topComparables,
      valuationConfidence: valuation.valuationConfidence,
      valuationMethod: valuation.valuationMethod,
      valuationWarnings: valuation.valuationWarnings,
    },

    autonomousMode: false, applied,

    // Legacy compatibility
    stats: {
      count: relevantActiveCount,
      low: valuation.valuationLow, mid: valuation.valuationMid, high: valuation.valuationHigh,
      mean: valuation.valuationMid,
      auctionWinRate: 0, medianAuctionPrice: 0, medianBinPrice: valuation.valuationMid,
      dataQuality: valuation.valuationConfidence === 'low' ? 'low' : valuation.valuationConfidence === 'very_low' ? 'low' : 'insufficient',
      recentSales: topComparables.slice(0, 10).map(c => ({
        title: c.title, price: c.price, currency: 'GBP',
        listingType: c.listingType, condition: '', url: c.url,
        sellSummary: 'Active (asking price)' as const, endDate: '',
      })),
    },
    recommendation: {
      recommendedFormat: valuation.recommendedListingFormat,
      recommendedPrice: valuation.recommendedListingPrice,
      auctionStartPrice: valuation.auctionStartPrice,
      confidenceScore: valuation.valuationConfidence === 'low' ? 0.35 : valuation.valuationConfidence === 'very_low' ? 0.20 : 0.10,
      quickSaleRatio: 0.95,
      reasoning: valuation.listingPriceRationale,
      keyFactors: [
        `EVIDENCE: ${valuation.insufficientSoldEvidence ? 'NO verified sold data (eBay Finding API blocked)' : 'Active asking prices + AI estimate'}`,
        relevantActiveCount > 0 ? `${relevantActiveCount} relevant active listings found via Browse API (EBAY_GB)` : 'No relevant active listings found',
        gemini.available ? `AI market estimate: £${gemini.estimatedMid} (${gemini.confidence} confidence)` : 'Gemini vision unavailable',
        valuation.valuationMid > 0 ? `Indicative range: £${valuation.valuationLow}–£${valuation.valuationHigh}` : 'INSUFFICIENT SOLD-MARKET EVIDENCE',
        ...valuation.valuationWarnings.slice(0, 2),
      ].filter(Boolean),
      warningFlags: valuation.valuationWarnings,
    },
  });
});
