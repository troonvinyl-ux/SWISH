// SWISH Listings Tab Screen
// All listings across all items — filterable by status.
// Submit, End, and View actions inline per row.
// Inline editable: title, description, price, shipping cost, floor price.

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList, Pressable,
  ActivityIndicator, RefreshControl, Linking, TextInput, Modal, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors, Typography, Spacing, Radius, Shadow } from '@/constants/theme';
import { useApp } from '@/hooks/useApp';
import { useAlert, getSupabaseClient } from '@/template';
import {
  ListingWithItem, getAllListings,
  endListing, refreshListingStats,
  submitListingToMarketplace, SubmitStep,
  updateListingShipping,
  updateListingPrice,
  updateListingTitle,
  updateListingDescription,
  updateListingFloorPrice,
} from '@/services/listingService';
import { IS_TV } from '@/hooks/useTVNavigation';

// ── Submit Progress Modal ─────────────────────────────────────────────────────

const SUBMIT_STEPS: Array<{
  id: SubmitStep;
  label: string;
  sublabel: string;
  icon: string;
}> = [
  { id: 'verifying',         label: 'Verifying listing',      sublabel: 'Checking title, price and item data',        icon: 'fact-check' },
  { id: 'checking_policies', label: 'Checking eBay policies', sublabel: 'Validating fulfillment and return policies',   icon: 'policy' },
  { id: 'resolving_category',label: 'Resolving category',     sublabel: 'Confirming leaf category with eBay Taxonomy', icon: 'category' },
  { id: 'publishing',        label: 'Publishing to eBay',     sublabel: 'Sending listing to eBay Trading API',         icon: 'send' },
];

type StepState = 'idle' | 'active' | 'done' | 'failed';

function getStepState(
  stepId: SubmitStep,
  currentStep: SubmitStep | null,
  failed: boolean,
): StepState {
  const order = SUBMIT_STEPS.map(s => s.id);
  const currentIdx = currentStep ? order.indexOf(currentStep) : -1;
  const stepIdx = order.indexOf(stepId);
  if (currentStep === 'done') return 'done';
  if (failed && currentStep === stepId) return 'failed';
  if (stepIdx < currentIdx) return 'done';
  if (stepIdx === currentIdx) return failed ? 'failed' : 'active';
  return 'idle';
}

function SubmitStepRow({
  step, state,
}: {
  step: typeof SUBMIT_STEPS[0];
  state: StepState;
}) {
  const iconColor =
    state === 'done'   ? Colors.success :
    state === 'active' ? Colors.primary  :
    state === 'failed' ? Colors.danger   :
    Colors.textTertiary;

  const bgColor =
    state === 'done'   ? Colors.successDim :
    state === 'active' ? Colors.primaryDim :
    state === 'failed' ? (Colors.dangerDim ?? Colors.danger + '15') :
    Colors.surfaceHighlight;

  return (
    <View style={spm.stepRow}>
      <View style={[spm.stepIconWrap, { backgroundColor: bgColor }]}>
        {state === 'active' ? (
          <ActivityIndicator size="small" color={Colors.primary} style={{ width: 18, height: 18 }} />
        ) : state === 'done' ? (
          <MaterialIcons name="check" size={16} color={Colors.success} />
        ) : state === 'failed' ? (
          <MaterialIcons name="close" size={16} color={Colors.danger} />
        ) : (
          <MaterialIcons name={step.icon as any} size={16} color={Colors.textTertiary} />
        )}
      </View>
      <View style={spm.stepText}>
        <Text style={[spm.stepLabel, { color: iconColor }]}>{step.label}</Text>
        <Text style={spm.stepSublabel}>{step.sublabel}</Text>
      </View>
    </View>
  );
}

function SubmitProgressModal({
  visible,
  currentStep,
  listingTitle,
  failed,
}: {
  visible: boolean;
  currentStep: SubmitStep | null;
  listingTitle?: string;
  failed: boolean;
}) {
  const isDone = currentStep === 'done';

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={spm.overlay}>
        <View style={spm.card}>
          {/* Header */}
          <View style={spm.header}>
            <View style={spm.headerIconWrap}>
              {isDone ? (
                <MaterialIcons name="check-circle" size={22} color={Colors.success} />
              ) : failed ? (
                <MaterialIcons name="error" size={22} color={Colors.danger} />
              ) : (
                <ActivityIndicator size="small" color={Colors.primary} />
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={spm.headerTitle}>
                {isDone ? 'Listed on eBay!' : failed ? 'Submission Failed' : 'Submitting to eBay'}
              </Text>
              {listingTitle ? (
                <Text style={spm.headerSub} numberOfLines={1}>{listingTitle}</Text>
              ) : null}
            </View>
          </View>

          {/* Steps */}
          <View style={spm.steps}>
            {SUBMIT_STEPS.map(step => (
              <SubmitStepRow
                key={step.id}
                step={step}
                state={getStepState(step.id, currentStep, failed)}
              />
            ))}
          </View>

          {/* Footer note */}
          {!isDone && !failed ? (
            <Text style={spm.footerNote}>
              Please wait — do not close the app
            </Text>
          ) : isDone ? (
            <Text style={[spm.footerNote, { color: Colors.success }]}>
              Your listing is now live on eBay UK
            </Text>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const spm = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xl,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.xxl,
    padding: Spacing.lg,
    width: '100%',
    maxWidth: 380,
    gap: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    ...Shadow.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingBottom: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceBorder,
  },
  headerIconWrap: {
    width: 40,
    height: 40,
    borderRadius: Radius.md,
    backgroundColor: Colors.surfaceHighlight,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  headerTitle: {
    fontSize: Typography.size.base,
    fontWeight: Typography.weight.bold,
    color: Colors.textPrimary,
  },
  headerSub: {
    fontSize: Typography.size.xs,
    color: Colors.textTertiary,
    marginTop: 2,
  },
  steps: { gap: Spacing.sm },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  stepIconWrap: {
    width: 34,
    height: 34,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  stepText: { flex: 1, gap: 1 },
  stepLabel: {
    fontSize: Typography.size.sm,
    fontWeight: Typography.weight.semibold,
    color: Colors.textPrimary,
  },
  stepSublabel: {
    fontSize: Typography.size.xs,
    color: Colors.textTertiary,
    lineHeight: 15,
  },
  footerNote: {
    fontSize: Typography.size.xs,
    color: Colors.textTertiary,
    textAlign: 'center',
    paddingTop: Spacing.xs,
  },
});
import { getAutonomyControls, isActionPermitted } from '@/services/autonomyService';
import { recordCapitalTransaction } from '@/services/capitalService';

// ── Types ─────────────────────────────────────────────────────────────────────

type StatusFilter = 'all' | 'draft' | 'pending' | 'active' | 'ended' | 'needs_correction';
type SortBy = 'date_desc' | 'date_asc' | 'price_desc' | 'price_asc' | 'margin_desc' | 'margin_asc';

const SORT_OPTIONS: Array<{ id: SortBy; label: string; icon: string }> = [
  { id: 'date_desc',   label: 'Newest first',        icon: 'schedule' },
  { id: 'date_asc',    label: 'Oldest first',         icon: 'history' },
  { id: 'price_desc',  label: 'Price: High to Low',   icon: 'arrow-downward' },
  { id: 'price_asc',   label: 'Price: Low to High',   icon: 'arrow-upward' },
  { id: 'margin_desc', label: 'Margin: High to Low',  icon: 'trending-up' },
  { id: 'margin_asc',  label: 'Margin: Low to High',  icon: 'trending-down' },
];

const SORT_LABELS: Record<SortBy, string> = {
  date_desc:   'Newest',
  date_asc:    'Oldest',
  price_desc:  'Price ↓',
  price_asc:   'Price ↑',
  margin_desc: 'Margin ↓',
  margin_asc:  'Margin ↑',
};

const FILTER_OPTIONS: Array<{ id: StatusFilter; label: string; icon: string; color: string }> = [
  { id: 'all',              label: 'All',       icon: 'list-alt',       color: Colors.textSecondary },
  { id: 'draft',            label: 'Draft',     icon: 'edit',           color: Colors.textTertiary },
  { id: 'pending',          label: 'Verified',  icon: 'verified',       color: Colors.primary },
  { id: 'active',           label: 'Live',      icon: 'wifi-tethering', color: Colors.success },
  { id: 'needs_correction', label: 'Fix',       icon: 'error-outline',  color: Colors.danger },
  { id: 'ended',            label: 'Ended',     icon: 'stop-circle',    color: Colors.textTertiary },
];

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: string }> = {
  draft:            { label: 'Draft',      color: Colors.textTertiary, icon: 'edit' },
  verified:         { label: 'Verified',   color: Colors.primary,      icon: 'verified' },
  active:           { label: 'Live',       color: Colors.success,      icon: 'wifi-tethering' },
  pending:          { label: 'Verified',   color: Colors.primary,      icon: 'verified' },
  needs_correction: { label: 'Fix Needed', color: Colors.danger,       icon: 'error-outline' },
  ended:            { label: 'Ended',      color: Colors.textTertiary, icon: 'stop-circle' },
};

// ── Listing Row ───────────────────────────────────────────────────────────────

function ListingRow({
  listing,
  onSubmit,
  onEnd,
  onRefreshStats,
  onSaveShipping,
  onSavePrice,
  onSaveTitle,
  onSaveDesc,
  onLowerFloorPrice,
  submittingId,
  endingId,
  refreshingId,
  editingShippingId,
  shippingInput,
  onEditShipping,
  onShippingChange,
  onCancelShipping,
  savingShippingId,
  editingPriceId,
  priceInput,
  onEditPrice,
  onPriceChange,
  onCancelPrice,
  savingPriceId,
  editingTitleId,
  titleInput,
  onEditTitle,
  onTitleChange,
  onCancelTitle,
  savingTitleId,
  editingDescId,
  descInput,
  onEditDesc,
  onDescChange,
  onCancelDesc,
  savingDescId,
  loweringFloorId,
  hasTVPreferredFocus,
}: {
  listing: ListingWithItem;
  onSubmit: (l: ListingWithItem) => void;
  onEnd: (l: ListingWithItem) => void;
  onRefreshStats: (l: ListingWithItem) => void;
  onSaveShipping: (l: ListingWithItem) => void;
  onSavePrice: (l: ListingWithItem) => void;
  onSaveTitle: (l: ListingWithItem) => void;
  onSaveDesc: (l: ListingWithItem) => void;
  onLowerFloorPrice: (l: ListingWithItem) => void;
  submittingId: string | null;
  endingId: string | null;
  refreshingId: string | null;
  editingShippingId: string | null;
  shippingInput: string;
  onEditShipping: (l: ListingWithItem) => void;
  onShippingChange: (v: string) => void;
  onCancelShipping: () => void;
  savingShippingId: string | null;
  editingPriceId: string | null;
  priceInput: string;
  onEditPrice: (l: ListingWithItem) => void;
  onPriceChange: (v: string) => void;
  onCancelPrice: () => void;
  savingPriceId: string | null;
  editingTitleId: string | null;
  titleInput: string;
  onEditTitle: (l: ListingWithItem) => void;
  onTitleChange: (v: string) => void;
  onCancelTitle: () => void;
  savingTitleId: string | null;
  editingDescId: string | null;
  descInput: string;
  onEditDesc: (l: ListingWithItem) => void;
  onDescChange: (v: string) => void;
  onCancelDesc: () => void;
  savingDescId: string | null;
  loweringFloorId: string | null;
  hasTVPreferredFocus?: boolean;
}) {
  const router = useRouter();
  const [tvFocused, setTVFocused] = useState(false);
  const sc = STATUS_CONFIG[listing.status] ?? STATUS_CONFIG['draft'];
  const isLive     = listing.status === 'active';
  const isDraft    = listing.status === 'draft' || listing.status === 'needs_correction';
  const isVerified = listing.status === 'pending';
  const isEnded    = listing.status === 'ended';
  const isEditable = isDraft || isVerified;
  const margin = listing.itemAcquiredCost > 0
    ? ((listing.price - listing.itemAcquiredCost) / listing.price * 100).toFixed(0)
    : null;

  const descCharCount = descInput.length;
  const descWarning   = descCharCount > 4500;

  // Show floor price warning when price is below AI-suggested floor
  const showFloorWarning = isEditable && listing.floorPrice > 0 && listing.price < listing.floorPrice;

  // Verified eBay UK leaf categories for display purposes
  const EBAY_LEAF_CATEGORIES: Record<string, string> = {
    '4726': 'British Coins', '40714': 'Ancient Coins', '261': 'GB Stamps',
    '183454': 'Trading Cards', '13956': 'Militaria', '19077': 'Vintage Toys',
    '14324': 'Wristwatches', '360': 'Paintings', '870': 'Pottery & China',
    '50': 'Fine Jewellery', '20091': 'Antique Furniture', '261186': 'Antique Books',
    '1469': 'Other Collectables', '45': 'Fashion Jewellery', '3252': 'Antique Silver',
    '11675': 'Maps & Atlases', '37953': 'Photographic Images', '11450': 'Clothing',
    '625': 'Cameras', '10': 'Musical Instruments', '267': 'Books & Comics',
  };

  return (
    <Pressable
      onPress={() => router.push(`/stock-listing/${listing.itemId}` as any)}
      onFocus={() => setTVFocused(true)}
      onBlur={() => setTVFocused(false)}
      hasTVPreferredFocus={IS_TV && !!hasTVPreferredFocus}
      isTVSelectable={IS_TV}
      accessible
      accessibilityLabel={listing.title || listing.itemTitle || 'Listing'}
      style={({ pressed }) => [
        row.card,
        pressed && { opacity: 0.93 },
        IS_TV && tvFocused && row.cardTVFocused,
      ]}
    >
      {/* Header */}
      <View style={row.header}>
        <View style={row.headerLeft}>
          <View style={[row.statusDot, { backgroundColor: sc.color }]} />
          <Text style={[row.statusLabel, { color: sc.color }]}>{sc.label}</Text>
          <View style={[row.marketplacePill, { backgroundColor: Colors.accentDim }]}>
            <MaterialIcons name="storefront" size={9} color={Colors.accent} />
            <Text style={row.marketplacePillText}>{listing.marketplaceId.toUpperCase()}</Text>
          </View>
        </View>
        <Text style={row.date}>{new Date(listing.updatedAt).toLocaleDateString()}</Text>
      </View>

      {/* Item title (non-editable label) */}
      <Text style={row.itemTitle} numberOfLines={1}>{listing.itemTitle}</Text>

      {/* eBay category chip — active listings only */}
      {isLive && listing.categoryId ? (
        <View style={row.categoryChip}>
          <MaterialIcons name="category" size={9} color={Colors.info} />
          <Text style={row.categoryChipText} numberOfLines={1}>
            {EBAY_LEAF_CATEGORIES[listing.categoryId] ?? `Cat. ${listing.categoryId}`}
          </Text>
        </View>
      ) : null}

      {/* Listing title — editable for draft/verified */}
      {isEditable ? (
        editingTitleId === listing.id ? (
          <View style={row.titleEditContainer}>
            <TextInput
              style={row.titleInput}
              value={titleInput}
              onChangeText={v => onTitleChange(v.slice(0, 80))}
              placeholder="Enter listing title..."
              placeholderTextColor={Colors.textTertiary}
              autoFocus
              selectTextOnFocus
              multiline={false}
              returnKeyType="done"
              onSubmitEditing={() => onSaveTitle(listing)}
            />
            <View style={row.titleEditActions}>
              <Text style={row.titleCharCount}>{titleInput.length}/80</Text>
              <Pressable
                onPress={() => onSaveTitle(listing)}
                disabled={savingTitleId === listing.id || titleInput.trim().length === 0}
                style={({ pressed }) => [row.editSaveBtn, pressed && { opacity: 0.8 }]}
              >
                {savingTitleId === listing.id
                  ? <ActivityIndicator size="small" color={Colors.background} style={{ width: 12, height: 12 }} />
                  : <MaterialIcons name="check" size={12} color={Colors.background} />
                }
              </Pressable>
              <Pressable onPress={onCancelTitle} hitSlop={6} style={row.editCancelBtn}>
                <MaterialIcons name="close" size={12} color={Colors.textTertiary} />
              </Pressable>
            </View>
          </View>
        ) : (
          <Pressable
            onPress={() => onEditTitle(listing)}
            style={({ pressed }) => [row.titleEditBtn, pressed && { opacity: 0.75 }]}
            hitSlop={4}
          >
            <Text style={row.listingTitle} numberOfLines={2}>{listing.title}</Text>
            <MaterialIcons name="edit" size={11} color={Colors.primary} style={{ marginTop: 2, flexShrink: 0 }} />
          </Pressable>
        )
      ) : (
        <Text style={row.listingTitle} numberOfLines={2}>{listing.title}</Text>
      )}

      {/* Description — editable for draft/verified */}
      {isEditable ? (
        editingDescId === listing.id ? (
          <View style={row.descEditContainer}>
            <TextInput
              style={row.descInput}
              value={descInput}
              onChangeText={onDescChange}
              placeholder="Enter listing description..."
              placeholderTextColor={Colors.textTertiary}
              autoFocus
              multiline
              textAlignVertical="top"
              scrollEnabled={false}
            />
            <View style={row.descEditActions}>
              <Text style={[row.descCharCount, descWarning && { color: Colors.warning }]}>
                {descCharCount.toLocaleString()} chars{descWarning ? ' · long' : ''}
              </Text>
              <Pressable
                onPress={() => onSaveDesc(listing)}
                disabled={savingDescId === listing.id || descInput.trim().length === 0}
                style={({ pressed }) => [row.editSaveBtn, pressed && { opacity: 0.8 }]}
              >
                {savingDescId === listing.id
                  ? <ActivityIndicator size="small" color={Colors.background} style={{ width: 12, height: 12 }} />
                  : <MaterialIcons name="check" size={12} color={Colors.background} />
                }
              </Pressable>
              <Pressable onPress={onCancelDesc} hitSlop={6} style={row.editCancelBtn}>
                <MaterialIcons name="close" size={12} color={Colors.textTertiary} />
              </Pressable>
            </View>
          </View>
        ) : (
          <Pressable
            onPress={() => onEditDesc(listing)}
            style={({ pressed }) => [row.descPreviewBtn, pressed && { opacity: 0.75 }]}
            hitSlop={4}
          >
            {listing.description ? (
              <Text style={row.descPreviewText} numberOfLines={2}>{listing.description}</Text>
            ) : (
              <Text style={row.descPlaceholder}>Tap to add description...</Text>
            )}
            <MaterialIcons
              name="edit"
              size={11}
              color={Colors.textTertiary}
              style={{ marginTop: 1, flexShrink: 0 }}
            />
          </Pressable>
        )
      ) : null}

      {/* Price row — editable for draft/verified */}
      <View style={row.priceRow}>
        {isEditable ? (
          editingPriceId === listing.id ? (
            <View style={row.priceEditRow}>
              <Text style={row.priceCurrency}>£</Text>
              <TextInput
                style={row.priceInputField}
                value={priceInput}
                onChangeText={onPriceChange}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor={Colors.textTertiary}
                autoFocus
                selectTextOnFocus
              />
              <Pressable
                onPress={() => onSavePrice(listing)}
                disabled={savingPriceId === listing.id}
                style={({ pressed }) => [row.editSaveBtn, pressed && { opacity: 0.8 }]}
              >
                {savingPriceId === listing.id
                  ? <ActivityIndicator size="small" color={Colors.background} style={{ width: 12, height: 12 }} />
                  : <MaterialIcons name="check" size={12} color={Colors.background} />
                }
              </Pressable>
              <Pressable onPress={onCancelPrice} hitSlop={6} style={row.editCancelBtn}>
                <MaterialIcons name="close" size={12} color={Colors.textTertiary} />
              </Pressable>
            </View>
          ) : (
            <Pressable
              onPress={() => onEditPrice(listing)}
              style={({ pressed }) => [row.priceEditBtn, pressed && { opacity: 0.7 }]}
              hitSlop={4}
            >
              <Text style={row.price}>£{listing.price.toFixed(2)}</Text>
              <MaterialIcons name="edit" size={11} color={Colors.primary} style={{ marginLeft: 3 }} />
            </Pressable>
          )
        ) : (
          <Text style={row.price}>£{listing.price.toFixed(2)}</Text>
        )}

        {margin && editingPriceId !== listing.id ? (
          <View style={row.marginBadge}>
            <Text style={[row.marginText, { color: Number(margin) >= 20 ? Colors.success : Colors.warning }]}>
              {margin}% margin
            </Text>
          </View>
        ) : null}

        {isLive && (listing.views > 0 || listing.watchers > 0) ? (
          <View style={row.statsRow}>
            {listing.views > 0 ? (
              <View style={row.statChip}>
                <MaterialIcons name="visibility" size={9} color={Colors.textTertiary} />
                <Text style={row.statChipText}>{listing.views}</Text>
              </View>
            ) : null}
            {listing.watchers > 0 ? (
              <View style={row.statChip}>
                <MaterialIcons name="star-outline" size={9} color={Colors.gold} />
                <Text style={[row.statChipText, { color: Colors.gold }]}>{listing.watchers}</Text>
              </View>
            ) : null}
          </View>
        ) : null}
      </View>

      {/* Floor price warning — shown when listing price is below AI-suggested floor */}
      {showFloorWarning ? (
        <View style={row.floorWarningRow}>
          <MaterialIcons name="info-outline" size={11} color={Colors.warning} />
          <Text style={row.floorWarningText}>
            AI floor £{listing.floorPrice.toFixed(2)} · your price £{listing.price.toFixed(2)}
          </Text>
          <Pressable
            onPress={(e) => { (e as any).stopPropagation?.(); onLowerFloorPrice(listing); }}
            disabled={loweringFloorId === listing.id}
            style={({ pressed }) => [row.floorOverrideBtn, pressed && { opacity: 0.8 }]}
          >
            {loweringFloorId === listing.id
              ? <ActivityIndicator size="small" color={Colors.warning} style={{ width: 10, height: 10 }} />
              : <MaterialIcons name="lock-open" size={10} color={Colors.warning} />}
            <Text style={row.floorOverrideBtnText}>Override floor</Text>
          </Pressable>
        </View>
      ) : null}

      {/* Shipping cost row — editable for draft/verified */}
      {isEditable ? (
        <View style={row.shippingRow}>
          <MaterialIcons name="local-shipping" size={11} color={Colors.textTertiary} />
          {editingShippingId === listing.id ? (
            <View style={row.shippingEditRow}>
              <Text style={row.shippingCurrency}>£</Text>
              <TextInput
                style={row.shippingInput}
                value={shippingInput}
                onChangeText={onShippingChange}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor={Colors.textTertiary}
                autoFocus
                selectTextOnFocus
              />
              <Pressable
                onPress={() => onSaveShipping(listing)}
                disabled={savingShippingId === listing.id}
                style={({ pressed }) => [row.editSaveBtn, pressed && { opacity: 0.8 }]}
              >
                {savingShippingId === listing.id
                  ? <ActivityIndicator size="small" color={Colors.background} style={{ width: 12, height: 12 }} />
                  : <MaterialIcons name="check" size={12} color={Colors.background} />
                }
              </Pressable>
              <Pressable onPress={onCancelShipping} hitSlop={6} style={row.editCancelBtn}>
                <MaterialIcons name="close" size={12} color={Colors.textTertiary} />
              </Pressable>
            </View>
          ) : (
            <Pressable
              onPress={() => onEditShipping(listing)}
              style={({ pressed }) => [row.shippingValueBtn, pressed && { opacity: 0.7 }]}
              hitSlop={4}
            >
              <Text style={row.shippingValueText}>
                {listing.shippingCost > 0 ? `£${listing.shippingCost.toFixed(2)} buyer pays` : 'Simple Delivery · Buyer pays'}
              </Text>
              <MaterialIcons name="edit" size={10} color={Colors.primary} />
            </Pressable>
          )}
        </View>
      ) : null}

      {/* Actions */}
      {/* Listing health indicator */}
      {(isDraft || isVerified) ? (() => {
        const issues: string[] = [];
        if (!listing.title || listing.title.length < 5) issues.push('No title');
        if (listing.title && listing.title.length > 80) issues.push('Title too long');
        if (!listing.description) issues.push('No description');
        if (!listing.price || listing.price <= 0) issues.push('No price');
        if (!listing.categoryId) issues.push('No category');
        const photoCount = 0; // Listed items may have photos on item record
        if (issues.length === 0) return (
          <View style={row.healthRow}>
            <MaterialIcons name="check-circle" size={11} color={Colors.success} />
            <Text style={row.healthGood}>Listing looks complete</Text>
          </View>
        );
        return (
          <View style={row.healthRow}>
            <MaterialIcons name="warning" size={11} color={Colors.warning} />
            <Text style={row.healthWarn}>{issues.join(' · ')}</Text>
          </View>
        );
      })() : null}

      {!isEnded ? (
        <View style={row.actions}>
          {isDraft ? (
            <Pressable
              onPress={() => onSubmit(listing)}
              disabled={submittingId === listing.id}
              style={({ pressed }) => [row.actionBtn, row.actionBtnPrimary, pressed && { opacity: 0.85 }]}
            >
              {submittingId === listing.id
                ? <ActivityIndicator size="small" color={Colors.background} style={{ width: 13, height: 13 }} />
                : <MaterialIcons name="send" size={13} color={Colors.background} />
              }
              <Text style={row.actionBtnPrimaryText}>
                {submittingId === listing.id ? 'Submitting...' : 'Submit to eBay'}
              </Text>
            </Pressable>
          ) : null}

          {isVerified ? (
            <Pressable
              onPress={() => onSubmit(listing)}
              disabled={submittingId === listing.id}
              style={({ pressed }) => [row.actionBtn, row.actionBtnPrimary, pressed && { opacity: 0.85 }]}
            >
              {submittingId === listing.id
                ? <ActivityIndicator size="small" color={Colors.background} style={{ width: 13, height: 13 }} />
                : <MaterialIcons name="publish" size={13} color={Colors.background} />
              }
              <Text style={row.actionBtnPrimaryText}>
                {submittingId === listing.id ? 'Publishing...' : 'Publish'}
              </Text>
            </Pressable>
          ) : null}

          {isLive ? (
            <>
              {listing.externalListingId ? (
                <>
                  <Pressable
                    onPress={() => Linking.openURL(`https://www.ebay.co.uk/itm/${listing.externalListingId}`)}
                    style={({ pressed }) => [row.actionBtn, row.actionBtnEbay, pressed && { opacity: 0.8 }]}
                  >
                    <MaterialIcons name="open-in-new" size={12} color={Colors.accent} />
                    <Text style={[row.actionBtnText, { color: Colors.accent }]}>View</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => onRefreshStats(listing)}
                    disabled={refreshingId === listing.id}
                    style={({ pressed }) => [row.actionBtn, row.actionBtnSecondary, pressed && { opacity: 0.8 }]}
                  >
                    {refreshingId === listing.id
                      ? <ActivityIndicator size="small" color={Colors.textSecondary} style={{ width: 12, height: 12 }} />
                      : <MaterialIcons name="refresh" size={12} color={Colors.textSecondary} />
                    }
                    <Text style={row.actionBtnText}>Stats</Text>
                  </Pressable>
                </>
              ) : null}
              <Pressable
                onPress={() => onEnd(listing)}
                disabled={endingId === listing.id}
                style={({ pressed }) => [row.actionBtn, row.actionBtnDanger, pressed && { opacity: 0.8 }]}
              >
                {endingId === listing.id
                  ? <ActivityIndicator size="small" color={Colors.danger} style={{ width: 12, height: 12 }} />
                  : <MaterialIcons name="stop-circle" size={12} color={Colors.danger} />
                }
                <Text style={[row.actionBtnText, { color: Colors.danger }]}>End</Text>
              </Pressable>
            </>
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
}

const row = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface, borderRadius: Radius.xl,
    padding: Spacing.md, gap: Spacing.sm,
    borderWidth: 1, borderColor: Colors.surfaceBorder,
  },
  cardTVFocused: {
    borderColor: Colors.primary,
    borderWidth: 2,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.7,
    shadowRadius: 10,
    elevation: 10,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusLabel: { fontSize: Typography.size.xs, fontWeight: Typography.weight.semibold },
  marketplacePill: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    borderRadius: Radius.pill, paddingHorizontal: 5, paddingVertical: 2,
  },
  marketplacePillText: { fontSize: 9, fontWeight: Typography.weight.bold, color: Colors.accent },
  date: { fontSize: Typography.size.xs - 1, color: Colors.textTertiary },
  itemTitle: {
    fontSize: Typography.size.xs, fontWeight: Typography.weight.bold,
    color: Colors.textPrimary, textTransform: 'uppercase', letterSpacing: 0.3, opacity: 0.6,
  },
  listingTitle: { fontSize: Typography.size.sm, color: Colors.textSecondary, lineHeight: 18, flex: 1 },

  // ── Title edit ─────────────────────────────────────────────────────────────
  titleEditBtn: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 5,
    backgroundColor: Colors.surfaceHighlight,
    borderRadius: Radius.sm, paddingHorizontal: 6, paddingVertical: 4,
  },
  titleEditContainer: {
    backgroundColor: Colors.surfaceElevated, borderRadius: Radius.md,
    borderWidth: 1.5, borderColor: Colors.primary,
    paddingHorizontal: Spacing.md, paddingTop: Spacing.xs, paddingBottom: 4, gap: 4,
  },
  titleInput: {
    fontSize: Typography.size.sm, color: Colors.textPrimary,
    lineHeight: 20, paddingVertical: 2, includeFontPadding: false,
  },
  titleEditActions: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4,
    paddingTop: 2,
  },
  titleCharCount: {
    flex: 1, fontSize: Typography.size.xs - 1, color: Colors.textTertiary,
  },

  // ── Description edit ────────────────────────────────────────────────────────
  descPreviewBtn: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 5,
    backgroundColor: Colors.surfaceHighlight,
    borderRadius: Radius.sm, paddingHorizontal: 7, paddingVertical: 5,
  },
  descPreviewText: {
    flex: 1, fontSize: Typography.size.xs, color: Colors.textTertiary,
    lineHeight: 16,
  },
  descPlaceholder: {
    flex: 1, fontSize: Typography.size.xs, color: Colors.textTertiary,
    fontStyle: 'italic', opacity: 0.6,
  },
  descEditContainer: {
    backgroundColor: Colors.surfaceElevated, borderRadius: Radius.md,
    borderWidth: 1.5, borderColor: Colors.accent,
    paddingHorizontal: Spacing.md, paddingTop: Spacing.sm, paddingBottom: 4, gap: 6,
  },
  descInput: {
    fontSize: Typography.size.sm, color: Colors.textPrimary,
    lineHeight: 20, minHeight: 80, maxHeight: 200,
    paddingVertical: 0, includeFontPadding: false,
  },
  descEditActions: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4,
    borderTopWidth: 1, borderTopColor: Colors.surfaceBorder, paddingTop: 4,
  },
  descCharCount: {
    flex: 1, fontSize: Typography.size.xs - 1, color: Colors.textTertiary,
  },

  // ── Price row ──────────────────────────────────────────────────────────────
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  price: { fontSize: Typography.size.lg, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  priceEditBtn: {
    flexDirection: 'row', alignItems: 'center',
    borderRadius: Radius.sm, paddingHorizontal: 6, paddingVertical: 3,
    backgroundColor: Colors.surfaceHighlight,
  },
  priceEditRow: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.surfaceElevated, borderRadius: Radius.sm,
    borderWidth: 1.5, borderColor: Colors.gold,
    paddingLeft: 8, paddingRight: 3, paddingVertical: 4,
    minWidth: 120,
  },
  priceCurrency: { fontSize: Typography.size.base, fontWeight: Typography.weight.bold, color: Colors.gold },
  priceInputField: {
    flex: 1, fontSize: Typography.size.base, fontWeight: Typography.weight.bold,
    color: Colors.textPrimary, paddingVertical: 0, includeFontPadding: false,
    minWidth: 60,
  },

  marginBadge: { backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.sm, paddingHorizontal: 5, paddingVertical: 2 },
  marginText: { fontSize: Typography.size.xs - 1, fontWeight: Typography.weight.semibold },
  statsRow: { flexDirection: 'row', gap: 4, alignItems: 'center', marginLeft: 'auto' as any },
  statChip: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.sm, paddingHorizontal: 4, paddingVertical: 2,
  },
  statChipText: { fontSize: 9, color: Colors.textTertiary, fontWeight: Typography.weight.medium },

  // ── Floor price warning ────────────────────────────────────────────────────
  floorWarningRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.warningDim, borderRadius: Radius.sm,
    paddingHorizontal: 8, paddingVertical: 6,
    borderWidth: 1, borderColor: Colors.warning + '35',
  },
  floorWarningText: { flex: 1, fontSize: 10, color: Colors.warning, lineHeight: 14 },
  floorOverrideBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: Colors.warning + '22', borderRadius: Radius.pill,
    paddingHorizontal: 8, paddingVertical: 4,
    borderWidth: 1, borderColor: Colors.warning + '50',
  },
  floorOverrideBtnText: { fontSize: 9, color: Colors.warning, fontWeight: Typography.weight.bold },

  // ── Shared inline edit buttons ─────────────────────────────────────────────
  editSaveBtn: {
    width: 22, height: 22, borderRadius: Radius.sm,
    backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center',
  },
  editCancelBtn: {
    width: 22, height: 22, borderRadius: Radius.sm,
    backgroundColor: Colors.surfaceHighlight, alignItems: 'center', justifyContent: 'center',
  },

  // ── Shipping row ───────────────────────────────────────────────────────────
  shippingRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  shippingEditRow: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.surfaceElevated, borderRadius: Radius.sm,
    borderWidth: 1, borderColor: Colors.primary, paddingLeft: 6, paddingRight: 3, paddingVertical: 3,
  },
  shippingCurrency: { fontSize: Typography.size.xs, fontWeight: Typography.weight.bold, color: Colors.primary },
  shippingInput: {
    flex: 1, fontSize: Typography.size.xs, color: Colors.textPrimary,
    paddingVertical: 0, includeFontPadding: false,
  },
  shippingValueBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.pill,
    paddingHorizontal: 7, paddingVertical: 3,
  },
  shippingValueText: { fontSize: 10, color: Colors.textTertiary, fontWeight: Typography.weight.medium },
  categoryChip: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: Colors.info + '15', borderRadius: Radius.pill,
    paddingHorizontal: 6, paddingVertical: 2, alignSelf: 'flex-start',
    borderWidth: 1, borderColor: Colors.info + '30',
  },
  categoryChipText: { fontSize: 9, color: Colors.info, fontWeight: Typography.weight.semibold, maxWidth: 160 },
  healthRow: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 4 },
  healthGood: { fontSize: 10, color: Colors.success, fontWeight: Typography.weight.medium },
  healthWarn: { flex: 1, fontSize: 10, color: Colors.warning, lineHeight: 14 },

  // ── Actions ────────────────────────────────────────────────────────────────
  actions: {
    flexDirection: 'row', gap: Spacing.xs, flexWrap: 'wrap',
    paddingTop: Spacing.xs, borderTopWidth: 1, borderTopColor: Colors.surfaceBorder,
  },
  actionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderRadius: Radius.sm, paddingHorizontal: 10, paddingVertical: 6,
  },
  actionBtnPrimary: { backgroundColor: Colors.primary },
  actionBtnPrimaryText: { fontSize: Typography.size.xs, fontWeight: Typography.weight.bold, color: Colors.background },
  actionBtnSecondary: { backgroundColor: Colors.surfaceElevated, borderWidth: 1, borderColor: Colors.surfaceBorder },
  actionBtnEbay: { backgroundColor: Colors.accentDim, borderWidth: 1, borderColor: Colors.accent + '40' },
  actionBtnDanger: { backgroundColor: Colors.dangerDim, borderWidth: 1, borderColor: Colors.danger + '40' },
  actionBtnText: { fontSize: Typography.size.xs, fontWeight: Typography.weight.semibold, color: Colors.textSecondary },
});

// ── Main Screen ───────────────────────────────────────────────────────────────

export default function ListingsTabScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { tenant } = useApp();
  const { showAlert } = useAlert();

  const [listings, setListings] = useState<ListingWithItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeFilter, setActiveFilter] = useState<StatusFilter>('all');
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [endingId, setEndingId] = useState<string | null>(null);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);

  // Bulk submit state
  const [bulkSubmitting, setBulkSubmitting] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ current: number; total: number; failed: number } | null>(null);

  // Progress modal state
  const [progressVisible, setProgressVisible] = useState(false);
  const [progressStep, setProgressStep] = useState<SubmitStep | null>(null);
  const [progressTitle, setProgressTitle] = useState('');
  const [progressFailed, setProgressFailed] = useState(false);

  // Title edit state
  const [editingTitleId, setEditingTitleId] = useState<string | null>(null);
  const [titleInput, setTitleInput] = useState('');
  const [savingTitleId, setSavingTitleId] = useState<string | null>(null);

  // Description edit state
  const [editingDescId, setEditingDescId] = useState<string | null>(null);
  const [descInput, setDescInput] = useState('');
  const [savingDescId, setSavingDescId] = useState<string | null>(null);

  // Price edit state
  const [editingPriceId, setEditingPriceId] = useState<string | null>(null);
  const [priceInput, setPriceInput] = useState('');
  const [savingPriceId, setSavingPriceId] = useState<string | null>(null);

  // Shipping edit state
  const [editingShippingId, setEditingShippingId] = useState<string | null>(null);
  const [shippingInput, setShippingInput] = useState('');
  const [savingShippingId, setSavingShippingId] = useState<string | null>(null);

  // Floor price override state
  const [loweringFloorId, setLoweringFloorId] = useState<string | null>(null);

  // Search & sort state
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('date_desc');
  const [showSortMenu, setShowSortMenu] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!tenant) return;
    if (!silent) setLoading(true);
    const { listings: l } = await getAllListings(
      tenant.id,
      activeFilter === 'all' ? undefined : activeFilter,
    );
    setListings(l);
    if (!silent) setLoading(false);
  }, [tenant?.id, activeFilter]);

  useEffect(() => { load(); }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load(true);
    setRefreshing(false);
  }, [load]);

  // ── Search + sort (client-side, applied to already-loaded listings) ────────
  const filteredAndSorted = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let result = q
      ? listings.filter(
          l =>
            l.title.toLowerCase().includes(q) ||
            l.itemTitle.toLowerCase().includes(q),
        )
      : listings;

    result = [...result].sort((a, b) => {
      const marginA = a.itemAcquiredCost > 0
        ? (a.price - a.itemAcquiredCost) / a.price
        : 0;
      const marginB = b.itemAcquiredCost > 0
        ? (b.price - b.itemAcquiredCost) / b.price
        : 0;

      switch (sortBy) {
        case 'date_desc':   return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
        case 'date_asc':    return new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
        case 'price_desc':  return b.price - a.price;
        case 'price_asc':   return a.price - b.price;
        case 'margin_desc': return marginB - marginA;
        case 'margin_asc':  return marginA - marginB;
        default:            return 0;
      }
    });

    return result;
  }, [listings, searchQuery, sortBy]);

  // ── Counts per filter ──────────────────────────────────────────────────────
  const countsByStatus = listings.reduce<Record<string, number>>((acc, l) => {
    acc[l.status] = (acc[l.status] ?? 0) + 1;
    return acc;
  }, {});
  const totalCount = listings.length;

  // ── Submit ─────────────────────────────────────────────────────────────────
  const handleSubmit = useCallback(async (listing: ListingWithItem) => {
    if (!tenant) return;
    const { controls } = await getAutonomyControls(tenant.id);
    const permission = isActionPermitted(controls, 'publishing');
    if (!permission.permitted) {
      showAlert('Publishing Paused', permission.reason ?? 'Publishing is paused in Settings.');
      return;
    }

    // Pre-flight: category must be set — do a fresh DB read in case it was saved
    // after this screen loaded (e.g. via listing editor)
    const supabase = getSupabaseClient();
    const { data: freshCatRow } = await supabase
      .from('listings')
      .select('category_id, items(attributes, specialist_id)')
      .eq('id', listing.id)
      .maybeSingle();

    // Specialist → default eBay UK category fallback (avoids blocking submission
    // for listings that were created before category was explicitly selected)
    const SPECIALIST_DEFAULT_CAT: Record<string, string> = {
      coins_uk: '4726', coins_currency: '4726', coins_world: '40714',
      stamps: '261', pokemon: '183454', trading_cards: '183454',
      militaria: '13956', watches: '14324', jewellery_gold_silver: '50',
      curiosities_collectibles: '1469', antique_furniture: '20091',
      books_rare: '261186',
    };
    const specialistId = (freshCatRow?.items as any)?.specialist_id ?? '';
    const specialistFallback = SPECIALIST_DEFAULT_CAT[specialistId] ?? '1469';

    const storedCat = freshCatRow?.category_id
      ?? (freshCatRow?.items as any)?.attributes?.ebay_category_id
      ?? listing.categoryId
      ?? specialistFallback;

    // If category was resolved via fallback, persist it to DB now so the edge
    // function can find it without re-deriving
    if (!freshCatRow?.category_id && storedCat) {
      await supabase
        .from('listings')
        .update({ category_id: storedCat, updated_at: new Date().toISOString() })
        .eq('id', listing.id)
        .eq('tenant_id', tenant.id);
    }

    // Pre-flight: business policies must be selected
    const { data: connRow } = await supabase
      .from('marketplace_connectors')
      .select('selected_fulfillment_policy_id, selected_return_policy_id, status')
      .eq('tenant_id', tenant.id)
      .eq('marketplace_id', 'ebay')
      .maybeSingle();
    if (!connRow || connRow.status !== 'connected') {
      showAlert('eBay Not Connected', 'Re-authorise eBay in Marketplaces.', [{ text: 'Open Marketplaces', onPress: () => router.push('/marketplaces' as any) }, { text: 'Cancel', style: 'cancel' }]);
      return;
    }
    if (!connRow.selected_fulfillment_policy_id || !connRow.selected_return_policy_id) {
      showAlert(
        'Policies Not Set',
        'Go to Settings → eBay Connection → Load Policies and select your fulfillment and return policies before submitting.',
        [{ text: 'Settings', onPress: () => router.push('/settings' as any) }, { text: 'Cancel', style: 'cancel' }]
      );
      return;
    }

    setSubmittingId(listing.id);
    setProgressTitle(listing.title);
    setProgressStep('verifying');
    setProgressFailed(false);
    setProgressVisible(true);

    const result = await submitListingToMarketplace(
      tenant.id,
      listing.id,
      (step) => setProgressStep(step),
    );

    if (result.success) {
      setProgressStep('done');
      setListings(prev => prev.map(l =>
        l.id === listing.id
          ? {
              ...l,
              status: 'active',
              publishedAt: result.publishedAt,
              externalListingId: result.externalListingId ?? l.externalListingId,
            }
          : l,
      ));
      await recordCapitalTransaction(tenant.id, {
        type: 'sale_revenue',
        amount: listing.price * 0.8725,
        description: `Listed on ${listing.marketplaceId.toUpperCase()}: ${listing.title.slice(0, 60)}`,
        entityType: 'listing',
        entityId: listing.id,
      });
      // Hold modal on done briefly, then dismiss
      await new Promise(r => setTimeout(r, 1400));
      setProgressVisible(false);
      setSubmittingId(null);
      showAlert('Published', `Listing is now live at £${listing.price.toFixed(2)}`);
    } else {
      setProgressFailed(true);
      await new Promise(r => setTimeout(r, 800));
      setProgressVisible(false);
      setSubmittingId(null);
      showAlert(
        'Cannot Publish',
        result.failureReasons?.join('\n') ?? result.error ?? 'Verification failed.',
      );
    }
  }, [tenant, showAlert]);

  // ── End ────────────────────────────────────────────────────────────────────
  const handleEnd = useCallback(async (listing: ListingWithItem) => {
    const isLive = listing.status === 'active' && listing.externalListingId;
    showAlert(
      'End Listing',
      isLive
        ? `This will remove listing #${listing.externalListingId} from eBay immediately. Continue?`
        : `Remove from ${listing.marketplaceId.toUpperCase()} and return "${listing.itemTitle}" to Identified status?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'End Listing',
          style: 'destructive',
          onPress: async () => {
            setEndingId(listing.id);
            const { error } = await endListing(
              listing.id,
              listing.itemId,
              tenant?.id,
              listing.externalListingId,
            );
            setEndingId(null);
            if (error) { showAlert('Error', error); return; }
            setListings(prev => prev.map(l =>
              l.id === listing.id ? { ...l, status: 'ended', endedAt: new Date().toISOString() } : l,
            ));
            showAlert('Ended', isLive ? `eBay listing #${listing.externalListingId} removed.` : 'Item is back to Identified status and ready to relist.');
          },
        },
      ],
    );
  }, [tenant?.id, showAlert]);

  // ── Title edit ─────────────────────────────────────────────────────────────
  const handleEditTitle = useCallback((listing: ListingWithItem) => {
    setTitleInput(listing.title);
    setEditingTitleId(listing.id);
    setEditingDescId(null);
    setEditingPriceId(null);
    setEditingShippingId(null);
  }, []);

  const handleCancelTitle = useCallback(() => {
    setEditingTitleId(null);
    setTitleInput('');
  }, []);

  const handleSaveTitle = useCallback(async (listing: ListingWithItem) => {
    const trimmed = titleInput.trim();
    if (!trimmed) {
      showAlert('Invalid Title', 'Listing title cannot be empty.');
      return;
    }
    if (trimmed.length > 80) {
      showAlert('Title Too Long', 'eBay listing titles must be 80 characters or fewer.');
      return;
    }
    setSavingTitleId(listing.id);
    const { error } = await updateListingTitle(listing.id, trimmed);
    setSavingTitleId(null);
    if (error) { showAlert('Save Failed', error); return; }
    setListings(prev => prev.map(l =>
      l.id === listing.id ? { ...l, title: trimmed } : l,
    ));
    setEditingTitleId(null);
    setTitleInput('');
  }, [titleInput, showAlert]);

  // ── Description edit ───────────────────────────────────────────────────────
  const handleEditDesc = useCallback((listing: ListingWithItem) => {
    setDescInput(listing.description ?? '');
    setEditingDescId(listing.id);
    setEditingTitleId(null);
    setEditingPriceId(null);
    setEditingShippingId(null);
  }, []);

  const handleCancelDesc = useCallback(() => {
    setEditingDescId(null);
    setDescInput('');
  }, []);

  const handleSaveDesc = useCallback(async (listing: ListingWithItem) => {
    const trimmed = descInput.trim();
    if (!trimmed) {
      showAlert('Invalid Description', 'Listing description cannot be empty.');
      return;
    }
    setSavingDescId(listing.id);
    const { error } = await updateListingDescription(listing.id, trimmed);
    setSavingDescId(null);
    if (error) { showAlert('Save Failed', error); return; }
    setListings(prev => prev.map(l =>
      l.id === listing.id ? { ...l, description: trimmed } : l,
    ));
    setEditingDescId(null);
    setDescInput('');
  }, [descInput, showAlert]);

  // ── Price edit ─────────────────────────────────────────────────────────────
  const handleEditPrice = useCallback((listing: ListingWithItem) => {
    setPriceInput(listing.price.toFixed(2));
    setEditingPriceId(listing.id);
    setEditingShippingId(null);
    setEditingTitleId(null);
    setEditingDescId(null);
  }, []);

  const handleCancelPrice = useCallback(() => {
    setEditingPriceId(null);
    setPriceInput('');
  }, []);

  const handleSavePrice = useCallback(async (listing: ListingWithItem) => {
    const val = parseFloat(priceInput);
    if (isNaN(val) || val <= 0) {
      showAlert('Invalid Price', 'Enter a valid selling price greater than £0.');
      return;
    }
    setSavingPriceId(listing.id);
    const { error } = await updateListingPrice(listing.id, val);
    setSavingPriceId(null);
    if (error) { showAlert('Save Failed', error); return; }
    setListings(prev => prev.map(l =>
      l.id === listing.id ? { ...l, price: val } : l,
    ));
    setEditingPriceId(null);
    setPriceInput('');
  }, [priceInput, showAlert]);

  // ── Floor price override — lower floor to match current listing price ───────
  const handleLowerFloorPrice = useCallback(async (listing: ListingWithItem) => {
    setLoweringFloorId(listing.id);
    const { error } = await updateListingFloorPrice(listing.id, listing.price);
    setLoweringFloorId(null);
    if (error) { showAlert('Failed', error); return; }
    setListings(prev => prev.map(l =>
      l.id === listing.id ? { ...l, floorPrice: listing.price } : l,
    ));
  }, [showAlert]);

  // ── Shipping edit ──────────────────────────────────────────────────────────
  const handleEditShipping = useCallback((listing: ListingWithItem) => {
    setShippingInput(String(listing.shippingCost ?? 0));
    setEditingShippingId(listing.id);
    setEditingPriceId(null);
    setEditingTitleId(null);
    setEditingDescId(null);
  }, []);

  const handleCancelShipping = useCallback(() => {
    setEditingShippingId(null);
    setShippingInput('');
  }, []);

  const handleSaveShipping = useCallback(async (listing: ListingWithItem) => {
    const val = parseFloat(shippingInput);
    if (isNaN(val) || val < 0) {
      showAlert('Invalid Amount', 'Enter a valid shipping cost (0 for free shipping).');
      return;
    }
    setSavingShippingId(listing.id);
    const { error } = await updateListingShipping(listing.id, val);
    setSavingShippingId(null);
    if (error) { showAlert('Save Failed', error); return; }
    setListings(prev => prev.map(l =>
      l.id === listing.id ? { ...l, shippingCost: val } : l,
    ));
    setEditingShippingId(null);
    setShippingInput('');
  }, [shippingInput, showAlert]);

  // ── Submit All Drafts ────────────────────────────────────────────────────────
  const handleSubmitAllDrafts = useCallback(async () => {
    if (!tenant) return;

    const drafts = listings.filter(
      l => l.status === 'draft' || l.status === 'needs_correction',
    );
    if (drafts.length === 0) {
      showAlert('No Drafts', 'There are no draft listings to submit.');
      return;
    }

    const { controls } = await getAutonomyControls(tenant.id);
    const permission = isActionPermitted(controls, 'publishing');
    if (!permission.permitted) {
      showAlert('Publishing Paused', permission.reason ?? 'Publishing is paused in Settings.');
      return;
    }

    showAlert(
      `Submit ${drafts.length} Draft${drafts.length === 1 ? '' : 's'}`,
      `Submit all ${drafts.length} draft listing${drafts.length === 1 ? '' : 's'} to eBay sequentially? This may take a moment.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Submit All',
          onPress: async () => {
            setBulkSubmitting(true);
            setBulkProgress({ current: 0, total: drafts.length, failed: 0 });

            let succeeded = 0;
            let failed = 0;
            const failedTitles: string[] = [];

            for (let i = 0; i < drafts.length; i++) {
              const listing = drafts[i];
              setBulkProgress({ current: i + 1, total: drafts.length, failed });

              const result = await submitListingToMarketplace(tenant.id, listing.id, () => {});

              if (result.success) {
                succeeded++;
                setListings(prev => prev.map(l =>
                  l.id === listing.id
                    ? {
                        ...l,
                        status: 'active',
                        publishedAt: result.publishedAt,
                        externalListingId: result.externalListingId ?? l.externalListingId,
                      }
                    : l,
                ));
                await recordCapitalTransaction(tenant.id, {
                  type: 'sale_revenue',
                  amount: listing.price * 0.8725,
                  description: `Listed on ${listing.marketplaceId.toUpperCase()}: ${listing.title.slice(0, 60)}`,
                  entityType: 'listing',
                  entityId: listing.id,
                });
              } else {
                failed++;
                failedTitles.push(listing.title.slice(0, 40));
              }

              setBulkProgress({ current: i + 1, total: drafts.length, failed });
            }

            setBulkSubmitting(false);
            setBulkProgress(null);

            if (failed === 0) {
              showAlert(
                'All Submitted',
                `${succeeded} listing${succeeded === 1 ? '' : 's'} published to eBay successfully.`,
              );
            } else {
              showAlert(
                'Batch Complete',
                `${succeeded} submitted, ${failed} failed.\n\nFailed:\n${failedTitles.map(t => `• ${t}`).join('\n')}`,
              );
            }
          },
        },
      ],
    );
  }, [tenant, listings, showAlert]);

  // ── Refresh stats ──────────────────────────────────────────────────────────
  const handleRefreshStats = useCallback(async (listing: ListingWithItem) => {
    if (!tenant || !listing.externalListingId) return;
    setRefreshingId(listing.id);
    const { views, watchers, error } = await refreshListingStats(
      tenant.id, listing.id, listing.externalListingId,
    );
    setRefreshingId(null);
    if (error) { showAlert('Stats Unavailable', error); return; }
    setListings(prev => prev.map(l => l.id === listing.id ? { ...l, views, watchers } : l));
  }, [tenant, showAlert]);

  // ── Summary stats ──────────────────────────────────────────────────────────
  const liveCount = listings.filter(l => l.status === 'active').length;
  const draftCount = listings.filter(l => l.status === 'draft' || l.status === 'needs_correction').length;
  const totalLiveValue = listings
    .filter(l => l.status === 'active')
    .reduce((sum, l) => sum + l.price, 0);

  return (
    <View style={s.container}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={[s.header, { paddingTop: insets.top + Spacing.base }]}>
        <View style={s.flex}>
          <Text style={s.title}>Listings</Text>
          {bulkProgress ? (
            <View style={s.bulkProgressRow}>
              <ActivityIndicator size="small" color={Colors.primary} style={{ width: 12, height: 12 }} />
              <Text style={s.bulkProgressText}>
                Submitting {bulkProgress.current}/{bulkProgress.total}
                {bulkProgress.failed > 0 ? ` · ${bulkProgress.failed} failed` : ''}
              </Text>
            </View>
          ) : (
            <Text style={s.subtitle}>{totalCount} total · {liveCount} live</Text>
          )}
        </View>
        {draftCount > 0 && !bulkSubmitting ? (
          <Pressable
            onPress={handleSubmitAllDrafts}
            style={({ pressed }) => [s.submitAllBtn, pressed && { opacity: 0.85 }]}
            hitSlop={4}
          >
            <MaterialIcons name="send" size={13} color={Colors.background} />
            <Text style={s.submitAllText}>Submit All ({draftCount})</Text>
          </Pressable>
        ) : null}
        <Pressable onPress={onRefresh} disabled={bulkSubmitting} style={[s.iconBtn, bulkSubmitting && { opacity: 0.4 }]} hitSlop={8}>
          <MaterialIcons name="refresh" size={18} color={Colors.textSecondary} />
        </Pressable>
        <Pressable onPress={() => router.push('/settings' as any)} style={s.iconBtn} hitSlop={8}>
          <MaterialIcons name="settings" size={18} color={Colors.textSecondary} />
        </Pressable>
      </View>

      {/* Search + Sort bar */}
      <View style={s.searchRow}>
        <View style={s.searchInputWrap}>
          <MaterialIcons name="search" size={16} color={Colors.textTertiary} style={{ marginLeft: Spacing.sm }} />
          <TextInput
            style={s.searchInput}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search by title..."
            placeholderTextColor={Colors.textTertiary}
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
          {searchQuery.length > 0 ? (
            <Pressable onPress={() => setSearchQuery('')} hitSlop={8} style={{ marginRight: Spacing.sm }}>
              <MaterialIcons name="close" size={14} color={Colors.textTertiary} />
            </Pressable>
          ) : null}
        </View>
        <Pressable
          onPress={() => setShowSortMenu(true)}
          style={({ pressed }) => [s.sortBtn, sortBy !== 'date_desc' && s.sortBtnActive, pressed && { opacity: 0.8 }]}
          hitSlop={4}
        >
          <MaterialIcons
            name="sort"
            size={14}
            color={sortBy !== 'date_desc' ? Colors.primary : Colors.textSecondary}
          />
          <Text style={[s.sortBtnText, sortBy !== 'date_desc' && { color: Colors.primary }]}>
            {SORT_LABELS[sortBy]}
          </Text>
        </Pressable>
      </View>

      {/* Summary strip */}
      {totalCount > 0 ? (
        <View style={s.summaryStrip}>
          <View style={s.summaryStat}>
            <Text style={[s.summaryValue, { color: Colors.success }]}>{liveCount}</Text>
            <Text style={s.summaryLabel}>Live</Text>
          </View>
          <View style={s.summaryStat}>
            <Text style={[s.summaryValue, { color: Colors.textTertiary }]}>{draftCount}</Text>
            <Text style={s.summaryLabel}>Draft</Text>
          </View>
          <View style={s.summaryStat}>
            <Text style={[s.summaryValue, { color: Colors.gold }]}>
              £{totalLiveValue.toFixed(0)}
            </Text>
            <Text style={s.summaryLabel}>Live GMV</Text>
          </View>
        </View>
      ) : null}

      {/* Filter bar */}
      <View style={s.filterOuter}>
        <FlatList
          data={FILTER_OPTIONS}
          horizontal
          showsHorizontalScrollIndicator={false}
          keyExtractor={f => f.id}
          contentContainerStyle={s.filterContent}
          renderItem={({ item: f }) => {
            const isActive = activeFilter === f.id;
            const cnt = f.id === 'all' ? totalCount : (countsByStatus[f.id] ?? 0);
            return (
              <Pressable
                onPress={() => setActiveFilter(f.id)}
                style={[s.filterChip, isActive && s.filterChipActive]}
              >
                <MaterialIcons
                  name={f.icon as any}
                  size={11}
                  color={isActive ? Colors.primary : Colors.textTertiary}
                />
                <Text style={[s.filterLabel, isActive && s.filterLabelActive]}>{f.label}</Text>
                {cnt > 0 ? (
                  <View style={[s.filterBadge, isActive && s.filterBadgeActive]}>
                    <Text style={[s.filterBadgeText, isActive && { color: Colors.primary }]}>{cnt}</Text>
                  </View>
                ) : null}
              </Pressable>
            );
          }}
        />
      </View>

      {/* Sort menu modal */}
      <Modal visible={showSortMenu} transparent animationType="fade">
        <Pressable style={s.sortOverlay} onPress={() => setShowSortMenu(false)}>
          <View style={s.sortMenu}>
            <Text style={s.sortMenuTitle}>Sort Listings</Text>
            {SORT_OPTIONS.map(opt => (
              <Pressable
                key={opt.id}
                onPress={() => { setSortBy(opt.id); setShowSortMenu(false); }}
                style={({ pressed }) => [
                  s.sortMenuItem,
                  sortBy === opt.id && s.sortMenuItemActive,
                  pressed && { opacity: 0.8 },
                ]}
              >
                <MaterialIcons
                  name={opt.icon as any}
                  size={16}
                  color={sortBy === opt.id ? Colors.primary : Colors.textTertiary}
                />
                <Text style={[s.sortMenuLabel, sortBy === opt.id && { color: Colors.primary, fontWeight: Typography.weight.semibold }]}>
                  {opt.label}
                </Text>
                {sortBy === opt.id ? (
                  <MaterialIcons name="check" size={14} color={Colors.primary} style={{ marginLeft: 'auto' as any }} />
                ) : null}
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>

      {loading ? (
        <View style={s.loading}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : filteredAndSorted.length === 0 ? (
        <View style={s.empty}>
          <MaterialIcons name="receipt-long" size={48} color={Colors.textTertiary} />
          <Text style={s.emptyTitle}>
            {searchQuery ? 'No results' : 'No listings found'}
          </Text>
          <Text style={s.emptyText}>
            {searchQuery
              ? `No listings match "${searchQuery}". Try a different search.`
              : activeFilter === 'all'
                ? 'Generate a listing from an item detail screen.'
                : `No ${activeFilter} listings at the moment.`}
          </Text>
        </View>
      ) : (
        <FlatList
          data={filteredAndSorted}
          keyExtractor={l => l.id}
          contentContainerStyle={[s.list, { paddingBottom: insets.bottom + 90 }]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />
          }
          renderItem={({ item: listing, index }) => (
            <ListingRow
              listing={listing}
              onSubmit={handleSubmit}
              onEnd={handleEnd}
              onRefreshStats={handleRefreshStats}
              onSaveShipping={handleSaveShipping}
              onSavePrice={handleSavePrice}
              onSaveTitle={handleSaveTitle}
              onSaveDesc={handleSaveDesc}
              onLowerFloorPrice={handleLowerFloorPrice}
              submittingId={submittingId}
              endingId={endingId}
              refreshingId={refreshingId}
              editingShippingId={editingShippingId}
              shippingInput={shippingInput}
              onEditShipping={handleEditShipping}
              onShippingChange={setShippingInput}
              onCancelShipping={handleCancelShipping}
              savingShippingId={savingShippingId}
              editingPriceId={editingPriceId}
              priceInput={priceInput}
              onEditPrice={handleEditPrice}
              onPriceChange={setPriceInput}
              onCancelPrice={handleCancelPrice}
              savingPriceId={savingPriceId}
              editingTitleId={editingTitleId}
              titleInput={titleInput}
              onEditTitle={handleEditTitle}
              onTitleChange={setTitleInput}
              onCancelTitle={handleCancelTitle}
              savingTitleId={savingTitleId}
              editingDescId={editingDescId}
              descInput={descInput}
              onEditDesc={handleEditDesc}
              onDescChange={setDescInput}
              onCancelDesc={handleCancelDesc}
              savingDescId={savingDescId}
              loweringFloorId={loweringFloorId}
              hasTVPreferredFocus={index === 0}
            />
          )}
          ItemSeparatorComponent={() => <View style={{ height: Spacing.sm }} />}
        />
      )}

      {/* Submit Progress Modal */}
      <SubmitProgressModal
        visible={progressVisible}
        currentStep={progressStep}
        listingTitle={progressTitle}
        failed={progressFailed}
      />
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
  title: { fontSize: Typography.size.xl, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  subtitle: { fontSize: Typography.size.xs, color: Colors.textTertiary, marginTop: 2 },
  bulkProgressRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3 },
  bulkProgressText: { fontSize: Typography.size.xs, color: Colors.primary, fontWeight: Typography.weight.semibold },
  submitAllBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.primary, borderRadius: Radius.md,
    paddingHorizontal: Spacing.md, paddingVertical: 7,
  },
  submitAllText: { fontSize: Typography.size.xs, fontWeight: Typography.weight.bold, color: Colors.background },
  iconBtn: {
    width: 36, height: 36, borderRadius: Radius.md,
    backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.surfaceBorder,
  },

  summaryStrip: {
    flexDirection: 'row', paddingHorizontal: Spacing.base, paddingVertical: Spacing.sm,
    borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder,
  },
  summaryStat: { flex: 1, alignItems: 'center', gap: 2 },
  summaryValue: { fontSize: Typography.size.lg, fontWeight: Typography.weight.bold },
  summaryLabel: { fontSize: Typography.size.xs - 1, color: Colors.textTertiary },

  filterOuter: {
    borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder,
    backgroundColor: Colors.surface,
  },
  filterContent: {
    flexDirection: 'row', gap: Spacing.xs,
    paddingHorizontal: Spacing.base, paddingVertical: Spacing.sm,
  },
  filterChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: Spacing.md, paddingVertical: 6, borderRadius: Radius.pill,
    backgroundColor: Colors.surfaceHighlight,
  },
  filterChipActive: { backgroundColor: Colors.primaryDim },
  filterLabel: { fontSize: Typography.size.xs, color: Colors.textTertiary, fontWeight: Typography.weight.medium },
  filterLabelActive: { color: Colors.primary, fontWeight: Typography.weight.semibold },
  filterBadge: {
    minWidth: 16, height: 16, borderRadius: Radius.pill,
    backgroundColor: Colors.surfaceBorder, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3,
  },
  filterBadgeActive: { backgroundColor: Colors.primary + '30' },
  filterBadgeText: { fontSize: 9, fontWeight: Typography.weight.bold, color: Colors.textTertiary },

  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: Spacing.base },
  empty: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    gap: Spacing.md, paddingHorizontal: Spacing.xl,
  },
  emptyTitle: { fontSize: Typography.size.lg, fontWeight: Typography.weight.semibold, color: Colors.textSecondary },
  emptyText: { fontSize: Typography.size.sm, color: Colors.textTertiary, textAlign: 'center', lineHeight: 20 },

  // ── Search + Sort ──────────────────────────────────────────────────────────
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingHorizontal: Spacing.base, paddingVertical: Spacing.sm,
    borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder,
    backgroundColor: Colors.surface,
  },
  searchInputWrap: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.surfaceHighlight,
    borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.surfaceBorder,
    height: 36, gap: 4,
  },
  searchInput: {
    flex: 1, fontSize: Typography.size.sm, color: Colors.textPrimary,
    paddingVertical: 0, paddingHorizontal: Spacing.xs,
    includeFontPadding: false,
  },
  sortBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    height: 36, paddingHorizontal: Spacing.sm, borderRadius: Radius.md,
    backgroundColor: Colors.surfaceHighlight, borderWidth: 1, borderColor: Colors.surfaceBorder,
  },
  sortBtnActive: {
    backgroundColor: Colors.primaryDim, borderColor: Colors.primary + '60',
  },
  sortBtnText: {
    fontSize: Typography.size.xs, color: Colors.textSecondary,
    fontWeight: Typography.weight.medium,
  },

  // ── Sort modal ─────────────────────────────────────────────────────────────
  sortOverlay: {
    flex: 1, backgroundColor: Colors.overlay80,
    justifyContent: 'flex-end',
  },
  sortMenu: {
    backgroundColor: Colors.surfaceElevated,
    borderTopLeftRadius: Radius.xxl, borderTopRightRadius: Radius.xxl,
    padding: Spacing.lg, paddingBottom: Spacing.xl,
    borderTopWidth: 1, borderColor: Colors.surfaceBorder,
    gap: 4,
  },
  sortMenuTitle: {
    fontSize: Typography.size.base, fontWeight: Typography.weight.bold,
    color: Colors.textPrimary, paddingBottom: Spacing.sm,
    borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder, marginBottom: Spacing.xs,
  },
  sortMenuItem: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingVertical: Spacing.md, paddingHorizontal: Spacing.sm,
    borderRadius: Radius.md,
  },
  sortMenuItemActive: { backgroundColor: Colors.primaryDim },
  sortMenuLabel: {
    fontSize: Typography.size.sm, color: Colors.textSecondary,
    flex: 1,
  },
});
