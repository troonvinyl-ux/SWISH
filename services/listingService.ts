// SWISH Listing Service
// Generates, previews, saves, and retrieves marketplace listings.

import { getSupabaseClient } from '@/template';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { getBusinessConfig } from '@/services/businessConfigService';

export interface GeneratedListing {
  title: string;
  description: string;
  category: string;
  category_id?: string;
  condition_id: string;
  condition_description: string;
  recommended_price: number;
  floor_price: number;
  ceiling_price: number;
  item_specifics: Record<string, string>;
  keywords: string[];
  listing_format: string;
  duration: string;
  shipping_profile: string;
  returns_policy: string;
  rationale: string;
  // v2 safety gate fields
  price_requires_manual_review?: boolean;
  price_review_reason?: string;
  identification_is_provisional?: boolean;
  safety_flags?: string[];
}

export interface SavedListing {
  id: string;
  itemId: string;
  tenantId: string;
  marketplaceId: string;
  externalListingId?: string;
  title: string;
  description: string;
  price: number;
  floorPrice: number;
  ceilingPrice: number;
  shippingCost: number;
  status: string;
  views: number;
  watchers: number;
  publishedAt?: string;
  endedAt?: string;
  categoryId?: string;
  createdAt: string;
  updatedAt: string;
}

function mapListing(row: any): SavedListing {
  return {
    id: row.id,
    itemId: row.item_id,
    tenantId: row.tenant_id,
    marketplaceId: row.marketplace_id,
    externalListingId: row.external_listing_id ?? undefined,
    title: row.title,
    description: row.description ?? '',
    price: Number(row.price ?? 0),
    floorPrice: Number(row.floor_price ?? 0),
    ceilingPrice: Number(row.ceiling_price ?? 0),
    shippingCost: Number(row.shipping_cost ?? 0),
    status: row.status ?? 'draft',
    views: row.views ?? 0,
    watchers: row.watchers ?? 0,
    publishedAt: row.published_at ?? undefined,
    endedAt: row.ended_at ?? undefined,
    categoryId: row.category_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── Generate listing via OnSpace AI edge function ─────────────────────────────

export async function generateListing(
  itemId: string,
  tenantId: string,
  marketplaceId: string = 'ebay'
): Promise<{ listing: GeneratedListing | null; error: string | null }> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase.functions.invoke('swish-list-generate', {
    body: { item_id: itemId, tenant_id: tenantId, marketplace_id: marketplaceId },
  });

  if (error) {
    let message = error.message;
    if (error instanceof FunctionsHttpError) {
      try {
        const statusCode = error.context?.status ?? 500;
        const text = await error.context?.text();
        message = `[${statusCode}] ${text || error.message}`;
      } catch {
        message = error.message;
      }
    }
    return { listing: null, error: message };
  }

  return { listing: data?.listing ?? null, error: null };
}

// ── Save a generated listing to the DB ────────────────────────────────────────

export async function saveListing(
  tenantId: string,
  itemId: string,
  generated: GeneratedListing,
  marketplaceId: string = 'ebay',
  categoryId?: string,
): Promise<{ listing: SavedListing | null; error: string | null }> {
  const supabase = getSupabaseClient();

  // Pre-fill shipping cost from business config default (0 = free shipping)
  const { config } = await getBusinessConfig(tenantId);
  const defaultShipping = config?.defaultShippingCost ?? 0;

  // Only persist a user-confirmed category ID here. AI-generated listing text
  // must never invent/override an eBay category; publish-time taxonomy resolution
  // handles the no-category case using current EBAY_GB suggestions.
  const resolvedCategoryId = categoryId ?? null;

  const { data, error } = await supabase
    .from('listings')
    .insert({
      tenant_id: tenantId,
      item_id: itemId,
      marketplace_id: marketplaceId,
      title: generated.title,
      description: generated.description,
      price: generated.recommended_price,
      floor_price: generated.floor_price,
      ceiling_price: generated.ceiling_price,
      shipping_cost: defaultShipping,
      status: 'draft',
      ...(resolvedCategoryId ? { category_id: resolvedCategoryId } : {}),
    })
    .select()
    .single();

  if (error) return { listing: null, error: error.message };
  return { listing: mapListing(data), error: null };
}

// ── Get listings for an item ──────────────────────────────────────────────────

export async function getItemListings(
  itemId: string
): Promise<{ listings: SavedListing[]; error: string | null }> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('listings')
    .select('*')
    .eq('item_id', itemId)
    .order('created_at', { ascending: false });

  if (error) return { listings: [], error: error.message };
  return { listings: (data ?? []).map(mapListing), error: null };
}

// ── Update listing status ─────────────────────────────────────────────────────

export async function updateListingStatus(
  listingId: string,
  status: string,
  extra?: Partial<{ published_at: string; external_listing_id: string }>
): Promise<{ error: string | null }> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('listings')
    .update({ status, ...(extra ?? {}), updated_at: new Date().toISOString() })
    .eq('id', listingId);
  return { error: error?.message ?? null };
}

// ── Update listing description ──────────────────────────────────────────────────

export async function updateListingDescription(
  listingId: string,
  description: string,
): Promise<{ error: string | null }> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('listings')
    .update({ description, updated_at: new Date().toISOString() })
    .eq('id', listingId);
  return { error: error?.message ?? null };
}

// ── Update listing title ────────────────────────────────────────────────────────

export async function updateListingTitle(
  listingId: string,
  title: string,
): Promise<{ error: string | null }> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('listings')
    .update({ title: title.trim(), updated_at: new Date().toISOString() })
    .eq('id', listingId);
  return { error: error?.message ?? null };
}

// ── Update listing price ────────────────────────────────────────────────────────

export async function updateListingPrice(
  listingId: string,
  price: number,
): Promise<{ error: string | null }> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('listings')
    .update({ price, updated_at: new Date().toISOString() })
    .eq('id', listingId);
  return { error: error?.message ?? null };
}

// ── Update listing floor price ──────────────────────────────────────────────────

export async function updateListingFloorPrice(
  listingId: string,
  floorPrice: number,
): Promise<{ error: string | null }> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('listings')
    .update({ floor_price: floorPrice, updated_at: new Date().toISOString() })
    .eq('id', listingId);
  return { error: error?.message ?? null };
}

// ── Update listing shipping cost ─────────────────────────────────────────────────

export async function updateListingShipping(
  listingId: string,
  shippingCost: number,
): Promise<{ error: string | null }> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('listings')
    .update({ shipping_cost: shippingCost, updated_at: new Date().toISOString() })
    .eq('id', listingId);
  return { error: error?.message ?? null };
}

// ── End a listing ────────────────────────────────────────────────────────────────
// Calls eBay EndFixedPriceItem if there is an external listing ID,
// then marks the listing as ended in the DB.

export async function endListing(
  listingId: string,
  itemId: string,
  tenantId?: string,
  externalListingId?: string,
): Promise<{ error: string | null }> {
  const supabase = getSupabaseClient();

  // If we have an eBay listing ID and tenant, end it on eBay first
  if (tenantId && externalListingId) {
    const { data, error: fnErr } = await supabase.functions.invoke('swish-ebay-list', {
      body: {
        route: 'end',
        tenantId,
        listingId,
        itemId,
        externalListingId,
      },
    });
    if (fnErr) {
      let msg = fnErr.message;
      if (fnErr instanceof FunctionsHttpError) {
        try {
          const t = await fnErr.context?.text();
          if (t) { try { const p = JSON.parse(t); msg = p.error ?? t; } catch { msg = t; } }
        } catch {}
      }
      return { error: msg };
    }
    if (!data?.success) {
      return { error: data?.error ?? 'eBay could not end the listing' };
    }
    // Edge function already updated the DB rows
    return { error: null };
  }

  // No eBay listing — just update DB
  const [listingResult, itemResult] = await Promise.all([
    supabase
      .from('listings')
      .update({ status: 'ended', ended_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', listingId),
    supabase
      .from('items')
      .update({ status: 'identified', updated_at: new Date().toISOString() })
      .eq('id', itemId),
  ]);
  return { error: listingResult.error?.message ?? itemResult.error?.message ?? null };
}

// Get all listings across items (for the Listings management screen)
// NICHE-ISOLATION: accepts optional specialistIds to scope the query to the
// active niche at the DB level rather than filtering client-side. This prevents
// cross-niche listings from appearing when all niches share one eBay account.

export interface ListingWithItem extends SavedListing {
  itemTitle: string;
  itemSpecialistId: string;
  itemAcquiredCost: number;
  itemMedia: string[];
  categoryId?: string;
}

export async function getAllListings(
  tenantId: string,
  statusFilter?: string,
  specialistIds?: string[],
): Promise<{ listings: ListingWithItem[]; error: string | null }> {
  const supabase = getSupabaseClient();

  let query = supabase
    .from('listings')
    .select('*, items!inner(canonical_title, specialist_id, acquired_cost, media)')
    .eq('tenant_id', tenantId)
    .order('updated_at', { ascending: false });

  if (statusFilter && statusFilter !== 'all') {
    query = query.eq('status', statusFilter);
  }

  // Niche isolation: filter by specialist_id at the DB level.
  // Using items!inner join allows filtering on the joined table.
  if (specialistIds && specialistIds.length > 0) {
    query = query.in('items.specialist_id', specialistIds);
  }

  const { data, error } = await query;
  if (error) return { listings: [], error: error.message };

  const listings: ListingWithItem[] = (data ?? []).map(row => ({
    ...mapListing(row),
    itemTitle: row.items?.canonical_title ?? 'Unknown Item',
    itemSpecialistId: row.items?.specialist_id ?? '',
    itemAcquiredCost: Number(row.items?.acquired_cost ?? 0),
    itemMedia: [...new Set([...(Array.isArray(row.items?.media) ? row.items.media : []), ...(Array.isArray(row.images) ? row.images : []), row.image_url].filter((url: unknown) => typeof url === 'string' && url.length > 0))] as string[],
    categoryId: row.category_id ?? undefined,
  }));

  return { listings, error: null };
}

// ── Refresh listing stats from eBay (views + watchers) ───────────────────────

export async function refreshListingStats(
  tenantId: string,
  listingId: string,
  externalListingId: string,
): Promise<{ views: number; watchers: number; error: string | null }> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase.functions.invoke('swish-ebay-browse', {
    body: { tenantId, listingId, externalListingId },
  });

  if (error) {
    let msg = error.message;
    if (error instanceof FunctionsHttpError) {
      try { const t = await error.context?.text(); msg = t || msg; } catch {}
    }
    return { views: 0, watchers: 0, error: msg };
  }

  return { views: data?.views ?? 0, watchers: data?.watchers ?? 0, error: null };
}

// ── Live listing count (for tab badge) ──────────────────────────────────────────
// Filtered by niche specialist IDs so the badge only shows listings for the
// active niche — prevents cross-niche count bleed (e.g. MX listings showing
// in the Coins tab badge).

export async function getLiveListingCount(
  tenantId: string,
  specialistIds?: string[],
): Promise<number> {
  const supabase = getSupabaseClient();
  // If no specialist filter, count all active listings for the tenant
  if (!specialistIds || specialistIds.length === 0) {
    const { count, error } = await supabase
      .from('listings')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('status', 'active');
    return error ? 0 : (count ?? 0);
  }
  // Filter by niche via items join
  const { data, error } = await supabase
    .from('listings')
    .select('id, items!inner(specialist_id)')
    .eq('tenant_id', tenantId)
    .eq('status', 'active')
    .in('items.specialist_id', specialistIds);
  return error ? 0 : (data?.length ?? 0);
}

// ── One-step verify + publish ──────────────────────────────────────────────────
// Runs the full verification gate then marks the listing as published.
// Returns granular step results so the UI can show progress.

export type ListingFormat = 'FixedPriceItem' | 'Chinese';

export interface ListingCreateParams {
  tenantId: string;
  itemId: string;
  marketplaceId?: string;
  title: string;
  description: string;
  price: number;
  shippingCost?: number;
  format?: ListingFormat;
}

export type SubmitStep = 'verifying' | 'checking_policies' | 'resolving_category' | 'publishing' | 'done' | 'failed';

// ── Create a manual listing record ───────────────────────────────────────────

export async function createManualListing(
  params: ListingCreateParams,
): Promise<{ listing: SavedListing | null; error: string | null }> {
  const supabase = getSupabaseClient();
  const { config } = await getBusinessConfig(params.tenantId);
  const defaultShipping = params.shippingCost ?? config?.defaultShippingCost ?? 0;

  const { data, error } = await supabase
    .from('listings')
    .insert({
      tenant_id:    params.tenantId,
      item_id:      params.itemId,
      marketplace_id: params.marketplaceId ?? 'ebay',
      title:        params.title,
      description:  params.description,
      price:        params.price,
      floor_price:  params.price * 0.6,
      ceiling_price: params.price * 1.5,
      shipping_cost: defaultShipping,
      status:       'draft',
    })
    .select()
    .single();

  if (error) return { listing: null, error: error.message };
  return { listing: mapListing(data), error: null };
}

export interface SubmitResult {
  success: boolean;
  step: SubmitStep;
  verificationPassed?: boolean;
  failureReasons?: string[];
  warnings?: string[];
  error?: string;
  publishedAt?: string;
  externalListingId?: string;
}

// ── Delete a listing from SWISH DB (and optionally end it on eBay first) ────────
// This is the SINGLE canonical delete route — no other delete path exists.
// If the listing has an externalListingId and is active on eBay, it calls
// endListing() first to remove it from eBay before deleting the SWISH record.

export async function deleteListing(
  listingId: string,
  tenantId: string,
  options?: {
    itemId?: string;
    externalListingId?: string;
    status?: string;
  },
): Promise<{ error: string | null }> {
  const supabase = getSupabaseClient();

  // If the listing is active on eBay, end it first
  if (options?.externalListingId && options?.status === 'active') {
    const endResult = await endListing(
      listingId,
      options.itemId ?? '',
      tenantId,
      options.externalListingId,
    );
    if (endResult.error) return { error: `eBay end failed: ${endResult.error}` };
  }

  // Delete from SWISH DB
  const { error } = await supabase
    .from('listings')
    .delete()
    .eq('id', listingId)
    .eq('tenant_id', tenantId); // RLS guard

  if (error) return { error: error.message };
  return { error: null };
}

export async function submitListingToMarketplace(
  tenantId: string,
  listingId: string,
  onStep?: (step: SubmitStep) => void,
  auctionParams?: {
    listingType?: ListingFormat;
    auctionDays?: number;
    startPrice?: number;
    reservePrice?: number;
  }
): Promise<SubmitResult> {
  const supabase = getSupabaseClient();

  // ── Step 1: Verify ──────────────────────────────────────────────────────────
  onStep?.('verifying');

  // Import verificationService inline to avoid circular deps
  const { verifyListing } = await import('@/services/verificationService');
  const { verification, error: verifyError } = await verifyListing(tenantId, listingId);

  if (verifyError || !verification) {
    return {
      success: false,
      step: 'failed',
      verificationPassed: false,
      error: verifyError ?? 'Verification failed to run',
    };
  }

  // SWISH quality verification is advisory, not an eBay submission gate.
  // Preserve the result and surface its failures as warnings, but allow the
  // real eBay submission pipeline to decide whether the listing is acceptable.
  // Missing listing / failed verification execution still blocks above; eBay's
  // own authentication, category, policy and API response checks remain intact.
  const verificationAdvisories = verification.overallPassed
    ? []
    : [
        'SWISH verification advisory — review before or after listing:',
        ...verification.failureReasons,
      ];

  // ── Step 2: Pre-flight check — fetch category and business policy config ─────
  // The edge function reads listings.category_id — if it is null the Taxonomy
  // fallback may fail for numismatic titles. Resolve and persist it here first.
  onStep?.('checking_policies');

  const { data: listingRow } = await supabase
    .from('listings')
    .select('category_id, items(attributes, specialist_id)')
    .eq('id', listingId)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  // Resolve the stored category ID from the listing or item attributes.
  // DO NOT auto-assign specialist fallback IDs — they have NOT been validated
  // against the EBAY_GB Taxonomy API and cause eBay error 21919303.
  // The edge function will use get_category_suggestions to resolve the title
  // if no validated categoryId is present.
  const itemAttributes = (listingRow?.items as any)?.attributes ?? {};
  const attributeCategoryId = String(
    itemAttributes.ebay_category_id ?? itemAttributes._ebay_category_id ?? '',
  ).trim();
  const attributeCategoryName = String(
    itemAttributes.ebay_category_name ?? itemAttributes._ebay_category_name ?? '',
  ).trim();
  const listingCategoryId = String(listingRow?.category_id ?? '').trim();

  // A user-picked category is saved as an ID/name pair on the item as well as
  // listings.category_id. If those records drift, prefer the paired item value:
  // it preserves the category selection instead of silently resubmitting an
  // older imported/listing category ID. Otherwise use the listing's saved ID.
  const storedCategoryId = attributeCategoryId && attributeCategoryName
    ? attributeCategoryId
    : (listingCategoryId || attributeCategoryId);

  if (listingCategoryId && attributeCategoryId && listingCategoryId !== attributeCategoryId) {
    console.warn(
      `[listingService] Category records differ for listing ${listingId}: listings.category_id=${listingCategoryId}, item.attributes.ebay_category_id=${attributeCategoryId}; using ${storedCategoryId} (${attributeCategoryName ? 'paired item category selection' : 'listing fallback'}).`,
    );
  }

  // If there is truly no category set at all, surface a clear error now
  // rather than letting the edge function silently guess (and guess wrong).
  // The edge function will still attempt title-based Taxonomy suggestions as a last resort,
  // but the user should be prompted to use the category picker first for reliable results.
  if (!storedCategoryId) {
    console.log(`[listingService] No categoryId stored for listing ${listingId} — edge function will use title-based Taxonomy suggestions (EBAY_GB)`);
  }

  // Check business policies are selected
  const { data: connRow } = await supabase
    .from('marketplace_connectors')
    .select('selected_fulfillment_policy_id, selected_return_policy_id')
    .eq('tenant_id', tenantId)
    .eq('marketplace_id', 'ebay')
    .maybeSingle();

  if (!connRow?.selected_fulfillment_policy_id) {
    return {
      success: false,
      step: 'failed',
      verificationPassed: true,
      error: 'Your eBay fulfillment (shipping) policy has not been selected. Go to Settings → eBay Connection → tap "Load Policies", then select your shipping policy before listing.',
    };
  }
  if (!connRow?.selected_return_policy_id) {
    return {
      success: false,
      step: 'failed',
      verificationPassed: true,
      error: 'Your eBay return policy has not been selected. Go to Settings → eBay Connection → tap "Load Policies", then select your return policy before listing.',
    };
  }

  // ── Step 3: Notify category resolution is happening (inside edge fn) ─────────
  onStep?.('resolving_category');
  await new Promise(r => setTimeout(r, 300)); // brief pause so UI registers the step

  // ── Step 4: Submit to eBay via real API call ────────────────────────────────
  onStep?.('publishing');

  const { data: ebayData, error: ebayError } = await supabase.functions.invoke('swish-ebay-list', {
    body: {
      tenantId,
      listingId,
      listingType:  auctionParams?.listingType ?? 'FixedPriceItem',
      auctionDays:  auctionParams?.auctionDays  ?? 7,
      startPrice:   auctionParams?.startPrice   ?? undefined,
      reservePrice: auctionParams?.reservePrice ?? undefined,
      // Pass the stored category ID so the edge function can verify/resolve it
      // rather than falling back to title-only Taxonomy guessing
      categoryId: storedCategoryId || undefined,
    },
  });

  if (ebayError) {
    let msg = ebayError.message;
    if (ebayError instanceof FunctionsHttpError) {
      try {
        const statusCode = ebayError.context?.status ?? 0;
        const t = await ebayError.context?.text();
        if (t) {
          // Handle raw HTML 504 gateway responses — never show HTML to the user
          if (t.trim().startsWith('<') || t.includes('504') || t.includes('Gateway')) {
            msg = 'eBay API is responding slowly (gateway timeout). Please retry in a few seconds — your listing has NOT been submitted.';
          } else {
            try {
              const parsed = JSON.parse(t);
              msg = parsed.error ?? parsed.message ?? t;
            } catch {
              msg = t.slice(0, 300);
            }
          }
        } else if (statusCode === 504) {
          msg = 'eBay API is responding slowly (gateway timeout). Please retry in a few seconds — your listing has NOT been submitted.';
        }
      } catch {}
    }
    return {
      success: false,
      step: 'failed',
      verificationPassed: true,
      error: msg,
    };
  }

  if (!ebayData?.success) {
    return {
      success: false,
      step: 'failed',
      verificationPassed: true,
      error: ebayData?.error ?? 'eBay did not confirm the listing was created.',
      failureReasons: ebayData?.errors,
    };
  }

  onStep?.('done');

  return {
    success: true,
    step: 'done',
    verificationPassed: true,
    warnings: [
      ...(verification.warnings ?? []),
      ...verificationAdvisories,
      ...(ebayData.warnings ?? []),
    ],
    publishedAt: ebayData.publishedAt,
    externalListingId: ebayData.externalListingId,
  };
}
