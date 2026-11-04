import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from './useApp';
import { getItem, updateItem, type Item } from '@/services/itemService';
export function useAntiqueCondition(itemId: string) {
  const { tenant, activeNicheId, fixedNicheId, triggerInventoryReload } = useApp();
  const scope = `${tenant?.id}:${fixedNicheId ?? activeNicheId}:${itemId}`;
  const current = useRef(scope); current.current = scope;
  const lock = useRef(false);
  const [state, setState] = useState<{scope:string;item:Item|null;condition:string;notes:string;busy:boolean;error:string;saved:boolean}>({scope:'',item:null,condition:'',notes:'',busy:false,error:'',saved:false});
  useEffect(()=>{
    let alive=true;
    if(!tenant)return;
    setState({scope,item:null,condition:'',notes:'',busy:true,error:'',saved:false});
    void getItem(itemId).then(result=>{
      if(!alive||current.current!==scope)return;
      if(result.error||!result.item||result.item.tenantId!==tenant.id||!['antiques','books'].includes(result.item.specialistId)||(fixedNicheId??activeNicheId)!=='antiques') {setState(previous=>({...previous,busy:false,error:result.error??'Item not found in your Antique workspace.'}));return;}
      setState({scope,item:result.item,condition:result.item.condition,notes:result.item.conditionNotes,busy:false,error:'',saved:false});
    }).catch(()=>{if(alive&&current.current===scope)setState(previous=>({...previous,busy:false,error:'Condition could not load.'}));});
    return()=>{alive=false;};
  },[scope,tenant?.id,itemId,fixedNicheId,activeNicheId]);
  const change=useCallback((key:'condition'|'notes',value:string)=>setState(previous=>({...previous,[key]:value,saved:false})),[]);
  const save=useCallback(async()=>{
    if(!tenant||!state.item||state.scope!==scope||lock.current)return;
    if(!state.condition.trim()||state.notes.length>1000){setState(previous=>({...previous,error:'Enter a condition and at most 1,000 characters of condition notes.'}));return;}
    lock.current=true;setState(previous=>({...previous,busy:true,error:''}));
    try {
      const result=await updateItem(itemId,{condition:state.condition.trim(),conditionNotes:state.notes},tenant.id);
      if(result.error)throw new Error(result.error);
      const persisted=await getItem(itemId);
      if(persisted.error||persisted.item?.tenantId!==tenant.id||persisted.item.condition!==state.condition.trim()||persisted.item.conditionNotes!==state.notes)throw new Error('Save could not be confirmed by persisted readback. Reload before listing.');
      if(current.current!==scope)return;
      setState(previous=>({...previous,item:persisted.item,saved:true}));triggerInventoryReload();
    }catch(cause){if(current.current===scope)setState(previous=>({...previous,error:cause instanceof Error?cause.message:'Save not confirmed.'}));}
    finally{lock.current=false;if(current.current===scope)setState(previous=>({...previous,busy:false}));}
  },[tenant?.id,state,scope,itemId,triggerInventoryReload]);
  return {...(state.scope===scope?state:{item:null,condition:'',notes:'',busy:true,error:'',saved:false}),change,save};
}
