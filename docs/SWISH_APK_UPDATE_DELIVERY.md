# SWISH APK update delivery

## What is implemented
- One root update provider, shared by More → App updates and the in-app update notice. Update checks no longer depend on opening an admin/settings screen.
- Native Expo Updates retains its existing ON_LOAD behaviour. SWISH also checks after a short launch/foreground delay, at most every 15 minutes. Compatible updates are downloaded and staged without restarting an active capture or listing edit.
- A downloaded update shows a non-overlay notice. Restart requires confirmation, with an explicit reminder to save ongoing edits. A pending downloaded update is not replaced by a foreground check's CURRENT result.
- APK version/build use the actual installed native identity, not a newer OTA manifest. Verified native-release lookup does not recommend old/equal binaries.
- The approved OTA workflow now targets Android by default. Missing iOS provisioning no longer blocks Android-only delivery. Selecting all still requires both binaries. Both routes retain main/source, original signing, artifact checksums, project/channel, native-change and exact runtime-fingerprint checks.
- Native-build workflow supports preview-unified and production-unified, and refuses to compile an update-disabled configuration. No package identity, signing keys, backend environment values or entitlements were changed.

## First installation / existing APK
An APK already built with expo-updates, the approved Expo project URL, channel and compatible runtime can receive published updates without reinstalling. This session cannot inspect the currently installed APK. An APK missing that native configuration needs **one update-enabled replacement APK**, signed with the original certificate and retaining com.swish.inventory. JavaScript cannot retrofit a missing native updater. Adding native modules, permissions, SDK changes or a different runtime requires a new APK.

## Owner deployment steps
1. In the existing GitHub repository, configure EXPO_PROJECT_ID with the **existing** Expo project ID; store EXPO_TOKEN securely in GitHub Secrets. Keep the original signing settings/certificate. These are CI settings, not OnSpace Edge Function secrets. Do not paste keys in chat or create a replacement signing key/project.
2. Configure required reviewers for the swish-ota-approval GitHub environment. Keep production acceptance and branch protection requirements; this update route is not a production-readiness bypass.
3. Run **Build SWISH unified signed testing APK** on reviewed main, choosing preview-unified for testing or production-unified for the approved production baseline. Run the mandatory tests. Preserve the APK, generated update config and native evidence. Install that approved APK once if the current installation lacks support. Do not uninstall/clear app data merely to install an upgrade.
4. For subsequent **compatible JS/UI changes**, run **Publish approved compatible unified SWISH update**, select platform android, the same channel, the retained successful native baseline run ID and release notes. The target source must descend from the baseline; native/package/config changes and mismatched runtime fingerprints fail closed. A preview baseline cannot certify production-unified delivery.
5. On the installed APK, reopen the app or return to it, wait for the update-ready notice, save your work, then choose Restart. More → App updates displays channel/runtime/update ID and manual retry. Publishing a bundle is separate from producing/installing an APK.

## Device acceptance still required
- Record installed version, build, channel and runtime before publishing a small approved preview-only UI change.
- Publish for Android and that exact runtime; confirm downloaded notice and changed update ID/UI after restart **without using the Android installer**.
- Verify saved inventory/photos/account restoration and saved capture drafts survive restart.
- While editing, defer restart; confirm the app does not interrupt work. Test offline check/download, retry, background/foreground, pending-state retention and no duplicate notices.
- Confirm a different channel/runtime cannot receive the update. Preserve embedded/last-known-good bundles and Expo anti-bricking behaviour. Use the existing owner-reviewed EAS rollback tools for a bad compatible release; no rollback has been performed here.

## Actual execution status
Source changes and the release-catalogue read-only prerequisite were completed. No EXPO_PROJECT_ID/EXPO_TOKEN was supplied or configured by this editor. No workflow dispatch, compiler/test execution, APK build, EAS publication, installed-device test or go-live certification occurred. Node policy tests and Jest regressions were added to the mandatory CI flow; their results remain pending.
