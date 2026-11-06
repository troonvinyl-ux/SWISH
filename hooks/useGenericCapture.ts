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
import { persistCaptureDraft, retainCaptureImage, type CaptureDraft } from '@/services/captureDraftService';
import { createEmptyCaptureDraft as emptyDraft } from '@/services/scannerSessionService';
import { useScannerSession } from './useScannerSession';
import { inspectPhotoQuality } from '@/services/photoQualityService';
import { prepareCapturedImages } from '@/services/sharedImagePreparationService';

export function useGenericCapture(){
 const tunes=useTunesCatalogue();
 const {tenant,activeNiche,moduleEpoch,triggerInventoryReload}=useApp();const {user}=useAuth();const {showAlert}=useAlert();
 const storageScope=`${user?.id??''}:${tenant?.id??''}:${activeNiche.id}`;
 const {scope,current,restart}=useScannerSession(`${storageScope}:${moduleEpoch}`);
 const lock=useRef(false);const alive=useRef(true);
 const isCurrentSession=useCallback(()=>Boolean(scope)&&alive.current&&current.current===scope,[scope,current]);
 const tunesRef=useRef(tunes);tunesRef.current=tunes;
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 const [draft,setDraft]=useState<CaptureDraft>(emptyDraft(activeNiche.defaultSpecialist));const [loadedScope,setLoadedScope]=useState('');
 const [busy,setBusy]=useState(false);const [market,setMarket]=useState<MarketValueResult|null>(null);const [phase,setPhase]=useState('');const [error,setError]=useState<string|null>(null);const [allowPhotoWarnings,setAllowPhotoWarnings]=useState(false);
 const profile=getSpecialistProfile(activeNiche.id);const ready=Boolean(scope)&&loadedScope===scope;const visible=ready?draft:emptyDraft(activeNiche.defaultSpecialist);const specialistId=visible.specialistId as SpecialistId;
 const music=activeNiche.id==='tunes_flip';
 // Catalogue selection is usable only within an active scan. Never display stale review while entering.
 const musicRelease=!ready?null:music&&tunes.ready&&tunes.state.release&&!tunes.state.confirmed?null:music&&tunes.ready&&tunes.state.confirmed&&isFreshMusicRelease(tunes.state.release)?tunes.state.release:visible.musicRelease;
 const catalogueConfirmed=music&&isFreshMusicRelease(musicRelease);
 const discCount=musicDiscCount(visible.answers.observed_disc_count)??(catalogueConfirmed?musicRelease?.discCount:null)??1;
 const slots=useMemo(()=>music?retainedMusicSlots(musicCaptureSlots(visible.mode,discCount),visible.images):visible.mode==='part'?[
  {id:'main',label:'Complete component',description:'Show shape, mounting points and included hardware',required:true},
  {id:'part_number',label:'Part number / label',description:'Read the full stamped or printed model number',required:true},
  {id:'mounts',label:'Mounts and connections',description:'Show mounts, connectors and scale',required:false},
  {id:'condition',label:'Wear / damage',description:'Show damage, corrosion and missing parts',required:false},
 ]:SPECIALISTS[specialistId]?.captureRequirements??[],[music,visible.mode,discCount,visible.images,specialistId]);
 useEffect(()=>{
  // Every entry starts a new physical item, even when Expo keeps the tab mounted.
  const fresh=emptyDraft(activeNiche.defaultSpecialist);
  lock.current=false;setDraft(fresh);setMarket(null);setError(null);setPhase('');setBusy(false);setLoadedScope(scope);setAllowPhotoWarnings(false);
  if(scope&&user&&tenant){void persistCaptureDraft(storageScope,fresh).catch(()=>{if(current.current===scope)setError('Local scan state could not be cleared. Saved inventory is unchanged.');});}
  return()=>{if(scope&&music)tunesRef.current.reset();};
 },[scope,storageScope,activeNiche.defaultSpecialist,music,user?.id,tenant?.id,current]);
 useEffect(()=>{if(!ready||!user||!tenant)return;const timer=setTimeout(()=>{if(!isCurrentSession())return;void persistCaptureDraft(storageScope,draft).catch(()=>{if(isCurrentSession())setError('Draft could not be retained on this device. Keep this screen open and retry.');});},250);return()=>clearTimeout(timer);},[draft,ready,scope,storageScope,user?.id,tenant?.id,isCurrentSession]);
 // Confirmed catalogue fields reach the review immediately without another identification request.
 // The timestamped CC0 snapshot belongs to this physical-item scan visit only.
 useEffect(()=>{
  if(!isCurrentSession()||!ready||!music||!tunes.ready||visible.savedId)return;
  const release=tunes.state.release;
  if(tunes.state.confirmed&&isFreshMusicRelease(release)){
   setDraft(previous=>previous.musicRelease?.id===release.id&&previous.musicRelease?.fetchedAt===release.fetchedAt?previous:{...previous,musicRelease:release});setMarket(null);
  }else if(release){setDraft(previous=>previous.musicRelease?{...previous,musicRelease:null}:previous);setMarket(null);}
 },[ready,music,tunes.ready,tunes.state.confirmed,tunes.state.release,visible.savedId,isCurrentSession]);
 const changeMode=useCallback((mode:string)=>{
  if(!isCurrentSession()||lock.current||busy||visible.savedId||!profile?.modes.some(row=>row.id===mode))return;
  setMarket(null);setDraft(previous=>music?switchMusicCaptureMode(previous,mode):({...emptyDraft(previous.specialistId),mode}));setError(null);
 },[busy,profile,music,visible.savedId,isCurrentSession]);
 const changeSpecialist=useCallback((id:SpecialistId)=>{if(!isCurrentSession()||lock.current||busy||visible.savedId||!activeNiche.specialists.includes(id))return;setMarket(null);setDraft(emptyDraft(id));setError(null);},[busy,activeNiche,visible.savedId,isCurrentSession]);
 const keepPhoto=useCallback(async(slotId:string,selected:{uri:string;width?:number;height?:number;photoQuality?:CapturedImage['photoQuality']})=>{
  const slot=slots.find(row=>row.id===slotId);if(!isCurrentSession()||!slot)return;
  if(selected.width&&selected.height&&Math.min(selected.width,selected.height)<320)throw new Error('This photo has too little detail. Move closer or upload a higher-resolution view.');
  // Copy the untouched file before analysis or any image manipulation.
  const retained=await retainCaptureImage({...selected,slotId,slotLabel:slot.label});
  if(!isCurrentSession())return;
  const photoQuality=selected.photoQuality??await inspectPhotoQuality(retained.uri);
  const image={...retained,photoQuality};
  if(isCurrentSession()){setMarket(null);setAllowPhotoWarnings(false);setDraft(previous=>({...previous,images:[...previous.images.filter(row=>row.slotId!==slotId),image],result:null}));}
 },[slots,isCurrentSession]);
 const capture=useCallback(async(slotId:string,library:boolean)=>{
  const slot=slots.find(row=>row.id===slotId);if(!isCurrentSession()||!slot||lock.current||!ready||visible.savedId)return;
  if(visible.images.length>=8&&!visible.images.some(image=>image.slotId===slotId)){setError('Eight original views are retained. Remove an unwanted view before adding another.');return;}
  lock.current=true;setBusy(true);setError(null);
  try{const selected=library?await pickFromLibrary(slot.id,slot.label):await captureFromCamera();if(!selected||!isCurrentSession())return;await keepPhoto(slotId,selected);}
  catch(cause:unknown){if(isCurrentSession())setError(cause instanceof Error?cause.message:'Photo capture failed.');}
  finally{if(isCurrentSession()){lock.current=false;setBusy(false);setPhase('');}}
 },[slots,ready,visible.savedId,visible.images,keepPhoto,isCurrentSession]);
 const addCapturedPhoto=useCallback(async(slotId:string,selected:{uri:string;width?:number;height?:number})=>{
  if(!isCurrentSession()||!slots.some(row=>row.id===slotId)||!selected.uri||!ready||visible.savedId||lock.current)return;
  if(visible.images.length>=8&&!visible.images.some(image=>image.slotId===slotId)){setError('Eight original views are retained. Remove an unwanted view before adding another.');return;}
  lock.current=true;setBusy(true);setError(null);
  try{await keepPhoto(slotId,selected);}catch(cause:unknown){if(isCurrentSession())setError(cause instanceof Error?cause.message:'Could not keep this photograph.');}
  finally{if(isCurrentSession()){lock.current=false;setBusy(false);}}
 },[slots,ready,visible.savedId,visible.images,keepPhoto,isCurrentSession]);
 const removeCapturedPhoto=useCallback((slotId:string)=>{if(!isCurrentSession()||lock.current||busy||visible.savedId)return;setMarket(null);setDraft(previous=>({...previous,images:previous.images.filter(image=>image.slotId!==slotId),result:null}));},[busy,visible.savedId,isCurrentSession]);
 const identify=useCallback(async()=>{
  if(!isCurrentSession()||!tenant||lock.current||!ready||!visible.images.length||visible.savedId)return;
  const missing=slots.filter(slot=>slot.required&&!visible.images.some(image=>image.slotId===slot.id));if(missing.length){setError(`Add the required photographs: ${missing.map(slot=>slot.label).join(', ')}.`);return;}
  lock.current=true;setBusy(true);setMarket(null);setPhase('Analysing specialist evidence');setError(null);
  try{
   setPhase('Cleaning and centring photos · preserving defects and lettering');
   const prepared=await prepareCapturedImages(visible.images,{tenantId:tenant.id,nicheId:activeNiche.id});
   if(!isCurrentSession())return;
   setPhase('Analysing original specialist evidence');setDraft(previous=>({...previous,images:prepared}));
   const notes=Object.entries(visible.answers).filter(([,value])=>value.trim()).map(([key,value])=>`${key}: ${value} (user-supplied; cross-check)`).join('\n');
   const catalogue=tunes.state.release??musicRelease;
   const catalogueDetails=music&&isFreshMusicRelease(catalogue)?{artist:catalogue.artist,release_title:catalogue.releaseTitle,format:catalogue.format.join(', '),label:catalogue.labels.join(', '),catalogue_number:catalogue.catalogueNumbers.join(', '),year:catalogue.year,country:catalogue.country,expected_disc_count:catalogue.discCount,catalogue_context:'User-selected Discogs catalogue release; check readable identifiers. Catalogue disc count does not prove all discs are present.'}:{};
   const existingAttributes=music?Object.fromEntries(Object.entries({...visible.result?.attributes,...catalogueDetails,...visible.answers}).filter(([key,value])=>profile?.fields.some(field=>field.key===key)&&['string','number'].includes(typeof value))):visible.result?.attributes;
   const response=await identifyItemWithAI(prepared,specialistId,undefined,{customNotes:notes,existingAttributes},{tenantId:tenant.id,captureMode:visible.mode,allowPhotoWarnings});
   if(!isCurrentSession())return;if(response.error||!response.result){setError(response.error??'No identification returned.');return;}setDraft(previous=>({...previous,result:response.result}));
  }catch(cause:unknown){if(isCurrentSession())setError(cause instanceof Error?cause.message:'Identification failed.');}
  finally{if(isCurrentSession()){lock.current=false;setBusy(false);setPhase('');}}
 },[tenant?.id,ready,visible,specialistId,allowPhotoWarnings,slots,activeNiche.id,music,profile,musicRelease,tunes.state.release,isCurrentSession]);
 const answer=useCallback((key:string,value:string)=>{if(!isCurrentSession()||lock.current||busy||visible.savedId)return;setMarket(null);setDraft(previous=>({...previous,answers:{...previous.answers,[key]:value}}));},[busy,visible.savedId,isCurrentSession]);
 const correctTitle=useCallback((title:string)=>{if(!isCurrentSession()||lock.current||busy||visible.savedId)return;setMarket(null);setDraft(previous=>music?{...previous,answers:{...previous.answers,_title:title}}:{...previous,result:previous.result?{...previous.result,canonicalTitle:title}:null});},[music,busy,visible.savedId,isCurrentSession]);
 const reviewedResult=useCallback(()=>{
  if(!ready)return null;
  if(music)return musicCaptureResult(visible.result,musicRelease,visible.answers);
  if(!visible.result)return null;
  const result:AIIdentificationResult={...visible.result,attributes:{...visible.result.attributes}};
  if(result.specialistAnalysis)result.specialistAnalysis={...result.specialistAnalysis,fields:{...result.specialistAnalysis.fields}};
  for(const [key,value]of Object.entries(visible.answers)){if(!value.trim()||!profile?.fields.some(field=>field.key===key))continue;result.attributes[key]=value.trim();if(result.specialistAnalysis)result.specialistAnalysis.fields[key]={value:value.trim(),basis:'user_supplied',reason:'Entered during review; not independently verified.'};}
  if(visible.answers._condition?.trim())result.condition=visible.answers._condition.trim();if(visible.answers._condition_notes?.trim())result.conditionNotes=visible.answers._condition_notes.trim();return result;
 },[ready,visible,profile,music,musicRelease]);
 const result=useMemo(()=>reviewedResult(),[reviewedResult]);
 const value=useCallback(async()=>{
  const reviewed=reviewedResult();if(!isCurrentSession()||!tenant||!reviewed||lock.current||!ready)return;lock.current=true;setBusy(true);setMarket(null);setError(null);setPhase('Retrieving market comparisons');
  try{
   const original=visible.images[0]?await prepareImageForAI(visible.images[0].uri):undefined;
   if(!isCurrentSession())return;
   const response=await getMarketValue({tenantId:tenant.id,title:reviewed.canonicalTitle,specialistId:reviewed.specialistId,attributes:reviewed.attributes,condition:reviewed.condition,identificationConfidence:reviewed.confidence,applyToItem:false,...(original?.startsWith('data:image/')?{imageBase64:original}:original?.startsWith('https://')?{imageUrls:[original]}:{})});
   if(!isCurrentSession())return;if(response.error||!response.result){setError(response.error??'No market evidence returned.');return;}setMarket(response.result);
  }catch{if(isCurrentSession())setError('Market evidence could not be retrieved. No price was inferred.');}finally{if(isCurrentSession()){lock.current=false;setBusy(false);setPhase('');}}
 },[tenant?.id,reviewedResult,ready,visible.images,isCurrentSession]);
 const save=useCallback(async()=>{
  if(!isCurrentSession())return;
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
   if(!id){
    const cost=Number(visible.answers._acquired_cost??0);const quantity=Number(visible.answers._quantity??1);
    if(!Number.isFinite(cost)||cost<0||!Number.isInteger(quantity)||quantity<1)throw new Error('Enter a non-negative acquisition cost and a whole quantity of at least one.');
    const response=await saveIdentifiedItem(tenant.id,result,{mediaUris:[],acquiredCost:cost,quantity});
    if(response.error||!response.item)throw new Error(response.error??'Inventory save not confirmed.');
    id=response.item.id;const savedDraft={...visible,result,savedId:id};
    if(current.current===scope){setDraft(savedDraft);await persistCaptureDraft(storageScope,savedDraft).catch(()=>{if(isCurrentSession())setError('Inventory is saved, but local retry state could not be retained. Keep this screen open or open the saved item.');});if(isCurrentSession())triggerInventoryReload();}
   }
   // Finish linking the original record if navigation occurs during a save.
   // Its captured tenant/item IDs remain fixed; it cannot populate the new scanner.
   if(isCurrentSession())setPhase('Uploading and linking original photographs');
   const upload=await uploadItemImages(id,visible.images,true);
   if(upload.urls.length){await updateItemMedia(tenant.id,id,upload.urls);if(isCurrentSession())triggerInventoryReload();}
   if(upload.errors.length||upload.urls.length!==visible.images.length)throw new Error(`Inventory is saved; some original photos need retry. ${upload.errors.join(' ')} Retry here without creating another item.`);
   if(market){const failure=await saveCaptureValuation(tenant.id,id,market);if(failure)throw new Error(`Original photos are saved, but valuation could not be linked: ${failure} Retry here without creating another item.`);}
   const references=await saveCoinReferenceImages(tenant.id,id,visible.images);
   if(references.errors.length)throw new Error('Original photos are saved. Some viewing aids could not be linked. Retry here without creating another item.');
   if(isCurrentSession())triggerInventoryReload();
  }catch(cause:unknown){if(isCurrentSession())setError(cause instanceof Error?cause.message:'Save failed.');}finally{if(isCurrentSession()){lock.current=false;setBusy(false);setPhase('');}}
 },[tenant?.id,ready,visible,scope,current,storageScope,reviewedResult,triggerInventoryReload,activeNiche,market,music,slots,isCurrentSession]);
 const retryStudio=useCallback(async()=>{
  if(!isCurrentSession()||busy||!ready||lock.current||!tenant)return;lock.current=true;setBusy(true);setError(null);setPhase('Preparing studio views; original evidence retained');
  try{const images=await prepareCapturedImages(visible.images.map(image=>({...image,studio:undefined})),{tenantId:tenant.id,nicheId:activeNiche.id});if(isCurrentSession())setDraft(previous=>({...previous,images}));}
  catch(cause:unknown){if(isCurrentSession())setError(cause instanceof Error?cause.message:'Studio preparation failed. Original photographs are unchanged.');}
  finally{if(isCurrentSession()){lock.current=false;setBusy(false);setPhase('');}}
 },[busy,ready,tenant?.id,visible.images,activeNiche.id,isCurrentSession]);
 const reset=useCallback(()=>{
  if(busy||lock.current||!isCurrentSession())return;
  const clear=()=>{if(!isCurrentSession())return;if(music)tunesRef.current.reset();restart();};
  if(visible.savedId||(!visible.images.length&&!visible.result))clear();
  else showAlert('Start a new scan?','Clear this scan’s photos and identification. Saved inventory items are not changed.',[{text:'Keep scan',style:'cancel'},{text:'New scan',style:'destructive',onPress:clear}]);
 },[busy,music,visible.savedId,visible.images.length,visible.result,showAlert,restart,isCurrentSession]);
 return {sessionId:scope,isCurrentSession,market:ready?market:null,value,retryStudio,allowPhotoWarnings:ready?allowPhotoWarnings:false,setAllowPhotoWarnings,activeNiche,profile,slots,images:visible.images,addCapturedPhoto,removeCapturedPhoto,result,catalogueConfirmed,catalogueExpired:music&&Boolean(visible.musicRelease)&&!isFreshMusicRelease(visible.musicRelease),discCount,busy:busy||!ready,savedId:visible.savedId,error:ready?error:null,phase:ready?phase:'',answers:visible.answers,mode:visible.mode,specialistId,capture,identify,save,reset,answer,correctTitle,changeMode,changeSpecialist};
}
