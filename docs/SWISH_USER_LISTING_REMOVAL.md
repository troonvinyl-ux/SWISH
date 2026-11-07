# User listing removal — shared SWISH flow

## What users can do

1. Open a live inventory item. Use **End** or **More → Delete listing · end on eBay first**.
2. Confirm **End on eBay**. SWISH reads seller GetItem, selects the correct end API for fixed-price/auction, then reads GetItem again. A provider Ack alone is not a confirmed end.
3. On a confirmed end and saved reconciliation, return to **Inventory → In Stock**. The physical item, photographs and ended reference are retained.
4. Use **Delete** on the inventory card, or **Delete inventory item** in its overview. This asks for a separate irreversible-deletion confirmation.
5. An unpublished draft also has **Delete draft listing**, which deletes only that draft and leaves its inventory item available.

No live listing is automatically ended by Delete item. No combined End-and-delete action remains. Regular entitled users can use this flow; no owner grant is required. Existing owner-only inventory-status preservation remains separately protected.

## Safeguards

- Tenant/niche authorization and fresh server eligibility check precede every item removal.
- A database BEFORE DELETE guard repeats the check; pending publication claims, live/unconfirmed listings, sold quantities and sale/order/return history block deletion.
- Every published eBay relationship must have an unsold seller GetItem end receipt matching its exact listing/item/account/external identity. Clients have no receipt INSERT/UPDATE/DELETE privilege.
- Published IDs cannot be cleared or moved to bypass the guard. New listings and publish claims lock the parent inventory row against deletion races.
- Ended relationships cannot be deleted independently; they remain until the explicitly confirmed, eligible inventory deletion cascades.
- Partial sales may end remaining available stock, but removal of sale history remains blocked.
- Timed-out end requests are not automatically retried. A subsequent deliberate end attempt starts with GetItem and performs no End call if already ended.
- Inventory cards refresh after changes; successful item removal immediately removes its card from the shared snapshot and requests fresh canonical counts.
- Original storage objects are not purged by this feature. Users are told that stored original photo files are retained.

## Files

- `app/(tabs)/inventory.tsx`
- `app/stock-listing/[id].tsx`
- `hooks/useMasterInventory.ts`
- `hooks/useInventoryRemoval.ts`
- `components/feature/InventoryRemovalPanel.tsx`
- `services/itemService.ts`
- `services/listingService.ts`
- `supabase/functions/swish-ebay-list/index.ts`
- `supabase/functions/_shared/ebayEndPolicy.ts`
- `supabase/migrations/20261118_user_listing_removal.sql`
- `services/__tests__/inventoryRemoval.test.ts`
- `supabase/tests/ebay_end_policy.test.ts`
- `supabase/tests/listing_removal_readonly.sql`
- `.github/workflows/listing-removal-verification.yml`

## Verification actually performed in this editor

- Installed the receipt table, RLS/grants and three deletion/concurrency guards without changing or deleting production records.
- Executed the unauthenticated eligibility negative test: denied.
- Verified authenticated clients cannot insert, change or delete receipts, and cannot call the private predicate.
- Executed the read-only predicate for 32 existing items: 16 eligible records, 16 blocked records. This proves installed query execution only, not subscriber end/delete acceptance.
- Final preservation check: 764 canonical items and 764 canonical projection rows; zero end receipts created. No eBay call or inventory deletion was performed.
- A schema-only hardening attempt exposed a PL/pgSQL CASE syntax issue; replaced it with the installed, executable regex-based positive-sale check. The committed migration uses the corrected definition.

## Not yet verified

This editor cannot execute TypeScript, Jest, Deno, Android/web builds or installed-device tests. New injected/mocked tests and a focused CI workflow were added; existing tests were not removed or modified. The existing production acceptance runner also discovers the new Deno suite.

Live account end → In Stock → Delete, separate cancellation at each confirmation, multi-listing items, auction restrictions, partial sales, failure recovery and native/web UI parity still require approved account/device testing. Deployment of the changed Edge source is not attested here. No successful deployment or production-readiness certification is claimed.
