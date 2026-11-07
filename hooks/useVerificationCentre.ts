import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { useAuth } from '@/template';
import { useApp } from './useApp';
import { loadVerificationResults, runSafeVerification, runEbayVerification, runAntiqueVerification, runProgrammeVerification, type VerificationResult } from '@/services/verificationCentreService';
type VerificationMode='list'|'run'|'ebay'|'antiques'|'programme';
export function useVerificationCentre(enabled=true) {
 const {tenant,isMasterAdmin}=useApp();const {user}=useAuth();const key=`${user?.id??''}:${tenant?.id??''}:${isMasterAdmin}:${enabled}`;
 const current=useRef(key);current.current=key;const generation=useRef(0);const pending=useRef<{key:string;version:number}|null>(null);
 const [state,setState]=useState<{key:string;rows:VerificationResult[];error:string|null;busy:boolean}>({key:'',rows:[],error:null,busy:false});
 const perform=useCallback(async(mode:VerificationMode,sourceSha='',stageId='ALL')=>{
  if(!enabled)return;
  if(!tenant||!isMasterAdmin){
   if(mode!=='list')setState({key,rows:[],error:'Audit persistence requires a verified owner tenant session. Refresh account access and retry.',busy:false});
   return;
  }
  if(pending.current?.key===key)return;
  const version=++generation.current;pending.current={key,version};
  setState(previous=>({key,rows:previous.key===key?previous.rows:[],error:null,busy:true}));
  try {
   const result=mode==='programme'?await runProgrammeVerification(tenant.id,Platform.OS,sourceSha,stageId):mode==='list'?await loadVerificationResults(tenant.id):mode==='run'?await runSafeVerification(tenant.id,Platform.OS):mode==='antiques'?await runAntiqueVerification(tenant.id,Platform.OS):await runEbayVerification(tenant.id,Platform.OS);
   if(current.current!==key||generation.current!==version)return;
   setState(previous=>({key,rows:result.error?(previous.key===key?previous.rows:[]):mode==='list'?result.results:[...result.results,...(previous.key===key?previous.rows:[])],error:result.error,busy:false}));
  }catch{if(current.current===key&&generation.current===version)setState(previous=>({...previous,busy:false,error:'Verification failed. No PASS result was inferred.'}));}
  finally{if(pending.current?.version===version)pending.current=null;}
 },[tenant?.id,isMasterAdmin,key,enabled]);
 const refresh=useCallback(()=>perform('list'),[perform]);const run=useCallback(()=>perform('run'),[perform]);const ebay=useCallback(()=>perform('ebay'),[perform]);const antiques=useCallback(()=>perform('antiques'),[perform]);
 const programme=useCallback((sourceSha:string,stageId='ALL')=>perform('programme',sourceSha,stageId),[perform]);
 useEffect(()=>{if(enabled)void refresh();return()=>{generation.current++;pending.current=null;};},[refresh,enabled]);
 return {programme,results:state.key===key?state.rows:[],error:state.key===key?state.error:null,busy:state.key===key&&state.busy,refresh,run,ebay,antiques};
}
