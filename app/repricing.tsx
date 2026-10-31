// SWISH Repricing Engine
// Stale listing detection, AI price suggestions, repricing rules editor.

import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, Modal,
  FlatList, ActivityIndicator, Switch, Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors, Typography, Spacing, Radius, Shadow } from '@/constants/theme';
import { useRepricing } from '@/hooks/useRepricing';
import { useAlert } from '@/template';
import { useApp } from '@/hooks/useApp';
import {
  RULE_TEMPLATES,
  REPRICE_STRATEGY_LABELS,
  URGENCY_CONFIG,
  StaleListingInfo,
  RepricingRule,
} from '@/services/repricingService';
import { SPECIALISTS } from '@/constants/specialists';

// ── Helpers ────────────────────────────────────────────────────────────────

const fmt = (v: number) => `£${v.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtPct = (v: number) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`;

type Tab = 'stale' | 'rules';

// ── Stale Listing Card ────────────────────────────────────────────────────

function StaleListingCard({
  listing,
  suggestion,
  suggestionLoading,
  onGetSuggestion,
  onApply,
}: {
  listing: StaleListingInfo;
  suggestion?: any;
  suggestionLoading: boolean;
  onGetSuggestion: () => void;
  onApply: (price: number) => void;
}) {
  const specialist = SPECIALISTS[listing.specialistId as keyof typeof SPECIALISTS];
  const urgency = suggestion ? URGENCY_CONFIG[suggestion.urgency as keyof typeof URGENCY_CONFIG] : null;
  const isPositiveChange = suggestion && suggestion.priceChangePct < 0;
  const hasChange = suggestion && suggestion.suggestedPrice !== listing.price;

  return (
    <View style={cardStyles.card}>
      {/* Header */}
      <View style={cardStyles.header}>
        <View style={[cardStyles.specialistDot, { backgroundColor: specialist?.color ?? Colors.primary }]} />
        <View style={cardStyles.flex}>
          <Text style={cardStyles.title} numberOfLines={2}>{listing.itemTitle}</Text>
          <Text style={cardStyles.listingTitle} numberOfLines={1}>{listing.title}</Text>
        </View>
        {urgency ? (
          <View style={[cardStyles.urgencyBadge, { backgroundColor: urgency.color + '20' }]}>
            <View style={[cardStyles.urgencyDot, { backgroundColor: urgency.color }]} />
            <Text style={[cardStyles.urgencyText, { color: urgency.color }]}>{urgency.label}</Text>
          </View>
        ) : null}
      </View>

      {/* Stats strip */}
      <View style={cardStyles.statsRow}>
        <View style={cardStyles.statItem}>
          <Text style={cardStyles.statValue}>{fmt(listing.price)}</Text>
          <Text style={cardStyles.statLabel}>Current</Text>
        </View>
        <View style={cardStyles.statItem}>
          <MaterialIcons name="schedule" size={11} color={listing.daysListed > 14 ? Colors.warning : Colors.textTertiary} />
          <Text style={[cardStyles.statValue, listing.daysListed > 14 ? { color: Colors.warning } : undefined]}>
            {listing.daysListed}d
          </Text>
          <Text style={cardStyles.statLabel}>Listed</Text>
        </View>
        <View style={cardStyles.statItem}>
          <Text style={cardStyles.statValue}>{listing.views}</Text>
          <Text style={cardStyles.statLabel}>Views</Text>
        </View>
        <View style={cardStyles.statItem}>
          <Text style={[cardStyles.statValue, listing.watchers > 0 ? { color: Colors.info } : undefined]}>
            {listing.watchers}
          </Text>
          <Text style={cardStyles.statLabel}>Watchers</Text>
        </View>
        <View style={cardStyles.statItem}>
          <Text style={cardStyles.statValue}>{listing.marketplaceId}</Text>
          <Text style={cardStyles.statLabel}>Platform</Text>
        </View>
      </View>

      {/* AI Suggestion */}
      {suggestion ? (
        <View style={cardStyles.suggestionBox}>
          <View style={cardStyles.suggestionHeader}>
            <MaterialIcons name="auto-awesome" size={13} color={Colors.accent} />
            <Text style={cardStyles.suggestionLabel}>AI Recommendation</Text>
            <View style={[cardStyles.confBadge, {
              backgroundColor: suggestion.confidence === 'high' ? Colors.successDim : suggestion.confidence === 'medium' ? Colors.warningDim : Colors.infoDim,
            }]}>
              <Text style={[cardStyles.confText, {
                color: suggestion.confidence === 'high' ? Colors.success : suggestion.confidence === 'medium' ? Colors.warning : Colors.info,
              }]}>
                {suggestion.confidence} confidence
              </Text>
            </View>
          </View>

          <View style={cardStyles.priceRow}>
            <View style={cardStyles.priceBox}>
              <Text style={cardStyles.priceLabel}>Suggested</Text>
              <Text style={[cardStyles.priceValue, { color: Colors.gold }]}>{fmt(suggestion.suggestedPrice)}</Text>
            </View>
            <MaterialIcons name="arrow-forward" size={16} color={Colors.textTertiary} />
            <View style={cardStyles.priceBox}>
              <Text style={cardStyles.priceLabel}>Change</Text>
              <Text style={[cardStyles.priceValue, { color: suggestion.priceChangePct < 0 ? Colors.warning : Colors.success }]}>
                {fmtPct(suggestion.priceChangePct)}
              </Text>
            </View>
            <View style={cardStyles.priceBox}>
              <Text style={cardStyles.priceLabel}>Sale Prob +</Text>
              <Text style={[cardStyles.priceValue, { color: Colors.success }]}>
                +{Math.round(suggestion.estimatedSaleProbabilityUplift * 100)}%
              </Text>
            </View>
          </View>

          <Text style={cardStyles.rationale}>{suggestion.rationale}</Text>

          <View style={cardStyles.strategyRow}>
            <View style={cardStyles.strategyChip}>
              <Text style={cardStyles.strategyText}>
                {REPRICE_STRATEGY_LABELS[suggestion.strategy] ?? suggestion.strategy}
              </Text>
            </View>
            <View style={cardStyles.priceRange}>
              <Text style={cardStyles.priceRangeText}>
                Floor {fmt(suggestion.floorPrice)} · Ceiling {fmt(suggestion.ceilingPrice)}
              </Text>
            </View>
          </View>

          {hasChange ? (
            <Pressable
              onPress={() => onApply(suggestion.suggestedPrice)}
              style={({ pressed }) => [cardStyles.applyBtn, pressed && { opacity: 0.85 }]}
            >
              <MaterialIcons name="price-change" size={15} color={Colors.background} />
              <Text style={cardStyles.applyBtnText}>Apply {fmt(suggestion.suggestedPrice)}</Text>
            </Pressable>
          ) : (
            <View style={cardStyles.holdNote}>
              <MaterialIcons name="check-circle" size={13} color={Colors.success} />
              <Text style={cardStyles.holdNoteText}>Price is optimal — hold current price</Text>
            </View>
          )}
        </View>
      ) : null}

      {/* Action */}
      {!suggestion ? (
        <Pressable
          onPress={onGetSuggestion}
          disabled={suggestionLoading}
          style={({ pressed }) => [cardStyles.aiBtn, pressed && { opacity: 0.85 }, suggestionLoading && { opacity: 0.7 }]}
        >
          {suggestionLoading ? (
            <ActivityIndicator size="small" color={Colors.background} />
          ) : (
            <>
              <MaterialIcons name="auto-awesome" size={15} color={Colors.background} />
              <Text style={cardStyles.aiBtnText}>Get AI Suggestion</Text>
            </>
          )}
        </Pressable>
      ) : null}
    </View>
  );
}

const cardStyles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface, borderRadius: Radius.xl, padding: Spacing.base,
    gap: Spacing.md, borderWidth: 1, borderColor: Colors.surfaceBorder, ...Shadow.sm,
  },
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  specialistDot: { width: 8, height: 8, borderRadius: 4, marginTop: 5, flexShrink: 0 },
  title: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.textPrimary, lineHeight: 18 },
  listingTitle: { fontSize: Typography.size.xs, color: Colors.textTertiary, marginTop: 2 },
  urgencyBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 7, paddingVertical: 3, borderRadius: Radius.pill, flexShrink: 0,
  },
  urgencyDot: { width: 5, height: 5, borderRadius: 3 },
  urgencyText: { fontSize: 10, fontWeight: Typography.weight.bold },

  statsRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.md, padding: Spacing.md,
  },
  statItem: { alignItems: 'center', gap: 2 },
  statValue: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  statLabel: { fontSize: 9, color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.3 },

  suggestionBox: {
    backgroundColor: Colors.accentDim, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.sm,
    borderWidth: 1, borderColor: Colors.accent + '30',
  },
  suggestionHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  suggestionLabel: { flex: 1, fontSize: Typography.size.xs, fontWeight: Typography.weight.semibold, color: Colors.accent, textTransform: 'uppercase', letterSpacing: 0.4 },
  confBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: Radius.pill },
  confText: { fontSize: 9, fontWeight: Typography.weight.bold, textTransform: 'uppercase', letterSpacing: 0.3 },

  priceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', gap: Spacing.sm },
  priceBox: { alignItems: 'center', gap: 2 },
  priceLabel: { fontSize: 9, color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.3 },
  priceValue: { fontSize: Typography.size.md, fontWeight: Typography.weight.bold, color: Colors.textPrimary },

  rationale: { fontSize: Typography.size.xs, color: Colors.textSecondary, lineHeight: 17 },

  strategyRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  strategyChip: {
    backgroundColor: Colors.accent + '30', borderRadius: Radius.pill,
    paddingHorizontal: Spacing.sm, paddingVertical: 3,
  },
  strategyText: { fontSize: 10, color: Colors.accent, fontWeight: Typography.weight.bold },
  priceRange: { flex: 1 },
  priceRangeText: { fontSize: 10, color: Colors.textTertiary },

  applyBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: Spacing.xs, backgroundColor: Colors.primary, borderRadius: Radius.md,
    paddingVertical: Spacing.sm, ...Shadow.sm,
  },
  applyBtnText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.background },
  holdNote: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: Colors.successDim, borderRadius: Radius.sm, padding: Spacing.sm,
  },
  holdNoteText: { fontSize: Typography.size.xs, color: Colors.success },

  aiBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: Spacing.xs, backgroundColor: Colors.accent, borderRadius: Radius.md,
    paddingVertical: Spacing.sm,
  },
  aiBtnText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.background },
});

// ── Rule Card ─────────────────────────────────────────────────────────────

function RuleCard({
  rule,
  onToggle,
  onDelete,
}: {
  rule: RepricingRule;
  onToggle: (isActive: boolean) => void;
  onDelete: () => void;
}) {
  const cond = rule.triggerCondition;
  const isAI = cond.use_ai === true;

  let conditionText = '';
  if (rule.ruleType === 'time_decay') {
    conditionText = `After ${cond.days_listed ?? '?'} days → ${cond.action === 'reduce_by_pct' ? `reduce by ${cond.value}%` : cond.action}`;
  } else if (rule.ruleType === 'watchers_based') {
    conditionText = `${cond.min_watchers ?? '?'}+ watchers, no sale in ${cond.days_since_watcher ?? '?'}d → reduce by ${cond.value}%`;
  } else if (isAI) {
    conditionText = `AI-driven repricing after ${cond.trigger_days ?? 7} days`;
  } else {
    conditionText = JSON.stringify(cond).slice(0, 60);
  }

  return (
    <View style={[ruleCardStyles.card, !rule.isActive && ruleCardStyles.cardInactive]}>
      <View style={ruleCardStyles.header}>
        <View style={[ruleCardStyles.typeIcon, { backgroundColor: isAI ? Colors.accentDim : Colors.primaryDim }]}>
          <MaterialIcons
            name={isAI ? 'auto-awesome' : rule.ruleType === 'time_decay' ? 'schedule' : 'visibility'}
            size={16}
            color={isAI ? Colors.accent : Colors.primary}
          />
        </View>
        <View style={ruleCardStyles.flex}>
          <Text style={[ruleCardStyles.ruleType, !rule.isActive && { color: Colors.textTertiary }]}>
            {rule.ruleType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
          </Text>
          <Text style={ruleCardStyles.conditionText}>{conditionText}</Text>
          {rule.floorPrice !== undefined ? (
            <Text style={ruleCardStyles.floorText}>Floor: {fmt(rule.floorPrice)}</Text>
          ) : null}
        </View>
        <Switch
          value={rule.isActive}
          onValueChange={onToggle}
          trackColor={{ false: Colors.surfaceHighlight, true: Colors.primaryDim }}
          thumbColor={rule.isActive ? Colors.primary : Colors.textTertiary}
        />
      </View>
      <View style={ruleCardStyles.footer}>
        <Text style={ruleCardStyles.createdAt}>
          Created {new Date(rule.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
        </Text>
        <Pressable onPress={onDelete} style={ruleCardStyles.deleteBtn}>
          <MaterialIcons name="delete-outline" size={14} color={Colors.danger} />
          <Text style={ruleCardStyles.deleteBtnText}>Remove</Text>
        </Pressable>
      </View>
    </View>
  );
}

const ruleCardStyles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: Spacing.md,
    gap: Spacing.sm, borderWidth: 1, borderColor: Colors.surfaceBorder,
  },
  cardInactive: { opacity: 0.6 },
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  typeIcon: { width: 36, height: 36, borderRadius: Radius.sm, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  ruleType: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.textPrimary },
  conditionText: { fontSize: Typography.size.xs, color: Colors.textSecondary, marginTop: 2, lineHeight: 16 },
  floorText: { fontSize: Typography.size.xs, color: Colors.textTertiary, marginTop: 2 },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  createdAt: { fontSize: Typography.size.xs, color: Colors.textTertiary },
  deleteBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  deleteBtnText: { fontSize: Typography.size.xs, color: Colors.danger },
});

// ── Add Rule Modal ────────────────────────────────────────────────────────

function AddRuleModal({
  visible,
  onClose,
  onSave,
}: {
  visible: boolean;
  onClose: () => void;
  onSave: (template: typeof RULE_TEMPLATES[0]) => Promise<void>;
}) {
  const insets = useSafeAreaInsets();
  const [saving, setSaving] = useState<string | null>(null);

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={modalStyles.overlay}>
        <View style={[modalStyles.card, { paddingBottom: insets.bottom + Spacing.base }]}>
          <View style={modalStyles.header}>
            <Text style={modalStyles.title}>Add Repricing Rule</Text>
            <Pressable onPress={onClose}>
              <MaterialIcons name="close" size={22} color={Colors.textSecondary} />
            </Pressable>
          </View>
          <Text style={modalStyles.subtitle}>
            Rules run automatically against your active listings. All rules respect configured floor prices.
          </Text>
          <ScrollView showsVerticalScrollIndicator={false}>
            <View style={modalStyles.templates}>
              {RULE_TEMPLATES.map(t => (
                <Pressable
                  key={t.id}
                  onPress={async () => {
                    setSaving(t.id);
                    await onSave(t);
                    setSaving(null);
                    onClose();
                  }}
                  disabled={saving !== null}
                  style={({ pressed }) => [
                    modalStyles.templateCard,
                    pressed && { opacity: 0.88 },
                    t.ruleType === 'competition' && modalStyles.templateCardAI,
                  ]}
                >
                  <View style={[modalStyles.templateIcon, { backgroundColor: t.ruleType === 'competition' ? Colors.accentDim : Colors.primaryDim }]}>
                    {saving === t.id ? (
                      <ActivityIndicator size="small" color={t.ruleType === 'competition' ? Colors.accent : Colors.primary} />
                    ) : (
                      <MaterialIcons
                        name={t.icon as any}
                        size={20}
                        color={t.ruleType === 'competition' ? Colors.accent : Colors.primary}
                      />
                    )}
                  </View>
                  <View style={modalStyles.flex}>
                    <Text style={modalStyles.templateName}>{t.name}</Text>
                    <Text style={modalStyles.templateDesc}>{t.description}</Text>
                  </View>
                  <MaterialIcons name="add-circle" size={20} color={t.ruleType === 'competition' ? Colors.accent : Colors.primary} />
                </Pressable>
              ))}
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const modalStyles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: Colors.overlay80, justifyContent: 'flex-end' },
  card: {
    backgroundColor: Colors.surfaceElevated, borderTopLeftRadius: Radius.xxl,
    borderTopRightRadius: Radius.xxl, padding: Spacing.xl, gap: Spacing.md,
    borderTopWidth: 1, borderColor: Colors.surfaceBorder, maxHeight: '80%',
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: Typography.size.xl, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  subtitle: { fontSize: Typography.size.sm, color: Colors.textTertiary, lineHeight: 18 },
  flex: { flex: 1 },
  templates: { gap: Spacing.sm },
  templateCard: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: Spacing.md,
    borderWidth: 1, borderColor: Colors.surfaceBorder,
  },
  templateCardAI: { borderColor: Colors.accent + '40', backgroundColor: Colors.accentDim + '60' },
  templateIcon: { width: 44, height: 44, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  templateName: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.textPrimary },
  templateDesc: { fontSize: Typography.size.xs, color: Colors.textTertiary, marginTop: 2, lineHeight: 15 },
});

// ── Main Screen ────────────────────────────────────────────────────────────

export default function RepricingScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { showAlert } = useAlert();
  const { activeNicheId, fixedNicheId } = useApp();
  const isThreadsFlip = (fixedNicheId ?? activeNicheId) === 'clothing';
  const threads = { background: '#0C080C', surface: '#160E16', border: '#301830', pink: '#E91E8C', cream: '#FFF0F5', muted: '#9A7090' };
  const [activeTab, setActiveTab] = useState<Tab>('stale');
  const [showAddRule, setShowAddRule] = useState(false);

  const {
    rules, activeRules, staleListings, loading,
    suggestionLoading, suggestions,
    addRule, toggleRule, removeRule,
    getAISuggestion, applyPrice, reload,
  } = useRepricing();

  const handleApplyPrice = useCallback(async (listingId: string, price: number, title: string) => {
    showAlert(
      'Apply Repricing',
      `Update "${title}" to ${fmt(price)}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Apply',
          onPress: async () => {
            const { error } = await applyPrice(listingId, price);
            if (error) showAlert('Failed', error);
            else showAlert('Repriced', `Price updated to ${fmt(price)}`);
          },
        },
      ]
    );
  }, [applyPrice, showAlert]);

  const handleDeleteRule = useCallback((ruleId: string) => {
    showAlert('Remove Rule', 'Delete this repricing rule?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => removeRule(ruleId) },
    ]);
  }, [removeRule, showAlert]);

  const handleAddRuleFromTemplate = useCallback(async (template: typeof RULE_TEMPLATES[0]) => {
    const { error } = await addRule({
      ruleType: template.ruleType,
      triggerCondition: template.defaultCondition,
    });
    if (error) showAlert('Error', error);
  }, [addRule, showAlert]);

  const staleCount = staleListings.length;
  const pendingSuggestions = Object.keys(suggestions).length;

  return (
    <View testID={isThreadsFlip ? 'threads-flip-screen-repricing' : undefined} accessibilityLabel={isThreadsFlip ? 'Threads Flip repricing tools' : undefined} style={[styles.container, isThreadsFlip && { backgroundColor: threads.background }]}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + Spacing.base }, isThreadsFlip && { backgroundColor: threads.surface, borderBottomColor: threads.border }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
          <MaterialIcons name="arrow-back" size={20} color={Colors.textSecondary} />
        </Pressable>
        <Pressable onPress={() => router.replace('/(tabs)' as any)} style={styles.homeBtn} hitSlop={8}>
          <MaterialIcons name="dashboard" size={16} color={Colors.textTertiary} />
        </Pressable>
        <View style={styles.flex}>
          <Text style={[styles.title, isThreadsFlip && { color: threads.cream }]}>Threads Flip · Repricing</Text>
          <Text style={[styles.subtitle, isThreadsFlip && { color: threads.muted }]}>
            {staleCount} stale listing{staleCount !== 1 ? 's' : ''} · {activeRules.length} active rule{activeRules.length !== 1 ? 's' : ''}
          </Text>
        </View>
      </View>

      {/* Summary strip */}
      <View style={[styles.summaryStrip, isThreadsFlip && { backgroundColor: threads.surface, borderColor: threads.border }]}>
        {[
          { label: 'Stale Listings', value: staleCount, color: staleCount > 5 ? Colors.warning : Colors.textPrimary },
          { label: 'AI Suggestions', value: pendingSuggestions, color: pendingSuggestions > 0 ? Colors.accent : Colors.textTertiary },
          { label: 'Active Rules', value: activeRules.length, color: Colors.primary },
          { label: 'Total Rules', value: rules.length, color: Colors.textTertiary },
        ].map(s => (
          <View key={s.label} style={styles.summaryItem}>
            <Text style={[styles.summaryValue, { color: s.color }]}>{s.value}</Text>
            <Text style={styles.summaryLabel}>{s.label}</Text>
          </View>
        ))}
      </View>

      {/* Tab bar */}
      <View style={[styles.tabBar, isThreadsFlip && { backgroundColor: threads.surface, borderBottomColor: threads.border } ]}>
        {([
          { id: 'stale', label: 'Stale Listings', icon: 'access-time', count: staleCount },
          { id: 'rules', label: 'Rules', icon: 'rule', count: rules.length },
        ] as const).map(t => (
          <Pressable
            key={t.id}
            onPress={() => setActiveTab(t.id)}
            style={[styles.tab, activeTab === t.id && styles.tabActive, isThreadsFlip && activeTab === t.id && { backgroundColor: '#250014' }]}
          >
            <MaterialIcons name={t.icon as any} size={15} color={activeTab === t.id ? (isThreadsFlip ? threads.pink : Colors.primary) : Colors.textTertiary} />
            <Text style={[styles.tabText, activeTab === t.id && styles.tabTextActive, isThreadsFlip && activeTab === t.id && { color: threads.pink } ]}>{t.label}</Text>
            {t.count > 0 ? (
              <View style={[styles.tabBadge, activeTab === t.id && styles.tabBadgeActive, isThreadsFlip && activeTab === t.id && { backgroundColor: threads.pink + '30' } ]}>
                <Text style={[styles.tabBadgeText, activeTab === t.id && styles.tabBadgeTextActive, isThreadsFlip && activeTab === t.id && { color: threads.pink } ]}>{t.count}</Text>
              </View>
            ) : null}
          </Pressable>
        ))}
      </View>

      {loading ? (
        <View style={[styles.loading, isThreadsFlip && { backgroundColor: threads.background }]}><ActivityIndicator color={isThreadsFlip ? threads.pink : Colors.primary} size="large" /></View>
      ) : activeTab === 'stale' ? (
        <FlatList
          style={isThreadsFlip ? { backgroundColor: threads.background } : undefined}
          data={staleListings}
          keyExtractor={l => l.id}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 100 }, isThreadsFlip && { backgroundColor: threads.background } ]}
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => <View style={{ height: Spacing.md }} />}
          renderItem={({ item }) => (
            <StaleListingCard
              listing={item}
              suggestion={suggestions[item.id]}
              suggestionLoading={suggestionLoading[item.id] ?? false}
              onGetSuggestion={() => getAISuggestion(item)}
              onApply={(price) => handleApplyPrice(item.id, price, item.itemTitle)}
            />
          )}
          ListHeaderComponent={
            staleListings.length > 0 ? (
              <Pressable
                onPress={() => staleListings.slice(0, 5).forEach(l => { if (!suggestions[l.id]) getAISuggestion(l); })}
                style={({ pressed }) => [styles.bulkSuggestBtn, isThreadsFlip && { backgroundColor: threads.pink }, pressed && { opacity: 0.85 }]}
              >
                <MaterialIcons name="auto-awesome" size={16} color={isThreadsFlip ? threads.background : Colors.background} />
                <Text style={[styles.bulkSuggestText, isThreadsFlip && { color: threads.background }]}>Get AI Suggestions for All</Text>
              </Pressable>
            ) : null
          }
          ListEmptyComponent={
            <View style={[styles.empty, isThreadsFlip && { backgroundColor: threads.surface, borderColor: threads.border }]}>
              <MaterialIcons name="check-circle" size={48} color={Colors.success} />
              <Text style={[styles.emptyTitle, isThreadsFlip && { color: threads.cream }]}>No Stale Listings</Text>
              <Text style={[styles.emptyText, isThreadsFlip && { color: threads.muted }]}>All your listings are fresh and active. Check back after 7 days.</Text>
            </View>
          }
        />
      ) : (
        <ScrollView
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 100 }]}
          showsVerticalScrollIndicator={false}
        >
          <Pressable
            onPress={() => setShowAddRule(true)}
            style={({ pressed }) => [styles.addRuleBtn, isThreadsFlip && { backgroundColor: '#250014', borderColor: threads.pink }, pressed && { opacity: 0.85 }]}
          >
            <MaterialIcons name="add" size={18} color={isThreadsFlip ? threads.pink : Colors.primary} />
            <Text style={[styles.addRuleBtnText, isThreadsFlip && { color: threads.pink }]}>Add Repricing Rule</Text>
          </Pressable>

          {rules.length === 0 ? (
            <View style={styles.empty}>
              <MaterialIcons name="rule" size={48} color={Colors.textTertiary} />
              <Text style={styles.emptyTitle}>No Rules Yet</Text>
              <Text style={styles.emptyText}>
                Create repricing rules to automatically reduce prices on stale listings.
              </Text>
            </View>
          ) : (
            <View style={styles.rulesList}>
              {rules.map(rule => (
                <RuleCard
                  key={rule.id}
                  rule={rule}
                  onToggle={(active) => toggleRule(rule.id, active)}
                  onDelete={() => handleDeleteRule(rule.id)}
                />
              ))}
            </View>
          )}

          {/* Info card */}
          <View style={[styles.infoCard, isThreadsFlip && { backgroundColor: threads.surface, borderColor: threads.border }]}>
            <MaterialIcons name="info-outline" size={14} color={Colors.info} />
            <Text style={[styles.infoText, isThreadsFlip && { color: threads.muted }]}>
              Repricing rules run against all active listings that match the trigger conditions.
              AI Smart Reprice uses OnSpace AI to analyse each listing individually.
              Floor prices are always respected — prices never drop below acquisition cost.
            </Text>
          </View>
        </ScrollView>
      )}

      <AddRuleModal
        visible={showAddRule}
        onClose={() => setShowAddRule(false)}
        onSave={handleAddRuleFromTemplate}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },

  header: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingHorizontal: Spacing.base, paddingBottom: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder,
  },
  backBtn: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.surfaceBorder },
  homeBtn: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.surfaceBorder },
  title: { fontSize: Typography.size.xl, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  subtitle: { fontSize: Typography.size.xs, color: Colors.textTertiary, marginTop: 2 },

  summaryStrip: {
    flexDirection: 'row', justifyContent: 'space-around',
    paddingVertical: Spacing.md, paddingHorizontal: Spacing.base,
    borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder,
    backgroundColor: Colors.surface,
  },
  summaryItem: { alignItems: 'center', gap: 3 },
  summaryValue: { fontSize: Typography.size.xl, fontWeight: Typography.weight.extrabold, color: Colors.textPrimary },
  summaryLabel: { fontSize: Typography.size.xs - 1, color: Colors.textTertiary, textAlign: 'center' },

  tabBar: {
    flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder,
    paddingHorizontal: Spacing.base, gap: Spacing.sm, paddingVertical: Spacing.sm,
  },
  tab: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 5, paddingVertical: Spacing.sm, borderRadius: Radius.md,
  },
  tabActive: { backgroundColor: Colors.primaryDim },
  tabText: { fontSize: Typography.size.xs, color: Colors.textTertiary, fontWeight: Typography.weight.medium },
  tabTextActive: { color: Colors.primary },
  tabBadge: {
    minWidth: 18, height: 18, borderRadius: Radius.pill,
    backgroundColor: Colors.surfaceHighlight, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4,
  },
  tabBadgeActive: { backgroundColor: Colors.primary + '30' },
  tabBadgeText: { fontSize: 9, fontWeight: Typography.weight.bold, color: Colors.textTertiary },
  tabBadgeTextActive: { color: Colors.primary },

  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: Spacing.base, gap: Spacing.md },
  rulesList: { gap: Spacing.sm },

  bulkSuggestBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: Spacing.xs, backgroundColor: Colors.accent,
    borderRadius: Radius.md, paddingVertical: Spacing.md, marginBottom: Spacing.md,
  },
  bulkSuggestText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.background },

  addRuleBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: Spacing.xs, backgroundColor: Colors.primaryDim,
    borderRadius: Radius.md, paddingVertical: Spacing.md, marginBottom: Spacing.md,
    borderWidth: 1, borderColor: Colors.primary + '40',
  },
  addRuleBtnText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.primary },

  infoCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm,
    backgroundColor: Colors.infoDim, borderRadius: Radius.md, padding: Spacing.md,
    marginTop: Spacing.md, borderWidth: 1, borderColor: Colors.info + '30',
  },
  infoText: { flex: 1, fontSize: Typography.size.xs, color: Colors.textSecondary, lineHeight: 17 },

  empty: { alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.hero },
  emptyTitle: { fontSize: Typography.size.lg, fontWeight: Typography.weight.semibold, color: Colors.textSecondary },
  emptyText: { fontSize: Typography.size.sm, color: Colors.textTertiary, textAlign: 'center', lineHeight: 20 },
});
