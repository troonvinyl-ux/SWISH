// Owner-only live Edge Function execution monitor.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StatusBar, StyleSheet, Text, View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { useAuth, getSupabaseClient } from '@/template';
import { useApp } from '@/hooks/useApp';
import { isSwishMasterAdmin } from '@/contexts/AppContext';
import { Colors, Radius, Spacing, Typography } from '@/constants/theme';

type EdgeLog = {
  id: string;
  invocation_id: string;
  function_name: string;
  tenant_id: string | null;
  niche_id: string | null;
  outcome: 'success' | 'client_error' | 'failure';
  status_code: number;
  duration_ms: number;
  error_code: string | null;
  created_at: string;
};

type Filter = 'all' | 'errors';

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function outcomeColor(outcome: EdgeLog['outcome']) {
  return outcome === 'success' ? Colors.success : outcome === 'failure' ? Colors.danger : Colors.warning;
}

export default function EdgeFunctionLogsScreen() {
  const { user, loading: authLoading } = useAuth();
  const { isMasterAdmin, tenantLoading, nichePreferencesLoading } = useApp();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [rows, setRows] = useState<EdgeLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [realtime, setRealtime] = useState(false);
  const [loadError, setLoadError] = useState('');

  const allowed = !authLoading && !tenantLoading && !nichePreferencesLoading
    && isSwishMasterAdmin(user?.email) && isMasterAdmin;

  const load = useCallback(async (quiet = false) => {
    if (!allowed) return;
    if (!quiet) setLoading(true);
    const { data, error } = await getSupabaseClient()
      .from('edge_function_logs')
      .select('id,invocation_id,function_name,tenant_id,niche_id,outcome,status_code,duration_ms,error_code,created_at')
      .order('created_at', { ascending: false })
      .limit(250);
    if (error) setLoadError('Unable to read execution records. Apply the Edge Function logging migration and check the owner account.');
    else {
      setRows((data ?? []) as EdgeLog[]);
      setLoadError('');
    }
    setLoading(false);
    setRefreshing(false);
  }, [allowed]);

  useEffect(() => {
    if (!allowed) return;
    void load();
    const client = getSupabaseClient();
    const channel = client.channel('swish-edge-function-live')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'edge_function_logs' }, (payload) => {
        const incoming = payload.new as EdgeLog;
        setRows(current => [incoming, ...current.filter(row => row.id !== incoming.id)].slice(0, 250));
      })
      .subscribe(status => setRealtime(status === 'SUBSCRIBED'));
    return () => { void client.removeChannel(channel); };
  }, [allowed, load]);

  const visibleRows = useMemo(() => filter === 'all'
    ? rows
    : rows.filter(row => row.outcome !== 'success'), [rows, filter]);
  const successes = rows.filter(row => row.outcome === 'success').length;
  const failures = rows.filter(row => row.outcome === 'failure').length;
  const errors = rows.filter(row => row.outcome !== 'success').length;

  if (authLoading || tenantLoading || nichePreferencesLoading) {
    return <SafeAreaView style={styles.center}><ActivityIndicator color={Colors.primary}/><Text style={styles.muted}>Checking owner access…</Text></SafeAreaView>;
  }
  if (!allowed) return <Redirect href={'/master-admin' as any}/>;

  const renderRow = ({ item }: { item: EdgeLog }) => {
    const color = outcomeColor(item.outcome);
    return <View style={styles.logCard}>
      <View style={styles.logTop}>
        <Text style={styles.functionName}>{item.function_name}</Text>
        <View style={[styles.statusPill, { borderColor: color, backgroundColor: color + '18' }]}>
          <Text style={[styles.statusText, { color }]}>{item.status_code} · {item.outcome.replace('_', ' ')}</Text>
        </View>
      </View>
      <View style={styles.metaRow}>
        <Text style={styles.meta}>{formatTime(item.created_at)}</Text>
        <Text style={styles.meta}>{item.duration_ms.toLocaleString()} ms</Text>
      </View>
      <View style={styles.metaRow}>
        <Text style={styles.meta}>Niche: {item.niche_id || '—'}</Text>
        <Text style={styles.meta}>Tenant: {item.tenant_id ? item.tenant_id.slice(0, 8) : '—'}</Text>
      </View>
      {item.error_code ? <Text style={styles.errorCode}>Error class: {item.error_code}</Text> : null}
      <Text selectable style={styles.invocation}>Invocation {item.invocation_id}</Text>
    </View>;
  };

  return <SafeAreaView style={styles.screen} edges={['top','left','right']}>
    <StatusBar barStyle="light-content"/>
    <View style={[styles.header, { paddingTop: Math.max(Spacing.sm, insets.top ? 0 : Spacing.md) }]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back to Master Admin" onPress={() => router.replace('/master-admin' as any)} style={styles.back}>
        <MaterialIcons name="arrow-back" size={21} color={Colors.textPrimary}/>
      </Pressable>
      <View style={styles.headerCopy}>
        <Text style={styles.eyebrow}>PLATFORM TELEMETRY</Text>
        <Text style={styles.title}>Edge Function Logs</Text>
        <Text style={styles.subtitle}>Live execution monitor · latest 250 records</Text>
      </View>
      <View style={[styles.livePill, { borderColor: realtime ? Colors.success : Colors.warning }]}>
        <View style={[styles.liveDot, { backgroundColor: realtime ? Colors.success : Colors.warning }]}/>
        <Text style={[styles.liveText, { color: realtime ? Colors.success : Colors.warning }]}>{realtime ? 'LIVE' : 'CONNECTING'}</Text>
      </View>
    </View>

    <View style={styles.metrics}>
      <Metric label="Recorded" value={String(rows.length)} color={Colors.primary}/>
      <Metric label="Successful" value={String(successes)} color={Colors.success}/>
      <Metric label="Errors" value={String(errors)} color={errors ? Colors.danger : Colors.textSecondary}/>
    </View>
    <View style={styles.toolbar}>
      <View style={styles.filters}>
        <FilterButton label="All activity" active={filter === 'all'} onPress={() => setFilter('all')}/>
        <FilterButton label="Errors only" active={filter === 'errors'} onPress={() => setFilter('errors')}/>
      </View>
      <Pressable accessibilityRole="button" onPress={() => { setRefreshing(true); void load(true); }} style={styles.refresh}>
        <MaterialIcons name="refresh" size={18} color={Colors.primary}/>
        <Text style={styles.refreshText}>Refresh</Text>
      </Pressable>
    </View>

    {loadError ? <View style={styles.notice}><MaterialIcons name="info-outline" size={18} color={Colors.warning}/><Text style={styles.noticeText}>{loadError}</Text></View> : null}
    {loading ? <View style={styles.center}><ActivityIndicator color={Colors.primary}/><Text style={styles.muted}>Loading execution history…</Text></View> :
      <FlatList
        data={visibleRows}
        keyExtractor={item => item.id}
        renderItem={renderRow}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(true); }} tintColor={Colors.primary}/>}
        ListEmptyComponent={<View style={styles.empty}><MaterialIcons name="receipt-long" size={34} color={Colors.textTertiary}/><Text style={styles.emptyTitle}>No execution records yet</Text><Text style={styles.muted}>Once the migration is applied and instrumented functions are deployed, each invocation will appear here.</Text></View>}
      />}
  </SafeAreaView>;
}

function Metric({ label, value, color }: { label: string; value: string; color: string }) {
  return <View style={styles.metric}><Text style={[styles.metricValue, { color }]}>{value}</Text><Text style={styles.metricLabel}>{label}</Text></View>;
}
function FilterButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" onPress={onPress} style={[styles.filterButton, active && styles.filterActive]}><Text style={[styles.filterText, active && styles.filterTextActive]}>{label}</Text></Pressable>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.base, paddingBottom: Spacing.md },
  back: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.surfaceBorder },
  headerCopy: { flex: 1, gap: 2 },
  eyebrow: { color: Colors.primary, fontSize: 9, fontWeight: '900', letterSpacing: 1.1 },
  title: { color: Colors.textPrimary, fontSize: 21, fontWeight: '900' },
  subtitle: { color: Colors.textSecondary, fontSize: Typography.size.xs },
  livePill: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderRadius: Radius.pill, paddingHorizontal: 8, paddingVertical: 5 },
  liveDot: { width: 6, height: 6, borderRadius: 3 },
  liveText: { fontSize: 9, fontWeight: '900' },
  metrics: { flexDirection: 'row', marginHorizontal: Spacing.base, backgroundColor: Colors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceBorder, paddingVertical: Spacing.md, marginBottom: Spacing.md },
  metric: { flex: 1, alignItems: 'center', gap: 2 },
  metricValue: { fontSize: 21, fontWeight: '900' },
  metricLabel: { color: Colors.textSecondary, fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.6 },
  toolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.base, paddingBottom: Spacing.md },
  filters: { flexDirection: 'row', gap: 6 },
  filterButton: { borderRadius: Radius.pill, borderWidth: 1, borderColor: Colors.surfaceBorder, paddingHorizontal: 11, paddingVertical: 7 },
  filterActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  filterText: { color: Colors.textSecondary, fontSize: 11, fontWeight: '700' },
  filterTextActive: { color: '#111111' },
  refresh: { flexDirection: 'row', alignItems: 'center', gap: 4, padding: 7 },
  refreshText: { color: Colors.primary, fontSize: 11, fontWeight: '800' },
  list: { paddingHorizontal: Spacing.base, paddingBottom: Spacing.xl, gap: Spacing.sm },
  logCard: { backgroundColor: Colors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceBorder, padding: Spacing.md, gap: 7 },
  logTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  functionName: { flex: 1, color: Colors.textPrimary, fontSize: Typography.size.sm, fontWeight: '800' },
  statusPill: { borderWidth: 1, borderRadius: Radius.pill, paddingHorizontal: 7, paddingVertical: 4 },
  statusText: { fontSize: 9, fontWeight: '900', textTransform: 'uppercase' },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  meta: { color: Colors.textSecondary, fontSize: 10 },
  errorCode: { color: Colors.danger, fontSize: 10, fontWeight: '700' },
  invocation: { color: Colors.textTertiary, fontSize: 9 },
  notice: { flexDirection: 'row', gap: Spacing.sm, marginHorizontal: Spacing.base, marginBottom: Spacing.md, padding: Spacing.md, borderRadius: Radius.md, backgroundColor: Colors.surfaceHighlight },
  noticeText: { flex: 1, color: Colors.textSecondary, fontSize: Typography.size.xs, lineHeight: 17 },
  empty: { alignItems: 'center', gap: Spacing.sm, padding: Spacing.xl, marginTop: Spacing.xl },
  emptyTitle: { color: Colors.textPrimary, fontWeight: '800', fontSize: Typography.size.base },
  muted: { color: Colors.textSecondary, fontSize: Typography.size.xs, textAlign: 'center' },
});
