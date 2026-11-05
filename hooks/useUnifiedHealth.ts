import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from './useApp';
import { loadUnifiedHealth, type UnifiedHealth } from '@/services/unifiedHealthService';
export function useUnifiedHealth(enabled = true) {
  const { tenant, isMasterAdmin } = useApp();
  const key = `${tenant?.id ?? ''}:${isMasterAdmin}`; const current = useRef(key); current.current = key;
  const request = useRef(0);
  const [snapshot, setSnapshot] = useState<{ key: string; health: UnifiedHealth | null; error: string | null; loading: boolean }>({ key: '', health: null, error: null, loading: false });
  const refresh = useCallback(async () => {
    if (!enabled || !isMasterAdmin || !tenant?.id) return;
    const version = ++request.current; setSnapshot({ key, health: null, error: null, loading: true });
    try { const result = await loadUnifiedHealth(tenant.id); if (current.current === key && request.current === version) setSnapshot({ key, ...result, loading: false }); }
    catch { if (current.current === key && request.current === version) setSnapshot({ key, health: null, error: 'Owner diagnostics could not be reached.', loading: false }); }
  }, [enabled, isMasterAdmin, tenant?.id, key]);
  useEffect(() => { void refresh(); return () => { request.current++; }; }, [refresh]);
  return { health: snapshot.key === key ? snapshot.health : null, error: snapshot.key === key ? snapshot.error : null, loading: snapshot.key === key && snapshot.loading, refresh };
}
