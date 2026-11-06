// Publication evidence and status-only recovery. Never sends AddItem/AddFixedPriceItem.
import { FunctionsHttpError } from '@supabase/supabase-js';
import { getSupabaseClient } from '@/template';
import { resolveProductionNiche } from './nicheRouting';

export interface ListingPublication {
  listingId: string; itemId: string; nicheId: string; externalListingId: string;
  status: string; itemStatus: string; publishedAt?: string; endedAt?: string;
  claimPending: boolean; recorded: boolean; live: boolean; reconciled: boolean;
}
export function mapListingPublication(row: any): ListingPublication {
  const item = Array.isArray(row.items) ? row.items[0] : row.items;
  const externalListingId = String(row.external_listing_id ?? '').trim();
  const status = String(row.status ?? '').trim().toLowerCase();
  const itemStatus = String(item?.status ?? '').trim().toLowerCase();
  const recorded = /^\d+$/.test(externalListingId);
  const live = recorded && ['active', 'live'].includes(status) && !row.ended_at;
  const reconciled = live ? ['listed', 'active'].includes(itemStatus) && !item?.sold_at
    : recorded && (status === 'sold' ? ['sold', 'fulfilled', 'completed'].includes(itemStatus)
      : status === 'ended' && !['listed', 'active'].includes(itemStatus));
  return { listingId: row.id, itemId: row.item_id, nicheId: resolveProductionNiche(item?.specialist_id) ?? '',
    externalListingId, status, itemStatus, publishedAt: row.published_at ?? undefined,
    endedAt: row.ended_at ?? undefined, claimPending: Boolean(row.publish_claim_id), recorded, live, reconciled };
}
export async function readListingPublication(tenantId: string, listingId: string): Promise<{ publication: ListingPublication | null; error: string | null }> {
  if (!tenantId?.trim() || !listingId?.trim()) return { publication: null, error: 'Open a saved listing in your workspace.' };
  try {
    const { data, error } = await getSupabaseClient().from('listings')
      .select('id,item_id,status,external_listing_id,published_at,ended_at,publish_claim_id,items!inner(tenant_id,specialist_id,status,sold_at)')
      .eq('id', listingId).eq('tenant_id', tenantId).eq('marketplace_id', 'ebay').maybeSingle();
    if (error || !data) return { publication: null, error: error?.message ?? 'Saved listing could not be checked.' };
    const item = Array.isArray(data.items) ? data.items[0] : data.items;
    if (item?.tenant_id !== tenantId || !resolveProductionNiche(item?.specialist_id)) return { publication: null, error: 'Listing is outside this verified workspace.' };
    return { publication: mapListingPublication(data), error: null };
  } catch { return { publication: null, error: 'Saved listing status is unavailable. Do not republish until it has been checked.' }; }
}
export async function reconcileListingPublication(tenantId: string, listingId: string, nicheId: string): Promise<{ publication: ListingPublication | null; error: string | null }> {
  const initial = await readListingPublication(tenantId, listingId);
  if (initial.error || !initial.publication) return initial;
  const publication = initial.publication;
  if (!nicheId || publication.nicheId !== resolveProductionNiche(nicheId)) return { publication, error: 'Open the listing in its original specialist workspace.' };
  if (!publication.recorded) return { publication, error: 'The saved eBay ID is not yet available. Use eBay account synchronisation and inspect the existing item; do not submit again.' };
  try {
    const { data, error } = await getSupabaseClient().functions.invoke('swish-ebay-listing-status', {
      body: { tenantId, nicheId: publication.nicheId, listingIds: [listingId] },
    });
    if (error) {
      let message = 'The existing eBay listing could not be synchronised. Nothing was republished.';
      if (error instanceof FunctionsHttpError) {
        try { const payload = JSON.parse(await error.context.text()); if (typeof payload?.error === 'string') message = payload.error; } catch { /* Never display gateway HTML. */ }
      }
      return { publication, error: message };
    }
    const observed = data?.results?.find((row: any) => row.listingId === listingId);
    if (data?.success !== true || observed?.error || !['active', 'sold', 'ended'].includes(observed?.status)) return { publication, error: observed?.error ?? data?.error ?? 'eBay status reconciliation is not confirmed. Nothing was republished.' };
    const refreshed = await readListingPublication(tenantId, listingId);
    if (refreshed.error || !refreshed.publication) return { publication, error: refreshed.error ?? 'Status readback unavailable.' };
    if (refreshed.publication.externalListingId !== publication.externalListingId || refreshed.publication.status !== observed.status || !refreshed.publication.reconciled) return { publication: refreshed.publication, error: 'eBay was checked, but the saved listing and stock status still need review. Do not republish.' };
    return refreshed;
  } catch { return { publication, error: 'Synchronisation is unavailable. Your existing eBay listing was not changed or republished.' }; }
}
