// Canonical Stock/Draft/Live/Sold presentation. All reads/actions live in shared hooks/services.
import { useState, useMemo, useEffect, memo } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, TextInput, ScrollView, Modal, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { preferredStudioImage } from '@/shared/smartStudio';
import { useInventoryRemoval } from '@/hooks/useInventoryRemoval';
import { useInventoryPriceRevision } from '@/hooks/useInventoryPriceRevision';
import { inventoryOrderOptions, orderInventory, recommendedInventoryPrice, type InventoryOrder } from '@/services/inventoryPresentationService';
import { ItemImage } from '@/components';
import { useApp } from '@/hooks/useApp';
import { useAlert } from '@/template';
import { useMasterInventory } from '@/hooks/useMasterInventory';
import { NICHES, type NicheConfig } from '@/constants/niches';
import { resolveProductionNiche } from '@/services/nicheRouting';
import { Colors, Typography, Spacing, Radius, Shadow } from '@/constants/theme';
import { publishGeneratedListings, submitListingsInBulk } from '@/services/listingService';
import type { InventoryTab, InventoryViewItem } from '@/services/inventoryViewService';
import { InventoryAccountScope } from '@/components/feature/InventoryAccountScope';
import BulkReValueSheet from '@/components/feature/BulkReValueSheet';
import BulkReIdentifyModal from '@/components/feature/BulkReIdentifyModal';

const TABS: Array<{ id: InventoryTab; label: string; icon: string; color: string }> = [
  { id: 'stock', label: 'In Stock', icon: 'inventory', color: Colors.primary },
  { id: 'draft', label: 'Draft', icon: 'edit', color: Colors.textSecondary },
  { id: 'live', label: 'Live', icon: 'storefront', color: Colors.success },
  { id: 'sold', label: 'Sold', icon: 'check-circle', color: Colors.accent },
];
const FILTERS: Record<string, Array<[string, string]>> = {
  coins: [['All Types', ''], ['Silver', 'silver'], ['Gold', 'gold'], ['British', 'british'], ['Ancient', 'ancient'], ['Islamic', 'islamic'], ['Roman', 'roman']],
  motocross: [['All MX', ''], ['Running', 'rideable'], ['Project', 'project'], ['2-Stroke', '2-stroke'], ['4-Stroke', '4-stroke']],
  bicycles: [['All Bikes', ''], ['Mountain', 'mountain'], ['Road', 'road'], ['Electric', 'electric'], ['Parts', 'parts']],
  clothing: [['All Items', ''], ['Vintage', 'vintage'], ['Designer', 'designer'], ['Streetwear', 'streetwear'], ['Trainers', 'trainer']],
  surplus_flip: [['All Products', ''], ['Manifest Stock', 'supplier_manifest'], ['Bulk Stock', 'quantity_available']],
};
const BANNERS: Record<string, { title: string; sub: string; route: string; icon: string }> = {
  coins: { title: 'Islamic & Indian Silver', sub: 'Zeno · Numista · Evidence-based', route: '/islamic-batch', icon: 'toll' },
  motocross: { title: 'MX Acquisition Calculator', sub: 'Price · Repair costs · Profit estimate', route: '/mx-acquisition', icon: 'calculate' },
  surplus_flip: { title: 'Import Job-lot Manifest', sub: 'CSV → photo match → stock', route: '/surplus-flip', icon: 'upload-file' },
};
interface InventoryCardProps { item: InventoryViewItem; tab: InventoryTab; config: NicheConfig; busy: boolean; onOpen: () => void; onAction: () => void; onDelete: () => void; onReprice: () => void; priceBlocked: boolean }
const InventoryCard = memo(function InventoryCard({ item, tab, config, busy, onOpen, onAction, onDelete, onReprice, priceBlocked }: InventoryCardProps) {
  const color = tab === 'live' ? Colors.success : tab === 'sold' ? Colors.accent : config.color;
  const price = tab === 'sold' ? item.soldPrice : item.listing?.price ?? item.expectedSellingPrice ?? item.valuationMid;
  const recommendation = tab === 'live' ? recommendedInventoryPrice(item) : null;
  const meta = config.keyAttributes.map(key => item.attributes[key]).filter(value => typeof value === 'string' || typeof value === 'number').slice(0, 3).join(' · ');
  return <Pressable onPress={onOpen} style={({ pressed }) => [s.card, { borderLeftColor: color, opacity: pressed ? 0.85 : 1 }]}>
    {preferredStudioImage(item.media,item.attributes) ? <ItemImage uri={preferredStudioImage(item.media,item.attributes)} contentFit="cover" transition={150} style={s.thumb} /> : <View style={s.thumb}><MaterialIcons name={config.icon as any} size={24} color={color} /></View>}
    <View style={s.flex}>
      {item.inventoryId ? <Text style={[s.reference, { color }]}>{item.inventoryId}</Text> : null}
      <Text style={s.itemTitle} numberOfLines={2}>{item.canonical_title || 'Untitled'}</Text>
      {meta ? <Text style={s.sub} numberOfLines={1}>{meta}</Text> : null}
      {item.attributes?._photo_pipeline && item.attributes._photo_pipeline.status !== 'complete' ? <Text accessibilityRole="alert" style={[s.sub,{color:Colors.warning}]}>Photos need retry · open this saved item</Text> : null}
      <View style={s.priceRow}><Text style={[s.status, { color }]}>{tab === 'live' ? 'Live on eBay' : TABS.find(t => t.id === tab)?.label}</Text>
        {Number(price) > 0 ? <Text style={[s.price, { color }]}>£{Number(price).toFixed(2)}</Text> : null}
      </View>
      {tab === 'live' && item.listing ? <View style={s.engagement}><MaterialIcons name="visibility" size={16} color={Colors.textSecondary}/><Text style={s.engagementText}>{item.listing.views ?? 0} views</Text><MaterialIcons name="star-border" size={16} color={Colors.textSecondary}/><Text style={s.engagementText}>{item.listing.watchers ?? 0} watchers</Text></View> : null}
      {recommendation !== null ? <Pressable disabled={busy || priceBlocked} accessibilityRole="button" accessibilityLabel={`Apply recommended price £${recommendation.toFixed(2)} on eBay`} onPress={event=>{event.stopPropagation();onReprice();}} style={({pressed})=>[s.reprice,pressed||busy||priceBlocked?s.pressed:null]}><MaterialIcons name="price-change" size={18} color={config.color}/><Text style={[s.repriceText,{color:config.color}]}>{priceBlocked?'Check price in listing editor':`Recommended £${recommendation.toFixed(2)} · Apply on eBay`}</Text></Pressable> : null}
      {tab === 'sold' && item.soldAt ? <Text style={s.sub}>{new Date(item.soldAt).toLocaleDateString('en-GB')}</Text> : null}
    </View>
    {tab !== 'sold' ? <Pressable disabled={busy} accessibilityLabel={tab === 'stock' ? 'Create listing' : tab === 'draft' ? 'Edit and review draft' : 'End listing'} onPress={event => { event.stopPropagation(); onAction(); }} style={({ pressed }) => [s.action, { opacity: pressed ? 0.7 : 1 }]}>
      <MaterialIcons name={tab === 'stock' ? 'sell' : tab === 'draft' ? 'send' : 'stop'} size={16} color={color} />
      {busy ? <ActivityIndicator size="small" color={color} /> : <Text style={[s.actionText, { color }]}>{tab === 'stock' ? 'List' : tab === 'draft' ? 'Edit' : 'End'}</Text>}
    </Pressable> : null}
    {tab === 'stock' || tab === 'draft' ? <Pressable accessibilityRole="button" accessibilityLabel={`Delete inventory item: ${item.canonical_title}`} disabled={busy} onPress={event => { event.stopPropagation(); onDelete(); }} style={({ pressed }) => [s.action, pressed || busy ? { opacity: 0.55 } : null]}><MaterialIcons name="delete-outline" size={20} color={Colors.danger} /><Text style={[s.actionText, { color: Colors.danger }]}>Delete</Text></Pressable> : null}
  </Pressable>;
});
export default function MasterInventoryScreen() {
  const state = useMasterInventory(); const router = useRouter();
  const removal = useInventoryRemoval(state.removeDeletedItem);
  const priceRevision = useInventoryPriceRevision(state.reload);
  const [order,setOrder]=useState<InventoryOrder>('newest');
  const [showOrder,setShowOrder]=useState(false);
  const displayKnown=state.hasSnapshot;
  const { tab: requestedTab } = useLocalSearchParams<{ tab?: string }>();
  const { tenant, businessConfig } = useApp(); const { showAlert } = useAlert();
  const [bulkListing, setBulkListing] = useState(false); const [singleListingId, setSingleListingId] = useState<string | null>(null);
  const [search, setSearch] = useState(''); const [filter, setFilter] = useState('');
  const [showReValue, setShowReValue] = useState(false); const [showReIdentify, setShowReIdentify] = useState(false);
  const [progress, setProgress] = useState<any>(null);
  const id = resolveProductionNiche(state.nicheId); const config = id ? NICHES[id] : NICHES.general;
  // Coins open on the complete canonical collection, not an empty Stock subset.
  const [selection, setSelection] = useState<{ scope: string; tab: InventoryTab | 'all' }>({ scope: '', tab: 'all' });
  useEffect(() => {
    if (requestedTab && ['stock','draft','live','sold'].includes(requestedTab) && state.ready) { const tab=requestedTab as InventoryTab; state.setActiveTab(tab); setSelection({ scope: state.scope, tab }); }
  }, [requestedTab, state.ready, state.scope, state.setActiveTab]);
  const showAllCoins = id === 'coins' && (selection.scope !== state.scope || selection.tab === 'all');
  const itemTabs = useMemo(() => {
    const result = new Map<string, InventoryTab>();
    for (const tab of ['stock', 'draft', 'live', 'sold'] as const) for (const item of state.views[tab]) result.set(item.id, tab);
    return result;
  }, [state.views]);
  const [searchScope, setSearchScope] = useState('');
  const effectiveSearch = searchScope === state.scope ? search : '';
  const effectiveFilter = searchScope === state.scope ? filter : '';
  const filters = FILTERS[id ?? ''] ?? [[`All ${config.terms.items}`, '']]; const banner = BANNERS[id ?? ''];
  const counts = state.counts;
  const data = useMemo(() => orderInventory((showAllCoins ? state.allItems : state.views[state.activeTab]).filter((item: InventoryViewItem) => {
    const haystack = `${item.canonical_title} ${item.catalogueNumber ?? ''} ${item.inventoryId ?? ''} ${item.ruler ?? ''} ${item.denomination ?? ''} ${item.mint ?? ''} ${item.material ?? ''} ${JSON.stringify(item.attributes)}`.toLowerCase();
    return (!effectiveSearch.trim() || haystack.includes(effectiveSearch.trim().toLowerCase())) && (showAllCoins || state.activeTab !== 'stock' || !effectiveFilter || haystack.includes(effectiveFilter));
  }), order), [state.allItems, state.views, state.activeTab, showAllCoins, effectiveSearch, effectiveFilter, order]);
  const closeBulk = () => { setShowReIdentify(false); setShowReValue(false); setProgress(null); void state.reload(); };
  const runSingleListing = async (item: InventoryViewItem) => {
    if (!tenant?.id || bulkListing || singleListingId) return;
    setSingleListingId(item.id);
    try {
      const [result] = await publishGeneratedListings([{
        itemId: item.id, tenantId: tenant.id,
        categoryId: String(item.attributes?.ebay_category_id ?? '') || undefined,
      }]);
      if (result?.success) {
        showAlert('Listed on eBay', `${item.canonical_title} is confirmed live${result.externalListingId ? ` · #${result.externalListingId}` : ''}.`);
      } else {
        showAlert(result?.listing ? 'Draft saved — not live yet' : 'Listing needs attention', result?.error ?? 'eBay did not confirm publication. Check the saved draft before retrying.');
      }
      await state.reload();
    } catch (error: any) {
      showAlert('Listing failed', error?.message ?? 'The listing could not be completed. Check eBay before retrying.');
    } finally { setSingleListingId(null); }
  };
  const runBulkListing = () => {
    if (!tenant?.id || bulkListing || data.length < 2) return;
    const action = async () => {
      setBulkListing(true);
      try {
        if (state.activeTab === 'stock') {
          const results = await publishGeneratedListings(data.map((item: InventoryViewItem) => ({
            itemId: item.id, tenantId: tenant.id,
            categoryId: String(item.attributes?.ebay_category_id ?? '') || undefined,
          })));
          const live = results.filter(result => result.success).length;
          const failed = results.length - live;
          await state.reload();
          showAlert('Bulk listing complete', `${live} of ${results.length} items confirmed live on eBay.${failed ? ` ${failed} need attention; no automatic retry was made.` : ''}`);
        } else {
          const drafts = data.filter((item: InventoryViewItem) => item.listing?.id);
          const results = await submitListingsInBulk(tenant.id, drafts.map((item: InventoryViewItem) => item.listing!.id));
          const live = results.filter(result => result.result.success).length;
          const failed = results.length - live;
          await state.reload();
          showAlert('Bulk publishing complete', `${live} of ${results.length} drafts confirmed live on eBay.${failed ? ` ${failed} need attention; no automatic retry was made.` : ''}`);
        }
      } catch (error: any) {
        showAlert('Bulk listing stopped', error?.message ?? 'The batch could not be completed. Check eBay before retrying.');
      } finally { setBulkListing(false); }
    };
    showAlert(
      state.activeTab === 'stock' ? 'List all visible stock?' : 'Publish all visible drafts?',
      `SWISH will process ${data.length} items one at a time. Each result is checked before continuing. Failed or uncertain items will not be automatically retried.`,
      [{ text: 'Cancel', style: 'cancel' }, { text: state.activeTab === 'stock' ? 'Confirm & List All' : 'Confirm & Publish All', onPress: action }],
    );
  };
  return <SafeAreaView edges={['top']} style={s.container}>
    <StatusBar style="light" />
    <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={s.header}>
        <View style={s.headerMain}>
          <View style={s.headerIcon}><MaterialIcons name={config.icon as any} size={22} color={config.color} /></View>
          <View style={s.headerText}>
            <Text numberOfLines={1} adjustsFontSizeToFit style={[s.headerTitle, { color: config.color }]}>{config.shortName} Inventory</Text>
            <Text style={s.sub}>{!displayKnown ? 'Loading account inventory' : `${state.totalCount} unique items · ${counts.stock} stock · ${counts.draft} draft · ${counts.live} live items · ${counts.sold} sold`}</Text>
          </View>
          <Pressable onPress={() => router.push('/(tabs)/scan' as any)} style={[s.hBtn, { backgroundColor: config.color }]} accessibilityLabel="Add inventory"><MaterialIcons name="add" size={22} color={Colors.background} /></Pressable>
        </View>
        {(state.activeTab === 'sold' || (state.activeTab === 'stock' && data.length > 0) || (!showAllCoins && (state.activeTab === 'stock' || state.activeTab === 'draft') && data.length > 1)) ? <View style={s.headerActions}>
          {state.activeTab === 'sold' ? <Pressable onPress={state.syncSold} disabled={state.syncing} style={s.hBtn} accessibilityLabel="Sync sold orders"><MaterialIcons name="sync" size={20} color={config.color} /></Pressable> : null}
          {state.activeTab === 'stock' && data.length ? <><Pressable onPress={() => setShowReValue(true)} style={s.hBtn} accessibilityLabel="Bulk revalue"><MaterialIcons name="travel-explore" size={20} color={config.color} /></Pressable><Pressable onPress={() => setShowReIdentify(true)} style={s.hBtn} accessibilityLabel="Bulk reidentify"><MaterialIcons name="auto-awesome" size={20} color={Colors.accent} /></Pressable></> : null}
          {!showAllCoins && (state.activeTab === 'stock' || state.activeTab === 'draft') && data.length > 1 ? <Pressable onPress={runBulkListing} disabled={bulkListing} style={[s.bulkButton, { backgroundColor: config.color, opacity: bulkListing ? 0.6 : 1 }]} accessibilityLabel={state.activeTab === 'stock' ? 'Bulk list all visible stock' : 'Bulk publish all visible drafts'}>{bulkListing ? <ActivityIndicator size="small" color={Colors.background} /> : <MaterialIcons name="playlist-add-check" size={17} color={Colors.background} />}<Text style={s.bulkButtonText}>{bulkListing ? 'Listing…' : `List all ${data.length}`}</Text></Pressable> : null}
        </View> : null}
      </View>
      <View style={s.rail}><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.railContent}>
        {id === 'coins' ? <Pressable accessibilityRole="tab" accessibilityState={{ selected: showAllCoins }} onPress={() => setSelection({ scope: state.scope, tab: 'all' })} style={({ pressed }) => [s.chip, { borderColor: showAllCoins ? config.color : Colors.surfaceBorder, opacity: pressed ? 0.7 : 1 }]}><Text style={[s.chipText, { color: showAllCoins ? config.color : Colors.textSecondary }]}>All Coins {displayKnown ? state.allItems.length : '—'}</Text></Pressable> : null}
        {TABS.map(tab => <Pressable key={tab.id} accessibilityRole="tab" accessibilityState={{ selected: !showAllCoins && state.activeTab === tab.id }} onPress={() => { setSelection({ scope: state.scope, tab: tab.id }); state.setActiveTab(tab.id); }} style={({ pressed }) => [s.chip, { borderColor: !showAllCoins && state.activeTab === tab.id ? tab.color : Colors.surfaceBorder, opacity: pressed ? 0.7 : 1 }]}>
          <MaterialIcons name={tab.icon as any} size={16} color={!showAllCoins && state.activeTab === tab.id ? tab.color : Colors.textTertiary} />
          <Text style={[s.chipText, { color: !showAllCoins && state.activeTab === tab.id ? tab.color : Colors.textSecondary }]}>{tab.label} {displayKnown ? counts[tab.id] : '—'}</Text>
        </Pressable>)}
      </ScrollView></View>
      <View style={s.searchWrap}><MaterialIcons name="search" size={20} color={Colors.textTertiary} />
        <TextInput accessibilityLabel={`Search ${config.terms.items}`} value={effectiveSearch} onChangeText={value => { setSearchScope(state.scope); setSearch(value); }} placeholder={`Search ${config.terms.items.toLowerCase()}...`} placeholderTextColor={Colors.textTertiary} style={s.input} />
        {effectiveSearch ? <Pressable onPress={() => setSearch('')} style={s.hBtn} accessibilityLabel="Clear search"><MaterialIcons name="close" size={18} color={Colors.textSecondary} /></Pressable> : null}
      </View>
      <View style={s.orderRow}><Text style={s.orderNote}>{state.error&&displayKnown?'Last loaded inventory':state.loading&&displayKnown?'Refreshing inventory…':'Refresh on open or pull to refresh'}{state.activeTab==='live'?' · Saved eBay metrics':''}</Text><Pressable accessibilityRole="button" accessibilityLabel="Order inventory by" onPress={()=>setShowOrder(true)} style={({pressed})=>[s.orderButton,pressed?s.pressed:null]}><MaterialIcons name="sort" size={20} color={config.color}/><Text style={s.orderText}>{inventoryOrderOptions.find(option=>option.id===order)?.label}</Text></Pressable></View>
      {priceRevision.error ? <View style={s.syncError}><MaterialIcons name="error-outline" size={20} color={Colors.warning}/><Text accessibilityRole="alert" style={s.syncErrorText}>{priceRevision.error}</Text></View> : priceRevision.notice ? <View style={s.syncError}><MaterialIcons name="check-circle-outline" size={20} color={Colors.success}/><Text accessibilityLiveRegion="polite" style={s.orderText}>{priceRevision.notice}</Text></View> : null}
      {state.activeTab === 'stock' && banner ? <Pressable onPress={() => router.push(banner.route as any)} style={({ pressed }) => [s.banner, { opacity: pressed ? 0.85 : 1 }]}>
        <MaterialIcons name={banner.icon as any} size={22} color={config.color} /><View style={s.flex}><Text style={[s.bannerTitle, { color: config.color }]}>{banner.title}</Text><Text style={s.sub}>{banner.sub}</Text></View><MaterialIcons name="arrow-forward" size={20} color={config.color} />
      </Pressable> : null}
      {!showAllCoins && state.activeTab === 'stock' && filters.length > 1 ? <View style={s.rail}><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.railContent}>
        {filters.map(([label, value]) => <Pressable key={value} onPress={() => { setSearchScope(state.scope); setFilter(value); }} style={({ pressed }) => [s.chip, { borderColor: effectiveFilter === value ? config.color : Colors.surfaceBorder, opacity: pressed ? 0.7 : 1 }]}><Text style={[s.chipText, { color: effectiveFilter === value ? config.color : Colors.textSecondary }]}>{label}</Text></Pressable>)}
      </ScrollView></View> : null}
      {state.activeTab === 'stock' ? <Pressable accessibilityRole="button" accessibilityLabel="Analyse a pallet, job lot or collection manifest" onPress={() => router.push('/lot-opportunity' as any)} style={({ pressed }) => [s.banner, { opacity: pressed ? 0.7 : 1 }]}>
        <MaterialIcons name="account-tree" size={20} color={config.color} /><View style={s.flex}><Text style={[s.bannerTitle, { color: config.color }]}>Buy a lot · split & sell</Text><Text style={s.sub}>Manifest → max bid → unit / bundle economics → drafts</Text></View>
      </Pressable> : null}
      <Text style={s.info}>{displayKnown ? `${state.liveListingCount} unique live eBay listings · ${state.unitCount} recorded units. Status metrics are not added to inventory.` : 'Canonical account figures are awaiting verification.'}</Text>
      <Text style={s.info}>{showAllCoins ? `All Coins · ${data.length} shown · Original records from this account only` : state.activeTab === 'draft' ? 'Drafts are saved in SWISH — Submit publishes to eBay' : state.activeTab === 'live' ? 'End on eBay first. The item returns to In Stock; Delete item is a separate confirmation.' : state.activeTab === 'sold' ? 'Sync pulls orders from your connected eBay account' : `${filters.find(entry => entry[1] === filter)?.[0] ?? 'In Stock'} · ${data.length} items`}</Text>
      {state.error ? <View style={s.syncError}><Text accessibilityRole="alert" style={s.syncErrorText}>{state.error} Inventory is not confirmed empty.</Text><Pressable onPress={() => void state.refresh()} style={({ pressed }) => [s.hBtn, { opacity: pressed ? 0.7 : 1 }]}><Text style={s.chipText}>Retry</Text></Pressable></View> : null}
      <FlatList style={s.flex} data={data} keyExtractor={item => showAllCoins ? item.id : `${state.activeTab}-${item.id}-${item.listing?.id ?? ''}`} ListHeaderComponent={id === 'coins' ? <View style={s.scopePanel}><InventoryAccountScope total={state.totalCount} verified={state.ready && !state.loading} error={state.error}/></View> : null} showsVerticalScrollIndicator={false} contentContainerStyle={s.list} refreshing={state.refreshing} onRefresh={state.refresh}
        ItemSeparatorComponent={() => <View style={{ height: Spacing.sm }} />}
        renderItem={({ item }) => {
          const tab = showAllCoins ? itemTabs.get(item.id) ?? 'stock' : state.activeTab;
          return <InventoryCard item={item} tab={tab} config={config} busy={removal.busyId !== null || state.endingItemId !== null || priceRevision.busyId !== null} onOpen={() => router.push(`/stock-listing/${item.id}` as any)} onAction={() => tab === 'stock' ? router.push(`/create-listing?id=${item.id}` as any) : tab === 'draft' && item.listing?.id ? router.push(`/ebay-listing-editor?id=${item.listing.id}` as any) : state.end(item)} onDelete={() => removal.requestDelete({ id: item.id, title: item.canonical_title, specialistId: item.specialist_id, tenantId: item.tenantId, status: item.status })} onReprice={()=>void priceRevision.apply(item)} priceBlocked={Boolean(item.listing && priceRevision.blockedIds.includes(item.listing.id))} />;
        }}
        ListEmptyComponent={<View style={s.empty}><MaterialIcons name={config.icon as any} size={40} color={config.color} /><Text style={s.emptyTitle}>{state.error ? 'Inventory could not be verified' : state.loading ? 'Loading authorised inventory...' : showAllCoins ? 'No coins in this account and workspace' : `No ${state.activeTab === 'stock' ? config.terms.items.toLowerCase() + ' in stock' : state.activeTab + ' items'}`}</Text>
          <Text style={s.emptyText}>{state.error ? 'Retry the read; no records have been deleted or recreated.' : effectiveSearch ? 'Try another search or filter.' : showAllCoins ? 'Check the signed-in email and workspace above. Existing collections stay with their original account.' : state.activeTab === 'stock' ? 'Capture an item to start preparing a listing.' : state.activeTab === 'draft' ? 'Tap List on an in-stock item to create a draft.' : state.activeTab === 'sold' ? 'Sold records appear after order synchronization.' : 'Submit a draft to publish it on eBay.'}</Text>
          {state.activeTab === 'stock' ? <Pressable onPress={() => router.push('/(tabs)/scan' as any)} style={[s.emptyButton, { backgroundColor: config.color }]}><Text style={s.buttonText}>Add {config.terms.item}</Text></Pressable> : state.activeTab === 'sold' ? <Pressable onPress={state.syncSold} style={[s.emptyButton, { backgroundColor: config.color }]}><Text style={s.buttonText}>{state.syncing ? 'Syncing...' : 'Sync from eBay'}</Text></Pressable> : null}
        </View>}
      />
    </KeyboardAvoidingView>
    <BulkReIdentifyModal visible={showReIdentify} items={data} tenantId={tenant?.id ?? ''} progress={progress} onProgress={setProgress} onClose={closeBulk} />
    {tenant ? <BulkReValueSheet visible={showReValue} onClose={closeBulk} tenantId={tenant.id} items={data.map((item: InventoryViewItem) => ({ id: item.id, canonical_title: item.canonical_title, specialist_id: item.specialist_id, condition: item.condition ?? '', attributes: item.attributes, media: item.media }))} autonomousMode={businessConfig?.autoValue === true || businessConfig?.automationLevel === 'autonomous'} /> : null}
    <Modal visible={showOrder} transparent animationType="fade" onRequestClose={()=>setShowOrder(false)}><SafeAreaView edges={['top','bottom']} style={s.overlay}><View style={s.orderModal}><View style={s.orderHeading}><Text style={s.emptyTitle}>Order by</Text><Pressable accessibilityLabel="Close ordering options" onPress={()=>setShowOrder(false)} style={({pressed})=>[s.orderButton,pressed?s.pressed:null]}><MaterialIcons name="close" size={24} color={Colors.textPrimary}/></Pressable></View><FlatList data={inventoryOrderOptions} keyExtractor={option=>option.id} showsVerticalScrollIndicator={false} renderItem={({item:option})=><Pressable accessibilityRole="radio" accessibilityState={{checked:order===option.id}} onPress={()=>{setOrder(option.id);setShowOrder(false);}} style={({pressed})=>[s.orderOption,pressed?s.pressed:null]}><Text style={[s.orderText,order===option.id?{color:config.color}:null]}>{option.label}</Text><MaterialIcons name={order===option.id?'radio-button-checked':'radio-button-unchecked'} size={24} color={order===option.id?config.color:Colors.textSecondary}/></Pressable>}/></View></SafeAreaView></Modal>
    <Modal visible={state.submitStep !== null} transparent animationType="fade" onRequestClose={() => {}}><View style={s.overlay}><View style={s.modal}><ActivityIndicator color={config.color} /><Text style={s.emptyTitle}>Submitting to eBay</Text><Text style={s.sub}>{state.submitTitle}</Text><Text style={s.info}>{state.submitStep?.replace(/_/g, ' ')}</Text></View></View></Modal>
  </SafeAreaView>;
}
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background }, flex: { flex: 1 }, scopePanel: { marginBottom: Spacing.sm },
  header: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder, gap: Spacing.xs }, headerMain: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }, headerText: { flex: 1, minWidth: 0, gap: 2 }, headerActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: Spacing.xs, flexWrap: 'wrap' }, bulkButton: { minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: Spacing.md, borderRadius: Radius.md }, bulkButtonText: { color: Colors.background, fontSize: Typography.size.xs, fontWeight: Typography.weight.bold }, headerIcon: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surface, borderRadius: Radius.md }, headerTitle: { fontSize: Typography.size.xl, fontWeight: Typography.weight.bold, flexShrink: 1 }, sub: { color: Colors.textTertiary, fontSize: Typography.size.xs, lineHeight: 18 }, hBtn: { minWidth: 40, minHeight: 40, alignItems: 'center', justifyContent: 'center', borderRadius: Radius.md, backgroundColor: Colors.surface },
  rail: { minHeight: 44, borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder }, railContent: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, paddingHorizontal: Spacing.base, paddingVertical: Spacing.xs }, chip: { height: 36, borderRadius: Radius.md, borderWidth: 1, backgroundColor: Colors.surface, paddingHorizontal: Spacing.md, gap: Spacing.xs, flexDirection: 'row', alignItems: 'center' }, chipText: { fontSize: Typography.size.xs, fontWeight: Typography.weight.semibold, color: Colors.textPrimary }, searchWrap: { height: 42, marginHorizontal: Spacing.base, marginVertical: Spacing.xs, paddingLeft: Spacing.sm, flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: Radius.md }, input: { flex: 1, padding: Spacing.sm, color: Colors.textPrimary, fontSize: Typography.size.base, includeFontPadding: false },
  banner: { marginHorizontal: Spacing.base, padding: Spacing.sm, borderRadius: Radius.lg, backgroundColor: Colors.surfaceHighlight, flexDirection: 'row', gap: Spacing.md, alignItems: 'center' }, bannerTitle: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold }, info: { fontSize: Typography.size.xs, lineHeight: 16, color: Colors.textTertiary, paddingVertical: Spacing.xs, paddingHorizontal: Spacing.base }, error: { color: Colors.danger, padding: Spacing.base, fontSize: Typography.size.base }, list: { paddingHorizontal: Spacing.base, paddingTop: Spacing.xs, paddingBottom: Spacing.lg },
  syncError: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, padding: Spacing.base, backgroundColor: Colors.surface }, syncErrorText: { flex: 1, color: Colors.warning, fontSize: Typography.size.sm, lineHeight: 22 },
  engagement: {flexDirection:'row',alignItems:'center',gap:Spacing.xs,flexWrap:'wrap',marginTop:Spacing.sm}, engagementText: {fontSize:Typography.size.sm,color:Colors.textSecondary},
  reprice: {minHeight:48,flexDirection:'row',alignItems:'center',gap:Spacing.sm,marginTop:Spacing.sm,padding:Spacing.sm,borderRadius:Radius.sm,backgroundColor:Colors.surfaceHighlight}, repriceText:{flex:1,fontSize:Typography.size.sm,fontWeight:Typography.weight.semibold,lineHeight:20}, pressed:{opacity:0.6},
  orderRow:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:Spacing.sm,paddingHorizontal:Spacing.base,paddingVertical:Spacing.xs,flexWrap:'wrap'},orderNote:{flexGrow:1,fontSize:Typography.size.sm,color:Colors.textSecondary,lineHeight:20},orderButton:{minHeight:48,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:Spacing.sm,paddingHorizontal:Spacing.md,borderRadius:Radius.md,backgroundColor:Colors.surfaceHighlight},orderText:{fontSize:Typography.size.base,color:Colors.textPrimary,lineHeight:26},orderModal:{width:'100%',maxWidth:380,height:480,padding:Spacing.base,borderRadius:Radius.xl,backgroundColor:Colors.surface},orderHeading:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginBottom:Spacing.sm},orderOption:{minHeight:52,flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:Spacing.md,borderBottomWidth:1,borderBottomColor:Colors.surfaceBorder},
  card: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: Spacing.sm, borderWidth: 1, borderColor: Colors.surfaceBorder, borderLeftWidth: 3, ...Shadow.sm }, thumb: { width: 52, height: 52, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceHighlight }, reference: { fontSize: Typography.size.xs, fontWeight: Typography.weight.semibold }, itemTitle: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.textPrimary, lineHeight: 20 }, priceRow: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'center', marginTop: Spacing.xs }, status: { fontSize: Typography.size.xs }, price: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, marginLeft: 'auto' }, action: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center', gap: Spacing.xs }, actionText: { fontSize: Typography.size.xs, fontWeight: Typography.weight.semibold },
  empty: { alignItems: 'center', paddingVertical: 24, paddingHorizontal: Spacing.lg, gap: Spacing.sm }, emptyTitle: { color: Colors.textPrimary, fontSize: Typography.size.lg, fontWeight: Typography.weight.semibold, textAlign: 'center' }, emptyText: { color: Colors.textTertiary, fontSize: Typography.size.base, lineHeight: 26, textAlign: 'center' }, emptyButton: { minHeight: 48, padding: Spacing.md, borderRadius: Radius.pill }, buttonText: { color: Colors.background, fontSize: Typography.size.base, fontWeight: Typography.weight.bold }, overlay: { flex: 1, backgroundColor: Colors.overlay, justifyContent: 'center', alignItems: 'center', padding: Spacing.lg }, modal: { width: '100%', maxWidth: 380, padding: Spacing.lg, borderRadius: Radius.xl, backgroundColor: Colors.surface, gap: Spacing.md, alignItems: 'center' },
});
