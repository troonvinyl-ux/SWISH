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
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import { Colors } from '@/constants/theme';
import { getAuthenticatedHomeRoute } from '@/services/nicheRouting';

function AppRouter() {
  const { businessConfig, tenantLoading, tenantError, nichePreferencesLoading, activeNicheId, fixedNicheId, isMasterAdmin } = useApp();

  // Still loading tenant/config
  if (tenantLoading || nichePreferencesLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  if (tenantError) return <AccountLoadError />;

  // The unbranded installation is the private Master Admin app for the owner.
  // Branded niche installations keep their fixed niche destination, even when
  // the owner account is signed in, so Coin Flipper cannot capture the admin APK.
  const destination = getAuthenticatedHomeRoute({
    isMasterAdmin,
    fixedNicheId,
    activeNicheId,
    onboardingRequired: businessConfig === null || businessConfig?.onboardingComplete === false,
  });
  return <Redirect href={destination as any} />;
}

function AccountLoadError() {
  const { tenantError, reloadTenant } = useApp();
  return <View style={{ flex: 1, backgroundColor: Colors.background, padding: 24, justifyContent: 'center', gap: 16 }}>
    <Text style={{ color: Colors.textPrimary, fontSize: 18 }}>Account could not be loaded</Text>
    <Text style={{ color: Colors.textSecondary, fontSize: 16 }}>{tenantError}</Text>
    <Pressable onPress={() => { void reloadTenant(); }} style={({ pressed }) => ({ padding: 16, backgroundColor: Colors.primary, opacity: pressed ? 0.8 : 1 })}><Text style={{ color: Colors.background }}>Retry</Text></Pressable>
  </View>;
}

export default function RootScreen() {
  return (
    <AuthRouter loginRoute="/login" excludeRoutes={[]}>
      <AppRouter />
    </AuthRouter>
  );
}
