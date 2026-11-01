// Server-side niche scope for repricing. Keep aligned with niche-modules.json.
export const REPRICE_NICHE_SPECIALISTS: Readonly<Record<string, readonly string[]>> = {
  coins: ['coins', 'islamic_silver', 'banknotes', 'gold', 'silver', 'jewellery_precious_metals', 'ancient_artefacts'],
  motocross: ['motocross'],
  bicycles: ['bicycles'],
  clothing: ['clothing', 'trainers_sneakers'],
  trading_cards: ['pokemon_cards', 'trading_cards'],
  antiques: ['antiques', 'books'],
  fossils: ['fossils'],
  beauty: ['beauty'],
  tech: ['tech', 'retro_games', 'retro_consoles'],
  surplus_flip: ['surplus_trader'],
};

export function isSpecialistAllowedForReprice(nicheId: string, specialistId: string | null | undefined): boolean {
  if (!specialistId) return false;
  return REPRICE_NICHE_SPECIALISTS[nicheId]?.includes(specialistId) ?? false;
}
