import { nicheToEntryRoute, resolveProductionNiche } from '@/services/nicheRouting';

describe('Surplus Flip production routing', () => {
  test.each([
    ['surplus_flip', 'surplus_flip'],
    ['surplus-flip', 'surplus_flip'],
    ['catalog_flip', 'surplus_flip'],
    ['catalog_surplus', 'surplus_flip'],
    ['surplus_trader', 'surplus_flip'],
  ])('%s resolves to the Surplus Flip niche', (input, expected) => {
    expect(resolveProductionNiche(input)).toBe(expected);
  });

  it('routes Surplus Flip to its own entry screen', () => {
    expect(nicheToEntryRoute('surplus_flip')).toBe('/entry/surplus-flip');
  });

  it('does not route unknown niches into a production workspace', () => {
    expect(resolveProductionNiche('not_a_real_niche')).toBeNull();
    expect(nicheToEntryRoute('not_a_real_niche')).toBeNull();
  });
});
