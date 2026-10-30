import { useState, useEffect } from 'react';
import { Dimensions } from 'react-native';
export function useArtworkLayout() {
  const [width,setWidth]=useState(375);
  useEffect(()=>{
    const update=()=>{const next=Dimensions.get('window').width;setWidth(Number.isFinite(next)&&next>0?next:375);};
    update();const subscription=Dimensions.addEventListener('change',update);return()=>subscription.remove();
  },[]);
  return {columns:width>=1024?3:width>=600?2:1};
}
