# SWISH niche standardisation and isolation

## Status

Implementation applied to the existing shared engine; production acceptance remains OPEN. No databases, storage buckets, auth clients or niche routes were replaced. SQL observations below were executed here; Jest, TypeScript, installed-device, separate-subscriber and live eBay tests were not executed in this session.

## Findings and changes

| Finding | Root cause | Focused correction |
|---|---|---|
| Legacy specialists resolved differently between public getters, inventory and backend | Some getters used canonical-only lists; new-save logic recognised only one clothing alias | `getNicheSpecialistIds` now returns an independent canonical + historical alias list. `canonicalProductionSpecialist` canonicalises new writes within the same owner; historical rows remain untouched. AI result checks use registry ownership, not a separate hard-coded list. |
| Ordinary capture and Quick List had different component/reverse requirements | Two implementations of role selection | `nicheCaptureService` is the single role selector. Both hooks retain the configured specialist evidence; MX/Bike parts keep exact part number, reverse, mounts and damage views. Music retains its disc-count/label workflow. |
| Capture save performed a second media link after the photo writer | Legacy wrapper wiring after shared persistence was introduced | Ordinary capture calls `persistCapturedItemPhotos` once with fixed tenant/item IDs and uses its verified completeness result. Required views are checked for every niche before initial save. Retained identification and retry state remain intact. |
| Barcode/confidence rules could drift between workflows | Lists/thresholds repeated in separate files | Byte-identical `shared/nichePolicy.ts` deployment asset supplies barcode capability and existing thresholds. Quick List, barcode/photo corroboration and server publication use it. Coins cannot call retail `barcode_lookup` even with a hand-crafted request. |
| Conflicting camelCase/snake_case IDs could evade an Edge resource check | Checking the first alias but leaving the other alias available to a handler | `moduleRequestContract` rejects inconsistent scalar and batch IDs, validates all supported resource aliases and passes consistent identities to existing handlers. Tenant, active-module entitlement and parent RLS checks remain required. |
| Lifecycle history, listing verification and shipments had tenant-only child policies | Canonical parent scope was not enforced on these child tables | Added restrictive SELECT/INSERT/UPDATE/DELETE policies for the authenticated role; every child must reference a parent visible through current-module RLS. No permissive grants were added. Existing service-role fulfilment/verification and owner reporting remain intact. Valuations already had a parent SELECT restriction and were not changed. |
| Inbox duplicated backend operations and could retain another module's results | UI-owned query/mapping/sync/reply logic with tenant-only dependencies | Existing `ebayMessageService` is now consumed through one scoped provider/hook. Read/archive errors remain visible; replies require actual provider confirmation. Inbox scope changes immediately clear the view/composer; stale callbacks cannot update the new workspace. Suggested replies are explicitly templates and do not invent dispatch status. |
| Orders could display late results from the previous module | No shared operation token or read-version guard | Existing order/fulfilment services and features retained. Scope-keyed screen instances, shared operation guards and read versions reject late callbacks; existing Edge import/dispatch requests also carry the niche ID. |
| Broad category/substrings could classify unrelated imports as Coins | `Other Collectables` treated as coin evidence; numeric IDs matched inside larger numbers | Removed the broad coin shortcut for new imports. Numeric path IDs match whole tokens. Shared category/title corroboration rejects contradictions; defaults derive from the canonical registry. Existing taxonomy and review flows remain. |
| New policy mirrors could silently drift in a build | Deployment validation did not cover the new contracts | Extended existing mirror sync/deployment gates, plus a twelve-niche source verifier and regression workflow. |

## Shared service map

All modules retain the existing unique `getSupabaseClient`, AuthProvider and tenant/module activation path.

- Authentication/access: `template/auth`, `moduleAccessService`, `swish_open_module`, trusted owner/entitlement helpers.
- Canonical inventory/reporting: `itemService`, `canonicalInventoryService`, existing canonical views/count RPC and `swish_command_snapshot`.
- Camera/evidence: `PremiumScanner`, shared camera hooks, `nicheCaptureService`, existing retained capture drafts.
- Photos/storage: `photoPersistenceService`, `originalImageService`, `sharedImagePreparationService`, `smartStudioStorageService`, existing `item-images` bucket. Originals, processed assets, hashes and roles remain distinct.
- Listings/publication: `listingService`, `listingEditorService`, publication/readback services and existing eBay Edge/RPC lifecycle.
- Orders: existing `orderService`/`coinInventoryService` fulfilment adapters and eBay order/reconciliation Edge Functions. A legacy file name does not imply a separate coin-only database.
- Messages: existing `ebayMessageService` + `EbayMessagesProvider`/`useEbayMessages` for all niches.
- Sync: existing niche-scoped eBay sync/import functions and identity guards.
- Monitoring/errors: existing shared request governor, Quick List timing events, Edge logging, verification and consolidated Minority Report; no second dashboard or telemetry database.

## Preserved niche expertise

Prompts, taxonomy, valuation methodology, listing guidance, reference sources and fields remain in `constants/specialists.ts` and the existing specialist profiles. Current eBay category aspects remain authoritative for required item specifics; static profiles never substitute for live taxonomy.

| Niche | Default specialist | Barcode | Quick review / server publish minimum |
|---|---|---|---|
| Coins | coins | Disabled; numismatic/Numista evidence retained | 0.95 / 0.95 |
| Collectibles | collectibles | Starts with barcode; visual corroboration still required | 0.70 / 0.30 |
| MX | motocross | Disabled | 0.70 / 0.30 |
| Bikes | bicycles | Disabled | 0.70 / 0.30 |
| Threads | clothing | Optional for relevant retail products | 0.70 / 0.30 |
| Cards | pokemon_cards | Disabled | 0.70 / 0.30 |
| Antiques | antiques | Disabled | 0.70 / 0.30 |
| Fossils | fossils | Disabled | 0.70 / 0.30 |
| Beauty | beauty | Optional | 0.70 / 0.30 |
| Tech | tech | Optional | 0.70 / 0.30 |
| Surplus | surplus_trader | Optional | 0.70 / 0.30 |
| Tunes | vinyl_records | Optional | 0.70 / 0.30 |

These preserve different existing review paths, not verified accuracy percentages. Observation-only identification, specialist safety, missing images/specifics and marketplace compliance still block their respective workflows. No Numista model or identification prompt was changed.

## Executed backend observations

- All twelve registered default specialist mappings matched their expected SQL niche owner.
- Collectibles resolves to Collectibles; Coins resolves to Coins; clothing/MX historical aliases resolve to their original owner. Generic `curiosities_collectibles` remains unclassified.
- No-session Coins and Collectibles access checks returned denied.
- Twelve new restrictive child policies installed, four per affected table. Installed-schema assertions passed.
- No cross-tenant item/listing/order/valuation relationship mismatches were observed in the baseline.
- Canonical projection has zero duplicate tenant/item IDs. `attributes.niche_id` conflicts: zero.
- Before and after: **763 canonical records**, **758 with media**, **5 without media**. No production items/media were rewritten or deleted.
- Stored original objects: **15**; linked to the same canonical item: **13**; **2 unlinked** retained for review. One ambiguous historical eBay identity group and 12 unclassified records remain; none were merged/reassigned.
- New `_photo_pipeline` records: **0** at audit time. This is important: existing reference observations do not prove a new capture/save completed end to end.
- A broader authenticated-role/no-JWT table-read attempt returned a backend error. It is **NOT counted as passed**. No Postgres error logs were returned. Independent subscriber-role tests remain required.

### Existing niche/media baseline

| Niche | Canonical records | With persisted media |
|---|---:|---:|
| Coins | 460 | 459 |
| Collectibles | 8 | 5 |
| MX | 2 | 2 |
| Bikes | 2 | 2 |
| Threads | 3 | 3 |
| Cards | 0 | 0 |
| Antiques | 2 | 1 |
| Fossils | 0 | 0 |
| Beauty | 0 | 0 |
| Tech | 3 | 3 |
| Surplus | 270 | 270 |
| Tunes | 1 | 1 |
| Unclassified history | 12 | 12 |

Zero stock in a niche is not proof that its capture/listing flow works.

## Isolation and compatibility boundaries

Subscriber item/listing/order/message visibility remains tied to the server's active tenant/niche session and entitlements. Read aliases are not authorisation. Shared account settings and seller connector configuration intentionally remain tenant-wide. Owner platform reporting deliberately has its existing trusted-owner scope.

Existing `item-images` assets use public URLs for eBay and presentation. Possession of an existing public image URL is not a protected-file guarantee; this change does not migrate the public bucket or claim otherwise. Canonical inventory/marketplace metadata remains RLS controlled.

The same React Native services/views supply mobile and Expo web. No second web data model was introduced. Cross-platform visual and authenticated-session equivalence remains unverified until tested.

## Cleanup retained pending verification

- Bespoke Coin/MX/Bike/Threads screens and all registered dedicated routes remain. Their specialist functionality was not removed.
- `nicheCategoryService` retains its richer category table while sharing conservative corroboration with Edge imports. Do not replace the full classifier until representative category fixtures and live imports pass.
- Unused `getActiveNiches`/`getPrimaryNiche` fallback helpers, old test-local identity implementations and unregistered compatibility routes are retirement candidates, not deleted features.
- Other legacy page-owned operational logic remains a progressive consolidation candidate. The current focused change is not a claim that every historical screen has been rewritten.

## Acceptance and reproducible checks

Added/updated executable regressions cover all twelve canonical configs, historical aliases, cross-niche route rejection, shared photo roles, music/component roles, barcode exclusion for coins, contradictory import evidence, alias bypass attempts, scoped message confirmations and existing photo save/restart mocks. Mocked photo tests verify readback on the same item and no repeated upload, but do not operate a real camera.

Run the `Shared niche standardisation and isolation` GitHub workflow for source parity, TypeScript and selected pure/mocked tests. Read-only SQL assertions: `supabase/tests/niche_standardisation_readonly.sql`. Store its output with the source SHA; do not label static/mocked checks live acceptance.

For **each** registered niche and installed platform:

1. Use an entitled subscriber in tenant A; retain an independent tenant B and unrelated-niche session.
2. Capture every required role, identify using that niche's specialist, save, and record the canonical ID.
3. Verify the persisted row contains original URLs/roles; reopen after navigation and a process restart.
4. Open the existing draft/editor and confirm the same canonical assets are available.
5. Query/search/import through the normal authenticated API and UI; ensure unrelated tenant/niche rows are absent. Verify explicit denial with supplied unrelated IDs and alias conflicts.
6. For Collectibles, test barcode match, contradictory variants and photo fallback. For ancient coins, verify no barcode screen/route and exercise the existing Numista workflow.
7. Verify orders/messages/returns/shipments and Minority Report agree with the same canonical ID/counts on mobile and Expo web.
8. Only with explicit approval, publish a real listing and record eBay readback; retry/restart must not create another item/listing or upload originals again.

All device/subscriber/publication rows in `SWISH_NICHE_STANDARDISATION_EVIDENCE.json` remain NOT TESTED. Production acceptance cannot be closed in this tooling session.
