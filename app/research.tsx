// SWISH Research Centre
// Live market research: search eBay (Browse API + Terapeak if available),
// Numista, and Gemini Vision for sold prices and comparable items.
// Results are ephemeral — not stored in DB (just for manual research).
// Image search: paste a URL or pick from library → Gemini + eBay visual search.

import React, { useState, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, Pressable, ScrollView, TextInput,
  ActivityIndicator, Linking, Image as RNImage,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { Colors, Typography, Spacing, Radius, Shadow } from '@/constants/theme';
import { useApp } from '@/hooks/useApp';
import { getSupabaseClient } from '@/template';
import { FunctionsHttpError } from '@supabase/supabase-js';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface ResearchResult {
  source: 'terapeak' | 'marketplace_insights' | 'ebay_browse' | 'numista' | 'gemini';
  title: string;
  price?: number;
  currency?: string;
  soldDate?: string;
  imageUrl?: string;
  itemUrl?: string;
  condition?: string;
  isActive?: boolean;   // true = asking price, false = sold
  isSoldPrice?: boolean;
  conditionId?: string;
}

interface ResearchSummary {
  avgSoldPrice?: number;
  soldPriceRange?: { low: number; high: number };
  recentSoldCount?: number;
  sellThrough?: number;
  activeListing?: number;
  currency?: string;
  source?: string;
  geminiEstimate?: { low: number; mid: number; high: number; confidence: string; rationale: string };
  numista?: { title?: string; weight?: number; diameter?: number; composition?: string; url?: string };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function fmt(price?: number, currency = 'GBP'): string {
  if (!price) return '—';
  const sym = currency === 'GBP' ? '£' : currency === 'USD' ? '$' : '€';
  return `${sym}${price.toFixed(2)}`;
}

function sourceChip(source: ResearchResult['source']) {
  const cfg: Record<string, { label: string; color: string }> = {
    terapeak:   { label: 'Product Research', color: Colors.success },
    marketplace_insights: { label: 'eBay Sold', color: Colors.success },
    ebay_browse:{ label: 'eBay',     color: '#E53238' },
    numista:    { label: 'Numista',  color: Colors.info },
    gemini:     { label: 'Gemini AI',color: Colors.accent },
  };
  return cfg[source] ?? { label: source, color: Colors.textTertiary };
}

// ─────────────────────────────────────────────────────────────────────────────
// Result Card
// ─────────────────────────────────────────────────────────────────────────────

function ResultCard({ item }: { item: ResearchResult }) {
  const chip = sourceChip(item.source);
  return (
    <Pressable
      onPress={() => item.itemUrl ? Linking.openURL(item.itemUrl) : null}
      style={({ pressed }) => [rc.card, pressed && { opacity: 0.85 }]}
    >
      {item.imageUrl ? (
        <Image source={{ uri: item.imageUrl }} style={rc.thumb} contentFit="cover" transition={200} />
      ) : (
        <View style={rc.thumbPlaceholder}>
          <MaterialIcons name="image-not-supported" size={18} color={Colors.textTertiary} />
        </View>
      )}
      <View style={rc.content}>
        <Text style={rc.title} numberOfLines={2}>{item.title}</Text>
        <View style={rc.metaRow}>
          <View style={[rc.sourceChip, { backgroundColor: chip.color + '20', borderColor: chip.color + '40' }]}>
            <Text style={[rc.sourceText, { color: chip.color }]}>{chip.label}</Text>
          </View>
          <View style={[rc.typeChip, item.isSoldPrice ? { backgroundColor: Colors.successDim, borderColor: Colors.success + '40' } : { backgroundColor: Colors.warningDim, borderColor: Colors.warning + '40' }]}>
            <MaterialIcons name={item.isSoldPrice ? 'sell' : 'storefront'} size={9} color={item.isSoldPrice ? Colors.success : Colors.warning} />
            <Text style={[rc.typeText, { color: item.isSoldPrice ? Colors.success : Colors.warning }]}>{item.isSoldPrice ? 'SOLD' : 'ACTIVE'}</Text>
          </View>
          {item.soldDate ? <Text style={rc.date}>{item.soldDate.slice(0, 10)}</Text> : null}
        </View>
        {item.condition ? <Text style={rc.condition}>{item.condition}</Text> : null}
      </View>
      <View style={rc.priceWrap}>
        {item.price ? <Text style={[rc.price, item.isSoldPrice && { color: Colors.success }]}>{fmt(item.price, item.currency)}</Text> : null}
        {item.itemUrl ? <MaterialIcons name="open-in-new" size={11} color={Colors.textTertiary} /> : null}
      </View>
    </Pressable>
  );
}

const rc = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md, backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.surfaceBorder },
  thumb: { width: 56, height: 56, borderRadius: Radius.md, flexShrink: 0 },
  thumbPlaceholder: { width: 56, height: 56, borderRadius: Radius.md, backgroundColor: Colors.surfaceHighlight, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  content: { flex: 1, gap: 3 },
  title: { fontSize: Typography.size.xs, fontWeight: Typography.weight.medium, color: Colors.textPrimary, lineHeight: 16 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, flexWrap: 'wrap' },
  sourceChip: { borderRadius: Radius.pill, paddingHorizontal: 5, paddingVertical: 2, borderWidth: 1 },
  sourceText: { fontSize: 8, fontWeight: Typography.weight.bold, textTransform: 'uppercase', letterSpacing: 0.3 },
  typeChip: { flexDirection: 'row', alignItems: 'center', gap: 2, borderRadius: Radius.pill, paddingHorizontal: 5, paddingVertical: 2, borderWidth: 1 },
  typeText: { fontSize: 8, fontWeight: Typography.weight.extrabold, letterSpacing: 0.3 },
  date: { fontSize: 9, color: Colors.textTertiary },
  condition: { fontSize: 9, color: Colors.textTertiary },
  priceWrap: { alignItems: 'flex-end', gap: 4, flexShrink: 0 },
  price: { fontSize: Typography.size.sm, fontWeight: Typography.weight.extrabold, color: Colors.textPrimary },
});

// ─────────────────────────────────────────────────────────────────────────────
// Summary Panel
// ─────────────────────────────────────────────────────────────────────────────

function SummaryPanel({ summary }: { summary: ResearchSummary }) {
  return (
    <View style={sp.card}>
      {/* Terapeak / Browse sold data */}
      {summary.avgSoldPrice ? (
        <View style={sp.mainMetric}>
          <Text style={sp.mainLabel}>AVG SOLD PRICE</Text>
          <Text style={sp.mainValue}>{fmt(summary.avgSoldPrice, summary.currency)}</Text>
          {summary.soldPriceRange ? (
            <Text style={sp.mainSub}>Range {fmt(summary.soldPriceRange.low, summary.currency)} – {fmt(summary.soldPriceRange.high, summary.currency)}</Text>
          ) : null}
          <View style={sp.sourceRow}>
            <MaterialIcons name="verified" size={10} color={Colors.success} />
            <Text style={sp.sourceLabel}>{summary.source ?? 'eBay sold data'}</Text>
          </View>
        </View>
      ) : null}

      <View style={sp.metricsRow}>
        {summary.recentSoldCount !== undefined ? (
          <View style={sp.metric}>
            <Text style={[sp.metricValue, { color: Colors.success }]}>{summary.recentSoldCount}</Text>
            <Text style={sp.metricLabel}>Sold</Text>
          </View>
        ) : null}
        {summary.activeListing !== undefined ? (
          <View style={sp.metric}>
            <Text style={[sp.metricValue, { color: Colors.warning }]}>{summary.activeListing}</Text>
            <Text style={sp.metricLabel}>Active</Text>
          </View>
        ) : null}
        {summary.sellThrough !== undefined ? (
          <View style={sp.metric}>
            <Text style={sp.metricValue}>{Math.round(summary.sellThrough * 100)}%</Text>
            <Text style={sp.metricLabel}>Sell Through</Text>
          </View>
        ) : null}
      </View>

      {/* Gemini estimate when no sold data */}
      {summary.geminiEstimate ? (
        <View style={sp.geminiWrap}>
          <View style={sp.geminiHeader}>
            <MaterialIcons name="auto-awesome" size={12} color={Colors.accent} />
            <Text style={sp.geminiHeaderText}>Gemini AI Market Estimate</Text>
            <View style={[sp.geminiConfChip, {
              backgroundColor: summary.geminiEstimate.confidence === 'high' ? Colors.successDim : Colors.warningDim,
              borderColor: (summary.geminiEstimate.confidence === 'high' ? Colors.success : Colors.warning) + '40',
            }]}>
              <Text style={[sp.geminiConf, { color: summary.geminiEstimate.confidence === 'high' ? Colors.success : Colors.warning }]}>
                {summary.geminiEstimate.confidence.toUpperCase()}
              </Text>
            </View>
          </View>
          <View style={sp.geminiPrices}>
            {[
              { label: 'Low', value: summary.geminiEstimate.low },
              { label: 'Mid', value: summary.geminiEstimate.mid, highlight: true },
              { label: 'High', value: summary.geminiEstimate.high },
            ].map(p => (
              <View key={p.label} style={sp.geminiPrice}>
                <Text style={[sp.geminiPriceValue, p.highlight && { color: Colors.accent, fontSize: Typography.size.xl }]}>
                  {fmt(p.value, summary.currency)}
                </Text>
                <Text style={sp.geminiPriceLabel}>{p.label}</Text>
              </View>
            ))}
          </View>
          {summary.geminiEstimate.rationale ? (
            <Text style={sp.geminiRationale} numberOfLines={3}>{summary.geminiEstimate.rationale}</Text>
          ) : null}
          <View style={sp.geminiDisclaimer}>
            <MaterialIcons name="info-outline" size={10} color={Colors.textTertiary} />
            <Text style={sp.geminiDisclaimerText}>AI inference — not verified eBay sold prices</Text>
          </View>
        </View>
      ) : null}

      {/* Numista catalogue reference */}
      {summary.numista?.title ? (
        <Pressable
          onPress={() => summary.numista?.url ? Linking.openURL(summary.numista.url) : null}
          style={sp.numistaRow}
        >
          <MaterialIcons name="menu-book" size={13} color={Colors.info} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={sp.numistaTitle} numberOfLines={1}>{summary.numista.title}</Text>
            <View style={{ flexDirection: 'row', gap: Spacing.md }}>
              {summary.numista.weight ? <Text style={sp.numistaSpec}>Weight: {summary.numista.weight}g</Text> : null}
              {summary.numista.diameter ? <Text style={sp.numistaSpec}>⌀{summary.numista.diameter}mm</Text> : null}
              {summary.numista.composition ? <Text style={sp.numistaSpec}>{summary.numista.composition}</Text> : null}
            </View>
          </View>
          {summary.numista.url ? <MaterialIcons name="open-in-new" size={11} color={Colors.info} /> : null}
        </Pressable>
      ) : null}
    </View>
  );
}

const sp = StyleSheet.create({
  card: { backgroundColor: Colors.surface, borderRadius: Radius.xl, padding: Spacing.base, gap: Spacing.md, borderWidth: 1, borderColor: Colors.surfaceBorder },
  mainMetric: { alignItems: 'center', gap: 2 },
  mainLabel: { fontSize: 9, fontWeight: Typography.weight.extrabold, color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.8 },
  mainValue: { fontSize: 36, fontWeight: Typography.weight.extrabold, color: Colors.textPrimary },
  mainSub: { fontSize: Typography.size.xs, color: Colors.textTertiary },
  sourceRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  sourceLabel: { fontSize: 9, color: Colors.success },
  metricsRow: { flexDirection: 'row', justifyContent: 'space-around' },
  metric: { alignItems: 'center', gap: 3 },
  metricValue: { fontSize: Typography.size.xl, fontWeight: Typography.weight.extrabold, color: Colors.textPrimary },
  metricLabel: { fontSize: 9, color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.4 },
  geminiWrap: { backgroundColor: Colors.accent + '12', borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.sm, borderWidth: 1, borderColor: Colors.accent + '25' },
  geminiHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  geminiHeaderText: { flex: 1, fontSize: Typography.size.xs, color: Colors.accent, fontWeight: Typography.weight.semibold },
  geminiConfChip: { borderRadius: Radius.pill, paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1 },
  geminiConf: { fontSize: 8, fontWeight: Typography.weight.extrabold, letterSpacing: 0.3 },
  geminiPrices: { flexDirection: 'row', justifyContent: 'space-around' },
  geminiPrice: { alignItems: 'center', gap: 2 },
  geminiPriceValue: { fontSize: Typography.size.lg, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  geminiPriceLabel: { fontSize: 9, color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.3 },
  geminiRationale: { fontSize: Typography.size.xs, color: Colors.textSecondary, lineHeight: 16 },
  geminiDisclaimer: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  geminiDisclaimerText: { fontSize: 9, color: Colors.textTertiary },
  numistaRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.infoDim, borderRadius: Radius.md, padding: Spacing.md, borderWidth: 1, borderColor: Colors.info + '30' },
  numistaTitle: { fontSize: Typography.size.xs, fontWeight: Typography.weight.semibold, color: Colors.info },
  numistaSpec: { fontSize: 9, color: Colors.info + 'BB' },
});

// ─────────────────────────────────────────────────────────────────────────────
// Main Screen
// ─────────────────────────────────────────────────────────────────────────────

export default function ResearchScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { tenant } = useApp();
  const supabase = getSupabaseClient();

  const [query, setQuery] = useState('');
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [summary, setSummary] = useState<ResearchSummary | null>(null);
  const [results, setResults] = useState<ResearchResult[]>([]);

  const [filterSold, setFilterSold] = useState<'all' | 'sold' | 'active'>('all');

  const abortRef = useRef(false);

  // ── Image pick ───────────────────────────────────────────────────────────────
  const pickImage = useCallback(async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
      base64: false,
      allowsEditing: false,
    });
    if (!result.canceled && result.assets[0]) {
      setImageUri(result.assets[0].uri);
    }
  }, []);

  const clearImage = useCallback(() => setImageUri(null), []);

  // ── Run research ─────────────────────────────────────────────────────────────
  const runResearch = useCallback(async () => {
    if (!query.trim() && !imageUri) return;
    if (!tenant) { setError('No tenant loaded'); return; }

    setLoading(true);
    setError(null);
    setSummary(null);
    setResults([]);
    abortRef.current = false;

    try {
      // Call swish-market-value with the search query and optional image
      const body: Record<string, any> = {
        tenantId: tenant.id,
        title: query.trim() || 'Research query',
        specialistId: 'coins',
        attributes: {},
        identificationConfidence: 0,
        identificationTier: 'candidate',
        applyToItem: false,
        researchMode: true,
      };

      // If image provided, encode it for Gemini analysis
      if (imageUri) {
        const { FileSystem } = require('expo-file-system');
        try {
          const b64 = await FileSystem.readAsStringAsync(imageUri, { encoding: 'base64' });
          body.imageBase64 = `data:image/jpeg;base64,${b64}`;
        } catch {}
      }

      const { data, error: fnErr } = await supabase.functions.invoke('swish-market-value', { body });

      if (fnErr) {
        let msg = fnErr.message;
        if (fnErr instanceof FunctionsHttpError) {
          try { const t = await fnErr.context?.text(); if (t) { try { const p = JSON.parse(t); msg = p.error ?? t; } catch { msg = t; } } } catch {}
        }
        setError(msg);
        return;
      }

      // Build summary from response
      const mv = data as any;
      const newSummary: ResearchSummary = {};
      const newResults: ResearchResult[] = [];

      // Match the current swish-market-value response contract first, while retaining
      // legacy aliases for older deployed Edge Function versions.
      const sold = mv?.verifiedSoldResearch ?? mv?.teapeakProductResearch ?? mv?.teapeakData ?? {};
      const soldAverage = Number(sold.averageSoldPrice ?? sold.avgSoldPrice ?? 0);
      const soldCount = Number(sold.soldQuantity ?? sold.soldCount ?? 0);
      const soldLow = Number(sold.priceMin ?? sold.lowSoldPrice ?? 0);
      const soldHigh = Number(sold.priceMax ?? sold.highSoldPrice ?? 0);
      if (soldAverage > 0 || soldCount > 0) {
        if (soldAverage > 0) newSummary.avgSoldPrice = soldAverage;
        if (soldLow > 0 || soldHigh > 0) {
          newSummary.soldPriceRange = {
            low: soldLow > 0 ? soldLow : soldAverage,
            high: soldHigh > 0 ? soldHigh : soldAverage,
          };
        }
        newSummary.recentSoldCount = soldCount;
        newSummary.sellThrough = sold.sellThroughRate ?? sold.sellThrough ?? undefined;
        newSummary.currency = 'GBP';
        newSummary.source = sold.available
          ? (sold.source === 'ebay_marketplace_insights' ? 'eBay verified sold listings' : 'eBay Product Research / Terapeak (sold-market statistics)')
          : 'eBay sold-market statistics';
      }

      // Current backend contract: Browse results are under browseApiResults.topItems.
      // These are active asking prices and must never be counted as sold comparables.
      const browse = mv?.browseApiResults ?? {};
      const activeListings = mv?.activeAskingPrices?.sampleListings ?? browse.topItems ?? [];
      if (activeListings.length) {
        newSummary.activeListing = Number(
          mv?.activeAskingPrices?.count ?? browse.totalFetched ?? activeListings.length
        );
        for (const listing of activeListings.slice(0, 12)) {
          const price = Number(listing.price ?? listing.priceAmount ?? 0);
          if (!listing.title || !(price > 0)) continue;
          newResults.push({
            source: 'ebay_browse',
            title: listing.title,
            price,
            currency: listing.currency ?? 'GBP',
            imageUrl: listing.imageUrl,
            itemUrl: listing.itemUrl ?? listing.url ?? (listing.itemId ? 'https://www.ebay.co.uk/itm/' + listing.itemId : undefined),
            condition: listing.condition,
            isActive: true,
            isSoldPrice: false,
          });
        }
      } else if (Number(browse.totalFetched ?? 0) > 0) {
        newSummary.activeListing = Number(browse.totalFetched);
      }

      // Only render actual sold listing records if the source returned them. Product
      // Research often returns aggregates only; do not fabricate individual sold items.
      const soldListings = sold.items ?? sold.topSoldListings
        ?? mv?.soldMarket?.sampleSoldListings
        ?? (Array.isArray(mv?.stats?.recentSales)
          ? mv.stats.recentSales.filter((item: any) => /sold/i.test(String(item.sellSummary ?? '')))
          : []);
      for (const s of soldListings.slice(0, 12)) {
        const price = Number(s.price ?? s.soldPrice ?? 0);
        if (!s.title || !(price > 0)) continue;
        newResults.push({
          source: sold.source === 'ebay_marketplace_insights' ? 'marketplace_insights' : 'terapeak',
          title: s.title,
          price,
          currency: s.currency ?? 'GBP',
          imageUrl: s.imageUrl,
          itemUrl: s.itemUrl ?? s.url ?? (s.itemId ? 'https://www.ebay.co.uk/itm/' + s.itemId : undefined),
          soldDate: s.soldDate ?? s.lastSoldDate ?? s.endDate,
          condition: s.condition,
          isActive: false,
          isSoldPrice: true,
        });
      }

      // Gemini estimate is an inference fallback, not verified sold evidence.
      const g = mv?.geminiMarketResearch;
      const gRange = g?.estimatedRange ?? {};
      const gMid = Number(g?.estimatedMid ?? gRange.mid ?? 0);
      if (gMid > 0) {
        newSummary.geminiEstimate = {
          low: Number(g?.estimatedLow ?? gRange.low ?? 0),
          mid: gMid,
          high: Number(g?.estimatedHigh ?? gRange.high ?? 0),
          confidence: g?.confidence ?? 'medium',
          rationale: g?.marketContext ?? g?.rationale ?? g?.valuationBasis ?? '',
        };
        newSummary.currency = newSummary.currency ?? 'GBP';
      }

      // The backend returns a Numista verification reference only when a type ID was
      // supplied upstream. Do not pretend it performed a new Numista search.
      const n = mv?.numistaMatch ?? mv?.numista;
      if (n?.title || n?.typeId) {
        const nTitle = n.title ?? (n.typeId ? 'Numista type N#' + n.typeId : '');
        newSummary.numista = {
          title: nTitle,
          weight: n.weight,
          diameter: n.diameter,
          composition: n.composition,
          url: n.numistaUrl ?? (n.typeId ? 'https://en.numista.com/catalogue/index.php?r=' + n.typeId : undefined),
        };
        if (nTitle) {
          newResults.push({
            source: 'numista',
            title: nTitle,
            itemUrl: n.numistaUrl ?? (n.typeId ? 'https://en.numista.com/catalogue/index.php?r=' + n.typeId : undefined),
            isActive: false,
            isSoldPrice: false,
          });
        }
      }

      // Report the real failure mode when no results were returned.
      const apiStatus = mv?.dataSource?.apiConnectionStatus;
      if (newResults.length === 0 && !newSummary.avgSoldPrice && !newSummary.geminiEstimate) {
        const details = [
          apiStatus?.teapeakStatus ? 'eBay sold research HTTP ' + apiStatus.teapeakStatus : '',
          apiStatus?.browseApiError ? 'eBay Browse: ' + apiStatus.browseApiError : '',
          mv?.teapeakProductResearch?.needsReauth ? 'Reconnect eBay to grant the required sold-research access.' : '',
          mv?.verifiedSoldResearch?.accessError ?? '',
        ].filter(Boolean).join(' ');
        setError(details || 'No results found. Try a more specific search term or add an image for visual research.');
      }
      setSummary(newSummary);
      setResults(newResults);

      if (newResults.length === 0 && !newSummary.avgSoldPrice && !newSummary.recentSoldCount && !newSummary.geminiEstimate) {
        setError('No results found. Try a different search term or add an image for visual research.');
      }
    } catch (e: any) {
      setError(e?.message ?? 'Research failed');
    } finally {
      setLoading(false);
    }
  }, [query, imageUri, tenant, supabase]);

  // ── Filter results ───────────────────────────────────────────────────────────
  const filteredResults = results.filter(r => {
    if (filterSold === 'sold') return r.isSoldPrice;
    if (filterSold === 'active') return !r.isSoldPrice;
    return true;
  });

  const soldCount = results.filter(r => r.isSoldPrice).length;
  const activeCount = results.filter(r => !r.isSoldPrice).length;

  return (
    <View style={s.container}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={[s.header, { paddingTop: insets.top + Spacing.sm }]}>
        <Pressable onPress={() => router.back()} style={s.backBtn} hitSlop={8} accessibilityLabel="Go back" accessibilityRole="button">
          <MaterialIcons name="arrow-back" size={20} color={Colors.textSecondary} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>Research Centre</Text>
          <Text style={s.subtitle}>Live eBay · Terapeak · Numista · Gemini</Text>
        </View>
      </View>

      {/* Search Bar */}
      <View style={s.searchArea}>
        <View style={s.searchRow}>
          <View style={s.searchInputWrap}>
            <MaterialIcons name="search" size={18} color={Colors.textTertiary} />
            <TextInput
              style={s.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder="Search e.g. 'Islamic silver tanka coin'"
              placeholderTextColor={Colors.textTertiary}
              returnKeyType="search"
              onSubmitEditing={runResearch}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {query.length > 0 ? (
              <Pressable onPress={() => setQuery('')} hitSlop={8}>
                <MaterialIcons name="close" size={16} color={Colors.textTertiary} />
              </Pressable>
            ) : null}
          </View>
        </View>

        {/* Image search */}
        <View style={s.imageRow}>
          {imageUri ? (
            <View style={s.imagePreviewWrap}>
              <Image source={{ uri: imageUri }} style={s.imagePreview} contentFit="cover" />
              <Pressable onPress={clearImage} style={s.imageRemove} hitSlop={6} accessibilityLabel="Remove image">
                <MaterialIcons name="close" size={12} color="#fff" />
              </Pressable>
            </View>
          ) : (
            <Pressable onPress={pickImage} style={s.imagePickBtn} accessibilityRole="button" accessibilityLabel="Add image for visual research">
              <MaterialIcons name="add-a-photo" size={15} color={Colors.primary} />
              <Text style={s.imagePickText}>Add Image</Text>
            </Pressable>
          )}
          <Pressable
            onPress={runResearch}
            disabled={loading || (!query.trim() && !imageUri)}
            style={({ pressed }) => [s.searchBtn, (!query.trim() && !imageUri) && s.searchBtnDisabled, pressed && { opacity: 0.85 }]}
            accessibilityRole="button"
            accessibilityLabel={loading ? 'Researching, please wait' : 'Run research'}
            accessibilityState={{ busy: loading }}
          >
            {loading
              ? <ActivityIndicator size="small" color="#fff" />
              : <MaterialIcons name="search" size={18} color="#fff" />}
            <Text style={s.searchBtnText}>{loading ? 'Researching...' : 'Research'}</Text>
          </Pressable>
        </View>

        {/* Source info */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.sourceChips}>
          {[
            { icon: 'verified', label: 'Terapeak*', color: Colors.success },
            { icon: 'storefront', label: 'eBay Live', color: '#E53238' },
            { icon: 'menu-book', label: 'Numista', color: Colors.info },
            { icon: 'auto-awesome', label: 'Gemini AI', color: Colors.accent },
          ].map(src => (
            <View key={src.label} style={[s.srcChip, { backgroundColor: src.color + '15', borderColor: src.color + '30' }]}>
              <MaterialIcons name={src.icon as any} size={10} color={src.color} />
              <Text style={[s.srcChipText, { color: src.color }]}>{src.label}</Text>
            </View>
          ))}
          <Text style={s.srcNote}>*Requires eBay Shop subscription</Text>
        </ScrollView>
      </View>

      {/* Results */}
      <ScrollView
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[s.results, { paddingBottom: insets.bottom + 32 }]}
        keyboardShouldPersistTaps="handled"
      >
        {/* Error */}
        {error ? (
          <View style={s.errorCard} accessibilityRole="alert">
            <MaterialIcons name="info-outline" size={15} color={Colors.warning} />
            <Text style={s.errorText}>{error}</Text>
          </View>
        ) : null}

        {/* Summary */}
        {summary && (summary.avgSoldPrice || summary.recentSoldCount || summary.geminiEstimate || summary.numista) ? (
          <>
            <Text style={s.sectionLabel}>MARKET SUMMARY</Text>
            <SummaryPanel summary={summary} />
          </>
        ) : null}

        {/* Filter tabs */}
        {results.length > 0 ? (
          <>
            <Text style={s.sectionLabel}>RESULTS ({results.length})</Text>
            <View style={s.filterTabs}>
              {([
                { id: 'all', label: `All (${results.length})` },
                { id: 'sold', label: `Sold (${soldCount})` },
                { id: 'active', label: `Active (${activeCount})` },
              ] as const).map(tab => (
                <Pressable
                  key={tab.id}
                  onPress={() => setFilterSold(tab.id)}
                  style={[s.filterTab, filterSold === tab.id && s.filterTabActive]}
                >
                  <Text style={[s.filterTabText, filterSold === tab.id && s.filterTabTextActive]}>{tab.label}</Text>
                </Pressable>
              ))}
            </View>
            <View style={s.resultsList}>
              {filteredResults.map((item, idx) => <ResultCard key={idx} item={item} />)}
            </View>
          </>
        ) : null}

        {/* Empty state */}
        {!loading && results.length === 0 && !error && !summary ? (
          <View style={s.empty}>
            <MaterialIcons name="manage-search" size={52} color={Colors.textTertiary} />
            <Text style={s.emptyTitle}>Research Anything</Text>
            <Text style={s.emptySub}>
              Search by keyword to see eBay sold prices, Terapeak data, Numista catalogue entries and Gemini market estimates in one place.
            </Text>
            <Text style={s.emptyNote}>
              Add a photo to search by image via Gemini Vision.{'\n'}
              Terapeak requires your eBay account to have an active eBay Shop subscription — no separate signup needed.
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingHorizontal: Spacing.base, paddingBottom: Spacing.sm,
    borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder,
  },
  backBtn: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.surfaceBorder },
  title: { fontSize: Typography.size.lg, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  subtitle: { fontSize: Typography.size.xs, color: Colors.textTertiary },

  searchArea: { paddingHorizontal: Spacing.base, paddingVertical: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder, gap: Spacing.sm, backgroundColor: Colors.surface },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  searchInputWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.background, borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderWidth: 1, borderColor: Colors.surfaceBorder },
  searchInput: { flex: 1, fontSize: Typography.size.sm, color: Colors.textPrimary, includeFontPadding: false },

  imageRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  imagePreviewWrap: { position: 'relative', width: 48, height: 48 },
  imagePreview: { width: 48, height: 48, borderRadius: Radius.md },
  imageRemove: { position: 'absolute', top: -4, right: -4, width: 18, height: 18, borderRadius: 9, backgroundColor: Colors.danger, alignItems: 'center', justifyContent: 'center' },
  imagePickBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.primaryDim, borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderWidth: 1, borderColor: Colors.primary + '40' },
  imagePickText: { fontSize: Typography.size.xs, color: Colors.primary, fontWeight: Typography.weight.semibold },
  searchBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, flex: 1, backgroundColor: Colors.primary, borderRadius: Radius.md, paddingVertical: Spacing.sm },
  searchBtnDisabled: { backgroundColor: Colors.surfaceHighlight },
  searchBtnText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: '#fff' },

  sourceChips: { flexDirection: 'row', gap: Spacing.xs, alignItems: 'center' },
  srcChip: { flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: Radius.pill, paddingHorizontal: 7, paddingVertical: 3, borderWidth: 1 },
  srcChipText: { fontSize: 9, fontWeight: Typography.weight.bold },
  srcNote: { fontSize: 9, color: Colors.textTertiary, marginLeft: 4 },

  results: { padding: Spacing.base, gap: Spacing.md },
  sectionLabel: { fontSize: 9, fontWeight: Typography.weight.extrabold, color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.8 },

  filterTabs: { flexDirection: 'row', gap: Spacing.xs, backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: 3 },
  filterTab: { flex: 1, alignItems: 'center', paddingVertical: Spacing.sm, borderRadius: Radius.md },
  filterTabActive: { backgroundColor: Colors.primary },
  filterTabText: { fontSize: Typography.size.xs, color: Colors.textTertiary, fontWeight: Typography.weight.medium },
  filterTabTextActive: { color: '#fff', fontWeight: Typography.weight.bold },

  resultsList: { gap: Spacing.sm },

  errorCard: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, backgroundColor: Colors.warningDim, borderRadius: Radius.md, padding: Spacing.base, borderWidth: 1, borderColor: Colors.warning + '40' },
  errorText: { flex: 1, fontSize: Typography.size.sm, color: Colors.warning, lineHeight: 18 },

  empty: { alignItems: 'center', justifyContent: 'center', gap: Spacing.md, paddingVertical: 60, paddingHorizontal: Spacing.xl },
  emptyTitle: { fontSize: Typography.size.xl, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  emptySub: { fontSize: Typography.size.sm, color: Colors.textSecondary, textAlign: 'center', lineHeight: 22 },
  emptyNote: { fontSize: Typography.size.xs, color: Colors.textTertiary, textAlign: 'center', lineHeight: 18, marginTop: Spacing.sm, backgroundColor: Colors.surface, borderRadius: Radius.md, padding: Spacing.md, borderWidth: 1, borderColor: Colors.surfaceBorder },
});
