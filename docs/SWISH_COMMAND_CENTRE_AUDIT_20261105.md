# SWISH command-centre enhancement audit — 5 November 2026

## Source baseline
GitHub `main` was read through its public commits API: `a3b3c7e8fabfd2c37f1ac70f6ea743e06ceb52ed`, latest commit “Apply six niche headers and shared Collectibles home template”. Local shared home, specialist workspace and registry correspond to that update. A complete authenticated checkout/diff, branch write, PR creation and merge cannot be performed with this editor's tools. No claim of Git synchronization after this session is made.

## Existing architecture retained
Expo Router routes → feature components → hooks → services → existing OnSpace Cloud. Root Alert/Auth/App providers retained. Canonical `niche-modules.json` contains 11 products; shared `_shared/niche-modules.json` drives server integrations. Existing items/listings/sales/orders, encrypted eBay connector, subscription function, AI identification/valuation, owner RPCs and verification-results table are reused. No alternate auth, database, inventory or niche APK is introduced.

## Confirmed source findings
- `membershipDestination` prioritizes restored active niche before owner/multi-niche home; login can bypass the requested portfolio.
- `AppContext` restores an old niche on initial multi-membership load; refreshing memberships must not change an already open module.
- `SwishMasterHome` is an artwork chooser, not a measured portfolio.
- Owner health launches 22+ per-niche count requests plus multiple diagnostics reads; it mixes global user counts with tenant-only stock. Its listing-state sample is capped at 1,000 and cannot support platform totals.
- Master Admin waits on accessReady before displaying denial/retry: verification failure can leave an indefinite spinner.
- S1–S7 original definitions are present in `SWISH_FOUNDATION_MASTER_REGISTER.json` (34 original tasks). Dated historical evidence exists but no task contains a current-commit acceptance record. `useProductionControl` counts historical VERIFIED labels toward readiness without commit binding.
- Original register still describes eleven separate APKs and separate admin distribution. Preserve that historical record, explicitly supersede the release model with one unified artifact.
- Existing verification runner performs genuine JWT/RLS reads and stores results. These limited observations must not promote full workflow acceptance, especially owner reads versus separate subscriber denial tests.
- Existing CI supports full Jest, TypeScript, lint, Deno authorization/dependency checks and unified build inspections. No terminal/CI-dispatch/device executor is exposed in this session.

## Executed backend inspection
Read-only PostgreSQL catalog query confirmed RLS enabled on items, listings, sales, orders, niche_entitlements and swish_verification_results. Existing `swish_is_platform_owner()` delegates to `swish_owner_for_user(auth.uid())`. Existing `swish_has_niche_entitlement(tenant,niche)` requires membership and trusted owner/paid-tier/current entitlement. No business records, credentials or policies changed by these checks. Empty recent health error logs are not a passing runtime test.

## Focused implementation plan
1. Central mapping for remaining five uploaded headers; preserve 12:7 artwork.
2. Add one necessary read-only aggregate RPC over canonical records, explicit owner/user entitlement checks independent of current module; no maintained counters or new tables. Platform scope only after trusted owner verification; subscriber scope limited to own tenant and entitlements.
3. Shared portfolio hook/UI for owner and multi-niche subscriber; single-niche direct entry, quick actions only after confirmed module activation.
4. Repair owner denial/retry; extend existing Master Admin with real bounded read-only administrative inspections without switching active niche.
5. Current-commit S1–S7 acceptance rollups, explicit blocked automated write/device/compiler checks, safe read verification and canonical evidence links. Original IDs/evidence retained; no automatic release or data repair.
6. Author regression/CI checks and factual report. Tests not executable here remain NOT VERIFIED; no APK build requested.

## Data policy
Listed asking value is active/live price multiplied by remaining recorded item quantity, not realised revenue. Realised values are canonical sale ledger amounts after excluding known cancelled/refunded/return-affected records and deterministically deduplicating external sale identities; ledger limitations stay visible. Reporting uses Monday 00:00 Europe/London and calendar month in that zone. Mixed/unknown currencies must never be combined into a labelled GBP figure. AI and eBay signals are recorded outcomes/metadata, not synthetic live health. Unclassified records remain unclassified and are not reassigned.
