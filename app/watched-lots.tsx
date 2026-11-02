import { useCallback, useRef } from 'react';
import { View,Text,Pressable,FlatList,ActivityIndicator,StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter,useFocusEffect } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useWatchedLots } from '@/hooks/useWatchedLots';
import { useArtworkLayout } from '@/hooks/useArtworkLayout';
import { useManifestOpportunity } from '@/hooks/useManifestOpportunity';
import { useApp } from '@/hooks/useApp';
import { useAuctionLink } from '@/hooks/useAuctionLink';
import { useAlert } from '@/template';
import { WatchedLotCard } from '@/components/feature/WatchedLotCard';
import type { WatchedLot } from '@/services/watchedLotService';
import { Colors,Spacing,Radius,Typography } from '@/constants/theme';

export default function WatchedLotsScreen() {
  const watched=useWatchedLots();const workflow=useManifestOpportunity();const {activeNiche}=useApp();
  const columns=Math.min(2,useArtworkLayout().columns);
  const router=useRouter();const {showAlert}=useAlert();const auction=useAuctionLink();
  const focused=useRef(false);
  useFocusEffect(useCallback(()=>{focused.current=true;void watched.refresh();return ()=>{focused.current=false;};},[watched.refresh]));
  const open=useCallback((lot:WatchedLot)=>{
    const apply=async()=>{if(await workflow.openWatch(lot.id) && focused.current)router.push('/lot-opportunity' as any);};
    if(workflow.draft.lines.length) showAlert('Open this watched plan?','This replaces the list currently on your screen. Watch your current lot first if you want to keep changes.',[
      {text:'Keep current list',style:'cancel'},{text:'Open watched plan',onPress:()=>{void apply();}},
    ]);else void apply();
  },[workflow,router,showAlert]);
  const remove=useCallback((lot:WatchedLot)=>showAlert('Remove this watched lot?','This only removes it from your shortlist. Purchased stock and listings are never changed.',[
    {text:'Keep watching',style:'cancel'},{text:'Remove',style:'destructive',onPress:()=>{void watched.removeWatch(lot.id);}},
  ]),[showAlert,watched.removeWatch]);
  return <SafeAreaView edges={['bottom']} style={s.screen}><StatusBar style="light"/>
    <FlatList key={`watched-${columns}`} numColumns={columns} columnWrapperStyle={columns>1?s.columns:undefined} style={s.screen} data={watched.rows} keyExtractor={lot=>lot.id} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}
      initialNumToRender={6} windowSize={5} refreshing={watched.loading && watched.rows.length>0} onRefresh={()=>{void watched.refresh();}}
      ListHeaderComponent={<View style={s.block}>
        <LinearGradient colors={[Colors.primaryDim,Colors.surface]} style={s.hero}><View style={s.row}><MaterialIcons name="bookmarks" size={28} color={Colors.primary}/><Text style={s.eyebrow}>{activeNiche.shortName.toUpperCase()} · WATCHED LOTS</Text></View><Text style={s.title}>Keep the good ones.</Text><Text style={s.body}>Your manifests and base maximums, ready when you return.</Text><View style={s.tag}><Text style={s.tagText}>{watched.rows.length}{watched.hasMore?'+':''} watched · not purchased</Text></View></LinearGradient>
        <Text style={s.note}>Saved privately to your signed-in account in this niche. Nothing goes into stock or onto eBay.</Text>
        {watched.error?<View style={s.error}><MaterialIcons name="error-outline" size={24} color={Colors.danger}/><Text accessibilityRole="alert" style={[s.body,s.flex]}>{watched.error}</Text><Pressable accessibilityRole="button" onPress={()=>{void watched.refresh();}} disabled={watched.busy} style={({pressed})=>[s.retry,pressed?s.pressed:null]}><Text style={s.link}>Retry</Text></Pressable></View>:null}
        {watched.busy?<View style={s.row}><ActivityIndicator color={Colors.primary}/><Text accessibilityLiveRegion="polite" style={s.note}>Updating your watched lots…</Text></View>:null}
      </View>}
      ListEmptyComponent={watched.loading?<ActivityIndicator color={Colors.primary} style={s.empty}/>:<View style={s.empty}><View style={s.emptyIcon}><MaterialIcons name="bookmark-border" size={36} color={Colors.primary}/></View><Text style={s.section}>{watched.ready?'A shortlist worth keeping.':'Sign in to keep your lots.'}</Text><Text style={[s.note,s.center]}>{watched.ready?'Add a manifest, then tap “Watch this lot”. Your saved list and buying ceiling will survive closing the app.':'Your watched lots are private. Sign in and wait for your niche to load.'}</Text><Pressable accessibilityRole="button" disabled={watched.busy} onPress={()=>router.push((watched.ready?'/lot-opportunity':'/login') as any)} style={({pressed})=>[s.primary,pressed?s.pressed:null]}><Text style={s.primaryText}>{watched.ready?'Find my next lot':'Sign in'}</Text></Pressable></View>}
      renderItem={({item})=><View style={s.tile}><WatchedLotCard lot={item} busy={watched.busy||workflow.busy||auction.opening} onOpen={()=>open(item)} onRemove={()=>remove(item)} onOpenAuction={()=>{void auction.openAuction(item.auction_url);}}/></View>}
      ListFooterComponent={watched.rows.length?<View style={s.block}>{watched.hasMore?<Pressable accessibilityRole="button" disabled={watched.loading||watched.busy} onPress={()=>{void watched.loadMore();}} style={({pressed})=>[s.secondary,(pressed||watched.loading)?s.pressed:null]}><Text style={s.link}>{watched.loading?'Loading more…':'Show more watched lots'}</Text></Pressable>:null}<Text style={s.note}>A saved ceiling is a guide, not guaranteed profit. Recheck the current bid, delivery and auction end before bidding.</Text></View>:null}
    />
  </SafeAreaView>;
}
const s=StyleSheet.create({
  columns:{gap:Spacing.base,alignItems:'flex-start'},tile:{flex:1,minWidth:1},screen:{flex:1,backgroundColor:Colors.background},content:{padding:Spacing.base,paddingBottom:Spacing.xxl,gap:Spacing.base,width:'100%',maxWidth:960,alignSelf:'center'},block:{gap:Spacing.base},flex:{flex:1},row:{flexDirection:'row',gap:Spacing.md,alignItems:'center',flexWrap:'wrap'},hero:{padding:Spacing.xl,gap:Spacing.base,borderRadius:Radius.xxl,borderWidth:1,borderColor:Colors.primaryDim},eyebrow:{fontSize:Typography.size.sm,color:Colors.primary,fontWeight:Typography.weight.semibold,letterSpacing:1},title:{fontSize:Typography.size.xxxl,fontWeight:Typography.weight.bold,lineHeight:44,color:Colors.textPrimary,includeFontPadding:false},section:{fontSize:Typography.size.lg,fontWeight:Typography.weight.semibold,color:Colors.textPrimary},body:{fontSize:Typography.size.base,lineHeight:26,color:Colors.textPrimary,includeFontPadding:false},note:{fontSize:Typography.size.base,lineHeight:26,color:Colors.textSecondary,includeFontPadding:false},tag:{alignSelf:'flex-start',padding:Spacing.sm,borderRadius:Radius.pill,backgroundColor:Colors.primaryDim},tagText:{fontSize:Typography.size.base,color:Colors.primary,fontWeight:Typography.weight.medium},
  error:{flexDirection:'row',gap:Spacing.md,alignItems:'center',padding:Spacing.base,borderRadius:Radius.lg,backgroundColor:Colors.dangerDim},retry:{minWidth:48,minHeight:48,justifyContent:'center',alignItems:'center'},link:{fontSize:Typography.size.base,color:Colors.primary,fontWeight:Typography.weight.semibold},empty:{padding:Spacing.xl,gap:Spacing.base,alignItems:'center',backgroundColor:Colors.surface,borderRadius:Radius.xxl},emptyIcon:{width:72,height:72,backgroundColor:Colors.primaryDim,borderRadius:Radius.xl,alignItems:'center',justifyContent:'center'},center:{textAlign:'center'},primary:{minHeight:52,padding:Spacing.base,borderRadius:Radius.lg,alignSelf:'stretch',alignItems:'center',justifyContent:'center',backgroundColor:Colors.primary},primaryText:{fontSize:Typography.size.base,fontWeight:Typography.weight.semibold,color:Colors.textInverse},secondary:{minHeight:48,padding:Spacing.base,borderRadius:Radius.lg,backgroundColor:Colors.surface,alignItems:'center',justifyContent:'center'},pressed:{opacity:0.65},
});
