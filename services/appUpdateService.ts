import { Platform, Linking } from 'react-native';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { getSupabaseClient } from '@/template';
export interface NativeRelease { version: string; buildNumber: string | null; url: string | null; notes: string; sha256: string | null; sourceSha: string; affectedNiches: string[] }
export function installedAppVersion() {
  return { platform: Platform.OS, version: Constants.expoConfig?.version ?? 'unknown', build: Platform.OS === 'android' ? Constants.expoConfig?.android?.versionCode?.toString() ?? null : Constants.expoConfig?.ios?.buildNumber ?? null,
    runtime: Updates.runtimeVersion ?? null, channel: Updates.channel ?? Constants.expoConfig?.updates?.requestHeaders?.['expo-channel-name'] ?? 'preview-unified', updateId: Updates.updateId ?? null, otaEnabled: Updates.isEnabled, embedded: Updates.isEmbeddedLaunch };
}
export async function checkCompatibleUpdate(): Promise<{ available: boolean; error: string | null }> {
  if (Platform.OS === 'web') return { available: false, error: 'Browser releases are applied by reloading the hosted SWISH site; native OTA is not used.' };
  if (!Updates.isEnabled) return { available: false, error: 'This development or legacy build does not support OTA. Install an approved unified native build first.' };
  try { const result = await Updates.checkForUpdateAsync(); return { available: result.isAvailable, error: null }; }
  catch { return { available: false, error: 'Update check could not reach the release service. Your installed version remains usable.' }; }
}
export async function downloadCompatibleUpdate(): Promise<{ ready: boolean; error: string | null }> {
  try { const result = await Updates.fetchUpdateAsync(); return { ready: result.isNew, error: result.isNew ? null : 'No new compatible update was downloaded.' }; }
  catch { return { ready: false, error: 'The download was not completed. The installed bundle was retained; retry later.' }; }
}
export async function applyCompatibleUpdate(): Promise<string | null> {
  try { await Updates.reloadAsync(); return null; } catch { return 'Unable to restart the update. Close and reopen SWISH; the current bundle is retained.'; }
}
export async function latestNativeRelease(): Promise<{ release: NativeRelease | null; error: string | null }> {
  const installed = installedAppVersion();
  const { data, error } = await getSupabaseClient().from('swish_release_catalog').select('version,build_number,artifact_url,release_notes,artifact_sha256,source_sha,affected_niches')
    .eq('channel', installed.channel).eq('platform', installed.platform).eq('status', 'verified').order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error) return { release: null, error: 'Verified native release information is unavailable.' };
  if (!data || (data.version === installed.version && String(data.build_number ?? '') === String(installed.build ?? ''))) return { release: null, error: null };
  return { release: { version: data.version, buildNumber: data.build_number, url: data.artifact_url && /^https:\/\//.test(data.artifact_url) ? data.artifact_url : null, notes: data.release_notes, sha256: data.artifact_sha256, sourceSha: data.source_sha, affectedNiches: data.affected_niches }, error: null };
}
export async function openNativeRelease(url: string): Promise<string | null> {
  if (!/^https:\/\//.test(url)) return 'Approved HTTPS distribution link required.';
  try { await Linking.openURL(url); return null; } catch { return 'The distribution link could not be opened. Try again from your browser.'; }
}
