// Pure update policy; native version and OTA bundle identity are separate.
export const automaticUpdateIntervalMs = 15 * 60 * 1000;
export const automaticUpdateDelayMs = 5000;
export type AppUpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'restarting' | 'current' | 'error';
export function shouldCheckAutomatically(enabled: boolean, ready: boolean, busy: boolean, lastChecked: number, now: number): boolean {
  return enabled && !ready && !busy && (lastChecked === 0 || now - lastChecked >= automaticUpdateIntervalMs);
}
export function isNewerNativeRelease(installedVersion: string, installedBuild: string | null, version: string, build: string | null): boolean {
  const parse = (value: string) => /^\d+\.\d+\.\d+$/.test(value) ? value.split('.').map(Number) : null;
  const current = parse(installedVersion), next = parse(version);
  if (!current || !next) return false;
  for (let index = 0; index < 3; index++) {
    if (next[index] !== current[index]) return next[index] > current[index];
  }
  if (!installedBuild || !build || !/^\d+$/.test(installedBuild) || !/^\d+$/.test(build)) return false;
  return Number.isSafeInteger(Number(build)) && Number.isSafeInteger(Number(installedBuild)) && Number(build) > Number(installedBuild);
}
