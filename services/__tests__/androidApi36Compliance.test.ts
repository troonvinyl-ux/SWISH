import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

test('all Android prebuilds install the canonical API 36 config plugin', () => {
  const app = JSON.parse(read('app.json'));
  expect(app.expo.plugins).toContain('./plugins/withAndroidSdk36');
  const plugin = read('plugins/withAndroidSdk36.js');
  expect(plugin).toContain("'android.compileSdkVersion': '36'");
  expect(plugin).toContain("'android.targetSdkVersion': '36'");
  expect(plugin).toContain("'android.buildToolsVersion': '36.0.0'");
});

test('unified and isolated niche APK builds install and verify Android 16 SDK', () => {
  for (const workflow of ['.github/workflows/_niche-android.yml', '.github/workflows/build-swish-unified.yml']) {
    const source = read(workflow);
    expect(source).toContain('platforms;android-36');
    expect(source).toContain('build-tools;36.0.0');
    expect(source).toContain('scripts/verify-android-sdk-config.mjs');
  }
  expect(read('scripts/verify-apk.sh')).toContain("targetSdkVersion:'36'");
  expect(read('scripts/inspect-unified-apk.py')).toContain("'targetSdk': 36");
  expect(read('.github/workflows/build-swish-unified.yml')).toContain('bash scripts/verify-unified-apk.sh');
});

test('generated Gradle properties are checked fail-closed before native compilation', () => {
  const verifier = read('scripts/verify-android-sdk-config.mjs');
  expect(verifier).toContain("'android.compileSdkVersion': '36'");
  expect(verifier).toContain("'android.targetSdkVersion': '36'");
  expect(verifier).toContain("'android.buildToolsVersion': '36.0.0'");
  expect(verifier).toContain('process.exit(1)');
});

test('EAS exposes isolated APK and Android App Bundle profiles for all ten niches', () => {
  const eas = JSON.parse(read('eas.json'));
  const niches = ['coins', 'motocross', 'bicycles', 'clothing', 'surplus_flip', 'trading_cards', 'antiques', 'fossils', 'beauty', 'tech'];
  for (const niche of niches) {
    expect(eas.build[niche]).toMatchObject({ env: { SWISH_NICHE: niche }, android: { buildType: 'apk' } });
    expect(eas.build[niche + '-play']).toMatchObject({ env: { SWISH_NICHE: niche }, android: { buildType: 'app-bundle' } });
  }
  expect(eas.build['master-admin']).toMatchObject({ env: { SWISH_MASTER_ADMIN: '1' }, android: { buildType: 'apk' } });
});

test('Android native builds keep runtime compatibility explicit and OTA review cannot publish alone', () => {
  const config = read('app.config.js');
  expect(config).toContain('isolated-api36-v1');
  expect(config).toContain("runtimeVersion: { policy: 'fingerprint' }");
  expect(config).toContain("updates: { ...(baseConfig.updates || {}), enabled: false, checkAutomatically: 'NEVER' }");
  const ota = read('.github/workflows/publish-ota-update.yml');
  expect(ota).toContain('workflow_dispatch:');
  expect(ota).not.toContain('\n  push:');
  expect(ota).toContain('no automatic publication');
});

test('Android SDK licence acceptance tolerates sdkmanager acknowledgement exit without masking package installation errors', () => {
  const niche = read('.github/workflows/_niche-android.yml');
  expect(niche).toContain('set +o pipefail');
  expect(niche).toContain('set -o pipefail');
  for (const file of ['.github/workflows/build-swish-unified.yml', '.github/workflows/test-lab-apk.yml']) {
    const workflow = read(file);
    expect(workflow).toContain('--licenses >/dev/null || true');
    expect(workflow).toContain('platform-tools');
    expect(workflow).toMatch(/SDK_MANAGER|sdkmanager/);
  }
});
