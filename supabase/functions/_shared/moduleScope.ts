import { createClient } from 'npm:@supabase/supabase-js@2';
import registry from './niche-modules.json' with { type: 'json' };
import { corsHeaders } from './cors.ts';
type Handler = (request: Request) => Response | Promise<Response>;
const json = (message: string, status: number) => new Response(JSON.stringify({ error: message }), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ownerRoutes = new Set(['get_api_usage','sync_categories','rebuild_cache','diagnostics','get_funds_summary','get_payouts']);
export function serveModule(handler: Handler) { Deno.serve(withModuleScope(handler)); }
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
   for(const value of [body.specialistId,body.specialist_id])if(value!=null && !specialists.includes(value))return json('Specialist belongs to another module.',403);
   if(body.specialistIds && (!Array.isArray(body.specialistIds) || body.specialistIds.some((id:unknown)=>typeof id!=='string'||!specialists.includes(id))))return json('Invalid specialist scope.',403);
   const allowed=await client.rpc('swish_can_access_niche',{p_tenant_id:tenant,p_niche_id:nicheId});
   if(allowed.error || allowed.data!==true)return json('Active module entitlement could not be verified.',403);
   const resources:[string,unknown][]=[['items',body.itemId ?? body.item_id],['listings',body.listingId ?? body.listing_id],['orders',body.orderId ?? body.order_id],['ebay_messages',body.messageId]];
   for(const [table,id] of resources){
    if(id==null)continue;
    if(typeof id!=='string'||!uuid.test(id))return json('Valid internal resource identity required.',400);
    const result=await client.from(table).select('id').eq('tenant_id',tenant).eq('id',id).maybeSingle();
    if(result.error||!result.data)return json('Resource is not in the active account and niche.',403);
   }
   for(const [table,ids] of [['items',body.route==='fetch_item_images'?undefined:body.itemIds],['listings',body.listingIds]] as [string,unknown][]){
    if(ids===undefined)continue;
    if(!Array.isArray(ids)||ids.length>500||ids.some(id=>typeof id!=='string'||!uuid.test(id)))return json('Invalid resource set.',400);
    if(ids.length){const result=await client.from(table).select('id').eq('tenant_id',tenant).in('id',[...new Set(ids)]);if(result.error||result.data?.length!==new Set(ids).size)return json('Resource set crosses module boundaries.',403);}
   }
   if(body.route==='fetch_item_images'){
    if(!Array.isArray(body.itemIds)||body.itemIds.length>200||body.itemIds.some((id:unknown)=>typeof id!=='string'||!/^\d+$/.test(id)))return json('Valid external item IDs required.',400);
    const linked=await client.from('listings').select('external_listing_id').eq('tenant_id',tenant).in('external_listing_id',body.itemIds);
    if(linked.error||new Set(linked.data?.map(row=>row.external_listing_id)).size!==new Set(body.itemIds).size)return json('External items are not linked to this module.',403);
   }
   const scoped={...body,tenantId:tenant,tenant_id:tenant,nicheId,niche_id:nicheId,specialistIds:specialists,specialistId:body.specialistId ?? product.defaultSpecialist};
   const headers=new Headers(request.headers);headers.set('Content-Type','application/json');headers.delete('Content-Length');
   return handler(new Request(request.url,{method:request.method,headers,body:JSON.stringify(scoped)}));
  }catch{console.error('[SWISH module scope] Authorization failed; no request payload logged.');return json('Module request could not be verified. Retry.',503);}
 };
}
