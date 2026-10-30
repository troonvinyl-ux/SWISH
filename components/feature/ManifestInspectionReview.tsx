import { memo, useState } from 'react';
import { View,Text,Pressable,StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useManifestInspection } from '@/hooks/useManifestInspection';
import { Colors,Spacing,Radius,Typography } from '@/constants/theme';
interface ManifestInspectionReviewProps { itemId:string; attributes:Record<string,any>; onReviewed?: (attributes:Record<string,any>)=>void }
export const ManifestInspectionReview=memo(function ManifestInspectionReview({ itemId,attributes,onReviewed }:ManifestInspectionReviewProps){
  const review=useManifestInspection(itemId);const [acknowledged,setAcknowledged]=useState(false);const [confirmed,setConfirmed]=useState(false);
  if(!attributes._manifest) return null;
  return <View style={s.card}><Text style={s.title}>Manifest stock · physical inspection</Text><Text style={s.body}>{attributes._manifest.physical_units ?? ''} physical units · {attributes._manifest.units_per_sale ?? 1} per sale unit. Supplier claims and reference images do not verify condition or safety.</Text>
    {attributes._manifest_review_required && !confirmed ? <>
      <Text style={s.warning}>Publishing is blocked until actual stock is checked and the draft is completed.</Text>
      <Pressable accessibilityRole="checkbox" accessibilityState={{ checked:acknowledged }} disabled={review.busy} onPress={()=>setAcknowledged(!acknowledged)} style={({pressed})=>[s.toggle,pressed ? s.pressed : null]}><MaterialIcons name={acknowledged?'check-box':'check-box-outline-blank'} size={24} color={Colors.primary}/><Text style={[s.body,s.flex]}>I checked exact product identity, sellable count, accessories/function, recalls, safety and resale restrictions. My listing/photos accurately describe the actual stock and I have image rights. Safety-critical goods received competent verification; unverified claims were removed.</Text></Pressable>
      <Pressable disabled={!acknowledged || review.busy} onPress={()=>{void review.confirm().then(result=>{if(result){setConfirmed(true);onReviewed?.(result.attributes);}});}} style={({pressed})=>[s.button,!acknowledged || review.busy || pressed?s.pressed:null]}><Text style={s.buttonText}>{review.busy?'Saving inspection…':'Confirm inspection after saving editor changes'}</Text></Pressable>
    </> : <Text style={s.body}>Seller inspection recorded. eBay still checks category, required fields and business policies at submission.</Text>}
    {review.error?<Text accessibilityRole="alert" style={s.warning}>{review.error}</Text>:null}
  </View>;
});
const s=StyleSheet.create({card:{padding:Spacing.base,gap:Spacing.md,borderRadius:Radius.lg,backgroundColor:Colors.surface,borderWidth:1,borderColor:Colors.warningDim},title:{fontSize:Typography.size.md,fontWeight:Typography.weight.semibold,color:Colors.textPrimary},body:{fontSize:Typography.size.base,lineHeight:26,color:Colors.textPrimary},warning:{fontSize:Typography.size.base,lineHeight:26,color:Colors.warning},toggle:{minHeight:48,flexDirection:'row',gap:Spacing.md},flex:{flex:1},button:{minHeight:48,padding:Spacing.base,backgroundColor:Colors.primary,borderRadius:Radius.md,alignItems:'center'},buttonText:{fontSize:Typography.size.base,fontWeight:Typography.weight.semibold,color:Colors.textInverse},pressed:{opacity:0.65}});
