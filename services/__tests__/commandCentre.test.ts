import fs from 'node:fs';
import path from 'node:path';
import registry from '@/niche-modules.json';
import { formatCommandMoney, sumCommandModules, validateCommandSnapshot, type CommandModule } from '@/services/commandCentreService';
import { assessReadiness } from '@/services/readinessAssessmentService';
import { createProductionSnapshot } from '@/services/productionControlService';
import { membershipDestination } from '@/services/moduleAccessService';
import type { TaskAcceptance } from '@/services/readinessAssessmentService';
import type { ProductionTask } from '@/services/productionControlEvidence';
// Pure contracts must never initialise native auth/browser/payment modules in Node.
jest.mock('@/template',()=>({getSupabaseClient:jest.fn()}));
jest.mock('@/services/subscriptionService',()=>({checkSubscription:jest.fn()}));
const source=(file:string)=>fs.readFileSync(path.resolve(__dirname,'../..',file),'utf8');
const sha='a'.repeat(40);
const moduleRow=(id:'coins'|'clothing',listed:number,sales:number)=>({id,inventory:2,stock_total:0,inventory_units:2,sold_total:1,review:0,listed_inventory:1,live:1,drafts:1,listed_value:listed,sold_week:1,sales_week:sales,sales_month:sales,realised_total:sales,completed_sales:1,duplicate_sales:0,outstanding:1,ebay_status:'unknown',ai_status:'unknown',last_sync:null,ai_checked_at:null} as CommandModule);

describe('Command centre data and routing contracts',()=>{
 test('single-niche direct entry and multi/owner portfolio beat restored niche',()=>{
  expect(membershipDestination(['coins'],false,'coins')).toBe('/(tabs)');
  expect(membershipDestination(['coins','clothing'],false,'coins')).toBe('/swish');
  expect(membershipDestination(['coins'],true,'coins')).toBe('/swish');
 });
 test('listed asking value never contributes to realised revenue',()=>{
  const result=sumCommandModules([moduleRow('coins',1000,35),moduleRow('clothing',2000,50)]);
  expect(result.listed).toBe(3000);expect(result.weekly).toBe(85);
 });
 test('mixed and unknown currencies cannot be labelled GBP',()=>{
  expect(formatCommandMoney(35,['GBP'])).toBe('£35.00');
  expect(formatCommandMoney(35,['GBP','USD'])).toBe('Unavailable');
  expect(formatCommandMoney(35,['UNKNOWN'])).toBe('Unavailable');
 });
 test('response validation rejects platform data for tenant scope and incomplete owner portfolios',()=>{
  const value={scope:'platform',verifiedOwner:true,tenantId:null,checkedAt:'2026-11-01',currencies:['GBP'],activity:[],limitations:[],modules:[moduleRow('coins',35,0)]};
  expect(validateCommandSnapshot(value,false,'tenant-a')).toBe(false);
  expect(validateCommandSnapshot(value,true,null)).toBe(false);
 });
 test('reporting migration explicitly checks caller, owner, membership and cached entitlements',()=>{
  const sql=source('supabase/migrations/20261105_command_snapshot.sql');
  for(const text of ['auth.uid() is null','swish_is_platform_owner()','p_platform and not v_owner','Tenant membership required','niche_entitlements','expires_at>now()','revoke all','to authenticated'])expect(sql).toContain(text);
  const extension=source('supabase/migrations/20261106_tunes_registration.sql');
  for(const id of Object.keys(registry.products))expect(sql+extension).toContain(`'${id}'`);
  expect(sql).not.toMatch(/alter table|create table|update public|delete from/i);
  expect(sql).toContain("at time zone 'Europe/London'");expect(sql).toContain('row_number() over');expect(sql).toContain("'partially_refunded'");
 });
 test('admin components do not directly query data or use email as owner authority',()=>{
  for(const file of ['components/feature/CommandPortfolio.tsx','components/feature/AdminInspectionPanel.tsx','components/feature/ReadinessAuditPanel.tsx','app/master-admin.tsx']){
   expect(source(file)).not.toContain('getSupabaseClient');expect(source(file)).not.toContain('isSwishMasterAdmin(');
  }
  expect(source('app/master-admin.tsx')).toContain('useOwnerAuthorization');expect(source('app/production-control.tsx')).toContain('ReadinessAuditPanel');
 });
 test('transient caching cannot retain an unverified permission result',()=>{
  const service=source('services/commandCentreService.ts');const hook=source('hooks/useCommandCentre.ts');
  expect(service).toContain('retryable: temporary');expect(hook).toContain('result.retryable && previous.key === key');
  expect(service).toContain('command-inspection:${section}:${nicheId');
 });
});
describe('Full programme acceptance is not inferred from implementation or limited probes',()=>{
 test('historical VERIFIED labels are not current-source passes',()=>{
  const snapshot=createProductionSnapshot();snapshot.source='LIVE';snapshot.mainSha=sha;
  const assessment=assessReadiness(snapshot);
  expect(assessment.tasks).toHaveLength(34);expect(assessment.verified).toBe(0);expect(assessment.percentage).toBe(0);expect(assessment.verdict).not.toBe('READY');
 });
 test.each(['S1','S2','S3','S4','S5','S6','S7'])('%s retains original workstream/task IDs and actionable metadata',id=>{
  const stage=assessReadiness(createProductionSnapshot()).stages.find(row=>row.id===id)!;
  expect(stage.tasks.length).toBeGreaterThan(0);expect(stage.tasks.every(task=>task.id.startsWith(id+'-'))).toBe(true);
  expect(stage.tasks.every(task=>task.verificationMethod && task.priority && task.plan.components.length)).toBe(true);
 });
 test('PASS requires complete criteria, method, date, evidence and matching live main',()=>{
  const snapshot=createProductionSnapshot();snapshot.source='LIVE';snapshot.mainSha=sha;
  snapshot.register=JSON.parse(JSON.stringify(snapshot.register));
  const task=snapshot.register!.stages[0].tasks[0] as ProductionTask & {acceptance?:TaskAcceptance};
  task.acceptance={commitSha:sha,checkedAt:'2026-10-01T10:00:00Z',result:'PASS',method:'Approved full task acceptance',evidence:'https://github.com/troonvinyl-ux/SWISH/actions/runs/123',criteriaPassed:false};
  expect(assessReadiness(snapshot).verified).toBe(0);
  task.acceptance.criteriaPassed=true;expect(assessReadiness(snapshot).verified).toBe(1);
  snapshot.source='CACHED';expect(assessReadiness(snapshot).verified).toBe(0);
  task.acceptance.commitSha='b'.repeat(40);snapshot.source='LIVE';expect(assessReadiness(snapshot).verified).toBe(0);
 });
 test('safe runner queries actual reporting but records full task acceptance as blocked',()=>{
  const server=source('supabase/functions/swish-verification/index.ts');
  expect(server).toContain("action === 'programme'");expect(server).toContain("rpc('swish_command_snapshot'");
  expect(server).toContain('READINESS:${task.id}:${sourceSha}');expect(server).toContain("'BLOCKED'");expect(server).not.toContain('execSync');
 });
});
