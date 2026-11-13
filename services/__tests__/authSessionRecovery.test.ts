// Executable mocked regressions; no live sessions, inventory writes or marketplace requests.
jest.mock('@/template', () => ({ getSupabaseClient: jest.fn() }));
jest.mock('react-native', () => ({ Linking: { openURL: jest.fn() } }));
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn().mockResolvedValue({ type: 'opened' }) }));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { extra: {} } } }));
jest.mock('@/services/backendRequestService', () => ({
  backendRead: jest.fn(async (_key, operation) => {
    const result = await operation(new AbortController().signal);
    if (result.error) {
      const text = result.error.context ? await result.error.context.text() : result.error.message;
      throw new Error(`${result.error.context?.status ? `[${result.error.context.status}] ` : ''}${text}`);
    }
    return result;
  }),
}));
import fs from 'node:fs';
import { getSupabaseClient } from '@/template';
import { clearLocalAuthentication, recoverAuthenticatedSession, isAuthenticationFailure, signInRequiredMessage, authConnectionMessage } from '@/services/authSessionRecoveryService';
import { checkSubscription, startCheckout } from '@/services/subscriptionService';
import { describeAccessFailure, isBackendUnavailable } from '@/services/backendAvailabilityService';

function setup() {
  let session: any = { access_token: 'old-token', refresh_token: 'refresh-old', user: { id: 'user-a' } };
  let listener: ((event: string, next: any) => void) | null = null;
  const unsubscribe = jest.fn();
  const auth = {
    getSession: jest.fn(async () => ({ data: { session }, error: null })),
    refreshSession: jest.fn(async () => {
      session = { ...session, access_token: 'fresh-token', refresh_token: 'refresh-new' };
      listener?.('TOKEN_REFRESHED', session);
      return { data: { session }, error: null };
    }),
    onAuthStateChange: jest.fn((callback) => { listener = callback; return { data: { subscription: { unsubscribe } } }; }),
    signOut: jest.fn(async () => { session = null; listener?.('SIGNED_OUT', null); return { error: null }; }),
  };
  const functions = { invoke: jest.fn() };
  const client = { auth, functions, from: jest.fn(), rpc: jest.fn() };
  (getSupabaseClient as jest.Mock).mockReturnValue(client);
  return { client, auth, functions, unsubscribe, setSession: (next: any) => { session = next; }, emit: (event: string, next: any) => { session = next; listener?.(event, next); } };
}
const success = () => ({ data: { subscribed: true, product_id: 'prod_VQ0JxUCL29SZPQ', price_id: null, subscription_end: null, niche_entitlements: ['coins'], is_platform_owner: false }, error: null });
const denied = (status = 401, message = 'Invalid or expired authentication') => ({ data: null, error: { message: 'Edge Function returned a non-2xx status code', context: new Response(JSON.stringify({ error: message }), { status }) } });
beforeEach(() => { jest.clearAllMocks(); jest.useRealTimers(); });
afterEach(() => jest.useRealTimers());

test('a valid verification sends the current JWT explicitly with no refresh', async () => {
  const state = setup(); state.functions.invoke.mockResolvedValue(success());
  expect((await checkSubscription('tenant')).status?.nicheEntitlements).toEqual(['coins']);
  expect(state.functions.invoke).toHaveBeenCalledWith('swish-check-subscription', expect.objectContaining({ body: { tenantId: 'tenant' }, headers: { Authorization: 'Bearer old-token' }, signal: expect.any(AbortSignal) }));
  expect(state.auth.refreshSession).not.toHaveBeenCalled();
});
test('a rejected JWT refreshes once then re-verifies using the new JWT', async () => {
  const state = setup(); state.functions.invoke.mockResolvedValueOnce(denied()).mockResolvedValueOnce(success());
  expect((await checkSubscription('tenant')).error).toBeNull();
  expect(state.auth.refreshSession).toHaveBeenCalledTimes(1);
  expect(state.functions.invoke).toHaveBeenCalledTimes(2);
  expect(state.functions.invoke.mock.calls[1][1].headers).toEqual({ Authorization: 'Bearer fresh-token' });
  expect(state.unsubscribe).toHaveBeenCalledTimes(1);
  expect(state.client.from).not.toHaveBeenCalled(); expect(state.client.rpc).not.toHaveBeenCalled();
});
test('another authentication denial stops after one replay without any access grant', async () => {
  const state = setup(); state.functions.invoke.mockImplementation(async () => denied());
  const result = await checkSubscription('tenant');
  expect(result.status).toBeNull(); expect(result.error).toBe(signInRequiredMessage);
  expect(state.functions.invoke).toHaveBeenCalledTimes(2); expect(state.auth.refreshSession).toHaveBeenCalledTimes(1);
});
test('revoked refresh credentials request a new login rather than repeat verification', async () => {
  const state = setup(); state.functions.invoke.mockResolvedValue(denied());
  state.auth.refreshSession.mockResolvedValue({ data: { session: null }, error: { status: 400, code: 'refresh_token_not_found', message: 'Invalid Refresh Token' } } as any);
  const result = await checkSubscription('tenant');
  expect(result).toEqual({ status: null, error: signInRequiredMessage });
  expect(state.functions.invoke).toHaveBeenCalledTimes(1); expect(state.auth.signOut).not.toHaveBeenCalled();
});
test('missing local session never sends an anonymous verification request', async () => {
  const state = setup(); state.setSession(null);
  expect((await checkSubscription()).error).toBe(signInRequiredMessage);
  expect(state.functions.invoke).not.toHaveBeenCalled(); expect(state.auth.refreshSession).not.toHaveBeenCalled();
});
test.each([402, 403])('HTTP %s membership/payment denial does not refresh or sign out', async (status) => {
  const state = setup(); state.functions.invoke.mockImplementation(async () => denied(status, 'Account access denied'));
  expect((await checkSubscription('tenant')).status).toBeNull();
  expect(state.auth.refreshSession).not.toHaveBeenCalled(); expect(state.auth.signOut).not.toHaveBeenCalled();
  expect(state.functions.invoke).toHaveBeenCalledTimes(1);
});
test('a network error does not refresh, replay or discard authentication', async () => {
  const state = setup(); state.functions.invoke.mockRejectedValue(new Error('Network request failed'));
  expect((await checkSubscription('tenant')).error).toBe('Network request failed');
  expect(state.auth.refreshSession).not.toHaveBeenCalled(); expect(state.auth.signOut).not.toHaveBeenCalled();
});
test('a refresh service outage keeps the session and reports connection recovery', async () => {
  const state = setup(); state.functions.invoke.mockResolvedValue(denied());
  state.auth.refreshSession.mockResolvedValue({ data: { session: null }, error: { status: 503, name: 'AuthRetryableFetchError' } } as any);
  expect((await checkSubscription()).error).toBe(authConnectionMessage);
  expect(isBackendUnavailable(authConnectionMessage)).toBe(true);
  expect(state.auth.signOut).not.toHaveBeenCalled();
});
test('simultaneous rejected-JWT recovery shares exactly one refresh', async () => {
  const state = setup();
  const results = await Promise.all(Array.from({ length: 12 }, () => recoverAuthenticatedSession('old-token')));
  expect(results.every(result => result.accessToken === 'fresh-token')).toBe(true);
  expect(state.auth.refreshSession).toHaveBeenCalledTimes(1);
});
test('a stalled refresh is bounded and never unlocks a module', async () => {
  jest.useFakeTimers(); const state = setup();
  state.auth.refreshSession.mockImplementation(() => new Promise(() => {}));
  const recovery = recoverAuthenticatedSession('old-token');
  await jest.advanceTimersByTimeAsync(8001);
  expect(await recovery).toEqual({ accessToken: null, error: authConnectionMessage, requiresSignIn: false });
  expect(state.unsubscribe).toHaveBeenCalled(); expect(state.auth.signOut).not.toHaveBeenCalled();
});
test('an old request cannot refresh a replacement session', async () => {
  const state = setup(); state.setSession({ access_token: 'replacement', refresh_token: 'replacement-refresh', user: { id: 'user-b' } });
  expect((await recoverAuthenticatedSession('old-token')).error).toMatch(/session changed/);
  expect(state.auth.refreshSession).not.toHaveBeenCalled();
});
test('same-user replacement login during refresh cannot inherit the old verification', async () => {
  const state = setup();
  state.auth.refreshSession.mockImplementation(async () => {
    const replacement = { access_token: 'another-login', refresh_token: 'another-refresh', user: { id: 'user-a' } };
    state.emit('SIGNED_IN', replacement);
    return { data: { session: replacement }, error: null };
  });
  expect((await recoverAuthenticatedSession('old-token')).accessToken).toBeNull();
});
test('Sign in again clears this device only without inventory/storage operations', async () => {
  const state = setup(); expect(await clearLocalAuthentication()).toEqual({ error: null });
  expect(state.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  expect(state.client.from).not.toHaveBeenCalled(); expect(state.client.rpc).not.toHaveBeenCalled();
});
test('user-requested local sign-out surfaces errors instead of pretending it succeeded', async () => {
  const state = setup(); state.auth.signOut.mockResolvedValue({ error: { message: 'failed' } } as any);
  expect((await clearLocalAuthentication()).error).toMatch(/Could not clear/);
});
test('checkout is not automatically replayed or refreshed', async () => {
  const state = setup(); state.functions.invoke.mockImplementation(async () => denied());
  expect((await startCheckout('coins')).opened).toBe(false);
  expect(state.functions.invoke).toHaveBeenCalledTimes(1); expect(state.auth.refreshSession).not.toHaveBeenCalled();
});
test('session failures use actionable copy rather than raw JSON or a payment/verification claim', () => {
  const failure = describeAccessFailure('[401] {"error":"Invalid or expired authentication"}');
  expect(failure.retryLabel).toBe('Sign in again'); expect(failure.title).toBe('Sign in again to continue');
  expect(failure.message).not.toMatch(/401|\{|subscription|Account verification required/);
  expect(isAuthenticationFailure('[403] Account access denied')).toBe(false);
  expect(isAuthenticationFailure('Authenticated session changed during backend read.')).toBe(false);
});
test('all niches share recovery; security and mounted navigators remain intact', () => {
  const read = (file: string) => fs.readFileSync(file, 'utf8');
  expect(read('app/index.tsx')).toContain('<AuthRouter loginRoute="/login">');
  expect(read('components/layout/NicheRouteBoundary.tsx')).toContain('<AccountAccessRecovery overlay');
  expect(read('components/layout/NicheRouteBoundary.tsx')).toContain('{children}</View>');
  expect(read('hooks/useAccessRecovery.ts')).not.toMatch(/router\.|setSession|AsyncStorage/);
  expect(read('supabase/functions/swish-check-subscription/index.ts')).toContain('admin.auth.getUser(auth.slice(7))');
  expect(read('supabase/functions/swish-check-subscription/index.ts')).toContain('Account access denied');
});
