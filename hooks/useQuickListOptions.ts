import { useState, useCallback, useEffect } from 'react';
import { Dimensions } from 'react-native';
import { pickFromLibrary } from '@/services/aiIdentificationService';
import { invokeListingOperation } from '@/services/listingEditorService';
import { readQuickListMetrics } from '@/services/quickListTelemetryService';
import { useApp } from './useApp';
import type { useQuickList } from './useQuickList';
export function useQuickListOptions(flow:ReturnType<typeof useQuickList>,nicheId:string){
 const {tenant}=useApp();const [categories,setCategories]=useState<Array<{id:string;name:string}>>([]),[query,setQuery]=useState(''),[barcode,setBarcode]=useState(''),[manual,setManual]=useState(false),[metrics,setMetrics]=useState<any>(null),[metricsError,setMetricsError]=useState(''),[width,setWidth]=useState(375);
 useEffect(()=>{const update=()=>setWidth(Math.max(320,Dimensions.get('window').width||375));update();const subscription=Dimensions.addEventListener('change',update);return()=>subscription.remove();},[]);
 const gallery=useCallback(async()=>{flow.captureStart();try{const image=await pickFromLibrary('photo','Product photo');if(image)await flow.addPhoto(image);}catch(cause){flow.patch({error:cause instanceof Error?cause.message:'Photo library unavailable.'});}},[flow.addPhoto,flow.captureStart,flow.patch]);
 const search=useCallback(async()=>{if(!tenant)return;flow.action();const response=await invokeListingOperation({route:'get_category_suggestions',tenantId:tenant.id,query:query||flow.state.result?.canonicalTitle||flow.state.lead?.title},'swish-ebay-category');setCategories((response.data?.suggestions??[]).filter((row:any)=>row.isLeaf===true));if(response.error)flow.patch({error:response.error});},[tenant?.id,query,flow.action,flow.patch,flow.state.result?.canonicalTitle,flow.state.lead?.title]);
 const report=useCallback(async()=>{if(!tenant)return;flow.action();const response=await readQuickListMetrics(tenant.id,nicheId);setMetrics(response.metrics);setMetricsError(response.error??'');},[tenant?.id,nicheId,flow.action]);
 return {categories,query,setQuery,barcode,setBarcode,manual,setManual,metrics,metricsError,width,gallery,search,report};
}
