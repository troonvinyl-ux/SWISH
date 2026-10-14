// SWISH Market Value & Pricing Intelligence Edge Function v4
//
// v4 FIXES (2026-10-14):
//   1. isCoinSpecialist() — removed curiosities_collectibles (not a coin), added islamic_silver,
//      ancient_artefacts, banknotes, gold, silver — all precious-metal/numismatic specialists
//   2. searchVerifiedSoldListings() — added globalId=EBAY_GB parameter so searches run on
//      eBay UK, not eBay US (was the primary cause of zero results for UK sellers)
//   3. searchActivePrices() — already had EBAY_GB header; confirmed correct
//   4. buildSearchQueries() — Islamic silver now gets coin-specific query building:
//      dynasty/ruler/denomination/date attributes used for structured queries
//   5. scoreComparableRelevance() — Islamic silver uses denomination-tolerant matching:
//      "tanker" as a denomination type matches eBay titles containing coin type keywords
//      rather than requiring exact denomination string match (Islamic denominations vary greatly)
//   6. Added pagination support: fetchPage parameter allows retrieving pages 2+ for richer data
//   7. Improved excluded-sale logging: logs why each sale was excluded to aid debugging
//   8. Added raw eBay response logging when totalFound > 0 but relevantCount = 0
//
// INVARIANTS (unchanged):
//   - Active asking prices never used as sold evidence
//   - Numista specs (reference_data) never used as market prices
//   - Identification and valuation confidence remain independent
//   - Credentials never logged or exposed in responses

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const EBAY_FINDING_API = 'https://svcs.ebay.com/services/search/FindingService/v1';
const EBAY_TOKEN_URL   = 'https://api.ebay.com/identity/v1/oauth2/token';
const NUMISTA_API      = 'https://api.numista.com/api/v3';

// eBay UK Global ID — required for UK marketplace searches
// Without this, the Finding API defaults to EBAY_US
const EBAY_GLOBAL_ID = 'EBAY_GB';

function adminClient() {
  return createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

// ── Specialist category detectors ─────────────────────────────────────────────
// FIX v4: removed curiosities_collectibles (generic, not a coin specialist)
//         added islamic_silver, ancient_artefacts, banknotes, gold, silver
function isCoinSpecialist(specialistId: string): boolean {
  const COIN_SPECIALISTS = new Set([
    'coins', 'coins_uk', 'coins_world', 'coins_ancient', 'coins_islamic',
    'islamic_silver', 'ancient_artefacts', 'banknotes', 'gold', 'silver',
    'numismatics',
  ]);
  return COIN_SPECIALISTS.has(specialistId) ||
    specialistId?.includes('coin') ||
    specialistId?.includes('numismatic');
}

// Islamic silver is a sub-category of coins — has specific search and scoring needs
function isIslamicCoinSpecialist(specialistId: string): boolean {
  return specialistId === 'islamic_silver' || specialistId === 'coins_islamic';
}

function isMXSpecialist(specialistId: string): boolean {
  return specialistId === 'motocross';
}

function isClothingSpecialist(specialistId: string): boolean {
  return specialistId === 'clothing' || specialistId === 'trainers_sneakers';
}

// ── Auth / tenant verification ────────────────────────────────────────────────
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
    if (!resp.ok) {
      console.log(`[SWISH Market v4] App token failed: HTTP ${resp.status}`);
      return null;
    }
    const data = await resp.json();
    if (!data.access_token) {
      console.log(`[SWISH Market v4] App token response missing access_token: ${data.error ?? data.error_description ?? 'unknown'}`);
      return null;
    }
    console.log(`[SWISH Market v4] App token obtained successfully`);
    return data.access_token;
  } catch (e: any) {
    console.log(`[SWISH Market v4] App token exception: ${e.message}`);
    return null;
  }
}

async function getConnectorCredentials(supabase: ReturnType<typeof adminClient>, tenantId: string) {
  const { data: conn } = await supabase.from('marketplace_connectors').select('credential_ref, status').eq('tenant_id', tenantId).eq('marketplace_id', 'ebay').maybeSingle();
  if (!conn?.credential_ref) return null;
  try { const { decryptCredentials } = await import('../_shared/credentialCrypto.ts'); return await decryptCredentials(conn.credential_ref); }
  catch { return null; }
}

// ── Currency conversion (approximate) ────────────────────────────────────────
function toGBP(price: number, currency: string): number {
  switch (currency.toUpperCase()) {
    case 'GBP': return price;
    case 'USD': return price * 0.79;
    case 'EUR': return price * 0.85;
    case 'AUD': return price * 0.51;
    case 'CAD': return price * 0.58;
    case 'JPY': return price * 0.0053;
    case 'CHF': return price * 0.89;
    case 'SEK': return price * 0.072;
    case 'DKK': return price * 0.114;
    default: return price; // unknown — treat as GBP
  }
}

// ── Comparable item type ──────────────────────────────────────────────────────
interface ComparableItem {
  title: string;
  price: number;
  currency: string;
  originalPrice?: number;
  listingType: 'Auction' | 'FixedPrice';
  saleStatus: 'sold' | 'active' | 'unsold' | 'unknown';
  endDate: string;
  condition: string;
  url: string;
  bids?: number;
  source: 'numista' | 'ebay' | 'unknown';
  numistaTypeId?: number;
  relevanceScore: number;
  relevanceFactors: string[];
  exclusionReason?: string;
}

// ── Title sanitiser ───────────────────────────────────────────────────────────
function sanitiseTitleForSearch(raw: string): string {
  return raw
    .replace(/[£\$€]\s*\d+(?:[.,]\d+)?/g, ' ')
    .replace(/\b(spares?\s*\/\s*repairs?|for parts?|not working|project bike?|parts only|see desc(?:ription)?|read desc(?:ription)?|fast delivery|free postage|inc(?:luding)?\s+p&p|\+p&p|collection only|buyer collects?)\b/gi, ' ')
    .replace(/[–—]/g, ' ')
    .replace(/[|#+](?=\s|$)/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ── Search query builder ──────────────────────────────────────────────────────
function buildSearchQueries(title: string, attributes: Record<string, any>, specialistId: string, numistaTitle?: string): string[] {
  const queries: string[] = [];
  const sanitised = sanitiseTitleForSearch(title);
  const cleanTitle = sanitised
    .replace(/^(vintage|antique|old|rare|beautiful|stunning|amazing|lovely|nice|ex|extraordinary)\s+/gi, '')
    .replace(/\s+/g, ' ').trim().slice(0, 100);

  if (cleanTitle.length >= 5) queries.push(cleanTitle);

  // ── MX / Motocross ────────────────────────────────────────────────────────
  if (isMXSpecialist(specialistId)) {
    const make = String(attributes?.manufacturer ?? attributes?.brand ?? attributes?.make ?? '').trim();
    const model = String(attributes?.model ?? attributes?.model_family ?? attributes?.model_name ?? '').trim();
    const yearRange = String(attributes?.year_range ?? attributes?.model_year ?? attributes?.year ?? '').trim();
    const engine = String(attributes?.engine_size ?? attributes?.displacement ?? '').trim();
    const stroke = String(attributes?.stroke_type ?? '').trim();
    const bikeType = String(attributes?.bike_type ?? attributes?.vehicle_type ?? '').trim();

    const startYear = yearRange ? yearRange.split('-')[0].trim() : '';
    const engineCC = engine ? engine.replace(/[^0-9]/g, '') + 'cc' : '';
    const strokeLabel = stroke.includes('2') ? '2 stroke' : stroke.includes('4') ? '4 stroke' : '';

    const primaryParts = [make, model, startYear, engineCC].filter(Boolean);
    if (primaryParts.length >= 2) queries.push(primaryParts.join(' ').slice(0, 100));

    const fallback1 = [make, engineCC, strokeLabel, bikeType || 'motocross'].filter(Boolean);
    if (fallback1.length >= 2) queries.push(fallback1.join(' ').slice(0, 100));

    if (make && model) queries.push(`${make} ${model} motocross`.slice(0, 100));
  }

  // ── Bicycles ──────────────────────────────────────────────────────────────
  if (specialistId === 'bicycles' || specialistId === 'cycling') {
    let brand = String(attributes?.manufacturer ?? attributes?.brand ?? '').trim();
    let model = String(attributes?.model ?? attributes?.model_name ?? '').trim();
    const frameType = String(attributes?.bike_type ?? attributes?.frame_type ?? '').trim();
    const frameSize = String(attributes?.frame_size ?? '').trim();
    const year = String(attributes?.year_range ?? attributes?.year_made ?? '').trim();

    if (!brand) {
      const knownBrands = ['on-one','trek','specialized','scott','giant','cannondale','cube','merida','orbea','bianchi','santa cruz','yeti','commencal','whyte','nukeproof','norco','marin','transition','kona','genesis','boardman','voodoo','carrera','raleigh','pinarello','cervelo','fuji','ghost','lapierre','ribble','vitus','colnago','canyon','focus','calibre','kinesis','cotic','singular','orange','ragley','salsa','surly','all-city','bombtrack','haibike','felt','diamondback'];
      const sanitisedLower = sanitised.toLowerCase();
      for (const kb of knownBrands) {
        if (sanitisedLower.startsWith(kb) || sanitisedLower.includes(' ' + kb + ' ') || sanitisedLower.startsWith(kb + ' ')) {
          const idx = sanitisedLower.indexOf(kb);
          brand = sanitised.slice(idx, idx + kb.length);
          break;
        }
      }
    }

    if (brand && !model) {
      const brandIdx = sanitised.toLowerCase().indexOf(brand.toLowerCase());
      if (brandIdx !== -1) {
        const afterBrand = sanitised.slice(brandIdx + brand.length).trim();
        const noiseWords = new Set(['carbon','aluminium','aluminum','steel','titanium','frame','hardtail','full','suspension','mtb','road','bike','bicycle','mountain','racing','gravel','cyclocross','enduro','downhill']);
        const modelWords = afterBrand.split(/\s+/).filter(w => w.length >= 2 && !noiseWords.has(w.toLowerCase())).slice(0, 2);
        if (modelWords.length > 0) model = modelWords.join(' ');
      }
    }

    const primaryParts = [brand, model, year ? year.split('-')[0] : ''].filter(Boolean);
    if (primaryParts.length >= 2) queries.push(primaryParts.join(' ').slice(0, 100));

    const frameKeyword = frameType || (sanitised.toLowerCase().includes('hardtail') ? 'hardtail mountain bike' : sanitised.toLowerCase().includes('full suspension') ? 'full suspension mountain bike' : 'mountain bike');
    if (brand) {
      const fb1 = [brand, frameKeyword, frameSize].filter(Boolean).join(' ').slice(0, 100);
      if (!queries.includes(fb1)) queries.push(fb1);
    }

    if (brand && model) {
      const fb2 = `${brand} ${model}`.slice(0, 80);
      if (!queries.includes(fb2)) queries.push(fb2);
    }

    if (brand) queries.push(`${brand} frame`.slice(0, 60));
  }

  // ── Clothing ──────────────────────────────────────────────────────────────
  if (isClothingSpecialist(specialistId)) {
    const brand = String(attributes?.brand ?? attributes?.Brand ?? attributes?.manufacturer ?? '').trim();
    const garmentType = String(attributes?.garment_type ?? attributes?.item_type ?? '').trim();
    const era = String(attributes?.era ?? attributes?.era_estimate ?? '').trim();
    const size = String(attributes?.size ?? attributes?.labelled_size ?? '').trim();
    const composition = String(attributes?.composition ?? attributes?.material ?? '').trim();

    if (brand && garmentType) {
      const clothingQuery = [brand, garmentType, era].filter(Boolean).join(' ').slice(0, 100);
      if (clothingQuery !== cleanTitle) queries.push(clothingQuery);
    }
    if (brand && garmentType && size) {
      queries.push([brand, garmentType, size].join(' ').slice(0, 100));
    }
    if (brand && garmentType) {
      const broad = `vintage ${brand} ${garmentType}`.slice(0, 100);
      if (!queries.includes(broad)) queries.push(broad);
    }
    if (brand && composition && composition.toLowerCase().includes('silk')) {
      queries.push(`${brand} vintage clothing`.slice(0, 100));
    }
  }

  // ── Coins (including Islamic silver, ancient artefacts, etc.) ────────────
  if (isCoinSpecialist(specialistId)) {
    // For Islamic coins: use dynasty/dynasty_period, ruler, denomination, AH date
    if (isIslamicCoinSpecialist(specialistId)) {
      const dynasty = String(attributes?.dynasty ?? attributes?.period ?? attributes?.empire ?? '').trim();
      const ruler = String(attributes?.ruler ?? attributes?.caliph ?? attributes?.sultan ?? '').trim();
      const denomination = String(attributes?.denomination ?? attributes?.coin_type ?? '').trim();
      const mint = String(attributes?.mint ?? attributes?.mint_city ?? '').trim();
      const ahDate = String(attributes?.ah_date ?? attributes?.year_made ?? attributes?.date ?? '').trim();

      // Primary: dynasty + ruler + denomination
      const islamicPrimary = [dynasty, ruler, denomination].filter(Boolean);
      if (islamicPrimary.length >= 2) {
        queries.push(islamicPrimary.join(' ').slice(0, 100));
      }

      // Fallback 1: denomination + mint (common Islamic search pattern)
      if (denomination && mint) {
        queries.push(`${denomination} ${mint} Islamic silver coin`.slice(0, 100));
      }

      // Fallback 2: dynasty + denomination (broad)
      if (dynasty && denomination) {
        queries.push(`${dynasty} ${denomination} silver`.slice(0, 100));
      }

      // Fallback 3: denomination only + Islamic silver (for "tanker" or "dirham" etc.)
      if (denomination) {
        queries.push(`${denomination} Islamic silver coin`.slice(0, 100));
      }
    } else {
      // Standard coin query: ruler + denomination + year + catalogue number
      const parts: string[] = [];
      if (attributes?.ruler) parts.push(String(attributes.ruler));
      if (attributes?.denomination) parts.push(String(attributes.denomination));
      const yr = attributes?.year_made ?? attributes?.yearMade;
      if (yr) parts.push(String(yr));
      if (parts.length >= 2) queries.push(parts.join(' ').slice(0, 100));

      if (numistaTitle && numistaTitle.length > 5 && numistaTitle !== cleanTitle) {
        queries.push(numistaTitle.slice(0, 80));
      }

      const catNum = attributes?.catalogue_number ?? attributes?.catalogueNumber;
      if (catNum) queries.push(String(catNum).slice(0, 50));
    }
  }

  return queries.filter((q, i, a) => q.length >= 3 && a.indexOf(q) === i).slice(0, 5);
}

// ═══════════════════════════════════════════════════════════════════════════════
// NUMISTA SALES RECORDS
// ═══════════════════════════════════════════════════════════════════════════════

interface NumistaSaleRecord {
  price: number;
  currency: string;
  originalPrice: number;
  date: string;
  condition: string;
  grade: string;
  marketplace: string;
  url: string;
  description: string;
}

interface NumistaSalesData {
  typeId: number;
  numistaTitle: string;
  numistaN: string;
  numistaUrl: string;
  sales: NumistaSaleRecord[];
  totalFetched: number;
  relevantCount: number;
  median: number;
  low: number;
  high: number;
  currencyConversions: string[];
  error?: string;
}

async function fetchNumistaSalesRecords(
  typeId: number, condition: string, attributes: Record<string, any>,
): Promise<NumistaSalesData | null> {
  const apiKey = Deno.env.get('NUMISTA_API_KEY') ?? '';
  if (!apiKey) return null;

  const noResult: NumistaSalesData = {
    typeId, numistaTitle: '', numistaN: `N#${typeId}`,
    numistaUrl: `https://en.numista.com/catalogue/index.php?r=${typeId}`,
    sales: [], totalFetched: 0, relevantCount: 0,
    median: 0, low: 0, high: 0, currencyConversions: [],
  };

  try {
    let typeTitle = '';
    try {
      const typeResp = await fetch(`${NUMISTA_API}/types/${typeId}`, {
        headers: { 'Numista-API-Key': apiKey }, signal: AbortSignal.timeout(6000),
      });
      if (typeResp.ok) {
        const typeData = await typeResp.json();
        typeTitle = typeData.title ?? '';
      }
    } catch { /* non-blocking */ }

    const salesResp = await fetch(`${NUMISTA_API}/types/${typeId}/sales_records?count=50`, {
      headers: { 'Numista-API-Key': apiKey }, signal: AbortSignal.timeout(10000),
    });

    if (!salesResp.ok) {
      if (salesResp.status === 402 || salesResp.status === 403) {
        console.log(`[SWISH Market v4] Numista sales require paid plan (${salesResp.status})`);
        return { ...noResult, numistaTitle: typeTitle, error: `Sales records require Numista paid API plan (${salesResp.status})` };
      }
      return { ...noResult, numistaTitle: typeTitle, error: `Numista sales API returned ${salesResp.status}` };
    }

    const salesData = await salesResp.json();
    const rawSales = salesData.sales ?? salesData.results ?? salesData.items ?? [];

    if (!Array.isArray(rawSales) || rawSales.length === 0) {
      return { ...noResult, numistaTitle: typeTitle };
    }

    const sales: NumistaSaleRecord[] = [];
    const conversions: Set<string> = new Set();

    for (const raw of rawSales) {
      try {
        const rawPrice = parseFloat(raw.price ?? raw.amount ?? '0');
        if (rawPrice <= 0) continue;
        const currency = (raw.currency ?? 'EUR').toUpperCase();
        const gbpPrice = toGBP(rawPrice, currency);
        if (gbpPrice <= 0) continue;
        if (currency !== 'GBP') conversions.add(currency);
        sales.push({
          price: Math.round(gbpPrice * 100) / 100,
          currency, originalPrice: rawPrice,
          date: raw.date ?? raw.sold_date ?? raw.auction_date ?? '',
          condition: raw.condition ?? raw.quality ?? '',
          grade: raw.grade ?? raw.condition_grade ?? '',
          marketplace: raw.marketplace ?? raw.source ?? raw.auction_house ?? 'Numista',
          url: raw.url ?? raw.link ?? '',
          description: raw.description ?? raw.title ?? '',
        });
      } catch { /* skip malformed */ }
    }

    const conditionLower = condition.toLowerCase();
    const isDamaged = conditionLower.includes('damage') || conditionLower.includes('hole') ||
      conditionLower.includes('clean') || conditionLower.includes('poor') || conditionLower.includes('fair');

    const relevantSales = sales.filter(s => {
      if (!isDamaged) return true;
      const saleCondLower = (s.condition + s.grade).toLowerCase();
      return !(saleCondLower.includes('ms') || saleCondLower.includes('unc') ||
        saleCondLower.includes('pf') || saleCondLower.includes('gem'));
    });

    const prices = relevantSales.map(s => s.price).sort((a, b) => a - b);
    const n = prices.length;
    const median = prices[Math.floor(n / 2)] ?? 0;
    const low = prices[Math.floor(n * 0.15)] ?? prices[0] ?? 0;
    const high = prices[Math.floor(n * 0.85)] ?? prices[n - 1] ?? 0;

    console.log(`[SWISH Market v4] Numista N#${typeId}: ${rawSales.length} sales, ${relevantSales.length} relevant, median=£${median}`);

    return {
      typeId, numistaTitle: typeTitle, numistaN: `N#${typeId}`,
      numistaUrl: `https://en.numista.com/catalogue/index.php?r=${typeId}`,
      sales: relevantSales.slice(0, 30),
      totalFetched: rawSales.length, relevantCount: relevantSales.length,
      median: Math.round(median * 100) / 100,
      low: Math.round(low * 100) / 100,
      high: Math.round(high * 100) / 100,
      currencyConversions: [...conversions],
    };
  } catch (e: any) {
    return { ...noResult, error: `Numista sales error: ${e.message}` };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// eBay FINDING API — VERIFIED SOLD ONLY (EBAY UK)
// ═══════════════════════════════════════════════════════════════════════════════
//
// FIX v4: Added 'GLOBAL-ID': 'EBAY_GB' to scope searches to eBay UK.
// Previously this parameter was absent, causing the API to default to EBAY_US.
// eBay UK has a much larger inventory of British, Islamic, and European coins.
//
// NOTE ON SELLER HUB PRODUCT RESEARCH:
//   eBay Seller Hub Product Research is a private eBay feature NOT accessible
//   via the public Finding API. It shows longer historical sold data (up to 90 days)
//   via an authenticated session. This is NOT available through any public API.
//
//   The Finding API (findCompletedItems + SoldItemsOnly=true) is the authorised
//   public equivalent — it returns up to 50 items per page of recently sold listings.
//   This is what SWISH uses. The data is real eBay sold transactions, not estimates.
//
// NOTE ON SOLD PRICES vs BEST OFFER:
//   findCompletedItems returns the final sold price for FixedPrice and Auction items.
//   For Best Offer listings, the returned price is the ACCEPTED offer amount when
//   the item sold with 'EndedWithSales' state — this IS the actual transacted price.
//   We DO NOT infer Best Offer amounts from asking prices.

async function searchVerifiedSoldListings(
  clientId: string, query: string, maxResults = 50, pageNumber = 1,
): Promise<{ listings: ComparableItem[]; error?: string; totalFound: number; rawResponse?: any }> {
  const params = new URLSearchParams({
    'OPERATION-NAME': 'findCompletedItems',
    'SERVICE-VERSION': '1.13.0',
    'SECURITY-APPNAME': clientId,
    'RESPONSE-DATA-FORMAT': 'JSON',
    'REST-PAYLOAD': '',
    'GLOBAL-ID': EBAY_GLOBAL_ID,                    // FIX v4: scope to eBay UK
    'keywords': query,
    'sortOrder': 'EndTimeSoonest',
    'paginationInput.entriesPerPage': String(Math.min(maxResults, 100)),
    'paginationInput.pageNumber': String(pageNumber),
    'itemFilter(0).name': 'SoldItemsOnly',
    'itemFilter(0).value': 'true',
    'outputSelector(0)': 'SellerInfo',
  });

  const url = `${EBAY_FINDING_API}?${params.toString()}`;
  console.log(`[SWISH Market v4] eBay Finding API call: "${query}" page=${pageNumber} marketplace=${EBAY_GLOBAL_ID}`);

  try {
    const resp = await fetch(url, {
      headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(15000),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.log(`[SWISH Market v4] Finding API HTTP ${resp.status}: ${errText.slice(0, 300)}`);
      return { listings: [], error: `eBay Finding API ${resp.status}: ${errText.slice(0, 100)}`, totalFound: 0 };
    }

    const data = await resp.json();
    const searchResult = data?.findCompletedItemsResponse?.[0];

    if (!searchResult) {
      console.log(`[SWISH Market v4] Finding API: no findCompletedItemsResponse in response`);
      return { listings: [], error: 'eBay Finding API: empty response structure', totalFound: 0 };
    }

    const ack = searchResult.ack?.[0];
    if (ack !== 'Success' && ack !== 'Warning') {
      const errMsg = searchResult.errorMessage?.[0]?.error?.[0]?.message?.[0] ?? 'Unknown API error';
      console.log(`[SWISH Market v4] Finding API ack=${ack}: ${errMsg}`);
      return { listings: [], error: `eBay Finding API: ${errMsg}`, totalFound: 0 };
    }

    const totalFound = parseInt(searchResult.paginationOutput?.[0]?.totalEntries?.[0] ?? '0') || 0;
    const rawItems = searchResult.searchResult?.[0]?.item ?? [];

    console.log(`[SWISH Market v4] Found ${totalFound} total sold listings for "${query}", fetched ${rawItems.length} on page ${pageNumber}`);

    // Log raw titles for first page to help diagnose relevance issues
    if (pageNumber === 1 && rawItems.length > 0) {
      const sampleTitles = rawItems.slice(0, 5).map((i: any) => i.title?.[0] ?? '').join(' | ');
      console.log(`[SWISH Market v4] Sample titles: ${sampleTitles.slice(0, 300)}`);
    }

    const listings: ComparableItem[] = [];
    let soldCount = 0;
    let unsoldCount = 0;

    for (const item of rawItems) {
      try {
        const sellingStatus = item.sellingStatus?.[0] ?? {};
        const listingInfo = item.listingInfo?.[0] ?? {};
        const conditionInfo = item.condition?.[0] ?? {};
        const sellingState = sellingStatus.sellingState?.[0] ?? '';

        // CRITICAL: Only EndedWithSales means the item actually sold
        if (sellingState !== 'EndedWithSales') {
          unsoldCount++;
          continue;
        }
        soldCount++;

        const price = parseFloat(
          sellingStatus.convertedCurrentPrice?.[0]?.['__value__'] ??
          sellingStatus.currentPrice?.[0]?.['__value__'] ?? '0'
        );
        if (price <= 0) continue;

        const currency = sellingStatus.convertedCurrentPrice?.[0]?.['@currencyId'] ??
          sellingStatus.currentPrice?.[0]?.['@currencyId'] ?? 'GBP';
        const gbpPrice = toGBP(price, currency);
        const listingType = (listingInfo.listingType?.[0] ?? 'FixedPrice').includes('Auction') ? 'Auction' : 'FixedPrice';

        listings.push({
          title: item.title?.[0] ?? '',
          price: Math.round(gbpPrice * 100) / 100,
          originalPrice: currency !== 'GBP' ? price : undefined,
          currency,
          listingType,
          saleStatus: 'sold',
          endDate: listingInfo.endTime?.[0] ?? '',
          condition: conditionInfo.conditionDisplayName?.[0] ?? '',
          url: item.viewItemURL?.[0] ?? '',
          bids: parseInt(sellingStatus.bidCount?.[0] ?? '0') || 0,
          source: 'ebay',
          relevanceScore: 0,
          relevanceFactors: [],
        });
      } catch { /* skip malformed */ }
    }

    console.log(`[SWISH Market v4] Parsed: ${soldCount} sold, ${unsoldCount} unsold/completed-without-sale`);

    return { listings, error: undefined, totalFound, rawResponse: { ack, totalFound, rawItemCount: rawItems.length } };
  } catch (e: any) {
    console.log(`[SWISH Market v4] Finding API exception: ${e.message}`);
    return { listings: [], error: `Finding API error: ${e.message}`, totalFound: 0 };
  }
}

// ── eBay Browse API — ACTIVE ASKING PRICES ONLY ───────────────────────────────
async function searchActivePrices(accessToken: string, query: string): Promise<ComparableItem[]> {
  if (!accessToken) return [];
  try {
    const resp = await fetch(
      `https://api.ebay.com/buy/browse/v1/item_summary/search?` +
      new URLSearchParams({ q: query.slice(0, 100), limit: '20', filter: 'buyingOptions:{FIXED_PRICE}', sort: 'price' }).toString(),
      { headers: { Authorization: `Bearer ${accessToken}`, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB', 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(10000) },
    );
    if (!resp.ok) {
      console.log(`[SWISH Market v4] Browse API ${resp.status} for active prices`);
      return [];
    }
    const data = await resp.json();
    const items = data.itemSummaries ?? [];
    return items.map((item: any) => {
      const price = parseFloat(item.price?.value ?? '0');
      if (price <= 0) return null;
      return {
        title: item.title ?? '', price: Math.round(price * 100) / 100,
        currency: item.price?.currency ?? 'GBP', originalPrice: undefined,
        listingType: 'FixedPrice' as const,
        saleStatus: 'active' as const, // ALWAYS active — NEVER "Sold"
        endDate: item.itemEndDate ?? '', condition: item.condition ?? '',
        url: item.itemWebUrl ?? '', bids: 0, source: 'ebay' as const,
        relevanceScore: 0, relevanceFactors: [],
      };
    }).filter(Boolean);
  } catch { return []; }
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMPARABLE RELEVANCE SCORING
// ═══════════════════════════════════════════════════════════════════════════════

const MIN_RELEVANCE = 0.40;

function scoreComparableRelevance(
  comparable: ComparableItem,
  targetTitle: string,
  targetAttrs: Record<string, any>,
  specialistId: string,
  numistaTypeId?: number,
): { score: number; factors: string[]; exclusionReason?: string } {
  const factors: string[] = [];
  let score = 0.45;

  // Numista-sourced sales get automatic pass if type matches
  if (comparable.source === 'numista' && comparable.numistaTypeId === numistaTypeId) {
    score = 0.80;
    factors.push('Numista verified type');
    return { score, factors };
  }

  const compLower = comparable.title.toLowerCase();
  const targetLower = sanitiseTitleForSearch(targetTitle).toLowerCase();
  const targetWords = targetLower.split(/\s+/).filter(w => w.length > 2);
  const matchedWords = targetWords.filter(w => compLower.includes(w));
  const titleOverlap = targetWords.length > 0 ? matchedWords.length / targetWords.length : 0;

  if (titleOverlap >= 0.7) { score += 0.22; factors.push(`High title match (${Math.round(titleOverlap * 100)}%)`); }
  else if (titleOverlap >= 0.5) { score += 0.12; factors.push(`Good title match (${Math.round(titleOverlap * 100)}%)`); }
  else if (titleOverlap >= 0.35) { score += 0.04; factors.push(`Partial title match (${Math.round(titleOverlap * 100)}%)`); }
  else if (titleOverlap < 0.15) { score -= 0.22; factors.push(`Poor title match (${Math.round(titleOverlap * 100)}%)`); }

  // ── Islamic silver coins — FIX v4 ────────────────────────────────────────
  // Islamic coins have highly varied denominations ("tanker", "dirham", "dinar",
  // "fels", "jital", "tanka", etc.) and titles rarely match exactly.
  // We match on dynasty/period keywords and Islamic coin context signals
  // rather than requiring exact denomination string match.
  if (isIslamicCoinSpecialist(specialistId)) {
    const dynasty = String(targetAttrs?.dynasty ?? targetAttrs?.period ?? targetAttrs?.empire ?? '').toLowerCase();
    const ruler = String(targetAttrs?.ruler ?? targetAttrs?.caliph ?? targetAttrs?.sultan ?? '').toLowerCase();
    const denomination = String(targetAttrs?.denomination ?? targetAttrs?.coin_type ?? '').toLowerCase();
    const mint = String(targetAttrs?.mint ?? targetAttrs?.mint_city ?? '').toLowerCase();

    // Islamic coin context keywords in eBay titles
    const islamicKeywords = [
      'islamic', 'arabic', 'arab', 'umayyad', 'abbasid', 'fatimid', 'ayyubid',
      'mamluk', 'ilkhanid', 'safavid', 'mughal', 'ottoman', 'seljuk', 'ghaznavid',
      'samanid', 'buwayhid', 'zengid', 'artukid', 'rasulid', 'dirham', 'dinar',
      'fals', 'fels', 'tanker', 'tanka', 'jital', 'silver coin', 'ar dirham',
      'ar dinar', 'caliphate', 'silver islamic',
    ];
    const hasIslamicSignal = islamicKeywords.some(k => compLower.includes(k));

    if (hasIslamicSignal) {
      score += 0.20;
      factors.push('Islamic coin context signal');
    } else {
      // Non-Islamic coins in coin results — significant penalty
      score -= 0.20;
      factors.push('No Islamic coin signal in title');
    }

    // Dynasty match
    if (dynasty && dynasty.length > 3) {
      const dynastyWords = dynasty.split(/\s+/).filter(w => w.length > 3);
      if (dynastyWords.some(w => compLower.includes(w))) {
        score += 0.15;
        factors.push(`Dynasty match: ${dynasty}`);
      }
    }

    // Ruler match (caliph/sultan name)
    if (ruler && ruler.length > 2) {
      const rulerWords = ruler.split(/\s+/).filter(w => w.length > 3);
      if (rulerWords.some(w => compLower.includes(w))) {
        score += 0.12;
        factors.push(`Ruler match: ${ruler}`);
      }
    }

    // Denomination match — TOLERANT: just check if denomination word appears anywhere
    // Islamic denominations are specific coin type names (tanker, dirham, etc.)
    if (denomination && denomination.length > 2) {
      if (compLower.includes(denomination)) {
        score += 0.15;
        factors.push(`Denomination match: ${denomination}`);
      } else {
        // For Islamic coins, missing denomination is a soft penalty only
        // (many related Islamic coins would still be valid comparables)
        score -= 0.05;
        factors.push(`Denomination not matched (${denomination}) — soft penalty`);
      }
      // NOTE: For Islamic coins we do NOT use the hard exclusion rule
      // (return with exclusionReason) that standard coins use. Islamic coins
      // vary greatly in how denominations appear in eBay titles.
    }

    // Mint match
    if (mint && mint.length > 2 && compLower.includes(mint)) {
      score += 0.10;
      factors.push(`Mint match: ${mint}`);
    }
  } else if (isCoinSpecialist(specialistId)) {
    // Standard coin matching — existing logic
    const denom = String(targetAttrs?.denomination ?? targetAttrs?.Denomination ?? '').toLowerCase();
    if (denom && denom.length > 1) {
      if (compLower.includes(denom)) { score += 0.15; factors.push(`Denomination match: ${denom}`); }
      else {
        // For standard coins, wrong denomination is a hard exclusion
        score -= 0.20;
        return { score, factors, exclusionReason: `Different denomination (target: ${denom})` };
      }
    }

    const ruler = String(targetAttrs?.ruler ?? targetAttrs?.Ruler ?? '').toLowerCase();
    if (ruler && ruler.length > 2) {
      const rulerLast = ruler.split(' ').pop() ?? ruler;
      if (compLower.includes(rulerLast)) { score += 0.15; factors.push(`Ruler match: ${ruler}`); }
      else { score -= 0.10; factors.push(`Ruler mismatch: target=${ruler}`); }

      const knownRulers = ['victoria', 'george', 'edward', 'elizabeth', 'william', 'henry', 'richard', 'augustus', 'tiberius', 'nero', 'claudius', 'vespasian', 'hadrian', 'constantine'];
      for (const kr of knownRulers) {
        if (!ruler.includes(kr) && compLower.includes(kr)) { score -= 0.15; factors.push(`Different ruler: ${kr}`); break; }
      }
    }

    const year = String(targetAttrs?.year_made ?? targetAttrs?.yearMade ?? '');
    if (year && year.length >= 4 && compLower.includes(year)) { score += 0.10; factors.push(`Year match: ${year}`); }
  }

  if (isMXSpecialist(specialistId)) {
    const make = String(targetAttrs?.manufacturer ?? targetAttrs?.brand ?? targetAttrs?.make ?? '').toLowerCase();
    const model = String(targetAttrs?.model ?? targetAttrs?.model_family ?? '').toLowerCase();
    const engine = String(targetAttrs?.engine_size ?? targetAttrs?.displacement ?? '').toLowerCase();
    const stroke = String(targetAttrs?.stroke_type ?? '').toLowerCase();
    const year = String(targetAttrs?.year_range ?? targetAttrs?.year ?? '').toLowerCase();

    if (make && compLower.includes(make)) { score += 0.18; factors.push(`Make match: ${make}`); }
    else if (make) { score -= 0.15; factors.push(`Make mismatch (target: ${make})`); }

    if (model && model.length > 2 && compLower.includes(model.split(' ')[0])) { score += 0.15; factors.push(`Model match: ${model}`); }

    const engineCC = engine.replace(/[^0-9]/g, '');
    if (engineCC && compLower.includes(engineCC)) { score += 0.12; factors.push(`Engine match: ${engineCC}cc`); }
    else if (engineCC) {
      const targetCC = parseInt(engineCC);
      const compNumbers = compLower.match(/\d{2,4}(?:cc)?/g);
      const hasNearCC = compNumbers?.some(n => { const nn = parseInt(n); return Math.abs(nn - targetCC) <= 25; });
      if (!hasNearCC) { score -= 0.08; factors.push('Engine size mismatch'); }
    }

    if (stroke && stroke !== 'unknown') {
      const strokeDigit = stroke.includes('2') ? '2' : stroke.includes('4') ? '4' : '';
      if (strokeDigit && (compLower.includes(strokeDigit + '-stroke') || compLower.includes(strokeDigit + ' stroke'))) {
        score += 0.06; factors.push(`Stroke match: ${stroke}`);
      }
    }

    const startYear = year ? year.split('-')[0].trim() : '';
    if (startYear && startYear.length === 4 && compLower.includes(startYear)) { score += 0.08; factors.push(`Year match: ${startYear}`); }

    const mxKeywords = ['motocross', 'mx', 'enduro', 'supermoto', 'dirt bike', 'trail bike', 'off road'];
    const hasMXKeyword = mxKeywords.some(k => compLower.includes(k));
    if (!hasMXKeyword && !make) { score -= 0.12; factors.push('No MX category signals'); }
  }

  if (specialistId === 'bicycles' || specialistId === 'cycling') {
    const brand = String(targetAttrs?.manufacturer ?? targetAttrs?.brand ?? '').toLowerCase();
    const model = String(targetAttrs?.model ?? targetAttrs?.model_name ?? '').toLowerCase();
    const frameType = String(targetAttrs?.bike_type ?? targetAttrs?.frame_type ?? '').toLowerCase();
    const frameSize = String(targetAttrs?.frame_size ?? '').toLowerCase();
    const year = String(targetAttrs?.year_range ?? targetAttrs?.year_made ?? '').toLowerCase();

    if (brand && compLower.includes(brand)) { score += 0.18; factors.push(`Brand match: ${brand}`); }
    else if (brand) { score -= 0.12; factors.push(`Brand mismatch (target: ${brand})`); }

    if (model && model.length > 2 && compLower.includes(model.split(' ')[0])) { score += 0.15; factors.push(`Model match: ${model}`); }

    if (frameType && frameType.length > 3) {
      const ftWords = frameType.split(/\s+/);
      if (ftWords.some(w => w.length > 3 && compLower.includes(w))) { score += 0.08; factors.push(`Frame type match: ${frameType}`); }
    }

    if (frameSize && compLower.includes(frameSize.toLowerCase())) { score += 0.06; factors.push(`Frame size match: ${frameSize}`); }

    const startYear = year ? year.split('-')[0].trim() : '';
    if (startYear && startYear.length === 4 && compLower.includes(startYear)) { score += 0.06; factors.push(`Year match: ${startYear}`); }

    const bikeKeywords = ['mountain bike', 'road bike', 'mtb', 'gravel', 'enduro', 'downhill', 'hardtail', 'full suspension', 'bmx', 'hybrid'];
    if (bikeKeywords.some(k => compLower.includes(k))) { score += 0.05; factors.push('Bike category keyword'); }
  }

  if (isClothingSpecialist(specialistId)) {
    const brand = String(targetAttrs?.brand ?? targetAttrs?.Brand ?? targetAttrs?.manufacturer ?? '').toLowerCase();
    const garmentType = String(targetAttrs?.garment_type ?? targetAttrs?.item_type ?? '').toLowerCase();
    const era = String(targetAttrs?.era ?? targetAttrs?.era_estimate ?? '').toLowerCase();
    const size = String(targetAttrs?.size ?? targetAttrs?.labelled_size ?? '').toLowerCase();

    if (brand && compLower.includes(brand)) { score += 0.20; factors.push(`Brand match: ${brand}`); }
    else if (brand) { score -= 0.15; factors.push(`Brand mismatch (target: ${brand})`); }

    if (garmentType && garmentType.length > 2) {
      const gtWords = garmentType.split(/\s+/);
      if (gtWords.some(w => w.length > 3 && compLower.includes(w))) { score += 0.12; factors.push(`Garment type match: ${garmentType}`); }
    }

    const eraKeywords = era ? era.split(/[\s,]+/).filter(w => w.length >= 4) : [];
    if (eraKeywords.some(k => compLower.includes(k))) { score += 0.08; factors.push(`Era match: ${era}`); }
    if (size && size.length >= 1 && compLower.includes(size)) { score += 0.05; factors.push(`Size match: ${size}`); }

    if (compLower.includes('vintage') || compLower.includes('deadstock') || compLower.includes('distressed')) {
      score += 0.04; factors.push('Vintage/deadstock signal');
    }
  }

  if (comparable.price > 2000) { score -= 0.08; factors.push('Unusually high-value item'); }
  if (comparable.saleStatus === 'active') { score -= 0.30; factors.push('Asking price — not a verified sale'); }

  return { score: Math.max(0, Math.min(1, score)), factors };
}

// ═══════════════════════════════════════════════════════════════════════════════
// VALUATION STATISTICS
// ═══════════════════════════════════════════════════════════════════════════════

interface SourceStats {
  count: number;
  relevantCount: number;
  median: number;
  low: number;
  high: number;
  weightedMedian: number;
  auctionShare: number;
  auctionMedian: number;
  binMedian: number;
  dateRangeStart: string;
  dateRangeEnd: string;
  exceptionalSales: ComparableItem[];
  mainPrices: number[];
  excludedReasons: string[];
}

function computeSourceStats(
  items: ComparableItem[],
  title: string,
  attrs: Record<string, any>,
  specialistId: string,
  numistaTypeId?: number,
): SourceStats {
  const empty: SourceStats = {
    count: 0, relevantCount: 0, median: 0, low: 0, high: 0,
    weightedMedian: 0, auctionShare: 0, auctionMedian: 0, binMedian: 0,
    dateRangeStart: '', dateRangeEnd: '', exceptionalSales: [], mainPrices: [], excludedReasons: [],
  };
  if (items.length === 0) return empty;

  const scored = items.map(c => {
    const { score, factors, exclusionReason } = scoreComparableRelevance(c, title, attrs, specialistId, numistaTypeId);
    return { ...c, relevanceScore: score, relevanceFactors: factors, exclusionReason };
  });

  const relevant = scored.filter(c => c.relevanceScore >= MIN_RELEVANCE && !c.exclusionReason);
  const excluded = scored.filter(c => c.relevanceScore < MIN_RELEVANCE || c.exclusionReason);

  // Log exclusion reasons when we have eBay results but nothing is relevant
  if (items.length > 0 && relevant.length === 0) {
    const sampleExclusions = excluded.slice(0, 5).map(c =>
      `"${c.title.slice(0, 50)}" score=${Math.round(c.relevanceScore * 100)}% ${c.exclusionReason ? `excluded: ${c.exclusionReason}` : 'below threshold'}`
    );
    console.log(`[SWISH Market v4] All ${items.length} items excluded from relevance scoring. Samples: ${sampleExclusions.join(' | ')}`);
  }

  if (relevant.length === 0) return {
    ...empty, count: items.length,
    excludedReasons: excluded.slice(0, 10).map(c => c.exclusionReason ?? `Low relevance (${Math.round(c.relevanceScore * 100)}%): ${c.title.slice(0, 40)}`),
  };

  const prices = relevant.map(c => c.price).sort((a, b) => a - b);
  const n = prices.length;

  let mainPrices = prices;
  let exceptional: ComparableItem[] = [];

  if (n >= 4) {
    const q1 = prices[Math.floor(n * 0.25)];
    const q3 = prices[Math.floor(n * 0.75)];
    const iqr = q3 - q1;
    const upperFence = q3 + 2.0 * iqr;
    exceptional = relevant.filter(c => c.price > upperFence);
    mainPrices = prices.filter(p => p <= upperFence);
  }

  const mn = mainPrices.length;
  if (mn === 0) return { ...empty, count: items.length, relevantCount: relevant.length, excludedReasons: [] };

  const median = mainPrices[Math.floor(mn * 0.50)] ?? 0;
  const low = mainPrices[Math.floor(mn * 0.15)] ?? mainPrices[0] ?? 0;
  const high = mainPrices[Math.floor(mn * 0.85)] ?? mainPrices[mn - 1] ?? 0;

  const inMain = relevant.filter(c => mainPrices.includes(c.price)).sort((a, b) => a.price - b.price);
  let weightedMedian = median;
  if (inMain.length > 0) {
    const totalW = inMain.reduce((s, c) => s + c.relevanceScore, 0);
    let cum = 0;
    for (const item of inMain) {
      cum += item.relevanceScore;
      if (cum >= totalW / 2) { weightedMedian = item.price; break; }
    }
  }

  const auctions = relevant.filter(c => c.listingType === 'Auction');
  const bins = relevant.filter(c => c.listingType === 'FixedPrice');
  const aPrices = auctions.map(c => c.price).sort((a, b) => a - b);
  const bPrices = bins.map(c => c.price).sort((a, b) => a - b);
  const auctionMedian = aPrices[Math.floor(aPrices.length / 2)] ?? 0;
  const binMedian = bPrices[Math.floor(bPrices.length / 2)] ?? 0;
  const auctionShare = relevant.length > 0 ? Math.round(auctions.length / relevant.length * 100) : 0;

  const dates = relevant.map(c => c.endDate).filter(Boolean).sort();

  return {
    count: items.length, relevantCount: relevant.length,
    median: Math.round(median * 100) / 100,
    low: Math.round(low * 100) / 100,
    high: Math.round(high * 100) / 100,
    weightedMedian: Math.round(weightedMedian * 100) / 100,
    auctionShare, auctionMedian: Math.round(auctionMedian * 100) / 100,
    binMedian: Math.round(binMedian * 100) / 100,
    dateRangeStart: dates[0] ?? '', dateRangeEnd: dates[dates.length - 1] ?? '',
    exceptionalSales: exceptional.slice(0, 3),
    mainPrices,
    excludedReasons: [],
  };
}

interface CombinedValuationStats {
  numistaStats: SourceStats;
  ebayStats: SourceStats;
  combinedRelevantCount: number;
  combinedMedian: number;
  combinedLow: number;
  combinedHigh: number;
  combinedWeightedMedian: number;
  activeAskingMedian: number;
  activeAskingLow: number;
  activeAskingHigh: number;
  activeAskingCount: number;
  dataQuality: 'strong' | 'moderate' | 'weak' | 'insufficient';
  dataQualityReason: string;
  currencyConversionsUsed: string[];
  topEbaySales: Array<{ title: string; price: number; relevance: number; factors: string[]; date: string; listingType: string }>;
  excludedEbaySales: Array<{ title: string; price: number; reason: string }>;
  exceptionalSalesAll: ComparableItem[];
}

function buildCombinedStats(
  numistaSalesData: NumistaSalesData | null,
  ebaySoldComparables: ComparableItem[],
  activeComparables: ComparableItem[],
  title: string,
  attrs: Record<string, any>,
  specialistId: string,
  numistaTypeId?: number,
): CombinedValuationStats {
  const numistaComparables: ComparableItem[] = (numistaSalesData?.sales ?? []).map(s => ({
    title: `${numistaSalesData?.numistaTitle ?? ''} (${s.grade ?? s.condition ?? ''}) — ${s.marketplace}`.trim(),
    price: s.price, currency: s.currency, originalPrice: s.originalPrice,
    listingType: 'FixedPrice' as const, saleStatus: 'sold' as const,
    endDate: s.date, condition: s.condition, url: s.url,
    source: 'numista' as const, numistaTypeId,
    relevanceScore: 0, relevanceFactors: [],
  }));

  const numistaStats = computeSourceStats(numistaComparables, title, attrs, specialistId, numistaTypeId);
  const ebayStats = computeSourceStats(
    ebaySoldComparables.map(c => ({ ...c, source: 'ebay' as const })),
    title, attrs, specialistId, numistaTypeId,
  );

  const activePrices = activeComparables.map(c => c.price).sort((a, b) => a - b);
  const activeMedian = activePrices[Math.floor(activePrices.length / 2)] ?? 0;
  const activeLow = activePrices[Math.floor(activePrices.length * 0.15)] ?? activePrices[0] ?? 0;
  const activeHigh = activePrices[Math.floor(activePrices.length * 0.85)] ?? activePrices[activePrices.length - 1] ?? 0;

  const allMainPrices = [...numistaStats.mainPrices, ...ebayStats.mainPrices].sort((a, b) => a - b);
  const cn = allMainPrices.length;

  let combinedMedian = 0, combinedLow = 0, combinedHigh = 0, combinedWeightedMedian = 0;
  if (cn > 0) {
    combinedMedian = allMainPrices[Math.floor(cn * 0.50)] ?? 0;
    combinedLow = allMainPrices[Math.floor(cn * 0.15)] ?? allMainPrices[0] ?? 0;
    combinedHigh = allMainPrices[Math.floor(cn * 0.85)] ?? allMainPrices[cn - 1] ?? 0;
    combinedWeightedMedian = combinedMedian;
  }

  const combinedRelevantCount = numistaStats.relevantCount + ebayStats.relevantCount;

  let dataQuality: CombinedValuationStats['dataQuality'] = 'insufficient';
  let dataQualityReason = '';

  const numistaBonus = (numistaSalesData && !numistaSalesData.error && numistaStats.relevantCount >= 3) ? 1 : 0;
  const effectiveCount = cn + (numistaBonus * 3);

  if (effectiveCount >= 13 || (numistaStats.relevantCount >= 5 && ebayStats.relevantCount >= 5)) {
    dataQuality = 'strong';
    dataQualityReason = `${cn} combined relevant sales (${numistaStats.relevantCount} Numista + ${ebayStats.relevantCount} eBay)`;
  } else if (effectiveCount >= 6 || (numistaStats.relevantCount >= 3 && ebayStats.relevantCount >= 3)) {
    dataQuality = 'moderate';
    dataQualityReason = `${cn} combined relevant sales — moderate evidence`;
  } else if (cn >= 3) {
    dataQuality = 'weak';
    dataQualityReason = `Only ${cn} combined relevant sales — treat as indicative`;
  } else if (cn > 0) {
    dataQuality = 'insufficient';
    dataQualityReason = `Only ${cn} combined relevant sale${cn === 1 ? '' : 's'} — too few for reliable valuation`;
  } else {
    dataQuality = 'insufficient';
    dataQualityReason = ebayStats.excludedReasons.length > 0
      ? `No relevant sold data — ${ebayStats.count} found but excluded. Sample: ${ebayStats.excludedReasons[0]}`
      : 'No relevant sold market data found for this item';
  }

  const conversions = [...new Set([
    ...numistaComparables.filter(c => c.currency !== 'GBP').map(c => c.currency),
    ...ebaySoldComparables.filter(c => c.currency !== 'GBP').map(c => c.currency),
  ])];

  const topEbaySales = ebaySoldComparables
    .filter(c => c.relevanceScore >= MIN_RELEVANCE && !c.exclusionReason)
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, 12)
    .map(c => ({ title: c.title.slice(0, 80), price: c.price, relevance: Math.round(c.relevanceScore * 100), factors: c.relevanceFactors, date: c.endDate, listingType: c.listingType }));

  const excludedEbaySales = ebaySoldComparables
    .filter(c => c.relevanceScore < MIN_RELEVANCE || c.exclusionReason)
    .slice(0, 10)
    .map(c => ({ title: c.title.slice(0, 60), price: c.price, reason: c.exclusionReason ?? `Low relevance (${Math.round(c.relevanceScore * 100)}%)` }));

  const exceptionalSalesAll = [...numistaStats.exceptionalSales, ...ebayStats.exceptionalSales].slice(0, 5);

  return {
    numistaStats, ebayStats, combinedRelevantCount,
    combinedMedian, combinedLow, combinedHigh, combinedWeightedMedian,
    activeAskingMedian: Math.round(activeMedian * 100) / 100,
    activeAskingLow: Math.round(activeLow * 100) / 100,
    activeAskingHigh: Math.round(activeHigh * 100) / 100,
    activeAskingCount: activeComparables.length,
    dataQuality, dataQualityReason, currencyConversionsUsed: conversions,
    topEbaySales, excludedEbaySales, exceptionalSalesAll,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// FINAL VALUATION DERIVATION
// ═══════════════════════════════════════════════════════════════════════════════

interface FinalValuation {
  valuationLow: number;
  valuationMid: number;
  valuationHigh: number;
  valuationConfidence: string;
  valuationMethod: string;
  valuationWarnings: string[];
  fairMarketValue: number;
  currentAskingMarketMid: number;
  recommendedListingPrice: number;
  recommendedListingFormat: 'Auction' | 'BuyItNow' | 'BuyItNow_WithBestOffer';
  auctionStartPrice?: number;
  listingPriceRationale: string;
  saleProb30d: number | null;
  saleProbBasis?: string;
}

function deriveValuation(
  combined: CombinedValuationStats,
  identificationConfidence: number,
  identificationTier: string,
  numistaMatchTier: string,
  condition: string,
): FinalValuation {
  const noValue: FinalValuation = {
    valuationLow: 0, valuationMid: 0, valuationHigh: 0,
    valuationConfidence: 'insufficient_data', valuationMethod: 'no_data',
    valuationWarnings: [combined.dataQualityReason],
    fairMarketValue: 0, currentAskingMarketMid: combined.activeAskingMedian,
    recommendedListingPrice: 0, recommendedListingFormat: 'BuyItNow',
    listingPriceRationale: 'Insufficient market data — manual research required',
    saleProb30d: null,
  };

  if (combined.combinedRelevantCount < 3 || combined.combinedMedian <= 0) {
    const insufficientWarnings: string[] = [];
    if (combined.ebayStats.count > 0 && combined.ebayStats.relevantCount === 0) {
      insufficientWarnings.push(
        `${combined.ebayStats.count} eBay sold items found but NONE were relevant after scoring. ` +
        `This may indicate the search returned unrelated coins. ` +
        (combined.ebayStats.excludedReasons.length > 0 ? `Sample exclusion: ${combined.ebayStats.excludedReasons[0]}` : '')
      );
    } else if (combined.ebayStats.count === 0) {
      insufficientWarnings.push('No eBay completed/sold listings found on EBAY_GB. The item may be rare, or the search terms need refinement.');
    } else {
      insufficientWarnings.push(`Only ${combined.combinedRelevantCount} relevant sold comparable${combined.combinedRelevantCount === 1 ? '' : 's'} — minimum 3 required for reliable valuation`);
    }
    return { ...noValue, valuationWarnings: insufficientWarnings };
  }

  const mid = combined.combinedWeightedMedian || combined.combinedMedian;
  const low = combined.combinedLow;
  const high = combined.combinedHigh;
  const warnings: string[] = [];

  const dataQualityScore: Record<string, number> = { strong: 4, moderate: 3, weak: 2, insufficient: 0 };
  const idTierScore: Record<string, number> = { very_high: 4, high: 3, medium: 2, low: 1, very_low: 0, unknown: 0 };
  const numistaTierScore: Record<string, number> = { verified: 4, very_strong: 4, strong: 3, plausible: 2, weak: 1, rejected: 0, no_match: 1, unavailable: 2 };

  const dScore = dataQualityScore[combined.dataQuality] ?? 0;
  const iScore = idTierScore[identificationTier] ?? 1;
  const nScore = numistaTierScore[numistaMatchTier] ?? 1;
  const combinedScore = Math.min(dScore, iScore, nScore);

  const confMap: Record<number, string> = { 4: 'high', 3: 'medium', 2: 'low', 1: 'very_low', 0: 'insufficient_data' };
  const valuationConfidence = confMap[combinedScore] ?? 'insufficient_data';

  if (iScore < dScore) warnings.push(`Confidence limited by identification tier (${identificationTier})`);
  if (nScore < dScore) warnings.push(`Confidence limited by Numista match (${numistaMatchTier})`);

  if (combined.exceptionalSalesAll.length > 0) {
    const maxEx = Math.max(...combined.exceptionalSalesAll.map(s => s.price));
    warnings.push(`${combined.exceptionalSalesAll.length} exceptional sale${combined.exceptionalSalesAll.length > 1 ? 's' : ''} excluded: max £${maxEx}`);
  }
  if (combined.currencyConversionsUsed.length > 0) {
    warnings.push(`Currency conversions applied: ${combined.currencyConversionsUsed.join(', ')} → GBP (approximate)`);
  }
  if (combined.activeAskingMedian > mid * 1.5 && combined.activeAskingCount >= 3) {
    warnings.push(`Active asking prices (median £${combined.activeAskingMedian}) significantly above sold prices — NOT used in valuation`);
  }

  const condLower = condition.toLowerCase();
  if (condLower.includes('damage') || condLower.includes('hole') || condLower.includes('clean') || condLower.includes('bend')) {
    warnings.push('Item condition includes damage/cleaning — value will be below standard examples');
  }

  const activeNote = combined.activeAskingCount > 0
    ? ` (${combined.activeAskingCount} active asking prices at median £${combined.activeAskingMedian} excluded — asking ≠ sold)`
    : '';

  const listingRatio = combined.dataQuality === 'strong' ? 0.92 : combined.dataQuality === 'moderate' ? 0.95 : 1.00;
  const stats = combined.ebayStats;
  const priceSpread = high > 0 ? (high - low) / high : 0;
  const auctionPremium = stats.auctionMedian > 0 && stats.binMedian > 0 ? stats.auctionMedian / stats.binMedian : 1.0;
  const useAuction = stats.auctionShare >= 35 && auctionPremium >= 1.05 && priceSpread >= 0.30 && combined.combinedRelevantCount >= 5;

  let recommendedListingPrice: number;
  let listingPriceRationale: string;
  let auctionStartPrice: number | undefined;
  let format: FinalValuation['recommendedListingFormat'];

  if (useAuction) {
    auctionStartPrice = Math.max(0.99, Math.round(mid * 0.15 * 100) / 100);
    recommendedListingPrice = auctionStartPrice;
    format = 'Auction';
    listingPriceRationale = `Auction recommended: ${stats.auctionShare}% of comparables were auctions. Start at £${auctionStartPrice}.${activeNote}`;
  } else {
    recommendedListingPrice = Math.round(mid * listingRatio * 100) / 100;
    format = mid >= 30 ? 'BuyItNow_WithBestOffer' : 'BuyItNow';
    const sourceNote = combined.numistaStats.relevantCount > 0 && combined.ebayStats.relevantCount > 0
      ? `Based on ${combined.numistaStats.relevantCount} Numista + ${combined.ebayStats.relevantCount} eBay SOLD sales.`
      : combined.numistaStats.relevantCount > 0
        ? `Based on ${combined.numistaStats.relevantCount} Numista SOLD sales.`
        : `Based on ${combined.ebayStats.relevantCount} eBay VERIFIED SOLD sales (EBAY_GB).`;
    listingPriceRationale = `BIN at £${recommendedListingPrice} (${Math.round(listingRatio * 100)}% of sold median £${mid}). ${sourceNote}${activeNote}`;
  }

  let saleProb30d: number | null = null;
  let saleProbBasis: string | undefined;
  const probStats = combined.ebayStats.relevantCount >= combined.numistaStats.relevantCount ? combined.ebayStats : combined.numistaStats;
  if (probStats.relevantCount >= 5 && probStats.dateRangeStart && probStats.dateRangeEnd) {
    try {
      const startMs = new Date(probStats.dateRangeStart).getTime();
      const endMs = new Date(probStats.dateRangeEnd).getTime();
      const rangeDays = Math.max(1, (endMs - startMs) / (1000 * 60 * 60 * 24));
      const salesPerDay = probStats.relevantCount / rangeDays;
      const prob30 = Math.min(0.95, salesPerDay * 30);
      if (prob30 > 0) {
        saleProb30d = Math.round(prob30 * 100) / 100;
        saleProbBasis = `${probStats.relevantCount} sales over ${Math.round(rangeDays)} days`;
      }
    } catch { /* non-blocking */ }
  }

  return {
    valuationLow: Math.round(low * 100) / 100,
    valuationMid: Math.round(mid * 100) / 100,
    valuationHigh: Math.round(high * 100) / 100,
    valuationConfidence, valuationWarnings: warnings,
    valuationMethod: combined.numistaStats.relevantCount > 0
      ? 'numista_and_ebay_sold_combined_relevance_weighted_median'
      : 'ebay_sold_relevance_weighted_median_ebay_gb',
    fairMarketValue: Math.round(mid * 100) / 100,
    currentAskingMarketMid: combined.activeAskingMedian,
    recommendedListingPrice, recommendedListingFormat: format, auctionStartPrice,
    listingPriceRationale, saleProb30d, saleProbBasis,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════════════════════════════════════════

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
  } = body;

  if (!tenantId) return jsonResponse({ error: 'tenantId is required' }, 400);
  if (!title || title.trim().length < 3) return jsonResponse({ error: 'title is required (min 3 chars)' }, 400);

  const supabase = adminClient();
  const authHeader = req.headers.get('Authorization');
  const sec = await verifyTenantAccess(supabase, authHeader, tenantId);
  if (!sec.ok) return jsonResponse({ error: sec.error }, authHeader ? 403 : 401);

  let autonomousMode = false;
  try {
    const { data: biz } = await supabase.from('business_config').select('auto_value, automation_level').eq('tenant_id', tenantId).maybeSingle();
    autonomousMode = biz?.auto_value === true || biz?.automation_level === 'autonomous';
  } catch {}

  const rawCreds = await getConnectorCredentials(supabase, tenantId);
  const clientId = (rawCreds as any)?.clientId ?? '';
  const clientSecret = (rawCreds as any)?.clientSecret ?? '';

  if (!clientId) return jsonResponse({ error: 'eBay is not connected. Connect eBay in Marketplaces to enable market valuation.' }, 400);

  const isCoin = isCoinSpecialist(specialistId);
  const isIslamic = isIslamicCoinSpecialist(specialistId);
  const isMX = isMXSpecialist(specialistId);
  const isClothing = isClothingSpecialist(specialistId);

  console.log(`[SWISH Market v4] Request: title="${title}" specialist=${specialistId} isCoin=${isCoin} isIslamic=${isIslamic}`);

  const mxRunningStatus = isMX ? (attributes?.running_status ?? 'unknown') : null;
  const MX_RUNNING_MULTIPLIERS: Record<string, number> = {
    'Runs and rides (stated)': 1.00, 'Runs & Rides': 1.00, 'Runs (stated)': 0.85, 'Runs': 0.85,
    'Non-running (stated)': 0.55, 'Non-Running': 0.55, 'Project': 0.50,
    'Non-running (visible evidence)': 0.50, 'Unknown from images alone': 0.70, 'Unknown': 0.70,
  };
  const mxRunningMultiplier = mxRunningStatus ? (MX_RUNNING_MULTIPLIERS[mxRunningStatus] ?? 0.70) : 1.0;

  let numistaTitle: string | undefined;
  if (isCoin && attributes?.numista_type_id) {
    numistaTitle = attributes.numista_title ?? undefined;
  }

  const searchQueries = buildSearchQueries(title, attributes, specialistId, numistaTitle);
  console.log(`[SWISH Market v4] Search queries: ${searchQueries.map((q, i) => `[${i + 1}] "${q}"`).join(', ')}`);

  // ── Get app token for Browse API ─────────────────────────────────────────
  const appToken = await getEbayAppToken(clientId, clientSecret);

  // ── Run primary searches in parallel ─────────────────────────────────────
  const [primarySold, activePrices, numistaSalesData] = await Promise.all([
    searchVerifiedSoldListings(clientId, searchQueries[0], 50),
    appToken ? searchActivePrices(appToken, searchQueries[0]) : Promise.resolve([] as ComparableItem[]),
    (isCoin && numistaTypeId && ['verified', 'strong_match'].includes(numistaMatchTier))
      ? fetchNumistaSalesRecords(numistaTypeId, condition, attributes)
      : Promise.resolve(null),
  ]);

  console.log(`[SWISH Market v4] Primary search: ${primarySold.listings.length} sold, ${primarySold.totalFound} total found, error=${primarySold.error ?? 'none'}`);

  // ── Run fallback queries in parallel ─────────────────────────────────────
  let additionalSold: ComparableItem[] = [];
  const needsMore = primarySold.listings.length < 15;
  const fallbackQueries = searchQueries.slice(1);

  if (needsMore && fallbackQueries.length > 0) {
    const fallbackSearches = await Promise.all(
      fallbackQueries.map(q => searchVerifiedSoldListings(clientId, q, 30))
    );
    for (const r of fallbackSearches) {
      console.log(`[SWISH Market v4] Fallback "${r.rawResponse ? '' : ''}": ${r.listings.length} sold, total=${r.totalFound}`);
      additionalSold = [...additionalSold, ...r.listings];
    }
  }

  // For coins: also search with Numista title if available
  if (isCoin && numistaTitle && primarySold.listings.length < 15) {
    const numistaSearch = await searchVerifiedSoldListings(clientId, numistaTitle.slice(0, 80), 30);
    console.log(`[SWISH Market v4] Numista title search: ${numistaSearch.listings.length} sold`);
    additionalSold = [...additionalSold, ...numistaSearch.listings];
  }

  // For Islamic coins with no/few results: also try broader "Islamic silver coin" search
  if (isIslamic && (primarySold.listings.length + additionalSold.length) < 5) {
    const broadIslamicSearch = await searchVerifiedSoldListings(clientId, 'Islamic silver coin dirham', 50);
    console.log(`[SWISH Market v4] Broad Islamic fallback: ${broadIslamicSearch.listings.length} sold, total=${broadIslamicSearch.totalFound}`);
    additionalSold = [...additionalSold, ...broadIslamicSearch.listings];
  }

  // Deduplicate eBay sold (by price + title exact match)
  const allEbaySold = [...primarySold.listings, ...additionalSold].filter(
    (item, idx, arr) => arr.findIndex(x => Math.abs(x.price - item.price) < 0.01 && x.title === item.title) === idx,
  );

  console.log(`[SWISH Market v4] Total deduplicated eBay sold: ${allEbaySold.length}`);

  // Score comparables
  const scoredEbaySold = allEbaySold.map(c => {
    const { score, factors, exclusionReason } = scoreComparableRelevance(c, title, attributes, specialistId, numistaTypeId);
    return { ...c, relevanceScore: score, relevanceFactors: factors, exclusionReason };
  });

  const scoredActive = (activePrices as ComparableItem[]).map(c => {
    const { score, factors } = scoreComparableRelevance(c, title, attributes, specialistId);
    return { ...c, relevanceScore: score, relevanceFactors: factors };
  });

  const combined = buildCombinedStats(
    numistaSalesData, scoredEbaySold, scoredActive, title, attributes, specialistId, numistaTypeId,
  );

  console.log(`[SWISH Market v4] Results: numistaRelevant=${combined.numistaStats.relevantCount} ebayRelevant=${combined.ebayStats.relevantCount} quality=${combined.dataQuality} median=£${combined.combinedMedian}`);

  const effectiveNumistaTier = numistaMatchTier && numistaMatchTier !== 'no_match'
    ? numistaMatchTier
    : (isMX || isClothing) ? 'unavailable' : (isCoin ? 'no_match' : 'unavailable');

  let valuation = deriveValuation(
    combined, identificationConfidence, identificationTier, effectiveNumistaTier, condition,
  );

  if (isMX && mxRunningMultiplier < 1.0 && valuation.valuationMid > 0) {
    const m = mxRunningMultiplier;
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

  let applied = false;
  if (applyToItem && itemId && combined.dataQuality !== 'insufficient') {
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
    } catch (e: any) { console.log(`[SWISH Market v4] Auto-apply failed: ${e.message}`); }
  }

  return jsonResponse({
    success: true,
    searchQuery: searchQueries[0],
    searchQueriesUsed: searchQueries,
    valuation,

    soldMarket: {
      verifiedSoldCount: combined.ebayStats.count,
      relevantSoldCount: combined.ebayStats.relevantCount,
      excludedSoldCount: combined.ebayStats.count - combined.ebayStats.relevantCount,
      medianPrice: combined.ebayStats.median,
      weightedMedianPrice: combined.ebayStats.weightedMedian,
      lowPrice: combined.ebayStats.low,
      highPrice: combined.ebayStats.high,
      auctionMedian: combined.ebayStats.auctionMedian,
      binMedian: combined.ebayStats.binMedian,
      auctionShare: combined.ebayStats.auctionShare,
      dateRange: combined.ebayStats.dateRangeStart && combined.ebayStats.dateRangeEnd
        ? `${combined.ebayStats.dateRangeStart.slice(0, 10)} to ${combined.ebayStats.dateRangeEnd.slice(0, 10)}`
        : 'unknown',
      dataQuality: combined.dataQuality,
      dataQualityReason: combined.dataQualityReason,
      exceptionalSales: combined.exceptionalSalesAll.map(s => ({ title: s.title.slice(0, 60), price: s.price, date: s.endDate })),
      // v4: include sample exclusion reasons for diagnostics
      sampleExclusions: combined.ebayStats.excludedReasons.slice(0, 5),
    },

    numistaSales: numistaSalesData ? {
      available: !numistaSalesData.error,
      error: numistaSalesData.error ?? null,
      numistaN: numistaSalesData.numistaN,
      numistaUrl: numistaSalesData.numistaUrl,
      numistaTitle: numistaSalesData.numistaTitle,
      totalFetched: numistaSalesData.totalFetched,
      relevantCount: combined.numistaStats.relevantCount,
      median: combined.numistaStats.median,
      low: combined.numistaStats.low,
      high: combined.numistaStats.high,
      recentSales: numistaSalesData.sales.slice(0, 10).map(s => ({
        price: s.price, currency: s.currency, originalPrice: s.originalPrice,
        date: s.date, condition: s.condition, grade: s.grade,
        marketplace: s.marketplace, description: s.description.slice(0, 60),
      })),
    } : null,

    combinedEvidence: {
      numistaRelevant: combined.numistaStats.relevantCount,
      ebayRelevant: combined.ebayStats.relevantCount,
      total: combined.combinedRelevantCount,
      combinedMedian: combined.combinedMedian,
      combinedLow: combined.combinedLow,
      combinedHigh: combined.combinedHigh,
    },

    activeAskingPrices: {
      note: 'ASKING PRICES ONLY — not verified sales. Not used in valuation.',
      count: combined.activeAskingCount,
      medianAskingPrice: combined.activeAskingMedian,
      lowAskingPrice: combined.activeAskingLow,
      highAskingPrice: combined.activeAskingHigh,
      relevantCount: scoredActive.filter(c => c.relevanceScore >= MIN_RELEVANCE).length,
    },

    numista: numistaTypeId ? {
      typeId: numistaTypeId,
      numistaN: `N#${numistaTypeId}`,
      numistaUrl: `https://en.numista.com/catalogue/index.php?r=${numistaTypeId}`,
      matchScore: numistaMatchScore,
      matchTier: numistaMatchTier,
      accepted: ['verified', 'strong_match'].includes(numistaMatchTier),
    } : null,

    dataSource: {
      findingApiTotal: allEbaySold.length,
      primarySearchTotal: primarySold.totalFound,
      browseApiActive: activePrices.length,
      numistaSalesFound: numistaSalesData?.totalFetched ?? 0,
      numistaSalesRelevant: combined.numistaStats.relevantCount,
      currencyConversions: combined.currencyConversionsUsed,
      marketplace: EBAY_GLOBAL_ID,
      // v4: connectivity test fields
      apiConnectionStatus: {
        findingApiReached: primarySold.error ? 'error' : 'success',
        findingApiError: primarySold.error ?? null,
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
      numistaSalesCount: numistaSalesData?.totalFetched ?? 0,
      numistaSalesRelevant: combined.numistaStats.relevantCount,
      numistaMedian: combined.numistaStats.median,
      ebayFoundTotal: allEbaySold.length,
      ebayPrimarySearchTotal: primarySold.totalFound,
      ebaySoldRelevant: combined.ebayStats.relevantCount,
      ebayMedian: combined.ebayStats.median,
      combinedRelevant: combined.combinedRelevantCount,
      combinedMedian: combined.combinedMedian,
      excludedComparables: combined.excludedEbaySales,
      topComparables: combined.topEbaySales,
      statisticalMethod: 'relevance_weighted_median_with_iqr_outlier_detection',
      valuationConfidence: valuation.valuationConfidence,
      valuationMethod: valuation.valuationMethod,
      valuationWarnings: valuation.valuationWarnings,
    },

    autonomousMode, applied,

    // Legacy compatibility
    stats: {
      count: combined.combinedRelevantCount,
      low: valuation.valuationLow,
      mid: valuation.valuationMid,
      high: valuation.valuationHigh,
      mean: combined.combinedMedian,
      auctionWinRate: combined.ebayStats.auctionShare,
      medianAuctionPrice: combined.ebayStats.auctionMedian,
      medianBinPrice: combined.ebayStats.binMedian,
      dataQuality: combined.dataQuality === 'strong' ? 'high' : combined.dataQuality === 'moderate' ? 'medium' : combined.dataQuality === 'weak' ? 'low' : 'insufficient',
      recentSales: combined.topEbaySales.slice(0, 10).map(c => ({
        title: c.title, price: c.price, currency: 'GBP',
        listingType: c.listingType, condition: '', url: '',
        sellSummary: 'Sold' as const, endDate: c.date,
      })),
    },
    recommendation: {
      recommendedFormat: valuation.recommendedListingFormat,
      recommendedPrice: valuation.recommendedListingPrice,
      auctionStartPrice: valuation.auctionStartPrice,
      confidenceScore: valuation.valuationConfidence === 'high' ? 0.82 : valuation.valuationConfidence === 'medium' ? 0.65 : valuation.valuationConfidence === 'low' ? 0.45 : valuation.valuationConfidence === 'very_low' ? 0.25 : 0.1,
      quickSaleRatio: 0.95,
      reasoning: valuation.listingPriceRationale,
      keyFactors: [
        `${combined.combinedRelevantCount} combined relevant sales (EBAY_GB)`,
        combined.numistaStats.relevantCount > 0 ? `${combined.numistaStats.relevantCount} Numista verified sales` : null,
        combined.dataQuality !== 'insufficient' ? `Range £${valuation.valuationLow}–£${valuation.valuationHigh}` : 'Insufficient data',
        ...valuation.valuationWarnings.slice(0, 2),
      ].filter(Boolean),
      warningFlags: valuation.valuationWarnings,
    },
  });
});
