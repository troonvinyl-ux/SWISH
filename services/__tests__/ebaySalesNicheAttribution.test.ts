import * as fs from 'fs';
import * as path from 'path';
import { nicheForSpecialist } from '../../supabase/functions/_shared/nicheAttribution';

const root = path.resolve(__dirname, '../..');
const registry = JSON.parse(fs.readFileSync(path.join(root, 'niche-modules.json'), 'utf8'));
const products = registry.products as Record<string, { specialists: string[]; legacySpecialists: string[] }>;

describe('durable eBay sales niche attribution', () => {
  test('every canonical specialist maps to its registered niche', () => {
    for (const [nicheId, product] of Object.entries(products)) {
      for (const specialistId of product.specialists) {
        expect(nicheForSpecialist(specialistId, products)).toBe(nicheId);
      }
    }
  });

  test('legacy specialists map only when their registry ownership is unambiguous', () => {
    for (const [nicheId, product] of Object.entries(products)) {
      for (const specialistId of product.legacySpecialists) {
        const matches = Object.entries(products)
          .filter(([, candidate]) => [...candidate.specialists, ...candidate.legacySpecialists].includes(specialistId));
        expect(nicheForSpecialist(specialistId, products)).toBe(matches.length === 1 ? nicheId : null);
      }
    }
  });

  test('unknown, missing and ambiguous specialist identities are never guessed', () => {
    expect(nicheForSpecialist(null, products)).toBeNull();
    expect(nicheForSpecialist('not-a-real-specialist', products)).toBeNull();
    const ambiguous = { ...products, another: { specialists: ['coins'], legacySpecialists: [] } };
    expect(nicheForSpecialist('coins', ambiguous)).toBeNull();
  });

  test('both eBay order import paths snapshot niche, specialist and category', () => {
    const source = fs.readFileSync(path.join(root, 'supabase/functions/swish-ebay-orders/index.ts'), 'utf8');
    expect(source).toContain("select('id, item_id, external_listing_id, price, shipping_cost, category_id, items!inner(specialist_id)')");
    expect(source).toContain('nicheForSpecialist(specialistId, registry.products');
    expect((source.match(/niche_id: matchedListingMeta\?\.nicheId/g) ?? []).length).toBe(2);
    expect((source.match(/specialist_id: matchedListingMeta\?\.specialistId/g) ?? []).length).toBe(2);
    expect((source.match(/category_id: matchedListingMeta\?\.categoryId/g) ?? []).length).toBe(2);
  });

  test('migration adds nullable fields and backfills only from same-tenant relationships', () => {
    const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261101_sales_niche_history.sql'), 'utf8');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS niche_id text');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS specialist_id text');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS category_id text');
    expect(migration).toContain('i.tenant_id = s.tenant_id');
    expect(migration).toContain('ELSE NULL');
  });
});
