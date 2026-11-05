import { nicheToEntryRoute, resolveProductionNiche } from '@/services/nicheRouting';
import registry from '@/niche-modules.json';

describe('Collectibles Flipper entry integration', () => {
  test('collectibles is a canonical registered niche', () => {
    expect(resolveProductionNiche('collectibles')).toBe('collectibles');
    expect(registry.products.collectibles.entry).toBe('entry/collectibles.tsx');
  });

  test('collectibles opens its own entry route', () => {
    expect(nicheToEntryRoute('collectibles')).toBe('/entry/collectibles');
  });

  test('collectibles does not resolve to another specialist route', () => {
    expect(nicheToEntryRoute('collectibles')).not.toBe(nicheToEntryRoute('antiques'));
    expect(nicheToEntryRoute('collectibles')).not.toBe(nicheToEntryRoute('coins'));
  });
});
