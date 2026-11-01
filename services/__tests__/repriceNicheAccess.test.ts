import * as fs from 'fs';
import * as path from 'path';
import { isSpecialistAllowedForReprice, REPRICE_NICHE_SPECIALISTS } from '../../supabase/functions/_shared/repriceNicheAccess';

const projectRoot = path.resolve(__dirname, '../..');

describe('server-side repricing niche authorization', () => {
  test('the server allowlist exactly matches the canonical niche registry', () => {
    const registry = JSON.parse(fs.readFileSync(path.join(projectRoot, 'niche-modules.json'), 'utf8'));
    for (const [nicheId, product] of Object.entries(registry.products) as Array<[string, { specialists: string[] }]>) {
      expect(REPRICE_NICHE_SPECIALISTS[nicheId]).toEqual(product.specialists);
    }
    expect(Object.keys(REPRICE_NICHE_SPECIALISTS).sort()).toEqual(Object.keys(registry.products).sort());
  });

  test.each([
    ['coins', 'islamic_silver'],
    ['motocross', 'motocross'],
    ['bicycles', 'bicycles'],
    ['clothing', 'trainers_sneakers'],
    ['trading_cards', 'pokemon_cards'],
    ['antiques', 'books'],
    ['fossils', 'fossils'],
    ['beauty', 'beauty'],
    ['tech', 'retro_games'],
    ['surplus_flip', 'surplus_trader'],
  ])('allows canonical %s specialist %s', (niche, specialist) => {
    expect(isSpecialistAllowedForReprice(niche, specialist)).toBe(true);
  });

  test('rejects cross-niche and missing specialist identities', () => {
    expect(isSpecialistAllowedForReprice('antiques', 'coins')).toBe(false);
    expect(isSpecialistAllowedForReprice('clothing', 'motocross')).toBe(false);
    expect(isSpecialistAllowedForReprice('unknown', 'coins')).toBe(false);
    expect(isSpecialistAllowedForReprice('coins', null)).toBe(false);
    expect(isSpecialistAllowedForReprice('', undefined)).toBe(false);
  });

  test('Edge Function enforces tenant membership, niche scope and server-side apply', () => {
    const source = fs.readFileSync(path.join(projectRoot, 'supabase/functions/swish-reprice/index.ts'), 'utf8');
    expect(source).toContain("from('tenant_memberships')");
    expect(source).toContain('isSpecialistAllowedForReprice(niche_id, item?.specialist_id)');
    expect(source).toContain("body.action === 'apply'");
    expect(source).toContain("body.new_price");
    expect(source).toContain(".eq('tenant_id', tenant_id)");
  });

  test('client repricing requests always include niche identity and do not write prices directly', () => {
    const source = fs.readFileSync(path.join(projectRoot, 'services/repricingService.ts'), 'utf8');
    expect(source).toContain('niche_id: nicheId');
    expect(source).toContain("action: 'apply'");
    expect(source).not.toContain(".from('listings')\n    .update({\n      price: newPrice");
  });
});
