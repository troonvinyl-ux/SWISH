import { useState,useRef,useCallback,useEffect } from 'react';
import { useFocusEffect } from 'expo-router';
import { useAuth,useAlert } from '@/template';
import { useApp } from './useApp';
import { listMusicPage,type MusicCollectionFilter } from '@/services/tunesService';
import { archiveItem,type Item } from '@/services/itemService';
const emptyFilter:MusicCollectionFilter={field:'artist',query:'',status:'all',sort:'recent',minValue:'',maxValue:''};
export function useMusicCollection(){
 const app=useApp();const {user}=useAuth();const {showAlert}=useAlert();const [filter,setFilter]=useState(emptyFilter);const [selected,setSelected]=useState<string[]>([]);
 const scope=`${user?.id??''}:${app.tenant?.id??''}:${app.activeNicheId}:${app.moduleEpoch}`;const current=useRef(scope);current.current=scope;
 const ready=app.activeNicheId==='tunes_flip'&&app.accessReady&&!app.moduleLoading;const version=useRef(0);const mounted=useRef(true);
 const [state,setState]=useState({scope:'',items:[] as Item[],page:0,more:false,loading:false,error:null as string|null});
 useEffect(()=>{setFilter(emptyFilter);setSelected([]);version.current++;},[scope]);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;version.current++;};},[]);
 const load=useCallback(async(page=0)=>{
  if(!ready||!app.tenant)return;const generation=++version.current;setState(p=>({...p,scope,loading:true,error:null}));
  try{const result=await listMusicPage(app.tenant.id,filter,page);if(mounted.current&&current.current===scope&&generation===version.current)setState(p=>({scope,items:page?[...p.items,...result.items.filter(x=>!p.items.some(y=>y.id===x.id))]:result.items,page,more:result.more,loading:false,error:null}));}
  catch(error){if(mounted.current&&current.current===scope&&generation===version.current)setState({scope,items:[],page:0,more:false,loading:false,error:error instanceof Error?error.message:'Collection read failed.'});}
 },[ready,app.tenant?.id,scope,JSON.stringify(filter)]);
 useFocusEffect(useCallback(()=>{void load();},[load,app.inventoryReloadSignal]));
 const archiveSelected=useCallback(()=>{
  const ids=selected.filter(id=>state.items.some(item=>item.id===id));if(!ids.length||!app.tenant||!ready)return;
  showAlert('Archive selected music?','This uses the shared archive operation, not deletion. Live listings are excluded; end them through the shared listing workflow first.',[{text:'Cancel',style:'cancel'},{text:'Archive',onPress:async()=>{
   const tenantId=app.tenant!.id;const startScope=scope;const errors:string[]=[];
   for(const id of ids){if(current.current!==startScope)break;const item=state.items.find(x=>x.id===id);if(item&&['listed','active','sold','fulfilled','completed'].includes(item.status)){errors.push('Live/sold item excluded');continue;}const result=await archiveItem(id,tenantId,'Music collection bulk archive');if(result.error)errors.push(result.error);}
   if(current.current===startScope){setSelected([]);app.triggerInventoryReload();await load();if(errors.length)showAlert('Some items require attention',errors.join('\n'));}
  }}]);
 },[selected,state.items,app.tenant?.id,ready,scope,showAlert,load,app.triggerInventoryReload]);
 return {ready,filter,setField:(key:keyof MusicCollectionFilter,value:string)=>{setSelected([]);setFilter(p=>({...p,[key]:value}));},items:ready&&state.scope===scope?state.items:[],loading:state.loading,error:state.error,more:state.more,reload:()=>load(),next:()=>load(state.page+1),selected,toggle:(id:string)=>setSelected(p=>p.includes(id)?p.filter(x=>x!==id):[...p,id]),archiveSelected};
}
