import { View, Text, StyleSheet } from 'react-native';
import { useApp } from '@/hooks/useApp';
import { NICHE_MODULES, isProductionNiche } from '@/constants/niches';
import { Colors, Spacing, Radius, Typography } from '@/constants/theme';
interface MembershipSummaryProps {}
export function MembershipSummary(_props: MembershipSummaryProps) {
  const { enabledNiches, isMasterAdmin } = useApp();
  return <View style={styles.panel}><Text style={styles.title}>{isMasterAdmin ? 'Trusted owner access' : 'Verified memberships'}</Text>{enabledNiches.filter(isProductionNiche).map(id => <Text key={id} style={styles.body}>{NICHE_MODULES[id].name}</Text>)}<Text style={styles.body}>Memberships are verified server-side. Business preferences cannot grant paid or administrative access.</Text></View>;
}
const styles = StyleSheet.create({ panel: { marginHorizontal: Spacing.base, padding: Spacing.base, gap: Spacing.sm, backgroundColor: Colors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceBorder }, title: { color: Colors.primary, fontSize: Typography.size.base, fontWeight: Typography.weight.semibold }, body: { color: Colors.textSecondary, fontSize: Typography.size.base, lineHeight: 26 } });
