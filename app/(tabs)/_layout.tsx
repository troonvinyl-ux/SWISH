import type { ComponentProps } from 'react';
import { MaterialIcons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Platform, View, Text, StyleSheet } from 'react-native';
import { Colors, Typography, Spacing, Radius } from '@/constants/theme';
import { useApp } from '@/hooks/useApp';
import { useNicheListingCount } from '@/hooks/useNicheListingCount';
import { IS_TV } from '@/hooks/useTVNavigation';
import { NICHES } from '@/constants/niches';
import { resolveProductionNiche } from '@/services/nicheRouting';
interface LabelProps { label:string;focused:boolean;accent:string }
function TabLabel({label,focused,accent}:LabelProps){return <Text style={[s.label,focused?{color:accent}:null]} numberOfLines={1} allowFontScaling={false}>{label}</Text>;}
export default function TabLayout(){
 const insets=useSafeAreaInsets();const {activeNicheId,fixedNicheId}=useApp();const liveCount=useNicheListingCount();
 const id=resolveProductionNiche(fixedNicheId??activeNicheId);const antiques=id==='antiques';
 const accent=id==='collectibles'?Colors.primary:antiques?Colors.specialistGold:id?NICHES[id].color:Colors.primary;
 const tabBarStyle={height:Platform.select({ios:insets.bottom+60,android:insets.bottom+60,default:70}),paddingTop:Spacing.sm,paddingBottom:Platform.select({ios:insets.bottom+Spacing.sm,android:insets.bottom+Spacing.sm,default:Spacing.sm}),paddingHorizontal:Spacing.base,backgroundColor:antiques?Colors.specialistSurface:Colors.surface,borderTopWidth:1,borderTopColor:antiques?Colors.specialistBorder:Colors.surfaceBorder};
 const tabIcon=(label:string,icon:ComponentProps<typeof MaterialIcons>['name'],focused:boolean)=> <View style={[s.item,focused?{backgroundColor:accent+'18'}:null]}><View style={s.iconWrap}><MaterialIcons name={icon} size={22} color={focused?accent:Colors.textSecondary}/>{label==='Inventory'&&liveCount>0?<View style={s.badge}><Text style={s.badgeText}>{liveCount>99?'99+':liveCount}</Text></View>:null}</View><TabLabel label={label} focused={focused} accent={accent}/></View>;
 return <>
  {/* Keep the navigator mounted. Only module content/state changes on switching. */}
  <Tabs screenOptions={{headerShown:false,tabBarStyle,tabBarActiveTintColor:accent,tabBarInactiveTintColor:Colors.textSecondary,tabBarShowLabel:false}}>
   <Tabs.Screen name="index" options={{title:'Home',tabBarAccessibilityLabel:'Home',tabBarIcon:({focused})=>tabIcon('Home','home',focused)}}/>
   <Tabs.Screen name="inventory" options={{title:'Inventory',tabBarAccessibilityLabel:'Inventory',tabBarIcon:({focused})=>tabIcon('Inventory','inventory-2',focused)}}/>
   <Tabs.Screen name="scan" options={{title:'Identify',tabBarAccessibilityLabel:'Identify an item with the active specialist',tabBarIcon:()=> <View style={[s.camera,{backgroundColor:accent,shadowColor:accent}]}><MaterialIcons name="photo-camera" size={26} color={Colors.background}/></View>}}/>
   <Tabs.Screen name="listings" options={{title:'Listings',tabBarAccessibilityLabel:'Listings and eBay workspace',tabBarIcon:({focused})=>tabIcon('Listings','sell',focused)}}/>
   <Tabs.Screen name="account" options={{title:'More',tabBarAccessibilityLabel:'More, settings and account',tabBarIcon:({focused})=>tabIcon('More','menu',focused)}}/>
   <Tabs.Screen name="acquisitions" options={{href:null}}/>
   <Tabs.Screen name="insights" options={{href:null}}/>
   <Tabs.Screen name="antique-more" options={{href:null}}/>
  </Tabs>
  {IS_TV?<View style={s.tv}><Text style={s.label}>Left / right: tabs · OK: select · Back: return</Text></View>:null}
 </>;
}
const s=StyleSheet.create({item:{alignItems:'center',justifyContent:'center',gap:Spacing.xs,minWidth:48,minHeight:48,borderRadius:Radius.sm,paddingHorizontal:Spacing.xs},label:{fontSize:Typography.size.xs,fontWeight:Typography.weight.medium,color:Colors.textSecondary,textAlign:'center'},camera:{width:52,height:52,borderRadius:Radius.circle,alignItems:'center',justifyContent:'center',shadowOffset:{width:0,height:2},shadowOpacity:0.3,shadowRadius:8,elevation:4},iconWrap:{alignItems:'center',justifyContent:'center'},badge:{position:'absolute',top:-6,right:-8,minWidth:16,height:16,borderRadius:Radius.pill,alignItems:'center',justifyContent:'center',paddingHorizontal:Spacing.xs,backgroundColor:Colors.danger},badgeText:{color:Colors.textPrimary,fontSize:Typography.size.xs,fontWeight:Typography.weight.bold},tv:{position:'absolute',bottom:0,left:0,right:0,padding:Spacing.xs,backgroundColor:Colors.surface,alignItems:'center'}});
