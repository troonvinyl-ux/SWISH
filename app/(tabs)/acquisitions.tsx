// SWISH Acquisitions Screen
// Bulk acquisition management — intake list and navigation to detail screen.

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  Modal,
  ScrollView,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import { useAcquisitions } from '@/hooks/useAcquisitions';
import { AcquisitionCard } from '@/components/feature/AcquisitionCard';
import { calculateAcquisitionSummary } from '@/services/acquisitionService';
import { Colors, Typography, Spacing, Radius, Shadow } from '@/constants/theme';
import { useApp } from '@/hooks/useApp';

export default function AcquisitionsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { acquisitions, loading, addAcquisition, reload } = useAcquisitions();
  const { setActiveAcquisitionId } = useApp();
  const [showAddModal, setShowAddModal] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newSource, setNewSource] = useState('');
  const [newPrice, setNewPrice] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSelectAcquisition = useCallback((id: string) => {
    setActiveAcquisitionId(id);
    router.push(`/acquisition/${id}` as any);
  }, [setActiveAcquisitionId, router]);

  const handleAddAcquisition = useCallback(async () => {
    if (!newTitle.trim()) return;
    setSaving(true);
    try {
      await addAcquisition({
        title: newTitle.trim(),
        source: newSource.trim() || 'Unknown',
        purchasePrice: parseFloat(newPrice) || 0,
      });
      setNewTitle('');
      setNewSource('');
      setNewPrice('');
      setShowAddModal(false);
    } finally {
      setSaving(false);
    }
  }, [newTitle, newSource, newPrice, addAcquisition]);

  const totalExpectedProfit = acquisitions.reduce((sum, a) => {
    return sum + calculateAcquisitionSummary(a).expectedProfit;
  }, 0);

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + Spacing.base }]}>
        <View>
          <Text style={styles.screenTitle}>Acquisitions</Text>
          <Text style={styles.screenSubtitle}>
            {acquisitions.length} active · Est. £{totalExpectedProfit.toLocaleString()} profit
          </Text>
        </View>
        <View style={{ flexDirection: 'row', gap: Spacing.xs }}>
          <Pressable
            onPress={() => router.push('/ebay-import' as any)}
            style={({ pressed }) => [styles.importBtn, pressed && { opacity: 0.8 }]}
          >
            <MaterialIcons name="cloud-download" size={14} color={Colors.info} />
            <Text style={styles.importBtnText}>Import eBay</Text>
          </Pressable>
          <Pressable
            onPress={() => setShowAddModal(true)}
            style={({ pressed }) => [styles.addBtn, pressed && { opacity: 0.8 }]}
          >
            <MaterialIcons name="add" size={20} color={Colors.textPrimary} />
            <Text style={styles.addBtnText}>New</Text>
          </Pressable>
        </View>
      </View>

      {/* Summary strip */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.summaryScroll}>
        <View style={styles.summaryRow}>
          {[
            { label: 'Total Invested', value: `£${acquisitions.reduce((s, a) => s + a.purchasePrice, 0).toLocaleString()}`, color: Colors.warning },
            { label: 'Items Total', value: `${acquisitions.reduce((s, a) => s + a.itemCount, 0)}`, color: Colors.primary },
            { label: 'Listed', value: `${acquisitions.reduce((s, a) => s + a.listedCount, 0)}`, color: Colors.info },
            { label: 'Sold', value: `${acquisitions.reduce((s, a) => s + a.soldCount, 0)}`, color: Colors.success },
          ].map((stat) => (
            <View key={stat.label} style={styles.summaryChip}>
              <Text style={[styles.summaryValue, { color: stat.color }]}>{stat.value}</Text>
              <Text style={styles.summaryLabel}>{stat.label}</Text>
            </View>
          ))}
        </View>
      </ScrollView>

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={Colors.primary} />
        </View>
      ) : (
        <FlatList
          data={acquisitions}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 90 }]}
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => <View style={{ height: Spacing.md }} />}
          renderItem={({ item }) => (
            <AcquisitionCard acquisition={item} onPress={handleSelectAcquisition} />
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <MaterialIcons name="inventory-2" size={48} color={Colors.textTertiary} />
              <Text style={styles.emptyTitle}>No Acquisitions Yet</Text>
              <Text style={styles.emptySubtitle}>Tap "New" to add your first bulk acquisition</Text>
            </View>
          }
        />
      )}

      {/* Add Modal */}
      <Modal visible={showAddModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { paddingBottom: insets.bottom + Spacing.base }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>New Acquisition</Text>
              <Pressable onPress={() => setShowAddModal(false)}>
                <MaterialIcons name="close" size={24} color={Colors.textSecondary} />
              </Pressable>
            </View>

            <View style={styles.form}>
              <View style={styles.formField}>
                <Text style={styles.formLabel}>Title *</Text>
                <TextInput
                  style={styles.input}
                  value={newTitle}
                  onChangeText={setNewTitle}
                  placeholder="e.g. House Clearance — Manchester"
                  placeholderTextColor={Colors.textTertiary}
                  autoFocus
                />
              </View>
              <View style={styles.formField}>
                <Text style={styles.formLabel}>Source</Text>
                <TextInput
                  style={styles.input}
                  value={newSource}
                  onChangeText={setNewSource}
                  placeholder="e.g. Estate Agent, Auction, Direct"
                  placeholderTextColor={Colors.textTertiary}
                />
              </View>
              <View style={styles.formField}>
                <Text style={styles.formLabel}>Purchase Price (£)</Text>
                <TextInput
                  style={styles.input}
                  value={newPrice}
                  onChangeText={setNewPrice}
                  placeholder="0.00"
                  placeholderTextColor={Colors.textTertiary}
                  keyboardType="decimal-pad"
                />
              </View>
            </View>

            <Pressable
              onPress={handleAddAcquisition}
              style={({ pressed }) => [styles.saveBtn, saving && { opacity: 0.7 }, pressed && { opacity: 0.85 }]}
              disabled={saving || !newTitle.trim()}
            >
              {saving ? (
                <ActivityIndicator color={Colors.textPrimary} size="small" />
              ) : (
                <Text style={styles.saveBtnText}>Create Acquisition</Text>
              )}
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    paddingHorizontal: Spacing.base,
    paddingBottom: Spacing.md,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceBorder,
  },
  screenTitle: {
    fontSize: Typography.size.xl,
    fontWeight: Typography.weight.bold,
    color: Colors.textPrimary,
  },
  screenSubtitle: {
    fontSize: Typography.size.xs,
    color: Colors.textTertiary,
    marginTop: 2,
  },
  importBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.infoDim,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.info + '40',
  },
  importBtnText: {
    fontSize: Typography.size.sm,
    fontWeight: Typography.weight.semibold,
    color: Colors.info,
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.primary,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.pill,
  },
  addBtnText: {
    fontSize: Typography.size.sm,
    fontWeight: Typography.weight.semibold,
    color: Colors.textPrimary,
  },
  summaryScroll: {
    maxHeight: 72,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceBorder,
  },
  summaryRow: {
    flexDirection: 'row',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.sm,
  },
  summaryChip: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    alignItems: 'center',
    gap: 2,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  summaryValue: {
    fontSize: Typography.size.md,
    fontWeight: Typography.weight.bold,
    color: Colors.textPrimary,
  },
  summaryLabel: {
    fontSize: Typography.size.xs - 1,
    color: Colors.textTertiary,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: {
    padding: Spacing.base,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.hero,
    gap: Spacing.md,
  },
  emptyTitle: {
    fontSize: Typography.size.lg,
    fontWeight: Typography.weight.semibold,
    color: Colors.textSecondary,
  },
  emptySubtitle: {
    fontSize: Typography.size.sm,
    color: Colors.textTertiary,
    textAlign: 'center',
  },
  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: Colors.overlay80,
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: Colors.surfaceElevated,
    borderTopLeftRadius: Radius.xxl,
    borderTopRightRadius: Radius.xxl,
    padding: Spacing.xl,
    gap: Spacing.xl,
    borderTopWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modalTitle: {
    fontSize: Typography.size.xl,
    fontWeight: Typography.weight.bold,
    color: Colors.textPrimary,
  },
  form: { gap: Spacing.md },
  formField: { gap: Spacing.xs },
  formLabel: {
    fontSize: Typography.size.xs,
    fontWeight: Typography.weight.medium,
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  input: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    borderRadius: Radius.md,
    padding: Spacing.md,
    fontSize: Typography.size.base,
    color: Colors.textPrimary,
  },
  saveBtn: {
    backgroundColor: Colors.primary,
    borderRadius: Radius.md,
    padding: Spacing.base,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  saveBtnText: {
    fontSize: Typography.size.base,
    fontWeight: Typography.weight.semibold,
    color: Colors.textPrimary,
  },
});
