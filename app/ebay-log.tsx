// SWISH — eBay API Activity Log
// Shows every eBay API operation with status, error details, and retry info.
// Uses ebay_api_log table and ebay_sync_log for sync history.

import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, FlatList, Pressable,
  ActivityIndicator, RefreshControl, ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import { getSupabaseClient } from '@/template';
import { Colors, Typography, Spacing, Radius, Shadow } from '@/constants/theme';
import { useApp } from '@/hooks/useApp';

interface ApiLogEntry {
  id: string;
  operation: string;
  endpoint?: string;
  httpStatus?: number;
  ebayErrorCode?: string;
  errorMessage?: string;
  entityType?: string;
  entityId?: string;
  success: boolean;
  durationMs?: number;
  createdAt: string;
}

interface SyncEntry {
  id: string;
  syncType: string;
  status: string;
  recordsFetched: number;
  recordsCreated: number;
  recordsUpdated: number;
  recordsSkipped: number;
  startedAt: string;
  completedAt?: string;
  errorMessage?: string;
}

export default function EbayLogScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { tenant } = useApp();

  const [apiLog, setApiLog] = useState<ApiLogEntry[]>([]);
  const [syncLog, setSyncLog] = useState<SyncEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<'activity' | 'sync'>('activity');

  const load = useCallback(async () => {
    if (!tenant) return;
    const supabase = getSupabaseClient();

    const [apiRes, syncRes] = await Promise.all([
      supabase.from('ebay_api_log').select('*')
        .eq('tenant_id', tenant.id).order('created_at', { ascending: false }).limit(100),
      supabase.from('ebay_sync_log').select('*')
        .eq('tenant_id', tenant.id).order('started_at', { ascending: false }).limit(50),
    ]);

    setApiLog((apiRes.data ?? []).map((r: any) => ({
      id: r.id, operation: r.operation, endpoint: r.endpoint ?? undefined,
      httpStatus: r.http_status ?? undefined, ebayErrorCode: r.ebay_error_code ?? undefined,
      errorMessage: r.error_message ?? undefined, entityType: r.entity_type ?? undefined,
      entityId: r.entity_id ?? undefined, success: r.success ?? false,
      durationMs: r.duration_ms ?? undefined, createdAt: r.created_at,
    })));

    setSyncLog((syncRes.data ?? []).map((r: any) => ({
      id: r.id, syncType: r.sync_type, status: r.status,
      recordsFetched: r.records_fetched ?? 0, recordsCreated: r.records_created ?? 0,
      recordsUpdated: r.records_updated ?? 0, recordsSkipped: r.records_skipped ?? 0,
      startedAt: r.started_at, completedAt: r.completed_at ?? undefined,
      errorMessage: r.error_message ?? undefined,
    })));

    setLoading(false);
    setRefreshing(false);
  }, [tenant?.id]);

  useEffect(() => { load(); }, [load]);
  const onRefresh = useCallback(() => { setRefreshing(true); load(); }, [load]);

  const successCount = apiLog.filter(l => l.success).length;
  const failedCount = apiLog.filter(l => !l.success).length;

  return (
    <View style={s.container}>
      <StatusBar style="light" />

      <View style={[s.header, { paddingTop: insets.top + Spacing.base }]}>
        <Pressable onPress={() => router.back()} style={s.backBtn} hitSlop={8}>
          <MaterialIcons name="arrow-back" size={20} color={Colors.textSecondary} />
        </Pressable>
        <View style={s.flex}>
          <Text style={s.title}>Activity Log</Text>
          <Text style={s.subtitle}>
            {apiLog.length} entries · {successCount} ok · {failedCount > 0 ? `${failedCount} failed` : 'no errors'}
          </Text>
        </View>
      </View>

      {/* Tabs */}
      <View style={s.tabRow}>
        {([
          { id: 'activity', label: 'API Activity' },
          { id: 'sync', label: 'Sync History' },
        ] as { id: typeof tab; label: string }[]).map(t => (
          <Pressable key={t.id} onPress={() => setTab(t.id)} style={[s.tabBtn, tab === t.id && s.tabBtnActive]}>
            <Text style={[s.tabText, tab === t.id && s.tabTextActive]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <View style={s.loading}><ActivityIndicator color={Colors.primary} size="large" /></View>
      ) : tab === 'activity' ? (
        <FlatList
          data={apiLog}
          keyExtractor={l => l.id}
          contentContainerStyle={[s.list, { paddingBottom: insets.bottom + 80 }]}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
          renderItem={({ item }) => (
            <View style={[s.logRow, !item.success && s.logRowFailed]}>
              <View style={[s.logIcon, { backgroundColor: item.success ? Colors.successDim : Colors.dangerDim }]}>
                <MaterialIcons name={item.success ? 'check-circle' : 'error'} size={14} color={item.success ? Colors.success : Colors.danger} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <View style={s.logTopRow}>
                  <Text style={s.logOperation}>{item.operation}</Text>
                  {item.httpStatus ? (
                    <Text style={[s.logStatus, { color: item.httpStatus >= 400 ? Colors.danger : Colors.textTertiary }]}>
                      HTTP {item.httpStatus}
                    </Text>
                  ) : null}
                  {item.durationMs ? <Text style={s.logDuration}>{item.durationMs}ms</Text> : null}
                </View>
                {item.entityType && item.entityId ? (
                  <Text style={s.logEntity}>{item.entityType} · {item.entityId.slice(0, 20)}</Text>
                ) : null}
                {!item.success && item.errorMessage ? (
                  <Text style={s.logError} numberOfLines={2}>{item.errorMessage}</Text>
                ) : null}
                {item.ebayErrorCode ? (
                  <Text style={s.logEbayCode}>eBay: {item.ebayErrorCode}</Text>
                ) : null}
                <Text style={s.logDate}>
                  {new Date(item.createdAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </Text>
              </View>
            </View>
          )}
          ListEmptyComponent={
            <View style={s.empty}>
              <MaterialIcons name="history" size={48} color={Colors.textTertiary} />
              <Text style={s.emptyTitle}>No activity logged yet</Text>
              <Text style={s.emptyText}>API operations will appear here as you use SWISH eBay features.</Text>
            </View>
          }
        />
      ) : (
        <FlatList
          data={syncLog}
          keyExtractor={l => l.id}
          contentContainerStyle={[s.list, { paddingBottom: insets.bottom + 80 }]}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
          renderItem={({ item }) => {
            const statusColor = item.status === 'completed' ? Colors.success
              : item.status === 'failed' ? Colors.danger
              : Colors.warning;
            return (
              <View style={s.syncRow}>
                <View style={[s.syncIcon, { backgroundColor: statusColor + '20' }]}>
                  <MaterialIcons name={item.status === 'completed' ? 'sync' : 'sync-problem'} size={14} color={statusColor} />
                </View>
                <View style={{ flex: 1, gap: 3 }}>
                  <View style={s.syncTopRow}>
                    <Text style={s.syncType}>{item.syncType}</Text>
                    <View style={[s.syncBadge, { backgroundColor: statusColor + '20' }]}>
                      <Text style={[s.syncBadgeText, { color: statusColor }]}>{item.status}</Text>
                    </View>
                  </View>
                  <Text style={s.syncMeta}>
                    {item.recordsFetched} fetched · {item.recordsCreated} created · {item.recordsUpdated} updated · {item.recordsSkipped} skipped
                  </Text>
                  {item.errorMessage ? (
                    <Text style={s.syncError}>{item.errorMessage}</Text>
                  ) : null}
                  <Text style={s.syncDate}>
                    {new Date(item.startedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    {item.completedAt ? ` → ${new Date(item.completedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : ''}
                  </Text>
                </View>
              </View>
            );
          }}
          ListEmptyComponent={
            <View style={s.empty}>
              <MaterialIcons name="sync" size={48} color={Colors.textTertiary} />
              <Text style={s.emptyTitle}>No sync history</Text>
              <Text style={s.emptyText}>Sync operations will appear here.</Text>
            </View>
          }
        />
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
  tabRow: {
    flexDirection: 'row', gap: Spacing.sm,
    paddingHorizontal: Spacing.base, paddingVertical: Spacing.sm,
    borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder,
  },
  tabBtn: {
    flex: 1, paddingVertical: Spacing.sm, borderRadius: Radius.md,
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.surfaceBorder,
    alignItems: 'center',
  },
  tabBtnActive: { backgroundColor: Colors.primaryDim, borderColor: Colors.primary + '50' },
  tabText: { fontSize: Typography.size.sm, color: Colors.textSecondary },
  tabTextActive: { color: Colors.primary, fontWeight: Typography.weight.semibold },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: Spacing.base, gap: Spacing.sm },
  logRow: {
    flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start',
    backgroundColor: Colors.surface, borderRadius: Radius.xl, padding: Spacing.md,
    borderWidth: 1, borderColor: Colors.surfaceBorder,
  },
  logRowFailed: { borderColor: Colors.danger + '40', backgroundColor: Colors.dangerDim + '30' },
  logIcon: { width: 30, height: 30, borderRadius: Radius.sm, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  logTopRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  logOperation: { flex: 1, fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.textPrimary },
  logStatus: { fontSize: 10, fontWeight: Typography.weight.bold },
  logDuration: { fontSize: 9, color: Colors.textTertiary },
  logEntity: { fontSize: 10, color: Colors.textTertiary },
  logError: { fontSize: Typography.size.xs, color: Colors.danger, lineHeight: 15 },
  logEbayCode: { fontSize: 9, color: Colors.warning },
  logDate: { fontSize: 9, color: Colors.textTertiary, marginTop: 2 },
  syncRow: {
    flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start',
    backgroundColor: Colors.surface, borderRadius: Radius.xl, padding: Spacing.md,
    borderWidth: 1, borderColor: Colors.surfaceBorder,
  },
  syncIcon: { width: 30, height: 30, borderRadius: Radius.sm, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  syncTopRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  syncType: { flex: 1, fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.textPrimary, textTransform: 'capitalize' },
  syncBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: Radius.pill },
  syncBadgeText: { fontSize: 9, fontWeight: Typography.weight.bold, textTransform: 'capitalize' },
  syncMeta: { fontSize: 10, color: Colors.textTertiary },
  syncError: { fontSize: 10, color: Colors.danger },
  syncDate: { fontSize: 9, color: Colors.textTertiary, marginTop: 2 },
  empty: { alignItems: 'center', gap: Spacing.md, paddingVertical: 60, paddingHorizontal: Spacing.xl },
  emptyTitle: { fontSize: Typography.size.lg, fontWeight: Typography.weight.semibold, color: Colors.textSecondary },
  emptyText: { fontSize: Typography.size.sm, color: Colors.textTertiary, textAlign: 'center', lineHeight: 20 },
});
