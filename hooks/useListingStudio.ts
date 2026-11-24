import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { useAuth } from '@/template';
import { QuickListContext } from '@/contexts/QuickListContext';
import { NICHE_MODULES, NICHES, PRODUCTION_NICHES, isProductionNiche, type ProductionNicheId } from '@/constants/niches';
import { emptyStudio, studioSignature, studioConfiguration, type StudioState } from '@/shared/listingStudio';
import { getSpecialistProfile } from '@/shared/specialistIntelligence';
import { observeStudioPhotos, readStudioNiche, rememberStudioNiche } from '@/services/listingStudioService';
import { retainQuickRecovery } from '@/services/quickListService';
import { useApp } from './useApp';
import { useQuickList } from './useQuickList';
import { useQuickListCamera } from './useQuickListCamera';
import { useQuickListOptions } from './useQuickListOptions';
interface StudioInput {global?:boolean}
export function useListingStudio(input:StudioInput={}){
 const app=useApp(),{user}=useAuth(),router=useRouter(),context=useContext(QuickListContext);if(!context)throw new Error('Quick List provider required.');
 const initial=isProductionNiche(app.fixedNicheId??app.activeNicheId)?(app.fixedNicheId??app.activeNicheId) as ProductionNicheId:'auto';
 const [choice,setChoice]=useState<string>(input.global?'auto':initial),[suggestedDefault,setSuggestedDefault]=useState<string|null>(null);
 const niche:ProductionNicheId=isProductionNiche(choice)?choice:isProductionNiche(app.activeNicheId)?app.activeNicheId:'coins';
 const auto=choice==='auto',flow=useQuickList(niche,{studio:true,autoDetect:auto}),camera=useQuickListCamera(flow,niche),options=useQuickListOptions(flow,niche);
 const state=flow.state,studio=state.studio??emptyStudio(auto?'auto':niche);
 const [busy,setBusy]=useState(false),[retryKey,setRetryKey]=useState(0),[panel,setPanel]=useState(''),[selectedPhoto,setSelectedPhoto]=useState<string|null>(null);
 const [torch,setTorch]=useState(false),[review,setReview]=useState(false),[question,setQuestion]=useState('');
 const flight=useRef<AbortController|null>(null),attempted=useRef(''),latest=useRef({flow,studio,auto,niche,app,userId:user?.id});latest.current={flow,studio,auto,niche,app,userId:user?.id};
 const selectionLock=useRef(false),alive=useRef(true),[settled,setSettled]=useState(0);
 const updateStudio=useCallback((value:Partial<StudioState>)=>{const f=latest.current.flow;f.patch({studio:{...(f.state.studio??emptyStudio(latest.current.auto?'auto':latest.current.niche)),...value}});},[]);
 const account=`${user?.id??''}:${app.tenant?.id??''}`;
 useEffect(()=>{let valid=true;if(user?.id&&app.tenant?.id)void readStudioNiche(user.id,app.tenant.id,app.enabledNiches).then(id=>{if(valid)setSuggestedDefault(id);}).catch(()=>{});return()=>{valid=false;};},[account,app.enabledNiches]);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;flight.current?.abort();};},[]);
 useEffect(()=>{setSelectedPhoto(null);setTorch(false);setReview(Boolean(state.draft));setPanel('');setQuestion('');attempted.current='';},[state.sessionId]);
 const observationNiche=auto?'auto':niche;
 const signature=useMemo(()=>studioSignature(state.images,observationNiche,studio.notes,studio.question),[state.images,observationNiche,studio.notes,studio.question]);
 useEffect(()=>{
  if(!state.sessionId||!state.images.length||state.processing||state.itemId||state.draft||!app.tenant||!camera.focused){flight.current?.abort();return;}
  const ticket=`${state.sessionId}:${signature}:${retryKey}`;
  if(attempted.current===ticket||(studio.evidence?.signature===signature&&retryKey===0)||flight.current)return;
  const timer=setTimeout(()=>{
   const owner=latest.current,controller=new AbortController();flight.current=controller;attempted.current=ticket;setBusy(true);const timeout=setTimeout(()=>controller.abort(),30000);
   const matches=()=>alive.current&&latest.current.userId===owner.userId&&latest.current.app.tenant?.id===owner.app.tenant?.id&&latest.current.flow.state.sessionId===state.sessionId&&studioSignature(latest.current.flow.state.images,latest.current.auto?'auto':latest.current.niche,latest.current.studio.notes,latest.current.studio.question)===signature&&!latest.current.flow.state.processing&&!latest.current.flow.state.itemId;
   void observeStudioPhotos({tenantId:app.tenant!.id,niche:observationNiche,images:state.images,signature,notes:studio.notes,question:studio.question,previous:studio.evidence,signal:controller.signal}).then(evidence=>{
    if(!matches())return;
    const current=latest.current;
    // Photo role can be refined from visible content, but never its original URI.
    // Distinct/unknown roles retain their stable labels; no duplicate role is merged.
    const configuration=studioConfiguration(observationNiche,evidence.objectType);
    const claimed=new Set<string>();
    const images=current.flow.state.images.map(image=>{
     const assessed=evidence.photos.find(p=>p.slotId===image.slotId),role=configuration.roles.find(r=>r.id===assessed?.role);
     if(!assessed?.usable||!role||claimed.has(role.id)||current.flow.state.images.some(p=>p!==image&&p.slotId===role.id)){claimed.add(image.slotId);return image;}
     claimed.add(role.id);return {...image,slotId:role.id,slotLabel:role.label};
    });
    const actualSignature=studioSignature(images,observationNiche,current.studio.notes,current.studio.question);
    const updated={...evidence,signature:actualSignature,photos:evidence.photos.map(p=>{const index=current.flow.state.images.findIndex(image=>image.slotId===p.slotId);return index>=0?{...p,slotId:images[index].slotId}:p;})};
    current.flow.patch({images,studio:{...current.studio,evidence:updated,history:[...current.studio.history,updated].slice(-12),analysisError:''}});
   }).catch(cause=>{if(matches())updateStudio({analysisError:cause instanceof Error?cause.message:'Guidance unavailable. Continue photography or finish.'});}).finally(()=>{clearTimeout(timeout);if(flight.current===controller)flight.current=null;if(alive.current){setBusy(false);setSettled(v=>v+1);}});
  },400);
  return()=>clearTimeout(timer);
 },[state.sessionId,signature,state.processing,state.itemId,state.draft,camera.focused,app.tenant?.id,retryKey,settled,updateStudio]);
 const selectNiche=useCallback(async(id:string)=>{
  const owner=latest.current,f=owner.flow,before=f.state;if(selectionLock.current||before.processing||camera.taking)return;
  if(before.itemId||before.draft){f.patch({error:'This item already belongs to its saved niche. Start another item to change workspace; existing inventory will not move.'});return;}
  if(id!=='tunes_flip'&&before.images.length>8){f.patch({error:'This selection accepts eight photos. Remove optional views before switching; originals will not be dropped silently.'});return;}
  if(id!=='auto'&&(!isProductionNiche(id)||!owner.app.enabledNiches.includes(id)||(owner.app.fixedNicheId&&owner.app.fixedNicheId!==id))){f.patch({error:'That niche is not permitted by this installation or membership.'});return;}
  selectionLock.current=true;flight.current?.abort();
  try{
   await retainQuickRecovery(f.scope,{sessionId:before.sessionId,images:before.images,state:before});
   if(id!=='auto'&&owner.app.activeNicheId!==id&&!await owner.app.openModule(id as ProductionNicheId)){f.patch({error:'Workspace authorisation was not confirmed. Your photos stay in the current session.'});return;}
   if(!alive.current||latest.current.userId!==owner.userId||latest.current.app.tenant?.id!==owner.app.tenant?.id)return;
   const moved={...before,scope:`${owner.userId}:${owner.app.tenant!.id}:${id}`,specialistId:id==='auto'?before.specialistId:NICHE_MODULES[id as ProductionNicheId].defaultSpecialist,mode:'item',result:null,lead:null,leads:[],barcodeBusy:false,visual:true,photoSlotId:'',error:'',studio:{...emptyStudio(id),notes:owner.studio.notes,history:owner.studio.history},measurements:{...before.measurements,_numista_record:'',catalogue_number:'',_numista_identity_confirmed:'',_coin_entry:'photo'}};
   context.setState(moved);setChoice(id);setPanel('');attempted.current='';setRetryKey(0);
   if(id!=='auto'&&owner.userId&&owner.app.tenant)void rememberStudioNiche(owner.userId,owner.app.tenant.id,id).catch(()=>{});
  }catch{f.patch({error:'Could not retain or authorise this camera session. Photos were not transferred to inventory.'});}finally{selectionLock.current=false;}
 },[context.setState,camera.taking]);
 const close=useCallback(async()=>{
  const f=latest.current.flow;flight.current?.abort();
  try{await retainQuickRecovery(f.scope,{images:f.state.images,itemId:f.state.itemId||undefined,listingId:f.state.draft?.listing.id,sessionId:f.state.sessionId,state:f.state});if(router.canGoBack())router.back();else router.replace('/swish');}
  catch{f.patch({error:'This session could not be retained. Keep it open and retry.'});}
 },[router]);
 const finish=useCallback((confirmCurrentNiche=false)=>{
  const owner=latest.current;if(selectionLock.current||!owner.flow.state.images.length||owner.flow.state.processing)return;
  if(owner.auto){setSelectedPhoto(null);setPanel('niches');owner.flow.patch({error:'Confirm an authorised niche to build your listing. Auto Detect never transfers inventory silently.'});return;}
  // Advisory classification never rewrites the specialist. Make mismatch visible before saving.
  const recommendation=owner.studio.evidence?.recommendedNiche;
  if(!confirmCurrentNiche&&recommendation&&recommendation!==owner.niche){setSelectedPhoto(null);setPanel('niches');owner.flow.patch({error:'The photographs may belong to another niche. Confirm your intended workspace before building.'});return;}
  flight.current?.abort();owner.flow.useVisual();setReview(true);setPanel('');owner.flow.action();void owner.flow.build();
 },[]);
 const done=useCallback(()=>finish(),[finish]);
 const confirmNicheAndBuild=useCallback(()=>finish(true),[finish]);
 const reorder=useCallback((slotId:string,direction:number)=>{const f=latest.current.flow;if(f.state.processing||f.state.itemId)return;const images=[...f.state.images],index=images.findIndex(p=>p.slotId===slotId),target=index+direction;if(index<0||target<0||target>=images.length)return;[images[index],images[target]]=[images[target],images[index]];f.patch({images,result:null,reviewed:false});},[]);
 const remove=useCallback((slotId:string)=>{flow.removePhoto(slotId);setSelectedPhoto(null);},[flow.removePhoto]);
 const retake=useCallback((slotId:string)=>{flow.removePhoto(slotId);setSelectedPhoto(null);setReview(false);},[flow.removePhoto]);
 const ask=useCallback(()=>{if(!state.images.length){flow.patch({error:'Take a photograph before asking about the item.'});return;}updateStudio({question});setRetryKey(v=>v+1);},[state.images.length,question,flow.patch,updateStudio]);
 const available=PRODUCTION_NICHES.filter(p=>app.enabledNiches.includes(p.id)&&(!app.fixedNicheId||app.fixedNicheId===p.id));
 const recommended=studio.evidence?.recommendedNiche,mismatch=Boolean(recommended&&recommended!==observationNiche);
 const requestedIsCurrent=studio.evidence?.nextRole===flow.nextSlot?.id;
 const threeCoinViews=!auto&&niche==='coins'&&['obverse','reverse','packet'].every(id=>state.images.some(photo=>photo.slotId===id));
 const guidance=threeCoinViews?'Three views captured. Tap Done to prepare your listing; review packet readings and any conflicts before publishing.':!state.images.length?(!auto&&niche==='coins'?'Photograph the obverse, reverse, then the coin packet.':'Point your camera at your item.'):studio.evidence?.ready?'There is enough evidence to build a draft. Add more photos or finish.':requestedIsCurrent&&studio.evidence?.guidance?studio.evidence.guidance:flow.nextSlot?.description??'Add another useful detail or finish.';
 // A persisted external ID is NOT a verified Live badge. Keep it in the engine
 // for reconciliation, but do not expose it as confirmed in presentation state.
 const presentationFlow={...flow,state:state.unconfirmed?{...state,liveId:''}:state};
 return {flow:presentationFlow,camera,options,studio,auto,niche,nicheLabel:auto?'Auto Detect':NICHES[niche].shortName,available,suggestedDefault,recommended,mismatch,guidance,busy,panel,setPanel,selectedPhoto,setSelectedPhoto,torch,setTorch,review:review||Boolean(state.draft),setReview,question,setQuestion,updateStudio,selectNiche,close,done,confirmNicheAndBuild,reorder,remove,retake,ask,retryGuidance:()=>setRetryKey(v=>v+1),configuration:studioConfiguration(observationNiche,studio.evidence?.objectType??'',auto?null:getSpecialistProfile(niche))};
}
