// SWISH Marketplace Screen — Subscriber eBay Connection
//
// SUBSCRIBER JOURNEY (normal users):
//   Tap "Connect eBay" → eBay OAuth login → Back to SWISH → eBay Connected
//
// Subscribers NEVER see developer credentials (App ID, Cert ID, RuName).
// SWISH application credentials are held server-side only.
//
// Developer/admin credentials setup is handled via ebay-admin.tsx (owner only).

import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  ActivityIndicator, RefreshControl, Modal, Linking,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors, Typography, Spacing, Radius, Shadow } from '@/constants/theme';
import { useApp } from '@/hooks/useApp';
import { useAlert } from '@/template';
import { getSupabaseClient } from '@/template';
import { FunctionsHttpError } from '@supabase/supabase-js';
import {
  MARKETPLACE_DEFINITIONS, MarketplaceId,
  listConnectors, MarketplaceConnector, disconnectMarketplace,
} from '@/services/marketplaceService';

// ── Types ─────────────────────────────────────────────────────────────────────

type EbayConnectionPhase =
  | 'idle'           // Not connected, show Connect button
  | 'authorizing'    // Calling server to get consent URL
  | 'polling'        // Consent URL opened, waiting for callback
  | 'connected'      // Connection verified
  | 'error';         // Something went wrong

// ── eBay Subscriber Connection Sheet ─────────────────────────────────────────
// Simple 2-phase flow: tap Connect → open eBay → wait → done
// NO developer credentials are requested from subscribers.

function EbayConnectionSheet({
  visible, onClose, onConnected, tenantId, existingConnector,
}: {
  visible: boolean;
  onClose: () => void;
  onConnected: (connector: MarketplaceConnector) => void;
  tenantId: string | null;
  existingConnector: MarketplaceConnector | null;
}) {
  const insets = useSafeAreaInsets();
  const { showAlert } = useAlert();
  const [phase, setPhase] = useState<EbayConnectionPhase>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [pollCount, setPollCount] = useState(0);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const supabase = getSupabaseClient();

  // If already connected, start in 'connected' phase
  useEffect(() => {
    if (visible) {
      if (existingConnector?.status === 'connected') {
        setPhase('connected');
      } else {
        setPhase('idle');
        setErrorMsg(null);
        setPollCount(0);
      }
    }
  }, [visible, existingConnector?.status]);

  const stopPolling = useCallback(() => {
    if (pollTimer.current) { clearInterval(pollTimer.current); pollTimer.current = null; }
  }, []);

  useEffect(() => () => { stopPolling(); }, [stopPolling]);

  const handleClose = useCallback(() => {
    stopPolling();
    onClose();
  }, [stopPolling, onClose]);

  // ── Poll for connection status ─────────────────────────────────────────────

  const startPolling = useCallback(() => {
    if (!tenantId) return;
    setPollCount(0);
    pollTimer.current = setInterval(async () => {
      setPollCount(n => n + 1);
      const { data } = await supabase
        .from('marketplace_connectors')
        .select('status, can_list, seller_account_id, access_token_expires_at, last_sync_at')
        .eq('tenant_id', tenantId)
        .eq('marketplace_id', 'ebay')
        .maybeSingle();

      if (data?.status === 'connected') {
        stopPolling();
        // Reload full connector list and notify parent
        const { connectors } = await import('@/services/marketplaceService').then(m =>
          m.listConnectors(tenantId)
        );
        const ebay = connectors.find(c => c.marketplaceId === 'ebay');
        if (ebay) {
          setPhase('connected');
          onConnected(ebay);
        }
      }
    }, 3000);
  }, [tenantId, stopPolling, onConnected, supabase]);

  const handleCheckNow = useCallback(async () => {
    if (!tenantId) return;
    const { data } = await supabase
      .from('marketplace_connectors')
      .select('status, seller_account_id, access_token_expires_at, last_sync_at')
      .eq('tenant_id', tenantId)
      .eq('marketplace_id', 'ebay')
      .maybeSingle();

    if (data?.status === 'connected') {
      stopPolling();
      const { connectors } = await import('@/services/marketplaceService').then(m =>
        m.listConnectors(tenantId)
      );
      const ebay = connectors.find(c => c.marketplaceId === 'ebay');
      if (ebay) { setPhase('connected'); onConnected(ebay); }
    } else {
      showAlert('Not Connected Yet', 'eBay has not confirmed the authorisation yet. Complete the sign-in in your browser, then check again.');
    }
  }, [tenantId, stopPolling, onConnected, supabase, showAlert]);

  // ── Connect eBay: subscriber OAuth flow ───────────────────────────────────

  const handleConnectEbay = useCallback(async () => {
    if (!tenantId) {
      showAlert('Not Ready', 'Business profile not loaded yet. Please try again.');
      return;
    }
    setPhase('authorizing');
    setErrorMsg(null);

    try {
      const { data, error } = await supabase.functions.invoke('swish-ebay-oauth', {
        body: {
          action: 'start_subscriber_authorization',
          tenantId,
        },
      });

      if (error) {
        let msg = error.message;
        if (error instanceof FunctionsHttpError) {
          try { const t = await error.context?.text(); if (t) msg = t; } catch {}
        }
        setErrorMsg(msg);
        setPhase('error');
        return;
      }

      if (!data?.consentUrl) {
        setErrorMsg('Could not generate eBay authorisation link. Please try again.');
        setPhase('error');
        return;
      }

      await Linking.openURL(data.consentUrl);
      setPhase('polling');
      startPolling();
    } catch (e: any) {
      setErrorMsg(e?.message ?? 'Unknown error');
      setPhase('error');
    }
  }, [tenantId, supabase, showAlert, startPolling]);

  // ── Disconnect eBay ───────────────────────────────────────────────────────

  const handleDisconnect = useCallback(() => {
    showAlert(
      'Disconnect eBay',
      'This will remove the eBay connection. Your inventory and orders will remain in SWISH but eBay sync will stop. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: async () => {
            if (!tenantId) return;
            const { error } = await disconnectMarketplace(tenantId, 'ebay');
            if (error) { showAlert('Disconnect Failed', error); return; }
            setPhase('idle');
            onClose();
          },
        },
      ]
    );
  }, [tenantId, supabase, showAlert, onClose]);

  // ── Helpers ───────────────────────────────────────────────────────────────

  function tokenExpiryLabel(expiresAt?: string | null): string {
    if (!expiresAt) return '';
    const ms = new Date(expiresAt).getTime() - Date.now();
    if (ms < 0) return 'Token expired — reconnect required';
    const days = Math.floor(ms / 86400000);
    if (days < 1) return 'Expires today';
    if (days < 7) return `Expires in ${days}d`;
    return `Expires in ${Math.floor(days / 7)}w`;
  }

  const expiryStr = tokenExpiryLabel(existingConnector?.accessTokenExpiresAt);
  const isExpired = expiryStr.includes('expired');
  const isExpiringSoon = !isExpired && (expiryStr.includes('today') || expiryStr.includes('1d') || expiryStr.includes('2d') || expiryStr.includes('3d'));

  return (
    <Modal visible={visible} animationType="slide" transparent statusBarTranslucent>
      <View style={sheet.overlay}>
        <Pressable style={sheet.backdrop} onPress={handleClose} />
        <View style={[sheet.card, { paddingBottom: insets.bottom + Spacing.lg }]}>

          {/* Header */}
          <View style={sheet.header}>
            <View style={sheet.ebayIcon}>
              <MaterialIcons name="storefront" size={22} color="#E53238" />
            </View>
            <View style={sheet.flex}>
              <Text style={sheet.title}>eBay Seller Account</Text>
              <Text style={sheet.sub}>
                {phase === 'connected' ? 'Connected via OAuth 2.0' : 'Connect your eBay selling account'}
              </Text>
            </View>
            <Pressable onPress={handleClose} hitSlop={10}>
              <MaterialIcons name="close" size={22} color={Colors.textSecondary} />
            </Pressable>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={sheet.scrollContent}
          >

            {/* ── IDLE: Not connected yet ── */}
            {(phase === 'idle' || phase === 'authorizing') ? (
              <View style={sheet.section}>
                <Text style={sheet.sectionTitle}>Connect your eBay seller account</Text>
                <Text style={sheet.sectionDesc}>
                  Connect the eBay account you use for selling. SWISH will securely connect to your eBay account so it can manage your supported eBay data and selling functions.
                </Text>

                {/* What SWISH will access */}
                <View style={sheet.permCard}>
                  <Text style={sheet.permCardTitle}>SWISH will be able to</Text>
                  {[
                    { icon: 'list-alt',       text: 'View and manage your eBay listings' },
                    { icon: 'receipt-long',   text: 'Read your orders and selling activity' },
                    { icon: 'price-change',   text: 'Update listing prices and descriptions' },
                    { icon: 'local-shipping', text: 'Mark orders as despatched' },
                    { icon: 'sync',           text: 'Sync inventory automatically' },
                  ].map((item, i) => (
                    <View key={i} style={sheet.permRow}>
                      <View style={sheet.permIconWrap}>
                        <MaterialIcons name={item.icon as any} size={14} color={Colors.primary} />
                      </View>
                      <Text style={sheet.permText}>{item.text}</Text>
                    </View>
                  ))}
                </View>

                <Pressable
                  onPress={handleConnectEbay}
                  disabled={phase === 'authorizing'}
                  style={({ pressed }) => [
                    sheet.connectBtn,
                    phase === 'authorizing' && { opacity: 0.7 },
                    pressed && { opacity: 0.88 },
                  ]}
                >
                  {phase === 'authorizing'
                    ? <ActivityIndicator size="small" color={Colors.background} />
                    : <MaterialIcons name="storefront" size={20} color={Colors.background} />
                  }
                  <Text style={sheet.connectBtnText}>
                    {phase === 'authorizing' ? 'Opening eBay...' : 'Connect eBay'}
                  </Text>
                </Pressable>

                <View style={sheet.privacyNote}>
                  <MaterialIcons name="lock" size={12} color={Colors.textTertiary} />
                  <Text style={sheet.privacyNoteText}>
                    You will be redirected to eBay to sign in and authorise SWISH. Your eBay password is never shared with SWISH.
                  </Text>
                </View>
              </View>
            ) : null}

            {/* ── POLLING: Waiting for OAuth callback ── */}
            {phase === 'polling' ? (
              <View style={[sheet.section, { alignItems: 'center' }]}>
                <View style={sheet.pollingIcon}>
                  <ActivityIndicator size="large" color="#E53238" />
                </View>
                <Text style={sheet.pollingTitle}>Waiting for eBay Authorisation</Text>
                <Text style={sheet.pollingDesc}>
                  Complete the sign-in in your browser. SWISH is checking automatically ({pollCount} checks).
                </Text>

                <Pressable
                  onPress={handleCheckNow}
                  style={({ pressed }) => [sheet.checkBtn, pressed && { opacity: 0.85 }]}
                >
                  <MaterialIcons name="refresh" size={16} color={Colors.primary} />
                  <Text style={sheet.checkBtnText}>Check Now</Text>
                </Pressable>

                <Pressable
                  onPress={() => { stopPolling(); setPhase('idle'); setErrorMsg(null); }}
                  style={sheet.retryLink}
                >
                  <Text style={sheet.retryLinkText}>Cancel and try again</Text>
                </Pressable>
              </View>
            ) : null}

            {/* ── CONNECTED: Show dashboard ── */}
            {phase === 'connected' ? (
              <View style={sheet.section}>
                {/* Connected banner */}
                <View style={sheet.connectedBanner}>
                  <View style={sheet.connectedIconWrap}>
                    <MaterialIcons name="check-circle" size={36} color={Colors.success} />
                  </View>
                  <View style={sheet.flex}>
                    <Text style={sheet.connectedTitle}>eBay Connected ✓</Text>
                    {existingConnector?.sellerAccountId ? (
                      <Text style={sheet.connectedAccount}>{existingConnector.sellerAccountId}</Text>
                    ) : null}
                  </View>
                  <View style={sheet.connectedStatusDot} />
                </View>

                {/* Connection details */}
                <View style={sheet.detailCard}>
                  <View style={sheet.detailRow}>
                    <MaterialIcons name="link" size={14} color={Colors.textTertiary} />
                    <Text style={sheet.detailLabel}>Status</Text>
                    <View style={sheet.detailBadge}>
                      <View style={sheet.detailBadgeDot} />
                      <Text style={sheet.detailBadgeText}>Connected</Text>
                    </View>
                  </View>
                  {expiryStr ? (
                    <View style={sheet.detailRow}>
                      <MaterialIcons name="schedule" size={14} color={isExpired ? Colors.danger : isExpiringSoon ? Colors.warning : Colors.textTertiary} />
                      <Text style={sheet.detailLabel}>Token</Text>
                      <Text style={[sheet.detailValue, isExpired ? { color: Colors.danger } : isExpiringSoon ? { color: Colors.warning } : {}]}>
                        {expiryStr}
                      </Text>
                    </View>
                  ) : null}
                  {existingConnector?.lastSyncAt ? (
                    <View style={sheet.detailRow}>
                      <MaterialIcons name="sync" size={14} color={Colors.textTertiary} />
                      <Text style={sheet.detailLabel}>Last synced</Text>
                      <Text style={sheet.detailValue}>
                        {new Date(existingConnector.lastSyncAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </Text>
                    </View>
                  ) : null}
                </View>

                {/* Capabilities */}
                <View style={sheet.capGrid}>
                  {[
                    { icon: 'list-alt',       label: 'Sync listings' },
                    { icon: 'publish',         label: 'Create & publish' },
                    { icon: 'receipt-long',   label: 'Read orders' },
                    { icon: 'price-change',   label: 'Repricing' },
                    { icon: 'local-shipping', label: 'Fulfilment' },
                    { icon: 'sync',           label: 'Auto-sync' },
                  ].map(cap => (
                    <View key={cap.label} style={sheet.capItem}>
                      <MaterialIcons name={cap.icon as any} size={12} color={Colors.success} />
                      <Text style={sheet.capLabel}>{cap.label}</Text>
                    </View>
                  ))}
                </View>

                {/* Token expired — reconnect prompt */}
                {isExpired ? (
                  <View style={sheet.warningCard}>
                    <MaterialIcons name="warning" size={14} color={Colors.danger} />
                    <View style={sheet.flex}>
                      <Text style={sheet.warningTitle}>Token Expired</Text>
                      <Text style={sheet.warningDesc}>Re-authorise to restore eBay sync and publishing.</Text>
                    </View>
                  </View>
                ) : null}

                {/* Action buttons */}
                <Pressable
                  onPress={handleConnectEbay}
                  style={({ pressed }) => [
                    sheet.reAuthBtn,
                    !isExpired && { backgroundColor: Colors.surfaceElevated, borderColor: Colors.surfaceBorder },
                    pressed && { opacity: 0.85 },
                  ]}
                >
                  <MaterialIcons
                    name="refresh"
                    size={16}
                    color={isExpired ? Colors.background : Colors.textSecondary}
                  />
                  <Text style={[
                    sheet.reAuthBtnText,
                    !isExpired && { color: Colors.textSecondary },
                  ]}>
                    {isExpired ? 'Re-authorise eBay' : 'Re-authorise eBay'}
                  </Text>
                </Pressable>

                <Pressable
                  onPress={handleDisconnect}
                  style={({ pressed }) => [sheet.disconnectBtn, pressed && { opacity: 0.85 }]}
                >
                  <MaterialIcons name="link-off" size={14} color={Colors.danger} />
                  <Text style={sheet.disconnectBtnText}>Disconnect eBay</Text>
                </Pressable>
              </View>
            ) : null}

            {/* ── ERROR ── */}
            {phase === 'error' ? (
              <View style={sheet.section}>
                <View style={sheet.errorCard}>
                  <MaterialIcons name="error-outline" size={16} color={Colors.danger} />
                  <View style={sheet.flex}>
                    <Text style={sheet.errorTitle}>Connection Failed</Text>
                    <Text style={sheet.errorMsg}>{errorMsg ?? 'Unknown error'}</Text>
                  </View>
                </View>

                <Pressable
                  onPress={() => { setPhase('idle'); setErrorMsg(null); }}
                  style={({ pressed }) => [sheet.connectBtn, { backgroundColor: Colors.danger }, pressed && { opacity: 0.85 }]}
                >
                  <MaterialIcons name="refresh" size={18} color={Colors.background} />
                  <Text style={sheet.connectBtnText}>Try Again</Text>
                </Pressable>

                {/* If the error is that server credentials aren't configured, show help */}
                {(errorMsg ?? '').toLowerCase().includes('not yet configured') ? (
                  <View style={sheet.adminHint}>
                    <MaterialIcons name="admin-panel-settings" size={13} color={Colors.warning} />
                    <Text style={sheet.adminHintText}>
                      The SWISH eBay integration is not yet configured. If you are the SWISH administrator, go to Settings → eBay Admin to set up the application credentials.
                    </Text>
                  </View>
                ) : null}
              </View>
            ) : null}

          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const sheet = StyleSheet.create({
  overlay:      { flex: 1, justifyContent: 'flex-end' },
  backdrop:     { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.65)' },
  card: {
    backgroundColor: Colors.surfaceElevated,
    borderTopLeftRadius: Radius.xxl,
    borderTopRightRadius: Radius.xxl,
    borderTopWidth: 1,
    borderTopColor: Colors.surfaceBorder,
    paddingTop: Spacing.xl,
    paddingHorizontal: Spacing.xl,
    maxHeight: '90%',
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginBottom: Spacing.md },
  flex:   { flex: 1 },
  ebayIcon: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: '#E5323820', alignItems: 'center', justifyContent: 'center' },
  title:  { fontSize: Typography.size.lg, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  sub:    { fontSize: Typography.size.xs, color: Colors.textTertiary, marginTop: 2 },

  scrollContent: { paddingBottom: Spacing.xl },
  section: { gap: Spacing.md },

  sectionTitle: { fontSize: Typography.size.xl, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  sectionDesc:  { fontSize: Typography.size.sm, color: Colors.textSecondary, lineHeight: 22 },

  // Permissions card
  permCard: {
    backgroundColor: Colors.surface, borderRadius: Radius.xl, padding: Spacing.base,
    borderWidth: 1, borderColor: Colors.surfaceBorder, gap: Spacing.sm,
  },
  permCardTitle: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.textPrimary, marginBottom: 4 },
  permRow:     { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  permIconWrap: { width: 26, height: 26, borderRadius: Radius.sm, backgroundColor: Colors.primaryDim, alignItems: 'center', justifyContent: 'center' },
  permText:    { flex: 1, fontSize: Typography.size.sm, color: Colors.textSecondary },

  // Connect button
  connectBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm,
    backgroundColor: '#E53238', borderRadius: Radius.md,
    paddingVertical: Spacing.base, ...Shadow.md,
  },
  connectBtnText: { fontSize: Typography.size.base, fontWeight: Typography.weight.bold, color: Colors.background },

  // Privacy note
  privacyNote: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.xs, paddingHorizontal: Spacing.xs },
  privacyNoteText: { flex: 1, fontSize: 11, color: Colors.textTertiary, lineHeight: 16 },

  // Polling state
  pollingIcon: { width: 80, height: 80, borderRadius: 40, backgroundColor: '#E5323815', alignItems: 'center', justifyContent: 'center' },
  pollingTitle: { fontSize: Typography.size.xl, fontWeight: Typography.weight.bold, color: Colors.textPrimary, textAlign: 'center' },
  pollingDesc:  { fontSize: Typography.size.sm, color: Colors.textSecondary, lineHeight: 21, textAlign: 'center' },
  checkBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm,
    backgroundColor: Colors.primaryDim, borderRadius: Radius.md,
    paddingVertical: Spacing.md, paddingHorizontal: Spacing.xl,
    borderWidth: 1, borderColor: Colors.primary + '40',
    alignSelf: 'stretch',
  },
  checkBtnText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.primary },
  retryLink:     { alignItems: 'center', paddingVertical: Spacing.xs },
  retryLinkText: { fontSize: Typography.size.sm, color: Colors.textTertiary, textDecorationLine: 'underline' },

  // Connected state
  connectedBanner: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.successDim, borderRadius: Radius.xl, padding: Spacing.base,
    borderWidth: 1, borderColor: Colors.success + '40',
  },
  connectedIconWrap: { width: 56, height: 56, borderRadius: 28, backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center' },
  connectedTitle: { fontSize: Typography.size.md, fontWeight: Typography.weight.bold, color: Colors.success },
  connectedAccount: { fontSize: Typography.size.xs, color: Colors.textSecondary, marginTop: 2 },
  connectedStatusDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: Colors.success },

  detailCard: {
    backgroundColor: Colors.surface, borderRadius: Radius.xl, padding: Spacing.base,
    borderWidth: 1, borderColor: Colors.surfaceBorder, gap: Spacing.sm,
  },
  detailRow:   { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  detailLabel: { fontSize: Typography.size.xs, color: Colors.textTertiary, flex: 1 },
  detailValue: { fontSize: Typography.size.xs, color: Colors.textSecondary, fontWeight: Typography.weight.medium },
  detailBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.successDim, borderRadius: Radius.pill, paddingHorizontal: 8, paddingVertical: 3 },
  detailBadgeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.success },
  detailBadgeText: { fontSize: 10, fontWeight: Typography.weight.bold, color: Colors.success },

  capGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  capItem: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.successDim, borderRadius: Radius.pill,
    paddingHorizontal: Spacing.sm, paddingVertical: Spacing.xs,
  },
  capLabel: { fontSize: 10, color: Colors.success, fontWeight: Typography.weight.semibold },

  warningCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm,
    backgroundColor: Colors.dangerDim, borderRadius: Radius.md, padding: Spacing.md,
    borderWidth: 1, borderColor: Colors.danger + '30',
  },
  warningTitle: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.danger },
  warningDesc:  { fontSize: Typography.size.xs, color: Colors.textSecondary, marginTop: 2 },

  reAuthBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm,
    backgroundColor: Colors.primary, borderRadius: Radius.md,
    paddingVertical: Spacing.md, borderWidth: 1, borderColor: 'transparent',
  },
  reAuthBtnText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.background },

  disconnectBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm,
    backgroundColor: Colors.dangerDim, borderRadius: Radius.md,
    paddingVertical: Spacing.md, borderWidth: 1, borderColor: Colors.danger + '40',
  },
  disconnectBtnText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.danger },

  // Error state
  errorCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm,
    backgroundColor: Colors.dangerDim, borderRadius: Radius.xl, padding: Spacing.base,
    borderWidth: 1, borderColor: Colors.danger + '30',
  },
  errorTitle: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.danger },
  errorMsg:   { fontSize: Typography.size.xs, color: Colors.textSecondary, marginTop: 2, lineHeight: 16 },

  adminHint: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm,
    backgroundColor: Colors.warningDim, borderRadius: Radius.md, padding: Spacing.md,
    borderWidth: 1, borderColor: Colors.warning + '30',
  },
  adminHintText: { flex: 1, fontSize: Typography.size.xs, color: Colors.textSecondary, lineHeight: 16 },
});

// ── eBay Capability Matrix ─────────────────────────────────────────────────

function EbayCapabilityMatrix({ ebayConnected }: { ebayConnected: boolean }) {
  return (
    <View style={matrixStyles.section}>
      <View style={matrixStyles.header}>
        <View style={matrixStyles.icon}>
          <MaterialIcons name="storefront" size={18} color="#E53238" />
        </View>
        <View style={matrixStyles.flex}>
          <Text style={matrixStyles.title}>eBay Integration Status</Text>
          <Text style={matrixStyles.sub}>
            {ebayConnected ? 'Connected via OAuth 2.0' : 'Tap "Connect eBay" to link your seller account'}
          </Text>
        </View>
        {ebayConnected ? (
          <View style={matrixStyles.connectedBadge}>
            <MaterialIcons name="check-circle" size={10} color={Colors.success} />
            <Text style={matrixStyles.connectedText}>Live</Text>
          </View>
        ) : null}
      </View>

      <View style={matrixStyles.list}>
        {[
          { label: 'Search eBay for valuation data',     status: 'ready',       icon: 'search' },
          { label: 'Detect collection/lot listings',     status: 'ready',       icon: 'category' },
          { label: 'Estimate decomposition value',       status: 'ready',       icon: 'auto-awesome' },
          { label: 'Calculate max bid/offer price',      status: 'ready',       icon: 'calculate' },
          { label: 'Publish listings (Selling API)',     status: ebayConnected ? 'ready' : 'oauth', icon: 'publish' },
          { label: 'Read orders (Fulfilment API)',       status: ebayConnected ? 'ready' : 'oauth', icon: 'receipt-long' },
          { label: 'Manage repricing',                  status: ebayConnected ? 'ready' : 'oauth', icon: 'price-change' },
          { label: 'Autonomous purchase / BIN',         status: 'partner',     icon: 'shopping-bag' },
          { label: 'Automated auction bidding',         status: 'partner',     icon: 'gavel' },
          { label: 'Make offer to seller',              status: 'partner',     icon: 'handshake' },
        ].map(cap => {
          const sc = {
            ready:   { label: 'Ready',        color: Colors.success, icon: 'check-circle' },
            oauth:   { label: 'Needs Connect', color: Colors.warning, icon: 'link' },
            partner: { label: 'Partner API',  color: Colors.danger,  icon: 'admin-panel-settings' },
          }[cap.status as 'ready' | 'oauth' | 'partner'];
          return (
            <View key={cap.label} style={matrixStyles.row}>
              <MaterialIcons name={cap.icon as any} size={14} color={Colors.textTertiary} />
              <Text style={matrixStyles.rowLabel}>{cap.label}</Text>
              <View style={[matrixStyles.rowBadge, { backgroundColor: sc.color + '20' }]}>
                <MaterialIcons name={sc.icon as any} size={9} color={sc.color} />
                <Text style={[matrixStyles.rowBadgeText, { color: sc.color }]}>{sc.label}</Text>
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const matrixStyles = StyleSheet.create({
  flex: { flex: 1 },
  section: { backgroundColor: Colors.surface, borderRadius: Radius.xl, padding: Spacing.base, gap: Spacing.md, borderWidth: 1, borderColor: Colors.surfaceBorder, ...Shadow.sm },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md },
  icon: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: '#E5323820', alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  sub: { fontSize: Typography.size.xs, color: Colors.textTertiary, marginTop: 2 },
  connectedBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.successDim, borderRadius: Radius.pill, paddingHorizontal: 8, paddingVertical: 3, alignSelf: 'flex-start' },
  connectedText: { fontSize: 9, fontWeight: Typography.weight.bold, color: Colors.success },
  list: { gap: Spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  rowLabel: { flex: 1, fontSize: Typography.size.xs, color: Colors.textSecondary },
  rowBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: Radius.pill },
  rowBadgeText: { fontSize: 9, fontWeight: Typography.weight.bold },
});

// ── Connector Card (non-eBay) ─────────────────────────────────────────────

function ConnectorCard({
  marketplaceId, connector, onConnect,
}: {
  marketplaceId: MarketplaceId;
  connector: MarketplaceConnector | null;
  onConnect: (id: MarketplaceId) => void;
}) {
  const def = MARKETPLACE_DEFINITIONS[marketplaceId];
  const status = connector?.status ?? 'disconnected';
  const isConnected = status === 'connected';

  const statusConfig: Record<string, { label: string; color: string; icon: string }> = {
    connected:       { label: 'Active',         color: Colors.success,      icon: 'check-circle' },
    disconnected:    { label: 'Not Connected',   color: Colors.textTertiary, icon: 'radio-button-unchecked' },
    error:           { label: 'Error',           color: Colors.danger,       icon: 'error' },
    requires_reauth: { label: 'Re-auth Needed',  color: Colors.warning,      icon: 'warning' },
    suspended:       { label: 'Suspended',       color: Colors.danger,       icon: 'block' },
  };
  const sc = statusConfig[status] ?? statusConfig['disconnected'];

  return (
    <Pressable
      onPress={() => onConnect(marketplaceId)}
      style={({ pressed }) => [cardStyles.card, pressed && { opacity: 0.92 }]}
    >
      <View style={cardStyles.header}>
        <View style={[cardStyles.iconWrap, { backgroundColor: def.color + '20' }]}>
          <MaterialIcons name={def.icon as any} size={22} color={def.color} />
        </View>
        <View style={cardStyles.flex}>
          <Text style={cardStyles.name}>{def.name}</Text>
          <Text style={cardStyles.desc} numberOfLines={1}>{def.description}</Text>
        </View>
        <View style={[cardStyles.statusBadge, { backgroundColor: sc.color + '20' }]}>
          <MaterialIcons name={sc.icon as any} size={10} color={sc.color} />
          <Text style={[cardStyles.statusText, { color: sc.color }]}>{sc.label}</Text>
        </View>
      </View>

      <View style={cardStyles.capRow}>
        {[
          { key: 'list', label: 'List', icon: 'list-alt' },
          { key: 'buy', label: 'Buy', icon: 'shopping-bag' },
          { key: 'reprice', label: 'Reprice', icon: 'price-change' },
          { key: 'readOrders', label: 'Orders', icon: 'receipt-long' },
        ].map(cap => {
          const available = def.capabilities[cap.key as keyof typeof def.capabilities];
          return (
            <View key={cap.key} style={[cardStyles.capChip, !available && cardStyles.capChipOff]}>
              <MaterialIcons name={cap.icon as any} size={10} color={available ? Colors.primary : Colors.textTertiary} />
              <Text style={[cardStyles.capText, !available && { color: Colors.textTertiary }]}>{cap.label}</Text>
            </View>
          );
        })}
      </View>

      <View style={[cardStyles.action, { borderColor: def.color + '40' }]}>
        <Text style={[cardStyles.actionText, { color: isConnected ? Colors.success : def.color }]}>
          {isConnected ? 'Manage Connection' : def.partnerApprovalRequired ? 'Configure (Requires Credentials)' : 'Connect'}
        </Text>
        <MaterialIcons name="chevron-right" size={14} color={isConnected ? Colors.success : def.color} />
      </View>
    </Pressable>
  );
}

const cardStyles = StyleSheet.create({
  card: { backgroundColor: Colors.surface, borderRadius: Radius.xl, padding: Spacing.base, gap: Spacing.sm, borderWidth: 1, borderColor: Colors.surfaceBorder, ...Shadow.sm },
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md },
  iconWrap: { width: 44, height: 44, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  desc: { fontSize: Typography.size.xs, color: Colors.textTertiary, marginTop: 2 },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 7, paddingVertical: 3, borderRadius: Radius.pill },
  statusText: { fontSize: 9, fontWeight: Typography.weight.bold },
  capRow: { flexDirection: 'row', gap: Spacing.xs, flexWrap: 'wrap' },
  capChip: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: Colors.primaryDim, borderRadius: Radius.pill, paddingHorizontal: 7, paddingVertical: 3 },
  capChipOff: { backgroundColor: Colors.surfaceHighlight },
  capText: { fontSize: 9, color: Colors.primary, fontWeight: Typography.weight.semibold },
  partnerBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: Colors.warningDim, borderRadius: Radius.pill, paddingHorizontal: 7, paddingVertical: 3 },
  partnerText: { fontSize: 9, color: Colors.warning },
  action: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 1, paddingTop: Spacing.sm },
  actionText: { fontSize: Typography.size.xs, fontWeight: Typography.weight.semibold },
});

// ── eBay Quick Status Card ─────────────────────────────────────────────────

function EbayStatusCard({
  connector, onManage,
}: {
  connector: MarketplaceConnector | null;
  onManage: () => void;
}) {
  const isConnected = connector?.status === 'connected';
  const isError     = connector?.status === 'error';
  const isReauth    = connector?.status === 'requires_reauth';

  return (
    <Pressable
      onPress={onManage}
      style={({ pressed }) => [statusCard.card, pressed && { opacity: 0.92 }]}
    >
      <View style={statusCard.row}>
        <View style={[statusCard.iconWrap, { backgroundColor: isConnected ? '#E5323820' : Colors.surfaceHighlight }]}>
          <MaterialIcons name="storefront" size={24} color={isConnected ? '#E53238' : Colors.textTertiary} />
        </View>
        <View style={statusCard.flex}>
          <Text style={statusCard.name}>eBay Seller Account</Text>
          {isConnected ? (
            <Text style={statusCard.meta}>
              {connector?.sellerAccountId ? connector.sellerAccountId : 'Connected'}
            </Text>
          ) : (
            <Text style={statusCard.meta}>Tap to connect your eBay selling account</Text>
          )}
        </View>
        <View style={[
          statusCard.badge,
          { backgroundColor: isConnected ? Colors.successDim : isError || isReauth ? Colors.dangerDim : Colors.surfaceHighlight },
        ]}>
          <View style={[statusCard.dot, { backgroundColor: isConnected ? Colors.success : isError || isReauth ? Colors.danger : Colors.textTertiary }]} />
          <Text style={[statusCard.badgeText, { color: isConnected ? Colors.success : isError || isReauth ? Colors.danger : Colors.textTertiary }]}>
            {isConnected ? 'Active' : isReauth ? 'Re-auth' : isError ? 'Error' : 'Disconnected'}
          </Text>
        </View>
      </View>

      {isConnected ? (
        <View style={statusCard.capRow}>
          {[
            { icon: 'list-alt', label: 'List' },
            { icon: 'publish', label: 'Publish' },
            { icon: 'receipt-long', label: 'Orders' },
            { icon: 'price-change', label: 'Reprice' },
            { icon: 'sync', label: 'Sync' },
          ].map(cap => (
            <View key={cap.label} style={statusCard.cap}>
              <MaterialIcons name={cap.icon as any} size={11} color={Colors.success} />
              <Text style={statusCard.capLabel}>{cap.label}</Text>
            </View>
          ))}
        </View>
      ) : null}

      <View style={statusCard.footer}>
        <Text style={statusCard.footerText}>
          {isConnected ? 'Manage connection, re-authorise or sync' : 'Connect your eBay seller account'}
        </Text>
        <MaterialIcons name="chevron-right" size={14} color={isConnected ? Colors.success : Colors.textTertiary} />
      </View>
    </Pressable>
  );
}

const statusCard = StyleSheet.create({
  card: { backgroundColor: Colors.surface, borderRadius: Radius.xl, borderWidth: 1, borderColor: Colors.surfaceBorder, overflow: 'hidden', ...Shadow.sm },
  row:  { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.base, paddingBottom: Spacing.sm },
  flex: { flex: 1 },
  iconWrap: { width: 48, height: 48, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  meta: { fontSize: Typography.size.xs, color: Colors.textTertiary, marginTop: 2 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: Radius.pill },
  dot:   { width: 6, height: 6, borderRadius: 3 },
  badgeText: { fontSize: 9, fontWeight: Typography.weight.bold },
  capRow: { flexDirection: 'row', gap: Spacing.xs, flexWrap: 'wrap', paddingHorizontal: Spacing.base, paddingBottom: Spacing.sm },
  cap: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: Colors.successDim, borderRadius: Radius.pill, paddingHorizontal: 7, paddingVertical: 3 },
  capLabel: { fontSize: 9, color: Colors.success, fontWeight: Typography.weight.semibold },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.base, paddingVertical: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.surfaceBorder, backgroundColor: Colors.surfaceHighlight },
  footerText: { fontSize: 10, color: Colors.textSecondary, flex: 1 },
});

// ── Main Screen ─────────────────────────────────────────────────────────────

const MARKETPLACE_ORDER: MarketplaceId[] = ['ebay'];

export default function MarketplacesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { tenant } = useApp();
  const { showAlert } = useAlert();

  const [connectors, setConnectors] = useState<MarketplaceConnector[]>([]);
  const [loading, setLoading] = useState(false);
  const [showEbaySheet, setShowEbaySheet] = useState(false);

  const load = useCallback(async () => {
    if (!tenant) return;
    setLoading(true);
    const { connectors: c } = await listConnectors(tenant.id);
    setConnectors(c);
    setLoading(false);
  }, [tenant?.id]);

  useEffect(() => { load(); }, [load]);

  const connectorMap  = new Map(connectors.map(c => [c.marketplaceId, c]));
  const connectedCount = connectors.filter(c => c.status === 'connected').length;
  const ebayConnector  = connectorMap.get('ebay') ?? null;
  const ebayConnected  = ebayConnector?.status === 'connected';

  const handleConnect = useCallback((id: MarketplaceId) => {
    if (id === 'ebay') {
      setShowEbaySheet(true);
      return;
    }

    const def = MARKETPLACE_DEFINITIONS[id];
    const connector = connectorMap.get(id);
    const isConnected = connector?.status === 'connected';

    if (isConnected) {
      showAlert(`${def.name} — Connected`, `Seller ID: ${connector?.sellerAccountId ?? 'Not set'}`, [{ text: 'Close' }]);
      return;
    }

    if (def.apiDocsUrl) {
      showAlert(
        `Connect ${def.name}`,
        `${def.partnerApprovalRequired ? 'Requires partner/API approval.\n\n' : ''}To connect, register at the developer portal and add credentials via Settings.\n\nDocs: ${def.apiDocsUrl}`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Settings', onPress: () => router.push('/settings' as any) },
        ]
      );
    } else {
      showAlert(def.name, `${def.description}\n\nManual listing only — use the ${def.name} app directly.`, [{ text: 'OK' }]);
    }
  }, [connectorMap, showAlert, router]);

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      <View style={[styles.header, { paddingTop: insets.top + Spacing.base }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
          <MaterialIcons name="arrow-back" size={20} color={Colors.textSecondary} />
        </Pressable>
        <Pressable onPress={() => router.replace('/(tabs)' as any)} style={styles.homeBtn} hitSlop={8}>
          <MaterialIcons name="dashboard" size={16} color={Colors.textTertiary} />
        </Pressable>
        <View style={styles.flex}>
          <Text style={styles.title}>Marketplaces</Text>
          <Text style={styles.subtitle}>
            {connectedCount > 0 ? `${connectedCount} connected` : 'Tap eBay to connect your seller account'}
          </Text>
        </View>
        <Pressable
          onPress={() => setShowEbaySheet(true)}
          style={({ pressed }) => [styles.ebayBtn, ebayConnected && styles.ebayBtnConnected, pressed && { opacity: 0.85 }]}
        >
          <MaterialIcons
            name={ebayConnected ? 'check-circle' : 'link'}
            size={14}
            color={Colors.textPrimary}
          />
          <Text style={styles.ebayBtnText}>{ebayConnected ? 'eBay Active' : 'Connect eBay'}</Text>
        </Pressable>
      </View>

      {(!tenant || loading) ? (
        <View style={styles.loading}><ActivityIndicator color={Colors.primary} size="large" /></View>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={Colors.primary} />}
        >
          {/* eBay status card — primary CTA */}
          <EbayStatusCard
            connector={ebayConnector}
            onManage={() => setShowEbaySheet(true)}
          />

          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>eBay Capability Matrix</Text>
          </View>
          <EbayCapabilityMatrix ebayConnected={ebayConnected} />

          {/* Other marketplaces (future) — show non-eBay only */}
          {MARKETPLACE_ORDER.filter(id => id !== 'ebay').length > 0 ? (
            <>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Other Marketplaces</Text>
                <Text style={styles.sectionSub}>Coming soon</Text>
              </View>
              {MARKETPLACE_ORDER.filter(id => id !== 'ebay').map(id => (
                <ConnectorCard
                  key={id}
                  marketplaceId={id}
                  connector={connectorMap.get(id) ?? null}
                  onConnect={handleConnect}
                />
              ))}
            </>
          ) : null}
        </ScrollView>
      )}

      <EbayConnectionSheet
        visible={showEbaySheet}
        onClose={() => setShowEbaySheet(false)}
        tenantId={tenant?.id ?? null}
        existingConnector={ebayConnector}
        onConnected={(connector) => {
          setConnectors(prev => {
            const idx = prev.findIndex(c => c.marketplaceId === 'ebay');
            if (idx >= 0) { const next = [...prev]; next[idx] = connector; return next; }
            return [connector, ...prev];
          });
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingHorizontal: Spacing.base, paddingBottom: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder,
  },
  backBtn: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.surfaceBorder },
  homeBtn: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.surfaceBorder },
  title:    { fontSize: Typography.size.lg, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  subtitle: { fontSize: Typography.size.xs, color: Colors.textTertiary, marginTop: 2 },
  ebayBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#E53238', borderRadius: Radius.pill, paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs },
  ebayBtnConnected: { backgroundColor: Colors.success },
  ebayBtnText: { fontSize: Typography.size.xs, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: Spacing.base, gap: Spacing.md },
  sectionHeader: { gap: 2 },
  sectionTitle: { fontSize: Typography.size.xs, fontWeight: Typography.weight.semibold, color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.6 },
  sectionSub:   { fontSize: Typography.size.xs, color: Colors.textTertiary },
});
