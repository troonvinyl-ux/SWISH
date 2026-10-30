// Pixel measurements only: an inexpensive advisory heuristic, not object recognition or a sharpness guarantee.
export const PHOTO_QUALITY_VERSION = 'roi-laplacian-v1';
export interface PhotoQuality {
  status: 'measured' | 'unavailable'; version: string; meanLuminance: number | null;
  laplacianVariance: number | null; darkFraction: number | null; brightFraction: number | null;
  measuredWidth: number; measuredHeight: number; warnings: string[]; durationMs?: number;
}
export function measurePhotoPixels(rgba: Uint8Array, width: number, height: number): PhotoQuality {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 8 || height < 8 || rgba.length !== width * height * 4) throw new Error('Invalid pixel dimensions.');
  // Centre 70% avoids dominant borders/backgrounds. It still cannot segment the item automatically.
  const left = Math.floor(width * 0.15), right = Math.ceil(width * 0.85);
  const top = Math.floor(height * 0.15), bottom = Math.ceil(height * 0.85);
  const grey = new Float32Array(width * height);
  for (let i = 0; i < grey.length; i++) grey[i] = 0.2126 * rgba[i * 4] + 0.7152 * rgba[i * 4 + 1] + 0.0722 * rgba[i * 4 + 2];
  let count = 0, sum = 0, dark = 0, bright = 0, edgeSum = 0, edgeSquares = 0;
  for (let y = Math.max(1,top); y < Math.min(height - 1,bottom); y++) for (let x = Math.max(1,left); x < Math.min(width - 1,right); x++) {
    const i = y * width + x, value = grey[i];
    const lap = grey[i - 1] + grey[i + 1] + grey[i - width] + grey[i + width] - 4 * value;
    count++; sum += value; if (value < 20) dark++; if (value > 245) bright++;
    edgeSum += lap; edgeSquares += lap * lap;
  }
  const mean = sum / count;
  const variance = Math.max(0,edgeSquares / count - (edgeSum / count) ** 2);
  const warnings: string[] = [];
  if (mean < 45 || dark / count > 0.55) warnings.push('Low light or dark subject: add diffuse light, keep the item centred and photograph its identifying text again.');
  if (mean > 225 || bright / count > 0.55) warnings.push('Bright or clipped detail: reduce exposure and move direct lights away to preserve labels and surface detail.');
  if (variance < 70) warnings.push('Low measured edge detail: possible blur or a plain surface. Hold the camera steady, tap to focus and move closer to the label or identifying mark.');
  return { status:'measured',version:PHOTO_QUALITY_VERSION,meanLuminance:mean,laplacianVariance:variance,darkFraction:dark / count,brightFraction:bright / count,measuredWidth:width,measuredHeight:height,warnings };
}
