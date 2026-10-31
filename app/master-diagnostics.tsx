// SWISH Master Diagnostics — shared eBay lifecycle acceptance test.
// Owner-only entry is enforced by the screen and its parent navigation.
// Uses the canonical listing service and existing eBay Edge Function contracts.
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth, getSupabaseClient } from '@/template';
import { useApp } from '@/hooks/useApp';
import { isSwishMasterAdmin } from '@/contexts/AppContext';
import { getProductionNicheSpecialistIds } from '@/services/nicheRouting';
import { PRODUCTION_NICHES } from '@/constants/niches';
import {
  createManualListing, submitListingToMarketplace, updateListingTitle, updateListingPrice,
  endListing, deleteListing, type SavedListing,
} from '@/services/listingService';
import { Colors, Spacing, Radius, Typography } from '@/constants/theme';

type TestItem = { id: string; canonical_title: string; description?: string; expected_selling_price?: number; condition?: string; condition_notes?: string; media?: string[]; specialist_id: string; attributes?: Record<string, any>; quantity?: number; inventory_id?: string; status?: string };
type Check = 'create' | 'modify' | 'delete';
type CheckState = 'waiting' | 'running' | 'passed' | 'failed';
const INITIAL: Record<Check, CheckState> = { create: 'waiting', modify: 'waiting', delete: 'waiting' };

export default function MasterDiagnosticsScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { tenant, activeNicheId } = useApp();
  const [items, setItems] = useState<TestItem[]>([]);
  const [selected, setSelected] = useState<TestItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [checks, setChecks] = useState(INITIAL);
  const [listing, setListing] = useState<SavedListing | null>(null);
  const [externalId, setExternalId] = useState('');
  const [message, setMessage] = useState('Choose a real inventory item in the active niche. The test creates a clearly labelled temporary live eBay listing.');
  const [testTitle, setTestTitle] = useState('');

  const nicheName = PRODUCTION_NICHES.find(n => n.id === activeNicheId)?.shortName ?? String(activeNicheId);
  const specialists = getProductionNicheSpecialistIds(activeNicheId);

  const loadItems = useCallback(async () => {
    if (!tenant?.id || !specialists.length) return;
    setLoading(true);
    const { data, error } = await getSupabaseClient().from('items')
      .select('id,canonical_title,description,expected_selling_price,condition,condition_notes,media,specialist_id,attributes,quantity,inventory_id,status')
      .eq('tenant_id', tenant.id).in('specialist_id', specialists)
      .not('canonical_title', 'is', null).order('updated_at', { ascending: false }).limit(80);
    const { data: liveRows, error: liveError } = await getSupabaseClient().from('listings')
      .select('item_id').eq('tenant_id', tenant.id).eq('marketplace_id', 'ebay').in('status', ['active','live']);
    const alreadyLive = new Set((liveRows ?? []).map((row: { item_id: string }) => row.item_id));
    setItems(error || liveError ? [] : ((data ?? []) as TestItem[]).filter(item =>
      !alreadyLive.has(item.id) && !['sold','listed','active','disposed'].includes(String(item.status ?? '').toLowerCase())
    ));
    setSelected(null);
    setLoading(false);
    if (error) setMessage('Could not load niche inventory: ' + error.message);
  }, [tenant?.id, activeNicheId]);

  useEffect(() => { void loadItems(); }, [loadItems]);

  if (!isSwishMasterAdmin(user?.email)) return <Redirect href="/" />;

  const setCheck = (key: Check, value: CheckState) => setChecks(previous => ({ ...previous, [key]: value }));
  const fail = (key: Check, error: string) => { setCheck(key, 'failed'); setMessage(error); setBusy(false); };

  const createTestListing = async () => {
    if (!tenant?.id || !selected) return;
    const price = Number(selected.expected_selling_price ?? 0);
    if (!Number.isFinite(price) || price <= 0) {
      Alert.alert('Price required', 'Choose an inventory item with a positive expected selling price before running the live test.');
      return;
    }
    Alert.alert(
      'Create a REAL eBay listing?',
      'This will publish a temporary listing to your connected live eBay account. It will be clearly labelled SWISH DIAGNOSTIC and must be revised and ended using the remaining test steps.',
      [{ text: 'Cancel', style: 'cancel' }, { text: 'Create live test', style: 'destructive', onPress: () => { void performCreate(price); } }],
    );
  };

  const performCreate = async (price: number) => {
    if (!tenant?.id || !selected) return;
    setBusy(true); setCheck('create', 'running'); setMessage('Creating a temporary SWISH diagnostic listing…');
    const title = ('SWISH DIAGNOSTIC - ' + selected.canonical_title).slice(0, 80);
    const created = await createManualListing({ tenantId: tenant.id, itemId: selected.id, marketplaceId: 'ebay', title, description: 'Temporary SWISH shared-engine diagnostics listing. This is a controlled test listing and will be ended and removed by the diagnostics workflow.', price });
    if (created.error || !created.listing) return fail('create', created.error ?? 'Draft creation was not confirmed.');
    setListing(created.listing); setTestTitle(title);
    const result = await submitListingToMarketplace(tenant.id, created.listing.id);
    if (!result.success || !result.externalListingId) {
      // A timeout can mean eBay accepted the listing but the response was lost.
      // Keep unknown outcomes for reconciliation; clean up definite preflight failures.
      const { data: uncertain } = await getSupabaseClient().from('listings').select('*').eq('id', created.listing.id).eq('tenant_id', tenant.id).maybeSingle();
      const reason = result.error ?? 'eBay did not confirm a live listing ID.';
      const outcomeUnknown = /timeout|timed out|unknown outcome|not yet confirmed|reconcile/i.test(reason);
      if (outcomeUnknown) {
        if (uncertain) setListing({ ...created.listing, status: uncertain.status ?? 'pending', externalListingId: uncertain.external_listing_id ?? undefined });
        return fail('create', reason + ' The test record was retained because the marketplace outcome may be unknown. Reconcile eBay before retrying.');
      }
      await deleteListing(created.listing.id, tenant.id);
      setListing(null);
      return fail('create', reason + ' No listing was confirmed; the local test draft was removed.');
    }
    const { data: persisted, error } = await getSupabaseClient().from('listings').select('id,status,external_listing_id,title,price').eq('id', created.listing.id).eq('tenant_id', tenant.id).maybeSingle();
    if (error || !persisted || !['active','live'].includes(String(persisted.status).toLowerCase()) || !persisted.external_listing_id || persisted.title !== title || Number(persisted.price) !== price) {
      setExternalId(result.externalListingId);
      return fail('create', 'eBay returned a listing ID, but the SWISH row did not pass the status, ID, title and price column checks. Do not retry automatically; reconcile this test listing first.');
    }
    setExternalId(String(persisted.external_listing_id));
    setCheck('create', 'passed'); setMessage('CREATE passed: eBay confirmed a listing ID and SWISH persisted the active listing. Next, run MODIFY.');
    setBusy(false);
  };

  const modifyTestListing = async () => {
    if (!tenant?.id || !selected || !listing || !externalId) return;
    setBusy(true); setCheck('modify', 'running'); setMessage('Revising the temporary eBay listing…');
    const nextTitle = (testTitle + ' - MODIFIED').slice(0, 80);
    const nextPrice = Math.max(0.01, Number(listing.price) + 0.01);
    const localTitle = await updateListingTitle(listing.id, nextTitle);
    const localPrice = await updateListingPrice(listing.id, nextPrice);
    if (localTitle.error || localPrice.error) return fail('modify', localTitle.error ?? localPrice.error ?? 'Local listing update failed.');
    const attrs = selected.attributes ?? {};
    const itemSpecifics = Object.entries(attrs).filter(([k,v]) => !k.startsWith('_') && ['string','number','boolean'].includes(typeof v) && String(v).trim()).slice(0, 30).map(([name,value]) => ({ name, value: String(value) }));
    const { data, error } = await getSupabaseClient().functions.invoke('swish-ebay-list', { body: {
      route: 'revise', tenantId: tenant.id, listingId: listing.id, externalListingId: externalId,
      title: nextTitle, description: 'Temporary SWISH shared-engine diagnostics listing. Modified successfully by the diagnostics workflow.',
      price: nextPrice, categoryId: attrs.ebay_category_id ?? attrs._ebay_category_id,
      condition: selected.condition ?? '', conditionDescription: selected.condition_notes ?? '',
      listingType: 'FixedPriceItem', quantity: selected.quantity ?? 1, sku: selected.inventory_id ?? '',
      itemSpecifics, mediaUrls: (selected.media ?? []).filter(url => typeof url === 'string' && url.startsWith('https://')),
    } });
    if (error || !data?.success) return fail('modify', data?.error ?? error?.message ?? 'eBay did not confirm the revise operation.');
    const { data: revised, error: readError } = await getSupabaseClient().from('listings').select('title,price,external_listing_id').eq('id', listing.id).eq('tenant_id', tenant.id).maybeSingle();
    if (readError || !revised || revised.title !== nextTitle || Number(revised.price) !== nextPrice || revised.external_listing_id !== externalId) {
      return fail('modify', 'eBay accepted the revise request, but SWISH title/price/external ID column read-back did not match. Keep the test listing for reconciliation.');
    }
    setTestTitle(nextTitle);
    setCheck('modify', 'passed'); setMessage('MODIFY passed: eBay confirmed the revise request. Next, run DELETE to end the test listing and remove its SWISH test record.');
    setBusy(false);
  };

  const deleteTestListing = async () => {
    if (!tenant?.id || !selected || !listing || !externalId) return;
    Alert.alert('End and remove test listing?', 'This ends the temporary listing on eBay, then deletes the corresponding SWISH listing record. Your inventory item is retained.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'End & delete', style: 'destructive', onPress: () => { void performDelete(); } },
    ]);
  };

  const performDelete = async () => {
    if (!tenant?.id || !selected || !listing || !externalId) return;
    setBusy(true); setCheck('delete', 'running'); setMessage('Ending the eBay test listing…');
    const ended = await endListing(listing.id, selected.id, tenant.id, externalId);
    if (ended.error) return fail('delete', 'eBay end failed. The test record has been retained for reconciliation: ' + ended.error);
    const removed = await deleteListing(listing.id, tenant.id);
    if (removed.error) return fail('delete', 'eBay listing ended, but SWISH test record cleanup failed: ' + removed.error);
    const { data: remaining, error: verifyDeleteError } = await getSupabaseClient().from('listings').select('id').eq('id', listing.id).eq('tenant_id', tenant.id).maybeSingle();
    if (verifyDeleteError || remaining) return fail('delete', 'eBay listing was ended, but SWISH could not confirm removal of its test record.');
    setCheck('delete', 'passed'); setListing(null); setExternalId('');
    setMessage('DELETE passed: eBay confirmed the listing was ended and SWISH confirmed its test record was removed. The inventory item remains untouched.');
    setBusy(false);
  };

  const reset = () => { if (busy) return; setChecks(INITIAL); setListing(null); setExternalId(''); setTestTitle(''); setMessage('Select an item to start a new lifecycle test.'); };
  const row = (key: Check, label: string, detail: string) => (
    <View style={styles.checkRow} key={key}>
      <MaterialIcons name={checks[key] === 'passed' ? 'check-circle' : checks[key] === 'failed' ? 'error' : checks[key] === 'running' ? 'autorenew' : 'radio-button-unchecked'} size={22} color={checks[key] === 'passed' ? Colors.success : checks[key] === 'failed' ? Colors.danger : Colors.textTertiary} />
      <View style={{ flex: 1 }}><Text style={styles.checkTitle}>{label}</Text><Text style={styles.muted}>{detail}</Text></View>
      <Text style={[styles.state, checks[key] === 'passed' && { color: Colors.success }, checks[key] === 'failed' && { color: Colors.danger }]}>{checks[key].toUpperCase()}</Text>
    </View>
  );

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + Spacing.md, paddingBottom: insets.bottom + Spacing.xl }]}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.back}><MaterialIcons name="arrow-back" size={22} color={Colors.textPrimary} /></Pressable>
          <View style={{ flex: 1 }}><Text style={styles.eyebrow}>SWISH MASTER CONTROL</Text><Text style={styles.title}>Diagnostics Centre</Text><Text style={styles.muted}>Shared eBay engine · {nicheName}</Text></View>
          <MaterialIcons name="health-and-safety" size={30} color={Colors.primary} />
        </View>
        <View style={styles.panel}>
          <Text style={styles.section}>Shared eBay lifecycle</Text>
          <Text style={styles.muted}>Run the same create → modify → end/delete path from any niche. The selected niche is used only to select a valid test inventory item; the marketplace lifecycle is shared.</Text>
          <View style={styles.rows}>{row('create','CREATE','Publish a temporary active eBay listing and verify its persisted ID.')}{row('modify','MODIFY','Revise title, description and price through the shared eBay route.')}{row('delete','DELETE','End the eBay listing, then remove its SWISH test record.')}</View>
          {externalId ? <Text style={styles.idText}>Test eBay ID: {externalId}</Text> : null}
        </View>
        <View style={styles.panel}>
          <Text style={styles.section}>Choose a {nicheName} inventory item</Text>
          <Text style={styles.muted}>Only items belonging to the current niche are shown. Choose an item with a price and valid eBay listing data. The inventory item itself is never deleted.</Text>
          {loading ? <ActivityIndicator color={Colors.primary} /> : items.length ? items.map(item => (
            <Pressable key={item.id} disabled={busy || Boolean(listing)} onPress={() => { setSelected(item); setChecks(INITIAL); setMessage('Selected: ' + item.canonical_title); }} style={[styles.item, selected?.id === item.id && styles.selected]}>
              <View style={{ flex: 1 }}><Text style={styles.itemTitle}>{item.canonical_title}</Text><Text style={styles.muted}>£{Number(item.expected_selling_price ?? 0).toFixed(2)} · {item.specialist_id}</Text></View>
              <MaterialIcons name={selected?.id === item.id ? 'radio-button-checked' : 'radio-button-unchecked'} size={21} color={selected?.id === item.id ? Colors.primary : Colors.textTertiary} />
            </Pressable>
          )) : <Text style={styles.muted}>No inventory items found for this niche.</Text>}
          <Pressable onPress={() => void loadItems()} disabled={loading || busy} style={styles.secondary}><MaterialIcons name="refresh" size={17} color={Colors.primary}/><Text style={styles.secondaryText}>Refresh inventory</Text></Pressable>
        </View>
        <View style={styles.panel}>
          <Text style={styles.section}>Test controls</Text>
          <Text style={styles.notice}>{message}</Text>
          <Pressable disabled={busy || !selected || Boolean(listing) || checks.create === 'passed'} onPress={() => void createTestListing()} style={[styles.action, (!selected || busy || listing || checks.create === 'passed') && styles.disabled]}>
            {busy && checks.create === 'running' ? <ActivityIndicator color="#111"/> : <MaterialIcons name="add-circle" size={19} color="#111"/>}<Text style={styles.actionText}>Create live test listing</Text>
          </Pressable>
          <Pressable disabled={busy || !listing || checks.create !== 'passed' || checks.modify === 'passed'} onPress={() => void modifyTestListing()} style={[styles.action, styles.actionAlt, (busy || !listing || checks.create !== 'passed' || checks.modify === 'passed') && styles.disabled]}>
            <MaterialIcons name="edit" size={19} color="#111"/><Text style={styles.actionText}>Modify eBay listing</Text>
          </Pressable>
          <Pressable disabled={busy || !listing || !externalId} onPress={() => void deleteTestListing()} style={[styles.action, styles.actionDanger, (busy || !listing || !externalId) && styles.disabled]}>
            <MaterialIcons name="delete-forever" size={19} color="#111"/><Text style={styles.actionText}>End & delete test listing</Text>
          </Pressable>
          <Pressable disabled={busy} onPress={reset} style={styles.secondary}><MaterialIcons name="restart-alt" size={17} color={Colors.primary}/><Text style={styles.secondaryText}>Reset test results</Text></Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen:{flex:1,backgroundColor:Colors.background},content:{padding:Spacing.base,gap:Spacing.md},
  header:{flexDirection:'row',alignItems:'center',gap:Spacing.md,marginBottom:Spacing.xs},back:{width:40,height:40,borderRadius:Radius.md,backgroundColor:Colors.surface,alignItems:'center',justifyContent:'center'},
  eyebrow:{fontSize:10,letterSpacing:1.2,color:Colors.primary,fontWeight:'800'},title:{fontSize:26,color:Colors.textPrimary,fontWeight:'900'},muted:{fontSize:Typography.size.xs,color:Colors.textSecondary,lineHeight:18},
  panel:{backgroundColor:Colors.surface,borderWidth:1,borderColor:Colors.surfaceBorder,borderRadius:Radius.lg,padding:Spacing.md,gap:Spacing.sm},
  section:{fontSize:Typography.size.lg,fontWeight:'800',color:Colors.textPrimary},rows:{gap:Spacing.sm,marginTop:Spacing.sm},checkRow:{flexDirection:'row',alignItems:'center',gap:Spacing.sm,paddingVertical:Spacing.xs},
  checkTitle:{fontSize:Typography.size.sm,color:Colors.textPrimary,fontWeight:'800'},state:{fontSize:9,color:Colors.textTertiary,fontWeight:'900'},idText:{fontSize:11,color:Colors.primary,fontWeight:'700'},
  item:{flexDirection:'row',alignItems:'center',padding:Spacing.sm,borderWidth:1,borderColor:Colors.surfaceBorder,borderRadius:Radius.md,gap:Spacing.sm},selected:{borderColor:Colors.primary,backgroundColor:Colors.primary+'12'},
  itemTitle:{fontSize:Typography.size.sm,color:Colors.textPrimary,fontWeight:'700'},notice:{fontSize:Typography.size.xs,color:Colors.textSecondary,lineHeight:19,backgroundColor:Colors.surfaceHighlight,padding:Spacing.sm,borderRadius:Radius.md},
  action:{minHeight:48,borderRadius:Radius.md,backgroundColor:Colors.primary,padding:Spacing.md,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:Spacing.sm},
  actionAlt:{backgroundColor:'#D5B7FF'},actionDanger:{backgroundColor:'#F4A6A6'},actionText:{color:'#111',fontWeight:'900',fontSize:Typography.size.sm},disabled:{opacity:0.35},
  secondary:{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:6,padding:Spacing.sm},secondaryText:{color:Colors.primary,fontSize:Typography.size.sm,fontWeight:'800'},
});
