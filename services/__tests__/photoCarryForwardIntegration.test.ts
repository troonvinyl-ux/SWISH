// End-to-end service regression with mocked native Blob/storage, not a live/device test.
jest.mock('@/template', () => ({ getSupabaseClient: jest.fn() }));
jest.mock('react-native', () => ({ Platform: { OS: 'android' } }));
jest.mock('expo-image-picker', () => ({}));
jest.mock('expo-image-manipulator', () => ({}));
jest.mock('expo-file-system', () => ({ readAsStringAsync: jest.fn(), EncodingType: { Base64: 'base64' } }));
jest.mock('expo-crypto', () => ({ CryptoDigestAlgorithm: { SHA256: 'SHA256' }, digestStringAsync: jest.fn().mockResolvedValue('a'.repeat(64)) }));
jest.mock('@/services/photoQualityService', () => ({ inspectPhotoQuality: jest.fn(), preflightPhotos: jest.fn() }));
jest.mock('@/services/itemService', () => ({ getItem: jest.fn(), createItem: jest.fn() }));
jest.mock('@/services/sharedImagePreparationService', () => ({ prepareCapturedImages: jest.fn(async images => images) }));
jest.mock('@/services/smartStudioStorageService', () => ({ linkStudioImages: jest.fn().mockResolvedValue(null) }));
import { Platform } from 'react-native';
import { readAsStringAsync } from 'expo-file-system';
import { encode } from 'base64-arraybuffer';
import { getSupabaseClient } from '@/template';
import { uploadItemImages, updateItemMedia } from '../aiIdentificationService';
import { preferredListingPhotos } from '@/shared/smartStudio';
const previousReader = globalThis.FileReader;
const original = new Uint8Array([255, 216, 255, 225, 0, 4, 35, 44, 55, 66]);
const base64 = encode(original.buffer);

beforeEach(() => {
  jest.clearAllMocks();
  (readAsStringAsync as jest.Mock).mockResolvedValue(base64);
  class NativeReader {
    result: string | null = null;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    abort() {}
    readAsDataURL(blob: { fixtureBase64: string }) { this.result = `data:image/jpeg;base64,${blob.fixtureBase64}`; this.onload?.(); }
  }
  globalThis.FileReader = NativeReader as unknown as typeof FileReader;
});
afterEach(() => { globalThis.FileReader = previousReader; });

test.each(['android', 'ios'])('%s carries all five verified captures into canonical listing photos without Blob.arrayBuffer', async platform => {
  (Platform as { OS: string }).OS = platform;
  let media: string[] = [];
  const objects = new Map<string, ArrayBuffer>();
  const storage = {
    upload: jest.fn(async (path: string, bytes: ArrayBuffer) => { objects.set(path, bytes); return { error: null }; }),
    download: jest.fn(async (path: string) => {
      const stored = objects.get(path);
      return stored ? { data: { size: stored.byteLength, fixtureBase64: encode(stored) }, error: null } : { data: null, error: { message: 'Not found' } };
    }),
    getPublicUrl: jest.fn((path: string) => ({ data: { publicUrl: `https://storage.test/item-images/${path}` } })),
  };
  const queries: any[] = [];
  const from = jest.fn(() => {
    let fields = ''; let patch: { media: string[] } | null = null;
    const q: any = {
      select: jest.fn((value: string) => { fields = value; return q; }),
      eq: jest.fn(() => q),
      update: jest.fn((value: { media: string[] }) => { patch = value; return q; }),
      maybeSingle: jest.fn(async () => {
        if (patch) { media = [...patch.media]; return { data: { id: 'saved-item' }, error: null }; }
        return { data: fields === 'media' ? { media: [...media] } : { tenant_id: 'tenant', specialist_id: 'collectibles' }, error: null };
      }),
    };
    queries.push(q); return q;
  });
  (getSupabaseClient as jest.Mock).mockReturnValue({ from, storage: { from: jest.fn(() => storage) } });
  const images = ['main', 'reverse', 'marks', 'details', 'condition'].map(slotId => ({ uri: `file://retained/${slotId}.jpg`, slotId, slotLabel: slotId }));
  const upload = await uploadItemImages('saved-item', images);
  expect(upload.errors).toEqual([]); expect(upload.urls).toHaveLength(5);
  await updateItemMedia('tenant', 'saved-item', upload.urls);
  expect(media).toEqual(upload.urls);
  expect(preferredListingPhotos(media, {})).toEqual(upload.urls);
  expect(queries[1].eq).toHaveBeenCalledWith('tenant_id', 'tenant');
  expect(queries[2].select).toHaveBeenCalledWith('media');
  expect(storage.upload).toHaveBeenCalledTimes(5);
  // Retrying the same saved item verifies existing bytes, never uploads duplicates.
  expect((await uploadItemImages('saved-item', images)).errors).toEqual([]);
  expect(storage.upload).toHaveBeenCalledTimes(5);
});
