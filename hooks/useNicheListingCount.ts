import { useState,useEffect } from 'react';
import { AppState } from 'react-native';
import { useApp } from './useApp';
import { getLiveListingCount } from '@/services/listingService';
import { getProductionNicheSpecialistIds } from '@/services/nicheRouting';
/** Badge shares the server's tab classification; stale account responses cannot leak into a new niche. */
export function useNicheListingCount() {
  const {tenant,fixedNicheId,activeNicheId,inventoryReloadSignal}=useApp();
  const niche=fixedNicheId??activeNicheId;const scope=`${tenant?.id??''}:${niche}`;
  const [snapshot,setSnapshot]=useState({scope:'',count:0});
  useEffect(()=>{
    let cancelled=false;let busy=false;
    const refresh=async()=>{
      if(!tenant?.id||busy)return;busy=true;
      try{const count=await getLiveListingCount(tenant.id,getProductionNicheSpecialistIds(niche));if(!cancelled)setSnapshot({scope,count});}
      finally{busy=false;}
    };
    void refresh();const timer=setInterval(()=>{void refresh();},30_000);const sub=AppState.addEventListener('change',state=>{if(state==='active')void refresh();});
    return()=>{cancelled=true;clearInterval(timer);sub.remove();};
  },[tenant?.id,niche,scope,inventoryReloadSignal]);
  return snapshot.scope===scope?snapshot.count:0;
}
