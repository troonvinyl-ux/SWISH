// Pure/mocked regressions. Not a native device or live seller certification.
jest.mock('@/template',()=>({getSupabaseClient:jest.fn()}));
jest.mock('expo-crypto',()=>({CryptoDigestAlgorithm:{SHA256:'sha256'},digestStringAsync:(_algorithm:string,text:string)=>Promise.resolve(require('node:crypto').createHash('sha256').update(text).digest('hex'))}));
import fs from 'node:fs';
import {getSupabaseClient} from '@/template';
import {buildInventoryViews,buildAllInventoryRows} from '../inventoryViewService';
import {parseCanonicalCounts,readCanonicalInventoryCounts,canonicalExternalKey} from '../canonicalInventoryService';
import {captureCanonicalId} from '../captureIdentityService';
import {createScannerSession} from '../scannerSessionService';
import {importCanonicalEbayInventory} from '../ebayInventoryImportService';
import {PRODUCTION_NICHE_IDS,NICHE_MODULES} from '@/constants/niches';
import {parseEbayListingStatus} from '../../supabase/functions/_shared/listingStatus';
const item=(id:string,tenantId='a',specialistId='coins',quantity=1)=>({id,tenantId,canonicalTitle:`Item ${id}`,specialistId,status:'identified',quantity,media:[],attributes:{}} as any);
const listing=(id:string,itemId:string,status='draft',externalListingId?:string,tenantId='a')=>({id,itemId,tenantId,marketplaceId:'ebay',status,externalListingId,itemStatus:'identified',updatedAt:'2026-11-07',itemTitle:`Item ${itemId}`,itemSpecialistId:'coins',itemMedia:[]} as any);
const seven=()=>Array.from({length:7},(_,index)=>item(String(index+1)));
const counts={total:7,units:7,stock:3,draft:1,live:3,sold:0,archived:0,live_listings:3};
beforeEach(()=>jest.clearAllMocks());
test('stock -> draft -> live -> sold keeps seven canonical item identities',()=>{
 const items=seven();const base=['5','6','7'].map(id=>listing(`live-${id}`,id,'active',`1234567${id}`));
 for(const state of ['stock','draft','live','sold']){
  const links=[...base];if(state==='draft')links.push(listing('d','4'));
  if(state==='live')links.push(listing('d','4','active','12345674'));
  if(state==='sold')links.push(listing('d','4','sold','12345674'));
  const views=buildInventoryViews(items,links);
  expect(buildAllInventoryRows(items,views)).toHaveLength(7);
  expect(new Set(Object.values(views).flat().map(row=>row.id)).size).toBe(7);
  expect(views.sold.length).toBe(state==='sold'?1:0);
 }
 const example=buildInventoryViews(items,[...base,listing('draft','4')]);
 expect([example.stock.length,example.draft.length,example.live.length,example.sold.length]).toEqual([3,1,3,0]);
});
test('two live marketplaces/listings and several drafts never duplicate a physical inventory card',()=>{
 const physical=[item('1')];const links=[listing('a','1','active','12345671'),listing('b','1','active','12345672'),listing('c','1'),listing('d','1')];
 const views=buildInventoryViews(physical,links);expect(views.live).toHaveLength(1);expect(views.draft).toHaveLength(0);expect(buildAllInventoryRows(physical,views)).toHaveLength(1);
});
test('duplicate external aliases use the latest observation, not a stale live status',()=>{
 const old=listing('a','1','active','12345671');old.updatedAt='2026-11-01';
 const latest={...old,id:'b',marketplaceId:'EBAY_GB',status:'ended',endedAt:'2026-11-07',updatedAt:'2026-11-07'};
 const views=buildInventoryViews([item('1')],[old,latest]);expect(views.live).toHaveLength(0);expect(views.stock).toHaveLength(1);
 expect(canonicalExternalKey('a','EBAY_GB',' 12345671 ')).toBe(canonicalExternalKey('a','ebay','12345671'));
 expect(canonicalExternalKey('b','ebay','12345671')).not.toBe(canonicalExternalKey('a','ebay','12345671'));
});
test.each(PRODUCTION_NICHE_IDS)('%s uses the same canonical lifecycle without tenant crossover',niche=>{
 const physical=[item('1','a',NICHE_MODULES[niche].defaultSpecialist)];
 const wrong=listing('b','1','active','12345671','b');
 expect(buildInventoryViews(physical,[wrong]).stock).toHaveLength(1);
 expect(buildInventoryViews(physical,[listing('a','1')]).draft).toHaveLength(1);
});
test('quantity is a separate unit metric; partial sale does not consume the whole record',()=>{
 const physical=[item('1','a','coins',5)];const live=listing('a','1','active','12345671');live.itemQuantity=5;live.hasSaleEvidence=true;
 expect(buildInventoryViews(physical,[live]).live).toHaveLength(1);
 const parsed=parseCanonicalCounts({total:1,units:5,stock:0,draft:0,live:1,sold:0,archived:0,live_listings:1});expect(parsed.total).toBe(1);expect(parsed.units).toBe(5);
 const xml='<GetItemResponse><Ack>Success</Ack><Item><ItemID>12345671</ItemID><Quantity>5</Quantity><SellingStatus><ListingStatus>Completed</ListingStatus><QuantitySold>2</QuantitySold></SellingStatus></Item></GetItemResponse>';
 expect(parseEbayListingStatus(xml,'12345671').status).toBe('ended');
});
test('explicit total comes from canonical records, not adding live listing counts or order counts',()=>{
 expect(parseCanonicalCounts({...counts,live_listings:5})).toMatchObject({total:7,live:3,liveListings:5});
 expect(()=>parseCanonicalCounts({...counts,total:9})).toThrow('classification');
 expect(()=>parseCanonicalCounts({...counts,total:undefined})).toThrow();
});
test('app and web use one tenant/niche RPC and fail closed on an unreadable aggregate',async()=>{
 const abortSignal=jest.fn().mockResolvedValue({data:counts,error:null});const rpc=jest.fn().mockReturnValue({abortSignal});
 (getSupabaseClient as jest.Mock).mockReturnValue({rpc});
 const native=await readCanonicalInventoryCounts('a','coins');const web=await readCanonicalInventoryCounts('a','coins');expect(native).toEqual(web);
 expect(rpc).toHaveBeenCalledWith('swish_inventory_tab_counts',{p_tenant_id:'a',p_niche_id:'coins'});
 abortSignal.mockResolvedValueOnce({data:null,error:{message:'Denied'}});await expect(readCanonicalInventoryCounts('b','coins')).rejects.toThrow('Denied');
});
test('repeat barcode events/save retries reuse the visit; another physical copy starts a new identity',async()=>{
 const clock=createScannerSession();const visit=clock.begin('a:coins');
 expect(await captureCanonicalId('a','coins',visit)).toBe(await captureCanonicalId('a','coins',visit));
 expect(await captureCanonicalId('a','coins',visit)).not.toBe(await captureCanonicalId('a','coins',clock.begin('a:coins')));
 expect(createScannerSession().begin('a:coins')).not.toBe(createScannerSession().begin('a:coins'));
 expect(await captureCanonicalId('a','coins',visit)).not.toBe(await captureCanonicalId('b','coins',visit));
});
test('re-import and duplicate sync return the existing canonical item/listing from the transactional importer',async()=>{
 const existing={itemId:'one',listingId:'listing',inventoryId:'KC-1',existing:true};const rpc=jest.fn().mockResolvedValue({data:existing,error:null});
 (getSupabaseClient as jest.Mock).mockReturnValue({rpc});
 const first=await importCanonicalEbayInventory('a','coins','12345671',{specialist_id:'coins'},{});
 const second=await importCanonicalEbayInventory('a','coins','12345671',{specialist_id:'coins'},{});expect(first.itemId).toBe(second.itemId);
 expect(rpc).toHaveBeenCalledWith('swish_import_ebay_inventory',expect.objectContaining({p_tenant_id:'a',p_niche_id:'coins',p_external_id:'12345671'}));
 rpc.mockResolvedValueOnce({data:null,error:{message:'Ambiguous historical identity'}});await expect(importCanonicalEbayInventory('a','coins','12345671',{},{})).rejects.toThrow('Ambiguous');
});
test('database contracts retain canonical tables, paid scope and safe identity locking',()=>{
 const migration=fs.readFileSync('supabase/migrations/20261111_canonical_inventory_identity.sql','utf8');
 const intake=fs.readFileSync('supabase/migrations/20261111_atomic_ebay_inventory_import.sql','utf8');
 for(const token of ['security_invoker=true','swish_can_access_niche','pg_advisory_xact_lock','count(distinct id)','stock_total'])expect(migration).toContain(token);
 for(const token of ['swish_current_module','Current tenant and paid module required','cardinality(v_ids)>1','p_existing_item_id','insert into public.items','insert into public.listings'])expect(intake).toContain(token);
 expect(intake).not.toMatch(/delete from|create table|drop table/i);
 const ui=fs.readFileSync('components/feature/CommandPortfolio.tsx','utf8');for(const label of ['Unique physical items','In stock','Draft items','Live on eBay','Sold items','Outstanding orders','Realised sales'])expect(ui).toContain(label);
});
