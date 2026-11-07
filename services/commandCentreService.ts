import { getSupabaseClient } from '@/template';
import { backendRead, shareBackendRequest } from './backendRequestService';
import { isBackendUnavailable } from './backendAvailabilityService';
import { parseCanonicalCounts } from './canonicalInventoryService';
import { validateCommandOperations, type CommandOperations } from './commandReportService';
import { PRODUCTION_NICHE_IDS, isProductionNiche, type ProductionNicheId } from '@/constants/niches';
export type RecordedHealth = 'recorded_success' | 'attention' | 'failed' | 'unknown' | 'not_connected';
export interface CommandModule {
 id:ProductionNicheId;inventory:number;stock_total:number;inventory_units:number;sold_total:number;review:number;listed_inventory:number;
 live:number;drafts:number;listed_value:number;sold_week:number;sales_week:number;sales_month:number;realised_total:number;completed_sales:number;duplicate_sales:number;
 outstanding:number;ebay_status:RecordedHealth;ai_status:RecordedHealth;last_sync:string|null;ai_checked_at:string|null;
}
export interface CommandSnapshot {
 verifiedOwner:boolean;scope:'platform'|'tenant';tenantId:string|null;checkedAt:string;weekStart:string;monthStart:string;timezone:string;currencies:string[];modules:CommandModule[];
 registeredUsers:number|null;activeSubscribers:number|null;subscriptionRevenue:null;canonicalCounts?:unknown;unclassifiedInventory?:number;operations?:CommandOperations;
 aiActivity:{identifications:number;valuations:number;failures:number};
 activity:{tenant_id:string;niche_id:string;function_name:string;outcome:string;status_code:number;created_at:string}[];limitations:string[];
}
export interface CommandReadResult {snapshot:CommandSnapshot|null;error:string|null;retryable:boolean}
export type AdminInspectionSection='users'|'memberships'|'inventory'|'audit'|'incidents'|'sync'|'configuration';
export interface AdminInspection {verifiedOwner:true;section:AdminInspectionSection;rows:Record<string,unknown>[];limit:number;checkedAt:string;readOnly:true}
export async function verifyPlatformOwner():Promise<{allowed:boolean;error:string|null}>{
 try{const {data,error}=await backendRead('command-owner',signal=>getSupabaseClient().rpc('swish_is_platform_owner').abortSignal(signal),'access');return {allowed:!error&&data===true,error:error?'Server owner verification is unavailable. Retry to verify your role.':null};}
 catch{return {allowed:false,error:'Owner verification connection failed. No access was granted.'};}
}
export function validateCommandSnapshot(value:unknown,platform:boolean,tenantId:string|null):value is CommandSnapshot{
 if(!value||typeof value!=='object')return false;const row=value as CommandSnapshot;
 if(row.scope!==(platform?'platform':'tenant')||(platform?row.verifiedOwner!==true:row.tenantId!==tenantId))return false;
 if(!Array.isArray(row.modules)||!Array.isArray(row.currencies)||!Array.isArray(row.activity)||!Array.isArray(row.limitations)||!Number.isFinite(Date.parse(row.checkedAt)))return false;
 if(platform&&(row.modules.length!==PRODUCTION_NICHE_IDS.length||!PRODUCTION_NICHE_IDS.every(id=>row.modules.some(module=>module.id===id))))return false;
 // Validate owner-wide history totals BEFORE the hook renders them. Invalid or
 // pre-migration contracts are errors, not inferred zero/partial inventory.
 if(platform){try{parseCanonicalCounts(row.canonicalCounts);}catch{return false;}}
 if(row.unclassifiedInventory!=null&&(!Number.isSafeInteger(row.unclassifiedInventory)||row.unclassifiedInventory<0))return false;
 if(row.operations!==undefined&&(!validateCommandOperations(row.operations)||row.operations.niches.length!==row.modules.length||row.modules.some(module=>!row.operations!.niches.some(niche=>niche.id===module.id))))return false;
 const ids=new Set<string>();
 return row.modules.every(module=>{
  if(!isProductionNiche(module.id)||ids.has(module.id))return false;ids.add(module.id);
  const fields=['inventory','stock_total','inventory_units','sold_total','review','listed_inventory','live','drafts','listed_value','sold_week','sales_week','sales_month','realised_total','completed_sales','duplicate_sales','outstanding'];
  return fields.every(field=>{const amount=(module as unknown as Record<string,unknown>)[field];return typeof amount==='number'&&Number.isFinite(amount);});
 });
}
/** Session + user + tenant + reporting mode isolate flights; no cross-scope result reuse. */
export async function loadCommandSnapshot(tenantId:string|null,platform:boolean,userId:string):Promise<CommandReadResult>{
 return shareBackendRequest(`command:${userId}:${tenantId??''}:${platform}`,async()=>{
  try{
   const {data,error}=await backendRead(`command-snapshot:${tenantId??''}:${platform}`,signal=>getSupabaseClient().rpc('swish_command_snapshot',{p_tenant_id:tenantId,p_platform:platform}).abortSignal(signal));
   if(error){const temporary=isBackendUnavailable(error.message);return {snapshot:null,error:temporary?'Canonical reporting is temporarily unavailable. The last successful snapshot is retained.':'Canonical reporting permission or data query was not confirmed.',retryable:temporary};}
   if(!validateCommandSnapshot(data,platform,tenantId))return {snapshot:null,error:'Reporting scope or data contract was not confirmed.',retryable:false};
   return {snapshot:data,error:null,retryable:false};
  }catch(cause){const temporary=isBackendUnavailable(cause instanceof Error?cause.message:'');return {snapshot:null,error:temporary?'Canonical reporting is temporarily unavailable. Retry when the backend responds.':'Reporting permission or session was not verified. Refresh access and retry.',retryable: temporary};}
 });
}
export async function loadAdminInspection(section:AdminInspectionSection,nicheId:ProductionNicheId|null):Promise<{inspection:AdminInspection|null;error:string|null}>{
 try{
  const {data,error}=await backendRead(`command-inspection:${section}:${nicheId??''}`,signal=>getSupabaseClient().rpc('swish_command_snapshot',{p_platform:true,p_section:section,p_niche_id:nicheId}).abortSignal(signal));
  if(error||data?.verifiedOwner!==true||data?.readOnly!==true||data?.section!==section||!Array.isArray(data.rows))return {inspection:null,error:'Owner-only inspection was not confirmed. Retry; no records were changed.'};
  return {inspection:data as AdminInspection,error:null};
 }catch{return {inspection:null,error:'Administrative inspection connection or authorization failed.'};}
}
export function sumCommandModules(modules:readonly CommandModule[]){
 return modules.reduce((sum,row)=>({inventory:sum.inventory+row.inventory,stock:sum.stock+row.stock_total,units:sum.units+row.inventory_units,completedSales:sum.completedSales+row.completed_sales,listed:sum.listed+row.listed_value,weekly:sum.weekly+row.sales_week,monthly:sum.monthly+row.sales_month,realised:sum.realised+row.realised_total,soldWeek:sum.soldWeek+row.sold_week,sold:sum.sold+row.sold_total,live:sum.live+row.live,drafts:sum.drafts+row.drafts,outstanding:sum.outstanding+row.outstanding,review:sum.review+row.review,duplicates:sum.duplicates+row.duplicate_sales}),{inventory:0,stock:0,units:0,completedSales:0,listed:0,weekly:0,monthly:0,realised:0,soldWeek:0,sold:0,live:0,drafts:0,outstanding:0,review:0,duplicates:0});
}
export function formatCommandMoney(value:number|null|undefined,currencies:readonly string[]){
 if(value==null||currencies.length!==1||!/^[A-Z]{3}$/.test(currencies[0])||currencies[0]==='UNKNOWN')return 'Unavailable';
 try{return new Intl.NumberFormat('en-GB',{style:'currency',currency:currencies[0],maximumFractionDigits:2}).format(value);}catch{return `${currencies[0]} ${value.toFixed(2)}`;}
}
