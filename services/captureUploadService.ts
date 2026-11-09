// Authorised upload copies for oversized captures. Never overwrite/relabel the local source.
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system';
import { Platform } from 'react-native';
import { decode, encode } from 'base64-arraybuffer';
import type { CapturedImage } from './aiIdentificationService';
import { readOriginalBytes, uploadUntouchedOriginal, ORIGINAL_UPLOAD_LIMIT_BYTES } from './originalImageService';
import { CAPTURE_COPY_DPI, CAPTURE_COPY_MAX_EDGE, CAPTURE_COPY_TARGET_BYTES, captureCopySize, jpegAt72Dpi, type CaptureUploadCopy } from '@/shared/captureUpload';

export async function prepareCaptureUploadCopy(image: CapturedImage, sourceHash: string): Promise<CaptureUploadCopy> {
  if (image.uploadCopy?.sourceHash === sourceHash && image.uploadCopy.kind === 'compressed_capture_copy') return image.uploadCopy;
  let width = image.width, height = image.height;
  // Decode dimensions without upscaling when a legacy capture did not record them.
  if (!width || !height) {
    const inspected = await ImageManipulator.manipulateAsync(image.uri, [], { format: ImageManipulator.SaveFormat.JPEG, compress: 0.85 });
    width = inspected.width; height = inspected.height;
  }
  for (const [edge, quality] of [[CAPTURE_COPY_MAX_EDGE, 0.85], [1600, 0.78], [1280, 0.7]] as const) {
    const size = captureCopySize(width, height, edge);
    const encoded = await ImageManipulator.manipulateAsync(image.uri, [{ resize: size }], { format: ImageManipulator.SaveFormat.JPEG, compress: quality, base64: true });
    if (!encoded.base64) throw new Error('A smaller upload copy could not be created. Your original is retained.');
    const bytes = jpegAt72Dpi(new Uint8Array(decode(encoded.base64.replace(/^data:image\/[^;]+;base64,/i, ''))));
    if (bytes.length > CAPTURE_COPY_TARGET_BYTES) continue;
    const base64 = encode(bytes.buffer as ArrayBuffer);
    let uri = `data:image/jpeg;base64,${base64}`;
    if (Platform.OS !== 'web' && FileSystem.documentDirectory) {
      const folder = FileSystem.documentDirectory + 'swish-capture/';
      await FileSystem.makeDirectoryAsync(folder, { intermediates: true });
      uri = `${folder}${sourceHash}-${edge}-upload72.jpg`;
      await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 });
    }
    const copy: CaptureUploadCopy = { uri, width: encoded.width, height: encoded.height, dpi: CAPTURE_COPY_DPI, kind: 'compressed_capture_copy', sourceHash };
    image.uploadCopy = copy; // Retained for safe same-item retries; image.uri is never changed.
    return copy;
  }
  throw new Error('The upload copy still exceeds the size limit. Your original and processed photos are retained.');
}
/** Small captures remain byte-for-byte originals; large ones use explicitly labelled 72-DPI copies. */
export async function uploadCapturedPhoto(itemId: string, image: CapturedImage) {
  if (/^https:\/\//.test(image.uri)) return uploadUntouchedOriginal(itemId, image.slotId, image.uri);
  const original = await readOriginalBytes(image.uri);
  if (original.bytes.byteLength <= ORIGINAL_UPLOAD_LIMIT_BYTES) return uploadUntouchedOriginal(itemId, image.slotId, image.uri);
  const copy = await prepareCaptureUploadCopy(image, original.hash);
  return uploadUntouchedOriginal(itemId, image.slotId, copy.uri);
}
