import { useState, useRef, useEffect, useCallback } from 'react';
import { useApp } from './useApp';
import { useAuth } from '@/template';
import { resolveProductionNiche } from '@/services/nicheRouting';
import { prepareInventoryListing } from '@/services/preparedListingService';
import { saveQuickReview, publishQuickDraft, confirmQuickLive, type QuickDraft } from '@/services/quickListService';
import { invokeListingOperation } from '@/services/listingEditorService';
interface PreparedState {draft:QuickDraft|null;existingId:string;title:string;price:string;description:string;conditionId:string;conditionNotes:string;specifics:Array<{name:string;value:string}>;busy:boolean;error:string;liveId:string;unconfirmed:boolean;saved:boolean}
const empty:PreparedState={draft:null,existingId:'',title:'',price:'',description:'',conditionId:'',conditionNotes:'',specifics:[],busy:true,error:'',liveId:'',unconfirmed:false,saved:false};
export function usePreparedListing(itemId:string){
 const {tenant,fixedNicheId,activeNicheId,accessReady,moduleLoading,triggerInventoryReload}=useApp();const {user}=useAuth();const niche=resolveProductionNiche(fixedNicheId??activeNicheId);
 const scope=`${user?.id}:${tenant?.id}:${niche}:${itemId}`;const current=useRef(scope);current.current=scope;const lock=useRef(false);
 const [state,setState]=useState<PreparedState>(empty);const [loadedScope,setLoadedScope]=useState('');const [retry,setRetry]=useState(0);
 useEffect(()=>{
  if(!tenant||!user||!niche||!itemId||!accessReady||moduleLoading)return;
  let cancelled=false;setState(empty);setLoadedScope(scope);
  void prepareInventoryListing(tenant.id,niche,itemId,user.id).then(result=>{
   if(cancelled||current.current!==scope)return;
   const draft=result.draft;setState({...empty,busy:false,existingId:result.existingId,draft,title:draft?.generated.title??'',price:result.price==='0'?'':result.price,description:draft?.generated.description??'',conditionId:result.conditionId,conditionNotes:result.conditionNotes,specifics:draft?.specifics??[]});triggerInventoryReload();
  }).catch(cause=>{if(!cancelled&&current.current===scope)setState({...empty,busy:false,error:cause instanceof Error?cause.message:'Listing could not be prepared.'});});
  return()=>{cancelled=true;};
 },[scope,tenant?.id,user?.id,niche,itemId,accessReady,moduleLoading,retry,triggerInventoryReload]);
 const visible=loadedScope===scope?state:empty;
 const edit=useCallback((key:'title'|'price'|'description'|'conditionId'|'conditionNotes',value:string)=>{if(lock.current||current.current!==scope)return;setState(previous=>({...previous,[key]:value}));},[scope]);
 const specifics=useCallback((values:Array<{name:string;value:string}>)=>{if(!lock.current&&current.current===scope)setState(previous=>({...previous,specifics:values}));},[scope]);
 const finish=useCallback(async(publish:boolean)=>{
  if(lock.current||!visible.draft||!tenant||!niche||visible.liveId||visible.unconfirmed)return;lock.current=true;setState(previous=>({...previous,busy:true,error:''}));
  try{
   const saved=await saveQuickReview(tenant.id,niche,visible.draft,{title:visible.title,description:visible.description,price:visible.price||'0',conditionId:visible.conditionId,conditionNotes:visible.conditionNotes,specifics:visible.specifics},publish?'publish':'draft');
   if(current.current!==scope)return;if(saved.error)throw new Error(saved.error);
   if(!publish){setState(previous=>({...previous,saved:true}));triggerInventoryReload();return;}
   const result=await publishQuickDraft(tenant.id,visible.draft,`inventory:${itemId}`,()=>{});if(current.current!==scope)return;
   setState(previous=>({...previous,liveId:result.live?result.externalListingId??'':'',unconfirmed:!!result.unconfirmed,error:result.error??''}));triggerInventoryReload();
  }catch(cause){if(current.current===scope)setState(previous=>({...previous,error:cause instanceof Error?cause.message:'Listing action was not confirmed.'}));}
  finally{lock.current=false;if(current.current===scope)setState(previous=>({...previous,busy:false}));}
 },[visible,scope,tenant?.id,niche,itemId,triggerInventoryReload]);
 const checkLive=useCallback(async()=>{
  if(lock.current||!visible.draft||!tenant)return;lock.current=true;setState(previous=>({...previous,busy:true,error:''}));
  try{const inspected=await invokeListingOperation({route:'inspect_live',tenantId:tenant.id,listingId:visible.draft.listing.id});const id=inspected.data?.live?.externalListingId;if(!id)throw new Error(inspected.error??'Publication is not yet confirmed.');const result=await confirmQuickLive(tenant.id,visible.draft,`inventory:${itemId}`,id);if(!result.live)throw new Error(result.error??'Synchronisation pending.');if(current.current===scope){setState(previous=>({...previous,liveId:id,unconfirmed:false}));triggerInventoryReload();}}
  catch(cause){if(current.current===scope)setState(previous=>({...previous,error:cause instanceof Error?cause.message:'Status unavailable.'}));}
  finally{lock.current=false;if(current.current===scope)setState(previous=>({...previous,busy:false}));}
 },[visible.draft,scope,tenant?.id,itemId,triggerInventoryReload]);
 return {state:visible,edit,setSpecifics:specifics,list:()=>{void finish(true);},saveLater:()=>{void finish(false);},checkLive:()=>{void checkLive();},retry:()=>setRetry(value=>value+1)};
}
