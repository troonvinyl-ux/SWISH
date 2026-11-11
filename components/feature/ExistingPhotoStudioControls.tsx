import { memo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import type { ItemSmartStudioController } from '@/hooks/useItemSmartStudio';
import { Colors, Radius, Spacing, Typography } from '@/constants/theme';
interface ExistingPhotoStudioControlsProps { originalUri:string; studio:ItemSmartStudioController; accent:string; disabled?:boolean }
/** A per-photo opt-in, not another processing screen. Saved gallery already shows the result. */
export const ExistingPhotoStudioControls=memo(function ExistingPhotoStudioControls({originalUri,studio,accent,disabled=false}:ExistingPhotoStudioControlsProps){
 if(!studio.available)return null;
 const result=studio.resultFor(originalUri),locked=disabled||studio.busy||!studio.canProcess(originalUri)||Boolean(result);
 return <View style={s.panel}>
  <Pressable accessibilityRole="button" accessibilityLabel="Remove background from this photo" accessibilityState={{disabled:locked,busy:studio.busy}} disabled={locked} onPress={()=>{void studio.processPhoto(originalUri);}} style={({pressed})=>[s.button,pressed||locked?s.pressed:null]}>
   {studio.busy?<ActivityIndicator color={accent}/>:<MaterialIcons name={result?'check':'layers-clear'} size={20} color={accent}/>}
   <Text style={[s.label,{color:accent}]}>{studio.busy?'Removing background…':result?'BG ready':'BG-remove'}</Text>
  </Pressable>
  {studio.busy?<Pressable accessibilityRole="button" onPress={studio.cancel} style={({pressed})=>[s.button,pressed?s.pressed:null]}><Text style={s.label}>Cancel</Text></Pressable>:null}
  {studio.error?<View style={s.errorRow}><MaterialIcons name="error-outline" size={20} color={Colors.warning}/><Text accessibilityRole="alert" style={s.error}>{studio.error}</Text></View>:null}
  <Text style={s.note}>Original retained. eBay changes only after you select photos and confirm the listing.</Text>
 </View>;
});
const s=StyleSheet.create({panel:{gap:Spacing.sm},button:{minHeight:48,alignSelf:'flex-start',flexDirection:'row',alignItems:'center',gap:Spacing.sm,paddingHorizontal:Spacing.md,paddingVertical:Spacing.sm,borderRadius:Radius.md,backgroundColor:Colors.surfaceHighlight},label:{fontSize:Typography.size.base,fontWeight:Typography.weight.semibold,color:Colors.textPrimary,includeFontPadding:false},note:{fontSize:Typography.size.sm,lineHeight:21,color:Colors.textSecondary},errorRow:{flexDirection:'row',alignItems:'flex-start',gap:Spacing.sm},error:{flex:1,fontSize:Typography.size.base,lineHeight:26,color:Colors.warning},pressed:{opacity:0.6}});
