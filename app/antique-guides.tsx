import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { Spacing, Typography, Radius } from '@/constants/theme';
const GOLD='#D8AD52';
const GUIDES=[
['history','Periods & styles','Georgian, Victorian, Edwardian, Art Nouveau, Art Deco and later design movements. Treat style as a clue, not proof of manufacturing date.'],
['verified','Maker marks & hallmarks','Photograph the complete mark, including symbols, letter shapes and surrounding cartouche. A sponsor mark, retailer mark and maker mark are not necessarily the same.'],
['category','Ceramics, glass & pottery','Compare form, glaze, decoration, base construction and factory marks. Avoid assigning a factory or pattern from a partial visual resemblance.'],
['chair','Furniture & construction','Inspect joints, drawer construction, veneers, hardware, underside surfaces and later repairs. Style alone cannot establish age.'],
['watch','Clocks, watches & metalware','Record movement or mechanism details, hallmarks, maker inscriptions, serials and service history where accessible.'],
['palette','Art, prints & sculpture','Distinguish original works, reproductions, later impressions and works attributed to an artist. Signatures require independent verification.'],
['menu-book','Books & collectables','Capture title page, copyright page, edition statements, number line, dust jacket and condition.'],
['gavel','Provenance & buying safely','Keep invoices, collection history and ownership records. Flag uncertain origin, export controls or cultural property concerns for expert review.'],
];
export default function AntiqueGuidesScreen(){const router=useRouter();return <SafeAreaView style={s.screen}><ScrollView contentContainerStyle={s.content}>
<Pressable onPress={()=>router.back()} style={s.back}><MaterialIcons name="arrow-back" size={21} color={GOLD}/><Text style={s.backText}>BACK TO ANTIQUE FLIPPER</Text></Pressable>
<Text style={s.eyebrow}>COLLECTOR'S REFERENCE</Text><Text style={s.title}>Antique Guides</Text><Text style={s.subtitle}>Practical evidence-led guides for identifying, researching and describing antiques.</Text>
{GUIDES.map(([icon,title,body])=><View key={title} style={s.card}><MaterialIcons name={icon as any} size={23} color={GOLD}/><View style={{flex:1,gap:5}}><Text style={s.cardTitle}>{title}</Text><Text style={s.body}>{body}</Text></View></View>)}
<View style={s.note}><MaterialIcons name="info-outline" size={19} color={GOLD}/><Text style={s.noteText}>These guides support research; they do not authenticate an object, establish provenance or replace a qualified specialist's examination.</Text></View>
</ScrollView></SafeAreaView>}
const s=StyleSheet.create({screen:{flex:1,backgroundColor:'#090806'},content:{padding:Spacing.base,gap:Spacing.md,paddingBottom:40},back:{flexDirection:'row',alignItems:'center',gap:8,paddingVertical:8},backText:{fontSize:10,color:GOLD,fontWeight:'900',letterSpacing:1},eyebrow:{fontSize:9,color:GOLD,fontWeight:'900',letterSpacing:1.5,marginTop:12},title:{fontSize:29,color:'#F4D58A',fontWeight:'900'},subtitle:{fontSize:Typography.size.sm,color:'#C8BDA7',lineHeight:21},card:{flexDirection:'row',gap:Spacing.md,padding:Spacing.md,backgroundColor:'#17130D',borderWidth:1,borderColor:'#554322',borderRadius:Radius.lg},cardTitle:{fontSize:Typography.size.sm,color:'#F4E9D4',fontWeight:'800'},body:{fontSize:Typography.size.xs,color:'#B9B09F',lineHeight:19},note:{flexDirection:'row',gap:Spacing.sm,padding:Spacing.md,backgroundColor:'#28200F',borderRadius:Radius.md},noteText:{flex:1,fontSize:Typography.size.xs,color:'#D7C8A7',lineHeight:18}});
