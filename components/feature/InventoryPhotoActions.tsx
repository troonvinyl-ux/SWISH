import { memo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import type { InventoryGalleryController } from '@/hooks/useInventoryGallery';
import { Colors, Radius, Spacing, Typography } from '@/constants/theme';
interface InventoryPhotoActionsProps { controller: InventoryGalleryController; accent: string; disabled?: boolean }
export const InventoryPhotoActions = memo(function InventoryPhotoActions({ controller, accent, disabled = false }: InventoryPhotoActionsProps) {
  const blocked = disabled || !controller.ready || controller.busy || controller.retryCount > 0;
  return <View style={s.section}>
    <Text style={s.title}>Add photos at any stage</Text>
    <Text style={s.body}>Draft, live, sold or archived: add close-ups, lifestyle shots or packing evidence without re-identifying or changing a listing.</Text>
    <View style={s.row}>
      <Pressable accessibilityRole="button" accessibilityLabel="Take a photo and add it to this inventory gallery" disabled={blocked} onPress={() => void controller.add('camera')} style={({ pressed }) => [s.button, pressed || blocked ? s.pressed : null]}><MaterialIcons name="photo-camera" size={22} color={accent}/><Text style={s.buttonText}>Take photo</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Add photos from library to this inventory gallery" disabled={blocked} onPress={() => void controller.add('library')} style={({ pressed }) => [s.button, pressed || blocked ? s.pressed : null]}><MaterialIcons name="add-photo-alternate" size={22} color={accent}/><Text style={s.buttonText}>Add images</Text></Pressable>
    </View>
    {controller.busy ? <View style={s.status}><ActivityIndicator color={accent}/><Text accessibilityLiveRegion="polite" style={s.body}>Preparing and saving photos…</Text></View> : null}
    {controller.error ? <View style={s.error}><MaterialIcons name="error-outline" size={22} color={Colors.warning}/><Text accessibilityRole="alert" style={s.errorText}>{controller.error}</Text></View> : null}
    {controller.retryCount ? <Pressable disabled={disabled || !controller.ready || controller.busy} accessibilityRole="button" accessibilityLabel="Retry saving the same retained gallery photos" onPress={() => void controller.retry()} style={({ pressed }) => [s.button, pressed || controller.busy ? s.pressed : null]}><MaterialIcons name="refresh" size={22} color={accent}/><Text style={s.buttonText}>Retry {controller.retryCount} retained photo{controller.retryCount === 1 ? '' : 's'}</Text></Pressable> : null}
    {controller.retryCount ? <Pressable disabled={controller.busy} accessibilityRole="button" accessibilityLabel="Clear pending upload without deleting saved item photos" onPress={controller.discardPending} style={({ pressed }) => [s.button, pressed || controller.busy ? s.pressed : null]}><MaterialIcons name="close" size={22} color={Colors.textSecondary}/><Text style={s.buttonText}>Clear pending upload · keep saved photos</Text></Pressable> : null}
    {controller.notice ? <View style={s.status}><MaterialIcons name="check-circle-outline" size={22} color={Colors.success}/><Text accessibilityLiveRegion="polite" style={s.body}>{controller.notice}</Text></View> : null}
    <Text style={s.caption}>Choose up to 8 images per batch; the inventory gallery is not limited to eBay’s 12 selected listing photos. Existing photos and the main image are kept.</Text>
  </View>;
});
const s = StyleSheet.create({
  section: { gap: Spacing.sm, paddingTop: Spacing.base, borderTopWidth: 1, borderTopColor: Colors.surfaceBorder },
  title: { color: Colors.textPrimary, fontSize: Typography.size.md, fontWeight: Typography.weight.semibold, includeFontPadding: false },
  body: { color: Colors.textSecondary, fontSize: Typography.size.base, lineHeight: Typography.size.base * Typography.lineHeight.relaxed, includeFontPadding: false },
  caption: { color: Colors.textSecondary, fontSize: Typography.size.sm, lineHeight: Typography.size.sm * Typography.lineHeight.relaxed },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  button: { flexGrow: 1, minHeight: Spacing.section, padding: Spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.surfaceBorder, backgroundColor: Colors.surfaceHighlight },
  buttonText: { color: Colors.textPrimary, fontSize: Typography.size.base, fontWeight: Typography.weight.semibold, flexShrink: 1, includeFontPadding: false },
  status: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  error: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, padding: Spacing.md, borderRadius: Radius.md, backgroundColor: Colors.warningDim },
  errorText: { flex: 1, fontSize: Typography.size.base, lineHeight: Typography.size.base * Typography.lineHeight.relaxed, color: Colors.warning },
  pressed: { opacity: 0.65 },
});
