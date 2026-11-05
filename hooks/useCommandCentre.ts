import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { useAuth } from '@/template';
import { useApp } from './useApp';
import { loadCommandSnapshot, sumCommandModules, type CommandSnapshot } from '@/services/commandCentreService';
import type { ProductionNicheId } from '@/constants/niches';
import { useUnifiedShell } from './useUnifiedShell';
export type CommandAction = 'open' | 'identify' | 'inventory' | 'listings' | 'review' | 'sales';
const destinations: Record<CommandAction, string> = { open: '/(tabs)', identify: '/(tabs)/scan', inventory: '/(tabs)/inventory', listings: '/(tabs)/listings', review: '/review-required', sales: '/ebay-hub' };
export function useCommandCentre(platformOverride?: boolean, enabledOverride?: boolean) {
 const app = useApp(); const shell = useUnifiedShell(); const { user } = useAuth(); const router = useRouter();
 const platform = platformOverride ?? shell.isMasterAdmin;
 const enabled = enabledOverride ?? (app.accessReady && (platform || Boolean(app.tenant?.id)));
 const key = `${user?.id ?? ''}:${app.tenant?.id ?? ''}:${platform}:${enabled}:${app.enabledNiches.join(',')}`;
 const current = useRef(key); current.current = key; const generation = useRef(0);
 const pending = useRef<{ key: string; generation: number } | null>(null);
 const [state, setState] = useState({ key: '', snapshot: null as CommandSnapshot | null, error: null as string | null, loading: false, stale: false });
 const refresh = useCallback(async () => {
  if (!enabled || !user?.id || pending.current?.key === key) return;
  const version = ++generation.current; pending.current = { key, generation: version };
  setState(previous => ({ key, snapshot: previous.key === key ? previous.snapshot : null, stale: previous.key === key && Boolean(previous.snapshot), error: null, loading: true }));
  try {
   const result = await loadCommandSnapshot(app.tenant?.id ?? null, platform, user.id);
   if (current.current !== key || generation.current !== version) return;
   setState(previous => ({ key, snapshot: result.snapshot ?? (result.retryable && previous.key === key ? previous.snapshot : null), error: result.error, loading: false, stale: result.retryable && Boolean(result.error) }));
  } catch {
   if (current.current === key && generation.current === version) setState({ key, snapshot: null, error: 'Reporting session could not be verified. Refresh access to retry.', loading: false, stale: false });
  } finally { if (pending.current?.generation === version) pending.current = null; }
 }, [enabled, user?.id, app.tenant?.id, platform, key]);
 useEffect(() => { void refresh(); return () => { generation.current++; pending.current = null; }; }, [refresh]);
 const snapshot = state.key === key && enabled ? state.snapshot : null;
 const modules = useMemo(() => snapshot?.modules.filter(row => platform || shell.modules.some(module => module.id === row.id)) ?? [], [snapshot, platform, shell.modules]);
 const totals = useMemo(() => snapshot ? sumCommandModules(modules) : null, [snapshot, modules]);
 const open = useCallback(async (id: ProductionNicheId, action: CommandAction = 'open') => {
  // Inspection never binds module scope. Only explicit confirmed workspace entry does.
  if (await app.openModule(id)) router.replace(destinations[action] as any);
 }, [app.openModule, router]);
 return { snapshot, modules, totals, platform, refresh, open, loading: enabled && (state.key !== key || state.loading), error: state.key === key ? state.error : null, stale: state.key === key && state.stale, shell };
}
