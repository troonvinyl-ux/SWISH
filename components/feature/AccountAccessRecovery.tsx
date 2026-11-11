import { memo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { useAccessRecovery } from '@/hooks/useAccessRecovery';
import { Colors, Radius, Spacing, Typography } from '@/constants/theme';

interface AccountAccessRecoveryProps { overlay?: boolean }
export const AccountAccessRecovery = memo(function AccountAccessRecovery({ overlay = false }: AccountAccessRecoveryProps) {
  const { failure, retry, busy, actionError } = useAccessRecovery();
  return <SafeAreaView edges={['top', 'bottom']} style={[styles.screen, overlay ? styles.overlay : null]}>
    <View style={styles.panel}>
      <MaterialIcons name="lock-outline" size={32} color={Colors.primary} />
      <Text style={styles.title}>{failure.title}</Text>
      <Text accessibilityRole="alert" style={styles.body}>{failure.message}</Text>
      {actionError ? <View style={styles.errorRow}><MaterialIcons name="error-outline" size={20} color={Colors.danger} /><Text accessibilityRole="alert" style={styles.error}>{actionError}</Text></View> : null}
      <Pressable accessibilityRole="button" accessibilityLabel={failure.retryLabel} accessibilityState={{ disabled: busy, busy }} disabled={busy} onPress={() => { void retry(); }} style={({ pressed }) => [styles.button, pressed ? styles.pressed : null, busy ? styles.disabled : null]}>
        {busy ? <ActivityIndicator color={Colors.textInverse} /> : <Text style={styles.buttonText}>{failure.retryLabel}</Text>}
      </Pressable>
    </View>
  </SafeAreaView>;
});
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background, justifyContent: 'center', alignItems: 'center', padding: Spacing.lg },
  overlay: { ...StyleSheet.absoluteFillObject, zIndex: 100 },
  panel: { width: '100%', maxWidth: 560, padding: Spacing.lg, gap: Spacing.lg, backgroundColor: Colors.surface, borderColor: Colors.surfaceBorder, borderWidth: 1, borderRadius: Radius.lg, alignItems: 'center' },
  title: { color: Colors.textPrimary, fontSize: Typography.size.xl, fontWeight: Typography.weight.bold, textAlign: 'center', includeFontPadding: false },
  body: { color: Colors.textSecondary, fontSize: Typography.size.base, lineHeight: 26, textAlign: 'center', includeFontPadding: false },
  button: { width: '100%', minHeight: 52, borderRadius: Radius.md, padding: Spacing.base, backgroundColor: Colors.primary, justifyContent: 'center', alignItems: 'center' },
  buttonText: { color: Colors.textInverse, fontSize: Typography.size.base, fontWeight: Typography.weight.semibold, includeFontPadding: false },
  errorRow: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start' },
  error: { flex: 1, color: Colors.danger, fontSize: Typography.size.base, lineHeight: 26 },
  pressed: { opacity: 0.8, transform: [{ scale: 0.98 }] }, disabled: { opacity: 0.65 },
});
