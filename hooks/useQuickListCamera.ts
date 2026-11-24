import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Platform } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import type { useQuickList } from './useQuickList';
import { useScannerForeground } from './useScannerForeground';
import { useDeviceCaptureCamera } from './useDeviceCaptureCamera';
import { scannerDeadlines, withScannerDeadline } from '@/services/scannerLifecycleService';

export function useQuickListCamera(flow: ReturnType<typeof useQuickList>, nicheId: string) {
  const foreground = useScannerForeground();
  const cameraRef = useRef<CameraView>(null), [permission, requestPermission] = useCameraPermissions();
  const [focused, setFocused] = useState(false), [ready, setReady] = useState(false), [taking, setTaking] = useState(false), [error, setError] = useState('');
  const [flashMode,setFlashMode]=useState<'off'|'on'|'auto'>('off');
  const cycleFlash=useCallback(()=>setFlashMode(value=>value==='off'?'on':value==='on'?'auto':'off'),[]);
  const flowRef = useRef(flow); flowRef.current = flow;
  const photoFlight = useRef<string | null>(null), mounted = useRef(true), cameraVersion = useRef(0);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; cameraVersion.current++; }; }, []);
  useFocusEffect(useCallback(() => { setFocused(true); return () => { cameraVersion.current++; photoFlight.current = null; setTaking(false); setFocused(false); setReady(false); }; }, []));
  useEffect(() => { cameraVersion.current++; photoFlight.current = null; setTaking(false); setReady(false); setError(''); }, [flow.state.sessionId, foreground]);
  useEffect(()=>{setFlashMode('off');},[flow.state.sessionId]);
  // A changed session identity invalidates a pending native callback immediately.
  useEffect(() => { cameraVersion.current++; photoFlight.current = null; setTaking(false); }, [flow.isCurrentSession]);

  const scanning = Boolean(focused && foreground && ready && permission?.granted && !taking && flow.scope && flow.state.sessionId && flow.barcodeSupported && !flow.state.visual && !flow.state.lead && !flow.state.leads.length && !flow.state.barcodeBusy && !flow.state.processing && !flow.state.draft && !flow.state.itemId && !flow.barcodeLookup.code);
  const scanningRef = useRef(scanning); scanningRef.current = scanning;
  const onBarcode = useCallback((result: BarcodeScanningResult) => {
    if (!scanningRef.current) return;
    scanningRef.current = false;
    void flowRef.current.barcode(result.data, result.type);
  }, []);

  useEffect(() => {
    // Studio never takes periodic preview photographs. Native barcode decoding
    // reads the stream; browsers use explicit manual barcode entry instead.
    if (Platform.OS !== 'web' || !scanning || flow.state.studio) return;
    let active = true; let timer: ReturnType<typeof setTimeout> | null = null;
    const owner = flowRef.current;
    const scan = async () => {
      try {
        const photo = await withScannerDeadline(Promise.resolve(cameraRef.current?.takePictureAsync({ quality: 0.5 })), scannerDeadlines.camera, 'Barcode preview timed out.');
        if (!active || !photo?.uri || !owner.isCurrentSession()) return;
        const { BrowserMultiFormatReader } = await import('@zxing/browser');
        const result = await withScannerDeadline(new BrowserMultiFormatReader().decodeFromImageUrl(photo.uri), scannerDeadlines.camera, 'Barcode decoding timed out.');
        const { BarcodeFormat } = await import('@zxing/library');
        const format = result.getBarcodeFormat();
        if (active && owner.isCurrentSession()) await owner.barcode(result.getText(), format === BarcodeFormat.QR_CODE ? 'qr' : format === BarcodeFormat.UPC_E ? 'upc_e' : '');
      } catch {
        // Decoding a frame can legitimately fail; the native scanner and manual path remain usable.
      } finally {
        if (active) timer = setTimeout(() => void scan(), 900);
      }
    };
    void scan();
    return () => { active = false; if (timer) clearTimeout(timer); };
  }, [scanning, flow.state.sessionId, flow.isCurrentSession]);

  const take = useCallback(async () => {
    const owner = flowRef.current;
    if (photoFlight.current || taking || !ready || !focused || !foreground || !owner.isCurrentSession() || owner.state.processing) return;
    const sessionId = owner.state.sessionId, version = cameraVersion.current;
    const cameraActive = () => mounted.current && version === cameraVersion.current && flowRef.current.state.sessionId === sessionId;
    photoFlight.current = sessionId; setTaking(true); setError(''); owner.captureStart();
    try {
      const photo = await withScannerDeadline(Promise.resolve(cameraRef.current?.takePictureAsync({ quality: 1 })), scannerDeadlines.camera, 'Camera capture timed out. Retake this view or use the photo library.');
      if (!cameraActive() || !owner.isCurrentSession()) return;
      if (!photo?.uri) throw new Error('No photo returned. Retake this view.');
      await owner.addPhoto(photo);
    } catch (cause) {
      if (cameraActive()) setError(cause instanceof Error ? cause.message : 'Camera unavailable. Use the photo library.');
    } finally {
      if (cameraActive() && photoFlight.current === sessionId) { photoFlight.current = null; setTaking(false); }
    }
  }, [taking, ready, focused, foreground]);

  const deviceCamera = useDeviceCaptureCamera({
    sessionId: flow.state.sessionId,
    enabled: Boolean(flow.scope && flow.state.sessionId && !flow.state.processing && !flow.state.itemId && !flow.state.draft && flow.nextSlot && !taking),
    onPhoto: async photo => {
      const owner = flowRef.current;
      if (!owner.isCurrentSession()) return;
      owner.captureStart();
      await owner.addPhoto(photo);
    },
  });
  const requestCameraAccess = useCallback(async () => {
    try {
      if (permission?.canAskAgain === false) { await Linking.openSettings(); return; }
      await requestPermission();
    } catch { setError('Camera permission could not be requested. Open app settings or use the photo library.'); }
  }, [permission?.canAskAgain, requestPermission]);
  const onReset = useCallback(() => { cameraVersion.current++; photoFlight.current = null; setTaking(false); setReady(false); setError(''); }, []);
  const onReady = useCallback(() => { if (mounted.current) setReady(true); }, []);
  const onError = useCallback(() => { cameraVersion.current++; photoFlight.current = null; setTaking(false); setReady(false); setError('Camera could not start. Restart the preview, check device permissions or use the photo library.'); }, []);

  return { flashMode,cycleFlash,cameraRef, permission, requestPermission: requestCameraAccess, focused: focused && foreground, ready, taking: taking || deviceCamera.busy, scanning, onBarcode, take, deviceTake: deviceCamera.take, error: deviceCamera.error || error, onReset, onReady, onError };
}
