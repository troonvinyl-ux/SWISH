import fs from 'node:fs';
import path from 'node:path';
import { PRODUCTION_NICHE_IDS, NICHE_MODULES } from '@/constants/niches';
import { getNicheDashboardContent, nicheDashboardItemRoute } from '@/services/nicheDashboardService';
import { isRouteAllowedForBuild, isRouteAllowedForModule } from '@/services/nicheRouting';

const root = path.resolve(__dirname, '../..');
const source = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');
const uploads = [
  ['tech', 'tech.jpeg'],
  ['bicycles', 'bicycles.jpeg'],
  ['motocross', 'motocross.jpeg'],
  ['beauty', 'beauty.jpeg'],
  ['trading_cards', 'trading-cards.jpeg'],
  ['antiques', 'antiques.jpeg'],
  ['surplus_flip', 'surplus.jpeg'],
  ['clothing', 'clothing.jpeg'],
  ['fossils', 'fossils.jpeg'],
  ['collectibles', 'collectibles.jpeg'],
  ['coins', 'coins.jpeg'],
];

describe('Shared Collectibles-style niche home and uploaded headers (source/pure tests)', () => {
  test.each(uploads)('%s uses the supplied local header without replacing its brand logo', (id, file) => {
    expect(fs.existsSync(path.join(root, 'assets/images/headers', file))).toBe(true);
    const header = source('constants/nicheHeaderArtwork.ts');
    expect(header).toContain(`case '${id}': return require('@/assets/images/headers/${file}')`);
    expect(source('constants/brandArtwork.ts')).not.toContain('images/headers');
  });

  test('keeps the approved 12:7 source dimensions and a defensive legacy artwork fallback', () => {
    const header = source('constants/nicheHeaderArtwork.ts');
    expect(header).toContain('width: 1920, height: 1120, aspectRatio: 12 / 7');
    expect(header).toContain('default: return getBrandArtwork(nicheId)');
  });

  test.each(PRODUCTION_NICHE_IDS)('%s has isolated copy and allowed core plus specialist actions', id => {
    const content = getNicheDashboardContent(id);
    expect(content.name).toBe(NICHE_MODULES[id].name);
    expect(content.headline.length).toBeGreaterThan(12);
    expect(content.categories.length).toBeGreaterThan(12);
    expect(content.guidance.length).toBeGreaterThan(30);
    for (const action of ['identify', 'inventory', 'listing', 'valuation', 'sync', 'specialist']) {
      expect(content.actions.find(item => item.id === action)).toBeDefined();
    }
    for (const action of content.actions) {
      if (action.route) expect(isRouteAllowedForModule(action.route, id)).toBe(true);
    }
    for (const action of getNicheDashboardContent(id, true).actions) {
      if (action.route) expect(isRouteAllowedForBuild(action.route, id)).toBe(true);
    }
    if (NICHE_MODULES[id].home) {
      expect(content.actions.some(action => action.route === '/' + NICHE_MODULES[id].home!.replace(/\.tsx$/, ''))).toBe(true);
    }
  });

  test('preserves card grading, antique care, MX calculator and manifest tools', () => {
    for (const [id, route] of [['trading_cards', '/card-grading'], ['antiques', '/antique-restoration'], ['motocross', '/mx-acquisition'], ['surplus_flip', '/surplus-flip']] as const) {
      expect(getNicheDashboardContent(id).actions.some(action => action.route === route)).toBe(true);
    }
  });

  test('requires selected-item routes and retains antique value and condition variations', () => {
    expect(nicheDashboardItemRoute('tech', 'listing', 'real-id')).toBe('/create-listing?id=real-id');
    expect(nicheDashboardItemRoute('antiques', 'valuation', 'real-id')).toBe('/antique-value?id=real-id');
    expect(nicheDashboardItemRoute('antiques', 'condition', 'real-id')).toBe('/antique-condition?id=real-id');
    expect(nicheDashboardItemRoute('beauty', 'valuation', 'real-id')).toBe('/stock-listing/real-id');
  });

  test('master shell, adapters and isolated APK packaging use the shared home', () => {
    expect(source('app/(tabs)/index.tsx')).toContain('<ModuleHome');
    expect(source('components/feature/ModuleHome.tsx')).toContain('<Dashboard nicheId={nicheId}');
    expect(source('components/feature/CollectiblesDashboard.tsx')).toContain('<SharedNicheDashboard nicheId="collectibles"');
    expect(source('components/feature/NicheOverview.tsx')).toContain('<SharedNicheDashboard');
    expect(source('scripts/prepare-niche-routes.js')).toContain('SharedNicheDashboard');
  });

  test('uses expo-image, scoped reads and no extra background polling', () => {
    const ui = source('components/feature/SharedNicheDashboard.tsx');
    expect(ui).toContain("from 'expo-image'");
    expect(ui).toContain('source={artwork}');
    expect(ui).not.toContain('uri: artwork');
    expect(ui).toContain('numbersUnavailable');
    const hook = source('hooks/useNicheDashboard.ts');
    expect(hook).toContain('useInventory()');
    expect(hook).toContain('active === nicheId && app.accessReady');
    expect(hook).not.toContain('setInterval');
    expect(hook).not.toContain('getSupabaseClient');
  });
});
