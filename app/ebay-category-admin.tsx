// SWISH — eBay Category Catalogue Admin
// Admin screen for managing the local EBAY_GB category catalogue.
// Shows sync stats, triggers category sync, and lets users test category validation.

import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  ActivityIndicator, TextInput,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors, Typography, Spacing, Radius, Shadow } from '@/constants/theme';
import { useApp } from '@/hooks/useApp';
import { getSupabaseClient } from '@/template';

export default function EbayCategoryAdminScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { tenant } = useApp();

  const [stats, setStats] = useState<any>(null);
  const [statsLoading, setStatsLoading] = useState(false);

  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<any>(null);

  const [testCatId, setTestCatId] = useState('');
  const [testQuery, setTestQuery] = useState('');
  const [testLoading, setTestLoading] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);

  const [seedLoading, setSeedLoading] = useState(false);
  const [seedResult, setSeedResult] = useState<any>(null);

  const supabase = getSupabaseClient();

  const loadStats = useCallback(async () => {
    if (!tenant?.id) return;
    setStatsLoading(true);
    try {
      const { data } = await supabase.functions.invoke('swish-ebay-category', {
        body: { route: 'get_sync_stats', tenantId: tenant.id },
      });
      setStats(data);
    } catch (e: any) {
      setStats({ error: e.message });
    }
    setStatsLoading(false);
  }, [tenant?.id]);

  useEffect(() => { loadStats(); }, [loadStats]);

  const handleSyncTree = useCallback(async () => {
    if (!tenant?.id || syncing) return;
    setSyncing(true);
    setSyncResult(null);
    try {
      const { data } = await supabase.functions.invoke('swish-ebay-category', {
        body: { route: 'sync_tree_metadata', tenantId: tenant.id },
      });
      setSyncResult({ type: 'tree', ...data });
      await loadStats();
    } catch (e: any) {
      setSyncResult({ error: e.message });
    }
    setSyncing(false);
  }, [tenant?.id, syncing, loadStats]);

  const handleSeedPriority = useCallback(async () => {
    if (!tenant?.id || seedLoading) return;
    setSeedLoading(true);
    setSeedResult(null);
    try {
      const { data } = await supabase.functions.invoke('swish-ebay-category', {
        body: { route: 'seed_priority_branches', tenantId: tenant.id, depth: 4 },
      });
      setSeedResult(data);
      await loadStats();
    } catch (e: any) {
      setSeedResult({ error: e.message });
    }
    setSeedLoading(false);
  }, [tenant?.id, seedLoading, loadStats]);

  const handleTestValidate = useCallback(async () => {
    if (!tenant?.id || !testCatId.trim()) return;
    setTestLoading(true);
    setTestResult(null);
    try {
      const { data } = await supabase.functions.invoke('swish-ebay-category', {
        body: { route: 'validate_category', tenantId: tenant.id, categoryId: testCatId.trim() },
      });
      setTestResult({ type: 'validate', ...data });
    } catch (e: any) {
      setTestResult({ error: e.message });
    }
    setTestLoading(false);
  }, [tenant?.id, testCatId]);

  const handleTestSuggest = useCallback(async () => {
    if (!tenant?.id || !testQuery.trim()) return;
    setTestLoading(true);
    setTestResult(null);
    try {
      const { data } = await supabase.functions.invoke('swish-ebay-category', {
        body: { route: 'get_category_suggestions', tenantId: tenant.id, query: testQuery.trim() },
      });
      setTestResult({ type: 'suggest', ...data });
    } catch (e: any) {
      setTestResult({ error: e.message });
    }
    setTestLoading(false);
  }, [tenant?.id, testQuery]);

  const handleRunTest = useCallback(async () => {
    if (!tenant?.id) return;
    setTestLoading(true);
    setTestResult(null);
    try {
      const { data } = await supabase.functions.invoke('swish-ebay-category', {
        body: { route: 'test', tenantId: tenant.id },
      });
      setTestResult({ type: 'test', ...data });
    } catch (e: any) {
      setTestResult({ error: e.message });
    }
    setTestLoading(false);
  }, [tenant?.id]);

  const fmtDate = (d: string | null) => d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'Never';

  return (
    <View style={s.container}>
      <StatusBar style="light" />
      <View style={[s.header, { paddingTop: insets.top + Spacing.sm }]}>
        <Pressable onPress={() => router.back()} style={s.backBtn} hitSlop={8}>
          <MaterialIcons name="arrow-back" size={20} color={Colors.textSecondary} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={s.headerTitle}>eBay Category Catalogue</Text>
          <Text style={s.headerSub}>EBAY_GB · Local catalogue admin</Text>
        </View>
        <Pressable onPress={loadStats} disabled={statsLoading} style={s.refreshBtn} hitSlop={8}>
          {statsLoading
            ? <ActivityIndicator size="small" color={Colors.primary} style={{ width: 16, height: 16 }} />
            : <MaterialIcons name="refresh" size={16} color={Colors.primary} />}
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 40 }]} showsVerticalScrollIndicator={false}>

        {/* Stats Card */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Catalogue Status</Text>
          <View style={s.statsCard}>
            {statsLoading ? (
              <ActivityIndicator color={Colors.primary} />
            ) : stats?.error ? (
              <Text style={s.errorText}>{stats.error}</Text>
            ) : stats ? (
              <>
                <View style={s.statRow}>
                  <Text style={s.statLabel}>Marketplace</Text>
                  <Text style={s.statValue}>EBAY_GB</Text>
                </View>
                <View style={s.statRow}>
                  <Text style={s.statLabel}>Category Tree ID</Text>
                  <Text style={[s.statValue, { fontFamily: 'monospace' }]}>{stats.categoryTreeId ?? '—'}</Text>
                </View>
                <View style={s.statRow}>
                  <Text style={s.statLabel}>Tree Version</Text>
                  <Text style={[s.statValue, { fontFamily: 'monospace', fontSize: 11 }]}>{stats.categoryTreeVersion ?? '—'}</Text>
                </View>
                <View style={s.statRow}>
                  <Text style={s.statLabel}>Last Synced</Text>
                  <Text style={s.statValue}>{fmtDate(stats.lastSyncedAt)}</Text>
                </View>
                <View style={s.divider} />
                <View style={s.statRow}>
                  <Text style={s.statLabel}>Total Categories</Text>
                  <Text style={[s.statValue, { color: Colors.primary }]}>{(stats.totalCategories ?? 0).toLocaleString()}</Text>
                </View>
                <View style={s.statRow}>
                  <Text style={s.statLabel}>Leaf Categories (listable)</Text>
                  <Text style={[s.statValue, { color: Colors.success }]}>{(stats.leafCategories ?? 0).toLocaleString()}</Text>
                </View>
                <View style={s.statRow}>
                  <Text style={s.statLabel}>Inactive Categories</Text>
                  <Text style={[s.statValue, { color: Colors.textTertiary }]}>{(stats.inactiveCategories ?? 0).toLocaleString()}</Text>
                </View>
                <View style={s.statRow}>
                  <Text style={s.statLabel}>Cached Aspect Sets</Text>
                  <Text style={[s.statValue, { color: Colors.accent }]}>{(stats.cachedAspects ?? 0).toLocaleString()}</Text>
                </View>
                {!stats.tokenAvailable ? (
                  <View style={[s.warningRow, { marginTop: Spacing.sm }]}>
                    <MaterialIcons name="warning" size={13} color={Colors.warning} />
                    <Text style={s.warningText}>eBay API credentials not configured — only local DB stats shown.</Text>
                  </View>
                ) : null}
              </>
            ) : (
              <Text style={s.emptyText}>Tap refresh to load stats</Text>
            )}
          </View>
        </View>

        {/* Sync Controls */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Synchronisation</Text>
          <Text style={s.sectionDesc}>
            The local catalogue caches EBAY_GB categories from the official eBay Taxonomy API.
            Run a sync to populate or refresh the catalogue. All operations are idempotent — safe to run multiple times.
          </Text>

          {/* Sync tree metadata */}
          <Pressable onPress={handleSyncTree} disabled={syncing || !tenant} style={[s.actionBtn, (syncing || !tenant) && { opacity: 0.5 }]}>
            {syncing ? <ActivityIndicator size="small" color={Colors.background} style={{ width: 16, height: 16 }} /> : <MaterialIcons name="account-tree" size={16} color={Colors.background} />}
            <Text style={s.actionBtnText}>Refresh Tree Metadata</Text>
          </Pressable>
          <Text style={s.actionDesc}>Fetches the current EBAY_GB treeId and treeVersion.</Text>

          {/* Seed priority branches */}
          <Pressable onPress={handleSeedPriority} disabled={seedLoading || !tenant} style={[s.actionBtn, s.actionBtnGreen, (seedLoading || !tenant) && { opacity: 0.5 }]}>
            {seedLoading ? <ActivityIndicator size="small" color={Colors.background} style={{ width: 16, height: 16 }} /> : <MaterialIcons name="download" size={16} color={Colors.background} />}
            <Text style={s.actionBtnText}>Sync Priority Branches</Text>
          </Pressable>
          <Text style={s.actionDesc}>Downloads Coins, Medals, Militaria, Collectables, Jewellery &amp; Stamps branches (4 levels deep). Takes ~30s.</Text>

          {syncResult ? (
            <View style={[s.resultCard, syncResult.error ? s.resultCardError : s.resultCardSuccess]}>
              {syncResult.error ? (
                <Text style={s.resultError}>{syncResult.error}</Text>
              ) : syncResult.type === 'tree' ? (
                <Text style={s.resultText}>
                  Tree updated: ID={syncResult.treeId}, version={syncResult.treeVersion}, stored={syncResult.stored ? 'yes' : 'no'}
                </Text>
              ) : (
                <Text style={s.resultText}>
                  Sync done: {syncResult.synced?.toLocaleString() ?? 0} categories stored.
                  {syncResult.errors?.length > 0 ? ` ${syncResult.errors.length} errors.` : ''}
                </Text>
              )}
            </View>
          ) : null}

          {seedResult ? (
            <View style={[s.resultCard, seedResult.error ? s.resultCardError : s.resultCardSuccess]}>
              {seedResult.error ? (
                <Text style={s.resultError}>{seedResult.error}</Text>
              ) : (
                <Text style={s.resultText}>
                  Priority sync done: {seedResult.synced?.toLocaleString() ?? 0} categories stored.
                  {seedResult.errors?.length > 0 ? ` ${seedResult.errors.length} errors.` : ' No errors.'}
                </Text>
              )}
            </View>
          ) : null}
        </View>

        {/* Test & Validate */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Test &amp; Validate</Text>

          {/* Validate by ID */}
          <View style={s.inputRow}>
            <TextInput
              style={s.input}
              value={testCatId}
              onChangeText={setTestCatId}
              placeholder="Category ID (e.g. 4726)"
              placeholderTextColor={Colors.textTertiary}
              keyboardType="number-pad"
              returnKeyType="done"
            />
            <Pressable onPress={handleTestValidate} disabled={testLoading || !testCatId.trim() || !tenant}
              style={[s.inlineBtn, (!testCatId.trim() || testLoading) && { opacity: 0.5 }]}>
              <Text style={s.inlineBtnText}>Validate</Text>
            </Pressable>
          </View>

          {/* Suggest by keyword */}
          <View style={s.inputRow}>
            <TextInput
              style={s.input}
              value={testQuery}
              onChangeText={setTestQuery}
              placeholder="Item title (e.g. Mughal Empire Rupee)"
              placeholderTextColor={Colors.textTertiary}
              returnKeyType="search"
            />
            <Pressable onPress={handleTestSuggest} disabled={testLoading || !testQuery.trim() || !tenant}
              style={[s.inlineBtn, (!testQuery.trim() || testLoading) && { opacity: 0.5 }]}>
              <Text style={s.inlineBtnText}>Suggest</Text>
            </Pressable>
          </View>

          {/* Full test */}
          <Pressable onPress={handleRunTest} disabled={testLoading || !tenant}
            style={[s.actionBtn, s.actionBtnPurple, (testLoading || !tenant) && { opacity: 0.5 }]}>
            {testLoading ? <ActivityIndicator size="small" color={Colors.background} style={{ width: 16, height: 16 }} /> : <MaterialIcons name="science" size={16} color={Colors.background} />}
            <Text style={s.actionBtnText}>Run Full Test (Mughal Rupee)</Text>
          </Pressable>
          <Text style={s.actionDesc}>Tests Mughal Rupee suggestion, validates British Coins (4726), fetches aspects. Shows exactly what Preflight and createOffer will use.</Text>

          {testLoading ? <ActivityIndicator color={Colors.primary} style={{ marginTop: Spacing.md }} /> : null}

          {testResult && !testLoading ? (
            <View style={s.resultCard}>
              {testResult.error ? (
                <Text style={s.resultError}>{testResult.error}</Text>
              ) : testResult.type === 'validate' ? (
                <>
                  <View style={s.resultRow}>
                    <MaterialIcons
                      name={testResult.valid ? 'check-circle' : 'cancel'}
                      size={16} color={testResult.valid ? Colors.success : Colors.danger}
                    />
                    <Text style={[s.resultLabel, { color: testResult.valid ? Colors.success : Colors.danger }]}>
                      {testResult.valid ? 'VALID EBAY_GB LEAF' : 'INVALID'}
                    </Text>
                  </View>
                  {[
                    ['Category ID', testResult.categoryId],
                    ['Category Name', testResult.categoryName],
                    ['Category Path', testResult.categoryPath],
                    ['Is Leaf', testResult.isLeaf ? 'Yes' : 'No'],
                    ['Active', testResult.active !== false ? 'Yes' : 'No'],
                    ['Tree ID', testResult.categoryTreeId],
                    ['Tree Version', testResult.categoryTreeVersion],
                    ['Source', testResult.source],
                    ['Reason', testResult.reason],
                  ].filter(([, v]) => v != null && v !== '').map(([k, v]) => (
                    <View key={k as string} style={s.resultRow}>
                      <Text style={s.resultKey}>{k}:</Text>
                      <Text style={s.resultVal} numberOfLines={3}>{String(v)}</Text>
                    </View>
                  ))}
                </>
              ) : testResult.type === 'suggest' ? (
                <>
                  <Text style={s.resultLabel}>Suggestions (source: {testResult.source})</Text>
                  {/* Info note about parent categories */}
                  <View style={s.suggestInfoRow}>
                    <MaterialIcons name="warning" size={11} color={Colors.warning} />
                    <Text style={[s.suggestInfoText, { color: Colors.warning }]}>
                      Only leaf (✓) categories are valid for listing. Parent/navigation categories cannot be submitted directly.
                    </Text>
                  </View>
                  {(testResult.suggestions ?? []).map((sug: any, i: number) => (
                    <View key={sug.id} style={[s.resultRow, { alignItems: 'flex-start' }]}>
                      <MaterialIcons name={sug.isLeaf ? 'sell' : 'folder-open'} size={13} color={sug.isLeaf ? Colors.success : Colors.primary} />
                      <View style={{ flex: 1 }}>
                        <Text style={s.resultVal}>{i + 1}. {sug.name} (ID: {sug.id})</Text>
                        {sug.categoryPath ? <Text style={s.resultKey}>{sug.categoryPath}</Text> : null}
                        <Text style={[s.resultKey, { color: sug.isLeaf ? Colors.success : Colors.danger }]}>
                          {sug.isLeaf ? '✓ Leaf — valid for listing' : '⚠ Parent/navigation — NOT listable; drill down to children'}
                        </Text>
                      </View>
                    </View>
                  ))}
                  {(testResult.suggestions ?? []).length === 0 ? <Text style={s.resultKey}>No suggestions returned.</Text> : null}
                </>
              ) : testResult.type === 'test' ? (
                <>
                  <Text style={[s.resultLabel, { color: testResult.status === 'ok' ? Colors.success : Colors.danger }]}>
                    {testResult.status === 'ok' ? 'All checks passed' : 'Some checks failed'}
                  </Text>
                  <Text style={s.resultKey}>Tree: ID={testResult.categoryTreeId} v={testResult.categoryTreeVersion}</Text>

                  <Text style={[s.resultLabel, { marginTop: Spacing.sm }]}>Mughal Rupee Suggestions:</Text>
                  {(testResult.mughalSuggestion ?? []).map((item: any, i: number) => (
                    <View key={item.categoryId} style={s.resultRow}>
                      <MaterialIcons name={item.isLeaf ? 'sell' : 'folder-open'} size={12} color={item.isLeaf ? Colors.success : Colors.primary} />
                      <Text style={s.resultVal} numberOfLines={2}>
                        {i + 1}. {item.categoryName} ({item.categoryId}){'\n'}{item.categoryPath}
                      </Text>
                    </View>
                  ))}
                  {(testResult.mughalSuggestion ?? []).length === 0 ? <Text style={s.resultKey}>No suggestions — check eBay credentials.</Text> : null}

                  <Text style={[s.resultLabel, { marginTop: Spacing.sm }]}>British Coins (4726) Validation:</Text>
                  <Text style={s.resultVal}>
                    {testResult.britishCoinsValidation?.valid ? 'Valid EBAY_GB leaf' : 'Invalid: ' + testResult.britishCoinsValidation?.reason}
                  </Text>

                  {testResult.britishCoinsAspects ? (
                    <>
                      <Text style={[s.resultLabel, { marginTop: Spacing.sm }]}>British Coins Aspects:</Text>
                      <Text style={s.resultVal}>{testResult.britishCoinsAspects.totalAspects} aspects, {testResult.britishCoinsAspects.requiredAspects?.length ?? 0} required</Text>
                      <Text style={s.resultKey}>Required: {testResult.britishCoinsAspects.requiredAspects?.join(', ') || 'none'}</Text>
                    </>
                  ) : null}

                  {testResult.dbStats ? (
                    <>
                      <Text style={[s.resultLabel, { marginTop: Spacing.sm }]}>DB Stats:</Text>
                      <Text style={s.resultVal}>{testResult.dbStats.totalCategories} categories · {testResult.dbStats.leafCategories} leaf</Text>
                    </>
                  ) : null}
                </>
              ) : (
                <Text style={s.resultText}>{JSON.stringify(testResult, null, 2).slice(0, 800)}</Text>
              )}
            </View>
          ) : null}
        </View>

        {/* Info */}
        <View style={s.infoCard}>
          <MaterialIcons name="info-outline" size={13} color={Colors.info} />
          <Text style={s.infoText}>
            The SWISH local EBAY_GB catalogue is the authoritative source for category validation.
            Categories are obtained from the official eBay Taxonomy API and cached locally.
            Only leaf categories (is_leaf=true) are valid for listing submission. Parent/navigation categories are automatically resolved to leaf descendants.
            The AI never invents category IDs — all IDs come from eBay and are validated before submission.
          </Text>
        </View>

      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingHorizontal: Spacing.base, paddingBottom: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: Radius.md,
    backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.surfaceBorder,
  },
  headerTitle: { fontSize: Typography.size.base, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  headerSub: { fontSize: 10, color: Colors.textTertiary, marginTop: 2 },
  refreshBtn: {
    width: 34, height: 34, borderRadius: Radius.md,
    backgroundColor: Colors.primaryDim, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.primary + '40',
  },
  content: { padding: Spacing.base, gap: Spacing.lg },

  section: { gap: Spacing.sm },
  sectionTitle: {
    fontSize: 10, fontWeight: Typography.weight.bold, color: Colors.textTertiary,
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  sectionDesc: { fontSize: Typography.size.xs, color: Colors.textTertiary, lineHeight: 18 },

  statsCard: {
    backgroundColor: Colors.surface, borderRadius: Radius.xl, padding: Spacing.base,
    borderWidth: 1, borderColor: Colors.surfaceBorder, gap: Spacing.xs,
    ...Shadow.sm,
  },
  statRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 3 },
  statLabel: { fontSize: Typography.size.xs, color: Colors.textTertiary },
  statValue: { fontSize: Typography.size.xs, fontWeight: Typography.weight.semibold, color: Colors.textSecondary, maxWidth: '60%', textAlign: 'right' },
  divider: { height: 1, backgroundColor: Colors.surfaceBorder, marginVertical: Spacing.xs },

  actionBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm,
    backgroundColor: Colors.primary, borderRadius: Radius.md, paddingVertical: Spacing.md,
    marginTop: Spacing.xs,
  },
  actionBtnGreen: { backgroundColor: Colors.success },
  actionBtnPurple: { backgroundColor: '#7C3AED' },
  actionBtnText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.background },
  actionDesc: { fontSize: 10, color: Colors.textTertiary, lineHeight: 15 },

  resultCard: {
    backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: Spacing.md,
    borderWidth: 1, borderColor: Colors.surfaceBorder, gap: Spacing.xs,
  },
  resultCardSuccess: { borderColor: Colors.success + '40', backgroundColor: Colors.successDim + '30' },
  resultCardError: { borderColor: Colors.danger + '40', backgroundColor: Colors.danger + '08' },
  resultText: { fontSize: 11, color: Colors.textSecondary, lineHeight: 17, fontFamily: 'monospace' },
  resultError: { fontSize: 12, color: Colors.danger },
  resultLabel: { fontSize: 12, fontWeight: Typography.weight.bold, color: Colors.textSecondary, marginTop: 2 },
  resultRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  resultKey: { fontSize: 10, color: Colors.textTertiary, flex: 1 },
  resultVal: { fontSize: 11, color: Colors.textPrimary, flex: 2, lineHeight: 16 },

  suggestInfoRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 5,
    backgroundColor: Colors.infoDim ?? (Colors.info + '15'), borderRadius: Radius.sm,
    padding: Spacing.xs, marginBottom: Spacing.xs,
  },
  suggestInfoText: { flex: 1, fontSize: 10, color: Colors.info, lineHeight: 14 },

  inputRow: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'center' },
  input: {
    flex: 1, height: 42, backgroundColor: Colors.surface, borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.surfaceBorder,
    paddingHorizontal: Spacing.sm, fontSize: Typography.size.sm, color: Colors.textPrimary,
  },
  inlineBtn: {
    backgroundColor: Colors.primaryDim, borderRadius: Radius.md,
    paddingHorizontal: Spacing.md, height: 42, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.primary + '40',
  },
  inlineBtnText: { fontSize: Typography.size.xs, fontWeight: Typography.weight.bold, color: Colors.primary },

  warningRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.xs },
  warningText: { flex: 1, fontSize: 10, color: Colors.warning, lineHeight: 15 },
  errorText: { fontSize: 12, color: Colors.danger },
  emptyText: { fontSize: 12, color: Colors.textTertiary, textAlign: 'center' },

  infoCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm,
    backgroundColor: Colors.infoDim, borderRadius: Radius.xl,
    padding: Spacing.md, borderWidth: 1, borderColor: Colors.info + '30',
  },
  infoText: { flex: 1, fontSize: Typography.size.xs, color: Colors.info, lineHeight: 17 },
});
