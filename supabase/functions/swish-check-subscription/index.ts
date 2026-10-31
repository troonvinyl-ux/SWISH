// Verified account-bound entitlements for all registered products; also refreshes the database RLS cache.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2';
import modules from '../_shared/niche-modules.json' with { type:'json' };
import { corsHeaders } from '../_shared/cors.ts';
import { refreshVerifiedNiches,nicheAccessResponse } from '../_shared/paidNicheAuthorization.ts';
import { LEGACY_PREMIUM_TIERS,SWISH_SUBSCRIPTION_PRODUCT } from '../_shared/nicheAuthorization.ts';
Deno.serve(async (req:Request)=>{
  if(req.method==='OPTIONS') return new Response(null,{ headers:corsHeaders });
  const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{ status,headers:{ ...corsHeaders,'Content-Type':'application/json' } });
  if(!['POST','GET'].includes(req.method)) return json({ error:'Method not allowed' },405);
  try {
    const admin=createClient(Deno.env.get('SUPABASE_URL') ?? '',Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',{ auth:{ persistSession:false } });
    const auth=req.headers.get('Authorization');
    if(!auth?.startsWith('Bearer ')) return json({ error:'Authentication required' },401);
    const { data:{ user },error }=await admin.auth.getUser(auth.slice(7));
    if(error || !user) return json({ error:'Invalid or expired authentication' },401);
    const { data:memberships,error:membershipError }=await admin.from('tenant_memberships').select('tenant_id,tenants!inner(subscription_tier)').eq('user_id',user.id);
    if(membershipError) return json({ error:'Account authorization unavailable' },503);
    const legacy=memberships?.some(row=>{
      const tenant=Array.isArray(row.tenants) ? row.tenants[0] : row.tenants;
      return (LEGACY_PREMIUM_TIERS as readonly string[]).includes(tenant?.subscription_tier ?? '');
    }) ?? false;
    // Existing lifetime/legacy tier access never depends on Stripe availability.
    const niches=legacy ? Object.keys(modules.products) : await refreshVerifiedNiches(admin,{ id:user.id,email:user.email });
    return json({ subscribed:niches.length>0,product_id:niches.length ? SWISH_SUBSCRIPTION_PRODUCT : null,
      price_id:legacy || !niches.length ? null : 'price_1UPAIlI5Y99su2PXUrM192qL',subscription_end:null,
      niche_entitlements:niches,entitlement_source:legacy ? 'tenant_tier' : 'verified_stripe',verified_at:new Date().toISOString(),cache_max_age_seconds:300 });
  } catch(error:unknown) {
    console.error('[swish-check-subscription] Verified entitlement refresh failed.');
    return nicheAccessResponse(error) ?? json({ error:'Subscription status could not be checked. Please retry.' },503);
  }
});
