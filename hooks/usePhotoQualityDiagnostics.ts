import { useState, useCallback, useEffect, useRef } from 'react';
import { runPhotoQualityDeviceTests, type DevicePhotoTest } from '@/services/photoQualityDeviceTests';
import { captureFromCamera, pickFromLibrary, type CapturedImage } from '@/services/aiIdentificationService';

export function usePhotoQualityDiagnostics() {
  const [tests, setTests] = useState<DevicePhotoTest[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [photo, setPhoto] = useState<CapturedImage | null>(null);
  const alive = useRef(true);
  const lock = useRef(false);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const run = useCallback(async () => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await runPhotoQualityDeviceTests();
      if (alive.current) setTests(result);
    } catch (e: unknown) {
      if (alive.current) setError(e instanceof Error ? e.message : 'Device diagnostics failed.');
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }, []);

  const inspect = useCallback(async (library: boolean) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      const image = library ? await pickFromLibrary('diagnostic', 'Diagnostic photo') : await captureFromCamera();
      if (alive.current && image) setPhoto(image);
    } catch (e: unknown) {
      if (alive.current) setError(e instanceof Error ? e.message : 'Photo unavailable.');
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }, []);

  return { tests, busy, error, photo, run, inspect };
}
