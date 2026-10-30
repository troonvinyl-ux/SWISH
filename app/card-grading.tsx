import { View,Text,ScrollView,Pressable,StyleSheet,KeyboardAvoidingView,Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import { CardGradingCalculator } from '@/components/feature/CardGradingCalculator';
import { Colors,Spacing,Typography } from '@/constants/theme';
export default function CardGradingScreen() {
  const router=useRouter();
  return <SafeAreaView edges={['top','bottom']} style={s.screen}><StatusBar style="light"/>
    <KeyboardAvoidingView style={s.screen} behavior={Platform.OS==='ios' ? 'padding' : 'height'}><ScrollView style={s.screen} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={s.content}>
      <Pressable onPress={()=>router.back()} accessibilityRole="button" accessibilityLabel="Back from grading calculator" style={({ pressed })=>[s.back,pressed ? { opacity:0.65 } : null]}><MaterialIcons name="arrow-back" size={24} color={Colors.textPrimary}/><Text style={s.label}>Card Flipper · Grading scenarios</Text></Pressable>
      <CardGradingCalculator/>
    </ScrollView></KeyboardAvoidingView>
  </SafeAreaView>;
}
const s=StyleSheet.create({ screen:{ flex:1,backgroundColor:Colors.background },content:{ width:'100%',maxWidth:960,alignSelf:'center',padding:Spacing.base,gap:Spacing.base,paddingBottom:Spacing.xxl },back:{ minHeight:48,flexDirection:'row',alignItems:'center',gap:Spacing.sm },label:{ flex:1,color:Colors.textPrimary,fontSize:Typography.size.base } });
