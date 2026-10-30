import { memo,useState } from 'react';
import { View,Text,TextInput,Pressable,ActivityIndicator,StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import type { Item } from '@/services/itemService';
import { useSpecialistItemFields } from '@/hooks/useSpecialistItemFields';
import { Colors,Spacing,Typography,Radius } from '@/constants/theme';
interface SpecialistItemFieldsProps { item:Item;onUpdated:(updates:Partial<Item>)=>void }
export const SpecialistItemFields=memo(function SpecialistItemFields({ item,onUpdated }:SpecialistItemFieldsProps) {
  const fields=useSpecialistItemFields(item,onUpdated);const [expanded,setExpanded]=useState(false);
  if(!fields.profile) return null;
  return <View style={s.card}>
    <Pressable onPress={()=>setExpanded(value=>!value)} style={({ pressed })=>[s.toggle,pressed ? s.pressed : null]}><MaterialIcons name="fact-check" size={24} color={Colors.primary}/><Text style={s.heading}>Specialist fields</Text><MaterialIcons name={expanded ? 'expand-less' : 'expand-more'} size={24} color={Colors.primary}/></Pressable>
    <Text style={s.body}>{fields.profile.focus}</Text>
    {expanded ? <>
      <Text style={s.body}>Your edits are recorded as user-supplied, not independently verified. Identity, valuation and existing listing copy are not silently overwritten. Re-value or revise the draft after material corrections.</Text>
      {fields.profile.fields.map(field=><View key={field.key} style={s.field}><Text style={s.label}>{field.label}</Text><TextInput accessibilityLabel={field.label} style={s.input} value={fields.values[field.key] ?? ''} onChangeText={value=>fields.update(field.key,value)} editable={!fields.busy} maxLength={500} placeholder="Unknown / not measured" placeholderTextColor={Colors.textSecondary}/></View>)}
      {fields.error ? <Text style={s.body}>{fields.error}</Text> : null}
      {fields.saved ? <Text style={s.body}>Specialist fields saved to this item.</Text> : null}
      <Pressable disabled={fields.busy} onPress={()=>{ void fields.save(); }} style={({ pressed })=>[s.button,pressed || fields.busy ? s.pressed : null]}>{fields.busy ? <ActivityIndicator color={Colors.background}/> : <Text style={s.buttonText}>Save specialist corrections</Text>}</Pressable>
    </> : null}
  </View>;
});
const s=StyleSheet.create({ card:{ backgroundColor:Colors.surface,borderWidth:1,borderColor:Colors.surfaceBorder,borderRadius:Radius.lg,padding:Spacing.base,gap:Spacing.md },toggle:{ minHeight:48,flexDirection:'row',alignItems:'center',gap:Spacing.sm },heading:{ color:Colors.textPrimary,fontSize:Typography.size.lg,fontWeight:Typography.weight.bold,flex:1 },body:{ color:Colors.textSecondary,fontSize:Typography.size.base,lineHeight:26,includeFontPadding:false },field:{ gap:Spacing.sm },label:{ color:Colors.textPrimary,fontSize:Typography.size.base },input:{ color:Colors.textPrimary,fontSize:Typography.size.base,backgroundColor:Colors.surfaceHighlight,borderWidth:1,borderColor:Colors.info,borderRadius:Radius.md,minHeight:48,padding:Spacing.md,includeFontPadding:false },button:{ minHeight:48,padding:Spacing.base,alignItems:'center',backgroundColor:Colors.primary,borderRadius:Radius.md },buttonText:{ color:Colors.background,fontSize:Typography.size.base,fontWeight:Typography.weight.semibold },pressed:{ opacity:0.7 } });
