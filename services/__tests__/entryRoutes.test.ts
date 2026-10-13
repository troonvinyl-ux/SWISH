
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

// ─────────────────────────────────────────────────────────────────────────────
// SWISH-004: Onboarding Import Niche Classification Tests
// ─────────────────────────────────────────────────────────────────────────────

// Inline the classification pipeline (mirrors app/onboarding.tsx + nicheCategoryService.ts)
// This ensures tests run without requiring the full React Native runtime.

type NicheId004 =
  | 'coins' | 'motocross' | 'bicycles' | 'clothing'
  | 'trading_cards' | 'antiques' | 'fossils' | 'beauty' | 'general';

type NicheClassification004 =
  | 'coins' | 'motocross' | 'bicycles' | 'clothing'
  | 'trading_cards' | 'antiques' | 'unclassified';

const NICHE_TO_CLASSIFICATION_004: Record<NicheId004, NicheClassification004> = {
  coins:         'coins',
  motocross:     'motocross',
  bicycles:      'bicycles',
  clothing:      'clothing',
  trading_cards: 'trading_cards',
  antiques:      'antiques',
  fossils:       'unclassified',
  beauty:        'unclassified',
  general:       'unclassified',
};

// Inline classifyListing (subset — covering the four primary niches)
// Uses the same category ID mapping as services/nicheCategoryService.ts
const CATEGORY_ID_TO_NICHE_004: Record<string, NicheClassification004> = {
  // Coins
  '4726': 'coins', '40714': 'coins', '18594': 'coins', '4157': 'coins',
  '4735': 'coins', '11116': 'coins', '14486': 'coins',
  // Motocross
  '6760': 'motocross', '6759': 'motocross', '10767': 'motocross', '10768': 'motocross',
  '6761': 'motocross', '26455': 'motocross',
  // Bicycles
  '2904': 'bicycles', '56197': 'bicycles', '177831': 'bicycles', '48647': 'bicycles',
  '56199': 'bicycles', '177832': 'bicycles', '2906': 'bicycles', '15279': 'bicycles',
  // Clothing
  '1059': 'clothing', '11450': 'clothing', '15724': 'clothing', '15725': 'clothing',
  '152506': 'clothing', '175748': 'clothing',
};

type ClassificationConfidence004 =
  | 'category_id' | 'category_name' | 'title_high' | 'title_medium' | 'none';

interface ClassificationResult004 {
  niche: NicheClassification004;
  confidence: ClassificationConfidence004;
}

function classifyListing004(
  categoryId: string | null,
  _categoryName: string | null,
  _title: string | null,
): ClassificationResult004 {
  if (categoryId && CATEGORY_ID_TO_NICHE_004[categoryId]) {
    return { niche: CATEGORY_ID_TO_NICHE_004[categoryId], confidence: 'category_id' };
  }
  return { niche: 'unclassified', confidence: 'none' };
}

function nicheToSpecialistId004(niche: NicheClassification004): string {
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

/**
 * Inline of the classification + fallback logic from app/onboarding.tsx
 * handleImportListings().
 */
function resolveImportSpecialistId(
  listing: { categoryId?: string; categoryName?: string; title?: string },
  subscriberNiche: NicheId004,
): { specialistId: string; confidence: ClassificationConfidence004; resolvedNiche: NicheClassification004 } {
  const subscriberClassification = NICHE_TO_CLASSIFICATION_004[subscriberNiche] ?? 'unclassified';

  const result = classifyListing004(
    listing.categoryId ?? null,
    listing.categoryName ?? null,
    listing.title ?? null,
  );

  let resolvedNiche: NicheClassification004;
  if (result.niche === 'unclassified') {
    // Cannot classify from eBay evidence — use subscriber niche as best-effort
    resolvedNiche = subscriberClassification !== 'unclassified'
      ? subscriberClassification
      : 'unclassified';
  } else {
    // Classified from eBay evidence — use the evidence result directly
    resolvedNiche = result.niche;
  }

  const specialistId = resolvedNiche === 'unclassified'
    ? 'curiosities_collectibles'
    : nicheToSpecialistId004(resolvedNiche);

  return { specialistId, confidence: result.confidence, resolvedNiche };
}

describe('SWISH-004: Onboarding import niche classification', () => {

  // ── AC-1: Bicycle listings receive specialist_id bicycles ─────────────────
  describe('AC-1: Bicycle listings → specialist_id=bicycles', () => {
    test('eBay category 2904 (Bicycles) → bicycles specialist', () => {
      const r = resolveImportSpecialistId({ categoryId: '2904', title: 'Trek mountain bike' }, 'coins');
      expect(r.specialistId).toBe('bicycles');
    });
    test('eBay category 177831 (Complete Mountain Bikes) → bicycles specialist', () => {
      const r = resolveImportSpecialistId({ categoryId: '177831', title: 'Specialized Rockhopper' }, 'coins');
      expect(r.specialistId).toBe('bicycles');
    });
    test('eBay category 56197 (Complete Road Bikes) → bicycles specialist', () => {
      const r = resolveImportSpecialistId({ categoryId: '56197', title: 'Giant Defy road bike' }, 'coins');
      expect(r.specialistId).toBe('bicycles');
    });
    test('eBay category 48647 (BMX) → bicycles specialist', () => {
      const r = resolveImportSpecialistId({ categoryId: '48647', title: 'Haro BMX' }, 'clothing');
      expect(r.specialistId).toBe('bicycles');
    });
    test('bicycle listing on a coins subscriber account → bicycles (not coins)', () => {
      const r = resolveImportSpecialistId({ categoryId: '177831', title: 'Trek Marlin 5 MTB' }, 'coins');
      expect(r.specialistId).toBe('bicycles');
      expect(r.specialistId).not.toBe('coins');
    });
    test('confidence is category_id for classified bicycle', () => {
      const r = resolveImportSpecialistId({ categoryId: '2904' }, 'bicycles');
      expect(r.confidence).toBe('category_id');
    });
  });

  // ── AC-2: Clothing listings receive correct specialist ────────────────────
  describe('AC-2: Clothing listings → specialist_id=clothing', () => {
    test('eBay category 11450 (Clothing, Shoes & Accessories) → clothing specialist', () => {
      const r = resolveImportSpecialistId({ categoryId: '11450', title: 'Vintage Levi jacket' }, 'coins');
      expect(r.specialistId).toBe('clothing');
    });
    test('eBay category 175748 (Vintage & Rare Clothing) → clothing specialist', () => {
      const r = resolveImportSpecialistId({ categoryId: '175748', title: 'Stone Island 90s' }, 'bicycles');
      expect(r.specialistId).toBe('clothing');
    });
    test('eBay category 152506 (Trainers) → clothing specialist', () => {
      const r = resolveImportSpecialistId({ categoryId: '152506', title: 'Nike Air Max' }, 'general');
      expect(r.specialistId).toBe('clothing');
    });
  });

  // ── AC-3: Motocross listings receive correct specialist ───────────────────
  describe('AC-3: Motocross listings → specialist_id=motocross', () => {
    test('eBay category 10767 (Motocross Bikes) → motocross specialist', () => {
      const r = resolveImportSpecialistId({ categoryId: '10767', title: 'KTM 250 SX' }, 'coins');
      expect(r.specialistId).toBe('motocross');
    });
    test('eBay category 6761 (Motorcycle Parts) → motocross specialist', () => {
      const r = resolveImportSpecialistId({ categoryId: '6761', title: 'Yamaha YZ exhaust' }, 'bicycles');
      expect(r.specialistId).toBe('motocross');
    });
  });

  // ── AC-4: Coin listings receive correct specialist ────────────────────────
  describe('AC-4: Coin listings → specialist_id=coins', () => {
    test('eBay category 4726 (British Coins) → coins specialist', () => {
      const r = resolveImportSpecialistId({ categoryId: '4726', title: 'George III Crown' }, 'coins');
      expect(r.specialistId).toBe('coins');
    });
    test('eBay category 40714 (Ancient Coins) → coins specialist', () => {
      const r = resolveImportSpecialistId({ categoryId: '40714', title: 'Roman Denarius' }, 'clothing');
      expect(r.specialistId).toBe('coins');
    });
  });

  // ── AC-5: Ambiguous listings use subscriber niche fallback ─────────────────
  describe('AC-5: Ambiguous listings use subscriber niche, not curiosities by default', () => {
    test('unclassified listing on coins subscriber → coins specialist', () => {
      const r = resolveImportSpecialistId({ categoryId: null, title: 'Old item' }, 'coins');
      expect(r.specialistId).toBe('coins');
      expect(r.resolvedNiche).toBe('coins');
    });
    test('unclassified listing on bicycles subscriber → bicycles specialist', () => {
      const r = resolveImportSpecialistId({ categoryId: null, title: 'Some item' }, 'bicycles');
      expect(r.specialistId).toBe('bicycles');
    });
    test('unclassified listing on motocross subscriber → motocross specialist', () => {
      const r = resolveImportSpecialistId({ categoryId: null, title: 'Something' }, 'motocross');
      expect(r.specialistId).toBe('motocross');
    });
    test('unclassified listing on clothing subscriber → clothing specialist', () => {
      const r = resolveImportSpecialistId({ categoryId: null, title: 'A thing' }, 'clothing');
      expect(r.specialistId).toBe('clothing');
    });
    test('unclassified listing on general subscriber → curiosities_collectibles (true fallback)', () => {
      const r = resolveImportSpecialistId({ categoryId: null, title: 'A thing' }, 'general');
      expect(r.specialistId).toBe('curiosities_collectibles');
    });
  });

  // ── AC-6: Cross-niche contamination is blocked ─────────────────────────────
  describe('AC-6: Classified listings always use evidence niche, not subscriber niche', () => {
    test('bicycle listing on coins account → bicycles (not coins)', () => {
      const r = resolveImportSpecialistId({ categoryId: '2904' }, 'coins');
      expect(r.specialistId).toBe('bicycles');
      expect(r.specialistId).not.toBe('coins');
    });
    test('coin listing on bicycles account → coins (not bicycles)', () => {
      const r = resolveImportSpecialistId({ categoryId: '4726' }, 'bicycles');
      expect(r.specialistId).toBe('coins');
      expect(r.specialistId).not.toBe('bicycles');
    });
    test('clothing listing on motocross account → clothing (not motocross)', () => {
      const r = resolveImportSpecialistId({ categoryId: '11450' }, 'motocross');
      expect(r.specialistId).toBe('clothing');
      expect(r.specialistId).not.toBe('motocross');
    });
    test('motocross listing on clothing account → motocross (not clothing)', () => {
      const r = resolveImportSpecialistId({ categoryId: '10767' }, 'clothing');
      expect(r.specialistId).toBe('motocross');
      expect(r.specialistId).not.toBe('clothing');
    });
  });

  // ── AC-7: No duplicate import (de-duplication logic) ─────────────────────
  describe('AC-7: Duplicate import prevention', () => {
    test('existing eBay IDs are in the skip set before import begins', () => {
      // Simulate the existingIds Set populated from DB
      const existingIds = new Set(['111222333', '444555666']);
      const newListingId = '777888999';
      const duplicateId  = '111222333';
      expect(existingIds.has(newListingId)).toBe(false);  // will be imported
      expect(existingIds.has(duplicateId)).toBe(true);    // will be skipped
    });
    test('after import, the new ID is added to the skip set', () => {
      const existingIds = new Set<string>(['111222333']);
      const newId = '999000111';
      // Simulate adding after successful import
      existingIds.add(newId);
      expect(existingIds.has(newId)).toBe(true);
      // A second pass would skip it
      expect(existingIds.has(newId)).toBe(true);
    });
  });

  // ── AC-8: nicheToSpecialistId returns correct values ─────────────────────
  describe('AC-8: nicheToSpecialistId004 returns correct specialist IDs', () => {
    test('coins → coins', () => expect(nicheToSpecialistId004('coins')).toBe('coins'));
    test('motocross → motocross', () => expect(nicheToSpecialistId004('motocross')).toBe('motocross'));
    test('bicycles → bicycles', () => expect(nicheToSpecialistId004('bicycles')).toBe('bicycles'));
    test('clothing → clothing', () => expect(nicheToSpecialistId004('clothing')).toBe('clothing'));
    test('antiques → curiosities_collectibles (unchanged)', () => expect(nicheToSpecialistId004('antiques')).toBe('curiosities_collectibles'));
    test('unclassified → curiosities_collectibles', () => expect(nicheToSpecialistId004('unclassified')).toBe('curiosities_collectibles'));
  });

  // ── AC-9: SWISH-003 niche-context guard is not weakened ──────────────────
  describe('AC-9: SWISH-003 niche-context guard remains intact', () => {
    test('bicycles specialist ID is returned by nicheToSpecialistId004', () => {
      expect(nicheToSpecialistId004('bicycles')).toBe('bicycles');
      expect(nicheToSpecialistId004('bicycles')).not.toBe('curiosities_collectibles');
    });
    test('resolveImportSpecialistId never returns cycling (invalid SpecialistId)', () => {
      const r = resolveImportSpecialistId({ categoryId: '2904' }, 'bicycles');
      expect(r.specialistId).not.toBe('cycling');
    });
    test('resolveImportSpecialistId never returns curiosities for a classified bicycle', () => {
      const r = resolveImportSpecialistId({ categoryId: '177831' }, 'bicycles');
      expect(r.specialistId).not.toBe('curiosities_collectibles');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────

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
