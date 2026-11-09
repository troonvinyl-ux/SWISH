import { memo, useCallback } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAlert } from '@/template';
import { useAppUpdates } from '@/hooks/useAppUpdates';
import { Colors, Spacing, Radius, Typography } from '@/constants/theme';
export interface AppUpdateNoticeProps {}
export const AppUpdateNotice = memo(function AppUpdateNotice(_props: AppUpdateNoticeProps) {
  const updates = useAppUpdates(), insets = useSafeAreaInsets();
  const { showAlert } = useAlert();
  const confirmRestart = useCallback(() => {
    showAlert('Restart SWISH to update?', 'Save any capture, draft or listing edits before restarting. The compatible update has finished downloading; no APK installation is needed.', [
      { text: 'Not now', style: 'cancel' },
      { text: 'Restart now', onPress: () => { void updates.apply(); } },
    ]);
  }, [showAlert, updates.apply]);
  if (!updates.installed.otaEnabled || !['ready', 'restarting'].includes(updates.status)) return null;
  const restarting = updates.status === 'restarting';
  return <View style={[styles.area, { paddingTop: insets.top + Spacing.sm }]}>
    <View style={styles.notice} accessibilityLiveRegion="polite">
      {restarting ? <ActivityIndicator color={Colors.primary} /> : <MaterialIcons name="system-update" size={24} color={Colors.primary} />}
      <View style={styles.copy}><Text style={styles.title}>{restarting ? 'Restarting SWISH…' : 'SWISH update ready'}</Text><Text style={styles.body}>{updates.error ?? 'Save your work, then restart. No APK reinstall.'}</Text></View>
      <Pressable disabled={restarting} accessibilityRole="button" accessibilityLabel="Restart SWISH to apply the downloaded update" onPress={confirmRestart} style={({ pressed }) => [styles.button, pressed || restarting ? styles.pressed : null]}><Text style={styles.buttonText}>Restart</Text></Pressable>
    </View>
  </View>;
});
const styles = StyleSheet.create({
  area: { paddingHorizontal: Spacing.base, paddingBottom: Spacing.sm, backgroundColor: Colors.background },
  notice: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.md, backgroundColor: Colors.surfaceElevated, borderWidth: 1, borderColor: Colors.primary, borderRadius: Radius.lg, maxWidth: 960, width: '100%', alignSelf: 'center' },
  copy: { flex: 1 },
  title: { color: Colors.primary, fontSize: Typography.size.base, fontWeight: Typography.weight.semibold, includeFontPadding: false },
  body: { color: Colors.textSecondary, fontSize: Typography.size.base, lineHeight: 26, includeFontPadding: false },
  button: { minWidth: 48, minHeight: 48, justifyContent: 'center', paddingHorizontal: Spacing.md, borderRadius: Radius.md, backgroundColor: Colors.primary },
  buttonText: { color: Colors.textInverse, fontSize: Typography.size.base, fontWeight: Typography.weight.semibold, includeFontPadding: false },
  pressed: { opacity: 0.65 },
});
