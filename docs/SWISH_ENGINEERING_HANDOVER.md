# SWISH hardening handover — 2026-10-30

## Release verdict
**Not production-ready. This is a working-source hardening pass, not an executed end-to-end acceptance test.** No APK, CI run, device session, live OAuth refresh, marketplace publish, payment or deployed Edge Function revision was verified from this session. The initial audit is in `docs/SWISH_ENGINEERING_AUDIT.md`; it records pre-change findings, not final state.

## Architecture retained
One OnSpace Cloud backend, one database, stable canonical item UUIDs, existing Supabase-compatible client, existing auth providers, existing eBay OAuth/Trading API architecture and AI models. Expo native and Expo web consume the same service modules. Separate website/workspace code was unavailable. No replacement app/database/authentication system was created.

Shared engine = `services/`, business hooks = `hooks/`, presentation = `app/` and `components/`. `niche-modules.json` is the dependency-free identity/package/route/specialist registry used by Node packaging, Expo config and TypeScript routing. Existing `constants/niches.ts` retains presentation/capture config; `constants/specialists.ts` retains intelligence capabilities. `shared/` remains a documented boundary, not a second implementation.

## Canonical mappings
| Product | Canonical niche | Default specialist | Entry |
|---|---|---|---|
| Coin Flipper | coins | coins | /entry/coins |
| Flipper MX | motocross | motocross | /entry/motocross |
| Bike Flipper | bicycles | bicycles | /entry/bicycles |
| Threads Flip | clothing | clothing | /entry/clothing |
| Card Flipper | trading_cards | pokemon_cards | /entry/cards |
| Antique Flipper | antiques | antiques | /entry/antiques |
| Fossil Flipper | fossils | fossils | /entry/fossils |
| Beauty Flipper | beauty | beauty | /entry/beauty |
| Tech Flipper | tech | tech | /entry/tech |
| Surplus Flip | surplus_flip | surplus_trader | /entry/surplus-flip |

Verified historical aliases are read-only compatible (including one observed clothing_specialist record). Unknown IDs are never matched through substring heuristics. Generic curiosities records remain under General; they are not assigned to Coins. Existing metal/ancient specialist rows retain their established Coins routing; Antiques uses its own specialist/books. No historical record was reclassified. Newer niches receive a configuration-driven inventory home/capture client rather than a duplicate AI engine; their specialist output quality is NOT certified.

## Applied live SQL changes
Four tracked migration files document this pass:
- `20261030_security_boundaries.sql`: revoke direct client membership INSERT/identity UPDATE; repair recursive membership management check; restrict provisioning to auth.uid(), validate inputs, serialize concurrent provisioning; fixed function search_path; remove secret-column access; preserve safe connector metadata/policy updates; prevent client billing-tier edits. Only NEW tenants start starter instead of incorrectly receiving professional. Existing tiers remain unchanged.
- `20261030_publish_claim.sql`: add nullable server-owned publish_claim_id/publish_claimed_at to existing listings; service-role-only atomic claim; clients cannot reset it. No status enum or existing marketplace IDs changed.
- `20261030_editor_disconnect_storage.sql`: authorized command-only connector disconnect without deleting credentials; atomic invoker-RLS editor save retaining stable item/inventory IDs and specialist; restrictive Storage writes for existing item-ID/tenant-ID path layouts.

- `20261030_listing_tenant_guard.sql`: reject future cross-tenant listing/item links with a trigger, including service-role writes. Existing rows are untouched.

No user data was deleted, bulk updated, migrated to another database, or overwritten by audit tools. Credential key rotation was not attempted. Four connector payloads already had enc:v1 prefixes; no plaintext migration was needed/triggered. Migration code now verifies encryption round-trip and uses compare-and-swap before replacing legacy payloads. Prefix checks do not prove decryption/token refresh success.

## Executed checks and evidence
These were real SQL/catalog/role checks, not Jest mocks:
- Authenticated credential SELECT/UPDATE: denied; anon credential SELECT: denied.
- Authenticated membership INSERT and tenant_id UPDATE: denied.
- Anonymous provisioning execute: denied; missing-JWT authenticated provisioning: denied.
- Safe connector status SELECT and selected return-policy UPDATE privileges: retained.
- Client subscription_tier UPDATE: denied.
- Client publish-claim execute/reset: denied; service-role claim execute: allowed.
- Editor RPC uses SECURITY INVOKER (RLS preserved).
- After hardening: 751 items, four connectors, four enc:v1 payloads; no duplicate external-listing groups or cross-tenant item/listing links were found during the audit.
- Storage path audit: 156 item-prefix objects, 1,234 tenant-prefix objects, 36 ambiguous legacy objects. Existing objects remain publicly readable; client writes to ambiguous paths fail closed. Storage policies were created, but real uploads/overwrites were not exercised.
- Finance logs: recurring HTTP 400/499 observed. Provider response bodies were unavailable; the exact historical cause remains unproven.

## Source changes
**Identity/build:** `niche-modules.json`, `constants/niches.ts`, `services/nicheRouting.ts`, `app.config.js`, `scripts/prepare-niche-routes.js`, `scripts/verify-niche-module.js`, `scripts/install-dependencies.sh`, `scripts/verify-apk.sh`, `tsconfig.json`.

**Client:** `contexts/AppContext.tsx`, `hooks/useInventory.ts`, `hooks/useMasterInventory.ts`, `hooks/useListingEditor.ts`, `hooks/useGenericCapture.ts`, `hooks/useNicheRoute.ts`, `hooks/useNicheEntry.ts`, `services/itemService.ts`, `services/listingService.ts`, `services/listingLifecycle.ts`, `services/listingEditorService.ts`, `services/inventoryViewService.ts`, `services/marketplaceService.ts`, `services/aiIdentificationService.ts`, `services/nicheCategoryService.ts`, `components/layout/NicheRouteBoundary.tsx`, `components/feature/NicheOverview.tsx`, `app/_layout.tsx`, `app/index.tsx`, `app/(tabs)/index.tsx`, `app/(tabs)/_layout.tsx`, `app/(tabs)/inventory.tsx`, `app/(tabs)/scan.tsx`, `app/capture.tsx`, `app/ebay-listing-editor.tsx`, `app/marketplaces.tsx`, five missing entry routes, `constants/theme.ts`.

**Edge source:** `swish-ebay-sync`, `swish-ebay-orders`, `swish-ebay-list`, `swish-list-generate`, `swish-migrate-credentials`. Existing models/provider configuration were retained. Other Edge Functions were not rewritten or certified.

**CI/tests:** reusable `_niche-android.yml`, both APK dispatch workflows, branded web workflow, OTA workflow gates, signed-release secret tracing/artifact checks, `engineeringHardening.test.ts`, targeted corrections to `nicheIsolation.test.ts` and `brandedBuildConfig.test.ts`. Existing failing tests were NOT deleted or configured to ignore failure.

## Behavior changes
- Empty explicit specialist filters return no data. Inventory hooks automatically intersect requested specialists with current niche scope, discard stale account/niche results and poll at 30-second intervals instead of unsupported Realtime.
- Account loading is fenced by authenticated user/request generation. Tenant-load errors show Retry rather than silently starting onboarding.
- Stock/Draft/Live/Sold share one lifecycle helper; live requires an external listing ID, no ended timestamp and unsold linked inventory. Live photos are retained. Stock excludes only actual drafts/live listings, not all historical listings.
- Inventory image persistence is restored as a scoped item-ID job. Sold sync now calls the actual orders contract rather than unsupported action=sync_sold.
- Conflicting marketplace category/title signals are unclassified. Explicit empty import context fails closed.
- Editor save is atomic and validates prices/quantity/specific lengths/count/uniqueness. SKU no longer overwrites inventory_id in the changed editor/eBay revision routes. Editor loads only the active niche and prefers explicit saved specifics. Existing category/condition/price/media/revision capabilities remain; no automatic category assignment is made.
- Listing generation no longer defaults every non-MX item to coin; non-coin material/era names are retained and structured JSON is checked. Raw AI error bodies are not returned by the changed generator.
- eBay sync no longer narrows consented token scopes; an unverified/partial selling-page fetch aborts before reconciliation. Exact external listing IDs constrain updates; missing listings are not automatically treated as ended. Existing canonical titles are not replaced merely because eBay titles differ.
- Publish validates owned revise IDs, retains canonical inventory IDs, rejects missing confirmed external IDs, checks persistence errors, prioritizes seller specifics and uses a durable server claim to avoid concurrent sends. Timeout messages correctly describe an unknown outcome instead of guaranteeing no submission. Unknown outcomes deliberately remain blocked until marketplace reconciliation; automatic claim expiry would permit duplicate sales/listings and is not implemented.
- Orders now use validated niche/specialist scope and matched listing records; unrelated/unmatched orders are skipped. Multi-line orders require allocation/review instead of applying an entire order value to the first item. Existing actual fees are not replaced by a recalculated estimate during order refresh. Multi-quantity allocation is still a release blocker.

## APK/web packaging and deployment
Every branded Expo configuration prepares `.swish-build/<niche>/app` and points the existing expo-router plugin at that root. The generated home imports only its intended dedicated screen (or the configuration-driven overview). Other product entry/dedicated routes and master selector/admin routes are absent. Canonical app source remains untouched by build preparation. Runtime boundary also blocks cross-product routes, including a master user in a branded build.

Package names/display names/schemes are registry-driven. Icon and splash ASSETS still reuse existing artwork; per-product artwork remains a branding blocker. OTA runtime includes niche identity and isolation version to prevent serving the old full-app runtime to an isolated APK; install a new binary before relying on this OTA runtime.

Workflow procedure: install according to the actual committed lockfile; typecheck; run full existing Jest tests; prepare/verify route tree; validate Expo identity/root; prebuild; Gradle assembleRelease; verify ZIP integrity, binary manifest/classes.dex, apksigner signature, aapt package/display label/launcher; then upload APK/checksum. This procedure was written, NOT executed here. Generated fast APKs may use Expo's generated debug signing configuration; stable production signing/installed upgrade tests remain required. The persistent-keystore workflow retains its key configuration and no longer traces keystore bytes/password checks.

Run externally:
1. Review/export current database and preserve signing/encryption keys securely.
2. Apply tracked migrations in reviewed environments (live changes above are already applied here). Never roll back security by reopening credential or membership grants.
3. Deploy changed Edge Functions with their shared files and registry dependency; verify deployed contracts/logs. Deployment status cannot be certified from source edits alone.
4. Run `bash scripts/install-dependencies.sh`, `npx tsc --noEmit`, and `npx jest --config jest.config.ci.js --runInBand`.
5. Dispatch requested niche build workflow only when CI passes; inspect artifacts with `bash scripts/verify-apk.sh <apk> <niche>` and install on real devices.
6. Test login/restart/logout/account change, niche isolation, scans/uploads, category/specific reopen, token refresh, publish rejection/timeout/reconciliation, SKU-only revision, order/finance/message workflows using controlled test accounts.
7. Audit the separate website workspace using the same service contracts. No alternate database/client should be introduced.

## Automated tests status
Added tests exercise real production identity/lifecycle/classification helpers and execute route packaging in temporary fixture directories when run by Jest. `databaseBoundarySource.test.ts` checks tracked SQL contracts; these source assertions are not substitutes for role/integration tests. Additional current tests verify empty-filter service guards. **No Jest, lint, TypeScript, Gradle or native build was executed in this session.** The repository has many source-inspection tests asserting behavior not present in inspected source; these will fail and intentionally block artifact/OTA publication until actual defects/test expectations are reviewed. Package manifests/lockfiles/template internals were denied to the read tool, so dependency audit and exact SDK/tool compatibility remain unverified.

## Scope and limits
This session implemented the verified highest-priority security, identity, inventory, editor and packaging corrections. It did not finish every stage of the master directive. No dependency installation, compiler, test runner, artifact inspection, GitHub commit or separate website deployment is claimed. Review the rewritten inventory/editor modules on real devices and compare every existing workflow before release. Preserve the previous source version for UI regression review; do not restore insecure database grants as a rollback shortcut.

## Remaining release blockers — do not hide these
1. **Per-user paid niche access is not yet enforced across ALL APIs/RLS.** Observed tenants have professional/lifetime tiers and legacy active_specialists, no niche_entitlements or niche_id. Client-selected preferences cannot become trusted authorization. Need verified Stripe/account entitlement migration and a server-side entitlement check used by every item/listing/order/message/finance operation. No guessed mass entitlement changes were applied.
2. `swish-ebay-finances` recurring 400/499, fee-component aggregation, booking-entry sign conventions and notes preservation remain unresolved. Its source was inspected but not changed. Do not advertise the finance issue as fixed.
3. Message function may mark local replies successful after failed eBay send, and uses a field absent from supplied schema. Reconcile its schema/contract and truthful sent state before release.
4. Category aspect normalization must be verified against live eBay localizedAspectName schema; several existing paths read aspectName. Required clothing specifics, multi-valued aspects and allowed-value validation are not certified. Editor shows persisted specifics, but full category/publish integration must be tested.
5. Stock/item direct-detail services and several pages still use tenant-only rather than trusted niche authorization. Older updateItem callers without tenant ID remain supported under RLS; this is a documented compatibility path, not full niche enforcement.
6. Unknown publish claims require an operator-led marketplace reconciliation before clearing. Sync cannot automatically match an accepted listing lacking its saved external ID. Do not clear a claim simply because time elapsed.
7. Multi-line/multi-quantity orders, actual fee aggregation, sale/order atomicity and interrupted-import recovery remain incomplete. Review workflow for excluded ambiguous listings needs completion.
8. Complete review of remaining Edge Function contracts, privilege roles, quotas and external error redaction is outstanding. getUser presence alone does not establish authorization correctness. Strict metadata-bound Stripe customer lookup is still outstanding in legacy billing functions.
9. Genuine APK/device launches, native signing, product artwork, backend connectivity, separate website parity, CI account billing and deployment verification remain external checks. No production-ready badge is justified.

## Adding another niche
Add one canonical product entry in niche-modules.json with distinct package/scheme/routes and disjoint specialists; define capture/intelligence in the existing specialist configuration and presentation in NICHES; implement a dedicated experience only when it differs materially from shared capture/inventory. Add explicit entry route, billing entitlement metadata/server authorization and AI routing validation. Extend tests to prove specialist/alias/route/package isolation, then run actual build/device/backend integration checks. Never clone the AI/marketplace/auth/database engine.
