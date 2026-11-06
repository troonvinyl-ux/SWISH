# SWISH Quick List: architecture audit and pre-merge evidence register

Status: implementation candidate, NOT accepted or production-verified. The under-60-second target and improved coin accuracy have NOT been demonstrated. No live product was published by this development session. A draft and an AddItem acknowledgement are not acceptance evidence.

## 1. Initial architecture audit (performed before edits)
- Existing Expo Router, AlertProvider/AuthProvider/AppProvider and server-bound module entitlement scope remain authoritative. No new login, database, eBay connection, token refresh or application.
- Existing camera: expo-camera CameraView; existing PremiumScanner and usePremiumCamera. Native barcode decoding is already compatible with the installed camera integration. Barcode-specific product lookup was missing from the Browse gateway.
- Inventory: items + itemService, saveIdentifiedItem, exact-byte originalImageService, shared image association. Existing RLS/tenant/specialist guards remain.
- Listings: swish_create_listing_draft, swish_save_listing_editor, listingService, listingEditorService and existing swish-ebay-list publication claim/reconciliation path. Repeated verification/taxonomy reads and deliberate UI sleeps exist in the legacy submission path; they were NOT bypassed for speed.
- Photos: shared BackgroundErase via swish-coin-image-enhance, originals retained. No new processor/provider secret.
- Numista: paid image search, up to eight visual finalists and detailed type retrieval; text discovery previously suppressed whenever image candidates existed. Whole-photo analysis and second-pass review existed, but independent face observations and structured host/countermark separation were missing.
- Market value: existing swish-market-value correctly treats Browse prices as asking prices and does not call the unverified Terapeak endpoint. Marketplace Insights is restricted and may be unavailable. Numista sales were not used.
- Live checks: existing inspect_live/GetItem verifies seller content. It lacked explicit Active status and available quantity in its returned snapshot.

## 2. Files and services changed
New: shared/quickList.ts; services/quickListService.ts; services/quickListTelemetryService.ts; contexts/QuickListContext.tsx; hooks/useQuickList.ts, useQuickListCamera.ts, useQuickListOptions.ts; components/feature/QuickListWorkspace.tsx; server helpers quickListBarcode.ts, numismaticEvidence.ts, numistaSaleEvidence.ts; focused Jest/Deno tests and quick-list-verification.yml.
Modified: app/_layout.tsx provider/foreground timing only; app/(tabs)/scan.tsx only for coins/collectibles; ModuleHome immediate CTA only for those two niches; app.json camera barcode flag; aiIdentificationService.ts; marketValueService.ts; swish-identify, swish-ebay-browse, swish-market-value, swish-ebay-list and ebayLiveContent.
Unrelated dashboards, historical records, billing, authentication, niche registry, OAuth and other specialist scanner routes were not rebuilt.

## 3. Existing functions reused
identifyItemWithAI, prepareNumistaImages/searchNumistaImages/verifyWithNumista, getMarketValue, saveIdentifiedItem, generateListing, saveListing, saveListingEditor, submitListingToMarketplace, inspect_live, swish_create_listing_draft, swish_save_listing_editor, uploadUntouchedOriginal, updateItemMedia, linkStudioImages, prepareObjectImage; existing application/seller credentials and token refresh. No duplicate eBay publishing engine.

## 4. New functionality implemented
- Immediate Quick List CTA on the existing two home dashboards. Their Identify tab contains one capture/review/publish workspace. Collectibles starts in barcode mode; coins remain photograph-led.
- EAN/UPC/ISBN checksum validation, UPC-E expansion, numeric GTIN QR handling. Arbitrary scanned URLs are never fetched.
- Native on-device decoding; Web/PWA JavaScript ZXing on CameraView snapshots. One camera stream; no native scanner dependency added.
- Recognized barcode immediately starts server-side Browse discovery; front/back photographs remain possible during lookup. Exact GTIN equality is required for a lead. Seller titles/aspects remain provisional product/variant context, not physical-condition evidence. Multiple matches require choice; no match transitions to visual mode.
- Two photographs start identification automatically. Photo preparation runs independently. After identification, upload, title/description generation, taxonomy requirements and valuation run concurrently where dependencies allow. Failed draft preparation reuses the existing canonical item ID.
- Inline missing specifics, current supported eBay conditions, seller price, condition/completeness/working/accessory notes and description editing. No separate ordinary listing editor.
- Manual PUBLISH LIVE TO EBAY follows explicit review. Auto-publish defaults OFF; opt-in is per user/tenant/niche/device and only acts after the seller presses the explicit review-and-publish confirmation. It is not unattended server automation.
- Canonical publication calls and all existing server permission/policy/identity/safety checks remain. T7 requires exact saved seller content, correct external ID, GetItem Active status and positive available quantity. Pending outcomes never auto-replay publication.
- Independent face observation calls, competing text and image candidate discovery, structured specialist pathways and countermark review. Confidence is bounded by diagnostic evidence/contradictions, not averaged AI scores. The existing 95% coin publication confidence gate remains unchanged; the number is a configured gate, NOT a measured accuracy claim.
- Numista sales endpoint is requested in-memory when a coin type ID is available. Unknown response classifications are explicitly unclassified, never sold comparables or automatic pricing. Live schema mapping remains a blocker; no numeric claims about this adapter are made.

## 5. API permissions, licensing and dependencies
- Existing eBay Production Browse application scope, Taxonomy and Sell Metadata access; seller publish consent and selected business policies. Browse approval/quota must be checked against the actual application. The Catalog API was investigated but not added without verified access/contract; Browse GTIN search + individual item detail is the selected adapter.
- Existing Numista paid key, one image request, up to two text discovery queries when image finalists exist (four otherwise), bounded detail requests and no automatic paid replay. Detailed catalogue responses and sales records are invocation/session-local. Numista attribution/N# remain visible. Only identifiers/operational metadata and the user's own evidence-derived inventory belong in durable records. No bulk catalogue/cache was created; historical records were not rewritten.
- Issuer/mint metadata is read from retrieved type records; no new bulk metadata download. OCRE/CRRO existing public reference adapters remain supplementary. RPC response availability is not assumed; no result means no corroboration. SNG, Album, WildWinds and CoinArchives do not gain guessed references or unauthorized scraping. Licensed/user-supplied corroboration remains manual where no approved API exists.
- OFF/Beauty/Products Facts were investigated. OFF documentation specifies ODbL/DbCL attribution/share-alike and CC-BY-SA image obligations, and currently published request limits. They are NOT silently merged into proprietary inventory. Provider registration, license review and applicable product safety handling are needed before enabling those adapters. A free decoder is not a free product database.
- New JS-only dependencies @zxing/browser and @zxing/library are dynamically loaded only on Web. They must be present in the exported repository/dependency installation before builds. package.json/lockfiles are platform-managed and were not manually modified here.
Sources: https://docs.expo.dev/versions/latest/sdk/camera ; https://developer.ebay.com/api-docs/buy/browse/resources/item_summary/methods/search ; https://openfoodfacts.github.io/openfoodfacts-server/api/ ; https://openfoodfacts.github.io/documentation/docs/Product-Opener/api/tutorials/license-be-on-the-legal-side/ ; https://en.numista.com/api/license.php .

## 6. Database changes
None. Existing commercial_events stores client timing snapshots and server GetItem confirmation events. Existing tables/RLS/policies, originals, user records and historical data were preserved. Only the server uses private provider credentials; all client operations use the existing authenticated client.

## 7. Coin test results
NOT RUN: independently verified Greek, Roman Imperial, Roman Provincial, Byzantine, Islamic, medieval, countermarked, worn/ambiguous specimens; obverse/reverse order tests; real Numista searches/detail/sales; calibrated confidence; live valuation and publication. No appropriate verified coin fixtures/JWT/device-test facilities were supplied. No 95% accuracy claim.
Added (not executed here): pure mocked confidence/countermark/competing-candidate regression tests. These prove contracts when run, not identification accuracy. Existing regression suites still require execution.

## 8. Collectibles test results and timing
NOT RUN: real EAN, UPC, ISBN scanning; exact product, variants/multiple results/no record/unreadable barcode; unbarcoded physical item; real condition/accessory confirmations, current item specifics, canonical draft, live approval/publication and cross-platform sync.
Added (not executed here): barcode checks/UPC-E/ISBN normalization tests, fake HTTP exact-GTIN/no-copied-condition/no-product fallback tests and metric denominator tests. No live seller calls were made.

T0: earliest loaded Quick List JS module timestamp or foreground event; T1: workflow start; T2: scanned barcode or required coin faces; T3: identification response; T4: valuation operation finished (failure is not valid price evidence); T5: user-confirmed field validation and canonical editor readback; T6: existing submit service enters publishing; T7: GetItem confirms Active and saved content/identity/price agrees.
Primary measured interval is T7-T0. Native process creation precedes available JS instrumentation and must be captured with native/device launch profiling for strict full-launch timing. T6 currently precedes the Edge request by the existing service callback, not the server socket-write instant. Client clock/taps are client-reported, not tamper-resistant performance certification. Native picker/system permission taps are not observable; actual total actions require recorded test sessions.
Metrics screen reports successful-session median, nearest-rank P90, successful within-60 %, eligible within-60 %, barcode-match rate, visual-match rate, failed-publication rate, unknown outcomes and instrumented actions. Dashboard sample inclusion requires server GetItem confirmation. Operational match success is NOT independently verified identification accuracy. Over-budget snapshots retain reasons/operation duration data.
Results: median NOT MEASURED; P90 NOT MEASURED; within 60 seconds NOT MEASURED; all success/failure/action rates NOT MEASURED. The 80% target is NOT achieved/verified.

## 9. Android/Web/PWA/build/regression results
NOT RUN. This environment exposes file/SQL/web tools, not a terminal, native devices, browser camera automation or GitHub build runner. The new workflow can run TypeScript, the full Jest suite, Web export, Deno checks and mocked edge tests after submission. Android APK build/install, HTTPS Web/PWA camera permissions/ZXing, portrait/landscape and account restoration must be tested separately using the existing release workflows. Live Preview inside an iframe may lack camera permissions and is not native acceptance.

## 10. Outstanding blockers and focused PR requirements
- No Git/branch/PR creation tool is available here. NO branch or pull request was created. Commit these focused files to a dedicated review branch (suggested quick-list-numismatic-intelligence), preserving unrelated work, and open the PR externally. Do not merge on source existence alone.
- CI/type/lint/regression/dependency/Android/Web builds must run, with their real artifacts/source SHA recorded. Existing tests may detect integration changes; fix failures before merge.
- Upload a representative independently verified coin set with both faces, actual measurements, known identity and independent provenance/references. Record observed results, alternatives/contradictions and failure cases without selecting only easy coins.
- Provide approved real-product/price/account listing fixtures and human approval per live test, or explicitly enable auto-publish in that account. Never publish unspecified stock as a test. Retain listing IDs and GetItem responses and verify inventory synchronization.
- Validate actual Browse/Numista API permissions, response fields, costs, rate limits and license requirements. Numista sale response mapping and independent reference adapter availability remain unverified.
- Camera preload currently means the existing Identify screen mounts immediately once opened; the home CTA does not invisibly activate a second camera. Full process-to-viewfinder startup profiling and native permission warmup remain to optimize.
- Quick List's current fast path requests front/back photographs. Optional detail/side/packaging capture still uses the existing full shared scanner, not a new duplicate. Complex evidence may need that workflow; it is not counted as an ordinary under-seven-action success.
- Pending originals/draft IDs are written to a scoped recovery record; Context retains the open workflow within the running app. Fully automatic cross-restart recovery UI is not yet integrated. Use existing inventory/draft recovery instead of creating duplicates after an unknown outcome.
- Source verification/safety checks are intentionally not skipped to meet time. Remaining repeated legacy submission checks need real latency profiling before consolidation. No sleep removal or guessed category/price was used to claim speed.

Release gate: signed-off real end-to-end measurements, at least 80% of predefined straightforward, correctly identified, listing-ready fixtures live within 60 seconds, independently measured median/P90, no regressions and recorded failures. Until then this is an implementation candidate only.
