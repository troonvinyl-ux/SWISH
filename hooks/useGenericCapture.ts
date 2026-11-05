import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useApp } from './useApp';
import { useTunesCatalogue } from './useTunesCatalogue';
import { musicGrade, isFreshMusicRelease } from '@/shared/musicRelease';
import { musicCaptureResult, musicCaptureSlots, musicDiscCount, retainedMusicSlots, switchMusicCaptureMode } from '@/services/musicCaptureService';
import { useAuth, useAlert } from '@/template';
import { captureFromCamera, pickFromLibrary, identifyItemWithAI, saveIdentifiedItem, uploadItemImages, updateItemMedia, saveCoinReferenceImages, prepareImageForAI, type AIIdentificationResult, type CapturedImage } from '@/services/aiIdentificationService';
import { getMarketValue, type MarketValueResult } from '@/services/marketValueService';
import { saveCaptureValuation } from '@/services/captureValuationService';
import { SPECIALISTS, type SpecialistId } from '@/constants/specialists';
import { getSpecialistProfile } from '@/shared/specialistIntelligence';
import { readCaptureDraft, persistCaptureDraft, retainCaptureImage, type CaptureDraft } from '@/services/captureDraftService';
import { inspectPhotoQuality } from '@/services/photoQualityService';
import { prepareCapturedImages } from '@/services/sharedImagePreparationService';
const emptyDraft=(specialistId:string):CaptureDraft=>({images:[],result:null,savedId:null,mode:'item',specialistId,answers:{}});
export function useGenericCapture(){
 const tunes=useTunesCatalogue();
 const {tenant,activeNiche,triggerInventoryReload}=useApp();const {user}=useAuth();const {showAlert}=useAlert();
 const scope=`${user?.id??''}:${tenant?.id??''}:${activeNiche.id}`;const current=useRef(scope);current.current=scope;const lock=useRef(false);const alive=useRef(true);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 const [draft,setDraft]=useState<CaptureDraft>(emptyDraft(activeNiche.defaultSpecialist));const [loadedScope,setLoadedScope]=useState('');
 const [busy,setBusy]=useState(false);const [market,setMarket]=useState<MarketValueResult|null>(null);const [phase,setPhase]=useState('');const [error,setError]=useState<string|null>(null);const [allowPhotoWarnings,setAllowPhotoWarnings]=useState(false);
 const profile=getSpecialistProfile(activeNiche.id);const ready=loadedScope===scope;const visible=ready?draft:emptyDraft(activeNiche.defaultSpecialist);const specialistId=visible.specialistId as SpecialistId;
 const music=activeNiche.id==='tunes_flip';
 // A different unconfirmed selection cannot inherit the previous release's confirmation.
 const musicRelease=music&&tunes.ready&&tunes.state.release&&!tunes.state.confirmed?null:music&&tunes.ready&&tunes.state.confirmed&&isFreshMusicRelease(tunes.state.release)?tunes.state.release:visible.musicRelease;
 const catalogueConfirmed=music&&isFreshMusicRelease(musicRelease);
 const discCount=musicDiscCount(visible.answers.observed_disc_count)??(catalogueConfirmed?musicRelease?.discCount:null)??1;
 const slots=useMemo(()=>music?retainedMusicSlots(musicCaptureSlots(visible.mode,discCount),visible.images):visible.mode==='part'?[
  {id:'main',label:'Complete component',description:'Show shape, mounting points and included hardware',required:true},
  {id:'part_number',label:'Part number / label',description:'Read the full stamped or printed model number',required:true},
  {id:'mounts',label:'Mounts and connections',description:'Show mounts, connectors and scale',required:false},
  {id:'condition',label:'Wear / damage',description:'Show damage, corrosion and missing parts',required:false},
 ]:SPECIALISTS[specialistId]?.captureRequirements??[],[music,visible.mode,discCount,visible.images,specialistId]);
 useEffect(()=>{
  let cancelled=false;setMarket(null);setError(null);setPhase('');setBusy(false);setLoadedScope('');setAllowPhotoWarnings(false);
  void readCaptureDraft(scope).then(saved=>{if(cancelled)return;const valid=saved&&activeNiche.specialists.includes(saved.specialistId as SpecialistId)&&Array.isArray(saved.images);setDraft(valid?saved:emptyDraft(activeNiche.defaultSpecialist));setLoadedScope(scope);}).catch(()=>{if(!cancelled){setDraft(emptyDraft(activeNiche.defaultSpecialist));setLoadedScope(scope);setError('Retained draft could not load. You can capture a new item; existing inventory is unchanged.');}});
  return()=>{cancelled=true;};
 },[scope,activeNiche.defaultSpecialist]);
 useEffect(()=>{if(!ready||!user||!tenant)return;const timer=setTimeout(()=>{void persistCaptureDraft(scope,draft).catch(()=>{if(current.current===scope)setError('Draft could not be retained on this device. Keep this screen open and retry.');});},250);return()=>clearTimeout(timer);},[draft,ready,scope,user?.id,tenant?.id]);
 // confirmedMusicAttributes now reaches the review immediately via musicCaptureResult.
 // Retain its timestamped CC0 snapshot in the same scoped draft, including across navigation.
 useEffect(()=>{
  if(!ready||!music||!tunes.ready||visible.savedId)return;
  const release=tunes.state.release;
  if(tunes.state.confirmed&&isFreshMusicRelease(release)){
   setDraft(previous=>previous.musicRelease?.id===release.id&&previous.musicRelease?.fetchedAt===release.fetchedAt?previous:{...previous,musicRelease:release});setMarket(null);
  }else if(release){setDraft(previous=>previous.musicRelease?{...previous,musicRelease:null}:previous);setMarket(null);}
 },[ready,music,tunes.ready,tunes.state.confirmed,tunes.state.release,visible.savedId]);
 const changeMode=useCallback((mode:string)=>{
  if(busy||visible.savedId||!profile?.modes.some(row=>row.id===mode))return;
  setMarket(null);setDraft(previous=>music?switchMusicCaptureMode(previous,mode):({...emptyDraft(previous.specialistId),mode}));setError(null);
 },[busy,profile,music,visible.savedId]);
 const changeSpecialist=useCallback((id:SpecialistId)=>{if(busy||!activeNiche.specialists.includes(id))return;setMarket(null);setDraft(emptyDraft(id));setError(null);},[busy,activeNiche]);
 const keepPhoto=useCallback(async(slotId:string,selected:{uri:string;width?:number;height?:number;photoQuality?:CapturedImage['photoQuality']})=>{
  const slot=slots.find(row=>row.id===slotId);if(!slot)return;
  if(selected.width&&selected.height&&Math.min(selected.width,selected.height)<320)throw new Error('This photo has too little detail. Move closer or upload a higher-resolution view.');
  // Copy the untouched file first, before analysis or any image manipulation.
  const retained=await retainCaptureImage({...selected,slotId,slotLabel:slot.label});
  const photoQuality=selected.photoQuality??await inspectPhotoQuality(retained.uri);
  const image={...retained,photoQuality};
  if(alive.current&&current.current===scope){setMarket(null);setAllowPhotoWarnings(false);setDraft(previous=>({...previous,images:[...previous.images.filter(row=>row.slotId!==slotId),image],result:null}));
   // Cleanup runs once with Identify, not on every photo capture.
  }
 },[slots,scope,tenant?.id,activeNiche.id]);
 const capture=useCallback(async(slotId:string,library:boolean)=>{
  const slot=slots.find(row=>row.id===slotId);if(!slot||lock.current||!ready||visible.savedId)return;
  if(visible.images.length>=8&&!visible.images.some(image=>image.slotId===slotId)){setError('Eight original views are retained. Remove an unwanted view before adding another.');return;}
  lock.current=true;setBusy(true);setError(null);
  try{const selected=library?await pickFromLibrary(slot.id,slot.label):await captureFromCamera();if(!selected||current.current!==scope)return;await keepPhoto(slotId,selected);}
  catch(cause:unknown){if(current.current===scope)setError(cause instanceof Error?cause.message:'Photo capture failed.');}
  finally{lock.current=false;if(current.current===scope){setBusy(false);setPhase('');}}
 },[scope,slots,ready,visible.savedId,visible.images,keepPhoto]);
 const addCapturedPhoto=useCallback(async(slotId:string,selected:{uri:string;width?:number;height?:number})=>{
  if(!slots.some(row=>row.id===slotId)||!selected.uri||!ready||visible.savedId||lock.current)return;
  if(visible.images.length>=8&&!visible.images.some(image=>image.slotId===slotId)){setError('Eight original views are retained. Remove an unwanted view before adding another.');return;}
  lock.current=true;setBusy(true);setError(null);
  try{await keepPhoto(slotId,selected);}catch(cause:unknown){if(current.current===scope)setError(cause instanceof Error?cause.message:'Could not keep this photograph.');}
  finally{lock.current=false;if(current.current===scope)setBusy(false);}
 },[slots,ready,visible.savedId,visible.images,scope,keepPhoto]);
 const removeCapturedPhoto=useCallback((slotId:string)=>{if(busy||visible.savedId)return;setMarket(null);setDraft(previous=>({...previous,images:previous.images.filter(image=>image.slotId!==slotId),result:null}));},[busy,visible.savedId]);
 const identify=useCallback(async()=>{
  if(!tenant||lock.current||!ready||!visible.images.length||visible.savedId)return;
  const missing=slots.filter(slot=>slot.required&&!visible.images.some(image=>image.slotId===slot.id));if(missing.length){setError(`Add the required photographs: ${missing.map(slot=>slot.label).join(', ')}.`);return;}
  lock.current=true;setBusy(true);setMarket(null);setPhase('Analysing specialist evidence');setError(null);
  try{
   setPhase('Cleaning and centring photos · preserving defects and lettering');
   const prepared=await prepareCapturedImages(visible.images,{tenantId:tenant.id,nicheId:activeNiche.id});
   setPhase('Analysing original specialist evidence');
   if(current.current!==scope)return;setDraft(previous=>({...previous,images:prepared}));
   const notes=Object.entries(visible.answers).filter(([,value])=>value.trim()).map(([key,value])=>`${key}: ${value} (user-supplied; cross-check)`).join('\n');
   const catalogue=tunes.state.release??musicRelease;
   const catalogueDetails=music&&isFreshMusicRelease(catalogue)?{artist:catalogue.artist,release_title:catalogue.releaseTitle,format:catalogue.format.join(', '),label:catalogue.labels.join(', '),catalogue_number:catalogue.catalogueNumbers.join(', '),year:catalogue.year,country:catalogue.country,expected_disc_count:catalogue.discCount,catalogue_context:'User-selected Discogs catalogue release; check readable identifiers. Catalogue disc count does not prove all discs are present.'}:{};
   const existingAttributes=music?Object.fromEntries(Object.entries({...visible.result?.attributes,...catalogueDetails,...visible.answers}).filter(([key,value])=>profile?.fields.some(field=>field.key===key)&&['string','number'].includes(typeof value))):visible.result?.attributes;
   const response=await identifyItemWithAI(prepared,specialistId,undefined,{customNotes:notes,existingAttributes},{tenantId:tenant.id,captureMode:visible.mode,allowPhotoWarnings});
   if(current.current!==scope)return;if(response.error||!response.result){setError(response.error??'No identification returned.');return;}setDraft(previous=>({...previous,result:response.result}));
  }catch(cause:unknown){if(current.current===scope)setError(cause instanceof Error?cause.message:'Identification failed.');}
  finally{lock.current=false;if(current.current===scope){setBusy(false);setPhase('');}}
 },[tenant?.id,ready,scope,visible,specialistId,allowPhotoWarnings,slots,activeNiche.id,music,profile,musicRelease,tunes.state.release]);
 const answer=useCallback((key:string,value:string)=>{if(busy||visible.savedId)return;setMarket(null);setDraft(previous=>({...previous,answers:{...previous.answers,[key]:value}}));},[busy,visible.savedId]);
 const correctTitle=useCallback((title:string)=>{if(busy||visible.savedId)return;setMarket(null);setDraft(previous=>music?{...previous,answers:{...previous.answers,_title:title}}:{...previous,result:previous.result?{...previous.result,canonicalTitle:title}:null});},[music,busy,visible.savedId]);
 const reviewedResult=useCallback(()=>{
  if(music)return musicCaptureResult(visible.result,musicRelease,visible.answers);
  if(!visible.result)return null;
  const result:AIIdentificationResult={...visible.result,attributes:{...visible.result.attributes}};
  if(result.specialistAnalysis)result.specialistAnalysis={...result.specialistAnalysis,fields:{...result.specialistAnalysis.fields}};
  for(const [key,value]of Object.entries(visible.answers)){if(!value.trim()||!profile?.fields.some(field=>field.key===key))continue;result.attributes[key]=value.trim();if(result.specialistAnalysis)result.specialistAnalysis.fields[key]={value:value.trim(),basis:'user_supplied',reason:'Entered during review; not independently verified.'};}
  if(visible.answers._condition?.trim())result.condition=visible.answers._condition.trim();if(visible.answers._condition_notes?.trim())result.conditionNotes=visible.answers._condition_notes.trim();return result;
 },[visible,profile,music,musicRelease]);
 const result=useMemo(()=>reviewedResult(),[reviewedResult]);
 const value=useCallback(async()=>{
  const reviewed=reviewedResult();if(!tenant||!reviewed||lock.current||!ready)return;lock.current=true;setBusy(true);setMarket(null);setError(null);setPhase('Retrieving market comparisons');
  try{const original=visible.images[0]?await prepareImageForAI(visible.images[0].uri):undefined;const response=await getMarketValue({tenantId:tenant.id,title:reviewed.canonicalTitle,specialistId:reviewed.specialistId,attributes:reviewed.attributes,condition:reviewed.condition,identificationConfidence:reviewed.confidence,applyToItem:false,...(original?.startsWith('data:image/')?{imageBase64:original}:original?.startsWith('https://')?{imageUrls:[original]}:{})});if(current.current!==scope)return;if(response.error||!response.result){setError(response.error??'No market evidence returned.');return;}setMarket(response.result);}
  catch{if(current.current===scope)setError('Market evidence could not be retrieved. No price was inferred.');}finally{lock.current=false;if(current.current===scope){setBusy(false);setPhase('');}}
 },[tenant?.id,reviewedResult,ready,scope,visible.images]);
 const save=useCallback(async()=>{
  const result=reviewedResult();
  if(music&&result&&(!musicGrade(String(result.attributes.media_grade))||!musicGrade(String(result.attributes.sleeve_grade))||(result.attributes.discogs_pressing_confirmed!==true&&!/^yes$/i.test(String(result.attributes.pressing_reviewed))))){setError('Confirm the exact pressing (Discogs or manual review) and separate media/sleeve grades before saving.');return;}
  if(result&&!activeNiche.specialists.includes(result.specialistId)){setError('This result belongs to another specialist. Nothing was saved.');return;}
  if(!tenant||!result||lock.current||!ready||!result.canonicalTitle.trim())return;
  if(music&&!visible.savedId){
   const missing=slots.filter(slot=>slot.required&&!visible.images.some(image=>image.slotId===slot.id));if(missing.length){setError(`Add the required photographs: ${missing.map(slot=>slot.label).join(', ')}.`);return;}
   if(visible.mode==='cd_box_set'&&!musicDiscCount(visible.answers.observed_disc_count)){setError('Enter the whole number of discs physically present; catalogue disc count does not confirm completeness.');return;}
  }
  lock.current=true;setBusy(true);setPhase(visible.savedId?'Retrying saved media':'Saving reviewed inventory');setError(null);let id=visible.savedId;
  try{
   if(!id){const cost=Number(visible.answers._acquired_cost??0);const quantity=Number(visible.answers._quantity??1);if(!Number.isFinite(cost)||cost<0||!Number.isInteger(quantity)||quantity<1)throw new Error('Enter a non-negative acquisition cost and a whole quantity of at least one.');const response=await saveIdentifiedItem(tenant.id,result,{mediaUris:[],acquiredCost:cost,quantity});if(response.error||!response.item)throw new Error(response.error??'Inventory save not confirmed.');id=response.item.id;const savedDraft={...visible,result,savedId:id};if(current.current===scope)setDraft(savedDraft);await persistCaptureDraft(scope,savedDraft);triggerInventoryReload();}
   if(current.current!==scope)return;
   // Required photo persistence must finish before optional valuation/reference writes.
   setPhase('Uploading and linking original photographs');
   const upload=await uploadItemImages(id,visible.images,true);
   if(current.current!==scope)return;
   if(upload.urls.length){await updateItemMedia(tenant.id,id,upload.urls);if(current.current===scope)triggerInventoryReload();}
   if(upload.errors.length||upload.urls.length!==visible.images.length)throw new Error(`Inventory is saved; some original photos need retry. ${upload.errors.join(' ')} Retry here without creating another item.`);
   if(market){const failure=await saveCaptureValuation(tenant.id,id,market);if(failure)throw new Error(`Original photos are saved, but valuation could not be linked: ${failure} Retry here without creating another item.`);}
   if(current.current!==scope)return;
   const references=await saveCoinReferenceImages(tenant.id,id,visible.images);if(references.errors.length)throw new Error('Original photos are saved. Some viewing aids could not be linked. Retry here without creating another item.');if(current.current===scope)triggerInventoryReload();
  }catch(cause:unknown){if(current.current===scope)setError(cause instanceof Error?cause.message:'Save failed.');}finally{lock.current=false;if(current.current===scope){setBusy(false);setPhase('');}}
 },[tenant?.id,ready,visible,scope,reviewedResult,triggerInventoryReload,activeNiche,market,music,slots]);
 const retryStudio=useCallback(async()=>{
  if(busy||!ready||lock.current||!tenant)return;lock.current=true;setBusy(true);setPhase('Preparing studio views; original evidence retained');
  try{const images=await prepareCapturedImages(visible.images.map(image=>({...image,studio:undefined})),{tenantId:tenant.id,nicheId:activeNiche.id});if(alive.current&&current.current===scope)setDraft(previous=>({...previous,images}));}
  finally{lock.current=false;if(alive.current&&current.current===scope){setBusy(false);setPhase('');}}
 },[busy,ready,tenant?.id,visible.images,activeNiche.id,scope]);
 const reset=useCallback(()=>{if(busy)return;const clear=()=>{if(music)tunes.reset();setMarket(null);setDraft(emptyDraft(activeNiche.defaultSpecialist));setError(null);setAllowPhotoWarnings(false);};if(visible.savedId)clear();else showAlert('Discard capture draft?','This removes this unsaved draft, not any inventory record.',[{text:'Keep draft',style:'cancel'},{text:'Discard draft',style:'destructive',onPress:clear}]);},[busy,activeNiche.defaultSpecialist,music,visible.savedId,showAlert,tunes.reset]);
 return {market:ready?market:null,value,retryStudio,allowPhotoWarnings,setAllowPhotoWarnings,activeNiche,profile,slots,images:visible.images,addCapturedPhoto,removeCapturedPhoto,result,catalogueConfirmed,catalogueExpired:music&&Boolean(visible.musicRelease)&&!isFreshMusicRelease(visible.musicRelease),discCount,busy:busy||!ready,savedId:visible.savedId,error,phase,answers:visible.answers,mode:visible.mode,specialistId,capture,identify,save,reset,answer,correctTitle,changeMode,changeSpecialist};
}
