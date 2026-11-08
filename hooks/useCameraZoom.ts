import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, Platform, type GestureResponderEvent } from 'react-native';
import { CAMERA_ZOOM_STEP, clampCameraZoom, pinchCameraZoom } from '@/services/cameraZoomService';
export function useCameraZoom(sessionId: string) {
 const [zoom, setZoom] = useState(0); const current = useRef(0); current.current = zoom;
 const start = useRef({ distance: 0, zoom: 0 }); const supported = Platform.OS !== 'web';
 useEffect(() => { setZoom(0); start.current.distance = 0; }, [sessionId]);
 const change = useCallback((amount: number) => { if (supported) setZoom(value => clampCameraZoom(value + amount)); }, [supported]);
 const reset = useCallback(() => setZoom(0), []);
 const distance = (event: GestureResponderEvent) => { const touches = event.nativeEvent.touches; return touches.length < 2 ? 0 : Math.hypot(touches[0].pageX - touches[1].pageX, touches[0].pageY - touches[1].pageY); };
 const responder = useMemo(() => PanResponder.create({
  onStartShouldSetPanResponder: event => supported && event.nativeEvent.touches.length === 2,
  onMoveShouldSetPanResponder: event => supported && event.nativeEvent.touches.length === 2,
  onPanResponderGrant: event => { start.current = { distance: distance(event), zoom: current.current }; },
  onPanResponderMove: event => { const value = distance(event); if (value > 0) { if (!start.current.distance) start.current = { distance: value, zoom: current.current }; setZoom(pinchCameraZoom(start.current.zoom, start.current.distance, value)); } },
  onPanResponderRelease: () => { start.current.distance = 0; },
  onPanResponderTerminate: () => { start.current.distance = 0; },
 }), [supported]);
 return { zoom, supported, reset, zoomIn: () => change(CAMERA_ZOOM_STEP), zoomOut: () => change(-CAMERA_ZOOM_STEP), panHandlers: responder.panHandlers };
}
