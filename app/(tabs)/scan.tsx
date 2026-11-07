import { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Colors, Spacing, Typography } from '@/constants/theme';
import { PremiumScanner } from '@/components/feature/PremiumScanner';
import { QuickListWorkspace } from '@/components/feature/QuickListWorkspace';
import { useApp } from '@/hooks/useApp';
import { resolveProductionNiche } from '@/services/nicheRouting';
/** One universal Quick List, with the existing specialist scanner still available. */
export default function ScanScreen(){
 const {fixedNicheId,activeNicheId}=useApp();const niche=resolveProductionNiche(fixedNicheId??activeNicheId);
 const [selection,setSelection]=useState({niche:'',advanced:false});const advanced=selection.niche===niche&&selection.advanced;
 if(!niche)return <PremiumScanner tabPage/>;
 // The workspace owns the top safe area; this selector sits above the existing tab bar.
 return <View style={s.screen}>{advanced?<PremiumScanner key={niche} requiredNiche={niche} tabPage/>:<QuickListWorkspace key={niche} nicheId={niche} tabPage/>}<View style={s.modes}><Pressable accessibilityRole="tab" accessibilityState={{selected:!advanced}} onPress={()=>setSelection({niche,advanced:false})} style={({pressed})=>[s.mode,!advanced?s.selected:null,pressed?s.pressed:null]}><Text style={s.label}>Quick List</Text></Pressable><Pressable accessibilityRole="tab" accessibilityState={{selected:advanced}} onPress={()=>setSelection({niche,advanced:true})} style={({pressed})=>[s.mode,advanced?s.selected:null,pressed?s.pressed:null]}><Text style={s.label}>Specialist scanner</Text></Pressable></View></View>;
}
const s=StyleSheet.create({screen:{flex:1,backgroundColor:Colors.background},modes:{flexDirection:'row',backgroundColor:Colors.surface,padding:Spacing.sm,gap:Spacing.sm},mode:{flex:1,minHeight:48,padding:Spacing.sm,alignItems:'center',justifyContent:'center',borderBottomWidth:2,borderBottomColor:Colors.surfaceBorder},selected:{borderBottomColor:Colors.primary,backgroundColor:Colors.primaryDim},label:{color:Colors.textPrimary,fontSize:Typography.size.base,fontWeight:Typography.weight.semibold},pressed:{opacity:0.7}});
