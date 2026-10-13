// SWISH-001 — Entry Route Mapping Tests
//
// These tests verify that each niche ID maps to the correct entry route,
// and that no niche is silently redirected to an unrelated application shell.
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

describe('SWISH-001: Entry route mapping', () => {

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
