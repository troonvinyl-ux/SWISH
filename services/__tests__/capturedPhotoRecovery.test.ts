// Mocked storage and caller-scoped inventory only; no live data or marketplace writes.
jest.mock('@/template', () => ({ getSupabaseClient: jest.fn() }));
jest.mock('@/services/itemService', () => ({ getItem: jest.fn() }));
jest.mock('@/services/aiIdentificationService', () => ({ updateItemMedia: jest.fn() }));
jest.mock('@/services/originalImageService', () => ({ verifyStoredOriginal: jest.fn() }));
import fs from 'node:fs';
import { getSupabaseClient } from '@/template';
import { getItem } from '../itemService';
import { updateItemMedia } from '../aiIdentificationService';
import { verifyStoredOriginal } from '../originalImageService';
import { recoverCapturedItemPhotos } from '../capturedPhotoRecoveryService';
import { NICHE_MODULES, PRODUCTION_NICHE_IDS } from '@/constants/niches';
import { preferredListingPhotos } from '@/shared/smartStudio';
const hash = 'a'.repeat(64);
const front = `main_${hash}.jpg`;
const rear = `reverse_${hash}.png`;
const url = (file: string) => `https://storage.test/item-images/item/${file}`;
const urls = [url(`originals/${front}`), url(`originals/${rear}`)];
function setup(niche: typeof PRODUCTION_NICHE_IDS[number] = 'collectibles') {
  const item: any = { id: 'item', tenantId: 'tenant', specialistId: NICHE_MODULES[niche].defaultSpecialist, media: [], attributes: {}, updatedAt: 'v1' };
  (getItem as jest.Mock).mockResolvedValueOnce({ item, error: null }).mockResolvedValue({ item: { ...item, media: urls }, error: null });
  const list = jest.fn().mockImplementation(async (folder: string) => ({ data: folder === 'item' ? [{ id: null, name: 'originals' }, { id: null, name: 'studio' }, { id: 'render', name: 'rendered_front.jpg' }] : [{ id: '1', name: front }, { id: '2', name: rear }, { id: 'other', name: `references/${front}` }], error: null }));
  const storage = { list, getPublicUrl: jest.fn((file: string) => ({ data: { publicUrl: `https://storage.test/item-images/${file}` } })) };
  (getSupabaseClient as jest.Mock).mockReturnValue({ storage: { from: jest.fn(() => storage) } });
  (updateItemMedia as jest.Mock).mockResolvedValue(undefined); (verifyStoredOriginal as jest.Mock).mockResolvedValue(undefined);
  return { item, storage };
}
beforeEach(() => jest.resetAllMocks());
test.each(PRODUCTION_NICHE_IDS)('%s recovers verified originals on the existing inventory ID', async niche => {
  const { storage } = setup(niche);
  const result = await recoverCapturedItemPhotos('tenant', 'item', niche);
  expect(result.error).toBeNull(); expect(result.item?.media).toEqual(urls);
  expect(updateItemMedia).toHaveBeenCalledWith('tenant', 'item', urls, 'v1');
  expect(verifyStoredOriginal).toHaveBeenCalledTimes(2);
  expect(storage.list).toHaveBeenCalledTimes(2);
  expect(storage.getPublicUrl).toHaveBeenCalledTimes(2);
  expect(preferredListingPhotos(result.item!.media, {})).toEqual(urls);
});
test('existing canonical photos are never replaced', async () => {
  const { item, storage } = setup(); (getItem as jest.Mock).mockReset().mockResolvedValue({ item: { ...item, media: [urls[0]] }, error: null });
  expect((await recoverCapturedItemPhotos('tenant', 'item', 'collectibles')).item?.media).toEqual([urls[0]]);
  expect(storage.list).not.toHaveBeenCalled(); expect(updateItemMedia).not.toHaveBeenCalled();
});
test.each([{ tenantId: 'other' }, { specialistId: 'coins' }])('cross-tenant/niche recovery stops before storage reads', async patch => {
  const { item, storage } = setup(); (getItem as jest.Mock).mockReset().mockResolvedValue({ item: { ...item, ...patch }, error: null });
  expect((await recoverCapturedItemPhotos('tenant', 'item', 'collectibles')).error).toContain('ownership');
  expect(storage.list).not.toHaveBeenCalled(); expect(updateItemMedia).not.toHaveBeenCalled();
});
test('failed byte verification never attaches an orphan', async () => {
  setup(); (verifyStoredOriginal as jest.Mock).mockRejectedValueOnce(new Error('Stored original fingerprint differs'));
  expect((await recoverCapturedItemPhotos('tenant', 'item', 'collectibles')).error).toContain('fingerprint');
  expect(updateItemMedia).not.toHaveBeenCalled();
});
test('concurrent recovery callers share one version-protected write', async () => {
  setup(); const first = recoverCapturedItemPhotos('tenant', 'item', 'collectibles'); const second = recoverCapturedItemPhotos('tenant', 'item', 'collectibles');
  expect(first).toBe(second); await Promise.all([first, second]); expect(updateItemMedia).toHaveBeenCalledTimes(1);
});
test('duplicate slot versions require review instead of guessing which image is current', async () => {
  const { storage } = setup(); storage.list.mockResolvedValueOnce({ data: [{ id: null, name: 'originals' }], error: null }).mockResolvedValueOnce({ data: [{ id: '1', name: front }, { id: '2', name: `main_${'b'.repeat(64)}.jpg` }], error: null });
  expect((await recoverCapturedItemPhotos('tenant', 'item', 'collectibles')).error).toContain('Multiple originals');
  expect(updateItemMedia).not.toHaveBeenCalled();
});
test('version changes fail without an overwrite or replay', async () => {
  setup(); (updateItemMedia as jest.Mock).mockRejectedValueOnce(new Error('Item changed'));
  expect((await recoverCapturedItemPhotos('tenant', 'item', 'collectibles')).error).toBe('Item changed');
  expect(updateItemMedia).toHaveBeenCalledTimes(1);
});
test('readback mismatch cannot report successful carry-forward', async () => {
  const { item } = setup(); (getItem as jest.Mock).mockReset().mockResolvedValue({ item, error: null });
  expect((await recoverCapturedItemPhotos('tenant', 'item', 'collectibles')).error).toContain('could not be confirmed');
});
test('missing uploads ask for photos on the saved record, not another scan', async () => {
  const { storage } = setup(); storage.list.mockResolvedValue({ data: [], error: null });
  expect((await recoverCapturedItemPhotos('tenant', 'item', 'collectibles')).error).toContain('do not create another item');
  expect(updateItemMedia).not.toHaveBeenCalled();
});
test('shared overview and draft editor both recover before projecting listing photos', () => {
  const hook = fs.readFileSync('hooks/useInventoryPhotoRecovery.ts', 'utf8');
  expect(hook).toContain('recoverCapturedItemPhotos(tenant.id, item.id, nicheId)'); expect(hook).not.toContain("=== 'antiques'");
  const editor = fs.readFileSync('hooks/useListingEditor.ts', 'utf8');
  expect(editor).toContain('recoverCapturedItemPhotos(tenant.id, initialItem.id, nicheId)');
  expect(editor.indexOf('await recoverCapturedItemPhotos')).toBeLessThan(editor.indexOf('const originals:'));
  expect(editor).toContain('!row.external_listing_id'); expect(editor).toContain('setDirty(seedRecovered)');
  const service = fs.readFileSync('services/capturedPhotoRecoveryService.ts', 'utf8');
  expect(service).not.toContain('functions.invoke'); expect(service).not.toContain('SERVICE_ROLE'); expect(service).not.toContain('createItem');
});
