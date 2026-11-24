import { memo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useCoinPacketReview } from '@/hooks/useCoinPacketReview';
import type { AIIdentificationResult } from '@/services/aiIdentificationService';
import { Colors, Spacing, Radius, Typography } from '@/constants/theme';
import { PremiumField } from '@/components/ui/PremiumField';
interface CoinPacketReviewProps {result:AIIdentificationResult;answers:Record<string,string>;disabled:boolean;onAnswer:(key:string,value:string)=>void;onConfirm:()=>void}
export const CoinPacketReview=memo(function CoinPacketReview(p:CoinPacketReviewProps){
 const review=useCoinPacketReview(p.result,p.answers),[expanded,setExpanded]=useState(false);if(!review)return null;
 return <View style={s.card}><View style={s.row}><MaterialIcons name={review.reviewed?'fact-check':'description'} size={24} color={review.reviewed?Colors.success:Colors.primary}/><Text style={s.title}>{review.reviewed?'Packet details reviewed':'Read from your coin packet'}</Text></View>
 <Text style={s.body}>Check the handwriting once. Packet attribution is not independent authentication; recorded sizes are not new measurements.</Text>
 <FlatList data={review.fields.filter(field=>expanded||field.value)} scrollEnabled={false} keyExtractor={field=>field.key} renderItem={({item})=>expanded?<View style={s.field}><PremiumField label={item.label} value={item.value} onChange={value=>p.onAnswer(`_packet_edit_${item.key}`,value)} disabled={p.disabled} numeric={item.key==='weight_g'||item.key==='diameter_mm'}/>{item.uncertain?<Text style={s.warning}>Handwriting unclear — confirm, correct or leave blank.</Text>:null}</View>:<Text style={s.body}>{item.label}: {item.value}{item.uncertain?' · check handwriting':''}</Text>}/>
 {expanded?<><Text style={s.subtle}>Literal packet text</Text><Text selectable style={s.body}>{review.packet.transcript}</Text>{review.packet.limitations.length?<Text style={s.warning}>{review.packet.limitations.join('\n')}</Text>:null}</>:null}
 <Pressable accessibilityLabel={expanded?'Collapse packet corrections':'Edit packet readings and view transcript'} onPress={()=>setExpanded(value=>!value)} style={({pressed})=>[s.secondary,pressed?s.pressed:null]}><Text style={s.body}>{expanded?'Show summary':'Edit readings / show original text'}</Text></Pressable>
 <Pressable disabled={p.disabled} accessibilityRole="button" accessibilityLabel="Confirm reviewed coin packet information" onPress={p.onConfirm} style={({pressed})=>[s.confirm,pressed||p.disabled?s.pressed:null]}><MaterialIcons name="check" size={20} color={Colors.primary}/><Text style={s.title}>{review.reviewed?'Apply packet corrections':'Confirm packet readings'}</Text></Pressable>
 </View>;
});
const s=StyleSheet.create({card:{padding:Spacing.base,gap:Spacing.md,borderWidth:1,borderColor:Colors.surfaceBorder,borderRadius:Radius.lg,backgroundColor:Colors.surface},row:{flexDirection:'row',alignItems:'center',gap:Spacing.sm},title:{flexShrink:1,fontSize:Typography.size.base,fontWeight:Typography.weight.bold,color:Colors.textPrimary},body:{fontSize:Typography.size.base,lineHeight:26,color:Colors.textPrimary},subtle:{fontSize:Typography.size.base,lineHeight:26,color:Colors.textSecondary},warning:{fontSize:Typography.size.base,lineHeight:26,color:Colors.warning},field:{marginBottom:Spacing.md},secondary:{minHeight:48,justifyContent:'center'},confirm:{minHeight:48,padding:Spacing.md,gap:Spacing.sm,flexDirection:'row',alignItems:'center',borderWidth:1,borderColor:Colors.primary,borderRadius:Radius.md,backgroundColor:Colors.primaryDim},pressed:{opacity:0.65}});
