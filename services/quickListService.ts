import AsyncStorage from '@react-native-async-storage/async-storage';
import { getSupabaseClient } from '@/template';
import { NICHE_MODULES } from '@/constants/niches';
import type { SpecialistId } from '@/constants/specialists';
import { type ProductLead, type QuickListNiche, type QuickAttributeEvidence } from '@/shared/quickList';
import { lookupProductBarcode } from './barcodeLookupService';
import { identifyItemWithAI, saveIdentifiedItem, prepareImageForAI, type CapturedImage, type AIIdentificationResult } from './aiIdentificationService';
import { generateListing, saveListing, submitListingToMarketplace, type GeneratedListing, type SavedListing } from './listingService';
import { invokeListingOperation, saveListingEditor } from './listingEditorService';
import { getMarketValue, type MarketValueResult } from './marketValueService';
import { persistCapturedItemPhotos } from './photoPersistenceService';
import { photoPersistenceIssue } from '@/shared/photoPersistence';
import type { QuickListState } from '@/contexts/QuickListContext';
import { linkStudioImages } from './smartStudioStorageService';
import { normalizeAntiqueAspects, validateAntiqueSpecifics, validateAntiqueListingBasics, selectAntiqueCondition, type AntiqueAspect, type AntiqueConditionPolicy } from '@/shared/antiqueListingPolicy';
import { verifyRevisionContent } from '@/shared/ebayRevisionContract';
import { getItem } from './itemService';
import { createQuickReuse, quickSemanticKey } from './quickListReuseService';
import { getSpecialistProfile, evaluateSpecialistSafety } from '@/shared/specialistIntelligence';
import { resolveProductionNiche } from './nicheRouting';
import { nicheBarcodeAllowed } from '@/shared/nichePolicy';
import { captureCanonicalId } from './captureIdentityService';
import { automaticListingPrice, automaticSpecifics } from './listingAutofillService';
import { preferredListingPhotos, availableListingPhotos, processedListingPhotoIssue } from '@/shared/smartStudio';
export interface QuickRequirements {categoryId:string;categoryName:string;aspects:AntiqueAspect[];conditions:AntiqueConditionPolicy;error?:string}
export interface QuickDraft {listing:SavedListing;generated:GeneratedListing;requirements:QuickRequirements;market:MarketValueResult|null;specifics:Array<{name:string;value:string}>;photos:string[];itemId:string;warnings?:string[];quantity?:number;specificEvidence?:QuickAttributeEvidence[]}
export async function lookupQuickBarcode(tenantId:string,value:string,type:string){
 return lookupProductBarcode(tenantId,value,type);
}
export async function warmQuickList(tenantId:string){
 const response=await getSupabaseClient().from('marketplace_connectors').select('status,can_publish,selected_fulfillment_policy_id,selected_return_policy_id,selected_payment_policy_id').eq('tenant_id',tenantId).eq('marketplace_id','ebay').maybeSingle();
 if(response.error)return response.error.message;const row=response.data;if(row?.status!=='connected'||row.can_publish!==true)return 'Connect an eBay account with publication permission in the existing Marketplaces settings.';
 const missing=[!row.selected_fulfillment_policy_id?'shipping policy':null,!row.selected_return_policy_id?'return policy':null,!row.selected_payment_policy_id?'payment policy':null].filter(Boolean);return missing.length?`Select your existing eBay ${missing.join(', ')} before publishing.`:null;
}
export async function identifyQuickPhotos(tenantId:string,nicheId:QuickListNiche,images:CapturedImage[],lead:ProductLead|null,measurements:Record<string,string>,options:{specialistId?:SpecialistId;mode?:string;allowPhotoWarnings?:boolean}={}){
 if(lead&&!nicheBarcodeAllowed(nicheId))return {result:null,error:'This specialist uses photographic identification, not retail barcode matching.'};
 const notes=Object.entries(measurements).filter(([name,value])=>!name.startsWith('_')&&value.trim()).map(([name,value])=>`${name}: ${value} (seller supplied; cross-check against photographs)`).join('\n');
 const known={weight:Number(measurements.weight)||undefined,diameter:Number(measurements.diameter)||undefined,material:measurements.material||undefined,customNotes:[notes,lead?`Barcode product LEAD, not confirmed: ${JSON.stringify(lead)}. Compare brand, model, edition and variant against both physical photographs. Report all contradictions. A barcode never proves physical condition.`:null].filter(Boolean).join('\n')};
 const specialistId=options.specialistId??NICHE_MODULES[nicheId].defaultSpecialist as SpecialistId;
 if(!NICHE_MODULES[nicheId].specialists.includes(specialistId))return {result:null,error:'Specialist does not belong to this workspace.'};
 return identifyItemWithAI(images,specialistId,undefined,known,{tenantId,presentationInParallel:true,...(options.mode?{captureMode:options.mode}:{}),...(options.allowPhotoWarnings?{allowPhotoWarnings:true}:{})});
}
/** Live provider research must never become an offline Numista catalogue. */
export function quickInventoryIdentification(result:AIIdentificationResult):AIIdentificationResult{
 const attributes={...result.attributes};for(const name of Object.keys(attributes))if(/numista_catalogue|catalogue_weight|catalogue_diameter|numista_references|coinResearch/i.test(name))delete attributes[name];
 return {...result,numistaVerification:undefined,numistaImageSearch:undefined,numistaTitle:undefined,attributes};
}
const requirementReuse=createQuickReuse<QuickRequirements>(5*60_000);
export async function quickRequirements(tenantId:string,title:string,lead:ProductLead|null,nicheId?:QuickListNiche):Promise<QuickRequirements>{
 let categoryId=lead?.categoryId??'',categoryName=lead?.categoryName??'';
 if(!categoryId){const search=await invokeListingOperation({route:'get_category_suggestions',tenantId,query:title.slice(0,100)},'swish-ebay-category');if(search.error)throw new Error(search.error);const rows=(search.data?.suggestions??[]).filter((row:any)=>row.isLeaf===true);if(!rows.length)throw new Error('No matching eBay category was returned.');categoryId=String(rows[0].id);categoryName=String(rows[0].name);}
 const session=await getSupabaseClient().auth.getSession();const userId=session.data.session?.user.id;if(session.error||!userId)throw new Error('A verified account is required for category lookup.');
 const result=await requirementReuse.get(`${userId}:${tenantId}:${nicheId??''}:EBAY_GB:${categoryId}`,async()=>{
  const [aspects,conditions]=await Promise.all([invokeListingOperation({route:'get_category_aspects',tenantId,categoryId,forceLive:true}),invokeListingOperation({route:'get_condition_policies',tenantId,categoryId})]);
  if(aspects.error||aspects.data?.success!==true||aspects.data?.isLeaf!==true||aspects.data?.marketplaceId!=='EBAY_GB'||String(aspects.data?.categoryId)!==categoryId)throw new Error(aspects.error??'eBay could not verify the selected leaf category and its requirements.');
  if(conditions.error||!conditions.data?.policy||String(conditions.data.policy.categoryId)!==categoryId)throw new Error(conditions.error??'Supported eBay conditions unavailable.');
  return {categoryId,categoryName,aspects:normalizeAntiqueAspects(aspects.data.aspects),conditions:conditions.data.policy};
 });
 return {...result,categoryName:categoryName||result.categoryName};
}
export async function createQuickInventory(tenantId:string,result:AIIdentificationResult,sessionId:string,quantity=1){
 const nicheId=resolveProductionNiche(result.specialistId);if(!nicheId||!Number.isSafeInteger(quantity)||quantity<1)throw new Error('Registered specialist and a positive whole quantity are required.');
 const canonicalItemId=await captureCanonicalId(tenantId,nicheId,sessionId);const saved=await saveIdentifiedItem(tenantId,quickInventoryIdentification(result),{canonicalItemId,captureSessionId:sessionId,quantity});
 if(saved.error||!saved.item)throw new Error(saved.error??'Inventory save not confirmed.');return saved.item;
}
export async function uploadQuickPhotos(tenantId:string,itemId:string,images:CapturedImage[]){
 const saved=await persistCapturedItemPhotos(tenantId,itemId,images,{processImages:false});
 if(!saved.complete)throw new Error(`Item saved. Retry photos on this item. ${saved.errors.join(' ')}`);return {urls:saved.urls,images:saved.images};
}
const copyReuse=createQuickReuse<Awaited<ReturnType<typeof generateListing>>>(5*60_000);
const valueReuse=createQuickReuse<Awaited<ReturnType<typeof getMarketValue>>>(5*60_000);
export async function prepareQuickDraft(tenantId:string,nicheId:QuickListNiche,itemId:string,result:AIIdentificationResult,photosPromise:Promise<{urls:string[];images:CapturedImage[]}>,requirementsPromise:Promise<QuickRequirements>,onValue:()=>void,firstOriginal?:CapturedImage,reuseScope='',quantity=1):Promise<QuickDraft>{
 const key=quickSemanticKey({tenantId,nicheId,itemId,reuseScope,title:result.canonicalTitle,specialistId:result.specialistId,attributes:result.attributes,confirmed:result.attributesConfirmed,condition:result.condition,photo:firstOriginal?.uri});
 const generatedPromise=copyReuse.get(key,()=>generateListing(itemId,tenantId),response=>!response.error&&Boolean(response.listing));
 const valuePromise=valueReuse.get(key,async()=>{const imageBase64=firstOriginal?await prepareImageForAI(firstOriginal.uri):undefined;return getMarketValue({tenantId,itemId,title:result.canonicalTitle,specialistId:result.specialistId,attributes:result.attributes,condition:result.condition,identificationConfidence:result.confidence,numistaTypeId:result.numistaTypeId,numistaMatchScore:result.numistaMatchScore,numistaMatchTier:result.numistaMatchTier,applyToItem:true,quickList:true,...(imageBase64?.startsWith('data:')?{imageBase64}:imageBase64?.startsWith('https:')?{imageUrls:[imageBase64]}:{})});},response=>!response.error&&Boolean(response.result));
 const researchPromise=valuePromise.then(response=>{if(!response.error&&response.result)onValue();return response;});
 const requirementsResult=requirementsPromise.catch(cause=>({categoryId:'',categoryName:'',aspects:[],conditions:{categoryId:'',itemConditionRequired:false,itemConditions:[]},error:cause instanceof Error?cause.message:'Category requirements unavailable.'} as QuickRequirements));
 const [copy,research,requirements,photos]=await Promise.all([generatedPromise,researchPromise,requirementsResult,photosPromise]);if(copy.error||!copy.listing)throw new Error(copy.error??'Listing copy unavailable.');
 const market=research.error?null:research.result,evidencePrice=automaticListingPrice(market);
 const generated={...copy.listing,recommended_price:evidencePrice,floor_price:0,ceiling_price:0};
 const canonical=await getItem(itemId);
 if(canonical.error||!canonical.item||canonical.item.tenantId!==tenantId||!NICHE_MODULES[nicheId].specialists.includes(canonical.item.specialistId))throw new Error(canonical.error??'Canonical photos could not be reopened.');
 const photoIssue=photoPersistenceIssue(canonical.item.media,canonical.item.attributes);if(photoIssue)throw new Error(photoIssue);
 if(photos.urls.some(url=>!canonical.item!.media.includes(url)))throw new Error('Captured originals are not all linked to the saved item. Retry photos before creating the draft.');
 const specifics=automaticSpecifics(nicheId,result,generated,requirements.aspects);
 const saved=await saveListing(tenantId,itemId,generated,'ebay',requirements.categoryId);if(saved.error||!saved.listing)throw new Error(saved.error??'Draft save not confirmed. Reopen the existing item; do not create a duplicate.');
 const profile=getSpecialistProfile(nicheId);
 const evidence=Array.isArray(result.attributes._quick_attribute_sources)?result.attributes._quick_attribute_sources as QuickAttributeEvidence[]:[];
 const specificEvidence=specifics.map(row=>{const descriptor=profile?.fields.find(field=>field.specific===row.name);const claims=evidence.filter(entry=>(entry.key===row.name||entry.key===descriptor?.key)&&entry.value===row.value&&entry.accepted);return {key:row.name,value:row.value,sources:[...new Set(claims.flatMap(entry=>entry.sources))],accepted:claims.length>0,note:claims.map(entry=>entry.note).join(' ')};});
 return {listing:saved.listing,generated,requirements,market,specifics,photos:preferredListingPhotos(canonical.item.media,canonical.item.attributes),itemId,quantity,specificEvidence,warnings:[...(requirements.error?[requirements.error]:[]),...(research.error?['Market value unavailable. Enter a price or save for later.']:[])]};
}
export interface QuickReviewInput {title:string;description:string;price:string;conditionId:string;conditionNotes:string;specifics:Array<{name:string;value:string}>;reviewedResult?:AIIdentificationResult}
/** Draft persistence accepts incomplete fields; publication still requires every existing safety check. */
export async function saveQuickReview(tenantId:string,nicheId:QuickListNiche,draft:QuickDraft,input:QuickReviewInput,mode:'publish'|'draft'='publish'){
 const canonical=await getItem(draft.itemId);
 if(canonical.error||!canonical.item||canonical.item.tenantId!==tenantId||!NICHE_MODULES[nicheId].specialists.includes(canonical.item.specialistId))return {error:canonical.error??'Item ownership could not be verified.'};
 const photos=preferredListingPhotos(canonical.item.media,canonical.item.attributes);
 if(mode==='publish'){
  if(draft.requirements.error)return {error:draft.requirements.error};
  const photoIssue=processedListingPhotoIssue(canonical.item.media,canonical.item.attributes,photos);if(photoIssue)return {error:photoIssue};
  const basic=validateAntiqueListingBasics({title:input.title,description:input.description,price:Number(input.price),quantity:draft.quantity??1,media:photos});if(basic)return {error:basic};
  const condition=selectAntiqueCondition(draft.requirements.conditions,input.conditionId);if(condition.error)return {error:condition.error};
  const issue=validateAntiqueSpecifics(input.specifics,draft.requirements.aspects);if(issue)return {error:issue};
  if(input.reviewedResult){if(!NICHE_MODULES[nicheId].specialists.includes(input.reviewedResult.specialistId))return {error:'Reviewed specialist scope differs from this item.'};const safety=evaluateSpecialistSafety(nicheId,input.reviewedResult.attributes);if(safety.blocked)return {error:safety.reasons.join(' ')};}
 }
 const supported=draft.requirements.conditions.itemConditions.find(row=>String(row.conditionId)===input.conditionId);
 const saved=await saveListingEditor({tenantId,listingId:draft.listing.id,nicheId,title:input.title,description:input.description,price:input.price||'0',shippingCost:String(draft.listing.shippingCost),floorPrice:'0',ceilingPrice:'0',categoryId:draft.requirements.categoryId,categoryName:draft.requirements.categoryName,condition:supported?.conditionDescription??canonical.item.condition,conditionId:supported?input.conditionId:'',conditionDescription:input.conditionNotes,quantity:String(draft.quantity??1),sku:canonical.item.sku||canonical.item.inventoryId||'',itemSpecifics:input.specifics.filter(row=>row.value.trim()),media:photos});
 if(saved.error)return saved;
 if(mode==='draft')return {error:null};
 const item=await getItem(draft.itemId);if(item.error||!item.item||item.item.tenantId!==tenantId||!NICHE_MODULES[nicheId].specialists.includes(item.item.specialistId))return {error:'Review provenance ownership could not be verified.'};
 const evidence:QuickAttributeEvidence[]=[...(Array.isArray(item.item.attributes._quick_attribute_sources)?item.item.attributes._quick_attribute_sources:[]),...(input.reviewedResult?.attributes._quick_attribute_sources??[]),...input.specifics.filter(row=>row.value.trim()).map(row=>({key:row.name,value:row.value.trim(),sources:['user_confirmation'] as QuickAttributeEvidence['sources'],accepted:true,note:'Approved by seller using List now for this saved draft.'}))];
 const uniqueEvidence=[...new Map(evidence.map(entry=>[quickSemanticKey(entry),entry])).values()];
 const attributes={...item.item.attributes,_quick_attribute_sources:uniqueEvidence};
 if(input.reviewedResult){for(const field of getSpecialistProfile(nicheId)?.fields??[])if(Object.prototype.hasOwnProperty.call(input.reviewedResult.attributes,field.key))attributes[field.key]=input.reviewedResult.attributes[field.key];if(input.reviewedResult.specialistAnalysis)attributes._specialist_analysis=input.reviewedResult.specialistAnalysis;}
 const written=await getSupabaseClient().from('items').update({attributes}).eq('id',draft.itemId).eq('tenant_id',tenantId).eq('updated_at',item.item.updatedAt).select('attributes').maybeSingle();
 if(written.error||!written.data||quickSemanticKey(written.data.attributes?._quick_attribute_sources)!==quickSemanticKey(uniqueEvidence))return {error:written.error?.message??'Item changed while retaining review sources. Reload this draft before publication.'};return {error:null};
}
export async function publishQuickDraft(tenantId:string,draft:QuickDraft,sessionId:string,onSubmit:()=>void){
 const result=await submitListingToMarketplace(tenantId,draft.listing.id,step=>{if(step==='publishing')onSubmit();});
 if(!result.success||!result.externalListingId)return {live:false,unconfirmed:result.publicationUnconfirmed||result.accepted,error:result.error??'Publication was not confirmed.',externalListingId:result.externalListingId};return confirmQuickLive(tenantId,draft,sessionId,result.externalListingId);
}
export async function confirmQuickLive(tenantId:string,draft:QuickDraft,sessionId:string,externalListingId:string){
 const [checked,saved]=await Promise.all([invokeListingOperation({route:'inspect_live',tenantId,listingId:draft.listing.id,externalListingId,quickListSessionId:sessionId}),getSupabaseClient().from('listings').select('title,description,price,external_listing_id,item_id,items!inner(tenant_id,specialist_id,status,media,attributes)').eq('tenant_id',tenantId).eq('items.tenant_id',tenantId).eq('id',draft.listing.id).eq('item_id',draft.itemId).maybeSingle()]);
 if(checked.error||checked.data?.live?.listingStatus!=='Active'||!Number.isSafeInteger(checked.data?.live?.availableQuantity)||checked.data.live.availableQuantity<=0)return {live:false,unconfirmed:true,error:checked.error??'eBay has not confirmed an active listing. Check status; do not publish again.',externalListingId};
 if(saved.error||!saved.data||saved.data.external_listing_id!==externalListingId)return {live:false,unconfirmed:true,error:'Live eBay identity is not yet linked to the canonical draft. Synchronise eBay; do not publish again.',externalListingId};
 const mismatch=verifyRevisionContent(checked.data.live,{externalListingId,title:saved.data.title,description:saved.data.description,price:Number(saved.data.price)});if(mismatch.length)return {live:false,unconfirmed:true,error:mismatch.join(' '),externalListingId};
 const inventory=saved.data.items as any;
 if(inventory?.tenant_id!==tenantId||inventory.status!=='listed'||photoPersistenceIssue(inventory.media??[],inventory.attributes??{})||draft.photos.some(url=>!availableListingPhotos(inventory.media??[],inventory.attributes??{}).includes(url)))return {live:false,unconfirmed:true,error:'eBay accepted the listing; canonical inventory/photos are not yet reconciled. Check the existing listing; do not resubmit.',externalListingId};
 return {live:true,unconfirmed:false,error:null,externalListingId};
}
export async function linkQuickCutouts(tenantId:string,itemId:string,images:CapturedImage[]){return linkStudioImages(tenantId,itemId,images);}
export async function readQuickAutoPublish(scope:string){return (await AsyncStorage.getItem(`@swish_quick_auto:${scope}`))==='opt-in-v1';}
export async function saveQuickAutoPublish(scope:string,enabled:boolean){await AsyncStorage.setItem(`@swish_quick_auto:${scope}`,enabled?'opt-in-v1':'disabled');}
const recoveryWrites=new Map<string,Promise<void>>();
export function retainQuickRecovery(scope:string,input:{itemId?:string;listingId?:string;images:CapturedImage[];sessionId:string;state?:QuickListState}):Promise<void>{
 if(!scope||(!input.images.length&&!input.itemId))return Promise.resolve();
 const state=input.state;if(state&&(state.scope!==scope||state.sessionId!==input.sessionId))return Promise.resolve();
 const sanitized=state?{...state,processing:false,barcodeBusy:false,reviewed:false,savedForLater:false,autoPublish:false,result:state.result?quickInventoryIdentification(state.result):null,draft:state.draft?{...state.draft,market:null}:null,timing:null}:undefined;
 const previous=recoveryWrites.get(scope)??Promise.resolve();const pending=previous.catch(()=>{}).then(()=>AsyncStorage.setItem(`@swish_quick_recovery:${scope}`,JSON.stringify({...input,state:sanitized})));
 recoveryWrites.set(scope,pending);void pending.finally(()=>{if(recoveryWrites.get(scope)===pending)recoveryWrites.delete(scope);}).catch(()=>{});return pending;
}
export async function readQuickRecovery(scope:string):Promise<{images:CapturedImage[];itemId?:string;listingId?:string;sessionId:string;state?:QuickListState}|null>{
 if(!scope)return null;await recoveryWrites.get(scope)?.catch(()=>{});const raw=await AsyncStorage.getItem(`@swish_quick_recovery:${scope}`);if(!raw)return null;const saved=JSON.parse(raw);
 if(!Array.isArray(saved.images)||saved.images.length>8||!saved.sessionId||saved.images.some((image:any)=>typeof image?.uri!=='string'||typeof image.slotId!=='string')||(saved.state&&(saved.state.scope!==scope||saved.state.sessionId!==saved.sessionId)))throw new Error('Retained scan is invalid. Open the saved inventory item instead.');
 if(saved.itemId){const item=await getItem(saved.itemId);const parts=scope.split(':');if(item.error||!item.item||item.item.tenantId!==parts[1]||!NICHE_MODULES[parts[2] as QuickListNiche]?.specialists.includes(item.item.specialistId))throw new Error('Retained item ownership could not be verified. Sign in to its original workspace.');
  if(saved.state?.draft){const listing=await getSupabaseClient().from('listings').select('id,item_id,external_listing_id,status').eq('id',saved.state.draft.listing.id).eq('tenant_id',item.item.tenantId).eq('item_id',item.item.id).maybeSingle();if(listing.error||!listing.data)throw new Error('Retained draft could not be verified. Reopen inventory.');if(listing.data.external_listing_id){saved.state.liveId=listing.data.external_listing_id;saved.state.unconfirmed=true;}}
 }return saved;
}
