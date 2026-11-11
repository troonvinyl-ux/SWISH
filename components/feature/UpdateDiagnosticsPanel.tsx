import { memo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useUpdateDiagnostics } from '@/hooks/useUpdateDiagnostics';
import { Colors, Radius, Spacing, Typography } from '@/constants/theme';

interface UpdateDiagnosticsPanelProps {}
export const UpdateDiagnosticsPanel = memo(function UpdateDiagnosticsPanel(_props: UpdateDiagnosticsPanelProps) {
  const diagnostics = useUpdateDiagnostics();
  return <View style={s.panel}>
    <Text style={s.title}>Update diagnostics</Text>
    <Text style={s.body}>Share public version, build, project, channel, runtime and update IDs to compare with your GitHub APK release. No secrets or account details.</Text>
    {diagnostics.canShare ? <Pressable accessibilityRole="button" accessibilityLabel="Share SWISH update diagnostics report" accessibilityState={{ disabled: diagnostics.busy }} disabled={diagnostics.busy} onPress={() => { void diagnostics.share(); }} style={({ pressed }) => [s.action, pressed || diagnostics.busy ? s.pressed : null]}>
      {diagnostics.busy ? <ActivityIndicator color={Colors.primary} /> : <MaterialIcons name="share" size={22} color={Colors.primary} />}
      <Text style={s.actionText}>{diagnostics.busy ? 'Opening share sheet…' : 'Share diagnostics report'}</Text>
    </Pressable> : <Text style={s.body}>Browser preview: view and select the report text to copy. Use the installed Android app for APK diagnostics and system sharing.</Text>}
    <Pressable accessibilityRole="button" accessibilityLabel={diagnostics.expanded ? 'Hide update diagnostics report' : 'View update diagnostics report'} accessibilityState={{ expanded: diagnostics.expanded, disabled: diagnostics.busy }} disabled={diagnostics.busy} onPress={diagnostics.toggleReport} style={({ pressed }) => [s.action, pressed || diagnostics.busy ? s.pressed : null]}>
      <MaterialIcons name={diagnostics.expanded ? 'expand-less' : 'description'} size={22} color={Colors.textSecondary} />
      <Text style={s.secondaryText}>{diagnostics.expanded ? 'Hide report' : 'View report'}</Text>
    </Pressable>
    {diagnostics.message ? <Text accessibilityLiveRegion="polite" style={s.body}>{diagnostics.message}</Text> : null}
    {diagnostics.error ? <View style={s.errorRow}><MaterialIcons name="error-outline" size={22} color={Colors.warning} /><Text accessibilityRole="alert" style={s.error}>{diagnostics.error}</Text></View> : null}
    {diagnostics.expanded ? <View style={s.report}><Text selectable accessibilityLabel="Public SWISH update diagnostics report" style={s.reportText}>{diagnostics.reportText}</Text></View> : null}
  </View>;
});
const s = StyleSheet.create({
  panel: { gap: Spacing.md, paddingTop: Spacing.base, borderTopWidth: 1, borderTopColor: Colors.surfaceBorder },
  title: { fontSize: Typography.size.md, fontWeight: Typography.weight.semibold, color: Colors.textPrimary, includeFontPadding: false },
  body: { fontSize: Typography.size.base, lineHeight: Typography.size.base * Typography.lineHeight.relaxed, color: Colors.textSecondary, includeFontPadding: false },
  action: { minHeight: Spacing.section, padding: Spacing.md, flexDirection: 'row', alignItems: 'center', gap: Spacing.md, borderWidth: 1, borderColor: Colors.surfaceBorder, borderRadius: Radius.md, backgroundColor: Colors.surfaceHighlight },
  actionText: { flex: 1, fontSize: Typography.size.base, fontWeight: Typography.weight.semibold, color: Colors.primary, includeFontPadding: false },
  secondaryText: { flex: 1, fontSize: Typography.size.base, fontWeight: Typography.weight.medium, color: Colors.textSecondary, includeFontPadding: false },
  pressed: { opacity: 0.65 },
  report: { padding: Spacing.base, borderRadius: Radius.sm, backgroundColor: Colors.background, borderWidth: 1, borderColor: Colors.surfaceBorder },
  reportText: { fontSize: Typography.size.base, lineHeight: Typography.size.base * Typography.lineHeight.relaxed, color: Colors.textPrimary, includeFontPadding: false },
  errorRow: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start' },
  error: { flex: 1, fontSize: Typography.size.base, lineHeight: Typography.size.base * Typography.lineHeight.relaxed, color: Colors.warning, includeFontPadding: false },
});
