// SWISH — Safe eBay unpublished-offer round-trip diagnostic
// This function ONLY reads or updates an existing UNPUBLISHED Inventory API offer.
// It never creates an offer and never calls publishOffer.
// All credentials remain server-side and tenant membership is required.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { decryptCredentials, encryptCredentials } from '../_shared/credentialCrypto.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token';
const INVENTORY_URL = 'https://api.ebay.com/sell/inventory/v1';
const TAXONOMY_URL = 'https://api.ebay.com/commerce/taxonomy/v1';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
function adminClient() {
  return createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
}

async function getCredentials(db: ReturnType<typeof adminClient>, tenantId: string) {
  const { data: connector, error } = await db.from('marketplace_connectors')
    .select('credential_ref,status,access_token_expires_at')
    .eq('tenant_id', tenantId).eq('marketplace_id', 'ebay').maybeSingle();
  if (error || !connector?.credential_ref) throw new Error('eBay connector not found. Connect eBay in SWISH settings.');
  if (connector.status !== 'connected') throw new Error('eBay is not connected. Reconnect it in SWISH settings.');
  const credentials: any = await decryptCredentials(connector.credential_ref);
  if (!credentials.accessToken || !credentials.clientId || !credentials.clientSecret) {
    throw new Error('The connected eBay credentials are incomplete. Reconnect eBay in SWISH settings.');
  }
  const expiry = credentials.expiresAt ? new Date(credentials.expiresAt).getTime() : 0;
  if (expiry && Date.now() + 60_000 >= expiry) {
    if (!credentials.refreshToken) throw new Error('The eBay token expired and has no refresh token. Reconnect eBay.');
    const resp = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + btoa(credentials.clientId + ':' + credentials.clientSecret),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: credentials.refreshToken }).toString(),
      signal: AbortSignal.timeout(15000),
    });
    const tokenData: any = await resp.json().catch(() => ({}));
    if (!resp.ok || !tokenData.access_token) throw new Error('eBay token refresh failed. Reconnect eBay in SWISH settings.');
    credentials.accessToken = tokenData.access_token;
    credentials.expiresAt = new Date(Date.now() + Number(tokenData.expires_in ?? 7200) * 1000).toISOString();
    if (tokenData.refresh_token) credentials.refreshToken = tokenData.refresh_token;
    const encrypted = await encryptCredentials(credentials);
    await db.from('marketplace_connectors').update({
      credential_ref: encrypted,
      access_token_expires_at: credentials.expiresAt,
      updated_at: new Date().toISOString(),
    }).eq('tenant_id', tenantId).eq('marketplace_id', 'ebay');
  }
  return credentials;
}

async function ebayRequest(token: string, offerId: string, method: 'GET' | 'PUT', body?: unknown) {
  const response = await fetch(`${INVENTORY_URL}/offer/${encodeURIComponent(offerId)}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Content-Language': 'en-GB',
      'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15000),
  });
  const text = await response.text();
  let data: any = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { message: text.slice(0, 500) }; }
  if (!response.ok) {
    if (response.status === 403) throw new Error('eBay denied Inventory API access. The connected account may need sell.inventory re-authorisation.');
    throw new Error(`eBay Inventory API returned HTTP ${response.status}: ${String(data?.errors?.[0]?.message ?? data?.message ?? 'request failed').slice(0, 300)}`);
  }
  return data;
}

function safeOffer(offer: any) {
  return {
    offerId: String(offer?.offerId ?? ''),
    sku: String(offer?.sku ?? ''),
    marketplaceId: String(offer?.marketplaceId ?? ''),
    format: String(offer?.format ?? ''),
    status: String(offer?.status ?? ''),
    categoryId: String(offer?.categoryId ?? ''),
    listingDescription: String(offer?.listingDescription ?? ''),
    availableQuantity: offer?.availableQuantity ?? null,
    pricingSummary: offer?.pricingSummary ?? null,
    listingPolicies: offer?.listingPolicies ?? null,
    merchantLocationKey: String(offer?.merchantLocationKey ?? ''),
    warnings: Array.isArray(offer?.warnings) ? offer.warnings : [],
    errors: Array.isArray(offer?.errors) ? offer.errors : [],
  };
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'POST required.' }, 405);
  try {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Sign in to SWISH first.' }, 401);
    const body: any = await request.json();
    const tenantId = typeof body?.tenantId === 'string' ? body.tenantId : '';
    const offerId = typeof body?.offerId === 'string' ? body.offerId.trim() : '';
    const action = body?.action;
    if (!tenantId) return json({ error: 'Tenant is required.' }, 400);
    if (!['read_offer', 'import_offer', 'sync_category_from_ebay', 'round_trip_unpublished', 'push_swish_category'].includes(action)) return json({ error: 'Unsupported test action.' }, 400);
    if (!offerId || offerId.length > 200 || /[\r\n]/.test(offerId)) return json({ error: 'Enter a valid eBay offer ID.' }, 400);

    const db = adminClient();
    const userClient = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return json({ error: 'Your SWISH session has expired. Sign in again.' }, 401);
    const { data: membership } = await db.from('tenant_memberships').select('id')
      .eq('tenant_id', tenantId).eq('user_id', user.id).maybeSingle();
    if (!membership) return json({ error: 'Access denied for this SWISH organisation.' }, 403);

    const credentials = await getCredentials(db, tenantId);
    const before = await ebayRequest(credentials.accessToken, offerId, 'GET');
    if (String(before?.offerId ?? '') !== offerId) return json({ error: 'eBay returned an unexpected offer. No changes were made.' }, 409);
    if (String(before?.marketplaceId ?? '') !== 'EBAY_GB') return json({ error: 'This test only supports EBAY_GB offers. No changes were made.' }, 400);
    if (String(before?.status ?? '').toUpperCase() !== 'UNPUBLISHED') {
      return json({
        error: 'Safety stop: this offer is not explicitly UNPUBLISHED, so SWISH will not update it.',
        offer: safeOffer(before),
        changed: false,
      }, 409);
    }

    if (action === 'read_offer') {
      return json({ ok: true, action, changed: false, offer: safeOffer(before) });
    }

    // Import the unpublished offer into the existing SWISH items/listings tables.
    // Keep the offer ID in item attributes; do not put it in external_listing_id,
    // which is reserved by the existing sync engine for published eBay item IDs.
    if (action === 'import_offer') {
      const { data: existingItems, error: findErr } = await db.from('items')
        .select('id,inventory_id,canonical_title,attributes')
        .eq('tenant_id', tenantId)
        .contains('attributes', { _ebay_offer_id: offerId })
        .limit(1);
      if (findErr) throw new Error('Could not check for an existing draft import: ' + findErr.message);
      if (existingItems?.length) {
        return json({ ok: true, action, alreadyImported: true, itemId: existingItems[0].id, inventoryId: existingItems[0].inventory_id, offer: safeOffer(before) });
      }

      const sku = String(before.sku ?? '');
      const inventoryItemResp = await fetch(`${INVENTORY_URL}/inventory_item/${encodeURIComponent(sku)}`, {
        headers: { Authorization: `Bearer ${credentials.accessToken}`, 'Content-Language': 'en-GB', 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB' },
        signal: AbortSignal.timeout(15000),
      });
      const inventoryItemText = await inventoryItemResp.text();
      let inventoryItem: any = {};
      try { inventoryItem = inventoryItemText ? JSON.parse(inventoryItemText) : {}; } catch { inventoryItem = {}; }
      if (!inventoryItemResp.ok) throw new Error(`Could not read eBay inventory item (HTTP ${inventoryItemResp.status}). No SWISH record created.`);
      const product = inventoryItem.product ?? {};
      const title = String(product.title ?? sku).trim().slice(0, 120);
      if (!title) throw new Error('eBay inventory item has no title. No SWISH record created.');
      const price = Number(before.pricingSummary?.price?.value ?? 0);
      const { data: inventoryId, error: idErr } = await db.rpc('kc_next_inventory_id', { p_tenant_id: tenantId });
      if (idErr || !inventoryId) throw new Error('Could not allocate a SWISH inventory ID: ' + (idErr?.message ?? 'no ID returned'));
      const categoryId = String(before.categoryId ?? '');
      const imageUrls = Array.isArray(product.imageUrls) ? product.imageUrls.filter((u: unknown) => typeof u === 'string' && String(u).startsWith('https://')) : [];
      const attributes: Record<string, any> = {
        _ebay_offer_id: offerId,
        _ebay_sku: sku,
        _ebay_title: title,
        _ebay_category_id: categoryId,
        ebay_category_id: categoryId,
        _ebay_draft_status: 'UNPUBLISHED',
        ...(product.aspects && typeof product.aspects === 'object' ? product.aspects : {}),
      };
      const { data: item, error: itemErr } = await db.from('items').insert({
        tenant_id: tenantId,
        canonical_title: title,
        description: String(product.description ?? before.listingDescription ?? ''),
        specialist_id: /coin|numismatic|ancient|dirham|tanka/i.test(title) ? 'coins' : 'curiosities_collectibles',
        status: 'identified',
        disposition_decision: 'sell_individual',
        condition: String(inventoryItem.condition ?? ''),
        condition_notes: '',
        identification_confidence: 0,
        identification_source: 'ebay_draft_import',
        valuation_low: 0,
        valuation_mid: price,
        valuation_high: 0,
        valuation_confidence: 'low',
        expected_selling_price: price,
        expected_net: price * 0.8725,
        expected_profit: 0,
        sale_prob_30d: 0,
        attributes,
        media: imageUrls,
        warnings: [],
        tags: ['ebay-draft-test'],
        acquired_cost: 0,
        inventory_id: inventoryId,
        catalogue_number: '',
        sku,
        quantity: Number(before.availableQuantity ?? inventoryItem.availability?.shipToLocationAvailability?.quantity ?? 1) || 1,
      }).select('id').single();
      if (itemErr || !item) throw new Error('Could not create SWISH inventory item: ' + (itemErr?.message ?? 'no item returned'));
      const { data: listing, error: listingErr } = await db.from('listings').insert({
        tenant_id: tenantId,
        item_id: item.id,
        marketplace_id: 'ebay',
        external_listing_id: null,
        title,
        description: String(product.description ?? before.listingDescription ?? ''),
        price,
        floor_price: 0,
        ceiling_price: price * 1.5,
        status: 'draft',
        shipping_cost: 0,
        views: 0,
        watchers: 0,
        category_id: categoryId || null,
      }).select('id').single();
      if (listingErr || !listing) {
        await db.from('items').delete().eq('id', item.id).eq('tenant_id', tenantId);
        throw new Error('Could not create SWISH draft listing: ' + (listingErr?.message ?? 'no listing returned'));
      }
      return json({ ok: true, action, alreadyImported: false, itemId: item.id, listingId: listing.id, inventoryId, offer: safeOffer(before) });
    }

    // Pull the live category from eBay into the SWISH draft row and attributes.
    if (action === 'sync_category_from_ebay') {
      const { data: matchedItems, error: matchErr } = await db.from('items')
        .select('id,attributes')
        .eq('tenant_id', tenantId)
        .contains('attributes', { _ebay_offer_id: offerId })
        .limit(1);
      if (matchErr) throw new Error('Could not find the imported SWISH draft: ' + matchErr.message);
      const item = matchedItems?.[0];
      if (!item) return json({ error: 'Import this unpublished offer into SWISH first.' }, 404);
      const categoryId = String(before.categoryId ?? '');
      if (!/^\\d+$/.test(categoryId)) return json({ error: 'eBay returned no numeric category ID. SWISH was not changed.' }, 409);
      const attrs = { ...(item.attributes ?? {}), _ebay_category_id: categoryId, ebay_category_id: categoryId, _ebay_draft_status: 'UNPUBLISHED' };
      const { error: itemUpdateErr } = await db.from('items').update({ attributes: attrs, updated_at: new Date().toISOString() }).eq('id', item.id).eq('tenant_id', tenantId);
      if (itemUpdateErr) throw new Error('Could not update SWISH category attributes: ' + itemUpdateErr.message);
      const { data: listings, error: listingFindErr } = await db.from('listings').select('id')
        .eq('tenant_id', tenantId).eq('item_id', item.id).eq('marketplace_id', 'ebay').limit(1);
      if (listingFindErr) throw new Error('Could not find SWISH draft listing: ' + listingFindErr.message);
      if (!listings?.length) throw new Error('SWISH item exists but its draft listing was not found.');
      const { error: listingUpdateErr } = await db.from('listings').update({ category_id: categoryId, updated_at: new Date().toISOString() })
        .eq('id', listings[0].id).eq('tenant_id', tenantId);
      if (listingUpdateErr) throw new Error('Could not update SWISH listing category: ' + listingUpdateErr.message);
      return json({ ok: true, action, syncedCategoryId: categoryId, itemId: item.id, offer: safeOffer(before) });
    }

    if (action === 'push_swish_category') {
      const { data: matchedItems, error: matchErr } = await db.from('items')
        .select('id,attributes')
        .eq('tenant_id', tenantId)
        .contains('attributes', { _ebay_offer_id: offerId })
        .limit(1);
      if (matchErr) throw new Error('Could not find the imported SWISH draft: ' + matchErr.message);
      const item = matchedItems?.[0];
      if (!item) return json({ error: 'Import this unpublished offer into SWISH first.' }, 404);
      const { data: listings, error: listingFindErr } = await db.from('listings').select('id,category_id')
        .eq('tenant_id', tenantId).eq('item_id', item.id).eq('marketplace_id', 'ebay').limit(1);
      if (listingFindErr || !listings?.length) throw new Error('SWISH draft listing not found.');
      const categoryId = String(listings[0].category_id ?? '');
      if (!/^\\d+$/.test(categoryId)) return json({ error: 'SWISH category is missing or invalid. No eBay changes made.' }, 409);
      // Never guess a category. Require the exact category ID to be confirmed as a
      // leaf in eBay's current UK taxonomy before writing it back.
      const taxonomyResp = await fetch(`${TAXONOMY_URL}/${encodeURIComponent(String(before.categoryTreeId ?? '3'))}/get_category_tree?category_ids=${encodeURIComponent(categoryId)}`, {
        headers: { Authorization: `Bearer ${credentials.accessToken}`, 'Accept-Language': 'en-GB' },
        signal: AbortSignal.timeout(15000),
      });
      // Taxonomy endpoint requires a category tree ID; do not assume a tree ID.
      // If no explicit category tree ID is available on the offer, refuse the write.
      if (!before.categoryTreeId || !taxonomyResp.ok) {
        return json({ error: 'Cannot safely validate the category against eBay UK taxonomy from this offer response. No eBay changes made.' }, 409);
      }
      const taxonomyData: any = await taxonomyResp.json().catch(() => ({}));
      const categoryNode = taxonomyData?.categories?.find((c: any) => String(c?.category?.categoryId) === categoryId)?.category;
      if (!categoryNode || categoryNode.leafCategoryTreeNode !== true) {
        return json({ error: 'SWISH category is not verified as an eBay UK leaf category. No eBay changes made.' }, 409);
      }
      const writableFields = ['sku','marketplaceId','format','availableQuantity','categoryId','listingDescription','listingDuration','listingPolicies','pricingSummary','quantityLimitPerBuyer','includeCatalogProductDetails','merchantLocationKey','tax','storeCategoryNames','hideBuyerDetails','charity'];
      const updateBody: Record<string, unknown> = {};
      for (const field of writableFields) if (Object.prototype.hasOwnProperty.call(before, field)) updateBody[field] = before[field];
      updateBody.categoryId = categoryId;
      await ebayRequest(credentials.accessToken, offerId, 'PUT', updateBody);
      const after = await ebayRequest(credentials.accessToken, offerId, 'GET');
      if (String(after?.status ?? '').toUpperCase() !== 'UNPUBLISHED') return json({ error: 'Safety verification failed: offer is no longer UNPUBLISHED. Stop testing.', before: safeOffer(before), after: safeOffer(after) }, 409);
      return json({ ok: String(after?.categoryId ?? '') === categoryId, action, pushedCategoryId: categoryId, before: safeOffer(before), after: safeOffer(after) });
    }

    // Rebuild only writable Inventory API fields. GET responses also contain
    // server-managed fields (offerId/status/warnings/errors) which must not be PUT.
    // The request body is always derived from eBay's live response, never the client.
    const writableFields = [
      'sku', 'marketplaceId', 'format', 'availableQuantity', 'categoryId',
      'listingDescription', 'listingDuration', 'listingPolicies', 'pricingSummary',
      'quantityLimitPerBuyer', 'includeCatalogProductDetails', 'merchantLocationKey',
      'tax', 'storeCategoryNames', 'hideBuyerDetails', 'charity',
    ];
    const updateBody: Record<string, unknown> = {};
    for (const field of writableFields) {
      if (Object.prototype.hasOwnProperty.call(before, field)) updateBody[field] = before[field];
    }
    if (!updateBody.sku || !updateBody.marketplaceId || !updateBody.format) {
      return json({ error: 'The offer is missing required writable fields. No changes were made.' }, 409);
    }
    const afterPut = await ebayRequest(credentials.accessToken, offerId, 'PUT', updateBody);
    const after = await ebayRequest(credentials.accessToken, offerId, 'GET');
    if (String(after?.status ?? '').toUpperCase() !== 'UNPUBLISHED') {
      return json({
        ok: false,
        error: 'Safety verification failed: eBay no longer reports the offer as UNPUBLISHED. Do not continue testing.',
        before: safeOffer(before),
        after: safeOffer(after),
        changed: true,
      }, 409);
    }
    const beforeSafe = safeOffer(before);
    const afterSafe = safeOffer(after);
    const changedFields = Object.keys(beforeSafe).filter((key) =>
      JSON.stringify((beforeSafe as any)[key]) !== JSON.stringify((afterSafe as any)[key])
    );
    return json({
      ok: changedFields.length === 0,
      action,
      changed: true,
      before: beforeSafe,
      after: afterSafe,
      changedFields,
      message: changedFields.length === 0
        ? 'Unpublished offer round-trip verified; no tracked offer fields changed.'
        : 'Unpublished offer was updated, but tracked fields differ. Review the before/after values.',
      warnings: afterPut?.warnings ?? [],
    });
  } catch (error: any) {
    // Never log credentials or raw eBay request bodies.
    console.error('[SWISH Draft Round-Trip] Request failed:', String(error?.message ?? 'unknown').slice(0, 400));
    return json({ error: String(error?.message ?? 'Draft test failed.').slice(0, 500) }, 400);
  }
});
