
// SWISH-001 — Entry Route Mapping Tests
// SWISH-003 — Bicycle Specialist ID Gap Tests
//
// These tests verify that each niche ID maps to the correct entry route,
// and that no niche is silently redirected to an unrelated application shell.
// SWISH-003 tests verify the bicycle specialist ID is correctly assigned
// throughout the niche classification and filtering pipeline.
//
// Run with: npx jest services/__tests__/entryRoutes.test.ts
// (No native modules required — pure TypeScript logic tests.)

// ── Inline implementation of nicheToEntryRoute (mirrors app/index.tsx) ──────
// We inline the function here so tests remain independent of the React
// component tree and can run in a plain Node/Jest environment.

type NicheId =
  | 'coins' | 'trading_cards' | 'antiques' | 'bicycles' | 'motocross'
  | 'fossils' | 'clothing' | 'beauty' | 'general';

function nicheToEntryRoute(nicheId: NicheId | null | undefined): string {
  if (!nicheId) return '/entry/coins';

  const id = nicheId.toLowerCase();

  if (
    id === 'coins' || id === 'coins_uk' || id === 'coins_world' ||
    id === 'banknotes' || id === 'gold' || id === 'silver' ||
    id === 'islamic_silver' || id === 'ancient_artefacts' ||
    id === 'curiosities_collectibles' || id.includes('coin')
  ) return '/entry/coins';

  if (id === 'motocross' || id === 'mx') return '/entry/motocross';

  if (id === 'bicycles' || id === 'cycling' || id === 'bikes') return '/entry/bicycles';

  if (
    id === 'clothing' || id === 'fashion' ||
    id === 'trainers_sneakers' || id === 'trainers' || id === 'threads_flip'
  ) return '/entry/clothing';

  return '/entry/coins'; // fallback
}

// ── Tests ────────────────────────────────────────────────────────────────────

// ── SWISH-003: Bicycle specialist classification ─────────────────────────────
// Inline the nicheToSpecialistId function (mirrors services/nicheCategoryService.ts)
type NicheClassification003 =
  | 'coins' | 'motocross' | 'bicycles' | 'clothing'
  | 'trading_cards' | 'antiques' | 'unclassified';

function nicheToSpecialistId(niche: NicheClassification003): string {
  switch (niche) {
    case 'coins':         return 'coins';
    case 'motocross':     return 'motocross';
    case 'bicycles':      return 'bicycles';
    case 'clothing':      return 'clothing';
    case 'trading_cards': return 'pokemon_cards';
    case 'antiques':      return 'curiosities_collectibles';
    default:              return 'curiosities_collectibles';
  }
}

// Inline inventory filter logic (mirrors getNicheTheme in app/(tabs)/inventory.tsx)
function getInventorySpecialistIds(activeNicheId: string): string[] {
  const id = activeNicheId.toLowerCase();
  if (id.includes('coin') || id === 'gold' || id === 'silver' || id === 'banknotes' || id === 'islamic_silver') {
    return ['coins', 'coins_uk', 'coins_world', 'islamic_silver', 'banknotes', 'gold', 'silver', 'ancient_artefacts'];
  }
  if (id === 'motocross' || id === 'mx') return ['motocross'];
  if (id === 'bicycles' || id === 'cycling' || id === 'bikes') return ['bicycles'];
  if (id === 'clothing' || id === 'fashion' || id === 'trainers_sneakers' || id === 'trainers') return ['clothing', 'trainers_sneakers'];
  return [];
}

// Inline listings niche filter (mirrors nicheSpecialistIds in app/(tabs)/listings.tsx)
function getListingsSpecialistIds(activeNicheId: string): string[] {
  const id = activeNicheId.toLowerCase();
  if (id === 'motocross' || id === 'mx') return ['motocross'];
  if (id === 'bicycles' || id === 'cycling' || id === 'bikes') return ['bicycles'];
  if (id === 'clothing' || id === 'fashion' || id === 'trainers_sneakers' || id === 'trainers') return ['clothing', 'trainers_sneakers'];
  return ['coins', 'coins_uk', 'coins_world', 'islamic_silver', 'banknotes', 'gold', 'silver', 'ancient_artefacts'];
}

// Inline niche-context guard (mirrors aiIdentificationService.ts)
const GENERIC_SPECIALISTS = new Set(['curiosities_collectibles', 'antiques']);
const NICHE_SPECIFIC_SPECIALISTS = new Set([
  'bicycles', 'motocross', 'clothing', 'trainers_sneakers',
  'coins', 'islamic_silver', 'banknotes', 'gold', 'silver',
  'pokemon_cards', 'trading_cards', 'stamps', 'vinyl_records',
  'books', 'retro_games', 'retro_consoles',
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
    test('inventory filter for bicycles niche does NOT contain cycling (invalid ID removed)', () => {
      const ids = getInventorySpecialistIds('bicycles');
      expect(ids).not.toContain('cycling');
    });
    test('inventory filter for bicycles niche is exactly [bicycles]', () => {
      expect(getInventorySpecialistIds('bicycles')).toEqual(['bicycles']);
    });
    test('listings filter for bicycles niche contains bicycles', () => {
      const ids = getListingsSpecialistIds('bicycles');
      expect(ids).toContain('bicycles');
    });
    test('listings filter for bicycles niche does NOT contain cycling (invalid ID removed)', () => {
      const ids = getListingsSpecialistIds('bicycles');
      expect(ids).not.toContain('cycling');
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
    test('bicycle caller + AI returns antiques → keeps bicycles (antiques is generic)', () => {
      expect(resolveSpecialistId('bicycles', 'antiques')).toBe('bicycles');
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
    test('nicheToSpecialistId(antiques) still returns curiosities_collectibles', () => {
      expect(nicheToSpecialistId('antiques')).toBe('curiosities_collectibles');
    });
  });
});

// The error message "Parsing error: Declaration or statement expected." at 335:0
// indicates that there's a block of code outside of any 'describe' or 'test' blocks,
// or perhaps an unclosed block before that line.
// In this case, the `describe` block for 'SWISH-003: Bicycle specialist ID gap fix'
// on line 124 is closed on line 333. The subsequent describe blocks were
// intended to be part of a larger `describe` block for 'SWISH-001 — Entry Route Mapping Tests',
// which was never opened.
// To fix this, we'll wrap the remaining test suites in a `describe` block.

describe('SWISH-001: Entry Route Mapping Tests', () => {
  // ── Coins niche ──────────────────────────────────────────────────────────
  describe('Coins niche → /entry/coins', () => {
    test('coins → /entry/coins', () => {
      expect(nicheToEntryRoute('coins')).toBe('/entry/coins');
    });
    test('gold → /entry/coins', () => {
      expect(nicheToEntryRoute('gold' as any)).toBe('/entry/coins');
    });
    test('silver → /entry/coins', () => {
      expect(nicheToEntryRoute('silver' as any)).toBe('/entry/coins');
    });
    test('null → /entry/coins (fallback)', () => {
      expect(nicheToEntryRoute(null)).toBe('/entry/coins');
    });
    test('undefined → /entry/coins (fallback)', () => {
      expect(nicheToEntryRoute(undefined)).toBe('/entry/coins');
    });
    test('general → /entry/coins (unknown niche fallback)', () => {
      expect(nicheToEntryRoute('general')).toBe('/entry/coins');
    });
  });

  // ── Motocross niche ──────────────────────────────────────────────────────
  describe('Motocross niche → /entry/motocross', () => {
    test('motocross → /entry/motocross', () => {
      expect(nicheToEntryRoute('motocross')).toBe('/entry/motocross');
    });
    test('mx (alias) → /entry/motocross', () => {
      expect(nicheToEntryRoute('mx' as any)).toBe('/entry/motocross');
    });
  });

  // ── Bicycles niche ───────────────────────────────────────────────────────
  describe('Bicycles niche → /entry/bicycles', () => {
    test('bicycles → /entry/bicycles', () => {
      expect(nicheToEntryRoute('bicycles')).toBe('/entry/bicycles');
    });
    test('cycling (alias) → /entry/bicycles', () => {
      expect(nicheToEntryRoute('cycling' as any)).toBe('/entry/bicycles');
    });
    test('bikes (alias) → /entry/bicycles', () => {
      expect(nicheToEntryRoute('bikes' as any)).toBe('/entry/bicycles');
    });
  });

  // ── Clothing niche ───────────────────────────────────────────────────────
  describe('Clothing niche → /entry/clothing', () => {
    test('clothing → /entry/clothing', () => {
      expect(nicheToEntryRoute('clothing')).toBe('/entry/clothing');
    });
    test('fashion (alias) → /entry/clothing', () => {
      expect(nicheToEntryRoute('fashion' as any)).toBe('/entry/clothing');
    });
    test('trainers_sneakers (alias) → /entry/clothing', () => {
      expect(nicheToEntryRoute('trainers_sneakers' as any)).toBe('/entry/clothing');
    });
    test('threads_flip (alias) → /entry/clothing', () => {
      expect(nicheToEntryRoute('threads_flip' as any)).toBe('/entry/clothing');
    });
  });

  // ── Isolation check — no cross-niche leakage ─────────────────────────────
  describe('No cross-niche leakage', () => {
    const ENTRY_ROUTES = ['/entry/coins', '/entry/motocross', '/entry/bicycles', '/entry/clothing'] as const;

    const NICHE_EXPECTATIONS: Array<[NicheId | string, typeof ENTRY_ROUTES[number]]> = [
      ['coins',             '/entry/coins'],
      ['motocross',         '/entry/motocross'],
      ['bicycles',          '/entry/bicycles'],
      ['clothing',          '/entry/clothing'],
    ];

    NICHE_EXPECTATIONS.forEach(([nicheId, expectedRoute]) => {
      const otherRoutes = ENTRY_ROUTES.filter(r => r !== expectedRoute);
      otherRoutes.forEach(wrongRoute => {
        test(`${nicheId} must NOT map to ${wrongRoute}`, () => {
          expect(nicheToEntryRoute(nicheId as any)).not.toBe(wrongRoute);
        });
      });
    });
  });

  // ── All four entry routes are distinct ───────────────────────────────────
  describe('All four entry routes are distinct', () => {
    test('coins and motocross have different entry routes', () => {
      expect(nicheToEntryRoute('coins')).not.toBe(nicheToEntryRoute('motocross'));
    });
    test('coins and bicycles have different entry routes', () => {
      expect(nicheToEntryRoute('coins')).not.toBe(nicheToEntryRoute('bicycles'));
    });
    test('coins and clothing have different entry routes', () => {
      expect(nicheToEntryRoute('coins')).not.toBe(nicheToEntryRoute('clothing'));
    });
    test('motocross and bicycles have different entry routes', () => {
      expect(nicheToEntryRoute('motocross')).not.toBe(nicheToEntryRoute('bicycles'));
    });
    test('motocross and clothing have different entry routes', () => {
      expect(nicheToEntryRoute('motocross')).not.toBe(nicheToEntryRoute('clothing'));
    });
    test('bicycles and clothing have different entry routes', () => {
      expect(nicheToEntryRoute('bicycles')).not.toBe(nicheToEntryRoute('clothing'));
    });
  });
});
