import { useCallback, useEffect, useRef, useState } from 'react';
import { captureWithDeviceCamera } from '@/services/deviceCaptureService';

interface DeviceCaptureInput {
  sessionId: string;
  enabled: boolean;
  onPhoto: (photo: { uri: string; width?: number; height?: number }) => Promise<void>;
}

export function useDeviceCaptureCamera(input: DeviceCaptureInput) {
  const current = useRef(input);
  current.current = input;
  const mounted = useRef(true), flight = useRef(false), revision = useRef(0);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');

  useEffect(() => { revision.current++; setError(''); }, [input.sessionId]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; revision.current++; };
  }, []);

  const take = useCallback(async () => {
    const owner = current.current;
    if (!owner.enabled || flight.current) return;
    flight.current = true;
    setBusy(true);
    setError('');
    const generation = revision.current;
    try {
      const result = await captureWithDeviceCamera();
      if (!mounted.current || revision.current !== generation || current.current.sessionId !== owner.sessionId) return;
      if (result.error) { setError(result.error); return; }
      if (result.photo) await owner.onPhoto(result.photo);
    } catch {
      if (mounted.current && revision.current === generation) setError('The device camera could not open. Your saved photos are kept; use the photo library.');
    } finally {
      flight.current = false;
      if (mounted.current) setBusy(false);
    }
  }, []);

  return { take, busy, error };
}
