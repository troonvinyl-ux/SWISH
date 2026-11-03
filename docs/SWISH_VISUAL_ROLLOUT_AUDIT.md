# SWISH Visual Rollout — Initial Repository Audit

Audit source: `design/antique-reference-rollout`  
Audit scope: route registry, home router, tab navigation, scan router and existing product design roadmap.  
Mode: source inspection only. No claim of rendered-screen or device verification.

## Findings

### 1. Existing design plan already establishes the correct product principle
`docs/SWISH_PRODUCT_DESIGN_ROADMAP.md` says each niche should feel like its own product while sharing authentication, inventory, eBay, image storage, valuation primitives and listing workflows. It calls for dark high-contrast foundations, product-specific palettes, reusable metric/status/evidence/condition/profit/capture/listing-readiness components, and readable small-phone layouts.

The new rollout must extend this plan, not contradict it.

### 2. Home-screen coverage is incomplete at the dedicated-home level
`app/(tabs)/index.tsx` directly renders dedicated home experiences for:
- Coin Flipper
- Flipper MX
- Bike Flipper
- Threads Flip
- Surplus Flip
- Antique Flipper

Other registered niches currently fall through to the shared `NicheOverview` component. The registry has no dedicated `home` declared for Card Flipper, Fossil Flipper, Beauty Flipper and Tech Flipper.

This is a clear home-experience workstream. Before creating new pages, inspect NicheOverview and existing niche-specific screens to decide whether a bespoke home can be built by configuration and existing components without duplicating business logic.

### 3. Navigation currently differs from the five-area target
`app/(tabs)/_layout.tsx` currently describes a four-tab V1 layout: Home, Scan, Stock/Inventory, Listings/eBay. The More/Account destination is conditionally exposed for Antique Flipper and Threads Flip, and hidden for other niches. Threads Flip also hides the Listings tab.

Therefore the five-area structure in the Antique production pack is not uniformly implemented across all niches. Treat consistent navigation as a design acceptance decision, but do not blindly expose routes that are not ready or remove Threads Flip's existing functional destinations.

### 4. Scan router is partly niche-aware, but its explicit product map is incomplete
`app/(tabs)/scan.tsx` contains specialist capture configurations for coins, MX, bikes, clothing, surplus, antiques and fossils, and uses shared capture infrastructure. The explicit type currently has no separate values for trading cards, beauty or tech; those can fall through to a generic state. Registry scanner routes for cards, fossils, beauty and tech currently point to `/capture`.

This is an implementation target: define correct capture guidance and visual treatment for all ten products, then verify the resulting route and save action preserves canonical niche/specialist identity.

### 5. Antique Flipper is a valid benchmark, not a universal skin
`docs/ANTIQUES_PRODUCTION_PACK.md` defines black/charcoal surfaces, gold/brass accents, evidence checklist, camera-first multi-angle capture, specialist review, condition, valuation and reuse of shared inventory/listing/order flows.

Carry across the information hierarchy, quality of interaction, screen completeness and acceptance gates. Do not carry antique colours, serif branding, antiques terminology, or antique-only evidence slots into other niches.

## Priority implementation order

1. Establish a typed shared visual configuration using the existing theme and niche registry, if current architecture permits without broad refactoring.
2. Close the four missing dedicated-home experiences (cards, fossils, beauty, tech), reusing the shared NicheOverview and existing specialist modules where appropriate.
3. Complete explicit capture configuration for all ten niches and check each capture route against the canonical registry.
4. Standardise tab labels, availability and navigation hierarchy, preserving functional routes and niche identity.
5. Audit the remaining screen journey: result/review, condition, valuation, inventory, listing, eBay, orders, settings.
6. Implement visual corrections in small, testable changes and run typecheck, regression, niche isolation and web/Android build gates.

## Known constraints and unresolved questions

- Source inspection does not prove what the current APK renders.
- The tab structure and product design roadmap are not fully aligned; resolve this with a deliberate shared navigation spec.
- The new design rollout is separate from the Android repeated-cold-launch crash and APK delivery blocker.
- No database, auth, eBay architecture or shared AI pipeline changes are authorised by this visual rollout.
