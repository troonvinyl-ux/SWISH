import { memo } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors, Radius, Spacing, Typography } from '@/constants/theme';
import type { AntiqueCategoryHint, AntiqueCategoryCandidate } from '@/services/listingEditorService';
interface AntiqueCategorySuggestionsProps {
  hint: AntiqueCategoryHint | null;
  suggestions: AntiqueCategoryCandidate[];
  source: string;
  error: string | null;
  busy: boolean;
  saving: boolean;
  onSuggest: () => void;
  onSelect: (id: string, name: string) => void;
}
export const AntiqueCategorySuggestions = memo(function AntiqueCategorySuggestions({ hint, suggestions, source, error, busy, saving, onSuggest, onSelect }: AntiqueCategorySuggestionsProps) {
  if (!hint) return null;
  const live = source === 'ebay_live';
  return <View style={styles.panel}>
    <View style={styles.header}><MaterialIcons name="category" size={22} color={Colors.specialistGold} /><Text style={styles.title}>Category guidance</Text></View>
    <Text style={styles.lead}>{hint.label}</Text>
    <Text style={styles.body}>{hint.note}</Text>
    <Pressable accessibilityLabel={`Search eBay categories for ${hint.query}`} onPress={onSuggest} disabled={busy || saving} style={({ pressed }) => [styles.button, pressed || busy || saving ? styles.pressed : null]}>
      {busy ? <ActivityIndicator color={Colors.specialistGold} /> : <MaterialIcons name="search" size={20} color={Colors.specialistGold} />}
      <Text style={styles.buttonText}>{busy ? 'Searching eBay…' : hint.ceramic ? 'Find pottery / ceramic categories' : 'Find suitable eBay categories'}</Text>
    </Pressable>
    {error ? <View style={styles.header}><MaterialIcons name="error-outline" size={20} color={Colors.warning} /><Text accessibilityRole="alert" style={styles.body}>{error}</Text></View> : null}
    {suggestions.length ? <>
      <Text style={styles.body}>{live ? 'eBay suggestions — tap to verify and save a category.' : 'Cached category suggestions — each must be verified live before it can be saved.'}</Text>
      <FlatList data={suggestions} scrollEnabled={false} keyExtractor={row => row.id} renderItem={({ item }) => <Pressable accessibilityLabel={`Verify and save ${item.categoryPath}`} onPress={() => onSelect(item.id, item.name)} disabled={busy || saving} style={({ pressed }) => [styles.row, pressed || saving ? styles.pressed : null]}>
        <View style={styles.flex}><Text style={styles.name}>{item.name}</Text><Text style={styles.body}>{item.categoryPath}</Text><Text style={styles.body}>eBay category {item.id} · {live ? 'Live suggestion' : 'Not yet verified'}</Text></View><MaterialIcons name="chevron-right" size={24} color={Colors.specialistGold} />
      </Pressable>} />
    </> : null}
    {saving ? <Text accessibilityRole="alert" style={styles.body}>Verifying category requirements and saving…</Text> : null}
  </View>;
});
const styles = StyleSheet.create({
  panel: { padding: Spacing.base, gap: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.specialistSurface, borderWidth: 1, borderColor: Colors.specialistBorder },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  title: { color: Colors.specialistGold, fontSize: Typography.size.md, fontWeight: Typography.weight.semibold, includeFontPadding: false },
  lead: { color: Colors.textPrimary, fontSize: Typography.size.lg, fontWeight: Typography.weight.bold, includeFontPadding: false },
  body: { flexShrink: 1, color: Colors.textSecondary, fontSize: Typography.size.base, lineHeight: Typography.size.base * Typography.lineHeight.relaxed, includeFontPadding: false },
  button: { minHeight: 48, padding: Spacing.md, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.specialistBorder, backgroundColor: Colors.surface, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm },
  buttonText: { flexShrink: 1, color: Colors.specialistGold, fontSize: Typography.size.base, fontWeight: Typography.weight.semibold },
  row: { minHeight: 48, paddingVertical: Spacing.base, gap: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.specialistBorder, flexDirection: 'row', alignItems: 'center' },
  name: { color: Colors.textPrimary, fontSize: Typography.size.base, fontWeight: Typography.weight.semibold },
  flex: { flex: 1, gap: Spacing.xs }, pressed: { opacity: 0.7 },
});
