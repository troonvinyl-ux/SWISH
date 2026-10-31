# SWISH Production Pack Standard
Version: 1.0
Baseline: main at 3898baa7608105cd55ee16c3872452f5d5d4fedc
Status: architecture mapping and acceptance standard; not a production certification.

## Purpose and non-negotiable architecture

SWISH is one shared resale intelligence platform with specialist niche products. A niche pack configures its own identity, expertise, data attributes, workflows and presentation; it must not fork shared auth, tenant isolation, inventory persistence, eBay integration, listing lifecycle, learning or prediction services.

This document maps the repository as it exists today. It is deliberately descriptive before prescriptive: do not create a second engine, new database, new auth system, or replacement eBay architecture to satisfy this standard. Keep existing database schemas and listing flows unless a separately reviewed migration is essential.

## 1. Shared SWISH Production Pack

| Shared capability | Existing implementation | Production-pack responsibility | Current verification boundary |
|---|---|---|---|
| eBay Hub / marketplace | `app/ebay-hub.tsx`; eBay Edge Functions under `supabase/functions/swish-ebay-*`; `services/marketplaceService.ts`, `orderService.ts` | OAuth connection, account health, seller policies, drafts/live listings, revise/end, orders, messages, returns, finances, sync and diagnostics | Source exists. A live end-to-end eBay lifecycle and finance reconciliation are not certified by a source audit. |
| Decomposition engine | `supabase/functions/swish-decompose/index.ts`; `services/decompositionService.ts`; manifest services and tests | Break collections/lots into candidate assets, route each to a specialist, compare bundle vs split economics and labour-adjusted exit paths | Dedicated function and manifest tests exist. Treat each output as a proposal with evidence, not verified stock. |
| Identify engine | `supabase/functions/swish-identify/index.ts`; `swish-islamic-identify`; `services/aiIdentificationService.ts`; `shared/specialistIntelligence.ts` | Specialist routing, structured evidence, image/capture quality, confidence state, corrections and follow-up questions | Shared specialist profiles and identification pipeline exist. Confidence is not authentication, grading certification, mechanical safety or legal clearance. |
| Valuation engine | `supabase/functions/swish-market-value/index.ts`; `services/marketValueService.ts`; `services/valuationGuardrailService.ts`; `services/commercialEngine.ts` | Sold-vs-asking evidence separation, comparables, confidence, price range, fees, costs, net margin and evidence age | Terapeak/sold-data path and fallback sources are implemented in source. Provider access and current live data must be checked at runtime; asking prices must never be presented as sold prices. |
| Listing creator | `supabase/functions/swish-list-generate/index.ts`; `supabase/functions/swish-ebay-list/index.ts`; `services/listingService.ts`, `listingLifecycle.ts`, `listingEditorService.ts` | Generate a draft from approved identification and valuation, map leaf category and item specifics, validate required aspects/policies, persist, publish/revise/end | Listing generator and common eBay submission routes exist. Category/aspect completeness and niche-specific live listing acceptance require explicit tests. |
| Inventory and tenant boundary | `services/itemService.ts`, `coinInventoryService.ts`, `inventoryViewService.ts`, hooks, RLS migrations and authorization helpers | Canonical item identity, tenant ownership, niche/specialist scoping, media, status and consistent app/web views | Tests exist. Prior engineering audit recorded unresolved tenant-membership, empty-filter fail-open, stale response and listing-state consistency risks. |
| Learning and prediction | `services/aiLearningService.ts`, `predictionService.ts`, `flipIntelligenceService.ts`, `commercialEngine.ts`, `decisionEngine.ts` | Feedback loop, evidence-backed prediction, buying score, profit and uncertainty | Services exist; do not imply model accuracy or a calibrated prediction until measured against labelled outcomes. |
| Shared security | `supabase/functions/_shared/credentialCrypto.ts`, authorization helpers, `docs/EBAY_CREDENTIAL_SECURITY.md` | Server-only secrets, authenticated tenant access, least privilege, redaction and auditability | Encrypted credential helper and tests exist. Earlier audit flagged database column grants on `credential_ref`; encryption-at-rest alone does not establish a server-only column boundary. |
| Release / diagnostics | `.github/workflows/*`, `app/master-admin.tsx`, `app/master-diagnostics.tsx` | Regression gates, niche build verification, diagnostics, release evidence and rollback notes | Workflows and owner diagnostics exist. A green build is not proof of device usability or live marketplace success. |

### Shared engine contracts

1. Every operation is tenant-authorized on the server; client-side hiding is not authorization.
2. Every item and listing retains stable IDs. Do not create parallel inventory records during retries.
3. Identification, valuation and listing generation are separate evidence stages. A later stage cannot silently upgrade an earlier confidence state.
4. Store source, timestamp, marketplace, condition, quantity and confidence for every comparable. Clearly label asking-price evidence.
5. The listing creator must preserve specialist item specifics through draft, edit, save, publish and revise.
6. eBay category must be a verified leaf category; required aspects and seller-selected business policies must be validated before publish. Never guess a category or policy.
7. Partial sync/API failures must not be interpreted as proof that a remote listing ended or disappeared.
8. No secrets in client bundles, database-readable client columns, logs, diagnostics or API responses.
9. A failed remote write must not be reported as success or leave an unmarked local/remote divergence.
10. Shared-engine changes trigger regression tests against all ten niche configurations.

## 2. Niche Production Pack

Every niche pack must define the following subsections. A pack is not complete just because it has a name, icon and route.

### A. Product identity and brand
- Canonical niche ID, public name, short name, tagline and description.
- Logo, app icon, splash/hero art, product imagery, colour tokens, typography and tone of voice.
- Android package / iOS bundle ID, URL slug, deep links and store metadata.
- All asset files and their licensing/provenance.
- Branded website landing page and the relationship to the app entry route.

### B. Specialist intelligence
- Canonical specialist ID(s), legacy aliases and one default specialist.
- Identification prompt, supported item types, taxonomy and known lookalikes.
- Required photo views, image-quality checks and follow-up capture questions.
- Structured fields and item-specific attribute definitions.
- Condition rules, authenticity/safety cautions and prohibited claims.
- Confidence thresholds, evidence requirements, uncertainty language and manual-review gates.
- Source references and update/version date.

### C. Niche functions and workflows
- Scan / capture and review.
- Inventory and specialist-specific detail/editor.
- Niche tools (e.g. grading, fitment, maker-mark research, lot decomposition).
- Acquisition and buying decision tools.
- Valuation and profit calculation.
- Listing draft, marketplace category mapping and required item specifics.
- Alerts, watchlists, reporting and niche-specific analytics where supported.
- Explicitly label integrations that are researched/planned but not connected; no simulated controls.

### D. Sitemap and navigation
- Entry route, home/dashboard, scan route and one-tap global Scan access.
- Inventory, item detail, valuation, listing editor, eBay Hub, orders and settings.
- Niche-only tools and their route ownership.
- Back navigation and deep-link behaviour.
- A branded niche build must not expose another niche's routes, prompts or inventory.

### E. Data contract
- Canonical niche ID and specialist IDs.
- Required fields, optional fields, units, validation and persistence mapping.
- Item-specifics mapping to marketplace category aspects.
- Migration/compatibility rules for legacy specialist IDs.
- Tenant ownership and row-level authorization.
- Stable IDs, media references, lifecycle status and sync behaviour.
- Unknown/ambiguous records remain unclassified until reviewed; never mass-assign by guess.

### F. Marketplace and listing rules
- Supported marketplaces and country site.
- Category resolution strategy and required/recommended aspects.
- Title, description, condition and item-specific rules.
- Shipping/fulfilment, return and payment policy dependencies.
- Restricted/prohibited product handling.
- Draft, publish, revise, end, retry and reconciliation tests.

### G. Commercial intelligence
- Relevant sold-data sources and their limitations.
- Comparable matching criteria and evidence quality.
- Typical fees, postage, repairs, packaging, labour and acquisition costs.
- Net-profit and margin calculations.
- Confidence-aware buy recommendation and manual override behaviour.
- No fabricated sell-through, time-to-sale or profit certainty.

### H. Isolation and entitlements
- Route and bundle isolation.
- Specialist allow-list and legacy alias handling.
- Inventory/query filters fail closed for empty or unknown scope.
- User/tenant subscription entitlement checked server-side.
- eBay account and listing ownership remains tenant-scoped.
- Master Admin may inspect all niches; a niche subscriber may not cross into another niche.

### I. Test and certification pack
- Unit tests for specialist fields, prompt routing, confidence and safety rules.
- Capture → identify → correct → save → inventory persistence.
- Inventory read/edit and niche isolation.
- Valuation evidence and fee/profit calculation.
- Listing create/edit/save/category/aspects/publish/revise/end.
- eBay sync, orders and app/web parity.
- Branded route tree and APK/package inspection.
- Device acceptance and explicit live integration result.
- Version, commit SHA, workflow URLs, test results, known limitations and approval.

## 3. Current niche register

The canonical product registry is `niche-modules.json`; client presentation and specialist configuration are in `constants/niches.ts`; specialist expertise is in `shared/specialistIntelligence.ts`; server specialist ownership is adapted by `supabase/functions/_shared/specialistRegistry.ts`.

| Product / canonical ID | Canonical specialists | Current source evidence | Pack gap / caution |
|---|---|---|---|
| Coin Flipper / `coins` | coins, islamic_silver, banknotes, gold, silver, jewellery_precious_metals, ancient_artefacts | Dedicated routes, specialist profile, Numista/Islamic workflows, coin module manifest and brand artwork | Coins module says bundle isolation migration started; keep legacy specialist aliases explicit. |
| Flipper MX / `motocross` | motocross | Dedicated specialist profile, part/bike modes, capture guidance and branded config | Validate part-vs-complete-bike listing specifics and fitment uncertainty end-to-end. |
| Bike Flipper / `bicycles` | bicycles | Specialist profile and product config, capture/measurement guidance | Verify component taxonomy, compatibility claims and mechanical test evidence. |
| Threads Flip / `clothing` | clothing, trainers_sneakers | Dedicated specialist profile, clothing module manifest, garment attributes and brand artwork | Verify eBay Department, Style, Outer Shell Material and all category aspects survive save/edit/publish. |
| Card Flipper / `trading_cards` | pokemon_cards, trading_cards | Specialist profile, card grading service/tests, brand artwork | Do not claim numeric professional grade; verify raw/slab separation and category aspects. |
| Antique Flipper / `antiques` | antiques, books | Specialist profile, marks/provenance fields and brand artwork | Confirm full production workflow, mark evidence, condition and restoration fields persist. |
| Fossil Flipper / `fossils` | fossils | Specialist profile, specimen capture and provenance cautions, brand artwork | Confirm complete identification, valuation, listing and inventory path; no age/species certainty from image alone. |
| Beauty Flipper / `beauty` | beauty | Specialist profile, packaging/expiry and safety screening, brand artwork | Safety/recalled/expired/counterfeit checks must block unsafe listings; external recall/batch lookup is not claimed integrated. |
| Tech Flipper / `tech` | tech, retro_games, retro_consoles | Specialist profile, exact-model/test prompts and activation-lock guard, brand artwork | Verify test checklist, accessories, lock state and category aspects; photos cannot prove working condition. |
| Surplus Flip / `surplus_flip` | surplus_trader | Dedicated manifest/decomposition/buying workflow and auction engine/tests | Brand artwork/module manifest and full bundle-isolation certification need explicit verification; protect quantity/yield uncertainty. |

### Registry consistency rules

- `niche-modules.json` is the canonical package/specialist registry. Server copy `supabase/functions/_shared/niche-modules.json` must stay byte-for-byte semantically aligned and be covered by a drift test.
- `constants/niches.ts` is presentation/capture configuration, not a second authority for specialist ownership.
- Only `niches/coins/module.json` and `niches/clothing/module.json` currently exist as module manifests in the audited tree. They are migration-started and explicitly not yet bundle-isolated. Do not imply all ten have complete manifests.
- Brand artwork exists under `assets/images/brands/` for coin, MX, bike, Threads, card, antique, fossil, beauty, tech and tool. A dedicated Surplus Flip artwork file was not present in the audited tree.
- `docs/` contains static niche landing pages for coins, motocross, bicycles, clothing and surplus. The current branded web workflow exports the Expo app; a separate independent website implementation and full app/web parity are not certified by this repository audit.

## 4. Production gates and release status

A niche can be called **Pack Defined** when A–I are documented. It can be called **Build Verified** only when branded route/config checks and the actual APK bundle/package checks pass. It can be called **Workflow Verified** only when capture-to-inventory and draft lifecycle tests pass. It can be called **Live Integration Verified** only after controlled test-account eBay operations and reconciliation succeed. It can be called **Production Certified** only when all gates pass and the evidence is attached to the pack.

Required gates:
1. Registry integrity: canonical IDs, specialist IDs, aliases and client/server registry parity.
2. Isolation: wrong-niche routes and records are absent; unknown/empty filters fail closed.
3. Specialist quality: structured fields and confidence/safety gates work for the niche.
4. Data persistence: no field loss through create, edit, save, reload and web/native.
5. Valuation: evidence provenance and fees are explicit; no invented sold data.
6. Listing: verified leaf category, required aspects, seller policies and full lifecycle.
7. Security: tenant authorization and secrets are server-only.
8. Release: lint, typecheck, complete regression, branded builds, APK inspection and device smoke test.
9. Live integration: explicitly approved sandbox/test-account eBay operation, then reconcile remote and local state.
10. Operations: monitoring, failure recovery, rollback and owner sign-off.

## 5. Known cross-cutting blockers from the existing engineering audit

These are carried forward as known risks, not silently marked resolved by this document:
- Tenant membership provisioning and credential-column grants require a proper security-boundary review.
- Empty specialist filters previously fell through to all-tenant inventory; account/niche request fencing and consistent polling need verification.
- Listing status and inventory status could disagree; sync must not mark a listing ended after a failed/partial fetch and must update the exact external listing.
- Finance fee aggregation and order-note side effects require reconciliation.
- Listing generator/editor had documented non-coin defaults and item-specific persistence gaps; test all niches.
- Messages could report local success after external send failure; this must not be accepted as a successful lifecycle event.
- Existing CI green status is not equivalent to live eBay or physical-device acceptance.
- Separate website parity remains unverified.

Refer to `docs/SWISH_ENGINEERING_AUDIT.md` and `docs/SPECIALIST_IMPLEMENTATION_REPORT.md` for the dated evidence and scope limits. Re-audit these findings against the current main branch before treating any as still present or fixed.

## 6. Implementation sequence

1. Add automated consistency checks for the two niche registries and pack completeness.
2. Build a read-only Production Pack status view in Master Admin from repository/config/test evidence; do not add a new database just for status.
3. Complete missing manifests using existing config and specialist profiles as inputs, without duplicating their authority.
4. Fix cross-cutting tenant, inventory, sync and listing persistence blockers before expanding features.
5. Certify one niche at a time through the same shared workflow, then run the shared regression suite against all ten.
6. Only after evidence is green, mark the niche Production Certified and package the matching APK/web release.

This standard defines what must be true. It does not claim that all ten niches currently satisfy it.
