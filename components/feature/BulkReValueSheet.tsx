// BulkReValueSheet — Bottom sheet for Bulk Re-ID & Value operation
// Shows live progress as each item is valued using worldwide eBay data + AI recommendation.

import React, { useState, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, Modal, Pressable, ScrollView,
  ActivityIndicator, Animated,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Typography, Spacing, Radius, Shadow } from '@/constants/theme';
import { getSupabaseClient } from '@/template';
import {
  BulkReIdProgress, bulkReValue, PricingRecommendation, MarketStats,
} from '@/services/marketValueService';

interface Props {
  visible: boolean;
  onClose: () => void;
  tenantId: string;
  items: Array<{
    id: string;
    canonical_title: string;
    specialist_id: string;
    condition?: string;
    attributes?: Record<string, any>;
    media?: string[];
  }>;
  autonomousMode: boolean;
}

interface ItemResult {
  itemId: string;
  title: string;
  stage: BulkReIdProgress['stage'];
  recommendation?: PricingRecommendation;
  stats?: MarketStats;
  error?: string;
}

function formatPrice(p: number): string {
  return `£${p.toFixed(2)}`;
}

function FormatBadge({ format }: { format: string }) {
  const isAuction = format === 'Auction';
  const isBestOffer = format === 'BuyItNow_WithBestOffer';
  return (
    <View style={[
      styles.formatBadge,
      isAuction ? styles.formatAuction : isBestOffer ? styles.formatBestOffer : styles.formatBIN,
    ]}>
      <MaterialIcons
        name={isAuction ? 'gavel' : isBestOffer ? 'handshake' : 'sell'}
        size={10}
        color={isAuction ? Colors.warning : isBestOffer ? Colors.accent : Colors.success}
      />
      <Text style={[
        styles.formatBadgeText,
        { color: isAuction ? Colors.warning : isBestOffer ? Colors.accent : Colors.success },
      ]}>
        {isAuction ? 'Auction' : isBestOffer ? 'BIN + Offer' : 'Buy It Now'}
      </Text>
    </View>
  );
}

function ItemResultRow({ result }: { result: ItemResult }) {
  const isPending  = result.stage === 'identifying' || result.stage === 'valuing';
  const isDone     = result.stage === 'done';
  const isError    = result.stage === 'error';
  const rec        = result.recommendation;
  const stats      = result.stats;

  return (
    <View style={[styles.resultRow, isError && styles.resultRowError, isDone && styles.resultRowDone]}>
      {/* Status icon */}
      <View style={styles.resultIcon}>
        {isPending ? (
          <ActivityIndicator size="small" color={Colors.primary} />
        ) : isDone ? (
          <MaterialIcons name="check-circle" size={18} color={Colors.success} />
        ) : (
          <MaterialIcons name="error-outline" size={18} color={Colors.danger} />
        )}
      </View>

      {/* Content */}
      <View style={styles.resultContent}>
        <Text style={styles.resultTitle} numberOfLines={1}>{result.title}</Text>

        {isPending ? (
          <Text style={styles.resultSubtext}>
            {result.stage === 'identifying' ? 'Re-identifying...' : 'Searching eBay worldwide...'}
          </Text>
        ) : isDone && rec && stats ? (
          <View style={styles.resultDataRow}>
            {/* Market data */}
            {stats.count > 0 ? (
              <View style={styles.statsPill}>
                <MaterialIcons name="bar-chart" size={10} color={Colors.textTertiary} />
                <Text style={styles.statsText}>{stats.count} sales · £{stats.low}–£{stats.high}</Text>
              </View>
            ) : (
              <View style={styles.statsPill}>
                <MaterialIcons name="info-outline" size={10} color={Colors.textTertiary} />
                <Text style={styles.statsText}>No market data</Text>
              </View>
            )}
            {/* Recommendation */}
            <FormatBadge format={rec.recommendedFormat} />
            <Text style={styles.priceTag}>{formatPrice(rec.recommendedPrice)}</Text>
          </View>
        ) : isError ? (
          <Text style={styles.errorText} numberOfLines={1}>{result.error}</Text>
        ) : null}

        {isDone && rec?.reasoning ? (
          <Text style={styles.reasoningText} numberOfLines={2}>{rec.reasoning}</Text>
        ) : null}
      </View>
    </View>
  );
}

export default function BulkReValueSheet({ visible, onClose, tenantId, items, autonomousMode }: Props) {
  const insets = useSafeAreaInsets();
  const [running, setRunning] = useState(false);
  const [started, setStarted] = useState(false);
  const [results, setResults] = useState<ItemResult[]>([]);
  const [summary, setSummary] = useState<{ processed: number; errors: number } | null>(null);
  const [reIdFirst, setReIdFirst] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const totalItems = items.length;

  const doneCount  = results.filter(r => r.stage === 'done').length;
  const errorCount = results.filter(r => r.stage === 'error').length;
  const progress   = totalItems > 0 ? (doneCount + errorCount) / totalItems : 0;

  const start = useCallback(async () => {
    if (running || !items.length) return;
    setRunning(true);
    setStarted(true);
    setSummary(null);
    const supabase = getSupabaseClient();

    // Initialise all items as pending
    const initial: ItemResult[] = items.map(item => ({
      itemId: item.id,
    title: item.canonical_title || '(untitled)',
      stage: (reIdFirst ? 'identifying' : 'valuing') as BulkReIdProgress['stage'],
    }));
    setResults(initial);

    // If Re-ID first: run swish-identify using stored media for each item
    if (reIdFirst) {
      for (const item of items) {
        if (!item.media || item.media.length === 0) continue;
        const storedUrls = item.media.filter((u: string) => u.startsWith('https://'));
        if (storedUrls.length === 0) continue;
        setResults(prev => prev.map(r =>
          r.itemId === item.id ? { ...r, stage: 'identifying' } : r
        ));
        try {
          const { data } = await supabase.functions.invoke('swish-identify', {
            body: { existingImageUrls: storedUrls.slice(0, 4), specialistId: item.specialist_id, tenantId },
          });
          const id = data?.identification;
          if (id?.canonicalTitle) {
            await supabase.from('items').update({
              canonical_title: id.canonicalTitle,
              identification_confidence: id.confidence ?? 0,
              updated_at: new Date().toISOString(),
            }).eq('id', item.id);
            // Update local title for valuation step
            (item as any).canonical_title = id.canonicalTitle;
          }
        } catch { /* non-blocking */ }
        setResults(prev => prev.map(r =>
          r.itemId === item.id ? { ...r, stage: 'valuing' } : r
        ));
        await new Promise(r => setTimeout(r, 200));
      }
    }

    const result = await bulkReValue(
      tenantId,
      items,
      { applyAutonomously: autonomousMode },
      (update) => {
        setResults(prev => prev.map(r =>
          r.itemId === update.itemId
            ? { ...r, stage: update.stage, recommendation: update.recommendation, stats: update.stats, error: update.error }
            : r
        ));
        // Auto-scroll to bottom
        setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
      },
    );

    setSummary(result);
    setRunning(false);
  }, [running, items, tenantId, autonomousMode]);

  const handleClose = useCallback(() => {
    if (!running) {
      setStarted(false);
      setResults([]);
      setSummary(null);
      onClose();
    }
  }, [running, onClose]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <View style={[styles.container, { paddingBottom: insets.bottom }]}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <MaterialIcons name="travel-explore" size={20} color={Colors.primary} />
            <View>
              <Text style={styles.headerTitle}>Re-Value All</Text>
              <Text style={styles.headerSubtitle}>
                {totalItems} item{totalItems === 1 ? '' : 's'} · eBay worldwide + AI pricing
              </Text>
            </View>
          </View>
          <Pressable onPress={handleClose} style={styles.closeBtn} disabled={running} hitSlop={8}>
            <MaterialIcons name="close" size={20} color={running ? Colors.textTertiary : Colors.textSecondary} />
          </Pressable>
        </View>

        {/* Re-ID first toggle */}
        <Pressable onPress={() => setReIdFirst(v => !v)} style={[styles.autoBanner, reIdFirst ? {} : styles.autoBannerManual]}>
          <View style={[{ width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 2 }, reIdFirst ? { backgroundColor: Colors.accent, borderColor: Colors.accent } : { borderColor: Colors.surfaceBorder }]}>
            {reIdFirst ? <MaterialIcons name="check" size={12} color={Colors.background} /> : null}
          </View>
          <Text style={[styles.autoBannerText, reIdFirst ? { color: Colors.accent } : {}]}>
            Re-ID first with existing photos, then value (slower but more accurate)
          </Text>
        </Pressable>

        {/* Autonomous mode banner */}
        {autonomousMode ? (
          <View style={styles.autoBanner}>
            <MaterialIcons name="auto-fix-high" size={14} color={Colors.primary} />
            <Text style={styles.autoBannerText}>
              Autonomous mode — recommended prices will be written to items automatically
            </Text>
          </View>
        ) : (
          <View style={[styles.autoBanner, styles.autoBannerManual]}>
            <MaterialIcons name="visibility" size={14} color={Colors.textTertiary} />
            <Text style={[styles.autoBannerText, { color: Colors.textTertiary }]}>
              Assisted mode — review recommendations and apply manually
            </Text>
          </View>
        )}

        {/* Progress bar */}
        {started ? (
          <View style={styles.progressWrap}>
            <View style={styles.progressTrack}>
              <Animated.View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
            </View>
            <Text style={styles.progressText}>
              {doneCount + errorCount} / {totalItems}
              {running ? '  •  searching...' : summary ? (errorCount > 0 ? `  •  ${errorCount} failed` : '  •  complete') : ''}
            </Text>
          </View>
        ) : null}

        {/* Results list */}
        <ScrollView
          ref={scrollRef}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        >
          {started ? (
            results.map(r => <ItemResultRow key={r.itemId} result={r} />)
          ) : (
            <View style={styles.preStart}>
              <View style={styles.preStartIcon}>
                <MaterialIcons name="travel-explore" size={36} color={Colors.primary} />
              </View>
              <Text style={styles.preStartTitle}>Ready to search worldwide eBay</Text>
              <Text style={styles.preStartText}>
                SWISH will search completed eBay auctions, worldwide coin sellers, and numismatic databases 
                to find comparable sold prices for each item — then use AI to recommend the optimal format 
                (Auction vs Buy It Now) and price for the quickest sale at best value.
              </Text>
              {/* Data sources */}
              <View style={styles.sourcesList}>
                {[
                  { icon: 'shopping-bag', label: 'eBay Completed Sales', sub: 'Worldwide sold listings' },
                  { icon: 'gavel', label: 'eBay Auctions', sub: 'Auction vs BIN analysis' },
                  { icon: 'military-tech', label: 'Numista Database', sub: 'Coin reference data (coins only)' },
                  { icon: 'psychology', label: 'AI Pricing Model', sub: 'Quick-sale-to-value optimisation' },
                ].map(s => (
                  <View key={s.label} style={styles.sourceRow}>
                    <View style={styles.sourceIconWrap}>
                      <MaterialIcons name={s.icon as any} size={16} color={Colors.primary} />
                    </View>
                    <View>
                      <Text style={styles.sourceLabel}>{s.label}</Text>
                      <Text style={styles.sourceSub}>{s.sub}</Text>
                    </View>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* Summary */}
          {summary ? (
            <View style={styles.summaryCard}>
              <MaterialIcons
                name={summary.errors === 0 ? 'check-circle' : 'info'}
                size={20}
                color={summary.errors === 0 ? Colors.success : Colors.warning}
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.summaryTitle}>
                  {summary.errors === 0 ? 'All items valued' : 'Valuation complete'}
                </Text>
                <Text style={styles.summaryText}>
                  {summary.processed} updated · {summary.errors} failed
                  {autonomousMode && summary.processed > 0 ? ' · Prices written automatically' : ''}
                </Text>
              </View>
            </View>
          ) : null}
        </ScrollView>

        {/* CTA */}
        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, Spacing.base) }]}>
          {!started ? (
            <Pressable
              onPress={start}
              style={({ pressed }) => [styles.startBtn, pressed && { opacity: 0.85 }]}
            >
              <MaterialIcons name="travel-explore" size={18} color={Colors.background} />
              <Text style={styles.startBtnText}>
                Search eBay Worldwide ({totalItems} item{totalItems === 1 ? '' : 's'})
              </Text>
            </Pressable>
          ) : running ? (
            <Pressable style={[styles.startBtn, styles.runningBtn]} disabled>
              <ActivityIndicator size="small" color={Colors.background} />
              <Text style={styles.startBtnText}>Searching... {doneCount + errorCount}/{totalItems}</Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={handleClose}
              style={({ pressed }) => [styles.startBtn, styles.doneBtn, pressed && { opacity: 0.85 }]}
            >
              <MaterialIcons name="check" size={18} color={Colors.background} />
              <Text style={styles.startBtnText}>Done</Text>
            </Pressable>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.base, paddingTop: Spacing.lg, paddingBottom: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder,
    gap: Spacing.md,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flex: 1 },
  headerTitle: { fontSize: Typography.size.lg, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  headerSubtitle: { fontSize: Typography.size.xs, color: Colors.textTertiary, marginTop: 1 },
  closeBtn: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.surfaceBorder,
  },

  autoBanner: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingHorizontal: Spacing.base, paddingVertical: Spacing.sm,
    backgroundColor: Colors.primaryDim,
    borderBottomWidth: 1, borderBottomColor: Colors.primary + '30',
  },
  autoBannerManual: {
    backgroundColor: Colors.surfaceHighlight,
    borderBottomColor: Colors.surfaceBorder,
  },
  autoBannerText: { flex: 1, fontSize: Typography.size.xs, color: Colors.primary, lineHeight: 16 },

  progressWrap: {
    paddingHorizontal: Spacing.base, paddingVertical: Spacing.sm,
    borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder,
    gap: 6,
  },
  progressTrack: {
    height: 4, backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.pill, overflow: 'hidden',
  },
  progressFill: {
    height: '100%', backgroundColor: Colors.primary, borderRadius: Radius.pill,
  },
  progressText: { fontSize: 10, color: Colors.textTertiary, textAlign: 'right' },

  list: { flex: 1 },
  listContent: { padding: Spacing.base, gap: Spacing.sm },

  // Item result row
  resultRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm,
    backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: Spacing.md,
    borderWidth: 1, borderColor: Colors.surfaceBorder,
  },
  resultRowDone: { borderColor: Colors.success + '30', backgroundColor: Colors.surface },
  resultRowError: { borderColor: Colors.danger + '30' },
  resultIcon: { width: 22, alignItems: 'center', justifyContent: 'center', paddingTop: 2 },
  resultContent: { flex: 1, gap: 4 },
  resultTitle: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.textPrimary },
  resultSubtext: { fontSize: Typography.size.xs, color: Colors.textTertiary },
  errorText: { fontSize: Typography.size.xs, color: Colors.danger },
  resultDataRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, flexWrap: 'wrap' },
  statsPill: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.pill,
    paddingHorizontal: 6, paddingVertical: 3,
  },
  statsText: { fontSize: 10, color: Colors.textTertiary },
  priceTag: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.gold, marginLeft: 'auto' as any },
  reasoningText: { fontSize: 10, color: Colors.textTertiary, lineHeight: 14, marginTop: 2 },

  // Format badges
  formatBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    borderRadius: Radius.sm, paddingHorizontal: 6, paddingVertical: 3,
  },
  formatAuction:   { backgroundColor: Colors.warning + '20' },
  formatBIN:       { backgroundColor: Colors.success + '20' },
  formatBestOffer: { backgroundColor: Colors.accent + '20' },
  formatBadgeText: { fontSize: 10, fontWeight: Typography.weight.semibold },

  // Pre-start state
  preStart: { gap: Spacing.lg, paddingVertical: Spacing.md },
  preStartIcon: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: Colors.primaryDim, alignItems: 'center', justifyContent: 'center',
    alignSelf: 'center',
  },
  preStartTitle: {
    fontSize: Typography.size.lg, fontWeight: Typography.weight.semibold,
    color: Colors.textPrimary, textAlign: 'center',
  },
  preStartText: {
    fontSize: Typography.size.sm, color: Colors.textTertiary, textAlign: 'center', lineHeight: 21,
  },
  sourcesList: { gap: Spacing.sm, marginTop: Spacing.xs },
  sourceRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: Spacing.md,
    borderWidth: 1, borderColor: Colors.surfaceBorder,
  },
  sourceIconWrap: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: Colors.primaryDim, alignItems: 'center', justifyContent: 'center',
  },
  sourceLabel: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.textPrimary },
  sourceSub: { fontSize: Typography.size.xs, color: Colors.textTertiary, marginTop: 1 },

  // Summary
  summaryCard: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: Spacing.md,
    borderWidth: 1, borderColor: Colors.surfaceBorder, marginTop: Spacing.sm,
  },
  summaryTitle: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.textPrimary },
  summaryText: { fontSize: Typography.size.xs, color: Colors.textTertiary, marginTop: 2 },

  // Footer
  footer: { paddingHorizontal: Spacing.base, paddingTop: Spacing.md, borderTopWidth: 1, borderTopColor: Colors.surfaceBorder },
  startBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm,
    backgroundColor: Colors.primary, borderRadius: Radius.lg, paddingVertical: 14,
    ...Shadow.sm,
  },
  runningBtn: { backgroundColor: Colors.textTertiary },
  doneBtn: { backgroundColor: Colors.success },
  startBtnText: { fontSize: Typography.size.base, fontWeight: Typography.weight.bold, color: Colors.background },
});
