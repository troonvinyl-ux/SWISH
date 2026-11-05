import { useState,useEffect,useCallback,useRef,useMemo } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useAuth } from '@/template';
import { useApp } from './useApp';
import { listItems,getItemStatusCounts,ITEM_LIFECYCLE,type ItemFilter,type Item } from '@/services/itemService';
import { getProductionNicheSpecialistIds } from '@/services/nicheRouting';
import { backendReadsBusy } from '@/services/backendRequestService';
import { isBackendUnavailable } from '@/services/backendAvailabilityService';
export interface InventoryStats { activeTotal:number;draftCount:number;liveCount:number;soldCount:number;archivedCount:number;grandTotal:number }
interface Snapshot {scope:string;items:Item[];counts:Record<string,number>;error:string|null;loading:boolean}
/** Same canonical data on native and web. Sharing happens in the services, never in local grants. */
export function useInventory(filter:ItemFilter={}) {
  const {tenant,activeNicheId,fixedNicheId,inventoryReloadSignal,subscriptionLoading,accessReady,moduleLoading,moduleEpoch,accessError,tenantError}=useApp();
  const {user}=useAuth();
  const niche=fixedNicheId??activeNicheId;const filterKey=JSON.stringify(filter);
  const scope=`${user?.id??''}:${tenant?.id??''}:${niche}:${moduleEpoch}:${filterKey}`;
  const scopeRef=useRef(scope);scopeRef.current=scope;
  const focused=useRef(false);const alive=useRef(true);const requestId=useRef(0);
  const ready=Boolean(user?.id&&tenant?.id&&accessReady&&!moduleLoading&&!subscriptionLoading);
  const readyRef=useRef(ready);readyRef.current=ready;
  const inFlight=useRef<{scope:string;promise:Promise<void>}|null>(null);
  const [snapshot,setSnapshot]=useState<Snapshot>({scope:'',items:[],counts:{},error:null,loading:false});
  const load=useCallback(async()=>{
    if(!tenant?.id||!ready)return;
    if(inFlight.current?.scope===scope)return inFlight.current.promise;
    const version=++requestId.current;
    const allowList=getProductionNicheSpecialistIds(niche);
    const requested=filter.specialistIds??(filter.specialistId?[filter.specialistId]:allowList);
    const effectiveFilter:ItemFilter={...filter,specialistId:undefined,specialistIds:requested.filter(id=>allowList.includes(id))};
    if(!effectiveFilter.lifecycleGroup&&!effectiveFilter.statuses&&!effectiveFilter.status&&!effectiveFilter.reviewRequired)effectiveFilter.lifecycleGroup='active';
    setSnapshot(prev=>prev.scope===scope?{...prev,loading:true}:{scope,items:[],counts:{},error:null,loading:true});
    const task=(async()=>{
      try {
        // Individual pages and summaries are session-keyed, deduplicated and bounded by the shared scheduler.
        const [result,counts]=await Promise.all([listItems(tenant.id,effectiveFilter),getItemStatusCounts(tenant.id,effectiveFilter.specialistIds)]);
        if(!alive.current||!readyRef.current||scopeRef.current!==scope||requestId.current!==version)return;
        if(result.error)throw new Error(result.error);
        setSnapshot({scope,items:result.items,counts,error:null,loading:false});
      } catch(cause) {
        if(alive.current&&scopeRef.current===scope&&requestId.current===version){
          const failure=cause instanceof Error?cause.message:'Inventory refresh failed';
          // Explicit authorization/entitlement denials discard visible data. Only transient reads retain it.
          setSnapshot(prev=>({scope,items:prev.scope===scope&&isBackendUnavailable(failure)?prev.items:[],counts:prev.scope===scope&&isBackendUnavailable(failure)?prev.counts:{},loading:false,error:failure}));
        }
      } finally {
        if(inFlight.current?.scope===scope)inFlight.current=null;
        if(alive.current&&scopeRef.current===scope&&requestId.current===version)setSnapshot(prev=>prev.scope===scope?{...prev,loading:false}:prev);
      }
    })();
    inFlight.current={scope,promise:task};return task;
  },[tenant?.id,niche,filterKey,scope,ready]);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;requestId.current++;inFlight.current=null;};},[]);
  useFocusEffect(useCallback(()=>{focused.current=true;void load();return()=>{focused.current=false;};},[load]));
  useEffect(()=>{
    const timer=setInterval(()=>{if(focused.current&&AppState.currentState==='active'&&!backendReadsBusy())void load();},90000);
    const sub=AppState.addEventListener('change',state=>{if(state==='active'&&focused.current&&!backendReadsBusy())void load();});
    return()=>{clearInterval(timer);sub.remove();};
  },[load]);
  useEffect(()=>{if(inventoryReloadSignal>0&&focused.current)void load();},[inventoryReloadSignal,load]);
  const items=ready&&snapshot.scope===scope?snapshot.items:[];
  const statusGroups=ready&&snapshot.scope===scope?snapshot.counts:{};
  const stats=useMemo(():InventoryStats=>{
    const sum=(statuses:readonly string[])=>statuses.reduce((total,status)=>total+(statusGroups[status]??0),0);
    const draftCount=sum(ITEM_LIFECYCLE.DRAFT_STATUSES),liveCount=sum(ITEM_LIFECYCLE.LIVE_STATUSES);
    return {draftCount,liveCount,activeTotal:draftCount+liveCount,soldCount:sum(ITEM_LIFECYCLE.SOLD_STATUSES),archivedCount:sum(ITEM_LIFECYCLE.ARCHIVED_STATUSES),grandTotal:Object.values(statusGroups).reduce((a,b)=>a+b,0)};
  },[statusGroups]);
  const totalValue=useMemo(()=>items.reduce((sum,item)=>sum+(item.valuationMid>0?item.valuationMid:item.expectedSellingPrice??0),0),[items]);
  return {items,stats,statusGroups,totalValue,reviewCount:statusGroups.review_required??0,loading:ready&&(snapshot.scope!==scope||snapshot.loading),syncError:tenantError??accessError??(snapshot.scope===scope?snapshot.error:null),reload:load};
}
