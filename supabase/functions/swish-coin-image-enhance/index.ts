// Shared BackgroundErase endpoint, retaining the existing route for every niche/legacy caller.
// Provider credentials are read only inside Edge shared modules; originals are never overwritten.
import { serveModule } from '../_shared/moduleScope.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { SMART_STUDIO_VERSION, studioImageIsUsable, type StudioResult } from '../_shared/smartStudio.ts';
import { imageBytes, studioHash, processStudioCopy, readStudioMetadata, studioServerConfig, attachStudioMetadata } from '../_shared/smartStudioEngine.ts';
import { BackgroundEraseError } from '../_shared/backgroundEraseService.ts';
const jsonResponse=(body:Record<string,unknown>,status=200)=>new Response(JSON.stringify(body),{status,headers:{...corsHeaders,'Content-Type':'application/json'}});
const flights=new Map<string,Promise<Record<string,unknown>>>();
const rates=new Map<string,number[]>();
serveModule(async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
 if(req.method!=='POST')return jsonResponse({error:'POST required'},405);
 try{
  const authorization=req.headers.get('Authorization');if(!authorization)return jsonResponse({error:'Authentication required'},401);
  const userClient=createClient(Deno.env.get('SUPABASE_URL')??'',Deno.env.get('SUPABASE_ANON_KEY')??'',{global:{headers:{Authorization:authorization}},auth:{persistSession:false}});
  const {data:{user},error:userError}=await userClient.auth.getUser();if(userError||!user)return jsonResponse({error:'Authentication required'},401);
  // serveModule binds verified tenant, niche, entitlement and optional resource ownership first.
  const body=await req.json();const {imageDataUrl,tenantId,nicheId}=body;
  if(typeof imageDataUrl!=='string'||!/^data:image\/(jpeg|jpg|png);base64,/i.test(imageDataUrl))return jsonResponse({error:'A base64 image data URL is required.'},400);
  if(imageDataUrl.length > 8_000_000)return jsonResponse({error:'Image is too large.'},413);
  if(typeof tenantId!=='string'||typeof nicheId!=='string')return jsonResponse({error:'Verified module scope required.'},403);
  const sourceHash=await studioHash(imageBytes(imageDataUrl));const config=studioServerConfig();
  // No angle, hints, key values or extra images: one cutout per source copy in this user/module scope.
  const cacheKey=await studioHash(new TextEncoder().encode(JSON.stringify({version:SMART_STUDIO_VERSION,sourceHash,nicheId,config})));
  const prefix=`${tenantId}/studio/${user.id}/${nicheId}/${cacheKey}`;
  // Server-only writes; no user Authorization header on the service-role storage client.
  const admin=createClient(Deno.env.get('SUPABASE_URL')??'',Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??'',{auth:{persistSession:false}});
  const storage=admin.storage.from('item-images');
  const enhancedUri=storage.getPublicUrl(`${prefix}/presentation.png`).data.publicUrl;
  const key=`${user.id}:${tenantId}:${nicheId}:${cacheKey}`;
  const usable=(metadata:Omit<StudioResult,'originalUri'>|null)=>Boolean(metadata?.cacheKey===cacheKey&&metadata.sourceHash===sourceHash&&metadata.status==='ready'&&studioImageIsUsable({...metadata!,originalUri:'',enhancedUri}));
  if(flights.has(key))return jsonResponse(await flights.get(key)!);
  const cached=await storage.download(`${prefix}/presentation.png`);
  if(!cached.error&&cached.data){const metadata=readStudioMetadata(new Uint8Array(await cached.data.arrayBuffer()));if(usable(metadata))return jsonResponse({...metadata,enhancedUri,enhancedImage:enhancedUri,cached:true,generatedBy:'BackgroundErase'});}
  const recent=(rates.get(user.id)??[]).filter(t=>t>Date.now()-60_000);
  if(recent.length>=12||flights.size>=4)return jsonResponse({error:'Background removal is busy. Original photographs remain available.',code:'STUDIO_BUSY'},429);
  rates.set(user.id,[...recent,Date.now()]);if(rates.size>256)rates.delete(rates.keys().next().value!);
  const work=(async()=>{
   const output=await processStudioCopy(imageDataUrl,nicheId,'','',[],config);
   const result:Omit<StudioResult,'originalUri'>={...output.result,sourceHash,cacheKey};
   if(!output.image)return {...result,warning:result.warnings.join(' ')};
   const bytes=attachStudioMetadata(output.image,result);
   if(bytes.length>5_242_880)throw new BackgroundEraseError('BACKGROUND_ERASE_OUTPUT_TOO_LARGE',422,'BackgroundErase: cutout exceeds the storage limit; original retained.');
   const upload=await storage.upload(`${prefix}/presentation.png`,bytes,{contentType:'image/png',upsert:false,cacheControl:'31536000'});
   if(upload.error){const persisted=await storage.download(`${prefix}/presentation.png`);if(persisted.error||!persisted.data)throw new Error('Presentation storage failed.');const stored=readStudioMetadata(new Uint8Array(await persisted.data.arrayBuffer()));if(!usable(stored))throw new Error('Stored presentation not verified.');return {...stored,enhancedUri,enhancedImage:enhancedUri,cached:true,generatedBy:'BackgroundErase'};}
   const verify=await storage.download(`${prefix}/presentation.png`);
   if(verify.error||!verify.data)throw new Error('Presentation storage readback failed.');
   if(await studioHash(new Uint8Array(await verify.data.arrayBuffer()))!==await studioHash(bytes))throw new Error('Presentation storage bytes differ.');
   return {...result,enhancedUri,enhancedImage:enhancedUri,warning:result.warnings.join(' '),generatedBy:'BackgroundErase'};
  })();flights.set(key,work);try{return jsonResponse(await work);}finally{flights.delete(key);}
 }catch(cause){
  if(cause instanceof BackgroundEraseError)return jsonResponse({error:cause.message,code:cause.code},cause.status);
  console.error('[swish-coin-image-enhance] request failed.');
  return jsonResponse({error:'Background removal could not complete. Continue with the unchanged original photograph.',code:'STUDIO_FAILED'},503);
 }
});
