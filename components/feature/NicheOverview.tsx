import { memo } from 'react';
import { View, Text, Pressable, FlatList, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useApp } from '@/hooks/useApp';
import { useInventory } from '@/hooks/useInventory';
import { Colors, Spacing, Typography, Radius } from '@/constants/theme';
import { resolveProductionNiche, nicheToScannerRoute } from '@/services/nicheRouting';
import { getSpecialistProfile } from '@/shared/specialistIntelligence';
import { getNicheHomeExperience } from '@/services/nicheHomeExperience';
import { BrandArtwork } from './BrandArtwork';

interface NicheOverviewProps {}
/** Configuration-led specialist home for products that do not yet have a bespoke legacy dashboard. */
export const NicheOverview = memo(function NicheOverview(_props: NicheOverviewProps) {
  const { activeNiche, fixedNicheId, activeNicheId } = useApp();
  const { items, stats, syncError, loading, reload } = useInventory();
  const router = useRouter();
  const id = resolveProductionNiche(fixedNicheId ?? activeNicheId);
  const profile = id ? getSpecialistProfile(id) : null;
  const experience = getNicheHomeExperience(id);
  const scannerRoute = nicheToScannerRoute(id);

  return <SafeAreaView edges={['top']} style={styles.screen}>
    <FlatList data={items} keyExtractor={item => item.id} refreshing={loading} onRefresh={reload}
      contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}
      ListHeaderComponent={<View style={styles.header}>
        <View style={styles.hero}>
          {id ? <BrandArtwork nicheId={id}/> : <Text style={styles.title}>{activeNiche.name}</Text>}
          <Text style={styles.headline}>{experience?.headline ?? activeNiche.tagline}</Text>
          <Text style={styles.body}>{activeNiche.description}</Text>
          <View style={styles.statsRow}>
            <View style={styles.stat}><Text style={styles.statValue}>{stats.activeTotal}</Text><Text style={styles.statLabel}>ACTIVE</Text></View>
            <View style={styles.statDivider}/>
            <View style={styles.stat}><Text style={styles.statValue}>{stats.soldCount}</Text><Text style={styles.statLabel}>SOLD</Text></View>
          </View>
          <Pressable onPress={() => router.push(scannerRoute as any)} style={({ pressed }) => [styles.button, { backgroundColor: activeNiche.color, opacity: pressed ? 0.82 : 1 }]} accessibilityRole="button">
            <MaterialIcons name="photo-camera" size={20} color={Colors.background}/>
            <Text style={styles.buttonText}>{activeNiche.terms.scan}</Text>
            <MaterialIcons name="arrow-forward" size={18} color={Colors.background}/>
          </Pressable>
          {syncError ? <Text style={styles.error}>{syncError}</Text> : null}
        </View>

        {experience ? <View style={styles.sectionCard}>
          <View style={styles.sectionHeading}><MaterialIcons name="fact-check" size={21} color={activeNiche.color}/><Text style={styles.section}>{experience.focusTitle}</Text></View>
          <Text style={styles.body}>{experience.focusBody}</Text>
          {experience.evidenceChecks.map((check, index) => <View key={check} style={styles.checkRow}>
            <View style={[styles.checkNumber, { backgroundColor: activeNiche.color + '22' }]}><Text style={[styles.checkNumberText, { color: activeNiche.color }]}>{index + 1}</Text></View>
            <Text style={styles.body}>{check}</Text>
          </View>)}
        </View> : null}

        {profile ? <View style={styles.sectionCard}>
          <View style={styles.sectionHeading}><MaterialIcons name="psychology" size={21} color={activeNiche.color}/><Text style={styles.section}>Specialist intelligence</Text></View>
          <Text style={styles.body}>{profile.focus}</Text>
          <Text style={styles.subheading}>CONDITION RULES</Text>
          <Text style={styles.body}>{profile.conditionRules}</Text>
        </View> : null}

        {experience ? <View style={[styles.cautionCard, { borderColor: activeNiche.color + '55' }]}><View style={styles.sectionHeading}><MaterialIcons name="verified-user" size={21} color={activeNiche.color}/><Text style={styles.section}>{experience.cautionTitle}</Text></View><Text style={styles.body}>{experience.cautionBody}</Text></View> : null}

        <View style={styles.sectionCard}>
          <View style={styles.sectionHeading}><MaterialIcons name="flash-on" size={21} color={activeNiche.color}/><Text style={styles.section}>Quick actions</Text></View>
          <View style={styles.actionsGrid}>
            {activeNiche.quickActions.map(action => <Pressable key={action.label} onPress={() => router.push(action.route as any)} style={({ pressed }) => [styles.action, { borderColor: activeNiche.color + '30', opacity: pressed ? 0.75 : 1 }]}><MaterialIcons name={action.icon as any} size={20} color={activeNiche.color}/><Text style={styles.actionLabel}>{action.label}</Text><MaterialIcons name="chevron-right" size={18} color={Colors.textTertiary}/></Pressable>)}
          </View>
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.section}>What matters in this niche</Text>
          <View style={styles.chips}>{activeNiche.keyAttributes.map(attribute => <View key={attribute} style={[styles.chip, { borderColor: activeNiche.color + '55' }]}><Text style={styles.chipText}>{attribute.replace(/_/g, ' ')}</Text></View>)}</View>
          <Text style={styles.subheading}>WHERE TO SOURCE</Text>
          <Text style={styles.body}>{activeNiche.acquisitionSources.join(' · ')}</Text>
          <Text style={styles.subheading}>MARKETPLACES</Text>
          <Text style={styles.body}>{activeNiche.marketplaces.join(' · ')}</Text>
        </View>

        <Text style={styles.section}>Current inventory</Text>
      </View>}
      renderItem={({ item }) => <Pressable onPress={() => router.push(`/item/${item.id}` as any)} style={({ pressed }) => [styles.itemCard, { opacity: pressed ? 0.8 : 1 }]}><Text style={styles.itemTitle}>{item.canonicalTitle}</Text><Text style={styles.body}>{item.condition || 'Condition not assessed'} · {item.status}</Text></Pressable>}
      ListEmptyComponent={<Text style={styles.body}>{loading ? 'Loading inventory…' : `No active ${activeNiche.terms.items.toLowerCase()} in this niche. Capture your first find to begin.`}</Text>}
    />
  </SafeAreaView>;
});

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.base, gap: Spacing.md, paddingBottom: Spacing.xl, maxWidth: 960, width: '100%', alignSelf: 'center' },
  header: { gap: Spacing.md },
  hero: { gap: Spacing.md, marginBottom: Spacing.sm, padding: Spacing.md, borderRadius: Radius.xl, backgroundColor: Colors.surface },
  title: { fontSize: Typography.size.xl, color: Colors.textPrimary, fontWeight: Typography.weight.bold },
  headline: { fontSize: Typography.size.xl, color: Colors.textPrimary, fontWeight: Typography.weight.bold, lineHeight: 30 },
  body: { fontSize: Typography.size.base, color: Colors.textSecondary, lineHeight: 24 },
  statsRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xl, paddingVertical: Spacing.sm },
  stat: { gap: 2 }, statValue: { fontSize: Typography.size.xl, color: Colors.textPrimary, fontWeight: Typography.weight.bold },
  statLabel: { fontSize: 9, color: Colors.textTertiary, fontWeight: Typography.weight.bold, letterSpacing: 1.2 },
  statDivider: { width: 1, height: 30, backgroundColor: Colors.surfaceBorder },
  button: { minHeight: 52, paddingHorizontal: Spacing.base, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'space-between', flexDirection: 'row' },
  buttonText: { fontSize: Typography.size.base, color: Colors.background, fontWeight: Typography.weight.bold, flex: 1, textAlign: 'center' },
  error: { color: Colors.danger, fontSize: Typography.size.sm },
  sectionCard: { padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surface, gap: Spacing.md },
  cautionCard: { padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surface, borderWidth: 1, gap: Spacing.md },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  section: { fontSize: Typography.size.lg, color: Colors.textPrimary, fontWeight: Typography.weight.semibold },
  subheading: { fontSize: 9, color: Colors.textTertiary, fontWeight: Typography.weight.bold, letterSpacing: 1.1 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  checkNumber: { width: 24, height: 24, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center' },
  checkNumberText: { fontSize: 11, fontWeight: Typography.weight.bold },
  actionsGrid: { gap: Spacing.sm },
  action: { minHeight: 48, borderRadius: Radius.md, borderWidth: 1, paddingHorizontal: Spacing.md, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  actionLabel: { flex: 1, fontSize: Typography.size.sm, color: Colors.textPrimary, fontWeight: Typography.weight.semibold },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip: { borderWidth: 1, borderRadius: Radius.pill, paddingHorizontal: Spacing.md, paddingVertical: 6 },
  chipText: { color: Colors.textSecondary, fontSize: Typography.size.xs, textTransform: 'capitalize' },
  itemCard: { padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surface, gap: Spacing.xs },
  itemTitle: { color: Colors.textPrimary, fontSize: Typography.size.base, fontWeight: Typography.weight.semibold },
});