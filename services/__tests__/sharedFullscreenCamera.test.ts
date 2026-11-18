// Pure/source regressions. These do not replace installed iOS/Android camera testing.
import fs from 'node:fs';
import { clampCameraZoom, pinchCameraZoom } from '../cameraZoomService';
import { canMountCaptureCamera, captureCameraDelays, type CaptureCameraAvailability } from '../captureCameraService';
import { scannerShouldSuspend, withScannerDeadline } from '../scannerLifecycleService';

const source = (file: string) => fs.readFileSync(file, 'utf8');
const cameraState: CaptureCameraAvailability = { focused: true, granted: true, suspended: false, expanded: false, modalShown: false, modalClosing: false };

test('camera zoom remains finite and within Expo normalized bounds', () => {
  expect(clampCameraZoom(-2)).toBe(0);
  expect(clampCameraZoom(3)).toBe(1);
  expect(clampCameraZoom(NaN)).toBe(0);
  expect(pinchCameraZoom(0, 100, 200)).toBeGreaterThan(0);
  expect(pinchCameraZoom(0.5, 200, 100)).toBeLessThan(0.5);
  expect(pinchCameraZoom(0.3, 0, 100)).toBe(0.3);
});

test('a capture camera mounts only after its fullscreen native modal has been presented', () => {
  expect(canMountCaptureCamera(cameraState)).toBe(false);
  expect(canMountCaptureCamera({ ...cameraState, expanded: true })).toBe(false);
  expect(canMountCaptureCamera({ ...cameraState, expanded: true, modalShown: true })).toBe(true);
  for (const patch of [{ focused: false }, { granted: false }, { suspended: true }, { modalClosing: true }]) {
    expect(canMountCaptureCamera({ ...cameraState, expanded: true, modalShown: true, ...patch })).toBe(false);
  }
  expect(captureCameraDelays.release).toBe(250);
  expect(captureCameraDelays.startup).toBe(8000);
});

test('both capture flows reuse one staged fullscreen camera implementation', () => {
  for (const file of ['components/feature/QuickListWorkspace.tsx', 'components/feature/PremiumScanner.tsx']) {
    expect(source(file)).toContain('<SharedCaptureCamera');
    expect(source(file)).not.toContain('<CameraView');
  }
  const ui = source('components/feature/SharedCaptureCamera.tsx');
  expect(ui).toContain('presentationStyle="fullScreen"');
  expect(ui).toContain('<SafeAreaProvider');
  expect(ui).toContain('onShow={view.onModalShow}');
  expect(ui).toContain('onDismiss={view.onModalDismiss}');
  expect(ui).toContain('view.cameraMounted ? <CameraView');
  expect(ui).toContain('Restart camera preview');
  expect(ui).toContain('Use device camera');
  // Count JSX camera elements, not the RefObject<CameraView | null> type annotation.
  expect((ui.match(/<CameraView\s+[A-Za-z][\w-]*=/g) ?? []).length).toBe(1);
});

test('capture callbacks are cancelled on backgrounding, session changes, and slow native calls', () => {
  expect(scannerShouldSuspend('inactive')).toBe(false);
  expect(scannerShouldSuspend('active')).toBe(false);
  expect(scannerShouldSuspend('background')).toBe(true);
  for (const hook of ['hooks/useQuickListCamera.ts', 'hooks/usePremiumCamera.ts']) {
    const value = source(hook);
    expect(value).toContain('useScannerForeground');
    expect(value).toContain('withScannerDeadline');
    expect(value).toContain('cameraVersion.current++');
    expect(value).toContain('setTaking(false)');
  }
  expect(source('hooks/useQuickList.ts')).toContain('const isCurrentSession=useCallback');
});

test('a timeout releases a caller without delaying a successful capture', async () => {
  jest.useFakeTimers();
  const timeout = withScannerDeadline(new Promise<never>(() => {}), 15, 'Retake this view');
  const assertion = expect(timeout).rejects.toThrow('Retake this view');
  jest.advanceTimersByTime(15);
  await assertion;
  await expect(withScannerDeadline(Promise.resolve('photo'), 15, 'timeout')).resolves.toBe('photo');
  expect(jest.getTimerCount()).toBe(0);
  jest.useRealTimers();
});

test('native device-camera fallback preserves existing photo workflows', () => {
  expect(source('services/deviceCaptureService.ts')).toContain('ImagePicker.launchCameraAsync');
  expect(source('hooks/useDeviceCaptureCamera.ts')).toContain('captureWithDeviceCamera');
  expect(source('components/feature/QuickListWorkspace.tsx')).toContain('onDeviceCamera={() => { if (barcodeMode) flow.useVisual(); void camera.deviceTake(); }}');
  expect(source('components/feature/PremiumScanner.tsx')).toContain('onDeviceCamera={() => { void camera.deviceTake(); }}');
  const scanner = source('components/feature/SharedBarcodeScanner.tsx');
  expect(scanner).toContain('scanner.foreground');
  expect(scanner).toContain('Restart barcode camera');
  expect(scanner).toContain('Enter barcode manually');
});
