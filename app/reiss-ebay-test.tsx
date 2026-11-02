import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, ScrollView, StyleSheet, Text, TextInput, Pressable, View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth, getSupabaseClient } from '@/template';
import { useApp } from '@/hooks/useApp';
import { isSwishMasterAdmin } from '@/contexts/AppContext';
import { createManualListing, submitListingToMarketplace, updateListingTitle, updateListingPrice, updateListingDescription, endListing, deleteListing, type SavedListing } from '@/services/listingService';
import { Colors, Spacing, Radius, Typography } from '@/constants/theme';

const TARGET_TITLE = "REISS Men's Khaki Hooded Parka Jacket";
type InventoryItem = {
  id: string; canonical_title: string; description?: string; expected_selling_price?: number;
  condition?: string; condition_notes?: string; media?: string[]; specialist_id?: string;
  attributes?: Record<string, any>; quantity?: number; inventory_id?: string; status?: string;
};

export default function ReissEbayTestConsole() {
  const { user } = useAuth();
  const { tenant } = useApp();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [item, setItem] = useState<InventoryItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [listing, setListing] = useState<SavedListing | null>(null);
  const [externalId, setExternalId] = useState('');
  const [status, setStatus] = useState('Connecting to the existing SWISH backend…');

  const load = useCallback(async () => {
    if (!tenant?.id) return;
    setLoading(true);
    const { data, error } = await getSupabaseClient().from('items').select('id,canonical_title,description,expected_selling_price,condition,condition_notes,media,specialist_id,attributes,quantity,inventory_id,status')
      .eq('tenant_id', tenant.id).ilike('canonical_title', TARGET_TITLE).order('updated_at', { ascending: false }).limit(5);
    if (error) { setStatus('Database query failed: ' + error.message); setItem(null); }
    else {
      const found = (data ?? []) as InventoryItem[];
      const exact = found.find(row => row.canonical_title?.trim().toLowerCase() === TARGET_TITLE.toLowerCase()) ?? found[0] ?? null;
      setItem(exact);
      if (exact) {
        setTitle(exact.canonical_title);
        setDescription(exact.description ?? '');
        setPrice(String(exact.expected_selling_price ?? ''));
        setStatus(found.length > 1 ? 'Matching inventory records found. The closest exact title is loaded.' : 'Original inventory record loaded. No changes have been made to it.');
      } else setStatus('No matching Reiss jacket was found in this tenant inventory.');
    }
    setLoading(false);
  }, [tenant?.id]);

  useEffect(() => { void load(); }, [load]);
  if (!isSwishMasterAdmin(user?.email)) return <Redirect href="/" />;

  const submit = () => {
    if (!tenant?.id || !item) return;
    const parsed = Number(price);
    if (!title.trim() || !description.trim() || !Number.isFinite(parsed) || parsed <= 0) {
      Alert.alert('Complete the listing fields', 'Enter a title, description and positive price before submitting.');
      return;
    }
    Alert.alert('Publish a new live eBay listing?', 'This creates a separate SWISH listing record linked to the Reiss inventory item. It does not edit the original inventory record. The listing will be public on eBay.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Create & publish', style: 'destructive', onPress: () => void doSubmit(parsed) },
    ]);
  };

  const doSubmit = async (parsedPrice: number) => {
    if (!tenant?.id || !item) return;
    setBusy(true); setStatus('Creating a separate SWISH listing record…');
    const created = await createManualListing({ tenantId: tenant.id, itemId: item.id, marketplaceId: 'ebay', title: title.trim(), description: description.trim(), price: parsedPrice });
    if (created.error || !created.listing) { setStatus('Could not create the new listing record: ' + (created.error ?? 'No record returned')); setBusy(false); return; }
    setListing(created.listing);
    setStatus('New listing record created. Sending it through the existing eBay publish pipeline…');
    const result = await submitListingToMarketplace(tenant.id, created.listing.id);
    if (!result.success || !result.externalListingId) {
      setStatus('Publish was not confirmed: ' + (result.error ?? 'No eBay listing ID returned') + '. The separate SWISH draft has been retained for inspection; do not submit again until reconciled.');
      setBusy(false); return;
    }
    setExternalId(result.externalListingId);
    setListing({ ...created.listing, status: 'active', externalListingId: result.externalListingId });
    setStatus('Published. eBay listing ID: ' + result.externalListingId + '. The original inventory record remains unchanged.');
    setBusy(false);
  };

  const revise = () => {
    if (!tenant?.id || !item || !listing || !externalId) return;
    const parsedPrice = Number(price);
    if (!title.trim() || !description.trim() || !Number.isFinite(parsedPrice) || parsedPrice <= 0) {
      Alert.alert('Complete the listing fields', 'Enter a title, description and positive price.');
      return;
    }
    Alert.alert('Revise live eBay listing?', 'This updates the separate test listing on eBay. The original inventory record is not changed.', [
      { text: 'Cancel', style: 'cancel' }, { text: 'Revise listing', onPress: () => void doRevise(parsedPrice) },
    ]);
  };

  const doRevise = async (parsedPrice: number) => {
    if (!tenant?.id || !item || !listing || !externalId) return;
    setBusy(true); setStatus('Saving revised values to the test listing and calling the existing eBay revise function…');
    const [a,b,c] = await Promise.all([
      updateListingTitle(listing.id, title.trim()),
      updateListingDescription(listing.id, description.trim()),
      updateListingPrice(listing.id, parsedPrice),
    ]);
    if (a.error || b.error || c.error) { setStatus('Could not save revised SWISH listing fields: ' + (a.error ?? b.error ?? c.error)); setBusy(false); return; }
    const attrs = item.attributes ?? {};
    const itemSpecifics = Object.entries(attrs).filter(([k,v]) => !k.startsWith('_') && ['string','number','boolean'].includes(typeof v) && String(v).trim()).slice(0, 50).map(([name,value]) => ({ name, value: String(value) }));
    const { data, error } = await getSupabaseClient().functions.invoke('swish-ebay-list', { body: {
      route: 'revise', tenantId: tenant.id, listingId: listing.id, externalListingId: externalId,
      title: title.trim(), description: description.trim(), price: parsedPrice,
      categoryId: attrs.ebay_category_id ?? attrs._ebay_category_id,
      condition: item.condition ?? '', conditionDescription: item.condition_notes ?? '',
      listingType: 'FixedPriceItem', quantity: item.quantity ?? 1, sku: item.inventory_id ?? '',
      itemSpecifics, mediaUrls: (item.media ?? []).filter(url => typeof url === 'string' && url.startsWith('https://')),
    } });
    if (error || !data?.success) { setStatus('eBay revise was not confirmed: ' + (data?.error ?? error?.message ?? 'Unknown response')); setBusy(false); return; }
    setListing({ ...listing, title: title.trim(), description: description.trim(), price: parsedPrice });
    setStatus('eBay confirmed the revise request. Listing ID remains ' + externalId + '.');
    setBusy(false);
  };

  const remove = () => {
    if (!tenant?.id || !item || !listing || !externalId) return;
    Alert.alert('End and delete test listing?', 'This ends the live eBay listing and deletes only the separate SWISH listing record. The Reiss inventory record and its photos remain.', [
      { text: 'Cancel', style: 'cancel' }, { text: 'End & delete', style: 'destructive', onPress: () => void doRemove() },
    ]);
  };

  const doRemove = async () => {
    if (!tenant?.id || !item || !listing || !externalId) return;
    setBusy(true); setStatus('Ending the listing on eBay…');
    const ended = await endListing(listing.id, item.id, tenant.id, externalId);
    if (ended.error) { setStatus('eBay could not confirm the end: ' + ended.error); setBusy(false); return; }
    const deleted = await deleteListing(listing.id, tenant.id);
    if (deleted.error) { setStatus('eBay listing ended, but the SWISH test record could not be deleted: ' + deleted.error); setBusy(false); return; }
    setListing(null); setExternalId('');
    setStatus('Complete. eBay listing ended and the separate SWISH listing record deleted. Original inventory item untouched.');
    setBusy(false);
  };

  const field = (label: string, value: string, onChangeText: (v:string)=>void, multiline = false, keyboardType: any = 'default') => (
    <View style={styles.field}><Text style={styles.label}>{label}</Text><TextInput value={value} onChangeText={onChangeText} editable={!busy && !externalId ? true : !busy} multiline={multiline} keyboardType={keyboardType} style={[styles.input, multiline && styles.multiline]} placeholder={label} placeholderTextColor={Colors.textTertiary}/></View>
  );

  return <View style={styles.screen}><StatusBar style="light"/><ScrollView contentContainerStyle={[styles.content,{paddingTop:insets.top+Spacing.md,paddingBottom:insets.bottom+Spacing.xl}]}>
    <View style={styles.header}><Pressable onPress={()=>router.back()} style={styles.back}><MaterialIcons name="arrow-back" size={22} color={Colors.textPrimary}/></Pressable><View style={{flex:1}}><Text style={styles.eyebrow}>SWISH · OWNER TEST TOOL</Text><Text style={styles.title}>Single-item eBay console</Text><Text style={styles.sub}>One inventory item · shared backend · shared eBay connection</Text></View></View>
    <View style={styles.panel}><Text style={styles.section}>Inventory source</Text><Text style={styles.muted}>Exact title lookup: {TARGET_TITLE}</Text>
      {loading ? <ActivityIndicator color={Colors.primary}/> : item ? <><Text style={styles.itemTitle}>{item.canonical_title}</Text><Text style={styles.muted}>Inventory ID: {item.id}</Text><Text style={styles.muted}>Specialist: {item.specialist_id ?? '—'} · Status: {item.status ?? '—'}</Text>{(item.media ?? []).map((url,i)=><Image key={url+i} source={{uri:url}} style={styles.photo}/>)}</> : <Text style={styles.muted}>No matching item loaded.</Text>}
      <Pressable onPress={()=>void load()} disabled={loading||busy} style={styles.secondary}><Text style={styles.secondaryText}>Refresh source record</Text></Pressable>
    </View>
    {item ? <View style={styles.panel}><Text style={styles.section}>Listing fields</Text><Text style={styles.muted}>These fields are pre-populated from the inventory record. Editing them here changes only the separate test listing when submitted or revised.</Text>
      {field('eBay title',title,setTitle)}{field('Description',description,setDescription,true)}{field('Price (£)',price,setPrice,false,'decimal-pad')}
      <View style={styles.readBox}><Text style={styles.label}>Condition</Text><Text style={styles.value}>{item.condition ?? 'Not set'}{item.condition_notes ? ' · '+item.condition_notes : ''}</Text></View>
      <View style={styles.readBox}><Text style={styles.label}>Item attributes / specifics</Text><Text selectable style={styles.json}>{JSON.stringify(item.attributes ?? {},null,2)}</Text></View>
      <View style={styles.readBox}><Text style={styles.label}>Source protection</Text><Text style={styles.value}>Inventory row is read-only in this console. Submit creates a new listings row linked by item_id.</Text></View>
    </View> : null}
    <View style={styles.panel}><Text style={styles.section}>eBay actions</Text><Text style={styles.notice}>{status}</Text>
      <Pressable disabled={busy||!item||Boolean(listing)} onPress={submit} style={[styles.action,(busy||!item||listing)&&styles.disabled]}><Text style={styles.actionText}>SUBMIT · CREATE NEW LISTING</Text></Pressable>
      <Pressable disabled={busy||!listing||!externalId} onPress={revise} style={[styles.action,styles.revise,(busy||!listing||!externalId)&&styles.disabled]}><Text style={styles.actionText}>REVISE LIVE LISTING</Text></Pressable>
      <Pressable disabled={busy||!listing||!externalId} onPress={remove} style={[styles.action,styles.remove,(busy||!listing||!externalId)&&styles.disabled]}><Text style={styles.actionText}>DELETE TEST LISTING</Text></Pressable>
      {busy ? <ActivityIndicator color={Colors.primary}/> : null}
      {listing ? <Text selectable style={styles.muted}>SWISH listing ID: {listing.id}{externalId ? '\n eBay listing ID: '+externalId : '\n eBay publication not yet confirmed'}</Text> : null}
    </View>
  </ScrollView></View>;
}

const styles=StyleSheet.create({
 screen:{flex:1,backgroundColor:Colors.background},content:{padding:Spacing.base,gap:Spacing.md},
 header:{flexDirection:'row',alignItems:'center',gap:Spacing.md},back:{width:40,height:40,borderRadius:Radius.md,backgroundColor:Colors.surface,alignItems:'center',justifyContent:'center'},
 eyebrow:{fontSize:10,letterSpacing:1.2,color:Colors.primary,fontWeight:'800'},title:{fontSize:24,color:Colors.textPrimary,fontWeight:'900'},sub:{fontSize:Typography.size.xs,color:Colors.textSecondary},
 panel:{backgroundColor:Colors.surface,borderWidth:1,borderColor:Colors.surfaceBorder,borderRadius:Radius.lg,padding:Spacing.md,gap:Spacing.sm},
 section:{fontSize:Typography.size.lg,fontWeight:'800',color:Colors.textPrimary},muted:{fontSize:Typography.size.xs,color:Colors.textSecondary,lineHeight:18},
 itemTitle:{fontSize:Typography.size.md,fontWeight:'800',color:Colors.textPrimary},photo:{width:104,height:104,borderRadius:Radius.md,backgroundColor:Colors.surfaceHighlight},
 field:{gap:5},label:{fontSize:11,color:Colors.textSecondary,fontWeight:'800'},input:{minHeight:44,borderWidth:1,borderColor:Colors.surfaceBorder,borderRadius:Radius.md,padding:Spacing.sm,color:Colors.textPrimary,backgroundColor:Colors.background,fontSize:Typography.size.sm},multiline:{minHeight:120,textAlignVertical:'top'},
 readBox:{padding:Spacing.sm,backgroundColor:Colors.surfaceHighlight,borderRadius:Radius.md,gap:5},value:{fontSize:Typography.size.sm,color:Colors.textPrimary},json:{fontSize:10,color:Colors.textSecondary,fontFamily:'monospace'},
 notice:{fontSize:Typography.size.xs,color:Colors.textSecondary,lineHeight:19,backgroundColor:Colors.surfaceHighlight,padding:Spacing.sm,borderRadius:Radius.md},
 action:{minHeight:48,borderRadius:Radius.md,backgroundColor:Colors.primary,padding:Spacing.md,alignItems:'center',justifyContent:'center'},revise:{backgroundColor:'#D5B7FF'},remove:{backgroundColor:'#F4A6A6'},actionText:{color:'#111',fontWeight:'900',fontSize:Typography.size.sm},disabled:{opacity:0.35},
 secondary:{padding:Spacing.sm,alignItems:'center'},secondaryText:{color:Colors.primary,fontWeight:'800',fontSize:Typography.size.sm}
});
