// Request-local binding adapter for SWISH's existing eBay integration.
import { AsyncLocalStorage } from 'node:async_hooks';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { decryptCredentials, encryptCredentials } from './credentialCrypto.ts';
import { assertCredentialScope, parseEbayIdentity, requiresSellerBinding, ebayMismatchMessage } from './ebayAccountPolicy.ts';
import { corsHeaders } from './cors.ts';
import { ebayAuthorizationDatabaseFetch } from './ebayAuthorizationTransport.ts';
interface Binding { id:string;user_id:string;tenant_id:string;ebay_account_id:string;seller_account_id:string;status:string;revision:number;credential_ref:string;last_verified_at:string }
interface AccountScope { userId:string;tenantId:string;binding:Binding|null;deadline:number }
const scopes=new AsyncLocalStorage<AccountScope>();
const rawAdmin=()=>createClient(Deno.env.get('SUPABASE_URL')??'',Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??'',{auth:{persistSession:false},global:{fetch:ebayAuthorizationDatabaseFetch}});
export async function readEbayIdentity(token:string){
 const response=await fetch('https://apiz.ebay.com/commerce/identity/v1/user/',{headers:{Authorization:`Bearer ${token}`,Accept:'application/json'},signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw new Error('eBay identity lookup failed. Reconnect with identity permission.');
 return parseEbayIdentity(await response.json());
}
export async function prepareMemberBinding(userId:string,tenantId:string):Promise<Binding|null>{
 const db=rawAdmin(),loaded=await db.from('swish_ebay_bindings').select('*').eq('user_id',userId).eq('tenant_id',tenantId).neq('status','replaced').maybeSingle();
 if(loaded.error)throw new Error('Member eBay binding lookup unavailable.');
 const b=loaded.data as Binding|null;if(!b||b.status!=='connected'||!b.credential_ref)return b;
 const creds=await decryptCredentials(b.credential_ref);assertCredentialScope(creds,b);
 const expiry=Date.parse(String(creds.expiresAt??''));let changed=false;
 if(!Number.isFinite(expiry)||expiry<Date.now()+900000){
  if(!creds.refreshToken)throw new Error('Reconnect your linked eBay account.');
  const response=await fetch('https://api.ebay.com/identity/v1/oauth2/token',{method:'POST',headers:{Authorization:`Basic ${btoa(`${creds.clientId}:${creds.clientSecret}`)}`,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',refresh_token:String(creds.refreshToken)}).toString(),signal:AbortSignal.timeout(12000)});
  const payload=await response.json().catch(()=>({}));if(!response.ok||!payload.access_token)throw new Error('Linked eBay authorization needs reconnection.');
  creds.accessToken=payload.access_token;creds.expiresAt=new Date(Date.now()+Number(payload.expires_in??7200)*1000).toISOString();changed=true;
 }
 if(changed||!Number.isFinite(Date.parse(b.last_verified_at))||Date.parse(b.last_verified_at)<Date.now()-86400000){
  const identity=await readEbayIdentity(String(creds.accessToken??''));if(identity.userId!==b.ebay_account_id)throw new Error(ebayMismatchMessage);
  const reference=await encryptCredentials(creds);const saved=await db.from('swish_ebay_bindings').update({credential_ref:reference,access_token_expires_at:creds.expiresAt,last_verified_at:new Date().toISOString(),seller_account_id:identity.username}).eq('id',b.id).eq('user_id',userId).eq('tenant_id',tenantId).eq('revision',b.revision).eq('status','connected').eq('credential_ref',b.credential_ref).select('*').maybeSingle();
  if(saved.error||!saved.data)throw new Error('eBay connection changed. Reload before retrying.');return saved.data as Binding;
 }
 return b;
}
const denied=(error:string,status=403)=>new Response(JSON.stringify({success:false,error,code:'EBAY_BINDING_REQUIRED'}),{status,headers:{...corsHeaders,'Content-Type':'application/json'}});
export async function runMemberEbayScope(request:Request,userId:string,tenantId:string,body:Record<string,unknown>,handler:(request:Request)=>Response|Promise<Response>):Promise<Response>{
 const operation=new URL(request.url).pathname.split('/').pop()??'',seller=requiresSellerBinding(operation,body.route);
 if(!seller&&!['swish-ebay-list','swish-ebay-browse','swish-market-value'].includes(operation))return handler(request);
 try{
  const binding=seller?await prepareMemberBinding(userId,tenantId):null;
  if(seller&&(!binding||binding.status!=='connected'||!binding.credential_ref))return denied('Verify your own eBay seller account in Marketplaces before selling. Legacy tenant connections are not inherited.');
  if(binding){
   const db=rawAdmin(),lease=await db.rpc('swish_ebay_lease',{p_user_id:userId,p_tenant_id:tenantId,p_binding_id:binding.id,p_revision:binding.revision});
   if(lease.error||lease.data!==true)return denied('eBay account changed. Reopen this workflow.',409);
   for(const [table,id] of [['listings',body.listingId],['orders',body.orderId],['ebay_messages',body.messageId]] as const){
    if(typeof id!=='string')continue;const row=await db.from(table).select('*').eq('id',id).eq('tenant_id',tenantId).maybeSingle();
    if(row.error||!row.data)return denied('eBay resource ownership could not be verified.');
    const firstDraft=table==='listings'&&!row.data.ebay_binding_id&&!row.data.external_listing_id&&!row.data.import_source&&binding.revision===1;
    if(row.data.ebay_binding_id!==binding.id&&!firstDraft)return denied('This record belongs to a previous or unverified eBay account. It will not be transferred.',409);
   }
  }
  return await scopes.run({userId,tenantId,binding,deadline:Date.now()+150000},()=>handler(request));
 }catch(cause){return denied(cause instanceof Error?cause.message:'Member eBay account verification failed.',409);}
}
async function scopedDatabaseFetch(scope:AccountScope,input:Parameters<typeof fetch>[0],init?:Parameters<typeof fetch>[1]){
 if(Date.now()>scope.deadline)throw new Error('eBay operation expired. Check the previous outcome before retrying.');
 const original=new Request(input,init),url=new URL(original.url),headers=new Headers(original.headers),table=url.pathname.split('/').pop();
 if(scope.binding)headers.set('x-swish-ebay-binding',scope.binding.id);
 if(table==='marketplace_connectors'){
  if(!scope.binding)return new Response('[]',{status:200,headers:{'Content-Type':'application/json'}});
  url.pathname=url.pathname.replace(/marketplace_connectors$/,'swish_ebay_bindings');
  url.searchParams.set('user_id',`eq.${scope.userId}`);url.searchParams.set('tenant_id',`eq.${scope.tenantId}`);url.searchParams.set('id',`eq.${scope.binding.id}`);url.searchParams.set('revision',`eq.${scope.binding.revision}`);
  if(original.method==='PATCH'){
   url.searchParams.append('and','(status.eq.connected)');const patch=await original.clone().json();
   if(patch.credential_ref){const creds=await decryptCredentials(patch.credential_ref);assertCredentialScope(creds,scope.binding);const identity=await readEbayIdentity(String(creds.accessToken));if(identity.userId!==scope.binding.ebay_account_id)throw new Error(ebayMismatchMessage);}
   if(['user_id','tenant_id','ebay_account_id','revision'].some(key=>key in patch))throw new Error('Account identity is command-managed.');
  }else if(!['GET','HEAD'].includes(original.method))throw new Error('Account binding is command-managed.');
 }
 if(scope.binding&&table==='items')url.searchParams.append('and',`(or(ebay_binding_id.eq.${scope.binding.id},and(ebay_binding_id.is.null,attributes->>_ebay_item_id.is.null,attributes->>_ebay_offer_id.is.null)))`);
 if(scope.binding&&['listings','orders','sales','ebay_messages','ebay_financials','ebay_cases','ebay_returns'].includes(String(table)))url.searchParams.append('and',scope.binding.revision===1&&table==='listings'?`(or(ebay_binding_id.eq.${scope.binding.id},and(ebay_binding_id.is.null,external_listing_id.is.null,import_source.is.null)))`:`(ebay_binding_id.eq.${scope.binding.id})`);
 return fetch(new Request(url.toString(),{method:original.method,headers,body:['GET','HEAD'].includes(original.method)?undefined:await original.arrayBuffer(),signal:original.signal}));
}
export function currentMemberEbayBinding(){return scopes.getStore()?.binding??null;}
export function ebayAdminClient(){const scope=scopes.getStore();if(!scope)throw new Error('eBay request-local member scope required.');return createClient(Deno.env.get('SUPABASE_URL')??'',Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??'',{auth:{persistSession:false},global:{fetch:(input,init)=>scopedDatabaseFetch(scope,input,init)}});}
export const ebayFetch:typeof fetch=(input,init)=>{const scope=scopes.getStore();if(scope&&Date.now()>scope.deadline)throw new Error('eBay account operation expired.');return fetch(input,{...init,signal:AbortSignal.any([AbortSignal.timeout(scope?Math.max(1,Math.min(30000,scope.deadline-Date.now())):30000),...(init?.signal?[init.signal]:[])])});};
