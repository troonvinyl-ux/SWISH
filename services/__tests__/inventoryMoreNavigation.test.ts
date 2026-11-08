// Read-only source/config assertions. Does not invoke marketplace or AI operations.
jest.mock('@/services/listingService', () => ({ publishGeneratedListings: jest.fn(), submitListingsInBulk: jest.fn() }));
import fs from 'node:fs';
import { inventoryMoreLinks } from '@/services/inventoryToolsService';
import { PRODUCTION_NICHE_IDS } from '@/constants/niches';
import { isRouteAllowedForBuild, isRouteAllowedForModule } from '@/services/nicheRouting';
test.each(PRODUCTION_NICHE_IDS)('%s More tools have real packaged, niche-allowed destinations', niche => {
 const links = inventoryMoreLinks(niche);
 expect(new Set(links.map(link => link.route)).size).toBe(links.length);
 for (const link of links) {
  expect(fs.existsSync(`app${link.route}.tsx`)).toBe(true);
  expect(isRouteAllowedForModule(link.route, niche)).toBe(true);
  expect(isRouteAllowedForBuild(link.route, niche)).toBe(true);
 }
});
test('shared tool route keeps the existing provider and system back header', () => {
 const root = fs.readFileSync('app/_layout.tsx', 'utf8');
 expect(root).toContain('<AlertProvider>'); expect(root).toContain('<AppProvider>');
 expect(root).toContain('name="inventory-tools" options={{ headerShown: true');
 expect(fs.readFileSync('app/inventory-tools.tsx','utf8')).toContain('<InventoryTools />');
});
