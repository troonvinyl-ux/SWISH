import { lazy, Suspense, memo, Component, type ReactNode } from 'react';
import { View, ActivityIndicator, StyleSheet, Text, Pressable } from 'react-native';
import type { ProductionNicheId } from '@/constants/niches';
import { Colors, Spacing, Typography } from '@/constants/theme';
import { useModuleTelemetry, useModuleFailure } from '@/hooks/useModuleTelemetry';
import { useUnifiedShell } from '@/hooks/useUnifiedShell';
const Coins=lazy(()=>import('@/app/coin-flipper'));
const MX=lazy(()=>import('@/app/flipper-mx'));
const Bikes=lazy(()=>import('@/app/bike-flipper'));
const Threads=lazy(()=>import('@/app/threads-flip'));
const Surplus=lazy(()=>import('@/app/surplus-flip'));
const Antiques=lazy(()=>import('@/app/antique-flipper'));
const Collectibles=lazy(()=>import('./CollectiblesDashboard').then(module=>({default:module.CollectiblesDashboard})));
const Overview=lazy(()=>import('./NicheOverview').then(module=>({default:module.NicheOverview})));
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
 const shell=useUnifiedShell();const onFailure=useModuleFailure(nicheId);
 return <ModuleLoadBoundary onFailure={onFailure} onRetry={()=>{void shell.enter(nicheId);}} onReturn={()=>{void shell.switchNiche();}} canReturn={shell.canSwitchNiche}>
  <Suspense fallback={<View style={s.loading}><ActivityIndicator color={Colors.primary}/><Text style={s.body}>Loading specialist dashboard…</Text></View>}>
   <ModuleCommit nicheId={nicheId}/>
   <View style={s.container} testID={`module-home-${nicheId}`} accessibilityLabel={`${nicheId} specialist dashboard`}>
    {nicheId==='collectibles'?<Collectibles/>:nicheId==='coins'?<Coins isHomeTab/>:nicheId==='motocross'?<MX isHomeTab/>:nicheId==='bicycles'?<Bikes isHomeTab/>:nicheId==='clothing'?<Threads isHomeTab/>:nicheId==='surplus_flip'?<Surplus isHomeTab/>:nicheId==='antiques'?<Antiques/>:<Overview/>}
   </View>
  </Suspense>
 </ModuleLoadBoundary>;
});
const s=StyleSheet.create({container:{flex:1},loading:{flex:1,justifyContent:'center',alignItems:'center',backgroundColor:Colors.background,padding:Spacing.base},title:{color:Colors.primary,fontSize:Typography.size.lg,fontWeight:Typography.weight.bold},body:{color:Colors.textSecondary,fontSize:Typography.size.base,lineHeight:26,padding:Spacing.base},retry:{padding:Spacing.base,minHeight:48},pressed:{opacity:0.7}});
