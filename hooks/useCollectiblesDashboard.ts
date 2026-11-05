import { useCallback, useState } from 'react';
import { useRouter } from 'expo-router';
import { useInventory } from '@/hooks/useInventory';

/** Collectibles actions reuse the active tenant- and niche-scoped inventory. */
export function useCollectiblesDashboard() {
  const router = useRouter();
  const inventory = useInventory();
  const [purpose, setPurpose] = useState<'listing' | 'valuation' | null>(null);

  const close = useCallback(() => setPurpose(null), []);
  const open = useCallback((action: string) => {
    switch (action) {
      case 'identify':
        router.push('/capture' as any);
        break;
      case 'inventory':
        router.push('/(tabs)/inventory' as any);
        break;
      case 'listing':
        if (inventory.items.length) setPurpose('listing');
        else router.push('/create-listing' as any);
        break;
      case 'valuation':
        if (inventory.items.length) setPurpose('valuation');
        else router.push('/research' as any);
        break;
      case 'sync':
        router.push('/ebay-hub' as any);
        break;
      case 'opportunities':
        router.push('/research' as any);
        break;
      default:
        break;
    }
  }, [inventory.items.length, router]);

  const select = useCallback((itemId: string) => {
    const selectedPurpose = purpose;
    setPurpose(null);
    if (selectedPurpose === 'listing') {
      router.push({ pathname: '/create-listing', params: { id: itemId } } as any);
    } else if (selectedPurpose === 'valuation') {
      router.push({ pathname: '/item/[id]', params: { id: itemId } } as any);
    }
  }, [purpose, router]);

  return {
    items: inventory.items,
    stats: inventory.stats,
    loading: inventory.loading,
    syncError: inventory.syncError,
    reload: inventory.reload,
    purpose,
    open,
    close,
    select,
  };
}
