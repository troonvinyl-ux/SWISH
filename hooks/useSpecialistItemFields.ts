import { useState,useEffect,useCallback,useRef } from 'react';
import { useApp } from './useApp';
import { getSpecialistProfile,recordValue } from '@/shared/specialistIntelligence';
import { getProductionNicheSpecialistIds } from '@/services/nicheRouting';
import { saveSpecialistItemFields } from '@/services/specialistItemService';
import type { Item } from '@/services/itemService';
export function useSpecialistItemFields(item:Item,onUpdated:(updates:Partial<Item>)=>void) {
  const { tenant,activeNicheId,fixedNicheId,triggerInventoryReload }=useApp();
  const nicheId=fixedNicheId ?? activeNicheId;const scope=`${tenant?.id}:${nicheId}:${item.id}`;const current=useRef(scope);current.current=scope;
  const profile=getSpecialistProfile(nicheId);
  const allowed=Boolean(tenant?.id===item.tenantId && getProductionNicheSpecialistIds(nicheId).includes(item.specialistId));
  const [values,setValues]=useState<Record<string,string>>({});const [busy,setBusy]=useState(false);const [error,setError]=useState<string|null>(null);const [saved,setSaved]=useState(false);
  useEffect(()=>{
    const fields=recordValue(recordValue(item.attributes._specialist_analysis).fields);const initial:Record<string,string>={};
    for(const descriptor of profile?.fields ?? []) initial[descriptor.key]=String(item.attributes[descriptor.key] ?? recordValue(fields[descriptor.key]).value ?? '');
    setValues(initial);setError(null);setSaved(false);
  },[scope,item.updatedAt]);
  const update=useCallback((key:string,value:string)=>{ setValues(previous=>({ ...previous,[key]:value }));setSaved(false); },[]);
  const save=useCallback(async()=>{
    if(!tenant || !allowed || busy) return;setBusy(true);setError(null);
    try { const result=await saveSpecialistItemFields(tenant.id,nicheId,item.id,values);if(current.current!==scope) return;
      if(result.error || !result.attributes) setError(result.error ?? 'No changes were saved.');
      else { onUpdated({ attributes:result.attributes });setSaved(true);triggerInventoryReload(); }
    } catch(e:any) { if(current.current===scope) setError(e?.message ?? 'Specialist changes could not be saved.'); }
    finally { if(current.current===scope) setBusy(false); }
  },[tenant?.id,allowed,busy,nicheId,item.id,values,scope,onUpdated,triggerInventoryReload]);
  return { profile:allowed ? profile : null,values,update,save,busy,error,saved };
}
