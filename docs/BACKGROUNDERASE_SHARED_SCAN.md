# BackgroundErase shared scan pipeline

## Integration
- BackgroundErase now replaces generative image editing, AI visual comparison, generated backgrounds, geometry correction and the legacy local enhancement operations in the active shared image pipeline.
- Shared scanner, existing-photo processing and Coin Flipper aliases use the existing `swish-coin-image-enhance` Edge Function. The endpoint name is compatibility only; the provider is BackgroundErase for every niche.
- Identification, Numista and Discogs still use original evidence. This change removes alternative presentation processors, not those identification features.

## Credentials and authorization
- `BACKGROUND_ERASE_API_KEY` is accessed exclusively with `Deno.env.get()` in `supabase/functions/_shared/backgroundEraseService.ts` and attached to the server-to-server `x-api-key` header.
- No provider credentials, provider endpoint, account responses, raw provider errors, model configuration or API-key headers are included in client application code, Expo configuration, request bodies, local caches, PNG metadata or client logs.
- JWT, current tenant/module and paid-niche verification execute through the existing `serveModule` wrapper before provider calls. Optional internal item IDs inherit the existing resource authorization.
- New restrictive storage INSERT/UPDATE/DELETE policies for anon and authenticated users protect the tenant/studio path. Only the server service-role client writes these artefacts; no user Authorization header is attached to that storage client. Ordinary original uploads retain existing ownership/RLS checks.
- The draft database guard accepts the new item-linked provider contract. Publish/revise still verify server-written PNG provenance and the original association; a client metadata flag alone is insufficient.

## Image handling
1. Keep the untouched original and its exact original-upload verification path.
2. Create temporary, aspect-preserving JPEG transport copies capped at 1280 pixels (1600 for existing explicit high-quality requests). Client resize/encoding is transport only, not cropping, restoration, background removal or beautification.
3. Send one multipart provider request to `POST https://api.backgrounderase.com/v2`: `image_file`, `format=png`, `channels=rgba`, `size=full`, `crop=false`, `despill=false`. No replacement background, extra reference photos, colour fill, OCR, generative editing or model-based fallback.
4. Validate PNG signature/decoding, dimensions, nonempty foreground, transparency and byte limits. These are transport/output checks, NOT a guarantee that all fine product edges or defects were correctly segmented. No confidence score is invented.
5. Store the returned provider PNG with appended server provenance text. PNG image chunks and decoded pixels are not composited, relit, centred, stretched, recoloured or re-encoded in this path.
6. Retain canonical item.media as originals; link cutouts in the existing `_smart_studio_images` metadata. Valid cutouts are available to new listing photo selections; originals remain selectable. Existing live eBay listings do not change without explicit revision.

## Credits, fallback and historical files
- One provider POST per uncached source attempt; no automatic provider replay after HTTP, billing, network, invalid-output or timeout errors. Successful results use versioned user/tenant/niche-scoped storage and client caches. In-isolate in-flight requests are coalesced.
- Advisory photo-quality review occurs before removal within shared identification. Failed attempts are retained on the scan so re-identifying or saving does not silently spend provider credits again. Explicit Remove backgrounds or existing-photo processing can retry failures.
- Provider 401/403, 402, 429, malformed output, size errors and request failures produce sanitized, provider-labelled messages. Original-based identification can continue when removal fails.
- The configured account controls actual trial credits and billing. No assumed 1,000-credit counter or unverified remaining-balance display was added. In-memory rate limiting is per Edge isolate, not a guaranteed account-wide spending cap.
- No historical image, inventory or listing data was deleted. Old generative/geometry studio artefacts are no longer preferred for new photos under the new version. Old draft selections using those artefacts may require selecting originals or generating a new BackgroundErase cutout before submission. Existing live listing images remain untouched.

## Verification
- The storage-boundary policies and listing-photo function were applied via SQL; the new version was verified by a read-only query.
- Added mock-only Deno provider contract, missing-key, sanitized-error, no-replay, invalid-image and pixel-preserving metadata tests. Updated Jest shared-gateway, original preservation, listing photo policy and secret-boundary regressions; added targeted CI steps.
- No command runner is available in this editor session, so test/build execution is not claimed. No live provider-credit consumption, native acceptance, account-key validity or Edge deployment readback is claimed.

## Retest
- Deploy the endpoint and its shared dependencies together, including both mirrored studio contracts and BackgroundErase gateway. Rebuild/update the application for the new pipeline version.
- In any niche, capture/upload a familiar product and Identify: expect an original-based proposal and a separate BackgroundErase cutout. Save, reopen inventory and a new draft: verify both original and cutout are available.
- Re-identify/save the same scan without another removal request: verify no paid replay. Retry an explicit removal separately when desired.
- Process stored photos individually/all: verify original order and listing copy remain unchanged. Compare edge detail and lettering visually, particularly CDs, teddy bears, reflective coins, bicycle spokes and glass.
- Test missing/rejected key, provider billing/rate failures, fully opaque/empty/corrupt output and a timeout: original must remain usable, with no fallback image provider.
- Test forged studio upload/overwrite as ordinary authenticated user: storage must deny it. Test another module/tenant against the endpoint: authorization must deny it before processing.

Reference: official provider contract, https://backgrounderase.com/docs (checked during implementation).
