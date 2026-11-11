import { memo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { PremiumField } from '@/components/ui/PremiumField';
import { ListingDescriptionField } from './ListingDescriptionField';
import { Colors, Spacing, Typography } from '@/constants/theme';
import type { ListingCopyField } from '@/services/listingCopyService';
interface ListingCopyFieldsProps { title: string; description: string; specifics?: Array<{ name: string; value: string }>; accent: string; disabled: boolean; generating: ListingCopyField | null; onChange: (field: ListingCopyField, value: string) => void; onGenerate: (field: ListingCopyField) => void }
// Always visible; never put seller copy or its AI actions inside an advanced accordion.
export const ListingCopyFields = memo(function ListingCopyFields({ title, description, specifics, accent, disabled, generating, onChange, onGenerate }: ListingCopyFieldsProps) {
  return <View style={styles.fields} testID="shared-listing-copy-fields">
    <PremiumField label="Title" value={title} onChange={value => onChange('title', value)} onGenerate={() => onGenerate('title')} maxLength={80} accent={accent} disabled={disabled} generating={generating === 'title'} />
    <ListingDescriptionField description={description} specifics={specifics} onChange={value => onChange('description', value)} onGenerate={() => onGenerate('description')} accent={accent} disabled={disabled} generating={generating === 'description'} />
    <Text accessibilityLiveRegion="polite" style={styles.note}>{generating ? `Writing ${generating} with your niche specialist…` : 'AI updates only the chosen field. Review the text before saving; live eBay listings stay unchanged until you confirm a revision.'}</Text>
  </View>;
});
const styles = StyleSheet.create({ fields: { gap: Spacing.base }, note: { color: Colors.textSecondary, fontSize: Typography.size.sm, lineHeight: Typography.size.sm * Typography.lineHeight.relaxed, includeFontPadding: false } });
