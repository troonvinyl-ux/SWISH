import { useCallback, useRef, useState, useEffect } from 'react';
import { Linking, Platform } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useCameraPermissions, type CameraView, type CameraType } from 'expo-camera';
import type { useGenericCapture } from './useGenericCapture';
import { useScannerForeground } from './useScannerForeground';
import { useDeviceCaptureCamera } from './useDeviceCaptureCamera';
import { scannerDeadlines, withScannerDeadline } from '@/services/scannerLifecycleService';

export function usePremiumCamera(capture: ReturnType<typeof useGenericCapture>) {
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const foreground = useScannerForeground();
  const [focused, setFocused] = useState(false);
  const [ready, setReady] = useState(false);
  const [taking, setTaking] = useState(false);
  const [facing, setFacing] = useState<CameraType>('back');
  const [grid, setGrid] = useState(true);
  const [flash, setFlash] = useState(false);
  const [error, setError] = useState('');
  const [slotId, setSlotId] = useState('');
  const flight = useRef<string | null>(null);
  const mounted = useRef(true), cameraVersion = useRef(0);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; cameraVersion.current++; }; }, []);
  useFocusEffect(useCallback(() => { setFocused(true); return () => { cameraVersion.current++; flight.current = null; setTaking(false); setFocused(false); setReady(false); }; }, []));
  useEffect(() => {
    // A new scan or a return from the background gets a fresh viewfinder.
    cameraVersion.current++; flight.current = null; setTaking(false); setReady(false); setError(''); setSlotId('');
    setFacing('back'); setFlash(false); setGrid(true);
  }, [capture.sessionId, foreground]);
  useEffect(() => { if (!capture.slots.some(slot => slot.id === slotId)) setSlotId(capture.slots[0]?.id ?? ''); }, [capture.slots, slotId]);

  const slot = capture.slots.find(entry => entry.id === slotId) ?? capture.slots[0];
  const take = useCallback(async () => {
    if (!capture.isCurrentSession() || !slot || capture.busy || capture.savedId || flight.current) return;
    const sessionId = capture.sessionId, version = cameraVersion.current;
    const isCurrent = () => mounted.current && version === cameraVersion.current && capture.isCurrentSession();
    if (Platform.OS === 'web') { await capture.capture(slot.id, true); return; }
    try {
      if (!permission?.granted) { await requestPermission(); return; }
      if (!ready || !focused || !foreground) return;
      flight.current = sessionId; setTaking(true); setError('');
      const photo = await withScannerDeadline(Promise.resolve(cameraRef.current?.takePictureAsync({ quality: 1 })), scannerDeadlines.camera, 'Camera capture timed out. Retake this view or use the photo library.');
      if (!isCurrent()) return;
      if (!photo?.uri) throw new Error('No photograph returned. Retake this angle.');
      await capture.addCapturedPhoto(slot.id, { uri: photo.uri, width: photo.width, height: photo.height });
    } catch (cause) {
      if (isCurrent()) setError(cause instanceof Error ? cause.message : 'Camera unavailable. Use the gallery.');
    } finally {
      if (flight.current === sessionId) { flight.current = null; if (isCurrent()) setTaking(false); }
    }
  }, [slot, capture.sessionId, capture.isCurrentSession, capture.busy, capture.savedId, capture.capture, capture.addCapturedPhoto, permission?.granted, requestPermission, ready, focused, foreground]);

  const deviceCamera = useDeviceCaptureCamera({
    sessionId: capture.sessionId,
    enabled: Boolean(slot && !capture.busy && !capture.savedId && !taking),
    onPhoto: async photo => { if (capture.isCurrentSession() && slot) await capture.addCapturedPhoto(slot.id, photo); },
  });
  const requestCameraAccess = useCallback(async () => {
    try {
      if (permission?.canAskAgain === false) { await Linking.openSettings(); return; }
      await requestPermission();
    } catch { setError('Camera permission could not be requested. Open app settings or use the photo library.'); }
  }, [permission?.canAskAgain, requestPermission]);
  const onReset = useCallback(() => { cameraVersion.current++; flight.current = null; setTaking(false); setReady(false); setError(''); }, []);
  const onReady = useCallback(() => { if (mounted.current) setReady(true); }, []);
  const onError = useCallback(() => { cameraVersion.current++; flight.current = null; setTaking(false); setReady(false); setError('Camera could not start. Restart the preview, check camera permission or use the photo library.'); }, []);

  return {
    cameraRef, permission, requestPermission: requestCameraAccess, focused: focused && foreground, ready, taking: taking || deviceCamera.busy, facing, grid, flash, error: deviceCamera.error || error, slot, setSlotId, take, deviceTake: deviceCamera.take, onReset, onReady, onError,
    toggleGrid: () => setGrid(value => !value), toggleFlash: () => setFlash(value => !value), flip: () => { onReset(); setFlash(false); setFacing(value => value === 'back' ? 'front' : 'back'); },
  };
}
