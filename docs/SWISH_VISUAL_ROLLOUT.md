# SWISH Visual Rollout — Antique Flipper Reference

Status: rollout baseline and implementation contract  
Reference implementation: Antique Flipper  
Base: `release/apk-suite-20261103` (PR #154 source; not merged to main)

## Objective

Bring all ten SWISH niche apps to the same level of visual finish, navigation clarity, responsive behaviour and screen-by-screen completeness as Antique Flipper, while preserving each niche's own brand, specialist workflow and data requirements.

This is a visual and interaction rollout on the existing SWISH engine. It is not permission to rebuild the app, create a database, replace authentication, duplicate AI services, or redesign marketplace architecture.

## Source of truth

The existing `docs/ANTIQUES_PRODUCTION_PACK.md` is the reference contract. It defines a 16-screen user journey, dedicated antique capture, evidence-led identification, condition and valuation, shared inventory/listing/order services, and explicit visual and production gates.

The reference is a working native implementation and its documented acceptance criteria—not a screenshot to use as a background and not a mandate to copy antique-specific fields into other niches.

## Ten niche targets

| Niche | Product name | Current home route in registry | Current scanner route | Visual identity / specialist evidence |
|---|---|---|---|---|
| coins | Coin Flipper | coin-flipper.tsx | /coin-flipper?tab=capture | Collector / numismatic; obverse, reverse, edge, weight and catalogue evidence |
| motocross | Flipper MX | flipper-mx.tsx | /flipper-mx | Racing / workshop; bike profiles, engine, frame, parts and condition |
| bicycles | Bike Flipper | bike-flipper.tsx | /bike-flipper | Cycle workshop; drive-side, frame, groupset, sizing and component condition |
| clothing | Threads Flip | threads-flip.tsx | /threads-flip?tab=identify | Fashion editorial; garment, label, size, fabric, style and condition |
| trading_cards | Card Flipper | no dedicated home declared | /capture | Collector / grading; front, back, corners, centring, surface and grade |
| antiques | Antique Flipper | antique-flipper.tsx | /antique-capture | Black/charcoal and antique gold; multi-angle evidence and provenance |
| fossils | Fossil Flipper | no dedicated home declared | /capture | Natural history / museum; specimen, matrix, scale, features and provenance |
| beauty | Beauty Flipper | no dedicated home declared | /capture | Beauty retail; product, packaging, shade, batch and expiry evidence |
| tech | Tech Flipper | no dedicated home declared | /capture | Modern technology; model labels, ports, accessories, testing and condition |
| surplus_flip | Surplus Flip | surplus-flip.tsx | /surplus-flip | Trade / equipment; manufacturer, model, specifications, quantity and condition |

Registry routes are current source evidence, not a claim that every route is visually complete. A missing dedicated home route is an implementation gap to assess; do not invent or silently change routes before inspecting entry routing and existing screens.

## Shared design language to carry across all niches

- Premium, purposeful dashboard with clear hierarchy and useful inventory / listing status.
- Branded top-level navigation and consistent five-area information architecture where the current app supports it: Home, Inventory, Scan, Listings, More.
- Scanner as a clear primary action, with large capture affordance, angle/evidence checklist, retake and gallery flows, progress, helpful guidance and readable error/loading states.
- Identification result that separates observed evidence from inference, makes confidence visible where supported, and provides editable specialist follow-up.
- Consistent cards, spacing, typography scale, button states, icon sizing, safe-area handling and scroll behaviour.
- Consistent empty, loading, error, permission-denied, offline and success states.
- Accessibility labels, touch targets, contrast, and no clipped or half-visible text on narrow Android screens.
- Each niche retains its own colour palette, imagery, vocabulary, specialist attributes and evidence checklist. Antique gold is not copied as the universal colour.

## Screen-by-screen acceptance checklist

For each niche, inspect and implement the screens that exist in its real journey. Mark a screen N/A only with a reason; do not silently omit it.

1. App entry / splash and authentication hand-off
2. Home dashboard
3. Scanner / capture
4. Photo evidence review and retake
5. AI identification progress
6. Identification result / specialist review
7. Condition assessment or grading
8. Market valuation and comparable evidence
9. Save / add to inventory confirmation
10. Inventory list, filters and item detail
11. Create listing
12. Marketplace category and item specifics
13. Listing review and save draft / publish confirmation
14. Listings / eBay hub and lifecycle status
15. Sold items and orders
16. More / settings / guides / account

Use shared existing workflows for capture, identification, valuation, inventory, listing and orders wherever they are authoritative. A niche-specific screen is justified only when the user journey genuinely needs specialist presentation or inputs.

## Implementation sequence

### Phase 0 — Baseline audit
- Capture the current running screen and route for every screen in all ten niches.
- Map every screen to its source component, route, service and niche identity.
- Record defects, legacy UI, dead controls, clipping, inconsistent navigation and missing states.
- Confirm niche isolation for routes, prompts, specialists, inventory and listings.
- Do not change business logic during visual inventory unless a defect blocks the screen.

### Phase 1 — Reference component contract
- Extract reusable layout and interaction patterns from Antique Flipper.
- Reuse existing theme/component infrastructure; avoid a parallel design system.
- Parameterise niche accent, typography treatment, terminology, imagery and evidence configuration.
- Keep shared controls accessible and responsive.
- Do not turn the reference into a single generic screen that erases niche character.

### Phase 2 — Niche-by-niche implementation
- Implement the missing home experience for niches whose registry home is null, after inspecting the entry and existing dashboard.
- Bring each scanner and its complete capture/review flow to the reference interaction standard.
- Apply the same visual quality to all remaining journey screens.
- Preserve existing route contracts unless a reviewed route change is necessary.
- Keep changes isolated by niche and shared component; no cross-niche data leakage.

### Phase 3 — Verification
For every niche:
- TypeScript and lint pass.
- Relevant unit / regression tests pass.
- Niche route and specialist isolation tests pass.
- No missing route imports or dead-end navigation.
- Web export/build passes.
- Android branded build and APK package/route inspection pass.
- Manual narrow-screen review confirms no clipping, overflow or obstructed controls.
- Real-device workflow acceptance covers sign-in, capture, identification, save, inventory, listing draft, item specifics and lifecycle screens.

A build passing is not equivalent to visual acceptance or device acceptance. Do not label a niche complete until all applicable gates are evidenced.

## Rollout tracking

| Niche | Baseline audited | Home | Capture | Remaining screens | Tests/build | Device accepted |
|---|---|---|---|---|---|---|
| Coin Flipper | Not yet | Not yet | Not yet | Not yet | Not yet | Not yet |
| Flipper MX | Not yet | Not yet | Not yet | Not yet | Not yet | Not yet |
| Bike Flipper | Not yet | Not yet | Not yet | Not yet | Not yet | Not yet |
| Threads Flip | Not yet | Not yet | Not yet | Not yet | Not yet | Not yet |
| Card Flipper | Not yet | Not yet | Not yet | Not yet | Not yet | Not yet |
| Antique Flipper | Reference | Reference | Reference | Reference pack | Recheck | Not certified |
| Fossil Flipper | Not yet | Not yet | Not yet | Not yet | Not yet | Not yet |
| Beauty Flipper | Not yet | Not yet | Not yet | Not yet | Not yet | Not yet |
| Tech Flipper | Not yet | Not yet | Not yet | Not yet | Not yet | Not yet |
| Surplus Flip | Not yet | Not yet | Not yet | Not yet | Not yet | Not yet |

## Guardrails

- No new database, auth provider, marketplace connector or duplicated AI engine.
- No global visual changes that break a niche's existing identity or user workflow.
- No replacing real screens with static mockup images.
- No marking work complete from source inspection alone; verify the rendered app.
- No merging into main without explicit approval.
- Keep the Android cold-launch crash investigation and APK delivery work visible as a separate release blocker; this visual rollout does not declare that issue fixed.
