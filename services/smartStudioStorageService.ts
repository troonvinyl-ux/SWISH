// Link existing studio artefacts to canonical originals using existing items.attributes.
import { getSupabaseClient } from '@/template';
import { SMART_STUDIO_VERSION, type StudioResult } from '@/shared/smartStudio';
import type { CapturedImage } from './aiIdentificationService';
export async function linkStudioImages(tenantId:string,itemId:string,images:readonly CapturedImage[]):Promise<string|null> {
 const entries=images.filter(image=>image.studio?.version===SMART_STUDIO_VERSION&&image.studio.enhancedUri&&image.originalStorageUri);
 if(!entries.length)return null;
 const client=getSupabaseClient();const read=await client.from('items').select('attributes,media,updated_at').eq('id',itemId).eq('tenant_id',tenantId).maybeSingle();
 if(read.error||!read.data?.updated_at)return 'Studio image ownership/version could not be verified.';
 const linked:Record<string,StudioResult>={...read.data.attributes?._smart_studio_images};
 for(const image of entries){if(!(read.data.media??[]).includes(image.originalStorageUri))return 'Link original photographs before studio presentations.';linked[image.slotId]={...image.studio!,originalUri:image.originalStorageUri!};}
 if(JSON.stringify(read.data.attributes?._smart_studio_images)===JSON.stringify(linked))return null;
 const attributes={...read.data.attributes,_smart_studio_images:linked};
 const save=await client.from('items').update({attributes}).eq('id',itemId).eq('tenant_id',tenantId).eq('updated_at',read.data.updated_at).select('id').maybeSingle();
 if(save.error||!save.data)return 'Inventory changed while linking studio images. Reload before retrying; originals remain saved.';
 const check=await client.from('items').select('attributes').eq('id',itemId).eq('tenant_id',tenantId).maybeSingle();
 if(check.error||JSON.stringify(check.data?.attributes?._smart_studio_images)!==JSON.stringify(linked))return 'Studio association readback could not be confirmed.';
 return null;
}
