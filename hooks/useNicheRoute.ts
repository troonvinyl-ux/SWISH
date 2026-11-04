import { usePathname } from 'expo-router';
import { useAuth } from '@/template';
import { useApp } from './useApp';
import { isRouteAllowedForBuild, isRouteAllowedForModule, resolveProductionNiche } from '@/services/nicheRouting';
import { moduleForPath } from '@/services/unifiedModuleRegistry';
import registry from '@/niche-modules.json';
const publicPaths = ['/', '/login', '/privacy-policy'];
const shellPaths = ['/swish', '/niche-select', '/app-updates', '/subscription', '/onboarding'];
export function useNicheRoute() {
  const path = usePathname().replace(/\/$/, '') || '/';
  const { user, loading: authLoading } = useAuth(); const app = useApp();
  const admin = registry.adminOnlyRoutes.some(file => '/' + file.replace(/\.tsx$/, '') === path);
  const entry = moduleForPath(path);
  const active = resolveProductionNiche(app.fixedNicheId ?? app.activeNicheId);
  const loading = !publicPaths.includes(path) && (authLoading || (!!user && (app.tenantLoading || app.nichePreferencesLoading)));
  let allowed = publicPaths.includes(path);
  if (!allowed && user && app.accessReady) {
    if (admin) allowed = app.isMasterAdmin;
    else if (entry) allowed = app.enabledNiches.includes(entry) && (!app.fixedNicheId || app.fixedNicheId === entry);
    else if (shellPaths.includes(path)) allowed = true;
    else allowed = !!active && app.enabledNiches.includes(active) && (app.fixedNicheId ? isRouteAllowedForBuild(path, active) : isRouteAllowedForModule(path, active));
  }
  return { allowed, loading, moduleLoading: app.moduleLoading, authenticated: !!user, productName: app.activeNiche.name };
}
