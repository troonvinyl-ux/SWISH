// SWISH app/index.tsx — authentication and fail-closed niche routing.
// Unknown/inactive niche IDs go to product selection, never a guessed product.

import { AuthRouter } from '@/template';
import { Redirect } from 'expo-router';
import { useApp } from '@/hooks/useApp';
import { View, ActivityIndicator } from 'react-native';
import { Colors } from '@/constants/theme';
import { nicheToEntryRoute } from '@/services/nicheRouting';

function AppRouter() {
  const {
    businessConfig,
    tenantLoading,
    activeNicheId,
    nichePreferencesLoading,
  } = useApp();

  // Do not render a product until both account and account-specific niche
  // preferences are loaded; this avoids briefly showing the previous account's app.
  if (tenantLoading || nichePreferencesLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  if (businessConfig === null || businessConfig?.onboardingComplete === false) {
    return <Redirect href="/onboarding" />;
  }

  const entryRoute = nicheToEntryRoute(activeNicheId);
  if (!entryRoute) return <Redirect href="/niche-select" />;
  return <Redirect href={entryRoute as any} />;
}

export default function RootScreen() {
  return (
    <AuthRouter loginRoute="/login" excludeRoutes={[]}>
      <AppRouter />
    </AuthRouter>
  );
}
