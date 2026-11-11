import { availableListingPhotos,originalForStudioImage } from '@/shared/smartStudio';
import { getSupabaseClient } from '@/template';
import { mapItem,type Item } from './itemService';
import { getProductionNicheSpecialistIds } from './nicheRouting';
import { backendRead } from './backendRequestService';
export function moveMainImageFirst(media:readonly string[],selectedUrl:string):string[]{const index=media.indexOf(selectedUrl);if(index<0)throw new Error('Select a photo already attached to this item.');return [media[index],...media.slice(0,index),...media.slice(index+1)];}
export function mediaOrderMatches(left:readonly string[],right:readonly string[]):boolean{return left.length===right.length&&left.every((url,index)=>url===right[index]);}
/** Inventory cover only. The seller's exact original/cutout/both selection belongs to the listing editor. */
export async function selectMainItemImage(tenantId:string,nicheId:string,itemId:string,selectedUrl:string,expectedMedia:readonly string[]):Promise<{item:Item|null;error:string|null}>{
 const specialists=getProductionNicheSpecialistIds(nicheId);if(!tenantId||!itemId||!specialists.length)return {item:null,error:'A verified item and niche workspace are required.'};
 try{const client=getSupabaseClient();const response=await backendRead(`main-photo:${tenantId}:${nicheId}:${itemId}`,signal=>client.from('items').select('*').eq('id',itemId).eq('tenant_id',tenantId).in('specialist_id',specialists).abortSignal(signal).single());const row=response.data;
  if(response.error||!row||row.tenant_id!==tenantId||!specialists.includes(row.specialist_id))throw new Error(response.error?.message??'Item unavailable in this workspace.');
  if(!mediaOrderMatches(row.media??[],expectedMedia))throw new Error('Photos changed since this page loaded. Reload before choosing a main image.');
  if(!availableListingPhotos(row.media??[],row.attributes??{}).includes(selectedUrl))throw new Error('Choose a photo attached to this item.');
  const media=moveMainImageFirst(row.media??[],originalForStudioImage(selectedUrl,row.attributes??{}));if(mediaOrderMatches(media,row.media??[]))return {item:mapItem(row),error:null};if(!row.updated_at)throw new Error('Item version missing. Reload before changing photos.');
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),15000);
  try{const saved=await client.from('items').update({media}).eq('id',itemId).eq('tenant_id',tenantId).in('specialist_id',specialists).eq('updated_at',row.updated_at).select('*').abortSignal(controller.signal).maybeSingle();if(saved.error||!saved.data)throw new Error(saved.error?.message??'Item changed or access was denied. Reload before trying again.');if(!mediaOrderMatches(saved.data.media??[],media))throw new Error('Saved photo order could not be confirmed. Reload the item.');return {item:mapItem(saved.data),error:null};}finally{clearTimeout(timer);}
 }catch(cause){return {item:null,error:cause instanceof Error?cause.message:'Main image save not confirmed.'};}
}
