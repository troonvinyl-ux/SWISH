import { Platform } from 'react-native';
import Constants from 'expo-constants';

export type ExpoUpdatesRuntime = typeof import('expo-updates');
export interface NativeUpdateState { isChecking: boolean; isDownloading: boolean; isUpdatePending: boolean }
export const idleNativeUpdateState: NativeUpdateState = { isChecking: false, isDownloading: false, isUpdatePending: false };
let runtime: ExpoUpdatesRuntime | null = null;
let attempted = false;

/** The preview host owns its updates. Never require the APK-only module at startup. */
export function getAppUpdatesRuntime(): ExpoUpdatesRuntime | null {
  if (Platform.OS === 'web' || Constants.executionEnvironment === 'storeClient') return null;
  if (!attempted) {
    attempted = true;
    try {
      // A native host may not include ExpoUpdates, or may include an older version.
      // Keep evaluation inside the try: even importing this package can throw.
      runtime = require('expo-updates') as ExpoUpdatesRuntime;
    } catch {
      runtime = null;
    }
  }
  return runtime;
}

export function supportsAppUpdates(): boolean {
  const updates = getAppUpdatesRuntime();
  return updates?.isEnabled === true
    && typeof updates.checkForUpdateAsync === 'function'
    && typeof updates.fetchUpdateAsync === 'function'
    && typeof updates.reloadAsync === 'function';
}
