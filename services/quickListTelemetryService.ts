import AsyncStorage from '@react-native-async-storage/async-storage';
import { getSupabaseClient } from '@/template';
import { quickListMetrics, type QuickTiming } from '@/shared/quickList';
// Earliest Expo JS initialization / foreground. This is not native process startup.
let openedAt=Date.now();
export function markQuickListAppOpened(){openedAt=Date.now();}
export function getQuickListOpenedAt(){return openedAt;}
const retained=new Map<string,Promise<void>>();
export function retainQuickTiming(scope:string,timing:QuickTiming){const pending=(retained.get(scope)??Promise.resolve()).catch(()=>{}).then(()=>AsyncStorage.setItem(`@swish_quick_timing:${scope}`,JSON.stringify(timing)));retained.set(scope,pending);void pending.finally(()=>{if(retained.get(scope)===pending)retained.delete(scope);}).catch(()=>{});return pending;}
const writes=new Map<string,Promise<{error:string|null}>>();
export function recordQuickTiming(tenantId:string,timing:QuickTiming):Promise<{error:string|null}>{
 // Serialize milestone snapshots so an earlier slow INSERT cannot outrank the final outcome.
 // Only explicit milestones call this function, not every render/action/clock tick.
 const key=`${tenantId}:${timing.id}`,snapshot=JSON.parse(JSON.stringify(timing)) as QuickTiming;
 const pending=(writes.get(key)??Promise.resolve({error:null})).catch(()=>({error:null})).then(async()=>{
  try{const {error}=await getSupabaseClient().from('commercial_events').insert({tenant_id:tenantId,event_type:'quick_list_timing',entity_type:'quick_list',entity_id:snapshot.id,data:snapshot,model_version:'quick-list-v2'});return {error:error?.message??null};}
  catch{return {error:'Timing checkpoint could not be uploaded; retained locally.'};}
 });writes.set(key,pending);void pending.finally(()=>{if(writes.get(key)===pending)writes.delete(key);}).catch(()=>{});return pending;
}
export async function readQuickListMetrics(tenantId:string,nicheId:string){
 const client=getSupabaseClient(),rows:any[]=[];let truncated=false;
 for(let offset=0;offset<5000;offset+=200){const result=await client.from('commercial_events').select('event_type,entity_id,data,created_at').eq('tenant_id',tenantId).eq('entity_type','quick_list').in('event_type',['quick_list_timing','quick_list_live_confirmation']).eq('data->>nicheId',nicheId).order('created_at',{ascending:false}).order('id',{ascending:false}).range(offset,offset+199);if(result.error)return {metrics:null,error:result.error.message};rows.push(...(result.data??[]));if((result.data?.length??0)<200)break;if(offset===4800)truncated=true;}
 const confirmed=new Map(rows.filter(row=>row.event_type==='quick_list_live_confirmation').map(row=>[row.entity_id,row.data.externalListingId]));
 const sessions=new Map<string,QuickTiming>();
 for(const row of rows)if(row.event_type==='quick_list_timing'&&!sessions.has(row.entity_id)){const timing=row.data as QuickTiming;if(!timing?.timestamps||!Number.isFinite(timing.actions))continue;sessions.set(row.entity_id,{...timing,outcome:timing.outcome==='live'&&confirmed.get(row.entity_id)!==timing.externalListingId?'unconfirmed':timing.outcome});}
 return {metrics:{...quickListMetrics([...sessions.values()]),truncated,measurementWindow:'Latest 5,000 timing/evidence events for this tenant and niche; historical sessions may lack new stages.'},error:null};
}
