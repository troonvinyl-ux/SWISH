// Discogs catalogue gateway. Consumer credentials exist ONLY in Edge environment variables.
// Catalogue-only: no marketplace pricing, images, private collections, tokens or seller writes.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { withModuleScope } from '../_shared/moduleScope.ts';
import { normalizeMusicCandidate, normalizeMusicRelease, MUSIC_NICHE_ID } from '../_shared/musicRelease.ts';
const API='https://api.discogs.com';
const secretNames=['DISCOGS_CONSUMER_KEY','DISCOGS_CONSUMER_SECRET','DISCOGS_USER_AGENT'] as const;
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...corsHeaders,'Content-Type':'application/json','Cache-Control':'no-store'}});
class CatalogueError extends Error { constructor(public status:number,public code:string,message:string){super(message);} }
let nextRequestAt=0;let blockedUntil=0;
function configured(){return secretNames.every(name=>Boolean(Deno.env.get(name)?.trim()));}
async function catalogue(path:string):Promise<any>{
 if(!configured())throw new CatalogueError(503,'DISCOGS_NOT_CONFIGURED','Discogs catalogue is not configured. Ask the platform administrator.');
 const key=Deno.env.get('DISCOGS_CONSUMER_KEY')!.trim();const secret=Deno.env.get('DISCOGS_CONSUMER_SECRET')!.trim();const agent=Deno.env.get('DISCOGS_USER_AGENT')!.trim();
 if(/[\r\n"\\]/.test(key+secret)||/[\r\n]/.test(agent))throw new CatalogueError(503,'DISCOGS_CONFIGURATION_INVALID','Discogs configuration needs administrator review.');
 if(Date.now()<blockedUntil)throw new CatalogueError(429,'DISCOGS_RATE_LIMIT','Discogs request budget is exhausted. Retry after one minute.');
 const slot=Math.max(Date.now(),nextRequestAt);nextRequestAt=slot+1300;
 if(slot-Date.now()>5200)throw new CatalogueError(429,'DISCOGS_BUSY','Discogs is busy. Retry shortly.');
 await new Promise(resolve=>setTimeout(resolve,Math.max(0,slot-Date.now())));
 const response=await fetch(API+path,{headers:{'User-Agent':agent,'Authorization':`Discogs key="${key}", secret="${secret}"`,'Accept':'application/vnd.discogs.v2.plaintext+json'},redirect:'error',signal:AbortSignal.timeout(12000)});
 const budget=response.headers.get('X-Discogs-Ratelimit-Remaining');const remaining=budget===null?null:Number(budget);
 if(response.status===429||remaining===0){blockedUntil=Date.now()+Math.max(60,Number(response.headers.get('Retry-After'))||60)*1000;}
 if(!response.ok){await response.body?.cancel();throw new CatalogueError(response.status===429?429:response.status===404?404:502,'DISCOGS_UPSTREAM_FAILED',response.status===429?'Discogs rate limit reached. Retry after one minute.':response.status===404?'Discogs release was not found.':'Discogs catalogue request failed. Retry or ask an administrator to run the connection check.');}
 return response.json();
}
const scopedCatalogue=withModuleScope(async(request:Request)=>{
 try{
  const body=await request.json();if(body.nicheId!==MUSIC_NICHE_ID)return json({error:'MUSIC_MODULE_REQUIRED',message:'Open Tunes Flip first.'},403);
  const auth=request.headers.get('Authorization')??'';
  const client=createClient(Deno.env.get('SUPABASE_URL')??'',Deno.env.get('SUPABASE_ANON_KEY')??'',{global:{headers:{Authorization:auth}},auth:{persistSession:false}});
  const role=await client.rpc('swish_is_platform_owner');if(role.error)return json({error:'OWNER_CHECK_UNAVAILABLE'},503);
  // Owner evaluation is not permission for paid/commercial deployment.
  if(role.data!==true&&Deno.env.get('DISCOGS_COMMERCIAL_USE_APPROVED')!=='true')return json({error:'DISCOGS_USAGE_REVIEW_REQUIRED',message:'Discogs catalogue integration awaits commercial-use permission. Use manual identification and your own photos; no membership was changed.'},403);
  if(body.action==='release'){
   const id=Number(body.releaseId);if(!Number.isSafeInteger(id)||id<1)return json({error:'INVALID_RELEASE_ID'},400);
   return json({release:normalizeMusicRelease(await catalogue(`/releases/${id}`)),attribution:'Data provided by Discogs.',restrictedDataExcluded:true});
  }
  if(body.action!=='search'&&body.action!=='versions')return json({error:'UNSUPPORTED_CATALOGUE_ACTION'},400);
  const page=Number(body.page??1);if(!Number.isSafeInteger(page)||page<1||page>100)return json({error:'INVALID_PAGE'},400);
  const params=new URLSearchParams({page:String(page),per_page:'20'});let path='/database/search';
  if(body.action==='versions'){
   const id=Number(body.masterId);if(!Number.isSafeInteger(id)||id<1)return json({error:'INVALID_MASTER_ID'},400);path=`/masters/${id}/versions`;
  }else{
   params.set('type','release');const term=typeof body.query==='string'?body.query.trim():'';
   if(term.length<2||term.length>120)return json({error:'INVALID_SEARCH',message:'Enter 2–120 characters.'},400);
   if(body.mode==='barcode'){
    if(!/^\d{8,14}$/.test(term))return json({error:'INVALID_BARCODE',message:'Enter an 8–14 digit printed barcode.'},400);params.set('barcode',term);
   }else if(body.mode==='catalogue')params.set('catno',term);
   else if(body.mode==='artist_title'){
    if(typeof body.artist!=='string'||body.artist.trim().length<2||body.artist.length>120)return json({error:'INVALID_ARTIST'},400);
    params.set('artist',body.artist.trim());params.set('release_title',term);
   }else if(body.mode==='text')params.set('q',term);else return json({error:'INVALID_SEARCH_MODE'},400);
  }
  const raw=await catalogue(`${path}?${params}`);const fetchedAt=new Date().toISOString();
  const rows=body.action==='versions'?raw.versions:raw.results;
  const results=(Array.isArray(rows)?rows:[]).map(row=>normalizeMusicCandidate(body.action==='versions'?{...row,label:typeof row.label==='string'?[row.label]:row.label,catno:typeof row.catno==='string'?[row.catno]:row.catno,format:typeof row.format==='string'?[row.format]:row.format}:row)).filter(Boolean);
  return json({results,page,pages:Number(raw.pagination?.pages??1),total:Number(raw.pagination?.items??results.length),...(body.action==='versions'?{masterId:Number(body.masterId)}:{}),fetchedAt,expiresAt:new Date(Date.now()+6*3600000).toISOString(),attribution:'Data provided by Discogs.',restrictedDataExcluded:true});
 }catch(error){if(error instanceof CatalogueError)return json({error:error.code,message:error.message},error.status);console.error('[Discogs] Catalogue request failed; no payload or credentials logged.');return json({error:'DISCOGS_UNAVAILABLE',message:'Discogs could not be reached or returned invalid catalogue data. Retry.'},502);}
});
Deno.serve(async(request:Request)=>{
 if(request.method==='OPTIONS')return new Response(null,{headers:corsHeaders});
 if(request.method!=='POST')return json({error:'METHOD_NOT_ALLOWED'},405);
 try{
  const text=await request.clone().text();if(text.length>4000)return json({error:'REQUEST_TOO_LARGE'},413);
  const body=JSON.parse(text);if(!body||typeof body!=='object'||Array.isArray(body))return json({error:'INVALID_REQUEST'},400);
  if(body.action!=='status'&&body.action!=='health')return scopedCatalogue(request);
  const authorization=request.headers.get('Authorization')??'';if(!authorization.startsWith('Bearer '))return json({error:'AUTHENTICATION_REQUIRED'},401);
  const client=createClient(Deno.env.get('SUPABASE_URL')??'',Deno.env.get('SUPABASE_ANON_KEY')??'',{global:{headers:{Authorization:authorization}},auth:{persistSession:false}});
  const {data:{user},error}=await client.auth.getUser(authorization.slice(7));if(error||!user)return json({error:'SESSION_INVALID'},401);
  const role=await client.rpc('swish_is_platform_owner');if(role.error)return json({error:'OWNER_AUTHORIZATION_UNAVAILABLE'},503);if(role.data!==true)return json({error:'OWNER_REQUIRED'},403);
  const missing=secretNames.filter(name=>!Deno.env.get(name)?.trim());
  if(body.action==='health'){
   const release=normalizeMusicRelease(await catalogue('/releases/249504'));
   return json({configured:true,connectivity:'PASS',releaseId:release.id,checkedAt:new Date().toISOString(),readOnly:true,restrictedDataExcluded:true});
  }
  return json({configured:missing.length===0,missing,commercialUseApproved:Deno.env.get('DISCOGS_COMMERCIAL_USE_APPROVED')==='true',oauthAvailable:false,callbackUrl:null,checkedAt:new Date().toISOString()});
 }catch(error){if(error instanceof CatalogueError)return json({error:error.code,message:error.message},error.status);return json({error:'INVALID_OR_UNAVAILABLE_REQUEST',message:'Request could not be processed. Retry.'},400);}
});
