import { memo, useCallback, useMemo, useState } from 'react';
import { originalForStudioImage } from '@/shared/smartStudio';
import { inventoryGalleryPhotos } from '@/services/inventoryGalleryService';
import type { InventoryGalleryController } from '@/hooks/useInventoryGallery';
import { ActivityIndicator, FlatList, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { MaterialIcons } from '@expo/vector-icons';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { clamp, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useStockPhotoGallery } from '@/hooks/useStockPhotoGallery';
import type { ItemSmartStudioController } from '@/hooks/useItemSmartStudio';
import { ExistingPhotoStudioControls } from './ExistingPhotoStudioControls';
import { InventoryPhotoActions } from './InventoryPhotoActions';
import { Colors, Radius, Spacing, Typography } from '@/constants/theme';

interface ZoomPhotoProps { uri: string; width: number; height: number; panning: boolean; onZoom: (zoomed: boolean) => void }
const ZoomPhoto = memo(function ZoomPhoto({ uri, width, height, panning, onZoom }: ZoomPhotoProps) {
  const scale = useSharedValue(1); const saved = useSharedValue(1);
  const x = useSharedValue(0); const y = useSharedValue(0); const startX = useSharedValue(0); const startY = useSharedValue(0);
  const reset = () => { 'worklet'; scale.value = withTiming(1, { duration: 200 }); saved.value = 1; x.value = withTiming(0); y.value = withTiming(0); startX.value = 0; startY.value = 0; runOnJS(onZoom)(false); };
  const pinch = Gesture.Pinch().onUpdate(event => { scale.value = clamp(saved.value * event.scale, 1, 5); }).onEnd(() => { saved.value = scale.value; if (scale.value <= 1.05) reset(); else runOnJS(onZoom)(true); });
  const pan = Gesture.Pan().enabled(panning).minDistance(8).onUpdate(event => { if (saved.value <= 1) return; x.value = clamp(startX.value + event.translationX, -width * (scale.value - 1) / 2, width * (scale.value - 1) / 2); y.value = clamp(startY.value + event.translationY, -height * (scale.value - 1) / 2, height * (scale.value - 1) / 2); }).onEnd(() => { startX.value = x.value; startY.value = y.value; });
  const tap = Gesture.Tap().numberOfTaps(2).maxDuration(250).onEnd(() => { if (saved.value > 1) reset(); else { saved.value = 2.5; scale.value = withTiming(2.5, { duration: 200 }); runOnJS(onZoom)(true); } });
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }, { translateY: y.value }, { scale: scale.value }] }));
  return <GestureDetector gesture={Gesture.Exclusive(tap, Gesture.Simultaneous(pinch, pan))}><View style={{ width, height, overflow: 'hidden' }}><Animated.View style={[StyleSheet.absoluteFill, style]}><Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="contain" transition={200} accessibilityLabel="Item photograph" /></Animated.View></View></GestureDetector>;
});
interface ItemPhotoGalleryProps {
  media: string[]; attributes?: Record<string, any>; accent: string; tip: string; saving: boolean; error: string | null;
  onSelectMain: (url: string) => void; onFetch: () => void; fetching: boolean;
  fetchResult: { downloaded: number; failed: number; requiresReauth?: boolean } | null;
  onReconnect: () => void; onReIdentify: () => void;
  studio?: ItemSmartStudioController;
  photoActions?: InventoryGalleryController;
}
export const ItemPhotoGallery = memo(function ItemPhotoGallery({ media: originalMedia, attributes = {}, accent, tip, saving, error, onSelectMain, onFetch, fetching, fetchResult, onReconnect, onReIdentify, studio, photoActions }: ItemPhotoGalleryProps) {
  const media = useMemo(() => inventoryGalleryPhotos(originalMedia, attributes), [originalMedia, attributes]);
  const gallery = useStockPhotoGallery(media);
  const displayPhoto = useCallback((uri: string) => uri, []);
  const [viewerSize, setViewerSize] = useState({ width: 375, height: 400 });
  const renderPhoto = useCallback(({ item: uri }: { item: string }) => <ZoomPhoto key={`${uri}:${gallery.width}:${gallery.fullscreen}`} uri={displayPhoto(uri)} width={gallery.width} height={gallery.height} panning={gallery.zoomed} onZoom={gallery.setZoomed} />, [displayPhoto, gallery.width, gallery.height, gallery.zoomed, gallery.fullscreen, gallery.setZoomed]);
  const main = gallery.activeUrl === media[0];
  const adding = photoActions?.busy === true;
  const changing = saving || fetching || adding;
  return <GestureHandlerRootView style={s.card} onLayout={event => gallery.setWidth(Math.max(1, event.nativeEvent.layout.width - Spacing.base * 2 - Spacing.xxs))}>
    <View style={s.headingRow}><MaterialIcons name="photo-library" size={22} color={accent}/><Text style={s.heading}>Item photos</Text><Text style={s.counter}>{media.length ? `${gallery.index + 1} / ${media.length}` : 'No photos'}</Text></View>
    {media.length ? <>
      <View style={[s.hero, { height: gallery.height }]}>
        <FlatList ref={gallery.list} data={media} horizontal pagingEnabled scrollEnabled={!gallery.zoomed} keyExtractor={(uri, index) => `${uri}:${index}`} renderItem={renderPhoto} getItemLayout={(_, index) => ({ length: gallery.width, offset: index * gallery.width, index })} onScroll={event => gallery.onScroll(event.nativeEvent.contentOffset.x)} scrollEventThrottle={16} showsHorizontalScrollIndicator={false}/>
        <View pointerEvents="none" style={s.mainBadge}><MaterialIcons name={main ? 'star' : 'photo'} size={16} color={accent}/><Text style={s.badgeText}>{main ? 'Main image' : `Photo ${gallery.index + 1}`}</Text></View>
        <Pressable accessibilityRole="button" accessibilityLabel="Open photo full screen" onPress={() => { gallery.setZoomed(false); gallery.setFullscreen(true); }} style={({ pressed }) => [s.expand, pressed ? s.pressed : null]}><MaterialIcons name="fullscreen" size={24} color={Colors.textPrimary}/></Pressable>
      </View>
      <View style={s.thumbnails}><FlatList ref={gallery.thumbnails} horizontal data={media} keyExtractor={(uri, index) => `thumb:${uri}:${index}`} showsHorizontalScrollIndicator={false} contentContainerStyle={s.rail} renderItem={({ item: uri, index }) => <Pressable accessibilityRole="button" accessibilityLabel={`View photo ${index + 1}${index === 0 ? ', main image' : ''}`} accessibilityState={{ selected: index === gallery.index }} onPress={() => gallery.select(index)} style={({ pressed }) => [s.thumb, index === gallery.index ? { borderColor: accent } : null, pressed ? s.pressed : null]}><Image source={{ uri: displayPhoto(uri) }} contentFit="contain" style={StyleSheet.absoluteFill} transition={200}/>{index === 0 ? <View style={s.thumbBadge}><MaterialIcons name="star" size={14} color={accent}/></View> : null}</Pressable>}/></View>
      <Pressable disabled={changing || main} accessibilityRole="button" accessibilityState={{ disabled: changing || main }} accessibilityLabel={main ? 'This is the saved main image' : 'Set selected photo as main image'} onPress={() => onSelectMain(gallery.activeUrl)} style={({ pressed }) => [s.mainButton, { borderColor: accent, backgroundColor: main ? Colors.surfaceHighlight : Colors.primaryDim }, pressed || changing ? s.pressed : null]}>{saving || adding ? <ActivityIndicator color={accent}/> : <MaterialIcons name={main ? 'check-circle' : 'star-outline'} size={22} color={accent}/>}<Text style={[s.mainText, { color: accent }]}>{adding ? 'Adding photos…' : saving ? 'Saving photos…' : main ? 'Main image selected' : 'Set as main image'}</Text></Pressable>
      <Text style={s.body}>Select a thumbnail, then set it as the main image. Inventory and seller listing photo selections are kept separately.</Text>
      <Text style={s.caption}>Each view uses its processed photo when ready; additional views remain visible with their background. Originals are retained. Live eBay photos change only after you choose listing photos and confirm a revision.</Text>
      {studio ? <ExistingPhotoStudioControls originalUri={originalForStudioImage(gallery.activeUrl, attributes)} studio={studio} accent={accent} disabled={changing}/> : null}
    </> : <View style={s.empty}><MaterialIcons name="add-photo-alternate" size={40} color={accent}/><Text style={s.emptyTitle}>Add photos of your item</Text><Text style={s.body}>{tip}</Text>{!photoActions ? <Pressable onPress={onReIdentify} style={({ pressed }) => [s.mainButton, pressed ? s.pressed : null]}><Text style={[s.mainText, { color: accent }]}>Capture or choose photos</Text></Pressable> : null}</View>}
    {photoActions ? <InventoryPhotoActions controller={photoActions} accent={accent} disabled={saving || fetching}/> : null}
    {error ? <View style={s.error}><MaterialIcons name="error-outline" size={20} color={Colors.warning}/><Text accessibilityRole="alert" style={s.errorText}>{error}</Text></View> : null}
    {!media.length || fetchResult ? <Pressable disabled={changing} onPress={fetchResult?.requiresReauth ? onReconnect : onFetch} style={({ pressed }) => [s.fetch, pressed || changing ? s.pressed : null]}>{fetching ? <ActivityIndicator color={Colors.info}/> : <MaterialIcons name="cloud-download" size={20} color={Colors.info}/>}<Text style={s.fetchText}>{fetching ? 'Fetching photos…' : fetchResult?.requiresReauth ? 'Reconnect eBay to fetch photos' : fetchResult?.downloaded ? `${fetchResult.downloaded} photos fetched · Fetch again` : fetchResult?.failed ? 'Photo fetch failed · Retry' : 'Fetch photos from eBay'}</Text></Pressable> : null}
    <Modal visible={gallery.fullscreen} onRequestClose={gallery.closeFullscreen} animationType="fade"><GestureHandlerRootView style={s.fullscreen}><SafeAreaView edges={['top', 'bottom']} style={s.fullscreen}>
      <View style={s.viewerHeader}><Text style={s.heading}>{main ? 'Main image' : `Photo ${gallery.index + 1}`} · {gallery.index + 1} / {media.length}</Text><Pressable accessibilityLabel="Close full screen photo" onPress={gallery.closeFullscreen} style={({ pressed }) => [s.viewerButton, pressed ? s.pressed : null]}><MaterialIcons name="close" size={26} color={Colors.textPrimary}/></Pressable></View>
      <View style={s.viewerImage} onLayout={event => setViewerSize({ width: Math.max(1, event.nativeEvent.layout.width), height: Math.max(1, event.nativeEvent.layout.height) })}>{gallery.activeUrl ? <ZoomPhoto key={`${gallery.activeUrl}:${viewerSize.width}:${viewerSize.height}`} uri={displayPhoto(gallery.activeUrl)} width={viewerSize.width} height={viewerSize.height} panning={gallery.zoomed} onZoom={gallery.setZoomed}/> : null}</View>
      <View style={s.viewerFooter}><Pressable accessibilityLabel="Previous photo" disabled={gallery.index === 0} onPress={() => gallery.select(gallery.index - 1)} style={({ pressed }) => [s.viewerButton, pressed || gallery.index === 0 ? s.pressed : null]}><MaterialIcons name="chevron-left" size={28} color={accent}/></Pressable><Text style={s.body}>Pinch or double-tap to zoom</Text><Pressable accessibilityLabel="Next photo" disabled={gallery.index === media.length - 1} onPress={() => gallery.select(gallery.index + 1)} style={({ pressed }) => [s.viewerButton, pressed || gallery.index === media.length - 1 ? s.pressed : null]}><MaterialIcons name="chevron-right" size={28} color={accent}/></Pressable></View>
      <View style={s.exportRow}><Pressable disabled={gallery.exporting} accessibilityLabel="Save item photo" onPress={() => { void gallery.exportPhoto('save', displayPhoto(gallery.activeUrl)); }} style={({ pressed }) => [s.exportButton, pressed || gallery.exporting ? s.pressed : null]}>{gallery.exporting ? <ActivityIndicator color={accent}/> : <MaterialIcons name="download" size={22} color={accent}/>}<Text style={s.exportText}>{Platform.OS === 'web' ? 'Open photo' : 'Save to Photos'}</Text></Pressable><Pressable disabled={gallery.exporting} accessibilityLabel="Share item photo" onPress={() => { void gallery.exportPhoto('share', displayPhoto(gallery.activeUrl)); }} style={({ pressed }) => [s.exportButton, pressed || gallery.exporting ? s.pressed : null]}><MaterialIcons name="share" size={22} color={accent}/><Text style={s.exportText}>Share photo</Text></Pressable></View>
      {gallery.exportError ? <Text accessibilityRole="alert" style={s.viewerError}>{gallery.exportError}</Text> : null}
    </SafeAreaView></GestureHandlerRootView></Modal>
  </GestureHandlerRootView>;
});
const s = StyleSheet.create({
  emptyTitle: { fontSize: Typography.size.md, color: Colors.textPrimary, fontWeight: Typography.weight.semibold },
  exportRow: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: Spacing.base, paddingBottom: Spacing.sm, gap: Spacing.sm },
  exportButton: { flexGrow: 1, minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.md, backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.md },
  exportText: { fontSize: Typography.size.base, color: Colors.textPrimary, fontWeight: Typography.weight.medium },
  viewerError: { color: Colors.warning, paddingHorizontal: Spacing.base, paddingBottom: Spacing.sm, fontSize: Typography.size.sm, lineHeight: 21 },
  card: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.surfaceBorder, borderRadius: Radius.xl, padding: Spacing.base, gap: Spacing.md },
  headingRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  heading: { flex: 1, fontSize: Typography.size.md, fontWeight: Typography.weight.semibold, color: Colors.textPrimary, includeFontPadding: false },
  counter: { fontSize: Typography.size.sm, color: Colors.textSecondary },
  hero: { backgroundColor: Colors.background, borderRadius: Radius.lg, overflow: 'hidden' },
  mainBadge: { position: 'absolute', top: Spacing.sm, left: Spacing.sm, flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, padding: Spacing.sm, backgroundColor: Colors.overlay80, borderRadius: Radius.md },
  badgeText: { fontSize: Typography.size.sm, color: Colors.textPrimary, fontWeight: Typography.weight.medium },
  expand: { position: 'absolute', bottom: Spacing.sm, right: Spacing.sm, width: 48, height: 48, borderRadius: Radius.md, backgroundColor: Colors.overlay80, alignItems: 'center', justifyContent: 'center' },
  thumbnails: { height: 80 }, rail: { gap: Spacing.sm },
  thumb: { width: 80, height: 80, borderRadius: Radius.md, borderWidth: 2, borderColor: Colors.surfaceBorder, overflow: 'hidden' },
  thumbBadge: { position: 'absolute', bottom: Spacing.xs, left: Spacing.xs, backgroundColor: Colors.overlay80, padding: Spacing.xs, borderRadius: Radius.sm },
  mainButton: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.surfaceBorder, padding: Spacing.md },
  mainText: { fontSize: Typography.size.base, fontWeight: Typography.weight.semibold, flexShrink: 1 },
  body: { fontSize: Typography.size.base, lineHeight: 26, color: Colors.textSecondary, includeFontPadding: false },
  caption: { fontSize: Typography.size.sm, lineHeight: 21, color: Colors.textSecondary },
  empty: { minHeight: 240, alignItems: 'center', justifyContent: 'center', gap: Spacing.base },
  error: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, padding: Spacing.md, backgroundColor: Colors.warningDim, borderRadius: Radius.md },
  errorText: { color: Colors.warning, fontSize: Typography.size.base, lineHeight: 26, flex: 1 },
  fetch: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, minHeight: 48, borderRadius: Radius.md, backgroundColor: Colors.infoDim, padding: Spacing.md },
  fetchText: { color: Colors.info, fontSize: Typography.size.base, fontWeight: Typography.weight.medium, flexShrink: 1 },
  fullscreen: { flex: 1, backgroundColor: Colors.background },
  viewerHeader: { flexDirection: 'row', alignItems: 'center', padding: Spacing.base, gap: Spacing.sm },
  viewerButton: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: Radius.md, backgroundColor: Colors.surfaceHighlight },
  viewerImage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  viewerFooter: { padding: Spacing.base, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  pressed: { opacity: 0.65 },
});
