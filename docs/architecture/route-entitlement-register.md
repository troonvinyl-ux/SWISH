# SWISH Route and Niche Entitlement Register

Status: initial source audit, 2026-10-18
Repository: troonvinyl-ux/SWISH
Decision: four separately branded niche experiences, one shared codebase and backend.

## Product boundary

| Product | Canonical niche ID | Entry route | Home screen | Data scope |
|---|---|---|---|---|
| Coin Flipper | `coins` | `/entry/coins` | `app/coin-flipper.tsx` | `tenant_id` + coin specialist IDs |
| Flipper MX | `motocross` | `/entry/motocross` | `app/flipper-mx.tsx` | `tenant_id` + motocross specialist ID |
| Bike Flipper | `bicycles` | `/entry/bicycles` | `app/bike-flipper.tsx` | `tenant_id` + bicycle specialist ID |
| Threads Flip | `clothing` | `/entry/clothing` | `app/threads-flip.tsx` | `tenant_id` + clothing/trainer specialist IDs |

## Shared infrastructure

- Authentication and tenant provisioning.
- Existing Supabase backend, database, storage and Edge Functions.
- Shared UI primitives and common services where behaviour is genuinely common.
- Marketplace integrations and common listing/order infrastructure, with all reads and writes scoped to the correct tenant and niche.
- Niche-specific identification, valuation, attributes, terminology, navigation and entitlements.

Do not create separate databases or duplicate the existing backend to make the products feel independent.

## Current build packaging reality

The repository now has environment-driven branded build identities:
- `app.config.js` reads `SWISH_NICHE` and sets product name, slug, deep-link scheme, Android package ID, iOS bundle ID, and runtime `swishNicheId`.
- `eas.json` now has `production-coins`, `production-motocross`, `production-bicycles`, and `production-clothing` APK profiles.
- The original `production` profile and legacy app identity remain unchanged when `SWISH_NICHE` is unset.
- Branded runtime state is pinned to its configured niche; onboarding and niche selection no longer offer a cross-product switch.
- Checkout uses the branded deep-link scheme for new branded builds while preserving `onspaceapp://` for legacy builds.
- App icons/splash art are still shared assets; distinct product artwork remains a follow-up design task.

These are configured build profiles, not proof that four release APKs have been built, signed, installed, or published. Those checks remain outstanding.

## Current routing implementation

| File | Current responsibility | Audit note |
|---|---|---|
| `app/index.tsx` | Authentication/onboarding and active-niche routing | Uses the shared canonical resolver; unknown IDs route to niche selection instead of defaulting to Coins. |
| `app/entry/coins.tsx` | Sets active niche to coins, then redirects to shared tabs | Client-side niche switch, not an entitlement guard. |
| `app/entry/motocross.tsx` | Sets active niche to motocross, then redirects to shared tabs | Client-side niche switch, not an entitlement guard. |
| `app/entry/bicycles.tsx` | Sets active niche to bicycles, then redirects to shared tabs | Client-side niche switch, not an entitlement guard. |
| `app/entry/clothing.tsx` | Sets active niche to clothing, then redirects to shared tabs | Client-side niche switch, not an entitlement guard. |
| `app/(tabs)/_layout.tsx` | Shared Home / Scan / Stock / eBay tabs | Intended to remain common but must render niche-appropriate labels and routes. |
| `app/(tabs)/index.tsx` | Chooses one of four niche home screens | Uses the shared resolver; unknown IDs route to niche selection instead of defaulting to Coin Flipper. |
| `contexts/AppContext.tsx` | Holds tenant, subscription and active/enabled niche state | Local niche preferences use a per-user AsyncStorage key, are validated against production niches, and branded builds pin the configured niche. Server-side entitlement remains authoritative. |
| `app/niche-select.tsx` | Lets users switch and enable multiple niches | Local enable state must not grant paid access. In the final UX, niche switching is only for entitled products. |
| `app/subscription.tsx` | Displays plan and initiates checkout | Checkout previously hardcoded `coins`; fixed to pass `activeNicheId` in commit `a2e8aeee00ec345ec04eb9a90739df547e699ee6`. |
| `supabase/functions/swish-create-checkout/index.ts` | Creates Stripe subscription with `niche_id` metadata | Canonical niche IDs and explicit branded callback schemes are validated; legacy callback retained. |
| `supabase/functions/swish-check-subscription/index.ts` | Checks Stripe active subscription | Currently reports a general active subscription and first active subscription, not entitlement for a requested niche. |
| `services/subscriptionService.ts` | Client-side subscription state | Current response shape does not represent a set of independently entitled niches. |

## Required entitlement contract

- A free account may enter its chosen niche's basic experience.
- A paid subscription unlocks specialist features for the niche identified by the verified Stripe subscription metadata.
- Multiple niche subscriptions grant the union of those niche entitlements; one subscription must not unlock all niches.
- Entitlements must be computed server-side from authenticated user identity and verified subscription records/metadata. Client state is for presentation only.
- A client-provided `nicheId`, local storage flag, route, or hidden UI control is never proof of entitlement.
- Server-side AI/valuation/listing endpoints that require paid access must enforce the appropriate niche entitlement themselves; a route guard alone is insufficient.
- Existing lifetime/business/enterprise tiers must be deliberately mapped during implementation so legitimate access is not accidentally removed.
- Keep current tables, auth, Edge Functions and storage. Do not introduce a parallel database or duplicate subscription system.

## Known risks / open checks

1. The root and Home routers now use a shared resolver and fail closed to niche selection for unknown/inactive IDs.
2. Niche preferences are stored under a per-user AsyncStorage key, validated against the four production niches, and reset on account change/logout.
3. Branded builds are pinned to their configured niche at runtime; the shared development/legacy build can still switch between enabled production niches.
4. `swish-check-subscription` now returns `niche_entitlements` from active Stripe subscription metadata; legacy subscriptions without metadata are mapped to Coins. Client premium badges evaluate the active niche.
5. `swish-create-checkout` validates canonical niche IDs and checks the supplied branded scheme against that niche; legacy clients retain the old callback.
6. The subscription screen presents product-specific labels and feature lists.
7. Server-side valuation/listing entitlement enforcement and database row-level security still need a separate endpoint-by-endpoint audit. The eBay listing `end` route now resolves the listing and linked item from tenant-scoped database records, validates any supplied external ID, and scopes local updates by `tenant_id` (commit `a6be2707b8becbdcc7b2923cd4b40ea594d71a89`). eBay full sync now scopes listing/item writes by tenant as well (commit `e06f0db2e929bc2cf2f36a3e80d1cb800c2280bd`).
8. Four EAS build profiles and a CI workflow now exist, but no successful test/build run or live deployment has yet been confirmed.

## Implementation sequence

1. [Done in source] Centralise canonical niche routing and fail closed for unknown/inactive product IDs.
2. [Done in source] Scope local niche preferences to the signed-in account; pin branded builds to one product.
3. [Done in source] Add four EAS build profiles with distinct package/bundle IDs and deep-link schemes.
4. [Done in source] Return per-niche subscription entitlements, validate checkout niche IDs, and scope AI identification entitlement to its specialist niche.
5. [In progress] Audit all valuation, listing, order and inventory endpoints for server-side niche/tenant entitlement enforcement.
6. [Added, not yet verified] CI regression tests for routing, isolation and all four Expo branded configs.
7. Build and install all four APKs, test checkout return links, single-/multi-niche subscription cases and account switching.
8. Only then refine the shared navigation and niche-specific dashboards.

## Change log

- 2026-10-18: Initial route/entitlement register created from source review.
- 2026-10-18: Subscription screen checkout now passes active niche instead of hardcoding coins (commit `a2e8aeee00ec345ec04eb9a90739df547e699ee6`).
- 2026-10-18: AI identification Stripe entitlement now matches the specialist's niche; legacy metadata-less subscriptions remain Coins (commit `c1a5082e24acac5fcb64a68e14c1830b2ea6b1ec`).
- 2026-10-18: Dedicated Islamic identification now requires Coins entitlement or an existing global premium tier (commit `a3cb14a6ed0caf3c2686972e0f1c27ef12a16415`).
- 2026-10-18: Subscription status endpoint returns active niche entitlements (commit `e62c81484e9f144dcda8de66fb868353507fa40c`); client model and hook use active niche entitlement (commits `1a7bd9522c6bef70bd2479cd5605ef56c16d67e` and `b9c0d1e880846ce5792a4cdb926458f47ff59355`).
- 2026-10-18: Subscription screen now presents niche-specific premium features and product labels (commit `5126ec9c7efb1b30b6a2c25091c08d89d3c2739d`).
- 2026-10-18: Added canonical fail-closed niche routing; root and Home route unknown values to product selection (commits `107e8812942f3b08dc15082a09b20b8da5f03387`, `9516ad81941d54f1614657d7de91adbd9e8d2b6b`, `96bdb897d320b2dbbe9502e2bc1ae9154c17a929`).
- 2026-10-18: Niche preferences are account-scoped and routing waits for account preference loading (commits `34e51aee21eb8533dde632ae775ad9bbdabb534a`, `85ac42ea5651fc5ebdc513ce8a6e3c249b50304e`, `da21ac397a09e834fdc15161fb9075b60930b96f`).
- 2026-10-18: Added dynamic branded app identities and four EAS profiles; branded runtime and onboarding are pinned to their configured niche (commits `e78591a2024ae3b0ebe878e578e62edcc462515c`, `daf136f928ad868aefe8da870dcce72b3ce83373`, `e895c79d42767cbfc9782bdd01be78e438066d47`, `cfd9741a06b1df3b448b4568f94d621b1716aedd`, `2d7d40e5a5ef2f8ebb49edc54ea034e2d09ee348`).
- 2026-10-18: Branded checkout callback uses a scheme matched to the selected niche; legacy callback retained (commits `01033ef3c95d5b76665610d45e54748ddff9fa52`, `ad4c8be75a17fce7f85728c4e5d6d1a0a5e5438c`, `713f951e73bc43e47203b2b1a107f02477068760`, `fdaefcd79acb36762887bb1d103016d52403f27e`, `1d05e4cc08ac12ec35af8065097b0104ae8babda`).
- 2026-10-18: Added route/build config regression tests and CI workflow; execution still needs confirmation (commits `b55d302756044e2c329dea24c53619accd5b72c3`, `f7157118445b7117e3c2ddd90bd5a00c563604fd`, `df69ff99d08bc8e15ef05ed0c7751f567de37424`).
- 2026-10-18: Market valuation now checks that any supplied item ID belongs to the authenticated tenant and matches the requested product's specialist family, even when the caller supplies external image URLs (commit `ca22b3ccd7a99ffc66e4083b850ba5c88473a89b`).
- 2026-10-18: eBay listing end route validates tenant-owned listing/item records and the saved external listing ID before ending; all local writes are tenant-scoped (commit `a6be2707b8becbdcc7b2923cd4b40ea594d71a89`).
- 2026-10-18: eBay full sync listing and item updates now explicitly include `tenant_id` in every affected write path (commit `e06f0db2e929bc2cf2f36a3e80d1cb800c2280bd`).
- 2026-10-18: eBay order import now scopes linked item reads and item/listing sold-status writes by `tenant_id` in both Fulfillment and Trading API paths (commit `2c8080033a6bb071346b162d0935f5c5f0db253a`).
- 2026-10-18: CI path filters now run the existing regression/config checks when the eBay listing, sync, or order-import security files change (commit `137e0e1422a8bfa64eac2d9657cab8e6167873e6`).
- 2026-10-18: eBay dispatch's shared order-status writer now requires and filters by tenant ID; shipping lookup rejects non-eBay orders (commits `2318fe2ed0265fd4539fd99f0faec8f7901dce67` and `263d2e74646a0088de200322668a7760202bd07c`).
- 2026-10-18: eBay Finances actual-fee reconciliation now tenant-scopes the order read and write (commit `53a12f50881a9af8a1f2b3899ec42429c227b14a`).
- 2026-10-18: CI path filters now include the eBay dispatch and finance functions (commit `f5c8ac4633bac62b6f93f0afac66f85404cfd95b`).
- 2026-10-18: Order service reads and updates now require tenant scoping; order creation validates linked item/listing ownership and consistency before inserting (commit `848648a258bdedbe2ec5dc63a8565e1a1ff24aa7`).
- 2026-10-18: CI path filters now include `services/orderService.ts` (commit `b4243c3e12fb5218a1e18a0f052e1f77c10d24db`).
