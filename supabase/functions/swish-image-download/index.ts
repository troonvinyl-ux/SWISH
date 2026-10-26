// SWISH — Image Download & Permanent Storage Edge Function v6
//
// ROOT CAUSE FIX (v6):
//   GetMyeBaySelling NEVER returns <PictureURL> elements — it only returns
//   <GalleryURL> (1 image per listing). So swish-ebay-sync was always storing
//   _ebay_img_count:1 and 1 CDN URL. The download pipeline then saw
//   permanentCount(1) = knownEbayCount(1) and considered everything complete.
//
//   v6 SOLUTION:
//   ALWAYS call GetItem (Trading API, DetailLevel=ReturnAll) for every item
//   that has _ebay_item_id stored. GetItem returns ALL <PictureURL> elements
//   (the full gallery). This is the ONLY way to get all images from eBay.
//   The stored _ebay_img_count from sync is ignored — only GetItem truth counts.
//
// PIPELINE (per item):
//   1. Read _ebay_item_id from items.attributes (stored by swish-ebay-sync)
//   2. Call GetItem with DetailLevel=ReturnAll to get ALL picture URLs
//   3. Compare against existing permanent Storage URLs (by position)
//   4. Download only missing positions to Supabase Storage
//   5. Validate each image: HTTP success + image/* content + size > 512b
//   6. Upload to item-images bucket at tenantId/itemId/N.jpg
//   7. Verify Storage object exists before recording success
//   8. Write permanent Storage URLs to items.media
//   9. Store correct _ebay_img_count (from GetItem, not GetMyeBaySelling)
//
// POST body: { tenantId, itemIds?, fixTitles? }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { encryptCredentials, decryptCredentials } from '../_shared/credentialCrypto.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const EBAY_TOKEN_URL   = 'https://api.ebay.com/identity/v1/oauth2/token';
const EBAY_TRADING_API = 'https://api.ebay.com/ws/api.dll';
const STORAGE_BUCKET   = 'item-images';
const MAX_IMAGES       = 24;
const DOWNLOAD_CONCURRENCY  = 4;
const MAX_RETRIES_PER_IMAGE = 3;
const EBAY_IMG_COUNT_KEY    = '_ebay_img_count';
const EBAY_ITEM_ID_KEY      = '_ebay_item_id';

function jsonResp(body: unknown, status = 200) {
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

function isPermanentStorageUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  return (url.includes('supabase') && url.includes('storage')) ||
         (url.includes('onspace') && url.includes('storage'));
}

function isEbayCdnUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  return url.includes('ebayimg.com') ||
         url.includes('thumbs.ebaystatic.com') ||
         url.includes('i.ebayimg.com') ||
         url.includes('p.ebayimg.com');
}

function normaliseEbayUrl(url: string): string {
  return url
    .replace(/^http:\/\//i, 'https://')
    .replace(/s-l\d+\.(jpg|jpeg|png|webp)/i, 's-l1600.jpg');
}

function ebayImageBase(url: string): string {
  return url
    .replace(/^http:\/\//i, 'https://')
    .replace(/s-l\d+\.(jpg|jpeg|png|webp)/i, '__SIZE__');
}

// ── Token helpers ─────────────────────────────────────────────────────────────

async function refreshAccessToken(
  clientId: string, clientSecret: string, refreshToken: string,
): Promise<{ accessToken: string; expiresAt: string }> {
  const basicAuth = btoa(`${clientId}:${clientSecret}`);
  const resp = await fetch(EBAY_TOKEN_URL, {
    method: 'POST',
    headers: { Authorization: `Basic ${basicAuth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token', refresh_token: refreshToken,
    }).toString(),
  });
  const data = await resp.json();
  if (!data.access_token) throw new Error(`Token refresh failed: ${data.error_description ?? data.error ?? 'unknown'}`);
  return {
    accessToken: data.access_token,
    expiresAt: new Date(Date.now() + (data.expires_in ?? 7200) * 1000).toISOString(),
  };
}

async function getValidAccessToken(
  supabase: ReturnType<typeof adminClient>, tenantId: string,
): Promise<{ accessToken: string; clientId: string; credentials: any }> {
  const { data: connector } = await supabase
    .from('marketplace_connectors').select('credential_ref, status, access_token_expires_at')
    .eq('tenant_id', tenantId).eq('marketplace_id', 'ebay').maybeSingle();

  if (!connector?.credential_ref) throw new Error('eBay connector not found');
  if (connector.status !== 'connected') throw new Error(`eBay connector status "${connector.status}" — re-authorise`);

  let credentials: any;
  try { credentials = await decryptCredentials(connector.credential_ref); }
  catch (e: any) { throw new Error(`eBay credentials malformed: ${e.message}`); }
  if (!credentials.clientId || !credentials.accessToken) throw new Error('eBay credentials incomplete');

  const expiresAt = credentials.expiresAt ?? connector.access_token_expires_at;
  const isExpired = expiresAt ? Date.now() + 5 * 60_000 >= new Date(expiresAt).getTime() : false;

  if (isExpired) {
    if (!credentials.refreshToken) {
      await supabase.from('marketplace_connectors').update({
        status: 'requires_reauth', last_error: 'Access token expired', updated_at: new Date().toISOString(),
      }).eq('tenant_id', tenantId).eq('marketplace_id', 'ebay');
      throw new Error('REQUIRES_REAUTH: eBay token expired');
    }
    try {
      const { accessToken: newToken, expiresAt: newExpiry } = await refreshAccessToken(
        credentials.clientId, credentials.clientSecret, credentials.refreshToken,
      );
      const updatedRef = await encryptCredentials({ ...credentials, accessToken: newToken, expiresAt: newExpiry });
      await supabase.from('marketplace_connectors').update({
        credential_ref: updatedRef, access_token_expires_at: newExpiry,
        status: 'connected', last_error: null, updated_at: new Date().toISOString(),
      }).eq('tenant_id', tenantId).eq('marketplace_id', 'ebay');
      credentials = { ...credentials, accessToken: newToken, expiresAt: newExpiry };
    } catch (e: any) {
      await supabase.from('marketplace_connectors').update({
        status: 'requires_reauth', last_error: `Refresh failed: ${e.message}`, updated_at: new Date().toISOString(),
      }).eq('tenant_id', tenantId).eq('marketplace_id', 'ebay');
      throw new Error(`REQUIRES_REAUTH: Token refresh failed: ${e.message}`);
    }
  }
  return { accessToken: credentials.accessToken, clientId: credentials.clientId, credentials };
}

// ── GetItem — fetches ALL picture URLs for one eBay listing ──────────────────
// GetMyeBaySelling only returns GalleryURL (1 image). GetItem with
// DetailLevel=ReturnAll returns ALL <PictureURL> elements (the full gallery).
// This is the ONLY correct way to get all images.

async function fetchAllEbayImages(
  ebayItemId: string, accessToken: string, clientId: string,
): Promise<string[]> {
  const xmlBody = `<?xml version="1.0" encoding="utf-8"?>
<GetItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials><eBayAuthToken>${accessToken}</eBayAuthToken></RequesterCredentials>
  <ItemID>${ebayItemId}</ItemID>
  <DetailLevel>ReturnAll</DetailLevel>
  <IncludeItemSpecifics>false</IncludeItemSpecifics>
</GetItemRequest>`;

  try {
    const res = await fetch(EBAY_TRADING_API, {
      method: 'POST',
      headers: {
        'X-EBAY-API-SITEID': '3',
        'X-EBAY-API-COMPATIBILITY-LEVEL': '967',
        'X-EBAY-API-CALL-NAME': 'GetItem',
        'X-EBAY-API-APP-NAME': clientId,
        'Content-Type': 'text/xml',
      },
      body: xmlBody,
      signal: AbortSignal.timeout(25000),
    });

    if (!res.ok) {
      console.log(`[v6] GetItem HTTP ${res.status} for ebay=${ebayItemId}`);
      return [];
    }

    const xmlText = await res.text();

    // Auth errors — surface for token refresh handling upstream
    if (xmlText.includes('hardExpired') || xmlText.includes('IAF_INVALID') ||
        xmlText.includes('<ErrorCode>931<') || xmlText.includes('<ErrorCode>932<')) {
      console.log(`[v6] GetItem auth error for ebay=${ebayItemId}`);
      return [];
    }

    if (xmlText.includes('<Ack>Failure</Ack>')) {
      // Item may have ended — not an error, just no images
      console.log(`[v6] GetItem Failure ack for ebay=${ebayItemId}`);
      return [];
    }

    const urls: string[] = [];
    const seenBases = new Set<string>();

    // Extract all <PictureURL> elements — these are the full-size images
    for (const m of xmlText.matchAll(/<PictureURL>([^<]+)<\/PictureURL>/g)) {
      const raw = m[1].trim();
      if (!raw) continue;
      const base = ebayImageBase(raw);
      if (!seenBases.has(base)) {
        seenBases.add(base);
        // Always use https and largest size
        const secured = raw.replace(/^http:\/\//i, 'https://').replace(/s-l\d+\.(jpg|jpeg)/i, 's-l1600.jpg');
        urls.push(secured);
      }
    }

    // Fallback to GalleryURL if no PictureURL found (shouldn't happen with ReturnAll)
    if (urls.length === 0) {
      const g = xmlText.match(/<GalleryURL>([^<]+)<\/GalleryURL>/)?.[1];
      if (g) {
        const secured = g.trim().replace(/^http:\/\//i, 'https://');
        urls.push(secured);
      }
    }

    console.log(`[v6] GetItem ebay=${ebayItemId} found=${urls.length} PictureURL elements`);
    return urls.slice(0, MAX_IMAGES);
  } catch {
    console.log('[v6] GetItem request failed.');
    return [];
  }
}

// ── Download + validate + upload + verify one image ───────────────────────────

async function downloadOne(
  supabase: ReturnType<typeof adminClient>,
  sourceUrl: string,
  storagePath: string,
  logCtx: string,
): Promise<string | null> {
  const basePathNoExt = storagePath.replace(/\.\w+$/, '');

  // Idempotency — reuse existing Storage object
  for (const ext of ['jpg', 'jpeg', 'png', 'webp']) {
    const existingPath = `${basePathNoExt}.${ext}`;
    const pathDir  = existingPath.substring(0, existingPath.lastIndexOf('/'));
    const fileName = existingPath.substring(existingPath.lastIndexOf('/') + 1);
    try {
      const { data: listData } = await supabase.storage.from(STORAGE_BUCKET).list(pathDir, { search: fileName });
      const found = (listData ?? []).find(f => f.name === fileName);
      if (found) {
        const { data: urlData } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(existingPath);
        if (urlData?.publicUrl && isPermanentStorageUrl(urlData.publicUrl)) {
          console.log(`[v6] ${logCtx} already in Storage`);
          return urlData.publicUrl;
        }
      }
    } catch { /* continue */ }
  }

  // URL fallback chain: try largest size first
  const normUrl  = normaliseEbayUrl(sourceUrl);
  const httpsUrl = sourceUrl.replace(/^http:\/\//i, 'https://');
  const urlsToTry = [
    normUrl,
    httpsUrl,
    normUrl.replace('s-l1600.jpg', 's-l640.jpg'),
    normUrl.replace('s-l1600.jpg', 's-l500.jpg'),
    normUrl.replace('s-l1600.jpg', 's-l300.jpg'),
    sourceUrl,
  ].filter((u, i, a) => u.startsWith('http') && a.indexOf(u) === i);

  let buffer: ArrayBuffer | null = null;
  let contentType = 'image/jpeg';
  let lastError = '';

  for (let attempt = 1; attempt <= MAX_RETRIES_PER_IMAGE; attempt++) {
    for (const url of urlsToTry) {
      try {
        const res = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
            'Referer': 'https://www.ebay.co.uk/',
          },
          signal: AbortSignal.timeout(25000),
        });
        if (!res.ok) { lastError = `HTTP ${res.status}`; continue; }
        const ct = (res.headers.get('content-type') ?? '').toLowerCase();
        if (ct.startsWith('text/') || ct.startsWith('application/')) {
          lastError = `non-image content-type: ${ct}`; continue;
        }
        const bytes = await res.arrayBuffer();
        if (bytes.byteLength < 512) { lastError = `too small (${bytes.byteLength}b)`; continue; }
        buffer = bytes;
        contentType = ct.split(';')[0].trim() || 'image/jpeg';
        break;
      } catch (e: any) { lastError = e.message; }
    }
    if (buffer !== null) break;
    if (attempt < MAX_RETRIES_PER_IMAGE) await new Promise(r => setTimeout(r, attempt * 900));
  }

  if (buffer === null) {
    console.log(`[v6] FAIL ${logCtx}: ${lastError}`);
    return null;
  }

  const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg';
  const finalPath = `${basePathNoExt}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from(STORAGE_BUCKET).upload(finalPath, buffer, { contentType, upsert: true });
  if (uploadError) {
    console.log(`[v6] UPLOAD_ERR ${logCtx}: ${uploadError.message}`);
    return null;
  }

  // Verify it exists
  try {
    const pathDir  = finalPath.substring(0, finalPath.lastIndexOf('/'));
    const fileName = finalPath.substring(finalPath.lastIndexOf('/') + 1);
    const { data: verifyData } = await supabase.storage.from(STORAGE_BUCKET).list(pathDir, { search: fileName });
    if (!verifyData?.find(f => f.name === fileName)) {
      console.log(`[v6] VERIFY_FAIL ${logCtx}`);
      return null;
    }
  } catch { return null; }

  const { data: urlData } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(finalPath);
  if (!urlData?.publicUrl || !isPermanentStorageUrl(urlData.publicUrl)) return null;

  console.log(`[v6] OK ${logCtx} bytes=${buffer.byteLength}`);
  return urlData.publicUrl;
}

// ── Process one item ──────────────────────────────────────────────────────────

interface ProcessResult {
  itemId: string;
  newMedia: string[];
  downloaded: number;
  alreadyStored: number;
  failed: number;
  skipped: boolean;
  reason?: string;
  ebayImageCount: number;
}

async function processItem(
  supabase: ReturnType<typeof adminClient>,
  tenantId: string,
  item: { id: string; media: string[]; attributes: Record<string, any> | null; canonical_title: string },
  accessToken: string,
  clientId: string,
): Promise<ProcessResult> {
  const currentMedia: string[] = Array.isArray(item.media) ? item.media : [];
  const attrs: Record<string, any> = (item.attributes && typeof item.attributes === 'object') ? item.attributes : {};
  const ebayItemId: string = attrs[EBAY_ITEM_ID_KEY] ?? '';

  if (!ebayItemId) {
    console.log(`[v6] item=${item.id} no _ebay_item_id — skip`);
    return { itemId: item.id, newMedia: currentMedia.filter(u => isPermanentStorageUrl(u)), downloaded: 0, alreadyStored: 0, failed: 0, skipped: true, reason: 'no_ebay_item_id', ebayImageCount: 0 };
  }

  // ── ALWAYS call GetItem to get the TRUE full image list ───────────────────
  // GetMyeBaySelling only returns GalleryURL (1 image). GetItem returns all.
  // We cannot rely on _ebay_img_count stored during sync — it was always 1.
  const ebayUrls = await fetchAllEbayImages(ebayItemId, accessToken, clientId);

  if (ebayUrls.length === 0) {
    // GetItem failed — keep whatever we have stored
    const existingPermanent = currentMedia.filter(u => isPermanentStorageUrl(u));
    console.log(`[v6] item=${item.id} GetItem returned 0 images — keeping ${existingPermanent.length} stored`);
    return { itemId: item.id, newMedia: existingPermanent, downloaded: 0, alreadyStored: existingPermanent.length, failed: 0, skipped: true, reason: 'get_item_returned_0', ebayImageCount: 0 };
  }

  const totalRemote = ebayUrls.length;
  console.log(`[v6] item=${item.id} ebay=${ebayItemId} GetItem=${totalRemote} images, stored=${currentMedia.filter(u => isPermanentStorageUrl(u)).length}`);

  // ── Build download plan ───────────────────────────────────────────────────
  // For each eBay image position i:
  //   - If currentMedia[i] is already a permanent Storage URL → keep it (already done)
  //   - Otherwise → download ebayUrls[i]
  const targetMedia: Array<string | null> = ebayUrls.map((_, i) => {
    const existing = currentMedia[i];
    if (existing && isPermanentStorageUrl(existing)) return existing;
    return null; // needs downloading
  });

  const indicesToDownload: number[] = [];
  for (let i = 0; i < totalRemote; i++) {
    if (targetMedia[i] === null) indicesToDownload.push(i);
  }

  const alreadyStoredCount = totalRemote - indicesToDownload.length;

  if (indicesToDownload.length === 0) {
    console.log(`[v6] item=${item.id} all ${totalRemote} images already in Storage — complete`);
    return {
      itemId: item.id,
      newMedia: targetMedia as string[],
      downloaded: 0,
      alreadyStored: alreadyStoredCount,
      failed: 0,
      skipped: false,
      ebayImageCount: totalRemote,
    };
  }

  console.log(`[v6] item=${item.id} downloading ${indicesToDownload.length} of ${totalRemote} images`);

  // ── Download in concurrent batches ────────────────────────────────────────
  for (let bStart = 0; bStart < indicesToDownload.length; bStart += DOWNLOAD_CONCURRENCY) {
    const batch = indicesToDownload.slice(bStart, bStart + DOWNLOAD_CONCURRENCY);
    const results = await Promise.all(
      batch.map(idx => downloadOne(
        supabase,
        ebayUrls[idx],
        `${tenantId}/${item.id}/${idx}`,
        `item=${item.id} idx=${idx}`,
      )),
    );
    for (let b = 0; b < batch.length; b++) {
      targetMedia[batch[b]] = results[b];
    }
  }

  // ── Collect results ───────────────────────────────────────────────────────
  const finalMedia: string[] = [];
  let downloaded = 0;
  let failed = 0;

  for (let i = 0; i < totalRemote; i++) {
    const url = targetMedia[i];
    if (url !== null && isPermanentStorageUrl(url)) {
      finalMedia.push(url);
      if (indicesToDownload.includes(i)) downloaded++;
    } else if (indicesToDownload.includes(i)) {
      failed++;
    }
  }

  console.log(`[v6] item=${item.id} done: downloaded=${downloaded} alreadyStored=${alreadyStoredCount} failed=${failed} total=${finalMedia.length}/${totalRemote}`);

  return { itemId: item.id, newMedia: finalMedia, downloaded, alreadyStored: alreadyStoredCount, failed, skipped: false, ebayImageCount: totalRemote };
}

// ── Main Handler ───────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResp({ error: 'Method not allowed' }, 405);

  let body: any;
  try { body = await req.json(); } catch { return jsonResp({ error: 'Invalid JSON' }, 400); }

  const { tenantId, itemIds, fixTitles = true } = body;
  if (!tenantId) return jsonResp({ error: 'tenantId is required' }, 400);

  const supabase = adminClient();

  // ── Auth ──────────────────────────────────────────────────────────────────
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return jsonResp({ error: 'Authentication required.' }, 401);
  const authToken = authHeader.replace('Bearer ', '').trim();
  if (!authToken || authToken === Deno.env.get('SUPABASE_ANON_KEY')) {
    return jsonResp({ error: 'Authentication required.' }, 401);
  }
  try {
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: uErr } = await userClient.auth.getUser();
    if (uErr || !user) return jsonResp({ error: 'Invalid authentication token.' }, 401);
    const { data: member } = await supabase.from('tenant_memberships').select('id')
      .eq('tenant_id', tenantId).eq('user_id', user.id).maybeSingle();
    if (!member) return jsonResp({ error: 'Access denied.' }, 403);
  } catch {
    return jsonResp({ error: 'Authentication failed.' }, 401);
  }

  // ── eBay credentials ──────────────────────────────────────────────────────
  let accessToken: string;
  let clientId: string;
  try {
    const r = await getValidAccessToken(supabase, tenantId);
    accessToken = r.accessToken; clientId = r.clientId;
  } catch (e: any) {
    const isReauth = e.message?.startsWith('REQUIRES_REAUTH:');
    return jsonResp({
      error: isReauth ? 'eBay re-authorisation required.' : e.message,
      requiresReauth: isReauth,
      authFailed: true,
    }, 401);
  }

  // ── Load items ────────────────────────────────────────────────────────────
  const PAGE_SIZE = 200;
  let allItems: Array<{ id: string; media: string[]; canonical_title: string; attributes: Record<string, any> | null }> = [];

  if (itemIds && Array.isArray(itemIds) && itemIds.length > 0) {
    const { data } = await supabase.from('items')
      .select('id, media, canonical_title, attributes')
      .eq('tenant_id', tenantId).in('id', itemIds);
    allItems = data ?? [];
  } else {
    let page = 0;
    while (true) {
      const { data: pageData, error: pageErr } = await supabase.from('items')
        .select('id, media, canonical_title, attributes')
        .eq('tenant_id', tenantId)
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
        .order('created_at', { ascending: false });
      if (pageErr || !pageData || pageData.length === 0) break;
      allItems = allItems.concat(pageData);
      if (pageData.length < PAGE_SIZE) break;
      page++;
    }
    console.log(`[v6] Loaded ${allItems.length} items`);
  }

  // ── Filter: which items need work? ────────────────────────────────────────
  // v6 RULE: Process any item that has _ebay_item_id AND either:
  //   (a) Has CDN URLs in media (direct CDN — needs downloading)
  //   (b) Has no images at all (never downloaded)
  //   (c) Has 1-4 permanent images (likely from GetMyeBaySelling gallery URL only —
  //       need GetItem to check if there are more)
  //   (d) Explicit itemIds passed → always process
  //   (e) Has partial set: permanentCount < _ebay_img_count (but only when count > 1,
  //       since count=1 was always wrong from GetMyeBaySelling)
  //
  // Items with 5+ permanent images are assumed complete (eBay max per listing ~12).
  // They are still re-verified if explicitly targeted via itemIds.

  const itemsNeedingWork: typeof allItems = [];
  const forceAll = itemIds && Array.isArray(itemIds) && itemIds.length > 0;

  for (const item of allItems) {
    const media: string[] = Array.isArray(item.media) ? item.media : [];
    const attrs: Record<string, any> = (item.attributes && typeof item.attributes === 'object') ? item.attributes : {};
    const ebayItemId = attrs[EBAY_ITEM_ID_KEY];
    const permanentCount = media.filter(u => isPermanentStorageUrl(u)).length;
    const cdnCount       = media.filter(u => isEbayCdnUrl(u)).length;
    const knownCount     = typeof attrs[EBAY_IMG_COUNT_KEY] === 'number' ? attrs[EBAY_IMG_COUNT_KEY] : 0;

    // No eBay item ID → can't call GetItem → skip
    if (!ebayItemId && !forceAll) continue;

    if (forceAll) { itemsNeedingWork.push(item); continue; }

    // (a) CDN URLs present → download to Storage
    if (cdnCount > 0) { itemsNeedingWork.push(item); continue; }

    // (b) No images at all → try GetItem
    if (media.length === 0) { itemsNeedingWork.push(item); continue; }

    // (c) 1-4 permanent images → may have more on eBay (GetMyeBaySelling gave us 1)
    // CRITICAL: This catches all 207 items that have exactly 1 image from gallery URL
    if (permanentCount >= 1 && permanentCount <= 4) { itemsNeedingWork.push(item); continue; }

    // (e) Partial set where we know the real count (knownCount > 1 means was set by v6)
    if (knownCount > 1 && permanentCount < knownCount) { itemsNeedingWork.push(item); continue; }
  }

  console.log(`[v6] Items needing work: ${itemsNeedingWork.length} / ${allItems.length}`);

  // ── Process all items ─────────────────────────────────────────────────────
  let totalDownloaded    = 0;
  let totalAlreadyStored = 0;
  let totalFailed        = 0;
  let totalSkipped       = 0;
  let titlesFixed        = 0;
  let itemsComplete      = 0;
  let itemsPartial       = 0;
  let itemsFailed        = 0;
  const errors: string[] = [];

  for (const item of itemsNeedingWork) {
    let result: ProcessResult;
    try {
      result = await processItem(supabase, tenantId, item, accessToken, clientId);
    } catch {
      console.log('[v6] Image processing failed for an item.');
      errors.push('An item image could not be processed.');
      itemsFailed++;
      continue;
    }

    if (result.skipped) { totalSkipped++; continue; }

    totalDownloaded    += result.downloaded;
    totalAlreadyStored += result.alreadyStored;
    totalFailed        += result.failed;

    if (result.failed > 0 && result.downloaded === 0 && result.alreadyStored === 0) {
      itemsFailed++;
    } else if (result.failed > 0) {
      itemsPartial++;
    } else {
      itemsComplete++;
    }

    // ── Write to DB ───────────────────────────────────────────────────────
    const existingPermanent = (item.media ?? []).filter(u => isPermanentStorageUrl(u));
    // Only update media if we got more (or same count of) permanent images
    const shouldUpdateMedia = result.newMedia.length > 0 &&
                              result.newMedia.length >= existingPermanent.length;

    const currentAttrs: Record<string, any> = (item.attributes && typeof item.attributes === 'object')
      ? { ...item.attributes } : {};

    const updates: Record<string, any> = { updated_at: new Date().toISOString() };

    if (shouldUpdateMedia) {
      updates.media = result.newMedia;
    }

    // Always update _ebay_img_count with the TRUE count from GetItem (not GetMyeBaySelling)
    if (result.ebayImageCount > 0) {
      updates.attributes = {
        ...currentAttrs,
        [EBAY_IMG_COUNT_KEY]: result.ebayImageCount,  // TRUE count from GetItem
        '_img_sync_at': new Date().toISOString(),
        '_img_stored_count': result.newMedia.length,
      };
    }

    // Fix blank title from _ebay_title stored in attributes by sync
    const needsTitleFix = !item.canonical_title || item.canonical_title.trim().length < 3 || item.canonical_title === 'Untitled';
    const storedTitle: string = currentAttrs['_ebay_title'] ?? '';
    if (fixTitles && needsTitleFix && storedTitle.length >= 3) {
      updates.canonical_title = storedTitle;
      titlesFixed++;
    }

    const { error: updateErr } = await supabase.from('items').update(updates).eq('id', item.id);
    if (updateErr) errors.push(`DB update item=${item.id}: ${updateErr.message}`);

    // Small delay to avoid hammering eBay/Storage APIs
    await new Promise(r => setTimeout(r, 100));
  }

  const finalResult = {
    success: true,
    version: 'v6',
    processed: itemsNeedingWork.length,
    imagesDownloaded: totalDownloaded,
    imagesAlreadyStored: totalAlreadyStored,
    imagesFailed: totalFailed,
    imagesSkipped: totalSkipped,
    titlesFixed,
    itemsComplete,
    itemsPartial,
    itemsFailed,
    errors: errors.slice(0, 20),
  };
  console.log(`[v6] COMPLETE: ${JSON.stringify(finalResult)}`);
  return jsonResp(finalResult);
});
