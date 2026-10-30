import { memo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { getBrandArtwork, BRAND_NAMES } from '@/constants/brandArtwork';
import { Colors, Radius, Typography, Spacing } from '@/constants/theme';
interface BrandArtworkProps { nicheId: string; compact?: boolean }
/** Uses supplied art as branding, with the baked-in button cropped out. Actions stay native. */
export const BrandArtwork = memo(function BrandArtwork({ nicheId, compact = false }: BrandArtworkProps) {
  const source = getBrandArtwork(nicheId);
  if (!source) return null;
  return <View style={[s.frame, compact ? s.compact : null]} accessibilityLabel={BRAND_NAMES[nicheId]} accessibilityRole="image">
    <Image source={source} contentFit="cover" transition={200} style={s.image} accessible={false}/>
    <LinearGradient colors={[Colors.overlay20, Colors.overlay80]} style={s.shade} pointerEvents="none"/>
    <View style={s.caption}><Text style={s.label}>FIND IT. KNOW IT. FLIP IT.</Text><Text style={s.title}>{BRAND_NAMES[nicheId]}</Text></View>
  </View>;
});
const s=StyleSheet.create({
  frame:{width:'100%',aspectRatio:1.6,borderRadius:Radius.xxl,overflow:'hidden',backgroundColor:Colors.surface,borderWidth:1,borderColor:Colors.surfaceBorder},
  compact:{aspectRatio:2},image:{position:'absolute',top:0,left:0,width:'100%',aspectRatio:1.06},shade:{...StyleSheet.absoluteFillObject},
  caption:{position:'absolute',left:Spacing.lg,right:Spacing.lg,bottom:Spacing.base,gap:Spacing.xs},
  label:{fontSize:Typography.size.sm,fontWeight:Typography.weight.semibold,color:Colors.textPrimary,letterSpacing:1},
  title:{fontSize:Typography.size.xl,fontWeight:Typography.weight.bold,color:Colors.textPrimary,includeFontPadding:false},
});
