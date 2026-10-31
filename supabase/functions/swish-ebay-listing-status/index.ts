// Bounded, authenticated status-only reconciliation. Never creates listings or guesses sale prices.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { decryptCredentials, encryptCredentials } from '../_shared/credentialCrypto.ts';
import { parseEbayListingStatus } from '../_shared/listingStatus.ts';
import registry from '../_shared/niche-modules.json' with { type: 'json' };
const response = (data: unknown, status=200) => new Response(JSON.stringify(data), {status,headers:{...corsHeaders,'Content-Type':'application/json'}});
Deno.serve(async req => {
  if(req.method==='OPTIONS') return new Response('ok',{headers:corsHeaders});
  if(req.method!=='POST') return response({error:'Method not allowed'},405);
  try {
    const body=await req.json();
    const products=registry.products as Record<string,{specialists:string[];legacySpecialists:string[]}>;
    if(!body || typeof body!=='object' || Array.isArray(body)) return response({error:'Invalid request'},400);
    const {tenantId,nicheId,listingIds}=body;
    const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if(typeof tenantId!=='string' || !uuid.test(tenantId) || typeof nicheId!=='string' || !Object.prototype.hasOwnProperty.call(products,nicheId)) return response({error:'Valid account and niche are required'},400);
    if(!Array.isArray(listingIds) || listingIds.length<1 || listingIds.length>12 || listingIds.some(id=>typeof id!=='string'||!uuid.test(id))) return response({error:'Provide between 1 and 12 listing IDs'},400);
    const authorization=req.headers.get('Authorization') ?? '';
    const token=authorization.replace(/^Bearer\s+/i,'').trim();
    if(!token) return response({error:'Authentication required'},401);
    const userClient=createClient(Deno.env.get('SUPABASE_URL')??'',Deno.env.get('SUPABASE_ANON_KEY')??'');
    const {data:{user},error:authError}=await userClient.auth.getUser(token);
    if(authError || !user) return response({error:'Sign in again to check eBay status'},401);
    const db=createClient(Deno.env.get('SUPABASE_URL')??'',Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??'');
    const {data:membership,error:memberError}=await db.from('tenant_memberships').select('id').eq('tenant_id',tenantId).eq('user_id',user.id).maybeSingle();
    if(memberError || !membership) return response({error:'Account access denied'},403);
    const ids=[...new Set<string>(listingIds)]; const product=products[nicheId];
    const {data:rows,error:scopeError}=await db.from('listings').select('id,external_listing_id,items!inner(tenant_id,specialist_id)').eq('tenant_id',tenantId).eq('marketplace_id','ebay').eq('items.tenant_id',tenantId).in('items.specialist_id',[...product.specialists,...product.legacySpecialists]).in('id',ids);
    if(scopeError || rows?.length!==ids.length) return response({error:'Every listing must belong to this account and niche'},403);
    if(rows.some(row=>!/^\d+$/.test(row.external_listing_id??''))) return response({error:'A listing has no valid external eBay identity'},400);
    const {data:connector,error:connectorError}=await db.from('marketplace_connectors').select('credential_ref,status,access_token_expires_at').eq('tenant_id',tenantId).eq('marketplace_id','ebay').maybeSingle();
    if(connectorError || connector?.status!=='connected' || !connector.credential_ref) return response({error:'Connect your eBay seller account before checking status'},400);
    let credentials:any=await decryptCredentials(connector.credential_ref);
    const expiry=Date.parse(credentials.expiresAt??connector.access_token_expires_at??'');
    if(!Number.isFinite(expiry) || Date.now()+300_000>=expiry) {
      if(!credentials.refreshToken) return response({error:'Re-authorise eBay to restore status checks'},401);
      const clientId=credentials.clientId || Deno.env.get('EBAY_CLIENT_ID'); const clientSecret=credentials.clientSecret || Deno.env.get('EBAY_CLIENT_SECRET');
      if(!clientId || !clientSecret) return response({error:'eBay server configuration is incomplete'},503);
      const refresh=await fetch('https://api.ebay.com/identity/v1/oauth2/token',{method:'POST',headers:{Authorization:`Basic ${btoa(`${clientId}:${clientSecret}`)}`,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',refresh_token:credentials.refreshToken}).toString(),signal:AbortSignal.timeout(12000)});
      const payload=await refresh.json();
      if(!refresh.ok || !payload.access_token) return response({error:'eBay token refresh was not confirmed; re-authorise eBay'},401);
      credentials={...credentials,accessToken:payload.access_token,expiresAt:new Date(Date.now()+Number(payload.expires_in??7200)*1000).toISOString()};
      const {error:saveError}=await db.from('marketplace_connectors').update({credential_ref:await encryptCredentials(credentials),access_token_expires_at:credentials.expiresAt,updated_at:new Date().toISOString()}).eq('tenant_id',tenantId).eq('marketplace_id','ebay');
      if(saveError) return response({error:'Refreshed credentials could not be saved securely'},503);
    }
    if(!credentials.accessToken) return response({error:'Re-authorise eBay'},401);
    const results:Array<{listingId:string;status?:string;error?:string}>=[];
    // Four workers, at most 12 GetItem calls per invocation, bounded timeouts.
    for(let start=0;start<rows.length;start+=4) {
      const batch=await Promise.all(rows.slice(start,start+4).map(async row=>{
        try {
          const xml=`<?xml version="1.0" encoding="utf-8"?><GetItemRequest xmlns="urn:ebay:apis:eBLBaseComponents"><ItemID>${row.external_listing_id}</ItemID><DetailLevel>ReturnAll</DetailLevel><IncludeItemSpecifics>false</IncludeItemSpecifics></GetItemRequest>`;
          const ebay=await fetch('https://api.ebay.com/ws/api.dll',{method:'POST',headers:{'X-EBAY-API-SITEID':'3','X-EBAY-API-COMPATIBILITY-LEVEL':'967','X-EBAY-API-CALL-NAME':'GetItem','X-EBAY-API-IAF-TOKEN':credentials.accessToken,'Content-Type':'text/xml;charset=utf-8'},body:xml,signal:AbortSignal.timeout(12000)});
          if(!ebay.ok) throw new Error(`eBay status check failed (HTTP ${ebay.status})`);
          const observation=parseEbayListingStatus(await ebay.text(),row.external_listing_id);
          const {error:applyError}=await db.rpc('swish_apply_ebay_listing_status',{p_tenant_id:tenantId,p_listing_id:row.id,p_external_id:observation.externalId,p_status:observation.status,p_quantity:observation.quantity,p_quantity_sold:observation.quantitySold,p_ended_at:observation.endedAt});
          if(applyError) throw new Error('Confirmed eBay status could not be reconciled; review this item');
          return {listingId:row.id,status:observation.status};
        } catch(error) {
          const message=error instanceof Error && ['eBay did not confirm the listing status','eBay quantity evidence is incomplete','eBay returned a different listing identity','eBay returned an unrecognized listing status','Invalid eBay quantity evidence','Confirmed eBay status could not be reconciled; review this item'].includes(error.message) ? error.message : 'eBay status check failed; existing status was preserved';
          return {listingId:row.id,error:message};
        }
      }));
      results.push(...batch);
    }
    const failures=results.filter(row=>row.error);
    return response({success:failures.length===0,checked:results.length-failures.length,failed:failures.length,results});
  } catch {
    console.error('[eBay listing status] Request failed; no credential material logged');
    return response({error:'Unable to check eBay listing status. Existing unverified statuses were preserved.'},500);
  }
});
