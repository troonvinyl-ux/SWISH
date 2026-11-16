import { assertEquals, assertThrows } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { withModuleScope } from '../functions/_shared/moduleScope.ts';
import { ebayAdminClient } from '../functions/_shared/ebayAccountScope.ts';
import { encryptCredentials } from '../functions/_shared/credentialCrypto.ts';
const tenantA='11111111-1111-4111-8111-111111111111',tenantB='22222222-2222-4222-8222-222222222222';
const members=[{id:'member-A',tenant:tenantA},{id:'member-B',tenant:tenantB}];
const token=(id:string)=>`header.${btoa(JSON.stringify({sub:id,session_id:`session-${id}`})).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_')}.signature`;
const memberFor=(authorization:string)=>members.find(member=>authorization===`Bearer ${token(member.id)}`);
const reply=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
Deno.test('verified module establishes isolated eBay member scopes and retains access denials',async()=>{
 const previousFetch=globalThis.fetch,keys=['SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY','SWISH_CREDENTIAL_KEY'];
 const previous=keys.map(key=>Deno.env.get(key));
 keys.forEach((key,index)=>Deno.env.set(key,index===0?'https://backend.invalid':index===3?'11'.repeat(32):`test-key-${index}`));
 const bindings:Record<string,Record<string,unknown>>={};
 let entitlement=true,sessionLive=true,bindingAvailable=true,bindingReads=0,handlerCalls=0;
 try{
  for(const member of members){
   const binding={id:`binding-${member.id}`,user_id:member.id,tenant_id:member.tenant,ebay_account_id:`ebay-${member.id}`,seller_account_id:`seller-${member.id}`,status:'connected',revision:1,last_verified_at:new Date().toISOString(),credential_ref:''};
   binding.credential_ref=await encryptCredentials({bindingId:binding.id,userId:member.id,tenantId:member.tenant,ebayUserId:binding.ebay_account_id,accessToken:`test-token-${member.id}`,expiresAt:new Date(Date.now()+7200000).toISOString()});
   bindings[member.id]=binding;
  }
  globalThis.fetch=async(input,init)=>{
   const request=new Request(input,init),url=new URL(request.url);
   if(url.hostname!=='backend.invalid')throw new Error('Test attempted an external request');
   const member=memberFor(request.headers.get('Authorization')??'');
   if(url.pathname.endsWith('/auth/v1/user'))return member?reply({id:member.id,email:`${member.id}@example.invalid`}):reply({message:'Invalid session'},401);
   if(url.pathname.includes('/rpc/')){
    const name=url.pathname.split('/').pop(),body=await request.json();
    if(name==='swish_current_module')return reply(member?{tenant_id:member.tenant,niche_id:'tunes_flip'}:null);
    if(name==='swish_can_access_niche')return reply(Boolean(entitlement&&member&&body.p_tenant_id===member.tenant&&body.p_niche_id==='tunes_flip'));
    if(name==='swish_ebay_session_live')return reply(Boolean(sessionLive&&members.some(row=>body.p_user_id===row.id&&body.p_tenant_id===row.tenant&&body.p_session_id===`session-${row.id}`)));
    if(name==='swish_ebay_lease')return reply(members.some(row=>body.p_user_id===row.id&&body.p_tenant_id===row.tenant&&body.p_binding_id===bindings[row.id].id));
    throw new Error(`Unexpected RPC ${name}`);
   }
   if(url.pathname.endsWith('/swish_ebay_bindings')){
    bindingReads++;
    const user=url.searchParams.get('user_id')?.replace(/^eq\./,''),binding=user?bindings[user]:null;
    assertEquals(Boolean(binding&&url.searchParams.get('tenant_id')===`eq.${binding.tenant_id}`),true);
    const id=url.searchParams.get('id');if(id)assertEquals(id,`eq.${binding!.id}`);
    return reply(bindingAvailable&&binding?[binding]:[]);
   }
   throw new Error(`Unexpected test request ${url.pathname}`);
  };
  const handler=withModuleScope(async request=>{
   handlerCalls++;const body=await request.json();
   await new Promise(resolve=>setTimeout(resolve,body.tenantId===tenantA?10:1));
   const connector=await ebayAdminClient().from('marketplace_connectors').select('seller_account_id').eq('tenant_id',body.tenantId).maybeSingle();
   if(connector.error)throw connector.error;
   return reply({seller:connector.data?.seller_account_id??null,tenant:body.tenantId});
  });
  const request=(member=members[0],body:Record<string,unknown>={},operation='swish-ebay-list',authorization=`Bearer ${token(member.id)}`)=>new Request(`https://backend.invalid/functions/v1/${operation}`,{method:'POST',headers:{Authorization:authorization,'Content-Type':'application/json'},body:JSON.stringify({tenantId:member.tenant,route:'get_category_suggestions',query:'music CDs',...body})});
  assertThrows(()=>ebayAdminClient(),Error,'request-local member scope required');
  const publicResult=await handler(request());assertEquals(publicResult.status,200);assertEquals(await publicResult.json(),{seller:null,tenant:tenantA});assertEquals(bindingReads,0);
  const sellerResults=await Promise.all(members.map(async member=>{const response=await handler(request(member,{route:'get_seller_policies'}));return {status:response.status,...await response.json()};}));
  assertEquals(sellerResults,[{status:200,seller:'seller-member-A',tenant:tenantA},{status:200,seller:'seller-member-B',tenant:tenantB}]);
  assertThrows(()=>ebayAdminClient(),Error,'request-local member scope required');
  const before=handlerCalls;
  assertEquals((await handler(request(members[0],{},'swish-ebay-list',''))).status,401);
  assertEquals((await handler(request(members[0],{tenantId:tenantB}))).status,403);
  entitlement=false;assertEquals((await handler(request())).status,403);entitlement=true;
  assertEquals(handlerCalls,before);
  bindingAvailable=false;assertEquals((await handler(request(members[0],{route:'get_seller_policies'}))).status,403);bindingAvailable=true;
  sessionLive=false;assertEquals((await handler(request(members[0],{route:'get_seller_policies'}))).status,401);sessionLive=true;
  assertEquals(handlerCalls,before);
  const statusResult=await handler(request(members[0],{route:'inspect'},'swish-ebay-listing-status'));assertEquals(statusResult.status,200);assertEquals((await statusResult.json()).seller,'seller-member-A');
 }finally{
  globalThis.fetch=previousFetch;keys.forEach((key,index)=>previous[index]===undefined?Deno.env.delete(key):Deno.env.set(key,previous[index]!));
 }
});
