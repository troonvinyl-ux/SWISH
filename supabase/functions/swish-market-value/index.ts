// SWISH Market Value & Pricing Intelligence Edge Function v5
//
// v5 COMPLETE REWRITE — Evidence-First, Image-Driven, Rate-Limit Resilient
//
// STRATEGY:
//   OLD: Rely solely on eBay Finding API → fails with 418 rate-limits, zero results
//   NEW: Three-source parallel intelligence gathering:
//     1. GEMINI VISION — analyse stored item images for market context, value range,
//        and optimised eBay search terms (works without any eBay quota)
//     2. eBay VISUAL SEARCH — use item images with eBay Browse API search_by_image
//        to find visually similar active listings (requires app token only)
//     3. eBay FINDING API — search for completed sold items using Gemini-generated
//        search terms (better queries), with retry backoff on 418 rate-limit
//
// KEY FIXES vs v4:
//   - 418 rate-limit: exponential backoff retry (2s, 5s) before giving up
//   - Zero results: Gemini provides market context even when eBay search fails
//   - Better queries: Gemini analyses the actual images to generate optimal search terms
//   - All niches: Gemini vision works equally well for bikes, coins, clothing, MX
//   - Relaxed relevance: lower threshold, broader matching when evidence is scarce
//   - Sequential searches: 800ms delay between eBay calls to avoid rate limiting
//
// EVIDENCE HIERARCHY (unchanged):
//   A. Verified sold transactions (eBay Finding API soldOnly)
//   B. Visual search active listings (eBay Browse search_by_image)
//   C. Gemini vision market estimate (AI inference — clearly labelled)
//   Active asking prices NEVER used as sold evidence.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const EBAY_FINDING_API = 'https://svcs.ebay.com/services/search/FindingService/v1';
const EBAY_TOKEN_URL   = 'https://api.ebay.com/identity/v1/oauth2/token';
const EBAY_BROWSE_BASE = 'https://api.ebay.com/buy/browse/v1';
const EBAY_GLOBAL_ID   = 'EBAY_GB';

function adminClient() {
  return createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

// ── Sleep helper ───────────────────────────────────────────────────────────────
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

// ── eBay credentials ──────────────────────────────────────────────────────────
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
    if (!data.access_token) return null;
    console.log(`[SWISH Market v5] eBay app token obtained`);
    return data.access_token;
  } catch { return null; }
}

async function getConnectorCredentials(supabase: ReturnType<typeof adminClient>, tenantId: string) {
  const { data: conn } = await supabase.from('marketplace_connectors').select('credential_ref, status').eq('tenant_id', tenantId).eq('marketplace_id', 'ebay').maybeSingle();
  if (!conn?.credential_ref) return null;
  try { const { decryptCredentials } = await import('../_shared/credentialCrypto.ts'); return await decryptCredentials(conn.credential_ref); }
  catch { return null; }
}

// ── Currency conversion ───────────────────────────────────────────────────────
function toGBP(price: number, currency: string): number {
  const rates: Record<string, number> = { GBP: 1, USD: 0.79, EUR: 0.85, AUD: 0.51, CAD: 0.58, JPY: 0.0053, CHF: 0.89, SEK: 0.072, DKK: 0.114 };
  return price * (rates[currency.toUpperCase()] ?? 1);
}

// ── Title sanitisation ────────────────────────────────────────────────────────
function sanitiseTitle(raw: string): string {
  return raw
    .replace(/[£\$€]\s*\d+(?:[.,]\d+)?/g, ' ')
    .replace(/\b(spares?\s*\/\s*repairs?|for parts?|not working|project bike?|parts only|see desc(?:ription)?|fast delivery|free postage|inc(?:luding)?\s+p&p|\+p&p|collection only|buyer collects?)\b/gi, ' ')
    .replace(/[–—|#+]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ══════════════════════════════════════════════════════════════════════════════
// SOURCE 1: GEMINI VISION MARKET RESEARCH
// ══════════════════════════════════════════════════════════════════════════════
// Uses OnSpace AI (Gemini) to analyse stored item images and return:
//   - Estimated market value range
//   - Optimal eBay search terms
//   - Item identification confirmation
//   - Comparable item description
//
// This works REGARDLESS of eBay API rate limits.
// Evidence class: E (AI inference) — clearly labelled in response.

interface GeminiMarketResult {
  available: boolean;
  searchTerms: string[];          // Optimised eBay search queries from image analysis
  estimatedLow: number;           // AI low estimate (GBP)
  estimatedMid: number;           // AI mid estimate (GBP)
  estimatedHigh: number;          // AI high estimate (GBP)
  confidence: 'high' | 'medium' | 'low' | 'insufficient';
  itemDescription: string;        // What Gemini sees in the images
  marketContext: string;          // Gemini's market assessment
  valuationBasis: string;         // How Gemini derived the estimate
  comparableDescription: string;  // What to search for on eBay
  error?: string;
}

async function runGeminiMarketResearch(
  imageUrls: string[],
  title: string,
  specialistId: string,
  attributes: Record<string, any>,
  condition: string,
): Promise<GeminiMarketResult> {
  const noResult: GeminiMarketResult = {
    available: false, searchTerms: [], estimatedLow: 0, estimatedMid: 0, estimatedHigh: 0,
    confidence: 'insufficient', itemDescription: '', marketContext: '',
    valuationBasis: '', comparableDescription: '',
  };

  const apiKey = Deno.env.get('ONSPACE_AI_API_KEY');
  const baseUrl = Deno.env.get('ONSPACE_AI_BASE_URL');
  if (!apiKey || !baseUrl || imageUrls.length === 0) {
    return { ...noResult, error: 'Gemini vision not configured or no images available' };
  }

  // Build niche-specific valuation prompt
  const nicheContext = specialistId === 'bicycles' || specialistId === 'cycling'
    ? 'This is a bicycle, bike frame, or cycling component being sold on eBay UK.'
    : specialistId === 'motocross'
    ? 'This is a motocross or off-road motorcycle being sold on eBay UK.'
    : specialistId === 'clothing' || specialistId === 'trainers_sneakers'
    ? 'This is a vintage/branded clothing item or trainers being sold on eBay UK or Depop.'
    : (specialistId.includes('coin') || specialistId === 'islamic_silver' || specialistId === 'ancient_artefacts' || specialistId === 'gold' || specialistId === 'silver')
    ? 'This is a coin, medal, or precious metal collectible being sold on eBay UK.'
    : 'This is a collectible or resale item being sold on eBay UK.';

  const knownInfo = Object.entries(attributes)
    .filter(([, v]) => v && String(v).trim() && !['Not established', 'Not supplied', 'Not legible', 'unknown'].includes(String(v)))
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ');

  const prompt = `You are an expert eBay UK reseller and market valuation specialist. ${nicheContext}

ITEM INFORMATION:
- Title: "${title}"
- Condition: "${condition || 'Not specified'}"
- Known attributes: ${knownInfo || 'None provided'}

TASK: Analyse the image(s) to provide market valuation intelligence.

You MUST respond with ONLY valid JSON in this exact format:
{
  "itemDescription": "Brief description of exactly what you see in the images",
  "searchTerms": ["Best eBay UK search query 1", "Alternative query 2", "Broad fallback query 3"],
  "estimatedLow": 0,
  "estimatedMid": 0,
  "estimatedHigh": 0,
  "confidence": "high|medium|low|insufficient",
  "marketContext": "Brief market context: demand, typical buyers, how this sells",
  "valuationBasis": "How you derived the estimate: comparable items, typical eBay sold prices",
  "comparableDescription": "Description of comparable items to search for on eBay"
}

RULES FOR SEARCH TERMS:
- searchTerms[0]: Most specific — include brand + model + key attributes (e.g. "On-One 456 Carbon frame 18 inch")
- searchTerms[1]: Slightly broader — brand + type (e.g. "On-One carbon frame hardtail")
- searchTerms[2]: Broad category fallback (e.g. "carbon mountain bike frame hardtail")
- Max 3 terms, each max 80 characters, specific to eBay UK search

RULES FOR PRICING:
- estimatedLow: realistic lowest sold price on eBay UK (not asking, actual sold)
- estimatedMid: typical/median sold price on eBay UK
- estimatedHigh: upper end of sold price range
- Set all to 0 if you genuinely cannot estimate (very obscure item)
- confidence: "high" if you know this item well, "medium" if reasonable estimate, "low" if uncertain, "insufficient" if no basis

Base estimates on ACTUAL eBay UK sold prices you have knowledge of, not asking prices.
If condition affects value significantly, factor it in.`;

  try {
    const messageContent: any[] = [{ type: 'text', text: prompt }];

    // Add up to 3 images
    for (const url of imageUrls.slice(0, 3)) {
      if (url.startsWith('https://')) {
        messageContent.push({ type: 'image_url', image_url: { url } });
      }
    }

    console.log(`[SWISH Market v5] Gemini vision: analysing ${imageUrls.length} image(s) for "${title}"`);

    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [{ role: 'user', content: messageContent }],
        temperature: 0.1,
        max_tokens: 800,
      }),
      signal: AbortSignal.timeout(25000),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.log(`[SWISH Market v5] Gemini error: HTTP ${resp.status}: ${errText.slice(0, 200)}`);
      return { ...noResult, error: `Gemini API error: ${resp.status}` };
    }

    const data = await resp.json();
    const raw = data.choices?.[0]?.message?.content ?? '';
    const cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

    let parsed: any;
    try { parsed = JSON.parse(cleaned); } catch {
      console.log(`[SWISH Market v5] Gemini JSON parse error. Raw: ${cleaned.slice(0, 200)}`);
      return { ...noResult, error: 'Gemini returned invalid JSON' };
    }

    const result: GeminiMarketResult = {
      available: true,
      searchTerms: Array.isArray(parsed.searchTerms) ? parsed.searchTerms.filter((s: any) => typeof s === 'string' && s.length > 3).slice(0, 3) : [],
      estimatedLow: Math.max(0, Number(parsed.estimatedLow ?? 0)),
      estimatedMid: Math.max(0, Number(parsed.estimatedMid ?? 0)),
      estimatedHigh: Math.max(0, Number(parsed.estimatedHigh ?? 0)),
      confidence: ['high', 'medium', 'low', 'insufficient'].includes(parsed.confidence) ? parsed.confidence : 'low',
      itemDescription: String(parsed.itemDescription ?? '').slice(0, 300),
      marketContext: String(parsed.marketContext ?? '').slice(0, 300),
      valuationBasis: String(parsed.valuationBasis ?? '').slice(0, 300),
      comparableDescription: String(parsed.comparableDescription ?? '').slice(0, 200),
    };

    console.log(`[SWISH Market v5] Gemini result: mid=£${result.estimatedMid} conf=${result.confidence} queries=${result.searchTerms.length}`);
    return result;
  } catch (e: any) {
    console.log(`[SWISH Market v5] Gemini exception: ${e.message}`);
    return { ...noResult, error: `Gemini error: ${e.message}` };
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// SOURCE 2: eBay VISUAL SEARCH (Browse API search_by_image)
// ══════════════════════════════════════════════════════════════════════════════
// Sends first stored item image to eBay's visual search endpoint.
// Returns ACTIVE listings (not sold) — used for asking price context only.
// Evidence class: B (active asking prices — never used as sold evidence).

interface VisualSearchResult {
  available: boolean;
  items: Array<{ title: string; price: number; currency: string; imageUrl: string; url: string }>;
  totalFound: number;
  error?: string;
}

async function runEbayVisualSearch(
  imageUrl: string,
  appToken: string,
): Promise<VisualSearchResult> {
  const noResult: VisualSearchResult = { available: false, items: [], totalFound: 0 };
  if (!appToken || !imageUrl) return noResult;

  try {
    // Fetch the image bytes from the Supabase Storage URL
    const imgResp = await fetch(imageUrl, { signal: AbortSignal.timeout(10000) });
    if (!imgResp.ok) {
      console.log(`[SWISH Market v5] Visual search: could not fetch image (${imgResp.status})`);
      return { ...noResult, error: `Could not fetch image: ${imgResp.status}` };
    }

    const imgBuffer = await imgResp.arrayBuffer();
    const imgBytes = new Uint8Array(imgBuffer);
    let b64 = '';
    const chunkSize = 8192;
    for (let i = 0; i < imgBytes.length; i += chunkSize) {
      b64 += String.fromCharCode(...imgBytes.slice(i, i + chunkSize));
    }
    const imageBase64 = btoa(b64);

    if (imageBase64.length < 100) return { ...noResult, error: 'Image too small for visual search' };

    const params = new URLSearchParams({ limit: '10', fieldgroups: 'MATCHING_ITEMS' });
    const resp = await fetch(`${EBAY_BROWSE_BASE}/item_summary/search_by_image?${params}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${appToken}`,
        'X-EBAY-C-MARKETPLACE-ID': EBAY_GLOBAL_ID,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ image: imageBase64 }),
      signal: AbortSignal.timeout(15000),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.log(`[SWISH Market v5] Visual search HTTP ${resp.status}: ${errText.slice(0, 200)}`);
      return { ...noResult, error: `eBay visual search ${resp.status}` };
    }

    const data = await resp.json();
    const rawItems = data.itemSummaries ?? [];
    const totalFound = Number(data.total ?? rawItems.length);

    const items = rawItems.slice(0, 10).map((item: any) => ({
      title: item.title ?? '',
      price: Number(item.price?.value ?? 0),
      currency: item.price?.currency ?? 'GBP',
      imageUrl: item.image?.imageUrl ?? item.thumbnailImages?.[0]?.imageUrl ?? '',
      url: item.itemWebUrl ?? '',
    })).filter((i: any) => i.price > 0);

    console.log(`[SWISH Market v5] Visual search: ${items.length} results (total ${totalFound})`);
    return { available: true, items, totalFound };
  } catch (e: any) {
    console.log(`[SWISH Market v5] Visual search exception: ${e.message}`);
    return { ...noResult, error: e.message };
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// SOURCE 3: eBay FINDING API — SOLD ITEMS (with retry backoff)
// ══════════════════════════════════════════════════════════════════════════════
// Uses findCompletedItems with SoldItemsOnly=true.
// Retries on HTTP 418 (rate limit) with exponential backoff.
// Evidence class: A (verified sold transactions).

interface EbaySoldResult {
  listings: Array<{
    title: string;
    price: number;
    currency: string;
    listingType: 'Auction' | 'FixedPrice';
    endDate: string;
    condition: string;
    url: string;
    bids: number;
  }>;
  totalFound: number;
  query: string;
  error?: string;
  rateLimited?: boolean;
}

async function searchEbaySoldListings(
  clientId: string,
  query: string,
  maxResults = 50,
): Promise<EbaySoldResult> {
  const noResult: EbaySoldResult = { listings: [], totalFound: 0, query };
  const params = new URLSearchParams({
    'OPERATION-NAME': 'findCompletedItems',
    'SERVICE-VERSION': '1.13.0',
    'SECURITY-APPNAME': clientId,
    'RESPONSE-DATA-FORMAT': 'JSON',
    'REST-PAYLOAD': '',
    'GLOBAL-ID': EBAY_GLOBAL_ID,
    'keywords': query.slice(0, 100),
    'sortOrder': 'EndTimeSoonest',
    'paginationInput.entriesPerPage': String(Math.min(maxResults, 100)),
    'paginationInput.pageNumber': '1',
    'itemFilter(0).name': 'SoldItemsOnly',
    'itemFilter(0).value': 'true',
    'itemFilter(1).name': 'HideDuplicateItems',
    'itemFilter(1).value': 'true',
  });

  const url = `${EBAY_FINDING_API}?${params.toString()}`;
  console.log(`[SWISH Market v5] Finding API: "${query}" marketplace=${EBAY_GLOBAL_ID}`);

  // Retry up to 3 times with backoff on 418
  const retryDelays = [0, 2500, 5000];
  let lastError = '';

  for (let attempt = 0; attempt < retryDelays.length; attempt++) {
    if (retryDelays[attempt] > 0) {
      console.log(`[SWISH Market v5] 418 rate limit — waiting ${retryDelays[attempt]}ms before retry ${attempt}/${retryDelays.length - 1}`);
      await sleep(retryDelays[attempt]);
    }

    try {
      const resp = await fetch(url, {
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(18000),
      });

      if (resp.status === 418 || resp.status === 429) {
        lastError = `HTTP ${resp.status} rate limit`;
        if (attempt < retryDelays.length - 1) continue;
        return { ...noResult, error: lastError, rateLimited: true };
      }

      if (!resp.ok) {
        const errText = await resp.text();
        console.log(`[SWISH Market v5] Finding API HTTP ${resp.status}: ${errText.slice(0, 200)}`);
        return { ...noResult, error: `eBay Finding API ${resp.status}` };
      }

      const data = await resp.json();
      const searchResult = data?.findCompletedItemsResponse?.[0];
      if (!searchResult) return { ...noResult, error: 'Empty response structure' };

      const ack = searchResult.ack?.[0];
      if (ack !== 'Success' && ack !== 'Warning') {
        const errMsg = searchResult.errorMessage?.[0]?.error?.[0]?.message?.[0] ?? `ack=${ack}`;
        console.log(`[SWISH Market v5] Finding API ack failure: ${errMsg}`);
        return { ...noResult, error: errMsg };
      }

      const totalFound = parseInt(searchResult.paginationOutput?.[0]?.totalEntries?.[0] ?? '0') || 0;
      const rawItems = searchResult.searchResult?.[0]?.item ?? [];

      console.log(`[SWISH Market v5] Finding API: ${totalFound} total found for "${query}", fetched ${rawItems.length}`);

      if (rawItems.length > 0) {
        const sampleTitles = rawItems.slice(0, 5).map((i: any) => i.title?.[0] ?? '').join(' | ');
        console.log(`[SWISH Market v5] Sample titles: ${sampleTitles.slice(0, 250)}`);
      }

      const listings: EbaySoldResult['listings'] = [];
      let soldCount = 0;
      let unsoldCount = 0;

      for (const item of rawItems) {
        const sellingStatus = item.sellingStatus?.[0] ?? {};
        const listingInfo = item.listingInfo?.[0] ?? {};
        const conditionInfo = item.condition?.[0] ?? {};
        const sellingState = sellingStatus.sellingState?.[0] ?? '';

        if (sellingState !== 'EndedWithSales') { unsoldCount++; continue; }
        soldCount++;

        const price = parseFloat(sellingStatus.convertedCurrentPrice?.[0]?.['__value__'] ?? sellingStatus.currentPrice?.[0]?.['__value__'] ?? '0');
        if (price <= 0) continue;

        const currency = sellingStatus.convertedCurrentPrice?.[0]?.['@currencyId'] ?? sellingStatus.currentPrice?.[0]?.['@currencyId'] ?? 'GBP';
        const gbpPrice = toGBP(price, currency);
        const listingType = (listingInfo.listingType?.[0] ?? 'FixedPrice').includes('Auction') ? 'Auction' : 'FixedPrice';

        listings.push({
          title: item.title?.[0] ?? '',
          price: Math.round(gbpPrice * 100) / 100,
          currency, listingType,
          endDate: listingInfo.endTime?.[0] ?? '',
          condition: conditionInfo.conditionDisplayName?.[0] ?? '',
          url: item.viewItemURL?.[0] ?? '',
          bids: parseInt(sellingStatus.bidCount?.[0] ?? '0') || 0,
        });
      }

      console.log(`[SWISH Market v5] Finding API: ${soldCount} sold, ${unsoldCount} unsold, ${listings.length} parsed`);
      return { listings, totalFound, query };

    } catch (e: any) {
      lastError = e.message;
      if (attempt < retryDelays.length - 1) continue;
      console.log(`[SWISH Market v5] Finding API exception: ${e.message}`);
      return { ...noResult, error: e.message };
    }
  }

  return { ...noResult, error: lastError };
}

// ══════════════════════════════════════════════════════════════════════════════
// RELEVANCE SCORING
// ══════════════════════════════════════════════════════════════════════════════
// Relaxed from v4 — broader matching to avoid zero-result scenarios.
// MIN_RELEVANCE lowered to 0.30 (was 0.40) when few results are available.

function scoreListing(
  title: string,
  price: number,
  targetTitle: string,
  targetAttrs: Record<string, any>,
  specialistId: string,
): { score: number; reason: string } {
  const compLower = title.toLowerCase();
  const targetLower = sanitiseTitle(targetTitle).toLowerCase();
  const targetWords = targetLower.split(/\s+/).filter(w => w.length > 2);
  const matched = targetWords.filter(w => compLower.includes(w));
  const overlap = targetWords.length > 0 ? matched.length / targetWords.length : 0;

  let score = 0.40;

  if (overlap >= 0.70) { score += 0.25; }
  else if (overlap >= 0.50) { score += 0.15; }
  else if (overlap >= 0.35) { score += 0.07; }
  else if (overlap >= 0.20) { score += 0.02; }
  else { score -= 0.15; }

  // Niche-specific bonuses
  const isBike = specialistId === 'bicycles' || specialistId === 'cycling';
  const isMX = specialistId === 'motocross';
  const isClothing = specialistId === 'clothing' || specialistId === 'trainers_sneakers';
  const isCoin = specialistId.includes('coin') || specialistId === 'islamic_silver' ||
    specialistId === 'ancient_artefacts' || specialistId === 'gold' || specialistId === 'silver' ||
    specialistId === 'banknotes';

  if (isBike) {
    const brand = String(targetAttrs?.manufacturer ?? targetAttrs?.brand ?? '').toLowerCase();
    const model = String(targetAttrs?.model ?? targetAttrs?.model_name ?? '').toLowerCase();
    if (brand && compLower.includes(brand)) { score += 0.15; }
    if (model && model.length > 2 && compLower.includes(model.split(' ')[0])) { score += 0.10; }
    if (['mountain bike', 'mtb', 'road bike', 'gravel', 'hardtail', 'full suspension', 'frame', 'bicycle', 'bike'].some(k => compLower.includes(k))) { score += 0.05; }
  }

  if (isMX) {
    const make = String(targetAttrs?.manufacturer ?? targetAttrs?.brand ?? targetAttrs?.make ?? '').toLowerCase();
    const engineCC = String(targetAttrs?.engine_size ?? targetAttrs?.displacement ?? '').replace(/[^0-9]/g, '');
    if (make && compLower.includes(make)) { score += 0.18; }
    if (engineCC && compLower.includes(engineCC)) { score += 0.10; }
    if (['motocross', 'mx', 'enduro', 'dirt bike', 'off road', 'supermoto'].some(k => compLower.includes(k))) { score += 0.05; }
  }

  if (isClothing) {
    const brand = String(targetAttrs?.brand ?? targetAttrs?.Brand ?? '').toLowerCase();
    const garment = String(targetAttrs?.garment_type ?? targetAttrs?.item_type ?? '').toLowerCase();
    if (brand && compLower.includes(brand)) { score += 0.20; }
    if (garment && garment.length > 2 && compLower.includes(garment)) { score += 0.10; }
    if (['vintage', 'deadstock', 'retro', 'rare'].some(k => compLower.includes(k))) { score += 0.04; }
  }

  if (isCoin) {
    const denom = String(targetAttrs?.denomination ?? '').toLowerCase();
    const ruler = String(targetAttrs?.ruler ?? '').toLowerCase();
    if (denom && denom.length > 1 && compLower.includes(denom)) { score += 0.15; }
    if (ruler && ruler.length > 2) {
      const rulerLast = ruler.split(' ').pop() ?? ruler;
      if (compLower.includes(rulerLast)) { score += 0.12; }
    }
    // Islamic coins
    const islamicKeywords = ['islamic', 'dirham', 'dinar', 'tanka', 'tanker', 'umayyad', 'abbasid', 'fatimid', 'silver coin', 'arabic'];
    if (specialistId === 'islamic_silver' && islamicKeywords.some(k => compLower.includes(k))) { score += 0.18; }
  }

  // Outlier penalty
  if (price > 5000) { score -= 0.10; }

  return { score: Math.max(0, Math.min(1, score)), reason: `${Math.round(overlap * 100)}% title match` };
}

// ══════════════════════════════════════════════════════════════════════════════
// VALUATION COMPUTATION
// ══════════════════════════════════════════════════════════════════════════════

interface ComputedValuation {
  valuationLow: number;
  valuationMid: number;
  valuationHigh: number;
  valuationConfidence: string;
  valuationMethod: string;
  valuationWarnings: string[];
  recommendedListingPrice: number;
  recommendedListingFormat: 'Auction' | 'BuyItNow' | 'BuyItNow_WithBestOffer';
  listingPriceRationale: string;
  saleProb30d: number | null;
  fairMarketValue: number;
  currentAskingMarketMid: number;
  auctionStartPrice?: number;
}

function computeValuation(params: {
  ebaySold: EbaySoldResult[];
  gemini: GeminiMarketResult;
  visualSearch: VisualSearchResult;
  targetTitle: string;
  targetAttrs: Record<string, any>;
  specialistId: string;
  identificationConfidence: number;
  identificationTier: string;
  condition: string;
}): ComputedValuation {
  const { ebaySold, gemini, visualSearch, targetTitle, targetAttrs, specialistId, identificationConfidence, identificationTier, condition } = params;

  const noVal: ComputedValuation = {
    valuationLow: 0, valuationMid: 0, valuationHigh: 0,
    valuationConfidence: 'insufficient_data', valuationMethod: 'no_data',
    valuationWarnings: [], recommendedListingPrice: 0,
    recommendedListingFormat: 'BuyItNow', listingPriceRationale: 'Insufficient market data.',
    saleProb30d: null, fairMarketValue: 0, currentAskingMarketMid: 0,
  };

  // Aggregate all sold listings from all searches, deduplicated
  const allSold: Array<{ title: string; price: number; score: number; date: string; listingType: string }> = [];
  const seenTitlePrice = new Set<string>();

  // Use adaptive relevance threshold — lower if we have few results
  const totalRaw = ebaySold.reduce((sum, r) => sum + r.listings.length, 0);
  const MIN_RELEVANCE = totalRaw < 10 ? 0.28 : 0.35;

  for (const result of ebaySold) {
    for (const listing of result.listings) {
      const key = `${listing.price}-${listing.title.slice(0, 20)}`;
      if (seenTitlePrice.has(key)) continue;
      seenTitlePrice.add(key);

      const { score } = scoreListing(listing.title, listing.price, targetTitle, targetAttrs, specialistId);
      if (score >= MIN_RELEVANCE) {
        allSold.push({ title: listing.title, price: listing.price, score, date: listing.endDate, listingType: listing.listingType });
      }
    }
  }

  const relevantCount = allSold.length;
  const prices = allSold.map(s => s.price).sort((a, b) => a - b);
  const n = prices.length;

  // Visual search asking prices (for context only — not used in valuation)
  const askingPrices = visualSearch.items.map(i => toGBP(i.price, i.currency));
  const askingMedian = askingPrices.length > 0 ? askingPrices.sort((a, b) => a - b)[Math.floor(askingPrices.length / 2)] : 0;

  const warnings: string[] = [];

  // ── Case 1: Enough real sold data ────────────────────────────────────────
  if (n >= 3) {
    // IQR outlier detection
    let mainPrices = prices;
    if (n >= 6) {
      const q1 = prices[Math.floor(n * 0.25)];
      const q3 = prices[Math.floor(n * 0.75)];
      const iqr = q3 - q1;
      const upper = q3 + 2.5 * iqr;
      mainPrices = prices.filter(p => p <= upper);
    }
    const mn = mainPrices.length;
    const median = mainPrices[Math.floor(mn * 0.5)] ?? 0;
    const low = mainPrices[Math.floor(mn * 0.15)] ?? mainPrices[0] ?? 0;
    const high = mainPrices[Math.floor(mn * 0.85)] ?? mainPrices[mn - 1] ?? 0;

    const dataQuality = n >= 10 ? 'high' : n >= 5 ? 'medium' : 'low';
    const idScore = identificationTier === 'very_high' || identificationTier === 'high' ? 3 :
      identificationTier === 'medium' ? 2 : 1;
    const valConf = n >= 10 && idScore >= 2 ? 'high' : n >= 5 || idScore >= 3 ? 'medium' : 'low';

    const auctionCount = allSold.filter(s => s.listingType === 'Auction').length;
    const auctionShare = Math.round(auctionCount / n * 100);
    const useAuction = auctionShare >= 40 && n >= 5;

    let recommendedListingPrice: number;
    let format: ComputedValuation['recommendedListingFormat'];
    let auctionStartPrice: number | undefined;
    let rationale: string;

    if (useAuction) {
      auctionStartPrice = Math.max(0.99, Math.round(median * 0.15 * 100) / 100);
      recommendedListingPrice = auctionStartPrice;
      format = 'Auction';
      rationale = `Auction recommended (${auctionShare}% of ${n} comparables were auctions). Start at £${auctionStartPrice}. Based on ${n} verified eBay UK sold listings.`;
    } else {
      const ratio = dataQuality === 'high' ? 0.92 : 0.95;
      recommendedListingPrice = Math.round(median * ratio * 100) / 100;
      format = median >= 30 ? 'BuyItNow_WithBestOffer' : 'BuyItNow';
      rationale = `BIN at £${recommendedListingPrice} (${Math.round(ratio * 100)}% of £${median} median). Based on ${n} verified eBay UK sold listings (EBAY_GB).`;
    }

    if (askingMedian > median * 1.5) warnings.push(`Active asking prices (median £${Math.round(askingMedian)}) significantly above sold prices — listed for asking prices only.`);

    return {
      valuationLow: Math.round(low * 100) / 100,
      valuationMid: Math.round(median * 100) / 100,
      valuationHigh: Math.round(high * 100) / 100,
      valuationConfidence: valConf,
      valuationMethod: 'ebay_verified_sold_relevance_median',
      valuationWarnings: warnings,
      recommendedListingPrice, recommendedListingFormat: format, auctionStartPrice,
      listingPriceRationale: rationale,
      saleProb30d: n >= 5 ? Math.min(0.95, n / 30) : null,
      fairMarketValue: Math.round(median * 100) / 100,
      currentAskingMarketMid: Math.round(askingMedian * 100) / 100,
    };
  }

  // ── Case 2: 1-2 sold comps + Gemini ───────────────────────────────────────
  if (n >= 1 && gemini.available && gemini.estimatedMid > 0) {
    const soldMedian = prices[Math.floor(n / 2)] ?? prices[0] ?? 0;
    // Blend: 60% sold evidence, 40% Gemini
    const blendedMid = Math.round((soldMedian * 0.60 + gemini.estimatedMid * 0.40) * 100) / 100;
    const blendedLow = Math.round(Math.min(prices[0], gemini.estimatedLow) * 100) / 100;
    const blendedHigh = Math.round(Math.max(prices[n - 1] ?? prices[0], gemini.estimatedHigh) * 100) / 100;

    warnings.push(`Only ${n} sold comparable${n === 1 ? '' : 's'} found — blended with AI market estimate.`);
    warnings.push('Treat as indicative — limited verified sold evidence.');

    return {
      valuationLow: blendedLow,
      valuationMid: blendedMid,
      valuationHigh: blendedHigh,
      valuationConfidence: 'low',
      valuationMethod: 'ebay_sold_blended_with_ai_estimate',
      valuationWarnings: warnings,
      recommendedListingPrice: Math.round(blendedMid * 0.95 * 100) / 100,
      recommendedListingFormat: 'BuyItNow_WithBestOffer',
      listingPriceRationale: `Indicative: ${n} eBay sold comp${n === 1 ? '' : 's'} blended with AI market estimate. Verify before listing.`,
      saleProb30d: null,
      fairMarketValue: blendedMid,
      currentAskingMarketMid: Math.round(askingMedian * 100) / 100,
    };
  }

  // ── Case 3: Only Gemini (no eBay sold data) ────────────────────────────────
  if (gemini.available && gemini.estimatedMid > 0) {
    const confMap: Record<string, string> = { high: 'low', medium: 'very_low', low: 'very_low', insufficient: 'insufficient_data' };
    const valConf = confMap[gemini.confidence] ?? 'very_low';

    const ebayTotalSearched = ebaySold.reduce((sum, r) => sum + r.totalFound, 0);
    const allRateLimited = ebaySold.every(r => r.rateLimited);

    if (ebayTotalSearched > 0) {
      warnings.push(`${ebayTotalSearched} eBay sold items found but none scored as relevant matches. AI estimate used instead.`);
    } else if (allRateLimited) {
      warnings.push('eBay search temporarily rate-limited. AI market estimate used — try Re-Value in 30 seconds for eBay sold data.');
    } else {
      warnings.push('No eBay sold listings found for this item. AI market estimate used — treat as very indicative.');
    }
    warnings.push(`AI estimate basis: ${gemini.valuationBasis}`);

    const listPrice = Math.round(gemini.estimatedMid * 0.93 * 100) / 100;

    return {
      valuationLow: gemini.estimatedLow,
      valuationMid: gemini.estimatedMid,
      valuationHigh: gemini.estimatedHigh,
      valuationConfidence: valConf,
      valuationMethod: 'ai_market_estimate_gemini_vision',
      valuationWarnings: warnings,
      recommendedListingPrice: valConf === 'insufficient_data' ? 0 : listPrice,
      recommendedListingFormat: 'BuyItNow_WithBestOffer',
      listingPriceRationale: valConf === 'insufficient_data'
        ? 'Insufficient data — no listing price recommendation. Research manually before listing.'
        : `AI estimate: £${gemini.estimatedMid} (${gemini.confidence} confidence). Verify with market research before listing. ${gemini.marketContext}`,
      saleProb30d: null,
      fairMarketValue: gemini.estimatedMid,
      currentAskingMarketMid: Math.round(askingMedian * 100) / 100,
    };
  }

  // ── Case 4: Only asking prices (visual search) ─────────────────────────────
  if (askingMedian > 0) {
    warnings.push(`No verified sold data found. ${visualSearch.items.length} active asking prices found (median £${Math.round(askingMedian)}) — shown for context ONLY. Asking ≠ sold.`);
    return {
      ...noVal,
      valuationWarnings: warnings,
      currentAskingMarketMid: Math.round(askingMedian * 100) / 100,
      listingPriceRationale: 'No sold data available. Active asking prices shown for context only — they are not verified sales.',
    };
  }

  // ── Case 5: Nothing found ──────────────────────────────────────────────────
  const ebayErrors = ebaySold.map(r => r.error).filter(Boolean);
  const allRateLimited = ebaySold.every(r => r.rateLimited);

  warnings.push(allRateLimited
    ? 'eBay search temporarily rate-limited. Please try Re-Value again in 30-60 seconds.'
    : ebayErrors.length > 0 ? `eBay API: ${ebayErrors[0]}` : 'No comparable sold data found for this item.');

  return { ...noVal, valuationWarnings: warnings };
}

// ══════════════════════════════════════════════════════════════════════════════
// BUILD SEARCH QUERIES
// ══════════════════════════════════════════════════════════════════════════════
// Priority: Gemini-generated terms first, then attribute-based fallbacks,
// then sanitised title. This ensures the best queries hit eBay first.

function buildSearchQueries(
  title: string,
  attributes: Record<string, any>,
  specialistId: string,
  geminiTerms: string[],
): string[] {
  const queries: string[] = [];
  const sanitised = sanitiseTitle(title);

  // Gemini terms take priority (derived from actual images)
  for (const term of geminiTerms) {
    if (term.length >= 4 && !queries.includes(term)) queries.push(term.slice(0, 100));
  }

  // Attribute-based queries as fallbacks
  const isBike = specialistId === 'bicycles' || specialistId === 'cycling';
  const isMX = specialistId === 'motocross';
  const isClothing = specialistId === 'clothing' || specialistId === 'trainers_sneakers';
  const isCoin = specialistId.includes('coin') || specialistId === 'islamic_silver' ||
    specialistId === 'ancient_artefacts' || specialistId === 'gold' || specialistId === 'silver';

  if (isBike) {
    const brand = String(attributes?.manufacturer ?? attributes?.brand ?? '').trim();
    const model = String(attributes?.model ?? attributes?.model_name ?? '').trim();
    const year = String(attributes?.year_range ?? attributes?.year_made ?? '').trim().split('-')[0];
    const frameType = String(attributes?.bike_type ?? attributes?.frame_type ?? '').trim();
    if (brand && model) {
      const q = [brand, model, year].filter(Boolean).join(' ').slice(0, 100);
      if (!queries.includes(q)) queries.push(q);
    }
    if (brand && frameType) {
      const q = `${brand} ${frameType}`.slice(0, 80);
      if (!queries.includes(q)) queries.push(q);
    }
    if (brand) {
      const q = `${brand} frame`.slice(0, 60);
      if (!queries.includes(q)) queries.push(q);
    }
  }

  if (isMX) {
    const make = String(attributes?.manufacturer ?? attributes?.brand ?? attributes?.make ?? '').trim();
    const model = String(attributes?.model ?? attributes?.model_family ?? '').trim();
    const engine = String(attributes?.engine_size ?? attributes?.displacement ?? '').replace(/[^0-9]/g, '');
    const year = String(attributes?.year_range ?? attributes?.year ?? '').split('-')[0].trim();
    if (make && engine) {
      const q = [make, model, year, engine ? engine + 'cc' : ''].filter(Boolean).join(' ').slice(0, 100);
      if (!queries.includes(q)) queries.push(q);
    }
    if (make) {
      const q = `${make} motocross`.slice(0, 60);
      if (!queries.includes(q)) queries.push(q);
    }
  }

  if (isClothing) {
    const brand = String(attributes?.brand ?? attributes?.Brand ?? '').trim();
    const garment = String(attributes?.garment_type ?? attributes?.item_type ?? '').trim();
    const era = String(attributes?.era ?? attributes?.era_estimate ?? '').trim();
    if (brand && garment) {
      const q = [brand, garment, era].filter(Boolean).join(' ').slice(0, 100);
      if (!queries.includes(q)) queries.push(q);
    }
    if (brand) {
      const q = `vintage ${brand} ${garment || 'clothing'}`.slice(0, 80);
      if (!queries.includes(q)) queries.push(q);
    }
  }

  if (isCoin) {
    if (specialistId === 'islamic_silver') {
      const dynasty = String(attributes?.dynasty ?? attributes?.period ?? '').trim();
      const ruler = String(attributes?.ruler ?? attributes?.caliph ?? '').trim();
      const denom = String(attributes?.denomination ?? attributes?.coin_type ?? '').trim();
      if (dynasty && denom) {
        const q = `${dynasty} ${denom} silver coin`.slice(0, 100);
        if (!queries.includes(q)) queries.push(q);
      }
      if (denom) {
        const q = `${denom} Islamic silver coin`.slice(0, 80);
        if (!queries.includes(q)) queries.push(q);
      }
      if (!queries.some(q => q.includes('Islamic'))) {
        queries.push('Islamic silver coin dirham');
      }
    } else {
      const ruler = String(attributes?.ruler ?? '').trim();
      const denom = String(attributes?.denomination ?? '').trim();
      const year = String(attributes?.year_made ?? '').trim();
      if (ruler && denom) {
        const q = [ruler, denom, year].filter(Boolean).join(' ').slice(0, 100);
        if (!queries.includes(q)) queries.push(q);
      }
    }
  }

  // Always add sanitised title as a fallback
  const cleanTitle = sanitised.slice(0, 100);
  if (cleanTitle.length >= 4 && !queries.includes(cleanTitle)) queries.push(cleanTitle);

  // Deduplicate and limit
  return queries
    .filter((q, i, arr) => q.length >= 3 && arr.indexOf(q) === i)
    .slice(0, 4);
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
    attributes = {},
    condition = '',
    identificationConfidence = 0.5,
    identificationTier = 'medium',
    numistaTypeId,
    numistaMatchScore = 0,
    numistaMatchTier = 'no_match',
    applyToItem = false,
    // Optional: caller can pass stored image URLs directly
    imageUrls: callerImageUrls,
  } = body;

  if (!tenantId) return jsonResponse({ error: 'tenantId is required' }, 400);
  if (!title || title.trim().length < 3) return jsonResponse({ error: 'title is required (min 3 chars)' }, 400);

  const supabase = adminClient();
  const authHeader = req.headers.get('Authorization');
  const sec = await verifyTenantAccess(supabase, authHeader, tenantId);
  if (!sec.ok) return jsonResponse({ error: sec.error }, authHeader ? 403 : 401);

  console.log(`[SWISH Market v5] title="${title}" specialist=${specialistId}`);

  // ── Get eBay credentials ──────────────────────────────────────────────────
  const rawCreds = await getConnectorCredentials(supabase, tenantId);
  const clientId = (rawCreds as any)?.clientId ?? '';
  const clientSecret = (rawCreds as any)?.clientSecret ?? '';

  if (!clientId) {
    return jsonResponse({ error: 'eBay is not connected. Connect eBay in Marketplaces to enable market valuation.' }, 400);
  }

  // ── Resolve stored item images ────────────────────────────────────────────
  // Use caller-provided URLs, or load from DB item record
  let imageUrls: string[] = [];

  if (Array.isArray(callerImageUrls) && callerImageUrls.length > 0) {
    imageUrls = callerImageUrls.filter((u: string) => typeof u === 'string' && u.startsWith('https://'));
  } else if (itemId) {
    const { data: itemRow } = await supabase
      .from('items')
      .select('media')
      .eq('id', itemId)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    imageUrls = ((itemRow?.media ?? []) as string[]).filter(u => typeof u === 'string' && u.startsWith('https://'));
  }

  console.log(`[SWISH Market v5] Image URLs available: ${imageUrls.length}`);

  // ── Phase 1: Gemini Vision (no quota concerns, runs first) ────────────────
  const geminiPromise = runGeminiMarketResearch(imageUrls, title, specialistId, attributes, condition);

  // ── Phase 2: eBay app token (needed for visual search) ───────────────────
  const appTokenPromise = getEbayAppToken(clientId, clientSecret);

  const [gemini, appToken] = await Promise.all([geminiPromise, appTokenPromise]);

  console.log(`[SWISH Market v5] Gemini: available=${gemini.available} mid=£${gemini.estimatedMid} terms=${gemini.searchTerms.length}`);

  // Build search queries — Gemini terms take priority
  const searchQueries = buildSearchQueries(title, attributes, specialistId, gemini.searchTerms);
  console.log(`[SWISH Market v5] Queries: ${searchQueries.map((q, i) => `[${i + 1}] "${q}"`).join(', ')}`);

  // ── Phase 3: eBay visual search (parallel with first Finding API call) ────
  const visualSearchPromise = (appToken && imageUrls.length > 0)
    ? runEbayVisualSearch(imageUrls[0], appToken)
    : Promise.resolve<VisualSearchResult>({ available: false, items: [], totalFound: 0 });

  // ── Phase 4: eBay Finding API — SEQUENTIAL with delays to avoid 418 ───────
  // Fire first query in parallel with visual search, then remaining sequentially
  const [firstSoldResult, visualSearch] = await Promise.all([
    searchEbaySoldListings(clientId, searchQueries[0], 50),
    visualSearchPromise,
  ]);

  const soldResults: EbaySoldResult[] = [firstSoldResult];

  // Sequential fallback queries — only if first query returned few results
  const totalSoldFromFirst = firstSoldResult.listings.length;
  const remainingQueries = searchQueries.slice(1);

  if (totalSoldFromFirst < 10 && remainingQueries.length > 0) {
    for (const query of remainingQueries) {
      await sleep(800); // 800ms between eBay calls
      const result = await searchEbaySoldListings(clientId, query, 30);
      soldResults.push(result);
      if (soldResults.reduce((sum, r) => sum + r.listings.length, 0) >= 15) break;
    }
  }

  const totalEbayFound = soldResults.reduce((sum, r) => sum + r.totalFound, 0);
  const totalEbaySold = soldResults.reduce((sum, r) => sum + r.listings.length, 0);
  const allRateLimited = soldResults.every(r => r.rateLimited);

  console.log(`[SWISH Market v5] eBay results: ${totalEbaySold} sold items from ${soldResults.length} queries (total found: ${totalEbayFound})`);
  console.log(`[SWISH Market v5] Visual search: ${visualSearch.items.length} items (available=${visualSearch.available})`);

  // ── Compute final valuation ───────────────────────────────────────────────
  const isMX = specialistId === 'motocross';
  const MX_MULTIPLIERS: Record<string, number> = {
    'Runs and rides (stated)': 1.00, 'Runs & Rides': 1.00, 'Runs (stated)': 0.85,
    'Non-running (stated)': 0.55, 'Non-Running': 0.55, 'Project': 0.50,
    'Non-running (visible evidence)': 0.50, 'Unknown from images alone': 0.70, 'Unknown': 0.70,
  };
  const mxRunningStatus = isMX ? (attributes?.running_status ?? 'Unknown') : null;
  const mxMultiplier = isMX ? (MX_MULTIPLIERS[mxRunningStatus ?? ''] ?? 0.70) : 1.0;

  let valuation = computeValuation({
    ebaySold: soldResults,
    gemini,
    visualSearch,
    targetTitle: title,
    targetAttrs: attributes,
    specialistId,
    identificationConfidence,
    identificationTier,
    condition,
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
      listingPriceRationale: `${valuation.listingPriceRationale} [Running status: ${mxRunningStatus} = ${Math.round(m * 100)}% of running-bike comparables]`,
    };
  }

  // ── Apply to item if requested ────────────────────────────────────────────
  let applied = false;
  if (applyToItem && itemId && valuation.valuationMid > 0) {
    try {
      await supabase.from('items').update({
        valuation_low: valuation.valuationLow,
        valuation_mid: valuation.valuationMid,
        valuation_high: valuation.valuationHigh,
        valuation_confidence: valuation.valuationConfidence,
        expected_selling_price: valuation.recommendedListingPrice,
        sale_prob_30d: valuation.saleProb30d,
        updated_at: new Date().toISOString(),
      }).eq('id', itemId).eq('tenant_id', tenantId);
      applied = true;
    } catch (e: any) { console.log(`[SWISH Market v5] Auto-apply failed: ${e.message}`); }
  }

  // ── Collect top comparable sales for audit trail ──────────────────────────
  const allSoldFlat = soldResults.flatMap(r => r.listings);
  const topComparables = allSoldFlat
    .map(l => {
      const { score, reason } = scoreListing(l.title, l.price, title, attributes, specialistId);
      return { ...l, score, reason };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 12)
    .map(l => ({ title: l.title.slice(0, 80), price: l.price, date: l.date, listingType: l.listingType, score: Math.round(l.score * 100), url: l.url }));

  const relevantSoldCount = topComparables.filter(l => l.score >= 28).length;

  console.log(`[SWISH Market v5] Final: mid=£${valuation.valuationMid} conf=${valuation.valuationConfidence} relevantSold=${relevantSoldCount}`);

  // ── Build response ─────────────────────────────────────────────────────────
  return jsonResponse({
    success: true,
    searchQuery: searchQueries[0],
    searchQueriesUsed: searchQueries,
    valuation,

    soldMarket: {
      verifiedSoldCount: totalEbaySold,
      relevantSoldCount,
      excludedSoldCount: totalEbaySold - relevantSoldCount,
      medianPrice: valuation.valuationMid,
      weightedMedianPrice: valuation.valuationMid,
      lowPrice: valuation.valuationLow,
      highPrice: valuation.valuationHigh,
      auctionMedian: 0,
      binMedian: 0,
      auctionShare: 0,
      dateRange: topComparables.length > 0 ? `${topComparables[topComparables.length - 1]?.date?.slice(0, 10) ?? ''} to ${topComparables[0]?.date?.slice(0, 10) ?? ''}` : 'unknown',
      dataQuality: valuation.valuationConfidence === 'high' ? 'strong' : valuation.valuationConfidence === 'medium' ? 'moderate' : valuation.valuationConfidence === 'low' ? 'weak' : 'insufficient',
      dataQualityReason: valuation.listingPriceRationale,
      exceptionalSales: [],
      sampleExclusions: [],
    },

    // Gemini AI market research (evidence class E — clearly labelled)
    geminiMarketResearch: gemini.available ? {
      available: true,
      evidenceClass: 'ai_inference',
      evidenceNote: 'AI market estimate from image analysis — NOT verified sold data. Lower confidence than eBay sold comps.',
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
      evidenceClass: 'active_asking',
      evidenceNote: 'Active eBay listings found via image similarity — ASKING PRICES ONLY, not verified sales.',
      totalFound: visualSearch.totalFound,
      items: visualSearch.items.slice(0, 8).map(i => ({
        title: i.title.slice(0, 80), price: i.price, currency: i.currency,
        imageUrl: i.imageUrl, url: i.url,
      })),
    },

    numistaSales: null, // v5: Numista sales handled separately by swish-identify

    combinedEvidence: {
      numistaRelevant: 0,
      ebayRelevant: relevantSoldCount,
      total: relevantSoldCount,
      combinedMedian: valuation.valuationMid,
      combinedLow: valuation.valuationLow,
      combinedHigh: valuation.valuationHigh,
    },

    activeAskingPrices: {
      note: 'ASKING PRICES ONLY — not verified sales. Not used in valuation.',
      count: visualSearch.items.length,
      relevantCount: visualSearch.items.length,
      medianAskingPrice: valuation.currentAskingMarketMid,
      lowAskingPrice: visualSearch.items.length > 0 ? Math.min(...visualSearch.items.map(i => i.price)) : 0,
      highAskingPrice: visualSearch.items.length > 0 ? Math.max(...visualSearch.items.map(i => i.price)) : 0,
    },

    numista: numistaTypeId ? {
      typeId: numistaTypeId, numistaN: `N#${numistaTypeId}`,
      numistaUrl: `https://en.numista.com/catalogue/index.php?r=${numistaTypeId}`,
      matchScore: numistaMatchScore, matchTier: numistaMatchTier,
      accepted: ['verified', 'strong_match'].includes(numistaMatchTier),
    } : null,

    dataSource: {
      findingApiTotal: totalEbaySold,
      primarySearchTotal: totalEbayFound,
      browseApiActive: visualSearch.items.length,
      numistaSalesFound: 0,
      numistaSalesRelevant: 0,
      currencyConversions: [],
      marketplace: EBAY_GLOBAL_ID,
      imageUrlsUsed: imageUrls.length,
      geminiVisionUsed: gemini.available,
      apiConnectionStatus: {
        findingApiReached: soldResults[0]?.error && !soldResults[0]?.rateLimited ? 'error' : 'success',
        findingApiError: soldResults[0]?.error ?? null,
        rateLimited: allRateLimited,
        appTokenObtained: !!appToken,
        marketplaceScoped: EBAY_GLOBAL_ID,
      },
    },

    auditTrail: {
      timestamp: new Date().toISOString(),
      searchQueries, canonicalTitle: title,
      identificationConfidence, identificationTier,
      numistaTypeId: numistaTypeId ?? null, numistaMatchScore, numistaMatchTier,
      condition, specialistId, marketplace: EBAY_GLOBAL_ID,
      imageUrlsAnalysed: imageUrls.length,
      geminiVisionAvailable: gemini.available,
      geminiConfidence: gemini.confidence,
      geminiSearchTerms: gemini.searchTerms,
      ebayFoundTotal: totalEbaySold,
      ebayPrimarySearchTotal: totalEbayFound,
      ebaySoldRelevant: relevantSoldCount,
      ebayRateLimited: allRateLimited,
      visualSearchAvailable: visualSearch.available,
      visualSearchItems: visualSearch.totalFound,
      combinedRelevant: relevantSoldCount,
      combinedMedian: valuation.valuationMid,
      excludedComparables: [],
      topComparables,
      statisticalMethod: relevantSoldCount >= 3 ? 'relevance_filtered_median' : gemini.available ? 'gemini_vision_estimate' : 'insufficient_data',
      valuationConfidence: valuation.valuationConfidence,
      valuationMethod: valuation.valuationMethod,
      valuationWarnings: valuation.valuationWarnings,
    },

    autonomousMode: false, applied,

    // Legacy compatibility
    stats: {
      count: relevantSoldCount,
      low: valuation.valuationLow,
      mid: valuation.valuationMid,
      high: valuation.valuationHigh,
      mean: valuation.valuationMid,
      auctionWinRate: 0,
      medianAuctionPrice: 0,
      medianBinPrice: valuation.valuationMid,
      dataQuality: valuation.valuationConfidence === 'high' ? 'high' : valuation.valuationConfidence === 'medium' ? 'medium' : valuation.valuationConfidence === 'low' ? 'low' : 'insufficient',
      recentSales: topComparables.slice(0, 10).map(c => ({
        title: c.title, price: c.price, currency: 'GBP',
        listingType: c.listingType, condition: '', url: c.url,
        sellSummary: 'Sold' as const, endDate: c.date,
      })),
    },
    recommendation: {
      recommendedFormat: valuation.recommendedListingFormat,
      recommendedPrice: valuation.recommendedListingPrice,
      auctionStartPrice: valuation.auctionStartPrice,
      confidenceScore: valuation.valuationConfidence === 'high' ? 0.82 : valuation.valuationConfidence === 'medium' ? 0.65 : valuation.valuationConfidence === 'low' ? 0.40 : valuation.valuationConfidence === 'very_low' ? 0.25 : 0.1,
      quickSaleRatio: 0.95,
      reasoning: valuation.listingPriceRationale,
      keyFactors: [
        relevantSoldCount > 0 ? `${relevantSoldCount} relevant sold comparables (EBAY_GB)` : null,
        gemini.available ? `AI market estimate: £${gemini.estimatedMid} (${gemini.confidence} confidence)` : null,
        visualSearch.available ? `${visualSearch.items.length} visually similar active listings found` : null,
        valuation.valuationMid > 0 ? `Range £${valuation.valuationLow}–£${valuation.valuationHigh}` : 'Insufficient data',
        ...valuation.valuationWarnings.slice(0, 2),
      ].filter(Boolean),
      warningFlags: valuation.valuationWarnings,
    },
  });
});
