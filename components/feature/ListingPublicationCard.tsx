import { memo } from 'react';
import { View, Text, Pressable, StyleSheet, Linking } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors, Spacing, Typography, Radius } from '@/constants/theme';
interface ListingPublicationCardProps {
  accepted: boolean; live: boolean; pending: boolean; externalListingId?: string;
  error?: string | null; onViewItem: () => void; onLinkError: () => void;
}
export const ListingPublicationCard = memo(function ListingPublicationCard({ accepted, live, pending, externalListingId, error, onViewItem, onLinkError }: ListingPublicationCardProps) {
  const color = accepted && !pending ? Colors.success : Colors.warning;
  return <View style={[s.card, { borderColor: color }]}>
    <View style={s.heading}><MaterialIcons name={accepted ? 'check-circle' : 'info-outline'} size={28} color={color}/><Text style={s.title}>{accepted ? live ? 'Published on eBay' : 'Existing eBay listing' : 'Check publication status'}</Text></View>
    <Text style={s.body}>{accepted ? pending ? 'eBay accepted this listing. SWISH stock synchronisation is pending. Do not submit again.' : 'The saved eBay listing and stock status are synchronised. No further submission is needed.' : 'The request may have reached eBay. Check or synchronise the existing listing before any further action; do not create a duplicate.'}</Text>
    {externalListingId ? <Text selectable style={s.reference}>eBay item {externalListingId}</Text> : null}
    {error ? <Text accessibilityRole="alert" style={s.error}>{error}</Text> : null}
    <View style={s.actions}>
      <Pressable onPress={onViewItem} style={({ pressed }) => [s.button, pressed ? s.pressed : null]}><MaterialIcons name="inventory-2" size={20} color={Colors.textPrimary}/><Text style={s.buttonText}>View saved listing</Text></Pressable>
      {externalListingId && /^\d+$/.test(externalListingId) ? <Pressable accessibilityLabel="Open existing listing on eBay" onPress={() => { void Linking.openURL(`https://www.ebay.co.uk/itm/${externalListingId}`).catch(onLinkError); }} style={({ pressed }) => [s.button, pressed ? s.pressed : null]}><MaterialIcons name="open-in-new" size={20} color={Colors.textPrimary}/><Text style={s.buttonText}>View on eBay</Text></Pressable> : null}
    </View>
  </View>;
});
const s = StyleSheet.create({ card: { padding: Spacing.base, gap: Spacing.md, borderRadius: Radius.xl, borderWidth: 1, backgroundColor: Colors.surface }, heading: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }, title: { flex: 1, fontSize: Typography.size.lg, fontWeight: Typography.weight.bold, color: Colors.textPrimary, includeFontPadding: false }, body: { fontSize: Typography.size.base, lineHeight: Typography.size.base * Typography.lineHeight.relaxed, color: Colors.textSecondary }, reference: { fontSize: Typography.size.base, color: Colors.textPrimary, fontWeight: Typography.weight.semibold }, error: { fontSize: Typography.size.base, lineHeight: Typography.size.base * Typography.lineHeight.relaxed, color: Colors.warning }, actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm }, button: { minHeight: Spacing.section, padding: Spacing.md, borderRadius: Radius.md, backgroundColor: Colors.surfaceHighlight, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }, buttonText: { color: Colors.textPrimary, fontSize: Typography.size.base, fontWeight: Typography.weight.semibold }, pressed: { opacity: 0.65 } });
