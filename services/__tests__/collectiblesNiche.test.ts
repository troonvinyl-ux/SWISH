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
    expect(classifyListing(null, 'Antiques: Ceramics', 'Wedgwood vase').niche).toBe('antiques');
    expect(inferImportNiche('Coins', 'Roman coin')).toBe('coins');
    expect(inferImportNiche('Trading Cards', 'Pokémon card')).toBe('trading_cards');
    expect(inferImportNiche('Antiques: Ceramics', 'Wedgwood vase')).toBe('antiques');
  });

  test('keeps the public and Edge import classifiers identical', () => {
    expect(fs.readFileSync('shared/ebayImportScope.ts', 'utf8'))
      .toBe(fs.readFileSync('supabase/functions/_shared/ebayImportScope.ts', 'utf8'));
  });

  test('does not force an ambiguous generic title into Collectibles', () => {
    expect(classifyListing(null, null, 'Vintage item').niche).toBe('unclassified');
    expect(inferImportNiche('', 'Vintage item')).toBeNull();
  });
});
