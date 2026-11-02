# SWISH Stage S1 — Full Architectural Audit

**Audit date:** 2026-11-02 (refreshed against main after PR #125)  
**Audited ref:** `main`  
**Audited commit:** `f95affc8d1295d70adc1e4cf7b00a2d7db76864c`  
**Scope:** S1-01 through S1-05 in `docs/SWISH_FOUNDATION_MASTER_REGISTER.json`.

## Executive result

Stage S1 is **partially complete**. The canonical route/build map and PR reconciliation have current, reproducible evidence. The shared architecture and blocker maps are documented. The ten-niche source audit is complete at a static/configuration level, but functional, data-isolation, deployed-backend, web-parity and device acceptance are not complete. No task is promoted to VERIFIED on the strength of source inspection alone.

## S1-01 — App entry points, routes and build identities

**Result: VERIFIED for the registered source route/build-identity contract; runtime/device acceptance remains outside this task's verified scope.**

- `niche-modules.json` is the canonical registry consumed by `app.config.js`, `scripts/prepare-niche-routes.js`, and TypeScript niche routing/configuration.
- Ten registered products each have a concrete `app/entry/*.tsx` entry route:
  coins, motocross, bicycles, clothing, trading_cards, antiques, fossils, beauty, tech and surplus_flip.
- The registry defines a unique Android package, iOS bundle identifier, app scheme, entry route, specialist mapping and optional home/dedicated routes per product.
- `app.config.js` selects a product using `SWISH_NICHE`, applies the registry's package/scheme/name, and points Expo Router at the generated `.swish-build/<niche>/app` route root. Master Admin uses its separate `master-admin-app` route root.
- `services/nicheRouting.ts` resolves exact registered aliases, maps entry/scanner routes and rejects cross-product dedicated routes for fixed-niche builds.
- `scripts/prepare-niche-routes.js` excludes other products' registered entry/dedicated routes and writes only generated output; it does not mutate canonical `app/`.
- Evidence: PR #85 merged (`00aa203`), with 25/25 route-registry integrity checks; PR #90's niche-routing workflow run 810 completed successfully on its tested head before merge. PR #90 merged as `8d84f319`.
- Limitation: this verifies registry/route source contracts and CI checks, not launch/navigation on installed devices or the Play Store package.

## S1-02 — Shared services, hooks, backend functions and database dependencies

**Result: IMPLEMENTED as an architecture map; runtime dependency and complete call-graph verification remain open.**

### Runtime layers

| Layer | Canonical location | Responsibility / dependency |
|---|---|---|
| App routes and screens | `app/` | Expo Router screens, tabs, entry points, niche-specific experiences and Master Admin |
| Reusable presentation | `components/` | Shared UI and feature components |
| Session/application state | `contexts/` | Auth/session and app-level niche/tenant state |
| Business hooks | `hooks/` | Inventory, capture, route, listing and account workflows |
| Shared business services | `services/` | Item/listing lifecycle, inventory views, AI identification, category, marketplace and production-control operations |
| Niche presentation/capture | `constants/niches.ts` | Terms, visual identity, capture guidance, attributes and quick actions |
| Specialist intelligence | `constants/specialists.ts` | Specialist IDs, capture requirements, capabilities, valuation inputs and risk factors |
| Canonical product identity | `niche-modules.json` | Product IDs, package/scheme identity, routes, aliases and specialist ownership |
| Native/web configuration | `app.config.js`, `scripts/prepare-niche-routes.js` | Expo configuration and isolated route-root preparation |
| Backend functions | `supabase/functions/` | Existing server-side auth/entitlement, AI, eBay OAuth/listing/orders/messages/finance/sync, billing and privacy operations |
| Database and object storage | OnSpace Cloud (canonical SWISH backend; Supabase-compatible APIs), `supabase/migrations/` | Existing tenant, membership, item, listing, connector, order, finance and storage records/policies |
| CI/release | `.github/workflows/` | Niche routing, web export, Android packaging, OTA, Master Admin and readiness validation |

### Repository inventory at audited commit

- 102 TypeScript service files under `services/` (repository baseline inventory; exact count depends on tracked generated/test helpers).
- 27 hook files under `hooks/`.
- 25 deployable Edge Function directories plus the `_shared` function support directory.
- 12 tracked SQL migration files.
- 40 files matching the repository's test-file naming patterns.
- 13 GitHub Actions workflow files.

### Shared service/data-flow observations

- Native and Expo web source consume the same service modules and the canonical OnSpace Cloud backend through its Supabase-compatible client/API; no separate website source workspace was identified in this repository.
- The service layer is not yet the exclusive data-access boundary: GitHub source search on this baseline returns at least 43 files containing direct `supabase.from(...)` access and another five `getSupabaseClient().from(...)` call sites (some overlap). Direct-query call sites are present in screens and services, so UI/service ownership alone cannot be used as proof of authorization. The indexed search is an inventory aid, not a guarantee that every dynamic query was discovered.
- Existing canonical item UUIDs, tenant membership/RLS, storage, connector records and eBay architecture are retained. No second database or auth system is proposed.
- The handover documents the existing Edge Function families and applied security hardening. A full function-by-function authorization, schema, input-validation, idempotency and redaction review is still required before S3/S7 acceptance.
- A source inventory is not a live dependency graph: deployed OnSpace Cloud Edge Function revisions, effective database grants/RLS policies, secret configuration and the separate website deployment must be checked in their respective environments.

## S1-03 — Ten-niche functionality and isolation audit

**Result: IN PROGRESS.** All ten registered identities and entry routes exist, and source-level configuration has been inspected. The table records configuration evidence and explicit gaps; it is not a claim that all ten products are functionally complete.

| Niche | Entry route | Configured home | Dedicated routes | Static audit finding |
|---|---|---|---:|---|
| Coins | `/entry/coins` | `coin-flipper.tsx` | 5 | Specialist/capture configuration exists; route-registry test includes the corrected exact `.tsx` path |
| Motocross | `/entry/motocross` | `flipper-mx.tsx` | 2 | Specialist/capture configuration exists |
| Bicycles | `/entry/bicycles` | `bike-flipper.tsx` | 1 | Specialist/capture configuration exists |
| Clothing / Threads | `/entry/clothing` | `threads-flip.tsx` | 1 | Specialist/capture configuration exists; legacy specialist aliases remain explicitly read-only |
| Trading Cards | `/entry/cards` | Generic overview | 1 | Card-grading route and specialist/capture config exist; no dedicated home declared |
| Antiques | `/entry/antiques` | `antique-flipper.tsx` | 7 | Specialist/capture config and dedicated antique routes exist |
| Fossils | `/entry/fossils` | Generic overview | 0 | Specialist/capture config exists; no dedicated home or dedicated route declared |
| Beauty | `/entry/beauty` | Generic overview | 0 | Specialist/capture config exists; no dedicated home or dedicated route declared |
| Tech | `/entry/tech` | Generic overview | 0 | Specialist/capture config exists; no dedicated home or dedicated route declared |
| Surplus | `/entry/surplus-flip` | `surplus-flip.tsx` | 1 | Manifest/surplus specialist and capture configuration exist |

### Cross-niche findings requiring follow-up

1. `services/nicheRouting.ts` has explicit scanner routes for Coins, MX, Bikes, Threads, Surplus and Antiques. Cards, Fossils, Beauty and Tech currently fall back to the shared `/capture` route. Confirm that shared capture correctly applies each niche's required photo set, prompt and output contract before marking scanner certification complete.
2. Cards, Fossils, Beauty and Tech have no dedicated home in the registry and therefore use `NicheOverview`. This is an intentional fallback in current code, not evidence of a finished bespoke specialist UI.
3. Route-registry tests establish route existence and declared ownership; they do not prove that screens render, prompts are niche-correct, AI outputs are valid, data queries are isolated, listing specifics persist, or the end-to-end workflow works.
4. All ten niche IDs have a corresponding specialist configuration entry and a presentation/capture configuration. Specialist existence does not prove production-grade identification/valuation accuracy.
5. No niche may be marked certified until its scanner, confidence/evidence, condition, valuation, inventory isolation, listing/category, eBay, orders/finance, web, native, security and regression areas each have niche-specific evidence.

## S1-04 — Security, entitlement, eBay, finance, sync and release blockers

**Result: IMPLEMENTED as a consolidated blocker register.** The following remain release blockers unless separately closed with evidence:

- Paid niche entitlement is not yet enforced across every API/RLS path; client-selected niche preferences are not trusted authorization.
- Some inventory/detail paths still use tenant-only authorization rather than trusted niche authorization.
- eBay finance has recurring HTTP 400/499 observations; fee aggregation, sign conventions and notes preservation require repair and live verification.
- eBay messaging must not report a successful send when the provider send failed; message schema/contract reconciliation remains required.
- Localized eBay category aspects, allowed values and category-specific item specifics need live verification and save/reopen/publish acceptance.
- Multi-line/multi-quantity order allocation, actual fee aggregation and interrupted-import recovery remain incomplete.
- Publish timeouts/unknown outcomes require operator-led marketplace reconciliation; claims must not be cleared just because time elapsed.
- Some connector credentials are encrypted at rest in the observed audit; encryption prefixes do not prove decrypt/refresh success. Keep all secrets server-only and out of client responses/logs.
- Remaining Edge Functions require individual review of authorization, validation, idempotency, quotas and error redaction.
- API 36 target, compatible generated Android toolchain, signed AABs for all ten apps and per-app Play Console declarations remain open under S7-07.
- Installed-device launches, native signing/upgrade, separate website parity, deployed Edge Function revisions and live marketplace operations remain unverified.

The detailed prior audit and hardening evidence is in `docs/SWISH_ENGINEERING_AUDIT.md` and `docs/SWISH_ENGINEERING_HANDOVER.md`. Those documents distinguish executed SQL/catalog checks from authored source tests and from unexecuted live/device checks.

## S1-05 — Open PRs, branches and main reconciliation

**Result: VERIFIED at the audited snapshot.**

- GitHub API query for open pull requests returned an empty list after PR #95 and PR #96 merged.
- Current `main` is `04fd59d2150b9421e30dce906940fc3eadec599d`.
- PR #94 merged as `9c184665`; PR #95 merged as `e4c1a8c2`; PR #96 merged as `04fd59d2`. PR #95 completed 25/25 checks and PR #96 completed 15/15 checks before merge.
- Post-merge main workflows are running: niche-routing and eleven OTA JavaScript publish jobs (ten niches plus Master Admin). These must complete successfully before claiming OTA publication.
- No APK build was triggered. OTA JavaScript publication, web exports, APK packaging and installed-device acceptance are distinct evidence types.
- Before any subsequent integration, repeat the open-PR query and compare the proposed branch against latest `main`.

## Stage S1 exit criteria

S1 is not complete until:
- The static map above is backed by current automated route/build tests (S1-01: achieved for source contract).
- Shared-service/backend dependency mapping is extended to a per-function/per-table authorization and call-path matrix (S1-02: partial; runtime/deployed checks outstanding).
- Each niche completes functional scanner-to-listing and isolation review, not merely route existence (S1-03: outstanding).
- Security/eBay/release blockers have owners, remediation PRs and acceptance evidence (S1-04: blockers documented; remediation not all complete).
- Open PR reconciliation is repeated before each merge (S1-05: snapshot verified, continuous requirement).

**Overall S1 status: IN PROGRESS.** No production-readiness claim is made by this audit.


### S1-02 — Direct database and Edge Function caller inventory (refreshed)

The refreshed source search on `main` at `f95affc8d1295d70adc1e4cf7b00a2d7db76864c` returned 43 distinct files with `supabase.from(...)` matches. The five additional `getSupabaseClient().from(...)` matches are `services/inventoryTabQueryService.ts`, `app/master-diagnostics.tsx`, `services/listingEditorService.ts`, `services/watchedLotService.ts` and `services/listingService.ts` (the latter already appears in the 43-file set). A separate search returned 29 files invoking Edge Functions through `supabase.functions.invoke(...)`; calls are split between screens and shared services. These counts describe indexed source matches, not request counts or a complete runtime trace.

Direct database query source files found:

- `services/capitalService.ts`
- `services/insightsService.ts`
- `app/stock-check.tsx`
- `app/tasks.tsx`
- `app/ebay-log.tsx`
- `app/ebay-finances.tsx`
- `app/ebay-hub.tsx`
- `app/ebay-cases.tsx`
- `app/ebay-offers.tsx`
- `app/ebay-csv.tsx`
- `services/verificationService.ts`
- `services/repricingService.ts`
- `services/exceptionService.ts`
- `app/onboarding.tsx`
- `app/ebay-messages.tsx`
- `app/settings.tsx`
- `services/orderService.ts`
- `app/ebay-import.tsx`
- `app/ebay-admin.tsx`
- `services/opportunityService.ts`
- `services/acquisitionService.ts`
- `supabase/functions/swish-ebay-orders/index.ts`
- `app/silver-batch.tsx`
- `app/coin-flipper.tsx`
- `services/itemService.ts`
- `app/listing-preflight.tsx`
- `supabase/functions/swish-ebay-finances/index.ts`
- `app/keen-on-coins.tsx`
- `app/create-listing.tsx`
- `services/commercialEngine.ts`
- `services/listingService.ts`
- `supabase/functions/swish-image-download/index.ts`
- `services/predictionService.ts`
- `services/coinInventoryService.ts`
- `app/stock-listing/[id].tsx`
- `supabase/functions/swish-ebay-post-order/index.ts`
- `supabase/functions/swish-ebay-sync/index.ts`
- `supabase/functions/swish-ebay-messages/index.ts`
- `supabase/functions/swish-ebay-category/index.ts`
- `components/feature/BulkReValueSheet.tsx`
- `supabase/functions/swish-ebay-list/index.ts`
- `supabase/functions/swish-market-value/index.ts`
- `supabase/functions/swish-ebay-browse/index.ts`

**Authorization review rule:** every direct query must be checked for authenticated caller context, tenant predicate, niche/specialist predicate where the resource is niche-owned, and matching database RLS/constraints. A tenant filter in client code is defense-in-depth, not an authorization boundary. Writes must be checked for row ownership and allowed-column constraints. Any privileged Edge Function path must independently derive/validate the caller and tenant, or document the narrow server-to-server trust boundary.

**Backend dependency inventory:** 25 deployable Edge Function entry points and 12 tracked SQL migrations exist at this baseline. The 25-function source gate inventory is in `docs/SWISH_EDGE_FUNCTION_SECURITY_MATRIX.md`. The migration inventory is the twelve tracked files under `supabase/migrations/`; tracked migrations are not proof they are applied to OnSpace Cloud.

**Remaining S1-02 boundary:** no authenticated OnSpace Cloud deployment session was available in this repository audit. Deployed function parity, effective RLS/grants, production secrets, live cross-tenant tests and actual call origins remain unverified. These are deployment acceptance evidence, not claims inferred from source search.
