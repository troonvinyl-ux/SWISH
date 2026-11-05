# SWISH Shared AI Smart Studio — implementation and acceptance report

## Delivery status

**Implemented in source; not production-certified.** No test command, authenticated live model request, native build or pull-request creation could be executed with this editor's available tools. The final visual acceptance criterion has **not** been demonstrated. Do not interpret this report, source availability or an eventual green build as live acceptance.

The working implementation replaces full-product generative redrawing with AI boundary proposals and a real raster compositor. It is not a claim that a multimodal language model provides pixel-perfect segmentation. Transparent and irregular objects remain review-gated.

## 1. Audit findings

- GitHub main inspected: `343335b12efa21270faaf70949db9ffe270677b6`, commit “Populate confirmed Discogs details and add CD capture mode”. The inspected shared preparation service matched the local baseline. No Git branch switch/reset was performed and newer local work was preserved.
- `services/sharedImagePreparationService.ts` previously resized a JPEG and invoked `swish-coin-image-enhance`. It returned a generated reference only, without masks, homography, independent quality information or durable provenance.
- `swish-coin-image-enhance` previously asked `google/gemini-2.5-flash-image` to redraw the **entire** product. Prompt instructions could not guarantee letter/label/condition preservation.
- `hooks/useGenericCapture.ts` explicitly bypassed enhancement for every niche except `coins`, cleared non-coin enhanced URIs and only persisted reference images for coins.
- `identifyItemWithAI` substituted a coin's rendered aid for the original. The bespoke Coin Flipper also appended duplicate rendered-reference inputs. Both paths now send original evidence only, once per existing identification operation.
- Bespoke Coin Flipper invoked image enhancement after both faces were captured and from its manual reprocess control. Its import remains compatible but now invokes the protected shared engine.
- MX, Bike, Threads, Keen on Coins, shared scanner and stock-item photo flows use the canonical `identifyItemWithAI` / `uploadItemImages` entry points. Islamic identification had its own unsafe native `fetch(file://)` uploader; this now delegates to the shared byte-preserving uploader.
- Silver Batch uploaded under an unowned temporary item path before creating the real item. Its media step now follows canonical item creation and retains the item ID before media retries.
- `coinImageProcessing.ts` contains compatibility copy operations rather than an active precise contour/perspective implementation. It is retained; no second AI enhancer was introduced.
- Existing storage is `item-images`, public, limited to 5 MB per file with JPEG/PNG/WebP/GIF allowed. Existing `items.media` and `items.attributes` support documentary media and extensible metadata. Read-only SQL confirmed the existing fields; no tables, columns, policies, grants, buckets or entitlement records were changed.
- Existing image uploads re-encoded originals as JPEG and upserted numbered paths. New shared uploads preserve actual captured-file bytes, check signatures, use immutable content-addressed paths and verify readback.
- Backend context lists the old endpoint as deployed; its queried recent logs were empty. This does **not** prove its running revision or successful model connectivity.
- Available execution infrastructure: Expo ImageManipulator for processing copies, existing OnSpace AI secrets, shared Edge authorization, Supabase-compatible Storage, PostgreSQL JSON metadata and GitHub CI. No new application server, database or auth system.

## 2. Shared engine architecture

1. Keep the untouched original file. The shared scanner makes its local retained copy before analysis; shared camera quality is set to 1.
2. Make a bounded, high-quality JPEG **processing copy**, separate from original evidence. Standard long edge: 1280; high quality: 1600. No known-size upscaling.
3. Use OnSpace AI multimodal vision for normalized product outline, actual planar corners, holes, rotation, completeness and risk flags.
4. Validate polygon geometry, coordinate bounds, convex corner order, confidence, occlusion and object count.
5. Apply conventional edge contrast support checks. Four-edge rectangular proposals can be refined within a three-pixel band; irregular/transparent silhouettes are not snapped into rectangles.
6. Compute an inverse homography for a known planar aspect ratio. Unknown ratios and 3D/irregular products use a proportional similarity transform, not guessed stretching. Circular contours keep their real silhouette; automatic ellipse-to-circle inference is not implemented.
7. Centre with equal margins (default 8%). Rasterize outlines/holes with scanline masks rather than millions of polygon-point tests.
8. Obtain an **empty** AI-generated studio background plate. No product image is passed to the generative image model. Reject dark, colourful or high-variance plates; use a deterministic neutral plate with a subtle contact shadow when generation fails or neutral mode is configured.
9. Restore the entire product layer by inverse-mapping and bilinear sampling the source copy, after the background exists. Product text, artwork and damage never come from image-generator output.
10. Encode actual presentation and mask PNGs. Store small source hash/geometry/version/quality metadata in PNG tEXt and canonical item attributes.
11. Upload separate derivatives, verify storage readback, associate with canonical originals after original media links are confirmed.
12. Existing identification and marketplace research continue on originals. Enhancement never initiates identification or creates inventory items.

### Source protection and limits

The original file is unchanged. Presentation product pixels are resampled from a resized JPEG copy of that file; they are **not byte-identical full-resolution source pixels**. Interpolation and JPEG encoding can affect very fine detail, so original evidence always remains available.

The renderer supports bounded exposure gain but the server currently uses gain 1: no product repainting, automatic white-balance shifts, denoising, sharpening, healing, relighting of scratches or defect removal. This intentionally prioritizes evidence fidelity over an unverified cosmetic transformation. OCR equivalence, barcode readability and exact contour accuracy are not independently certified.

A single ordinary photograph cannot recover unseen edges, covered labels, lost highlight detail or an arbitrary product's true aspect ratio. Clipped, occluded, low-confidence or multi-object inputs safely fall back. Transparent, reflective, irregular and weak-edge outputs are marked `review` and do not become the default thumbnail. This is a deliberate safety boundary, not photographic acceptance.

## 3. Interface and shared integration

`prepareObjectImage({ original, nicheId, tenantId, angle, hint, additionalPhotos, quality, signal })` returns:

- Untouched `originalUri`.
- Separate `enhancedUri` and `maskUri` when produced.
- `sourceHash` of the processing-copy bytes, `cacheKey`, version, detection and inverse transform.
- `ready`, `review` or `fallback` status, model boundary confidence and explicit quality warnings.

`prepareCapturedImages` preserves per-view order and identities and uses a hard batch budget. It never merges separate components/sides. The interface accepts up to two small reference photographs; the automatic scanner processes each view independently. Cross-view pixel fusion or restoration from another side is intentionally absent.

The shared scanner starts preparation asynchronously after capture; identification can reuse that result. A whole-operation client timeout includes auth, local preparation, cache and network. Expired jobs do not delay identification indefinitely. The existing identification request is not automatically replayed.

A small additional studio comparison/retry control appears inside the existing scanner, not a new page or redesign. It leaves the original preview available and can retry studio without re-identification. The canonical inventory and music-collection thumbnails prefer only eligible source-protected results associated with the current main original.

## 4. Models and processing libraries

- Boundary proposals: `google/gemini-3-flash-preview` through OnSpace AI.
- Empty background generation: `google/gemini-2.5-flash-image` through OnSpace AI.
- Client copies: `expo-image-manipulator`.
- Server JPEG decoding: pinned `jpeg-js@0.4.4`.
- Server PNG decoding/encoding: pinned `fast-png@6.2.0`.
- Geometry, scanline masks, source restoration, byte comparison and quality checks: dependency-free TypeScript plus server Web Crypto / Expo Crypto.

Server-only optional configuration (Cloud → Secrets):

| Name | Default |
|---|---|
| `SMART_STUDIO_DETECTION_MODEL` | `google/gemini-3-flash-preview` |
| `SMART_STUDIO_BACKGROUND_MODEL` | `google/gemini-2.5-flash-image` |
| `SMART_STUDIO_BACKGROUND_MODE` | `generated`; `neutral` disables generation |
| `SMART_STUDIO_OUTPUT_SIZE` | `1024`, bounded 512–1280 |

Existing OnSpace AI environment secrets are reused. No keys are added to client variables or code. Changing model configuration is an explicit administrator operation, not an automatic model switch.

## 5. Storage and evidence roles

- **Original:** `item-images/{itemId}/originals/{slot}_{contentHash}.{actualExtension}`. No upsert, re-encoding or resizing. Stored bytes are independently downloaded and compared with the actual captured file before accepting the link. The path digest is SHA-256 of canonical base64 bytes, not a mislabeled raw-file SHA-256.
- **Presentation / mask:** `item-images/{tenantId}/studio/{userId}/{nicheId}/{cacheKey}/presentation.png` and `mask.png`. The existing authenticated client/RLS is used for writes; no storage-management API or service-role bypass.
- **Database:** originals remain in canonical `items.media`; new provenance map `_smart_studio_images` lives in existing `items.attributes`. Attribute association is tenant/item/version-constrained and verified by readback. Existing eBay specifics and other attributes are preserved.
- **Legacy:** `_coin_reference_images` and legacy reference objects are retained but not promoted to source-protected thumbnails.
- **eBay:** no marketplace image selection logic was redirected to the studio map. Original media stays the default. Shared original uploads reject known studio/reference paths as documentary evidence.
- **Limits:** the existing bucket does not support HEIC or originals above 5 MB. Such originals are retained on device and fail visibly rather than silently being converted. Increasing that limit or adding explicit conversion requires a separate reviewed storage decision.
- The existing bucket is **public**. Namespacing and authorization protect invocation/writes, not confidentiality of known public URLs. No private-image storage guarantee is made.

## 6. Caching, reliability and cost

Completed PNGs contain small provenance metadata and are reused across restarts. Keys include processing content, scope, angle, references, version and server model/settings. Client cache metadata is scoped to user/content for six hours. In-flight identical requests are deduplicated in one client and one Edge isolate. Background plates are reused within one isolate.

There is no automatic replay after an ambiguous paid-model failure. Provider deadlines, client whole-operation deadlines, input dimensions, request sizes, isolate request limits and review/fallback states are implemented. Rate limits and in-flight locking are **per isolate**, not globally distributed reservations. Simultaneous cold workers can still incur duplicate initial AI calls before a cache object exists. Load testing, distributed cost reservation and orphan-staging retention management remain production blockers. No data cleanup was executed.

## 7. Changed files

### Engine and canonical contracts

- `shared/smartStudio.ts`
- `supabase/functions/_shared/smartStudio.ts` — deployment mirror
- `supabase/functions/_shared/smartStudioEngine.ts`
- `supabase/functions/_shared/studioBoundaryQuality.ts`
- `supabase/functions/swish-coin-image-enhance/index.ts` — existing endpoint reused
- `services/sharedImagePreparationService.ts`
- `services/originalImageService.ts`
- `services/smartStudioStorageService.ts`

### Integration

- `services/aiIdentificationService.ts`
- `services/islamicIdentificationService.ts`
- `hooks/useGenericCapture.ts`
- `hooks/usePremiumCamera.ts`
- `components/feature/PremiumScanner.tsx`
- `app/coin-flipper.tsx`
- `app/silver-batch.tsx`
- `app/(tabs)/inventory.tsx`
- `app/music-collection.tsx`

### Verification and documentation

- `scripts/validate-edge-deployment.mjs`
- `.github/workflows/smart-studio-verification.yml`
- `services/__tests__/smartStudioGeometry.test.ts`
- `services/__tests__/smartStudioIntegration.test.ts`
- `services/__tests__/originalImageBytes.test.ts`
- `services/__tests__/coinImageEnhancementService.test.ts` — updated legacy contracts
- `services/__tests__/serverOnlySecrets.test.ts` — provider boundary moved to shared engine
- `supabase/tests/smartStudioFixtures.test.ts`
- `supabase/tests/smartStudioLiveAcceptance.ts`
- Four user-supplied original JPEG fixtures under `test-lab/studio/`
- This report and `docs/SMART_STUDIO_EVIDENCE.json`

No routing/registry/auth/tenant policy changes, eBay credentials changes, new tables or new application pages.

## 8. Test results and niche coverage

**Executed test counts: 0 passed, 0 failed. Tests were not run; these numbers are not a success result.** The editor has no shell/test/build execution tool. The read-only SQL inspections and fixture downloads succeeded, but are not application acceptance tests.

Source contains tests for every registered niche's shared detection profile (Coins, Tunes, Collectibles, Antiques, MX, Bicycles, Threads/clothing, Cards, Fossils, Beauty, Tech and Surplus). No live niche has been verified during this session.

Prepared tests cover:

- Real raster geometry, centred margins, aspect ratio and homography.
- Rejection of degenerate polygons, clipping, occlusions and multiple objects.
- Input raster immutability and source-only product pixels even over a deliberately hostile background.
- Irregular silhouettes/holes and review-safe thumbnail selection.
- Actual byte uploader behavior and independent byte-mismatch rejection with mocked Storage.
- Cache/deduplication and explicit failure/old-generative-provenance rejection.
- Canonical media/eBay separation and tenant/version constrained attribute writes.
- Offline decoding/compositing of all four supplied March of the Mods originals.

**Important:** offline photo tests use a declared central patch to exercise the codec/homography. Those resulting files are named `manual-geometry` / `manual-mask`. They are not automatic product segmentation, complete-product crops or evidence of the final visual criterion. Do not present them as a generated acceptance example.

Run the new GitHub workflow to obtain actual TypeScript, lint, full Jest, Deno deployment graph and offline-raster results with source identity. Artifacts retain test JSON and real fixture outputs. No native Android build was launched; use the existing unified build workflow after source checks pass.

## 9. Live acceptance procedure

For an approved runner, configure `STUDIO_BACKEND_URL`, `STUDIO_ANON_KEY`, `STUDIO_APPROVED_JWT`, `STUDIO_TENANT_ID` and `STUDIO_NICHE_ID=tunes_flip` securely in runner/CI environment. The JWT must have an already-opened, entitled module session. Never paste it into chat.

```sh
deno run --allow-env --allow-read=test-lab/studio --allow-write=verification-output --allow-net supabase/tests/smartStudioLiveAcceptance.ts --live
```

Without `--live`, no request is made. Live execution invokes the real existing endpoint, saves only staged presentation/mask artefacts, replays identical content to inspect the cache, tests cross-niche denial and records technical results without JWTs or private image URLs. It performs no inventory insert/update or eBay operation. Paid AI can be used when explicitly enabled.

A technical pass still requires a human comparison of original vs output: complete perimeter, real proportions, all visible text/artwork/barcode, damage and realistic lighting. Some supplied photos have clipped/covered sleeve/case boundaries. Safe fallback for those views is expected, not permission to invent missing product edges. Obtain a complete uncropped front/rear photograph for the final full-product visual acceptance test.

## 10. Deployment, PR and outstanding blockers

- **Source implementation:** present.
- **Tests passed:** unverified; none executed here.
- **Successfully deployed current revision:** unverified. OnSpace applies source changes on completion; no authenticated running-version or model-output proof is available yet.
- **Verified in running application:** no.
- **Android/iOS build:** not run.
- **Pull request:** not created. This editor provides no authenticated Git branch/PR mutation tool. Use the OnSpace GitHub integration to commit these focused files on a branch and open a PR titled “Shared source-protected Smart Studio image engine”, linking this report and subsequent real CI artifacts.

Remaining blockers: real model/deployment connectivity; actual test/lint/type results; native codec/network/memory checks; representative non-CD photography across niches; accurate transparent/complex segmentation; arbitrary aspect-ratio recovery and true ellipse perspective correction; independent OCR/barcode validation; low-light product correction without condition misrepresentation; distributed cost reservation/load testing; staged-object retention management; existing public storage privacy and 5 MB/HEIC constraints.

**Final acceptance: NOT VERIFIED.** A real shared source-protected preparation pipeline has been implemented, but the requested photographer-quality automatic result across every niche must be established with live outputs and review, not asserted from source code.
