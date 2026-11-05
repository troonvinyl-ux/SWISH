// Mocked Expo + Supabase; no real photographs, paid AI calls or inventory writes.
jest.mock('@/template', () => ({ getSupabaseClient: jest.fn(() => ({ functions: { invoke: mockInvoke } })) }));
jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
jest.mock('expo-image-picker', () => ({}));
jest.mock('expo-file-system', () => ({ readAsStringAsync: jest.fn(), EncodingType: { Base64: 'base64' } }));
jest.mock('expo-image-manipulator', () => ({ manipulateAsync: jest.fn(), SaveFormat: { JPEG: 'jpeg' } }));
jest.mock('@/services/photoQualityService', () => ({ preflightPhotos: jest.fn().mockResolvedValue({ checks: [], error: null }), inspectPhotoQuality: jest.fn() }));
jest.mock('@/services/itemService', () => ({ getItem: jest.fn(), createItem: jest.fn() }));
import { manipulateAsync } from 'expo-image-manipulator';
import { readAsStringAsync } from 'expo-file-system';
import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js';
import { identifyItemWithAI, prepareImageForAI } from '../aiIdentificationService';
const mockInvoke = jest.fn();
const manipulate = manipulateAsync as jest.Mock;
const images = [{ uri: 'file://front.heic', width: 3024, height: 4032, slotId: 'front', slotLabel: 'Front cover' }, { uri: 'file://back.heic', width: 3024, height: 4032, slotId: 'back', slotLabel: 'Rear cover' }];
const response = { identification: { canonicalTitle: 'Visible compilation — CD', specialistId: 'vinyl_records', confidence: 0.65, objectType: 'CD', attributes: { format: 'CD' } } };
beforeEach(() => {
  jest.clearAllMocks();
  manipulate.mockResolvedValue({ base64: 'YQ==', uri: 'file://analysis.jpg', width: 768, height: 1024 });
  mockInvoke.mockResolvedValue({ data: response, error: null });
});

test('serial JPEG preparation retains original photos and label order', async () => {
  let active = 0; let maximum = 0;
  manipulate.mockImplementation(async () => { active++; maximum = Math.max(maximum, active); await Promise.resolve(); active--; return { base64: 'YQ==', uri: 'file://analysis.jpg', width: 768, height: 1024 }; });
  const result = await identifyItemWithAI(images, 'vinyl_records', undefined, undefined, { tenantId: 'tenant' });
  expect(result.error).toBeNull(); expect(result.result?.canonicalTitle).toBe(response.identification.canonicalTitle);
  expect(maximum).toBe(1);
  expect(manipulate).toHaveBeenCalledWith('file://front.heic', [{ resize: { width: 768, height: 1024 } }], expect.objectContaining({ base64: true, format: 'jpeg' }));
  const body = mockInvoke.mock.calls[0][1].body;
  expect(body.images).toEqual(['data:image/jpeg;base64,YQ==', 'data:image/jpeg;base64,YQ==']);
  expect(body.imageLabels).toEqual(['Front cover', 'Rear cover']); expect(body.requestId).toMatch(/^identify-/); expect(mockInvoke.mock.calls[0][1].signal).toBeDefined();
  expect(images[0].uri).toBe('file://front.heic');
});
test('image preparation failure never sends a raw fallback or starts a request', async () => {
  manipulate.mockRejectedValue(new Error('HEIC decoding unavailable'));
  const result = await identifyItemWithAI(images, 'vinyl_records');
  expect(result.error).toContain('prepared safely'); expect(mockInvoke).not.toHaveBeenCalled(); expect(readAsStringAsync).not.toHaveBeenCalled();
});
test('oversized analysis copy is retried locally at smaller quality, not on the AI server', async () => {
  manipulate.mockResolvedValueOnce({ base64: 'A'.repeat(810_000), uri: 'file://large.jpg', width: 1024, height: 1024 })
    .mockResolvedValueOnce({ base64: 'YQ==', uri: 'file://small.jpg', width: 768, height: 768 });
  expect(await prepareImageForAI('file://large.heic')).toBe('data:image/jpeg;base64,YQ==');
  expect(manipulate.mock.calls[1][2].compress).toBe(0.5); expect(mockInvoke).not.toHaveBeenCalled();
});
test('stored HTTPS photos do not become large base64 uploads', async () => {
  const result = await identifyItemWithAI([], 'vinyl_records', undefined, undefined, { tenantId: 'tenant', existingImageUrls: ['https://storage.example/front.jpg'] });
  expect(result.error).toBeNull(); expect(manipulate).not.toHaveBeenCalled();
  expect(mockInvoke.mock.calls[0][1].body.existingImageUrls).toEqual(['https://storage.example/front.jpg']);
});
test('HTTP provider errors include actual response and a correlation reference', async () => {
  mockInvoke.mockResolvedValue({ data: null, error: new FunctionsHttpError(new Response(JSON.stringify({ error: 'OnSpace AI: photo analysis timed out.', requestId: 'fixture_reference' }), { status: 504 })) });
  const result = await identifyItemWithAI(images, 'vinyl_records');
  expect(result.result).toBeNull(); expect(result.error).toContain('[Code: 504]'); expect(result.error).toContain('OnSpace AI'); expect(result.error).toContain('fixture_reference');
});
test('no-response error preserves barcode results and does not imply a coin/Numista rejection', async () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    mockInvoke.mockResolvedValue({ data: null, error: new FunctionsFetchError(new Error('Network request failed')) });
    const result = await identifyItemWithAI(images, 'vinyl_records');
    expect(result.result).toBeNull(); expect(result.error).toContain('no server response'); expect(result.error).toContain('barcode results are retained');
    expect(mockInvoke).toHaveBeenCalledTimes(1); expect(result.error).not.toContain('Numista');
  } finally { warn.mockRestore(); }
});
