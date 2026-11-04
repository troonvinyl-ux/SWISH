import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Redirect } from 'expo-router';
import { useModuleEntry } from '@/hooks/useModuleEntry';
import type { ProductionNicheId } from '@/constants/niches';
import { Colors } from '@/constants/theme';
interface ModuleEntryProps { nicheId: ProductionNicheId }
export function ModuleEntry({ nicheId }: ModuleEntryProps) {
  const { permitted, ready, error } = useModuleEntry(nicheId);
  if (!permitted || error) return <Redirect href={'/swish' as any} />;
  if (ready) return <Redirect href={'/(tabs)' as any} />;
  return <View style={styles.screen}><ActivityIndicator color={Colors.primary} /></View>;
}
const styles = StyleSheet.create({ screen: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.background } });
