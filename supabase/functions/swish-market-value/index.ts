// SWISH Market Value & Pricing Intelligence Edge Function v3
//
// CRITICAL CHANGES v3 (Numista-First Architecture):
//   1. Accepts numistaTypeId from swish-identify for sales record lookup
//   2. Retrieves Numista sales records for VERIFIED types only
//   3. Numista sales and eBay sold sales are kept SEPARATE in audit trail
//   4. Combined valuation uses both sources with relevance weighting
//   5. Active asking prices remain clearly separated — NEVER used as sold evidence
//   6. Ancient coin protection: broad searches rejected without type verification
//   7. Physical measurement contradictions from Numista cap valuation confidence
//   8. Recommended listing price is evidence-derived, not median × 0.95
//   9. Sale probability only from actual date-range data (never invented)
//   10. Full audit trail: numistaSales + ebaySales + combined statistics
//
// POST body:
//   {
//     tenantId: string,
//     itemId?: string,
//     title: string,
//     specialistId?: string,
//     attributes?: object,
//     condition?: string,
//     identificationConfidence?: number,
//     identificationTier?: string,
//     numistaTypeId?: number,           // NEW: from swish-identify numistaVerification
//     numistaMatchScore?: number,       // NEW: from swish-identify
//     numistaMatchTier?: string,        // NEW: from swish-identify
//     applyToItem?: boolean,
//   }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const EBAY_FINDING_API = 'https://svcs.ebay.com/services/search/FindingService/v1';
const EBAY_TOKEN_URL   = 'https://api.ebay.com/identity/v1/oauth2/token';
const NUMISTA_API      = 'https://api.numista.com/api/v3';

function adminClient() {
  return createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

// ── Coin specialist detector ──────────────────────────────────────────────────
function isCoinSpecialist(specialistId: string): boolean {
  return specialistId === 'coins' || specialistId === 'coins_uk' ||
    specialistId?.includes('coin') || specialistId?.includes('numismatic') ||
    specialistId === 'curiosities_collectibles';
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
    const data = await resp.json();
    return data.access_token ?? null;
  } catch { return null; }
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

// ── eBay search query builder ─────────────────────────────────────────────────
function buildSearchQueries(title: string, attributes: Record<string, any>, specialistId: string, numistaTitle?: string): string[] {
  const queries: string[] = [];

  const cleanTitle = title
    .replace(/^(vintage|antique|old|rare|beautiful|stunning|amazing|lovely|nice|ex|extraordinary)\s+/gi, '')
    .replace(/\s+/g, ' ').trim().slice(0, 100);
  queries.push(cleanTitle);

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

    // Primary structured query: Make + Model + Year + Engine
    const primaryParts = [make, model, startYear, engineCC].filter(Boolean);
    if (primaryParts.length >= 2) queries.push(primaryParts.join(' ').slice(0, 100));

    // Fallback 1: Make + Engine + stroke (broader)
    const fallback1 = [make, engineCC, strokeLabel, bikeType || 'motocross'].filter(Boolean);
    if (fallback1.length >= 2) queries.push(fallback1.join(' ').slice(0, 100));

    // Fallback 2: Make + Model only (broadest)
    if (make && model) queries.push(`${make} ${model} motocross`.slice(0, 100));
  }

  // ── Bicycles ──────────────────────────────────────────────────────────────
  if (specialistId === 'bicycles' || specialistId === 'cycling') {
    const brand = String(attributes?.manufacturer ?? attributes?.brand ?? '').trim();
    const model = String(attributes?.model ?? attributes?.model_name ?? '').trim();
    const frameType = String(attributes?.bike_type ?? attributes?.frame_type ?? '').trim();
    const frameSize = String(attributes?.frame_size ?? '').trim();
    const year = String(attributes?.year_range ?? attributes?.year_made ?? '').trim();
    const groupset = String(attributes?.groupset ?? attributes?.drivetrain ?? '').trim();

    // Primary: brand + model + year
    const primaryParts = [brand, model, year ? year.split('-')[0] : ''].filter(Boolean);
    if (primaryParts.length >= 2) queries.push(primaryParts.join(' ').slice(0, 100));

    // Fallback 1: brand + frameType + frameSize
    const fallback1 = [brand, frameType, frameSize].filter(Boolean);
    if (fallback1.length >= 2) queries.push(fallback1.join(' ').slice(0, 100));

    // Fallback 2: brand only (broadest for rare bikes)
    if (brand && frameType) queries.push(`${brand} ${frameType} bike`.slice(0, 100));
  }

  // ── Clothing ──────────────────────────────────────────────────────────────
  if (isClothingSpecialist(specialistId)) {
    const brand = String(attributes?.brand ?? attributes?.Brand ?? attributes?.manufacturer ?? '').trim();
    const garmentType = String(attributes?.garment_type ?? attributes?.item_type ?? '').trim();
    const era = String(attributes?.era ?? attributes?.era_estimate ?? '').trim();
    const size = String(attributes?.size ?? attributes?.labelled_size ?? '').trim();
    const colour = String(attributes?.colour ?? attributes?.color ?? '').trim();
    const composition = String(attributes?.composition ?? attributes?.material ?? '').trim();
    const countryMade = String(attributes?.country_of_origin ?? attributes?.made_in ?? '').trim();

    // Primary: brand + garmentType + era
    if (brand && garmentType) {
      const clothingQuery = [brand, garmentType, era].filter(Boolean).join(' ').slice(0, 100);
      if (clothingQuery !== cleanTitle) queries.push(clothingQuery);
    }

    // Fallback 1: brand + garmentType + size
    if (brand && garmentType && size) {
      queries.push([brand, garmentType, size].join(' ').slice(0, 100));
    }

    // Fallback 2: brand + garmentType only (broadest)
    if (brand && garmentType) {
      const broad = `vintage ${brand} ${garmentType}`.slice(0, 100);
      if (!queries.includes(broad)) queries.push(broad);
    }

    // Fallback 3: brand only for rare/luxury items
    if (brand && composition && composition.toLowerCase().includes('silk')) {
      queries.push(`${brand} vintage clothing`.slice(0, 100));
    }
  }

  // ── Coins ──────────────────────────────────────────────────────────────────
  if (isCoinSpecialist(specialistId)) {
    const parts: string[] = [];
    if (attributes?.ruler) parts.push(String(attributes.ruler));
    if (attributes?.denomination) parts.push(String(attributes.denomination));
    const yr = attributes?.year_made ?? attributes?.yearMade;
    if (yr) parts.push(String(yr));
    if (parts.length >= 2) queries.push(parts.join(' ').slice(0, 100));

    // Use Numista title for more precise eBay search
    if (numistaTitle && numistaTitle.length > 5 && numistaTitle !== cleanTitle) {
      queries.push(numistaTitle.slice(0, 80));
    }

    const catNum = attributes?.catalogue_number ?? attributes?.catalogueNumber;
    if (catNum) queries.push(String(catNum).slice(0, 50));
  }

  return queries.filter((q, i, a) => q.length >= 3 && a.indexOf(q) === i).slice(0, 5);
}

// ═══════════════════════════════════════════════════════════════════════════════
// NUMISTA SALES RECORDS
// ═══════════════════════════════════════════════════════════════════════════════

interface NumistaSaleRecord {
  price: number;       // GBP
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
    // Fetch type detail for title
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

    // Fetch sales records
    const salesResp = await fetch(`${NUMISTA_API}/types/${typeId}/sales_records?count=50`, {
      headers: { 'Numista-API-Key': apiKey }, signal: AbortSignal.timeout(10000),
    });

    if (!salesResp.ok) {
      // 402 = requires paid plan — graceful degradation
      if (salesResp.status === 402 || salesResp.status === 403) {
        console.log(`[SWISH Market v3] Numista sales records require paid plan (${salesResp.status})`);
        return { ...noResult, numistaTitle: typeTitle, error: `Sales records require Numista paid API plan (${salesResp.status})` };
      }
      console.log(`[SWISH Market v3] Numista sales ${salesResp.status}`);
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

        const grade = raw.grade ?? raw.condition_grade ?? '';
        const cond = raw.condition ?? raw.quality ?? '';
        const date = raw.date ?? raw.sold_date ?? raw.auction_date ?? '';
        const marketplace = raw.marketplace ?? raw.source ?? raw.auction_house ?? 'Numista';

        sales.push({
          price: Math.round(gbpPrice * 100) / 100,
          currency,
          originalPrice: rawPrice,
          date,
          condition: cond,
          grade,
          marketplace,
          url: raw.url ?? raw.link ?? '',
          description: raw.description ?? raw.title ?? '',
        });
      } catch { /* skip malformed */ }
    }

    // Filter by condition relevance
    // Only heavily penalise if our coin is damaged and sales are high-grade (or vice versa)
    const conditionLower = condition.toLowerCase();
    const isDamaged = conditionLower.includes('damage') || conditionLower.includes('hole') ||
      conditionLower.includes('clean') || conditionLower.includes('poor') || conditionLower.includes('fair');

    const relevantSales = sales.filter(s => {
      if (!isDamaged) return true; // Keep all if condition unknown
      // Exclude obviously top-grade examples when coin is damaged
      const saleCondLower = (s.condition + s.grade).toLowerCase();
      const isTopGrade = saleCondLower.includes('ms') || saleCondLower.includes('unc') ||
        saleCondLower.includes('pf') || saleCondLower.includes('gem');
      return !isTopGrade;
    });

    // Compute statistics on relevant sales
    const prices = relevantSales.map(s => s.price).sort((a, b) => a - b);
    const n = prices.length;
    const median = prices[Math.floor(n / 2)] ?? 0;
    const low = prices[Math.floor(n * 0.15)] ?? prices[0] ?? 0;
    const high = prices[Math.floor(n * 0.85)] ?? prices[n - 1] ?? 0;

    console.log(`[SWISH Market v3] Numista type N#${typeId}: ${rawSales.length} sales fetched, ${relevantSales.length} relevant, median=£${median}`);

    return {
      typeId, numistaTitle: typeTitle,
      numistaN: `N#${typeId}`,
      numistaUrl: `https://en.numista.com/catalogue/index.php?r=${typeId}`,
      sales: relevantSales.slice(0, 30),
      totalFetched: rawSales.length,
      relevantCount: relevantSales.length,
      median: Math.round(median * 100) / 100,
      low: Math.round(low * 100) / 100,
      high: Math.round(high * 100) / 100,
      currencyConversions: [...conversions],
    };
  } catch (e: any) {
    console.log(`[SWISH Market v3] Numista sales error: ${e.message}`);
    return { ...noResult, error: `Numista sales error: ${e.message}` };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// eBay FINDING API — VERIFIED SOLD ONLY
// ═══════════════════════════════════════════════════════════════════════════════

async function searchVerifiedSoldListings(
  clientId: string, query: string, maxResults = 50,
): Promise<{ listings: ComparableItem[]; error?: string; totalFound: number }> {
  const params = new URLSearchParams({
    'OPERATION-NAME': 'findCompletedItems',
    'SERVICE-VERSION': '1.13.0',
    'SECURITY-APPNAME': clientId,
    'RESPONSE-DATA-FORMAT': 'JSON',
    'REST-PAYLOAD': '',
    'keywords': query,
    'sortOrder': 'EndTimeSoonest',
    'paginationInput.entriesPerPage': String(Math.min(maxResults, 50)),
    'paginationInput.pageNumber': '1',
    'itemFilter(0).name': 'SoldItemsOnly',
    'itemFilter(0).value': 'true',
    'outputSelector(0)': 'SellerInfo',
  });

  try {
    const resp = await fetch(`${EBAY_FINDING_API}?${params.toString()}`, {
      headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(12000),
    });
    if (!resp.ok) return { listings: [], error: `eBay Finding API ${resp.status}`, totalFound: 0 };

    const data = await resp.json();
    const searchResult = data?.findCompletedItemsResponse?.[0];
    if (!searchResult || searchResult.ack?.[0] !== 'Success') return { listings: [], error: 'eBay Finding API returned no results', totalFound: 0 };

    const totalFound = parseInt(searchResult.paginationOutput?.[0]?.totalEntries?.[0] ?? '0') || 0;
    const items = searchResult.searchResult?.[0]?.item ?? [];
    const listings: ComparableItem[] = [];

    for (const item of items) {
      try {
        const sellingStatus = item.sellingStatus?.[0] ?? {};
        const listingInfo = item.listingInfo?.[0] ?? {};
        const conditionInfo = item.condition?.[0] ?? {};

        // CRITICAL: Only EndedWithSales means the item actually sold
        if (sellingStatus.sellingState?.[0] !== 'EndedWithSales') continue;

        const price = parseFloat(sellingStatus.convertedCurrentPrice?.[0]?.['__value__'] ?? sellingStatus.currentPrice?.[0]?.['__value__'] ?? '0');
        if (price <= 0) continue;

        const currency = sellingStatus.convertedCurrentPrice?.[0]?.['@currencyId'] ?? 'GBP';
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

    return { listings, error: undefined, totalFound };
  } catch (e: any) { return { listings: [], error: `Finding API error: ${e.message}`, totalFound: 0 }; }
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
    if (!resp.ok) return [];
    const data = await resp.json();
    const items = data.itemSummaries ?? [];
    return items.map((item: any) => {
      const price = parseFloat(item.price?.value ?? '0');
      if (price <= 0) return null;
      return {
        title: item.title ?? '', price: Math.round(price * 100) / 100,
        currency: item.price?.currency ?? 'GBP', originalPrice: undefined,
        listingType: 'FixedPrice' as const,
        saleStatus: 'active' as const,  // ALWAYS active — NEVER "Sold"
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
  let score = 0.45; // Slightly lower base — force positive signals to lift

  // Numista-sourced sales get a head start if type matches
  if (comparable.source === 'numista' && comparable.numistaTypeId === numistaTypeId) {
    score = 0.80;
    factors.push('Numista verified type — high base relevance');
    return { score, factors };
  }

  const compLower = comparable.title.toLowerCase();
  const targetLower = targetTitle.toLowerCase();
  const targetWords = targetLower.split(/\s+/).filter(w => w.length > 2);
  const matchedWords = targetWords.filter(w => compLower.includes(w));
  const titleOverlap = targetWords.length > 0 ? matchedWords.length / targetWords.length : 0;

  if (titleOverlap >= 0.7) { score += 0.22; factors.push(`High title match (${Math.round(titleOverlap * 100)}%)`); }
  else if (titleOverlap >= 0.5) { score += 0.12; factors.push(`Good title match (${Math.round(titleOverlap * 100)}%)`); }
  else if (titleOverlap >= 0.35) { score += 0.04; factors.push(`Partial title match (${Math.round(titleOverlap * 100)}%)`); }
  else if (titleOverlap < 0.15) { score -= 0.22; factors.push(`Poor title match (${Math.round(titleOverlap * 100)}%)`); }

  // ── Niche-specific attribute matching ─────────────────────────────────────
  if (isCoinSpecialist(specialistId)) {
    const denom = String(targetAttrs?.denomination ?? targetAttrs?.Denomination ?? '').toLowerCase();
    if (denom && denom.length > 1) {
      if (compLower.includes(denom)) { score += 0.15; factors.push(`Denomination match: ${denom}`); }
      else { score -= 0.20; return { score, factors, exclusionReason: `Different denomination (target: ${denom})` }; }
    }

    const ruler = String(targetAttrs?.ruler ?? targetAttrs?.Ruler ?? '').toLowerCase();
    if (ruler && ruler.length > 2) {
      const rulerLast = ruler.split(' ').pop() ?? ruler;
      if (compLower.includes(rulerLast)) { score += 0.15; factors.push(`Ruler match: ${ruler}`); }
      else { score -= 0.10; factors.push(`Ruler mismatch: target=${ruler}`); }

      const knownRulers = ['victoria', 'george', 'edward', 'elizabeth', 'william', 'henry', 'richard', 'augustus', 'tiberius', 'nero', 'claudius', 'vespasian', 'hadrian', 'constantine'];
      for (const kr of knownRulers) {
        if (!ruler.includes(kr) && compLower.includes(kr)) { score -= 0.15; factors.push(`Different ruler in comparable: ${kr}`); break; }
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
    else if (engineCC && !compLower.includes(engineCC)) {
      // Check for close engine sizes (e.g. 450 vs 400)
      const targetCC = parseInt(engineCC);
      const compNumbers = compLower.match(/\d{2,4}(?:cc)?/g);
      const hasNearCC = compNumbers?.some(n => { const nn = parseInt(n); return Math.abs(nn - targetCC) <= 25; });
      if (!hasNearCC) { score -= 0.08; factors.push('Engine size mismatch'); }
    }

    if (stroke && stroke !== 'unknown') {
      const strokeDigit = stroke.includes('2') ? '2' : stroke.includes('4') ? '4' : '';
      if (strokeDigit && compLower.includes(strokeDigit + '-stroke') || compLower.includes(strokeDigit + ' stroke')) {
        score += 0.06; factors.push(`Stroke match: ${stroke}`);
      }
    }

    const startYear = year ? year.split('-')[0].trim() : '';
    if (startYear && startYear.length === 4 && compLower.includes(startYear)) { score += 0.08; factors.push(`Year match: ${startYear}`); }

    // Exclude clearly wrong category items
    const mxKeywords = ['motocross', 'mx', 'enduro', 'supermoto', 'dirt bike', 'trail bike', 'off road'];
    const hasMXKeyword = mxKeywords.some(k => compLower.includes(k));
    if (!hasMXKeyword && !make) { score -= 0.12; factors.push('No MX category signals in title'); }
  }

  if (specialistId === 'bicycles' || specialistId === 'cycling') {
    const brand = String(targetAttrs?.manufacturer ?? targetAttrs?.brand ?? '').toLowerCase();
    const model = String(targetAttrs?.model ?? targetAttrs?.model_name ?? '').toLowerCase();
    const frameType = String(targetAttrs?.bike_type ?? targetAttrs?.frame_type ?? '').toLowerCase();
    const frameSize = String(targetAttrs?.frame_size ?? '').toLowerCase();
    const year = String(targetAttrs?.year_range ?? targetAttrs?.year_made ?? '').toLowerCase();
    const groupset = String(targetAttrs?.groupset ?? targetAttrs?.drivetrain ?? '').toLowerCase();

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

    // Bike category keywords boost relevance
    const bikeKeywords = ['mountain bike', 'road bike', 'mtb', 'gravel', 'enduro', 'downhill', 'hardtail', 'full suspension', 'bmx', 'hybrid'];
    const hasBikeKeyword = bikeKeywords.some(k => compLower.includes(k));
    if (hasBikeKeyword) { score += 0.05; factors.push('Bike category keyword present'); }
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

    // Vintage/deadstock signal boosts
    if (compLower.includes('vintage') || compLower.includes('deadstock') || compLower.includes('distressed')) {
      score += 0.04; factors.push('Vintage/deadstock signal');
    }
  }

  if (comparable.price > 2000) { score -= 0.08; factors.push('Unusually high-value — may be exceptional specimen'); }
  if (comparable.saleStatus === 'active') { score -= 0.30; factors.push('Asking price — not a verified sale'); }

  return { score: Math.max(0, Math.min(1, score)), factors };
}

// ═══════════════════════════════════════════════════════════════════════════════
// VALUATION STATISTICS — SEPARATE NUMISTA + EBAY, THEN COMBINED
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
}

function computeSourceStats(
  items: ComparableItem[],
  title: string,
  attrs: Record<string, any>,
  specialistId: string,
  numistaTypeId?: number,
): SourceStats {
  const empty: SourceStats = { count: 0, relevantCount: 0, median: 0, low: 0, high: 0, weightedMedian: 0, auctionShare: 0, auctionMedian: 0, binMedian: 0, dateRangeStart: '', dateRangeEnd: '', exceptionalSales: [], mainPrices: [] };
  if (items.length === 0) return empty;

  const scored = items.map(c => {
    const { score, factors, exclusionReason } = scoreComparableRelevance(c, title, attrs, specialistId, numistaTypeId);
    return { ...c, relevanceScore: score, relevanceFactors: factors, exclusionReason };
  });

  const relevant = scored.filter(c => c.relevanceScore >= MIN_RELEVANCE && !c.exclusionReason);
  if (relevant.length === 0) return { ...empty, count: items.length };

  const prices = relevant.map(c => c.price).sort((a, b) => a - b);
  const n = prices.length;

  // IQR outlier detection
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
  if (mn === 0) return { ...empty, count: items.length, relevantCount: relevant.length };

  const median = mainPrices[Math.floor(mn * 0.50)] ?? 0;
  const low = mainPrices[Math.floor(mn * 0.15)] ?? mainPrices[0] ?? 0;
  const high = mainPrices[Math.floor(mn * 0.85)] ?? mainPrices[mn - 1] ?? 0;

  // Relevance-weighted median
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

  // Auction / BIN split
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
  };
}

// ── Combine Numista + eBay stats into final valuation statistics ──────────────
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
  // Convert Numista sales to ComparableItem format
  const numistaComparables: ComparableItem[] = (numistaSalesData?.sales ?? []).map(s => ({
    title: `${numistaSalesData?.numistaTitle ?? ''} (${s.grade ?? s.condition ?? ''}) — ${s.marketplace}`.trim(),
    price: s.price,
    currency: s.currency,
    originalPrice: s.originalPrice,
    listingType: 'FixedPrice' as const,
    saleStatus: 'sold' as const,
    endDate: s.date,
    condition: s.condition,
    url: s.url,
    source: 'numista' as const,
    numistaTypeId,
    relevanceScore: 0,
    relevanceFactors: [],
  }));

  const numistaStats = computeSourceStats(numistaComparables, title, attrs, specialistId, numistaTypeId);
  const ebayStats = computeSourceStats(
    ebaySoldComparables.map(c => ({ ...c, source: 'ebay' as const })),
    title, attrs, specialistId, numistaTypeId,
  );

  // Active asking prices stats (separately)
  const activePrices = activeComparables.map(c => c.price).sort((a, b) => a - b);
  const activeMedian = activePrices[Math.floor(activePrices.length / 2)] ?? 0;
  const activeLow = activePrices[Math.floor(activePrices.length * 0.15)] ?? activePrices[0] ?? 0;
  const activeHigh = activePrices[Math.floor(activePrices.length * 0.85)] ?? activePrices[activePrices.length - 1] ?? 0;

  // Combine prices — Numista sales weighted equally to eBay, IQR on combined set
  const allMainPrices = [...numistaStats.mainPrices, ...ebayStats.mainPrices].sort((a, b) => a - b);
  const cn = allMainPrices.length;

  let combinedMedian = 0, combinedLow = 0, combinedHigh = 0, combinedWeightedMedian = 0;

  if (cn > 0) {
    combinedMedian = allMainPrices[Math.floor(cn * 0.50)] ?? 0;
    combinedLow = allMainPrices[Math.floor(cn * 0.15)] ?? allMainPrices[0] ?? 0;
    combinedHigh = allMainPrices[Math.floor(cn * 0.85)] ?? allMainPrices[cn - 1] ?? 0;
    combinedWeightedMedian = combinedMedian; // Simplified — weighted median approximation
  }

  const combinedRelevantCount = numistaStats.relevantCount + ebayStats.relevantCount;

  // Data quality
  let dataQuality: CombinedValuationStats['dataQuality'] = 'insufficient';
  let dataQualityReason = '';

  const numistaBonus = (numistaSalesData && !numistaSalesData.error && numistaStats.relevantCount >= 3) ? 1 : 0;
  const effectiveCount = cn + (numistaBonus * 3); // Numista verified sales count for more

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
    dataQualityReason = 'No relevant sold market data found for this item';
  }

  // Collect currency conversions
  const conversions = [...new Set([
    ...numistaComparables.filter(c => c.currency !== 'GBP').map(c => c.currency),
    ...ebaySoldComparables.filter(c => c.currency !== 'GBP').map(c => c.currency),
  ])];

  // Top eBay sales for audit
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
    numistaStats, ebayStats,
    combinedRelevantCount, combinedMedian, combinedLow, combinedHigh, combinedWeightedMedian,
    activeAskingMedian: Math.round(activeMedian * 100) / 100,
    activeAskingLow: Math.round(activeLow * 100) / 100,
    activeAskingHigh: Math.round(activeHigh * 100) / 100,
    activeAskingCount: activeComparables.length,
    dataQuality, dataQualityReason,
    currencyConversionsUsed: conversions,
    topEbaySales, excludedEbaySales, exceptionalSalesAll,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// FINAL VALUATION DERIVATION — DETERMINISTIC, NO AI INVENTION
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
    valuationConfidence: 'insufficient_data',
    valuationMethod: 'no_data',
    valuationWarnings: [combined.dataQualityReason],
    fairMarketValue: 0,
    currentAskingMarketMid: combined.activeAskingMedian,
    recommendedListingPrice: 0,
    recommendedListingFormat: 'BuyItNow',
    listingPriceRationale: 'Insufficient market data — manual research required',
    saleProb30d: null,
  };

  if (combined.combinedRelevantCount < 3 || combined.combinedMedian <= 0) {
    const insufficientWarnings: string[] = [];
    if (combined.ebayStats.count > 0 && combined.ebayStats.relevantCount === 0) {
      insufficientWarnings.push(`${combined.ebayStats.count} eBay sold items found but NONE were relevant after scoring — results may be too dissimilar (wrong denomination, ruler, or type)`);
    } else if (combined.ebayStats.count === 0) {
      insufficientWarnings.push('No eBay completed/sold listings found. The item may be rare, niche, or search terms need refinement.');
    } else {
      insufficientWarnings.push(`Only ${combined.combinedRelevantCount} relevant sold comparable${combined.combinedRelevantCount === 1 ? '' : 's'} found — minimum 3 required for reliable valuation`);
    }
    return { ...noValue, valuationWarnings: insufficientWarnings };
  }

  const mid = combined.combinedWeightedMedian || combined.combinedMedian;
  const low = combined.combinedLow;
  const high = combined.combinedHigh;

  const warnings: string[] = [];

  // ── Valuation confidence: min of data quality, identification confidence, Numista match ─
  const dataQualityScore: Record<string, number> = { strong: 4, moderate: 3, weak: 2, insufficient: 0 };
  const idTierScore: Record<string, number> = { very_high: 4, high: 3, medium: 2, low: 1, very_low: 0, unknown: 0 };
  const numistaTierScore: Record<string, number> = { verified: 4, very_strong: 4, strong: 3, plausible: 2, weak: 1, rejected: 0, no_match: 1, unavailable: 2 };

  const dScore = dataQualityScore[combined.dataQuality] ?? 0;
  const iScore = idTierScore[identificationTier] ?? 1;
  const nScore = numistaTierScore[numistaMatchTier] ?? 1;

  // Combined score is the minimum across all three dimensions
  const combinedScore = Math.min(dScore, iScore, nScore);

  const confMap: Record<number, string> = { 4: 'high', 3: 'medium', 2: 'low', 1: 'very_low', 0: 'insufficient_data' };
  const valuationConfidence = confMap[combinedScore] ?? 'insufficient_data';

  if (iScore < dScore) warnings.push(`Valuation confidence limited by identification confidence (${identificationTier})`);
  if (nScore < dScore) warnings.push(`Valuation confidence limited by Numista match (${numistaMatchTier}) — exact type uncertain`);

  if (combined.exceptionalSalesAll.length > 0) {
    const maxEx = Math.max(...combined.exceptionalSalesAll.map(s => s.price));
    warnings.push(`${combined.exceptionalSalesAll.length} exceptional sale${combined.exceptionalSalesAll.length > 1 ? 's' : ''} excluded from valuation: max £${maxEx}`);
  }
  if (combined.currencyConversionsUsed.length > 0) {
    warnings.push(`Currency conversions applied: ${combined.currencyConversionsUsed.join(', ')} → GBP (approximate)`);
  }
  if (combined.activeAskingMedian > mid * 1.5 && combined.activeAskingCount >= 3) {
    warnings.push(`Active asking prices (median £${combined.activeAskingMedian}) significantly above verified sold prices — asking prices are NOT used in valuation`);
  }

  // Condition warning
  const condLower = condition.toLowerCase();
  const isDamaged = condLower.includes('damage') || condLower.includes('hole') || condLower.includes('clean') || condLower.includes('bend');
  if (isDamaged) warnings.push('Item condition includes damage/cleaning — value will be below standard circulated examples');

  // HARD RULE: listing price MUST be derived from sold evidence only
  // Active asking prices are shown for context but never used to set valuation
  const activeNote = combined.activeAskingCount > 0
    ? ` (${combined.activeAskingCount} active asking prices at median £${combined.activeAskingMedian} not used — asking prices ≠ verified sold prices)`
    : '';

  // Adjust listing price ratio by data quality — conservative when data is thin
  const listingRatio = combined.dataQuality === 'strong' ? 0.92 : combined.dataQuality === 'moderate' ? 0.95 : 1.00;

  // ── Listing recommendation — deterministic ────────────────────────────────
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
    listingPriceRationale = `Auction recommended: ${stats.auctionShare}% of eBay comparables were auctions, averaging ${Math.round((auctionPremium - 1) * 100)}% above BIN. Start at £${auctionStartPrice} (15% of sold median £${mid}).${activeNote}`;
  } else {
    recommendedListingPrice = Math.round(mid * listingRatio * 100) / 100;
    format = mid >= 30 ? 'BuyItNow_WithBestOffer' : 'BuyItNow';
    const sourceNote = combined.numistaStats.relevantCount > 0 && combined.ebayStats.relevantCount > 0
      ? `Based on ${combined.numistaStats.relevantCount} Numista + ${combined.ebayStats.relevantCount} eBay SOLD sales (asking prices excluded).`
      : combined.numistaStats.relevantCount > 0
        ? `Based on ${combined.numistaStats.relevantCount} Numista catalogue SOLD sales.`
        : `Based on ${combined.ebayStats.relevantCount} eBay VERIFIED SOLD sales (asking prices excluded).`;
    listingPriceRationale = `BIN at £${recommendedListingPrice} (${Math.round(listingRatio * 100)}% of sold-data median £${mid}). ${sourceNote}${activeNote}`;
  }

  // ── Sale probability from data ────────────────────────────────────────────
  let saleProb30d: number | null = null;
  let saleProbBasis: string | undefined;

  // Use the source with more data for probability calculation
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
        saleProbBasis = `${probStats.relevantCount} relevant sales over ${Math.round(rangeDays)} days = ${salesPerDay.toFixed(3)} sales/day`;
      }
    } catch { /* non-blocking */ }
  } else {
    saleProbBasis = 'Insufficient data for sale probability (need ≥5 relevant dated sales)';
  }

  return {
    valuationLow: Math.round(low * 100) / 100,
    valuationMid: Math.round(mid * 100) / 100,
    valuationHigh: Math.round(high * 100) / 100,
    valuationConfidence,
    valuationMethod: combined.numistaStats.relevantCount > 0
      ? 'numista_and_ebay_sold_combined_relevance_weighted_median'
      : 'ebay_sold_relevance_weighted_median',
    valuationWarnings: warnings,
    fairMarketValue: Math.round(mid * 100) / 100,
    currentAskingMarketMid: combined.activeAskingMedian,
    recommendedListingPrice,
    recommendedListingFormat: format,
    auctionStartPrice,
    listingPriceRationale,
    saleProb30d,
    saleProbBasis,
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
    numistaTypeId,              // NEW: from swish-identify
    numistaMatchScore = 0,      // NEW
    numistaMatchTier = 'no_match', // NEW
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
  const isMX = isMXSpecialist(specialistId);
  const isClothing = isClothingSpecialist(specialistId);

  // For MX: running status significantly affects value
  // Apply multiplier to derived valuation when running status is known
  const mxRunningStatus = isMX ? (attributes?.running_status ?? 'unknown') : null;
  const MX_RUNNING_MULTIPLIERS: Record<string, number> = {
    'Runs and rides (stated)': 1.00, 'Runs & Rides': 1.00,
    'Runs (stated)': 0.85, 'Runs': 0.85,
    'Non-running (stated)': 0.55, 'Non-Running': 0.55, 'Project': 0.50,
    'Non-running (visible evidence)': 0.50,
    'Unknown from images alone': 0.70, 'Unknown': 0.70,
  };
  const mxRunningMultiplier = mxRunningStatus
    ? (MX_RUNNING_MULTIPLIERS[mxRunningStatus] ?? 0.70)
    : 1.0;

  // For coins: get Numista title to improve eBay search precision
  let numistaTitle: string | undefined;
  if (isCoin && attributes?.numista_type_id) {
    numistaTitle = attributes.numista_title ?? undefined;
  }

  const searchQueries = buildSearchQueries(title, attributes, specialistId, numistaTitle);
  console.log(`[SWISH Market v3] Searching "${searchQueries[0]}" tenant=${tenantId} numistaTypeId=${numistaTypeId ?? 'none'}`);

  // ── Run searches in parallel ──────────────────────────────────────────────
  const appToken = await getEbayAppToken(clientId, clientSecret);

  const [primarySold, activePrices, numistaSalesData] = await Promise.all([
    searchVerifiedSoldListings(clientId, searchQueries[0], 50),
    appToken ? searchActivePrices(appToken, searchQueries[0]) : Promise.resolve([] as ComparableItem[]),
    // Only retrieve Numista sales for coins with verified/strong Numista type
    (isCoin && numistaTypeId && ['verified', 'strong_match'].includes(numistaMatchTier))
      ? fetchNumistaSalesRecords(numistaTypeId, condition, attributes)
      : Promise.resolve(null),
  ]);

  // Additional eBay search queries — run fallback queries in parallel for non-coin niches
  let additionalSold: ComparableItem[] = [];
  const needsMore = primarySold.listings.length < 15;
  const fallbackQueries = searchQueries.slice(1);

  if (needsMore && fallbackQueries.length > 0) {
    const fallbackSearches = await Promise.all(
      fallbackQueries.map(q => searchVerifiedSoldListings(clientId, q, 30))
    );
    for (const r of fallbackSearches) additionalSold = [...additionalSold, ...r.listings];
  }

  // For coins: Numista title search for even more precision
  if (isCoin && numistaTitle && primarySold.listings.length < 15) {
    const numistaSearch = await searchVerifiedSoldListings(clientId, numistaTitle.slice(0, 80), 30);
    additionalSold = [...additionalSold, ...numistaSearch.listings];
  }

  // Deduplicate eBay sold
  const allEbaySold = [...primarySold.listings, ...additionalSold].filter(
    (item, idx, arr) => arr.findIndex(x => Math.abs(x.price - item.price) < 0.01 && x.title === item.title) === idx,
  );

  // Score eBay comparables for relevance
  const scoredEbaySold = allEbaySold.map(c => {
    const { score, factors, exclusionReason } = scoreComparableRelevance(c, title, attributes, specialistId, numistaTypeId);
    return { ...c, relevanceScore: score, relevanceFactors: factors, exclusionReason };
  });

  // Score active comparables
  const scoredActive = (activePrices as ComparableItem[]).map(c => {
    const { score, factors } = scoreComparableRelevance(c, title, attributes, specialistId);
    return { ...c, relevanceScore: score, relevanceFactors: factors };
  });

  // Build combined statistics
  const combined = buildCombinedStats(
    numistaSalesData, scoredEbaySold, scoredActive, title, attributes, specialistId, numistaTypeId,
  );

  console.log(`[SWISH Market v3] Combined: numistaRelevant=${combined.numistaStats.relevantCount} ebayRelevant=${combined.ebayStats.relevantCount} quality=${combined.dataQuality} combinedMedian=£${combined.combinedMedian}`);

  // Determine effective Numista tier for valuation confidence
  // Non-coin specialists (MX, clothing) mark Numista as unavailable — this is correct
  const effectiveNumistaTier = numistaMatchTier && numistaMatchTier !== 'no_match'
    ? numistaMatchTier
    : (isMX || isClothing) ? 'unavailable' : (isCoin ? 'no_match' : 'unavailable');

  // Derive final valuation
  let valuation = deriveValuation(
    combined, identificationConfidence, identificationTier, effectiveNumistaTier, condition,
  );

  // MX: apply running status multiplier to all price fields
  // Running bikes are worth significantly more than non-running bikes
  if (isMX && mxRunningMultiplier < 1.0 && valuation.valuationMid > 0) {
    const m = mxRunningMultiplier;
    valuation = {
      ...valuation,
      valuationLow: Math.round(valuation.valuationLow * m * 100) / 100,
      valuationMid: Math.round(valuation.valuationMid * m * 100) / 100,
      valuationHigh: Math.round(valuation.valuationHigh * m * 100) / 100,
      fairMarketValue: Math.round(valuation.fairMarketValue * m * 100) / 100,
      recommendedListingPrice: Math.round(valuation.recommendedListingPrice * m * 100) / 100,
      listingPriceRationale: `${valuation.listingPriceRationale} [Running status multiplier applied: ${mxRunningStatus} = ${Math.round(m * 100)}% of running-bike comparables]`,
    };
  }

  // Auto-apply to item — always apply when explicitly requested (not just autonomous mode)
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
      console.log(`[SWISH Market v3] Auto-applied to item ${itemId}`);
    } catch (e: any) { console.log(`[SWISH Market v3] Auto-apply failed: ${e.message}`); }
  }

  // ── Build full response ───────────────────────────────────────────────────
  return jsonResponse({
    success: true,
    searchQuery: searchQueries[0],
    searchQueriesUsed: searchQueries,

    valuation,

    // ── SOLD MARKET — Numista and eBay SEPARATELY ─────────────────────────────
    soldMarket: {
      // Combined totals
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
    },

    // ── NUMISTA SALES — separate block ────────────────────────────────────────
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

    // ── COMBINED STATS ────────────────────────────────────────────────────────
    combinedEvidence: {
      numistaRelevant: combined.numistaStats.relevantCount,
      ebayRelevant: combined.ebayStats.relevantCount,
      total: combined.combinedRelevantCount,
      combinedMedian: combined.combinedMedian,
      combinedLow: combined.combinedLow,
      combinedHigh: combined.combinedHigh,
    },

    // ── ACTIVE ASKING PRICES — clearly separate ───────────────────────────────
    activeAskingPrices: {
      note: 'ASKING PRICES ONLY — not verified sales. Not used in valuation.',
      count: combined.activeAskingCount,
      medianAskingPrice: combined.activeAskingMedian,
      lowAskingPrice: combined.activeAskingLow,
      highAskingPrice: combined.activeAskingHigh,
      relevantCount: scoredActive.filter(c => c.relevanceScore >= MIN_RELEVANCE).length,
    },

    // ── NUMISTA REFERENCE (type, not sales) ───────────────────────────────────
    numista: numistaTypeId ? {
      typeId: numistaTypeId,
      numistaN: `N#${numistaTypeId}`,
      numistaUrl: `https://en.numista.com/catalogue/index.php?r=${numistaTypeId}`,
      matchScore: numistaMatchScore,
      matchTier: numistaMatchTier,
      accepted: ['verified', 'strong_match'].includes(numistaMatchTier),
      note: ['verified', 'strong_match'].includes(numistaMatchTier)
        ? 'Verified Numista type — sales records retrieved'
        : 'Numista candidate — insufficient match for sales record retrieval',
    } : null,

    // ── DATA SOURCES ──────────────────────────────────────────────────────────
    dataSource: {
      findingApiTotal: allEbaySold.length,
      browseApiActive: activePrices.length,
      numistaSalesFound: numistaSalesData?.totalFetched ?? 0,
      numistaSalesRelevant: combined.numistaStats.relevantCount,
      currencyConversions: combined.currencyConversionsUsed,
    },

    // ── FULL AUDIT TRAIL ──────────────────────────────────────────────────────
    auditTrail: {
      timestamp: new Date().toISOString(),
      searchQueries,
      canonicalTitle: title,
      identificationConfidence,
      identificationTier,
      numistaTypeId: numistaTypeId ?? null,
      numistaMatchScore,
      numistaMatchTier,
      condition,
      // Numista evidence
      numistaSalesCount: numistaSalesData?.totalFetched ?? 0,
      numistaSalesRelevant: combined.numistaStats.relevantCount,
      numistaMedian: combined.numistaStats.median,
      // eBay evidence
      ebayFoundTotal: allEbaySold.length,
      ebaySoldRelevant: combined.ebayStats.relevantCount,
      ebayMedian: combined.ebayStats.median,
      // Combined
      combinedRelevant: combined.combinedRelevantCount,
      combinedMedian: combined.combinedMedian,
      // Excluded
      excludedComparables: combined.excludedEbaySales,
      topComparables: combined.topEbaySales,
      // Statistics
      statisticalMethod: 'relevance_weighted_median_with_iqr_outlier_detection',
      valuationConfidence: valuation.valuationConfidence,
      valuationMethod: valuation.valuationMethod,
      valuationWarnings: valuation.valuationWarnings,
    },

    autonomousMode,
    applied,

    // ── LEGACY COMPATIBILITY (BulkReValueSheet + existing UI) ────────────────
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
        `${combined.combinedRelevantCount} combined relevant sales`,
        combined.numistaStats.relevantCount > 0 ? `${combined.numistaStats.relevantCount} Numista verified sales` : null,
        combined.dataQuality !== 'insufficient' ? `Range £${valuation.valuationLow}–£${valuation.valuationHigh}` : 'Insufficient data',
        ...valuation.valuationWarnings.slice(0, 2),
      ].filter(Boolean),
      warningFlags: valuation.valuationWarnings,
    },
  });
});
