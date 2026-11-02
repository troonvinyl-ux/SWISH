import { NICHE_MODULES } from '@/constants/niches';
import { SPECIALISTS } from '@/constants/specialists';
import { SPECIALIST_PROFILES } from '@/shared/specialistIntelligence';
import { nicheToScannerRoute, resolveProductionNiche } from '@/services/nicheRouting';
import * as fs from 'node:fs';
import * as path from 'node:path';

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


describe('S1-03 shared scanner isolation contracts', () => {
  const root = path.resolve(__dirname, '../..');

  test('shared capture renders the active niche identity and specialist-specific photo slots', () => {
    const screen = fs.readFileSync(path.join(root, 'app/capture.tsx'), 'utf8');
    const hook = fs.readFileSync(path.join(root, 'hooks/useGenericCapture.ts'), 'utf8');

    expect(screen).toContain('const capture=useGenericCapture()');
    expect(screen).toContain('BrandArtwork nicheId={capture.activeNiche.id}');
    expect(screen).toContain('capture.activeNiche.specialists.length>1');
    expect(screen).toContain('capture.slots');

    expect(hook).toContain("const scope = `${user?.id ?? ''}:${tenant?.id ?? ''}:${activeNiche.id}`");
    expect(hook).toContain('activeNiche.specialists.includes(saved.specialistId as SpecialistId)');
    expect(hook).toContain('SPECIALISTS[specialistId]?.captureRequirements');
  });

  test('shared capture sends the selected specialist, tenant and capture mode to the AI service', () => {
    const hook = fs.readFileSync(path.join(root, 'hooks/useGenericCapture.ts'), 'utf8');

    expect(hook).toContain('identifyItemWithAI(visible.images,specialistId');
    expect(hook).toContain('tenantId:tenant.id,captureMode:visible.mode');
    expect(hook).toContain('saveIdentifiedItem(tenant.id,result');
  });
});
