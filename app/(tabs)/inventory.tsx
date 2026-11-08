// Shared Stock / Draft / Live / Sold workspace for every niche.
// Advanced inventory actions and account details are in More → Inventory tools.
import { useState, useMemo, useEffect, memo } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, TextInput, ScrollView, Modal, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { preferredStudioImage } from '@/shared/smartStudio';
import { useInventoryRemoval } from '@/hooks/useInventoryRemoval';
import { useInventoryPriceRevision } from '@/hooks/useInventoryPriceRevision';
import { inventoryOrderOptions, orderInventory, recommendedInventoryPrice, type InventoryOrder } from '@/services/inventoryPresentationService';
import { inventoryCardMetadata } from '@/services/inventoryToolsService';
import { ItemImage } from '@/components';
import { useMasterInventory } from '@/hooks/useMasterInventory';
import { NICHES, type NicheConfig } from '@/constants/niches';
import { resolveProductionNiche } from '@/services/nicheRouting';
import { Colors, Typography, Spacing, Radius, Shadow } from '@/constants/theme';
import type { InventoryTab, InventoryViewItem } from '@/services/inventoryViewService';

const TABS: Array<{ id: InventoryTab; label: string; icon: string; color: string }> = [
 { id: 'stock', label: 'In Stock', icon: 'inventory-2', color: Colors.primary },
 { id: 'draft', label: 'Draft', icon: 'edit', color: Colors.textSecondary },
 { id: 'live', label: 'Live', icon: 'storefront', color: Colors.success },
 { id: 'sold', label: 'Sold', icon: 'check-circle', color: Colors.accent },
];
interface InventoryCardProps { item: InventoryViewItem; tab: InventoryTab; config: NicheConfig; busy: boolean; onOpen: () => void; onAction: () => void; onDelete: () => void; onReprice: () => void; priceBlocked: boolean }
const InventoryCard = memo(function InventoryCard({ item, tab, config, busy, onOpen, onAction, onDelete, onReprice, priceBlocked }: InventoryCardProps) {
 const color = tab === 'live' ? Colors.success : tab === 'sold' ? Colors.accent : config.color;
 const price = tab === 'sold' ? item.soldPrice : item.listing?.price ?? item.expectedSellingPrice ?? item.valuationMid;
 const recommendation = tab === 'live' ? recommendedInventoryPrice(item) : null;
 const meta = inventoryCardMetadata(item, config);
 const image = preferredStudioImage(item.media, item.attributes);
 return <Pressable accessibilityRole="button" accessibilityLabel={`Open ${item.canonical_title}`} onPress={onOpen} style={({pressed}) => [s.card, { borderLeftColor: color }, pressed ? s.pressed : null]}>
  {image ? <ItemImage uri={image} contentFit="cover" transition={150} style={s.thumb}/> : <View style={s.thumb}><MaterialIcons name={config.icon as any} size={24} color={color}/></View>}
  <View style={s.flex}>
   {item.inventoryId ? <Text style={[s.reference, { color }]}>{item.inventoryId}</Text> : null}
   <Text style={s.itemTitle} numberOfLines={2}>{item.canonical_title || 'Untitled'}</Text>
   {meta ? <Text style={s.sub} numberOfLines={1}>{meta}</Text> : null}
   {item.attributes?._photo_pipeline && item.attributes._photo_pipeline.status !== 'complete' ? <Text accessibilityRole="alert" style={[s.sub, { color: Colors.warning }]}>Photos need retry · open this saved item</Text> : null}
   <View style={s.priceRow}><Text style={[s.status, { color }]}>{tab === 'live' ? 'Live on eBay' : TABS.find(value => value.id === tab)?.label}</Text>{Number(price) > 0 ? <Text style={[s.price, { color }]}>£{Number(price).toFixed(2)}</Text> : null}</View>
   {tab === 'live' && item.listing ? <View style={s.engagement}><MaterialIcons name="visibility" size={16} color={Colors.textSecondary}/><Text style={s.sub}>{item.listing.views ?? 0} views</Text><MaterialIcons name="star-border" size={16} color={Colors.textSecondary}/><Text style={s.sub}>{item.listing.watchers ?? 0} watchers</Text></View> : null}
   {recommendation !== null ? <Pressable disabled={busy || priceBlocked} accessibilityRole="button" accessibilityLabel={`Apply recommended price £${recommendation.toFixed(2)} on eBay`} onPress={event => { event.stopPropagation(); onReprice(); }} style={({pressed}) => [s.reprice, pressed || busy || priceBlocked ? s.pressed : null]}><MaterialIcons name="price-change" size={18} color={config.color}/><Text style={[s.repriceText, { color: config.color }]}>{priceBlocked ? 'Check price in listing editor' : `Recommended £${recommendation.toFixed(2)} · Apply on eBay`}</Text></Pressable> : null}
   {tab === 'sold' && item.soldAt ? <Text style={s.sub}>{new Date(item.soldAt).toLocaleDateString('en-GB')}</Text> : null}
  </View>
  <View style={s.cardActions}>
   {tab !== 'sold' ? <Pressable disabled={busy} accessibilityRole="button" accessibilityLabel={tab === 'stock' ? 'Create listing' : tab === 'draft' ? 'Edit and review draft' : 'End listing'} onPress={event => { event.stopPropagation(); onAction(); }} style={({pressed}) => [s.action, pressed || busy ? s.pressed : null]}>{busy ? <ActivityIndicator size="small" color={color}/> : <MaterialIcons name={tab === 'stock' ? 'sell' : tab === 'draft' ? 'edit' : 'stop'} size={20} color={color}/>}<Text style={[s.actionText, { color }]}>{tab === 'stock' ? 'List' : tab === 'draft' ? 'Edit' : 'End'}</Text></Pressable> : null}
   {tab === 'stock' || tab === 'draft' ? <Pressable accessibilityRole="button" accessibilityLabel={`Delete inventory item: ${item.canonical_title}`} disabled={busy} onPress={event => { event.stopPropagation(); onDelete(); }} style={({pressed}) => [s.action, pressed || busy ? s.pressed : null]}><MaterialIcons name="delete-outline" size={20} color={Colors.danger}/><Text style={[s.actionText, { color: Colors.danger }]}>Delete</Text></Pressable> : null}
  </View>
 </Pressable>;
});
export default function MasterInventoryScreen() {
 const state = useMasterInventory(); const router = useRouter();
 const removal = useInventoryRemoval(state.removeDeletedItem);
 const priceRevision = useInventoryPriceRevision(state.reload);
 const [order, setOrder] = useState<InventoryOrder>('newest'); const [showOrder, setShowOrder] = useState(false);
 const [search, setSearch] = useState({ scope: '', value: '' });
 const { tab: requestedTab } = useLocalSearchParams<{ tab?: string }>();
 const id = resolveProductionNiche(state.nicheId); const config = id ? NICHES[id] : NICHES.general;
 const displayKnown = state.hasSnapshot;
 const effectiveSearch = search.scope === state.scope ? search.value : '';
 useEffect(() => {
  if (requestedTab && ['stock', 'draft', 'live', 'sold'].includes(requestedTab) && state.ready) state.setActiveTab(requestedTab as InventoryTab);
 }, [requestedTab, state.ready, state.scope, state.setActiveTab]);
 const data = useMemo(() => orderInventory(state.views[state.activeTab].filter(item => {
  if (!effectiveSearch.trim()) return true;
  const haystack = `${item.canonical_title} ${item.inventoryId ?? ''} ${item.catalogueNumber ?? ''} ${item.ruler ?? ''} ${item.denomination ?? ''} ${item.mint ?? ''} ${item.material ?? ''} ${item.folderNumber ?? ''} ${item.pocketPosition ?? ''} ${JSON.stringify(item.attributes)}`.toLowerCase();
  return haystack.includes(effectiveSearch.trim().toLowerCase());
 }), order), [state.views, state.activeTab, effectiveSearch, order]);
 const selected = TABS.find(tab => tab.id === state.activeTab)!;
 return <SafeAreaView edges={['top']} style={s.container}>
  <StatusBar style="light"/>
  <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
   <View style={s.header}>
    <View style={s.headerIcon}><MaterialIcons name={config.icon as any} size={24} color={config.color}/></View>
    <View style={s.headerText}><Text numberOfLines={1} adjustsFontSizeToFit style={[s.headerTitle, { color: config.color }]}>{config.shortName} Inventory</Text><Text style={s.sub}>{displayKnown ? `${state.totalCount} unique items · ${state.counts.live} live · ${state.counts.sold} sold` : 'Loading account inventory'}</Text></View>
    <Pressable accessibilityRole="button" accessibilityLabel={`Add ${config.terms.item.toLowerCase()}`} onPress={() => router.push('/(tabs)/scan' as any)} style={({pressed}) => [s.hBtn, { backgroundColor: config.color }, pressed ? s.pressed : null]}><MaterialIcons name="add" size={24} color={Colors.textInverse}/></Pressable>
   </View>
   <View style={s.rail}><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.railContent}>
    {TABS.map(tab => { const active = state.activeTab === tab.id; const color = tab.id === 'stock' || tab.id === 'sold' ? config.color : tab.color; return <Pressable key={tab.id} hitSlop={4} accessibilityRole="tab" accessibilityState={{ selected: active }} onPress={() => state.setActiveTab(tab.id)} style={({pressed}) => [s.chip, { borderColor: active ? color : Colors.surfaceBorder }, pressed ? s.pressed : null]}><MaterialIcons name={tab.icon as any} size={18} color={active ? color : Colors.textTertiary}/><Text style={[s.chipText, { color: active ? color : Colors.textSecondary }]}>{tab.label} {displayKnown ? state.counts[tab.id] : '—'}</Text></Pressable>; })}
   </ScrollView></View>
   <View style={s.searchRow}><View style={s.searchWrap}><MaterialIcons name="search" size={20} color={Colors.textTertiary}/><TextInput accessibilityLabel={`Search ${config.terms.items}`} value={effectiveSearch} onChangeText={value => setSearch({scope: state.scope, value})} placeholder={`Search ${config.terms.items.toLowerCase()}...`} placeholderTextColor={Colors.textTertiary} style={s.input} autoCorrect={false}/>{effectiveSearch ? <Pressable accessibilityLabel="Clear search" onPress={() => setSearch({scope: state.scope, value: ''})} style={({pressed}) => [s.hBtn, pressed ? s.pressed : null]}><MaterialIcons name="close" size={20} color={Colors.textSecondary}/></Pressable> : null}</View><Pressable accessibilityRole="button" accessibilityLabel={`Order inventory by: ${inventoryOrderOptions.find(option => option.id === order)?.label}`} onPress={() => setShowOrder(true)} style={({pressed}) => [s.orderButton, pressed ? s.pressed : null]}><MaterialIcons name="sort" size={24} color={config.color}/></Pressable></View>
   {state.error ? <View style={s.syncError}><MaterialIcons name="error-outline" size={20} color={Colors.warning}/><Text accessibilityRole="alert" style={s.syncErrorText}>{state.error} Inventory is not confirmed empty.</Text><Pressable disabled={state.loading} onPress={() => void state.refresh()} style={({pressed}) => [s.hBtn, pressed || state.loading ? s.pressed : null]}><Text style={s.chipText}>Retry</Text></Pressable></View> : null}
   {priceRevision.error || priceRevision.notice ? <View style={s.syncError}><MaterialIcons name={priceRevision.error ? 'error-outline' : 'check-circle-outline'} size={20} color={priceRevision.error ? Colors.warning : Colors.success}/><Text accessibilityLiveRegion="polite" style={s.syncErrorText}>{priceRevision.error ?? priceRevision.notice}</Text></View> : null}
   <FlatList style={s.flex} data={data} keyExtractor={item => `${state.activeTab}-${item.id}-${item.listing?.id ?? ''}`} showsVerticalScrollIndicator={false} contentContainerStyle={s.list} refreshing={state.refreshing} onRefresh={state.refresh} initialNumToRender={8} maxToRenderPerBatch={8} windowSize={5}
    ListHeaderComponent={<View style={s.listHeader}><Text style={s.sub}>{displayKnown ? `${selected.label} · ${data.length} ${config.terms.itemPlural}${effectiveSearch ? ' matching' : ''}` : 'Verifying inventory…'}{state.loading && displayKnown ? ' · Refreshing…' : ''}</Text><Text style={s.sub}>{state.error && displayKnown ? 'Last loaded inventory' : 'Pull to refresh'} · {inventoryOrderOptions.find(option => option.id === order)?.label}</Text></View>}
    ItemSeparatorComponent={() => <View style={s.separator}/>}
    renderItem={({item}) => <InventoryCard item={item} tab={state.activeTab} config={config} busy={removal.busyId !== null || state.endingItemId !== null || priceRevision.busyId !== null || !state.ready} onOpen={() => router.push(`/stock-listing/${item.id}` as any)} onAction={() => state.activeTab === 'stock' ? router.push(`/create-listing?id=${item.id}` as any) : state.activeTab === 'draft' ? router.push(item.listing?.id ? `/ebay-listing-editor?id=${item.listing.id}` as any : `/create-listing?id=${item.id}` as any) : state.end(item)} onDelete={() => removal.requestDelete({ id: item.id, title: item.canonical_title, specialistId: item.specialist_id, tenantId: item.tenantId, status: item.status })} onReprice={() => void priceRevision.apply(item)} priceBlocked={Boolean(item.listing && priceRevision.blockedIds.includes(item.listing.id))}/>}
    ListEmptyComponent={<View style={s.empty}>{state.loading ? <ActivityIndicator color={config.color}/> : <MaterialIcons name={config.icon as any} size={40} color={config.color}/>}<Text style={s.emptyTitle}>{state.error ? 'Inventory could not be verified' : state.loading ? 'Loading authorised inventory…' : effectiveSearch ? 'No matching items' : `No ${config.terms.itemPlural} ${state.activeTab === 'stock' ? 'in stock' : 'in ' + selected.label.toLowerCase()}`}</Text><Text style={s.emptyText}>{state.error ? 'Retry above. Saved records and photos are unchanged.' : effectiveSearch ? 'Try a title, reference, maker or another search.' : state.loading ? 'Your saved inventory is being checked.' : state.activeTab === 'stock' ? 'Capture an item, or choose Draft, Live or Sold above.' : state.activeTab === 'sold' ? 'Order sync is available in More → Inventory tools.' : 'Choose another inventory tab or capture an item.'}</Text>{!state.loading && !state.error && state.activeTab === 'stock' && !effectiveSearch ? <Pressable accessibilityRole="button" onPress={() => router.push('/(tabs)/scan' as any)} style={({pressed}) => [s.emptyButton, { backgroundColor: config.color }, pressed ? s.pressed : null]}><Text style={s.buttonText}>Add {config.terms.item}</Text></Pressable> : null}</View>}
   />
  </KeyboardAvoidingView>
  <Modal visible={showOrder} transparent animationType="fade" onRequestClose={() => setShowOrder(false)}><SafeAreaView edges={['top','bottom']} style={s.overlay}><View style={s.orderModal}><View style={s.orderHeading}><Text style={s.emptyTitle}>Order by</Text><Pressable accessibilityLabel="Close ordering options" onPress={() => setShowOrder(false)} style={({pressed}) => [s.hBtn, pressed ? s.pressed : null]}><MaterialIcons name="close" size={24} color={Colors.textPrimary}/></Pressable></View><FlatList data={inventoryOrderOptions} keyExtractor={option => option.id} showsVerticalScrollIndicator={false} renderItem={({item: option}) => <Pressable accessibilityRole="radio" accessibilityState={{ checked: order === option.id }} onPress={() => { setOrder(option.id); setShowOrder(false); }} style={({pressed}) => [s.orderOption, pressed ? s.pressed : null]}><Text style={[s.orderText, order === option.id ? { color: config.color } : null]}>{option.label}</Text><MaterialIcons name={order === option.id ? 'radio-button-checked' : 'radio-button-unchecked'} size={24} color={order === option.id ? config.color : Colors.textSecondary}/></Pressable>}/></View></SafeAreaView></Modal>
 </SafeAreaView>;
}
const s = StyleSheet.create({
 container: { flex: 1, backgroundColor: Colors.background }, flex: { flex: 1 },
 header: { paddingHorizontal: Spacing.base, paddingVertical: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }, headerText: { flex: 1, minWidth: 0, gap: Spacing.xs }, headerIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surface, borderRadius: Radius.md }, headerTitle: { fontSize: Typography.size.lg, fontWeight: Typography.weight.bold, includeFontPadding: false }, sub: { color: Colors.textSecondary, fontSize: Typography.size.sm, lineHeight: Typography.size.sm * Typography.lineHeight.relaxed, includeFontPadding: false }, hBtn: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: Radius.md, backgroundColor: Colors.surface },
 rail: { minHeight: 56, borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder }, railContent: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.base, paddingVertical: Spacing.sm }, chip: { height: 40, borderRadius: Radius.md, borderWidth: 1, backgroundColor: Colors.surface, paddingHorizontal: Spacing.sm, gap: Spacing.xs, flexDirection: 'row', alignItems: 'center' }, chipText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.textPrimary, includeFontPadding: false },
 searchRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.base, paddingVertical: Spacing.sm }, searchWrap: { flex: 1, minHeight: 48, paddingLeft: Spacing.sm, flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: Radius.md }, input: { flex: 1, minWidth: 0, padding: Spacing.sm, color: Colors.textPrimary, fontSize: Typography.size.base, includeFontPadding: false }, orderButton: { width: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: Radius.md, backgroundColor: Colors.surfaceHighlight },
 list: { paddingHorizontal: Spacing.base, paddingBottom: Spacing.xl, width: '100%', maxWidth: 960, alignSelf: 'center' }, listHeader: { gap: Spacing.xs, paddingBottom: Spacing.sm }, separator: { height: Spacing.sm }, syncError: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.base, backgroundColor: Colors.surface }, syncErrorText: { flex: 1, color: Colors.warning, fontSize: Typography.size.sm, lineHeight: Typography.size.sm * Typography.lineHeight.relaxed },
 card: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.surfaceBorder, borderLeftWidth: 3, ...Shadow.sm }, thumb: { width: 56, height: 56, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceHighlight }, reference: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold }, itemTitle: { fontSize: Typography.size.base, fontWeight: Typography.weight.semibold, color: Colors.textPrimary, lineHeight: Typography.size.base * Typography.lineHeight.normal, includeFontPadding: false }, priceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, alignItems: 'center', marginTop: Spacing.xs }, status: { fontSize: Typography.size.sm }, price: { fontSize: Typography.size.base, fontWeight: Typography.weight.bold, marginLeft: 'auto' }, cardActions: { alignItems: 'center' }, action: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center', gap: Spacing.xs }, actionText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold }, engagement: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, flexWrap: 'wrap', marginTop: Spacing.sm },
 reprice: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.sm, padding: Spacing.sm, borderRadius: Radius.sm, backgroundColor: Colors.surfaceHighlight }, repriceText: { flex: 1, fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, lineHeight: Typography.size.sm * Typography.lineHeight.relaxed }, pressed: { opacity: 0.7 },
 orderModal: { width: '100%', maxWidth: 380, height: 480, padding: Spacing.base, borderRadius: Radius.xl, backgroundColor: Colors.surface }, orderHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.sm }, orderOption: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder }, orderText: { fontSize: Typography.size.base, color: Colors.textPrimary, lineHeight: Typography.size.base * Typography.lineHeight.relaxed }, overlay: { flex: 1, backgroundColor: Colors.overlay, justifyContent: 'center', alignItems: 'center', padding: Spacing.lg },
 empty: { alignItems: 'center', paddingVertical: Spacing.xl, paddingHorizontal: Spacing.lg, gap: Spacing.sm }, emptyTitle: { color: Colors.textPrimary, fontSize: Typography.size.lg, fontWeight: Typography.weight.semibold, textAlign: 'center' }, emptyText: { color: Colors.textSecondary, fontSize: Typography.size.base, lineHeight: Typography.size.base * Typography.lineHeight.relaxed, textAlign: 'center' }, emptyButton: { minHeight: 48, padding: Spacing.base, borderRadius: Radius.md }, buttonText: { color: Colors.textInverse, fontSize: Typography.size.base, fontWeight: Typography.weight.bold },
});
