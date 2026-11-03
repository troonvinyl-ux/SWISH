import * as fs from 'fs';
import * as path from 'path';

const serviceSource = fs.readFileSync(path.resolve(__dirname, '../service.ts'), 'utf8');
const contextSource = fs.readFileSync(path.resolve(__dirname, '../context.tsx'), 'utf8');
const hookSource = fs.readFileSync(path.resolve(__dirname, '../hook.tsx'), 'utf8');

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
});
