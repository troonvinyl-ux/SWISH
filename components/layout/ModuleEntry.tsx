import { ActivityIndicator, StyleSheet, Text, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Redirect, useRouter } from 'expo-router';
import { useModuleEntry } from '@/hooks/useModuleEntry';
import type { ProductionNicheId } from '@/constants/niches';
import { NICHE_MODULES } from '@/constants/niches';
import { Colors, Spacing, Typography, Radius } from '@/constants/theme';
interface ModuleEntryProps { nicheId: ProductionNicheId }
export function ModuleEntry({ nicheId }: ModuleEntryProps) {
 const { permitted, ready, waiting, error, retry } = useModuleEntry(nicheId); const router = useRouter();
 if (ready) return <Redirect href={'/(tabs)/index' as any} />;
 return <SafeAreaView style={styles.screen} edges={['top','bottom']}>
  <Text style={styles.title}>{NICHE_MODULES[nicheId].name}</Text>
  {waiting ? <><ActivityIndicator color={Colors.primary} /><Text style={styles.body}>Verifying access and loading this specialist…</Text></> : <>
   <Text accessibilityRole="alert" style={styles.body}>{error ?? (!permitted ? 'This module is not in your verified memberships.' : 'Module initialization did not complete.')}</Text>
   <Pressable onPress={() => { void retry(); }} style={({ pressed }) => [styles.button, { opacity: pressed ? 0.75 : 1 }]}><Text style={styles.buttonText}>Retry this workspace</Text></Pressable>
   <Pressable onPress={() => router.replace('/swish' as any)} style={({ pressed }) => [styles.secondary, { opacity: pressed ? 0.75 : 1 }]}><Text style={styles.body}>Choose another workspace</Text></Pressable>
  </>}
 </SafeAreaView>;
}
const styles = StyleSheet.create({ screen: { flex: 1, padding: Spacing.xl, gap: Spacing.base, justifyContent: 'center', backgroundColor: Colors.background }, title: { color: Colors.primary, fontSize: Typography.size.xl, fontWeight: Typography.weight.bold }, body: { color: Colors.textSecondary, fontSize: Typography.size.base, lineHeight: 26 }, button: { minHeight: 48, padding: Spacing.base, backgroundColor: Colors.primary, borderRadius: Radius.md, alignItems: 'center' }, buttonText: { color: Colors.textInverse, fontSize: Typography.size.base, fontWeight: Typography.weight.bold }, secondary: { minHeight: 48, padding: Spacing.base } });
