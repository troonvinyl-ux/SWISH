import { memo } from 'react';
import { View,Text,TextInput,FlatList,Pressable,StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors,Spacing,Typography,Radius } from '@/constants/theme';
interface MusicCaptureControlsProps {
 mode:string;disabled:boolean;expectedCount:string;observedCount:string;
 onModeChange:(mode:string)=>void;onCountChange:(count:string)=>void;
}
const modes=[{id:'item',label:'Vinyl / cassette'},{id:'cd_box_set',label:'CD / box set'}];
/** Same scanner and photographs; physical completeness is separate from catalogue specifications. */
export const MusicCaptureControls=memo(function MusicCaptureControls({mode,disabled,expectedCount,observedCount,onModeChange,onCountChange}:MusicCaptureControlsProps){
 return <View style={s.panel}>
  <View style={s.row}><MaterialIcons name="album" size={24} color={Colors.primary}/><Text style={s.heading}>Music capture format</Text></View>
  <View style={s.rail}><FlatList horizontal data={modes} keyExtractor={item=>item.id} showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips} renderItem={({item})=><Pressable accessibilityLabel={`Capture ${item.label}`} accessibilityState={{selected:mode===item.id,disabled}} disabled={disabled} onPress={()=>onModeChange(item.id)} style={({pressed})=>[s.chip,mode===item.id?s.selected:null,pressed?s.pressed:null]}><Text style={[s.label,mode===item.id?s.selectedText:null]}>{item.label}</Text></Pressable>}/></View>
  <Text style={s.body}>{mode==='cd_box_set'?'Front cover, rear cover, all discs together and numbered disc labels. No vinyl Side A / Side B requirements.':'Existing sleeve, record-label, runout and vinyl-surface workflow.'}</Text>
  {mode==='cd_box_set'?<View style={s.block}>
   <Text style={s.label}>Discs physically present</Text>
   <TextInput accessibilityLabel="Number of discs physically present" value={observedCount} onChangeText={value=>onCountChange(value.replace(/\D/g,'').slice(0,3))} editable={!disabled} keyboardType="number-pad" maxLength={3} style={s.input} placeholder="Count the discs in your item" placeholderTextColor={Colors.textSecondary}/>
   <Text style={s.body}>{expectedCount?`Discogs catalogue: ${expectedCount} disc(s). Enter your physical count above; this is not automatically confirmed.`:'Catalogue disc count unavailable. Enter only the discs physically present.'}</Text>
   <Text style={s.body}>Up to five individual disc-label close-ups plus front, rear and contents views (eight photos). For larger sets, show every disc in the contents view and document missing discs.</Text>
  </View>:null}
  <Text style={s.hint}>Switching format keeps your original photos and confirmed release details. Retained extra views can be removed individually.</Text>
 </View>;
});
const s=StyleSheet.create({panel:{padding:Spacing.base,gap:Spacing.md,borderRadius:Radius.lg,borderWidth:1,borderColor:Colors.surfaceBorder,backgroundColor:Colors.surface},row:{flexDirection:'row',alignItems:'center',gap:Spacing.sm},heading:{fontSize:Typography.size.lg,fontWeight:Typography.weight.semibold,color:Colors.textPrimary},rail:{minHeight:56},chips:{gap:Spacing.sm,alignItems:'center',paddingVertical:Spacing.xs},chip:{height:48,paddingHorizontal:Spacing.base,borderRadius:Radius.pill,justifyContent:'center',backgroundColor:Colors.surfaceHighlight,borderWidth:1,borderColor:Colors.surfaceBorder},selected:{backgroundColor:Colors.primary,borderColor:Colors.primary},selectedText:{color:Colors.textInverse},label:{fontSize:Typography.size.base,fontWeight:Typography.weight.semibold,color:Colors.textPrimary},body:{fontSize:Typography.size.base,lineHeight:26,color:Colors.textSecondary,includeFontPadding:false},hint:{fontSize:Typography.size.sm,lineHeight:22,color:Colors.textSecondary},block:{gap:Spacing.sm},input:{minHeight:48,padding:Spacing.md,color:Colors.textPrimary,fontSize:Typography.size.base,borderRadius:Radius.md,borderWidth:1,borderColor:Colors.surfaceBorder,backgroundColor:Colors.surfaceHighlight},pressed:{opacity:0.7}});
