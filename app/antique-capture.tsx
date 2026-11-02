import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useGenericCapture } from '@/hooks/useGenericCapture';
import { SpecialistReview } from '@/components/feature/SpecialistReview';
import { PhotoQualityReview } from '@/components/feature/PhotoQualityReview';
import { Colors, Spacing, Typography, Radius } from '@/constants/theme';

const GOLD = '#D6AD5C';
const GOLD_DARK = '#72572B';
const INK = '#090907';
const PANEL = '#15140F';

export default function AntiqueCaptureScreen() {
  const capture = useGenericCapture();
  const router = useRouter();
  const [activeSlotId, setActiveSlotId] = useState('front');
  const [gridVisible, setGridVisible] = useState(true);

  useEffect(() => {
    if (!capture.slots.some((slot) => slot.id === activeSlotId)) {
      setActiveSlotId(capture.slots[0]?.id ?? 'front');
    }
  }, [capture.slots, activeSlotId]);

  const activeSlot = capture.slots.find((slot) => slot.id === activeSlotId) ?? capture.slots[0];
  const activeImage = capture.images.find((image) => image.slotId === activeSlot?.id);
  const preview = activeImage ?? capture.images[capture.images.length - 1];
  const completedSlots = capture.slots.filter((slot) => capture.images.some((image) => image.slotId === slot.id)).length;
  const requiredSlots = capture.slots.filter((slot) => slot.required).length;

  if (capture.activeNiche.id !== 'antiques') {
    return (
      <SafeAreaView style={styles.screen}>
        <StatusBar style="light" />
        <View style={styles.guard}>
          <MaterialIcons name="museum" size={42} color={GOLD} />
          <Text style={styles.title}>Antique Flipper scanner</Text>
          <Text style={styles.body}>Select Antique Flipper before opening this scanner. Your current niche and inventory have not been changed.</Text>
          <Pressable onPress={() => router.back()} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>Go back</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.screen}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.topbar}>
          <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={styles.iconButton}>
            <MaterialIcons name="close" size={23} color={GOLD} />
          </Pressable>
          <View style={styles.brand}>
            <Text style={styles.brandTitle}>ANTIQUE FLIPPER</Text>
            <Text style={styles.eyebrow}>SPECIALIST SCANNER</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={gridVisible ? 'Hide framing grid' : 'Show framing grid'}
            accessibilityState={{ selected: gridVisible }}
            onPress={() => setGridVisible((visible) => !visible)}
            style={styles.iconButton}
          >
            <MaterialIcons name="grid-on" size={22} color={gridVisible ? GOLD : Colors.textSecondary} />
          </Pressable>
        </View>

        <View style={styles.intro}>
          <Text style={styles.kicker}>IDENTIFY · VALUE · RESTORE · SELL</Text>
          <Text style={styles.title}>Capture your antique</Text>
          <Text style={styles.body}>Photograph the object from several angles. Clear marks, construction details and a scale reference help separate visible evidence from uncertain attribution.</Text>
        </View>

        <View style={styles.progressRow}>
          <View>
            <Text style={styles.progressValue}>{completedSlots} / {capture.slots.length}</Text>
            <Text style={styles.muted}>PHOTO ANGLES CAPTURED</Text>
          </View>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: capture.slots.length ? `${(completedSlots / capture.slots.length) * 100}%` : '0%' }]} />
          </View>
          <Text style={styles.progressSmall}>{requiredSlots} key view{requiredSlots === 1 ? '' : 's'}</Text>
        </View>

        <View style={styles.frameCard}>
          <View style={styles.frameHeader}>
            <Text style={styles.frameLabel}>{activeSlot?.label ?? 'Main view'}</Text>
            <Text style={styles.frameHint}>{activeImage ? 'PHOTO CAPTURED' : 'FRAME THE OBJECT'}</Text>
          </View>
          <View style={styles.viewfinder}>
            {preview ? (
              <Image source={{ uri: preview.uri }} contentFit="contain" transition={180} style={styles.preview} />
            ) : (
              <View style={styles.placeholder}>
                <MaterialIcons name="photo-camera" size={48} color={GOLD} />
                <Text style={styles.placeholderTitle}>Position the whole object</Text>
                <Text style={styles.placeholderText}>Use even light and keep the camera steady. Avoid reflections over marks and signatures.</Text>
              </View>
            )}
            {gridVisible ? (
              <View pointerEvents="none" style={styles.gridOverlay}>
                <View style={styles.gridVertical} />
                <View style={styles.gridHorizontal} />
                <View style={[styles.corner, styles.cornerTopLeft]} />
                <View style={[styles.corner, styles.cornerTopRight]} />
                <View style={[styles.corner, styles.cornerBottomLeft]} />
                <View style={[styles.corner, styles.cornerBottomRight]} />
              </View>
            ) : null}
          </View>
          {activeImage?.photoQuality ? <PhotoQualityReview quality={activeImage.photoQuality} /> : null}
          <View style={styles.captureControls}>
            <Pressable
              disabled={capture.busy || Boolean(capture.savedId) || !activeSlot}
              onPress={() => activeSlot && void capture.capture(activeSlot.id, true)}
              style={styles.galleryButton}
            >
              <MaterialIcons name="photo-library" size={24} color={GOLD} />
              <Text style={styles.controlText}>Gallery</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={activeImage ? 'Retake photo' : 'Take photo'}
              disabled={capture.busy || Boolean(capture.savedId) || !activeSlot}
              onPress={() => activeSlot && void capture.capture(activeSlot.id, false)}
              style={({ pressed }) => [styles.shutterOuter, pressed ? styles.pressed : null]}
            >
              <View style={styles.shutterInner} />
            </Pressable>
            <View style={styles.photoMode}>
              <Text style={styles.photoModeActive}>PHOTO</Text>
              <Text style={styles.photoModeSub}>MULTI-ANGLE</Text>
            </View>
          </View>
          <Text style={styles.captureTip}>{activeImage ? 'Retake this angle or choose another view below.' : 'Tap the gold shutter to photograph this view.'}</Text>
        </View>

        <View style={styles.sectionHeading}>
          <Text style={styles.sectionTitle}>Evidence checklist</Text>
          <Text style={styles.sectionMeta}>SELECT A VIEW</Text>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.slotStrip}>
          {capture.slots.map((slot) => {
            const image = capture.images.find((entry) => entry.slotId === slot.id);
            const selected = slot.id === activeSlot?.id;
            return (
              <Pressable
                key={slot.id}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => setActiveSlotId(slot.id)}
                style={[styles.slotCard, selected ? styles.slotCardSelected : null]}
              >
                {image ? (
                  <Image source={{ uri: image.uri }} contentFit="cover" style={styles.slotImage} />
                ) : (
                  <View style={styles.slotPlaceholder}>
                    <MaterialIcons name="add-a-photo" size={22} color={selected ? GOLD : Colors.textSecondary} />
                  </View>
                )}
                <View style={styles.slotTextRow}>
                  <Text numberOfLines={1} style={styles.slotLabel}>{slot.label}</Text>
                  <MaterialIcons name={image ? 'check-circle' : 'radio-button-unchecked'} size={15} color={image ? GOLD : Colors.textSecondary} />
                </View>
                <Text style={styles.slotRequirement}>{slot.required ? 'KEY VIEW' : 'EXTRA DETAIL'}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {capture.error ? (
          <View style={styles.errorBox}>
            <MaterialIcons name="error-outline" size={21} color={Colors.danger} />
            <Text style={styles.errorText}>{capture.error}</Text>
          </View>
        ) : null}

        {capture.busy ? (
          <View style={styles.analysisCard}>
            <ActivityIndicator color={GOLD} size="large" />
            <View style={styles.analysisCopy}>
              <Text style={styles.analysisTitle}>{capture.phase || 'Preparing your scanner'}</Text>
              <Text style={styles.body}>Antique Flipper is using the selected evidence and antique specialist profile.</Text>
            </View>
          </View>
        ) : null}

        {capture.images.length > 0 && !capture.savedId ? (
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: capture.allowPhotoWarnings }}
            onPress={() => capture.setAllowPhotoWarnings(!capture.allowPhotoWarnings)}
            style={styles.warningToggle}
          >
            <MaterialIcons name={capture.allowPhotoWarnings ? 'check-box' : 'check-box-outline-blank'} size={22} color={GOLD} />
            <Text style={styles.body}>I have reviewed the photo warnings. Allow identification with advisory image-quality warnings.</Text>
          </Pressable>
        ) : null}

        {capture.result ? (
          <View style={styles.resultCard}>
            <Text style={styles.kicker}>ANTIQUE SPECIALIST REVIEW</Text>
            <Text style={styles.sectionTitle}>Possible identification</Text>
            <Text style={styles.body}>Check the visible evidence and correct any uncertain details before saving.</Text>
            <SpecialistReview
              result={capture.result}
              profile={capture.profile}
              answers={capture.answers}
              disabled={capture.busy || Boolean(capture.savedId)}
              onAnswer={capture.answer}
              onTitle={capture.correctTitle}
            />
          </View>
        ) : null}

        <Pressable
          disabled={capture.busy || (!capture.images.length && !capture.savedId) || (Boolean(capture.result) && !capture.result?.canonicalTitle.trim())}
          onPress={() => {
            if (capture.savedId) router.push(`/stock-listing/${capture.savedId}` as any);
            else if (capture.result) void capture.save();
            else void capture.identify();
          }}
          style={({ pressed }) => [
            styles.primaryButton,
            (capture.busy || (!capture.images.length && !capture.savedId)) ? styles.disabledButton : null,
            pressed ? styles.pressed : null,
          ]}
        >
          <MaterialIcons name={capture.savedId ? 'inventory-2' : capture.result ? 'inventory' : 'auto-awesome'} size={21} color={INK} />
          <Text style={styles.primaryButtonText}>
            {capture.savedId ? 'View saved inventory item' : capture.result ? 'Save to inventory' : 'Identify this antique'}
          </Text>
          <MaterialIcons name="arrow-forward" size={20} color={INK} />
        </Pressable>

        {capture.images.length > 0 ? (
          <Pressable disabled={capture.busy} onPress={capture.reset} style={styles.resetButton}>
            <Text style={styles.resetText}>Start a new scan</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: INK },
  content: { padding: Spacing.base, gap: Spacing.md, paddingBottom: Spacing.xl },
  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  iconButton: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: GOLD_DARK, alignItems: 'center', justifyContent: 'center', backgroundColor: PANEL },
  brand: { alignItems: 'center', gap: 2 },
  brandTitle: { color: GOLD, fontSize: 17, fontWeight: Typography.weight.bold, letterSpacing: 2 },
  eyebrow: { color: Colors.textSecondary, fontSize: 10, letterSpacing: 2 },
  intro: { gap: 7, paddingTop: 4 },
  kicker: { color: GOLD, fontSize: 10, letterSpacing: 1.7, fontWeight: Typography.weight.bold },
  title: { color: '#F5E8C9', fontSize: 27, lineHeight: 33, fontWeight: Typography.weight.bold },
  body: { color: '#C7C0B2', fontSize: Typography.size.base, lineHeight: 23, flexShrink: 1 },
  muted: { color: '#948A77', fontSize: 9, letterSpacing: 1.2, marginTop: 3 },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: Radius.md, backgroundColor: PANEL, borderWidth: 1, borderColor: '#332A1B' },
  progressValue: { color: GOLD, fontSize: 20, fontWeight: Typography.weight.bold, fontVariant: ['tabular-nums'] },
  progressTrack: { flex: 1, height: 6, borderRadius: 3, backgroundColor: '#383226', overflow: 'hidden' },
  progressFill: { height: 6, borderRadius: 3, backgroundColor: GOLD },
  progressSmall: { color: '#B9AD97', fontSize: 9 },
  frameCard: { padding: 12, borderRadius: Radius.lg, backgroundColor: PANEL, borderWidth: 1, borderColor: GOLD_DARK, gap: 10 },
  frameHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  frameLabel: { color: '#F5E8C9', fontSize: 15, fontWeight: Typography.weight.semibold, flexShrink: 1 },
  frameHint: { color: GOLD, fontSize: 9, letterSpacing: 1, fontWeight: Typography.weight.bold },
  viewfinder: { height: 330, borderRadius: Radius.md, overflow: 'hidden', backgroundColor: '#070706', alignItems: 'center', justifyContent: 'center' },
  preview: { width: '100%', height: '100%' },
  placeholder: { alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  placeholderTitle: { color: '#F5E8C9', fontSize: 17, fontWeight: Typography.weight.semibold, textAlign: 'center' },
  placeholderText: { color: '#AFA693', fontSize: 12, lineHeight: 19, textAlign: 'center', maxWidth: 270 },
  gridOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  gridVertical: { position: 'absolute', top: 0, bottom: 0, left: '50%', width: 1, backgroundColor: 'rgba(214,173,92,0.25)' },
  gridHorizontal: { position: 'absolute', left: 0, right: 0, top: '50%', height: 1, backgroundColor: 'rgba(214,173,92,0.25)' },
  corner: { position: 'absolute', width: 30, height: 30, borderColor: GOLD, borderWidth: 0 },
  cornerTopLeft: { top: 14, left: 14, borderTopWidth: 3, borderLeftWidth: 3 },
  cornerTopRight: { top: 14, right: 14, borderTopWidth: 3, borderRightWidth: 3 },
  cornerBottomLeft: { bottom: 14, left: 14, borderBottomWidth: 3, borderLeftWidth: 3 },
  cornerBottomRight: { bottom: 14, right: 14, borderBottomWidth: 3, borderRightWidth: 3 },
  captureControls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingTop: 2 },
  galleryButton: { width: 76, minHeight: 58, alignItems: 'center', justifyContent: 'center', gap: 2 },
  controlText: { color: '#D7C8A7', fontSize: 10 },
  shutterOuter: { width: 74, height: 74, borderRadius: 37, borderWidth: 4, borderColor: GOLD, alignItems: 'center', justifyContent: 'center', backgroundColor: '#292114' },
  shutterInner: { width: 54, height: 54, borderRadius: 27, backgroundColor: '#F2CC70', borderWidth: 2, borderColor: '#FFF0C8' },
  photoMode: { width: 76, alignItems: 'center', gap: 3 },
  photoModeActive: { color: GOLD, fontSize: 11, fontWeight: Typography.weight.bold, letterSpacing: 1.2 },
  photoModeSub: { color: '#93866C', fontSize: 8, letterSpacing: 1 },
  captureTip: { color: '#AFA693', fontSize: 11, textAlign: 'center' },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { color: '#F5E8C9', fontSize: 18, fontWeight: Typography.weight.bold },
  sectionMeta: { color: GOLD, fontSize: 9, letterSpacing: 1 },
  slotStrip: { gap: 10, paddingBottom: 4 },
  slotCard: { width: 112, padding: 7, borderRadius: Radius.md, borderWidth: 1, borderColor: '#3C3426', backgroundColor: PANEL, gap: 5 },
  slotCardSelected: { borderColor: GOLD, backgroundColor: '#211B10' },
  slotImage: { width: '100%', height: 72, borderRadius: Radius.sm },
  slotPlaceholder: { height: 72, borderRadius: Radius.sm, backgroundColor: '#242119', alignItems: 'center', justifyContent: 'center' },
  slotTextRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 4 },
  slotLabel: { flex: 1, color: '#E8DFC9', fontSize: 10, fontWeight: Typography.weight.semibold },
  slotRequirement: { color: '#998B70', fontSize: 8, letterSpacing: 1 },
  errorBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, padding: 12, borderRadius: Radius.md, backgroundColor: Colors.dangerDim },
  errorText: { flex: 1, color: Colors.danger, fontSize: 12, lineHeight: 19 },
  analysisCard: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, borderRadius: Radius.md, backgroundColor: PANEL, borderWidth: 1, borderColor: GOLD_DARK },
  analysisCopy: { flex: 1, gap: 4 },
  analysisTitle: { color: GOLD, fontSize: 14, fontWeight: Typography.weight.semibold },
  warningToggle: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 12, borderRadius: Radius.md, backgroundColor: PANEL },
  resultCard: { padding: 14, borderRadius: Radius.lg, backgroundColor: PANEL, borderWidth: 1, borderColor: GOLD_DARK, gap: 10 },
  primaryButton: { minHeight: 56, borderRadius: Radius.md, paddingHorizontal: 16, backgroundColor: '#E7BD61', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  primaryButtonText: { color: INK, fontSize: 15, fontWeight: Typography.weight.bold },
  disabledButton: { opacity: 0.42 },
  resetButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  resetText: { color: '#B7A985', fontSize: 12 },
  pressed: { opacity: 0.72 },
  guard: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 16 },
});
