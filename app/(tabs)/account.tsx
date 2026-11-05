import React from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useAuth } from '@/template';
import { useAccountLogout } from '@/hooks/useAccountLogout';
import { useApp } from '@/hooks/useApp';
import { isSwishMasterAdmin } from '@/contexts/AppContext';
import { Colors, Typography, Spacing, Radius } from '@/constants/theme';

type MenuAction = { title: string; detail: string; icon: React.ComponentProps<typeof MaterialIcons>['name']; route: string };

export default function AccountScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { isMasterAdmin, activeNicheId, fixedNicheId, canSwitchNiche } = useApp();
  const { signingOut, requestLogout, disabled: logoutDisabled } = useAccountLogout();
  const effectiveNicheId = fixedNicheId ?? activeNicheId;
  const owner = isMasterAdmin && isSwishMasterAdmin(user?.email);
  // Branded APKs deliberately omit owner-only and cross-niche routes.
  // Keep those actions in the separate unified Master Admin installation.
  const showOwnerTools = owner && !fixedNicheId;
  const showSwitcher = !fixedNicheId && (owner || canSwitchNiche);
  const actions: MenuAction[] = [
    ...(showSwitcher ? [{ title: 'Switch niche', detail: 'Open another authorised SWISH workspace.', icon: 'apps' as const, route: '/niche-select' }] : []),
    ...(showOwnerTools ? [
      { title: 'Master Admin', detail: 'Owner console, module verification and diagnostics.', icon: 'admin-panel-settings' as const, route: '/master-admin' },
      { title: 'eBay Admin', detail: 'Connection status and marketplace administration.', icon: 'store' as const, route: '/ebay-admin' },
      { title: 'Diagnostics', detail: 'Inspect app and module health.', icon: 'monitor-heart' as const, route: '/master-diagnostics' },
    ] : []),
    { title: 'eBay Connection', detail: 'Seller account, policies and marketplace connection.', icon: 'link' as const, route: '/ebay-account' },
    { title: 'Settings', detail: 'Account, preferences and application settings.', icon: 'settings' as const, route: '/settings' },
  ];
  const nicheLabel = effectiveNicheId ? String(effectiveNicheId).replace(/[_-]/g, ' ').toUpperCase() : 'SWISH';

  return (
    <View style={[styles.screen, { paddingTop: insets.top + Spacing.lg, paddingBottom: insets.bottom + Spacing.lg }]}>
      <StatusBar style="light" />
      <Text style={styles.eyebrow}>{nicheLabel} · MORE</Text>
      <Text style={styles.title}>More & workspace</Text>
      <Text style={styles.email}>{user?.email ?? 'Signed-in account'}</Text>
      {actions.map(action => (
        <Pressable key={action.route} accessibilityRole="button" style={({ pressed }) => [styles.action, pressed ? styles.pressed : null]} onPress={() => router.push(action.route as any)}>
          <MaterialIcons name={action.icon} size={24} color={Colors.primary} />
          <View style={styles.copy}>
            <Text style={styles.actionTitle}>{action.title}</Text>
            <Text style={styles.description}>{action.detail}</Text>
          </View>
          <MaterialIcons name="chevron-right" size={24} color={Colors.textTertiary} />
        </Pressable>
      ))}
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
  pressed: { opacity: 0.7 },
});
