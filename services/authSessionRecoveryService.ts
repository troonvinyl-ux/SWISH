import { getSupabaseClient } from '@/template';

export const signInRequiredMessage = 'Your sign-in session is no longer valid. Sign in again to continue.';
export const authConnectionMessage = 'Authentication service temporarily unavailable. Please retry when connected.';
const sessionChangedMessage = 'Authenticated session changed. Retry verification with your current sign-in.';
const recoveryFlights = new WeakMap<object, Map<string, Promise<SessionRecoveryResult>>>();

export interface SessionRecoveryResult { accessToken: string | null; error: string | null; requiresSignIn: boolean }

/** Authentication failure only: a denied tenant/niche or payment is never a reason to refresh/logout. */
export function isAuthenticationFailure(message: unknown): boolean {
  if (typeof message !== 'string') return false;
  return message === signInRequiredMessage || /\[(?:Code: )?401\]|\bHTTP 401\b|invalid or expired authentication|invalid jwt|jwt expired|authentication required|session_not_found|refresh_token_not_found|refresh_token_already_used|session from session_id claim.*does not exist/i.test(message);
}
function failed(error: string, requiresSignIn = false): SessionRecoveryResult {
  return { accessToken: null, error, requiresSignIn };
}
function terminalAuthError(error: { status?: number; name?: string; code?: string; message?: string }): boolean {
  if (error.name === 'AuthSessionMissingError') return true;
  if (/refresh_token_not_found|refresh_token_already_used|session_not_found|bad_jwt/.test(error.code ?? '')) return true;
  // Auth service 4xx rejects the refresh credential. Network/5xx errors do not invalidate a login.
  return typeof error.status === 'number' && error.status >= 400 && error.status < 500 && error.status !== 429;
}
function authDeadline<T>(operation: () => PromiseLike<T>, timeoutMs = 8000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(authConnectionMessage)), timeoutMs);
    Promise.resolve().then(operation).then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

/** Existing Supabase client only; one bounded refresh for a rejected JWT, never a new login or grant.
 * Tokens stay in memory and are never logged, exported, or persisted by this service.
 */
export function recoverAuthenticatedSession(rejectedAccessToken: string): Promise<SessionRecoveryResult> {
  const client = getSupabaseClient();
  let flights = recoveryFlights.get(client);
  if (!flights) { flights = new Map(); recoveryFlights.set(client, flights); }
  const existing = flights.get(rejectedAccessToken);
  if (existing) return existing;
  const task = (async (): Promise<SessionRecoveryResult> => {
    let subscription: { unsubscribe: () => void } | undefined;
    let replaced = false;
    try {
      const before = await authDeadline(() => client.auth.getSession());
      if (before.error) return terminalAuthError(before.error) ? failed(signInRequiredMessage, true) : failed(authConnectionMessage);
      const session = before.data.session;
      if (!session?.access_token || !session.user?.id) return failed(signInRequiredMessage, true);
      // Never move an old request into a replacement session, even for the same user.
      if (session.access_token !== rejectedAccessToken) return failed(sessionChangedMessage);
      if (!session.refresh_token) return failed(signInRequiredMessage, true);
      const userId = session.user.id;
      subscription = client.auth.onAuthStateChange((_event, nextSession) => {
        if (_event === 'SIGNED_OUT' || _event === 'SIGNED_IN' || (nextSession && nextSession.user.id !== userId)) replaced = true;
      }).data.subscription;
      const refreshed = await authDeadline(() => client.auth.refreshSession());
      if (replaced) return failed(sessionChangedMessage);
      if (refreshed.error) return terminalAuthError(refreshed.error) ? failed(signInRequiredMessage, true) : failed(authConnectionMessage);
      if (!refreshed.data.session?.access_token) return failed(signInRequiredMessage, true);
      if (refreshed.data.session.user.id !== userId) return failed(sessionChangedMessage);
      const current = await authDeadline(() => client.auth.getSession());
      if (replaced) return failed(sessionChangedMessage);
      if (current.error) return terminalAuthError(current.error) ? failed(signInRequiredMessage, true) : failed(authConnectionMessage);
      if (!current.data.session) return failed(signInRequiredMessage, true);
      if (current.data.session.user.id !== userId || current.data.session.access_token !== refreshed.data.session.access_token) return failed(sessionChangedMessage);
      return { accessToken: current.data.session.access_token, error: null, requiresSignIn: false };
    } catch { return failed(authConnectionMessage); }
    finally { subscription?.unsubscribe(); }
  })();
  flights.set(rejectedAccessToken, task);
  void task.finally(() => { if (flights?.get(rejectedAccessToken) === task) flights.delete(rejectedAccessToken); });
  return task;
}

/** User-requested local sign-out only. Existing onAuthStateChange/AuthRouter handles the login screen.
 * Do not revoke other devices, delete inventory/photos, clear unrelated storage, or grant access.
 */
export async function clearLocalAuthentication(): Promise<{ error: string | null }> {
  const client = getSupabaseClient();
  try {
    const before = await authDeadline(() => client.auth.getSession());
    if (before.error) return { error: authConnectionMessage };
    const token = before.data.session?.access_token;
    const current = await authDeadline(() => client.auth.getSession());
    if (current.error) return { error: authConnectionMessage };
    if (token !== current.data.session?.access_token) return { error: sessionChangedMessage };
    const result = await authDeadline(() => client.auth.signOut({ scope: 'local' }));
    return { error: result.error ? 'Could not clear this sign-in. Please retry.' : null };
  } catch { return { error: 'Could not clear this sign-in. Please retry.' }; }
}
