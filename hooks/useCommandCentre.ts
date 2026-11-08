import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { useAuth } from '@/template';
import { useApp } from './useApp';
import { useUnifiedShell } from './useUnifiedShell';
import { loadCommandSnapshot, type CommandSnapshot } from '@/services/commandCentreService';
import { commandSnapshotTotals } from '@/services/commandSnapshotTotalsService';
import { commandScopeLabel, resolveCommandReportScope, type CommandReportScope } from '@/services/commandScopeService';
import type { ProductionNicheId } from '@/constants/niches';

export type CommandAction = 'open' | 'identify' | 'inventory' | 'listings' | 'review' | 'sales';
const destinations: Record<CommandAction, string> = {
  open: '/(tabs)', identify: '/(tabs)/scan', inventory: '/(tabs)/inventory',
  listings: '/(tabs)/listings', review: '/review-required', sales: '/ebay-hub',
};
interface ReportState { key: string; snapshot: CommandSnapshot | null; error: string | null; loading: boolean; stale: boolean }

export function useCommandCentre(platformOverride?: boolean, enabledOverride?: boolean) {
  const app = useApp();
  const shell = useUnifiedShell();
  const { user } = useAuth();
  const router = useRouter();
  // The verified parent grants the capability; the database still authorizes every read.
  const canViewPlatform = platformOverride ?? shell.isMasterAdmin;
  const [selection, setSelection] = useState<{ userId: string; scope: CommandReportScope }>({ userId: '', scope: 'workspace' });
  const reportScope = resolveCommandReportScope(canViewPlatform, selection.scope, selection.userId, user?.id ?? '');
  const platform = reportScope === 'platform';
  const enabled = Boolean((enabledOverride ?? app.accessReady) && (platform || app.tenant?.id));
  const key = `${user?.id ?? ''}:${app.tenant?.id ?? ''}:${platform}:${enabled}:${app.enabledNiches.join(',')}`;
  const current = useRef(key); current.current = key;
  const generation = useRef(0);
  const pending = useRef<{ key: string; generation: number } | null>(null);
  const [state, setState] = useState<ReportState>({ key: '', snapshot: null, error: null, loading: false, stale: false });

  const setReportScope = useCallback((scope: CommandReportScope) => {
    setSelection({ userId: user?.id ?? '', scope: canViewPlatform ? scope : 'workspace' });
  }, [canViewPlatform, user?.id]);

  const refresh = useCallback(async () => {
    if (!enabled || !user?.id || pending.current?.key === key) return;
    const version = ++generation.current;
    pending.current = { key, generation: version };
    setState(previous => ({ key, snapshot: previous.key === key ? previous.snapshot : null, stale: previous.key === key && Boolean(previous.snapshot), error: null, loading: true }));
    try {
      const result = await loadCommandSnapshot(app.tenant?.id ?? null, platform, user.id);
      if (current.current !== key || generation.current !== version) return;
      setState(previous => {
        const retained = result.retryable && previous.key === key ? previous.snapshot : null;
        return { key, snapshot: result.snapshot ?? retained, error: result.error, loading: false, stale: Boolean(result.error && retained) };
      });
    } catch {
      if (current.current === key && generation.current === version) setState({ key, snapshot: null, error: 'Reporting session could not be verified. Refresh access to retry.', loading: false, stale: false });
    } finally {
      if (pending.current?.generation === version) pending.current = null;
    }
  }, [enabled, user?.id, app.tenant?.id, platform, key]);

  useEffect(() => () => { generation.current++; pending.current = null; }, [refresh]);
  // Only screen entry, explicit scope selection and confirmed inventory changes read data.
  // No polling, provider sync or background report download.
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh, app.inventoryReloadSignal]));

  const snapshot = state.key === key && enabled ? state.snapshot : null;
  const modules = useMemo(() => snapshot?.modules.filter(row => platform || shell.modules.some(module => module.id === row.id)) ?? [], [snapshot, platform, shell.modules]);
  const totals = useMemo(() => snapshot ? commandSnapshotTotals(snapshot, modules) : null, [snapshot, modules]);
  const scopeLabel = commandScopeLabel(platform, app.tenant?.name, app.tenant?.id)
    + (snapshot?.unclassifiedInventory ? ` · ${snapshot.unclassifiedInventory} unclassified historical records included` : '');
  const open = useCallback(async (id: ProductionNicheId, action: CommandAction = 'open') => {
    // Reporting never binds scope; explicit workspace entry does.
    if (await app.openModule(id)) router.replace(destinations[action] as any);
  }, [app.openModule, router]);

  return {
    snapshot, modules, totals, operations: snapshot?.operations ?? null,
    platform, canViewPlatform, reportScope, setReportScope, scopeLabel,
    workspaceId: app.tenant?.id ?? null, refresh, open,
    loading: enabled && (state.key !== key || state.loading),
    error: state.key === key ? state.error ?? (snapshot && !totals ? 'Workspace totals and niche ledger disagree. Refresh to verify counts; no records were changed.' : null) : null,
    stale: state.key === key && state.stale, shell,
  };
}
