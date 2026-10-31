import { memo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import type { WatchedLot } from '@/services/watchedLotService';
import { lotMoney } from '@/services/manifestExperienceService';
import { Colors,Spacing,Radius,Typography,Shadow } from '@/constants/theme';

interface WatchedLotCardProps { lot: WatchedLot; busy: boolean; onOpen: () => void; onRemove: () => void; onOpenAuction: () => void }
export const WatchedLotCard = memo(function WatchedLotCard({lot,busy,onOpen,onRemove,onOpenAuction}: WatchedLotCardProps) {
  const date = new Date(lot.updated_at).toLocaleDateString();
  return <View style={s.card}>
    <View style={s.row}><View style={s.mark}><MaterialIcons name="bookmark" size={24} color={Colors.primary}/></View><View style={s.flex}><Text style={s.title} numberOfLines={2}>{lot.name}</Text><Text style={s.note}>{lot.product_count} product types · {lot.unit_count} products</Text></View></View>
    <View style={s.valueBlock}><Text style={s.label}>Saved base maximum</Text><Text style={s.price}>{lotMoney(lot.base_valuation.maximumHammerBid)}</Text><Text style={s.note}>Resale ceiling {lotMoney(lot.base_valuation.resaleCeiling)} · delivery allowed for</Text></View>
    <Text style={s.note}>Saved {date}. Prices and auction details are not live.</Text>
    <View style={s.row}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Open watched plan for ${lot.name}`} disabled={busy} accessibilityState={{disabled:busy}} onPress={onOpen} style={({pressed})=>[s.open,(pressed||busy)?s.pressed:null]}><Text style={s.openText}>Open my plan</Text><MaterialIcons name="arrow-forward" size={20} color={Colors.primary}/></Pressable>
      {lot.auction_url ? <Pressable accessibilityRole="button" accessibilityLabel={`Open auction for ${lot.name}`} disabled={busy} onPress={onOpenAuction} style={({pressed})=>[s.remove,(pressed||busy)?s.pressed:null]}><MaterialIcons name="open-in-new" size={22} color={Colors.primary}/></Pressable> : null}
      <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${lot.name} from watched lots`} disabled={busy} accessibilityState={{disabled:busy}} onPress={onRemove} style={({pressed})=>[s.remove,(pressed||busy)?s.pressed:null]}><MaterialIcons name="bookmark-remove" size={24} color={Colors.textSecondary}/></Pressable>
    </View>
  </View>;
});
const s=StyleSheet.create({
  card:{padding:Spacing.base,gap:Spacing.base,borderRadius:Radius.xl,backgroundColor:Colors.surface,borderWidth:1,borderColor:Colors.surfaceBorder,...Shadow.sm},
  row:{flexDirection:'row',alignItems:'center',gap:Spacing.md},flex:{flex:1},mark:{width:48,height:48,borderRadius:Radius.md,backgroundColor:Colors.primaryDim,alignItems:'center',justifyContent:'center'},
  title:{fontSize:Typography.size.md,fontWeight:Typography.weight.semibold,lineHeight:26,color:Colors.textPrimary,includeFontPadding:false},note:{fontSize:Typography.size.base,lineHeight:26,color:Colors.textSecondary,includeFontPadding:false},
  valueBlock:{gap:Spacing.sm,padding:Spacing.base,borderRadius:Radius.lg,backgroundColor:Colors.primaryDim},label:{fontSize:Typography.size.base,color:Colors.primary,fontWeight:Typography.weight.medium},price:{fontSize:Typography.size.xxl,color:Colors.primary,fontWeight:Typography.weight.bold,includeFontPadding:false},
  open:{flex:1,minHeight:48,flexDirection:'row',gap:Spacing.sm,alignItems:'center',justifyContent:'center',borderRadius:Radius.md,backgroundColor:Colors.surfaceHighlight},openText:{fontSize:Typography.size.base,fontWeight:Typography.weight.semibold,color:Colors.textPrimary},remove:{width:48,height:48,alignItems:'center',justifyContent:'center',borderRadius:Radius.md,backgroundColor:Colors.surfaceHighlight},pressed:{opacity:0.65},
});
