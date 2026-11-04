# SWISH navigation, Collectibles and owner verification — implementation evidence

## Result
Source changes implemented; full acceptance remains incomplete. No APK, IPA, hosted website deployment, OTA publication, signing replacement, package change or PR merge occurred. No existing inventory, authentication or encrypted eBay credential records were changed by investigation tools.

## Actual navigation causes inspected
1. `app/_layout.tsx` keyed the provider above `Stack` by active niche/epoch. Module initialization changed the key, destroying the navigator and returning it to its initial route.
2. `NicheRouteBoundary` replaced the whole navigator with a loading view during `openModule`. This independently remounted routing.
3. Root membership routing always selected `/swish` for owners/multiple memberships, even when a module was active.
4. `ModuleEntry` redirected every permission/initialization error to `/swish`, disguising authorization failures as successful refreshes.
5. Collectibles' legacy APK route allowlist omitted some shared workflows used by the new unified dashboard. Build pruning and unified runtime route permissions are now separate explicit policies.

## Changes
- Keep root navigator/providers and tab navigator mounted. Existing providers isolate draft/shelf state by user/tenant/niche. Dashboard content alone is keyed for reset.
- Card handlers activate trusted backend session scope before opening the registry's exact module route. All eleven canonical entries are retained; no alternate Collectibles identity created.
- Restore the server-held selection after a session refresh; root routing respects the active permitted module.
- Serialize module switching. Error messages remain in the shell or entry screen with a retry action; failed authorization and failed lazy dashboard loading produce redacted diagnostic events.
- Settings overlay failures no longer discard a successfully authorized module.
- Footer follows the established Home / Inventory / central camera / Listings / More order with safe-area padding. Existing per-niche accents remain, with SWISH yellow for Collectibles.
- Collectibles has its own lazy dashboard, existing banner artwork, six functional actions and explicit inventory selection for listing/valuation (never arbitrary first-item selection).
- Shared Collectibles prompts now cover toys, comics, figures, games, memorabilia, pop culture and vintage variants, with copyright/printing/packaging evidence and no invented authenticity or grades. Public and Edge prompt mirrors are changed identically; existing AI model/provider path retained.
- Multi-view photo capture uses existing picker, quality checks, review and storage. Condition, quantity/cost, market comparison retrieval, save and eBay-review-draft entry are connected. Prices separate sold evidence from asking prices. Saving retains item ID before photo upload to prevent duplicate records on retry; researched valuation merges existing attributes instead of erasing identification evidence.
- Video is NOT supported by the current image-only identification request. The UI states this; no nonfunctional video control was added.
- Master Admin has real platform counts where queries succeed, module routes/status, verification catalogue/history, safe test runner, builds/releases, updates, eBay metadata/jobs/errors, auth/backend health and redacted function outcomes. Unknown sources remain UNKNOWN/NOT CONNECTED.
- New `swish-verification` requires existing verified JWT, trusted owner RPC and tenant membership before every action. Diagnostic results use an additive owner-readable, service-writable table; clients cannot fabricate results by inserting rows.
- Safe tests execute real JWT/role/tenant reads and current-session inventory/listing samples and cross-niche authorization RPC denials. They do not create stock, generate AI from fixtures, publish/end listings or delete business data. Separate subscriber and write/device tests remain NOT TESTED.
- Live eBay diagnostics explicitly ask permission to use the existing seller-policy route, including its encrypted-token refresh and cache. All three policy HTTP responses must actually succeed; an HTTP error JSON body can no longer be reported as empty successful policies.
- Existing unified CI keeps the full regression suite and uploads its actual Jest JSON report even on failure. No test exclusions or fabricated PASS fixtures introduced.

## Executed evidence
Read-only SQL returned:
```
owner_bound: true
client_can_grant_owner: false
client_can_edit_scope: false
anon_can_open_module: false
verification_rls: true
client_can_insert_verification: false
collectibles_mapping: collectibles
```
These establish only binding, privileges, RLS flag and canonical mapping. They are not authenticated subscriber/Edge/device acceptance.
No network requests or owner health error logs were available when queried; this is NOT proof of healthy navigation or service operation.

## Acceptance register
`docs/SWISH_NAVIGATION_ADMIN_ACCEPTANCE_20261104.json` records every module card individually and every criterion with PASS, FAIL, BLOCKED or NOT TESTED. No card is marked PASS from source inspection alone.
Runtime dashboard-commit observations are recorded separately per platform after lazy content commits AND the backend verifies the matching current module/entitlement. These are owner-client observations of dashboard mounting, not automated screenshot tests or full specialist workflow certification.

## Rerun procedure (not executed by this editor)
1. Use the existing owner session; open each of eleven cards and confirm correct title, dashboard and footer. More → Master Admin → Refresh actual evidence shows observation references/timestamps/platforms.
2. Open a module before running safe backend checks; inspect the returned row-read sample and cross-module RPC denials. Repeated checks never promote separate subscriber/write/device tests.
3. In Collectibles, use real front/back/condition photographs, review/edit fields, retrieve comparisons, save, confirm photos and isolated inventory, choose the saved item to prepare a draft, review live category/aspects and pricing. Publishing remains an explicitly confirmed existing workflow, not part of safe tests.
4. Confirm the live eBay policy probe; inspect the outcome/reference and check ordinary sync pages. Diagnose failures from the existing logs, not by resetting consent or replacing credentials.
5. Run the existing CI regression workflow against a pinned commit. Suggested local command: `npx jest --config jest.config.ci.js --runInBand --json --outputFile=swish-regression-results.json`; also run `npx tsc --noEmit`, registry parity/dependency guards and full existing suites. Added source contracts: `services/__tests__/unifiedNavigationRepair.test.ts`.
6. Separately test ordinary single-/multi-membership accounts, cross-tenant and cross-niche reads/writes, Android/iOS/browser journeys and native update compatibility.

## Exact blockers
- No shell, Jest, Deno or native build executor is exposed in this editor. Tests were added/configured but not represented as run.
- No authenticated browser click harness or installed Android/iOS device session is available; all eleven real navigation clicks remain NOT TESTED here.
- Real Collectibles photographs/item and approved eBay action evidence are required for full workflow acceptance.
- Original Android signing identity/export and iOS provisioning/build access remain externally unresolved. No artifact URLs or checksums exist from this task.
- This App workspace implements the shared Expo web route logic; hosting/native distribution remains outside these editor tools.
- Edge source must be deployed through the existing OnSpace deployment mechanism before runtime verification. No deployed-revision or production-release claim is made here.
- Source inspection cannot guarantee preservation of newer remote feature-branch work: only current OnSpace files were changed; no remote pull request was merged.

The programme remains ACCEPTANCE INCOMPLETE until those executions and actual artifact checks are supplied.
