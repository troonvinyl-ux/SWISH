jest.mock('@/template',()=>({getSupabaseClient:jest.fn()}));
import {getSupabaseClient} from '@/template';
import {runNicheEbayOperation,nextSyncBatchSize} from '../ebaySyncService';
import fs from 'node:fs';
const ids=[
 '00000000-0000-4000-8000-000000000006',
 '00000000-0000-4000-8000-000000000014',
 '00000000-0000-4000-8000-000000000024',
];
const result=(processed:number,nextAfterListingId:string|null,totalMs:number,patch:Record<string,unknown>={})=>({
 data:{success:true,batchComplete:true,processed,updated:processed,failed:0,blocked:0,
  nextAfterListingId,performance:{totalMs},...patch},error:null,
});
function setup(rows:any[]){
 const invoke=jest.fn();
 rows.forEach(row=>invoke.mockResolvedValueOnce(row));
 (getSupabaseClient as jest.Mock).mockReturnValue({functions:{invoke}});
 return invoke;
}
beforeEach(()=>jest.clearAllMocks());
test('24 linked listings are handled in three disjoint, confirmed requests when the provider is fast',async()=>{
 const invoke=setup([result(6,ids[0],12000),result(8,ids[1],14000),result(10,null,16000)]);
 const updates:any[]=[];
 const received=await runNicheEbayOperation('tenant','coins','sync',{onProgress:value=>updates.push(value)});
 expect(received.error).toBeNull();
 expect(received.data.processed).toBe(24);
 expect(received.data.updated).toBe(24);
 expect(invoke).toHaveBeenCalledTimes(3);
 const bodies=invoke.mock.calls.map(call=>call[1].body);
 expect(bodies.map(body=>body.batchSize)).toEqual([6,8,10]);
 expect(bodies.map(body=>body.afterListingId??null)).toEqual([null,ids[0],ids[1]]);
 expect(updates.map(row=>row.processed)).toEqual([6,14,24]);
 expect(bodies.every(body=>body.batch===true&&body.mode==='full')).toBe(true);
});
test('slow batches shrink instead of risking larger timeout-prone requests',()=>{
 expect(nextSyncBatchSize(6,{performance:{totalMs:62000},processed:6,batchComplete:true,success:true})).toBe(4);
 expect(nextSyncBatchSize(4,{performance:{totalMs:52000},processed:4,batchComplete:true,success:true})).toBe(3);
 expect(nextSyncBatchSize(10,{performance:{totalMs:14000},processed:10,batchComplete:true,success:true})).toBe(10);
 expect(nextSyncBatchSize(6,{performance:{totalMs:12000},processed:3,batchComplete:true,success:true})).toBe(6);
 expect(nextSyncBatchSize(6,{processed:6,success:true})).toBe(6);
});
test('an unconfirmed request never grows or replays another batch',async()=>{
 const invoke=setup([result(6,ids[0],15000,{success:false,batchComplete:false,error:'Live status unconfirmed'})]);
 const outcome=await runNicheEbayOperation('tenant','coins','sync');
 expect(outcome.error).toContain('Live status unconfirmed');
 expect(invoke).toHaveBeenCalledTimes(1);
});
test('worker enforces bounded requested batch sizes and protects same-item readback',()=>{
 const worker=fs.readFileSync('supabase/functions/swish-ebay-sync/index.ts','utf8');
 const helper=fs.readFileSync('supabase/functions/_shared/syncConcurrency.ts','utf8');
 expect(worker).toContain('desiredSize<3||desiredSize>10');
 expect(worker).toContain('rows.slice(0,batchSize)');
 expect(worker).toContain('nextAfterListingId=rows.length>batchSize');
 expect(worker).toContain('mapDistinctSyncItems(eligible');
 expect(worker).toContain('typeof syncConcurrency.mapDistinctSyncItems');
 expect(worker).toContain('return reconcileOne(row,previous)');
 expect(worker).toContain('swish_apply_ebay_listing_status');
 expect(worker).toContain('SWISH sync persisted readback failed');
 expect(worker).toContain('listings.filter(row=>observations.has(String(row.external_listing_id)))');
 expect(worker).not.toContain('fetchSellingPage(');
 expect(helper).toContain('await Promise.all');
 expect(helper).toContain('if(failed)throw failure');
 expect(helper).toContain('withinItem>0');
});
