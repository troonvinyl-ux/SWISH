import { memo,useState } from 'react';
import { View,Text,TextInput,Pressable,ActivityIndicator,StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useFlipIntelligence,type FlipField } from '@/hooks/useFlipIntelligence';
import type { AIIdentificationResult } from '@/services/aiIdentificationService';
import { Colors,Spacing,Typography,Radius } from '@/constants/theme';
interface FlipIntelligencePanelProps { result:AIIdentificationResult; tenantId?:string; nicheId:string }
const fields:Array<{ key:FlipField;label:string }>=[
  { key:'purchaseCost',label:'Asking / purchase price (£)' },{ key:'resalePrice',label:'Expected resale (£) · manual scenario or leave blank' },{ key:'conservativePrice',label:'Conservative resale (£) · manual scenario or leave blank' },
  { key:'shippingCost',label:'Seller postage cost (£)' },{ key:'shippingRevenue',label:'Buyer-paid postage (£)' },{ key:'packagingCost',label:'Packaging (£)' },{ key:'repairCost',label:'Repair / preparation (£)' },{ key:'otherCosts',label:'Other costs / return allowance (£)' },
  { key:'feeRate',label:'Assumed total percentage fee (%)' },{ key:'fixedFee',label:'Assumed fixed per-sale fee (£)' },{ key:'labourHours',label:'Labour (hours)' },{ key:'labourRate',label:'Value of your time (£ / hour)' },
  { key:'minProfit',label:'Minimum profit after labour (£)' },{ key:'minROI',label:'Minimum ROI (%)' },{ key:'budget',label:'Maximum purchase budget (£)' },{ key:'holdingDays',label:'Assumed holding days · leave blank if unknown' },{ key:'maxHoldingDays',label:'Preferred maximum holding days' },{ key:'sellableYield',label:'Expected sellable value yield (%) · lot scenarios' },
];
export const FlipIntelligencePanel=memo(function FlipIntelligencePanel({ result,tenantId,nicheId }:FlipIntelligencePanelProps) {
  const flip=useFlipIntelligence(result,tenantId,nicheId); const [expanded,setExpanded]=useState(false); const data=flip.calculation;
  return <View style={s.card}>
    <View style={s.row}><MaterialIcons name="calculate" size={24} color={Colors.primary}/><Text style={s.title}>Is this worth buying?</Text></View>
    <Text style={s.body}>Projected economics, not realised profit. Fees are configurable assumptions, not an account-specific eBay quote. Include VAT, promotions and extra costs where applicable.</Text>
    <Pressable disabled={flip.loading || !tenantId} onPress={()=>{ void flip.research(); }} style={({ pressed })=>[s.secondary,pressed || flip.loading ? s.pressed : null]}>
      {flip.loading ? <ActivityIndicator color={Colors.info}/> : <MaterialIcons name="search" size={20} color={Colors.info}/>}<Text style={s.linkText}>{flip.loading ? 'Researching comparable evidence' : 'Research market evidence'}</Text>
    </Pressable>
    {flip.market ? <Text style={s.body}>{flip.market.valuation?.valuationMethod ?? 'Source unavailable'}{ '\n' }{flip.market.soldMarket?.relevantSoldCount ?? 0} reported relevant sold comparisons · {flip.market.activeAskingPrices?.count ?? 0} asking listings (not sales){ '\n' }{flip.market.auditTrail?.timestamp ?? 'Research date not supplied'}</Text> : null}
    {flip.error ? <View style={s.row}><MaterialIcons name="error-outline" size={20} color={Colors.danger}/><Text style={[s.body,s.flex]}>{flip.error}</Text></View> : null}
    {fields.slice(0,3).map(f=><View key={f.key} style={s.field}><Text style={s.label}>{f.label}</Text><TextInput accessibilityLabel={f.label} keyboardType="decimal-pad" style={s.input} value={flip.values[f.key]} onChangeText={value=>flip.update(f.key,value)} placeholder="Not supplied" placeholderTextColor={Colors.textSecondary}/></View>)}
    <Pressable onPress={()=>setExpanded(value=>!value)} style={({ pressed })=>[s.secondary,pressed ? s.pressed : null]}><MaterialIcons name={expanded ? 'expand-less' : 'tune'} size={20} color={Colors.primary}/><Text style={s.body}>Costs, fees and buying preferences</Text></Pressable>
    {expanded ? fields.slice(3).map(f=><View key={f.key} style={s.field}><Text style={s.label}>{f.label}</Text><TextInput accessibilityLabel={f.label} keyboardType="decimal-pad" style={s.input} value={flip.values[f.key]} onChangeText={value=>flip.update(f.key,value)} placeholder="0 / unknown" placeholderTextColor={Colors.textSecondary}/></View>) : null}
    {data ? <View style={s.result}>
      <Text style={s.title}>{data.verdict}</Text><Text style={s.body}>Flip score {data.score}/100 · {data.confidence.replace(/_/g,' ')}</Text>
      <Text style={s.money}>£{(data.conservative.profitAfterLabour ?? 0).toFixed(2)}</Text><Text style={s.body}>Conservative projected profit after labour</Text>
      <Text style={s.body}>Expected profit after labour: £{(data.expected.profitAfterLabour ?? 0).toFixed(2)}{ '\n' }Break-even resale price: {data.breakEvenPrice==null ? 'unavailable (zero sellable yield)' : '£'+data.breakEvenPrice.toFixed(2)}{ '\n' }Conservative maximum purchase: £{data.maxBuyPrice.toFixed(2)}{ '\n' }ROI before labour: {(data.conservative.roi*100).toFixed(0)}%{ '\n' }Time to sell: {data.holdingDays==null ? 'unknown' : data.holdingDays+' days (your assumption)'}</Text>
      {data.components.map(component=><Text key={component.label} style={s.body}>{component.label}: {component.points}/{component.max}</Text>)}
      {data.issues.map((issue,index)=><Text key={index} style={s.body}>{issue}</Text>)}
    </View> : null}
  </View>;
});
const s=StyleSheet.create({ card:{ padding:Spacing.base,gap:Spacing.md,backgroundColor:Colors.surface,borderRadius:Radius.lg,borderWidth:1,borderColor:Colors.surfaceBorder },row:{ flexDirection:'row',gap:Spacing.sm,alignItems:'center' },title:{ color:Colors.textPrimary,fontSize:Typography.size.lg,fontWeight:Typography.weight.bold,flex:1 },body:{ color:Colors.textSecondary,fontSize:Typography.size.base,lineHeight:26,includeFontPadding:false },label:{ color:Colors.textPrimary,fontSize:Typography.size.base,fontWeight:Typography.weight.medium },field:{ gap:Spacing.sm },input:{ minHeight:48,padding:Spacing.md,borderRadius:Radius.md,borderWidth:1,borderColor:Colors.info,backgroundColor:Colors.surfaceHighlight,color:Colors.textPrimary,fontSize:Typography.size.base,includeFontPadding:false },secondary:{ flexDirection:'row',gap:Spacing.sm,minHeight:48,alignItems:'center',padding:Spacing.md,borderRadius:Radius.md,backgroundColor:Colors.surfaceHighlight },linkText:{ color:Colors.info,fontSize:Typography.size.base,flex:1 },pressed:{ opacity:0.7 },flex:{ flex:1 },result:{ backgroundColor:Colors.primaryDim,borderRadius:Radius.md,padding:Spacing.base,gap:Spacing.sm },money:{ fontSize:Typography.size.xxxl,fontWeight:Typography.weight.bold,color:Colors.primary } });
