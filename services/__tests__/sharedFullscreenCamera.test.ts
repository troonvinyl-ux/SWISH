// Pure/source regressions. These do not replace installed iOS/Android camera testing.
import fs from 'node:fs';
import { clampCameraZoom, pinchCameraZoom } from '../cameraZoomService';
const source=(file:string)=>fs.readFileSync(file,'utf8');
test('camera zoom remains finite and within Expo normalized bounds',()=>{expect(clampCameraZoom(-2)).toBe(0);expect(clampCameraZoom(3)).toBe(1);expect(clampCameraZoom(NaN)).toBe(0);expect(pinchCameraZoom(0,100,200)).toBeGreaterThan(0);expect(pinchCameraZoom(0.5,200,100)).toBeLessThan(0.5);expect(pinchCameraZoom(0.3,0,100)).toBe(0.3);});
test('both capture flows reuse one fullscreen camera implementation',()=>{for(const file of ['components/feature/QuickListWorkspace.tsx','components/feature/PremiumScanner.tsx']){expect(source(file)).toContain('<SharedCaptureCamera');expect(source(file)).not.toContain('<CameraView');}const ui=source('components/feature/SharedCaptureCamera.tsx');expect(ui).toContain('presentationStyle="fullScreen"');expect(ui).toContain("edges={['top','bottom']}");expect(ui).toContain('zoom={zoom.supported ? zoom.zoom : 0}');expect(ui).toContain('!expanded ? <View style={s.inlinePreview}');expect(ui).toContain('visible={expanded && props.focused}');expect(ui).toContain('Review captured photos and continue');expect(ui).toContain('Zoom out');expect(ui).toContain('Zoom in');expect(ui).not.toContain('2x');});
test('pinch controls and reset are isolated per capture session',()=>{const hook=source('hooks/useCameraZoom.ts');expect(hook).toContain('PanResponder.create');expect(hook).toContain('pinchCameraZoom');expect(hook).toContain('[sessionId]');expect(hook).toContain("Platform.OS !== 'web'");});

test('Android camera errors remain visible and allow a safe remount; photo mode does not activate barcode decoding',()=>{const ui=source('components/feature/SharedCaptureCamera.tsx');expect(ui).toContain('onMountError={event => props.onError(event.message)}');expect(ui).toContain('setMountAttempt(attempt => attempt + 1)');expect(ui).toContain('accessibilityLabel="Retry camera"');expect(ui).toContain('props.barcodeMode && props.onBarcodeScanned ?');expect(ui).toContain('onBarcodeScanned={props.barcodeMode ? props.onBarcodeScanned : undefined}');for(const hook of ['hooks/useQuickListCamera.ts','hooks/usePremiumCamera.ts']){const value=source(hook);expect(value).toContain('onError:(message?:string)=>');expect(value).toContain("setError('');");}});

test('Android full-screen camera starts after modal presentation and never duplicates an inline CameraView',()=>{
 const ui=source('components/feature/SharedCaptureCamera.tsx');
 expect(ui).toContain('onShow={() => setModalPresented(true)}');
 expect(ui).toContain("(Platform.OS !== 'android' || modalPresented)");
 expect(ui).toContain('setModalPresented(false)');
 expect(ui.split('<CameraView').length - 1).toBe(1);
 expect(ui).toContain('!expanded ? <View style={s.inlinePreview}');
 expect(ui).not.toContain('<View style={s.inlinePreview}>{viewfinder()}</View>');
 expect(ui).toContain('Starting camera preview…');
});
test('black preview retains a device camera escape path using the existing capture flows',()=>{
 const ui=source('components/feature/SharedCaptureCamera.tsx');
 const quick=source('hooks/useQuickListCamera.ts');
 const quickUI=source('components/feature/QuickListWorkspace.tsx');
 const premiumUI=source('components/feature/PremiumScanner.tsx');
 expect(ui).toContain('Preview black? Use phone camera');
 expect(ui).toContain('InteractionManager.runAfterInteractions');
 expect(ui).toContain('disabled={props.disabled || props.taking}');
 expect(quick).toContain('ImagePicker.launchCameraAsync');
 expect(quick).toContain('flowRef.current.addPhoto({uri:photo.uri,width:photo.width,height:photo.height})');
 expect(quick).toContain('!flowRef.current.state.sessionId');
 expect(quickUI).toContain('onSystemCamera={() => { if (barcodeMode) flow.useVisual(); void camera.systemCamera(); }}');
 expect(premiumUI).toContain('onSystemCamera={() => { if(camera.slot)void capture.capture(camera.slot.id,false); }}');
});
