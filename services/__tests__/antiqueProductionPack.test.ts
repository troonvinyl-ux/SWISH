import { NICHE_MODULES } from '@/constants/niches';
import { SPECIALISTS } from '@/constants/specialists';
import { SPECIALIST_PROFILES } from '@/shared/specialistIntelligence';

describe('Antique Flipper production pack', () => {
  it('has a dedicated branded home and isolated specialist route set', () => {
    expect(NICHE_MODULES.antiques.home).toBe('antique-flipper.tsx');
    expect(NICHE_MODULES.antiques.specialists).toEqual(['antiques', 'books']);
    expect(NICHE_MODULES.antiques.dedicatedRoutes).toContain('antique-guides.tsx');
    expect(NICHE_MODULES.antiques.dedicatedRoutes).toContain('antique-condition.tsx');
    expect(NICHE_MODULES.antiques.dedicatedRoutes).toContain('antique-value.tsx');
    expect(NICHE_MODULES.antiques.dedicatedRoutes).toContain('(tabs)/antique-more.tsx');
  });

  it('captures the evidence needed for responsible antique identification', () => {
    const ids = SPECIALISTS.antiques.captureRequirements.map(requirement => requirement.id);
    expect(ids).toEqual(expect.arrayContaining(['front', 'back', 'underside', 'marks', 'damage', 'scale']));
    expect(SPECIALISTS.antiques.capabilities.validateListing).toBe(true);
    expect(SPECIALISTS.antiques.keyAttributes).toContain('provenance');
  });

  it('keeps attribution, condition and valuation evidence conservative', () => {
    const profile = SPECIALIST_PROFILES.antiques;
    expect(profile.taxonomy).toEqual(expect.arrayContaining(['furniture', 'porcelain', 'glassware', 'silverware', 'books']));
    expect(profile.recognition).toContain('never invent a maker');
    expect(profile.conditionRules).toContain('Do not recommend polishing');
    expect(profile.valuationRules).toContain('completed-sale evidence');
    expect(profile.listingRules).toContain('required item specifics');
  });
});
