import { NICHE_MODULES } from '@/constants/niches';
import { SPECIALISTS } from '@/constants/specialists';
import { SPECIALIST_PROFILES } from '@/shared/specialistIntelligence';
import { nicheToScannerRoute, resolveProductionNiche } from '@/services/nicheRouting';

describe('production niche scanner routing', () => {
  test.each([
    ['coins', '/capture'],
    ['motocross', '/capture'],
    ['bicycles', '/capture'],
    ['clothing', '/capture'],
    ['surplus_flip', '/capture'],
    ['antiques', '/antique-capture'],
    ['trading_cards', '/capture'],
    ['fossils', '/capture'],
    ['beauty', '/capture'],
    ['tech', '/capture'],
  ])('%s resolves to its registered scanner workflow', (niche, expected) => {
    expect(nicheToScannerRoute(niche)).toBe(expected);
  });

  test.each(['trading_cards', 'fossils', 'beauty', 'tech'])(
    '%s shared capture route has a niche-specific specialist and photo checklist',
    (nicheId) => {
      const niche = NICHE_MODULES[nicheId as keyof typeof NICHE_MODULES];
      const specialist = SPECIALISTS[niche.defaultSpecialist as keyof typeof SPECIALISTS];
      const profile = SPECIALIST_PROFILES[nicheId];

      expect(nicheToScannerRoute(nicheId)).toBe('/capture');
      expect(specialist).toBeDefined();
      expect(specialist.captureRequirements.length).toBeGreaterThan(0);
      expect(profile).toBeDefined();
      expect(profile.nicheId).toBe(nicheId);
      expect(profile.fields.length).toBeGreaterThan(0);
    },
  );

  test.each(Object.keys(NICHE_MODULES))('%s registered specialists resolve back to their owning niche', (nicheId) => {
    const niche = NICHE_MODULES[nicheId as keyof typeof NICHE_MODULES];
    for (const specialistId of [...niche.specialists, ...niche.legacySpecialists]) {
      expect(resolveProductionNiche(specialistId)).toBe(nicheId);
    }
  });

  test('unknown niche does not resolve to a registered product', () => {
    expect(resolveProductionNiche('not-a-swish-niche')).toBeNull();
    expect(nicheToScannerRoute('not-a-swish-niche')).toBe('/capture');
  });
});
