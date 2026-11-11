# Shared seller photographs, barcode scanning and eBay lifecycle

## Delivered changes

- Quick List and the shared eBay editor now select Original, BG removed or Both, per photo or using presets; exact selection/order survives saving and server submission.
- Inventory/capture galleries still prefer processed photos. Choosing an inventory cover no longer overwrites the seller's listing-photo selection.
- Add image / Take photo adds to the same canonical item with the existing bounded immutable photo persistence pipeline. Background removal is optional for these additions. Tap a selected photo to exclude it from eBay; archival photos are not deleted. Select at most 12 views; presets exceeding the limit are disabled rather than truncated. No WYSIWYG crop/retouch editor is claimed.
- Scan barcode is available in the verified shared shell without changing route or abandoning a scan. Barcode/EAN/UPC/ISBN and tracking fields offer camera input alongside manual input; specialist fields and Tunes catalogue share the same scanner. Product matching remains a proposal, not authenticity or condition evidence.
- Every niche offers optional barcode input; specialist-required photographs/review and niche/tenant entitlements remain in force.
- Orders and Dispatch use one SellerOrdersProvider/service/UI; Seller Hub uses the same saved state. Collectibles branded packaging now includes Orders and Dispatch. Database views refresh on focus and poll every 30 seconds while the screen is focused. eBay API synchronization is explicitly invoked through Sync orders, not an unverified continuous background service.

## Order repair

Read-only inspection found historical order logs with PGRST202: the old importer supplied no p_sold_at because it read `createdAt`, while the Fulfillment API returns `creationDate`. It also stored all new order statuses as completed, skipped multi-line carts and fetched only completed Trading orders.

The shared importer now uses creationDate/lastModifiedDate, includes unpaid Trading commitments, refreshes existing orders and old open orders, and atomically saves line identities, payment, shipping, sales and single-unit stock transitions. Both adapters feed the same server-only RPC. Unknown/non-GBP totals and ambiguous multi-line discounts/taxes are reported for review, never silently allocated. Stable transaction keys and aliases prevent unpaid-to-paid ID changes and repeat syncs from creating duplicate line records. Current niche RLS filters determine which listing lines are eligible.

Waiting for payment is not revenue or dispatch-ready. PAID -> awaiting dispatch -> local packing -> dispatch ready -> posted. FULFILLED or a shipping receipt does not prove delivered. Delivered appears only with explicit eBay actual-delivery evidence; untracked/unsupported carrier delivery remains unavailable, not fabricated. Cancelled/refunded records are excluded from dispatch. Historical completed states and ledger records are retained; existing bad duplicates/allocations are not bulk-deleted.

Dispatch rechecks PAID and the exact saved listing/order line, verifies current carrier codes (not service codes), sends only that line, and reads back the shipping package. Untracked mail omits both optional carrier and tracking fields. Missing order IDs/404s never silently mark SWISH dispatched. A persisted claim prevents replay of an unknown submission; Sync orders/eBay shipping review is required after accepted/unconfirmed outcomes. Partial syncs are reported with new/refreshed/skipped counts and errors.

## Verification evidence and limits

- OnSpace Cloud: Ready.
- Read-only DB checks confirmed the original reconciliation RPC exists, inspected current validators and recent sync logs. New additive order columns/indexes/server ingestion RPC installed successfully; client execution denied and service-role execution granted. No existing user rows were changed by installation.
- SQL function installation is not proof of live seller/provider success.
- Pure/mock/source and Deno adapter regressions are provided in the shared seller workflow CI. Jest, TypeScript, Deno and device tests could not be executed in this editor session; no passing run is claimed.
- After code publication, use Sync eBay orders in each authorized niche to reconcile actual account data. Verify an unpaid order, paid order, packed parcel, confirmed dispatch, repeated sync, multi-line cart and explicit delivery on installed iOS/Android. Do not perform a real dispatch unless the parcel has actually been posted.
- Existing APKs need a compatible OTA publication or rebuilt APK; this editing session does not publish an OTA by itself.
- Trading GetOrders is currently deprecated and is scheduled for decommission June 30, 2027. Unpaid item commitments will require the supported GraphQL Order/Item Commitment successor before that cutoff. No GraphQL partner access is assumed.

## Official sources consulted

- https://developer.ebay.com/devzone/xml/docs/reference/ebay/getorders.html
- https://developer.ebay.com/api-docs/sell/static/orders/handling-unfulfilled-lineitems.html
- https://developer.ebay.com/api-docs/sell/fulfillment/types/sel:ShippingFulfillmentDetails

