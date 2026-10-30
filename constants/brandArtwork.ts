import type { ImageSource } from 'expo-image';

// Presentation only. Artwork must never introduce a new product or change entitlements.
export function getBrandArtwork(nicheId: string | null | undefined): ImageSource | null {
  switch (nicheId) {
    case 'coins': return require('@/assets/images/brands/coin-flipper.jpeg');
    case 'motocross': return require('@/assets/images/brands/mx-flipper.jpeg');
    case 'bicycles': return require('@/assets/images/brands/bike-flipper.jpeg');
    case 'clothing': return require('@/assets/images/brands/threads-flip.jpeg');
    case 'trading_cards': return require('@/assets/images/brands/card-flipper.jpeg');
    case 'antiques': return require('@/assets/images/brands/antique-flipper.jpeg');
    case 'tech': return require('@/assets/images/brands/tech-flipper.jpeg');
    case 'beauty': return require('@/assets/images/brands/beauty-flipper.jpeg');
    case 'fossils': return require('@/assets/images/brands/fossil-flipper.jpeg');
    default: return null;
  }
}
export const TOOL_ARTWORK: ImageSource = require('@/assets/images/brands/tool-flipper.jpeg');
export const BRAND_NAMES: Record<string, string> = {
  coins: 'Coin Flipper', motocross: 'MX Flipper', bicycles: 'Bike Flipper', clothing: 'Threads Flip',
  trading_cards: 'Card Flipper', antiques: 'Antique Flipper', tech: 'Tech Flipper',
  beauty: 'Beauty Flipper', fossils: 'Fossil Flipper', surplus_flip: 'Surplus Flip',
};
