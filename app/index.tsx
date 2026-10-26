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
import { nicheToEntryRoute } from '@/services/nicheRouting';

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
    return <Redirect href={"/onboarding" as any} />;
  }

  // Fail closed: an unset/unknown niche must never silently open Coins.
  // Ask the user to select a product until a registered niche is available.
  const entryRoute = nicheToEntryRoute(activeNicheId);
  if (!entryRoute) return <Redirect href={"/niche-select" as any} />;

  // Route to the correct niche-specific entry point.
  return <Redirect href={entryRoute as any} />;
}

export default function RootScreen() {
  return (
    <AuthRouter loginRoute="/login" excludeRoutes={[]}>
      <AppRouter />
    </AuthRouter>
  );
}
