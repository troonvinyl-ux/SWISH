import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { PremiumField } from '@/components/ui/PremiumField';
import { ListingDescriptionPreview } from './ListingDescriptionPreview';
import { useListingDescription } from '@/hooks/useListingDescription';
import { Colors, Radius, Spacing, Typography } from '@/constants/theme';
interface ListingDescriptionFieldProps { description: string; specifics?: Array<{ name: string; value: string }>; accent: string; disabled: boolean; generating: boolean; onChange: (value: string) => void; onGenerate: () => void }
export const ListingDescriptionField = memo(function ListingDescriptionField({ description, specifics = [], accent, disabled, generating, onChange, onGenerate }: ListingDescriptionFieldProps) {
  const field = useListingDescription(description, specifics, onChange);
  return <View style={styles.field}>
    <PremiumField label="Description" value={field.model.text} onChange={field.changeText} onGenerate={onGenerate} multiline accent={accent} disabled={disabled} generating={generating}/>
    <Text style={styles.note}>{field.model.mode === 'template' ? 'Edit the description text here. Your headings, details table and branded footer are preserved.' : field.model.mode === 'source' ? 'Custom HTML source is preserved exactly. Editing this source changes its formatting; Preview is read-only.' : 'Paragraphs are preserved. AI creates the formatted niche template for review.'}</Text>
    <View style={styles.actions}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: field.preview }} onPress={field.preview ? field.showEditor : field.showPreview} style={({ pressed }) => [styles.button, pressed ? styles.pressed : null]}><MaterialIcons name={field.preview ? 'visibility-off' : 'visibility'} size={20} color={accent}/><Text style={[styles.actionText, { color: accent }]}>{field.preview ? 'Hide preview' : 'Preview formatting'}</Text></Pressable>
      {field.canRestore ? <Pressable disabled={disabled} accessibilityRole="button" accessibilityLabel="Restore description formatting without changing wording or publishing" onPress={field.restore} style={({ pressed }) => [styles.button, pressed || disabled ? styles.pressed : null]}><MaterialIcons name="format-paint" size={20} color={accent}/><Text style={[styles.actionText, { color: accent }]}>Restore formatting</Text></Pressable> : null}
    </View>
    {field.canRestore ? <Text style={styles.note}>Restore adds the layout back to this flattened description without regenerating its wording. Review, save, then separately confirm Revise on eBay for an existing live listing.</Text> : null}
    {field.preview ? <ListingDescriptionPreview model={field.model}/> : null}
  </View>;
});
const styles = StyleSheet.create({ field: { gap: Spacing.sm }, actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm }, button: { minHeight: 48, paddingHorizontal: Spacing.md, borderRadius: Radius.md, backgroundColor: Colors.surfaceHighlight, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }, actionText: { fontSize: Typography.size.base, fontWeight: Typography.weight.semibold }, note: { color: Colors.textSecondary, fontSize: Typography.size.sm, lineHeight: Typography.size.sm * Typography.lineHeight.relaxed, includeFontPadding: false }, pressed: { opacity: 0.65 } });
