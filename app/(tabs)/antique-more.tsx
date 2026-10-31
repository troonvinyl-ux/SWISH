import React from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { useAuth } from '@/template';
import { isSwishMasterAdmin } from '@/contexts/AppContext';
import { Colors, Spacing, Typography, Radius } from '@/constants/theme';
const GOLD='#D8AD52';
export default function AntiqueMoreScreen(){const router=useRouter();const {user}=useAuth();
const links=[
{icon:'tune',title:'Niche Settings',sub:'Antique Flipper preferences',route:'/settings'},
{icon:'link',title:'eBay Connection',sub:'Account and marketplace connection',route:'/ebay-account'},
{icon:'price-change',title:'Price Decay',sub:'Review repricing rules and simulations',route:'/repricing'},
{icon:'menu-book',title:'Antique Guides',sub:'Periods, marks and collecting reference',route:'/antique-guides'},
{icon:'handyman',title:'Restoration & Care',sub:'Conservation-first advice',route:'/antique-restoration'},
{icon:'help-outline',title:'Help & Guides',sub:'SWISH help and support',route:'/antique-guides'},
{icon:'account-circle',title:'Account',sub:'Your account and sign-in details',route:'/account'},
];
if(isSwishMasterAdmin(user?.email)) links.push({icon:'health-and-safety',title:'Diagnostics Centre',sub:'Owner-only integration diagnostics',route:'/master-diagnostics'});
return <SafeAreaView style={s.screen}><ScrollView contentContainerStyle={s.content}>
<Text style={s.eyebrow}>ANTIQUE FLIPPER</Text><Text style={s.title}>More</Text><Text style={s.subtitle}>Settings, marketplace connections and specialist resources.</Text>
{links.map(link=><Pressable key={link.title} onPress={()=>router.push(link.route as any)} style={({pressed})=>[s.card,pressed&&{opacity:0.75}]}><MaterialIcons name={link.icon as any} size={23} color={GOLD}/><View style={{flex:1,gap:3}}><Text style={s.cardTitle}>{link.title}</Text><Text style={s.body}>{link.sub}</Text></View><MaterialIcons name="chevron-right" size={22} color="#8B7954"/></Pressable>)}
</ScrollView></SafeAreaView>}
const s=StyleSheet.create({screen:{flex:1,backgroundColor:'#090806'},content:{padding:Spacing.base,gap:Spacing.md},eyebrow:{fontSize:9,color:GOLD,fontWeight:'900',letterSpacing:1.5,marginTop:12},title:{fontSize:29,color:'#F4D58A',fontWeight:'900'},subtitle:{fontSize:Typography.size.sm,color:'#C8BDA7',lineHeight:21,marginBottom:8},card:{flexDirection:'row',alignItems:'center',gap:Spacing.md,padding:Spacing.md,backgroundColor:'#17130D',borderWidth:1,borderColor:'#554322',borderRadius:Radius.lg,minHeight:68},cardTitle:{fontSize:Typography.size.sm,color:'#F4E9D4',fontWeight:'800'},body:{fontSize:Typography.size.xs,color:'#B9B09F',lineHeight:18}});
