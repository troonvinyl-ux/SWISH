// SWISH — eBay unpublished-offer round-trip diagnostic
// Uses the existing authenticated tenant and server-side eBay credentials.
// Never publishes an offer. The server rejects anything not explicitly UNPUBLISHED.

import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, TextInput, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors, Typography, Spacing, Radius } from '@/constants/theme';
import { useApp } from '@/hooks/useApp';
import { getSupabaseClient } from '@/template';

type OfferSnapshot = {
  offerId?: string; sku?: string; status?: string; marketplaceId?: string;
  categoryId?: string; format?: string; availableQuantity?: number | null;
};
type Result = {
  ok?: boolean; error?: string; message?: string; offer?: OfferSnapshot;
  before?: OfferSnapshot; after?: OfferSnapshot; changedFields?: string[];
};

export default function EbayDraftSyncTestScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { tenant } = useApp();
  const [offerId, setOfferId] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [phase, setPhase] = useState<'read' | 'roundtrip' | null>(null);

  async function runTest(action: 'read_offer' | 'import_offer' | 'sync_category_from_ebay' | 'round_trip_unpublished' | 'push_swish_category') {
    if (!tenant?.id) {
      setResult({ error: 'SWISH has not finished loading your organisation. Return to the app and try again.' });
      return;
    }
    if (!offerId.trim()) {
      setResult({ error: 'Enter the offer ID from your unpublished eBay draft.' });
      return;
    }
    setBusy(true);
    setResult(null);
    setPhase(action === 'read_offer' ? 'read' : 'roundtrip');
    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase.functions.invoke('swish-ebay-draft-sync-test', {
        body: { action, tenantId: tenant.id, offerId: offerId.trim() },
      });
      if (error) throw new Error(error.message || 'Could not call the draft diagnostic. The Edge Function may not be deployed yet.');
      setResult(data as Result);
    } catch (error: any) {
      setResult({ error: error?.message || 'Draft diagnostic failed.' });
    } finally {
      setBusy(false);
    }
  }

  const shownOffer = result?.offer ?? result?.after ?? result?.before;

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <View style={[styles.header, { paddingTop: insets.top + Spacing.base }]}>
        <Pressable onPress={() => router.back()} style={styles.back} accessibilityLabel="Go back">
          <MaterialIcons name="arrow-back" size={20} color={Colors.textPrimary} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Draft Category Test</Text>
          <Text style={styles.subtitle}>eBay UK · unpublished offer diagnostic</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.xl }]}>
        <View style={styles.notice}>
          <MaterialIcons name="shield" size={22} color={Colors.success} />
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={styles.noticeTitle}>Unpublished drafts only</Text>
            <Text style={styles.body}>
              The backend checks the live eBay status before any update. It will refuse offers not explicitly marked UNPUBLISHED. It never creates or publishes a listing.
            </Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>1 · Select your eBay draft</Text>
        <Text style={styles.body}>In eBay, open the unpublished draft and copy its Inventory API offer ID. Enter that ID below—not the live listing item number.</Text>
        <TextInput
          value={offerId}
          onChangeText={setOfferId}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="eBay offer ID"
          placeholderTextColor={Colors.textTertiary}
          editable={!busy}
          style={styles.input}
        />

        <Pressable disabled={busy} onPress={() => runTest('read_offer')} style={[styles.button, busy && styles.disabled]}>
          {busy && phase === 'read' ? <ActivityIndicator color={Colors.background} /> : <MaterialIcons name="download" size={18} color={Colors.background} />}
          <Text style={styles.buttonText}>Read draft from eBay</Text>
        </Pressable>

        <Pressable disabled={busy} onPress={() => runTest('import_offer')} style={[styles.button, styles.secondaryButton, busy && styles.disabled]}>
          <MaterialIcons name="inventory" size={18} color={Colors.background} />
          <Text style={styles.buttonText}>Import unpublished draft into SWISH</Text>
        </Pressable>

        <Text style={styles.sectionTitle}>2 · Push unchanged draft back</Text>
        <Text style={styles.body}>This sends the same writable offer fields back to eBay, then reads the draft again and compares the category and other tracked fields.</Text>
        <Pressable disabled={busy} onPress={() => runTest('round_trip_unpublished')} style={[styles.button, styles.secondaryButton, busy && styles.disabled]}>
          {busy && phase === 'roundtrip' ? <ActivityIndicator color={Colors.background} /> : <MaterialIcons name="sync" size={18} color={Colors.background} />}
          <Text style={styles.buttonText}>Round-trip unpublished draft</Text>
        </Pressable>

        <Text style={styles.sectionTitle}>3 · Sync a category change from eBay</Text>
        <Text style={styles.body}>After changing the category on eBay (leave the offer unpublished), use this to copy eBay's exact category ID into the linked SWISH draft.</Text>
        <Pressable disabled={busy} onPress={() => runTest('sync_category_from_ebay')} style={[styles.button, styles.secondaryButton, busy && styles.disabled]}>
          <MaterialIcons name="sync-alt" size={18} color={Colors.background} />
          <Text style={styles.buttonText}>Sync category from eBay to SWISH</Text>
        </Pressable>
        <Text style={styles.sectionTitle}>4 · Push SWISH category back to eBay</Text>
        <Text style={styles.body}>Checks the SWISH category against eBay UK taxonomy before writing it back. The offer must remain unpublished.</Text>
        <Pressable disabled={busy} onPress={() => runTest('push_swish_category')} style={[styles.button, styles.secondaryButton, busy && styles.disabled]}>
          <MaterialIcons name="cloud-upload" size={18} color={Colors.background} />
          <Text style={styles.buttonText}>Push SWISH category to eBay</Text>
        </Pressable>

        {busy ? <View style={styles.loading}><ActivityIndicator color={Colors.primary} /><Text style={styles.body}>Checking the eBay draft…</Text></View> : null}

        {result ? (
          <View style={[styles.resultCard, result.error ? styles.errorCard : null]}>
            <Text style={[styles.resultTitle, result.error ? { color: Colors.danger } : null]}>
              {result.error ? 'Test stopped' : result.ok ? 'Check complete' : 'Review result'}
            </Text>
            {result.error ? <Text style={styles.body}>{result.error}</Text> : null}
            {result.message ? <Text style={styles.body}>{result.message}</Text> : null}\n            {result.inventoryId ? <Text style={styles.body}>SWISH inventory ID: {result.inventoryId}</Text> : null}\n            {result.itemId ? <Text style={styles.body}>SWISH item ID: {result.itemId}</Text> : null}\n            {result.syncedCategoryId ? <Text style={styles.body}>Synced category ID: {result.syncedCategoryId}</Text> : null}\n            {result.pushedCategoryId ? <Text style={styles.body}>Pushed category ID: {result.pushedCategoryId}</Text> : null}
            {shownOffer ? (
              <View style={styles.details}>
                <Detail label="Offer ID" value={shownOffer.offerId} />
                <Detail label="SKU" value={shownOffer.sku} />
                <Detail label="Status" value={shownOffer.status} />
                <Detail label="Marketplace" value={shownOffer.marketplaceId} />
                <Detail label="Category ID" value={shownOffer.categoryId} />
                <Detail label="Format" value={shownOffer.format} />
              </View>
            ) : null}
            {result.before && result.after ? (
              <>
                <Text style={styles.sectionTitle}>Before / after</Text>
                <View style={styles.details}>
                  <Detail label="Before category" value={result.before.categoryId} />
                  <Detail label="After category" value={result.after.categoryId} />
                  <Detail label="After status" value={result.after.status} />
                  <Detail label="Changed fields" value={result.changedFields?.join(', ') || 'None'} />
                </View>
              </>
            ) : null}
          </View>
        ) : null}

        <View style={styles.warning}>
          <MaterialIcons name="info-outline" size={18} color={Colors.warning} />
          <Text style={styles.body}>
            Use the sequence above on a disposable unpublished draft. Never use a published listing. Import creates a SWISH inventory item/listing; category sync copies the exact eBay category ID; push is blocked unless eBay UK taxonomy verifies the category as a leaf. The backend must be deployed before these controls can work.
          </Text>
        </View>

        <Pressable onPress={() => router.push('/ebay-hub' as any)} style={[styles.button, styles.returnButton]}>
          <MaterialIcons name="arrow-back" size={16} color={Colors.background} />
          <Text style={styles.buttonText}>Return to eBay Hub</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

function Detail({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value === undefined || value === null || value === '' ? '—' : String(value)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingHorizontal: Spacing.base, paddingBottom: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder },
  back: { width: 38, height: 38, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.surfaceBorder },
  title: { fontSize: Typography.size.xl, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  subtitle: { fontSize: Typography.size.xs, color: Colors.textTertiary, marginTop: 2 },
  content: { padding: Spacing.base, gap: Spacing.md },
  notice: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md, padding: Spacing.base, borderRadius: Radius.xl, borderWidth: 1, borderColor: Colors.success + '55', backgroundColor: Colors.surface },
  noticeTitle: { fontSize: Typography.size.md, fontWeight: Typography.weight.bold, color: Colors.success },
  body: { fontSize: Typography.size.sm, color: Colors.textSecondary, lineHeight: 21 },
  sectionTitle: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.textPrimary, marginTop: Spacing.sm },
  input: { minHeight: 48, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.surfaceBorder, backgroundColor: Colors.surface, color: Colors.textPrimary, paddingHorizontal: Spacing.md, fontSize: Typography.size.md },
  button: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.primary, borderRadius: Radius.md, paddingVertical: Spacing.md, marginTop: Spacing.xs },
  secondaryButton: { backgroundColor: Colors.accent },
  returnButton: { backgroundColor: Colors.primary, marginTop: Spacing.md },
  buttonText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.background },
  disabled: { opacity: 0.55 },
  loading: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.md },
  resultCard: { gap: Spacing.sm, borderRadius: Radius.xl, borderWidth: 1, borderColor: Colors.success + '55', backgroundColor: Colors.surface, padding: Spacing.base },
  errorCard: { borderColor: Colors.danger + '55' },
  resultTitle: { fontSize: Typography.size.md, fontWeight: Typography.weight.bold, color: Colors.success },
  details: { gap: 0, borderTopWidth: 1, borderTopColor: Colors.surfaceBorder, marginTop: Spacing.xs },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.md, paddingVertical: Spacing.sm, borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder },
  detailLabel: { flex: 1, fontSize: Typography.size.xs, color: Colors.textTertiary },
  detailValue: { flex: 1, fontSize: Typography.size.xs, color: Colors.textPrimary, textAlign: 'right' },
  warning: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, padding: Spacing.md, borderRadius: Radius.md, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.warning + '40' },
});
