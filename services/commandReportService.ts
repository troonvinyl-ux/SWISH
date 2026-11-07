// Presentation and validation for the existing consolidated command snapshot. No API calls.
import { PRODUCTION_NICHE_IDS, isProductionNiche, type ProductionNicheId } from '@/constants/niches';
export interface CommandOperationalRow {
 id:ProductionNicheId;ready:number|null;readiness_assessed:number;unpublished:number;issues:number;sales_today:number;
 photo_failures:number;publication_failures:number;missing_specifics:number|null;low_confidence:number;sync_discrepancies:number;duplicate_items:number;
}
export interface CommandOperations {
 version:'minority-text-v1';niches:CommandOperationalRow[];
 totals:{ready:number|null;readinessAssessed:number;unpublished:number;issues:number;salesToday:number};
 performance:{windowDays:number;attempts:number;confirmed:number;durationSamples:number;publicationSuccessPct:number|null;averageCaptureToLiveMs:number|null};
}
export type CommandPriorityKey='ready'|'photo_failures'|'publication_failures'|'missing_specifics'|'low_confidence'|'sync_discrepancies'|'duplicate_items';
export interface CommandPriority {key:CommandPriorityKey;label:string;count:number|null;action:'inventory'|'listings'|'review';note:string}
const integer=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;
const nullableInteger=(value:unknown)=>value===null||integer(value);
const amount=(value:unknown)=>typeof value==='number'&&Number.isFinite(value);
export function validateCommandOperations(value:unknown):value is CommandOperations {
 if(!value||typeof value!=='object')return false;const report=value as CommandOperations;
 if(report.version!=='minority-text-v1'||!Array.isArray(report.niches)||!report.totals||!report.performance)return false;
 const ids=new Set<string>();
 if(!report.niches.every(row=>{if(!isProductionNiche(row.id)||ids.has(row.id))return false;ids.add(row.id);return nullableInteger(row.ready)&&nullableInteger(row.missing_specifics)&&amount(row.sales_today)&&['readiness_assessed','unpublished','issues','photo_failures','publication_failures','low_confidence','sync_discrepancies','duplicate_items'].every(key=>integer((row as unknown as Record<string,unknown>)[key]));}))return false;
 const t=report.totals,p=report.performance;
 if(!report.niches.every(row=>row.readiness_assessed<=row.unpublished&&(row.ready===null||row.ready<=row.readiness_assessed)&&(row.missing_specifics===null||row.missing_specifics<=row.readiness_assessed)))return false;
 if(p.attempts===0&&p.publicationSuccessPct!==null||p.durationSamples===0&&p.averageCaptureToLiveMs!==null)return false;
 if(p.attempts>0&&(p.publicationSuccessPct===null||Math.abs(p.publicationSuccessPct-Math.round(p.confirmed*10000/p.attempts)/100)>0.01))return false;
 return nullableInteger(t.ready)&&integer(t.readinessAssessed)&&integer(t.unpublished)&&integer(t.issues)&&amount(t.salesToday)
  &&integer(p.windowDays)&&integer(p.attempts)&&integer(p.confirmed)&&p.confirmed<=p.attempts&&integer(p.durationSamples)&&p.durationSamples<=p.confirmed
  &&(p.publicationSuccessPct===null||amount(p.publicationSuccessPct)&&p.publicationSuccessPct>=0&&p.publicationSuccessPct<=100)
  &&(p.averageCaptureToLiveMs===null||amount(p.averageCaptureToLiveMs)&&p.averageCaptureToLiveMs>=0);
}
export function commandPriorityRows(operations:CommandOperations|null|undefined):CommandPriority[]{
 const sum=(key:CommandPriorityKey):number|null=>!operations?null:operations.niches.some(row=>row[key]===null)?null:operations.niches.reduce((total,row)=>total+(row[key]??0),0);
 return [
  {key:'ready',label:'Ready, awaiting publication',count:sum('ready'),action:'listings',note:'Current shared preflight checkpoints (15-minute validity), unchanged item/draft versions and saved seller policies. Publication still requires approval and live checks.'},
  {key:'photo_failures',label:'Photo uploads to retry',count:sum('photo_failures'),action:'inventory',note:'Canonical photo pipeline explicitly records retry_required. Open the saved item; keep originals and retry its photographs.'},
  {key:'publication_failures',label:'Failed eBay publication',count:sum('publication_failures'),action:'listings',note:'Saved eBay drafts marked failed with no external listing ID. Inspect the existing listing before retrying; never resubmit an uncertain outcome.'},
  {key:'missing_specifics',label:'Missing required specifics',count:sum('missing_specifics'),action:'listings',note:'Recorded failures from current shared category-specific preflight, not inferred from optional blank fields.'},
  {key:'low_confidence',label:'Low-confidence identity',count:sum('low_confidence'),action:'review',note:'Recorded identification confidence below 50%, excluding items with an unknown identification source. This is a review threshold, not independently measured accuracy.'},
  {key:'sync_discrepancies',label:'Inventory / eBay mismatch',count:sum('sync_discrepancies'),action:'inventory',note:'Persisted item status differs from its canonical listing state. Check existing inventory and synchronise; do not create replacement items.'},
  {key:'duplicate_items',label:'Duplicate identities to review',count:sum('duplicate_items'),action:'inventory',note:'Distinct canonical records sharing a tenant-scoped inventory, capture or eBay identity, or duplicate eBay listing rows. Nothing is merged or deleted.'},
 ];
}
export function commandReportLayout(windowWidth:number){
 const width=Number.isFinite(windowWidth)&&windowWidth>0?windowWidth:375;
 const contentWidth=Math.max(1,Math.min(960,width)-32);const wide=contentWidth>=880;
 return {wide,contentWidth,tableWidth:wide?Math.max(568,Math.floor(contentWidth*0.64)):Math.max(568,contentWidth),nicheWidth:120};
}
export function formatCommandCount(value:number|null|undefined){return value==null?'—':new Intl.NumberFormat('en-GB',{maximumFractionDigits:0}).format(value);}
export function formatCommandDuration(value:number|null|undefined){if(value==null||!Number.isFinite(value))return '—';return value<60000?`${(value/1000).toFixed(1)} s`:`${(value/60000).toFixed(1)} min`;}
export function registeredCommandRows<T extends {id:ProductionNicheId}>(rows:readonly T[]){const byId=new Map(rows.map(row=>[row.id,row]));return PRODUCTION_NICHE_IDS.map(id=>({id,row:byId.get(id)}));}
