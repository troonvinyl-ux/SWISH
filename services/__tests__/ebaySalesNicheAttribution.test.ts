import * as fs from 'fs';
import * as path from 'path';
import { nicheForSpecialist } from '../../supabase/functions/_shared/nicheAttribution';

const root = path.resolve(__dirname, '../..');
const registry = JSON.parse(fs.readFileSync(path.join(root, 'supabase/functions/_shared/niche-modules.json'), 'utf8'));
const rootRegistry = JSON.parse(fs.readFileSync(path.join(root, 'niche-modules.json'), 'utf8'));
const products = registry.products as Record<string, { specialists: string[]; legacySpecialists: string[] }>;

describe('durable eBay sales niche attribution', () => {
  test('the server registry specialist lists match the root product registry', () => {
    for (const [nicheId, product] of Object.entries(products)) {
      expect(product.specialists).toEqual(rootRegistry.products[nicheId].specialists);
    }
  });

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
    expect(source).toContain("rpc('swish_ingest_ebay_order_line'");
    expect(source).toContain(".in('items.specialist_id',specialistIds)");
    const sql=fs.readFileSync(path.join(root,'supabase/migrations/20261125_shared_order_lifecycle.sql'),'utf8');
    expect(sql).toContain('public.swish_specialist_niche(i.specialist_id) is distinct from p_niche_id');
    expect(sql).toContain('p_niche_id,i.specialist_id,l.category_id');
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
