import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/template';
import { useApp } from '@/hooks/useApp';
import { describeAccessFailure } from '@/services/backendAvailabilityService';
import { clearLocalAuthentication, isAuthenticationFailure } from '@/services/authSessionRecoveryService';

/** Shared root/protected-screen recovery; authentication state remains owned by AuthProvider. */
export function useAccessRecovery() {
  const app = useApp();
  const { user, operationLoading } = useAuth();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const locked = useRef(false), mounted = useRef(true), userId = useRef(user?.id);
  userId.current = user?.id;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const message = app.tenantError ?? app.accessError;
  const needsSignIn = isAuthenticationFailure(message);
  const failure = describeAccessFailure(message);
  const retry = useCallback(async () => {
    if (locked.current || operationLoading) return;
    locked.current = true;
    setBusy(true); setActionError(null);
    const id = userId.current;
    try {
      if (needsSignIn) {
        const result = await clearLocalAuthentication();
        if (mounted.current && id === userId.current) setActionError(result.error);
      } else {
        await (app.tenant ? app.refreshSubscription() : app.reloadTenant());
      }
    } catch { if (mounted.current && id === userId.current) setActionError('Recovery could not finish. Please retry.'); }
    finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  }, [needsSignIn, operationLoading, app.tenant, app.refreshSubscription, app.reloadTenant]);
  return { failure, retry, busy: busy || operationLoading, actionError };
}
