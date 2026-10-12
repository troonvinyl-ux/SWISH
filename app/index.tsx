// SWISH app/index.tsx — authentication + onboarding router
// Routes:
//   Not logged in → /login
//   Logged in, onboarding incomplete → /onboarding
//   Logged in, onboarding complete → /(tabs)

import { AuthRouter } from '@/template';
import { Redirect } from 'expo-router';
import { useApp } from '@/hooks/useApp';
import { View, ActivityIndicator } from 'react-native';
import { Colors } from '@/constants/theme';

function AppRouter() {
  const { businessConfig, tenantLoading } = useApp();

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

  return <Redirect href="/(tabs)" />;
}

export default function RootScreen() {
  return (
    <AuthRouter loginRoute="/login" excludeRoutes={[]}>
      <AppRouter />
    </AuthRouter>
  );
}
