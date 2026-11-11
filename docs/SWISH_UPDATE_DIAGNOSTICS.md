# Shareable SWISH update diagnostics

## Location and use

Open **More > App version & updates** (the App updates screen). Below the update action, **Share diagnostics report** opens the installed device's system share sheet with a plain-text report. **View report** exposes the same selectable text. Browser preview offers the selectable report instead of an unsupported native share sheet.

The report is regenerated when viewed/shared and when the app returns to the foreground. It reports the currently running update, not an update staged for the next restart. Sharing does not initiate an update check, download, restart, backend request, or database write.

## Public metadata included

- Report schema version and UTC generation time.
- Platform and execution environment.
- Installed native app version and Android `versionCode` (iOS build on iOS).
- Expo project ID, preferring EAS metadata; a configuration fallback is labelled **not APK-verified**.
- Channel and exact resolved runtime from the guarded Expo Updates runtime.
- Currently running update ID or an explicit embedded-bundle/unknown label.
- Whether OTA is enabled in this host and the running bundle type.
- The configuration channel, separately labelled and only displayed if native channel metadata is absent/different.

A browser/Expo Go/host preview is explicitly marked as insufficient to verify an installed SWISH APK. Missing native version/build is not replaced with potentially newer OTA app configuration values. Unknown runtime values are not guessed from a fingerprint policy object.

## Compare against GitHub evidence

1. Generate the report on the installed Android APK, not Live Preview.
2. Confirm native version/build against the intended APK release and its badging/build output.
3. Compare project ID against the Expo project used by the GitHub build/publisher (`EXPO_PROJECT_ID` or `EAS_PROJECT_ID`). The ID is public; do not share `EXPO_TOKEN` or any secret value.
4. Compare platform, channel and **exact runtime** with the approved build/OTA evidence. Unified builds use `preview-unified` or `production-unified`; isolated builds may use a niche-specific route. Do not assume they are interchangeable.
5. The existing unified pipeline retains `unified-android-evidence.json` with `runtimeVersion` and `channel`. Check its associated Expo configuration/project and the `swish-compatible-ota-publication` publisher receipt.
6. Once a compatible update is applied by an approved restart, compare the running update ID with the Android update's ID in the publisher receipt. A pending download does not change the running ID.
7. Project/channel/runtime agreement is metadata consistency, not proof of signing identity, binary authenticity, successful OTA delivery or production acceptance. Existing APK certificate/native-fingerprint release checks still apply.

No existing GitHub secrets, signing credentials, Expo project settings, release channels, or runtime policies were changed. No new native dependencies were introduced for this report.

## Privacy boundary

Collection and text formatting use explicit public-field allowlists, never a dump of `Constants`, `extra`, a manifest, request headers, or environment variables. Metadata values are bounded and validated. Full configuration, account/tenant data, backend URLs, tokens, API keys, signing keys and raw error messages are excluded. The feature creates no persistent report cache or backend upload. The user chooses the destination through the system share sheet; cancellation is not delivery confirmation.

## Verification status

Added `services/__tests__/appUpdateDiagnostics.test.ts` covering native-vs-configuration identity, project fallback provenance, missing/disabled updates, embedded/downloaded IDs, iOS, privacy filtering, malformed metadata, sharing/cancellation/error paths and the More route. Added `services/__tests__/updateDiagnosticsPreviewSafety.test.ts` exercising the real runtime guard for browser/host previews and missing native modules. The existing Node CI Jest configuration discovers both suites automatically.

Automated suites were authored but not executed in this editing environment. Installed Android/iOS sharing, narrow-screen/rotation layout and comparison with a real GitHub-built APK/publication receipt remain device acceptance checks.
