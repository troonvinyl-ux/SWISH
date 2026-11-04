import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { useApp } from './useApp';
import { loadVerificationResults, runSafeVerification, runEbayVerification, runAntiqueVerification, type VerificationResult } from '@/services/verificationCentreService';
export function useVerificationCentre() {
 const { tenant, isMasterAdmin } = useApp(); const key = `${tenant?.id ?? ''}:${isMasterAdmin}`;
 const current = useRef(key); current.current = key; const request = useRef(0); const lock = useRef(false);
 const [state,setState] = useState<{key:string; rows:VerificationResult[]; error:string|null; busy:boolean}>({key:'',rows:[],error:null,busy:false});
 const perform=useCallback(async(mode:'list'|'run'|'ebay'|'antiques')=>{
  if(!tenant || !isMasterAdmin || lock.current) return;
  lock.current=true; const version=++request.current; setState(previous=>({key, rows:previous.key===key?previous.rows:[],error:null,busy:true}));
  try {
   const result=mode==='list' ? await loadVerificationResults(tenant.id) : mode==='run' ? await runSafeVerification(tenant.id,Platform.OS) : mode==='antiques' ? await runAntiqueVerification(tenant.id,Platform.OS) : await runEbayVerification(tenant.id,Platform.OS);
   if(current.current!==key || request.current!==version) return;
   setState(previous=>({key, rows:mode==='list'?result.results:[...result.results,...(previous.key===key?previous.rows:[])], error:result.error, busy:false}));
  } catch { if(current.current===key && request.current===version) setState(previous=>({...previous,busy:false,error:'Verification failed. No PASS result was inferred.'})); }
  finally {lock.current=false;}
 },[tenant?.id,isMasterAdmin,key]);
 const refresh=useCallback(()=>perform('list'),[perform]); const run=useCallback(()=>perform('run'),[perform]); const ebay=useCallback(()=>perform('ebay'),[perform]); const antiques=useCallback(()=>perform('antiques'),[perform]);
 useEffect(()=>{void refresh();return()=>{request.current++;};},[refresh]);
 return { results:state.key===key?state.rows:[], error:state.key===key?state.error:null, busy:state.key===key && state.busy, refresh, run, ebay, antiques };
}
