// KEENONCOINS — eBay Import Screen
// Fetches active eBay listings via Trading API GetMyeBaySelling,
// allows mapping each to a folder/catalogue number before import.
// One physical item = one inventory record. Prevents duplicates.
// Also supports bulk "Import eBay Images" to patch missing gallery URLs.

import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, FlatList, Pressable,
  ActivityIndicator, TextInput, RefreshControl, Modal,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { getSupabaseClient } from '@/template';
import { Colors, Typography, Spacing, Radius, Shadow } from '@/constants/theme';
import { useApp } from '@/hooks/useApp';
import { useAlert } from '@/template';
import {
  EbayImportCandidate,
  getExistingEbayItemIds,
  importEbayCandidate,
  logImportRun,
} from '@/services/coinInventoryService';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ImportItem extends EbayImportCandidate {
  selected: boolean;
  ebayStatus?: 'active' | 'sold' | 'ended';
}

interface ImageImportProgress {
  current: number;
  total: number;
  updated: number;
  failed: number;
  done: boolean;
}

interface RepairDiagnostic {
  totalImported: number;
  missingEbayId: number;
  missingCategory: number;
  missingDescription: number;
  incompleteMedia: number;
  needsRepair: number;
  scanned: boolean;
}

interface RepairProgress {
  phase: 'scan' | 'enrich' | 'images' | 'done';
  current: number;
  total: number;
  repairedCategory: number;
  repairedDescription: number;
  repairedEbayId: number;
  imagesDownloaded: number;
  failed: number;
  done: boolean;
}

// ── Import eBay Images helper ─────────────────────────────────────────────────
// Fetches fresh s-l500.jpg gallery URLs from the Trading API for all items that
// already have an external_listing_id but are missing media entries.

// Helper: is a URL a real permanent image (Supabase Storage or valid eBay CDN)?
function isValidImageUrl(url: string): boolean {
  if (!url) return false;
  if (!url.startsWith('https://')) return false;
  // Local file:// paths that crept in
  if (url.startsWith('file://')) return false;
  return true;
}

/**
 * Downloads eBay images and stores them permanently in Supabase Storage.
 * BUG C/D FIX: Uses swish-image-download with targeted itemIds so that
 * GetItem is called for each item and ALL PictureURL elements are retrieved
 * (not just GalleryURL from GetMyeBaySelling).
 * NEVER writes media: [singleUrl] — that would destroy multi-image galleries.
 *
 * @param tenantId  - The tenant ID
 * @param onProgress - Progress callback
 * @param targetItemIds - Optional: only process these item IDs (used after import)
 */
async function fetchAndUpdateEbayImages(
  tenantId: string,
  onProgress: (p: ImageImportProgress) => void,
  targetItemIds?: string[],
): Promise<void> {
  const supabase = getSupabaseClient();

  // Determine which items need processing
  // If targetItemIds is provided, use those directly.
  // Otherwise, find all items that have _ebay_item_id but incomplete gallery.
  let itemIdsToProcess: string[] = targetItemIds ?? [];

  if (!targetItemIds || targetItemIds.length === 0) {
    // Find all items that have an eBay listing but may need image work
    const { data: listingRows } = await supabase
      .from('listings')
      .select('item_id')
      .eq('tenant_id', tenantId)
      .not('external_listing_id', 'is', null)
      .neq('external_listing_id', '');

    if (!listingRows?.length) {
      onProgress({ current: 0, total: 0, updated: 0, failed: 0, done: true });
      return;
    }

    itemIdsToProcess = listingRows.map(l => l.item_id).filter(Boolean);
  }

  if (itemIdsToProcess.length === 0) {
    onProgress({ current: 0, total: 0, updated: 0, failed: 0, done: true });
    return;
  }

  const total = itemIdsToProcess.length;
  onProgress({ current: 0, total, updated: 0, failed: 0, done: false });

  // Call swish-image-download with targeted itemIds.
  // This edge function calls GetItem for each item (not GetMyeBaySelling)
  // and downloads ALL PictureURL elements, not just GalleryURL.
  // It will never overwrite a multi-image gallery with a single image.
  try {
    const { data: dlData, error: dlError } = await supabase.functions.invoke('swish-image-download', {
      body: { tenantId, itemIds: itemIdsToProcess, fixTitles: true },
    });

    if (dlError) {
      console.warn('Image download edge function error:', (dlError as any)?.message);
      onProgress({ current: total, total, updated: 0, failed: total, done: true });
      return;
    }

    const downloaded = dlData?.imagesDownloaded ?? 0;
    const failed = dlData?.imagesFailed ?? 0;
    onProgress({ current: total, total, updated: downloaded, failed, done: true });
  } catch (e: any) {
    console.warn('swish-image-download call failed:', e?.message);
    onProgress({ current: total, total, updated: 0, failed: total, done: true });
  }
}

// ── Repair imported listings ─────────────────────────────────────────────────
// Scans all existing imported eBay listings for missing fields and repairs
// them using GetItem + swish-image-download. Never creates duplicates.

async function scanRepairNeeded(
  tenantId: string,
): Promise<RepairDiagnostic> {
  const supabase = getSupabaseClient();

  const { data: rows } = await supabase
    .from('listings')
    .select('id, category_id, item_id, items(id, description, media, attributes)')
    .eq('tenant_id', tenantId)
    .eq('marketplace_id', 'ebay')
    .not('external_listing_id', 'is', null)
    .neq('external_listing_id', '');

  if (!rows || rows.length === 0) {
    return { totalImported: 0, missingEbayId: 0, missingCategory: 0, missingDescription: 0, incompleteMedia: 0, needsRepair: 0, scanned: true };
  }

  let missingEbayId = 0;
  let missingCategory = 0;
  let missingDescription = 0;
  let incompleteMedia = 0;

  for (const row of rows) {
    const item = (row as any).items as any;
    const attrs: Record<string, any> = item?.attributes ?? {};
    const media: string[] = Array.isArray(item?.media) ? item.media : [];
    const permanentMedia = media.filter((u: string) => u?.includes('supabase') || u?.includes('onspace'));

    if (!attrs['_ebay_item_id']) missingEbayId++;
    if (!row.category_id) missingCategory++;
    if (!item?.description || String(item.description).trim().length < 10) missingDescription++;
    if (permanentMedia.length === 0) incompleteMedia++;
  }

  const needsRepair = rows.filter(row => {
    const item = (row as any).items as any;
    const attrs: Record<string, any> = item?.attributes ?? {};
    const media: string[] = Array.isArray(item?.media) ? item.media : [];
    const permanentMedia = media.filter((u: string) => u?.includes('supabase') || u?.includes('onspace'));
    return !attrs['_ebay_item_id'] || !row.category_id ||
           !item?.description || String(item.description).trim().length < 10 ||
           permanentMedia.length === 0;
  }).length;

  return { totalImported: rows.length, missingEbayId, missingCategory, missingDescription, incompleteMedia, needsRepair, scanned: true };
}

async function repairImportedListings(
  tenantId: string,
  onProgress: (p: RepairProgress) => void,
): Promise<void> {
  const supabase = getSupabaseClient();

  onProgress({ phase: 'scan', current: 0, total: 0, repairedCategory: 0, repairedDescription: 0, repairedEbayId: 0, imagesDownloaded: 0, failed: 0, done: false });

  // Load all eBay-imported listings with their items
  const { data: rows } = await supabase
    .from('listings')
    .select('id, category_id, external_listing_id, item_id, items(id, description, media, attributes)')
    .eq('tenant_id', tenantId)
    .eq('marketplace_id', 'ebay')
    .not('external_listing_id', 'is', null)
    .neq('external_listing_id', '');

  if (!rows || rows.length === 0) {
    onProgress({ phase: 'done', current: 0, total: 0, repairedCategory: 0, repairedDescription: 0, repairedEbayId: 0, imagesDownloaded: 0, failed: 0, done: true });
    return;
  }

  // Filter to only those needing repair
  const toRepair = rows.filter(row => {
    const item = (row as any).items as any;
    const attrs: Record<string, any> = item?.attributes ?? {};
    const media: string[] = Array.isArray(item?.media) ? item.media : [];
    const permanentMedia = media.filter((u: string) => u?.includes('supabase') || u?.includes('onspace'));
    return !attrs['_ebay_item_id'] || !row.category_id ||
           !item?.description || String(item.description).trim().length < 10 ||
           permanentMedia.length === 0;
  });

  const total = toRepair.length;
  if (total === 0) {
    onProgress({ phase: 'done', current: 0, total: 0, repairedCategory: 0, repairedDescription: 0, repairedEbayId: 0, imagesDownloaded: 0, failed: 0, done: true });
    return;
  }

  let repairedCategory = 0;
  let repairedDescription = 0;
  let repairedEbayId = 0;
  let failed = 0;
  const mediaRepairItemIds: string[] = [];

  onProgress({ phase: 'enrich', current: 0, total, repairedCategory, repairedDescription, repairedEbayId, imagesDownloaded: 0, failed, done: false });

  // Phase 1: Enrich each listing via GetItem
  for (let i = 0; i < toRepair.length; i++) {
    const row = toRepair[i];
    const item = (row as any).items as any;
    const ebayItemId = row.external_listing_id!;
    const itemId: string = row.item_id ?? item?.id;
    const existingAttrs: Record<string, any> = { ...(item?.attributes ?? {}) };
    const media: string[] = Array.isArray(item?.media) ? item.media : [];
    const permanentMedia = media.filter((u: string) => u?.includes('supabase') || u?.includes('onspace'));

    onProgress({ phase: 'enrich', current: i + 1, total, repairedCategory, repairedDescription, repairedEbayId, imagesDownloaded: 0, failed, done: false });

    try {
      // Call GetItem via the existing get_item_full route
      const { data: browseData, error: browseErr } = await supabase.functions.invoke('swish-ebay-browse', {
        body: { route: 'get_item_full', tenantId, ebayItemId },
      });

      if (browseErr || !browseData?.item) {
        console.warn(`[Repair] GetItem failed for ${ebayItemId}:`, browseErr?.message ?? 'no item');
        failed++;
        continue;
      }

      const ebayItem = browseData.item;

      // Build merged attributes — NEVER overwrite existing user data
      const mergedAttrs: Record<string, any> = { ...existingAttrs };

      // Always set _ebay_item_id (critical for image downloader)
      mergedAttrs['_ebay_item_id'] = ebayItemId;
      if (ebayItem.title) mergedAttrs['_ebay_title'] = ebayItem.title;
      if (ebayItem.photos?.length) mergedAttrs['_ebay_img_count'] = ebayItem.photos.length;

      // Store category if missing
      if (ebayItem.categoryId && !existingAttrs['ebay_category_id']) {
        mergedAttrs['ebay_category_id'] = ebayItem.categoryId;
        mergedAttrs['_ebay_category_id'] = ebayItem.categoryId;
      }
      if (ebayItem.categoryName && !existingAttrs['ebay_category_name']) {
        mergedAttrs['ebay_category_name'] = ebayItem.categoryName;
        mergedAttrs['_ebay_category_name'] = ebayItem.categoryName;
        mergedAttrs['eBay Category'] = ebayItem.categoryName;
      }

      // Merge item specifics (only add, never overwrite existing)
      if (Array.isArray(ebayItem.itemSpecifics)) {
        for (const spec of ebayItem.itemSpecifics) {
          if (spec.name && spec.value && !existingAttrs[spec.name]) {
            mergedAttrs[spec.name] = spec.value;
          }
        }
      }

      // Build item update payload — only repair eBay-derived fields
      const itemUpdate: Record<string, any> = {
        attributes: mergedAttrs,
        updated_at: new Date().toISOString(),
      };

      // Repair description only if currently missing/blank
      const currentDesc = String(item?.description ?? '').trim();
      if (currentDesc.length < 10 && ebayItem.description && ebayItem.description.trim().length >= 10) {
        itemUpdate.description = ebayItem.description;
        repairedDescription++;
      }

      // Update item record
      await supabase.from('items').update(itemUpdate).eq('id', itemId);

      // Repair listing category_id if missing
      const listingUpdate: Record<string, any> = { updated_at: new Date().toISOString() };
      if (!row.category_id && ebayItem.categoryId) {
        listingUpdate.category_id = ebayItem.categoryId;
        repairedCategory++;
      }
      if (Object.keys(listingUpdate).length > 1) {
        await supabase.from('listings').update(listingUpdate).eq('id', row.id);
      }

      // Track which items need _ebay_item_id was missing before (needs image repair)
      if (!existingAttrs['_ebay_item_id']) repairedEbayId++;

      // Queue for image repair if media incomplete
      if (permanentMedia.length === 0 && itemId) {
        mediaRepairItemIds.push(itemId);
      }

    } catch (e: any) {
      console.warn(`[Repair] Exception for ${ebayItemId}:`, e?.message);
      failed++;
    }

    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 150));
  }

  // Phase 2: Repair images for items that had no permanent media
  if (mediaRepairItemIds.length > 0) {
    onProgress({ phase: 'images', current: 0, total: mediaRepairItemIds.length, repairedCategory, repairedDescription, repairedEbayId, imagesDownloaded: 0, failed, done: false });

    try {
      const { data: dlData } = await supabase.functions.invoke('swish-image-download', {
        body: { tenantId, itemIds: mediaRepairItemIds, fixTitles: true },
      });
      const imagesDownloaded = dlData?.imagesDownloaded ?? 0;
      failed += dlData?.imagesFailed ?? 0;
      onProgress({ phase: 'done', current: mediaRepairItemIds.length, total: mediaRepairItemIds.length, repairedCategory, repairedDescription, repairedEbayId, imagesDownloaded, failed, done: true });
    } catch {
      onProgress({ phase: 'done', current: mediaRepairItemIds.length, total: mediaRepairItemIds.length, repairedCategory, repairedDescription, repairedEbayId, imagesDownloaded: 0, failed, done: true });
    }
  } else {
    onProgress({ phase: 'done', current: total, total, repairedCategory, repairedDescription, repairedEbayId, imagesDownloaded: 0, failed, done: true });
  }
}

// ── Candidate Row ─────────────────────────────────────────────────────────────

function CandidateRow({
  item,
  acquisitions,
  onToggle,
  onUpdate,
}: {
  item: ImportItem;
  acquisitions: { id: string; title: string }[];
  onToggle: (id: string) => void;
  onUpdate: (id: string, field: string, value: string) => void;
}) {
  const statusColor =
    item.status === 'duplicate' ? Colors.danger
    : item.status === 'ready' && item.ebayStatus === 'sold' ? Colors.accent
    : item.status === 'ready' && item.ebayStatus === 'ended' ? Colors.textTertiary
    : item.status === 'ready' ? Colors.success
    : item.status === 'review' ? Colors.warning
    : Colors.textTertiary;

  const statusLabel =
    item.status === 'duplicate' ? 'Duplicate'
    : item.ebayStatus === 'sold' ? 'Sold on eBay'
    : item.ebayStatus === 'ended' ? 'Ended'
    : item.status === 'ready' ? 'Active'
    : item.status === 'review' ? 'Review'
    : 'Missing Info';

  return (
    <View style={[row.card, item.status === 'duplicate' && row.cardDuplicate]}>
      <View style={row.topRow}>
        <Pressable
          onPress={() => onToggle(item.ebayItemId)}
          style={[row.checkbox, item.selected && row.checkboxActive]}
          hitSlop={8}
          disabled={item.status === 'duplicate'}
        >
          {item.selected ? <MaterialIcons name="check" size={14} color={Colors.background} /> : null}
        </Pressable>

        {item.photos.length > 0 ? (
          <View style={{ position: 'relative' }}>
            <Image source={{ uri: item.photos[0] }} style={row.photo} contentFit="cover" transition={150} />
            <View style={row.photoBadge}>
              <MaterialIcons name="photo-library" size={8} color={Colors.success} />
              <Text style={row.photoBadgeText}>Photo</Text>
            </View>
          </View>
        ) : (
          <View style={row.photoPlaceholder}>
            <MaterialIcons name="toll" size={18} color={Colors.textTertiary} />
          </View>
        )}

        <View style={{ flex: 1, gap: 3 }}>
          <Text style={row.title} numberOfLines={2}>{item.title}</Text>
          <View style={row.metaRow}>
            <View style={[row.statusPill, { backgroundColor: statusColor + '20' }]}>
              <Text style={[row.statusText, { color: statusColor }]}>{statusLabel}</Text>
            </View>
            {item.ebayStatus && item.status !== 'duplicate' ? (
              <View style={[row.ebayStatusPill, {
                backgroundColor:
                  item.ebayStatus === 'active' ? Colors.successDim
                  : item.ebayStatus === 'sold' ? Colors.accentDim
                  : Colors.surfaceHighlight,
              }]}>
                <MaterialIcons
                  name={item.ebayStatus === 'active' ? 'wifi-tethering' : item.ebayStatus === 'sold' ? 'check-circle' : 'stop-circle'}
                  size={9}
                  color={
                    item.ebayStatus === 'active' ? Colors.success
                    : item.ebayStatus === 'sold' ? Colors.accent
                    : Colors.textTertiary
                  }
                />
                <Text style={[row.ebayStatusText, {
                  color:
                    item.ebayStatus === 'active' ? Colors.success
                    : item.ebayStatus === 'sold' ? Colors.accent
                    : Colors.textTertiary,
                }]}>
                  {item.ebayStatus === 'active' ? 'Live' : item.ebayStatus === 'sold' ? 'Sold' : 'Ended'}
                </Text>
              </View>
            ) : null}
            <Text style={row.price}>£{item.price.toFixed(2)}</Text>
            <Text style={row.ebayId}>#{item.ebayItemId}</Text>
          </View>
        </View>
      </View>

      {item.status === 'duplicate' ? (
        <View style={row.warningRow}>
          <MaterialIcons name="warning" size={12} color={Colors.warning} />
          <Text style={row.warningText}>Already imported — skipping to prevent duplicate</Text>
        </View>
      ) : null}

      {item.warnings.length > 0 && item.status !== 'duplicate' ? (
        <View style={row.warningRow}>
          <MaterialIcons name="info-outline" size={12} color={Colors.warning} />
          <Text style={row.warningText}>{item.warnings.join(' · ')}</Text>
        </View>
      ) : null}

      {item.status !== 'duplicate' ? (
        <View style={row.fields}>
          <View style={row.fieldRow}>
            <View style={row.fieldWrap}>
              <Text style={row.fieldLabel}>FOLDER NO.</Text>
              <TextInput
                style={row.fieldInput}
                value={item.folderNumber}
                onChangeText={v => onUpdate(item.ebayItemId, 'folderNumber', v)}
                placeholder="e.g. 12"
                placeholderTextColor={Colors.textTertiary}
              />
            </View>
            <View style={row.fieldWrap}>
              <Text style={row.fieldLabel}>POCKET / POSITION</Text>
              <TextInput
                style={row.fieldInput}
                value={item.pocketPosition}
                onChangeText={v => onUpdate(item.ebayItemId, 'pocketPosition', v)}
                placeholder="e.g. 37"
                placeholderTextColor={Colors.textTertiary}
              />
            </View>
          </View>
          <View style={row.fieldWrap}>
            <Text style={row.fieldLabel}>CATALOGUE NUMBER</Text>
            <TextInput
              style={row.fieldInput}
              value={item.catalogueNumber}
              onChangeText={v => onUpdate(item.ebayItemId, 'catalogueNumber', v)}
              placeholder="e.g. RIC IV 123"
              placeholderTextColor={Colors.textTertiary}
            />
          </View>
          {acquisitions.length > 0 ? (
            <View style={row.fieldWrap}>
              <Text style={row.fieldLabel}>ACQUISITION BATCH</Text>
              <View style={row.acqRow}>
                {acquisitions.map(acq => (
                  <Pressable
                    key={acq.id}
                    onPress={() => onUpdate(item.ebayItemId, 'acquisitionId', acq.id)}
                    style={[row.acqChip, item.acquisitionId === acq.id && row.acqChipActive]}
                  >
                    <Text style={[row.acqChipText, item.acquisitionId === acq.id && { color: Colors.primary }]}>
                      {acq.title.length > 30 ? acq.title.slice(0, 30) + '...' : acq.title}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const row = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface, borderRadius: Radius.xl,
    padding: Spacing.md, gap: Spacing.sm,
    borderWidth: 1, borderColor: Colors.surfaceBorder,
  },
  cardDuplicate: { opacity: 0.55, borderColor: Colors.danger + '40' },
  topRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  checkbox: {
    width: 22, height: 22, borderRadius: Radius.sm,
    borderWidth: 2, borderColor: Colors.surfaceBorder,
    alignItems: 'center', justifyContent: 'center',
    marginTop: 2,
  },
  checkboxActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  photo: { width: 52, height: 52, borderRadius: Radius.sm, display: 'flex' },
  photoBadge: {
    position: 'absolute', bottom: 2, right: 2,
    flexDirection: 'row', alignItems: 'center', gap: 2,
    backgroundColor: Colors.successDim, borderRadius: Radius.pill,
    paddingHorizontal: 4, paddingVertical: 2,
    borderWidth: 1, borderColor: Colors.success + '50',
  },
  photoBadgeText: { fontSize: 7, fontWeight: Typography.weight.bold, color: Colors.success },
  photoPlaceholder: {
    width: 52, height: 52, borderRadius: Radius.sm,
    backgroundColor: Colors.surfaceHighlight, alignItems: 'center', justifyContent: 'center',
  },
  title: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.textPrimary, lineHeight: 17 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  ebayStatusPill: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 5, paddingVertical: 2, borderRadius: Radius.pill,
  },
  ebayStatusText: { fontSize: 9, fontWeight: Typography.weight.bold },
  statusPill: { paddingHorizontal: 5, paddingVertical: 2, borderRadius: Radius.pill },
  statusText: { fontSize: 9, fontWeight: Typography.weight.bold },
  price: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.gold },
  ebayId: { fontSize: 9, color: Colors.textTertiary },
  warningRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 5,
    backgroundColor: Colors.warningDim, borderRadius: Radius.sm,
    paddingHorizontal: Spacing.sm, paddingVertical: 4,
  },
  warningText: { flex: 1, fontSize: 10, color: Colors.warning, lineHeight: 14 },
  fields: { gap: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.surfaceBorder, paddingTop: Spacing.sm },
  fieldRow: { flexDirection: 'row', gap: Spacing.sm },
  fieldWrap: { flex: 1, gap: 3 },
  fieldLabel: {
    fontSize: 9, fontWeight: Typography.weight.bold,
    color: Colors.textTertiary, letterSpacing: 0.4,
  },
  fieldInput: {
    backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.sm,
    borderWidth: 1, borderColor: Colors.surfaceBorder,
    paddingHorizontal: Spacing.sm, paddingVertical: 5,
    fontSize: Typography.size.xs, color: Colors.textPrimary,
    includeFontPadding: false,
  },
  acqRow: { flexDirection: 'row', gap: Spacing.xs, flexWrap: 'wrap' },
  acqChip: {
    paddingHorizontal: Spacing.sm, paddingVertical: 4, borderRadius: Radius.sm,
    backgroundColor: Colors.surfaceHighlight, borderWidth: 1, borderColor: Colors.surfaceBorder,
  },
  acqChipActive: { backgroundColor: Colors.primaryDim, borderColor: Colors.primary + '60' },
  acqChipText: { fontSize: Typography.size.xs, color: Colors.textSecondary },
});

// ── Main Screen ───────────────────────────────────────────────────────────────

export default function EbayImportScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { tenant } = useApp();
  const { showAlert } = useAlert();

  const [candidates, setCandidates] = useState<ImportItem[]>([]);
  const [acquisitions, setAcquisitions] = useState<{ id: string; title: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<{ current: number; total: number } | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // ── Image import state ────────────────────────────────────────────────────
  const [imageImporting, setImageImporting] = useState(false);
  const [imageProgress, setImageProgress] = useState<ImageImportProgress | null>(null);

  // ── Repair state ──────────────────────────────────────────────────────────
  const [repairDiagnostic, setRepairDiagnostic] = useState<RepairDiagnostic | null>(null);
  const [repairRunning, setRepairRunning] = useState(false);
  const [repairProgress, setRepairProgress] = useState<RepairProgress | null>(null);
  const [scanningDiagnostic, setScanningDiagnostic] = useState(false);

  // Auto-scan repair diagnostic on mount
  useEffect(() => {
    if (!tenant) return;
    setScanningDiagnostic(true);
    scanRepairNeeded(tenant.id)
      .then(d => setRepairDiagnostic(d))
      .catch(() => {})
      .finally(() => setScanningDiagnostic(false));
  }, [tenant?.id]);

  const handleRepair = useCallback(async () => {
    if (!tenant || repairRunning) return;
    setRepairRunning(true);
    setRepairProgress(null);
    try {
      await repairImportedListings(tenant.id, p => setRepairProgress(p));
      // Refresh diagnostic after repair
      const fresh = await scanRepairNeeded(tenant.id);
      setRepairDiagnostic(fresh);
    } catch (e: any) {
      showAlert('Repair Error', e?.message ?? 'Repair failed unexpectedly');
    } finally {
      setRepairRunning(false);
    }
  }, [tenant, repairRunning, showAlert]);

  // Load acquisitions for the batch selector
  useEffect(() => {
    if (!tenant) return;
    const supabase = getSupabaseClient();
    supabase
      .from('acquisitions')
      .select('id, title')
      .eq('tenant_id', tenant.id)
      .order('created_at', { ascending: false })
      .limit(20)
      .then(({ data }) => {
        setAcquisitions((data ?? []).map(r => ({ id: r.id, title: r.title })));
      });
  }, [tenant?.id]);

  // ── Import eBay Images ────────────────────────────────────────────────────

  const handleImportImages = useCallback(async (specificItemIds?: string[]) => {
    if (!tenant || imageImporting) return;
    setImageImporting(true);
    setImageProgress({ current: 0, total: 0, updated: 0, failed: 0, done: false });
    try {
      await fetchAndUpdateEbayImages(tenant.id, p => setImageProgress(p), specificItemIds);
    } catch (e: any) {
      showAlert('Error', e?.message ?? 'Failed to import images');
    }
    setImageImporting(false);
  }, [tenant, imageImporting, showAlert]);

  // ── Fetch eBay listings via edge function ──────────────────────────────────

  const handleFetch = useCallback(async () => {
    if (!tenant) return;
    setLoading(true);
    setFetchError(null);
    setCandidates([]);

    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase.functions.invoke('swish-ebay-browse', {
        body: { route: 'my_active_listings', tenantId: tenant.id, limit: 400 },
      });

      if (error) {
        let msg = error.message;
        const { FunctionsHttpError } = await import('@supabase/supabase-js');
        if (error instanceof FunctionsHttpError) {
          try { msg = await (error as any).context?.text() ?? msg; } catch {}
        }
        setFetchError(`eBay fetch failed: ${msg}`);
        setLoading(false);
        return;
      }

      const listings: any[] = data?.listings ?? [];

      if (listings.length === 0) {
        setFetchError('No eBay listings found. If your eBay account is connected but this shows empty, your active listings may have ended. Try clicking Fetch again — sold and ended listings are also fetched.');
        setLoading(false);
        return;
      }

      const existing = await getExistingEbayItemIds(tenant.id);
      const defaultAcqId = acquisitions[0]?.id ?? '';
      const toHttps = (url: string | null | undefined) =>
        url ? url.replace(/^http:\/\//i, 'https://') : null;

      const items: ImportItem[] = listings.map((l: any) => {
        const isDuplicate = existing.has(String(l.itemId ?? l.id));
        const warnings: string[] = [];
        if (!l.title) warnings.push('Missing title');
        if (!l.price && l.price !== 0) warnings.push('Missing price');
        if (!l.description || l.description.trim().length < 5) warnings.push('Description not imported — will be blank');

        const ebayStatus: 'active' | 'sold' | 'ended' =
          l.ebayStatus === 'sold' ? 'sold'
          : l.ebayStatus === 'ended' ? 'ended'
          : 'active';

        const securePhotos: string[] = (l.photos ?? []).map((u: string) => toHttps(u)).filter(Boolean);
        if (securePhotos.length === 0 && l.galleryUrl) {
          const g = toHttps(l.galleryUrl);
          if (g) securePhotos.push(g);
        }

        return {
          ebayItemId: String(l.itemId ?? l.id ?? ''),
          title: l.title ?? 'Untitled',
          subtitle: l.subtitle ?? '',
          description: l.description ?? '',
          price: Number(l.price ?? 0),
          shippingCost: Number(l.shippingCost ?? 0),
          shippingService: l.shippingService ?? '',
          freeShipping: l.freeShipping ?? false,
          photos: securePhotos,
          listedAt: l.listedAt ?? undefined,
          endedAt: l.endedAt ?? undefined,
          // eBay listing fields
          listingType: l.listingType ?? 'FixedPriceItem',
          listingDuration: l.listingDuration ?? '',
          conditionId: l.conditionId ?? '',
          conditionDisplayName: l.conditionDisplayName ?? '',
          conditionDescription: l.conditionDescription ?? '',
          categoryId: l.categoryId ?? '',
          categoryName: l.categoryName ?? '',
          quantity: l.quantity ?? 1,
          quantitySold: l.quantitySold ?? 0,
          watchCount: l.watchCount ?? 0,
          hitCount: l.hitCount ?? 0,
          returnsPolicy: l.returnsPolicy ?? '',
          itemSpecifics: l.itemSpecifics ?? [],
          bestOfferEnabled: l.bestOfferEnabled ?? false,
          currency: l.currency ?? 'GBP',
          sku: l.sku ?? '',
          dispatchTimeMax: l.dispatchTimeMax ?? 0,
          // User-fillable fields
          folderNumber: '',
          pocketPosition: '',
          catalogueNumber: '',
          acquisitionId: defaultAcqId,
          status: isDuplicate ? 'duplicate'
            : warnings.filter(w => w !== 'Description not imported — will be blank').length > 0 ? 'review'
            : 'ready',
          duplicateItemId: undefined,
          warnings,
          selected: !isDuplicate,
          ebayStatus,
        };
      });

      setCandidates(items);
    } catch (e: any) {
      setFetchError(e?.message ?? 'Unexpected error fetching eBay listings');
    }

    setLoading(false);
  }, [tenant, acquisitions]);

  // ── Toggle / update ────────────────────────────────────────────────────────

  const handleToggle = useCallback((ebayItemId: string) => {
    setCandidates(prev => prev.map(c =>
      c.ebayItemId === ebayItemId ? { ...c, selected: !c.selected } : c,
    ));
  }, []);

  const handleUpdate = useCallback((ebayItemId: string, field: string, value: string) => {
    setCandidates(prev => prev.map(c => {
      if (c.ebayItemId !== ebayItemId) return c;
      const updated = { ...c, [field]: value };
      if (c.status !== 'duplicate') {
        const warnings = [...c.warnings.filter(w => w !== 'Missing title' && w !== 'Missing price')];
        updated.status = warnings.length > 0 ? 'review' : 'ready';
        updated.warnings = warnings;
      }
      return updated;
    }));
  }, []);

  const handleSelectAll = useCallback((select: boolean) => {
    setCandidates(prev => prev.map(c =>
      c.status === 'duplicate' ? c : { ...c, selected: select },
    ));
  }, []);

  // ── Import listings ────────────────────────────────────────────────────────

  const handleImport = useCallback(async () => {
    if (!tenant) return;
    const selected = candidates.filter(c => c.selected && c.status !== 'duplicate');
    if (selected.length === 0) {
      showAlert('Nothing Selected', 'Select at least one listing to import.');
      return;
    }

    showAlert(
      `Import ${selected.length} Listing${selected.length === 1 ? '' : 's'}`,
      `This will create ${selected.length} inventory record${selected.length === 1 ? '' : 's'} with KC Inventory IDs and link them to their existing eBay listings.\n\nDuplicate records will be prevented automatically.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Import',
          onPress: async () => {
            setImporting(true);
            setImportProgress({ current: 0, total: selected.length });

            let imported = 0;
            let skipped = 0;
            const errors: string[] = [];
            const importedItemIds: string[] = [];

            for (let i = 0; i < selected.length; i++) {
              setImportProgress({ current: i + 1, total: selected.length });
              const candidate = selected[i];

              const { itemId, inventoryId, error } = await importEbayCandidate(tenant.id, candidate);
              if (error) {
                errors.push(`${candidate.title.slice(0, 30)}: ${error}`);
                skipped++;
              } else {
                imported++;
                if (itemId) importedItemIds.push(itemId);
                setCandidates(prev => prev.map(c =>
                  c.ebayItemId === candidate.ebayItemId
                    ? { ...c, status: 'duplicate', selected: false, duplicateItemId: itemId ?? undefined }
                    : c,
                ));
              }
            }

            await logImportRun(tenant.id, {
              totalProcessed: selected.length,
              totalImported: imported,
              totalMatched: imported,
              totalReview: 0,
              totalSkipped: skipped,
              errors,
            });

            setImporting(false);
            setImportProgress(null);

            // Image downloads are deliberately manual to avoid unexpected eBay API
            // calls after every import. Use the explicit Import eBay Images action
            // when you want to fetch missing images for these items.

            if (errors.length === 0) {
              showAlert(
                'Import Complete',
                `${imported} item${imported === 1 ? '' : 's'} imported with KC Inventory IDs. Gallery images are being fetched automatically.`,
                [{ text: 'Go to Inventory', onPress: () => router.navigate('/(tabs)/inventory' as any) }],
              );
            } else {
              showAlert(
                'Import Finished',
                `${imported} imported, ${skipped} failed.${imported > 0 ? ' Gallery images are being fetched automatically.' : ''}\n\nErrors:\n${errors.slice(0, 5).join('\n')}`,
              );
            }
          },
        },
      ],
    );
  }, [tenant, candidates, showAlert, router]);

  // ── Stats ──────────────────────────────────────────────────────────────────

  const readyCount = candidates.filter(c => c.status === 'ready' || c.status === 'review').length;
  const duplicateCount = candidates.filter(c => c.status === 'duplicate').length;
  const selectedCount = candidates.filter(c => c.selected).length;

  return (
    <View style={s.container}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={[s.header, { paddingTop: insets.top + Spacing.base }]}>
        <Pressable onPress={() => {
          if (router.canGoBack()) router.back();
          else router.replace('/(tabs)/listings' as any);
        }} style={s.backBtn} hitSlop={8}>
          <MaterialIcons name="arrow-back" size={20} color={Colors.textSecondary} />
        </Pressable>
        <View style={s.flex}>
          <Text style={s.title}>eBay Import</Text>
          {importProgress ? (
            <Text style={s.subtitle}>
              Importing {importProgress.current}/{importProgress.total}...
            </Text>
          ) : candidates.length > 0 ? (
            <Text style={s.subtitle}>
              {candidates.length} found · {duplicateCount} duplicate · {selectedCount} selected
            </Text>
          ) : (
            <Text style={s.subtitle}>Import your existing eBay listings as inventory records</Text>
          )}
        </View>
        {selectedCount > 0 && !importing ? (
          <Pressable
            onPress={handleImport}
            style={({ pressed }) => [s.importBtn, pressed && { opacity: 0.85 }]}
          >
            <MaterialIcons name="download" size={15} color={Colors.background} />
            <Text style={s.importBtnText}>Import ({selectedCount})</Text>
          </Pressable>
        ) : null}
      </View>

      {/* ── Repair Imported Listings banner ──────────────────────────────── */}
      {(repairDiagnostic?.scanned || repairRunning || repairProgress) ? (
        <Pressable
          onPress={repairProgress?.done ? undefined : (!repairRunning ? handleRepair : undefined)}
          disabled={repairRunning || scanningDiagnostic}
          style={({ pressed }) => [
            s.repairBanner,
            repairProgress?.done && repairProgress.failed === 0 && { backgroundColor: Colors.successDim, borderBottomColor: Colors.success + '30' },
            pressed && !repairRunning && !repairProgress?.done && { opacity: 0.85 },
          ]}
        >
          <View style={s.repairBannerLeft}>
            {repairRunning ? (
              <ActivityIndicator size="small" color={Colors.warning} />
            ) : repairProgress?.done ? (
              <MaterialIcons name={repairProgress.failed === 0 ? 'check-circle' : 'warning'} size={18} color={repairProgress.failed === 0 ? Colors.success : Colors.warning} />
            ) : (
              <MaterialIcons name="build-circle" size={18} color={Colors.warning} />
            )}
            <View style={{ flex: 1 }}>
              <Text style={[
                s.repairBannerTitle,
                repairProgress?.done && repairProgress.failed === 0 && { color: Colors.success },
              ]}>
                {repairRunning
                  ? repairProgress?.phase === 'images'
                    ? 'Downloading Images...'
                    : `Repairing ${repairProgress?.current ?? 0} / ${repairProgress?.total ?? 0}...`
                  : repairProgress?.done
                  ? 'Repair Complete'
                  : 'Repair Imported Listings'}
              </Text>
              <Text style={[
                s.repairBannerSub,
                repairProgress?.done && repairProgress.failed === 0 && { color: Colors.success + 'CC' },
              ]}>
                {repairRunning
                  ? repairProgress?.phase === 'enrich'
                    ? `Fetching eBay data for ${repairProgress.current} of ${repairProgress.total} listings...`
                    : repairProgress?.phase === 'images'
                    ? `Downloading missing gallery images...`
                    : 'Scanning...'
                  : repairProgress?.done
                  ? [
                      repairProgress.repairedCategory > 0 && `${repairProgress.repairedCategory} categories fixed`,
                      repairProgress.repairedDescription > 0 && `${repairProgress.repairedDescription} descriptions restored`,
                      repairProgress.repairedEbayId > 0 && `${repairProgress.repairedEbayId} eBay IDs linked`,
                      repairProgress.imagesDownloaded > 0 && `${repairProgress.imagesDownloaded} images downloaded`,
                      repairProgress.failed > 0 && `${repairProgress.failed} failed`,
                    ].filter(Boolean).join(' · ') || 'All listings already complete'
                  : repairDiagnostic?.needsRepair === 0
                  ? `All ${repairDiagnostic.totalImported} imported listings are complete`
                  : [
                      repairDiagnostic?.missingCategory ? `${repairDiagnostic.missingCategory} missing category` : null,
                      repairDiagnostic?.missingDescription ? `${repairDiagnostic.missingDescription} missing description` : null,
                      repairDiagnostic?.missingEbayId ? `${repairDiagnostic.missingEbayId} missing eBay ID` : null,
                      repairDiagnostic?.incompleteMedia ? `${repairDiagnostic.incompleteMedia} no images` : null,
                    ].filter(Boolean).join(' · ') || 'Tap to scan'
                }
              </Text>
            </View>
          </View>
          {/* Right side */}
          {repairRunning ? (
            repairProgress && repairProgress.total > 0 ? (
              <View style={s.repairProgressWrap}>
                <View style={s.repairProgressTrack}>
                  <View style={[s.repairProgressFill, { width: `${Math.round((repairProgress.current / repairProgress.total) * 100)}%` as any }]} />
                </View>
                <Text style={s.repairProgressPct}>
                  {Math.round((repairProgress.current / repairProgress.total) * 100)}%
                </Text>
              </View>
            ) : null
          ) : repairProgress?.done ? (
            <Pressable
              onPress={() => { setRepairProgress(null); }}
              style={({ pressed }) => [s.repairDismissBtn, pressed && { opacity: 0.7 }]}
              hitSlop={8}
            >
              <MaterialIcons name="close" size={14} color={Colors.textTertiary} />
            </Pressable>
          ) : repairDiagnostic && repairDiagnostic.needsRepair > 0 ? (
            <View style={s.repairActionBtn}>
              <MaterialIcons name="auto-fix-high" size={11} color={Colors.background} />
              <Text style={s.repairActionBtnText}>Repair {repairDiagnostic.needsRepair}</Text>
            </View>
          ) : (
            <MaterialIcons name="check-circle" size={18} color={Colors.success} />
          )}
        </Pressable>
      ) : null}

      {/* ── Import eBay Images banner ─────────────────────────────────────── */}
      <Pressable
        onPress={imageProgress?.done ? () => router.navigate('/(tabs)/inventory') : handleImportImages}
        disabled={imageImporting}
        style={({ pressed }) => [s.imageBanner, pressed && !imageImporting && { opacity: 0.85 }]}
      >
        <View style={s.imageBannerLeft}>
          {imageImporting ? (
            <ActivityIndicator size="small" color={Colors.accent} />
          ) : imageProgress?.done ? (
            <MaterialIcons name="check-circle" size={18} color={Colors.success} />
          ) : (
            <MaterialIcons name="image-search" size={18} color={Colors.accent} />
          )}
          <View style={{ flex: 1 }}>
            <Text style={[s.imageBannerTitle, imageProgress?.done && { color: Colors.success }]}>
              {imageProgress?.done ? 'Images Imported' : 'Import eBay Images'}
            </Text>
            {imageProgress ? (
              <Text style={[s.imageBannerSub, imageProgress.done && { color: Colors.success + 'CC' }]}>
                {imageProgress.done
                  ? `${imageProgress.updated} updated · ${imageProgress.failed} not found · Tap to reset`
                  : `Fetching... ${imageProgress.current} / ${imageProgress.total}`}
              </Text>
            ) : (
              <Text style={s.imageBannerSub}>
                Fetch missing gallery images for all imported eBay items
              </Text>
            )}
          </View>
        </View>

        {/* Right side: progress bar, action buttons, or chevron */}
        {imageImporting && imageProgress && imageProgress.total > 0 ? (
          <View style={s.imageBannerProgressWrap}>
            <View style={s.imageBannerTrack}>
              <View style={[
                s.imageBannerFill,
                { width: `${Math.round((imageProgress.current / imageProgress.total) * 100)}%` as any },
              ]} />
            </View>
            <Text style={s.imageBannerPct}>
              {Math.round((imageProgress.current / imageProgress.total) * 100)}%
            </Text>
          </View>
        ) : imageProgress?.done ? (
          <View style={s.imageBannerDoneRow}>
            {imageProgress.failed > 0 ? (
              <Pressable
                onPress={(e) => { e.stopPropagation?.(); handleImportImages(); }}
                style={({ pressed }) => [s.imageBannerRetryBtn, pressed && { opacity: 0.8 }]}
                hitSlop={4}
              >
                <MaterialIcons name="refresh" size={10} color={Colors.warning} />
                <Text style={s.imageBannerRetryText}>Retry {imageProgress.failed}</Text>
              </Pressable>
            ) : null}
            <Pressable
              onPress={(e) => { e.stopPropagation?.(); router.navigate('/(tabs)/inventory'); }}
              style={({ pressed }) => [s.imageBannerViewBtn, pressed && { opacity: 0.8 }]}
              hitSlop={4}
            >
              <MaterialIcons name="toll" size={10} color={Colors.primary} />
              <Text style={s.imageBannerViewText}>Inventory</Text>
            </Pressable>
          </View>
        ) : (
          <MaterialIcons name="chevron-right" size={16} color={Colors.accent} />
        )}
      </Pressable>

      {/* Info banner */}
      <View style={s.infoBanner}>
        <MaterialIcons name="info-outline" size={14} color={Colors.primary} />
        <Text style={s.infoText}>
          Each eBay listing becomes one inventory record with a permanent KC Inventory ID.
          Existing eBay listing IDs are preserved. No duplicates will be created.
        </Text>
      </View>

      {/* Fetch button */}
      {candidates.length === 0 && !loading ? (
        <View style={s.fetchArea}>
          <View style={s.fetchCard}>
            <View style={s.fetchIconWrap}>
              <MaterialIcons name="cloud-download" size={32} color={Colors.primary} />
            </View>
            <Text style={s.fetchTitle}>Fetch Active eBay Listings</Text>
            <Text style={s.fetchDesc}>
              Connects to your eBay seller account and retrieves all active listings.
              You can review and map each listing to a folder and catalogue number before importing.
            </Text>
            {fetchError ? (
              <View style={s.errorBox}>
                <MaterialIcons name="error-outline" size={14} color={Colors.danger} />
                <Text style={s.errorText}>{fetchError}</Text>
              </View>
            ) : null}
            <Pressable
              onPress={handleFetch}
              disabled={loading}
              style={({ pressed }) => [s.fetchBtn, pressed && { opacity: 0.85 }]}
            >
              <MaterialIcons name="storefront" size={18} color={Colors.background} />
              <Text style={s.fetchBtnText}>Fetch from eBay</Text>
            </Pressable>
          </View>
        </View>
      ) : loading ? (
        <View style={s.loadingArea}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={s.loadingText}>Fetching your eBay listings...</Text>
          <Text style={s.loadingSubtext}>This may take a moment for large catalogues</Text>
        </View>
      ) : (
        <>
          <View style={s.selectBar}>
            <View style={s.selectBarStats}>
              <View style={[s.statDot, { backgroundColor: Colors.success }]} />
              <Text style={s.selectBarText}>{readyCount} ready</Text>
              <View style={[s.statDot, { backgroundColor: Colors.danger }]} />
              <Text style={s.selectBarText}>{duplicateCount} duplicate</Text>
            </View>
            <Pressable onPress={() => handleSelectAll(true)} hitSlop={6} style={s.selectAllBtn}>
              <Text style={s.selectAllText}>All</Text>
            </Pressable>
            <Pressable onPress={() => handleSelectAll(false)} hitSlop={6} style={s.selectAllBtn}>
              <Text style={s.selectAllText}>None</Text>
            </Pressable>
            <Pressable onPress={handleFetch} hitSlop={6} style={s.selectAllBtn}>
              <MaterialIcons name="refresh" size={14} color={Colors.textSecondary} />
            </Pressable>
          </View>

          <FlatList
            data={candidates}
            keyExtractor={c => c.ebayItemId}
            contentContainerStyle={[s.list, { paddingBottom: insets.bottom + 100 }]}
            showsVerticalScrollIndicator={false}
            ItemSeparatorComponent={() => <View style={{ height: Spacing.sm }} />}
            renderItem={({ item }) => (
              <CandidateRow
                item={item}
                acquisitions={acquisitions}
                onToggle={handleToggle}
                onUpdate={handleUpdate}
              />
            )}
          />
        </>
      )}

      {/* Import progress overlay */}
      {importing && importProgress ? (
        <View style={s.progressOverlay}>
          <View style={s.progressCard}>
            <ActivityIndicator size="large" color={Colors.primary} />
            <Text style={s.progressTitle}>Importing...</Text>
            <Text style={s.progressCount}>
              {importProgress.current} of {importProgress.total}
            </Text>
            <View style={s.progressBar}>
              <View style={[
                s.progressBarFill,
                { width: `${Math.round(importProgress.current / importProgress.total * 100)}%` as any },
              ]} />
            </View>
            <Text style={s.progressNote}>
              Generating KC Inventory IDs and linking to eBay listings...
            </Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },

  header: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingHorizontal: Spacing.base, paddingBottom: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: Radius.md,
    backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.surfaceBorder,
  },
  title: { fontSize: Typography.size.xl, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  subtitle: { fontSize: Typography.size.xs, color: Colors.textTertiary, marginTop: 1 },
  importBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.primary, borderRadius: Radius.md,
    paddingHorizontal: Spacing.md, paddingVertical: 8,
  },
  importBtnText: { fontSize: Typography.size.xs, fontWeight: Typography.weight.bold, color: Colors.background },

  // ── Repair banner ────────────────────────────────────────────────────────
  repairBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    gap: Spacing.sm,
    backgroundColor: Colors.warningDim,
    paddingHorizontal: Spacing.base, paddingVertical: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: Colors.warning + '30',
  },
  repairBannerLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  repairBannerTitle: {
    fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.warning,
  },
  repairBannerSub: {
    fontSize: Typography.size.xs, color: Colors.warning + 'BB', marginTop: 1,
  },
  repairProgressWrap: { alignItems: 'flex-end', gap: 3, minWidth: 72 },
  repairProgressTrack: {
    height: 5, width: 72, backgroundColor: Colors.warning + '30',
    borderRadius: Radius.pill, overflow: 'hidden',
  },
  repairProgressFill: { height: '100%', backgroundColor: Colors.warning, borderRadius: Radius.pill },
  repairProgressPct: { fontSize: 9, color: Colors.warning, fontWeight: Typography.weight.bold },
  repairActionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.warning, borderRadius: Radius.pill,
    paddingHorizontal: 10, paddingVertical: 6,
  },
  repairActionBtnText: { fontSize: 10, fontWeight: Typography.weight.bold, color: Colors.background },
  repairDismissBtn: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: Colors.surfaceHighlight, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.surfaceBorder,
  },

  // ── Image import banner ──────────────────────────────────────────────────
  imageBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    gap: Spacing.sm,
    backgroundColor: Colors.accentDim,
    paddingHorizontal: Spacing.base, paddingVertical: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: Colors.accent + '30',
  },
  imageBannerLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  imageBannerTitle: {
    fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.accent,
  },
  imageBannerSub: {
    fontSize: Typography.size.xs, color: Colors.accent + 'BB', marginTop: 1,
  },
  imageBannerProgressWrap: { alignItems: 'flex-end', gap: 3, minWidth: 72 },
  imageBannerTrack: {
    height: 5, width: 72, backgroundColor: Colors.accent + '30',
    borderRadius: Radius.pill, overflow: 'hidden',
  },
  imageBannerFill: { height: '100%', backgroundColor: Colors.accent, borderRadius: Radius.pill },
  imageBannerPct: { fontSize: 9, color: Colors.accent, fontWeight: Typography.weight.bold },
  imageBannerBadge: {
    backgroundColor: Colors.successDim, borderRadius: Radius.pill,
    paddingHorizontal: 8, paddingVertical: 4,
    borderWidth: 1, borderColor: Colors.success + '40',
  },
  imageBannerBadgeText: { fontSize: 11, fontWeight: Typography.weight.bold, color: Colors.success },
  imageBannerDoneRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  imageBannerRetryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: Colors.warningDim, borderRadius: Radius.pill,
    paddingHorizontal: 8, paddingVertical: 5,
    borderWidth: 1, borderColor: Colors.warning + '50',
  },
  imageBannerRetryText: { fontSize: 10, fontWeight: Typography.weight.bold, color: Colors.warning },
  imageBannerViewBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: Colors.primaryDim, borderRadius: Radius.pill,
    paddingHorizontal: 8, paddingVertical: 5,
    borderWidth: 1, borderColor: Colors.primary + '50',
  },
  imageBannerViewText: { fontSize: 10, fontWeight: Typography.weight.bold, color: Colors.primary },

  infoBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm,
    backgroundColor: Colors.primaryDim, paddingHorizontal: Spacing.base, paddingVertical: Spacing.sm,
    borderBottomWidth: 1, borderBottomColor: Colors.primary + '30',
  },
  infoText: { flex: 1, fontSize: Typography.size.xs, color: Colors.primary, lineHeight: 16 },

  fetchArea: { flex: 1, padding: Spacing.base, justifyContent: 'center' },
  fetchCard: {
    backgroundColor: Colors.surface, borderRadius: Radius.xxl,
    padding: Spacing.xl, gap: Spacing.md, alignItems: 'center',
    borderWidth: 1, borderColor: Colors.surfaceBorder, ...Shadow.md,
  },
  fetchIconWrap: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: Colors.primaryDim, alignItems: 'center', justifyContent: 'center',
  },
  fetchTitle: { fontSize: Typography.size.lg, fontWeight: Typography.weight.bold, color: Colors.textPrimary, textAlign: 'center' },
  fetchDesc: { fontSize: Typography.size.sm, color: Colors.textTertiary, textAlign: 'center', lineHeight: 20 },
  errorBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm,
    backgroundColor: Colors.dangerDim, borderRadius: Radius.md, padding: Spacing.md,
    borderWidth: 1, borderColor: Colors.danger + '40', width: '100%',
  },
  errorText: { flex: 1, fontSize: Typography.size.xs, color: Colors.danger, lineHeight: 16 },
  fetchBtn: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.primary, borderRadius: Radius.pill,
    paddingHorizontal: Spacing.xl, paddingVertical: Spacing.md,
  },
  fetchBtnText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.background },

  loadingArea: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md },
  loadingText: { fontSize: Typography.size.base, fontWeight: Typography.weight.semibold, color: Colors.textSecondary },
  loadingSubtext: { fontSize: Typography.size.sm, color: Colors.textTertiary },

  selectBar: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingHorizontal: Spacing.base, paddingVertical: Spacing.sm,
    borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder,
    backgroundColor: Colors.surface,
  },
  selectBarStats: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  statDot: { width: 6, height: 6, borderRadius: 3 },
  selectBarText: { fontSize: Typography.size.xs, color: Colors.textTertiary },
  selectAllBtn: {
    paddingHorizontal: Spacing.sm, paddingVertical: 4,
    backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.sm,
    borderWidth: 1, borderColor: Colors.surfaceBorder,
  },
  selectAllText: { fontSize: Typography.size.xs, color: Colors.textSecondary, fontWeight: Typography.weight.medium },

  list: { padding: Spacing.base },

  progressOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: Colors.overlay80,
    alignItems: 'center', justifyContent: 'center', zIndex: 100,
  },
  progressCard: {
    backgroundColor: Colors.surfaceElevated, borderRadius: Radius.xxl,
    padding: Spacing.xxl, gap: Spacing.md, alignItems: 'center',
    width: '80%', borderWidth: 1, borderColor: Colors.surfaceBorder,
  },
  progressTitle: { fontSize: Typography.size.lg, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  progressCount: { fontSize: Typography.size.xl, fontWeight: Typography.weight.extrabold, color: Colors.primary },
  progressBar: {
    height: 6, width: '100%', backgroundColor: Colors.surfaceHighlight,
    borderRadius: Radius.pill, overflow: 'hidden',
  },
  progressBarFill: { height: '100%', backgroundColor: Colors.primary, borderRadius: Radius.pill },
  progressNote: { fontSize: Typography.size.xs, color: Colors.textTertiary, textAlign: 'center' },
});
