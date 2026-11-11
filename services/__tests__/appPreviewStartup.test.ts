// Mocked preview/runtime regression tests; installed iOS/Android acceptance is separate.
import fs from 'node:fs';

const loadRuntime = (platform: string, environment: string, missing = false, enabled = true) => {
  jest.resetModules();
  const updates = { isEnabled: enabled, isEmbeddedLaunch: true, channel: 'preview-unified', runtimeVersion: 'compatible-runtime', updateId: null, checkForUpdateAsync: jest.fn().mockResolvedValue({ isAvailable: true }), fetchUpdateAsync: jest.fn().mockResolvedValue({ isNew: true }), reloadAsync: jest.fn().mockResolvedValue(undefined) };
  const evaluation = jest.fn();
  jest.doMock('react-native', () => ({ Platform: { OS: platform }, Linking: { openURL: jest.fn() } }));
  jest.doMock('expo-constants', () => ({ executionEnvironment: environment, nativeAppVersion: '1.0.0', expoConfig: {} }));
  jest.doMock('expo-updates', () => { evaluation(); if (missing) throw new Error('Cannot find native module ExpoUpdates'); return updates; });
  jest.doMock('@/template', () => ({ getSupabaseClient: jest.fn() }));
  const runtime = require('../appUpdatesRuntimeService') as typeof import('../appUpdatesRuntimeService');
  const service = require('../appUpdateService') as typeof import('../appUpdateService');
  return { runtime, service, updates, evaluation };
};

test.each(['ios', 'android'])('%s preview does not evaluate the host-owned updates package', async platform => {
  const { runtime, service, evaluation } = loadRuntime(platform, 'storeClient', true);
  expect(runtime.getAppUpdatesRuntime()).toBeNull();
  expect(service.installedAppVersion().otaEnabled).toBe(false);
  expect(evaluation).not.toHaveBeenCalled();
  expect((await service.checkCompatibleUpdate()).available).toBe(false);
});
test('browser preview never imports a native updates module', () => {
  const { service, evaluation } = loadRuntime('web', 'bare', true);
  expect(service.installedAppVersion().otaEnabled).toBe(false);
  expect(evaluation).not.toHaveBeenCalled();
});
test('a host missing ExpoUpdates keeps startup and repeated version reads usable', async () => {
  const { service, evaluation } = loadRuntime('ios', 'bare', true);
  expect(() => service.installedAppVersion()).not.toThrow();
  expect(service.installedAppVersion()).toMatchObject({ otaEnabled: false, runtime: null });
  expect((await service.downloadCompatibleUpdate()).ready).toBe(false);
  expect(evaluation).toHaveBeenCalledTimes(1);
});
test('a disabled native updates module does not run update APIs', async () => {
  const { service, updates } = loadRuntime('android', 'bare', false, false);
  expect(service.installedAppVersion().otaEnabled).toBe(false);
  expect((await service.checkCompatibleUpdate()).available).toBe(false);
  expect(updates.checkForUpdateAsync).not.toHaveBeenCalled();
});
test('a compatible APK still checks, stages and applies only after an explicit request', async () => {
  const { service, updates } = loadRuntime('android', 'standalone');
  expect(service.installedAppVersion()).toMatchObject({ otaEnabled: true, runtime: 'compatible-runtime', channel: 'preview-unified' });
  expect(await service.checkCompatibleUpdate()).toEqual({ available: true, error: null });
  expect(await service.downloadCompatibleUpdate()).toEqual({ ready: true, error: null });
  expect(updates.reloadAsync).not.toHaveBeenCalled();
  expect(await service.applyCompatibleUpdate()).toBeNull();
  expect(updates.reloadAsync).toHaveBeenCalledTimes(1);
});
test('core startup never imports expo-updates eagerly or subscribes unconditionally', () => {
  for (const path of ['services/appUpdateService.ts', 'hooks/useAppUpdateController.ts']) {
    const source = fs.readFileSync(path, 'utf8');
    expect(source).not.toMatch(/import\s+\*\s+as\s+Updates\s+from\s+['"]expo-updates['"]/);
    expect(source).not.toContain('Updates.useUpdates()');
  }
  const provider = fs.readFileSync('contexts/AppUpdatesContext.tsx', 'utf8');
  expect(provider).toContain('supportsAppUpdates()');
  expect(provider).toContain('NativeUpdateObserverBoundary');
  expect(provider).toContain('NativeUpdateObserver');
  const root = fs.readFileSync('app/_layout.tsx', 'utf8');
  expect(root.indexOf('<AlertProvider>')).toBeLessThan(root.indexOf('<AppStartupBoundary>'));
  expect(root).toContain('<Stack.Screen name="index"');
  expect(root).toContain('<AppStartupBoundary>');
});
