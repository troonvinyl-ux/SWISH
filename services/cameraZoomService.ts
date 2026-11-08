// Expo Camera zoom is normalized (0–1), not a guaranteed optical magnification.
export const CAMERA_ZOOM_STEP = 0.05;
export function clampCameraZoom(value: number): number { return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0; }
export function pinchCameraZoom(startZoom: number, startDistance: number, distance: number): number {
 if (!Number.isFinite(startDistance) || startDistance <= 0 || !Number.isFinite(distance) || distance <= 0) return clampCameraZoom(startZoom);
 return clampCameraZoom(startZoom + Math.log2(distance / startDistance) * 0.3);
}
