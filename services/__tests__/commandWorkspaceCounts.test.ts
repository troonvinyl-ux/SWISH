// Pure/mocked regressions; not installed-device or live seller acceptance.
jest.mock('@/template', () => ({ getSupabaseClient: jest.fn() }));
import fs from 'node:fs';
import { PRODUCTION_NICHE_IDS } from '@/constants/niches';
import { resolveCommandReportScope, commandScopeLabel } from '../commandScopeService';
import { sumCommandModules, validateCommandSnapshot, type CommandModule } from '../commandCentreService';
import { parseNicheListingMetrics, readNicheListingMetrics } from '../nicheListingMetricsService';
import { getSupabaseClient } from '@/template';
import { commandSnapshotTotals } from '../commandSnapshotTotalsService';
import type { CommandSnapshot } from '../commandCentreService';
const row = (id: CommandModule['id'], inventory = 0): CommandModule => ({ id, inventory, stock_total: inventory, inventory_units: inventory, sold_total: 0, review: 0, listed_inventory: 0, live: 0, drafts: 0, listed_value: 0, sold_week: 0, sales_week: 0, sales_month: 0, realised_total: 0, completed_sales: 0, duplicate_sales: 0, outstanding: 0, ebay_status: 'unknown', ai_status: 'unknown', last_sync: null, ai_checked_at: null });
const coins = { ...row('coins',250), stock_total:22, drafts:8, listed_inventory:206, live:206, sold_total:14 };
const counts = { total:250, units:250, stock:22, draft:8, live:206, sold:14, archived:0, live_listings:206 };
const metrics = () => ({ inventory_counts:counts, total_listings:230, ended_listings:0 });
beforeEach(() => jest.clearAllMocks());
test('owners start in their workspace, not the aggregated platform', () => {
 expect(resolveCommandReportScope(true,'workspace','','owner')).toBe('workspace');
 expect(resolveCommandReportScope(true,'platform','owner','owner')).toBe('platform');
 expect(resolveCommandReportScope(false,'platform','owner','owner')).toBe('workspace');
 expect(resolveCommandReportScope(true,'platform','old-owner','new-owner')).toBe('workspace');
 expect(resolveCommandReportScope(true,'platform','','')).toBe('workspace');
});
test('workspace coin report is 250/206, not the three-workspace 460/406 aggregate', () => {
 const current=sumCommandModules([coins]);
 const historical={...row('coins',208),stock_total:9,listed_inventory:199,live:200};
 const other={...row('coins',2),stock_total:1,drafts:1};
 expect(current).toMatchObject({inventory:250,stock:22,drafts:8,live:206,liveItems:206,sold:14,archived:0});
 expect(sumCommandModules([coins,historical,other])).toMatchObject({inventory:460,live:406,liveItems:405});
});
test('canonical workspace totals retain unclassified history without adding other workspaces', () => {
 const snapshot={scope:'tenant',modules:[coins],unclassifiedInventory:8,canonicalCounts:{...counts,total:258,units:258,stock:30}} as CommandSnapshot;
 expect(commandSnapshotTotals(snapshot,[coins])).toMatchObject({inventory:258,stock:30,live:206});
 expect(commandSnapshotTotals({...snapshot,canonicalCounts:counts},[coins])).toBeNull();
 expect(commandSnapshotTotals({...snapshot,canonicalCounts:{...counts,total:460,units:460,stock:232}},[coins])).toBeNull();
});
test('scope labels distinguish all-workspace records from one seller and include workspace identity', () => {
 expect(commandScopeLabel(true,'Store','tenant-a')).toContain('All workspaces');
 expect(commandScopeLabel(false,'Store','tenant-a')).toContain('tenant-a');
 expect(commandScopeLabel(false,'Store','tenant-a')).toContain('this workspace only');
 expect(commandScopeLabel(false,'Store',null)).toBe('Workspace not verified');
});
test('Hub uses canonical live listing and draft item counts, not total saved relationship rows', () => {
 expect(parseNicheListingMetrics(metrics())).toEqual({activeListings:206,draftListings:8,endedListings:0,totalListings:230});
 const twoListings={inventory_counts:{total:1,units:5,stock:0,draft:0,live:1,sold:0,archived:0,live_listings:2},total_listings:4,ended_listings:1};
 expect(parseNicheListingMetrics(twoListings)).toMatchObject({activeListings:2,draftListings:0});
 for(const value of [null,{}, {...metrics(),total_listings:205}, {...metrics(),ended_listings:-1}, {...metrics(),total_listings:1.5}]) expect(()=>parseNicheListingMetrics(value)).toThrow();
});
test.each(PRODUCTION_NICHE_IDS)('%s exact listing RPC is bound to the current workspace/niche (mocked)', async nicheId => {
 const abortSignal=jest.fn().mockResolvedValue({data:metrics(),error:null});const rpc=jest.fn().mockReturnValue({abortSignal});
 (getSupabaseClient as jest.Mock).mockReturnValue({rpc});
 expect(await readNicheListingMetrics('workspace-a',nicheId)).toMatchObject({activeListings:206,draftListings:8});
 expect(rpc).toHaveBeenCalledWith('swish_niche_listing_metrics',{p_tenant_id:'workspace-a',p_niche_id:nicheId});
});
test('invalid scope never dispatches a count request',async()=>{
 const rpc=jest.fn();(getSupabaseClient as jest.Mock).mockReturnValue({rpc});
 await expect(readNicheListingMetrics('','coins')).rejects.toThrow();
 await expect(readNicheListingMetrics('workspace-a','unregistered')).rejects.toThrow();expect(rpc).not.toHaveBeenCalled();
});
test('tenant snapshots reject platform scope, negative/fractional counts and multiplied draft rows',()=>{
 const value={scope:'tenant',verifiedOwner:true,tenantId:'workspace-a',checkedAt:'2026-11-08T21:45:00Z',currencies:['GBP'],activity:[],limitations:[],modules:[coins]};
 expect(validateCommandSnapshot(value,false,'workspace-a')).toBe(true);
 expect(validateCommandSnapshot(value,false,'workspace-b')).toBe(false);
 for(const bad of [{stock_total:-1},{drafts:8.5},{drafts:40}])expect(validateCommandSnapshot({...value,modules:[{...coins,...bad}]},false,'workspace-a')).toBe(false);
});
test('shared report defaults to workspace and resets/refetches on scope changes and page entry',()=>{
 const hook=fs.readFileSync('hooks/useCommandCentre.ts','utf8'),ui=fs.readFileSync('components/feature/CommandPortfolio.tsx','utf8'),hub=fs.readFileSync('app/ebay-hub.tsx','utf8');
 expect(hook).toContain("scope: 'workspace'");expect(hook).toContain('resolveCommandReportScope');expect(hook).toContain('useFocusEffect');expect(hook).toContain('app.inventoryReloadSignal');expect(hook).toContain('state.key === key');expect(hook).not.toContain('setInterval(');
 for(const label of ['My workspace','All workspaces','Live inventory items:','this workspace only'])expect(ui+fs.readFileSync('services/commandScopeService.ts','utf8')).toContain(label);
 expect(hub).toContain('readNicheListingMetrics(tenantId, nicheId)');expect(hub).not.toContain("listingRows.filter(l => l.status === 'active')");
});
test('new SQL is invoker RLS, reuses the canonical count RPC and never mutates historical identities',()=>{
 const sql=fs.readFileSync('supabase/migrations/20261122_niche_listing_metrics.sql','utf8');
 for(const token of ['security invoker','swish_inventory_tab_counts(p_tenant_id,p_niche_id)','swish_inventory_listing_rows','l.tenant_id=p_tenant_id','swish_specialist_niche(i.specialist_id)=p_niche_id','from public,anon'])expect(sql).toContain(token);
 expect(sql).not.toMatch(/delete from|update public|insert into|drop table|alter policy/i);
});
