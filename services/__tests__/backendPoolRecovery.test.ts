// Executable regression tests. A passing source check is NOT a substitute for installed-device acceptance.
jest.mock('@/template',()=>({getSupabaseClient:jest.fn()}));
import {getSupabaseClient} from '@/template';
import {backendRead,shareBackendRequest} from '@/services/backendRequestService';
import {isBackendUnavailable} from '@/services/backendAvailabilityService';
import {loadInventoryView} from '@/services/inventoryViewService';
import {getItemStatusCounts} from '@/services/itemService';
import {getLiveListingCount} from '@/services/listingService';
import {PRODUCTION_NICHE_IDS} from '@/constants/niches';
import {getProductionNicheSpecialistIds} from '@/services/nicheRouting';
import fs from 'node:fs';
import path from 'node:path';
const read=(file:string)=>fs.readFileSync(path.join(process.cwd(),file),'utf8');
let client:any;
beforeEach(()=>{
  jest.useRealTimers();jest.clearAllMocks();
  client={auth:{getSession:jest.fn().mockResolvedValue({data:{session:{access_token:'test-session'}},error:null})},rpc:jest.fn(),from:jest.fn()};
  (getSupabaseClient as jest.Mock).mockReturnValue(client);
});
afterEach(()=>jest.useRealTimers());
const result=(data:unknown)=>({abortSignal:jest.fn().mockResolvedValue({data,error:null})});
describe('Read governance and actual concurrency',()=>{
  test('20 identical session-scoped requests perform exactly one operation',async()=>{
    const operation=jest.fn().mockResolvedValue({data:42,error:null});
    const responses=await Promise.all(Array.from({length:20},()=>backendRead('identical',operation)));
    expect(operation).toHaveBeenCalledTimes(1);expect(responses).toHaveLength(20);
  });
  test('separate keys never exceed two simultaneous governed reads',async()=>{
    let running=0,peak=0;
    await Promise.all(Array.from({length:10},(_,i)=>backendRead(`parallel-${i}`,()=>new Promise(resolve=>{
      running++;peak=Math.max(peak,running);setTimeout(()=>{running--;resolve({data:i,error:null});},2);
    }))));
    expect(peak).toBe(2);expect(running).toBe(0);
  });
  test('deadline aborts a stalled read, then cooldown prevents a retry storm',async()=>{
    jest.useFakeTimers();
    const operation=jest.fn((signal:AbortSignal)=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true})));
    const pending=backendRead('stall',operation,'foreground',100).catch(error=>error);
    await jest.advanceTimersByTimeAsync(101);
    expect((await pending).message).toMatch(/timed out/);
    await expect(backendRead('stall',operation)).rejects.toThrow('timed out');
    expect(operation).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(5001);
    expect(await backendRead('stall',()=>Promise.resolve({data:'recovered',error:null}))).toMatchObject({data:'recovered'});
  });
  test('session change during a read discards the result; it cannot populate another login',async()=>{
    let release:(value:unknown)=>void=()=>{};
    const pending=backendRead('session-race',()=>new Promise(resolve=>{release=resolve;})).catch(error=>error);
    await new Promise(resolve=>setTimeout(resolve,0));
    client.auth.getSession.mockResolvedValue({data:{session:{access_token:'different-session'}},error:null});
    release({data:'old-private-data',error:null});
    expect((await pending).message).toMatch(/session changed/);
  });
  test('queue rejects replacement login before invoking the queued operation',async()=>{
    const releases:Array<(value:unknown)=>void>=[];
    const blockers=[0,1].map(i=>backendRead(`held-${i}`,()=>new Promise(resolve=>{releases.push(resolve);})).catch(error=>error));
    await new Promise(resolve=>setTimeout(resolve,0));
    expect(releases).toHaveLength(2);
    const op=jest.fn().mockResolvedValue({data:'should-not-run',error:null});
    const queued=backendRead('queued-private-read',op).catch(error=>error);
    await new Promise(resolve=>setTimeout(resolve,0));
    client.auth.getSession.mockResolvedValue({data:{session:{access_token:'new-login'}},error:null});
    releases.forEach(release=>release({data:null,error:null}));
    await Promise.all(blockers);
    expect((await queued).message).toMatch(/session changed before backend dispatch/);
    expect(op).not.toHaveBeenCalled();
  });
  test('a governed read captures scope once, then checks at dispatch and completion',async()=>{
    await backendRead('scope-capture-count',()=>Promise.resolve({data:true,error:null}));
    expect(client.auth.getSession).toHaveBeenCalledTimes(3);
  });
  test('orchestration sharing does not cache earlier successful grants',async()=>{
    const op=jest.fn().mockResolvedValue(true);
    await shareBackendRequest('grant',op);await shareBackendRequest('grant',op);
    expect(op).toHaveBeenCalledTimes(2);
  });
});
describe('Authorization and all eleven canonical inventories',()=>{
  test.each(PRODUCTION_NICHE_IDS)('%s performs one authorization check and scoped paginated item reads',async niche=>{
    const q:any={};for(const method of ['select','eq','in','order','range'])q[method]=jest.fn(()=>q);
    q.abortSignal=jest.fn().mockResolvedValue({data:[],error:null});client.from.mockReturnValue(q);client.rpc.mockReturnValue(result({total:0,units:0,stock:0,draft:0,live:0,sold:0,archived:0,live_listings:0}));
    const loaded=await loadInventoryView('tenant',niche);
    expect(loaded.error).toBeNull();expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith('swish_inventory_tab_counts',{p_tenant_id:'tenant',p_niche_id:niche});
    expect(q.eq).toHaveBeenCalledWith('tenant_id','tenant');expect(q.in).toHaveBeenCalledWith('specialist_id',getProductionNicheSpecialistIds(niche));
  });
  test('a confirmed denial prevents both records and relationships loading',async()=>{
    client.rpc.mockReturnValue({abortSignal:jest.fn().mockResolvedValue({data:null,error:{message:'Inventory niche access denied',code:'42501'},status:403})});
    expect((await loadInventoryView('tenant','coins')).error).not.toBeNull();expect(client.from).not.toHaveBeenCalled();
  });
  test.each(['[401] Invalid or expired authentication','[403] Access denied','42501: Inventory niche access denied','Authenticated session changed during backend read.'])('%s is not treated as an outage',message=>expect(isBackendUnavailable(message)).toBe(false));
  test.each(['[503] temporarily unavailable','[504] gateway timeout','57014: canceling statement due to statement timeout','Timed out acquiring connection from connection pool.'])('%s is a transient infrastructure failure',message=>expect(isBackendUnavailable(message)).toBe(true));
  test('failed counts cannot become a successful zero inventory result',async()=>{
    client.rpc.mockReturnValue({abortSignal:jest.fn().mockResolvedValue({data:null,error:{message:'Gateway timeout'},status:504})});
    await expect(getItemStatusCounts('tenant',['coins'])).rejects.toThrow('Gateway timeout');
    await expect(getLiveListingCount('tenant',['coins'])).rejects.toThrow('Gateway timeout');
  });
});
describe('Provider and SQL invariants',()=>{
  test('verification refresh neither grants from metadata nor extends a stale snapshot indefinitely',()=>{
    const source=read('contexts/AppContext.tsx');
    expect(source).toContain('verificationMaxAge');expect(source).toContain('isBackendUnavailable(message)');
    expect(source).toContain('Date.now()-previous.verifiedAt<verificationMaxAge');
    expect(source).toContain('accessRef.current=null;setAccess(null);setAccessError(message);clearModule()');
    expect(source).toContain('activateModuleScope(account.id, id)');expect(source).not.toContain('isSwishMasterAdmin(user?.email)');
  });
  test('query repair retains invoker RLS and does not mutate inventory rows',()=>{
    const sql=read('supabase/migrations/20261105_inventory_pool_query_repair.sql');
    expect(sql).toContain('cross join lateral');expect(sql).toContain('with (security_invoker = true)');
    expect(sql).not.toMatch(/disable row level security|update public.items|delete from|insert into public.items/i);
    expect(sql).toContain('public.swish_can_access_niche(p_tenant_id,p_niche_id)');
  });
  test('optional settings do not block verified module activation',()=>{
    const source=read('contexts/AppContext.tsx');
    const opening=source.split('const openModule =')[1].split('const returnToMaster =')[0];
    expect(opening).toContain('void getBusinessConfig');expect(opening).not.toContain('await getBusinessConfig');
  });
});
