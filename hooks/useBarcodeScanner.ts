import { useCallback,useEffect,useRef,useState } from 'react';
import { Platform } from 'react-native';
import { CameraView,useCameraPermissions,type BarcodeScanningResult } from 'expo-camera';
export function useBarcodeScanner(onValue:(value:string,type:string)=>void){
 const camera=useRef<CameraView>(null);const [permission,requestPermission]=useCameraPermissions();const [ready,setReady]=useState(false),[error,setError]=useState('');const locked=useRef(false),callback=useRef(onValue);callback.current=onValue;
 const scanned=useCallback((result:BarcodeScanningResult)=>{if(locked.current||!result.data.trim())return;locked.current=true;callback.current(result.data.trim(),result.type);},[]);
 useEffect(()=>{if(Platform.OS!=='web'||!ready||!permission?.granted)return;let active=true,timer:ReturnType<typeof setTimeout>|null=null;
 const decode=async()=>{if(!active||locked.current)return;try{const photo=await camera.current?.takePictureAsync({quality:0.5});if(photo?.uri&&active){const {BrowserMultiFormatReader}=await import('@zxing/browser');const reader=new BrowserMultiFormatReader();const result=await reader.decodeFromImageUrl(photo.uri);if(active)scanned({data:result.getText(),type:'',bounds:{origin:{x:0,y:0},size:{width:1,height:1}},cornerPoints:[]} as BarcodeScanningResult);}}catch{/* No decoded barcode yet; keep scanning. */}finally{if(active&&!locked.current)timer=setTimeout(()=>void decode(),900);}};
 void decode();return()=>{active=false;if(timer)clearTimeout(timer);};},[ready,permission?.granted,scanned]);
 const request=useCallback(async()=>{setError('');try{const result=await requestPermission();if(!result.granted)setError('Camera permission is required to scan. You can still enter the code manually.');}catch{setError('Camera permission could not be requested.');}},[requestPermission]);
 return {camera,permission,request,ready,onReady:()=>setReady(true),onError:()=>{setReady(false);setError('Camera could not start. Check permissions or enter the code manually.');},scanned,error};
}
