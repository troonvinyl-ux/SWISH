import { createContext, useState, useEffect, useRef, useCallback, type ReactNode } from 'react';
import { useAuth } from '@/template';
import { useApp } from '@/hooks/useApp';
import { searchDiscogs, getDiscogsRelease, getDiscogsVersions, getDiscogsSetup, checkDiscogsConnection, type DiscogsMode, type DiscogsSearch, type DiscogsSetup } from '@/services/discogsService';
import { addCatalogueMusic, attachMusicRelease } from '@/services/tunesService';
import { isFreshMusicRelease, type MusicRelease } from '@/shared/musicRelease';
interface TunesState {scope:string;query:string;artist:string;mode:DiscogsMode;search:DiscogsSearch|null;release:MusicRelease|null;confirmed:boolean;savedId:string|null;busy:boolean;error:string|null;setup:DiscogsSetup|null;connection:string|null}
const empty=(scope:string):TunesState=>({scope,query:'',artist:'',mode:'text',search:null,release:null,confirmed:false,savedId:null,busy:false,error:null,setup:null,connection:null});
export interface TunesContextValue {state:TunesState;ready:boolean;setQuery:(v:string)=>void;setArtist:(v:string)=>void;setMode:(v:DiscogsMode)=>void;search:(page?:number,barcode?:string)=>Promise<void>;select:(id:number)=>Promise<void>;versions:()=>Promise<void>;confirm:()=>void;reset:()=>void;save:(itemId?:string)=>Promise<string|null>;inspectSetup:()=>Promise<void>;testConnection:()=>Promise<void>}
export const TunesContext=createContext<TunesContextValue|undefined>(undefined);
export function TunesProvider({children}:{children:ReactNode}){
 const app=useApp();const {user}=useAuth();const scope=`${user?.id??''}:${app.tenant?.id??''}:${app.activeNicheId}:${app.moduleEpoch}`;
 const current=useRef(scope);current.current=scope;const lock=useRef<string|null>(null);const alive=useRef(true);
 const [stored,setStored]=useState<TunesState>(empty(scope));const state=stored.scope===scope?stored:empty(scope);
 const ready=Boolean(user&&app.tenant&&app.activeNicheId==='tunes_flip'&&app.accessReady&&!app.moduleLoading);
 useEffect(()=>{setStored(empty(scope));},[scope]);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 const commit=useCallback((patch:Partial<TunesState>)=>{if(alive.current&&current.current===scope)setStored(prev=>({... (prev.scope===scope?prev:empty(scope)),...patch}));},[scope]);
 const run=useCallback(async(task:()=>Promise<Partial<TunesState>>)=>{
  if(!ready||lock.current===scope)return;lock.current=scope;commit({busy:true,error:null});
  try{const patch=await task();commit(patch);}catch(error){commit({error:error instanceof Error?error.message:'Music operation failed.'});}
  finally{if(lock.current===scope)lock.current=null;commit({busy:false});}
 },[scope,ready,commit]);
 const search=useCallback(async(page=1,barcode?:string)=>{
  await run(async()=>({search:!barcode&&state.search?.masterId?await getDiscogsVersions(app.tenant!.id,state.search.masterId,page):await searchDiscogs(app.tenant!.id,barcode??state.query,barcode?'barcode':state.mode,page,state.artist),release:null,confirmed:false,...(barcode?{query:barcode,mode:'barcode' as const}:{})}));
 },[run,app.tenant?.id,state.query,state.mode,state.artist,state.search?.masterId]);
 const select=useCallback(async(id:number)=>{commit({confirmed:false});await run(async()=>({release:await getDiscogsRelease(app.tenant!.id,id),confirmed:false}));},[run,app.tenant?.id,commit]);
 const versions=useCallback(async()=>{const master=state.release?.masterId;if(!master)return;await run(async()=>({search:await getDiscogsVersions(app.tenant!.id,master),release:null,confirmed:false}));},[state.release?.masterId,run,app.tenant?.id]);
 const save=useCallback(async(itemId?:string)=>{
  let id:string|null=null;await run(async()=>{
   if(!state.confirmed||!isFreshMusicRelease(state.release))throw new Error('Retrieve and confirm the exact pressing before saving.');
   if(itemId){await attachMusicRelease(app.tenant!.id,itemId,state.release,true);id=itemId;}
   else if(state.savedId)throw new Error('This catalogue item is already saved. Open it or start a new release search.');
   else{const result=await addCatalogueMusic(app.tenant!.id,state.release,true);if(result.item){id=result.item.id;commit({savedId:id});}if(result.error||!result.item)throw new Error(result.error??'Inventory creation was not confirmed.');}
   if(current.current===scope)app.triggerInventoryReload();return {savedId:id};
  });return current.current===scope?id:null;
 },[run,state.confirmed,state.release,state.savedId,app.tenant?.id,scope,app.triggerInventoryReload,commit]);
 const inspectSetup=useCallback(async()=>{await run(async()=>({setup:await getDiscogsSetup()}));},[run]);
 const testConnection=useCallback(async()=>{await run(async()=>{const result=await checkDiscogsConnection();return {connection:`${result.connectivity} · ${result.checkedAt} · reference ${result.releaseId} · read-only`};});},[run]);
 return <TunesContext.Provider value={{state,ready,setQuery:v=>commit({query:v,search:null}),setArtist:v=>commit({artist:v,search:null}),setMode:v=>commit({mode:v,search:null}),search,select,versions,confirm:()=>{if(isFreshMusicRelease(state.release))commit({confirmed:true,error:null});else commit({error:'Catalogue result expired. Retrieve the release again.'});},reset:()=>{if(!state.busy)commit(empty(scope));},save,inspectSetup,testConnection}}>{children}</TunesContext.Provider>;
}
