// Mocked public-metadata/share regressions; installed Android/iOS sharing remains a device check.
jest.mock('react-native', () => ({ Platform: { OS: 'android' }, Share: { share: jest.fn(), dismissedAction: 'dismissedAction', sharedAction: 'sharedAction' } }));
jest.mock('expo-constants', () => ({ executionEnvironment: 'standalone', nativeAppVersion: '1.2.3', nativeBuildVersion: '17', easConfig: {}, expoConfig: {} }));
jest.mock('../appUpdatesRuntimeService', () => ({ getAppUpdatesRuntime: jest.fn(), supportsAppUpdates: jest.fn() }));
import fs from 'node:fs';
import Constants from 'expo-constants';
import { Platform, Share } from 'react-native';
import { getAppUpdatesRuntime, supportsAppUpdates } from '../appUpdatesRuntimeService';
import { collectUpdateDiagnostics, formatUpdateDiagnostics, shareUpdateDiagnostics } from '../appUpdateDiagnosticsService';

const nativeProject = '11111111-2222-3333-4444-555555555555';
const configProject = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const updateId = '01234567-89ab-cdef-0123-456789abcdef';
const now = new Date('2026-11-11T12:00:00.000Z');
const fixture = { channel: 'preview-unified', runtimeVersion: 'fingerprint-native-1234', updateId: null, isEmbeddedLaunch: true };
beforeEach(() => {
  jest.clearAllMocks();
  (Platform as any).OS = 'android';
  Object.assign(Constants, { executionEnvironment: 'standalone', nativeAppVersion: '1.2.3', nativeBuildVersion: '17', easConfig: { projectId: nativeProject }, expoConfig: {
    version: '9.9.9', android: { versionCode: 999 }, extra: { eas: { projectId: configProject }, supabase: { url: 'https://backend.example', anonKey: 'SUPABASE_SECRET_MARKER' }, token: 'EXPO_TOKEN_MARKER', signingKey: 'SIGNING_KEY_MARKER' },
    updates: { url: 'https://u.expo.dev/private-url', requestHeaders: { 'expo-channel-name': 'production-unified', Authorization: 'BEARER_SECRET_MARKER' } },
  } });
  (getAppUpdatesRuntime as jest.Mock).mockReturnValue({ ...fixture });
  (supportsAppUpdates as jest.Mock).mockReturnValue(true);
  (Share.share as jest.Mock).mockResolvedValue({ action: Share.sharedAction });
});

test('reports native version/build and exact current route, not newer OTA config values', () => {
  const report = collectUpdateDiagnostics(now);
  expect(report).toMatchObject({ schemaVersion: 1, generatedAt: now.toISOString(), installedVersion: '1.2.3', androidBuild: '17', projectId: nativeProject, projectIdSource: 'eas_metadata', channel: 'preview-unified', configuredChannel: 'production-unified', runtime: fixture.runtimeVersion, updateId: null, otaEnabled: true, launch: 'embedded' });
  const text = formatUpdateDiagnostics(report);
  expect(text).toContain('Installed version: 1.2.3');
  expect(text).toContain('Android build (versionCode): 17');
  expect(text).toContain('App config channel (not native-verified): production-unified');
  expect(text).not.toContain('9.9.9');
});
test('configuration project fallback is explicitly not APK-verified', () => {
  (Constants as any).easConfig = null;
  const report = collectUpdateDiagnostics(now);
  expect(report.projectId).toBe(configProject);
  expect(report.projectIdSource).toBe('app_configuration');
  expect(formatUpdateDiagnostics(report)).toContain('Project ID source: App configuration (not APK-verified)');
});
test.each(['web', 'storeClient'])('%s does not identify preview-host version as an installed SWISH binary', host => {
  if (host === 'web') (Platform as any).OS = 'web';
  else (Constants as any).executionEnvironment = host;
  (getAppUpdatesRuntime as jest.Mock).mockReturnValue(null);
  (supportsAppUpdates as jest.Mock).mockReturnValue(false);
  const report = collectUpdateDiagnostics(now);
  expect(report).toMatchObject({ installedVersion: null, androidBuild: null, runtime: null, channel: null, updateId: null, otaEnabled: false, launch: 'unavailable' });
  expect(formatUpdateDiagnostics(report)).toContain('Preview report only');
  expect(formatUpdateDiagnostics(report)).not.toContain('Installed version: 1.2.3');
});
test('missing or disabled update module is reported without checking, fetching or restarting', () => {
  (getAppUpdatesRuntime as jest.Mock).mockReturnValue(null);
  (supportsAppUpdates as jest.Mock).mockReturnValue(false);
  expect(formatUpdateDiagnostics(collectUpdateDiagnostics(now))).toContain('OTA enabled in this host: No');
  expect(collectUpdateDiagnostics(now)).toMatchObject({ runtime: null, launch: 'unavailable' });
});
test('missing native version/build never falls back to an OTA app version or versionCode', () => {
  (Constants as any).nativeAppVersion = null;
  (Constants as any).nativeBuildVersion = null;
  const text = formatUpdateDiagnostics(collectUpdateDiagnostics(now));
  expect(text).toContain('Installed version: Not reported');
  expect(text).toContain('Android build (versionCode): Not reported');
  expect(text).toContain('App-config values are not used as proof');
});
test('downloaded update ID means the running update, not a pending download', () => {
  (getAppUpdatesRuntime as jest.Mock).mockReturnValue({ ...fixture, isEmbeddedLaunch: false, updateId });
  const text = formatUpdateDiagnostics(collectUpdateDiagnostics(now));
  expect(text).toContain(`Update ID (currently running): ${updateId}`);
  expect(text).toContain('Running bundle: Downloaded update');
  expect(text).toContain('Compatibility is not verified by this report alone');
});
test('iOS reports its own build and labels Android build not applicable', () => {
  (Platform as any).OS = 'ios';
  (Constants as any).nativeBuildVersion = '17.1';
  const text = formatUpdateDiagnostics(collectUpdateDiagnostics(now));
  expect(text).toContain('iOS build: 17.1');
  expect(text).toContain('Android build (versionCode): Not applicable');
});
test('raw config, URLs, auth headers, arbitrary extra properties and secrets never enter the report', () => {
  const report = collectUpdateDiagnostics(now);
  const text = formatUpdateDiagnostics({ ...report, extra: Constants.expoConfig?.extra, rawConstants: Constants, error: 'PRIVATE_ERROR_MARKER' } as any);
  const serialized = JSON.stringify(report);
  for (const marker of ['SUPABASE_SECRET_MARKER', 'EXPO_TOKEN_MARKER', 'SIGNING_KEY_MARKER', 'BEARER_SECRET_MARKER', 'PRIVATE_ERROR_MARKER', 'https://', 'Authorization']) {
    expect(text).not.toContain(marker); expect(serialized).not.toContain(marker);
  }
});
test('control characters, token-shaped payloads, URLs, object policies and invalid IDs are rejected', () => {
  (Constants as any).easConfig = { projectId: `${nativeProject}\n` };
  (Constants as any).expoConfig.extra.eas.projectId = 'invalid-id';
  (Constants as any).nativeAppVersion = '1.0\nSECRET';
  (getAppUpdatesRuntime as jest.Mock).mockReturnValue({ channel: 'Bearer token', runtimeVersion: { policy: 'fingerprint' }, updateId: 'https://token.example', isEmbeddedLaunch: false });
  const report = collectUpdateDiagnostics(now);
  expect(report).toMatchObject({ installedVersion: null, projectId: null, projectIdSource: 'unavailable', channel: null, runtime: null, updateId: null });
  const text = formatUpdateDiagnostics({ ...report, runtime: 'runtime\nSECRET', updateId: 'https://secret.example' });
  expect(text).not.toContain('SECRET'); expect(text).not.toContain('https://');
});
test('native sharing sends the same bounded allowlisted plain-text report', async () => {
  const report = collectUpdateDiagnostics(now);
  expect(await shareUpdateDiagnostics(report)).toBe('shared');
  expect(Share.share).toHaveBeenCalledWith({ title: 'SWISH update diagnostics', message: formatUpdateDiagnostics(report) });
  expect(formatUpdateDiagnostics(report).length).toBeLessThan(4000);
});
test('cancelled sharing is distinguished and host errors are replaced with safe copy guidance', async () => {
  const report = collectUpdateDiagnostics(now);
  (Share.share as jest.Mock).mockResolvedValue({ action: Share.dismissedAction });
  expect(await shareUpdateDiagnostics(report)).toBe('dismissed');
  (Share.share as jest.Mock).mockRejectedValue(new Error('PRIVATE_ERROR_TOKEN'));
  await expect(shareUpdateDiagnostics(report)).rejects.toThrow('View the report and select its text to copy');
  await expect(shareUpdateDiagnostics(report)).rejects.not.toThrow('PRIVATE_ERROR_TOKEN');
});
test('web never attempts an unsupported native share sheet', async () => {
  (Platform as any).OS = 'web';
  await expect(shareUpdateDiagnostics(collectUpdateDiagnostics(now))).rejects.toThrow('select the report text to copy');
  expect(Share.share).not.toHaveBeenCalled();
});
test('existing More route exposes hook-driven report, selectable fallback and cleaned-up local state', () => {
  const panel = fs.readFileSync('components/feature/AppUpdatePanel.tsx', 'utf8');
  const component = fs.readFileSync('components/feature/UpdateDiagnosticsPanel.tsx', 'utf8');
  const hook = fs.readFileSync('hooks/useUpdateDiagnostics.ts', 'utf8');
  const service = fs.readFileSync('services/appUpdateDiagnosticsService.ts', 'utf8');
  expect(fs.readFileSync('components/feature/ModuleMore.tsx', 'utf8')).toContain("router.push('/app-updates'");
  expect(fs.readFileSync('app/app-updates.tsx', 'utf8')).toContain('<AppUpdatePanel');
  expect(panel).toContain('<UpdateDiagnosticsPanel />');
  expect(component).toContain('useUpdateDiagnostics()');
  expect(component).toContain('<Text selectable');
  expect(component).not.toContain('collectUpdateDiagnostics');
  expect(hook).toContain('listener.remove()');
  expect(hook).toContain('sharing.current');
  for (const forbidden of ['getSupabaseClient', 'checkForUpdateAsync(', 'fetchUpdateAsync(', 'reloadAsync(', 'AsyncStorage', 'console.', 'expo-clipboard', 'expo-application']) expect(service + hook).not.toContain(forbidden);
});
