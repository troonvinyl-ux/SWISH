# SWISH Product Design Plan

## Goal

Deliver a family of focused, branded resale tools powered by one shared SWISH engine. Each niche should feel like its own product, while reusing authentication, inventory infrastructure, eBay integration, image storage, valuation primitives, and shared listing workflows.

## Existing architecture found on main

- Expo Router / React Native application.
- A shared niche home router in `app/(tabs)/index.tsx`.
- Existing specialist screens for Coin Flipper, Flipper MX, Bike Flipper, Threads Flip, and Surplus Flip.
- A niche selection screen and fail-closed niche routing.
- Shared design tokens in `constants/theme.ts`.
- Existing backend and database should remain in place.

The product designs are achievable incrementally without rebuilding SWISH or creating another database. The visual references are target concepts, not proof that every illustrated capability is already implemented or connected to live data.

## Product family

### First production group
1. **Coin Flipper** — coin capture (obverse/reverse), candidate identification and confidence, catalogue references (including Numista), market evidence, collection and eBay listing workflow.
2. **Flipper MX** — dirt-bike identification, condition checklist, parts and repair estimates, buy decision and profit tracking.
3. **Bike Flipper** — bicycle model/component identification, condition and repair planning, upgrades and resale analysis.
4. **Threads Flip** — clothing/brand identification, condition and authenticity evidence, resale comparisons and listing preparation.
5. **Surplus Flip** — supplier manifest import, photo matching, quantity-aware stock records and reviewed eBay drafts.

### Future niche candidates
Card Flipper, Antique Flipper, Fossil Flipper, Beauty Flipper, Tech Flipper and Tool Flipper. These should be added only with a clear specialist workflow, verified data sources and explicit support status. They must not appear as fully functional products merely because a promotional graphic depicts them.

## Visual design system

- Dark, high-contrast interface foundations.
- Product-specific brand palettes: coin gold/black; MX orange/black; bike green/black; clothing pink/black; surplus blue/teal.
- Strong, readable home-screen hero and clear primary action.
- Image-first capture and product cards.
- Consistent confidence, evidence, condition, cost, price and profit summaries.
- Simple bottom navigation with labels.
- Reusable components for metric cards, status chips, evidence rows, condition checklists, profit breakdowns, photo capture and listing readiness.
- Keep forms and tables legible on small phones; avoid copying dense poster layouts literally into app screens.
- Use the generated posters as visual direction, not as the actual interface or as evidence for prices/market claims.

## Implementation phases

### Phase 1 — Audit and shared foundation
- Map existing routes, entry screens, niche configuration and theme usage.
- Identify which screens are functional, demo-only or missing live data.
- Define a typed per-niche brand configuration using the existing theme system.
- Keep auth, routing, data access, inventory isolation and eBay listing architecture unchanged.

### Phase 2 — Home screen design pass
- Update Coin Flipper, Flipper MX, Bike Flipper and Threads Flip home screens to align with their supplied brand concepts.
- Prioritise primary workflows: Scan/Find, My Items, Value/Buy Decision, List & Sell, Profits/Insights.
- Preserve working features and route destinations; do not replace real flows with decorative mock buttons.
- Apply the same component standards to Surplus Flip while keeping its manifest-first workflow.

### Phase 3 — Specialist workflow polish
- Improve capture and identification results with evidence and confidence clearly separated.
- Make market values distinguish asking prices from confirmed sold comparables.
- Add transparent acquisition, repair, fees, postage, target price and estimated profit breakdowns where relevant.
- Keep uncertain identification/valuation clearly labelled and never invent data.

### Phase 4 — Regression and release
- Test each niche route and account switching.
- Verify inventory remains isolated by niche and user/tenant.
- Verify eBay draft creation, item specifics, images, quantity, and Simple Delivery.
- Run lint/type checks and available automated tests.
- Verify on a real device/build before describing it as deployed.

## Non-negotiable constraints

- Reuse the existing repository, database, auth and backend.
- Do not rebuild the project from scratch.
- Do not break existing eBay OAuth, listing, order or inventory workflows.
- Keep each niche's inventory and specialist context properly isolated.
- Never publish eBay listings automatically as a side effect of importing stock.
- Keep Simple Delivery as the default delivery method unless the owner explicitly changes it.
- Avoid claiming deployment or live verification until it has actually been checked.

## Acceptance criteria

- Each supported niche has distinct, coherent branding and a home screen that leads to working features.
- Every visible primary action has a real route or a clearly labelled unavailable/coming-soon state.
- Data-driven numbers have traceable sources and display uncertainty where appropriate.
- Existing inventory, image storage, authentication, and eBay flows pass regression tests.
- The app stays responsive and readable on mobile.
