import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/template';
import { verifyPlatformOwner } from '@/services/commandCentreService';

/** Independent, fail-closed owner check; billing/config failures cannot strand admin in a spinner. */
export function useOwnerAuthorization() {
 const { user, loading: authLoading } = useAuth();
 const uid = user?.id ?? ''; const current = useRef(uid); current.current = uid;
 const generation = useRef(0);
 const [state, setState] = useState({ uid: '', allowed: false, loading: false, error: null as string | null });
 const retry = useCallback(async () => {
  if (!uid) return;
  const version = ++generation.current;
  setState({ uid, allowed: false, loading: true, error: null });
  const result = await verifyPlatformOwner();
  if (current.current === uid && version === generation.current) setState({ uid, allowed: result.allowed, loading: false, error: result.error });
 }, [uid]);
 useEffect(() => { void retry(); return () => { generation.current++; }; }, [retry]);
 const ready = state.uid === uid;
 return { allowed: Boolean(uid) && ready && state.allowed && !state.loading && !state.error, loading: authLoading || (Boolean(uid) && (!ready || state.loading)), error: ready ? state.error : null, retry };
}
