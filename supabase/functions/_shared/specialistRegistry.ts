// Server-only adapter to the SAME public identity and expertise used by Expo.
import modules from './niche-modules.json' with { type: 'json' };
import { getSpecialistProfile } from './specialistIntelligence.ts';
export function specialistNiche(specialistId: string): string | null {
  for (const [id, config] of Object.entries(modules.products)) {
    if ([...config.specialists,...config.legacySpecialists].includes(specialistId)) return id;
  }
  return null;
}
export function canonicalSpecialist(specialistId: string): string | null {
  for (const config of Object.values(modules.products)) {
    if (config.specialists.includes(specialistId)) return specialistId;
    if (config.legacySpecialists.includes(specialistId)) return config.defaultSpecialist;
  }
  // Preserve supported non-product specialist workflows, without granting another niche.
  return ['curiosities_collectibles','stamps','vinyl_records','cryptocurrency'].includes(specialistId) ? specialistId : null;
}
export function profileForSpecialist(specialistId: string) {
  const niche = specialistNiche(specialistId);
  return niche ? getSpecialistProfile(niche) : null;
}
