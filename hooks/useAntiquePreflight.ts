import { useCallback } from 'react';
import { useApp } from './useApp';
import { checkAntiqueListing } from '@/services/listingEditorService';
export function useAntiquePreflight() {
  const { tenant, fixedNicheId, activeNicheId } = useApp();
  return useCallback(async (listingId: string) => {
    if (!tenant || (fixedNicheId ?? activeNicheId) !== 'antiques') return { ready: false, error: 'Open the Antique workspace before checking this listing.' };
    return checkAntiqueListing(tenant.id, listingId);
  }, [tenant?.id, fixedNicheId, activeNicheId]);
}
