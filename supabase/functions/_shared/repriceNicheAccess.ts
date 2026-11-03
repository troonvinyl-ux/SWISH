// Server-only adapter over the generated canonical registry; no parallel niche list.
import modules from './niche-modules.json' with { type: 'json' };

export const REPRICE_NICHE_SPECIALISTS: Record<string, readonly string[]> = Object.fromEntries(
  Object.entries(modules.products).map(([nicheId, product]) => [
    nicheId,
    [...product.specialists],
  ]),
);

export function isSpecialistAllowedForReprice(nicheId: unknown, specialistId: unknown): boolean {
  if (typeof nicheId !== 'string' || typeof specialistId !== 'string' ||
      !Object.hasOwn(REPRICE_NICHE_SPECIALISTS, nicheId)) return false;
  return REPRICE_NICHE_SPECIALISTS[nicheId].includes(specialistId);
}
