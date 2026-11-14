import { memo, useState } from 'react';
import { View, Text, FlatList, Pressable, Modal, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import type { PhotoReviewSource, PhotoWarningReview } from '@/services/reidentificationPhotoReviewService';
import { Colors, Spacing, Typography, Radius } from '@/constants/theme';
interface ReidentificationPhotoReviewProps {
  photos: PhotoReviewSource[];
  warnings: PhotoWarningReview[];
  acknowledged: boolean;
  disabled: boolean;
  onContinue: () => void;
}
export const ReidentificationPhotoReview = memo(function ReidentificationPhotoReview({ photos, warnings, acknowledged, disabled, onContinue }: ReidentificationPhotoReviewProps) {
  const [viewing, setViewing] = useState<PhotoReviewSource | null>(null);
  // Quality warnings are evidence about the exact photo supplied to the
  // identifier. Never replace it with a presentation derivative in review.
  const displayed = photos;
  const activePhoto = viewing ? displayed.find(photo => photo.uri === viewing.uri) ?? null : null;
  if (!photos.length) return null;
  return <View style={s.panel}>
    <View style={s.heading}><MaterialIcons name="photo-library" size={22} color={Colors.primary}/><Text style={s.title}>Photos used for re-identification</Text></View>
    <Text style={s.body}>{displayed.length} displayed views · originals retained privately for identification</Text>
    <View style={s.rail}>
      <FlatList horizontal data={displayed} keyExtractor={(photo, index) => `${index}:${photo.uri}`} showsHorizontalScrollIndicator={false} contentContainerStyle={s.railContent} renderItem={({ item: photo }) => {
        const flagged = warnings.some(warning => warning.uri === photo.uri && warning.slotLabel === photo.slotLabel);
        return <Pressable accessibilityLabel={`Inspect ${photo.slotLabel}${flagged ? ', lighting or focus warning' : ''}`} onPress={() => setViewing(photo)} style={({ pressed }) => [s.photo, flagged ? s.flagged : null, pressed ? s.pressed : null]}>
          <Image source={{ uri: photo.uri }} contentFit="contain" transition={200} style={s.thumbnail}/>
          <Text style={s.label} numberOfLines={2}>{photo.slotLabel}</Text>
          {flagged ? <View style={s.heading}><MaterialIcons name="warning" size={16} color={Colors.warning}/><Text style={s.warningLabel}>Review quality</Text></View> : null}
        </Pressable>;
      }}/>
    </View>
    {warnings.length ? <View style={s.warningPanel}>
      <View style={s.heading}><MaterialIcons name="warning" size={22} color={Colors.warning}/><Text style={s.title}>Review lighting & focus</Text></View>
      <Text style={s.body}>Pixel checks are advisory. A dark item or plain surface can trigger a warning without being unusable.</Text>
      <Text accessibilityRole="alert" style={s.warningText}>{warnings.map(photo => `${photo.slotLabel}: ${photo.photoQuality.warnings.join(' ')}`).join('\n\n')}</Text>
      <Text style={s.body}>{acknowledged ? 'Limitations acknowledged for these photos. Identification still needs your review.' : 'Add a clearer view below, or explicitly continue with these limitations. Originals and live listings are unchanged.'}</Text>
      {!acknowledged ? <Pressable disabled={disabled} accessibilityLabel="Continue re-identification with the reviewed photo limitations" onPress={onContinue} style={({ pressed }) => [s.continue, disabled || pressed ? s.pressed : null]}><MaterialIcons name="auto-awesome" size={20} color={Colors.textInverse}/><Text style={s.continueText}>Continue with these photos</Text></Pressable> : null}
    </View> : null}
    <Modal visible={Boolean(activePhoto)} animationType="fade" onRequestClose={() => setViewing(null)}>
      <SafeAreaView edges={['top', 'bottom']} style={s.viewer}>
        <View style={s.viewerHeader}><Text style={[s.title, s.flex]}>{activePhoto?.slotLabel ?? 'Item photograph'}</Text><Pressable accessibilityLabel="Close original photo" onPress={() => setViewing(null)} style={({ pressed }) => [s.close, pressed ? s.pressed : null]}><MaterialIcons name="close" size={24} color={Colors.textPrimary}/></Pressable></View>
        {activePhoto ? <Image source={{ uri: activePhoto.uri }} contentFit="contain" transition={200} style={s.flex}/> : null}
      </SafeAreaView>
    </Modal>
  </View>;
});
const s = StyleSheet.create({
  panel: { gap: Spacing.md, padding: Spacing.base, borderRadius: Radius.xl, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.surfaceBorder },
  heading: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  title: { flexShrink: 1, fontSize: Typography.size.base, fontWeight: Typography.weight.semibold, color: Colors.textPrimary, includeFontPadding: false },
  body: { fontSize: Typography.size.base, lineHeight: Typography.size.base * Typography.lineHeight.relaxed, color: Colors.textSecondary, includeFontPadding: false },
  rail: { height: 224 },
  railContent: { gap: Spacing.sm, alignItems: 'flex-start' },
  photo: { width: 176, minHeight: 200, padding: Spacing.sm, gap: Spacing.sm, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceBorder, backgroundColor: Colors.surfaceHighlight },
  flagged: { borderColor: Colors.warning },
  thumbnail: { height: 120, width: '100%', borderRadius: Radius.md },
  label: { fontSize: Typography.size.base, lineHeight: Typography.size.base * Typography.lineHeight.normal, color: Colors.textPrimary, includeFontPadding: false },
  warningLabel: { fontSize: Typography.size.sm, color: Colors.warning },
  warningPanel: { gap: Spacing.md, padding: Spacing.base, borderRadius: Radius.lg, backgroundColor: Colors.warningDim },
  warningText: { fontSize: Typography.size.base, lineHeight: Typography.size.base * Typography.lineHeight.relaxed, color: Colors.warning, includeFontPadding: false },
  continue: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.primary },
  continueText: { flexShrink: 1, fontSize: Typography.size.base, fontWeight: Typography.weight.semibold, color: Colors.textInverse, textAlign: 'center' },
  pressed: { opacity: 0.65 },
  viewer: { flex: 1, backgroundColor: Colors.background },
  viewerHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.base, padding: Spacing.base },
  close: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: Radius.md, backgroundColor: Colors.surfaceHighlight },
  flex: { flex: 1 },
});
