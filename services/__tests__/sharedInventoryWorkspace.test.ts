// Pure/source regressions; not device, live AI or marketplace acceptance.
jest.mock('@/services/listingService', () => ({ publishGeneratedListings: jest.fn(), submitListingsInBulk: jest.fn() }));
import fs from 'node:fs';
import { NICHES, PRODUCTION_NICHE_IDS } from '@/constants/niches';
import { inventoryMoreLinks, inventoryCardMetadata, publishInventoryBatch } from '@/services/inventoryToolsService';
import { isRouteAllowedForBuild, isRouteAllowedForModule } from '@/services/nicheRouting';
import { publishGeneratedListings, submitListingsInBulk } from '@/services/listingService';
import type { InventoryViewItem } from '@/services/inventoryViewService';
const source = (file: string) => fs.readFileSync(file, 'utf8');
const item = (patch: Partial<InventoryViewItem> = {}): InventoryViewItem => ({ id: 'coin', tenantId: 'tenant', specialist_id: 'coins', canonical_title: 'Victoria crown', attributes: {}, media: [], inventoryTab: 'stock', ...patch });
beforeEach(() => jest.clearAllMocks());
describe('one focused inventory for all registered niches', () => {
 test('main page is only the four shared lifecycle tabs, search, ordering and item actions', () => {
  const page = source('app/(tabs)/inventory.tsx');
  for (const value of ["id: 'stock'", "id: 'draft'", "id: 'live'", "id: 'sold'", 'useMasterInventory()', 'state.views[state.activeTab]', 'inventoryCardMetadata(item, config)', 'state.end(item)', 'removal.requestDelete', 'priceRevision.apply(item)']) expect(page).toContain(value);
  for (const value of ['All Coins', 'InventoryAccountScope', 'BulkReIdentifyModal', 'BulkReValueSheet', '/islamic-batch', '/lot-opportunity', 'setInterval(']) expect(page).not.toContain(value);
  expect(page).toContain('initialNumToRender={8}'); expect(page).toContain('if (!effectiveSearch.trim()) return true');
 });
 test.each(PRODUCTION_NICHE_IDS)('%s keeps shared tools available without cross-niche routes', niche => {
  expect(isRouteAllowedForModule('/inventory-tools', niche)).toBe(true);
  expect(isRouteAllowedForBuild('/inventory-tools', niche)).toBe(true);
  expect(inventoryMoreLinks(niche)[0].route).toBe('/inventory-tools');
  if (niche !== 'coins') expect(inventoryMoreLinks(niche).some(link => link.route === '/islamic-batch')).toBe(false);
 });
 test('More contains coin-only utilities and account details, without fetching inventory', () => {
  expect(inventoryMoreLinks('coins').map(link => link.route)).toEqual(expect.arrayContaining(['/inventory-tools','/islamic-batch','/silver-batch','/deep-id-lab','/lot-opportunity']));
  const more = source('components/feature/ModuleMore.tsx'); expect(more).toContain('inventoryMoreLinks'); expect(more).toContain('InventoryAccountScope'); expect(more).toContain('allowed(link.route)'); expect(more).not.toContain('useMasterInventory');
 });
 test('all original records including archives remain accessible in tools', () => {
  expect(source('hooks/useInventoryTools.ts')).toContain("mode === 'all' ? inventory.allItems");
  expect(source('components/feature/InventoryTools.tsx')).toContain('All records');
  expect(source('components/feature/InventoryTools.tsx')).toContain('BulkReIdentifyModal');
  expect(source('components/feature/InventoryTools.tsx')).toContain('BulkReValueSheet');
 });
 test('coin top-level reference fields and collectibles attributes are adapted without mutation', () => {
  const coin = item({ denomination: 'Crown', ruler: 'Victoria', yearMade: '1890', conditionGrade: 'VF', attributes: { denomination: '' } });
  expect(inventoryCardMetadata(coin, NICHES.coins)).toBe('Crown · Victoria · 1890');
  expect(coin.attributes.denomination).toBe('');
  expect(inventoryCardMetadata(item({ attributes: { brand: 'Wedgwood', object_type: 'pottery' } }), NICHES.collectibles)).toBe('Wedgwood · pottery');
 });
 test('registries remain semantically aligned for packaging and server routes', () => {
  expect(JSON.parse(source('niche-modules.json'))).toEqual(JSON.parse(source('supabase/functions/_shared/niche-modules.json')));
 });
});
describe('advanced publishing preserves the existing guarded seller workflow', () => {
 test('rejects cross-tenant, cross-niche and duplicated items before any seller calls', async () => {
  for (const rows of [[item({tenantId:'other'})], [item({specialist_id:'collectibles'})], [item(),item()]]) await expect(publishInventoryBatch('tenant','coins','stock',rows,()=>true)).rejects.toThrow('scope');
  expect(publishGeneratedListings).not.toHaveBeenCalled(); expect(submitListingsInBulk).not.toHaveBeenCalled();
 });
 test('stops starting seller actions after a module change', async () => {
  let current = true;
  (publishGeneratedListings as jest.Mock).mockImplementation(async () => { current = false; return [{ success: true }]; });
  expect(await publishInventoryBatch('tenant','coins','stock',[item(),item({id:'second'})],()=>current)).toEqual({live:1,total:1});
  expect(publishGeneratedListings).toHaveBeenCalledTimes(1);
 });
 test('publishes drafts via the shared existing submission service', async () => {
  (submitListingsInBulk as jest.Mock).mockResolvedValue([{result:{success:true}}]);
  const draft = item({inventoryTab:'draft',listing:{id:'draft',tenantId:'tenant'} as any});
  expect(await publishInventoryBatch('tenant','coins','draft',[draft],()=>true)).toEqual({live:1,total:1});
  expect(submitListingsInBulk).toHaveBeenCalledWith('tenant',['draft']); expect(publishGeneratedListings).not.toHaveBeenCalled();
 });
 test('retains failed results without automatic retries', async () => {
  (publishGeneratedListings as jest.Mock).mockResolvedValue([{success:false,error:'Uncertain marketplace result'}]);
  expect(await publishInventoryBatch('tenant','coins','stock',[item()],()=>true)).toEqual({live:0,total:1});
  expect(publishGeneratedListings).toHaveBeenCalledTimes(1);
 });
});
