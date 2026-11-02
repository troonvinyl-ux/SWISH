import { getNicheHomeExperience } from '../nicheHomeExperience';
import { NICHES, PRODUCTION_NICHE_IDS } from '@/constants/niches';
import { getSpecialistProfile } from '@/shared/specialistIntelligence';
import { nicheToScannerRoute } from '@/services/nicheRouting';

describe('specialist home experiences', () => {
  test.each(['trading_cards', 'fossils', 'beauty', 'tech'])('%s has its own specialist guidance and safety checks', (nicheId) => {
    const experience = getNicheHomeExperience(nicheId);
    expect(experience).not.toBeNull();
    expect(experience?.headline.length).toBeGreaterThan(20);
    expect(experience?.evidenceChecks.length).toBeGreaterThanOrEqual(4);
    expect(experience?.cautionTitle.length).toBeGreaterThan(8);
    expect(experience?.cautionBody.length).toBeGreaterThan(30);
  });

  test('the four shared-home niches do not fall back to generic copy', () => {
    const ids = ['trading_cards', 'fossils', 'beauty', 'tech'];
    const titles = ids.map(id => getNicheHomeExperience(id)?.focusTitle);
    expect(new Set(titles).size).toBe(ids.length);
  });

  test('dedicated products retain their existing home implementations', () => {
    expect(getNicheHomeExperience('coins')).toBeNull();
    expect(getNicheHomeExperience('motocross')).toBeNull();
    expect(getNicheHomeExperience('clothing')).toBeNull();
  });

  test('unknown niche IDs fail closed rather than inheriting a specialist template', () => {
    expect(getNicheHomeExperience('unknown-niche')).toBeNull();
    expect(getNicheHomeExperience(null)).toBeNull();
  });
});
describe('all ten niche capture contracts', () => {
  test.each(PRODUCTION_NICHE_IDS)('%s has a specialist profile, capture guidance and a scanner route', (nicheId) => {
    const niche = NICHES[nicheId];
    const profile = getSpecialistProfile(nicheId);
    expect(profile).not.toBeNull();
    expect(niche.captureInstructions.length).toBeGreaterThanOrEqual(4);
    expect(niche.keyAttributes.length).toBeGreaterThanOrEqual(3);
    expect(nicheToScannerRoute(nicheId)).toMatch(/^\\//);
  });
});
