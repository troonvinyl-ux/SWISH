# SWISH backend, API and sync performance

## Status
Targeted optimisations are implemented on the existing SWISH engine. SQL before/after measurements and schema-security observations were executed in this session. Jest, TypeScript, Edge typechecks, installed-app tests and new live-provider timings were **not executed** by this editor; CI and device acceptance remain open. No marketplace publication, paid identification, sync lease or production-stock mutation was invoked during the audit.

## Executed before-and-after measurements
Five warm-cache `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` samples of the actual installed count SELECT, for the same tenant and Coins scope. The authentication guard was not impersonated; these administrative SELECT timings are **SQL execution only**, not subscriber RLS, HTTP, mobile or end-to-end timings.

| Measurement | Before | After |
|---|---:|---:|
| Count SELECT median | 51.121 ms | 45.087 ms |
| Count SELECT P90 | 52.560 ms | 48.4134 ms |
| Warm shared-buffer hits | 18,105 | 8,951 |
| Canonical records in measured scope | 250 | 250 |
| Stock / draft / live / sold | 22 / 8 / 206 / 14 | 22 / 8 / 206 / 14 |
| Unique live eBay identities | 206 | 206 |
| All retained inventory records | 763 | 763 |
| Records with persisted media | 758 | 758 |

Median SQL execution improved approximately **11.8%** and buffer hits decreased approximately **50.6%**, despite adding a revision and raw status aggregates to the same response. Five samples are diagnostic evidence, not a load test or a production SLA.

Before samples (ms): `[53.266,51.501,51.121,50.444,51.121]`.
After samples (ms): `[49.687,45.087,46.503,44.827,45.009]`.
Before hits: `[18138,18105,18105,18105,18105]`.
After hits: `[8984,8951,8951,8951,8951]`.

Separate baseline queries: canonical page, 200 rows: 31.981 ms execution / 4.873 ms planning / 6,165 shared hits; status aggregate: 0.973 ms execution. These query shapes were not changed or claimed as speed improvements. `pg_stat_statements` is unavailable; aggregate statement-history profiling was not fabricated.

## Historical provider evidence, not new after measurements
The existing seven-day Edge table contains 83 `swish-ebay-list` samples: mean 952.10 ms, median 502 ms, P90 2,602.8 ms, zero HTTP failures. The historical wrapper does not include every authorization/preparation/client/network stage; this is **not** capture-to-live or complete eBay creation timing.

Seven-day sync history has three runs: completed 2,144 ms, failed 1,016 ms, completed 2,127 ms. All recorded zero fetched records, so these cannot establish full stock-sync performance. No new `inventory_v2` leases were executed during this audit.

New API/upload/identification/publication timing percentiles: **unmeasured**, not zero. Existing Quick List T0–T7 and server live evidence remain the end-to-end source; the under-60-second objective is not certified.

## Changes and justification

### 1. One canonical count materialisation
`supabase/migrations/20261116_inventory_snapshot_performance.sql` changes only `swish_inventory_tab_counts`. Previously its live subquery re-evaluated the expensive canonical projection. The measured 18k buffer hits justified reusing one `physical as materialized` scope. Counts, quantity policy, external-ID deduplication, auth check, invoker RLS and authenticated grants are retained. Raw item status counts are returned without another status RPC for a full niche scope. Specialist subsets still use their existing subset-specific aggregate.

No speculative index was added. Existing tenant, tenant/status, canonical relationship and normalized external-ID indexes were reviewed; these small warm queries did not justify new index write/storage costs. Larger production scopes still require representative subscriber plans.

### 2. Unchanged inventory data is not redownloaded
`canonicalInventoryService`, `inventorySnapshotReuseService`, `inventoryViewService` and `useInventory` compare a server-derived revision of canonical IDs, item/listing timestamps, classification, quantity and live listing count. **Every reuse first completes a fresh authorized RLS count RPC**. The in-memory data cache is session/tenant/niche-partitioned, capped at four entries and five minutes; it is never an access cache and is not persisted.

A changed collection or expired cache is downloaded through the existing projection. Full downloads compare a closing revision to the opening revision, in addition to the original canonical total check. Read errors invalidate cached data; authorization errors do not become an empty-success state.

Request budgets derived from the audited control flow, **not executed HTTP latency samples**:
- Main inventory old refresh: `1 count RPC + N data pages`; unchanged refresh now: `1 fresh count RPC, 0 data pages`.
- Cold/changed inventory now: `2 count RPCs + N pages` because closing-version validation is deliberately retained.
- A full-niche dashboard skips its separate raw-status RPC; its new closing-version check offsets that saving on a changed load. The large saving is on repeated unchanged loads.

### 3. Photo persistence reuses confirmed server readback
`photoPersistenceService` carries the already-read row through checkpoints, uses full `UPDATE RETURNING` including trigger results for verification, and retries CAS conflicts from a fresh row. It does not skip original-byte upload/download verification, hash validation, completeness checks or role checks.

Audited fresh front/back persistence without optional processing: eight database requests before versus three now. A no-op already-linked media operation: four before versus one now. These are structural budgets with new executable mock assertions; the tests and actual upload latency have **not yet been run**. Immutable content-addressed storage, untouched originals, partial-upload checkpoints, retained identity and explicit errors are unchanged. Existing studio caches/attempt reuse already avoid paid reprocessing of unchanged images; these safeguards were retained rather than replaced.

### 4. Sync overlap, concurrency and unchanged metadata
`syncRequestService` is shared by niche sync/token/image actions and canonical inventory order sync. It collapses concurrent same-session requests, checks the session before/after dispatch, bounds waiting and aborts timeout requests. It never automatically replays a marketplace/inventory operation. Client timeouts are ambiguous outcomes and explicitly ask users to reload.

`swish_claim_ebay_sync`, on existing `ebay_sync_log`, uses an account-wide advisory-lock-protected 180-second lease before token refresh or provider calls. Only `service_role` can execute it after the existing module gateway checks. Duplicate attempts return 409, completed IDs can return their original outcome, and failed/running IDs are not automatically replayed. This lease covers `swish-ebay-sync`; other eBay endpoints retain their existing CAS/ledger/publication guards and are not falsely described as globally serialized. Cross-device order sync still relies on the existing atomic order/sale guards.

The existing sync handler now:
- Paginates scoped listing reads instead of accepting an implicit response row cap.
- Runs independent selling sections and exact GetItem reads with at most three workers.
- Waits for **all** active observation workers to settle and verifies the complete observation set before any inventory reconciliation.
- Keeps marketplace validation, canonical status RPC and persisted readback; never infers sold/ended from missing IDs.
- Skips only semantically unchanged item/listing metadata patches; canonical status reconciliation still executes.
- Uses fresh CAS versions for legitimate multiple links to one physical item.
- Logs successful, failed and partial outcomes in the existing sync log with stage durations and skipped-write counters; errors remain visible.

Before GetItem reads were sequential; now concurrency is capped at three. This is a scheduling change, not a measured 3x speed claim. New provider latency, rate-limit behavior, lease expiry, multi-device contention and partial-failure recovery require real tests.

### 5. Visibility, navigation and monitoring
Existing focus-aware 90-second inventory polling is retained, but native background and hidden web tabs suppress automatic polling using root visibility listeners. Manual refresh and mutation invalidation remain. No global navigation waits for sync/image tasks; the existing InteractionManager image scheduling is retained. A visible web tab uses its next existing focus/manual/interval refresh; no additional polling loop was introduced.

Existing Edge logging now covers previously uninstrumented module handlers without double-logging the already-wrapped listing/status handlers. On supported EdgeRuntime hosts it writes via `waitUntil`; otherwise logging has a two-second bounded fallback. Logging failures are reported without inventing samples.

`performanceMonitoringService.readPerformanceDiagnostics()` provides the latest 500 runtime metadata samples and median/P90 per stage, including governed database request queue+transport time, sync API roundtrip, upload transport, verification download, identification invocation and listing submission orchestration. These are not server SQL timings or native startup. Counters include duplicate read/sync/photo/publication flights and unchanged-inventory reuse. It contains no account IDs, request keys, URLs, tokens, buyer data or payloads, and is not another persisted reporting system.

## Security and data preservation observations
Executed SQL observations confirm:
- 763 canonical records, 758 with media, 763 canonical projection rows.
- Items/listings RLS remains enabled; count function remains security invoker.
- Anonymous count execution denied, authenticated count execution retained.
- No-session count call rejected.
- New lease execution: anon false / authenticated false / service_role true.
- No new sync lease rows created by the audit.

Existing auth providers, current-module checks, tenant/niche isolation, server-only eBay credentials, AES-GCM encryption, original-photo preservation and publish claims were not removed or weakened. Ambiguous historical identities remain for review, not automatic deletion/merging.

## Files and verification
Core files: `services/backendRequestService.ts`, `services/canonicalInventoryService.ts`, `services/inventorySnapshotReuseService.ts`, `services/inventoryViewService.ts`, `hooks/useInventory.ts`, `hooks/useMasterInventory.ts`, `services/photoPersistenceService.ts`, `services/originalImageService.ts`, `services/syncRequestService.ts`, `services/ebaySyncService.ts`, `services/identificationTransportService.ts`, `services/listingService.ts`, `services/performanceMonitoringService.ts`, `services/appVisibilityService.ts`, `app/_layout.tsx`, `supabase/functions/_shared/moduleScope.ts`, `_shared/edgeFunctionLogging.ts`, `_shared/syncConcurrency.ts`, `swish-ebay-sync/index.ts` and the two migrations.

Executable regressions are in `services/__tests__/backendPerformance.test.ts` and existing queue/photo/publication suites. Source SHA, TypeScript output, Jest JSON and all Edge typechecks are configured in `.github/workflows/backend-performance-verification.yml`. Reproducible SQL sampling is in `supabase/tests/backend_performance_readonly.sql`.

Pending: run CI; compare real authenticated native/web and multiple-tenant/niche refreshes; test changed/unchanged/deleted items and auth revocation; measure upload/identify/eBay stages; test duplicate taps and cross-device leases; verify partial sync, rate limits, network failure and ambiguous publication; record confirmed-live median/P90 in the existing Quick List evidence. None is marked passed by source inspection.
