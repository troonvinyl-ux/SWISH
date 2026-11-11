import { memo } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { Colors, Radius, Spacing, Typography } from '@/constants/theme';
import type { ListingDescriptionModel } from '@/services/listingDescriptionService';
interface ListingDescriptionPreviewProps { model: ListingDescriptionModel }
// Native read-only preview of the shared eBay template. HTML/CSS is never rewritten from this projection.
export const ListingDescriptionPreview = memo(function ListingDescriptionPreview({ model }: ListingDescriptionPreviewProps) {
  const template = model.mode === 'template';
  const divider = model.credit.indexOf('|');
  return <View style={styles.paper} testID="formatted-listing-description-preview">
    {!template ? <Text style={styles.hint}>Text-only preview of a custom description. Its original HTML is retained; check eBay for its exact layout.</Text> : null}
    {template ? <Text accessibilityRole="header" style={styles.heading}>Item description</Text> : null}
    <View style={template ? styles.narrative : undefined}><Text selectable style={styles.body}>{model.body || 'No description yet.'}</Text></View>
    {template && model.details.length > 0 ? <><Text accessibilityRole="header" style={styles.heading}>Item details</Text><FlatList data={model.details} scrollEnabled={false} keyExtractor={(_, index) => String(index)} renderItem={({ item }) => <View style={styles.detailRow}>{item.name ? <View style={styles.nameCell}><Text selectable style={styles.name}>{item.name}</Text></View> : null}<View style={styles.valueCell}><Text selectable style={styles.body}>{item.value}</Text></View></View>} style={styles.table}/></> : null}
    {template && model.note ? <><Text accessibilityRole="header" style={styles.heading}>Please note</Text><Text selectable style={styles.body}>{model.note}</Text></> : null}
    {template && model.credit ? <View style={styles.credit}><Text style={styles.creditText}>{divider >= 0 ? <><Text style={styles.brand}>{model.credit.slice(0, divider).trim()}</Text>{'  |  ' + model.credit.slice(divider + 1).trim()}</> : model.credit}</Text></View> : null}
    <Text style={styles.hint}>Layout preview · eBay may adapt spacing to the buyer’s screen.</Text>
  </View>;
});
const styles = StyleSheet.create({
  paper: { backgroundColor: Colors.listingPaper, borderRadius: Radius.md, padding: Spacing.base, gap: Spacing.base },
  heading: { color: Colors.listingInk, fontSize: Typography.size.md, fontWeight: Typography.weight.bold, lineHeight: Typography.size.md * Typography.lineHeight.relaxed, includeFontPadding: false },
  body: { color: Colors.listingInk, fontSize: Typography.size.base, lineHeight: Typography.size.base * Typography.lineHeight.relaxed, includeFontPadding: false },
  narrative: { borderWidth: 1, borderColor: Colors.listingRule, padding: Spacing.md },
  table: { borderTopWidth: 1, borderLeftWidth: 1, borderRightWidth: 1, borderColor: Colors.listingRule },
  detailRow: { flexDirection: 'row', alignItems: 'stretch', borderBottomWidth: 1, borderColor: Colors.listingRule },
  nameCell: { width: '38%', padding: Spacing.sm, borderRightWidth: 1, borderColor: Colors.listingRule, justifyContent: 'center' },
  name: { color: Colors.listingInk, fontSize: Typography.size.base, fontWeight: Typography.weight.bold, lineHeight: Typography.size.base * Typography.lineHeight.relaxed, includeFontPadding: false },
  valueCell: { flex: 1, padding: Spacing.sm },
  credit: { backgroundColor: Colors.listingCreditSurface, padding: Spacing.sm },
  creditText: { color: Colors.listingPaper, fontSize: Typography.size.sm, lineHeight: Typography.size.sm * Typography.lineHeight.relaxed, textAlign: 'center' },
  brand: { color: Colors.listingCreditBrand, fontWeight: Typography.weight.bold },
  hint: { color: Colors.listingInk, fontSize: Typography.size.sm, lineHeight: Typography.size.sm * Typography.lineHeight.relaxed, includeFontPadding: false },
});
