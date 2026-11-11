// Exercise the real guarded Expo Updates runtime, not the mocked diagnostics/runtime boundary.
// These are Node regressions, not installed-device acceptance.
function loadDiagnostics(platform: string, environment: string, missing = false) {
  jest.resetModules();
  const evaluation = jest.fn();
  const share = jest.fn().mockResolvedValue({ action: 'sharedAction' });
  const updates = { isEnabled: true, isEmbeddedLaunch: true, channel: 'preview-unified', runtimeVersion: 'native-fingerprint', updateId: null,
    checkForUpdateAsync: jest.fn(), fetchUpdateAsync: jest.fn(), reloadAsync: jest.fn() };
  jest.doMock('react-native', () => ({ Platform: { OS: platform }, Share: { share, sharedAction: 'sharedAction', dismissedAction: 'dismissedAction' } }));
  jest.doMock('expo-constants', () => ({ executionEnvironment: environment, nativeAppVersion: '1.0.0', nativeBuildVersion: '8', easConfig: { projectId: '12345678-1234-1234-1234-123456789abc' }, expoConfig: { extra: { token: 'PRIVATE_CONFIG_TOKEN' } } }));
  jest.doMock('expo-updates', () => { evaluation(); if (missing) throw new Error('Missing native ExpoUpdates module'); return updates; });
  const diagnostics = require('../appUpdateDiagnosticsService') as typeof import('../appUpdateDiagnosticsService');
  return { diagnostics, evaluation, share, updates };
}

test.each([['web', 'bare'], ['ios', 'storeClient'], ['android', 'storeClient']])('%s/%s report does not evaluate native host-owned updates', (platform, environment) => {
  const { diagnostics, evaluation } = loadDiagnostics(platform, environment, true);
  expect(evaluation).not.toHaveBeenCalled();
  const report = diagnostics.collectUpdateDiagnostics();
  expect(report).toMatchObject({ installedVersion: null, androidBuild: null, channel: null, runtime: null, otaEnabled: false });
  const text = diagnostics.formatUpdateDiagnostics(report);
  expect(text).toContain('Preview report only');
  expect(text).not.toContain('PRIVATE_CONFIG_TOKEN');
  expect(evaluation).not.toHaveBeenCalled();
});
test('a native host without ExpoUpdates can repeatedly view and share a safe report', async () => {
  const { diagnostics, evaluation, share } = loadDiagnostics('android', 'bare', true);
  const report = diagnostics.collectUpdateDiagnostics();
  expect(report).toMatchObject({ installedVersion: '1.0.0', androidBuild: '8', otaEnabled: false, runtime: null });
  expect(() => diagnostics.collectUpdateDiagnostics()).not.toThrow();
  expect(evaluation).toHaveBeenCalledTimes(1);
  expect(await diagnostics.shareUpdateDiagnostics(report)).toBe('shared');
  expect(share).toHaveBeenCalledTimes(1);
  expect(share.mock.calls[0][0].message).not.toContain('PRIVATE_CONFIG_TOKEN');
});
test('installed APK diagnostics are observational and never check, fetch or apply an update', () => {
  const { diagnostics, updates, evaluation } = loadDiagnostics('android', 'standalone');
  expect(evaluation).not.toHaveBeenCalled();
  const report = diagnostics.collectUpdateDiagnostics();
  expect(report).toMatchObject({ runtime: 'native-fingerprint', channel: 'preview-unified', otaEnabled: true });
  expect(evaluation).toHaveBeenCalledTimes(1);
  expect(updates.checkForUpdateAsync).not.toHaveBeenCalled();
  expect(updates.fetchUpdateAsync).not.toHaveBeenCalled();
  expect(updates.reloadAsync).not.toHaveBeenCalled();
});
