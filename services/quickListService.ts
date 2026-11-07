import AsyncStorage from '@react-native-async-storage/async-storage';
import { getSupabaseClient } from '@/template';
import { NICHE_MODULES } from '@/constants/niches';
import type { SpecialistId } from '@/constants/specialists';
import { normalizeProductBarcode, type ProductLead, type QuickListNiche } from '@/shared/quickList';
import { identifyItemWithAI, saveIdentifiedItem, updateItemMedia, prepareImageForAI, type CapturedImage, type AIIdentificationResult } from './aiIdentificationService';
import { generateListing, saveListing, submitListingToMarketplace, type GeneratedListing, type SavedListing } from './listingService';
import { invokeListingOperation, saveListingEditor } from './listingEditorService';
import { getMarketValue, type MarketValueResult } from './marketValueService';
import { uploadUntouchedOriginal } from './originalImageService';
import { linkStudioImages } from './smartStudioStorageService';
import { normalizeAntiqueAspects, seedAntiqueSpecifics, validateAntiqueSpecifics, validateAntiqueListingBasics, selectAntiqueCondition, type AntiqueAspect, type AntiqueConditionPolicy } from '@/shared/antiqueListingPolicy';
import { verifyRevisionContent } from '@/shared/ebayRevisionContract';
import { getItem } from './itemService';
export interface QuickRequirements {categoryId:string;categoryName:string;aspects:AntiqueAspect[];conditions:AntiqueConditionPolicy}
export interface QuickDraft {listing:SavedListing;generated:GeneratedListing;requirements:QuickRequirements;market:MarketValueResult|null;specifics:Array<{name:string;value:string}>;photos:string[];itemId:string}
export async function lookupQuickBarcode(tenantId:string,value:string,type:string){const gtin=normalizeProductBarcode(value,type);if(!gtin)return {products:[] as ProductLead[],error:'Barcode is not a valid product GTIN. Use photo identification.'};const response=await invokeListingOperation({route:'barcode_lookup',tenantId,gtin},'swish-ebay-browse');return {products:(response.data?.products??[]) as ProductLead[],error:response.error??(response.data?.status==='unavailable'?response.data.message:null)};}
export async function warmQuickList(tenantId:string){const response=await getSupabaseClient().from('marketplace_connectors').select('status,can_publish,selected_fulfillment_policy_id,selected_return_policy_id,selected_payment_policy_id').eq('tenant_id',tenantId).eq('marketplace_id','ebay').maybeSingle();if(response.error)return response.error.message;const row=response.data;if(row?.status!=='connected'||row.can_publish!==true)return 'Connect an eBay account with publication permission in the existing Marketplaces settings.';const missing=[!row.selected_fulfillment_policy_id?'shipping policy':null,!row.selected_return_policy_id?'return policy':null,!row.selected_payment_policy_id?'payment policy':null].filter(Boolean);return missing.length?`Select your existing eBay ${missing.join(', ')} before publishing.`:null;}
export async function identifyQuickPhotos(tenantId:string,nicheId:QuickListNiche,images:CapturedImage[],lead:ProductLead|null,measurements:Record<string,string>){
 const known={weight:Number(measurements.weight)||undefined,diameter:Number(measurements.diameter)||undefined,material:measurements.material||undefined,customNotes:[measurements.notes,measurements.thickness?`Measured thickness ${measurements.thickness} mm`:null,lead?`Barcode product LEAD, not confirmed: ${JSON.stringify(lead)}. Compare brand, model, edition and variant against both physical photographs. Report all contradictions. A barcode never proves physical condition.`:null].filter(Boolean).join('\n')};
 // Use the canonical module specialist so identity, valuation and inventory stay
 // in the same authorized niche. The legacy generic catch-all is not Collectibles.
 const specialistId=NICHE_MODULES[nicheId].defaultSpecialist as SpecialistId;
 return identifyItemWithAI(images,specialistId,undefined,known,{tenantId,presentationInParallel:true});
}
/** Numista shortlist, catalogue specifications and sales records must never become an offline catalogue. */
export function quickInventoryIdentification(result:AIIdentificationResult):AIIdentificationResult {
 const attributes={...result.attributes};for(const key of Object.keys(attributes))if(/numista_catalogue|catalogue_weight|catalogue_diameter|numista_references|coinResearch/i.test(key))delete attributes[key];
 return {...result,numistaVerification:undefined,numistaImageSearch:undefined,numistaTitle:undefined,attributes};
}
export async function quickRequirements(tenantId:string,title:string,lead:ProductLead|null):Promise<QuickRequirements>{
 let categoryId=lead?.categoryId??'',categoryName=lead?.categoryName??'';
 if(!categoryId){const search=await invokeListingOperation({route:'get_category_suggestions',tenantId,query:title.slice(0,100)},'swish-ebay-category');if(search.error)throw new Error(search.error);const rows=(search.data?.suggestions??[]).filter((row:any)=>row.isLeaf===true);if(rows.length!==1)throw new Error('Category is ambiguous. Select the correct category here before preparing the draft.');categoryId=String(rows[0].id);categoryName=String(rows[0].name);}
 const [validation,aspects,conditions]=await Promise.all([invokeListingOperation({route:'validate_category',tenantId,categoryId},'swish-ebay-category'),invokeListingOperation({route:'get_category_aspects',tenantId,categoryId,forceLive:true}),invokeListingOperation({route:'get_condition_policies',tenantId,categoryId})]);
 if(validation.error||validation.data?.valid!==true||validation.data?.isLeaf!==true)throw new Error(validation.error??'eBay could not verify the selected leaf category.');if(aspects.error||!aspects.data?.success)throw new Error(aspects.error??'Category requirements unavailable.');if(conditions.error||!conditions.data?.policy)throw new Error(conditions.error??'Supported eBay conditions unavailable.');
 return {categoryId,categoryName,aspects:normalizeAntiqueAspects(aspects.data.aspects),conditions:conditions.data.policy};
}
export async function createQuickInventory(tenantId:string,result:AIIdentificationResult){const saved=await saveIdentifiedItem(tenantId,quickInventoryIdentification(result));if(saved.error||!saved.item)throw new Error(saved.error??'Inventory save not confirmed.');return saved.item;}
export async function uploadQuickPhotos(tenantId:string,itemId:string,images:CapturedImage[]){
 // Two independent originals may upload concurrently. Same content-addressed path and byte readback as shared capture.
 const originals=await Promise.all(images.map(async image=>{const saved=await uploadUntouchedOriginal(itemId,image.slotId,image.uri);return {...image,originalStorageUri:saved.url,originalByteHash:saved.hash};}));
 const urls=originals.map(image=>image.originalStorageUri);await updateItemMedia(tenantId,itemId,urls);return {urls,images:originals};
}
const copyFlights=new Map<string,ReturnType<typeof generateListing>>();
const valueFlights=new Map<string,ReturnType<typeof getMarketValue>>();
export async function prepareQuickDraft(tenantId:string,nicheId:QuickListNiche,itemId:string,result:AIIdentificationResult,photosPromise:Promise<{urls:string[];images:CapturedImage[]}>,requirementsPromise:Promise<QuickRequirements>,onValue:()=>void,firstOriginal?:CapturedImage):Promise<QuickDraft>{
 // Copy generation is independent of market research and taxonomy. It is generated once, not replayed for price updates.
 const key=`${tenantId}:${nicheId}:${itemId}`;
 let generatedPromise=copyFlights.get(key);if(!generatedPromise){generatedPromise=generateListing(itemId,tenantId);copyFlights.set(key,generatedPromise);}
 let valuePromise=valueFlights.get(key);if(!valuePromise){valuePromise=(async()=>{const imageBase64=firstOriginal?await prepareImageForAI(firstOriginal.uri):undefined;return getMarketValue({tenantId,itemId,title:result.canonicalTitle,specialistId:result.specialistId,attributes:result.attributes,condition:result.condition,identificationConfidence:result.confidence,numistaTypeId:result.numistaTypeId,numistaMatchScore:result.numistaMatchScore,numistaMatchTier:result.numistaStatus,applyToItem:true,quickList:true,...(imageBase64?.startsWith('data:')?{imageBase64}:imageBase64?.startsWith('https:')?{imageUrls:[imageBase64]}: {})});})();valueFlights.set(key,valuePromise);}
 const researchPromise=valuePromise.then(response=>{onValue();return response;});
 if(copyFlights.size>32)copyFlights.delete(copyFlights.keys().next().value!);if(valueFlights.size>32)valueFlights.delete(valueFlights.keys().next().value!);
 const [copy,research,requirements,photos]=await Promise.all([generatedPromise,researchPromise,requirementsPromise,photosPromise]);if(copy.error||!copy.listing)throw new Error(copy.error??'Listing copy unavailable.');
 const market=research.result;const evidencePrice=market?.valuation.recommendedListingPrice??0;
 // An indicative model/asking-based recommendation always needs a seller price confirmation in this screen.
 const generated={...copy.listing,recommended_price:Number.isFinite(evidencePrice)&&evidencePrice>0?evidencePrice:0,floor_price:0,ceiling_price:0};
 const saved=await saveListing(tenantId,itemId,generated,'ebay',requirements.categoryId);if(saved.error||!saved.listing)throw new Error(saved.error??'Draft save not confirmed. Reopen the existing item; do not create a duplicate.');
 const known={...result.attributesConfirmed,...(result.attributes._specialist_analysis?{_specialist_analysis:result.attributes._specialist_analysis}: {})};
 for(const aspect of requirements.aspects){const match=Object.entries(result.attributesConfirmed).find(([name])=>name.replace(/_/g,' ').toLowerCase()===aspect.name.toLowerCase());if(match&&typeof match[1]==='string')known[aspect.name]=match[1];}
 const specifics=seedAntiqueSpecifics([],requirements.aspects,known);
 return {listing:saved.listing,generated,requirements,market,specifics,photos:photos.urls,itemId};
}
export async function saveQuickReview(tenantId:string,nicheId:QuickListNiche,draft:QuickDraft,input:{title:string;description:string;price:string;conditionId:string;conditionNotes:string;specifics:Array<{name:string;value:string}>}){
 const basic=validateAntiqueListingBasics({title:input.title,description:input.description,price:Number(input.price),quantity:1,media:draft.photos});if(basic)return {error:basic};
 const condition=selectAntiqueCondition(draft.requirements.conditions,input.conditionId);if(condition.error)return {error:condition.error};const issue=validateAntiqueSpecifics(input.specifics,draft.requirements.aspects);if(issue)return {error:issue};
 const supported=draft.requirements.conditions.itemConditions.find(row=>String(row.conditionId)===input.conditionId);
 return saveListingEditor({tenantId,listingId:draft.listing.id,nicheId,title:input.title,description:input.description,price:input.price,shippingCost:String(draft.listing.shippingCost),floorPrice:'0',ceilingPrice:'0',categoryId:draft.requirements.categoryId,categoryName:draft.requirements.categoryName,condition:supported?.conditionDescription??'Condition reviewed by seller',conditionId:input.conditionId,conditionDescription:input.conditionNotes,quantity:'1',sku:'',itemSpecifics:input.specifics.filter(row=>row.value.trim()),media:draft.photos});
}
export async function publishQuickDraft(tenantId:string,draft:QuickDraft,sessionId:string,onSubmit:()=>void){
 const result=await submitListingToMarketplace(tenantId,draft.listing.id,step=>{if(step==='publishing')onSubmit();});
 if(!result.success||!result.externalListingId)return {live:false,unconfirmed:result.publicationUnconfirmed||result.accepted,error:result.error??'Publication was not confirmed.',externalListingId:result.externalListingId};
 return confirmQuickLive(tenantId,draft,sessionId,result.externalListingId);
}
export async function confirmQuickLive(tenantId:string,draft:QuickDraft,sessionId:string,externalListingId:string){
 const [checked,inventory]=await Promise.all([invokeListingOperation({route:'inspect_live',tenantId,listingId:draft.listing.id,externalListingId,quickListSessionId:sessionId}),getItem(draft.itemId)]);
 if(checked.error||checked.data?.live?.listingStatus!=='Active'||checked.data?.live?.availableQuantity<=0)return {live:false,unconfirmed:true,error:checked.error??'eBay has not confirmed an active listing. Check status; do not publish again.',externalListingId};
 const saved=await getSupabaseClient().from('listings').select('title,description,price,external_listing_id').eq('tenant_id',tenantId).eq('id',draft.listing.id).maybeSingle();
 if(saved.error||!saved.data||saved.data.external_listing_id!==externalListingId)return {live:false,unconfirmed:true,error:'Live eBay identity is not yet linked to the canonical draft. Synchronise eBay; do not publish again.',externalListingId};
 const mismatch=verifyRevisionContent(checked.data.live,{externalListingId,title:saved.data.title,description:saved.data.description,price:Number(saved.data.price)});
 if(mismatch.length)return {live:false,unconfirmed:true,error:mismatch.join(' '),externalListingId};
 return {live:true,unconfirmed:false,error:inventory.error||inventory.item?.status!=='listed'?'Live on eBay; canonical inventory synchronisation is pending.':null,externalListingId};
}
export async function linkQuickCutouts(tenantId:string,itemId:string,images:CapturedImage[]){return linkStudioImages(tenantId,itemId,images);}
export async function readQuickAutoPublish(scope:string){return (await AsyncStorage.getItem(`@swish_quick_auto:${scope}`))==='opt-in-v1';}
export async function saveQuickAutoPublish(scope:string,enabled:boolean){await AsyncStorage.setItem(`@swish_quick_auto:${scope}`,enabled?'opt-in-v1':'disabled');}
export async function retainQuickRecovery(scope:string,input:{itemId?:string;listingId?:string;images:CapturedImage[];sessionId:string}){await AsyncStorage.setItem(`@swish_quick_recovery:${scope}`,JSON.stringify(input));}
export async function readQuickRecovery(scope:string){const raw=await AsyncStorage.getItem(`@swish_quick_recovery:${scope}`);return raw?JSON.parse(raw):null;}
