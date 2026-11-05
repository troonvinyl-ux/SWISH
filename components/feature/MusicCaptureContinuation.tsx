import { memo } from 'react';
import { View,Text,Pressable,StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useApp } from '@/hooks/useApp';
import { useTunesCatalogue } from '@/hooks/useTunesCatalogue';
import { PremiumScanner } from './PremiumScanner';
import { Colors,Spacing,Typography,Radius } from '@/constants/theme';
interface MusicCaptureContinuationProps { onOpenItem?:()=>void }
/** A catalogue-only record already exists: continue on that canonical item rather than create a duplicate. */
export const MusicCaptureContinuation=memo(function MusicCaptureContinuation(_props:MusicCaptureContinuationProps){
 const {activeNicheId}=useApp();const tunes=useTunesCatalogue();const router=useRouter();
 if(activeNicheId!=='tunes_flip'||!tunes.state.savedId)return <PremiumScanner/>;
 return <SafeAreaView style={s.screen} edges={['top','bottom']}><View style={s.panel}><Text style={s.title}>Continue your saved release</Text><Text style={s.body}>This physical item already has a canonical inventory record. Add original photos, media/sleeve grades and playback notes there; do not scan it into a second record.</Text><Pressable onPress={()=>{_props.onOpenItem?.();router.replace(`/stock-listing/${tunes.state.savedId}` as any);}} style={({pressed})=>[s.button,pressed?s.pressed:null]}><Text style={s.dark}>Open existing music inventory item</Text></Pressable><Pressable disabled={tunes.state.busy} onPress={tunes.reset} style={({pressed})=>[s.secondary,pressed?s.pressed:null]}><Text style={s.body}>Identify a different physical item</Text></Pressable></View></SafeAreaView>;
});
const s=StyleSheet.create({screen:{flex:1,backgroundColor:Colors.background,padding:Spacing.base,justifyContent:'center'},panel:{padding:Spacing.base,gap:Spacing.base,maxWidth:960,width:'100%',alignSelf:'center',borderWidth:1,borderColor:Colors.gold,borderRadius:Radius.lg,backgroundColor:Colors.surface},title:{fontSize:Typography.size.xl,fontWeight:Typography.weight.bold,color:Colors.primary},body:{fontSize:Typography.size.base,lineHeight:26,color:Colors.textSecondary},button:{minHeight:48,padding:Spacing.base,borderRadius:Radius.md,backgroundColor:Colors.primary},dark:{fontSize:Typography.size.base,fontWeight:Typography.weight.semibold,color:Colors.textInverse},secondary:{minHeight:48,padding:Spacing.base,borderRadius:Radius.md,backgroundColor:Colors.surfaceHighlight},pressed:{opacity:0.7}});
