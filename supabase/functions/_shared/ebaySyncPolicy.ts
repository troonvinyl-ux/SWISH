// A documented item-specific provider restriction is not an OAuth or whole-sync failure.
export function isRemovedPolicyListing(message: string): boolean {
 return /^eBay Trading HTTP 200; error codes 21920397$/.test(message);
}
/** A per-listing read-only GetItem request reached its own 20-second
 * transport deadline. Never treat auth, provider HTTP failures, malformed
 * observations or uncertain database writes as isolated timeouts. */
export function isIsolatedGetItemTimeout(cause: unknown): boolean {
 return cause instanceof Error && cause.name === 'TimeoutError';
}
export const SYNC_BATCH_SIZE = 6;
export interface SyncListingIssue { externalListingId: string; code: string; message: string }

/** Reveal only fixed, tenant-scoped reconciliation stages, never SQL payloads,
 * access tokens, seller secrets, or arbitrary backend errors. */
export function safeReconciliationIssue(externalListingId: string, cause: unknown): SyncListingIssue {
 const reason=cause instanceof Error?cause.message:'';
 const stages: Array<[RegExp,string,string]> = [
  [/^SWISH photo readback mismatch$/, 'SWISH_PHOTO_READBACK', 'Saved photos could not be verified after reconciliation. Originals were not deliberately removed.'],
  [/^SWISH listing status readback mismatch$/, 'SWISH_STATUS_READBACK', 'The verified eBay status was not reflected in the saved listing. Review this item.'],
  [/^SWISH sync persisted readback failed$/, 'SWISH_READBACK', 'The saved listing or linked stock could not be verified after reconciliation.'],
  [/^SWISH canonical item status conflicts with verified eBay observation$/, 'SWISH_STATUS_CONFLICT', 'The eBay observation conflicts with an existing sold or protected stock state. Manual review is required.'],
  [/^SWISH canonical listing status could not be persisted$/, 'SWISH_STATUS_WRITE', 'The canonical listing status update could not be confirmed.'],
  [/^SWISH item metadata save not confirmed/, 'SWISH_ITEM_WRITE', 'Stock metadata changed or the save was not confirmed. Reload this item before retrying.'],
  [/^SWISH listing metadata save not confirmed/, 'SWISH_LISTING_WRITE', 'Listing metadata changed or the save was not confirmed. Reload before retrying.'],
  [/^SWISH scoped item reload unavailable$/, 'SWISH_ITEM_READ', 'The shared stock record could not be verified in this specialist.'],
  [/^SWISH sync deadline reached$/, 'SWISH_DEADLINE', 'The bounded sync deadline was reached before this listing was reconciled.'],
 ];
 const stage=stages.find(([pattern])=>pattern.test(reason));
 return {externalListingId,code:stage?.[1]??'SWISH_RECONCILIATION_UNCONFIRMED',message:stage?.[2]??'A saved listing reconciliation could not be confirmed. No new eBay listing was created.'};
}
