import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { getAppUpdatesRuntime, supportsAppUpdates } from './appUpdatesRuntimeService';
export function installedAppVersion() {
  const updates = getAppUpdatesRuntime();
  const native = Platform.OS !== 'web' && Constants.executionEnvironment !== 'storeClient';
  let application: typeof import('expo-application') | null = null;
  if (native && (!Constants.nativeAppVersion || !Constants.nativeBuildVersion)) {
    try { application = require('expo-application'); } catch { /* Older hosts may omit it. */ }
  }
  const otaEnabled = supportsAppUpdates();
  const runtime = otaEnabled && updates?.runtimeVersion ? updates.runtimeVersion : null;
  const updateId = otaEnabled && updates?.updateId ? updates.updateId : null;
  const embedded = otaEnabled && runtime && typeof updates?.isEmbeddedLaunch === 'boolean'
    && (updates.isEmbeddedLaunch || updateId) ? updates.isEmbeddedLaunch : null;
  return { platform: Platform.OS,
    version: native ? Constants.nativeAppVersion ?? application?.nativeApplicationVersion ?? 'unknown' : 'unknown',
    build: native ? Constants.nativeBuildVersion ?? application?.nativeBuildVersion ?? null : null,
    project: native ? Constants.easConfig?.projectId ?? null : null,
    runtime, channel: otaEnabled ? updates?.channel || 'not-configured' : 'not-configured',
    updateId, otaEnabled, embedded,
    runningBundle: embedded === true ? 'embedded' : embedded === false && updateId ? 'downloaded' : 'unknown',
  };
}
