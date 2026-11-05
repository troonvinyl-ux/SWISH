import { useCallback } from 'react';
import { useApp } from './useApp';
import { isProductionNiche } from '@/constants/niches';
import { checkAntiqueListing } from '@/services/listingEditorService';
export function useAntiquePreflight() {
  const { tenant, fixedNicheId, activeNicheId } = useApp();
  return useCallback(async (listingId: string) => {
    const nicheId = fixedNicheId ?? activeNicheId;
    if (!tenant || !isProductionNiche(nicheId)) return { ready: false, error: 'Open a verified specialist workspace before checking this listing.' };
    return checkAntiqueListing(tenant.id, listingId, nicheId);
  }, [tenant?.id, fixedNicheId, activeNicheId]);
}
