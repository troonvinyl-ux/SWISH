import { memo } from 'react';
import { View,Text,StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import type { PhotoQuality } from '@/services/imageQualityMetrics';
import { Colors,Spacing,Typography,Radius } from '@/constants/theme';
interface PhotoQualityReviewProps { quality:PhotoQuality }
export const PhotoQualityReview = memo(function PhotoQualityReview({ quality }:PhotoQualityReviewProps) {
  return <View style={s.panel} accessibilityLabel="Measured photo quality">
    <Text style={s.title}>{quality.status === 'measured' ? 'On-device photo measurements' : 'Photo measurements unavailable'}</Text>
    {quality.status === 'measured' ? <Text style={s.body}>Light {quality.meanLuminance?.toFixed(0)}/255 · edge variance {quality.laplacianVariance?.toFixed(0)} · clipped highlights {((quality.brightFraction ?? 0) * 100).toFixed(0)}%</Text> : null}
    {quality.warnings.map(warning => <View key={warning} style={s.row}><MaterialIcons name="warning" size={20} color={Colors.warning}/><Text style={[s.body,s.flex]}>{warning}</Text></View>)}
    <Text style={s.body}>{quality.warnings.length ? 'These checks are advisory. A plain or dark item can trigger a warning without being blurred.' : 'No pixel warnings detected. Inspect identifying marks yourself; this does not certify image quality.'}</Text>
  </View>;
});
const s=StyleSheet.create({ panel:{ padding:Spacing.base,gap:Spacing.sm,borderRadius:Radius.md,backgroundColor:Colors.surfaceHighlight },title:{ fontSize:Typography.size.base,fontWeight:Typography.weight.semibold,color:Colors.textPrimary },body:{ fontSize:Typography.size.base,lineHeight:26,color:Colors.textSecondary,includeFontPadding:false },row:{ flexDirection:'row',gap:Spacing.sm },flex:{ flex:1 } });
