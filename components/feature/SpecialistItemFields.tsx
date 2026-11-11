import { memo,useState } from 'react';
import { View,Text,TextInput,Pressable,ActivityIndicator,StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import type { Item } from '@/services/itemService';
import { BarcodeInputButton } from './BarcodeInputButton';
import { useSpecialistItemFields } from '@/hooks/useSpecialistItemFields';
import { Colors,Spacing,Typography,Radius } from '@/constants/theme';
// Initially-expanded specialist review is part of the shared public component contract.
export interface SpecialistItemFieldsProps { item:Item;onUpdated:(updates:Partial<Item>)=>void; initiallyExpanded?:boolean }
export const SpecialistItemFields=memo(function SpecialistItemFields({ item,onUpdated,initiallyExpanded=false }:SpecialistItemFieldsProps) {
  const fields=useSpecialistItemFields(item,onUpdated);const [expanded,setExpanded]=useState(initiallyExpanded);
  if(!fields.profile) return null;
  return <View style={s.card}>
    <Pressable onPress={()=>setExpanded(value=>!value)} style={({ pressed })=>[s.toggle,pressed ? s.pressed : null]}><MaterialIcons name="fact-check" size={24} color={Colors.primary}/><Text style={s.heading}>Specialist fields</Text><MaterialIcons name={expanded ? 'expand-less' : 'expand-more'} size={24} color={Colors.primary}/></Pressable>
    <Text style={s.body}>{fields.profile.focus}</Text>
    {expanded ? <>
      <Text style={s.body}>Your edits are recorded as user-supplied, not independently verified. Identity, valuation and existing listing copy are not silently overwritten. Re-value or revise the draft after material corrections.</Text>
      {fields.profile.nicheId==='stamps'?<View style={s.field}><Text style={s.label}>Quick usage notes (does not certify gum)</Text><View style={s.presets}>{['Unused','Used','CTO'].map(value=><Pressable key={value} disabled={fields.busy} accessibilityRole="button" accessibilityState={{selected:fields.values.usage===value}} onPress={()=>fields.update('usage',value)} style={({pressed})=>[s.preset,fields.values.usage===value?s.selected:null,pressed?s.pressed:null]}><Text style={[s.label,fields.values.usage===value?{color:Colors.textInverse}:null]}>{value}</Text></Pressable>)}</View><Text style={s.body}>AI variety suggestions remain in the saved analysis. Only enter catalogue, gum or watermark details you have checked yourself; saving is not certification.</Text></View>:null}
      {fields.profile.fields.map(field=><View key={field.key} style={s.field}><Text style={s.label}>{field.label}</Text><TextInput accessibilityLabel={field.label} style={s.input} value={fields.values[field.key] ?? ''} onChangeText={value=>fields.update(field.key,value)} editable={!fields.busy} maxLength={500} placeholder="Unknown / not measured" placeholderTextColor={Colors.textSecondary}/>{/barcode|ean|upc|isbn/i.test(field.key)?<BarcodeInputButton disabled={fields.busy} onValue={code=>fields.update(field.key,code)}/>:null}</View>)}
      {fields.error ? <Text style={s.body}>{fields.error}</Text> : null}
      {fields.saved ? <Text style={s.body}>Specialist fields saved to this item.</Text> : null}
      <Pressable disabled={fields.busy} onPress={()=>{ void fields.save(); }} style={({ pressed })=>[s.button,pressed || fields.busy ? s.pressed : null]}>{fields.busy ? <ActivityIndicator color={Colors.background}/> : <Text style={s.buttonText}>Save specialist corrections</Text>}</Pressable>
    </> : null}
  </View>;
});
const s=StyleSheet.create({ presets:{flexDirection:'row',flexWrap:'wrap',gap:Spacing.sm},preset:{minHeight:48,paddingHorizontal:Spacing.base,borderRadius:Radius.pill,justifyContent:'center',backgroundColor:Colors.surfaceHighlight},selected:{backgroundColor:Colors.primary},card:{ backgroundColor:Colors.surface,borderWidth:1,borderColor:Colors.surfaceBorder,borderRadius:Radius.lg,padding:Spacing.base,gap:Spacing.md },toggle:{ minHeight:48,flexDirection:'row',alignItems:'center',gap:Spacing.sm },heading:{ color:Colors.textPrimary,fontSize:Typography.size.lg,fontWeight:Typography.weight.bold,flex:1 },body:{ color:Colors.textSecondary,fontSize:Typography.size.base,lineHeight:26,includeFontPadding:false },field:{ gap:Spacing.sm },label:{ color:Colors.textPrimary,fontSize:Typography.size.base },input:{ color:Colors.textPrimary,fontSize:Typography.size.base,backgroundColor:Colors.surfaceHighlight,borderWidth:1,borderColor:Colors.info,borderRadius:Radius.md,minHeight:48,padding:Spacing.md,includeFontPadding:false },button:{ minHeight:48,padding:Spacing.base,alignItems:'center',backgroundColor:Colors.primary,borderRadius:Radius.md },buttonText:{ color:Colors.background,fontSize:Typography.size.base,fontWeight:Typography.weight.semibold },pressed:{ opacity:0.7 } });
