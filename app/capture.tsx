import { View, Text, StyleSheet, Pressable, FlatList, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { useGenericCapture } from '@/hooks/useGenericCapture';
import { Colors, Spacing, Typography, Radius } from '@/constants/theme';
export default function CaptureScreen() {
  const capture = useGenericCapture(); const router = useRouter();
  return <SafeAreaView style={s.screen}>
    <FlatList data={capture.slots} keyExtractor={slot => slot.id} contentContainerStyle={s.content}
      ListHeaderComponent={<View style={s.block}><Pressable onPress={() => router.back()} style={s.link}><Text style={s.body}>Back</Text></Pressable><Text style={s.title}>{capture.activeNiche.terms.scan}</Text><Text style={s.body}>Capture evidence for the selected specialist. AI results remain proposals until you save.</Text></View>}
      renderItem={({ item: slot }) => <View style={s.card}><Text style={s.section}>{slot.label}{slot.required ? ' · recommended evidence' : ''}</Text><Text style={s.body}>{slot.description}</Text>
        {capture.images.find(image => image.slotId === slot.id) ? <Image source={{ uri: capture.images.find(image => image.slotId === slot.id)!.uri }} transition={200} contentFit="cover" style={s.photo} /> : null}
        <View style={s.row}><Pressable disabled={capture.busy} onPress={() => { void capture.capture(slot.id, false); }} style={({ pressed }) => [s.secondary, { opacity: pressed ? 0.7 : 1 }]}><Text style={s.body}>Camera</Text></Pressable><Pressable disabled={capture.busy} onPress={() => { void capture.capture(slot.id, true); }} style={({ pressed }) => [s.secondary, { opacity: pressed ? 0.7 : 1 }]}><Text style={s.body}>Upload photo</Text></Pressable></View>
      </View>}
      ListFooterComponent={<View style={s.block}>
        {capture.error ? <Text style={s.error}>{capture.error}</Text> : null}
        {capture.result ? <View style={s.card}><Text style={s.title}>{capture.result.canonicalTitle}</Text><Text style={s.body}>{Math.round(capture.result.confidence * 100)}% confidence · AI proposal</Text><Text style={s.body}>{capture.result.condition}</Text></View> : null}
        <Pressable disabled={capture.busy || !capture.images.length} onPress={() => { if (capture.savedId) router.replace(`/item/${capture.savedId}` as any); else if (capture.result) void capture.save(); else void capture.identify(); }} style={({ pressed }) => [s.button, { backgroundColor: capture.activeNiche.color, opacity: capture.busy || pressed ? 0.6 : 1 }]}>
          {capture.busy ? <ActivityIndicator color={Colors.background} /> : <Text style={s.buttonText}>{capture.savedId ? 'View saved item' : capture.result ? 'Save to inventory' : 'Identify item'}</Text>}
        </Pressable>
      </View>}
    />
  </SafeAreaView>;
}
const s = StyleSheet.create({ screen: { flex: 1, backgroundColor: Colors.background }, content: { padding: Spacing.lg, gap: Spacing.md }, block: { gap: Spacing.md }, title: { color: Colors.textPrimary, fontSize: Typography.size.xl, fontWeight: Typography.weight.bold }, section: { color: Colors.textPrimary, fontSize: Typography.size.md, fontWeight: Typography.weight.semibold }, body: { color: Colors.textSecondary, fontSize: Typography.size.base, lineHeight: 26 }, card: { gap: Spacing.sm, padding: Spacing.md, backgroundColor: Colors.surface, borderRadius: Radius.lg }, row: { flexDirection: 'row', gap: Spacing.sm }, secondary: { padding: Spacing.sm, minHeight: 48, borderRadius: Radius.md, backgroundColor: Colors.surfaceHighlight }, button: { minHeight: 48, padding: Spacing.md, borderRadius: Radius.md, alignItems: 'center' }, buttonText: { color: Colors.background, fontSize: Typography.size.base, fontWeight: Typography.weight.bold }, photo: { width: '100%', aspectRatio: 1, borderRadius: Radius.md }, error: { color: Colors.danger, fontSize: Typography.size.base }, link: { minHeight: 48, justifyContent: 'center' } });
