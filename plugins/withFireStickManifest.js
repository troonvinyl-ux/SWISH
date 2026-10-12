// plugins/withFireStickManifest.js
//
// Makes SWISH installable on Amazon Fire TV / Fire Stick and other Android TV
// devices.  "Application not installed" on Fire Stick has multiple independent
// causes — this plugin addresses ALL of them in one place.
//
// Root causes of "App not installed" on Fire Stick:
//
//  1. TOUCHSCREEN  — Android's default implicit requirement.  Any <uses-feature>
//     that references touch or faketouch being required=true blocks installation.
//
//  2. CAMERA       — expo-camera, expo-image-picker, and CameraX all inject
//     android.hardware.camera as required.  Fire Stick has no camera.
//
//  3. MICROPHONE   — react-native-reanimated and other libs may inject this.
//
//  4. SENSORS / GPS / TELEPHONY — common library side-effects.
//
//  5. PERMISSIONS  — RECORD_AUDIO, ACCESS_FINE_LOCATION, READ_CONTACTS etc.
//     If these are declared as required, Android checks for the hardware at
//     install time on some Fire OS versions.
//
//  6. MISSING LEANBACK feature — Fire TV launcher requires
//     android.software.leanback to be declared (even as required=false).
//
//  7. MISSING TV activity intent — android.intent.category.LEANBACK_LAUNCHER
//     must be in at least one <activity> intent-filter.
//
//  NOTE: edgeToEdgeEnabled is deliberately NOT set in app.json because it
//  injects android:windowLayoutInDisplayCutoutMode which is not supported on
//  older Fire OS 5/6 devices and causes a runtime crash at launch.

const { withAndroidManifest } = require('@expo/config-plugins');

// ── Hardware features that must be declared as optional ──────────────────────
const OPTIONAL_FEATURES = [
  // ── Touch / pointer input ─────────────────────────────────────────────────
  'android.hardware.touchscreen',
  'android.hardware.touchscreen.multitouch',
  'android.hardware.touchscreen.multitouch.distinct',
  'android.hardware.touchscreen.multitouch.jazzhand',
  'android.hardware.faketouch',
  'android.hardware.faketouch.multitouch.distinct',
  'android.hardware.faketouch.multitouch.jazzhand',

  // ── Camera (expo-camera, expo-image-picker, CameraX inject these) ─────────
  'android.hardware.camera',
  'android.hardware.camera.any',
  'android.hardware.camera.front',
  'android.hardware.camera.autofocus',
  'android.hardware.camera.flash',
  'android.hardware.camera.level.full',
  'android.hardware.camera.capability.manual_sensor',
  'android.hardware.camera.capability.manual_post_processing',
  'android.hardware.camera.capability.raw',

  // ── Audio / microphone ────────────────────────────────────────────────────
  'android.hardware.microphone',

  // ── Location / GPS ────────────────────────────────────────────────────────
  'android.hardware.location',
  'android.hardware.location.gps',
  'android.hardware.location.network',

  // ── Telephony ─────────────────────────────────────────────────────────────
  'android.hardware.telephony',
  'android.hardware.telephony.gsm',
  'android.hardware.telephony.cdma',

  // ── Sensors (injected by various RN libs) ─────────────────────────────────
  'android.hardware.sensor.accelerometer',
  'android.hardware.sensor.barometer',
  'android.hardware.sensor.compass',
  'android.hardware.sensor.gyroscope',
  'android.hardware.sensor.light',
  'android.hardware.sensor.proximity',
  'android.hardware.sensor.stepdetector',
  'android.hardware.sensor.stepcounter',

  // ── Connectivity ──────────────────────────────────────────────────────────
  'android.hardware.wifi',
  'android.hardware.bluetooth',
  'android.hardware.bluetooth_le',
  'android.hardware.nfc',
  'android.hardware.usb.host',
  'android.hardware.usb.accessory',

  // ── Screen / display ──────────────────────────────────────────────────────
  'android.hardware.screen.portrait',
  'android.hardware.screen.landscape',
];

// ── Permissions that must NOT block installation on Fire OS ──────────────────
// Some Fire OS versions check whether the device has the hardware associated
// with a permission at install time.  Marking the related <uses-feature>
// as optional is usually enough, but we also remove any explicit
// android:required="true" from permission declarations.
const PERMISSIONS_TO_MAKE_OPTIONAL = [
  'android.permission.CAMERA',
  'android.permission.RECORD_AUDIO',
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.READ_CONTACTS',
  'android.permission.WRITE_CONTACTS',
  'android.permission.READ_CALL_LOG',
  'android.permission.WRITE_CALL_LOG',
];

module.exports = function withFireStickManifest(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;

    // ── 1. Ensure uses-feature array exists ──────────────────────────────────
    if (!manifest['uses-feature']) {
      manifest['uses-feature'] = [];
    }

    // ── 2. Mark all absent-on-Fire-Stick features as optional ────────────────
    for (const featureName of OPTIONAL_FEATURES) {
      const idx = manifest['uses-feature'].findIndex(
        (f) => f.$ && f.$['android:name'] === featureName,
      );
      if (idx >= 0) {
        manifest['uses-feature'][idx].$['android:required'] = 'false';
      } else {
        manifest['uses-feature'].push({
          $: { 'android:name': featureName, 'android:required': 'false' },
        });
      }
    }

    // ── 3. Declare Leanback (Fire TV launcher requires this) ─────────────────
    const hasLeanback = manifest['uses-feature'].some(
      (f) => f.$ && f.$['android:name'] === 'android.software.leanback',
    );
    if (!hasLeanback) {
      manifest['uses-feature'].push({
        $: { 'android:name': 'android.software.leanback', 'android:required': 'false' },
      });
    }

    // ── 4. Remove android:required="true" from sensitive permissions ─────────
    if (Array.isArray(manifest['uses-permission'])) {
      for (const perm of manifest['uses-permission']) {
        if (
          perm.$ &&
          PERMISSIONS_TO_MAKE_OPTIONAL.includes(perm.$['android:name']) &&
          perm.$['android:required'] === 'true'
        ) {
          delete perm.$['android:required'];
        }
      }
    }

    // ── 5. Ensure LEANBACK_LAUNCHER intent on the main activity ─────────────
    // Some Expo builds only add LAUNCHER, not LEANBACK_LAUNCHER. The Fire TV
    // home screen requires LEANBACK_LAUNCHER to be present in an activity's
    // intent-filter to show the app icon in the launcher.
    try {
      const app = manifest.application?.[0];
      if (app && Array.isArray(app.activity)) {
        for (const activity of app.activity) {
          const intentFilters = activity['intent-filter'];
          if (!Array.isArray(intentFilters)) continue;

          let hasLauncher = false;
          let hasLeanbackLauncher = false;

          for (const filter of intentFilters) {
            const categories = filter.category || [];
            for (const cat of categories) {
              if (cat.$?.['android:name'] === 'android.intent.category.LAUNCHER') hasLauncher = true;
              if (cat.$?.['android:name'] === 'android.intent.category.LEANBACK_LAUNCHER') hasLeanbackLauncher = true;
            }
          }

          // If this activity has a LAUNCHER intent-filter but no LEANBACK_LAUNCHER, add one
          if (hasLauncher && !hasLeanbackLauncher) {
            // Find the LAUNCHER filter and inject LEANBACK_LAUNCHER into the same filter
            for (const filter of intentFilters) {
              const categories = filter.category || [];
              const hasMain = filter.action?.some?.(
                (a) => a.$?.['android:name'] === 'android.intent.action.MAIN',
              );
              const hasLauncherCat = categories.some(
                (c) => c.$?.['android:name'] === 'android.intent.category.LAUNCHER',
              );
              if (hasMain && hasLauncherCat) {
                if (!filter.category) filter.category = [];
                filter.category.push({
                  $: { 'android:name': 'android.intent.category.LEANBACK_LAUNCHER' },
                });
                break;
              }
            }
          }
        }
      }
    } catch (e) {
      // Non-fatal — intent filter injection is a best-effort enhancement
      console.warn('[withFireStickManifest] Intent filter injection failed:', e.message);
    }

    return cfg;
  });
};
