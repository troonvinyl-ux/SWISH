# SWISH canonical inventory and single-item counting

Audit date: 2026-11-07. Status: schema and client corrections delivered; read-only database checks performed; CI, authenticated concurrency and installed-device acceptance pending.

## Contract

`items.id` remains the canonical record identity. No replacement inventory table, database, listing engine or inventory data migration was created. Listings, orders and sales remain related to that item. Inventory totals count distinct canonical IDs including retained sold history. Stock/draft/live/sold, marketplace listings, units, orders and realised sales are independent metrics, never additive inventory totals.

A multi-quantity record is retained as one canonical product/stock record with an explicit unit quantity. It is not expanded into unrelated products. Existing aggregated quantity records are not rewritten into separately proven physical copies. Barcodes identify product editions, not individual copies: repeated events/retries in a scan visit reuse its item UUID; a new visit represents a new copy. Visit tokens include a per-instance namespace so app relaunches cannot recycle scan-1.

## Measured before and after

No existing user records were changed by the audit. These are database query results, not device screenshots or production performance measurements.

| Metric | Before | After |
|---|---:|---:|
| Canonical item records in all tenants | 763 | 763 |
| Owner portfolio item scope | 751 classified records | 763 including 12 unclassified historical records |
| Recorded units | 763 | 763 |
| Inventory tab projection rows | 765 | 763 |
| In-stock canonical records | 55 | 55 |
| Draft tab rows | 277 (276 item IDs) | 276 |
| Live tab rows | 419 (418 item IDs) | 418 |
| Raw live eBay rows / eligible reporting metric | 420 raw | 419 eligible external identities |
| Sold item-status-only metric | 11 | 14 with retained canonical sale evidence |
| Existing Sold tab item IDs | 14 | 14 |
| Registered-niche outstanding-order metric | 0 | 5 |
| Eligible realised sale events | 11 | 11 |
| Recorded eligible sale-price total | 395.79 | 395.79 |
| Repeated sale identities omitted from proceeds | 8 | 8 |

The monetary figure is stored sale-price proceeds, not profit or subscription revenue. Currency presentation still follows the existing recorded-currency safeguards. The raw live rows and eligible metric have different predicates: a stale live row cannot override canonical sold evidence. There were zero repeated external eBay IDs across listing rows at audit time; future duplicate/alias observations are nevertheless deduplicated and guarded.

### Current canonical states by module

| Module | Unique records | Stock | Draft | Live items | Sold |
|---|---:|---:|---:|---:|---:|
| Coins | 460 | 32 | 9 | 405 | 14 |
| Collectibles | 8 | 4 | 1 | 3 | 0 |
| Antiques | 2 | 1 | 1 | 0 | 0 |
| Bicycles | 2 | 0 | 0 | 2 | 0 |
| Clothing | 3 | 2 | 1 | 0 | 0 |
| Motocross | 2 | 2 | 0 | 0 | 0 |
| Surplus Flip | 270 | 5 | 263 | 2 | 0 |
| Tech | 3 | 0 | 1 | 2 | 0 |
| Tunes Flip | 1 | 0 | 0 | 1 | 0 |
| Beauty | 0 | 0 | 0 | 0 | 0 |
| Fossils | 0 | 0 | 0 | 0 | 0 |
| Trading Cards | 0 | 0 | 0 | 0 | 0 |
| Unclassified retained history | 12 | 9 | 0 | 3 | 0 |

Coins formerly projected 462 rows for its 460 canonical IDs; it now projects 460. A real item may have two distinct live listing identities without becoming two items: the owner totals currently show 418 live item records versus 419 live eBay listings. Owner-wide totals include unclassified history, but niche cards/subscribers never receive records from another niche.

## Corrections and root causes

1. **To-many projection fan-out:** the old inventory view emitted every live/draft listing. Added a one-row-per-item invoker projection with Sold > Archived > Live > Draft > Stock precedence. The existing tab view now delegates to it; totals remain distinct item IDs.
2. **Mixed aggregation contracts:** raw status counts treated all preparatory states as drafts and did not agree with saved draft/live relationships. Shared inventory and home hooks, tab badges and Minority Report now consume the same canonical RPC. Live items and live eBay listings remain explicitly distinct. Owner-wide counts include the unclassified history bucket without assigning it a niche.
3. **External alias inflation:** reporting selects the latest observation per tenant/trimmed eBay external ID across `ebay`/`EBAY_GB`. Unpublished drafts/non-eBay records keep legitimate independent identities. The listing-management/detail APIs retain access to all existing relationships.
4. **Non-atomic import creation:** CSV/candidate intake formerly inserted an item before its listing. Both now use a tenant/module-checked transaction under an advisory identity lock. Existing external links or permanent inventory references are reused; ambiguous matches fail closed. Generic SKU, title and barcode matches do not silently merge physical copies.
5. **Retry uncertainty:** capture saves now use a stable visit-scoped UUID, reopening it after an uncertain INSERT instead of creating another physical record. New visits remain distinct.
6. **Future duplicate writes:** added item capture/external-ID, listing external-ID and order/sale-line guards under tenant-scoped transaction locks. Existing ambiguous rows are not deleted or rewritten. Distinct item lines/legitimate marketplace listings remain supported.
7. **Quantity lifecycle disagreement:** eBay sync now uses the existing shared quantity parser; a partially sold ended listing is not wholly sold. Full-detail browse uses that same parser instead of defaulting to active.
8. **Outstanding orders:** fulfilment/action state, not the overloaded paid/completed order label, determines outstanding work. The report deduplicates order identity and can use an existing listing-to-item relationship.
9. **Query-plan issue:** an initial window-based external identity projection caused an aggregate backend error. Replaced it with an indexed latest-observation anti-join. Subsequent read-only item/live aggregate queries completed; no latency improvement is claimed without measurements.

## Historical review queue: no automatic merging/deletion

- One ambiguous `_ebay_item_id` group contains two canonical records in tenant `53d169c0-8d37-4378-b8ef-84fbb3991661`, external ID `800321852077`:
  - `b1971024-32a5-46e9-b6ad-1372e1214361`, Coins, listed, permanent reference `KC-000001`.
  - `bcedcb80-e889-4ee0-abfc-aced3128657c`, Coins, active, no permanent inventory reference.
  Both remain counted as separate canonical records until evidence establishes whether they are separate copies or an old duplicate. The audit does not certify 763 proven distinct physical objects.
- 70 repeated `(tenant, external_order_id, item_id)` groups exist in the order ledger. Most have no item link; one repeated order group has a single linked item. They are retained, and only safely linked identities contribute to scoped reporting.
- 532 order rows have no canonical item link. They are not guessed into niches or assigned to the first matching product.
- 19 sale rows resolve to 11 eligible sale identities; eight repeated entries are omitted from realised proceeds but retained for reconciliation.
- 12 item records are unclassified. Owner-wide physical totals include them; no subscriber entitlement or niche identity was changed.
- Zero duplicate listing external-ID groups, zero duplicate permanent inventory-reference groups, and zero invalid/null item quantities were observed.

Review these records in the Cloud Data interface or the existing owner inspectors. Establish documentary relationships before any manual merge or cleanup; preserve every listing/order/sale association. No ambiguous records were automatically deleted.

## Verification performed

- Live read-only database baselines and after-count queries.
- 763 canonical projection rows = 763 original item IDs, with zero duplicate projected identities.
- Totals agreed across all 17 observed tenant/niche scopes (including unclassified scope).
- All three reporting views retain SECURITY INVOKER behavior. Existing item/listing RLS, paid entitlement and tenant architecture remain intact; owner reporting preserves its existing verified-owner checks.
- Anonymous/unauthenticated count and import requests were rejected in negative SQL tests. Atomic import exists, anonymous execution is denied, authenticated execution is granted, and four future identity guards are installed.
- Read-only SQL fixtures kept seven IDs through stock -> draft -> live -> sold, and differentiated duplicate external aliases from legitimate distinct listings and tenants.
- Authored/updated Jest regressions cover transitions, duplicate sync/re-import, repeated scan visits, quantity, twelve niches, tenant isolation and shared app/web RPC contracts. These were **not run in this editor**.

## Remaining acceptance blockers

- Run `.github/workflows/canonical-inventory-verification.yml` and the existing full production audit workflow against the actual checkout. TypeScript/Jest/Expo/native builds were not executed here.
- Test concurrent imports, timeout-after-commit capture retries and duplicate sync on authenticated test records, including two tenants and multiple niches. The read-only audit did not insert test inventory into user tables.
- Test app/web and installed Android/iOS views from the same account/snapshot. Shared-source parity is implemented; rendered parity is not yet device-certified.
- Deploy/verify the changed eBay sync/browse Edge Functions in the normal shared release process; live provider writes and installed-function smoke acceptance were not performed.
- Resolve the historical ambiguity/unlinked ledger queue above. Do not infer physical uniqueness or automatic reclassification from source changes.

## Files and reproducibility

Schema migrations: `20261111_canonical_inventory_identity.sql`, `20261111_canonical_inventory_query_plan.sql`, `20261111_atomic_ebay_inventory_import.sql`, `20261111_inventory_ledger_identity_guards.sql`, `20261111_owner_unclassified_inventory_counts.sql`.

Shared data/logic: `services/canonicalInventoryService.ts`, `captureIdentityService.ts`, `inventoryViewService.ts`, `inventoryTabQueryService.ts`, `itemService.ts`, `aiIdentificationService.ts`, `quickListService.ts`, `coinInventoryService.ts`, `ebayInventoryImportService.ts`, `listingService.ts`, `commandCentreService.ts`; hooks `useInventory`, `useMasterInventory`, `useCommandCentre`, `useGenericCapture`, `useQuickList`; `scannerSessionService.ts`.

UI/adapters: `components/feature/CommandPortfolio.tsx`, `app/(tabs)/inventory.tsx`, `app/ebay-csv.tsx`. Provider hierarchy and existing authentication were unchanged.

Tests: `services/__tests__/canonicalInventoryCounting.test.ts` plus updated inventory/command regressions; `supabase/tests/canonical_inventory_readonly.sql`; `.github/workflows/canonical-inventory-verification.yml`. Machine-readable results: `docs/SWISH_CANONICAL_INVENTORY_EVIDENCE.json`.
