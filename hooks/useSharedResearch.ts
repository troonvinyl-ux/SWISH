import { useCallback,useEffect,useMemo,useRef,useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import { useAuth } from '@/template';
import { useApp } from './useApp';
import { researchNiche,type ResearchSnapshot } from '@/services/sharedResearchService';
import { useCatalogueSort } from './useCatalogueSort';
import { getSpecialistProfile } from '@/shared/specialistIntelligence';
export function useSharedResearch(){
 const {tenant,activeNiche,moduleEpoch,accessReady,moduleLoading,subscriptionLoading}=useApp();const {user}=useAuth();const eligible=Boolean(user&&tenant&&accessReady&&!moduleLoading&&!subscriptionLoading);const scope=`${user?.id}:${tenant?.id}:${activeNiche.id}:${moduleEpoch}`;const current=useRef(scope);current.current=scope;
 const flight=useRef<AbortController|null>(null);const [query,setQuery]=useState('');const [imageUri,setImageUri]=useState<string|null>(null);const [filter,setFilter]=useState<'all'|'sold'|'asking'>('all');
 const [state,setState]=useState<{scope:string;busy:boolean;error:string|null;snapshot:ResearchSnapshot|null}>({scope:'',busy:false,error:null,snapshot:null});
 useEffect(()=>{setQuery('');setImageUri(null);setFilter('all');return()=>flight.current?.abort();},[scope]);
 const snapshot=state.scope===scope?state.snapshot:null;const busy=state.scope===scope&&state.busy;
 const filtered=useMemo(()=>snapshot?.results.filter(row=>filter==='all'||row.kind===filter)??[],[snapshot,filter]);
 const values=useCallback((row:ResearchSnapshot['results'][number])=>({price:row.price,date:row.date}),[]);
 const sort=useCatalogueSort(filtered,scope,values);
 const pickImage=useCallback(async()=>{try{const result=await ImagePicker.launchImageLibraryAsync({mediaTypes:ImagePicker.MediaTypeOptions.Images,quality:1,allowsEditing:false});if(current.current===scope&&!result.canceled&&result.assets[0])setImageUri(result.assets[0].uri);}catch{setState(previous=>({...previous,scope,error:'Photo library unavailable. Check permissions.'}));}},[scope]);
 const run=useCallback(async()=>{if(!eligible||!tenant||flight.current||(!query.trim()&&!imageUri))return;const controller=new AbortController();flight.current=controller;const timer=setTimeout(()=>controller.abort(),85000);setState({scope,busy:true,error:null,snapshot});try{const result=await researchNiche({tenantId:tenant.id,nicheId:activeNiche.id,specialistId:activeNiche.defaultSpecialist,query,imageUri,signal:controller.signal});if(current.current===scope&&!controller.signal.aborted)setState({scope,busy:false,error:null,snapshot:result});}catch(error){if(current.current===scope)setState({scope,busy:false,error:controller.signal.aborted?'Research stopped. Try again.':error instanceof Error?error.message:'Research unavailable.',snapshot});}finally{clearTimeout(timer);if(flight.current===controller)flight.current=null;if(current.current===scope)setState(previous=>({...previous,busy:false}));}},[eligible,tenant?.id,scope,activeNiche,query,imageUri,snapshot]);
 return {query,setQuery,imageUri,setImageUri,pickImage,run,busy,error:state.scope===scope?state.error:null,snapshot,filter,setFilter,sort,niche:activeNiche,sources:getSpecialistProfile(activeNiche.id)?.sources??[]};
}
