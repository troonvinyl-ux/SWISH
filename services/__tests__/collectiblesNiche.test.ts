import fs from 'node:fs';
import { classifyListing } from '@/services/nicheCategoryService';
import { inferImportNiche } from '@/shared/ebayImportScope';

describe('Collectibles Flipper classification', () => {
  test.each([
    ['Toys & Hobbies: Action Figures', 'Star Wars vintage action figure'],
    ['Comics & Graphic Novels', 'Amazing Spider-Man comic book'],
    ['Board Games', 'Vintage board game complete'],
    ['Collectables: Diecast & Model Vehicles', 'Hot Wheels diecast car'],
    ['Memorabilia', 'Music memorabilia tour programme'],
  ])('classifies %s into Collectibles', (category, title) => {
    expect(classifyListing(null, category, title).niche).toBe('collectibles');
    expect(inferImportNiche(category, title)).toBe('collectibles');
  });

  test('keeps neighbouring specialist categories out of Collectibles', () => {
    expect(classifyListing(null, 'Coins', 'Roman denarius').niche).toBe('coins');
    expect(classifyListing(null, 'Trading Cards', 'Pokémon card').niche).toBe('trading_cards');
    expect(classifyListing(null, 'Antiques: Ceramics', 'Antique porcelain vase').niche).toBe('antiques');
    expect(inferImportNiche('Coins', 'Roman coin')).toBe('coins');
    expect(inferImportNiche('Trading Cards', 'Pokémon card')).toBe('trading_cards');
    expect(inferImportNiche('Antiques: Ceramics', 'Antique porcelain vase')).toBe('antiques');
  });

  test('keeps the public and Edge import classifiers identical', () => {
    expect(fs.readFileSync('shared/ebayImportScope.ts', 'utf8'))
      .toBe(fs.readFileSync('supabase/functions/_shared/ebayImportScope.ts', 'utf8'));
  });


  test('uses collectibles-specific market valuation and listing generation', () => {
    const valuation = fs.readFileSync('supabase/functions/swish-market-value/index.ts', 'utf8');
    const listing = fs.readFileSync('supabase/functions/swish-list-generate/index.ts', 'utf8');
    const itemView = fs.readFileSync('app/stock-listing/[id].tsx', 'utf8');
    const panel = fs.readFileSync('components/feature/NicheValuationPanel.tsx', 'utf8');

    expect(valuation).toContain('const requestedNiche = specialistNiche(specialistId)');
    expect(valuation).toContain('await requirePaidNiche');
    expect(valuation).toContain('itemProduct !== requestedProduct');
    expect(itemView).toContain('getNicheEvidenceLabel');
    expect(panel).toContain("collectibles: { specialistId: 'collectibles'");
    expect(listing).toContain("const specialistId: string = item.specialist_id ?? 'curiosities_collectibles'");
    expect(listing).toContain('profileForSpecialist(specialistId)');
    expect(listing).toContain('evaluateSpecialistSafety');
  });


  test('keeps Collectibles listing editor focused and exposes confirmed eBay outcomes', () => {
    const editor = fs.readFileSync('app/ebay-listing-editor.tsx', 'utf8');
    const listingService = fs.readFileSync('services/listingService.ts', 'utf8');
    const stockDetail = fs.readFileSync('app/stock-listing/[id].tsx', 'utf8');
    expect(editor).toContain('ListingItemSpecifics');
    expect(editor).toContain('Review listing requirements');
    expect(editor).toContain('List now on eBay');
    expect(listingService).toContain('externalListingId: published.externalListingId');
    expect(listingService).toContain('Published on eBay. SWISH stock synchronisation is pending; do not submit again.');
    expect(listingService).toContain('Publication outcome is not yet confirmed.');
    expect(stockDetail).toContain('EbayListingLiveCheck');
    expect(stockDetail).toContain('StockListingToolbar');
  });

  test('uses the server-provided owner claim before the backwards-compatible role check', () => {
    const access = fs.readFileSync('services/moduleAccessService.ts', 'utf8');
    expect(access).toContain("typeof billing.status.platformOwner === 'boolean'");
    expect(access).toContain("rpc('swish_is_platform_owner')");
    expect(access).toContain("backendRead('platform-owner'");
  });

  test('does not force an ambiguous generic title into Collectibles', () => {
    expect(classifyListing(null, null, 'Vintage item').niche).toBe('unclassified');
    expect(inferImportNiche('', 'Vintage item')).toBeNull();
  });
});
