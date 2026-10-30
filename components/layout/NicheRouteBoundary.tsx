import type { ReactNode } from 'react';
import { StyleSheet, View, Text, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useNicheRoute } from '@/hooks/useNicheRoute';
import { Colors, Spacing, Typography, Radius } from '@/constants/theme';

interface NicheRouteBoundaryProps { children: ReactNode }
export function NicheRouteBoundary({ children }: NicheRouteBoundaryProps) {
  const { allowed } = useNicheRoute();
  const router = useRouter();
  if (allowed) return <>{children}</>;
  return <SafeAreaView style={styles.screen}>
    <View style={styles.panel}>
      <Text style={styles.title}>Unavailable in this application</Text>
      <Text style={styles.body}>This installation is restricted to its selected product.</Text>
      <Pressable onPress={() => router.replace('/')} style={({ pressed }) => [styles.button, { opacity: pressed ? 0.8 : 1 }]}>
        <Text style={styles.buttonText}>Return to this app</Text>
      </Pressable>
    </View>
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background, justifyContent: 'center', padding: Spacing.lg },
  panel: { gap: Spacing.md, backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: Spacing.lg },
  title: { color: Colors.textPrimary, fontSize: Typography.size.xl, fontWeight: Typography.weight.bold },
  body: { color: Colors.textSecondary, fontSize: Typography.size.base, lineHeight: 26 },
  button: { padding: Spacing.md, backgroundColor: Colors.primary, borderRadius: Radius.md, minHeight: 48, alignItems: 'center' },
  buttonText: { color: Colors.background, fontSize: Typography.size.base, fontWeight: Typography.weight.semibold },
});
