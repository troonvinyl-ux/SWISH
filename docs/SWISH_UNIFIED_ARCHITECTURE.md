# SWISH unified application — staged implementation and acceptance report

## Release decision
**IMPLEMENTED FOUNDATION / ACCEPTANCE INCOMPLETE. NOT A VERIFIED RELEASE.**
One shared Expo/React Native application now contains the SWISH shell and eleven canonical specialist modules. No Android APK, iOS IPA, hosted website release, production OTA, store submission or PR merge was produced by this session. No successful TypeScript/Jest/Gradle/Deno run is claimed: this editor exposes file/backend operations but no command executor.

## Stage 1: audit findings and conflicts
- Existing root: `app/index.tsx`, existing AlertProvider -> SafeAreaProvider -> AuthProvider -> AppProvider. No replacement authentication or backend was created.
- Registry: `niche-modules.json`; canonical eleven IDs and existing specialist aliases retained. Existing niche descriptors remain `niches/<canonical-id>/module.json`.
- Previous client owner authority came from email presentation checks. Existing local niche preferences/bookmarks could present products without paid membership.
- Existing inventory hooks already keyed snapshots by tenant/niche and used request generations. Existing items/listings/orders had tenant and paid-niche RLS; service-role Edge Functions needed session-level module checks as well.
- Existing Antiques More layout provided the material, spacing, touch targets and five-area navigation standard. It now supplies a shared More panel with niche-specific resources, not copied Antiques functionality.
- Existing source configured Android `com.swish.inventory` and `onspaceapp` scheme; those are preserved for the default unified build. No existing binary identity/fingerprint is inferred from source alone.
- Original `app.json` does not configure an iOS bundle identifier. It must be established from the original distribution records before iOS builds can pass identity verification.
- Existing separate APK and automatic multi-channel OTA paths conflicted with this directive. The primary build route is now `build-swish-unified.yml`; legacy suite/Android/signed-testing entry points delegate to it. Legacy niche build is opt-in migration-only, not a release path.
- Old per-niche browser matrix is replaced by one shared Expo browser export. A standalone React website workspace/deployment is outside this App workspace; no parallel web product or database was created.

## Stage 2: master shell and real membership routing
- `services/moduleAccessService.ts` loads existing subscription evidence scoped to the selected tenant and the database-owned platform role. No memberships are locally hardcoded or granted by bookmarks.
- `contexts/AppContext.tsx` resets tenant, access, acquisition/capture mode and module epoch on account change. Expired/revoked/unavailable membership checks fail closed and can be retried.
- One entitled niche is activated server-side and opens its normal five-area dashboard directly. Two or more entitlements lead to `/swish` with only permitted cards. The trusted owner always receives the registry's complete portfolio.
- `components/feature/SwishMasterHome.tsx` uses existing illustrated brand artwork, SWISH yellow, dark layered surfaces and the messaging YOUR NICHE. YOUR APP. / IDENTIFY · VALUE · FLIP · PROFIT.
- Legacy `/niche-select` now redirects to the membership-driven shell. Local tier-based settings switcher is retired. Ordinary subscribers do not render owner administration or verification tools.
- Module switching is asynchronous: the backend confirms the selected account/niche before a specialist screen is mounted. Failed authorization shows a retry path rather than loading another specialist.

## Stage 3: eleven module integrations
| Canonical ID | Shell adapter | Existing specialist entry |
|---|---|---|
| coins | /coins | /entry/coins |
| motocross | /mx | /entry/motocross |
| bicycles | /bikes | /entry/bicycles |
| clothing | /threads | /entry/clothing |
| trading_cards | /cards | /entry/cards |
| antiques | /antiques | /entry/antiques |
| fossils | /fossils | /entry/fossils |
| beauty | /beauty | /entry/beauty |
| tech | /tech | /entry/tech |
| surplus_flip | /surplus | /entry/surplus-flip |
| collectibles | /entry/collectibles | /entry/collectibles |

Shell adapter paths are now recorded in the canonical registry. No alternative niche identifiers or private databases were introduced. Existing dedicated Coins/MX/Bikes/Threads/Antiques/Surplus workspaces remain. Other modules retain the existing configuration-driven specialist overview, capture, inventory, valuation and listing workflows.
`ModuleHome` uses literal lazy imports and mounts only the active entitled module. Native binaries necessarily ship registered JavaScript code: this is runtime isolation, not a promise of remotely downloaded executable plugin bundles or complete code exclusion.

## Stage 4: security and state boundaries
### Applied backend changes
- Added protected `swish_platform_owners`: only a verified auth identity for the designated owner can be bound. Editable profile email and user metadata do not grant a role. Direct client INSERT/UPDATE authority is absent.
- Added `swish_is_platform_owner()` for the current JWT and service-only `swish_owner_for_user(uuid)`. UI consumes the backend role; administration endpoints independently check it.
- Added `swish_module_sessions`, keyed by the verified auth JWT session identifier, with tenant/niche context. Devices with separate auth sessions do not share the same active module. Browser tabs sharing one auth session share one scope and may require reselecting after another tab switches.
- `swish_open_module` checks actual tenant membership and underlying paid/owner entitlements before changing scope. Clients cannot directly edit session rows.
- `swish_can_access_niche` now requires both underlying rights and a matching active session scope. The former no-session bypass was closed. A raw JWT cannot omit module activation to retrieve unrestricted multi-niche inventory.
- Existing restrictive paid RLS continues to protect items, listings, valuations and orders. Added restrictive sale/feedback/message/return/case/finance reads and per-module settings policies.
- The established `collectibles` specialist now maps to its canonical niche; no historical items were reclassified.
- Server wrappers validate JWT, active session scope, requested tenant/niche/specialist and stored item/listing/order/message identities before expensive services or marketplace operations. Missing tenant on image preparation is derived from verified session state.
- Existing eBay encryption, token handling, authorization and listing identity checks remain. No seller consent, listing publication/ending or financial mutation was exercised.
- Imports use the selected canonical specialist, reject conflicting/ambiguous classifications, and no longer assign coin fields to clothing/card inventory. Import heuristics are review aids, not independent physical authentication; uncertain records require review.

### Important migration implications
Existing user records, inventory, grants and seller credentials are preserved. However, older clients that never activate a module now fail closed for inventory/module APIs. They require the approved unified native upgrade, or a reviewed migration-compatible scope initialization. This behavior is intentional security hardening, not a claim that old installed APKs have been updated.
The existing `niche_entitlement_known_product` CHECK still excludes Collectibles and the old cache function limits snapshots to ten. `20261105_collectibles_billing_cache_review.sql` contains the reviewed extension of the same cache; **it was NOT executed** because the editor SQL tool cannot replace the old constraint. Paid Collectibles membership remains blocked until that authorized migration is applied. Trusted owner/legacy tenant-tier rights do not depend on that Stripe cache.
Applied DDL is recorded as source migrations, but migration history must be reconciled before replaying definitions/policies already applied through this editor. Do not blindly replay old migrations or reset the database.

### Reset/caching model
Root module providers remount on user, tenant, niche and module epoch. Navigation, capture hooks, watched shelves and in-memory manifest sessions are discarded before a new workspace mounts. Persisted capture drafts remain user+tenant+niche keyed; they never become another module's draft. Existing inventory request-generation checks prevent prior-scope snapshots rendering.
Per-module currency, shipping defaults, categories, price thresholds and specialist automation preferences overlay the existing tenant business defaults in `swish_niche_settings`. Capital, business account identity and the encrypted marketplace connector remain deliberately shared infrastructure.

## Stage 5: owner administration
Master Admin is a route in the same app, not another application or paid module. `swish-unified-health` authorizes the backend owner and the requested tenant before returning only safe fields:
- canonical modules and tenant/niche-scoped counts;
- verified-JWT/account/database reachability results;
- stored eBay connection status (explicitly not a live eBay health test);
- current-session inventory read sample and its limitations;
- actual release-catalog metadata, when recorded;
- whitelisted function outcomes, durations, status/error codes without credential payloads.
No successful native build, entitlement fixture, marketplace transaction or isolation certification is manufactured when evidence is absent.

## Stage 6: browser parity
Android, iOS and Expo browser output use the same source shell, membership service, module registry, permissions, tenant context and backend. Illustrated cards adapt to phone/tablet/desktop using the existing safe Dimensions listener. The browser artifact workflow exports once, not eleven websites. Hosted deployment and complete device/browser parity are NOT TESTED. Native-only device cases and installed deep links still require platform acceptance.

## Stage 7: central version/update management
- Default unified native runtime uses Expo's `fingerprint` runtime policy and distinct `preview-unified` / `production-unified` channels.
- `AppUpdatePanel` reports installed version/channel/runtime/update ID, checks available compatible OTA, downloads fully, and restarts only when requested. Errors retain the current bundle; native guidance is displayed from service-managed verified release records.
- Android native updates use the system installer or approved store route. iOS uses existing TestFlight/App Store distribution, not direct IPA installation. Website releases use the hosted artifact and browser reload.
- Compatible module/shared-engine changes ship as one atomic Expo bundle. Independent native executable-plugin updates are not claimed. Shared-engine impact identifies every affected module; specific niche routes can be reported separately.
- Manual OTA publication requires an explicit successful unified native build baseline, both actual Android and iOS binary artifacts, matching source/channel/runtime metadata and independently recalculated checksums. Native/config/dependency/packaging changes block OTA and require new binaries. Expo runtime fingerprints provide the native compatibility boundary.
- Automatic and eleven-channel OTA publication are retired. Configure required reviewers on `swish-ota-approval` before any production use. No update workflow was dispatched in this session.
- Recovery: preserve embedded/last-known-good Expo bundles, retain anti-bricking measures, withdraw bad release metadata, and republish a reviewed last-known-good bundle only to a compatible runtime. No rollback was executed and arbitrary native downgrade is not promised.
- `swish_release_catalog` is empty unless verified artifact metadata is explicitly recorded by the trusted release process. File existence does not populate a green build status.

## Stage 8: artifacts and verification
Primary workflow: `.github/workflows/build-swish-unified.yml`.
- Validation: typecheck, lint, complete Jest suite, canonical module checks, generated-backend parity.
- Shared browser export: retained archive and SHA-256 plus pinned source SHA; not automatically deployed.
- Android: one original-package APK, existing persistent-keystore inputs only, apksigner certificate comparison, real badging/launcher checks, generated native runtime and artifact checksum.
- iOS: owner-approved existing bundle/team IDs, existing remote credentials only, no automatic credential reset, signed IPA download and codesign/bundle/team/checksum verification. No store/TestFlight submission.
- Legacy per-niche signing/configuration files are migration references, not the primary release route.

### Actual artifact register for this session
| Target | Build ID | Artifact | Signing evidence | SHA-256 |
|---|---|---|---|---|
| Unified Android | Not produced | None | Original certificate not obtained | None |
| Unified iOS | Not produced | None | Original bundle/team/provisioning unverified | None |
| Unified browser | Not exported in this editor | None | Not applicable | None |
| Production OTA | Not dispatched | None | Not applicable | None |

## Acceptance matrix — requested twenty tests
Full tests require actual authenticated accounts, deployed Edge revisions, command execution and device/browser fixtures. Source checks are never substituted for these journeys.
| # | Requested test | Result | Evidence / missing verification |
|---|---|---|---|
| 1 | Single-niche login directly opens its module | NOT TESTED | Membership routing and backend activation implemented; no real single-niche login performed |
| 2 | Two-niche account sees exactly two cards | NOT TESTED | Cards derive from verified tenant-scoped snapshot; no two-membership fixture used |
| 3 | Multi-niche switching works | NOT TESTED | Async server activation plus navigation reset implemented; no authenticated journey |
| 4 | Single-niche switching control hidden | NOT TESTED | Control derives from verified membership cardinality; no rendered device test |
| 5 | Subscriber cannot see admin/diagnostics | NOT TESTED | Route boundary and server-owned role checks implemented; no subscriber rejection probe |
| 6 | Designated owner receives all eleven | BLOCKED | Live SQL found one verified designated-owner binding; Edge/UI entitlement response not exercised |
| 7 | Owner sees all modules and administration | NOT TESTED | Registry-derived owner shell implemented; no owner login/device test |
| 8 | Owner privileges enforced server-side | BLOCKED | Live privilege checks deny client role grants/arbitrary owner lookup/scope edits; authenticated Edge allow/deny acceptance not exercised |
| 9 | Threads cannot retrieve coin inventory | NOT TESTED | Existing restrictive RLS now includes strict session scope; no approved cross-niche JWT fixture |
| 10 | Coins cannot retrieve clothing inventory | NOT TESTED | Same strict stored-resource/session boundary; no fixture exercised |
| 11 | All-niche account still sees isolated inventory | NOT TESTED | One scope per auth session; actual all-membership query/write probes outstanding |
| 12 | Switching clears stale state | NOT TESTED | Module epoch/provider remount and existing scope-generation hooks implemented; no race/device test |
| 13 | eBay listing scope retained | NOT TESTED | Stored-resource guards and scoped imports/sync implemented; no seller test run |
| 14 | Existing eBay OAuth/listing flows still work | NOT TESTED | Encryption/connector architecture preserved; existing credentials never used for a transaction in this task |
| 15 | Android/iOS routing parity | BLOCKED | Shared source implemented; no verified native artifacts |
| 16 | Website parity | BLOCKED | Shared Expo web export workflow implemented; hosted/browser acceptance absent |
| 17 | Antiques footer/layout consistently applied | NOT TESTED | Existing footer retained; shared More layout adapts resource links per module; visual/safe-area/device checks outstanding |
| 18 | Compatible OTA works without reinstall | BLOCKED | Central check/download/restart and runtime gates implemented; no approved native baseline/OTA published |
| 19 | Native changes require new binaries | NOT TESTED | Fingerprint configuration and baseline-diff guards authored; not executed |
| 20 | Existing accounts/inventory/signing retained | BLOCKED | No business data/signing material changed; original Android certificate and iOS identity still unavailable for compatibility verification |

### Backend checks actually executed
| Check | Result | Returned evidence |
|---|---|---|
| Verified designated-owner binding | PASS | `verified_designated_owner_bindings = 1` |
| Anonymous module activation denied | PASS | `anonymous_can_activate_module = false` |
| Client cannot insert owner role | PASS | `client_can_grant_owner = false` |
| Client cannot directly update module session | PASS | `client_can_edit_scope = false` |
| Client cannot query arbitrary user's owner status | PASS | `client_can_query_arbitrary_owner = false` |
| Additive owner/session/settings/release/market policies | PASS (DDL execution only) | SQL tools returned successful execution; this is not JWT isolation acceptance |
| Existing paid Collectibles cache constraint | BLOCKED | Live CHECK still enumerates the ten legacy niches |

## Outstanding blockers / owner access requirements
1. No shell/compiler/CI dispatch tool is exposed here. Run the unchanged full regression gate and new module tests through an authorized GitHub executor. Historical eleven-APK/source-text assertions must be reviewed against the new directive; do not suppress failures or invent passing evidence.
2. Obtain the ORIGINAL OnSpace Android signing identity securely. Required GitHub names: SWISH_RELEASE_KEYSTORE_BASE64, SWISH_KEYSTORE_STORE_PASSWORD, SWISH_KEYSTORE_KEY_PASSWORD, SWISH_KEYSTORE_KEY_ALIAS, SWISH_RELEASE_CERT_SHA256. They must match an original APK, not a newly generated key. No values belong in chat/source/artifacts. Signing custody/export must be confirmed by OnSpace at contact@onspace.ai.
3. Establish the actual original iOS bundle identifier, team and supported distribution credentials. Set approved identity checks as SWISH_APPROVED_IOS_BUNDLE_ID and SWISH_APPROVED_IOS_TEAM_ID only after verification; do not infer or change an identifier without owner approval. Existing remote credentials must be accessible through owner-authorized EXPO_TOKEN/EAS project access.
4. Confirm EXPO_PROJECT_ID and public client backend configuration in CI. No environment values were changed by this task.
5. Deploy/check all changed Edge Functions and their new shared assets against this source; deployment parity is not proven by successful file writes. No deployed revision or seller response is certified here.
6. Apply the reviewed eleven-niche extension of the EXISTING billing cache through authorized migrations. Reconcile migration history for already-applied editor DDL before replaying schema changes.
7. Preserve original APKs before building; one `com.swish.inventory` app cannot update installations of eleven distinct package IDs in place. Original package/bundle identities are unchanged; installed-binary compatibility remains an explicit release gate. Existing per-niche users may need a deliberate unified-app migration rather than a package rename.
8. Supply approved real single-/two-/all-niche and subscriber/owner sessions for acceptance, with consented seller fixtures. No fabricated membership or production inventory was introduced.
9. Strict scope activation intentionally blocks older clients that omit the module handshake. Keep distribution paused until the unified upgrade/migration has been accepted.
10. Shared seller funds/payout totals are owner-only because they cannot safely be represented as one niche's totals. Some existing secondary marketplace synchronization/attribution paths still require end-to-end review; source guards do not certify complete marketplace isolation.

No master register task was promoted to VERIFIED from code presence. The final delivery is a working staged source architecture with explicit acceptance/build blockers, not all requested verified deliverables.
