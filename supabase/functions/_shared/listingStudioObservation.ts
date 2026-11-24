// Read-only camera evidence inside swish-identify, not a second item/listing engine.
import { studioConfiguration, normalizeStudioEvidence } from './listingStudio.ts';
import { coinPacketInstructions } from './coinPacket.ts';
import { getSpecialistProfile } from './specialistIntelligence.ts';
import registry from './niche-modules.json' with { type:'json' };
import { corsHeaders } from './cors.ts';
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...corsHeaders,'Content-Type':'application/json'}});
export async function observeListingStudio(body:Record<string,any>):Promise<Response>{
 // This route is dispatched only after withModuleScope checks the actual JWT,
 // tenant membership and access to an existing paid module. Caller flags are overwritten.
 const registered=Object.keys(registry.products),niche=String(body.studioNiche??'auto');
 if(!Array.isArray(body._studioAllowedNiches)||!body._studioAllowedNiches.length)return json({error:'Authorised SWISH membership required.'},403);
 if(niche!=='auto'&&!body._studioAllowedNiches.includes(niche))return json({error:'Open an authorised specialist before analysing within it.'},403);
 const images=body.studioImages;
 if(!Array.isArray(images)||images.length<1||images.length>(niche==='tunes_flip'?12:8))return json({error:'Use one to eight photos, or twelve for Music.'},400);
 if(new TextEncoder().encode(JSON.stringify(body)).length>8_000_000)return json({error:'Analysis photos exceed the safe request size.'},413);
 const ids=new Set<string>();
 for(const image of images){
  if(!image||typeof image.slotId!=='string'||! /^[a-zA-Z0-9_-]{1,80}$/.test(image.slotId)||ids.has(image.slotId)||typeof image.image!=='string'||!/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(image.image)||image.image.length>1_000_000)return json({error:'Invalid bounded analysis photo. Originals are unchanged.'},400);
  ids.add(image.slotId);
 }
 const notes=typeof body.notes==='string'?body.notes.slice(0,2000):'',question=typeof body.question==='string'?body.question.slice(0,500):'';
 const configuration=studioConfiguration(niche,String(body.objectType??''),getSpecialistProfile(niche));
 const apiKey=Deno.env.get('ONSPACE_AI_API_KEY'),baseUrl=Deno.env.get('ONSPACE_AI_BASE_URL');
 if(!apiKey||!baseUrl)return json({error:'OnSpace AI guidance is unavailable. You can still finish and review.'},503);
 const content:any[]=[{type:'text',text:JSON.stringify({packetRules:niche==='coins'?coinPacketInstructions:'',niche,configuration,registeredNiches:registered,notes,question,previous:body.previous??null,photos:images.map(p=>({slotId:p.slotId,intendedRole:p.label}))})}];
 for(const image of images)content.push({type:'text',text:`Original photo ${image.slotId}; intended label ${String(image.label??'').slice(0,80)} is NOT proof of its contents.`},{type:'image_url',image_url:{url:image.image}});
 try{
  const response=await fetch(`${baseUrl}/chat/completions`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${apiKey}`},body:JSON.stringify({model:'google/gemini-3-flash-preview',temperature:0.05,max_tokens:2200,response_format:{type:'json_object'},messages:[{role:'system',content:`You are SWISH's progressive camera evidence assistant. Observe the actual photo set; a niche is a strong starting constraint, NOT an identification fact. If the product belongs elsewhere, recommend a registered niche; never transfer inventory. Identify subcategory (including book, CD, vinyl, shoe or component) before choosing useful evidence. Treat previous AI observations as unverified hypotheses, seller corrections as seller statements, and catalogue references as claims to cross-check, not override. Do not invent catalogue IDs, sources, sold prices, measurements, safety, authenticity, fitment, playback or publication status. This call performs NO catalogue lookup and NO listing operation. Do not repeatedly request roles already supplied, except genuinely unusable evidence: explain the retake. Request only ONE useful next view, and explain why in ONE short sentence. If enough usable evidence exists, say the seller can finish or add photos. Missing facts stay unknown; no numeric grades. For coins, also return coinPacket as specified in packetRules when a packet is present. Read all inscriptions at useful resolution; packet statements are not the visible coin legend. Return JSON {candidate:string,objectType:string,recommendedNiche:registered ID or null,confidence:number 0..1 or null,photos:[{slotId:exact supplied ID,role:configured role or unknown,observations:[literal observed facts],condition:[visible defects],limitations:[uncertainty],usable:boolean}],missing:[critical missing facts],conflicts:[specific conflicts],nextRole:configured role or empty,guidance:one short sentence,ready:boolean,answer:brief answer to seller question or empty}. Ready must be false for missing critical facts or unresolved conflicts. Confidence is an AI assessment, not verified accuracy. Catalogue and condition verification still occur in the existing SWISH specialist pipeline.`},{role:'user',content}]}),signal:AbortSignal.timeout(18000)});
  if(!response.ok)return json({error:`OnSpace AI guidance unavailable (${response.status}). Photography and Done remain available.`},response.status===429?429:502);
  const data=await response.json();if(data.choices?.[0]?.finish_reason==='length')return json({error:'AI guidance was incomplete. Your photos are retained.'},422);
  const text=String(data.choices?.[0]?.message?.content??'').replace(/^```(?:json)?\s*|\s*```$/g,'');
  const evidence=normalizeStudioEvidence(JSON.parse(text),'',images,niche,registered);
  return json({success:true,evidence,version:'listing-studio-v2',proposalOnly:true});
 }catch{return json({error:'OnSpace AI guidance could not complete. Retake a detail, retry guidance or finish.'},503);}
}
