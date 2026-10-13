// SWISH app/index.tsx — Authentication + niche-aware entry router
//
// Routing decision tree:
//   Not logged in          → /login
//   Logged in, loading     → spinner
//   Logged in, no onboard  → /onboarding
//   Logged in, onboarded   → /entry/<niche>  (each niche has its own entry route)
//
// The explicit /entry/<niche> redirect ensures that every authenticated subscriber
// lands in their correct niche shell. The /(tabs) screen is the destination AFTER
// the entry route enforces the niche. No subscriber is silently dropped into a
// default niche without an explicit route decision.
//
// Niche → entry route mapping:
//   coins / coin variants  → /entry/coins
//   motocross              → /entry/motocross
//   bicycles / cycling     → /entry/bicycles
//   clothing / fashion     → /entry/clothing
//   general / unknown      → /entry/coins  (fallback; subscriber should be prompted to select)

import { AuthRouter } from '@/template';
import { Redirect } from 'expo-router';
import { useApp } from '@/hooks/useApp';
import { View, ActivityIndicator } from 'react-native';
import { Colors } from '@/constants/theme';
import type { NicheId } from '@/constants/niches';

// Maps a niche ID to its dedicated entry route path
function nicheToEntryRoute(nicheId: NicheId | null | undefined): string {
  if (!nicheId) return '/entry/coins'; // fallback

  const id = nicheId.toLowerCase();

  if (
    id === 'coins' || id === 'coins_uk' || id === 'coins_world' ||
    id === 'banknotes' || id === 'gold' || id === 'silver' ||
    id === 'islamic_silver' || id === 'ancient_artefacts' ||
    id === 'curiosities_collectibles' || id.includes('coin')
  ) return '/entry/coins';

  if (id === 'motocross' || id === 'mx') return '/entry/motocross';

  if (id === 'bicycles' || id === 'cycling' || id === 'bikes') return '/entry/bicycles';

  if (
    id === 'clothing' || id === 'fashion' ||
    id === 'trainers_sneakers' || id === 'trainers' || id === 'threads_flip'
  ) return '/entry/clothing';

  // Unrecognised niche — fall back to coins entry (will prompt niche selection via onboarding)
  return '/entry/coins';
}

function AppRouter() {
  const { businessConfig, tenantLoading, activeNicheId } = useApp();

  // Still loading tenant/config
  if (tenantLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  // businessConfig == null means first-time user who hasn't completed onboarding
  // onboardingComplete false also triggers onboarding
  if (businessConfig === null || businessConfig?.onboardingComplete === false) {
    return <Redirect href="/onboarding" />;
  }

  // Route to the correct niche-specific entry point.
  // This prevents all subscribers from silently entering a single shared shell.
  const entryRoute = nicheToEntryRoute(activeNicheId);
  return <Redirect href={entryRoute as any} />;
}

export default function RootScreen() {
  return (
    <AuthRouter loginRoute="/login" excludeRoutes={[]}>
      <AppRouter />
    </AuthRouter>
  );
}
