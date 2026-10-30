/** Shared lifecycle guard: explicit sold evidence outranks stale active labels. */
export function normalizeStatus(value: unknown): string { return String(value ?? '').trim().toLowerCase(); }
export function isSoldStatus(value: unknown): boolean { return ['sold', 'fulfilled', 'completed'].includes(normalizeStatus(value)); }
export interface ListingLifecycleEvidence {
  status?: unknown; itemStatus?: unknown; externalListingId?: unknown; endedAt?: unknown;
  itemSoldAt?: unknown; hasSaleEvidence?: boolean; itemQuantity?: number;
}
export function isSoldListing(listing: ListingLifecycleEvidence): boolean {
  return isSoldStatus(listing.status) || isSoldStatus(listing.itemStatus) || Boolean(listing.itemSoldAt)
    || (listing.hasSaleEvidence === true && (listing.itemQuantity ?? 1) <= 1);
}
export function isLiveListing(listing: ListingLifecycleEvidence): boolean {
  return ['active', 'live'].includes(normalizeStatus(listing.status)) &&
    !isSoldListing(listing) && !listing.endedAt &&
    typeof listing.externalListingId === 'string' && listing.externalListingId.trim().length > 0;
}
export function isDraftListing(listing: ListingLifecycleEvidence): boolean {
  return ['draft', 'pending', 'failed'].includes(normalizeStatus(listing.status)) && !isSoldListing(listing)
    && !listing.endedAt && !String(listing.externalListingId ?? '').trim();
}
