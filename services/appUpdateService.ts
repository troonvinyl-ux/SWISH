import { Platform, Linking } from 'react-native';
import { installedAppVersion } from './appInstalledMetadataService';
export { installedAppVersion } from './appInstalledMetadataService';
import { getAppUpdatesRuntime, supportsAppUpdates } from './appUpdatesRuntimeService';
import { getSupabaseClient } from '@/template';
import { isNewerNativeRelease } from './appUpdatePolicyService';
export interface NativeRelease { version: string; buildNumber: string | null; url: string | null; notes: string; sha256: string | null; sourceSha: string; affectedNiches: string[] }
export async function checkCompatibleUpdate(): Promise<{ available: boolean; error: string | null }> {
  if (Platform.OS === 'web') return { available: false, error: 'Browser releases are applied by reloading the hosted SWISH site; native OTA is not used.' };
  const updates = getAppUpdatesRuntime();
  if (!updates || !supportsAppUpdates()) return { available: false, error: 'This preview or legacy build does not support SWISH OTA. The preview is refreshed through OnSpace; a compatible release APK is required for native updates.' };
  try { const result = await updates.checkForUpdateAsync(); return { available: result.isAvailable, error: null }; }
  catch { return { available: false, error: 'Update check could not reach the release service. Your installed version remains usable.' }; }
}
export async function downloadCompatibleUpdate(): Promise<{ ready: boolean; error: string | null }> {
  const updates = getAppUpdatesRuntime();
  if (!updates || !supportsAppUpdates()) return { ready: false, error: 'A release build with Expo Updates enabled is required.' };
  try { const result = await updates.fetchUpdateAsync(); return { ready: result.isNew, error: result.isNew ? null : 'No new compatible update was downloaded.' }; }
  catch { return { ready: false, error: 'The download was not completed. The installed bundle was retained; retry later.' }; }
}
export async function applyCompatibleUpdate(): Promise<string | null> {
  const updates = getAppUpdatesRuntime();
  if (!updates || !supportsAppUpdates()) return 'A release build with Expo Updates enabled is required.';
  try { await updates.reloadAsync(); return null; } catch { return 'Unable to restart the update. Close and reopen SWISH; the current bundle is retained.'; }
}
export async function latestNativeRelease(): Promise<{ release: NativeRelease | null; error: string | null }> {
  const installed = installedAppVersion();
  if (installed.platform === 'web') return { release: null, error: null };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const { data, error } = await getSupabaseClient().from('swish_release_catalog').select('version,build_number,artifact_url,release_notes,artifact_sha256,source_sha,affected_niches')
      .eq('channel', installed.channel).eq('platform', installed.platform).eq('status', 'verified').order('created_at', { ascending: false }).limit(1).abortSignal(controller.signal).maybeSingle();
    if (error) return { release: null, error: 'Verified native release information is unavailable.' };
    if (!data || !isNewerNativeRelease(installed.version, installed.build, data.version, data.build_number)) return { release: null, error: null };
    return { release: { version: data.version, buildNumber: data.build_number, url: data.artifact_url && /^https:\/\//.test(data.artifact_url) ? data.artifact_url : null, notes: data.release_notes, sha256: data.artifact_sha256, sourceSha: data.source_sha, affectedNiches: data.affected_niches }, error: null };
  } catch {
    return { release: null, error: 'Verified native release information is unavailable. Your installed application is unchanged.' };
  } finally { clearTimeout(timer); }
}
export async function openNativeRelease(url: string): Promise<string | null> {
  if (!/^https:\/\//.test(url)) return 'Approved HTTPS distribution link required.';
  try { await Linking.openURL(url); return null; } catch { return 'The distribution link could not be opened. Try again from your browser.'; }
}
