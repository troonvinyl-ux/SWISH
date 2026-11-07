// Record the existing preflight result, without issuing any extra provider/read requests.
// Reporting observations are not authorization grants and cannot bypass publication checks.
import { getSupabaseClient } from '@/template';
export interface CommandPreflightObservation {tenantId:string;listingId:string;itemId:string;nicheId:string;itemUpdatedAt:string;listingUpdatedAt:string;ready:boolean;issue:string|null}
export function recordCommandPreflight(input:CommandPreflightObservation):void{
 if(!input.itemUpdatedAt||!input.listingUpdatedAt)return;
 // Best-effort asynchronous reporting: never put an extra network write on the publication critical path.
 void (async()=>{try{const {error}=await getSupabaseClient().from('commercial_events').insert({tenant_id:input.tenantId,event_type:'listing_preflight',entity_type:'listing',entity_id:input.listingId,data:{source:'shared_specialist_preflight',nicheId:input.nicheId,itemId:input.itemId,itemUpdatedAt:input.itemUpdatedAt,listingUpdatedAt:input.listingUpdatedAt,ready:input.ready,issue:input.issue},model_version:'minority-text-v1'});if(error)return;}
 catch{/* An unavailable observation must not turn a successful preflight into a failure. Reporting shows unassessed. */}})();
}
