import { classifyListing, nicheToSpecialistId } from '@/services/nicheCategoryService';
import { resolveProductionNiche, getProductionNicheSpecialistIds } from '@/services/nicheRouting';
import { SPECIALIST_PROFILES } from '@/shared/specialistIntelligence';
import { getNicheHomeExperience } from '@/services/nicheHomeExperience';

describe('Collectibles Flipper niche', () => {
  test.each([
    ['Wedgwood Jasperware trinket box', 'collectibles'],
    ['Harrods anniversary teddy bear with tags', 'collectibles'],
    ['Royal Doulton figurine', 'collectibles'],
    ['Silver-plated serving spoons', 'collectibles'],
  ])('classifies %s to the dedicated collectibles specialist', (title, expected) => {
    const result = classifyListing(null, null, title);
    expect(result.niche).toBe(expected);
    expect(nicheToSpecialistId(result.niche)).toBe('collectibles');
  });

  test('shows the evidence checklist and silver / rarity safety cautions on its home', () => {
    const home = getNicheHomeExperience('collectibles');
    expect(home?.evidenceChecks).toContain('Base stamps, labels, tags and edition numbers');
    expect(home?.cautionBody).toContain('cannot certify sterling content');
  });

  test('uses its own canonical specialist and never the legacy catch-all', () => {
    expect(resolveProductionNiche('collectibles')).toBe('collectibles');
    expect(getProductionNicheSpecialistIds('collectibles')).toEqual(['collectibles']);
    expect(SPECIALIST_PROFILES.collectibles.fields.map(field => field.key)).toEqual(expect.arrayContaining(['brand','object_type','hallmark','edition','condition_notes']));
  });

  test('does not reclassify unrelated coins or clothing as collectibles', () => {
    expect(classifyListing(null, null, 'Roman silver denarius').niche).toBe('coins');
    expect(classifyListing(null, null, 'Vintage Levi denim jacket').niche).toBe('clothing');
  });
});
