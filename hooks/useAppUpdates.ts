import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { installedAppVersion, checkCompatibleUpdate, downloadCompatibleUpdate, applyCompatibleUpdate, latestNativeRelease, openNativeRelease, type NativeRelease } from '@/services/appUpdateService';
export function useAppUpdates() {
  const [status, setStatus] = useState<'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'current' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null); const [nativeRelease, setNativeRelease] = useState<NativeRelease | null>(null);
  const mounted = useRef(true); const busy = useRef(false);
  const websiteReload = useRef<() => void>(() => {});
  useEffect(() => { if (Platform.OS === 'web' && typeof window !== 'undefined') websiteReload.current = () => window.location.reload(); }, []);
  const check = useCallback(async () => {
    if (busy.current) return;
    busy.current = true; setStatus('checking'); setError(null);
    try {
      const [ota, native] = await Promise.all([checkCompatibleUpdate(), latestNativeRelease()]);
      if (!mounted.current) return;
      setNativeRelease(native.release); setError(ota.error ?? native.error); setStatus(ota.error ? 'error' : ota.available ? 'available' : 'current');
    } finally { busy.current = false; }
  }, []);
  useEffect(() => {
    mounted.current = true; void check();
    const listener = AppState.addEventListener('change', value => { if (value === 'active') void check(); });
    return () => { mounted.current = false; listener.remove(); };
  }, [check]);
  const download = useCallback(async () => {
    if (busy.current || status !== 'available') return;
    busy.current = true; setStatus('downloading');
    try { const result = await downloadCompatibleUpdate(); if (mounted.current) { setStatus(result.ready ? 'ready' : 'error'); setError(result.error); } } finally { busy.current = false; }
  }, [status]);
  const apply = useCallback(async () => { const message = await applyCompatibleUpdate(); if (mounted.current && message) { setError(message); setStatus('error'); } }, []);
  const openDistribution = useCallback(async () => { if (nativeRelease?.url) { const message = await openNativeRelease(nativeRelease.url); if (mounted.current && message) setError(message); } }, [nativeRelease]);
  return { installed: installedAppVersion(), status, error, nativeRelease, check, download, apply, openDistribution, reloadWebsite: () => websiteReload.current() };
}
