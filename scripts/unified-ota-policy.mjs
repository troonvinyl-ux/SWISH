// Pure Android/iOS update targeting. Never publishes, changes channels or overrides runtime versions.
export function selectedOtaPlatforms(selection) {
  if (selection === 'android' || selection === 'ios') return [selection];
  if (selection === 'all') return ['android', 'ios'];
  throw Error('Choose android, ios or all for OTA publication.');
}
const baselineWorkflows = new Set([
  '.github/workflows/build-swish-unified.yml',
  '.github/workflows/build-swish-release-apk.yml',
  '.github/workflows/build-android-apk.yml',
]);
export function assertOtaBaselineRun(run) {
  if (run?.conclusion !== 'success' || run?.head_branch !== 'main' || !baselineWorkflows.has(run?.path) || !/^[a-f0-9]{40}$/.test(run?.head_sha ?? '')) throw Error('A successful original-identity unified native workflow on main is required.');
}
export function assertCompatibleRuntime(baseline, resolved, channel, platform) {
  if (baseline?.binaryVerified !== true || baseline.platform !== platform || !baseline.runtimeVersion || baseline.channel !== channel || !resolved?.runtimeVersion || resolved.runtimeVersion !== baseline.runtimeVersion) throw Error(`Actual ${platform} native runtime or channel mismatch. Build a new compatible binary; do not override its fingerprint.`);
}
export function assertNoNativeOtaChanges(changedFiles) {
  const native = /^(app\.(config\.(js|ts)|json)|eas\.json|package\.json|.*lock.*|(?:metro|babel|react-native)\.config\..*|niche-modules\.json|android\/|ios\/|plugins\/|native\/|scripts\/prepare-niche)/;
  if (changedFiles.some(file => native.test(file))) throw Error('Native or packaging changes require new native builds, not OTA.');
}
