import { Platform, Share } from 'react-native';
import Constants from 'expo-constants';
import { installedAppVersion } from './appInstalledMetadataService';

const safe = (value: unknown, pattern: RegExp, limit = 120): string | null => typeof value === 'string' && value.length <= limit && pattern.test(value) ? value : null;
const identifier = (value: unknown) => safe(value, /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i, 36);
const label = (value: unknown) => safe(value, /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/);
// Explicit allowlist, including when a report is passed back into the formatter.
export function collectUpdateDiagnostics(now = new Date()) {
  const installed = installedAppVersion();
  const preview = Platform.OS === 'web' || Constants.executionEnvironment === 'storeClient';
  const nativeProject = preview ? null : identifier(installed.project);
  const configProject = preview ? null : identifier(Constants.expoConfig?.extra?.eas?.projectId);
  const runningBundle = installed.runningBundle;
  return { schemaVersion: 1, generatedAt: now.toISOString(), preview, platform: installed.platform,
    installedVersion: installed.version === 'unknown' ? null : safe(installed.version, /^\d+(?:\.\d+){1,3}(?:-[a-zA-Z0-9.-]+)?$/),
    androidBuild: installed.platform === 'android' ? safe(installed.build, /^\d+$/) : null,
    iosBuild: installed.platform === 'ios' ? safe(installed.build, /^\d+(?:\.\d+)*$/) : null,
    projectId: nativeProject ?? configProject, projectIdSource: nativeProject ? 'eas_metadata' : configProject ? 'app_configuration' : 'unavailable',
    configuredChannel: label(Constants.expoConfig?.updates?.requestHeaders?.['expo-channel-name']),
    channel: installed.channel === 'not-configured' ? null : label(installed.channel),
    runtime: label(installed.runtime), updateId: identifier(installed.updateId), otaEnabled: installed.otaEnabled,
    runningBundle, launch: runningBundle === 'unknown' ? 'unavailable' : runningBundle };
}
export type UpdateDiagnostics = ReturnType<typeof collectUpdateDiagnostics>;
export function formatUpdateDiagnostics(report: UpdateDiagnostics): string {
  const version = safe(report.installedVersion, /^\d+(?:\.\d+){1,3}(?:-[a-zA-Z0-9.-]+)?$/);
  const channel = label(report.channel), runtime = label(report.runtime), id = identifier(report.updateId);
  const downloaded = report.otaEnabled === true && runtime && id && report.runningBundle === 'downloaded';
  const embedded = report.otaEnabled === true && runtime && report.runningBundle === 'embedded';
  return [report.preview ? 'Preview report only' : 'SWISH installed update diagnostics',
    `Collected: ${safe(report.generatedAt, /^[0-9TZ:.-]+$/) ?? 'Not reported'}`,
    `Installed version: ${version ?? 'Not reported'}`,
    `Android build (versionCode): ${report.platform === 'ios' ? 'Not applicable' : safe(report.androidBuild, /^\d+$/) ?? 'Not reported'}`,
    `iOS build: ${safe(report.iosBuild, /^\d+(?:\.\d+)*$/) ?? 'Not applicable'}`,
    `Project ID: ${identifier(report.projectId) ?? 'Not reported'}`,
    `Project ID source: ${report.projectIdSource === 'eas_metadata' ? 'Native EAS metadata' : report.projectIdSource === 'app_configuration' ? 'App configuration (not APK-verified)' : 'Not reported'}`,
    `Channel: ${channel ?? 'Not reported'}`,
    `App config channel (not native-verified): ${label(report.configuredChannel) ?? 'Not reported'}`,
    `Runtime: ${runtime ?? 'Not reported'}`,
    `OTA enabled in this host: ${report.otaEnabled === true ? 'Yes' : 'No'}`,
    `Running bundle: ${downloaded ? 'Downloaded update' : embedded ? 'Embedded bundle' : 'Unknown'}`,
    `Update ID (currently running): ${id ?? 'Not reported'}`,
    'App-config values are not used as proof of installed version/build.',
    'Compatibility is not verified by this report alone. Compare with the verified APK and publication receipt.',
  ].join('\n');
}
export async function shareUpdateDiagnostics(report = collectUpdateDiagnostics()): Promise<'shared' | 'dismissed'> {
  if (Platform.OS === 'web') throw new Error('View and select the report text to copy.');
  try {
    const result = await Share.share({ title: 'SWISH update diagnostics', message: formatUpdateDiagnostics(report) });
    return result.action === Share.sharedAction ? 'shared' : 'dismissed';
  } catch { throw new Error('View the report and select its text to copy.'); }
}
