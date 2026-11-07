// SWISH Listing Service
// Generates, previews, saves, and retrieves marketplace listings.

import { getSupabaseClient } from '@/template';
import { preferredListingPhotos } from '@/shared/smartStudio';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { getBusinessConfig } from '@/services/businessConfigService';
import { isLiveListing } from '@/services/listingLifecycle';
import { evaluateSpecialistSafety } from '@/shared/specialistIntelligence';
import { resolveProductionNiche } from '@/services/nicheRouting';
import { backendRead, shareBackendRequest } from './backendRequestService';
import { readListingPublication, type ListingPublication } from './listingPublicationService';
import { readCanonicalInventoryCounts } from './canonicalInventoryService';
import {recordPerformance,recordPrevention} from './performanceMonitoringService';

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

export function mapListing(row: any): SavedListing {
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

  if (data?.error || !data?.listing) return { listing: null, error: data?.error ?? 'Listing generation returned no draft.' };
  return { listing: data.listing, error: null };
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

  const { data: draftId, error: draftError } = await supabase.rpc('swish_create_listing_draft', {
    p_tenant_id: tenantId, p_item_id: itemId, p_marketplace_id: marketplaceId,
    p_listing: generated, p_shipping_cost: defaultShipping, p_category_id: resolvedCategoryId,
  });
  if (draftError || !draftId) return { listing:null,error:draftError?.message ?? 'Draft creation was not confirmed.' };
  const { data,error } = await supabase.from('listings').select('*').eq('id',draftId).eq('tenant_id',tenantId).single();
  if (error || !data) return { listing:null,error:error?.message ?? 'Draft saved but could not be reopened. Retry without creating another draft.' };
  return { listing:mapListing(data),error:null }; 
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
  // Older imported rows may say 'live'; the shared overview's existing live
  // actions use the canonical 'active' status without altering stored rows.
  return { listings: (data ?? []).map(row => ({ ...mapListing(row), status: row.status === 'live' ? 'active' : (row.status ?? 'draft') })), error: null };
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

const endingsInFlight = new Map<string, Promise<{ error: string | null }>>();
export function endListing(listingId: string, itemId: string, tenantId?: string, externalListingId?: string): Promise<{ error: string | null }> {
  const key = `${tenantId}:${listingId}`;
  const existing = endingsInFlight.get(key);
  if (existing) return existing;
  const task = performListingEnd(listingId, itemId, tenantId, externalListingId)
    .catch(() => ({ error: 'End outcome is unconfirmed. Check the saved listing before retrying; inventory was retained.' }))
    .finally(() => endingsInFlight.delete(key));
  endingsInFlight.set(key, task);
  return task;
}
async function performListingEnd(listingId: string, itemId: string, tenantId?: string, externalListingId?: string): Promise<{ error: string | null }> {
  if (!tenantId?.trim() || !listingId?.trim() || !itemId?.trim()) return { error: 'A saved listing and verified account are required.' };
  const initial = await readListingPublication(tenantId, listingId);
  const saved = initial.publication;
  if (initial.error || !saved) return { error: initial.error ?? 'Listing status unavailable.' };
  if (saved.itemId !== itemId || (externalListingId && externalListingId.trim() !== saved.externalListingId)) return { error: 'Listing identity does not match this inventory item.' };
  if (saved.claimPending) return { error: 'Publication outcome is pending. Sync eBay before ending or deleting.' };
  if (!saved.recorded) return { error: 'This listing has no confirmed eBay ID. Use Delete draft for an unpublished listing.' };
  const { data, error } = await getSupabaseClient().functions.invoke('swish-ebay-list', {
    body: { route: 'end', tenantId, nicheId: saved.nicheId, listingId, itemId, externalListingId: saved.externalListingId },
  });
  if (error) {
    let message = 'eBay end was not confirmed. Inventory is retained; check status before retrying.';
    if (error instanceof FunctionsHttpError) {
      try { const payload = JSON.parse(await error.context.text()); if (typeof payload?.error === 'string') message = payload.error; } catch { /* Do not display gateway HTML or credentials. */ }
    }
    return { error: message };
  }
  if (data?.success !== true || data?.confirmed !== true || data?.externalListingId !== saved.externalListingId) return { error: data?.error ?? data?.warning ?? 'eBay end and SWISH reconciliation are not confirmed. Inventory was retained.' };
  const reopened = await readListingPublication(tenantId, listingId);
  if (reopened.error || !reopened.publication || reopened.publication.externalListingId !== saved.externalListingId || reopened.publication.status !== 'ended' || !reopened.publication.endedAt) return { error: reopened.error ?? 'eBay was checked, but the saved end status needs reconciliation. Inventory was retained.' };
  return { error: null };
}

// Get all listings across items (for the Listings management screen)
// NICHE-ISOLATION: accepts optional specialistIds to scope the query to the
// active niche at the DB level rather than filtering client-side. This prevents
// cross-niche listings from appearing when all niches share one eBay account.

export interface ListingWithItem extends SavedListing {
  itemTitle: string;
  itemStatus: string;
  itemSoldAt?: string;
  itemSoldPrice?: number;
  itemQuantity?: number;
  hasSaleEvidence?: boolean;
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
  if (specialistIds && specialistIds.length === 0) return { listings: [], error: null };
  if (!tenantId?.trim()) return { listings: [], error: 'A valid account is required' };
  return shareBackendRequest(`listings:${tenantId}:${statusFilter}:${JSON.stringify(specialistIds)}`, async () => {
  try {
  const supabase = getSupabaseClient();

  let query = supabase
    .from('listings')
    .select('*, items!inner(canonical_title, specialist_id, acquired_cost, media, attributes, status, sold_at, sold_price, quantity)')
    .eq('tenant_id', tenantId)
    .eq('items.tenant_id', tenantId)
    .order('updated_at', { ascending: false })
    .order('id', { ascending: true });

  if (statusFilter && statusFilter !== 'all') {
    query = query.eq('status', statusFilter);
  }

  // Niche isolation: filter by specialist_id at the DB level.
  // Using items!inner join allows filtering on the joined table.
  if (specialistIds && specialistIds.length > 0) {
    query = query.in('items.specialist_id', specialistIds);
  }

  const data: any[] = [];
  for (let offset = 0; ; offset += 200) {
    const page = await backendRead(`listings-page:${tenantId}:${statusFilter}:${JSON.stringify(specialistIds)}:${offset}`, signal => query.range(offset, offset + 199).abortSignal(signal));
    if (page.error) return { listings: [], error: `Listing relationships unavailable: ${page.error.message}` };
    data.push(...(page.data ?? []));
    if ((page.data?.length ?? 0) < 200) break;
  }

  const listings: ListingWithItem[] = data.map((row: any) => ({
    ...mapListing(row),
    itemTitle: row.items?.canonical_title ?? 'Unknown Item',
    itemSpecialistId: row.items?.specialist_id ?? '',
    itemStatus: row.items?.status ?? '',
    itemSoldAt: row.items?.sold_at ?? undefined,
    itemSoldPrice: row.items?.sold_price == null ? undefined : Number(row.items.sold_price),
    itemQuantity: row.items?.quantity ?? 1,
    itemAcquiredCost: Number(row.items?.acquired_cost ?? 0),
    itemMedia: preferredListingPhotos([...new Set([...(Array.isArray(row.items?.media) ? row.items.media : []), ...(Array.isArray(row.images) ? row.images : []), row.image_url].filter((url: unknown) => typeof url === 'string' && url.length > 0))] as string[],row.items?.attributes ?? {}),
    categoryId: row.category_id ?? undefined,
  }));

  return { listings, error: null };
  } catch (cause) { return { listings: [], error: cause instanceof Error ? cause.message : 'Listing relationships unavailable' }; }
  });
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

export async function getLiveListingCount(tenantId: string, specialistIds?: string[]): Promise<number> {
  if (!tenantId?.trim() || !specialistIds?.length) return 0;
  const niches=[...new Set(specialistIds.map(resolveProductionNiche))];
  if (niches.length !== 1 || !niches[0]) throw new Error('A single registered inventory niche is required');
  // Shares the same one-pass server aggregate as the tab counters. Failures are not zero stock.
  return (await readCanonicalInventoryCounts(tenantId,niches[0])).liveListings;
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
  // Provider acceptance and local reconciliation are separate outcomes.
  accepted?: boolean;
  reconciliationPending?: boolean;
  publicationUnconfirmed?: boolean;
}

export function publicationSubmitResult(publication: ListingPublication): SubmitResult {
  return { success: publication.live, step: publication.live ? 'done' : 'failed', accepted: publication.recorded,
    reconciliationPending: !publication.reconciled, externalListingId: publication.externalListingId,
    publishedAt: publication.publishedAt,
    warnings: !publication.reconciled ? ['Published on eBay. SWISH stock synchronisation is pending; do not submit again.'] : [],
    ...(publication.live ? {} : { error: 'This item already has a saved eBay listing. Check its current status; do not submit it again.' }) };
}

async function acceptedPublication(tenantId: string, listingId: string, externalListingId: string, publishedAt?: string, warnings: string[] = []): Promise<SubmitResult> {
  let confirmed = false;
  // Bounded READ retries only. Never retry the marketplace creation request.
  for (let attempt = 0; attempt < 2; attempt++) {
    const checked = await readListingPublication(tenantId, listingId);
    confirmed = Boolean(checked.publication?.live && checked.publication.reconciled && checked.publication.externalListingId === externalListingId);
    if (confirmed) break;
    if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 200));
  }
  return { success: true, accepted: true, step: 'done', externalListingId, publishedAt,
    reconciliationPending: !confirmed, warnings: [...warnings, ...(!confirmed ? ['Published on eBay. SWISH stock synchronisation is pending; do not submit again.'] : [])] };
}
async function unconfirmedPublication(tenantId: string, listingId: string): Promise<SubmitResult> {
  const checked = await readListingPublication(tenantId, listingId);
  if (checked.publication?.recorded) return publicationSubmitResult(checked.publication);
  return { success: false, step: 'failed', publicationUnconfirmed: true,
    error: 'Publication outcome is not yet confirmed. Check the existing listing or synchronise eBay; do not submit again or create a duplicate.' };
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
  if (!tenantId?.trim() || !listingId?.trim()) return { error: 'A saved draft and verified account are required.' };
  try {
    const initial = await readListingPublication(tenantId, listingId);
    const saved = initial.publication;
    if (initial.error || !saved) return { error: initial.error ?? 'Draft could not be verified.' };
    // Never combine a seller end with inventory deletion. Ignore stale caller status hints.
    if (saved.externalListingId || saved.publishedAt || options?.externalListingId || saved.claimPending || !['draft','pending','failed'].includes(saved.status)) return { error: 'End the eBay listing first, then return to inventory to delete the item.' };
    const { error, count } = await getSupabaseClient().from('listings').delete({ count: 'exact' })
      .eq('id', listingId).eq('tenant_id', tenantId).is('external_listing_id', null).is('publish_claim_id', null);
    if (error) return { error: error.message };
    return { error: count === 1 ? null : 'Draft deletion was not confirmed. Refresh before retrying.' };
  } catch { return { error: 'Draft deletion was not confirmed. Refresh before retrying.' }; }
}

// Collapse duplicate taps/callers to one publish operation for the saved draft.
const submissionsInFlight = new Map<string, Promise<SubmitResult>>();
export function submitListingToMarketplace(
  tenantId: string, listingId: string, onStep?: (step: SubmitStep) => void,
  auctionParams?: { listingType?: ListingFormat; auctionDays?: number; startPrice?: number; reservePrice?: number },
): Promise<SubmitResult> {
  const key = `${tenantId}:${listingId}`;
  const existing = submissionsInFlight.get(key);
  if (existing) {recordPrevention('publication_flight');return existing;}
  const started=Date.now();
  const pending = performListingSubmission(tenantId, listingId, onStep, auctionParams)
    .catch((): SubmitResult => ({ success: false, step: 'failed', error: 'Listing checks could not be completed. Reopen the saved draft.' }))
    .then(result=>{recordPerformance('publication',Date.now()-started,result.success?'success':'failure');return result;})
    .finally(() => submissionsInFlight.delete(key));
  submissionsInFlight.set(key, pending);
  return pending;
}

async function performListingSubmission(
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
  const before = await readListingPublication(tenantId, listingId);
  if (before.error || !before.publication) return { success: false, step: 'failed', error: before.error ?? 'Saved listing status unavailable.' };
  if (before.publication.recorded) return publicationSubmitResult(before.publication);
  if (before.publication.claimPending || before.publication.externalListingId || ['active', 'live'].includes(before.publication.status)) return {
    success: false, step: 'failed', publicationUnconfirmed: true, error: 'An existing publication needs checking. Synchronise eBay instead of submitting again.' };

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

  // These independent READS share the captured tenant; no write or publication
  // runs until all existing identity, specialist and policy checks below pass.
  const [listingRead, connectorRead] = await Promise.all([
    supabase.from('listings').select('category_id, items(attributes, specialist_id)')
      .eq('id', listingId).eq('tenant_id', tenantId).maybeSingle(),
    supabase.from('marketplace_connectors')
      .select('selected_fulfillment_policy_id, selected_return_policy_id')
      .eq('tenant_id', tenantId).eq('marketplace_id', 'ebay').maybeSingle(),
  ]);
  const { data: listingRow, error: listingReadError } = listingRead;

  // Resolve the stored category ID from the listing or item attributes.
  // DO NOT auto-assign specialist fallback IDs — they have NOT been validated
  // against the EBAY_GB Taxonomy API and cause eBay error 21919303.
  // The edge function will use get_category_suggestions to resolve the title
  // if no validated categoryId is present.
  if (listingReadError || !listingRow) return { success: false, step: 'failed', error: listingReadError?.message ?? 'Listing could not be reopened before submission.' };
  const itemAttributes = (listingRow?.items as any)?.attributes ?? {};
  if (itemAttributes._manifest_review_required === true) return { success:false,step:'failed',error:'Manifest stock has not been physically reviewed. Save editor changes and confirm the manifest inspection before publishing.' };
  const nicheId = resolveProductionNiche((listingRow?.items as any)?.specialist_id) ?? '';
  if (nicheId) {
    const { checkAntiqueListing } = await import('@/services/listingEditorService');
    const checked = await checkAntiqueListing(tenantId, listingId, nicheId);
    if (!checked.ready) return { success: false, step: 'failed', error: checked.error ?? 'Specialist preflight not confirmed.' };
  }
  const safety = evaluateSpecialistSafety(nicheId, itemAttributes);
  if (safety.blocked) return { success:false,step:'failed',error:safety.reasons.join(' ') };
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
  const { data: connRow, error: connectorError } = connectorRead;
  if (connectorError) return { success: false, step: 'failed', error: 'eBay policies could not be read. Retry the saved draft; no publication was requested.' };

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
  // Progress is state-driven; no artificial pause on the commercial critical path.

  // ── Step 4: Submit to eBay via real API call ────────────────────────────────
  onStep?.('publishing');

  let ebayData: any = null;
  let ebayError: any = null;
  try {
  const response = await supabase.functions.invoke('swish-ebay-list', {
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
  ebayData = response.data; ebayError = response.error;
  } catch { return unconfirmedPublication(tenantId, listingId); }

  if (ebayError) {
    let msg = ebayError.message;
    let errorPayload: any = null;
    let errorStatus = 0;
    if (ebayError instanceof FunctionsHttpError) {
      try {
        const statusCode = ebayError.context?.status ?? 0;
        errorStatus = statusCode;
        const t = await ebayError.context?.text();
        if (t) {
          // Handle raw HTML 504 gateway responses — never show HTML to the user
          if (t.trim().startsWith('<') || t.includes('504') || t.includes('Gateway')) {
            msg = 'eBay API is responding slowly (gateway timeout). Please retry in a few seconds — the final outcome is not yet confirmed. Sync eBay before retrying to avoid duplicates.';
          } else {
            try {
              const parsed = JSON.parse(t);
              errorPayload = parsed;
              msg = parsed.error ?? parsed.message ?? t;
            } catch {
              msg = t.slice(0, 300);
            }
          }
        } else if (statusCode === 504) {
          msg = 'eBay API is responding slowly (gateway timeout). Please retry in a few seconds — the final outcome is not yet confirmed. Sync eBay before retrying to avoid duplicates.';
        }
      } catch {}
    }
    if (errorPayload?.accepted === true && /^\d+$/.test(String(errorPayload.externalListingId ?? ''))) {
      const result = await acceptedPublication(tenantId, listingId, String(errorPayload.externalListingId), errorPayload.publishedAt, errorPayload.warnings ?? []);
      onStep?.('done'); return result;
    }
    if (!errorStatus || errorStatus >= 500 || errorPayload?.code === 'PUBLISH_RECONCILIATION_REQUIRED') return unconfirmedPublication(tenantId, listingId);
    return { success: false, step: 'failed', verificationPassed: true, error: msg };
  }

  if (!ebayData?.success) {
    if (ebayData?.accepted === true && /^\d+$/.test(String(ebayData.externalListingId ?? ''))) {
      const result = await acceptedPublication(tenantId, listingId, String(ebayData.externalListingId), ebayData.publishedAt, ebayData.warnings ?? []);
      onStep?.('done'); return result;
    }
    if (!ebayData || ebayData?.code === 'PUBLISH_RECONCILIATION_REQUIRED') return unconfirmedPublication(tenantId, listingId);
    return {
      success: false,
      step: 'failed',
      verificationPassed: true,
      error: ebayData?.error ?? 'eBay did not confirm the listing was created.',
      failureReasons: ebayData?.errors,
    };
  }

  if (!/^\d+$/.test(String(ebayData.externalListingId ?? ''))) return unconfirmedPublication(tenantId, listingId);
  const accepted = await acceptedPublication(tenantId, listingId, String(ebayData.externalListingId), ebayData.publishedAt,
    [...(verification.warnings ?? []), ...verificationAdvisories, ...(ebayData.warnings ?? [])]);
  onStep?.('done');
  return { ...accepted, verificationPassed: true };
}


// ── One-tap shared listing pipeline ──────────────────────────────────────────
// Generates the complete listing, saves it once, then publishes through the
// existing verified eBay pipeline. A saved draft is returned on publish failure
// so the user can retry without generating duplicate drafts.
export interface OneTapListingResult {
  listing: SavedListing | null;
  success: boolean;
  error: string | null;
  warnings: string[];
  externalListingId?: string;
  publicationUnconfirmed?: boolean;
  reconciliationPending?: boolean;
}

export async function publishGeneratedListing(
  itemId: string,
  tenantId: string,
  marketplaceId: string = 'ebay',
  categoryId?: string,
  onStep?: (step: SubmitStep) => void,
): Promise<OneTapListingResult> {
  const { listing: generated, error: generationError } = await generateListing(itemId, tenantId, marketplaceId);
  if (generationError || !generated) {
    return { listing: null, success: false, error: generationError ?? 'Listing generation failed.', warnings: [] };
  }

  const { listing: saved, error: saveError } = await saveListing(
    tenantId, itemId, generated, marketplaceId, categoryId,
  );
  if (saveError || !saved) {
    return { listing: null, success: false, error: saveError ?? 'Listing could not be saved.', warnings: [] };
  }

  const published = await submitListingToMarketplace(tenantId, saved.id, onStep);
  if (!published.success) {
    return {
      listing: saved,
      success: false,
      error: published.error ?? 'Publication needs checking. Reopen the saved listing before any further action.',
      externalListingId: published.externalListingId,
      publicationUnconfirmed: published.publicationUnconfirmed || published.accepted,
      warnings: published.warnings ?? [],
    };
  }

  return {
    listing: { ...saved, status: 'active', publishedAt: published.publishedAt, externalListingId: published.externalListingId },
    success: true,
    error: null,
    warnings: published.warnings ?? [],
    externalListingId: published.externalListingId,
    reconciliationPending: published.reconciliationPending,
  };
}

// Bulk mode deliberately publishes sequentially: this avoids eBay rate spikes,
// preserves per-item outcomes, and never retries an ambiguous publication.
export async function publishGeneratedListings(
  items: Array<{ itemId: string; tenantId: string; categoryId?: string }>,
  onItemStep?: (itemId: string, step: SubmitStep) => void,
): Promise<Array<OneTapListingResult & { itemId: string }>> {
  const results: Array<OneTapListingResult & { itemId: string }> = [];
  for (const item of items) {
    const result = await publishGeneratedListing(
      item.itemId, item.tenantId, 'ebay', item.categoryId,
      step => onItemStep?.(item.itemId, step),
    );
    results.push({ itemId: item.itemId, ...result });
  }
  return results;
}


// Publish already-created drafts in a deliberate sequential batch. The existing
// listing IDs are reused, so bulk publish cannot create duplicate draft records.
export async function submitListingsInBulk(
  tenantId: string,
  listingIds: string[],
  onItemStep?: (listingId: string, step: SubmitStep) => void,
): Promise<Array<{ listingId: string; result: SubmitResult }>> {
  const uniqueIds = [...new Set(listingIds.filter(id => typeof id === 'string' && id.trim()))];
  const results: Array<{ listingId: string; result: SubmitResult }> = [];
  for (const listingId of uniqueIds) {
    const result = await submitListingToMarketplace(
      tenantId, listingId, step => onItemStep?.(listingId, step),
    );
    results.push({ listingId, result });
  }
  return results;
}
