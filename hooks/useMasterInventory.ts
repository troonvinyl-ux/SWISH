import {useState,useRef,useCallback,useEffect,useMemo} from 'react';
import {useApp} from './useApp';
import {useAlert,useAuth} from '@/template';
import {useFocusEffect} from 'expo-router';
import {loadInventoryView,buildInventoryViews,buildAllInventoryRows,syncInventoryOrders,type InventoryViewItem,type InventoryTab} from '@/services/inventoryViewService';
import {submitListingToMarketplace,endListing,type SubmitStep,type ListingWithItem} from '@/services/listingService';
import type {Item} from '@/services/itemService';
import {isBackendUnavailable} from '@/services/backendAvailabilityService';
import type {CanonicalInventoryCounts} from '@/services/canonicalInventoryService';
export function useMasterInventory(){
 const {tenant,fixedNicheId,activeNicheId,subscriptionLoading,accessReady,moduleLoading,moduleEpoch,accessError,tenantError,moduleError,triggerInventoryReload}=useApp();
 const {user}=useAuth(),{showAlert}=useAlert();
 const ready=Boolean(user&&tenant?.id&&accessReady&&!moduleLoading&&!subscriptionLoading);
 const readyRef=useRef(ready);readyRef.current=ready;
 const alive=useRef(true),focused=useRef(false);
 const nicheId=fixedNicheId??activeNicheId,scope=`${user?.id??''}:${tenant?.id??''}:${nicheId}:${moduleEpoch}`;
 const scopeRef=useRef(scope);scopeRef.current=scope;
 const request=useRef(0),pending=useRef<{scope:string;promise: Promise<void>}|null>(null);
 const [snapshot,setSnapshot]=useState<{scope:string;items:Item[];listings:ListingWithItem[];canonicalCounts?:CanonicalInventoryCounts;error:string|null}>({scope:'',items:[],listings:[],error:null});
 const [loading,setLoading]=useState(false),[refreshing,setRefreshing]=useState(false),[activeTab,setActiveTab]=useState<InventoryTab>('stock');
 const [submitStep,setSubmitStep]=useState<SubmitStep|null>(null),[submitTitle,setSubmitTitle]=useState(''),[syncing,setSyncing]=useState(false);
 const ending=useRef(false);const [endingItemId,setEndingItemId]=useState<string|null>(null);

 const reload=useCallback(async()=>{
  if(!tenant?.id||!ready)return;
  if(pending.current?.scope===scope)return pending.current.promise;
  const version=++request.current;setLoading(true);
  const valid=()=>alive.current&&scopeRef.current===scope&&request.current===version;
  const failed=(failure:string)=>{if(valid())setSnapshot(previous=>({scope,items:previous.scope===scope&&isBackendUnavailable(failure)?previous.items:[],listings:previous.scope===scope&&isBackendUnavailable(failure)?previous.listings:[],canonicalCounts:previous.scope===scope&&isBackendUnavailable(failure)?previous.canonicalCounts:undefined,error:failure}));};
  const task=(async()=>{
   try {
    const result=await loadInventoryView(tenant.id,nicheId);
    if(!valid()||!readyRef.current)return;
    if(result.error){failed(result.error);return;}
    setSnapshot({scope,...result});
    // Inventory is a read-only page refresh. Photo recovery is an explicit item action.
   }catch(cause){failed(cause instanceof Error?cause.message:'Inventory could not be loaded');}
   finally{if(pending.current?.scope===scope)pending.current=null;if(valid())setLoading(false);}
  })();pending.current={scope,promise:task};return task;
 },[tenant?.id,nicheId,scope,ready]);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;request.current++;pending.current=null;};},[]);
 const reloadRef=useRef(reload);reloadRef.current=reload;
 // Only genuine page entry/access readiness runs a read. Context changes while open do not poll.
 useFocusEffect(useCallback(()=>{focused.current=true;if(ready)void reloadRef.current();return()=>{focused.current=false;};},[scope,ready]));
 const removeDeletedItem=useCallback((itemId:string)=>{
  request.current++;pending.current=null;
  setSnapshot(previous=>previous.scope===scope?{...previous,items:previous.items.filter(item=>item.id!==itemId),listings:previous.listings.filter(listing=>listing.itemId!==itemId),canonicalCounts:undefined}:previous);
  void reload();
 },[scope,reload]);
 const views=useMemo(()=>ready&&snapshot.scope===scope?buildInventoryViews(snapshot.items,snapshot.listings):{stock:[],draft:[],live:[],sold:[]},[snapshot,scope,ready]);
 const allItems=useMemo(()=>ready&&snapshot.scope===scope?buildAllInventoryRows(snapshot.items,views):[],[snapshot,scope,ready,views]);
 const refresh=useCallback(async()=>{setRefreshing(true);try{await reload();}finally{setRefreshing(false);}},[reload]);
 const canonical=ready&&snapshot.scope===scope?snapshot.canonicalCounts:undefined;
 const counts=useMemo(()=>({stock:canonical?.stock??views.stock.length,draft:canonical?.draft??views.draft.length,live:canonical?.live??views.live.length,sold:canonical?.sold??views.sold.length}),[views,canonical]);
 const totalCount=canonical?.total??allItems.length,unitCount=canonical?.units??0,liveListingCount=canonical?.liveListings??0;
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
  if(!tenant||!item.listing||!ready||ending.current)return;
  const listing=item.listing,actionScope=scope;
  showAlert('End listing on eBay?',`End “${item.canonical_title.slice(0,60)}” on eBay? The item and its photographs stay in inventory. After confirmation, use Delete item in In Stock if you also want to remove it from SWISH.`,[{text:'Cancel',style:'cancel'},{text:'End on eBay',style:'destructive',onPress:async()=>{
   if(!alive.current||!readyRef.current||scopeRef.current!==actionScope||ending.current)return;
   ending.current=true;setEndingItemId(item.id);
   try{
    const result=await endListing(listing.id,item.id,tenant.id,listing.externalListingId);if(!alive.current||scopeRef.current!==actionScope)return;
    triggerInventoryReload();
    if(result.error){showAlert('End not confirmed',result.error);await reload();return;}
    setActiveTab('stock');await reload();
   }finally{ending.current=false;if(alive.current&&scopeRef.current===actionScope)setEndingItemId(null);}
  }}]);
 },[tenant?.id,scope,ready,showAlert,reload,triggerInventoryReload]);
 const syncSold=useCallback(async()=>{
  if(!tenant||syncing)return;setSyncing(true);
  try{const result=await syncInventoryOrders(tenant.id,nicheId);if(scopeRef.current!==scope)return;
   if(result.error)showAlert('Order Sync Incomplete',result.error);else showAlert('Order Sync Complete',`${result.imported} new orders imported.`);await reload();
  }finally{if(scopeRef.current===scope)setSyncing(false);}
 },[tenant?.id,nicheId,scope,syncing,showAlert,reload]);
 const hasSnapshot=ready&&snapshot.scope===scope&&Boolean(snapshot.canonicalCounts);
 return {hasSnapshot,nicheId,views,counts,allItems,totalCount,unitCount,liveListingCount,activeTab,setActiveTab,reload,refresh,refreshing,submit,end,removeDeletedItem,endingItemId,syncSold,syncing,submitStep,submitTitle,ready,scope,error:tenantError??accessError??(!ready?moduleError:null)??(snapshot.scope===scope?snapshot.error:null),loading:ready&&(snapshot.scope!==scope||loading)};
}
