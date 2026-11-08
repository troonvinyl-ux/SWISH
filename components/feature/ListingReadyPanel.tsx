
import { memo, useState } from 'react';
import { View, Text, FlatList, StyleSheet, Pressable } from 'react-native';
import { Image } from 'expo-image';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors, Spacing, Radius, Typography } from '@/constants/theme';
import { PremiumField } from '@/components/ui/PremiumField';
import { MarketValueSummary } from './MarketValueSummary';
import { EbayConditionPicker } from './EbayConditionPicker';
import { ListingItemSpecifics } from './ListingItemSpecifics';
import { descriptionText } from '@/shared/ebayRevisionContract';
import type { MarketValueResult } from '@/services/marketValueService';
import type { AntiqueAspect, AntiqueConditionPolicy } from '@/shared/antiqueListingPolicy';
export interface ListingReadyPanelProps {title:string;price:string;description:string;photos:string[];categoryName:string;conditionId:string;conditionNotes:string;quantity:number;specifics:Array<{name:string;value:string}>;aspects:AntiqueAspect[];conditions:AntiqueConditionPolicy;market?:MarketValueResult|null;marketValue?:number;busy:boolean;onEdit:(key:'title'|'price'|'description'|'conditionId'|'conditionNotes',value:string)=>void;onSpecifics:(values:Array<{name:string;value:string}>)=>void}
export const ListingReadyPanel=memo(function ListingReadyPanel(props:ListingReadyPanelProps){
 const [expanded,setExpanded]=useState(false);const condition=props.conditions.itemConditions.find(row=>String(row.conditionId)===props.conditionId)?.conditionDescription;
 const missing=props.aspects.filter(aspect=>aspect.required&&!props.specifics.some(row=>row.name===aspect.name&&row.value.trim()));
 return <View style={s.content}><View style={s.hero}>{props.photos[0]?<Image source={{uri:props.photos[0]}} transition={200} contentFit="contain" style={s.cover}/>:<View style={s.cover}/>}<View style={s.copy}><Text style={s.eyebrow}>YOUR EBAY LISTING</Text><Text style={s.title}>{props.title}</Text><Text style={s.body}>{props.categoryName||'Category needed'} · {props.quantity} {props.quantity===1?'item':'items'}</Text><Text style={s.body}>{condition||props.conditionNotes||'Condition not established'}</Text></View></View>
 <PremiumField label="Listing price (£)" value={props.price} onChange={value=>props.onEdit('price',value)} numeric disabled={props.busy}/>
 <MarketValueSummary result={props.market} value={props.marketValue}/>
 {props.photos.length>1?<View style={s.rail}><FlatList horizontal showsHorizontalScrollIndicator={false} data={props.photos} keyExtractor={uri=>uri} contentContainerStyle={s.photos} renderItem={({item:uri})=><Image source={{uri}} transition={200} contentFit="contain" style={s.thumbnail}/>}/></View>:null}
 <Text numberOfLines={expanded?undefined:3} style={s.body}>{descriptionText(props.description)}</Text>
 <Pressable accessibilityRole="button" accessibilityState={{expanded}} onPress={()=>setExpanded(value=>!value)} style={({pressed})=>[s.edit,pressed?s.pressed:null]}><MaterialIcons name={expanded?'expand-less':'edit'} size={22} color={Colors.primary}/><Text style={s.editText}>{expanded?'Hide details':'Edit details'}</Text></Pressable>
 {!props.conditionId&&props.conditions.itemConditions.length? <EbayConditionPicker policy={props.conditions} selected={props.conditionId} onSelect={value=>props.onEdit('conditionId',value)} accent={Colors.primary} disabled={props.busy}/>:null}
 {missing.length&&!expanded?<ListingItemSpecifics specifics={props.specifics.filter(row=>missing.some(aspect=>aspect.name===row.name))} aspects={missing} accent={Colors.primary} disabled={props.busy} onChange={values=>props.onSpecifics([...props.specifics.filter(row=>!missing.some(aspect=>aspect.name===row.name)),...values])}/>:null}
 {expanded?<View style={s.details}><PremiumField label="Title" value={props.title} onChange={value=>props.onEdit('title',value)} maxLength={80} disabled={props.busy}/><PremiumField label="Description" value={props.description} onChange={value=>props.onEdit('description',value)} multiline disabled={props.busy}/><PremiumField label="Condition notes" value={props.conditionNotes} onChange={value=>props.onEdit('conditionNotes',value)} multiline disabled={props.busy}/><EbayConditionPicker policy={props.conditions} selected={props.conditionId} onSelect={value=>props.onEdit('conditionId',value)} accent={Colors.primary} disabled={props.busy}/><ListingItemSpecifics specifics={props.specifics} aspects={props.aspects} accent={Colors.primary} disabled={props.busy} onChange={props.onSpecifics}/></View>:null}
 </View>;
});
const s=StyleSheet.create({content:{gap:Spacing.base},hero:{flexDirection:'row',gap:Spacing.md,alignItems:'center',padding:Spacing.base,borderRadius:Radius.lg,backgroundColor:Colors.primaryDim},cover:{width:88,height:112,borderRadius:Radius.md,backgroundColor:Colors.surface},copy:{flex:1,minWidth:0,gap:Spacing.sm},eyebrow:{fontSize:Typography.size.sm,color:Colors.primary,fontWeight:Typography.weight.semibold},title:{fontSize:Typography.size.lg,lineHeight:28,fontWeight:Typography.weight.bold,color:Colors.textPrimary},body:{fontSize:Typography.size.base,lineHeight:26,color:Colors.textSecondary},rail:{height:88},photos:{gap:Spacing.sm},thumbnail:{width:80,height:80,borderRadius:Radius.sm,backgroundColor:Colors.surfaceHighlight},edit:{minHeight:48,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:Spacing.sm,borderRadius:Radius.md,borderWidth:1,borderColor:Colors.surfaceBorder},editText:{fontSize:Typography.size.base,fontWeight:Typography.weight.semibold,color:Colors.primary},details:{gap:Spacing.base},pressed:{opacity:0.65}});
