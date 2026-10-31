import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { useApp } from '@/hooks/useApp';
import { getItem, type Item } from '@/services/itemService';
import { getMarketValue, type MarketValueResult } from '@/services/marketValueService';
import { Spacing, Typography, Radius } from '@/constants/theme';
const GOLD='#D8AD52';const gbp=(n:number)=>Number.isFinite(n)&&n>0?'£'+n.toFixed(2):'—';
export default function AntiqueValueScreen(){
 const {id}=useLocalSearchParams<{id:string}>();const router=useRouter();const {tenant}=useApp();
 const [item,setItem]=useState<Item|null>(null);const [result,setResult]=useState<MarketValueResult|null>(null);const [loading,setLoading]=useState(true);const [valuing,setValuing]=useState(false);const [error,setError]=useState('');
 useEffect(()=>{let live=true;(async()=>{if(!id){setError('An inventory item is required.');setLoading(false);return;}const r=await getItem(id);if(!live)return;if(r.error||!r.item){setError(r.error??'Item not found.');setLoading(false);return;}if(!['antiques','books'].includes(r.item.specialistId)){setError('This item is not in Antique Flipper inventory.');setLoading(false);return;}setItem(r.item);setLoading(false);})();return()=>{live=false;};},[id]);
 const value=async()=>{if(!item||!tenant?.id)return;setValuing(true);setError('');const r=await getMarketValue({tenantId:tenant.id,itemId:item.id,title:item.canonicalTitle,specialistId:'antiques',attributes:item.attributes??{},condition:item.condition??'',identificationConfidence:item.identificationConfidence??0.5,applyToItem:true,imageUrls:item.media??[]});setValuing(false);if(r.error||!r.result){setError(r.error??'Valuation could not be completed.');return;}setResult(r.result);};
 return <SafeAreaView style={s.screen}><ScrollView contentContainerStyle={s.content}>
 <Pressable onPress={()=>router.back()} style={s.back}><MaterialIcons name="arrow-back" size={21} color={GOLD}/><Text style={s.backText}>BACK</Text></Pressable>
 <Text style={s.eyebrow}>ANTIQUE FLIPPER · MARKET INTELLIGENCE</Text><Text style={s.title}>Market Value</Text>
 {loading?<ActivityIndicator color={GOLD}/>:item?<><Text style={s.itemTitle}>{item.canonicalTitle}</Text><Text style={s.hint}>Uses the shared SWISH valuation service. Completed sales, active asking prices and AI estimates remain separate evidence types.</Text>
 <Pressable disabled={valuing} onPress={value} style={s.button}>{valuing?<ActivityIndicator color="#17120A"/>:<Text style={s.buttonText}>{result?'REFRESH VALUATION':'GET MARKET VALUATION'}</Text>}</Pressable>
 {result?<><View style={s.valueCard}><Text style={s.label}>ESTIMATED MARKET RANGE</Text><Text style={s.value}>{gbp(result.valuation.valuationLow)} – {gbp(result.valuation.valuationHigh)}</Text><Text style={s.hint}>Midpoint {gbp(result.valuation.valuationMid)} · Confidence {result.valuation.valuationConfidence}</Text></View>
 <View style={s.card}><Text style={s.cardTitle}>Verified completed sales</Text><Text style={s.value}>{result.soldMarket.verifiedSoldCount}</Text><Text style={s.hint}>{result.soldMarket.dataQualityReason||'Completed-sale evidence returned by the valuation service.'}</Text><Text style={s.cardTitle}>Sold median</Text><Text style={s.value}>{gbp(result.soldMarket.medianPrice)}</Text></View>
 <View style={s.card}><Text style={s.cardTitle}>Current asking prices</Text><Text style={s.value}>{result.activeAskingPrices.count}</Text><Text style={s.hint}>{result.activeAskingPrices.note}</Text><Text style={s.cardTitle}>Median asking price</Text><Text style={s.value}>{gbp(result.activeAskingPrices.medianAskingPrice)}</Text></View>
 <View style={s.valueCard}><Text style={s.label}>RECOMMENDED LISTING PRICE</Text><Text style={s.value}>{gbp(result.valuation.recommendedListingPrice)}</Text><Text style={s.hint}>{result.valuation.listingPriceRationale}</Text></View>
 <Pressable onPress={()=>router.push(('/create-listing?id='+item.id) as any)} style={s.secondary}><Text style={s.secondaryText}>CREATE EBAY LISTING →</Text></Pressable>
 </>:null}
 </>:null}
 {error?<Text style={s.error}>{error}</Text>:null}
 </ScrollView></SafeAreaView>;
}
const s=StyleSheet.create({screen:{flex:1,backgroundColor:'#090806'},content:{padding:Spacing.base,gap:Spacing.md,paddingBottom:40},back:{flexDirection:'row',alignItems:'center',gap:8,paddingVertical:8},backText:{fontSize:10,color:GOLD,fontWeight:'900',letterSpacing:1},eyebrow:{fontSize:9,color:GOLD,fontWeight:'900',letterSpacing:1.5,marginTop:12},title:{fontSize:28,color:'#F4D58A',fontWeight:'900'},itemTitle:{fontSize:Typography.size.base,color:'#F4E9D4',fontWeight:'800'},hint:{fontSize:Typography.size.xs,color:'#B9B09F',lineHeight:19},button:{minHeight:50,alignItems:'center',justifyContent:'center',backgroundColor:'#E7B94D',borderRadius:Radius.md,padding:Spacing.md},buttonText:{color:'#17120A',fontSize:11,fontWeight:'900',letterSpacing:1},valueCard:{padding:Spacing.md,backgroundColor:'#211A0D',borderRadius:Radius.lg,borderWidth:1,borderColor:GOLD,gap:5},label:{fontSize:9,color:GOLD,fontWeight:'900',letterSpacing:1},value:{fontSize:24,color:'#F4D58A',fontWeight:'900'},card:{padding:Spacing.md,backgroundColor:'#17130D',borderWidth:1,borderColor:'#554322',borderRadius:Radius.lg,gap:6},cardTitle:{fontSize:Typography.size.sm,color:'#F4E9D4',fontWeight:'800'},secondary:{minHeight:48,borderRadius:Radius.md,borderWidth:1,borderColor:GOLD,alignItems:'center',justifyContent:'center'},secondaryText:{color:GOLD,fontSize:11,fontWeight:'900',letterSpacing:1},error:{color:'#FCA5A5',fontSize:12}});
