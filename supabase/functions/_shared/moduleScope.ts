import { createClient } from 'npm:@supabase/supabase-js@2';
import registry from './niche-modules.json' with { type: 'json' };
import { corsHeaders } from './cors.ts';
import { normalizeIdentifySpecialist } from './identifySpecialistCompatibility.ts';
import { moduleRequestAliasIssue, MODULE_RESOURCE_ALIASES } from './moduleRequestContract.ts';
import { nicheBarcodeAllowed } from './nichePolicy.ts';
import { withEdgeFunctionLogging, isEdgeFunctionLogged } from './edgeFunctionLogging.ts';
type Handler = (request: Request) => Response | Promise<Response>;
const json = (message: string, status: number) => new Response(JSON.stringify({ error: message }), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ownerRoutes = new Set(['get_api_usage','sync_categories','rebuild_cache','diagnostics','get_funds_summary','get_payouts']);
export function serveModule(handler: Handler) {
 const scoped=withModuleScope(handler);
 Deno.serve(request=>{
  // Retain already-instrumented listing/status handlers without double counting.
  if(isEdgeFunctionLogged(handler))return scoped(request);
  const name=new URL(request.url).pathname.split('/').pop()??'module';
  return withEdgeFunctionLogging(name,scoped)(request);
 });
}
export function withModuleScope(handler: Handler): Handler {
 return async request => {
  if(request.method==='OPTIONS') return new Response(null,{headers:corsHeaders});
  if(request.method!=='POST') return handler(request);
  try {
   const authorization=request.headers.get('Authorization') ?? '';
   if(!authorization.startsWith('Bearer ')) return json('Authentication required.',401);
   const client=createClient(Deno.env.get('SUPABASE_URL') ?? '',Deno.env.get('SUPABASE_ANON_KEY') ?? '',{global:{headers:{Authorization:authorization}},auth:{persistSession:false}});
   const {data:{user},error:authError}=await client.auth.getUser(authorization.slice(7));
   if(authError || !user) return json('Session verification failed.',401);
   const body=await request.clone().json();
   if(!body || typeof body!=='object' || Array.isArray(body)) return json('Request must be an object.',400);
   if(ownerRoutes.has(body.route) || body.preserveInventoryStatus===true) {
    const role=await client.rpc('swish_is_platform_owner');
    if(role.error || role.data!==true) return json('Trusted platform owner required.',403);
   }
   const current=await client.rpc('swish_current_module');
   if(current.error) return json('Module authorization unavailable.',503);
   const scope=current.data;
   if(!scope) return json('Open an entitled module in the unified SWISH shell before using this operation.',403);
   // An omitted tenant is filled from trusted session state (e.g. image preparation), never a client guess.
   const tenant=body.tenantId ?? body.tenant_id ?? scope.tenant_id;
   if(tenant!==scope.tenant_id || (body.tenantId && body.tenant_id && body.tenantId!==body.tenant_id)) return json('Account differs from the active module.',403);
   const nicheId=scope.niche_id;
   if(!nicheId || !Object.hasOwn(registry.products,nicheId)) return json('Open an entitled specialist before using this operation.',403);
   const product=(registry.products as Record<string,{specialists:string[];legacySpecialists:string[];defaultSpecialist:string}>)[nicheId];
   const specialists=[...new Set([...product.specialists,...product.legacySpecialists])];
   for(const value of [body.nicheId,body.niche_id]) if(value!=null && value!==nicheId)return json('Niche differs from the authorized module.',403);
   // Compatibility for the incorrect specialist sent by older Collectibles Quick
   // List clients. Scope comes exclusively from swish_current_module, not the body.
   const operation=new URL(request.url).pathname.split('/').pop() ?? '';
   const requestedSpecialistId=normalizeIdentifySpecialist(nicheId,operation,body.specialistId);
   const requestedSpecialistAlias=normalizeIdentifySpecialist(nicheId,operation,body.specialist_id);
   const aliasIssue=moduleRequestAliasIssue({...body,specialistId:requestedSpecialistId,specialist_id:requestedSpecialistAlias});
   if(aliasIssue)return json(aliasIssue,403);
   if(body.route==='barcode_lookup'&&!nicheBarcodeAllowed(nicheId))return json('Retail barcode lookup is not enabled for this specialist. Use photographic identification.',403);
   for(const value of [requestedSpecialistId,requestedSpecialistAlias])if(value!=null && (typeof value!=='string'||!specialists.includes(value)))return json('Specialist belongs to another module.',403);
   if(body.specialistIds && (!Array.isArray(body.specialistIds) || body.specialistIds.some((id:unknown)=>typeof id!=='string'||!specialists.includes(id))))return json('Invalid specialist scope.',403);
   const allowed=await client.rpc('swish_can_access_niche',{p_tenant_id:tenant,p_niche_id:nicheId});
   if(allowed.error || allowed.data!==true)return json('Active module entitlement could not be verified.',403);
   const resources:[string,unknown][]=MODULE_RESOURCE_ALIASES.map(([table,left,right])=>[table,body[left]??body[right]]);
   for(const [table,id] of resources){
    if(id==null)continue;
    if(typeof id!=='string'||!uuid.test(id))return json('Valid internal resource identity required.',400);
    const result=await client.from(table).select('id').eq('tenant_id',tenant).eq('id',id).maybeSingle();
    if(result.error||!result.data)return json('Resource is not in the active account and niche.',403);
   }
   const itemIds=body.itemIds??body.item_ids,listingIds=body.listingIds??body.listing_ids;
   for(const [table,ids] of [['items',body.route==='fetch_item_images'?undefined:itemIds],['listings',listingIds]] as [string,unknown][]){
    if(ids===undefined)continue;
    if(!Array.isArray(ids)||ids.length>500||ids.some(id=>typeof id!=='string'||!uuid.test(id)))return json('Invalid resource set.',400);
    if(ids.length){const result=await client.from(table).select('id').eq('tenant_id',tenant).in('id',[...new Set(ids)]);if(result.error||result.data?.length!==new Set(ids).size)return json('Resource set crosses module boundaries.',403);}
   }
   if(body.route==='fetch_item_images'){
    if(!Array.isArray(itemIds)||itemIds.length>200||itemIds.some((id:unknown)=>typeof id!=='string'||!/^\d+$/.test(id)))return json('Valid external item IDs required.',400);
    const linked=await client.from('listings').select('external_listing_id').eq('tenant_id',tenant).in('external_listing_id',itemIds);
    if(linked.error||new Set(linked.data?.map(row=>row.external_listing_id)).size!==new Set(itemIds).size)return json('External items are not linked to this module.',403);
   }
   // Music listing creation and eBay operations are independent of the Discogs
   // agreement flag during the owner's free rollout. A catalogue source ID is
   // provenance, not an authorization denial. Keep every account, module and
   // resource check above; handler-level review, original-photo and eBay checks
   // still apply. This does not record Discogs approval or enable paid checkout.
   const resourceAliases=Object.fromEntries(MODULE_RESOURCE_ALIASES.flatMap(([,left,right])=>body[left]!=null||body[right]!=null?[[left,body[left]??body[right]],[right,body[left]??body[right]]]:[]));
   const scoped={...body,...resourceAliases,...(itemIds!=null?{itemIds,item_ids:itemIds}:{}),...(listingIds!=null?{listingIds,listing_ids:listingIds}:{}),tenantId:tenant,tenant_id:tenant,nicheId,niche_id:nicheId,specialistIds:specialists,specialistId:requestedSpecialistId ?? requestedSpecialistAlias ?? product.defaultSpecialist,...(body.specialist_id!=null?{specialist_id:requestedSpecialistAlias}: {})};
   const headers=new Headers(request.headers);headers.set('Content-Type','application/json');headers.delete('Content-Length');
   return handler(new Request(request.url,{method:request.method,headers,body:JSON.stringify(scoped)}));
  }catch{console.error('[SWISH module scope] Authorization failed; no request payload logged.');return json('Module request could not be verified. Retry.',503);}
 };
}
