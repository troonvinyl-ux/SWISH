// SWISH Audit Trail Screen
// Complete audit of every autonomous decision, action, and outcome.
// "Why did SWISH do this?" — the answer is always here.

import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, FlatList, Pressable,
  ActivityIndicator, ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors, Typography, Spacing, Radius, Shadow } from '@/constants/theme';
import { useApp } from '@/hooks/useApp';
import { useAlert } from '@/template';
import { AutonomousDecision, listDecisions } from '@/services/decisionEngine';
import { computeLearningInsights, getPredictionAccuracySummary, LearningInsight } from '@/services/predictionService';

// ── Decision Card ──────────────────────────────────────────────────────────

function DecisionCard({ decision, onPress }: { decision: AutonomousDecision; onPress: () => void }) {
  const decisionConfig = {
    BUY:              { color: Colors.success,      icon: 'shopping-bag',     label: 'Approved to Buy' },
    REJECT:           { color: Colors.danger,       icon: 'cancel',           label: 'Rejected' },
    ESCALATE:         { color: Colors.warning,      icon: 'approval',         label: 'Escalated for Approval' },
    PENDING_APPROVAL: { color: Colors.warning,      icon: 'pending',          label: 'Awaiting Approval' },
  };
  const dc = decisionConfig[decision.decision] ?? decisionConfig.REJECT;

  const typeConfig: Record<string, { icon: string; label: string }> = {
    buy:       { icon: 'shopping-bag', label: 'Acquisition' },
    reject:    { icon: 'cancel', label: 'Rejection' },
    escalate:  { icon: 'approval', label: 'Escalation' },
    list:      { icon: 'list-alt', label: 'Listing' },
    reprice:   { icon: 'price-change', label: 'Reprice' },
    publish:   { icon: 'publish', label: 'Publish' },
    fulfil:    { icon: 'local-shipping', label: 'Fulfilment' },
    reinvest:  { icon: 'account-balance', label: 'Reinvestment' },
    decompose: { icon: 'auto-awesome', label: 'Decomposition' },
    bundle:    { icon: 'layers', label: 'Bundle' },
    hold:      { icon: 'pause', label: 'Hold' },
    scrap:     { icon: 'delete-sweep', label: 'Scrap' },
  };
  const tc = typeConfig[decision.decisionType] ?? { icon: 'auto-awesome', label: decision.decisionType };

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [cardStyles.card, pressed && { opacity: 0.9 }]}
    >
      <View style={[cardStyles.stripe, { backgroundColor: dc.color }]} />
      <View style={cardStyles.body}>
        <View style={cardStyles.header}>
          <View style={[cardStyles.typeBadge, { backgroundColor: Colors.primaryDim }]}>
            <MaterialIcons name={tc.icon as any} size={11} color={Colors.primary} />
            <Text style={cardStyles.typeText}>{tc.label}</Text>
          </View>
          <View style={[cardStyles.decBadge, { backgroundColor: dc.color + '20' }]}>
            <MaterialIcons name={dc.icon as any} size={11} color={dc.color} />
            <Text style={[cardStyles.decText, { color: dc.color }]}>{dc.label}</Text>
          </View>
          <Text style={cardStyles.dateText}>
            {new Date(decision.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
          </Text>
        </View>

        <Text style={cardStyles.reasoning} numberOfLines={3}>{decision.reasoning}</Text>

        {decision.financialImpact > 0 ? (
          <View style={cardStyles.impactRow}>
            <MaterialIcons name="payments" size={12} color={Colors.textTertiary} />
            <Text style={cardStyles.impactText}>Financial impact: £{decision.financialImpact.toFixed(2)}</Text>
            {decision.permissionUsed ? (
              <View style={cardStyles.permBadge}>
                <Text style={cardStyles.permText}>{decision.permissionUsed}</Text>
              </View>
            ) : null}
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

const cardStyles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface, borderRadius: Radius.xl,
    flexDirection: 'row', overflow: 'hidden',
    borderWidth: 1, borderColor: Colors.surfaceBorder, ...Shadow.sm,
  },
  stripe: { width: 4, flexShrink: 0 },
  body: { flex: 1, padding: Spacing.md, gap: Spacing.sm },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, flexWrap: 'wrap' },
  typeBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: Radius.pill,
  },
  typeText: { fontSize: 9, color: Colors.primary, fontWeight: Typography.weight.bold },
  decBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: Radius.pill,
  },
  decText: { fontSize: 9, fontWeight: Typography.weight.bold },
  dateText: { marginLeft: 'auto' as any, fontSize: Typography.size.xs, color: Colors.textTertiary },
  reasoning: { fontSize: Typography.size.xs, color: Colors.textSecondary, lineHeight: 16 },
  impactRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  impactText: { fontSize: Typography.size.xs, color: Colors.textTertiary, flex: 1 },
  permBadge: { backgroundColor: Colors.primaryDim, borderRadius: Radius.pill, paddingHorizontal: 6, paddingVertical: 1 },
  permText: { fontSize: 9, color: Colors.primary },
});

// ── Learning Insight Card ──────────────────────────────────────────────────

function LearningCard({ insight }: { insight: LearningInsight }) {
  const trendConfig = {
    improving:          { color: Colors.success, icon: 'trending-up' },
    stable:             { color: Colors.primary, icon: 'trending-flat' },
    degrading:          { color: Colors.danger, icon: 'trending-down' },
    insufficient_data:  { color: Colors.textTertiary, icon: 'info-outline' },
  };
  const tc = trendConfig[insight.trend];
  const accuracyColor = insight.avgAccuracy > 0.8 ? Colors.success : insight.avgAccuracy > 0.6 ? Colors.warning : Colors.danger;

  return (
    <View style={learningStyles.card}>
      <View style={learningStyles.header}>
        <Text style={learningStyles.type}>{insight.predictionType.replace(/_/g, ' ')}</Text>
        <View style={[learningStyles.trendBadge, { backgroundColor: tc.color + '20' }]}>
          <MaterialIcons name={tc.icon as any} size={11} color={tc.color} />
          <Text style={[learningStyles.trendText, { color: tc.color }]}>
            {insight.trend === 'insufficient_data' ? 'Not enough data' : insight.trend.charAt(0).toUpperCase() + insight.trend.slice(1)}
          </Text>
        </View>
      </View>
      <View style={learningStyles.metrics}>
        <View style={learningStyles.metric}>
          <Text style={[learningStyles.metricValue, { color: accuracyColor }]}>
            {(insight.avgAccuracy * 100).toFixed(0)}%
          </Text>
          <Text style={learningStyles.metricLabel}>Accuracy</Text>
        </View>
        <View style={learningStyles.metric}>
          <Text style={learningStyles.metricValue}>{insight.sampleCount}</Text>
          <Text style={learningStyles.metricLabel}>Samples</Text>
        </View>
        <View style={learningStyles.metric}>
          <Text style={[learningStyles.metricValue, {
            color: insight.bias === 'accurate' ? Colors.success : Colors.warning,
          }]}>
            {insight.bias.charAt(0).toUpperCase() + insight.bias.slice(1)}
          </Text>
          <Text style={learningStyles.metricLabel}>Bias</Text>
        </View>
      </View>
      <Text style={learningStyles.recommendation}>{insight.recommendation}</Text>
    </View>
  );
}

const learningStyles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface, borderRadius: Radius.lg,
    padding: Spacing.md, gap: Spacing.sm,
    borderWidth: 1, borderColor: Colors.surfaceBorder,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  type: { fontSize: Typography.size.xs, fontWeight: Typography.weight.semibold, color: Colors.textPrimary, textTransform: 'capitalize' },
  trendBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 7, paddingVertical: 2, borderRadius: Radius.pill },
  trendText: { fontSize: 9, fontWeight: Typography.weight.bold },
  metrics: { flexDirection: 'row', justifyContent: 'space-around', backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.md, padding: Spacing.sm },
  metric: { alignItems: 'center', gap: 2 },
  metricValue: { fontSize: Typography.size.base, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  metricLabel: { fontSize: Typography.size.xs - 1, color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.3 },
  recommendation: { fontSize: Typography.size.xs, color: Colors.textSecondary, lineHeight: 16 },
});

// ── Main Screen ─────────────────────────────────────────────────────────────

export default function AuditScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { tenant } = useApp();
  const { showAlert } = useAlert();

  const [decisions, setDecisions] = useState<AutonomousDecision[]>([]);
  const [insights, setInsights] = useState<LearningInsight[]>([]);
  const [summary, setSummary] = useState<Awaited<ReturnType<typeof getPredictionAccuracySummary>> | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'decisions' | 'learning'>('decisions');

  const load = useCallback(async () => {
    if (!tenant) return;
    setLoading(true);
    const [decResult, insightResult, summaryResult] = await Promise.all([
      listDecisions(tenant.id),
      computeLearningInsights(tenant.id),
      getPredictionAccuracySummary(tenant.id),
    ]);
    setDecisions(decResult.decisions);
    setInsights(insightResult);
    setSummary(summaryResult);
    setLoading(false);
  }, [tenant?.id]);

  useEffect(() => { load(); }, [load]);

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      <View style={[styles.header, { paddingTop: insets.top + Spacing.base }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
          <MaterialIcons name="arrow-back" size={20} color={Colors.textSecondary} />
        </Pressable>
        <Pressable onPress={() => router.replace('/(tabs)' as any)} style={styles.homeBtn} hitSlop={8}>
          <MaterialIcons name="dashboard" size={16} color={Colors.textTertiary} />
        </Pressable>
        <View style={styles.flex}>
          <Text style={styles.title}>Audit & Learning</Text>
          <Text style={styles.subtitle}>{decisions.length} decisions recorded</Text>
        </View>
      </View>

      {/* Summary strip */}
      {summary ? (
        <View style={styles.summaryStrip}>
          {[
            { label: 'Predictions', value: summary.totalPredictions, color: Colors.primary },
            { label: 'Resolved', value: summary.resolvedPredictions, color: Colors.success },
            { label: 'Avg Accuracy', value: `${(summary.avgAccuracy * 100).toFixed(0)}%`, color: summary.avgAccuracy > 0.7 ? Colors.success : Colors.warning },
          ].map(s => (
            <View key={s.label} style={styles.summaryItem}>
              <Text style={[styles.summaryValue, { color: s.color }]}>{s.value}</Text>
              <Text style={styles.summaryLabel}>{s.label}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {/* Tab bar */}
      <View style={styles.tabBar}>
        {([
          { id: 'decisions', label: 'Decision Log', icon: 'gavel' },
          { id: 'learning', label: 'Learning Engine', icon: 'psychology' },
        ] as const).map(t => (
          <Pressable key={t.id} onPress={() => setActiveTab(t.id)} style={[styles.tab, activeTab === t.id && styles.tabActive]}>
            <MaterialIcons name={t.icon as any} size={14} color={activeTab === t.id ? Colors.primary : Colors.textTertiary} />
            <Text style={[styles.tabText, activeTab === t.id && styles.tabTextActive]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <View style={styles.loading}><ActivityIndicator color={Colors.primary} size="large" /></View>
      ) : activeTab === 'decisions' ? (
        <FlatList
          data={decisions}
          keyExtractor={d => d.id}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 40 }]}
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => <View style={{ height: Spacing.sm }} />}
          renderItem={({ item }) => (
            <DecisionCard
              decision={item}
              onPress={() => showAlert(
                item.decision,
                `Decision: ${item.decision}\nType: ${item.decisionType}\nConfidence: ${item.confidence}\n\nReasoning: ${item.reasoning}\n\nRules Applied: ${Object.keys(item.rulesApplied).join(', ')}`,
                [{ text: 'Close' }]
              )}
            />
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <MaterialIcons name="gavel" size={48} color={Colors.textTertiary} />
              <Text style={styles.emptyTitle}>No Decisions Yet</Text>
              <Text style={styles.emptyText}>
                Every autonomous action SWISH takes will be recorded here with full reasoning,
                rules applied, and outcomes.
              </Text>
            </View>
          }
        />
      ) : (
        <ScrollView
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 40 }]}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.learningHeader}>
            <MaterialIcons name="psychology" size={16} color={Colors.accent} />
            <Text style={styles.learningHeaderText}>
              SWISH learns from every prediction vs actual outcome. As more data is collected,
              future valuations, timing predictions, and acquisition decisions improve.
            </Text>
          </View>

          {insights.length === 0 ? (
            <View style={styles.empty}>
              <MaterialIcons name="psychology" size={48} color={Colors.textTertiary} />
              <Text style={styles.emptyTitle}>No Learning Data Yet</Text>
              <Text style={styles.emptyText}>
                Complete sales and acquisitions to generate prediction vs actual comparisons.
                SWISH will learn from every outcome.
              </Text>
            </View>
          ) : (
            insights.map(insight => (
              <LearningCard key={insight.predictionType} insight={insight} />
            ))
          )}

          <View style={styles.principleCard}>
            <Text style={styles.principleTitle}>PREDICTION → ACTION → OUTCOME → LEARNING</Text>
            <Text style={styles.principleText}>
              Every significant SWISH decision records what was predicted, what was expected,
              what actually happened, the error, and a learning signal. Over time, SWISH becomes
              more accurate for your specific business, categories, and market conditions.
            </Text>
          </View>
        </ScrollView>
      )}
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
    paddingVertical: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder,
    backgroundColor: Colors.surface,
  },
  summaryItem: { alignItems: 'center', gap: 3 },
  summaryValue: { fontSize: Typography.size.xl, fontWeight: Typography.weight.extrabold },
  summaryLabel: { fontSize: Typography.size.xs - 1, color: Colors.textTertiary },

  tabBar: {
    flexDirection: 'row', paddingHorizontal: Spacing.base, paddingVertical: Spacing.sm,
    gap: Spacing.xs, borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder,
  },
  tab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: Spacing.sm, borderRadius: Radius.md },
  tabActive: { backgroundColor: Colors.primaryDim },
  tabText: { fontSize: Typography.size.xs, color: Colors.textTertiary, fontWeight: Typography.weight.medium },
  tabTextActive: { color: Colors.primary },

  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: Spacing.base, gap: Spacing.sm },

  empty: { alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.hero },
  emptyTitle: { fontSize: Typography.size.lg, fontWeight: Typography.weight.semibold, color: Colors.textSecondary },
  emptyText: { fontSize: Typography.size.sm, color: Colors.textTertiary, textAlign: 'center', lineHeight: 20, maxWidth: 300 },

  learningHeader: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm,
    backgroundColor: Colors.accentDim, borderRadius: Radius.md, padding: Spacing.md,
    borderWidth: 1, borderColor: Colors.accent + '30', marginBottom: Spacing.sm,
  },
  learningHeaderText: { flex: 1, fontSize: Typography.size.xs, color: Colors.textSecondary, lineHeight: 16 },

  principleCard: {
    backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.lg,
    padding: Spacing.base, gap: Spacing.sm, marginTop: Spacing.md,
  },
  principleTitle: { fontSize: Typography.size.xs, fontWeight: Typography.weight.bold, color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5 },
  principleText: { fontSize: Typography.size.xs, color: Colors.textTertiary, lineHeight: 18 },
});
