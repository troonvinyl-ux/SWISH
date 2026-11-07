// Shared view/action guard. Backend authorization remains the existing session-module RLS.
import { useCallback, useEffect, useRef } from 'react';
import { useAuth } from '@/template';
import { useApp } from './useApp';
import { resolveProductionNiche } from '@/services/nicheRouting';
export function useModuleOperationGuard() {
  const { user } = useAuth();
  const app = useApp();
  const nicheId = resolveProductionNiche(app.fixedNicheId ?? app.activeNicheId);
  const tenantId = app.tenant?.id ?? '';
  const ready = Boolean(user?.id && tenantId && nicheId && app.accessReady && !app.moduleLoading && !app.subscriptionLoading);
  const scope = `${user?.id ?? ''}:${tenantId}:${nicheId ?? ''}:${app.moduleEpoch}:${ready ? 'active' : 'pending'}`;
  const current = useRef({ scope, ready }); current.current = { scope, ready };
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const isCurrent = useCallback((candidate: string) => alive.current && current.current.ready && current.current.scope === candidate, []);
  return { scope, ready, tenantId, nicheId, isCurrent };
}
