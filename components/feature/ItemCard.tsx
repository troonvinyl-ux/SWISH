import React, { memo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors, Typography, Spacing, Radius, Shadow } from '@/constants/theme';
import { Item } from '@/services/itemService';
import { SPECIALISTS } from '@/constants/specialists';
import { ConfidenceBar, EvidenceBadge } from '@/components/ui/ConfidenceIndicator';
import { Badge } from '@/components/ui/Badge';

interface ItemCardProps {
  item: Item;
  onPress?: (id: string) => void;
  onReprice?: (id: string) => void;
  compact?: boolean;
  showReprice?: boolean;
}

const statusConfig: Record<string, { color: string; label: string; variant: 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'primary' | 'accent' | 'gold' }> = {
  active: { color: Colors.success, label: 'Active', variant: 'success' },
  listed: { color: Colors.info, label: 'Listed', variant: 'info' },
  sold: { color: Colors.accent, label: 'Sold', variant: 'accent' },
  review_required: { color: Colors.danger, label: 'Review Required', variant: 'danger' },
  assessing: { color: Colors.warning, label: 'Assessing', variant: 'warning' },
  priced: { color: Colors.primary, label: 'Priced', variant: 'primary' },
  bundled: { color: Colors.gold, label: 'Bundled', variant: 'gold' },
  identifying: { color: Colors.info, label: 'Identifying', variant: 'info' },
  captured: { color: Colors.textSecondary, label: 'Captured', variant: 'neutral' },
  hold: { color: Colors.warning, label: 'Hold', variant: 'warning' },
};

// ── Market range badge with confidence colour ───────────────────────────────
function getConfidenceColor(confidence: string | undefined | null): string {
  const c = (confidence ?? '').toLowerCase();
  if (c === 'high') return Colors.success;
  if (c === 'medium') return Colors.warning;
  if (c === 'low') return Colors.warning;
  if (c === 'very_low') return Colors.danger;
  return Colors.textTertiary; // no data
}

function MarketRangeBadge({ low, high, confidence }: { low: number; high: number; confidence: string | undefined | null }) {
  const hasRange = low > 0 || high > 0;
  const color = getConfidenceColor(confidence);
  const isNoData = !hasRange || !confidence || confidence === 'insufficient_data' || confidence === 'unknown';

  if (isNoData) {
    return (
      <View style={mrb.badge}>
        <View style={[mrb.dot, { backgroundColor: Colors.textTertiary }]} />
        <Text style={[mrb.rangeText, { color: Colors.textTertiary }]}>No market data</Text>
      </View>
    );
  }

  const lowStr = low > 0 ? `£${low.toFixed(0)}` : '?';
  const highStr = high > 0 ? `£${high.toFixed(0)}` : '?';
  const confLabel = (confidence ?? '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  return (
    <View style={[mrb.badge, { borderColor: color + '35', backgroundColor: color + '12' }]}>
      <View style={[mrb.dot, { backgroundColor: color }]} />
      <Text style={[mrb.rangeText, { color }]}>{lowStr}–{highStr}</Text>
    </View>
  );
}

const mrb = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: Radius.pill,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    backgroundColor: Colors.surfaceHighlight,
    alignSelf: 'flex-end',
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  rangeText: {
    fontSize: 10,
    fontWeight: Typography.weight.semibold,
    color: Colors.textTertiary,
    letterSpacing: 0.1,
  },
});

export const ItemCard = memo(({ item, onPress, onReprice, compact = false, showReprice = false }: ItemCardProps) => {
  const router = useRouter();
  const specialist = SPECIALISTS[item.specialistId];
  const statusCfg = statusConfig[item.status] ?? { label: item.status, variant: 'neutral' as const };
  const hasWarnings = item.warnings.length > 0;

  const handlePress = () => {
    if (onPress) {
      onPress(item.id);
    } else {
      router.push(`/stock-listing/${item.id}` as any);
    }
  };

  // Show 'Create Listing' only for items not yet listed/sold
  const showCreateListing =
    item.status !== 'listed' &&
    item.status !== 'active' &&
    item.status !== 'sold' &&
    item.status !== 'held' &&
    item.status !== 'bundled' &&
    item.status !== 'disposed';

  return (
    <Pressable
      onPress={handlePress}
      style={({ pressed }) => [
        styles.card,
        hasWarnings && styles.cardWarning,
        pressed && { opacity: 0.9, transform: [{ scale: 0.99 }] },
      ]}
    >
      {/* Warning stripe */}
      {hasWarnings ? (
        <View style={styles.warningStripe}>
          <MaterialIcons name="warning" size={10} color={Colors.danger} />
          <Text style={styles.warningText}>{item.warnings[0]}</Text>
        </View>
      ) : null}

      <View style={styles.body}>
        {/* Left: Info */}
        <View style={styles.info}>
          <View style={styles.headerRow}>
            <View style={[styles.specialistDot, { backgroundColor: specialist?.color ?? Colors.primary }]} />
            <Text style={styles.specialistName}>{specialist?.shortName ?? item.specialistId}</Text>
            <Badge label={statusCfg.label} variant={statusCfg.variant} />
          </View>

          <Text style={styles.title} numberOfLines={compact ? 1 : 2}>{item.canonicalTitle}</Text>

          {/* Numista N# badge — shown when a verified/strong Numista match exists */}
          {item.attributes?.numista_type_id &&
           (item.attributes?.numista_status === 'verified' ||
            item.attributes?.numista_status === 'strong_match' ||
            item.attributes?.numista_status === 'candidate') ? (
            <View style={styles.numistaBadge}>
              <MaterialIcons name="verified" size={9} color={item.attributes?.numista_status === 'verified' || item.attributes?.numista_status === 'strong_match' ? Colors.success : Colors.warning} />
              <Text style={[styles.numistaBadgeText, { color: item.attributes?.numista_status === 'verified' || item.attributes?.numista_status === 'strong_match' ? Colors.success : Colors.warning }]}>
                N#{item.attributes.numista_type_id}
              </Text>
            </View>
          ) : null}

          {/* eBay category chip */}
          {item.attributes?.ebay_category_name ? (
            <View style={styles.ebayCatChip}>
              <MaterialIcons name="storefront" size={9} color={Colors.textTertiary} />
              <Text style={styles.ebayCatText} numberOfLines={1}>{String(item.attributes.ebay_category_name)}</Text>
            </View>
          ) : null}

          {!compact ? (
            <>
              <Text style={styles.condition}>{item.condition}{item.conditionGrade ? ` · ${item.conditionGrade}` : ''}</Text>
              <EvidenceBadge source={item.identificationSource} />
            </>
          ) : null}
        </View>

        {/* Right: Valuation */}
        <View style={styles.valuations}>
          <Text style={styles.valuationLabel}>Est. Value</Text>
          {item.valuationMid > 0 ? (
            <Text style={styles.valuationMid}>£{item.valuationMid.toLocaleString()}</Text>
          ) : (
            <Text style={styles.valuationNoData}>Not valued</Text>
          )}

          {/* Market value range badge with confidence colour */}
          <MarketRangeBadge
            low={item.valuationLow}
            high={item.valuationHigh}
            confidence={item.valuationConfidence as string}
          />

          {!compact && item.saleProb30d > 0 ? (
            <Text style={[styles.saleProb, { color: item.saleProb30d >= 0.7 ? Colors.success : Colors.warning }]}>
              {Math.round(item.saleProb30d * 100)}% / 30d
            </Text>
          ) : null}
        </View>
      </View>

      {!compact ? (
        <ConfidenceBar value={item.identificationConfidence} showLabel={false} compact />
      ) : null}

      {/* Create Listing shortcut — shown for unlisted items */}
      {showCreateListing ? (
        <Pressable
          onPress={(e) => { e.stopPropagation?.(); router.push(`/create-listing?id=${item.id}` as any); }}
          style={({ pressed }) => [styles.createListingBtn, pressed && { opacity: 0.8 }]}
        >
          <MaterialIcons name="sell" size={12} color={Colors.primary} />
          <Text style={styles.createListingBtnText}>Create Listing</Text>
        </Pressable>
      ) : null}

      {showReprice && item.status === 'listed' ? (
        <Pressable
          onPress={(e) => { e.stopPropagation?.(); onReprice?.(item.id); }}
          style={({ pressed }) => [styles.repriceBtn, pressed && { opacity: 0.8 }]}
        >
          <MaterialIcons name="price-change" size={13} color={Colors.warning} />
          <Text style={styles.repriceBtnText}>Reprice</Text>
        </Pressable>
      ) : null}
    </Pressable>
  );
});
ItemCard.displayName = 'ItemCard';

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    padding: Spacing.md,
    gap: Spacing.sm,
    ...Shadow.sm,
  },
  cardWarning: {
    borderColor: Colors.danger + '44',
    borderWidth: 1.5,
  },
  warningStripe: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.dangerDim,
    borderRadius: Radius.xs,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
  },
  warningText: {
    fontSize: Typography.size.xs - 1,
    color: Colors.danger,
    flex: 1,
  },
  body: {
    flexDirection: 'row',
    gap: Spacing.md,
  },
  info: {
    flex: 1,
    gap: Spacing.xs,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    flexWrap: 'wrap',
  },
  specialistDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  specialistName: {
    fontSize: Typography.size.xs,
    color: Colors.textTertiary,
    fontWeight: Typography.weight.medium,
  },
  title: {
    fontSize: Typography.size.sm,
    fontWeight: Typography.weight.semibold,
    color: Colors.textPrimary,
    lineHeight: Typography.size.sm * 1.4,
  },
  condition: {
    fontSize: Typography.size.xs,
    color: Colors.textSecondary,
  },
  valuations: {
    alignItems: 'flex-end',
    gap: 2,
  },
  valuationLabel: {
    fontSize: Typography.size.xs - 1,
    color: Colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  valuationMid: {
    fontSize: Typography.size.lg,
    fontWeight: Typography.weight.bold,
    color: Colors.textPrimary,
  },
  valuationNoData: {
    fontSize: Typography.size.sm,
    fontWeight: Typography.weight.semibold,
    color: Colors.textTertiary,
    fontStyle: 'italic',
  },
  saleProb: {
    fontSize: Typography.size.xs,
    fontWeight: Typography.weight.semibold,
  },
  createListingBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.primaryDim,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: Colors.primary + '40',
  },
  createListingBtnText: {
    fontSize: Typography.size.xs,
    fontWeight: Typography.weight.semibold,
    color: Colors.primary,
  },
  repriceBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.warningDim,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: Colors.warning + '30',
  },
  repriceBtnText: {
    fontSize: Typography.size.xs,
    fontWeight: Typography.weight.semibold,
    color: Colors.warning,
  },
  numistaBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: Colors.surface,
    borderRadius: Radius.pill,
    paddingHorizontal: 6,
    paddingVertical: 2,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  numistaBadgeText: {
    fontSize: 9,
    fontWeight: Typography.weight.bold,
    letterSpacing: 0.3,
  },
  ebayCatChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: Colors.surfaceHighlight,
    borderRadius: Radius.pill,
    paddingHorizontal: 6,
    paddingVertical: 2,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    maxWidth: 160,
  },
  ebayCatText: {
    fontSize: 9,
    color: Colors.textTertiary,
    fontWeight: Typography.weight.medium,
  },
});
