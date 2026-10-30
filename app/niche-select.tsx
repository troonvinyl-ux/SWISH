import { memo } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors, Typography, Spacing, Radius, Shadow } from '@/constants/theme';
import { useApp } from '@/hooks/useApp';
import { useArtworkLayout } from '@/hooks/useArtworkLayout';
import { PRODUCTION_NICHES, type NicheId, type NicheConfig } from '@/constants/niches';
import { nicheToEntryRoute } from '@/services/nicheRouting';
import { getBrandArtwork, BRAND_NAMES, TOOL_ARTWORK } from '@/constants/brandArtwork';
interface NicheCardProps {niche:NicheConfig;active:boolean;saved:boolean;onOpen:()=>void;onSave:()=>void}
const NicheCard=memo(function NicheCard({niche,active,saved,onOpen,onSave}:NicheCardProps){
  const source=getBrandArtwork(niche.id);const name=BRAND_NAMES[niche.id]??niche.name;
  return <View style={[s.card,active?s.activeCard:null]}>
    <Pressable accessibilityRole="button" accessibilityLabel={`Enter ${name}`} onPress={onOpen} style={({pressed})=>[s.entry,pressed?s.pressed:null]}>
      <View style={s.artFrame}>{source?<Image source={source} contentFit="cover" transition={200} style={s.art} accessible={false}/>:<LinearGradient colors={[Colors.primaryDim,Colors.surface]} style={s.surplusArt}><MaterialIcons name="inventory-2" size={72} color={Colors.primary}/><Text style={s.surplusTitle}>SURPLUS\nFLIP</Text></LinearGradient>}
        {source?<LinearGradient colors={[Colors.overlay20,Colors.overlay80]} style={s.shade} pointerEvents="none"/>:null}
        <View style={s.nameBlock}><Text style={s.name}>{name}</Text>{active?<Text style={s.current}>CURRENTLY USING</Text>:null}</View>
      </View>
      <View style={s.nativeButton}><Text style={s.buttonText}>Enter {niche.shortName}</Text><MaterialIcons name="arrow-forward" size={22} color={Colors.textInverse}/></View>
    </Pressable>
    <View style={s.cardFooter}><Text style={[s.tagline,s.flex]}>{niche.tagline}</Text><Pressable accessibilityRole="button" accessibilityLabel={`${saved?'Remove':'Save'} ${name} ${saved?'from':'to'} my choices`} accessibilityState={{selected:saved}} onPress={onSave} style={({pressed})=>[s.bookmark,pressed?s.pressed:null]}><MaterialIcons name={saved?'bookmark':'bookmark-border'} size={24} color={saved?Colors.primary:Colors.textSecondary}/></Pressable></View>
  </View>;
});
export default function NicheSelectScreen(){
  const router=useRouter();const {columns}=useArtworkLayout();
  const {activeNicheId,fixedNicheId,enabledNiches,setActiveNiche,enableNiche,disableNiche,isMasterAdmin}=useApp();
  if(fixedNicheId&&!isMasterAdmin){const route=nicheToEntryRoute(fixedNicheId);if(route)return <Redirect href={route as any}/>;}
  const toggle=(id:NicheId)=>{if(enabledNiches.includes(id)){if(enabledNiches.length>1)disableNiche(id);}else enableNiche(id);};
  return <SafeAreaView edges={['top','bottom']} style={s.screen}><StatusBar style="light"/>
    <View style={s.header}><Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={()=>router.canGoBack()?router.back():router.replace('/(tabs)')} style={({pressed})=>[s.iconButton,pressed?s.pressed:null]}><MaterialIcons name="arrow-back" size={24} color={Colors.textPrimary}/></Pressable><Text style={s.logo}>SWISH<Text style={s.logoDot}> / </Text>FLIP</Text>{isMasterAdmin?<Pressable accessibilityRole="button" accessibilityLabel="Open account management" onPress={()=>router.push('/master-admin' as any)} style={({pressed})=>[s.iconButton,pressed?s.pressed:null]}><MaterialIcons name="admin-panel-settings" size={24} color={Colors.primary}/></Pressable>:<View style={s.iconButton}/>}</View>
    <FlatList key={columns} numColumns={columns} data={PRODUCTION_NICHES} keyExtractor={niche=>niche.id} showsVerticalScrollIndicator={false} contentContainerStyle={s.content} columnWrapperStyle={columns>1?s.columns:undefined}
      ListHeaderComponent={<View style={s.intro}><View style={s.pill}><MaterialIcons name="auto-awesome" size={18} color={Colors.primary}/><Text style={s.eyebrow}>FIND YOUR NEXT FLIP</Text></View><Text style={s.title}>What do you\nlove flipping?</Text><Text style={s.body}>Pick your world. Find the value.\nTurn a good find into your next sale.</Text><Text style={s.note}>One account. Your stock stays in the right place.</Text></View>}
      renderItem={({item:niche})=><View style={s.cell}><NicheCard niche={niche} active={activeNicheId===niche.id} saved={enabledNiches.includes(niche.id)} onSave={()=>toggle(niche.id)} onOpen={()=>{setActiveNiche(niche.id);router.replace('/(tabs)');}}/></View>}
      ListFooterComponent={<View style={s.footer}><View style={s.preview}><Image source={TOOL_ARTWORK} transition={200} contentFit="cover" style={s.previewImage}/><View style={s.flex}><Text style={s.section}>Tool Flipper</Text><Text style={s.note}>A look at what could come next.</Text><Text style={s.previewLabel}>DESIGN PREVIEW · NOT AVAILABLE YET</Text></View></View><View style={s.trust}><MaterialIcons name="shield" size={22} color={Colors.primary}/><Text style={[s.note,s.flex]}>Choose what suits you. Your account access still applies.</Text></View></View>}
    />
  </SafeAreaView>;
}
const s=StyleSheet.create({
  screen:{flex:1,backgroundColor:Colors.background},header:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:Spacing.md,paddingHorizontal:Spacing.base,paddingVertical:Spacing.sm,borderBottomWidth:1,borderBottomColor:Colors.surfaceBorder},iconButton:{width:48,height:48,alignItems:'center',justifyContent:'center',borderRadius:Radius.md},logo:{fontSize:Typography.size.md,fontWeight:Typography.weight.bold,color:Colors.textPrimary,letterSpacing:2},logoDot:{color:Colors.primary},content:{padding:Spacing.base,maxWidth:960,width:'100%',alignSelf:'center',paddingBottom:Spacing.xxl,gap:Spacing.base},intro:{gap:Spacing.md,paddingTop:Spacing.lg,paddingBottom:Spacing.xl},pill:{flexDirection:'row',gap:Spacing.sm,alignItems:'center'},eyebrow:{color:Colors.primary,fontSize:Typography.size.sm,fontWeight:Typography.weight.semibold,letterSpacing:1},title:{fontSize:Typography.size.xxxl,lineHeight:44,fontWeight:Typography.weight.bold,color:Colors.textPrimary},body:{fontSize:Typography.size.base,lineHeight:26,color:Colors.textPrimary},note:{fontSize:Typography.size.base,lineHeight:26,color:Colors.textSecondary},columns:{gap:Spacing.base},cell:{flex:1,maxWidth:'100%'},card:{backgroundColor:Colors.surface,borderWidth:1,borderColor:Colors.surfaceBorder,borderRadius:Radius.xxl,overflow:'hidden',...Shadow.md},activeCard:{borderColor:Colors.primary},entry:{overflow:'hidden'},artFrame:{width:'100%',aspectRatio:1.6,overflow:'hidden',backgroundColor:Colors.surface},art:{position:'absolute',width:'100%',aspectRatio:1.06,left:0,top:0},shade:{...StyleSheet.absoluteFillObject},nameBlock:{position:'absolute',left:Spacing.base,right:Spacing.base,bottom:Spacing.base,gap:Spacing.xs},name:{fontSize:Typography.size.xl,fontWeight:Typography.weight.bold,color:Colors.textPrimary},current:{fontSize:Typography.size.sm,color:Colors.primary,fontWeight:Typography.weight.semibold,letterSpacing:0.8},nativeButton:{minHeight:52,margin:Spacing.md,marginTop:Spacing.sm,padding:Spacing.md,backgroundColor:Colors.primary,borderRadius:Radius.pill,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:Spacing.md},buttonText:{fontSize:Typography.size.base,fontWeight:Typography.weight.semibold,color:Colors.textInverse},cardFooter:{flexDirection:'row',alignItems:'center',gap:Spacing.md,padding:Spacing.base,paddingTop:Spacing.xs},flex:{flex:1},tagline:{fontSize:Typography.size.base,lineHeight:24,color:Colors.textSecondary},bookmark:{width:48,height:48,alignItems:'center',justifyContent:'center',borderRadius:Radius.md,backgroundColor:Colors.surfaceHighlight},surplusArt:{...StyleSheet.absoluteFillObject,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:Spacing.md,padding:Spacing.base},surplusTitle:{fontSize:Typography.size.xxl,fontWeight:Typography.weight.bold,color:Colors.primary},pressed:{opacity:0.75,transform:[{scale:0.99}]},footer:{gap:Spacing.lg,paddingTop:Spacing.md},preview:{padding:Spacing.base,backgroundColor:Colors.surface,borderRadius:Radius.xl,flexDirection:'row',alignItems:'center',gap:Spacing.md},previewImage:{width:80,height:80,borderRadius:Radius.md},section:{fontSize:Typography.size.md,fontWeight:Typography.weight.semibold,color:Colors.textPrimary},previewLabel:{fontSize:Typography.size.sm,fontWeight:Typography.weight.semibold,color:Colors.warning,lineHeight:20},trust:{flexDirection:'row',gap:Spacing.md,alignItems:'center'},
});
