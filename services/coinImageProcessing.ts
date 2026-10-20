import * as FileSystem from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';
import { Skia, ImageFormat, Rect } from '@shopify/react-native-skia';

export type CoinImageTool = 'detect' | 'enhance';

export interface CoinImageProcessResult {
  uri: string;
  note: string;
}

/**
 * Free, on-device coin-photo processing using the Skia dependency already in SWISH.
 * Auto-detect uses a conservative background-colour segmentation to find a crop
 * around the coin. It intentionally refuses weak detections rather than guessing.
 * Enhance applies a restrained colour-matrix contrast/brightness adjustment.
 */
export async function processCoinImage(uri: string, mode: CoinImageTool): Promise<CoinImageProcessResult> {
  const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
  const data = Skia.Data.fromBase64(base64);
  const image = data ? Skia.Image.MakeImageFromEncoded(data) : null;
  if (!image) throw new Error('This photo could not be decoded. Please retake it or choose another image.');

  const width = image.width();
  const height = image.height();
  if (!width || !height) throw new Error('The image has no usable dimensions.');

  let crop = { x: 0, y: 0, width, height };
  let note = 'Original photo retained; enhanced copy created.';
  if (mode === 'detect') {
    // Render a small analysis copy to keep pixel analysis light on mobile.
    const scale = Math.min(1, 320 / Math.max(width, height));
    const aw = Math.max(24, Math.round(width * scale));
    const ah = Math.max(24, Math.round(height * scale));
    const analysisSurface = Skia.Surface.MakeOffscreen(aw, ah);
    if (!analysisSurface) throw new Error('Could not prepare the image for boundary analysis.');
    const analysisCanvas = analysisSurface.getCanvas();
    analysisCanvas.clear(Skia.Color('#ffffff'));
    analysisCanvas.drawImageRect(image, Rect(0, 0, width, height), Rect(0, 0, aw, ah));
    const analysisImage = analysisSurface.makeImageSnapshot();
    const pixels = analysisImage.readPixels(0, 0);
    if (!pixels || pixels.length < aw * ah * 4) {
      throw new Error('Could not analyse the image pixels. The original photo has not been changed.');
    }

    const border: number[][] = [];
    const stride = Math.max(1, Math.floor(Math.min(aw, ah) / 40));
    const sample = (x: number, y: number) => {
      const i = (y * aw + x) * 4;
      return [pixels[i], pixels[i + 1], pixels[i + 2]];
    };
    for (let x = 0; x < aw; x += stride) { border.push(sample(x, 0), sample(x, ah - 1)); }
    for (let y = 0; y < ah; y += stride) { border.push(sample(0, y), sample(aw - 1, y)); }
    const median = (channel: number) => {
      const values = border.map(p => p[channel]).sort((a, b) => a - b);
      return values[Math.floor(values.length / 2)] ?? 255;
    };
    const bg = [median(0), median(1), median(2)];
    const threshold = 42;
    let minX = aw, minY = ah, maxX = -1, maxY = -1;
    let foreground = 0;
    // Scan interior pixels; ignore a narrow outer frame where the coin is unlikely
    // to be centred on a plain background.
    for (let y = 2; y < ah - 2; y += 1) {
      for (let x = 2; x < aw - 2; x += 1) {
        const i = (y * aw + x) * 4;
        const dr = pixels[i] - bg[0], dg = pixels[i + 1] - bg[1], db = pixels[i + 2] - bg[2];
        if (Math.sqrt(dr * dr + dg * dg + db * db) > threshold) {
          foreground++;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    const boxW = maxX - minX + 1, boxH = maxY - minY + 1;
    const areaRatio = (boxW * boxH) / (aw * ah);
    const pixelRatio = foreground / (aw * ah);
    if (maxX < 0 || boxW < aw * 0.18 || boxH < ah * 0.18 || areaRatio > 0.94 || pixelRatio < 0.025) {
      throw new Error('Coin boundary is unclear against this background. Use a plain contrasting background and retake the photo; the original is unchanged.');
    }
    // Add 7% padding around the detected bounds, preserving the complete rim.
    const padX = Math.round(boxW * 0.07), padY = Math.round(boxH * 0.07);
    const x0 = Math.max(0, minX - padX), y0 = Math.max(0, minY - padY);
    const x1 = Math.min(aw, maxX + 1 + padX), y1 = Math.min(ah, maxY + 1 + padY);
    crop = {
      x: Math.round((x0 / aw) * width),
      y: Math.round((y0 / ah) * height),
      width: Math.min(width, Math.round(((x1 - x0) / aw) * width)),
      height: Math.min(height, Math.round(((y1 - y0) / ah) * height)),
    };
    note = 'Coin boundary estimated from background contrast. Check the rim before identification.';
  }

  const outWidth = crop.width, outHeight = crop.height;
  const surface = Skia.Surface.MakeOffscreen(outWidth, outHeight);
  if (!surface) throw new Error('Could not create the processed image. Your original is unchanged.');
  const canvas = surface.getCanvas();
  canvas.clear(Skia.Color('#ffffff'));
  if (mode === 'enhance') {
    // Conservative contrast and slight brightness lift. No AI-generated detail,
    // background removal, sharpening halos or changes to the source file.
    const matrix = [
      1.12, 0, 0, 0, 7,
      0, 1.12, 0, 0, 7,
      0, 0, 1.12, 0, 7,
      0, 0, 0, 1, 0,
    ];
    const paint = Skia.Paint();
    paint.setColorFilter(Skia.ColorFilter.MakeMatrix(matrix));
    canvas.drawImageRect(image, Rect(crop.x, crop.y, crop.width, crop.height), Rect(0, 0, outWidth, outHeight), paint);
  } else {
    canvas.drawImageRect(image, Rect(crop.x, crop.y, crop.width, crop.height), Rect(0, 0, outWidth, outHeight));
  }
  const encoded = surface.makeImageSnapshot().encodeToBase64(ImageFormat.JPEG, 94);
  if (!encoded) throw new Error('Could not encode the processed image. Your original is unchanged.');
  const outputUri = `${FileSystem.cacheDirectory ?? ''}coin-${mode}-${Date.now()}.jpg`;
  await FileSystem.writeAsStringAsync(outputUri, encoded, { encoding: FileSystem.EncodingType.Base64 });
  return { uri: outputUri, note };
}
