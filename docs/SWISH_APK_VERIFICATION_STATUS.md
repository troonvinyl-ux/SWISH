# SWISH APK verification status — 11 November 2026

This is a source-delivery checkpoint, not a release certificate.

| Stage | Observed result |
| --- | --- |
| Original owner APK inspected | Package/scheme/version/certificate/SDK and disabled updater verified from compiled binary |
| Fresh GitHub retry | Run 43102721099 started and exposed missing signing settings |
| Preview signing recovery | Run 43103128524 passed signing and resolved OTA config, then failed TypeScript before native compilation |
| Current TypeScript | PASS after attached-source reconciliation; `node node_modules/typescript/bin/tsc --noEmit` returned 0 |
| Existing Expo lint | PASS, 0 errors / 369 warnings; `pnpm@9.15.9 exec expo lint` |
| Update/diagnostics Jest suites | PASS: 3 suites, 30 tests |
| Release/OTA/production policy Node tests | PASS: 23 tests |
| Compiled-metadata verifier Python tests | PASS: 2 tests, including mismatch rejection cases |
| Canonical niche contracts / backend source mirror parity | PASS: 13 modules, generated asset parity |
| Full unit suite before final reconciliation | FAIL: 72 suites / 215 tests failed; 94 suites / 2181 tests passed |
| Final full unit suite | FAIL: 73 suites / 244 tests failed; 93 suites / 2152 tests passed (166 suites / 2396 tests executed) |
| Android JS export | PASS on final single-worker retry: Android Hermes bundle and assets exported. This is JavaScript bundling, not a signed APK build. Earlier failures: resource exit 137, then a missing Stamps image reference (repaired). |
| Authenticated owner Expo project check | NOT VERIFIED; requires configured owner EXPO_TOKEN |
| New APK compiled and verified | NOT COMPLETE |
| OTA published / receipt created | NOT PERFORMED; explicit owner approval required |
| Real-device installation/update/data-preservation acceptance | NOT TESTED |

## Changes and purpose

- Existing unified workflows initialize tools before use, retain diagnostics, verify original testing identity only for preview and prohibit production testing certificates. No new release system or backend was created.
- Resolved configuration, native APK compiled metadata/resources/signature/certificate, versionCode, project/channel/runtime and recovery settings are cross-checked. Baseline OTA verification re-inspects the actual retained APK.
- Missing signing/project/backend credentials fail clearly. Production requires the existing protected acceptance workflow and exact current-source verdict. OTA additionally requires a real configured owner reviewer, reviewed main lineage, retained native evidence/checksum and exact runtime.
- Native version/build no longer fall back to OTA app config. Disabled/insufficient native metadata reports running bundle unknown. The restored diagnostics service/hook uses a safe allowlist, fresh collection, clean observer teardown and a share fallback.
- The original one-provider update-ready/confirmed-restart flow remains. Existing mocked update checks, offline retry and pending-check suppression are tested; actual on-device pending/restart/data preservation remains untested.
- Missing application/companion source was recovered from the owner ZIP while preserving the existing Expo release configuration. Canonical route types are regenerated before TypeScript. Existing Stamps source is included in registry/acceptance scope, increasing checks rather than dropping the feature. No migration, Edge Function or user-data operation was executed.
- Two barcode web dependencies used by existing code were missing. The existing Supabase client was updated within major version 2 (to 2.119.0) because the old locked Functions SDK did not implement the AbortSignal option already used by the application. Existing backend/auth configuration is retained. PostgREST cancellation now attaches before single-result conversion. Full service regressions remain mandatory; this is not an assertion that authentication is device-tested.

Fresh run [43108119979](https://github.com/troonvinyl-ux/SWISH/actions/runs/43108119979), source `7cdb6e484b0e345f9422400f71b0581fe85ffb0f`, passed tool setup, inspected original preview signing and dependency installation. It stopped because EAS rejected the existing empty SWISH_NICHE profile env strings before project access could be checked. Those profile keys have now been omitted (unset selects unified); the resulting eas.json was validated successfully using the actual EAS CLI 27.2.0 Joi schema, and a regression test was added. Live workflow validation also caught a duplicate iOS environment key; it was repaired with a duplicate-key regression test. These failures are recorded rather than reported as successful builds.

## Release blockers and owner decisions

1. Every remaining full-suite failure must be repaired and all mandatory CI gates must pass before any APK is described as verified. Examples observed include listing publication/reconciliation, original-image byte handling, photo carry-forward and source/implementation contracts. No check was removed or changed to ignore these failures. The complete final unit command returned failure; the focused update suites are separately passing.
2. GitHub must provide the existing Expo project token and existing public OnSpace URL/anon key. Configure required owner reviewers for swish-ota-approval and matching EAS preview/production public environments. See the settings table and exact workflow/download steps in SWISH_APK_UPDATE_DELIVERY.md. Token/account ownership is not proved by the original APK, which contained no Expo project ID.
3. The inspected original signing identity is public/testing-only. It supports the matching preview replacement path. Production requires verified original production signing evidence or an explicit migration decision; it cannot silently adopt a new key.
4. Retain the successful APK artifact and publication receipt, then perform the full nine-step device checklist. No device or publication claim can be inferred from source tests.

The installed EAS CLI 27.2.0 help/source was also inspected: `env:exec` takes a positional environment, `project:info` has no JSON flag, and update JSON exposes id/group/platform/runtimeVersion/gitCommitHash. The pipeline uses these actual interfaces; no authenticated publication was attempted. Local resolved Expo config validation and managed Android fingerprint resolution passed, which is not compiled-binary verification.
