jest.mock('@/template', () => ({
  getSupabaseClient: jest.fn(() => ({ functions: { invoke: mockInvoke } })),
}));

jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: jest.fn(),
  SaveFormat: { JPEG: 'jpeg' },
}));

import * as ImageManipulator from 'expo-image-manipulator';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { generateCoinImageReference } from '@/services/coinImageEnhancementService';

const mockInvoke = jest.fn();
const mockManipulate = ImageManipulator.manipulateAsync as jest.Mock;
const referenceImage = 'data:image/png;base64,YWJj';

describe('Coin image reference service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockManipulate.mockResolvedValue({ uri: 'file://prepared.jpg', base64: 'YWJj' });
    mockInvoke.mockResolvedValue({
      data: { enhancedImage: referenceImage, warning: 'AI-rendered reference only.', generatedBy: 'Gemini image model' },
      error: null,
    });
  });

  test.each(['file://coin.jpg', 'blob:https://preview.example/coin', 'https://example.com/coin.jpg'])(
    'prepares %s using the cross-platform Expo API', async (originalUri) => {
      const result = await generateCoinImageReference(originalUri);
      expect(mockManipulate).toHaveBeenCalledWith(
        originalUri,
        [{ resize: { width: 1024 } }],
        expect.objectContaining({ base64: true, format: 'jpeg' }),
      );
      expect(mockInvoke).toHaveBeenCalledWith('swish-coin-image-enhance', {
        body: { imageDataUrl: 'data:image/jpeg;base64,YWJj' },
      });
      expect(result.enhancedUri).toBe(referenceImage);
      expect(result.enhancedUri).not.toBe(originalUri);
      expect(result.warning).toBe('AI-rendered reference only.');
    },
  );

  test('rejects empty input without an API call', async () => {
    await expect(generateCoinImageReference('')).rejects.toThrow('Capture a coin photo');
    expect(mockManipulate).not.toHaveBeenCalled();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  test('does not silently substitute the original when image preparation fails', async () => {
    mockManipulate.mockResolvedValue({ uri: 'file://prepared.jpg' });
    await expect(generateCoinImageReference('file://coin.jpg')).rejects.toThrow('Could not prepare');
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  test('rejects oversized data before invoking the server', async () => {
    mockManipulate.mockResolvedValue({ base64: 'A'.repeat(8_000_000) });
    await expect(generateCoinImageReference('file://coin.jpg')).rejects.toThrow('too large');
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  test('surfaces the actual Edge Function error body', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: new FunctionsHttpError(new Response(JSON.stringify({ error: 'Authentication required' }), { status: 401 })),
    });
    await expect(generateCoinImageReference('file://coin.jpg')).rejects.toThrow('[Code: 401] Authentication required');
  });

  test('propagates transport failure instead of claiming success', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: { message: 'Network request failed' } });
    await expect(generateCoinImageReference('file://coin.jpg')).rejects.toThrow('Network request failed');
  });

  test('rejects missing image output', async () => {
    mockInvoke.mockResolvedValue({ data: {}, error: null });
    await expect(generateCoinImageReference('file://coin.jpg')).rejects.toThrow('no usable image reference');
  });

  test('accepts a server-returned HTTPS image and supplies a viewing-aid warning', async () => {
    mockInvoke.mockResolvedValue({ data: { enhancedImage: 'https://example.com/reference.png' }, error: null });
    const result = await generateCoinImageReference('file://coin.jpg');
    expect(result.enhancedUri).toBe('https://example.com/reference.png');
    expect(result.warning).toContain('Always use the original photo');
  });
});
