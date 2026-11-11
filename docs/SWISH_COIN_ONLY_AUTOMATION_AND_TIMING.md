# Coin-only photo automation and scanner-to-live target

## Simple workflow

- Capture → Next → List now, or Save for later. Existing identification, canonical inventory, eBay checks and permissions are unchanged.
- Coins alone prepare background-removed photos automatically. BackgroundErase still supplies the alpha cutout; the server translates the complete nonzero-alpha boundary onto a square white canvas. There is no resizing, relighting, artificial rim, cleaning of patina or reconstruction. Originals remain stored as evidence. Check the result before listing.
- All other niches skip automatic removal before authentication, codecs, caching or provider requests. A compact BG-remove action is available next to captured/listing photos and for the selected inventory-gallery photo. This action affects one photo, not every image or another identification request.
- Adding coin photos through inventory or the listing editor uses the same automatic coin policy. Other niches save originals without removal.
- Manual variants do not hide the remaining unprocessed captures. Explicit buyer-facing selections/order are preserved. A saved cutout does not automatically revise a live eBay listing.
- Existing processed images and originals are not deleted or automatically reprocessed. Failed removal retains the original and does not prevent ordinary original-photo use.

## Timing evidence

A read-only database check during this session found 96 `quick_list_timing` checkpoints, most recently 2026-11-11 13:06:46 -05:00, and no `quick_list_live_confirmation` rows in that query. Therefore recording is active, but a confirmed under-60-second result is not established by this evidence.

The shared Quick List screen now displays T1 (scanner opened) → T7 (reconciled active eBay listing), rather than including earlier time spent elsewhere in the application. It continues throughout capture, identification, pricing, review, retries and publication. The timer stops only when the existing live readback succeeds. Exactly 60 seconds is not under the target.

`quickListMetrics().scannerToLive` includes sample count, median, P90 and strictly-under-60 count/percentage. Legacy T0 app/foreground timing metrics remain intact for comparison. Missing T1 and reversed timestamps are excluded, not fabricated. The telemetry reader still requires matching server-written live-confirmation evidence before accepting a live timing outcome.

Coverage is the shared Quick List photo-to-live flow. Legacy specialist workflows, resumed scans (which intentionally clear their timing), and barcode confirmations that leave Quick List for a separate editor are not claimed as measured end-to-end sessions. No benchmark or live eBay publication was run by the editor in this session.

## Android updates: reuse existing GitHub configuration

The existing workflows already use `EXPO_TOKEN`, the Expo/EAS project identity and the original Android signing credentials. No new Expo account, project, API key, authentication system or signing certificate was created.

The unified build and OTA publisher now accept the project identity from `vars.EXPO_PROJECT_ID`, `secrets.EXPO_PROJECT_ID`, `vars.EAS_PROJECT_ID` or `secrets.EAS_PROJECT_ID`. `EXPO_TOKEN` remains a GitHub Actions secret and is never included in the APK. GitHub secret values cannot be inspected by this editor.

### Compatible code/assets: no reinstall

1. Merge approved source to the same repository used to build the installed APK.
2. In Actions, run **Publish approved compatible unified SWISH update** (`publish-swish-ota.yml`) on main.
3. Select the installed APK's channel (`preview-unified` or `production-unified`) and Android, and supply the successful native baseline build run.
4. Existing approval, tests, native fingerprint and artifact checks must pass; keep these gates. Publishing uploads the JS/assets bundle to the same Expo project/channel/runtime.
5. The compatible installed APK checks/downloads on launch or return to SWISH. Save current work and restart when prompted, or use More → App updates → Check for updates / Restart to apply.

An Expo token authorizes publication; it does not make an arbitrary APK update-compatible. Verify **Update support enabled**, project, channel and runtime in the installed build. GitHub changes or a new APK build alone do not publish an OTA update. OnSpace preview changes are not proof of installed-APK delivery.

### Native changes: install a replacement APK

If dependencies/native permissions, native configuration or runtime compatibility change, build and install a new APK using the same Android package and original signing key. Old APKs without Expo Updates enabled need an update-enabled APK installed once. Separate legacy niche APKs use their own runtime/channel and do not receive a unified-channel bundle automatically.

The current session has not triggered GitHub Actions, published an OTA release, or verified the user's installed APK. Existing GitHub approval and compatibility evidence remain required.

## Verification

Added/updated mocked regression coverage for:
- No automatic provider/auth/codec calls in every non-coin niche; explicit single-photo processing remains available.
- Coins retain automated cleanup and original references; lifetime-gallery additions follow the same policy.
- Deterministic coin centering, preserved holes/protrusions, white background and no source mutation.
- Scanner timing start, strict under-60 boundary, backwards/missing timestamps and non-live outcome exclusion.
- Compact per-photo controls, exact seller selection preservation and shared client/server contract parity.

The shared seller workflow now includes these tests and the coin Edge Function type check. Test runner execution is not available in this editing session; CI and installed Android/iOS testing remain pending. No test pass, confirmed-live listing or successful OTA delivery is claimed.
