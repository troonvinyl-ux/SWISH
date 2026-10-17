// SWISH — eBay Draft Category Round-Trip Test
// A deliberately non-destructive entry point for the category round-trip test.
// This screen does not publish, create, revise, or delete any eBay listing.
// Actual Inventory API draft-offer support must be implemented before live testing.

import React from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors, Typography, Spacing, Radius } from '@/constants/theme';

export default function EbayDraftSyncTestScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <View style={[styles.header, { paddingTop: insets.top + Spacing.base }]}>
        <Pressable onPress={() => router.back()} style={styles.back} accessibilityLabel="Go back">
          <MaterialIcons name="arrow-back" size={20} color={Colors.textPrimary} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Draft Category Test</Text>
          <Text style={styles.subtitle}>eBay UK · SWISH sync verification</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.xl }]}>
        <View style={styles.notice}>
          <MaterialIcons name="construction" size={22} color={Colors.warning} />
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={styles.noticeTitle}>Test harness not ready for live testing</Text>
            <Text style={styles.body}>
              This entry is now reserved for the draft category round-trip test. The live draft-offer
              import and update operations are not connected yet, so this screen will not make any
              changes to eBay or your SWISH inventory.
            </Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Planned test sequence</Text>
        {[
          'Select an existing unpublished eBay draft using its offer ID or SKU.',
          'Read its current category and listing fields into a temporary test snapshot.',
          'Compare the eBay category with SWISH and push an unchanged draft update.',
          'Change the category directly on eBay, refresh the snapshot, and verify SWISH does not restore the stale category.',
        ].map((step, index) => (
          <View style={styles.step} key={step}>
            <View style={styles.stepNumber}><Text style={styles.stepNumberText}>{index + 1}</Text></View>
            <Text style={styles.body}>{step}</Text>
          </View>
        ))}

        <View style={styles.safety}>
          <MaterialIcons name="shield" size={18} color={Colors.success} />
          <Text style={styles.safetyText}>
            Safety rule: do not publish the test listing. The completed test will use draft-only update
            operations and report the before/after category IDs and any field differences.
          </Text>
        </View>

        <Pressable onPress={() => router.push('/ebay-hub' as any)} style={styles.button}>
          <MaterialIcons name="arrow-back" size={16} color={Colors.background} />
          <Text style={styles.buttonText}>Return to eBay Hub</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingHorizontal: Spacing.base, paddingBottom: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder },
  back: { width: 38, height: 38, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.surfaceBorder },
  title: { fontSize: Typography.size.xl, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  subtitle: { fontSize: Typography.size.xs, color: Colors.textTertiary, marginTop: 2 },
  content: { padding: Spacing.base, gap: Spacing.md },
  notice: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md, padding: Spacing.base, borderRadius: Radius.xl, borderWidth: 1, borderColor: Colors.warning + '55', backgroundColor: Colors.surface },
  noticeTitle: { fontSize: Typography.size.md, fontWeight: Typography.weight.bold, color: Colors.warning },
  body: { fontSize: Typography.size.sm, color: Colors.textSecondary, lineHeight: 21 },
  sectionTitle: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.textPrimary, marginTop: Spacing.sm },
  step: { flexDirection: 'row', gap: Spacing.md, alignItems: 'flex-start', paddingVertical: Spacing.xs },
  stepNumber: { width: 26, height: 26, borderRadius: 13, backgroundColor: Colors.surfaceHighlight, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.surfaceBorder },
  stepNumberText: { fontSize: Typography.size.xs, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  safety: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, padding: Spacing.md, borderRadius: Radius.md, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.success + '40' },
  safetyText: { flex: 1, fontSize: Typography.size.xs, color: Colors.textSecondary, lineHeight: 19 },
  button: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.primary, borderRadius: Radius.md, paddingVertical: Spacing.md, marginTop: Spacing.sm },
  buttonText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.background },
});
