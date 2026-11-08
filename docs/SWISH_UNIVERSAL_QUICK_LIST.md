# SWISH Universal Quick List — implementation and measurement register

## Status

Implementation delivered; performance and end-to-end acceptance **not verified**. The under-60-second objective is a target, not an achieved result.

Read-only backend baseline in this session: **0 timing events, 0 server live confirmations, 0 v2 timing events**. Median and 90th-percentile app-open-to-confirmed-live times are **not measured**. No camera captures, paid provider calls, real inventory mutations, live publications, builds or executable tests were performed by this editor session. CI and installed-app testing remain required.

## Shared workflow

Every registered niche exposes Quick List from its shared home and Identify tab. The original specialist scanner remains available through the scanner selector; bespoke tools and routes are not removed. The same auth, paid module access, canonical inventory, item-images bucket, photo writer, AI identification, market valuation, listing generator, editor RPC and eBay publication services are reused.

1. Open the niche and tap Quick List.
2. Capture its existing required evidence views using the shared camera/retention services. Front/reverse evidence is additive; existing label, condition, component and disc-count requirements are not dropped.
3. Collectibles starts in barcode mode, with explicit no-barcode fallback. Coins never require or expose this retail-barcode path. Clothing, Beauty, Tech, Tunes and Surplus offer optional product barcode scanning.
4. Run the chosen registered specialist against untouched originals. Only specific barcode leads are retained. Brand/model/variant or photographed GTIN corroboration is required before catalogue specifics are reused.
5. Once identification is available, resolve category requirements while saving the canonical identity. Upload/link originals, generate copy and retrieve market evidence concurrently where independent.
6. Review in the same workspace. Select an actual supported condition; resolve missing required specifics and any specialist safety concerns. No missing value or positive price is invented. A failed valuation allows a researched seller-entered price, not fabricated market evidence.
7. Tap **Approve Review & Publish Live** to save approval and use the existing publication pipeline. **Save review only** remains available.
8. Count completion only after eBay active status/valid quantity, saved external listing identity, text/price comparison and canonical item/photo reconciliation agree. Unknown outcomes expose a read-only check, not resubmission.

## Implemented optimisations

| Problem / root cause | Focused change | Principal files | Validation status / remaining risk |
| --- | --- | --- | --- |
| Only Coins and Collectibles had Quick List | Drive all registered niches from existing configurations; keep advanced scanner | shared/quickList.ts, services/quickListPolicyService.ts, hooks/useQuickList.ts, app/(tabs)/scan.tsx, components/feature/ModuleHome.tsx | Registry/required-role tests authored, not run. Test each niche on installed devices. |
| Two-image cap ignored some niche evidence | Role-aware capture selector, original required slots, up to eight photographs, MX/Bike component mode and Tunes CD/box-set views | quickListPolicyService.ts, QuickListWorkspace.tsx | No requirement reduction. More complex stock may legitimately exceed 60 seconds. |
| Optional BackgroundErase completion blocked review | Detach optional cleanup from draft/review/publication; link accepted copies to originals separately | hooks/useQuickList.ts | Source review confirms no critical-path await of optionalStudio. Device timing and concurrent metadata behavior need tests. |
| Duplicate Taxonomy aspects requests | Forced-live aspects response validates selected leaf while conditions run independently; five-minute successful preparation cache scoped to user/tenant/niche/category | services/quickListService.ts, quickListReuseService.ts | Existing publication preflight still fetches live requirements; ambiguity/errors fail closed. API contract and licensing remain external risks. |
| Failed generation/value promises persisted across retries | Bounded, success-only reuse keyed by session and semantic identity/evidence; failed work is evicted | quickListReuseService.ts, quickListService.ts | Retry/TTL/isolation tests authored, not run. No offline catalogue is created. |
| Original uploads unnecessarily serial | At most two immutable original uploads concurrently, then shared metadata merge/readback | services/photoPersistenceService.ts | Existing partial-upload, role-order and restart mocked tests retained. Mobile memory and actual storage retries need device tests. |
| Barcode catalogue confused with observations | Keep source/acceptance history per attribute, reject unresolved variants, seed only supported known specifics, save final seller approval | quickListPolicyService.ts, quickListService.ts, QuickListWorkspace.tsx | Sources describe provenance, not independent accuracy or authentication. Specialist safety gates and contradiction checks remain. |
| Duplicate manual confirmation and telemetry on critical path | One explicit Approve & Publish action; asynchronous serial milestone checkpoints; save-only and unknown-outcome recovery remain | hooks/useQuickList.ts, quickListTelemetryService.ts | No unattended publishing. Installed-device cancellation, navigation and timeouts require acceptance. |
| Draft completion missing; retry timestamps changed elapsed time | Add TD (draft), TP (provider response), first-occurrence stage timestamps, failure records and manual-intervention counts | shared/quickList.ts, hooks/useQuickList.ts, quickListTelemetryService.ts | Stages are not presumed sequential: parallel work can finish in either order. Historical rows may lack stages. |
| Timing retrieval lacked scope-specific query index | Add tenant/niche/event/time composite partial index only | supabase/migrations/20261113_quick_list_telemetry_index.sql | Index installed. Existing records/RLS unchanged. |

## Provenance and inventory integrity

- Source categories: barcode catalogue, photograph, specialist identification, external catalogue and user confirmation.
- Inferred or uncorroborated proposals stay distinguishable and are not treated as established required specifics.
- Known specialty fields map through existing specialist descriptors to the current eBay schema; unsupported selections remain blank.
- Seller-approved values are appended to the existing canonical item's `_quick_attribute_sources`, with optimistic concurrency. Photo metadata and unrelated seller fields are merged, not replaced.
- One capture session retains one canonical item ID. Publication uses the saved draft and its linked item; it never calls createQuickInventory to represent a marketplace listing.
- Quantity is explicit and does not spawn unrelated products. Confirm actual sellable units for bulk stock; use the existing manifest workflow for manifest acquisition/inspection.
- Original photographs are retained before analysis, uploaded through the shared content-addressed writer and checked against canonical media. Optional cleanup remains separate from identification and condition evidence.
- A recovered scan requires explicit resume and fresh approval. Its previous timer is not restarted to manufacture a new fast result.

## Timing contract

| Stage | Meaning |
| --- | --- |
| T0 | Earliest available Expo JS initialization / latest foreground notification |
| T1 | Quick List session opened |
| T2 | Capture or barcode scanning started |
| T3 | Successful identification completed |
| T4 | Successful valuation completed; absent on failed/unavailable value |
| TD | Draft ready after stored originals/roles and saved draft readback |
| T5 | Required review saved and approved |
| T6 | Actual marketplace submission started after existing preflight |
| TP | Publication/check response returned |
| T7 | Confirmed active external listing and canonical reconciliation |

App-open elapsed time is T7−T0. This JS clock is **not native process-start measurement**; full cold launch must also be timed externally during device acceptance. Timers continue across retries rather than resetting. Resumed historical scans are not labelled fresh under-60-second runs. Subsequent stock in the same foreground period retains the actual foreground baseline; capture-to-live stage metrics explain additional work separately.

The metrics panel reports median and nearest-rank p90 for confirmed-live totals, stage durations, within-60-second ratios, barcode/AI workflow match rates, failures and manual interventions. Workflow match percentages are not independent identification accuracy. Manual intervention counts include explicit alternative selection/retry and each distinct edited field once per session, not every typed character. Milestone snapshots are serialized so an older delayed insert cannot outrank a newer final outcome. Live totals require a matching server-generated `quick_list_live_confirmation` event. Retrieval is tenant/niche-scoped and explicitly reports its latest-5,000-event window/truncation.

## Acceptance required before a speed claim

Use listing-ready physical stock and an authorized connected seller account. Record installed app platform/version, actual device, cold/foreground launch baseline, niche, canonical item ID, draft ID, external listing ID, stage timestamps, failure/retry evidence and user approval. Verify physical attribution/edition, condition, original photo roles, persisted inventory, reopened editor and live eBay content. Review eBay-transformed image URLs using marketplace evidence rather than assuming byte-for-byte URL equality.

Test all twelve registered niches: Coins, Collectibles, Motocross, Bicycles, Clothing, Antiques, Trading Cards, Fossils, Beauty, Tech, Tunes Flip and Surplus Flip. Include no barcode, exact match, multiple variants, missing required fields, unavailable valuation, failed front/back upload, restart/resume, niche/tenant switch, duplicate taps, cancellation and accepted-but-unreconciled publication. Test music pressing/media/sleeve grades and complete disc evidence, plus restricted Beauty/locked Tech cases. Do not relax these gates to improve the timing distribution.

Run `.github/workflows/universal-quick-list-verification.yml` to collect TypeScript and mocked/pure regression artifacts. This does not substitute for iOS/Android camera/restart or approved live-seller tests. Report sample size, median, p90 and failures only after real evidence exists.

## Remaining blockers

- TypeScript/CI execution and native build verification not available in this editing session.
- Installed iOS/Android and Expo web camera, restart and memory acceptance unrun.
- Real catalogue/Taxonomy/condition responses and provider availability/licensed data access need confirmation.
- Representative independently checked niche specimens/products and approved live seller stock required.
- Native cold-launch measurement and end-to-end timing dataset absent: median/p90 remain null; under-60-second target unverified.
