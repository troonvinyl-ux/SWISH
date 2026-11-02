import { NICHE_MODULES } from '@/constants/niches';
import { SPECIALISTS } from '@/constants/specialists';
import { SPECIALIST_PROFILES } from '@/shared/specialistIntelligence';
import { nicheToScannerRoute, resolveProductionNiche } from '@/services/nicheRouting';

describe('production niche scanner routing', () => {
  test.each([
    ['coins', '/coin-flipper?tab=capture'],
    ['motocross', '/flipper-mx'],
    ['bicycles', '/bike-flipper'],
    ['clothing', '/threads-flip?tab=identify'],
    ['surplus_flip', '/surplus-flip'],
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

  test('unknown niche does not resolve to a registered product', () => {
    expect(resolveProductionNiche('not-a-swish-niche')).toBeNull();
    expect(nicheToScannerRoute('not-a-swish-niche')).toBe('/capture');
  });
});
