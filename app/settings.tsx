// SWISH Settings Screen — V1 Simplified
// Primary sections: Account, eBay Connection, Currency/Region, Shipping, Data & Sync, Sign Out
// Advanced section (collapsed by default): Capital targets, Autonomy controls, Prediction/automation

import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, Switch,
  Modal, TextInput, ActivityIndicator, LayoutAnimation, Platform, UIManager,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors, Typography, Spacing, Radius, Shadow } from '@/constants/theme';
import { useApp } from '@/hooks/useApp';
import { useAlert } from '@/template';
import { useAuth } from '@/template';
import {
  AutonomyControls, getAutonomyControls, updateAutonomyControls,
  triggerGlobalKillSwitch, resumeAllAutonomy,
} from '@/services/autonomyService';
import { upsertBusinessConfig } from '@/services/businessConfigService';
import {
  ShippingService, getShippingServices, createShippingService,
  updateShippingService,
} from '@/services/coinInventoryService';
import { getLearningStats, LearningStats } from '@/services/aiLearningService';
import { getPartialImageItems } from '@/services/ebayImageService';
import { getSupabaseClient } from '@/template';
import { NICHES, NICHE_LIST, NicheId } from '@/constants/niches';

// Enable LayoutAnimation on Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface EbayConnectorStatus {
  status: 'connected' | 'disconnected' | 'error' | 'requires_reauth';
  sellerAccountId?: string | null;
  accessTokenExpiresAt?: string | null;
  lastSyncAt?: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function tokenExpiryLabel(expiresAt?: string | null): string {
  if (!expiresAt) return '';
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms < 0) return 'Token expired';
  const days = Math.floor(ms / 86400000);
  if (days < 1) return 'Expires today';
  if (days < 7) return `Expires in ${days}d`;
  return `Expires in ${Math.floor(days / 7)}w`;
}

// ── Section Header ─────────────────────────────────────────────────────────

function SectionHead({ title }: { title: string }) {
  return (
    <View style={secStyles.wrap}>
      <Text style={secStyles.title}>{title}</Text>
    </View>
  );
}
const secStyles = StyleSheet.create({
  wrap: { paddingHorizontal: Spacing.base, paddingTop: Spacing.lg, paddingBottom: Spacing.xs },
  title: {
    fontSize: 10, fontWeight: Typography.weight.bold,
    color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.8,
  },
});

// ── Setting Row ────────────────────────────────────────────────────────────

function SettingRow({
  icon, label, desc, value, onPress, color = Colors.primary, danger = false, rightSlot,
}: {
  icon: string; label: string; desc?: string; value?: string;
  onPress?: () => void; color?: string; danger?: boolean;
  rightSlot?: React.ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [rowStyles.row, pressed && onPress && { backgroundColor: Colors.surfaceElevated }]}
    >
      <View style={[rowStyles.icon, { backgroundColor: (danger ? Colors.danger : color) + '20' }]}>
        <MaterialIcons name={icon as any} size={18} color={danger ? Colors.danger : color} />
      </View>
      <View style={rowStyles.flex}>
        <Text style={[rowStyles.label, danger && { color: Colors.danger }]}>{label}</Text>
        {desc ? <Text style={rowStyles.desc}>{desc}</Text> : null}
      </View>
      {rightSlot ? rightSlot : value ? (
        <Text style={rowStyles.value} numberOfLines={1}>{value}</Text>
      ) : null}
      {onPress ? <MaterialIcons name="chevron-right" size={16} color={Colors.textTertiary} /> : null}
    </Pressable>
  );
}
const rowStyles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingHorizontal: Spacing.base, paddingVertical: Spacing.md,
  },
  flex: { flex: 1 },
  icon: { width: 36, height: 36, borderRadius: Radius.sm, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: Typography.size.sm, fontWeight: Typography.weight.medium, color: Colors.textPrimary },
  desc: { fontSize: Typography.size.xs, color: Colors.textTertiary, marginTop: 2, lineHeight: 16 },
  value: { fontSize: Typography.size.xs, color: Colors.textTertiary, maxWidth: 110, textAlign: 'right' },
});

// ── Card Group ─────────────────────────────────────────────────────────────

function CardGroup({ children }: { children: React.ReactNode }) {
  return <View style={cardStyles.group}>{children}</View>;
}
const cardStyles = StyleSheet.create({
  group: {
    backgroundColor: Colors.surface, marginHorizontal: Spacing.base,
    borderRadius: Radius.xl, borderWidth: 1, borderColor: Colors.surfaceBorder,
    overflow: 'hidden', ...Shadow.sm,
  },
});

function Divider() {
  return <View style={{ height: 1, backgroundColor: Colors.surfaceBorder, marginLeft: Spacing.base + 36 + Spacing.md }} />;
}

// ── eBay Business Policies Card ─────────────────────────────────────────────
// Loads all available policies and lets the user select which ones SWISH uses.
// Persists selections to the connector via set_policies route.

function EbayPoliciesCard({ tenantId }: { tenantId: string }) {
  const { showAlert } = useAlert();
  const supabase = getSupabaseClient();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [policies, setPolicies] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedFulfillment, setSelectedFulfillment] = useState<string | null>(null);
  const [selectedReturn, setSelectedReturn] = useState<string | null>(null);
  const [selectedPayment, setSelectedPayment] = useState<string | null>(null);
  const [showSelector, setShowSelector] = useState(false);

  const loadPolicies = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke('swish-ebay-list', {
        body: { route: 'get_seller_policies', tenantId },
      });
      if (fnErr) {
        let msg = fnErr.message;
        try { const t = await (fnErr as any).context?.text?.(); if (t) { try { const p = JSON.parse(t); msg = p.error ?? t; } catch { msg = t; } } } catch {}
        setError(msg);
      } else {
        setPolicies(data?.policies ?? null);
        setSelectedFulfillment(data?.selectedFulfillmentPolicyId ?? null);
        setSelectedReturn(data?.selectedReturnPolicyId ?? null);
        setSelectedPayment(data?.selectedPaymentPolicyId ?? null);
      }
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load policies');
    } finally {
      setLoading(false);
    }
  }, [tenantId, supabase]);

  const savePolicySelections = useCallback(async (fp: string | null, rp: string | null, pp: string | null) => {
    setSaving(true);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke('swish-ebay-list', {
        body: {
          route: 'set_policies',
          tenantId,
          fulfillmentPolicyId: fp,
          returnPolicyId: rp,
          paymentPolicyId: pp,
        },
      });
      if (fnErr) {
        let msg = fnErr.message;
        try { const t = await (fnErr as any).context?.text?.(); if (t) { try { const p = JSON.parse(t); msg = p.error ?? t; } catch { msg = t; } } } catch {}
        showAlert('Save Failed', msg);
      } else {
        showAlert('Policies Saved', 'SWISH will use these policies for all eBay listings.');
      }
    } finally {
      setSaving(false);
    }
  }, [tenantId, supabase, showAlert]);

  const hasSelections = !!(selectedFulfillment && selectedReturn);

  // Show a blocking banner when no policies are selected (submission will fail)
  const showBlockingBanner = !hasSelections && policies !== null;

  return (
    <View style={ebayCardStyles.card}>
      <View style={[ebayCardStyles.row, { paddingBottom: Spacing.md }]}>
        <View style={[ebayCardStyles.iconWrap, { backgroundColor: Colors.primaryDim }]}>
          <MaterialIcons name="policy" size={20} color={Colors.primary} />
        </View>
        <View style={ebayCardStyles.flex}>
          <Text style={ebayCardStyles.name}>eBay Business Policies</Text>
          <Text style={[ebayCardStyles.meta, { marginTop: 2 }]}>
            {hasSelections ? 'Policies selected — ready to list' : 'Select shipping, returns and payment policies'}
          </Text>
        </View>
        {hasSelections ? (
          <View style={[ebayCardStyles.badge, { backgroundColor: Colors.successDim }]}>
            <View style={[ebayCardStyles.dot, { backgroundColor: Colors.success }]} />
            <Text style={[ebayCardStyles.badgeText, { color: Colors.success }]}>Ready to List</Text>
          </View>
        ) : (
          <View style={[ebayCardStyles.badge, { backgroundColor: Colors.dangerDim }]}>
            <View style={[ebayCardStyles.dot, { backgroundColor: Colors.danger }]} />
            <Text style={[ebayCardStyles.badgeText, { color: Colors.danger }]}>Required</Text>
          </View>
        )}
      </View>

      {/* Selected policy summary */}
      {policies && (selectedFulfillment || selectedReturn) ? (
        <View style={{ paddingHorizontal: Spacing.base, paddingBottom: Spacing.sm, gap: Spacing.xs }}>
          {selectedFulfillment ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }}>
              <MaterialIcons name="local-shipping" size={11} color={Colors.success} />
              <Text style={{ fontSize: 10, color: Colors.textSecondary, flex: 1 }} numberOfLines={1}>
                Shipping: {policies.fulfillmentPolicies?.find((p: any) => p.policyId === selectedFulfillment)?.name ?? selectedFulfillment}
              </Text>
            </View>
          ) : null}
          {selectedReturn ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }}>
              <MaterialIcons name="assignment-return" size={11} color={Colors.info} />
              <Text style={{ fontSize: 10, color: Colors.textSecondary, flex: 1 }} numberOfLines={1}>
                Returns: {policies.returnPolicies?.find((p: any) => p.policyId === selectedReturn)?.name ?? selectedReturn}
              </Text>
            </View>
          ) : null}
          {selectedPayment ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }}>
              <MaterialIcons name="payment" size={11} color={Colors.accent} />
              <Text style={{ fontSize: 10, color: Colors.textSecondary, flex: 1 }} numberOfLines={1}>
                Payment: {policies.paymentPolicies?.find((p: any) => p.policyId === selectedPayment)?.name ?? selectedPayment}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {/* Policy selector */}
      {policies && showSelector ? (
        <View style={{ paddingHorizontal: Spacing.base, paddingBottom: Spacing.sm, gap: Spacing.md }}>
          {/* Fulfillment / Shipping */}
          {policies.fulfillmentPolicies?.length > 0 ? (
            <View style={{ gap: 4 }}>
              <Text style={{ fontSize: 9, fontWeight: Typography.weight.bold, color: Colors.textTertiary, textTransform: 'uppercase' as const, letterSpacing: 0.5 }}>Shipping Policy (required)</Text>
              {policies.fulfillmentPolicies.map((p: any) => (
                <Pressable key={p.policyId} onPress={() => setSelectedFulfillment(p.policyId)}
                  style={[{ flexDirection: 'row' as const, alignItems: 'center' as const, gap: Spacing.sm, padding: Spacing.sm, borderRadius: Radius.md, borderWidth: 1 }, selectedFulfillment === p.policyId ? { backgroundColor: Colors.primaryDim, borderColor: Colors.primary } : { backgroundColor: Colors.surface, borderColor: Colors.surfaceBorder }]}>
                  <MaterialIcons name={selectedFulfillment === p.policyId ? 'radio-button-checked' : 'radio-button-unchecked'} size={14} color={selectedFulfillment === p.policyId ? Colors.primary : Colors.textTertiary} />
                  <Text style={{ flex: 1, fontSize: Typography.size.xs, color: Colors.textPrimary }} numberOfLines={2}>{p.name}</Text>
                  <Text style={{ fontSize: 9, color: Colors.textTertiary }}>{p.policyId}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          {/* Return */}
          {policies.returnPolicies?.length > 0 ? (
            <View style={{ gap: 4 }}>
              <Text style={{ fontSize: 9, fontWeight: Typography.weight.bold, color: Colors.textTertiary, textTransform: 'uppercase' as const, letterSpacing: 0.5 }}>Returns Policy (required)</Text>
              {policies.returnPolicies.map((p: any) => (
                <Pressable key={p.policyId} onPress={() => setSelectedReturn(p.policyId)}
                  style={[{ flexDirection: 'row' as const, alignItems: 'center' as const, gap: Spacing.sm, padding: Spacing.sm, borderRadius: Radius.md, borderWidth: 1 }, selectedReturn === p.policyId ? { backgroundColor: Colors.infoDim, borderColor: Colors.info } : { backgroundColor: Colors.surface, borderColor: Colors.surfaceBorder }]}>
                  <MaterialIcons name={selectedReturn === p.policyId ? 'radio-button-checked' : 'radio-button-unchecked'} size={14} color={selectedReturn === p.policyId ? Colors.info : Colors.textTertiary} />
                  <Text style={{ flex: 1, fontSize: Typography.size.xs, color: Colors.textPrimary }} numberOfLines={2}>{p.name}</Text>
                  <Text style={{ fontSize: 9, color: Colors.textTertiary }}>{p.policyId}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          {/* Payment */}
          {policies.paymentPolicies?.length > 0 ? (
            <View style={{ gap: 4 }}>
              <Text style={{ fontSize: 9, fontWeight: Typography.weight.bold, color: Colors.textTertiary, textTransform: 'uppercase' as const, letterSpacing: 0.5 }}>Payment Policy (optional)</Text>
              {policies.paymentPolicies.map((p: any) => (
                <Pressable key={p.policyId} onPress={() => setSelectedPayment(prev => prev === p.policyId ? null : p.policyId)}
                  style={[{ flexDirection: 'row' as const, alignItems: 'center' as const, gap: Spacing.sm, padding: Spacing.sm, borderRadius: Radius.md, borderWidth: 1 }, selectedPayment === p.policyId ? { backgroundColor: Colors.accentDim, borderColor: Colors.accent } : { backgroundColor: Colors.surface, borderColor: Colors.surfaceBorder }]}>
                  <MaterialIcons name={selectedPayment === p.policyId ? 'check-box' : 'check-box-outline-blank'} size={14} color={selectedPayment === p.policyId ? Colors.accent : Colors.textTertiary} />
                  <Text style={{ flex: 1, fontSize: Typography.size.xs, color: Colors.textPrimary }} numberOfLines={2}>{p.name}</Text>
                  <Text style={{ fontSize: 9, color: Colors.textTertiary }}>{p.policyId}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          {/* Save button */}
          <Pressable
            onPress={() => { savePolicySelections(selectedFulfillment, selectedReturn, selectedPayment); setShowSelector(false); }}
            disabled={saving || !selectedFulfillment || !selectedReturn}
            style={({ pressed }) => [{ flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 6, backgroundColor: (!selectedFulfillment || !selectedReturn) ? Colors.surfaceHighlight : Colors.primary, borderRadius: Radius.md, padding: Spacing.md, opacity: saving ? 0.7 : pressed ? 0.85 : 1 }]}>
            {saving ? <ActivityIndicator size="small" color={Colors.background} style={{ width: 14 }} /> : <MaterialIcons name="save" size={14} color={(!selectedFulfillment || !selectedReturn) ? Colors.textTertiary : Colors.background} />}
            <Text style={{ fontSize: Typography.size.xs, fontWeight: Typography.weight.bold, color: (!selectedFulfillment || !selectedReturn) ? Colors.textTertiary : Colors.background }}>
              {saving ? 'Saving...' : 'Save Policy Selections'}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {showBlockingBanner ? (
        <View style={{ paddingHorizontal: Spacing.base, paddingBottom: Spacing.sm, gap: 4 }}>
          <View style={{ flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: Spacing.sm, backgroundColor: Colors.dangerDim, borderRadius: Radius.md, padding: Spacing.md, borderWidth: 1, borderColor: Colors.danger + '40' }}>
            <MaterialIcons name="error" size={14} color={Colors.danger} style={{ marginTop: 1 }} />
            <Text style={{ flex: 1, fontSize: Typography.size.xs, color: Colors.danger, lineHeight: 16 }}>
              {!selectedFulfillment ? 'Shipping policy not selected — eBay listings will fail without it.' : 'Return policy not selected — eBay listings will fail without it.'} Tap "Select" then "Save Policy Selections".
            </Text>
          </View>
        </View>
      ) : null}
      {error ? (
        <View style={{ paddingHorizontal: Spacing.base, paddingBottom: Spacing.sm }}>
          <Text style={{ fontSize: 10, color: Colors.danger, lineHeight: 14 }}>{error}</Text>
        </View>
      ) : null}

      <View style={ebayCardStyles.footer}>
        <Text style={ebayCardStyles.footerText}>
          {hasSelections ? 'Policies configured — SWISH will use these for all eBay listings' : 'Required: load and select shipping + return policies before listing'}
        </Text>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {policies && !showSelector ? (
            <Pressable
              onPress={() => setShowSelector(true)}
              style={({ pressed }) => [{ flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4, backgroundColor: Colors.surfaceElevated, borderRadius: Radius.md, paddingHorizontal: Spacing.sm, paddingVertical: 4, borderWidth: 1, borderColor: Colors.surfaceBorder, opacity: pressed ? 0.8 : 1 }]}>
              <MaterialIcons name="tune" size={11} color={Colors.textSecondary} />
              <Text style={{ fontSize: 10, fontWeight: Typography.weight.semibold, color: Colors.textSecondary }}>Select</Text>
            </Pressable>
          ) : policies && showSelector ? (
            <Pressable onPress={() => setShowSelector(false)} style={{ padding: 4 }} hitSlop={8}>
              <MaterialIcons name="close" size={14} color={Colors.textTertiary} />
            </Pressable>
          ) : null}
          <Pressable
            onPress={loadPolicies}
            disabled={loading}
            style={({ pressed }) => [{ flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4, backgroundColor: Colors.primary, borderRadius: Radius.md, paddingHorizontal: Spacing.sm, paddingVertical: 4, opacity: loading ? 0.7 : pressed ? 0.85 : 1 }]}>
            {loading
              ? <ActivityIndicator size="small" color={Colors.background} style={{ width: 12, height: 12 }} />
              : <MaterialIcons name="refresh" size={12} color={Colors.background} />}
            <Text style={{ fontSize: 10, fontWeight: Typography.weight.bold, color: Colors.background }}>
              {loading ? 'Loading...' : policies ? 'Refresh' : 'Load Policies'}
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

// ── eBay Status Card ───────────────────────────────────────────────────────

function EbayStatusCard({
  ebayStatus, onManage,
}: {
  ebayStatus: EbayConnectorStatus | null;
  onManage: () => void;
}) {
  const isConnected = ebayStatus?.status === 'connected';
  const expiryStr = tokenExpiryLabel(ebayStatus?.accessTokenExpiresAt);
  const isExpiringSoon = expiryStr.startsWith('Expires today') || expiryStr.startsWith('Expires in 1d') || expiryStr.startsWith('Expires in 2d') || expiryStr.startsWith('Expires in 3d');
  const isExpired = expiryStr === 'Token expired';

  return (
    <Pressable
      onPress={onManage}
      style={({ pressed }) => [ebayCardStyles.card, pressed && { opacity: 0.92 }]}
    >
      <View style={ebayCardStyles.row}>
        <View style={[ebayCardStyles.iconWrap, { backgroundColor: isConnected ? '#E5323815' : Colors.surfaceHighlight }]}>
          <MaterialIcons name="storefront" size={22} color={isConnected ? '#E53238' : Colors.textTertiary} />
        </View>
        <View style={ebayCardStyles.flex}>
          <Text style={ebayCardStyles.name}>eBay Seller Account</Text>
          {isConnected ? (
            <View style={ebayCardStyles.metaRow}>
              {ebayStatus?.sellerAccountId ? (
                <Text style={ebayCardStyles.meta}>{ebayStatus.sellerAccountId}</Text>
              ) : null}
              {expiryStr ? (
                <Text style={[
                  ebayCardStyles.expiry,
                  isExpired ? { color: Colors.danger } : isExpiringSoon ? { color: Colors.warning } : {},
                ]}>
                  {expiryStr}
                </Text>
              ) : null}
            </View>
          ) : (
            <Text style={ebayCardStyles.meta}>Not connected — tap to set up</Text>
          )}
        </View>
        <View style={[
          ebayCardStyles.badge,
          {
            backgroundColor: isConnected
              ? Colors.successDim
              : ebayStatus?.status === 'error' || isExpired
              ? Colors.dangerDim
              : ebayStatus?.status === 'requires_reauth'
              ? Colors.warningDim
              : Colors.surfaceHighlight,
          },
        ]}>
          <View style={[
            ebayCardStyles.dot,
            { backgroundColor: isConnected ? Colors.success : ebayStatus?.status === 'error' || isExpired ? Colors.danger : ebayStatus?.status === 'requires_reauth' ? Colors.warning : Colors.textTertiary },
          ]} />
          <Text style={[
            ebayCardStyles.badgeText,
            {
              color: isConnected ? Colors.success : ebayStatus?.status === 'error' || isExpired ? Colors.danger : ebayStatus?.status === 'requires_reauth' ? Colors.warning : Colors.textTertiary,
            },
          ]}>
            {isConnected ? 'Active' : ebayStatus?.status === 'requires_reauth' ? 'Re-auth' : ebayStatus?.status === 'error' ? 'Error' : 'Disconnected'}
          </Text>
        </View>
      </View>

      {isConnected ? (
        <View style={ebayCardStyles.capRow}>
          {[
            { icon: 'list-alt', label: 'List' },
            { icon: 'publish', label: 'Publish' },
            { icon: 'receipt-long', label: 'Orders' },
            { icon: 'price-change', label: 'Reprice' },
            { icon: 'sync', label: 'Sync' },
          ].map(cap => (
            <View key={cap.label} style={ebayCardStyles.cap}>
              <MaterialIcons name={cap.icon as any} size={11} color={Colors.success} />
              <Text style={ebayCardStyles.capLabel}>{cap.label}</Text>
            </View>
          ))}
        </View>
      ) : null}

      <View style={ebayCardStyles.footer}>
        <Text style={ebayCardStyles.footerText}>
          {isConnected ? 'Manage connection, re-authorise or disconnect' : 'Step-by-step OAuth setup wizard'}
        </Text>
        <MaterialIcons name="chevron-right" size={14} color={isConnected ? Colors.success : Colors.textTertiary} />
      </View>
    </Pressable>
  );
}

const ebayCardStyles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface, borderRadius: Radius.xl, marginHorizontal: Spacing.base,
    borderWidth: 1, borderColor: Colors.surfaceBorder, overflow: 'hidden', ...Shadow.sm,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.base, paddingBottom: Spacing.sm },
  flex: { flex: 1 },
  iconWrap: { width: 44, height: 44, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: 2 },
  meta: { fontSize: Typography.size.xs, color: Colors.textTertiary },
  expiry: { fontSize: 10, color: Colors.textTertiary, fontWeight: Typography.weight.semibold },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: Radius.pill },
  dot: { width: 6, height: 6, borderRadius: 3 },
  badgeText: { fontSize: 9, fontWeight: Typography.weight.bold },
  capRow: {
    flexDirection: 'row', gap: Spacing.xs, flexWrap: 'wrap',
    paddingHorizontal: Spacing.base, paddingBottom: Spacing.sm,
  },
  cap: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: Colors.successDim, borderRadius: Radius.pill,
    paddingHorizontal: 7, paddingVertical: 3,
  },
  capLabel: { fontSize: 9, color: Colors.success, fontWeight: Typography.weight.semibold },
  footer: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.base, paddingVertical: Spacing.sm,
    borderTopWidth: 1, borderTopColor: Colors.surfaceBorder,
    backgroundColor: Colors.surfaceHighlight,
  },
  footerText: { fontSize: 10, color: Colors.textSecondary, flex: 1 },
});

// ── Currency Picker Row ────────────────────────────────────────────────────

function CurrencyRow({
  currency, onSave,
}: {
  currency: string;
  onSave: (c: string) => Promise<void>;
}) {
  const options = [
    { code: 'GBP', symbol: '£', flag: '🇬🇧', label: 'British Pound' },
    { code: 'USD', symbol: '$', flag: '🇺🇸', label: 'US Dollar' },
    { code: 'EUR', symbol: '€', flag: '🇪🇺', label: 'Euro' },
  ];
  const [saving, setSaving] = useState(false);

  return (
    <View style={currStyles.wrap}>
      <View style={[rowStyles.icon, { backgroundColor: Colors.info + '20' }]}>
        <MaterialIcons name="language" size={18} color={Colors.info} />
      </View>
      <View style={currStyles.flex}>
        <Text style={currStyles.label}>Currency</Text>
        <View style={currStyles.chips}>
          {options.map(opt => (
            <Pressable
              key={opt.code}
              onPress={async () => {
                if (opt.code === currency) return;
                setSaving(true);
                await onSave(opt.code);
                setSaving(false);
              }}
              style={[currStyles.chip, currency === opt.code && currStyles.chipActive]}
            >
              <Text style={currStyles.flag}>{opt.flag}</Text>
              <Text style={[currStyles.chipLabel, currency === opt.code && currStyles.chipLabelActive]}>
                {opt.symbol} {opt.code}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
      {saving ? <ActivityIndicator size="small" color={Colors.primary} style={{ marginRight: 4 }} /> : null}
    </View>
  );
}

const currStyles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md, paddingHorizontal: Spacing.base, paddingVertical: Spacing.md },
  flex: { flex: 1, gap: Spacing.sm },
  label: { fontSize: Typography.size.sm, fontWeight: Typography.weight.medium, color: Colors.textPrimary },
  chips: { flexDirection: 'row', gap: Spacing.xs },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: Radius.pill,
    backgroundColor: Colors.surfaceHighlight, borderWidth: 1, borderColor: Colors.surfaceBorder,
  },
  chipActive: { backgroundColor: Colors.primaryDim, borderColor: Colors.primary },
  flag: { fontSize: 13 },
  chipLabel: { fontSize: Typography.size.xs, fontWeight: Typography.weight.semibold, color: Colors.textSecondary },
  chipLabelActive: { color: Colors.primary },
});

// ── Shipping Default Row ─────────────────────────────────────────────────

function ShippingDefaultRow({
  defaultCost, onSave,
}: {
  defaultCost: number;
  onSave: (v: number) => Promise<void>;
}) {
  const { showAlert } = useAlert();
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState('');
  const [saving, setSaving] = useState(false);

  const save = useCallback(async () => {
    const val = parseFloat(input);
    if (isNaN(val) || val < 0) { showAlert('Invalid Amount', 'Enter a valid shipping cost (0 for free).'); return; }
    setSaving(true);
    await onSave(val);
    setSaving(false);
    setEditing(false);
  }, [input, onSave, showAlert]);

  return (
    <View style={shCostStyles.row}>
      <View style={[rowStyles.icon, { backgroundColor: Colors.primary + '20' }]}>
        <MaterialIcons name="local-shipping" size={18} color={Colors.primary} />
      </View>
      <View style={shCostStyles.flex}>
        <Text style={shCostStyles.label}>Default Shipping Cost</Text>
        <Text style={shCostStyles.desc}>Pre-filled on every new listing (£0 = free shipping)</Text>
      </View>
      {editing ? (
        <View style={shCostStyles.editRow}>
          <Text style={shCostStyles.currency}>£</Text>
          <TextInput
            style={shCostStyles.input}
            value={input}
            onChangeText={setInput}
            keyboardType="decimal-pad"
            placeholder="0.00"
            placeholderTextColor={Colors.textTertiary}
            autoFocus
            selectTextOnFocus
          />
          <Pressable onPress={save} disabled={saving} style={shCostStyles.saveBtn}>
            {saving ? <ActivityIndicator size="small" color={Colors.background} style={{ width: 14 }} /> : <MaterialIcons name="check" size={14} color={Colors.background} />}
          </Pressable>
          <Pressable onPress={() => setEditing(false)} style={shCostStyles.cancelBtn} hitSlop={6}>
            <MaterialIcons name="close" size={14} color={Colors.textTertiary} />
          </Pressable>
        </View>
      ) : (
        <Pressable
          onPress={() => { setInput(String(defaultCost ?? 0)); setEditing(true); }}
          style={shCostStyles.valueBtn}
          hitSlop={4}
        >
          <Text style={shCostStyles.valueText}>
            {defaultCost ? `£${Number(defaultCost).toFixed(2)}` : 'Free'}
          </Text>
          <MaterialIcons name="edit" size={13} color={Colors.primary} />
        </Pressable>
      )}
    </View>
  );
}

const shCostStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingHorizontal: Spacing.base, paddingVertical: Spacing.md },
  flex: { flex: 1 },
  label: { fontSize: Typography.size.sm, fontWeight: Typography.weight.medium, color: Colors.textPrimary },
  desc: { fontSize: Typography.size.xs, color: Colors.textTertiary, marginTop: 2 },
  editRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  currency: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.primary },
  input: { minWidth: 64, maxWidth: 90, fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.textPrimary, backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.sm, paddingHorizontal: Spacing.sm, paddingVertical: 4, borderWidth: 1, borderColor: Colors.primary + '40', includeFontPadding: false },
  saveBtn: { width: 26, height: 26, borderRadius: Radius.sm, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  cancelBtn: { width: 26, height: 26, borderRadius: Radius.sm, alignItems: 'center', justifyContent: 'center' },
  valueBtn: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  valueText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.primary },
});

// ── Shipping Service Modal ─────────────────────────────────────────────────

function ShippingServiceModal({
  visible, service, tenantId,
  onClose, onSaved,
}: {
  visible: boolean;
  service: ShippingService | null;
  tenantId: string;
  onClose: () => void;
  onSaved: (svc: ShippingService, isNew: boolean) => void;
}) {
  const { showAlert } = useAlert();
  const insets = useSafeAreaInsets();
  const [form, setForm] = useState({
    name: '', carrier: 'Royal Mail', price: '',
    weightBandG: '', packageType: 'large_letter',
    isTracked: false, isSigned: false, isInternational: false, isDefault: false,
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (service) {
      setForm({
        name: service.name, carrier: service.carrier, price: service.price.toFixed(2),
        weightBandG: service.weightBandG ? String(service.weightBandG) : '',
        packageType: service.packageType,
        isTracked: service.isTracked, isSigned: service.isSigned,
        isInternational: service.isInternational, isDefault: service.isDefault,
      });
    } else {
      setForm({ name: '', carrier: 'Royal Mail', price: '', weightBandG: '', packageType: 'large_letter', isTracked: false, isSigned: false, isInternational: false, isDefault: false });
    }
  }, [service, visible]);

  const handleSave = useCallback(async () => {
    const price = parseFloat(form.price);
    if (!form.name.trim()) { showAlert('Name Required', 'Enter a service name.'); return; }
    if (isNaN(price) || price < 0) { showAlert('Invalid Price', 'Enter a valid price.'); return; }
    setSaving(true);
    const payload = {
      name: form.name.trim(), carrier: form.carrier.trim() || 'Royal Mail',
      price, weightBandG: form.weightBandG ? parseInt(form.weightBandG) : undefined,
      packageType: form.packageType, isTracked: form.isTracked, isSigned: form.isSigned,
      isInternational: form.isInternational, isDefault: form.isDefault, isActive: true,
    };
    if (service?.id) {
      const { error } = await updateShippingService(service.id, tenantId, payload);
      if (error) { showAlert('Save Failed', error); setSaving(false); return; }
      onSaved({ ...service, ...payload }, false);
    } else {
      const { service: newSvc, error } = await createShippingService(tenantId, payload);
      if (error || !newSvc) { showAlert('Save Failed', error ?? 'Could not create service.'); setSaving(false); return; }
      onSaved(newSvc, true);
    }
    setSaving(false);
    onClose();
  }, [form, service, tenantId, showAlert, onSaved, onClose]);

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={svcModal.overlay}>
        <View style={[svcModal.card, { paddingBottom: insets.bottom + Spacing.base }]}>
          <View style={svcModal.header}>
            <Text style={svcModal.title}>{service ? 'Edit Shipping Service' : 'New Shipping Service'}</Text>
            <Pressable onPress={onClose} hitSlop={8}><MaterialIcons name="close" size={22} color={Colors.textSecondary} /></Pressable>
          </View>
          <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 420 }}>
            <View style={{ gap: Spacing.md, paddingBottom: Spacing.base }}>
              <View style={svcModal.field}>
                <Text style={svcModal.fieldLabel}>Service Name *</Text>
                <TextInput style={svcModal.input} value={form.name} onChangeText={v => setForm(p => ({ ...p, name: v }))} placeholder="e.g. Royal Mail 2nd Class" placeholderTextColor={Colors.textTertiary} autoFocus={!service} />
              </View>
              <View style={{ flexDirection: 'row', gap: Spacing.sm }}>
                <View style={[svcModal.field, { flex: 2 }]}>
                  <Text style={svcModal.fieldLabel}>Carrier</Text>
                  <TextInput style={svcModal.input} value={form.carrier} onChangeText={v => setForm(p => ({ ...p, carrier: v }))} placeholder="Royal Mail" placeholderTextColor={Colors.textTertiary} />
                </View>
                <View style={[svcModal.field, { flex: 1 }]}>
                  <Text style={svcModal.fieldLabel}>Price (£)</Text>
                  <TextInput style={svcModal.input} value={form.price} onChangeText={v => setForm(p => ({ ...p, price: v }))} placeholder="0.00" placeholderTextColor={Colors.textTertiary} keyboardType="decimal-pad" />
                </View>
              </View>
              <View style={svcModal.field}>
                <Text style={svcModal.fieldLabel}>Package Type</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ flexDirection: 'row', gap: Spacing.xs, paddingVertical: 4 }}>
                  {[{ id: 'letter', label: 'Letter' }, { id: 'large_letter', label: 'Large Letter' }, { id: 'small_parcel', label: 'Small Parcel' }, { id: 'parcel', label: 'Parcel' }].map(pt => (
                    <Pressable key={pt.id} onPress={() => setForm(p => ({ ...p, packageType: pt.id }))} style={[svcModal.typeChip, form.packageType === pt.id && svcModal.typeChipActive]}>
                      <Text style={[svcModal.typeChipText, form.packageType === pt.id && { color: Colors.primary, fontWeight: Typography.weight.semibold }]}>{pt.label}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
              <View style={svcModal.field}>
                <Text style={svcModal.fieldLabel}>Max Weight (grams, optional)</Text>
                <TextInput style={svcModal.input} value={form.weightBandG} onChangeText={v => setForm(p => ({ ...p, weightBandG: v }))} placeholder="e.g. 100" placeholderTextColor={Colors.textTertiary} keyboardType="number-pad" />
              </View>
              {([
                { key: 'isTracked', label: 'Tracked', icon: 'track-changes' },
                { key: 'isSigned', label: 'Requires Signature', icon: 'draw' },
                { key: 'isInternational', label: 'International', icon: 'flight-takeoff' },
                { key: 'isDefault', label: 'Set as Default Service', icon: 'star' },
              ] as const).map(opt => (
                <Pressable key={opt.key} onPress={() => setForm(p => ({ ...p, [opt.key]: !p[opt.key] }))} style={svcModal.toggleRow}>
                  <MaterialIcons name={opt.icon as any} size={16} color={form[opt.key] ? Colors.primary : Colors.textTertiary} />
                  <Text style={[svcModal.toggleLabel, form[opt.key] && { color: Colors.primary }]}>{opt.label}</Text>
                  <View style={[svcModal.toggleDot, form[opt.key] && svcModal.toggleDotActive]}>
                    {form[opt.key] ? <MaterialIcons name="check" size={12} color={Colors.background} /> : null}
                  </View>
                </Pressable>
              ))}
            </View>
          </ScrollView>
          <Pressable onPress={handleSave} disabled={saving} style={({ pressed }) => [svcModal.saveBtn, pressed && { opacity: 0.85 }]}>
            {saving ? <ActivityIndicator size="small" color={Colors.background} /> : <MaterialIcons name="save" size={18} color={Colors.background} />}
            <Text style={svcModal.saveBtnText}>{saving ? 'Saving...' : 'Save Service'}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const svcModal = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: Colors.overlay80, justifyContent: 'flex-end' },
  card: { backgroundColor: Colors.surfaceElevated, borderTopLeftRadius: Radius.xxl, borderTopRightRadius: Radius.xxl, padding: Spacing.xl, gap: Spacing.lg, borderTopWidth: 1, borderTopColor: Colors.surfaceBorder },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: Typography.size.xl, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  field: { gap: 5 },
  fieldLabel: { fontSize: Typography.size.xs, fontWeight: Typography.weight.semibold, color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4 },
  input: { backgroundColor: Colors.surface, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.surfaceBorder, padding: Spacing.md, fontSize: Typography.size.sm, color: Colors.textPrimary },
  typeChip: { paddingHorizontal: Spacing.md, paddingVertical: 6, borderRadius: Radius.pill, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.surfaceBorder },
  typeChipActive: { backgroundColor: Colors.primaryDim, borderColor: Colors.primary },
  typeChipText: { fontSize: Typography.size.xs, color: Colors.textSecondary },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.surfaceBorder },
  toggleLabel: { flex: 1, fontSize: Typography.size.sm, color: Colors.textSecondary },
  toggleDot: { width: 22, height: 22, borderRadius: 11, backgroundColor: Colors.surface, borderWidth: 2, borderColor: Colors.surfaceBorder, alignItems: 'center', justifyContent: 'center' },
  toggleDotActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  saveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, backgroundColor: Colors.primary, borderRadius: Radius.md, padding: Spacing.base },
  saveBtnText: { fontSize: Typography.size.base, fontWeight: Typography.weight.bold, color: Colors.background },
});

// ── AI Learning Stats Card ───────────────────────────────────────────────────

function AILearningCard({ tenantId }: { tenantId: string }) {
  const [stats, setStats] = useState<LearningStats | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const s = await getLearningStats(tenantId);
    setStats(s);
    setLoading(false);
  }, [tenantId]);

  useEffect(() => { load(); }, [load]);

  const categoryLabel: Record<string, string> = {
    wrong_identity: 'Wrong identity', wrong_date: 'Wrong year', wrong_ruler: 'Wrong ruler',
    wrong_denomination: 'Wrong denomination', wrong_country: 'Wrong country',
    wrong_condition: 'Wrong condition', wrong_material: 'Wrong material',
    wrong_valuation: 'Wrong valuation', other: 'Other error',
  };

  return (
    <View style={learnStyles.card}>
      <View style={learnStyles.headerRow}>
        <View style={[learnStyles.iconWrap, { backgroundColor: Colors.accent + '20' }]}>
          <MaterialIcons name="school" size={18} color={Colors.accent} />
        </View>
        <View style={learnStyles.flex}>
          <Text style={learnStyles.title}>AI Learning</Text>
          <Text style={learnStyles.desc}>Re-ID feedback used to improve future identifications</Text>
        </View>
        <Pressable onPress={load} disabled={loading} hitSlop={8}>
          {loading
            ? <ActivityIndicator size="small" color={Colors.accent} style={{ width: 18, height: 18 }} />
            : <MaterialIcons name="refresh" size={16} color={Colors.textTertiary} />}
        </Pressable>
      </View>

      {stats && stats.totalFeedback === 0 ? (
        <View style={learnStyles.emptyWrap}>
          <MaterialIcons name="info-outline" size={14} color={Colors.textTertiary} />
          <Text style={learnStyles.emptyText}>No feedback yet. Use Re-ID Correct/Incorrect buttons to train the AI.</Text>
        </View>
      ) : stats ? (
        <>
          <View style={learnStyles.statsRow}>
            <View style={learnStyles.stat}>
              <Text style={[learnStyles.statValue, { color: Colors.success }]}>{stats.accuracyPct}%</Text>
              <Text style={learnStyles.statLabel}>Accuracy</Text>
            </View>
            <View style={learnStyles.stat}>
              <Text style={[learnStyles.statValue, { color: Colors.accent }]}>{stats.totalFeedback}</Text>
              <Text style={learnStyles.statLabel}>Feedback</Text>
            </View>
            <View style={learnStyles.stat}>
              <Text style={[learnStyles.statValue, { color: Colors.success }]}>{stats.correctCount}</Text>
              <Text style={learnStyles.statLabel}>Correct</Text>
            </View>
            <View style={learnStyles.stat}>
              <Text style={[learnStyles.statValue, { color: stats.incorrectCount > 0 ? Colors.danger : Colors.textTertiary }]}>{stats.incorrectCount + stats.partialCount}</Text>
              <Text style={learnStyles.statLabel}>Corrected</Text>
            </View>
          </View>
          {stats.topErrorCategories.length > 0 ? (
            <View style={learnStyles.errorSection}>
              <Text style={learnStyles.sectionLabel}>TOP ERROR CATEGORIES</Text>
              {stats.topErrorCategories.map(ec => (
                <View key={ec.category} style={learnStyles.errorRow}>
                  <View style={[learnStyles.errorDot, { backgroundColor: Colors.danger }]} />
                  <Text style={learnStyles.errorLabel}>{categoryLabel[ec.category] ?? ec.category}</Text>
                  <View style={learnStyles.errorCountBadge}>
                    <Text style={learnStyles.errorCountText}>{ec.count}x</Text>
                  </View>
                </View>
              ))}
            </View>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

const learnStyles = StyleSheet.create({
  card: { backgroundColor: Colors.surface, marginHorizontal: Spacing.base, borderRadius: Radius.xl, borderWidth: 1, borderColor: Colors.surfaceBorder, overflow: 'hidden', padding: Spacing.base, gap: Spacing.md },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md },
  iconWrap: { width: 36, height: 36, borderRadius: Radius.sm, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  flex: { flex: 1 },
  title: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.textPrimary },
  desc: { fontSize: Typography.size.xs, color: Colors.textTertiary, marginTop: 2, lineHeight: 16 },
  emptyWrap: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.md, padding: Spacing.md },
  emptyText: { flex: 1, fontSize: Typography.size.xs, color: Colors.textTertiary, lineHeight: 16 },
  statsRow: { flexDirection: 'row', justifyContent: 'space-around' },
  stat: { alignItems: 'center', gap: 3 },
  statValue: { fontSize: Typography.size.lg, fontWeight: Typography.weight.bold },
  statLabel: { fontSize: 9, color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.3 },
  errorSection: { gap: Spacing.xs },
  sectionLabel: { fontSize: 9, fontWeight: Typography.weight.bold, color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5 },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: 3 },
  errorDot: { width: 6, height: 6, borderRadius: 3 },
  errorLabel: { flex: 1, fontSize: Typography.size.xs, color: Colors.textSecondary },
  errorCountBadge: { backgroundColor: Colors.dangerDim, borderRadius: Radius.pill, paddingHorizontal: 7, paddingVertical: 2 },
  errorCountText: { fontSize: 10, fontWeight: Typography.weight.bold, color: Colors.danger },
});

// ── Data & Sync Card ──────────────────────────────────────────────────────────

interface EbayFullSyncProgress {
  state: 'idle' | 'fetching' | 'syncing' | 'done' | 'error';
  phase: string;
  current: number;
  total: number;
  updated: number;
  imagesFetched: number;
  titlesFixed: number;
  failed: number;
  orphansFixed: number;
  totalEbayListings: number;
  processed: number;
  requiresReauth?: boolean;
  errorMsg?: string;
  failedEbayIds?: string[];
}

const EMPTY_EBAY_SYNC: EbayFullSyncProgress = {
  state: 'idle', phase: '', current: 0, total: 0, processed: 0,
  updated: 0, imagesFetched: 0, titlesFixed: 0, failed: 0,
  orphansFixed: 0, totalEbayListings: 0,
};

interface SyncProgress {
  state: 'idle' | 'running' | 'done' | 'error';
  imagesDownloaded?: number;
  imagesFailed?: number;
  imagesNotFound?: number;
  authFailures?: number;
  titlesFixed?: number;
  processed?: number;
  requiresReauth?: boolean;
  errorMsg?: string;
}

interface PushAllProgress {
  state: 'idle' | 'running' | 'done' | 'error';
  current: number;
  total: number;
  updated: number;
  skipped: number;
  failed: number;
  errorMsg?: string;
  requiresReauth?: boolean;
}

interface EbaySyncAllProgress {
  state: 'idle' | 'running' | 'done' | 'error';
  current: number;
  total: number;
  updated: number;
  failed: number;
  errorMsg?: string;
  requiresReauth?: boolean;
}

interface TitleFixProgress {
  state: 'idle' | 'running' | 'done' | 'error';
  current: number;
  total: number;
  fixed: number;
  failed: number;
  errorMsg?: string;
  requiresReauth?: boolean;
}

function DataSyncCard({ tenantId, onSyncComplete }: { tenantId: string; onSyncComplete?: () => void }) {
  const router = useRouter();
  const [syncProgress, setSyncProgress] = useState<SyncProgress>({ state: 'idle' });
  const [ebaySync, setEbaySync] = useState<EbaySyncAllProgress>({ state: 'idle', current: 0, total: 0, updated: 0, failed: 0 });
  const [titleFix, setTitleFix] = useState<TitleFixProgress>({ state: 'idle', current: 0, total: 0, fixed: 0, failed: 0 });
  const [fullSync, setFullSync] = useState<EbayFullSyncProgress>(EMPTY_EBAY_SYNC);
  const [imgDownload, setImgDownload] = useState<{ state: 'idle' | 'running' | 'done' | 'error'; downloaded: number; failed: number; notFound: number; errorMsg?: string; requiresReauth?: boolean }>({ state: 'idle', downloaded: 0, failed: 0, notFound: 0 });
  const [repairPartial, setRepairPartial] = useState<{
    checkState: 'idle' | 'checking' | 'ready' | 'running' | 'done' | 'error';
    count: number;
    itemIds: string[];
    downloaded: number;
    failed: number;
    errorMsg?: string;
    requiresReauth?: boolean;
  }>({ checkState: 'idle', count: 0, itemIds: [], downloaded: 0, failed: 0 });
  const [pushAll, setPushAll] = useState<PushAllProgress>({ state: 'idle', current: 0, total: 0, updated: 0, skipped: 0, failed: 0 });
  const supabase = getSupabaseClient();

  // ── Repair Partial Images ────────────────────────────────────────────────────
  const handleCheckPartial = useCallback(async () => {
    if (repairPartial.checkState === 'checking') return;
    setRepairPartial(prev => ({ ...prev, checkState: 'checking', count: 0, itemIds: [] }));
    try {
      const { count, itemIds } = await getPartialImageItems(tenantId);
      setRepairPartial(prev => ({ ...prev, checkState: 'ready', count, itemIds }));
    } catch {
      setRepairPartial(prev => ({ ...prev, checkState: 'idle' }));
    }
  }, [tenantId, repairPartial.checkState]);

  // Auto-check on mount so the count is visible immediately
  useEffect(() => { handleCheckPartial(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRepairPartial = useCallback(async () => {
    if (repairPartial.checkState === 'running') return;
    const ids = repairPartial.itemIds;
    if (ids.length === 0) return;
    setRepairPartial(prev => ({ ...prev, checkState: 'running', downloaded: 0, failed: 0 }));
    try {
      const { data, error } = await supabase.functions.invoke('swish-image-download', {
        body: { tenantId, itemIds: ids, fixTitles: false },
      });
      if (error) {
        let msg = error.message ?? 'Unknown error';
        try { const t = await (error as any).context?.text?.(); if (t) { try { const p = JSON.parse(t); msg = p.error ?? t; } catch { msg = t; } } } catch {}
        const isReauth = msg.includes('re-authoris') || msg.includes('requiresReauth');
        setRepairPartial(prev => ({ ...prev, checkState: 'error', errorMsg: msg, requiresReauth: isReauth }));
        return;
      }
      setRepairPartial(prev => ({
        ...prev,
        checkState: 'done',
        downloaded: data?.imagesDownloaded ?? 0,
        failed: data?.imagesFailed ?? 0,
        requiresReauth: data?.requiresReauth ?? false,
      }));
      onSyncComplete?.();
    } catch (e: any) {
      setRepairPartial(prev => ({ ...prev, checkState: 'error', errorMsg: e?.message ?? 'Repair failed' }));
    }
  }, [tenantId, repairPartial, supabase, onSyncComplete]);

  const resetRepairPartial = useCallback(() => {
    setRepairPartial({ checkState: 'idle', count: 0, itemIds: [], downloaded: 0, failed: 0 });
    setTimeout(() => handleCheckPartial(), 50);
  }, [handleCheckPartial]);

  // ── Full eBay Sync (new primary action) ────────────────────────────────────────
  const handleFullEbaySync = useCallback(async (mode: 'full' | 'images_only' | 'data_only' = 'full') => {
    if (fullSync.state === 'fetching' || fullSync.state === 'syncing') return;
    setFullSync({ ...EMPTY_EBAY_SYNC, state: 'fetching', phase: 'Fetching eBay listings...' });
    try {
      const { data, error } = await supabase.functions.invoke('swish-ebay-sync', {
        body: { tenantId, mode },
      });
      if (error) {
        let msg = error.message ?? 'Unknown error';
        try { const t = await (error as any).context?.text?.(); if (t) { try { const p = JSON.parse(t); msg = p.error ?? t; } catch { msg = t; } } } catch {}
        const isReauth = msg.includes('re-authoris') || msg.includes('REQUIRES_REAUTH') || msg.includes('requiresReauth');
        setFullSync(prev => ({ ...prev, state: 'error', errorMsg: msg, requiresReauth: isReauth }));
        return;
      }
      setFullSync({
        state: 'done', phase: 'Complete',
        current: data?.processed ?? 0, total: data?.processed ?? 0,
        processed: data?.processed ?? 0,
        updated: data?.updated ?? 0,
        imagesFetched: data?.imagesFetched ?? 0,
        titlesFixed: data?.titlesFixed ?? 0,
        failed: data?.failed ?? 0,
        orphansFixed: data?.orphansFixed ?? 0,
        totalEbayListings: data?.totalEbayListings ?? 0,
        requiresReauth: data?.requiresReauth ?? false,
        failedEbayIds: data?.failedEbayIds ?? [],
      });
      // Signal inventory to reload so changes are visible immediately
      onSyncComplete?.();
    } catch (e: any) {
      setFullSync(prev => ({ ...prev, state: 'error', errorMsg: e?.message ?? 'Sync failed' }));
    }
  }, [tenantId, fullSync.state, supabase]);

  const resetFullSync = useCallback(() => { setFullSync(EMPTY_EBAY_SYNC); setImgDownload({ state: 'idle', downloaded: 0, failed: 0, notFound: 0 }); }, []);

  const handleImageDownload = useCallback(async () => {
    if (imgDownload.state === 'running') return;
    setImgDownload({ state: 'running', downloaded: 0, failed: 0, notFound: 0 });
    try {
      const { data, error } = await supabase.functions.invoke('swish-image-download', {
        body: { tenantId, fixTitles: false },
      });
      if (error) {
        let msg = error.message ?? 'Unknown error';
        try { const t = await (error as any).context?.text?.(); if (t) { try { const p = JSON.parse(t); msg = p.error ?? t; } catch { msg = t; } } } catch {}
        const isReauth = msg.includes('re-authoris') || msg.includes('REQUIRES_REAUTH');
        setImgDownload({ state: 'error', downloaded: 0, failed: 0, notFound: 0, errorMsg: msg, requiresReauth: isReauth });
        return;
      }
      setImgDownload({
        state: 'done',
        downloaded: data?.imagesDownloaded ?? 0,
        failed: data?.imagesFailed ?? 0,
        notFound: data?.imagesNotFound ?? 0,
        requiresReauth: data?.requiresReauth ?? false,
      });
      onSyncComplete?.();
    } catch (e: any) {
      setImgDownload({ state: 'error', downloaded: 0, failed: 0, notFound: 0, errorMsg: e?.message ?? 'Download failed' });
    }
  }, [tenantId, imgDownload.state, supabase, onSyncComplete]);

  // ── Fix Blank Titles ────────────────────────────────────────────────────────
  const handleFixBlankTitles = useCallback(async () => {
    if (titleFix.state === 'running') return;
    setTitleFix({ state: 'running', current: 0, total: 0, fixed: 0, failed: 0 });

    try {
      // Find items with blank/very short titles that have a linked eBay listing
      const { data: itemRows, error: itemErr } = await supabase
        .from('items')
        .select('id, canonical_title')
        .eq('tenant_id', tenantId)
        .or('canonical_title.is.null,canonical_title.eq.,canonical_title.lt.5chars');

      // Use a manual filter since PostgREST doesn't support length() in .or() easily
      const { data: allItems, error: allErr } = await supabase
        .from('items')
        .select('id, canonical_title')
        .eq('tenant_id', tenantId);

      if (allErr) {
        setTitleFix(prev => ({ ...prev, state: 'error', errorMsg: allErr.message }));
        return;
      }

      const blankItems = (allItems ?? []).filter(
        i => !i.canonical_title || i.canonical_title.trim().length < 5
      );

      if (blankItems.length === 0) {
        setTitleFix({ state: 'done', current: 0, total: 0, fixed: 0, failed: 0 });
        return;
      }

      // Filter to only those with a linked eBay listing
      const itemIds = blankItems.map(i => i.id);
      const { data: listingRows } = await supabase
        .from('listings')
        .select('item_id, external_listing_id')
        .eq('tenant_id', tenantId)
        .eq('marketplace_id', 'ebay')
        .not('external_listing_id', 'is', null)
        .neq('external_listing_id', '')
        .in('item_id', itemIds);

      if (!listingRows?.length) {
        setTitleFix({ state: 'done', current: 0, total: 0, fixed: 0, failed: 0 });
        return;
      }

      // Deduplicate by item_id
      const seen = new Set<string>();
      const targets = listingRows.filter(r => {
        if (seen.has(r.item_id)) return false;
        seen.add(r.item_id);
        return true;
      });

      const total = targets.length;
      setTitleFix({ state: 'running', current: 0, total, fixed: 0, failed: 0 });

      let fixed = 0;
      let failed = 0;

      for (let i = 0; i < targets.length; i++) {
        const { item_id, external_listing_id } = targets[i];
        setTitleFix(prev => ({ ...prev, current: i + 1 }));

        try {
          const { data, error } = await supabase.functions.invoke('swish-ebay-browse', {
            body: { route: 'get_item_full', tenantId, ebayItemId: external_listing_id },
          });

          if (error || !data?.item?.title) {
            // Check for re-auth error
            let msg = error?.message ?? '';
            try { const t = await (error as any)?.context?.text?.(); if (t) msg = t; } catch {}
            if (msg.includes('re-authoris') || msg.includes('requiresReauth') || msg.includes('401')) {
              setTitleFix(prev => ({
                ...prev, state: 'error',
                errorMsg: 'eBay re-authorisation required',
                requiresReauth: true,
                failed: prev.failed + 1,
              }));
              return;
            }
            failed++;
            setTitleFix(prev => ({ ...prev, failed: prev.failed + 1 }));
            continue;
          }

          const newTitle = data.item.title.trim();
          if (newTitle.length >= 5) {
            await supabase
              .from('items')
              .update({ canonical_title: newTitle, updated_at: new Date().toISOString() })
              .eq('id', item_id);

            // Also update the listing title for consistency
            await supabase
              .from('listings')
              .update({ title: newTitle, updated_at: new Date().toISOString() })
              .eq('item_id', item_id)
              .eq('marketplace_id', 'ebay');

            fixed++;
            setTitleFix(prev => ({ ...prev, fixed }));
          } else {
            failed++;
            setTitleFix(prev => ({ ...prev, failed: prev.failed + 1 }));
          }
        } catch {
          failed++;
          setTitleFix(prev => ({ ...prev, failed: prev.failed + 1 }));
        }

        // 80ms delay to avoid rate limits
        await new Promise(r => setTimeout(r, 80));
      }

      setTitleFix({ state: 'done', current: total, total, fixed, failed });
    } catch (e: any) {
      setTitleFix(prev => ({ ...prev, state: 'error', errorMsg: e?.message ?? 'Title fix failed' }));
    }
  }, [tenantId, titleFix.state, supabase]);

  const resetTitleFix = useCallback(() =>
    setTitleFix({ state: 'idle', current: 0, total: 0, fixed: 0, failed: 0 })
  , []);

  // ── Sync All from eBay ──────────────────────────────────────────────────────
  const handleSyncAllFromEbay = useCallback(async () => {
    if (ebaySync.state === 'running') return;
    setEbaySync({ state: 'running', current: 0, total: 0, updated: 0, failed: 0 });

    try {
      // Fetch all listings with external eBay IDs
      const { data: listingRows, error: listErr } = await supabase
        .from('listings')
        .select('item_id, external_listing_id')
        .eq('tenant_id', tenantId)
        .eq('marketplace_id', 'ebay')
        .not('external_listing_id', 'is', null)
        .neq('external_listing_id', '');

      if (listErr || !listingRows?.length) {
        setEbaySync({ state: 'done', current: 0, total: 0, updated: 0, failed: 0 });
        return;
      }

      // Deduplicate by item_id (keep first listing per item)
      const seen = new Set<string>();
      const targets = listingRows.filter(r => {
        if (seen.has(r.item_id)) return false;
        seen.add(r.item_id);
        return true;
      });

      const total = targets.length;
      setEbaySync({ state: 'running', current: 0, total, updated: 0, failed: 0 });

      let updated = 0;
      let failed = 0;

      for (let i = 0; i < targets.length; i++) {
        const { item_id, external_listing_id } = targets[i];
        setEbaySync(prev => ({ ...prev, current: i + 1 }));

        try {
          const { data, error } = await supabase.functions.invoke('swish-ebay-browse', {
            body: { route: 'get_item_full', tenantId, ebayItemId: external_listing_id },
          });

          if (error || !data?.item) {
            failed++;
            // Check if it's a re-auth error
            let msg = error?.message ?? '';
            try { const t = await (error as any)?.context?.text?.(); if (t) msg = t; } catch {}
            if (msg.includes('re-authoris') || msg.includes('requiresReauth') || msg.includes('401')) {
              setEbaySync(prev => ({ ...prev, state: 'error', errorMsg: 'eBay re-authorisation required', requiresReauth: true, failed: prev.failed + 1 }));
              return;
            }
            continue;
          }

          const ebay = data.item;

          // Build attributes from item specifics
          const { data: itemRow } = await supabase
            .from('items')
            .select('attributes, ruler, denomination, year_made, country_of_origin, material, period, mint')
            .eq('id', item_id)
            .maybeSingle();

          const existingAttrs: Record<string, string> = itemRow?.attributes ?? {};
          const newAttributes: Record<string, string> = { ...existingAttrs };
          if (ebay.itemSpecifics) {
            for (const spec of ebay.itemSpecifics) {
              if (spec.name && spec.value) newAttributes[spec.name] = spec.value;
            }
          }
          if (ebay.conditionDisplayName) newAttributes['eBay Condition'] = ebay.conditionDisplayName;
          if (ebay.categoryName) newAttributes['eBay Category'] = ebay.categoryName;

          const findSpec = (names: string[]) => {
            if (!ebay.itemSpecifics) return '';
            for (const name of names) {
              const f = ebay.itemSpecifics.find((s: any) => s.name?.toLowerCase() === name.toLowerCase());
              if (f) return f.value;
            }
            return '';
          };

          const itemUpdates: Record<string, any> = { attributes: newAttributes, updated_at: new Date().toISOString() };

          if (ebay.description && ebay.description.trim().length > 5) itemUpdates.description = ebay.description;
          if (ebay.conditionDisplayName) itemUpdates.condition = ebay.conditionDisplayName;
          if (ebay.conditionDescription) itemUpdates.condition_notes = ebay.conditionDescription;
          if (ebay.quantity) itemUpdates.quantity = ebay.quantity;

          // Only fill coin fields if they're currently empty
          const ruler = findSpec(['Ruler', 'Monarch', 'Emperor', 'King']);
          if (ruler && !itemRow?.ruler) itemUpdates.ruler = ruler;
          const denomination = findSpec(['Denomination', 'Face Value', 'Value']);
          if (denomination && !itemRow?.denomination) itemUpdates.denomination = denomination;
          const yearMade = findSpec(['Year', 'Date', 'Year of Issue', 'Mint Year']);
          if (yearMade && !itemRow?.year_made) itemUpdates.year_made = yearMade;
          const countryOfOrigin = findSpec(['Country/Region of Manufacture', 'Country', 'Origin', 'Empire']);
          if (countryOfOrigin && !itemRow?.country_of_origin) itemUpdates.country_of_origin = countryOfOrigin;
          const material = findSpec(['Metal', 'Material', 'Composition']);
          if (material && !itemRow?.material) itemUpdates.material = material;
          const period = findSpec(['Era', 'Period', 'Dynasty']);
          if (period && !itemRow?.period) itemUpdates.period = period;
          const mint = findSpec(['Mint', 'Mint Mark']);
          if (mint && !itemRow?.mint) itemUpdates.mint = mint;

          await supabase.from('items').update(itemUpdates).eq('id', item_id);

          // Also refresh listing stats
          await supabase.from('listings').update({
            views: ebay.hitCount ?? undefined,
            watchers: ebay.watchCount ?? undefined,
            updated_at: new Date().toISOString(),
          }).eq('item_id', item_id).eq('marketplace_id', 'ebay');

          updated++;
          setEbaySync(prev => ({ ...prev, updated }));
        } catch {
          failed++;
          setEbaySync(prev => ({ ...prev, failed: prev.failed + 1 }));
        }

        // Small delay to avoid rate limits (100ms between calls)
        await new Promise(r => setTimeout(r, 100));
      }

      setEbaySync({ state: 'done', current: total, total, updated, failed });
    } catch (e: any) {
      setEbaySync(prev => ({ ...prev, state: 'error', errorMsg: e?.message ?? 'Sync failed' }));
    }
  }, [tenantId, ebaySync.state, supabase]);

  const resetEbaySync = useCallback(() =>
    setEbaySync({ state: 'idle', current: 0, total: 0, updated: 0, failed: 0 })
  , []);

  // ── Push All Updates to eBay ───────────────────────────────────────────────
  // Finds active listings where item.updated_at > listing.published_at,
  // meaning the SWISH item was edited after the listing was published.
  // Calls swish-ebay-list revise for each with latest item data + media.
  const handlePushAllToEbay = useCallback(async () => {
    if (pushAll.state === 'running') return;
    setPushAll({ state: 'running', current: 0, total: 0, updated: 0, skipped: 0, failed: 0 });

    try {
      // Fetch all active listings with their item data
      const { data: listingRows, error: listErr } = await supabase
        .from('listings')
        .select(`
          id, external_listing_id, item_id, price, published_at, title,
          items(
            id, canonical_title, description, condition, condition_grade,
            specialist_id, quantity, attributes, media, updated_at,
            country_of_origin, year_made, ruler, denomination, period, mint,
            material, manufacturer
          )
        `)
        .eq('tenant_id', tenantId)
        .eq('marketplace_id', 'ebay')
        .eq('status', 'active')
        .not('external_listing_id', 'is', null)
        .neq('external_listing_id', '');

      if (listErr || !listingRows?.length) {
        setPushAll({ state: 'done', current: 0, total: 0, updated: 0, skipped: 0, failed: 0 });
        return;
      }

      // Filter to listings where item was modified after it was published
      const stale = listingRows.filter(row => {
        const item = row.items as any;
        if (!item?.updated_at || !row.published_at) return false;
        return new Date(item.updated_at) > new Date(row.published_at);
      });

      const total = stale.length;
      setPushAll(prev => ({ ...prev, total, current: 0 }));

      if (total === 0) {
        setPushAll({ state: 'done', current: 0, total: 0, updated: 0, skipped: listingRows.length, failed: 0 });
        return;
      }

      let updated = 0;
      let failed = 0;

      for (let i = 0; i < stale.length; i++) {
        const row = stale[i];
        const item = row.items as any;
        setPushAll(prev => ({ ...prev, current: i + 1 }));

        try {
          // Build item specifics from attributes
          const attrs = item.attributes ?? {};
          const itemSpecifics: Array<{ name: string; value: string }> = [];
          for (const [key, val] of Object.entries(attrs)) {
            if (val !== null && val !== undefined && String(val).trim()) {
              const name = String(key).replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
              itemSpecifics.push({ name: name.slice(0, 65), value: String(val).slice(0, 65) });
            }
          }
          const coinSpecifics: Array<[string, string | undefined | null]> = [
            ['Country/Region of Manufacture', item.country_of_origin],
            ['Year', item.year_made],
            ['Ruler', item.ruler],
            ['Denomination', item.denomination],
            ['Period', item.period],
            ['Mint', item.mint],
            ['Material', item.material],
            ['Manufacturer', item.manufacturer],
          ];
          for (const [name, val] of coinSpecifics) {
            if (val && !itemSpecifics.find(s => s.name.toLowerCase() === name.toLowerCase())) {
              itemSpecifics.push({ name, value: String(val).slice(0, 65) });
            }
          }

          const mediaUrls = ((item.media ?? []) as string[]).filter(
            (u: string) => typeof u === 'string' && u.startsWith('https://')
          );

          const { data: result, error: fnErr } = await supabase.functions.invoke('swish-ebay-list', {
            body: {
              route: 'revise',
              tenantId,
              listingId: row.id,
              externalListingId: row.external_listing_id,
              title: (item.canonical_title ?? row.title ?? '').slice(0, 80),
              description: item.description ?? '',
              price: Number(row.price ?? 0),
              condition: item.condition ?? '',
              conditionDescription: item.condition_grade ?? '',
              listingType: 'FixedPriceItem',
              quantity: Math.max(1, Number(item.quantity ?? 1)),
              itemSpecifics,
              mediaUrls,
            },
          });

          if (fnErr || !result?.success) {
            failed++;
            setPushAll(prev => ({ ...prev, failed }));
          } else {
            updated++;
            setPushAll(prev => ({ ...prev, updated }));
          }
        } catch {
          failed++;
          setPushAll(prev => ({ ...prev, failed }));
        }

        // 300ms between calls to respect eBay rate limits
        await new Promise(r => setTimeout(r, 300));
      }

      setPushAll(prev => ({
        ...prev,
        state: 'done',
        current: total,
        updated,
        failed,
        skipped: listingRows.length - total,
      }));
    } catch (e: any) {
      setPushAll(prev => ({ ...prev, state: 'error', errorMsg: e?.message ?? 'Push failed' }));
    }
  }, [tenantId, pushAll.state, supabase]);

  const resetPushAll = useCallback(() =>
    setPushAll({ state: 'idle', current: 0, total: 0, updated: 0, skipped: 0, failed: 0 })
  , []);

  const handleRefetchImages = useCallback(async () => {
    if (syncProgress.state === 'running') return;
    setSyncProgress({ state: 'running' });
    try {
      const { data, error } = await supabase.functions.invoke('swish-image-download', {
        body: { tenantId, fixTitles: true },
      });

      if (error) {
        let msg = error.message ?? 'Unknown error';
        try {
          const text = await (error as any).context?.text?.();
          if (text) {
            try { const parsed = JSON.parse(text); msg = parsed.error ?? text; } catch { msg = text; }
          }
        } catch {}
        const isReauth = msg.includes('re-authoris') || msg.includes('requiresReauth') || msg.includes('401');
        setSyncProgress({ state: 'error', errorMsg: msg, requiresReauth: isReauth });
        return;
      }

      setSyncProgress({
        state: 'done',
        imagesDownloaded: data?.imagesDownloaded ?? 0,
        imagesFailed: data?.imagesFailed ?? 0,
        imagesNotFound: data?.imagesNotFound ?? 0,
        authFailures: data?.authFailures ?? 0,
        titlesFixed: data?.titlesFixed ?? 0,
        processed: data?.processed ?? 0,
        requiresReauth: data?.requiresReauth ?? false,
      });
      onSyncComplete?.();
    } catch (e: any) {
      setSyncProgress({ state: 'error', errorMsg: e?.message ?? 'Failed to run sync' });
    }
  }, [tenantId, syncProgress.state, supabase]);

  const reset = useCallback(() => setSyncProgress({ state: 'idle' }), []);

  const { state } = syncProgress;

  return (
    <View style={syncStyles.card}>

      {/* ── PRIMARY: Sync with eBay ── */}
      <View style={syncStyles.headerRow}>
        <View style={[syncStyles.iconWrap, { backgroundColor: '#E5323815' }]}>
          <MaterialIcons name="storefront" size={18} color="#E53238" />
        </View>
        <View style={syncStyles.flex}>
          <Text style={syncStyles.cardTitle}>Sync with eBay</Text>
          <Text style={syncStyles.cardDesc}>
            Fetches all eBay listings and updates titles, descriptions, images, item specifics, prices and status
          </Text>
        </View>
      </View>

      {fullSync.state === 'fetching' || fullSync.state === 'syncing' ? (
        <View style={syncStyles.ebaySyncWrap}>
          <View style={syncStyles.ebaySyncTopRow}>
            <ActivityIndicator size="small" color="#E53238" />
            <Text style={[syncStyles.ebaySyncText, { color: '#E53238' }]}>
              {fullSync.state === 'fetching' ? 'Fetching all eBay listings…' : `Syncing ${fullSync.current} / ${fullSync.total}…`}
            </Text>
          </View>
          {fullSync.total > 0 ? (
            <View style={syncStyles.ebaySyncBarTrack}>
              <View style={[syncStyles.ebaySyncBarFill, { width: `${Math.round((fullSync.current / fullSync.total) * 100)}%` as any, backgroundColor: '#E53238' }]} />
            </View>
          ) : null}
          <View style={syncStyles.ebaySyncStats}>
            {fullSync.updated > 0 ? <View style={syncStyles.ebaySyncStat}><MaterialIcons name="check-circle" size={12} color={Colors.success} /><Text style={[syncStyles.ebaySyncStatText, { color: Colors.success }]}>{fullSync.updated} updated</Text></View> : null}
            {fullSync.imagesFetched > 0 ? <View style={syncStyles.ebaySyncStat}><MaterialIcons name="photo-library" size={12} color={Colors.info} /><Text style={[syncStyles.ebaySyncStatText, { color: Colors.info }]}>{fullSync.imagesFetched} images</Text></View> : null}
            {fullSync.titlesFixed > 0 ? <View style={syncStyles.ebaySyncStat}><MaterialIcons name="title" size={12} color={Colors.warning} /><Text style={[syncStyles.ebaySyncStatText, { color: Colors.warning }]}>{fullSync.titlesFixed} titles</Text></View> : null}
            {fullSync.failed > 0 ? <View style={syncStyles.ebaySyncStat}><MaterialIcons name="error" size={12} color={Colors.danger} /><Text style={[syncStyles.ebaySyncStatText, { color: Colors.danger }]}>{fullSync.failed} failed</Text></View> : null}
          </View>
        </View>
      ) : fullSync.state === 'done' ? (
        <View style={syncStyles.ebaySyncResult}>
          {fullSync.requiresReauth ? (
            <Pressable onPress={() => router.push('/marketplaces' as any)} style={syncStyles.reauthBanner}>
              <MaterialIcons name="link-off" size={14} color={Colors.danger} />
              <Text style={syncStyles.reauthText}>eBay re-authorisation required — tap to reconnect</Text>
              <MaterialIcons name="chevron-right" size={14} color={Colors.danger} />
            </Pressable>
          ) : null}
          <View style={syncStyles.ebaySyncResultRow}>
            {([
              { icon: 'check-circle' as const, color: fullSync.updated > 0 ? Colors.success : Colors.textTertiary, label: 'Updated', value: fullSync.updated },
              { icon: 'photo-library' as const, color: fullSync.imagesFetched > 0 ? Colors.info : Colors.textTertiary, label: 'Images', value: fullSync.imagesFetched },
              { icon: 'title' as const, color: fullSync.titlesFixed > 0 ? Colors.warning : Colors.textTertiary, label: 'Titles', value: fullSync.titlesFixed },
              { icon: 'error-outline' as const, color: fullSync.failed > 0 ? Colors.danger : Colors.textTertiary, label: 'Failed', value: fullSync.failed },
            ]).map(m => (
              <View key={m.label} style={syncStyles.metric}>
                <MaterialIcons name={m.icon} size={16} color={m.color} />
                <Text style={[syncStyles.metricValue, { color: m.color }]}>{m.value}</Text>
                <Text style={syncStyles.metricLabel}>{m.label}</Text>
              </View>
            ))}
          </View>
          {fullSync.totalEbayListings > 0 ? (
            <Text style={[syncStyles.cardDesc, { textAlign: 'center', paddingHorizontal: Spacing.sm }]}>
              {fullSync.totalEbayListings} eBay listings found · {fullSync.processed} matched to SWISH
              {fullSync.orphansFixed > 0 ? ` · ${fullSync.orphansFixed} ended listings fixed` : ''}
            </Text>
          ) : null}
          {(fullSync.failedEbayIds ?? []).length > 0 ? (
            <View style={syncStyles.errorWrap}>
              <MaterialIcons name="warning" size={12} color={Colors.warning} />
              <Text style={syncStyles.errorText} numberOfLines={2}>Failed IDs: {fullSync.failedEbayIds!.slice(0, 5).join(', ')}{fullSync.failedEbayIds!.length > 5 ? '...' : ''}</Text>
            </View>
          ) : null}
          {/* Download Images to Storage — second phase after sync */}
          {imgDownload.state === 'idle' ? (
            <Pressable onPress={handleImageDownload} style={({ pressed }) => [syncStyles.btn, { backgroundColor: Colors.info }, pressed && { opacity: 0.8 }]}>
              <MaterialIcons name="cloud-download" size={15} color={Colors.background} />
              <Text style={syncStyles.btnText}>Download Images to Storage</Text>
            </Pressable>
          ) : imgDownload.state === 'running' ? (
            <View style={[syncStyles.btn, { backgroundColor: Colors.info, opacity: 0.75 }]}>
              <ActivityIndicator size="small" color={Colors.background} style={{ width: 15, height: 15 }} />
              <Text style={syncStyles.btnText}>Downloading images…</Text>
            </View>
          ) : imgDownload.state === 'done' ? (
            <View style={syncStyles.imgDownloadResult}>
              {imgDownload.requiresReauth ? (
                <Pressable onPress={() => router.push('/marketplaces' as any)} style={syncStyles.reauthBanner}>
                  <MaterialIcons name="link-off" size={12} color={Colors.danger} />
                  <Text style={syncStyles.reauthText}>eBay re-authorisation required</Text>
                  <MaterialIcons name="chevron-right" size={12} color={Colors.danger} />
                </Pressable>
              ) : null}
              <View style={syncStyles.imgDownloadRow}>
                <View style={syncStyles.metric}><MaterialIcons name="check-circle" size={14} color={imgDownload.downloaded > 0 ? Colors.success : Colors.textTertiary} /><Text style={[syncStyles.metricValue, { color: imgDownload.downloaded > 0 ? Colors.success : Colors.textTertiary, fontSize: Typography.size.base }]}>{imgDownload.downloaded}</Text><Text style={syncStyles.metricLabel}>Saved</Text></View>
                <View style={syncStyles.metric}><MaterialIcons name="search-off" size={14} color={Colors.textTertiary} /><Text style={[syncStyles.metricValue, { color: Colors.textTertiary, fontSize: Typography.size.base }]}>{imgDownload.notFound}</Text><Text style={syncStyles.metricLabel}>Not Found</Text></View>
                <View style={syncStyles.metric}><MaterialIcons name="error-outline" size={14} color={imgDownload.failed > 0 ? Colors.danger : Colors.textTertiary} /><Text style={[syncStyles.metricValue, { color: imgDownload.failed > 0 ? Colors.danger : Colors.textTertiary, fontSize: Typography.size.base }]}>{imgDownload.failed}</Text><Text style={syncStyles.metricLabel}>Failed</Text></View>
              </View>
              <Text style={[syncStyles.cardDesc, { textAlign: 'center' }]}>Images permanently stored in Supabase Storage</Text>
            </View>
          ) : imgDownload.state === 'error' ? (
            <View style={syncStyles.errorWrap}>
              <MaterialIcons name="error" size={13} color={Colors.danger} />
              <Text style={syncStyles.errorText} numberOfLines={2}>{imgDownload.errorMsg}</Text>
              <Pressable onPress={() => setImgDownload({ state: 'idle', downloaded: 0, failed: 0, notFound: 0 })} hitSlop={8}>
                <Text style={syncStyles.retryText}>Retry</Text>
              </Pressable>
            </View>
          ) : null}
          <View style={{ flexDirection: 'row', gap: Spacing.sm, justifyContent: 'center' }}>
            <Pressable onPress={resetFullSync} style={syncStyles.dismissBtn} hitSlop={8}><Text style={syncStyles.dismissText}>Dismiss</Text></Pressable>
            {fullSync.failed > 0 ? (
              <Pressable onPress={() => handleFullEbaySync('full')} style={syncStyles.dismissBtn} hitSlop={8}>
                <Text style={[syncStyles.dismissText, { color: '#E53238' }]}>Retry Failed</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : fullSync.state === 'error' ? (
        <View style={syncStyles.errorWrap}>
          <MaterialIcons name="error" size={14} color={Colors.danger} />
          <Text style={syncStyles.errorText} numberOfLines={3}>{fullSync.errorMsg}</Text>
          {fullSync.requiresReauth ? (
            <Pressable onPress={() => router.push('/marketplaces' as any)} hitSlop={8}>
              <Text style={syncStyles.reconnectText}>Reconnect</Text>
            </Pressable>
          ) : (
            <Pressable onPress={resetFullSync} hitSlop={8}>
              <Text style={syncStyles.retryText}>Retry</Text>
            </Pressable>
          )}
        </View>
      ) : null}

      {fullSync.state === 'idle' || fullSync.state === 'error' ? (
        <View style={{ gap: Spacing.xs }}>
          <Pressable onPress={() => handleFullEbaySync('full')} style={({ pressed }) => [syncStyles.btn, { backgroundColor: '#E53238' }, pressed && { opacity: 0.8 }]}>
            <MaterialIcons name="sync" size={16} color={Colors.background} />
            <Text style={syncStyles.btnText}>Sync with eBay</Text>
          </Pressable>
          <View style={{ flexDirection: 'row', gap: Spacing.xs }}>
            <Pressable onPress={() => handleFullEbaySync('images_only')} style={({ pressed }) => [syncStyles.btn, { flex: 1, backgroundColor: Colors.info }, pressed && { opacity: 0.8 }]}>
              <MaterialIcons name="photo-library" size={14} color={Colors.background} />
              <Text style={[syncStyles.btnText, { fontSize: 11 }]}>Images Only</Text>
            </Pressable>
            <Pressable onPress={() => handleFullEbaySync('data_only')} style={({ pressed }) => [syncStyles.btn, { flex: 1, backgroundColor: Colors.accent }, pressed && { opacity: 0.8 }]}>
              <MaterialIcons name="description" size={14} color={Colors.background} />
              <Text style={[syncStyles.btnText, { fontSize: 11 }]}>Data Only</Text>
            </Pressable>
          </View>
        </View>
      ) : (fullSync.state === 'fetching' || fullSync.state === 'syncing') ? (
        <View style={[syncStyles.btn, { backgroundColor: '#E53238' }, syncStyles.btnRunning]}>
          <ActivityIndicator size="small" color={Colors.background} style={{ width: 16, height: 16 }} />
          <Text style={syncStyles.btnText}>{fullSync.state === 'fetching' ? 'Fetching listings...' : `Syncing...`}</Text>
        </View>
      ) : null}

      <View style={syncStyles.divider} />
      {/* Header row */}
      <View style={syncStyles.headerRow}>
        <View style={syncStyles.iconWrap}>
          <MaterialIcons name="cloud-download" size={18} color={Colors.info} />
        </View>
        <View style={syncStyles.flex}>
          <Text style={syncStyles.cardTitle}>Image &amp; Title Repair</Text>
          <Text style={syncStyles.cardDesc}>
            Re-downloads all eBay images and fixes blank titles for your entire inventory
          </Text>
        </View>
      </View>

      {/* Progress / result area */}
      {state === 'running' ? (
        <View style={syncStyles.progressWrap}>
          <ActivityIndicator size="small" color={Colors.info} />
          <Text style={syncStyles.progressText}>Downloading images from eBay...</Text>
          <Text style={syncStyles.progressSub}>This may take a minute for large inventories</Text>
        </View>
      ) : state === 'done' ? (
        <View style={syncStyles.resultWrap}>
          {syncProgress.requiresReauth ? (
            <Pressable onPress={() => router.push('/marketplaces' as any)} style={syncStyles.reauthBanner}>
              <MaterialIcons name="link-off" size={14} color={Colors.danger} />
              <Text style={syncStyles.reauthText}>eBay re-authorisation required — tap to reconnect</Text>
              <MaterialIcons name="chevron-right" size={14} color={Colors.danger} />
            </Pressable>
          ) : null}
          <View style={syncStyles.resultRow}>
            {([
              { icon: 'check-circle', color: Colors.success, label: 'Downloaded', value: syncProgress.imagesDownloaded ?? 0 },
              { icon: 'search-off', color: Colors.textTertiary, label: 'Not Found', value: syncProgress.imagesNotFound ?? 0 },
              { icon: 'title', color: Colors.accent, label: 'Titles Fixed', value: syncProgress.titlesFixed ?? 0 },
            ] as const).map(m => (
              <View key={m.label} style={syncStyles.metric}>
                <MaterialIcons name={m.icon as any} size={16} color={m.color} />
                <Text style={[syncStyles.metricValue, { color: m.color }]}>{m.value}</Text>
                <Text style={syncStyles.metricLabel}>{m.label}</Text>
              </View>
            ))}
          </View>
          {(syncProgress.authFailures ?? 0) > 0 ? (
            <Text style={syncStyles.authNote}>
              {syncProgress.authFailures} eBay auth failure{syncProgress.authFailures === 1 ? '' : 's'} — reconnect eBay in Marketplaces
            </Text>
          ) : null}
          <Pressable onPress={reset} style={syncStyles.dismissBtn} hitSlop={8}>
            <Text style={syncStyles.dismissText}>Dismiss</Text>
          </Pressable>
        </View>
      ) : state === 'error' ? (
        <View style={syncStyles.errorWrap}>
          <MaterialIcons name="error" size={14} color={Colors.danger} />
          <Text style={syncStyles.errorText} numberOfLines={3}>{syncProgress.errorMsg}</Text>
          {syncProgress.requiresReauth ? (
            <Pressable onPress={() => router.push('/marketplaces' as any)} hitSlop={8}>
              <Text style={syncStyles.reconnectText}>Reconnect</Text>
            </Pressable>
          ) : (
            <Pressable onPress={reset} hitSlop={8}>
              <Text style={syncStyles.retryText}>Retry</Text>
            </Pressable>
          )}
        </View>
      ) : null}

      {/* Action button — Re-fetch Images */}
      {state === 'idle' || state === 'error' ? (
        <Pressable
          onPress={handleRefetchImages}
          style={({ pressed }) => [syncStyles.btn, pressed && { opacity: 0.8 }]}
        >
          <MaterialIcons name="refresh" size={16} color={Colors.background} />
          <Text style={syncStyles.btnText}>Re-fetch All Images</Text>
        </Pressable>
      ) : state === 'running' ? (
        <View style={[syncStyles.btn, syncStyles.btnRunning]}>
          <ActivityIndicator size="small" color={Colors.background} style={{ width: 16, height: 16 }} />
          <Text style={syncStyles.btnText}>Running...</Text>
        </View>
      ) : null}

      {/* ── Repair Partial Images ── */}
      <View style={syncStyles.divider} />
      <View style={syncStyles.headerRow}>
        <View style={[syncStyles.iconWrap, { backgroundColor: Colors.warning + '20' }]}>
          <MaterialIcons name="broken-image" size={18} color={Colors.warning} />
        </View>
        <View style={syncStyles.flex}>
          <Text style={syncStyles.cardTitle}>Repair Partial Images</Text>
          <Text style={syncStyles.cardDesc}>
            Finds items where eBay has more images than are stored in SWISH and downloads the missing ones
          </Text>
        </View>
      </View>

      {/* Partial count status */}
      {repairPartial.checkState === 'checking' ? (
        <View style={syncStyles.partialCheckRow}>
          <ActivityIndicator size="small" color={Colors.warning} style={{ width: 14, height: 14 }} />
          <Text style={[syncStyles.cardDesc, { color: Colors.warning }]}>Checking inventory...</Text>
        </View>
      ) : (repairPartial.checkState === 'ready' || repairPartial.checkState === 'running') ? (
        <View style={[
          syncStyles.partialCheckRow,
          {
            borderRadius: Radius.md, padding: Spacing.md, borderWidth: 1,
            backgroundColor: repairPartial.count > 0 ? Colors.warning + '15' : Colors.successDim,
            borderColor: repairPartial.count > 0 ? Colors.warning + '40' : Colors.success + '40',
          },
        ]}>
          <MaterialIcons
            name={repairPartial.count > 0 ? 'warning' : 'check-circle'}
            size={14}
            color={repairPartial.count > 0 ? Colors.warning : Colors.success}
          />
          <Text style={[
            syncStyles.cardDesc,
            { flex: 1, fontWeight: Typography.weight.semibold,
              color: repairPartial.count > 0 ? Colors.warning : Colors.success },
          ]}>
            {repairPartial.count > 0
              ? `${repairPartial.count} item${repairPartial.count === 1 ? ' has' : 's have'} incomplete image sets`
              : 'All tracked image sets are complete'}
          </Text>
          {repairPartial.checkState !== 'running' ? (
            <Pressable onPress={handleCheckPartial} hitSlop={8}>
              <MaterialIcons name="refresh" size={13} color={Colors.textTertiary} />
            </Pressable>
          ) : null}
        </View>
      ) : repairPartial.checkState === 'done' ? (
        <View style={syncStyles.ebaySyncResult}>
          {repairPartial.requiresReauth ? (
            <Pressable onPress={() => router.push('/marketplaces' as any)} style={syncStyles.reauthBanner}>
              <MaterialIcons name="link-off" size={12} color={Colors.danger} />
              <Text style={syncStyles.reauthText}>eBay re-authorisation required</Text>
              <MaterialIcons name="chevron-right" size={12} color={Colors.danger} />
            </Pressable>
          ) : null}
          <View style={syncStyles.ebaySyncResultRow}>
            {([
              { icon: 'check-circle' as const, color: repairPartial.downloaded > 0 ? Colors.success : Colors.textTertiary, label: 'Repaired', value: repairPartial.downloaded },
              { icon: 'error-outline' as const, color: repairPartial.failed > 0 ? Colors.danger : Colors.textTertiary, label: 'Failed', value: repairPartial.failed },
            ]).map(m => (
              <View key={m.label} style={syncStyles.metric}>
                <MaterialIcons name={m.icon} size={16} color={m.color} />
                <Text style={[syncStyles.metricValue, { color: m.color }]}>{m.value}</Text>
                <Text style={syncStyles.metricLabel}>{m.label}</Text>
              </View>
            ))}
          </View>
          {repairPartial.downloaded > 0 ? (
            <Text style={[syncStyles.cardDesc, { textAlign: 'center' }]}>
              {repairPartial.downloaded} missing image{repairPartial.downloaded === 1 ? '' : 's'} permanently stored
            </Text>
          ) : null}
          <Pressable onPress={resetRepairPartial} style={syncStyles.dismissBtn} hitSlop={8}>
            <Text style={syncStyles.dismissText}>Dismiss</Text>
          </Pressable>
        </View>
      ) : repairPartial.checkState === 'error' ? (
        <View style={syncStyles.errorWrap}>
          <MaterialIcons name="error" size={14} color={Colors.danger} />
          <Text style={syncStyles.errorText} numberOfLines={2}>{repairPartial.errorMsg}</Text>
          <Pressable onPress={resetRepairPartial} hitSlop={8}>
            <Text style={syncStyles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : null}

      {/* Repair / check buttons */}
      {repairPartial.checkState === 'ready' && repairPartial.count > 0 ? (
        <Pressable
          onPress={handleRepairPartial}
          style={({ pressed }) => [syncStyles.btn, { backgroundColor: Colors.warning }, pressed && { opacity: 0.8 }]}
        >
          <MaterialIcons name="build" size={16} color={Colors.background} />
          <Text style={syncStyles.btnText}>
            Repair {repairPartial.count} Incomplete Item{repairPartial.count === 1 ? '' : 's'}
          </Text>
        </Pressable>
      ) : repairPartial.checkState === 'running' ? (
        <View style={[syncStyles.btn, { backgroundColor: Colors.warning }, syncStyles.btnRunning]}>
          <ActivityIndicator size="small" color={Colors.background} style={{ width: 16, height: 16 }} />
          <Text style={syncStyles.btnText}>Downloading missing images...</Text>
        </View>
      ) : repairPartial.checkState === 'idle' ? (
        <Pressable
          onPress={handleCheckPartial}
          style={({ pressed }) => [syncStyles.btn, { backgroundColor: Colors.surfaceElevated, borderWidth: 1, borderColor: Colors.surfaceBorder }, pressed && { opacity: 0.8 }]}
        >
          <MaterialIcons name="search" size={16} color={Colors.textSecondary} />
          <Text style={[syncStyles.btnText, { color: Colors.textSecondary }]}>Check for Partial Images</Text>
        </Pressable>
      ) : null}

      {/* ── Fix Blank Titles ── */}
      <View style={syncStyles.divider} />
      <View style={syncStyles.headerRow}>
        <View style={[syncStyles.iconWrap, { backgroundColor: Colors.warning + '20' }]}>
          <MaterialIcons name="title" size={18} color={Colors.warning} />
        </View>
        <View style={syncStyles.flex}>
          <Text style={syncStyles.cardTitle}>Fix Blank Titles</Text>
          <Text style={syncStyles.cardDesc}>
            Finds items with missing or very short titles and fetches the correct title from eBay
          </Text>
        </View>
      </View>

      {/* Title fix progress */}
      {titleFix.state === 'running' ? (
        <View style={syncStyles.ebaySyncWrap}>
          <View style={syncStyles.ebaySyncTopRow}>
            <ActivityIndicator size="small" color={Colors.warning} />
            <Text style={[syncStyles.ebaySyncText, { color: Colors.warning }]}>
              {titleFix.total > 0
                ? `Fixing ${titleFix.current} / ${titleFix.total}...`
                : 'Scanning inventory...'}
            </Text>
          </View>
          {titleFix.total > 0 ? (
            <View style={syncStyles.ebaySyncBarTrack}>
              <View
                style={[syncStyles.ebaySyncBarFill, {
                  width: `${Math.round((titleFix.current / titleFix.total) * 100)}%` as any,
                  backgroundColor: Colors.warning,
                }]}
              />
            </View>
          ) : null}
          <View style={syncStyles.ebaySyncStats}>
            <View style={syncStyles.ebaySyncStat}>
              <MaterialIcons name="check-circle" size={12} color={Colors.success} />
              <Text style={[syncStyles.ebaySyncStatText, { color: Colors.success }]}>{titleFix.fixed} fixed</Text>
            </View>
            {titleFix.failed > 0 ? (
              <View style={syncStyles.ebaySyncStat}>
                <MaterialIcons name="error" size={12} color={Colors.danger} />
                <Text style={[syncStyles.ebaySyncStatText, { color: Colors.danger }]}>{titleFix.failed} failed</Text>
              </View>
            ) : null}
          </View>
        </View>
      ) : titleFix.state === 'done' ? (
        <View style={syncStyles.ebaySyncResult}>
          {titleFix.requiresReauth ? (
            <Pressable onPress={() => router.push('/marketplaces' as any)} style={syncStyles.reauthBanner}>
              <MaterialIcons name="link-off" size={14} color={Colors.danger} />
              <Text style={syncStyles.reauthText}>eBay re-authorisation required — tap to reconnect</Text>
              <MaterialIcons name="chevron-right" size={14} color={Colors.danger} />
            </Pressable>
          ) : null}
          <View style={syncStyles.ebaySyncResultRow}>
            {([
              { icon: 'title' as const, color: titleFix.fixed > 0 ? Colors.success : Colors.textTertiary, label: 'Fixed', value: titleFix.fixed },
              { icon: 'error-outline' as const, color: titleFix.failed > 0 ? Colors.danger : Colors.textTertiary, label: 'Failed', value: titleFix.failed },
              { icon: 'storage' as const, color: Colors.warning, label: 'Scanned', value: titleFix.total },
            ]).map(m => (
              <View key={m.label} style={syncStyles.metric}>
                <MaterialIcons name={m.icon} size={16} color={m.color} />
                <Text style={[syncStyles.metricValue, { color: m.color }]}>{m.value}</Text>
                <Text style={syncStyles.metricLabel}>{m.label}</Text>
              </View>
            ))}
          </View>
          {titleFix.fixed === 0 && titleFix.total === 0 ? (
            <Text style={[syncStyles.cardDesc, { textAlign: 'center' }]}>All titles look good — nothing to fix</Text>
          ) : null}
          <Pressable onPress={resetTitleFix} style={syncStyles.dismissBtn} hitSlop={8}>
            <Text style={syncStyles.dismissText}>Dismiss</Text>
          </Pressable>
        </View>
      ) : titleFix.state === 'error' ? (
        <View style={syncStyles.errorWrap}>
          <MaterialIcons name="error" size={14} color={Colors.danger} />
          <Text style={syncStyles.errorText} numberOfLines={2}>{titleFix.errorMsg}</Text>
          {titleFix.requiresReauth ? (
            <Pressable onPress={() => router.push('/marketplaces' as any)} hitSlop={8}>
              <Text style={syncStyles.reconnectText}>Reconnect</Text>
            </Pressable>
          ) : (
            <Pressable onPress={resetTitleFix} hitSlop={8}>
              <Text style={syncStyles.retryText}>Retry</Text>
            </Pressable>
          )}
        </View>
      ) : null}

      {/* Fix Titles button */}
      {titleFix.state === 'idle' || titleFix.state === 'error' ? (
        <Pressable
          onPress={handleFixBlankTitles}
          style={({ pressed }) => [syncStyles.btn, { backgroundColor: Colors.warning }, pressed && { opacity: 0.8 }]}
        >
          <MaterialIcons name="title" size={16} color={Colors.background} />
          <Text style={syncStyles.btnText}>Fix Blank Titles</Text>
        </Pressable>
      ) : titleFix.state === 'running' ? (
        <View style={[syncStyles.btn, { backgroundColor: Colors.warning }, syncStyles.btnRunning]}>
          <ActivityIndicator size="small" color={Colors.background} style={{ width: 16, height: 16 }} />
          <Text style={syncStyles.btnText}>Fixing {titleFix.current}/{titleFix.total}...</Text>
        </View>
      ) : null}

      {/* ── Sync All from eBay ── */}
      <View style={syncStyles.divider} />
      <View style={syncStyles.headerRow}>
        <View style={[syncStyles.iconWrap, { backgroundColor: Colors.accent + '20' }]}>
          <MaterialIcons name="sync" size={18} color={Colors.accent} />
        </View>
        <View style={syncStyles.flex}>
          <Text style={syncStyles.cardTitle}>Sync All from eBay</Text>
          <Text style={syncStyles.cardDesc}>
            Updates description, condition, item specifics and coin fields for every linked eBay listing
          </Text>
        </View>
      </View>

      {/* eBay sync progress */}
      {ebaySync.state === 'running' ? (
        <View style={syncStyles.ebaySyncWrap}>
          <View style={syncStyles.ebaySyncTopRow}>
            <ActivityIndicator size="small" color={Colors.accent} />
            <Text style={syncStyles.ebaySyncText}>
              {ebaySync.total > 0
                ? `Syncing ${ebaySync.current} / ${ebaySync.total}...`
                : 'Loading listings...'}
            </Text>
          </View>
          {ebaySync.total > 0 ? (
            <View style={syncStyles.ebaySyncBarTrack}>
              <View
                style={[syncStyles.ebaySyncBarFill, {
                  width: `${Math.round((ebaySync.current / ebaySync.total) * 100)}%` as any,
                }]}
              />
            </View>
          ) : null}
          <View style={syncStyles.ebaySyncStats}>
            <View style={syncStyles.ebaySyncStat}>
              <MaterialIcons name="check-circle" size={12} color={Colors.success} />
              <Text style={[syncStyles.ebaySyncStatText, { color: Colors.success }]}>{ebaySync.updated} updated</Text>
            </View>
            {ebaySync.failed > 0 ? (
              <View style={syncStyles.ebaySyncStat}>
                <MaterialIcons name="error" size={12} color={Colors.danger} />
                <Text style={[syncStyles.ebaySyncStatText, { color: Colors.danger }]}>{ebaySync.failed} failed</Text>
              </View>
            ) : null}
          </View>
        </View>
      ) : ebaySync.state === 'done' ? (
        <View style={syncStyles.ebaySyncResult}>
          <View style={syncStyles.ebaySyncResultRow}>
            {([
              { icon: 'check-circle' as const, color: Colors.success, label: 'Updated', value: ebaySync.updated },
              { icon: 'error-outline' as const, color: ebaySync.failed > 0 ? Colors.danger : Colors.textTertiary, label: 'Failed', value: ebaySync.failed },
              { icon: 'storage' as const, color: Colors.accent, label: 'Total', value: ebaySync.total },
            ]).map(m => (
              <View key={m.label} style={syncStyles.metric}>
                <MaterialIcons name={m.icon} size={16} color={m.color} />
                <Text style={[syncStyles.metricValue, { color: m.color }]}>{m.value}</Text>
                <Text style={syncStyles.metricLabel}>{m.label}</Text>
              </View>
            ))}
          </View>
          <Pressable onPress={resetEbaySync} style={syncStyles.dismissBtn} hitSlop={8}>
            <Text style={syncStyles.dismissText}>Dismiss</Text>
          </Pressable>
        </View>
      ) : ebaySync.state === 'error' ? (
        <View style={syncStyles.errorWrap}>
          <MaterialIcons name="error" size={14} color={Colors.danger} />
          <Text style={syncStyles.errorText} numberOfLines={2}>{ebaySync.errorMsg}</Text>
          {ebaySync.requiresReauth ? (
            <Pressable onPress={() => router.push('/marketplaces' as any)} hitSlop={8}>
              <Text style={syncStyles.reconnectText}>Reconnect</Text>
            </Pressable>
          ) : (
            <Pressable onPress={resetEbaySync} hitSlop={8}>
              <Text style={syncStyles.retryText}>Retry</Text>
            </Pressable>
          )}
        </View>
      ) : null}

      {/* Sync All button */}
      {ebaySync.state === 'idle' || ebaySync.state === 'error' ? (
        <Pressable
          onPress={handleSyncAllFromEbay}
          style={({ pressed }) => [syncStyles.btn, { backgroundColor: Colors.accent }, pressed && { opacity: 0.8 }]}
        >
          <MaterialIcons name="cloud-sync" size={16} color={Colors.background} />
          <Text style={syncStyles.btnText}>Sync All from eBay</Text>
        </Pressable>
      ) : ebaySync.state === 'running' ? (
        <View style={[syncStyles.btn, { backgroundColor: Colors.accent }, syncStyles.btnRunning]}>
          <ActivityIndicator size="small" color={Colors.background} style={{ width: 16, height: 16 }} />
          <Text style={syncStyles.btnText}>Syncing {ebaySync.current}/{ebaySync.total}...</Text>
        </View>
      ) : null}

      {/* ── Push All Updates to eBay ── */}
      <View style={syncStyles.divider} />
      <View style={syncStyles.headerRow}>
        <View style={[syncStyles.iconWrap, { backgroundColor: Colors.success + '20' }]}>
          <MaterialIcons name="cloud-upload" size={18} color={Colors.success} />
        </View>
        <View style={syncStyles.flex}>
          <Text style={syncStyles.cardTitle}>Push All Updates to eBay</Text>
          <Text style={syncStyles.cardDesc}>
            Finds active listings where the SWISH item was edited after publishing and pushes the latest data (title, description, photos, item specifics) to eBay
          </Text>
        </View>
      </View>

      {/* Push All progress */}
      {pushAll.state === 'running' ? (
        <View style={syncStyles.ebaySyncWrap}>
          <View style={syncStyles.ebaySyncTopRow}>
            <ActivityIndicator size="small" color={Colors.success} />
            <Text style={[syncStyles.ebaySyncText, { color: Colors.success }]}>
              {pushAll.total > 0
                ? `Pushing ${pushAll.current} / ${pushAll.total} listings…`
                : 'Scanning for stale listings…'}
            </Text>
          </View>
          {pushAll.total > 0 ? (
            <View style={syncStyles.ebaySyncBarTrack}>
              <View
                style={[syncStyles.ebaySyncBarFill, {
                  width: `${Math.round((pushAll.current / pushAll.total) * 100)}%` as any,
                  backgroundColor: Colors.success,
                }]}
              />
            </View>
          ) : null}
          <View style={syncStyles.ebaySyncStats}>
            <View style={syncStyles.ebaySyncStat}>
              <MaterialIcons name="check-circle" size={12} color={Colors.success} />
              <Text style={[syncStyles.ebaySyncStatText, { color: Colors.success }]}>{pushAll.updated} updated</Text>
            </View>
            {pushAll.failed > 0 ? (
              <View style={syncStyles.ebaySyncStat}>
                <MaterialIcons name="error" size={12} color={Colors.danger} />
                <Text style={[syncStyles.ebaySyncStatText, { color: Colors.danger }]}>{pushAll.failed} failed</Text>
              </View>
            ) : null}
          </View>
        </View>
      ) : pushAll.state === 'done' ? (
        <View style={syncStyles.ebaySyncResult}>
          <View style={syncStyles.ebaySyncResultRow}>
            {([
              { icon: 'cloud-upload' as const, color: pushAll.updated > 0 ? Colors.success : Colors.textTertiary, label: 'Pushed', value: pushAll.updated },
              { icon: 'skip-next' as const, color: Colors.textTertiary, label: 'Up-to-date', value: pushAll.skipped },
              { icon: 'error-outline' as const, color: pushAll.failed > 0 ? Colors.danger : Colors.textTertiary, label: 'Failed', value: pushAll.failed },
            ]).map(m => (
              <View key={m.label} style={syncStyles.metric}>
                <MaterialIcons name={m.icon} size={16} color={m.color} />
                <Text style={[syncStyles.metricValue, { color: m.color }]}>{m.value}</Text>
                <Text style={syncStyles.metricLabel}>{m.label}</Text>
              </View>
            ))}
          </View>
          {pushAll.updated === 0 && pushAll.skipped > 0 ? (
            <Text style={[syncStyles.cardDesc, { textAlign: 'center' }]}>
              All {pushAll.skipped} active listing{pushAll.skipped !== 1 ? 's' : ''} already up-to-date on eBay
            </Text>
          ) : pushAll.updated > 0 ? (
            <Text style={[syncStyles.cardDesc, { textAlign: 'center' }]}>
              {pushAll.updated} listing{pushAll.updated !== 1 ? 's' : ''} updated on eBay
              {pushAll.skipped > 0 ? ` · ${pushAll.skipped} already current` : ''}
            </Text>
          ) : null}
          <Pressable onPress={resetPushAll} style={syncStyles.dismissBtn} hitSlop={8}>
            <Text style={syncStyles.dismissText}>Dismiss</Text>
          </Pressable>
        </View>
      ) : pushAll.state === 'error' ? (
        <View style={syncStyles.errorWrap}>
          <MaterialIcons name="error" size={14} color={Colors.danger} />
          <Text style={syncStyles.errorText} numberOfLines={2}>{pushAll.errorMsg}</Text>
          <Pressable onPress={resetPushAll} hitSlop={8}>
            <Text style={syncStyles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : null}

      {/* Push All button */}
      {pushAll.state === 'idle' || pushAll.state === 'error' ? (
        <Pressable
          onPress={handlePushAllToEbay}
          style={({ pressed }) => [syncStyles.btn, { backgroundColor: Colors.success }, pressed && { opacity: 0.8 }]}
        >
          <MaterialIcons name="cloud-upload" size={16} color={Colors.background} />
          <Text style={syncStyles.btnText}>Push All Updates to eBay</Text>
        </Pressable>
      ) : pushAll.state === 'running' ? (
        <View style={[syncStyles.btn, { backgroundColor: Colors.success }, syncStyles.btnRunning]}>
          <ActivityIndicator size="small" color={Colors.background} style={{ width: 16, height: 16 }} />
          <Text style={syncStyles.btnText}>
            {pushAll.total > 0
              ? `${pushAll.updated + pushAll.failed}/${pushAll.total} listings updated`
              : 'Scanning...'}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const syncStyles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    marginHorizontal: Spacing.base,
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    overflow: 'hidden',
    ...Shadow.sm,
    gap: Spacing.md,
    padding: Spacing.base,
  },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md },
  iconWrap: {
    width: 36, height: 36, borderRadius: Radius.sm,
    backgroundColor: Colors.info + '20',
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  flex: { flex: 1 },
  cardTitle: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.textPrimary },
  cardDesc: { fontSize: Typography.size.xs, color: Colors.textTertiary, marginTop: 2, lineHeight: 16 },

  progressWrap: { alignItems: 'center', gap: Spacing.xs, paddingVertical: Spacing.sm },
  progressText: { fontSize: Typography.size.sm, color: Colors.info, fontWeight: Typography.weight.medium },
  progressSub: { fontSize: Typography.size.xs, color: Colors.textTertiary },

  resultWrap: { gap: Spacing.sm },
  reauthBanner: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.dangerDim, borderRadius: Radius.md, padding: Spacing.sm,
    borderWidth: 1, borderColor: Colors.danger + '40',
  },
  reauthText: { flex: 1, fontSize: Typography.size.xs, color: Colors.danger, lineHeight: 16 },
  authNote: { fontSize: Typography.size.xs, color: Colors.warning, textAlign: 'center' },
  resultRow: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: Spacing.xs },
  metric: { alignItems: 'center', gap: 4 },
  metricValue: { fontSize: Typography.size.lg, fontWeight: Typography.weight.bold },
  metricLabel: { fontSize: 9, color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.4 },
  dismissBtn: { alignSelf: 'center' },
  dismissText: { fontSize: Typography.size.xs, color: Colors.textTertiary, textDecorationLine: 'underline' },

  errorWrap: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.dangerDim,
    borderRadius: Radius.md,
    padding: Spacing.sm,
  },
  errorText: { flex: 1, fontSize: Typography.size.xs, color: Colors.danger, lineHeight: 16 },
  retryText: { fontSize: Typography.size.xs, color: Colors.primary, fontWeight: Typography.weight.semibold },
  reconnectText: { fontSize: Typography.size.xs, color: Colors.warning, fontWeight: Typography.weight.bold },

  btn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm,
    backgroundColor: Colors.info,
    borderRadius: Radius.md,
    paddingVertical: Spacing.md,
  },
  btnRunning: { opacity: 0.7 },
  btnText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.background },

  divider: { height: 1, backgroundColor: Colors.surfaceBorder },

  ebaySyncWrap: { gap: Spacing.sm },
  ebaySyncTopRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  ebaySyncText: { flex: 1, fontSize: Typography.size.sm, color: Colors.accent, fontWeight: Typography.weight.medium },
  ebaySyncBarTrack: {
    height: 6, backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.pill, overflow: 'hidden',
  },
  ebaySyncBarFill: { height: '100%', backgroundColor: Colors.accent, borderRadius: Radius.pill },
  ebaySyncStats: { flexDirection: 'row', gap: Spacing.lg },
  ebaySyncStat: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  ebaySyncStatText: { fontSize: Typography.size.xs, fontWeight: Typography.weight.semibold },

  ebaySyncResult: { gap: Spacing.sm },
  ebaySyncResultRow: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: Spacing.xs },
  imgDownloadResult: { gap: Spacing.sm, backgroundColor: Colors.successDim + '60', borderRadius: Radius.md, padding: Spacing.sm, borderWidth: 1, borderColor: Colors.success + '25' },
  imgDownloadRow: { flexDirection: 'row', justifyContent: 'space-around' },
  partialCheckRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
});

// ── Advanced Section ───────────────────────────────────────────────────────

function AdvancedSection({
  controls, onKillSwitch, onResume, onToggleCapability, onGoToBusinessConfig, businessConfig,
}: {
  controls: AutonomyControls | null;
  onKillSwitch: (reason: string) => Promise<void>;
  onResume: () => Promise<void>;
  onToggleCapability: (key: keyof AutonomyControls, value: boolean) => Promise<void>;
  onGoToBusinessConfig: () => void;
  businessConfig: any;
}) {
  const [expanded, setExpanded] = useState(false);
  const { showAlert } = useAlert();
  const [showKillModal, setShowKillModal] = useState(false);
  const [killReason, setKillReason] = useState('');
  const [killing, setKilling] = useState(false);
  const [resuming, setResuming] = useState(false);
  const router = useRouter();

  const isGloballyPaused = controls?.globalPause ?? false;

  const toggle = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded(e => !e);
  };

  const capabilities: Array<{ key: keyof AutonomyControls; label: string; icon: string }> = [
    { key: 'acquisitionPaused', label: 'Auto-Acquisition', icon: 'shopping-bag' },
    { key: 'listingPaused', label: 'Auto-Listing', icon: 'list-alt' },
    { key: 'publishingPaused', label: 'Auto-Publishing', icon: 'publish' },
    { key: 'repricingPaused', label: 'Auto-Repricing', icon: 'price-change' },
    { key: 'reinvestmentPaused', label: 'Auto-Reinvestment', icon: 'account-balance' },
  ];

  const automationLevelLabel: Record<string, string> = {
    manual: 'Manual', assisted: 'Assisted', one_click: 'One-Click', autonomous: 'Autonomous',
  };

  return (
    <View style={advStyles.container}>
      {/* Toggle header */}
      <Pressable onPress={toggle} style={({ pressed }) => [advStyles.header, pressed && { opacity: 0.85 }]}>
        <View style={advStyles.headerLeft}>
          <View style={advStyles.headerIcon}>
            <MaterialIcons name="tune" size={16} color={Colors.textTertiary} />
          </View>
          <View>
            <Text style={advStyles.headerTitle}>Advanced Settings</Text>
            <Text style={advStyles.headerSub}>Capital targets, autonomy controls, predictions</Text>
          </View>
        </View>
        <MaterialIcons name={expanded ? 'expand-less' : 'expand-more'} size={20} color={Colors.textTertiary} />
      </Pressable>

      {expanded ? (
        <View style={advStyles.body}>

          {/* Autonomy Kill Switch */}
          <View style={advStyles.subSection}>
            <Text style={advStyles.subTitle}>AUTONOMY CONTROLS</Text>
            <View style={[advStyles.killCard, isGloballyPaused && { borderColor: Colors.danger + '50', backgroundColor: Colors.dangerDim + '30' }]}>
              <View style={advStyles.killRow}>
                <View style={[advStyles.killIcon, { backgroundColor: isGloballyPaused ? Colors.dangerDim : Colors.surfaceHighlight }]}>
                  <MaterialIcons name={isGloballyPaused ? 'pause-circle-filled' : 'play-circle-filled'} size={20} color={isGloballyPaused ? Colors.danger : Colors.textTertiary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[advStyles.killTitle, isGloballyPaused && { color: Colors.danger }]}>
                    {isGloballyPaused ? 'All Autonomy Paused' : 'Autonomy Active'}
                  </Text>
                  {isGloballyPaused && controls?.globalPauseReason ? (
                    <Text style={advStyles.killDesc}>{controls.globalPauseReason}</Text>
                  ) : null}
                </View>
                {isGloballyPaused ? (
                  <Pressable
                    onPress={async () => { setResuming(true); await onResume(); setResuming(false); }}
                    style={advStyles.resumeBtn}
                  >
                    {resuming ? <ActivityIndicator size="small" color={Colors.success} /> : (
                      <Text style={advStyles.resumeBtnText}>Resume</Text>
                    )}
                  </Pressable>
                ) : (
                  <Pressable onPress={() => setShowKillModal(true)} style={advStyles.pauseBtn}>
                    <Text style={advStyles.pauseBtnText}>Pause All</Text>
                  </Pressable>
                )}
              </View>

              {!isGloballyPaused ? (
                <View style={advStyles.capabilityList}>
                  {capabilities.map(cap => {
                    const isPaused = (controls?.[cap.key] as boolean) ?? false;
                    return (
                      <View key={cap.key} style={advStyles.capRow}>
                        <MaterialIcons name={cap.icon as any} size={14} color={isPaused ? Colors.warning : Colors.textSecondary} />
                        <Text style={[advStyles.capLabel, isPaused && { color: Colors.warning }]}>{cap.label}</Text>
                        <Switch
                          value={!isPaused}
                          onValueChange={v => onToggleCapability(cap.key, !v)}
                          trackColor={{ false: Colors.surfaceHighlight, true: Colors.primaryDim }}
                          thumbColor={!isPaused ? Colors.primary : Colors.textTertiary}
                          style={{ transform: [{ scale: 0.8 }] }}
                        />
                      </View>
                    );
                  })}
                </View>
              ) : null}
            </View>
          </View>

          {/* Business Configuration */}
          <View style={advStyles.subSection}>
            <Text style={advStyles.subTitle}>BUSINESS CONFIGURATION</Text>
            <CardGroup>
              <SettingRow
                icon="account-balance-wallet"
                label="Capital & Goals"
                desc={businessConfig?.startingCapital ? `Starting capital: £${businessConfig.startingCapital.toLocaleString()}` : 'Set capital targets and growth goals'}
                onPress={onGoToBusinessConfig}
                color={Colors.gold}
              />
              <Divider />
              <SettingRow
                icon="smart-toy"
                label="Automation Level"
                desc="How much SWISH does autonomously"
                value={automationLevelLabel[businessConfig?.automationLevel ?? 'assisted']}
                onPress={onGoToBusinessConfig}
                color={Colors.primary}
              />
              <Divider />
              <SettingRow
                icon="security"
                label="Spending Limits"
                desc={businessConfig ? `Auto-spend up to £${businessConfig.autonomousSpendingLimit}` : 'Set autonomous spending limits'}
                onPress={onGoToBusinessConfig}
                color={Colors.warning}
              />
              <Divider />
              <SettingRow
                icon="category"
                label="Preferred Categories"
                desc={businessConfig?.preferredCategories?.length ? `${businessConfig.preferredCategories.length} categories selected` : 'All categories enabled'}
                onPress={onGoToBusinessConfig}
                color={Colors.accent}
              />
            </CardGroup>
          </View>

          {/* Audit & Intelligence */}
          <View style={advStyles.subSection}>
            <Text style={advStyles.subTitle}>AUDIT & INTELLIGENCE</Text>
            <CardGroup>
              <SettingRow
                icon="gavel"
                label="Decision Audit Log"
                desc="Every autonomous SWISH decision with full reasoning"
                onPress={() => router.push('/audit' as any)}
                color={Colors.primary}
              />
              <Divider />
              <SettingRow
                icon="psychology"
                label="Learning Engine"
                desc="Prediction vs actual outcomes — model accuracy"
                onPress={() => router.push('/audit' as any)}
                color={Colors.accent}
              />
              <Divider />
              <SettingRow
                icon="verified"
                label="Verification Gate"
                desc="AI verifies all listings before publishing"
                value="Always On"
                onPress={() => showAlert('Verification Gate', 'Mandatory — all listings are checked before publishing.')}
                color={Colors.success}
              />
            </CardGroup>
          </View>

        </View>
      ) : null}

      {/* Kill Switch Modal */}
      <Modal visible={showKillModal} animationType="fade" transparent>
        <View style={advStyles.modalOverlay}>
          <View style={advStyles.modalCard}>
            <MaterialIcons name="stop-circle" size={28} color={Colors.danger} style={{ alignSelf: 'center' }} />
            <Text style={advStyles.modalTitle}>Pause All Autonomy</Text>
            <Text style={advStyles.modalDesc}>
              This immediately stops all autonomous operations. In-progress operations will not be cancelled but no new ones will start.
            </Text>
            <View style={{ gap: 4 }}>
              <Text style={advStyles.modalFieldLabel}>Reason <Text style={{ fontWeight: '400', color: Colors.textTertiary }}>(optional)</Text></Text>
              <TextInput style={advStyles.modalInput} value={killReason} onChangeText={setKillReason} placeholder="e.g. Review required, holiday..." placeholderTextColor={Colors.textTertiary} multiline />
            </View>
            <View style={advStyles.modalActions}>
              <Pressable onPress={() => setShowKillModal(false)} style={advStyles.modalCancelBtn}>
                <Text style={advStyles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={async () => { setKilling(true); await onKillSwitch(killReason || 'Manual pause'); setKilling(false); setKillReason(''); setShowKillModal(false); }}
                style={advStyles.modalKillBtn}
              >
                {killing ? <ActivityIndicator size="small" color="#fff" /> : <Text style={advStyles.modalKillText}>Pause Now</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const advStyles = StyleSheet.create({
  container: {
    marginHorizontal: Spacing.base, borderRadius: Radius.xl,
    borderWidth: 1, borderColor: Colors.surfaceBorder,
    backgroundColor: Colors.surface, overflow: 'hidden', ...Shadow.sm,
  },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.base, paddingVertical: Spacing.md, gap: Spacing.md,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, flex: 1 },
  headerIcon: { width: 36, height: 36, borderRadius: Radius.sm, backgroundColor: Colors.surfaceHighlight, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.textSecondary },
  headerSub: { fontSize: Typography.size.xs, color: Colors.textTertiary, marginTop: 1 },
  body: { gap: Spacing.md, paddingBottom: Spacing.md, borderTopWidth: 1, borderTopColor: Colors.surfaceBorder },
  subSection: { gap: Spacing.sm, paddingHorizontal: Spacing.base, paddingTop: Spacing.md },
  subTitle: { fontSize: 9, fontWeight: Typography.weight.bold, color: Colors.textTertiary, letterSpacing: 0.8 },

  killCard: { backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.surfaceBorder, gap: Spacing.sm },
  killRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  killIcon: { width: 36, height: 36, borderRadius: Radius.sm, alignItems: 'center', justifyContent: 'center' },
  killTitle: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.textPrimary },
  killDesc: { fontSize: Typography.size.xs, color: Colors.textTertiary, marginTop: 2 },
  pauseBtn: { backgroundColor: Colors.dangerDim, borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs, borderWidth: 1, borderColor: Colors.danger + '30' },
  pauseBtnText: { fontSize: Typography.size.xs, fontWeight: Typography.weight.bold, color: Colors.danger },
  resumeBtn: { backgroundColor: Colors.successDim, borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs, borderWidth: 1, borderColor: Colors.success + '30' },
  resumeBtnText: { fontSize: Typography.size.xs, fontWeight: Typography.weight.bold, color: Colors.success },
  capabilityList: { gap: Spacing.xs, borderTopWidth: 1, borderTopColor: Colors.surfaceBorder, paddingTop: Spacing.sm },
  capRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: 4 },
  capLabel: { flex: 1, fontSize: Typography.size.xs, color: Colors.textSecondary },

  modalOverlay: { flex: 1, backgroundColor: Colors.overlay80, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl },
  modalCard: { backgroundColor: Colors.surfaceElevated, borderRadius: Radius.xxl, padding: Spacing.xl, gap: Spacing.md, width: '100%', maxWidth: 380, borderWidth: 1, borderColor: Colors.danger + '40' },
  modalTitle: { fontSize: Typography.size.xl, fontWeight: Typography.weight.bold, color: Colors.textPrimary, textAlign: 'center' },
  modalDesc: { fontSize: Typography.size.sm, color: Colors.textSecondary, lineHeight: 20, textAlign: 'center' },
  modalFieldLabel: { fontSize: Typography.size.xs, fontWeight: Typography.weight.semibold, color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4 },
  modalInput: { backgroundColor: Colors.surface, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.surfaceBorder, padding: Spacing.md, fontSize: Typography.size.sm, color: Colors.textPrimary, minHeight: 72 },
  modalActions: { flexDirection: 'row', gap: Spacing.md },
  modalCancelBtn: { flex: 1, alignItems: 'center', paddingVertical: Spacing.md, borderRadius: Radius.md, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.surfaceBorder },
  modalCancelText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.textSecondary },
  modalKillBtn: { flex: 1, alignItems: 'center', paddingVertical: Spacing.md, borderRadius: Radius.md, backgroundColor: Colors.danger },
  modalKillText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: '#fff' },
});

// ── Niches & Subscriptions Section ────────────────────────────────────────

function NichesSubscriptionsSection({ tenantId, isOwner }: { tenantId: string; isOwner: boolean }) {
  const { showAlert } = useAlert();
  const supabase = getSupabaseClient();
  const [activeSpecialists, setActiveSpecialists] = useState<string[]>([]);
  const [subscriptionTier, setSubscriptionTier] = useState<string>('starter');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null); // nicheId being saved

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('tenants')
      .select('active_specialists, subscription_tier')
      .eq('id', tenantId)
      .maybeSingle();
    if (data) {
      setActiveSpecialists(data.active_specialists ?? []);
      setSubscriptionTier(data.subscription_tier ?? 'starter');
    }
    setLoading(false);
  }, [tenantId, supabase]);

  useEffect(() => { load(); }, [load]);

  // empty array = all niches enabled (default)
  const isNicheEnabled = (nicheId: NicheId) => {
    if (activeSpecialists.length === 0) return true;
    return activeSpecialists.includes(nicheId);
  };

  const handleToggleNiche = useCallback((nicheId: NicheId, currentlyEnabled: boolean) => {
    if (!isOwner) {
      showAlert('Owner Required', 'Only the tenant owner can manage niche subscriptions.');
      return;
    }

    const niche = NICHES[nicheId];
    const displayName = niche?.name ?? nicheId;

    if (currentlyEnabled) {
      // Disabling a niche — show confirmation dialog
      showAlert(
        `Remove ${displayName}?`,
        `Removing this niche will restrict access for all team members. Existing inventory and data will be preserved.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Remove Niche',
            style: 'destructive',
            onPress: async () => {
              setSaving(nicheId);
              // Build new list: current active list minus this niche
              // If current list is empty (= all enabled), expand to all-except-this
              const base = activeSpecialists.length === 0
                ? NICHE_LIST.map(n => n.id).filter(id => id !== nicheId)
                : activeSpecialists.filter(id => id !== nicheId);
              const { error } = await supabase
                .from('tenants')
                .update({ active_specialists: base, updated_at: new Date().toISOString() })
                .eq('id', tenantId);
              if (error) {
                showAlert('Save Failed', error.message);
              } else {
                setActiveSpecialists(base);
              }
              setSaving(null);
            },
          },
        ]
      );
    } else {
      // Enabling a niche
      showAlert(
        `Enable ${displayName}?`,
        `This will grant all team members access to the ${displayName} niche.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Enable',
            style: 'default',
            onPress: async () => {
              setSaving(nicheId);
              const base = activeSpecialists.length === 0
                ? NICHE_LIST.map(n => n.id) // all were enabled — now explicitly list all
                : [...activeSpecialists, nicheId];
              const { error } = await supabase
                .from('tenants')
                .update({ active_specialists: base, updated_at: new Date().toISOString() })
                .eq('id', tenantId);
              if (error) {
                showAlert('Save Failed', error.message);
              } else {
                setActiveSpecialists(base);
              }
              setSaving(null);
            },
          },
        ]
      );
    }
  }, [isOwner, activeSpecialists, tenantId, supabase, showAlert]);

  const tierLabel: Record<string, { label: string; color: string }> = {
    starter:     { label: 'Starter',     color: Colors.textTertiary },
    pro:         { label: 'Pro',         color: Colors.primary },
    business:    { label: 'Business',    color: Colors.accent },
    enterprise:  { label: 'Enterprise',  color: Colors.gold },
  };
  const tier = tierLabel[subscriptionTier] ?? { label: subscriptionTier, color: Colors.textTertiary };

  return (
    <View style={nichStyles.card}>
      {/* Plan header */}
      <View style={nichStyles.planRow}>
        <View style={[nichStyles.planIcon, { backgroundColor: tier.color + '20' }]}>
          <MaterialIcons name="card-membership" size={18} color={tier.color} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={nichStyles.planLabel}>CURRENT PLAN</Text>
          <Text style={[nichStyles.planName, { color: tier.color }]}>{tier.label}</Text>
        </View>
        <View style={[nichStyles.tierBadge, { backgroundColor: tier.color + '20', borderColor: tier.color + '40' }]}>
          <Text style={[nichStyles.tierBadgeText, { color: tier.color }]}>{tier.label.toUpperCase()}</Text>
        </View>
      </View>

      {/* All-enabled note */}
      {activeSpecialists.length === 0 ? (
        <View style={nichStyles.allEnabledBanner}>
          <MaterialIcons name="check-circle" size={13} color={Colors.success} />
          <Text style={nichStyles.allEnabledText}>All niches currently enabled (default)</Text>
        </View>
      ) : null}

      {/* Owner-only note */}
      {!isOwner ? (
        <View style={nichStyles.ownerNote}>
          <MaterialIcons name="info-outline" size={13} color={Colors.textTertiary} />
          <Text style={nichStyles.ownerNoteText}>Only the tenant owner can change niche access.</Text>
        </View>
      ) : null}

      {/* Niche list */}
      {loading ? (
        <View style={{ alignItems: 'center', paddingVertical: Spacing.md }}>
          <ActivityIndicator size="small" color={Colors.primary} />
        </View>
      ) : (
        <View style={nichStyles.nicheList}>
          {NICHE_LIST.map((niche, idx) => {
            const enabled = isNicheEnabled(niche.id);
            const isSavingThis = saving === niche.id;
            return (
              <View key={niche.id}>
                {idx > 0 ? <View style={nichStyles.divider} /> : null}
                <View style={nichStyles.nicheRow}>
                  {/* Niche icon */}
                  <View style={[nichStyles.nicheIcon, { backgroundColor: niche.color + '20' }]}>
                    <MaterialIcons name={niche.icon as any} size={18} color={niche.color} />
                  </View>
                  {/* Niche info */}
                  <View style={{ flex: 1, gap: 2 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={nichStyles.nicheName}>{niche.name}</Text>
                      {enabled ? (
                        <View style={[nichStyles.statusBadge, { backgroundColor: Colors.successDim, borderColor: Colors.success + '40' }]}>
                          <View style={[nichStyles.statusDot, { backgroundColor: Colors.success }]} />
                          <Text style={[nichStyles.statusText, { color: Colors.success }]}>Active</Text>
                        </View>
                      ) : (
                        <View style={[nichStyles.statusBadge, { backgroundColor: Colors.surfaceHighlight, borderColor: Colors.surfaceBorder }]}>
                          <View style={[nichStyles.statusDot, { backgroundColor: Colors.textTertiary }]} />
                          <Text style={[nichStyles.statusText, { color: Colors.textTertiary }]}>Locked</Text>
                        </View>
                      )}
                    </View>
                    <Text style={nichStyles.nicheDesc} numberOfLines={1}>{niche.tagline}</Text>
                    <View style={{ flexDirection: 'row', gap: 4, flexWrap: 'wrap', marginTop: 2 }}>
                      {niche.marketplaces.slice(0, 3).map(mp => (
                        <View key={mp} style={nichStyles.mpChip}>
                          <Text style={nichStyles.mpChipText}>{mp}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                  {/* Toggle */}
                  {isSavingThis ? (
                    <ActivityIndicator size="small" color={niche.color} style={{ width: 36, height: 36 }} />
                  ) : (
                    <Switch
                      value={enabled}
                      onValueChange={() => handleToggleNiche(niche.id, enabled)}
                      disabled={!isOwner || isSavingThis}
                      trackColor={{ false: Colors.surfaceHighlight, true: niche.color + '50' }}
                      thumbColor={enabled ? niche.color : Colors.textTertiary}
                      style={{ transform: [{ scale: 0.88 }] }}
                    />
                  )}
                </View>
              </View>
            );
          })}
        </View>
      )}

      {/* Footer note */}
      <View style={nichStyles.footer}>
        <MaterialIcons name="info-outline" size={11} color={Colors.textTertiary} />
        <Text style={nichStyles.footerText}>
          Disabling a niche restricts access for team members but preserves all existing inventory and data.
        </Text>
      </View>
    </View>
  );
}

const nichStyles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface, marginHorizontal: Spacing.base,
    borderRadius: Radius.xl, borderWidth: 1, borderColor: Colors.surfaceBorder,
    overflow: 'hidden', ...Shadow.sm,
  },
  planRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    padding: Spacing.base, borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder,
    backgroundColor: Colors.surfaceHighlight,
  },
  planIcon: { width: 36, height: 36, borderRadius: Radius.sm, alignItems: 'center', justifyContent: 'center' },
  planLabel: { fontSize: 9, fontWeight: Typography.weight.bold, color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.6 },
  planName: { fontSize: Typography.size.base, fontWeight: Typography.weight.bold },
  tierBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: Radius.pill, borderWidth: 1 },
  tierBadgeText: { fontSize: 9, fontWeight: Typography.weight.extrabold, letterSpacing: 0.5 },
  allEnabledBanner: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    margin: Spacing.base, marginBottom: 0,
    backgroundColor: Colors.successDim, borderRadius: Radius.md, padding: Spacing.sm,
    borderWidth: 1, borderColor: Colors.success + '30',
  },
  allEnabledText: { flex: 1, fontSize: Typography.size.xs, color: Colors.success, lineHeight: 16 },
  ownerNote: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    margin: Spacing.base, marginBottom: 0,
    backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.md, padding: Spacing.sm,
    borderWidth: 1, borderColor: Colors.surfaceBorder,
  },
  ownerNoteText: { flex: 1, fontSize: Typography.size.xs, color: Colors.textTertiary, lineHeight: 16 },
  nicheList: { paddingTop: Spacing.sm },
  nicheRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingHorizontal: Spacing.base, paddingVertical: Spacing.md,
  },
  nicheIcon: { width: 40, height: 40, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  nicheName: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.textPrimary },
  nicheDesc: { fontSize: Typography.size.xs, color: Colors.textTertiary, lineHeight: 15 },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 7, paddingVertical: 2, borderRadius: Radius.pill, borderWidth: 1 },
  statusDot: { width: 5, height: 5, borderRadius: 3 },
  statusText: { fontSize: 9, fontWeight: Typography.weight.bold, textTransform: 'uppercase', letterSpacing: 0.3 },
  mpChip: { backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.pill, paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1, borderColor: Colors.surfaceBorder },
  mpChipText: { fontSize: 8, color: Colors.textTertiary, fontWeight: Typography.weight.medium },
  divider: { height: 1, backgroundColor: Colors.surfaceBorder, marginLeft: Spacing.base + 40 + Spacing.md },
  footer: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 5,
    padding: Spacing.md, paddingTop: Spacing.sm,
    borderTopWidth: 1, borderTopColor: Colors.surfaceBorder,
    backgroundColor: Colors.surfaceHighlight,
  },
  footerText: { flex: 1, fontSize: 10, color: Colors.textTertiary, lineHeight: 15 },
});

// ── Main Screen ────────────────────────────────────────────────────────────

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { tenant, businessConfig, reloadBusinessConfig } = useApp();
  const { triggerInventoryReload } = useApp();
  const { activeNiche } = useApp();
  const { logout } = useAuth();
  const { showAlert } = useAlert();
  const { user } = useAuth();

  const [controls, setControls] = useState<AutonomyControls | null>(null);
  const [ebayStatus, setEbayStatus] = useState<EbayConnectorStatus | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [shippingServices, setShippingServices] = useState<ShippingService[]>([]);
  const [loading, setLoading] = useState(false);
  const [svcModalVisible, setSvcModalVisible] = useState(false);
  const [editingService, setEditingService] = useState<ShippingService | null>(null);

  const load = useCallback(async () => {
    if (!tenant) return;
    setLoading(true);
    const supabase = getSupabaseClient();
    const [{ controls: c }, { services }, connRes, membershipRes] = await Promise.all([
      getAutonomyControls(tenant.id),
      getShippingServices(tenant.id),
      supabase
        .from('marketplace_connectors')
        .select('status, seller_account_id, access_token_expires_at, last_sync_at')
        .eq('tenant_id', tenant.id)
        .eq('marketplace_id', 'ebay')
        .maybeSingle(),
      supabase
        .from('tenant_memberships')
        .select('is_owner, role')
        .eq('tenant_id', tenant.id)
        .maybeSingle(),
    ]);
    setControls(c);
    setShippingServices(services);
    if (connRes.data) {
      setEbayStatus({
        status: connRes.data.status,
        sellerAccountId: connRes.data.seller_account_id,
        accessTokenExpiresAt: connRes.data.access_token_expires_at,
        lastSyncAt: connRes.data.last_sync_at,
      });
    }
    setIsOwner(membershipRes.data?.is_owner === true || membershipRes.data?.role === 'owner' || membershipRes.data?.role === 'admin');
    setLoading(false);
  }, [tenant?.id]);

  useEffect(() => { load(); }, [load]);

  const handleKillSwitch = useCallback(async (reason: string) => {
    if (!tenant) return;
    const { error } = await triggerGlobalKillSwitch(tenant.id, reason);
    if (error) showAlert('Error', error);
    else load();
  }, [tenant?.id, load, showAlert]);

  const handleResume = useCallback(async () => {
    if (!tenant) return;
    const { error } = await resumeAllAutonomy(tenant.id);
    if (error) showAlert('Error', error);
    else load();
  }, [tenant?.id, load, showAlert]);

  const handleToggleCapability = useCallback(async (key: keyof AutonomyControls, value: boolean) => {
    if (!tenant) return;
    const { controls: updated, error } = await updateAutonomyControls(tenant.id, { [key]: value });
    if (error) showAlert('Error', error);
    else if (updated) setControls(updated);
  }, [tenant?.id, showAlert]);

  const handleSaveCurrency = useCallback(async (currency: string) => {
    if (!tenant) return;
    const geography = currency === 'GBP' ? 'GB' : currency === 'EUR' ? 'EU' : 'US';
    await upsertBusinessConfig(tenant.id, { currency, geography });
    await reloadBusinessConfig?.();
  }, [tenant?.id, reloadBusinessConfig]);

  const handleSaveShippingDefault = useCallback(async (val: number) => {
    if (!tenant) return;
    const { error } = await upsertBusinessConfig(tenant.id, { defaultShippingCost: val });
    if (error) { showAlert('Save Failed', error); return; }
    await reloadBusinessConfig?.();
    showAlert('Saved', `Default shipping set to ${val === 0 ? 'Free' : `£${val.toFixed(2)}`}.`);
  }, [tenant, reloadBusinessConfig, showAlert]);

  const handleLogout = useCallback(() => {
    showAlert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          const result = await logout();
          if (result?.error) {
            showAlert('Sign Out Failed', result.error);
            return;
          }
          // Hard navigate to login — clears all navigation state
          router.replace('/login' as any);
        },
      },
    ]);
  }, [logout, showAlert, router]);

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + Spacing.base }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
          <MaterialIcons name="arrow-back" size={20} color={Colors.textSecondary} />
        </Pressable>
        <Pressable onPress={() => router.replace('/(tabs)' as any)} style={styles.homeBtn} hitSlop={8}>
          <MaterialIcons name="dashboard" size={16} color={Colors.textTertiary} />
        </Pressable>
        <Text style={styles.title}>Settings</Text>
        {loading ? <ActivityIndicator size="small" color={Colors.textTertiary} style={{ marginLeft: 'auto' }} /> : null}
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 48 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Niche / Vertical ──────────────────────────────────────────── */}
        <SectionHead title="Trading Vertical" />
        <CardGroup>
          <SettingRow
            icon="storefront"
            label="Switch Niche"
            desc={`Currently: ${activeNiche?.name ?? 'SWISH'}`}
            onPress={() => router.push('/niche-select' as any)}
            color={activeNiche?.color ?? Colors.primary}
          />
        </CardGroup>

        {/* ── Account ─────────────────────────────────────────────── */}
        <SectionHead title="Account" />
        <CardGroup>
          <View style={styles.accountRow}>
            <View style={styles.accountAvatar}>
              <MaterialIcons name="person" size={22} color={Colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.accountName}>
                {tenant?.name ?? user?.username ?? user?.email?.split('@')[0] ?? 'My Account'}
              </Text>
              <Text style={styles.accountEmail} numberOfLines={1}>{user?.email ?? ''}</Text>
            </View>
            <Pressable
              onPress={() => showAlert('Profile', 'Profile management will be available in a future update.')}
              style={styles.editProfileBtn}
              hitSlop={6}
            >
              <MaterialIcons name="edit" size={14} color={Colors.primary} />
            </Pressable>
          </View>
        </CardGroup>

        {/* ── eBay Connection ──────────────────────────────────────── */}
        <SectionHead title="eBay Connection" />
        <EbayStatusCard
          ebayStatus={ebayStatus}
          onManage={() => router.push('/marketplaces' as any)}
        />
        {ebayStatus?.status === 'connected' && tenant ? (
          <EbayPoliciesCard tenantId={tenant.id} />
        ) : null}

        {/* ── Currency & Region ────────────────────────────────────── */}
        <SectionHead title="Currency & Region" />
        <CardGroup>
          <CurrencyRow
            currency={businessConfig?.currency ?? 'GBP'}
            onSave={handleSaveCurrency}
          />
        </CardGroup>

        {/* ── Shipping ─────────────────────────────────────────────── */}
        <SectionHead title="Shipping" />
        <CardGroup>
          <ShippingDefaultRow
            defaultCost={businessConfig?.defaultShippingCost ?? 0}
            onSave={handleSaveShippingDefault}
          />
          <Divider />
          {/* Shipping services list */}
          {shippingServices.length === 0 ? (
            <Pressable
              onPress={() => { setEditingService(null); setSvcModalVisible(true); }}
              style={({ pressed }) => [styles.addShippingRow, pressed && { opacity: 0.8 }]}
            >
              <MaterialIcons name="local-shipping" size={16} color={Colors.textTertiary} />
              <Text style={styles.addShippingText}>No shipping services — tap to add</Text>
              <MaterialIcons name="add" size={16} color={Colors.primary} />
            </Pressable>
          ) : (
            shippingServices.map((svc, idx) => (
              <View key={svc.id}>
                {idx > 0 ? <Divider /> : null}
                <Pressable
                  onPress={() => { setEditingService(svc); setSvcModalVisible(true); }}
                  style={({ pressed }) => [styles.svcRow, pressed && { opacity: 0.85 }]}
                >
                  <View style={[styles.svcIcon, { backgroundColor: svc.isDefault ? Colors.primaryDim : Colors.surfaceHighlight }]}>
                    <MaterialIcons name={svc.isTracked ? 'track-changes' : svc.isSigned ? 'draw' : 'mail'} size={14} color={svc.isDefault ? Colors.primary : Colors.textSecondary} />
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                      <Text style={styles.svcName}>{svc.name}</Text>
                      {svc.isDefault ? <View style={styles.defaultBadge}><Text style={styles.defaultBadgeText}>Default</Text></View> : null}
                      {svc.isTracked ? <View style={styles.tagChip}><Text style={styles.tagChipText}>Tracked</Text></View> : null}
                    </View>
                    <Text style={styles.svcMeta}>{svc.carrier}{svc.weightBandG ? ` · ≤${svc.weightBandG}g` : ''}</Text>
                  </View>
                  <Text style={styles.svcPrice}>{svc.price === 0 ? 'Free' : `£${svc.price.toFixed(2)}`}</Text>
                  <MaterialIcons name="edit" size={13} color={Colors.textTertiary} />
                </Pressable>
              </View>
            ))
          )}
          <Divider />
          <Pressable
            onPress={() => { setEditingService(null); setSvcModalVisible(true); }}
            style={({ pressed }) => [styles.addShippingRow, pressed && { opacity: 0.8 }]}
          >
            <View style={[styles.svcIcon, { backgroundColor: Colors.primaryDim }]}>
              <MaterialIcons name="add" size={14} color={Colors.primary} />
            </View>
            <Text style={[styles.addShippingText, { color: Colors.primary }]}>Add Shipping Service</Text>
            <MaterialIcons name="chevron-right" size={16} color={Colors.textTertiary} />
          </Pressable>
        </CardGroup>

        {/* ── Selling ──────────────────────────────────────────────── */}
        <SectionHead title="Selling" />
        <CardGroup>
          <SettingRow
            icon="receipt-long"
            label="All Listings"
            desc="Manage draft, live and ended listings"
            onPress={() => router.push('/(tabs)/listings' as any)}
            color={Colors.accent}
          />
          <Divider />
          <SettingRow
            icon="local-shipping"
            label="Dispatch Queue"
            desc="Pick and dispatch awaiting orders"
            onPress={() => router.push('/dispatch' as any)}
            color={Colors.success}
          />
          <Divider />
          <SettingRow
            icon="receipt"
            label="All Orders"
            desc="Order management and fulfilment history"
            onPress={() => router.push('/orders' as any)}
            color={Colors.info}
          />
        </CardGroup>

        {/* ── Niches & Subscriptions ──────────────────────────────── */}
        {tenant ? (
          <>
            <SectionHead title="Niches & Subscriptions" />
            <CardGroup>
              <SettingRow
                icon="workspace-premium"
                label="Subscription"
                desc="Manage your SWISH Niche Premium plan · £9.99/month"
                onPress={() => router.push('/subscription' as any)}
                color={Colors.gold}
              />
              <Divider />
            </CardGroup>
            <NichesSubscriptionsSection tenantId={tenant.id} isOwner={isOwner} />
          </>
        ) : null}

        {/* ── Data & Sync ───────────────────────────────────────────── */}
        {tenant ? (
          <>
            <SectionHead title="Data & Sync" />
            <DataSyncCard tenantId={tenant.id} onSyncComplete={triggerInventoryReload} />
          </>
        ) : null}

        {tenant ? (
          <>
            <SectionHead title="AI Learning" />
            <AILearningCard tenantId={tenant.id} />
          </>
        ) : null}

        {/* ── Advanced (collapsed) ─────────────────────────────────── */}
        <View style={{ paddingHorizontal: 0, paddingTop: Spacing.lg, paddingBottom: Spacing.xs }}>
          <View style={{ paddingHorizontal: Spacing.base, paddingBottom: Spacing.xs }}>
            <Text style={{ fontSize: 10, fontWeight: Typography.weight.bold, color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.8 }}>
              Advanced
            </Text>
          </View>
        </View>
        <AdvancedSection
          controls={controls}
          onKillSwitch={handleKillSwitch}
          onResume={handleResume}
          onToggleCapability={handleToggleCapability}
          onGoToBusinessConfig={() => router.push('/onboarding' as any)}
          businessConfig={businessConfig}
        />

        {/* ── Legal ───────────────────────────────────────────────── */}
        <SectionHead title="Legal" />
        <CardGroup>
          <SettingRow
            icon="shield"
            label="Privacy Policy"
            desc="How SWISH handles your data"
            onPress={() => router.push('/privacy-policy' as any)}
            color={Colors.info}
          />
        </CardGroup>

        {/* ── Sign Out ─────────────────────────────────────────────── */}
        <SectionHead title="Session" />
        <CardGroup>
          <SettingRow
            icon="logout"
            label="Sign Out"
            danger
            onPress={handleLogout}
          />
        </CardGroup>

        {/* Version */}
        <Text style={styles.version}>
          SWISH · v1.0.0{'\n'}
          <Text style={styles.versionLink} onPress={() => router.push('/privacy-policy' as any)}>Privacy Policy</Text>
        </Text>
      </ScrollView>

      {/* Shipping Service Modal */}
      {tenant ? (
        <ShippingServiceModal
          visible={svcModalVisible}
          service={editingService}
          tenantId={tenant.id}
          onClose={() => setSvcModalVisible(false)}
          onSaved={(svc, isNew) => {
            setShippingServices(prev =>
              isNew ? [...prev, svc] : prev.map(s => s.id === svc.id ? svc : s)
            );
          }}
        />
      ) : null}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingHorizontal: Spacing.base, paddingBottom: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder,
  },
  backBtn: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.surfaceBorder },
  homeBtn: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.surfaceBorder },
  title: { fontSize: Typography.size.xl, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  content: { gap: 0 },

  // Account
  accountRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.base },
  accountAvatar: { width: 46, height: 46, borderRadius: 23, backgroundColor: Colors.primaryDim, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: Colors.primary + '40' },
  accountName: { fontSize: Typography.size.base, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  accountEmail: { fontSize: Typography.size.xs, color: Colors.textTertiary, marginTop: 2 },
  editProfileBtn: { width: 30, height: 30, borderRadius: Radius.sm, backgroundColor: Colors.primaryDim, alignItems: 'center', justifyContent: 'center' },

  // Shipping services
  addShippingRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingHorizontal: Spacing.base, paddingVertical: Spacing.md },
  addShippingText: { flex: 1, fontSize: Typography.size.sm, color: Colors.textTertiary },
  svcRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingHorizontal: Spacing.base, paddingVertical: Spacing.md },
  svcIcon: { width: 32, height: 32, borderRadius: Radius.sm, alignItems: 'center', justifyContent: 'center' },
  svcName: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.textPrimary },
  svcMeta: { fontSize: Typography.size.xs, color: Colors.textTertiary },
  svcPrice: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.gold },
  defaultBadge: { backgroundColor: Colors.primaryDim, borderRadius: Radius.pill, paddingHorizontal: 6, paddingVertical: 2 },
  defaultBadgeText: { fontSize: 9, fontWeight: Typography.weight.bold, color: Colors.primary },
  tagChip: { backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.pill, paddingHorizontal: 5, paddingVertical: 2 },
  tagChipText: { fontSize: 9, color: Colors.textTertiary },

  version: { fontSize: Typography.size.xs, color: Colors.textTertiary, textAlign: 'center', paddingVertical: Spacing.xl, lineHeight: 20 },
  versionLink: { fontSize: Typography.size.xs, color: Colors.primary, textDecorationLine: 'underline' },
});
