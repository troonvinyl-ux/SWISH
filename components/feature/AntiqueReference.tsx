import { memo } from 'react';
import { FlatList, View, Text, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Colors, Spacing, Typography, Radius } from '@/constants/theme';
import { NICHES } from '@/constants/niches';
interface AntiqueReferenceProps { title: string; subtitle: string; sections: ReadonlyArray<readonly [string,string,string]> }
export const AntiqueReference = memo(function AntiqueReference({title,subtitle,sections}: AntiqueReferenceProps) {
 const router=useRouter(); const accent=NICHES.antiques.color;
 return <SafeAreaView style={styles.screen} edges={['top','bottom']}><FlatList data={sections} keyExtractor={item=>item[1]} showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}
 ListHeaderComponent={<View style={styles.heading}><Pressable accessibilityLabel="Back to Antique Flipper" onPress={()=>router.canGoBack()?router.back():router.replace('/(tabs)' as any)} style={({pressed})=>[styles.back,{opacity:pressed?0.7:1}]}><MaterialIcons name="arrow-back" size={24} color={accent}/><Text style={[styles.label,{color:accent}]}>Antique Flipper</Text></Pressable><Text style={styles.title}>{title}</Text><Text style={styles.body}>{subtitle}</Text></View>}
 renderItem={({item})=><View style={styles.card}><MaterialIcons name={item[0] as any} size={24} color={accent}/><View style={styles.copy}><Text style={styles.cardTitle}>{item[1]}</Text><Text style={styles.body}>{item[2]}</Text></View></View>}
 ListFooterComponent={<View style={styles.card}><MaterialIcons name="info-outline" size={24} color={accent}/><Text style={[styles.body,styles.copy]}>Reference guidance supports research; it does not authenticate an object or replace a qualified specialist examination.</Text></View>}/></SafeAreaView>;
});
const styles=StyleSheet.create({screen:{flex:1,backgroundColor:Colors.background},content:{padding:Spacing.base,gap:Spacing.base},heading:{gap:Spacing.base},back:{minHeight:48,flexDirection:'row',alignItems:'center',gap:Spacing.sm},label:{fontSize:Typography.size.base,fontWeight:'600'},title:{fontSize:Typography.size.xl,color:Colors.textPrimary,fontWeight:'700'},body:{fontSize:Typography.size.base,lineHeight:26,color:Colors.textSecondary,includeFontPadding:false},card:{padding:Spacing.base,flexDirection:'row',gap:Spacing.base,borderWidth:1,borderColor:Colors.surfaceBorder,backgroundColor:Colors.surface,borderRadius:Radius.lg},copy:{flex:1,gap:Spacing.sm},cardTitle:{fontSize:Typography.size.md,color:Colors.textPrimary,fontWeight:'600'}});
