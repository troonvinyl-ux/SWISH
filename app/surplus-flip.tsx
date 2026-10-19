// Surplus Flip — Manifest-led trader workflow
// Imports Joblot XLSX/CSV manifests, uses supplier image URLs, tracks stock units,
// and creates SWISH inventory items using the existing tenant and item service.

import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, TextInput,
  View, Alert,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as XLSX from 'xlsx';
import * as FileSystem from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors, Typography, Spacing, Radius, Shadow } from '@/constants/theme';
import { useApp } from '@/hooks/useApp';
import { createItem } from '@/services/itemService';
import { generateListing, saveListing } from '@/services/listingService';
import { getSupabaseClient } from '@/template';
import { useAlert } from '@/template';


function decodeBase64(base64: string): ArrayBuffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const cleaned = base64.replace(/[^A-Za-z0-9+/=]/g, '');
  const padding = cleaned.endsWith('==') ? 2 : cleaned.endsWith('=') ? 1 : 0;
  const output = new Uint8Array(Math.max(0, Math.floor(cleaned.length * 3 / 4) - padding));
  let offset = 0;
  for (let i = 0; i < cleaned.length; i += 4) {
    const a = alphabet.indexOf(cleaned[i] ?? 'A');
    const b = alphabet.indexOf(cleaned[i + 1] ?? 'A');
    const c = cleaned[i + 2] === '=' || cleaned[i + 2] === undefined ? 0 : alphabet.indexOf(cleaned[i + 2]);
    const d = cleaned[i + 3] === '=' || cleaned[i + 3] === undefined ? 0 : alphabet.indexOf(cleaned[i + 3]);
    if (offset < output.length) output[offset++] = (a << 2) | (b >> 4);
    if (cleaned[i + 2] !== '=' && offset < output.length) output[offset++] = ((b & 15) << 4) | (c >> 2);
    if (cleaned[i + 3] !== '=' && offset < output.length) output[offset++] = ((c & 3) << 6) | d;
  }
  return output.buffer;
}

type ManifestRow = {
  id: string;
  sourceRow: number;
  supplierSku: string;
  barcode: string;
  manifestSku: string;
  asin: string;
  brand: string;
  category: string;
  subcategory: string;
  unitWeight: number;
  unitRrp: number;
  imageUrls: string[];
  title: string;
  description: string;
  quantity: number;
  unitCost: number;
  targetPrice: number;
  condition: string;
  photoUri: string | null;
  selected: boolean;
  imported: boolean;
};

function parseCsv(text: string): string[][] {
  const input = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === '"') {
      if (quoted && input[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (ch === ',' && !quoted) {
      row.push(cell.trim()); cell = '';
    } else if (ch === '\n' && !quoted) {
      row.push(cell.trim()); cell = '';
      if (row.some(v => v.length > 0)) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell.trim());
  if (row.some(v => v.length > 0)) rows.push(row);
  return rows;
}

function headerKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}
function findColumn(headers: string[], aliases: string[]): number {
  const normal = headers.map(headerKey);
  for (const alias of aliases) {
    const idx = normal.indexOf(headerKey(alias));
    if (idx >= 0) return idx;
  }
  return -1;
}
function money(v: string | undefined): number {
  const n = Number((v ?? '').replace(/[£$,\s]/g, '').replace(/,/g, ''));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}
function qty(v: string | undefined): number {
  const n = Number((v ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
}
function makeRows(source: string | string[][]): ManifestRow[] {
  const rows = typeof source === 'string' ? parseCsv(source) : source.map(row => row.map(v => String(v ?? '').trim()));
  if (rows.length < 2) return [];
  const headers = rows[0];
  const skuCol = findColumn(headers, ['Product SKU', 'SKU', 'Supplier SKU', 'Product Code', 'Item Code', 'Code', 'Reference']);
  const manifestSkuCol = findColumn(headers, ['Manifest SKU', 'Manifest Reference', 'Lot SKU']);
  const asinCol = findColumn(headers, ['ASIN']);
  const brandCol = findColumn(headers, ['Brand', 'Manufacturer']);
  const categoryCol = findColumn(headers, ['Category Name', 'Category']);
  const subcategoryCol = findColumn(headers, ['Sub Category Name', 'Subcategory', 'Sub Category']);
  const weightCol = findColumn(headers, ['Unit Weight (kg)', 'Unit Weight', 'Weight kg']);
  const rrpCol = findColumn(headers, ['Unit RRP', 'RRP', 'Retail Price']);
  const imageCols = ['Image 1', 'Image 2', 'Image 3', 'Image 4', 'Image 5', 'Image 6'].map(name => findColumn(headers, [name]));
  const barcodeCol = findColumn(headers, ['Barcode', 'EAN', 'UPC', 'GTIN']);
  const titleCol = findColumn(headers, ['Product', 'Product Name', 'Item', 'Item Name', 'Description', 'Title', 'Name']);
  const descCol = findColumn(headers, ['Product Description', 'Long Description', 'Details', 'Description']);
  const qtyCol = findColumn(headers, ['Quantity', 'Qty', 'Units', 'Pieces', 'Stock', 'Count']);
  const costCol = findColumn(headers, ['Unit Cost', 'Cost Price', 'Purchase Price', 'Cost', 'Unit Price', 'Wholesale Price']);
  const priceCol = findColumn(headers, ['Sell Price', 'Target Price', 'eBay Price', 'Selling Price', 'Listing Price']);
  const conditionCol = findColumn(headers, ['Condition', 'Item Condition', 'Grade']);
  return rows.slice(1).map((cells, i) => {
    const title = titleCol >= 0 ? cells[titleCol] ?? '' : '';
    const supplierSku = skuCol >= 0 ? cells[skuCol] ?? '' : '';
    const barcode = barcodeCol >= 0 ? cells[barcodeCol] ?? '' : '';
    const imageUrls = imageCols.map(col => col >= 0 ? (cells[col] ?? '').trim() : '').filter(url => /^https?:\/\//i.test(url) && !/^https?:\/\/[^/]+\/(?:N\/A|)$/i.test(url));
    return {
      id: 'manifest-' + (i + 2) + '-' + (supplierSku || barcode || title || 'row'),
      sourceRow: i + 2,
      supplierSku,
      barcode,
      manifestSku: manifestSkuCol >= 0 ? cells[manifestSkuCol] ?? '' : '',
      asin: asinCol >= 0 ? cells[asinCol] ?? '' : '',
      brand: brandCol >= 0 ? cells[brandCol] ?? '' : '',
      category: categoryCol >= 0 ? cells[categoryCol] ?? '' : '',
      subcategory: subcategoryCol >= 0 ? cells[subcategoryCol] ?? '' : '',
      unitWeight: weightCol >= 0 ? money(cells[weightCol]) : 0,
      unitRrp: rrpCol >= 0 ? money(cells[rrpCol]) : 0,
      imageUrls,
      title: title.trim(),
      description: (descCol >= 0 ? cells[descCol] : '') || title,
      quantity: qty(qtyCol >= 0 ? cells[qtyCol] : undefined),
      unitCost: money(costCol >= 0 ? cells[costCol] : undefined),
      targetPrice: money(priceCol >= 0 ? cells[priceCol] : undefined),
      condition: (conditionCol >= 0 ? cells[conditionCol] : '') || 'Used — inspect and confirm',
      photoUri: imageUrls[0] ?? null,
      selected: Boolean(title.trim()),
      imported: false,
    };
  }).filter(r => r.title);
}

export default function SurplusFlipScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { tenant, activeNicheId, triggerInventoryReload } = useApp();
  const { showAlert } = useAlert();
  const [manifestName, setManifestName] = useState('');
  const [rows, setRows] = useState<ManifestRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [search, setSearch] = useState('');

  const updateRow = useCallback((id: string, patch: Partial<ManifestRow>) => {
    setRows(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r));
  }, []);

  const loadCsv = useCallback(async () => {
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ['text/csv', 'text/comma-separated-values', 'text/plain', '*/*'],
        copyToCacheDirectory: true,
      });
      if (picked.canceled || !picked.assets?.[0]) return;
      const asset = picked.assets[0];
      let parsed: ManifestRow[];
      if (/\.xlsx?$/i.test(asset.name)) {
        const base64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
        const workbook = XLSX.read(base64, { type: 'base64' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const matrix = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: '', raw: false });
        parsed = makeRows(matrix);
      } else {
        const text = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.UTF8 });
        parsed = makeRows(text);
      }
      if (!parsed.length) {
        showAlert('No product rows found', 'Check the manifest has a header row and a product/name/description column.');
        return;
      }
      setManifestName(asset.name);
      setRows(parsed);
      showAlert('Manifest ready', parsed.length + ' product rows loaded. Review quantities/prices and match photos before adding stock.');
    } catch (e: any) {
      showAlert('Import failed', e?.message ?? 'Could not read the manifest file.');
    }
  }, [showAlert]);

  const attachPhoto = useCallback(async (row: ManifestRow) => {
    try {
      const choice = await new Promise<'camera' | 'library' | 'cancel'>(resolve => {
        Alert.alert('Match a product photo', 'Choose how to add the photo for: ' + row.title, [
          { text: 'Take photo', onPress: () => resolve('camera') },
          { text: 'Photo library', onPress: () => resolve('library') },
          { text: 'Cancel', style: 'cancel', onPress: () => resolve('cancel') },
        ]);
      });
      if (choice === 'cancel') return;
      const result = choice === 'camera'
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.85 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85 });
      if (!result.canceled && result.assets?.[0]?.uri) updateRow(row.id, { photoUri: result.assets[0].uri });
    } catch (e: any) {
      showAlert('Photo unavailable', e?.message ?? 'Could not attach a photo.');
    }
  }, [showAlert, updateRow]);

  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? rows.filter(r => [r.title, r.supplierSku, r.barcode].some(v => v.toLowerCase().includes(q))) : rows;
  }, [rows, search]);
  const selectedCount = rows.filter(r => r.selected && !r.imported).length;
  const matchedCount = rows.filter(r => r.photoUri).length;

  const importSelected = useCallback(async () => {
    if (!tenant?.id) {
      showAlert('Business not ready', 'Your SWISH business account is still loading. Try again when it has finished.');
      return;
    }
    const chosen = rows.filter(r => r.selected && !r.imported);
    if (!chosen.length) {
      showAlert('Nothing selected', 'Select at least one manifest line to add to stock.');
      return;
    }
    const withoutPhoto = chosen.filter(r => !r.photoUri);
    if (withoutPhoto.length) {
      showAlert('Photos still needed', withoutPhoto.length + ' selected line(s) do not have a matched product photo. Add photos before importing.');
      return;
    }
    setBusy(true);
    setProgress({ done: 0, total: chosen.length });
    const errors: string[] = [];
    let imported = 0;
    // Check existing Surplus rows once to avoid duplicate manifest imports.
    const supabase = getSupabaseClient();
    const { data: existingRows, error: existingError } = await supabase
      .from('items')
      .select('id, attributes')
      .eq('tenant_id', tenant.id)
      .eq('specialist_id', 'surplus_trader');
    if (existingError) {
      setBusy(false);
      showAlert('Could not check for duplicates', existingError.message);
      return;
    }
    const existingKeys = new Set<string>((existingRows ?? []).map((item: any) => {
      const a = item.attributes ?? {};
      return [a.manifest_name ?? '', a.manifest_row ?? '', a.supplier_sku ?? '', a.barcode ?? ''].join('|');
    }));
    for (let i = 0; i < chosen.length; i++) {
      const row = chosen[i];
      const key = [manifestName, row.sourceRow, row.supplierSku, row.barcode].join('|');
      if (existingKeys.has(key)) {
        errors.push(row.title + ': already imported from this manifest row, skipped to prevent a duplicate.');
        setProgress({ done: i + 1, total: chosen.length });
        continue;
      }
      let permanentPhotoUrl = '';
      try {
        if (/^https?:\/\//i.test(row.photoUri ?? '')) {
          permanentPhotoUrl = row.photoUri as string;
        } else {
        const base64 = await FileSystem.readAsStringAsync(row.photoUri as string, {
          encoding: FileSystem.EncodingType.Base64,
        });
        const uriPath = (row.photoUri ?? '').toLowerCase().split('?')[0];
        const extension = uriPath.endsWith('.png') ? 'png' : uriPath.endsWith('.webp') ? 'webp' : 'jpg';
        const contentType = extension === 'png' ? 'image/png' : extension === 'webp' ? 'image/webp' : 'image/jpeg';
        const filePath = tenant.id + '/surplus/' + Date.now() + '-' + i + '.' + extension;
        const { error: uploadError } = await supabase.storage
          .from('item-images')
          .upload(filePath, decodeBase64(base64), { contentType, upsert: false });
        if (uploadError) throw uploadError;
        const { data: publicData } = supabase.storage.from('item-images').getPublicUrl(filePath);
        permanentPhotoUrl = publicData.publicUrl;
        if (!permanentPhotoUrl || !(permanentPhotoUrl.includes('supabase') || permanentPhotoUrl.includes('onspace'))) {
          throw new Error('Storage did not return a persistent image URL');
        }
        }
      } catch (photoError: any) {
        errors.push(row.title + ': photo upload failed — ' + (photoError?.message ?? 'unknown error'));
        setProgress({ done: i + 1, total: chosen.length });
        continue;
      }
      const result = await createItem(tenant.id, {
        canonicalTitle: row.title,
        description: row.description,
        specialistId: 'surplus_trader',
        status: 'identified',
        condition: row.condition,
        conditionNotes: 'Imported from manifest: ' + manifestName + ' (row ' + row.sourceRow + '). Verify actual condition before listing.',
        identificationConfidence: 1,
        identificationSource: 'user_confirmed',
        valuationLow: row.targetPrice,
        valuationMid: row.targetPrice,
        valuationHigh: row.targetPrice,
        valuationConfidence: row.targetPrice > 0 ? 'medium' : 'unknown',
        expectedSellingPrice: row.targetPrice,
        expectedNet: Math.max(0, row.targetPrice * 0.8725),
        expectedProfit: row.targetPrice > 0 ? row.targetPrice * 0.8725 - row.unitCost : 0,
        saleProb30d: 0.5,
        acquiredCost: row.unitCost * row.quantity,
        quantity: row.quantity,
        sku: row.supplierSku || undefined,
        manufacturer: undefined,
        media: Array.from(new Set([permanentPhotoUrl, ...row.imageUrls].filter(Boolean))),
        attributes: {
          niche_id: 'surplus_flip',
          specialist_id: 'surplus_trader',
          source_type: 'supplier_manifest',
          manifest_name: manifestName,
          manifest_row: row.sourceRow,
          supplier_sku: row.supplierSku,
          manifest_sku: row.manifestSku,
          asin: row.asin,
          barcode: row.barcode,
          ean: row.barcode,
          brand: row.brand,
          supplier_category: row.category,
          supplier_subcategory: row.subcategory,
          unit_weight_kg: row.unitWeight,
          unit_rrp: row.unitRrp,
          supplier_image_urls: row.imageUrls,
          quantity_received: row.quantity,
          quantity_available: row.quantity,
          supplier_unit_cost: row.unitCost,
          target_sell_price: row.targetPrice,
          matched_photo_url: permanentPhotoUrl,
          review_before_listing: true,
          ebay_quantity: row.quantity,
        },
        tags: ['surplus_flip', 'supplier_manifest'],
        warnings: ['Manifest data is supplier-provided. Verify exact product match, condition, stock count, restrictions, price, and postage before publishing.'],
      });
      if (result.error || !result.item) errors.push(row.title + ': ' + (result.error ?? 'unknown error'));
      else {
        imported++;
        existingKeys.add(key);
        updateRow(row.id, { imported: true, selected: false, photoUri: permanentPhotoUrl });

        // Create a normal SWISH eBay draft using the existing listing pipeline.
        // Publishing remains a deliberate user action after checking price,
        // category, condition, photos and Simple Delivery settings.
        const generated = await generateListing(result.item.id, tenant.id, 'ebay');
        if (generated.listing) {
          const draft = await saveListing(tenant.id, result.item.id, generated.listing, 'ebay');
          if (draft.error || !draft.listing) {
            errors.push(row.title + ': stock saved, but eBay draft creation failed — ' + (draft.error ?? 'unknown error'));
          } else if (row.targetPrice > 0) {
            // A manifest-provided selling price is explicit; RRP is never
            // silently substituted for the selling price.
            const supabase = getSupabaseClient();
            const { error: priceError } = await supabase.from('listings')
              .update({ price: row.targetPrice, updated_at: new Date().toISOString() })
              .eq('id', draft.listing.id)
              .eq('tenant_id', tenant.id);
            if (priceError) errors.push(row.title + ': draft created, but supplied listing price could not be applied — ' + priceError.message);
          }
        } else {
          errors.push(row.title + ': stock saved, but eBay draft generation failed — ' + (generated.error ?? 'unknown error'));
        }
      }
      setProgress({ done: i + 1, total: chosen.length });
    }
    setBusy(false);
    if (imported) triggerInventoryReload();
    showAlert(
      imported ? 'Stock imported' : 'Import not completed',
      imported + ' product row(s) added to SWISH stock.' + (errors.length ? '\n\n' + errors.slice(0, 5).join('\n') : '') + '\n\nAn eBay draft is created through the existing SWISH listing workflow where generation succeeds. Review each draft and publish deliberately; importing never publishes automatically.',
    );
  }, [tenant, rows, manifestName, showAlert, triggerInventoryReload, updateRow]);

  return (
    <View style={s.root}>
      <StatusBar style="light" />
      <View style={[s.header, { paddingTop: insets.top + Spacing.sm }]}>
        <Pressable onPress={() => router.back()} style={s.headerBtn}>
          <MaterialIcons name="arrow-back" size={20} color={Colors.textSecondary} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>Surplus Flip</Text>
          <Text style={s.subtitle}>Manifest → photo match → stock → eBay draft</Text>
        </View>
        <Pressable onPress={() => router.push('/ebay-hub' as any)} style={s.headerAction}>
          <MaterialIcons name="storefront" size={16} color={Colors.primary} />
          <Text style={s.headerActionText}>eBay</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 100 }]} keyboardShouldPersistTaps="handled">
        <View style={s.hero}>
          <MaterialIcons name="inventory-2" size={26} color={Colors.primary} />
          <View style={{ flex: 1 }}>
            <Text style={s.heroTitle}>Import a job-lot manifest</Text>
            <Text style={s.heroText}>Load the supplier CSV, confirm each item and its unit count, then take a photo to tie the real product to the manifest row. Imported stock stays as a draft until you review it.</Text>
          </View>
        </View>

        <Pressable onPress={loadCsv} disabled={busy} style={s.uploadBtn}>
          <MaterialIcons name="upload-file" size={20} color={Colors.background} />
          <View style={{ flex: 1 }}>
            <Text style={s.uploadTitle}>{manifestName || 'Choose manifest CSV'}</Text>
            <Text style={s.uploadSub}>XLSX / CSV • supplier photos • SKU • quantity • cost</Text>
          </View>
          <MaterialIcons name="chevron-right" size={20} color={Colors.background} />
        </Pressable>

        {rows.length > 0 ? (
          <>
            <View style={s.statsRow}>
              <Stat label="Manifest lines" value={String(rows.length)} />
              <Stat label="Photos matched" value={String(matchedCount)} />
              <Stat label="Added to stock" value={String(rows.filter(r => r.imported).length)} />
            </View>
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Find by product, SKU or barcode…"
              placeholderTextColor={Colors.textTertiary}
              style={s.search}
              accessibilityLabel="Search manifest"
            />
            <View style={s.note}>
              <MaterialIcons name="info-outline" size={16} color={Colors.info} />
              <Text style={s.noteText}>Select only rows you want to import. Supplier image URLs are pre-matched where available; replace with your own photo if needed. Quantity is the total sellable units for that line. Check condition, price and eBay category before listing.</Text>
            </View>

            {visibleRows.map(row => (
              <View key={row.id} style={s.rowCard}>
                <View style={s.rowTop}>
                  <Pressable
                    onPress={() => updateRow(row.id, { selected: !row.selected })}
                    disabled={row.imported}
                    style={[s.check, row.selected && s.checkSelected, row.imported && { opacity: 0.35 }]}
                  >
                    {row.selected ? <MaterialIcons name="check" size={14} color={Colors.background} /> : null}
                  </Pressable>
                  {row.photoUri ? <Image source={{ uri: row.photoUri }} style={s.photo} /> : (
                    <Pressable onPress={() => attachPhoto(row)} style={s.photoMissing}>
                      <MaterialIcons name="add-a-photo" size={21} color={Colors.primary} />
                      <Text style={s.photoMissingText}>Match photo</Text>
                    </Pressable>
                  )}
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text style={s.rowTitle}>{row.title}</Text>
                    <Text style={s.rowMeta}>Row {row.sourceRow}{row.supplierSku ? ' • SKU ' + row.supplierSku : ''}{row.barcode ? ' • ' + row.barcode : ''}</Text>
                    {row.imported ? <Text style={s.imported}>Added to stock</Text> : <Text style={s.pending}>{row.photoUri ? 'Photo matched' : 'Needs product photo'}</Text>}
                  </View>
                </View>
                <View style={s.fieldGrid}>
                  <Field label="Units / pieces" value={String(row.quantity)} keyboardType="numeric" onChangeText={v => updateRow(row.id, { quantity: qty(v) })} />
                  <Field label="Unit cost (£)" value={String(row.unitCost)} keyboardType="decimal-pad" onChangeText={v => updateRow(row.id, { unitCost: money(v) })} />
                  <Field label="Target listing price (£)" value={row.targetPrice ? String(row.targetPrice) : ''} keyboardType="decimal-pad" onChangeText={v => updateRow(row.id, { targetPrice: money(v) })} placeholder="Set later" />
                  <Field label="Condition" value={row.condition} onChangeText={v => updateRow(row.id, { condition: v })} />
                </View>
                <View style={s.rowActions}>
                  <Pressable onPress={() => attachPhoto(row)} style={s.smallBtn}>
                    <MaterialIcons name="photo-camera" size={14} color={Colors.primary} />
                    <Text style={s.smallBtnText}>{row.photoUri ? 'Replace photo' : 'Add photo'}</Text>
                  </Pressable>
                  {row.photoUri ? <Pressable onPress={() => updateRow(row.id, { photoUri: null })} style={s.smallBtn}>
                    <MaterialIcons name="delete-outline" size={14} color={Colors.danger} />
                    <Text style={[s.smallBtnText, { color: Colors.danger }]}>Remove photo</Text>
                  </Pressable> : null}
                </View>
              </View>
            ))}
            <Pressable onPress={importSelected} disabled={busy || selectedCount === 0} style={[s.importBtn, (busy || selectedCount === 0) && { opacity: 0.5 }]}>
              {busy ? <ActivityIndicator color={Colors.background} /> : <MaterialIcons name="playlist-add-check" size={18} color={Colors.background} />}
              <Text style={s.importBtnText}>{busy ? 'Importing ' + progress.done + ' / ' + progress.total : 'Add ' + selectedCount + ' selected products to stock'}</Text>
            </Pressable>
          </>
        ) : (
          <View style={s.empty}>
            <MaterialIcons name="table-chart" size={28} color={Colors.textTertiary} />
            <Text style={s.emptyTitle}>No manifest loaded yet</Text>
            <Text style={s.emptyText}>Start with the inventory/manifest the pallet or job-lot supplier provides. You can review each row before any stock is saved.</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <View style={s.stat}><Text style={s.statValue}>{value}</Text><Text style={s.statLabel}>{label}</Text></View>;
}
function Field(props: { label: string; value: string; onChangeText: (v: string) => void; keyboardType?: any; placeholder?: string }) {
  return <View style={s.field}><Text style={s.fieldLabel}>{props.label}</Text><TextInput value={props.value} onChangeText={props.onChangeText} keyboardType={props.keyboardType ?? 'default'} placeholder={props.placeholder} placeholderTextColor={Colors.textTertiary} style={s.input} /></View>;
}
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.base, paddingBottom: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder },
  headerBtn: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.surfaceBorder },
  title: { fontSize: Typography.size.md, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  subtitle: { fontSize: 10, color: Colors.textTertiary, marginTop: 2 },
  headerAction: { flexDirection: 'row', alignItems: 'center', alignSelf: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 8, borderRadius: Radius.md, backgroundColor: Colors.primaryDim, borderWidth: 1, borderColor: Colors.primary + '35' },
  headerActionText: { fontSize: Typography.size.xs, fontWeight: Typography.weight.bold, color: Colors.primary },
  content: { padding: Spacing.base, gap: Spacing.md },
  hero: { flexDirection: 'row', gap: Spacing.md, padding: Spacing.base, backgroundColor: Colors.surface, borderRadius: Radius.xl, borderWidth: 1, borderColor: Colors.primary + '40', ...Shadow.sm },
  heroTitle: { fontSize: Typography.size.md, fontWeight: Typography.weight.bold, color: Colors.textPrimary, marginBottom: 5 },
  heroText: { fontSize: Typography.size.xs, color: Colors.textSecondary, lineHeight: 17 },
  uploadBtn: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.primary, borderRadius: Radius.xl, padding: Spacing.base, ...Shadow.sm },
  uploadTitle: { fontSize: Typography.size.sm, color: Colors.background, fontWeight: Typography.weight.bold },
  uploadSub: { fontSize: 10, color: Colors.background + 'CC', marginTop: 3 },
  statsRow: { flexDirection: 'row', gap: Spacing.sm },
  stat: { flex: 1, padding: Spacing.md, backgroundColor: Colors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceBorder, alignItems: 'center' },
  statValue: { fontSize: Typography.size.xl, color: Colors.primary, fontWeight: Typography.weight.extrabold },
  statLabel: { fontSize: 9, color: Colors.textTertiary, marginTop: 3, textAlign: 'center' },
  search: { backgroundColor: Colors.surface, borderColor: Colors.surfaceBorder, borderWidth: 1, borderRadius: Radius.md, padding: Spacing.md, color: Colors.textPrimary },
  note: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start', padding: Spacing.md, borderRadius: Radius.md, backgroundColor: Colors.infoDim },
  noteText: { flex: 1, color: Colors.info, fontSize: Typography.size.xs, lineHeight: 17 },
  rowCard: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.surfaceBorder, borderRadius: Radius.xl, padding: Spacing.md, gap: Spacing.md, ...Shadow.sm },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  check: { width: 24, height: 24, borderRadius: 7, borderWidth: 1, borderColor: Colors.surfaceBorder, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceHighlight },
  checkSelected: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  photo: { width: 72, height: 72, borderRadius: Radius.md, backgroundColor: Colors.surfaceHighlight },
  photoMissing: { width: 72, height: 72, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.primary + '70', borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', gap: 3, backgroundColor: Colors.primaryDim },
  photoMissingText: { fontSize: 9, color: Colors.primary, textAlign: 'center' },
  rowTitle: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.textPrimary, lineHeight: 19 },
  rowMeta: { fontSize: 9, color: Colors.textTertiary, lineHeight: 14 },
  imported: { color: Colors.success, fontSize: 10, fontWeight: Typography.weight.bold },
  pending: { color: Colors.warning, fontSize: 10, fontWeight: Typography.weight.semibold },
  fieldGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  field: { width: '48%', gap: 4 },
  fieldLabel: { fontSize: 9, color: Colors.textTertiary, fontWeight: Typography.weight.semibold },
  input: { borderWidth: 1, borderColor: Colors.surfaceBorder, backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.md, paddingHorizontal: Spacing.sm, paddingVertical: 9, fontSize: Typography.size.xs, color: Colors.textPrimary, minHeight: 38 },
  rowActions: { flexDirection: 'row', gap: Spacing.sm },
  smallBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: Spacing.sm, paddingVertical: 7, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.surfaceBorder, backgroundColor: Colors.surfaceHighlight },
  smallBtnText: { fontSize: 10, color: Colors.primary, fontWeight: Typography.weight.semibold },
  importBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, backgroundColor: Colors.primary, paddingVertical: Spacing.md, paddingHorizontal: Spacing.base, borderRadius: Radius.xl },
  importBtnText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.background },
  empty: { alignItems: 'center', justifyContent: 'center', paddingVertical: 45, paddingHorizontal: Spacing.xl, gap: Spacing.sm, borderWidth: 1, borderColor: Colors.surfaceBorder, borderStyle: 'dashed', borderRadius: Radius.xl, backgroundColor: Colors.surface },
  emptyTitle: { fontSize: Typography.size.md, color: Colors.textSecondary, fontWeight: Typography.weight.bold },
  emptyText: { fontSize: Typography.size.xs, color: Colors.textTertiary, textAlign: 'center', lineHeight: 18 },
});
