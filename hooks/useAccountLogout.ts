import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { useAuth, useAlert } from '@/template';

interface AccountLogoutOptions { confirmationMessage?: string }
const defaultMessage = 'Log out to sign in with another SWISH account. Your saved inventory, watched lots and marketplace connections are kept.';

export function useAccountLogout({ confirmationMessage = defaultMessage }: AccountLogoutOptions = {}) {
  const { user, logout, loading, operationLoading } = useAuth();
  const { showAlert } = useAlert();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  const [logoutConfirmed, setLogoutConfirmed] = useState(false);
  const inFlight = useRef(false);
  const alive = useRef(true);
  const currentUserId = useRef(user?.id);
  const authBusy = useRef(loading || operationLoading);
  currentUserId.current = user?.id;
  authBusy.current = loading || operationLoading;

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  // Wait for the existing AuthProvider to observe SIGNED_OUT. Reset the old
  // navigation history and mount the root AuthRouter, which owns login/relogin.
  // Do not send the next account directly into the previous account's niche.
  useEffect(() => {
    if (!logoutConfirmed || user || loading) return;
    router.dismissAll();
    router.replace('/');
  }, [logoutConfirmed, user, loading, router]);

  const performLogout = useCallback(async (expectedUserId: string) => {
    if (!alive.current || inFlight.current || authBusy.current || currentUserId.current !== expectedUserId) return;
    inFlight.current = true;
    setSigningOut(true);
    let result: { error: string | null };
    try { result = await logout(); }
    catch { result = { error: 'Sign-out could not be completed. Retry; your saved records and marketplace connections are unchanged.' }; }
    if (!alive.current) return;
    if (result.error) {
      inFlight.current = false;
      setSigningOut(false);
      showAlert('Unable to log out', result.error);
      return;
    }
    // AuthProvider clears account state; existing scoped providers discard old drafts.
    setLogoutConfirmed(true);
  }, [logout, showAlert]);

  const requestLogout = useCallback(() => {
    const expectedUserId = currentUserId.current;
    if (!expectedUserId || inFlight.current || authBusy.current) return;
    showAlert('Log out?', confirmationMessage, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log out', style: 'destructive', onPress: () => { void performLogout(expectedUserId); } },
    ]);
  }, [confirmationMessage, performLogout, showAlert]);

  return { signingOut, requestLogout, disabled: signingOut || loading || operationLoading || !user };
}
