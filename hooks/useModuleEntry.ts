import { useCallback, useEffect, useState } from 'react';
import { useApp } from '@/hooks/useApp';
import type { ProductionNicheId } from '@/constants/niches';

/**
 * Resolve and activate a canonical niche before rendering its tab shell.
 * Access is granted only by the existing server-loaded membership snapshot
 * and AppContext.openModule; this hook never grants or changes entitlements.
 */
export function useModuleEntry(nicheId: ProductionNicheId) {
  const app = useApp();
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const permitted = app.enabledNiches.includes(nicheId) &&
    (!app.fixedNicheId || app.fixedNicheId === nicheId);
  const ready = app.activeNicheId === nicheId && !app.moduleLoading &&
    app.accessReady && !app.tenantLoading && !app.nichePreferencesLoading;
  const waiting = app.tenantLoading || app.nichePreferencesLoading ||
    app.moduleLoading || (permitted && !ready && !error);

  const retry = useCallback(async () => {
    setError(null);
    if (!permitted) {
      setError('This module is not in your verified memberships.');
      return;
    }
    try {
      const opened = await app.openModule(nicheId);
      if (!opened) setError('Could not activate this workspace. Check your membership and try again.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Workspace activation failed.');
    }
  }, [app.openModule, nicheId, permitted]);

  useEffect(() => {
    if (ready || !permitted || app.tenantLoading || app.nichePreferencesLoading || app.moduleLoading) return;
    void retry();
  }, [ready, permitted, app.tenantLoading, app.nichePreferencesLoading, app.moduleLoading, retry, attempt]);

  return {
    permitted,
    ready,
    waiting: waiting && !error,
    error: error ?? app.accessError,
    retry: () => { setAttempt(value => value + 1); void retry(); },
  };
}
