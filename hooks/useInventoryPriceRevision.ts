import { useCallback, useRef, useState, useEffect } from 'react';
import { useModuleOperationGuard } from './useModuleOperationGuard';
import { useApp } from './useApp';
import { reviseListingPrice } from '@/services/listingPriceRevisionService';
import { recommendedInventoryPrice } from '@/services/inventoryPresentationService';
import type { InventoryViewItem } from '@/services/inventoryViewService';
export function useInventoryPriceRevision(onSaved:()=>Promise<void>) {
 const guard=useModuleOperationGuard();const {triggerInventoryReload}=useApp();
 const [state,setState]=useState<{scope:string;busyId:string|null;error:string|null;notice:string|null;uncertain:string[]}>({scope:'',busyId:null,error:null,notice:null,uncertain:[]});
 const flight=useRef(false);const blocked=useRef(new Set<string>());const scopeRef=useRef(guard.scope);
 useEffect(()=>{if(scopeRef.current!==guard.scope){blocked.current.clear();scopeRef.current=guard.scope;}},[guard.scope]);
 const apply=useCallback(async(item:InventoryViewItem)=>{
  const price=recommendedInventoryPrice(item),listing=item.listing;
  if(!guard.ready||!listing||price===null||flight.current||blocked.current.has(listing.id))return;
  const scope=guard.scope;flight.current=true;
  setState(previous=>({scope,busyId:item.id,error:null,notice:null,uncertain:previous.scope===scope?previous.uncertain:[]}));
  try{
   const result=await reviseListingPrice({tenantId:guard.tenantId,nicheId:guard.nicheId!,listingId:listing.id,newPrice:price,expectedPrice:listing.price});
   if(!guard.isCurrent(scope))return;
   if(result.unconfirmed)blocked.current.add(listing.id);
   setState({scope,busyId:null,error:result.error,notice:result.notice,uncertain:[...blocked.current]});
   if(!result.error){triggerInventoryReload();await onSaved();}
  }finally{flight.current=false;setState(previous=>previous.scope===scope?{...previous,busyId:null}:previous);}
 },[guard.ready,guard.scope,guard.tenantId,guard.nicheId,guard.isCurrent,onSaved,triggerInventoryReload]);
 return {apply,busyId:state.scope===guard.scope?state.busyId:null,error:state.scope===guard.scope?state.error:null,notice:state.scope===guard.scope?state.notice:null,blockedIds:state.scope===guard.scope?state.uncertain:[]};
}
