/** One lifecycle interpretation for inventory cards, tab badges and shared clients. */
export function normalizeStatus(value: unknown): string { return String(value ?? '').trim().toLowerCase(); }
export function isSoldStatus(value: unknown): boolean { return ['sold', 'fulfilled', 'completed'].includes(normalizeStatus(value)); }
export function isLiveListing(listing: { status?: unknown; itemStatus?: unknown; externalListingId?: unknown; endedAt?: unknown }): boolean {
  return ['active', 'live'].includes(normalizeStatus(listing.status)) &&
    !isSoldStatus(listing.itemStatus) && !listing.endedAt &&
    typeof listing.externalListingId === 'string' && listing.externalListingId.trim().length > 0;
}
export function isDraftListing(listing: { status?: unknown; itemStatus?: unknown }): boolean {
  return ['draft', 'pending'].includes(normalizeStatus(listing.status)) && !isSoldStatus(listing.itemStatus);
}
