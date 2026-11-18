import { useCallback, useEffect, useRef, useState } from 'react';
import { canMountCaptureCamera, captureCameraDelays } from '@/services/captureCameraService';

interface CaptureViewfinderInput {
  sessionId: string;
  focused: boolean;
  granted: boolean;
  suspended?: boolean;
  autoOpen?: boolean;
  facing?: string;
  barcodeResolved?: boolean;
  onReset: () => void;
  onReady: () => void;
  onError: () => void;
}

/** Stage native modal visibility and camera release; never open two camera sessions together. */
export function useCaptureViewfinder(input: CaptureViewfinderInput) {
  const callbacks = useRef(input);
  callbacks.current = input;
  const [expanded, setExpanded] = useState(input.autoOpen !== false);
  const [modalShown, setModalShown] = useState(false), [modalClosing, setModalClosing] = useState(false);
  const [cameraMounted, setCameraMounted] = useState(false), [bootKey, setBootKey] = useState(0);
  const [starting, setStarting] = useState(false), [startupError, setStartupError] = useState('');
  const [retry, setRetry] = useState(0);
  const version = useRef(0), ready = useRef(false), mounted = useRef(true);
  const startupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const modalVisible = expanded && input.focused && !input.suspended;
  const visibleRef = useRef(modalVisible);
  visibleRef.current = modalVisible;
  const closingRef = useRef(modalClosing);
  closingRef.current = modalClosing;

  const clearStartup = useCallback(() => {
    if (startupTimer.current) clearTimeout(startupTimer.current);
    startupTimer.current = null;
  }, []);

  const close = useCallback(() => {
    version.current++;
    clearStartup();
    setCameraMounted(false);
    setStarting(false);
    callbacks.current.onReset();
    setModalShown(false);
    setModalClosing(true);
    setExpanded(false);
  }, [clearStartup]);

  const open = useCallback(() => {
    if (closingRef.current || !callbacks.current.focused || callbacks.current.suspended) return;
    version.current++;
    clearStartup();
    setCameraMounted(false);
    setStartupError('');
    callbacks.current.onReset();
    setModalClosing(false);
    setModalShown(false);
    setExpanded(true);
  }, [clearStartup]);

  useEffect(() => {
    setCameraMounted(false);
    setModalShown(false);
    setModalClosing(false);
    setExpanded(input.autoOpen !== false);
    setStartupError('');
    setRetry(0);
  }, [input.sessionId]);

  useEffect(() => {
    if (!input.focused || input.suspended || input.barcodeResolved) close();
  }, [input.focused, input.suspended, input.barcodeResolved, close]);

  useEffect(() => {
    if (!modalClosing) return;
    const timer = setTimeout(() => setModalClosing(false), captureCameraDelays.modalClose);
    return () => clearTimeout(timer);
  }, [modalClosing]);

  useEffect(() => {
    if (!modalVisible || modalShown) return;
    const timer = setTimeout(() => {
      if (!mounted.current || !visibleRef.current) return;
      setStarting(false);
      setStartupError('The camera window did not finish opening. Close it or restart the preview; your photos are kept.');
      callbacks.current.onError();
    }, captureCameraDelays.startup);
    return () => clearTimeout(timer);
  }, [modalVisible, modalShown]);

  const allowed = canMountCaptureCamera({
    focused: input.focused,
    granted: input.granted,
    suspended: Boolean(input.suspended),
    expanded,
    modalShown,
    modalClosing,
  });

  useEffect(() => {
    const generation = ++version.current;
    clearStartup();
    ready.current = false;
    setCameraMounted(false);
    setStarting(allowed);
    setStartupError('');
    callbacks.current.onReset();
    if (!allowed) return;

    // Wait for onShow on full-screen iOS modals, then give the old session time to release.
    const releaseTimer = setTimeout(() => {
      if (!mounted.current || version.current !== generation) return;
      setBootKey(generation);
      setCameraMounted(true);
      startupTimer.current = setTimeout(() => {
        if (!mounted.current || version.current !== generation || ready.current) return;
        version.current++;
        clearStartup();
        setCameraMounted(false);
        setStarting(false);
        setStartupError('Camera preview did not start. Restart the camera or choose a photo from your library.');
        callbacks.current.onError();
      }, captureCameraDelays.startup);
    }, captureCameraDelays.release);

    return () => {
      clearTimeout(releaseTimer);
      clearStartup();
      version.current++;
    };
  }, [allowed, expanded, input.sessionId, input.facing, retry, clearStartup]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      version.current++;
      clearStartup();
    };
  }, [clearStartup]);

  const onCameraReady = useCallback(() => {
    if (!mounted.current || bootKey !== version.current) return;
    ready.current = true;
    clearStartup();
    setStarting(false);
    setStartupError('');
    callbacks.current.onReady();
  }, [bootKey, clearStartup]);

  const onMountError = useCallback(() => {
    if (!mounted.current || bootKey !== version.current) return;
    version.current++;
    clearStartup();
    setCameraMounted(false);
    setStarting(false);
    setStartupError('Camera could not open. Check camera access, restart, or use the photo library.');
    callbacks.current.onError();
  }, [bootKey, clearStartup]);

  const restart = useCallback(() => {
    if (expanded && !modalShown) { close(); return; }
    version.current++;
    clearStartup();
    setCameraMounted(false);
    callbacks.current.onReset();
    setRetry(value => value + 1);
  }, [expanded, modalShown, close, clearStartup]);

  return {
    expanded,
    modalVisible,
    transitioning: modalClosing,
    cameraMounted: cameraMounted && allowed,
    bootKey,
    starting,
    startupError,
    open,
    close,
    restart,
    onCameraReady,
    onMountError,
    onModalShow: () => { if (visibleRef.current) setModalShown(true); },
    onModalDismiss: () => { if (!visibleRef.current) { setModalShown(false); setModalClosing(false); } },
  };
}
