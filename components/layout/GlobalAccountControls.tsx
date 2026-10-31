import React, { useState } from 'react';
import {
  Alert,
  BackHandler,
  Linking,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/template';
import { useApp } from '@/hooks/useApp';
import { isSwishMasterAdmin } from '@/contexts/AppContext';
import { Colors, Radius, Spacing, Typography } from '@/constants/theme';

/**
 * One account/exit control shared by every branded niche build and the Master
 * Admin shell. Keep this in the root layout so no niche can omit it.
 */
export function GlobalAccountControls() {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { user, logout, operationLoading } = useAuth();
  const { isMasterAdmin, fixedNicheId } = useApp();
  const [visible, setVisible] = useState(false);

  const hidden = !user || pathname === '/login' || pathname.startsWith('/onboarding');
  if (hidden) return null;

  const owner = isMasterAdmin && isSwishMasterAdmin(user?.email);

  const signOut = async () => {
    if (operationLoading) return;
    try {
      const result = await logout();
      if (result?.error) {
        Alert.alert('Unable to sign out', result.error);
        return;
      }
      setVisible(false);
      router.replace('/login' as any);
    } catch (error) {
      Alert.alert('Unable to sign out', error instanceof Error ? error.message : 'Please try again.');
    }
  };

  const openMasterAdmin = async () => {
    try {
      await Linking.openURL('swishmasteradmin://');
      setVisible(false);
    } catch {
      Alert.alert('Master Admin not installed', 'Install the SWISH Master Admin APK on this device, then use this shortcut to return to the control centre.');
    }
  };

  const exitApp = () => {
    setVisible(false);
    if (Platform.OS === 'android') {
      Alert.alert('Exit SWISH?', 'Close the app and return to your device home screen.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Exit', style: 'destructive', onPress: () => BackHandler.exitApp() },
      ]);
      return;
    }
    if (Platform.OS === 'ios') {
      Alert.alert('Exit SWISH', 'iPhone and iPad do not allow apps to close themselves. Use the app switcher to swipe SWISH away.');
      return;
    }
    router.replace('/login' as any);
  };

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Account, sign out and exit"
        onPress={() => setVisible(true)}
        style={({ pressed }) => [styles.trigger, { top: insets.top + 8 }, pressed && styles.pressed]}
      >
        <MaterialIcons name="account-circle" size={25} color={Colors.primary} />
      </Pressable>
      <Modal visible={visible} transparent animationType="fade" onRequestClose={() => setVisible(false)}>
        <Pressable style={styles.scrim} onPress={() => setVisible(false)}>
          <Pressable style={[styles.panel, { marginTop: insets.top + 56 }]} onPress={() => {}}>
            <View style={styles.heading}>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>SWISH account</Text>
                <Text style={styles.email}>{user?.email ?? 'Signed-in account'}</Text>
              </View>
              <Pressable accessibilityLabel="Close account menu" onPress={() => setVisible(false)} style={styles.close}>
                <MaterialIcons name="close" size={21} color={Colors.textSecondary} />
              </Pressable>
            </View>
            {owner && fixedNicheId ? (
              <Action icon="admin-panel-settings" title="Return to Master Admin" description="Open the separate SWISH control-centre app" onPress={openMasterAdmin} />
            ) : null}
            <Action icon="logout" title="Log out" description="Sign out of SWISH on this device" danger onPress={() => void signOut()} />
            <Action icon="exit-to-app" title="Exit app" description={Platform.OS === 'ios' ? 'See instructions for closing SWISH' : 'Close SWISH and return to your device'} danger onPress={exitApp} />
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

function Action({ icon, title, description, onPress, danger = false }: {
  icon: string; title: string; description: string; onPress: () => void; danger?: boolean;
}) {
  const color = danger ? (Colors.danger ?? '#D33') : Colors.primary;
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
      <MaterialIcons name={icon as any} size={23} color={color} />
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={[styles.actionTitle, danger && { color }]}>{title}</Text>
        <Text style={styles.description}>{description}</Text>
      </View>
      <MaterialIcons name="chevron-right" size={22} color={Colors.textTertiary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  trigger: { position: 'absolute', right: 14, zIndex: 1100, width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.surfaceBorder, elevation: 7 },
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.62)', paddingHorizontal: Spacing.base },
  panel: { alignSelf: 'flex-end', width: '100%', maxWidth: 420, backgroundColor: Colors.surface, borderRadius: Radius.xl, padding: Spacing.base, gap: Spacing.sm, borderWidth: 1, borderColor: Colors.surfaceBorder },
  heading: { flexDirection: 'row', alignItems: 'center', paddingBottom: Spacing.sm, gap: Spacing.md },
  title: { color: Colors.textPrimary, fontSize: Typography.size.lg, fontWeight: '800' },
  email: { color: Colors.textSecondary, fontSize: Typography.size.xs, marginTop: 3 },
  close: { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center' },
  action: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md, borderRadius: Radius.md, backgroundColor: Colors.background, minHeight: 66 },
  actionTitle: { color: Colors.textPrimary, fontSize: Typography.size.base, fontWeight: '700' },
  description: { color: Colors.textTertiary, fontSize: Typography.size.xs, lineHeight: 17 },
  pressed: { opacity: 0.75 },
});
