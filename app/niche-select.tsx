// SWISH Niche Selection Screen
// Allows users to switch between trading verticals and enable multiple niches.
// ONE SWISH ENGINE. MANY NICHES.

import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable,
} from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors, Typography, Spacing, Radius, Shadow } from '@/constants/theme';
import { useApp } from '@/hooks/useApp';
import { PRODUCTION_NICHES, NICHE_LIST, NicheId, NicheConfig } from '@/constants/niches';
import { nicheToEntryRoute } from '@/services/nicheRouting';

function NicheCard({
  niche,
  isActive,
  isEnabled,
  onSetActive,
  onToggleEnabled,
}: {
  niche: NicheConfig;
  isActive: boolean;
  isEnabled: boolean;
  onSetActive: () => void;
  onToggleEnabled: () => void;
}) {
  return (
    <Pressable
      onPress={onSetActive}
      style={({ pressed }) => [
        s.nicheCard,
        isActive && { borderColor: niche.color, borderWidth: 2 },
        pressed && { opacity: 0.88, transform: [{ scale: 0.98 }] },
      ]}
    >
      {/* Active indicator */}
      {isActive ? (
        <View style={[s.activeBadge, { backgroundColor: niche.color }]}>
          <Text style={s.activeBadgeText}>ACTIVE</Text>
        </View>
      ) : null}

      <View style={s.nicheCardRow}>
        {/* Icon */}
        <View style={[s.nicheIcon, { backgroundColor: niche.color + '20' }]}>
          <MaterialIcons name={niche.icon as any} size={28} color={niche.color} />
        </View>

        {/* Info */}
        <View style={s.nicheInfo}>
          <Text style={[s.nicheName, isActive && { color: niche.color }]}>{niche.name}</Text>
          <Text style={s.nicheTagline}>{niche.tagline}</Text>
          <View style={s.nicheMetaRow}>
            <View style={s.nichePill}>
              <Text style={s.nichePillText}>{niche.specialists.length} specialists</Text>
            </View>
            <View style={s.nichePill}>
              <Text style={s.nichePillText}>{niche.marketplaces.length} marketplaces</Text>
            </View>
          </View>
        </View>

        {/* Enable toggle */}
        <Pressable
          onPress={(e) => { e.stopPropagation(); onToggleEnabled(); }}
          style={[s.enableBtn, isEnabled ? { backgroundColor: niche.color + '20', borderColor: niche.color } : {}]}
          hitSlop={8}
        >
          <MaterialIcons
            name={isEnabled ? 'check-circle' : 'add-circle-outline'}
            size={22}
            color={isEnabled ? niche.color : Colors.textTertiary}
          />
        </Pressable>
      </View>

      {/* Specialists */}
      <View style={s.specialistsRow}>
        {niche.specialists.slice(0, 4).map(s2 => (
          <View key={s2} style={s.specialistChip}>
            <Text style={s.specialistChipText}>{s2.replace(/_/g, ' ')}</Text>
          </View>
        ))}
        {niche.specialists.length > 4 ? (
          <View style={s.specialistChip}>
            <Text style={s.specialistChipText}>+{niche.specialists.length - 4} more</Text>
          </View>
        ) : null}
      </View>

      {/* Acquisition sources */}
      <View style={s.sourcesRow}>
        <MaterialIcons name="shopping-bag" size={10} color={Colors.textTertiary} />
        <Text style={s.sourcesText} numberOfLines={1}>
          {niche.acquisitionSources.slice(0, 3).join(' · ')}
        </Text>
      </View>
    </Pressable>
  );
}

export default function NicheSelectScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { activeNicheId, fixedNicheId, enabledNiches, setActiveNiche, enableNiche, disableNiche, isMasterAdmin } = useApp();

  const handleSetActive = (id: NicheId) => {
    setActiveNiche(id);
  };

  const handleToggleEnabled = (id: NicheId, isEnabled: boolean) => {
    if (isEnabled) {
      // Don't disable if it's the only enabled niche
      if (enabledNiches.length <= 1) return;
      disableNiche(id);
    } else {
      enableNiche(id);
    }
  };

  // Branded builds are single-product apps, not a multi-niche switcher.
  if (fixedNicheId) {
    const route = nicheToEntryRoute(fixedNicheId);
    if (route) return <Redirect href={route as any} />;
  }

  return (
    <View style={s.container}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={[s.header, { paddingTop: insets.top + Spacing.base }]}>
        <Pressable onPress={() => router.back()} style={s.backBtn} hitSlop={8}>
          <MaterialIcons name="arrow-back" size={20} color={Colors.textSecondary} />
        </Pressable>
        <View style={s.headerCenter}>
          <Text style={s.headerTitle}>SWISH Verticals</Text>
          <Text style={s.headerSub}>Select your trading niche</Text>
        </View>
        {isMasterAdmin ? (
          <Pressable onPress={() => router.push('/master-admin' as any)} style={s.backBtn} accessibilityLabel="Open SWISH Master Admin">
            <MaterialIcons name="admin-panel-settings" size={22} color={Colors.primary} />
          </Pressable>
        ) : <View style={{ width: 36 }} />}
      </View>

      {/* Info banner */}
      <View style={s.infoBanner}>
        <MaterialIcons name="info-outline" size={14} color={Colors.primary} />
        <Text style={s.infoText}>
          ONE SWISH ENGINE — tap a niche to switch context. Enable multiple to manage different businesses from one account.
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 90 }]}
        showsVerticalScrollIndicator={false}
      >
        {PRODUCTION_NICHES.map(niche => (
          <NicheCard
            key={niche.id}
            niche={niche}
            isActive={activeNicheId === niche.id}
            isEnabled={enabledNiches.includes(niche.id)}
            onSetActive={() => handleSetActive(niche.id)}
            onToggleEnabled={() => handleToggleEnabled(niche.id, enabledNiches.includes(niche.id))}
          />
        ))}

        {/* Coming soon section */}
        <View style={s.comingSoonCard}>
          <MaterialIcons name="construction" size={20} color={Colors.textTertiary} />
          <View style={{ flex: 1 }}>
            <Text style={s.comingSoonTitle}>More Verticals Coming</Text>
            <Text style={s.comingSoonText}>
              Electronics · Musical Instruments · Sports Equipment · Golf · Watches · Vinyl Records · Comics · and hundreds more
            </Text>
          </View>
        </View>

        {/* Architecture note */}
        <View style={s.archNote}>
          <Text style={s.archNoteTitle}>ONE PLATFORM, MANY NICHES</Text>
          <Text style={s.archNoteText}>
            Your inventory, eBay integration, AI engine, valuation system, and order management are shared across all verticals.
            Switching niche changes terminology, specialist prompts, and quick actions — not the underlying platform.
          </Text>
        </View>
      </ScrollView>

      {/* Done button */}
      <View style={[s.doneBar, { paddingBottom: insets.bottom + Spacing.sm }]}>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [s.doneBtn, pressed && { opacity: 0.85 }]}
        >
          <MaterialIcons name="check" size={18} color={Colors.background} />
          <Text style={s.doneBtnText}>Done — Using {PRODUCTION_NICHES.find(n => n.id === activeNicheId)?.shortName ?? 'SWISH'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingHorizontal: Spacing.base, paddingBottom: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: Radius.md,
    backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.surfaceBorder,
  },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: { fontSize: Typography.size.base, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  headerSub: { fontSize: Typography.size.xs, color: Colors.textTertiary, marginTop: 2 },

  infoBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm,
    backgroundColor: Colors.primaryDim, borderBottomWidth: 1, borderBottomColor: Colors.primary + '30',
    paddingHorizontal: Spacing.base, paddingVertical: Spacing.md,
  },
  infoText: { flex: 1, fontSize: Typography.size.xs, color: Colors.primary, lineHeight: 16 },

  content: { padding: Spacing.base, gap: Spacing.md },

  nicheCard: {
    backgroundColor: Colors.surface, borderRadius: Radius.xl,
    borderWidth: 1, borderColor: Colors.surfaceBorder,
    padding: Spacing.base, gap: Spacing.sm, ...Shadow.sm,
    position: 'relative',
    overflow: 'hidden',
  },
  activeBadge: {
    position: 'absolute', top: Spacing.md, right: Spacing.md,
    borderRadius: Radius.pill, paddingHorizontal: 8, paddingVertical: 3,
  },
  activeBadgeText: { fontSize: 9, fontWeight: Typography.weight.extrabold, color: Colors.background, letterSpacing: 0.5 },

  nicheCardRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md },
  nicheIcon: {
    width: 52, height: 52, borderRadius: Radius.lg,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  nicheInfo: { flex: 1, gap: 3 },
  nicheName: { fontSize: Typography.size.base, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  nicheTagline: { fontSize: Typography.size.xs, color: Colors.textTertiary, lineHeight: 16 },
  nicheMetaRow: { flexDirection: 'row', gap: Spacing.xs, marginTop: 2 },
  nichePill: {
    backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.pill,
    paddingHorizontal: 7, paddingVertical: 3, borderWidth: 1, borderColor: Colors.surfaceBorder,
  },
  nichePillText: { fontSize: 9, color: Colors.textTertiary, fontWeight: Typography.weight.medium },

  enableBtn: {
    width: 36, height: 36, borderRadius: Radius.md,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.surfaceBorder,
    backgroundColor: Colors.surfaceHighlight,
  },

  specialistsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  specialistChip: {
    backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.sm,
    paddingHorizontal: 7, paddingVertical: 3,
  },
  specialistChipText: { fontSize: 9, color: Colors.textSecondary },

  sourcesRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  sourcesText: { flex: 1, fontSize: 9, color: Colors.textTertiary },

  comingSoonCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md,
    backgroundColor: Colors.surface, borderRadius: Radius.xl,
    borderWidth: 1, borderColor: Colors.surfaceBorder, borderStyle: 'dashed',
    padding: Spacing.base,
  },
  comingSoonTitle: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.textSecondary },
  comingSoonText: { fontSize: Typography.size.xs, color: Colors.textTertiary, lineHeight: 16, marginTop: 3 },

  archNote: {
    backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.lg,
    padding: Spacing.base, gap: Spacing.xs,
    borderWidth: 1, borderColor: Colors.surfaceBorder,
  },
  archNoteTitle: { fontSize: 9, fontWeight: Typography.weight.bold, color: Colors.primary, letterSpacing: 0.6 },
  archNoteText: { fontSize: Typography.size.xs, color: Colors.textTertiary, lineHeight: 16 },

  doneBar: {
    padding: Spacing.base, backgroundColor: Colors.surface,
    borderTopWidth: 1, borderTopColor: Colors.surfaceBorder,
  },
  doneBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: Spacing.sm, backgroundColor: Colors.primary, borderRadius: Radius.md,
    padding: Spacing.base, ...Shadow.glow,
  },
  doneBtnText: { fontSize: Typography.size.base, fontWeight: Typography.weight.bold, color: Colors.background },
});
