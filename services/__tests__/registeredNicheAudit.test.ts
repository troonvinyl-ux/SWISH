import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

describe('S1-03 registered niche audit', () => {
  const registry = JSON.parse(read('niche-modules.json'));

  test('all ten registered products have unique Android/iOS identities and existing entry files', () => {
    const products = Object.entries(registry.products) as Array<[string, any]>;
    expect(products).toHaveLength(10);
    const androidPackages = products.map(([, product]) => product.androidPackage);
    const iosBundles = products.map(([, product]) => product.iosBundleIdentifier);
    expect(new Set(androidPackages).size).toBe(products.length);
    expect(new Set(iosBundles).size).toBe(products.length);

    for (const [id, product] of products) {
      expect(product.id).toBe(id);
      expect(fs.existsSync(path.join(root, 'app', product.entry))).toBe(true);
    }
  });

  test('every scanner route and dedicated route resolves to an existing app screen', () => {
    for (const product of Object.values(registry.products) as any[]) {
      const routePath = String(product.scannerRoute).split('?')[0].replace(/^\//, '');
      expect(fs.existsSync(path.join(root, 'app', routePath + '.tsx'))).toBe(true);
      for (const route of product.dedicatedRoutes ?? []) {
        expect(fs.existsSync(path.join(root, 'app', route))).toBe(true);
      }
    }
  });

  test('canonical and legacy specialist IDs resolve to exactly one product owner', () => {
    const owners = new Map<string, string>();
    for (const [nicheId, product] of Object.entries(registry.products) as Array<[string, any]>) {
      for (const specialistId of [...product.specialists, ...product.legacySpecialists]) {
        const existing = owners.get(specialistId);
        expect(existing === undefined || existing === nicheId).toBe(true);
        owners.set(specialistId, nicheId);
      }
    }
    expect(owners.get('books')).toBe('antiques');
    expect(owners.get('clothing_specialist')).toBe('clothing');
    expect(owners.get('mx')).toBe('motocross');
    expect(owners.get('surplus_flip')).toBe('surplus_flip');
  });

  test('all production niches have a separate branded entry route and scanner contract', () => {
    for (const [nicheId, product] of Object.entries(registry.products) as Array<[string, any]>) {
      expect(product.entry).toMatch(/^entry\//);
      expect(product.androidPackage).toContain('com.swish.');
      expect(typeof product.scannerRoute).toBe('string');
      expect(product.scannerRoute.length).toBeGreaterThan(1);
    }
  });
});
