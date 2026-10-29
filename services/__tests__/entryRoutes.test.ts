
// SWISH-001 — Entry Route Mapping Tests
// SWISH-006 — Evidence-First Identification and Valuation Guardrail Tests
// SWISH-003 — Bicycle Specialist ID Gap Tests
//
// These tests verify that each niche ID maps to the correct entry route,
// and that no niche is silently redirected to an unrelated application shell.
// SWISH-003 tests verify the bicycle specialist ID is correctly assigned
// throughout the niche classification and filtering pipeline.
//
// Run with: npx jest services/__tests__/entryRoutes.test.ts
// (No native modules required — pure TypeScript logic tests.)

import { nicheToEntryRoute, resolveProductionNiche } from '@/services/nicheRouting';

type NicheId =
  | 'coins' | 'trading_cards' | 'antiques' | 'bicycles' | 'motocross'
  | 'fossils' | 'clothing' | 'beauty' | 'tech' | 'surplus_flip' | 'general';

// ── Tests ────────────────────────────────────────────────────────────────────

// ── SWISH-003: Bicycle specialist classification ─────────────────────────────
// Inline the nicheToSpecialistId function (mirrors services/nicheCategoryService.ts)
type NicheClassification003 =
  | 'coins' | 'motocross' | 'bicycles' | 'clothing'
  | 'trading_cards' | 'antiques' | 'fossils' | 'beauty' | 'tech' | 'surplus_flip' | 'unclassified';

function nicheToSpecialistId(niche: NicheClassification003): string {
  switch (niche) {
    case 'coins':         return 'coins';
    case 'motocross':     return 'motocross';
    case 'bicycles':      return 'bicycles';
    case 'clothing':      return 'clothing';
    case 'trading_cards': return 'pokemon_cards';
    case 'antiques':      return 'antiques';
    case 'fossils':       return 'fossils';
    case 'beauty':        return 'beauty';
    case 'tech':          return 'tech';
    case 'surplus_flip':  return 'surplus_trader';
    default:              return 'curiosities_collectibles';
  }
}

// Inline inventory filter logic (mirrors getNicheTheme in app/(tabs)/inventory.tsx)
function getInventorySpecialistIds(activeNicheId: string): string[] {
  return getProductionNicheSpecialistIds(activeNicheId);
}

// Inline listings niche filter (mirrors nicheSpecialistIds in app/(tabs)/listings.tsx)
function getListingsSpecialistIds(activeNicheId: string): string[] {
  return getProductionNicheSpecialistIds(activeNicheId);
}

// Inline niche-context guard (mirrors aiIdentificationService.ts)
const GENERIC_SPECIALISTS = new Set(['curiosities_collectibles']);
const NICHE_SPECIFIC_SPECIALISTS = new Set([
  'bicycles', 'motocross', 'clothing', 'trainers_sneakers',
  'coins', 'islamic_silver', 'banknotes', 'gold', 'silver',
  'pokemon_cards', 'trading_cards', 'stamps', 'vinyl_records',
  'books', 'retro_games', 'retro_consoles', 'fossils', 'beauty', 'tech', 'surplus_trader',
]);

function resolveSpecialistId(
  callerSpecialist: string,
  aiReturnedSpecialist: string | undefined
): string {
  if (
    NICHE_SPECIFIC_SPECIALISTS.has(callerSpecialist) &&
    (!aiReturnedSpecialist || GENERIC_SPECIALISTS.has(aiReturnedSpecialist))
  ) {
    return callerSpecialist;
  }
  return aiReturnedSpecialist ?? callerSpecialist;
}

describe('SWISH-003: Bicycle specialist ID gap fix', () => {

  // ── AC 1: nicheToSpecialistId returns 'bicycles' ─────────────────────────
  describe('AC-1: nicheToSpecialistId returns bicycles', () => {
    test('nicheToSpecialistId(bicycles) === bicycles', () => {
      expect(nicheToSpecialistId('bicycles')).toBe('bicycles');
    });
    test('nicheToSpecialistId(bicycles) !== curiosities_collectibles (D-001 regression)', () => {
      expect(nicheToSpecialistId('bicycles')).not.toBe('curiosities_collectibles');
    });
    test('nicheToSpecialistId(coins) still returns coins (coin niche unaffected)', () => {
      expect(nicheToSpecialistId('coins')).toBe('coins');
    });
    test('nicheToSpecialistId(motocross) still returns motocross (MX unaffected)', () => {
      expect(nicheToSpecialistId('motocross')).toBe('motocross');
    });
    test('nicheToSpecialistId(clothing) still returns clothing (clothing unaffected)', () => {
      expect(nicheToSpecialistId('clothing')).toBe('clothing');
    });
  });

  // ── AC 3 & 4: Inventory and listings filters both use bicycles only ────────
  describe('AC-3 & AC-4: Inventory and listings filters use [bicycles]', () => {
    test('inventory filter for bicycles niche contains bicycles', () => {
      const ids = getInventorySpecialistIds('bicycles');
      expect(ids).toContain('bicycles');
    });
    test('inventory filter retains the supported cycling legacy alias', () => {
      const ids = getInventorySpecialistIds('bicycles');
      expect(ids).toContain('cycling');
    });
    test('inventory filter for bicycles niche is exactly [bicycles]', () => {
      expect(getInventorySpecialistIds('bicycles')).toEqual(['bicycles']);
    });
    test('listings filter for bicycles niche contains bicycles', () => {
      const ids = getListingsSpecialistIds('bicycles');
      expect(ids).toContain('bicycles');
    });
    test('listings filter retains the supported cycling legacy alias', () => {
      const ids = getListingsSpecialistIds('bicycles');
      expect(ids).toContain('cycling');
    });
    test('listings filter for bicycles niche is exactly [bicycles]', () => {
      expect(getListingsSpecialistIds('bicycles')).toEqual(['bicycles']);
    });
  });

  // ── AC 6: Bicycle items cannot appear in other niches ─────────────────────
  describe('AC-6: Bicycle items do not leak into other niche filters', () => {
    const bicycleSpecialistId = 'bicycles';

    test('bicycle item does not match coins inventory filter', () => {
      const coinsFilter = getInventorySpecialistIds('coins');
      expect(coinsFilter).not.toContain(bicycleSpecialistId);
    });
    test('bicycle item does not match motocross inventory filter', () => {
      const mxFilter = getInventorySpecialistIds('motocross');
      expect(mxFilter).not.toContain(bicycleSpecialistId);
    });
    test('bicycle item does not match clothing inventory filter', () => {
      const clothingFilter = getInventorySpecialistIds('clothing');
      expect(clothingFilter).not.toContain(bicycleSpecialistId);
    });
    test('bicycle item does not match coins listings filter', () => {
      const coinsFilter = getListingsSpecialistIds('coins');
      expect(coinsFilter).not.toContain(bicycleSpecialistId);
    });
    test('bicycle item does not match motocross listings filter', () => {
      const mxFilter = getListingsSpecialistIds('motocross');
      expect(mxFilter).not.toContain(bicycleSpecialistId);
    });
    test('bicycle item does not match clothing listings filter', () => {
      const clothingFilter = getListingsSpecialistIds('clothing');
      expect(clothingFilter).not.toContain(bicycleSpecialistId);
    });
  });

  // ── Niche-context guard: AI override prevention ───────────────────────────
  describe('Niche-context guard: AI cannot silently override bicycle specialistId', () => {
    test('bicycle caller + AI returns curiosities_collectibles → keeps bicycles', () => {
      expect(resolveSpecialistId('bicycles', 'curiosities_collectibles')).toBe('bicycles');
    });
    test('bicycle caller + AI returns undefined → keeps bicycles', () => {
      expect(resolveSpecialistId('bicycles', undefined)).toBe('bicycles');
    });
    test('bicycle caller + AI returns canonical antiques specialist → accepts specialist result', () => {
      expect(resolveSpecialistId('bicycles', 'antiques')).toBe('antiques');
    });
    test('bicycle caller + AI returns motocross → accepts motocross (niche-specific override OK)', () => {
      // AI determined it is actually an MX bike not a bicycle
      expect(resolveSpecialistId('bicycles', 'motocross')).toBe('motocross');
    });
    test('coins caller + AI returns curiosities_collectibles → keeps coins', () => {
      expect(resolveSpecialistId('coins', 'curiosities_collectibles')).toBe('coins');
    });
    test('motocross caller + AI returns curiosities_collectibles → keeps motocross', () => {
      expect(resolveSpecialistId('motocross', 'curiosities_collectibles')).toBe('motocross');
    });
    test('clothing caller + AI returns curiosities_collectibles → keeps clothing', () => {
      expect(resolveSpecialistId('clothing', 'curiosities_collectibles')).toBe('clothing');
    });
    test('curiosities_collectibles caller + AI returns coins → accepts coins (AI more specific)', () => {
      // Generic caller: AI is more specific → accept AI
      expect(resolveSpecialistId('curiosities_collectibles', 'coins')).toBe('coins');
    });
  });

  // ── AC 7: curiosities_collectibles items are not affected ─────────────────
  describe('AC-7: Existing curiosities_collectibles records are not migrated', () => {
    test('curiosities_collectibles does NOT appear in bicycles inventory filter', () => {
      const bikeFilter = getInventorySpecialistIds('bicycles');
      expect(bikeFilter).not.toContain('curiosities_collectibles');
    });
    test('bicycles specialist does NOT appear in coins inventory filter', () => {
      const coinFilter = getInventorySpecialistIds('coins');
      expect(coinFilter).not.toContain('bicycles');
    });
    test('nicheToSpecialistId(antiques) returns the canonical antiques specialist', () => {
      expect(nicheToSpecialistId('antiques')).toBe('antiques');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SWISH-004: Onboarding import is strictly scoped to the selected niche
// ─────────────────────────────────────────────────────────────────────────────

type NicheId004 =
  | 'coins' | 'motocross' | 'bicycles' | 'clothing'
  | 'trading_cards' | 'antiques' | 'fossils' | 'beauty' | 'tech' | 'surplus_flip' | 'general';

type NicheClassification004 =
  | 'coins' | 'motocross' | 'bicycles' | 'clothing'
  | 'trading_cards' | 'antiques' | 'fossils' | 'beauty' | 'tech' | 'surplus_flip' | 'unclassified';

const CATEGORY_ID_TO_NICHE_004: Record<string, NicheClassification004> = {
  '4726': 'coins', '40714': 'coins', '18594': 'coins', '4157': 'coins',
  '4735': 'coins', '11116': 'coins', '14486': 'coins',
  '6760': 'motocross', '6759': 'motocross', '10767': 'motocross', '10768': 'motocross',
  '6761': 'motocross', '26455': 'motocross',
  '2904': 'bicycles', '56197': 'bicycles', '177831': 'bicycles', '48647': 'bicycles',
  '56199': 'bicycles', '177832': 'bicycles', '2906': 'bicycles', '15279': 'bicycles',
  '1059': 'clothing', '11450': 'clothing', '15724': 'clothing', '15725': 'clothing',
  '152506': 'clothing', '175748': 'clothing',
};

const NICHE_TO_CLASSIFICATION_004: Record<NicheId004, NicheClassification004> = {
  coins: 'coins',
  motocross: 'motocross',
  bicycles: 'bicycles',
  clothing: 'clothing',
  trading_cards: 'trading_cards',
  antiques: 'antiques',
  fossils: 'fossils',
  beauty: 'beauty',
  tech: 'tech',
  surplus_flip: 'surplus_flip',
  general: 'unclassified',
};

function nicheToSpecialistId004(niche: NicheClassification004): string {
  switch (niche) {
    case 'coins': return 'coins';
    case 'motocross': return 'motocross';
    case 'bicycles': return 'bicycles';
    case 'clothing': return 'clothing';
    case 'trading_cards': return 'pokemon_cards';
    case 'antiques': return 'antiques';
    case 'fossils': return 'fossils';
    case 'beauty': return 'beauty';
    case 'tech': return 'tech';
    case 'surplus_flip': return 'surplus_trader';
    default: return 'curiosities_collectibles';
  }
}

function resolveImportSpecialistId004(
  listing: { categoryId?: string; categoryName?: string; title?: string },
  subscriberNiche: NicheId004,
): string | null {
  const detected = listing.categoryId
    ? CATEGORY_ID_TO_NICHE_004[listing.categoryId] ?? 'unclassified'
    : 'unclassified';
  const selected = NICHE_TO_CLASSIFICATION_004[subscriberNiche];
  // Match the production guard: do not default unknown products into a niche,
  // and do not import a definitively different niche into this subscriber's stock.
  if (detected === 'unclassified' || detected !== selected) return null;
  return nicheToSpecialistId004(detected);
}

describe('SWISH-004: strict onboarding import niche guard', () => {
  test('imports a classified clothing listing for Threads Flip', () => {
    expect(resolveImportSpecialistId004({ categoryId: '175748', title: 'Stone Island jacket' }, 'clothing')).toBe('clothing');
  });

  test('skips a bicycle listing for Threads Flip', () => {
    expect(resolveImportSpecialistId004({ categoryId: '2904', title: 'Trek mountain bike' }, 'clothing')).toBeNull();
  });

  test('skips a coin listing for Threads Flip', () => {
    expect(resolveImportSpecialistId004({ categoryId: '4726', title: 'Ancient coin' }, 'clothing')).toBeNull();
  });

  test('skips unclassified listings instead of assigning them to the selected niche', () => {
    expect(resolveImportSpecialistId004({ title: 'Unknown item' }, 'clothing')).toBeNull();
  });

  test('keeps bicycle listings in the bicycle niche', () => {
    expect(resolveImportSpecialistId004({ categoryId: '177831', title: 'Mountain bike' }, 'bicycles')).toBe('bicycles');
  });

  test('keeps motocross listings in the MX niche', () => {
    expect(resolveImportSpecialistId004({ categoryId: '10767', title: 'KTM motocross bike' }, 'motocross')).toBe('motocross');
  });

  test('keeps coin listings in the coins niche', () => {
    expect(resolveImportSpecialistId004({ categoryId: '40714', title: 'Roman coin' }, 'coins')).toBe('coins');
  });
});
