// Session boundary for the existing request-local eBay engine.
import {createClient} from 'npm:@supabase/supabase-js@2';
import {runMemberEbayScope as runEngine} from './ebayAccountEngine.ts';
import {requiresSellerBinding} from './ebayAccountPolicy.ts';
import {corsHeaders} from './cors.ts';
export {ebayAdminClient,ebayFetch,prepareMemberBinding,readEbayIdentity} from './ebayAccountEngine.ts';
export async function runMemberEbayScope(request:Request,userId:string,tenantId:string,body:Record<string,unknown>,handler:(request:Request)=>Response|Promise<Response>):Promise<Response>{
 const operation=new URL(request.url).pathname.split('/').pop()??'';
 if(requiresSellerBinding(operation,body.route)){
  try{
   const token=request.headers.get('Authorization')?.replace(/^Bearer /,'')??'';
   const encoded=token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');
   const claims=JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length/4)*4,'=')));
   if(claims.sub!==userId||typeof claims.session_id!=='string')throw new Error('Authenticated member session required.');
   const db=createClient(Deno.env.get('SUPABASE_URL')??'',Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??'',{auth:{persistSession:false}});
   const live=await db.rpc('swish_ebay_session_live',{p_user_id:userId,p_tenant_id:tenantId,p_session_id:claims.session_id}).abortSignal(AbortSignal.timeout(5000));
   if(live.error||live.data!==true)throw new Error('Your SWISH session ended. Sign in again before using eBay.');
  }catch{return new Response(JSON.stringify({success:false,error:'An active authenticated member session is required for eBay.',code:'EBAY_SESSION_REQUIRED'}),{status:401,headers:{...corsHeaders,'Content-Type':'application/json'}});}
 }
 return runEngine(request,userId,tenantId,body,handler);
}
