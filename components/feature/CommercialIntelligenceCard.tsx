// SWISH — Commercial Intelligence Card
// Renders a complete commercial assessment for a single item answering:
//   WHAT IS IT? · WHAT IS IT WORTH? · SHOULD I BUY IT?
//   HOW MUCH SHOULD I PAY? · HOW SHOULD I SELL IT? · WHAT WILL I MAKE?
//
// Evidence is always displayed separately — sources are never blended invisibly.
// Confidence decays with weak evidence, unknown identity, or unknown condition.
// Optimism bias is explicitly blocked — no inflating values because something sounds rare.

import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, Pressable, TextInput } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors, Typography, Spacing, Radius, Shadow } from '@/constants/theme';
import type {
  ItemCommercialIntelligence,
  BuyDecision,
  SellAction,
} from '@/services/commercialEngine';

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function fmt(v: number | null | undefined): string {
  if (v == null || v === 0) return '—';
  return `£${Math.abs(v).toFixed(2)}`;
}

function fmtShort(v: number | null | undefined): string {
  if (v == null || v === 0) return '—';
  return `£${Math.abs(v).toFixed(0)}`;
}

function pct(v: number): string {
  return `${v.toFixed(0)}%`;
}

const DECISION_CONFIG: Record<BuyDecision, { label: string; color: string; icon: string; bg: string }> = {
  BUY:              { label: 'BUY',               color: '#16A34A', icon: 'thumb-up',        bg: '#16A34A12' },
  BUY_IF_UNDER:     { label: 'BUY IF UNDER',       color: '#22C55E', icon: 'price-check',     bg: '#22C55E12' },
  WATCH:            { label: 'WATCH',              color: '#F59E0B', icon: 'visibility',      bg: '#F59E0B12' },
  RESEARCH_FURTHER: { label: 'RESEARCH FURTHER',   color: '#6366F1', icon: 'search',          bg: '#6366F112' },
  DO_NOT_BUY:       { label: 'DO NOT BUY',         color: '#DC2626', icon: 'block',           bg: '#DC262612' },
  PASS:             { label: 'PASS',               color: '#6B7280', icon: 'close',           bg: '#6B728012' },
};

const SELL_ACTION_CONFIG: Record<SellAction, { label: string; color: string; icon: string }> = {
  LIST_NOW:           { label: 'List Now',             color: Colors.success, icon: 'sell' },
  REPRICE:            { label: 'Reprice',               color: Colors.warning, icon: 'price-change' },
  RELIST:             { label: 'Relist',                color: Colors.primary, icon: 'refresh' },
  HOLD:               { label: 'Hold',                  color: Colors.textTertiary, icon: 'pause-circle' },
  BUNDLE:             { label: 'Bundle',                color: Colors.accent, icon: 'layers' },
  SELL_QUICKLY:       { label: 'Sell Quickly',          color: Colors.danger, icon: 'bolt' },
  END_LISTING:        { label: 'End Listing',           color: Colors.danger, icon: 'stop' },
  CHECK_AUTHENTICITY: { label: 'Check Authenticity',    color: Colors.warning, icon: 'verified' },
  CHECK_CONDITION:    { label: 'Check Condition',       color: Colors.warning, icon: 'search' },
  OBTAIN_MORE_PHOTOS: { label: 'Add Photos',            color: Colors.info, icon: 'add-a-photo' },
  RESEARCH_FURTHER:   { label: 'Research Further',      color: Colors.info, icon: 'travel-explore' },
  AUCTION:            { label: 'Try Auction',           color: Colors.gold, icon: 'gavel' },
};

const GRADE_COLORS: Record<string, string> = {
  A: '#16A34A', B: '#22C55E', C: '#F59E0B', D: '#EF4444', F: '#DC2626',
};

// ─────────────────────────────────────────────────────────────────────────────
// SUB-COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────

function CIRow({ label, value, accent, mono }: {
  label: string;
  value: string;
  accent?: string;
  mono?: boolean;
}) {
  return (
    <View style={ci.row}>
      <Text style={ci.rowLabel}>{label}</Text>
      <Text style={[ci.rowValue, accent ? { color: accent } : undefined, mono && { fontFamily: 'monospace' }]}>
        {value}
      </Text>
    </View>
  );
}

function EvidenceBlock({ intel }: { intel: ItemCommercialIntelligence }) {
  const ev = intel.evidence;
  const qualityColor =
    ev.dataQuality === 'strong' ? Colors.success :
    ev.dataQuality === 'adequate' ? Colors.warning :
    ev.dataQuality === 'weak' ? '#EF4444' : Colors.textTertiary;

  return (
    <View style={ci.evidenceBlock}>
      <View style={ci.subHeader}>
        <MaterialIcons name="source" size={11} color={Colors.textTertiary} />
        <Text style={ci.subHeaderText}>EVIDENCE</Text>
        <View style={[ci.qualityChip, { backgroundColor: qualityColor + '18', borderColor: qualityColor + '50' }]}>
          <Text style={[ci.qualityText, { color: qualityColor }]}>
            {ev.dataQuality.replace(/_/g, ' ').toUpperCase()}
          </Text>
        </View>
      </View>

      {/* Disclaimer: never blend invisibly */}
      <Text style={ci.evidenceNote}>{ev.dataQualityReason}</Text>

      {/* Sold data */}
      {ev.relevantSoldCount > 0 ? (
        <View style={ci.evidenceSection}>
          <View style={ci.evidenceSectionHeader}>
            <MaterialIcons name="shopping-bag" size={10} color={Colors.success} />
            <Text style={[ci.evidenceSectionTitle, { color: Colors.success }]}>
              SOLD DATA — {ev.relevantSoldCount} relevant sale{ev.relevantSoldCount !== 1 ? 's' : ''}
            </Text>
          </View>
          {ev.soldMedian ? <CIRow label="Median sold price" value={fmt(ev.soldMedian)} accent={Colors.gold} /> : null}
          {ev.soldRange ? <CIRow label="Sold range" value={`${fmtShort(ev.soldRange[0])} – ${fmtShort(ev.soldRange[1])}`} /> : null}
          {ev.soldDateRange ? <CIRow label="Date range" value={ev.soldDateRange} /> : null}
          <Text style={ci.evidenceCaption}>Sold prices = actual confirmed sales, not asking prices.</Text>
        </View>
      ) : null}

      {/* Active market */}
      {ev.activeCount > 0 && ev.activeMedianAsking ? (
        <View style={ci.evidenceSection}>
          <View style={ci.evidenceSectionHeader}>
            <MaterialIcons name="storefront" size={10} color={Colors.warning} />
            <Text style={[ci.evidenceSectionTitle, { color: Colors.warning }]}>
              ACTIVE MARKET — {ev.activeCount} listing{ev.activeCount !== 1 ? 's' : ''}
            </Text>
          </View>
          <CIRow label="Median asking" value={fmt(ev.activeMedianAsking)} />
          <Text style={ci.evidenceCaption}>Asking prices only — sellers rarely achieve full asking price.</Text>
        </View>
      ) : null}

      {/* Reference data */}
      {ev.referenceSource && ev.referenceValue ? (
        <View style={ci.evidenceSection}>
          <View style={ci.evidenceSectionHeader}>
            <MaterialIcons name="auto-stories" size={10} color={Colors.info} />
            <Text style={[ci.evidenceSectionTitle, { color: Colors.info }]}>
              REFERENCE — {ev.referenceSource}
            </Text>
          </View>
          <CIRow label="Reference value" value={fmt(ev.referenceValue)} />
          <Text style={ci.evidenceCaption}>Reference/catalogue values are retail estimates, not market prices.</Text>
        </View>
      ) : null}

      {ev.soldCount === 0 && ev.activeCount === 0 && !ev.referenceValue ? (
        <View style={ci.noEvidenceRow}>
          <MaterialIcons name="search-off" size={13} color={Colors.textTertiary} />
          <Text style={ci.noEvidenceText}>No market data found. Run Re-Value to search eBay sold prices.</Text>
        </View>
      ) : null}
    </View>
  );
}

function BuyDecisionBlock({ intel, acquisitionCost, onAcquisitionCostSet }: {
  intel: ItemCommercialIntelligence;
  acquisitionCost: number;
  onAcquisitionCostSet?: (cost: number) => void;
}) {
  const calc = intel.buyCalc;
  const cfg = DECISION_CONFIG[calc.decision];
  const [editingCost, setEditingCost] = useState(false);
  const [costDraft, setCostDraft] = useState('');

  const hasCost = acquisitionCost > 0;
  const hasReliableValue = intel.valuationConfidence !== 'insufficient_data' && intel.estimatedSalePrice > 0;

  return (
    <View style={ci.buyBlock}>
      {/* Decision badge */}
      <View style={[ci.decisionBadge, { backgroundColor: cfg.bg, borderColor: cfg.color + '40' }]}>
        <MaterialIcons name={cfg.icon as any} size={16} color={cfg.color} />
        <Text style={[ci.decisionLabel, { color: cfg.color }]}>{cfg.label}</Text>
      </View>

      <Text style={ci.decisionReason}>{calc.decisionReason}</Text>

      {/* Cost breakdown — only when we have reliable data */}
      {hasReliableValue ? (
        <View style={ci.costBreakdown}>
          <Text style={ci.costBreakdownTitle}>COST BREAKDOWN</Text>
          {hasCost ? <CIRow label="Purchase / acquisition" value={fmt(calc.acquisitionCost)} accent={Colors.danger} /> : null}
          {calc.preparationCost > 0 ? <CIRow label="Preparation / repair" value={fmt(calc.preparationCost)} /> : null}
          <CIRow label="eBay selling fees (~)" value={fmt(calc.sellingFees)} />
          <CIRow label="Postage / shipping" value={fmt(calc.shippingCost)} />
          {calc.packagingCost > 0 ? <CIRow label="Packaging" value={fmt(calc.packagingCost)} /> : null}
          <View style={ci.costDivider} />
          <CIRow label="Expected sale price" value={fmt(calc.expectedSalePrice)} accent={Colors.gold} />
          <CIRow label="Expected net sale" value={fmt(calc.expectedNet)} accent={Colors.textSecondary} />
          {hasCost ? (
            <>
              <CIRow
                label="Expected profit"
                value={`${calc.expectedProfit >= 0 ? '+' : ''}${fmt(calc.expectedProfit)}`}
                accent={calc.expectedProfit >= 0 ? Colors.success : Colors.danger}
              />
              <CIRow
                label="ROI"
                value={pct(calc.roiPct)}
                accent={calc.roiPct >= 30 ? Colors.success : calc.roiPct >= 0 ? Colors.warning : Colors.danger}
              />
              <CIRow
                label="Margin"
                value={pct(calc.marginPct)}
                accent={calc.marginPct >= 20 ? Colors.success : calc.marginPct >= 0 ? Colors.warning : Colors.danger}
              />
            </>
          ) : null}
          <CIRow label="Est. days to sale" value={`~${calc.daysToSaleEstimate}d`} />
        </View>
      ) : null}

      {/* Max buy price guidance */}
      {hasReliableValue && calc.maxBuyPriceFor30PctROI > 0 ? (
        <View style={ci.maxBuyBlock}>
          <Text style={ci.maxBuyTitle}>MAXIMUM BUY PRICE GUIDANCE</Text>
          <Text style={ci.maxBuyNote}>
            Based on expected sale price of {fmt(calc.expectedSalePrice)} minus all costs.
          </Text>
          <View style={ci.maxBuyGrid}>
            <View style={ci.maxBuyItem}>
              <Text style={ci.maxBuyItemLabel}>For 30% ROI</Text>
              <Text style={[ci.maxBuyItemValue, { color: Colors.success }]}>{fmtShort(calc.maxBuyPriceFor30PctROI)}</Text>
            </View>
            <View style={ci.maxBuyDivider} />
            <View style={ci.maxBuyItem}>
              <Text style={ci.maxBuyItemLabel}>For 20% ROI</Text>
              <Text style={[ci.maxBuyItemValue, { color: Colors.warning }]}>{fmtShort(calc.maxBuyPriceFor20PctROI)}</Text>
            </View>
            <View style={ci.maxBuyDivider} />
            <View style={ci.maxBuyItem}>
              <Text style={ci.maxBuyItemLabel}>Break Even</Text>
              <Text style={[ci.maxBuyItemValue, { color: Colors.textTertiary }]}>{fmtShort(calc.maxBuyPriceForBreakEven)}</Text>
            </View>
          </View>
          {calc.attractiveAt ? (
            <View style={ci.attractiveNote}>
              <MaterialIcons name="check-circle" size={12} color={Colors.success} />
              <Text style={ci.attractiveNoteText}>
                At {fmtShort(calc.attractiveAt)} purchase price this looks attractive.
              </Text>
            </View>
          ) : null}
          {calc.thinMarginAt ? (
            <View style={[ci.attractiveNote, { backgroundColor: Colors.warning + '10', borderColor: Colors.warning + '30' }]}>
              <MaterialIcons name="warning" size={12} color={Colors.warning} />
              <Text style={[ci.attractiveNoteText, { color: Colors.warning }]}>
                At {fmtShort(calc.thinMarginAt)} the margin is too thin.
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {/* Acquisition cost input — when not yet recorded */}
      {!hasCost && onAcquisitionCostSet ? (
        <View style={ci.setCostRow}>
          {editingCost ? (
            <View style={ci.setCostInput}>
              <Text style={ci.setCostLabel}>£</Text>
              <TextInput
                style={ci.setCostField}
                value={costDraft}
                onChangeText={setCostDraft}
                keyboardType="decimal-pad"
                autoFocus
                placeholder="0.00"
                placeholderTextColor={Colors.textTertiary}
              />
              <Pressable
                onPress={() => {
                  const v = parseFloat(costDraft);
                  if (v > 0) onAcquisitionCostSet(v);
                  setEditingCost(false);
                }}
                style={ci.setCostSave}
                hitSlop={6}
              >
                <MaterialIcons name="check" size={14} color={Colors.background} />
              </Pressable>
              <Pressable onPress={() => setEditingCost(false)} hitSlop={6}>
                <MaterialIcons name="close" size={14} color={Colors.textTertiary} />
              </Pressable>
            </View>
          ) : (
            <Pressable
              onPress={() => { setCostDraft(''); setEditingCost(true); }}
              style={ci.setCostBtn}
            >
              <MaterialIcons name="add" size={13} color={Colors.primary} />
              <Text style={ci.setCostBtnText}>Record acquisition cost for full buy analysis</Text>
            </Pressable>
          )}
        </View>
      ) : null}
    </View>
  );
}

function SellActionBlock({ intel }: { intel: ItemCommercialIntelligence }) {
  const action = intel.sellAction;
  const cfg = SELL_ACTION_CONFIG[action];

  return (
    <View style={ci.sellBlock}>
      <View style={ci.subHeader}>
        <MaterialIcons name="storefront" size={11} color={Colors.textTertiary} />
        <Text style={ci.subHeaderText}>RECOMMENDED SELL ACTION</Text>
      </View>
      <View style={[ci.sellActionBadge, { backgroundColor: cfg.color + '15', borderColor: cfg.color + '40' }]}>
        <MaterialIcons name={cfg.icon as any} size={15} color={cfg.color} />
        <Text style={[ci.sellActionLabel, { color: cfg.color }]}>{cfg.label}</Text>
      </View>
      <Text style={ci.sellActionReason}>{intel.sellActionReason}</Text>
    </View>
  );
}

function NicheContextBlock({ context }: { context: Record<string, string> }) {
  const entries = Object.entries(context);
  if (entries.length === 0) return null;
  return (
    <View style={ci.nicheBlock}>
      <View style={ci.subHeader}>
        <MaterialIcons name="lightbulb-outline" size={11} color={Colors.accent} />
        <Text style={[ci.subHeaderText, { color: Colors.accent }]}>NICHE GUIDANCE</Text>
      </View>
      {entries.map(([key, val]) => (
        <View key={key} style={ci.nicheRow}>
          <Text style={ci.nicheKey}>{key}</Text>
          <Text style={ci.nicheVal}>{val}</Text>
        </View>
      ))}
    </View>
  );
}

function VerifiedOutcomeBlock({ intel }: { intel: ItemCommercialIntelligence }) {
  if (!intel.hasVerifiedOutcome) return null;
  return (
    <View style={ci.outcomeBlock}>
      <View style={ci.subHeader}>
        <MaterialIcons name="verified" size={11} color={Colors.success} />
        <Text style={[ci.subHeaderText, { color: Colors.success }]}>VERIFIED OUTCOME</Text>
      </View>
      {intel.actualSalePrice ? <CIRow label="Actual sale price" value={fmt(intel.actualSalePrice)} accent={Colors.success} /> : null}
      {intel.actualFees != null ? <CIRow label="Actual fees" value={fmt(intel.actualFees)} /> : null}
      {intel.actualDaysToSale != null ? <CIRow label="Days to sale" value={`${intel.actualDaysToSale}d`} /> : null}
      <Text style={ci.outcomeNote}>Human-confirmed outcomes carry higher weight in future recommendations.</Text>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN CARD
// ─────────────────────────────────────────────────────────────────────────────

interface CommercialIntelligenceCardProps {
  intel: ItemCommercialIntelligence;
  acquisitionCost: number;
  onAcquisitionCostSet?: (cost: number) => void;
}

export function CommercialIntelligenceCard({
  intel,
  acquisitionCost,
  onAcquisitionCostSet,
}: CommercialIntelligenceCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [decisionOpen, setDecisionOpen] = useState(false);

  const gradeColor = GRADE_COLORS[intel.grade] ?? Colors.textTertiary;
  const identConfColor =
    intel.identificationTier === 'confirmed' ? Colors.success :
    intel.identificationTier === 'probable' ? Colors.warning :
    intel.identificationTier === 'possible' ? Colors.danger : Colors.textTertiary;
  const valConfColor =
    intel.valuationConfidence === 'high' ? Colors.success :
    intel.valuationConfidence === 'medium' ? Colors.warning :
    intel.valuationConfidence === 'low' ? Colors.danger : Colors.textTertiary;
  const decisionCfg = DECISION_CONFIG[intel.buyCalc.decision];

  return (
    <View style={ci.card}>
      {/* ── COLLAPSED HEADER ── */}
      <Pressable onPress={() => setExpanded(e => !e)} style={ci.header}>
        <View style={ci.headerLeft}>
          {/* SWISH Score badge */}
          <View style={[ci.scoreBadge, { backgroundColor: gradeColor + '20', borderColor: gradeColor + '50' }]}>
            <Text style={[ci.scoreGrade, { color: gradeColor }]}>{intel.grade}</Text>
            <Text style={[ci.scoreNum, { color: gradeColor }]}>{intel.score}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={ci.headerTitle}>Commercial Intelligence</Text>
            {/* Compact summary row */}
            <View style={ci.headerSummary}>
              {intel.estimatedSalePrice > 0 ? (
                <Text style={ci.headerSalePrice}>Est. {fmt(intel.estimatedSalePrice)}</Text>
              ) : null}
              <View style={[ci.decisionPill, { backgroundColor: decisionCfg.color + '18' }]}>
                <MaterialIcons name={decisionCfg.icon as any} size={9} color={decisionCfg.color} />
                <Text style={[ci.decisionPillText, { color: decisionCfg.color }]}>{decisionCfg.label}</Text>
              </View>
            </View>
          </View>
        </View>
        <MaterialIcons
          name={expanded ? 'keyboard-arrow-up' : 'keyboard-arrow-down'}
          size={18}
          color={Colors.textTertiary}
        />
      </Pressable>

      {/* ── COLLAPSED SUMMARY STRIP ── */}
      {!expanded ? (
        <View style={ci.collapsedStrip}>
          <View style={ci.stripItem}>
            <Text style={ci.stripLabel}>ID</Text>
            <Text style={[ci.stripValue, { color: identConfColor }]}>
              {Math.round(intel.identificationConfidence * 100)}%
            </Text>
          </View>
          <View style={ci.stripDivider} />
          <View style={ci.stripItem}>
            <Text style={ci.stripLabel}>VALUE</Text>
            <Text style={[ci.stripValue, { color: valConfColor }]}>
              {intel.valuationConfidence === 'insufficient_data' ? 'N/A' : intel.valuationConfidence.toUpperCase()}
            </Text>
          </View>
          <View style={ci.stripDivider} />
          <View style={ci.stripItem}>
            <Text style={ci.stripLabel}>PROFIT</Text>
            <Text style={[
              ci.stripValue,
              { color: intel.buyCalc.expectedProfit > 0 ? Colors.success : intel.buyCalc.expectedProfit < 0 ? Colors.danger : Colors.textTertiary },
            ]}>
              {acquisitionCost > 0 && intel.estimatedSalePrice > 0
                ? `${intel.buyCalc.expectedProfit >= 0 ? '+' : ''}${fmtShort(intel.buyCalc.expectedProfit)}`
                : '—'}
            </Text>
          </View>
          <View style={ci.stripDivider} />
          <View style={ci.stripItem}>
            <Text style={ci.stripLabel}>ACTION</Text>
            <Text style={[ci.stripValue, { color: SELL_ACTION_CONFIG[intel.sellAction].color }]}>
              {SELL_ACTION_CONFIG[intel.sellAction].label.toUpperCase()}
            </Text>
          </View>
        </View>
      ) : null}

      {/* ── EXPANDED CONTENT ── */}
      {expanded ? (
        <View style={ci.expandedContent}>

          {/* Score reasoning */}
          {intel.scoreReasoning.length > 0 ? (
            <View style={ci.scoreReasonBlock}>
              {intel.scoreReasoning.map((r, i) => (
                <View key={i} style={ci.scoreReasonRow}>
                  <MaterialIcons name="circle" size={5} color={Colors.textTertiary} style={{ marginTop: 5, flexShrink: 0 }} />
                  <Text style={ci.scoreReasonText}>{r}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {/* Identification & valuation confidence */}
          <View style={ci.confidenceRow}>
            <View style={[ci.confPill, { backgroundColor: identConfColor + '15', borderColor: identConfColor + '40' }]}>
              <MaterialIcons name="search" size={10} color={identConfColor} />
              <Text style={[ci.confPillText, { color: identConfColor }]}>
                ID {Math.round(intel.identificationConfidence * 100)}%
              </Text>
            </View>
            <View style={[ci.confPill, { backgroundColor: valConfColor + '15', borderColor: valConfColor + '40' }]}>
              <MaterialIcons name="bar-chart" size={10} color={valConfColor} />
              <Text style={[ci.confPillText, { color: valConfColor }]}>
                VALUE {intel.valuationConfidence.replace(/_/g, ' ').toUpperCase()}
              </Text>
            </View>
          </View>

          {intel.identificationNote ? (
            <Text style={ci.identNote}>{intel.identificationNote}</Text>
          ) : null}

          {/* Valuation headline */}
          {intel.estimatedSalePrice > 0 ? (
            <View style={ci.valuationCard}>
              <Text style={ci.valuationCardLabel}>SWISH ESTIMATED MARKET VALUE</Text>
              <View style={ci.valuationRow}>
                <View style={ci.valuationItem}>
                  <Text style={ci.valuationItemLabel}>LOW</Text>
                  <Text style={ci.valuationItemValue}>{fmtShort(intel.valuationRange[0])}</Text>
                </View>
                <View style={[ci.valuationItem, ci.valuationMid]}>
                  <Text style={ci.valuationItemLabel}>ESTIMATED</Text>
                  <Text style={[ci.valuationItemValueLarge, { color: Colors.gold }]}>{fmt(intel.estimatedSalePrice)}</Text>
                </View>
                <View style={ci.valuationItem}>
                  <Text style={ci.valuationItemLabel}>HIGH</Text>
                  <Text style={ci.valuationItemValue}>{fmtShort(intel.valuationRange[1])}</Text>
                </View>
              </View>
              <Text style={ci.valuationCaption}>
                {intel.evidence.dataQuality === 'strong'
                  ? `Based on ${intel.evidence.relevantSoldCount} comparable sold prices.`
                  : intel.evidence.dataQuality === 'adequate'
                  ? `Based on ${intel.evidence.relevantSoldCount} sold prices — limited data, use caution.`
                  : intel.evidence.dataQuality === 'weak'
                  ? 'Based on asking prices only — actual sale prices may differ.'
                  : 'Insufficient evidence — treat as approximate only.'}
              </Text>
            </View>
          ) : null}

          {/* Evidence section */}
          <Pressable onPress={() => setEvidenceOpen(e => !e)} style={ci.toggleSection}>
            <MaterialIcons name="source" size={13} color={Colors.textSecondary} />
            <Text style={ci.toggleSectionText}>Evidence breakdown</Text>
            <MaterialIcons name={evidenceOpen ? 'expand-less' : 'expand-more'} size={16} color={Colors.textTertiary} />
          </Pressable>
          {evidenceOpen ? <EvidenceBlock intel={intel} /> : null}

          {/* Buy decision section */}
          <Pressable onPress={() => setDecisionOpen(e => !e)} style={[ci.toggleSection, { borderTopColor: decisionCfg.color + '30' }]}>
            <MaterialIcons name="price-check" size={13} color={decisionCfg.color} />
            <Text style={[ci.toggleSectionText, { color: decisionCfg.color }]}>Buy analysis</Text>
            <View style={[ci.decisionPill, { backgroundColor: decisionCfg.color + '18' }]}>
              <Text style={[ci.decisionPillText, { color: decisionCfg.color }]}>{decisionCfg.label}</Text>
            </View>
            <MaterialIcons name={decisionOpen ? 'expand-less' : 'expand-more'} size={16} color={Colors.textTertiary} />
          </Pressable>
          {decisionOpen ? (
            <BuyDecisionBlock
              intel={intel}
              acquisitionCost={acquisitionCost}
              onAcquisitionCostSet={onAcquisitionCostSet}
            />
          ) : null}

          {/* Sell action */}
          <SellActionBlock intel={intel} />

          {/* Niche context */}
          {Object.keys(intel.nicheContext).length > 0 ? (
            <NicheContextBlock context={intel.nicheContext} />
          ) : null}

          {/* Verified outcome */}
          <VerifiedOutcomeBlock intel={intel} />

          {/* Footer */}
          <Text style={ci.footer}>
            SWISH Commercial Intelligence · {intel.modelVersion} · {new Date(intel.calculatedAt).toLocaleDateString('en-GB')}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────────────────────────

const ci = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: Colors.gold + '30',
    overflow: 'hidden',
    ...Shadow.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    padding: Spacing.md,
  },
  headerLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  scoreBadge: {
    width: 48,
    height: 48,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 0,
    flexShrink: 0,
  },
  scoreGrade: {
    fontSize: 16,
    fontWeight: Typography.weight.extrabold,
    lineHeight: 18,
  },
  scoreNum: {
    fontSize: 10,
    fontWeight: Typography.weight.bold,
  },
  headerTitle: {
    fontSize: 10,
    fontWeight: Typography.weight.bold,
    color: Colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  headerSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginTop: 2,
    flexWrap: 'wrap',
  },
  headerSalePrice: {
    fontSize: Typography.size.sm,
    fontWeight: Typography.weight.bold,
    color: Colors.gold,
  },
  decisionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderRadius: Radius.pill,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  decisionPillText: {
    fontSize: 8,
    fontWeight: Typography.weight.bold,
    letterSpacing: 0.3,
  },

  // Collapsed strip
  collapsedStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: Colors.surfaceBorder,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
  stripItem: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  stripDivider: {
    width: 1,
    height: 28,
    backgroundColor: Colors.surfaceBorder,
  },
  stripLabel: {
    fontSize: 8,
    fontWeight: Typography.weight.bold,
    color: Colors.textTertiary,
    letterSpacing: 0.4,
  },
  stripValue: {
    fontSize: 11,
    fontWeight: Typography.weight.bold,
    color: Colors.textPrimary,
    textAlign: 'center',
  },

  // Expanded content
  expandedContent: {
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.surfaceBorder,
    paddingTop: Spacing.md,
    gap: Spacing.sm,
  },
  scoreReasonBlock: {
    backgroundColor: Colors.surfaceHighlight,
    borderRadius: Radius.md,
    padding: Spacing.sm,
    gap: 4,
  },
  scoreReasonRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.xs,
  },
  scoreReasonText: {
    flex: 1,
    fontSize: Typography.size.xs,
    color: Colors.textSecondary,
    lineHeight: 15,
  },
  confidenceRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    flexWrap: 'wrap',
  },
  confPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: Radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
  },
  confPillText: {
    fontSize: 9,
    fontWeight: Typography.weight.bold,
    letterSpacing: 0.3,
  },
  identNote: {
    fontSize: Typography.size.xs,
    color: Colors.textTertiary,
    lineHeight: 15,
    fontStyle: 'italic',
  },

  // Valuation card
  valuationCard: {
    backgroundColor: Colors.goldDim,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.gold + '30',
  },
  valuationCardLabel: {
    fontSize: 9,
    fontWeight: Typography.weight.bold,
    color: Colors.textTertiary,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  valuationRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  valuationItem: {
    alignItems: 'center',
    gap: 2,
    flex: 1,
  },
  valuationMid: {
    backgroundColor: Colors.gold + '15',
    borderRadius: Radius.md,
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.sm,
  },
  valuationItemLabel: {
    fontSize: 8,
    color: Colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  valuationItemValue: {
    fontSize: Typography.size.md,
    fontWeight: Typography.weight.bold,
    color: Colors.textPrimary,
  },
  valuationItemValueLarge: {
    fontSize: Typography.size.xl,
    fontWeight: Typography.weight.bold,
  },
  valuationCaption: {
    fontSize: 10,
    color: Colors.textTertiary,
    lineHeight: 14,
    fontStyle: 'italic',
    textAlign: 'center',
  },

  // Toggle section headers
  toggleSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.surfaceBorder,
  },
  toggleSectionText: {
    flex: 1,
    fontSize: Typography.size.xs,
    fontWeight: Typography.weight.semibold,
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },

  // Evidence block
  evidenceBlock: {
    backgroundColor: Colors.surfaceHighlight,
    borderRadius: Radius.md,
    padding: Spacing.md,
    gap: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  subHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  subHeaderText: {
    flex: 1,
    fontSize: 9,
    fontWeight: Typography.weight.bold,
    color: Colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  qualityChip: {
    borderRadius: Radius.pill,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 1,
  },
  qualityText: {
    fontSize: 8,
    fontWeight: Typography.weight.bold,
    letterSpacing: 0.3,
  },
  evidenceNote: {
    fontSize: Typography.size.xs,
    color: Colors.textTertiary,
    lineHeight: 15,
  },
  evidenceSection: {
    gap: 3,
    borderTopWidth: 1,
    borderTopColor: Colors.surfaceBorder,
    paddingTop: Spacing.xs,
  },
  evidenceSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 2,
  },
  evidenceSectionTitle: {
    fontSize: 9,
    fontWeight: Typography.weight.bold,
    letterSpacing: 0.3,
  },
  evidenceCaption: {
    fontSize: 9,
    color: Colors.textTertiary,
    fontStyle: 'italic',
    lineHeight: 13,
    marginTop: 2,
  },
  noEvidenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingVertical: Spacing.xs,
  },
  noEvidenceText: {
    flex: 1,
    fontSize: Typography.size.xs,
    color: Colors.textTertiary,
    lineHeight: 16,
  },

  // CIRow
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceBorder + '60',
  },
  rowLabel: {
    width: 140,
    fontSize: Typography.size.xs,
    color: Colors.textTertiary,
    flexShrink: 0,
  },
  rowValue: {
    flex: 1,
    fontSize: Typography.size.xs,
    fontWeight: Typography.weight.semibold,
    color: Colors.textPrimary,
    textAlign: 'right',
  },

  // Buy decision block
  buyBlock: {
    backgroundColor: Colors.surfaceHighlight,
    borderRadius: Radius.md,
    padding: Spacing.md,
    gap: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  decisionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    borderRadius: Radius.md,
    padding: Spacing.md,
    borderWidth: 1,
  },
  decisionLabel: {
    fontSize: Typography.size.base,
    fontWeight: Typography.weight.extrabold,
    letterSpacing: 0.5,
  },
  decisionReason: {
    fontSize: Typography.size.sm,
    color: Colors.textSecondary,
    lineHeight: 18,
  },
  costBreakdown: {
    gap: 2,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    padding: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  costBreakdownTitle: {
    fontSize: 9,
    fontWeight: Typography.weight.bold,
    color: Colors.textTertiary,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  costDivider: {
    height: 1,
    backgroundColor: Colors.surfaceBorder,
    marginVertical: 4,
  },
  maxBuyBlock: {
    backgroundColor: Colors.successDim,
    borderRadius: Radius.md,
    padding: Spacing.md,
    gap: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.success + '30',
  },
  maxBuyTitle: {
    fontSize: 9,
    fontWeight: Typography.weight.bold,
    color: Colors.textTertiary,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  maxBuyNote: {
    fontSize: 10,
    color: Colors.textTertiary,
    lineHeight: 14,
  },
  maxBuyGrid: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
  },
  maxBuyItem: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  maxBuyDivider: {
    width: 1,
    height: 32,
    backgroundColor: Colors.success + '30',
  },
  maxBuyItemLabel: {
    fontSize: 9,
    color: Colors.textTertiary,
    textAlign: 'center',
  },
  maxBuyItemValue: {
    fontSize: Typography.size.lg,
    fontWeight: Typography.weight.bold,
  },
  attractiveNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.xs,
    backgroundColor: Colors.success + '10',
    borderRadius: Radius.sm,
    padding: Spacing.xs,
    borderWidth: 1,
    borderColor: Colors.success + '30',
  },
  attractiveNoteText: {
    flex: 1,
    fontSize: Typography.size.xs,
    color: Colors.success,
    lineHeight: 15,
  },
  setCostRow: {
    marginTop: 2,
  },
  setCostBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: Colors.primaryDim,
    borderRadius: Radius.md,
    padding: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.primary + '40',
  },
  setCostBtnText: {
    flex: 1,
    fontSize: Typography.size.xs,
    color: Colors.primary,
    fontWeight: Typography.weight.semibold,
  },
  setCostInput: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    backgroundColor: Colors.surfaceHighlight,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.primary + '60',
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  setCostLabel: {
    fontSize: Typography.size.sm,
    fontWeight: Typography.weight.bold,
    color: Colors.textSecondary,
  },
  setCostField: {
    flex: 1,
    fontSize: Typography.size.sm,
    color: Colors.textPrimary,
    includeFontPadding: false,
    paddingVertical: 4,
  },
  setCostSave: {
    width: 26,
    height: 26,
    borderRadius: Radius.sm,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Sell action block
  sellBlock: {
    gap: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.surfaceBorder,
    paddingTop: Spacing.sm,
  },
  sellActionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    borderRadius: Radius.md,
    padding: Spacing.md,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  sellActionLabel: {
    fontSize: Typography.size.sm,
    fontWeight: Typography.weight.bold,
    letterSpacing: 0.3,
  },
  sellActionReason: {
    fontSize: Typography.size.xs,
    color: Colors.textTertiary,
    lineHeight: 16,
  },

  // Niche context
  nicheBlock: {
    backgroundColor: Colors.accentDim,
    borderRadius: Radius.md,
    padding: Spacing.md,
    gap: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.accent + '25',
  },
  nicheRow: {
    gap: 2,
    borderTopWidth: 1,
    borderTopColor: Colors.accent + '20',
    paddingTop: Spacing.xs,
  },
  nicheKey: {
    fontSize: 9,
    fontWeight: Typography.weight.bold,
    color: Colors.accent,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  nicheVal: {
    fontSize: Typography.size.xs,
    color: Colors.textSecondary,
    lineHeight: 16,
  },

  // Verified outcome
  outcomeBlock: {
    backgroundColor: Colors.successDim,
    borderRadius: Radius.md,
    padding: Spacing.md,
    gap: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.success + '30',
  },
  outcomeNote: {
    fontSize: 10,
    color: Colors.success + 'BB',
    lineHeight: 14,
    fontStyle: 'italic',
  },

  footer: {
    fontSize: 9,
    color: Colors.textTertiary + '80',
    textAlign: 'center',
    paddingTop: Spacing.xs,
  },
});
