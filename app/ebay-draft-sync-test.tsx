// SWISH — eBay unpublished-offer round-trip diagnostic
// Uses the existing authenticated tenant and server-side eBay credentials.
// Never publishes an offer. The server rejects anything not explicitly UNPUBLISHED.

import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, TextInput, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Colors, Typography, Spacing, Radius } from '@/constants/theme';
import { useApp } from '@/hooks/useApp';
import { getSupabaseClient } from '@/template';

type OfferSnapshot = {
  offerId?: string; sku?: string; status?: string; marketplaceId?: string;
  categoryId?: string; format?: string; availableQuantity?: number | null;
};
type DraftOffer = { offerId: string; sku?: string; title?: string; imageUrl?: string; categoryId?: string; status?: string; format?: string; availableQuantity?: number | null; marketplaceId?: string };
type Result = {
  ok?: boolean; error?: string; message?: string; offer?: OfferSnapshot; offers?: DraftOffer[];
  before?: OfferSnapshot; after?: OfferSnapshot; changedFields?: string[];
  inventoryId?: string | number; itemId?: string; syncedCategoryId?: string; pushedCategoryId?: string;
  source?: string; swishItemId?: string; swishListingId?: string; submittedFields?: string[];
};

export default function EbayDraftSyncTestScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { tenant } = useApp();
  const [offerId, setOfferId] = useState('');
  const [draftOffers, setDraftOffers] = useState<DraftOffer[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [phase, setPhase] = useState<'read' | 'roundtrip' | null>(null);

  async function syncDraftsToSwish() {
    if (!tenant?.id) {
      setResult({ error: 'SWISH has not finished loading your organisation. Return to the app and try again.' });
      return;
    }
    setBusy(true);
    setPhase('read');
    setResult(null);
    setDraftOffers([]);
    setOfferId('');
    try {
      const supabase = getSupabaseClient();
      const { data: listData, error: listError } = await supabase.functions.invoke('swish-ebay-draft-sync-test', {
        body: { action: 'list_unpublished_offers', tenantId: tenant.id },
      });
      if (listError) throw new Error(listError.message || 'Could not retrieve unpublished drafts from eBay UK.');
      const offers = Array.isArray(listData?.offers) ? listData.offers as DraftOffer[] : [];
      if (!offers.length) {
        setDraftOffers([]);
        setResult({ ok: true, message: 'eBay UK returned no unpublished drafts to sync.' });
        return;
      }
      let imported = 0;
      let alreadyInSwish = 0;
      const failures: string[] = [];
      for (const offer of offers) {
        const { data, error } = await supabase.functions.invoke('swish-ebay-draft-sync-test', {
          body: { action: 'import_offer', tenantId: tenant.id, offerId: offer.offerId },
        });
        if (error || data?.error || !data?.ok) {
          failures.push(`${offer.sku || offer.offerId}: ${data?.error || error?.message || 'Import failed'}`);
        } else if (data.alreadyImported) {
          alreadyInSwish++;
        } else {
          imported++;
        }
      }
      const { data: syncedItems } = await supabase.from('items')
        .select('sku,canonical_title,media')
        .eq('tenant_id', tenant.id)
        .in('sku', offers.map(offer => offer.sku).filter(Boolean));
      const itemBySku = new Map((syncedItems ?? []).map((item: any) => [String(item.sku), item]));
      const enrichedOffers = offers.map(offer => {
        const item: any = itemBySku.get(String(offer.sku ?? ''));
        const media = Array.isArray(item?.media) ? item.media : [];
        return {
          ...offer,
          title: String(item?.canonical_title ?? offer.sku ?? 'eBay draft'),
          imageUrl: media.find((url: unknown) => typeof url === 'string' && url.startsWith('https://')),
        };
      });
      setDraftOffers(enrichedOffers);
      setResult({
        ok: failures.length === 0,
        message: `eBay UK draft sync finished. ${imported} imported, ${alreadyInSwish} already in SWISH, ${failures.length} failed. Tap a draft below to select it for the round-trip test.${failures.length ? '\\n' + failures.slice(0, 5).join('\\n') : ''}`,
      });
    } catch (error: any) {
      setResult({ error: error?.message || 'Could not sync drafts from eBay UK.' });
    } finally {
      setBusy(false);
    }
  }

  async function runTest(action: 'list_unpublished_offers' | 'read_offer' | 'import_offer' | 'sync_category_from_ebay' | 'round_trip_unpublished' | 'push_swish_category') {
    if (!tenant?.id) {
      setResult({ error: 'SWISH has not finished loading your organisation. Return to the app and try again.' });
      return;
    }
    if (action !== 'list_unpublished_offers' && !offerId.trim()) {
      setResult({ error: 'Select one of your eBay UK drafts first.' });
      return;
    }
    setBusy(true);
    setResult(null);
    setPhase(action === 'read_offer' ? 'read' : 'roundtrip');
    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase.functions.invoke('swish-ebay-draft-sync-test', {
        body: { action, tenantId: tenant.id, ...(offerId.trim() ? { offerId: offerId.trim() } : {}) },
      });
      if (error) throw new Error(error.message || 'Could not load your eBay UK drafts. The Edge Function may not be deployed yet.');
      if (action === 'list_unpublished_offers') {
        const found = Array.isArray(data?.offers) ? data.offers as DraftOffer[] : [];
        setDraftOffers(found);
        setOfferId('');
        setResult({ ok: true, message: found.length ? `Found ${found.length} unpublished eBay UK draft(s). Tap one below to select it.` : 'No unpublished drafts were returned by eBay UK. You do not need to find an API offer ID manually.' });
      } else {
        setResult(data as Result);
      }
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

        <Text style={styles.sectionTitle}>1 · Sync eBay UK drafts into SWISH</Text>
        <Text style={styles.body}>One tap retrieves your unpublished eBay UK drafts and imports them into the existing SWISH database. Existing imports are refreshed rather than duplicated. No IDs to find or enter.</Text>
        <Pressable disabled={busy} onPress={syncDraftsToSwish} style={[styles.button, busy && styles.disabled]}>
          {busy && phase === 'read' ? <ActivityIndicator color={Colors.background} /> : <MaterialIcons name="sync" size={18} color={Colors.background} />}
          <Text style={styles.buttonText}>Sync drafts from eBay UK</Text>
        </Pressable>
        {draftOffers.length ? (
          <View style={styles.draftList}>
            {draftOffers.map((offer) => (
              <Pressable key={offer.offerId} disabled={busy} onPress={() => { setOfferId(offer.offerId); setResult({ ok: true, message: 'Draft selected. Use the round-trip button to test submission.', offer }); }} style={[styles.draftOption, offerId === offer.offerId && styles.draftOptionSelected]}>
                {offer.imageUrl ? <Image source={{ uri: offer.imageUrl }} style={styles.draftPhoto} contentFit="cover" /> : <View style={styles.draftPhotoPlaceholder}><MaterialIcons name="toll" size={22} color={Colors.textTertiary} /></View>}
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={styles.draftTitle}>{offer.title || offer.sku || 'eBay draft'}</Text>
                  <Text style={styles.body}>Category {offer.categoryId || 'not set'} · {offer.status || 'UNPUBLISHED'}</Text>
                </View>
                <MaterialIcons name={offerId === offer.offerId ? 'radio-button-checked' : 'radio-button-unchecked'} size={20} color={Colors.primary} />
              </Pressable>
            ))}
          </View>
        ) : null}
        {offerId ? (
          <Pressable disabled={busy} onPress={() => runTest('read_offer')} style={[styles.button, styles.secondaryButton, busy && styles.disabled]}>
            <MaterialIcons name="check-circle" size={18} color={Colors.background} />
            <Text style={styles.buttonText}>Read selected draft</Text>
          </Pressable>
        ) : null}

        <Pressable disabled={busy} onPress={() => runTest('import_offer')} style={[styles.button, styles.secondaryButton, busy && styles.disabled]}>
          <MaterialIcons name="inventory" size={18} color={Colors.background} />
          <Text style={styles.buttonText}>Import unpublished draft into SWISH</Text>
        </Pressable>

        <Text style={styles.sectionTitle}>2 · Push the imported SWISH draft back</Text>
        <Text style={styles.body}>First tap “Import unpublished draft into SWISH”. This test then loads the saved SWISH item and listing, sends their saved offer fields to eBay UK, reads the offer back, and compares the result. It does not publish the offer.</Text>
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
            {result.message ? <Text style={styles.body}>{result.message}</Text> : null}
            {result.inventoryId ? <Text style={styles.body}>SWISH inventory ID: {result.inventoryId}</Text> : null}
            {result.itemId ? <Text style={styles.body}>SWISH item ID: {result.itemId}</Text> : null}
            {result.syncedCategoryId ? <Text style={styles.body}>Synced category ID: {result.syncedCategoryId}</Text> : null}
            {result.pushedCategoryId ? <Text style={styles.body}>Pushed category ID: {result.pushedCategoryId}</Text> : null}
            {result.source ? <Text style={styles.body}>Submission source: {result.source}</Text> : null}
            {result.swishItemId ? <Text style={styles.body}>SWISH item ID: {result.swishItemId}</Text> : null}
            {result.swishListingId ? <Text style={styles.body}>SWISH listing ID: {result.swishListingId}</Text> : null}
            {result.submittedFields?.length ? <Text style={styles.body}>Fields sent to eBay: {result.submittedFields.join(', ')}</Text> : null}
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
  draftList: { gap: Spacing.sm },
  draftPhoto: { width: 54, height: 54, borderRadius: Radius.md, backgroundColor: Colors.surfaceHighlight },
  draftPhotoPlaceholder: { width: 54, height: 54, borderRadius: Radius.md, backgroundColor: Colors.surfaceHighlight, alignItems: 'center', justifyContent: 'center' },
  draftOption: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md, backgroundColor: Colors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceBorder },
  draftOptionSelected: { borderColor: Colors.primary, backgroundColor: Colors.primaryDim },
  draftTitle: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  draftId: { fontSize: 10, color: Colors.textTertiary },
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
