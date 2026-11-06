import { memo } from 'react';
import { View, Text, FlatList, Pressable, Linking, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors, Spacing, Radius, Typography } from '@/constants/theme';
import type { NumistaImageSearchResult } from '@/shared/numistaImageSearch';
interface NumistaImageSearchCardProps { result?: NumistaImageSearchResult | null }
export const NumistaImageSearchCard = memo(function NumistaImageSearchCard({ result }: NumistaImageSearchCardProps) {
  if (!result) return null;
  return <View style={s.card}>
    <View style={s.heading}><MaterialIcons name="image-search" size={24} color={Colors.gold}/><Text style={s.title}>Numista image search</Text></View>
    <Text style={s.body}>Source: Numista · {result.imageCount} original coin {result.imageCount === 1 ? 'face' : 'faces'}</Text>
    <Text accessibilityRole={result.status === 'unavailable' ? 'alert' : undefined} style={s.body}>{result.message}</Text>
    {result.candidates.length ? <View style={s.rail}><FlatList horizontal data={result.candidates} keyExtractor={candidate => String(candidate.typeId)} showsHorizontalScrollIndicator={false} contentContainerStyle={s.content} renderItem={({ item }) => <Pressable accessibilityLabel={`Open Numista candidate ${item.numistaN}`} onPress={() => { void Linking.openURL(item.url).catch(() => {}); }} style={({ pressed }) => [s.candidate, pressed ? s.pressed : null]}>
      <Text style={s.reference}>{item.numistaN} · visual rank {item.rank}</Text><Text numberOfLines={3} style={s.body}>{item.title}</Text><View style={s.heading}><MaterialIcons name="open-in-new" size={18} color={Colors.gold}/><Text style={s.link}>Compare catalogue</Text></View>
    </Pressable>}/></View> : null}
    <Text style={s.body}>Visual rank is not an identification confidence score. Originals and live listings are unchanged.</Text>
  </View>;
});
const s = StyleSheet.create({
  card: { padding: Spacing.base, gap: Spacing.md, borderRadius: Radius.xl, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.gold },
  heading: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  title: { flexShrink: 1, color: Colors.textPrimary, fontSize: Typography.size.lg, fontWeight: Typography.weight.semibold, includeFontPadding: false },
  body: { color: Colors.textSecondary, fontSize: Typography.size.base, lineHeight: 26, includeFontPadding: false },
  rail: { height: 180 }, content: { gap: Spacing.sm },
  candidate: { width: 240, padding: Spacing.base, gap: Spacing.sm, borderRadius: Radius.lg, backgroundColor: Colors.surfaceHighlight, justifyContent: 'space-between' },
  reference: { color: Colors.gold, fontSize: Typography.size.base, fontWeight: Typography.weight.semibold },
  link: { color: Colors.gold, fontSize: Typography.size.base }, pressed: { opacity: 0.65 },
});
