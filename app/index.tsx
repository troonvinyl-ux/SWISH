// SWISH app/index.tsx — Authentication + niche-aware entry router
//
// Subscriber installs enter their own niche. The dedicated Master Admin build
// enters the owner console directly after authentication and account loading.

import Constants from 'expo-constants';
import { AuthRouter } from '@/template';
import { Redirect } from 'expo-router';
import { useApp } from '@/hooks/useApp';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import { Colors } from '@/constants/theme';
import { nicheToEntryRoute } from '@/services/nicheRouting';

function AppRouter() {
  const {
    businessConfig, tenantLoading, tenantError, nichePreferencesLoading,
    activeNicheId, fixedNicheId, isMasterAdmin,
  } = useApp();
  const isMasterAdminBuild = Constants.expoConfig?.extra?.swishMasterAdminBuild === true;

  // Wait until auth, tenant and niche state have settled before routing.
  if (tenantLoading || nichePreferencesLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  if (tenantError) return <AccountLoadError />;

  // A dedicated Master Admin APK must open the owner console, not the default
  // Coins workspace or subscriber onboarding. The screen itself independently
  // checks the signed-in owner account and redirects everyone else.
  if (isMasterAdminBuild && isMasterAdmin) {
    return <Redirect href={"/master-admin" as any} />;
  }

  // businessConfig == null means first-time subscriber who has not completed onboarding.
  if (businessConfig === null || businessConfig?.onboardingComplete === false) {
    return <Redirect href={"/onboarding" as any} />;
  }

  // Branded APK identity takes precedence over account preferences.
  const entryRoute = nicheToEntryRoute(fixedNicheId ?? activeNicheId);
  if (!entryRoute) return <Redirect href={"/niche-select" as any} />;
  return <Redirect href={entryRoute as any} />;
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
