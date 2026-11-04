// Shell routes are adapters, not alternative product IDs. Specialist contracts stay canonical.
import { NICHE_MODULES, NICHES, PRODUCTION_NICHE_IDS, type ProductionNicheId } from '@/constants/niches';
import type { OperationScope } from '@/shared/moduleContracts';
export const MODULE_PATHS = Object.fromEntries(PRODUCTION_NICHE_IDS.map(id => [id, NICHE_MODULES[id].modulePath ?? '/' + NICHE_MODULES[id].entry.replace(/\.tsx$/, '')])) as Record<ProductionNicheId, string>;
export function permittedModules(ids: readonly string[]) {
  return PRODUCTION_NICHE_IDS.filter(id => ids.includes(id)).map(id => ({
    ...NICHE_MODULES[id], niche: NICHES[id], route: MODULE_PATHS[id],
    navigation: ['Home', 'Scan', 'Inventory', 'Listings', 'More'] as const,
    inventorySpecialists: [...new Set([...NICHE_MODULES[id].specialists, ...NICHE_MODULES[id].legacySpecialists])],
    identificationRequirements: NICHES[id].captureInstructions,
  }));
}
export function moduleScopeKey(scope: OperationScope, userId: string, epoch = 0): string {
  return `${userId}:${scope.tenantId}:${scope.nicheId}:${epoch}`;
}
export function moduleForPath(path: string): ProductionNicheId | null {
  const normalized = path.split('?')[0].replace(/\/$/, '');
  return PRODUCTION_NICHE_IDS.find(id => MODULE_PATHS[id] === normalized || '/' + NICHE_MODULES[id].entry.replace(/\.tsx$/, '') === normalized) ?? null;
}
