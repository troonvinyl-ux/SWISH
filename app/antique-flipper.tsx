import React from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useApp } from '@/hooks/useApp';
import { useInventory } from '@/hooks/useInventory';
import { Spacing, Typography, Radius } from '@/constants/theme';
import { BrandArtwork } from '@/components/feature/BrandArtwork';

const GOLD = '#D8AD52';
const ACTIONS = [
  { icon: 'photo-camera', title: 'Scan & Identify', subtitle: 'Identify an antique with photographs', route: '/capture', primary: true },
  { icon: 'inventory-2', title: 'My Inventory', subtitle: 'Stock, drafts, live and sold', route: '/(tabs)/inventory' },
  { icon: 'sell', title: 'Create eBay Listing', subtitle: 'Prepare a category-specific listing', route: '/(tabs)/inventory' },
  { icon: 'query-stats', title: 'Market Value', subtitle: 'Review valuation evidence', route: '/(tabs)/inventory' },
  { icon: 'handyman', title: 'Restoration Tips', subtitle: 'Conservation-aware guidance', route: '/antique-restoration' },
  { icon: 'menu-book', title: 'Antique Guides', subtitle: 'Periods, materials and maker marks', route: '/antique-guides' },
];

export default function AntiqueFlipperHome() {
  const router = useRouter();
  const { tenant } = useApp();
  const inventory = useInventory();
  const openAction = (route: string) => router.push(route as any);
  const openItem = (id: string) => router.push(`/stock-listing/${id}` as any);

  return <SafeAreaView edges={['top']} style={s.screen}>
    <StatusBar style="light" />
    <ScrollView contentContainerStyle={s.content} refreshControl={<RefreshControl refreshing={inventory.loading} onRefresh={inventory.reload} tintColor={GOLD} />}>
      <View style={s.brandRow}>
        <View style={s.brandCopy}>
          <Text style={s.eyebrow}>SWISH SPECIALIST EDITION</Text>
          <Text style={s.brand}>ANTIQUE FLIPPER</Text>
          <Text style={s.tagline}>Antiques · Vintage · Collectables</Text>
          <Text style={s.motto}>IDENTIFY · VALUE · RESTORE · SELL</Text>
        </View>
        <MaterialIcons name="account-balance" size={36} color={GOLD} />
      </View>
      <View style={s.artwork}><BrandArtwork nicheId="antiques" /></View>
      <View style={s.stats}>
        <View style={s.stat}><Text style={s.statValue}>{inventory.stats.grandTotal}</Text><Text style={s.statLabel}>IN INVENTORY</Text></View>
        <View style={s.stat}><Text style={s.statValue}>{inventory.stats.draftCount}</Text><Text style={s.statLabel}>DRAFTS</Text></View>
        <View style={s.stat}><Text style={s.statValue}>{inventory.stats.liveCount}</Text><Text style={s.statLabel}>LIVE</Text></View>
        <View style={s.stat}><Text style={s.statValue}>{inventory.stats.soldCount}</Text><Text style={s.statLabel}>SOLD</Text></View>
      </View>
      {inventory.syncError ? <Text style={s.error}>Inventory could not refresh: {inventory.syncError}</Text> : null}
      <Text style={s.section}>YOUR ANTIQUE WORKSPACE</Text>
      <View style={s.actions}>
        {ACTIONS.map((action, index) => <Pressable key={action.title} onPress={() => openAction(action.route)} style={({ pressed }) => [s.action, action.primary && s.primaryAction, pressed && s.pressed]}>
          <View style={[s.actionIcon, action.primary && s.primaryIcon]}><MaterialIcons name={action.icon as any} size={23} color={action.primary ? '#17120A' : GOLD} /></View>
          <View style={s.actionCopy}><Text style={[s.actionTitle, action.primary && s.primaryTitle]}>{action.title}</Text><Text style={[s.actionSubtitle, action.primary && s.primarySubtitle]}>{action.subtitle}</Text></View>
          <MaterialIcons name="chevron-right" size={23} color={action.primary ? '#17120A' : GOLD} />
        </Pressable>)}
      </View>
      <View style={s.inventoryHeading}><Text style={s.section}>RECENT FINDS</Text><Pressable onPress={() => openAction('/(tabs)/inventory')}><Text style={s.viewAll}>VIEW ALL</Text></Pressable></View>
      {inventory.items.slice(0,5).map(item => <Pressable key={item.id} onPress={() => openItem(item.id)} style={s.itemCard}>
        <View style={s.itemIcon}><MaterialIcons name="museum" size={22} color={GOLD}/></View>
        <View style={s.actionCopy}><Text style={s.itemTitle} numberOfLines={1}>{item.canonicalTitle}</Text><Text style={s.actionSubtitle}>{item.condition || 'Condition not assessed'} · {item.status}</Text></View>
        <Text style={s.itemPrice}>{item.expectedSellingPrice ? `£${Number(item.expectedSellingPrice).toFixed(0)}` : '—'}</Text>
      </Pressable>)}
      {!inventory.loading && inventory.items.length===0 ? <View style={s.empty}><Text style={s.emptyTitle}>Your next discovery starts here</Text><Text style={s.actionSubtitle}>Scan an object to identify it, assess its condition and save it to your Antique Flipper inventory.</Text><Pressable onPress={() => openAction('/capture')} style={s.goldButton}><Text style={s.goldButtonText}>SCAN AN ANTIQUE  →</Text></Pressable></View> : null}
      <Text style={s.footer}>Powered by SWISH Intelligence Engine · {tenant?.name ?? 'Private workspace'}</Text>
    </ScrollView>
  </SafeAreaView>;
}
const s=StyleSheet.create({
  screen:{flex:1,backgroundColor:'#090806'},content:{padding:Spacing.base,paddingBottom:40,gap:Spacing.md},
  brandRow:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingTop:Spacing.sm},
  brandCopy:{flex:1,gap:3},eyebrow:{fontSize:9,color:GOLD,fontWeight:'800',letterSpacing:1.8},
  brand:{fontSize:27,color:'#F4D58A',fontWeight:'900',letterSpacing:0.5},tagline:{fontSize:12,color:'#E5DCC9'},motto:{fontSize:9,color:GOLD,letterSpacing:1.2,fontWeight:'800'},
  artwork:{height:125,borderRadius:Radius.lg,overflow:'hidden',borderWidth:1,borderColor:'#80632C'},
  stats:{flexDirection:'row',backgroundColor:'#17130D',borderRadius:Radius.lg,borderWidth:1,borderColor:'#5E4926',paddingVertical:Spacing.md},
  stat:{flex:1,alignItems:'center',gap:3},statValue:{fontSize:21,color:'#F4D58A',fontWeight:'900',fontVariant:['tabular-nums']},statLabel:{fontSize:8,color:'#B9A77F',fontWeight:'800',letterSpacing:0.7},
  section:{fontSize:10,color:GOLD,fontWeight:'900',letterSpacing:1.4,marginTop:Spacing.sm},actions:{gap:Spacing.sm},
  action:{flexDirection:'row',alignItems:'center',gap:Spacing.md,padding:Spacing.md,borderRadius:Radius.lg,backgroundColor:'#15120D',borderWidth:1,borderColor:'#554322',minHeight:70},
  primaryAction:{backgroundColor:'#E7B94D',borderColor:'#F4D58A'},actionIcon:{width:42,height:42,borderRadius:Radius.md,backgroundColor:'#302514',alignItems:'center',justifyContent:'center'},
  primaryIcon:{backgroundColor:'#F6D98E'},actionCopy:{flex:1,gap:3},actionTitle:{fontSize:Typography.size.sm,color:'#F5EAD2',fontWeight:'800'},primaryTitle:{color:'#191307'},
  actionSubtitle:{fontSize:Typography.size.xs,color:'#B9B09F',lineHeight:17},primarySubtitle:{color:'#483817'},pressed:{opacity:0.76,transform:[{scale:0.99}]},
  inventoryHeading:{flexDirection:'row',alignItems:'center',justifyContent:'space-between'},viewAll:{fontSize:9,color:GOLD,fontWeight:'900',letterSpacing:1},
  itemCard:{flexDirection:'row',alignItems:'center',gap:Spacing.md,padding:Spacing.md,borderRadius:Radius.md,backgroundColor:'#14110D',borderWidth:1,borderColor:'#3F3422'},
  itemIcon:{width:40,height:40,borderRadius:Radius.md,backgroundColor:'#2C2314',alignItems:'center',justifyContent:'center'},itemTitle:{fontSize:Typography.size.sm,color:'#F4E9D4',fontWeight:'700'},itemPrice:{fontSize:Typography.size.sm,color:GOLD,fontWeight:'900'},
  empty:{padding:Spacing.lg,gap:Spacing.md,borderRadius:Radius.lg,backgroundColor:'#15120D',borderWidth:1,borderColor:'#5E4926'},emptyTitle:{fontSize:18,color:'#F4D58A',fontWeight:'800'},
  goldButton:{backgroundColor:'#E7B94D',borderRadius:Radius.md,padding:Spacing.md,alignItems:'center'},goldButtonText:{fontSize:11,color:'#17120A',fontWeight:'900',letterSpacing:1},
  error:{color:'#FCA5A5',fontSize:12},footer:{fontSize:9,color:'#85795F',textAlign:'center',marginTop:Spacing.md}
});