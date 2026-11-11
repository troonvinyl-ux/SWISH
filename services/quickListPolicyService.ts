// Pure universal policy over the existing registry, specialist profiles and photo roles.
import { NICHE_MODULES } from '@/constants/niches';
import type { CaptureRequirement } from '@/constants/specialists';
import { nicheCaptureSlots } from './nicheCaptureService';
import { getNicheWorkflowPolicy, nicheBarcodeAllowed } from '@/shared/nichePolicy';
import { getSpecialistProfile, evaluateSpecialistSafety, usefulText } from '@/shared/specialistIntelligence';
import { sameGtin, normalizeProductBarcode, type QuickListNiche, type ProductLead, type QuickAttributeEvidence } from '@/shared/quickList';
import type { AIIdentificationResult, CapturedImage } from './aiIdentificationService';
export function quickBarcodeSupported(niche:QuickListNiche):boolean{return nicheBarcodeAllowed(niche);}
export function quickStartsWithBarcode(niche:QuickListNiche):boolean{return getNicheWorkflowPolicy(niche)?.barcode==='start';}
export function quickCaptureSlots(niche:QuickListNiche,specialistId:string=NICHE_MODULES[niche].defaultSpecialist,mode='item',discCount?:string):CaptureRequirement[]{
 return nicheCaptureSlots(niche,specialistId,mode,discCount);
}
export function quickMissingPhotos(slots:CaptureRequirement[],images:readonly CapturedImage[]):CaptureRequirement[]{return slots.filter(slot=>slot.required&&!images.some(image=>image.slotId===slot.id));}
const normalized=(value:unknown)=>usefulText(value).toLowerCase().replace(/[^a-z0-9]/g,'');
function resolveNicheForBarcode(result:AIIdentificationResult):string{return Object.keys(NICHE_MODULES).find(id=>NICHE_MODULES[id as QuickListNiche].specialists.includes(result.specialistId))??'';}
/** Exact GTIN plus a title identifies a catalogue lead; a model/MPN is not required for toys, games or books. */
export function specificBarcodeLead(lead:ProductLead):boolean{return Boolean(lead&&typeof lead.id==='string'&&lead.id.trim()&&typeof lead.title==='string'&&lead.title.trim()&&typeof lead.gtin==='string'&&normalizeProductBarcode(lead.gtin));}
export function barcodeAgreesWithPhotos(lead:ProductLead|null,result:AIIdentificationResult):boolean{
 if(!result.canonicalTitle?.trim()||!nicheBarcodeAllowed(resolveNicheForBarcode(result))||!lead||!specificBarcodeLead(lead)||result.evidenceContradictory.length)return false;
 const confirmed={...result.attributesConfirmed};
 for(const [key,entry] of Object.entries(result.specialistAnalysis?.fields??{}))if(entry.basis==='observed')confirmed[key]=entry.value;
 const gtin=usefulText(confirmed.barcode??confirmed.EAN??confirmed.UPC??confirmed.ISBN);
 if(gtin&&!sameGtin(normalizeProductBarcode(gtin)??'',lead.gtin))return false;
 if(lead.source==='OnSpace AI'){
  // A barcode repeated by AI is not corroboration of the proposed name or platform.
  const words=lead.title.toLowerCase().replace(/[^a-z0-9]+/g,' ').split(' ').filter(word=>word.length>=3&&!['the','for','and','with','used','new'].includes(word));
  const observed=new Set(result.canonicalTitle.toLowerCase().replace(/[^a-z0-9]+/g,' ').split(' '));
  const unique=[...new Set(words)],matches=unique.filter(word=>observed.has(word));
  if(unique.length<2||matches.length/unique.length<0.75)return false;
  const variants=Object.entries(lead.specifics??{}).filter(([key,value])=>/edition|variant|size|colou?r|shade|capacity|storage|volume|platform|format|language/i.test(key)&&usefulText(value));
  return variants.every(([key,value])=>Object.entries(confirmed).some(([name,physical])=>normalized(name)===normalized(key)&&normalized(physical)===normalized(value)));
 }
 if(gtin&&sameGtin(gtin,lead.gtin))return true;
 const brandModel=Boolean(normalized(lead.brand)&&normalized(lead.model)&&normalized(confirmed.brand??confirmed.manufacturer??confirmed.Brand)===normalized(lead.brand)&&normalized(confirmed.model??confirmed.model_number??confirmed.Model)===normalized(lead.model));
 if(!brandModel)return false;
 // A shared model is insufficient if the catalogue specifies a size/edition/storage variant.
 const profile=getSpecialistProfile(resolveNicheForBarcode(result));
 return Object.entries(lead.specifics??{}).filter(([key,value])=>/edition|variant|size|colou?r|shade|capacity|storage|volume|platform|format|language/i.test(key)&&usefulText(value)).every(([key,value])=>{
  const field=profile?.fields.find(row=>row.specific?.toLowerCase()===key.toLowerCase());
  const match=Object.entries(confirmed).find(([name])=>normalized(name)===normalized(key)||name===field?.key);
  return Boolean(match&&normalized(match[1])===normalized(value));
 });
}
export function enrichQuickIdentification(result:AIIdentificationResult,niche:QuickListNiche,lead:ProductLead|null,answers:Record<string,string>):AIIdentificationResult{
 const attributes={...result.attributes},confirmed={...result.attributesConfirmed};
 const analysis=result.specialistAnalysis?{...result.specialistAnalysis,fields:{...result.specialistAnalysis.fields}}:undefined;
 const evidence:QuickAttributeEvidence[]=[];
 for(const [key,value] of Object.entries(result.attributesConfirmed)){const text=usefulText(value);if(text)evidence.push({key,value:text,sources:['specialist_identification'],accepted:true,note:'Specialist-confirmed proposal; not independent authentication.'});}
 for(const [key,entry] of Object.entries(result.specialistAnalysis?.fields??{})){
  evidence.push({key,value:entry.value,sources:entry.basis==='user_supplied'&&/Data provided by Discogs/i.test(entry.reason)?['external_catalogue','user_confirmation']:[entry.basis==='observed'?'photograph':entry.basis==='user_supplied'?'user_confirmation':'specialist_identification'],accepted:entry.basis!=='inferred',note:entry.reason});
  if(entry.basis!=='inferred')confirmed[key]=entry.value;else delete confirmed[key];
 }
 for(const field of getSpecialistProfile(niche)?.fields??[]){const value=answers[field.key]?.trim();if(!value)continue;attributes[field.key]=value;confirmed[field.key]=value;delete attributes[`_inferred_${field.key}`];if(analysis)analysis.fields[field.key]={value,basis:'user_supplied',reason:'Seller supplied this value during Quick List review.'};evidence.push({key:field.key,value,sources:['user_confirmation'],accepted:true,note:'Seller statement, not independent certification.'});}
 const next={...result,attributes,attributesConfirmed:confirmed,...(analysis?{specialistAnalysis:analysis}:{}),condition:answers._condition?.trim()||result.condition,conditionNotes:answers._condition_notes?.trim()||result.conditionNotes};
 const matched=barcodeAgreesWithPhotos(lead,next);
 if(lead)for(const [key,value] of Object.entries(lead.specifics??{}))if(usefulText(value)){
  const ai=lead.source==='OnSpace AI',observed=Object.entries(confirmed).some(([name,physical])=>normalized(name)===normalized(key)&&normalized(physical)===normalized(value));
  evidence.push({key,value,sources:[ai?'ai_barcode_research':'barcode_catalogue'],accepted:matched&&(!ai||observed),note:`${lead.source} product ${lead.id}; ${ai?'AI research proposal; each listing fact still requires physical or seller evidence':matched?'exact identifier or brand/model corroborated in photographs':'unverified product lead, not listing evidence'}.`});
 }
 if(matched&&lead&&lead.source!=='OnSpace AI')for(const [key,value] of Object.entries(lead.specifics??{}))if(!usefulText(confirmed[key])&&usefulText(value)&&!/condition|grade|tested|authentic|quantity|compatib|fitment/i.test(key))confirmed[key]=value;
 if(lead&&matched&&(lead.source!=='OnSpace AI'||sameGtin(normalizeProductBarcode(usefulText(confirmed.barcode??confirmed.EAN??confirmed.UPC??confirmed.ISBN))??'',lead.gtin)))confirmed.EAN=lead.gtin;
 for(const [key,value] of Object.entries(attributes))if(key==='discogs_release_id'||key==='catalogue_number'||key==='numista_reference')if(usefulText(value))evidence.push({key,value:usefulText(value),sources:['external_catalogue'],accepted:false,note:'Catalogue reference/claim; verify the exact physical item.'});
 for(const [key,value] of Object.entries(result.attributes))if(!key.startsWith('_')&&usefulText(value)&&!evidence.some(entry=>entry.key===key))evidence.push({key,value:usefulText(value),sources:['specialist_identification'],accepted:false,note:'Uncorroborated specialist proposal; not an established listing fact.'});
 attributes._quick_attribute_sources=evidence;attributes._quick_barcode_match=matched;return next;
}
export function quickReviewIssue(niche:QuickListNiche,result:AIIdentificationResult,slots:CaptureRequirement[],images:CapturedImage[]):string|null{
 if(!NICHE_MODULES[niche].specialists.includes(result.specialistId))return 'Identification belongs to another specialist; nothing can be published here.';
 const missing=quickMissingPhotos(slots,images);if(missing.length)return `Add required photographs: ${missing.map(slot=>slot.label).join(', ')}.`;
 if(result.confidence<(getNicheWorkflowPolicy(niche)?.quickReviewMinimum??1)||result.identificationState==='observation_only'||result.evidenceContradictory.length||result.specialistAnalysis?.quality.status==='retake')return 'Identification is ambiguous, contradictory or needs a retake. Resolve the evidence before publication.';
 const safety=evaluateSpecialistSafety(niche,result.attributes);if(safety.blocked)return safety.reasons.join(' ');
 return null;
}
