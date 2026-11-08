// Upload-copy contract. DPI is metadata; pixels and encoded bytes determine upload size.
export const CAPTURE_COPY_MAX_EDGE = 2048;
export const CAPTURE_COPY_DPI = 72;
export const CAPTURE_COPY_TARGET_BYTES = 4 * 1024 * 1024;
export interface CaptureUploadCopy {
  uri: string; width: number; height: number; dpi: 72;
  kind: 'compressed_capture_copy'; sourceHash: string;
}
export function captureCopySize(width: number, height: number, maxEdge = CAPTURE_COPY_MAX_EDGE) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1 || !Number.isFinite(maxEdge) || maxEdge < 1) throw new Error('Photograph dimensions are invalid.');
  const ratio = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) };
}
/** Change/add only a JFIF density header; compressed image pixels remain untouched. */
export function jpegAt72Dpi(bytes: Uint8Array): Uint8Array {
  if (bytes[0] !== 255 || bytes[1] !== 216) throw new Error('A JPEG export is required.');
  const result = new Uint8Array(bytes);
  let offset = 2;
  while (offset + 4 <= result.length && result[offset] === 255) {
    const marker = result[offset + 1];
    if (marker === 218 || marker === 217) break;
    const length = (result[offset + 2] << 8) | result[offset + 3];
    if (length < 2 || offset + 2 + length > result.length) break;
    if (marker === 224 && length >= 16 && String.fromCharCode(...result.slice(offset + 4, offset + 9)) === 'JFIF\0') {
      result[offset + 11] = 1; // dots per inch
      result[offset + 12] = 0; result[offset + 13] = CAPTURE_COPY_DPI;
      result[offset + 14] = 0; result[offset + 15] = CAPTURE_COPY_DPI;
      return result;
    }
    offset += length + 2;
  }
  const header = new Uint8Array([255,224,0,16,74,70,73,70,0,1,1,1,0,72,0,72,0,0]);
  const output = new Uint8Array(bytes.length + header.length);
  output.set(bytes.subarray(0, 2)); output.set(header, 2); output.set(bytes.subarray(2), 2 + header.length);
  return output;
}
