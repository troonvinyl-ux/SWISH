import * as fs from 'fs';
import * as path from 'path';

const routerSource = fs.readFileSync(
  path.resolve(__dirname, '../router.tsx'),
  'utf8',
);

describe('AuthRouter startup navigation regression', () => {
  test('uses Expo Router declarative redirects after auth initialization', () => {
    expect(routerSource).toContain("import { Redirect, usePathname } from 'expo-router'");
    expect(routerSource).toContain('<Redirect href={loginRoute as any} />');
    expect(routerSource).toContain("<Redirect href={'/' as any} />");
  });

  test('does not imperatively navigate from an auth effect before the root navigator is ready', () => {
    expect(routerSource).not.toContain('useRouter');
    expect(routerSource).not.toContain('router.push(');
    expect(routerSource).not.toContain('router.replace(');
    expect(routerSource).not.toContain('useEffect(');
  });

  test('waits for auth initialization before deciding whether to redirect', () => {
    expect(routerSource).toContain('if (loading || !initialized || !pathname)');
    expect(routerSource).toContain('if (!user && !isLoginRoute && !isExcludedRoute)');
    expect(routerSource).toContain('if (user && isLoginRoute)');
  });

  test('preserves explicitly excluded routes for unauthenticated users', () => {
    expect(routerSource).toContain('excludeRoutes.some((route) =>');
    expect(routerSource).toContain('pathname.startsWith(route)');
    expect(routerSource).toContain('return <>{children}</>;');
  });
});
