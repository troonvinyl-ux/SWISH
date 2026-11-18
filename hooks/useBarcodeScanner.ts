import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { useScannerForeground } from './useScannerForeground';
import { scannerDeadlines, withScannerDeadline } from '@/services/scannerLifecycleService';

export function useBarcodeScanner(onValue: (value: string, type: string) => void) {
  const foreground = useScannerForeground();
  const camera = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [ready, setReady] = useState(false), [error, setError] = useState(''), [revision, setRevision] = useState(0);
  const locked = useRef(false), callback = useRef(onValue); callback.current = onValue;
  const restart = useCallback(() => { locked.current = false; setReady(false); setError(''); setRevision(value => value + 1); }, []);

  useEffect(() => { restart(); }, [foreground, restart]);
  const scanned = useCallback((result: BarcodeScanningResult) => {
    if (!foreground || locked.current || !result.data.trim()) return;
    locked.current = true;
    try { callback.current(result.data.trim(), result.type); }
    catch { locked.current = false; setError('Barcode could not be accepted. Retry or enter the code manually.'); }
  }, [foreground]);

  useEffect(() => {
    if (Platform.OS !== 'web' || !foreground || !ready || !permission?.granted) return;
    let active = true; let timer: ReturnType<typeof setTimeout> | null = null;
    const decode = async () => {
      if (!active || locked.current) return;
      try {
        const photo = await withScannerDeadline(Promise.resolve(camera.current?.takePictureAsync({ quality: 0.5 })), scannerDeadlines.camera, 'Barcode camera timed out.');
        if (photo?.uri && active) {
          const { BrowserMultiFormatReader } = await import('@zxing/browser');
          const reader = new BrowserMultiFormatReader();
          const result = await withScannerDeadline(reader.decodeFromImageUrl(photo.uri), scannerDeadlines.camera, 'Barcode decoding timed out.');
          if (active) scanned({ data: result.getText(), type: '', bounds: { origin: { x: 0, y: 0 }, size: { width: 1, height: 1 } }, cornerPoints: [] } as BarcodeScanningResult);
        }
      } catch {
        // No decoded barcode yet; manual entry and restart remain available.
      } finally {
        if (active && !locked.current) timer = setTimeout(() => void decode(), 900);
      }
    };
    void decode();
    return () => { active = false; if (timer) clearTimeout(timer); };
  }, [foreground, ready, permission?.granted, scanned, revision]);

  const acceptManual = useCallback((value: string) => {
    const code = value.trim();
    if (!code || code.length > 128) { setError('Enter a barcode of 1–128 characters.'); return; }
    if (locked.current) locked.current = false;
    scanned({ data: code, type: '' } as BarcodeScanningResult);
  }, [scanned]);
  const request = useCallback(async () => {
    setError('');
    try { const result = await requestPermission(); if (!result.granted) setError('Camera permission is required to scan. You can still enter the code manually.'); }
    catch { setError('Camera permission could not be requested.'); }
  }, [requestPermission]);

  return { restart, revision, foreground, acceptManual, camera, permission, request, ready, onReady: () => setReady(true), onError: () => { setReady(false); setError('Camera could not start. Restart the camera or enter the code manually.'); }, scanned, error };
}
