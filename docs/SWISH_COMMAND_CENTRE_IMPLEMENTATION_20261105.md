# SWISH unified command centre — factual implementation report

**Date:** 5 November 2026  
**Inspected GitHub main:** `a3b3c7e8fabfd2c37f1ac70f6ea743e06ceb52ed`  
**Release verdict:** **BLOCKED — not production-ready**  
**Scope:** Existing unified Expo app, existing auth/OnSpace Cloud, all 11 canonical niches. No separate APK or replacement system created.

## Implemented features

### Home and artwork
- All 11 supplied header photographs centrally mapped; remaining uploads: Surplus IMG_9732, Clothing IMG_9733, Fossils IMG_9734, Collectibles IMG_9735, Coins IMG_9736.
- Personal multi-niche command portfolio and owner platform command portfolio use the same measured reporting service, with different server-authorised scopes.
- Single-niche users open directly; initial multi-niche/owner login no longer restores an old niche ahead of the portfolio. Subsequent membership refresh preserves a still-authorised active module.
- Portfolio shows inventory, recorded listed asking value, recorded weekly/monthly sale proceeds, distinct weekly sold items, live eBay/drafts, actionable orders, review counts, dated recorded AI/eBay signals, owner profile/entitlement counts and current readiness.
- Asking prices and sale ledger revenue are explicitly different. Subscription revenue is unavailable, not estimated or fabricated. Active subscriber presentation is explicitly cached entitlement count, not verified Stripe billing status.
- Six quick actions bind the selected module through the existing confirmed `openModule` before navigating. Inspection does not change active module state.
- Dark translucent panels, SWISH yellow outlines, niche accents, 12:7 cached Expo Image headers, status dots, responsive columns, pressed feedback, loading indicators, unavailable states and labelled cached snapshots. No continual animation or new background portfolio polling.

### Master Admin
- Direct server owner RPC verification, denial state and retry. Removed the additional client-email gate from the shared More entry.
- Existing in-app Master Admin retained, with selectable operational sections, platform/niche portfolio and bounded real owner-only users, entitlements, inventory, audit, incident, sync and configuration inspections.
- Existing eBay admin, seller account, diagnostics, updates/build evidence and specialist tools retained. More now reuses the existing shared ModuleMore menu; owner eBay/diagnostics/readiness entries preserved.
- All 11 administrative niche cards open their own filtered inspection without changing the active user's niche. Explicit Open niche remains separate.
- Existing owner health replaces 22 per-niche queries with one aggregate; expensive legacy diagnostics only load when their section is selected.
- **Limitation:** New user/membership/configuration inspectors are read-only. Mutating account/subscription administration, automated Git repair/PR creation and global seller credential operations have not been added. This is not a claim that every requested administrative mutation is complete.

### S1–S7 readiness
- Retained all seven original names/scopes, 34 original task IDs, dated evidence and existing niche certification matrix.
- Added explicit unified-release supersession for historical separate-APK/admin artifacts without removing their history.
- Current readiness requires a source-bound acceptance record with PASS, complete criteria, method, resolved evidence and valid date. Historical VERIFIED labels no longer contribute to current readiness.
- READY / READY WITH NON-CRITICAL WARNINGS / NOT READY / BLOCKED decisions include exact unresolved reasons and all 11 niche gates.
- Per-task priority/workstream/dependencies/implementation notes/method/result/reference/date/review target and smallest-safe-repair guidance; unconfirmed root causes are described as unconfirmed.
- Existing verification Edge Function gains full-programme or individual-workstream **safe** audits: confirm current GitHub source, fetch original canonical requirements, execute actual caller tenant read and owner aggregate/registry comparison, and store genuine limited results plus explicit blockers for complete tasks in the existing verification table.
- Safe programme probes deliberately do not certify full task acceptance. Compiler/device/sandbox/provider actions remain blocked until their actual runners execute. No paid AI or seller publication is triggered.
- Current-source CI workflow authored for TypeScript, lint, all Jest regressions, registry/register/dependency checks and existing server authorization tests; evidence artifact retains the tested SHA. No APK build or deployment is triggered by this new workflow.

## Backend and security changes

One necessary additive function, `public.swish_command_snapshot(uuid,boolean,text,text)`, was created and executed on the existing database. No tables, counters, auth providers, RLS policies, user data or credentials changed. Default PUBLIC/anon EXECUTE was revoked on this new function only; authenticated EXECUTE enabled.

- Every request requires auth.uid(). Platform scope and administrative inspectors require the existing trusted `swish_is_platform_owner()`.
- Subscriber reports require membership in the specified tenant, existing entitlement helper and unexpired server-cached individual niche entitlement. No paid tier inferred from client state.
- Explicit definer-authorised reporting is independent of current module session so a multi-niche portfolio does not need to switch niches just to obtain totals. This bypass is narrowly restricted by the function's owner/tenant/entitlement checks; existing operational RLS is unchanged.
- Only aggregate data or explicit safe inspector columns returned; no access/refresh tokens, credential refs, buyer addresses, settings payloads or secrets.
- Read requests are scoped/deduplicated by session/user/tenant/mode. Unknown authorization failures clear reports. Only recognised transient infrastructure failures may retain a same-scope snapshot, explicitly labelled cached.
- Weekly boundaries are Monday 00:00 Europe/London; monthly boundaries use the same timezone.
- Recorded sales exclude known cancelled/refunded/return-affected records, deduplicate external sale identities and expose duplicate counts. Partial refunds are conservatively excluded until reconciled. Mixed/unknown currencies are never summed into a GBP-labelled figure. Unknown legacy/unlinked records stay outside niche aggregates and are not reassigned.
- These choices are reporting semantics, **not certification of the underlying financial ledger**. Multi-line quantity, partial refund, historical attribution and account/provider reconciliation still need acceptance.

## Actual executed verification

| Check | Actual result | Scope/limit |
|---|---|---|
| GitHub main lookup | Observed SHA above | Public read only; no branch write/diff executor |
| Six relevant canonical tables' RLS flags | Enabled | Catalog, not all effective policy tests |
| New reporting migration | Executed successfully | DDL only; no records modified |
| No-JWT platform reporting | Denied as expected | Identity-free database invocation |
| anon EXECUTE / authenticated EXECUTE | false / true | Actual function privilege inspection |
| Trusted-owner SQL role simulation | Passed | Report ran, trusted role true, all 11 modules present |
| Canonical inventory sum | Reconciled | Owner simulation result equals direct canonical-item count |
| Separate existing non-owner SQL role simulation | Passed | Platform/users/foreign tenant denied; returned modules match unexpired own entitlements |
| Seven owner inspector sections | Passed | Actual execution, max 50 returned rows, credential-field keys absent |
| Collectibles / legacy coins / catch-all mapping | collectibles / coins / NULL | Actual existing server attribution helper |
| Existing owner health error logs | No recent records returned | **Not** proof of healthy runtime |
| Current-source TypeScript/Jest/lint | NOT EXECUTED | No terminal or CI dispatch tool |
| New programme Edge audit with actual owner JWT | NOT EXECUTED | No approved HTTP owner session in this editor |
| Native camera/startup/navigation/cropping | NOT EXECUTED | No installed-device runner |
| APK/AAB/IPA/signing acceptance | NOT EXECUTED | Build explicitly not requested |

Role simulations use transaction-local JWT subject settings in privileged SQL. They prove database predicates/query execution for selected existing fixtures; they do **not** prove token verification, HTTP gateway authorization, UI behaviour, concurrent sessions or penetration resistance.

### Observed existing main-branch CI failure
Public Actions run [42065996505](https://github.com/troonvinyl-ux/SWISH/actions/runs/42065996505) for the inspected baseline **failed** its TypeScript step. Lint, full regressions, Deno and mobile export were **skipped**, not passed. Read job/check annotations [127380101700](https://github.com/troonvinyl-ux/SWISH/actions/runs/42065996505/job/127380101700): missing InventoryAccountScope/ListingPhotoPicker modules, initiallyExpanded component contract, and implicit callback parameter errors.

Local referenced components already exist and support those contracts; their exported interfaces and consumer callback types were made explicit so the new change set includes these previously missing dependency files. This is a source repair/retention action, **not a successful compiler retest**. Git source inclusion and a fresh full check remain mandatory. Deprecated action-runtime warning and missing regression artifact warning were also observed; no skipped suite is inferred to have run.

## Home/admin verification status
- **Master Admin:** fresh server-gate code and SQL inspector/boundary simulations passed at their limited scope; actual owner JWT screen entry and ordinary subscriber route manipulation remain NOT VERIFIED.
- **Single-niche home:** routing branch repaired and regression authored; actual login/device result NOT VERIFIED.
- **Multi-niche home:** tenant-entitlement SQL simulation passed; actual rendered portfolio/login/quick actions NOT VERIFIED.
- **Owner home:** owner aggregate simulation passed across 11 identities and inventory sums; actual full rendered home not device-tested.

## All 11 niches

| Canonical ID | Correct supplied header | Canonical aggregate identity | Full scan/listing/device acceptance |
|---|---|---|---|
| coins | coins.jpeg | Returned in executed owner simulation | NOT VERIFIED |
| motocross | motocross.jpeg | Returned | NOT VERIFIED |
| bicycles | bicycles.jpeg | Returned | NOT VERIFIED |
| clothing | clothing.jpeg | Returned | NOT VERIFIED |
| trading_cards | trading-cards.jpeg | Returned | NOT VERIFIED |
| antiques | antiques.jpeg | Returned | NOT VERIFIED |
| fossils | fossils.jpeg | Returned | NOT VERIFIED |
| beauty | beauty.jpeg | Returned | NOT VERIFIED |
| tech | tech.jpeg | Returned | NOT VERIFIED |
| surplus_flip | surplus.jpeg | Returned | NOT VERIFIED |
| collectibles | collectibles.jpeg | Returned; server specialist mapping confirmed | NOT VERIFIED |

No niche is marked production-certified by artwork/configuration or an aggregate query.

## S1–S7 current acceptance breakdown

| Workstream (original scope) | Original tasks | New full current-source VERIFIED |
|---|---:|---:|
| S1 Full architectural audit | 5 | 0 |
| S2 Implement foundation architecture and registry | 4 | 0 |
| S3 Foundation 1 — SWISH Core | 5 | 0 |
| S4 Foundation 2 — Standard resale workflow | 5 | 0 |
| S5 Foundation 3 — Niche specialisation | 4 | 0 |
| S6 Foundations 4–6 — Optional specialist capabilities | 4 | 0 |
| S7 Full production verification | 7 | 0 |
| **Total** | **34** | **0** |

0% is **current full acceptance evidence**, not an estimate that no functionality exists. Dated implementation/verification history is retained. All 165 original 11-niche certification gates require current-source evidence; no task was promoted by this session.

## Files changed/created

### Assets/config
- assets/images/headers/{surplus,clothing,fossils,collectibles,coins}.jpeg
- constants/nicheHeaderArtwork.ts

### Data and logic
- services/commandCentreService.ts
- services/readinessAssessmentService.ts
- services/moduleAccessService.ts
- services/verificationCentreService.ts
- contexts/AppContext.tsx
- hooks/useOwnerAuthorization.ts
- hooks/useCommandCentre.ts
- hooks/useAdminInspection.ts
- hooks/useProductionControl.ts
- hooks/useVerificationCentre.ts
- hooks/useUnifiedHealth.ts
- hooks/useUnifiedShell.ts

### UI/shared dependencies
- components/feature/CommandPortfolio.tsx
- components/feature/AdminInspectionPanel.tsx
- components/feature/ReadinessAuditPanel.tsx
- components/feature/SwishMasterHome.tsx
- components/feature/ModuleMore.tsx
- components/feature/InventoryAccountScope.tsx
- components/feature/ListingPhotoPicker.tsx
- components/feature/SpecialistItemFields.tsx
- app/master-admin.tsx
- app/production-control.tsx
- app/(tabs)/account.tsx
- app/(tabs)/inventory.tsx
- app/ebay-listing-editor.tsx

### Backend/tests/workflow/docs
- supabase/migrations/20261105_command_snapshot.sql
- supabase/functions/swish-unified-health/index.ts
- supabase/functions/swish-verification/index.ts
- supabase/tests/command_centre_readonly.sql
- services/__tests__/commandCentre.test.ts
- services/__tests__/sharedNicheHomeHeaders.test.ts
- services/__tests__/productionControlService.test.ts
- services/__tests__/sharedNavigationContract.test.ts
- services/__tests__/unifiedNavigationRepair.test.ts
- services/__tests__/accountLogout.test.ts
- .github/workflows/command-centre-verification.yml
- docs/SWISH_FOUNDATION_MASTER_REGISTER.json
- docs/NICHE_HOME_HEADER_ASSETS.md
- docs/SWISH_COMMAND_CENTRE_AUDIT_20261105.md
- docs/SWISH_COMMAND_CENTRE_IMPLEMENTATION_20261105.md
- docs/SWISH_COMMAND_CENTRE_EVIDENCE_20261105.json

## Outstanding blockers and incomplete requested capabilities
1. Fresh current-source compiler/regression/lint/server-graph execution. Existing baseline CI is red; this editor cannot dispatch/retest.
2. Actual owner/subscriber JWT HTTP/UI authorization, two-account isolation and expired/revoked-session tests.
3. Updated existing verification/health Edge Functions must finish platform deployment and be exercised with an owner session. Source editing alone does not verify deployed boot/parity.
4. All 11 controlled scan-to-save/reopen, specifics/category, valuation evidence, eBay draft/revise/readback, orders/messages and fee reconciliation workflows.
5. Exact payment revenue and paid subscriber billing counts are not integrated into reporting. Cached entitlements are labelled honestly.
6. Administrative mutation workflows and authorised focused Git repair/PR dispatch are not implemented. Existing operational tools remain; new inspectors are read-only.
7. Current activity stream uses recorded Edge outcomes; full inventory/listing/sale/audit event unification remains an enhancement requirement, not represented as complete.
8. Native/web/desktop rendering, narrow-screen/landscape cropping, offline performance, skeleton refinement, crash/startup and signing/artifact acceptance remain untested.
9. Release gate has no current full task/niche acceptance evidence. Safe probes cannot replace sandbox/device/compiler criteria.
10. Git write/PR/merge access is unavailable. No PR created, no merge performed, no post-change main SHA or OnSpace-to-main synchronization confirmed. OnSpace's automatic change publication is not treated as verified Git evidence.

**No APK build requested. No production-ready claim.** Continue with current-source CI and approved authenticated test fixtures, then controlled workflow/device acceptance; only then consider the single unified release artifact.
