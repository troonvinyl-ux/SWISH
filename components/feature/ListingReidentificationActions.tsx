import { memo } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { PremiumCard } from '@/components/ui/PremiumCard';
import { PremiumStyles } from '@/constants/styles';
import { Colors, Radius, Spacing, Typography } from '@/constants/theme';
interface ListingReidentificationActionsProps {
  listingId: string; externalListingId: string; title: string; live: boolean;
  attributes: Record<string, any>; accent: string; disabled: boolean;
  onOpen: () => void; onUseTitle: (title: string) => void;
}
/** Stages only a seller-reviewed title; research evidence never becomes buyer copy automatically. */
export const ListingReidentificationActions = memo(function ListingReidentificationActions({ listingId, externalListingId, title, live, attributes, accent, disabled, onOpen, onUseTitle }: ListingReidentificationActionsProps) {
  const evidence = attributes._live_reidentification;
  const candidate = live && evidence?.listingId === listingId && evidence?.externalListingId === externalListingId ? evidence?.reviewedTitle : null;
  const reviewedTitle = typeof candidate === 'string' && candidate.trim() && candidate.length <= 80 && candidate !== title ? candidate : null;
  return <PremiumCard title={live ? 'Re-identify live item' : 'Improve identification'} summary={live ? 'Add evidence without ending or changing eBay' : 'Add photos, clues or hints to this saved draft'} accent={accent} icon="auto-awesome">
    <Text style={PremiumStyles.body}>Re-check the same item with your specialist. Review suggestions before applying; nothing is published or revised. Prices and the existing eBay listing are kept.</Text>
    <Pressable disabled={disabled} accessibilityLabel="Re-identify this item with additional photos and clues" onPress={onOpen} style={({ pressed }) => [s.action, pressed || disabled ? s.pressed : null]}><MaterialIcons name="add-photo-alternate" size={22} color={accent}/><Text style={s.text}>Re-identify · add photos & clues</Text></Pressable>
    {attributes._draft_copy_needs_review || attributes._live_copy_needs_review ? <Text style={s.caption}>Identification updated. Review the description, specifics, category and valuation. Any live eBay correction needs a separate revision confirmation.</Text> : null}
    {reviewedTitle ? <><Text style={PremiumStyles.body}>{`Reviewed title: ${reviewedTitle}`}</Text><Pressable disabled={disabled} accessibilityLabel="Use reviewed identification title in the editor without sending to eBay" onPress={() => onUseTitle(reviewedTitle)} style={({ pressed }) => [s.action, pressed || disabled ? s.pressed : null]}><MaterialIcons name="edit-note" size={22} color={accent}/><Text style={s.text}>Use reviewed title · review before revision</Text></Pressable></> : null}
  </PremiumCard>;
});
const s = StyleSheet.create({ action: { minHeight: 48, padding: Spacing.md, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.surfaceBorder, backgroundColor: Colors.surfaceHighlight, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm }, text: { flexShrink: 1, fontSize: Typography.size.base, color: Colors.textPrimary, includeFontPadding: false }, caption: { fontSize: Typography.size.sm, color: Colors.textSecondary, lineHeight: 21 }, pressed: { opacity: 0.6 } });
