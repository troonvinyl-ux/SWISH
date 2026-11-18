import { memo, useState } from 'react';
import { View,Text,TextInput,FlatList,Pressable,StyleSheet,ActivityIndicator,Linking } from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { BarcodeInputButton } from './BarcodeInputButton';
import { MaterialIcons } from '@expo/vector-icons';
import { useTunesCatalogue } from '@/hooks/useTunesCatalogue';
import { useOwnerAuthorization } from '@/hooks/useOwnerAuthorization';
import type { DiscogsMode } from '@/services/discogsService';
import { Colors,Spacing,Radius,Typography } from '@/constants/theme';

interface MusicCataloguePanelProps { compact?:boolean }
const modes:Array<{id:DiscogsMode;label:string}>=[{id:'text',label:'Title'},{id:'barcode',label:'Barcode'},{id:'catalogue',label:'Catalogue no.'},{id:'artist_title',label:'Artist + title'}];
const candidateLimit=12;
const candidateLabel=(candidate:{country:string;year:string;format:string[];catalogueNumbers:string[]})=>{
 const releaseDetails=[candidate.country||'Country unknown',candidate.year||'Year unknown',candidate.format.filter(Boolean).join(', ')].filter(Boolean);
 const catalogueNumber=candidate.catalogueNumbers.filter(Boolean).join(' / ');
 return [...releaseDetails,catalogueNumber].filter(Boolean).join(' · ');
};

/** A compact chooser: Discogs helps prefill a seller's draft, it never certifies or vetoes a pressing. */
export const MusicCataloguePanel=memo(function MusicCataloguePanel({compact=false}:MusicCataloguePanelProps){
 const tunes=useTunesCatalogue();const {state}=tunes;const owner=useOwnerAuthorization();const release=state.release;const disabled=state.busy||!tunes.ready;
 const [showChoices,setShowChoices]=useState(false);
 const candidates=state.search?.results.slice(0,candidateLimit)??[];
 const openLink=(url:string)=>{void Linking.openURL(url).catch(()=>{});};
 const select=(id:number)=>{setShowChoices(false);void tunes.select(id);};
 return <View style={s.panel}>
  <View style={s.row}><MaterialIcons name="album" size={28} color={Colors.primary}/><View style={s.flex}><Text style={s.title}>Find the closest release</Text><Text style={s.body}>Scan the barcode or enter a catalogue number, then choose the closest Discogs version. You can edit every detail later.</Text></View></View>
  <View style={s.rail}><FlatList horizontal data={modes} showsHorizontalScrollIndicator={false} keyExtractor={x=>x.id} contentContainerStyle={s.chips} renderItem={({item})=><Pressable disabled={disabled} accessibilityState={{selected:state.mode===item.id}} onPress={()=>tunes.setMode(item.id)} style={({pressed})=>[s.chip,state.mode===item.id?s.selected:null,pressed?s.pressed:null]}><Text style={state.mode===item.id?s.dark:s.body}>{item.label}</Text></Pressable>}/></View>
  {state.mode==='artist_title'?<View style={s.block}><Text style={s.label}>Artist</Text><TextInput accessibilityLabel="Music artist" value={state.artist} onChangeText={tunes.setArtist} editable={!disabled} style={s.input}/></View>:null}
  <Text style={s.label}>{state.mode==='barcode'?'Printed barcode':state.mode==='catalogue'?'Catalogue number':state.mode==='artist_title'?'Release title':'Artist, title or music release'}</Text>
  <TextInput accessibilityLabel="Discogs search query" value={state.query} onChangeText={tunes.setQuery} onSubmitEditing={()=>void tunes.search()} editable={!disabled} autoCapitalize="none" keyboardType={state.mode==='barcode'?'number-pad':'default'} style={s.input}/>
  <View style={s.row}><Pressable disabled={disabled||state.query.trim().length<2} onPress={()=>void tunes.search()} style={({pressed})=>[s.button,pressed||disabled?s.pressed:null]}><Text style={s.dark}>Find releases</Text></Pressable><BarcodeInputButton disabled={disabled} label="Scan barcode" onValue={code=>{tunes.setMode('barcode');tunes.setQuery(code);void tunes.search(1,code);}}/></View>
  {state.busy?<ActivityIndicator color={Colors.primary}/>:null}
  {state.error?<View style={s.error}><MaterialIcons name="error-outline" size={24} color={Colors.danger}/><Text accessibilityRole="alert" style={[s.body,s.flex]}>{state.error}</Text></View>:null}
  {state.search&&(!release||showChoices)?<View style={s.block}>
   <Text style={s.label}>Choose the closest release</Text>
   <Text style={s.body}>Country, year, format and catalogue number make each pressing easy to compare. Choose the one that matches your record.</Text>
   <View style={s.pickerShell}><Picker accessibilityLabel="Choose Discogs release" enabled={!disabled&&candidates.length>0} selectedValue="" onValueChange={value=>{const id=Number(value);if(Number.isSafeInteger(id)&&id>0)select(id);}} dropdownIconColor={Colors.textPrimary} style={s.picker}>
    <Picker.Item label={candidates.length?`Select one of ${candidates.length} release options`:'No matching releases'} value="" color={Colors.textSecondary}/>
    {candidates.map(item=><Picker.Item key={item.id} label={candidateLabel(item)} value={String(item.id)} color={Colors.textPrimary}/>) }
   </Picker></View>
   {candidates.length?<Text style={s.hint}>Showing {candidates.length} of {state.search.total} matches. The release title is your search; these lines distinguish the variations.</Text>:<Text style={s.body}>No release matches. Try the printed catalogue number or title.</Text>}
   <View style={s.row}><Pressable disabled={disabled||state.search.page<=1} onPress={()=>void tunes.search(state.search!.page-1)} style={({pressed})=>[s.secondary,pressed?s.pressed:null]}><Text style={s.body}>Previous</Text></Pressable><Pressable disabled={disabled||state.search.page>=state.search.pages} onPress={()=>void tunes.search(state.search!.page+1)} style={({pressed})=>[s.secondary,pressed?s.pressed:null]}><Text style={s.body}>More releases</Text></Pressable></View>
  </View>:null}
  {release?<View style={s.selectedRelease}>
   <View style={s.row}><MaterialIcons name="check-circle" size={24} color={Colors.success}/><Text style={s.label}>Selected to prefill the draft</Text></View>
   <Text style={s.title}>{release.artist}</Text><Text style={s.label}>{release.releaseTitle}</Text>
   <Text style={s.body}>{[release.country,release.year,release.format.join(' · ')].filter(Boolean).join(' · ')}</Text>
   <Text style={s.body}>{[release.labels.join(' / '),release.catalogueNumbers.join(' / ')].filter(Boolean).join(' · ')}</Text>
   <Text style={s.body}>This is your closest-match selection, not a claim that Discogs or the photos have proven the exact pressing. Your original photos stay with the listing; they do not block this choice.</Text>
   <View style={s.row}><Pressable disabled={disabled} onPress={()=>setShowChoices(true)} style={({pressed})=>[s.secondary,pressed?s.pressed:null]}><Text style={s.body}>Choose a different release</Text></Pressable><Pressable onPress={()=>openLink(release.url)} style={({pressed})=>[s.secondary,pressed?s.pressed:null]}><Text style={s.link}>Discogs release #{release.id}</Text></Pressable></View>
  </View>:null}
  {!compact?<Text style={s.body}>Data provided by Discogs. Tunes Flip is not affiliated with, sponsored by or endorsed by Discogs. No Discogs prices, artwork or private-account data is used.</Text>:null}
  {!compact&&owner.allowed?<View style={s.admin}><Text style={s.label}>Owner-only Discogs setup</Text><Text style={s.body}>OnSpace → Cloud → Secrets: DISCOGS_CONSUMER_KEY, DISCOGS_CONSUMER_SECRET and DISCOGS_USER_AGENT. Never enter secrets in a listing field.</Text><View style={s.row}><Pressable disabled={disabled} onPress={()=>void tunes.inspectSetup()} style={({pressed})=>[s.secondary,pressed?s.pressed:null]}><Text style={s.body}>Check configuration</Text></Pressable><Pressable disabled={disabled} onPress={()=>void tunes.testConnection()} style={({pressed})=>[s.secondary,pressed?s.pressed:null]}><Text style={s.body}>Test connection</Text></Pressable></View>{state.setup?<Text style={s.body}>{state.setup.configured?'Required secrets present (values hidden)':'Missing: '+state.setup.missing.join(', ')}.</Text>:null}{state.connection?<Text style={s.body}>{state.connection}</Text>:null}</View>:null}
 </View>;
});

const s=StyleSheet.create({panel:{padding:Spacing.base,gap:Spacing.md,borderRadius:Radius.lg,borderWidth:1,borderColor:Colors.gold,backgroundColor:Colors.surface},block:{gap:Spacing.sm},row:{flexDirection:'row',flexWrap:'wrap',alignItems:'center',gap:Spacing.sm},flex:{flex:1},title:{fontSize:Typography.size.lg,fontWeight:Typography.weight.bold,color:Colors.textPrimary},label:{fontSize:Typography.size.base,fontWeight:Typography.weight.semibold,color:Colors.textPrimary},body:{fontSize:Typography.size.base,lineHeight:24,color:Colors.textSecondary,includeFontPadding:false},hint:{fontSize:Typography.size.sm,lineHeight:20,color:Colors.textSecondary,includeFontPadding:false},input:{minHeight:48,padding:Spacing.md,color:Colors.textPrimary,fontSize:Typography.size.base,borderWidth:1,borderColor:Colors.surfaceBorder,borderRadius:Radius.md,backgroundColor:Colors.surfaceHighlight},rail:{minHeight:56},chips:{gap:Spacing.sm,alignItems:'center'},chip:{height:48,paddingHorizontal:Spacing.base,borderRadius:Radius.pill,justifyContent:'center',backgroundColor:Colors.surfaceHighlight},selected:{backgroundColor:Colors.primary},button:{minHeight:48,padding:Spacing.md,backgroundColor:Colors.primary,borderRadius:Radius.md,justifyContent:'center'},dark:{color:Colors.textInverse,fontSize:Typography.size.base,fontWeight:Typography.weight.semibold},secondary:{minHeight:48,padding:Spacing.md,borderRadius:Radius.md,backgroundColor:Colors.surfaceHighlight,flexDirection:'row',alignItems:'center',gap:Spacing.sm},link:{color:Colors.primary,fontSize:Typography.size.base},pickerShell:{minHeight:56,borderWidth:1,borderColor:Colors.surfaceBorder,borderRadius:Radius.md,backgroundColor:Colors.surfaceHighlight,justifyContent:'center',overflow:'hidden'},picker:{height:56,color:Colors.textPrimary},selectedRelease:{padding:Spacing.md,gap:Spacing.sm,borderRadius:Radius.md,backgroundColor:Colors.successDim,borderWidth:1,borderColor:Colors.success},admin:{gap:Spacing.md,padding:Spacing.md,borderRadius:Radius.md,backgroundColor:Colors.primaryDim},error:{flexDirection:'row',gap:Spacing.sm,padding:Spacing.md,backgroundColor:Colors.dangerDim},pressed:{opacity:0.7}});
