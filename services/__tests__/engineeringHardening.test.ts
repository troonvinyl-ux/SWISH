import fs from 'node:fs';
import path from 'node:path';
import { NICHE_MODULES, PRODUCTION_NICHE_IDS, NICHES } from '@/constants/niches';
import { resolveProductionNiche, getProductionNicheSpecialistIds, isRouteAllowedForBuild } from '@/services/nicheRouting';
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
describe('Build uses a physical route-tree boundary', () => {
  const { prepareNicheRoutes } = require('../../scripts/prepare-niche-routes');
  test.each(['clothing','coins','motocross','bicycles','surplus_flip'])('%s contains exactly its intended dedicated routes', niche => {
    const temporary = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'swish-routes-'));
    try {
      fs.cpSync(path.join(root, 'app'), path.join(temporary, 'app'), { recursive: true });
      const output = prepareNicheRoutes(niche, temporary);
      const home = fs.readFileSync(path.join(temporary, output, '(tabs)/index.tsx'), 'utf8');
      expect(home).toContain('@/app/' + NICHE_MODULES[niche as keyof typeof NICHE_MODULES].home!.replace('.tsx', ''));
      for (const [id, product] of Object.entries(NICHE_MODULES)) {
        if (id === niche) continue;
        expect(fs.existsSync(path.join(temporary, output, product.entry))).toBe(false);
        if (product.home) expect(home).not.toContain('@/app/' + product.home.replace('.tsx', ''));
      }
      expect(fs.existsSync(path.join(temporary, output, 'niche-select.tsx'))).toBe(false);
      expect(fs.existsSync(path.join(temporary, output, 'master-admin.tsx'))).toBe(false);
    } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
  });
});
