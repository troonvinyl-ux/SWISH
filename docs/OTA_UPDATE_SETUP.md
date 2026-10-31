# SWISH OTA update setup

This repository now contains a manual OTA release workflow and an owner-only in-app update control.

## One-time GitHub configuration

In the SWISH repository, open **Settings → Secrets and variables → Actions**.

Add this repository variable:

- `EXPO_PROJECT_ID`: the EAS project UUID for the SWISH Expo project.

Add this repository secret:

- `EXPO_TOKEN`: an Expo access token authorised to publish updates to that project.

The project ID is not a secret; the access token is.

## One-time native release

OTA updates cannot add native modules, Android permissions, package identifiers, or other native changes. The installed APK must first be built with the EAS project ID so its update URL, runtime version and channel are embedded.

After setting the variable, run **Build SWISH Complete APK Suite** and download/install the Master APK. This is the one-time enabling build for devices whose current APK was built without OTA configuration.

## Publish a routine app update

After code is merged to `main`, open **Actions → Publish SWISH OTA Update → Run workflow**.

Choose:
- `master` for the Master Admin APK, or
- the exact niche for a niche APK.

Enter a short release note and run it. The workflow validates the Expo update configuration before publishing to that app's existing production channel.

The owner opens **Master Admin → Update SWISH** to check, download and apply a compatible update. The app asks before reloading.

## Important limits

- The installed app must already have OTA enabled and use the same runtime version/channel.
- OTA is for JavaScript, screens, styles and compatible bundled assets.
- Native dependency, Android manifest, permissions, package identity, or runtime-version changes still require a new APK.
- Never put `EXPO_TOKEN` in a repository variable, source file, or client app.
