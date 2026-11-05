# SWISH backend connection pressure repair — 5 November 2026

## Status

**Database remediation applied and verified with real SQL. Client/Edge source changes implemented. Full production acceptance is NOT verified.** No terminal, test runner, authenticated device session, GitHub write API or managed pool configuration tool is available in this editor session. Consequently TypeScript/Jest execution, installed web/mobile acceptance, new branch/PR creation, merge and application/Edge deployment are not claimed.

## Proven cause and before/after evidence

1. Live backend logs recorded REST 504s for tenants and inventory, RPC 503/504s and subscription Edge 503s. Several log timings show `Query=N/A` after JWT/parse/plan: those failures did not reach normal query execution. Separate RPC 404s indicate deployment/schema-cache drift, not subscription denial.
2. `pg_stat_activity` initially showed **19 active queries**, no blocking locks and oldest query **3,123.62 seconds (over 52 minutes)**. `statement_timeout=0`, `lock_timeout=0`, `idle_in_transaction_session_timeout=3600000`. PostgreSQL `max_connections=12820` is a cluster setting, NOT the per-project PostgREST pool limit.
3. At recovery, **16 runaway read-only PostgREST inventory projection queries** were identified. There were no other active query types. They were consuming database work long after client gateway timeouts. There is no evidence of a client-held SQL connection leak: these services use HTTP supabase-js calls. The observed resource retention was running SELECT statements.
4. The installed `swish_inventory_tab_rows` view used a reused, materialized `classified` CTE with windowing and correlated listings/sales/orders checks across all tenant rows. `EXPLAIN` proved tenant/niche/tab filtering happened on the CTE scan **after** the expensive work. Baseline aggregate estimated cost: **145901.44..145901.45**.
5. Cancelled **only those 16 diagnosed SELECTs**, using `pg_cancel_backend`, requiring current database, active age >5 minutes, exact PostgREST projection query signature and no write keywords. No sessions were terminated and no write transactions or data were changed. Subsequent sample: **0 active, 11 idle, 0 blocking, 0 runaway projection reads**. Later sample: **7 idle PostgREST 13.0.0 connections**, no active work.
6. Replaced the existing view with **per-item lateral classification** so tenant/niche filtering occurs on `items` before relationship classification. Added only the missing `(tenant_id,item_id)` relationship indexes on `listings` and `sales`, after inspecting existing indexes and the plan. Existing tenant, specialist, status, membership, business/settings indexes were retained.
7. Post-repair same Antique count: cost **13.85..13.86**, actual aggregate time **0.392..0.395 ms** in the diagnostic role. With **authenticated-role RLS and an existing stored Antique module session**, cost **88.05..88.06**, actual aggregate time **5.369..5.376 ms**. This is SQL role simulation, not a real mobile/web HTTP session.
8. Old versus new full projection compared using `EXCEPT ALL` in both directions: **757 rows each, missing 0, added 0**. The optimization preserves sold/order evidence, draft/live qualification, archived exclusions, original item JSON and linked listing JSON.

The query-plan defect and abandoned running SELECTs are proven. Managed pool saturation is consistent with the acquisition failures and immediate capacity recovery, but the **configured per-project pool size and gateway cancellation policy are not exposed**. No claim that the global PostgreSQL connection limit was exhausted or increased is made.

## Actual implementation

### Database objects applied

Migration: `supabase/migrations/20261105_inventory_pool_query_repair.sql`.

- `public.swish_inventory_tab_rows`: existing SECURITY INVOKER view optimized, identical results.
- `idx_listings_tenant_item`, `idx_sales_tenant_item`: missing relationship lookup indexes.
- `public.swish_inventory_status_counts(uuid,text[])`: one grouped status query instead of paging every status row. SECURITY INVOKER; authenticated UID, selected module, existing niche access and specialist scope checked.
- `public.swish_inventory_tab_counts(uuid,text)`: one tab grouping instead of four parallel exact-count queries. SECURITY INVOKER, existing niche access required.
- New aggregate RPC execution denied to anonymous/public; existing authenticated view SELECT preserved; PostgREST schema reload notified.
- No RLS policy was removed, weakened or replaced. Existing swish_open_module authorization is unchanged.

### Application/source files changed

- `services/backendRequestService.ts`: session/client-keyed in-flight sharing, maximum two governed reads, access priority, AbortController deadlines including queue wait, no automatic retries or write replays, bounded 5–40s per-key failure cooldown, discard results when session identity changes. Reuses `getSupabaseClient()`; no second client/auth system.
- `services/backendAvailabilityService.ts`: distinguish transient 499/502/503/504, pool/network/statement timeouts from confirmed 401/402/403, SQL 42501 or session/scope mismatch.
- `services/tenantService.ts::getUserPrimaryTenant`: bounded SELECT of first authorized tenant, rather than reading every tenant.
- `services/moduleAccessService.ts::loadModuleAccess`: reuse the existing subscription Edge response's server-computed owner role, avoiding duplicate role verification; older response uses the existing owner RPC. `activateModuleScope` still calls swish_open_module; no automatic replay.
- `services/subscriptionService.ts`: bound read-only subscription verification through functions.invoke and propagate real transport errors; checkout/portal unaffected.
- `services/moduleNavigationService.ts::restoredModule`: bound existing module-restoration read.
- `contexts/AppContext.tsx`: optional settings no longer block completed module authorization; transient periodic failures retain same-account verified presentation only within a five-minute maximum age; genuine failures fail closed; background refresh no longer hides inventory or triggers unconditional inventory reloads. User/session/generation guards protect late results and lock release. Startup's aggregate deadline now covers the actual sequential requests and sets a terminal loaded-user state, so the account-match flag cannot leave the spinner running forever. Settings readbacks also check tenant/module generation.
- `services/businessConfigService.ts::getBusinessConfig`: share base/overlay reads while in flight, add abort deadlines, skip redundant current-module RPC for explicitly scoped callers, preserve raw errors. RLS still checks overlays.
- `hooks/useBusiness.ts::useBusinessConfig`: consume existing AppProvider configuration instead of issuing duplicate settings reads per screen.
- `services/itemService.ts::listItems/getItemStatusCounts`: share and bound read pages; keep all existing authorized pagination, coin fields and mapping; propagate authorization errors; aggregate status counts on server.
- `services/listingService.ts::getAllListings/getLiveListingCount`: share/bound relationship pages; retain IDs and listing mappings; use one canonical server count; never turn a failed count into a successful zero. Listing publication/OAuth/credentials unchanged.
- `services/inventoryViewService.ts::loadInventoryView`: one authorization check through listItems, then relationships; session-keyed shared orchestration. Existing inventory classification and All-item presentation retained.
- `services/inventoryTabQueryService.ts`: bounded shared pages and stable item tie-break; one aggregate RPC for counts.
- `hooks/useInventory.ts`, `hooks/useMasterInventory.ts`, `hooks/useNicheListingCount.ts`: same-scope transient snapshot preservation, denial clears protected visible data, focus/foreground-aware polling, skip competing background reads, settle loading flags, avoid duplicate requests. Badge effect restarts attach to service sharing rather than dropping a pending result. Deferred image work respects current scope/focus.
- Existing premium-niche CI updated to include recovery tests and to preserve separate TypeScript/registry/foundation exit statuses; a later successful command cannot mask a failed TypeScript check.

No page layout, navigation destination, scanner design, niche registry, existing eBay architecture or encryption was changed.

## PR #169 review

Inspected the GitHub PR metadata and diff at head **2f225a5236abc66508c0597f6b9315fd37130165**, branch `fix/inventory-pool-resilience`. Last observed state: **open, unmerged**.

Good fixes retained: 90s foreground polling, preserve successful inventory on transient failures, propagate count errors, pending-request sharing, distinguish outages from entitlement decisions.

Corrections: flight keys also isolate authenticated sessions/users and module generation; request deadlines abort HTTP rather than only invalidate React state; background verification does not temporarily remove ready inventory; retained access presentation has a maximum age; authorization failures clear data; badge effect restarts cannot suppress a replacement/readback; startup loaded-user state cannot stay pending after deadline; optional settings are independent of verification; existing view/count query pressure is fixed in SQL rather than covered by a spinner change.

These editor changes have **not** been committed to a newly created focused branch or PR: no GitHub write/branch/merge tooling is available here. PR #169 was not altered or merged through these tools. No untested merge is claimed.

## Tests actually executed

| Check | Actual result |
|---|---|
| Live pool/query/lock diagnostics | Executed; evidence above |
| Before-plan inspection | Executed; global materialization/filter fence proven |
| Selective runaway SELECT cancellation | Executed; 16/16 cancellations confirmed |
| SQL migration/index/view application | Executed successfully |
| Post-repair diagnostic-role EXPLAIN ANALYZE | Executed; 0.395 ms aggregate |
| Authenticated-role EXPLAIN ANALYZE | Executed; 5.376 ms aggregate |
| Full old/new projection equivalence | Executed; 757 each, no differences |
| Existing-session role/entitlement/Antique inventory check | Executed; owner true, access true, stock 1, draft/live/sold 0, status review_required 1 |
| Concurrent SQL tool reads | Two parallel role-simulated reads succeeded; same Antique row and counts |
| Cross-niche and cross-tenant reads under Antique RLS | Executed; 0 visible outside niche, 0 outside tenant |
| Missing module session simulation | Executed; access false, 0 item rows |
| Business/settings SQL reads under RLS | Executed; business config 1, optional niche settings 0 (absence is not denial) |
| New aggregates' invoker/anonymous permissions | Executed; invoker true, anonymous execute denied |
| Data preservation | Executed; 755 distinct physical items, checksum unchanged |
| Live Preview HTTP requests | Tool returned no captured requests; cannot assert current mobile/web UI acceptance |
| TypeScript checks | NOT RUN: no terminal/test execution tool |
| Full existing Jest suite | NOT RUN: no terminal/test execution tool |
| New concurrency/timeout/recovery Jest cases | Implemented, NOT RUN |
| Temporary HTTP outage/session recovery on device | NOT RUN; unit cases provided, not executed |
| Mobile versus web rendered inventory consistency | NOT RUN; both still consume shared canonical services, not proof of UI parity |
| New application/Edge deployment smoke test | NOT RUN/NOT CONFIRMED |

Executable additions: `services/__tests__/backendPoolRecovery.test.ts`, `supabase/tests/backend_pool_recovery_readonly.sql`. Existing coin/pagination, tab, projection and Antique guard tests adapted to the real aggregate/abort contracts. No passing Jest or TypeScript total is invented. GitHub check statuses retrieved for PR #169 apply to that earlier SHA, not these editor changes.

### All-niche real database coverage

| Niche | Existing physical items | Canonical projection rows |
|---|---:|---:|
| Antique Flip | 2 | 2 |
| Coin Flip | 460 | 462 |
| Threads Flip | 3 | 3 |
| MX Flip | 2 | 2 |
| Bike Flip | 2 | 2 |
| Surplus Flip | 270 | 270 |
| Tech Flip | 3 | 3 |
| Collectibles Flip | 1 | 1 |
| Trading Cards | 0 | 0 |
| Fossils | 0 | 0 |
| Beauty | 0 | 0 |

These are diagnostic-role backend counts across separate tenants, NOT a grant to the currently logged-in user. Coin projection has two additional listing rows because a physical coin may have more than one marketplace listing; physical inventory still uses distinct items.id. Twelve unclassified legacy items remain unchanged/outside production niches. Total physical items **755**, projection **757**. The tested authorized Antique session has **1** item, with **0** stored media URLs; this accurately reports the existing record, not an image-load success. Rendered-item counts remain unverified.

Before and after full-item checksum: `86841b8ae70def795f62a3479496ca76`. Existing records, images/attributes, identification/valuation and listing relationships were not written, deleted, migrated or duplicated. Full projection equivalence includes original item/listing JSON.

## Managed infrastructure intervention still required

This session did NOT change a managed database pool limit or global statement timeout. `current_setting('pgrst.db_pool',true)` returned null; the effective per-project pool maximum cannot be derived from max_connections or the number of cancelled queries.

For backend **iwgaqieyoahmcjfziwga** OnSpace infrastructure must:

1. Expose/verify the project's effective PostgREST or compatible gateway **pool maximum, acquired/idle/waiting counts and acquisition timeout**. Tune pool capacity only against database CPU/memory and tenant concurrency metrics; do not blindly raise max_connections.
2. Configure a **server-side 8–10s statement deadline for REST read transactions**, below the gateway's response timeout. Set/verify the actual role/transaction statement_timeout used by the managed REST executor; a client AbortController or diagnostic SET LOCAL is not that setting.
3. Enforce **SQL cancellation and connection return on gateway timeout/client disconnect**. The proven failure retained read work for over 52 minutes; graceful HTTP abort alone cannot guarantee release on this backend.
4. Set a bounded **pool acquisition wait (~5s)** with explicit 503 and retry-after, preventing queues longer than a foreground request's deadline. On standard PostgREST this is db-pool-acquisition-timeout; OnSpace must confirm the equivalent managed setting.
5. Monitor p95 acquisition/query duration, cancellation count and oldest active statement, then validate these repairs under authenticated application load. Notify/reload API schema after grants/migrations where RPC 404s persist.

These require platform operations access, not manual application coding. Infrastructure contact: **contact@onspace.ai**. No claim of permanently repairing a managed pool configuration is made.

## Merge/deployment and acceptance

Database objects: **applied live**. Application/Edge files: **implemented in this editor; deployment unconfirmed**. New focused GitHub branch/PR: **not created by these tools**. PR #169: **open/unmerged at last inspection**. Full production acceptance: **pending real TypeScript/Jest execution, authenticated native/web refresh/outage tests, and managed server cancellation/deadline verification**.
