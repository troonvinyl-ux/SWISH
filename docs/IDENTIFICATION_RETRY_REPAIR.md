# Photo identification hardening — Tunes Flip retest

## Observed failure and evidence

The supplied screenshot is a Tunes Flip photo request returning a Supabase `FunctionsFetchError` (no HTTP response), while barcode lookup worked. It is not evidence of a Numista identification rejection. Initial backend/Live Preview diagnostics and the read-only `edge_function_logs` lookup returned no matching failing photo request. A subsequent backend log lookup shows this session's GET checks reached `swish-identify` and returned HTTP 405 `Method not allowed`, with handler durations of 968–1,746 ms. This confirms the endpoint answered GET checks, not that an authenticated photo POST or AI provider call passed. The screenshot's exact transport cause remains unconfirmed.

Confirmed code risks: concurrent full-size image processing, width-only resizing, unrestricted data-URL pass-through, and an uncompressed-file fallback; absent client timeout; generic provider error responses; verbose music output and music slot names that can mislead the model for multi-CD compilations. These risks were corrected without replacing the engines.

## Changes

- Analysis copies are prepared sequentially, resized by long edge without upscaling when dimensions are known, and encoded as JPEG. Unknown-dimension results are also long-edge bounded. A large copy gets one smaller local encode; decoding failure no longer uploads the original uncompressed file.
- Shared client/Edge validation: eight photos maximum, 800,000 characters per inline photo, 6 MB UTF-8 request budget, aligned labels and 30 KB known-attribute limit. Stored HTTPS originals need no base64 upload. Original capture files, draft, barcode state and saved inventory IDs are not replaced.
- One abortable request: 85-second music client deadline; existing longer coin workflows use 165 seconds. No automatic network/paid-call replay. A timeout on the client cannot guarantee cancellation of work already accepted by the server.
- Music retains its existing Gemini 3 Flash model, uses JSON-object output, a 35-second provider deadline and a concise 3,200-token response. Coins retain their existing Numista, research and adjudication paths/models. An explicit provider timeout/rate-limit/malformed/truncated result returns a useful status and correlation reference instead of undifferentiated failure.
- The music prompt reads packaging first, distinguishes CD compilations and disc numbering, and treats capture-slot labels as intended views rather than identity evidence. Barcode and fresh selected catalogue metadata are supplied as provisional hints, not exact-release confirmation.
- Music photo output cannot populate Numista/coin data, invented Discogs release IDs, pressing confirmations or media/sleeve grades. Actual Discogs confirmation and manual grading remain in the established review workflow. Prices remain zero until valuation.
- Existing authentication, module authorization, entitlements, tenant isolation, inventory persistence and eBay connections remain intact. No secret values are included in new logs or client code.

## Files

`services/aiIdentificationService.ts`, `services/identificationTransportService.ts`, `hooks/useGenericCapture.ts`, `shared/identificationPolicy.ts`, its Edge mirror, `supabase/functions/swish-identify/index.ts`, deployment mirror scripts, Tunes verification workflow, two Jest regressions, Deno policy tests, and the Coin Flipper mock's invalid base64 fixture (replaced with syntactically valid base64).

## Verification status

Executed: backend log lookup, Live Preview failed-request lookup, read-only stored-log SELECT, and GET reachability checks. The failed installed-device POST was not present in returned diagnostics; subsequent GET invocation logs confirmed expected HTTP 405 responses. No inventory, seller or subscription records were changed by these checks. This does not verify authenticated identification or its AI result.

Prepared, NOT EXECUTED here: Jest policy/deadline tests, mocked Expo/Supabase request tests, Deno music/payload fixtures; the existing Tunes CI runs the full regressions plus deployment mirror checks and the identify dependency graph. This editor has no terminal or authenticated installed-device runner. No passing tests, successful Edge invocation or release build are claimed.

Run in the approved execution environment:

```sh
npx tsc --noEmit
npx expo lint
npx --yes jest@29.7.0 --config jest.config.ci.js --runInBand services/__tests__/identificationReliability.test.ts services/__tests__/identificationImagePayload.test.ts services/__tests__/coinFlipperProduction.test.ts services/__tests__/tunesFlip.test.ts
node scripts/sync-backend-registry.mjs --check
node scripts/validate-edge-deployment.mjs
deno test supabase/tests/identification_policy.test.ts
```

Full existing regressions must also run; historical unrelated failures are not waived. Native/web builds and live owner/subscriber acceptance remain unverified. No APK or live eBay listing was requested.

## Device retest

1. Load the updated app code and updated `swish-identify` Edge Function. Reopen the retained Tunes Flip capture; do not create another inventory item.
2. Use the same cover, rear packaging and CD label photos. Barcode lookup remains a separate existing Discogs path.
3. Tap Identify once. Expect an artist/title/format proposal and targeted release/condition review, not an automatically verified pressing. Confirm the exact Discogs release manually before saving.
4. If it fails, report the displayed status/reference and approximate time. A no-response failure can still be transport/gateway/deployment-related; the new reference is for correlating any invocation that reached the handler, not proof that it did.
