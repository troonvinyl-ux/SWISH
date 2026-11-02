# SWISH live execution and remediation report — 2 November 2026

## Release verdict

**NOT PRODUCTION READY. Live checks executed; full S1–S7 acceptance is blocked and incomplete.**

All 25 existing Edge Function endpoints were requested with an unauthenticated, body-free GET. OnSpace gateway/invocation logs corroborate **10 HTTP 500 failures**, nine with an explicit `BootFailure` execution entry. The remaining 15 endpoints returned their public document or an authentication/method rejection. Those 15 results are limited smoke observations, not successful authenticated business operations. Four live retests after source dependency changes still returned 500. No failed function is marked recovered or VERIFIED.

Machine-readable, sanitized evidence: [`SWISH_LIVE_VERIFICATION_20261102.json`](SWISH_LIVE_VERIFICATION_20261102.json). Timestamps below are UTC from database or OnSpace logs. Scraper retries may produce several log records for one logical GET probe; they are not counted as separate acceptance tests. Blank invocation status 0 is not an HTTP success; the corresponding gateway 500 is authoritative.

## 1. Access report

| Resource | Actually accessed | Boundary / missing permission |
|---|---|---|
| Existing OnSpace Cloud database | Yes, `iwgaqieyoahmcjfziwga`, PostgreSQL 15.14, inspection role `supabase_admin` | SQL/catalog read access is not a subscriber login/session |
| Storage | Yes, bucket/object catalog: two buckets, 1,426 objects | No binary upload/download or signed-object retrieval executed |
| Edge endpoints | Yes, 25 live HTTP GET probes plus four retests; gateway/invocation logs read | No arbitrary authenticated POST request tool or runtime test executor exposed |
| Auth/database permissions | Yes, effective grants and read-only identity-free `anon` / `authenticated` transactions | No dedicated test-account credentials or approved existing sessions available; no account impersonated |
| GitHub | Specified commit and its tree retrieved through public GitHub API | Fresh main-head/open-PR requests returned no usable data; do not interpret `[]` as zero PRs. No authenticated write/dispatch/merge tool |
| Application/web | Public deployed privacy document only (document version 2.0) | Hosted app origins, deployment manifests and browser automation not supplied |
| Android | No installed device or device automation available | No APK requested or built |
| Sandbox | None independently confirmed | Repository eBay adapters inspected use production hosts; an authorized sandbox connector/account is not established |
| eBay | Connector metadata inspected; no seller token decrypted or provider operation invoked | Authorized test session and secure authenticated runner required |
| Deployment revisions | Not available | No function/deployment metadata tables exposed; logs have no revision IDs. Need OnSpace deployment manifest and full sanitized boot/import diagnostic |

Eight profiles and five owner memberships across five tenants were counted. No explicit test/environment marker columns exist in the three account tables inspected. This does **not** prove no test accounts exist; Nick must identify and authorize fixtures. Customer names, emails and record identifiers were not exported. No password, token, credential payload, encryption key or environment secret value was read.

### Configuration disclosure boundary

Injected project metadata declares backend Ready, signup enabled, anonymous auth disabled, password minimum 6, OTP length 4/expiry 3,600 seconds, Google disabled. These are configuration-context observations, not a successful Auth API configuration fetch. `auth.instances` has zero rows; it is not treated as a reliable OnSpace Auth configuration inventory. Direct auth-schema usage is denied to client roles; no grants were relaxed.

The following secret **names are declared configured in project context**, not independently runtime-validated: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL`, `ONSPACE_AI_BASE_URL`, `ONSPACE_AI_API_KEY`, `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET`, `EBAY_RU_NAME`, `SWISH_CREDENTIAL_KEY`, `NUMISTA_API_KEY`, `STRIPE_SECRET_KEY`, `EBAY_SIGNATURE_KEY_JWE`, `EBAY_SIGNATURE_PRIVATE_KEY`. No values recorded. `SWISH_INTERNAL_SECRET` is not in that supplied list; its actual presence/absence and external callers are **unknown**, not certified absent.

## 2. Live Edge results

All inputs: GET, no body, no Authorization, no API key. All environments: the connected OnSpace Cloud origin above. Deployed version: **UNKNOWN for every row**. Evidence: matching `edgeSmokeResults` row plus the same-slug OnSpace logs.

| Function | UTC on 2026-11-02 | HTTP | Actual outcome |
|---|---|---:|---|
| swish-check-subscription | 15:17:06 | 500 | FAILED; repeated production POST 500 entries also observed, no detailed execution cause |
| swish-coin-image-enhance | 15:17:07 | 405 | POST required; no AI invoked |
| swish-create-checkout | 15:17:08 | 405 | Method rejected; no checkout created |
| swish-customer-portal | 15:17:10 | 401 | Authentication required |
| swish-decompose | 15:17:12 | 401 | Authentication required |
| swish-ebay-browse | 15:17:14 | 405 | Method rejected |
| swish-ebay-category | 15:16:34 | 405 | Method rejected, not a taxonomy test |
| swish-ebay-draft-sync-test | 15:16:39 | 405 | POST required; no offers changed |
| swish-ebay-finances | 15:15:34 | 405 | Method rejected, not an eBay finance request |
| swish-ebay-list | 15:16:36 | 500 | FAILED; BootFailure |
| swish-ebay-listing-status | 15:17:19 | 500 | FAILED; BootFailure |
| swish-ebay-messages | 15:17:18 | 500 | FAILED; BootFailure |
| swish-ebay-oauth | 15:16:37 | 405 | Bare GET rejected; no consent flow executed |
| swish-ebay-orders | 15:17:16 | 405 | Method rejected; no order import executed |
| swish-ebay-post-order | 15:17:19 | 405 | Method rejected |
| swish-ebay-sync | 15:17:21 | 405 | Method rejected |
| swish-identify | 15:17:25 | 500 | FAILED; BootFailure |
| swish-image-download | 15:17:26 | 405 | Method rejected |
| swish-islamic-identify | 15:17:28 | 500 | FAILED; BootFailure |
| swish-list-generate | 15:17:29 | 500 | FAILED; BootFailure |
| swish-market-value | 15:17:29 | 500 | FAILED; BootFailure |
| swish-migrate-credentials | 15:17:30 | 405 | Method rejected; no credential migration |
| swish-privacy-policy | 15:15:34 | 200 | Public document retrieved |
| swish-reprice | 15:17:33 | 500 | FAILED; BootFailure |
| swish-verify | 15:17:34 | 500 | FAILED; BootFailure |

These observations demonstrate deployed endpoint responses, not matching repository revisions, functioning authenticated handlers, complete redaction, CORS preflight or effective tenant/paid-niche enforcement. Boot failures are not evidence that authorization succeeded or failed safely inside the handler.

### Post-source-edit live retests

The same safe method was retried using a non-sensitive `verification=boot-retest-1` query marker:

| Function | UTC | HTTP | Final observed result |
|---|---|---:|---|
| swish-check-subscription | 15:21:30 | 500 | STILL FAILED; deployed revision unknown |
| swish-ebay-messages | 15:21:32 | 500 | STILL FAILED; BootFailure |
| swish-identify | 15:21:33 | 500 | STILL FAILED; BootFailure |
| swish-ebay-listing-status | 15:21:33 | 500 | STILL FAILED; BootFailure |

No approved deployment acknowledgement or revision parity was available before these retests. It is not established that the endpoint used the repaired source. Do not interpret saved files or completion of this editor session as a verified deployment. Obtain full sanitized import diagnostics and repeat probes against an acknowledged revision.

## 3. Database / storage / security execution

Evidence IDs refer to `databaseEvidence` in the JSON artifact.

| Test | UTC | Result | Evidence and exact limit |
|---|---|---|---|
| Connectivity and RLS catalog | 15:15:33 | PASSED narrow check | L01: 48 public tables; zero without RLS |
| Client credential/membership/billing grants | 15:15:33 | PASSED narrow check | L02: all seven inspected dangerous privileges false |
| Storage metadata | 15:15:33 | OBSERVED | L03: `item-images` public, manifests private, both 5 MB; no upload test |
| Test fixture discovery | 15:15:34 | BLOCKED | L04: no authorized fixtures independently identified |
| Deployment metadata discovery | 15:15:34 | BLOCKED | L05: no accessible revision tables / HTTP SQL extensions |
| Connector metadata | 15:16:09 | OBSERVED | L06: four encrypted envelopes, two connected; all four stored expiry timestamps expired. Not proof of OAuth/token failure |
| Canonical listing integrity | 15:16:09 | PASSED narrow link observation | L07: zero cross-tenant links or repeated external listing-ID groups; zero publish claims |
| RPC grants | 15:16:09 | PASSED narrow check | L08: claim/ingestion service-only; transition invoker/authenticated; anon cannot execute |
| Initial role probes | Timestamp not returned | FAILED instrumentation | L09/L10: direct `auth.uid()` reference denied for auth schema; no mutations |
| Corrected anonymous read probe | 15:16:33 | PASSED narrow check | L09R: zero items/listings/memberships visible |
| Corrected unbound authenticated-role probe | 15:16:33 | PASSED narrow check | L10R: zero items/listings/memberships visible; no subject and no real login |
| Aspect cache observation | 15:16:09 | OBSERVED | L11: 2,040 categories, 15 caches / 214 entries; not live eBay taxonomy |
| Repeated order identity review | 15:16:33 | OPEN finding | L12: 69 repeated order-ID groups, zero with distinct non-null items; 70 repeated order/item groups. Do not assume these are valid multi-line allocations or delete them |
| Historical finance diagnostics | 15:16:33 | INSUFFICIENT EVIDENCE | L13: zero matching finance log rows in `ebay_api_log`; retained function logs cannot reproduce historical 400/499 |
| Storage/auth grants | 15:17:34 | OBSERVED | L14: client storage grants exist, 16 policies; auth schema denied; no policy changes |
| Clothing specifics persistence evidence | 15:17:34 | INSUFFICIENT EVIDENCE | L15: one clothing item, zero saved specifics/all-three entries; no new editor save/reopen test |
| Order/finance uniqueness constraints | 15:18:57 | OBSERVED | L16: no order UNIQUE constraints; finance has transaction/tenant UNIQUE |

The role probes are actual SQL/RLS execution under identity-free roles, **not** account-to-account security acceptance. Cross-tenant read/write/delete, privileged operator access, expiry/cancellation enforcement and real storage uploads remain unexecuted. Transactions were read-only and rolled back. No customer data was modified or removed.

## 4. eBay acceptance

OAuth authorization, expired-token refresh, ten-niche live categories/aspects, unpublished offer creation/read/revision, order pagination/idempotency, message summaries/bodies, replies, transactions/payouts and fee reconciliation: **NOT EXECUTED** with an authenticated authorized seller. No test listing was published; no message sent; no offer imported or revised.

Stored expiry metadata and envelope prefixes cannot prove token usability, decryption or scope validity. A past OAuth log showed an expired session; it is not a test completed by this session. Production eBay hosts are present in inspected adapters; no sandbox credentials or safe draft fixture have been established.

### Finance 400/499 finding

The new actual request was a body-free GET and returned 405; it did not enter the finance request flow or call eBay. Recent finance logs showed these GET rejections, not a correlated authenticated 400/499. Therefore the historical cause remains **UNKNOWN**.

Inspected workspace source can return 400 both for input/reauthorization and funds/payout API error branches. The repository's existing handover distinguishes `/transaction` from these other paths; do not extrapolate its transaction-only mapping to every route. Neither expiry metadata nor an old report proves the production root cause. Required evidence: authenticated `get_funds_summary` invocation timestamp, sanitized route/HTTP/error category, OAuth refresh status, signature/keyset configuration presence, and matching upstream status/error code. Do not log raw bodies, tokens or request headers.

The source inspected also omits `booking_entry` in one fee aggregation query and reports `success:true` despite transaction persistence errors/partial fetches. These are **source findings**, not a reproduced provider defect; reconcile source with the approved GitHub commit and deployed revision before a separate financial remediation. No mass ledger reconciliation/cleanup was performed.

## 5. Remediation implemented

### Deployment dependency repair

Source inspection proved these deployability defects:
- Entrypoints and shared server adapters imported `../../../shared/*` and `../../../niche-modules.json`, outside the deployable `supabase/functions` tree.
- `swish-list-generate` referenced absent `_shared/specialistIntelligence.ts`.
- `swish-reprice` referenced absent `_shared/repriceNicheAccess.ts`.

These defects correlate with the boot-failing dependency paths, but the logs expose only `BootFailure`, not the full import stack. They are not claimed as the complete confirmed runtime root cause.

Small corrections saved:
1. Point subscription, identify, messages, listing-status and server entitlement/specialist adapters at local `_shared` deployment assets.
2. The repository did not contain the referenced `sync-backend-registry.mjs` generator. PR #134 instead makes the validator self-contained and checks byte-for-byte parity between canonical `shared/` assets and their deployable `_shared/` mirrors. Author rules remain canonical in `shared/`; mirror drift fails CI.
3. Restore the missing repricing adapter using existing canonical registry specialist/alias ownership, not a hard-coded replacement list.
4. Add a read-only dependency-containment/parity gate and regression fixtures for escaped, missing and stale dependencies. Wire it and Deno graph resolution into the existing foundation workflow. PR #134 verifies the gate against all 25 Edge Function entrypoints.
5. Add a manual-only, approval-gated credential-free Edge smoke runner/workflow that records HTTP/timestamps and fails on 500, without builds or provider mutations. Its `productionReady` is always false.

| Issue | Correction | Retest / status |
|---|---|---|
| Broken/out-of-tree dependency graph | Local imports, deployable canonical mirrors, registry-derived repricing adapter and dependency/parity gate | Source repair merged in PR #134; eBay publish internal-secret bypass closed in PR #135; all source CI passed. Four earlier live retests remain inconclusive because deployment revision was not acknowledged; full boot diagnostics/revision acknowledgement still needed |
| SQL probe auth-schema instrumentation failure | Remove direct auth-schema reference; retain actual RLS count query | Two corrected read-only probes PASSED; no permissions relaxed |
| Ten failing endpoint probes | Record real 500/BootFailure evidence, retain failures | OPEN, not promoted |
| Repeated order/item identities | Aggregate evidence and review blocker retained | No cleanup; allocation/duplicate diagnosis unverified |
| Missing live test fixtures / device access | Record precise access requirements | BLOCKED; no mock replacement |

PR #135 closes the source-level global internal-secret bypass. PR #136 also replaces the direct inventory status write after eBay listing end with the existing `swish_transition_item` RPC, preserving lifecycle and audit events and requiring explicit RPC acknowledgement. Both fixes have passing source CI: a supplied `SWISH_INTERNAL_SECRET` is now an additional check and cannot replace user JWT verification or tenant membership. Any external internal caller must forward a valid user JWT; its existence and compatibility remain unknown until OnSpace caller/deployment inventory. Deployed enforcement remains unverified until revision parity is confirmed. Additional source-only risks retained, not silently modified: required-aspect name normalization in the listing adapter; draft diagnostic creation/import limitations and tenant-only gates; header-only messages/no body route; unresolved actual fee/allocation/partial-success defects. A separate approved, tested remediation is required. The public privacy document still contains a placeholder business contact and statements about messaging/direct database access that need owner/legal reconciliation; no business contact or policy was invented.

### Unchanged architecture and data

One OnSpace Cloud project/database/auth/tenancy model; same canonical item IDs, specialist sources, AI models, eBay Trading/Inventory adapters, encrypted credential implementation, Stripe product/prices, buckets, ten niches, app screens, package identities, native signing and release targets. **No database DDL, data mutations, new backend, authentication system, APK rebuild, UI redesign or eBay publication.**

## 6. AI and app/web acceptance

Real representative image tests: **0**. No accuracy percentage, confidence score or valuation outcome invented. No AI requirement/model added; only deployment dependency packaging corrected. Ten-niche image upload/identify/value/list/save/relogin testing remains blocked on authorized fixtures and execution access.

Installed-device tests: **0**. Hosted app screens tested: **0**. Screenshots captured: **0**. The public privacy document is the only web content retrieved; it does not establish landing-page, navigation, branding, authentication, subscriber/admin or cross-device parity. No new APK is necessary for the first web/backend retests; reuse an installed build for native scenarios when available.

## 7. Automated test status and approved next execution

PR #134 was merged to `main` as `2145b4c72d0eb111ff3c9a0bf95871af0cabd4db` and PR #135 as `d5e876a96139325cfb27e8a9c85361a92cb90c01` after all required source CI workflows passed. The S2–S3 foundation workflow passed 53 Jest suites / 1,053 tests, TypeScript, lint (0 errors; 327 warnings), canonical registry validation, Edge dependency containment/parity and four Deno paid-niche authorization tests. Master Admin readiness passed 560 tests across 15 suites, Edge syntax/secret-boundary checks and all ten Android JavaScript bundles plus Master Admin. All ten branded web exports and niche routing passed. The live authenticated workflow was skipped because the protected fixtures were not configured/approved. These results prove source/CI readiness only, not deployed revision parity or authenticated production acceptance.

On an approved runner, execute:

```sh
node scripts/validate-edge-deployment.mjs
node scripts/validate-foundation.mjs
node scripts/validate-production-register.mjs
bash scripts/install-dependencies.sh
npx tsc --noEmit
pnpm lint
pnpm dlx jest@29.7.0 --config jest.config.ci.js --runInBand
for entry in supabase/functions/*/index.ts; do deno info --json "$entry" > /dev/null; done
deno test --allow-read --allow-env supabase/tests/paidNicheAuthorization.test.ts
SWISH_APPROVED_EDGE_SMOKE=1 node scripts/verify-edge-smoke.mjs
```

The last command performs real safe GET requests only. A smoke pass is not full acceptance. First obtain and compare the deployment revision/import diagnostics; do not overwrite all production functions blindly. Once acknowledged, repeat all ten failed endpoint probes and the authenticated scenarios. Preserve original failures and exact revision evidence.

## 8. Exact remaining access / approvals

1. **OnSpace deployment control:** deployment manifest/revision IDs and complete sanitized boot error details for the ten failing endpoints; permission to deploy reviewed function/shared assets. Current tools expose SQL, source and 20-entry logs, not an authenticated deployment API.
2. **Approved subscriber fixtures:** two distinct designated test accounts/tenants/items and their paid niche grants, supplied through a secure runner environment, never chat. Existing protected GitHub environment `swish-s3-verification` expects `S3_BACKEND_URL`, `S3_ANON_KEY`, `S3_ACCOUNT_A_EMAIL`, `S3_ACCOUNT_A_PASSWORD`, `S3_ACCOUNT_B_EMAIL`, `S3_ACCOUNT_B_PASSWORD`, `S3_TENANT_A`, `S3_TENANT_B`, `S3_ITEM_A`, `S3_ITEM_B`, `S3_NICHE_A`, `S3_NICHE_B`. No service-role key or eBay secret needs to reach the client/runner for the existing read-only script.
3. **GitHub/live workflow:** source changes are now committed and merged through PRs #134 and #135; required source CI is green. The protected `swish-s3-verification` workflow still needs approved test fixtures and an authorized manual dispatch. The current connector cannot dispatch that protected workflow.
4. **eBay authorization:** Nick designates an authorized sandbox account or the connected production seller and a safe unpublished offer fixture. No production reply/publish/end/buy permission is implied. Current draft diagnostic only reads/updates existing offers; do not call the publish route to create a supposed draft.
5. **Media/web/device:** approved ten-niche photo fixtures with independently known identification basis, hosted app URLs/build revision, browser session/testing access, and an installed Android test build/device. Do not request plaintext credentials or a rebuild as a substitute.
6. **Order data review:** owner-approved analysis/export of the 69 repeated order-ID / 70 repeated order-item groups before changing identity/uniqueness/allocation logic. Never delete records automatically. Any cleanup belongs in the Cloud Data dashboard under owner control.

## 9. S1–S7 register reconciliation

S1-04 was promoted to VERIFIED solely for completion of the blocker-audit artifact (architecture audit, engineering audit/handover and 25-entry Edge Function security matrix). No live security, deployment, eBay or production acceptance is implied. No niche certificate was promoted. S7-05 records that limited live execution has started, not that operational acceptance passed. Counts are unweighted task-state counts, **not feature coverage, accuracy or production readiness**. IMPLEMENTED-or-VERIFIED describes historical source implementation; VERIFIED includes evidence-backed audit/repository checks, not necessarily live production acceptance.

| Stage | Task records | IMPLEMENTED or VERIFIED | VERIFIED | Full live-stage acceptance this session |
|---|---:|---:|---:|---|
| S1 | 5 | 5/5 (100%) | 2/5 (40%) | Not passed |
| S2 | 4 | 4/4 (100%) | 4/4 (100%) | Not passed; prior verification is source/CI |
| S3 | 5 | 2/5 (40%) | 0/5 (0%) | Not passed |
| S4 | 5 | 5/5 (100%) | 0/5 (0%) | Not passed |
| S5 | 4 | 4/4 (100%) | 0/4 (0%) | Not passed |
| S6 | 4 | 4/4 (100%) | 0/4 (0%) | Not passed |
| S7 | 7 | 2/7 (28.57%) | 0/7 (0%) | Not passed |
| Total | 34 | 26/34 (76.47%) | 7/34 (20.59%) | 0/7 stages passed full live acceptance |

The ten-niche certificate matrix remains **0/140 explicitly verified acceptance areas** in the register. Real database and HTTP evidence advances execution/discovery only. Source implementation, a 405, RLS enabled, a generated file, or an earlier CI pass is not certification of a production subscriber workflow.

**Recommended immediate next step:** deploy the reviewed `2145b4c` source/shared assets through OnSpace Cloud, capture the exact deployed function revision IDs and full sanitized import/boot diagnostics, then repeat the four previously failed probes. After deployment parity is established, run the protected two-account read-only acceptance workflow and proceed to controlled eBay/media tests.
