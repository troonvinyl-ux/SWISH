import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { AuthRouter, getSupabaseClient, useAuth } from '@/template';
import { useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '@/hooks/useApp';
import { isSwishMasterAdmin } from '@/contexts/AppContext';
import { NICHE_MODULES, PRODUCTION_NICHES, type NicheConfig } from '@/constants/niches';
import { getProductionNicheSpecialistIds } from '@/services/nicheRouting';

const C = { bg:'#080B10', panel:'#0D131B', line:'#20303D', text:'#E9F0F5', muted:'#7F929F', faint:'#536571', amber:'#F3C66B', cyan:'#72D7E5', green:'#79D6A4' };
type StockRow = { id:string; specialist_id:string|null; status:string|null; expected_selling_price:number|null; valuation_mid:number|null };
type ListingRow = { id:string; item_id:string|null; status:string|null; items?:{specialist_id?:string|null}|null };
type ShopStats = { niche:NicheConfig; stock:number; live:number; drafts:number; potential:number };

function cash(value:number) {
  return new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP',maximumFractionDigits:0}).format(Number.isFinite(value)?value:0);
}

function Storefronts() {
  const { user } = useAuth();
  const { tenant, tenantLoading, isMasterAdmin } = useApp();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const columns = width >= 900 ? 3 : width >= 560 ? 2 : 1;
  const [items,setItems] = useState<StockRow[]>([]);
  const [listings,setListings] = useState<ListingRow[]>([]);
  const [loading,setLoading] = useState(true);
  const [refreshing,setRefreshing] = useState(false);
  const [error,setError] = useState<string|null>(null);

  const load = useCallback(async () => {
    if (!tenant?.id) { setLoading(false); return; }
    const db = getSupabaseClient();
    const [ir,lr] = await Promise.all([
      db.from('items').select('id,specialist_id,status,expected_selling_price,valuation_mid').eq('tenant_id',tenant.id).limit(5000),
      db.from('listings').select('id,item_id,status,items!inner(specialist_id)').eq('tenant_id',tenant.id).eq('marketplace_id','ebay').limit(5000)
    ]);
    setError(ir.error || lr.error ? 'Some shop figures could not be loaded. Refresh to retry.' : null);
    setItems((ir.data??[]) as StockRow[]);
    setListings((lr.data??[]) as unknown as ListingRow[]);
    setLoading(false);
    setRefreshing(false);
  },[tenant?.id]);

  useEffect(()=>{void load();},[load]);
  const refresh = useCallback(()=>{setRefreshing(true);void load();},[load]);

  const shops = useMemo<ShopStats[]>(()=>PRODUCTION_NICHES.map(niche=>{
    const specialistIds = getProductionNicheSpecialistIds(niche.id);
    const stock = items.filter(item=>!!item.specialist_id && specialistIds.includes(item.specialist_id));
    const nicheListings = listings.filter(listing=>!!listing.items?.specialist_id && specialistIds.includes(listing.items.specialist_id));
    const liveRows = nicheListings.filter(listing=>listing.status==='active');
    const draftRows = nicheListings.filter(listing=>listing.status==='draft'||listing.status==='pending');
    const liveItemIds = new Set(liveRows.map(row=>row.item_id).filter(Boolean));
    const eligible = stock.filter(item=>!['sold','archived','deleted'].includes((item.status??'').toLowerCase()));
    const unlisted = eligible.filter(item=>!liveItemIds.has(item.id));
    const potential = unlisted.reduce((sum,item)=>sum+Number(item.expected_selling_price??item.valuation_mid??0),0);
    return {niche,stock:stock.length,live:liveRows.length,drafts:draftRows.length,potential};
  }),[items,listings]);

  const openShop = async (niche:NicheConfig) => {
    const module = (NICHE_MODULES as Record<string,{scheme?:string}>)[niche.id];
    if (!module?.scheme) { Alert.alert('Shop app unavailable',niche.shortName+' does not yet have a registered app link.'); return; }
    try { await Linking.openURL(module.scheme+'://'); }
    catch { Alert.alert(niche.shortName+' is not installed','Install the dedicated '+niche.shortName+' app on this device, then return here.'); }
  };

  if(!isSwishMasterAdmin(user?.email)||!isMasterAdmin) {
    return <View style={[s.screen,s.center]}><MaterialIcons name="lock" size={34} color={C.amber}/><Text style={s.title}>Private owner access</Text><Text style={s.muted}>The SWISH storefront is available only to the master account.</Text></View>;
  }

  return <View style={[s.screen,{paddingTop:Math.max(insets.top,8),paddingBottom:Math.max(insets.bottom,8)}]}>
    <View style={s.header}>
      <Pressable onPress={()=>router.back()} style={s.iconButton} accessibilityRole="button" accessibilityLabel="Back to command centre"><MaterialIcons name="arrow-back" size={20} color={C.text}/></Pressable>
      <View style={s.brandIcon}><MaterialIcons name="storefront" size={23} color={C.amber}/></View>
      <View style={s.heading}><Text style={s.eyebrow}>SWISH / YOUR BUSINESS EMPIRE</Text><Text style={s.title}>MY STOREFRONTS</Text></View>
      <Pressable onPress={refresh} style={s.iconButton} accessibilityRole="button" accessibilityLabel="Refresh shop figures"><MaterialIcons name="refresh" size={20} color={C.text}/></Pressable>
    </View>
    <View style={s.intro}>
      <Text style={s.introEyebrow}>ONE MARKETPLACE. MANY SPECIALIST SHOPS.</Text>
      <Text style={s.introTitle}>Choose a shop to enter</Text>
      <Text style={s.introCopy}>Each shop has its own specialist identity and isolated stock. All shops trade through your shared SWISH commerce engine and connected eBay account.</Text>
    </View>
    {tenantLoading||loading ? <View style={s.loading}><ActivityIndicator color={C.amber} size="large"/><Text style={s.muted}>Connecting to your live shop records…</Text></View>
    : <ScrollView style={s.scroll} contentContainerStyle={s.grid} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={C.amber}/>} showsVerticalScrollIndicator={false}>
      {error?<View style={s.warning}><MaterialIcons name="info-outline" color={C.amber} size={17}/><Text style={s.warningText}>{error}</Text></View>:null}
      <View style={[s.shopGrid,{gap:12}]}>
        {shops.map((shop,index)=><Pressable key={shop.niche.id} onPress={()=>void openShop(shop.niche)} accessibilityRole="button" accessibilityLabel={'Enter '+shop.niche.shortName+' shop'} style={({pressed})=>[s.shopCard,{borderColor:shop.niche.color+'66',minHeight:columns===1?150:188,flexBasis:columns===1?'100%':columns===2?'48%':'31.8%',backgroundColor:'#0B121A'},pressed&&s.pressed]}>
          <View style={[s.shopGlow,{backgroundColor:shop.niche.color+'16'}]}/>
          <View style={s.cardTop}>
            <View style={[s.shopIcon,{borderColor:shop.niche.color+'88',backgroundColor:shop.niche.color+'18'}]}><MaterialIcons name={shop.niche.icon as any} size={25} color={shop.niche.color}/></View>
            <View style={s.shopNumber}><Text style={s.shopNumberText}>{String(index+1).padStart(2,'0')}</Text></View>
            <View style={[s.statusDot,{backgroundColor:shop.live>0?C.green:C.faint}]}/>
          </View>
          <Text style={s.shopName}>{shop.niche.shortName}</Text>
          <Text style={s.tagline} numberOfLines={2}>{shop.niche.tagline}</Text>
          <View style={s.metrics}>
            <View><Text style={s.metricValue}>{shop.stock.toLocaleString('en-GB')}</Text><Text style={s.metricLabel}>STOCK</Text></View>
            <View><Text style={[s.metricValue,{color:C.green}]}>{shop.live.toLocaleString('en-GB')}</Text><Text style={s.metricLabel}>LIVE</Text></View>
            <View><Text style={[s.metricValue,{color:C.amber}]}>{shop.drafts.toLocaleString('en-GB')}</Text><Text style={s.metricLabel}>DRAFTS</Text></View>
            <View style={s.potential}><Text style={[s.metricValue,{color:C.cyan}]}>{cash(shop.potential)}</Text><Text style={s.metricLabel}>UNLISTED POTENTIAL*</Text></View>
          </View>
          <View style={s.enter}><Text style={s.enterText}>ENTER SHOP</Text><MaterialIcons name="arrow-forward" size={17} color={shop.niche.color}/></View>
        </Pressable>)}
      </View>
      <View style={s.footerNote}><MaterialIcons name="hub" size={16} color={C.cyan}/><Text style={s.footerText}>Shared SWISH intelligence · Shared eBay account · Separate niche inventory</Text></View>
      <Text style={s.disclaimer}>*Potential is an estimate based on unlisted inventory valuations, not guaranteed revenue. Figures reflect records visible to your signed-in owner tenant.</Text>
    </ScrollView>}
  </View>;
}

const s=StyleSheet.create({
  screen:{flex:1,backgroundColor:C.bg},center:{alignItems:'center',justifyContent:'center',padding:28,gap:12},
  header:{flexDirection:'row',alignItems:'center',gap:10,paddingHorizontal:15,paddingVertical:10,borderBottomWidth:1,borderBottomColor:C.line},
  iconButton:{width:36,height:36,alignItems:'center',justifyContent:'center',borderRadius:10,borderWidth:1,borderColor:C.line,backgroundColor:C.panel},
  brandIcon:{width:38,height:38,alignItems:'center',justifyContent:'center',borderRadius:11,borderWidth:1,borderColor:C.amber+'77',backgroundColor:'#17202A'},
  heading:{flex:1,gap:3},eyebrow:{color:C.cyan,fontSize:8,fontWeight:'800',letterSpacing:1.7},title:{color:C.text,fontSize:17,fontWeight:'900',letterSpacing:1.2},
  intro:{paddingHorizontal:17,paddingTop:18,paddingBottom:14,gap:6},introEyebrow:{color:C.amber,fontSize:8,fontWeight:'900',letterSpacing:1.5},
  introTitle:{color:C.text,fontSize:23,fontWeight:'800',letterSpacing:-0.4},introCopy:{color:C.muted,fontSize:11,lineHeight:17,maxWidth:680},
  scroll:{flex:1},grid:{padding:13,paddingBottom:24,gap:12},shopGrid:{flexDirection:'row',flexWrap:'wrap',justifyContent:'flex-start'},
  shopCard:{position:'relative',overflow:'hidden',borderWidth:1,borderRadius:15,padding:13,gap:6},
  shopGlow:{position:'absolute',top:-52,right:-42,width:150,height:150,borderRadius:80},
  cardTop:{flexDirection:'row',alignItems:'center',gap:8},shopIcon:{width:43,height:43,borderRadius:12,borderWidth:1,alignItems:'center',justifyContent:'center'},
  shopNumber:{flex:1},shopNumberText:{color:C.faint,fontSize:9,fontWeight:'900',letterSpacing:1.2},statusDot:{width:7,height:7,borderRadius:4},
  shopName:{color:C.text,fontSize:18,fontWeight:'900',letterSpacing:0.3},tagline:{color:C.muted,fontSize:10,minHeight:25,lineHeight:14},
  metrics:{flexDirection:'row',flexWrap:'wrap',gap:11,paddingTop:7,borderTopWidth:1,borderTopColor:'#1B2A35'},
  metricValue:{color:C.text,fontSize:13,fontWeight:'800'},metricLabel:{color:C.faint,fontSize:7,fontWeight:'800',letterSpacing:0.7,marginTop:2},
  potential:{marginLeft:'auto',alignItems:'flex-end'},enter:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingTop:7,borderTopWidth:1,borderTopColor:'#1B2A35'},
  enterText:{color:C.text,fontSize:8,fontWeight:'900',letterSpacing:1.2},pressed:{opacity:0.82,transform:[{scale:0.99}]},
  footerNote:{flexDirection:'row',alignItems:'center',gap:8,padding:12,borderRadius:10,borderWidth:1,borderColor:'#24404A',backgroundColor:'#0C1820'},
  footerText:{color:C.cyan,fontSize:9,fontWeight:'700',flex:1},disclaimer:{color:C.faint,fontSize:8,lineHeight:13},
  loading:{flex:1,alignItems:'center',justifyContent:'center',gap:12},muted:{color:C.muted,fontSize:12,lineHeight:18,textAlign:'center'},
  warning:{flexDirection:'row',gap:8,alignItems:'center',padding:10,borderRadius:9,borderWidth:1,borderColor:'#6A552C',backgroundColor:'#201A10'},warningText:{color:C.amber,fontSize:10,flex:1},
});

export default function StorefrontsRoute() {
  return <AuthRouter loginRoute="/login" excludeRoutes={[]}><Storefronts/></AuthRouter>;
}
