import { memo } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors, Radius, Spacing, Typography } from '@/constants/theme';
import type { ListingClarification } from '@/shared/listingClarification';
interface ListingPublishHelpProps { clarification: ListingClarification; accent: string; busy: boolean; onResolve: () => void }
export const ListingPublishHelp = memo(function ListingPublishHelp({ clarification, accent, busy, onResolve }: ListingPublishHelpProps) {
 return <View style={s.card} accessibilityLiveRegion="polite">
  <View style={s.row}><MaterialIcons name="help-outline" size={24} color={Colors.warning}/><Text style={s.title}>{clarification.target === 'status' ? 'Check existing submission' : 'To continue'}</Text></View>
  <Text style={s.question}>{clarification.question}</Text>
  {clarification.fields.length ? <FlatList scrollEnabled={false} data={clarification.fields} keyExtractor={value => value} renderItem={({item}) => <View style={s.row}><MaterialIcons name="edit-note" size={20} color={accent}/><Text style={s.field}>{item}</Text></View>}/> : null}
  <Text selectable style={s.detail} accessibilityRole="alert">{clarification.detail}</Text>
  <Pressable accessibilityRole="button" accessibilityLabel={clarification.actionLabel} disabled={busy} onPress={onResolve} style={({pressed}) => [s.action, {borderColor:accent}, pressed || busy ? s.pressed : null]}><Text style={[s.actionText,{color:accent}]}>{clarification.actionLabel}</Text><MaterialIcons name="arrow-forward" size={22} color={accent}/></Pressable>
  {clarification.target !== 'status' ? <Text style={s.caption}>Your saved draft is kept. Correct the requested field, then tap List now to recheck; nothing is published automatically.</Text> : null}
 </View>;
});
interface ListingIdentificationAdviceProps { confidence: number; questions: string[]; accent: string; busy: boolean; onReview: () => void }
export const ListingIdentificationAdvice = memo(function ListingIdentificationAdvice({confidence,questions,accent,busy,onReview}:ListingIdentificationAdviceProps){
 return <View style={[s.card,{backgroundColor:Colors.surface,borderColor:Colors.surfaceBorder}]}>
  <View style={s.row}><MaterialIcons name="info-outline" size={22} color={accent}/><Text style={s.title}>AI confidence {Math.round(confidence*100)}% · advice only</Text></View>
  <Text style={s.question}>You can list this item without reaching 95%. Check the factual title and description, and disclose uncertain attribution. eBay category, condition and required fields still apply.</Text>
  {questions.length ? <><Text style={s.caption}>Optional evidence that could improve the identification:</Text><FlatList scrollEnabled={false} data={questions} keyExtractor={value=>value} renderItem={({item})=><Text style={s.question}>{item}</Text>}/></> : null}
  <Pressable disabled={busy} accessibilityLabel="Review factual listing claims without changing AI confidence" onPress={onReview} style={({pressed})=>[s.action,{borderColor:accent},pressed||busy?s.pressed:null]}><Text style={[s.actionText,{color:accent}]}>Review listing claims</Text><MaterialIcons name="edit-note" size={22} color={accent}/></Pressable>
 </View>;
});
const s=StyleSheet.create({card:{backgroundColor:Colors.warningDim,borderWidth:1,borderColor:Colors.warning,borderRadius:Radius.lg,padding:Spacing.base,gap:Spacing.md},row:{flexDirection:'row',alignItems:'center',gap:Spacing.sm},title:{flex:1,color:Colors.textPrimary,fontSize:Typography.size.md,fontWeight:Typography.weight.semibold},question:{color:Colors.textPrimary,fontSize:Typography.size.base,lineHeight:26,includeFontPadding:false},field:{flex:1,color:Colors.textPrimary,fontSize:Typography.size.base,lineHeight:26},detail:{color:Colors.warning,fontSize:Typography.size.base,lineHeight:26,includeFontPadding:false},action:{minHeight:48,borderRadius:Radius.md,borderWidth:1,padding:Spacing.md,backgroundColor:Colors.surfaceHighlight,flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:Spacing.sm},actionText:{fontSize:Typography.size.base,fontWeight:Typography.weight.semibold,flexShrink:1},caption:{color:Colors.textSecondary,fontSize:Typography.size.sm,lineHeight:21},pressed:{opacity:0.65}});
