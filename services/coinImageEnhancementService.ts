// Client for the existing swish-coin-image-enhance Edge Function.
// Expo ImageManipulator supports web and native URIs without fetching file://
// paths or importing native-only pixel processing libraries. Originals are never
// overwritten, uploaded as references, or substituted on failure.
import * as ImageManipulator from 'expo-image-manipulator';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { getSupabaseClient } from '@/template';

export interface CoinImageReference {
  enhancedUri: string;
  warning: string;
  generatedBy?: string;
}

const REFERENCE_WARNING = 'AI-rendered reference only. Always use the original photo for eBay listings and final attribution.';
const MAX_IMAGE_DATA_LENGTH = 8_000_000;

export async function generateCoinImageReference(uri: string): Promise<CoinImageReference> {
  if (typeof uri !== 'string' || !uri.trim()) {
    throw new Error('Capture a coin photo before creating an AI reference.');
  }

  // Generate a resized JPEG copy on either platform. Request base64 directly
  // from Expo rather than relying on FileReader or native filesystem APIs.
  const prepared = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: 1024 } }],
    { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG, base64: true },
  );
  if (!prepared.base64) {
    throw new Error('Could not prepare the coin image. The original photo is unchanged.');
  }
  const imageDataUrl = prepared.base64.startsWith('data:')
    ? prepared.base64
    : `data:image/jpeg;base64,${prepared.base64}`;
  if (imageDataUrl.length > MAX_IMAGE_DATA_LENGTH) {
    throw new Error('Image is too large. Retake or resize it and try again.');
  }

  const { data, error } = await getSupabaseClient().functions.invoke('swish-coin-image-enhance', {
    body: { imageDataUrl },
  });
  if (error) {
    let message = error.message || 'AI image reference is unavailable.';
    if (error instanceof FunctionsHttpError) {
      const status = error.context?.status ?? 500;
      try {
        const text = await error.context.text();
        if (text) {
          try {
            const payload = JSON.parse(text);
            message = typeof payload.error === 'string' ? payload.error : text;
          } catch {
            message = text;
          }
        }
      } catch {
        // Preserve the original SDK error when the response cannot be read.
      }
      message = `[Code: ${status}] ${message}`;
    }
    throw new Error(message);
  }
  if (typeof data?.error === 'string') throw new Error(data.error);

  const enhancedUri = data?.enhancedImage;
  if (typeof enhancedUri !== 'string' ||
      !/^(data:image\/(?:png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$|https:\/\/\S+$)/i.test(enhancedUri)) {
    throw new Error('AI returned no usable image reference. The original photo is unchanged.');
  }
  return {
    enhancedUri,
    warning: typeof data.warning === 'string' && data.warning.trim() ? data.warning : REFERENCE_WARNING,
    ...(typeof data.generatedBy === 'string' ? { generatedBy: data.generatedBy } : {}),
  };
}
