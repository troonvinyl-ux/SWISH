// Executable pure/mocked regressions. This file does not claim device or live marketplace timing.
jest.mock('@/template',()=>({getSupabaseClient:jest.fn()}));
import {getSupabaseClient} from '@/template';
import {parseCanonicalCounts} from '../canonicalInventoryService';
import {loadInventoryView} from '../inventoryViewService';
import {readUnchangedInventory,rememberInventory,forgetInventory} from '../inventorySnapshotReuseService';
import {invokeScopedSync} from '../syncRequestService';
import {readPerformanceDiagnostics,recordPerformance} from '../performanceMonitoringService';
import {mapSyncReads,syncPatchChanged} from '../../supabase/functions/_shared/syncConcurrency';
import fs from 'node:fs';
const counts=(revision='a'.repeat(32))=>({total:1,units:1,stock:1,draft:0,live:0,sold:0,archived:0,live_listings:0,revision,status_counts:{identified:1}});
function setup(){
 const getSession=jest.fn().mockResolvedValue({data:{session:{access_token:'session-a'}},error:null});
 const q:any={};for(const method of ['select','eq','in','order','range'])q[method]=jest.fn(()=>q);
 const row={item_id:'item',tenant_id:'tenant',specialist_id:'coins',inventory_tab:'stock',item:{id:'item',tenant_id:'tenant',specialist_id:'coins',canonical_title:'Coin',status:'identified',updated_at:'v1',media:[],attributes:{}},listing:null};
 q.abortSignal=jest.fn().mockResolvedValue({data:[row],error:null});
 const rpc=jest.fn(()=>({abortSignal:jest.fn().mockResolvedValue({data:counts(),error:null})}));
 const client={auth:{getSession},rpc,from:jest.fn(()=>q),functions:{invoke:jest.fn().mockResolvedValue({data:{success:true},error:null})}};
 (getSupabaseClient as jest.Mock).mockReturnValue(client);return {client,q};
}
beforeEach(()=>{jest.clearAllMocks();jest.useRealTimers();});
afterEach(()=>jest.useRealTimers());
test('unchanged refresh checks paid/RLS counts again but does not download another page',async()=>{
 const {client}=setup();expect((await loadInventoryView('tenant','coins')).error).toBeNull();
 expect(client.from).toHaveBeenCalledTimes(1);expect(client.rpc).toHaveBeenCalledTimes(2);
 expect((await loadInventoryView('tenant','coins')).error).toBeNull();
 expect(client.from).toHaveBeenCalledTimes(1);expect(client.rpc).toHaveBeenCalledTimes(3);
});
test('a revision edit without a count change downloads the updated collection',async()=>{
 const {client}=setup();await loadInventoryView('tenant','coins');
 client.rpc.mockImplementation(()=>({abortSignal:jest.fn().mockResolvedValue({data:counts('b'.repeat(32)),error:null})}));
 expect((await loadInventoryView('tenant','coins')).error).toBeNull();expect(client.from).toHaveBeenCalledTimes(2);
});
test('permission denial invalidates data instead of trusting a saved revision',async()=>{
 const {client}=setup();await loadInventoryView('tenant','coins');
 client.rpc.mockImplementation(()=>({abortSignal:jest.fn().mockResolvedValue({data:null,error:{message:'Inventory niche access denied',code:'42501'},status:403})}));
 const result=await loadInventoryView('tenant','coins');expect(result.items).toEqual([]);expect(result.error).toMatch(/denied/);expect(client.from).toHaveBeenCalledTimes(1);
});
test('revision/status contracts cannot fabricate consistent totals',()=>{
 expect(parseCanonicalCounts(counts()).statusCounts).toEqual({identified:1});
 expect(()=>parseCanonicalCounts({...counts(),revision:'unsafe'})).toThrow('revision');
 expect(()=>parseCanonicalCounts({...counts(),status_counts:{identified:2}})).toThrow('totals');
});
test('data reuse is session-isolated, revision-sensitive and expires',()=>{
 jest.useFakeTimers();rememberInventory('a:tenant:coins','rev',{id:'a'});
 expect(readUnchangedInventory('b:tenant:coins','rev')).toBeNull();
 expect(readUnchangedInventory('a:tenant:coins','rev')).toEqual({id:'a'});
 jest.advanceTimersByTime(300001);expect(readUnchangedInventory('a:tenant:coins','rev')).toBeNull();forgetInventory('a:tenant:coins');
});
test('independent eBay reads peak at three workers and preserve ordering',async()=>{
 let active=0,peak=0;
 const values=await mapSyncReads([1,2,3,4,5,6],async value=>{active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,2));active--;return value*2;});
 expect(values).toEqual([2,4,6,8,10,12]);expect(peak).toBe(3);expect(active).toBe(0);
});
test('incomplete observations finish active reads then reject before any caller can reconcile',async()=>{
 let completed=0,mutated=false;
 try{await mapSyncReads([1,2,3,4],async value=>{if(value===2)throw new Error('unverified');await new Promise(resolve=>setTimeout(resolve,2));completed++;return value;});mutated=true;}catch(cause){expect((cause as Error).message).toBe('unverified');}
 expect(mutated).toBe(false);expect(completed).toBeGreaterThan(0);
});
test('semantic equality skips no-op metadata writes but detects photo/price changes',()=>{
 expect(syncPatchChanged({attributes:{a:1,b:2},media:['front','back'],price:20},{attributes:{b:2,a:1},media:['front','back'],price:20})).toBe(false);
 expect(syncPatchChanged({price:20},{price:21})).toBe(true);
 expect(syncPatchChanged({media:['front','back']},{media:['back','front']})).toBe(true);
});
test('twenty concurrent sync taps invoke the existing Edge Function only once',async()=>{
 const {client}=setup();await Promise.all(Array.from({length:20},()=>invokeScopedSync('swish-ebay-sync',{tenantId:'tenant',nicheId:'coins',mode:'full'})));
 expect(client.functions.invoke).toHaveBeenCalledTimes(1);
});
test('a stalled sync times out and aborts without an automatic replay',async()=>{
 jest.useFakeTimers();const {client}=setup();client.functions.invoke.mockImplementation(()=>new Promise(()=>{}));
 const caught=invokeScopedSync('swish-ebay-sync',{tenantId:'tenant',nicheId:'coins'},100).catch(cause=>cause);
 await jest.advanceTimersByTimeAsync(101);expect((await caught).message).toMatch(/timed out/);expect(client.functions.invoke).toHaveBeenCalledTimes(1);
 expect(client.functions.invoke.mock.calls[0][1].signal.aborted).toBe(true);
});
test('diagnostics contain no identity or payload fields and report failures',()=>{
 recordPerformance('image_upload',50,'failure');const evidence=readPerformanceDiagnostics();
 expect(evidence.stages.find(stage=>stage.stage==='image_upload')?.failures).toBeGreaterThan(0);
 expect(JSON.stringify(evidence)).not.toMatch(/session-a|tenantId|access_token|credential_ref/);
});
test('SQL/server boundaries retain auth, canonical reconciliation and server-only sync claims',()=>{
 const sql=fs.readFileSync('supabase/migrations/20261116_inventory_snapshot_performance.sql','utf8');
 expect(sql).toContain('security invoker');expect(sql).toContain('physical as materialized');expect(sql).toContain('swish_can_access_niche');expect(sql).not.toMatch(/disable row level security|delete from|update public.items/i);
 const lease=fs.readFileSync('supabase/migrations/20261116_ebay_sync_lease.sql','utf8');expect(lease).toContain('from public,anon,authenticated');expect(lease).toContain('pg_advisory_xact_lock');
 const edge=fs.readFileSync('supabase/functions/swish-ebay-sync/index.ts','utf8');expect(edge).toContain('swish_apply_ebay_listing_status');expect(edge).toContain('parseEbayListingStatus');expect(edge).toContain('decryptCredentials');expect(edge).toContain('mapSyncReads');
});
