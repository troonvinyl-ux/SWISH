import type { ReactNode } from 'react';
import { StyleSheet, View, Text, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useNicheRoute } from '@/hooks/useNicheRoute';
import { Colors, Spacing, Typography, Radius } from '@/constants/theme';

interface NicheRouteBoundaryProps { children: ReactNode }
export function NicheRouteBoundary({ children }: NicheRouteBoundaryProps) {
  const { allowed, loading, moduleLoading } = useNicheRoute();
  const router = useRouter();
  // Stack must stay mounted during authorization and module transitions.
  // The full-screen overlay hides and blocks denied UI; backend RLS remains the security boundary.
  return <View style={styles.container}>
    <View style={[styles.container, !allowed && !loading && !moduleLoading ? styles.hidden : null]} pointerEvents={loading || moduleLoading || !allowed ? 'none' : 'auto'} accessibilityElementsHidden={loading || moduleLoading || !allowed} importantForAccessibility={loading || moduleLoading || !allowed ? 'no-hide-descendants' : 'auto'}>{children}</View>
    {loading || moduleLoading ? <SafeAreaView style={[styles.screen, styles.overlay]}><ActivityIndicator color={Colors.primary} /><Text style={styles.body}>Opening your specialist workspace…</Text></SafeAreaView> : !allowed ? <SafeAreaView style={[styles.screen, styles.overlay]}>
    <View style={styles.panel}>
      <Text style={styles.title}>Unavailable in this application</Text>
      <Text style={styles.body}>Select an entitled specialist workspace. Administrative facilities require a verified backend owner role.</Text>
      <Pressable onPress={() => router.replace('/')} style={({ pressed }) => [styles.button, { opacity: pressed ? 0.8 : 1 }]}>
        <Text style={styles.buttonText}>Return to this app</Text>
      </Pressable>
    </View>
  </SafeAreaView> : null}
  </View>;
}
const styles = StyleSheet.create({
  container: { flex: 1 }, hidden: { opacity: 0 }, overlay: { ...StyleSheet.absoluteFillObject, zIndex: 100, gap: Spacing.base },
  screen: { flex: 1, backgroundColor: Colors.background, justifyContent: 'center', padding: Spacing.lg },
  panel: { gap: Spacing.md, backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: Spacing.lg },
  title: { color: Colors.textPrimary, fontSize: Typography.size.xl, fontWeight: Typography.weight.bold },
  body: { color: Colors.textSecondary, fontSize: Typography.size.base, lineHeight: 26 },
  button: { padding: Spacing.md, backgroundColor: Colors.primary, borderRadius: Radius.md, minHeight: 48, alignItems: 'center' },
  buttonText: { color: Colors.background, fontSize: Typography.size.base, fontWeight: Typography.weight.semibold },
});
