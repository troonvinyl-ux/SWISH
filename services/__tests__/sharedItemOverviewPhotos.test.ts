// Source contracts only; not a substitute for authenticated/device acceptance.
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(__dirname, '../..');
const source = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');
describe('Shared item overview photo and layout contracts', () => {
  test('all item details use the canonical overview with the shared gallery', () => {
    expect(source('app/item/[id].tsx')).toContain('/stock-listing/');
    const screen = source('app/stock-listing/[id].tsx');
    expect(screen).toContain('<ItemPhotoGallery');
    expect(screen).toContain('useItemMainImage(item, onPhotosRecovered)');
    expect(screen).toContain('niche.captureInstructions[0]');
    expect(screen).toContain('niche.terms.condition');
    expect(screen).toContain('<StockListingToolbar');
    expect(screen).not.toContain('<View style={[s.actionBar');
    expect(screen).toContain('<StockPricingSummary');
    expect(screen).toContain('<SpecialistItemFields');
    expect(screen).toContain('<MXConditionGrader');
  });
  test('saved cover and listing photo choices stay separate from viewing a thumbnail', () => {
    const gallery = source('components/feature/ItemPhotoGallery.tsx');
    expect(gallery).toContain('onPress={() => gallery.select(index)}');
    expect(gallery).toContain('onSelectMain(gallery.activeUrl)');
    expect(gallery).toContain('Set as main image');
    expect(gallery).toContain('Main image selected');
    expect(gallery).toContain('contentFit="contain"');
    expect(gallery).toContain('gallery.exportPhoto');
    expect(gallery).not.toContain('getSupabaseClient');
    const editor = source('app/ebay-listing-editor.tsx');
    expect(editor).toContain('<ListingPhotoManager');
    expect(editor).toContain("onChange={urls=>editor.update('media',urls)}");
    expect(source('hooks/useListingEditor.ts')).toMatch(/media:\s*moveMainImageFirst\(photos,\s*uri\)/);
  });
  test('saving a cover remains scoped, version-protected, verified and non-publishing', () => {
    const service = source('services/itemPhotoService.ts');
    expect(service).toMatch(/\.eq\('tenant_id',tenantId\)/);
    expect(service).toMatch(/\.in\('specialist_id',specialists\)/);
    expect(service).toMatch(/\.eq\('updated_at',row\.updated_at\)/);
    expect(service).toContain('Photos changed since this page loaded');
    expect(service).toContain('mediaOrderMatches(saved.data.media');
    // This operation selects only the inventory cover.  Listing-specific
    // original/cutout choices remain in the listing editor's attributes.
    expect(service).not.toContain('ebay_listing_media');
    expect(service).not.toContain('functions.invoke');
    expect(service).not.toContain('SERVICE_ROLE');
    const hook = source('hooks/useItemMainImage.ts');
    expect(hook).toContain('current.current !== scope');
    expect(hook).toContain('triggerInventoryReload()');
  });
  test('gallery size updates and action sheet are bounded on rotation', () => {
    expect(source('hooks/useStockPhotoGallery.ts')).toContain("Dimensions.addEventListener('change'");
    expect(source('hooks/useStockPhotoGallery.ts')).toContain('subscription.remove()');
    expect(source('components/feature/ItemPhotoGallery.tsx')).toContain('event.nativeEvent.layout.width');
    expect(source('components/feature/ItemPhotoGallery.tsx')).toContain('setViewerSize');
    expect(source('components/feature/StockListingToolbar.tsx')).toContain("height: '85%'");
  });
});
