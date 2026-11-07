# SWISH production acceptance and release gate

Review date: **7 November 2026**. Audited public-main source: `aed7a1f5498666ee81fc6dcb2971c453cda51cd4` (owner performance export). Changes made during this review are **not yet CI-tested or deployed**. Machine-readable observations: [SWISH_PRODUCTION_ACCEPTANCE_EVIDENCE.json](SWISH_PRODUCTION_ACCEPTANCE_EVIDENCE.json).

**Verdict: BLOCKED — not production-ready.** Working administrative reads and correct aggregate counts do not establish complete device journeys, seller publication, identification accuracy or deployed source parity.

## 1. Changes implemented

- Performed actual live, read-only database reconciliation, exact local-image-object linkage checks, installed Minority Report aggregate execution, no-session RPC rejection tests, and five current SQL timing samples. No stock, listings, orders, photographs, credentials or seller records were rewritten.
- Retrieved current-main GitHub workflow/job results and annotations instead of treating component/function existence as acceptance.
- Corrected an actual acceptance-runner defect: the existing approved owner/subscriber JWT runner rejected every configuration because it required **11** products while the canonical registry contains **12**. It now requires all twelve, including Collectibles and Tunes Flip, and still requires a subscriber fixture with at least one denied niche. No original test assertions were removed or relaxed.
- Added an evidence-processing release gate for all fourteen journey steps per niche, shared regressions, runtime quality denials, inventory/image reconciliation, actual builds and deployment evidence. Static/source assertions, empty test results, skipped checks, missing artifacts, stale commits and unreviewed evidence cannot become passes.
- Added an independent automated runner that retains each command's exit code and logs, validates nonempty full Jest result counts, runs the existing Node JWT tests, TypeScript/lint, all Jest suites, Deno Edge tests/typechecks and Expo production exports. No new backend or duplicated commerce pipeline was created.
- Added per-niche/per-platform speed processing separating `listing_ready` from `research_review`. It requires actual native process/browser navigation opening timestamps and independent seller `GetItem Active` confirmation. JS foreground timestamps, provider acknowledgements, missing photographs and duplicate canonical occurrences cannot certify open-to-live timing.
- Extended the current readiness register additively. Dated historical findings are retained; no original S1–S7 task has been promoted.

These are verification/release-control changes, not a claimed repair of historical production data. A failing gate stays open.

## 2. Files changed

| File | Change |
| --- | --- |
| `scripts/verify-command-jwt.mjs` | Twelve-niche configuration fix; trusted JWT denials retained |
| `scripts/production-acceptance-contract.mjs` | Strict operational evidence contract and separated speed cohorts |
| `scripts/verify-production-release-gate.mjs` | Current-source validation, artifact hashes and approved-review gate |
| `scripts/production-acceptance-contract.test.mjs` | New gate, timing, zero-sample and twelve-niche regression tests |
| `scripts/run-production-acceptance.mjs` | Independent automated checks with retained failures and test-integrity comparison |
| `.github/workflows/production-acceptance-gate.yml` | PR/manual verification, existing unified APK build reuse, protected release review |
| `supabase/tests/production_acceptance_readonly.sql` | Repeatable administrative reconciliation and actual no-session negative calls |
| `docs/SWISH_FOUNDATION_MASTER_REGISTER.json` | Additive current review and observed risks; historical tasks retained |
| `docs/SWISH_PRODUCTION_ACCEPTANCE_EVIDENCE.json` | Actual observations and explicit unexecuted gates |
| `docs/SWISH_PRODUCTION_ACCEPTANCE.md` | This eight-part final report and execution handover |

No application screen, capture engine, production Edge handler, credentials, signing configuration, package manifest or lockfile was changed. No existing test file was edited or removed. Full historical assertion-strength comparison is still outstanding; the new runner blocks any changed/removed existing test/config until separately reviewed.

### Source control and preservation

Public main was observed at the SHA above and **branch protection was disabled**. Open PR **#170**, `Fix unified Master Admin owner navigation`, was observed and left untouched. This editor has no Git write/branch/PR/dispatch tool: **no focused branch, PR, merge, rebase or deployment was performed or claimed**. The current local checkout's full equivalence with remote main has not been established.

Before applying these verification changes to a protected release branch, use an authorized Git executor to inspect the working-tree diff, fetch current main, preserve any newer work, and create `verification/production-acceptance` from the reviewed current source. Do not reset newer changes or merge stale PR #170 without a fresh diff and checks. Require the production acceptance checks in branch protection; adding a workflow alone does not protect main or alter existing deployment workflows.

## 3. Tests passed and failed

### Actually executed and passed in this session

| Test | Actual observation | Boundary |
| --- | --- | --- |
| Canonical physical-record projection | 763 items / 763 rows; zero repeated item projection rows | Administrative SQL, not reopen/device acceptance |
| Complete tenant/niche count parity | All 17 observed scopes matched; zero missing scopes using full join | Existing stored data, not subscriber access |
| Minority Report aggregate execution | Installed reporting SELECT ran; all 12 modules matched canonical classified inventory; zero inventory mismatches | Extracted reviewed SELECT under admin scope; protected owner RPC/UI not exercised |
| Cross-tenant listing/order linkage | Zero mismatched linked tenant pairs | Data relationship audit, not RLS multi-account acceptance |
| Local photograph reference resolution | All 1,447 local references had matching Storage objects | Object presence, not decoded/rendered image quality or download availability |
| No-session inventory counts | Actual RPC call rejected with insufficient privilege | No authenticated subscriber JWT |
| No-session owner report/export | Actual command/export RPC calls rejected | Does not test positive owner or authenticated subscriber denial |
| Credential/lease boundary inspection | Client credential column inaccessible; client sync lease execute denied; service execute allowed; item/listing RLS and invoker projection retained | Catalog/privilege evidence only |

### Failed or adverse observations

- Current-main GitHub run [42397270420](https://github.com/troonvinyl-ux/SWISH/actions/runs/42397270420), job `128477230200`, **FAILED**. `npm install --ignore-scripts --package-lock=false` failed. Coin/parity test steps were skipped. Later wrapper steps showed success labels, but eight annotations included exit failures and **no files found in `verification-output`**. These labels are not accepted as proof that TypeScript or Jest passed; detailed install/test logs were unavailable. Dependency root cause is unconfirmed.
- The authenticated-SQL-role/no-session table-read probe returned a backend tool error. It is **failed/unresolved**, not a passed isolation test. No claim that this proves data leakage is made.
- Reconciliation found historical duplicates, inconsistent lifecycle rows and missing photo evidence, listed in sections 4, 6 and 7.

### Not executed on these changed files

TypeScript, lint, the new Node tests, full Jest, authenticated integration, Deno tests/typechecks, production bundle, signed Android build, web build, installed device/browser journeys, approved eBay publication, Numista request and deployed-source checks. This editor cannot run a shell/CI job or control a device. Historical CI passes are not reused as current-source certification.

### Per-niche complete journey acceptance

All steps **1–14 are NOT TESTED for every niche**. Administrative inventory/media counts below are not substitutes for those steps.

| Niche | Stored items | With media | Steps 1–14 |
| --- | ---: | ---: | --- |
| Coin Flipper | 460 | 459 | NOT TESTED |
| Flipper MX | 2 | 2 | NOT TESTED |
| Bike Flipper | 2 | 2 | NOT TESTED |
| Threads Flip | 3 | 3 | NOT TESTED |
| Card Flipper | 0 | 0 | NOT TESTED |
| Antique Flipper | 2 | 1 | NOT TESTED |
| Fossil Flipper | 0 | 0 | NOT TESTED |
| Beauty Flipper | 0 | 0 | NOT TESTED |
| Tech Flipper | 3 | 3 | NOT TESTED |
| Surplus Flip | 270 | 270 | NOT TESTED |
| Collectibles Flipper | 8 | 5 | NOT TESTED |
| Tunes Flip | 1 | 1 | NOT TESTED |

Catalogue acceptance must exercise the supported source or prove the expected unsupported/no-claim behavior; unsupported integrations must not be silently replaced with fabricated catalogue evidence. Empty niches still require approved test items.

### Requested regression status

| Regression | Status |
| --- | --- |
| Collectibles barcode matching | NOT TESTED with a real product/catalogue |
| Collectibles photo persistence | PARTIAL stored linkage audit; 3 of 8 items have no media; capture/restart NOT TESTED |
| Ancient coin identification | NOT TESTED on approved obverse/reverse images |
| Numista API integration | NOT TESTED; configured secret/source code is not API success |
| Image retries | NOT TESTED with injected failure and reopen |
| Failed publication retries | NOT TESTED with approved rejection/unknown-outcome scenarios |
| Duplicate eBay imports | One duplicate item/external-identity group observed; new import/replay NOT TESTED |
| Draft-to-live transition | NOT TESTED through live provider and canonical read-back |
| Live-to-sold transition | NOT TESTED through real order reconciliation; inconsistent stored row observed |
| Tenant isolation | No-session RPC denials passed; two-subscriber JWT boundary NOT TESTED |
| Niche isolation | Classified projection parity passed; authenticated cross-niche requests NOT TESTED |
| App/web consistency | NOT TESTED against installed/hosted same-source clients |
| Master Minority Report | Stored inventory aggregate parity passed; owner UI, live refresh, financial/quantity aggregation NOT TESTED |

## 4. Outstanding defects

| Priority | Finding | Required disposition |
| --- | --- | --- |
| High | Current-main dependency installation/verification workflow failure | Inspect actual installation logs and approved committed dependency/lockfile state; execute a fresh full suite; do not force dependency resolution or weaken tests |
| High | 70 duplicate tenant/order/item-line groups | Investigate canonical order allocation and quantity/fees before any operator-approved data correction |
| High | One duplicate tenant/eBay item identity group | Review provenance and canonical winner; do not merge/delete automatically |
| High | Five active/live listing rows have `ended_at` populated | Read actual seller state and reconcile using existing lifecycle infrastructure |
| High | One sold item has an active/live listing with no end date | Check sale/remaining quantity/provider state; no automatic relisting or ending |
| High | Five items have no media; two stored originals are absent from item media arrays | Review and restore valid references through existing photo recovery; validate restart/gallery/listing carry-forward |
| High | Main is unprotected; full current-source and deployment parity not confirmed | Focused PR, required gates, approved signing/build evidence and installed/hosted acceptance |
| Open | Current SQL samples are slower than the archived post-optimisation samples | Repeat controlled serial same-load measurements and inspect plans; do not assert a causal regression from different windows |
| Open | Authenticated role-only read probe failed with backend error | Diagnose tool/database context and run real approved owner/subscriber HTTP tests |
| Release blocker | All-niche journey, quality-denial, real provider and native/web parity tests missing | Execute on approved physical items, genuine accounts and installed/hosted clients |

The report's **253 flagged items** are overlapping operational flags, not 253 proven software defects. `ready` is **null**, with **zero** fresh readiness assessments; it is not zero ready inventory and must not be estimated.

Quality gates must be demonstrated through actual denied publication attempts for ambiguity, unsupported claims, incomplete fields, required-specific omissions and missing required photo roles. This review did not relax identification thresholds, skip required fields, remove validators or enable automatic publication. Those runtime denial tests remain mandatory.

## 5. Performance measurements

| Cohort | Samples | Median | P90 | Meaning |
| --- | ---: | ---: | ---: | --- |
| Current canonical tab-count SQL | 5 | 81.931 ms | 84.771 ms | Admin warm-cache EXPLAIN ANALYZE, same archived tenant/coin scope |
| Archived pre-optimisation SQL | 5 | 51.121 ms | 52.560 ms | Prior observation, not current execution |
| Archived post-optimisation SQL | 5 | 45.087 ms | 48.4134 ms | Prior observation, not current execution |
| Existing eBay listing handler, last 7 days | 83 | 502 ms | 2,602.8 ms | Recorded handler wall time; zero HTTP >=400 observations in this cohort |
| Actual application-open to confirmed live eBay | 0 | Unmeasured | Unmeasured | No Quick List timing events in the last 30 days |

Current SQL sample values: **86.295, 82.485, 81.931, 81.811, 80.911 ms**. These are slower than the archive; workload/window differences have not been controlled. They neither prove optimisation improvement in this session nor establish a specific new bottleneck.

For **listing-ready** items and **research/manual-review** items separately: median, P90, percentage within 60 seconds, failed attempts and manual-intervention item counts are **unmeasured/null**, not zero. No eligible item was timed or published during this session. No under-60-second certification is possible.

The new timing processor records per-platform cohorts; `publishedWithin60Pct` uses all recorded attempts, while a separately labelled success-only rate avoids hiding failures. Unconfirmed/abandoned attempts and manual intervention remain visible. SQL, handler/network, capture-to-live and true opening-to-live timings must never be summed or conflated. Existing T0 is JS initialization/foreground, not native process startup; it cannot independently meet the requested application-opening measurement.

## 6. Inventory reconciliation results

- **763** physical canonical item rows and **763** projected rows; zero projection multiplication.
- **751 classified** items agree with the installed Minority Report's twelve module inventory totals. **12 unclassified** items remain outside specialist totals and must be displayed/reconciled separately. Nothing was reassigned.
- All **17 observed tenant/niche scopes** agree, including a full-join check for missing groups.
- Zero cross-tenant linked listing/order pairs and zero repeated listing/external-ID groups.
- **One item/external-ID duplicate group**, **70 order-line duplicate groups**, **five live-with-end-date rows**, and **one sold/live inconsistency** remain unresolved. “Exactly one projection row per item” does not prove “one physical object per external identity.”
- Report operation outputs: **322 unpublished**, **253 flagged**, **0 readiness assessments**, **ready=null**. Asking value is not realised revenue. Financial, multi-unit and cancellation/refund aggregates were not independently fully certified.

No import, stock creation, transition, sale, cleanup or seller action occurred. A live duplicate-import replay and publication/sale reconciliation must be tested on approved fixtures through existing services, not arbitrary SQL mutations.

## 7. Image persistence results

- **758 of 763** items have media; **five** have none: Coins **1**, Collectibles **3**, Antiques **1**.
- **1,497** total media references; **1,447** local item-image references resolved to existing Storage objects; **zero missing local object records**.
- **50 external references** were not downloaded/decoded, and their availability/quality is unverified.
- **15 stored original objects** observed; **two** were not present in their item's media array. They may still be referenced elsewhere in attributes, but canonical gallery/listing carry-forward has not been demonstrated.
- **Zero** items had `_photo_pipeline` metadata and **zero** retry-required flags. Absence of telemetry is not proof of successful uploads or retries.
- Camera capture, actual upload, retry, identification, save, app restart, inventory reopen, draft selection and eBay-photo read-back are **NOT TESTED**.

No photographs or references were deleted or modified. Recover the two original references and investigate missing media before declaring the shared persistence path accepted.

## 8. Production readiness verdict

**BLOCKED. No deployment confirmed.** This review verified useful stored-data behavior and exposed unresolved defects; it did not complete the user journeys. Neither the absence of recent error logs nor a returned listing ID by itself can certify production.

### Authorized execution handover

1. Preserve current main/newer work and open a focused reviewed branch. Inspect the failed current-main installation log and commit the intended dependency lockfile through the authorized repository workflow; this editor did not modify package files.
2. Run `node scripts/run-production-acceptance.mjs` with `SWISH_TEST_BASE_SHA` set to the reviewed full base SHA, or dispatch **SWISH production acceptance (no release)** on that branch. Missing tools/lockfile, empty test results, changed existing tests, lint/type failures, Edge errors and build failures stay failures. The Android JS export is not an APK; select `build_android` for the existing signed unified APK verifier after automated gates pass.
3. Provision the operator-protected environment `swish-production-acceptance-review` and require its check in branch protection. The wrapper reuses the current build workflow; it does not upload to stores or publish OTA.
4. Generate a blank manifest with `node scripts/verify-production-release-gate.mjs --template`. Every check starts `NOT_TESTED`, not PASS. For each niche execute steps 1–14 on approved real items, recording same-source device/browser evidence, original photo roles and IDs in a **private evidence store**. Do not place tokens, credentials, addresses, item payloads or private media in committed manifests.
5. Perform approved JWT owner/subscriber/foreign-tenant/wrong-niche tests using the existing runner and protected credentials. The existing runner additionally retains diagnostics only after its explicit approvals; it is not an automated seller test. Run real Numista/Discogs/catalogue cases where supported and compare expected identifications, not just nonempty responses.
6. Inject controlled image and publication failures. Reconcile unknown accepted outcomes before retrying; demonstrate no duplicate item/draft/live records. Replay imports and verify draft/live/sold transitions without manufacturing sales or modifying historical production records.
7. Record actual native process or browser navigation opening time through seller `GetItem Active` and canonical read-back. Include all attempts, failures, interventions and separate listing-ready/research cohorts per niche/platform. A small observed sample is not statistical certification; disclose sample sizes.
8. Resolve each artifact hash against the exact tested/deployed source and record approved review. `SWISH_ACCEPTANCE_EVIDENCE_FILE` selects the operational manifest; `SWISH_APPROVED_ACCEPTANCE_REVIEW=1` is allowed only after protected operator approval. The CLI verifies file hashes inside the checkout, not the authenticity of screenshots or human observations; the reviewer must establish provenance. Source-only/mocked tests must never be submitted as runtime journey evidence.
9. Reconcile the outstanding duplicate/lifecycle/photo findings through existing recovery services and operator-controlled data management. Re-run independent SQL, client/API and report checks afterward.
10. Confirm the actual installed APK/IPA identity/signature, web deployment, backend revision and hosted smoke results. A workflow configuration, artifact download, historical success or new source commit is not deployment confirmation.

The gate exits nonzero without complete evidence. Passing evidence produces **ELIGIBLE_FOR_OWNER_RELEASE_REVIEW**, not an automatic merge or deployment. Actual release remains an owner action using the existing release pipeline, and its result must be confirmed separately.
