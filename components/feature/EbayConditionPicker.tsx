import { memo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import type { AntiqueConditionPolicy } from '@/shared/antiqueListingPolicy';
import { Colors, Spacing, Typography, Radius } from '@/constants/theme';
interface EbayConditionPickerProps { policy: AntiqueConditionPolicy; selected: string; onSelect: (id: string) => void; accent: string; disabled?: boolean }
export const EbayConditionPicker = memo(function EbayConditionPicker({ policy, selected, onSelect, accent, disabled = false }: EbayConditionPickerProps) {
  const choices = Array.isArray(policy.itemConditions) ? policy.itemConditions : [];
  return <View style={s.block} accessibilityLabel="eBay condition options">
    <Text style={s.label}>eBay condition</Text>
    {choices.length ? <Text style={s.hint}>Choose the option that matches your item. Your detailed grades and defect notes stay unchanged.</Text> : <Text style={s.hint}>{policy.itemConditionRequired ? 'Condition options are unavailable. Recheck category requirements.' : 'This category does not require an eBay condition.'}</Text>}
    {choices.map(choice => {
      const id = String(choice.conditionId); const checked = selected === id;
      return <Pressable key={id} accessibilityRole="radio" accessibilityLabel={choice.conditionDescription} accessibilityState={{ checked, disabled }} disabled={disabled} onPress={() => onSelect(id)} style={({ pressed }) => [s.option, checked ? { borderColor: accent } : null, pressed || disabled ? s.dim : null]}>
        <MaterialIcons name={checked ? 'radio-button-checked' : 'radio-button-unchecked'} size={24} color={checked ? accent : Colors.textSecondary}/>
        <Text style={s.value}>{choice.conditionDescription}</Text>
      </Pressable>;
    })}
  </View>;
});
const s = StyleSheet.create({ block: { gap: Spacing.sm }, label: { color: Colors.textPrimary, fontSize: Typography.size.base, fontWeight: Typography.weight.semibold, includeFontPadding: false }, hint: { color: Colors.textSecondary, fontSize: Typography.size.base, lineHeight: Typography.size.base * Typography.lineHeight.relaxed }, option: { minHeight: Spacing.section, padding: Spacing.md, gap: Spacing.md, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: Colors.surfaceBorder, borderRadius: Radius.md, backgroundColor: Colors.surfaceHighlight }, value: { flex: 1, color: Colors.textPrimary, fontSize: Typography.size.base, fontWeight: Typography.weight.medium, includeFontPadding: false }, dim: { opacity: 0.6 } });
