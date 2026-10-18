import type { ProductionNicheId } from '@/constants/niches';

export type ProductEntryRoute =
  | '/entry/coins'
  | '/entry/motocross'
  | '/entry/bicycles'
  | '/entry/clothing';

/**
 * Resolve historical specialist/product aliases to one of the four production
 * products. Unknown and inactive niche IDs intentionally return null; callers
 * must route to product selection instead of silently opening Coins.
 */
export function resolveProductionNiche(
  nicheId: string | null | undefined,
): ProductionNicheId | null {
  if (!nicheId) return null;
  const id = nicheId.trim().toLowerCase();

  if (
    id === 'coins' || id === 'coins_uk' || id === 'coins_world' ||
    id === 'coins_currency' || id === 'banknotes' || id === 'gold' ||
    id === 'silver' || id === 'islamic_silver' || id === 'ancient_artefacts' ||
    id === 'curiosities_collectibles' || id.includes('coin') || id === 'numismatic'
  ) return 'coins';

  if (id === 'motocross' || id === 'mx' || id === 'flipper_mx') return 'motocross';
  if (id === 'bicycles' || id === 'cycling' || id === 'bikes' || id === 'bike_flipper') return 'bicycles';

  if (
    id === 'clothing' || id === 'fashion' || id === 'trainers_sneakers' ||
    id === 'trainers' || id === 'threads_flip'
  ) return 'clothing';

  return null;
}

export function nicheToEntryRoute(nicheId: string | null | undefined): ProductEntryRoute | null {
  const niche = resolveProductionNiche(nicheId);
  if (!niche) return null;
  switch (niche) {
    case 'coins': return '/entry/coins';
    case 'motocross': return '/entry/motocross';
    case 'bicycles': return '/entry/bicycles';
    case 'clothing': return '/entry/clothing';
  }
  return null;
}
