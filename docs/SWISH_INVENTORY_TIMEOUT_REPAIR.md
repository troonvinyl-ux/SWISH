# Inventory count timeout repair

Historical first repair. The subsequent authenticated RLS bottleneck and unnecessary home-screen item/photo hydration are addressed in [Authenticated inventory speed repair](SWISH_AUTHENTICATED_INVENTORY_SPEED.md), including executed caller-role timing and denial checks.

## Observed failure

OnSpace PostgreSQL logs show a 500 POST to `/rest/v1/rpc/swish_inventory_tab_counts` at 2026-11-08 01:13:48 UTC. The supplied Coin Flipper screenshot reports SQLSTATE 57014 (statement timeout). The top Quick List banner also overlaps the iOS status bar.

## Changes

- Replaced the existing count RPC's full canonical-view traversal with slim, tenant/niche-scoped materialized item records. Listing identity ranking and winner selection run once per request instead of being expanded separately for every item and every sold-evidence lookup.
- Materialized order/return evidence once. Retained canonical sold/archive/live/draft/stock precedence, single-unit sale evidence, cancellations/refunds, marketplace-alias deduplication, and separate unit/live-listing metrics.
- Kept the existing authenticated RPC, invoker RLS, fresh paid-module check, revision and status-count response. No data, photographs, identities, policies, or entitlement records were rewritten. Added relationship indexes; disabled JIT for this aggregate rather than increasing the timeout.
- Added a top safe-area wrapper before Quick List, dark status-bar content on the yellow header, wrapping header text, and embedded-dashboard inset handling. Standalone dashboards keep their own top inset; modals keep top/bottom protection.
- Dashboard outages now show an actionable timeout explanation instead of raw SQL. Auth/scope errors remain intact. Retry is disabled while running. No polling or automatic retry was introduced.

## Verification boundaries

The migration was applied through OnSpace Cloud. ACL readback confirms SECURITY INVOKER, authenticated execution, no anonymous execution, `jit=off` and the existing 10-second function setting. The repaired SQL body executed against the dashboard tenant and returned valid aggregate counts (250 unique coin items, 250 units, 22 stock, 8 draft, 206 live items/listings, 14 sold, 0 archived). The repaired aggregate exactly matched all eight metrics from the unchanged canonical projection for this tenant. A timed administrative SQL-body read returned in 68.54 ms. This checks the scoped query, not end-to-end network latency or authenticated mobile performance.

The deployed SQL also passed the read-only synthetic suite in `supabase/tests/inventory_count_timeout_readonly.sql`: 11 records/13 units, cancelled/refunded sales excluded, partial quantities retained, latest eBay alias wins, terminal and GetItem sold evidence preserved, canonical classifications correct, status totals consistent and a valid revision. All five base tables retain RLS.

Pure/source regression tests are in `services/__tests__/inventoryTimeoutRepair.test.ts` and the inventory verification workflow; they were added but not executed here. This editing environment has no shell/test runner; TypeScript/Jest and installed iOS/Android testing must run in CI/on devices. Do not treat SQL syntax/ACL checks as native UI or authenticated runtime acceptance. Failed temporary diagnostic probes returned a generic backend error and were not counted as successful tests.
