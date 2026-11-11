# SWISH preview startup recovery

The reported iOS screen is white with the OnSpace preview control still visible. It contains no SWISH loading message or error. Database availability was checked successfully; no Live Preview network traffic or device JS logs were available. The image alone does not establish the exact exception.

## Source-level issue addressed

The root update provider previously imported `expo-updates` eagerly in two dependencies and called `Updates.useUpdates()` in every host. Expo's native Updates package can require a native module during evaluation, before an error boundary can render. The OnSpace preview host does not necessarily expose the same native module/API as a built SWISH APK.

- Preview/browser hosts skip native Updates module evaluation.
- Other runtimes load it lazily inside a guarded operation; a missing native module does not throw out of startup.
- The optional native update observer is mounted only when updates are enabled and its hook exists. An observer error cannot unmount app navigation or an in-progress capture.
- Compatible release APKs retain update checks, background staging, detection of native pending updates and explicitly confirmed restarts.
- An app render boundary provides a retry screen rather than leaving a render failure blank. Retrying restores the existing auth/session flow; it does not sign out or change database records.

No runtime identity, OTA channel/fingerprint, provider credentials, user data or access policies were changed. No APK or OTA update was published by these source edits.

## Verification still required

Mocked regressions were added in `services/__tests__/appPreviewStartup.test.ts` for iOS/Android preview, browser preview, missing native module, disabled updates, and compatible release update check/download/restart. The editing environment does not expose a test runner or real-device JS console; these tests have not been executed here.

Reopen the OnSpace iOS preview and confirm login/workspace navigation appears. If it still remains white, use the preview wrench to share the exact JavaScript/load error; an import/bundle failure before React mounts cannot be handled by a React error boundary. Separately verify the Android APK OTA flow after compatible update publication.
