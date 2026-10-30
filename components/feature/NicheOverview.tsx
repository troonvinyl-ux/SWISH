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
import { getSpecialistProfile } from '@/shared/specialistIntelligence';
import { BrandArtwork } from './BrandArtwork';

interface NicheOverviewProps {}
/** Configuration-driven home for products without an existing dedicated screen. */
export const NicheOverview = memo(function NicheOverview(_props: NicheOverviewProps) {
  const { activeNiche, fixedNicheId, activeNicheId } = useApp();
  const { items, stats, syncError, loading, reload } = useInventory();
  const router = useRouter();
  const id = resolveProductionNiche(fixedNicheId ?? activeNicheId);
  const profile = id ? getSpecialistProfile(id) : null;
  return <SafeAreaView edges={['top']} style={styles.screen}>
    <FlatList data={items} keyExtractor={item => item.id} refreshing={loading} onRefresh={reload}
      contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}
      ListHeaderComponent={<View style={styles.hero}>
        {id ? <BrandArtwork nicheId={id}/> : <Text style={styles.title}>{activeNiche.name}</Text>}
        <Text style={styles.body}>Find the value in your next discovery. Scan it, check it, get it ready to sell.</Text>
        <Text style={styles.body}>{stats.activeTotal} active · {stats.soldCount} sold</Text>
        <Pressable onPress={() => router.push('/(tabs)/scan')} style={({ pressed }) => [styles.button, { backgroundColor: activeNiche.color, opacity: pressed ? 0.8 : 1 }]}>
          <Text style={styles.buttonText}>{activeNiche.terms.scan}</Text>
        </Pressable>
        {syncError ? <Text style={styles.error}>{syncError}</Text> : null}
        {profile ? <Pressable onPress={()=>router.push('/capture')} style={({pressed})=>[styles.card,{opacity:pressed?0.7:1}]}><MaterialIcons name="photo-camera" size={24} color={Colors.primary}/><Text style={styles.section}>Found something interesting?</Text><Text style={styles.body}>A few clear photos can help you work out what it is and whether it is worth buying.</Text></Pressable> : null}
        {id === 'trading_cards' ? <Pressable onPress={()=>router.push('/card-grading' as any)} style={({ pressed })=>[styles.card,{ opacity:pressed ? 0.7 : 1 }]}><MaterialIcons name="style" size={24} color={Colors.primary}/><Text style={styles.section}>Raw versus graded</Text><Text style={styles.body}>Is grading worth it? Compare possible sale prices and the cost of getting it graded. A professional grade is never guaranteed.</Text></Pressable> : null}
        <Pressable onPress={()=>router.push('/lot-opportunity' as any)} style={({ pressed })=>[styles.card,{ opacity:pressed ? 0.7 : 1 }]}><MaterialIcons name="account-tree" size={24} color={Colors.primary}/><Text style={styles.section}>Big lot. Worth the buy?</Text><Text style={styles.body}>Add the product list and bid. See your limit, possible profit and the best way to sell.</Text></Pressable>
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
  screen: { flex: 1, backgroundColor: Colors.background }, content: { padding: Spacing.base, gap: Spacing.md, paddingBottom: Spacing.xl, maxWidth:960, width:'100%', alignSelf:'center' },
  hero: { gap: Spacing.md, marginBottom: Spacing.lg }, title: { fontSize: Typography.size.xl, color: Colors.textPrimary, fontWeight: Typography.weight.bold },
  body: { fontSize: Typography.size.base, color: Colors.textSecondary, lineHeight: 26 }, section: { fontSize: Typography.size.lg, color: Colors.textPrimary, fontWeight: Typography.weight.semibold },
  button: { minHeight: 48, padding: Spacing.md, borderRadius: Radius.md, alignItems: 'center' }, buttonText: { fontSize: Typography.size.base, color: Colors.background, fontWeight: Typography.weight.bold },
  card: { padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surface, gap: Spacing.sm }, itemTitle: { color: Colors.textPrimary, fontSize: Typography.size.base, fontWeight: Typography.weight.semibold }, error: { color: Colors.danger, fontSize: Typography.size.base },
});
