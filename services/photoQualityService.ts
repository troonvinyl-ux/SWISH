import * as ImageManipulator from 'expo-image-manipulator';
import { decode as decodeJpeg } from 'jpeg-js';
import { measurePhotoPixels, PHOTO_QUALITY_VERSION, type PhotoQuality } from './imageQualityMetrics';
export type { PhotoQuality } from './imageQualityMetrics';
// Local immutable file/blob URI checks are deduplicated; remote content is checked per requested analysis.
const localCache = new Map<string, Promise<PhotoQuality>>();
async function inspect(uri: string): Promise<PhotoQuality> {
  const start = Date.now();
  try {
    const source = uri.length > 256 && /^[A-Za-z0-9+/=\r\n]+$/.test(uri) ? `data:image/jpeg;base64,${uri.replace(/\s/g,'')}` : uri;
    // Decoding/resizing happens via native Expo (or Expo web), never a remote AI service.
    const preview = await ImageManipulator.manipulateAsync(source,[{ resize:{ width:256 } }],{ compress:1,format:ImageManipulator.SaveFormat.JPEG,base64:true });
    if (!preview.base64 || preview.height > 4096) throw new Error('Unable to read a bounded photo thumbnail');
    const binary = atob(preview.base64), bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const pixels = decodeJpeg(bytes,{ useTArray:true,formatAsRGBA:true,maxResolutionInMP:2,maxMemoryUsageInMB:32 });
    return { ...measurePhotoPixels(pixels.data,pixels.width,pixels.height),durationMs:Date.now() - start };
  } catch {
    return { status:'unavailable',version:PHOTO_QUALITY_VERSION,meanLuminance:null,laplacianVariance:null,darkFraction:null,brightFraction:null,measuredWidth:0,measuredHeight:0,durationMs:Date.now() - start,warnings:['Pixel checks unavailable for this photo. Inspect focus and lighting yourself, or reselect a supported photo.'] };
  }
}
export function inspectPhotoQuality(uri: string): Promise<PhotoQuality> {
  if (!/^(file:|blob:|content:)/i.test(uri)) return inspect(uri);
  const existing = localCache.get(uri); if (existing) return existing;
  if (localCache.size >= 16) localCache.delete(localCache.keys().next().value!);
  const pending = inspect(uri); localCache.set(uri,pending); return pending;
}
export interface QualityPhoto { uri: string; slotLabel: string; photoQuality?: PhotoQuality }
export async function preflightPhotos(photos: QualityPhoto[], allowWarnings = false): Promise<{ checks: PhotoQuality[]; error: string | null }> {
  const checks: PhotoQuality[] = [];
  const warnings: string[] = [];
  // Sequential small thumbnails keep native memory bounded; yield between images to keep touch/UI responsive.
  for (const photo of photos) {
    const quality = photo.photoQuality?.version === PHOTO_QUALITY_VERSION && photo.photoQuality.status === 'measured' ? photo.photoQuality : await inspectPhotoQuality(photo.uri);
    checks.push(quality);
    if (quality.warnings.length) warnings.push(`${photo.slotLabel}: ${quality.warnings.join(' ')}`);
    await new Promise<void>(resolve => setTimeout(resolve,0));
  }
  return { checks,error: !allowWarnings && warnings.length ? `Photo review required before identification. ${warnings.join('\n')} Retake or explicitly continue with these limitations in Specialist Evidence & Buying Review.` : null };
}
