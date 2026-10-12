// SWISH Command Centre — Commercial Intelligence Dashboard
//
// Decision-focused view answering:
//   WHAT should I do?
//   WHY?
//   WHAT EFFECT will it have?
//   HOW CONFIDENT is SWISH?
//
// This is a full-screen page, accessible from the dashboard.
// It computes next actions fresh on each load.

import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  RefreshControl, ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors, Typography, Spacing, Radius, Shadow } from '@/constants/theme';
import { useApp } from '@/hooks/useApp';
import {
  computeNextActions, dismissNextAction, saveNextActions,
  loadNextActions, getIntelligenceSummary,
  getTenantTier, getEntitlements,
  type NextAction, type IntelligenceSummary,
} from '@/services/commercialEngine';
import { computeCapitalState, type CapitalState } from '@/services/capitalService';

// ── Action type config ─────────────────────────────────────────────────────────

const ACTION_CONFIG: Record<string, { icon: string; color: string; route?: string }> = {
  dispatch_orders:       { icon: 'local-shipping', color: Colors.warning, route: '/dispatch' },
  publish_drafts:        { icon: 'publish',        color: Colors.primary, route: '/(tabs)/listings' },
  add_images:            { icon: 'add-photo-alternate', color: Colors.info, route: '/(tabs)/inventory' },
  list_items:            { icon: 'receipt-long',   color: Colors.success, route: '/(tabs)/inventory' },
  review_stale_listings: { icon: 'hourglass-empty', color: Colors.warning, route: '/(tabs)/listings' },
  push_updates_to_ebay:  { icon: 'cloud-upload',  color: Colors.accent,  route: '/settings' },
  reprice_items:         { icon: 'price-change',   color: Colors.gold,    route: '/repricing' },
  default:               { icon: 'lightbulb',      color: Colors.primary },
};

function getActionConfig(actionType: string) {
  return ACTION_CONFIG[actionType] ?? ACTION_CONFIG['default'];
}

// ── Priority badge ─────────────────────────────────────────────────────────────

function PriorityBadge({ priority }: { priority: number }) {
  const color = priority >= 85 ? Colors.danger : priority >= 65 ? Colors.warning : Colors.textTertiary;
  const label = priority >= 85 ? 'Urgent' : priority >= 65 ? 'Important' : 'Suggested';
  return (
    <View style={[pb.wrap, { backgroundColor: color + '20' }]}>
      <View style={[pb.dot, { backgroundColor: color }]} />
      <Text style={[pb.text, { color }]}>{label}</Text>
    </View>
  );
}
const pb = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 6, paddingVertical: 3, borderRadius: Radius.pill },
  dot: { width: 5, height: 5, borderRadius: 3 },
  text: { fontSize: 9, fontWeight: Typography.weight.bold },
});

// ── Next Action Card ───────────────────────────────────────────────────────────

function ActionCard({
  action, onDismiss, onNavigate,
}: {
  action: NextAction;
  onDismiss: (id: string) => void;
  onNavigate: (route: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const cfg = getActionConfig(action.actionType);

  return (
    <Pressable
      onPress={() => setExpanded(e => !e)}
      style={({ pressed }) => [ac.card, pressed && { opacity: 0.94 }]}
    >
      {/* Main row */}
      <View style={ac.row}>
        <View style={[ac.iconWrap, { backgroundColor: cfg.color + '18' }]}>
          <MaterialIcons name={cfg.icon as any} size={20} color={cfg.color} />
        </View>
        <View style={ac.content}>
          <View style={ac.titleRow}>
            <Text style={ac.title} numberOfLines={expanded ? undefined : 2}>{action.title}</Text>
            <PriorityBadge priority={action.priority} />
          </View>
          <Text style={ac.description} numberOfLines={expanded ? undefined : 1}>
            {action.description}
          </Text>
          {action.estimatedMinutes != null ? (
            <View style={ac.timeRow}>
              <MaterialIcons name="schedule" size={10} color={Colors.textTertiary} />
              <Text style={ac.timeText}>~{action.estimatedMinutes} min</Text>
            </View>
          ) : null}
        </View>
        <MaterialIcons
          name={expanded ? 'expand-less' : 'expand-more'}
          size={16}
          color={Colors.textTertiary}
        />
      </View>

      {/* Expanded detail */}
      {expanded ? (
        <View style={ac.expandedBody}>
          <View style={ac.whyRow}>
            <MaterialIcons name="info-outline" size={12} color={Colors.info} style={{ marginTop: 1 }} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={ac.whyLabel}>WHY THIS MATTERS</Text>
              <Text style={ac.whyText}>{action.why}</Text>
            </View>
          </View>

          {action.expectedBenefit ? (
            <View style={ac.benefitRow}>
              <MaterialIcons name="trending-up" size={12} color={Colors.success} style={{ marginTop: 1 }} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={ac.whyLabel}>EXPECTED BENEFIT</Text>
                <Text style={[ac.whyText, { color: Colors.success }]}>{action.expectedBenefit}</Text>
              </View>
            </View>
          ) : null}

          <View style={ac.actionBtns}>
            {cfg.route ? (
              <Pressable
                onPress={() => onNavigate(cfg.route!)}
                style={({ pressed }) => [ac.goBtn, { backgroundColor: cfg.color }, pressed && { opacity: 0.85 }]}
              >
                <MaterialIcons name="arrow-forward" size={12} color={Colors.background} />
                <Text style={ac.goBtnText}>Do This Now</Text>
              </Pressable>
            ) : null}
            {action.id ? (
              <Pressable
                onPress={() => onDismiss(action.id!)}
                style={({ pressed }) => [ac.dismissBtn, pressed && { opacity: 0.8 }]}
              >
                <MaterialIcons name="close" size={12} color={Colors.textTertiary} />
                <Text style={ac.dismissText}>Dismiss</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}
    </Pressable>
  );
}

const ac = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface, borderRadius: Radius.xl,
    borderWidth: 1, borderColor: Colors.surfaceBorder,
    padding: Spacing.md, gap: Spacing.sm, ...Shadow.sm,
  },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md },
  iconWrap: { width: 40, height: 40, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  content: { flex: 1, gap: 4 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  title: { flex: 1, fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.textPrimary, lineHeight: 18 },
  description: { fontSize: Typography.size.xs, color: Colors.textSecondary, lineHeight: 16 },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  timeText: { fontSize: 9, color: Colors.textTertiary },

  expandedBody: {
    backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.md,
    padding: Spacing.md, gap: Spacing.sm,
    marginTop: Spacing.xs,
  },
  whyRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  benefitRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  whyLabel: { fontSize: 9, fontWeight: Typography.weight.bold, color: Colors.textTertiary, letterSpacing: 0.5, textTransform: 'uppercase' },
  whyText: { fontSize: Typography.size.xs, color: Colors.textSecondary, lineHeight: 16 },

  actionBtns: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.xs },
  goBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: 7 },
  goBtnText: { fontSize: Typography.size.xs, fontWeight: Typography.weight.bold, color: Colors.background },
  dismissBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: Radius.md, paddingHorizontal: Spacing.sm, paddingVertical: 7, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.surfaceBorder },
  dismissText: { fontSize: Typography.size.xs, color: Colors.textTertiary },
});

// ── Capital Snapshot Card ──────────────────────────────────────────────────────

function CapitalCard({ capital }: { capital: CapitalState | null }) {
  if (!capital) return null;

  const roiPct = (capital.roi * 100).toFixed(1);
  const velocityPct = (capital.capitalVelocity * 100).toFixed(1);

  return (
    <View style={cap.card}>
      <View style={cap.header}>
        <View style={[cap.iconWrap, { backgroundColor: Colors.goldDim ?? Colors.warningDim }]}>
          <MaterialIcons name="account-balance-wallet" size={18} color={Colors.gold} />
        </View>
        <View style={cap.flex}>
          <Text style={cap.title}>Capital Engine</Text>
          <Text style={cap.sub}>Your money at work</Text>
        </View>
        <Text style={[cap.roiLabel, { color: capital.totalProfit >= 0 ? Colors.success : Colors.danger }]}>
          {capital.totalProfit >= 0 ? '+' : ''}{roiPct}% ROI
        </Text>
      </View>

      <View style={cap.grid}>
        {[
          { label: 'Available Cash',    value: `£${capital.availableCash.toFixed(0)}`,         color: Colors.success },
          { label: 'Capital in Stock',  value: `£${capital.capitalInStock.toFixed(0)}`,         color: Colors.warning },
          { label: 'Stock Value',       value: `£${capital.totalInventoryValue.toFixed(0)}`,    color: Colors.primary },
          { label: 'Total Profit',      value: `£${capital.totalProfit.toFixed(0)}`,            color: capital.totalProfit >= 0 ? Colors.success : Colors.danger },
        ].map(m => (
          <View key={m.label} style={cap.stat}>
            <Text style={[cap.statValue, { color: m.color }]}>{m.value}</Text>
            <Text style={cap.statLabel}>{m.label}</Text>
          </View>
        ))}
      </View>

      {capital.capitalVelocity > 0 ? (
        <View style={cap.velocityRow}>
          <MaterialIcons name="speed" size={11} color={Colors.info} />
          <Text style={cap.velocityText}>
            Capital velocity: {velocityPct}% profit/month on deployed capital
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const cap = StyleSheet.create({
  card: { backgroundColor: Colors.surface, borderRadius: Radius.xl, borderWidth: 1, borderColor: Colors.surfaceBorder, padding: Spacing.base, gap: Spacing.md, ...Shadow.sm },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  flex: { flex: 1 },
  iconWrap: { width: 40, height: 40, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  sub: { fontSize: Typography.size.xs, color: Colors.textTertiary, marginTop: 1 },
  roiLabel: { fontSize: Typography.size.sm, fontWeight: Typography.weight.extrabold },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  stat: { flex: 1, minWidth: '45%', backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.md, padding: Spacing.sm, gap: 3 },
  statValue: { fontSize: Typography.size.lg, fontWeight: Typography.weight.bold },
  statLabel: { fontSize: 9, color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.3 },
  velocityRow: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingTop: Spacing.xs, borderTopWidth: 1, borderTopColor: Colors.surfaceBorder },
  velocityText: { fontSize: Typography.size.xs, color: Colors.textSecondary, flex: 1 },
});

// ── Intelligence Summary Strip ─────────────────────────────────────────────────

function SummaryStrip({ summary }: { summary: IntelligenceSummary }) {
  const alerts = [
    summary.draftListings > 0 && { icon: 'edit', label: `${summary.draftListings} drafts`, color: Colors.primary },
    summary.staleListing60d > 0 && { icon: 'hourglass-empty', label: `${summary.staleListing60d} stale`, color: Colors.warning },
    summary.itemsNeedingImages > 0 && { icon: 'image-not-supported', label: `${summary.itemsNeedingImages} no photos`, color: Colors.danger },
    summary.stalePushCount > 0 && { icon: 'cloud-upload', label: `${summary.stalePushCount} to push`, color: Colors.accent },
  ].filter(Boolean) as Array<{ icon: string; label: string; color: string }>;

  if (alerts.length === 0) {
    return (
      <View style={ss.greenCard}>
        <MaterialIcons name="check-circle" size={16} color={Colors.success} />
        <Text style={ss.greenText}>All listings up to date — nothing urgent to action</Text>
      </View>
    );
  }

  return (
    <View style={ss.wrap}>
      {alerts.map(a => (
        <View key={a.label} style={[ss.chip, { backgroundColor: a.color + '18' }]}>
          <MaterialIcons name={a.icon as any} size={11} color={a.color} />
          <Text style={[ss.chipText, { color: a.color }]}>{a.label}</Text>
        </View>
      ))}
    </View>
  );
}

const ss = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: Radius.pill, paddingHorizontal: 8, paddingVertical: 5 },
  chipText: { fontSize: 10, fontWeight: Typography.weight.semibold },
  greenCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.successDim, borderRadius: Radius.md, padding: Spacing.md, borderWidth: 1, borderColor: Colors.success + '30' },
  greenText: { flex: 1, fontSize: Typography.size.xs, color: Colors.success, lineHeight: 16 },
});

// ── Opportunity Teaser ─────────────────────────────────────────────────────────

function OpportunityTeaser({
  summary, onPress,
}: { summary: IntelligenceSummary; onPress: () => void }) {
  if (summary.openOpportunities === 0) return null;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [ot.card, pressed && { opacity: 0.9 }]}
    >
      <View style={ot.iconWrap}>
        <MaterialIcons name="search" size={20} color={Colors.gold} />
      </View>
      <View style={ot.content}>
        <Text style={ot.title}>
          {summary.openOpportunities} open acquisition opportunity{summary.openOpportunities > 1 ? 'ies' : 'y'}
        </Text>
        {summary.topOpportunityTitle ? (
          <Text style={ot.sub} numberOfLines={1}>
            Best: {summary.topOpportunityTitle}
            {summary.topOpportunityROI != null ? ` · ${(summary.topOpportunityROI * 100).toFixed(0)}% ROI` : ''}
          </Text>
        ) : null}
      </View>
      <MaterialIcons name="chevron-right" size={16} color={Colors.gold} />
    </Pressable>
  );
}

const ot = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.warningDim ?? Colors.surfaceHighlight, borderRadius: Radius.xl, padding: Spacing.md, borderWidth: 1, borderColor: Colors.gold + '40', ...Shadow.sm },
  iconWrap: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.gold + '20', alignItems: 'center', justifyContent: 'center' },
  content: { flex: 1, gap: 3 },
  title: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.textPrimary },
  sub: { fontSize: Typography.size.xs, color: Colors.textSecondary },
});

// ── Main Screen ────────────────────────────────────────────────────────────────

export default function CommandCentreScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { tenant } = useApp();

  const [actions, setActions] = useState<NextAction[]>([]);
  const [summary, setSummary] = useState<IntelligenceSummary | null>(null);
  const [capital, setCapital] = useState<CapitalState | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [computing, setComputing] = useState(false);

  const load = useCallback(async (forceCompute = false) => {
    if (!tenant?.id) return;
    setLoading(true);
    try {
      const [savedActions, summaryData, capitalData] = await Promise.all([
        loadNextActions(tenant.id),
        getIntelligenceSummary(tenant.id),
        computeCapitalState(tenant.id),
      ]);

      setSummary(summaryData);
      setCapital(capitalData);

      // If no saved actions or forced, compute fresh
      if (savedActions.length === 0 || forceCompute) {
        setComputing(true);
        const freshActions = await computeNextActions(tenant.id);
        await saveNextActions(tenant.id, freshActions);
        setActions(freshActions);
        setComputing(false);
      } else {
        setActions(savedActions);
      }
    } catch (e: any) {
      console.error('[CommandCentre] load error:', e?.message);
    } finally {
      setLoading(false);
    }
  }, [tenant?.id]);

  useEffect(() => { load(); }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load(true);
    setRefreshing(false);
  }, [load]);

  const handleDismiss = useCallback(async (actionId: string) => {
    await dismissNextAction(actionId);
    setActions(prev => prev.filter(a => a.id !== actionId));
  }, []);

  const handleNavigate = useCallback((route: string) => {
    router.push(route as any);
  }, [router]);

  const now = new Date();
  const timeGreeting = now.getHours() < 12 ? 'Good morning' : now.getHours() < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <View style={s.container}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={[s.header, { paddingTop: insets.top + Spacing.base }]}>
        <Pressable onPress={() => router.back()} style={s.backBtn} hitSlop={8}>
          <MaterialIcons name="arrow-back" size={20} color={Colors.textSecondary} />
        </Pressable>
        <View style={s.flex}>
          <Text style={s.title}>Command Centre</Text>
          <Text style={s.subtitle}>{timeGreeting} — here is what SWISH recommends</Text>
        </View>
        <Pressable
          onPress={onRefresh}
          disabled={loading || computing}
          style={[s.refreshBtn, (loading || computing) && { opacity: 0.4 }]}
          hitSlop={8}
        >
          {computing
            ? <ActivityIndicator size="small" color={Colors.primary} />
            : <MaterialIcons name="refresh" size={18} color={Colors.textSecondary} />}
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />
        }
      >
        {loading ? (
          <View style={s.loadingWrap}>
            <ActivityIndicator size="large" color={Colors.primary} />
            <Text style={s.loadingText}>Analysing your business...</Text>
          </View>
        ) : (
          <>
            {/* ── Intelligence summary strip ── */}
            {summary ? (
              <View style={s.section}>
                <Text style={s.sectionTitle}>CURRENT STATUS</Text>
                <SummaryStrip summary={summary} />
              </View>
            ) : null}

            {/* ── Opportunities teaser ── */}
            {summary ? (
              <View style={s.section}>
                <OpportunityTeaser
                  summary={summary}
                  onPress={() => router.push('/opportunities' as any)}
                />
              </View>
            ) : null}

            {/* ── Next Actions ── */}
            <View style={s.section}>
              <View style={s.sectionHeaderRow}>
                <Text style={s.sectionTitle}>
                  RECOMMENDED ACTIONS {actions.length > 0 ? `(${actions.length})` : ''}
                </Text>
                {computing ? (
                  <View style={s.computingRow}>
                    <ActivityIndicator size="small" color={Colors.primary} style={{ width: 12 }} />
                    <Text style={s.computingText}>Analysing...</Text>
                  </View>
                ) : null}
              </View>

              {actions.length === 0 && !computing ? (
                <View style={s.noActionsCard}>
                  <MaterialIcons name="check-circle" size={32} color={Colors.success} />
                  <Text style={s.noActionsTitle}>All clear</Text>
                  <Text style={s.noActionsText}>
                    No urgent actions found. SWISH will alert you when something needs attention.
                  </Text>
                </View>
              ) : (
                <View style={s.actionsList}>
                  {actions.map((action, idx) => (
                    <ActionCard
                      key={action.id ?? idx}
                      action={action}
                      onDismiss={handleDismiss}
                      onNavigate={handleNavigate}
                    />
                  ))}
                </View>
              )}
            </View>

            {/* ── Capital Engine ── */}
            {capital && (capital.totalInvested > 0 || capital.availableCash > 0) ? (
              <View style={s.section}>
                <Text style={s.sectionTitle}>CAPITAL ENGINE</Text>
                <CapitalCard capital={capital} />
              </View>
            ) : null}

            {/* ── Stock value signal ── */}
            {summary && summary.estimatedStockValue > 0 ? (
              <View style={s.section}>
                <View style={s.stockValueCard}>
                  <View style={s.stockValueIcon}>
                    <MaterialIcons name="inventory-2" size={18} color={Colors.info} />
                  </View>
                  <View style={s.flex}>
                    <Text style={s.stockValueTitle}>
                      Est. £{summary.estimatedStockValue.toFixed(0)} in active stock
                    </Text>
                    <Text style={s.stockValueSub}>
                      Based on mid-point valuations for unlisted and listed items
                    </Text>
                  </View>
                </View>
              </View>
            ) : null}

            {/* ── SWISH intelligence note ── */}
            <View style={s.section}>
              <View style={s.swishNote}>
                <MaterialIcons name="auto-awesome" size={14} color={Colors.primary} style={{ marginTop: 1 }} />
                <Text style={s.swishNoteText}>
                  SWISH analyses your live inventory, listings, and sales to recommend the highest-value actions.
                  All recommendations are based on your actual data — SWISH never fabricates insights.
                </Text>
              </View>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },

  header: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingHorizontal: Spacing.base, paddingBottom: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder,
    backgroundColor: Colors.background,
  },
  backBtn: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.surfaceBorder },
  title: { fontSize: Typography.size.xl, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  subtitle: { fontSize: Typography.size.xs, color: Colors.textTertiary, marginTop: 2 },
  refreshBtn: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.surfaceBorder },

  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md, paddingTop: 80 },
  loadingText: { fontSize: Typography.size.sm, color: Colors.textTertiary },

  content: { padding: Spacing.base, gap: Spacing.md },

  section: { gap: Spacing.sm },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { fontSize: 10, fontWeight: Typography.weight.bold, color: Colors.textTertiary, letterSpacing: 0.8, textTransform: 'uppercase' },
  computingRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  computingText: { fontSize: Typography.size.xs, color: Colors.primary },

  actionsList: { gap: Spacing.sm },

  noActionsCard: {
    backgroundColor: Colors.surface, borderRadius: Radius.xl,
    borderWidth: 1, borderColor: Colors.surfaceBorder,
    padding: Spacing.xl, alignItems: 'center', gap: Spacing.md,
  },
  noActionsTitle: { fontSize: Typography.size.lg, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  noActionsText: { fontSize: Typography.size.sm, color: Colors.textTertiary, textAlign: 'center', lineHeight: 20 },

  stockValueCard: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.surface, borderRadius: Radius.xl,
    borderWidth: 1, borderColor: Colors.surfaceBorder,
    padding: Spacing.md,
  },
  stockValueIcon: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.infoDim, alignItems: 'center', justifyContent: 'center' },
  stockValueTitle: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.textPrimary },
  stockValueSub: { fontSize: Typography.size.xs, color: Colors.textTertiary, marginTop: 2 },

  swishNote: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm,
    backgroundColor: Colors.primaryDim, borderRadius: Radius.md, padding: Spacing.md,
    borderWidth: 1, borderColor: Colors.primary + '30',
  },
  swishNoteText: { flex: 1, fontSize: Typography.size.xs, color: Colors.textSecondary, lineHeight: 17 },
});
