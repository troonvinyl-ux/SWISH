// Existing server-authorized account verification. No new auth system or local grants.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2';
import modules from '../_shared/niche-modules.json' with { type:'json' };
import { corsHeaders } from '../_shared/cors.ts';
import { refreshVerifiedNiches,nicheAccessResponse } from '../_shared/paidNicheAuthorization.ts';
import { LEGACY_PREMIUM_TIERS,SWISH_SUBSCRIPTION_PRODUCT } from '../_shared/nicheAuthorization.ts';
// Reuse the stateless service client in this isolate. No user's Authorization header is attached.
// supabase-js uses HTTP requests, not checked-out PostgreSQL connections.
const admin=createClient(Deno.env.get('SUPABASE_URL') ?? '',Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',{
  auth:{persistSession:false,autoRefreshToken:false},
  global:{fetch:(input,init)=>fetch(input,{...init,signal:init?.signal ?? AbortSignal.timeout(6000)})},
});
interface Verification { body:Record<string,unknown>;status:number }
const flights=new Map<string,Promise<Verification>>();
async function verify(user:{id:string;email?:string},requestedTenant:unknown):Promise<Verification> {
  let membershipQuery=admin.from('tenant_memberships').select('tenant_id,tenants!inner(subscription_tier)').eq('user_id',user.id);
  if(requestedTenant)membershipQuery=membershipQuery.eq('tenant_id',String(requestedTenant));
  const {data:memberships,error:membershipError}=await membershipQuery;
  if(membershipError)return {body:{error:'Account authorization temporarily unavailable'},status:503};
  if(requestedTenant&&!memberships?.length)return {body:{error:'Account access denied'},status:403};
  const {data:owner,error:ownerError}=await admin.rpc('swish_owner_for_user',{p_user_id:user.id});
  if(ownerError)return {body:{error:'Platform role temporarily unavailable'},status:503};
  const legacy=memberships?.some(row=>{
    const tenant=Array.isArray(row.tenants)?row.tenants[0]:row.tenants;
    return (LEGACY_PREMIUM_TIERS as readonly string[]).includes(tenant?.subscription_tier ?? '');
  }) ?? false;
  let niches:string[];
  let source=owner===true?'trusted_platform_owner':legacy?'tenant_tier':'verified_stripe';
  if(owner===true||legacy)niches=Object.keys(modules.products);
  else {
    // Reuse only a current server-verified billing snapshot; NEVER extend expires_at.
    // Recheck live Stripe near expiry so foreground verification stays reliable.
    const {data:checked,error:checkError}=await admin.from('niche_entitlement_checks').select('checked_at').eq('user_id',user.id).maybeSingle();
    if(checkError)return {body:{error:'Billing verification temporarily unavailable'},status:503};
    if(checked&&Date.now()-Date.parse(checked.checked_at)>=0&&Date.now()-Date.parse(checked.checked_at)<180000){
      const {data:grants,error:grantError}=await admin.from('niche_entitlements').select('niche_id').eq('user_id',user.id).gt('expires_at',new Date().toISOString());
      if(grantError)return {body:{error:'Entitlement verification temporarily unavailable'},status:503};
      niches=(grants??[]).map(row=>row.niche_id).filter(id=>Object.hasOwn(modules.products,id));
      source='verified_stripe_cache';
    } else niches=await refreshVerifiedNiches(admin,{id:user.id,email:user.email});
  }
  return {status:200,body:{subscribed:niches.length>0,product_id:niches.length?SWISH_SUBSCRIPTION_PRODUCT:null,
    price_id:legacy||!niches.length?null:'price_1UPAIlI5Y99su2PXUrM192qL',subscription_end:null,
    niche_entitlements:niches,is_platform_owner:owner===true,entitlement_source:source,
    verified_at:new Date().toISOString(),cache_max_age_seconds:300}};
}
Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response(null,{headers:corsHeaders});
  const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...corsHeaders,'Content-Type':'application/json'}});
  if(!['POST','GET'].includes(req.method))return json({error:'Method not allowed'},405);
  try {
    const auth=req.headers.get('Authorization');
    if(!auth?.startsWith('Bearer '))return json({error:'Authentication required'},401);
    const {data:{user},error}=await admin.auth.getUser(auth.slice(7));
    if(error){
      // Network/Auth service outages are not proof that a valid token has been revoked.
      const transient=!error.status||error.status>=500||error.name==='AuthRetryableFetchError';
      return json({error:transient?'Authentication service temporarily unavailable':'Invalid or expired authentication'},transient?503:401);
    }
    if(!user)return json({error:'Invalid or expired authentication'},401);
    const body=req.method==='POST'?await req.json().catch(()=>({})):{};
    if(body.tenantId&&typeof body.tenantId!=='string')return json({error:'Invalid tenant'},400);
    // Deduplication follows JWT verification; it never substitutes for authenticating a request.
    const key=JSON.stringify([user.id,body.tenantId??null]);
    let task=flights.get(key);
    if(!task){task=verify(user,body.tenantId);flights.set(key,task);}
    try {const result=await task;return json(result.body,result.status);}
    finally {if(flights.get(key)===task)flights.delete(key);}
  } catch(error:unknown){
    console.error('[swish-check-subscription] Verified entitlement refresh failed.');
    return nicheAccessResponse(error)??json({error:'Subscription status temporarily unavailable. Please retry.'},503);
  }
});
