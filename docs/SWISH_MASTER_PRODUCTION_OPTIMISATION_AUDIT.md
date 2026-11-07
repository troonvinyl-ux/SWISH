# SWISH master production optimisation audit

Date: 7 November 2026. Verdict: **implementation delivered; production readiness and the under-60-second target remain unverified.**

## Executive report

Eight focused corrections were implemented in the existing shared engine. They remove redundant storage/query work, overlap independent valuation work, avoid background GitHub auditing on portfolio entry, stabilise shared state actions and fence stale Quick List responses. No database, inventory, listing engine, authentication provider, entitlement policy, encrypted connector or working niche feature was replaced. No user records were changed by audit SQL, and no live seller writes or paid provider tests were performed.

### Source and execution limits

- Public GitHub `commits/main` returned `57454aa7c3377d245b04f995e81326b4d160b4f1` (commit date 2026-11-06). This is an observed upstream SHA, **not a verified local checkout SHA**.
- Upstream's commit references `services/__tests__/commandPortfolioPresentation.test.ts` and `20261106_140000_command_report_distinct_listings.sql`, neither present in the supplied project structure. Reconcile these patches against actual latest main before merging; do not overwrite upstream reporting/count fixes.
- Available tools edit project files and execute read-only database diagnostics, but cannot checkout main, create commits/PRs, run Jest/TypeScript/Deno/Expo, install builds or operate devices. No executable test is labelled passed here. `package.json` inspection was rejected by the file tool; dependency versions were not independently audited.
- This is a cross-platform, cross-niche **risk-based source audit**, not a claim that every line of every legacy screen or deployed function was inspected. Detailed paths below were read; broader direct-data and polling patterns were discovered across app/hooks/services. Full CI and installed-device coverage remain required.

## Evidence actually obtained

| Read-only diagnostic | Observed result | Does not establish |
|---|---|---|
| Public base tables and RLS flags | 54 tables; 54 with RLS enabled | Correctness of every policy or cross-user access acceptance |
| Existing `item-images` bucket | 5,242,880-byte maximum | Real upload/download performance or device codec support |
| Quick List timing and live-confirmation events | 0 timing events, 0 live confirmations | Any median, p90 or success rate |
| Last-seven-day persisted edge logs | Returned group: `swish-ebay-list`, HTTP 200, 83 records | Accurate completed listings, comprehensive logging, or end-to-end timing |
| Relevant index discovery | Tenant/scope indexes on items, listings, orders, sales and AI usage | EXPLAIN/ANALYZE, load testing or RLS query performance |

Historical HTTP 200 events are not substitute evidence for the commercial target. Existing `QUICK_LIST_ACCEPTANCE_RESULTS.json` remains unchanged and not verified.

## Implemented change register

### O1 — Bind governed reads to one captured session

- **Problem/root cause:** `backendRead` captured scope, then recaptured it inside its sharing wrapper. A queued operation was only checked after executing; replacement-login races could dispatch stale work. The duplicate capture also caused unnecessary auth-session work.
- **Files:** `services/backendRequestService.ts`; `services/__tests__/backendPoolRecovery.test.ts`.
- **Improvement:** Internal sharing accepts the original captured scope. Dispatch checks session and cancellation before invoking an operation; completion still checks session. Two-read concurrency, queue-inclusive deadline, cooldown and in-flight-only deduplication remain intact. No grants or successful read results are cached.
- **Test performed:** Source-path review. Authored mocked queue/replacement-session and three-session-check regressions; **not executed**. Existing concurrency, timeout and no-grant-cache tests retained.
- **Remaining risk:** Token refresh intentionally fails a stale governed read; real auth restoration and queued-RPC acceptance need device tests. Client abort cannot guarantee SQL cancellation.

### O2 — Stable shared invalidation and provider value

- **Problem/root cause:** `triggerInventoryReload` was a new function on every provider render. Dependent hooks rebuilt callbacks/effects on unrelated updates; the entire provider value and empty memberships array also changed identity.
- **Files:** `contexts/AppContext.tsx`; source contracts in `productionOptimisationAudit.test.ts`.
- **Improvement:** Stable `useCallback` invalidation, memoised provider value with complete state/action dependencies, stable empty-membership array. All genuine data, module and access updates still propagate. No split/duplicate provider or inventory state.
- **Test performed:** Dependency and retained-authorisation source review; new static regression **not executed**.
- **Remaining risk:** Genuine scan/module/access changes still rerender consumers of the broad AppContext. React Profiler measurements and context-selector work are future optimisation, not claimed here.

### O3 — Load Minority Report release evidence on demand

- **Problem/root cause:** Opening the owner portfolio invoked the full GitHub production audit even while operational detail was collapsed. A complete service refresh may request workflow/job/artifact and PR data, competing with commercial screen work.
- **Files:** `components/feature/CommandPortfolio.tsx`; new audit source contracts.
- **Improvement:** Existing readiness hook fetches only after opening detail. Closed detail explicitly says readiness is unassessed. All portfolio metrics, intelligence signals and workspace actions remain. Memoised ID list and module lookup avoid repeated linear tile searches. Existing controls gain visible pressed feedback/48-point action height.
- **Test performed:** Source review of fetch gate and retained UI; new static regression **not executed**.
- **Remaining risk:** Other mounted admin panels may independently request evidence. Opening details still performs the existing full audit. No measured render/transition improvement is claimed.

### O4 — Remove speculative original-photo download

- **Problem/root cause:** Each new original was downloaded before upload to test existence, then downloaded again for byte verification. Oversized uploads could be attempted despite the bucket's smaller limit.
- **Files:** `services/originalImageService.ts`; `services/__tests__/originalImageBytes.test.ts`.
- **Improvement:** Content-addressed immutable upload (`upsert:false`) followed by one mandatory exact-byte readback. Duplicate conflicts are accepted only after bytes match. A 5 MB upload guard matches the observed bucket and rejects without resizing/re-encoding original evidence.
- **Test performed:** Read-only bucket query and byte-path source review. Updated/added mocked single-readback, duplicate conflict, denial, mismatched bytes, native Blob fallback and oversized-original tests; **not executed**.
- **Remaining risk/trade-off:** Fresh successful path now has upload + one GET, rather than speculative GET + upload + verification GET. Duplicate retry now attempts immutable upload + GET rather than GET alone; it may transmit extra bytes. Network error after dispatch remains retryable through the existing saved-item path. HEIC and originals over 5 MB remain explicit blockers; no hidden conversion.

### O5 — Shorten shared publication preflight without bypassing it

- **Problem/root cause:** Independent listing and connector policy reads were serial; an extra 300 ms cosmetic pause delayed every submission. Connector read errors appeared as missing selected policies.
- **Files:** `services/listingService.ts`; `services/__tests__/listingPublication.test.ts`.
- **Improvement:** Listing and policy reads run together after initial publication/verification checks. Connector read failures are explicit and block dispatch. Cosmetic pause removed. Existing resource checks, specialist preflight, safety gates, policy requirements, publish claim, one-flight submission and acceptance/reconciliation recovery remain unchanged.
- **Test performed:** Gate/order source review. Added mocked connector-failure and retained-gate regression; existing no-duplicate/reconciliation tests retained; **not executed**.
- **Remaining risk:** State-driven intermediate progress labels may be brief. Marketplace publishing, readback, cancellation and retry require approved live acceptance. No marketplace creation request was replayed during this audit.

### O6 — One ownership/media read and earlier independent research

- **Problem/root cause:** The valuation handler read the same item twice. Visual search and supplementary CANOA discovery started after the AI market estimate, unnecessarily serialising independent work.
- **Files:** `supabase/functions/swish-market-value/index.ts`; new audit source contracts.
- **Improvement:** Tenant-scoped `media,specialist_id` read validates ownership before credentials/research and supplies canonical media to the unchanged downstream checks. Original-image visual search and CANOA discovery start alongside the existing AI/token work. No extra provider call, changed AI model, entitlement bypass or new price source.
- **Test performed:** Source review for one item read, early discovery, retained isolation and evidence classifications; static regression **not executed**.
- **Remaining risk:** Some calls are now concurrent rather than serial; measure provider quotas and latency. Middleware still repeats authentication/resource checks for defence in depth. Large fallback/coin pipelines can still exceed 60 seconds.

### O7 — Canonical Collectibles uses the existing evidence prompt

- **Problem/root cause:** Canonical `collectibles` did not have an explicit entry in the prompt map; the detailed label/plush evidence prompt existed only under the legacy generic key. Correcting scope previously made that detailed prompt unreachable by canonical Quick List calls.
- **Files:** `supabase/functions/swish-identify/index.ts`; new audit source contracts.
- **Improvement:** Both prompt keys reference the existing single domain prompt. No prompt duplication, model change, legacy inventory migration or entitlement alias. Canonical specialist remains `collectibles`.
- **Test performed:** Source dispatch/registry review; new static regression **not executed**.
- **Remaining risk:** Model evidence accuracy and conservative confidence still need real tagged-item fixtures. This is not authentication or identity certification.

### O8 — Fence Quick List review/recovery to the originating scope

- **Problem/root cause:** Review and check-live callbacks lacked the session fences used by build/publish. Late results could update another scan or release its processing lock; retained context could briefly expose old scoped photos. Recovery writes could use a new scope key with old state.
- **Files:** `hooks/useQuickList.ts`; new audit source contracts.
- **Improvement:** Hide mismatched state immediately; fence patches, timing updates, recovery persistence and callbacks by scope/session generation. Recheck validity after review/timing awaits before opt-in auto-publish. Check-live handles errors without unhandled rejections. Connection/barcode exceptions provide retained-photo fallback instead of stuck busy state. Existing condition/price review, confidence thresholds, explicit auto-publish opt-in and confirmed-live evidence contract remain.
- **Test performed:** Source walk of logout/scope-change and post-await transitions; static regression **not executed**.
- **Remaining risk:** In-progress network operations are not globally cancelled; originating canonical writes may finish. Full same-scope new-scan, logout/relogin and background/resume races need rendered/device tests. Service-level draft/value caches still require separate hardening.

## Audit coverage and retained design

- **Entry/navigation/all niches:** canonical `niche-modules.json`, `constants/niches.ts`, `services/nicheRouting.ts`, `ModuleEntry`, tabs/scan and root provider/layout contracts. Twelve registered products remain isolated; generic catch-all remains outside production.
- **Inventory/listings:** governed inventory/tab/count services and hooks; shared listing generation, save, preflight, publish and reconciliation. SQL aggregate/index definitions inspected. Existing RLS, tenant boundaries and live identity checks retained.
- **Capture/storage:** generic and Quick List hooks, AI transport/compression, untouched originals, native Blob reader, studio preparation and linkage tests. Original evidence remains separate from presentation.
- **Identification/valuation/Edge:** shared scope wrapper, specialist registry, identification handler, client market service and valuation handler. No auth/resource/entitlement check removed for speed.
- **Admin/Minority Report:** portfolio component, reporting hook/service, production evidence hook/service. Asking prices remain separate from realised sales; stored health never becomes a live provider claim.
- **eBay:** OAuth encrypted staging and one-time callback claim, message/sync services, shared listing operations. Connections, scopes, AES-encrypted references and order/message resources unchanged.
- **App/web/build:** shared Expo entry points, build config, app manifest, deployment validator and regression workflows. No framework replacement, new package, Metro transformer or native identity change.
- **Broader findings:** direct database operations remain in several long legacy app screens (CSV, messages, cases, dispatch, settings). Eager multi-page inventory/listing loads and duplicated handler-level auth/credential logic need further profiling. Potential obsolete helpers/comments were identified, not deleted without executable call/deployment proof.

## Verification workflow delivered

`.github/workflows/production-optimisation-audit.yml` records the actual checkout SHA and runs full TypeScript/Jest, a shared Expo web export, Edge dependency/mirror validation, every Edge entry-point typecheck and existing pure Edge fixtures. It uploads outputs even after failures. It has **not run in this session** and does not replace existing niche/APK/iOS release gates or contact paid/live providers.

Do not weaken existing failures to obtain a green audit. The available baseline already has source assertions expecting older contracts (e.g. branded base identity/Master Admin behaviour and retained-capture strings); these need reconciliation against upstream main and actual intended behaviour.

## Remaining blockers

1. **P0 — Source provenance:** reconcile with observed upstream main; obtain real checkout SHA, small reviewable commits/PR and preserve newer reporting deduplication work.
2. **P0 — Executable verification:** run full tests/typechecks, deployable Edge checks, all twelve branded exports and shared release APK/iOS builds. Confirm public backend configuration in release/OTA manifests; dependency inventory remains unread.
3. **P0 — Commercial evidence:** zero captured Quick List timing/live-confirmation events. Run approved accurate-stock end-to-end tests; no under-60 success, median or p90 may be asserted yet.
4. **P1 — Generic capture critical path:** shared identification still waits for serial studio work (up to the existing 150-second batch budget). Quick List already separates studio; extend only after memory/paid-replay/device acceptance, not by dropping enhancement functionality.
5. **P1 — Draft/value caches and recovery:** Quick List service caches use tenant/niche/item keys and retain rejected/results promises; validate auth-session/input scope, retry recovery and mutation fencing without automatic paid replays.
6. **P1 — Coin/valuation evidence:** multi-pass coin/Numista research can exceed the target; conservative Quick List eligibility remains unchanged. Verify image-search licence, API permission/coverage and approved sold-item access. Asking prices and AI estimates do not establish sold values or accurate pricing.
7. **P1 — Build drift:** available branded artwork mapping lacks `tunes_flip` and would reject that branded config. Resolve against latest main using approved music artwork. Older source tests also conflict with current unified-build behaviour; do not rewrite identities to satisfy obsolete expectations.
8. **P1 — Device/performance acceptance:** Android/iOS original-byte fallback, 5 MB handling, PWA camera, landscape/tablet layout, auth expiry, cached memberships, cancelled OAuth, slow networks and scope-switch races require installed/runtime testing.
9. **P2 — Large datasets/legacy pages:** measure full-page loading and RLS query plans before introducing pagination/lazy detail or extracting legacy page data operations. No destructive/dead-code cleanup was attempted without proof of non-use.

## Required measured acceptance

Use one baseline and candidate commit, identical ready-stock fixtures, devices and connectivity. Include barcode match/no match, tagged Collectibles, coin originals in both face orders, music CD/box-set, and representative other niche captures. Include denial, transport failure and duplicate-delivery cases.

Record JS T0 through existing stages to T7 **only after active eBay quantity, canonical external ID and content readback agree**. Separately record native process launch because JS T0 cannot measure pre-JS startup. Measure startup, capture/user actions, identification, original upload/readback, valuation, category, review, publish and reconciliation. Report median, p90, eligible denominator, failures/unconfirmed outcomes, accuracy/completeness and within-60 percentage. Match timing to the server live-confirmation event; acceptance acknowledgement or saved draft is not live evidence.

No measured before/after speed, functionality parity or production certification is claimed by this delivery.
