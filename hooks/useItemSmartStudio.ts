import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/template';
import { useApp } from './useApp';
import { resolveProductionNiche } from '@/services/nicheRouting';
import { existingOriginalPhotos, existingStudioResult, processExistingItemPhoto } from '@/services/existingImageStudioService';
import type { Item } from '@/services/itemService';
import type { StudioResult } from '@/shared/smartStudio';

export interface ItemStudioProgress {done:number;total:number;ready:number;review:number;failed:number;reused:number;cancelled:boolean}
export interface ItemSmartStudioController {
 busy:boolean;available:boolean;progress:ItemStudioProgress|null;error:string|null;
 resultFor:(uri:string)=>StudioResult|null;canProcess:(uri:string)=>boolean;
 processPhoto:(uri:string)=>Promise<void>;processAll:()=>Promise<void>;cancel:()=>void;
}
interface StudioState {scope:string;busy:boolean;progress:ItemStudioProgress|null;error:string|null}
export function useItemSmartStudio(item:Item|null,onSaved:(item:Item)=>void):ItemSmartStudioController {
 const {user}=useAuth();
 const {tenant,activeNicheId,fixedNicheId,moduleEpoch,accessReady,moduleLoading,subscriptionLoading,triggerInventoryReload}=useApp();
 const nicheId=resolveProductionNiche(fixedNicheId??activeNicheId);
 const scope=`${user?.id}:${tenant?.id}:${nicheId}:${moduleEpoch}:${item?.id}`;
 const eligible=Boolean(item&&user&&tenant&&nicheId&&accessReady&&!moduleLoading&&!subscriptionLoading&&item.tenantId===tenant.id&&resolveProductionNiche(item.specialistId)===nicheId);
 const current=useRef(scope);current.current=scope;
 const ready=useRef(eligible);ready.current=eligible;
 const mounted=useRef(false);const flight=useRef<AbortController|null>(null);
 const [state,setState]=useState<StudioState>({scope:'',busy:false,progress:null,error:null});
 const originals=useMemo(()=>item?existingOriginalPhotos(item):[],[item]);
 const cancel=useCallback(()=>flight.current?.abort(),[]);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;flight.current?.abort();};},[]);
 useEffect(()=>{return()=>{flight.current?.abort();};},[scope,eligible]);
 const run=useCallback(async(uris:string[])=>{
  if(!eligible||!item||!user||!tenant||!nicheId||flight.current)return;
  const photos=[...new Set(uris)].filter(uri=>originals.includes(uri));
  if(!photos.length){setState({scope,busy:false,progress:null,error:'No saved original photos are available for Smart Studio.'});return;}
  const controller=new AbortController();flight.current=controller;
  const progress:ItemStudioProgress={done:0,total:photos.length,ready:0,review:0,failed:0,reused:0,cancelled:false};
  const failures:string[]=[];
  const live=()=>mounted.current&&current.current===scope&&ready.current;
  const publish=()=>{if(live())setState({scope,busy:true,progress:{...progress},error:failures.length?failures.join('\n'):null});};
  publish();
  try{
   for(const uri of photos){
    if(controller.signal.aborted||!live())break;
    const outcome=await processExistingItemPhoto({tenantId:tenant.id,nicheId,itemId:item.id,userId:user.id,originalUri:uri,signal:controller.signal});
    if(!live()||controller.signal.aborted)break;
    progress.done++;
    if(outcome.error||!outcome.item){progress.failed++;failures.push(`Photo ${item.media.indexOf(uri)+1}: ${outcome.error??'Studio result was not saved.'}`);}
    else{
     if(outcome.studio?.status==='review')progress.review++;else progress.ready++;
     if(outcome.reused)progress.reused++;
     onSaved(outcome.item);triggerInventoryReload();
    }
    publish();
   }
  }catch(cause){failures.push(cause instanceof Error?cause.message:'Studio processing failed. Originals remain available.');}
  finally{
   progress.cancelled=controller.signal.aborted;
   if(flight.current===controller)flight.current=null;
   if(live())setState({scope,busy:false,progress:{...progress},error:failures.length?failures.join('\n'):null});
  }
 },[eligible,item,user?.id,tenant?.id,nicheId,scope,originals,onSaved,triggerInventoryReload]);
 const processPhoto=useCallback((uri:string)=>run([uri]),[run]);
 const processAll=useCallback(()=>run(originals),[run,originals]);
 const resultFor=useCallback((uri:string)=>eligible&&item?existingStudioResult(item,uri):null,[eligible,item]);
 const canProcess=useCallback((uri:string)=>eligible&&originals.includes(uri),[eligible,originals]);
 const visible=state.scope===scope;
 return {busy:visible&&state.busy,available:eligible&&originals.length>0,progress:visible?state.progress:null,error:visible?state.error:null,resultFor,canProcess,processPhoto,processAll,cancel};
}
