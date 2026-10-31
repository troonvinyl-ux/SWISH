jest.mock('@/template',()=>({getSupabaseClient:jest.fn()}));
jest.mock('expo-crypto',()=>({randomUUID:jest.fn(()=> '44444444-4444-4444-8444-444444444444')}));
import fs from 'node:fs';
import path from 'node:path';
import { getSupabaseClient } from '@/template';
import { normaliseManifest } from '@/services/manifestParser';
import { toLotLines } from '@/services/lotEconomicsService';
import { emptyManifestSession } from '@/services/manifestSessionService';
import { createWatchedLotSnapshot,decodeWatchedLotSnapshot,encodeWatchedLotSnapshot,restoreWatchedLotSession,
  isWatchedLotInScope,watchedSnapshotPath,listWatchedLots,saveWatchedLot,removeWatchedLot,openWatchedLot,
  type WatchedLotScope,type WatchedLot } from '@/services/watchedLotService';
import { PRODUCTION_NICHE_IDS } from '@/constants/niches';
const scope:WatchedLotScope={userId:'11111111-1111-4111-8111-111111111111',tenantId:'22222222-2222-4222-8222-222222222222',nicheId:'surplus_flip'};
const key='a'.repeat(64);
const revision='44444444-4444-4444-8444-444444444444';
const session=()=>({...emptyManifestSession(),name:'Pallet £10,000 — café',key,
  lines:toLotLines(normaliseManifest([['Title','Quantity','Unit RRP'],['Plain widget',100,100]]).rows)});
const row=():WatchedLot=>{const snapshot=createWatchedLotSnapshot(scope,session());return {id:revision,
  user_id:scope.userId,tenant_id:scope.tenantId,niche_id:scope.nicheId,manifest_key:key,name:snapshot.draft.name,
  product_count:1,unit_count:100,base_valuation:snapshot.base,engine_version:snapshot.engineVersion,
  snapshot_path:watchedSnapshotPath(scope,key,revision),created_at:snapshot.savedAt,updated_at:snapshot.savedAt};};
const source=(file:string)=>fs.readFileSync(path.resolve(__dirname,'../..',file),'utf8');
function mockQuery(data:unknown,error:unknown=null){
  const query:any={};for(const method of ['select','eq','order','upsert','delete'])query[method]=jest.fn(()=>query);
  query.range=jest.fn(async()=>({data,error}));query.single=jest.fn(async()=>({data,error}));
  // Awaiting delete().eq().select() settles the same mock.
  query.then=(resolve:any)=>Promise.resolve({data,error}).then(resolve);
  return query;
}
describe('Persistent watched manifests, separate from inventory',()=>{
  test('round trip retains every manifest field, assumptions and exact saved base valuation',()=>{
    const original=session();original.assumptions.currentBid=100;original.assumptions.inbound=100;
    original.lines[0].packSize=5;original.lines[0].specifics=[{name:'Brand',value:'Example'}];
    const snapshot=createWatchedLotSnapshot(scope,original,'2026-10-31T12:00:00.000Z');
    const restored=decodeWatchedLotSnapshot(JSON.stringify(snapshot),scope,key);
    expect(restored.draft.lines).toEqual(original.lines);expect(restored.draft.assumptions).toEqual(original.assumptions);
    expect(restored.base.maximumHammerBid).toBe(1677.77);expect(restored.base.resaleCeiling).toBe(4000);
    const reopened=restoreWatchedLotSession(restored);
    expect(reopened.acquisitionId).toBeNull();
    expect(reopened.restoredWatchAt).toBe('2026-10-31T12:00:00.000Z');
    expect(reopened.watchedBidNeedsRefresh).toBe(true);
    expect(reopened.assumptions.currentBid).toBe(100); // preserved snapshot, not live data
    expect(emptyManifestSession().watchedBidNeedsRefresh).toBe(false);
  });
  test('UTF-8 encoding preserves pounds, accented text and emoji without native Blob support',()=>{
    const original=session();original.name+=' 📦';const snapshot=createWatchedLotSnapshot(scope,original);
    expect(Buffer.from(encodeWatchedLotSnapshot(snapshot)).toString('utf8')).toBe(JSON.stringify(snapshot));
  });
  test.each(PRODUCTION_NICHE_IDS)('%s stays its own canonical niche',nicheId=>{
    const active={...scope,nicheId};expect(createWatchedLotSnapshot(active,session()).scope.nicheId).toBe(nicheId);
    expect(watchedSnapshotPath(active,key,revision)).toContain(`/${nicheId}/${key}/`);
  });
  test.each(['userId','tenantId','nicheId'] as const)('reopening under a different %s is rejected',field=>{
    const other={...scope,[field]:field==='nicheId'?'coins':'33333333-3333-4333-8333-333333333333'};
    expect(()=>decodeWatchedLotSnapshot(JSON.stringify(createWatchedLotSnapshot(scope,session())),other,key)).toThrow();
    expect(isWatchedLotInScope(row(),other)).toBe(false);
  });
  test('different manifest identities and unsupported snapshot versions cannot restore',()=>{
    const snapshot=createWatchedLotSnapshot(scope,session());
    expect(()=>decodeWatchedLotSnapshot(JSON.stringify(snapshot),scope,'b'.repeat(64))).toThrow();
    expect(()=>decodeWatchedLotSnapshot(JSON.stringify({...snapshot,version:999}),scope,key)).toThrow();
  });
  test('watching excludes paid price, stock and listing links; purchased sessions are rejected',()=>{
    const original=session();original.paidHammer='500';original.itemIds=['item'];original.listingIds=['listing'];
    const snapshot=createWatchedLotSnapshot(scope,original);
    expect(snapshot.draft).not.toHaveProperty('paidHammer');expect(snapshot.draft).not.toHaveProperty('itemIds');
    expect(snapshot.draft).not.toHaveProperty('listingIds');
    const restored=restoreWatchedLotSession(snapshot);expect(restored.paidHammer).toBe('');expect(restored.itemIds).toEqual([]);
    expect(()=>createWatchedLotSnapshot(scope,{...original,acquisitionId:'purchase'})).toThrow('already purchased');
  });
  test('invalid numbers, incomplete assumptions, malformed rows and oversized files fail before upload',()=>{
    const original=session();original.lines[0].price=NaN;expect(()=>createWatchedLotSnapshot(scope,original)).toThrow();
    const snapshot=createWatchedLotSnapshot(scope,session());
    const invalid={...snapshot,draft:{...snapshot.draft,assumptions:{}}};
    expect(()=>decodeWatchedLotSnapshot(JSON.stringify(invalid),scope,key)).toThrow();
    snapshot.draft.lines[0].description='x'.repeat(5*1024*1024);
    expect(()=>encodeWatchedLotSnapshot(snapshot)).toThrow('too large');
  });
  test('legacy invalid budgets are ignored rather than serialized as misleading economic inputs',()=>{
    const original=session();original.assumptions.budget=NaN;
    expect(createWatchedLotSnapshot(scope,original).draft.assumptions).not.toHaveProperty('budget');
  });
});
describe('Cloud watch operations',()=>{
  beforeEach(()=>jest.clearAllMocks());
  test('successful watch uploads a private manifest first, then upserts only metadata and saved base',async()=>{
    const query=mockQuery(row());const upload=jest.fn(async()=>({error:null}));
    const client={from:jest.fn(()=>query),storage:{from:jest.fn(()=>({upload}))}};
    (getSupabaseClient as jest.Mock).mockReturnValue(client);
    await saveWatchedLot(scope,session());
    expect(client.from).toHaveBeenCalledWith('watched_lots');
    expect(query.upsert).toHaveBeenCalledWith(expect.objectContaining({user_id:scope.userId,niche_id:scope.nicheId}),{onConflict:'user_id,tenant_id,niche_id,manifest_key'});
    expect(query.upsert.mock.calls[0][0]).not.toHaveProperty('lines');
    expect(upload.mock.calls[0][2]).toEqual({contentType:'application/json',upsert:false});
    expect(upload.mock.invocationCallOrder[0]).toBeLessThan(query.upsert.mock.invocationCallOrder[0]);
  });
  test('upload failures and scope changes leave database pointer and old plan untouched',async()=>{
    const from=jest.fn();const upload=jest.fn(async()=>({error:{message:'offline'}}));
    (getSupabaseClient as jest.Mock).mockReturnValue({from,storage:{from:()=>({upload})}});
    await expect(saveWatchedLot(scope,session())).rejects.toThrow();expect(from).not.toHaveBeenCalled();
    upload.mockResolvedValue({error:null} as any);
    await expect(saveWatchedLot(scope,session(),()=>false)).rejects.toThrow('changed');expect(from).not.toHaveBeenCalled();
  });
  test('list always filters by account, tenant and niche; pagination is bounded',async()=>{
    const query=mockQuery([row()]);(getSupabaseClient as jest.Mock).mockReturnValue({from:()=>query});
    await listWatchedLots(scope);
    expect(query.eq).toHaveBeenCalledWith('user_id',scope.userId);expect(query.eq).toHaveBeenCalledWith('tenant_id',scope.tenantId);
    expect(query.eq).toHaveBeenCalledWith('niche_id',scope.nicheId);expect(query.range).toHaveBeenCalledWith(0,30);
  });
  test('remove targets only the current shortlist row and scope',async()=>{
    const query=mockQuery([{id:revision}]);const from=jest.fn(()=>query);
    (getSupabaseClient as jest.Mock).mockReturnValue({from});await removeWatchedLot(scope,revision);
    expect(from).toHaveBeenCalledTimes(1);expect(from).toHaveBeenCalledWith('watched_lots');
    expect(query.eq).toHaveBeenCalledWith('id',revision);expect(query.eq).toHaveBeenCalledWith('niche_id',scope.nicheId);
  });
  test('cross-scope row cannot obtain a signed manifest URL',async()=>{
    const query=mockQuery({...row(),niche_id:'coins'});const storageFrom=jest.fn();
    (getSupabaseClient as jest.Mock).mockReturnValue({from:()=>query,storage:{from:storageFrom}});
    await expect(openWatchedLot(scope,revision)).rejects.toThrow();expect(storageFrom).not.toHaveBeenCalled();
  });
  test('successfully reopens a saved file without buying or creating listings',async()=>{
    const query=mockQuery(row());const snapshot=createWatchedLotSnapshot(scope,session());
    const signed=jest.fn(async()=>({data:{signedUrl:'https://example.com/private-manifest'},error:null}));
    (getSupabaseClient as jest.Mock).mockReturnValue({from:()=>query,storage:{from:()=>({createSignedUrl:signed})}});
    const previous=global.fetch;global.fetch=jest.fn(async()=>({ok:true,text:async()=>JSON.stringify(snapshot)})) as any;
    try {const reopened=await openWatchedLot(scope,revision);expect(reopened.base.resaleCeiling).toBe(4000);} finally {global.fetch=previous;}
  });
});
describe('Source and database boundary contracts, not device tests',()=>{
  test('watch data is protected by account, paid niche and tenant checks',()=>{
    const sql=source('supabase/migrations/20261031_watched_lots.sql');
    expect(sql).toContain('enable row level security');expect(sql).toContain('user_id = auth.uid()');
    expect(sql).toContain('swish_can_access_niche(tenant_id,niche_id)');expect(sql).toContain('references public.user_profiles(id)');
    expect(sql).toContain("'watched-lot-manifests',false");expect(sql).toContain('as restrictive for select to anon');
    expect(sql).not.toContain('insert into public.items');expect(sql).not.toContain('insert into public.acquisitions');
  });
  test('root mounts the shared provider and no new tab is added',()=>{
    expect(source('app/_layout.tsx')).toContain('<WatchedLotsProvider>');
    expect(source('components/feature/ManifestOpportunityWorkspace.tsx')).toContain('Watch this lot');
    expect(source('app/watched-lots.tsx')).toContain('WatchedLotCard');
  });
  test('watch service does not call purchase RPC, listing operations or AI',()=>{
    const code=source('services/watchedLotService.ts');expect(code).not.toContain(".rpc(");
    expect(code).not.toContain('savePurchasedManifest');expect(code).not.toContain('functions.invoke');
    expect(source('hooks/useManifestOpportunity.ts')).toContain('blocked:draft.watchedBidNeedsRefresh');
    expect(source('hooks/useManifestOpportunity.ts')).toContain('draft.restoredWatchAt ? 3');
    expect(source('components/feature/ManifestOpportunityWorkspace.tsx')).toContain('Update auction details');
  });
});
