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

The current repository is **not yet configured to produce four separately branded store apps**:
- `app.json` currently uses Expo name/slug `onspace-app` / `onspace-app`.
- Android currently uses the single package ID `com.swish.inventory`.
- No iOS bundle identifier is configured in the checked-in app config.
- `eas.json` currently defines one `production` Android APK profile only.
- There are no niche-specific app icons in `assets/images`; the shared dashboard image is currently used for the app icon and splash.

Therefore, the four entry routes are four experiences inside one installed app today—not four distributable branded apps. Creating four build variants requires explicit per-niche app name, package/bundle ID, scheme, icon/splash configuration and build profiles. Do that only after the fixed-niche boot configuration is implemented, so each build cannot be switched into an unpurchased niche.

## Current routing implementation

| File | Current responsibility | Audit note |
|---|---|---|
| `app/index.tsx` | Authentication/onboarding and active-niche routing | Contains a local niche-to-route mapping; unknown IDs fall back to coins. |
| `app/entry/coins.tsx` | Sets active niche to coins, then redirects to shared tabs | Client-side niche switch, not an entitlement guard. |
| `app/entry/motocross.tsx` | Sets active niche to motocross, then redirects to shared tabs | Client-side niche switch, not an entitlement guard. |
| `app/entry/bicycles.tsx` | Sets active niche to bicycles, then redirects to shared tabs | Client-side niche switch, not an entitlement guard. |
| `app/entry/clothing.tsx` | Sets active niche to clothing, then redirects to shared tabs | Client-side niche switch, not an entitlement guard. |
| `app/(tabs)/_layout.tsx` | Shared Home / Scan / Stock / eBay tabs | Intended to remain common but must render niche-appropriate labels and routes. |
| `app/(tabs)/index.tsx` | Chooses one of four niche home screens | Has a separate mapping and defaults unknown IDs to Coin Flipper. |
| `contexts/AppContext.tsx` | Holds tenant, subscription and active/enabled niche state | Active/enabled niche selection is persisted in device-wide AsyncStorage, not account-specific server state. |
| `app/niche-select.tsx` | Lets users switch and enable multiple niches | Local enable state must not grant paid access. In the final UX, niche switching is only for entitled products. |
| `app/subscription.tsx` | Displays plan and initiates checkout | Checkout previously hardcoded `coins`; fixed to pass `activeNicheId` in commit `a2e8aeee00ec345ec04eb9a90739df547e699ee6`. |
| `supabase/functions/swish-create-checkout/index.ts` | Creates Stripe subscription with `niche_id` metadata | Accepts a client-supplied niche ID; validate it against the canonical allowed list before production entitlement work. |
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

1. The four entry routes change client niche state but do not currently check paid entitlement.
2. Active/enabled niche state is stored under one device-wide AsyncStorage key; it can survive account changes on a shared device.
3. Root routing and Home routing duplicate niche mapping logic and use a Coin Flipper fallback for unknown IDs.
4. `swish-check-subscription` returns one generic subscription result and currently does not filter active subscriptions by niche metadata.
5. `swish-create-checkout` accepts arbitrary `nicheId` metadata without canonical validation.
6. The subscription screen's premium feature list is coin-centric even though checkout can target another niche.
7. Confirm server-side enforcement in the existing AI/valuation Edge Functions and existing database row-level security before claiming inventory isolation is complete.
8. This is a source audit only; build, live deployment, Stripe webhook behaviour and real subscriber flows have not yet been verified.

## Implementation sequence

1. Canonicalise niche IDs and route mapping without changing screens or database.
2. Make niche selection account-aware and ensure entry routes resolve only to one of the four supported products.
3. Extend the existing subscription-check endpoint to return entitlement for the requested niche(s), derived from verified active Stripe subscriptions and existing tier rules.
4. Validate checkout niche IDs server-side and confirm Stripe subscription metadata/webhook handling.
5. Apply entitlement checks to paid specialist operations on the server, retaining basic free inventory access.
6. Add regression tests for all four products, cross-niche inventory/listing isolation, single-niche subscription, multi-niche subscription and existing lifetime tier.
7. Only then simplify the visual shell and refine each niche's dashboard.

## Change log

- 2026-10-18: Initial route/entitlement register created from source review.
- 2026-10-18: Subscription screen checkout now passes active niche instead of hardcoding coins (commit `a2e8aeee00ec345ec04eb9a90739df547e699ee6`).
- 2026-10-18: AI identification Stripe entitlement now matches the specialist's niche; legacy metadata-less subscriptions remain Coins (commit `c1a5082e24acac5fcb64a68e14c1830b2ea6b1ec`).
- 2026-10-18: Dedicated Islamic identification now requires Coins entitlement or an existing global premium tier (commit `a3cb14a6ed0caf3c2686972e0f1c27ef12a16415`).
- 2026-10-18: Subscription status endpoint returns active niche entitlements (commit `e62c81484e9f144dcda8de66fb868353507fa40c`); client model and hook use active niche entitlement (commits `1a7bd9522c6bef70bd2479cd5605ef56c16d67e` and `b9c0d1e880846ce5792a4cdb926458f47ff59355`).
- 2026-10-18: Subscription screen now presents niche-specific premium features and product labels (commit `5126ec9c7efb1b30b6a2c25091c08d89d3c2739d`).
