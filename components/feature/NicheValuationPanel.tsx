// NicheValuationPanel — Shared valuation agent for all 4 niches
// v5: Image-driven Gemini vision + eBay visual search + 418 retry backoff

import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, Pressable, ActivityIndicator,
  Linking,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors, Typography, Spacing, Radius, Shadow } from '@/constants/theme';
import { getMarketValue, MarketValueResult } from '@/services/marketValueService';
import {
  applyValuationGuardrails,
  getEvidenceSummaryLabel,
  type ValuationGuardrailResult,
} from '@/services/valuationGuardrailService';

// ── Niche config ──────────────────────────────────────────────────────────────

export interface NicheValuationConfig {
  specialistId: string;
  accent: string;
  accentDim: string;
  evidenceLabel: string;
  evidenceIcon: string;
  showNumista: boolean;
  searchHint?: string;
}

const NICHE_CONFIGS: Record<string, NicheValuationConfig> = {
  bicycles: {
    specialistId: 'bicycles',
    accent: '#6ED020',
    accentDim: '#0A2000',
    evidenceLabel: 'MTB & road bike eBay sold comps',
    evidenceIcon: 'pedal-bike',
    showNumista: false,
    searchHint: 'Gemini vision + eBay: brand + model + year, frame type, broad fallback',
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
    searchHint: 'Gemini vision + eBay: make + model + year + cc, broad fallback',
  },
  clothing: {
    specialistId: 'clothing',
    accent: '#E91E8C',
    accentDim: '#250014',
    evidenceLabel: 'Vintage & streetwear eBay sold comps',
    evidenceIcon: 'checkroom',
    showNumista: false,
    searchHint: 'Gemini vision + eBay: brand + garment + era, vintage broad fallback',
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
  gold: { specialistId: 'gold', accent: '#FFD700', accentDim: '#2A2000', evidenceLabel: 'Gold bullion eBay sold comps', evidenceIcon: 'toll', showNumista: false },
  silver: { specialistId: 'silver', accent: '#C0C0C0', accentDim: '#1A1A1A', evidenceLabel: 'Silver coin eBay sold comps', evidenceIcon: 'toll', showNumista: false },
  banknotes: { specialistId: 'banknotes', accent: '#4CAF50', accentDim: '#0A1A0A', evidenceLabel: 'Banknote eBay sold comps', evidenceIcon: 'payments', showNumista: false },
  ancient_artefacts: { specialistId: 'ancient_artefacts', accent: '#B8860B', accentDim: '#1A1200', evidenceLabel: 'Ancient artefacts eBay sold comps', evidenceIcon: 'history', showNumista: false },
  islamic_silver: { specialistId: 'islamic_silver', accent: '#B8860B', accentDim: '#1A1200', evidenceLabel: 'Islamic silver coin eBay sold comps', evidenceIcon: 'toll', showNumista: false },
  curiosities_collectibles: { specialistId: 'curiosities_collectibles', accent: Colors.primary, accentDim: Colors.primaryDim, evidenceLabel: 'Collectibles eBay sold comps', evidenceIcon: 'bar-chart', showNumista: false },
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

function isMXNiche(sid: string) { return sid === 'motocross'; }

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
  numistaTypeId?: number | null;
  numistaMatchScore?: number;
  numistaMatchTier?: string;
  applyToItem?: boolean;
  initialResult?: MarketValueResult | null;
  accentOverride?: string;
  autoFetch?: boolean;
  /** Stored item image URLs — passed to Gemini vision & eBay visual search */
  imageUrls?: string[];
}

// ── Stat Row ──────────────────────────────────────────────────────────────────
function StatRow({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <View style={sr.row}>
      <Text style={sr.label}>{label}</Text>
      <Text style={[sr.value, accent ? { color: accent } : undefined]}>{value}</Text>
    </View>
  );
}
const sr = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3, borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder + '60' },
  label: { fontSize: Typography.size.xs, color: Colors.textTertiary },
  value: { fontSize: Typography.size.xs, fontWeight: Typography.weight.semibold, color: Colors.textPrimary },
});

// ── Comparable Row ────────────────────────────────────────────────────────────
function ComparableRow({ title, price, listingType, date, url }: { title: string; price: number; listingType: string; date?: string; url?: string }) {
  const dateStr = date ? new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' }) : '';
  return (
    <Pressable
      onPress={() => url ? Linking.openURL(url) : undefined}
      style={({ pressed }) => [cr.row, pressed && url && { opacity: 0.75 }]}
      disabled={!url}
    >
      <View style={cr.info}>
        <Text style={cr.title} numberOfLines={2}>{title}</Text>
        {dateStr ? <Text style={cr.date}>{dateStr} · {listingType === 'Auction' ? 'Auction' : 'BIN'}</Text> : null}
      </View>
      <Text style={cr.price}>£{price.toFixed(2)}</Text>
      {url ? <MaterialIcons name="open-in-new" size={11} color={Colors.textTertiary} style={{ flexShrink: 0 }} /> : null}
    </Pressable>
  );
}
const cr = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder + '50' },
  info: { flex: 1, gap: 2 },
  title: { fontSize: Typography.size.xs, color: Colors.textPrimary, lineHeight: 16 },
  date: { fontSize: 9, color: Colors.textTertiary },
  price: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.textPrimary, minWidth: 52, textAlign: 'right' },
});

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
  autoFetch = false,
  imageUrls,
}: NicheValuationPanelProps) {
  const config = getNicheConfig(specialistId);
  const accent = accentOverride ?? config.accent;
  const accentDim = config.accentDim;

  const [result, setResult] = useState<MarketValueResult | null>(initialResult);
  const [guardrailResult, setGuardrailResult] = useState<ValuationGuardrailResult | null>(
    initialResult ? applyValuationGuardrails(initialResult, { identificationConfidence, specialistId: config.specialistId }) : null
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [comparablesExpanded, setComparablesExpanded] = useState(false);
  const [queriesExpanded, setQueriesExpanded] = useState(false);
  const [provenanceExpanded, setProvenanceExpanded] = useState(false);

  // v5: Gemini vision market research (from result)
  const geminiData = (result as any)?.geminiMarketResearch;
  const hasGeminiEstimate = geminiData?.available === true && (geminiData?.estimatedRange?.mid ?? 0) > 0;

  const handleFetch = useCallback(async () => {
    if (!title || title.length < 3) { setError('A title is required.'); return; }
    setLoading(true); setError(null);

    const { result: r, error: e } = await getMarketValue({
      tenantId, itemId, title,
      specialistId: config.specialistId,
      attributes: attributes ?? {},
      condition: condition ?? '',
      identificationConfidence, identificationTier,
      numistaTypeId: config.showNumista ? numistaTypeId : null,
      numistaMatchScore: config.showNumista ? numistaMatchScore : 0,
      numistaMatchTier: config.showNumista ? numistaMatchTier : 'unavailable',
      applyToItem,
      imageUrls,
    });

    setLoading(false);
    if (e || !r) {
      setError(e ?? 'Valuation unavailable — try again');
    } else {
      setResult(r);
      const guarded = applyValuationGuardrails(r, { identificationConfidence, specialistId: config.specialistId });
      setGuardrailResult(guarded);
      if (applyToItem) setApplied(true);
      setExpanded(true);
    }
  }, [tenantId, itemId, title, config.specialistId, attributes, condition, identificationConfidence, identificationTier, numistaTypeId, numistaMatchScore, numistaMatchTier, applyToItem, imageUrls]);

  useEffect(() => {
    if (autoFetch && !initialResult && !result) handleFetch();
  }, [autoFetch]);

  useEffect(() => {
    if (initialResult && initialResult !== result) {
      setResult(initialResult);
      const guarded = applyValuationGuardrails(initialResult, { identificationConfidence, specialistId: config.specialistId });
      setGuardrailResult(guarded);
      setExpanded(true);
      if (applyToItem) setApplied(true);
    }
  }, [initialResult]);

  const v = guardrailResult?.guardedValuation ?? result?.valuation;
  const sold = result?.soldMarket;
  const asking = result?.activeAskingPrices;
  const isMX = isMXNiche(specialistId);
  const hasValue = v && (v.valuationMid ?? 0) > 0;
  const guardrailDecision = guardrailResult?.decision;
  const isDowngraded = guardrailDecision === 'downgraded' || guardrailDecision === 'identification_conflict';
  const confColor = !v ? Colors.textTertiary :
    v.valuationConfidence === 'high' ? Colors.success :
    v.valuationConfidence === 'medium' ? Colors.warning :
    v.valuationConfidence === 'low' ? Colors.warning :
    Colors.danger;

  // ── No result ─────────────────────────────────────────────────────────────
  if (!result && !loading) {
    return (
      <View style={[s.card, { borderColor: accent + '30' }]}>
        <View style={s.cardHeader}>
          <View style={[s.headerIcon, { backgroundColor: accentDim }]}>
            <MaterialIcons name={config.evidenceIcon as any} size={16} color={accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[s.headerTitle, { color: accent }]}>Live Market Value</Text>
            <Text style={s.headerSub}>{config.evidenceLabel}</Text>
          </View>
        </View>
        {config.searchHint ? (
          <View style={s.hintRow}>
            <MaterialIcons name="auto-awesome" size={11} color={Colors.accent} />
            <Text style={s.hintText}>{config.searchHint}</Text>
          </View>
        ) : null}
        {error ? (
          <View style={s.errorBanner}>
            <MaterialIcons name="warning" size={12} color={Colors.warning} />
            <Text style={s.errorText}>{error}</Text>
          </View>
        ) : null}
        <Pressable
          onPress={handleFetch}
          style={({ pressed }) => [s.fetchBtn, { backgroundColor: accent }, pressed && { opacity: 0.85 }]}
        >
          <MaterialIcons name="travel-explore" size={16} color="#000" />
          <Text style={s.fetchBtnText}>Get Live Market Value</Text>
        </Pressable>
      </View>
    );
  }

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={[s.card, { borderColor: accent + '30' }]}>
        <View style={s.cardHeader}>
          <View style={[s.headerIcon, { backgroundColor: accentDim }]}>
            <MaterialIcons name={config.evidenceIcon as any} size={16} color={accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[s.headerTitle, { color: accent }]}>Searching market data…</Text>
            <Text style={s.headerSub}>{config.evidenceLabel}</Text>
          </View>
        </View>
        <View style={s.loadingRow}>
          <ActivityIndicator size="small" color={accent} />
          <View style={{ flex: 1 }}>
            <Text style={[s.loadingText, { color: accent }]}>
              Analysing images with Gemini Vision + eBay sold listings…
            </Text>
            <Text style={s.loadingSub}>Image-first search: AI identifies item, then searches eBay for comparable sold prices</Text>
          </View>
        </View>
      </View>
    );
  }

  // ── Result — no value found ───────────────────────────────────────────────
  if (!hasValue && result) {
    const warnings = v?.valuationWarnings ?? [];
    const searchQueriesUsed = (result as any).searchQueriesUsed ?? [(result as any).searchQuery].filter(Boolean);
    const foundTotal = result.dataSource?.findingApiTotal ?? 0;
    const foundRelevant = sold?.relevantSoldCount ?? 0;
    const rateLimited = (result.dataSource as any)?.apiConnectionStatus?.rateLimited === true;

    return (
      <View style={[s.card, { borderColor: accent + '30' }]}>
        <View style={s.cardHeader}>
          <View style={[s.headerIcon, { backgroundColor: accentDim }]}>
            <MaterialIcons name={config.evidenceIcon as any} size={16} color={accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[s.headerTitle, { color: accent }]}>Live Market Value</Text>
            <Text style={s.headerSub}>{config.evidenceLabel}</Text>
          </View>
          <Pressable onPress={handleFetch} hitSlop={8} style={s.refreshBtn}>
            <MaterialIcons name="refresh" size={14} color={Colors.textTertiary} />
            <Text style={s.refreshBtnText}>Retry</Text>
          </Pressable>
        </View>

        <View style={s.noResultCard}>
          <MaterialIcons name={rateLimited ? 'schedule' : 'search-off'} size={24} color={rateLimited ? Colors.warning : Colors.textTertiary} />
          <Text style={s.noResultTitle}>
            {rateLimited ? 'eBay Temporarily Rate-Limited' : 'No comparable sales found'}
          </Text>
          <Text style={s.noResultSub}>
            {rateLimited
              ? 'eBay search rate-limited (HTTP 418). Please wait 30-60 seconds then tap Try Again.'
              : foundTotal > 0
                ? `Found ${foundTotal} eBay sold listings but ${foundRelevant === 0 ? 'none were relevant' : `only ${foundRelevant} relevant`} after scoring.`
                : 'No eBay sold listings found. Try Re-ID for a better title, then Re-Value again.'}
          </Text>
        </View>

        {warnings.length > 0 ? (
          <View style={s.warningsList}>
            {warnings.slice(0, 3).map((w, i) => (
              <View key={i} style={s.warningRow}>
                <MaterialIcons name="info-outline" size={11} color={Colors.warning} />
                <Text style={s.warningText}>{w}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {searchQueriesUsed.length > 0 ? (
          <Pressable onPress={() => setQueriesExpanded(q => !q)} style={s.queriesToggle}>
            <MaterialIcons name="manage-search" size={12} color={Colors.textTertiary} />
            <Text style={s.queriesToggleText}>Queries used ({searchQueriesUsed.length})</Text>
            <MaterialIcons name={queriesExpanded ? 'expand-less' : 'expand-more'} size={14} color={Colors.textTertiary} />
          </Pressable>
        ) : null}
        {queriesExpanded && searchQueriesUsed.length > 0 ? (
          <View style={s.queriesList}>
            {searchQueriesUsed.map((q: string, i: number) => (
              <View key={i} style={s.queryRow}>
                <Text style={s.queryNum}>{i + 1}.</Text>
                <Text style={s.queryText} numberOfLines={1}>&quot;{q}&quot;</Text>
              </View>
            ))}
            <Text style={s.queryTip}>{rateLimited ? 'Wait 30-60 seconds then tap Try Again.' : 'Tip: Re-ID the item for better attributes, then Re-Value.'}</Text>
          </View>
        ) : null}

        <View style={s.noResultActions}>
          <Pressable onPress={handleFetch} style={[s.fetchBtn, { backgroundColor: accent, flex: 1 }]}>
            <MaterialIcons name="refresh" size={14} color="#000" />
            <Text style={s.fetchBtnText}>Try Again</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // ── Result — value found ──────────────────────────────────────────────────
  const searchQueriesUsed = (result as any)?.searchQueriesUsed ?? [(result as any)?.searchQuery].filter(Boolean);
  const mxRunningRationale = isMX && v?.listingPriceRationale?.includes('Running status') ? v.listingPriceRationale : null;
  const topComparables: Array<{ title: string; price: number; date: string; listingType: string; url?: string }> = (result as any)?.auditTrail?.topComparables ?? [];
  const valuationMethod = (result as any)?.valuation?.valuationMethod ?? '';
  const isAIEstimate = valuationMethod.includes('gemini') || valuationMethod.includes('ai_');

  return (
    <View style={[s.card, { borderColor: accent + '30' }]}>
      {/* Header */}
      <Pressable onPress={() => setExpanded(e => !e)} style={s.cardHeader}>
        <View style={[s.headerIcon, { backgroundColor: accentDim }]}>
          <MaterialIcons name={config.evidenceIcon as any} size={16} color={accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[s.headerTitle, { color: accent }]}>Live Market Value</Text>
          <Text style={s.headerSub}>
            {isAIEstimate ? 'AI estimate — no eBay sold data found' : config.evidenceLabel}
          </Text>
        </View>
        <View style={s.headerRight}>
          {applied ? (
            <View style={s.appliedBadge}>
              <MaterialIcons name="check" size={10} color={Colors.success} />
              <Text style={s.appliedText}>Applied</Text>
            </View>
          ) : null}
          <Pressable onPress={handleFetch} hitSlop={8} style={s.refreshBtn}>
            <MaterialIcons name="refresh" size={13} color={Colors.textTertiary} />
          </Pressable>
          <MaterialIcons name={expanded ? 'keyboard-arrow-up' : 'keyboard-arrow-down'} size={18} color={Colors.textTertiary} />
        </View>
      </Pressable>

      {/* AI estimate warning banner */}
      {isAIEstimate ? (
        <View style={s.aiEstimateBanner}>
          <MaterialIcons name="auto-awesome" size={12} color={Colors.accent} />
          <Text style={s.aiEstimateBannerText}>
            AI market estimate (Gemini Vision) — not verified eBay sold data. Try Re-Value in 30s for eBay prices.
          </Text>
        </View>
      ) : null}

      {/* Price hero */}
      {hasValue ? (
        <View style={[s.priceHero, { backgroundColor: accentDim, borderColor: accent + '25' }]}>
          <View style={s.priceRow}>
            <View style={s.priceBlock}>
              <Text style={s.priceTinyLabel}>LOW</Text>
              <Text style={s.priceSmall}>£{(v!.valuationLow ?? 0).toFixed(0)}</Text>
            </View>
            <View style={[s.priceBlock, s.priceMidBlock]}>
              <Text style={s.priceTinyLabel}>{isAIEstimate ? 'AI ESTIMATE' : 'FAIR MARKET VALUE'}</Text>
              <Text style={[s.priceBig, { color: accent }]}>£{(v!.valuationMid ?? 0).toFixed(2)}</Text>
              <View style={[s.confidencePill, { backgroundColor: confColor + '20', borderColor: confColor + '40' }]}>
                <Text style={[s.confidenceText, { color: confColor }]}>{(v!.valuationConfidence ?? 'unknown').replace(/_/g, ' ').toUpperCase()}</Text>
              </View>
            </View>
            <View style={s.priceBlock}>
              <Text style={s.priceTinyLabel}>HIGH</Text>
              <Text style={s.priceSmall}>£{(v!.valuationHigh ?? 0).toFixed(0)}</Text>
            </View>
          </View>

          {v!.recommendedListingPrice && v!.recommendedListingPrice > 0 ? (
            <View style={s.recommendRow}>
              <MaterialIcons name={v!.recommendedListingFormat === 'Auction' ? 'gavel' : 'sell'} size={12} color={accent} />
              <Text style={[s.recommendText, { color: accent }]}>
                {isAIEstimate ? 'Indicative: ' : ''}List at £{v!.recommendedListingPrice.toFixed(2)} · {v!.recommendedListingFormat === 'Auction' ? 'Auction' : v!.recommendedListingFormat === 'BuyItNow_WithBestOffer' ? 'BIN + Best Offer' : 'Buy It Now'}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {/* Guardrail banner */}
      {isDowngraded && guardrailResult ? (
        <View style={s.guardrailBanner}>
          <MaterialIcons name="info-outline" size={11} color={Colors.warning} />
          <View style={{ flex: 1 }}>
            <Text style={s.guardrailBannerTitle}>
              {guardrailDecision === 'identification_conflict' ? 'Low ID Confidence — Indicative Only' : 'Evidence Guardrail Applied'}
            </Text>
            <Text style={s.guardrailBannerText}>{getEvidenceSummaryLabel(guardrailResult.evidenceProvenance)}</Text>
          </View>
        </View>
      ) : null}

      {/* Evidence chips */}
      <View style={s.evidenceRow}>
        {sold && sold.relevantSoldCount > 0 ? (
          <View style={s.evidenceChip}>
            <MaterialIcons name="shopping-bag" size={10} color={Colors.primary} />
            <Text style={s.evidenceChipText}>{sold.relevantSoldCount} sold</Text>
          </View>
        ) : null}
        {sold && (sold.medianPrice ?? 0) > 0 ? (
          <View style={s.evidenceChip}>
            <MaterialIcons name="bar-chart" size={10} color={Colors.textTertiary} />
            <Text style={s.evidenceChipText}>Median £{sold.medianPrice.toFixed(0)}</Text>
          </View>
        ) : null}
        {hasGeminiEstimate && (sold?.relevantSoldCount ?? 0) === 0 ? (
          <View style={[s.evidenceChip, { backgroundColor: Colors.accentDim }]}>
            <MaterialIcons name="auto-awesome" size={10} color={Colors.accent} />
            <Text style={[s.evidenceChipText, { color: Colors.accent }]}>AI estimate</Text>
          </View>
        ) : null}
        {config.showNumista && result?.numistaSales?.available && (result.numistaSales.relevantCount ?? 0) > 0 ? (
          <View style={[s.evidenceChip, { backgroundColor: Colors.successDim }]}>
            <MaterialIcons name="verified" size={10} color={Colors.success} />
            <Text style={[s.evidenceChipText, { color: Colors.success }]}>Numista {result.numistaSales.relevantCount}</Text>
          </View>
        ) : null}
        {isMX && mxRunningRationale ? (
          <View style={[s.evidenceChip, { backgroundColor: Colors.warningDim, borderColor: Colors.warning + '30' }]}>
            <MaterialIcons name="two-wheeler" size={10} color={Colors.warning} />
            <Text style={[s.evidenceChipText, { color: Colors.warning }]}>MX multiplier applied</Text>
          </View>
        ) : null}
        {v?.saleProb30d ? (
          <View style={s.evidenceChip}>
            <MaterialIcons name="trending-up" size={10} color={Colors.textTertiary} />
            <Text style={s.evidenceChipText}>{Math.round(v.saleProb30d * 100)}% / 30d</Text>
          </View>
        ) : null}
      </View>

      {/* Expanded detail */}
      {expanded ? (
        <View style={s.expandedContent}>

          {/* MX running status */}
          {isMX && mxRunningRationale ? (
            <View style={s.mxMultiplierCard}>
              <View style={s.mxMultiplierHeader}>
                <MaterialIcons name="two-wheeler" size={13} color={Colors.warning} />
                <Text style={s.mxMultiplierTitle}>RUNNING STATUS MULTIPLIER</Text>
              </View>
              <Text style={s.mxMultiplierText}>
                {mxRunningRationale.includes('Non-running') || mxRunningRationale.includes('Project')
                  ? 'Non-running / project bikes command significantly lower prices.'
                  : mxRunningRationale.includes('Unknown')
                  ? 'Running status unknown. Applied conservative 70% multiplier.'
                  : 'Running bike multiplier applied — using full comparable prices.'}
              </Text>
            </View>
          ) : null}

          {/* Gemini AI market estimate — shown when no/weak eBay sold data */}
          {hasGeminiEstimate ? (
            <View style={s.geminiCard}>
              <View style={s.geminiHeader}>
                <MaterialIcons name="auto-awesome" size={11} color={Colors.accent} />
                <Text style={s.geminiTitle}>AI MARKET ESTIMATE</Text>
                <View style={s.geminiNotSoldBadge}>
                  <Text style={s.geminiNotSoldText}>NOT SOLD DATA</Text>
                </View>
              </View>
              <Text style={s.geminiNote}>
                Gemini Vision analysed item images to estimate market value. This is AI inference — not verified eBay sold prices.
                {(sold?.relevantSoldCount ?? 0) === 0 ? ' No eBay sold comps were found — try Re-Value again in 30-60 seconds.' : ''}
              </Text>
              {geminiData.itemDescription ? (
                <Text style={s.geminiDesc} numberOfLines={3}>{geminiData.itemDescription}</Text>
              ) : null}
              {geminiData.marketContext ? (
                <Text style={s.geminiContext} numberOfLines={3}>{geminiData.marketContext}</Text>
              ) : null}
              <View style={s.geminiRangeRow}>
                <View style={s.geminiRangeItem}>
                  <Text style={s.geminiRangeLabel}>Low</Text>
                  <Text style={s.geminiRangeValue}>£{geminiData.estimatedRange.low}</Text>
                </View>
                <View style={[s.geminiRangeItem, { backgroundColor: Colors.accentDim, borderRadius: Radius.sm }]}>
                  <Text style={s.geminiRangeLabel}>Mid</Text>
                  <Text style={[s.geminiRangeValue, { color: Colors.accent, fontSize: Typography.size.base }]}>£{geminiData.estimatedRange.mid}</Text>
                </View>
                <View style={s.geminiRangeItem}>
                  <Text style={s.geminiRangeLabel}>High</Text>
                  <Text style={s.geminiRangeValue}>£{geminiData.estimatedRange.high}</Text>
                </View>
              </View>
              <View style={s.geminiFooter}>
                <MaterialIcons name="info-outline" size={9} color={Colors.textTertiary} />
                <Text style={s.geminiFooterText}>
                  AI confidence: {geminiData.confidence} · eBay sold found: {sold?.verifiedSoldCount ?? 0} · Relevant: {sold?.relevantSoldCount ?? 0}
                </Text>
              </View>
            </View>
          ) : null}

          {/* Sold stats */}
          {sold && sold.relevantSoldCount > 0 ? (
            <View style={s.statsSection}>
              <Text style={s.sectionLabel}>VERIFIED SOLD DATA (EBAY UK)</Text>
              <View style={s.statsGrid}>
                <StatRow label="eBay sold found" value={String(sold.verifiedSoldCount ?? 0)} />
                <StatRow label="Relevant after scoring" value={String(sold.relevantSoldCount)} accent={sold.relevantSoldCount >= 5 ? Colors.success : Colors.warning} />
                <StatRow label="Median sold price" value={`£${sold.medianPrice.toFixed(2)}`} accent={accent} />
                <StatRow label="Price range" value={`£${sold.lowPrice.toFixed(0)} – £${sold.highPrice.toFixed(0)}`} />
                {sold.auctionShare > 0 ? <StatRow label="Auction share" value={`${sold.auctionShare}%`} /> : null}
                {sold.dateRange && sold.dateRange !== 'unknown' ? <StatRow label="Date range" value={sold.dateRange} /> : null}
                {sold.dataQuality ? <StatRow label="Data quality" value={sold.dataQuality} accent={sold.dataQuality === 'strong' ? Colors.success : sold.dataQuality === 'moderate' ? Colors.warning : Colors.danger} /> : null}
              </View>
            </View>
          ) : null}

          {/* Asking prices */}
          {asking && asking.count > 0 && asking.medianAskingPrice > 0 ? (
            <View style={s.askingCard}>
              <MaterialIcons name="info-outline" size={11} color={Colors.warning} />
              <Text style={s.askingText}>
                {asking.count} active listings asking £{asking.lowAskingPrice.toFixed(0)}–£{asking.highAskingPrice.toFixed(0)} (median £{asking.medianAskingPrice.toFixed(0)}) — <Text style={{ fontStyle: 'italic' }}>NOT used in valuation (asking ≠ sold)</Text>
              </Text>
            </View>
          ) : null}

          {/* Numista */}
          {config.showNumista && result?.numistaSales ? (
            <View style={s.statsSection}>
              <Text style={s.sectionLabel}>NUMISTA CATALOGUE</Text>
              {result.numistaSales.available && result.numistaSales.relevantCount > 0 ? (
                <>
                  <View style={s.statsGrid}>
                    <StatRow label="Sales records" value={`${result.numistaSales.relevantCount} relevant`} accent={Colors.success} />
                    <StatRow label="Median (Numista)" value={`£${result.numistaSales.median.toFixed(2)}`} accent={Colors.success} />
                    <StatRow label="Range" value={`£${result.numistaSales.low.toFixed(2)} – £${result.numistaSales.high.toFixed(2)}`} />
                  </View>
                  {result.numistaSales.numistaN ? (
                    <Pressable onPress={() => Linking.openURL(result.numistaSales!.numistaUrl)} style={({ pressed }) => [s.numistaLink, pressed && { opacity: 0.75 }]}>
                      <MaterialIcons name="open-in-new" size={11} color={Colors.info} />
                      <Text style={s.numistaLinkText}>{result.numistaSales.numistaN} · View on Numista</Text>
                    </Pressable>
                  ) : null}
                </>
              ) : (
                <View style={s.noNumistaRow}>
                  <MaterialIcons name="info-outline" size={11} color={Colors.textTertiary} />
                  <Text style={s.noNumistaText}>{result.numistaSales.error ?? 'No Numista sales records available for this type'}</Text>
                </View>
              )}
            </View>
          ) : null}

          {/* Evidence provenance */}
          {guardrailResult ? (
            <>
              <Pressable onPress={() => setProvenanceExpanded(p => !p)} style={s.provenanceToggle}>
                <MaterialIcons name="policy" size={11} color={Colors.textTertiary} />
                <Text style={s.provenanceToggleText}>Evidence provenance</Text>
                <MaterialIcons name={provenanceExpanded ? 'expand-less' : 'expand-more'} size={13} color={Colors.textTertiary} />
              </Pressable>
              {provenanceExpanded ? (
                <View style={s.provenanceCard}>
                  {guardrailResult.evidenceProvenance.sources.map((src, i) => (
                    <View key={i} style={s.provenanceRow}>
                      <View style={[s.provenanceClassDot, {
                        backgroundColor: src.class === 'verified_sold' ? Colors.success : src.class === 'active_asking' ? Colors.warning : src.class === 'reference_data' ? Colors.info : Colors.textTertiary,
                      }]} />
                      <View style={{ flex: 1 }}>
                        <View style={s.provenanceLabelRow}>
                          <Text style={s.provenanceLabel}>{src.label}</Text>
                          <Text style={[s.provenanceClassTag, { color: src.usedInValuation ? Colors.success : Colors.textTertiary }]}>
                            {src.usedInValuation ? 'USED' : 'EXCLUDED'}
                          </Text>
                        </View>
                        <Text style={s.provenanceNote} numberOfLines={3}>{src.note}</Text>
                      </View>
                    </View>
                  ))}
                  {guardrailResult.guardrailReasons.length > 0 ? (
                    <View style={s.guardrailReasonsCard}>
                      <Text style={s.guardrailReasonsTitle}>GUARDRAIL DECISIONS</Text>
                      {guardrailResult.guardrailReasons.map((r, i) => <Text key={i} style={s.guardrailReason}>{r}</Text>)}
                    </View>
                  ) : null}
                </View>
              ) : null}
            </>
          ) : null}

          {/* Warnings */}
          {v?.valuationWarnings && v.valuationWarnings.length > 0 ? (
            <View style={s.warningsList}>
              {v.valuationWarnings.slice(0, 3).map((w, i) => (
                <View key={i} style={s.warningRow}>
                  <MaterialIcons name="warning" size={10} color={Colors.warning} />
                  <Text style={s.warningText}>{w}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {/* Rationale */}
          {v?.listingPriceRationale ? (
            <View style={s.rationaleCard}>
              <Text style={s.sectionLabel}>LISTING RATIONALE</Text>
              <Text style={s.rationaleText}>{v.listingPriceRationale.replace(/\s*\[Running status.*?\]/, '')}</Text>
            </View>
          ) : null}

          {/* Top comparables */}
          {topComparables.length > 0 ? (
            <>
              <Pressable onPress={() => setComparablesExpanded(v => !v)} style={s.comparablesToggle}>
                <MaterialIcons name="receipt-long" size={12} color={Colors.textTertiary} />
                <Text style={s.comparablesToggleText}>Comparable sales ({topComparables.length})</Text>
                <MaterialIcons name={comparablesExpanded ? 'expand-less' : 'expand-more'} size={14} color={Colors.textTertiary} />
              </Pressable>
              {comparablesExpanded ? (
                <View style={s.comparablesList}>
                  {topComparables.slice(0, 8).map((c, i) => (
                    <ComparableRow key={i} title={c.title} price={c.price} listingType={c.listingType} date={c.date} url={(c as any).url} />
                  ))}
                </View>
              ) : null}
            </>
          ) : null}

          {/* Queries */}
          {searchQueriesUsed.length > 0 ? (
            <>
              <Pressable onPress={() => setQueriesExpanded(v => !v)} style={s.queriesToggle}>
                <MaterialIcons name="manage-search" size={11} color={Colors.textTertiary} />
                <Text style={s.queriesToggleText}>Queries used ({searchQueriesUsed.length})</Text>
                <MaterialIcons name={queriesExpanded ? 'expand-less' : 'expand-more'} size={13} color={Colors.textTertiary} />
              </Pressable>
              {queriesExpanded ? (
                <View style={s.queriesList}>
                  {searchQueriesUsed.map((q: string, i: number) => (
                    <View key={i} style={s.queryRow}>
                      <Text style={s.queryNum}>{i + 1}.</Text>
                      <Text style={s.queryText} numberOfLines={2}>&quot;{q}&quot;</Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </>
          ) : null}

          {/* Data source footer */}
          {result?.dataSource ? (
            <View style={s.footerRow}>
              <MaterialIcons name="storage" size={10} color={Colors.textTertiary} />
              <Text style={s.footerText}>
                eBay sold: {result.dataSource.findingApiTotal} · Active: {result.dataSource.browseApiActive}
                {(result.dataSource as any).imageUrlsUsed > 0 ? ` · Images: ${(result.dataSource as any).imageUrlsUsed}` : ''}
                {(result.dataSource as any).geminiVisionUsed ? ' · Gemini Vision: on' : ''}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {/* Error */}
      {error ? (
        <View style={s.errorBanner}>
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
  card: { backgroundColor: Colors.surface, borderRadius: Radius.xl, borderWidth: 1, padding: Spacing.base, gap: Spacing.sm, ...Shadow.sm },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  headerIcon: { width: 36, height: 36, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  headerTitle: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold },
  headerSub: { fontSize: Typography.size.xs, color: Colors.textTertiary, marginTop: 1 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  appliedBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: Colors.successDim, borderRadius: Radius.pill, paddingHorizontal: 6, paddingVertical: 2 },
  appliedText: { fontSize: 9, color: Colors.success, fontWeight: Typography.weight.semibold },
  refreshBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3, width: 28, height: 28, borderRadius: Radius.sm, backgroundColor: Colors.surfaceHighlight },
  refreshBtnText: { fontSize: 10, color: Colors.textTertiary },

  hintRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 4 },
  hintText: { flex: 1, fontSize: 10, color: Colors.textTertiary, lineHeight: 14, fontStyle: 'italic' },

  fetchBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, borderRadius: Radius.md, paddingVertical: Spacing.md },
  fetchBtnText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: '#000' },

  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.xs },
  loadingText: { fontSize: Typography.size.xs, fontWeight: Typography.weight.medium },
  loadingSub: { fontSize: 10, color: Colors.textTertiary, marginTop: 2, lineHeight: 14 },

  // AI estimate banner
  aiEstimateBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: 5, backgroundColor: Colors.accentDim, borderRadius: Radius.sm, padding: Spacing.sm, borderWidth: 1, borderColor: Colors.accent + '40' },
  aiEstimateBannerText: { flex: 1, fontSize: 10, color: Colors.accent + 'CC', lineHeight: 14 },

  priceHero: { borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.sm, borderWidth: 1 },
  priceRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-around' },
  priceBlock: { alignItems: 'center', gap: 3 },
  priceMidBlock: { backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs },
  priceTinyLabel: { fontSize: 8, color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.4 },
  priceBig: { fontSize: Typography.size.xxl, fontWeight: Typography.weight.extrabold, textAlign: 'center' },
  priceSmall: { fontSize: Typography.size.lg, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  confidencePill: { borderRadius: Radius.pill, paddingHorizontal: 7, paddingVertical: 2, borderWidth: 1 },
  confidenceText: { fontSize: 9, fontWeight: Typography.weight.extrabold, letterSpacing: 0.3 },
  recommendRow: { flexDirection: 'row', alignItems: 'center', gap: 5, justifyContent: 'center' },
  recommendText: { fontSize: Typography.size.xs, fontWeight: Typography.weight.semibold },

  evidenceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  evidenceChip: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.pill, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: Colors.surfaceBorder },
  evidenceChipText: { fontSize: 10, color: Colors.textTertiary, fontWeight: Typography.weight.medium },

  expandedContent: { gap: Spacing.md, borderTopWidth: 1, borderTopColor: Colors.surfaceBorder, paddingTop: Spacing.md },

  // MX
  mxMultiplierCard: { backgroundColor: Colors.warningDim, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.xs, borderWidth: 1, borderColor: Colors.warning + '30' },
  mxMultiplierHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  mxMultiplierTitle: { fontSize: 9, fontWeight: Typography.weight.bold, color: Colors.warning, textTransform: 'uppercase', letterSpacing: 0.5 },
  mxMultiplierText: { fontSize: Typography.size.xs, color: Colors.warning, lineHeight: 16 },

  // Gemini AI estimate card
  geminiCard: { backgroundColor: Colors.accentDim + '60', borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.sm, borderWidth: 1, borderColor: Colors.accent + '40' },
  geminiHeader: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  geminiTitle: { flex: 1, fontSize: 9, fontWeight: Typography.weight.bold, color: Colors.accent, textTransform: 'uppercase', letterSpacing: 0.5 },
  geminiNotSoldBadge: { backgroundColor: Colors.danger + '20', borderRadius: Radius.pill, paddingHorizontal: 6, paddingVertical: 2 },
  geminiNotSoldText: { fontSize: 8, fontWeight: Typography.weight.bold, color: Colors.danger, letterSpacing: 0.3 },
  geminiNote: { fontSize: 10, color: Colors.accent + 'AA', lineHeight: 14 },
  geminiDesc: { fontSize: Typography.size.xs, color: Colors.textSecondary, lineHeight: 16, fontStyle: 'italic' },
  geminiContext: { fontSize: Typography.size.xs, color: Colors.textTertiary, lineHeight: 15 },
  geminiRangeRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-around', paddingVertical: Spacing.xs },
  geminiRangeItem: { alignItems: 'center', gap: 3, flex: 1, padding: Spacing.xs },
  geminiRangeLabel: { fontSize: 8, color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.3 },
  geminiRangeValue: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  geminiFooter: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  geminiFooterText: { flex: 1, fontSize: 9, color: Colors.textTertiary, lineHeight: 13 },

  // Stats
  statsSection: { gap: Spacing.xs },
  sectionLabel: { fontSize: 9, fontWeight: Typography.weight.bold, color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 },
  statsGrid: { backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.md, paddingHorizontal: Spacing.md, borderWidth: 1, borderColor: Colors.surfaceBorder },

  askingCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 4, backgroundColor: Colors.warningDim, borderRadius: Radius.sm, padding: Spacing.sm, borderWidth: 1, borderColor: Colors.warning + '25' },
  askingText: { flex: 1, fontSize: 10, color: Colors.warning + 'CC', lineHeight: 14 },

  noNumistaRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 4 },
  noNumistaText: { flex: 1, fontSize: Typography.size.xs, color: Colors.textTertiary, lineHeight: 15, fontStyle: 'italic' },
  numistaLink: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.info + '15', borderRadius: Radius.sm, paddingHorizontal: 8, paddingVertical: 5, borderWidth: 1, borderColor: Colors.info + '30', alignSelf: 'flex-start' },
  numistaLinkText: { fontSize: 10, color: Colors.info, fontWeight: Typography.weight.semibold },

  warningsList: { gap: Spacing.xs },
  warningRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 4 },
  warningText: { flex: 1, fontSize: 10, color: Colors.warning + 'CC', lineHeight: 14 },

  rationaleCard: { gap: Spacing.xs, backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.md, padding: Spacing.md },
  rationaleText: { fontSize: Typography.size.xs, color: Colors.textSecondary, lineHeight: 17, fontStyle: 'italic' },

  comparablesToggle: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  comparablesToggleText: { flex: 1, fontSize: Typography.size.xs, color: Colors.textTertiary },
  comparablesList: { backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.md, paddingHorizontal: Spacing.md, borderWidth: 1, borderColor: Colors.surfaceBorder },

  queriesToggle: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  queriesToggleText: { flex: 1, fontSize: Typography.size.xs, color: Colors.textTertiary },
  queriesList: { backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.md, padding: Spacing.md, gap: Spacing.xs, borderWidth: 1, borderColor: Colors.surfaceBorder },
  queryRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 4 },
  queryNum: { fontSize: 10, color: Colors.textTertiary, width: 14 },
  queryText: { flex: 1, fontSize: 10, color: Colors.textSecondary, lineHeight: 14, fontFamily: 'monospace' },
  queryTip: { fontSize: 10, color: Colors.textTertiary, lineHeight: 14, fontStyle: 'italic', marginTop: 4 },

  footerRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  footerText: { flex: 1, fontSize: 10, color: Colors.textTertiary, lineHeight: 14 },

  guardrailBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: 4, backgroundColor: Colors.warningDim, borderRadius: Radius.sm, padding: Spacing.sm, borderWidth: 1, borderColor: Colors.warning + '25' },
  guardrailBannerTitle: { fontSize: 10, fontWeight: Typography.weight.bold, color: Colors.warning, marginBottom: 2 },
  guardrailBannerText: { fontSize: 9, color: Colors.warning + 'CC', lineHeight: 13 },

  provenanceToggle: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  provenanceToggleText: { flex: 1, fontSize: Typography.size.xs, color: Colors.textTertiary },
  provenanceCard: { backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.md, padding: Spacing.md, gap: Spacing.sm, borderWidth: 1, borderColor: Colors.surfaceBorder },
  provenanceRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  provenanceClassDot: { width: 6, height: 6, borderRadius: 3, marginTop: 5, flexShrink: 0 },
  provenanceLabelRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: 2 },
  provenanceLabel: { flex: 1, fontSize: Typography.size.xs, fontWeight: Typography.weight.semibold, color: Colors.textSecondary },
  provenanceClassTag: { fontSize: 8, fontWeight: Typography.weight.bold, letterSpacing: 0.3 },
  provenanceNote: { fontSize: 9, color: Colors.textTertiary, lineHeight: 13 },
  guardrailReasonsCard: { backgroundColor: Colors.dangerDim, borderRadius: Radius.sm, padding: Spacing.sm, gap: 3, borderWidth: 1, borderColor: Colors.danger + '20', marginTop: 4 },
  guardrailReasonsTitle: { fontSize: 9, fontWeight: Typography.weight.bold, color: Colors.danger, textTransform: 'uppercase', letterSpacing: 0.4 },
  guardrailReason: { fontSize: 9, color: Colors.danger + 'CC', lineHeight: 13 },

  noResultCard: { alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.lg, padding: Spacing.xl, borderWidth: 1, borderColor: Colors.surfaceBorder },
  noResultTitle: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.textSecondary, textAlign: 'center' },
  noResultSub: { fontSize: Typography.size.xs, color: Colors.textTertiary, lineHeight: 17, textAlign: 'center' },
  noResultActions: { flexDirection: 'row', gap: Spacing.sm },

  errorBanner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, backgroundColor: Colors.warningDim, borderRadius: Radius.sm, padding: Spacing.sm, borderWidth: 1, borderColor: Colors.warning + '30' },
  errorText: { flex: 1, fontSize: Typography.size.xs, color: Colors.warning, lineHeight: 15 },
});
