import { getSupabaseClient } from '@/template';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { resolveProductionNiche } from './nicheRouting';
export async function runNicheEbayOperation(tenantId:string,nicheId:string,operation:'sync'|'token'|'images'):Promise<{data:any;error:string|null;requiresReauth:boolean}> {
  const niche=resolveProductionNiche(nicheId);
  if(!tenantId||!niche)return {data:null,error:'Open a verified specialist workspace before syncing.',requiresReauth:false};
  try{
    const endpoint=operation==='images'?'swish-image-download':'swish-ebay-sync';
    const body=operation==='images'?{tenantId,nicheId:niche,fixTitles:false}:{tenantId,nicheId:niche,mode:operation==='token'?'refresh_token_only':'full'};
    const {data,error}=await getSupabaseClient().functions.invoke(endpoint,{body});
    let payload=data;
    if(error){
      if(error instanceof FunctionsHttpError){try{payload=JSON.parse(await error.context.text());}catch{payload=null;}}
      return {data:payload,error:String(payload?.error??'eBay request did not complete. Existing inventory is preserved; retry after checking your connection.'),requiresReauth:payload?.requiresReauth===true};
    }
    if(payload?.success!==true)return {data:payload,error:payload?.error??`eBay ${operation} was not confirmed${payload?.failed?`; ${payload.failed} records need attention`:''}.`,requiresReauth:payload?.requiresReauth===true};
    return {data:payload,error:null,requiresReauth:false};
  }catch{return {data:null,error:'eBay connection unavailable. Existing inventory is preserved.',requiresReauth:false};}
}
