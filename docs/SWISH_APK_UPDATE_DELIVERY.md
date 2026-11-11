# SWISH Android APK and Expo update delivery

## Status — 11 November 2026

Implementation and verification are distinct. The supplied OnSpace `SWISHFLIP.apk` was inspected directly: package `com.swish.inventory`, URI scheme `onspaceapp`, version `1.0.0`, versionCode `1794427891`, min SDK 24, target SDK 36. Its Expo Updates native setting is **disabled**, with no update URL/channel/runtime. It cannot receive this pipeline's OTA updates. JavaScript cannot retrofit its missing native configuration.

Original certificate SHA-256: `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`. This exactly matches the official Expo SDK 53 public testing keystore; both the APK certificate and downloaded template certificate were inspected, not inferred from comments. Original APK SHA-256: `3703deb6853480f2a8fff70c93d29ecdfa55bed1e2944a032878200d5b9f6a2f`. Evidence: `release/android-installed-baseline.json`.

The existing owner-requested Expo project is `dadff40d-3fba-46ef-a13c-88e1ba4e4f07`. This ID was configured in the repository, **not present in the original APK**. Authenticated project access must pass `verify-expo-project.mjs`; it has not yet been certified with the owner's Expo token.

No new APK has been verified, no OTA has been published and no installation/device acceptance has been performed. See `docs/SWISH_APK_VERIFICATION_STATUS.md` for executed checks and blockers. Do not interpret implemented controls or passing mocked tests as delivery evidence.

## One recommended route

Use GitHub **Build SWISH unified signed testing APK** (`build-swish-release-apk.yml`), which calls `build-swish-unified.yml`. Keep `SWISH_NICHE` empty, `SWISH_MASTER_ADMIN=0`, `SWISH_TEST_LAB=0`; the canonical `app` tree and all registered niches are included. The owner export contains Stamps alongside the twelve previously registered modules; its missing entry, registry record and companion application modules have been reconciled rather than deleting their callers.

The build preserves the original Android package/scheme and existing OnSpace Cloud/auth/storage/entitlements. Missing source files were recovered from the owner ZIP. Backend registry/shared files are generated mirrors; restoring source/migration files does **not** deploy an Edge Function or execute SQL. No backend deployment or user-data mutation was performed.

Other entry points `build-android-apk`, `build-swish-suite`, `master-admin-readiness` and `branded-web-builds` delegate to this same reusable pipeline. Legacy isolated niche APKs are manual migration tools behind `SWISH_ENABLE_LEGACY_MIGRATION_BUILDS`; they are not the unified release route. Test Lab uses its separate diagnostic identity with OTA disabled. `publish-ota-update.yml` is a review-only notice; it does not publish. Do not use an old Master Admin/niche channel or OnSpace's Download APK as evidence for unified delivery. Inspect any different OnSpace binary before making update claims.

## GitHub settings — exact owner actions

Repository → Settings → Secrets and variables → Actions:

| Setting | Storage | Required value/purpose |
| --- | --- | --- |
| `EXPO_PROJECT_ID` | Variable or Secret | Existing `dadff40d-3fba-46ef-a13c-88e1ba4e4f07`; `EAS_PROJECT_ID` alias is supported if the primary is absent |
| `EXPO_TOKEN` | **Secret** | Expo access token authorized for the existing project; never put it in chat/source/client config |
| `EXPO_PUBLIC_SUPABASE_URL` | Variable or Secret | Existing OnSpace Cloud public URL; do not create a Supabase project |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Variable or Secret | Existing public anon key, never a service-role key |
| `SWISH_RELEASE_KEYSTORE_BASE64` | **Secret** | Original approved keystore, base64 encoded |
| `SWISH_KEYSTORE_STORE_PASSWORD` | **Secret** | Original keystore password |
| `SWISH_KEYSTORE_KEY_PASSWORD` | **Secret** | Original private-key password |
| `SWISH_KEYSTORE_KEY_ALIAS` | **Secret** | Original signing alias |
| `SWISH_RELEASE_CERT_SHA256` | Variable or Secret | Inspected original certificate fingerprint, not a newly generated identity |

These are GitHub settings, not OnSpace Edge Function secrets. Do not expose private signing material in artifacts, source or chat.

For **preview only**, if **all five** signing settings are absent, the inspected public Expo testing key can be recovered with a pinned file checksum and certificate comparison. Partial settings fail. The fallback does not generate a key and does not certify production signing. Any configured certificate must match the inspected installed baseline. Testing certificates are prohibited for production, even if supplied explicitly.

The current original APK has a public testing identity. There is no approved private production identity in the current evidence. Production therefore remains blocked until the owner supplies verifiable original production-APK evidence or explicitly approves a signing-identity migration. Do not silently generate a key, recommend uninstalling, or change identity to get a build through.

In GitHub Environments, configure **required owner reviewers** for `swish-ota-approval` and retain the existing `swish-production-acceptance-review` protection. Merely naming an environment in YAML does not configure reviewers. Protect reviewed main. No publication was requested or approved by this implementation task.

In the **same existing Expo project**, align the EAS `preview`/`production` public backend environment values with GitHub's respective build values. OTA verification runs within `eas env:exec <environment> <command> --non-interactive` and publication uses the same `--environment`; backend/project/channel/fingerprint mismatches fail. Keep provider and service-role secrets out of public variables.

## Build and download

1. Review current main and resolve every failing mandatory source check. Add the settings above. Do not disable TypeScript, lint, tests, signing verification or production acceptance.
2. GitHub → Actions → **Build SWISH unified signed testing APK** → **Run workflow** → branch `main`, channel `preview-unified`. A workflow-only edit can trigger a fresh run if an old record has zero jobs. New APK runs supersede duplicate runs for the same ref. Cancel stale duplicates where authorized; deleting history is unnecessary.
3. The pipeline initializes checkout, Node 22, pnpm 9.15.9 and Java 17 before using tools. Native compilation initializes Android SDK/build tools 36 and the pinned APK inspector. Existing lockfile installation is retained.
4. Resolved config must contain `expo-updates` compatible with Expo SDK 53, enabled updates, the exact approved project URL, fingerprint runtime policy, approved channel, canonical route tree and matching public backend values. Anti-bricking and embedded recovery remain enabled. Authenticated project access is verified before release.
5. `app.json` versionCode `1794427892` exceeds the inspected original `1794427891`. For every later replacement release, commit a larger integer than **every distributed binary**, at most `2100000000`. Never change versionCode solely for compatible OTA publication.
6. For `production-unified`, also provide `production_acceptance_run`: a successful protected `production-acceptance-gate.yml` run for the exact current source SHA, with its retained eligible verdict. It cannot override failing/skipped checks or missing operational evidence.
7. Only after successful verification, open that successful run → Artifacts → **swish-unified-android** → download/extract. The APK is `swish-unified.apk`. Do not download the source ZIP or a diagnostics artifact as the app.
8. Verify its SHA-256 against `swish-unified.sha256`. Preserve the entire artifact. It includes source SHA, build run ID, version/code, certificate, actual compiled update URL/project/channel/runtime, permissions/SDK/launcher metadata, resolved config/runtime and signature output. Artifact retention is 90 days; retain an approved baseline beyond expiry before relying on it for future publication. Failed builds retain available source/compiler diagnostics.

The APK verifier inspects the **finished binary's compiled manifest/resources and actual certificate**, verifies its signature using `apksigner`, compares with resolved config/runtime and the installed baseline, and rejects mismatches. Generated `strings.xml` alone is no longer proof. `deviceAcceptance` remains `NOT TESTED` in generated receipts.

## Installation versus OTA

Install the verified replacement APK **in place**, using Android's installer; retain package, signing identity and increasing versionCode. Allow installation from the chosen trusted download app when Android asks. Do not uninstall or clear data as a normal upgrade. Stop on a signature mismatch and investigate the exact binary/certificate. If the key cannot be recovered, request an explicit migration/data-preservation decision.

After this initial update-enabled APK, compatible JavaScript/UI/assets need no Android installer. Native modules, permissions, SDK/packaging/configuration changes or a different runtime require another signed APK. Runtime versions must never be overridden to force compatibility.

## Manual, owner-approved OTA publication

1. First retain a **successful verified native baseline** from an approved unified main workflow, with the selected platform artifact. An old OTA-disabled OnSpace APK is not a baseline. Expired/missing artifacts fail closed.
2. Commit/review one compatible UI change on main. Target must descend from the native baseline. Native/package/permission/SDK/config/lockfile changes require a new APK. Use the exact same channel, approved project and exact resolved native fingerprint.
3. Actions → **Publish approved compatible unified SWISH update** → Run workflow on `main`: `platform=android`, matching `preview-unified`, `baseline_run=<successful APK run ID>`, short release message. Android does not require iOS artifacts or provisioning. `all` deliberately requires both. Production also requires its protected current-source acceptance run.
4. Review and explicitly approve the `swish-ota-approval` environment deployment. Do not grant approval merely to make a check pass. The workflow runs mandatory tests, verifies lineage, original signing identity, retained checksum, actual APK metadata/signature, backend environment and exact runtime before calling EAS.
5. Preserve **swish-compatible-ota-impact** and **swish-compatible-ota-publication** artifacts, including raw EAS output and the validated receipt listing update IDs/group/platform/runtime, project/channel/source/baseline run and publication run. A publisher receipt is not proof a device downloaded or ran it.

## In-app controls and acceptance

The single root `AppUpdatesProvider` checks after launch/foreground with a five-second delay and a fifteen-minute throttle; the native updater retains ON_LOAD behavior. Compatible downloads are staged. A visible **Update ready** notice and More → App updates share one pending state. Subsequent checks do not replace it with CURRENT. Active capture/edit sessions are never programmatically restarted. Restart requires user confirmation and a save-work reminder. Check/download errors retain the current bundle and allow retry; native release information is separate.

More → App updates provides check/retry, available/download/pending/restart states and shareable public diagnostics. Installed version/build come from native constants or supported `expo-application`, never OTA app-config version/code. A disabled updater, missing runtime, or false embedded flag without a running update ID reports **running bundle unknown**. Diagnostics refresh on view/share/foreground, have an explicit field/value allowlist, and exclude raw configuration, URLs, tokens, credentials, accounts and provider logs. Config-derived project/channel hints are explicitly unverified.

Real-device checklist (all currently **NOT TESTED**):

1. Install the verified preview APK in place. Record version/build, project, channel and runtime from diagnostics and compare to binary evidence.
2. Publish one small approved compatible UI change using the procedure above; retain the receipt.
3. Confirm download/Update ready without using the Android installer.
4. While capturing or editing, defer restart and verify no interruption. Save work, confirm restart.
5. Confirm the changed UI and **currently running** update ID match the publication receipt; a pending ID is insufficient.
6. Verify account access, inventory counts, original photos and saved drafts survive. Do not clear storage.
7. Test offline check/download failures, reconnect/retry, foreground throttling and pending-update preservation.
8. Verify the APK's other channel and incompatible runtime do not receive that update, using controlled test baselines. Do not change production channel mappings for this test.
9. Record device/Android version, observations, source/build/update IDs and evidence. Only then mark device acceptance passed.

## Owner-reviewed recovery — not executed

For a failed check/download, retain the current embedded/cached bundle and retry when online. For a downloaded but unapplied problem, defer restart and have the owner review the publication/runtime. For a bad applied compatible release, review an EAS republish of the retained last-known-good update or the supported rollback-to-embedded procedure, confirming project/channel/runtime and reviewing its effect before execution. Retain the recovery receipt and repeat device checks. Anti-bricking/error-recovery behavior stays enabled but is not itself device-test evidence.

Native recovery requires a signed replacement APK with the same identity and a versionCode above the faulty installed version. Do not install an older-code binary, rotate keys, clear data, or perform an automatic rollback. No recovery action, publication, backend deployment or production release was executed here.
