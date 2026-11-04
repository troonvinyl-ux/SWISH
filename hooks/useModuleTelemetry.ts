import { useEffect, useRef, useCallback } from 'react';
import { Platform } from 'react-native';
import { useApp } from './useApp';
import { recordModuleObservation, recordNavigationFailure } from '@/services/verificationCentreService';
import type { ProductionNicheId } from '@/constants/niches';
export function useModuleFailure(nicheId: ProductionNicheId) {
 const { tenant, isMasterAdmin } = useApp();
 return useCallback(() => { if (tenant && isMasterAdmin) void recordNavigationFailure(tenant.id, nicheId); }, [tenant?.id,isMasterAdmin,nicheId]);
}
export function useModuleTelemetry(nicheId: ProductionNicheId) {
 const { tenant, isMasterAdmin, activeNicheId, moduleEpoch, moduleLoading } = useApp();
 const seen = useRef('');
 useEffect(() => {
  if (!isMasterAdmin || !tenant || activeNicheId !== nicheId || moduleLoading) return;
  const key = `${tenant.id}:${nicheId}:${moduleEpoch}`; if (seen.current === key) return;
  const timer = setTimeout(() => { seen.current = key; void recordModuleObservation(tenant.id, nicheId, Platform.OS); }, 300);
  return () => clearTimeout(timer);
 }, [tenant?.id, isMasterAdmin, activeNicheId, nicheId, moduleEpoch, moduleLoading]);
}
