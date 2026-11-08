import {useState,useEffect,useCallback,useRef,useMemo} from 'react';
import {useFocusEffect} from 'expo-router';
import {useAuth} from '@/template';
import {useApp} from './useApp';
import {listItems,getItemStatusCounts,type ItemFilter,type Item} from '@/services/itemService';
import {getProductionNicheSpecialistIds} from '@/services/nicheRouting';
import {recordPrevention} from '@/services/performanceMonitoringService';
import {isBackendUnavailable} from '@/services/backendAvailabilityService';
import {readCanonicalInventoryCounts,emptyCanonicalCounts,type CanonicalInventoryCounts} from '@/services/canonicalInventoryService';
export interface InventoryStats {activeTotal:number;stockCount:number;draftCount:number;liveCount:number;liveItemCount:number;soldCount:number;archivedCount:number;grandTotal:number;unitTotal:number}
interface Snapshot {scope:string;items:Item[];counts:Record<string,number>;canonical:CanonicalInventoryCounts;error:string|null;loading:boolean}
/** Fresh RLS counts validate every reuse; cached data never grants access. */
export interface InventoryReadOptions { enabled?: boolean; countsOnly?: boolean }
export function useInventory(filter:ItemFilter={},options:InventoryReadOptions={}) {
 const enabled=options.enabled??true,countsOnly=options.countsOnly??false;
 const {tenant,activeNicheId,fixedNicheId,inventoryReloadSignal,subscriptionLoading,accessReady,moduleLoading,moduleEpoch,accessError,tenantError}=useApp();
 const {user}=useAuth();
 const niche=fixedNicheId??activeNicheId,filterKey=JSON.stringify(filter);
 const scope=`${user?.id??''}:${tenant?.id??''}:${niche}:${moduleEpoch}:${filterKey}:${countsOnly?'counts':'items'}`;
 const scopeRef=useRef(scope);scopeRef.current=scope;
 const focused=useRef(false),alive=useRef(true),requestId=useRef(0),fullReadAt=useRef(0);
 const ready=Boolean(enabled&&user?.id&&tenant?.id&&accessReady&&!moduleLoading&&!subscriptionLoading);
 const readyRef=useRef(ready);readyRef.current=ready;
 const inFlight=useRef<{scope:string;promise:Promise<void>}|null>(null);
 const [snapshot,setSnapshot]=useState<Snapshot>({scope:'',items:[],counts:{},canonical:emptyCanonicalCounts(),error:null,loading:false});
 const latestSnapshot=useRef(snapshot);latestSnapshot.current=snapshot;
 const load=useCallback(async()=>{
  if(!tenant?.id||!ready)return;
  if(inFlight.current?.scope===scope)return inFlight.current.promise;
  const version=++requestId.current;
  const valid=()=>alive.current&&readyRef.current&&scopeRef.current===scope&&requestId.current===version;
  const allowList=getProductionNicheSpecialistIds(niche);
  const requested=filter.specialistIds??(filter.specialistId?[filter.specialistId]:allowList);
  const effectiveFilter:ItemFilter={...filter,specialistId:undefined,specialistIds:requested.filter(id=>allowList.includes(id))};
  const fullSpecialistScope=allowList.length>0&&new Set(effectiveFilter.specialistIds).size===allowList.length;
  if(!effectiveFilter.lifecycleGroup&&!effectiveFilter.statuses&&!effectiveFilter.status&&!effectiveFilter.reviewRequired)effectiveFilter.lifecycleGroup='active';
  setSnapshot(previous=>previous.scope===scope?{...previous,loading:true}:{scope,items:[],counts:{},canonical:emptyCanonicalCounts(),error:null,loading:true});
  const task=(async()=>{
   try{
    const canonical=await readCanonicalInventoryCounts(tenant.id,niche);if(!valid())return;
    // Home and overview consumers never hydrate the entire item/photo collection.
    if(countsOnly){
     setSnapshot({scope,items:[],counts:canonical.statusCounts??{},canonical,error:null,loading:false});
     return;
    }
    const previous=latestSnapshot.current;
    const unchanged=Boolean(canonical.revision&&previous.scope===scope&&previous.canonical.revision===canonical.revision&&Date.now()-fullReadAt.current<300000);
    if(unchanged)recordPrevention('unchanged_inventory');
    const [result,counts]=await Promise.all([
     unchanged?Promise.resolve({items:previous.items,error:null}):listItems(tenant.id,effectiveFilter),
     fullSpecialistScope&&canonical.statusCounts?Promise.resolve(canonical.statusCounts):getItemStatusCounts(tenant.id,effectiveFilter.specialistIds),
    ]);
    if(!valid())return;if(result.error)throw new Error(result.error);
    if(!unchanged&&canonical.revision){const check=await readCanonicalInventoryCounts(tenant.id,niche);if(check.revision!==canonical.revision)throw new Error('Inventory changed during refresh. Reload to confirm this collection.');}
    if(!valid())return;
    if(!unchanged)fullReadAt.current=Date.now();
    setSnapshot({scope,items:result.items,counts,canonical,error:null,loading:false});
   }catch(cause){
    if(alive.current&&scopeRef.current===scope&&requestId.current===version){
     const failure=cause instanceof Error?cause.message:'Inventory refresh failed';
     setSnapshot(previous=>({scope,items:previous.scope===scope&&isBackendUnavailable(failure)?previous.items:[],counts:previous.scope===scope&&isBackendUnavailable(failure)?previous.counts:{},canonical:previous.scope===scope&&isBackendUnavailable(failure)?previous.canonical:emptyCanonicalCounts(),loading:false,error:failure}));
    }
   }finally{
    if(inFlight.current?.scope===scope)inFlight.current=null;
    if(alive.current&&scopeRef.current===scope&&requestId.current===version)setSnapshot(previous=>previous.scope===scope?{...previous,loading:false}:previous);
   }
  })();inFlight.current={scope,promise:task};return task;
 },[tenant?.id,niche,filterKey,scope,ready,countsOnly]);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;requestId.current++;inFlight.current=null;};},[]);
 useFocusEffect(useCallback(()=>{focused.current=true;void load();return()=>{focused.current=false;};},[load]));
 // Page entry, explicit reload and successful CRUD invalidation only; no background inventory polling.
 useEffect(()=>{if(inventoryReloadSignal>0&&focused.current)void load();},[inventoryReloadSignal,load]);
 const items=ready&&snapshot.scope===scope?snapshot.items:[];
 const statusGroups=ready&&snapshot.scope===scope?snapshot.counts:{};
 const stats=useMemo(():InventoryStats=>{
  const c=ready&&snapshot.scope===scope?snapshot.canonical:emptyCanonicalCounts();
  return {stockCount:c.stock,draftCount:c.draft,liveCount:c.liveListings,liveItemCount:c.live,activeTotal:c.total-c.sold-c.archived,soldCount:c.sold,archivedCount:c.archived,grandTotal:c.total,unitTotal:c.units};
 },[snapshot,scope,ready]);
 const totalValue=useMemo(()=>items.reduce((sum,item)=>sum+(item.valuationMid>0?item.valuationMid:item.expectedSellingPrice??0),0),[items]);
 return {items,stats,statusGroups,totalValue,reviewCount:statusGroups.review_required??0,hasSnapshot:ready&&snapshot.scope===scope&&Boolean(snapshot.canonical.revision),loading:ready&&(snapshot.scope!==scope||snapshot.loading),syncError:tenantError??accessError??(snapshot.scope===scope?snapshot.error:null),reload:load};
}
