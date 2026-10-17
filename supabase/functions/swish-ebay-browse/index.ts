// KEENONCOINS eBay Browse & Seller Listings Edge Function
// Route 1 (default): Fetches real-time views/watchers for a published eBay listing.
// Route 2 (my_active_listings): Fetches all active seller listings for import.
// Uses eBay OAuth user token for seller operations; App token for public browse.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { encryptCredentials, decryptCredentials } from '../_shared/credentialCrypto.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const EBAY_TOKEN_URL    = 'https://api.ebay.com/identity/v1/oauth2/token';
const EBAY_BROWSE_BASE  = 'https://api.ebay.com/buy/browse/v1';
const APP_TOKEN_SCOPE   = 'https://api.ebay.com/oauth/api_scope';
const TRADING_API = 'https://api.ebay.com/ws/api.dll';
const SITE_ID = '3'; // eBay UK

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

// ── Refresh eBay user access token ───────────────────────────────────────────

async function refreshUserToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
): Promise<{ accessToken: string; expiresAt: string }> {
  console.log('[eBay Auth] Refreshing user access token...');
  const basicAuth = btoa(`${clientId}:${clientSecret}`);
  // Omit scope so eBay retains the complete set granted at consent.
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
  const resp = await fetch(EBAY_TOKEN_URL, {
    method: 'POST',
    headers: { Authorization: `Basic ${basicAuth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const data = await resp.json();
  if (!data.access_token) {
    const msg = data.error_description ?? data.error ?? 'unknown';
    console.log(`[eBay Auth] Refresh failed: ${msg}`);
    throw new Error(`Token refresh failed: ${msg}`);
  }
  const expiresAt = new Date(Date.now() + (data.expires_in ?? 7200) * 1000).toISOString();
  console.log(`[eBay Auth] Token refresh successful, expires: ${expiresAt}`);
  return { accessToken: data.access_token, expiresAt };
}

// ── Get eBay Application Token ─────────────────────────────────────────────────

async function getApplicationToken(clientId: string, clientSecret: string): Promise<string | null> {
  const basicAuth = btoa(`${clientId}:${clientSecret}`);
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    scope: APP_TOKEN_SCOPE,
  });
  try {
    const res = await fetch(EBAY_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });
    const data = await res.json();
    return data.access_token ?? null;
  } catch (err: any) {
    console.error('App token fetch error:', err.message);
    return null;
  }
}

// ── XML parsing helpers ───────────────────────────────────────────────────────

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m: string, n: string) => String.fromCharCode(Number(n)))
    .trim();
}

function extractTag(xml: string, tag: string): string {
  // CDATA version
  const cdataMatch = xml.match(
    new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, 'i')
  );
  if (cdataMatch) return cdataMatch[1].trim();
  // Standard text node
  const stdMatch = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  if (stdMatch) return stdMatch[1].trim();
  return '';
}

function cleanDescription(raw: string): string {
  if (!raw) return '';
  let text = raw
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Strip eBay-injected label prefixes:
  // e.g. "TITLE: Roman Claudius ... DESCRIPTION: COIN TYPE: ..."
  const descIdx = text.search(/DESCRIPTION:\s*/i);
  if (descIdx !== -1) {
    text = text.slice(descIdx).replace(/^DESCRIPTION:\s*/i, '').trim();
  } else {
    text = text.replace(/^TITLE:\s*[^\n\r]*(\n|\r|\r\n)?/i, '').trim();
  }

  return text;
}

function secureUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  let u = url.replace(/^http:\/\//i, 'https://');
  u = u.replace(/s-l\d+\.jpg/i, 's-l500.jpg');
  return u;
}

// ── GetItem (single) for full listing details ─────────────────────────────────

async function getItemFull(
  userToken: string,
  clientId: string,
  ebayItemId: string,
): Promise<Record<string, any> | null> {
  const xmlBody = `<?xml version="1.0" encoding="utf-8"?>
<GetItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials><eBayAuthToken>${userToken}</eBayAuthToken></RequesterCredentials>
  <ItemID>${ebayItemId}</ItemID>
  <IncludeItemSpecifics>true</IncludeItemSpecifics>
  <DetailLevel>ReturnAll</DetailLevel>
</GetItemRequest>`;

  try {
    const res = await fetch(TRADING_API, {
      method: 'POST',
      headers: {
        'X-EBAY-API-SITEID': SITE_ID,
        'X-EBAY-API-COMPATIBILITY-LEVEL': '967',
        'X-EBAY-API-CALL-NAME': 'GetItem',
        'X-EBAY-API-APP-NAME': clientId,
        'Content-Type': 'text/xml',
      },
      body: xmlBody,
    });
    const xmlText = await res.text();
    if (!res.ok || xmlText.includes('<Ack>Failure</Ack>')) return null;

    // Parse full item from response
    const itemMatch = xmlText.match(/<Item[^>]*>([\s\S]*?)<\/Item>/);
    if (!itemMatch) return null;
    const itemXml = itemMatch[1];
    return parseItemXml(itemXml, 'active');
  } catch {
    return null;
  }
}

// ── Parse item XML into a structured object ───────────────────────────────────

function parseItemXml(itemXml: string, ebayStatus: string): Record<string, any> {
  const itemId = extractTag(itemXml, 'ItemID') || itemXml.match(/<ItemID>(\d+)<\/ItemID>/)?.[1] || null;
  const rawTitle = extractTag(itemXml, 'Title');
  const title = rawTitle ? decodeEntities(rawTitle) : null;

  // Price — try multiple fields in order of preference
  const priceStr =
    extractTag(itemXml, 'ActualSellingPrice') ||
    extractTag(itemXml, 'CurrentPrice') ||
    extractTag(itemXml, 'StartPrice') ||
    extractTag(itemXml, 'BuyItNowPrice') || '0';
  const price = parseFloat(priceStr.replace(/[^0-9.]/g, '')) || 0;

  // Description (may be in CDATA)
  const rawDesc = extractTag(itemXml, 'Description');
  const description = rawDesc ? cleanDescription(decodeEntities(rawDesc)).slice(0, 5000) : '';

  // Images
  const allPicUrls: string[] = [];
  const picMatches = itemXml.matchAll(/<PictureURL>([^<]+)<\/PictureURL>/g);
  for (const pm of picMatches) {
    const u = secureUrl(pm[1]);
    if (u && !allPicUrls.includes(u)) allPicUrls.push(u);
  }
  const rawGallery = extractTag(itemXml, 'GalleryURL') || extractTag(itemXml, 'PictureURL') || null;
  const galleryUrl = secureUrl(rawGallery);
  const photos = [
    ...(galleryUrl && !allPicUrls.includes(galleryUrl) ? [galleryUrl] : []),
    ...allPicUrls,
  ].slice(0, 24); // retain the full eBay gallery (up to 24 images)

  // Dates
  const listedAt = extractTag(itemXml, 'StartTime') || null;
  const endedAt = extractTag(itemXml, 'EndTime') || null;

  // Shipping
  const shippingCostStr = extractTag(itemXml, 'ShippingServiceCost') || extractTag(itemXml, 'ShippingCost') || '0';
  const shippingCost = parseFloat(shippingCostStr) || 0;
  const shippingService = extractTag(itemXml, 'ShippingService') || '';
  const dispatchTimeMax = parseInt(extractTag(itemXml, 'DispatchTimeMax') || '0') || 0;
  const freeShipping = itemXml.includes('<FreeShipping>true</FreeShipping>') || shippingCost === 0;

  // Listing format & duration
  const listingType = extractTag(itemXml, 'ListingType') || 'FixedPriceItem';
  const listingDuration = extractTag(itemXml, 'ListingDuration') || '';

  // Condition
  const conditionId = extractTag(itemXml, 'ConditionID') || '';
  const conditionDisplayName = extractTag(itemXml, 'ConditionDisplayName') || '';
  const conditionDescription = extractTag(itemXml, 'ConditionDescription') || '';

  // Category
  const categoryId = extractTag(itemXml, 'CategoryID') || '';
  const categoryName = extractTag(itemXml, 'CategoryName') || decodeEntities(extractTag(itemXml, 'CategoryName') || '');

  // Quantity
  const quantityStr = extractTag(itemXml, 'Quantity') || '1';
  const quantitySoldStr = extractTag(itemXml, 'QuantitySold') || '0';
  const quantity = parseInt(quantityStr) || 1;
  const quantitySold = parseInt(quantitySoldStr) || 0;

  // Watchers / views
  const watchCountStr = extractTag(itemXml, 'WatchCount') || '0';
  const hitCountStr = extractTag(itemXml, 'HitCount') || '0';
  const watchCount = parseInt(watchCountStr) || 0;
  const hitCount = parseInt(hitCountStr) || 0;

  // Returns policy
  const returnsAccepted = extractTag(itemXml, 'ReturnsAcceptedOption') || '';
  const returnsWithin = extractTag(itemXml, 'ReturnsWithinOption') || '';
  const refundOption = extractTag(itemXml, 'RefundOption') || '';
  const returnsPolicyDescription = [returnsAccepted, returnsWithin, refundOption].filter(Boolean).join(', ');

  // Item Specifics — parse all name/value pairs
  const itemSpecifics: Array<{ name: string; value: string }> = [];
  const nameValueMatches = itemXml.matchAll(/<NameValueList[^>]*>([\s\S]*?)<\/NameValueList>/g);
  for (const nvm of nameValueMatches) {
    const nvXml = nvm[1];
    const name = decodeEntities(extractTag(nvXml, 'Name'));
    const value = decodeEntities(extractTag(nvXml, 'Value'));
    if (name && value) {
      itemSpecifics.push({ name, value });
    }
  }

  // Best offer
  const bestOfferEnabled = itemXml.includes('<BestOfferEnabled>true</BestOfferEnabled>');
  const minimumBestOffer = parseFloat(extractTag(itemXml, 'MinimumBestOfferPrice') || '0') || 0;

  // Currency
  const currency = itemXml.match(/currencyID="([^"]+)"/)?.[1] || 'GBP';

  // SKU
  const sku = extractTag(itemXml, 'SKU') || '';

  // Subtitle
  const subtitle = decodeEntities(extractTag(itemXml, 'SubTitle') || '');

  // Keywords / search terms (eBay doesn't expose directly, derive from title)
  const keywords: string[] = [];

  return {
    itemId,
    title,
    subtitle,
    price,
    description,
    galleryUrl,
    photos,
    listedAt,
    endedAt,
    shippingCost,
    shippingService,
    dispatchTimeMax,
    freeShipping,
    listingType,
    listingDuration,
    conditionId,
    conditionDisplayName,
    conditionDescription,
    categoryId,
    categoryName,
    quantity,
    quantitySold,
    watchCount,
    hitCount,
    returnsPolicy: returnsPolicyDescription,
    itemSpecifics,
    bestOfferEnabled,
    minimumBestOffer,
    currency,
    sku,
    keywords,
    ebayStatus,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const { tenantId, listingId, externalListingId, route, limit } = body;

  if (!tenantId) return json({ error: 'tenantId is required' }, 400);

  const supabase = adminClient();

  // Security: verify caller belongs to tenant — HARDENED
  // Missing auth = 401, anon key = 401, invalid JWT = 401, non-member = 403.
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return json({ error: 'Authentication required. Please sign in to SWISH.' }, 401);
  }
  const authToken = authHeader.replace('Bearer ', '').trim();
  if (!authToken || authToken === Deno.env.get('SUPABASE_ANON_KEY')) {
    return json({ error: 'Authentication required. Please sign in to SWISH.' }, 401);
  }
  try {
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: uErr } = await userClient.auth.getUser();
    if (uErr || !user) {
      return json({ error: 'Invalid or expired authentication token. Please sign in again.' }, 401);
    }
    const { data: member } = await supabase.from('tenant_memberships').select('id').eq('tenant_id', tenantId).eq('user_id', user.id).maybeSingle();
    if (!member) {
      console.warn(`[SWISH Security] User ${user.id} attempted to access tenant ${tenantId} — not a member`);
      return json({ error: 'Access denied: you are not a member of this organisation.' }, 403);
    }
  } catch (e: any) {
    console.error(`[SWISH Security] JWT verification error: ${e.message}`);
    return json({ error: 'Authentication verification failed. Please sign in again.' }, 401);
  }

  // ── Get connector credentials ─────────────────────────────────────────────
  const { data: connector, error: fetchErr } = await supabase
    .from('marketplace_connectors')
    .select('credential_ref, status')
    .eq('tenant_id', tenantId)
    .eq('marketplace_id', 'ebay')
    .maybeSingle();

  if (fetchErr || !connector?.credential_ref) {
    return json({ error: 'eBay connector not found or not configured' }, 404);
  }

  if (connector.status !== 'connected' && connector.status !== 'requires_reauth') {
    return json({ error: 'eBay connector is not connected. Please connect eBay in Marketplaces.' }, 400);
  }

  let credentials: { clientId: string; clientSecret: string; accessToken?: string; refreshToken?: string; expiresAt?: string };
  try {
    credentials = await decryptCredentials(connector.credential_ref) as any;
  } catch {
    return json({ error: 'Could not parse stored credentials' }, 500);
  }

  if (!credentials.clientId || !credentials.clientSecret) {
    return json({ error: 'Stored credentials are incomplete' }, 400);
  }

  // ── Auto-refresh user token if expired ────────────────────────────────────
  const needsUserToken = route === 'my_active_listings' || route === 'fetch_item_images' || route === 'count_active_listings' || route === 'get_item_full';
  if (needsUserToken && credentials.accessToken && credentials.refreshToken) {
    const bufferMs = 5 * 60 * 1000;
    const expiresAt = credentials.expiresAt;
    const isExpired = expiresAt ? Date.now() + bufferMs >= new Date(expiresAt).getTime() : false;
    if (isExpired) {
      console.log('[eBay Auth] Access token expired — attempting refresh...');
      try {
        const { accessToken: newToken, expiresAt: newExpiry } = await refreshUserToken(
          credentials.clientId, credentials.clientSecret, credentials.refreshToken,
        );
        const updatedRef = await encryptCredentials({ ...credentials, accessToken: newToken, expiresAt: newExpiry });
        await supabase
          .from('marketplace_connectors')
          .update({ credential_ref: updatedRef, access_token_expires_at: newExpiry, status: 'connected', last_error: null, updated_at: new Date().toISOString() })
          .eq('tenant_id', tenantId).eq('marketplace_id', 'ebay');
        credentials = { ...credentials, accessToken: newToken, expiresAt: newExpiry };
        console.log('[eBay Auth] Token refreshed successfully');
      } catch (refreshErr: any) {
        console.log(`[eBay Auth] Token refresh failed: ${refreshErr.message}`);
        await supabase
          .from('marketplace_connectors')
          .update({ status: 'requires_reauth', last_error: `Token refresh failed: ${refreshErr.message}`, updated_at: new Date().toISOString() })
          .eq('tenant_id', tenantId).eq('marketplace_id', 'ebay');
        return json({
          error: 'eBay re-authorisation required. Please reconnect eBay in Marketplaces.',
          requiresReauth: true,
        }, 401);
      }
    }
  }

  // ── Route: get_item_full — fetch complete listing details via GetItem ──────
  if (route === 'get_item_full') {
    const { ebayItemId } = body;
    if (!ebayItemId) return json({ error: 'ebayItemId is required' }, 400);
    const userToken = credentials.accessToken;
    if (!userToken) return json({ error: 'No eBay user OAuth token found.' }, 400);

    const item = await getItemFull(userToken, credentials.clientId, ebayItemId);
    if (!item) return json({ error: `Could not fetch eBay item ${ebayItemId}` }, 404);
    return json({ item });
  }

  // ── Route: bulk fetch picture URLs for specific eBay item IDs ──────────────
  // BUG C FIX: Return ALL PictureURL elements per item (up to 12),
  // not just the first one. Also returns the full array per item ID.
  if (route === 'fetch_item_images') {
    const { itemIds } = body;
    if (!Array.isArray(itemIds) || itemIds.length === 0) {
      return json({ error: 'itemIds array is required' }, 400);
    }

    const userToken = credentials.accessToken;
    if (!userToken) {
      return json({ error: 'No eBay user OAuth token found.' }, 400);
    }

    // Return: { results: { [ebayItemId]: string[] } } — all URLs per item
    const results: Record<string, string[]> = {};

    // Process in batches of 20
    const batches: string[][] = [];
    for (let i = 0; i < itemIds.length; i += 20) {
      batches.push(itemIds.slice(i, i + 20));
    }

    for (const batch of batches) {
      const itemIdXml = batch.map(id => `<ItemID>${id}</ItemID>`).join('');
      const xmlBody = `<?xml version="1.0" encoding="utf-8"?>
<GetItemsRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials><eBayAuthToken>${userToken}</eBayAuthToken></RequesterCredentials>
  ${itemIdXml}
  <DetailLevel>ReturnAll</DetailLevel>
</GetItemsRequest>`;

      try {
        const res = await fetch(TRADING_API, {
          method: 'POST',
          headers: {
            'X-EBAY-API-SITEID': SITE_ID,
            'X-EBAY-API-COMPATIBILITY-LEVEL': '967',
            'X-EBAY-API-CALL-NAME': 'GetItems',
            'X-EBAY-API-APP-NAME': credentials.clientId,
            'Content-Type': 'text/xml',
          },
          body: xmlBody,
        });

        const xmlText = await res.text();
        const itemMatches = xmlText.matchAll(/<Item[^>]*>([\s\S]*?)<\/Item>/g);
        for (const m of itemMatches) {
          const itemXml = m[1];
          const itemId = itemXml.match(/<ItemID>(\d+)<\/ItemID>/)?.[1];
          if (!itemId) continue;

          // Extract ALL PictureURL elements — BUG C FIX: was only getting first one
          const urls: string[] = [];
          for (const pm of itemXml.matchAll(/<PictureURL>([^<]+)<\/PictureURL>/g)) {
            const u = secureUrl(pm[1]);
            if (u && !urls.includes(u)) urls.push(u);
          }
          // Fallback to GalleryURL only if no PictureURL found
          if (urls.length === 0) {
            const g = itemXml.match(/<GalleryURL>([^<]+)<\/GalleryURL>/)?.[1];
            if (g) { const sg = secureUrl(g); if (sg) urls.push(sg); }
          }
          results[itemId] = urls.slice(0, 12);
        }

        // Fallback: GetItem for missing items
        for (const id of batch) {
          if (id in results) continue;
          try {
            const singleXml = `<?xml version="1.0" encoding="utf-8"?>
<GetItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials><eBayAuthToken>${userToken}</eBayAuthToken></RequesterCredentials>
  <ItemID>${id}</ItemID>
  <IncludeItemSpecifics>false</IncludeItemSpecifics>
  <DetailLevel>ReturnAll</DetailLevel>
</GetItemRequest>`;
            const singleRes = await fetch(TRADING_API, {
              method: 'POST',
              headers: {
                'X-EBAY-API-SITEID': SITE_ID,
                'X-EBAY-API-COMPATIBILITY-LEVEL': '967',
                'X-EBAY-API-CALL-NAME': 'GetItem',
                'X-EBAY-API-APP-NAME': credentials.clientId,
                'Content-Type': 'text/xml',
              },
              body: singleXml,
            });
            const singleXmlText = await singleRes.text();
            const urls: string[] = [];
            for (const pm of singleXmlText.matchAll(/<PictureURL>([^<]+)<\/PictureURL>/g)) {
              const u = secureUrl(pm[1]);
              if (u && !urls.includes(u)) urls.push(u);
            }
            if (urls.length === 0) {
              const g = singleXmlText.match(/<GalleryURL>([^<]+)<\/GalleryURL>/)?.[1];
              if (g) { const sg = secureUrl(g); if (sg) urls.push(sg); }
            }
            results[id] = urls.slice(0, 12);
          } catch {
            results[id] = [];
          }
        }
      } catch (e: any) {
        console.error(`GetItems batch error: ${e.message}`);
        for (const id of batch) {
          if (!(id in results)) results[id] = [];
        }
      }
    }

    return json({ results });
  }

  // ── Route: count active eBay listings ─────────────────────────────────────
  if (route === 'count_active_listings') {
    const userToken = credentials.accessToken;
    if (!userToken) return json({ count: 0, error: 'No eBay access token' });

    try {
      const xmlBody = `<?xml version="1.0" encoding="utf-8"?>
<GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials><eBayAuthToken>${userToken}</eBayAuthToken></RequesterCredentials>
  <ActiveList>
    <Include>true</Include>
    <Pagination><EntriesPerPage>1</EntriesPerPage><PageNumber>1</PageNumber></Pagination>
  </ActiveList>
  <DetailLevel>ReturnSummary</DetailLevel>
</GetMyeBaySellingRequest>`;

      const res = await fetch(TRADING_API, {
        method: 'POST',
        headers: {
          'X-EBAY-API-SITEID': SITE_ID,
          'X-EBAY-API-COMPATIBILITY-LEVEL': '967',
          'X-EBAY-API-CALL-NAME': 'GetMyeBaySelling',
          'X-EBAY-API-APP-NAME': credentials.clientId,
          'Content-Type': 'text/xml',
        },
        body: xmlBody,
      });

      const xmlText = await res.text();
      const totalEntries = parseInt(
        xmlText.match(/<TotalNumberOfEntries>(\d+)<\/TotalNumberOfEntries>/)?.[1] ?? '0'
      );
      return json({ count: totalEntries });
    } catch (e: any) {
      console.error('count_active_listings error:', e.message);
      return json({ count: 0 });
    }
  }

  // ── Route: fetch seller active listings for import ────────────────────────
  if (route === 'my_active_listings') {
    const userToken = credentials.accessToken;
    if (!userToken) {
      return json({ error: 'No eBay user OAuth token found. Please complete eBay OAuth in Marketplaces first.' }, 400);
    }

    const fetchLimit = Math.min(Number(limit ?? 200), 400);

    // Parse items out of a GetMyeBaySelling XML block
    function parseListingItems(xmlText: string, ebayStatus: string): any[] {
      const results: any[] = [];
      const itemMatches = xmlText.matchAll(/<Item[^>]*>([\s\S]*?)<\/Item>/g);
      for (const match of itemMatches) {
        const itemXml = match[1];
        const parsed = parseItemXml(itemXml, ebayStatus);
        if (parsed.itemId && parsed.title && parsed.title.length > 0) {
          results.push(parsed);
        }
      }
      return results;
    }

    // Helper: fetch one page of GetMyeBaySelling
    async function fetchSellingPage(listSection: string, pageNum: number): Promise<{ items: any[]; totalPages: number }> {
      // Use ReturnAll to get descriptions, item specifics, condition, shipping
      const xmlBody = `<?xml version="1.0" encoding="utf-8"?>
<GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials>
    <eBayAuthToken>${userToken}</eBayAuthToken>
  </RequesterCredentials>
  <${listSection}>
    <Include>true</Include>
    <IncludeItemSpecifics>true</IncludeItemSpecifics>
    <Pagination>
      <EntriesPerPage>100</EntriesPerPage>
      <PageNumber>${pageNum}</PageNumber>
    </Pagination>
    <Sort>TimeLeft</Sort>
  </${listSection}>
  <DetailLevel>ReturnAll</DetailLevel>
  <ErrorLanguage>en_US</ErrorLanguage>
  <WarningLevel>High</WarningLevel>
</GetMyeBaySellingRequest>`;

      const tradingRes = await fetch(TRADING_API, {
        method: 'POST',
        headers: {
          'X-EBAY-API-SITEID': SITE_ID,
          'X-EBAY-API-COMPATIBILITY-LEVEL': '967',
          'X-EBAY-API-CALL-NAME': 'GetMyeBaySelling',
          'X-EBAY-API-APP-NAME': credentials.clientId,
          'Content-Type': 'text/xml',
        },
        body: xmlBody,
      });

      const xmlText = await tradingRes.text();
      const totalPages = parseInt(xmlText.match(/<TotalNumberOfPages>(\d+)<\/TotalNumberOfPages>/)?.[1] ?? '1');
      const ebayStatus =
        listSection === 'ActiveList' ? 'active'
        : listSection === 'SoldList' ? 'sold'
        : 'ended';
      return { items: parseListingItems(xmlText, ebayStatus), totalPages };
    }

    // For items where GetMyeBaySelling returned empty description,
    // fetch full details via GetItem (batched via GetItems for efficiency)
    async function enrichDescriptions(items: any[]): Promise<any[]> {
      const noDesc = items.filter(i => !i.description || i.description.trim().length < 10);
      if (noDesc.length === 0) return items;

      console.log(`[eBay Import] Enriching descriptions for ${noDesc.length} items via GetItem...`);

      // Use GetItems in batches of 20
      const enriched = new Map<string, string>();
      const batches: string[][] = [];
      for (let i = 0; i < noDesc.length; i += 20) {
        batches.push(noDesc.slice(i, i + 20).map((x: any) => x.itemId));
      }

      for (const batch of batches) {
        const itemIdXml = batch.map((id: string) => `<ItemID>${id}</ItemID>`).join('');
        const xmlBody = `<?xml version="1.0" encoding="utf-8"?>
<GetItemsRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials><eBayAuthToken>${userToken}</eBayAuthToken></RequesterCredentials>
  ${itemIdXml}
  <IncludeItemSpecifics>true</IncludeItemSpecifics>
  <DetailLevel>ReturnAll</DetailLevel>
</GetItemsRequest>`;

        try {
          const res = await fetch(TRADING_API, {
            method: 'POST',
            headers: {
              'X-EBAY-API-SITEID': SITE_ID,
              'X-EBAY-API-COMPATIBILITY-LEVEL': '967',
              'X-EBAY-API-CALL-NAME': 'GetItems',
              'X-EBAY-API-APP-NAME': credentials.clientId,
              'Content-Type': 'text/xml',
            },
            body: xmlBody,
          });
          const xmlText = await res.text();
          const itemMatches = xmlText.matchAll(/<Item[^>]*>([\s\S]*?)<\/Item>/g);
          for (const m of itemMatches) {
            const itemXml = m[1];
            const itemId = itemXml.match(/<ItemID>(\d+)<\/ItemID>/)?.[1];
            if (!itemId) continue;
            const fullItem = parseItemXml(itemXml, 'active');
            if (fullItem.description && fullItem.description.trim().length > 0) {
              enriched.set(itemId, fullItem.description);
            }
            // Also pick up item specifics if missing
            if (fullItem.itemSpecifics && fullItem.itemSpecifics.length > 0) {
              enriched.set(`${itemId}_specifics`, JSON.stringify(fullItem.itemSpecifics));
            }
            if (fullItem.conditionDisplayName) {
              enriched.set(`${itemId}_condition`, fullItem.conditionDisplayName);
            }
            if (fullItem.categoryId) {
              enriched.set(`${itemId}_categoryId`, fullItem.categoryId);
            }
            if (fullItem.categoryName) {
              enriched.set(`${itemId}_categoryName`, fullItem.categoryName);
            }
            if (fullItem.photos && fullItem.photos.length > 0) {
              enriched.set(`${itemId}_photos`, JSON.stringify(fullItem.photos));
            }
          }
        } catch (e: any) {
          console.error(`GetItems description enrichment error: ${e.message}`);
        }
      }

      // Merge enriched data back into items
      return items.map((item: any) => {
        const desc = enriched.get(item.itemId);
        const specificsStr = enriched.get(`${item.itemId}_specifics`);
        const condition = enriched.get(`${item.itemId}_condition`);
        const categoryId = enriched.get(`${item.itemId}_categoryId`);
        const categoryName = enriched.get(`${item.itemId}_categoryName`);
        const photosStr = enriched.get(`${item.itemId}_photos`);
        return {
          ...item,
          ...(desc ? { description: desc } : {}),
          ...(specificsStr ? { itemSpecifics: JSON.parse(specificsStr) } : {}),
          ...(condition ? { conditionDisplayName: condition } : {}),
          ...(categoryId ? { categoryId } : {}),
          ...(categoryName ? { categoryName } : {}),
          ...(photosStr ? { photos: JSON.parse(photosStr) } : {}),
        };
      });
    }

    const listings: any[] = [];

    // Fetch active listings (all pages)
    try {
      let pageNum = 1;
      let hasMore = true;
      while (hasMore && listings.length < fetchLimit) {
        const { items, totalPages } = await fetchSellingPage('ActiveList', pageNum);
        listings.push(...items);
        hasMore = pageNum < totalPages && items.length > 0;
        pageNum++;
        if (items.length === 0) hasMore = false;
      }
    } catch (e: any) {
      console.error('ActiveList fetch error:', e.message);
    }

    // Fetch sold listings (page 1 only for speed)
    try {
      const { items: soldItems } = await fetchSellingPage('SoldList', 1);
      listings.push(...soldItems);
    } catch (e: any) {
      console.error('SoldList fetch error:', e.message);
    }

    // Fetch ended listings (page 1 only)
    try {
      const { items: endedItems } = await fetchSellingPage('UnsoldList', 1);
      listings.push(...endedItems.map((i: any) => ({ ...i, ebayStatus: 'ended' })));
    } catch (e: any) {
      console.error('UnsoldList fetch error:', e.message);
    }

    // Enrich items that are missing descriptions / item specifics
    const enriched = await enrichDescriptions(listings);

    return json({ listings: enriched, total: enriched.length });
  }

  // ── Route: search_by_image — eBay Browse API visual search ─────────────────
  // POST /item_summary/search_by_image
  // Accepts base64 image, returns visually similar eBay GB listings.
  // Credentials: eBay Application Token (client credentials flow — no user token needed).
  if (route === 'search_by_image') {
    const { imageBase64, categoryId, limit: imgLimit } = body;
    if (!imageBase64 || typeof imageBase64 !== 'string' || imageBase64.length < 100) {
      return json({ error: 'imageBase64 is required and must be a non-empty string' }, 400);
    }

    // Get app token (client credentials — no user token needed for Browse API)
    const appToken = await getApplicationToken(credentials.clientId, credentials.clientSecret);
    if (!appToken) {
      return json({ error: 'Could not obtain eBay application token for visual search', items: [], available: false }, 200);
    }

    // Clean base64 — strip data URI prefix if present
    const cleanB64 = imageBase64
      .replace(/^data:image\/[a-zA-Z]+;base64,/, '')
      .replace(/\s/g, '');

    const maxResults = Math.min(Number(imgLimit ?? 10), 20);

    // Build query params
    const params = new URLSearchParams({
      limit: String(maxResults),
      fieldgroups: 'MATCHING_ITEMS,ASPECT_REFINEMENTS',
    });
    if (categoryId) {
      params.set('category_ids', String(categoryId));
    }

    const searchByImageUrl = `${EBAY_BROWSE_BASE}/item_summary/search_by_image?${params.toString()}`;

    console.log(`[swish-ebay-browse] search_by_image: EBAY_GB, maxResults=${maxResults}, categoryFilter=${categoryId ?? 'none'}`);

    try {
      const browseResp = await fetch(searchByImageUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${appToken}`,
          'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB',
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({ image: cleanB64 }),
        signal: AbortSignal.timeout(15000),
      });

      if (!browseResp.ok) {
        const errText = await browseResp.text();
        console.warn(`[swish-ebay-browse] search_by_image HTTP ${browseResp.status}: ${errText.slice(0, 300)}`);
        // Return graceful failure — not a hard error for the client
        return json({
          available: false,
          items: [],
          totalResults: 0,
          error: `eBay visual search returned ${browseResp.status}`,
          marketplace: 'EBAY_GB',
        }, 200);
      }

      const searchData = await browseResp.json();
      const rawItems: any[] = searchData.itemSummaries ?? [];
      const totalResults = Number(searchData.total ?? rawItems.length);

      // Extract category distribution from aspect refinements
      const categoryDistribution: Array<{ id: string; name: string; count: number }> = [];
      const refinements = searchData.refinement?.aspectDistributions ?? [];
      for (const aspect of refinements) {
        if ((aspect.localizedAspectName ?? '').toLowerCase().includes('category') ||
            (aspect.localizedAspectName ?? '').toLowerCase().includes('type')) {
          for (const bucket of (aspect.aspectValueDistributions ?? []).slice(0, 5)) {
            categoryDistribution.push({
              id: bucket.refinementHref?.match(/category_ids=([^&]+)/)?.[1] ?? '',
              name: bucket.localizedAspectValue ?? '',
              count: Number(bucket.matchCount ?? 0),
            });
          }
        }
      }

      // Sanitise and normalise items
      const items = rawItems.slice(0, maxResults).map((item: any, idx: number) => ({
        rank: idx + 1,
        itemId: item.itemId ?? '',
        title: item.title ?? '',
        price: {
          value: Number(item.price?.value ?? 0),
          currency: item.price?.currency ?? 'GBP',
        },
        image: item.image?.imageUrl ?? item.thumbnailImages?.[0]?.imageUrl ?? null,
        condition: item.condition ?? '',
        conditionId: item.conditionId ?? '',
        listingStatus: item.itemWebUrl ? 'active' : 'unknown',
        categories: (item.categories ?? []).map((c: any) => ({
          id: c.categoryId ?? '',
          name: c.categoryName ?? '',
        })),
        primaryCategoryId: item.categories?.[0]?.categoryId ?? '',
        primaryCategoryName: item.categories?.[0]?.categoryName ?? '',
        itemWebUrl: item.itemWebUrl ?? null,
        seller: item.seller?.username ?? null,
        buyingOptions: item.buyingOptions ?? [],
        shortDescription: item.shortDescription ?? null,
      }));

      // Determine the most common category from results
      const catCounts: Record<string, { id: string; name: string; count: number }> = {};
      for (const item of items) {
        if (item.primaryCategoryId) {
          const key = item.primaryCategoryId;
          catCounts[key] = catCounts[key] ?? { id: key, name: item.primaryCategoryName, count: 0 };
          catCounts[key].count++;
        }
      }
      const topCategory = Object.values(catCounts).sort((a, b) => b.count - a.count)[0] ?? null;

      console.log(`[swish-ebay-browse] search_by_image: ${items.length}/${totalResults} items, topCat=${topCategory?.name ?? 'none'}`);

      return json({
        available: true,
        items,
        totalResults,
        topCategory,
        categoryDistribution,
        marketplace: 'EBAY_GB',
        retrievedAt: new Date().toISOString(),
      });
    } catch (e: any) {
      console.error(`[swish-ebay-browse] search_by_image error: ${e.message}`);
      return json({
        available: false,
        items: [],
        totalResults: 0,
        error: `Visual search failed: ${e.message}`,
        marketplace: 'EBAY_GB',
      }, 200);
    }
  }

  // ── Default route: fetch views/watchers for a single listing ─────────────
  if (!externalListingId) {
    return json({ error: 'externalListingId required for stats route' }, 400);
  }

  const appToken = await getApplicationToken(credentials.clientId, credentials.clientSecret);
  if (!appToken) {
    return json({ error: 'Could not obtain eBay application token — check App ID and Cert ID' }, 502);
  }

  const itemRef = `v1|${externalListingId}|0`;
  let views = 0;
  let watchers = 0;

  try {
    const browseRes = await fetch(`${EBAY_BROWSE_BASE}/item/${encodeURIComponent(itemRef)}`, {
      headers: {
        'Authorization': `Bearer ${appToken}`,
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB',
        'Content-Type': 'application/json',
      },
    });

    if (browseRes.ok) {
      const itemData = await browseRes.json();
      watchers = Number(itemData.watchCount ?? 0);
      views = 0;
    }
  } catch (err: any) {
    console.error('Browse API fetch error:', err.message);
  }

  if (listingId) {
    await supabase
      .from('listings')
      .update({
        watchers,
        ...(views > 0 ? { views } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq('id', listingId);
  }

  return json({ views, watchers });
});
