// A documented item-specific provider restriction is not an OAuth or whole-sync failure.
export function isRemovedPolicyListing(message: string): boolean {
 return /^eBay Trading HTTP 200; error codes 21920397$/.test(message);
}
export const SYNC_BATCH_SIZE = 6;
export interface SyncListingIssue { externalListingId: string; code: string; message: string }
