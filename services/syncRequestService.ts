// Existing client/auth only. Collapse in-flight syncs, bound waiting, and never automatically replay a mutation.
import {getSupabaseClient} from '@/template';
import {backendDataScope,shareBackendRequest} from './backendRequestService';
import {measurePerformance,recordPrevention} from './performanceMonitoringService';
export interface SyncResponse {data:any;error:Error|null}
const activeSyncs=new Set<string>();
export async function invokeScopedSync(endpoint:string,body:Record<string,unknown>,timeoutMs=105000) {
 const captured=await backendDataScope();
 const key=`sync:${endpoint}:${JSON.stringify(body)}`,scopedKey=`${captured}:${key}`;
 if(activeSyncs.has(scopedKey))recordPrevention('sync_flight');
 activeSyncs.add(scopedKey);
 return shareBackendRequest(key,async()=>{
  if(await backendDataScope()!==captured)throw new Error('Authenticated session changed before sync dispatch.');
  const controller=new AbortController();
  const response=await measurePerformance('sync_api',()=>new Promise<SyncResponse>((resolve,reject)=>{
   let settled=false;
   const finish=(action:()=>void)=>{if(settled)return;settled=true;clearTimeout(timer);action();};
   const timer=setTimeout(()=>finish(()=>{controller.abort();reject(new Error('Sync timed out. Existing records are retained; reload the saved operation before retrying.'));}),Math.max(1,Math.min(120000,timeoutMs)));
   void getSupabaseClient().functions.invoke(endpoint,{body,signal:controller.signal}).then(value=>finish(()=>resolve(value)),cause=>finish(()=>reject(cause)));
  }),value=>Boolean(value.error)||value.data?.success===false);
  if(await backendDataScope()!==captured)throw new Error('Authenticated session changed during sync. Reopen the original workspace to check its outcome.');
  return response;
 }).finally(()=>activeSyncs.delete(scopedKey));
}
