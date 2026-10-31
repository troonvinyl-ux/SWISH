import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors, Spacing, Typography, Radius } from '@/constants/theme';
const GOLD='#D8AD52';
const TIPS=[
['visibility','Document before touching','Photograph all sides, marks, damage and existing repairs. Record dimensions and any known history before cleaning or dismantling.'],
['water-drop','Avoid aggressive cleaning','Do not polish, sand, use acids, solvents or abrasive products on unknown materials, finishes, patina, gilding or historic surfaces.'],
['shield','Stabilise and protect','Keep fragile items supported, dry and away from direct sunlight, heat and rapid humidity changes. Use inert, padded storage materials.'],
['search','Identify materials first','Unknown finishes, plated surfaces, ivory-like materials, tortoiseshell, ceramics and composite objects may need specialist identification before treatment.'],
['build','Use a qualified conservator','Valuable, rare, signed, historically significant or structurally damaged objects should be assessed by a qualified conservator before intervention.'],
['payments','Estimate costs honestly','Record professional quotations separately from AI estimates. Include transport, materials, labour, insurance and the possibility that restoration may reduce value.'],
];
export default function AntiqueRestorationScreen(){const router=useRouter();return <SafeAreaView style={s.screen}><ScrollView contentContainerStyle={s.content}>
<Pressable onPress={()=>router.back()} style={s.back}><MaterialIcons name="arrow-back" size={21} color={GOLD}/><Text style={s.backText}>BACK TO ANTIQUE FLIPPER</Text></Pressable>
<Text style={s.eyebrow}>CONSERVATION FIRST</Text><Text style={s.title}>Restoration & Care</Text><Text style={s.subtitle}>Protect the object and its value. SWISH should never encourage irreversible treatment based only on a photograph.</Text>
{TIPS.map(([icon,title,body])=><View key={title} style={s.card}><MaterialIcons name={icon as any} size={23} color={GOLD}/><View style={{flex:1,gap:5}}><Text style={s.cardTitle}>{title}</Text><Text style={s.body}>{body}</Text></View></View>)}
<View style={s.warning}><MaterialIcons name="warning-amber" size={20} color="#F4C76A"/><Text style={s.warningText}>Do not attempt DIY restoration on archaeological material, important works of art, historic finishes, precious metal objects or fragile ceramics. Seek specialist conservation advice.</Text></View>
</ScrollView></SafeAreaView>}
const s=StyleSheet.create({screen:{flex:1,backgroundColor:'#090806'},content:{padding:Spacing.base,gap:Spacing.md,paddingBottom:40},back:{flexDirection:'row',alignItems:'center',gap:8,paddingVertical:8},backText:{fontSize:10,color:GOLD,fontWeight:'900',letterSpacing:1},eyebrow:{fontSize:9,color:GOLD,fontWeight:'900',letterSpacing:1.5,marginTop:12},title:{fontSize:29,color:'#F4D58A',fontWeight:'900'},subtitle:{fontSize:Typography.size.sm,color:'#C8BDA7',lineHeight:21},card:{flexDirection:'row',gap:Spacing.md,padding:Spacing.md,backgroundColor:'#17130D',borderWidth:1,borderColor:'#554322',borderRadius:Radius.lg},cardTitle:{fontSize:Typography.size.sm,color:'#F4E9D4',fontWeight:'800'},body:{fontSize:Typography.size.xs,color:'#B9B09F',lineHeight:19},warning:{flexDirection:'row',gap:Spacing.sm,padding:Spacing.md,backgroundColor:'#33240D',borderWidth:1,borderColor:'#8B6424',borderRadius:Radius.md},warningText:{flex:1,fontSize:Typography.size.xs,color:'#F3DDAA',lineHeight:18}});
