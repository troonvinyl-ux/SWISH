// SWISH MX Acquisition Calculator
//
// Answers the single most important MX commercial question:
// "Should I buy this bike? How much should I pay?"
//
// Commercial model:
//   Purchase price + Preparation + Parts + Transport
//   vs Expected sale price (from market data or manual estimate)
//   = Expected profit, ROI, and BUY/MAYBE/PASS recommendation
//
// Evidence-based — no invented valuations.

import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  TextInput, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors, Typography, Spacing, Radius, Shadow } from '@/constants/theme';

// ── Types ─────────────────────────────────────────────────────────────────────

interface MXCostInputs {
  purchasePrice: string;
  transportCost: string;
  repairCost: string;
  partsCost: string;
  sellingFeesPct: string;      // eBay ~13.25%
  packagingShipping: string;
}

interface MXSaleInputs {
  expectedSalePrice: string;
  runningStatus: 'runs_rides' | 'runs_only' | 'non_running' | 'unknown';
  marketDataAvailable: boolean;
  marketMedian: string;
}

interface MXCalculationResult {
  totalCost: number;
  netSaleProceeds: number;
  grossProfit: number;
  netProfit: number;
  roi: number;
  margin: number;
  breakEvenSalePrice: number;
  maxBuyPrice: number;
  recommendation: 'BUY' | 'MAYBE' | 'PASS' | 'RESEARCH';
  recommendationReason: string;
  keyRisks: string[];
}

// ── Running status multipliers (applied to estimate expected sale from market median) ──
const RUNNING_STATUS_MULTIPLIER: Record<string, number> = {
  runs_rides:   1.00,
  runs_only:    0.85,
  non_running:  0.55,
  unknown:      0.70,
};

const RUNNING_STATUS_LABELS: Record<string, string> = {
  runs_rides:  'Runs & Rides',
  runs_only:   'Runs (but issues)',
  non_running: 'Non-Running / Project',
  unknown:     'Running Status Unknown',
};

const RUNNING_STATUS_DESCRIPTIONS: Record<string, string> = {
  runs_rides:  '100% of market median — full running value',
  runs_only:   '~85% of running price — starts but not rideable',
  non_running: '~55% of running price — project/parts risk',
  unknown:     '~70% of running price — unknown risk discount',
};

// ── Target ROI thresholds ─────────────────────────────────────────────────────
const MIN_ROI_BUY     = 0.30;  // 30% ROI minimum for BUY
const MIN_ROI_MAYBE   = 0.15;  // 15% ROI minimum for MAYBE
const MIN_PROFIT_BUY  = 150;   // Absolute minimum profit for BUY
const MIN_PROFIT_MAYBE = 75;   // Absolute minimum profit for MAYBE

function calculate(costs: MXCostInputs, sale: MXSaleInputs): MXCalculationResult | null {
  const purchase = parseFloat(costs.purchasePrice) || 0;
  const transport = parseFloat(costs.transportCost) || 0;
  const repair = parseFloat(costs.repairCost) || 0;
  const parts = parseFloat(costs.partsCost) || 0;
  const feesPct = (parseFloat(costs.sellingFeesPct) || 13.25) / 100;
  const packShip = parseFloat(costs.packagingShipping) || 0;

  const expectedSale = parseFloat(sale.expectedSalePrice) || 0;
  if (purchase <= 0 || expectedSale <= 0) return null;

  const totalCost = purchase + transport + repair + parts;
  const sellingFees = expectedSale * feesPct;
  const netSaleProceeds = expectedSale - sellingFees - packShip;
  const grossProfit = expectedSale - totalCost;
  const netProfit = netSaleProceeds - totalCost;
  const roi = totalCost > 0 ? netProfit / totalCost : 0;
  const margin = expectedSale > 0 ? netProfit / expectedSale : 0;
  const breakEvenSalePrice = Math.ceil((totalCost + packShip) / (1 - feesPct) * 100) / 100;
  const maxBuyPrice = Math.floor((expectedSale * (1 - feesPct) - packShip - repair - parts - transport) / (1 + MIN_ROI_BUY) * 100) / 100;

  const keyRisks: string[] = [];
  if (sale.runningStatus === 'unknown') keyRisks.push('Running status unknown — budget for engine/mechanicals');
  if (sale.runningStatus === 'non_running') keyRisks.push('Non-running bike — significant repair risk');
  if (repair > purchase * 0.3) keyRisks.push('High repair estimate relative to purchase price');
  if (roi < 0) keyRisks.push('Currently loss-making at this purchase price');
  if (netProfit < 0) keyRisks.push('Net proceeds do not cover total cost');
  if (feesPct > 0.15) keyRisks.push('High selling fees — verify fee structure');
  if (!sale.marketDataAvailable) keyRisks.push('Expected sale price is an estimate — verify with market research');

  let recommendation: MXCalculationResult['recommendation'];
  let recommendationReason: string;

  if (roi >= MIN_ROI_BUY && netProfit >= MIN_PROFIT_BUY) {
    recommendation = 'BUY';
    recommendationReason = `${Math.round(roi * 100)}% ROI with £${netProfit.toFixed(0)} net profit — strong commercial case`;
  } else if (roi >= MIN_ROI_MAYBE && netProfit >= MIN_PROFIT_MAYBE) {
    recommendation = 'MAYBE';
    recommendationReason = `${Math.round(roi * 100)}% ROI with £${netProfit.toFixed(0)} net profit — marginal case, negotiate or reduce costs`;
  } else if (roi < 0 || netProfit < 0) {
    recommendation = 'PASS';
    recommendationReason = `Loss-making at these numbers — not commercially viable`;
  } else {
    recommendation = 'RESEARCH';
    recommendationReason = `${Math.round(roi * 100)}% ROI — below target. Get better market data or negotiate lower purchase price`;
  }

  return {
    totalCost, netSaleProceeds, grossProfit, netProfit, roi, margin,
    breakEvenSalePrice, maxBuyPrice: Math.max(0, maxBuyPrice),
    recommendation, recommendationReason, keyRisks,
  };
}

// ── Components ────────────────────────────────────────────────────────────────

function InputRow({ label, value, onChange, prefix = '£', suffix, placeholder, keyboardType = 'decimal-pad', hint }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  prefix?: string;
  suffix?: string;
  placeholder?: string;
  keyboardType?: any;
  hint?: string;
}) {
  return (
    <View style={s.inputRow}>
      <View style={s.inputLabelWrap}>
        <Text style={s.inputLabel}>{label}</Text>
        {hint ? <Text style={s.inputHint}>{hint}</Text> : null}
      </View>
      <View style={s.inputWrap}>
        {prefix ? <Text style={s.inputPrefix}>{prefix}</Text> : null}
        <TextInput
          style={s.input}
          value={value}
          onChangeText={onChange}
          keyboardType={keyboardType}
          placeholder={placeholder ?? '0'}
          placeholderTextColor={Colors.textTertiary}
          selectTextOnFocus
        />
        {suffix ? <Text style={s.inputSuffix}>{suffix}</Text> : null}
      </View>
    </View>
  );
}

function RecommendationBadge({ rec }: { rec: MXCalculationResult['recommendation'] }) {
  const config = {
    BUY:      { color: Colors.success, bg: Colors.successDim, icon: 'check-circle', label: 'BUY' },
    MAYBE:    { color: Colors.warning, bg: Colors.warningDim, icon: 'help', label: 'MAYBE' },
    PASS:     { color: Colors.danger, bg: Colors.dangerDim, icon: 'cancel', label: 'PASS' },
    RESEARCH: { color: Colors.info, bg: Colors.infoDim ?? (Colors.info + '15'), icon: 'search', label: 'RESEARCH MORE' },
  }[rec];

  return (
    <View style={[s.recBadge, { backgroundColor: config.bg, borderColor: config.color + '50' }]}>
      <MaterialIcons name={config.icon as any} size={32} color={config.color} />
      <Text style={[s.recLabel, { color: config.color }]}>{config.label}</Text>
    </View>
  );
}

// ── Main Screen ───────────────────────────────────────────────────────────────

export default function MXAcquisitionScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [costs, setCosts] = useState<MXCostInputs>({
    purchasePrice: '',
    transportCost: '',
    repairCost: '',
    partsCost: '',
    sellingFeesPct: '13.25',
    packagingShipping: '50',
  });

  const [sale, setSale] = useState<MXSaleInputs>({
    expectedSalePrice: '',
    runningStatus: 'unknown',
    marketDataAvailable: false,
    marketMedian: '',
  });

  const [result, setResult] = useState<MXCalculationResult | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const updateCost = (key: keyof MXCostInputs) => (val: string) => setCosts(prev => ({ ...prev, [key]: val }));
  const updateSale = (key: keyof MXSaleInputs) => (val: any) => setSale(prev => ({ ...prev, [key]: val }));

  // Auto-update expected sale price when running status or market median changes
  useEffect(() => {
    const median = parseFloat(sale.marketMedian);
    if (!isNaN(median) && median > 0) {
      const multiplier = RUNNING_STATUS_MULTIPLIER[sale.runningStatus] ?? 0.70;
      const estimated = Math.round(median * multiplier);
      setSale(prev => ({ ...prev, expectedSalePrice: String(estimated) }));
    }
  }, [sale.runningStatus, sale.marketMedian]);

  // Recalculate whenever inputs change
  useEffect(() => {
    setResult(calculate(costs, sale));
  }, [costs, sale]);

  const handleReset = useCallback(() => {
    setCosts({ purchasePrice: '', transportCost: '', repairCost: '', partsCost: '', sellingFeesPct: '13.25', packagingShipping: '50' });
    setSale({ expectedSalePrice: '', runningStatus: 'unknown', marketDataAvailable: false, marketMedian: '' });
    setResult(null);
  }, []);

  const maxBuyFormatted = result ? `£${result.maxBuyPrice.toFixed(0)}` : '—';
  const roiFormatted = result ? `${Math.round(result.roi * 100)}%` : '—';
  const netProfitFormatted = result ? `£${result.netProfit.toFixed(0)}` : '—';

  return (
    <View style={s.container}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={[s.header, { paddingTop: insets.top + Spacing.sm }]}>
        <Pressable onPress={() => router.back()} style={s.backBtn} hitSlop={8}>
          <MaterialIcons name="arrow-back" size={20} color={Colors.textSecondary} />
        </Pressable>
        <View style={s.headerCenter}>
          <Text style={s.headerTitle}>MX Acquisition Calculator</Text>
          <Text style={s.headerSub}>Should I buy this bike?</Text>
        </View>
        <Pressable onPress={handleReset} style={s.resetBtn} hitSlop={8}>
          <MaterialIcons name="refresh" size={18} color={Colors.textTertiary} />
        </Pressable>
      </View>

      <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 32 }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Recommendation bar (sticky context) */}
          {result ? (
            <View style={s.summaryBar}>
              <RecommendationBadge rec={result.recommendation} />
              <View style={s.summaryMetrics}>
                <View style={s.summaryMetric}>
                  <Text style={s.summaryMetricLabel}>Net Profit</Text>
                  <Text style={[s.summaryMetricValue, { color: result.netProfit >= 0 ? Colors.success : Colors.danger }]}>
                    {netProfitFormatted}
                  </Text>
                </View>
                <View style={s.summaryDivider} />
                <View style={s.summaryMetric}>
                  <Text style={s.summaryMetricLabel}>ROI</Text>
                  <Text style={[s.summaryMetricValue, { color: result.roi >= MIN_ROI_BUY ? Colors.success : result.roi >= MIN_ROI_MAYBE ? Colors.warning : Colors.danger }]}>
                    {roiFormatted}
                  </Text>
                </View>
                <View style={s.summaryDivider} />
                <View style={s.summaryMetric}>
                  <Text style={s.summaryMetricLabel}>Max Buy Price</Text>
                  <Text style={[s.summaryMetricValue, { color: Colors.primary }]}>{maxBuyFormatted}</Text>
                </View>
              </View>
            </View>
          ) : (
            <View style={s.placeholderBar}>
              <MaterialIcons name="calculate" size={20} color={Colors.textTertiary} />
              <Text style={s.placeholderText}>Enter purchase price and expected sale to see recommendation</Text>
            </View>
          )}

          {/* Running status selector */}
          <View style={s.card}>
            <Text style={s.cardTitle}>RUNNING STATUS</Text>
            <Text style={s.cardSub}>Running status is the single biggest variable in MX pricing</Text>
            <View style={s.runningGrid}>
              {(Object.entries(RUNNING_STATUS_LABELS) as Array<[keyof typeof RUNNING_STATUS_LABELS, string]>).map(([status, label]) => (
                <Pressable
                  key={status}
                  onPress={() => updateSale('runningStatus')(status)}
                  style={[
                    s.runningChip,
                    sale.runningStatus === status && s.runningChipActive,
                  ]}
                >
                  <Text style={[s.runningChipLabel, sale.runningStatus === status && s.runningChipLabelActive]}>
                    {label}
                  </Text>
                  <Text style={[s.runningChipDesc, sale.runningStatus === status && { color: Colors.primary + 'BB' }]}>
                    {RUNNING_STATUS_DESCRIPTIONS[status]}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          {/* Market reference */}
          <View style={s.card}>
            <Text style={s.cardTitle}>MARKET REFERENCE</Text>
            <Text style={s.cardSub}>Enter market median from eBay sold data (optional — helps auto-estimate sale price)</Text>
            <InputRow
              label="Market Median (Running)"
              value={sale.marketMedian}
              onChange={v => { updateSale('marketMedian')(v); if (v) updateSale('marketDataAvailable')(true); }}
              placeholder="e.g. 1800"
              hint="Median sold price for this model in running condition on eBay"
            />
            {sale.marketMedian && parseFloat(sale.marketMedian) > 0 ? (
              <View style={s.marketNote}>
                <MaterialIcons name="auto-awesome" size={12} color={Colors.primary} />
                <Text style={s.marketNoteText}>
                  Auto-calculated: {sale.runningStatus} × {Math.round(RUNNING_STATUS_MULTIPLIER[sale.runningStatus] * 100)}% = £{Math.round(parseFloat(sale.marketMedian) * RUNNING_STATUS_MULTIPLIER[sale.runningStatus])} estimated sale price
                </Text>
              </View>
            ) : null}
          </View>

          {/* Cost inputs */}
          <View style={s.card}>
            <Text style={s.cardTitle}>COSTS</Text>
            <InputRow label="Purchase Price" value={costs.purchasePrice} onChange={updateCost('purchasePrice')} placeholder="1200" hint="Asking / agreed price" />
            <InputRow label="Repair / Labour" value={costs.repairCost} onChange={updateCost('repairCost')} placeholder="0" hint="Expected mechanical work" />
            <InputRow label="Parts" value={costs.partsCost} onChange={updateCost('partsCost')} placeholder="0" hint="New/used parts needed" />
            <InputRow label="Transport" value={costs.transportCost} onChange={updateCost('transportCost')} placeholder="0" hint="Collection or delivery cost" />
          </View>

          {/* Sale price */}
          <View style={s.card}>
            <Text style={s.cardTitle}>EXPECTED SALE</Text>
            <InputRow
              label="Expected Sale Price"
              value={sale.expectedSalePrice}
              onChange={updateSale('expectedSalePrice')}
              placeholder="e.g. 1800"
              hint={sale.marketDataAvailable ? 'Auto-estimated from market data — adjust if needed' : 'Enter your best estimate from market research'}
            />
            {!sale.marketDataAvailable ? (
              <View style={s.warningNote}>
                <MaterialIcons name="warning" size={12} color={Colors.warning} />
                <Text style={s.warningNoteText}>No market data — manually verify this price before committing to purchase</Text>
              </View>
            ) : null}
          </View>

          {/* Advanced options */}
          <Pressable onPress={() => setShowAdvanced(v => !v)} style={s.advancedToggle}>
            <Text style={s.advancedToggleText}>Advanced selling costs</Text>
            <MaterialIcons name={showAdvanced ? 'expand-less' : 'expand-more'} size={16} color={Colors.textTertiary} />
          </Pressable>

          {showAdvanced ? (
            <View style={s.card}>
              <Text style={s.cardTitle}>SELLING COSTS</Text>
              <InputRow label="eBay Fees" value={costs.sellingFeesPct} onChange={updateCost('sellingFeesPct')} prefix="%" suffix="" placeholder="13.25" hint="eBay final value fee % (default 13.25%)" keyboardType="decimal-pad" />
              <InputRow label="Packaging / Shipping" value={costs.packagingShipping} onChange={updateCost('packagingShipping')} placeholder="50" hint="Estimate for shipping or buyer collection costs" />
            </View>
          ) : null}

          {/* Results breakdown */}
          {result ? (
            <>
              {/* Recommendation card */}
              <View style={[s.card, { borderColor: result.recommendation === 'BUY' ? Colors.success + '50' : result.recommendation === 'PASS' ? Colors.danger + '50' : Colors.warning + '50', borderWidth: 1.5 }]}>
                <View style={s.recHeader}>
                  <RecommendationBadge rec={result.recommendation} />
                  <View style={s.flex}>
                    <Text style={s.cardTitle}>DECISION</Text>
                    <Text style={s.recReason}>{result.recommendationReason}</Text>
                  </View>
                </View>
              </View>

              {/* Full breakdown */}
              <View style={s.card}>
                <Text style={s.cardTitle}>FULL BREAKDOWN</Text>

                <View style={s.breakdownSection}>
                  <Text style={s.breakdownSectionLabel}>COSTS</Text>
                  <BreakdownRow label="Purchase price" value={`£${(parseFloat(costs.purchasePrice) || 0).toFixed(0)}`} />
                  {parseFloat(costs.transportCost) > 0 ? <BreakdownRow label="Transport" value={`£${(parseFloat(costs.transportCost) || 0).toFixed(0)}`} /> : null}
                  {parseFloat(costs.repairCost) > 0 ? <BreakdownRow label="Repair / labour" value={`£${(parseFloat(costs.repairCost) || 0).toFixed(0)}`} /> : null}
                  {parseFloat(costs.partsCost) > 0 ? <BreakdownRow label="Parts" value={`£${(parseFloat(costs.partsCost) || 0).toFixed(0)}`} /> : null}
                  <BreakdownRow label="Total cost" value={`£${result.totalCost.toFixed(0)}`} bold />
                </View>

                <View style={s.breakdownSection}>
                  <Text style={s.breakdownSectionLabel}>SALE</Text>
                  <BreakdownRow label="Expected sale price" value={`£${(parseFloat(sale.expectedSalePrice) || 0).toFixed(0)}`} />
                  <BreakdownRow label={`eBay fees (${costs.sellingFeesPct}%)`} value={`-£${((parseFloat(sale.expectedSalePrice) || 0) * (parseFloat(costs.sellingFeesPct) || 13.25) / 100).toFixed(0)}`} />
                  {parseFloat(costs.packagingShipping) > 0 ? <BreakdownRow label="Packaging/shipping" value={`-£${(parseFloat(costs.packagingShipping) || 0).toFixed(0)}`} /> : null}
                  <BreakdownRow label="Net proceeds" value={`£${result.netSaleProceeds.toFixed(0)}`} bold />
                </View>

                <View style={[s.breakdownSection, { borderBottomWidth: 0 }]}>
                  <Text style={s.breakdownSectionLabel}>RESULT</Text>
                  <BreakdownRow label="Net profit" value={`£${result.netProfit.toFixed(0)}`} bold highlight={result.netProfit >= 0 ? 'good' : 'bad'} />
                  <BreakdownRow label="ROI" value={roiFormatted} highlight={result.roi >= MIN_ROI_BUY ? 'good' : result.roi >= 0 ? 'neutral' : 'bad'} />
                  <BreakdownRow label="Margin" value={`${Math.round(result.margin * 100)}%`} />
                  <BreakdownRow label="Break-even sale price" value={`£${result.breakEvenSalePrice.toFixed(0)}`} />
                  <BreakdownRow label="Max buy price (30% ROI)" value={`£${result.maxBuyPrice.toFixed(0)}`} highlight="neutral" />
                </View>
              </View>

              {/* Key risks */}
              {result.keyRisks.length > 0 ? (
                <View style={s.risksCard}>
                  <Text style={s.cardTitle}>KEY RISKS</Text>
                  {result.keyRisks.map((risk, i) => (
                    <View key={i} style={s.riskRow}>
                      <MaterialIcons name="warning" size={13} color={Colors.warning} />
                      <Text style={s.riskText}>{risk}</Text>
                    </View>
                  ))}
                </View>
              ) : null}

              {/* Max buy price guidance */}
              <View style={s.guidanceCard}>
                <Text style={s.cardTitle}>NEGOTIATION GUIDANCE</Text>
                <View style={s.guidanceRow}>
                  <Text style={s.guidanceLabel}>To achieve 30% ROI:</Text>
                  <Text style={s.guidanceValue}>Buy at ≤ £{result.maxBuyPrice.toFixed(0)}</Text>
                </View>
                <View style={s.guidanceRow}>
                  <Text style={s.guidanceLabel}>Current purchase price:</Text>
                  <Text style={[s.guidanceValue, {
                    color: parseFloat(costs.purchasePrice) <= result.maxBuyPrice ? Colors.success : Colors.danger,
                  }]}>£{parseFloat(costs.purchasePrice) || 0}</Text>
                </View>
                {parseFloat(costs.purchasePrice) > result.maxBuyPrice && result.maxBuyPrice > 0 ? (
                  <View style={s.guidanceNote}>
                    <MaterialIcons name="info" size={12} color={Colors.info} />
                    <Text style={s.guidanceNoteText}>
                      Negotiate £{(parseFloat(costs.purchasePrice) - result.maxBuyPrice).toFixed(0)} off to hit 30% ROI target
                    </Text>
                  </View>
                ) : null}
              </View>
            </>
          ) : null}

          {/* Disclaimer */}
          <View style={s.disclaimer}>
            <MaterialIcons name="info-outline" size={13} color={Colors.textTertiary} />
            <Text style={s.disclaimerText}>
              This calculator provides a commercial framework — not financial advice. Always verify market prices with eBay sold data before committing to a purchase. Running status should be confirmed in person.
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function BreakdownRow({ label, value, bold, highlight }: { label: string; value: string; bold?: boolean; highlight?: 'good' | 'bad' | 'neutral' }) {
  const valueColor = highlight === 'good' ? Colors.success : highlight === 'bad' ? Colors.danger : highlight === 'neutral' ? Colors.primary : Colors.textPrimary;
  return (
    <View style={s.breakdownRow}>
      <Text style={[s.breakdownLabel, bold && s.breakdownLabelBold]}>{label}</Text>
      <Text style={[s.breakdownValue, bold && s.breakdownValueBold, { color: valueColor }]}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },

  header: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingHorizontal: Spacing.base, paddingBottom: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder,
  },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  headerSub: { fontSize: 10, color: Colors.textTertiary, marginTop: 1 },
  backBtn: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.surfaceBorder },
  resetBtn: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.surfaceBorder },

  content: { padding: Spacing.base, gap: Spacing.lg },

  summaryBar: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.surface, borderRadius: Radius.xl, padding: Spacing.md,
    borderWidth: 1, borderColor: Colors.surfaceBorder, ...Shadow.sm,
  },
  summaryMetrics: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around' },
  summaryMetric: { alignItems: 'center', gap: 2, flex: 1 },
  summaryMetricLabel: { fontSize: 9, color: Colors.textTertiary, fontWeight: Typography.weight.semibold, textTransform: 'uppercase', letterSpacing: 0.3 },
  summaryMetricValue: { fontSize: Typography.size.md, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  summaryDivider: { width: 1, height: 32, backgroundColor: Colors.surfaceBorder },

  placeholderBar: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.xl, padding: Spacing.md,
    borderWidth: 1, borderColor: Colors.surfaceBorder,
  },
  placeholderText: { flex: 1, fontSize: Typography.size.xs, color: Colors.textTertiary, lineHeight: 16 },

  card: {
    backgroundColor: Colors.surface, borderRadius: Radius.xl, padding: Spacing.base,
    gap: Spacing.md, borderWidth: 1, borderColor: Colors.surfaceBorder, ...Shadow.sm,
  },
  cardTitle: { fontSize: 10, fontWeight: Typography.weight.bold, color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5 },
  cardSub: { fontSize: Typography.size.xs, color: Colors.textTertiary, lineHeight: 16, marginTop: -Spacing.xs },

  runningGrid: { gap: Spacing.sm },
  runningChip: {
    backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.lg,
    padding: Spacing.md, borderWidth: 1, borderColor: Colors.surfaceBorder,
  },
  runningChipActive: { backgroundColor: Colors.primaryDim, borderColor: Colors.primary + '60' },
  runningChipLabel: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.textPrimary },
  runningChipLabelActive: { color: Colors.primary },
  runningChipDesc: { fontSize: Typography.size.xs, color: Colors.textTertiary, marginTop: 2 },

  inputRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingVertical: Spacing.xs,
  },
  inputLabelWrap: { flex: 1, gap: 2 },
  inputLabel: { fontSize: Typography.size.sm, fontWeight: Typography.weight.medium, color: Colors.textPrimary },
  inputHint: { fontSize: 10, color: Colors.textTertiary, lineHeight: 14 },
  inputWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.surfaceBorder,
    paddingHorizontal: Spacing.sm, minWidth: 110,
  },
  inputPrefix: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.textSecondary },
  inputSuffix: { fontSize: Typography.size.sm, color: Colors.textTertiary },
  input: {
    fontSize: Typography.size.base, fontWeight: Typography.weight.bold,
    color: Colors.textPrimary, paddingVertical: Spacing.sm,
    minWidth: 70, textAlign: 'right', includeFontPadding: false,
  },

  marketNote: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 5,
    backgroundColor: Colors.primaryDim, borderRadius: Radius.sm, padding: Spacing.sm,
  },
  marketNoteText: { flex: 1, fontSize: 11, color: Colors.primary, lineHeight: 15 },

  warningNote: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 5,
    backgroundColor: Colors.warningDim, borderRadius: Radius.sm, padding: Spacing.sm,
  },
  warningNoteText: { flex: 1, fontSize: 11, color: Colors.warning, lineHeight: 15 },

  advancedToggle: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    paddingVertical: Spacing.xs,
  },
  advancedToggleText: { fontSize: Typography.size.xs, color: Colors.textTertiary, fontWeight: Typography.weight.medium },

  recBadge: {
    alignItems: 'center', justifyContent: 'center', gap: 4,
    borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    borderWidth: 1, minWidth: 80,
  },
  recLabel: { fontSize: Typography.size.xs, fontWeight: Typography.weight.bold, letterSpacing: 0.5 },

  recHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md },
  recReason: { fontSize: Typography.size.xs, color: Colors.textSecondary, lineHeight: 17, flex: 1 },

  breakdownSection: {
    borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder,
    paddingBottom: Spacing.md, gap: Spacing.xs,
  },
  breakdownSectionLabel: { fontSize: 9, fontWeight: Typography.weight.bold, color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 },
  breakdownRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 3 },
  breakdownLabel: { fontSize: Typography.size.xs, color: Colors.textSecondary },
  breakdownLabelBold: { fontWeight: Typography.weight.semibold, color: Colors.textPrimary },
  breakdownValue: { fontSize: Typography.size.sm, color: Colors.textPrimary },
  breakdownValueBold: { fontWeight: Typography.weight.bold, fontSize: Typography.size.base },

  risksCard: {
    backgroundColor: Colors.warningDim, borderRadius: Radius.xl, padding: Spacing.base,
    gap: Spacing.sm, borderWidth: 1, borderColor: Colors.warning + '40',
  },
  riskRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  riskText: { flex: 1, fontSize: Typography.size.xs, color: Colors.warning, lineHeight: 17 },

  guidanceCard: {
    backgroundColor: Colors.surface, borderRadius: Radius.xl, padding: Spacing.base,
    gap: Spacing.sm, borderWidth: 1, borderColor: Colors.primary + '30',
  },
  guidanceRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  guidanceLabel: { fontSize: Typography.size.xs, color: Colors.textSecondary },
  guidanceValue: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  guidanceNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 5, backgroundColor: Colors.infoDim ?? (Colors.info + '15'), borderRadius: Radius.sm, padding: Spacing.xs },
  guidanceNoteText: { flex: 1, fontSize: 11, color: Colors.info, lineHeight: 15 },

  disclaimer: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.xs,
    backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.sm, padding: Spacing.sm,
  },
  disclaimerText: { flex: 1, fontSize: Typography.size.xs, color: Colors.textTertiary, lineHeight: 16 },
});
