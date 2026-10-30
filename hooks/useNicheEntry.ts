import { useEffect } from 'react';
import { useApp } from './useApp';
import type { ProductionNicheId } from '@/constants/niches';
export function useNicheEntry(niche: ProductionNicheId) {
  const { activeNicheId, fixedNicheId, setActiveNiche } = useApp();
  useEffect(() => {
    if ((!fixedNicheId || fixedNicheId === niche) && activeNicheId !== niche) setActiveNiche(niche);
  }, [niche, fixedNicheId, activeNicheId, setActiveNiche]);
}
