// MOCKED CLIENT + SOURCE CONTRACT TESTS. No live inventory, AI or eBay writes.
jest.mock('@/template', () => ({ getSupabaseClient: jest.fn() }));
jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
jest.mock('expo-image-picker', () => ({}));
jest.mock('expo-file-system', () => ({ readAsStringAsync: jest.fn(), EncodingType: { Base64: 'base64' } }));
jest.mock('expo-image-manipulator', () => ({ manipulateAsync: jest.fn(), SaveFormat: { JPEG: 'jpeg' } }));
jest.mock('@/services/photoQualityService', () => ({ inspectPhotoQuality: jest.fn(), preflightPhotos: jest.fn() }));
jest.mock('@/services/itemService', () => ({ getItem: jest.fn(), createItem: jest.fn() }));
import fs from 'node:fs';
import path from 'node:path';
import { getSupabaseClient } from '@/template';
import { getItem } from '@/services/itemService';
import { recoverAntiqueItemPhotos, updateItemMedia } from '@/services/aiIdentificationService';

const itemId = '284d112e-e509-4d7b-a11a-93fbaba540ac';
const tenantId = 'tenant';
const names = ['1_front.jpg', '2_back.jpg', '3_underside.jpg', '4_marks.jpg'];
const publicUrl = (name: string) => `https://storage.example/storage/v1/object/public/item-images/${itemId}/${name}`;
const urls = names.map(publicUrl);
const item = { id: itemId, tenantId, specialistId: 'antiques', canonicalTitle: 'Apulian style lid', media: [], updatedAt: '2026-11-04T21:59:02.000Z' };
function chain(response: unknown) {
  const query: any = {};
  for (const method of ['select', 'update', 'eq']) query[method] = jest.fn(() => query);
  query.maybeSingle = jest.fn().mockResolvedValue(response);
  return query;
}
function setup() {
  const write = chain({ data: { id: itemId }, error: null });
  const read = chain({ data: { media: urls }, error: null });
  const from = jest.fn().mockReturnValueOnce(write).mockReturnValue(read);
  const storage = {
    list: jest.fn().mockResolvedValue({ data: names.map((name, index) => ({ id: `file-${index}`, name })), error: null }),
    getPublicUrl: jest.fn((file: string) => ({ data: { publicUrl: `https://storage.example/storage/v1/object/public/item-images/${file}` } })),
  };
  (getSupabaseClient as jest.Mock).mockReturnValue({ from, storage: { from: jest.fn(() => storage) } });
  (getItem as jest.Mock).mockResolvedValueOnce({ item, error: null }).mockResolvedValue({ item: { ...item, media: urls }, error: null });
  return { write, read, from, storage };
}
beforeEach(() => jest.resetAllMocks());

describe('Captured photo linkage (mocked Supabase)', () => {
  test('writes tenant-scoped media and verifies independent persisted readback', async () => {
    const { write, read } = setup();
    await updateItemMedia(tenantId, itemId, urls);
    expect(write.update).toHaveBeenCalledWith(expect.objectContaining({ media: urls }));
    expect(write.eq).toHaveBeenCalledWith('id', itemId);
    expect(write.eq).toHaveBeenCalledWith('tenant_id', tenantId);
    expect(read.select).toHaveBeenCalledWith('media');
    expect(read.eq).toHaveBeenCalledWith('tenant_id', tenantId);
  });
  test('surfaces the actual schema permission failure instead of successful inventory feedback', async () => {
    const { write, read } = setup();
    write.maybeSingle.mockResolvedValue({ data: null, error: { message: 'permission denied for schema auth' } });
    await expect(updateItemMedia(tenantId, itemId, urls)).rejects.toThrow('permission denied for schema auth');
    expect(read.maybeSingle).not.toHaveBeenCalled();
  });
  test('a zero-row write is not success even without an SDK error', async () => {
    const { write } = setup(); write.maybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(updateItemMedia(tenantId, itemId, urls)).rejects.toThrow('access was denied');
  });
  test('successful PATCH with missing persisted media is not success', async () => {
    const { read } = setup(); read.maybeSingle.mockResolvedValue({ data: { media: [] }, error: null });
    await expect(updateItemMedia(tenantId, itemId, urls)).rejects.toThrow('confirmed');
  });
  test('refuses local URLs or missing ownership scope before database writes', async () => {
    const { from } = setup();
    await expect(updateItemMedia('', itemId, urls)).rejects.toThrow('tenant');
    await expect(updateItemMedia(tenantId, itemId, ['file://capture.jpg'])).rejects.toThrow('Upload original');
    expect(from).not.toHaveBeenCalled();
  });
});

describe('Already-uploaded Antique originals (mocked Supabase)', () => {
  test('recovers the four actual capture filenames with concurrency protection', async () => {
    const { write, storage } = setup();
    const result = await recoverAntiqueItemPhotos(tenantId, itemId);
    expect(result.error).toBeNull(); expect(result.item?.media).toEqual(urls);
    expect(storage.list).toHaveBeenCalledWith(itemId, expect.objectContaining({ offset: 0, limit: 100 }));
    expect(write.eq).toHaveBeenCalledWith('updated_at', item.updatedAt);
  });
  test('ignores generated references, nested paths, folders and unrelated filenames', async () => {
    const { storage, write } = setup();
    storage.list.mockResolvedValue({ data: [
      ...names.map(name => ({ id: name, name })), { id: null, name: 'references' },
      { id: 'ref', name: 'references/1_front.jpg' }, { id: 'other', name: 'rendered_front.jpg' },
    ], error: null });
    expect((await recoverAntiqueItemPhotos(tenantId, itemId)).error).toBeNull();
    expect(write.update).toHaveBeenCalledWith(expect.objectContaining({ media: urls }));
    expect(storage.getPublicUrl).toHaveBeenCalledTimes(4);
  });
  test('does not overwrite photos already attached to inventory', async () => {
    const { from, storage } = setup(); (getItem as jest.Mock).mockReset().mockResolvedValue({ item: { ...item, media: urls }, error: null });
    expect((await recoverAntiqueItemPhotos(tenantId, itemId)).item?.media).toEqual(urls);
    expect(from).not.toHaveBeenCalled(); expect(storage.list).not.toHaveBeenCalled();
  });
  test.each([{ ...item, tenantId: 'another-tenant' }, { ...item, specialistId: 'coins' }])('refuses cross-tenant or unrelated-niche recovery', async wrong => {
    const { from, storage } = setup(); (getItem as jest.Mock).mockReset().mockResolvedValue({ item: wrong, error: null });
    expect((await recoverAntiqueItemPhotos(tenantId, itemId)).error).toMatch(/ownership/);
    expect(from).not.toHaveBeenCalled(); expect(storage.list).not.toHaveBeenCalled();
  });
  test('reports missing originals without fabricating photo links', async () => {
    const { storage, from } = setup(); storage.list.mockResolvedValue({ data: [], error: null });
    expect((await recoverAntiqueItemPhotos(tenantId, itemId)).error).toMatch(/No original/);
    expect(from).not.toHaveBeenCalled();
  });
  test('does not bypass RLS when the item changes during recovery', async () => {
    const { write } = setup(); write.maybeSingle.mockResolvedValue({ data: null, error: null });
    expect((await recoverAntiqueItemPhotos(tenantId, itemId)).error).toMatch(/changed/);
  });
  test('returns a storage error rather than inventing successful recovery', async () => {
    const { storage, from } = setup(); storage.list.mockResolvedValue({ data: null, error: { message: 'Storage denied' } });
    expect((await recoverAntiqueItemPhotos(tenantId, itemId)).error).toMatch(/Storage denied/);
    expect(from).not.toHaveBeenCalled();
  });
});

describe('Capture save safeguards (source contracts, not device tests)', () => {
  const source = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');
  test('required photos are linked before optional valuation can fail', () => {
    const save = source('hooks/useGenericCapture.ts').split('const save=useCallback')[1].split('const reset=')[0];
    expect(save.indexOf('await updateItemMedia')).toBeLessThan(save.indexOf('await saveCaptureValuation'));
    expect(save.indexOf('id=response.item.id')).toBeLessThan(save.indexOf('await uploadItemImages'));
    expect(save.indexOf('await updateItemMedia')).toBeLessThan(save.indexOf('if(upload.errors.length'));
  });
  test('canonical item updates retain the media field', () => { expect(source('services/itemService.ts')).toContain("media: 'media'"); });
  test('schema repair does not grant auth-table access or disable RLS', () => {
    const sql = source('supabase/migrations/20261104_inventory_photo_trigger_auth_usage.sql');
    expect(sql).toContain('grant usage on schema auth to authenticated');
    expect(sql).not.toContain('grant select'); expect(sql).not.toContain('disable row level security');
  });
});
