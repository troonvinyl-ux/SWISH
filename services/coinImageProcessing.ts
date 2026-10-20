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
      // Never crop automatically without a reliable boundary detector: a tight
      // coin photo could lose its rim. Preserve the full frame for the vision
      // model to assess the coin boundary during identification.
      return {
        uri: source.uri,
        note: 'Photo prepared; full frame preserved so the AI can assess the coin boundary without clipping the rim.',
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
