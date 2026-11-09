import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { idleNativeUpdateState, supportsAppUpdates, type NativeUpdateState } from '@/services/appUpdatesRuntimeService';
import { installedAppVersion, checkCompatibleUpdate, downloadCompatibleUpdate, applyCompatibleUpdate, latestNativeRelease, openNativeRelease, type NativeRelease } from '@/services/appUpdateService';
import { automaticUpdateDelayMs, shouldCheckAutomatically, type AppUpdateStatus } from '@/services/appUpdatePolicyService';

// Mounted once by AppUpdatesProvider. No capture, auth, inventory or seller writes.
export function useAppUpdateController(nativeState: NativeUpdateState = idleNativeUpdateState) {
  const [status, setStatus] = useState<AppUpdateStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [nativeError, setNativeError] = useState<string | null>(null);
  const [nativeRelease, setNativeRelease] = useState<NativeRelease | null>(null);
  const mounted = useRef(true), busy = useRef(false), ready = useRef(false);
  const lastAutomaticCheck = useRef(0);
  const nativeBusy = useRef(false);
  nativeBusy.current = nativeState.isChecking || nativeState.isDownloading;
  const websiteReload = useRef<() => void>(() => {});

  useEffect(() => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') websiteReload.current = () => window.location.reload();
  }, []);
  // Includes updates downloaded automatically by the native ON_LOAD handler.
  useEffect(() => {
    if (nativeState.isUpdatePending) {
      ready.current = true;
      setStatus(previous => previous === 'restarting' ? previous : 'ready');
      setError(null);
    }
  }, [nativeState.isUpdatePending]);

  const download = useCallback(async () => {
    if (busy.current || nativeBusy.current || ready.current) return;
    busy.current = true;
    if (mounted.current) { setStatus('downloading'); setError(null); }
    try {
      const result = await downloadCompatibleUpdate();
      if (!mounted.current) return;
      ready.current = ready.current || result.ready;
      setStatus(ready.current ? 'ready' : 'error');
      setError(ready.current ? null : result.error);
    } catch {
      if (mounted.current) { setStatus(ready.current ? 'ready' : 'error'); setError('Update download was interrupted. Your current version is retained.'); }
    } finally { busy.current = false; }
  }, []);

  const check = useCallback(async (automatic = false) => {
    if (busy.current || nativeBusy.current || ready.current) return;
    busy.current = true;
    lastAutomaticCheck.current = Date.now();
    if (mounted.current) { setStatus('checking'); setError(null); }
    let shouldDownload = false;
    try {
      // Automatic checks never need authentication or a backend metadata read.
      const [ota, native] = await Promise.all([
        checkCompatibleUpdate(),
        automatic ? Promise.resolve(null) : latestNativeRelease(),
      ]);
      if (!mounted.current) return;
      if (native) { setNativeRelease(native.release); setNativeError(native.error); }
      if (ready.current) { setStatus('ready'); return; }
      setError(ota.error);
      setStatus(ota.error ? 'error' : ota.available ? 'available' : 'current');
      shouldDownload = automatic && ota.available && !ota.error;
    } catch {
      if (mounted.current) { setStatus(ready.current ? 'ready' : 'error'); setError('The release service could not be reached. Your installed version remains usable.'); }
    } finally { busy.current = false; }
    if (shouldDownload && mounted.current && AppState.currentState === 'active') await download();
  }, [download]);

  useEffect(() => {
    mounted.current = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (timer) clearTimeout(timer);
      const enabled = supportsAppUpdates();
      if (!shouldCheckAutomatically(enabled, ready.current, busy.current || nativeBusy.current, lastAutomaticCheck.current, Date.now())) return;
      timer = setTimeout(() => {
        timer = null;
        if (mounted.current && AppState.currentState === 'active' && shouldCheckAutomatically(enabled, ready.current, busy.current || nativeBusy.current, lastAutomaticCheck.current, Date.now())) void check(true);
      }, automaticUpdateDelayMs);
    };
    schedule();
    const listener = AppState.addEventListener('change', value => {
      if (value === 'active') schedule();
      else if (timer) { clearTimeout(timer); timer = null; }
    });
    return () => { mounted.current = false; if (timer) clearTimeout(timer); listener.remove(); };
  }, [check]);

  const apply = useCallback(async () => {
    if (busy.current || !ready.current) return;
    busy.current = true; setStatus('restarting'); setError(null);
    try {
      const message = await applyCompatibleUpdate();
      if (mounted.current && message) { setError(message); setStatus('ready'); }
    } catch {
      if (mounted.current) { setError('SWISH could not restart. Save your work and reopen the app.'); setStatus('ready'); }
    } finally { busy.current = false; }
  }, []);
  const openDistribution = useCallback(async () => {
    if (!nativeRelease?.url) return;
    const message = await openNativeRelease(nativeRelease.url);
    if (mounted.current && message) setNativeError(message);
  }, [nativeRelease]);
  const displayStatus: AppUpdateStatus = status === 'restarting' ? 'restarting' : ready.current ? 'ready' : nativeState.isDownloading ? 'downloading' : nativeState.isChecking ? 'checking' : status;
  return { installed: installedAppVersion(), status: displayStatus, error, nativeError, nativeRelease, check, download, apply, openDistribution, reloadWebsite: () => websiteReload.current() };
}
