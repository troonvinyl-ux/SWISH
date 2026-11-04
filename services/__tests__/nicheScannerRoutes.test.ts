import { nicheToScannerRoute, getProductionNicheSpecialistIds } from '@/services/nicheRouting';
import { SPECIALIST_PROFILES } from '@/shared/specialistIntelligence';
import { NICHES } from '@/constants/niches';
import { SPECIALISTS } from '@/constants/specialists';

describe('One-tap niche scanner routing', () => {
  test.each([
    ['coins', '/coin-flipper?tab=capture'],
    ['motocross', '/flipper-mx'],
    ['bicycles', '/bike-flipper'],
    ['clothing', '/threads-flip?tab=identify'],
    ['surplus_flip', '/surplus-flip'],
    ['trading_cards', '/capture'],
    ['antiques', '/antique-capture'],
    ['fossils', '/capture'],
    ['beauty', '/capture'],
    ['tech', '/capture'],
  ])('%s opens its own capture workflow', (niche, route) => {
    expect(nicheToScannerRoute(niche)).toBe(route);
  });

  test('legacy aliases resolve to the same scanner as their canonical niche', () => {
    expect(nicheToScannerRoute('threads_flip')).toBe('/threads-flip?tab=identify');
    expect(nicheToScannerRoute('mx')).toBe('/flipper-mx');
    expect(nicheToScannerRoute('books')).toBe('/antique-capture');
  });

  test('Antiques capture, AI profile and inventory specialist are connected', () => {
    expect(SPECIALISTS.antiques.captureRequirements.some(slot => slot.required)).toBe(true);
    expect(SPECIALISTS.antiques.captureRequirements.map(slot => slot.id)).toEqual(expect.arrayContaining(['marks', 'scale']));
    expect(SPECIALIST_PROFILES.antiques.fields.length).toBeGreaterThanOrEqual(8);
    expect(NICHES.antiques.keyAttributes).toContain('object_type');
    expect(getProductionNicheSpecialistIds('antiques')).toEqual(['antiques', 'books']);
  });

  test('Fossils capture, AI profile and inventory specialist are connected', () => {
    expect(SPECIALISTS.fossils.captureRequirements.some(slot => slot.required)).toBe(true);
    expect(SPECIALISTS.fossils.captureRequirements.map(slot => slot.id)).toEqual(expect.arrayContaining(['scale', 'matrix', 'restoration', 'provenance']));
    expect(SPECIALIST_PROFILES.fossils.fields.length).toBeGreaterThanOrEqual(8);
    expect(NICHES.fossils.keyAttributes).toContain('taxonomic_group');
    expect(getProductionNicheSpecialistIds('fossils')).toEqual(['fossils']);
  });
});
