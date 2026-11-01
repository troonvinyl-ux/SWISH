# SWISH Modular Production Readiness — Master Builder Directive

## Mission

Make the existing SWISH platform production-ready through a controlled, evidence-led modularisation programme. SWISH Control and `docs/SWISH_FOUNDATION_MASTER_REGISTER.json` are the operational source of truth for progress. This directive is the builder's instruction set; the register records execution state and evidence.

Do not stop after an audit or plan. Work through the stages in dependency order, complete independent tasks while blockers are investigated, and resume blocked work when its dependency is resolved. Do not claim production readiness without the required evidence.

## Non-negotiable constraints

1. Do not rebuild SWISH from scratch.
2. Do not create another database, authentication system, duplicate niche registry, duplicate eBay engine, or competing shared service.
3. Preserve the existing OnSpace/Supabase-compatible backend, auth, tenant model, inventory IDs, database, storage, subscriptions and lifetime entitlements.
4. Preserve the existing eBay OAuth, encrypted credential handling, token refresh, listings, drafts, orders, messages, finance and sync architecture. Credentials remain encrypted and server-only; no secrets in client code, logs or API responses.
5. Keep niche data, specialist IDs, routes, permissions, AI prompts, inventory and marketplace operations isolated.
6. Do not replace working flows with mock buttons, demo data or decorative UI.
7. Do not merge failing, stale, unreviewed or dependency-blocked pull requests. Never force-push or bypass required checks.
8. Do not trigger a native APK rebuild for every small UI or JavaScript change. Use type/lint/unit/web/OTA checks where appropriate; reserve native builds for native changes and release milestones.
9. Never infer that source code, a green CI run, or a successful build proves live integration or real-device readiness.
10. If a task is blocked by external access, secrets, billing, approvals or unavailable hardware, record the exact blocker, evidence and owner/action needed. Continue independent work.

## Six architecture foundations

### Foundation 1 — SWISH Core (all niches)
Shared authentication and tenancy; trusted permissions and entitlements; existing database and storage; shared AI and image capture; scanner framework; inventory services and UI primitives; eBay connectivity/OAuth/listing/order/message/sync; pricing, fees and profit; notifications, settings, navigation and reusable components.

### Foundation 2 — Standard Resale Workflow (all niches)
Scan; identify; confidence and evidence; condition; valuation; buy/don't-buy decision; costs and margin; inventory; listing draft; marketplace category and item specifics; edit/save/publish; sales, fees and profit.

### Foundation 3 — Niche Specialisation (all niches)
Niche identity and terminology; canonical specialist IDs; prompts; capture instructions; images; attributes; condition; measurements; valuation sources; marketplace category mappings; listing templates; inventory configuration and branded presentation.

### Foundation 4 — Advanced Intelligence (selected niches)
Catalogue matching, historical market analysis, advanced grading, comparables, evidence/confidence scoring and trends only where they materially improve a niche.

### Foundation 5 — Specialist Business Tools (selected niches)
Bulk imports, batch identification, manifest processing, bulk listing, advanced stock, acquisition calculators, repair/refurbishment costing, reports and buying recommendations only where required.

### Foundation 6 — Unique Niche Engines (only where needed)
Examples: Islamic/ancient/silver coin analysis; Surplus manifest intelligence; Antique maker marks and provenance; Fossil species/geological analysis; MX mechanical assessment; Threads authentication/fashion intelligence. Do not add a specialist engine merely to make products look different.

## Seven execution stages

1. **Full architectural audit:** map entry points, routes, niche registry, services, hooks, backend/Edge Functions, database dependencies, eBay flows, security boundaries, tests, deployments and every open PR. Identify functional, partial, demo-only, missing and externally unverified areas.
2. **Foundation architecture and registry:** define module boundaries and contracts using the existing `niche-modules.json` and current service structure. Add typed dependencies and regression tests. Do not create a second registry.
3. **Foundation 1 — SWISH Core:** verify and close shared core gaps across auth, entitlements, storage, AI, capture, inventory, eBay, pricing, notifications and navigation.
4. **Foundation 2 — Standard resale workflow:** verify one complete scan-to-sale workflow end-to-end for each supported niche.
5. **Foundation 3 — Niche specialisation:** complete and certify each niche's specialist behaviour, data isolation, routes, categories, listing templates and UI.
6. **Foundations 4–6 — Optional specialist capabilities:** add only niche-justified advanced intelligence, business tools and unique engines; test that optional modules cannot leak into unrelated niches.
7. **Full production verification:** run type/lint/unit/integration/regression/security tests; verify backend contracts and entitlements; verify web parity; build and inspect native packages at release milestones; test real devices and live integrations; close critical/high defects; publish an evidence-backed release verdict.

## Registered niche source

The canonical niche list is `niche-modules.json`. Current registry entries include coins, motocross, bicycles, clothing, trading_cards, antiques, fossils, beauty, tech and surplus_flip. Always discover the current registry dynamically; do not hardcode this list as permanent.

A registered niche is not automatically a production-ready niche. Every niche must pass its own certification matrix.

## Mandatory niche certification

For each registered and supported niche, verify:
- Correct app identity, entry routes, navigation and brand.
- Scanner/capture UX and real identification behaviour.
- Confidence, evidence and uncertainty handling.
- Niche-appropriate condition, attributes and measurements.
- Valuation source quality and distinction between asking prices and realised sold prices.
- Correct canonical specialist IDs and strict inventory/tenant isolation.
- Listing generation, editing, persistence and category-specific item specifics.
- eBay draft/publish/sync behaviour and image/quantity/delivery handling.
- Orders, fees, finance attribution and profit calculations.
- Web experience and mobile/native experience.
- Entitlements, server-side authorization, RLS and credential security.
- Automated regression tests and real-device/live acceptance evidence where applicable.

## Pull request and merge discipline

- Keep a single ordered integration queue for changes targeting `main`.
- Before starting dependent work, identify open PRs touching the same files/services and record dependencies in the task register/PR body.
- Before merge, compare the PR head with the latest `main`. If it is behind, update/rebase it and rerun all required checks on the resulting head SHA.
- Verify all required check-runs are complete and successful, review comments are resolved, required approvals are present, conflicts are absent and dependencies have merged in the intended order.
- A PR with failed checks remains open and visible as FAILING/BLOCKED. Do not work around it by merging a later conflicting change.
- After merge, verify the merge commit and run regression checks against the resulting `main`.
- No automatic merge is permitted merely because GitHub reports `mergeable=true`.

## Mandatory SWISH Control register protocol

The builder MUST keep `docs/SWISH_FOUNDATION_MASTER_REGISTER.json` current throughout execution:
1. Before work, select the relevant task IDs and set them to IN PROGRESS.
2. Record the branch and PR number in the relevant task evidence/change log (extend the schema additively if necessary).
3. After implementation, set status to IMPLEMENTED; after tests start, TESTING.
4. Set VERIFIED only after acceptance criteria pass and evidence is recorded (commit SHA, CI run/check URL, test result, live/device evidence as appropriate).
5. Set BLOCKED with exact reason and next action when blocked.
6. Update the relevant stage status only when its tasks justify it.
7. Append a dated changeLog entry for every meaningful progress update.
8. Never delete failed work, unresolved blockers, historical evidence or earlier decisions. Correct records transparently.
9. PR descriptions must include task IDs and remaining verification steps.
10. At each handoff, report current stage, completed task IDs, open blockers, active PRs, exact next actions and whether a merge or native build is required.

SWISH Control is the progress dashboard. The JSON register is the canonical task-state record; GitHub is the source of truth for code, PRs, commits, reviews and CI. The builder must not mark a task complete based solely on its own narrative.

## Completion standard

The programme is complete only when all seven stages are VERIFIED, every supported niche passes its mandatory certification matrix, all required automated/security checks pass, there are no unresolved critical/high defects, and external dependencies are either verified or explicitly excluded from the release claim. Any unverified live integration, deployment, signing or device behaviour must remain clearly labelled as unverified.

## Required final handover

Provide a concise production report containing:
- Overall verdict and verified readiness percentage.
- Stage-by-stage and niche-by-niche status.
- Every open blocker and its owner/next action.
- Open/merged PRs and the commit SHAs tested.
- CI, security, web, native and device evidence.
- Outstanding external verification dependencies.
- The exact next action.