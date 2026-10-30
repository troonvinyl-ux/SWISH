import { memo } from 'react';
import { View, Text, Pressable, FlatList, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useApp } from '@/hooks/useApp';
import { useInventory } from '@/hooks/useInventory';
import { Colors, Spacing, Typography, Radius } from '@/constants/theme';
import { NICHE_MODULES } from '@/constants/niches';
import { resolveProductionNiche } from '@/services/nicheRouting';

interface NicheOverviewProps {}
/** Configuration-driven home for products without an existing dedicated screen. */
export const NicheOverview = memo(function NicheOverview(_props: NicheOverviewProps) {
  const { activeNiche, fixedNicheId, activeNicheId } = useApp();
  const { items, stats, syncError, loading, reload } = useInventory();
  const router = useRouter();
  const id = resolveProductionNiche(fixedNicheId ?? activeNicheId);
  return <SafeAreaView edges={['top']} style={styles.screen}>
    <FlatList data={items} keyExtractor={item => item.id} refreshing={loading} onRefresh={reload}
      contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}
      ListHeaderComponent={<View style={styles.hero}>
        <MaterialIcons name={activeNiche.icon as any} color={activeNiche.color} size={32} />
        <Text style={styles.title}>{id ? NICHE_MODULES[id].name : activeNiche.name}</Text>
        <Text style={styles.body}>{activeNiche.tagline}</Text>
        <Text style={styles.body}>{stats.activeTotal} active · {stats.soldCount} sold</Text>
        <Pressable onPress={() => router.push('/(tabs)/scan' as any)} style={({ pressed }) => [styles.button, { backgroundColor: activeNiche.color, opacity: pressed ? 0.8 : 1 }]}>
          <Text style={styles.buttonText}>{activeNiche.terms.scan}</Text>
        </Pressable>
        {syncError ? <Text style={styles.error}>{syncError}</Text> : null}
        <Text style={styles.section}>Current inventory</Text>
      </View>}
      renderItem={({ item }) => <Pressable onPress={() => router.push(`/item/${item.id}` as any)} style={({ pressed }) => [styles.card, { opacity: pressed ? 0.8 : 1 }]}>
        <Text style={styles.itemTitle}>{item.canonicalTitle}</Text><Text style={styles.body}>{item.condition || 'Condition not assessed'} · {item.status}</Text>
      </Pressable>}
      ListEmptyComponent={<Text style={styles.body}>{loading ? 'Loading inventory…' : 'No active inventory in this niche. Capture an item to begin.'}</Text>}
    />
  </SafeAreaView>;
});
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background }, content: { padding: Spacing.lg, gap: Spacing.md, paddingBottom: Spacing.xl },
  hero: { gap: Spacing.md, marginBottom: Spacing.lg }, title: { fontSize: Typography.size.xl, color: Colors.textPrimary, fontWeight: Typography.weight.bold },
  body: { fontSize: Typography.size.base, color: Colors.textSecondary, lineHeight: 26 }, section: { fontSize: Typography.size.lg, color: Colors.textPrimary, fontWeight: Typography.weight.semibold },
  button: { minHeight: 48, padding: Spacing.md, borderRadius: Radius.md, alignItems: 'center' }, buttonText: { fontSize: Typography.size.base, color: Colors.background, fontWeight: Typography.weight.bold },
  card: { padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surface, gap: Spacing.sm }, itemTitle: { color: Colors.textPrimary, fontSize: Typography.size.base, fontWeight: Typography.weight.semibold }, error: { color: Colors.danger, fontSize: Typography.size.base },
});
