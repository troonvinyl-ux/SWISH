import { useCallback, useMemo } from 'react';
import { useRouter } from 'expo-router';
import { useApp } from '@/hooks/useApp';
import { NICHES, isProductionNiche, type ProductionNicheId } from '@/constants/niches';

/** Adapter between trusted AppContext membership/scope APIs and the master-home UI. */
export function useUnifiedShell() {
  const app = useApp();
  const router = useRouter();
  const modules = useMemo(() => app.enabledNiches
    .filter(isProductionNiche)
    .map(id => ({ id, name: NICHES[id].name, niche: NICHES[id] })), [app.enabledNiches]);

  const enter = useCallback(async (id: ProductionNicheId) => {
    if (!modules.some(module => module.id === id)) return false;
    const opened = await app.openModule(id);
    if (opened) router.replace('/(tabs)');
    return opened;
  }, [app.openModule, modules, router]);

  const switchNiche = useCallback(async () => {
    const returned = await app.returnToMaster();
    if (returned) router.replace('/swish');
    return returned;
  }, [app.returnToMaster, router]);

  return {
    modules,
    tenantLoading: app.tenantLoading,
    nichePreferencesLoading: app.nichePreferencesLoading,
    moduleLoading: app.moduleLoading,
    accessReady: app.accessReady,
    canSwitchNiche: app.canSwitchNiche,
    isMasterAdmin: app.isMasterAdmin,
    activeNicheId: app.activeNicheId,
    enter,
    switchNiche,
    refreshSubscription: app.refreshSubscription,
  };
}
