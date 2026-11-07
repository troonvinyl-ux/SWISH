# SWISH native background removal experiment

Status: isolated experiment; not enabled in production.

## Existing integration verified
- Shared client: `services/sharedImagePreparationService.ts`.
- Existing Edge route: `supabase/functions/swish-coin-image-enhance/index.ts`.
- Paid provider: `supabase/functions/_shared/backgroundEraseService.ts`.
- Originals are canonical evidence. Presentation images are optional derivatives.
- Current `prepareCapturedImages` loops serially and may delay identification.

## Objective
Test an on-device segmentation model for iOS and Android with zero per-image provider calls. Do not alter main, existing Edge functions, database, eBay listing flow, inventory schema or credentials.

## Technical spike
1. Evaluate a *redistributable* lightweight segmentation model with explicit commercial licensing and documented model provenance. Compare small U2Net-style and RMBG candidates; do not bundle model weights until licensing is verified.
2. Select a native inference runtime compatible with Expo SDK 53 / React Native 0.79. Verify Android and iOS build integration, Hermes, ABI support and actual device memory usage. A native runtime needs a custom dev build, not Expo Go.
3. Add a platform-specific native adapter with a capability probe. Keep browser fallback separate. Avoid dynamic native imports in web bundles.
4. Process an image at a bounded resolution, infer an alpha mask, validate nonempty foreground and alpha, composite a transparent PNG or white/grey derivative without changing foreground RGB values. Preserve image dimensions and EXIF orientation as appropriate.
5. Run after identification/save; never await segmentation on the critical inventory save path. Store results as optional presentation derivatives linked to the same canonical original.
6. Feature flag `native_background_removal` default OFF; no automatic paid fallback. Explicit opt-in provider mode only. Fail safely to original.
7. Benchmark on actual Android and iPhone devices: warm/cold startup, model download/size, RAM peak, latency, segmentation quality, offline behavior. Include coins, clothing, bikes/spokes, glass, shiny antiques and fine print.
8. Tests: original image unchanged; no provider call in native mode; no double processing on re-entry; same item ID and image association; no blocking identification or inventory save; no changes to eBay listing media by default.

## Acceptance criteria before rollout
- Android and iOS native builds pass; web build remains functional.
- At least one real-device segmentation benchmark with recorded latency and memory per platform.
- Original image retained; processed output validated and independently linked.
- Feature flag defaults OFF; paid provider remains unchanged on production.
- No deployment or merge to main without explicit review.

## Known constraints
Current `package.json` has no native ONNX runtime. Merely adding a TypeScript wrapper does not constitute a working native implementation. Model licensing and on-device execution must be validated before integration.
