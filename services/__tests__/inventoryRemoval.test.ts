// Injected/mocked regression coverage. No actual inventory deletion or seller requests.
jest.mock('@/template', () => ({ getSupabaseClient: jest.fn() }));
import fs from 'node:fs';
import { getSupabaseClient } from '@/template';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { deleteItem } from '../itemService';
import { deleteListing, endListing } from '../listingService';
import { PRODUCTION_NICHE_IDS, NICHE_MODULES } from '@/constants/niches';
const tenant='tenant',item='item',id='listing',external='123456789';
const row=(patch:any={})=>({id,item_id:item,status:'active',external_listing_id:external,publish_claim_id:null,published_at:'2026-11-07',items:{tenant_id:tenant,specialist_id:'collectibles',status:'listed'},...patch});
function setup(rows:any[]=[],response:any={data:{success:true,confirmed:true,externalListingId:external},error:null},issue:any={data:null,error:null},deletion:any={count:1,error:null}) {
 const queries:any[]=[];
 const from=jest.fn(()=>{const query:any={};for(const method of ['select','eq','is','delete'])query[method]=jest.fn(()=>query);
 query.maybeSingle=jest.fn().mockResolvedValue({data:rows.shift(),error:null});query.then=(resolve:any)=>Promise.resolve(deletion).then(resolve);queries.push(query);return query;});
 const invoke=jest.fn().mockResolvedValue(response);const rpc=jest.fn().mockResolvedValue(issue);
 (getSupabaseClient as jest.Mock).mockReturnValue({from,rpc,functions:{invoke}});return {from,invoke,rpc,queries};
}
beforeEach(()=>jest.clearAllMocks());
test('unscoped item deletion never obtains a database client',async()=>{
 await expect(deleteItem(item,'')).resolves.toMatchObject({error:expect.stringContaining('tenantId is required')});expect(getSupabaseClient).not.toHaveBeenCalled();
});
test.each(['End every live listing first','Sale, order or return history must be retained','Publication pending','End confirmation required'])('server blocker %s prevents deletion',async message=>{
 const client=setup([],undefined,{data:message,error:null});expect((await deleteItem(item,tenant)).error).toBe(message);expect(client.from).not.toHaveBeenCalled();expect(client.invoke).not.toHaveBeenCalled();
});
test('missing guard, malformed guard and transport failures never authorize deletion',async()=>{
 for(const issue of [{data:null,error:{message:'RPC unavailable'}},{data:true,error:null},{data:'',error:null}]){const client=setup([],undefined,issue);expect((await deleteItem(item,tenant)).error).toBeTruthy();expect(client.from).not.toHaveBeenCalled();}
 const client=setup();client.rpc.mockRejectedValueOnce(new Error('timeout'));expect((await deleteItem(item,tenant)).error).toBeTruthy();expect(client.from).not.toHaveBeenCalled();
});
test('eligible item deletion is tenant scoped, exact-count confirmed and never calls eBay',async()=>{
 const client=setup();expect((await deleteItem(item,tenant)).error).toBeNull();expect(client.rpc).toHaveBeenCalledWith('swish_inventory_delete_issue',{p_tenant_id:tenant,p_item_id:item});
 expect(client.queries[0].eq).toHaveBeenCalledWith('id',item);expect(client.queries[0].eq).toHaveBeenCalledWith('tenant_id',tenant);expect(client.queries[0].delete).toHaveBeenCalledWith({count:'exact'});expect(client.invoke).not.toHaveBeenCalled();
});
test.each([0,null,2])('unconfirmed affected-row count %s does not claim a deletion',async count=>{setup([],undefined,undefined,{count,error:null});expect((await deleteItem(item,tenant)).error).toBeTruthy();});
test('listing deletion ignores stale caller hints and does not combine End with Delete',async()=>{
 const client=setup([row()]);expect((await deleteListing(id,tenant,{status:'draft'})).error).toContain('End the eBay listing first');expect(client.invoke).not.toHaveBeenCalled();expect(client.queries[0].delete).not.toHaveBeenCalled();
});
test('unpublished draft deletion retains inventory and uses tenant/claim constraints',async()=>{
 const client=setup([row({status:'draft',external_listing_id:null,published_at:null})]);expect((await deleteListing(id,tenant)).error).toBeNull();expect(client.invoke).not.toHaveBeenCalled();expect(client.queries[1].eq).toHaveBeenCalledWith('tenant_id',tenant);expect(client.queries[1].is).toHaveBeenCalledWith('publish_claim_id',null);
});
test.each(PRODUCTION_NICHE_IDS)('%s uses the same two-step end contract',async niche=>{
 const specialist=NICHE_MODULES[niche].defaultSpecialist;
 const client=setup([row({items:{tenant_id:tenant,specialist_id:specialist,status:'listed'}}),row({status:'ended',ended_at:'2026-11-07',items:{tenant_id:tenant,specialist_id:specialist,status:'identified'}})]);
 expect((await endListing(id,item,tenant,external)).error).toBeNull();expect(client.invoke).toHaveBeenCalledTimes(1);expect(client.invoke.mock.calls[0][1].body).toMatchObject({route:'end',nicheId:niche,externalListingId:external});
 expect(client.queries.every(query=>query.delete.mock.calls.length===0)).toBe(true);
});
test('duplicate end taps share one in-flight request',async()=>{
 const client=setup([row(),row({status:'ended',ended_at:'2026-11-07'})]);const a=endListing(id,item,tenant,external),b=endListing(id,item,tenant,external);expect(a).toBe(b);await a;expect(client.invoke).toHaveBeenCalledTimes(1);
});
test('Ack-only success and local reconciliation failure never return a successful end',async()=>{
 let client=setup([row()],{data:{success:true,externalListingId:external},error:null});expect((await endListing(id,item,tenant,external)).error).toBeTruthy();expect(client.queries[0].delete).not.toHaveBeenCalled();
 client=setup([row(),row()]);expect((await endListing(id,item,tenant,external)).error).toContain('reconciliation');
});
test('end rejects mismatched item/tenant/external identities and pending claims',async()=>{
 for(const entry of [row({item_id:'other'}),row({items:{tenant_id:'other',specialist_id:'collectibles'}}),row({publish_claim_id:'claim'}),row({external_listing_id:'987654321'})]){const client=setup([entry]);expect((await endListing(id,item,tenant,external)).error).toBeTruthy();expect(client.invoke).not.toHaveBeenCalled();}
});
test('end timeout retains inventory, does not retry automatically and hides HTML',async()=>{
 const client=setup([row()],{data:null,error:new FunctionsHttpError(new Response('<html>Gateway</html>',{status:504}))});const result=await endListing(id,item,tenant,external);expect(result.error).toBeTruthy();expect(result.error).not.toContain('<html>');expect(client.invoke).toHaveBeenCalledTimes(1);
});
test('shared UI exposes two separate confirmations and a canonical reload',()=>{
 const ui=fs.readFileSync('app/stock-listing/[id].tsx','utf8'),inventory=fs.readFileSync('app/(tabs)/inventory.tsx','utf8'),hook=fs.readFileSync('hooks/useInventoryRemoval.ts','utf8');
 expect(ui).not.toContain('End on eBay & Delete');expect(ui).toContain('<InventoryRemovalPanel');expect(ui).toContain("params: { tab: 'stock' }");expect(inventory).toContain('onDelete={() => removal.requestDelete');expect(hook).toContain("showAlert('Delete inventory item?'");expect(hook).toContain('guard.isCurrent(scope)');expect(hook).not.toContain('endListing(');expect(hook).toContain('triggerInventoryReload()');
});
test('database guards protect hidden relationships, signed end evidence and publication races',()=>{
 const sql=fs.readFileSync('supabase/migrations/20261118_user_listing_removal.sql','utf8');
 for(const value of ['guard_user_item_removal','guard_user_listing_removal','lock_listing_inventory_removal','publish_claim_id','public.sales','public.orders','public.ebay_returns','swish_listing_end_receipts','for update','swish_can_access_niche'])expect(sql).toContain(value);
 expect(sql).toContain('revoke all on public.swish_listing_end_receipts from public,anon,authenticated');expect(sql).not.toContain('grant insert on public.swish_listing_end_receipts to authenticated');
});
