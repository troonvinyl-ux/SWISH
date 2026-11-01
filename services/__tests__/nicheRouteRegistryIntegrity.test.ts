import * as fs from 'fs';
import * as path from 'path';

const repoRoot = path.resolve(__dirname, '../..');
const registry = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'niche-modules.json'), 'utf8'),
).products as Record<string, {
  entry: string;
  home: string | null;
  dedicatedRoutes: string[];
}>;

describe('canonical niche route registry integrity', () => {
  test('every registered niche entry route exists in the app route tree', () => {
    for (const module of Object.values(registry)) {
      expect(fs.existsSync(path.join(repoRoot, 'app', module.entry))).toBe(true);
      expect(module.entry.startsWith('entry/')).toBe(true);
    }
  });

  test('every dedicated route uses its exact .tsx file path and exists', () => {
    for (const module of Object.values(registry)) {
      for (const route of module.dedicatedRoutes) {
        expect(route.endsWith('.tsx')).toBe(true);
        expect(fs.existsSync(path.join(repoRoot, 'app', route))).toBe(true);
      }
    }
  });

  test('every configured product home exists when one is declared', () => {
    for (const module of Object.values(registry)) {
      if (module.home) {
        expect(fs.existsSync(path.join(repoRoot, 'app', module.home))).toBe(true);
      }
    }
  });

  test('the Coins product explicitly owns the coin-flipper route file', () => {
    expect(registry.coins.dedicatedRoutes).toContain('coin-flipper.tsx');
  });
});
