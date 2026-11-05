import { View, Text, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { PremiumCard } from '@/components/ui/PremiumCard';
import { EbayConditionPicker } from './EbayConditionPicker';
import { usePreflightCondition } from '@/hooks/usePreflightCondition';
import type { AntiqueConditionPolicy } from '@/shared/antiqueListingPolicy';
import { Colors, Spacing, Typography, Radius } from '@/constants/theme';
interface PreflightConditionCardProps { listingId: string; policy: AntiqueConditionPolicy; savedId: string; categoryId: string; accent: string; onSaved: () => void }
export function PreflightConditionCard({ listingId, policy, savedId, categoryId, accent, onSaved }: PreflightConditionCardProps) {
  const state = usePreflightCondition(listingId, categoryId, savedId, onSaved);
  const supported = policy.itemConditions?.some(choice => String(choice.conditionId) === state.selected) === true;
  return <PremiumCard title="Choose your item’s condition" summary="Save your choice here, then recheck submission" icon="fact-check" accent={accent}>
    <EbayConditionPicker policy={policy} selected={state.selected} onSelect={state.choose} accent={accent} disabled={state.busy}/>
    {state.error ? <View style={s.error}><MaterialIcons name="error-outline" size={22} color={Colors.warning}/><Text accessibilityRole="alert" style={s.errorText}>{state.error}</Text></View> : null}
    <Pressable accessibilityLabel="Save eBay condition and recheck listing" disabled={!supported || state.busy} onPress={() => void state.save()} style={({ pressed }) => [s.button, { backgroundColor: accent }, pressed || !supported || state.busy ? s.dim : null]}>
      {state.busy ? <ActivityIndicator color={Colors.textInverse}/> : <MaterialIcons name="check" size={22} color={Colors.textInverse}/>}
      <Text style={s.buttonText}>{state.busy ? 'Saving condition…' : 'Save condition & recheck'}</Text>
    </Pressable>
  </PremiumCard>;
}
const s = StyleSheet.create({ button: { minHeight: 52, padding: Spacing.md, borderRadius: Radius.lg, flexDirection: 'row', gap: Spacing.sm, alignItems: 'center', justifyContent: 'center' }, buttonText: { fontSize: Typography.size.base, fontWeight: Typography.weight.semibold, color: Colors.textInverse, includeFontPadding: false }, dim: { opacity: 0.6 }, error: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start' }, errorText: { flex: 1, color: Colors.warning, fontSize: Typography.size.base, lineHeight: Typography.size.base * Typography.lineHeight.relaxed } });
