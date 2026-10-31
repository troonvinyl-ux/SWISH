// SWISH Master Admin — owner-only platform control centre.
import React, { useState } from 'react';
import { Alert, Linking, View, Text, ScrollView, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import * as Updates from 'expo-updates';
import { Redirect, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/template';
import { useApp } from '@/hooks/useApp';
import { isSwishMasterAdmin } from '@/contexts/AppContext';
import { resolveProductionNiche } from '@/services/nicheRouting';
import { PRODUCTION_NICHES, NICHE_MODULES } from '@/constants/niches';
import { Colors, Typography, Spacing, Radius } from '@/constants/theme';

export default function MasterAdminScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { activeNicheId, enabledNiches, setActiveNiche, isMasterAdmin, tenant, subscriptionTier } = useApp();
  const [checkingUpdate, setCheckingUpdate] = useState(false);

  const checkForAppUpdate = async () => {
    if (checkingUpdate) return;
    if (!Updates.isEnabled) {
      Alert.alert('Updates not configured', 'This installed APK needs an OTA-enabled build before it can receive app-code updates. Once enabled, routine screen and logic changes can install without another APK.');
      return;
    }
    setCheckingUpdate(true);
    try {
      const result = await Updates.checkForUpdateAsync();
      if (!result.isAvailable) {
        Alert.alert('SWISH is up to date', 'No compatible update is currently available for this app.');
        return;
      }
      await Updates.fetchUpdateAsync();
      Alert.alert('Update ready', 'The latest SWISH update has downloaded. Reload now to apply it?', [
        { text: 'Later', style: 'cancel' },
        { text: 'Update now', onPress: () => { void Updates.reloadAsync(); } },
      ]);
    } catch (error) {
      Alert.alert('Update check failed', error instanceof Error ? error.message : 'Please try again later.');
    } finally {
      setCheckingUpdate(false);
    }
  };

  // Fail closed: never render owner tools for another account.
  if (!isSwishMasterAdmin(user?.email) || !isMasterAdmin) {
    return <Redirect href="/" />;
  }

  const switchNiche = async (id: (typeof PRODUCTION_NICHES)[number]['id']) => {
    const nicheId = resolveProductionNiche(id);
    const nicheModule = nicheId ? NICHE_MODULES[nicheId] : null;
    const scheme = nicheModule?.scheme;
    if (!nicheId || !nicheModule || !scheme) {
      Alert.alert('App unavailable', 'This niche does not have a registered app launch link.');
      return;
    }
    try {
      await Linking.openURL(`${scheme}://`);
      setActiveNiche(id);
    } catch {
      Alert.alert(
        `${nicheModule.name} is not installed`,
        `Install the ${nicheModule.name} APK on this device, then return here to launch it. The Master Admin app does not contain the niche workspace.`,
      );
    }
  };

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + Spacing.lg, paddingBottom: insets.bottom + Spacing.xl }]}>
        <View style={styles.header}>
          <View style={styles.headerCopy}>
            <Text style={styles.eyebrow}>SWISH PLATFORM</Text>
            <Text style={styles.title}>Master Admin</Text>
            <Text style={styles.subtitle}>Owner control centre</Text>
          </View>
        </View>

        <View style={styles.ownerCard}>
          <View style={styles.ownerIcon}><MaterialIcons name="verified-user" size={22} color={Colors.success ?? Colors.primary} /></View>
          <View style={styles.ownerCopy}>
            <Text style={styles.ownerLabel}>MASTER ACCOUNT</Text>
            <Text style={styles.ownerEmail}>{user?.email ?? 'troonvinyl@gmail.com'}</Text>
            <Text style={styles.ownerMeta}>Lifetime premium · all registered niches</Text>
          </View>
        </View>

        <View style={styles.sectionHeading}>
          <Text style={styles.sectionTitle}>Niche switcher</Text>
          <Text style={styles.sectionMeta}>{PRODUCTION_NICHES.length} registered niches</Text>
        </View>
        <Text style={styles.helpText}>Choose a niche to launch its separately installed SWISH app. Return here from a niche using the account menu. Each app keeps its own stock and workspace.</Text>

        <View style={styles.nicheList}>
          {PRODUCTION_NICHES.map(niche => {
            const active = activeNicheId === niche.id;
            const enabled = enabledNiches.includes(niche.id);
            return (
              <Pressable
                key={niche.id}
                onPress={() => switchNiche(niche.id)}
                accessibilityRole="button"
                accessibilityLabel={`Switch to ${niche.shortName}`}
                style={({ pressed }) => [styles.nicheCard, active && { borderColor: niche.color, backgroundColor: niche.color + '12' }, pressed && styles.pressed]}
              >
                <View style={[styles.nicheIcon, { backgroundColor: niche.color + '20' }]}>
                  <MaterialIcons name={niche.icon as any} size={25} color={niche.color} />
                </View>
                <View style={styles.nicheCopy}>
                  <Text style={styles.nicheName}>{niche.name}</Text>
                  <Text style={styles.nicheDescription}>{niche.tagline}</Text>
                  <Text style={styles.nicheStatus}>{enabled ? 'Premium access enabled' : 'Available to master account'}</Text>
                </View>
                {active
                  ? <View style={[styles.activePill, { backgroundColor: niche.color }]}><Text style={styles.activePillText} >LAST OPENED</Text></View>
                  : <MaterialIcons name="chevron-right" size={24} color={Colors.textTertiary} />}
              </Pressable>
            );
          })}
        </View>

        <View style={styles.sectionHeading}>
          <Text style={styles.sectionTitle}>Platform controls</Text>
          <Text style={styles.sectionMeta}>Owner view</Text>
        </View>
        <View style={styles.infoCard}>
          <InfoRow icon="inventory-2" title="Current workspace" value={PRODUCTION_NICHES.find(n => n.id === activeNicheId)?.name ?? activeNicheId} />
          <InfoRow icon="business" title="Business workspace" value={tenant?.name ?? 'Not loaded'} />
          <InfoRow icon="workspace-premium" title="Account tier" value={subscriptionTier ?? 'Lifetime entitlement for master account'} />
          <InfoRow icon="security" title="Access model" value="Owner-only screen; sensitive actions require server-side authorization before they are enabled." />
        </View>

        <Pressable accessibilityRole="button" onPress={checkForAppUpdate} disabled={checkingUpdate} style={styles.updateButton}>
          <View style={styles.updateIcon}>{checkingUpdate ? <ActivityIndicator color={Colors.primary} /> : <MaterialIcons name="system-update" size={23} color={Colors.primary} />}</View>
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={styles.updateTitle}>{checkingUpdate ? 'Checking for updates…' : 'Update SWISH'}</Text>
            <Text style={styles.updateSubtitle}>Check, download and install the latest compatible app update</Text>
          </View>
          <MaterialIcons name="chevron-right" size={24} color={Colors.textPrimary} />
        </Pressable>

        <Pressable accessibilityRole="button" onPress={() => router.push('/master-diagnostics' as any)} style={styles.diagnosticsButton}>
          <View style={styles.diagnosticsIcon}><MaterialIcons name="health-and-safety" size={24} color="#111111" /></View>
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={styles.diagnosticsTitle}>Diagnostics Centre</Text>
            <Text style={styles.diagnosticsSubtitle}>Run shared eBay create, modify and delete acceptance tests</Text>
          </View>
          <MaterialIcons name="chevron-right" size={24} color={Colors.textPrimary} />
        </Pressable>

        <View style={styles.notice}>
          <MaterialIcons name="info-outline" size={18} color={Colors.primary} />
          <Text style={styles.noticeText}>This is the first admin slice: secure owner recognition, all-niche access and workspace switching. User management, live platform metrics, audit history and integration diagnostics need their own server-backed admin endpoints before they can be exposed here.</Text>
        </View>
      </ScrollView>
    </View>
  );
}

function InfoRow({ icon, title, value }: { icon: string; title: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <MaterialIcons name={icon as any} size={20} color={Colors.textSecondary} />
      <View style={styles.infoCopy}>
        <Text style={styles.infoTitle}>{title}</Text>
        <Text style={styles.infoValue}>{value}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  content: { paddingHorizontal: Spacing.base, gap: Spacing.lg },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  iconButton: { width: 42, height: 42, borderRadius: Radius.md, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.surfaceBorder, alignItems: 'center', justifyContent: 'center' },
  headerCopy: { flex: 1, gap: 2 },
  eyebrow: { fontSize: 10, letterSpacing: 1.2, color: Colors.primary, fontWeight: '800' },
  title: { color: Colors.textPrimary, fontSize: 27, fontWeight: '800' },
  subtitle: { color: Colors.textSecondary, fontSize: Typography.size.sm },
  shield: { width: 46, height: 46, borderRadius: Radius.lg, backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center' },
  ownerCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.base, borderRadius: Radius.lg, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.primary + '66' },
  ownerIcon: { width: 42, height: 42, borderRadius: Radius.md, backgroundColor: Colors.primary + '18', alignItems: 'center', justifyContent: 'center' },
  ownerCopy: { flex: 1, gap: 3 },
  ownerLabel: { color: Colors.primary, fontSize: 9, fontWeight: '800', letterSpacing: 1 },
  ownerEmail: { color: Colors.textPrimary, fontSize: Typography.size.base, fontWeight: '700' },
  ownerMeta: { color: Colors.textSecondary, fontSize: Typography.size.xs },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: Spacing.xs },
  sectionTitle: { color: Colors.textPrimary, fontSize: Typography.size.lg, fontWeight: '800' },
  sectionMeta: { color: Colors.textTertiary, fontSize: Typography.size.xs },
  helpText: { color: Colors.textSecondary, fontSize: Typography.size.sm, lineHeight: 20, marginTop: -Spacing.md },
  nicheList: { gap: Spacing.sm },
  nicheCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.surfaceBorder, borderRadius: Radius.lg, padding: Spacing.md },
  nicheIcon: { width: 46, height: 46, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  nicheCopy: { flex: 1, gap: 3 },
  nicheName: { color: Colors.textPrimary, fontSize: Typography.size.sm, fontWeight: '800' },
  nicheDescription: { color: Colors.textSecondary, fontSize: Typography.size.xs },
  nicheStatus: { color: Colors.textTertiary, fontSize: 10 },
  activePill: { borderRadius: Radius.pill, paddingHorizontal: 8, paddingVertical: 4 },
  activePillText: { color: '#111111', fontSize: 9, fontWeight: '900', letterSpacing: 0.5 },
  pressed: { opacity: 0.82 },
  infoCard: { backgroundColor: Colors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceBorder, paddingHorizontal: Spacing.md },
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md, paddingVertical: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder },
  infoCopy: { flex: 1, gap: 3 },
  infoTitle: { color: Colors.textSecondary, fontSize: Typography.size.xs },
  infoValue: { color: Colors.textPrimary, fontSize: Typography.size.sm, lineHeight: 19 },
  updateButton: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.primary + '88' },
  updateIcon: { width: 42, height: 42, borderRadius: Radius.md, backgroundColor: Colors.primaryDim, alignItems: 'center', justifyContent: 'center' },
  updateTitle: { color: Colors.textPrimary, fontSize: Typography.size.base, fontWeight: '900' },
  updateSubtitle: { color: Colors.textSecondary, fontSize: Typography.size.xs, lineHeight: 17 },
  diagnosticsButton: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.primary, borderWidth: 1, borderColor: Colors.primary },
  diagnosticsIcon: { width: 42, height: 42, borderRadius: Radius.md, backgroundColor: '#FFFFFF55', alignItems: 'center', justifyContent: 'center' },
  diagnosticsTitle: { color: '#111111', fontSize: Typography.size.base, fontWeight: '900' },
  diagnosticsSubtitle: { color: '#222222', fontSize: Typography.size.xs, lineHeight: 17 },
  notice: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, padding: Spacing.md, borderRadius: Radius.md, backgroundColor: Colors.surfaceHighlight },
  noticeText: { flex: 1, color: Colors.textSecondary, fontSize: Typography.size.xs, lineHeight: 18 },
});
