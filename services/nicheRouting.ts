import { NICHE_MODULES, type ProductionNicheId } from '@/constants/niches';

export type ProductEntryRoute = `/entry/${string}`;

/** Exact, registered aliases only. Never classify an unknown ID by substring. */
export function resolveProductionNiche(value: string | null | undefined): ProductionNicheId | null {
  if (typeof value !== 'string') return null;
  const id = value.trim().toLowerCase();
  for (const [niche, config] of Object.entries(NICHE_MODULES)) {
    if (id === niche || config.aliases.includes(id)) return niche as ProductionNicheId;
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
  switch (niche) {
    case 'coins': return '/coin-flipper?tab=capture';
    case 'motocross': return '/flipper-mx';
    case 'bicycles': return '/bike-flipper';
    case 'clothing': return '/threads-flip?tab=identify';
    case 'surplus_flip': return '/surplus-flip';
    case 'antiques': return '/antique-capture';
    default: return '/capture';
  }
}

export function isRouteAllowedForBuild(pathname: string, fixedNiche: string | null): boolean {
  if (!fixedNiche) return true;
  const niche = resolveProductionNiche(fixedNiche);
  if (!niche) return false;
  const route = pathname.split('?')[0].replace(/^\//, '').replace(/\/$/, '');
  if (['niche-select', 'master-admin'].includes(route)) return false;
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
  if (options.isMasterAdmin && !options.fixedNicheId) return '/master-admin';
  if (options.onboardingRequired) return '/onboarding';
  return nicheToEntryRoute(options.fixedNicheId ?? options.activeNicheId) ?? '/niche-select';
}
