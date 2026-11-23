jest.mock('@/template',()=>({getSupabaseClient:jest.fn()}));
import {getSupabaseClient} from '@/template';
import {runNicheEbayOperation} from '../ebaySyncService';
import {importCanonicalEbayInventory} from '../ebayInventoryImportService';
import {isIsolatedGetItemTimeout} from '../../supabase/functions/_shared/ebaySyncPolicy';
import fs from 'node:fs';
const cursor='00000000-0000-4000-8000-000000000108';
const readIssue={externalListingId:'987654321012',code:'EBAY_ITEM_READ_TIMEOUT',message:'eBay read was unconfirmed; stock was retained.'};
const complete=(patch:any={})=>({data:{success:true,batchComplete:true,processed:6,updated:6,failed:0,blocked:0,readSkipped:0,issues:[],nextAfterListingId:null,...patch},error:null});
const setup=(responses:any[])=>{
 const invoke=jest.fn();
 for(const response of responses)invoke.mockResolvedValueOnce(response);
 (getSupabaseClient as jest.Mock).mockReturnValue({functions:{invoke}});
 return invoke;
};
beforeEach(()=>jest.clearAllMocks());
test('an isolated timed-out eBay item does not prevent later confirmed listings from completing',async()=>{
 const invoke=setup([
  complete({success:false,partial:true,processed:6,updated:5,failed:1,readSkipped:1,issues:[readIssue],nextAfterListingId:cursor,error:'One listing read timed out'}),
  complete({processed:4,updated:4}),
 ]);
 const progress:any[]=[];
 const res=await runNicheEbayOperation('tenant','coins','sync',{onProgress:data=>progress.push(data)});
 expect(invoke).toHaveBeenCalledTimes(2);
 expect(invoke.mock.calls[1][1].body.afterListingId).toBe(cursor);
 expect(invoke.mock.calls[1][1].body.previousIssues).toBe(true);
 expect(res.data.processed).toBe(10);
 expect(res.data.updated).toBe(9);
 expect(res.data.failed).toBe(1);
 expect(res.data.success).toBe(false);
 expect(res.error).toContain('need attention');
 expect(res.data.issues).toEqual([readIssue]);
 expect(progress.map(row=>row.processed)).toEqual([6,10]);
});
test('a mixed policy removal and bounded GetItem timeout are accurately counted with no writes to skipped items',async()=>{
 const policyIssue={externalListingId:'987654321013',code:'21920397',message:'Policy removed'};
 const invoke=setup([
  complete({success:false,partial:true,updated:4,failed:2,blocked:1,readSkipped:1,issues:[readIssue,policyIssue],nextAfterListingId:cursor,error:'2 unknown statuses'}),
  complete({processed:1,updated:1}),
 ]);
 const res=await runNicheEbayOperation('tenant','coins','sync');
 expect(invoke).toHaveBeenCalledTimes(2);
 expect(res.data.updated).toBe(5);
 expect(res.data.failed).toBe(2);
 expect(res.data.blocked).toBe(1);
 expect(res.data.success).toBe(false);
});
test('unknown status write errors and unaccounted response failures still stop with no retry',async()=>{
 for(const payload of [
  complete({success:false,batchComplete:false,updated:5,failed:1,issues:[readIssue],nextAfterListingId:cursor,error:'Unknown status write'}),
  complete({success:false,batchComplete:true,updated:5,failed:1,readSkipped:1,issues:[],nextAfterListingId:cursor,error:'Unverified result'}),
 ]){
  const invoke=setup([payload]);
  const res=await runNicheEbayOperation('tenant','coins','sync');
  expect(res.error).not.toBeNull();
  expect(invoke).toHaveBeenCalledTimes(1);
 }
});
test('classified TimeoutError is different from global eBay, auth, database and unknown failures',()=>{
 const isolated=new Error('Read deadline');isolated.name='TimeoutError';
 expect(isIsolatedGetItemTimeout(isolated)).toBe(true);
 expect(isIsolatedGetItemTimeout(new Error('eBay Trading HTTP 429'))).toBe(false);
 expect(isIsolatedGetItemTimeout({name:'TimeoutError'})).toBe(false);
});
test('Edge sync and eBay import preserve exact scope and expose incomplete-paging evidence',()=>{
 const sync=fs.readFileSync('supabase/functions/swish-ebay-sync/index.ts','utf8');
 const client=fs.readFileSync('services/ebaySyncService.ts','utf8');
 const browse=fs.readFileSync('supabase/functions/swish-ebay-browse/index.ts','utf8');
 const importUi=fs.readFileSync('app/ebay-import.tsx','utf8');
 expect(sync).toContain("code:'EBAY_ITEM_READ_TIMEOUT'");
 expect(sync).toContain("cause instanceof Error&&cause.name==='TimeoutError'");
 expect(sync).toContain('if(!observations.has(String(listing.external_listing_id)))continue');
 expect(sync).toContain('swish_apply_ebay_listing_status');
 expect(sync).toContain('batchComplete:failed.length===0');
 expect(client).toContain("issue?.code === 'EBAY_ITEM_READ_TIMEOUT'");
 expect(client).toContain('if (response.error && !accountedNoWrite)');
 expect(browse).toContain("ack !== 'Success' && ack !== 'Warning'");
 expect(browse).toContain('if (activeReported != null && activeFetched < activeReported && activeFetched < fetchLimit)');
 expect(browse).toContain("return json({ error: 'eBay active listing pages were not fully confirmed.");
 expect(importUi).toContain('eBay active');
 expect(importUi).toContain('already linked');
 expect(importUi).toContain("error.startsWith('SWISH_IMPORT_UNCONFIRMED:')");
 expect(importUi).toContain('setImportProgress({ current: attempted, total: selected.length })');
 expect(importUi).toContain('finally {');
 const atomic=fs.readFileSync('services/ebayInventoryImportService.ts','utf8');
 expect(atomic).toContain('Promise.race([request,timeout])');
 expect(atomic).toContain('controller.abort()');
});

test('native import stops after bounded 30s instead of hanging forever at 108/118 or replaying an uncertain write',async()=>{
 jest.useFakeTimers();
 try{
  const abortSignal=jest.fn().mockReturnValue(new Promise(()=>{}));
  const rpc=jest.fn().mockReturnValue({abortSignal});
  (getSupabaseClient as jest.Mock).mockReturnValue({rpc});
  const operation=importCanonicalEbayInventory('tenant','coins','123456789012',{},{}); 
  jest.advanceTimersByTime(30000);
  await expect(operation).rejects.toThrow('SWISH_IMPORT_UNCONFIRMED');
  expect(rpc).toHaveBeenCalledTimes(1);
  expect(abortSignal).toHaveBeenCalledTimes(1);
  expect(abortSignal.mock.calls[0][0].aborted).toBe(true);
 }finally{jest.useRealTimers();}
});

test('legacy coin local archive is owner-controlled, does not call eBay and preserves historical identity',()=>{
 const sync=fs.readFileSync('supabase/functions/swish-ebay-sync/index.ts','utf8');
 const begin=sync.indexOf("if(mode==='exclude_local_legacy')");
 const finish=sync.indexOf("if(mode==='exclude_policy_removed')",begin);
 expect(begin).toBeGreaterThan(0);
 expect(finish).toBeGreaterThan(begin);
 const archive=sync.slice(begin,finish);
 expect(archive).toContain("membership.role==='owner'||membership.role==='admin'");
 expect(archive).toContain(".eq('tenant_id',tenantId).eq('id',itemId)");
 expect(archive).toContain("String(row.external_listing_id??'')!==expectedExternalId");
 // A zero-valued saved sold_price is not itself proof of a sale.
 expect(archive).toContain("item.sold_at!=null||(item.sold_price!=null&&Number(item.sold_price)>0)");
 expect(archive).toContain("for(const table of ['sales','orders','ebay_returns'])");
 expect(archive).toContain("table!=='ebay_returns'&&listingIds.length");
 expect(archive).toContain("status:'held'");
 expect(archive).toContain("_swish_ebay_sync_excluded:expectedExternalId");
 expect(archive).toContain("_swish_ebay_sync_exclusion_code:'LOCAL_OWNER_ARCHIVE'");
 expect(archive).not.toContain('getItemObservation(');
 expect(archive).not.toContain('EndFixedPriceItem');
 expect(archive).not.toContain("from('swish_ebay_bindings')");
 expect(archive).not.toContain("from('listings').delete()");
 expect(archive).not.toContain("from('items').delete()");
 expect(archive).not.toContain('ebay_binding_id:');
 const projection=fs.readFileSync('supabase/migrations/20261111_canonical_inventory_identity.sql','utf8');
 expect(projection).toContain("when lower(btrim(i.status)) in ('held'");
 expect(sync).toContain("listings.push(...page.filter(row=>!excludedFromSync(row)))");
 expect(sync).toContain("nextAfterListingId=page.length===batchSize?String(page[page.length-1].id):null");
});
