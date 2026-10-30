# Inventory tab status and niche isolation — 30 October 2026

## Verified cause
The Ephesos coin in the screenshot is stored under eBay ID `800434360561`, with two independent import records in two different tenants. Both currently have an active listing and no stored sale/order or sold timestamp. A client-only `item.status !== sold` filter cannot discover the sale shown on eBay. No screenshot-based financial updates, cross-tenant record merging, or manual reclassification were performed.

The live database also contained 11 active listings attached to sold inventory. Those records are now excluded by the shared derived tab query without rewriting history.

## Implementation
- Added `swish_inventory_tab_rows`, a PostgreSQL 15 security-invoker view over the existing items, listings, orders and sales. Existing table RLS remains effective.
- Sold status/timestamps, sold listings and completed sale/order evidence take precedence over stale active labels. Ledger evidence alone does not exhaust a multi-quantity listing.
- Stock excludes sold/archived items and items with eligible draft/live listings. Draft requires a local unpublished listing. Live requires an external identity, active state, no ended timestamp and no terminal sold evidence. Sold is shown once per canonical item.
- Every tab request filters account, canonical niche specialist allow-list and tab at the database before paginating. Counts are separate exact, head-only requests against the same projection. Unknown niche/empty account scopes never broaden to all inventory.
- Applied the same mechanism to all ten registered niches, including their established legacy specialist IDs. No registry identities or entitlement rules changed.
- Added authenticated `swish-ebay-listing-status`: bounded batches of up to 12 stored listing IDs, four concurrent GetItem calls, encrypted credential handling and explicit account/niche validation. It never creates external listings or guesses sale prices.
- Added service-role-only atomic status reconciliation with row locks, preserved canonical IDs, lifecycle/audit events on changes and observation timestamps. It refuses to resurrect sold inventory from a contradictory Active response.
- Opening Live performs an automatic status check, at most once per account/niche every five minutes per session. The header Sync control runs it manually from any tab. Progress and failures are visible; failed checks retain existing unverified state. UI updates after batches and the badge uses the same sold exclusions.
- Existing full eBay sync now recognizes exhausted quantity, preserves sold canonical state, refreshes all existing matching import records rather than dropping duplicate links, and scopes item reads to the niche. Absence from a seller list still never proves a sale.
- Existing-order refresh now also reconciles sold single-quantity inventory/listings; previously its early return skipped that work. Trading fallback no longer replaces the actual order amount with the current asking price. Multi-line allocation remains explicitly review-required.

## Executed checks
Read-only live SQL checks passed:
- `sold_in_live = 0`.
- `sold_and_live_overlap = 0`.
- `stock_with_draft_or_live = 0`.
- `cross_tenant_rows = 0`.
- All 751 existing items retained.
- View has `security_invoker=true`; anonymous SELECT denied.
- Normal authenticated role cannot execute the status-writing RPC; service role can.
- Authenticated role without a JWT sees no inventory rows.
- Rolled-back JWT simulation for a real member could read that tenant's coin inventory and could not read unrelated tenant rows.

## Tests added, not executed here
`services/__tests__/inventoryTabStatus.test.ts` covers eBay Completed/Active exhaustion, partial-quantity availability, unknown/missing status evidence, identity mismatches, cached sold exclusion, all ten niche/tab query combinations, empty scopes, exact counts and multi-page retrieval. No shell, Jest runner or installed-device test capability was available in this session. Existing unrelated static test expectations remain outside this change.

## Remaining verification
The reported Ephesos record still needs its authenticated GetItem check to run in the app: open Stock → Live, or tap header Sync. This session did not call eBay with the user's token and does not claim that the individual coin has already been remotely reconciled. If eBay no longer exposes the historical item, its status is preserved and the failed check is shown; use the stored order import/manual review workflow rather than inferring from an absent response.

Confirm on device that the new Edge Function is available, Sync moves this sold coin to Sold, each niche shows only its own four tab datasets, and a partially sold multi-quantity listing remains Live. Sold price comes from order reconciliation, not the old listing price. No APK was built or tested. Per-user paid niche entitlement enforcement is unchanged from the previous audit; these filters enforce product-scoped presentation and authenticated tenant access, not a new billing authorization model.

## Files
- `supabase/migrations/20261030_inventory_tab_state.sql`
- `supabase/functions/_shared/listingStatus.ts`
- `supabase/functions/swish-ebay-listing-status/index.ts`
- `supabase/functions/swish-ebay-sync/index.ts`
- `supabase/functions/swish-ebay-orders/index.ts`
- `services/itemService.ts` (export existing mapper only)
- `services/listingService.ts`
- `services/listingLifecycle.ts`
- `services/inventoryViewService.ts`
- `hooks/useMasterInventory.ts`
- `hooks/useNicheListingCount.ts`
- `app/(tabs)/inventory.tsx`
- `app/(tabs)/_layout.tsx`
- `services/__tests__/inventoryTabStatus.test.ts`

No database replacement, authentication replacement, AI change, price invention, deletion, specialist reassignment or cross-account import merging.
