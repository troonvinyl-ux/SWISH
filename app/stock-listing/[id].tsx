// SWISH Stock Listing Overview Screen — v4 (UX Refactor)
//
// THREE-LAYER DATA MODEL:
//   A. INVENTORY: what the user physically owns (photos, SKU, storage, cost, notes)
//   B. SWISH INTELLIGENCE: what AI has determined (identification, evidence, valuation)
//   C. MARKETPLACE LISTING: what is actually being sold (title, category, price, delivery)
//
// LAYOUT:
//   Photos → Title/Status → Listing Details → Pricing → Delivery →
//   SWISH Intelligence (expandable) → Inventory → Actions
//
// PRICING CONCEPTS (deliberately separated):
//   - Market Value: SWISH estimate from evidence
//   - Suggested Listing Price: SWISH recommendation
//   - Actual Listing Price: user's chosen price on eBay
//   These are NEVER conflated. Unknown ≠ £0.

import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, FlatList,
  TextInput, ActivityIndicator, Modal, Dimensions, Platform, Share, Linking,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library';
import * as FileSystem from 'expo-file-system';
import { GestureHandlerRootView, GestureDetector, Gesture } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue, useAnimatedStyle, withSpring, withTiming,
  runOnJS, clamp,
} from 'react-native-reanimated';
import { Colors, Typography, Spacing, Radius, Shadow } from '@/constants/theme';
import { useApp } from '@/hooks/useApp';
import { getSupabaseClient } from '@/template';
import { useAlert } from '@/template';
import { Item, getItem, updateItem } from '@/services/itemService';
import { getItemListings, updateListingPrice, endListing, deleteListing, submitListingToMarketplace, updateListingStatus } from '@/services/listingService';
import type { SubmitStep } from '@/services/listingService';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { generateListing, saveListing } from '@/services/listingService';
import type { SavedListing } from '@/services/listingService';
import {
  CapturedImage,
  identifyItemWithAI,
  uploadItemImages,
  updateItemMedia,
  captureFromCamera,
  pickFromLibrary,
} from '@/services/aiIdentificationService';
import {
  recordAIFeedback,
  FeedbackVerdict,
  ErrorCategory,
} from '@/services/aiLearningService';
import { SPECIALISTS } from '@/constants/specialists';
import { getMarketValue, MarketValueResult } from '@/services/marketValueService';
import {
  searchEbayByImage,
  EbayVisualSearchResult,
  formatAskingPriceRange,
} from '@/services/ebayVisualSearchService';
import {
  computeItemCommercialIntelligence,
  type ItemCommercialIntelligence,
} from '@/services/commercialEngine';
import { CommercialIntelligenceCard } from '@/components/feature/CommercialIntelligenceCard';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const GALLERY_HEIGHT = 320;
const THUMB_SIZE = 60;
const THUMB_GAP = 6;
const SLIDE_WIDTH = SCREEN_WIDTH;
const MAX_ZOOM = 4;
const MIN_ZOOM = 1;
const FS_MAX_ZOOM = 6;

const ERROR_CATEGORY_OPTIONS: Array<{ value: ErrorCategory; label: string }> = [
  { value: 'wrong_identity',     label: 'Wrong coin / item identity' },
  { value: 'wrong_date',         label: 'Wrong year / date' },
  { value: 'wrong_ruler',        label: 'Wrong ruler / monarch' },
  { value: 'wrong_denomination', label: 'Wrong denomination' },
  { value: 'wrong_country',      label: 'Wrong country' },
  { value: 'wrong_condition',    label: 'Wrong condition / grade' },
  { value: 'wrong_material',     label: 'Wrong material / composition' },
  { value: 'wrong_valuation',    label: 'Wrong valuation' },
  { value: 'other',              label: 'Other error' },
];

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/** Format a monetary value — returns null if value is 0 or falsy */
function formatMoney(value: number | undefined | null): string | null {
  if (!value || value === 0) return null;
  return `£${value.toFixed(2)}`;
}

/** Canonical attribute key — maps duplicate AI keys to a single display name */
const CANONICAL_ATTR_NAMES: Record<string, string> = {
  // Identity
  'ruler': 'Ruler',
  'monarch': 'Ruler',
  'Ruler': 'Ruler',
  'Monarch': 'Ruler',
  'Inferred Ruler': 'Ruler',
  'Ruler Depicted': 'Ruler',
  'ruler_depicted': 'Ruler',
  'inferred_ruler': 'Ruler',
  'inferred_monarch': 'Ruler',
  // Material
  'material': 'Material',
  'material_type': 'Material',
  'Material Type': 'Material',
  'composition': 'Material',
  'metal': 'Material',
  // Event
  'event': 'Event / Subject',
  'event_commemorated': 'Event / Subject',
  'Event Commemorated': 'Event / Subject',
  'Inferred Event': 'Event / Subject',
  'subject': 'Event / Subject',
  // Date
  'year': 'Year',
  'year_made': 'Year',
  'date': 'Year',
  // Country
  'country': 'Country',
  'country_of_origin': 'Country',
  'origin': 'Country',
};

const ATTR_BLACKLIST = new Set([
  'has_hole', 'has_alteration', 'object_type', 'identification_state', 'alteration_notes',
  'numista_type_id', 'numista_candidate_id', 'numista_status', 'numista_match_score',
  'numista_n', 'numista_url', 'numista_candidate_score', 'numista_catalogue_suggestions',
  'ebay_category_id', 'ebay_category_name',
  'identification_confidence', 'valuation_confidence',
]);

/** De-duplicate and canonicalize AI attributes for display */
function canonicalizeAttributes(attributes: Record<string, any>): Array<{ key: string; value: string }> {
  const seen = new Map<string, string>(); // canonical name → value

  for (const [rawKey, rawVal] of Object.entries(attributes)) {
    if (ATTR_BLACKLIST.has(rawKey)) continue;
    if (rawVal === null || rawVal === undefined || String(rawVal).trim() === '') continue;
    if (String(rawVal) === '0' || String(rawVal) === 'false') continue;

    const canonName = CANONICAL_ATTR_NAMES[rawKey] ?? rawKey.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const value = String(rawVal).trim();

    // Only keep first occurrence of a canonical name
    if (!seen.has(canonName)) {
      seen.set(canonName, value);
    }
  }

  return Array.from(seen.entries()).map(([key, value]) => ({ key, value }));
}

// ─────────────────────────────────────────────────────────────────────────────
// MX CONDITION GRADER
// ─────────────────────────────────────────────────────────────────────────────

const MX_CONDITION_GRADES: Array<{
  grade: string;
  label: string;
  description: string;
  color: string;
  icon: string;
}> = [
  { grade: 'Excellent',  label: 'Excellent',  description: 'Show-ready — minimal wear, looks great',           color: '#16A34A', icon: 'workspace-premium' },
  { grade: 'Good',       label: 'Good',       description: 'Fully running, minor cosmetic wear',               color: '#22C55E', icon: 'thumb-up' },
  { grade: 'Fair',       label: 'Fair',       description: 'Running but needs attention — worn, used hard',    color: '#F59E0B', icon: 'build' },
  { grade: 'Project',    label: 'Project',    description: 'Non-running or incomplete — needs significant work', color: '#EF4444', icon: 'construction' },
  { grade: 'Parts Only', label: 'Parts Only', description: 'For breaking — not rideable',                      color: '#6B7280', icon: 'settings' },
];

function MXConditionGrader({
  currentGrade,
  onGradeSelect,
  saving,
}: {
  currentGrade: string;
  onGradeSelect: (grade: string) => void;
  saving: boolean;
}) {
  return (
    <View style={mxcg.container}>
      <View style={mxcg.headerRow}>
        <MaterialIcons name="two-wheeler" size={13} color="#EF4444" />
        <Text style={mxcg.headerLabel}>MX CONDITION GRADE</Text>
        {saving ? (
          <ActivityIndicator size="small" color={Colors.primary} style={{ width: 12, height: 12 }} />
        ) : null}
      </View>
      <View style={mxcg.grid}>
        {MX_CONDITION_GRADES.map(opt => {
          const isSelected = currentGrade === opt.grade;
          return (
            <Pressable
              key={opt.grade}
              onPress={() => onGradeSelect(opt.grade)}
              disabled={saving}
              style={({ pressed }) => [
                mxcg.chip,
                isSelected && { backgroundColor: opt.color + '18', borderColor: opt.color + '70' },
                pressed && { opacity: 0.75 },
              ]}
            >
              <View style={mxcg.chipHeader}>
                <MaterialIcons
                  name={opt.icon as any}
                  size={13}
                  color={isSelected ? opt.color : Colors.textTertiary}
                />
                <Text style={[mxcg.chipLabel, isSelected && { color: opt.color }]}>
                  {opt.label}
                </Text>
                {isSelected ? (
                  <MaterialIcons
                    name="check-circle"
                    size={12}
                    color={opt.color}
                    style={{ marginLeft: 'auto' as any }}
                  />
                ) : null}
              </View>
              <Text
                style={[mxcg.chipDesc, isSelected && { color: opt.color + 'BB' }]}
                numberOfLines={2}
              >
                {opt.description}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={mxcg.note}>
        MX grades differ from coin grades — select the grade that best describes this bike&apos;s commercial condition.
      </Text>
    </View>
  );
}

const mxcg = StyleSheet.create({
  container: { gap: Spacing.sm },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  headerLabel: { flex: 1, fontSize: 9, fontWeight: Typography.weight.bold, color: '#EF4444', textTransform: 'uppercase', letterSpacing: 0.5 },
  grid: { gap: Spacing.xs },
  chip: {
    backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.md, padding: Spacing.sm,
    borderWidth: 1.5, borderColor: Colors.surfaceBorder, gap: 3,
  },
  chipHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  chipLabel: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.textPrimary, flex: 1 },
  chipDesc: { fontSize: 11, color: Colors.textTertiary, lineHeight: 15, paddingLeft: 21 },
  note: { fontSize: 9, color: Colors.textTertiary, lineHeight: 13, textAlign: 'center', paddingTop: 2 },
});

// ─────────────────────────────────────────────────────────────────────────────
// STATUS CONFIG
// ─────────────────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  new: Colors.textTertiary, captured: Colors.textTertiary, identified: Colors.success,
  review_required: Colors.danger, priced: Colors.primary, listed: Colors.info,
  active: Colors.success, sold: Colors.accent, held: Colors.warning,
  bundled: Colors.gold, disposed: Colors.textTertiary,
};

// ─────────────────────────────────────────────────────────────────────────────
// FULLSCREEN IMAGE VIEWER
// ─────────────────────────────────────────────────────────────────────────────

function FullscreenZoomableSlide({ uri, width, height }: { uri: string; width: number; height: number }) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);

  const reset = () => {
    'worklet';
    scale.value = withSpring(1, { damping: 15, stiffness: 150 });
    savedScale.value = 1;
    translateX.value = withSpring(0, { damping: 15, stiffness: 150 });
    translateY.value = withSpring(0, { damping: 15, stiffness: 150 });
    savedTranslateX.value = 0;
    savedTranslateY.value = 0;
  };

  const pinch = Gesture.Pinch()
    .onUpdate((e) => { scale.value = clamp(savedScale.value * e.scale, MIN_ZOOM, FS_MAX_ZOOM); })
    .onEnd(() => { savedScale.value = scale.value; if (scale.value <= 1.05) { reset(); } });

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      if (savedScale.value <= 1) return;
      const maxX = (width * (savedScale.value - 1)) / 2;
      const maxY = (height * (savedScale.value - 1)) / 2;
      translateX.value = clamp(savedTranslateX.value + e.translationX, -maxX, maxX);
      translateY.value = clamp(savedTranslateY.value + e.translationY, -maxY, maxY);
    })
    .onEnd(() => { savedTranslateX.value = translateX.value; savedTranslateY.value = translateY.value; })
    .activeOffsetX([-6, 6]).activeOffsetY([-6, 6]);

  const doubleTap = Gesture.Tap().numberOfTaps(2).maxDuration(300).onEnd((e) => {
    if (savedScale.value > 1) { reset(); } else {
      const targetScale = 3;
      const tx = clamp(-(e.x - width / 2) * (targetScale - 1), -(width * (targetScale - 1)) / 2, (width * (targetScale - 1)) / 2);
      const ty = clamp(-(e.y - height / 2) * (targetScale - 1), -(height * (targetScale - 1)) / 2, (height * (targetScale - 1)) / 2);
      scale.value = withSpring(targetScale, { damping: 15, stiffness: 150 });
      savedScale.value = targetScale;
      translateX.value = withSpring(tx, { damping: 15, stiffness: 150 });
      translateY.value = withSpring(ty, { damping: 15, stiffness: 150 });
      savedTranslateX.value = tx;
      savedTranslateY.value = ty;
    }
  });

  const composed = Gesture.Exclusive(doubleTap, Gesture.Simultaneous(pinch, pan));
  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }, { translateX: translateX.value }, { translateY: translateY.value }] }));

  return (
    <GestureDetector gesture={composed}>
      <View style={{ width, height, overflow: 'hidden' }}>
        <Animated.View style={[StyleSheet.absoluteFill, animStyle]}>
          <Image source={{ uri }} style={{ width: '100%', height: '100%' }} contentFit="contain" transition={150} />
        </Animated.View>
      </View>
    </GestureDetector>
  );
}

function FullscreenImageViewer({ media, initialIndex, visible, onClose }: { media: string[]; initialIndex: number; visible: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const [saving, setSaving] = useState(false);
  const flatRef = useRef<FlatList>(null);

  useEffect(() => {
    if (visible) {
      setActiveIndex(initialIndex);
      setTimeout(() => { flatRef.current?.scrollToOffset({ offset: initialIndex * SCREEN_WIDTH, animated: false }); }, 50);
    }
  }, [visible, initialIndex]);

  const handleScroll = useCallback((e: any) => { setActiveIndex(Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH)); }, []);

  const handleSave = useCallback(async () => {
    const uri = media[activeIndex];
    if (!uri) return;
    setSaving(true);
    try {
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== 'granted') { setSaving(false); return; }
      let localUri = uri;
      if (uri.startsWith('http')) {
        const res = await FileSystem.downloadAsync(uri, FileSystem.cacheDirectory + `swish_photo_${Date.now()}.jpg`);
        localUri = res.uri;
      }
      await MediaLibrary.saveToLibraryAsync(localUri);
    } catch {} finally { setSaving(false); }
  }, [media, activeIndex]);

  const handleShare = useCallback(async () => {
    const uri = media[activeIndex];
    if (!uri) return;
    try { await Share.share({ url: uri, message: uri }); } catch {}
  }, [media, activeIndex]);

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <GestureHandlerRootView style={fs.container}>
        <StatusBar style="light" />
        <View style={[fs.topBar, { paddingTop: insets.top + Spacing.sm }]}>
          <Pressable onPress={onClose} style={fs.closeBtn} hitSlop={12}>
            <MaterialIcons name="close" size={22} color="#fff" />
          </Pressable>
          <Text style={fs.counter}>{activeIndex + 1} / {media.length}</Text>
          <View style={{ width: 44 }} />
        </View>
        <FlatList
          ref={flatRef}
          data={media}
          keyExtractor={(_, i) => `fs${i}`}
          horizontal pagingEnabled showsHorizontalScrollIndicator={false}
          scrollEventThrottle={16} onScroll={handleScroll} initialScrollIndex={initialIndex}
          getItemLayout={(_, index) => ({ length: SCREEN_WIDTH, offset: SCREEN_WIDTH * index, index })}
          renderItem={({ item: uri }) => <FullscreenZoomableSlide uri={uri} width={SCREEN_WIDTH} height={SCREEN_HEIGHT} />}
          style={fs.list}
        />
        {media.length > 1 ? (
          <View style={fs.dotsRow}>
            {media.map((_, i) => <View key={i} style={[fs.dot, i === activeIndex && fs.dotActive]} />)}
          </View>
        ) : null}
        <View style={[fs.bottomBar, { paddingBottom: insets.bottom + Spacing.md }]}>
          <Pressable onPress={handleSave} style={({ pressed }) => [fs.actionBtn, pressed && { opacity: 0.75 }]} disabled={saving}>
            {saving ? <ActivityIndicator size="small" color="#fff" /> : <MaterialIcons name="download" size={20} color="#fff" />}
            <Text style={fs.actionBtnText}>{saving ? 'Saving...' : 'Save to Photos'}</Text>
          </Pressable>
          <Pressable onPress={handleShare} style={({ pressed }) => [fs.actionBtn, pressed && { opacity: 0.75 }]}>
            <MaterialIcons name="share" size={20} color="#fff" />
            <Text style={fs.actionBtnText}>Share</Text>
          </Pressable>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const fs = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  list: { flex: 1 },
  topBar: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.base, paddingBottom: Spacing.md, backgroundColor: 'rgba(0,0,0,0.45)' },
  closeBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
  counter: { fontSize: Typography.size.base, fontWeight: Typography.weight.semibold, color: 'rgba(255,255,255,0.9)' },
  dotsRow: { position: 'absolute', bottom: 100, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.35)' },
  dotActive: { backgroundColor: '#fff', width: 18, borderRadius: 3 },
  bottomBar: { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: Spacing.xl, paddingTop: Spacing.md, backgroundColor: 'rgba(0,0,0,0.55)' },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: Radius.md, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
  actionBtnText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: '#fff' },
});

// ─────────────────────────────────────────────────────────────────────────────
// ZOOMABLE SLIDE
// ─────────────────────────────────────────────────────────────────────────────

function ZoomableSlide({ uri, onZoomChange, onOpenFullscreen }: { uri: string; onZoomChange: (isZoomed: boolean) => void; onOpenFullscreen?: () => void; }) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);
  const [isZoomed, setIsZoomed] = useState(false);

  const notifyZoom = useCallback((zoomed: boolean) => { setIsZoomed(zoomed); onZoomChange(zoomed); }, [onZoomChange]);
  const openFullscreen = useCallback(() => { onOpenFullscreen?.(); }, [onOpenFullscreen]);

  const resetZoom = useCallback(() => {
    scale.value = withSpring(1, { damping: 15, stiffness: 150 });
    savedScale.value = 1;
    translateX.value = withSpring(0, { damping: 15, stiffness: 150 });
    translateY.value = withSpring(0, { damping: 15, stiffness: 150 });
    savedTranslateX.value = 0; savedTranslateY.value = 0;
    runOnJS(notifyZoom)(false);
  }, []);

  const pinchGesture = Gesture.Pinch()
    .onUpdate((e) => { scale.value = clamp(savedScale.value * e.scale, MIN_ZOOM, MAX_ZOOM); })
    .onEnd(() => {
      savedScale.value = scale.value;
      if (scale.value <= 1.05) {
        scale.value = withSpring(1); savedScale.value = 1;
        translateX.value = withSpring(0); translateY.value = withSpring(0);
        savedTranslateX.value = 0; savedTranslateY.value = 0;
        runOnJS(notifyZoom)(false);
      } else { runOnJS(notifyZoom)(true); }
    });

  const panGesture = Gesture.Pan()
    .minPointers(1)
    .onUpdate((e) => {
      if (savedScale.value <= 1) return;
      const maxPanX = (SLIDE_WIDTH * (savedScale.value - 1)) / 2;
      const maxPanY = (GALLERY_HEIGHT * (savedScale.value - 1)) / 2;
      translateX.value = clamp(savedTranslateX.value + e.translationX, -maxPanX, maxPanX);
      translateY.value = clamp(savedTranslateY.value + e.translationY, -maxPanY, maxPanY);
    })
    .onEnd(() => { savedTranslateX.value = translateX.value; savedTranslateY.value = translateY.value; })
    .activeOffsetX([-8, 8]).activeOffsetY([-8, 8])
    .failOffsetX(savedScale.value <= 1 ? [-4, 4] : [-1000, 1000]);

  const doubleTapGesture = Gesture.Tap().numberOfTaps(2).maxDuration(300).onEnd((e) => {
    if (savedScale.value > 1) {
      scale.value = withSpring(1); savedScale.value = 1;
      translateX.value = withSpring(0); translateY.value = withSpring(0);
      savedTranslateX.value = 0; savedTranslateY.value = 0;
      runOnJS(notifyZoom)(false);
    } else {
      const targetScale = 2.5;
      const maxPanX = (SLIDE_WIDTH * (targetScale - 1)) / 2;
      const maxPanY = (GALLERY_HEIGHT * (targetScale - 1)) / 2;
      const newTx = clamp(-(e.x - SLIDE_WIDTH / 2) * (targetScale - 1), -maxPanX, maxPanX);
      const newTy = clamp(-(e.y - GALLERY_HEIGHT / 2) * (targetScale - 1), -maxPanY, maxPanY);
      scale.value = withSpring(targetScale, { damping: 15, stiffness: 150 });
      savedScale.value = targetScale;
      translateX.value = withSpring(newTx, { damping: 15, stiffness: 150 });
      translateY.value = withSpring(newTy, { damping: 15, stiffness: 150 });
      savedTranslateX.value = newTx; savedTranslateY.value = newTy;
      runOnJS(notifyZoom)(true);
    }
  });

  const singleTapGesture = Gesture.Tap().numberOfTaps(1).maxDuration(250).onEnd(() => { if (savedScale.value <= 1) { runOnJS(openFullscreen)(); } });

  const withDoubleTap = Gesture.Exclusive(doubleTapGesture, singleTapGesture, Gesture.Simultaneous(pinchGesture, panGesture));
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }, { translateX: translateX.value }, { translateY: translateY.value }] }));

  return (
    <GestureDetector gesture={withDoubleTap}>
      <Animated.View style={{ width: SLIDE_WIDTH, height: GALLERY_HEIGHT, overflow: 'hidden', backgroundColor: Colors.background }}>
        <Animated.View style={[StyleSheet.absoluteFill, animatedStyle]}>
          <Image source={{ uri }} style={{ width: '100%', height: '100%' }} contentFit="contain" transition={200} />
        </Animated.View>
        {!isZoomed ? (
          <View style={gal.zoomHint} pointerEvents="none">
            <MaterialIcons name="zoom-in" size={13} color="rgba(255,255,255,0.7)" />
            <Text style={gal.zoomHintText}>Pinch or double-tap to zoom</Text>
          </View>
        ) : (
          <Pressable onPress={resetZoom} style={gal.resetZoomBtn}>
            <MaterialIcons name="zoom-out-map" size={13} color={Colors.background} />
            <Text style={gal.resetZoomText}>Reset</Text>
          </Pressable>
        )}
      </Animated.View>
    </GestureDetector>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FETCH IMAGE BUTTON
// ─────────────────────────────────────────────────────────────────────────────

function FetchImageButton({ onFetch, fetching, fetchResult, onReconnect }: { onFetch: () => void; fetching: boolean; fetchResult: { downloaded: number; failed: number; requiresReauth?: boolean } | null; onReconnect?: () => void }) {
  if (fetchResult) {
    if (fetchResult.requiresReauth) {
      return (
        <Pressable onPress={onReconnect} style={({ pressed }) => [fib.btn, { backgroundColor: Colors.warning }, pressed && { opacity: 0.8 }]}>
          <MaterialIcons name="link-off" size={15} color={Colors.background} />
          <Text style={fib.btnText}>Reconnect eBay to Fetch Images</Text>
        </Pressable>
      );
    }
    return (
      <View style={fib.resultRow}>
        <MaterialIcons name={fetchResult.downloaded > 0 ? 'check-circle' : 'search-off'} size={14} color={fetchResult.downloaded > 0 ? Colors.success : Colors.warning} />
        <Text style={[fib.resultText, { color: fetchResult.downloaded > 0 ? Colors.success : Colors.warning }]}>
          {fetchResult.downloaded > 0 ? `${fetchResult.downloaded} image${fetchResult.downloaded === 1 ? '' : 's'} downloaded` : 'No images found on eBay for this item'}
        </Text>
      </View>
    );
  }
  return (
    <Pressable onPress={onFetch} disabled={fetching} style={({ pressed }) => [fib.btn, pressed && { opacity: 0.8 }, fetching && fib.btnRunning]}>
      {fetching ? <ActivityIndicator size="small" color={Colors.background} style={{ width: 15, height: 15 }} /> : <MaterialIcons name="cloud-download" size={15} color={Colors.background} />}
      <Text style={fib.btnText}>{fetching ? 'Fetching...' : 'Fetch Image from eBay'}</Text>
    </Pressable>
  );
}

const fib = StyleSheet.create({
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xs, backgroundColor: Colors.info, borderRadius: Radius.md, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md, alignSelf: 'stretch' },
  btnRunning: { opacity: 0.7 },
  btnText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.background },
  resultRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.md, padding: Spacing.md, alignSelf: 'stretch' },
  resultText: { flex: 1, fontSize: Typography.size.xs, lineHeight: 16, fontWeight: Typography.weight.medium },
});

// ─────────────────────────────────────────────────────────────────────────────
// GALLERY
// ─────────────────────────────────────────────────────────────────────────────

function GalleryDots({ count, activeIndex, onPress }: { count: number; activeIndex: number; onPress: (i: number) => void }) {
  if (count <= 1) return null;
  const MAX_VISIBLE = 7;
  const dots = count <= MAX_VISIBLE ? Array.from({ length: count }, (_, i) => i) : Array.from({ length: MAX_VISIBLE }, (_, i) => i);
  return (
    <View style={gal.dotsRow}>
      {dots.map((_, i) => {
        const realIdx = count <= MAX_VISIBLE ? i : Math.min(i, count - 1);
        const isActive = activeIndex === realIdx;
        return (
          <Pressable key={i} onPress={() => onPress(realIdx)} hitSlop={8}>
            <View style={[gal.dot, isActive && gal.dotActive]} />
          </Pressable>
        );
      })}
    </View>
  );
}

function ImageGallery({ media, onReIdentify, onFetchImage, fetchingImage, fetchImageResult, onReconnect }: {
  media: string[]; onReIdentify: () => void; onFetchImage: () => void;
  fetchingImage: boolean; fetchImageResult: { downloaded: number; failed: number; requiresReauth?: boolean } | null; onReconnect: () => void;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [galleryScrollEnabled, setGalleryScrollEnabled] = useState(true);
  const [fullscreenVisible, setFullscreenVisible] = useState(false);
  const [fullscreenIndex, setFullscreenIndex] = useState(0);
  const flatListRef = useRef<FlatList>(null);
  const thumbRef = useRef<FlatList>(null);
  const hasMultiple = media.length > 1;

  const openFullscreen = useCallback((index: number) => { setFullscreenIndex(index); setFullscreenVisible(true); }, []);

  const handleScroll = useCallback((e: any) => {
    const index = Math.round(e.nativeEvent.contentOffset.x / SLIDE_WIDTH);
    if (index !== activeIndex) {
      setActiveIndex(index);
      try { thumbRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 }); } catch {}
    }
  }, [activeIndex]);

  const scrollTo = useCallback((index: number) => {
    setActiveIndex(index);
    flatListRef.current?.scrollToOffset({ offset: index * SLIDE_WIDTH, animated: true });
    try { thumbRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 }); } catch {}
  }, []);

  if (media.length === 0) {
    return (
      <View style={gal.noPhotoWrap}>
        <View style={gal.noPhoto}>
          <MaterialIcons name="photo-camera" size={32} color={Colors.textTertiary} />
          <Text style={gal.noPhotoText}>No photos</Text>
          <Text style={gal.noPhotoSub}>Fetch from eBay or Re-Identify with AI</Text>
        </View>
        <FetchImageButton onFetch={onFetchImage} fetching={fetchingImage} fetchResult={fetchImageResult} onReconnect={onReconnect} />
        <Pressable onPress={onReIdentify} style={gal.reIdBtnNoPhoto}>
          <MaterialIcons name="auto-awesome" size={15} color={Colors.background} />
          <Text style={gal.reIdBtnText}>Re-Identify with AI</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={gal.container}>
      {hasMultiple ? (
        <View style={gal.countBadge} pointerEvents="none">
          <MaterialIcons name="photo-library" size={11} color="rgba(255,255,255,0.85)" />
          <Text style={gal.countBadgeText}>{media.length} photos</Text>
        </View>
      ) : null}

      <View style={gal.galleryWrap}>
        <FlatList
          ref={flatListRef}
          data={media}
          keyExtractor={(_, i) => String(i)}
          horizontal pagingEnabled scrollEnabled={galleryScrollEnabled}
          showsHorizontalScrollIndicator={false}
          onScroll={handleScroll} scrollEventThrottle={16}
          decelerationRate="fast"
          renderItem={({ item: uri, index }) => (
            <ZoomableSlide uri={uri} onZoomChange={(z) => setGalleryScrollEnabled(!z)} onOpenFullscreen={() => openFullscreen(index)} />
          )}
          getItemLayout={(_, index) => ({ length: SLIDE_WIDTH, offset: SLIDE_WIDTH * index, index })}
        />
        <View style={gal.bottomGradient} pointerEvents="none" />
        {hasMultiple ? (
          <View style={gal.slideCounter} pointerEvents="none">
            <Text style={gal.slideCounterText}>{activeIndex + 1} / {media.length}</Text>
          </View>
        ) : null}
      </View>

      {hasMultiple ? <GalleryDots count={media.length} activeIndex={activeIndex} onPress={scrollTo} /> : null}

      {hasMultiple ? (
        <View style={gal.thumbStripWrap}>
          <FlatList
            ref={thumbRef}
            data={media}
            keyExtractor={(_, i) => `t${i}`}
            horizontal showsHorizontalScrollIndicator={false}
            contentContainerStyle={gal.thumbContent}
            onScrollToIndexFailed={() => {}}
            renderItem={({ item: uri, index }) => (
              <Pressable onPress={() => scrollTo(index)} style={({ pressed }) => [gal.thumb, index === activeIndex && gal.thumbActive, pressed && { opacity: 0.75 }]}>
                <Image source={{ uri }} style={gal.thumbImage} contentFit="cover" transition={100} />
                {index === activeIndex ? <View style={gal.thumbActiveLine} /> : null}
              </Pressable>
            )}
            getItemLayout={(_, index) => ({ length: THUMB_SIZE + THUMB_GAP, offset: (THUMB_SIZE + THUMB_GAP) * index, index })}
          />
        </View>
      ) : null}

      <View style={gal.actionRow}>
        <Pressable onPress={onReIdentify} style={({ pressed }) => [gal.reIdBtn, pressed && { opacity: 0.8 }]}>
          <MaterialIcons name="auto-awesome" size={13} color={Colors.background} />
          <Text style={gal.reIdBtnText}>Re-Identify with AI</Text>
        </Pressable>
        {media.length <= 1 ? (
          <FetchImageButton onFetch={onFetchImage} fetching={fetchingImage} fetchResult={fetchImageResult} onReconnect={onReconnect} />
        ) : null}
      </View>

      <FullscreenImageViewer media={media} initialIndex={fullscreenIndex} visible={fullscreenVisible} onClose={() => setFullscreenVisible(false)} />
    </GestureHandlerRootView>
  );
}

const gal = StyleSheet.create({
  container: { gap: 0, marginHorizontal: -Spacing.base },
  galleryWrap: { position: 'relative', height: GALLERY_HEIGHT, overflow: 'hidden' },
  zoomHint: { position: 'absolute', bottom: Spacing.sm, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, pointerEvents: 'none' },
  zoomHintText: { fontSize: 9, color: 'rgba(255,255,255,0.55)', fontWeight: '500' },
  resetZoomBtn: { position: 'absolute', top: Spacing.sm, right: Spacing.sm, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: Radius.pill, paddingHorizontal: 9, paddingVertical: 5 },
  resetZoomText: { fontSize: 10, color: Colors.background, fontWeight: Typography.weight.semibold },
  bottomGradient: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 64, backgroundColor: 'transparent' },
  slideCounter: { position: 'absolute', top: Spacing.sm, right: Spacing.sm, backgroundColor: 'rgba(0,0,0,0.52)', borderRadius: Radius.pill, paddingHorizontal: 9, paddingVertical: 4 },
  slideCounterText: { fontSize: 11, fontWeight: Typography.weight.bold, color: 'rgba(255,255,255,0.92)', letterSpacing: 0.2 },
  countBadge: { position: 'absolute', top: Spacing.sm, left: Spacing.base, zIndex: 10, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(0,0,0,0.52)', borderRadius: Radius.pill, paddingHorizontal: 9, paddingVertical: 4 },
  countBadgeText: { fontSize: 11, fontWeight: Typography.weight.semibold, color: 'rgba(255,255,255,0.88)' },
  dotsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingTop: Spacing.sm, paddingBottom: Spacing.xs, backgroundColor: Colors.background },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.surfaceBorder },
  dotActive: { backgroundColor: Colors.primary, width: 20, borderRadius: 3 },
  thumbStripWrap: { backgroundColor: Colors.background, paddingVertical: Spacing.xs },
  thumbContent: { paddingHorizontal: Spacing.base, gap: THUMB_GAP },
  thumb: { width: THUMB_SIZE, height: THUMB_SIZE, borderRadius: Radius.md, overflow: 'hidden', borderWidth: 2, borderColor: 'transparent', opacity: 0.55, position: 'relative' },
  thumbActive: { borderColor: Colors.primary, opacity: 1 },
  thumbImage: { width: '100%', height: '100%' },
  thumbActiveLine: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 3, backgroundColor: Colors.primary, borderBottomLeftRadius: Radius.md, borderBottomRightRadius: Radius.md },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.base, paddingTop: Spacing.sm, paddingBottom: Spacing.xs, backgroundColor: Colors.background },
  reIdBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: Colors.accent, borderRadius: Radius.pill, paddingHorizontal: Spacing.md, paddingVertical: 8, ...Shadow.sm },
  reIdBtnText: { fontSize: Typography.size.xs, fontWeight: Typography.weight.bold, color: Colors.background },
  noPhotoWrap: { gap: Spacing.md, marginHorizontal: Spacing.base },
  noPhoto: { height: 160, borderRadius: Radius.xl, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.surfaceBorder, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', gap: Spacing.xs },
  noPhotoText: { fontSize: Typography.size.sm, color: Colors.textTertiary },
  noPhotoSub: { fontSize: Typography.size.xs, color: Colors.textTertiary + '80' },
  reIdBtnNoPhoto: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: Colors.accent, borderRadius: Radius.md, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md, alignSelf: 'stretch', justifyContent: 'center', ...Shadow.glow },
});

// ─────────────────────────────────────────────────────────────────────────────
// RE-IDENTIFY MODAL  (preserved in full — no behaviour changes)
// ─────────────────────────────────────────────────────────────────────────────

const MAX_REID_PHOTOS = 4;

function ReIdentifyModal({ visible, item, tenantId, onClose, onComplete }: {
  visible: boolean; item: Item; tenantId: string;
  onClose: () => void; onComplete: (updatedItem: Partial<Item>, newMedia: string[]) => void;
}) {
  const [capturedImages, setCapturedImages] = useState<CapturedImage[]>([]);
  const [step, setStep] = useState<'capture' | 'processing' | 'confirm' | 'feedback'>('capture');
  const [processingMsg, setProcessingMsg] = useState('');
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState('');
  const [saving, setSaving] = useState(false);
  const [feedbackVerdict, setFeedbackVerdict] = useState<FeedbackVerdict | null>(null);
  const [feedbackNotes, setFeedbackNotes] = useState('');
  const [feedbackCategory, setFeedbackCategory] = useState<ErrorCategory | null>(null);
  const [savingFeedback, setSavingFeedback] = useState(false);
  const [useExistingImages, setUseExistingImages] = useState(true);
  const [showRefinement, setShowRefinement] = useState(false);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [refineWeight, setRefineWeight] = useState('');
  const [refineDiameter, setRefineDiameter] = useState('');
  const [refineKeywords, setRefineKeywords] = useState('');
  const [refineLoading, setRefineLoading] = useState(false);
  const [refinedResult, setRefinedResult] = useState<any>(null);

  const specialist = item.specialistId ? SPECIALISTS[item.specialistId as keyof typeof SPECIALISTS] : null;

  const photoSlots = useMemo(() => {
    const base = specialist?.captureRequirements?.slice(0, MAX_REID_PHOTOS).map(r => ({ id: r.id, label: r.label, required: r.required })) ?? [];
    while (base.length < MAX_REID_PHOTOS) {
      base.push({ id: `extra_${base.length + 1}`, label: `Extra ${base.length - (specialist?.captureRequirements?.length ?? 0) + 1}`, required: false });
    }
    return base;
  }, [specialist]);

  const storedUrls = useMemo(() => (item.media ?? []).filter(u => u.startsWith('https://')), [item.media]);

  const heroImages = useMemo(() => {
    if (!useExistingImages && capturedImages.length > 0) return capturedImages.slice(0, 2).map(img => img.uri);
    const stored = storedUrls.slice(0, 2);
    const extra = capturedImages.slice(0, Math.max(0, 2 - stored.length)).map(img => img.uri);
    return [...stored, ...extra].slice(0, 2);
  }, [storedUrls, capturedImages, useExistingImages]);

  const handleCapture = useCallback(async (slotId: string, slotLabel: string) => {
    const img = await captureFromCamera();
    if (!img) return;
    setCapturedImages(prev => {
      const existing = prev.findIndex(i => i.slotId === slotId);
      if (existing >= 0) { const u = [...prev]; u[existing] = { ...img, slotId, slotLabel }; return u; }
      return [...prev, { ...img, slotId, slotLabel }];
    });
  }, []);

  const handlePickLibrary = useCallback(async (slotId: string, slotLabel: string) => {
    const img = await pickFromLibrary(slotId, slotLabel);
    if (!img) return;
    setCapturedImages(prev => {
      const existing = prev.findIndex(i => i.slotId === slotId);
      if (existing >= 0) { const u = [...prev]; u[existing] = { ...img, slotId, slotLabel }; return u; }
      return [...prev, { ...img, slotId, slotLabel }];
    });
  }, []);

  const handleRemove = useCallback((slotId: string) => { setCapturedImages(prev => prev.filter(i => i.slotId !== slotId)); }, []);

  const handleIdentify = useCallback(async () => {
    const hasNew = capturedImages.length > 0;
    const hasExisting = storedUrls.length > 0 && useExistingImages;
    if (!hasNew && !hasExisting) { setError('No images available.'); return; }
    setStep('processing'); setError(null);
    const knownAttributes = {
      existingTitle: item.canonicalTitle, condition: item.condition, conditionGrade: item.conditionGrade,
      yearMade: item.yearMade, countryOfOrigin: item.countryOfOrigin, material: item.material,
      manufacturer: item.manufacturer, diameter: item.diameterMm, weight: item.weightGrams,
      existingAttributes: item.attributes, customNotes: item.customNotes,
      ruler: item.ruler, denomination: item.denomination, period: item.period, mint: item.mint, catalogueNumber: item.catalogueNumber,
    };
    const processingSteps = useExistingImages && !hasNew
      ? ['Re-analysing existing photos...', 'Checking learning database...', 'Cross-referencing records...', 'Generating updated valuation...']
      : ['Compressing images...', 'Uploading to AI vision...', 'Cross-referencing database...', 'Generating updated valuation...'];
    for (const s of processingSteps) { setProcessingMsg(s); await new Promise(r => setTimeout(r, 350)); }
    const { result: aiResult, error: aiErr } = await identifyItemWithAI(
      capturedImages, (item.specialistId as any) ?? 'curiosities_collectibles', undefined, knownAttributes,
      { tenantId, existingImageUrls: useExistingImages ? storedUrls : undefined },
    );
    if (aiErr || !aiResult) { setError(aiErr ?? 'AI identification failed'); setStep('capture'); return; }
    setResult(aiResult); setStep('confirm');
    setFeedbackVerdict(null); setFeedbackNotes(''); setFeedbackCategory(null);
  }, [capturedImages, item, tenantId, useExistingImages, storedUrls]);

  const handleApply = useCallback(async (applyResult?: any) => {
    const r = applyResult ?? result;
    if (!r) return;
    const numista = r.numistaVerification ?? {};
    const suppliedNumistaN = r.numistaN ?? numista.numistaN ?? null;
    const parsedNumistaId = suppliedNumistaN
      ? Number(String(suppliedNumistaN).match(/N\s*#?\s*(\d+)/i)?.[1] ?? 0) || null
      : null;
    const numistaTypeId = r.numistaTypeId ?? numista.typeId ?? parsedNumistaId;
    const numistaN = suppliedNumistaN ?? (numistaTypeId ? `N#${numistaTypeId}` : null);
    const numistaStatus = r.numistaStatus ?? numista.status ?? null;
    const numistaMatchScore = Number(r.numistaMatchScore ?? numista.matchScore ?? 0);
    const numistaMatchTier = r.numistaMatchTier ?? numista.matchTier ?? null;
    const strongNumistaMatch =
      ['verified', 'strong_match'].includes(String(numistaStatus)) &&
      numistaMatchScore >= 80 && numista.physicalMatchGood === true;
    // An exact retrieved N# supplies catalogue metadata even if the image match
    // still needs review. Match confidence governs identity confidence, not data availability.
    const hasResolvedNumistaRecord = Boolean(
      numistaTypeId && (numista.title || r.numistaTitle) &&
      (numista.numistaUrl || r.numistaUrl || numistaN)
    );
    const useCatalogueMetadata = strongNumistaMatch || hasResolvedNumistaRecord;
    const catalogueSuggestions = (r.attributes?.numista_catalogue_suggestions ?? {}) as Record<string, any>;
    const usableCatalogueText = (value: unknown): string | undefined => {
      const text = String(value ?? '').trim();
      return text && !/^(not established|not supplied|unknown|n.a|—|-)$/i.test(text) ? text : undefined;
    };
    const issuedFrom = numista.issuedFrom ?? catalogueSuggestions.issuedFrom;
    const issuedTo = numista.issuedTo ?? catalogueSuggestions.issuedTo;
    const suggestedYear = useCatalogueMetadata && (issuedFrom != null || issuedTo != null)
      ? `${issuedFrom ?? '?'}–${issuedTo ?? '?'}`
      : undefined;
    const measuredWeight = Number(r.attributes?.supplied_weight_g ?? r.attributes?.weight_g ?? 0);
    const measuredDiameter = Number(r.attributes?.supplied_diameter_mm ?? r.attributes?.diameter_mm ?? 0);
    setSaving(true); setUploadMsg('Uploading photos...');
    let permanentUrls: string[] = [...(item.media ?? [])];
    if (capturedImages.length > 0) {
      setUploading(true);
      const { urls } = await uploadItemImages(item.id, capturedImages);
      if (urls.length > 0) {
        permanentUrls = [...urls, ...item.media.filter(u => u.startsWith('https://') && !u.startsWith('file://'))];
        await updateItemMedia(tenantId, item.id, permanentUrls);
      }
      setUploading(false);
    }
    const updates: Partial<Item> = {
      canonicalTitle: r.canonicalTitle ?? item.canonicalTitle,
      condition: r.condition ?? item.condition, conditionGrade: r.conditionGrade ?? item.conditionGrade,
      conditionNotes: r.conditionNotes ?? item.conditionNotes,
      identificationConfidence: r.confidence ?? item.identificationConfidence,
      // Fill missing record fields with catalogue/AI suggestions for review, but
      // never replace an existing value from a weaker candidate. The match tier
      // and contradictions remain attached in attributes for explicit review.
      ...(usableCatalogueText(numistaN) && !item.catalogueNumber ? { catalogueNumber: numistaN } : {}),
      ...(!item.ruler && usableCatalogueText(numista.issuer ?? (useCatalogueMetadata ? catalogueSuggestions.issuer : undefined) ?? r.coinFields?.issuer) ? { ruler: usableCatalogueText(numista.issuer ?? catalogueSuggestions.issuer ?? r.coinFields?.issuer) } : {}),
      ...(!item.denomination && usableCatalogueText(numista.denomination ?? (useCatalogueMetadata ? catalogueSuggestions.denomination : undefined) ?? r.coinFields?.denomination) ? { denomination: usableCatalogueText(numista.denomination ?? catalogueSuggestions.denomination ?? r.coinFields?.denomination) } : {}),
      ...(!item.period && usableCatalogueText((useCatalogueMetadata ? catalogueSuggestions.period : undefined) ?? r.coinFields?.period) ? { period: usableCatalogueText(catalogueSuggestions.period ?? r.coinFields?.period) } : {}),
      ...(!item.mint && usableCatalogueText(numista.mint ?? (useCatalogueMetadata ? catalogueSuggestions.mint : undefined) ?? r.coinFields?.mint) ? { mint: usableCatalogueText(numista.mint ?? catalogueSuggestions.mint ?? r.coinFields?.mint) } : {}),
      ...(!item.material && usableCatalogueText(numista.composition ?? (useCatalogueMetadata ? catalogueSuggestions.material : undefined) ?? r.coinFields?.composition) ? { material: usableCatalogueText(numista.composition ?? catalogueSuggestions.material ?? r.coinFields?.composition) } : {}),
      ...(!item.countryOfOrigin && usableCatalogueText(numista.country ?? (useCatalogueMetadata ? catalogueSuggestions.country : undefined) ?? r.coinFields?.country) ? { countryOfOrigin: usableCatalogueText(numista.country ?? catalogueSuggestions.country ?? r.coinFields?.country) } : {}),
      ...(!item.yearMade && usableCatalogueText(r.attributes?.user_supplied_year ?? suggestedYear) ? { yearMade: usableCatalogueText(r.attributes?.user_supplied_year ?? suggestedYear) } : {}),
      ...(item.weightGrams == null && Number.isFinite(measuredWeight) && measuredWeight > 0 ? { weightGrams: measuredWeight } : {}),
      ...(item.diameterMm == null && Number.isFinite(measuredDiameter) && measuredDiameter > 0 ? { diameterMm: measuredDiameter } : {}),
      valuationLow: r.valuationLow ?? item.valuationLow, valuationMid: r.valuationMid ?? item.valuationMid,
      valuationHigh: r.valuationHigh ?? item.valuationHigh, valuationConfidence: r.valuationConfidence ?? item.valuationConfidence,
      expectedSellingPrice: r.valuationMid ?? item.expectedSellingPrice,
      expectedNet: (r.valuationMid ?? item.expectedSellingPrice) * 0.8725,
      expectedProfit: (r.valuationMid ?? item.expectedSellingPrice) * 0.8725 - (item.acquiredCost ?? 0),
      saleProb30d: r.saleProb30d ?? item.saleProb30d,
      attributes: {
        ...item.attributes,
        ...r.attributes,
        ...(numistaTypeId ? {
          numista_candidate_id: numistaTypeId,
          numista_n: numistaN,
          numista_url: r.numistaUrl ?? numista.numistaUrl ?? `https://numista.com/${numistaTypeId}`,
          numista_title: r.numistaTitle ?? numista.title ?? null,
          numista_status: numistaStatus ?? 'candidate',
          numista_match_score: numistaMatchScore,
          numista_match_tier: numistaMatchTier ?? 'weak',
          numista_catalogue_weight: numista.weight ?? null,
          numista_catalogue_diameter: numista.diameter ?? null,
          numista_catalogue_composition: numista.composition?.material ?? numista.composition ?? null,
          numista_issuer: numista.issuer?.name ?? numista.issuer ?? null,
          numista_mint: numista.mint?.name ?? numista.mint ?? null,
          ...(strongNumistaMatch ? { numista_type_id: numistaTypeId } : {}),
        } : {}),
      },
      warnings: r.warnings ?? item.warnings, media: permanentUrls,
    };
    await updateItem(item.id, updates, tenantId);
    setSaving(false); onComplete(updates, permanentUrls);
  }, [result, capturedImages, item, tenantId, onComplete]);

  const handleFeedback = useCallback(async (verdict: FeedbackVerdict) => {
    if (!result) return;
    if (verdict === 'incorrect' || verdict === 'partial') { setFeedbackVerdict(verdict); setStep('feedback'); return; }
    setSavingFeedback(true);
    await recordAIFeedback({
      tenantId, itemId: item.id, specialistId: (item.specialistId as any) ?? 'curiosities_collectibles',
      aiCanonicalTitle: result.canonicalTitle, aiAttributes: result.attributes ?? {}, aiConfidence: result.confidence ?? 0,
      originalCanonicalTitle: result.canonicalTitle, originalAttributes: result.attributes ?? {},
      feedback: 'correct', imageUrls: storedUrls,
    });
    setSavingFeedback(false); await handleApply(result);
  }, [result, item, tenantId, handleApply, storedUrls]);

  const handleSubmitIncorrect = useCallback(async () => {
    if (!result || !feedbackVerdict) return;
    setSavingFeedback(true);
    await recordAIFeedback({
      tenantId, itemId: item.id, specialistId: (item.specialistId as any) ?? 'curiosities_collectibles',
      aiCanonicalTitle: result.canonicalTitle, aiAttributes: result.attributes ?? {}, aiConfidence: result.confidence ?? 0,
      originalCanonicalTitle: item.canonicalTitle, originalAttributes: item.attributes ?? {},
      feedback: feedbackVerdict, correctionNotes: feedbackNotes, errorCategory: feedbackCategory ?? 'other', imageUrls: storedUrls,
    });
    setSavingFeedback(false); onComplete({}, item.media ?? []);
  }, [result, item, tenantId, feedbackVerdict, feedbackNotes, feedbackCategory, storedUrls, onComplete]);

  const handleRefineIdentification = useCallback(async () => {
    if (!result) return;
    setRefineLoading(true);
    const suppliedSpecs = refineKeywords.trim();
    const extraNotes = [
      refineWeight ? `Weight: ${refineWeight}g` : '',
      refineDiameter ? `Diameter: ${refineDiameter}mm` : '',
      suppliedSpecs ? `User-supplied specifications (cross-check; not automatically verified):\\n${suppliedSpecs}` : '',
    ].filter(Boolean).join('\\n');
    const { result: refined, error: refineErr } = await identifyItemWithAI(
      capturedImages, (item.specialistId as any) ?? 'curiosities_collectibles', undefined,
      {
        existingTitle: result.canonicalTitle, condition: result.condition, conditionGrade: result.conditionGrade,
        weight: refineWeight ? parseFloat(refineWeight) : item.weightGrams,
        diameter: refineDiameter ? parseFloat(refineDiameter) : item.diameterMm,
        yearMade: item.yearMade, countryOfOrigin: item.countryOfOrigin, material: item.material,
        ruler: item.ruler, denomination: item.denomination, period: item.period, mint: item.mint,
        catalogueNumber: item.catalogueNumber, existingAttributes: { ...item.attributes, ...result.attributes },
        customNotes: extraNotes,
      },
      { tenantId, existingImageUrls: useExistingImages ? storedUrls : undefined },
    );
    setRefineLoading(false);
    if (refineErr || !refined) { setError(refineErr ?? 'Refinement failed'); return; }
    setRefinedResult(refined);
  }, [result, capturedImages, item, tenantId, useExistingImages, storedUrls, refineWeight, refineDiameter, refineKeywords]);

  const handleAcceptRefined = useCallback(async () => {
    if (!refinedResult) return;
    await handleApply(refinedResult); setRefinedResult(null); setShowRefinement(false);
  }, [refinedResult, handleApply]);

  const handleClose = useCallback(() => {
    setCapturedImages([]); setStep('capture'); setResult(null); setError(null);
    setUploading(false); setUploadMsg(''); setFeedbackVerdict(null); setFeedbackNotes(''); setFeedbackCategory(null);
    setUseExistingImages(true); setShowRefinement(false); setRefinedResult(null);
    setEvidenceOpen(false); setDetailsOpen(false); setRefineWeight(''); setRefineDiameter(''); setRefineKeywords('');
    onClose();
  }, [onClose]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleClose}>
      <View style={reid.container}>
        <View style={reid.header}>
          <Pressable onPress={handleClose} style={reid.closeBtn} hitSlop={8}><MaterialIcons name="close" size={20} color={Colors.textSecondary} /></Pressable>
          <View style={reid.headerCenter}><MaterialIcons name="auto-awesome" size={16} color={Colors.accent} /><Text style={reid.headerTitle}>Re-Identify with AI</Text></View>
          <View style={{ width: 36 }} />
        </View>
        <ScrollView contentContainerStyle={reid.content} showsVerticalScrollIndicator={false}>
          <View style={reid.contextCard}>
            <Text style={reid.contextLabel}>RE-IDENTIFYING</Text>
            <Text style={reid.contextTitle} numberOfLines={2}>{item.canonicalTitle}</Text>
            <Text style={reid.contextSub}>{useExistingImages && storedUrls.length > 0 ? `Using ${storedUrls.length} stored photo${storedUrls.length === 1 ? '' : 's'} + full listing data.` : 'Capture new photos. All known attributes passed as context.'}</Text>
          </View>
          {step === 'capture' ? (
            <>
              {error ? <View style={reid.errorBanner}><MaterialIcons name="error-outline" size={14} color={Colors.danger} /><Text style={reid.errorText}>{error}</Text></View> : null}
              {storedUrls.length > 0 ? (
                <Pressable onPress={() => setUseExistingImages(v => !v)} style={reid.toggleRow}>
                  <View style={[reid.toggleDot, useExistingImages && reid.toggleDotOn]} />
                  <Text style={[reid.toggleText, useExistingImages && { color: Colors.primary }]}>{useExistingImages ? `Use ${storedUrls.length} stored photo${storedUrls.length === 1 ? '' : 's'} (recommended)` : 'New photos only'}</Text>
                </Pressable>
              ) : null}
              <Text style={reid.sectionLabel}>{useExistingImages && storedUrls.length > 0 ? 'ADD NEW PHOTOS (OPTIONAL)' : `CAPTURE UP TO ${MAX_REID_PHOTOS} PHOTOS`}</Text>
              <View style={reid.photoGrid}>
                {photoSlots.map((slot, idx) => {
                  const img = capturedImages.find(i => i.slotId === slot.id);
                  return (
                    <View key={slot.id} style={idx === 0 ? reid.slotLarge : reid.slotSmall}>
                      {img ? (
                        <View style={reid.slotCaptured}>
                          <Image source={{ uri: img.uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
                          <View style={reid.capturedBar}><MaterialIcons name="check-circle" size={10} color={Colors.success} /><Text style={reid.capturedLabel} numberOfLines={1}>{slot.label}</Text><Pressable onPress={() => handleCapture(slot.id, slot.label)} hitSlop={6}><MaterialIcons name="refresh" size={12} color="#fff" /></Pressable></View>
                          <Pressable onPress={() => handleRemove(slot.id)} style={reid.removeBtn} hitSlop={6}><MaterialIcons name="close" size={11} color="#fff" /></Pressable>
                        </View>
                      ) : (
                        <View style={reid.slotEmpty}>
                          <View style={reid.slotActions}><Pressable onPress={() => handleCapture(slot.id, slot.label)} style={reid.slotActionBtn}><MaterialIcons name="photo-camera" size={idx === 0 ? 22 : 18} color={Colors.primary} /></Pressable><Pressable onPress={() => handlePickLibrary(slot.id, slot.label)} style={reid.slotActionBtn}><MaterialIcons name="photo-library" size={idx === 0 ? 18 : 15} color={Colors.textTertiary} /></Pressable></View>
                          <Text style={reid.slotLabel} numberOfLines={1}>{slot.label}</Text>
                          {slot.required && !(useExistingImages && storedUrls.length > 0) ? <View style={reid.requiredPill}><Text style={reid.requiredText}>Required</Text></View> : <Text style={reid.optionalText}>Optional</Text>}
                        </View>
                      )}
                    </View>
                  );
                })}
              </View>
              <Pressable onPress={handleIdentify} disabled={capturedImages.length === 0 && !(useExistingImages && storedUrls.length > 0)} style={[reid.identifyBtn, (capturedImages.length === 0 && !(useExistingImages && storedUrls.length > 0)) && reid.identifyBtnDisabled]}>
                <MaterialIcons name="auto-awesome" size={18} color={Colors.background} />
                <Text style={reid.identifyBtnText}>{capturedImages.length > 0 ? `Re-ID (${capturedImages.length} new${useExistingImages && storedUrls.length > 0 ? ` + ${storedUrls.length} stored` : ''})` : useExistingImages && storedUrls.length > 0 ? 'Re-ID with Existing Photos' : 'Capture at least 1 photo'}</Text>
              </Pressable>
            </>
          ) : step === 'processing' ? (
            <View style={reid.processingView}>
              <ActivityIndicator size="large" color={Colors.accent} />
              <Text style={reid.processingTitle}>AI Analysing...</Text>
              <Text style={reid.processingMsg}>{processingMsg}</Text>
              <View style={reid.aiBadge}><MaterialIcons name="auto-awesome" size={11} color={Colors.accent} /><Text style={reid.aiBadgeText}>OnSpace AI · Gemini 2.5 Flash Vision</Text></View>
            </View>
          ) : step === 'confirm' && result ? (
            <>
              {heroImages.length > 0 ? (
                <View style={reid.heroWrap}>
                  <View style={reid.heroImgsRow}>
                    {heroImages.slice(0, 2).map((uri, idx) => (<View key={idx} style={[reid.heroImgSlot, heroImages.length === 1 && { width: '72%' }]}><Image source={{ uri }} style={reid.heroImgImg} contentFit="contain" transition={200} /></View>))}
                    {heroImages.length === 1 ? <View style={[reid.heroImgSlot, reid.heroImgPlaceholder]}><MaterialIcons name="flip" size={22} color="rgba(255,255,255,0.10)" /><Text style={reid.heroPlaceholderTxt}>Reverse</Text></View> : null}
                  </View>
                  {result.objectType && result.objectType !== 'coin' ? <View style={[reid.heroTypeBadge, { backgroundColor: result.objectType === 'medal' ? 'rgba(184,134,40,0.92)' : 'rgba(50,115,205,0.92)' }]}><Text style={reid.heroTypeBadgeTxt}>{String(result.objectType).replace(/_/g, ' ').toUpperCase()}</Text></View> : null}
                </View>
              ) : null}
              <View style={reid.identBlock}>
                {(result.identificationState === 'observation_only' || result.identificationState === 'candidate' || result.confidence < 0.70) ? <View style={reid.possiblePill}><MaterialIcons name="info-outline" size={10} color={Colors.warning} /><Text style={reid.possiblePillTxt}>POSSIBLE IDENTIFICATION</Text></View> : <View style={reid.confirmedPill}><MaterialIcons name="verified" size={10} color={Colors.success} /><Text style={reid.confirmedPillTxt}>IDENTIFIED</Text></View>}
                <Text style={reid.identTitleNew}>{result.canonicalTitle}</Text>
                {(() => { const cc = result.confidence >= 0.80 ? Colors.success : result.confidence >= 0.60 ? Colors.warning : Colors.danger; const lbl = result.confidence >= 0.85 ? 'HIGH CONFIDENCE' : result.confidence >= 0.65 ? 'MEDIUM CONFIDENCE' : result.confidence >= 0.45 ? 'LOW CONFIDENCE' : 'VERY LOW'; return (<View style={reid.confRowNew}><View style={[reid.confPillNew, { backgroundColor: cc + '18', borderColor: cc + '50' }]}><Text style={[reid.confPctNew, { color: cc }]}>{Math.round(result.confidence * 100)}%</Text><View style={[reid.confSepNew, { backgroundColor: cc + '40' }]} /><Text style={[reid.confLblNew, { color: cc }]}>{lbl}</Text></View></View>); })()}
                {result.confidence < 0.70 ? <Text style={reid.provisionalAdvice}>Manual confirmation recommended before listing</Text> : null}
                {result.confidenceReason ? <Text style={reid.confReasonNew} numberOfLines={2}>{result.confidenceReason}</Text> : null}
              </View>
              {(result.hasHole || result.hasAlteration) ? <View style={reid.alterationCard}><MaterialIcons name="report" size={13} color={Colors.danger} /><View style={{ flex: 1 }}><Text style={reid.alterationTitle}>ALTERATION DETECTED</Text><Text style={reid.alterationText}>{result.hasHole ? 'Object has been pierced/holed. ' : ''}{result.hasAlteration && result.alterationNotes ? result.alterationNotes + ' ' : ''}Significantly affects collectability and value.</Text></View></View> : null}
              {(result.objectType === 'medal' || result.objectType === 'token') ? <View style={reid.objectTypeCard}><MaterialIcons name="warning" size={13} color={Colors.gold} /><View style={{ flex: 1 }}><Text style={reid.objectTypeTitle}>{result.objectType === 'medal' ? 'MEDAL — Not a Coin' : String(result.objectType).replace(/_/g, ' ').toUpperCase()}</Text><Text style={reid.objectTypeText}>{result.objectType === 'medal' ? 'Denomination, mint, and coin catalogue references do not apply.' : `Classified as ${result.objectType.replace(/_/g, ' ')}.`}</Text></View></View> : null}
              {result.canonicalTitle !== item.canonicalTitle ? <View style={reid.compareCard}><Text style={reid.compareLabel}>WAS</Text><Text style={reid.compareOld} numberOfLines={2}>{item.canonicalTitle}</Text><View style={reid.compareArrow}><MaterialIcons name="arrow-downward" size={14} color={Colors.textTertiary} /></View><Text style={reid.compareLabel}>AI SUGGESTS</Text><Text style={reid.compareNew} numberOfLines={2}>{result.canonicalTitle}</Text></View> : <View style={[reid.compareCard, { flexDirection: 'row', gap: Spacing.sm, alignItems: 'center', borderColor: Colors.success + '40' }]}><MaterialIcons name="check-circle" size={14} color={Colors.success} /><Text style={[reid.compareLabel, { color: Colors.success }]}>AI confirms same identification</Text></View>}
              {(result.evidenceSupporting?.length > 0 || result.missingInformation?.length > 0) ? (
                <>
                  <Pressable onPress={() => setEvidenceOpen(o => !o)} style={reid.expandHeader}><View style={reid.expandHeaderLeft}><MaterialIcons name="checklist" size={14} color={Colors.primary} /><Text style={reid.expandHeaderTitle}>{'WHY SWISH THINKS THIS'}</Text></View><MaterialIcons name={evidenceOpen ? 'expand-less' : 'expand-more'} size={18} color={Colors.textTertiary} /></Pressable>
                  {evidenceOpen ? <View style={reid.expandContent}>{result.evidenceSupporting?.slice(0, 6).map((e: string, i: number) => <View key={i} style={reid.evidRow}><MaterialIcons name="check" size={11} color={Colors.success} style={{ marginTop: 2, flexShrink: 0 }} /><Text style={reid.evidTxt}>{e}</Text></View>)}{result.missingInformation?.slice(0, 4).map((m: string, i: number) => <View key={'m' + i} style={reid.evidRow}><MaterialIcons name="help-outline" size={11} color={Colors.warning} style={{ marginTop: 2, flexShrink: 0 }} /><Text style={[reid.evidTxt, { color: Colors.warning + 'BB' }]}>{m}</Text></View>)}</View> : null}
                </>
              ) : null}
              {uploading ? <View style={reid.uploadBanner}><ActivityIndicator size="small" color={Colors.primary} /><Text style={reid.uploadText}>{uploadMsg}</Text></View> : null}
              <View style={reid.actionSep}><View style={reid.actionSepLine} /><Text style={reid.actionSepTxt}>IS THIS CORRECT?</Text><View style={reid.actionSepLine} /></View>
              <View style={reid.feedbackRow}>
                <Pressable onPress={() => handleFeedback('incorrect')} disabled={saving || savingFeedback} style={reid.feedbackBtnWrong}><MaterialIcons name="close" size={17} color={Colors.danger} /><Text style={reid.feedbackBtnWrongText}>Incorrect</Text></Pressable>
                <Pressable onPress={() => handleFeedback('partial')} disabled={saving || savingFeedback} style={reid.feedbackBtnPartial}><MaterialIcons name="edit" size={15} color={Colors.warning} /><Text style={reid.feedbackBtnPartialText}>Partly right</Text></Pressable>
                <Pressable onPress={() => handleFeedback('correct')} disabled={saving || savingFeedback} style={reid.feedbackBtnCorrect}>{(saving || savingFeedback) ? <ActivityIndicator size="small" color={Colors.background} /> : <MaterialIcons name="check" size={17} color={Colors.background} />}<Text style={reid.feedbackBtnCorrectText}>{saving ? 'Saving...' : 'Correct!'}</Text></Pressable>
              </View>
              <Pressable onPress={() => { setStep('capture'); setResult(null); setRefinedResult(null); setShowRefinement(false); }} style={reid.retakeLink}><MaterialIcons name="refresh" size={12} color={Colors.textTertiary} /><Text style={reid.retakeLinkText}>Add more photos / retake</Text></Pressable>
              <Pressable onPress={() => setShowRefinement(s => !s)} style={reid.refinementToggle}><MaterialIcons name="tune" size={14} color={Colors.info} /><Text style={reid.refinementToggleText}>{showRefinement ? 'Hide' : 'Refine'} — add weight, diameter, keywords</Text><MaterialIcons name={showRefinement ? 'expand-less' : 'expand-more'} size={16} color={Colors.info} /></Pressable>
              {showRefinement ? (
                <View style={reid.refinementCard}>
                  <Text style={reid.refinementTitle}>HELP THE AI WITH MORE DATA</Text>
                  {refinedResult ? (
                    <View style={reid.comparisonCard}>
                      <Text style={reid.comparisonLabel}>ORIGINAL</Text>
                      <View style={reid.comparisonRow}><View style={[reid.confBadge, { borderColor: result.confidence >= 0.8 ? Colors.success : Colors.warning }]}><Text style={[reid.confidencePct, { color: result.confidence >= 0.8 ? Colors.success : Colors.warning, fontSize: 12 }]}>{Math.round(result.confidence * 100)}%</Text></View><Text style={reid.comparisonTitle} numberOfLines={2}>{result.canonicalTitle}</Text></View>
                      <View style={reid.comparisonDivider}><MaterialIcons name="arrow-downward" size={14} color={Colors.primary} /><Text style={reid.comparisonDividerText}>REFINED WITH YOUR DATA</Text></View>
                      <View style={reid.comparisonRow}><View style={[reid.confBadge, { borderColor: refinedResult.confidence >= 0.8 ? Colors.success : Colors.warning, backgroundColor: Colors.primaryDim }]}><Text style={[reid.confidencePct, { color: refinedResult.confidence >= 0.8 ? Colors.success : Colors.primary, fontSize: 12 }]}>{Math.round(refinedResult.confidence * 100)}%</Text></View><Text style={[reid.comparisonTitle, { color: Colors.primary }]} numberOfLines={2}>{refinedResult.canonicalTitle}</Text></View>
                      {refinedResult.numistaVerification ? (
                        <View style={{ marginTop: 10, marginBottom: 10, padding: 10, borderRadius: 10, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.surfaceBorder, gap: 5 }}>
                          <Text style={{ fontSize: 10, fontWeight: Typography.weight.bold, letterSpacing: 0.6, color: Colors.info }}>NUMISTA CATALOGUE CHECK</Text>
                          <Text style={{ fontSize: 12, fontWeight: Typography.weight.semibold, color: Colors.textPrimary }}>
                            {refinedResult.numistaVerification.numistaN ?? 'No catalogue number'} · {refinedResult.numistaVerification.status ?? 'not checked'} · {Math.round(Number(refinedResult.numistaVerification.matchScore ?? 0))}/100
                          </Text>
                          {refinedResult.numistaVerification.title ? <Text style={{ fontSize: 12, color: Colors.textSecondary }}>{refinedResult.numistaVerification.title}</Text> : null}
                          {(refinedResult.numistaVerification.matchFactors ?? []).slice(0, 3).map((factor: string, index: number) => (
                            <Text key={`numista-factor-${index}`} style={{ fontSize: 10, color: Colors.success }}>✓ {factor}</Text>
                          ))}
                          {(refinedResult.numistaVerification.contradictions ?? []).slice(0, 3).map((contradiction: string, index: number) => (
                            <Text key={`numista-conflict-${index}`} style={{ fontSize: 10, color: Colors.danger }}>! {contradiction}</Text>
                          ))}
                          {refinedResult.numistaVerification.numistaUrl ? <Text onPress={() => Linking.openURL(refinedResult.numistaVerification.numistaUrl)} style={{ fontSize: 10, color: Colors.info, textDecorationLine: 'underline' }}>Open Numista catalogue entry</Text> : null}
                        </View>
                      ) : null}
                      {refinedResult.coinResearch ? (
                        <View style={{ marginTop: 8, marginBottom: 10, padding: 10, borderRadius: 10, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.surfaceBorder, gap: 7 }}>
                          <Text style={{ fontSize: 10, fontWeight: Typography.weight.bold, letterSpacing: 0.6, color: Colors.info }}>CROSS-CATALOGUE RESEARCH</Text>
                          <Text style={{ fontSize: 11, color: Colors.textSecondary }}>
                            {refinedResult.coinResearch.candidates.length} catalogue lead(s) · results are candidates, not confirmed IDs
                          </Text>
                          {(refinedResult.coinResearch.candidates ?? []).slice(0, 8).map((candidate, index) => (
                            <View key={candidate.source + ':' + candidate.url + ':' + index} style={{ gap: 2, paddingTop: 5, borderTopWidth: index === 0 ? 0 : 1, borderTopColor: Colors.surfaceBorder }}>
                              <Text style={{ fontSize: 9, fontWeight: Typography.weight.bold, color: Colors.info }}>{candidate.source}{candidate.reference ? ' · ' + candidate.reference : ''}</Text>
                              <Text onPress={() => Linking.openURL(candidate.url)} style={{ fontSize: 11, color: Colors.textPrimary, textDecorationLine: 'underline' }}>{candidate.title}</Text>
                              {candidate.snippet ? <Text style={{ fontSize: 10, color: Colors.textSecondary }}>{candidate.snippet}</Text> : null}
                            </View>
                          ))}
                          <Text style={{ fontSize: 9, color: Colors.textTertiary }}>{refinedResult.coinResearch.note}</Text>
                        </View>
                      ) : null}
                      <View style={reid.comparisonActions}><Pressable onPress={() => setRefinedResult(null)} style={reid.comparisonRejectBtn}><MaterialIcons name="close" size={14} color={Colors.textSecondary} /><Text style={reid.comparisonRejectText}>Keep Original</Text></Pressable><Pressable onPress={handleAcceptRefined} style={reid.comparisonAcceptBtn}><MaterialIcons name="check" size={14} color={Colors.background} /><Text style={reid.comparisonAcceptText}>Use Refined</Text></Pressable></View>
                    </View>
                  ) : null}
                  <View style={reid.refinementFields}>
                    <View style={reid.refinementField}><Text style={reid.refinementFieldLabel}>Weight (grams)</Text><TextInput style={reid.refinementInput} value={refineWeight} onChangeText={setRefineWeight} keyboardType="decimal-pad" placeholder={item.weightGrams ? `Current: ${item.weightGrams}g` : 'e.g. 28.3'} placeholderTextColor={Colors.textTertiary} /></View>
                    <View style={reid.refinementField}><Text style={reid.refinementFieldLabel}>Diameter (mm)</Text><TextInput style={reid.refinementInput} value={refineDiameter} onChangeText={setRefineDiameter} keyboardType="decimal-pad" placeholder={item.diameterMm ? `Current: ${item.diameterMm}mm` : 'e.g. 38.6'} placeholderTextColor={Colors.textTertiary} /></View>
                  </View>
                  <View style={reid.refinementKeywordsWrap}><Text style={reid.refinementFieldLabel}>Additional Keywords / Context</Text><TextInput style={reid.refinementKeywordsInput} value={refineKeywords} onChangeText={setRefineKeywords} placeholder="e.g. Roman, hammered, worn" placeholderTextColor={Colors.textTertiary} multiline numberOfLines={2} /></View>
                  <Pressable onPress={handleRefineIdentification} disabled={refineLoading || (!refineWeight && !refineDiameter && !refineKeywords.trim())} style={[reid.refineScanBtn, (!refineWeight && !refineDiameter && !refineKeywords.trim()) && { opacity: 0.45 }]}>{refineLoading ? <ActivityIndicator size="small" color={Colors.background} /> : <MaterialIcons name="travel-explore" size={15} color={Colors.background} />}<Text style={reid.refineScanBtnText}>{refineLoading ? 'Re-scanning...' : 'Re-scan with Extra Data'}</Text></Pressable>
                </View>
              ) : null}
            </>
          ) : step === 'feedback' && result ? (
            <>
              <View style={reid.feedbackHeader}><MaterialIcons name="school" size={18} color={Colors.accent} /><View style={{ flex: 1 }}><Text style={reid.feedbackHeaderTitle}>Help the AI learn</Text><Text style={reid.feedbackHeaderSub} numberOfLines={2}>AI said: &quot;{result.canonicalTitle.slice(0, 60)}&quot;</Text></View></View>
              <Text style={reid.feedbackFormLabel}>WHAT WAS WRONG?</Text>
              <View style={reid.errorCategoryGrid}>{ERROR_CATEGORY_OPTIONS.map(opt => (<Pressable key={opt.value} onPress={() => setFeedbackCategory(opt.value)} style={[reid.errorCatChip, feedbackCategory === opt.value && reid.errorCatChipActive]}><Text style={[reid.errorCatText, feedbackCategory === opt.value && reid.errorCatTextActive]}>{opt.label}</Text></Pressable>))}</View>
              <Text style={[reid.feedbackFormLabel, { marginTop: Spacing.md }]}>CORRECT ANSWER (OPTIONAL)</Text>
              <TextInput style={reid.feedbackInput} value={feedbackNotes} onChangeText={setFeedbackNotes} placeholder={`What is this actually?`} placeholderTextColor={Colors.textTertiary} multiline numberOfLines={2} />
              <Text style={reid.learningNote}>Stored privately — used only to improve future Re-ID accuracy.</Text>
              <View style={reid.feedbackActions}><Pressable onPress={() => setStep('confirm')} style={reid.resultBtnSecondary}><Text style={reid.resultBtnSecondaryText}>Back</Text></Pressable><Pressable onPress={handleSubmitIncorrect} disabled={savingFeedback} style={reid.feedbackSubmitBtn}>{savingFeedback ? <ActivityIndicator size="small" color={Colors.background} /> : <MaterialIcons name="school" size={15} color={Colors.background} />}<Text style={reid.resultBtnPrimaryText}>{savingFeedback ? 'Saving...' : 'Submit & Keep Original'}</Text></Pressable></View>
            </>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

const reid = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.base, paddingTop: Spacing.lg, paddingBottom: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder },
  closeBtn: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center' },
  headerCenter: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xs },
  headerTitle: { fontSize: Typography.size.base, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  content: { padding: Spacing.base, gap: Spacing.xl, paddingBottom: 60 },
  contextCard: { backgroundColor: Colors.accentDim, borderRadius: Radius.lg, padding: Spacing.md, gap: 3, borderWidth: 1, borderColor: Colors.accent + '30' },
  contextLabel: { fontSize: 9, fontWeight: Typography.weight.bold, color: Colors.accent, letterSpacing: 0.5, textTransform: 'uppercase' },
  contextTitle: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  contextSub: { fontSize: Typography.size.xs, color: Colors.textTertiary, lineHeight: 16 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surface, borderRadius: Radius.md, padding: Spacing.md, borderWidth: 1, borderColor: Colors.surfaceBorder },
  toggleDot: { width: 20, height: 20, borderRadius: 10, backgroundColor: Colors.surfaceHighlight, borderWidth: 2, borderColor: Colors.surfaceBorder },
  toggleDotOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  toggleText: { flex: 1, fontSize: Typography.size.xs, color: Colors.textTertiary, lineHeight: 16 },
  sectionLabel: { fontSize: 10, fontWeight: Typography.weight.bold, color: Colors.textTertiary, letterSpacing: 0.6, textTransform: 'uppercase' },
  errorBanner: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start', backgroundColor: Colors.dangerDim, borderRadius: Radius.md, padding: Spacing.md, borderWidth: 1, borderColor: Colors.danger + '40' },
  errorText: { flex: 1, fontSize: Typography.size.xs, color: Colors.danger, lineHeight: 16 },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  slotLarge: { width: '100%', aspectRatio: 1.8 },
  slotSmall: { width: '31%', aspectRatio: 1 },
  slotEmpty: { flex: 1, borderRadius: Radius.lg, borderWidth: 1.5, borderStyle: 'dashed', borderColor: Colors.surfaceBorder, backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center', gap: 4, padding: Spacing.sm },
  slotActions: { flexDirection: 'row', gap: Spacing.xs },
  slotActionBtn: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.primaryDim, alignItems: 'center', justifyContent: 'center' },
  slotLabel: { fontSize: 10, color: Colors.textSecondary, fontWeight: Typography.weight.semibold, textAlign: 'center' },
  requiredPill: { backgroundColor: Colors.primaryDim, borderRadius: Radius.pill, paddingHorizontal: 6, paddingVertical: 2 },
  requiredText: { fontSize: 8, fontWeight: Typography.weight.bold, color: Colors.primary, textTransform: 'uppercase' },
  optionalText: { fontSize: 8, color: Colors.textTertiary, textTransform: 'uppercase' },
  slotCaptured: { flex: 1, borderRadius: Radius.lg, overflow: 'hidden', position: 'relative', borderWidth: 2, borderColor: Colors.success + '70' },
  capturedBar: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.6)', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 7, paddingVertical: 4, gap: 4 },
  capturedLabel: { flex: 1, fontSize: 9, color: '#fff', fontWeight: Typography.weight.semibold },
  removeBtn: { position: 'absolute', top: 5, right: 5, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 10, width: 18, height: 18, alignItems: 'center', justifyContent: 'center' },
  identifyBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, backgroundColor: Colors.accent, borderRadius: Radius.md, padding: Spacing.md, ...Shadow.glow },
  identifyBtnDisabled: { backgroundColor: Colors.surfaceHighlight, shadowOpacity: 0 },
  identifyBtnText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.background },
  processingView: { alignItems: 'center', gap: Spacing.lg, paddingVertical: Spacing.xxl },
  processingTitle: { fontSize: Typography.size.xl, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  processingMsg: { fontSize: Typography.size.sm, color: Colors.textSecondary },
  aiBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: Colors.accentDim, borderRadius: Radius.pill, paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs },
  aiBadgeText: { fontSize: Typography.size.xs, color: Colors.accent },
  objectTypeCard: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, backgroundColor: Colors.gold + '12', borderRadius: Radius.md, padding: Spacing.md, borderWidth: 1, borderColor: Colors.gold + '30' },
  objectTypeTitle: { fontSize: Typography.size.xs, fontWeight: Typography.weight.bold, color: Colors.gold, marginBottom: 2 },
  objectTypeText: { fontSize: Typography.size.xs, color: Colors.textSecondary, lineHeight: 15 },
  alterationCard: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, backgroundColor: Colors.dangerDim, borderRadius: Radius.md, padding: Spacing.md, borderWidth: 1, borderColor: Colors.danger + '40' },
  alterationTitle: { fontSize: Typography.size.xs, fontWeight: Typography.weight.bold, color: Colors.danger, marginBottom: 2 },
  alterationText: { fontSize: Typography.size.xs, color: Colors.danger + 'CC', lineHeight: 15 },
  confidencePct: { fontSize: Typography.size.md, fontWeight: Typography.weight.bold },
  compareCard: { backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.xs, borderWidth: 1, borderColor: Colors.warning + '40' },
  compareLabel: { fontSize: 9, fontWeight: Typography.weight.bold, color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5 },
  compareOld: { fontSize: Typography.size.sm, color: Colors.textTertiary, textDecorationLine: 'line-through', lineHeight: 18 },
  compareArrow: { alignItems: 'center', paddingVertical: 2 },
  compareNew: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.primary, lineHeight: 18 },
  uploadBanner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.primaryDim, borderRadius: Radius.md, padding: Spacing.md },
  uploadText: { fontSize: Typography.size.xs, color: Colors.primary },
  feedbackRow: { flexDirection: 'row', gap: Spacing.sm },
  feedbackBtnWrong: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, backgroundColor: Colors.dangerDim, borderRadius: Radius.md, paddingVertical: Spacing.md, borderWidth: 1, borderColor: Colors.danger + '40' },
  feedbackBtnWrongText: { fontSize: Typography.size.xs, fontWeight: Typography.weight.bold, color: Colors.danger },
  feedbackBtnPartial: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, backgroundColor: Colors.warning + '15', borderRadius: Radius.md, paddingVertical: Spacing.md, borderWidth: 1, borderColor: Colors.warning + '40' },
  feedbackBtnPartialText: { fontSize: Typography.size.xs, fontWeight: Typography.weight.bold, color: Colors.warning },
  feedbackBtnCorrect: { flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, backgroundColor: Colors.success, borderRadius: Radius.md, paddingVertical: Spacing.md },
  feedbackBtnCorrectText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.background },
  retakeLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: Spacing.sm },
  retakeLinkText: { fontSize: Typography.size.xs, color: Colors.textTertiary },
  feedbackHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md, backgroundColor: Colors.accentDim, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.accent + '30' },
  feedbackHeaderTitle: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  feedbackHeaderSub: { fontSize: Typography.size.xs, color: Colors.textTertiary, marginTop: 2, lineHeight: 16 },
  feedbackFormLabel: { fontSize: 10, fontWeight: Typography.weight.bold, color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5 },
  errorCategoryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs, marginTop: Spacing.xs },
  errorCatChip: { backgroundColor: Colors.surface, borderRadius: Radius.pill, paddingHorizontal: Spacing.md, paddingVertical: 7, borderWidth: 1, borderColor: Colors.surfaceBorder },
  errorCatChipActive: { backgroundColor: Colors.dangerDim, borderColor: Colors.danger + '60' },
  errorCatText: { fontSize: Typography.size.xs, color: Colors.textSecondary },
  errorCatTextActive: { color: Colors.danger, fontWeight: Typography.weight.semibold },
  feedbackInput: { backgroundColor: Colors.surface, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.surfaceBorder, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, fontSize: Typography.size.sm, color: Colors.textPrimary, lineHeight: 20, minHeight: 60, textAlignVertical: 'top', includeFontPadding: false, marginTop: Spacing.xs },
  learningNote: { fontSize: 10, color: Colors.textTertiary, lineHeight: 14, textAlign: 'center' },
  feedbackActions: { flexDirection: 'row', gap: Spacing.sm },
  feedbackSubmitBtn: { flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xs, backgroundColor: Colors.accent, borderRadius: Radius.md, padding: Spacing.md },
  resultBtnSecondary: { flex: 1, padding: Spacing.md, borderRadius: Radius.md, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.surfaceBorder, alignItems: 'center', justifyContent: 'center' },
  resultBtnSecondaryText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.textSecondary },
  resultBtnPrimaryText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.background },
  heroWrap: { borderRadius: Radius.xl, overflow: 'hidden', marginHorizontal: -Spacing.base, backgroundColor: '#0A0A0C' },
  heroImgsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.md, paddingVertical: Spacing.xl, paddingHorizontal: Spacing.base, minHeight: 200 },
  heroImgSlot: { width: '46%', aspectRatio: 1, borderRadius: Radius.lg, overflow: 'hidden' },
  heroImgImg: { width: '100%', height: '100%' },
  heroImgPlaceholder: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', borderStyle: 'dashed' },
  heroPlaceholderTxt: { fontSize: 9, color: 'rgba(255,255,255,0.15)', marginTop: 4, textTransform: 'uppercase', letterSpacing: 0.5 },
  heroTypeBadge: { position: 'absolute', top: Spacing.md, right: Spacing.md, borderRadius: Radius.pill, paddingHorizontal: Spacing.sm, paddingVertical: 4 },
  heroTypeBadgeTxt: { fontSize: 9, fontWeight: Typography.weight.bold, color: '#fff', letterSpacing: 0.5 },
  identBlock: { backgroundColor: Colors.surface, borderRadius: Radius.xl, padding: Spacing.md, gap: Spacing.sm, borderWidth: 1, borderColor: Colors.surfaceBorder },
  possiblePill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.warning + '15', borderRadius: Radius.pill, paddingHorizontal: Spacing.sm, paddingVertical: 4, borderWidth: 1, borderColor: Colors.warning + '30', alignSelf: 'flex-start' },
  possiblePillTxt: { fontSize: 9, fontWeight: Typography.weight.bold, color: Colors.warning, letterSpacing: 0.5 },
  confirmedPill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.success + '15', borderRadius: Radius.pill, paddingHorizontal: Spacing.sm, paddingVertical: 4, borderWidth: 1, borderColor: Colors.success + '30', alignSelf: 'flex-start' },
  confirmedPillTxt: { fontSize: 9, fontWeight: Typography.weight.bold, color: Colors.success, letterSpacing: 0.5 },
  identTitleNew: { fontSize: Typography.size.xl, fontWeight: Typography.weight.bold, color: Colors.textPrimary, lineHeight: 28 },
  confRowNew: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  confPillNew: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, borderRadius: Radius.pill, paddingHorizontal: Spacing.md, paddingVertical: 7, borderWidth: 1, alignSelf: 'flex-start' },
  confPctNew: { fontSize: Typography.size.base, fontWeight: Typography.weight.bold },
  confSepNew: { width: 1, height: 14, opacity: 0.5 },
  confLblNew: { fontSize: 10, fontWeight: Typography.weight.bold, letterSpacing: 0.5, textTransform: 'uppercase' },
  provisionalAdvice: { fontSize: Typography.size.xs, color: Colors.warning, lineHeight: 16 },
  confReasonNew: { fontSize: 10, color: Colors.textTertiary, lineHeight: 14 },
  expandHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.surfaceBorder },
  expandHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flex: 1 },
  expandHeaderTitle: { fontSize: Typography.size.xs, fontWeight: Typography.weight.bold, color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 },
  expandContent: { backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.sm, borderWidth: 1, borderColor: Colors.surfaceBorder },
  evidRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  evidTxt: { flex: 1, fontSize: Typography.size.xs, color: Colors.textSecondary, lineHeight: 16 },
  actionSep: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  actionSepLine: { flex: 1, height: 1, backgroundColor: Colors.surfaceBorder },
  actionSepTxt: { fontSize: 9, fontWeight: Typography.weight.bold, color: Colors.textTertiary, letterSpacing: 0.5, textTransform: 'uppercase' },
  refinementToggle: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.infoDim, borderRadius: Radius.md, padding: Spacing.md, borderWidth: 1, borderColor: Colors.info + '30' },
  refinementToggleText: { flex: 1, fontSize: Typography.size.xs, color: Colors.info, fontWeight: Typography.weight.semibold },
  refinementCard: { backgroundColor: Colors.surface, borderRadius: Radius.xl, padding: Spacing.md, gap: Spacing.md, borderWidth: 1, borderColor: Colors.info + '30' },
  refinementTitle: { fontSize: 9, fontWeight: Typography.weight.bold, color: Colors.info, textTransform: 'uppercase', letterSpacing: 0.5 },
  refinementFields: { flexDirection: 'row', gap: Spacing.sm },
  refinementField: { flex: 1, gap: 4 },
  refinementFieldLabel: { fontSize: 10, fontWeight: Typography.weight.semibold, color: Colors.textTertiary, letterSpacing: 0.3 },
  refinementInput: { backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.surfaceBorder, paddingHorizontal: Spacing.sm, paddingVertical: 8, fontSize: Typography.size.xs, color: Colors.textPrimary, includeFontPadding: false },
  refinementKeywordsWrap: { gap: 4 },
  refinementKeywordsInput: { backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.surfaceBorder, paddingHorizontal: Spacing.sm, paddingVertical: 8, fontSize: Typography.size.xs, color: Colors.textPrimary, minHeight: 56, textAlignVertical: 'top', includeFontPadding: false },
  refineScanBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, backgroundColor: Colors.info, borderRadius: Radius.md, paddingVertical: Spacing.md },
  refineScanBtnText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.background },
  comparisonCard: { backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.sm, borderWidth: 1, borderColor: Colors.primary + '30' },
  comparisonLabel: { fontSize: 9, fontWeight: Typography.weight.bold, color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5 },
  comparisonRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  comparisonTitle: { flex: 1, fontSize: Typography.size.xs, fontWeight: Typography.weight.semibold, color: Colors.textPrimary, lineHeight: 16 },
  comparisonDivider: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, paddingVertical: 2 },
  comparisonDividerText: { fontSize: 9, fontWeight: Typography.weight.bold, color: Colors.primary, letterSpacing: 0.4 },
  comparisonActions: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.xs },
  comparisonRejectBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, backgroundColor: Colors.surface, borderRadius: Radius.md, paddingVertical: 8, borderWidth: 1, borderColor: Colors.surfaceBorder },
  comparisonRejectText: { fontSize: Typography.size.xs, color: Colors.textSecondary, fontWeight: Typography.weight.semibold },
  comparisonAcceptBtn: { flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, backgroundColor: Colors.primary, borderRadius: Radius.md, paddingVertical: 8 },
  comparisonAcceptText: { fontSize: Typography.size.xs, fontWeight: Typography.weight.bold, color: Colors.background },
  confBadge: { width: 34, height: 34, borderRadius: Radius.sm, alignItems: 'center', justifyContent: 'center', borderWidth: 2, backgroundColor: Colors.surfaceHighlight },
});

// ─────────────────────────────────────────────────────────────────────────────
// MARKET VALUE PANEL  (unchanged — full implementation retained)
// ─────────────────────────────────────────────────────────────────────────────

const CONF_COLORS: Record<string, string> = {
  high: Colors.success, medium: Colors.warning, low: Colors.warning,
  very_low: Colors.danger, insufficient_data: Colors.textTertiary, unknown: Colors.textTertiary,
};

function MvStatRow({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <View style={mv.statRow}>
      <Text style={mv.statLabel}>{label}</Text>
      <Text style={[mv.statValue, accent ? { color: accent } : undefined]}>{value}</Text>
    </View>
  );
}

// ── Niche evidence helpers ───────────────────────────────────────────────────
function isCoinNiche(specialistId: string | undefined): boolean {
  const id = specialistId ?? '';
  return id === 'coins' || id === 'coins_uk' || id === 'coins_world' ||
    id === 'islamic_silver' || id === 'banknotes' || id === 'gold' ||
    id === 'silver' || id === 'ancient_artefacts' || id === 'curiosities_collectibles' ||
    id.includes('coin') || id.includes('numismatic');
}

function getNicheEvidenceLabel(specialistId: string | undefined): string {
  const id = specialistId ?? '';
  if (id === 'motocross') return 'Motocross / off-road eBay sold comps';
  if (id === 'bicycles' || id === 'cycling') return 'MTB & road bike eBay sold comps';
  if (id === 'clothing' || id === 'trainers_sneakers') return 'Vintage & streetwear eBay sold comps';
  return 'eBay sold + Numista catalogue';
}

function MarketValuePanel({
  item, tenantId, onUpdated, externalResult,
}: { item: Item; tenantId: string; onUpdated: (updates: Partial<Item>, mv?: MarketValueResult) => void; externalResult?: MarketValueResult | null }) {
  const { showAlert } = useAlert();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<MarketValueResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (externalResult) { setResult(externalResult); setExpanded(true); }
  }, [externalResult]);

  const hasValuation = item.valuationMid > 0;
  const confColor = CONF_COLORS[item.valuationConfidence as string ?? 'unknown'] ?? Colors.textTertiary;

  const handleReValue = useCallback(async () => {
    setLoading(true); setError(null);
    const attrs = item.attributes ?? {};
    const coinNiche = isCoinNiche(item.specialistId);
    const numistaTypeId = coinNiche && attrs['numista_type_id'] ? Number(attrs['numista_type_id']) : (coinNiche && attrs['numista_candidate_id'] ? Number(attrs['numista_candidate_id']) : null);
    const numistaMatchScore = coinNiche ? (attrs['numista_match_score'] ? Number(attrs['numista_match_score']) : 0) : 0;
    const numistaMatchTier = coinNiche ? (attrs['numista_status'] ?? (numistaTypeId ? 'candidate' : 'no_match')) : 'unavailable';
    const { result: mv, error: mvErr } = await getMarketValue({
      tenantId, itemId: item.id, title: item.canonicalTitle, specialistId: item.specialistId,
      attributes: { ...(item.attributes ?? {}), ruler: item.ruler, denomination: item.denomination, year_made: item.yearMade, period: item.period, mint: item.mint, material: item.material, weight: item.weightGrams, diameter: item.diameterMm, country: item.countryOfOrigin },
      condition: item.condition, identificationConfidence: item.identificationConfidence,
      identificationTier: item.valuationConfidence as string ?? 'medium',
      numistaTypeId, numistaMatchScore, numistaMatchTier, applyToItem: true,
      imageUrls: (item.media ?? []).filter((u: string) => typeof u === 'string' && u.startsWith('https://')),
    });
    setLoading(false);
    if (mvErr || !mv) { setError(mvErr ?? 'Market value lookup failed'); return; }
    setResult(mv); setExpanded(true);
    const val = mv.valuation;
    const listPrice = val.recommendedListingPrice ?? val.valuationMid;
    const updates: Partial<Item> = {
      valuationLow: val.valuationLow, valuationMid: val.valuationMid, valuationHigh: val.valuationHigh,
      valuationConfidence: val.valuationConfidence as any, expectedSellingPrice: listPrice,
      expectedNet: listPrice * 0.8725, expectedProfit: listPrice * 0.8725 - (item.acquiredCost ?? 0),
      saleProb30d: val.saleProb30d ?? item.saleProb30d,
    };
    await updateItem(item.id, updates, tenantId);
    onUpdated(updates, mv);
  }, [item, tenantId, onUpdated]);

  const sm = result?.soldMarket;
  const val = result?.valuation;
  const numista = result?.numista;
  const ds = result?.dataSource;
  const coinNichePanel = isCoinNiche(item.specialistId);
  const evidenceLabel = getNicheEvidenceLabel(item.specialistId);

  return (
    <View style={mv.panel}>
      <Pressable onPress={() => setExpanded(e => !e)} style={mv.panelHeader}>
        <View style={mv.panelHeaderLeft}>
          <View style={[mv.panelIcon, { backgroundColor: Colors.gold + '20' }]}>
            <MaterialIcons name="bar-chart" size={14} color={Colors.gold} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[mv.panelTitle, { color: Colors.gold }]}>MARKET VALUE</Text>
            {hasValuation ? (
              <View style={mv.panelSubRow}>
                <Text style={mv.panelRange}>£{item.valuationLow.toFixed(0)}–£{item.valuationHigh.toFixed(0)}</Text>
                <View style={[mv.confBadge, { backgroundColor: confColor + '20', borderColor: confColor + '40' }]}>
                  <Text style={[mv.confBadgeText, { color: confColor }]}>{(item.valuationConfidence as string ?? 'unknown').replace(/_/g, ' ')}</Text>
                </View>
              </View>
            ) : (
              <Text style={mv.panelNoData}>Market value not established — tap Re-Value</Text>
            )}
          </View>
        </View>
        <View style={mv.panelHeaderRight}>
          {!loading ? (
            <Pressable onPress={handleReValue} style={({ pressed }) => [mv.reValueBtn, pressed && { opacity: 0.8 }]} hitSlop={4}>
              <MaterialIcons name="travel-explore" size={13} color={Colors.background} />
              <Text style={mv.reValueBtnText}>Re-Value</Text>
            </Pressable>
          ) : (
            <View style={[mv.reValueBtn, { backgroundColor: Colors.textTertiary }]}>
              <ActivityIndicator size="small" color={Colors.background} style={{ width: 13, height: 13 }} />
              <Text style={mv.reValueBtnText}>Searching...</Text>
            </View>
          )}
          {(hasValuation || result) ? (
            <MaterialIcons name={expanded ? 'keyboard-arrow-up' : 'keyboard-arrow-down'} size={18} color={Colors.textTertiary} />
          ) : null}
        </View>
      </Pressable>

      {error ? (
        <View style={mv.errorRow}>
          <MaterialIcons name="error-outline" size={13} color={Colors.danger} />
          <Text style={mv.errorText} numberOfLines={2}>{error}</Text>
        </View>
      ) : null}

      {!expanded && hasValuation && !result ? (
        <View style={mv.collapsedSummary}>
          <View style={mv.valRow}>
            <View style={mv.valItem}><Text style={mv.valLabel}>LOW</Text><Text style={mv.valValueSm}>£{item.valuationLow.toFixed(2)}</Text></View>
            <View style={[mv.valItem, mv.valItemMid]}><Text style={mv.valLabel}>MID</Text><Text style={mv.valValueMid}>£{item.valuationMid.toFixed(2)}</Text></View>
            <View style={mv.valItem}><Text style={mv.valLabel}>HIGH</Text><Text style={mv.valValueSm}>£{item.valuationHigh.toFixed(2)}</Text></View>
          </View>
        </View>
      ) : null}

      {expanded && result && val ? (
        <View style={mv.expandedContent}>
          <View style={mv.valRow}>
            <View style={mv.valItem}><Text style={mv.valLabel}>LOW</Text><Text style={mv.valValueSm}>£{val.valuationLow.toFixed(2)}</Text></View>
            <View style={[mv.valItem, mv.valItemMid]}><Text style={mv.valLabel}>FAIR MKT</Text><Text style={mv.valValueMid}>£{val.valuationMid.toFixed(2)}</Text></View>
            <View style={mv.valItem}><Text style={mv.valLabel}>HIGH</Text><Text style={mv.valValueSm}>£{val.valuationHigh.toFixed(2)}</Text></View>
          </View>
          {coinNichePanel && result?.numistaSales?.available && result.numistaSales.relevantCount > 0 ? (
            <View style={mv.sourceProvenanceRow}>
              <View style={mv.sourceChip}><MaterialIcons name="verified" size={10} color={Colors.success} /><Text style={[mv.sourceChipText, { color: Colors.success }]}>{`Numista: ${result.numistaSales.numistaN} · ${result.numistaSales.relevantCount} sale${result.numistaSales.relevantCount === 1 ? '' : 's'}`}</Text></View>
            </View>
          ) : null}
          {result?.soldMarket && result.soldMarket.relevantSoldCount > 0 ? (
            <View style={mv.sourceProvenanceRow}>
              <View style={mv.sourceChip}><MaterialIcons name="shopping-bag" size={10} color={Colors.primary} /><Text style={[mv.sourceChipText, { color: Colors.primary }]}>{`${result.soldMarket.relevantSoldCount} verified sold · ${evidenceLabel}`}</Text></View>
            </View>
          ) : null}
          <View style={mv.recListingCard}>
            <View style={mv.recListingHeader}>
              <MaterialIcons name={val.recommendedListingFormat === 'Auction' ? 'gavel' : 'sell'} size={13} color={Colors.primary} />
              <Text style={mv.recListingTitle}>{val.recommendedListingFormat === 'Auction' ? 'Recommended: Auction' : val.recommendedListingFormat === 'BuyItNow_WithBestOffer' ? 'Recommended: BIN + Best Offer' : 'Recommended: Buy It Now'}</Text>
              <Text style={mv.recListingPrice}>£{val.recommendedListingPrice.toFixed(2)}</Text>
            </View>
            {val.listingPriceRationale ? <Text style={mv.recListingNote} numberOfLines={2}>{val.listingPriceRationale}</Text> : null}
          </View>
          <View style={mv.divider} />
          <Text style={mv.sectionLabel}>VERIFIED SOLD MARKET</Text>
          {sm && sm.verifiedSoldCount > 0 ? (
            <View style={mv.statsBlock}>
              <MvStatRow label="Verified sold" value={`${sm.verifiedSoldCount} found`} />
              <MvStatRow label="Relevant used" value={`${sm.relevantSoldCount}`} accent={sm.relevantSoldCount >= 5 ? Colors.success : Colors.warning} />
              <MvStatRow label="Median sold" value={`£${(sm.medianPrice ?? 0).toFixed(2)}`} accent={Colors.gold} />
              <MvStatRow label="Sold range" value={`£${(sm.lowPrice ?? 0).toFixed(2)} – £${(sm.highPrice ?? 0).toFixed(2)}`} />
              {sm.dateRange && sm.dateRange !== 'unknown' ? <MvStatRow label="Date range" value={sm.dateRange} /> : null}
            </View>
          ) : (
            <View style={mv.noDataRow}><MaterialIcons name="search-off" size={13} color={Colors.textTertiary} /><Text style={mv.noDataText}>No verified sold data found</Text></View>
          )}
          {coinNichePanel && numista ? (
            <>
              <View style={mv.divider} />
              <Text style={mv.sectionLabel}>NUMISTA CATALOGUE</Text>
              <View style={[mv.numistaCard, { borderColor: numista.accepted ? Colors.success + '40' : Colors.warning + '40' }]}>
                <View style={mv.numistaHeader}>
                  <MaterialIcons name={numista.accepted ? 'verified' : 'help-outline'} size={13} color={numista.accepted ? Colors.success : Colors.warning} />
                  <Text style={[mv.numistaTitle, { color: numista.accepted ? Colors.success : Colors.warning }]} numberOfLines={2}>{numista.title ?? `N#${numista.typeId}`}</Text>
                  {numista.typeId ? <View style={mv.nBadge}><Text style={mv.nBadgeText}>N#{numista.typeId}</Text></View> : null}
                </View>
                {numista.typeId ? (
                  <Pressable onPress={() => Linking.openURL(`https://numista.com/${numista.typeId}`)} style={({ pressed }) => [mv.numistaViewLink, pressed && { opacity: 0.7 }]} hitSlop={8}>
                    <MaterialIcons name="open-in-new" size={11} color={Colors.info} /><Text style={mv.numistaViewLinkText}>View on Numista</Text>
                  </Pressable>
                ) : null}
              </View>
            </>
          ) : !coinNichePanel && result?.soldMarket && result.soldMarket.relevantSoldCount > 0 ? (
            <>
              <View style={mv.divider} />
              <Text style={mv.sectionLabel}>EVIDENCE SOURCE</Text>
              <View style={[mv.numistaCard, { borderColor: Colors.primary + '30' }]}>
                <View style={mv.numistaHeader}>
                  <MaterialIcons name="analytics" size={13} color={Colors.primary} />
                  <Text style={[mv.numistaTitle, { color: Colors.primary }]}>{evidenceLabel}</Text>
                </View>
                <Text style={{ fontSize: 10, color: Colors.textTertiary, marginTop: 4, lineHeight: 14 }}>
                  {result.soldMarket.relevantSoldCount} relevant sold comparables · verified eBay UK transactions only · no Numista used
                </Text>
              </View>
            </>
          ) : null}
          {ds ? (
            <><View style={mv.divider} /><View style={mv.dsRow}><MaterialIcons name="storage" size={11} color={Colors.textTertiary} /><Text style={mv.dsText}>{coinNichePanel ? `eBay sold: ${ds.findingApiTotal} · Active: ${ds.browseApiActive} · Numista: ${ds.numistaFound}` : `eBay sold: ${ds.findingApiTotal} · Active: ${ds.browseApiActive}`}</Text></View></>
          ) : null}
        </View>
      ) : null}
      {expanded && !result && hasValuation ? (
        <View style={mv.expandedContent}>
          <View style={mv.valRow}>
            <View style={mv.valItem}><Text style={mv.valLabel}>LOW</Text><Text style={mv.valValueSm}>£{item.valuationLow.toFixed(2)}</Text></View>
            <View style={[mv.valItem, mv.valItemMid]}><Text style={mv.valLabel}>MID</Text><Text style={mv.valValueMid}>£{item.valuationMid.toFixed(2)}</Text></View>
            <View style={mv.valItem}><Text style={mv.valLabel}>HIGH</Text><Text style={mv.valValueSm}>£{item.valuationHigh.toFixed(2)}</Text></View>
          </View>
          <Text style={mv.staleNote}>Tap Re-Value to refresh with current eBay sold data</Text>
        </View>
      ) : null}
    </View>
  );
}

const mv = StyleSheet.create({
  panel: { backgroundColor: Colors.surface, borderRadius: Radius.xl, borderWidth: 1, borderColor: Colors.gold + '30', overflow: 'hidden', ...Shadow.sm },
  panelHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: Spacing.md, gap: Spacing.sm },
  panelHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flex: 1 },
  panelHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  panelIcon: { width: 28, height: 28, borderRadius: Radius.sm, alignItems: 'center', justifyContent: 'center' },
  panelTitle: { fontSize: 10, fontWeight: Typography.weight.bold, textTransform: 'uppercase', letterSpacing: 0.6 },
  panelSubRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, marginTop: 2 },
  panelRange: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  panelNoData: { fontSize: Typography.size.xs, color: Colors.textTertiary, marginTop: 2 },
  confBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: Radius.pill, borderWidth: 1 },
  confBadgeText: { fontSize: 9, fontWeight: Typography.weight.bold, textTransform: 'uppercase', letterSpacing: 0.3 },
  reValueBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.primary, borderRadius: Radius.pill, paddingHorizontal: Spacing.md, paddingVertical: 7, ...Shadow.sm },
  reValueBtnText: { fontSize: 11, fontWeight: Typography.weight.bold, color: Colors.background },
  errorRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.xs, backgroundColor: Colors.dangerDim, padding: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.danger + '30' },
  errorText: { flex: 1, fontSize: Typography.size.xs, color: Colors.danger, lineHeight: 16 },
  collapsedSummary: { paddingHorizontal: Spacing.md, paddingBottom: Spacing.md, borderTopWidth: 1, borderTopColor: Colors.surfaceBorder },
  expandedContent: { paddingHorizontal: Spacing.md, paddingBottom: Spacing.md, gap: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.surfaceBorder, paddingTop: Spacing.md },
  divider: { height: 1, backgroundColor: Colors.surfaceBorder, marginVertical: Spacing.xs },
  sectionLabel: { fontSize: 9, fontWeight: Typography.weight.bold, color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 },
  valRow: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: Spacing.sm },
  valItem: { alignItems: 'center', gap: 3, flex: 1 },
  valItemMid: { backgroundColor: Colors.goldDim, borderRadius: Radius.lg, paddingVertical: Spacing.xs, paddingHorizontal: Spacing.sm },
  valLabel: { fontSize: 8, color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.3 },
  valValueSm: { fontSize: Typography.size.md, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  valValueMid: { fontSize: Typography.size.xl, fontWeight: Typography.weight.bold, color: Colors.gold },
  recListingCard: { backgroundColor: Colors.primaryDim, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.xs, borderWidth: 1, borderColor: Colors.primary + '30' },
  recListingHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  recListingTitle: { flex: 1, fontSize: Typography.size.xs, fontWeight: Typography.weight.semibold, color: Colors.primary },
  recListingPrice: { fontSize: Typography.size.md, fontWeight: Typography.weight.bold, color: Colors.primary },
  recListingNote: { fontSize: Typography.size.xs, color: Colors.textSecondary, lineHeight: 16 },
  statsBlock: { gap: 2 },
  statRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder + '80' },
  statLabel: { fontSize: Typography.size.xs, color: Colors.textTertiary },
  statValue: { fontSize: Typography.size.xs, fontWeight: Typography.weight.semibold, color: Colors.textPrimary },
  numistaCard: { backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.xs, borderWidth: 1 },
  numistaHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.xs },
  numistaTitle: { flex: 1, fontSize: Typography.size.xs, fontWeight: Typography.weight.semibold, lineHeight: 16 },
  numistaViewLink: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4, alignSelf: 'flex-start', backgroundColor: Colors.info + '15', borderRadius: Radius.sm, paddingHorizontal: 7, paddingVertical: 4, borderWidth: 1, borderColor: Colors.info + '30' },
  numistaViewLinkText: { fontSize: 10, color: Colors.info, fontWeight: Typography.weight.semibold },
  nBadge: { backgroundColor: Colors.primaryDim, borderRadius: Radius.pill, paddingHorizontal: 6, paddingVertical: 2, marginLeft: 'auto' as any },
  nBadgeText: { fontSize: 9, fontWeight: Typography.weight.bold, color: Colors.primary, letterSpacing: 0.3 },
  noDataRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, paddingVertical: Spacing.xs },
  noDataText: { fontSize: Typography.size.xs, color: Colors.textTertiary },
  sourceProvenanceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  sourceChip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.pill, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: Colors.surfaceBorder },
  sourceChipText: { fontSize: 10, color: Colors.textTertiary, fontWeight: Typography.weight.semibold },
  dsRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 5 },
  dsText: { flex: 1, fontSize: 10, color: Colors.textTertiary, lineHeight: 14 },
  staleNote: { fontSize: Typography.size.xs, color: Colors.textTertiary, textAlign: 'center', paddingVertical: Spacing.xs },
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION HEADER COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

// ── SUBMIT PROGRESS MODAL ────────────────────────────────────────────────────────────

const SL_SUBMIT_STEPS: Array<{
  id: SubmitStep;
  label: string;
  sublabel: string;
  icon: string;
}> = [
  { id: 'verifying',          label: 'Verifying listing',      sublabel: 'Checking title, price and item data',        icon: 'fact-check' },
  { id: 'checking_policies',  label: 'Checking eBay policies', sublabel: 'Validating fulfillment and return policies',   icon: 'policy' },
  { id: 'resolving_category', label: 'Resolving category',     sublabel: 'Confirming leaf category with eBay Taxonomy', icon: 'category' },
  { id: 'publishing',         label: 'Publishing to eBay',     sublabel: 'Sending listing to eBay Trading API',         icon: 'send' },
];

type SlStepState = 'idle' | 'active' | 'done' | 'failed';

function getSlStepState(stepId: SubmitStep, currentStep: SubmitStep | null, failed: boolean): SlStepState {
  const order = SL_SUBMIT_STEPS.map(s => s.id);
  const currentIdx = currentStep ? order.indexOf(currentStep) : -1;
  const stepIdx = order.indexOf(stepId);
  if (currentStep === 'done') return 'done';
  if (failed && currentStep === stepId) return 'failed';
  if (stepIdx < currentIdx) return 'done';
  if (stepIdx === currentIdx) return failed ? 'failed' : 'active';
  return 'idle';
}

function SubmitProgressModal({
  visible, currentStep, listingTitle, failed,
}: {
  visible: boolean;
  currentStep: SubmitStep | null;
  listingTitle?: string;
  failed: boolean;
}) {
  const isDone = currentStep === 'done';
  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={slspm.overlay}>
        <View style={slspm.card}>
          <View style={slspm.header}>
            <View style={slspm.headerIconWrap}>
              {isDone ? (
                <MaterialIcons name="check-circle" size={22} color={Colors.success} />
              ) : failed ? (
                <MaterialIcons name="error" size={22} color={Colors.danger} />
              ) : (
                <ActivityIndicator size="small" color={Colors.primary} />
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={slspm.headerTitle}>
                {isDone ? 'Listed on eBay!' : failed ? 'Submission Failed' : 'Submitting to eBay'}
              </Text>
              {listingTitle ? (
                <Text style={slspm.headerSub} numberOfLines={1}>{listingTitle}</Text>
              ) : null}
            </View>
          </View>
          <View style={slspm.steps}>
            {SL_SUBMIT_STEPS.map(step => {
              const state = getSlStepState(step.id, currentStep, failed);
              const iconColor =
                state === 'done'   ? Colors.success :
                state === 'active' ? Colors.primary  :
                state === 'failed' ? Colors.danger   :
                Colors.textTertiary;
              const bgColor =
                state === 'done'   ? Colors.successDim :
                state === 'active' ? Colors.primaryDim :
                state === 'failed' ? Colors.danger + '15' :
                Colors.surfaceHighlight;
              return (
                <View key={step.id} style={slspm.stepRow}>
                  <View style={[slspm.stepIconWrap, { backgroundColor: bgColor }]}>
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
                  <View style={slspm.stepText}>
                    <Text style={[slspm.stepLabel, { color: iconColor }]}>{step.label}</Text>
                    <Text style={slspm.stepSublabel}>{step.sublabel}</Text>
                  </View>
                </View>
              );
            })}
          </View>
          {!isDone && !failed ? (
            <Text style={slspm.footerNote}>Please wait — do not close the app</Text>
          ) : isDone ? (
            <Text style={[slspm.footerNote, { color: Colors.success }]}>Your listing is now live on eBay UK</Text>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const slspm = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', alignItems: 'center', justifyContent: 'center', padding: Spacing.xl },
  card: { backgroundColor: Colors.surface, borderRadius: Radius.xxl, padding: Spacing.lg, width: '100%', maxWidth: 380, gap: Spacing.md, borderWidth: 1, borderColor: Colors.surfaceBorder },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingBottom: Spacing.sm, borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder },
  headerIconWrap: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.surfaceHighlight, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  headerTitle: { fontSize: Typography.size.base, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  headerSub: { fontSize: Typography.size.xs, color: Colors.textTertiary, marginTop: 2 },
  steps: { gap: Spacing.sm },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  stepIconWrap: { width: 34, height: 34, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  stepText: { flex: 1, gap: 1 },
  stepLabel: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.textPrimary },
  stepSublabel: { fontSize: Typography.size.xs, color: Colors.textTertiary, lineHeight: 15 },
  footerNote: { fontSize: Typography.size.xs, color: Colors.textTertiary, textAlign: 'center', paddingTop: Spacing.xs },
});

// ── SECTION HEADER COMPONENT ─────────────────────────────────────────────────────────

function SectionHeader({ icon, label, color = Colors.primary, action, actionLabel }: {
  icon: string; label: string; color?: string; action?: () => void; actionLabel?: string;
}) {
  return (
    <View style={sh.row}>
      <View style={[sh.iconWrap, { backgroundColor: color + '20' }]}>
        <MaterialIcons name={icon as any} size={13} color={color} />
      </View>
      <Text style={[sh.label, { color }]}>{label}</Text>
      {action && actionLabel ? (
        <Pressable onPress={action} style={sh.actionBtn} hitSlop={6}>
          <MaterialIcons name="edit" size={11} color={color} />
          <Text style={[sh.actionBtnText, { color }]}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const sh = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  iconWrap: { width: 24, height: 24, borderRadius: Radius.sm, alignItems: 'center', justifyContent: 'center' },
  label: { flex: 1, fontSize: 10, fontWeight: Typography.weight.bold, textTransform: 'uppercase', letterSpacing: 0.6 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 8, paddingVertical: 4, borderRadius: Radius.pill, backgroundColor: Colors.surfaceHighlight, borderWidth: 1, borderColor: Colors.surfaceBorder },
  actionBtnText: { fontSize: 10, fontWeight: Typography.weight.semibold },
});

// ─────────────────────────────────────────────────────────────────────────────
// DATA ROW COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

function DataRow({ label, value, accent, missing }: { label: string; value?: string | null; accent?: string; missing?: string }) {
  if (!value) {
    return (
      <View style={dr.row}>
        <Text style={dr.label}>{label}</Text>
        <Text style={dr.missing}>{missing ?? 'Not recorded'}</Text>
      </View>
    );
  }
  return (
    <View style={dr.row}>
      <Text style={dr.label}>{label}</Text>
      <Text style={[dr.value, accent ? { color: accent } : undefined]} numberOfLines={2}>{value}</Text>
    </View>
  );
}

const dr = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: Spacing.xs + 2, borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder + '80' },
  label: { width: 110, fontSize: Typography.size.xs, color: Colors.textTertiary, paddingTop: 1, flexShrink: 0 },
  value: { flex: 1, fontSize: Typography.size.xs, color: Colors.textPrimary, lineHeight: 17 },
  missing: { flex: 1, fontSize: Typography.size.xs, color: Colors.textTertiary, fontStyle: 'italic' },
});

// ─────────────────────────────────────────────────────────────────────────────
// EDITABLE FIELD ROW
// ─────────────────────────────────────────────────────────────────────────────

function FieldRow({ label, value, onEdit, editValue, onChangeText, onSave, onCancel, editing, numeric, multiline, placeholder, accent }: {
  label: string; value: string; onEdit?: () => void; editValue?: string;
  onChangeText?: (v: string) => void; onSave?: () => void; onCancel?: () => void;
  editing?: boolean; numeric?: boolean; multiline?: boolean; placeholder?: string; accent?: string;
}) {
  return (
    <View style={fr.row}>
      <Text style={fr.label}>{label}</Text>
      {editing ? (
        <View style={fr.editWrap}>
          <TextInput
            style={[fr.input, multiline && fr.inputMulti]}
            value={editValue}
            onChangeText={onChangeText}
            keyboardType={numeric ? 'decimal-pad' : 'default'}
            multiline={multiline}
            numberOfLines={multiline ? 3 : 1}
            autoFocus
            placeholder={placeholder}
            placeholderTextColor={Colors.textTertiary}
          />
          <View style={fr.editActions}>
            <Pressable onPress={onSave} style={fr.saveBtn} hitSlop={6}><MaterialIcons name="check" size={13} color={Colors.background} /></Pressable>
            <Pressable onPress={onCancel} style={fr.cancelBtn} hitSlop={6}><MaterialIcons name="close" size={13} color={Colors.textTertiary} /></Pressable>
          </View>
        </View>
      ) : (
        <Pressable onPress={onEdit} style={fr.valueWrap} hitSlop={4}>
          <Text style={[fr.value, accent && { color: accent }]} numberOfLines={multiline ? 5 : 2}>{value || '—'}</Text>
          {onEdit ? <MaterialIcons name="edit" size={11} color={Colors.textTertiary} /> : null}
        </Pressable>
      )}
    </View>
  );
}

const fr = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: Spacing.sm, borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder },
  label: { width: 120, fontSize: Typography.size.xs, color: Colors.textTertiary, paddingTop: 2, flexShrink: 0 },
  valueWrap: { flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  value: { flex: 1, fontSize: Typography.size.sm, color: Colors.textPrimary, lineHeight: 18 },
  editWrap: { flex: 1, gap: 6 },
  input: { backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.sm, borderWidth: 1, borderColor: Colors.primary + '60', paddingHorizontal: Spacing.sm, paddingVertical: 5, fontSize: Typography.size.sm, color: Colors.textPrimary, includeFontPadding: false },
  inputMulti: { minHeight: 64, textAlignVertical: 'top' },
  editActions: { flexDirection: 'row', gap: Spacing.xs },
  saveBtn: { width: 26, height: 26, borderRadius: Radius.sm, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  cancelBtn: { width: 26, height: 26, borderRadius: Radius.sm, backgroundColor: Colors.surfaceHighlight, alignItems: 'center', justifyContent: 'center' },
});

// ─────────────────────────────────────────────────────────────────────────────
// MAIN SCREEN
// ─────────────────────────────────────────────────────────────────────────────

export default function StockListingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { tenant, businessConfig } = useApp();
  const { showAlert } = useAlert();

  const [item, setItem] = useState<Item | null>(null);
  const [listings, setListings] = useState<SavedListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generatingListing, setGeneratingListing] = useState(false);
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [endingId, setEndingId] = useState<string | null>(null);

  // Submit progress modal
  const [progressVisible, setProgressVisible] = useState(false);
  const [progressStep, setProgressStep] = useState<SubmitStep | null>(null);
  const [progressTitle, setProgressTitle] = useState('');
  const [progressFailed, setProgressFailed] = useState(false);
  const [reIdVisible, setReIdVisible] = useState(false);
  const [fetchingImage, setFetchingImage] = useState(false);
  const [fetchImageResult, setFetchImageResult] = useState<{ downloaded: number; failed: number; requiresReauth?: boolean } | null>(null);
  const [syncingEbay, setSyncingEbay] = useState(false);
  const [pushingToEbay, setPushingToEbay] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [reValueResult, setReValueResult] = useState<MarketValueResult | null>(null);
  const [commercialIntel, setCommercialIntel] = useState<ItemCommercialIntelligence | null>(null);

  // SWISH Intelligence expandable state
  const [intelligenceExpanded, setIntelligenceExpanded] = useState(false);
  const [attributesExpanded, setAttributesExpanded] = useState(false);
  const [savingMXGrade, setSavingMXGrade] = useState(false);

  // eBay visual evidence state
  const [ebayVisualResult, setEbayVisualResult] = useState<EbayVisualSearchResult | null>(null);
  const [ebayVisualLoading, setEbayVisualLoading] = useState(false);
  const [ebayVisualExpanded, setEbayVisualExpanded] = useState(false);

  // Inline text editors for marketplace fields
  const [editingTitle, setEditingTitle] = useState(false);
  const [editingDesc, setEditingDesc] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [descDraft, setDescDraft] = useState('');

  const load = useCallback(async () => {
    if (!id) { setLoading(false); return; }
    const [itemRes, listingsRes] = await Promise.all([getItem(id), getItemListings(id)]);
    setItem(itemRes.item);
    const baseLis = listingsRes.listings;
    if (baseLis.length > 0) {
      try {
        const supabase = getSupabaseClient();
        const { data: catRows } = await supabase.from('listings').select('id, category_id').in('id', baseLis.map((l: any) => l.id));
        const catMap: Record<string, string> = {};
        for (const row of (catRows ?? [])) { if (row.category_id) catMap[row.id] = row.category_id; }
        setListings(baseLis.map((l: any) => (catMap[l.id] ? { ...l, categoryId: catMap[l.id] } : l)));
      } catch { setListings(baseLis); }
    } else { setListings(baseLis); }
    setLoading(false);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const handleRunEbayVisualSearch = useCallback(async (targetItem: Item) => {
    if (!tenant || ebayVisualLoading) return;
    const primaryImage = (targetItem.media ?? []).find(u => u.startsWith('https://')) ?? null;
    if (!primaryImage) return;
    setEbayVisualLoading(true);
    const result = await searchEbayByImage({ tenantId: tenant.id, imageUri: primaryImage, limit: 6 });
    setEbayVisualResult(result);
    setEbayVisualLoading(false);
    if (result.available) setEbayVisualExpanded(true);
  }, [tenant, ebayVisualLoading]);

  const handleMarketValueUpdated = useCallback((updates: Partial<Item>, mv?: MarketValueResult) => {
    setItem(prev => {
      if (!prev) return prev;
      const merged = { ...prev, ...updates };
      // Compute commercial intelligence whenever valuation is updated
      const intel = computeItemCommercialIntelligence({
        identificationConfidence: merged.identificationConfidence ?? 0,
        specialistId: merged.specialistId,
        condition: merged.condition,
        valuationLow: merged.valuationLow ?? 0,
        valuationMid: merged.valuationMid ?? 0,
        valuationHigh: merged.valuationHigh ?? 0,
        valuationConfidenceRaw: merged.valuationConfidence as string,
        recommendedListingPrice: merged.expectedSellingPrice,
        saleProb30d: merged.saleProb30d ?? undefined,
        soldCount: mv?.soldMarket?.verifiedSoldCount ?? 0,
        relevantSoldCount: mv?.soldMarket?.relevantSoldCount ?? 0,
        soldMedian: mv?.soldMarket?.medianPrice ?? null,
        soldRangeLow: mv?.soldMarket?.lowPrice ?? null,
        soldRangeHigh: mv?.soldMarket?.highPrice ?? null,
        soldDateRange: mv?.soldMarket?.dateRange ?? undefined,
        activeCount: mv?.dataSource?.browseApiActive ?? 0,
        acquisitionCost: merged.acquiredCost ?? 0,
        hasImages: (merged.media ?? []).length > 0,
        imageCount: (merged.media ?? []).length,
        hasDescription: (merged.description ?? '').trim().length > 20,
        isListed: merged.status === 'listed' || merged.status === 'active',
        isSold: merged.status === 'sold',
        actualSalePrice: merged.soldPrice ?? undefined,
      });
      setCommercialIntel(intel);
      return merged;
    });
    if (mv) setReValueResult(mv);
  }, []);

  const handleReIdComplete = useCallback((updates: Partial<Item>, newMedia: string[]) => {
    setItem(prev => prev ? { ...prev, ...updates, media: newMedia } : prev);
    setReIdVisible(false);
    if (Object.keys(updates).length > 0) showAlert('Re-Identification Complete', 'Item updated with new AI analysis.');
    else showAlert('Feedback Recorded', 'Thank you — your correction will help improve future identifications.');
  }, [showAlert]);

  const handleFetchImage = useCallback(async () => {
    if (!tenant || !item) return;
    setFetchingImage(true); setFetchImageResult(null);
    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase.functions.invoke('swish-image-download', { body: { tenantId: tenant.id, itemIds: [item.id], fixTitles: true } });
      if (error) {
        let msg = error.message ?? 'Unknown error';
        try { const t = await (error as any).context?.text?.(); if (t) { try { const p = JSON.parse(t); msg = p.error ?? t; } catch { msg = t; } } } catch {}
        setFetchImageResult({ downloaded: 0, failed: 1, requiresReauth: msg.includes('re-authoris') || msg.includes('requiresReauth') });
      } else {
        const downloaded = data?.imagesDownloaded ?? 0;
        setFetchImageResult({ downloaded, failed: data?.imagesFailed ?? 0, requiresReauth: data?.requiresReauth ?? false });
        if (downloaded > 0) { const { item: updated } = await getItem(item.id); if (updated) setItem(updated); }
      }
    } catch (e: any) { setFetchImageResult({ downloaded: 0, failed: 1 }); showAlert('Fetch Failed', e?.message ?? 'Unknown error'); }
    finally { setFetchingImage(false); }
  }, [tenant, item, showAlert]);

  const handleSyncFromEbay = useCallback(async () => {
    if (!tenant || !item) return;
    const supabase = getSupabaseClient();
    const { data: listingData } = await supabase.from('listings').select('external_listing_id').eq('item_id', item.id).not('external_listing_id', 'is', null).neq('external_listing_id', '').limit(1).maybeSingle();
    const ebayItemId = listingData?.external_listing_id;
    if (!ebayItemId) { showAlert('No eBay Link', 'This item does not have a linked eBay listing ID.'); return; }
    setSyncingEbay(true);
    try {
      const { data, error } = await supabase.functions.invoke('swish-ebay-browse', { body: { route: 'get_item_full', tenantId: tenant.id, ebayItemId } });
      if (error) { let msg = error.message; try { const t = await (error as any).context?.text?.(); if (t) msg = t; } catch {}; showAlert('Sync Failed', msg); return; }
      const ebay = data?.item;
      if (!ebay) { showAlert('Sync Failed', 'No data returned from eBay.'); return; }
      const newAttributes: Record<string, string> = { ...(item.attributes ?? {}) };
      if (ebay.itemSpecifics) { for (const spec of ebay.itemSpecifics) { if (spec.name && spec.value) newAttributes[spec.name] = spec.value; } }
      const findSpec = (names: string[]) => { if (!ebay.itemSpecifics) return ''; for (const name of names) { const f = ebay.itemSpecifics.find((s: any) => s.name?.toLowerCase() === name.toLowerCase()); if (f) return f.value; } return ''; };
      const updates: Partial<Item> = { attributes: newAttributes, ...(ebay.description?.trim().length > 0 ? { description: ebay.description } : {}), ...(ebay.conditionDisplayName ? { condition: ebay.conditionDisplayName } : {}), ...(ebay.conditionDescription ? { conditionNotes: ebay.conditionDescription } : {}) };
      const ruler = findSpec(['Ruler', 'Monarch', 'Emperor']); if (ruler && !item.ruler) updates.ruler = ruler;
      const denomination = findSpec(['Denomination', 'Face Value']); if (denomination && !item.denomination) updates.denomination = denomination;
      const yearMade = findSpec(['Year', 'Date']); if (yearMade && !item.yearMade) updates.yearMade = yearMade;
      await updateItem(item.id, updates, tenant?.id);
      setItem(prev => prev ? { ...prev, ...updates } : prev);
      showAlert('Synced from eBay', `Updated item data from live eBay listing.`);
    } catch (e: any) { showAlert('Sync Failed', e?.message ?? 'Unknown error'); }
    finally { setSyncingEbay(false); }
  }, [tenant, item, showAlert]);

  const handlePushToEbay = useCallback(async () => {
    if (!tenant || !item) return;
    const activeListing = listings.find(l => l.status === 'active' && l.externalListingId);
    if (!activeListing) { showAlert('No Live Listing', 'This item has no active eBay listing.'); return; }
    const imageCount = (item.media ?? []).filter(u => u.startsWith('https://')).length;
    showAlert('Push to eBay?', `Revise eBay listing #${activeListing.externalListingId} with current SWISH data?\n\nTitle: ${item.canonicalTitle?.slice(0, 50)}\nPrice: £${activeListing.price.toFixed(2)}\nPhotos: ${imageCount}`,
      [{ text: 'Cancel', style: 'cancel' }, {
        text: 'Push Now', onPress: async () => {
          setPushingToEbay(true);
          try {
            const supabase = getSupabaseClient();
            const attrs = item.attributes ?? {};
            const itemSpecifics: Array<{ name: string; value: string }> = [];
            for (const [key, val] of Object.entries(attrs)) {
              if (val !== null && val !== undefined && String(val).trim()) {
                itemSpecifics.push({ name: String(key).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).slice(0, 65), value: String(val).slice(0, 65) });
              }
            }
            const mediaUrls = (item.media ?? []).filter(u => typeof u === 'string' && u.startsWith('https://'));
            const { data: listingCatRow } = await supabase.from('listings').select('category_id').eq('id', activeListing.id).maybeSingle();
            const storedCategoryId = listingCatRow?.category_id ?? '';
            const { data: result, error } = await supabase.functions.invoke('swish-ebay-list', {
              body: { route: 'revise', tenantId: tenant.id, listingId: activeListing.id, externalListingId: activeListing.externalListingId, categoryId: storedCategoryId, title: (item.canonicalTitle ?? '').slice(0, 80), description: item.description ?? '', price: activeListing.price, condition: item.condition ?? '', conditionDescription: item.conditionNotes ?? '', listingType: 'FixedPriceItem', quantity: item.quantity ?? 1, itemSpecifics, mediaUrls },
            });
            if (error) { let msg = error.message; if (error instanceof FunctionsHttpError) { try { const txt = await error.context?.text(); const p = txt ? JSON.parse(txt) : null; msg = p?.error ?? txt ?? msg; } catch {} } showAlert('Push Failed', msg); return; }
            if (result?.success) showAlert('Pushed to eBay', `eBay listing #${activeListing.externalListingId} updated.`);
            else showAlert('Push Failed', result?.error ?? 'Unknown error');
          } catch (e: any) { showAlert('Push Failed', e?.message ?? 'Unknown error'); }
          finally { setPushingToEbay(false); }
        },
      }]
    );
  }, [tenant, item, listings, showAlert]);

  const startEdit = useCallback((field: string, current: string) => { setEditing(field); setEditValue(current); }, []);
  const cancelEdit = useCallback(() => { setEditing(null); setEditValue(''); }, []);

  const saveField = useCallback(async (field: string) => {
    if (!item) return;
    setSaving(true);
    const numericFields = ['expectedSellingPrice', 'valuationLow', 'valuationMid', 'valuationHigh', 'acquiredCost', 'weightGrams', 'diameterMm', 'quantity'];
    const value = numericFields.includes(field) ? (parseFloat(editValue) || 0) : editValue;
    const updates: Partial<Item> = { [field]: value };
    if (field === 'expectedSellingPrice') { const price = parseFloat(editValue) || 0; updates.expectedNet = price * 0.8725; updates.expectedProfit = price * 0.8725 - (item.acquiredCost ?? 0); }
    if (field === 'acquiredCost') { const cost = parseFloat(editValue) || 0; updates.expectedProfit = item.expectedNet - cost; }
    const { error } = await updateItem(item.id, updates, tenant?.id);
    setSaving(false);
    if (error) { showAlert('Save Failed', error); return; }
    setItem(prev => prev ? { ...prev, ...updates } : prev);
    setEditing(null); setEditValue('');
  }, [item, editValue, showAlert]);

  const handleGenerateListing = useCallback(async () => {
    if (!item || !tenant) return;
    const idConf = item.identificationConfidence ?? 0;
    const valConf = item.valuationConfidence ?? 'insufficient_data';
    const warnings: string[] = [];
    if (idConf < 0.50) warnings.push(`Identification confidence is ${Math.round(idConf * 100)}% — listing will be provisional`);
    if (!['high', 'medium'].includes(valConf)) warnings.push(`Valuation confidence is "${valConf}" — price will require manual entry`);
    if (item.attributes?.has_hole) warnings.push('Item has hole/piercing — this will be disclosed');

    const proceed = async () => {
      setGeneratingListing(true);
      const { listing, error } = await generateListing(item.id, tenant.id, 'ebay');
      if (error || !listing) { showAlert('Generation Failed', error ?? 'Could not generate listing.'); setGeneratingListing(false); return; }
      const { listing: saved, error: saveErr } = await saveListing(tenant.id, item.id, listing, 'ebay',
        (item.attributes?.ebay_category_id as string) ?? undefined);
      setGeneratingListing(false);
      if (saveErr || !saved) { showAlert('Save Failed', saveErr ?? 'Could not save listing.'); return; }
      setListings(prev => [saved, ...prev]);
      showAlert('Listing Created', 'Draft saved. Open the Listing Editor to review before submitting.');
    };

    if (warnings.length > 0) {
      showAlert('Generate Listing — Review Required', `${warnings.map(w => `• ${w}`).join('\n')}\n\nContinue?`, [{ text: 'Cancel', style: 'cancel' }, { text: 'Generate Anyway', onPress: proceed }]);
    } else { proceed(); }
  }, [item, tenant, showAlert]);

  const handleSubmit = useCallback(async (listing: SavedListing) => {
    if (!tenant || !item) return;
    if (listing.price <= 0) {
      showAlert('Cannot Submit', 'Price not set. Open the Listing Editor and enter a price before submitting.', [{ text: 'Open Editor', onPress: () => router.push(`/ebay-listing-editor?id=${listing.id}` as any) }, { text: 'Cancel', style: 'cancel' }]);
      return;
    }

    // Pre-flight: check category is set (in listing or item attributes)
    const supabase = getSupabaseClient();
    const { data: listingCatRow } = await supabase.from('listings').select('category_id').eq('id', listing.id).maybeSingle();
    const storedCat = listingCatRow?.category_id ?? item.attributes?.ebay_category_id ?? '';
    if (!storedCat) {
      showAlert(
        'Category Required',
        'No eBay category is set for this listing. Open the Listing Editor, select a category (e.g. "Medals: Commemorative"), save, then try again.',
        [{ text: 'Open Editor', onPress: () => router.push(`/ebay-listing-editor?id=${listing.id}` as any) }, { text: 'Cancel', style: 'cancel' }]
      );
      return;
    }

    // Pre-flight: check business policies are configured
    const { data: connRow } = await supabase
      .from('marketplace_connectors')
      .select('selected_fulfillment_policy_id, selected_return_policy_id, status')
      .eq('tenant_id', tenant.id)
      .eq('marketplace_id', 'ebay')
      .maybeSingle();
    if (!connRow || connRow.status !== 'connected') {
      showAlert('eBay Not Connected', 'Your eBay account is not connected. Go to Marketplaces to re-authorise.', [{ text: 'Open Marketplaces', onPress: () => router.push('/marketplaces' as any) }, { text: 'Cancel', style: 'cancel' }]);
      return;
    }
    if (!connRow.selected_fulfillment_policy_id || !connRow.selected_return_policy_id) {
      showAlert(
        'Business Policies Not Set',
        'Your eBay fulfillment or return policy has not been selected. Go to Settings → eBay Connection → Load Policies and select your policies before submitting.',
        [{ text: 'Open Settings', onPress: () => router.push('/settings' as any) }, { text: 'Cancel', style: 'cancel' }]
      );
      return;
    }

    setSubmittingId(listing.id);
    setProgressTitle(listing.title ?? item?.canonicalTitle ?? '');
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
          ? { ...l, status: 'active', publishedAt: result.publishedAt, externalListingId: result.externalListingId ?? l.externalListingId }
          : l,
      ));
      setItem(prev => prev ? { ...prev, status: 'listed' } : prev);
      await new Promise(r => setTimeout(r, 1400));
      setProgressVisible(false);
      setSubmittingId(null);
      showAlert('Listed on eBay', `Now live at £${listing.price.toFixed(2)}.`);
    } else {
      setProgressFailed(true);
      await new Promise(r => setTimeout(r, 800));
      setProgressVisible(false);
      setSubmittingId(null);
      showAlert(
        'Submission Failed',
        result.failureReasons?.join('\n') ?? result.error ?? 'Submission failed.',
        [{ text: 'OK', style: 'cancel' }, { text: 'Retry', onPress: () => handleSubmit(listing) }],
      );
    }
  }, [tenant, showAlert]);

  const handleEndListing = useCallback(async (listing: SavedListing) => {
    if (!item) return;
    const isLive = listing.status === 'active' && listing.externalListingId;
    showAlert(
      'End Listing',
      isLive
        ? `Remove listing #${listing.externalListingId} from eBay and mark as ended in SWISH?`
        : `Remove this draft listing from SWISH? (No eBay action needed for drafts.)`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: isLive ? 'End on eBay' : 'Remove Draft',
          style: 'destructive',
          onPress: async () => {
            setEndingId(listing.id);
            const { error } = await endListing(listing.id, item.id, tenant?.id, listing.externalListingId);
            setEndingId(null);
            if (error) { showAlert('End Failed', error); return; }
            setListings(prev => prev.map(l => l.id === listing.id ? { ...l, status: 'ended' } : l));
            setItem(prev => prev ? { ...prev, status: 'identified' } : prev);
          },
        },
      ],
    );
  }, [item, tenant?.id, showAlert]);

  const handleDeleteListing = useCallback((listing: SavedListing) => {
    if (!item) return;
    const isLive = listing.status === 'active' && listing.externalListingId;
    showAlert(
      'Delete Listing',
      isLive
        ? `This will end listing #${listing.externalListingId} on eBay AND permanently delete it from SWISH. This cannot be undone.`
        : `Permanently delete this draft listing from SWISH? The item will remain in your inventory.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: isLive ? 'End on eBay & Delete' : 'Delete',
          style: 'destructive',
          onPress: async () => {
            setEndingId(listing.id);
            const { error } = await deleteListing(
              listing.id,
              tenant?.id ?? '',
              isLive ? listing.externalListingId ?? undefined : undefined,
            );
            setEndingId(null);
            if (error) { showAlert('Delete Failed', error); return; }
            setListings(prev => prev.filter(l => l.id !== listing.id));
            setItem(prev => prev ? { ...prev, status: 'identified' } : prev);
            showAlert('Deleted', isLive ? 'Listing ended on eBay and removed from SWISH.' : 'Draft listing deleted from SWISH.');
          },
        },
      ],
    );
  }, [item, tenant?.id, showAlert]);

  const handleMarkSold = useCallback(() => {
    if (!item) return;
    showAlert('Mark as Sold', 'This will move the item to your History. Continue?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Mark Sold', onPress: async () => {
        await updateItem(item.id, { status: 'sold', soldPrice: item.expectedSellingPrice, soldAt: new Date().toISOString() }, tenant?.id);
        setItem(prev => prev ? { ...prev, status: 'sold', soldPrice: item.expectedSellingPrice, soldAt: new Date().toISOString() } : prev);
      }},
    ]);
  }, [item, showAlert]);

  const activeListings = useMemo(() => listings.filter(l => l.status === 'active'), [listings]);

  // ── Facebook Marketplace export ─────────────────────────────────────────────

  const handleExportFacebook = useCallback(async () => {
    if (!item) return;
    const price = activeListings[0]?.price ?? item.expectedSellingPrice ?? 0;
    const specialist = item.specialistId ?? '';
    const niche = specialist === 'motocross' ? 'MX' : specialist === 'bicycles' ? 'Bikes' : specialist === 'clothing' || specialist === 'trainers_sneakers' ? 'Fashion' : 'Coins';
    const condition = [item.condition, item.conditionGrade].filter(Boolean).join(' ');
    const attrs = item.attributes ?? {};
    const keyAttrs: string[] = [];
    if (attrs.manufacturer || attrs.brand) keyAttrs.push(String(attrs.manufacturer ?? attrs.brand));
    if (attrs.engine_size) keyAttrs.push(String(attrs.engine_size));
    if (attrs.frame_size) keyAttrs.push(`Frame: ${attrs.frame_size}`);
    if (attrs.garment_type) keyAttrs.push(String(attrs.garment_type));
    if (attrs.era) keyAttrs.push(`Era: ${attrs.era}`);
    if (item.yearMade) keyAttrs.push(item.yearMade);
    if (item.material) keyAttrs.push(item.material);
    const lines = [
      `${item.canonicalTitle}`,
      '',
      condition ? `Condition: ${condition}` : '',
      keyAttrs.length > 0 ? keyAttrs.join(' | ') : '',
      item.description ? item.description.slice(0, 200) : '',
      '',
      price > 0 ? `£${price.toFixed(2)} ono` : 'Price on application',
      '',
      '📦 Can post | Collection available',
      `#${niche} #ForSale #SWISH`,
    ].filter(Boolean).join('\n').replace(/\n{3,}/g, '\n\n').trim();
    await Share.share({ message: lines, title: item.canonicalTitle });
  }, [item, activeListings]);

  // ── Computed values ─────────────────────────────────────────────────────────

  const isMXItem = item?.specialistId === 'motocross';

  const handleMXGradeSelect = useCallback(async (grade: string) => {
    if (!item) return;
    setSavingMXGrade(true);
    const { error } = await updateItem(item.id, { conditionGrade: grade, condition: grade }, tenant?.id);
    setSavingMXGrade(false);
    if (error) { showAlert('Save Failed', error); return; }
    setItem(prev => prev ? { ...prev, conditionGrade: grade, condition: grade } : prev);
  }, [item, showAlert]);

  const draftListings = useMemo(() => listings.filter(l => l.status === 'draft' || l.status === 'pending'), [listings]);
  const canonicalAttrs = useMemo(() => item ? canonicalizeAttributes(item.attributes) : [], [item?.attributes]);

  if (loading) { return <View style={s.container}><ActivityIndicator size="large" color={Colors.primary} style={{ marginTop: 100 }} /></View>; }
  if (!item) {
    return (
      <View style={[s.container, s.center]}>
        <MaterialIcons name="error-outline" size={48} color={Colors.textTertiary} />
        <Text style={s.emptyTitle}>Item not found</Text>
        <Pressable onPress={() => router.back()} style={s.backLink}><Text style={s.backLinkText}>Go back</Text></Pressable>
      </View>
    );
  }

  const statusColor = STATUS_COLORS[item.status] ?? Colors.textTertiary;
  const isListed = item.status === 'listed' || item.status === 'active';
  const isSold = item.status === 'sold';
  const idConf = item.identificationConfidence ?? 0;
  const confColor = idConf >= 0.75 ? Colors.success : idConf >= 0.50 ? Colors.warning : Colors.danger;
  const confLabel = idConf >= 0.85 ? 'HIGH' : idConf >= 0.65 ? 'MEDIUM' : idConf >= 0.45 ? 'LOW' : 'VERY LOW';

  // Three separate price concepts
  const listingPrice = activeListings[0]?.price ?? (draftListings[0]?.price ?? 0);
  const hasListingPrice = listingPrice > 0;
  const hasMarketValue = item.valuationMid > 0;
  const hasAcquiredCost = (item.acquiredCost ?? 0) > 0;

  return (
    <View style={s.container}>
      <StatusBar style="light" />

      {/* ── HEADER ── */}
      <View style={[s.header, { paddingTop: insets.top + Spacing.sm }]}>
        <Pressable onPress={() => router.back()} style={s.headerBtn} hitSlop={8}>
          <MaterialIcons name="arrow-back" size={20} color={Colors.textSecondary} />
        </Pressable>
        <View style={s.flex}>
          {item.inventoryId ? <View style={s.kcBadge}><MaterialIcons name="qr-code" size={10} color={Colors.primary} /><Text style={s.kcBadgeText}>{item.inventoryId}</Text></View> : null}
          <Text style={s.headerTitle} numberOfLines={1}>{item.canonicalTitle}</Text>
        </View>
        <View style={[s.statusDot, { backgroundColor: statusColor }]} />
        <Text style={[s.statusLabel, { color: statusColor }]}>{item.status.replace(/_/g, ' ')}</Text>
      </View>

      <ScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 120 }]} showsVerticalScrollIndicator={false}>

        {/* ── PHOTOS ── */}
        <View style={{ marginHorizontal: -Spacing.base }}>
          <ImageGallery
            media={item.media ?? []}
            onReIdentify={() => setReIdVisible(true)}
            onFetchImage={handleFetchImage}
            fetchingImage={fetchingImage}
            fetchImageResult={fetchImageResult}
            onReconnect={() => router.push('/marketplaces' as any)}
          />
        </View>

        {/* ── STATUS BANNERS ── */}
        {activeListings.length > 0 ? (
          <View style={s.liveBanner}>
            <MaterialIcons name="wifi-tethering" size={14} color={Colors.success} />
            <Text style={s.liveBannerText}>Live on eBay · £{activeListings[0].price.toFixed(2)}{activeListings[0].externalListingId ? ` · #${activeListings[0].externalListingId}` : ''}</Text>
            {(activeListings[0] as any).watchers > 0 ? <View style={s.watcherChip}><MaterialIcons name="star" size={10} color={Colors.gold} /><Text style={s.watcherText}>{(activeListings[0] as any).watchers}</Text></View> : null}
            {activeListings[0].externalListingId ? (
              <Pressable
                onPress={() => Linking.openURL(`https://www.ebay.co.uk/itm/${activeListings[0].externalListingId}`)}
                style={s.viewEbayBtn}
                hitSlop={4}
              >
                <MaterialIcons name="open-in-new" size={10} color={Colors.info} />
                <Text style={s.viewEbayBtnText}>View</Text>
              </Pressable>
            ) : null}
            <Pressable onPress={() => handleEndListing(activeListings[0])} style={s.endBtn} hitSlop={4} disabled={endingId === activeListings[0].id}>
              {endingId === activeListings[0].id ? <ActivityIndicator size="small" color={Colors.danger} style={{ width: 11, height: 11 }} /> : <MaterialIcons name="stop" size={11} color={Colors.danger} />}
              <Text style={s.endBtnText}>End</Text>
            </Pressable>
            <Pressable onPress={() => handleDeleteListing(activeListings[0])} style={[s.endBtn, { backgroundColor: Colors.dangerDim + '80', borderColor: Colors.danger + '60' }]} hitSlop={4} disabled={endingId === activeListings[0].id}>
              <MaterialIcons name="delete-outline" size={11} color={Colors.danger} />
              <Text style={s.endBtnText}>Delete</Text>
            </Pressable>
          </View>
        ) : null}
        {isSold ? (
          <View style={s.soldBanner}>
            <MaterialIcons name="check-circle" size={14} color={Colors.success} />
            <Text style={s.soldBannerText}>Sold for £{(item.soldPrice ?? 0).toFixed(2)}{item.soldAt ? ` · ${new Date(item.soldAt).toLocaleDateString('en-GB')}` : ''}</Text>
          </View>
        ) : null}
        {item.status === 'review_required' ? (
          <View style={s.reviewBanner}>
            <MaterialIcons name="warning" size={14} color={Colors.warning} />
            <View style={s.flex}>
              <Text style={s.reviewBannerTitle}>Review Required</Text>
              <Text style={s.reviewBannerSub}>
                {idConf < 0.45 ? `Identification confidence: ${Math.round(idConf * 100)}%` : !hasMarketValue ? 'Market value not established' : 'Manual review needed before listing'}
              </Text>
            </View>
          </View>
        ) : null}

        {/* ── MARKETPLACE LISTING SECTION ── */}
        <View style={s.listingCard}>
          <SectionHeader icon="storefront" label="Marketplace Listing" color={Colors.primary} action={() => {}} actionLabel="" />

          {/* Title */}
          <View style={s.titleRow}>
            <View style={s.flex}>
              <Text style={s.listingTitle}>{item.canonicalTitle}</Text>
              {item.description ? <Text style={s.listingDescPreview} numberOfLines={2}>{item.description}</Text> : null}
            </View>
          </View>

          {/* Category */}
          {activeListings.length > 0 ? (
            <View style={s.listingMetaRow}>
              <MaterialIcons name="category" size={11} color={Colors.info} />
              <Text style={s.listingMetaLabel}>Category</Text>
              <Text style={s.listingMetaValue}>
                {(activeListings[0] as any).categoryName ?? ((activeListings[0] as any).categoryId ? `ID ${(activeListings[0] as any).categoryId}` : 'Not set')}
              </Text>
            </View>
          ) : null}

          {/* Condition */}
          {item.condition ? (
            <View style={s.listingMetaRow}>
              <MaterialIcons name="grade" size={11} color={Colors.textTertiary} />
              <Text style={s.listingMetaLabel}>Condition</Text>
              <Text style={s.listingMetaValue}>{[item.condition, item.conditionGrade].filter(Boolean).join(' · ')}</Text>
            </View>
          ) : null}

          {/* Edit / Listing buttons */}
          <View style={s.listingActions}>
            {draftListings.length > 0 ? (
              <Pressable onPress={() => router.push(`/ebay-listing-editor?id=${draftListings[0].id}` as any)} style={s.listingEditBtn}>
                <MaterialIcons name="edit" size={13} color={Colors.primary} />
                <Text style={s.listingEditBtnText}>Edit Listing</Text>
              </Pressable>
            ) : null}
            {activeListings.length > 0 ? (
              <Pressable onPress={() => router.push(`/ebay-listing-editor?id=${activeListings[0].id}` as any)} style={s.listingEditBtn}>
                <MaterialIcons name="edit" size={13} color={Colors.primary} />
                <Text style={s.listingEditBtnText}>Edit Listing</Text>
              </Pressable>
            ) : null}
          </View>
        </View>

        {/* ── PRICING SECTION (three distinct concepts) ── */}
        <View style={s.pricingCard}>
          <SectionHeader icon="price-change" label="Pricing" color={Colors.gold} />

          {/* Listing Price */}
          <View style={s.pricingRow}>
            <View style={s.pricingItem}>
              <Text style={s.pricingItemLabel}>LISTING PRICE</Text>
              {hasListingPrice ? (
                <Text style={s.pricingItemValue}>£{listingPrice.toFixed(2)}</Text>
              ) : (
                <Pressable onPress={() => startEdit('expectedSellingPrice', String(item.expectedSellingPrice))} style={s.pricingSetBtn}>
                  <MaterialIcons name="add" size={12} color={Colors.primary} />
                  <Text style={s.pricingSetBtnText}>Set price</Text>
                </Pressable>
              )}
            </View>
            <View style={s.pricingDivider} />
            <View style={s.pricingItem}>
              <Text style={s.pricingItemLabel}>MARKET VALUE</Text>
              {hasMarketValue ? (
                <Text style={[s.pricingItemValue, { color: Colors.gold }]}>£{item.valuationLow.toFixed(0)}–£{item.valuationHigh.toFixed(0)}</Text>
              ) : (
                <Text style={[s.pricingItemValue, { color: Colors.textTertiary }]}>Not valued yet</Text>
              )}
            </View>
            <View style={s.pricingDivider} />
            <View style={s.pricingItem}>
              <Text style={s.pricingItemLabel}>ACQUIRED COST</Text>
              {hasAcquiredCost ? (
                <Text style={s.pricingItemValue}>£{(item.acquiredCost ?? 0).toFixed(2)}</Text>
              ) : (
                <Pressable onPress={() => startEdit('acquiredCost', String(item.acquiredCost ?? 0))} style={s.pricingSetBtn}>
                  <MaterialIcons name="add" size={12} color={Colors.textTertiary} />
                  <Text style={[s.pricingSetBtnText, { color: Colors.textTertiary }]}>Record cost</Text>
                </Pressable>
              )}
            </View>
          </View>

          {/* Profit row — only show when all three values exist */}
          {hasListingPrice && hasAcquiredCost ? (
            <View style={s.profitRow}>
              <MaterialIcons name={item.expectedProfit >= 0 ? 'trending-up' : 'trending-down'} size={13} color={item.expectedProfit >= 0 ? Colors.success : Colors.danger} />
              <Text style={[s.profitText, { color: item.expectedProfit >= 0 ? Colors.success : Colors.danger }]}>
                {item.expectedProfit >= 0 ? '+' : ''}£{(item.expectedProfit ?? 0).toFixed(2)} estimated profit{item.saleProb30d != null ? ` · ${Math.round(item.saleProb30d * 100)}% sale probability` : ''}
              </Text>
            </View>
          ) : (!hasListingPrice || !hasAcquiredCost) ? (
            <Text style={s.profitMissingNote}>Enter listing price and acquisition cost to calculate profit</Text>
          ) : null}

          {/* Inline edit for listing price */}
          {editing === 'expectedSellingPrice' ? (
            <View style={s.inlineEditRow}>
              <Text style={s.inlineEditLabel}>Listing Price</Text>
              <Text style={s.inlineEditCurrency}>£</Text>
              <TextInput style={s.inlineEditInput} value={editValue} onChangeText={setEditValue} keyboardType="decimal-pad" autoFocus placeholder="0.00" placeholderTextColor={Colors.textTertiary} />
              <Pressable onPress={() => saveField('expectedSellingPrice')} style={s.inlineEditSave} hitSlop={6}><MaterialIcons name="check" size={14} color={Colors.background} /></Pressable>
              <Pressable onPress={cancelEdit} style={s.inlineEditCancel} hitSlop={6}><MaterialIcons name="close" size={14} color={Colors.textTertiary} /></Pressable>
            </View>
          ) : null}
          {editing === 'acquiredCost' ? (
            <View style={s.inlineEditRow}>
              <Text style={s.inlineEditLabel}>Acquired Cost</Text>
              <Text style={s.inlineEditCurrency}>£</Text>
              <TextInput style={s.inlineEditInput} value={editValue} onChangeText={setEditValue} keyboardType="decimal-pad" autoFocus placeholder="0.00" placeholderTextColor={Colors.textTertiary} />
              <Pressable onPress={() => saveField('acquiredCost')} style={s.inlineEditSave} hitSlop={6}><MaterialIcons name="check" size={14} color={Colors.background} /></Pressable>
              <Pressable onPress={cancelEdit} style={s.inlineEditCancel} hitSlop={6}><MaterialIcons name="close" size={14} color={Colors.textTertiary} /></Pressable>
            </View>
          ) : null}
        </View>

        {/* ── DELIVERY ── */}
        <View style={s.deliveryCard}>
          <SectionHeader icon="local-shipping" label="Delivery" color={Colors.info} />
          <View style={s.deliveryContent}>
            <View style={s.deliveryBadge}>
              <MaterialIcons name="check-circle" size={14} color={Colors.success} />
              <View style={s.flex}>
                <Text style={s.deliveryTitle}>Simple Delivery</Text>
                <Text style={s.deliverySub}>Buyer pays shipping · eBay fulfilment policy</Text>
              </View>
            </View>
            <Text style={s.deliveryNote}>Shipping is handled by your eBay fulfillment policy. To change delivery settings, update your eBay Seller Hub policy or use the Listing Editor.</Text>
          </View>
        </View>

        {/* ── MARKET VALUE PANEL ── */}
        {tenant ? (
          <MarketValuePanel
            item={item}
            tenantId={tenant.id}
            onUpdated={handleMarketValueUpdated}
            externalResult={reValueResult}
          />
        ) : null}

        {/* ── COMMERCIAL INTELLIGENCE CARD ── */}
        {commercialIntel ? (
          <CommercialIntelligenceCard
            intel={commercialIntel}
            acquisitionCost={item.acquiredCost ?? 0}
            onAcquisitionCostSet={async (cost) => {
              if (!item) return;
              const updates: Partial<Item> = {
                acquiredCost: cost,
                expectedProfit: item.expectedNet - cost,
              };
              await updateItem(item.id, updates, tenant?.id);
              setItem(prev => prev ? { ...prev, ...updates } : prev);
              // Recompute intel with new cost
              const updatedIntel = computeItemCommercialIntelligence({
                identificationConfidence: item.identificationConfidence ?? 0,
                specialistId: item.specialistId,
                condition: item.condition,
                valuationLow: item.valuationLow ?? 0,
                valuationMid: item.valuationMid ?? 0,
                valuationHigh: item.valuationHigh ?? 0,
                valuationConfidenceRaw: item.valuationConfidence as string,
                recommendedListingPrice: item.expectedSellingPrice,
                saleProb30d: item.saleProb30d ?? undefined,
                acquisitionCost: cost,
                hasImages: (item.media ?? []).length > 0,
                imageCount: (item.media ?? []).length,
                hasDescription: (item.description ?? '').trim().length > 20,
                isListed: item.status === 'listed' || item.status === 'active',
                isSold: item.status === 'sold',
                actualSalePrice: item.soldPrice ?? undefined,
              });
              setCommercialIntel(updatedIntel);
            }}
          />
        ) : item.valuationMid > 0 ? (
          // Auto-compute on first render when valuation already exists
          (() => {
            const intel = computeItemCommercialIntelligence({
              identificationConfidence: item.identificationConfidence ?? 0,
              specialistId: item.specialistId,
              condition: item.condition,
              valuationLow: item.valuationLow ?? 0,
              valuationMid: item.valuationMid ?? 0,
              valuationHigh: item.valuationHigh ?? 0,
              valuationConfidenceRaw: item.valuationConfidence as string,
              recommendedListingPrice: item.expectedSellingPrice,
              saleProb30d: item.saleProb30d ?? undefined,
              acquisitionCost: item.acquiredCost ?? 0,
              hasImages: (item.media ?? []).length > 0,
              imageCount: (item.media ?? []).length,
              hasDescription: (item.description ?? '').trim().length > 20,
              isListed: item.status === 'listed' || item.status === 'active',
              isSold: item.status === 'sold',
              actualSalePrice: item.soldPrice ?? undefined,
            });
            // Lazy-set on first render (avoids setState during render)
            setTimeout(() => setCommercialIntel(intel), 0);
            return null;
          })()
        ) : null}

        {/* ── EBAY VISUAL EVIDENCE ── */}
        <View style={s.intelligenceCard}>
          <Pressable
            onPress={() => {
              setEbayVisualExpanded(e => !e);
              if (!ebayVisualResult && !ebayVisualLoading && item) handleRunEbayVisualSearch(item);
            }}
            style={s.intelligenceHeader}
          >
            <View style={s.intelligenceHeaderLeft}>
              <View style={[s.intelligenceIcon, { backgroundColor: Colors.info + '20' }]}>
                <MaterialIcons name="image-search" size={14} color={Colors.info} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[s.intelligenceTitle, { color: Colors.info }]}>eBay Visual Evidence</Text>
                {ebayVisualLoading ? (
                  <Text style={s.statePillText}>Searching eBay GB...</Text>
                ) : ebayVisualResult ? (
                  <Text style={s.statePillText}>
                    {ebayVisualResult.available
                      ? `${ebayVisualResult.totalResults} similar listings${ebayVisualResult.topCategory ? ` · ${ebayVisualResult.topCategory.name}` : ''}`
                      : ebayVisualResult.error ?? 'eBay visual search unavailable'}
                  </Text>
                ) : (
                  <Text style={s.statePillText}>Tap to search eBay GB for similar listings</Text>
                )}
              </View>
            </View>
            {ebayVisualLoading ? (
              <ActivityIndicator size="small" color={Colors.info} style={{ width: 18, height: 18 }} />
            ) : (
              <MaterialIcons name={ebayVisualExpanded ? 'keyboard-arrow-up' : 'keyboard-arrow-down'} size={18} color={Colors.textTertiary} />
            )}
          </Pressable>

          {ebayVisualExpanded && ebayVisualResult ? (
            <View style={s.intelligenceSummary}>
              {/* Disclaimer */}
              <View style={[s.intelAlert, { borderColor: Colors.info + '25', backgroundColor: Colors.info + '08' }]}>
                <MaterialIcons name="info-outline" size={11} color={Colors.info} />
                <Text style={[s.intelAlertText, { color: Colors.info }]}>
                  Similar eBay listings — not confirmed identification. Use as category/context evidence only.
                </Text>
              </View>

              {/* Price note */}
              {ebayVisualResult.available && ebayVisualResult.items.length > 0 ? (() => {
                const pr = formatAskingPriceRange(ebayVisualResult.items);
                return pr ? (
                  <View style={[s.intelWarning, { borderColor: Colors.warning + '25' }]}>
                    <MaterialIcons name="price-tag" size={11} color={Colors.warning} />
                    <Text style={s.intelWarningText}>{pr} — current asking prices, not sold prices</Text>
                  </View>
                ) : null;
              })() : null}

              {/* Category signal */}
              {ebayVisualResult.available && (ebayVisualResult.topCategory?.count ?? 0) >= 2 ? (
                <View style={s.intelBlock}>
                  <Text style={s.intelBlockLabel}>TOP MATCHING CATEGORY</Text>
                  <Text style={[s.intelBlockValue, { color: Colors.success }]}>{ebayVisualResult.topCategory!.name}</Text>
                  <Text style={s.intelBlockNote}>{ebayVisualResult.topCategory!.count} of {ebayVisualResult.items.length} results</Text>
                </View>
              ) : null}

              {/* Similar items */}
              {ebayVisualResult.available && ebayVisualResult.items.length > 0 ? (
                <View style={s.intelBlock}>
                  <Text style={s.intelBlockLabel}>SIMILAR ITEMS FOUND</Text>
                  {ebayVisualResult.items.slice(0, 3).map((vi, i) => (
                    <Pressable
                      key={vi.itemId || i}
                      onPress={() => vi.itemWebUrl ? Linking.openURL(vi.itemWebUrl) : null}
                      style={({ pressed }) => [{ flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: Spacing.sm, paddingVertical: Spacing.xs, borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder + '60' }, pressed && { opacity: 0.75 }]}
                      disabled={!vi.itemWebUrl}
                    >
                      {vi.image ? (
                        <Image source={{ uri: vi.image }} style={{ width: 40, height: 40, borderRadius: Radius.sm }} contentFit="cover" transition={100} />
                      ) : null}
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text style={s.intelBlockValue} numberOfLines={2}>{vi.title}</Text>
                        <View style={{ flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6 }}>
                          {vi.price.value > 0 ? <Text style={{ fontSize: Typography.size.xs, fontWeight: Typography.weight.bold, color: Colors.textPrimary }}>£{vi.price.value.toFixed(2)}</Text> : null}
                          {vi.primaryCategoryName ? <Text style={{ fontSize: 9, color: Colors.info }}>{vi.primaryCategoryName}</Text> : null}
                        </View>
                      </View>
                      {vi.itemWebUrl ? <MaterialIcons name="open-in-new" size={11} color={Colors.textTertiary} style={{ flexShrink: 0 }} /> : null}
                    </Pressable>
                  ))}
                </View>
              ) : ebayVisualResult.available ? (
                <View style={s.intelBlock}>
                  <Text style={s.intelBlockNote}>No strong eBay visual matches found for this item.</Text>
                </View>
              ) : (
                <View style={s.intelBlock}>
                  <Text style={[s.intelBlockNote, { color: Colors.textTertiary }]}>{ebayVisualResult.error ?? 'eBay visual search unavailable'}</Text>
                </View>
              )}

              {/* Re-search */}
              <Pressable
                onPress={() => { setEbayVisualResult(null); if (item) handleRunEbayVisualSearch(item); }}
                disabled={ebayVisualLoading}
                style={{ flexDirection: 'row' as const, alignItems: 'center' as const, gap: 5, paddingTop: Spacing.xs }}
              >
                {ebayVisualLoading ? <ActivityIndicator size="small" color={Colors.info} style={{ width: 12, height: 12 }} /> : <MaterialIcons name="refresh" size={12} color={Colors.info} />}
                <Text style={[s.showMoreBtnText, { color: Colors.info }]}>Re-search eBay</Text>
              </Pressable>
            </View>
          ) : null}
        </View>

        {/* ── SWISH INTELLIGENCE (expandable) ── */}
        <View style={s.intelligenceCard}>
          <Pressable onPress={() => setIntelligenceExpanded(e => !e)} style={s.intelligenceHeader}>
            <View style={s.intelligenceHeaderLeft}>
              <View style={s.intelligenceIcon}>
                <MaterialIcons name="auto-awesome" size={14} color={Colors.accent} />
              </View>
              <View style={s.flex}>
                <Text style={s.intelligenceTitle}>SWISH Intelligence</Text>
                <View style={s.intelligenceMeta}>
                  <View style={[s.confPill, { backgroundColor: confColor + '20', borderColor: confColor + '40' }]}>
                    <Text style={[s.confPillText, { color: confColor }]}>{Math.round(idConf * 100)}% · {confLabel}</Text>
                  </View>
                  {item.attributes?.identification_state ? (
                    <View style={s.statePill}>
                      <Text style={s.statePillText}>{String(item.attributes.identification_state).replace(/_/g, ' ')}</Text>
                    </View>
                  ) : null}
                </View>
              </View>
            </View>
            <MaterialIcons name={intelligenceExpanded ? 'keyboard-arrow-up' : 'keyboard-arrow-down'} size={18} color={Colors.textTertiary} />
          </Pressable>

          {intelligenceExpanded ? (
            <View style={s.intelligenceContent}>
              {/* Identification title */}
              <View style={s.intelBlock}>
                <Text style={s.intelBlockLabel}>IDENTIFICATION</Text>
                <Text style={s.intelBlockTitle}>{item.canonicalTitle}</Text>
                {idConf < 0.50 ? <View style={s.intelWarning}><MaterialIcons name="warning" size={11} color={Colors.warning} /><Text style={s.intelWarningText}>Low confidence — manual verification recommended before listing</Text></View> : null}
              </View>

              {/* Catalogue reference retained as a candidate unless the match is strong enough to promote. */}
              {item.attributes?.numista_n || item.attributes?.numista_candidate_id ? (
                <View style={s.intelBlock}>
                  <Text style={s.intelBlockLabel}>NUMISTA CANDIDATE · NOT VERIFIED</Text>
                  <DataRow
                    label="Reference"
                    value={String(item.attributes.numista_n ?? `N#${item.attributes.numista_candidate_id}`)}
                  />
                  {item.attributes.numista_title ? <DataRow label="Catalogue type" value={String(item.attributes.numista_title)} /> : null}
                  <DataRow
                    label="Catalogue match score (not ID confidence)"
                    value={`${String(item.attributes.numista_status ?? 'candidate').replace(/_/g, ' ')} · ${Math.round(Number(item.attributes.numista_match_score ?? 0))}/100`}
                  />
                  {item.attributes.numista_catalogue_weight ? <DataRow label="Catalogue weight" value={`${item.attributes.numista_catalogue_weight} g`} /> : null}
                  {item.attributes.numista_catalogue_diameter ? <DataRow label="Catalogue diameter" value={`${item.attributes.numista_catalogue_diameter} mm`} /> : null}
                </View>
              ) : null}

              {/* Alteration flags */}
              {item.attributes?.has_hole ? (
                <View style={s.intelAlert}><MaterialIcons name="report" size={12} color={Colors.danger} /><Text style={s.intelAlertText}>Object has been pierced/holed — disclose in listing</Text></View>
              ) : null}

              {/* Condition — MX gets a dedicated grader; other niches show text */}
              {isMXItem ? (
                <MXConditionGrader
                  currentGrade={item.conditionGrade ?? item.condition ?? ''}
                  onGradeSelect={handleMXGradeSelect}
                  saving={savingMXGrade}
                />
              ) : item.condition ? (
                <View style={s.intelBlock}>
                  <Text style={s.intelBlockLabel}>CONDITION</Text>
                  <Text style={s.intelBlockValue}>{[item.condition, item.conditionGrade].filter(Boolean).join(' · ')}</Text>
                  {item.conditionNotes ? <Text style={s.intelBlockNote}>{item.conditionNotes}</Text> : null}
                </View>
              ) : null}

              {/* Canonical key attributes (de-duplicated) */}
              {canonicalAttrs.length > 0 ? (
                <View style={s.intelBlock}>
                  <Text style={s.intelBlockLabel}>KEY ATTRIBUTES</Text>
                  {canonicalAttrs.slice(0, attributesExpanded ? undefined : 6).map(({ key, value }) => (
                    <DataRow key={key} label={key} value={value} />
                  ))}
                  {canonicalAttrs.length > 6 ? (
                    <Pressable onPress={() => setAttributesExpanded(e => !e)} style={s.showMoreBtn}>
                      <Text style={s.showMoreBtnText}>{attributesExpanded ? 'Show less' : `Show ${canonicalAttrs.length - 6} more attributes`}</Text>
                      <MaterialIcons name={attributesExpanded ? 'expand-less' : 'expand-more'} size={14} color={Colors.primary} />
                    </Pressable>
                  ) : null}
                </View>
              ) : null}

              {/* Warnings */}
              {item.warnings && item.warnings.length > 0 ? (
                <View style={s.warningsBlock}>
                  {item.warnings.map((w, i) => (
                    <View key={i} style={s.warningRow}>
                      <MaterialIcons name="warning" size={11} color={Colors.danger} style={{ marginTop: 2, flexShrink: 0 }} />
                      <Text style={s.warningText}>{w}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </View>
          ) : (
            // Collapsed summary
            <View style={s.intelligenceSummary}>
              <DataRow label="Identification" value={item.canonicalTitle} />
              {item.attributes?.numista_n || item.attributes?.numista_candidate_id ? (
                <DataRow label="Numista candidate" value={String(item.attributes.numista_n ?? `N#${item.attributes.numista_candidate_id}`)} />
              ) : null}
              {item.condition ? <DataRow label="Condition" value={[item.condition, item.conditionGrade].filter(Boolean).join(' · ')} /> : null}
            </View>
          )}
        </View>

        {/* ── INVENTORY (physical ownership details) ── */}
        <View style={s.inventoryCard}>
          <SectionHeader icon="inventory" label="Inventory" color={Colors.info} />
          <View style={s.card}>
            <FieldRow label="SKU / Ref" value={item.sku || ''} onEdit={() => startEdit('sku', item.sku || '')} editValue={editing === 'sku' ? editValue : undefined} onChangeText={setEditValue} onSave={() => saveField('sku')} onCancel={cancelEdit} editing={editing === 'sku'} placeholder="e.g. KC-VIC-001" />
            <FieldRow label="Folder No." value={item.folderNumber || ''} onEdit={() => startEdit('folderNumber', item.folderNumber || '')} editValue={editing === 'folderNumber' ? editValue : undefined} onChangeText={setEditValue} onSave={() => saveField('folderNumber')} onCancel={cancelEdit} editing={editing === 'folderNumber'} placeholder="e.g. 12" />
            <FieldRow label="Pocket" value={item.pocketPosition || ''} onEdit={() => startEdit('pocketPosition', item.pocketPosition || '')} editValue={editing === 'pocketPosition' ? editValue : undefined} onChangeText={setEditValue} onSave={() => saveField('pocketPosition')} onCancel={cancelEdit} editing={editing === 'pocketPosition'} placeholder="e.g. 37" />
            <FieldRow label="Storage" value={item.storageLocation || ''} onEdit={() => startEdit('storageLocation', item.storageLocation || '')} editValue={editing === 'storageLocation' ? editValue : undefined} onChangeText={setEditValue} onSave={() => saveField('storageLocation')} onCancel={cancelEdit} editing={editing === 'storageLocation'} placeholder="e.g. Box A, Shelf 3" />
            <FieldRow label="Quantity" value={item.quantity ? String(item.quantity) : '1'} onEdit={() => startEdit('quantity', item.quantity ? String(item.quantity) : '1')} editValue={editing === 'quantity' ? editValue : undefined} onChangeText={setEditValue} onSave={() => saveField('quantity')} onCancel={cancelEdit} editing={editing === 'quantity'} numeric placeholder="1" />
          </View>

          {/* Private Notes */}
          <View style={s.card}>
            <FieldRow label="Private Notes" value={item.customNotes || ''} onEdit={() => startEdit('customNotes', item.customNotes || '')} editValue={editing === 'customNotes' ? editValue : undefined} onChangeText={setEditValue} onSave={() => saveField('customNotes')} onCancel={cancelEdit} editing={editing === 'customNotes'} multiline placeholder="Internal notes, purchase details, research..." />
          </View>
        </View>

        {/* ── NICHE-AWARE ITEM DETAILS ── */}
        {(() => {
          const specialist = item.specialistId ?? '';
          const isBike = specialist === 'bicycles' || specialist === 'cycling';
          const isMXSpec = specialist === 'motocross';
          const isClothing = specialist === 'clothing' || specialist === 'trainers_sneakers';
          const isCoin = !isBike && !isMXSpec && !isClothing;
          const attrs = item.attributes ?? {};
          const accentColor = isBike ? '#6ED020' : isMXSpec ? '#FF5500' : isClothing ? '#E91E8C' : Colors.gold;
          const detailIcon = isBike ? 'pedal-bike' : isMXSpec ? 'two-wheeler' : isClothing ? 'checkroom' : 'toll';
          return (
            <View style={[s.coinCard, { borderColor: accentColor + '30' }]}>
              <SectionHeader icon={detailIcon} label="Item Details" color={accentColor} />
              <View style={s.card}>
                <FieldRow label="Title" value={item.canonicalTitle} onEdit={() => startEdit('canonicalTitle', item.canonicalTitle)} editValue={editing === 'canonicalTitle' ? editValue : undefined} onChangeText={setEditValue} onSave={() => saveField('canonicalTitle')} onCancel={cancelEdit} editing={editing === 'canonicalTitle'} placeholder="Item title" />
                <FieldRow label="Description" value={item.description || ''} onEdit={() => startEdit('description', item.description || '')} editValue={editing === 'description' ? editValue : undefined} onChangeText={setEditValue} onSave={() => saveField('description')} onCancel={cancelEdit} editing={editing === 'description'} multiline placeholder="Detailed description for listing..." />
                {isBike ? (<>
                  <FieldRow label="Brand" value={item.manufacturer || String(attrs.manufacturer ?? attrs.brand ?? '')} onEdit={() => startEdit('manufacturer', item.manufacturer || '')} editValue={editing === 'manufacturer' ? editValue : undefined} onChangeText={setEditValue} onSave={() => saveField('manufacturer')} onCancel={cancelEdit} editing={editing === 'manufacturer'} placeholder="e.g. Trek, Specialized, Scott" accent={accentColor} />
                  <FieldRow label="Bike Type" value={String(attrs.bike_type ?? attrs.frame_type ?? '')} onEdit={() => startEdit('yearMade', String(attrs.bike_type ?? ''))} editValue={undefined} onChangeText={undefined} onSave={undefined} onCancel={cancelEdit} editing={false} placeholder="e.g. Mountain Bike, Road Bike" />
                  <FieldRow label="Frame Size" value={String(attrs.frame_size ?? '')} onEdit={() => {}} editValue={undefined} onChangeText={undefined} onSave={undefined} onCancel={cancelEdit} editing={false} placeholder="e.g. Medium, 17inch" />
                  <FieldRow label="Frame Material" value={item.material || String(attrs.frame_material ?? '')} onEdit={() => startEdit('material', item.material || '')} editValue={editing === 'material' ? editValue : undefined} onChangeText={setEditValue} onSave={() => saveField('material')} onCancel={cancelEdit} editing={editing === 'material'} placeholder="e.g. Aluminium, Carbon, Steel" />
                  <FieldRow label="Groupset" value={String(attrs.groupset ?? attrs.drivetrain ?? '')} onEdit={() => {}} editValue={undefined} onChangeText={undefined} onSave={undefined} onCancel={cancelEdit} editing={false} placeholder="e.g. Shimano Deore" />
                  <FieldRow label="Wheel Size" value={String(attrs.wheel_size ?? '')} onEdit={() => {}} editValue={undefined} onChangeText={undefined} onSave={undefined} onCancel={cancelEdit} editing={false} placeholder="e.g. 29inch, 27.5inch" />
                  <FieldRow label="Brakes" value={String(attrs.brake_type ?? attrs.brakes ?? '')} onEdit={() => {}} editValue={undefined} onChangeText={undefined} onSave={undefined} onCancel={cancelEdit} editing={false} placeholder="e.g. Hydraulic Disc" />
                  <FieldRow label="Year Range" value={item.yearMade || String(attrs.year_range ?? '')} onEdit={() => startEdit('yearMade', item.yearMade || '')} editValue={editing === 'yearMade' ? editValue : undefined} onChangeText={setEditValue} onSave={() => saveField('yearMade')} onCancel={cancelEdit} editing={editing === 'yearMade'} placeholder="e.g. 2019-2021" />
                  <FieldRow label="Country" value={item.countryOfOrigin || ''} onEdit={() => startEdit('countryOfOrigin', item.countryOfOrigin || '')} editValue={editing === 'countryOfOrigin' ? editValue : undefined} onChangeText={setEditValue} onSave={() => saveField('countryOfOrigin')} onCancel={cancelEdit} editing={editing === 'countryOfOrigin'} placeholder="e.g. Taiwan, UK" />
                  <FieldRow label="Weight" value={item.weightGrams ? `${item.weightGrams}g` : ''} onEdit={() => startEdit('weightGrams', item.weightGrams ? String(item.weightGrams) : '')} editValue={editing === 'weightGrams' ? editValue : undefined} onChangeText={setEditValue} onSave={() => saveField('weightGrams')} onCancel={cancelEdit} editing={editing === 'weightGrams'} numeric placeholder="e.g. 13500" />
                </>) : null}
                {isMXSpec ? (<>
                  <FieldRow label="Brand" value={item.manufacturer || String(attrs.manufacturer ?? attrs.brand ?? '')} onEdit={() => startEdit('manufacturer', item.manufacturer || '')} editValue={editing === 'manufacturer' ? editValue : undefined} onChangeText={setEditValue} onSave={() => saveField('manufacturer')} onCancel={cancelEdit} editing={editing === 'manufacturer'} placeholder="e.g. KTM, Yamaha, Honda" accent={accentColor} />
                  <FieldRow label="Engine Size" value={String(attrs.engine_size ?? '')} onEdit={() => {}} editValue={undefined} onChangeText={undefined} onSave={undefined} onCancel={cancelEdit} editing={false} placeholder="e.g. 250cc, 450cc" />
                  <FieldRow label="Stroke Type" value={String(attrs.stroke_type ?? '')} onEdit={() => {}} editValue={undefined} onChangeText={undefined} onSave={undefined} onCancel={cancelEdit} editing={false} placeholder="2-stroke or 4-stroke" />
                  <FieldRow label="Year" value={item.yearMade || ''} onEdit={() => startEdit('yearMade', item.yearMade || '')} editValue={editing === 'yearMade' ? editValue : undefined} onChangeText={setEditValue} onSave={() => saveField('yearMade')} onCancel={cancelEdit} editing={editing === 'yearMade'} placeholder="e.g. 2019" />
                  <FieldRow label="Running Status" value={String(attrs.rideable_status ?? attrs.running_status ?? '')} onEdit={() => {}} editValue={undefined} onChangeText={undefined} onSave={undefined} onCancel={cancelEdit} editing={false} placeholder="e.g. Rideable, Non-rideable" accent={accentColor} />
                  <FieldRow label="Frame Condition" value={String(attrs.frame_condition ?? '')} onEdit={() => {}} editValue={undefined} onChangeText={undefined} onSave={undefined} onCancel={cancelEdit} editing={false} placeholder="e.g. No cracks, Scuffed" />
                  <FieldRow label="Modifications" value={String(attrs.modifications ?? '')} onEdit={() => {}} editValue={undefined} onChangeText={undefined} onSave={undefined} onCancel={cancelEdit} editing={false} placeholder="e.g. Renthal bars, FMF exhaust" />
                  <FieldRow label="Country" value={item.countryOfOrigin || ''} onEdit={() => startEdit('countryOfOrigin', item.countryOfOrigin || '')} editValue={editing === 'countryOfOrigin' ? editValue : undefined} onChangeText={setEditValue} onSave={() => saveField('countryOfOrigin')} onCancel={cancelEdit} editing={editing === 'countryOfOrigin'} placeholder="e.g. Japan, Austria" />
                </>) : null}
                {isClothing ? (<>
                  <FieldRow label="Brand" value={item.manufacturer || String(attrs.brand ?? attrs.brand_label ?? '')} onEdit={() => startEdit('manufacturer', item.manufacturer || '')} editValue={editing === 'manufacturer' ? editValue : undefined} onChangeText={setEditValue} onSave={() => saveField('manufacturer')} onCancel={cancelEdit} editing={editing === 'manufacturer'} placeholder="e.g. Levi's, Nike, Supreme" accent={accentColor} />
                  <FieldRow label="Garment Type" value={String(attrs.garment_type ?? '')} onEdit={() => {}} editValue={undefined} onChangeText={undefined} onSave={undefined} onCancel={cancelEdit} editing={false} placeholder="e.g. Jeans, Hoodie, T-Shirt" />
                  <FieldRow label="Era" value={String(attrs.era ?? attrs.era_estimate ?? '')} onEdit={() => {}} editValue={undefined} onChangeText={undefined} onSave={undefined} onCancel={cancelEdit} editing={false} placeholder="e.g. 1980s, Early 1990s" />
                  <FieldRow label="Size" value={String(attrs.size ?? attrs.labelled_size ?? '')} onEdit={() => {}} editValue={undefined} onChangeText={undefined} onSave={undefined} onCancel={cancelEdit} editing={false} placeholder="e.g. L, XL, 32W 30L" />
                  <FieldRow label="Composition" value={item.material || String(attrs.composition ?? '')} onEdit={() => startEdit('material', item.material || '')} editValue={editing === 'material' ? editValue : undefined} onChangeText={setEditValue} onSave={() => saveField('material')} onCancel={cancelEdit} editing={editing === 'material'} placeholder="e.g. 100% Cotton" />
                  <FieldRow label="Colour" value={String(attrs.colour ?? attrs.color_description ?? '')} onEdit={() => {}} editValue={undefined} onChangeText={undefined} onSave={undefined} onCancel={cancelEdit} editing={false} placeholder="e.g. Washed Blue" />
                  <FieldRow label="Made In" value={item.countryOfOrigin || ''} onEdit={() => startEdit('countryOfOrigin', item.countryOfOrigin || '')} editValue={editing === 'countryOfOrigin' ? editValue : undefined} onChangeText={setEditValue} onSave={() => saveField('countryOfOrigin')} onCancel={cancelEdit} editing={editing === 'countryOfOrigin'} placeholder="e.g. USA, Japan" />
                  <FieldRow label="Auth Risk" value={String(attrs.authenticity_risk_level ?? attrs.authentication_risk_level ?? '')} onEdit={() => {}} editValue={undefined} onChangeText={undefined} onSave={undefined} onCancel={cancelEdit} editing={false} placeholder="LOW / MEDIUM / HIGH" accent={accentColor} />
                </>) : null}
                {isCoin ? (<>
                  <FieldRow label="Denomination" value={item.denomination || ''} onEdit={() => startEdit('denomination', item.denomination || '')} editValue={editing === 'denomination' ? editValue : undefined} onChangeText={setEditValue} onSave={() => saveField('denomination')} onCancel={cancelEdit} editing={editing === 'denomination'} placeholder="e.g. Crown, Tanka, Dirham" accent={Colors.gold} />
                  <FieldRow label="Ruler" value={item.ruler || ''} onEdit={() => startEdit('ruler', item.ruler || '')} editValue={editing === 'ruler' ? editValue : undefined} onChangeText={setEditValue} onSave={() => saveField('ruler')} onCancel={cancelEdit} editing={editing === 'ruler'} placeholder="e.g. Victoria, Augustus" />
                  <FieldRow label="Period" value={item.period || ''} onEdit={() => startEdit('period', item.period || '')} editValue={editing === 'period' ? editValue : undefined} onChangeText={setEditValue} onSave={() => saveField('period')} onCancel={cancelEdit} editing={editing === 'period'} placeholder="e.g. Timurid, Victorian, Roman" />
                  <FieldRow label="Mint" value={item.mint || ''} onEdit={() => startEdit('mint', item.mint || '')} editValue={editing === 'mint' ? editValue : undefined} onChangeText={setEditValue} onSave={() => saveField('mint')} onCancel={cancelEdit} editing={editing === 'mint'} placeholder="e.g. London, Samarkand" />
                  <FieldRow label="Catalogue No." value={item.catalogueNumber || ''} onEdit={() => startEdit('catalogueNumber', item.catalogueNumber || '')} editValue={editing === 'catalogueNumber' ? editValue : undefined} onChangeText={setEditValue} onSave={() => saveField('catalogueNumber')} onCancel={cancelEdit} editing={editing === 'catalogueNumber'} placeholder="e.g. Spink 1234" accent={Colors.accent} />
                  <FieldRow label="Year" value={item.yearMade || ''} onEdit={() => startEdit('yearMade', item.yearMade || '')} editValue={editing === 'yearMade' ? editValue : undefined} onChangeText={setEditValue} onSave={() => saveField('yearMade')} onCancel={cancelEdit} editing={editing === 'yearMade'} placeholder="e.g. 1887" />
                  <FieldRow label="Country" value={item.countryOfOrigin || ''} onEdit={() => startEdit('countryOfOrigin', item.countryOfOrigin || '')} editValue={editing === 'countryOfOrigin' ? editValue : undefined} onChangeText={setEditValue} onSave={() => saveField('countryOfOrigin')} onCancel={cancelEdit} editing={editing === 'countryOfOrigin'} placeholder="e.g. United Kingdom" />
                  <FieldRow label="Material" value={item.material || ''} onEdit={() => startEdit('material', item.material || '')} editValue={editing === 'material' ? editValue : undefined} onChangeText={setEditValue} onSave={() => saveField('material')} onCancel={cancelEdit} editing={editing === 'material'} placeholder="e.g. Silver, Copper" />
                  <FieldRow label="Diameter" value={item.diameterMm ? `${item.diameterMm}mm` : ''} onEdit={() => startEdit('diameterMm', item.diameterMm ? String(item.diameterMm) : '')} editValue={editing === 'diameterMm' ? editValue : undefined} onChangeText={setEditValue} onSave={() => saveField('diameterMm')} onCancel={cancelEdit} editing={editing === 'diameterMm'} numeric placeholder="e.g. 38.6" />
                  <FieldRow label="Weight" value={item.weightGrams ? `${item.weightGrams}g` : ''} onEdit={() => startEdit('weightGrams', item.weightGrams ? String(item.weightGrams) : '')} editValue={editing === 'weightGrams' ? editValue : undefined} onChangeText={setEditValue} onSave={() => saveField('weightGrams')} onCancel={cancelEdit} editing={editing === 'weightGrams'} numeric placeholder="e.g. 28.3" />
                </>) : null}
              </View>
            </View>
          );
        })()}

        {/* ── META ── */}
        <View style={s.metaCard}>
          {[
            item.inventoryId ? { label: 'KC ID', value: item.inventoryId } : null,
            { label: 'Item ID', value: item.id.slice(0, 18) + '...' },
            { label: 'Created', value: new Date(item.createdAt).toLocaleDateString('en-GB') },
            { label: 'Photos', value: `${item.media?.length ?? 0} image${(item.media?.length ?? 0) === 1 ? '' : 's'}` },
          ].filter(Boolean).map(row => (
            <View key={row!.label} style={s.metaRow}>
              <Text style={s.metaLabel}>{row!.label}</Text>
              <Text style={s.metaValue}>{row!.value}</Text>
            </View>
          ))}
        </View>
      </ScrollView>

      {/* ── ACTION BAR ── */}
      <View style={[s.actionBar, { paddingBottom: insets.bottom + Spacing.sm }]}>
        <Pressable onPress={() => setReIdVisible(true)} style={[s.actionBtn, s.actionBtnReId]}>
          <MaterialIcons name="auto-awesome" size={15} color={Colors.accent} />
          <Text style={s.actionBtnReIdText}>Re-ID</Text>
        </Pressable>
        <Pressable
          onPress={() => router.push(`/research?q=${encodeURIComponent(item.canonicalTitle ?? '')}` as any)}
          style={[s.actionBtn, { flex: 0, paddingHorizontal: Spacing.md, backgroundColor: Colors.accentDim, borderWidth: 1, borderColor: Colors.accent + '40' }]}
          hitSlop={4}
          accessibilityLabel={`Research ${item.canonicalTitle} on eBay, Terapeak and Numista`}
          accessibilityRole="button"
        >
          <MaterialIcons name="manage-search" size={15} color={Colors.accent} />
        </Pressable>
        {listings.some(l => l.status === 'active' && l.externalListingId) ? (
          <Pressable onPress={handleSyncFromEbay} disabled={syncingEbay} style={[s.actionBtn, { backgroundColor: Colors.infoDim, borderWidth: 1, borderColor: Colors.info + '40', flex: 0, paddingHorizontal: Spacing.md }]}>
            {syncingEbay ? <ActivityIndicator size="small" color={Colors.info} style={{ width: 15, height: 15 }} /> : <MaterialIcons name="sync" size={15} color={Colors.info} />}
            <Text style={[s.actionBtnReIdText, { color: Colors.info }]}>{syncingEbay ? '...' : 'Sync'}</Text>
          </Pressable>
        ) : null}
        {listings.some(l => l.status === 'active' && l.externalListingId) ? (
          <Pressable onPress={handlePushToEbay} disabled={pushingToEbay} style={[s.actionBtn, { backgroundColor: Colors.successDim, borderWidth: 1, borderColor: Colors.success + '40', flex: 0, paddingHorizontal: Spacing.md }]}>
            {pushingToEbay ? <ActivityIndicator size="small" color={Colors.success} style={{ width: 15, height: 15 }} /> : <MaterialIcons name="cloud-upload" size={15} color={Colors.success} />}
            <Text style={[s.actionBtnReIdText, { color: Colors.success }]}>{pushingToEbay ? '...' : 'Push'}</Text>
          </Pressable>
        ) : null}
        {!isSold && !isListed ? (
          <Pressable
            onPress={() => router.push(`/create-listing?id=${item.id}` as any)}
            style={[s.actionBtn, s.actionBtnPrimary]}
          >
            <MaterialIcons name="sell" size={15} color={Colors.background} />
            <Text style={s.actionBtnText}>Create Listing</Text>
          </Pressable>
        ) : null}
        {draftListings.length > 0 ? (
          <Pressable
            onPress={() => router.push(`/listing-preflight?listingId=${draftListings[0].id}&itemId=${item.id}` as any)}
            disabled={submittingId !== null}
            style={[s.actionBtn, s.actionBtnPrimary]}
          >
            <MaterialIcons name="fact-check" size={15} color={Colors.background} />
            <Text style={s.actionBtnText}>Submit to eBay</Text>
          </Pressable>
        ) : null}
        {(draftListings.length > 0 || activeListings.length > 0) ? (
          <Pressable
            onPress={() => handleDeleteListing(draftListings[0] ?? activeListings[0])}
            disabled={endingId !== null}
            style={[s.actionBtn, { flex: 0, paddingHorizontal: Spacing.md, backgroundColor: Colors.dangerDim, borderWidth: 1, borderColor: Colors.danger + '40' }]}
            hitSlop={4}
            accessibilityLabel={draftListings.length > 0 ? 'Delete draft listing' : 'Delete listing'}
            accessibilityRole="button"
          >
            {endingId ? <ActivityIndicator size="small" color={Colors.danger} style={{ width: 15, height: 15 }} /> : <MaterialIcons name="delete-outline" size={15} color={Colors.danger} />}
          </Pressable>
        ) : null}
        {!isSold && activeListings.length === 0 && draftListings.length === 0 ? (
          <Pressable onPress={handleMarkSold} style={[s.actionBtn, s.actionBtnSecondary]}>
            <MaterialIcons name="sell" size={15} color={Colors.textSecondary} />
            <Text style={s.actionBtnSecondaryText}>Mark Sold</Text>
          </Pressable>
        ) : null}
        <Pressable onPress={handleExportFacebook} style={[s.actionBtn, { flex: 0, paddingHorizontal: Spacing.md, backgroundColor: '#1877F2' }]}>
          <MaterialIcons name="share" size={15} color="#fff" />
          <Text style={[s.actionBtnText, { color: '#fff', fontSize: 10 }]}>FB</Text>
        </Pressable>
      </View>

      {saving ? (
        <View style={s.savingIndicator}><ActivityIndicator size="small" color={Colors.primary} /><Text style={s.savingText}>Saving...</Text></View>
      ) : null}

      {tenant ? (
        <ReIdentifyModal visible={reIdVisible} item={item} tenantId={tenant.id} onClose={() => setReIdVisible(false)} onComplete={handleReIdComplete} />
      ) : null}

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

// ─────────────────────────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },

  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.base, paddingBottom: Spacing.sm, borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder },
  headerBtn: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.surfaceBorder },
  headerTitle: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.textPrimary },
  kcBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: Colors.primaryDim, borderRadius: Radius.sm, paddingHorizontal: 5, paddingVertical: 2, alignSelf: 'flex-start', borderWidth: 1, borderColor: Colors.primary + '40' },
  kcBadgeText: { fontSize: 9, fontWeight: Typography.weight.bold, color: Colors.primary, letterSpacing: 0.4 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusLabel: { fontSize: Typography.size.xs, fontWeight: Typography.weight.medium, textTransform: 'capitalize' },

  content: { padding: Spacing.base, gap: Spacing.lg },

  // Status banners
  liveBanner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.successDim, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.success + '40' },
  liveBannerText: { flex: 1, fontSize: Typography.size.xs, color: Colors.success, fontWeight: Typography.weight.medium },
  watcherChip: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: Colors.goldDim, borderRadius: Radius.pill, paddingHorizontal: 6, paddingVertical: 3 },
  watcherText: { fontSize: 10, color: Colors.gold, fontWeight: Typography.weight.bold },
  endBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: Colors.dangerDim, borderRadius: Radius.sm, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: Colors.danger + '30' },
  endBtnText: { fontSize: 10, color: Colors.danger, fontWeight: Typography.weight.semibold },
  viewEbayBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: Colors.infoDim, borderRadius: Radius.sm, paddingHorizontal: 7, paddingVertical: 4, borderWidth: 1, borderColor: Colors.info + '30' },
  viewEbayBtnText: { fontSize: 10, color: Colors.info, fontWeight: Typography.weight.semibold },
  soldBanner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.successDim, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.success + '40' },
  soldBannerText: { flex: 1, fontSize: Typography.size.xs, color: Colors.success, fontWeight: Typography.weight.medium },
  reviewBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, backgroundColor: Colors.warningDim, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.warning + '40' },
  reviewBannerTitle: { fontSize: Typography.size.xs, fontWeight: Typography.weight.bold, color: Colors.warning },
  reviewBannerSub: { fontSize: 10, color: Colors.warning + 'BB', lineHeight: 14, marginTop: 2 },

  // Listing card
  listingCard: { backgroundColor: Colors.surface, borderRadius: Radius.xl, padding: Spacing.md, gap: Spacing.md, borderWidth: 1, borderColor: Colors.surfaceBorder, ...Shadow.sm },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  listingTitle: { fontSize: Typography.size.base, fontWeight: Typography.weight.bold, color: Colors.textPrimary, lineHeight: 22 },
  listingDescPreview: { fontSize: Typography.size.xs, color: Colors.textTertiary, lineHeight: 16, marginTop: 3 },
  listingMetaRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  listingMetaLabel: { fontSize: Typography.size.xs, color: Colors.textTertiary, minWidth: 70 },
  listingMetaValue: { flex: 1, fontSize: Typography.size.xs, color: Colors.textSecondary, fontWeight: Typography.weight.medium },
  listingActions: { flexDirection: 'row', gap: Spacing.sm, marginTop: 4 },
  listingEditBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.primaryDim, borderRadius: Radius.pill, paddingHorizontal: Spacing.md, paddingVertical: 6, borderWidth: 1, borderColor: Colors.primary + '40' },
  listingEditBtnText: { fontSize: Typography.size.xs, fontWeight: Typography.weight.semibold, color: Colors.primary },

  // Pricing card
  pricingCard: { backgroundColor: Colors.surface, borderRadius: Radius.xl, padding: Spacing.md, gap: Spacing.md, borderWidth: 1, borderColor: Colors.gold + '30', ...Shadow.sm },
  pricingRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  pricingDivider: { width: 1, height: 48, backgroundColor: Colors.surfaceBorder, marginTop: 4 },
  pricingItem: { flex: 1, gap: 4, alignItems: 'center' },
  pricingItemLabel: { fontSize: 9, fontWeight: Typography.weight.bold, color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.4, textAlign: 'center' },
  pricingItemValue: { fontSize: Typography.size.lg, fontWeight: Typography.weight.bold, color: Colors.textPrimary, textAlign: 'center' },
  pricingSetBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: Colors.primaryDim, borderRadius: Radius.pill, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: Colors.primary + '30' },
  pricingSetBtnText: { fontSize: 10, color: Colors.primary, fontWeight: Typography.weight.semibold },
  profitRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.md, padding: Spacing.sm },
  profitText: { flex: 1, fontSize: Typography.size.xs, fontWeight: Typography.weight.medium, lineHeight: 15 },
  profitMissingNote: { fontSize: Typography.size.xs, color: Colors.textTertiary, textAlign: 'center', fontStyle: 'italic' },
  inlineEditRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.md, padding: Spacing.sm, borderWidth: 1, borderColor: Colors.primary + '40' },
  inlineEditLabel: { fontSize: 10, color: Colors.textTertiary, minWidth: 90 },
  inlineEditCurrency: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.textSecondary },
  inlineEditInput: { flex: 1, fontSize: Typography.size.sm, color: Colors.textPrimary, includeFontPadding: false, paddingVertical: 0 },
  inlineEditSave: { width: 26, height: 26, borderRadius: Radius.sm, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  inlineEditCancel: { width: 26, height: 26, borderRadius: Radius.sm, backgroundColor: Colors.surfaceBorder, alignItems: 'center', justifyContent: 'center' },

  // Delivery card
  deliveryCard: { backgroundColor: Colors.surface, borderRadius: Radius.xl, padding: Spacing.md, gap: Spacing.sm, borderWidth: 1, borderColor: Colors.info + '30', ...Shadow.sm },
  deliveryContent: { gap: Spacing.sm },
  deliveryBadge: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.successDim, borderRadius: Radius.md, padding: Spacing.sm, borderWidth: 1, borderColor: Colors.success + '30' },
  deliveryTitle: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.success },
  deliverySub: { fontSize: 10, color: Colors.success + 'BB', marginTop: 1 },
  deliveryNote: { fontSize: 10, color: Colors.textTertiary, lineHeight: 14 },

  // SWISH Intelligence card
  intelligenceCard: { backgroundColor: Colors.surface, borderRadius: Radius.xl, borderWidth: 1, borderColor: Colors.accent + '30', overflow: 'hidden', ...Shadow.sm },
  intelligenceHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.md },
  intelligenceHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flex: 1 },
  intelligenceIcon: { width: 28, height: 28, borderRadius: Radius.sm, backgroundColor: Colors.accentDim, alignItems: 'center', justifyContent: 'center' },
  intelligenceTitle: { fontSize: 10, fontWeight: Typography.weight.bold, color: Colors.accent, textTransform: 'uppercase', letterSpacing: 0.6 },
  intelligenceMeta: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, marginTop: 3, flexWrap: 'wrap' },
  confPill: { flexDirection: 'row', alignItems: 'center', borderRadius: Radius.pill, paddingHorizontal: 7, paddingVertical: 3, borderWidth: 1 },
  confPillText: { fontSize: 9, fontWeight: Typography.weight.bold, letterSpacing: 0.3 },
  statePill: { backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.pill, paddingHorizontal: 7, paddingVertical: 3 },
  statePillText: { fontSize: 9, color: Colors.textTertiary, textTransform: 'capitalize' },
  intelligenceSummary: { paddingHorizontal: Spacing.md, paddingBottom: Spacing.md, borderTopWidth: 1, borderTopColor: Colors.surfaceBorder },
  intelligenceContent: { paddingHorizontal: Spacing.md, paddingBottom: Spacing.md, gap: Spacing.md, borderTopWidth: 1, borderTopColor: Colors.surfaceBorder },
  intelBlock: { gap: Spacing.xs },
  intelBlockLabel: { fontSize: 9, fontWeight: Typography.weight.bold, color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5 },
  intelBlockTitle: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  intelBlockValue: { fontSize: Typography.size.sm, color: Colors.textPrimary },
  intelBlockNote: { fontSize: Typography.size.xs, color: Colors.textTertiary, lineHeight: 15, fontStyle: 'italic' },
  intelWarning: { flexDirection: 'row', alignItems: 'flex-start', gap: 5, backgroundColor: Colors.warningDim, borderRadius: Radius.sm, padding: Spacing.sm, borderWidth: 1, borderColor: Colors.warning + '30' },
  intelWarningText: { flex: 1, fontSize: 10, color: Colors.warning, lineHeight: 14 },
  intelAlert: { flexDirection: 'row', alignItems: 'flex-start', gap: 5, backgroundColor: Colors.dangerDim, borderRadius: Radius.sm, padding: Spacing.sm, borderWidth: 1, borderColor: Colors.danger + '30' },
  intelAlertText: { flex: 1, fontSize: 10, color: Colors.danger, lineHeight: 14 },
  warningsBlock: { backgroundColor: Colors.dangerDim, borderRadius: Radius.md, padding: Spacing.sm, gap: Spacing.xs, borderWidth: 1, borderColor: Colors.danger + '25' },
  warningRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.xs },
  warningText: { flex: 1, fontSize: 10, color: Colors.danger, lineHeight: 14 },
  showMoreBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingTop: Spacing.sm },
  showMoreBtnText: { fontSize: Typography.size.xs, color: Colors.primary, fontWeight: Typography.weight.semibold },

  // Inventory / Coin cards
  inventoryCard: { backgroundColor: Colors.surface, borderRadius: Radius.xl, padding: Spacing.md, gap: Spacing.md, borderWidth: 1, borderColor: Colors.surfaceBorder, ...Shadow.sm },
  coinCard: { backgroundColor: Colors.surface, borderRadius: Radius.xl, padding: Spacing.md, gap: Spacing.md, borderWidth: 1, borderColor: Colors.gold + '20', ...Shadow.sm },
  card: { backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.lg, paddingHorizontal: Spacing.md, borderWidth: 1, borderColor: Colors.surfaceBorder },

  // Meta
  metaCard: { backgroundColor: Colors.surface, borderRadius: Radius.xl, borderWidth: 1, borderColor: Colors.surfaceBorder, padding: Spacing.md, gap: Spacing.xs },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 2 },
  metaLabel: { fontSize: Typography.size.xs, color: Colors.textTertiary },
  metaValue: { fontSize: Typography.size.xs, color: Colors.textSecondary, fontWeight: Typography.weight.medium },

  // Action bar
  actionBar: { flexDirection: 'row', gap: Spacing.sm, padding: Spacing.base, backgroundColor: Colors.surface, borderTopWidth: 1, borderTopColor: Colors.surfaceBorder },
  actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xs, paddingVertical: Spacing.md, borderRadius: Radius.md },
  actionBtnReId: { flex: 0, paddingHorizontal: Spacing.md, backgroundColor: Colors.accentDim, borderWidth: 1, borderColor: Colors.accent + '40' },
  actionBtnReIdText: { fontSize: Typography.size.xs, fontWeight: Typography.weight.bold, color: Colors.accent },
  actionBtnReValue: { flex: 0, paddingHorizontal: Spacing.md, backgroundColor: Colors.goldDim, borderWidth: 1, borderColor: Colors.gold + '40' },
  actionBtnReValueText: { fontSize: Typography.size.xs, fontWeight: Typography.weight.bold, color: Colors.gold },
  actionBtnSecondary: { backgroundColor: Colors.surfaceElevated, borderWidth: 1, borderColor: Colors.surfaceBorder },
  actionBtnSecondaryText: { fontSize: Typography.size.xs, fontWeight: Typography.weight.semibold, color: Colors.textSecondary },
  actionBtnPrimary: { backgroundColor: Colors.primary, ...Shadow.glow },
  actionBtnAccent: { backgroundColor: Colors.accent },
  actionBtnText: { fontSize: Typography.size.xs, fontWeight: Typography.weight.bold, color: Colors.background },
  savingIndicator: { position: 'absolute', top: 80, right: Spacing.base, flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, backgroundColor: Colors.surface, borderRadius: Radius.pill, paddingHorizontal: Spacing.md, paddingVertical: 5, borderWidth: 1, borderColor: Colors.surfaceBorder, ...Shadow.sm },
  savingText: { fontSize: Typography.size.xs, color: Colors.textSecondary },
  emptyTitle: { fontSize: Typography.size.lg, color: Colors.textSecondary, marginTop: Spacing.md },
  backLink: { marginTop: Spacing.md, padding: Spacing.md },
  backLinkText: { fontSize: Typography.size.sm, color: Colors.primary },
});