import { captureFromCamera, pickFromLibrary } from './aiIdentificationService';
import { persistCapturedItemPhotos } from './photoPersistenceService';
import { getItem, type Item } from './itemService';
import { resolveProductionNiche } from './nicheRouting';
import { shouldAutoRemoveBackground, originalListingPhotos, processedItemPhotos, availableListingPhotos } from '@/shared/smartStudio';
export type ListingPhotoMode = 'original' | 'removed' | 'both';
export function listingPhotoPreset(media: readonly string[], attributes: Record<string,any>, mode: ListingPhotoMode): string[] {
 return mode === 'original' ? originalListingPhotos(media,attributes) : mode === 'removed' ? processedItemPhotos(media,attributes) : availableListingPhotos(media,attributes);
}
/** Adds to the same immutable archive; never revises eBay, deletes media or requires background removal. */
export async function addListingPhoto(tenantId:string,nicheId:string,itemId:string,source:'camera'|'library',isCurrent:()=>boolean):Promise<Item|null> {
 const before=await getItem(itemId);
 if(before.error||!before.item||before.item.tenantId!==tenantId||resolveProductionNiche(before.item.specialistId)!==nicheId)throw new Error(before.error??'Item is outside this workspace.');
 if(!isCurrent())throw new Error('Workspace changed. No photo was added.');
 const role=`seller_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,7)}`;
 const photo=source==='camera'?await captureFromCamera():await pickFromLibrary(role,'Seller photo');
 if(!photo||!isCurrent())return null;
 const saved=await persistCapturedItemPhotos(tenantId,itemId,[{...photo,slotId:role,slotLabel:'Seller photo'}],{processImages:shouldAutoRemoveBackground(nicheId),isCurrent});
 if(!saved.complete)throw new Error(saved.errors.join(' ')||'Photo could not be saved. Retry on the same item.');
 const after=await getItem(itemId);
 if(after.error||!after.item||after.item.tenantId!==tenantId||resolveProductionNiche(after.item.specialistId)!==nicheId)throw new Error('Added photo readback is pending. Reopen this item.');
 return after.item;
}
