// Mocked service-flow regression only: no live AI, marketplace or database writes.
jest.mock('@/template', () => ({ getSupabaseClient: jest.fn() }));
jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
jest.mock('expo-image-picker', () => ({}));
jest.mock('expo-image-manipulator', () => ({}));
jest.mock('expo-file-system', () => ({ readAsStringAsync: jest.fn(), EncodingType: { Base64: 'base64' } }));
jest.mock('expo-crypto', () => ({ CryptoDigestAlgorithm: { SHA256: 'SHA256' }, digestStringAsync: jest.fn() }));
jest.mock('@/services/photoQualityService', () => ({ inspectPhotoQuality: jest.fn(), preflightPhotos: jest.fn() }));
jest.mock('@/services/itemService', () => ({ getItem: jest.fn(), createItem: jest.fn() }));
jest.mock('@/services/sharedImagePreparationService', () => ({ prepareCapturedImages: jest.fn(async images => images) }));
jest.mock('@/services/smartStudioStorageService', () => ({ linkStudioImages: jest.fn().mockResolvedValue(null) }));
import { getSupabaseClient } from '@/template';
import { preflightPhotos } from '../photoQualityService';
import { createItem } from '../itemService';
import { identifyItemWithAI } from '../aiIdentificationService';
import type { PhotoQuality } from '../imageQualityMetrics';
const originalUrls = Array.from({ length: 4 }, (_, index) => `https://storage.test/saved-item/originals/photo-${index + 1}.jpg`);
const good: PhotoQuality = { status: 'measured', version: 'roi-laplacian-v1', meanLuminance: 120, laplacianVariance: 200, darkFraction: 0, brightFraction: 0, measuredWidth: 256, measuredHeight: 256, warnings: [] };
const dark: PhotoQuality = { ...good, meanLuminance: 30, warnings: ['Low light or dark subject.'] };
let invoke: jest.Mock;
beforeEach(() => {
  jest.clearAllMocks();
  invoke = jest.fn().mockResolvedValue({ data: { identification: { canonicalTitle: 'Reviewed teddy bear', specialistId: 'collectibles', confidence: 0.68, attributes: {} } }, error: null });
  (getSupabaseClient as jest.Mock).mockReturnValue({ functions: { invoke } });
  (preflightPhotos as jest.Mock).mockImplementation(async (photos: unknown[], allowed: boolean) => ({ checks: photos.map((_, index) => index === 3 ? dark : good), error: allowed ? null : 'Photo review required before identification.' }));
});
test('existing-photo quality warning exposes an actionable review before invoking AI', async () => {
  const response = await identifyItemWithAI([], 'collectibles', undefined, undefined, { tenantId: 'tenant', existingImageUrls: originalUrls });
  expect(response.result).toBeNull();
  expect(response.photoReview).toEqual([{ uri: originalUrls[3], slotLabel: 'Stored photo 4', photoQuality: dark }]);
  expect(invoke).not.toHaveBeenCalled();
  expect(createItem).not.toHaveBeenCalled();
});
test('explicit warning override analyses the same four originals once and returns a proposal without saving', async () => {
  await identifyItemWithAI([], 'collectibles', undefined, undefined, { tenantId: 'tenant', existingImageUrls: originalUrls });
  const response = await identifyItemWithAI([], 'collectibles', undefined, { existingTitle: 'Old teddy bear title' }, { tenantId: 'tenant', existingImageUrls: originalUrls, allowPhotoWarnings: true });
  expect(response.error).toBeNull();
  expect(response.result?.canonicalTitle).toBe('Reviewed teddy bear');
  expect(response.photoReview).toBeUndefined();
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(invoke).toHaveBeenCalledWith('swish-identify', expect.objectContaining({ body: expect.objectContaining({ existingImageUrls: originalUrls, specialistId: 'collectibles', tenantId: 'tenant' }) }));
  expect(preflightPhotos).toHaveBeenLastCalledWith(expect.arrayContaining([expect.objectContaining({ uri: originalUrls[3], slotLabel: 'Stored photo 4' })]), true);
  expect(createItem).not.toHaveBeenCalled();
  expect(originalUrls).toHaveLength(4);
});
test('transport/provider failures cannot be mistaken for overridable photo warnings', async () => {
  invoke.mockResolvedValue({ data: null, error: new Error('Network request failed') });
  const response = await identifyItemWithAI([], 'collectibles', undefined, undefined, { tenantId: 'tenant', existingImageUrls: originalUrls, allowPhotoWarnings: true });
  expect(response.error).toBe('Network request failed');
  expect(response.photoReview).toBeUndefined();
  expect(response.result).toBeNull();
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(createItem).not.toHaveBeenCalled();
});
test('acknowledging lighting does not bypass the eight-photo payload limit', async () => {
  const response = await identifyItemWithAI([], 'collectibles', undefined, undefined, { tenantId: 'tenant', existingImageUrls: Array(9).fill(originalUrls[0]), allowPhotoWarnings: true });
  expect(response.error).toContain('at most eight');
  expect(response.photoReview).toBeUndefined();
  expect(preflightPhotos).not.toHaveBeenCalled();
  expect(invoke).not.toHaveBeenCalled();
  expect(createItem).not.toHaveBeenCalled();
});
