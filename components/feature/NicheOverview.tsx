import { memo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useApp } from '@/hooks/useApp';
import { resolveProductionNiche } from '@/services/nicheRouting';
import { Colors, Spacing, Typography } from '@/constants/theme';
import { SharedNicheDashboard } from './SharedNicheDashboard';

interface NicheOverviewProps {}
/** Compatibility adapter for specialist routes and existing isolated builds. */
export const NicheOverview = memo(function NicheOverview(_props: NicheOverviewProps) {
  const { activeNicheId, fixedNicheId } = useApp();
  const id = resolveProductionNiche(fixedNicheId ?? activeNicheId);
  if (id) return <SharedNicheDashboard nicheId={id} />;
  return <SafeAreaView edges={['top']} style={s.screen}><View style={s.panel}><Text style={s.title}>Choose a specialist workspace</Text><Text style={s.body}>A registered niche is required to show inventory and specialist tools.</Text></View></SafeAreaView>;
});
const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  panel: { padding: Spacing.base, gap: Spacing.base },
  title: { fontSize: Typography.size.lg, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  body: { fontSize: Typography.size.base, lineHeight: Typography.size.base * Typography.lineHeight.relaxed, color: Colors.textSecondary },
});
