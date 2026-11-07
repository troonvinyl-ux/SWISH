import { useEffect, useMemo, useState } from 'react';
import { Dimensions } from 'react-native';
import { commandReportLayout } from '@/services/commandReportService';
export function useCommandReportLayout(){
 const [width,setWidth]=useState(375);
 useEffect(()=>{const update=()=>setWidth(Dimensions.get('window').width||375);update();const subscription=Dimensions.addEventListener('change',update);return()=>subscription.remove();},[]);
 return useMemo(()=>commandReportLayout(width),[width]);
}
