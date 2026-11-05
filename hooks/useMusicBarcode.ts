import { useState, useCallback, useRef, useEffect } from 'react';
import { Platform } from 'react-native';
import { useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { useFocusEffect } from 'expo-router';
import { useTunesCatalogue } from './useTunesCatalogue';
export function useMusicBarcode(){
 const catalogue=useTunesCatalogue();const [permission,requestPermission]=useCameraPermissions();const [enabled,setEnabled]=useState(false);const [error,setError]=useState<string|null>(null);const last=useRef('');const [focused,setFocused]=useState(false);
 useFocusEffect(useCallback(()=>{setFocused(true);return()=>{setFocused(false);setEnabled(false);};},[]));
 const toggle=useCallback(async()=>{setError(null);if(Platform.OS==='web'){setError('Enter the printed barcode below; live barcode capture is available on installed mobile builds.');return;}if(enabled){setEnabled(false);return;}const p=permission?.granted?permission:await requestPermission();if(!p.granted){setError('Camera permission is required. Enter the barcode manually or enable camera access.');return;}last.current='';setEnabled(true);},[enabled,permission,requestPermission]);
 const scanned=useCallback((result:BarcodeScanningResult)=>{if(!enabled||!focused||catalogue.state.busy||last.current===result.data)return;last.current=result.data;setEnabled(false);void catalogue.search(1,result.data);},[enabled,focused,catalogue.search,catalogue.state.busy]);
 return {enabled:enabled&&focused&&catalogue.ready,toggle,scanned,error};
}
