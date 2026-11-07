import { useState,useEffect,useRef } from 'react';
import { isBackendUnavailable } from '@/services/backendAvailabilityService';
import { AppState } from 'react-native';
import { useApp } from './useApp';
import { useAuth } from '@/template';
import { getLiveListingCount } from '@/services/listingService';
import { getProductionNicheSpecialistIds } from '@/services/nicheRouting';
import { backendReadsBusy } from '@/services/backendRequestService';
/** Shared server classification. Failed refreshes retain only the same authenticated scope. */
export function useNicheListingCount() {
  const {tenant,fixedNicheId,activeNicheId,inventoryReloadSignal,accessReady,moduleLoading,moduleEpoch}=useApp();
  const {user}=useAuth();
  const niche=fixedNicheId??activeNicheId;const scope=`${user?.id??''}:${tenant?.id??''}:${niche}:${moduleEpoch}`;
  const [snapshot,setSnapshot]=useState({scope:'',count:0});
  const currentScope=useRef(scope);currentScope.current=scope;
  useEffect(()=>{
    let cancelled=false;let busy=false;
    const refresh=async(background=false)=>{
      if(!tenant?.id||!accessReady||moduleLoading||!getProductionNicheSpecialistIds(niche).length||busy||AppState.currentState==='background'||(background&&backendReadsBusy()))return;
      busy=true;
      try {
        const count=await getLiveListingCount(tenant.id,getProductionNicheSpecialistIds(niche));
        if(!cancelled&&currentScope.current===scope)setSnapshot({scope,count});
      } catch(cause) {
        const message=cause instanceof Error?cause.message:'Live inventory count unavailable';
        if(!cancelled&&currentScope.current===scope&&!isBackendUnavailable(message))setSnapshot({scope,count:0});
        // A transient refresh preserves the badge. Inventory exposes its actionable read error.
      } finally{busy=false;}
    };
    // Read on scope entry and explicit successful inventory mutations only; no timer/foreground polling.
    void refresh();
    return()=>{cancelled=true;};
  },[tenant?.id,niche,scope,inventoryReloadSignal,accessReady,moduleLoading]);
  return accessReady&&!moduleLoading&&snapshot.scope===scope?snapshot.count:0;
}
