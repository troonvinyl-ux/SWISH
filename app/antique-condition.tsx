import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, TextInput, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { useApp } from '@/hooks/useApp';
import { getItem, updateItem, type Item } from '@/services/itemService';
import { Spacing, Typography, Radius } from '@/constants/theme';
const GOLD='#D8AD52';
const GRADES=[['Mint','As new; no visible wear'],['Excellent','Very light signs of handling or age'],['Good','Normal age-related wear; sound overall'],['Fair','Visible wear, damage or repairs'],['Poor','Significant damage, losses or restoration needed']];
export default function AntiqueConditionScreen(){
 const {id}=useLocalSearchParams<{id:string}>();const router=useRouter();const {tenant}=useApp();
 const [item,setItem]=useState<Item|null>(null);const [grade,setGrade]=useState('Good');const [notes,setNotes]=useState('');const [loading,setLoading]=useState(true);const [saving,setSaving]=useState(false);const [error,setError]=useState('');
 useEffect(()=>{let live=true;(async()=>{if(!id){setError('An inventory item is required.');setLoading(false);return;}const r=await getItem(id);if(!live)return;if(r.error||!r.item){setError(r.error??'Item not found.');setLoading(false);return;}if(!['antiques','books'].includes(r.item.specialistId)){setError('This item is not in Antique Flipper inventory.');setLoading(false);return;}setItem(r.item);setGrade(r.item.conditionGrade||r.item.condition||'Good');setNotes(r.item.conditionNotes||'');setLoading(false);})();return()=>{live=false;};},[id]);
 const save=async()=>{if(!id||!tenant?.id||!item)return;setSaving(true);setError('');const r=await updateItem(id,{condition:grade,conditionGrade:grade,conditionNotes:notes},tenant.id);setSaving(false);if(r.error){setError(r.error);return;}router.replace(('/stock-listing/'+id) as any);};
 return <SafeAreaView style={s.screen}><ScrollView contentContainerStyle={s.content}>
 <Pressable onPress={()=>router.back()} style={s.back}><MaterialIcons name="arrow-back" size={21} color={GOLD}/><Text style={s.backText}>BACK</Text></Pressable>
 <Text style={s.eyebrow}>ANTIQUE FLIPPER · ITEM ASSESSMENT</Text><Text style={s.title}>Condition Assessment</Text>
 {loading?<ActivityIndicator color={GOLD}/>:item?<><Text style={s.itemTitle}>{item.canonicalTitle}</Text><Text style={s.hint}>Choose the closest visible condition. This is a seller assessment, not professional authentication or a conservation report.</Text>
 {GRADES.map(([name,desc])=><Pressable key={name} onPress={()=>setGrade(name)} style={[s.grade,grade===name&&s.selected]}><MaterialIcons name={grade===name?'radio-button-checked':'radio-button-unchecked'} size={21} color={grade===name?GOLD:'#8A806D'}/><View style={{flex:1,gap:3}}><Text style={s.gradeTitle}>{name}</Text><Text style={s.hint}>{desc}</Text></View></Pressable>)}
 <Text style={s.label}>Damage, repairs and observations</Text><TextInput value={notes} onChangeText={setNotes} multiline placeholder="Record chips, cracks, hairlines, wear, corrosion, replacements, repairs and where they appear…" placeholderTextColor="#827966" style={s.input}/>
 <View style={s.warning}><MaterialIcons name="info-outline" size={19} color={GOLD}/><Text style={s.hint}>Photographs cannot establish structural stability, originality or hidden repairs. Do not polish, sand or use chemicals on unknown antique materials.</Text></View>
 <Pressable disabled={saving} onPress={save} style={s.button}>{saving?<ActivityIndicator color="#17120A"/>:<Text style={s.buttonText}>SAVE CONDITION</Text>}</Pressable>
 </>:null}
 {error?<Text style={s.error}>{error}</Text>:null}
 </ScrollView></SafeAreaView>;
}
const s=StyleSheet.create({screen:{flex:1,backgroundColor:'#090806'},content:{padding:Spacing.base,gap:Spacing.md,paddingBottom:40},back:{flexDirection:'row',alignItems:'center',gap:8,paddingVertical:8},backText:{fontSize:10,color:GOLD,fontWeight:'900',letterSpacing:1},eyebrow:{fontSize:9,color:GOLD,fontWeight:'900',letterSpacing:1.5,marginTop:12},title:{fontSize:28,color:'#F4D58A',fontWeight:'900'},itemTitle:{fontSize:Typography.size.base,color:'#F4E9D4',fontWeight:'800'},hint:{fontSize:Typography.size.xs,color:'#B9B09F',lineHeight:19},grade:{flexDirection:'row',alignItems:'center',gap:Spacing.md,padding:Spacing.md,backgroundColor:'#17130D',borderWidth:1,borderColor:'#554322',borderRadius:Radius.lg},selected:{borderColor:GOLD,backgroundColor:'#2B2110'},gradeTitle:{fontSize:Typography.size.sm,color:'#F4E9D4',fontWeight:'800'},label:{fontSize:Typography.size.sm,color:GOLD,fontWeight:'800'},input:{minHeight:112,textAlignVertical:'top',padding:Spacing.md,borderRadius:Radius.md,borderWidth:1,borderColor:'#554322',backgroundColor:'#17130D',color:'#F4E9D4'},warning:{flexDirection:'row',gap:Spacing.sm,padding:Spacing.md,backgroundColor:'#28200F',borderRadius:Radius.md},button:{minHeight:50,alignItems:'center',justifyContent:'center',backgroundColor:'#E7B94D',borderRadius:Radius.md,padding:Spacing.md},buttonText:{color:'#17120A',fontSize:11,fontWeight:'900',letterSpacing:1},error:{color:'#FCA5A5',fontSize:12}});
