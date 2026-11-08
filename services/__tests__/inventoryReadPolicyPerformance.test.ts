// Pure predicate/source regressions. Live RLS probes are documented separately.
import fs from 'node:fs';
const read=(file:string)=>fs.readFileSync(file,'utf8');
interface ItemRow {tenant:string;id:string;niche:string}
interface ListingRow {tenant:string;id:string;item:string;external:string|null}
interface OrderRow {tenant:string;item:string|null;listing:string|null}
const items:ItemRow[]=[{tenant:'a',id:'coin',niche:'coins'},{tenant:'a',id:'game',niche:'tech'},{tenant:'b',id:'other',niche:'coins'}];
const listings:ListingRow[]=[{tenant:'a',id:'coin-listing',item:'coin',external:'100'},{tenant:'a',id:'game-listing',item:'game',external:'200'},{tenant:'b',id:'other-listing',item:'other',external:'100'},{tenant:'a',id:'orphan',item:'missing',external:'300'}];
const canRead=(item:ItemRow)=>item.tenant==='a'&&item.niche==='coins';
const readableItems=items.filter(canRead);
const readableListings=listings.filter(l=>readableItems.some(i=>i.tenant===l.tenant&&i.id===l.item));
function oldOrder(o:OrderRow){return readableItems.some(i=>i.tenant===o.tenant&&
 ((o.item!==null&&i.id===o.item)||(o.item===null&&readableListings.some(l=>l.id===o.listing&&l.item===i.id&&l.tenant===o.tenant)))&&
 (o.listing===null||readableListings.some(l=>l.id===o.listing&&l.item===i.id&&l.tenant===o.tenant)));}
function newOrder(o:OrderRow){return o.item!==null
 ? readableItems.some(i=>i.tenant===o.tenant&&i.id===o.item)&&(o.listing===null||readableListings.some(l=>l.tenant===o.tenant&&l.id===o.listing&&l.item===o.item))
 : o.listing!==null&&readableListings.some(l=>l.tenant===o.tenant&&l.id===o.listing&&readableItems.some(i=>i.id===l.item&&i.tenant===l.tenant));}
test('split nullable order predicates preserve original parent/tenant/niche checks for every fixture combination',()=>{
 for(const tenant of ['a','b','missing'])for(const item of [null,'coin','game','other','missing'])for(const listing of [null,'coin-listing','game-listing','other-listing','orphan','missing']){
  const order={tenant,item,listing};expect(newOrder(order)).toBe(oldOrder(order));
 }
 expect(newOrder({tenant:'a',item:'coin',listing:null})).toBe(true);
 expect(newOrder({tenant:'a',item:null,listing:'coin-listing'})).toBe(true);
 expect(newOrder({tenant:'a',item:'coin',listing:'game-listing'})).toBe(false);
 expect(newOrder({tenant:'b',item:'other',listing:'other-listing'})).toBe(false);
 expect(newOrder({tenant:'a',item:null,listing:null})).toBe(false);
});
test('the statement-local authorization helper is self-scoped, freshly verified and anonymous-inaccessible',()=>{
 const sql=read('supabase/migrations/20261120_inventory_read_policy_performance.sql');
 for(const token of ['stable security definer','m.session_id=(select auth.jwt()', 'm.user_id=(select auth.uid())','public.swish_can_access_niche(m.tenant_id,m.niche_id)','m.niche_id is not null','from public,anon'])expect(sql).toContain(token);
 expect(sql).not.toMatch(/create table|insert into|update public\.|delete from|disable row level security|set row_security/i);
 expect(sql.match(/alter policy /g)).toHaveLength(5);
 for(const policy of ['authenticated_select_paid_items','authenticated_select_paid_listings','authenticated_select_paid_order_resource','authenticated_select_module_sales','authenticated_select_module_returns'])expect(sql).toContain(`alter policy ${policy}`);
 expect(sql).not.toMatch(/alter policy authenticated_(?:insert|update|delete)|drop policy/);
 expect(sql).toContain("permissive='RESTRICTIVE'");expect(sql).toContain("cmd='SELECT'");
 const countSql=read('supabase/migrations/20261119_inventory_count_timeout_repair.sql');expect(countSql).toContain('stable security invoker');
});
test('home separates overview totals from explicit stock/photo hydration and labels retained counts',()=>{
 const hook=read('hooks/useNicheDashboard.ts'),ui=read('components/feature/SharedNicheDashboard.tsx'),inventory=read('hooks/useInventory.ts');
 expect(hook).toContain('useInventory({}, { countsOnly: true })');
 expect(hook).toContain('useInventory({}, { enabled: purpose !== null })');
 expect(inventory.indexOf('if(countsOnly)')).toBeLessThan(inventory.indexOf(':listItems(tenant.id,effectiveFilter)'));
 expect(inventory).toContain('Boolean(enabled&&user?.id');
 expect(hook).not.toContain('setInterval');expect(hook).not.toContain('setTimeout');
 expect(ui).toContain('!dashboard.hasSnapshot');expect(ui).toContain('Last confirmed inventory totals · refresh pending');
 expect(ui).toContain('refreshing={dashboard.stockLoading} onRefresh={dashboard.reloadStock}');
});
