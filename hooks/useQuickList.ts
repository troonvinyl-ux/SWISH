import { useContext, useEffect, useRef, useCallback, useMemo, useState } from 'react';
import { Platform, Linking } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useAuth } from '@/template';
import { useApp } from './useApp';
import { useTunesCatalogue } from './useTunesCatalogue';
import { QuickListContext, emptyQuickList, type QuickListState } from '@/contexts/QuickListContext';
import { NICHE_MODULES, NICHES } from '@/constants/niches';
import type { SpecialistId } from '@/constants/specialists';
import { getSpecialistProfile } from '@/shared/specialistIntelligence';
import { getQuickListOpenedAt, recordQuickTiming, retainQuickTiming } from '@/services/quickListTelemetryService';
import { lookupQuickBarcode, warmQuickList, identifyQuickPhotos, createQuickInventory, uploadQuickPhotos, quickRequirements, prepareQuickDraft, saveQuickReview, publishQuickDraft, confirmQuickLive, readQuickAutoPublish, saveQuickAutoPublish, retainQuickRecovery, readQuickRecovery } from '@/services/quickListService';
import { prepareCapturedImages } from '@/services/sharedImagePreparationService';
import { retainCaptureImage } from '@/services/captureDraftService';
import type { CapturedImage } from '@/services/aiIdentificationService';
import { quickCaptureSlots, quickMissingPhotos, quickBarcodeSupported, quickStartsWithBarcode, specificBarcodeLead, barcodeAgreesWithPhotos, enrichQuickIdentification, quickReviewIssue } from '@/services/quickListPolicyService';
import { musicCaptureResult, musicDiscCount } from '@/services/musicCaptureService';
import { isFreshMusicRelease } from '@/shared/musicRelease';
import type { QuickListNiche, ProductLead, QuickStage, QuickTiming } from '@/shared/quickList';
import { invokeListingOperation } from '@/services/listingEditorService';
import { automaticCondition, automaticSpecifics } from '@/services/listingAutofillService';
export function useQuickList(nicheId:QuickListNiche){
 const context=useContext(QuickListContext);if(!context)throw new Error('Quick List provider is required.');const {state,setState}=context;
 const app=useApp(),{tenant,triggerInventoryReload}=app,{user}=useAuth();const tunes=useTunesCatalogue();
 const scope=user?.id&&tenant?.id&&app.activeNiche.id===nicheId&&app.accessReady?`${user.id}:${tenant.id}:${nicheId}`:'';
 const emptyState=useMemo(()=>emptyQuickList(),[]);const visibleState=scope&&state.scope===scope?state:emptyState;
 const scopeRef=useRef(scope);scopeRef.current=scope;const current=useRef(visibleState);current.current=visibleState;
 const operation=useRef(false),serial=useRef(0),barcodeSerial=useRef(0),mounted=useRef(true),timing=useRef<QuickTiming|null>(null),editedFields=useRef(new Set<string>());
 const studioFlight=useRef<{key:string;promise:Promise<CapturedImage[]>}|null>(null);
 const photoStudioFlights=useRef(new Map<string,Promise<CapturedImage>>());
 const photoStudioQueue=useRef<Promise<void>>(Promise.resolve());
 const [recoveryAvailable,setRecoveryAvailable]=useState(false),[clock,setClock]=useState(Date.now());
 const [barcodeLookup,setBarcodeLookup]=useState({code:'',message:''});
 const patch=useCallback((value:Partial<QuickListState>)=>{if(!scope||scopeRef.current!==scope||current.current.scope!==scope)return;const id=current.current.sessionId;current.current={...current.current,...value};setState(previous=>previous.scope===scope&&previous.sessionId===id?{...previous,...value}:previous);},[scope,setState]);
 const validFor=useCallback((version:number)=>mounted.current&&version===serial.current&&scopeRef.current===scope&&current.current.scope===scope,[scope]);
 const checkpoint=useCallback(()=>{const row=timing.current;if(!tenant||!row)return;void retainQuickTiming(scope,row).catch(()=>{});void recordQuickTiming(tenant.id,row);},[tenant?.id,scope]);
 const stamp=useCallback((stage?:QuickStage,extra:Partial<QuickTiming>={})=>{
  if(!scope||scopeRef.current!==scope||current.current.scope!==scope)return;const row=timing.current;if(!row)return;
  // First occurrence wins: retries never shorten the measured end-to-end duration.
  const next={...row,...extra,timestamps:{...row.timestamps,...(stage&&row.timestamps[stage]==null?{[stage]:Date.now()}:{})}};timing.current=next;patch({timing:next});
 },[scope,patch]);
 const action=useCallback((manual=false)=>{if(timing.current)stamp(undefined,{actions:timing.current.actions+1,manualInterventions:(timing.current.manualInterventions??0)+(manual?1:0)});},[stamp]);
 const trackEdit=useCallback((key:string)=>{if(editedFields.current.has(key))return;editedFields.current.add(key);action(true);},[action]);
 const captureStart=useCallback(()=>{stamp('T2');},[stamp]);
 const fail=useCallback((name:string,message:string,started:number)=>{if(timing.current){stamp(undefined,{failures:[...(timing.current.failures??[]),{operation:name,at:Date.now(),elapsedMs:Math.max(0,Date.now()-started),message}],reasons:[...new Set([...(timing.current.reasons??[]),message])]});checkpoint();}},[stamp,checkpoint]);
 // Start cleanup as each photo is retained. A serial queue bounds memory and paid requests.
 const preparePhotoStudio=useCallback((image:CapturedImage):Promise<CapturedImage>=>{
  if(image.studio?.originalUri===image.uri)return Promise.resolve(image);
  const key=`${scope}:${image.slotId}:${image.uri}`,existing=photoStudioFlights.current.get(key);
  if(existing)return existing;
  const version=serial.current;
  const work=photoStudioQueue.current.catch(()=>{}).then(async()=>{
   if(!tenant||!validFor(version))return image;
   const prepared=await prepareCapturedImages([image],{tenantId:tenant.id,nicheId});
   // Retain the result even if the seller has moved on; it is never applied to another scan.
   return Object.assign(image,prepared[0]??image);
  });
  photoStudioFlights.current.set(key,work);photoStudioQueue.current=work.then(()=>{},()=>{});
  return work;
 },[scope,tenant?.id,nicheId,validFor]);
 const start=useCallback(async()=>{
  if(!scope||scopeRef.current!==scope)return;if(timing.current&&timing.current.outcome!=='live'){stamp(undefined,{outcome:'abandoned',endedAt:Date.now()});checkpoint();}
  serial.current++;barcodeSerial.current++;setBarcodeLookup({code:'',message:''});operation.current=false;studioFlight.current=null;photoStudioFlights.current.clear();editedFields.current.clear();const id=`quick-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`;
  timing.current={id,nicheId,timestamps:{T0:getQuickListOpenedAt(),T1:Date.now()},actions:1,manualInterventions:0,failures:[],barcodeAttempted:false,barcodeMatched:false,aiAttempted:false,aiMatched:false,publicationAttempted:false,outcome:'running',eligible:false,reasons:[],operations:{},platform:Platform.OS,clock:'expo_js_launch_or_foreground'};
  const fresh={...emptyQuickList(),scope,sessionId:id,specialistId:NICHE_MODULES[nicheId].defaultSpecialist,visual:!quickStartsWithBarcode(nicheId),timing:timing.current};current.current=fresh;setState(fresh);if(nicheId==='tunes_flip')tunes.reset();checkpoint();const version=serial.current;
  try{const [auto,error]=await Promise.all([readQuickAutoPublish(scope).catch(()=>false),warmQuickList(tenant!.id)]);if(validFor(version))patch({autoPublish:auto,connectionError:error??''});}
  catch{if(validFor(version))patch({connectionError:'eBay connection could not be checked. Retry before publishing.'});}
 },[scope,nicheId,tenant?.id,setState,patch,stamp,checkpoint,validFor,tunes.reset]);
 const startRef=useRef(start);startRef.current=start;
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;serial.current++;barcodeSerial.current++;};},[]);
 // Fresh physical item on every scanner visit; previous captures are resumed explicitly.
 useFocusEffect(useCallback(()=>{if(scope)void startRef.current();return()=>{serial.current++;barcodeSerial.current++;};},[scope,app.moduleEpoch]));
 useEffect(()=>{let cancelled=false;void readQuickRecovery(scope).then(saved=>{if(!cancelled)setRecoveryAvailable(Boolean(saved?.images.length||saved?.itemId));}).catch(()=>{if(!cancelled)setRecoveryAvailable(false);});return()=>{cancelled=true;};},[scope]);
 useEffect(()=>{if(!visibleState.sessionId||visibleState.liveId)return;const timer=setInterval(()=>setClock(Date.now()),1000);return()=>clearInterval(timer);},[visibleState.sessionId,visibleState.liveId]);
 useEffect(()=>{
  if(!scope||state.scope!==scope||!state.sessionId||(!state.images.length&&!state.itemId))return;
  const timer=setTimeout(()=>{void retainQuickRecovery(scope,{images:state.images,itemId:state.itemId||undefined,listingId:state.draft?.listing.id,sessionId:state.sessionId,state}).catch(()=>{if(current.current.sessionId===state.sessionId)patch({error:'This scan could not be retained on this device. Keep it open and retry before leaving.'});});if(state.timing)void retainQuickTiming(scope,state.timing).catch(()=>{});},200);return()=>clearTimeout(timer);
 },[scope,state,patch]);
 const slots=useMemo(()=>quickCaptureSlots(nicheId,visibleState.specialistId||NICHE_MODULES[nicheId].defaultSpecialist,visibleState.mode,visibleState.measurements.observed_disc_count),[nicheId,visibleState.specialistId,visibleState.mode,visibleState.measurements.observed_disc_count]);
 const missing=quickMissingPhotos(slots,visibleState.images),nextSlot=slots.find(slot=>slot.id===visibleState.photoSlotId)??missing[0]??slots.find(slot=>!visibleState.images.some(image=>image.slotId===slot.id)),captureProfile=getSpecialistProfile(nicheId);
 const changeCapture=useCallback((specialistId:string,mode='item')=>{if(operation.current||current.current.images.length||current.current.itemId||!NICHE_MODULES[nicheId].specialists.includes(specialistId))return;action(true);patch({specialistId,mode,photoSlotId:'',result:null,reviewed:false});},[nicheId,action,patch]);
 const barcode=useCallback(async(value:string,type:string)=>{
  if(!scope||!tenant||!current.current.sessionId||current.current.scope!==scope||!quickBarcodeSupported(nicheId)||current.current.barcodeBusy||current.current.itemId||current.current.draft||current.current.processing||operation.current)return;const version=serial.current,barcodeVersion=++barcodeSerial.current,started=Date.now();captureStart();stamp(undefined,{barcodeAttempted:true});setBarcodeLookup({code:value.trim().slice(0,32),message:''});patch({barcodeBusy:true,error:'',visual:false});
  try{const response=await lookupQuickBarcode(tenant.id,value,type);if(!validFor(version)||barcodeVersion!==barcodeSerial.current)return;const products=response.products;setBarcodeLookup({code:response.gtin||value.trim().slice(0,32),message:response.message||'No barcode match found. Take photos or scan another barcode.'});patch({barcodeBusy:false,leads:products.length>1?products:[],lead:products.length===1?products[0]!:null,visual:false,error:response.error??''});if(response.error)fail('barcode',response.error,started);}
  catch{if(validFor(version)&&barcodeVersion===barcodeSerial.current){setBarcodeLookup({code:value.trim().slice(0,32),message:'AI barcode lookup unavailable.'});patch({barcodeBusy:false,visual:false,error:'Barcode lookup unavailable. Take photos or try scanning again.'});fail('barcode','Barcode lookup unavailable; original-photo identification remains available.',started);}}
 },[scope,nicheId,tenant?.id,patch,stamp,captureStart,validFor,fail]);
 const selectLead=useCallback((lead:ProductLead)=>{if(!specificBarcodeLead(lead))return;action(true);patch({lead,leads:[],visual:false,reviewed:false,error:''});},[action,patch]);
 const openBarcodeSource=useCallback(async()=>{
  if(!scope||current.current.scope!==scope||scopeRef.current!==scope)return;
  const lead=current.current.lead,url=lead?.sourceUrls?.[0]??lead?.url;
  if(!url||!/^https:\/\//i.test(url)){patch({error:'No source link is available for this barcode result.'});return;}
  try{await Linking.openURL(url);}catch{if(scopeRef.current===scope)patch({error:'The barcode source could not be opened.'});}
 },[scope,patch]);
 const useBarcode=useCallback(()=>{
  if(!scope||!quickBarcodeSupported(nicheId)||operation.current||current.current.barcodeBusy||current.current.itemId||current.current.draft)return;
  barcodeSerial.current++;setBarcodeLookup({code:'',message:''});action();patch({barcodeBusy:false,visual:false,leads:[],lead:null,error:''});
 },[scope,nicheId,action,patch]);
 const useVisual=useCallback(()=>{
  if(operation.current||current.current.itemId||current.current.draft)return;
  // Keep a selected catalogue lead for later photo corroboration; switching modes never saves or publishes.
  barcodeSerial.current++;action();patch({barcodeBusy:false,visual:true,leads:[],error:''});
 },[action,patch]);
 const addPhoto=useCallback(async(photo:{uri:string;width?:number;height?:number;photoQuality?:CapturedImage['photoQuality']})=>{
  if(!scope||!tenant||operation.current||current.current.itemId||current.current.draft||current.current.images.length>=8||!nextSlot)return;action();captureStart();const version=serial.current;operation.current=true;const started=Date.now();patch({phase:'Retaining original photograph'});
  try{const image=await retainCaptureImage({...photo,slotId:nextSlot.id,slotLabel:nextSlot.label});if(!validFor(version))return;const images=[...current.current.images.filter(entry=>entry.slotId!==image.slotId),image],next={...current.current,images,photoSlotId:'',result:null,reviewed:false,error:''};await retainQuickRecovery(scope,{images,sessionId:next.sessionId,state:next});if(validFor(version)){
    patch(next);
    void preparePhotoStudio(image).then(prepared=>{
     if(!validFor(version)||current.current.processing||current.current.draft||current.current.itemId)return;
     const latest=current.current.images;
     if(latest.some(entry=>entry.slotId===prepared.slotId&&entry.uri===prepared.uri))patch({images:latest.map(entry=>entry.slotId===prepared.slotId&&entry.uri===prepared.uri?prepared:entry)});
    }).catch(()=>{});
   }} 
  catch(cause){if(validFor(version)){const message=cause instanceof Error?cause.message:'Original could not be retained. Retry before leaving.';patch({error:message});fail('capture',message,started);}}
  finally{if(validFor(version)){operation.current=false;patch({phase:''});}}
 },[scope,tenant?.id,nextSlot,action,captureStart,patch,validFor,fail,preparePhotoStudio]);
 const removePhoto=useCallback((slotId:string)=>{if(operation.current||current.current.itemId)return;action(true);patch({images:current.current.images.filter(image=>image.slotId!==slotId),result:null,reviewed:false,error:'',photoSlotId:slotId});},[action,patch]);
 const build=useCallback(async()=>{
  const before=current.current,required=quickMissingPhotos(quickCaptureSlots(nicheId,before.specialistId,before.mode,before.measurements.observed_disc_count),before.images);
  if(!scope||before.scope!==scope||!tenant||operation.current||before.draft||before.liveId||required.length||!before.images.length||before.barcodeBusy)return;
  if(nicheId==='tunes_flip'&&before.mode==='cd_box_set'&&!musicDiscCount(before.measurements.observed_disc_count)){patch({error:'Enter the number of discs physically present before preparing this box-set draft.'});return;}
  operation.current=true;const version=serial.current,started=Date.now();patch({processing:true,phase:before.result?'Reusing identification · retrying draft':'Identifying original specialist evidence',error:''});let itemId=before.itemId,retainedResult=before.result,step='identification';
  try{
   // Cleanup started at capture is reused; identification still uses the untouched originals.
   const studioKey=`${before.sessionId}:${before.images.map(image=>image.uri).join('|')}`;
   if(studioFlight.current?.key!==studioKey)studioFlight.current={key:studioKey,promise:Promise.all(before.images.map(preparePhotoStudio))};
   const optionalStudio=studioFlight.current.promise;
   if(!before.result)stamp(undefined,{aiAttempted:true});const identified=before.result?{result:before.result,error:null}:await identifyQuickPhotos(tenant.id,nicheId,before.images,before.lead,before.measurements,{specialistId:before.specialistId as SpecialistId,mode:before.mode,allowPhotoWarnings:before.allowPhotoWarnings});
   if(!validFor(version))return;if(identified.error||!identified.result)throw new Error(identified.error??'Identification did not complete. Originals are retained.');
   const music=nicheId==='tunes_flip'?musicCaptureResult(identified.result,tunes.ready&&tunes.state.confirmed&&isFreshMusicRelease(tunes.state.release)?tunes.state.release:null,before.measurements):null;
   const result=enrichQuickIdentification(music??identified.result,nicheId,before.lead,before.measurements);retainedResult=result;patch({result});if(!before.result)stamp('T3',{aiMatched:result.confidence>=0.7,barcodeMatched:barcodeAgreesWithPhotos(before.lead,result),operations:{...timing.current?.operations,identification:Date.now()-started}});checkpoint();
   await retainQuickRecovery(scope,{images:before.images,itemId:itemId||undefined,sessionId:before.sessionId,state:{...before,result}});if(!validFor(version))return;
   const selected=before.categoryId?{...(before.lead??{}),categoryId:before.categoryId,categoryName:before.categoryName} as ProductLead:barcodeAgreesWithPhotos(before.lead,result)?before.lead:null;const req=quickRequirements(tenant.id,result.canonicalTitle,selected,nicheId);void req.catch(()=>{});
   step='inventory';const quantity=Number(before.measurements._quantity??'1'),item=before.itemId?{id:before.itemId}:await createQuickInventory(tenant.id,result,before.sessionId,quantity);itemId=item.id;if(!validFor(version))return;patch({itemId:item.id,phase:'Saving originals · researching price · preparing draft'});triggerInventoryReload();
   await retainQuickRecovery(scope,{images:before.images,itemId:item.id,sessionId:before.sessionId,state:{...before,result,itemId:item.id}});if(!validFor(version))return;
   step='draft';const photos=(async()=>{
    const prepared=await optionalStudio;
    if(!validFor(version))throw new Error('Scan changed before photo saving. The original photos are retained.');
    patch({images:prepared});
    // One persistence transaction links the bounded archive copies and already-processed photos.
    return uploadQuickPhotos(tenant.id,item.id,prepared);
   })();void photos.catch(()=>{});const draft=await prepareQuickDraft(tenant.id,nicheId,item.id,result,photos,req,()=>{if(validFor(version)){stamp('T4');checkpoint();}},before.images[0],`${scope}:${before.sessionId}`,quantity);const uploaded=await photos;if(!validFor(version))return;
   const next={...current.current,result,itemId:item.id,images:uploaded.images,draft,title:draft.generated.title,description:draft.generated.description,price:draft.generated.recommended_price>0?String(draft.generated.recommended_price):'',conditionId:automaticCondition(draft.requirements.conditions,result.condition,draft.generated.condition_id),conditionNotes:result.conditionNotes,specifics:draft.specifics,phase:'',error:''};
   const initialSave=await saveQuickReview(tenant.id,nicheId,draft,{title:next.title,description:next.description,price:next.price||'0',conditionId:next.conditionId,conditionNotes:next.conditionNotes,specifics:next.specifics},'draft');
   if(initialSave.error)throw new Error(initialSave.error);
   await retainQuickRecovery(scope,{images:next.images,itemId:item.id,listingId:draft.listing.id,sessionId:before.sessionId,state:next});if(!validFor(version))return;patch(next);stamp('TD',{operations:{...timing.current?.operations,draft:Date.now()-started}});checkpoint();if(draft.warnings?.length)fail('valuation',draft.warnings.join(' '),started);
  }catch(cause){if(validFor(version)){const message=cause instanceof Error?cause.message:'Quick List could not prepare the draft.',snapshot={...current.current,images:before.images,itemId,result:retainedResult,error:message};await retainQuickRecovery(scope,{images:before.images,itemId:itemId||undefined,sessionId:before.sessionId,state:snapshot}).catch(()=>{});if(validFor(version)){patch(snapshot);triggerInventoryReload();fail(step,message,started);}}}
  finally{if(validFor(version)){operation.current=false;patch({processing:false,phase:''});}}
 },[tenant?.id,nicheId,scope,patch,stamp,checkpoint,validFor,fail,triggerInventoryReload,tunes.ready,tunes.state.confirmed,tunes.state.release,preparePhotoStudio]);
 // Next is the sole preparation action. No automatic transition while the seller is taking photographs.
 const edit=useCallback((key:'title'|'description'|'price'|'conditionNotes'|'conditionId',value:string)=>{if(operation.current)return;trackEdit(key);patch({[key]:value,reviewed:false});},[trackEdit,patch]);
 const setSpecific=useCallback((name:string,value:string)=>{if(operation.current)return;trackEdit(`specific:${name}`);patch({specifics:current.current.specifics.map(row=>row.name===name?{...row,value}:row),reviewed:false});},[trackEdit,patch]);
 const publish=useCallback(async(approved=false)=>{
  const before=current.current;if(!tenant||!before.draft||(!before.reviewed&&!approved)||operation.current||before.liveId||before.unconfirmed)return;operation.current=true;const version=serial.current,started=Date.now();patch({processing:true,phase:'Running existing eBay preflight and publication',error:''});
  try{const result=await publishQuickDraft(tenant.id,before.draft,before.sessionId,()=>{if(validFor(version))stamp('T6',{publicationAttempted:true});});if(!validFor(version))return;stamp('TP');
   if(result.live){stamp('T7',{outcome:'live',externalListingId:result.externalListingId,endedAt:Date.now()});patch({liveId:result.externalListingId!,error:result.error??''});triggerInventoryReload();}else{stamp(undefined,{outcome:result.unconfirmed?'unconfirmed':'failed'});patch({unconfirmed:!!result.unconfirmed,error:result.error??'Publication not confirmed'});fail('publication',result.error??'Publication not confirmed',started);}checkpoint();
  }catch{if(validFor(version)){patch({unconfirmed:true,error:'Publication outcome is unknown. Check the existing listing; do not publish again.'});stamp(undefined,{outcome:'unconfirmed'});fail('publication','Publication outcome is unknown; resubmission is blocked.',started);}}
  finally{if(validFor(version)){operation.current=false;patch({processing:false,phase:''});}}
 },[tenant?.id,scope,patch,stamp,checkpoint,validFor,fail,triggerInventoryReload]);
 const confirm=useCallback(async(publishAfterReview=true)=>{
  const before=current.current;if(!tenant||!before.draft||!before.result||operation.current||before.liveId||before.unconfirmed)return;action();patch({error:''});
  // Reuse the still-fresh explicitly confirmed release; do not ask for the same catalogue data twice.
  const release=tunes.ready&&tunes.state.confirmed&&isFreshMusicRelease(tunes.state.release)?tunes.state.release:null;
  const music=nicheId==='tunes_flip'?musicCaptureResult(before.result,release,before.measurements):null,reviewedResult=enrichQuickIdentification(music??before.result,nicheId,before.lead,before.measurements);
  const issue=publishAfterReview?quickReviewIssue(nicheId,reviewedResult,slots,before.images):null;if(issue){patch({error:issue});fail('evidence_review',issue,Date.now());return;}operation.current=true;const version=serial.current,started=Date.now();patch({processing:true,phase:'Saving explicit seller approval'});
  try{
   if(publishAfterReview&&before.connectionError){const error=await warmQuickList(tenant.id);if(!validFor(version))return;patch({connectionError:error??''});if(error)throw new Error(error);}
   const saved=await saveQuickReview(tenant.id,nicheId,before.draft,{title:before.title,description:before.description,price:before.price,conditionId:before.conditionId,conditionNotes:before.conditionNotes,specifics:before.specifics,reviewedResult},publishAfterReview?'publish':'draft');if(!validFor(version))return;if(saved.error)throw new Error(saved.error);patch({reviewed:publishAfterReview,savedForLater:!publishAfterReview});if(publishAfterReview)stamp('T5',{eligible:true});triggerInventoryReload();checkpoint();
   // Save-only is supported. The Approve & Publish button approves exactly this reviewed draft.
   if(!validFor(version))return;if(publishAfterReview){operation.current=false;await publish(true);}
  }catch(cause){if(validFor(version)){const message=cause instanceof Error?cause.message:'Review save could not be confirmed. Nothing was published.';patch({reviewed:false,error:message});fail('review',message,started);}}
  finally{if(validFor(version)){operation.current=false;patch({processing:false,phase:''});}}
 },[tenant?.id,nicheId,scope,slots,action,patch,stamp,checkpoint,publish,validFor,fail,tunes.ready,tunes.state.confirmed,tunes.state.release,triggerInventoryReload]);
 const checkLive=useCallback(async()=>{
  const before=current.current;if(!tenant||!before.draft||operation.current)return;action(true);operation.current=true;const version=serial.current,started=Date.now();patch({processing:true,phase:'Checking the existing listing · no resubmission'});
  try{const row=await invokeListingOperation({route:'inspect_live',tenantId:tenant.id,listingId:before.draft.listing.id});if(!validFor(version))return;const id=row.data?.live?.externalListingId;if(!id)throw new Error(row.error??'Existing listing has no confirmed external ID. Synchronise eBay; do not resubmit.');const checked=await confirmQuickLive(tenant.id,before.draft,before.sessionId,id);if(!validFor(version))return;if(checked.live){stamp('T7',{outcome:'live',externalListingId:id,endedAt:Date.now()});patch({liveId:id,unconfirmed:false,error:''});triggerInventoryReload();checkpoint();}else throw new Error(checked.error??'Live status unavailable.');}
  catch(cause){if(validFor(version)){const message=cause instanceof Error?cause.message:'Live status could not be checked. Do not resubmit.';patch({error:message});fail('live_readback',message,started);}}
  finally{if(validFor(version)){operation.current=false;patch({processing:false,phase:''});}}
 },[tenant?.id,scope,action,patch,stamp,checkpoint,validFor,fail,triggerInventoryReload]);
 const toggleAuto=useCallback(async()=>{action();const value=!current.current.autoPublish;try{await saveQuickAutoPublish(scope,value);patch({autoPublish:value});}catch{patch({error:'Auto-publish preference could not be stored; publication remains manual.'});}},[scope,action,patch]);
 const chooseCategory=useCallback(async(id:string,name:string)=>{
  if(operation.current||!tenant)return;action(true);const before=current.current;patch({categoryId:id,categoryName:name,error:''});
  if(!before.draft||!before.result)return;
  operation.current=true;const version=serial.current;patch({processing:true});
  try{const requirements=await quickRequirements(tenant.id,before.title,{categoryId:id,categoryName:name} as ProductLead,nicheId);if(!validFor(version))return;const specifics=automaticSpecifics(nicheId,before.result,before.draft.generated,requirements.aspects);patch({draft:{...before.draft,requirements,specifics},specifics,conditionId:automaticCondition(requirements.conditions,before.result.condition,before.draft.generated.condition_id),reviewed:false});}
  catch(cause){if(validFor(version))patch({error:cause instanceof Error?cause.message:'Category unavailable.'});}
  finally{if(validFor(version)){operation.current=false;patch({processing:false});}}
 },[tenant?.id,nicheId,action,patch,validFor]);
 const recovery=useCallback(()=>readQuickRecovery(scope),[scope]);
 const resume=useCallback(async()=>{
  if(!scope||operation.current||current.current.processing)return;const version=++serial.current;operation.current=true;
  try{const saved=await readQuickRecovery(scope);if(!saved||!validFor(version))return;setBarcodeLookup({code:'',message:''});timing.current=null;studioFlight.current=null;photoStudioFlights.current.clear();editedFields.current.clear();const restored={...emptyQuickList(),...(saved.state??{}),scope,sessionId:saved.sessionId,specialistId:saved.state?.specialistId||NICHE_MODULES[nicheId].defaultSpecialist,images:saved.images,itemId:saved.itemId??'',visual:saved.state?.visual??true,processing:false,barcodeBusy:false,reviewed:false,autoPublish:false,timing:null,error:'Recovered scan. Review photos and retry on the same saved item.'};current.current=restored;setState(restored);setRecoveryAvailable(false);}
  catch(cause){if(scopeRef.current===scope)patch({error:cause instanceof Error?cause.message:'Retained scan could not be reopened.'});}finally{if(version===serial.current)operation.current=false;}
 },[scope,nicheId,patch,setState,validFor]);
 const retryPhotos=useCallback(async()=>{
  const before=current.current;if(!tenant||!before.itemId||operation.current)return;const version=serial.current,started=Date.now();action(true);operation.current=true;patch({processing:true,error:'',phase:'Retrying originals on the saved canonical item'});
  try{const prepared=await Promise.all(before.images.map(preparePhotoStudio));if(!validFor(version))return;const saved=await uploadQuickPhotos(tenant.id,before.itemId,prepared);if(validFor(version)){patch({images:saved.images,error:'',reviewed:false});triggerInventoryReload();}}catch(cause){if(validFor(version)){const message=cause instanceof Error?cause.message:'Retry original photos on the saved item.';patch({error:message});fail('photo_retry',message,started);}}finally{if(validFor(version)){operation.current=false;patch({processing:false,phase:''});}}
 },[scope,tenant?.id,action,patch,validFor,fail,triggerInventoryReload,preparePhotoStudio]);
 const answerEvidence=useCallback((key:string,value:string)=>{if(operation.current||current.current.liveId)return;trackEdit(`evidence:${key}`);patch({measurements:{...current.current.measurements,[key]:value},reviewed:false});},[trackEdit,patch]);
 const elapsedMs=visibleState.timing?.timestamps.T0!=null?Math.max(0,(visibleState.timing.timestamps.T7??clock)-visibleState.timing.timestamps.T0):null;
 return {state:visibleState,scope,barcodeLookup,config:NICHES[nicheId],slots,nextSlot,missing,captureProfile,barcodeSupported:quickBarcodeSupported(nicheId),elapsedMs,answerEvidence,captureStart,changeCapture,removePhoto,addPhoto,barcode,selectLead,openBarcodeSource,useBarcode,useVisual,start,build,edit,setSpecific,confirm,publish:()=>{action();void publish();},checkLive,toggleAuto,chooseCategory,action,patch,recovery,resume,recoveryAvailable,retryPhotos};
}
