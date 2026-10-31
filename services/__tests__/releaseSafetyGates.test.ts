import fs from 'node:fs';
import path from 'node:path';

const read = (relativePath: string) => fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');

describe('Android and OTA release safety gates', () => {
  test('manual OTA release notes are passed through an environment variable, never shell interpolation', () => {
    const workflow = read('.github/workflows/publish-swish-ota.yml');
    expect(workflow).toContain('OTA_MESSAGE: ${{ inputs.message }}');
    expect(workflow).toContain('--message "$OTA_MESSAGE"');
    expect(workflow).not.toContain('--message "${{ inputs.message }}"');
    expect(workflow).toContain('Release note must contain 1–120 characters.');
  });

  test('niche and full-suite Android builds cannot continue after failed Jest tests', () => {
    for (const file of ['.github/workflows/_niche-android.yml', '.github/workflows/build-swish-suite.yml']) {
      const workflow = read(file);
      expect(workflow).not.toContain('continue-on-error: true');
      expect(workflow).toContain('Regression tests (mandatory release gate)');
    }
  });

  test('Master Admin APK verification checks package identity, label and signature', () => {
    const verifier = read('scripts/verify-master-admin-apk.sh');
    expect(verifier).toContain('EXPECTED_PACKAGE="com.swish.inventory"');
    expect(verifier).toContain('EXPECTED_LABEL="SWISH Master Admin"');
    expect(verifier).toContain('apksigner');
    expect(verifier).toContain('launchable-activity:');
  });
});
