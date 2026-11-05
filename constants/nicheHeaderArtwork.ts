import type { ImageSource } from 'expo-image';
import type { ProductionNicheId } from './niches';
import { getBrandArtwork } from './brandArtwork';

/** Header photography is separate from logos, app icons and membership artwork. */
export const NICHE_HEADER_SPEC = { width: 1920, height: 1120, aspectRatio: 12 / 7 } as const;
export const UPLOADED_HEADER_NICHES: readonly ProductionNicheId[] = ['tech', 'bicycles', 'motocross', 'beauty', 'trading_cards', 'antiques', 'surplus_flip', 'clothing', 'fossils', 'collectibles', 'coins'];

export function getNicheHeaderArtwork(nicheId: ProductionNicheId): ImageSource | null {
  switch (nicheId) {
    // Generation unavailable: music-specific photographic fallback, not another niche's image.
    case 'tunes_flip': return { uri: 'https://images.unsplash.com/photo-1461360228754-6e81c478b882?w=1920&h=1120&auto=format&fit=crop&q=85' };
    case 'tech': return require('@/assets/images/headers/tech.jpeg');
    case 'bicycles': return require('@/assets/images/headers/bicycles.jpeg');
    case 'motocross': return require('@/assets/images/headers/motocross.jpeg');
    case 'beauty': return require('@/assets/images/headers/beauty.jpeg');
    case 'trading_cards': return require('@/assets/images/headers/trading-cards.jpeg');
    case 'antiques': return require('@/assets/images/headers/antiques.jpeg');
    case 'surplus_flip': return require('@/assets/images/headers/surplus.jpeg');
    case 'clothing': return require('@/assets/images/headers/clothing.jpeg');
    case 'fossils': return require('@/assets/images/headers/fossils.jpeg');
    case 'collectibles': return require('@/assets/images/headers/collectibles.jpeg');
    case 'coins': return require('@/assets/images/headers/coins.jpeg');
    default: return getBrandArtwork(nicheId);
  }
}
