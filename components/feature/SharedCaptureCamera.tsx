import { memo, useCallback, useEffect, useRef, type RefObject } from 'react';
import { ActivityIndicator, Linking, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { CameraView, type BarcodeScanningResult, type CameraType } from 'expo-camera';
import { MaterialIcons } from '@expo/vector-icons';
import { useCameraZoom } from '@/hooks/useCameraZoom';
import { useCaptureViewfinder } from '@/hooks/useCaptureViewfinder';
import { captureCameraDelays } from '@/services/captureCameraService';
import { Colors, Radius, Spacing, Typography } from '@/constants/theme';

interface SharedCaptureCameraProps {
  autoOpen?: boolean; suspended?: boolean;
  sessionId: string; cameraRef: RefObject<CameraView | null>; focused: boolean; granted: boolean;
  ready: boolean; taking: boolean; disabled: boolean; accent: string; label: string; detail?: string;
  facing?: CameraType; flash?: boolean; grid?: boolean; barcodeMode?: boolean; barcodeResolved?: boolean;
  error?: string; onReady: () => void; onError: () => void; onReset: () => void;
  onPermission: () => void; onTake: () => void; onGallery: () => void; onDeviceCamera?: () => void;
  onBarcodeScanned?: (result: BarcodeScanningResult) => void;
}

/** A staged fullscreen native camera: an inline camera never competes for the same stream. */
export const SharedCaptureCamera = memo(function SharedCaptureCamera(props: SharedCaptureCameraProps) {
  const zoom = useCameraZoom(props.sessionId), view = useCaptureViewfinder(props);
  const galleryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const current = useRef(props); current.current = props;

  useEffect(() => () => { if (galleryTimer.current) clearTimeout(galleryTimer.current); galleryTimer.current = null; }, [props.sessionId]);

  const chooseGallery = useCallback(() => {
    if (galleryTimer.current || current.current.disabled || current.current.taking) return;
    const session = current.current.sessionId; view.close();
    // The picker must not compete with a dismissing native camera modal.
    galleryTimer.current = setTimeout(() => {
      galleryTimer.current = null;
      if (current.current.sessionId === session && current.current.focused && !current.current.disabled) current.current.onGallery();
    }, captureCameraDelays.modalClose);
  }, [view.close]);

  const chooseDeviceCamera = useCallback(() => {
    if (galleryTimer.current || current.current.disabled || current.current.taking || !current.current.onDeviceCamera) return;
    const session = current.current.sessionId; view.close();
    galleryTimer.current = setTimeout(() => {
      galleryTimer.current = null;
      if (current.current.sessionId === session && !current.current.disabled) current.current.onDeviceCamera?.();
    }, captureCameraDelays.modalClose);
  }, [view.close]);

  const button = (name: 'remove' | 'add' | 'fullscreen' | 'fullscreen-exit' | 'restart-alt', label: string, onPress: () => void, disabled = false) => <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [s.icon, pressed || disabled ? s.pressed : null]}><MaterialIcons name={name} size={24} color={props.accent} /></Pressable>;
  const viewfinder = () => <View style={s.preview}>
    {view.cameraMounted ? <CameraView key={`${props.sessionId}:${view.bootKey}`} ref={props.cameraRef} style={StyleSheet.absoluteFillObject} facing={props.facing ?? 'back'} flash={props.flash ? 'on' : 'off'} zoom={zoom.supported ? zoom.zoom : 0} onCameraReady={view.onCameraReady} onMountError={view.onMountError} barcodeScannerSettings={props.barcodeMode ? { barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39', 'itf14'] } : undefined} onBarcodeScanned={props.barcodeMode && props.ready && !view.starting ? props.onBarcodeScanned : undefined} /> : null}
    {!props.granted ? <View style={s.permission}><MaterialIcons name="photo-camera" size={48} color={props.accent} /><Text style={s.body}>Allow camera access or choose a photo from your library.</Text><Pressable accessibilityRole="button" accessibilityLabel="Enable camera access" onPress={props.onPermission} style={({ pressed }) => [s.secondary, pressed ? s.pressed : null]}><Text style={s.body}>Enable camera</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel="Open camera permission settings" onPress={() => { void Linking.openSettings().catch(() => current.current.onError()); }} style={({ pressed }) => [s.secondary, pressed ? s.pressed : null]}><Text style={s.body}>Open app settings</Text></Pressable></View> : null}
    {props.granted && !view.startupError && (!view.cameraMounted || view.starting) ? <View pointerEvents="none" style={s.permission}><ActivityIndicator color={props.accent} /><Text accessibilityLiveRegion="polite" style={s.body}>{props.suspended ? 'Camera paused while your photo is saved' : 'Starting camera…'}</Text></View> : null}
    {view.cameraMounted && !view.starting ? <View {...zoom.panHandlers} style={StyleSheet.absoluteFillObject}><View pointerEvents="none" style={[s.frame, { borderColor: props.accent }, props.barcodeMode ? s.barcodeFrame : null]} />{props.grid && !props.barcodeMode ? <View pointerEvents="none" style={StyleSheet.absoluteFillObject}><View style={s.vertical} /><View style={s.horizontal} /></View> : null}</View> : null}
  </View>;

  const cameraError = view.startupError || props.error;
  const recovery = () => <View style={s.recovery}>{cameraError ? <Text accessibilityRole="alert" style={s.error}>{cameraError}</Text> : null}<View style={s.recoveryRow}>{button('restart-alt', 'Restart camera preview', () => { if (view.expanded) view.restart(); else view.open(); }, props.taking || Boolean(props.suspended))}<Text style={s.hint}>Restart preview · your photos and review are kept</Text></View></View>;
  const controls = () => <View style={s.controls}>
    {zoom.supported ? <View style={s.zoomRow}>{button('remove', 'Zoom out', zoom.zoomOut, zoom.zoom <= 0)}<Pressable accessibilityRole="button" accessibilityLabel="Reset camera zoom" onPress={zoom.reset} style={({ pressed }) => [s.zoomValue, pressed ? s.pressed : null]}><Text style={s.body}>{zoom.zoom === 0 ? 'Wide' : `Zoom ${Math.round(zoom.zoom * 100)}%`}</Text></Pressable>{button('add', 'Zoom in', zoom.zoomIn, zoom.zoom >= 1)}</View> : <Text style={s.hint}>Camera zoom is device-only; browser capture and photo library remain available.</Text>}
    {view.expanded ? <><Text style={s.hint}>{props.barcodeMode ? 'Scan barcode · Review or manually enter a code below' : zoom.supported ? 'Pinch to zoom · capture each evidence view' : 'Capture each evidence view'}</Text><View style={s.captureRow}><Pressable disabled={props.disabled || props.taking} accessibilityRole="button" accessibilityLabel="Choose photo from library" onPress={chooseGallery} style={({ pressed }) => [s.icon, pressed || props.disabled ? s.pressed : null]}><MaterialIcons name="photo-library" size={26} color={props.accent} /></Pressable><Pressable disabled={!props.ready || !view.cameraMounted || view.starting || props.disabled || props.taking} accessibilityRole="button" accessibilityLabel="Take photograph" onPress={props.onTake} style={({ pressed }) => [s.shutter, { borderColor: props.accent }, pressed || !props.ready || props.disabled ? s.pressed : null]}>{props.taking ? <ActivityIndicator color={props.accent} /> : <View style={[s.shutterInner, { backgroundColor: props.accent }]} />}</Pressable><Pressable accessibilityRole="button" accessibilityLabel="Review captured photos and continue" onPress={view.close} style={({ pressed }) => [s.review, pressed ? s.pressed : null]}><Text style={[s.body, { color: props.accent }]}>Review</Text></Pressable></View></> : <View style={s.expandRow}>{button('fullscreen', 'Open full-screen camera', view.open, view.transitioning || props.taking || Boolean(props.suspended))}<Text style={s.hint}>Full-screen camera{zoom.supported ? ' · pinch or + / − to zoom' : ''}</Text></View>}
  </View>;

  return <View style={s.container}>
    {!view.expanded ? <View style={s.inlinePreview}><Pressable accessibilityRole="button" accessibilityLabel="Open camera to photograph this item" disabled={view.transitioning || props.taking || Boolean(props.suspended)} onPress={view.open} style={({ pressed }) => [s.permission, pressed ? s.pressed : null]}><MaterialIcons name="photo-camera" size={48} color={props.accent} /><Text style={s.body}>Open camera</Text><Text style={s.hint}>Preview starts in a dedicated full-screen view.</Text></Pressable></View> : <Pressable accessibilityRole="button" accessibilityLabel="Open full-screen camera" disabled={view.transitioning || props.taking || Boolean(props.suspended)} onPress={view.open} style={({ pressed }) => [s.secondary, pressed ? s.pressed : null]}><MaterialIcons name="fullscreen" size={24} color={props.accent} /><Text style={s.body}>Open full-screen camera</Text></Pressable>}
    {!view.expanded ? <>{cameraError ? recovery() : null}{controls()}</> : null}
    {props.onDeviceCamera ? <Pressable accessibilityRole="button" accessibilityLabel="Use device camera instead of the embedded preview" disabled={props.disabled || props.taking} onPress={chooseDeviceCamera} style={({ pressed }) => [s.secondary, pressed || props.disabled ? s.pressed : null]}><MaterialIcons name="photo-camera" size={24} color={props.accent} /><Text style={s.body}>Use device camera</Text></Pressable> : null}
    <Modal visible={view.modalVisible} onShow={view.onModalShow} onDismiss={view.onModalDismiss} animationType="fade" presentationStyle="fullScreen" onRequestClose={view.close} statusBarTranslucent={Platform.OS === 'android'}>
      <SafeAreaProvider style={s.fullscreen}><SafeAreaView edges={['top', 'bottom']} style={s.fullscreen}><StatusBar style="light" /><View style={s.heading}><View style={s.copy}><Text style={s.title}>{props.label}</Text>{props.detail ? <Text style={s.hint}>{props.detail}</Text> : null}</View>{button('fullscreen-exit', 'Close full-screen camera', view.close)}</View>{view.modalVisible ? viewfinder() : null}{recovery()}{controls()}{props.onDeviceCamera ? <Pressable accessibilityRole="button" disabled={props.disabled || props.taking} onPress={chooseDeviceCamera} style={({ pressed }) => [s.secondary, pressed ? s.pressed : null]}><Text style={s.body}>Use device camera</Text></Pressable> : null}</SafeAreaView></SafeAreaProvider>
    </Modal>
  </View>;
});

const s = StyleSheet.create({
  container: { gap: Spacing.sm }, fullscreen: { flex: 1, backgroundColor: Colors.background }, inlinePreview: { height: 256, borderRadius: Radius.lg, overflow: 'hidden' }, preview: { flex: 1, minHeight: 1, backgroundColor: Colors.background }, heading: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'center', padding: Spacing.base, backgroundColor: Colors.surface }, copy: { flex: 1 }, title: { fontSize: Typography.size.lg, fontWeight: Typography.weight.bold, color: Colors.textPrimary, includeFontPadding: false }, body: { fontSize: Typography.size.base, color: Colors.textPrimary, lineHeight: Typography.size.base * Typography.lineHeight.relaxed, includeFontPadding: false }, hint: { fontSize: Typography.size.sm, color: Colors.textSecondary, lineHeight: Typography.size.sm * Typography.lineHeight.relaxed, textAlign: 'center', flexShrink: 1 }, icon: { minWidth: 48, minHeight: 48, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceHighlight }, secondary: { minHeight: 48, padding: Spacing.base, borderRadius: Radius.md, backgroundColor: Colors.surface, flexDirection: 'row', gap: Spacing.sm, alignItems: 'center' }, permission: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.base, gap: Spacing.base }, controls: { padding: Spacing.base, gap: Spacing.sm, backgroundColor: Colors.surface }, zoomRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: Spacing.base }, zoomValue: { minWidth: 112, minHeight: 48, alignItems: 'center', justifyContent: 'center' }, captureRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.sm }, shutter: { width: 72, height: 72, borderRadius: Radius.circle, borderWidth: 4, alignItems: 'center', justifyContent: 'center' }, shutterInner: { width: 52, height: 52, borderRadius: Radius.circle }, review: { minWidth: 64, minHeight: 48, alignItems: 'center', justifyContent: 'center' }, expandRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }, frame: { position: 'absolute', left: '10%', right: '10%', top: '15%', bottom: '15%', borderWidth: 2, borderRadius: Radius.lg }, barcodeFrame: { top: '38%', bottom: '38%' }, vertical: { position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, backgroundColor: Colors.overlay50 }, horizontal: { position: 'absolute', top: '50%', left: 0, right: 0, height: 1, backgroundColor: Colors.overlay50 }, error: { color: Colors.warning, fontSize: Typography.size.base, lineHeight: Typography.size.base * Typography.lineHeight.relaxed }, recovery: { paddingHorizontal: Spacing.base, paddingVertical: Spacing.sm, gap: Spacing.sm, backgroundColor: Colors.surface }, recoveryRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }, pressed: { opacity: 0.65 },
});
