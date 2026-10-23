// SWISH — Orders & Fulfilment Screen
//
// Real data from the `orders` table via coinInventoryService.
// Features:
//   - Search bar: buyer name or eBay order ID
//   - Fulfilment status chips: awaiting dispatch / packed / dispatched / delivered
//   - Dispatch action: updates fulfilment_status + records dispatch_photo_url
//   - Import eBay orders via swish-ebay-orders edge function

import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  View, Text, StyleSheet, FlatList, Pressable, Modal,
  TextInput, ScrollView, ActivityIndicator, RefreshControl,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Colors, Typography, Spacing, Radius, Shadow } from '@/constants/theme';
import { useApp } from '@/hooks/useApp';
import { getProductionNicheSpecialistIds } from '@/services/nicheRouting';
import { useAlert } from '@/template';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { getSupabaseClient } from '@/template';
import {
  OrderWithItem, FulfilmentStatus, FULFILMENT_LABELS,
  getAllOrders, updateOrderFulfilmentStatus,
} from '@/services/coinInventoryService';

// ── Constants ─────────────────────────────────────────────────────────────────

// The 4 core fulfilment statuses requested (+ all + completed)
type FilterTab = 'all' | 'awaiting_dispatch' | 'packed' | 'dispatched' | 'delivered' | 'completed' | 'returned';

const FILTER_TABS: Array<{ id: FilterTab; label: string; icon: string; color: string }> = [
  { id: 'all',               label: 'All',             icon: 'list',           color: Colors.textSecondary },
  { id: 'awaiting_dispatch', label: 'To Dispatch',     icon: 'inbox',          color: Colors.warning },
  { id: 'packed',            label: 'Packed',          icon: 'inventory-2',    color: Colors.info },
  { id: 'dispatched',        label: 'Dispatched',      icon: 'local-shipping', color: Colors.primary },
  { id: 'delivered',         label: 'Delivered',       icon: 'check-circle',   color: Colors.success },
  { id: 'completed',         label: 'Completed',       icon: 'done-all',       color: Colors.accent },
  { id: 'returned',          label: 'Returned',        icon: 'assignment-return', color: Colors.danger },
];

// Map filter tab IDs → actual DB fulfilment_status values
function tabToDbStatus(tab: FilterTab): FulfilmentStatus | null {
  if (tab === 'all') return null;
  // 'packed' in UI maps to 'packing' or 'label_created' in DB; we filter in JS
  return tab as FulfilmentStatus;
}

const STATUS_COLOR: Record<string, string> = {
  awaiting_dispatch: Colors.warning,
  packing:           Colors.info,
  label_created:     Colors.primary,
  dispatched:        Colors.primary,
  delivered:         Colors.success,
  completed:         Colors.accent,
  returned:          Colors.danger,
};

const DISPLAY_LABEL: Record<string, string> = {
  awaiting_dispatch: 'Awaiting Dispatch',
  packing:           'Packing',
  label_created:     'Label Created',
  dispatched:        'Dispatched',
  delivered:         'Delivered',
  completed:         'Completed',
  returned:          'Returned',
};

// Next status transition
const NEXT_STATUS: Partial<Record<string, FulfilmentStatus>> = {
  awaiting_dispatch: 'packing',
  packing:           'label_created',
  label_created:     'dispatched',
  dispatched:        'delivered',
  delivered:         'completed',
};

function fmt(v: number) {
  return `£${v.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ── Order Card ─────────────────────────────────────────────────────────────────

function OrderCard({
  order,
  onDispatch,
  onAdvance,
  onViewItem,
}: {
  order: OrderWithItem;
  onDispatch: (order: OrderWithItem) => void;
  onAdvance: (order: OrderWithItem) => void;
  onViewItem: (order: OrderWithItem) => void;
}) {
  const statusColor = STATUS_COLOR[order.fulfilmentStatus] ?? Colors.textTertiary;
  const statusLabel = DISPLAY_LABEL[order.fulfilmentStatus] ?? order.fulfilmentStatus;
  const isDispatchable = order.fulfilmentStatus === 'awaiting_dispatch' || order.fulfilmentStatus === 'label_created';
  const nextStatus = NEXT_STATUS[order.fulfilmentStatus];
  const hasPhoto = (order.itemMedia ?? []).length > 0;
  const primaryPhoto = (order.itemMedia ?? []).find(u => u.startsWith('https://')) ?? (order.itemMedia ?? [])[0];

  return (
    <View style={oc.wrap}>
      <View style={[oc.stripe, { backgroundColor: statusColor }]} />

      <View style={oc.body}>
        {/* Header */}
        <View style={oc.headerRow}>
          {/* Photo */}
          {primaryPhoto ? (
            <Image source={{ uri: primaryPhoto }} style={oc.photo} contentFit="cover" transition={150} />
          ) : (
            <View style={oc.photoPlaceholder}>
              <MaterialIcons name="receipt-long" size={20} color={Colors.textTertiary} />
            </View>
          )}

          <View style={oc.headerInfo}>
            {/* Status chip + marketplace */}
            <View style={oc.chipRow}>
              <View style={[oc.statusChip, { backgroundColor: statusColor + '18', borderColor: statusColor + '50' }]}>
                <View style={[oc.statusDot, { backgroundColor: statusColor }]} />
                <Text style={[oc.statusChipText, { color: statusColor }]}>{statusLabel}</Text>
              </View>
              <View style={oc.mktChip}>
                <Text style={oc.mktChipText}>{order.marketplaceId.toUpperCase()}</Text>
              </View>
            </View>

            {/* Item title */}
            <Text style={oc.itemTitle} numberOfLines={2}>
              {order.itemTitle ?? 'Order'}
            </Text>

            {/* eBay order ID */}
            {order.externalOrderId ? (
              <Text style={oc.orderId} numberOfLines={1}>
                eBay #{order.externalOrderId}
              </Text>
            ) : null}
          </View>
        </View>

        {/* Buyer info */}
        {order.buyerName ? (
          <View style={oc.buyerRow}>
            <MaterialIcons name="person-outline" size={12} color={Colors.textTertiary} />
            <Text style={oc.buyerName} numberOfLines={1}>{order.buyerName}</Text>
            {order.buyerAddress?.city ? (
              <Text style={oc.buyerCity}>· {order.buyerAddress.city}</Text>
            ) : null}
          </View>
        ) : null}

        {/* Physical location for picking */}
        {(order.folderNumber || order.storageLocation || order.inventoryId) ? (
          <View style={oc.locationRow}>
            <MaterialIcons name="location-on" size={11} color={Colors.primary} />
            <Text style={oc.locationText} numberOfLines={1}>
              {[
                order.inventoryId,
                order.folderNumber ? `Folder ${order.folderNumber}` : null,
                order.pocketPosition ? `Pocket ${order.pocketPosition}` : null,
                order.storageLocation,
              ].filter(Boolean).join(' · ')}
            </Text>
          </View>
        ) : null}

        {/* Financials */}
        <View style={oc.financials}>
          {[
            { label: 'Sale',    value: fmt(order.salePrice),      color: Colors.textPrimary },
            { label: 'Fees',    value: `-${fmt(order.marketplaceFee)}`, color: Colors.danger },
            { label: 'Ship',    value: `-${fmt(order.shippingCost)}`,   color: Colors.warning },
            { label: 'Net',     value: fmt(order.netRevenue),     color: Colors.success },
          ].map(f => (
            <View key={f.label} style={oc.finItem}>
              <Text style={oc.finLabel}>{f.label}</Text>
              <Text style={[oc.finValue, { color: f.color }]}>{f.value}</Text>
            </View>
          ))}
        </View>

        {/* Tracking / dispatch photo */}
        {order.trackingNumber ? (
          <View style={oc.trackingRow}>
            <MaterialIcons name="local-shipping" size={11} color={Colors.info} />
            <Text style={oc.trackingText} numberOfLines={1}>
              {order.carrier ? `${order.carrier}: ` : ''}{order.trackingNumber}
            </Text>
          </View>
        ) : null}
        {order.dispatchPhotoUrl ? (
          <View style={oc.photoUrlRow}>
            <MaterialIcons name="photo-camera" size={11} color={Colors.success} />
            <Text style={oc.photoUrlText} numberOfLines={1}>{order.dispatchPhotoUrl}</Text>
          </View>
        ) : null}

        {/* Date */}
        <Text style={oc.dateText}>
          {new Date(order.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
        </Text>

        {/* Actions */}
        <View style={oc.actions}>
          <Pressable onPress={() => onViewItem(order)} style={oc.actionBtn} hitSlop={4}>
            <MaterialIcons name="open-in-new" size={11} color={Colors.textTertiary} />
            <Text style={oc.actionBtnText}>Item</Text>
          </Pressable>

          {isDispatchable ? (
            <Pressable
              onPress={() => onDispatch(order)}
              style={[oc.actionBtn, oc.actionBtnPrimary]}
              hitSlop={4}
            >
              <MaterialIcons name="local-shipping" size={11} color={Colors.background} />
              <Text style={[oc.actionBtnText, { color: Colors.background }]}>Mark Dispatched</Text>
            </Pressable>
          ) : nextStatus ? (
            <Pressable
              onPress={() => onAdvance(order)}
              style={[oc.actionBtn, { backgroundColor: statusColor + '18', borderColor: statusColor + '40' }]}
              hitSlop={4}
            >
              <MaterialIcons name="arrow-forward" size={11} color={statusColor} />
              <Text style={[oc.actionBtnText, { color: statusColor }]}>
                → {DISPLAY_LABEL[nextStatus] ?? nextStatus}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const oc = StyleSheet.create({
  wrap: {
    flexDirection: 'row', backgroundColor: Colors.surface,
    borderRadius: Radius.xl, overflow: 'hidden',
    borderWidth: 1, borderColor: Colors.surfaceBorder, ...Shadow.sm,
  },
  stripe: { width: 4, flexShrink: 0 },
  body: { flex: 1, padding: Spacing.md, gap: Spacing.sm },

  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  photo: { width: 60, height: 60, borderRadius: Radius.md, flexShrink: 0 },
  photoPlaceholder: {
    width: 60, height: 60, borderRadius: Radius.md, flexShrink: 0,
    backgroundColor: Colors.surfaceHighlight, alignItems: 'center', justifyContent: 'center',
  },
  headerInfo: { flex: 1, gap: 4 },

  chipRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  statusChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 7, paddingVertical: 3,
    borderRadius: Radius.pill, borderWidth: 1,
  },
  statusDot: { width: 5, height: 5, borderRadius: 3 },
  statusChipText: { fontSize: 9, fontWeight: Typography.weight.bold },
  mktChip: {
    backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.pill,
    paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1, borderColor: Colors.surfaceBorder,
  },
  mktChipText: { fontSize: 9, color: Colors.textTertiary, fontWeight: Typography.weight.semibold },

  itemTitle: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.textPrimary, lineHeight: 17 },
  orderId: { fontSize: 9, color: Colors.textTertiary, fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' },

  buyerRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  buyerName: { fontSize: Typography.size.xs, color: Colors.textSecondary, fontWeight: Typography.weight.medium, flex: 1 },
  buyerCity: { fontSize: Typography.size.xs, color: Colors.textTertiary },

  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  locationText: { flex: 1, fontSize: Typography.size.xs, color: Colors.primary },

  financials: {
    flexDirection: 'row', backgroundColor: Colors.surfaceHighlight,
    borderRadius: Radius.md, paddingVertical: Spacing.xs, paddingHorizontal: Spacing.sm,
  },
  finItem: { flex: 1, alignItems: 'center', gap: 2 },
  finLabel: { fontSize: 8, color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.3 },
  finValue: { fontSize: Typography.size.xs, fontWeight: Typography.weight.bold },

  trackingRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  trackingText: { flex: 1, fontSize: Typography.size.xs, color: Colors.info },
  photoUrlRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  photoUrlText: { flex: 1, fontSize: Typography.size.xs, color: Colors.success },

  dateText: { fontSize: 10, color: Colors.textTertiary },

  actions: { flexDirection: 'row', gap: Spacing.xs, flexWrap: 'wrap' },
  actionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: Spacing.sm, paddingVertical: 5,
    borderRadius: Radius.sm, backgroundColor: Colors.surfaceHighlight,
    borderWidth: 1, borderColor: Colors.surfaceBorder,
  },
  actionBtnText: { fontSize: 10, fontWeight: Typography.weight.semibold, color: Colors.textSecondary },
  actionBtnPrimary: { backgroundColor: Colors.primary, borderColor: Colors.primary },
});

// ── Dispatch Modal ─────────────────────────────────────────────────────────────
// Updates fulfilment_status → dispatched and records dispatch_photo_url + tracking

function DispatchModal({
  order,
  visible,
  onClose,
  onConfirm,
}: {
  order: OrderWithItem | null;
  visible: boolean;
  onClose: () => void;
  onConfirm: (opts: { tracking: string; carrier: string; photoUrl: string }) => Promise<void>;
}) {
  const insets = useSafeAreaInsets();
  const [tracking, setTracking] = useState('');
  const [carrier, setCarrier] = useState('Royal Mail');
  const [photoUrl, setPhotoUrl] = useState('');
  const [saving, setSaving] = useState(false);

  const CARRIERS = ['Royal Mail', 'Evri', 'DPD', 'Parcelforce', 'DHL', 'UPS', 'Other'];

  const handleConfirm = async () => {
    setSaving(true);
    await onConfirm({ tracking: tracking.trim(), carrier, photoUrl: photoUrl.trim() });
    setSaving(false);
    setTracking('');
    setPhotoUrl('');
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={dm.overlay}>
          <View style={[dm.card, { paddingBottom: insets.bottom + Spacing.lg }]}>

            {/* Header */}
            <View style={dm.header}>
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={dm.title}>Mark as Dispatched</Text>
                {order?.itemTitle ? (
                  <Text style={dm.subtitle} numberOfLines={1}>{order.itemTitle}</Text>
                ) : null}
              </View>
              <Pressable onPress={onClose} hitSlop={8}>
                <MaterialIcons name="close" size={22} color={Colors.textSecondary} />
              </Pressable>
            </View>

            {/* Pick location */}
            {order && (order.folderNumber || order.storageLocation || order.inventoryId) ? (
              <View style={dm.pickCard}>
                <MaterialIcons name="location-on" size={14} color={Colors.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={dm.pickLabel}>Pick from</Text>
                  <Text style={dm.pickValue}>
                    {[
                      order.inventoryId,
                      order.folderNumber ? `Folder ${order.folderNumber}` : null,
                      order.pocketPosition ? `Pocket ${order.pocketPosition}` : null,
                      order.storageLocation,
                    ].filter(Boolean).join(' · ')}
                  </Text>
                </View>
              </View>
            ) : null}

            {/* Buyer */}
            {order?.buyerName ? (
              <View style={dm.buyerRow}>
                <MaterialIcons name="person" size={13} color={Colors.textTertiary} />
                <Text style={dm.buyerName}>{order.buyerName}</Text>
                {order.buyerAddress?.city ? <Text style={dm.buyerCity}>· {order.buyerAddress.city}</Text> : null}
              </View>
            ) : null}

            {/* Carrier */}
            <View style={dm.field}>
              <Text style={dm.fieldLabel}>Carrier</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={dm.carrierRow}
              >
                {CARRIERS.map(c => (
                  <Pressable
                    key={c}
                    onPress={() => setCarrier(c)}
                    style={[dm.carrierChip, carrier === c && dm.carrierChipActive]}
                  >
                    <Text style={[dm.carrierText, carrier === c && { color: Colors.primary, fontWeight: Typography.weight.bold }]}>
                      {c}
                    </Text>
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
                autoCorrect={false}
              />
            </View>

            {/* Dispatch photo URL */}
            <View style={dm.field}>
              <Text style={dm.fieldLabel}>
                Dispatch Photo URL <Text style={dm.optional}>(optional)</Text>
              </Text>
              <TextInput
                style={dm.input}
                value={photoUrl}
                onChangeText={setPhotoUrl}
                placeholder="https://cdn.example.com/dispatch-photo.jpg"
                placeholderTextColor={Colors.textTertiary}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
              />
              <Text style={dm.fieldHint}>
                Paste a URL to a photo of the packed/dispatched order for your records.
              </Text>
            </View>

            {/* Confirm */}
            <Pressable
              onPress={handleConfirm}
              disabled={saving}
              style={({ pressed }) => [dm.confirmBtn, pressed && { opacity: 0.85 }, saving && { opacity: 0.7 }]}
            >
              {saving
                ? <ActivityIndicator size="small" color={Colors.background} style={{ width: 16, height: 16 }} />
                : <MaterialIcons name="local-shipping" size={16} color={Colors.background} />}
              <Text style={dm.confirmBtnText}>{saving ? 'Saving...' : 'Confirm Dispatch'}</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const dm = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  card: {
    backgroundColor: Colors.surface, borderTopLeftRadius: Radius.xxl, borderTopRightRadius: Radius.xxl,
    padding: Spacing.xl, gap: Spacing.lg,
    borderTopWidth: 1, borderColor: Colors.surfaceBorder,
  },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: Spacing.md },
  title: { fontSize: Typography.size.xl, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  subtitle: { fontSize: Typography.size.xs, color: Colors.textTertiary },

  pickCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm,
    backgroundColor: Colors.primaryDim, borderRadius: Radius.md, padding: Spacing.md,
    borderWidth: 1, borderColor: Colors.primary + '30',
  },
  pickLabel: { fontSize: 9, fontWeight: Typography.weight.bold, color: Colors.primary, textTransform: 'uppercase', letterSpacing: 0.4 },
  pickValue: { fontSize: Typography.size.sm, color: Colors.primary, fontWeight: Typography.weight.semibold, marginTop: 2 },

  buyerRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  buyerName: { fontSize: Typography.size.sm, color: Colors.textPrimary, fontWeight: Typography.weight.medium },
  buyerCity: { fontSize: Typography.size.sm, color: Colors.textTertiary },

  field: { gap: 6 },
  fieldLabel: { fontSize: 10, fontWeight: Typography.weight.bold, color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5 },
  optional: { fontWeight: '400', textTransform: 'lowercase', color: Colors.textTertiary },
  fieldHint: { fontSize: 10, color: Colors.textTertiary, lineHeight: 14 },

  carrierRow: { flexDirection: 'row', gap: Spacing.xs, paddingVertical: 2 },
  carrierChip: {
    paddingHorizontal: Spacing.md, paddingVertical: 7,
    borderRadius: Radius.pill, backgroundColor: Colors.surfaceHighlight,
    borderWidth: 1, borderColor: Colors.surfaceBorder,
  },
  carrierChipActive: { backgroundColor: Colors.primaryDim, borderColor: Colors.primary },
  carrierText: { fontSize: Typography.size.xs, color: Colors.textSecondary },

  input: {
    backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.surfaceBorder,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    fontSize: Typography.size.sm, color: Colors.textPrimary,
    includeFontPadding: false,
  },

  confirmBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm,
    backgroundColor: Colors.primary, borderRadius: Radius.md, paddingVertical: Spacing.base, ...Shadow.glow,
  },
  confirmBtnText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.background },
});

// ── Main Screen ────────────────────────────────────────────────────────────────

export default function OrdersScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { tenant, activeNicheId } = useApp();
  const specialistIds = getProductionNicheSpecialistIds(activeNicheId);
  const { showAlert } = useAlert();

  const [orders, setOrders] = useState<OrderWithItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [activeFilter, setActiveFilter] = useState<FilterTab>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [importingOrders, setImportingOrders] = useState(false);
  const [dispatchOrder, setDispatchOrder] = useState<OrderWithItem | null>(null);
  const [showDispatch, setShowDispatch] = useState(false);
  const searchRef = useRef<TextInput>(null);

  // ── Load ─────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    if (!tenant) {
      setOrders([]);
      setLoadError('Your SWISH workspace is not ready. Return to the dashboard and try again.');
      setLoading(false);
      setRefreshing(false);
      return;
    }
    setLoadError(null);
    try {
      const { orders: data, error } = await getAllOrders(tenant.id, undefined, specialistIds);
      if (error) {
        setLoadError(error);
        return;
      }
      setOrders(data);
    } catch (error: unknown) {
      setLoadError(error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [tenant?.id, activeNicheId, showAlert]);

  useEffect(() => { load(); }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
  }, [load]);

  // ── Filter + search ───────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    let result = orders;

    // Status filter
    if (activeFilter !== 'all') {
      if (activeFilter === 'packed') {
        // 'packed' tab covers both packing and label_created DB statuses
        result = result.filter(o => o.fulfilmentStatus === 'packing' || o.fulfilmentStatus === 'label_created');
      } else {
        result = result.filter(o => o.fulfilmentStatus === activeFilter);
      }
    }

    // Search filter: buyer name OR eBay order ID
    const q = searchQuery.trim().toLowerCase();
    if (q.length > 0) {
      result = result.filter(o =>
        (o.buyerName ?? '').toLowerCase().includes(q) ||
        (o.externalOrderId ?? '').toLowerCase().includes(q) ||
        (o.itemTitle ?? '').toLowerCase().includes(q)
      );
    }

    return result;
  }, [orders, activeFilter, searchQuery]);

  // ── Tab counts ─────────────────────────────────────────────────────────────

  const tabCounts = useMemo(() => {
    const c: Record<string, number> = { all: orders.length };
    for (const o of orders) {
      c[o.fulfilmentStatus] = (c[o.fulfilmentStatus] ?? 0) + 1;
      // 'packed' tab = packing + label_created
      if (o.fulfilmentStatus === 'packing' || o.fulfilmentStatus === 'label_created') {
        c['packed'] = (c['packed'] ?? 0) + 1;
      }
    }
    return c;
  }, [orders]);

  // ── Stats bar ──────────────────────────────────────────────────────────────

  const stats = useMemo(() => ({
    toDispatch: orders.filter(o => o.fulfilmentStatus === 'awaiting_dispatch').length,
    dispatched: orders.filter(o => o.fulfilmentStatus === 'dispatched').length,
    completed:  orders.filter(o => o.fulfilmentStatus === 'completed').length,
    netRevenue: orders.reduce((s, o) => s + o.netRevenue, 0),
  }), [orders]);

  // ── Import eBay orders ─────────────────────────────────────────────────────

  const handleImportOrders = useCallback(async () => {
    if (!tenant) return;
    setImportingOrders(true);
    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase.functions.invoke('swish-ebay-orders', {
        body: { tenantId: tenant.id, daysBack: 90 },
      });
      if (error) {
        let msg = error.message;
        if (error instanceof FunctionsHttpError) {
          try {
            const t = await error.context?.text();
            const p = t ? JSON.parse(t) : null;
            msg = p?.error ?? t ?? msg;
          } catch {}
        }
        showAlert('Import Failed', msg);
        return;
      }
      const { imported = 0, matched = 0, markedSold = 0, skipped = 0, total = 0 } = data ?? {};
      const lines = [`Processed ${total} eBay order${total === 1 ? '' : 's'}:`];
      if (imported > 0) lines.push(`• ${imported} new order${imported === 1 ? '' : 's'} imported`);
      if (markedSold > 0) lines.push(`• ${markedSold} item${markedSold === 1 ? '' : 's'} marked as sold`);
      if (skipped > 0) lines.push(`• ${skipped} already imported`);
      if (imported === 0 && total > 0) lines.push('• No new orders to import');
      showAlert('Sync Complete', lines.join('\n'));
      // The sync also refreshes existing order statuses/tracking, so always reload.
      await load();
    } finally {
      setImportingOrders(false);
    }
  }, [tenant, showAlert, load]);

  // ── Advance status ─────────────────────────────────────────────────────────

  const handleAdvance = useCallback((order: OrderWithItem) => {
    const next = NEXT_STATUS[order.fulfilmentStatus];
    if (!next) return;
    showAlert(
      'Advance Status',
      `Move to "${DISPLAY_LABEL[next] ?? next}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm',
          onPress: async () => {
            const { error } = await updateOrderFulfilmentStatus(order.id, next);
            if (error) { showAlert('Error', error); return; }
            setOrders(prev => prev.map(o =>
              o.id === order.id ? { ...o, fulfilmentStatus: next } : o
            ));
          },
        },
      ]
    );
  }, [showAlert]);

  // ── Dispatch ───────────────────────────────────────────────────────────────

  const handleDispatch = useCallback((order: OrderWithItem) => {
    setDispatchOrder(order);
    setShowDispatch(true);
  }, []);

  const handleConfirmDispatch = useCallback(async ({
    tracking,
    carrier,
    photoUrl,
  }: {
    tracking: string;
    carrier: string;
    photoUrl: string;
  }) => {
    if (!dispatchOrder || !tenant) return;

    // Call eBay Fulfillment API via edge function — REAL eBay update
    // SWISH only marks dispatched if eBay confirms
    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase.functions.invoke('swish-ebay-post-order', {
        body: {
          route: 'dispatch',
          tenantId: tenant.id,
          orderId: dispatchOrder.id,
          carrier: carrier || 'Royal Mail',
          trackingNumber: tracking || '',
          ...(photoUrl ? { dispatchPhotoUrl: photoUrl } : {}),
        },
      });

      if (error) {
        let errMsg = error.message;
        if (error instanceof FunctionsHttpError) {
          try { const t = await error.context?.text(); const p = t ? JSON.parse(t) : null; errMsg = p?.error ?? t ?? errMsg; } catch {}
        }
        showAlert('Dispatch Failed', errMsg);
        return;
      }

      if (!data?.success) {
        const errMsg = data?.error ?? 'eBay did not confirm the dispatch.';
        const hint = data?.hint ?? '';
        showAlert('eBay Dispatch Failed', hint ? `${errMsg}\n\n${hint}` : errMsg);
        return;
      }

      // Update local state
      setOrders(prev => prev.map(o =>
        o.id === dispatchOrder!.id
          ? {
              ...o,
              fulfilmentStatus: 'dispatched' as FulfilmentStatus,
              trackingNumber: tracking || o.trackingNumber,
              carrier: carrier || o.carrier,
              dispatchPhotoUrl: photoUrl || o.dispatchPhotoUrl,
            }
          : o,
      ));

      const alertParts = [
        data?.ebayFulfillmentSubmitted ? 'Tracking submitted to eBay.' : data?.localOnly ? 'Updated locally.' : null,
        tracking ? `Tracking: ${tracking}` : null,
        carrier ? `Carrier: ${carrier}` : null,
      ].filter(Boolean);
      showAlert('Dispatched', alertParts.join('\n') || 'Order marked as dispatched.');
      setDispatchOrder(null);
    } catch (e: any) {
      showAlert('Error', `Dispatch failed: ${e.message}`);
    }
  }, [dispatchOrder, tenant, showAlert]);

  // ── View item ──────────────────────────────────────────────────────────────

  const handleViewItem = useCallback((order: OrderWithItem) => {
    if (order.itemId) router.push(`/stock-listing/${order.itemId}` as any);
    else showAlert('No Item', 'No inventory item linked to this order.');
  }, [router, showAlert]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <View style={s.container}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={[s.header, { paddingTop: insets.top + Spacing.sm }]}>
        <Pressable onPress={() => router.back()} style={s.backBtn} hitSlop={8}>
          <MaterialIcons name="arrow-back" size={20} color={Colors.textSecondary} />
        </Pressable>
        <View style={s.flex}>
          <Text style={s.title}>Orders</Text>
          <Text style={s.subtitle}>{orders.length} orders · {fmt(stats.netRevenue)} net</Text>
          {loadError ? <Text style={{ color: Colors.danger, fontSize: 10 }} numberOfLines={2}>Orders error: {loadError}</Text> : null}
        </View>
        <Pressable
          onPress={handleImportOrders}
          disabled={importingOrders}
          style={s.importBtn}
          hitSlop={4}
        >
          {importingOrders
            ? <ActivityIndicator size="small" color={Colors.accent} style={{ width: 14, height: 14 }} />
            : <MaterialIcons name="storefront" size={14} color={Colors.accent} />}
          <Text style={s.importBtnText}>{importingOrders ? 'Syncing...' : 'Sync eBay'}</Text>
        </Pressable>
      </View>

      {/* Stats strip */}
      <View style={s.statsStrip}>
        {[
          { label: 'To Dispatch', value: stats.toDispatch, color: stats.toDispatch > 0 ? Colors.warning : Colors.textTertiary, icon: 'inbox',          filter: 'awaiting_dispatch' as FilterTab },
          { label: 'Dispatched',  value: stats.dispatched, color: Colors.primary,  icon: 'local-shipping', filter: 'dispatched' as FilterTab },
          { label: 'Completed',   value: stats.completed,  color: Colors.success,  icon: 'done-all',       filter: 'completed' as FilterTab },
          { label: 'Net Revenue', value: fmt(stats.netRevenue), color: Colors.gold, icon: 'payments',      filter: null },
        ].map(stat => (
          <Pressable
            key={stat.label}
            onPress={() => stat.filter ? setActiveFilter(stat.filter) : undefined}
            style={s.statItem}
          >
            <MaterialIcons name={stat.icon as any} size={14} color={stat.color} />
            <Text style={[s.statValue, { color: stat.color }]}>{String(stat.value)}</Text>
            <Text style={s.statLabel}>{stat.label}</Text>
          </Pressable>
        ))}
      </View>

      {/* Search bar */}
      <View style={s.searchRow}>
        <View style={s.searchWrap}>
          <MaterialIcons name="search" size={16} color={Colors.textTertiary} />
          <TextInput
            ref={searchRef}
            style={s.searchInput}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search buyer name or eBay order ID…"
            placeholderTextColor={Colors.textTertiary}
            autoCorrect={false}
            clearButtonMode="while-editing"
            returnKeyType="search"
          />
          {searchQuery.length > 0 ? (
            <Pressable onPress={() => { setSearchQuery(''); searchRef.current?.blur(); }} hitSlop={8}>
              <MaterialIcons name="cancel" size={16} color={Colors.textTertiary} />
            </Pressable>
          ) : null}
        </View>
      </View>

      {/* Filter tabs */}
      <View style={s.tabsOuter}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.tabsContent}>
          {FILTER_TABS.map(tab => {
            const active = activeFilter === tab.id;
            const count = tabCounts[tab.id] ?? 0;
            return (
              <Pressable
                key={tab.id}
                onPress={() => setActiveFilter(tab.id)}
                style={[s.tab, active && { borderColor: tab.color, backgroundColor: tab.color + '15' }]}
              >
                <MaterialIcons name={tab.icon as any} size={12} color={active ? tab.color : Colors.textTertiary} />
                <Text style={[s.tabLabel, active && { color: tab.color, fontWeight: Typography.weight.bold }]}>
                  {tab.label}
                </Text>
                {count > 0 ? (
                  <View style={[s.tabBadge, active && { backgroundColor: tab.color }]}>
                    <Text style={[s.tabBadgeText, active && { color: Colors.background }]}>{count}</Text>
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* List */}
      {loading ? (
        <View style={s.loadingWrap}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={s.loadingText}>Loading orders…</Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={o => o.id}
          contentContainerStyle={[s.list, { paddingBottom: insets.bottom + 100 }]}
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => <View style={{ height: Spacing.md }} />}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />
          }
          renderItem={({ item }) => (
            <OrderCard
              order={item}
              onDispatch={handleDispatch}
              onAdvance={handleAdvance}
              onViewItem={handleViewItem}
            />
          )}
          ListEmptyComponent={
            <View style={s.empty}>
              <MaterialIcons name="receipt-long" size={44} color={Colors.textTertiary} />
              <Text style={s.emptyTitle}>
                {searchQuery
                  ? `No orders matching "${searchQuery}"`
                  : activeFilter === 'all'
                  ? 'No Orders Yet'
                  : `No ${FILTER_TABS.find(t => t.id === activeFilter)?.label ?? activeFilter} orders`}
              </Text>
              <Text style={s.emptyText}>
                {searchQuery
                  ? 'Try a different buyer name or eBay order ID.'
                  : 'Tap "Sync eBay" to import orders from your connected eBay account.'}
              </Text>
              {!searchQuery ? (
                <Pressable onPress={handleImportOrders} disabled={importingOrders} style={s.emptySyncBtn}>
                  {importingOrders
                    ? <ActivityIndicator size="small" color={Colors.background} style={{ width: 14, height: 14 }} />
                    : <MaterialIcons name="storefront" size={14} color={Colors.background} />}
                  <Text style={s.emptySyncBtnText}>{importingOrders ? 'Syncing…' : 'Sync eBay Orders'}</Text>
                </Pressable>
              ) : null}
            </View>
          }
        />
      )}

      {/* Dispatch modal */}
      <DispatchModal
        order={dispatchOrder}
        visible={showDispatch}
        onClose={() => { setShowDispatch(false); setDispatchOrder(null); }}
        onConfirm={handleConfirmDispatch}
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
  backBtn: {
    width: 36, height: 36, borderRadius: Radius.md, backgroundColor: Colors.surface,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.surfaceBorder,
  },
  title: { fontSize: Typography.size.xl, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  subtitle: { fontSize: 10, color: Colors.textTertiary, marginTop: 1 },
  importBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.accentDim, borderRadius: Radius.md,
    paddingHorizontal: Spacing.md, paddingVertical: 7,
    borderWidth: 1, borderColor: Colors.accent + '40',
  },
  importBtnText: { fontSize: Typography.size.xs, fontWeight: Typography.weight.semibold, color: Colors.accent },

  statsStrip: {
    flexDirection: 'row', justifyContent: 'space-around',
    paddingVertical: Spacing.md, paddingHorizontal: Spacing.base,
    borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder,
    backgroundColor: Colors.surface,
  },
  statItem: { alignItems: 'center', gap: 3 },
  statValue: { fontSize: Typography.size.lg, fontWeight: Typography.weight.bold },
  statLabel: { fontSize: 9, color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.3 },

  searchRow: {
    paddingHorizontal: Spacing.base, paddingVertical: Spacing.sm,
    borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder,
    backgroundColor: Colors.surface,
  },
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.surfaceBorder,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs,
  },
  searchInput: {
    flex: 1, fontSize: Typography.size.sm, color: Colors.textPrimary,
    includeFontPadding: false, paddingVertical: 7,
  },

  tabsOuter: { borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder },
  tabsContent: {
    flexDirection: 'row', gap: Spacing.xs,
    paddingHorizontal: Spacing.base, paddingVertical: Spacing.sm,
  },
  tab: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: Spacing.md, paddingVertical: 6,
    borderRadius: Radius.pill, backgroundColor: Colors.surface,
    borderWidth: 1, borderColor: Colors.surfaceBorder,
  },
  tabLabel: { fontSize: Typography.size.xs, color: Colors.textSecondary },
  tabBadge: {
    paddingHorizontal: 5, paddingVertical: 1,
    borderRadius: Radius.pill, backgroundColor: Colors.surfaceHighlight,
    minWidth: 18, alignItems: 'center',
  },
  tabBadgeText: { fontSize: 9, fontWeight: Typography.weight.bold, color: Colors.textTertiary },

  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md },
  loadingText: { fontSize: Typography.size.sm, color: Colors.textTertiary },

  list: { padding: Spacing.base },

  empty: { alignItems: 'center', gap: Spacing.md, paddingVertical: 60, paddingHorizontal: Spacing.xl },
  emptyTitle: { fontSize: Typography.size.lg, fontWeight: Typography.weight.semibold, color: Colors.textSecondary, textAlign: 'center' },
  emptyText: { fontSize: Typography.size.sm, color: Colors.textTertiary, textAlign: 'center', lineHeight: 20 },
  emptySyncBtn: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.primary, borderRadius: Radius.md,
    paddingHorizontal: Spacing.xl, paddingVertical: Spacing.md,
    marginTop: Spacing.sm,
  },
  emptySyncBtnText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.background },
});


// Expo Router catches render-time failures here instead of leaving Orders as a white screen.
export function ErrorBoundary({ error, retry }: { error: Error; retry: () => void }) {
  return (
    <View style={{ flex: 1, backgroundColor: Colors.background, padding: Spacing.xl, justifyContent: 'center', alignItems: 'center', gap: Spacing.md }}>
      <MaterialIcons name="error-outline" size={42} color={Colors.danger} />
      <Text style={{ color: Colors.textPrimary, fontSize: Typography.size.lg, fontWeight: Typography.weight.bold, textAlign: 'center' }}>Orders couldn’t open</Text>
      <Text selectable style={{ color: Colors.textSecondary, fontSize: Typography.size.sm, textAlign: 'center' }}>{error?.message || 'An unexpected error occurred while rendering the Orders page.'}</Text>
      <Pressable onPress={retry} style={{ backgroundColor: Colors.primary, borderRadius: Radius.md, paddingHorizontal: Spacing.xl, paddingVertical: Spacing.md }}>
        <Text style={{ color: Colors.background, fontWeight: Typography.weight.bold }}>Try again</Text>
      </Pressable>
    </View>
  );
}
