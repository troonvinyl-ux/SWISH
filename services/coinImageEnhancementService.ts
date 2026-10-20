import * as ImageManipulator from 'expo-image-manipulator';
import { getSupabaseClient } from '@/template';

export interface CoinEnhancementResponse {
  enhancedUri: string;
  warning: string;
}

/**
 * Generate a separate AI-rendered coin reference. The input URI is never
 * overwritten and this output must not be used as the primary eBay image.
 */
export async function generateCoinImageReference(uri: string): Promise<CoinEnhancementResponse> {
  if (!uri) throw new Error('Capture a coin photo first.');

  const compressed = await ImageManipulator.manipulateAsync(uri, [{ resize: { width: 1024 } }], {
    compress: 0.78,
    format: ImageManipulator.SaveFormat.JPEG,
    base64: true,
  });
  if (!compressed.base64) throw new Error('Could not prepare this photo for AI enhancement.');

  const supabase = getSupabaseClient();
  const { data, error } = await supabase.functions.invoke('swish-coin-image-enhance', {
    body: { imageDataUrl: `data:image/jpeg;base64,${compressed.base64}` },
  });

  if (error) {
    let detail = error.message ?? 'AI image enhancement is unavailable.';
    try {
      const text = await (error as any).context?.text?.();
      if (text) {
        const parsed = JSON.parse(text);
        detail = parsed.error ?? detail;
      }
    } catch {}
    throw new Error(detail);
  }
  if (!data?.enhancedImage || typeof data.enhancedImage !== 'string') {
    throw new Error(data?.error ?? 'The AI model did not return an enhanced image.');
  }

  return {
    enhancedUri: data.enhancedImage,
    warning: typeof data.warning === 'string'
      ? data.warning
      : 'AI-generated visual reference only. Use the original image for eBay listings.',
  };
}
