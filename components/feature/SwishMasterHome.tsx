import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Redirect, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { useUnifiedShell } from '@/hooks/useUnifiedShell';
import { useAccountLogout } from '@/hooks/useAccountLogout';
import { useOwnerAuthorization } from '@/hooks/useOwnerAuthorization';
import { CommandPortfolio } from '@/components/feature/CommandPortfolio';
import { Colors, Spacing, Radius, Typography } from '@/constants/theme';
interface SwishMasterHomeProps {}
export function SwishMasterHome(_props: SwishMasterHomeProps) {
 const shell=useUnifiedShell(); const owner=useOwnerAuthorization(); const router=useRouter();
 const {requestLogout,disabled:signingOut}=useAccountLogout();
 if(shell.tenantLoading || shell.nichePreferencesLoading || (shell.isMasterAdmin && owner.loading))return <SafeAreaView style={s.loading}><ActivityIndicator color={Colors.primary}/><Text style={s.body}>Verifying portfolio access…</Text></SafeAreaView>;
 if(!shell.accessReady)return <Redirect href="/"/>;
 if(!shell.isMasterAdmin && shell.modules.length===1 && shell.activeNicheId===shell.modules[0].id)return <Redirect href={'/(tabs)' as any}/>;
 const platform=shell.isMasterAdmin && owner.allowed;
 if(shell.isMasterAdmin && !owner.allowed)return <SafeAreaView edges={['top','bottom']} style={s.loading}><Text style={s.title}>Owner verification required</Text><Text accessibilityRole="alert" style={s.body}>{owner.error??'The server did not authorize platform reporting.'}</Text><Pressable onPress={()=>{void owner.retry();}} style={({pressed})=>[s.admin,pressed?s.pressed:null]}><Text style={s.linkText}>Retry owner verification</Text></Pressable></SafeAreaView>;
 return <SafeAreaView edges={['top','bottom']} style={s.screen}><StatusBar style="light"/>
  <View style={s.header}><Text style={s.logo}>SWISH <Text style={s.accent}>/ INTELLIGENCE</Text></Text><Pressable accessibilityLabel="Sign out of SWISH" disabled={signingOut} onPress={requestLogout} style={({pressed})=>[s.icon,pressed?s.pressed:null]}><MaterialIcons name="logout" size={24} color={Colors.textPrimary}/></Pressable></View>
  {platform?<View style={s.ownerLinks}><Pressable onPress={()=>router.push('/master-admin' as any)} style={({pressed})=>[s.admin,pressed?s.pressed:null]}><MaterialIcons name="admin-panel-settings" size={22} color={Colors.primary}/><Text style={s.linkText}>Master Admin</Text></Pressable><Pressable onPress={()=>router.push('/production-control' as any)} style={({pressed})=>[s.admin,pressed?s.pressed:null]}><MaterialIcons name="fact-check" size={22} color={Colors.primary}/><Text style={s.linkText}>Production readiness</Text></Pressable></View>:null}
  <CommandPortfolio platform={platform} enabled={shell.accessReady && (!shell.isMasterAdmin || owner.allowed)}/>
 </SafeAreaView>;
}
const s=StyleSheet.create({screen:{flex:1,backgroundColor:Colors.background},loading:{flex:1,padding:Spacing.xl,gap:Spacing.base,backgroundColor:Colors.background,alignItems:'center',justifyContent:'center'},header:{paddingHorizontal:Spacing.base,flexDirection:'row',alignItems:'center',gap:Spacing.sm,borderBottomWidth:1,borderBottomColor:Colors.primary+'40'},logo:{flex:1,color:Colors.textPrimary,fontSize:Typography.size.lg,fontWeight:Typography.weight.bold,letterSpacing:1,includeFontPadding:false},accent:{color:Colors.primary,fontSize:Typography.size.sm},icon:{width:48,height:48,alignItems:'center',justifyContent:'center'},ownerLinks:{padding:Spacing.base,gap:Spacing.sm,flexDirection:'row',flexWrap:'wrap',width:'100%',maxWidth:960,alignSelf:'center'},admin:{flexGrow:1,minHeight:48,padding:Spacing.md,gap:Spacing.sm,backgroundColor:Colors.primaryDim,borderRadius:Radius.md,borderWidth:1,borderColor:Colors.primary+'60',flexDirection:'row',alignItems:'center',justifyContent:'center'},linkText:{color:Colors.primary,fontSize:Typography.size.base,fontWeight:Typography.weight.semibold,flexShrink:1},body:{color:Colors.textSecondary,fontSize:Typography.size.base,lineHeight:26},title:{color:Colors.textPrimary,fontSize:Typography.size.lg,fontWeight:Typography.weight.bold},pressed:{opacity:0.7}});
