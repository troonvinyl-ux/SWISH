import { isSpecialistAllowedForReprice, REPRICE_NICHE_SPECIALISTS } from '../../supabase/functions/_shared/repriceNicheAccess';

describe('server-side repricing niche authorization', () => {
  it('defines a non-empty specialist scope for every production niche', () => {
    expect(Object.keys(REPRICE_NICHE_SPECIALISTS).sort()).toEqual([
      'antiques', 'beauty', 'bicycles', 'clothing', 'coins',
      'fossils', 'motocross', 'surplus_flip', 'tech', 'trading_cards',
    ]);
    for (const specialists of Object.values(REPRICE_NICHE_SPECIALISTS)) {
      expect(specialists.length).toBeGreaterThan(0);
    }
  });

  it.each([
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

  it('rejects cross-niche and missing specialist identities', () => {
    expect(isSpecialistAllowedForReprice('antiques', 'coins')).toBe(false);
    expect(isSpecialistAllowedForReprice('clothing', 'motocross')).toBe(false);
    expect(isSpecialistAllowedForReprice('unknown', 'coins')).toBe(false);
    expect(isSpecialistAllowedForReprice('coins', null)).toBe(false);
    expect(isSpecialistAllowedForReprice('', undefined)).toBe(false);
  });
});
