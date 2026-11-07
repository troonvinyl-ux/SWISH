import { memo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { usePerformanceExport } from '@/hooks/usePerformanceExport';
import { Colors, Spacing, Radius, Typography } from '@/constants/theme';
interface PerformanceExportPanelProps { enabled: boolean }
export const PerformanceExportPanel = memo(function PerformanceExportPanel({ enabled }: PerformanceExportPanelProps) {
 const state = usePerformanceExport(enabled);
 if (!enabled) return null;
 return <View style={s.panel}>
  <View style={s.header}><MaterialIcons name="query-stats" size={24} color={Colors.primary}/><Text style={s.title}>Performance evidence</Text></View>
  <Text style={s.body}>Download aggregate diagnostics from the current runtime and existing backend measurements. Fresh owner verification is required for each export.</Text>
  <View style={s.rows}>
   <View style={s.row}><Text style={s.label}>SQL</Text><Text style={s.detail}>Archived before / after · 5 samples each</Text></View>
   <View style={s.row}><Text style={s.label}>Network</Text><Text style={s.detail}>Current runtime · latest 500 operations</Text></View>
   <View style={s.row}><Text style={s.label}>Edge / sync</Text><Text style={s.detail}>Recorded durations · last 7 days</Text></View>
   <View style={s.row}><Text style={s.label}>Capture → live</Text><Text style={s.detail}>Confirmed Quick List evidence · 30 days</Text></View>
  </View>
  <Text style={s.body}>Each timing cohort includes sample counts, median and P90. Unmeasured durations stay null. Client read latency is never labelled SQL time.</Text>
  <Text style={s.note}>No credentials, personal identifiers, item payloads or raw errors. This read-only export does not call eBay or run a new benchmark.</Text>
  <Pressable accessibilityRole="button" accessibilityLabel="Export owner-only performance diagnostics as JSON" accessibilityState={{ disabled: state.busy, busy: state.busy }} disabled={state.busy} onPress={() => { void state.exportJson(); }} style={({ pressed }) => [s.action, pressed || state.busy ? s.pressed : null]}>
   {state.busy ? <ActivityIndicator color={Colors.textInverse}/> : <MaterialIcons name="file-download" size={24} color={Colors.textInverse}/>}
   <Text style={s.actionText}>{state.busy ? 'Preparing verified export…' : 'Export performance JSON'}</Text>
  </Pressable>
  {state.error ? <View accessibilityRole="alert" style={s.feedback}><MaterialIcons name="error-outline" size={20} color={Colors.warning}/><Text style={s.error}>{state.error}</Text></View> : null}
  {state.message ? <Text accessibilityLiveRegion="polite" style={s.body}>{state.message}</Text> : null}
 </View>;
});
const s = StyleSheet.create({
 panel: { padding: Spacing.base, gap: Spacing.base, backgroundColor: Colors.surface, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.surfaceBorder },
 header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
 title: { flex: 1, color: Colors.textPrimary, fontSize: Typography.size.lg, fontWeight: Typography.weight.semibold, includeFontPadding: false },
 body: { color: Colors.textSecondary, fontSize: Typography.size.base, lineHeight: Typography.size.base * Typography.lineHeight.relaxed, includeFontPadding: false },
 rows: { borderTopWidth: 1, borderTopColor: Colors.surfaceBorder },
 row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', paddingVertical: Spacing.md, gap: Spacing.sm, borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder },
 label: { minWidth: 112, color: Colors.textPrimary, fontSize: Typography.size.base, fontWeight: Typography.weight.medium },
 detail: { flexGrow: 1, flexShrink: 1, color: Colors.textSecondary, fontSize: Typography.size.sm, lineHeight: 22 },
 note: { color: Colors.textSecondary, fontSize: Typography.size.sm, lineHeight: 22 },
 action: { minHeight: 48, padding: Spacing.base, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.primary, borderRadius: Radius.md },
 actionText: { color: Colors.textInverse, fontSize: Typography.size.base, fontWeight: Typography.weight.semibold, flexShrink: 1, textAlign: 'center' },
 pressed: { opacity: 0.65, transform: [{ scale: 0.99 }] },
 feedback: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
 error: { flex: 1, color: Colors.warning, fontSize: Typography.size.base, lineHeight: 26 },
});
