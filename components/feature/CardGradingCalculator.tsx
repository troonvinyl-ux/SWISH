import { memo } from 'react';
import { View,Text,TextInput,Pressable,FlatList,StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useCardGrading,GRADING_FIELDS } from '@/hooks/useCardGrading';
import { Colors,Spacing,Typography,Radius } from '@/constants/theme';
interface CardGradingCalculatorProps {}
const money=(value:number)=>`£${value.toFixed(2)}`;
export const CardGradingCalculator = memo(function CardGradingCalculator(_props:CardGradingCalculatorProps) {
  const calculator=useCardGrading(); const result=calculator.result;
  return <View style={s.content}>
    <View style={s.hero}><MaterialIcons name="style" size={32} color={Colors.primary}/><Text style={s.title}>Raw now or graded later?</Text><Text style={s.body}>Compare sale outcomes you enter, not an AI-predicted grade. Probabilities and prices are your assumptions, not verified market evidence.</Text></View>
    <View style={s.card}><Text style={s.section}>Costs and raw sale</Text><Text style={s.body}>All amounts in GBP. Selling fees apply to your sale price; assume no buyer-paid postage. Enter 0 where a cost does not apply. Include insurance premiums in shipping costs and all tax/surcharges in the grading fee.</Text>
      <FlatList scrollEnabled={false} data={GRADING_FIELDS} keyExtractor={field=>field.key} renderItem={({ item:field })=><View style={s.field}><Text style={s.label}>{field.label}</Text><TextInput accessibilityLabel={field.label} value={calculator.fields[field.key]} onChangeText={value=>calculator.setField(field.key,value)} keyboardType="decimal-pad" placeholder="Enter amount" placeholderTextColor={Colors.textSecondary} style={s.input}/></View>}/>
    </View>
    <View style={s.card}><Text style={s.section}>Your graded sale scenarios</Text><Text style={s.body}>Include lower-grade or ungraded returns. Probabilities must total exactly 100%. A returned card can still incur grading fees. Insurance does not eliminate damage, rejection or selling risk.</Text>
      <FlatList scrollEnabled={false} data={calculator.scenarios} keyExtractor={outcome=>outcome.id} renderItem={({ item:outcome })=><View style={s.outcome}>
        <Text style={s.label}>Outcome name</Text><TextInput accessibilityLabel={`Outcome name ${outcome.id}`} value={outcome.label} onChangeText={value=>calculator.setOutcome(outcome.id,'label',value)} style={s.input}/>
        <Text style={s.label}>Assumed sale price (£)</Text><TextInput accessibilityLabel={`Sale price for ${outcome.label}`} value={outcome.price} onChangeText={value=>calculator.setOutcome(outcome.id,'price',value)} keyboardType="decimal-pad" style={s.input} placeholder="Enter scenario price" placeholderTextColor={Colors.textSecondary}/>
        <Text style={s.label}>Assumed probability (%)</Text><TextInput accessibilityLabel={`Probability for ${outcome.label}`} value={outcome.probability} onChangeText={value=>calculator.setOutcome(outcome.id,'probability',value)} keyboardType="decimal-pad" style={s.input} placeholder="0 to 100" placeholderTextColor={Colors.textSecondary}/>
      </View>}/>
    </View>
    {calculator.error ? <View style={s.error} accessibilityRole="alert"><MaterialIcons name="error-outline" size={24} color={Colors.danger}/><Text style={[s.body,s.flex]}>{calculator.error}</Text></View> : null}
    <Pressable onPress={calculator.calculate} style={({ pressed })=>[s.button,pressed ? s.pressed : null]} accessibilityRole="button"><Text style={s.buttonText}>Compare my scenarios</Text></Pressable>
    {result ? <View style={s.card} accessibilityLiveRegion="polite"><Text style={s.section}>Scenario comparison</Text>
      <Text style={s.label}>Expected grading uplift over selling raw</Text><Text style={[s.value,{ color:result.uplift>0 ? Colors.success : Colors.warning }]}>{money(result.uplift)}</Text>
      <Text style={s.body}>{result.uplift>0 ? 'Grading has a higher probability-weighted return under your inputs.' : 'Selling raw has an equal or higher return under your inputs.'} This is not a recommendation or a guaranteed return.</Text>
      <Text style={s.body}>Raw net profit: {money(result.rawProfit)}</Text><Text style={s.body}>Graded expected net profit: {money(result.expectedProfit)}</Text>
      <Text style={s.body}>Grading + insured round-trip shipping: {money(result.gradingCosts)}</Text><Text style={s.body}>Holding + tied-up capital: {money(result.holdingCost)}</Text>
      <Text style={s.body}>Chance of beating raw (your probabilities): {(result.probabilityBeatRaw*100).toFixed(1)}%</Text>
      <Text style={s.body}>Possible outcome net range: {money(result.downsideProfit)} to {money(result.upsideProfit)}</Text>
      <Text style={s.body}>Graded gross price to break even: {money(result.breakEvenGross)}</Text><Text style={s.body}>Graded gross price to match raw profit: {money(result.rawEquivalentGross)}</Text>
      <FlatList scrollEnabled={false} data={result.outcomes} keyExtractor={outcome=>outcome.id} renderItem={({ item:outcome })=><View style={s.outcome}><Text style={s.section}>{outcome.label}</Text><Text style={s.body}>{(outcome.probability*100).toFixed(1)}% assumed · {money(outcome.salePrice)} gross</Text><Text style={s.body}>{money(outcome.profit)} net profit · {money(outcome.uplift)} versus raw</Text></View>}/>
      <Text style={s.body}>Holding costs use a 30-day month. Capital cost uses 365 days and purchase + grading + insured shipping. Sale fees are charged once per eventual sale, including ungraded returns. Professional grading, authenticity and time to sale are never promised.</Text>
    </View> : null}
  </View>;
});
const s=StyleSheet.create({ content:{ gap:Spacing.base },hero:{ gap:Spacing.md,padding:Spacing.xl,borderRadius:Radius.lg,backgroundColor:Colors.primaryDim },title:{ fontSize:Typography.size.xl,fontWeight:Typography.weight.bold,color:Colors.textPrimary },body:{ fontSize:Typography.size.base,lineHeight:26,color:Colors.textSecondary,includeFontPadding:false },section:{ fontSize:Typography.size.md,fontWeight:Typography.weight.semibold,color:Colors.textPrimary },card:{ padding:Spacing.base,gap:Spacing.md,borderRadius:Radius.lg,backgroundColor:Colors.surface },field:{ gap:Spacing.sm,paddingVertical:Spacing.sm },label:{ fontSize:Typography.size.base,color:Colors.textPrimary },input:{ minHeight:48,borderWidth:1,borderColor:Colors.textSecondary,borderRadius:Radius.md,padding:Spacing.md,color:Colors.textPrimary,fontSize:Typography.size.base,backgroundColor:Colors.surfaceHighlight,includeFontPadding:false },outcome:{ paddingVertical:Spacing.base,gap:Spacing.sm,borderTopWidth:1,borderTopColor:Colors.surfaceBorder },button:{ minHeight:48,alignItems:'center',justifyContent:'center',padding:Spacing.base,borderRadius:Radius.md,backgroundColor:Colors.primary },buttonText:{ color:Colors.textInverse,fontSize:Typography.size.base,fontWeight:Typography.weight.semibold },pressed:{ opacity:0.7,transform:[{ scale:0.99 }] },value:{ fontSize:Typography.size.xxxl,fontWeight:Typography.weight.bold },error:{ flexDirection:'row',gap:Spacing.sm,padding:Spacing.base,backgroundColor:Colors.dangerDim,borderRadius:Radius.md },flex:{ flex:1 } });
