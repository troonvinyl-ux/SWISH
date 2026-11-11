// Mocked regression coverage only; no live user data or marketplace requests.
jest.mock('@/template', () => ({ getSupabaseClient: jest.fn() }));
jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
jest.mock('expo-image-picker', () => ({ MediaTypeOptions: { Images: 'images' }, requestMediaLibraryPermissionsAsync: jest.fn(), launchImageLibraryAsync: jest.fn() }));
jest.mock('../aiIdentificationService', () => ({ captureFromCamera: jest.fn() }));
jest.mock('../itemService', () => ({ getItem: jest.fn() }));
jest.mock('../photoPersistenceService', () => ({ persistCapturedItemPhotos: jest.fn() }));
import fs from 'node:fs';
import * as ImagePicker from 'expo-image-picker';
import { captureFromCamera, type CapturedImage } from '../aiIdentificationService';
import { getItem } from '../itemService';
import { persistCapturedItemPhotos } from '../photoPersistenceService';
import { appendInventoryGalleryPhotos, chooseInventoryGalleryPhotos, inventoryGalleryPhotos } from '../inventoryGalleryService';
import { PRODUCTION_NICHE_IDS, NICHE_MODULES } from '@/constants/niches';
import { SMART_STUDIO_VERSION, preferredListingPhotos } from '@/shared/smartStudio';
import { backgroundEraseQuality } from './fixtures/backgroundEraseFixture';
const scope = { tenantId: 'tenant', nicheId: 'collectibles', itemId: 'item' };
const photo: CapturedImage = { uri: 'file://photo.jpg', slotId: 'gallery_extra', slotLabel: 'Extra' };
const stored = 'https://storage.test/extra.jpg';
const original = 'https://storage.test/front.jpg', clean = 'https://storage.test/front.png';
const attrs = { _smart_studio_images: { front: { version: SMART_STUDIO_VERSION, status: 'ready', originalUri: original, enhancedUri: clean, quality: backgroundEraseQuality } } };
beforeEach(() => {
  jest.clearAllMocks();
  (ImagePicker.requestMediaLibraryPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
  (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({ canceled: false, assets: [{ uri: 'file://photo.jpg', width: 100, height: 200 }] });
  (captureFromCamera as jest.Mock).mockResolvedValue(photo);
  (getItem as jest.Mock).mockResolvedValue({ error: null, item: { id: 'item', tenantId: 'tenant', specialistId: NICHE_MODULES.collectibles.defaultSpecialist, media: [original, stored] } });
  (persistCapturedItemPhotos as jest.Mock).mockResolvedValue({ complete: true, urls: [stored], errors: [], images: [photo] });
});
test.each(PRODUCTION_NICHE_IDS)('%s shows new originals alongside processed older views', niche => {
  expect(NICHE_MODULES[niche]).toBeDefined();
  expect(inventoryGalleryPhotos([original, stored], attrs)).toEqual([clean, stored]);
  // Existing default inventory-cover/Quick List projections remain unchanged.
  expect(preferredListingPhotos([original, stored], attrs)).toEqual([clean]);
  expect(inventoryGalleryPhotos([original, stored], attrs)).not.toContain(original);
});
test.each(['new', 'listed', 'active', 'sold', 'fulfilled', 'completed', 'held', 'archived', 'disposed'])('%s accepts photos without changing lifecycle', async status => {
  const item = { id: 'item', tenantId: 'tenant', specialistId: NICHE_MODULES.collectibles.defaultSpecialist, status, media: [original, stored] };
  (getItem as jest.Mock).mockResolvedValue({ error: null, item });
  const current = () => true;
  expect(await appendInventoryGalleryPhotos(scope, [photo], current)).toBe(item);
  expect(persistCapturedItemPhotos).toHaveBeenCalledWith('tenant', 'item', [photo], { processImages: false, appendOnly: true, isCurrent: current });
  expect(item.status).toBe(status);
});
test('coin gallery additions enable the shared automatic cleanup without a new engine',async()=>{
 const item={id:'item',tenantId:'tenant',specialistId:NICHE_MODULES.coins.defaultSpecialist,media:[original,stored]};
 (getItem as jest.Mock).mockResolvedValue({error:null,item});const isCurrent=()=>true;
 await appendInventoryGalleryPhotos({...scope,nicheId:'coins'},[photo],isCurrent);
 expect(persistCapturedItemPhotos).toHaveBeenCalledWith('tenant','item',[photo],{processImages:true,appendOnly:true,isCurrent});
});
test('library picks multiple views with distinct immutable roles', async () => {
  (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({ canceled: false, assets: [{ uri: 'file://a.jpg' }, { uri: 'file://b.jpg' }] });
  const images = await chooseInventoryGalleryPhotos(scope, 'library', () => true);
  expect(images).toHaveLength(2); expect(new Set(images.map(image => image.slotId)).size).toBe(2);
  expect(images.every(image => image.slotId.startsWith('gallery_'))).toBe(true);
  expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledWith(expect.objectContaining({ allowsMultipleSelection: true, selectionLimit: 8, allowsEditing: false, quality: 1 }));
});
test('camera uses the existing capture service, not identification', async () => {
  const images = await chooseInventoryGalleryPhotos(scope, 'camera', () => true);
  expect(captureFromCamera).toHaveBeenCalledTimes(1); expect(images[0].uri).toBe(photo.uri); expect(images[0].slotId).toMatch(/^gallery_/);
});
test('permission denial and cancellation never call persistence', async () => {
  (ImagePicker.requestMediaLibraryPermissionsAsync as jest.Mock).mockResolvedValueOnce({ granted: false });
  await expect(chooseInventoryGalleryPhotos(scope, 'library', () => true)).rejects.toThrow('access is required');
  (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({ canceled: true });
  expect(await chooseInventoryGalleryPhotos(scope, 'library', () => true)).toEqual([]);
  expect(persistCapturedItemPhotos).not.toHaveBeenCalled();
});
test('cross-tenant and cross-niche reads fail before selecting or saving', async () => {
  await expect(chooseInventoryGalleryPhotos({ ...scope, tenantId: 'other' }, 'camera', () => true)).rejects.toThrow('account and niche');
  await expect(appendInventoryGalleryPhotos({ ...scope, nicheId: 'coins' }, [photo], () => true)).rejects.toThrow('account and niche');
  expect(captureFromCamera).not.toHaveBeenCalled(); expect(persistCapturedItemPhotos).not.toHaveBeenCalled();
});
test('workspace changes and unconfirmed writes never report success', async () => {
  await expect(appendInventoryGalleryPhotos(scope, [photo], () => false)).rejects.toThrow('Workspace changed');
  expect(persistCapturedItemPhotos).not.toHaveBeenCalled();
  (persistCapturedItemPhotos as jest.Mock).mockResolvedValue({ complete: false, urls: [], errors: ['Upload failed'] });
  await expect(appendInventoryGalleryPhotos(scope, [photo], () => true)).rejects.toThrow('Upload failed');
});
test('gallery exposes direct addition even when there are no existing photos', () => {
  const screen = fs.readFileSync('app/stock-listing/[id].tsx', 'utf8'), gallery = fs.readFileSync('components/feature/ItemPhotoGallery.tsx', 'utf8');
  expect(screen).toContain('useInventoryGallery(item, onPhotosRecovered)');
  expect(screen).toContain('photoActions={galleryPhotos}'); expect(gallery).toContain('<InventoryPhotoActions');
  expect(gallery.indexOf('<InventoryPhotoActions')).toBeGreaterThan(gallery.indexOf('Add photos of your item'));
  const hook = fs.readFileSync('hooks/useInventoryGallery.ts', 'utf8');
  expect(hook).toContain('pending.current = { scope, photos }'); expect(hook).toContain('current.current.scope === scope'); expect(hook).toContain('app.triggerInventoryReload()');
  const service = fs.readFileSync('services/inventoryGalleryService.ts', 'utf8');
  expect(service).not.toContain('functions.invoke'); expect(service).not.toContain('identifyItemWithAI('); expect(service).not.toContain('createItem(');
});
