import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '@/hooks/useApp';
import type { ProductionNicheId } from '@/constants/niches';

/** One activation attempt per workspace; failed attempts require an explicit retry. */
export function useModuleEntry(nicheId: ProductionNicheId) {
  const app = useApp();
  const scope = `${app.tenant?.id ?? ''}:${nicheId}`;
  const current = useRef(scope); current.current = scope;
  const attempted = useRef('');
  const flight = useRef(false);
  const [failure, setFailure] = useState<{ scope: string; message: string } | null>(null);
  const error = failure?.scope === scope ? failure.message : null;
  const permitted = app.enabledNiches.includes(nicheId) && (!app.fixedNicheId || app.fixedNicheId === nicheId);
  const ready = app.activeNicheId === nicheId && !app.moduleLoading && app.accessReady && !app.tenantLoading && !app.nichePreferencesLoading;
  const waiting = app.tenantLoading || app.nichePreferencesLoading || app.moduleLoading || (permitted && !ready && !error && !app.moduleError);
  const attempt = useCallback(async () => {
    if (flight.current || !app.accessReady || app.tenantLoading || app.nichePreferencesLoading || app.moduleLoading) return;
    if (!permitted) { setFailure({ scope, message: 'This module is not in your verified memberships.' }); return; }
    flight.current = true; attempted.current = scope; setFailure(null);
    try {
      const opened = await app.openModule(nicheId);
      if (current.current === scope && !opened) setFailure({ scope, message: 'Workspace activation did not complete. Retry when the backend is available.' });
    } catch (cause) {
      if (current.current === scope) setFailure({ scope, message: cause instanceof Error ? cause.message : 'Workspace activation failed.' });
    } finally { flight.current = false; }
  }, [app.accessReady, app.tenantLoading, app.nichePreferencesLoading, app.moduleLoading, app.openModule, nicheId, permitted, scope]);
  useEffect(() => {
    if (ready || !permitted || error || attempted.current === scope) return;
    void attempt();
  }, [ready, permitted, error, scope, attempt]);
  return { permitted, ready, waiting: waiting && !error, error: app.moduleError ?? error ?? app.accessError, retry: attempt };
}
