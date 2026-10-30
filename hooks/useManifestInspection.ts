import { useState, useRef } from 'react';
import { useApp } from './useApp';
import { confirmManifestInspection } from '@/services/manifestReviewService';
export function useManifestInspection(itemId: string) {
  const { tenant, fixedNicheId, activeNicheId, triggerInventoryReload }=useApp();
  const [busy,setBusy]=useState(false); const [error,setError]=useState<string | null>(null);
  const scope=`${tenant?.id}:${fixedNicheId ?? activeNicheId}:${itemId}`; const currentScope=useRef(scope); currentScope.current=scope;
  const confirm=async()=>{
    if(!tenant || busy) return null; setBusy(true);setError(null);
    try { const result=await confirmManifestInspection(tenant.id,itemId,fixedNicheId ?? activeNicheId); if(currentScope.current!==scope) return null; triggerInventoryReload();return result; }
    catch(e:any){if(currentScope.current===scope)setError(e?.message ?? 'Inspection review could not be saved.');return null;}
    finally{setBusy(false);}
  };
  return { busy,error,confirm };
}
