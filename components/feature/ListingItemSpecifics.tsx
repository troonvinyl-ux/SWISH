import { memo, useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, Modal, FlatList, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors, Spacing, Typography, Radius } from '@/constants/theme';
import { useListingSpecificsPicker } from '@/hooks/useListingSpecificsPicker';
import { missingRequiredSpecifics, type ListingAspectSummary, type ListingSpecificValue } from '@/services/listingSpecificsPresentationService';

interface ListingItemSpecificsProps {
  specifics: ListingSpecificValue[];
  aspects: ListingAspectSummary[];
  disabled: boolean;
  accent: string;
  onChange: (specifics: ListingSpecificValue[]) => void;
}
interface SpecificFieldProps {
  specific: ListingSpecificValue;
  aspect?: ListingAspectSummary;
  disabled: boolean;
  accent: string;
  onChange: (value: ListingSpecificValue) => void;
  onRemove: () => void;
  onChoose: () => void;
}
const SpecificField = memo(function SpecificField({ specific, aspect, disabled, accent, onChange, onRemove, onChoose }: SpecificFieldProps) {
  const [editingName, setEditingName] = useState(false);
  const selectOnly = aspect?.mode === 'SELECTION_ONLY';
  return <View style={s.field}>
    <View style={s.row}>
      <Text style={s.label}>{specific.name || 'New item specific'}</Text>
      {aspect?.required ? <Text style={s.required}>Required</Text> : null}
      <Pressable accessibilityLabel={`Edit ${specific.name || 'item specific'} field name`} disabled={disabled} onPress={() => setEditingName(value => !value)} style={({ pressed }) => [s.icon, pressed ? s.pressed : null]}><MaterialIcons name={editingName ? 'check' : 'edit'} size={20} color={accent} /></Pressable>
      <Pressable accessibilityLabel={`Remove ${specific.name || 'item specific'}`} disabled={disabled} onPress={onRemove} style={({ pressed }) => [s.icon, pressed ? s.pressed : null]}><MaterialIcons name="close" size={20} color={Colors.textSecondary} /></Pressable>
    </View>
    {editingName || !specific.name ? <View style={s.inputGroup}><Text style={s.caption}>Field name</Text><TextInput accessibilityLabel="Item specific field name" value={specific.name} onChangeText={name => onChange({ ...specific, name })} editable={!disabled} style={s.input} /></View> : null}
    {selectOnly ? <Pressable accessibilityLabel={`Choose ${specific.name}`} disabled={disabled} onPress={onChoose} style={({ pressed }) => [s.input, s.row, pressed ? s.pressed : null]}><Text style={[s.value, !specific.value ? s.placeholder : null]}>{specific.value || 'Choose value'}</Text><MaterialIcons name="expand-more" size={22} color={accent} /></Pressable> : <View style={s.row}><TextInput accessibilityLabel={specific.name || 'Item specific value'} value={specific.value} onChangeText={value => onChange({ ...specific, value })} editable={!disabled} placeholder="Enter value" placeholderTextColor={Colors.textSecondary} style={[s.input, s.flex]} />{aspect?.values.length ? <Pressable accessibilityLabel={`Choose a suggested ${specific.name}`} disabled={disabled} onPress={onChoose} style={({ pressed }) => [s.icon, pressed ? s.pressed : null]}><MaterialIcons name="expand-more" size={24} color={accent} /></Pressable> : null}</View>}
  </View>;
});

export const ListingItemSpecifics = memo(function ListingItemSpecifics({ specifics, aspects, disabled, accent, onChange }: ListingItemSpecificsProps) {
  const picker = useListingSpecificsPicker({ aspects, specifics, disabled, onChange });
  const missing = useMemo(() => missingRequiredSpecifics(aspects, specifics), [aspects, specifics]);
  return <View style={s.content}>
    {specifics.map((specific, index) => <SpecificField key={index} specific={specific} aspect={aspects.find(aspect => aspect.name.trim().toLowerCase() === specific.name.trim().toLowerCase())} disabled={disabled} accent={accent} onChange={value => onChange(specifics.map((row, position) => position === index ? value : row))} onRemove={() => onChange(specifics.filter((_, position) => position !== index))} onChoose={() => picker.openValues(index)} />)}
    {missing.map(aspect => <Pressable key={aspect.name} accessibilityLabel={`Add required ${aspect.name}`} disabled={disabled || specifics.length >= 25} onPress={() => onChange([...specifics, { name: aspect.name, value: '' }])} style={({ pressed }) => [s.button, s.row, pressed ? s.pressed : null]}><Text style={s.label}>{aspect.name}</Text><Text style={s.required}>Required</Text><MaterialIcons name="add" size={22} color={accent} /></Pressable>)}
    <Pressable disabled={disabled || specifics.length >= 25} onPress={picker.openFields} style={({ pressed }) => [s.button, pressed ? s.pressed : null, disabled || specifics.length >= 25 ? s.disabled : null]}><Text style={[s.action, { color: accent }]}>Add item specific</Text></Pressable>
    <Modal visible={picker.target !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={picker.close}>
      <SafeAreaView edges={['top', 'bottom']} style={s.screen}><KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={s.header}><Text style={s.title}>{picker.target?.kind === 'value' ? picker.target.name : 'Add item specific'}</Text><Pressable accessibilityLabel="Close choices" onPress={picker.close} style={({ pressed }) => [s.icon, pressed ? s.pressed : null]}><MaterialIcons name="close" size={24} color={accent} /></Pressable></View>
        <View style={s.search}><Text style={s.caption}>Search {picker.target?.kind === 'value' ? 'values' : 'fields'}</Text><TextInput accessibilityLabel={picker.target?.kind === 'value' ? 'Search item specific values' : 'Search item specific fields'} value={picker.query} onChangeText={picker.setQuery} autoCorrect={false} placeholder="Search" placeholderTextColor={Colors.textSecondary} style={s.input} /></View>
        <FlatList data={picker.suggestions.values} keyExtractor={value => value} style={s.flex} contentContainerStyle={s.options} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} renderItem={({ item }) => <Pressable disabled={disabled} onPress={() => picker.choose(item)} style={({ pressed }) => [s.option, pressed ? s.pressed : null]}><Text style={s.value}>{item}</Text></Pressable>} ListEmptyComponent={<Text style={s.caption}>No matching choices</Text>} ListFooterComponent={picker.suggestions.hasMore ? <Text style={s.caption}>Search to narrow the choices.</Text> : null} />
        {picker.target?.kind === 'field' ? <View style={s.search}><Pressable disabled={disabled || specifics.length >= 25} onPress={picker.addCustom} style={({ pressed }) => [s.button, pressed ? s.pressed : null]}><Text style={[s.action, { color: accent }]}>Add custom field</Text></Pressable></View> : null}
      </KeyboardAvoidingView></SafeAreaView>
    </Modal>
  </View>;
});

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background }, flex: { flex: 1 },
  content: { gap: Spacing.base }, field: { gap: Spacing.sm, paddingBottom: Spacing.base, borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }, label: { flex: 1, color: Colors.textPrimary, fontSize: Typography.size.base, fontWeight: Typography.weight.semibold },
  required: { color: Colors.textSecondary, fontSize: Typography.size.sm }, icon: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  inputGroup: { gap: Spacing.xs }, input: { minHeight: 48, backgroundColor: Colors.surfaceHighlight, borderColor: Colors.surfaceBorder, borderWidth: 1, borderRadius: Radius.md, padding: Spacing.md, color: Colors.textPrimary, fontSize: Typography.size.base, includeFontPadding: false },
  value: { flex: 1, color: Colors.textPrimary, fontSize: Typography.size.base, lineHeight: 26 }, placeholder: { color: Colors.textSecondary }, caption: { color: Colors.textSecondary, fontSize: Typography.size.base, lineHeight: 26 },
  button: { minHeight: 48, padding: Spacing.md, backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.md, justifyContent: 'center' }, action: { fontSize: Typography.size.base, fontWeight: Typography.weight.semibold },
  header: { flexDirection: 'row', alignItems: 'center', padding: Spacing.base, gap: Spacing.sm, borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder }, title: { flex: 1, color: Colors.textPrimary, fontSize: Typography.size.lg, fontWeight: Typography.weight.semibold },
  search: { padding: Spacing.base, gap: Spacing.sm }, options: { paddingHorizontal: Spacing.base, paddingBottom: Spacing.base, gap: Spacing.sm }, option: { minHeight: 48, padding: Spacing.md, borderRadius: Radius.md, backgroundColor: Colors.surfaceHighlight }, pressed: { opacity: 0.7 }, disabled: { opacity: 0.5 },
});
