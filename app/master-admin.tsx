// SWISH Master Admin — owner-only platform control centre.
import React from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Linking } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/template';
import { useApp } from '@/hooks/useApp';
import { isSwishMasterAdmin } from '@/contexts/AppContext';
import { PRODUCTION_NICHES } from '@/constants/niches';
import { Colors, Typography, Spacing, Radius } from '@/constants/theme';

export default function MasterAdminScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { activeNicheId, enabledNiches, setActiveNiche, isMasterAdmin, tenant, subscriptionTier } = useApp();

  // Fail closed: never render owner tools for another account.
  if (!isSwishMasterAdmin(user?.email) || !isMasterAdmin) {
    return <Redirect href="/" />;
  }

  const switchNiche = (id: (typeof PRODUCTION_NICHES)[number]['id']) => {
    setActiveNiche(id);
    router.replace('/(tabs)' as any);
  };

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + Spacing.lg, paddingBottom: insets.bottom + Spacing.xl }]}>
        <View style={styles.header}>
          <Pressable accessibilityLabel="Back" onPress={() => router.back()} style={styles.iconButton}>
            <MaterialIcons name="arrow-back" size={22} color={Colors.textPrimary} />
          </Pressable>
          <View style={styles.headerCopy}>
            <Text style={styles.eyebrow}>SWISH PLATFORM</Text>
            <Text style={styles.title}>Master Admin</Text>
            <Text style={styles.subtitle}>Owner control centre</Text>
          </View>
          <View style={styles.shield}>
            <MaterialIcons name="admin-panel-settings" size={26} color={Colors.primary} />
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
        <Text style={styles.helpText}>Choose a niche to open its existing SWISH workspace. Stock remains scoped to its own niche.</Text>

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
                  ? <View style={[styles.activePill, { backgroundColor: niche.color }]}><Text style={styles.activePillText}>ACTIVE</Text></View>
                  : <MaterialIcons name="chevron-right" size={24} color={Colors.textTertiary} />}
              </Pressable>
            );
          })}
        </View>

        <View style={styles.sectionHeading}>
          <Text style={styles.sectionTitle}>Production readiness pipelines</Text>
          <Text style={styles.sectionMeta}>CI-backed checks</Text>
        </View>
        <Text style={styles.helpText}>Launch the automated test pipelines in GitHub Actions. A pipeline only counts as passed when its latest run is green; live provider checks are deliberately reported separately.</Text>
        <View style={styles.pipelineList}>
          <PipelineCard
            icon="rule"
            title="Regression & niche isolation"
            description="Lint, route guards, niche data isolation, branded config, Surplus Flip logic and server-only secret tests."
            action="Open test pipelines"
            onPress={() => Linking.openURL('https://github.com/troonvinyl-ux/SWISH/actions/workflows/master-admin-readiness.yml')}
          />
          <PipelineCard
            icon="security"
            title="Edge Function & secret boundary"
            description="Transpile-checks Supabase Edge Functions and runs the client secret-boundary regression test."
            action="Open security checks"
            onPress={() => Linking.openURL('https://github.com/troonvinyl-ux/SWISH/actions/workflows/master-admin-readiness.yml')}
          />
          <PipelineCard
            icon="devices"
            title="Five niche production bundles"
            description="Validates Coins, Motocross, Bikes, Clothing and Surplus Flip Expo config and Android JavaScript bundling."
            action="Open build checks"
            onPress={() => Linking.openURL('https://github.com/troonvinyl-ux/SWISH/actions/workflows/master-admin-readiness.yml')}
          />
          <PipelineCard
            icon="cloud-done"
            title="Live integration gate"
            description="eBay OAuth, order/finance sync, Stripe entitlements and deployed Edge Functions require a configured test environment. These are not marked passed by static CI."
            action="Review latest workflow runs"
            onPress={() => Linking.openURL('https://github.com/troonvinyl-ux/SWISH/actions')}
          />
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

        <View style={styles.notice}>
          <MaterialIcons name="info-outline" size={18} color={Colors.primary} />
          <Text style={styles.noticeText}>Pipeline buttons open the authoritative GitHub Actions workflows; this screen does not fabricate live pass/fail states. Live eBay, Stripe and deployed-backend tests remain gated until a dedicated test environment and credentials are configured.</Text>
        </View>
      </ScrollView>
    </View>
  );
}

function PipelineCard({ icon, title, description, action, onPress }: { icon: string; title: string; description: string; action: string; onPress: () => void }) {
  return (
    <View style={styles.pipelineCard}>
      <View style={styles.pipelineIcon}><MaterialIcons name={icon as any} size={22} color={Colors.primary} /></View>
      <View style={styles.pipelineCopy}>
        <Text style={styles.pipelineTitle}>{title}</Text>
        <Text style={styles.pipelineDescription}>{description}</Text>
        <Pressable accessibilityRole="link" onPress={onPress} style={({ pressed }) => [styles.pipelineAction, pressed && styles.pressed]}>
          <Text style={styles.pipelineActionText}>{action}</Text>
          <MaterialIcons name="open-in-new" size={15} color={Colors.primary} />
        </Pressable>
      </View>
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
  pipelineList: { gap: Spacing.sm },
  pipelineCard: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.surfaceBorder, borderRadius: Radius.lg, padding: Spacing.md },
  pipelineIcon: { width: 42, height: 42, borderRadius: Radius.md, backgroundColor: Colors.primary + '18', alignItems: 'center', justifyContent: 'center' },
  pipelineCopy: { flex: 1, gap: 6 },
  pipelineTitle: { color: Colors.textPrimary, fontSize: Typography.size.sm, fontWeight: '800' },
  pipelineDescription: { color: Colors.textSecondary, fontSize: Typography.size.xs, lineHeight: 18 },
  pipelineAction: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 5 },
  pipelineActionText: { color: Colors.primary, fontSize: Typography.size.xs, fontWeight: '800' },
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
  notice: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, padding: Spacing.md, borderRadius: Radius.md, backgroundColor: Colors.surfaceHighlight },
  noticeText: { flex: 1, color: Colors.textSecondary, fontSize: Typography.size.xs, lineHeight: 18 },
});
