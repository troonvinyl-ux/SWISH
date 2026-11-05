import { memo } from 'react';
import { View,Text,TextInput,Pressable,StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors,Spacing,Typography,Radius } from '@/constants/theme';
import { PremiumStyles } from '@/constants/styles';
interface PremiumFieldProps {label:string;value:string;onChange:(value:string)=>void;numeric?:boolean;multiline?:boolean;disabled?:boolean;onGenerate?:()=>void;accent?:string;maxLength?:number}
export const PremiumField=memo(function PremiumField({label,value,onChange,numeric,multiline,disabled,onGenerate,accent=Colors.primary,maxLength}:PremiumFieldProps){return <View style={s.field}>
 <View style={s.row}><Text style={s.label}>{label}</Text>{onGenerate?<Pressable disabled={disabled} accessibilityLabel={`Generate ${label} with AI`} onPress={onGenerate} style={({pressed})=>[s.ai,pressed||disabled?{opacity:0.6}:null]}><MaterialIcons name="auto-awesome" size={16} color={accent}/><Text style={[s.aiText,{color:accent}]}>AI</Text></Pressable>:null}</View>
 <TextInput accessibilityLabel={label} value={value} onChangeText={onChange} editable={!disabled} keyboardType={numeric?'decimal-pad':'default'} multiline={multiline} maxLength={maxLength} style={[PremiumStyles.input,multiline?s.multiline:null]} placeholderTextColor={Colors.textSecondary}/>
 {maxLength?<Text style={s.count}>{value.length}/{maxLength}</Text>:null}
 </View>;});
const s=StyleSheet.create({field:{gap:Spacing.sm,flexGrow:1},row:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:Spacing.sm},label:{flex:1,color:Colors.textSecondary,fontSize:Typography.size.base,fontWeight:Typography.weight.medium},ai:{minHeight:48,minWidth:56,paddingHorizontal:Spacing.sm,borderRadius:Radius.md,backgroundColor:Colors.surfaceHighlight,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:Spacing.xs},aiText:{fontSize:Typography.size.sm,fontWeight:Typography.weight.semibold},multiline:{minHeight:128,textAlignVertical:'top',lineHeight:26},count:{fontSize:Typography.size.sm,color:Colors.textSecondary,textAlign:'right'}});
