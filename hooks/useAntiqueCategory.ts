import { useCallback } from 'react';
import { useApp } from './useApp';
import { saveAntiqueCategory } from '@/services/listingEditorService';
export function useAntiqueCategory() {
  const { tenant, activeNicheId, fixedNicheId, triggerInventoryReload } = useApp();
  return useCallback(async (itemId: string, categoryId: string, categoryName: string) => {
    if (!tenant || (fixedNicheId ?? activeNicheId) !== 'antiques') return { attributes: null, error: 'Select your Antique workspace before saving its category.' };
    const result = await saveAntiqueCategory(tenant.id, itemId, categoryId, categoryName);
    if (!result.error) triggerInventoryReload();
    return result;
  }, [tenant?.id, activeNicheId, fixedNicheId, triggerInventoryReload]);
}
