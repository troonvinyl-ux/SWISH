import * as fs from 'fs';
import * as path from 'path';

const serviceSource = fs.readFileSync(path.resolve(__dirname, '../service.ts'), 'utf8');
const contextSource = fs.readFileSync(path.resolve(__dirname, '../context.tsx'), 'utf8');
const hookSource = fs.readFileSync(path.resolve(__dirname, '../hook.tsx'), 'utf8');
const loginSource = fs.readFileSync(path.resolve(__dirname, '../../../../app/login.tsx'), 'utf8');

describe('SWISH authentication session bootstrap regressions', () => {
  test('never filters the SIGNED_IN event after a visibility change', () => {
    expect(serviceSource).toContain("event !== 'SIGNED_IN' && isVisibilityTriggeredAuthEvent(event)");
    expect(serviceSource).toContain('this.supabase.auth.onAuthStateChange');
  });

  test('subscribes to auth changes before reading the persisted session', () => {
    const subscribeAt = contextSource.indexOf('authService.onAuthStateChange');
    const restoreAt = contextSource.indexOf('authService.getCurrentUser()');
    expect(subscribeAt).toBeGreaterThanOrEqual(0);
    expect(restoreAt).toBeGreaterThan(subscribeAt);
    expect(contextSource).toContain('authEventReceived ? {} : { user: currentUser }');
  });

  test('does not disable required login from a cached optional-module flag', () => {
    expect(hookSource).not.toContain("configManager.isModuleEnabled('auth')");
    expect(hookSource).not.toContain('Auth function not enabled, please check configuration');
    expect(hookSource).toContain('authService.signInWithPassword(email, password)');
  });
  test('commits confirmed password and OTP sign-ins to AuthProvider immediately', () => {
    expect(contextSource).toContain('setAuthenticatedUser: (user: AuthUser) => void');
    expect(contextSource).toContain('updateState({ user, loading: false, initialized: true })');
    expect(hookSource.match(/context\.setAuthenticatedUser\(result\.user\)/g)).toHaveLength(2);
  });

  test('password sign-in maps the returned user without a second session fetch', () => {
    const start = serviceSource.indexOf('async signInWithPassword(email: string, password: string)');
    const end = serviceSource.indexOf('async logout()', start);
    const method = serviceSource.slice(start, end);
    expect(method).toContain('this.mapSessionToAuthUser(data.user)');
    expect(method).not.toContain('this.getCurrentUser()');
    expect(method).not.toContain('client.auth.getSession()');
  });

  test('password login navigates only after a confirmed user is returned', () => {
    expect(loginSource).toContain('if (error || !user)');
    expect(loginSource).toContain("router.replace('/')");
  });
});
