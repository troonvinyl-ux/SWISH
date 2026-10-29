import { NICHES, type ProductionNicheId } from '@/constants/niches';

export type ProductEntryRoute =
  | '/entry/coins'
  | '/entry/motocross'
  | '/entry/bicycles'
  | '/entry/clothing'
  | '/entry/cards'
  | '/entry/antiques'
  | '/entry/fossils'
  | '/entry/beauty'
  | '/entry/tech'
  | '/entry/surplus-flip';

/**
 * Resolve historical specialist/product aliases to a registered production
 * product. Unknown and inactive niche IDs intentionally return null; callers
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

  if (id === 'surplus_flip' || id === 'surplus-flip' || id === 'catalog_flip' || id === 'catalog_surplus' || id === 'surplus_trader') return 'surplus_flip';

  if (id === 'motocross' || id === 'mx' || id === 'flipper_mx') return 'motocross';
  if (id === 'bicycles' || id === 'cycling' || id === 'bikes' || id === 'bike_flipper') return 'bicycles';

  if (
    id === 'clothing' || id === 'fashion' || id === 'trainers_sneakers' ||
    id === 'trainers' || id === 'threads_flip' || id === 'clothing_specialist'
  ) return 'clothing';

  if (id === 'trading_cards' || id === 'pokemon_cards' || id === 'cards' || id === 'card_flipper') return 'trading_cards';
  if (id === 'antiques' || id === 'antique_flipper' || id === 'books') return 'antiques';
  if (id === 'fossils' || id === 'fossil_flipper') return 'fossils';
  if (id === 'beauty' || id === 'beauty_flipper') return 'beauty';
  if (id === 'tech' || id === 'technology' || id === 'tech_flipper' || id === 'retro_games' || id === 'retro_consoles') return 'tech';

  return null;
}

/**
 * Canonical specialist allow-list for the active production niche.
 * Unknown or inactive niches receive no specialist access; callers must not
 * fall back to a different niche's inventory.
 */
export function getProductionNicheSpecialistIds(
  nicheId: string | null | undefined,
): string[] {
  const productionNiche = resolveProductionNiche(nicheId);
  if (!productionNiche) return [];

  // Canonical IDs are used for all new records. Keep only known, niche-local
  // historical aliases visible so old inventory remains accessible without
  // reopening an unfiltered query or accepting the obsolete clothing_specialist.
  const legacyAliases: Partial<Record<ProductionNicheId, string[]>> = {
    coins: ['coins_uk', 'coins_world', 'coins_currency', 'numismatic'],
    motocross: ['mx'],
    bicycles: ['bikes', 'cycling'],
    trading_cards: ['cards'],
    surplus_flip: ['surplus_flip'],
    tech: ['retro_games', 'retro_consoles'],
  };
  return [...new Set([
    ...NICHES[productionNiche].specialists,
    ...(legacyAliases[productionNiche] ?? []),
  ])];
}

export function nicheToEntryRoute(nicheId: string | null | undefined): ProductEntryRoute | null {
  const niche = resolveProductionNiche(nicheId);
  if (!niche) return null;
  switch (niche) {
    case 'coins': return '/entry/coins';
    case 'motocross': return '/entry/motocross';
    case 'bicycles': return '/entry/bicycles';
    case 'clothing': return '/entry/clothing';
    case 'trading_cards': return '/entry/cards';
    case 'antiques': return '/entry/antiques';
    case 'fossils': return '/entry/fossils';
    case 'beauty': return '/entry/beauty';
    case 'tech': return '/entry/tech';
    case 'surplus_flip': return '/entry/surplus-flip';
  }
  return null;
}
