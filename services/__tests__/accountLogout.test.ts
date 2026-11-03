import * as fs from 'node:fs';
import * as path from 'node:path';

const source = (relative: string) => fs.readFileSync(path.resolve(__dirname, '../..', relative), 'utf8');

describe('Account logout routing and preservation source contracts', () => {
  test('Surplus shared workspace exposes logout without replacing its existing content', () => {
    const workspace = source('components/feature/ManifestOpportunityWorkspace.tsx');
    expect(workspace).toContain('<LogoutButton disabled={workflow.busy}');
    expect(workspace).toContain('Unwatched changes to this lot will be cleared');
    expect(workspace).toContain('Worth the bid?');
    expect(workspace).toContain('BIG LOT. SIMPLE ANSWER.');
    expect(workspace).toContain('Show my bid & profit');
    expect(workspace).toContain('Save my lot & prepare listings');
  });
  test('waits for confirmed sign-out, resets history and returns through the root AuthRouter', () => {
    const hook = source('hooks/useAccountLogout.ts');
    expect(hook).toContain('if (!logoutConfirmed || user || loading) return;');
    expect(hook).toContain('router.dismissAll();');
    expect(hook).toContain("router.replace('/');");
    expect(hook).not.toContain("router.replace('/(tabs)');");
    expect(hook).toContain('inFlight.current = true;');
    expect(hook).toContain('currentUserId.current !== expectedUserId');
    expect(hook).toContain('operationLoading');
    expect(source('app/index.tsx')).toContain('<AuthRouter loginRoute="/login"');
  });
  test('uses cross-platform confirmation/error alerts and the existing auth hook', () => {
    const hook = source('hooks/useAccountLogout.ts');
    expect(hook).toContain("{ text: 'Cancel', style: 'cancel' }");
    expect(hook).toContain("showAlert('Unable to log out', result.error)");
    expect(hook).toContain('const result = await logout();');
    expect(source('app/(tabs)/account.tsx')).toContain('onPress={requestLogout}');
    expect(source('components/auth/LogoutButton.tsx')).toContain('accessibilityLabel="Log out of SWISH"');
  });
  test('retains existing user-keyed preferences, scope reset and fixed-build niche isolation', () => {
    const app = source('contexts/AppContext.tsx');
    expect(app).toContain('`${NICHE_STORAGE_PREFIX}:${user.id}`');
    expect(app).toContain('setActiveNicheId(FIXED_BUILD_NICHE_ID');
    expect(app).toContain('setTenant(null); setBusinessConfig(null); setSubscriptionStatus(null)');
    expect(source('contexts/ManifestOpportunityContext.tsx')).toContain('useEffect(() => { setSessions({}); }, [user?.id])');
    expect(source('services/nicheRouting.ts')).toContain('options.fixedNicheId ?? options.activeNicheId');
    for (const file of ['services/accountLogoutService.ts', 'hooks/useAccountLogout.ts']) {
      const contents = source(file);
      expect(contents).not.toContain('AsyncStorage.clear');
      expect(contents).not.toContain('.delete(');
      expect(contents).not.toContain('functions.invoke');
      expect(contents).not.toContain('createClient(');
    }
  });
});
