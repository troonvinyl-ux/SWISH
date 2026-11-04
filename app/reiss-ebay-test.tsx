import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, Pressable, View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth, getSupabaseClient } from '@/template';
import { useApp } from '@/hooks/useApp';
import { Image } from 'expo-image';
import type { SavedListing } from '@/services/listingService';
import { Colors, Spacing, Radius, Typography } from '@/constants/theme';

const TARGET_TITLE = "REISS Men's Khaki Hooded Parka Jacket";
type InventoryItem = {
  id: string; canonical_title: string; description?: string; expected_selling_price?: number;
  condition?: string; condition_notes?: string; media?: string[]; specialist_id?: string;
  attributes?: Record<string, any>; quantity?: number; inventory_id?: string; status?: string;
};

export default function ReissEbayTestConsole() {
  const { user } = useAuth();
  const { tenant, isMasterAdmin, activeNicheId } = useApp();
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
    if (!isMasterAdmin || activeNicheId !== 'clothing' || !tenant?.id) return;
    setLoading(true);
    const client = getSupabaseClient();
    const { data, error } = await client.from('items').select('id,canonical_title,description,expected_selling_price,condition,condition_notes,media,specialist_id,attributes,quantity,inventory_id,status')
      .eq('tenant_id', tenant.id).ilike('canonical_title', TARGET_TITLE).order('updated_at', { ascending: false }).limit(5);
    if (error) { setStatus('Database query failed: ' + error.message); setItem(null); }
    else {
      const found = (data ?? []) as InventoryItem[];
      const exact = found.find(row => row.canonical_title?.trim().toLowerCase() === TARGET_TITLE.toLowerCase()) ?? found[0] ?? null;
      setItem(exact);
      if (exact) {
        const { data: liveRows, error: listingError } = await client.from('listings').select('*')
          .eq('tenant_id', tenant.id).eq('item_id', exact.id).eq('marketplace_id', 'ebay')
          .in('status', ['active', 'live']).order('updated_at', { ascending: false }).limit(5);
        const activeRow = (liveRows ?? []).find((row: any) => row.external_listing_id) ?? null;
        if (listingError) {
          setListing(null); setExternalId('');
          setStatus('Inventory loaded, but its eBay listing relationship could not be verified: ' + listingError.message + '. Publishing and ending are disabled until this is resolved.');
        } else if (activeRow) {
          const mapped: SavedListing = { id: activeRow.id, itemId: activeRow.item_id, tenantId: activeRow.tenant_id, marketplaceId: activeRow.marketplace_id, externalListingId: activeRow.external_listing_id, title: activeRow.title ?? '', description: activeRow.description ?? '', price: Number(activeRow.price ?? 0), floorPrice: Number(activeRow.floor_price ?? 0), ceilingPrice: Number(activeRow.ceiling_price ?? 0), shippingCost: Number(activeRow.shipping_cost ?? 0), status: activeRow.status ?? 'active', views: Number(activeRow.views ?? 0), watchers: Number(activeRow.watchers ?? 0), publishedAt: activeRow.published_at ?? undefined, endedAt: activeRow.ended_at ?? undefined, categoryId: activeRow.category_id ?? undefined, createdAt: activeRow.created_at, updatedAt: activeRow.updated_at };
          setListing(mapped); setExternalId(String(activeRow.external_listing_id));
          setTitle(mapped.title || exact.canonical_title); setDescription(mapped.description); setPrice(String(mapped.price));
          setStatus('Existing live eBay listing matched to this inventory item. Revise or end this listing; Submit is blocked to prevent a duplicate.');
        } else {
          setListing(null); setExternalId(''); setTitle(exact.canonical_title); setDescription(exact.description ?? ''); setPrice(String(exact.expected_selling_price ?? ''));
          setStatus('Inventory record loaded, but no active linked eBay listing was found. Submit remains disabled in this single-item safety console until the listing relationship is reconciled.');
        }
      } else { setListing(null); setExternalId(''); setStatus('No matching Reiss jacket was found in this tenant inventory.'); }
    }
    setLoading(false);
  }, [tenant?.id]);

  useEffect(() => { void load(); }, [load]);
  if (!isMasterAdmin || activeNicheId !== 'clothing') return <Redirect href="/" />;

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
    const attrs = item.attributes ?? {};
    const savedSpecifics = Array.isArray((attrs as any).ebay_item_specifics) ? (attrs as any).ebay_item_specifics : [];
    const itemSpecifics = [...savedSpecifics, ...Object.entries(attrs)
      .filter(([k,v]) => k !== 'ebay_item_specifics' && !k.startsWith('_') && ['string','number','boolean'].includes(typeof v) && String(v).trim())
      .map(([name,value]) => ({ name: name.replace(/_/g, ' ').replace(/\\b\\w/g, (ch: string) => ch.toUpperCase()), value: String(value) }))]
      .filter((entry: any, index: number, all: any[]) => entry?.name && entry?.value && all.findIndex((candidate: any) => String(candidate.name).toLowerCase() === String(entry.name).toLowerCase()) === index)
      .slice(0, 25);
    const { data, error } = await getSupabaseClient().functions.invoke('swish-ebay-list', { body: {
      route: 'revise', tenantId: tenant.id, listingId: listing.id, externalListingId: externalId,
      title: title.trim(), description: description.trim(), price: parsedPrice,
      categoryId: listing.categoryId ?? attrs.ebay_category_id ?? attrs._ebay_category_id,
      condition: item.condition ?? '', conditionDescription: item.condition_notes ?? '',
      listingType: 'FixedPriceItem', quantity: item.quantity ?? 1, sku: '',
      itemSpecifics, mediaUrls: (item.media ?? []).filter(url => typeof url === 'string' && url.startsWith('https://')),
    } });
    if (error || !data?.success) { setStatus('eBay revise was not confirmed: ' + (data?.error ?? error?.message ?? 'Unknown response')); setBusy(false); return; }
    setListing({ ...listing, title: title.trim(), description: description.trim(), price: parsedPrice });
    setStatus('eBay confirmed the revise request. Listing ID remains ' + externalId + '.');
    setBusy(false);
  };

  const remove = () => {
    if (!tenant?.id || !item || !listing || !externalId) return;
    Alert.alert('End the existing eBay listing?', 'This ends the matched live eBay listing and retains its SWISH listing record for history. The original Reiss inventory row and its status are preserved.', [
      { text: 'Cancel', style: 'cancel' }, { text: 'End listing', style: 'destructive', onPress: () => void doRemove() },
    ]);
  };

  const doRemove = async () => {
    if (!tenant?.id || !item || !listing || !externalId) return;
    setBusy(true); setStatus('Ending the listing on eBay…');
    const { data, error } = await getSupabaseClient().functions.invoke('swish-ebay-list', { body: {
      route: 'end', tenantId: tenant.id, listingId: listing.id, externalListingId: externalId,
      preserveInventoryStatus: true,
    } });
    if (error || !data?.success || data?.inventoryStatusPreserved !== true) { setStatus('The eBay end operation was not fully verified: ' + (data?.error ?? data?.warning ?? error?.message ?? 'Inventory preservation was not confirmed') + '. Check eBay and SWISH before retrying.'); setBusy(false); return; }
    setListing({ ...listing, status: 'ended', externalListingId: externalId });
    setExternalId('');
    setStatus('Complete. eBay confirmed the existing listing was ended. Its SWISH listing record is retained for history, and the original inventory item is untouched.');
    setBusy(false);
  };

  const field = (label: string, value: string, onChangeText: (v:string)=>void, multiline = false, keyboardType: any = 'default') => (
    <View style={styles.field}><Text style={styles.label}>{label}</Text><TextInput value={value} onChangeText={onChangeText} editable={!busy && !externalId ? true : !busy} multiline={multiline} keyboardType={keyboardType} style={[styles.input, multiline && styles.multiline]} placeholder={label} placeholderTextColor={Colors.textTertiary}/></View>
  );

  return <View style={styles.screen}><StatusBar style="light"/><ScrollView contentContainerStyle={[styles.content,{paddingTop:insets.top+Spacing.md,paddingBottom:insets.bottom+Spacing.xl}]}>
    <View style={styles.header}><Pressable onPress={()=>router.back()} style={styles.back}><MaterialIcons name="arrow-back" size={22} color={Colors.textPrimary}/></Pressable><View style={{flex:1}}><Text style={styles.eyebrow}>SWISH · OWNER TEST TOOL</Text><Text style={styles.title}>Single-item eBay console</Text><Text style={styles.sub}>One inventory item · shared backend · shared eBay connection</Text></View></View>
    <View style={styles.panel}><Text style={styles.section}>Inventory source</Text><Text style={styles.muted}>Exact title lookup: {TARGET_TITLE}</Text>
      {loading ? <ActivityIndicator color={Colors.primary}/> : item ? <><Text style={styles.itemTitle}>{item.canonical_title}</Text><Text style={styles.muted}>Inventory ID: {item.id}</Text><Text style={styles.muted}>Specialist: {item.specialist_id ?? '—'} · Status: {item.status ?? '—'}</Text>{(item.media ?? []).map((url,i)=><Image key={url+i} source={{uri:url}} contentFit="cover" transition={200} style={styles.photo}/>)}</> : <Text style={styles.muted}>No matching item loaded.</Text>}
      <Pressable onPress={()=>void load()} disabled={loading||busy} style={styles.secondary}><Text style={styles.secondaryText}>Refresh source record</Text></Pressable>
    </View>
    {item ? <View style={styles.panel}><Text style={styles.section}>Listing fields</Text><Text style={styles.muted}>These fields are pre-populated from the existing live eBay listing. Revising changes the eBay listing and its SWISH listing row, not the original inventory fields.</Text>
      {field('eBay title',title,setTitle)}{field('Description',description,setDescription,true)}{field('Price (£)',price,setPrice,false,'decimal-pad')}
      <View style={styles.readBox}><Text style={styles.label}>Condition</Text><Text style={styles.value}>{item.condition ?? 'Not set'}{item.condition_notes ? ' · '+item.condition_notes : ''}</Text></View>
      <View style={styles.readBox}><Text style={styles.label}>Item attributes / specifics</Text><Text selectable style={styles.json}>{JSON.stringify(item.attributes ?? {},null,2)}</Text></View>
      <View style={styles.readBox}><Text style={styles.label}>Source protection</Text><Text style={styles.value}>Inventory row is read-only in this console. Revisions affect the linked SWISH listing and eBay listing only.</Text></View>
    </View> : null}
    <View style={styles.panel}><Text style={styles.section}>eBay actions</Text><Text style={styles.notice}>{status}</Text>
      <Pressable disabled style={[styles.action,styles.disabled]}><Text style={styles.actionText}>SUBMIT · BLOCKED TO PREVENT DUPLICATE</Text></Pressable>
      <Pressable disabled={busy||!listing||!externalId} onPress={revise} style={[styles.action,styles.revise,(busy||!listing||!externalId)&&styles.disabled]}><Text style={styles.actionText}>REVISE EXISTING EBAY LISTING</Text></Pressable>
      <Pressable disabled={busy||!listing||!externalId} onPress={remove} style={[styles.action,styles.remove,(busy||!listing||!externalId)&&styles.disabled]}><Text style={styles.actionText}>END EXISTING EBAY LISTING</Text></Pressable>
      {busy ? <ActivityIndicator color={Colors.primary}/> : null}
      {listing ? <Text selectable style={styles.muted}>SWISH listing ID: {listing.id}{externalId ? '\neBay listing ID: '+externalId : '\neBay listing ended; SWISH history retained'}{'\nCurrent listing status: '+listing.status}</Text> : null}
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
