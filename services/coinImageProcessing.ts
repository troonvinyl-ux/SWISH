import * as ImageManipulator from 'expo-image-manipulator';

export type CoinImageTool = 'detect' | 'enhance';

export interface CoinImageProcessResult {
  uri: string;
  note: string;
}

/**
 * Native-safe coin image operations. This deliberately avoids Skia pixel
 * readback, native colour filters and offscreen surfaces, which have caused
 * HostFunction "Value is undefined, expected a number" errors in device builds.
 * The captured source URI is never overwritten.
 */
export async function processCoinImage(uri: string, mode: CoinImageTool): Promise<CoinImageProcessResult> {
  if (!uri || typeof uri !== 'string') {
    throw new Error('No usable photo was supplied. Please retake the coin photo.');
  }

  try {
    const source = await ImageManipulator.manipulateAsync(uri, [], {
      compress: 0.96,
      format: ImageManipulator.SaveFormat.JPEG,
    });

    if (!source.width || !source.height) {
      throw new Error('The photo has no usable dimensions.');
    }

    if (mode === 'detect') {
      // Safe fallback: a modest centre crop instead of unreliable pixel analysis.
      const marginX = Math.round(source.width * 0.04);
      const marginY = Math.round(source.height * 0.04);
      const cropped = await ImageManipulator.manipulateAsync(source.uri, [{
        crop: {
          originX: marginX,
          originY: marginY,
          width: Math.max(1, source.width - marginX * 2),
          height: Math.max(1, source.height - marginY * 2),
        },
      }], {
        compress: 0.96,
        format: ImageManipulator.SaveFormat.JPEG,
      });
      return {
        uri: cropped.uri,
        note: 'Safe centre crop created. Check the full coin rim; automatic boundary detection is unavailable in this build.',
      };
    }

    // Keep enhancement non-destructive and native-safe. No invented coin detail.
    const copy = await ImageManipulator.manipulateAsync(source.uri, [], {
      compress: 1,
      format: ImageManipulator.SaveFormat.JPEG,
    });
    return {
      uri: copy.uri,
      note: 'High-quality copy created. The original photo is preserved; advanced contrast enhancement is temporarily disabled to prevent native processing errors.',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown image-processing error.';
    throw new Error(`Photo processing failed safely: ${message} The original photo has not been changed.`);
  }
}
