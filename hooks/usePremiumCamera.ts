import { useCallback, useRef, useState, useEffect } from 'react';
import { Platform } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useCameraPermissions, type CameraView, type CameraType } from 'expo-camera';
import type { useGenericCapture } from './useGenericCapture';
export function usePremiumCamera(capture: ReturnType<typeof useGenericCapture>) {
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [focused, setFocused] = useState(false);
  const [ready, setReady] = useState(false);
  const [taking, setTaking] = useState(false);
  const [facing, setFacing] = useState<CameraType>('back');
  const [grid, setGrid] = useState(true);
  const [flash, setFlash] = useState(false);
  const [error, setError] = useState('');
  const [slotId, setSlotId] = useState('');
  const flight = useRef(false); const mounted = useRef(true);
  useEffect(()=>{mounted.current=true;return ()=>{mounted.current=false;};},[]);
  useFocusEffect(useCallback(()=>{setFocused(true);return ()=>{setFocused(false);setReady(false);};},[]));
  useEffect(()=>{if (!capture.slots.some(slot=>slot.id===slotId)) setSlotId(capture.slots[0]?.id ?? '');},[capture.slots,slotId]);
  const slot = capture.slots.find(entry=>entry.id===slotId) ?? capture.slots[0];
  const take = useCallback(async()=>{
    if (!slot || capture.busy || capture.savedId || flight.current) return;
    if (Platform.OS==='web') { await capture.capture(slot.id,true); return; }
    try {
      if (!permission?.granted) { await requestPermission(); return; }
      if (!ready || !focused) return;
      flight.current=true;setTaking(true);setError('');
      const photo=await cameraRef.current?.takePictureAsync({quality:0.9});
      if (!photo?.uri) throw new Error('No photograph returned. Retake this angle.');
      await capture.addCapturedPhoto(slot.id,{uri:photo.uri,width:photo.width,height:photo.height});
    } catch(cause) {if(mounted.current)setError(cause instanceof Error?cause.message:'Camera unavailable. Use the gallery.');}
    finally {flight.current=false;if(mounted.current)setTaking(false);}
  },[slot,capture.busy,capture.savedId,capture.capture,capture.addCapturedPhoto,permission?.granted,requestPermission,ready,focused]);
  return {cameraRef,permission,requestPermission,focused,ready,taking,facing,grid,flash,error,slot,setSlotId,take,
    onReady:()=>setReady(true),onError:()=>{setReady(false);setError('Camera could not start. Check camera permission or upload photographs.');},
    toggleGrid:()=>setGrid(value=>!value),toggleFlash:()=>setFlash(value=>!value),flip:()=>{setReady(false);setFlash(false);setFacing(value=>value==='back'?'front':'back');}};
}
