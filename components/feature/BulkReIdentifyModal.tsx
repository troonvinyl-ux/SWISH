// BulkReIdentifyModal — re-run AI identification on multiple items at once.
// Uses the swish-identify edge function per item (same as single-item scan).
// Shows live progress, item-by-item results, and updates item specifics/title.

import React, { useState, useCallback } from 'react';
import {
  Modal, View, Text, StyleSheet, Pressable, FlatList,
  ActivityIndicator, ScrollView,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { getSupabaseClient } from '@/template';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { Colors, Typography, Spacing, Radius } from '@/constants/theme';

interface BulkItem {
  id: string;
  canonical_title?: string;
  status?: string;
  specialist_id?: string;
  attributes?: Record<string, any>;
  media?: string[];
}

type ItemResult = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

interface ItemState {
  item: BulkItem;
  result: ItemResult;
  newTitle?: string;
  error?: string;
  confidence?: number;
}

interface BulkReIdentifyProgress {
  current: number;
  total: number;
  done: number;
  failed: number;
}

interface Props {
  visible: boolean;
  items: BulkItem[];
  tenantId: string;
  progress: BulkReIdentifyProgress | null;
  onProgress: (p: BulkReIdentifyProgress | null) => void;
  onClose: () => void;
}

// Only re-identify items that are in draft/identified state (not listed/sold)
const RE_IDENTIFY_ELIGIBLE_STATUSES = [
  'new', 'captured', 'identified', 'researched', 'assessed', 'priced', 'review_required',
];

export default function BulkReIdentifyModal({
  visible, items, tenantId, progress, onProgress, onClose,
}: Props) {
  const [itemStates, setItemStates] = useState<ItemState[]>([]);
  const [running, setRunning] = useState(false);
  const [completed, setCompleted] = useState(false);

  // Only include items that have at least one downloadable HTTPS media URL
  const hasDownloadablePhoto = (item: BulkItem) =>
    (item.media ?? []).some(u =>
      u && typeof u === 'string' && u.startsWith('https://') && !u.includes('data:') && u.length > 20
    );

  const eligibleItems = items.filter(i =>
    (!i.status || RE_IDENTIFY_ELIGIBLE_STATUSES.includes(i.status ?? 'new'))
  );

  const handleStart = useCallback(async () => {
    if (!tenantId || eligibleItems.length === 0) return;
    setRunning(true);
    setCompleted(false);
    const supabase = getSupabaseClient();

    // Init all as pending
    const initial: ItemState[] = eligibleItems.map(item => ({ item, result: 'pending' }));
    setItemStates(initial);

    let done = 0;
    let failed = 0;

    for (let i = 0; i < eligibleItems.length; i++) {
      const item = eligibleItems[i];

      // Mark as running
      setItemStates(prev => prev.map((s, idx) => idx === i ? { ...s, result: 'running' } : s));
      onProgress({ current: i + 1, total: eligibleItems.length, done, failed });

      // Skip items with no usable HTTPS photos
      // Items may have media[] entries that are local file:// or base64 URIs —
      // these cannot be sent to swish-identify which requires a downloadable HTTPS URL.
      const allMedia = item.media ?? [];
      const photoUrl = allMedia.find(u =>
        u &&
        typeof u === 'string' &&
        u.startsWith('https://') &&
        !u.includes('data:') &&
        u.length > 20
      );
      if (!photoUrl) {
        setItemStates(prev => prev.map((s, idx) =>
          idx === i ? { ...s, result: 'skipped', error: allMedia.length > 0 ? 'No downloadable photo (local file)' : 'No photo' } : s));
        continue;
      }

      try {
        // Call swish-identify with the item's first downloadable HTTPS photo
        const { data, error } = await supabase.functions.invoke('swish-identify', {
          body: {
            tenantId,
            itemId: item.id,
            imageUrl: photoUrl,
            image_url: photoUrl,         // alias some edge fn versions use
            specialistId: item.specialist_id ?? 'curiosities_collectibles',
            specialist_id: item.specialist_id ?? 'curiosities_collectibles',
            forceRefresh: true,           // bypass cached identification
            force_refresh: true,
          },
        });

        if (error) {
          let msg = error.message;
          if (error instanceof FunctionsHttpError) {
            try { const t = await error.context?.text(); const p = t ? JSON.parse(t) : null; msg = p?.error ?? t ?? msg; } catch {}
          }
          failed++;
          setItemStates(prev => prev.map((s, idx) =>
            idx === i ? { ...s, result: 'failed', error: msg.slice(0, 80) } : s));
        } else if (data?.success || data?.identification) {
          done++;
          const id = data.identification ?? data;
          setItemStates(prev => prev.map((s, idx) =>
            idx === i ? {
              ...s,
              result: 'done',
              newTitle: id.canonical_title ?? id.title,
              confidence: id.confidence ?? id.identification_confidence,
            } : s));
        } else {
          failed++;
          setItemStates(prev => prev.map((s, idx) =>
            idx === i ? { ...s, result: 'failed', error: data?.error ?? 'No result' } : s));
        }
      } catch (e: any) {
        failed++;
        setItemStates(prev => prev.map((s, idx) =>
          idx === i ? { ...s, result: 'failed', error: e.message?.slice(0, 80) } : s));
      }

      onProgress({ current: i + 1, total: eligibleItems.length, done, failed });

      // Small pause to avoid rate limiting
      if (i < eligibleItems.length - 1) await new Promise(r => setTimeout(r, 300));
    }

    setRunning(false);
    setCompleted(true);
    onProgress(null);
  }, [eligibleItems, tenantId, onProgress]);

  const handleClose = useCallback(() => {
    if (running) return; // prevent close while running
    setItemStates([]);
    setCompleted(false);
    onClose();
  }, [running, onClose]);

  const resultIcon = (r: ItemResult) => {
    switch (r) {
      case 'done':    return <MaterialIcons name="check-circle" size={16} color={Colors.success} />;
      case 'failed':  return <MaterialIcons name="error" size={16} color={Colors.danger} />;
      case 'skipped': return <MaterialIcons name="skip-next" size={16} color={Colors.textTertiary} />;
      case 'running': return <ActivityIndicator size="small" color={Colors.primary} style={{ width: 16, height: 16 }} />;
      default:        return <MaterialIcons name="radio-button-unchecked" size={16} color={Colors.textTertiary} />;
    }
  };

  const doneCount  = itemStates.filter(s => s.result === 'done').length;
  const failedCount = itemStates.filter(s => s.result === 'failed').length;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleClose}>
      <View style={s.container}>
        {/* Header */}
        <View style={s.header}>
          <Pressable onPress={handleClose} disabled={running} style={s.closeBtn} hitSlop={8}>
            <MaterialIcons name="close" size={18} color={Colors.textSecondary} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={s.title}>Bulk Re-Identify</Text>
            <Text style={s.subtitle}>
              {eligibleItems.length} eligible item{eligibleItems.length === 1 ? '' : 's'} · AI identification
            </Text>
          </View>
          <View style={s.aiBadge}>
            <MaterialIcons name="auto-awesome" size={10} color={Colors.accent} />
            <Text style={s.aiBadgeText}>AI</Text>
          </View>
        </View>

        {/* Explanation */}
        {!running && !completed ? (
          <View style={s.explainCard}>
            <MaterialIcons name="info-outline" size={14} color={Colors.info} />
            <Text style={s.explainText}>
              Re-runs the full AI identification pipeline on each eligible item. Updates titles, item specifics, and attributes from photos. Only items with photos are processed. Listed/sold items are skipped.
            </Text>
          </View>
        ) : null}

        {/* Progress summary during/after run */}
        {(running || completed) && itemStates.length > 0 ? (
          <View style={s.progressBar}>
            <View style={[s.progressFill, {
              width: `${Math.round((itemStates.filter(s => s.result !== 'pending' && s.result !== 'running').length / eligibleItems.length) * 100)}%` as any,
            }]} />
          </View>
        ) : null}

        {completed ? (
          <View style={s.summaryCard}>
            <MaterialIcons name="check-circle" size={16} color={Colors.success} />
            <Text style={s.summaryText}>
              Done: {doneCount} updated · {failedCount} failed · {itemStates.filter(s => s.result === 'skipped').length} skipped (no photo)
            </Text>
          </View>
        ) : null}

        {/* Item list */}
        {itemStates.length > 0 ? (
          <FlatList
            data={itemStates}
            keyExtractor={s => s.item.id}
            contentContainerStyle={{ paddingHorizontal: Spacing.base, paddingVertical: Spacing.md, gap: Spacing.sm }}
            showsVerticalScrollIndicator={false}
            renderItem={({ item: state }) => (
              <View style={[s.itemRow, state.result === 'running' && s.itemRowActive]}>
                <View style={s.itemIcon}>{resultIcon(state.result)}</View>
                <View style={{ flex: 1 }}>
                  <Text style={s.itemTitle} numberOfLines={1}>
                    {state.newTitle ?? state.item.canonical_title ?? 'Untitled'}
                  </Text>
                  {state.result === 'done' && state.newTitle && state.newTitle !== state.item.canonical_title ? (
                    <Text style={s.itemOld} numberOfLines={1}>Was: {state.item.canonical_title}</Text>
                  ) : null}
                  {state.error ? (
                    <Text style={s.itemError} numberOfLines={1}>{state.error}</Text>
                  ) : null}
                  {state.result === 'done' && state.confidence != null ? (
                    <Text style={s.itemConfidence}>
                      Confidence: {Math.round((state.confidence ?? 0) * 100)}%
                    </Text>
                  ) : null}
                </View>
              </View>
            )}
          />
        ) : (
          <ScrollView contentContainerStyle={{ paddingHorizontal: Spacing.base, paddingVertical: Spacing.md }}>
            <Text style={s.eligibleNote}>
              {(() => {
                const withPhoto = eligibleItems.filter(hasDownloadablePhoto).length;
                const withoutPhoto = eligibleItems.length - withPhoto;
                if (eligibleItems.length === 0) return 'No eligible items found. Items must be in draft/identified status.';
                return `${withPhoto} item${withPhoto === 1 ? '' : 's'} will be re-identified${withoutPhoto > 0 ? ` · ${withoutPhoto} skipped (no downloadable photo)` : ''}.`;
              })()}
            </Text>
            {eligibleItems.slice(0, 8).map(item => (
              <View key={item.id} style={s.previewRow}>
                <MaterialIcons name="toll" size={12} color={Colors.textTertiary} />
                <Text style={s.previewTitle} numberOfLines={1}>
                  {item.canonical_title ?? 'Untitled'}
                </Text>
                {item.media?.some(u => u?.startsWith('https://')) ? (
                  <MaterialIcons name="photo" size={11} color={Colors.success} />
                ) : (
                  <MaterialIcons name="broken-image" size={11} color={Colors.warning} />
                )}
              </View>
            ))}
            {eligibleItems.length > 8 ? (
              <Text style={s.moreText}>+ {eligibleItems.length - 8} more items</Text>
            ) : null}
          </ScrollView>
        )}

        {/* Action buttons */}
        <View style={s.footer}>
          {!running && !completed ? (
            <Pressable
              onPress={handleStart}
              disabled={eligibleItems.length === 0}
              style={[s.startBtn, eligibleItems.length === 0 && { opacity: 0.4 }]}
            >
              <MaterialIcons name="auto-awesome" size={16} color={Colors.background} />
              <Text style={s.startBtnText}>
                Start Re-Identify ({eligibleItems.length} items)
              </Text>
            </Pressable>
          ) : running ? (
            <View style={s.runningRow}>
              <ActivityIndicator size="small" color={Colors.primary} />
              <Text style={s.runningText}>
                Processing {itemStates.findIndex(s => s.result === 'running') + 1} of {eligibleItems.length}...
              </Text>
            </View>
          ) : (
            <Pressable onPress={handleClose} style={s.doneBtn}>
              <MaterialIcons name="check" size={16} color={Colors.background} />
              <Text style={s.doneBtnText}>Done — Reload Inventory</Text>
            </Pressable>
          )}
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingHorizontal: Spacing.base, paddingTop: Spacing.lg, paddingBottom: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder,
  },
  closeBtn: {
    width: 32, height: 32, borderRadius: Radius.md, backgroundColor: Colors.surface,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.surfaceBorder,
  },
  title: { fontSize: Typography.size.md, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  subtitle: { fontSize: 10, color: Colors.textTertiary, marginTop: 2 },
  aiBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: Colors.accentDim, borderRadius: Radius.pill,
    paddingHorizontal: 7, paddingVertical: 3, borderWidth: 1, borderColor: Colors.accent + '40',
  },
  aiBadgeText: { fontSize: 9, fontWeight: Typography.weight.bold, color: Colors.accent },
  explainCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm,
    margin: Spacing.base, backgroundColor: Colors.infoDim,
    borderRadius: Radius.md, padding: Spacing.md,
    borderWidth: 1, borderColor: Colors.info + '30',
  },
  explainText: { flex: 1, fontSize: Typography.size.xs, color: Colors.info, lineHeight: 17 },
  progressBar: {
    height: 3, backgroundColor: Colors.surfaceHighlight,
    marginHorizontal: Spacing.base, borderRadius: 2, overflow: 'hidden',
  },
  progressFill: { height: 3, backgroundColor: Colors.primary, borderRadius: 2 },
  summaryCard: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    margin: Spacing.base, backgroundColor: Colors.successDim,
    borderRadius: Radius.md, padding: Spacing.md,
    borderWidth: 1, borderColor: Colors.success + '30',
  },
  summaryText: { flex: 1, fontSize: Typography.size.sm, color: Colors.success, fontWeight: Typography.weight.semibold },
  itemRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm,
    backgroundColor: Colors.surface, borderRadius: Radius.md, padding: Spacing.md,
    borderWidth: 1, borderColor: Colors.surfaceBorder,
  },
  itemRowActive: { borderColor: Colors.primary, backgroundColor: Colors.primaryDim },
  itemIcon: { width: 20, alignItems: 'center', paddingTop: 1 },
  itemTitle: { fontSize: Typography.size.sm, color: Colors.textPrimary, fontWeight: Typography.weight.medium },
  itemOld: { fontSize: 10, color: Colors.textTertiary, marginTop: 2 },
  itemError: { fontSize: 10, color: Colors.danger, marginTop: 2 },
  itemConfidence: { fontSize: 10, color: Colors.success, marginTop: 2 },
  eligibleNote: {
    fontSize: Typography.size.sm, color: Colors.textSecondary, lineHeight: 20,
    marginBottom: Spacing.md,
  },
  previewRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingVertical: Spacing.xs + 2,
    borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder,
  },
  previewTitle: { flex: 1, fontSize: Typography.size.sm, color: Colors.textSecondary },
  moreText: { fontSize: 11, color: Colors.textTertiary, marginTop: Spacing.sm, textAlign: 'center' },
  footer: {
    padding: Spacing.base,
    borderTopWidth: 1, borderTopColor: Colors.surfaceBorder,
  },
  startBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm,
    backgroundColor: Colors.accent, borderRadius: Radius.md, paddingVertical: Spacing.base,
  },
  startBtnText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.background },
  runningRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm,
    paddingVertical: Spacing.md,
  },
  runningText: { fontSize: Typography.size.sm, color: Colors.primary, fontWeight: Typography.weight.medium },
  doneBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm,
    backgroundColor: Colors.success, borderRadius: Radius.md, paddingVertical: Spacing.base,
  },
  doneBtnText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.background },
});
