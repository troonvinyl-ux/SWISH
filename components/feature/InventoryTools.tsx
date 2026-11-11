import { FlatList, View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useInventoryTools } from '@/hooks/useInventoryTools';
import { useApp } from '@/hooks/useApp';
import { InventoryAccountScope } from './InventoryAccountScope';
import BulkReIdentifyModal from './BulkReIdentifyModal';
import BulkReValueSheet from './BulkReValueSheet';
import { Colors, Spacing, Radius, Typography } from '@/constants/theme';
interface InventoryToolsProps {}
export function InventoryTools(_props: InventoryToolsProps) {
 const tools = useInventoryTools(); const router = useRouter(); const { activeNiche } = useApp();
 const { inventory, items } = tools;
 return <SafeAreaView edges={['bottom']} style={s.screen}>
  <StatusBar style="light" />
  <FlatList data={tools.mode === 'all' ? items : []} keyExtractor={item => item.id} showsVerticalScrollIndicator={false} refreshing={inventory.refreshing} onRefresh={inventory.refresh} contentContainerStyle={s.content} initialNumToRender={8} maxToRenderPerBatch={8} windowSize={5}
   ListHeaderComponent={<View style={s.block}>
    <Text style={[s.title, { color: activeNiche.color }]}>{activeNiche.shortName} inventory tools</Text>
    <Text style={s.body}>The same saved inventory. Advanced actions live here so daily stock and listing work stays focused.</Text>
    <InventoryAccountScope total={inventory.totalCount} verified={inventory.hasSnapshot && !inventory.loading} error={inventory.error} />
    <View style={s.segments}>
     {(['stock', 'draft', 'all'] as const).map(mode => <Pressable key={mode} accessibilityRole="tab" accessibilityState={{ selected: tools.mode === mode }} disabled={tools.running} onPress={() => tools.setMode(mode)} style={({pressed}) => [s.segment, tools.mode === mode ? { borderColor: activeNiche.color } : null, pressed ? s.pressed : null]}><Text style={[s.label, tools.mode === mode ? { color: activeNiche.color } : null]}>{mode === 'all' ? 'All records' : mode === 'stock' ? 'Stock' : 'Drafts'}</Text></Pressable>)}
    </View>
    <Text style={s.body}>{inventory.loading ? 'Verifying saved records…' : inventory.hasSnapshot ? `${items.length} ${tools.mode === 'all' ? 'records, including sold and archived' : tools.mode + ' items'}` : 'Inventory is not yet verified.'}</Text>
    {tools.mode !== 'all' ? <View style={s.block}>
     {tools.mode === 'stock' ? <>
      <Pressable accessibilityRole="button" accessibilityLabel="Bulk revalue stock" disabled={!tools.actionable || !items.length} onPress={() => tools.openModal('value')} style={({pressed}) => [s.card, pressed ? s.pressed : null, !tools.actionable || !items.length ? s.disabled : null]}><MaterialIcons name="travel-explore" size={24} color={activeNiche.color}/><View style={s.copy}><Text style={s.label}>Bulk revalue</Text><Text style={s.body}>Review pricing for this niche's saved stock.</Text></View></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Bulk reidentify stock" disabled={!tools.actionable || !items.length} onPress={() => tools.openModal('identify')} style={({pressed}) => [s.card, pressed ? s.pressed : null, !tools.actionable || !items.length ? s.disabled : null]}><MaterialIcons name="auto-awesome" size={24} color={activeNiche.color}/><View style={s.copy}><Text style={s.label}>Bulk reidentify</Text><Text style={s.body}>Use existing photos; listed and sold items are excluded.</Text></View></Pressable>
     </> : null}
     <Pressable accessibilityRole="button" disabled={!tools.actionable || !items.length} onPress={tools.publish} style={({pressed}) => [s.card, { borderColor: activeNiche.color }, pressed ? s.pressed : null, !tools.actionable || !items.length ? s.disabled : null]}>{tools.running ? <ActivityIndicator color={activeNiche.color}/> : <MaterialIcons name="playlist-add-check" size={24} color={activeNiche.color}/>}<View style={s.copy}><Text style={s.label}>{tools.running ? 'Publishing…' : tools.mode === 'stock' ? 'List stock on eBay' : 'Publish saved drafts'}</Text><Text style={s.body}>Confirmation required. Each marketplace result is checked.</Text></View></Pressable>
    </View> : <Text style={s.body}>Open any original record, including archived items. No inventory is copied or reclassified.</Text>}
    <Pressable accessibilityRole="button" disabled={!tools.actionable || inventory.syncing} onPress={() => void inventory.syncSold()} style={({pressed}) => [s.card, pressed ? s.pressed : null, !tools.actionable || inventory.syncing ? s.disabled : null]}><MaterialIcons name="sync" size={24} color={activeNiche.color}/><View style={s.copy}><Text style={s.label}>{inventory.syncing ? 'Syncing orders…' : 'Sync sold orders'}</Text><Text style={s.body}>Read orders from the connected eBay account for this niche.</Text></View></Pressable>
    <Text style={s.body}>{inventory.hasSnapshot ? `${inventory.liveListingCount} unique live eBay listings · ${inventory.unitCount} recorded units. Status metrics are not added to inventory.` : 'Canonical totals are awaiting verification.'}</Text>
    <Text style={s.body}>End a live listing on eBay first. The saved item and photos remain in stock; deleting inventory requires a separate confirmation.</Text>
    {inventory.error ? <Pressable accessibilityRole="button" onPress={() => void inventory.refresh()} disabled={inventory.loading} style={({pressed}) => [s.card, pressed ? s.pressed : null]}><MaterialIcons name="error-outline" size={24} color={Colors.warning}/><View style={s.copy}><Text accessibilityRole="alert" style={s.body}>{inventory.error}</Text><Text style={s.label}>Retry inventory refresh</Text></View></Pressable> : null}
   </View>}
   renderItem={({item}) => <Pressable accessibilityRole="button" onPress={() => router.push(`/stock-listing/${item.id}` as any)} style={({pressed}) => [s.card, pressed ? s.pressed : null]}><MaterialIcons name={activeNiche.icon as any} size={24} color={activeNiche.color}/><View style={s.copy}><Text style={s.label} numberOfLines={2}>{item.canonical_title}</Text><Text style={s.body}>{item.inventoryId ? `${item.inventoryId} · ` : ''}{item.inventoryTab ?? item.status}</Text></View><MaterialIcons name="chevron-right" size={24} color={activeNiche.color}/></Pressable>}
  />
  {tools.modal === 'identify' && inventory.ready ? <BulkReIdentifyModal key={inventory.scope} visible items={items} tenantId={tools.tenantId} progress={tools.progress} onProgress={tools.setProgress} onClose={tools.closeModal}/> : null}
  {tools.modal === 'value' && inventory.ready ? <BulkReValueSheet key={inventory.scope} visible items={items} tenantId={tools.tenantId} autonomousMode={tools.autonomousMode} onClose={tools.closeModal}/> : null}
 </SafeAreaView>;
}
const s = StyleSheet.create({
 screen: { flex: 1, backgroundColor: Colors.background }, content: { padding: Spacing.base, gap: Spacing.md, width: '100%', maxWidth: 960, alignSelf: 'center' }, block: { gap: Spacing.base }, copy: { flex: 1, gap: Spacing.xs },
 title: { color: Colors.textPrimary, fontSize: Typography.size.lg, fontWeight: Typography.weight.bold, includeFontPadding: false }, body: { color: Colors.textSecondary, fontSize: Typography.size.base, lineHeight: Typography.size.base * Typography.lineHeight.relaxed, includeFontPadding: false }, label: { color: Colors.textPrimary, fontSize: Typography.size.base, fontWeight: Typography.weight.semibold, includeFontPadding: false },
 card: { minHeight: 64, padding: Spacing.base, flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.surfaceBorder, borderRadius: Radius.lg }, segments: { flexDirection: 'row', gap: Spacing.sm }, segment: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.surfaceBorder, backgroundColor: Colors.surface }, pressed: { opacity: 0.7 }, disabled: { opacity: 0.5 },
});
