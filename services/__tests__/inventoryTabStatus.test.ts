jest.mock('@/template',()=>({getSupabaseClient:jest.fn()}));
import {getSupabaseClient} from '@/template';
import {loadInventoryTab,loadInventoryCounts,buildInventoryViews} from '@/services/inventoryViewService';
import {getProductionNicheSpecialistIds} from '@/services/nicheRouting';
import {PRODUCTION_NICHE_IDS} from '@/constants/niches';
import {isLiveListing,isDraftListing} from '@/services/listingLifecycle';
import {parseEbayListingStatus} from '../../supabase/functions/_shared/listingStatus';
const tabs=['stock','draft','live','sold'] as const;
const xml=(state:string,quantity=1,sold=1,id='800434360561')=>`<GetItemResponse><Ack>Success</Ack><Item><ItemID>${id}</ItemID><Quantity>${quantity}</Quantity><SellingStatus><ListingStatus>${state}</ListingStatus><QuantitySold>${sold}</QuantitySold></SellingStatus><ListingDetails><EndTime>2026-10-05T18:27:00.000Z</EndTime></ListingDetails></Item></GetItemResponse>`;
describe('Actual eBay status evidence',()=>{
 test('reported sold coin is sold even with a stale Active label',()=>{expect(parseEbayListingStatus(xml('Active'), '800434360561').status).toBe('sold');});
 test('completed sold item is not Live',()=>{expect(parseEbayListingStatus(xml('Completed'),'800434360561').status).toBe('sold');});
 test('unsold ended listing is stock, not sold',()=>{expect(parseEbayListingStatus(xml('Completed',1,0),'800434360561').status).toBe('ended');});
 test('partial sale leaves real available multi-quantity stock Live',()=>{expect(parseEbayListingStatus(xml('Active',5,2),'800434360561').status).toBe('active');});
 test('a different external ID is rejected',()=>{expect(()=>parseEbayListingStatus(xml('Completed'), '999')).toThrow('different listing identity');});
 test('failed/missing responses never default to live',()=>{expect(()=>parseEbayListingStatus('<Ack>Failure</Ack>','1')).toThrow();expect(()=>parseEbayListingStatus(xml('Unknown'),'800434360561')).toThrow();expect(()=>parseEbayListingStatus(xml('Active').replace('<QuantitySold>1</QuantitySold>',''),'800434360561')).toThrow();});
});
describe('Shared cache status guards',()=>{
 test('sold date, listing status and ledger evidence beat old active labels',()=>{
  const active={status:'active',itemStatus:'listed',externalListingId:'123'};
  expect(isLiveListing({...active,itemSoldAt:'2026-10-05'})).toBe(false);
  expect(isLiveListing({...active,hasSaleEvidence:true,itemQuantity:1})).toBe(false);
  expect(isLiveListing({...active,hasSaleEvidence:true,itemQuantity:5})).toBe(true);
  expect(isDraftListing({status:'draft',externalListingId:'123'})).toBe(false);
 });
 test('listing sold evidence cannot leave the item in Stock/Live/Draft',()=>{
  const item={id:'coin',status:'listed',canonicalTitle:'Ephesos',specialistId:'coins',media:[],attributes:{}} as any;
  const listing={id:'listing',itemId:'coin',status:'sold',itemStatus:'listed',externalListingId:'123',itemTitle:'Ephesos',itemSpecialistId:'coins',itemMedia:[]} as any;
  const result=buildInventoryViews([item],[listing]);
  expect(result.stock).toHaveLength(0);expect(result.draft).toHaveLength(0);expect(result.live).toHaveLength(0);expect(result.sold).toHaveLength(1);
 });
});
describe('Every niche queries only its own tab at the server',()=>{
 const client:any={from:jest.fn(),select:jest.fn(),eq:jest.fn(),in:jest.fn(),order:jest.fn(),range:jest.fn()};
 beforeEach(()=>{
  jest.clearAllMocks();(getSupabaseClient as jest.Mock).mockReturnValue(client);
  for(const name of ['from','select','eq','in','order'])client[name].mockReturnValue(client);
  client.range.mockResolvedValue({data:[],error:null});
 });
 test.each(PRODUCTION_NICHE_IDS)('%s applies the same isolation to all four tabs',async niche=>{
  const allowed=getProductionNicheSpecialistIds(niche);
  for(const tab of tabs){jest.clearAllMocks();await loadInventoryTab('tenant-1',niche,tab);
   expect(client.from).toHaveBeenCalledWith('swish_inventory_tab_rows');expect(client.eq).toHaveBeenCalledWith('tenant_id','tenant-1');expect(client.eq).toHaveBeenCalledWith('inventory_tab',tab);expect(client.in).toHaveBeenCalledWith('specialist_id',allowed);
  }
 });
 test('unknown niche and missing account fail closed without a query',async()=>{await loadInventoryTab('tenant','unknown','live');await loadInventoryTab('','coins','live');expect(client.from).not.toHaveBeenCalled();});
 test('tab filtering happens before pagination and loads beyond one page',async()=>{
  const row={item:{id:'coin',tenant_id:'tenant',canonical_title:'Coin',specialist_id:'coins',status:'listed',attributes:{},media:[]},listing:null};
  client.range.mockResolvedValueOnce({data:Array(200).fill(row),error:null}).mockResolvedValueOnce({data:[row],error:null});
  const result=await loadInventoryTab('tenant','coins','live');expect(result.rows).toHaveLength(201);expect(client.range).toHaveBeenNthCalledWith(2,200,399);
 });
 test('counts request only aggregate headers with the same niche/status constraints',async()=>{
  client.order.mockReturnValue(client);client.eq.mockImplementation(()=>client);client.then=(resolve:any)=>Promise.resolve({count:3,error:null}).then(resolve);
  const result=await loadInventoryCounts('tenant','clothing');expect(result.counts).toEqual({stock:3,draft:3,live:3,sold:3});expect(client.select).toHaveBeenCalledWith('item_id',{count:'exact',head:true});delete client.then;
 });
});
