import { getSupabaseClient } from '@/template';
import { backendRead, shareBackendRequest } from './backendRequestService';
import { resolveProductionNiche } from './nicheRouting';
import { parseCanonicalCounts } from './canonicalInventoryService';
export interface NicheListingMetrics { activeListings: number; draftListings: number; endedListings: number; totalListings: number }
export function parseNicheListingMetrics(value: unknown): NicheListingMetrics {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Listing metrics are unavailable.');
  const row = value as Record<string, unknown>;
  const counts = parseCanonicalCounts(row.inventory_counts);
  for (const key of ['total_listings', 'ended_listings']) {
    if (typeof row[key] !== 'number' || !Number.isSafeInteger(row[key]) || (row[key] as number) < 0) throw new Error('Listing metric contract was not confirmed.');
  }
  const total = row.total_listings as number, ended = row.ended_listings as number;
  if (counts.liveListings + ended > total) throw new Error('Listing identities are inconsistent.');
  return { activeListings: counts.liveListings, draftListings: counts.draft, endedListings: ended, totalListings: total };
}
/** Exact, tenant/niche-scoped stored metrics. Never a provider refresh or a capped row sample. */
export function readNicheListingMetrics(tenantId: string, nicheId: string): Promise<NicheListingMetrics> {
  const niche = resolveProductionNiche(nicheId);
  if (!tenantId?.trim() || !niche) return Promise.reject(new Error('Open a verified workspace and niche to read listing counts.'));
  return shareBackendRequest(`niche-listing-metrics:${tenantId}:${niche}`, async () => {
    const { data, error } = await backendRead(`niche-listing-metrics:${tenantId}:${niche}`, signal => getSupabaseClient().rpc('swish_niche_listing_metrics', { p_tenant_id: tenantId, p_niche_id: niche }).abortSignal(signal));
    if (error) throw new Error(error.message);
    return parseNicheListingMetrics(data);
  });
}
