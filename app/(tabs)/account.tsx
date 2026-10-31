import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Alert } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth, authService } from '@/template';
import { useApp } from '@/hooks/useApp';
import { isSwishMasterAdmin } from '@/contexts/AppContext';
import { Colors, Typography, Spacing, Radius } from '@/constants/theme';

export default function AccountScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { isMasterAdmin, activeNicheId, fixedNicheId } = useApp();
  const isThreadsFlip = (fixedNicheId ?? activeNicheId) === 'clothing';
  const threads = { background: '#0C080C', surface: '#160E16', border: '#301830', pink: '#E91E8C', cream: '#FFF0F5', muted: '#9A7090' };
  const [signingOut, setSigningOut] = useState(false);
  if ((fixedNicheId ?? activeNicheId) === 'antiques') return <Redirect href={"/(tabs)/antique-more" as any} />;
  const owner = isMasterAdmin && isSwishMasterAdmin(user?.email);

  const signOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      const result = await authService.logout();
      if (result?.error) {
        Alert.alert('Unable to sign out', result.error);
        return;
      }
      router.replace('/login' as any);
    } catch (error) {
      Alert.alert('Unable to sign out', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <View testID={isThreadsFlip ? "threads-flip-screen-account" : undefined} accessibilityLabel={isThreadsFlip ? "Threads Flip account and workspace" : undefined} style={[styles.screen, { paddingTop: insets.top + Spacing.lg, paddingBottom: insets.bottom + Spacing.lg }, isThreadsFlip && { backgroundColor: threads.background }]}>
      <Text style={[styles.eyebrow, isThreadsFlip && { color: threads.pink }]}>THREADS FLIP · ACCOUNT</Text>
      <Text style={[styles.title, isThreadsFlip && { color: threads.cream }]}>Account & workspace</Text>
      <Text style={[styles.email, isThreadsFlip && { color: threads.muted }]}>{user?.email ?? 'Signed-in account'}</Text>

      <Pressable style={[styles.action, isThreadsFlip && { backgroundColor: threads.surface, borderColor: threads.border }]} onPress={() => router.push('/niche-select' as any)}>
        <MaterialIcons name="apps" size={24} color={isThreadsFlip ? threads.pink : Colors.primary} />
        <View style={styles.copy}>
          <Text style={[styles.actionTitle, isThreadsFlip && { color: threads.cream }]}>Switch niche</Text>
          <Text style={[styles.description, isThreadsFlip && { color: threads.muted }]}>Open SWISH Verticals and choose a workspace.</Text>
        </View>
        <MaterialIcons name="chevron-right" size={24} color={Colors.textTertiary} />
      </Pressable>

      {owner ? (
        <Pressable style={styles.action} onPress={() => router.push('/master-admin' as any)}>
          <MaterialIcons name="admin-panel-settings" size={24} color={Colors.primary} />
          <View style={styles.copy}>
            <Text style={styles.actionTitle}>Master Admin</Text>
            <Text style={styles.description}>Owner console and all registered niches.</Text>
          </View>
          <MaterialIcons name="chevron-right" size={24} color={Colors.textTertiary} />
        </Pressable>
      ) : null}

      <Pressable style={[styles.action, styles.signOut, isThreadsFlip && { backgroundColor: threads.surface, borderColor: threads.border }]} onPress={signOut} disabled={signingOut}>
        {signingOut ? <ActivityIndicator color={Colors.danger ?? '#D33'} /> : <MaterialIcons name="logout" size={24} color={Colors.danger ?? '#D33'} />}
        <View style={styles.copy}>
          <Text style={[styles.actionTitle, { color: Colors.danger ?? '#D33' }]}>{signingOut ? 'Signing out…' : 'Sign out'}</Text>
          <Text style={styles.description}>Sign out of this SWISH account on this device.</Text>
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background, paddingHorizontal: Spacing.base, gap: Spacing.md },
  eyebrow: { color: Colors.primary, fontSize: 11, fontWeight: '700', letterSpacing: 1.4 },
  title: { color: Colors.textPrimary, fontSize: 26, fontWeight: '800' },
  email: { color: Colors.textSecondary, fontSize: Typography.size.sm, marginBottom: Spacing.md },
  action: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.base, backgroundColor: Colors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceBorder },
  copy: { flex: 1, gap: 4 },
  actionTitle: { color: Colors.textPrimary, fontSize: Typography.size.base, fontWeight: '700' },
  description: { color: Colors.textTertiary, fontSize: Typography.size.xs, lineHeight: 18 },
  signOut: { marginTop: Spacing.sm },
});
