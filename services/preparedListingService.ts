// One saved-stock preparation path. Never regenerate or republish an existing listing.
import { getItem } from './itemService';
import { getItemListings } from './listingService';
import { NICHE_MODULES } from '@/constants/niches';
import type { QuickListNiche } from '@/shared/quickList';
import { existingOriginalPhotos, processExistingItemPhoto } from './existingImageStudioService';
import { inventoryIdentification, automaticCondition } from './listingAutofillService';
import { quickRequirements, prepareQuickDraft, saveQuickReview, type QuickDraft } from './quickListService';
import { createQuickReuse } from './quickListReuseService';
const preparation=createQuickReuse<{draft:QuickDraft|null;existingId:string;price:string;conditionId:string;conditionNotes:string}>(5*60_000);
export function prepareInventoryListing(tenantId:string,nicheId:QuickListNiche,itemId:string,userId:string){
 return preparation.get(`${userId}:${tenantId}:${nicheId}:${itemId}`,async()=>{
  const [read,listings]=await Promise.all([getItem(itemId),getItemListings(itemId)]);
  if(read.error||!read.item||read.item.tenantId!==tenantId||!NICHE_MODULES[nicheId].specialists.includes(read.item.specialistId))throw new Error(read.error??'Item not available in this workspace.');
  if(listings.error)throw new Error(listings.error);
  const existing=listings.listings.find(row=>row.externalListingId||['draft','pending','failed','active','live'].includes(row.status));
  if(existing)return {draft:null,existingId:existing.id,price:'',conditionId:'',conditionNotes:''};
  const item=read.item,result=inventoryIdentification(item),originals=existingOriginalPhotos(item);
  if(!originals.length)throw new Error('Add photographs to this saved item first.');
  // Reuse accepted processed assets; attempt each missing view once, keeping originals.
  for(const originalUri of originals)await processExistingItemPhoto({tenantId,nicheId,itemId,userId,originalUri});
  const selected=item.attributes.ebay_category_id?{categoryId:String(item.attributes.ebay_category_id),categoryName:String(item.attributes.ebay_category_name??'')} as Parameters<typeof quickRequirements>[2]:null;
  const photos=Promise.resolve({urls:originals,images:originals.map((uri,index)=>({uri,slotId:`stored_${index}`,slotLabel:`Photo ${index+1}`}))});
  const draft=await prepareQuickDraft(tenantId,nicheId,itemId,result,photos,quickRequirements(tenantId,item.canonicalTitle,selected,nicheId),()=>{},{uri:originals[0],slotId:'stored_0',slotLabel:'Photo 1'},`inventory:${itemId}`,item.quantity??1);
  const price=String(draft.generated.recommended_price||item.expectedSellingPrice||0),conditionId=automaticCondition(draft.requirements.conditions,item.condition,draft.generated.condition_id),conditionNotes=item.conditionNotes||draft.generated.condition_description;
  const saved=await saveQuickReview(tenantId,nicheId,draft,{title:draft.generated.title,description:draft.generated.description,price,conditionId,conditionNotes,specifics:draft.specifics},'draft');
  if(saved.error)throw new Error(saved.error);
  return {draft,existingId:'',price,conditionId,conditionNotes};
 });
}
