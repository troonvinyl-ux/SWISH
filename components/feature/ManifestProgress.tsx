import { memo, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Animated, AccessibilityInfo } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { MANIFEST_PHASES, type ManifestPhase } from '@/constants/manifestExperience';
import { Colors, Spacing, Typography, Radius, Shadow, Animation } from '@/constants/theme';
interface ManifestProgressProps { phase: ManifestPhase }
/** Only mounted while an actual operation is in flight. No fake stage timers or percent complete. */
export const ManifestProgress = memo(function ManifestProgress({ phase }: ManifestProgressProps) {
  const fade = useRef(new Animated.Value(0)).current;
  const message = MANIFEST_PHASES[phase];
  useEffect(()=>{
    let mounted=true;
    fade.setValue(0);
    const animation=Animated.timing(fade,{toValue:1,duration:Animation.normal,useNativeDriver:true});
    void AccessibilityInfo.isReduceMotionEnabled().then(reduced=>{if(mounted&&reduced) { animation.stop(); fade.setValue(1); }}).catch(()=>{});
    animation.start();
    return ()=>{mounted=false;animation.stop();};
  },[fade,phase]);
  return <Animated.View style={[s.card,{opacity:fade}]} accessibilityLiveRegion="polite" accessibilityState={{busy:true}}>
    <View style={s.icon}><MaterialIcons name={message.icon as any} size={32} color={Colors.primary}/></View>
    <View style={s.copy}><Text style={s.title}>{message.title}</Text><Text style={s.body}>{message.detail}</Text></View>
    <ActivityIndicator size="small" color={Colors.primary}/>
  </Animated.View>;
});
const s=StyleSheet.create({card:{padding:Spacing.lg,borderRadius:Radius.xl,backgroundColor:Colors.primaryDim,borderWidth:1,borderColor:Colors.primary,flexDirection:'row',alignItems:'center',gap:Spacing.md,...Shadow.sm},icon:{width:48,height:48,alignItems:'center',justifyContent:'center'},copy:{flex:1,gap:Spacing.sm},title:{fontSize:Typography.size.md,fontWeight:Typography.weight.semibold,color:Colors.textPrimary},body:{fontSize:Typography.size.base,lineHeight:26,color:Colors.textPrimary}});
