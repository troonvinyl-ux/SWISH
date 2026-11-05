import { AuthRouter } from '@/template';
import { Redirect } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';
import { describeAccessFailure } from '@/services/backendAvailabilityService';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useApp } from '@/hooks/useApp';
import { membershipDestination } from '@/services/moduleAccessService';
import { Colors, Spacing, Typography, Radius } from '@/constants/theme';
function MembershipRouter() {
  const app = useApp();
  const failure = describeAccessFailure(app.tenantError ?? app.accessError);
  if (app.tenantLoading || app.nichePreferencesLoading || app.moduleLoading || (!app.accessReady && app.subscriptionLoading)) return <SafeAreaView style={styles.screen}><ActivityIndicator color={Colors.primary} /><Text style={styles.body}>Verifying your specialist access…</Text></SafeAreaView>;
  if (app.tenantError || app.accessError || !app.accessReady) return <SafeAreaView style={styles.screen}><Text style={styles.title}>{failure.title}</Text><Text accessibilityRole="alert" style={styles.body}>{failure.message}</Text><Pressable accessibilityLabel={failure.retryLabel} onPress={() => { void (app.tenant ? app.refreshSubscription() : app.reloadTenant()); }} style={({ pressed }) => [styles.button, { opacity: pressed ? 0.7 : 1 }]}><Text style={styles.buttonText}>{failure.retryLabel}</Text></Pressable></SafeAreaView>;
  const destination = app.fixedNicheId && app.activeNicheId === app.fixedNicheId ? '/(tabs)' : membershipDestination(app.enabledNiches, app.isMasterAdmin, app.activeNicheId);
  return <Redirect href={destination as any} />;
}
export default function RootScreen() { return <AuthRouter loginRoute="/login"><MembershipRouter /></AuthRouter>; }
const styles = StyleSheet.create({ screen: { flex: 1, backgroundColor: Colors.background, padding: Spacing.xl, justifyContent: 'center', alignItems: 'center', gap: Spacing.base }, title: { color: Colors.textPrimary, fontSize: Typography.size.lg, fontWeight: Typography.weight.bold }, body: { color: Colors.textSecondary, fontSize: Typography.size.base, lineHeight: 26, textAlign: 'center' }, button: { minHeight: 48, borderRadius: Radius.md, padding: Spacing.base, backgroundColor: Colors.primary }, buttonText: { color: Colors.textInverse, fontSize: Typography.size.base, fontWeight: Typography.weight.semibold } });
