import { useState, useRef, useEffect, useCallback } from 'react';
import { useApp } from './useApp';
import { useTunesCatalogue } from './useTunesCatalogue';
import { confirmedMusicAttributes, musicGrade, isFreshMusicRelease } from '@/shared/musicRelease';
import { useAuth, useAlert } from '@/template';
import { captureFromCamera, pickFromLibrary, identifyItemWithAI, saveIdentifiedItem, uploadItemImages, updateItemMedia, saveCoinReferenceImages, prepareImageForAI, type AIIdentificationResult } from '@/services/aiIdentificationService';
import { getMarketValue, type MarketValueResult } from '@/services/marketValueService';
import { saveCaptureValuation } from '@/services/captureValuationService';
import { SPECIALISTS, type SpecialistId } from '@/constants/specialists';
import { getSpecialistProfile } from '@/shared/specialistIntelligence';
import { readCaptureDraft, persistCaptureDraft, retainCaptureImage, type CaptureDraft } from '@/services/captureDraftService';
import { inspectPhotoQuality } from '@/services/photoQualityService';
import { generateSharedObjectImageReference } from '@/services/sharedImagePreparationService';
const emptyDraft=(specialistId:string):CaptureDraft=>({images:[],result:null,savedId:null,mode:'item',specialistId,answers:{}});
export function useGenericCapture(){
 const tunes=useTunesCatalogue();
 const {tenant,activeNiche,triggerInventoryReload}=useApp();const {user}=useAuth();const {showAlert}=useAlert();
 const scope=`${user?.id??''}:${tenant?.id??''}:${activeNiche.id}`;const current=useRef(scope);current.current=scope;const lock=useRef(false);
 const [draft,setDraft]=useState<CaptureDraft>(emptyDraft(activeNiche.defaultSpecialist));const [loadedScope,setLoadedScope]=useState('');
 const [busy,setBusy]=useState(false);const [market,setMarket]=useState<MarketValueResult|null>(null);const [phase,setPhase]=useState('');const [error,setError]=useState<string|null>(null);const [allowPhotoWarnings,setAllowPhotoWarnings]=useState(false);
 const profile=getSpecialistProfile(activeNiche.id);const ready=loadedScope===scope;const visible=ready?draft:emptyDraft(activeNiche.defaultSpecialist);const specialistId=visible.specialistId as SpecialistId;
 const slots=visible.mode==='part'?[{id:'main',label:'Complete component',description:'Show shape, mounting points and included hardware',required:true},{id:'part_number',label:'Part number / label',description:'Read the full stamped or printed model number',required:true},{id:'mounts',label:'Mounts and connections',description:'Show mounts, connectors and scale',required:false},{id:'condition',label:'Wear / damage',description:'Show damage, corrosion and missing parts',required:false}]:SPECIALISTS[specialistId]?.captureRequirements??[];
 useEffect(()=>{
  let cancelled=false;setMarket(null);setError(null);setPhase('');setBusy(false);setLoadedScope('');setAllowPhotoWarnings(false);
  void readCaptureDraft(scope).then(saved=>{if(cancelled)return;const valid=saved&&activeNiche.specialists.includes(saved.specialistId as SpecialistId)&&Array.isArray(saved.images);setDraft(valid?saved:emptyDraft(activeNiche.defaultSpecialist));setLoadedScope(scope);}).catch(()=>{if(!cancelled){setDraft(emptyDraft(activeNiche.defaultSpecialist));setLoadedScope(scope);setError('Retained draft could not load. You can capture a new item; existing inventory is unchanged.');}});
  return()=>{cancelled=true;};
 },[scope,activeNiche.defaultSpecialist]);
 useEffect(()=>{if(!ready||!user||!tenant)return;const timer=setTimeout(()=>{void persistCaptureDraft(scope,draft).catch(()=>{if(current.current===scope)setError('Draft could not be retained on this device. Keep this screen open and retry.');});},250);return()=>clearTimeout(timer);},[draft,ready,scope,user?.id,tenant?.id]);
 const changeMode=useCallback((mode:string)=>{if(busy||!profile?.modes.some(row=>row.id===mode))return;setMarket(null);setDraft(previous=>({...emptyDraft(previous.specialistId),mode}));setError(null);},[busy,profile]);
 const changeSpecialist=useCallback((id:SpecialistId)=>{if(busy||!activeNiche.specialists.includes(id))return;setMarket(null);setDraft(emptyDraft(id));setError(null);},[busy,activeNiche]);
 const capture=useCallback(async(slotId:string,library:boolean)=>{
  const slot=slots.find(row=>row.id===slotId);if(!slot||lock.current||!ready||visible.savedId)return;lock.current=true;setBusy(true);setError(null);
  try{const selected=library?await pickFromLibrary(slot.id,slot.label):await captureFromCamera();if(!selected||current.current!==scope)return;setAllowPhotoWarnings(false);if(selected.width&&selected.height&&Math.min(selected.width,selected.height)<320)throw new Error('This photo has too little detail. Retake closer or upload a higher-resolution view.');const photoQuality=selected.photoQuality??await inspectPhotoQuality(selected.uri);const image=await retainCaptureImage({...selected,photoQuality,slotId,slotLabel:slot.label});if(current.current===scope){setMarket(null);setDraft(previous=>({...previous,images:[...previous.images.filter(row=>row.slotId!==slotId),image],result:null}));}}
  catch(cause:unknown){if(current.current===scope)setError(cause instanceof Error?cause.message:'Photo capture failed.');}
  finally{lock.current=false;if(current.current===scope){setBusy(false);setPhase('');}}
 },[scope,slots,ready,visible.savedId]);
 const addCapturedPhoto=useCallback(async(slotId:string,selected:{uri:string;width?:number;height?:number})=>{
  const slot=slots.find(row=>row.id===slotId);if(!slot||!selected.uri||!ready||visible.savedId||lock.current)return;lock.current=true;
  try{if(selected.width&&selected.height&&Math.min(selected.width,selected.height)<320)throw new Error('This photo has too little detail. Move closer and retry.');const photoQuality=await inspectPhotoQuality(selected.uri);const image=await retainCaptureImage({...selected,photoQuality,slotId,slotLabel:slot.label});if(current.current===scope){setMarket(null);setAllowPhotoWarnings(false);setDraft(previous=>({...previous,images:[...previous.images.filter(row=>row.slotId!==slotId),image],result:null}));}}
  catch(cause:unknown){if(current.current===scope)setError(cause instanceof Error?cause.message:'Could not keep this photograph.');}finally{lock.current=false;}
 },[slots,ready,visible.savedId,scope]);
 const removeCapturedPhoto=useCallback((slotId:string)=>{if(busy||visible.savedId)return;setMarket(null);setDraft(previous=>({...previous,images:previous.images.filter(image=>image.slotId!==slotId),result:null}));},[busy,visible.savedId]);
 const identify=useCallback(async()=>{
  if(!tenant||lock.current||!ready||!visible.images.length||visible.savedId)return;const missing=slots.filter(slot=>slot.required&&!visible.images.some(image=>image.slotId===slot.id));if(missing.length){setError(`Add the required photographs: ${missing.map(slot=>slot.label).join(', ')}.`);return;}
  lock.current=true;setBusy(true);setMarket(null);setPhase('Analysing specialist evidence');setError(null);
  try{const prepared=activeNiche.id!=='coins'?visible.images.map(image=>({...image,enhancedUri:undefined})):await Promise.all(visible.images.map(async image=>{if(image.enhancedUri)return image;try{const result=await generateSharedObjectImageReference(image.uri);return {...image,enhancedUri:result.enhancedUri,enhancementStatus:'ready' as const,enhancementWarning:result.warning};}catch{return {...image,enhancementStatus:'failed' as const,enhancementWarning:'Viewing aid unavailable; original photograph remains evidence.'};}}));if(current.current!==scope)return;setDraft(previous=>({...previous,images:prepared}));const notes=Object.entries(visible.answers).filter(([,value])=>value.trim()).map(([key,value])=>`${key}: ${value} (user-supplied; cross-check)`).join('\n');const response=await identifyItemWithAI(prepared,specialistId,undefined,{customNotes:notes,existingAttributes:visible.result?.attributes},{tenantId:tenant.id,captureMode:visible.mode,allowPhotoWarnings});if(current.current!==scope)return;if(response.error||!response.result){setError(response.error??'No identification returned.');return;}setDraft(previous=>({...previous,result:response.result}));}
  catch(cause:unknown){if(current.current===scope)setError(cause instanceof Error?cause.message:'Identification failed.');}finally{lock.current=false;if(current.current===scope){setBusy(false);setPhase('');}}
 },[tenant?.id,ready,scope,visible,specialistId,allowPhotoWarnings,slots,activeNiche.id]);
 const answer=useCallback((key:string,value:string)=>{setMarket(null);setDraft(previous=>({...previous,answers:{...previous.answers,[key]:value}}));},[]);
 const correctTitle=useCallback((title:string)=>{setMarket(null);setDraft(previous=>({...previous,result:previous.result?{...previous.result,canonicalTitle:title}:null}));},[]);
 const reviewedResult=useCallback(()=>{
  if(!visible.result)return null;const result:AIIdentificationResult={...visible.result,attributes:{...visible.result.attributes}};if(result.specialistAnalysis)result.specialistAnalysis={...result.specialistAnalysis,fields:{...result.specialistAnalysis.fields}};
  for(const [key,value]of Object.entries(visible.answers)){if(!value.trim()||!profile?.fields.some(field=>field.key===key))continue;result.attributes[key]=value.trim();if(result.specialistAnalysis)result.specialistAnalysis.fields[key]={value:value.trim(),basis:'user_supplied',reason:'Entered during review; not independently verified.'};}
  if(activeNiche.id==='tunes_flip') {
   if(tunes.state.confirmed&&isFreshMusicRelease(tunes.state.release)) {
    result.attributes={...result.attributes,...confirmedMusicAttributes(tunes.state.release,true)};
    result.canonicalTitle=tunes.state.release.title;result.identificationSource='user_confirmed';
    if(result.specialistAnalysis)for(const key of ['artist','release_title','format','label','catalogue_number','year','country','genre','style'])result.specialistAnalysis.fields[key]={value:String(result.attributes[key]??''),basis:'user_supplied',reason:'User-confirmed individual Discogs catalogue release; not independent authentication.'};
   }
   result.attributes.pressing_reviewed=visible.answers.pressing_reviewed??(tunes.state.confirmed?'yes':'no');
   const media=musicGrade(visible.answers.media_grade??'');const sleeve=musicGrade(visible.answers.sleeve_grade??'');
   result.attributes.media_grade=media??'';result.attributes.sleeve_grade=sleeve??'';
   result.condition=`Media ${media??'unassessed'} / Sleeve ${sleeve??'unassessed'}; playback ${visible.answers.play_test??'not tested'}`;
  }
  if(visible.answers._condition?.trim())result.condition=visible.answers._condition.trim();if(visible.answers._condition_notes?.trim())result.conditionNotes=visible.answers._condition_notes.trim();return result;
 },[visible,profile,activeNiche.id,tunes.state.confirmed,tunes.state.release]);
 const value=useCallback(async()=>{
  const result=reviewedResult();if(!tenant||!result||lock.current||!ready)return;lock.current=true;setBusy(true);setMarket(null);setError(null);setPhase('Retrieving market comparisons');
  try{const original=visible.images[0]?await prepareImageForAI(visible.images[0].uri):undefined;const response=await getMarketValue({tenantId:tenant.id,title:result.canonicalTitle,specialistId:result.specialistId,attributes:result.attributes,condition:result.condition,identificationConfidence:result.confidence,applyToItem:false,...(original?.startsWith('data:image/')?{imageBase64:original}:original?.startsWith('https://')?{imageUrls:[original]}:{})});if(current.current!==scope)return;if(response.error||!response.result){setError(response.error??'No market evidence returned.');return;}setMarket(response.result);}
  catch{if(current.current===scope)setError('Market evidence could not be retrieved. No price was inferred.');}finally{lock.current=false;if(current.current===scope){setBusy(false);setPhase('');}}
 },[tenant?.id,reviewedResult,ready,scope,activeNiche.id,visible.images]);
 const save=useCallback(async()=>{
  const result=reviewedResult();if(activeNiche.id==='tunes_flip'&&result&&(!musicGrade(String(result.attributes.media_grade))||!musicGrade(String(result.attributes.sleeve_grade))||(!result.attributes.discogs_pressing_confirmed&&!/^yes$/i.test(String(result.attributes.pressing_reviewed))))){setError('Confirm the exact pressing (Discogs or manual review) and separate media/sleeve grades before saving.');return;}if(result&&!activeNiche.specialists.includes(result.specialistId)){setError('This result belongs to another specialist. Nothing was saved.');return;}if(!tenant||!result||lock.current||!result.canonicalTitle.trim())return;
  lock.current=true;setBusy(true);setPhase(visible.savedId?'Retrying saved media':'Saving reviewed inventory');setError(null);let id=visible.savedId;
  try{
   if(!id){const cost=Number(visible.answers._acquired_cost??0);const quantity=Number(visible.answers._quantity??1);if(!Number.isFinite(cost)||cost<0||!Number.isInteger(quantity)||quantity<1)throw new Error('Enter a non-negative acquisition cost and a whole quantity of at least one.');const response=await saveIdentifiedItem(tenant.id,result,{mediaUris:[],acquiredCost:cost,quantity});if(response.error||!response.item)throw new Error(response.error??'Inventory save not confirmed.');id=response.item.id;const savedDraft={...visible,result,savedId:id};if(current.current===scope)setDraft(savedDraft);await persistCaptureDraft(scope,savedDraft);triggerInventoryReload();}
   if(current.current!==scope)return;
   // Required photo persistence must finish before optional valuation/reference writes.
   setPhase('Uploading and linking original photographs');
   const upload=await uploadItemImages(id,visible.images,true);
   if(current.current!==scope)return;
   // Preserve successful uploads even when another angle fails; retain this item ID for retry.
   if(upload.urls.length){await updateItemMedia(tenant.id,id,upload.urls);if(current.current===scope)triggerInventoryReload();}
   if(upload.errors.length||upload.urls.length!==visible.images.length)throw new Error(`Inventory is saved; some original photos need retry. ${upload.errors.join(' ')} Retry here without creating another item.`);
   if(market){const failure=await saveCaptureValuation(tenant.id,id,market);if(failure)throw new Error(`Original photos are saved, but valuation could not be linked: ${failure} Retry here without creating another item.`);}
   if(current.current!==scope)return;
   const references=activeNiche.id!=='coins'?{errors:[]}:await saveCoinReferenceImages(tenant.id,id,visible.images);if(references.errors.length)throw new Error('Original photos are saved. Some viewing aids could not be linked. Retry here without creating another item.');if(current.current===scope)triggerInventoryReload();
  }catch(cause:unknown){if(current.current===scope)setError(cause instanceof Error?cause.message:'Save failed.');}finally{lock.current=false;if(current.current===scope){setBusy(false);setPhase('');}}
 },[tenant?.id,visible,scope,reviewedResult,triggerInventoryReload,activeNiche,market]);
 const reset=useCallback(()=>{if(busy)return;const clear=()=>{if(activeNiche.id==='tunes_flip')tunes.reset();setMarket(null);setDraft(emptyDraft(activeNiche.defaultSpecialist));setError(null);setAllowPhotoWarnings(false);};if(visible.savedId)clear();else showAlert('Discard capture draft?','This removes this unsaved draft, not any inventory record.',[{text:'Keep draft',style:'cancel'},{text:'Discard draft',style:'destructive',onPress:clear}]);},[busy,activeNiche.defaultSpecialist,visible.savedId,showAlert]);
 return {market:ready?market:null,value,allowPhotoWarnings,setAllowPhotoWarnings,activeNiche,profile,slots,images:visible.images,addCapturedPhoto,removeCapturedPhoto,result:visible.result,busy:busy||!ready,savedId:visible.savedId,error,phase,answers:visible.answers,mode:visible.mode,specialistId,capture,identify,save,reset,answer,correctTitle,changeMode,changeSpecialist};
}
