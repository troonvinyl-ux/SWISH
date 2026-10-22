// KEENONCOINS — Dispatch / Picking Screen
// Phone-optimised picking workflow for orders awaiting dispatch.
// One-tap flow: AWAITING DISPATCH → PACKING → LABEL CREATED → DISPATCHED
// Shows large photo, KC Inventory ID, folder, catalogue number, storage location.

import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  View, Text, StyleSheet, FlatList, Pressable,
  TextInput, ScrollView, ActivityIndicator, RefreshControl, Modal, Platform,
  Dimensions, NativeScrollEvent, NativeSyntheticEvent,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { ItemImage } from '@/components';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { Colors, Typography, Spacing, Radius, Shadow } from '@/constants/theme';
import { useApp } from '@/hooks/useApp';
import { NICHES } from '@/constants/niches';
import { useAlert } from '@/template';
import { getSupabaseClient } from '@/template';
import { FunctionsHttpError } from '@supabase/supabase-js';
import {
  OrderWithItem, FulfilmentStatus, FULFILMENT_LABELS,
  getOrdersToDispatch, updateOrderFulfilmentStatus,
  getShippingServices, ShippingService,
} from '@/services/coinInventoryService';

// ── Storage helpers for dispatch photos ──────────────────────────────────────

const DISPATCH_BUCKET = 'item-images';

async function uploadDispatchPhoto(
  orderId: string,
  uri: string,
): Promise<string | null> {
  try {
    const supabase = getSupabaseClient();
    const fileName = `dispatch/${orderId}/proof_${Date.now()}.jpg`;

    if (Platform.OS === 'web') {
      const response = await fetch(uri);
      const blob = await response.blob();
      const { error } = await supabase.storage
        .from(DISPATCH_BUCKET)
        .upload(fileName, blob, { contentType: 'image/jpeg', upsert: true });
      if (error) { console.error('Dispatch upload error:', error.message); return null; }
    } else {
      const base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const binaryStr = atob(base64);
      const bytes = new Uint8Array(binaryStr.length);
      for (let j = 0; j < binaryStr.length; j++) bytes[j] = binaryStr.charCodeAt(j);
      const { error } = await supabase.storage
        .from(DISPATCH_BUCKET)
        .upload(fileName, bytes.buffer, { contentType: 'image/jpeg', upsert: true });
      if (error) { console.error('Dispatch upload error:', error.message); return null; }
    }

    const { data } = supabase.storage.from(DISPATCH_BUCKET).getPublicUrl(fileName);
    return data?.publicUrl ?? null;
  } catch (e: any) {
    console.error('uploadDispatchPhoto:', e.message);
    return null;
  }
}

// ── Step flow ─────────────────────────────────────────────────────────────────

type DispatchStep = 'awaiting_dispatch' | 'packing' | 'label_created' | 'dispatched';

const STEP_FLOW: DispatchStep[] = ['awaiting_dispatch', 'packing', 'label_created', 'dispatched'];

const STEP_CONFIG: Record<DispatchStep, {
  label: string;
  action: string;
  icon: string;
  color: string;
  bgColor: string;
}> = {
  awaiting_dispatch: {
    label: 'Awaiting Dispatch',
    action: 'Mark as Packing',
    icon: 'inbox',
    color: Colors.warning,
    bgColor: Colors.warningDim,
  },
  packing: {
    label: 'Packing',
    action: 'Label Created',
    icon: 'inventory-2',
    color: Colors.info,
    bgColor: Colors.infoDim,
  },
  label_created: {
    label: 'Label Ready',
    action: 'Mark Dispatched',
    icon: 'label',
    color: Colors.primary,
    bgColor: Colors.primaryDim,
  },
  dispatched: {
    label: 'Dispatched',
    action: 'Completed',
    icon: 'local-shipping',
    color: Colors.success,
    bgColor: Colors.successDim,
  },
};

// ── Dispatch Card ─────────────────────────────────────────────────────────────

function DispatchCard({
  order,
  onAdvance,
  onViewItem,
}: {
  order: OrderWithItem;
  onAdvance: (order: OrderWithItem) => void;
  onViewItem: (itemId: string) => void;
}) {
  const step = (order.fulfilmentStatus as DispatchStep) ?? 'awaiting_dispatch';
  const config = STEP_CONFIG[step] ?? STEP_CONFIG.awaiting_dispatch;
  const media = order.itemMedia ?? [];
  const hasPhotos = media.length > 0;
  const nextStep = STEP_FLOW[STEP_FLOW.indexOf(step) + 1] as DispatchStep | undefined;
  const [activeIndex, setActiveIndex] = useState(0);
  const photoWidth = Dimensions.get('window').width - Spacing.base * 2; // card horizontal padding

  const handleGalleryScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const idx = Math.round(e.nativeEvent.contentOffset.x / photoWidth);
      setActiveIndex(Math.max(0, Math.min(idx, media.length - 1)));
    },
    [photoWidth, media.length],
  );

  return (
    <View style={card.wrap}>
      {/* Swipeable photo gallery hero */}
      <View style={[card.photoWrap, { width: photoWidth }]}>
        {hasPhotos ? (
          <FlatList
            data={media}
            keyExtractor={(uri, i) => `${uri}-${i}`}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={handleGalleryScroll}
            renderItem={({ item: uri }) => (
              <ItemImage
                uri={uri}
                style={[card.photo, { width: photoWidth }]}
                contentFit="cover"
                transition={200}
              />
            )}
            getItemLayout={(_, index) => ({ length: photoWidth, offset: photoWidth * index, index })}
          />
        ) : (
          <View style={[card.photoPlaceholder, { width: photoWidth }]}>
            <MaterialIcons name="toll" size={52} color={Colors.textTertiary} />
            <Text style={card.photoPlaceholderText}>No Photo</Text>
          </View>
        )}

        {/* Status badge overlay */}
        <View style={[card.statusBadge, { backgroundColor: config.bgColor + 'EE' }]}>
          <MaterialIcons name={config.icon as any} size={13} color={config.color} />
          <Text style={[card.statusText, { color: config.color }]}>{config.label}</Text>
        </View>

        {/* Marketplace badge */}
        <View style={card.mktBadge}>
          <MaterialIcons name="storefront" size={10} color={Colors.accent} />
          <Text style={card.mktText}>{order.marketplaceId.toUpperCase()}</Text>
        </View>

        {/* Photo count + dot indicators */}
        {media.length > 1 ? (
          <>
            <View style={card.photoCountBadge}>
              <MaterialIcons name="photo-library" size={10} color="#fff" />
              <Text style={card.photoCountText}>{activeIndex + 1} / {media.length}</Text>
            </View>
            <View style={card.dotRow}>
              {media.map((_, i) => (
                <View
                  key={i}
                  style={[
                    card.dot,
                    i === activeIndex ? card.dotActive : card.dotInactive,
                  ]}
                />
              ))}
            </View>
          </>
        ) : null}
      </View>

      {/* Pick location — most important info, large and prominent */}
      <View style={card.locationCard}>
        <View style={card.locationHeader}>
          <MaterialIcons name="location-on" size={18} color={Colors.primary} />
          <Text style={card.locationTitle}>Pick Location</Text>
        </View>
        <View style={card.locationGrid}>
          {order.inventoryId ? (
            <View style={card.locationItem}>
              <Text style={card.locationLabel}>KC ID</Text>
              <Text style={card.locationValueBig}>{order.inventoryId}</Text>
            </View>
          ) : null}
          {order.folderNumber ? (
            <View style={card.locationItem}>
              <Text style={card.locationLabel}>Folder</Text>
              <Text style={card.locationValueBig}>{order.folderNumber}</Text>
            </View>
          ) : null}
          {order.pocketPosition ? (
            <View style={card.locationItem}>
              <Text style={card.locationLabel}>Pocket</Text>
              <Text style={card.locationValueBig}>{order.pocketPosition}</Text>
            </View>
          ) : null}
          {order.catalogueNumber ? (
            <View style={card.locationItem}>
              <Text style={card.locationLabel}>Catalogue</Text>
              <Text style={[card.locationValueBig, { color: Colors.accent }]}>{order.catalogueNumber}</Text>
            </View>
          ) : null}
        </View>
        {order.storageLocation ? (
          <View style={card.storageRow}>
            <MaterialIcons name="shelves" size={13} color={Colors.textTertiary} />
            <Text style={card.storageText}>{order.storageLocation}</Text>
          </View>
        ) : null}
      </View>

      {/* Item description */}
      <View style={card.descSection}>
        <Text style={card.itemTitle} numberOfLines={3}>{order.itemTitle ?? 'Order'}</Text>
        {order.buyerName ? (
          <View style={card.buyerRow}>
            <MaterialIcons name="person" size={13} color={Colors.textTertiary} />
            <Text style={card.buyerText}>{order.buyerName}</Text>
            {order.buyerAddress?.postcode ? (
              <Text style={card.buyerPostcode}>{order.buyerAddress.postcode}</Text>
            ) : null}
          </View>
        ) : null}
        {order.externalOrderId ? (
          <Text style={card.orderId}>Order #{order.externalOrderId.slice(0, 20)}</Text>
        ) : null}
      </View>

      {/* Financials mini strip */}
      <View style={card.financials}>
        <View style={card.finItem}>
          <Text style={card.finLabel}>Sale</Text>
          <Text style={[card.finValue, { color: Colors.textPrimary }]}>
            £{order.salePrice.toFixed(2)}
          </Text>
        </View>
        <View style={card.finItem}>
          <Text style={card.finLabel}>Postage</Text>
          <Text style={card.finValue}>£{order.shippingCost.toFixed(2)}</Text>
        </View>
        <View style={card.finItem}>
          <Text style={card.finLabel}>Net</Text>
          <Text style={[card.finValue, { color: Colors.success }]}>
            £{order.netRevenue.toFixed(2)}
          </Text>
        </View>
        <View style={card.finItem}>
          <Text style={card.finLabel}>Date</Text>
          <Text style={card.finValue}>
            {new Date(order.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
          </Text>
        </View>
      </View>

      {/* Tracking if dispatched */}
      {order.trackingNumber ? (
        <View style={card.trackingRow}>
          <MaterialIcons name="local-shipping" size={13} color={Colors.info} />
          <Text style={card.trackingText}>
            {order.carrier ? `${order.carrier}: ` : ''}{order.trackingNumber}
          </Text>
        </View>
      ) : null}

      {/* Dispatch proof photo if available */}
      {order.dispatchPhotoUrl ? (
        <View style={card.proofRow}>
          <MaterialIcons name="photo-camera" size={12} color={Colors.success} />
          <Text style={card.proofLabel}>Dispatch proof</Text>
          <Image
            source={{ uri: order.dispatchPhotoUrl }}
            style={card.proofThumb}
            contentFit="cover"
            transition={150}
          />
        </View>
      ) : null}

      {/* Action buttons */}
      <View style={card.actions}>
        {order.itemId ? (
          <Pressable
            onPress={() => onViewItem(order.itemId!)}
            style={({ pressed }) => [card.secondaryBtn, pressed && { opacity: 0.8 }]}
          >
            <MaterialIcons name="toll" size={14} color={Colors.textSecondary} />
            <Text style={card.secondaryBtnText}>View Item</Text>
          </Pressable>
        ) : null}
        {nextStep ? (
          <Pressable
            onPress={() => onAdvance(order)}
            style={({ pressed }) => [card.primaryBtn, { backgroundColor: config.color }, pressed && { opacity: 0.85 }]}
          >
            <MaterialIcons
              name={nextStep === 'dispatched' ? 'local-shipping' : 'arrow-forward'}
              size={16}
              color={Colors.background}
            />
            <Text style={card.primaryBtnText}>{config.action}</Text>
          </Pressable>
        ) : (
          <View style={card.doneChip}>
            <MaterialIcons name="check-circle" size={14} color={Colors.success} />
            <Text style={card.doneChipText}>Dispatched</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const card = StyleSheet.create({
  wrap: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.xxl,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    ...Shadow.md,
  },
  photoWrap: { position: 'relative', height: 220, overflow: 'hidden' },
  photo: { height: 220 },
  photoPlaceholder: {
    height: 220,
    backgroundColor: Colors.surfaceHighlight,
    alignItems: 'center', justifyContent: 'center', gap: Spacing.sm,
  },
  photoCountBadge: {
    position: 'absolute', top: Spacing.md, left: '50%',
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: Radius.pill,
    paddingHorizontal: 8, paddingVertical: 4,
    transform: [{ translateX: -30 }],
  },
  photoCountText: { fontSize: 11, fontWeight: Typography.weight.bold, color: '#fff' },
  dotRow: {
    position: 'absolute', bottom: Spacing.sm, left: 0, right: 0,
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 5,
  },
  dot: { borderRadius: 3 },
  dotActive: { width: 16, height: 5, backgroundColor: '#ffffff' },
  dotInactive: { width: 5, height: 5, backgroundColor: 'rgba(255,255,255,0.45)' },
  photoPlaceholderText: { fontSize: Typography.size.sm, color: Colors.textTertiary },
  statusBadge: {
    position: 'absolute', top: Spacing.md, left: Spacing.md,
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderRadius: Radius.pill, paddingHorizontal: Spacing.sm, paddingVertical: 5,
  },
  statusText: { fontSize: Typography.size.xs, fontWeight: Typography.weight.bold },
  mktBadge: {
    position: 'absolute', top: Spacing.md, right: Spacing.md,
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: Colors.accentDim + 'EE', borderRadius: Radius.pill,
    paddingHorizontal: 8, paddingVertical: 4,
  },
  mktText: { fontSize: 10, fontWeight: Typography.weight.bold, color: Colors.accent },

  locationCard: {
    backgroundColor: Colors.primaryDim,
    padding: Spacing.base,
    gap: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.primary + '30',
  },
  locationHeader: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.xs,
  },
  locationTitle: {
    fontSize: Typography.size.xs,
    fontWeight: Typography.weight.bold,
    color: Colors.primary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  locationGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md,
  },
  locationItem: { alignItems: 'flex-start', gap: 2, minWidth: 72 },
  locationLabel: {
    fontSize: 9,
    fontWeight: Typography.weight.bold,
    color: Colors.primary + '99',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  locationValueBig: {
    fontSize: Typography.size.xl,
    fontWeight: Typography.weight.extrabold,
    color: Colors.primary,
  },
  storageRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  storageText: { fontSize: Typography.size.xs, color: Colors.textSecondary },

  descSection: {
    padding: Spacing.base, gap: Spacing.xs,
    borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder,
  },
  itemTitle: {
    fontSize: Typography.size.base,
    fontWeight: Typography.weight.semibold,
    color: Colors.textPrimary,
    lineHeight: Typography.size.base * 1.4,
  },
  buyerRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  buyerText: { fontSize: Typography.size.sm, color: Colors.textSecondary, fontWeight: Typography.weight.medium },
  buyerPostcode: { fontSize: Typography.size.sm, color: Colors.textTertiary },
  orderId: { fontSize: Typography.size.xs, color: Colors.textTertiary },

  financials: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceBorder,
  },
  finItem: { flex: 1, alignItems: 'center', gap: 2 },
  finLabel: { fontSize: 9, color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.3 },
  finValue: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.textSecondary },

  trackingRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingHorizontal: Spacing.base, paddingVertical: Spacing.sm,
    borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder,
    backgroundColor: Colors.infoDim,
  },
  trackingText: { fontSize: Typography.size.xs, color: Colors.info, fontWeight: Typography.weight.medium },

  proofRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingHorizontal: Spacing.base, paddingVertical: Spacing.sm,
    borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder,
    backgroundColor: Colors.successDim,
  },
  proofLabel: { flex: 1, fontSize: Typography.size.xs, color: Colors.success, fontWeight: Typography.weight.medium },
  proofThumb: { width: 52, height: 52, borderRadius: Radius.sm, borderWidth: 1.5, borderColor: Colors.success + '60' },

  actions: {
    flexDirection: 'row', gap: Spacing.sm,
    padding: Spacing.base,
  },
  secondaryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.xs,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.md,
    borderRadius: Radius.md,
    backgroundColor: Colors.surfaceHighlight,
    borderWidth: 1, borderColor: Colors.surfaceBorder,
  },
  secondaryBtnText: {
    fontSize: Typography.size.sm,
    fontWeight: Typography.weight.semibold,
    color: Colors.textSecondary,
  },
  primaryBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: Spacing.xs, paddingVertical: Spacing.base, borderRadius: Radius.md,
  },
  primaryBtnText: {
    fontSize: Typography.size.base,
    fontWeight: Typography.weight.bold,
    color: Colors.background,
  },
  doneChip: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: Spacing.xs, backgroundColor: Colors.successDim, borderRadius: Radius.md,
    paddingVertical: Spacing.base, borderWidth: 1, borderColor: Colors.success + '40',
  },
  doneChipText: {
    fontSize: Typography.size.base,
    fontWeight: Typography.weight.bold,
    color: Colors.success,
  },
});

// ── Dispatch Modal (for label_created → dispatched step) ─────────────────────

function DispatchConfirmModal({
  order,
  visible,
  shippingServices,
  onClose,
  onConfirm,
}: {
  order: OrderWithItem | null;
  visible: boolean;
  shippingServices: ShippingService[];
  onClose: () => void;
  onConfirm: (tracking: string, carrier: string, dispatchPhotoUri: string | null) => Promise<void>;
}) {
  const insets = useSafeAreaInsets();
  const [tracking, setTracking] = useState('');
  const [selectedCarrier, setSelectedCarrier] = useState('Royal Mail');
  const [saving, setSaving] = useState(false);
  const [dispatchPhotoUri, setDispatchPhotoUri] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  const carrierOptions = useMemo(() => {
    const fromServices = shippingServices.map(s => s.carrier);
    const defaults = ['Royal Mail', 'Evri', 'DPD', 'Parcelforce', 'DHL', 'Other'];
    return [...new Set([...fromServices, ...defaults])];
  }, [shippingServices]);

  const handleCapturePhoto = useCallback(async () => {
    const { granted } = await ImagePicker.requestCameraPermissionsAsync();
    if (!granted) return;
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
      allowsEditing: false,
      exif: false,
    });
    if (!result.canceled && result.assets?.[0]) {
      setDispatchPhotoUri(result.assets[0].uri);
    }
  }, []);

  const handlePickPhoto = useCallback(async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
      allowsEditing: false,
      exif: false,
    });
    if (!result.canceled && result.assets?.[0]) {
      setDispatchPhotoUri(result.assets[0].uri);
    }
  }, []);

  const handleConfirm = useCallback(async () => {
    setSaving(true);
    await onConfirm(tracking.trim(), selectedCarrier, dispatchPhotoUri);
    setSaving(false);
    setTracking('');
    setDispatchPhotoUri(null);
  }, [tracking, selectedCarrier, dispatchPhotoUri, onConfirm]);

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={dm.overlay}>
        <ScrollView
          contentContainerStyle={[dm.card, { paddingBottom: insets.bottom + Spacing.base }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={dm.handle} />
          <View style={dm.header}>
            <View style={{ flex: 1 }}>
              <Text style={dm.title}>Confirm Dispatch</Text>
              {order ? (
                <Text style={dm.subtitle} numberOfLines={1}>{order.itemTitle ?? 'Order'}</Text>
              ) : null}
            </View>
            <Pressable onPress={onClose} hitSlop={8}>
              <MaterialIcons name="close" size={22} color={Colors.textSecondary} />
            </Pressable>
          </View>

          {/* Location reminder */}
          {order && (order.catalogueNumber || order.folderNumber || order.inventoryId) ? (
            <View style={dm.pickCard}>
              <MaterialIcons name="location-on" size={16} color={Colors.primary} />
              <View style={{ flex: 1 }}>
                <Text style={dm.pickLabel}>Physical Location</Text>
                <Text style={dm.pickValue}>
                  {[
                    order.inventoryId,
                    order.folderNumber ? `Folder ${order.folderNumber}` : null,
                    order.pocketPosition ? `Pocket ${order.pocketPosition}` : null,
                    order.catalogueNumber ? `Cat. ${order.catalogueNumber}` : null,
                  ].filter(Boolean).join(' · ')}
                </Text>
              </View>
            </View>
          ) : null}

          {/* ── PROOF OF DISPATCH PHOTO ── */}
          <View style={dm.photoSection}>
            <View style={dm.photoSectionHeader}>
              <MaterialIcons name="photo-camera" size={15} color={Colors.success} />
              <Text style={dm.photoSectionTitle}>Proof of Dispatch</Text>
              <View style={dm.optionalBadge}>
                <Text style={dm.optionalBadgeText}>Optional</Text>
              </View>
            </View>
            <Text style={dm.photoSectionSub}>
              Photograph the packed parcel and label for a permanent dispatch record.
            </Text>

            {dispatchPhotoUri ? (
              <View style={dm.photoPreviewWrap}>
                <Image
                  source={{ uri: dispatchPhotoUri }}
                  style={dm.photoPreview}
                  contentFit="cover"
                  transition={150}
                />
                {/* Overlay buttons */}
                <View style={dm.photoOverlayBar}>
                  <Pressable onPress={handleCapturePhoto} style={dm.photoOverlayBtn} hitSlop={6}>
                    <MaterialIcons name="refresh" size={13} color="#fff" />
                    <Text style={dm.photoOverlayBtnText}>Retake</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setDispatchPhotoUri(null)}
                    style={[dm.photoOverlayBtn, { backgroundColor: 'rgba(220,38,38,0.75)' }]}
                    hitSlop={6}
                  >
                    <MaterialIcons name="delete" size={13} color="#fff" />
                    <Text style={dm.photoOverlayBtnText}>Remove</Text>
                  </Pressable>
                </View>
                {/* Success indicator */}
                <View style={dm.photoCapturedBadge}>
                  <MaterialIcons name="check-circle" size={12} color={Colors.success} />
                  <Text style={dm.photoCapturedText}>Photo captured</Text>
                </View>
              </View>
            ) : (
              <View style={dm.photoCaptureBtns}>
                <Pressable
                  onPress={handleCapturePhoto}
                  style={({ pressed }) => [dm.photoCaptureBtn, dm.photoCaptureBtnPrimary, pressed && { opacity: 0.85 }]}
                >
                  <MaterialIcons name="photo-camera" size={20} color={Colors.background} />
                  <Text style={dm.photoCaptureBtnText}>Take Photo</Text>
                </Pressable>
                <Pressable
                  onPress={handlePickPhoto}
                  style={({ pressed }) => [dm.photoCaptureBtn, dm.photoCaptureBtnSecondary, pressed && { opacity: 0.85 }]}
                >
                  <MaterialIcons name="photo-library" size={20} color={Colors.textSecondary} />
                  <Text style={dm.photoCaptureBtnTextSecondary}>Library</Text>
                </Pressable>
              </View>
            )}
          </View>

          {/* Carrier chips */}
          <View style={dm.field}>
            <Text style={dm.fieldLabel}>Carrier</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={dm.chipsRow}>
              {carrierOptions.map(c => (
                <Pressable
                  key={c}
                  onPress={() => setSelectedCarrier(c)}
                  style={[dm.chip, selectedCarrier === c && dm.chipActive]}
                >
                  <Text style={[dm.chipText, selectedCarrier === c && dm.chipTextActive]}>{c}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>

          {/* Tracking number */}
          <View style={dm.field}>
            <Text style={dm.fieldLabel}>
              Tracking Number <Text style={dm.optional}>(optional)</Text>
            </Text>
            <TextInput
              style={dm.input}
              value={tracking}
              onChangeText={setTracking}
              placeholder="e.g. RM123456789GB"
              placeholderTextColor={Colors.textTertiary}
              autoCapitalize="characters"
            />
          </View>

          <Pressable
            onPress={handleConfirm}
            style={({ pressed }) => [dm.confirmBtn, pressed && { opacity: 0.85 }]}
            disabled={saving}
          >
            {saving
              ? <ActivityIndicator size="small" color={Colors.background} />
              : <MaterialIcons name="local-shipping" size={18} color={Colors.background} />
            }
            <Text style={dm.confirmBtnText}>
              {saving
                ? (dispatchPhotoUri ? 'Uploading photo...' : 'Saving...')
                : `Confirm Dispatch${dispatchPhotoUri ? ' + Save Photo' : ''}`
              }
            </Text>
          </Pressable>
        </ScrollView>
      </View>
    </Modal>
  );
}

const dm = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: Colors.overlay80, justifyContent: 'flex-end' },
  card: {
    backgroundColor: Colors.surfaceElevated,
    borderTopLeftRadius: Radius.xxl, borderTopRightRadius: Radius.xxl,
    padding: Spacing.xl, gap: Spacing.lg,
    borderTopWidth: 1, borderTopColor: Colors.surfaceBorder,
  },

  // Photo proof section
  photoSection: {
    gap: Spacing.md,
    backgroundColor: Colors.successDim,
    borderRadius: Radius.xl,
    padding: Spacing.md,
    borderWidth: 1, borderColor: Colors.success + '30',
  },
  photoSectionHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  photoSectionTitle: {
    fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.success, flex: 1,
  },
  photoSectionSub: { fontSize: Typography.size.xs, color: Colors.textSecondary, lineHeight: 16 },
  optionalBadge: {
    backgroundColor: Colors.surface, borderRadius: Radius.pill,
    paddingHorizontal: 7, paddingVertical: 2,
    borderWidth: 1, borderColor: Colors.surfaceBorder,
  },
  optionalBadgeText: { fontSize: 9, color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.3 },

  photoCaptureBtns: { flexDirection: 'row', gap: Spacing.sm },
  photoCaptureBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: Spacing.xs, paddingVertical: Spacing.md, borderRadius: Radius.md,
  },
  photoCaptureBtnPrimary: { backgroundColor: Colors.success, ...Shadow.sm },
  photoCaptureBtnSecondary: {
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.surfaceBorder,
  },
  photoCaptureBtnText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.background },
  photoCaptureBtnTextSecondary: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.textSecondary },

  photoPreviewWrap: {
    borderRadius: Radius.lg, overflow: 'hidden', position: 'relative',
    height: 200, borderWidth: 2, borderColor: Colors.success + '60',
  },
  photoPreview: { width: '100%', height: '100%' },
  photoOverlayBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', gap: Spacing.sm, padding: Spacing.sm,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  photoOverlayBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: Radius.sm, paddingHorizontal: 10, paddingVertical: 5,
  },
  photoOverlayBtnText: { fontSize: 11, color: '#fff', fontWeight: Typography.weight.semibold },
  photoCapturedBadge: {
    position: 'absolute', top: Spacing.sm, right: Spacing.sm,
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.successDim + 'EE', borderRadius: Radius.pill,
    paddingHorizontal: 8, paddingVertical: 4,
    borderWidth: 1, borderColor: Colors.success + '60',
  },
  photoCapturedText: { fontSize: 10, color: Colors.success, fontWeight: Typography.weight.semibold },
  handle: {
    width: 36, height: 4, borderRadius: Radius.pill,
    backgroundColor: Colors.surfaceHighlight, alignSelf: 'center', marginBottom: -Spacing.sm,
  },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  title: { fontSize: Typography.size.xl, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  subtitle: { fontSize: Typography.size.xs, color: Colors.textTertiary, marginTop: 2 },
  pickCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm,
    backgroundColor: Colors.primaryDim, borderRadius: Radius.md, padding: Spacing.md,
    borderWidth: 1, borderColor: Colors.primary + '30',
  },
  pickLabel: { fontSize: 9, color: Colors.primary, fontWeight: Typography.weight.bold, textTransform: 'uppercase', letterSpacing: 0.4 },
  pickValue: { fontSize: Typography.size.base, color: Colors.primary, fontWeight: Typography.weight.bold, marginTop: 2 },
  field: { gap: Spacing.xs },
  fieldLabel: {
    fontSize: Typography.size.xs, fontWeight: Typography.weight.semibold,
    color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4,
  },
  optional: { fontWeight: '400', textTransform: 'lowercase', color: Colors.textTertiary },
  chipsRow: { flexDirection: 'row', gap: Spacing.xs, paddingVertical: 4 },
  chip: {
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs + 2,
    borderRadius: Radius.pill, backgroundColor: Colors.surface,
    borderWidth: 1, borderColor: Colors.surfaceBorder,
  },
  chipActive: { backgroundColor: Colors.primaryDim, borderColor: Colors.primary },
  chipText: { fontSize: Typography.size.xs, color: Colors.textSecondary },
  chipTextActive: { color: Colors.primary, fontWeight: Typography.weight.semibold },
  input: {
    backgroundColor: Colors.surface, borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.surfaceBorder,
    padding: Spacing.md, fontSize: Typography.size.sm, color: Colors.textPrimary,
  },
  confirmBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: Spacing.sm, backgroundColor: Colors.success, borderRadius: Radius.md,
    paddingVertical: Spacing.base,
  },
  confirmBtnText: { fontSize: Typography.size.base, fontWeight: Typography.weight.bold, color: Colors.background },
});

// ── Main Screen ───────────────────────────────────────────────────────────────

export default function DispatchScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { tenant, activeNicheId } = useApp();
  const specialistIds = NICHES[activeNicheId]?.specialists ?? [];
  const { showAlert } = useAlert();

  const [orders, setOrders] = useState<OrderWithItem[]>([]);
  const [shippingServices, setShippingServices] = useState<ShippingService[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [dispatchOrder, setDispatchOrder] = useState<OrderWithItem | null>(null);
  const [advancingId, setAdvancingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!tenant) return;
    const [ordersResult, servicesResult] = await Promise.all([
      getOrdersToDispatch(tenant.id, specialistIds),
      getShippingServices(tenant.id),
    ]);
    setOrders(ordersResult.orders);
    setShippingServices(servicesResult.services);
    setLoading(false);
    setRefreshing(false);
  }, [tenant?.id, activeNicheId]);

  useEffect(() => { load(); }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
  }, [load]);

  // ── Step advance logic ────────────────────────────────────────────────────

  const handleAdvance = useCallback((order: OrderWithItem) => {
    const currentStep = order.fulfilmentStatus as DispatchStep;
    const currentIdx = STEP_FLOW.indexOf(currentStep);
    const nextStep = STEP_FLOW[currentIdx + 1] as DispatchStep | undefined;
    if (!nextStep) return;

    // If advancing to dispatched, show the dispatch confirm modal
    if (nextStep === 'dispatched') {
      setDispatchOrder(order);
      return;
    }

    const config = STEP_CONFIG[currentStep];
    showAlert(
      config.action,
      `Move "${(order.itemTitle ?? 'this order').slice(0, 50)}" to ${FULFILMENT_LABELS[nextStep as FulfilmentStatus]}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm',
          onPress: async () => {
            setAdvancingId(order.id);
            const extra = nextStep === 'packing'
              ? { packedAt: new Date().toISOString() }
              : undefined;
            const { error } = await updateOrderFulfilmentStatus(order.id, nextStep as FulfilmentStatus, extra);
            setAdvancingId(null);
            if (error) {
              showAlert('Error', error);
            } else {
              setOrders(prev => prev.map(o =>
                o.id === order.id
                  ? { ...o, fulfilmentStatus: nextStep as FulfilmentStatus }
                  : o
              ));
            }
          },
        },
      ]
    );
  }, [showAlert]);

  // ── Confirm dispatch ────────────────────────────────────────────────────

  const handleConfirmDispatch = useCallback(async (
    tracking: string,
    carrier: string,
    dispatchPhotoUri: string | null,
  ) => {
    if (!dispatchOrder || !tenant) return;

    // Upload dispatch proof photo FIRST (before calling eBay)
    let dispatchPhotoUrl: string | null = null;
    if (dispatchPhotoUri) {
      dispatchPhotoUrl = await uploadDispatchPhoto(dispatchOrder.id, dispatchPhotoUri);
    }

    // Call eBay Fulfillment API via edge function — REAL eBay update
    // This is the critical step: SWISH only marks as dispatched if eBay confirms
    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase.functions.invoke('swish-ebay-post-order', {
        body: {
          route: 'dispatch',
          tenantId: tenant.id,
          orderId: dispatchOrder.id,
          carrier: carrier || 'Royal Mail',
          trackingNumber: tracking || '',
          ...(dispatchPhotoUrl ? { dispatchPhotoUrl } : {}),
        },
      });

      // Handle edge function errors
      if (error) {
        let errMsg = error.message;
        if (error instanceof FunctionsHttpError) {
          try {
            const t = await error.context?.text();
            const p = t ? JSON.parse(t) : null;
            errMsg = p?.error ?? t ?? errMsg;
          } catch {}
        }
        showAlert('Dispatch Failed', errMsg);
        return;
      }

      if (!data?.success) {
        // eBay rejected — show error and do NOT mark as dispatched
        const errMsg = data?.error ?? 'eBay did not confirm the dispatch.';
        const hint = data?.hint ?? '';
        showAlert(
          'eBay Dispatch Failed',
          hint ? `${errMsg}\n\n${hint}` : errMsg,
          [
            { text: 'OK', style: 'cancel' },
            ...(data?.localOnly ? [] : []),
          ],
        );
        return;
      }

      // eBay confirmed OR local-only update (no eBay order ID)
      setOrders(prev => prev.filter(o => o.id !== dispatchOrder.id));
      setDispatchOrder(null);

      const alertParts = [
        data?.ebayFulfillmentSubmitted
          ? `Tracking submitted to eBay.`
          : data?.localOnly
          ? `Updated locally (no eBay order ID found).`
          : null,
        tracking ? `Tracking: ${tracking}` : null,
        dispatchPhotoUrl ? 'Dispatch photo saved.' : null,
      ].filter(Boolean);

      showAlert('Dispatched', alertParts.join(' · ') || 'Marked as dispatched.');
    } catch (e: any) {
      showAlert('Error', `Dispatch failed: ${e.message}`);
    }
  }, [dispatchOrder, tenant, showAlert]);

  // ── Stats ─────────────────────────────────────────────────────────────────

  const stats = useMemo(() => ({
    awaiting: orders.filter(o => o.fulfilmentStatus === 'awaiting_dispatch').length,
    packing: orders.filter(o => o.fulfilmentStatus === 'packing').length,
    labelReady: orders.filter(o => o.fulfilmentStatus === 'label_created').length,
  }), [orders]);

  return (
    <View style={s.container}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={[s.header, { paddingTop: insets.top + Spacing.base }]}>
        <Pressable onPress={() => router.back()} style={s.backBtn} hitSlop={8}>
          <MaterialIcons name="arrow-back" size={20} color={Colors.textSecondary} />
        </Pressable>
        <View style={s.headerText}>
          <Text style={s.title}>Dispatch Queue</Text>
          <Text style={s.subtitle}>
            {orders.length} order{orders.length !== 1 ? 's' : ''} to process
          </Text>
        </View>
        <Pressable
          onPress={() => router.push('/orders' as any)}
          style={s.allOrdersBtn}
          hitSlop={4}
        >
          <MaterialIcons name="list" size={14} color={Colors.info} />
          <Text style={s.allOrdersText}>All Orders</Text>
        </Pressable>
      </View>

      {/* Stats strip */}
      {orders.length > 0 ? (
        <View style={s.statsStrip}>
          {[
            { label: 'To Pick', value: stats.awaiting, color: Colors.warning, icon: 'inbox' },
            { label: 'Packing', value: stats.packing, color: Colors.info, icon: 'inventory-2' },
            { label: 'Label Ready', value: stats.labelReady, color: Colors.primary, icon: 'label' },
          ].map(stat => (
            <View key={stat.label} style={s.statItem}>
              <MaterialIcons name={stat.icon as any} size={16} color={stat.color} />
              <Text style={[s.statValue, { color: stat.color }]}>{stat.value}</Text>
              <Text style={s.statLabel}>{stat.label}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {loading ? (
        <View style={s.loading}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : (
        <FlatList
          data={orders}
          keyExtractor={o => o.id}
          contentContainerStyle={[s.list, { paddingBottom: insets.bottom + 110 }]}
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => <View style={{ height: Spacing.xl }} />}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />
          }
          renderItem={({ item }) => (
            <DispatchCard
              order={item}
              onAdvance={handleAdvance}
              onViewItem={id => router.push(`/stock-listing/${id}` as any)}
            />
          )}
          ListEmptyComponent={
            <View style={s.empty}>
              <View style={s.emptyIconWrap}>
                <MaterialIcons name="check-circle" size={52} color={Colors.success} />
              </View>
              <Text style={s.emptyTitle}>All Clear</Text>
              <Text style={s.emptyText}>
                No orders awaiting dispatch. When items sell on eBay or Vinted, they will appear here for picking.
              </Text>
              <Pressable
                onPress={() => router.push('/orders' as any)}
                style={({ pressed }) => [s.viewAllBtn, pressed && { opacity: 0.85 }]}
              >
                <MaterialIcons name="list" size={16} color={Colors.background} />
                <Text style={s.viewAllBtnText}>View All Orders</Text>
              </Pressable>
            </View>
          }
        />
      )}

      <DispatchConfirmModal
        order={dispatchOrder}
        visible={dispatchOrder !== null}
        shippingServices={shippingServices}
        onClose={() => setDispatchOrder(null)}
        onConfirm={handleConfirmDispatch}
      />
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },

  header: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingHorizontal: Spacing.base, paddingBottom: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: Radius.md,
    backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.surfaceBorder,
  },
  headerText: { flex: 1 },
  title: { fontSize: Typography.size.xl, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  subtitle: { fontSize: Typography.size.xs, color: Colors.textTertiary, marginTop: 2 },
  allOrdersBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.infoDim, borderRadius: Radius.md,
    paddingHorizontal: Spacing.md, paddingVertical: 7,
    borderWidth: 1, borderColor: Colors.info + '40',
  },
  allOrdersText: { fontSize: Typography.size.xs, fontWeight: Typography.weight.semibold, color: Colors.info },

  statsStrip: {
    flexDirection: 'row', justifyContent: 'space-around',
    paddingVertical: Spacing.md, paddingHorizontal: Spacing.base,
    borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder,
    backgroundColor: Colors.surface,
  },
  statItem: { alignItems: 'center', gap: 3 },
  statValue: { fontSize: Typography.size.lg, fontWeight: Typography.weight.extrabold },
  statLabel: { fontSize: Typography.size.xs - 1, color: Colors.textTertiary },

  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  list: {
    padding: Spacing.base,
    paddingTop: Spacing.md,
  },

  empty: {
    alignItems: 'center', gap: Spacing.md,
    paddingVertical: 60, paddingHorizontal: Spacing.xl,
  },
  emptyIconWrap: {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: Colors.successDim, alignItems: 'center', justifyContent: 'center',
  },
  emptyTitle: { fontSize: Typography.size.xl, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  emptyText: {
    fontSize: Typography.size.sm, color: Colors.textTertiary,
    textAlign: 'center', lineHeight: 20,
  },
  viewAllBtn: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.xs,
    backgroundColor: Colors.primary, borderRadius: Radius.pill,
    paddingHorizontal: Spacing.xl, paddingVertical: Spacing.md,
    marginTop: Spacing.sm,
  },
  viewAllBtnText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.background },
});
