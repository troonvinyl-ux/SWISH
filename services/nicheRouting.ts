import { NICHE_MODULES, type ProductionNicheId } from '@/constants/niches';
import moduleRegistry from '../niche-modules.json';

export function resolveNicheFromNativeAppId(appId: string | null | undefined): ProductionNicheId | null {
  return (Object.entries(NICHE_MODULES).find(([, product]) => product.androidPackage === appId || product.iosBundleIdentifier === appId)?.[0] as ProductionNicheId) ?? null;
}
export function resolveNicheFromNativeAppScheme(input: string | string[] | null | undefined): ProductionNicheId | null {
  const schemes = Array.isArray(input) ? input : [input];
  return (Object.entries(NICHE_MODULES).find(([, product]) => schemes.includes(product.scheme))?.[0] as ProductionNicheId) ?? null;
}

export type ProductEntryRoute = `/entry/${string}`;

/** Exact, registered aliases only. Never classify an unknown ID by substring. */
export function resolveProductionNiche(value: string | null | undefined): ProductionNicheId | null {
  if (typeof value !== 'string') return null;
  const id = value.trim().toLowerCase();
  for (const [niche, config] of Object.entries(NICHE_MODULES)) {
    if (id === niche || config.aliases.includes(id) || config.specialists.includes(id) || config.legacySpecialists.includes(id)) return niche as ProductionNicheId;
  }
  return null;
}

/** Canonicalise new writes only; never rewrite historical inventory or change its niche. */
export function canonicalProductionSpecialist(value: string): string | null {
  for (const product of Object.values(NICHE_MODULES)) {
    if (product.specialists.includes(value)) return value;
    if (product.legacySpecialists.includes(value)) return product.defaultSpecialist;
  }
  return null;
}

/** Read-only legacy compatibility never changes stored specialist identities. */
export function getProductionNicheSpecialistIds(value: string | null | undefined): string[] {
  const niche = resolveProductionNiche(value);
  if (!niche) return [];
  const config = NICHE_MODULES[niche];
  return [...new Set([...config.specialists, ...config.legacySpecialists])];
}

export function nicheToAppSchemeUrl(value: string | null | undefined): string | null {
  const niche = resolveProductionNiche(value);
  return niche ? `${NICHE_MODULES[niche].scheme}://` : null;
}

export function nicheToEntryRoute(value: string | null | undefined): ProductEntryRoute | null {
  const niche = resolveProductionNiche(value);
  return niche ? `/${NICHE_MODULES[niche].entry.replace(/\.tsx$/, '')}` as ProductEntryRoute : null;
}

/** Resolve the one-tap Scan action to the active niche's real capture workflow. */
export function nicheToScannerRoute(value: string | null | undefined): string {
  const niche = resolveProductionNiche(value);
  if (!niche) return '/capture';
  // Every product explicitly declares its scanner in the canonical registry.
  // Shared capture remains niche/specialist scoped; no implicit product fallback.
  return NICHE_MODULES[niche].scannerRoute;
}

export function isRouteAllowedForModule(pathname: string, nicheId: string | null): boolean { return isRouteAllowedForBuild(pathname, nicheId, true); }
export function isRouteAllowedForBuild(pathname: string, fixedNiche: string | null, unified = false): boolean {
  if (!fixedNiche) return true;
  const niche = resolveProductionNiche(fixedNiche);
  if (!niche) return false;
  const route = pathname.split('?')[0].replace(/^\//, '').replace(/\/$/, '');
  if ((moduleRegistry.unifiedOnlyRoutes ?? []).some(file => file.replace(/\.tsx$/, '') === route)) return false;
  if (moduleRegistry.adminOnlyRoutes.some(file => file.replace(/\.tsx$/, '') === route)) return false;
  const config = NICHE_MODULES[niche];
  const allowed = [...(unified ? moduleRegistry.sharedRoutes : config.buildSharedRoutes ?? moduleRegistry.sharedRoutes), config.entry, config.home, ...config.dedicatedRoutes].filter((file): file is string => Boolean(file));
  // Expo omits tab groups from usePathname; normalize both representations.
  if (!allowed.some(file => {
    const pattern = file.replace(/\.tsx$/, '').replace(/\([^/]+\)\//g, '').replace(/\[[^/]+\]/g, '[id]');
    const actual = route.replace(/\([^/]+\)\//g, '');
    if (pattern === 'index' && !actual) return true;
    const expectedParts = pattern.split('/'); const parts = actual.split('/');
    return expectedParts.length === parts.length && expectedParts.every((value,index) => value === '[id]' || value === parts[index]);
  })) return false;
  for (const [id, config] of Object.entries(NICHE_MODULES)) {
    const dedicated = [config.entry, ...config.dedicatedRoutes].map(file => file.replace(/\.tsx$/, ''));
    if (dedicated.includes(route) && id !== niche) return false;
  }
  return true;
}


/** Resolve the first authenticated destination. The unbranded owner installation
 * is the private control centre; a branded niche APK remains in its own niche. */
export function getAuthenticatedHomeRoute(options: {
  isMasterAdmin: boolean;
  fixedNicheId: string | null;
  activeNicheId: string | null;
  onboardingRequired: boolean;
}): string {
  if (options.isMasterAdmin && !options.fixedNicheId) return '/swish';
  if (options.onboardingRequired) return '/onboarding';
  return nicheToEntryRoute(options.fixedNicheId ?? options.activeNicheId) ?? '/swish';
}
