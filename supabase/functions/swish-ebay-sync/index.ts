// SWISH — eBay Full Sync Edge Function
//
// Performs a complete eBay ↔ SWISH data reconciliation (NO image downloads).
// Image downloading is handled separately by swish-image-download to avoid timeouts.
//
// This function:
//   1. Auto-refreshes eBay access token if expired
//   2. Fetches ALL current eBay seller listings (paginated)
//   3. Updates each SWISH item with title, description, condition, category,
//      item specifics, price, shipping, views, watchers, status, coin fields
//   4. Stores eBay CDN image URLs directly (no HTTP download) so images show immediately
//   5. Reports per-item success/failure — never aborts on single failure
//
// POST body:
//   { tenantId: string, mode?: 'full' | 'data_only' | 'refresh_token_only', itemIds?: string[] }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { encryptCredentials, decryptCredentials } from '../_shared/credentialCrypto.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const EBAY_TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token';
const TRADING_API = 'https://api.ebay.com/ws/api.dll';
const SITE_ID = '3';

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

/** True ONLY if this is a permanently stored Supabase/OnSpace Storage URL. */
function isStorageUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  return (url.includes('supabase') && url.includes('storage')) ||
         (url.includes('onspace') && url.includes('storage'));
}

/** True if this is an eBay CDN URL — never permanently stored. */
function isEbayCdnUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  return url.includes('ebayimg.com') ||
         url.includes('thumbs.ebaystatic.com') ||
         url.includes('i.ebayimg.com') ||
         url.includes('p.ebayimg.com');
}

function secureUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  // Upgrade to HTTPS, use largest available image size
  return url.replace(/^http:\/\//i, 'https://').replace(/s-l\d+\.(jpg|jpeg)/i, 's-l1600.jpg');
}

// ── Token refresh ─────────────────────────────────────────────────────────────

async function refreshToken(clientId: string, clientSecret: string, rToken: string): Promise<{ accessToken: string; expiresAt: string }> {
  const basicAuth = btoa(`${clientId}:${clientSecret}`);
  const resp = await fetch(EBAY_TOKEN_URL, {
    method: 'POST',
    headers: { Authorization: `Basic ${basicAuth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: rToken,
    }).toString(),
  });
  const data = await resp.json();
  if (!data.access_token) throw new Error(`Token refresh failed: ${data.error_description ?? data.error ?? 'unknown'}`);
  return { accessToken: data.access_token, expiresAt: new Date(Date.now() + (data.expires_in ?? 7200) * 1000).toISOString() };
}

async function getValidToken(supabase: ReturnType<typeof adminClient>, tenantId: string): Promise<{ token: string; clientId: string; creds: any }> {
  const { data: conn } = await supabase
    .from('marketplace_connectors')
    .select('credential_ref, status, access_token_expires_at')
    .eq('tenant_id', tenantId).eq('marketplace_id', 'ebay').maybeSingle();

  if (!conn?.credential_ref) throw new Error('REQUIRES_REAUTH: eBay not connected');

  let creds: any;
  try { creds = await decryptCredentials(conn.credential_ref); } catch (e: any) { throw new Error(`REQUIRES_REAUTH: eBay credentials malformed: ${e.message}`); }

  if (!creds.accessToken) throw new Error('REQUIRES_REAUTH: No access token');

  const expiresAt = creds.expiresAt ?? conn.access_token_expires_at;
  const expired = expiresAt ? Date.now() + 5 * 60_000 >= new Date(expiresAt).getTime() : false;

  if (expired && creds.refreshToken) {
    try {
      const { accessToken, expiresAt: newExp } = await refreshToken(creds.clientId, creds.clientSecret, creds.refreshToken);
      const updatedRef = await encryptCredentials({ ...creds, accessToken, expiresAt: newExp });
      await supabase.from('marketplace_connectors').update({
        credential_ref: updatedRef, access_token_expires_at: newExp,
        status: 'connected', last_error: null, updated_at: new Date().toISOString(),
      }).eq('tenant_id', tenantId).eq('marketplace_id', 'ebay');
      creds = { ...creds, accessToken, expiresAt: newExp };
      console.log('[EbaySync] Token refreshed successfully');
    } catch (e: any) {
      await supabase.from('marketplace_connectors').update({ status: 'requires_reauth', last_error: 'Token refresh failed', updated_at: new Date().toISOString() })
        .eq('tenant_id', tenantId).eq('marketplace_id', 'ebay');
      throw new Error(`REQUIRES_REAUTH: Token refresh failed: ${e.message}`);
    }
  } else if (expired) {
    await supabase.from('marketplace_connectors').update({ status: 'requires_reauth', last_error: 'Token expired', updated_at: new Date().toISOString() })
      .eq('tenant_id', tenantId).eq('marketplace_id', 'ebay');
    throw new Error('REQUIRES_REAUTH: Token expired and no refresh token');
  }

  return { token: creds.accessToken, clientId: creds.clientId, creds };
}

// ── XML helpers ───────────────────────────────────────────────────────────────

function extractTag(xml: string, tag: string): string {
  const cd = xml.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, 'i'));
  if (cd) return cd[1].trim();
  const std = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return std ? std[1].trim() : '';
}

function decodeEnt(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").trim();
}

function cleanHtml(raw: string): string {
  if (!raw) return '';
  let text = raw
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Strip eBay-injected label prefixes:
  // e.g. "TITLE: Roman Claudius ... DESCRIPTION: COIN TYPE: ..."
  // Strip everything up to and including the DESCRIPTION: marker if present
  const descIdx = text.search(/DESCRIPTION:\s*/i);
  if (descIdx !== -1) {
    text = text.slice(descIdx).replace(/^DESCRIPTION:\s*/i, '').trim();
  } else {
    // No DESCRIPTION: marker — just strip a bare leading TITLE: line
    text = text.replace(/^TITLE:\s*[^\n\r]*(\n|\r|\r\n)?/i, '').trim();
  }

  return text.slice(0, 8000);
}

function isAuthError(xml: string): boolean {
  return xml.includes('hardExpired') || xml.includes('auth-token-expired') ||
    xml.includes('IAF_INVALID_TOKEN') || xml.includes('IAF_EXPIRED') ||
    xml.includes('<ErrorCode>931<') || xml.includes('<ErrorCode>932<') ||
    xml.includes('<ErrorCode>16110<') || xml.includes('<ErrorCode>16111<');
}

// ── Parse a single <Item> XML block ──────────────────────────────────────────

interface EbayItemData {
  ebayItemId: string;
  title: string;
  subtitle: string;
  description: string;
  price: number;
  currency: string;
  conditionId: string;
  conditionDisplayName: string;
  conditionDescription: string;
  categoryId: string;
  categoryName: string;
  listingType: string;
  listingDuration: string;
  quantity: number;
  quantitySold: number;
  watchCount: number;
  hitCount: number;
  shippingCost: number;
  shippingService: string;
  freeShipping: boolean;
  dispatchTimeMax: number;
  returnsPolicy: string;
  sku: string;
  bestOfferEnabled: boolean;
  photos: string[];
  galleryUrl: string | null;
  listedAt: string | null;
  endedAt: string | null;
  ebayStatus: 'active' | 'sold' | 'ended';
  itemSpecifics: Array<{ name: string; value: string }>;
}

function parseItemXml(itemXml: string, defaultStatus: 'active' | 'sold' | 'ended' = 'active'): EbayItemData | null {
  try {
    const ebayItemId = extractTag(itemXml, 'ItemID') || itemXml.match(/<ItemID>(\d+)<\/ItemID>/)?.[1] || '';
    if (!ebayItemId) return null;

    const title = decodeEnt(extractTag(itemXml, 'Title') || '');
    if (!title) return null;

    const priceStr = extractTag(itemXml, 'CurrentPrice') || extractTag(itemXml, 'StartPrice') || extractTag(itemXml, 'BuyItNowPrice') || '0';
    const price = parseFloat(priceStr.replace(/[^0-9.]/g, '')) || 0;

    const rawDesc = extractTag(itemXml, 'Description');
    const description = rawDesc ? cleanHtml(decodeEnt(rawDesc)) : '';

    // Collect all picture URLs
    const photos: string[] = [];
    for (const m of itemXml.matchAll(/<PictureURL>([^<]+)<\/PictureURL>/g)) {
      const u = secureUrl(m[1].trim());
      if (u && !photos.includes(u)) photos.push(u);
    }
    const rawGallery = extractTag(itemXml, 'GalleryURL') || '';
    const galleryUrl = secureUrl(rawGallery);
    if (galleryUrl && !photos.includes(galleryUrl)) photos.unshift(galleryUrl);

    const itemSpecifics: Array<{ name: string; value: string }> = [];
    for (const nvm of itemXml.matchAll(/<NameValueList[^>]*>([\s\S]*?)<\/NameValueList>/g)) {
      const name = decodeEnt(extractTag(nvm[1], 'Name'));
      const value = decodeEnt(extractTag(nvm[1], 'Value'));
      if (name && value) itemSpecifics.push({ name, value });
    }

    const returnsAccepted = extractTag(itemXml, 'ReturnsAcceptedOption');
    const returnsWithin = extractTag(itemXml, 'ReturnsWithinOption');
    const refundOption = extractTag(itemXml, 'RefundOption');

    return {
      ebayItemId,
      title,
      subtitle: decodeEnt(extractTag(itemXml, 'SubTitle') || ''),
      description,
      price,
      currency: itemXml.match(/currencyID="([^"]+)"/)?.[1] || 'GBP',
      conditionId: extractTag(itemXml, 'ConditionID'),
      conditionDisplayName: extractTag(itemXml, 'ConditionDisplayName'),
      conditionDescription: extractTag(itemXml, 'ConditionDescription'),
      categoryId: extractTag(itemXml, 'CategoryID'),
      categoryName: decodeEnt(extractTag(itemXml, 'CategoryName') || ''),
      listingType: extractTag(itemXml, 'ListingType') || 'FixedPriceItem',
      listingDuration: extractTag(itemXml, 'ListingDuration') || '',
      quantity: parseInt(extractTag(itemXml, 'Quantity') || '1') || 1,
      quantitySold: parseInt(extractTag(itemXml, 'QuantitySold') || '0') || 0,
      watchCount: parseInt(extractTag(itemXml, 'WatchCount') || '0') || 0,
      hitCount: parseInt(extractTag(itemXml, 'HitCount') || '0') || 0,
      shippingCost: parseFloat(extractTag(itemXml, 'ShippingServiceCost') || extractTag(itemXml, 'ShippingCost') || '0') || 0,
      shippingService: extractTag(itemXml, 'ShippingService') || '',
      freeShipping: itemXml.includes('<FreeShipping>true</FreeShipping>'),
      dispatchTimeMax: parseInt(extractTag(itemXml, 'DispatchTimeMax') || '0') || 0,
      returnsPolicy: [returnsAccepted, returnsWithin, refundOption].filter(Boolean).join(', '),
      sku: extractTag(itemXml, 'SKU') || '',
      bestOfferEnabled: itemXml.includes('<BestOfferEnabled>true</BestOfferEnabled>'),
      photos: photos.slice(0, 24),
      galleryUrl,
      listedAt: extractTag(itemXml, 'StartTime') || null,
      endedAt: extractTag(itemXml, 'EndTime') || null,
      ebayStatus: defaultStatus,
      itemSpecifics,
    };
  } catch (e: any) {
    console.log(`[EbaySync] parseItemXml error: ${e.message}`);
    return null;
  }
}

// ── Fetch one page of GetMyeBaySelling ────────────────────────────────────────

async function fetchSellingPage(
  token: string, clientId: string,
  section: string, page: number, perPage = 100,
): Promise<{ items: EbayItemData[]; totalPages: number }> {
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials><eBayAuthToken>${token}</eBayAuthToken></RequesterCredentials>
  <${section}>
    <Include>true</Include>
    <IncludeItemSpecifics>true</IncludeItemSpecifics>
    <Pagination><EntriesPerPage>${perPage}</EntriesPerPage><PageNumber>${page}</PageNumber></Pagination>
    <Sort>TimeLeft</Sort>
  </${section}>
  <DetailLevel>ReturnAll</DetailLevel>
</GetMyeBaySellingRequest>`;

  const res = await fetch(TRADING_API, {
    method: 'POST',
    headers: {
      'X-EBAY-API-SITEID': SITE_ID, 'X-EBAY-API-COMPATIBILITY-LEVEL': '967',
      'X-EBAY-API-CALL-NAME': 'GetMyeBaySelling', 'X-EBAY-API-APP-NAME': clientId,
      'Content-Type': 'text/xml',
    },
    body: xml,
    signal: AbortSignal.timeout(30000),
  });

  const xmlText = await res.text();
  if (isAuthError(xmlText)) throw new Error('REQUIRES_REAUTH: Token expired mid-sync');

  const totalPages = parseInt(xmlText.match(/<TotalNumberOfPages>(\d+)<\/TotalNumberOfPages>/)?.[1] ?? '1');
  const ebayStatus: 'active' | 'sold' | 'ended' =
    section === 'SoldList' ? 'sold' : section === 'UnsoldList' ? 'ended' : 'active';

  const items: EbayItemData[] = [];
  for (const m of xmlText.matchAll(/<Item[^>]*>([\s\S]*?)<\/Item>/g)) {
    const parsed = parseItemXml(m[1], ebayStatus);
    if (parsed) items.push(parsed);
  }

  return { items, totalPages };
}

// ── Enrich missing descriptions via GetItems batch ───────────────────────────

async function enrichBatch(token: string, clientId: string, items: EbayItemData[]): Promise<EbayItemData[]> {
  const needsDesc = items.filter(i => !i.description || i.description.length < 10);
  if (!needsDesc.length) return items;

  const ids = needsDesc.map(i => i.ebayItemId);
  const BATCH = 20;
  const enriched = new Map<string, Partial<EbayItemData>>();

  for (let b = 0; b < ids.length; b += BATCH) {
    const batch = ids.slice(b, b + BATCH);
    const idsXml = batch.map(id => `<ItemID>${id}</ItemID>`).join('');
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<GetItemsRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials><eBayAuthToken>${token}</eBayAuthToken></RequesterCredentials>
  ${idsXml}
  <IncludeItemSpecifics>true</IncludeItemSpecifics>
  <DetailLevel>ReturnAll</DetailLevel>
</GetItemsRequest>`;

    try {
      const res = await fetch(TRADING_API, {
        method: 'POST',
        headers: {
          'X-EBAY-API-SITEID': SITE_ID, 'X-EBAY-API-COMPATIBILITY-LEVEL': '967',
          'X-EBAY-API-CALL-NAME': 'GetItems', 'X-EBAY-API-APP-NAME': clientId,
          'Content-Type': 'text/xml',
        },
        body: xml, signal: AbortSignal.timeout(30000),
      });
      const xmlText = await res.text();
      for (const m of xmlText.matchAll(/<Item[^>]*>([\s\S]*?)<\/Item>/g)) {
        const parsed = parseItemXml(m[1], 'active');
        if (!parsed) continue;
        enriched.set(parsed.ebayItemId, {
          description: parsed.description || undefined,
          itemSpecifics: parsed.itemSpecifics.length ? parsed.itemSpecifics : undefined,
          conditionDisplayName: parsed.conditionDisplayName || undefined,
          categoryId: parsed.categoryId || undefined,
          categoryName: parsed.categoryName || undefined,
          photos: parsed.photos.length ? parsed.photos : undefined,
        });
      }
    } catch (e: any) {
      console.log(`[EbaySync] Enrich batch ${b} error: ${e.message}`);
    }
  }

  return items.map(item => {
    const e = enriched.get(item.ebayItemId);
    if (!e) return item;
    return {
      ...item,
      description: e.description || item.description,
      itemSpecifics: e.itemSpecifics ?? item.itemSpecifics,
      conditionDisplayName: e.conditionDisplayName ?? item.conditionDisplayName,
      categoryId: e.categoryId ?? item.categoryId,
      categoryName: e.categoryName ?? item.categoryName,
      photos: e.photos ?? item.photos,
    };
  });
}

// ── Safely parse attributes field ────────────────────────────────────────────

function safeAttrs(raw: any): Record<string, string> {
  if (!raw) return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, string>;
  if (typeof raw === 'string') {
    try { const p = JSON.parse(raw); if (typeof p === 'object' && !Array.isArray(p)) return p; } catch {}
  }
  return {};
}

// ── Update a SWISH item with eBay data (DATA ONLY — pure DB writes, no HTTP) ─
// Stores eBay CDN URLs in items.media so images show immediately.
// Actual image downloading to Supabase Storage is done by swish-image-download.

async function syncItemToSwish(
  supabase: ReturnType<typeof adminClient>,
  ebay: EbayItemData,
  existingItem: any,
): Promise<{ imageUrlsStored: number; titleFixed: boolean; updated: boolean; error?: string }> {
  let imageUrlsStored = 0;
  let titleFixed = false;

  try {
    const itemUpdates: Record<string, any> = { updated_at: new Date().toISOString() };

    // ── Title: eBay is authoritative — always sync ──────────────────────────
    if (ebay.title && ebay.title.length > 3) {
      const existingTitle = (existingItem.canonical_title ?? '').trim();
      if (!existingTitle || existingTitle.length < 5 ||
          existingTitle === 'Untitled' || existingTitle.startsWith('Title pending')) {
        itemUpdates.canonical_title = ebay.title;
        titleFixed = true;
      } else if (existingTitle !== ebay.title) {
        itemUpdates.canonical_title = ebay.title;
        titleFixed = true;
      }
    }

    // ── Description ─────────────────────────────────────────────────────────
    if (ebay.description && ebay.description.trim().length > 10) {
      itemUpdates.description = ebay.description;
    }

    // ── Condition ───────────────────────────────────────────────────────────
    if (ebay.conditionDisplayName?.trim()) itemUpdates.condition = ebay.conditionDisplayName;
    if (ebay.conditionDescription?.trim()) itemUpdates.condition_notes = ebay.conditionDescription;

    // ── Quantity / SKU ──────────────────────────────────────────────────────
    if (ebay.quantity > 0) itemUpdates.quantity = ebay.quantity;
    if (ebay.sku && !existingItem.sku) itemUpdates.sku = ebay.sku;

    // ── Attributes: merge existing + new item specifics ─────────────────────
    const newAttrs: Record<string, string> = { ...safeAttrs(existingItem.attributes) };
    for (const spec of ebay.itemSpecifics) {
      if (spec.name && spec.value) newAttrs[String(spec.name).trim()] = String(spec.value).trim();
    }
    if (ebay.conditionDisplayName) newAttrs['eBay Condition'] = ebay.conditionDisplayName;
    if (ebay.categoryName) newAttrs['eBay Category'] = ebay.categoryName;
    // Always store the eBay category ID and name so preflight + submission can use them
    if (ebay.categoryId) {
      newAttrs['ebay_category_id'] = ebay.categoryId;
      if (ebay.categoryName) newAttrs['ebay_category_name'] = ebay.categoryName;
    }
    itemUpdates.attributes = newAttrs;

    // ── Coin-specific fields — fill blanks only ─────────────────────────────
    const findSpec = (names: string[]): string => {
      for (const n of names) {
        const f = ebay.itemSpecifics.find(s => s.name.toLowerCase() === n.toLowerCase());
        if (f?.value) return f.value;
      }
      return '';
    };
    if (!existingItem.ruler) { const v = findSpec(['Ruler', 'Monarch', 'Emperor', 'King']); if (v) itemUpdates.ruler = v; }
    if (!existingItem.denomination) { const v = findSpec(['Denomination', 'Face Value', 'Value']); if (v) itemUpdates.denomination = v; }
    if (!existingItem.year_made) { const v = findSpec(['Year', 'Date', 'Year of Issue', 'Mint Year']); if (v) itemUpdates.year_made = v; }
    if (!existingItem.country_of_origin) { const v = findSpec(['Country/Region of Manufacture', 'Country', 'Origin', 'Empire']); if (v) itemUpdates.country_of_origin = v; }
    if (!existingItem.material) { const v = findSpec(['Metal', 'Material', 'Composition']); if (v) itemUpdates.material = v; }
    if (!existingItem.period) { const v = findSpec(['Era', 'Period', 'Dynasty']); if (v) itemUpdates.period = v; }
    if (!existingItem.mint) { const v = findSpec(['Mint', 'Mint Mark']); if (v) itemUpdates.mint = v; }

    // ── Images: store ALL CDN URLs so swish-image-download can read them ──────
    //
    // KEY CHANGE (v5): swish-image-download no longer queries the listings table.
    // Instead, it reads CDN URLs directly from items.media.
    // So we MUST store ALL CDN photo URLs here during sync.
    //
    // RULE: Always write ALL eBay CDN photo URLs when eBay has more images than
    //       currently stored as CDN URLs. This ensures the full gallery is visible
    //       immediately and swish-image-download has all source URLs to download.
    //
    // RULE: If permanent Storage URLs already exist AND count matches eBay count,
    //       do not overwrite them (images already downloaded — nothing to do).
    //
    // Also store _ebay_item_id and _ebay_title in attributes for the download
    // pipeline to use as fallback when CDN URLs are unavailable.
    if (ebay.photos.length > 0) {
      const existingMedia: string[] = Array.isArray(existingItem.media) ? existingItem.media : [];
      const permanentCount = existingMedia.filter(u => isStorageUrl(u)).length;
      const cdnCount       = existingMedia.filter(u => isEbayCdnUrl(u)).length;

      // Only skip if we already have permanent Storage images covering all eBay photos.
      // If eBay has MORE images than we have permanently stored, write all CDN URLs.
      const alreadyComplete = permanentCount >= ebay.photos.length;

      if (!alreadyComplete) {
        // Write ALL eBay CDN URLs — replaces any partial CDN set or empty media.
        // swish-image-download will download each one to permanent Storage.
        itemUpdates.media = ebay.photos.slice(0, 12);
        imageUrlsStored = ebay.photos.length;
        console.log(`[EbaySync] item=${existingItem.id} writing ${ebay.photos.length} CDN URLs (permanent=${permanentCount} cdn=${cdnCount})`);
      } else {
        console.log(`[EbaySync] item=${existingItem.id} already has ${permanentCount} permanent images for ${ebay.photos.length} eBay photos — skip`);
      }
    }

    // Always store eBay item ID and title in attributes for download pipeline fallback.
    // Merge into newAttrs (already built above with item specifics) so nothing is lost.
    if (typeof itemUpdates.attributes === 'object' && itemUpdates.attributes !== null) {
      itemUpdates.attributes['_ebay_item_id'] = ebay.ebayItemId;
      itemUpdates.attributes['_ebay_title']   = ebay.title;
      itemUpdates.attributes['_ebay_img_count'] = ebay.photos.length;
    } else {
      const existingAttrs = safeAttrs(existingItem.attributes);
      itemUpdates.attributes = {
        ...existingAttrs,
        '_ebay_item_id': ebay.ebayItemId,
        '_ebay_title': ebay.title,
        '_ebay_img_count': ebay.photos.length,
      };
    }

    // ── Update listings record ───────────────────────────────────────────────
    const listingUpdate: Record<string, any> = {
      updated_at: new Date().toISOString(),
      status: ebay.ebayStatus === 'sold' ? 'sold' : ebay.ebayStatus === 'ended' ? 'ended' : 'active',
    };
    if (ebay.title) listingUpdate.title = ebay.title;
    if (ebay.description?.length > 10) listingUpdate.description = ebay.description;
    if (ebay.price > 0) listingUpdate.price = ebay.price;
    if (ebay.shippingCost >= 0) listingUpdate.shipping_cost = ebay.shippingCost;
    if (ebay.hitCount > 0) listingUpdate.views = ebay.hitCount;
    listingUpdate.watchers = ebay.watchCount; // always update watchers (0 is valid)
    // Always override category_id from eBay — eBay is authoritative
    if (ebay.categoryId) listingUpdate.category_id = ebay.categoryId;

    await supabase
      .from('listings')
      .update(listingUpdate)
      .eq('item_id', existingItem.id)
      .eq('marketplace_id', 'ebay');

    // ── Update items record ──────────────────────────────────────────────────
    const cleanUpdates: Record<string, any> = {};
    for (const [k, v] of Object.entries(itemUpdates)) {
      if (v !== undefined && v !== null) cleanUpdates[k] = v;
    }

    const { error: itemErr } = await supabase.from('items').update(cleanUpdates).eq('id', existingItem.id);
    if (itemErr) {
      console.log(`[EbaySync] Item update error ${existingItem.id}: ${itemErr.message}`);
      return { imageUrlsStored: 0, titleFixed: false, updated: false, error: itemErr.message };
    }

    return { imageUrlsStored, titleFixed, updated: true };
  } catch (e: any) {
    console.log(`[EbaySync] syncItemToSwish exception ${existingItem?.id}: ${e.message}`);
    return { imageUrlsStored: 0, titleFixed: false, updated: false, error: e.message };
  }
}

// ── Main Handler ───────────────────────────────────────────────────────────────

// ── Tenant security verification — HARDENED ─────────────────────────────────
// Missing auth = 401. Anon key = 401. Invalid JWT = 401. Non-member = 403.
async function verifyTenantAccess(
  supabase: ReturnType<typeof adminClient>,
  authHeader: string | null,
  tenantId: string,
): Promise<{ ok: boolean; status: number; error?: string }> {
  // Allow server-to-server calls using internal secret header
  const INTERNAL_SECRET = Deno.env.get('SWISH_INTERNAL_SECRET') ?? '';
  // (no internalHeader in sync — clients always authenticated)

  if (!authHeader) {
    return { ok: false, status: 401, error: 'Authentication required. Please sign in to SWISH.' };
  }
  const token = authHeader.replace('Bearer ', '').trim();
  if (!token || token === Deno.env.get('SUPABASE_ANON_KEY')) {
    return { ok: false, status: 401, error: 'Authentication required. Please sign in to SWISH.' };
  }
  try {
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error } = await userClient.auth.getUser();
    if (error || !user) return { ok: false, status: 401, error: 'Invalid or expired authentication token. Please sign in again.' };
    const { data: m } = await supabase.from('tenant_memberships').select('id').eq('tenant_id', tenantId).eq('user_id', user.id).maybeSingle();
    if (!m) {
      console.warn(`[SWISH Security] User ${user.id} attempted access to tenant ${tenantId} — not a member`);
      return { ok: false, status: 403, error: 'Access denied: you are not a member of this organisation.' };
    }
    return { ok: true, status: 200 };
  } catch (e: any) {
    console.error(`[SWISH Security] JWT verification error: ${e.message}`);
    return { ok: false, status: 401, error: 'Authentication verification failed. Please sign in again.' };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const { tenantId, mode = 'full', itemIds } = body;
  if (!tenantId) return json({ error: 'tenantId is required' }, 400);

  const supabase = adminClient();

  // Security: verify caller belongs to tenant
  const authHeader = req.headers.get('Authorization');
  const secCheck = await verifyTenantAccess(supabase, authHeader, tenantId);
  if (!secCheck.ok) return json({ error: secCheck.error ?? 'Unauthorized' }, secCheck.status);

  // ── Validate / refresh eBay token ─────────────────────────────────────────
  let token: string, clientId: string;
  try {
    const result = await getValidToken(supabase, tenantId);
    token = result.token; clientId = result.clientId;
  } catch (e: any) {
    const isReauth = e.message?.startsWith('REQUIRES_REAUTH:');
    return json({ error: e.message, requiresReauth: isReauth }, isReauth ? 401 : 500);
  }

  // ── refresh_token_only: just refresh the token and return immediately ──────
  if (mode === 'refresh_token_only') {
    return json({ success: true, message: 'eBay token is valid' });
  }

  console.log(`[EbaySync] Starting sync for tenant ${tenantId} — mode: ${mode}`);

  // ── Step 1: Fetch all eBay listings ───────────────────────────────────────
  const allEbayListings: EbayItemData[] = [];
  const sections = [
    { name: 'ActiveList', status: 'active' as const },
    { name: 'SoldList', status: 'sold' as const },
    { name: 'UnsoldList', status: 'ended' as const },
  ];

  for (const section of sections) {
    let page = 1;
    let hasMore = true;
    while (hasMore) {
      try {
        const { items, totalPages } = await fetchSellingPage(token, clientId, section.name, page, 100);
        allEbayListings.push(...items);
        hasMore = page < totalPages && items.length > 0;
        page++;
        if (items.length === 0) hasMore = false;
        if (hasMore) await new Promise(r => setTimeout(r, 150));
      } catch (e: any) {
        if (e.message?.startsWith('REQUIRES_REAUTH:')) return json({ error: e.message, requiresReauth: true }, 401);
        console.log(`[EbaySync] ${section.name} p${page} error: ${e.message}`);
        hasMore = false;
      }
    }
  }

  console.log(`[EbaySync] eBay listings fetched: ${allEbayListings.length}`);
  if (allEbayListings.length === 0) {
    return json({ success: true, processed: 0, updated: 0, imagesFetched: 0, titlesFixed: 0, failed: 0, totalEbayListings: 0, orphansFixed: 0, message: 'No eBay listings found.' });
  }

  // ── Step 2: Enrich descriptions via GetItems batch ────────────────────────
  const enrichedListings = await enrichBatch(token, clientId, allEbayListings);

  // ── Step 3: Match eBay IDs to SWISH items ─────────────────────────────────
  const { data: dbListings, error: dbListErr } = await supabase
    .from('listings')
    .select('item_id, external_listing_id')
    .eq('tenant_id', tenantId)
    .eq('marketplace_id', 'ebay')
    .not('external_listing_id', 'is', null)
    .neq('external_listing_id', '');

  if (dbListErr) return json({ error: `DB error: ${dbListErr.message}` }, 500);

  const ebayIdToItemId = new Map<string, string>();
  for (const l of dbListings ?? []) {
    if (l.external_listing_id && l.item_id) ebayIdToItemId.set(String(l.external_listing_id), String(l.item_id));
  }
  console.log(`[EbaySync] SWISH listings matched: ${ebayIdToItemId.size}`);

  const itemIdsSet = new Set<string>(itemIds ?? []);
  const toProcess = enrichedListings.filter(ebay => {
    const itemId = ebayIdToItemId.get(ebay.ebayItemId);
    if (!itemId) return false;
    if (itemIds && (itemIds as string[]).length > 0 && !itemIdsSet.has(itemId)) return false;
    return true;
  });

  if (toProcess.length === 0) {
    return json({ success: true, processed: 0, updated: 0, imagesFetched: 0, titlesFixed: 0, failed: 0, totalEbayListings: allEbayListings.length, orphansFixed: 0, message: 'No matching SWISH items. Run eBay Import first.' });
  }

  // ── Step 4: Load all SWISH items (paginated, no .in() to avoid 414) ───────
  const itemById = new Map<string, any>();
  const PAGE_SIZE = 200;
  let itemPage = 0, loadMore = true;
  while (loadMore) {
    const { data: swishPage, error: pageErr } = await supabase
      .from('items')
      .select('id, canonical_title, description, media, attributes, condition, condition_notes, ruler, denomination, year_made, country_of_origin, material, period, mint, sku, quantity')
      .eq('tenant_id', tenantId)
      .range(itemPage * PAGE_SIZE, (itemPage + 1) * PAGE_SIZE - 1);

    if (pageErr) return json({ error: `DB items error: ${pageErr.message}` }, 500);
    for (const item of swishPage ?? []) itemById.set(item.id, item);
    loadMore = (swishPage?.length ?? 0) === PAGE_SIZE;
    itemPage++;
  }
  console.log(`[EbaySync] SWISH items loaded: ${itemById.size}`);

  // ── Step 5: Sync each item (sequential batches to avoid rate limits) ───────
  let updated = 0, imagesFetched = 0, titlesFixed = 0, failed = 0;
  const failedItems: string[] = [];
  const BATCH_SIZE = 5;

  for (let i = 0; i < toProcess.length; i += BATCH_SIZE) {
    const batch = toProcess.slice(i, i + BATCH_SIZE);
    for (const ebay of batch) {
      const itemId = ebayIdToItemId.get(ebay.ebayItemId);
      const existingItem = itemId ? itemById.get(itemId) : null;

      if (!itemId || !existingItem) {
        failed++;
        failedItems.push(ebay.ebayItemId);
        continue;
      }

      const result = await syncItemToSwish(supabase, ebay, existingItem);
      if (result.updated) {
        updated++;
        imagesFetched += result.imageUrlsStored;
        if (result.titleFixed) titlesFixed++;
        itemById.set(itemId, { ...existingItem, canonical_title: ebay.title || existingItem.canonical_title });
      } else {
        failed++;
        failedItems.push(ebay.ebayItemId);
      }
    }
    if (i + BATCH_SIZE < toProcess.length) await new Promise(r => setTimeout(r, 50));
  }

  // ── Step 6: Fix orphaned listings (ended/sold on eBay but still active in SWISH) ─
  const ebayActiveIds = new Set(allEbayListings.filter(e => e.ebayStatus === 'active').map(e => e.ebayItemId));
  const { data: swishLiveListings } = await supabase
    .from('listings').select('id, item_id, external_listing_id')
    .eq('tenant_id', tenantId).eq('marketplace_id', 'ebay').eq('status', 'active')
    .not('external_listing_id', 'is', null);

  let orphansFixed = 0;
  for (const l of swishLiveListings ?? []) {
    if (l.external_listing_id && !ebayActiveIds.has(l.external_listing_id)) {
      const ebayItem = allEbayListings.find(e => e.ebayItemId === l.external_listing_id);
      const newStatus = ebayItem?.ebayStatus === 'sold' ? 'sold' : 'ended';
      await supabase.from('listings').update({ status: newStatus, ended_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', l.id);
      if (l.item_id) {
        await supabase.from('items').update({ status: newStatus === 'sold' ? 'sold' : 'identified', updated_at: new Date().toISOString() }).eq('id', l.item_id);
        orphansFixed++;
      }
    }
  }

  const result = { success: true, processed: toProcess.length, totalEbayListings: allEbayListings.length, updated, imagesFetched, titlesFixed, failed, orphansFixed, failedEbayIds: failedItems.slice(0, 20) };
  console.log(`[EbaySync] Done: ${JSON.stringify(result)}`);
  return json(result);
});
