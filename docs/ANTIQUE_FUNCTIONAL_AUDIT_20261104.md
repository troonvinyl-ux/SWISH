# Antique Flipper — functional audit, repairs and verification

Date: 2026-11-04. Final acceptance: **NOT VERIFIED / NOT PRODUCTION-READY**.

The requested capture → identify → value → category → specifics → draft → publish → inventory reconciliation workflow has **not** been executed end to end. No real listing was published. No production inventory was edited or deleted by audit tools. This report separates source repairs, executed database checks and unexecuted acceptance tests.

## 1. Source baseline and access

Inspected public GitHub main through its commit API: `213f306e48f564e8408a77e43eafe25bf1ae5d6a` (Add verified module entry access hook). Compared pinned raw versions of `hooks/useListingEditor.ts` and `app/antique-capture.tsx` with the current OnSpace implementation. Retained newer module entry, shell, footer and account edits. No pull request merged; no signing credentials, app identifiers or release configuration changed. Current edits are workspace changes; no new commit SHA is available from this editor.

Observed GitHub run [41914881811](https://github.com/troonvinyl-ux/SWISH/actions/runs/41914881811) on that baseline: dependency install, canonical checks and lint succeeded; **TypeScript diagnostic gate failed**. Full regression, Edge syntax checks, Deno tests and Android bundling were **skipped**. This existing result is not a test of this session's repairs. Failure annotations/complete compiler logs were not retrieved, so no exact compiler root cause is asserted.

Available execution: read-only database SELECTs, schema/function installation, backend-log queries and public GitHub/documentation reads. Unavailable: shell/Jest/TypeScript execution, authenticated HTTP POST tool, browser/device control, build generation and GitHub workflow dispatch. Backend readiness and configured secrets do not grant this chat an authenticated user session or executable provider-call access. Never send OAuth/session tokens through chat.

## 2. Existing workflow map

| Task | Existing path / implementation |
|---|---|
| Module entry | `/antiques`, `/entry/antiques`; canonical `antiques` registry identity, AppContext verified membership/module activation |
| Dashboard / footer | `app/antique-flipper.tsx`, shared `app/(tabs)/_layout.tsx`, existing More/settings route |
| Multi-view capture | `/antique-capture`, `useGenericCapture`, camera/gallery APIs, existing capture draft service |
| Identification | `aiIdentificationService` → existing `swish-identify` → shared specialist profile / evidence schema |
| Images | Existing `item-images` bucket; JPEG originals, canonical `items.media`; reference imagery stays separate |
| Inventory | Existing `items`, item service, `useInventory`, inventory tab and `/stock-listing/[id]` |
| Human condition | `/antique-condition` now edits canonical `condition` and `condition_notes`, then independently reloads |
| Valuation | `/antique-value` / existing stock panel → `swish-market-value`; saved current estimate/evidence on canonical item |
| Category | Existing `swish-ebay-category` Taxonomy; existing listing-service Taxonomy routes remain available |
| Specifics | Shared editor → `swish_save_listing_editor` atomic existing RPC → `items.attributes.ebay_item_specifics` |
| Category conditions | Existing `swish-ebay-list` now reads eBay REST Metadata condition policies for selected category |
| Draft | `swish-list-generate` → existing `swish_create_listing_draft` → listings table |
| Live publish | Saved editor → `/listing-preflight` → `submitListingToMarketplace` → existing encrypted `swish-ebay-list` / Trading API |
| Reconciliation | Saved eBay ID/status + item transition; existing listing status / sync / browse integration |
| Owner evidence | Existing Master Admin → existing `swish-verification`; added read-only Antique checks, not another application |

Canonical Antique specialists are `antiques` and `books`. Niche identity is derived from specialist registry and server module session; a single broad multi-niche membership does not merge inventory. Tenant/niche RLS and encrypted eBay credentials are preserved.

Existing models are retained: Antique identification/listing generation use the existing Gemini 3 Flash route; valuation's existing Gemini 2.5 Flash model was not silently replaced. OnSpace AI notification was issued. No additional AI provider, key or identification engine was introduced.

## 3. Checks actually executed

IDs below refer to results returned by OnSpace SQL during this conversation. Query reproductions are in `supabase/tests/antique_readonly_audit.sql`; full returned facts are in the companion JSON. All business-data reads used privileged audit access, not a normal subscriber session.

| ID | Actual execution | Observed result / scope |
|---|---|---|
| A1 | Antique aggregate SELECT | **PASS for query**: 1 item, 1 tenant, 1 stored confidence, 0 linked-photo items, 0 valuations, 0 inconsistent niche metadata |
| A2 | Antique listings join SELECT | **PASS for query**: 0 drafts/listings, 0 external IDs, 0 tenant mismatches; empty dataset is not workflow verification |
| A3 | Existing connector metadata SELECT | Connected; can list/publish; fulfillment, return and payment policies selected; stored expiry is future; last sync null; no stored last error. **Not a live eBay round-trip** |
| A4 | Existing editor function inspection | **FAIL source/definition contract**: specifics stored, but `condition_notes` absent; security invoker confirmed |
| A5 | Duplicate and Storage aggregate SELECT | 0 duplicate draft groups, 0 duplicate external-ID groups; **3 original files** under the Antique item's storage path. Duplicates cannot be tested with 0 listings |
| A6 | Role privileges, mappings, RLS | **PASS narrow checks**: items/listings RLS on; anon cannot execute editor/draft RPC; clients cannot grant owner; antiques/books both map to antiques |
| A7 | Actual existing item SELECT | `cb030fae-7d90-4443-8054-0e942a230145`, “Terracotta Stemmed Cup in the Apulian Red-Figure Style”, specialist antiques, review_required, candidate, confidence 0.45, media count 0, valuation_mid 0 |
| A8 | Installed repair postconditions | **PASS definition/privilege checks**: condition notes and original-photo selection now supported, invoker security retained, anon editor denied. Inventory still 1 and Antique listings still 0 |
| A9 | Scope/owner policy postconditions | **PASS narrow checks**: session-scope function remains in authorization path; owner-role insertion and direct module-session updates denied to clients; restrictive paid item SELECT policy present |

Backend queries: Postgres error logs returned none. Recent logs for `swish-identify`, `swish-market-value`, `swish-ebay-category`, `swish-list-generate` and `swish-ebay-list` returned no entries. Live Preview network recorder returned no requests. **No entries is not a passed reliability test or proof that providers ran.**

The storage/photo mismatch is a real persisted-data failure, not inferred from UI. Its original root cause cannot be established from the empty log window. No orphan-photo cleanup or relinking was performed. Use the retained capture upload retry or explicitly reviewed inventory recovery; do not create a second record for the same physical item.

## 4. Source defects repaired

These changes are **IMPLEMENTED, NOT RUNTIME-VERIFIED**, except A8's installed RPC definition checks.

| Repair | Root cause | Focused repair |
|---|---|---|
| R1 Capture valuation | Antique scanner exposed save but not its existing valuation action; unsaved research supplied no image | Added review-stage valuation/evidence display; passes an original in-memory image to existing valuation service |
| R2 Original evidence | Generic path generated and identified an enhanced reference instead of the Antique original | Antique identification now always uses original photographs; does not generate/store coin viewing aids for Antique capture |
| R3 Image format | Uploaded bytes could be PNG/HEIC while labelled JPEG | Antique originals are JPEG re-encoded, then uploaded via web blob / native base64-arraybuffer; failed uploads remain errors |
| R4 Re-identification | Legacy apply discarded valuation with identification's deliberately zero prices and ignored mutation results | Antique-specific apply uses existing canonical item with CAS, retained seller specifics/category, retained valuation, stale-value warning marker and persisted readback |
| R5 Missing review fields | Only AI-returned profile fields were editable, preventing unknown details from being supplied | Antique review exposes all relevant specialist fields, condition notes, quantity and acquisition cost; estimates remain labelled |
| R6 Coin assumptions | Master prompt's coin-heavy mandatory classification conflicted with Antique schema | Antique prompt uses object/book taxonomy, literal marks, cautious maker/period/origin attribution and explicit uncertainty; no coin pipeline change |
| R7 Taxonomy loss | Dedicated aspects adapter cut allowed values at 30 and discarded mode, cardinality, variation and dependency metadata | Retains complete aspect constraints/values; shared normalization preserves these fields |
| R8 Seller-specific persistence | Editor returned success from RPC acknowledgement without verifying the saved record; condition text stored as grade | Existing atomic command preserves grade and saves Antique condition notes, selected originals, condition code and listing options; reads back actual fields before claiming success |
| R9 Category selection | Create-listing category update ignored errors and overwrote stale attribute snapshots | Antique category saving checks taxonomy, uses CAS and readback; reports failure instead of fake selection success |
| R10 Inferred claims | Generic generated specifics treated inferred maker/material as established attributes | Antique generation skips inferred factual fields and returns mapped evidence candidates; category-required fields are completed in editor |
| R11 Publication boundary | Exact category passed through with no live leaf validation; no category-condition retrieval; cosmetic excellent mapped to refurbished | Antique publish/revise verifies live leaf, current required specifics, selected supported condition and original-photo selection. Uses REST Metadata rather than deprecated GetCategoryFeatures. Includes condition description in eBay XML |
| R12 Listing options / media | UI options/photos were not persisted or included in new listing submission | Antique saves format, auction duration/start/reserve, dispatch and Best Offer; server reads saved options. Unsupported subtitle editing is not advertised for Antique. Original media stays unchanged |
| R13 Submission/reconciliation | Draft editor had no direct route onward; publish could claim local success from unchecked/zero-row writes | Added Save & review submission → existing preflight; requires explicit live-publication confirmation; verifies saved external ID, listing status and item state before complete-workflow success |
| R14 Counts / editing | Antique counts could silently return zero on errors/truncated pages; condition page was only a redirect | Paged Antique counts surface errors. Condition page now edits and reloads existing canonical fields. Market Value tile opens actual valuation page |
| R15 Owner visibility | No Antique-specific evidence catalogue | Existing owner-only audit runner/catalogue now reports executed read checks and explicitly NOT TESTED workflow cases |

Shared infrastructure changes were limited to the existing Antique workflow's correctness: no new database/auth/inventory/eBay integration. No niche registry IDs or other niche dashboards/artwork changed. Shared readback, metadata and error-handling fixes are additive; the full regression suite is required to prove compatibility.

Schema command replacement was applied safely to the existing backend. Migration: `20261104_antique_editor_verified_persistence.sql`. It installs the existing function contract; it does not execute any business-record writes. Migration ordering/history must be reconciled with the deployment process; the definition can be reapplied, but the whole historical migration stack was not replayed here.

## 5. Requested verification table

`PASS` means the named check actually ran. `BLOCKED` means an unavailable execution capability/prerequisite prevents the requested test. `NOT TESTED` is not disguised as Pass or Fail.

| Area | Result | Evidence / repair status |
|---|---|---|
| Inventory creation and persistence | **NOT TESTED** | A1/A7 retrieve one pre-existing item; no new-item save executed |
| Inventory editing | **NOT TESTED** | R4/R8/R14 implemented; no approved edit/reload mutation executed |
| Image upload and persistence | **FAIL — observed current data** | 3 original storage files, 0 linked media. R2/R3 repair paths implemented; existing item untouched |
| AI identification | **BLOCKED** | No authenticated image-call execution tool; current item has no linked photos. R2/R5/R6 implemented |
| AI confidence and uncertainty | **NOT TESTED** | Source policy reviewed; no representative new model responses compared with known ground truth |
| AI valuation | **BLOCKED** | A7 valuation is zero; no authenticated actual market request executed. R1/R4 persistence repairs implemented |
| eBay category selection | **BLOCKED** | No authenticated live Taxonomy invocation executed; R9/R11 implemented |
| Category-specific item specifics retrieval | **BLOCKED** | R7/R11 implemented; actual category response not retrieved by this chat |
| Item specifics persistence | **NOT TESTED** | A8 proves installed RPC contract, not edited seller-field round-trip. R8 implemented |
| Listing generation | **BLOCKED** | No authenticated actual `swish-list-generate` invocation executed; R10 implemented |
| Draft creation | **NOT TESTED** | A2/A8 show no Antique draft; approved draft creation/reload still required |
| eBay live submission | **NOT TESTED** | No specific test item/account/price/fees approval; nothing published |
| Listing ID reconciliation | **BLOCKED** | No real Antique eBay ID; R13 implemented, not exercised |
| Listing management | **NOT TESTED** | R11/R13 revision guard implemented; live update/end not run |
| Mobile/web synchronisation | **BLOCKED** | No Android/iOS/browser control or verified current native build artifacts |
| Tenant and niche isolation | **NOT TESTED end to end** | A6/A9 narrow DB role/schema checks PASS; separate-user cross-niche/cross-tenant read/write tests not run |

## 6. Automated regression delivery

Created `services/__tests__/antiqueWorkflow.test.ts`:
- Pure-policy tests: required flags, complete supported values, selection-only validation, malformed metadata, unsupported conditions, missing photos/title/price/quantity, seller precedence and inferred-claim exclusion.
- **Mocked Supabase client** tests: exact atomic payload, condition notes, item specifics/media/options, failed writes/readback and live-metadata gating. These are explicitly not real database/provider evidence.
- Source-contract tests: original re-ID valuation preservation, explicit publication consent, persisted ID/status checks and generated Edge policy parity. These are explicitly not UI/device tests.

Created manual workflow `Antique Flipper functional regressions (no release)` in `.github/workflows/antique-functional-verification.yml`. It executes targeted tests, full existing service suite, TypeScript and shared-asset parity, retains actual JSON/diagnostics and the exact SHA, then fails closed if a gate fails. No release, OTA, eBay action or production record mutation is performed. **Workflow was not dispatched; no new Jest/TypeScript result or artifact is claimed.**

Commands for an executable development/CI environment:

```sh
npx jest --config jest.config.ci.js --runInBand services/__tests__/antiqueWorkflow.test.ts
npx jest --config jest.config.ci.js --runInBand
npx tsc --noEmit
node scripts/sync-backend-registry.mjs --check
```

## 7. Outstanding blockers and limitations

1. **Execution access:** this editor has no terminal, authenticated POST executor or device automation. An owner must run the retained CI workflow and actual app acceptance on installed Android/iOS plus browser. Provide results/artifacts, not credentials.
2. **Test material:** representative multi-view original antique photos with known type/marks/condition must be supplied or captured. The current Antique item has no canonical media links and cannot be assumed safe to publish.
3. **Live publication approval:** specify the exact owned test item, connected account, marketplace, public title/category, price/quantity, acceptable fees, and agreed ending/cleanup procedure. An invented item must not be offered for sale. A Sandbox exercise is distinct from a production published listing. No live publication authorization has been inferred.
4. **Deployment identity:** changed functions are source-ready for the existing OnSpace deployment mechanism, but no deployed version/hash or authenticated invocation has independently confirmed these exact changes. Do not use source existence as a deployment success assertion.
5. **Sold-data access:** Marketplace Insights requires approved access; availability is not established. Seller Hub Product Research is not assumed a public API. Asking prices and ungrounded AI estimates remain separate; absence of authorized sold evidence must be displayed as insufficient evidence, not invented sales.
6. **Editor limits:** existing SWISH supports 25 populated specifics, 65 characters per scalar name/value and 12 selected listing photographs. Full Taxonomy metadata is retained, but multivalue/variation listing creation is not yet implemented or verified. No silent truncation is claimed as complete support.
7. **Auction management:** existing ending architecture is fixed-price-oriented; auction ending must be explicitly checked/repaired before auctions can be certified as the reference workflow. No real end action has been executed.
8. **Accuracy/remaining legacy behaviour:** numerical valuation, maker/date/provenance claims, category suitability, large-inventory behaviour, legacy stock-panel paths and error/rate-limit recovery need representative runtime tests. Shared changes require the full suite. The dashboard still opens the first available item from some shortcut tiles; use Inventory to choose any other item explicitly.
9. **Data repair:** current orphan-photo links remain unresolved on the actual item until the owner reviews and authorizes recovery. No deletion, cleanup or automatic business-record modification was performed.

## 8. Actual end-to-end acceptance procedure (still unexecuted)

A. Approve a real isolated test object and capture originals from front, base/marks, reverse, scale and damage views; save once. Verify the actual ID, tenant, specialist and `items.media` in Cloud.
B. Run real identification. Compare literal marks, object/maker/date/period/origin/style and uncertainties against ground truth; retain the provider response/evidence, not just a success screen.
C. Correct condition and identification. Save/reopen the same item from another authenticated browser/device. Ensure acquisition cost, quantity, photos, identity and uncertainty survive.
D. Run valuation. Inspect sold URLs/dates/currency and active asking context. If sold approval is unavailable, record BLOCKED sold-data acceptance rather than an invented price. Verify stored range, recommendation and labelled evidence.
E. Select a live eBay leaf; fetch its full aspects and Metadata condition policy. Fill mandatory category-dependent values, review optional fields and save all specifics with a distinctive legitimate test value. Reopen and verify exact persistence.
F. Generate the existing canonical draft. Reopen title (≤80), description, category, exact specifics, condition/notes, quantity, price and selected originals. Verify the actual `listings` row and preserved canonical item data.
G. Only after explicit item/account/fees approval: use Save & review submission → existing preflight → approve public publication. Retain real eBay acceptance, numeric listing ID, timestamp and warning codes. An API check or draft is not a published listing.
H. Verify stored external ID, active listing status and linked item status. Retrieve the actual eBay listing via existing integration; compare fields/images/specifics. Test approved revision and ending separately; reconcile back to SWISH.
I. Run separate subscribed users and tenants, including multi-niche owner access, to prove RLS rejects inappropriate reads/writes/routes. Verify Android/iOS/browser parity on the same source/runtime.

**Antique Flipper must not yet be promoted as a verified production reference for the other niches.** Implementation repairs and narrow executed SQL checks do not replace full real-object publication/reconciliation acceptance.
