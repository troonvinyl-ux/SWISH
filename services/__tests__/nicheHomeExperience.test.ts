import { getNicheHomeExperience } from '../nicheHomeExperience';

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