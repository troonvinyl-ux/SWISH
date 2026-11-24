import { lazy, Suspense, memo, Component, type ReactNode } from 'react';
import { View, ActivityIndicator, StyleSheet, Text, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import type { ProductionNicheId } from '@/constants/niches';
import { Colors, Spacing, Typography, Radius } from '@/constants/theme';
import { useModuleTelemetry, useModuleFailure } from '@/hooks/useModuleTelemetry';
import { useUnifiedShell } from '@/hooks/useUnifiedShell';
import { useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { SwishFlipBrand } from '@/components/ui/SwishFlipBrand';
import { SWISHFLIP } from '@/constants/brand';
const Collectibles=lazy(()=>import('./CollectiblesDashboard').then(module=>({default:module.CollectiblesDashboard})));
const Dashboard=lazy(()=>import('./SharedNicheDashboard').then(module=>({default:module.SharedNicheDashboard})));
interface ModuleHomeProps { nicheId:ProductionNicheId }
function ModuleCommit({nicheId}:ModuleHomeProps){useModuleTelemetry(nicheId);return null;}
interface LoadBoundaryProps {children:ReactNode;onRetry:()=>void;onReturn:()=>void;canReturn:boolean;onFailure:()=>void}
class ModuleLoadBoundary extends Component<LoadBoundaryProps,{failed:boolean}>{
 state={failed:false};
 static getDerivedStateFromError(){return {failed:true};}
 componentDidCatch(){this.props.onFailure();}
 render(){return this.state.failed?<View style={s.loading}><Text style={s.title}>Specialist dashboard could not load</Text><Text style={s.body}>No inventory was changed. Retry this workspace or check the module failure log in Master Admin.</Text><Pressable onPress={this.props.onRetry} style={({pressed})=>[s.retry,pressed?s.pressed:null]}><Text style={s.title}>Retry workspace</Text></Pressable>{this.props.canReturn?<Pressable onPress={this.props.onReturn} style={({pressed})=>[s.retry,pressed?s.pressed:null]}><Text style={s.body}>Choose another workspace</Text></Pressable>:null}</View>:this.props.children;}
}
export const ModuleHome=memo(function ModuleHome({nicheId}:ModuleHomeProps){
 const shell=useUnifiedShell();const onFailure=useModuleFailure(nicheId);const router=useRouter();
 return <SafeAreaView edges={['top']} style={s.screen}>
  <StatusBar style="light" />
  <View style={s.brandBar}><SwishFlipBrand descriptor /><Text style={s.workspaceLabel}>SPECIALIST WORKSPACE</Text></View>
  {<Pressable accessibilityRole="button" disabled={!shell.accessReady} accessibilityLabel={nicheId==='collectibles'?'Scan an item: scan barcode first':`Scan an item with ${nicheId} specialist evidence`} onPress={()=>router.push('/(tabs)/scan')} style={({pressed})=>[s.quick,pressed?s.pressed:null]}><View style={s.quickIcon}><MaterialIcons name={nicheId==='coins'?'photo-camera':'qr-code-scanner'} size={23} color={Colors.textInverse}/></View><View style={s.quickCopy}><Text style={s.quickTitle}>{nicheId==='collectibles'?'Scan an item · Barcode first':nicheId==='coins'?'Scan an item · Capture coin':'Scan an item · Capture & identify'}</Text><Text style={s.quickText}>{SWISHFLIP.intelligence}</Text></View><MaterialIcons name="arrow-forward" size={21} color={Colors.textInverse}/></Pressable>}
  <ModuleLoadBoundary onFailure={onFailure} onRetry={()=>{void shell.enter(nicheId);}} onReturn={()=>{void shell.switchNiche();}} canReturn={shell.canSwitchNiche}>
  <Suspense fallback={<View style={s.loading}><ActivityIndicator color={Colors.primary}/><Text style={s.body}>Loading specialist dashboard…</Text></View>}>
   <ModuleCommit nicheId={nicheId}/>
   <View style={s.container} testID={`module-home-${nicheId}`} accessibilityLabel={`${nicheId} specialist dashboard`}>
    {nicheId==='collectibles'?<Collectibles embedded/>:<Dashboard nicheId={nicheId} embedded/>}
   </View>
  </Suspense>
 </ModuleLoadBoundary></SafeAreaView>;
});
const s=StyleSheet.create({screen:{flex:1,backgroundColor:Colors.background},brandBar:{minHeight:62,paddingHorizontal:Spacing.base,paddingVertical:Spacing.sm,flexDirection:'row',alignItems:'center',justifyContent:'space-between',backgroundColor:Colors.background,borderBottomWidth:1,borderBottomColor:Colors.surfaceBorder},workspaceLabel:{fontSize:Typography.size.xs,fontWeight:Typography.weight.bold,color:Colors.textTertiary,letterSpacing:1,includeFontPadding:false},quickCopy:{flex:1,flexShrink:1},quick:{minHeight:72,marginHorizontal:Spacing.base,marginVertical:Spacing.md,padding:Spacing.md,gap:Spacing.md,flexDirection:'row',alignItems:'center',borderRadius:Radius.lg,backgroundColor:Colors.primary},quickIcon:{width:42,height:42,alignItems:'center',justifyContent:'center',borderRadius:Radius.md,backgroundColor:'rgba(7,28,38,0.12)'},quickTitle:{fontSize:Typography.size.md,fontWeight:Typography.weight.bold,color:Colors.textInverse},quickText:{marginTop:2,fontSize:Typography.size.sm,color:Colors.textInverse},container:{flex:1},loading:{flex:1,justifyContent:'center',alignItems:'center',backgroundColor:Colors.background,padding:Spacing.base},title:{color:Colors.primary,fontSize:Typography.size.lg,fontWeight:Typography.weight.bold},body:{color:Colors.textSecondary,fontSize:Typography.size.base,lineHeight:26,padding:Spacing.base},retry:{padding:Spacing.base,minHeight:48},pressed:{opacity:0.7}});
