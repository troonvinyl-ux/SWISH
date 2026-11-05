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

    expect(valuation).toContain('a specific collectible such as an action figure');
    expect(itemView).toContain('Collectibles eBay Product Research & exact-match sold comps');
    expect(panel).toContain("collectibles: { specialistId: 'collectibles'");
    expect(listing).toContain("const isCollectibles = item.specialist_id === 'collectibles'");
    expect(listing).toContain('COLLECTIBLES LISTING RULES');
    expect(listing).toContain('selected eBay leaf category Taxonomy');
  });


  test('keeps Collectibles listing editor focused and exposes confirmed eBay outcomes', () => {
    const editor = fs.readFileSync('app/ebay-listing-editor.tsx', 'utf8');
    const listingService = fs.readFileSync('services/listingService.ts', 'utf8');
    const stockDetail = fs.readFileSync('app/stock-listing/[id].tsx', 'utf8');
    expect(editor).toContain("const isCollectibles=activeNicheId==='collectibles'");
    expect(editor).toContain('COLLECTIBLES · LISTING WORKSPACE');
    expect(editor).toContain('collapsible={isCollectibles}');
    expect(editor.match(/<EditorSection /g)?.length).toBe(7);
    expect(editor.match(/<\\/EditorSection>/g)?.length).toBe(7);
    expect(listingService).toContain('externalListingId: published.externalListingId');
    expect(stockDetail).toContain('eBay accepted — SWISH sync pending');
    expect(stockDetail).toContain('Do not submit or retry this draft again');
  });

  test('avoids the zero-argument owner RPC during client membership loading', () => {
    const access = fs.readFileSync('services/moduleAccessService.ts', 'utf8');
    expect(access).toContain("from('swish_platform_owners')");
    expect(access).not.toContain("rpc('swish_is_platform_owner')");
  });

  test('does not force an ambiguous generic title into Collectibles', () => {
    expect(classifyListing(null, null, 'Vintage item').niche).toBe('unclassified');
    expect(inferImportNiche('', 'Vintage item')).toBeNull();
  });
});
