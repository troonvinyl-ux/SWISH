import {useState,useRef,useCallback,useEffect,useMemo} from 'react';
import {AppState,InteractionManager} from 'react-native';
import {useApp} from './useApp';
import {useAlert,useAuth} from '@/template';
import {useFocusEffect} from 'expo-router';
import {loadInventoryView,buildInventoryViews,buildAllInventoryRows,syncInventoryOrders,type InventoryViewItem,type InventoryTab} from '@/services/inventoryViewService';
import {submitListingToMarketplace,endListing,type SubmitStep,type ListingWithItem} from '@/services/listingService';
import {fetchAndStoreEbayImages,itemNeedsImages} from '@/services/ebayImageService';
import type {Item} from '@/services/itemService';
import {backendReadsBusy} from '@/services/backendRequestService';
import {isBackendUnavailable} from '@/services/backendAvailabilityService';
export function useMasterInventory(){
 const {tenant,fixedNicheId,activeNicheId,inventoryReloadSignal,subscriptionLoading,accessReady,moduleLoading,moduleEpoch,accessError,tenantError,moduleError}=useApp();
 const {user}=useAuth(),{showAlert}=useAlert();
 const ready=Boolean(user&&tenant?.id&&accessReady&&!moduleLoading&&!subscriptionLoading);
 const readyRef=useRef(ready);readyRef.current=ready;
 const alive=useRef(true),focused=useRef(false);
 const imageTaskRef=useRef<ReturnType<typeof InteractionManager.runAfterInteractions>|null>(null);
 const nicheId=fixedNicheId??activeNicheId,scope=`${user?.id??''}:${tenant?.id??''}:${nicheId}:${moduleEpoch}`;
 const scopeRef=useRef(scope);scopeRef.current=scope;
 const request=useRef(0),pending=useRef<{scope:string;promise: Promise<void>}|null>(null),imagesStarted=useRef(new Set<string>());
 const [snapshot,setSnapshot]=useState<{scope:string;items:Item[];listings:ListingWithItem[];error:string|null}>({scope:'',items:[],listings:[],error:null});
 const [loading,setLoading]=useState(false),[refreshing,setRefreshing]=useState(false),[activeTab,setActiveTab]=useState<InventoryTab>('stock');
 const [submitStep,setSubmitStep]=useState<SubmitStep|null>(null),[submitTitle,setSubmitTitle]=useState(''),[syncing,setSyncing]=useState(false);
 const reload=useCallback(async()=>{
  if(!tenant?.id||!ready)return;
  if(pending.current?.scope===scope)return pending.current.promise;
  const version=++request.current;setLoading(true);
  const valid=()=>alive.current&&scopeRef.current===scope&&request.current===version;
  const failed=(failure:string)=>{if(valid())setSnapshot(previous=>({scope,items:previous.scope===scope&&isBackendUnavailable(failure)?previous.items:[],listings:previous.scope===scope&&isBackendUnavailable(failure)?previous.listings:[],error:failure}));};
  const task=(async()=>{
   try {
    const result=await loadInventoryView(tenant.id,nicheId);
    if(!valid()||!readyRef.current)return;
    if(result.error){failed(result.error);return;}
    setSnapshot({scope,...result});
    const ids=result.items.filter(item=>(item.attributes._ebay_item_id||item.marketplace==='ebay')&&itemNeedsImages(item.media,item.attributes)).map(item=>item.id);
    if(ids.length&&!imagesStarted.current.has(scope)){
     imagesStarted.current.add(scope);
     const imageTask=InteractionManager.runAfterInteractions(()=>{
      if(!alive.current||!readyRef.current||!focused.current||scopeRef.current!==scope||backendReadsBusy()){imagesStarted.current.delete(scope);return;}
      void fetchAndStoreEbayImages(tenant.id,{itemIds:ids,fixTitles:true}).then(progress=>{if(alive.current&&scopeRef.current===scope&&progress.phase==='error')showAlert('Image Sync Incomplete',progress.errorMsg);}).catch(error=>{if(alive.current&&scopeRef.current===scope)showAlert('Image Sync Incomplete',error?.message??'Image sync failed');});
     });
     imageTaskRef.current=imageTask;if(scopeRef.current!==scope||!focused.current){imageTask.cancel();imagesStarted.current.delete(scope);}
    }
   }catch(cause){failed(cause instanceof Error?cause.message:'Inventory could not be loaded');}
   finally{if(pending.current?.scope===scope)pending.current=null;if(valid())setLoading(false);}
  })();pending.current={scope,promise:task};return task;
 },[tenant?.id,nicheId,scope,showAlert,ready]);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;request.current++;pending.current=null;imageTaskRef.current?.cancel();};},[]);
 useFocusEffect(useCallback(()=>{focused.current=true;void reload();return()=>{focused.current=false;imageTaskRef.current?.cancel();imagesStarted.current.delete(scope);};},[reload,scope]));
 useEffect(()=>{
  const timer=setInterval(()=>{if(focused.current&&AppState.currentState==='active'&&!backendReadsBusy())void reload();},90000);
  const sub=AppState.addEventListener('change',state=>{if(state==='active'&&focused.current&&!backendReadsBusy())void reload();});
  return()=>{clearInterval(timer);sub.remove();};
 },[reload]);
 useEffect(()=>{if(inventoryReloadSignal>0&&focused.current)void reload();},[inventoryReloadSignal,reload]);
 const views=useMemo(()=>ready&&snapshot.scope===scope?buildInventoryViews(snapshot.items,snapshot.listings):{stock:[],draft:[],live:[],sold:[]},[snapshot,scope,ready]);
 const allItems=useMemo(()=>ready&&snapshot.scope===scope?buildAllInventoryRows(snapshot.items,views):[],[snapshot,scope,ready,views]);
 const refresh=useCallback(async()=>{setRefreshing(true);try{await reload();}finally{setRefreshing(false);}},[reload]);
 const counts=useMemo(()=>({stock:views.stock.length,draft:views.draft.length,live:views.live.length,sold:views.sold.length}),[views]);
 const submit=useCallback(async(item:InventoryViewItem)=>{
  if(!tenant||!item.listing||submitStep)return;
  const actionScope=scope;setSubmitTitle(item.canonical_title);setSubmitStep('verifying');
  try {
   const result=await submitListingToMarketplace(tenant.id,item.listing.id,step=>{if(scopeRef.current===actionScope)setSubmitStep(step);});
   if(scopeRef.current!==actionScope)return;
   if(!result.success)showAlert('Submission Not Confirmed',result.error??result.failureReasons?.join('\n'));
   else{setActiveTab('live');if(result.warnings?.length)showAlert('eBay Listing Warnings',result.warnings.join('\n'));}
   await reload();
  }catch(error:any){if(scopeRef.current===actionScope)showAlert('Submission Failed',error?.message??'Retry after syncing eBay');}
  finally{if(scopeRef.current===actionScope)setSubmitStep(null);}
 },[tenant?.id,scope,submitStep,showAlert,reload]);
 const end=useCallback((item:InventoryViewItem)=>{
  if(!tenant||!item.listing)return;
  const listing=item.listing,actionScope=scope;
  showAlert('End Listing',`Remove "${item.canonical_title.slice(0,40)}" from eBay?`,[{text:'Cancel',style:'cancel'},{text:'End Listing',style:'destructive',onPress:async()=>{
   const result=await endListing(listing.id,item.id,tenant.id,listing.externalListingId);if(scopeRef.current!==actionScope)return;
   if(result.error){showAlert('End Failed',result.error);return;}setActiveTab('stock');await reload();
  }}]);
 },[tenant?.id,scope,showAlert,reload]);
 const syncSold=useCallback(async()=>{
  if(!tenant||syncing)return;setSyncing(true);
  try{const result=await syncInventoryOrders(tenant.id,nicheId);if(scopeRef.current!==scope)return;
   if(result.error)showAlert('Order Sync Incomplete',result.error);else showAlert('Order Sync Complete',`${result.imported} new orders imported.`);await reload();
  }finally{if(scopeRef.current===scope)setSyncing(false);}
 },[tenant?.id,nicheId,scope,syncing,showAlert,reload]);
 return {nicheId,views,counts,allItems,activeTab,setActiveTab,reload,refresh,refreshing,submit,end,syncSold,syncing,submitStep,submitTitle,ready,scope,error:tenantError??accessError??(!ready?moduleError:null)??(snapshot.scope===scope?snapshot.error:null),loading:ready&&(snapshot.scope!==scope||loading)};
}
