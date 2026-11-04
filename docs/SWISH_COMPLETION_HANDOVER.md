# SWISH completion execution handover — 4 November 2026

## Release decision
**NOT PRODUCTION READY. All eleven products remain BLOCKED for release.**
This is an implementation handover, not a certification. Safe source changes and additive database work were performed. No new native build, installed-device journey, seller publication or full test execution is claimed.
The authoritative task register remains `docs/SWISH_FOUNDATION_MASTER_REGISTER.json`, including its current `completionProgramme` section. Historical evidence refers to historical commits only.

## Source baseline and integration
- Latest observed default-branch reference: `a8eee534b716a7be172992c3100943b1b6314562` (parent `1d7b77599e58c44f03c625a10e87701851ab4077`).
- PR #167 remains OPEN at `467ad03a6cb3912f8ba6a00c8f212ee987917bc7`; no PR was merged by this session.
- Targeted reconciliation restored strict physical route generation, package/scheme niche locking, missing Antique resources and the missing listing telemetry dependency. Newer unrelated GitHub work was not overwritten.
- A full Git checkout/diff/commit/merge/dispatch tool is not exposed in this session. Full workspace synchronization and the final implementation commit are therefore unverified.
- `node scripts/check-source-baseline.mjs` now produces a read-only source-difference manifest. It performs no reset, pull, merge or source overwrite.

## Implemented changes
### Shared infrastructure retained
The existing backend, database, authentication, tenants, canonical items, image bucket, AI orchestration, eBay connector and encryption architecture are retained. No replacement account/inventory/marketplace system was created.

### OAuth and marketplace security
- Consent-start credentials are encrypted and staged on the existing `oauth_sessions` row, not written over active connector credentials.
- Cancelled/expired/failed new consent does not replace the active connector. Legacy in-flight sessions retain compatibility.
- Callback claiming is atomic and single-use. Token exchange is bounded by a timeout and checks upstream HTTP success.
- Active connector replacement happens only after successful consent/token exchange. No seller consent or credential replacement was exercised here.
- Publication, revision, SKU revision and ending now authorize the stored listing's canonical niche before marketplace writes. Beauty/technology safety restrictions are enforced on publish/revise at the server boundary.
- Market-value requests validate resource/niche agreement before credential refresh. Market refresh uses compare-and-swap persistence.
- Cached category aspects recognize `localizedAspectName`, preserving required eBay field names. Retail-new condition is no longer inferred merely from a Mint grade or an untested device.
- The missing `_shared/edgeFunctionLogging.ts` import dependency is restored. This resolves a confirmed source packaging defect, **not proof of deployed BootFailure recovery**.

### Eleven-product configuration and navigation
- Collectibles uses the PR's canonical `collectibles` specialist, `com.swish.collectiblesflipper` package and `collectiblesflipper` scheme; it never owns Coins or the old catch-all.
- Collectibles is registered in client/server configuration, capture evidence, specialist prompt/output fields, home guidance, import classification, checkout callbacks and native build selectors.
- All five footer destinations are required by route generation. Collectibles retains Listings without bundling the wider eBay hub.
- Rendered Scan/Listings links are filtered against the product's route subset. Other long Settings/detail paths still need a complete rendered-link acceptance pass.
- Missing Antique More, guides, conservation and condition routes are restored using shared logout/canonical editor behavior. The existing footer layout is preserved, with larger touch regions and an accessible Scan label.
- Native icon/adaptive-icon/splash configuration now uses each product's existing branding image; new dedicated Collectibles and Surplus assets were created and referenced. Native visual acceptance is outstanding.
- Identification rejects a returned different-niche specialist; required capture views and specialist ownership are checked before save. Original-photo/retry and canonical-ID behavior are retained.

### Build and verification infrastructure
- Generated route trees fail closed for unclassified routes, missing files and foreign ownership. JSX navigator pruning now uses the TypeScript AST.
- Import-closure inspection covers imports, re-exports, dynamic imports and require statements; unresolved/computed local dependencies require review. A retained closure manifest is produced.
- **This is not complete asset/prompt/native dependency exclusion. Shared configuration and artwork references can still bundle other niche metadata/assets. No binary exclusion certification is claimed.**
- Existing APK workflows expose all eleven niche choices; the full suite passes inherited signing secrets into each reusable build.
- Builds reuse the existing persistent-keystore secret arrangement and fail closed without the approved certificate SHA-256. No new signing key is generated.
- Compiler output is retained on failure, and APK checksums/runtime config/import manifests accompany successful artifacts.
- New regression tests cover all eleven identities, five footer destinations, ownership disjointness, OAuth staging and release signing gates.
- `node scripts/run-completion-checks.mjs` executes independent source gates and all eleven route/closure checks, retaining command exits and redacted logs. It continues independent checks after failures and never marks E2E production acceptance complete.

## Database execution and safeguards
Executed without invoking business commands or changing historical records:
1. Added `oauth_sessions.pending_credential_ref`; denied direct client table access and retained service-role access.
2. Created metadata-only `edge_function_logs` with RLS, owner SELECT and server INSERT. Realtime publication modification was removed from source because OnSpace requires polling.
3. Added nullable sale-time `niche_id`, `specialist_id`, `category_id` columns and an index; no historical backfill was performed.
4. Added a security-invoker order-resource helper and three restrictive authenticated policies for SELECT/INSERT/UPDATE. Existing tenant policies remain in force. Unlinked/unclassified orders are preserved for owner reconciliation rather than guessed niche assignment.
5. Restored the repository's server-only atomic single-unit sold-order command, without invoking it. Multi-unit items remain a separate reconciliation case.

Catalog postconditions actually returned: OAuth staging exists; authenticated OAuth table reads denied; order helper defined; three restrictive order policies present; telemetry RLS enabled; sale metadata present. A null-identity role-switch probe returned a backend error, so it is **not** an isolation-test pass. The post-create sold-order catalog check returned: RPC exists; authenticated/anonymous EXECUTE denied; service-role EXECUTE allowed. This verifies deployment presence and privileges only; authenticated operational acceptance remains outstanding.
Recovery: these changes are additive. Retain columns/records and preserve active connector data; review any policy reversal as a security change. No database reset, destructive cleanup or automatic rollback was performed. Export live data from Cloud → Data before owner-controlled historical backfills.

### Collectibles backend blocker
The live known-product CHECK constraint still permits ten niches, and `swish_specialist_niche('collectibles')` returned NULL. Full paid Collectibles registration is not deployed. The direct SQL tool prohibits dropping/replacing the existing constraint, so the owner must apply the reviewed PR #167 migration through the authorized deployment process, retaining the same table and grants and increasing the existing server snapshot limit to eleven. `20261104_collectibles_registration_review.sql` records the mapping extension but must not be treated as the complete migration or applied alone. No old collectible inventory was moved.

## Actual test and deployment evidence
- Code changes: performed in OnSpace.
- Database catalog/privilege postconditions: executed as noted above.
- TypeScript/lint/Jest/Deno/Gradle: **not executed in this editor; no terminal is exposed**.
- New tests and evidence runners: authored, not passing evidence yet.
- Edge dependency correction: implemented; deployed revision and GET/runtime acceptance unverified. GET fetch returned no inspectable response.
- eBay refresh/list/draft/publish/revise/end/orders: no seller session used and no real marketplace action performed.
- Finance failure evidence: prior upstream Seller funds HTTP 403; missing grant, app permission and seller eligibility remain alternative causes, not a confirmed single cause.
- Sold data: official Analytics API documents customer-service/traffic/seller-standard reports, not public Seller Hub Product Research. Its legacy adapter remains unavailable, not advertised as unlocked by reconnection. Marketplace Insights requires application approval. No sold prices were fabricated.
- New PostgreSQL logs also record inventory projection HEAD 504 and a tenant-name PATCH 403 in the active environment; root causes remain unverified and release-blocking.

## Individual application release statuses
Every row is **BLOCKED**, not independently accepted. Build number and final APK checksum for this execution are unavailable because no new builds ran.

| Product | Canonical package | Current execution artifact | Outstanding release gates |
|---|---|---|---|
| Coin Flipper | com.swish.coinflipper | None | Runtime, eBay, binary isolation, signing, device acceptance |
| MX Flipper (registry: Flipper MX) | com.swish.flippermx | None | Runtime, fitment, eBay, binary isolation, signing, device acceptance |
| Bike Flipper | com.swish.bikeflipper | None | Runtime, mechanical evidence, eBay, binary isolation, signing, device acceptance |
| Threads Flip | com.swish.threadsflip | None | Required-specific round trip, eBay, binary isolation, signing, device acceptance |
| SurplusFlip (registry: Surplus Flip) | com.swish.surplusflip | None | Manifest/quantity acceptance, eBay, binary isolation, signing, device acceptance |
| Card Flipper | com.swish.cardflipper | None | Variant/condition acceptance, eBay, binary isolation, signing, device acceptance |
| Antique Flipper | com.swish.antiqueflipper | None | Restored navigation/device acceptance, eBay, binary isolation, signing |
| Fossil Flipper | com.swish.fossilflipper | None | Provenance acceptance, eBay, binary isolation, signing, device acceptance |
| Beauty Flipper | com.swish.beautyflipper | None | Eligibility gates, eBay, binary isolation, signing, device acceptance |
| Tech Flipper | com.swish.techflipper | None | Actual compiler failure diagnosis/rebuild plus runtime and device gates |
| Collectibles Flipper | com.swish.collectiblesflipper | None | Reviewed backend/PR integration, projection timeouts, eBay and device gates |

### Historical artifacts, not this release
- https://github.com/troonvinyl-ux/SWISH/actions/runs/41740928060 — nine niche APK artifacts plus Master Admin at `523b255...`; Tech compile failed.
- https://github.com/troonvinyl-ux/SWISH/actions/runs/41871997988 — dedicated Collectibles artifact at PR head `467ad03...`.
These references are not proof of current source builds, approved certificates, installation or current acceptance. Artifact archive digests are not substituted for final APK checksums.

## External access / owner actions
1. Provide an authorized Git-capable checkout/CI executor to reconcile the complete working tree, review PR #167, commit and run the existing checks/build workflows. None is exposed to this chat toolset.
2. Supply the approved existing signing certificate fingerprint as `SWISH_RELEASE_CERT_SHA256` in GitHub variables/secrets, using the persistent keystore already configured. Do not rotate the key.
3. Apply the reviewed Collectibles known-product/snapshot migration through owner-controlled deployment; do not move historical records.
4. Establish deployed Edge revision parity and confirm listing boot recovery with safe unauthenticated/read-only probes before seller testing.
5. Provide approved two-account/tenant/niche fixtures and an approved seller-test listing. Publication, ending, consent replacement and financial changes require specific owner authority; no such action is assumed from general completion permission.
6. Verify eBay finance grants/app-key permissions and EU/UK signature requirements; request Marketplace Insights access if eligible. A 403 alone does not prove reconnecting will fix it.
7. Execute Android installation/restart/back/camera/OTA acceptance and hosted web parity against the same canonical records.

Completion remains open. The changes above are measurable implementation work, not a claim that the entire ten-phase directive has been finished.
