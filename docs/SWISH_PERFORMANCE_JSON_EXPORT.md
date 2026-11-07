# SWISH owner performance JSON export

## Use

Open **Master Control → Performance → Export performance JSON**. This is a section of the existing owner dashboard, not a separate reporting application. No measurements are fetched on section entry; export is explicitly requested. Verification, health and provider checks are not eagerly started by this section.

- Browser: downloads an `application/json` file using a short-lived Blob URL.
- iOS/Android: opens the system file share sheet; select a destination. Opening or cancelling the sheet is not proof that a file was saved. Temporary native files are deleted after sharing or failure.
- Duplicate taps are disabled/guarded. Session replacement, component unmount, or permission revocation cancels delivery. Errors are visible; there is no silent cached-export fallback.

## Exact measurement boundaries

Every timing cohort includes sample counts, median and P90 in milliseconds. Percentiles use continuous interpolation. Zero-sample timing cohorts have null percentiles, not estimated or inferred durations.

| JSON section | Source and scope | Meaning |
| --- | --- | --- |
| `sql.currentRuntime` | No live SQL duration collector | Explicitly unavailable: zero collected samples and null percentiles. No new EXPLAIN request is performed. |
| `sql.archivedBefore` / `archivedAfter` | Five retained administrative warm-cache samples each from the existing performance evidence archive | Historical tab-count SELECT evidence only, not current SQL/network/RLS subscriber latency. No archival tenant identity or item counts are exported. |
| `runtimeNetwork` | Existing metadata-only ring; latest 500 recorded operations in this JS runtime | `database_read` includes queue/network/server work and is explicitly NOT SQL execution time. Other cohorts separately cover sync requests, upload, verification, identification and publication. Failure counts are retained per cohort. |
| `edgeExecution` | Existing `edge_function_logs`, last seven days, platform aggregate | Recorded server handler durations per allowlisted function. HTTP failures mean status >=400; HTTP 200 does not prove all business validations succeeded. Unknown function names become `other`, not free text. |
| `syncWallClock` | Existing `ebay_sync_log`, last seven days, all recorded sync types | Completed minus started timestamp. Completed/failed/running/other records and excluded/missing duration counts remain separate. Unfinished or negative durations do not enter percentiles. |
| `captureToLive` | Existing Quick List timing/confirmation events, last 30 days | Latest checkpoint per tenant/session. T7−T2 is sampled only for a publication-attempted, live outcome with matching Active confirmation and numeric, non-negative duration. Missing/invalid confirmed durations are explicitly excluded. No session or listing identities are returned. |

Runtime counters cover JS-runtime lifetime, not just the 500-operation ring. The runtime aggregate may span account changes, contains no account identities and is explicitly labelled runtime-wide. Instrumentation is incomplete outside recorded activity. Cohorts can overlap: never sum their durations. Client wall clocks and a persisted Active confirmation are workflow evidence, not independently certified performance. No under-60-second certification is implied.

## Authorization and privacy

`public.swish_performance_export()` is a stable, 10-second-bounded, security-definer aggregate-only RPC. It explicitly requires both `auth.uid()` and the existing trusted `swish_is_platform_owner()` predicate. Anonymous/public execution is revoked; authenticated invocation is only an RPC entry permission, not an owner grant. Platform owners may receive platform-wide aggregate telemetry, never another tenant’s item payloads.

The service validates the owner/version/scope/window contract, consistent sample counts, timestamps and percentile semantics. Output is reconstructed with an explicit field allowlist at every depth. It does not serialize the original RPC, runtime object or evidence archive. Before writing/delivering files it rechecks the same private session scope and trusted owner permission; the private scope is never exported.

Exports omit credentials, session tokens, email addresses, tenant/user/item/listing IDs, callback/provider/storage URLs, raw event bodies, request bodies, free-form errors, item descriptions and media. Files remain user-controlled after a download/share; SWISH does not upload a copy or store an export history. Revoking access cannot revoke a file already handed to the browser/system destination.

No provider/API call, sync lease, inventory write, publication or new benchmark is triggered. No new tables/indexes, credentials, second backend or reporting store were created. Existing RLS, tenant isolation and encrypted credential services remain unchanged.

## Validation

Executed against the installed backend:

- Aggregate SELECT compiles and runs through the installed function source, without JWT impersonation or invoking the protected RPC as an owner.
- Anonymous execute is denied; authenticated RPC entry exists.
- An actual no-session invocation is denied by the trusted owner guard.
- Empty capture-to-live cohort keeps null timings.
- Canonical item count remains 763.

Coverage observations at implementation: 83 Edge records / three sync records in the seven-day windows; zero Quick List timing records in the 30-day window. These are observations, not new provider benchmarks or evidence of a connected owner download.

Regression coverage was added for recursive field stripping, owner/session denial, missing/invalid sample counts, separated timing cohorts, native cleanup and browser MIME/download behavior. The existing backend-performance CI workflow now includes both export test suites and source path triggers.

**Not executed here:** Jest, TypeScript, authenticated positive owner and negative subscriber JWT tests, browser downloads, installed iOS/Android share and cancellation cases. Backend SQL checks are not a substitute for these acceptance tests.

Suggested device checks: owner download/share, subscriber RPC denial, cancelled share, owner logout during export, permission revoked before share, network timeout with visible error, multiple taps and empty timing cohorts. Downloads must contain only allowlisted aggregates and an explicitly labelled historical SQL archive.
