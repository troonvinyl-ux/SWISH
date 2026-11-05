// Shared direct AI cutout endpoint. Originals are never overwritten.
import { serveModule } from '../_shared/moduleScope.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { SMART_STUDIO_VERSION, type StudioResult } from '../_shared/smartStudio.ts';
import { imageBytes, studioHash, processStudioCopy, readStudioMetadata, studioServerConfig } from '../_shared/smartStudioEngine.ts';
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
  // serveModule has already bound tenant, niche and entitlement to the server session.
  const body=await req.json();const {imageDataUrl,tenantId,nicheId}=body;
  if(typeof imageDataUrl!=='string'||!/^data:image\/(jpeg|jpg|png);base64,/i.test(imageDataUrl))return jsonResponse({error:'A base64 image data URL is required.'},400);
  if(imageDataUrl.length > 8_000_000)return jsonResponse({error:'Image is too large.'},413);
  const references=Array.isArray(body.references)?body.references.slice(0,2):[];
  if(references.some((r:any)=>typeof r.imageDataUrl!=='string'||r.imageDataUrl.length>350_000||!/^data:image\/jpeg;base64,/.test(r.imageDataUrl)||typeof r.angle!=='string'))return jsonResponse({error:'Invalid reference image copy.'},400);
  const angle=typeof body.angle==='string'?body.angle.slice(0,80):'unspecified';const hint=typeof body.hint==='string'?body.hint.slice(0,180):'';
  const config=studioServerConfig();const sourceHash=await studioHash(imageBytes(imageDataUrl));
  const cacheKey=await studioHash(new TextEncoder().encode(JSON.stringify({version:SMART_STUDIO_VERSION,sourceHash,nicheId,angle,hint,config,references})));
  const prefix=`${tenantId}/studio/${user.id}/${nicheId}/${cacheKey}`;
  const storage=userClient.storage.from('item-images');
  const urls=()=>({enhancedUri:storage.getPublicUrl(`${prefix}/presentation.png`).data.publicUrl,maskUri:storage.getPublicUrl(`${prefix}/mask.png`).data.publicUrl});
  const key=`${user.id}:${tenantId}:${nicheId}:${cacheKey}`;
  if(flights.has(key))return jsonResponse(await flights.get(key)!);
  const cached=await storage.download(`${prefix}/presentation.png`);
  if(!cached.error&&cached.data){const metadata=readStudioMetadata(new Uint8Array(await cached.data.arrayBuffer()));if(metadata?.quality?.fidelityPassed===true&&metadata?.cacheKey===cacheKey&&metadata.sourceHash===sourceHash)return jsonResponse({...metadata,enhancedUri:urls().enhancedUri,enhancedImage:urls().enhancedUri,cached:true});}
  const recent=(rates.get(user.id)??[]).filter(t=>t>Date.now()-60_000);
  if(recent.length>=12||flights.size>=4)return jsonResponse({error:'Smart Studio is busy. Original photographs remain available.',code:'STUDIO_BUSY'},429);
  rates.set(user.id,[...recent,Date.now()]);if(rates.size>256)rates.delete(rates.keys().next().value!);
  const work=(async()=>{
   const output=await processStudioCopy(imageDataUrl,nicheId,angle,hint,references,config);
   const result:Omit<StudioResult,'originalUri'>={...output.result,sourceHash,cacheKey};
   if(!output.image)return {...result,warning:result.warnings.join(' ')};
   // Re-encode provenance with the final scoped cache key, without changing pixels.
   const {decodeStudioRaster,encodeStudioPng}=await import('../_shared/smartStudioEngine.ts');
   const bytes=encodeStudioPng(decodeStudioRaster(output.image),result);
   const upload=await storage.upload(`${prefix}/presentation.png`,bytes,{contentType:'image/png',upsert:false,cacheControl:'31536000'});
   if(upload.error){const persisted=await storage.download(`${prefix}/presentation.png`);if(persisted.error||!persisted.data)throw new Error('Presentation storage failed.');const stored=readStudioMetadata(new Uint8Array(await persisted.data.arrayBuffer()));if(stored?.cacheKey!==cacheKey)throw new Error('Stored presentation not verified.');return {...stored,enhancedUri:urls().enhancedUri,enhancedImage:urls().enhancedUri,cached:true};}
   const verify=await storage.download(`${prefix}/presentation.png`);
   if(verify.error||!verify.data)throw new Error('Studio storage readback failed.');
   if(await studioHash(new Uint8Array(await verify.data.arrayBuffer()))!==await studioHash(bytes))throw new Error('Studio storage bytes differ.');
   return {...result,enhancedUri:urls().enhancedUri,enhancedImage:urls().enhancedUri,warning:result.warnings.join(' '),generatedBy:'Direct AI cutout + visual detail comparison'};
  })();flights.set(key,work);try{return jsonResponse(await work);}finally{flights.delete(key);}
 }catch{
  console.error('[swish-coin-image-enhance] request failed.');
  return jsonResponse({error:'Smart Studio could not complete. Continue with the unchanged original photograph.',code:'STUDIO_FAILED'},503);
 }
});
