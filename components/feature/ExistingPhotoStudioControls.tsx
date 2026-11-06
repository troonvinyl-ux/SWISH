import { memo, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import type { ItemSmartStudioController } from '@/hooks/useItemSmartStudio';
import { Colors, Radius, Spacing, Typography } from '@/constants/theme';

interface ExistingPhotoStudioControlsProps {originalUri:string;studio:ItemSmartStudioController;accent:string;disabled?:boolean}
export const ExistingPhotoStudioControls=memo(function ExistingPhotoStudioControls({originalUri,studio,accent,disabled=false}:ExistingPhotoStudioControlsProps){
 const [showOriginal,setShowOriginal]=useState(false);
 const [previewError,setPreviewError]=useState(false);
 const result=studio.resultFor(originalUri);
 useEffect(()=>{setShowOriginal(false);setPreviewError(false);},[originalUri,result?.enhancedUri]);
 const progress=studio.progress;
 if(!studio.available)return null;
 return <View style={s.panel}>
  <View style={s.row}><MaterialIcons name="auto-fix-high" size={22} color={accent}/><Text style={s.title}>BackgroundErase</Text>{result?<Text style={[s.status,{color:result.status==='ready'?Colors.success:Colors.warning}]}>{result.status==='ready'?'Saved':'Review required'}</Text>:null}</View>
  <Text style={s.body}>Remove the background without redrawing the product. Valid cutouts carry forward; untouched originals remain available. Each uncached photo uses your provider account.</Text>
  {result?.enhancedUri?<>
   <View style={s.row}>
    <Pressable accessibilityRole="button" accessibilityState={{selected:!showOriginal}} onPress={()=>setShowOriginal(false)} style={({pressed})=>[s.segment,!showOriginal?{borderColor:accent}:null,pressed?s.pressed:null]}><Text style={s.buttonText}>Background removed</Text></Pressable>
    <Pressable accessibilityRole="button" accessibilityState={{selected:showOriginal}} onPress={()=>setShowOriginal(true)} style={({pressed})=>[s.segment,showOriginal?{borderColor:accent}:null,pressed?s.pressed:null]}><Text style={s.buttonText}>Original evidence</Text></Pressable>
   </View>
   <Image key={showOriginal?originalUri:result.enhancedUri} source={{uri:showOriginal?originalUri:result.enhancedUri}} contentFit="contain" transition={200} style={s.preview} accessibilityLabel={showOriginal?'Unchanged original photograph':'BackgroundErase cutout of the selected original'} onError={()=>setPreviewError(true)}/>
   {previewError?<Text accessibilityRole="alert" style={s.warning}>Preview could not load. The original is still available in the gallery above.</Text>:null}
   <Text style={s.body}>{result.status==='review'?'Review the product boundary and details; this result is not used automatically as the inventory cover.':'Clean photo saved for inventory and new listing selections. Live listings change only after a confirmed revision.'}</Text>
   <Text style={s.body}>No generative editing, relighting or restoration. Review fine edges, transparent areas, defects and lettering against the original.</Text>
  </>:null}
  <View style={s.row}>
   <Pressable accessibilityRole="button" accessibilityLabel="Remove the background of this saved original using BackgroundErase" disabled={disabled||studio.busy||!studio.canProcess(originalUri)||Boolean(result)} onPress={()=>void studio.processPhoto(originalUri)} style={({pressed})=>[s.action,{borderColor:accent},pressed||disabled||studio.busy||Boolean(result)?s.pressed:null]}><MaterialIcons name={result?'check-circle-outline':'auto-fix-high'} size={20} color={accent}/><Text style={[s.buttonText,{color:accent}]}>{result?'Cutout saved for this photo':'Process selected photo'}</Text></Pressable>
   <Pressable accessibilityRole="button" disabled={disabled||studio.busy} onPress={()=>void studio.processAll()} style={({pressed})=>[s.action,pressed||disabled||studio.busy?s.pressed:null]}><MaterialIcons name="collections" size={20} color={accent}/><Text style={s.buttonText}>Process all photos</Text></Pressable>
  </View>
  {studio.busy?<View style={s.row}><ActivityIndicator color={accent}/><Text accessibilityLiveRegion="polite" style={[s.body,s.flex]}>Processing photo {Math.min((progress?.done??0)+1,progress?.total??1)} of {progress?.total??1}…</Text><Pressable accessibilityRole="button" onPress={studio.cancel} style={({pressed})=>[s.cancel,pressed?s.pressed:null]}><Text style={s.buttonText}>Cancel</Text></Pressable></View>:null}
  {progress&&!studio.busy?<Text accessibilityLiveRegion="polite" style={s.body}>{progress.cancelled?'Stopped. Saved results retained. ':'Finished. '}{progress.ready} ready · {progress.review} need review · {progress.failed} failed{progress.reused?` · ${progress.reused} reused`:''}{progress.done<progress.total?` · ${progress.total-progress.done} unprocessed`:''}. Originals unchanged.</Text>:null}
  {studio.error?<View style={s.row}><MaterialIcons name="error-outline" size={20} color={Colors.warning}/><Text accessibilityRole="alert" style={[s.warning,s.flex]}>{studio.error}</Text></View>:null}
 </View>;
});
const s=StyleSheet.create({
 panel:{padding:Spacing.md,gap:Spacing.sm,backgroundColor:Colors.surfaceHighlight,borderWidth:1,borderColor:Colors.surfaceBorder,borderRadius:Radius.lg},
 row:{flexDirection:'row',flexWrap:'wrap',alignItems:'center',gap:Spacing.sm},flex:{flex:1},
 title:{flex:1,fontSize:Typography.size.base,fontWeight:Typography.weight.semibold,color:Colors.textPrimary},
 status:{fontSize:Typography.size.sm,fontWeight:Typography.weight.medium},
 body:{fontSize:Typography.size.base,color:Colors.textSecondary,lineHeight:26,includeFontPadding:false},
 warning:{fontSize:Typography.size.base,color:Colors.warning,lineHeight:26,includeFontPadding:false},
 segment:{flexGrow:1,minHeight:48,justifyContent:'center',alignItems:'center',paddingHorizontal:Spacing.sm,borderWidth:1,borderColor:Colors.surfaceBorder,borderRadius:Radius.md,backgroundColor:Colors.surface},
 preview:{height:240,width:'100%',borderRadius:Radius.md,backgroundColor:Colors.background},
 action:{flexGrow:1,minHeight:48,padding:Spacing.sm,borderWidth:1,borderColor:Colors.surfaceBorder,borderRadius:Radius.md,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:Spacing.sm,backgroundColor:Colors.surface},
 buttonText:{fontSize:Typography.size.base,fontWeight:Typography.weight.medium,color:Colors.textPrimary,flexShrink:1},
 cancel:{minHeight:48,paddingHorizontal:Spacing.md,borderRadius:Radius.md,justifyContent:'center',backgroundColor:Colors.surface},pressed:{opacity:0.6},
});
