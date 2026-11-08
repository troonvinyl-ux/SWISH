import { useCallback, useEffect, useMemo, useState } from 'react';
import { Dimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { useApp } from '@/hooks/useApp';
import { useInventory } from '@/hooks/useInventory';
import type { ProductionNicheId } from '@/constants/niches';
import { NICHE_HEADER_SPEC } from '@/constants/nicheHeaderArtwork';
import { Spacing } from '@/constants/theme';
import { getNicheDashboardContent, nicheDashboardItemRoute, type NicheDashboardAction } from '@/services/nicheDashboardService';
import { resolveProductionNiche } from '@/services/nicheRouting';
import { describeInventoryFailure } from '@/services/backendAvailabilityService';

export function useNicheDashboard(nicheId: ProductionNicheId) {
  const router = useRouter();
  const app = useApp();
  const [purpose, setPurpose] = useState<'listing' | 'valuation' | 'condition' | null>(null);
  const inventory = useInventory({}, { countsOnly: true });
  const stock = useInventory({}, { enabled: purpose !== null });
  const [width, setWidth] = useState(375);
  const content = useMemo(() => getNicheDashboardContent(nicheId, Boolean(app.fixedNicheId)), [nicheId, app.fixedNicheId]);
  const active = resolveProductionNiche(app.fixedNicheId ?? app.activeNicheId);
  const scope = `${app.tenant?.id ?? ''}:${active ?? ''}:${app.moduleEpoch}`;
  const inScope = active === nicheId && app.accessReady && !app.moduleLoading;

  useEffect(() => {
    const update = () => {
      const next = Dimensions.get('window').width;
      setWidth(Number.isFinite(next) && next > 0 ? next : 375);
    };
    update();
    const subscription = Dimensions.addEventListener('change', update);
    return () => subscription.remove();
  }, []);
  useEffect(() => { setPurpose(null); }, [scope]);

  const close = useCallback(() => setPurpose(null), []);
  const open = useCallback((action: NicheDashboardAction) => {
    if (!inScope) return;
    if (action.purpose) {
      // Open immediately; hydrate stock only after this explicit item-selection action.
      // Loading or a failed read must never be mistaken for an empty collection.
      setPurpose(action.purpose);
      return;
    }
    if (action.route) router.push(action.route as any);
  }, [inScope, router]);
  const select = useCallback((itemId: string) => {
    if (!inScope || !purpose || !stock.items.some(item => item.id === itemId)) return;
    const destination = nicheDashboardItemRoute(nicheId, purpose, itemId);
    setPurpose(null);
    router.push(destination as any);
  }, [inScope, purpose, stock.items, nicheId, router]);

  const columns = width >= 1024 ? 3 : 2;
  const contentWidth = Math.max(1, Math.min(width, 960) - Spacing.base * 2);
  return {
    content,
    items: inScope ? stock.items : [],
    stats: inventory.stats,
    hasSnapshot: inventory.hasSnapshot,
    loading: inventory.loading,
    stockLoading: stock.loading,
    stockError: describeInventoryFailure(stock.syncError),
    reloadStock: stock.reload,
    error: describeInventoryFailure(inventory.syncError),
    reload: inventory.reload,
    ready: inScope,
    purpose,
    close,
    open,
    select,
    columns,
    tileWidth: Math.max(1, (contentWidth - Spacing.base * (columns - 1)) / columns),
    bannerHeight: Math.max(160, Math.min(336, contentWidth / NICHE_HEADER_SPEC.aspectRatio)),
  };
}
