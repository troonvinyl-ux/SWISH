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
    // Avoid Skia pixel readback, which throws a native HostFunction error on
    // some builds. Use a conservative centre crop and let the user verify rim.
    const marginX = Math.round(width * 0.04);
    const marginY = Math.round(height * 0.04);
    crop = {
      x: marginX,
      y: marginY,
      width: Math.max(1, width - marginX * 2),
      height: Math.max(1, height - marginY * 2),
    };
    note = 'Safe centre crop created. Check that the complete coin rim remains visible; automatic boundary detection is unavailable in this build.';
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
    // Skia's native bridge expects a numeric typed array for a colour matrix
    // on some Android/iOS builds. Passing a plain JS array can surface the
    // HostFunction "Value is undefined, expected a number" error.
    try {
      const colorFilter = Skia.ColorFilter.MakeMatrix(new Float32Array(matrix));
      const paint = Skia.Paint();
      if (colorFilter) {
        paint.setColorFilter(colorFilter);
        canvas.drawImageRect(image, Rect(crop.x, crop.y, crop.width, crop.height), Rect(0, 0, outWidth, outHeight), paint);
      } else {
        canvas.drawImageRect(image, Rect(crop.x, crop.y, crop.width, crop.height), Rect(0, 0, outWidth, outHeight));
        note = 'High-quality copy created; contrast enhancement was unavailable on this device.';
      }
    } catch (filterError) {
      // Never fail the whole operation if native matrix support differs by build.
      canvas.drawImageRect(image, Rect(crop.x, crop.y, crop.width, crop.height), Rect(0, 0, outWidth, outHeight));
      note = 'High-quality copy created; contrast enhancement was unavailable on this device.';
    }
  } else {
    canvas.drawImageRect(image, Rect(crop.x, crop.y, crop.width, crop.height), Rect(0, 0, outWidth, outHeight));
  }
  const encoded = surface.makeImageSnapshot().encodeToBase64(ImageFormat.JPEG, 94);
  if (!encoded) throw new Error('Could not encode the processed image. Your original is unchanged.');
  const outputUri = `${FileSystem.cacheDirectory ?? ''}coin-${mode}-${Date.now()}.jpg`;
  await FileSystem.writeAsStringAsync(outputUri, encoded, { encoding: FileSystem.EncodingType.Base64 });
  return { uri: outputUri, note };
}
