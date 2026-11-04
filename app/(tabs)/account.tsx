import React from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import SettingsScreen from '../settings';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/template';
import { useAccountLogout } from '@/hooks/useAccountLogout';
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
  const { signingOut, requestLogout, disabled: logoutDisabled } = useAccountLogout();
  const effectiveNicheId = fixedNicheId ?? activeNicheId;
  const owner = isMasterAdmin && isSwishMasterAdmin(user?.email);

  // The owner can enter a branded niche during testing. Do not let the
  // build-time niche lock hide the workspace switcher or owner controls.
  if (effectiveNicheId === 'collectibles' && owner) {
    const ownerAction = (title: string, detail: string, icon: React.ComponentProps<typeof MaterialIcons>['name'], route: string) => (
      <Pressable style={styles.action} onPress={() => router.push(route as any)}>
        <MaterialIcons name={icon} size={24} color={Colors.primary} />
        <View style={styles.copy}>
          <Text style={styles.actionTitle}>{title}</Text>
          <Text style={styles.description}>{detail}</Text>
        </View>
        <MaterialIcons name="chevron-right" size={24} color={Colors.textTertiary} />
      </Pressable>
    );
    return (
      <View style={[styles.screen, { paddingTop: insets.top + Spacing.lg, paddingBottom: insets.bottom + Spacing.lg }]}>
        <Text style={styles.eyebrow}>COLLECTIBLES FLIPPER · OWNER</Text>
        <Text style={styles.title}>More & workspace</Text>
        <Text style={styles.email}>{user?.email ?? 'Owner account'}</Text>
        {ownerAction('Switch niche', 'Return to your subscribed SWISH workspaces.', 'apps', '/niche-select')}
        {ownerAction('Master Admin', 'Owner console, module verification and diagnostics.', 'admin-panel-settings', '/master-admin')}
        {ownerAction('eBay Admin', 'Connection status and marketplace administration.', 'store', '/ebay-admin')}
        {ownerAction('Diagnostics', 'Inspect app and module health.', 'bug-report', '/master-diagnostics')}
        {ownerAction('Settings', 'Account and application settings.', 'settings', '/settings')}
        <Pressable style={[styles.action, styles.signOut]} onPress={requestLogout} disabled={logoutDisabled} accessibilityLabel="Log out of SWISH">
          {signingOut ? <ActivityIndicator color={Colors.danger ?? '#D33'} /> : <MaterialIcons name="logout" size={24} color={Colors.danger ?? '#D33'} />}
          <View style={styles.copy}>
            <Text style={[styles.actionTitle, { color: Colors.danger ?? '#D33' }]}>{signingOut ? 'Signing out…' : 'Sign out'}</Text>
            <Text style={styles.description}>Sign out of this SWISH account on this device.</Text>
          </View>
        </Pressable>
      </View>
    );
  }
  if (effectiveNicheId === 'antiques') return <Redirect href={"/(tabs)/antique-more" as any} />;
  // Branded niche apps use More as their settings destination. Keep niche
  // switching in the unbranded/master workspace only.
  if (fixedNicheId || isThreadsFlip || (effectiveNicheId && !isMasterAdmin)) return <SettingsScreen embedded />;
  return (
    <View testID={isThreadsFlip ? "threads-flip-screen-account" : undefined} accessibilityLabel={isThreadsFlip ? "Threads Flip account and workspace" : undefined} style={[styles.screen, { paddingTop: insets.top + Spacing.lg, paddingBottom: insets.bottom + Spacing.lg }, isThreadsFlip && { backgroundColor: threads.background }]}>
      <Text style={[styles.eyebrow, isThreadsFlip && { color: threads.pink }]}>{isThreadsFlip ? 'THREADS FLIP · ACCOUNT' : 'SWISH ACCOUNT'}</Text>
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

      <Pressable style={[styles.action, styles.signOut, isThreadsFlip && { backgroundColor: threads.surface, borderColor: threads.border }]} onPress={requestLogout} disabled={logoutDisabled} accessibilityLabel="Log out of SWISH">
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
