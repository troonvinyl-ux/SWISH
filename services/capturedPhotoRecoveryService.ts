// Recover existing uploads only through the same canonical photo writer. No new item or paid processing.
import { getSupabaseClient } from '@/template';
import { getItem, type Item } from './itemService';
import { persistCapturedItemPhotos } from './photoPersistenceService';
import { verifyStoredOriginal } from './originalImageService';
import { getProductionNicheSpecialistIds } from './nicheRouting';
import { SPECIALISTS } from '@/constants/specialists';
import type { PhotoExpectation, PhotoAsset } from '@/shared/photoPersistence';
interface StoredCapture { path: string; slot: string; hash?: string; order: number }
const recoveries = new Map<string, Promise<{ item: Item | null; error: string | null }>>();
async function recover(tenantId: string, itemId: string, nicheId: string): Promise<{ item: Item | null; error: string | null }> {
 try {
  const specialists=getProductionNicheSpecialistIds(nicheId);
  if(!tenantId||!itemId||!specialists.length)throw new Error('A verified item and niche are required for photo recovery.');
  const loaded=await getItem(itemId);
  if(loaded.error||!loaded.item||loaded.item.tenantId!==tenantId||!specialists.includes(loaded.item.specialistId))throw new Error(loaded.error??'Item ownership could not be verified in this workspace.');
  const item=loaded.item;const pipeline=item.attributes?._photo_pipeline;
  if(item.media.length&&(!pipeline||pipeline.status==='complete'))return loaded;
  const storage=getSupabaseClient().storage.from('item-images');const captures:StoredCapture[]=[];
  const list=async(folder:string,originals:boolean)=>{
   for(let offset=0;offset<=900;offset+=100){
    const page=await storage.list(folder,{limit:100,offset,sortBy:{column:'name',order:'asc'}});
    if(page.error)throw new Error(`Stored photographs could not be read: ${page.error.message}`);
    for(const file of page.data??[]){
     if(!file.id||typeof file.name!=='string')continue;
     const match=originals?file.name.match(/^([a-zA-Z0-9_-]{1,40})_([a-f0-9]{64})\.(?:jpg|jpeg|png|webp|gif)$/):file.name.match(/^([1-9]\d*)_([a-zA-Z0-9_-]+)\.(?:jpg|jpeg|png|webp)$/i);
     if(match)captures.push({path:`${folder}/${file.name}`,slot:originals?match[1]:match[2],...(originals?{hash:match[2]}:{}),order:originals?1000:Number(match[1])});
    }
    if((page.data?.length??0)<100)return;
   }
   throw new Error('Too many stored files to recover safely. Review the saved item.');
  };
  await list(itemId,false);await list(`${itemId}/originals`,true);
  if(!captures.length)throw new Error('No uploaded original photos were found. Resume retained photos or add photos to this saved item; do not create another item.');
  const expected:PhotoExpectation[]=Array.isArray(pipeline?.expected)?pipeline.expected:[];
  const assets:PhotoAsset[]=Array.isArray(item.attributes?._photo_assets)?item.attributes._photo_assets:[];
  const hashed=captures.filter(capture=>capture.hash);
  const selected=captures.filter(capture=>capture.hash||!hashed.some(other=>other.slot===capture.slot)).filter(capture=>{
   const versions=hashed.filter(other=>other.slot===capture.slot);
   if(versions.length<=1)return true;
   const confirmed=expected.find(entry=>entry.slotId===capture.slot)?.url??assets.find(entry=>entry.slotId===capture.slot&&item.media.includes(entry.url))?.url;
   if(!confirmed)throw new Error('Multiple originals exist for the same view. Review the saved item before choosing photos.');
   return confirmed.endsWith(capture.path);
  });
  if(selected.length>12)throw new Error('More than 12 captured photos require manual review.');
  const slots=SPECIALISTS[item.specialistId]?.captureRequirements.map(slot=>slot.id)??[];
  const rank=(capture:StoredCapture)=>{const index=slots.indexOf(capture.slot);return index>=0?index:capture.order;};
  selected.sort((a,b)=>rank(a)-rank(b)||a.path.localeCompare(b.path,undefined,{numeric:true}));
  for(const capture of selected)if(capture.hash)await verifyStoredOriginal(capture.path,capture.hash);
  const images=selected.map(capture=>{
   const url=storage.getPublicUrl(capture.path).data?.publicUrl;if(!url?.startsWith('https://'))throw new Error('A stored original has no permanent URL.');
   return {uri:url,slotId:capture.slot,slotLabel:expected.find(entry=>entry.slotId===capture.slot)?.slotLabel??capture.slot,originalStorageUri:url,originalByteHash:capture.hash};
  });
  const saved=await persistCapturedItemPhotos(tenantId,itemId,images,{processImages:false});
  const check=await getItem(itemId);
  if(check.error||!check.item||check.item.tenantId!==tenantId||!specialists.includes(check.item.specialistId)||images.some(image=>!check.item!.media.includes(image.uri)))throw new Error(check.error??'Recovered photo references could not be confirmed on canonical inventory.');
  return {item:check.item,error:saved.complete?null:saved.errors.join(' ')||'Some original views remain on-device. Resume the retained scan to retry them.'};
 }catch(cause){return {item:null,error:cause instanceof Error?cause.message:'Photo recovery failed. Retry the saved item.'};}
}
export function recoverCapturedItemPhotos(tenantId:string,itemId:string,nicheId:string):Promise<{item:Item|null;error:string|null}>{
 const key=`${tenantId}:${nicheId}:${itemId}`;const existing=recoveries.get(key);if(existing)return existing;
 const pending=recover(tenantId,itemId,nicheId).finally(()=>{if(recoveries.get(key)===pending)recoveries.delete(key);});recoveries.set(key,pending);return pending;
}
