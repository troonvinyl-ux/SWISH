// NicheValuationPanel — Shared valuation agent for all 4 niches
// Calls swish-market-value with the correct specialistId and displays
// niche-specific evidence labels (eBay sold comps for bikes/MX/clothing,
// Numista + eBay for coins).

import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator, ScrollView } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors, Typography, Spacing, Radius } from '@/constants/theme';
import { getMarketValue, MarketValueResult } from '@/services/marketValueService';

// ── Niche config ──────────────────────────────────────────────────────────────

export interface NicheValuationConfig {
  specialistId: string;
  accent: string;
  accentDim: string;
  evidenceLabel: string;    // e.g. "MTB & road eBay sold comps"
  evidenceIcon: string;     // MaterialIcons name
  showNumista: boolean;
  currencySymbol?: string;
}

const NICHE_CONFIGS: Record<string, NicheValuationConfig> = {
  bicycles: {
    specialistId: 'bicycles',
    accent: '#6ED020',
    accentDim: '#0A2000',
    evidenceLabel: 'MTB & road bike eBay sold comps',
    evidenceIcon: 'pedal-bike',
    showNumista: false,
  },
  cycling: {
    specialistId: 'bicycles',
    accent: '#6ED020',
    accentDim: '#0A2000',
    evidenceLabel: 'Cycling eBay sold comps',
    evidenceIcon: 'pedal-bike',
    showNumista: false,
  },
  motocross: {
    specialistId: 'motocross',
    accent: '#FF5500',
    accentDim: '#2A0A00',
    evidenceLabel: 'Motocross / off-road eBay sold comps',
    evidenceIcon: 'two-wheeler',
    showNumista: false,
  },
  clothing: {
    specialistId: 'clothing',
    accent: '#E91E8C',
    accentDim: '#250014',
    evidenceLabel: 'Vintage & streetwear eBay sold comps',
    evidenceIcon: 'checkroom',
    showNumista: false,
  },
  trainers_sneakers: {
    specialistId: 'clothing',
    accent: '#E91E8C',
    accentDim: '#250014',
    evidenceLabel: 'Trainers & sneakers eBay sold comps',
    evidenceIcon: 'checkroom',
    showNumista: false,
  },
  coins: {
    specialistId: 'coins',
    accent: '#F5C842',
    accentDim: '#2A2000',
    evidenceLabel: 'Numista sales + eBay coin comps',
    evidenceIcon: 'toll',
    showNumista: true,
  },
  coins_uk: {
    specialistId: 'coins',
    accent: '#F5C842',
    accentDim: '#2A2000',
    evidenceLabel: 'Numista sales + eBay coin comps',
    evidenceIcon: 'toll',
    showNumista: true,
  },
  gold: {
    specialistId: 'gold',
    accent: '#FFD700',
    accentDim: '#2A2000',
    evidenceLabel: 'Gold bullion eBay sold comps',
    evidenceIcon: 'toll',
    showNumista: false,
  },
  silver: {
    specialistId: 'silver',
    accent: '#C0C0C0',
    accentDim: '#1A1A1A',
    evidenceLabel: 'Silver coin eBay sold comps',
    evidenceIcon: 'toll',
    showNumista: false,
  },
  banknotes: {
    specialistId: 'banknotes',
    accent: '#4CAF50',
    accentDim: '#0A1A0A',
    evidenceLabel: 'Banknote eBay sold comps',
    evidenceIcon: 'payments',
    showNumista: false,
  },
};

function getNicheConfig(specialistId: string): NicheValuationConfig {
  return NICHE_CONFIGS[specialistId] ?? {
    specialistId,
    accent: Colors.primary,
    accentDim: Colors.primaryDim,
    evidenceLabel: 'eBay sold comparables',
    evidenceIcon: 'bar-chart',
    showNumista: false,
  };
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface NicheValuationPanelProps {
  tenantId: string;
  itemId?: string;
  title: string;
  specialistId: string;
  attributes?: Record<string, any>;
  condition?: string;
  identificationConfidence?: number;
  identificationTier?: string;
  // Coin-only
  numistaTypeId?: number | null;
  numistaMatchScore?: number;
  numistaMatchTier?: string;
  // Auto-apply to item DB record
  applyToItem?: boolean;
  // Optional: pre-loaded result
  initialResult?: MarketValueResult | null;
  // Optional override accent
  accentOverride?: string;
}

// ── Main Panel ────────────────────────────────────────────────────────────────

export default function NicheValuationPanel({
  tenantId,
  itemId,
  title,
  specialistId,
  attributes,
  condition,
  identificationConfidence = 0.5,
  identificationTier = 'medium',
  numistaTypeId,
  numistaMatchScore = 0,
  numistaMatchTier = 'no_match',
  applyToItem = false,
  initialResult = null,
  accentOverride,
}: NicheValuationPanelProps) {
  const config = getNicheConfig(specialistId);
  const accent = accentOverride ?? config.accent;
  const accentDim = config.accentDim;

  const [result, setResult] = useState<MarketValueResult | null>(initialResult);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);

  const handleFetch = useCallback(async () => {
    if (!title || title.length < 3) {
      setError('A title is required to search for comparable sales.');
      return;
    }
    setLoading(true);
    setError(null);

    const { result: r, error: e } = await getMarketValue({
      tenantId,
      itemId,
      title,
      specialistId: config.specialistId,
      attributes: attributes ?? {},
      condition: condition ?? '',
      identificationConfidence,
      identificationTier,
      numistaTypeId: config.showNumista ? numistaTypeId : null,
      numistaMatchScore: config.showNumista ? numistaMatchScore : 0,
      numistaMatchTier: config.showNumista ? numistaMatchTier : 'unavailable',
      applyToItem,
    });

    setLoading(false);
    if (e || !r) {
      setError(e ?? 'Valuation unavailable — try again');
    } else {
      setResult(r);
      if (applyToItem) setApplied(true);
    }
  }, [tenantId, itemId, title, config.specialistId, attributes, condition, identificationConfidence, identificationTier, numistaTypeId, numistaMatchScore, numistaMatchTier, applyToItem]);

  const v = result?.valuation;
  const sold = result?.soldMarket;
  const asking = result?.activeAskingPrices;

  // ── No result yet ─────────────────────────────────────────────────────────
  if (!result && !loading) {
    return (
      <View style={[s.card, { borderColor: accent + '30' }]}>
        <View style={s.cardHeader}>
          <View style={[s.headerIcon, { backgroundColor: accentDim }]}>
            <MaterialIcons name={config.evidenceIcon as any} size={16} color={accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[s.headerTitle, { color: accent }]}>Market Value</Text>
            <Text style={s.headerSub}>{config.evidenceLabel}</Text>
          </View>
        </View>
        {error ? (
          <View style={s.errorRow}>
            <MaterialIcons name="warning" size={12} color={Colors.warning} />
            <Text style={s.errorText}>{error}</Text>
          </View>
        ) : null}
        <Pressable
          onPress={handleFetch}
          style={({ pressed }) => [s.fetchBtn, { backgroundColor: accent }, pressed && { opacity: 0.85 }]}
        >
          <MaterialIcons name="travel-explore" size={16} color="#000" />
          <Text style={s.fetchBtnText}>Get Market Value</Text>
        </Pressable>
      </View>
    );
  }

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={[s.card, { borderColor: accent + '30' }]}>
        <View style={s.loadingRow}>
          <ActivityIndicator size="small" color={accent} />
          <Text style={[s.loadingText, { color: accent }]}>Searching {config.evidenceLabel}…</Text>
        </View>
      </View>
    );
  }

  // ── Result ────────────────────────────────────────────────────────────────
  const hasValue = v && (v.valuationMid ?? 0) > 0;

  return (
    <View style={[s.card, { borderColor: accent + '30' }]}>
      {/* Header */}
      <View style={s.cardHeader}>
        <View style={[s.headerIcon, { backgroundColor: accentDim }]}>
          <MaterialIcons name={config.evidenceIcon as any} size={16} color={accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[s.headerTitle, { color: accent }]}>Market Value</Text>
          <Text style={s.headerSub}>{config.evidenceLabel}</Text>
        </View>
        {applied ? (
          <View style={[s.appliedBadge, { backgroundColor: Colors.successDim }]}>
            <MaterialIcons name="check" size={10} color={Colors.success} />
            <Text style={s.appliedText}>Applied</Text>
          </View>
        ) : null}
        <Pressable onPress={handleFetch} hitSlop={8} style={s.refreshBtn}>
          <MaterialIcons name="refresh" size={14} color={Colors.textTertiary} />
        </Pressable>
      </View>

      {/* Price hero */}
      {hasValue ? (
        <View style={[s.priceHero, { backgroundColor: accentDim, borderColor: accent + '25' }]}>
          <Text style={[s.priceRange, { color: accent }]}>
            £{(v.valuationLow ?? 0).toFixed(0)} – £{(v.valuationHigh ?? 0).toFixed(0)}
          </Text>
          <View style={s.priceMidRow}>
            <Text style={s.priceMidLabel}>Mid</Text>
            <Text style={[s.priceMid, { color: accent }]}>£{(v.valuationMid ?? 0).toFixed(2)}</Text>
            <View style={[s.confidencePill, { backgroundColor: accent + '20' }]}>
              <Text style={[s.confidenceText, { color: accent }]}>{v.valuationConfidence?.toUpperCase()}</Text>
            </View>
          </View>
          {v.recommendedListingPrice && v.recommendedListingPrice > 0 ? (
            <View style={s.recommendedRow}>
              <MaterialIcons name="auto-awesome" size={11} color={accent} />
              <Text style={[s.recommendedText, { color: accent }]}>
                List at £{v.recommendedListingPrice.toFixed(2)} · {v.recommendedListingFormat === 'Auction' ? 'Auction' : 'Buy It Now'}
              </Text>
            </View>
          ) : null}
        </View>
      ) : (
        <View style={s.noDataRow}>
          <MaterialIcons name="info-outline" size={13} color={Colors.textTertiary} />
          <Text style={s.noDataText}>Insufficient comparable sales found for this item.</Text>
        </View>
      )}

      {/* Evidence metrics */}
      {sold && sold.relevantSoldCount > 0 ? (
        <View style={s.metricsRow}>
          <View style={s.metric}>
            <Text style={s.metricValue}>{sold.relevantSoldCount}</Text>
            <Text style={s.metricLabel}>Sold</Text>
          </View>
          <View style={s.metric}>
            <Text style={s.metricValue}>£{(sold.medianPrice ?? 0).toFixed(0)}</Text>
            <Text style={s.metricLabel}>Median</Text>
          </View>
          {v?.saleProb30d ? (
            <View style={s.metric}>
              <Text style={s.metricValue}>{Math.round((v.saleProb30d ?? 0) * 100)}%</Text>
              <Text style={s.metricLabel}>30d Prob</Text>
            </View>
          ) : null}
          <View style={s.metric}>
            <Text style={s.metricValue}>{sold.dataQuality}</Text>
            <Text style={s.metricLabel}>Data</Text>
          </View>
        </View>
      ) : null}

      {/* Numista evidence (coins only) */}
      {config.showNumista && result?.numistaSales?.available && (result.numistaSales.relevantCount ?? 0) > 0 ? (
        <View style={[s.numistaRow, { backgroundColor: Colors.successDim, borderColor: Colors.success + '30' }]}>
          <MaterialIcons name="verified" size={12} color={Colors.success} />
          <Text style={s.numistaText}>
            {result.numistaSales.relevantCount} Numista sales · median £{(result.numistaSales.median ?? 0).toFixed(2)}
          </Text>
          <Text style={s.numistaRef}>{result.numistaSales.numistaN}</Text>
        </View>
      ) : null}

      {/* Asking prices note */}
      {asking && asking.count > 0 && asking.medianAskingPrice > 0 ? (
        <View style={s.askingRow}>
          <MaterialIcons name="info-outline" size={10} color={Colors.warning} />
          <Text style={s.askingText}>
            {asking.relevantCount} active listings at £{asking.lowAskingPrice.toFixed(0)}–£{asking.highAskingPrice.toFixed(0)} (asking, not sold)
          </Text>
        </View>
      ) : null}

      {/* Rationale */}
      {v?.listingPriceRationale ? (
        <Text style={s.rationaleText} numberOfLines={3}>{v.listingPriceRationale}</Text>
      ) : null}

      {/* Error retry */}
      {error ? (
        <View style={s.errorRow}>
          <MaterialIcons name="warning" size={12} color={Colors.warning} />
          <Text style={s.errorText}>{error}</Text>
          <Pressable onPress={handleFetch} hitSlop={6}>
            <Text style={[s.errorText, { color: Colors.primary, textDecorationLine: 'underline' }]}>Retry</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.xl,
    borderWidth: 1,
    padding: Spacing.base,
    gap: Spacing.sm,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  headerIcon: { width: 36, height: 36, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  headerTitle: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold },
  headerSub: { fontSize: Typography.size.xs, color: Colors.textTertiary, marginTop: 1 },
  appliedBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: Radius.pill, paddingHorizontal: 6, paddingVertical: 2 },
  appliedText: { fontSize: 9, color: Colors.success, fontWeight: Typography.weight.semibold },
  refreshBtn: { width: 28, height: 28, borderRadius: Radius.sm, backgroundColor: Colors.surfaceHighlight, alignItems: 'center', justifyContent: 'center' },

  fetchBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, borderRadius: Radius.md, paddingVertical: Spacing.md },
  fetchBtnText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: '#000' },

  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.md },
  loadingText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.medium },

  priceHero: { borderRadius: Radius.lg, padding: Spacing.base, gap: Spacing.xs, borderWidth: 1 },
  priceRange: { fontSize: Typography.size.xxl, fontWeight: Typography.weight.extrabold, textAlign: 'center' },
  priceMidRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm },
  priceMidLabel: { fontSize: Typography.size.xs, color: Colors.textTertiary },
  priceMid: { fontSize: Typography.size.lg, fontWeight: Typography.weight.bold },
  confidencePill: { borderRadius: Radius.pill, paddingHorizontal: 6, paddingVertical: 2 },
  confidenceText: { fontSize: 9, fontWeight: Typography.weight.extrabold, letterSpacing: 0.3 },
  recommendedRow: { flexDirection: 'row', alignItems: 'center', gap: 4, justifyContent: 'center' },
  recommendedText: { fontSize: Typography.size.xs, fontWeight: Typography.weight.semibold },

  noDataRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm },
  noDataText: { flex: 1, fontSize: Typography.size.xs, color: Colors.textTertiary, lineHeight: 16 },

  metricsRow: { flexDirection: 'row', justifyContent: 'space-around', backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.md, paddingVertical: Spacing.sm },
  metric: { alignItems: 'center', gap: 2 },
  metricValue: { fontSize: Typography.size.base, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  metricLabel: { fontSize: 9, color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.3 },

  numistaRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, borderRadius: Radius.sm, paddingHorizontal: Spacing.sm, paddingVertical: 6, borderWidth: 1 },
  numistaText: { flex: 1, fontSize: Typography.size.xs, color: Colors.success },
  numistaRef: { fontSize: 9, color: Colors.success, fontWeight: Typography.weight.semibold },

  askingRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 4 },
  askingText: { flex: 1, fontSize: 10, color: Colors.warning, lineHeight: 14 },

  rationaleText: { fontSize: Typography.size.xs, color: Colors.textTertiary, lineHeight: 16, fontStyle: 'italic' },

  errorRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  errorText: { flex: 1, fontSize: Typography.size.xs, color: Colors.warning, lineHeight: 15 },
});
