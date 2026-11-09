import { useCallback } from 'react';
import { MaterialIcons } from '@expo/vector-icons';
import { useAlert } from '@/template';
import { Pressable, StyleSheet, Text, View, ActivityIndicator, Platform } from 'react-native';
import { useAppUpdates } from '@/hooks/useAppUpdates';
import { Colors, Spacing, Radius, Typography } from '@/constants/theme';
interface AppUpdatePanelProps {}
export function AppUpdatePanel(_props: AppUpdatePanelProps) {
  const updates = useAppUpdates(); const busy = ['checking', 'downloading', 'restarting'].includes(updates.status);
  const { showAlert } = useAlert();
  const handlePrimary = useCallback(() => {
    if (Platform.OS === 'web') { updates.reloadWebsite(); return; }
    if (updates.status === 'ready') {
      showAlert('Restart SWISH to update?', 'Save any capture, draft or listing edits before restarting. No APK reinstall is needed.', [{ text: 'Not now', style: 'cancel' }, { text: 'Restart now', onPress: () => { void updates.apply(); } }]);
    } else if (updates.status === 'available') void updates.download();
    else void updates.check();
  }, [showAlert, updates]);
  return <View style={styles.panel}><Text style={styles.title}>SWISH version & updates</Text><Text selectable style={styles.body}>Version {updates.installed.version} · build {updates.installed.build ?? 'not reported'} · {updates.installed.platform}{'\n'}Channel {updates.installed.channel}{'\n'}Update support {updates.installed.otaEnabled ? 'enabled' : 'not enabled in this build'}{'\n'}Runtime {updates.installed.runtime ?? 'Not reported'}{'\n'}Update {updates.installed.updateId ?? 'Embedded native bundle'}</Text>
    <Text style={styles.state}>{updates.status.toUpperCase()}</Text>{updates.error ? <View style={styles.errorRow}><MaterialIcons name="error-outline" size={24} color={Colors.warning} /><Text accessibilityRole="alert" style={[styles.error, styles.flex]}>{updates.error}</Text></View> : null}
    <Pressable disabled={busy} onPress={handlePrimary} style={({ pressed }) => [styles.button, { opacity: busy || pressed ? 0.65 : 1 }]}>{busy ? <ActivityIndicator color={Colors.textInverse} /> : null}<Text style={styles.buttonText}>{Platform.OS === 'web' ? 'Reload hosted SWISH' : updates.status === 'ready' ? 'Restart to apply update' : updates.status === 'available' ? 'Download compatible update' : 'Check for updates'}</Text></Pressable>
    <Text style={styles.body}>Compatible fixes download automatically on launch or when you return to SWISH. Restart when prompted after saving your work; the app does not restart during a capture or listing edit.</Text>
    {updates.nativeError ? <Text accessibilityRole="alert" style={styles.error}>{updates.nativeError}</Text> : null}
    {updates.nativeRelease ? <View style={styles.native}><Text style={styles.title}>Verified native release {updates.nativeRelease.version}</Text><Text style={styles.body}>{updates.nativeRelease.notes}</Text><Text selectable style={styles.body}>Source {updates.nativeRelease.sourceSha}{'\n'}APK/artifact SHA-256 {updates.nativeRelease.sha256 ?? 'Not recorded'}</Text>{updates.nativeRelease.url ? <Pressable onPress={() => { void updates.openDistribution(); }} style={({ pressed }) => [styles.secondary, { opacity: pressed ? 0.7 : 1 }]}><Text style={styles.state}>Open approved distribution</Text></Pressable> : null}<Text style={styles.body}>Android APK updates require approval in the system installer. iOS updates use the approved TestFlight or App Store route, not direct IPA installation.</Text></View> : <Text style={styles.body}>{updates.nativeError ? 'Native release information could not be verified.' : 'Native APK releases are separate from compatible code updates.'}</Text>}
    <Text style={styles.body}>Compatible modules travel in one atomic SWISH bundle. Native changes require a new binary. Failed downloads retain the current bundle; recovery uses Expo Updates error recovery and an approved last-known-good compatible release.</Text>
  </View>;
}
const styles = StyleSheet.create({ errorRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }, flex: { flex: 1 }, panel: { padding: Spacing.base, gap: Spacing.base, backgroundColor: Colors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceBorder }, title: { color: Colors.textPrimary, fontSize: Typography.size.lg, fontWeight: Typography.weight.bold }, body: { color: Colors.textSecondary, fontSize: Typography.size.base, lineHeight: 26 }, state: { color: Colors.primary, fontSize: Typography.size.base, fontWeight: Typography.weight.semibold }, error: { color: Colors.warning, fontSize: Typography.size.base, lineHeight: 26 }, button: { minHeight: 52, padding: Spacing.base, backgroundColor: Colors.primary, borderRadius: Radius.md, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: Spacing.sm }, buttonText: { fontSize: Typography.size.base, fontWeight: Typography.weight.semibold, color: Colors.textInverse }, native: { gap: Spacing.base, borderTopWidth: 1, borderTopColor: Colors.surfaceBorder, paddingTop: Spacing.base }, secondary: { padding: Spacing.base, minHeight: 48, backgroundColor: Colors.primaryDim, borderRadius: Radius.md } });
