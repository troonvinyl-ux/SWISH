import * as fs from 'fs';
import * as path from 'path';

const root = path.resolve(__dirname, '../..');

describe('Master Admin Production Control route', () => {
  test('the isolated Master Admin Expo Router tree exposes Production Control', () => {
    const route = fs.readFileSync(path.join(root, 'master-admin-app/production-control.tsx'), 'utf8');
    expect(route.includes("export { default } from '../app/production-control'") || route.includes("export { default } from '@/app/production-control'")).toBe(true);
  });

  test('the owner dashboard links to the registered Production Control route', () => {
    const dashboard = fs.readFileSync(path.join(root, 'app/master-admin.tsx'), 'utf8');
    expect(dashboard).toContain("router.push('/production-control'");
  });

  test('the destination retains its owner-only access guard', () => {
    const screen = fs.readFileSync(path.join(root, 'app/production-control.tsx'), 'utf8');
    expect(screen).toContain("!isSwishMasterAdmin(user?.email) || !isMasterAdmin");
    expect(screen).toContain("return <Redirect href={\"/master-admin\" as any} />");
  });
});

test('private launcher waits for the owner tenant check before reading the admin flag', () => {
  const root = path.resolve(__dirname, '../..');
  const entry = fs.readFileSync(path.join(root, 'master-admin-app/index.tsx'), 'utf8');
  const loadingGate = entry.indexOf('if (tenantLoading || nichePreferencesLoading)');
  const adminFlag = entry.indexOf('if (!isMasterAdmin)');
  expect(loadingGate).toBeGreaterThan(-1);
  expect(adminFlag).toBeGreaterThan(loadingGate);
  expect(entry).toContain('if (!isSwishMasterAdmin(user.email))');
});
