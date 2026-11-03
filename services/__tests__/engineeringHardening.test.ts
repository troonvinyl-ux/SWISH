import fs from 'node:fs';
import path from 'node:path';
import { NICHE_MODULES, PRODUCTION_NICHE_IDS, NICHES } from '@/constants/niches';
import { resolveProductionNiche, resolveNicheFromNativeAppId, getProductionNicheSpecialistIds, isRouteAllowedForBuild } from '@/services/nicheRouting';
import { isLiveListing, isDraftListing } from '@/services/listingLifecycle';
import { classifyListing, isListingEligibleForNiche } from '@/services/nicheCategoryService';
const root = path.resolve(__dirname, '../..');

describe('Production identity and route boundaries', () => {
  test('unknown coin-like identifiers never select Coins', () => {
    expect(resolveProductionNiche('not-a-coin-product')).toBeNull();
    expect(resolveProductionNiche('curiosities_collectibles')).toBeNull();
    expect(resolveProductionNiche('Not established')).toBeNull();
  });
  test.each(PRODUCTION_NICHE_IDS)('%s matches the shared registry', niche => {
    expect(NICHE_MODULES[niche].id).toBe(niche);
    expect(NICHES[niche].defaultSpecialist).toBe(NICHE_MODULES[niche].defaultSpecialist);
    expect(NICHES[niche].specialists).toEqual(NICHE_MODULES[niche].specialists);
  });
  test.each(PRODUCTION_NICHE_IDS)('%s is resolved from its native package identity', niche => {
    expect(resolveNicheFromNativeAppId(NICHE_MODULES[niche].androidPackage)).toBe(niche);
    expect(resolveNicheFromNativeAppId(NICHE_MODULES[niche].iosBundleIdentifier)).toBe(niche);
  });
  test('unknown native package IDs never select a niche', () => {
    expect(resolveNicheFromNativeAppId('com.swish.inventory')).toBeNull();
    expect(resolveNicheFromNativeAppId('com.swish.not-a-product')).toBeNull();
  });
  test('Threads preserves only verified historical aliases', () => {
    expect(getProductionNicheSpecialistIds('threads')).toContain('clothing_specialist');
    expect(getProductionNicheSpecialistIds('threads')).not.toContain('coins');
  });
  test('branded direct navigation rejects other niches and master switching', () => {
    expect(isRouteAllowedForBuild('/coin-flipper', 'clothing')).toBe(false);
    expect(isRouteAllowedForBuild('/entry/coins', 'clothing')).toBe(false);
    expect(isRouteAllowedForBuild('/niche-select', 'clothing')).toBe(false);
    expect(isRouteAllowedForBuild('/master-admin', 'clothing')).toBe(false);
    expect(isRouteAllowedForBuild('/threads-flip', 'clothing')).toBe(true);
    expect(isRouteAllowedForBuild('/ebay-listing-editor', 'clothing')).toBe(true);
  });
});
describe('Marketplace state is authoritative', () => {
  test('sold inventory cannot be a live listing', () => {
    expect(isLiveListing({ status: 'active', itemStatus: 'sold', externalListingId: '123' })).toBe(false);
    expect(isLiveListing({ status: 'active', itemStatus: 'fulfilled', externalListingId: '123' })).toBe(false);
  });
  test('a status label without an external ID is not proof of publication', () => {
    expect(isLiveListing({ status: 'active' })).toBe(false);
    expect(isLiveListing({ status: ' ACTIVE ', itemStatus: 'listed', externalListingId: '123' })).toBe(true);
    expect(isLiveListing({ status: 'active', endedAt: '2026-10-30', externalListingId: '123' })).toBe(false);
    expect(isDraftListing({ status: 'pending', itemStatus: 'sold' })).toBe(false);
  });
  test('ambiguous and contradictory imports require review', () => {
    const contradictory = classifyListing('177831', 'Bicycles', 'Silver Roman coin');
    expect(contradictory.niche).toBe('unclassified');
    expect(isListingEligibleForNiche(contradictory, 'clothing')).toBe(false);
    expect(isListingEligibleForNiche(classifyListing(null, null, 'Unknown object'), null)).toBe(false);
  });
});
describe('Build uses a strict per-niche route and module boundary', () => {
  const { prepareNicheRoutes } = require('../../scripts/prepare-niche-routes');
  const registry = require('../../niche-modules.json');
  const routeFiles = (directory: string, base = directory): string[] => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? routeFiles(full, base) : [path.relative(base, full).split(path.sep).join('/')];
  });

  test.each(PRODUCTION_NICHE_IDS)('%s contains only shared routes and its own niche routes', niche => {
    const temporary = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'swish-routes-'));
    try {
      fs.cpSync(path.join(root, 'app'), path.join(temporary, 'app'), { recursive: true });
      const output = prepareNicheRoutes(niche, temporary);
      const product = registry.products[niche];
      const home = fs.readFileSync(path.join(temporary, output, '(tabs)/index.tsx'), 'utf8');
      if (product.home) {
        expect(home).toContain('@/app/' + product.home.replace('.tsx', ''));
      } else {
        expect(home).toContain('NicheOverview as ProductHome');
      }
      const expected = [...new Set([...registry.sharedRoutes, product.entry, product.home, ...product.dedicatedRoutes].filter(Boolean))].sort();
      expect(routeFiles(path.join(temporary, output)).filter(file => file.endsWith('.tsx')).sort()).toEqual(expected);
      for (const adminRoute of registry.adminOnlyRoutes) {
        expect(fs.existsSync(path.join(temporary, output, adminRoute))).toBe(false);
      }
      const tabsLayout = fs.readFileSync(path.join(temporary, output, '(tabs)/_layout.tsx'), 'utf8');
      if (niche !== 'antiques') expect(tabsLayout).not.toContain('name="antique-more"');
    } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
  });

  test('rejects an unclassified route instead of silently bundling it into every APK', () => {
    const temporary = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'swish-routes-'));
    try {
      fs.cpSync(path.join(root, 'app'), path.join(temporary, 'app'), { recursive: true });
      fs.writeFileSync(path.join(temporary, 'app', 'unclassified-product-screen.tsx'), 'export default function Screen() { return null; }');
      expect(() => prepareNicheRoutes('clothing', temporary)).toThrow(/Unclassified app route/);
    } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
  });

  test('native package identity is the fixed build niche before account preferences load', () => {
    const appContext = fs.readFileSync(path.join(root, 'contexts/AppContext.tsx'), 'utf8');
    expect(appContext).toContain('resolveNicheFromNativeAppId(NATIVE_BUILD_APP_ID)');
    expect(appContext).toContain('Native package identity is immutable');
  });
});
