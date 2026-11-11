import { useCallback,useEffect,useRef,useState } from 'react';
import { useApp } from './useApp';
import { addListingPhoto } from '@/services/listingPhotoService';
import { getItem, type Item } from '@/services/itemService';
import { resolveProductionNiche } from '@/services/nicheRouting';
export function useListingPhotoManager(itemId:string,onAdded:(item:Item)=>void){
 const app=useApp();const nicheId=resolveProductionNiche(app.fixedNicheId??app.activeNicheId);const scope=`${app.tenant?.id}:${nicheId}:${app.moduleEpoch}:${itemId}`;
 const current=useRef(scope);current.current=scope;const callback=useRef(onAdded);callback.current=onAdded;
 const [item,setItem]=useState<Item|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');const lock=useRef(false);
 useEffect(()=>{let active=true;setItem(null);setError('');setBusy(false);if(itemId&&app.tenant?.id&&nicheId)void getItem(itemId).then(result=>{if(!active||current.current!==scope)return;if(result.error||result.item?.tenantId!==app.tenant?.id||resolveProductionNiche(result.item?.specialistId)!==nicheId)setError(result.error??'Photo archive is unavailable in this niche.');else setItem(result.item);}).catch(()=>{if(active)setError('Photo archive could not load.');});return()=>{active=false;};},[scope]);
 const add=useCallback(async(source:'camera'|'library')=>{if(lock.current||!app.tenant?.id||!nicheId||!app.accessReady)return;lock.current=true;setBusy(true);setError('');try{const saved=await addListingPhoto(app.tenant.id,nicheId,itemId,source,()=>current.current===scope);if(saved&&current.current===scope){setItem(saved);callback.current(saved);app.triggerInventoryReload();}}catch(cause){if(current.current===scope)setError(cause instanceof Error?cause.message:'Photo addition failed.');}finally{lock.current=false;if(current.current===scope)setBusy(false);}},[scope,app.tenant?.id,app.accessReady,nicheId,itemId,app.triggerInventoryReload]);
 return {item,busy,error,add};
}
