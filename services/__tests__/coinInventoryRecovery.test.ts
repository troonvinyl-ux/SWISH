// Mocked regressions, not evidence of authenticated device acceptance.
jest.mock('@/template',()=>({getSupabaseClient:jest.fn()}));
import {getSupabaseClient} from '@/template';
import {listItems,getItemStatusCounts,mapItem,type Item} from '@/services/itemService';
import {getAllListings} from '@/services/listingService';
import {buildAllInventoryRows,buildInventoryViews,loadInventoryView} from '@/services/inventoryViewService';
import {searchCoins} from '@/services/coinInventoryService';
import {getProductionNicheSpecialistIds} from '@/services/nicheRouting';
import fs from 'node:fs';import path from 'node:path';
const rawCoin=(index:number,status='listed')=>({id:`coin-${index}`,tenant_id:'existing-tenant',specialist_id:'coins',canonical_title:`Existing coin ${index}`,status,inventory_id:`KC-${index}`,ruler:'Victoria',denomination:'Crown',catalogue_number:'N#123',condition:'Fine',valuation_mid:'42.50',attributes:{numista_type_id:123},media:[`https://images.test/original-${index}.jpg`]});
function mockClient(pages:any[]){
 const client:any={rpc:jest.fn().mockReturnValue({abortSignal:jest.fn().mockResolvedValue({data:true,error:null})}),from:jest.fn()};
 const q:any={};for(const name of ['select','eq','in','order','or','ilike','range'])q[name]=jest.fn(()=>q);
 const pageQueue=[...pages];q.abortSignal=jest.fn().mockImplementation(()=>Promise.resolve(pageQueue.shift()??{data:[],error:null}));
 client.from.mockReturnValue(q);(getSupabaseClient as jest.Mock).mockReturnValue(client);return {client,q};
}
beforeEach(()=>jest.clearAllMocks());
describe('Existing coin reads preserve canonical scope and original data',()=>{
 test('loads beyond the former 500-item cap with stable pagination',async()=>{
  const rows=Array.from({length:541},(_,i)=>rawCoin(i));const {q}=mockClient([0,200,400].map(offset=>({data:rows.slice(offset,offset+200),error:null})));
  const result=await listItems('existing-tenant',{specialistIds:getProductionNicheSpecialistIds('coins')});
  expect(result.error).toBeNull();expect(result.items).toHaveLength(541);expect(q.eq).toHaveBeenCalledWith('tenant_id','existing-tenant');
  expect(q.in).toHaveBeenCalledWith('specialist_id',getProductionNicheSpecialistIds('coins'));expect(q.in).not.toHaveBeenCalledWith('status',expect.anything());
  expect(q.order).toHaveBeenCalledWith('id',{ascending:true});expect(q.range).toHaveBeenNthCalledWith(3,400,599);
  expect(result.items[540]).toMatchObject({id:'coin-540',inventoryId:'KC-540',ruler:'Victoria',denomination:'Crown',valuationMid:42.5,attributes:{numista_type_id:123},media:['https://images.test/original-540.jpg']});
 });
 test('a later page error cannot masquerade as a complete empty or partial inventory',async()=>{
  mockClient([{data:Array.from({length:200},(_,i)=>rawCoin(i)),error:null},{data:null,error:{message:'Connection pool timeout'}}]);
  const result=await listItems('existing-tenant',{specialistIds:['coins']});expect(result.items).toEqual([]);expect(result.error).toContain('Connection pool timeout');
 });
 test('counts aggregate every status and propagate DB failures',async()=>{
  const {client}=mockClient([]);client.rpc.mockReturnValue({abortSignal:jest.fn().mockResolvedValue({data:{listed:200,review_required:1},error:null})});
  expect(await getItemStatusCounts('existing-tenant',['coins'])).toEqual({listed:200,review_required:1});
  const denied=mockClient([]).client;denied.rpc.mockReturnValue({abortSignal:jest.fn().mockResolvedValue({data:null,error:{message:'RLS read failed'}})});
  await expect(getItemStatusCounts('existing-tenant',['coins'])).rejects.toThrow('RLS read failed');
 });
 test('canonicalises legacy coin aliases before asking the server for permission',async()=>{
  const {client}=mockClient([{data:[],error:null}]);client.rpc.mockReturnValue({abortSignal:jest.fn().mockResolvedValue({data:{total:0,units:0,stock:0,draft:0,live:0,sold:0,archived:0,live_listings:0},error:null})});expect((await loadInventoryView('existing-tenant','coins_world')).error).toBeNull();
  expect(client.rpc).toHaveBeenCalledWith('swish_inventory_tab_counts',{p_tenant_id:'existing-tenant',p_niche_id:'coins'});expect(client.rpc).toHaveBeenCalledTimes(1);
 });
 test('denied access never queries items or a different tenant',async()=>{
  const {client}=mockClient([]);client.rpc.mockReturnValue({abortSignal:jest.fn().mockResolvedValue({data:false,error:null})});
  expect((await loadInventoryView('wrong-tenant','coins')).error).not.toBeNull();expect(client.from).not.toHaveBeenCalled();
 });
 test('coin search includes only registered coin specialist identities',async()=>{
  const {q}=mockClient([{data:[rawCoin(1)],error:null}]);expect((await searchCoins('existing-tenant',{})).items).toHaveLength(1);
  expect(q.in).toHaveBeenCalledWith('specialist_id',getProductionNicheSpecialistIds('coins'));expect(getProductionNicheSpecialistIds('coins')).not.toEqual(expect.arrayContaining(['antiques','collectibles','curiosities_collectibles']));
 });
 test('listing pages preserve external IDs and item photos',async()=>{
  const row=(i:number)=>({id:`listing-${i}`,item_id:`coin-${i}`,tenant_id:'existing-tenant',external_listing_id:`ebay-${i}`,status:'active',price:'42.50',items:rawCoin(i)});
  const {q}=mockClient([{data:Array.from({length:200},(_,i)=>row(i)),error:null},{data:[row(200)],error:null}]);const result=await getAllListings('existing-tenant',undefined,['coins']);
  expect(result.listings).toHaveLength(201);expect(result.error).toBeNull();expect(result.listings[200]).toMatchObject({itemId:'coin-200',externalListingId:'ebay-200',itemMedia:['https://images.test/original-200.jpg']});
  expect(q.eq).toHaveBeenCalledWith('items.tenant_id','existing-tenant');expect(q.in).toHaveBeenCalledWith('items.specialist_id',['coins']);
 });
});
describe('All Coins is a lossless presentation, not an inventory migration',()=>{
 test('one card per original coin including held and sold despite multiple live listings',()=>{
  const items=[mapItem(rawCoin(1)),mapItem(rawCoin(2,'sold')),mapItem(rawCoin(3,'held'))];const listing={id:'listing-1',itemId:'coin-1',externalListingId:'ebay-1',status:'active',itemStatus:'listed',itemTitle:'Existing coin 1',itemSpecialistId:'coins',itemMedia:items[0].media} as any;
  const all=buildAllInventoryRows(items,buildInventoryViews(items,[listing,{...listing,id:'listing-2',externalListingId:'ebay-2'}]));
  expect(all).toHaveLength(3);expect(new Set(all.map(item=>item.id)).size).toBe(3);expect(all[0].media).toEqual(items[0].media);expect(all[1].status).toBe('sold');expect(all[2].status).toBe('held');expect(items[0].attributes).toEqual({numista_type_id:123});
 });
 test('original coin mapping retains grade, catalogue and evidence',()=>{
  const item:Item=mapItem({...rawCoin(1),condition_grade:'VF',weight_grams:'28.28',diameter_mm:'38.6',folder_number:'12',pocket_position:'4'});
  expect(item).toMatchObject({inventoryId:'KC-1',catalogueNumber:'N#123',conditionGrade:'VF',weightGrams:28.28,diameterMm:38.6,folderNumber:'12',pocketPosition:'4'});
 });
 test('shared inventory keeps account and all-record tools in More',()=>{
  const read=(file:string)=>fs.readFileSync(path.join(process.cwd(),file),'utf8');expect(read('app/(tabs)/inventory.tsx')).not.toContain('All Coins');expect(read('app/(tabs)/inventory.tsx')).not.toContain('InventoryAccountScope');
  expect(read('components/feature/InventoryTools.tsx')).toContain('All records');expect(read('components/feature/InventoryTools.tsx')).toContain('InventoryAccountScope');expect(read('components/feature/ModuleMore.tsx')).toContain('inventoryMoreLinks');
  expect(read('components/feature/InventoryAccountScope.tsx')).toContain('Switching niche does not switch the owner or tenant');expect(read('app/stock-listing/[id].tsx')).toContain('const readback = await getItem(item.id)');
  for(const file of ['hooks/useInventory.ts','hooks/useMasterInventory.ts']){const contents=read(file);expect(contents).toMatch(/promise:\s*Promise<void>/);expect(contents).not.toContain('clearInterval(timer); sub.remove(); request.current++');}
 });
});
