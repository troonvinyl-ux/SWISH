import {FunctionsHttpError} from '@supabase/supabase-js';
import {resolveProductionNiche} from './nicheRouting';
import {invokeScopedSync} from './syncRequestService';
export async function runNicheEbayOperation(tenantId:string,nicheId:string,operation:'sync'|'token'|'images'):Promise<{data:any;error:string|null;requiresReauth:boolean}> {
 const niche=resolveProductionNiche(nicheId);
 if(!tenantId||!niche)return {data:null,error:'Open a verified specialist workspace before syncing.',requiresReauth:false};
 try{
  const endpoint=operation==='images'?'swish-image-download':'swish-ebay-sync';
  const body=operation==='images'?{tenantId,nicheId:niche,fixTitles:false}:{tenantId,nicheId:niche,mode:operation==='token'?'refresh_token_only':'full'};
  const {data,error}=await invokeScopedSync(endpoint,body,operation==='token'?30000:105000);
  let payload=data;
  if(error){
   let detail=error.message;
   if(error instanceof FunctionsHttpError){try{const text=await error.context.text();payload=JSON.parse(text);detail=String(payload?.error??payload?.message??detail);}catch{payload=null;}}
   return {data:payload,error:String(payload?.error??detail??'eBay request did not complete. Existing inventory is preserved; check the saved operation before retrying.'),requiresReauth:payload?.requiresReauth===true};
  }
  if(payload?.success!==true)return {data:payload,error:payload?.error??`eBay ${operation} was not confirmed${payload?.failed?`; ${payload.failed} records need attention`:''}.`,requiresReauth:payload?.requiresReauth===true};
  return {data:payload,error:null,requiresReauth:false};
 }catch(cause){return {data:null,error:cause instanceof Error?cause.message:'eBay connection unavailable. Existing inventory is preserved.',requiresReauth:false};}
}
