// SWISH Opportunities Screen
// Acquisition intelligence: find, rank, assess, and approve buying opportunities.
// AUTONOMOUS DECISION ENGINE: every opportunity evaluated with BUY/REJECT/ESCALATE verdict.

import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, FlatList, Pressable, Modal,
  ScrollView, TextInput, ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors, Typography, Spacing, Radius, Shadow } from '@/constants/theme';
import { useOpportunities } from '@/hooks/useBusiness';
import { useApp } from '@/hooks/useApp';
import { Opportunity, scoreOpportunity } from '@/services/opportunityService';
import { SPECIALISTS } from '@/constants/specialists';
import {
  evaluateAcquisitionDecision, recordDecision,
  AcquisitionDecisionResult, DecisionOutcome,
} from '@/services/decisionEngine';
import { getAutonomyControls } from '@/services/autonomyService';
import { getBusinessConfig } from '@/services/businessConfigService';
import { useAlert } from '@/template';

// ── Helpers ────────────────────────────────────────────────────────────────

const fmt = (v: number) => v >= 1000 ? `£${(v / 1000).toFixed(1)}k` : `£${v.toFixed(0)}`;
const fmtPct = (v: number) => `${(v * 100).toFixed(0)}%`;
const GRADE_COLOR: Record<string, string> = { A: Colors.success, B: Colors.primary, C: Colors.warning, D: Colors.warning, F: Colors.danger };
const RISK_LABEL = (r: number) => r <= 0.3 ? 'Low Risk' : r <= 0.6 ? 'Medium Risk' : 'High Risk';
const RISK_COLOR = (r: number) => r <= 0.3 ? Colors.success : r <= 0.6 ? Colors.warning : Colors.danger;

const DECISION_CONFIG: Record<DecisionOutcome, { color: string; icon: string; label: string; bg: string }> = {
  BUY:              { color: Colors.success, icon: 'check-circle', label: 'BUY',     bg: Colors.successDim },
  REJECT:           { color: Colors.danger,  icon: 'cancel',       label: 'REJECT',  bg: Colors.dangerDim },
  ESCALATE:         { color: Colors.warning, icon: 'approval',     label: 'APPROVE', bg: Colors.warningDim },
  PENDING_APPROVAL: { color: Colors.warning, icon: 'pending',      label: 'REVIEW',  bg: Colors.warningDim },
};

// ── Decision Verdict Panel ─────────────────────────────────────────────────

function DecisionPanel({
  decision,
  onApprove,
  onPass,
  loading,
}: {
  decision: AcquisitionDecisionResult;
  onApprove: () => void;
  onPass: () => void;
  loading: boolean;
}) {
  const dc = DECISION_CONFIG[decision.decision];
  const [expanded, setExpanded] = useState(false);

  return (
    <View style={[dpStyles.container, { borderColor: dc.color + '50', backgroundColor: dc.bg }]}>
      {/* Verdict row */}
      <Pressable onPress={() => setExpanded(e => !e)} style={dpStyles.verdictRow}>
        <View style={[dpStyles.verdictBadge, { backgroundColor: dc.color }]}>
          <MaterialIcons name={dc.icon as any} size={14} color={Colors.textPrimary} />
          <Text style={dpStyles.verdictLabel}>{dc.label}</Text>
        </View>
        <Text style={dpStyles.maxPrice}>
          Max: <Text style={{ color: dc.color, fontWeight: Typography.weight.bold }}>£{decision.maxRecommendedPrice.toFixed(0)}</Text>
        </Text>
        <MaterialIcons name={expanded ? 'expand-less' : 'expand-more'} size={16} color={Colors.textTertiary} />
      </Pressable>

      {/* Reasoning (collapsed by default) */}
      {expanded ? (
        <View style={dpStyles.reasoning}>
          <Text style={dpStyles.reasoningText}>{decision.reasoning}</Text>
          {decision.blockers.length > 0 ? (
            <View style={dpStyles.blockersWrap}>
              {decision.blockers.map((b, i) => (
                <View key={i} style={dpStyles.blockerRow}>
                  <MaterialIcons name="block" size={11} color={Colors.danger} />
                  <Text style={dpStyles.blockerText}>{b}</Text>
                </View>
              ))}
            </View>
          ) : null}
          {decision.warnings.length > 0 ? (
            <View style={dpStyles.warningsWrap}>
              {decision.warnings.map((w, i) => (
                <View key={i} style={dpStyles.warningRow}>
                  <MaterialIcons name="warning" size={11} color={Colors.warning} />
                  <Text style={dpStyles.warningText}>{w}</Text>
                </View>
              ))}
            </View>
          ) : null}
          {decision.rulesApplied.length > 0 ? (
            <View style={dpStyles.rulesRow}>
              {decision.rulesApplied.map(r => (
                <View key={r} style={dpStyles.ruleChip}>
                  <Text style={dpStyles.ruleText}>{r.replace(/_/g, ' ')}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}

      {/* Actions */}
      <View style={dpStyles.actions}>
        <Pressable onPress={onPass} style={dpStyles.passBtn} disabled={loading}>
          <Text style={dpStyles.passBtnText}>Pass</Text>
        </Pressable>
        {decision.decision !== 'REJECT' ? (
          <Pressable
            onPress={onApprove}
            disabled={loading}
            style={({ pressed }) => [dpStyles.acquireBtn, { backgroundColor: dc.color }, pressed && { opacity: 0.85 }]}
          >
            {loading ? <ActivityIndicator size="small" color={Colors.textPrimary} /> : (
              <MaterialIcons name={decision.decision === 'BUY' ? 'shopping-bag' : 'approval'} size={14} color={Colors.textPrimary} />
            )}
            <Text style={dpStyles.acquireBtnText}>
              {decision.decision === 'BUY' ? 'Acquire' : 'Request Approval'}
            </Text>
          </Pressable>
        ) : (
          <View style={dpStyles.rejectNote}>
            <Text style={dpStyles.rejectNoteText}>Does not meet criteria</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const dpStyles = StyleSheet.create({
  container: {
    borderRadius: Radius.lg, borderWidth: 1, padding: Spacing.md, gap: Spacing.sm,
  },
  verdictRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  verdictBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderRadius: Radius.pill, paddingHorizontal: Spacing.sm, paddingVertical: 3,
  },
  verdictLabel: { fontSize: 10, fontWeight: Typography.weight.extrabold, color: Colors.textPrimary, letterSpacing: 0.5 },
  maxPrice: { flex: 1, fontSize: Typography.size.xs, color: Colors.textSecondary },
  reasoning: { gap: Spacing.xs },
  reasoningText: { fontSize: Typography.size.xs, color: Colors.textSecondary, lineHeight: 17 },
  blockersWrap: { gap: 3 },
  blockerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 4 },
  blockerText: { flex: 1, fontSize: 10, color: Colors.danger, lineHeight: 14 },
  warningsWrap: { gap: 3 },
  warningRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 4 },
  warningText: { flex: 1, fontSize: 10, color: Colors.warning, lineHeight: 14 },
  rulesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 3, marginTop: 2 },
  ruleChip: { backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.pill, paddingHorizontal: 6, paddingVertical: 2 },
  ruleText: { fontSize: 9, color: Colors.textTertiary, textTransform: 'capitalize' },
  actions: { flexDirection: 'row', gap: Spacing.sm, marginTop: 2 },
  passBtn: {
    paddingHorizontal: Spacing.base, paddingVertical: Spacing.sm,
    borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.surfaceBorder,
    backgroundColor: Colors.surface,
  },
  passBtnText: { fontSize: Typography.size.xs, color: Colors.textTertiary, fontWeight: Typography.weight.medium },
  acquireBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: Spacing.xs, borderRadius: Radius.md, padding: Spacing.sm,
  },
  acquireBtnText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  rejectNote: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingVertical: Spacing.sm,
  },
  rejectNoteText: { fontSize: Typography.size.xs, color: Colors.textTertiary, fontStyle: 'italic' },
});

// ── Opportunity Card ────────────────────────────────────────────────────────

type ScoredOpportunity = Opportunity & { score: ReturnType<typeof scoreOpportunity> };

function OpportunityCard({ opp, decisionResult, onDecisionMade, decisionLoading }: {
  opp: ScoredOpportunity;
  decisionResult: AcquisitionDecisionResult | null;
  onDecisionMade: (opp: ScoredOpportunity, action: 'acquire' | 'pass') => void;
  decisionLoading: boolean;
}) {
  const grade = opp.score.grade;
  const gradeColor = GRADE_COLOR[grade] ?? Colors.textTertiary;

  return (
    <View style={styles.oppCard}>
      {/* Grade badge */}
      <View style={[styles.gradeBadge, { backgroundColor: gradeColor + '20', borderColor: gradeColor + '50' }]}>
        <Text style={[styles.gradeText, { color: gradeColor }]}>{grade}</Text>
      </View>

      <View style={styles.oppHeader}>
        <Text style={styles.oppTitle} numberOfLines={1}>{opp.title}</Text>
        <View style={styles.oppMeta}>
          <View style={[styles.riskBadge, { backgroundColor: RISK_COLOR(opp.riskScore) + '15' }]}>
            <View style={[styles.riskDot, { backgroundColor: RISK_COLOR(opp.riskScore) }]} />
            <Text style={[styles.riskText, { color: RISK_COLOR(opp.riskScore) }]}>{RISK_LABEL(opp.riskScore)}</Text>
          </View>
          {opp.location ? <Text style={styles.locationText}>{opp.location.split(',')[0]}</Text> : null}
        </View>
      </View>

      {/* Financials row */}
      <View style={styles.financialsRow}>
        <View style={styles.financialItem}>
          <Text style={styles.financialLabel}>Asking</Text>
          <Text style={[styles.financialValue, { color: Colors.warning }]}>{fmt(opp.askingPrice)}</Text>
        </View>
        <View style={[styles.financialItem, styles.financialItemHighlight]}>
          <Text style={styles.financialLabel}>Est. Profit</Text>
          <Text style={[styles.financialValue, { color: Colors.success }]}>+{fmt(opp.estimatedProfit)}</Text>
        </View>
        <View style={styles.financialItem}>
          <Text style={styles.financialLabel}>ROI</Text>
          <Text style={[styles.financialValue, { color: gradeColor }]}>{fmtPct(opp.estimatedROI)}</Text>
        </View>
        <View style={styles.financialItem}>
          <Text style={styles.financialLabel}>£/hr</Text>
          <Text style={[styles.financialValue, { color: Colors.primary }]}>
            {opp.profitPerLabourHour > 0 ? `£${opp.profitPerLabourHour.toFixed(0)}` : '—'}
          </Text>
        </View>
      </View>

      {/* Category chips */}
      {opp.categories.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.catScroll} contentContainerStyle={styles.catRow}>
          {opp.categories.slice(0, 4).map(cat => {
            const sp = SPECIALISTS[cat as keyof typeof SPECIALISTS];
            return (
              <View key={cat} style={[styles.catChip, { borderColor: (sp?.color ?? Colors.primary) + '40' }]}>
                <View style={[styles.catDot, { backgroundColor: sp?.color ?? Colors.primary }]} />
                <Text style={styles.catText}>{sp?.shortName ?? cat}</Text>
              </View>
            );
          })}
          {opp.estimatedItemCount > 0 ? (
            <View style={styles.itemCountChip}>
              <Text style={styles.itemCountText}>~{opp.estimatedItemCount} items</Text>
            </View>
          ) : null}
        </ScrollView>
      ) : null}

      {/* Score flags */}
      {opp.score.flags.length > 0 ? (
        <View style={styles.flagRow}>
          <MaterialIcons name="warning" size={11} color={Colors.warning} />
          <Text style={styles.flagText} numberOfLines={1}>{opp.score.flags[0]}</Text>
        </View>
      ) : null}

      {/* Autonomous Decision Panel */}
      {opp.status === 'open' ? (
        decisionResult ? (
          <DecisionPanel
            decision={decisionResult}
            onApprove={() => onDecisionMade(opp, 'acquire')}
            onPass={() => onDecisionMade(opp, 'pass')}
            loading={decisionLoading}
          />
        ) : null
      ) : (
        <View style={styles.statusRow}>
          <MaterialIcons
            name={opp.status === 'acquired' ? 'check-circle' : 'cancel'}
            size={12}
            color={opp.status === 'acquired' ? Colors.success : Colors.textTertiary}
          />
          <Text style={[styles.statusText, { color: opp.status === 'acquired' ? Colors.success : Colors.textTertiary }]}>
            {opp.status.charAt(0).toUpperCase() + opp.status.slice(1)}
          </Text>
        </View>
      )}
    </View>
  );
}

// ── Add Opportunity Modal ───────────────────────────────────────────────────

function AddOpportunityModal({ visible, onClose, onSave }: {
  visible: boolean;
  onClose: () => void;
  onSave: (input: any) => Promise<void>;
}) {
  const insets = useSafeAreaInsets();
  const [title, setTitle] = useState('');
  const [source, setSource] = useState('');
  const [askingPrice, setAskingPrice] = useState('');
  const [itemCount, setItemCount] = useState('');
  const [estRevenue, setEstRevenue] = useState('');
  const [location, setLocation] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!title.trim() || !askingPrice) return;
    setSaving(true);
    const asking = parseFloat(askingPrice) || 0;
    const revenue = parseFloat(estRevenue) || asking * 3;
    const fees = revenue * 0.13;
    const shipping = (parseInt(itemCount) || 10) * 3;
    const net = revenue - fees - shipping;
    const profit = net - asking;
    const roi = asking > 0 ? profit / asking : 0;

    await onSave({
      title: title.trim(),
      source: source.trim() || 'Manual Entry',
      askingPrice: asking,
      estimatedItemCount: parseInt(itemCount) || 0,
      estimatedGrossRevenue: revenue,
      estimatedNetRevenue: net,
      estimatedProfit: profit,
      estimatedROI: roi,
      profitPerLabourHour: profit / Math.max(1, (parseInt(itemCount) || 10) * 0.15),
      location: location.trim(),
      confidence: 'low',
    });
    setSaving(false);
    setTitle(''); setSource(''); setAskingPrice(''); setItemCount(''); setEstRevenue(''); setLocation('');
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={modalStyles.overlay}>
        <View style={[modalStyles.card, { paddingBottom: insets.bottom + Spacing.base }]}>
          <View style={modalStyles.header}>
            <Text style={modalStyles.title}>Add Opportunity</Text>
            <Pressable onPress={onClose}><MaterialIcons name="close" size={22} color={Colors.textSecondary} /></Pressable>
          </View>
          <ScrollView showsVerticalScrollIndicator={false}>
            <View style={modalStyles.form}>
              {[
                { label: 'Title *', value: title, onChange: setTitle, placeholder: 'e.g. House Clearance, Manchester' },
                { label: 'Source', value: source, onChange: setSource, placeholder: 'eBay, Facebook, Estate Agent...' },
                { label: 'Asking Price (£) *', value: askingPrice, onChange: setAskingPrice, placeholder: '0.00', numeric: true },
                { label: 'Estimated Items', value: itemCount, onChange: setItemCount, placeholder: '0', numeric: true },
                { label: 'Est. Gross Revenue (£)', value: estRevenue, onChange: setEstRevenue, placeholder: 'Leave blank to auto-calculate', numeric: true },
                { label: 'Location', value: location, onChange: setLocation, placeholder: 'City, UK' },
              ].map(f => (
                <View key={f.label} style={modalStyles.field}>
                  <Text style={modalStyles.label}>{f.label}</Text>
                  <TextInput
                    style={modalStyles.input}
                    value={f.value}
                    onChangeText={f.onChange}
                    placeholder={f.placeholder}
                    placeholderTextColor={Colors.textTertiary}
                    keyboardType={f.numeric ? 'decimal-pad' : 'default'}
                  />
                </View>
              ))}
              <View style={modalStyles.note}>
                <MaterialIcons name="auto-awesome" size={12} color={Colors.accent} />
                <Text style={modalStyles.noteText}>
                  After saving, SWISH will automatically evaluate this opportunity against your business rules and return a BUY/REJECT/ESCALATE decision.
                </Text>
              </View>
            </View>
          </ScrollView>
          <Pressable
            onPress={handleSave}
            disabled={saving || !title.trim() || !askingPrice}
            style={({ pressed }) => [modalStyles.saveBtn, (saving || !title.trim() || !askingPrice) && { opacity: 0.6 }, pressed && { opacity: 0.85 }]}
          >
            {saving ? <ActivityIndicator size="small" color={Colors.textPrimary} /> : <Text style={modalStyles.saveBtnText}>Add Opportunity</Text>}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

// ── Main Screen ─────────────────────────────────────────────────────────────

export default function OpportunitiesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { tenant } = useApp();
  const { showAlert } = useAlert();
  const { opportunities, loading, addOpportunity, updateStatus, reload } = useOpportunities();
  const [filter, setFilter] = useState<'all' | 'open' | 'acquired'>('open');
  const [showAdd, setShowAdd] = useState(false);
  const [decisions, setDecisions] = useState<Record<string, AcquisitionDecisionResult>>({});
  const [evaluating, setEvaluating] = useState<string | null>(null);
  const [acquiring, setAcquiring] = useState<string | null>(null);

  // Run decision engine on all open opportunities when config loaded
  const evaluateOpportunities = useCallback(async (opps: typeof opportunities) => {
    if (!tenant) return;
    const openOpps = opps.filter(o => o.status === 'open');
    if (openOpps.length === 0) return;

    const [configResult, controlsResult] = await Promise.all([
      getBusinessConfig(tenant.id),
      getAutonomyControls(tenant.id),
    ]);

    const newDecisions: Record<string, AcquisitionDecisionResult> = {};
    for (const opp of openOpps) {
      const result = evaluateAcquisitionDecision(
        {
          title: opp.title,
          askingPrice: opp.askingPrice,
          estimatedProfit: opp.estimatedProfit,
          estimatedROI: opp.estimatedROI,
          confidence: opp.confidence,
          riskScore: opp.riskScore,
          categories: opp.categories,
          itemCount: opp.estimatedItemCount,
        },
        configResult.config,
        controlsResult.controls,
      );
      newDecisions[opp.id] = result;

      // Record decision to audit trail (async, non-blocking)
      if (tenant) {
        recordDecision(tenant.id, 'buy', result, {
          title: opp.title,
          askingPrice: opp.askingPrice,
          estimatedProfit: opp.estimatedProfit,
          estimatedROI: opp.estimatedROI,
          confidence: opp.confidence,
          riskScore: opp.riskScore,
          categories: opp.categories,
        }, opp.id).catch(() => {});
      }
    }
    setDecisions(newDecisions);
  }, [tenant?.id]);

  useEffect(() => {
    if (opportunities.length > 0) {
      evaluateOpportunities(opportunities);
    }
  }, [opportunities.length]);

  const filtered = filter === 'all' ? opportunities : opportunities.filter(o => o.status === filter);

  const handleDecisionMade = useCallback(async (
    opp: typeof opportunities[0],
    action: 'acquire' | 'pass'
  ) => {
    if (action === 'pass') {
      await updateStatus(opp.id, 'passed');
      return;
    }

    const decision = decisions[opp.id];
    if (!decision) return;

    if (decision.decision === 'REJECT') {
      showAlert('Cannot Acquire', decision.reasoning);
      return;
    }

    setAcquiring(opp.id);

    if (decision.decision === 'BUY') {
      // Auto-acquire within permissions
      const { error } = await updateStatus(opp.id, 'acquired', 'approved');
      if (!error) {
        showAlert(
          'Acquisition Approved',
          `SWISH has approved this acquisition within your configured rules.\n\nMax recommended price: £${decision.maxRecommendedPrice.toFixed(0)}\n\nHead to Acquisitions to record the purchase.`,
          [
            { text: 'View Acquisitions', onPress: () => router.navigate('/(tabs)/acquisitions' as any) },
            { text: 'OK' },
          ]
        );
      }
    } else {
      // ESCALATE — needs approval
      await updateStatus(opp.id, 'open', 'pending');
      showAlert(
        'Approval Requested',
        `This opportunity has been flagged for your approval.\n\nReason: ${decision.approvalReason}\n\nMax recommended price: £${decision.maxRecommendedPrice.toFixed(0)}`
      );
    }

    setAcquiring(null);
  }, [decisions, updateStatus, router, showAlert]);

  const openOpps = opportunities.filter(o => o.status === 'open');
  const pendingApproval = openOpps.filter(o => decisions[o.id]?.requiresApproval);
  const buyReady = openOpps.filter(o => decisions[o.id]?.decision === 'BUY');
  const totalPotentialProfit = openOpps.reduce((s, o) => s + o.estimatedProfit, 0);

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
          <Text style={styles.title}>Opportunities</Text>
          <Text style={styles.subtitle}>
            {openOpps.length} open · £{totalPotentialProfit.toLocaleString()} potential profit
          </Text>
        </View>
        <Pressable
          onPress={() => setShowAdd(true)}
          style={({ pressed }) => [styles.addBtn, pressed && { opacity: 0.8 }]}
        >
          <MaterialIcons name="add" size={20} color={Colors.textPrimary} />
          <Text style={styles.addBtnText}>Add</Text>
        </Pressable>
      </View>

      {/* Approval alert */}
      {pendingApproval.length > 0 ? (
        <Pressable style={styles.approvalAlert} onPress={() => setFilter('open')}>
          <View style={styles.approvalAlertDot} />
          <Text style={styles.approvalAlertText}>
            {pendingApproval.length} {pendingApproval.length === 1 ? 'opportunity requires' : 'opportunities require'} your approval
          </Text>
          <MaterialIcons name="chevron-right" size={14} color={Colors.warning} />
        </Pressable>
      ) : null}

      {/* Buy-ready banner */}
      {buyReady.length > 0 ? (
        <View style={styles.buyReadyBanner}>
          <MaterialIcons name="check-circle" size={13} color={Colors.success} />
          <Text style={styles.buyReadyText}>
            {buyReady.length} {buyReady.length === 1 ? 'opportunity is' : 'opportunities are'} ready to acquire within your rules
          </Text>
        </View>
      ) : null}

      {/* Summary strip */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.summaryScroll} contentContainerStyle={styles.summaryRow}>
        {[
          { label: 'Open', count: openOpps.length, color: Colors.primary },
          { label: 'BUY', count: buyReady.length, color: Colors.success },
          { label: 'Needs Approval', count: pendingApproval.length, color: Colors.warning },
          { label: 'Acquired', count: opportunities.filter(o => o.status === 'acquired').length, color: Colors.accent },
        ].map(s => (
          <View key={s.label} style={styles.summaryChip}>
            <Text style={[styles.summaryCount, { color: s.color }]}>{s.count}</Text>
            <Text style={styles.summaryLabel}>{s.label}</Text>
          </View>
        ))}
      </ScrollView>

      {/* Filter tabs */}
      <View style={styles.filterBar}>
        {(['open', 'all', 'acquired'] as const).map(f => (
          <Pressable
            key={f}
            onPress={() => setFilter(f)}
            style={[styles.filterTab, filter === f && styles.filterTabActive]}
          >
            <Text style={[styles.filterTabText, filter === f && styles.filterTabTextActive]}>
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </Text>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <View style={styles.loading}><ActivityIndicator color={Colors.primary} size="large" /></View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={o => o.id}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 90 }]}
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => <View style={{ height: Spacing.md }} />}
          renderItem={({ item }) => (
            <OpportunityCard
              opp={item}
              decisionResult={decisions[item.id] ?? null}
              onDecisionMade={handleDecisionMade}
              decisionLoading={acquiring === item.id}
            />
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <MaterialIcons name="search" size={48} color={Colors.textTertiary} />
              <Text style={styles.emptyTitle}>No Opportunities</Text>
              <Text style={styles.emptyText}>
                {filter === 'open' ? 'No open opportunities. Add one to get started.' : 'Nothing in this category yet.'}
              </Text>
              <Pressable onPress={() => setShowAdd(true)} style={styles.emptyAddBtn}>
                <MaterialIcons name="add" size={16} color={Colors.background} />
                <Text style={styles.emptyAddBtnText}>Add Opportunity</Text>
              </Pressable>
            </View>
          }
        />
      )}

      <AddOpportunityModal
        visible={showAdd}
        onClose={() => setShowAdd(false)}
        onSave={async (input) => {
          const { opportunity } = await addOpportunity(input);
          if (opportunity && tenant) {
            // Immediately evaluate the new opportunity
            const [configResult, controlsResult] = await Promise.all([
              getBusinessConfig(tenant.id),
              getAutonomyControls(tenant.id),
            ]);
            const result = evaluateAcquisitionDecision(
              {
                title: opportunity.title,
                askingPrice: opportunity.askingPrice,
                estimatedProfit: opportunity.estimatedProfit,
                estimatedROI: opportunity.estimatedROI,
                confidence: opportunity.confidence,
                riskScore: opportunity.riskScore,
                categories: opportunity.categories,
                itemCount: opportunity.estimatedItemCount,
              },
              configResult.config,
              controlsResult.controls,
            );
            setDecisions(prev => ({ ...prev, [opportunity.id]: result }));
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },

  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: Spacing.base, paddingBottom: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder,
    gap: Spacing.sm,
  },
  backBtn: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.surfaceBorder },
  homeBtn: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.surfaceBorder },
  title: { fontSize: Typography.size.xl, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  subtitle: { fontSize: Typography.size.xs, color: Colors.textTertiary, marginTop: 2 },
  addBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.primary, paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm, borderRadius: Radius.pill,
  },
  addBtnText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.textPrimary },

  approvalAlert: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.warningDim, paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.sm, borderBottomWidth: 1, borderBottomColor: Colors.warning + '30',
  },
  approvalAlertDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: Colors.warning },
  approvalAlertText: { flex: 1, fontSize: Typography.size.xs, color: Colors.warning, fontWeight: Typography.weight.semibold },

  buyReadyBanner: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.successDim, paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.sm, borderBottomWidth: 1, borderBottomColor: Colors.success + '30',
  },
  buyReadyText: { flex: 1, fontSize: Typography.size.xs, color: Colors.success, fontWeight: Typography.weight.medium },

  summaryScroll: { maxHeight: 64, borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder },
  summaryRow: { paddingHorizontal: Spacing.base, paddingVertical: Spacing.sm, gap: Spacing.xs },
  summaryChip: {
    backgroundColor: Colors.surface, borderRadius: Radius.md,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    alignItems: 'center', gap: 2, borderWidth: 1, borderColor: Colors.surfaceBorder, minWidth: 64,
  },
  summaryCount: { fontSize: Typography.size.md, fontWeight: Typography.weight.bold },
  summaryLabel: { fontSize: Typography.size.xs - 1, color: Colors.textTertiary },

  filterBar: {
    flexDirection: 'row', paddingHorizontal: Spacing.base, paddingVertical: Spacing.sm,
    gap: Spacing.xs, borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder,
  },
  filterTab: { flex: 1, paddingVertical: Spacing.sm, borderRadius: Radius.md, alignItems: 'center' },
  filterTabActive: { backgroundColor: Colors.primaryDim },
  filterTabText: { fontSize: Typography.size.xs, color: Colors.textTertiary, fontWeight: Typography.weight.medium },
  filterTabTextActive: { color: Colors.primary },

  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: Spacing.base },

  // Opportunity card
  oppCard: {
    backgroundColor: Colors.surface, borderRadius: Radius.xl,
    padding: Spacing.base, gap: Spacing.md,
    borderWidth: 1, borderColor: Colors.surfaceBorder, ...Shadow.sm,
    position: 'relative',
  },
  gradeBadge: {
    position: 'absolute', top: Spacing.md, right: Spacing.md,
    width: 32, height: 32, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5,
  },
  gradeText: { fontSize: Typography.size.md, fontWeight: Typography.weight.extrabold },

  oppHeader: { gap: 4, paddingRight: 44 },
  oppTitle: { fontSize: Typography.size.base, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  oppMeta: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  riskBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 7, paddingVertical: 2, borderRadius: Radius.pill },
  riskDot: { width: 5, height: 5, borderRadius: 3 },
  riskText: { fontSize: Typography.size.xs, fontWeight: Typography.weight.semibold },
  locationText: { fontSize: Typography.size.xs, color: Colors.textTertiary },

  financialsRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.md, padding: Spacing.md,
  },
  financialItem: { alignItems: 'center', gap: 2, flex: 1 },
  financialItemHighlight: { backgroundColor: Colors.successDim, borderRadius: Radius.sm, paddingHorizontal: Spacing.xs },
  financialLabel: { fontSize: 9, color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.3 },
  financialValue: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold },

  catScroll: { maxHeight: 30 },
  catRow: { gap: Spacing.xs, flexDirection: 'row', alignItems: 'center' },
  catChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: Spacing.sm, paddingVertical: 3,
    backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.pill, borderWidth: 1,
  },
  catDot: { width: 5, height: 5, borderRadius: 3 },
  catText: { fontSize: 10, color: Colors.textSecondary },
  itemCountChip: {
    paddingHorizontal: Spacing.sm, paddingVertical: 3,
    backgroundColor: Colors.primaryDim, borderRadius: Radius.pill,
  },
  itemCountText: { fontSize: 10, color: Colors.primary, fontWeight: Typography.weight.semibold },

  flagRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  flagText: { fontSize: Typography.size.xs, color: Colors.warning, flex: 1 },

  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 5, justifyContent: 'flex-end' },
  statusText: { fontSize: Typography.size.xs },

  empty: { alignItems: 'center', gap: Spacing.md, paddingVertical: 60 },
  emptyTitle: { fontSize: Typography.size.lg, fontWeight: Typography.weight.semibold, color: Colors.textSecondary },
  emptyText: { fontSize: Typography.size.sm, color: Colors.textTertiary, textAlign: 'center' },
  emptyAddBtn: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.xs,
    backgroundColor: Colors.primary, borderRadius: Radius.pill,
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm,
  },
  emptyAddBtnText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.background },
});

const modalStyles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: Colors.overlay80, justifyContent: 'flex-end' },
  card: {
    backgroundColor: Colors.surfaceElevated, borderTopLeftRadius: Radius.xxl,
    borderTopRightRadius: Radius.xxl, padding: Spacing.xl, gap: Spacing.lg,
    borderTopWidth: 1, borderColor: Colors.surfaceBorder, maxHeight: '90%',
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: Typography.size.xl, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  form: { gap: Spacing.md },
  field: { gap: Spacing.xs },
  label: { fontSize: Typography.size.xs, fontWeight: Typography.weight.semibold, color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4 },
  input: {
    backgroundColor: Colors.surface, borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.surfaceBorder,
    padding: Spacing.md, fontSize: Typography.size.sm, color: Colors.textPrimary,
  },
  note: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm,
    backgroundColor: Colors.accentDim, borderRadius: Radius.md, padding: Spacing.md,
    borderWidth: 1, borderColor: Colors.accent + '30',
  },
  noteText: { flex: 1, fontSize: Typography.size.xs, color: Colors.textSecondary, lineHeight: 16 },
  saveBtn: {
    backgroundColor: Colors.primary, borderRadius: Radius.md,
    padding: Spacing.base, alignItems: 'center',
  },
  saveBtnText: { fontSize: Typography.size.base, fontWeight: Typography.weight.semibold, color: Colors.textPrimary },
});
