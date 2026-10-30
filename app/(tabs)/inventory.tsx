// Canonical Stock/Draft/Live/Sold presentation. All reads/actions live in shared hooks/services.
import { useState, useMemo, memo } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, TextInput, ScrollView, Modal, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { ItemImage } from '@/components';
import { useApp } from '@/hooks/useApp';
import { useMasterInventory } from '@/hooks/useMasterInventory';
import { NICHES, type NicheConfig } from '@/constants/niches';
import { resolveProductionNiche } from '@/services/nicheRouting';
import { Colors, Typography, Spacing, Radius, Shadow } from '@/constants/theme';
import type { InventoryTab, InventoryViewItem } from '@/services/inventoryViewService';
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
interface InventoryCardProps { item: InventoryViewItem; tab: InventoryTab; config: NicheConfig; onOpen: () => void; onAction: () => void }
const InventoryCard = memo(function InventoryCard({ item, tab, config, onOpen, onAction }: InventoryCardProps) {
  const color = tab === 'live' ? Colors.success : tab === 'sold' ? Colors.accent : config.color;
  const price = tab === 'sold' ? item.soldPrice : item.listing?.price ?? item.expectedSellingPrice ?? item.valuationMid;
  const meta = config.keyAttributes.map(key => item.attributes[key]).filter(value => typeof value === 'string' || typeof value === 'number').slice(0, 3).join(' · ');
  return <Pressable onPress={onOpen} style={({ pressed }) => [s.card, { borderLeftColor: color, opacity: pressed ? 0.85 : 1 }]}>
    {item.media[0] ? <ItemImage uri={item.media[0]} contentFit="cover" transition={150} style={s.thumb} /> : <View style={s.thumb}><MaterialIcons name={config.icon as any} size={24} color={color} /></View>}
    <View style={s.flex}>
      {item.inventoryId ? <Text style={[s.reference, { color }]}>{item.inventoryId}</Text> : null}
      <Text style={s.itemTitle} numberOfLines={2}>{item.canonical_title || 'Untitled'}</Text>
      {meta ? <Text style={s.sub} numberOfLines={1}>{meta}</Text> : null}
      <View style={s.priceRow}><Text style={[s.status, { color }]}>{tab === 'live' ? 'Live on eBay' : TABS.find(t => t.id === tab)?.label}</Text>
        {Number(price) > 0 ? <Text style={[s.price, { color }]}>£{Number(price).toFixed(2)}</Text> : null}
      </View>
      {tab === 'live' && item.listing?.watchers ? <Text style={s.sub}>{item.listing.watchers} watchers</Text> : null}
      {tab === 'sold' && item.soldAt ? <Text style={s.sub}>{new Date(item.soldAt).toLocaleDateString('en-GB')}</Text> : null}
    </View>
    {tab !== 'sold' ? <Pressable accessibilityLabel={tab === 'stock' ? 'Create listing' : tab === 'draft' ? 'Submit draft' : 'End listing'} onPress={event => { event.stopPropagation(); onAction(); }} style={({ pressed }) => [s.action, { opacity: pressed ? 0.7 : 1 }]}>
      <MaterialIcons name={tab === 'stock' ? 'sell' : tab === 'draft' ? 'send' : 'stop'} size={16} color={color} />
      <Text style={[s.actionText, { color }]}>{tab === 'stock' ? 'List' : tab === 'draft' ? 'Submit' : 'End'}</Text>
    </Pressable> : null}
  </Pressable>;
});
export default function MasterInventoryScreen() {
  const state = useMasterInventory(); const router = useRouter();
  const { tenant, businessConfig } = useApp();
  const [search, setSearch] = useState(''); const [filter, setFilter] = useState('');
  const [showReValue, setShowReValue] = useState(false); const [showReIdentify, setShowReIdentify] = useState(false);
  const [progress, setProgress] = useState<any>(null);
  const id = resolveProductionNiche(state.nicheId); const config = id ? NICHES[id] : NICHES.general;
  const filters = FILTERS[id ?? ''] ?? [[`All ${config.terms.items}`, '']]; const banner = BANNERS[id ?? ''];
  const data = useMemo(() => state.views[state.activeTab].filter(item => {
    const haystack = `${item.canonical_title} ${item.catalogueNumber ?? ''} ${item.inventoryId ?? ''} ${JSON.stringify(item.attributes)}`.toLowerCase();
    return (!search.trim() || haystack.includes(search.trim().toLowerCase())) && (state.activeTab !== 'stock' || !filter || haystack.includes(filter));
  }), [state.views, state.activeTab, search, filter]);
  const closeBulk = () => { setShowReIdentify(false); setShowReValue(false); setProgress(null); void state.reload(); };
  return <SafeAreaView edges={['top']} style={s.container}>
    <StatusBar style="light" />
    <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={s.header}>
        <View style={s.headerIcon}><MaterialIcons name={config.icon as any} size={22} color={config.color} /></View>
        <View style={s.flex}><Text style={[s.headerTitle, { color: config.color }]}>{config.shortName} Inventory</Text>
          <Text style={s.sub}>{state.counts.stock} in stock · {state.counts.draft} draft · {state.counts.live} live · {state.counts.sold} sold</Text></View>
        <Pressable onPress={() => void state.syncListings()} disabled={state.syncingListings} style={({ pressed }) => [s.hBtn, { opacity: pressed || state.syncingListings ? 0.6 : 1 }]} accessibilityLabel="Check this niche's listing statuses on eBay">{state.syncingListings ? <ActivityIndicator size="small" color={config.color} /> : <MaterialIcons name="sync" size={20} color={config.color} />}</Pressable>
        {state.activeTab === 'sold' ? <Pressable onPress={state.syncSold} disabled={state.syncing} style={s.hBtn} accessibilityLabel="Sync sold orders"><MaterialIcons name="sync" size={20} color={config.color} /></Pressable> : null}
        {state.activeTab === 'stock' && data.length ? <>
          <Pressable onPress={() => setShowReValue(true)} style={s.hBtn} accessibilityLabel="Bulk revalue"><MaterialIcons name="travel-explore" size={20} color={config.color} /></Pressable>
          <Pressable onPress={() => setShowReIdentify(true)} style={s.hBtn} accessibilityLabel="Bulk reidentify"><MaterialIcons name="auto-awesome" size={20} color={Colors.accent} /></Pressable>
        </> : null}
        <Pressable onPress={() => router.push('/(tabs)/scan')} style={[s.hBtn, { backgroundColor: config.color }]} accessibilityLabel="Add inventory"><MaterialIcons name="add" size={22} color={Colors.background} /></Pressable>
      </View>
      <View style={s.rail}><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.railContent}>
        {TABS.map(tab => <Pressable key={tab.id} onPress={() => state.setActiveTab(tab.id)} style={({ pressed }) => [s.chip, { borderColor: state.activeTab === tab.id ? tab.color : Colors.surfaceBorder, opacity: pressed ? 0.7 : 1 }]}>
          <MaterialIcons name={tab.icon as any} size={16} color={state.activeTab === tab.id ? tab.color : Colors.textTertiary} />
          <Text style={[s.chipText, { color: state.activeTab === tab.id ? tab.color : Colors.textSecondary }]}>{tab.label} {state.counts[tab.id]}</Text>
        </Pressable>)}
      </ScrollView></View>
      <View style={s.searchWrap}><MaterialIcons name="search" size={20} color={Colors.textTertiary} />
        <TextInput accessibilityLabel={`Search ${config.terms.items}`} value={search} onChangeText={setSearch} placeholder={`Search ${config.terms.items.toLowerCase()}...`} placeholderTextColor={Colors.textTertiary} style={s.input} />
        {search ? <Pressable onPress={() => setSearch('')} style={s.hBtn} accessibilityLabel="Clear search"><MaterialIcons name="close" size={18} color={Colors.textSecondary} /></Pressable> : null}
      </View>
      {state.activeTab === 'stock' && banner ? <Pressable onPress={() => router.push(banner.route as any)} style={({ pressed }) => [s.banner, { opacity: pressed ? 0.85 : 1 }]}>
        <MaterialIcons name={banner.icon as any} size={22} color={config.color} /><View style={s.flex}><Text style={[s.bannerTitle, { color: config.color }]}>{banner.title}</Text><Text style={s.sub}>{banner.sub}</Text></View><MaterialIcons name="arrow-forward" size={20} color={config.color} />
      </Pressable> : null}
      {state.activeTab === 'stock' && filters.length > 1 ? <View style={s.rail}><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.railContent}>
        {filters.map(([label, value]) => <Pressable key={value} onPress={() => setFilter(value)} style={({ pressed }) => [s.chip, { borderColor: filter === value ? config.color : Colors.surfaceBorder, opacity: pressed ? 0.7 : 1 }]}><Text style={[s.chipText, { color: filter === value ? config.color : Colors.textSecondary }]}>{label}</Text></Pressable>)}
      </ScrollView></View> : null}
      <Text style={s.info}>{state.activeTab === 'draft' ? 'Drafts are saved in SWISH — Submit publishes to eBay' : state.activeTab === 'live' ? 'Live excludes sold, ended and completed records in this niche. Sync checks current eBay availability.' : state.activeTab === 'sold' ? 'Sync pulls orders from your connected eBay account' : `${filters.find(entry => entry[1] === filter)?.[0] ?? 'In Stock'} · ${data.length} items`}</Text>
      {state.syncingListings ? <Text style={s.info}>Checking eBay status · {state.syncProgress.checked}/{state.syncProgress.total}</Text> : null}
      {state.syncError ? <View style={s.syncError}><MaterialIcons name="error-outline" size={20} color={Colors.warning} /><Text style={s.syncErrorText}>{state.syncError} Unchecked records retain their last stored status.</Text></View> : null}
      {state.error ? <Text style={s.error}>{state.error}</Text> : null}
      <FlatList style={s.flex} data={data} keyExtractor={item => `${state.activeTab}-${item.id}-${item.listing?.id ?? ''}`} showsVerticalScrollIndicator={false} contentContainerStyle={s.list} refreshing={state.refreshing} onRefresh={state.refresh}
        ItemSeparatorComponent={() => <View style={{ height: Spacing.sm }} />}
        renderItem={({ item }) => <InventoryCard item={item} tab={state.activeTab} config={config} onOpen={() => router.push(`/stock-listing/${item.id}` as any)} onAction={() => state.activeTab === 'stock' ? router.push(`/create-listing?id=${item.id}` as any) : state.activeTab === 'draft' ? void state.submit(item) : state.end(item)} />}
        ListEmptyComponent={<View style={s.empty}><MaterialIcons name={config.icon as any} size={40} color={config.color} /><Text style={s.emptyTitle}>{state.loading ? 'Loading inventory...' : `No ${state.activeTab === 'stock' ? config.terms.items.toLowerCase() + ' in stock' : state.activeTab + ' items'}`}</Text>
          <Text style={s.emptyText}>{search ? 'Try another search or filter.' : state.activeTab === 'stock' ? 'Capture an item to start preparing a listing.' : state.activeTab === 'draft' ? 'Tap List on an in-stock item to create a draft.' : state.activeTab === 'sold' ? 'Sold records appear after order synchronization.' : 'Submit a draft to publish it on eBay.'}</Text>
          {state.activeTab === 'stock' ? <Pressable onPress={() => router.push('/(tabs)/scan')} style={[s.emptyButton, { backgroundColor: config.color }]}><Text style={s.buttonText}>Add {config.terms.item}</Text></Pressable> : state.activeTab === 'sold' ? <Pressable onPress={state.syncSold} style={[s.emptyButton, { backgroundColor: config.color }]}><Text style={s.buttonText}>{state.syncing ? 'Syncing...' : 'Sync from eBay'}</Text></Pressable> : null}
        </View>}
      />
    </KeyboardAvoidingView>
    <BulkReIdentifyModal visible={showReIdentify} items={data} tenantId={tenant?.id ?? ''} progress={progress} onProgress={setProgress} onClose={closeBulk} />
    {tenant ? <BulkReValueSheet visible={showReValue} onClose={closeBulk} tenantId={tenant.id} items={data.map(item => ({ id: item.id, canonical_title: item.canonical_title, specialist_id: item.specialist_id, condition: item.condition ?? '', attributes: item.attributes, media: item.media }))} autonomousMode={businessConfig?.autoValue === true || businessConfig?.automationLevel === 'autonomous'} /> : null}
    <Modal visible={state.submitStep !== null} transparent animationType="fade" onRequestClose={() => {}}><View style={s.overlay}><View style={s.modal}><ActivityIndicator color={config.color} /><Text style={s.emptyTitle}>Submitting to eBay</Text><Text style={s.sub}>{state.submitTitle}</Text><Text style={s.info}>{state.submitStep?.replace(/_/g, ' ')}</Text></View></View></Modal>
  </SafeAreaView>;
}
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background }, flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, padding: Spacing.base, borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder, flexWrap: 'wrap' }, headerIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surface, borderRadius: Radius.md }, headerTitle: { fontSize: Typography.size.xl, fontWeight: Typography.weight.bold }, sub: { color: Colors.textTertiary, fontSize: Typography.size.xs, lineHeight: 18 }, hBtn: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: Radius.md, backgroundColor: Colors.surface },
  rail: { minHeight: 52, borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder }, railContent: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, paddingHorizontal: Spacing.base, paddingVertical: Spacing.sm }, chip: { height: 40, borderRadius: Radius.md, borderWidth: 1, backgroundColor: Colors.surface, paddingHorizontal: Spacing.md, gap: Spacing.xs, flexDirection: 'row', alignItems: 'center' }, chipText: { fontSize: Typography.size.xs, fontWeight: Typography.weight.semibold }, searchWrap: { height: 48, margin: Spacing.base, marginVertical: Spacing.sm, paddingLeft: Spacing.sm, flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: Radius.md }, input: { flex: 1, padding: Spacing.sm, color: Colors.textPrimary, fontSize: Typography.size.base, includeFontPadding: false },
  banner: { marginHorizontal: Spacing.base, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surfaceHighlight, flexDirection: 'row', gap: Spacing.md, alignItems: 'center' }, bannerTitle: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold }, info: { fontSize: Typography.size.xs, lineHeight: 18, color: Colors.textTertiary, padding: Spacing.sm, paddingHorizontal: Spacing.base }, error: { color: Colors.danger, padding: Spacing.base, fontSize: Typography.size.base }, list: { paddingHorizontal: Spacing.base, paddingTop: Spacing.sm, paddingBottom: Spacing.xl },
  syncError: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, padding: Spacing.base, backgroundColor: Colors.surface }, syncErrorText: { flex: 1, color: Colors.warning, fontSize: Typography.size.sm, lineHeight: 22 },
  card: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surface, borderRadius: Radius.xl, padding: Spacing.md, borderWidth: 1, borderColor: Colors.surfaceBorder, borderLeftWidth: 3, ...Shadow.sm }, thumb: { width: 60, height: 60, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceHighlight }, reference: { fontSize: Typography.size.xs, fontWeight: Typography.weight.semibold }, itemTitle: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.textPrimary, lineHeight: 20 }, priceRow: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'center', marginTop: Spacing.xs }, status: { fontSize: Typography.size.xs }, price: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, marginLeft: 'auto' }, action: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center', gap: Spacing.xs }, actionText: { fontSize: Typography.size.xs, fontWeight: Typography.weight.semibold },
  empty: { alignItems: 'center', paddingVertical: 48, paddingHorizontal: Spacing.lg, gap: Spacing.md }, emptyTitle: { color: Colors.textPrimary, fontSize: Typography.size.lg, fontWeight: Typography.weight.semibold, textAlign: 'center' }, emptyText: { color: Colors.textTertiary, fontSize: Typography.size.base, lineHeight: 26, textAlign: 'center' }, emptyButton: { minHeight: 48, padding: Spacing.md, borderRadius: Radius.pill }, buttonText: { color: Colors.background, fontSize: Typography.size.base, fontWeight: Typography.weight.bold }, overlay: { flex: 1, backgroundColor: Colors.overlay, justifyContent: 'center', alignItems: 'center', padding: Spacing.lg }, modal: { width: '100%', maxWidth: 380, padding: Spacing.lg, borderRadius: Radius.xl, backgroundColor: Colors.surface, gap: Spacing.md, alignItems: 'center' },
});
