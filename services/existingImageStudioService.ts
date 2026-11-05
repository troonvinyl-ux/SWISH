// Reuses the shared engine for saved inventory photos; no capture, identification or seller writes.
import { getSupabaseClient } from '@/template';
import { SMART_STUDIO_VERSION, studioImageIsUsable, type StudioResult } from '@/shared/smartStudio';
import { getProductionNicheSpecialistIds } from './nicheRouting';
import { mapItem, type Item } from './itemService';
import { prepareObjectImage } from './sharedImagePreparationService';
import { saveExistingStudioImage } from './smartStudioStorageService';

export interface ExistingStudioOutcome {item:Item|null;studio:StudioResult|null;reused:boolean;error:string|null}
export interface ExistingStudioRequest {tenantId:string;nicheId:string;itemId:string;userId:string;originalUri:string;signal?:AbortSignal}
function studioEntries(item:Item):Array<[string,StudioResult]> {
 const entries=item.attributes?._smart_studio_images;
 return entries&&typeof entries==='object'&&!Array.isArray(entries)?Object.entries(entries) as Array<[string,StudioResult]>:[];
}
export function existingStudioResult(item:Item,uri:string):StudioResult|null {
 const entry=studioEntries(item).find(([,value])=>value?.originalUri===uri&&value?.version===SMART_STUDIO_VERSION&&['ready','review'].includes(value?.status)&&studioImageIsUsable(value));
 return item.media.includes(uri)?entry?.[1]??null:null;
}
export function existingOriginalPhotos(item:Item):string[] {
 const derivatives=new Set(studioEntries(item).flatMap(([,value])=>[value?.enhancedUri,value?.maskUri]));
 const legacy=item.attributes?._coin_reference_images;
 if(legacy&&typeof legacy==='object')for(const uri of Object.values(legacy))if(typeof uri==='string')derivatives.add(uri);
 return [...new Set(item.media)].filter(uri=>typeof uri==='string'&&/^https:\/\//i.test(uri)&&!derivatives.has(uri)&&!/(?:\/studio\/|\/references\/)/i.test(uri.split('?')[0]));
}
function check(signal:AbortSignal){if(signal.aborted)throw new Error('Studio processing cancelled or timed out; original retained.');}
async function worker(options:ExistingStudioRequest,signal:AbortSignal):Promise<ExistingStudioOutcome> {
 const {tenantId,nicheId,itemId,userId,originalUri}=options;
 const specialists=getProductionNicheSpecialistIds(nicheId);
 if(!tenantId||!itemId||!userId||!specialists.length)throw new Error('A verified inventory workspace is required.');
 const client=getSupabaseClient();check(signal);
 const session=await client.auth.getSession();check(signal);
 if(session.error||session.data.session?.user.id!==userId)throw new Error('The signed-in account changed. Reopen this item before processing.');
 const read=await client.from('items').select('*').eq('id',itemId).eq('tenant_id',tenantId).in('specialist_id',specialists).maybeSingle().abortSignal(signal);
 if(read.error)throw new Error(read.error.message);check(signal);
 if(!read.data||read.data.tenant_id!==tenantId||!specialists.includes(read.data.specialist_id))throw new Error('Item is not available in this workspace.');
 const item=mapItem(read.data);
 if(!existingOriginalPhotos(item).includes(originalUri))throw new Error('Select an original photo already attached to this item.');
 const previous=existingStudioResult(item,originalUri);
 if(previous)return {item,studio:previous,reused:true,error:null};
 // Do not infer a side from media order: the seller may have reordered originals.
 const studio=await prepareObjectImage({original:{uri:originalUri},tenantId,nicheId,angle:'unspecified',signal});check(signal);
 if(!studio.enhancedUri||studio.status==='fallback')return {item:null,studio,reused:false,error:studio.warnings.join(' ')||'Studio could not prepare this photo; original retained.'};
 const {digestStringAsync,CryptoDigestAlgorithm}=await import('expo-crypto');
 const hash=await digestStringAsync(CryptoDigestAlgorithm.SHA256,originalUri);check(signal);
 const slotId=studioEntries(item).find(([,value])=>value?.originalUri===originalUri)?.[0]??`existing_${hash}`;
 const nextSession=await client.auth.getSession();check(signal);
 if(nextSession.error||nextSession.data.session?.user.id!==userId)throw new Error('Account changed before saving. Original retained.');
 const saved=await saveExistingStudioImage({tenantId,nicheId,itemId,slotId,originalUri,studio,signal});check(signal);
 return {item:saved.item,studio,reused:false,error:saved.error};
}
/** Bounded whole operation, including authentication, preparation and metadata readback. */
export function processExistingItemPhoto(options:ExistingStudioRequest):Promise<ExistingStudioOutcome> {
 const controller=new AbortController();
 return new Promise(resolve=>{
  let settled=false;let timer:ReturnType<typeof setTimeout>|null=null;
  const finish=(result:ExistingStudioOutcome)=>{if(settled)return;settled=true;if(timer)clearTimeout(timer);options.signal?.removeEventListener('abort',cancel);resolve(result);};
  const cancel=()=>{controller.abort();finish({item:null,studio:null,reused:false,error:'Studio processing cancelled or timed out. Original retained; reload to confirm any saved result.'});};
  timer=setTimeout(cancel,90000);options.signal?.addEventListener('abort',cancel,{once:true});
  if(options.signal?.aborted){cancel();return;}
  void worker(options,controller.signal).then(finish,cause=>finish({item:null,studio:null,reused:false,error:cause instanceof Error?cause.message:'Studio processing failed; original retained.'}));
 });
}
