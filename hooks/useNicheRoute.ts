import { usePathname } from 'expo-router';
import { useApp } from './useApp';
import { isRouteAllowedForBuild } from '@/services/nicheRouting';

export function useNicheRoute() {
  const pathname = usePathname();
  const { fixedNicheId, activeNiche } = useApp();
  return { allowed: isRouteAllowedForBuild(pathname, fixedNicheId), productName: activeNiche.name };
}
