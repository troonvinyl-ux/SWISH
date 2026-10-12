// SWISH — eBay Account & Policies
// Shows eBay seller account health, business policies, selling limits.
// Uses marketplace_connectors table + eBay Account API (where authorised).

import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  ActivityIndicator, RefreshControl, Linking,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import { getSupabaseClient } from '@/template';
import { Colors, Typography, Spacing, Radius, Shadow } from '@/constants/theme';
import { useApp } from '@/hooks/useApp';
import { useAlert } from '@/template';

interface ConnectorInfo {
  status: string;
  sellerAccountId?: string;
  tokenExpiry?: string;
  connectedAt?: string;
  lastSync?: string;
  canList: boolean;
  canPublish: boolean;
  canReprice: boolean;
  canReadOrders: boolean;
  canFulfil: boolean;
}

export default function EbayAccountScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { tenant } = useApp();
  const { showAlert } = useAlert();

  const [connector, setConnector] = useState<ConnectorInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!tenant) return;
    const supabase = getSupabaseClient();
    const { data } = await supabase
      .from('marketplace_connectors')
      .select('status, seller_account_id, access_token_expires_at, connected_at, last_sync_at, can_list, can_publish, can_reprice, can_read_orders, can_fulfil')
      .eq('tenant_id', tenant.id)
      .eq('marketplace_id', 'ebay')
      .maybeSingle();

    if (data) {
      setConnector({
        status: data.status,
        sellerAccountId: data.seller_account_id ?? undefined,
        tokenExpiry: data.access_token_expires_at ?? undefined,
        connectedAt: data.connected_at ?? undefined,
        lastSync: data.last_sync_at ?? undefined,
        canList: data.can_list ?? false,
        canPublish: data.can_publish ?? false,
        canReprice: data.can_reprice ?? false,
        canReadOrders: data.can_read_orders ?? false,
        canFulfil: data.can_fulfil ?? false,
      });
    }
    setLoading(false);
    setRefreshing(false);
  }, [tenant?.id]);

  useEffect(() => { load(); }, [load]);
  const onRefresh = useCallback(() => { setRefreshing(true); load(); }, [load]);

  const tokenExpiry = connector?.tokenExpiry ? new Date(connector.tokenExpiry) : null;
  const tokenDaysLeft = tokenExpiry ? Math.floor((tokenExpiry.getTime() - Date.now()) / (1000 * 60 * 60 * 24)) : null;
  const tokenExpired = tokenExpiry ? tokenExpiry <= new Date() : false;
  const isConnected = connector?.status === 'connected';

  return (
    <View style={s.container}>
      <StatusBar style="light" />

      <View style={[s.header, { paddingTop: insets.top + Spacing.base }]}>
        <Pressable onPress={() => router.back()} style={s.backBtn} hitSlop={8}>
          <MaterialIcons name="arrow-back" size={20} color={Colors.textSecondary} />
        </Pressable>
        <View style={s.flex}>
          <Text style={s.title}>eBay Account</Text>
          <Text style={s.subtitle}>Connection health and capabilities</Text>
        </View>
        <Pressable
          onPress={() => router.push('/marketplaces' as any)}
          style={s.reconnectBtn}
          hitSlop={4}
        >
          <MaterialIcons name="link" size={14} color={Colors.primary} />
          <Text style={s.reconnectBtnText}>
            {isConnected ? 'Manage' : 'Connect'}
          </Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={s.loading}><ActivityIndicator color={Colors.primary} size="large" /></View>
      ) : (
        <ScrollView
          contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 80 }]}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
        >
          {/* Connection status */}
          <View style={[s.statusCard, { borderColor: isConnected ? Colors.success + '50' : Colors.danger + '50' }]}>
            <View style={[s.statusIcon, { backgroundColor: isConnected ? Colors.successDim : Colors.dangerDim }]}>
              <MaterialIcons
                name={isConnected ? 'check-circle' : 'link-off'}
                size={24}
                color={isConnected ? Colors.success : Colors.danger}
              />
            </View>
            <View style={s.statusContent}>
              <Text style={[s.statusTitle, { color: isConnected ? Colors.success : Colors.danger }]}>
                {isConnected ? 'eBay Connected' : 'Not Connected'}
              </Text>
              {connector?.sellerAccountId ? (
                <Text style={s.statusSub}>Account: {connector.sellerAccountId}</Text>
              ) : null}
              {connector?.connectedAt ? (
                <Text style={s.statusSub}>
                  Connected: {new Date(connector.connectedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                </Text>
              ) : null}
            </View>
          </View>

          {/* Token health */}
          <View style={s.section}>
            <Text style={s.sectionTitle}>TOKEN STATUS</Text>
            <View style={s.sectionCard}>
              <View style={s.infoRow}>
                <MaterialIcons name="vpn-key" size={16} color={tokenExpired ? Colors.danger : Colors.success} />
                <View style={{ flex: 1 }}>
                  <Text style={s.infoLabel}>Access Token</Text>
                  <Text style={[s.infoValue, { color: tokenExpired ? Colors.danger : Colors.success }]}>
                    {tokenExpired ? 'Expired — re-authorise required'
                      : tokenDaysLeft !== null ? `Valid · ${tokenDaysLeft} days remaining`
                      : isConnected ? 'Active' : 'Not obtained'}
                  </Text>
                </View>
                {(tokenExpired || (tokenDaysLeft !== null && tokenDaysLeft < 7)) ? (
                  <Pressable
                    onPress={() => router.push('/marketplaces' as any)}
                    style={s.refreshTokenBtn}
                    hitSlop={4}
                  >
                    <Text style={s.refreshTokenText}>Reconnect</Text>
                  </Pressable>
                ) : null}
              </View>
              {connector?.tokenExpiry ? (
                <View style={s.infoRow}>
                  <MaterialIcons name="schedule" size={16} color={Colors.textTertiary} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.infoLabel}>Expiry Date</Text>
                    <Text style={s.infoValue}>
                      {new Date(connector.tokenExpiry).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </Text>
                  </View>
                </View>
              ) : null}
            </View>
          </View>

          {/* OAuth Scopes / Capabilities */}
          <View style={s.section}>
            <Text style={s.sectionTitle}>GRANTED CAPABILITIES</Text>
            <View style={s.sectionCard}>
              {[
                { key: 'canList', label: 'Create & manage listings', scope: 'sell.inventory', icon: 'list-alt' },
                { key: 'canPublish', label: 'Publish to eBay', scope: 'sell.inventory', icon: 'publish' },
                { key: 'canReprice', label: 'Update prices', scope: 'sell.inventory', icon: 'price-change' },
                { key: 'canReadOrders', label: 'Read orders', scope: 'sell.fulfillment', icon: 'receipt-long' },
                { key: 'canFulfil', label: 'Update fulfilment', scope: 'sell.fulfillment', icon: 'local-shipping' },
              ].map(cap => {
                const granted = isConnected && (connector as any)[cap.key];
                return (
                  <View key={cap.key} style={s.capRow}>
                    <MaterialIcons name={cap.icon as any} size={14} color={granted ? Colors.success : Colors.textTertiary} />
                    <View style={{ flex: 1 }}>
                      <Text style={[s.capLabel, !granted && { color: Colors.textTertiary }]}>{cap.label}</Text>
                      <Text style={s.capScope}>{cap.scope}</Text>
                    </View>
                    <MaterialIcons
                      name={granted ? 'check-circle' : 'radio-button-unchecked'}
                      size={16}
                      color={granted ? Colors.success : Colors.textTertiary}
                    />
                  </View>
                );
              })}
            </View>
          </View>

          {/* Capabilities requiring Partner approval */}
          <View style={s.section}>
            <Text style={s.sectionTitle}>REQUIRES PARTNER APPROVAL</Text>
            <View style={[s.sectionCard, { borderColor: Colors.warning + '30' }]}>
              {[
                { label: 'Autonomous purchasing (Buy API)', icon: 'shopping-bag' },
                { label: 'Automated auction bidding', icon: 'gavel' },
                { label: 'Send offers to buyers', icon: 'handshake' },
                { label: 'Promoted listings management', icon: 'campaign' },
                { label: 'eBay Finances API (payouts)', icon: 'account-balance-wallet' },
              ].map(cap => (
                <View key={cap.label} style={s.capRow}>
                  <MaterialIcons name={cap.icon as any} size={14} color={Colors.textTertiary} />
                  <Text style={[s.capLabel, { color: Colors.textTertiary, flex: 1 }]}>{cap.label}</Text>
                  <View style={s.partnerBadge}>
                    <Text style={s.partnerBadgeText}>Partner req.</Text>
                  </View>
                </View>
              ))}
              <Pressable
                onPress={() => Linking.openURL('https://developer.ebay.com/develop/get-started')}
                style={s.partnerLink}
                hitSlop={4}
              >
                <MaterialIcons name="open-in-new" size={12} color={Colors.info} />
                <Text style={s.partnerLinkText}>Apply for eBay Partner access</Text>
              </Pressable>
            </View>
          </View>

          {/* Business policies note */}
          <View style={s.section}>
            <Text style={s.sectionTitle}>BUSINESS POLICIES</Text>
            <View style={s.noteCard}>
              <MaterialIcons name="info-outline" size={14} color={Colors.info} />
              <View style={{ flex: 1 }}>
                <Text style={s.noteTitle}>eBay Account API</Text>
                <Text style={s.noteText}>
                  Payment policies, fulfilment policies, return policies, and selling limits
                  are available via the eBay Account API. These require the sell.account OAuth scope
                  which is included in your SWISH connection.
                  Full policy management is available in eBay Seller Hub.
                </Text>
                <Pressable
                  onPress={() => Linking.openURL('https://www.ebay.co.uk/sh/ovw')}
                  style={s.sellerHubLink}
                >
                  <MaterialIcons name="open-in-new" size={12} color={Colors.primary} />
                  <Text style={s.sellerHubLinkText}>Open eBay Seller Hub</Text>
                </Pressable>
              </View>
            </View>
          </View>

          {/* OAuth callback URL */}
          <View style={s.callbackCard}>
            <Text style={s.callbackLabel}>OAuth Callback URL</Text>
            <Text style={s.callbackUrl}>
              https://iwgaqieyoahmcjfziwga.backend.onspace.ai/functions/v1/swish-ebay-oauth?route=callback
            </Text>
          </View>
        </ScrollView>
      )}
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
    width: 34, height: 34, borderRadius: Radius.md,
    backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.surfaceBorder,
  },
  title: { fontSize: Typography.size.xl, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  subtitle: { fontSize: Typography.size.xs, color: Colors.textTertiary, marginTop: 1 },
  reconnectBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.primaryDim, borderRadius: Radius.md,
    paddingHorizontal: Spacing.sm, paddingVertical: 6,
    borderWidth: 1, borderColor: Colors.primary + '40',
  },
  reconnectBtnText: { fontSize: Typography.size.xs, fontWeight: Typography.weight.semibold, color: Colors.primary },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: Spacing.base, gap: Spacing.md },
  statusCard: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.surface, borderRadius: Radius.xl,
    padding: Spacing.base, borderWidth: 1, ...Shadow.sm,
  },
  statusIcon: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  statusContent: { flex: 1, gap: 3 },
  statusTitle: { fontSize: Typography.size.lg, fontWeight: Typography.weight.bold },
  statusSub: { fontSize: Typography.size.xs, color: Colors.textTertiary },
  section: { gap: 6 },
  sectionTitle: { fontSize: Typography.size.xs, fontWeight: Typography.weight.bold, color: Colors.textTertiary, letterSpacing: 0.6 },
  sectionCard: {
    backgroundColor: Colors.surface, borderRadius: Radius.xl,
    borderWidth: 1, borderColor: Colors.surfaceBorder, overflow: 'hidden',
  },
  infoRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingHorizontal: Spacing.base, paddingVertical: Spacing.sm,
    borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder,
  },
  infoLabel: { fontSize: Typography.size.xs, color: Colors.textTertiary },
  infoValue: { fontSize: Typography.size.sm, color: Colors.textPrimary, fontWeight: Typography.weight.medium, marginTop: 2 },
  refreshTokenBtn: {
    backgroundColor: Colors.warning, borderRadius: Radius.sm,
    paddingHorizontal: Spacing.sm, paddingVertical: 4,
  },
  refreshTokenText: { fontSize: 10, fontWeight: Typography.weight.bold, color: Colors.background },
  capRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingHorizontal: Spacing.base, paddingVertical: Spacing.sm,
    borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder,
  },
  capLabel: { fontSize: Typography.size.sm, color: Colors.textPrimary },
  capScope: { fontSize: 9, color: Colors.textTertiary, marginTop: 1 },
  partnerBadge: {
    backgroundColor: Colors.warningDim, borderRadius: Radius.pill,
    paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1, borderColor: Colors.warning + '30',
  },
  partnerBadgeText: { fontSize: 9, color: Colors.warning, fontWeight: Typography.weight.bold },
  partnerLink: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: Spacing.base, paddingVertical: Spacing.sm,
  },
  partnerLinkText: { fontSize: Typography.size.xs, color: Colors.info },
  noteCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md,
    backgroundColor: Colors.infoDim, borderRadius: Radius.xl,
    padding: Spacing.base, borderWidth: 1, borderColor: Colors.info + '30',
  },
  noteTitle: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.info, marginBottom: 4 },
  noteText: { fontSize: Typography.size.xs, color: Colors.textSecondary, lineHeight: 17 },
  sellerHubLink: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    marginTop: Spacing.sm,
  },
  sellerHubLinkText: { fontSize: Typography.size.xs, color: Colors.primary },
  callbackCard: {
    backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.md,
    padding: Spacing.base, gap: 4,
  },
  callbackLabel: { fontSize: 9, fontWeight: Typography.weight.bold, color: Colors.textTertiary, letterSpacing: 0.5 },
  callbackUrl: { fontSize: 10, color: Colors.textTertiary, lineHeight: 14 },
});
