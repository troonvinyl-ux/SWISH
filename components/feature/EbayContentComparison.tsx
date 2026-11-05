import { memo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors, Radius, Spacing, Typography } from '@/constants/theme';
import { descriptionText, verifyRevisionContent, type LiveListingContent } from '@/shared/ebayRevisionContract';
interface EbayContentComparisonProps {
  live: LiveListingContent | null; price: number; title: string; description: string;
  externalListingId: string; busy: boolean; error?: string | null; onCheck: () => void;
}
export const EbayContentComparison = memo(function EbayContentComparison({ live, price, title, description, externalListingId, busy, error, onCheck }: EbayContentComparisonProps) {
  const [showDescriptions, setShowDescriptions] = useState(false);
  const mismatches = live ? verifyRevisionContent(live, { price, title, description, externalListingId }) : [];
  return <View style={s.panel}>
    <View style={s.row}><MaterialIcons name="sync" size={22} color={Colors.info}/><Text style={s.title}>Saved vs live eBay</Text></View>
    <Text style={s.body}>SWISH seller price: {Number.isFinite(price) ? `£${price.toFixed(2)}` : 'Enter a valid price'}</Text>
    <Text style={s.body}>{live ? `eBay seller price: ${live.currency} ${live.sellerPrice.toFixed(2)} · checked ${new Date(live.checkedAt).toLocaleTimeString()}` : 'Live seller price and description have not been checked.'}</Text>
    {live ? <Text accessibilityRole={mismatches.length ? 'alert' : undefined} style={[s.body, { color: mismatches.length ? Colors.warning : Colors.success }]}>{mismatches.length ? mismatches.join(' ') : 'Saved title, description and seller price match the live snapshot.'}</Text> : null}
    <Text style={s.hint}>Save updates SWISH only. Revise sends saved listing content to eBay. Buyer Protection fees, postage and buyer taxes may make the public total higher; they are not your seller price.</Text>
    {error ? <Text accessibilityRole="alert" style={s.error}>{error}</Text> : null}
    <Pressable disabled={busy} accessibilityRole="button" onPress={onCheck} style={({pressed})=>[s.button,pressed||busy?s.pressed:null]}>{busy ? <ActivityIndicator color={Colors.info}/> : <MaterialIcons name="refresh" size={22} color={Colors.info}/>}<Text style={s.buttonText}>{busy ? 'Checking eBay…' : 'Check live eBay details'}</Text></Pressable>
    <Pressable accessibilityRole="button" accessibilityState={{expanded:showDescriptions}} onPress={()=>setShowDescriptions(value=>!value)} style={({pressed})=>[s.button,pressed?s.pressed:null]}><MaterialIcons name={showDescriptions?'expand-less':'expand-more'} size={22} color={Colors.info}/><Text style={s.buttonText}>{showDescriptions?'Hide descriptions':'Compare description text'}</Text></Pressable>
    {showDescriptions ? <View style={s.copy}><Text style={s.title}>Saved seller description</Text><Text selectable style={s.body}>{descriptionText(description) || 'No saved description.'}</Text><Text style={s.title}>Live eBay description</Text><Text selectable style={s.body}>{live ? descriptionText(live.description) || 'eBay returned an empty description.' : 'Check live eBay details first.'}</Text></View> : null}
    <Text style={s.hint}>This check is read-only and keeps your edits. A previous snapshot is not a guarantee of current eBay state.</Text>
  </View>;
});
const s=StyleSheet.create({panel:{backgroundColor:Colors.infoDim,padding:Spacing.base,gap:Spacing.sm,borderRadius:Radius.lg,borderWidth:1,borderColor:Colors.info},copy:{gap:Spacing.sm},row:{flexDirection:'row',alignItems:'center',gap:Spacing.sm},title:{fontSize:Typography.size.md,fontWeight:Typography.weight.semibold,color:Colors.textPrimary,flex:1},body:{fontSize:Typography.size.base,lineHeight:26,color:Colors.textPrimary,includeFontPadding:false},hint:{fontSize:Typography.size.sm,lineHeight:22,color:Colors.textSecondary},error:{fontSize:Typography.size.base,lineHeight:26,color:Colors.danger},button:{minHeight:48,borderRadius:Radius.md,backgroundColor:Colors.surfaceHighlight,padding:Spacing.md,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:Spacing.sm},buttonText:{fontSize:Typography.size.base,fontWeight:Typography.weight.semibold,color:Colors.info},pressed:{opacity:0.65}});
