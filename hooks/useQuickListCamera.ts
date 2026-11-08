import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import type { useQuickList } from './useQuickList';
export function useQuickListCamera(flow:ReturnType<typeof useQuickList>,nicheId:string){
 const cameraRef=useRef<CameraView>(null),[permission,requestPermission]=useCameraPermissions();const [focused,setFocused]=useState(false),[ready,setReady]=useState(false),[taking,setTaking]=useState(false),[error,setError]=useState('');const flowRef=useRef(flow);flowRef.current=flow;
 useFocusEffect(useCallback(()=>{setFocused(true);return()=>{setFocused(false);setReady(false);};},[]));
 const scanning=Boolean(focused&&ready&&permission?.granted&&!taking&&flow.scope&&flow.state.sessionId&&flow.barcodeSupported&&!flow.state.visual&&!flow.state.lead&&!flow.state.leads.length&&!flow.state.barcodeBusy&&!flow.state.processing&&!flow.state.draft&&!flow.state.itemId&&!flow.barcodeLookup.code);
 const scanningRef=useRef(scanning);scanningRef.current=scanning;
 const onBarcode=useCallback((result:BarcodeScanningResult)=>{if(!scanningRef.current)return;void flowRef.current.barcode(result.data,result.type);},[]);
 useEffect(()=>{let active=true,busy=false;let timer:ReturnType<typeof setTimeout>|null=null;
 // Expo Camera supplies native decoding. Web uses JS-only ZXing on preview snapshots; no native module or alternate camera stream.
 if(Platform.OS!=='web'||!focused||!ready||!permission?.granted||!scanning)return;
 const scan=async()=>{if(!active||busy)return;busy=true;try{const photo=await cameraRef.current?.takePictureAsync({quality:0.5});if(photo?.uri&&active){const {BrowserMultiFormatReader}=await import('@zxing/browser');const reader=new BrowserMultiFormatReader();const result=await reader.decodeFromImageUrl(photo.uri);const {BarcodeFormat}=await import('@zxing/library');const format=result.getBarcodeFormat();if(active)void flowRef.current.barcode(result.getText(),format===BarcodeFormat.QR_CODE?'qr':format===BarcodeFormat.UPC_E?'upc_e':'');}}catch{/* No decoded barcode is normal; manual entry/photo fallback stays available. */}finally{busy=false;if(active)timer=setTimeout(()=>{void scan();},900);}};
 void scan();return()=>{active=false;if(timer)clearTimeout(timer);};
 },[focused,ready,permission?.granted,scanning,flow.state.sessionId]);
 const photoFlight=useRef(false);
 const take=useCallback(async()=>{if(photoFlight.current||taking||!ready||!focused||flowRef.current.state.processing)return;const sessionId=flowRef.current.state.sessionId;photoFlight.current=true;setTaking(true);setError('');flowRef.current.captureStart();try{const photo=await cameraRef.current?.takePictureAsync({quality:1});if(flowRef.current.state.sessionId!==sessionId)return;if(!photo?.uri)throw new Error('No photo returned. Retake this view.');await flowRef.current.addPhoto(photo);}catch(cause){if(flowRef.current.state.sessionId===sessionId)setError(cause instanceof Error?cause.message:'Camera unavailable. Use the photo library.');}finally{photoFlight.current=false;setTaking(false);}},[taking,ready,focused]);
 return {cameraRef,permission,requestPermission,focused,ready,taking,scanning,onBarcode,take,error,onReset:()=>setReady(false),onReady:()=>setReady(true),onError:()=>{setReady(false);setError('Camera could not start. Check browser/device permissions or use the photo library.');}};
}
