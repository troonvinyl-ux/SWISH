// Link existing studio artefacts to canonical originals using existing items.attributes.
import { getSupabaseClient } from '@/template';
import { SMART_STUDIO_VERSION, studioImageIsUsable, type StudioResult } from '@/shared/smartStudio';
import type { CapturedImage } from './aiIdentificationService';
import { mapItem, type Item } from './itemService';
import { getProductionNicheSpecialistIds } from './nicheRouting';

// PostgreSQL jsonb reorders object keys. Readback compares values, never insertion order.
function normalized(value:unknown):unknown {
 if(Array.isArray(value))return value.map(normalized);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,entry])=>[key,normalized(entry)]));
 return value;
}
function sameJson(left:unknown,right:unknown):boolean{return JSON.stringify(normalized(left))===JSON.stringify(normalized(right));}
export async function linkStudioImages(tenantId:string,itemId:string,images:readonly CapturedImage[]):Promise<string|null> {
 const entries=images.filter(image=>studioImageIsUsable(image.studio)&&image.originalStorageUri);
 if(!entries.length)return null;
 const client=getSupabaseClient();const read=await client.from('items').select('attributes,media,updated_at').eq('id',itemId).eq('tenant_id',tenantId).maybeSingle();
 if(read.error||!read.data?.updated_at)return 'Studio image ownership/version could not be verified.';
 const linked:Record<string,StudioResult>={...read.data.attributes?._smart_studio_images};
 for(const image of entries){if(!(read.data.media??[]).includes(image.originalStorageUri))return 'Link original photographs before studio presentations.';linked[image.slotId]={...image.studio!,originalUri:image.originalStorageUri!};}
 if(sameJson(read.data.attributes?._smart_studio_images,linked))return null;
 const attributes={...read.data.attributes,_smart_studio_images:linked};
 const save=await client.from('items').update({attributes}).eq('id',itemId).eq('tenant_id',tenantId).eq('updated_at',read.data.updated_at).select('id').maybeSingle();
 if(save.error||!save.data)return 'Inventory changed while linking studio images. Reload before retrying; originals remain saved.';
 const check=await client.from('items').select('attributes').eq('id',itemId).eq('tenant_id',tenantId).maybeSingle();
 if(check.error||!sameJson(check.data?.attributes?._smart_studio_images,linked))return 'Studio association readback could not be confirmed.';
 return null;
}

/** Existing evidence is never reuploaded or reordered; only presentation metadata changes. */
export async function saveExistingStudioImage(options:{tenantId:string;nicheId:string;itemId:string;slotId:string;originalUri:string;studio:StudioResult;signal:AbortSignal}):Promise<{item:Item|null;error:string|null}> {
 const {tenantId,nicheId,itemId,slotId,originalUri,studio,signal}=options;
 const specialists=getProductionNicheSpecialistIds(nicheId);
 if(!tenantId||!itemId||!specialists.length||studio.originalUri!==originalUri||studio.version!==SMART_STUDIO_VERSION||!['ready','review'].includes(studio.status)||!studioImageIsUsable(studio))return {item:null,error:'Studio provenance or workspace is invalid; original retained.'};
 const controller=new AbortController();const cancel=()=>controller.abort();
 signal.addEventListener('abort',cancel,{once:true});const timer=setTimeout(cancel,15000);
 const check=()=>{if(signal.aborted||controller.signal.aborted)throw new Error('Studio association cancelled or timed out. Reload to confirm any saved result.');};
 const client=getSupabaseClient();
 try{
  check();
  const read=await client.from('items').select('*').eq('id',itemId).eq('tenant_id',tenantId).in('specialist_id',specialists).maybeSingle().abortSignal(controller.signal);
  if(read.error)throw new Error(read.error.message);check();
  const row=read.data;
  if(!row||row.tenant_id!==tenantId||!specialists.includes(row.specialist_id)||!row.updated_at)throw new Error('Item ownership/version could not be verified.');
  if(!Array.isArray(row.media)||!row.media.includes(originalUri))throw new Error('The original photo is no longer attached to this item. Reload before retrying.');
  const entries=row.attributes?._smart_studio_images;
  const linked={...(entries&&typeof entries==='object'&&!Array.isArray(entries)?entries:{}),[slotId]:{...studio,originalUri}};
  // Merge fresh attributes, not the screen snapshot. CAS prevents overwriting newer edits.
  const write=await client.from('items').update({attributes:{...row.attributes,_smart_studio_images:linked}}).eq('id',itemId).eq('tenant_id',tenantId).in('specialist_id',specialists).eq('updated_at',row.updated_at).select('*').maybeSingle().abortSignal(controller.signal);
  if(write.error)throw new Error(write.error.message);check();
  if(!write.data)throw new Error('Inventory changed while saving the studio result. Reload and retry; no automatic overwrite was made.');
  if(!sameJson(write.data.media,row.media))throw new Error('Original photo order could not be confirmed after saving. Reload before retrying.');
  const verify=await client.from('items').select('*').eq('id',itemId).eq('tenant_id',tenantId).in('specialist_id',specialists).maybeSingle().abortSignal(controller.signal);
  if(verify.error)throw new Error(verify.error.message);check();
  if(!verify.data||!verify.data.media?.includes(originalUri)||!sameJson(verify.data.attributes?._smart_studio_images?.[slotId],linked[slotId]))throw new Error('Studio association readback could not be confirmed. Reload before retrying.');
  return {item:mapItem(verify.data),error:null};
 }catch(cause){return {item:null,error:cause instanceof Error?cause.message:'Studio association failed; original retained.'};}
 finally{clearTimeout(timer);signal.removeEventListener('abort',cancel);}
}
