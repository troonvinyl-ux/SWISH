// SWISH — Safe eBay unpublished-offer round-trip diagnostic
// This function ONLY reads or updates an existing UNPUBLISHED Inventory API offer.
// It never creates an offer and never calls publishOffer.
// All credentials remain server-side and tenant membership is required.

import { createClient } from 'npm:@supabase/supabase-js@2';
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
    if (!['list_unpublished_offers', 'read_offer', 'import_offer', 'sync_category_from_ebay', 'round_trip_unpublished', 'push_swish_category'].includes(action)) return json({ error: 'Unsupported test action.' }, 400);
    if (action !== 'list_unpublished_offers' && (!offerId || offerId.length > 200 || /[\\r\\n]/.test(offerId))) return json({ error: 'Select an eBay UK draft first.' }, 400);

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
    if (action === 'list_unpublished_offers') {
      const response = await fetch(`${INVENTORY_URL}/offer?marketplace_id=EBAY_GB&limit=100&offset=0`, {
        headers: {
          Authorization: `Bearer ${credentials.accessToken}`,
          'Content-Language': 'en-GB',
          'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB',
        },
        signal: AbortSignal.timeout(15000),
      });
      const responseText = await response.text();
      let payload: any = {};
      try { payload = responseText ? JSON.parse(responseText) : {}; } catch { payload = {}; }
      if (!response.ok) {
        const message = String(payload?.errors?.[0]?.message ?? payload?.message ?? 'Could not list eBay UK offers').slice(0, 300);
        throw new Error(`eBay offer list failed (HTTP ${response.status}): ${message}`);
      }
      const offers = (Array.isArray(payload?.offers) ? payload.offers : [])
        .filter((offer: any) => String(offer?.status ?? '').toUpperCase() === 'UNPUBLISHED')
        .map((offer: any) => ({
          ...safeOffer(offer),
          offerId: String(offer?.offerId ?? ''),
          sku: String(offer?.sku ?? ''),
          categoryId: String(offer?.categoryId ?? ''),
          status: 'UNPUBLISHED',
        }))
        .filter((offer: any) => offer.offerId);
      return json({ ok: true, action, marketplaceId: 'EBAY_GB', offers, total: offers.length, limit: 100 });
    }
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
        const existing = existingItems[0];
        const writableFields = [
          'sku', 'marketplaceId', 'format', 'availableQuantity', 'categoryId',
          'listingDescription', 'listingDuration', 'listingPolicies', 'pricingSummary',
          'quantityLimitPerBuyer', 'includeCatalogProductDetails', 'merchantLocationKey',
          'tax', 'storeCategoryNames', 'hideBuyerDetails', 'charity',
        ];
        const offerSnapshot: Record<string, unknown> = {};
        for (const field of writableFields) {
          if (Object.prototype.hasOwnProperty.call(before, field)) offerSnapshot[field] = before[field];
        }
        const refreshedAttributes = {
          ...(existing.attributes ?? {}),
          _ebay_offer_id: offerId,
          _ebay_sku: String(before.sku ?? ''),
          _ebay_title: String(existing.canonical_title ?? before.sku ?? ''),
          _ebay_category_id: String(before.categoryId ?? ''),
          ebay_category_id: String(before.categoryId ?? ''),
          _ebay_draft_status: 'UNPUBLISHED',
          _ebay_offer_snapshot: offerSnapshot,
        };
        const { error: refreshErr } = await db.from('items').update({
          attributes: refreshedAttributes,
          updated_at: new Date().toISOString(),
        }).eq('id', existing.id).eq('tenant_id', tenantId);
        if (refreshErr) throw new Error('Could not refresh the imported offer snapshot: ' + refreshErr.message);
        await db.from('listings').update({
          category_id: String(before.categoryId ?? '') || null,
          updated_at: new Date().toISOString(),
        }).eq('tenant_id', tenantId).eq('item_id', existing.id).eq('marketplace_id', 'ebay');
        return json({ ok: true, action, alreadyImported: true, snapshotRefreshed: true, itemId: existing.id, inventoryId: existing.inventory_id, offer: safeOffer(before) });
      }

      const sku = String(before.sku ?? '');
      // Reuse an existing SWISH item with the exact same SKU before creating anything.
      // This prevents a draft sync from duplicating inventory already in SWISH.
      if (sku) {
        const { data: skuMatches, error: skuErr } = await db.from('items')
          .select('id,inventory_id,canonical_title,description,attributes,sku,quantity')
          .eq('tenant_id', tenantId)
          .eq('sku', sku)
          .limit(2);
        if (skuErr) throw new Error('Could not match the eBay draft to existing SWISH inventory: ' + skuErr.message);
        if ((skuMatches ?? []).length > 1) {
          return json({ error: `More than one SWISH item uses SKU ${sku}; no import made to avoid duplicating or linking the wrong coin.` }, 409);
        }
        const match = skuMatches?.[0];
        if (match) {
          const writableFields = [
            'sku', 'marketplaceId', 'format', 'availableQuantity', 'categoryId',
            'listingDescription', 'listingDuration', 'listingPolicies', 'pricingSummary',
            'quantityLimitPerBuyer', 'includeCatalogProductDetails', 'merchantLocationKey',
            'tax', 'storeCategoryNames', 'hideBuyerDetails', 'charity',
          ];
          const offerSnapshot: Record<string, unknown> = {};
          for (const field of writableFields) {
            if (Object.prototype.hasOwnProperty.call(before, field)) offerSnapshot[field] = before[field];
          }
          const attrs = {
            ...(match.attributes ?? {}),
            _ebay_offer_id: offerId,
            _ebay_sku: sku,
            _ebay_title: String(match.canonical_title ?? before.sku ?? ''),
            _ebay_category_id: String(before.categoryId ?? ''),
            ebay_category_id: String(before.categoryId ?? ''),
            _ebay_draft_status: 'UNPUBLISHED',
            _ebay_offer_snapshot: offerSnapshot,
          };
          const { error: itemUpdateErr } = await db.from('items').update({
            attributes: attrs,
            updated_at: new Date().toISOString(),
          }).eq('id', match.id).eq('tenant_id', tenantId);
          if (itemUpdateErr) throw new Error('Could not link the eBay draft to existing SWISH inventory: ' + itemUpdateErr.message);

          const { data: matchedListings, error: listingMatchErr } = await db.from('listings')
            .select('id')
            .eq('tenant_id', tenantId)
            .eq('item_id', match.id)
            .eq('marketplace_id', 'ebay')
            .in('status', ['draft', 'pending'])
            .limit(1);
          if (listingMatchErr) throw new Error('Could not find the existing SWISH draft listing: ' + listingMatchErr.message);
          let linkedListingId = matchedListings?.[0]?.id ?? null;
          if (linkedListingId) {
            const { error: listingUpdateErr } = await db.from('listings').update({
              category_id: String(before.categoryId ?? '') || null,
              price: Number(before.pricingSummary?.price?.value ?? 0),
              description: String(before.listingDescription ?? match.description ?? ''),
              updated_at: new Date().toISOString(),
            }).eq('id', linkedListingId).eq('tenant_id', tenantId);
            if (listingUpdateErr) throw new Error('Could not update the existing SWISH draft listing: ' + listingUpdateErr.message);
          } else {
            const price = Number(before.pricingSummary?.price?.value ?? 0);
            const { data: createdListing, error: createListingErr } = await db.from('listings').insert({
              tenant_id: tenantId,
              item_id: match.id,
              marketplace_id: 'ebay',
              external_listing_id: null,
              title: String(match.canonical_title ?? before.sku ?? '').slice(0, 120),
              description: String(before.listingDescription ?? match.description ?? ''),
              price,
              floor_price: 0,
              ceiling_price: price * 1.5,
              status: 'draft',
              shipping_cost: 0,
              views: 0,
              watchers: 0,
              category_id: String(before.categoryId ?? '') || null,
            }).select('id').single();
            if (createListingErr || !createdListing) throw new Error('Could not link the existing SWISH item to a draft listing: ' + (createListingErr?.message ?? 'no listing returned'));
            linkedListingId = createdListing.id;
          }
          return json({
            ok: true, action, alreadyImported: true, matchedBySku: true,
            itemId: match.id, listingId: linkedListingId, inventoryId: match.inventory_id,
            offer: safeOffer(before),
            message: 'Matched the eBay draft to existing SWISH inventory by exact SKU; no duplicate item created.',
          });
        }
      }

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
      const offerWritableFields = [
        'sku', 'marketplaceId', 'format', 'availableQuantity', 'categoryId',
        'listingDescription', 'listingDuration', 'listingPolicies', 'pricingSummary',
        'quantityLimitPerBuyer', 'includeCatalogProductDetails', 'merchantLocationKey',
        'tax', 'storeCategoryNames', 'hideBuyerDetails', 'charity',
      ];
      const offerSnapshot: Record<string, unknown> = {};
      for (const field of offerWritableFields) {
        if (Object.prototype.hasOwnProperty.call(before, field)) offerSnapshot[field] = before[field];
      }
      const attributes: Record<string, any> = {
        _ebay_offer_id: offerId,
        _ebay_sku: sku,
        _ebay_title: title,
        _ebay_category_id: categoryId,
        ebay_category_id: categoryId,
        _ebay_draft_status: 'UNPUBLISHED',
        _ebay_offer_snapshot: offerSnapshot,
        _ebay_inventory_item_snapshot: inventoryItem,
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
      if (!/^\d+$/.test(categoryId)) return json({ error: 'eBay returned no numeric category ID. SWISH was not changed.' }, 409);
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
      if (!/^\d+$/.test(categoryId)) return json({ error: 'SWISH category is missing or invalid. No eBay changes made.' }, 409);
      // Never guess a category. Require the exact category ID to be confirmed as a
      // leaf in eBay's current UK taxonomy before writing it back.
      const treeResp = await fetch(`${TAXONOMY_URL}/get_default_category_tree_id?marketplace_id=EBAY_GB`, {
        headers: { Authorization: `Bearer ${credentials.accessToken}`, 'Accept-Language': 'en-GB' },
        signal: AbortSignal.timeout(15000),
      });
      if (!treeResp.ok) return json({ error: 'Could not verify the category tree with eBay UK taxonomy. No eBay changes made.' }, 409);
      const treeData: any = await treeResp.json().catch(() => ({}));
      const treeId = String(treeData?.categoryTreeId ?? '');
      if (!treeId) return json({ error: 'eBay did not return the UK category tree ID. No eBay changes made.' }, 409);
      const taxonomyResp = await fetch(`${TAXONOMY_URL}/category_tree/${encodeURIComponent(treeId)}/get_category_subtree?category_id=${encodeURIComponent(categoryId)}`, {
        headers: { Authorization: `Bearer ${credentials.accessToken}`, 'Accept-Language': 'en-GB' },
        signal: AbortSignal.timeout(15000),
      });
      if (!taxonomyResp.ok) return json({ error: 'Could not verify the selected category against eBay UK taxonomy. No eBay changes made.' }, 409);
      const taxonomyData: any = await taxonomyResp.json().catch(() => ({}));
      const categoryNode = taxonomyData?.categorySubtreeNode;
      if (String(categoryNode?.category?.categoryId ?? '') !== categoryId || categoryNode?.leafCategoryTreeNode !== true) {
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

    // Round-trip from the saved SWISH record, not from the fresh eBay GET response.
    // This proves whether SWISH preserved and can submit the imported writable fields.
    const { data: matchedItems, error: matchErr } = await db.from('items')
      .select('id,attributes,quantity,canonical_title,description')
      .eq('tenant_id', tenantId)
      .contains('attributes', { _ebay_offer_id: offerId })
      .limit(1);
    if (matchErr) throw new Error('Could not load the imported SWISH item: ' + matchErr.message);
    const item = matchedItems?.[0];
    if (!item) return json({ error: 'Import this unpublished eBay offer into SWISH first. No eBay changes made.' }, 404);

    const { data: swishListings, error: listingErr } = await db.from('listings')
      .select('id,title,description,price,category_id,status')
      .eq('tenant_id', tenantId)
      .eq('item_id', item.id)
      .eq('marketplace_id', 'ebay')
      .limit(1);
    if (listingErr) throw new Error('Could not load the imported SWISH listing: ' + listingErr.message);
    const swishListing = swishListings?.[0];
    if (!swishListing) return json({ error: 'Imported SWISH item has no linked eBay draft listing. No eBay changes made.' }, 404);

    const savedSnapshot = item.attributes?._ebay_offer_snapshot;
    if (!savedSnapshot || typeof savedSnapshot !== 'object') {
      return json({ error: 'This SWISH import predates the round-trip test. Re-import the unpublished offer to save its original writable fields. No eBay changes made.' }, 409);
    }
    const writableFields = [
      'sku', 'marketplaceId', 'format', 'availableQuantity', 'categoryId',
      'listingDescription', 'listingDuration', 'listingPolicies', 'pricingSummary',
      'quantityLimitPerBuyer', 'includeCatalogProductDetails', 'merchantLocationKey',
      'tax', 'storeCategoryNames', 'hideBuyerDetails', 'charity',
    ];
    const updateBody: Record<string, unknown> = {};
    for (const field of writableFields) {
      if (Object.prototype.hasOwnProperty.call(savedSnapshot, field)) updateBody[field] = savedSnapshot[field];
    }

    // Overlay the values actually saved in SWISH so local edits are part of the test.
    const swishCategoryId = String(swishListing.category_id ?? item.attributes?._ebay_category_id ?? '');
    if (swishCategoryId) updateBody.categoryId = swishCategoryId;
    if (Number.isFinite(Number(swishListing.price)) && Number(swishListing.price) > 0) {
      updateBody.pricingSummary = {
        ...(updateBody.pricingSummary as Record<string, unknown> ?? {}),
        price: { value: Number(swishListing.price).toFixed(2), currency: 'GBP' },
      };
    }
    const swishQuantity = Number(item.quantity);
    if (Number.isFinite(swishQuantity) && swishQuantity > 0) updateBody.availableQuantity = swishQuantity;

    if (!updateBody.sku || updateBody.marketplaceId !== 'EBAY_GB' || !updateBody.format) {
      return json({ error: 'The imported SWISH record is missing required eBay UK offer fields (SKU, EBAY_GB marketplace, or format). No eBay changes made.', swishItemId: item.id, swishListingId: swishListing.id }, 409);
    }

    const beforeSafe = safeOffer(before);
    const response = await ebayRequest(credentials.accessToken, offerId, 'PUT', updateBody);
    const after = await ebayRequest(credentials.accessToken, offerId, 'GET');
    if (String(after?.status ?? '').toUpperCase() !== 'UNPUBLISHED') {
      return json({ ok: false, error: 'Safety verification failed: eBay no longer reports the offer as UNPUBLISHED. Stop testing.', before: beforeSafe, after: safeOffer(after), changed: true }, 409);
    }
    const afterSafe = safeOffer(after);
    const changedFields = Object.keys(beforeSafe).filter((key) =>
      JSON.stringify((beforeSafe as any)[key]) !== JSON.stringify((afterSafe as any)[key])
    );
    const expectedCategory = String(updateBody.categoryId ?? '');
    const categoryMatches = !expectedCategory || String(after.categoryId ?? '') === expectedCategory;
    return json({
      ok: categoryMatches,
      action,
      changed: true,
      source: 'swish_database_record',
      swishItemId: item.id,
      swishListingId: swishListing.id,
      submittedFields: Object.keys(updateBody),
      before: beforeSafe,
      after: afterSafe,
      changedFields,
      message: categoryMatches
        ? 'SWISH-sourced offer update accepted by eBay UK. Review before/after values and submitted fields.'
        : 'eBay accepted the request but the category read-back differs from the category saved in SWISH.',
      warnings: response?.warnings ?? [],
    });
  } catch (error: any) {
    // Never log credentials or raw eBay request bodies.
    console.error('[SWISH Draft Round-Trip] Request failed:', String(error?.message ?? 'unknown').slice(0, 400));
    return json({ error: String(error?.message ?? 'Draft test failed.').slice(0, 500) }, 400);
  }
});
