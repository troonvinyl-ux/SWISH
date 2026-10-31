import { nicheToScannerRoute, getProductionNicheSpecialistIds } from '@/services/nicheRouting';
import { SPECIALIST_PROFILES } from '@/shared/specialistIntelligence';
import { SPECIALISTS } from '@/constants/specialists';

describe('One-tap niche scanner routing', () => {
  test.each([
    ['coins', '/coin-flipper?tab=capture'],
    ['motocross', '/flipper-mx'],
    ['bicycles', '/bike-flipper'],
    ['clothing', '/threads-flip'],
    ['surplus_flip', '/surplus-flip'],
    ['trading_cards', '/capture'],
    ['antiques', '/capture'],
    ['fossils', '/capture'],
    ['beauty', '/capture'],
    ['tech', '/capture'],
  ])('%s opens its own capture workflow', (niche, route) => {
    expect(nicheToScannerRoute(niche)).toBe(route);
  });

  test('legacy aliases resolve to the same scanner as their canonical niche', () => {
    expect(nicheToScannerRoute('threads_flip')).toBe('/threads-flip');
    expect(nicheToScannerRoute('mx')).toBe('/flipper-mx');
    expect(nicheToScannerRoute('books')).toBe('/capture');
  });

  test('Antiques capture, AI profile and inventory specialist are connected', () => {
    expect(SPECIALISTS.antiques.captureRequirements.some(slot => slot.required)).toBe(true);
    expect(SPECIALIST_PROFILES.antiques.fields.length).toBeGreaterThanOrEqual(8);
    expect(getProductionNicheSpecialistIds('antiques')).toEqual(['antiques', 'books']);
  });

  test('Fossils capture, AI profile and inventory specialist are connected', () => {
    expect(SPECIALISTS.fossils.captureRequirements.some(slot => slot.required)).toBe(true);
    expect(SPECIALIST_PROFILES.fossils.fields.length).toBeGreaterThanOrEqual(8);
    expect(getProductionNicheSpecialistIds('fossils')).toEqual(['fossils']);
  });
});
