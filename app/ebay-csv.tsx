// KEENONCOINS — eBay CSV Import & Reconciliation Engine v3
// Full file-upload workflow replacing paste-only approach.
//
// FIXES in v3:
//  - Imports and preserves eBay category ID ("eBay category 1 number" column)
//  - Imports and preserves eBay category name ("eBay category 1 name" column)
//  - Stores category_id on listings table at import time (not just after sync)
//  - Stores category data in items.attributes for preflight/submission use
//  - Fixes column misdetection: "eBay category 1 name" was being mapped to buyer_name
//  - Fixes "Listing site" column being confused with status — treats GB/UK/AU as 'active'
//  - Update existing listings: backfills category_id when previously missing
//  - Idempotent: reimporting same CSV does not create duplicate records
//
// ARCHITECTURE:
//  items (canonical inventory) ← linked via item_id → listings (marketplace records)
//  listings.category_id = eBay numeric category ID (e.g. "4726" for British Coins)
//  items.attributes.ebay_category_id = same ID, stored for preflight/submission use
//  items.attributes['eBay Category'] = category path string from CSV

import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  ActivityIndicator, Platform, TextInput, Modal,
  FlatList,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { getSupabaseClient } from '@/template';
import { Colors, Typography, Spacing, Radius, Shadow } from '@/constants/theme';
import { useApp } from '@/hooks/useApp';
import { useAlert } from '@/template';
import { classifyListing, isListingEligibleForNiche, nicheToSpecialistId, NicheClassification } from '@/services/nicheCategoryService';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

type CsvType = 'active_listings' | 'sold_history' | 'orders' | 'transactions' | 'unknown';

type ImportStage =
  | 'idle'
  | 'uploading'
  | 'parsing'
  | 'previewing'
  | 'confirming'
  | 'importing'
  | 'done';

interface ParsedCsv {
  headers: string[];
  rows: Record<string, string>[];
  fileName: string;
  rawSize: number;
}

interface CsvAnalysis {
  detectedType: CsvType;
  columnMapping: Record<string, string>;
  rowCount: number;
  sampleRows: Record<string, string>[];
  headerPreview: string[];
  existingCount: number;
  newCount: number;
  unmatchedCount: number;
  matchedCount: number;
  categoryIdFound: boolean; // whether the eBay category ID column was detected
}

interface ImportResult {
  sessionId: string;
  imported: number;
  updated: number;
  skipped: number;
  matched: number;
  failed: number;
  errors: string[];
  type: CsvType;
  fileName: string;
  total: number;
  categoryIdsSet: number;
  nicheFiltered: number; // listings skipped because they belong to a different niche
}

interface ImportSession {
  id: string;
  fileName: string;
  csvType: string;
  status: string;
  rowsDetected: number;
  rowsImported: number;
  rowsUpdated: number;
  rowsSkipped: number;
  rowsFailed: number;
  uploadedAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// CSV PARSER
// ─────────────────────────────────────────────────────────────────────────────

function stripBom(text: string): string {
  if (text.charCodeAt(0) === 0xfeff) return text.slice(1);
  return text;
}

function normaliseNewlines(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function parseRow(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 2;
        continue;
      }
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
    i++;
  }
  result.push(current.trim());
  return result;
}

function parseCsvText(text: string, maxRows = 5000): ParsedCsv {
  const cleaned = normaliseNewlines(stripBom(text));
  const lines = cleaned
    .split('\n')
    .map(l => l.replace(/\r$/, '').trim())
    .filter(Boolean);

  if (lines.length < 2) return { headers: [], rows: [], fileName: '', rawSize: text.length };

  const headers = parseRow(lines[0]).map(h => h.replace(/^"|"$/g, '').trim());
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < Math.min(lines.length, maxRows + 1); i++) {
    const values = parseRow(lines[i]);
    if (values.every(v => !v.trim())) continue;
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = (values[idx] ?? '').replace(/^"|"$/g, '').trim();
    });
    rows.push(row);
  }

  return { headers, rows, fileName: '', rawSize: text.length };
}

// ─────────────────────────────────────────────────────────────────────────────
// COLUMN DETECTION
// ─────────────────────────────────────────────────────────────────────────────

// Aliases for each canonical SWISH field → ordered by confidence (most specific first)
const COLUMN_ALIASES: Record<string, string[]> = {
  // ── eBay category fields — MUST be detected before buyer_name ──────────────
  // "eBay category 1 number" = the numeric eBay category ID — critical for listing
  // "eBay category 1 name"   = the human-readable category path
  ebay_category_id: [
    'eBay category 1 number',
    'Category number',
    'Category ID',
    'eBay category number',
    'Category 1 number',
    'eBay Category ID',
  ],
  ebay_category_name: [
    'eBay category 1 name',
    'Category name',
    'eBay category name',
    'Category 1 name',
  ],

  // ── Item identification ────────────────────────────────────────────────────
  ebay_item_id: [
    'Item number', 'Item ID', 'Listing ID', 'ItemID', 'eBay Item ID',
    'Item number or Transaction ID', 'Reference ID',
  ],
  title: [
    'Title', 'Item title', 'Listing title', 'Item Title', 'Description',
  ],
  custom_label: [
    'Custom label', 'SKU', 'Custom label (SKU)', 'Custom Label (SKU)',
    'Unique code', 'Custom Label',
  ],
  quantity: [
    'Quantity', 'Available qty', 'Qty', 'Quantity available', 'Total Qty sold',
    'Available quantity',
  ],
  price: [
    'Current price', 'Buy It Now price', 'Start price', 'Price',
    'Buy It Now price (incl. VAT)', 'Item price',
  ],
  listing_status: [
    'Listing status', 'Status', 'Auction type', 'Listing site',
  ],
  condition: [
    'Condition', 'Condition name',
  ],
  start_date: [
    'Start date', 'Date listed', 'Listing start date',
  ],
  end_date: [
    'End date', 'Date ended',
  ],

  // ── Order / sold fields ────────────────────────────────────────────────────
  sales_record: [
    'Sales record number', 'Sales Record Number', 'Transaction ID', 'Transaction number',
  ],
  order_id: [
    'Order ID', 'Order number', 'Order Number', 'eBay Order Number',
  ],
  buyer_username: [
    'Buyer username', 'Buyer User ID', 'Buyer', 'Buyer Usernmae',
  ],
  buyer_name: [
    'Buyer name', 'Buyer full name', "Buyer's name", 'Name',
    // NOTE: 'eBay category 1 name' must NOT match here.
    // The guard below ensures category columns are never mapped to buyer_name.
  ],
  buyer_email: [
    "Buyer's email", 'Buyer email', 'Email',
  ],
  sale_price: [
    'Sale price', 'Item price', 'Sold for', 'Sold For', 'Unit price',
    'Price', 'Final price',
  ],
  shipping_charge: [
    'Postage and packing', 'Shipping and handling', 'P&P', 'Shipping charge',
    'Shipping cost', 'Postage & packaging',
  ],
  total_price: [
    'Total price', 'Total amount', 'Order total', 'Grand total',
  ],
  sale_date: [
    'Sale date', 'Date of sale', 'Order date', 'Transaction creation date',
    'Checkout date', 'Payment date',
  ],
  tracking: [
    'Tracking number', 'Carrier tracking number', 'Tracking',
    'Shipment tracking number',
  ],
  carrier: [
    'Carrier', 'Delivery service',
  ],
  postcode: [
    "Ship-to postcode", 'Postcode', 'ZIP code', "Buyer's postcode",
  ],
  feedback_left: [
    'Feedback left for buyer',
  ],
  net_amount: [
    'Net amount', 'Net proceeds', 'Net payout', 'Net Amount',
  ],
  transaction_type: [
    'Transaction type', 'Type',
  ],
  item_number_sold: [
    'Item number', 'Item ID',
  ],
};

function resolveColumn(headers: string[], aliases: string[]): string | null {
  // Exact match first (case-insensitive)
  for (const alias of aliases) {
    const found = headers.find(h => h.toLowerCase().trim() === alias.toLowerCase().trim());
    if (found) return found;
  }
  // Fuzzy: contains check (only on first 6 chars to avoid false positives)
  for (const alias of aliases) {
    if (alias.length < 6) continue; // skip too-short aliases for fuzzy
    const found = headers.find(h =>
      h.toLowerCase().includes(alias.toLowerCase().substring(0, 8)),
    );
    if (found) return found;
  }
  return null;
}

function buildMapping(headers: string[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    const col = resolveColumn(headers, aliases);
    if (col) mapping[field] = col;
  }

  // ── Guards against known misdetection patterns ─────────────────────────────

  // Guard 1: "eBay category 1 name" must not be mapped to buyer_name.
  // This happens when fuzzy matching picks it up because both contain 'name'.
  const buyerNameCol = mapping['buyer_name'];
  if (buyerNameCol && buyerNameCol.toLowerCase().includes('category')) {
    delete mapping['buyer_name'];
  }

  // Guard 2: ensure ebay_category_id and ebay_category_name are distinct columns.
  // If they resolved to the same column, clear category_name (ID takes priority).
  if (mapping['ebay_category_id'] && mapping['ebay_category_name'] &&
      mapping['ebay_category_id'] === mapping['ebay_category_name']) {
    delete mapping['ebay_category_name'];
  }

  return mapping;
}

// ─────────────────────────────────────────────────────────────────────────────
// LISTING STATUS PARSER
// ─────────────────────────────────────────────────────────────────────────────

// Parse listing status from eBay CSV.
// The "Listing site" column contains marketplace codes (UK, GB, US) not status text —
// these should be treated as 'active' (they appear in Active Listings reports).
function parseListingStatus(raw: string): 'active' | 'sold' | 'ended' {
  const v = (raw ?? '').toLowerCase().trim();
  if (v.includes('sold')) return 'sold';
  if (v.includes('ended') || v.includes('closed')) return 'ended';
  // Marketplace codes from 'Listing site' column — item is active
  if (v === 'uk' || v === 'us' || v === 'gb' || v === 'au' || v === 'de' || v === 'fr') return 'active';
  if (v.includes('active') || v.includes('live')) return 'active';
  return 'active'; // default: assume active for items in Active Listings report
}

// ─────────────────────────────────────────────────────────────────────────────
// REPORT TYPE DETECTION
// ─────────────────────────────────────────────────────────────────────────────

function detectReportType(headers: string[], rows: Record<string, string>[]): CsvType {
  const h = headers.map(x => x.toLowerCase());
  const allText = h.join(' ');

  if (allText.includes('transaction type') || allText.includes('net amount') || allText.includes('payout')) return 'transactions';

  if (allText.includes('order id') || allText.includes('order number') || allText.includes('order date') ||
      allText.includes("buyer's name") || allText.includes('buyer name')) return 'orders';

  if (allText.includes('sales record') || allText.includes('transaction id') || allText.includes('sale date') ||
      allText.includes('sold for') || allText.includes('date of sale')) return 'sold_history';

  if (allText.includes('listing status') || allText.includes('listing site') || allText.includes('start date') ||
      allText.includes('end date') || allText.includes('current price') || allText.includes('buy it now') ||
      allText.includes('ebay category')) return 'active_listings';

  if (rows.length > 0) {
    const firstVal = Object.values(rows[0])[0] ?? '';
    if (/^\d{9,13}$/.test(firstVal.trim())) return 'active_listings';
  }

  return 'unknown';
}

// ─────────────────────────────────────────────────────────────────────────────
// VALUE NORMALISATION
// ─────────────────────────────────────────────────────────────────────────────

function parsePrice(raw: string): number {
  if (!raw) return 0;
  const cleaned = raw.replace(/[£$€,\s]/g, '').replace(/[^0-9.-]/g, '');
  return parseFloat(cleaned) || 0;
}

function parseDate(raw: string): string | null {
  if (!raw) return null;
  const d = new Date(raw);
  if (!isNaN(d.getTime())) return d.toISOString();
  const ukMatch = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (ukMatch) {
    const d2 = new Date(`${ukMatch[3]}-${ukMatch[2]}-${ukMatch[1]}`);
    if (!isNaN(d2.getTime())) return d2.toISOString();
  }
  return null;
}

function get(row: Record<string, string>, mapping: Record<string, string>, field: string): string {
  const col = mapping[field];
  if (!col) return '';
  return (row[col] ?? '').trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// ANALYSIS: check what already exists in the DB
// ─────────────────────────────────────────────────────────────────────────────

async function analyseRows(
  tenantId: string,
  parsed: ParsedCsv,
  type: CsvType,
  mapping: Record<string, string>,
): Promise<Pick<CsvAnalysis, 'existingCount' | 'newCount' | 'matchedCount' | 'unmatchedCount' | 'categoryIdFound'>> {
  const supabase = getSupabaseClient();

  // Check if we have a category ID column
  const categoryIdFound = !!(mapping['ebay_category_id'] && parsed.rows.some(r => get(r, mapping, 'ebay_category_id') && get(r, mapping, 'ebay_category_id') !== '0'));

  if (type === 'active_listings') {
    const ebayIds = parsed.rows
      .map(r => get(r, mapping, 'ebay_item_id'))
      .filter(Boolean)
      .slice(0, 500);

    const { data: existingListings } = await supabase
      .from('listings')
      .select('external_listing_id')
      .eq('tenant_id', tenantId)
      .eq('marketplace_id', 'ebay')
      .in('external_listing_id', ebayIds);

    const existingSet = new Set((existingListings ?? []).map(l => l.external_listing_id));
    const existingCount = ebayIds.filter(id => existingSet.has(id)).length;

    const skus = parsed.rows.map(r => get(r, mapping, 'custom_label')).filter(Boolean).slice(0, 500);
    const { data: skuMatches } = skus.length
      ? await supabase.from('items').select('sku').eq('tenant_id', tenantId).in('sku', skus)
      : { data: [] };

    const matchedCount = existingCount + (skuMatches?.length ?? 0);

    return {
      existingCount,
      newCount: parsed.rows.length - existingCount,
      matchedCount,
      unmatchedCount: parsed.rows.length - matchedCount,
      categoryIdFound,
    };
  }

  if (type === 'orders' || type === 'sold_history') {
    const orderIds = parsed.rows
      .map(r => get(r, mapping, 'order_id') || get(r, mapping, 'sales_record'))
      .filter(Boolean)
      .slice(0, 500);

    const { data: existingOrders } = orderIds.length
      ? await supabase.from('orders').select('external_order_id').eq('tenant_id', tenantId).in('external_order_id', orderIds)
      : { data: [] };

    const existingSet = new Set((existingOrders ?? []).map(o => o.external_order_id));
    const existingCount = orderIds.filter(id => existingSet.has(id)).length;

    const ebayIds = parsed.rows
      .map(r => get(r, mapping, 'ebay_item_id') || get(r, mapping, 'item_number_sold'))
      .filter(Boolean)
      .slice(0, 500);
    const { data: listingMatches } = ebayIds.length
      ? await supabase.from('listings').select('external_listing_id').eq('tenant_id', tenantId).in('external_listing_id', ebayIds)
      : { data: [] };

    const matchedSet = new Set((listingMatches ?? []).map(l => l.external_listing_id));

    return {
      existingCount,
      newCount: parsed.rows.length - existingCount,
      matchedCount: ebayIds.filter(id => matchedSet.has(id)).length,
      unmatchedCount: ebayIds.filter(id => !matchedSet.has(id)).length,
      categoryIdFound,
    };
  }

  return { existingCount: 0, newCount: parsed.rows.length, matchedCount: 0, unmatchedCount: parsed.rows.length, categoryIdFound };
}

// ─────────────────────────────────────────────────────────────────────────────
// IMPORT: ACTIVE LISTINGS
// ─────────────────────────────────────────────────────────────────────────────

async function importActiveListings(
  tenantId: string,
  rows: Record<string, string>[],
  mapping: Record<string, string>,
  sessionId: string,
  onProgress: (current: number, total: number) => void,
  targetNiche: NicheClassification | null = null, // null = import everything (no niche filter)
): Promise<{ imported: number; updated: number; skipped: number; matched: number; failed: number; errors: string[]; categoryIdsSet: number; nicheFiltered: number }> {
  const supabase = getSupabaseClient();

  let imported = 0, updated = 0, skipped = 0, matched = 0, failed = 0, categoryIdsSet = 0, nicheFiltered = 0;
  const errors: string[] = [];

  // Pre-load existing listings for matching
  const { data: existingListings } = await supabase
    .from('listings')
    .select('id, item_id, external_listing_id, price, status, category_id')
    .eq('tenant_id', tenantId)
    .eq('marketplace_id', 'ebay')
    .not('external_listing_id', 'is', null);

  const listingByEbayId = new Map<string, { id: string; itemId: string; categoryId?: string }>(
    (existingListings ?? []).map(l => [
      l.external_listing_id,
      { id: l.id, itemId: l.item_id, categoryId: l.category_id ?? undefined },
    ]),
  );

  // Pre-load existing items for SKU matching
  const { data: existingItems } = await supabase
    .from('items')
    .select('id, sku, inventory_id')
    .eq('tenant_id', tenantId)
    .not('sku', 'is', null)
    .neq('sku', '');

  const itemBySku = new Map<string, string>(
    (existingItems ?? []).filter(i => i.sku).map(i => [i.sku, i.id]),
  );

  for (let i = 0; i < rows.length; i++) {
    onProgress(i + 1, rows.length);
    const row = rows[i];

    try {
      const ebayId = get(row, mapping, 'ebay_item_id');
      const title  = get(row, mapping, 'title') || '(Untitled)';
      const price  = parsePrice(get(row, mapping, 'price'));
      const sku    = get(row, mapping, 'custom_label');
      const statusRaw = get(row, mapping, 'listing_status');
      const condition = get(row, mapping, 'condition');
      const startDateRaw = get(row, mapping, 'start_date');
      const endDateRaw = get(row, mapping, 'end_date');

      // ── eBay category: the critical fix ───────────────────────────────────
      // "eBay category 1 number" = numeric category ID (e.g. "4726")
      // "eBay category 1 name"   = path string (e.g. "Coins:Coins:British:British Coins")
      // Extract numeric ID only — strip any non-digit characters
      const rawCategoryId = get(row, mapping, 'ebay_category_id');
      const csvCategoryId = rawCategoryId.replace(/[^0-9]/g, '').trim();
      const csvCategoryName = get(row, mapping, 'ebay_category_name').trim();

      const listingStatus = parseListingStatus(statusRaw);

      // ── NICHE CLASSIFICATION ────────────────────────────────────────────────
      // Classify listing into its niche BEFORE inserting.
      // If a target niche is active, skip listings that belong to a different niche.
      // This ensures CoinFlip imports only coin listings, MXFlip only MX listings, etc.
      if (targetNiche) {
        const classification = classifyListing(csvCategoryId, csvCategoryName, title);
        const eligible = isListingEligibleForNiche(classification, targetNiche);
        if (!eligible) {
          nicheFiltered++;
          continue; // Skip — belongs to a different niche
        }
      }

      if (!ebayId) { skipped++; continue; }

      // ── Check: listing already exists by eBay item ID ──────────────────────
      const existing = listingByEbayId.get(ebayId);
      if (existing) {
        const listingUpdate: Record<string, any> = {
          status: listingStatus,
          import_source: 'csv',
          import_id: sessionId,
          updated_at: new Date().toISOString(),
        };
        if (price > 0) listingUpdate.price = price;

        // Backfill category_id if the existing listing doesn't have one
        const shouldSetCategory = !existing.categoryId && csvCategoryId && csvCategoryId !== '0';
        if (shouldSetCategory) {
          listingUpdate.category_id = csvCategoryId;
          categoryIdsSet++;
        }

        await supabase.from('listings').update(listingUpdate).eq('id', existing.id);

        // Update linked item
        if (existing.itemId) {
          const itemUpdate: Record<string, any> = { updated_at: new Date().toISOString() };
          if (condition) itemUpdate.condition = condition;

          if (csvCategoryId || csvCategoryName) {
            const { data: existingItemRow } = await supabase
              .from('items').select('attributes').eq('id', existing.itemId).maybeSingle();
            const attrs = (existingItemRow?.attributes ?? {}) as Record<string, any>;
            let attrsChanged = false;
            if (csvCategoryId && !attrs['ebay_category_id']) {
              attrs['ebay_category_id'] = csvCategoryId;
              attrsChanged = true;
            }
            if (csvCategoryName && !attrs['eBay Category']) {
              attrs['eBay Category'] = csvCategoryName;
              attrs['ebay_category_name'] = csvCategoryName.split(':').pop()?.trim() ?? csvCategoryName;
              attrsChanged = true;
            }
            if (attrsChanged) itemUpdate.attributes = attrs;
          }

          await supabase.from('items').update(itemUpdate).eq('id', existing.itemId);
        }

        updated++;
        matched++;
        continue;
      }

      // ── Build initial attributes including category data ────────────────────
      const initialAttributes: Record<string, any> = {};
      if (csvCategoryId && csvCategoryId !== '0') {
        initialAttributes['ebay_category_id'] = csvCategoryId;
      }
      if (csvCategoryName) {
        initialAttributes['eBay Category'] = csvCategoryName;
        initialAttributes['ebay_category_name'] = csvCategoryName.split(':').pop()?.trim() ?? csvCategoryName;
      }

      // ── Check: item exists by SKU ─────────────────────────────────────────
      let itemId: string | null = sku ? (itemBySku.get(sku) ?? null) : null;

      // Determine specialist_id from niche classification or target niche
      const itemClassification = classifyListing(csvCategoryId, csvCategoryName, title);
      const specialistId = targetNiche
        ? nicheToSpecialistId(targetNiche)
        : nicheToSpecialistId(itemClassification.niche);

      if (!itemId) {
        const { data: newItem, error: itemErr } = await supabase
          .from('items')
          .insert({
            tenant_id: tenantId,
            canonical_title: title.slice(0, 200),
            specialist_id: specialistId,
            status: listingStatus === 'active' ? 'listed'
                  : listingStatus === 'sold' ? 'sold'
                  : 'identified',
            condition: condition || '',
            expected_selling_price: price,
            sku: sku || null,
            inventory_id: sku || `KC-EBAY-${ebayId}`,
            inventory_origin: 'ebay_csv',
            source_import_id: sessionId,
            attributes: Object.keys(initialAttributes).length > 0 ? initialAttributes : {},
          })
          .select('id')
          .single();

        if (itemErr || !newItem) {
          errors.push(`Row ${i + 1} (${ebayId}): ${itemErr?.message ?? 'item insert failed'}`);
          failed++;
          continue;
        }

        itemId = newItem.id;
        if (sku) itemBySku.set(sku, itemId!);
      } else {
        matched++;
        // Backfill category data into existing item attributes if missing
        if (Object.keys(initialAttributes).length > 0) {
          const { data: existingItemRow } = await supabase
            .from('items').select('attributes').eq('id', itemId).maybeSingle();
          const existingAttrs = (existingItemRow?.attributes ?? {}) as Record<string, any>;
          let needsUpdate = false;
          for (const [k, v] of Object.entries(initialAttributes)) {
            if (!existingAttrs[k]) { existingAttrs[k] = v; needsUpdate = true; }
          }
          if (needsUpdate) {
            await supabase.from('items').update({
              attributes: existingAttrs,
              updated_at: new Date().toISOString(),
            }).eq('id', itemId);
          }
        }
      }

      // ── Create listing record — with category_id preserved ─────────────────
      const listingInsert: Record<string, any> = {
        tenant_id: tenantId,
        item_id: itemId,
        marketplace_id: 'ebay',
        external_listing_id: ebayId,
        title: title.slice(0, 200),
        description: '',
        price: price > 0 ? price : 0,
        floor_price: price > 0 ? price * 0.6 : 0,
        ceiling_price: price > 0 ? price * 1.5 : 0,
        shipping_cost: 0,
        status: listingStatus,
        import_source: 'csv',
        import_id: sessionId,
        published_at: parseDate(startDateRaw),
        ended_at: parseDate(endDateRaw),
      };

      // THE CRITICAL FIX: persist category_id from CSV
      if (csvCategoryId && csvCategoryId !== '0') {
        listingInsert.category_id = csvCategoryId;
        categoryIdsSet++;
      }

      const { error: listingErr } = await supabase.from('listings').insert(listingInsert);

      if (listingErr) {
        if (listingErr.code === '23505') { skipped++; continue; } // duplicate
        errors.push(`Row ${i + 1} (${ebayId}): ${listingErr.message}`);
        failed++;
        continue;
      }

      listingByEbayId.set(ebayId, { id: '', itemId: itemId!, categoryId: csvCategoryId || undefined });
      imported++;
    } catch (e: any) {
      errors.push(`Row ${i + 1}: ${e.message}`);
      failed++;
    }
  }

  return { imported, updated, skipped, matched, failed, errors, categoryIdsSet, nicheFiltered };
}

// ─────────────────────────────────────────────────────────────────────────────
// IMPORT: ORDERS / SOLD HISTORY
// ─────────────────────────────────────────────────────────────────────────────

async function importOrderRows(
  tenantId: string,
  rows: Record<string, string>[],
  mapping: Record<string, string>,
  sessionId: string,
  onProgress: (current: number, total: number) => void,
): Promise<{ imported: number; updated: number; skipped: number; matched: number; failed: number; errors: string[]; categoryIdsSet: number }> {
  const supabase = getSupabaseClient();

  let imported = 0, updated = 0, skipped = 0, matched = 0, failed = 0;
  const errors: string[] = [];

  const { data: existingOrderData } = await supabase
    .from('orders')
    .select('external_order_id')
    .eq('tenant_id', tenantId)
    .eq('marketplace_id', 'ebay');

  const existingOrderIds = new Set(
    (existingOrderData ?? []).map(o => o.external_order_id).filter(Boolean),
  );

  const { data: listingData } = await supabase
    .from('listings')
    .select('id, item_id, external_listing_id')
    .eq('tenant_id', tenantId)
    .eq('marketplace_id', 'ebay')
    .not('external_listing_id', 'is', null);

  const listingByEbayId = new Map<string, { listingId: string; itemId: string }>(
    (listingData ?? []).map(l => [l.external_listing_id, { listingId: l.id, itemId: l.item_id }]),
  );

  for (let i = 0; i < rows.length; i++) {
    onProgress(i + 1, rows.length);
    const row = rows[i];

    try {
      const orderId    = get(row, mapping, 'order_id') || get(row, mapping, 'sales_record');
      const ebayItemId = get(row, mapping, 'ebay_item_id') || get(row, mapping, 'item_number_sold');
      const salePriceRaw = get(row, mapping, 'sale_price');
      const shippingRaw  = get(row, mapping, 'shipping_charge');
      const saleDateRaw  = get(row, mapping, 'sale_date');
      const buyerName    = get(row, mapping, 'buyer_name') || get(row, mapping, 'buyer_username');
      const tracking     = get(row, mapping, 'tracking');
      const carrier      = get(row, mapping, 'carrier');

      if (!orderId) { skipped++; continue; }
      if (existingOrderIds.has(orderId)) { skipped++; continue; }

      const salePrice      = parsePrice(salePriceRaw);
      const shipping       = parsePrice(shippingRaw);
      const saleDate       = parseDate(saleDateRaw) ?? new Date().toISOString();
      const marketplaceFee = Math.round(salePrice * 0.128 * 100) / 100;
      const netRevenue     = Math.max(0, Math.round((salePrice - marketplaceFee - shipping) * 100) / 100);

      const match      = ebayItemId ? listingByEbayId.get(ebayItemId) : null;
      const itemId     = match?.itemId    ?? null;
      const listingId  = match?.listingId ?? null;
      if (match) matched++;

      const isHistorical   = Date.now() - new Date(saleDate).getTime() > 7 * 24 * 60 * 60 * 1000;
      const fulfilmentStatus = tracking ? 'dispatched' : isHistorical ? 'completed' : 'awaiting_dispatch';

      const { error: orderErr } = await supabase
        .from('orders')
        .insert({
          tenant_id: tenantId,
          item_id: itemId,
          listing_id: listingId,
          marketplace_id: 'ebay',
          external_order_id: orderId,
          buyer_name: buyerName || null,
          buyer_address: {},
          status: 'completed',
          fulfilment_status: fulfilmentStatus,
          sale_price: salePrice,
          marketplace_fee: marketplaceFee,
          shipping_cost: shipping,
          net_revenue: netRevenue,
          tracking_number: tracking || null,
          carrier: carrier || null,
          dispatched_at: tracking ? saleDate : null,
          import_source: 'csv',
          created_at: saleDate,
          updated_at: new Date().toISOString(),
          notes: `Imported from eBay CSV. eBay Item: ${ebayItemId || 'unknown'}`,
        });

      if (orderErr) {
        if (orderErr.code === '23505') { skipped++; continue; }
        errors.push(`Row ${i + 1} (${orderId}): ${orderErr.message}`);
        failed++;
        continue;
      }

      existingOrderIds.add(orderId);

      if (itemId && isHistorical) {
        await supabase.from('sales').insert({
          tenant_id: tenantId,
          item_id: itemId,
          listing_id: listingId,
          marketplace_id: 'ebay',
          sale_price: salePrice,
          marketplace_fee: marketplaceFee,
          shipping_cost: shipping,
          net_revenue: netRevenue,
          profit: netRevenue,
          predicted_profit: netRevenue,
          prediction_accuracy: 0,
          sold_at: saleDate,
          external_transaction_id: orderId,
          external_order_id: orderId,
          import_source: 'csv',
        });

        await supabase.from('items').update({
          status: 'sold',
          sold_price: salePrice,
          sold_at: saleDate,
          marketplace: 'ebay',
          updated_at: new Date().toISOString(),
        }).eq('id', itemId).not('status', 'eq', 'sold');
      }

      imported++;
    } catch (e: any) {
      errors.push(`Row ${i + 1}: ${e.message}`);
      failed++;
    }
  }

  return { imported, updated, skipped, matched, failed, errors, categoryIdsSet: 0 };
}

// ─────────────────────────────────────────────────────────────────────────────
// PREVIEW TABLE
// ─────────────────────────────────────────────────────────────────────────────

function PreviewTable({
  rows,
  headers,
  maxCols = 4,
  maxRows = 5,
}: {
  rows: Record<string, string>[];
  headers: string[];
  maxCols?: number;
  maxRows?: number;
}) {
  const cols = headers.slice(0, maxCols);
  const displayRows = rows.slice(0, maxRows);

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View style={pt.table}>
        <View style={pt.headerRow}>
          {cols.map(col => (
            <View key={col} style={pt.cell}>
              <Text style={pt.headerText} numberOfLines={1}>{col}</Text>
            </View>
          ))}
        </View>
        {displayRows.map((row, ri) => (
          <View key={ri} style={[pt.dataRow, ri % 2 === 0 && pt.dataRowAlt]}>
            {cols.map(col => (
              <View key={col} style={pt.cell}>
                <Text style={pt.cellText} numberOfLines={1}>{row[col] ?? ''}</Text>
              </View>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const pt = StyleSheet.create({
  table: { borderWidth: 1, borderColor: Colors.surfaceBorder, borderRadius: Radius.md, overflow: 'hidden' },
  headerRow: { flexDirection: 'row', backgroundColor: Colors.surfaceHighlight },
  dataRow: { flexDirection: 'row', backgroundColor: Colors.surface },
  dataRowAlt: { backgroundColor: Colors.background },
  cell: { minWidth: 120, maxWidth: 200, paddingHorizontal: 8, paddingVertical: 7, borderRightWidth: 1, borderRightColor: Colors.surfaceBorder + '80' },
  headerText: { fontSize: 10, fontWeight: Typography.weight.bold, color: Colors.textSecondary },
  cellText: { fontSize: 10, color: Colors.textSecondary },
});

// ─────────────────────────────────────────────────────────────────────────────
// TYPE SELECTOR MODAL
// ─────────────────────────────────────────────────────────────────────────────

function TypeSelectorModal({
  visible,
  onSelect,
  onClose,
}: {
  visible: boolean;
  onSelect: (type: CsvType) => void;
  onClose: () => void;
}) {
  const OPTIONS: Array<{ type: CsvType; label: string; desc: string; icon: string; color: string }> = [
    { type: 'active_listings', label: 'Active Listings', desc: 'Currently listed or recently ended eBay items', icon: 'list-alt', color: Colors.primary },
    { type: 'sold_history',    label: 'Sold History',    desc: 'Items you have sold with transaction details', icon: 'sell', color: Colors.success },
    { type: 'orders',          label: 'Order History',   desc: 'Buyer orders with shipping and payment info', icon: 'receipt-long', color: Colors.info },
    { type: 'transactions',    label: 'Transactions',    desc: 'Financial transactions and payouts report', icon: 'account-balance-wallet', color: Colors.gold },
  ];

  return (
    <Modal visible={visible} transparent animationType="slide">
      <Pressable style={ts.overlay} onPress={onClose}>
        <Pressable style={ts.sheet} onPress={() => {}}>
          <View style={ts.handle} />
          <Text style={ts.title}>Select Report Type</Text>
          <Text style={ts.sub}>SWISH could not auto-detect the report type. Please select manually.</Text>
          <View style={ts.options}>
            {OPTIONS.map(opt => (
              <Pressable
                key={opt.type}
                onPress={() => { onSelect(opt.type); onClose(); }}
                style={({ pressed }) => [ts.option, pressed && { opacity: 0.85 }]}
              >
                <View style={[ts.optIcon, { backgroundColor: opt.color + '20' }]}>
                  <MaterialIcons name={opt.icon as any} size={18} color={opt.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={ts.optLabel}>{opt.label}</Text>
                  <Text style={ts.optDesc}>{opt.desc}</Text>
                </View>
                <MaterialIcons name="chevron-right" size={16} color={Colors.textTertiary} />
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const ts = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: Colors.surfaceElevated, borderTopLeftRadius: Radius.xxl, borderTopRightRadius: Radius.xxl,
    padding: Spacing.xl, paddingBottom: Spacing.xxl, gap: Spacing.md,
    borderTopWidth: 1, borderColor: Colors.surfaceBorder,
  },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.surfaceBorder, alignSelf: 'center', marginBottom: 4 },
  title: { fontSize: Typography.size.lg, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  sub: { fontSize: Typography.size.xs, color: Colors.textTertiary, lineHeight: 17 },
  options: { gap: Spacing.sm },
  option: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.surface, borderRadius: Radius.xl, padding: Spacing.md,
    borderWidth: 1, borderColor: Colors.surfaceBorder,
  },
  optIcon: { width: 40, height: 40, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  optLabel: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.textPrimary },
  optDesc: { fontSize: Typography.size.xs, color: Colors.textTertiary, marginTop: 2 },
});

// ─────────────────────────────────────────────────────────────────────────────
// RESULTS SCREEN
// ─────────────────────────────────────────────────────────────────────────────

function ResultsView({
  result,
  onImportAnother,
  onViewInventory,
}: {
  result: ImportResult;
  onImportAnother: () => void;
  onViewInventory: () => void;
}) {
  const stats: Array<{ label: string; value: number; color: string; icon: string }> = [
    { label: 'Imported', value: result.imported, color: Colors.success, icon: 'check-circle' },
    { label: 'Updated',  value: result.updated,  color: Colors.primary, icon: 'update' },
    { label: 'Matched',  value: result.matched,  color: Colors.info,    icon: 'link' },
    { label: 'Skipped',  value: result.skipped,  color: Colors.textTertiary, icon: 'skip-next' },
    { label: 'Failed',   value: result.failed,   color: Colors.danger,  icon: 'error' },
  ].filter(s => s.value > 0);

  return (
    <View style={rv.container}>
      <View style={rv.hero}>
        <View style={result.failed === 0 ? rv.heroIconSuccess : rv.heroIconWarn}>
          <MaterialIcons name={result.failed === 0 ? 'check-circle' : 'warning'} size={40} color={result.failed === 0 ? Colors.success : Colors.warning} />
        </View>
        <Text style={rv.heroTitle}>{result.failed === 0 ? 'Import Complete' : 'Import Complete with Warnings'}</Text>
        <Text style={rv.heroSub}>{result.total} rows processed · {result.fileName}</Text>
      </View>

      {/* Niche filter result */}
      {result.nicheFiltered > 0 ? (
        <View style={rv.categoryCard}>
          <MaterialIcons name="filter-list" size={16} color={Colors.info} />
          <Text style={[rv.categoryText, { color: Colors.info }]}>
            {result.nicheFiltered} listing{result.nicheFiltered === 1 ? '' : 's'} were filtered out because they belong to a different niche — they were not imported into this niche account.
          </Text>
        </View>
      ) : null}

      {/* Category ID status */}
      {result.categoryIdsSet > 0 ? (
        <View style={rv.categoryCard}>
          <MaterialIcons name="category" size={16} color={Colors.success} />
          <Text style={rv.categoryText}>
            {result.categoryIdsSet} listing{result.categoryIdsSet === 1 ? '' : 's'} now have eBay category IDs — they can be published without needing the category picker.
          </Text>
        </View>
      ) : null}

      <View style={rv.statsGrid}>
        {stats.map(s => (
          <View key={s.label} style={rv.statCard}>
            <MaterialIcons name={s.icon as any} size={18} color={s.color} />
            <Text style={[rv.statValue, { color: s.color }]}>{s.value}</Text>
            <Text style={rv.statLabel}>{s.label}</Text>
          </View>
        ))}
      </View>

      {result.errors.length > 0 ? (
        <View style={rv.errorCard}>
          <Text style={rv.errorTitle}>{result.errors.length} row error{result.errors.length > 1 ? 's' : ''}</Text>
          {result.errors.slice(0, 5).map((e, i) => (
            <Text key={i} style={rv.errorRow}>• {e}</Text>
          ))}
          {result.errors.length > 5 ? (
            <Text style={rv.errorMore}>...and {result.errors.length - 5} more</Text>
          ) : null}
        </View>
      ) : null}

      <View style={rv.actions}>
        <Pressable onPress={onViewInventory} style={[rv.actionBtn, { backgroundColor: Colors.primary }]}>
          <MaterialIcons name="inventory-2" size={16} color={Colors.background} />
          <Text style={rv.actionBtnText}>View Inventory</Text>
        </Pressable>
        <Pressable onPress={onImportAnother} style={rv.actionBtnSecondary}>
          <MaterialIcons name="upload-file" size={16} color={Colors.primary} />
          <Text style={[rv.actionBtnText, { color: Colors.primary }]}>Import Another</Text>
        </Pressable>
      </View>
    </View>
  );
}

const rv = StyleSheet.create({
  container: { gap: Spacing.md, paddingVertical: Spacing.md },
  hero: { alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.md },
  heroIconSuccess: { width: 72, height: 72, borderRadius: 36, backgroundColor: Colors.successDim, alignItems: 'center', justifyContent: 'center' },
  heroIconWarn: { width: 72, height: 72, borderRadius: 36, backgroundColor: Colors.warningDim, alignItems: 'center', justifyContent: 'center' },
  heroTitle: { fontSize: Typography.size.xl, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  heroSub: { fontSize: Typography.size.xs, color: Colors.textTertiary, textAlign: 'center' },
  categoryCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm,
    backgroundColor: Colors.successDim, borderRadius: Radius.xl, padding: Spacing.md,
    borderWidth: 1, borderColor: Colors.success + '40',
  },
  categoryText: { flex: 1, fontSize: Typography.size.xs, color: Colors.success, lineHeight: 17 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  statCard: {
    flex: 1, minWidth: 80,
    backgroundColor: Colors.surface, borderRadius: Radius.xl, padding: Spacing.md,
    borderWidth: 1, borderColor: Colors.surfaceBorder,
    alignItems: 'center', gap: 4, ...Shadow.sm,
  },
  statValue: { fontSize: Typography.size.xl, fontWeight: Typography.weight.extrabold },
  statLabel: { fontSize: 9, color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.3 },
  errorCard: { backgroundColor: Colors.dangerDim, borderRadius: Radius.xl, padding: Spacing.base, gap: 5, borderWidth: 1, borderColor: Colors.danger + '30' },
  errorTitle: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.danger, marginBottom: 4 },
  errorRow: { fontSize: Typography.size.xs, color: Colors.danger, lineHeight: 16 },
  errorMore: { fontSize: Typography.size.xs, color: Colors.danger, fontStyle: 'italic' },
  actions: { gap: Spacing.sm },
  actionBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, paddingVertical: Spacing.base, borderRadius: Radius.md },
  actionBtnSecondary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, paddingVertical: Spacing.base, borderRadius: Radius.md, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.primary },
  actionBtnText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.background },
});

// ─────────────────────────────────────────────────────────────────────────────
// SESSION ROW
// ─────────────────────────────────────────────────────────────────────────────

function SessionRow({ session }: { session: ImportSession }) {
  const statusColor =
    session.status === 'completed' ? Colors.success
    : session.status === 'failed' ? Colors.danger
    : Colors.warning;

  const typeLabel: Record<string, string> = {
    active_listings: 'Active Listings',
    sold_history:    'Sold History',
    orders:          'Order History',
    transactions:    'Transactions',
    unknown:         'Unknown',
  };

  return (
    <View style={sr.row}>
      <View style={[sr.dot, { backgroundColor: statusColor }]} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={sr.name} numberOfLines={1}>{session.fileName}</Text>
        <Text style={sr.meta}>
          {typeLabel[session.csvType] ?? session.csvType} ·{' '}
          {session.rowsDetected} rows · {session.rowsImported} imported ·{' '}
          {session.rowsSkipped} skipped
          {session.rowsFailed > 0 ? ` · ${session.rowsFailed} failed` : ''}
        </Text>
        <Text style={sr.date}>
          {new Date(session.uploadedAt).toLocaleDateString('en-GB', {
            day: 'numeric', month: 'short', year: 'numeric',
            hour: '2-digit', minute: '2-digit',
          })}
        </Text>
      </View>
      <View style={[sr.badge, { backgroundColor: statusColor + '20' }]}>
        <Text style={[sr.badgeText, { color: statusColor }]}>{session.status}</Text>
      </View>
    </View>
  );
}

const sr = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingHorizontal: Spacing.base, paddingVertical: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder,
  },
  dot: { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  name: { fontSize: Typography.size.sm, color: Colors.textPrimary, fontWeight: Typography.weight.medium },
  meta: { fontSize: 10, color: Colors.textTertiary, lineHeight: 14 },
  date: { fontSize: 9, color: Colors.textTertiary },
  badge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: Radius.pill },
  badgeText: { fontSize: 9, fontWeight: Typography.weight.bold, textTransform: 'capitalize' },
});

// ─────────────────────────────────────────────────────────────────────────────
// MAIN SCREEN
// ─────────────────────────────────────────────────────────────────────────────

export default function EbayCsvScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { tenant } = useApp();
  const { showAlert } = useAlert();

  // Determine the current active niche for import filtering
  // We read from AppContext to apply the correct niche filter automatically
  const { activeNicheId } = useApp();
  // Map niche IDs to NicheClassification for the filter
  const NICHE_ID_TO_CLASSIFICATION: Record<string, NicheClassification | null> = {
    coins: 'coins',
    motocross: 'motocross',
    bicycles: 'bicycles',
    clothing: 'clothing',
    trading_cards: 'trading_cards',
    antiques: 'antiques',
    general: null, // null = import all niches
  };
  const targetNiche: NicheClassification | null = NICHE_ID_TO_CLASSIFICATION[activeNicheId] ?? null;

  const [stage, setStage] = useState<ImportStage>('idle');
  const [parsedCsv, setParsedCsv] = useState<ParsedCsv | null>(null);
  const [analysis, setAnalysis] = useState<CsvAnalysis | null>(null);
  const [overrideType, setOverrideType] = useState<CsvType | null>(null);
  const [showTypeSelector, setShowTypeSelector] = useState(false);
  const [showPaste, setShowPaste] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [sessions, setSessions] = useState<ImportSession[]>([]);

  const effectiveType = overrideType ?? analysis?.detectedType ?? 'unknown';

  const loadSessions = useCallback(async () => {
    if (!tenant) return;
    const supabase = getSupabaseClient();
    const { data } = await supabase
      .from('ebay_csv_imports')
      .select('*')
      .eq('tenant_id', tenant.id)
      .order('uploaded_at', { ascending: false })
      .limit(20);

    setSessions((data ?? []).map((r: any) => ({
      id: r.id,
      fileName: r.file_name,
      csvType: r.csv_type ?? 'unknown',
      status: r.status,
      rowsDetected: r.rows_detected ?? 0,
      rowsImported: r.rows_imported ?? 0,
      rowsUpdated: r.rows_updated ?? 0,
      rowsSkipped: r.rows_skipped ?? 0,
      rowsFailed: r.rows_failed ?? 0,
      uploadedAt: r.uploaded_at,
    })));
  }, [tenant?.id]);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  const processCsvText = useCallback(async (text: string, fileName: string) => {
    if (!tenant) return;
    setStage('parsing');
    setOverrideType(null);

    const parsed = parseCsvText(text);
    parsed.fileName = fileName;

    if (!parsed.headers.length || !parsed.rows.length) {
      showAlert('Empty CSV', 'No data found. Ensure the file has a header row and data rows.');
      setStage('idle');
      return;
    }

    const detectedType = detectReportType(parsed.headers, parsed.rows);
    const mapping = buildMapping(parsed.headers);

    const overlap = await analyseRows(tenant.id, parsed, detectedType, mapping);

    setParsedCsv(parsed);
    setAnalysis({
      detectedType,
      columnMapping: mapping,
      rowCount: parsed.rows.length,
      sampleRows: parsed.rows.slice(0, 5),
      headerPreview: parsed.headers.slice(0, 6),
      ...overlap,
    });

    setStage('previewing');

    if (detectedType === 'unknown') {
      setTimeout(() => setShowTypeSelector(true), 400);
    }
  }, [tenant, showAlert]);

  const handleUpload = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['text/csv', 'text/comma-separated-values', 'text/plain', '*/*'],
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets?.length) return;

      const asset = result.assets[0];
      setStage('uploading');

      const content = await FileSystem.readAsStringAsync(asset.uri, {
        encoding: FileSystem.EncodingType.UTF8,
      });

      await processCsvText(content, asset.name ?? 'ebay_export.csv');
    } catch (e: any) {
      showAlert('Upload Failed', e?.message ?? 'Could not read file. Try pasting the CSV content instead.');
      setStage('idle');
    }
  }, [processCsvText, showAlert]);

  const handlePasteSubmit = useCallback(() => {
    if (!pasteText.trim()) {
      showAlert('Empty', 'Paste your CSV content first.');
      return;
    }
    setShowPaste(false);
    processCsvText(pasteText, 'ebay_export_paste.csv');
    setPasteText('');
  }, [pasteText, processCsvText, showAlert]);

  const handleImport = useCallback(async () => {
    if (!parsedCsv || !analysis || !tenant) return;

    const csvType = effectiveType;
    if (csvType === 'unknown') {
      showAlert('Select Report Type', 'Please select the report type before importing.');
      setShowTypeSelector(true);
      return;
    }

    const mapping = analysis.columnMapping;

    showAlert(
      `Import ${parsedCsv.rows.length} rows?`,
      [
        `Report: ${csvType.replace(/_/g, ' ')}`,
        `${parsedCsv.rows.length} total rows`,
        `~${analysis.newCount} new records`,
        analysis.categoryIdFound ? 'eBay category IDs detected — will be preserved' : 'No category ID column found — run eBay Sync after import to fetch categories',
        analysis.existingCount > 0 ? `${analysis.existingCount} already exist (will be updated)` : '',
      ].filter(Boolean).join('\n'),
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Import Now',
          onPress: async () => {
            setStage('importing');
            setProgress({ current: 0, total: parsedCsv.rows.length });

            const supabase = getSupabaseClient();

            const { data: sessionData } = await supabase
              .from('ebay_csv_imports')
              .insert({
                tenant_id: tenant.id,
                file_name: parsedCsv.fileName,
                csv_type: csvType,
                status: 'processing',
                rows_detected: parsedCsv.rows.length,
                column_mapping: analysis.columnMapping,
              })
              .select('id')
              .single();

            const sessionId = sessionData?.id ?? '';

            try {
              let importResult: Awaited<ReturnType<typeof importActiveListings>>;

              if (csvType === 'active_listings') {
                importResult = await importActiveListings(
                  tenant.id, parsedCsv.rows, mapping, sessionId,
                  (c, t) => setProgress({ current: c, total: t }),
                  targetNiche,
                );
              } else if (csvType === 'orders' || csvType === 'sold_history') {
                const orderImportResult = await importOrderRows(
                  tenant.id, parsedCsv.rows, mapping, sessionId,
                  (c, t) => setProgress({ current: c, total: t }),
                );
                importResult = { ...orderImportResult, nicheFiltered: 0 };
              } else {
                importResult = {
                  imported: 0, updated: 0, skipped: parsedCsv.rows.length,
                  matched: 0, failed: 0, categoryIdsSet: 0, nicheFiltered: 0,
                  errors: ['Transaction CSV import coming soon. Use Active Listings or Sold History.'],
                };
              }

              if (sessionId) {
                await supabase
                  .from('ebay_csv_imports')
                  .update({
                    status: 'completed',
                    rows_imported: importResult.imported,
                    rows_updated: importResult.updated,
                    rows_skipped: importResult.skipped,
                    rows_failed: importResult.failed,
                    matches_found: importResult.matched,
                    new_records: importResult.imported,
                    completed_at: new Date().toISOString(),
                    error_log: importResult.errors.map(e => ({ message: e })),
                  })
                  .eq('id', sessionId);
              }

              setResult({
                sessionId,
                imported: importResult.imported,
                updated: importResult.updated,
                skipped: importResult.skipped,
                matched: importResult.matched,
                failed: importResult.failed,
                errors: importResult.errors,
                type: csvType,
                fileName: parsedCsv.fileName,
                total: parsedCsv.rows.length,
                categoryIdsSet: importResult.categoryIdsSet,
                nicheFiltered: (importResult as any).nicheFiltered ?? 0,
              });

              setStage('done');
              loadSessions();
            } catch (e: any) {
              if (sessionId) {
                await supabase.from('ebay_csv_imports').update({ status: 'failed' }).eq('id', sessionId);
              }
              showAlert('Import Failed', e?.message ?? 'An unexpected error occurred during import.');
              setStage('previewing');
            }

            setProgress(null);
          },
        },
      ]
    );
  }, [parsedCsv, analysis, tenant, effectiveType, showAlert, loadSessions]);

  const handleReset = useCallback(() => {
    setStage('idle');
    setParsedCsv(null);
    setAnalysis(null);
    setOverrideType(null);
    setResult(null);
    setProgress(null);
  }, []);

  return (
    <View style={s.container}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={[s.header, { paddingTop: insets.top + Spacing.base }]}>
        <Pressable onPress={() => router.back()} style={s.backBtn} hitSlop={8}>
          <MaterialIcons name="arrow-back" size={20} color={Colors.textSecondary} />
        </Pressable>
        <View style={s.flex}>
          <Text style={s.title}>eBay CSV Import</Text>
          <Text style={s.subtitle}>Preserves eBay category IDs for seamless publishing</Text>
        </View>
        {(stage === 'previewing' || stage === 'done') ? (
          <Pressable onPress={handleReset} style={s.resetBtn} hitSlop={8}>
            <MaterialIcons name="refresh" size={14} color={Colors.textSecondary} />
            <Text style={s.resetBtnText}>Reset</Text>
          </Pressable>
        ) : null}
      </View>

      <ScrollView
        contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 80 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* DONE */}
        {stage === 'done' && result ? (
          <ResultsView
            result={result}
            onImportAnother={handleReset}
            onViewInventory={() => router.navigate('/(tabs)/inventory' as any)}
          />
        ) : null}

        {/* IMPORTING */}
        {stage === 'importing' && progress ? (
          <View style={s.progressCard}>
            <ActivityIndicator color={Colors.primary} size="large" />
            <Text style={s.progressTitle}>Importing from eBay CSV...</Text>
            <Text style={s.progressCount}>Row {progress.current} of {progress.total}</Text>
            <View style={s.progressTrack}>
              <View style={[s.progressFill, { width: `${Math.round((progress.current / Math.max(progress.total, 1)) * 100)}%` as any }]} />
            </View>
            <Text style={s.progressPct}>{Math.round((progress.current / Math.max(progress.total, 1)) * 100)}% complete</Text>
            <Text style={s.progressNote}>
              Do not close this screen while importing.{'\n'}Duplicate records are automatically skipped.
            </Text>
          </View>
        ) : null}

        {/* UPLOADING / PARSING */}
        {(stage === 'uploading' || stage === 'parsing') ? (
          <View style={s.loadingCard}>
            <ActivityIndicator color={Colors.primary} size="large" />
            <Text style={s.loadingText}>{stage === 'uploading' ? 'Reading file...' : 'Analysing CSV structure...'}</Text>
          </View>
        ) : null}

        {/* PREVIEWING */}
        {stage === 'previewing' && analysis && parsedCsv ? (
          <View style={s.previewContainer}>
            <View style={[s.detectionBanner, effectiveType === 'unknown' && s.detectionBannerWarn]}>
              <MaterialIcons
                name={effectiveType === 'unknown' ? 'warning' : 'check-circle'}
                size={16}
                color={effectiveType === 'unknown' ? Colors.warning : Colors.success}
              />
              <View style={s.flex}>
                <Text style={[s.detectionLabel, { color: effectiveType === 'unknown' ? Colors.warning : Colors.success }]}>
                  {effectiveType === 'unknown' ? 'Report type not recognised' : `Report detected: ${effectiveType.replace(/_/g, ' ').toUpperCase()}`}
                </Text>
                <Text style={s.detectionSub}>
                  {parsedCsv.rows.length} rows · {parsedCsv.headers.length} columns · {(parsedCsv.rawSize / 1024).toFixed(1)} KB
                </Text>
              </View>
              <Pressable
                onPress={() => setShowTypeSelector(true)}
                style={[s.changeTypeBtn, effectiveType === 'unknown' ? { backgroundColor: Colors.warning, borderColor: Colors.warning } : {}]}
                hitSlop={8}
              >
                <Text style={[s.changeTypeBtnText, effectiveType === 'unknown' ? { color: Colors.background } : {}]}>
                  {effectiveType === 'unknown' ? 'Select Type' : 'Change'}
                </Text>
              </Pressable>
            </View>

            {/* Category ID detection status */}
            <View style={[s.categoryBanner, analysis.categoryIdFound ? s.categoryBannerOk : s.categoryBannerWarn]}>
              <MaterialIcons
                name={analysis.categoryIdFound ? 'category' : 'warning'}
                size={14}
                color={analysis.categoryIdFound ? Colors.success : Colors.warning}
              />
              <Text style={[s.categoryBannerText, { color: analysis.categoryIdFound ? Colors.success : Colors.warning }]}>
                {analysis.categoryIdFound
                  ? 'eBay category IDs detected — will be imported and preserved in listing records'
                  : 'No "eBay category 1 number" column found — run eBay Sync after import to fetch category IDs from eBay'}
              </Text>
            </View>

            <View style={s.statsRow}>
              {[
                { label: 'Total Rows',  value: analysis.rowCount,      color: Colors.textPrimary },
                { label: 'New Records', value: analysis.newCount,       color: Colors.success },
                { label: 'Duplicates',  value: analysis.existingCount,  color: Colors.warning },
                { label: 'KC Matches',  value: analysis.matchedCount,   color: Colors.primary },
              ].map(stat => (
                <View key={stat.label} style={s.statBox}>
                  <Text style={[s.statValue, { color: stat.color }]}>{stat.value}</Text>
                  <Text style={s.statLabel}>{stat.label}</Text>
                </View>
              ))}
            </View>

            <View style={s.mappingCard}>
              <Text style={s.mappingTitle}>COLUMN MAPPING</Text>
              <View style={s.mappingGrid}>
                {Object.entries(analysis.columnMapping).slice(0, 10).map(([field, col]) => (
                  <View key={field} style={s.mappingRow}>
                    <View style={s.mappingCheckWrap}>
                      <MaterialIcons
                        name={field === 'ebay_category_id' ? 'star' : 'check'}
                        size={10}
                        color={field === 'ebay_category_id' ? Colors.gold : Colors.success}
                      />
                    </View>
                    <Text style={s.mappingField}>{field.replace(/_/g, ' ')}</Text>
                    <MaterialIcons name="arrow-right-alt" size={11} color={Colors.textTertiary} />
                    <Text style={s.mappingCol} numberOfLines={1}>{col}</Text>
                  </View>
                ))}
              </View>
              {Object.keys(analysis.columnMapping).length === 0 ? (
                <View style={s.mappingWarn}>
                  <MaterialIcons name="warning" size={13} color={Colors.warning} />
                  <Text style={s.mappingWarnText}>No eBay columns recognised. Ensure the CSV header row uses standard eBay column names.</Text>
                </View>
              ) : null}
            </View>

            <View style={s.sampleCard}>
              <Text style={s.sampleTitle}>SAMPLE DATA (first 5 rows)</Text>
              <PreviewTable rows={analysis.sampleRows} headers={analysis.headerPreview} maxCols={4} maxRows={5} />
              {analysis.unmatchedCount > 0 && effectiveType === 'active_listings' ? (
                <View style={s.unmatchedNote}>
                  <MaterialIcons name="info-outline" size={12} color={Colors.info} />
                  <Text style={s.unmatchedNoteText}>
                    {analysis.unmatchedCount} listings do not match existing inventory items. New item records will be created automatically.
                  </Text>
                </View>
              ) : null}
            </View>

            {analysis.existingCount > 0 ? (
              <View style={s.dupeCard}>
                <MaterialIcons name="info" size={14} color={Colors.primary} />
                <Text style={s.dupeText}>
                  {analysis.existingCount} record{analysis.existingCount > 1 ? 's' : ''} already exist. Existing records will be updated (price, status, category) — not duplicated.
                </Text>
              </View>
            ) : null}

            <View style={s.importActions}>
              <Pressable onPress={handleReset} style={s.cancelBtn}>
                <Text style={s.cancelBtnText}>Start Over</Text>
              </Pressable>
              <Pressable
                onPress={handleImport}
                disabled={effectiveType === 'unknown'}
                style={[s.importBtn, effectiveType === 'unknown' && { opacity: 0.4 }]}
              >
                <MaterialIcons name="cloud-upload" size={16} color={Colors.background} />
                <Text style={s.importBtnText}>Import {analysis.rowCount} rows</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {/* IDLE */}
        {stage === 'idle' ? (
          <>
            <View style={s.introCard}>
              <View style={s.introIcon}>
                <MaterialIcons name="upload-file" size={28} color={Colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.introTitle}>eBay Data Import</Text>
                <Text style={s.introText}>
                  Import your complete eBay history into SWISH. Listings are matched to existing inventory.
                  eBay category IDs are preserved so imported listings can be published without manual category selection.
                </Text>
              </View>
            </View>

            <Pressable onPress={handleUpload} style={({ pressed }) => [s.uploadBtn, pressed && { opacity: 0.88 }]}>
              <MaterialIcons name="upload-file" size={24} color={Colors.background} />
              <View>
                <Text style={s.uploadBtnText}>Upload CSV File</Text>
                <Text style={s.uploadBtnSub}>Select from Files, iCloud, Google Drive, etc.</Text>
              </View>
            </Pressable>

            <View style={s.supportedCard}>
              <Text style={s.supportedTitle}>SUPPORTED EXPORT TYPES</Text>
              {[
                { icon: 'list-alt', label: 'Active Listings', desc: 'My eBay → Selling → All listings → Download report\nIncludes "eBay category 1 number" — category IDs are preserved', color: Colors.primary },
                { icon: 'sell', label: 'Sold History / Transactions', desc: 'My eBay → Selling → Sold → Download transactions', color: Colors.success },
                { icon: 'receipt-long', label: 'Order History', desc: 'My eBay → Orders → Download orders as CSV', color: Colors.info },
              ].map(f => (
                <View key={f.label} style={s.supportedRow}>
                  <View style={[s.supportedIcon, { backgroundColor: f.color + '20' }]}>
                    <MaterialIcons name={f.icon as any} size={14} color={f.color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.supportedLabel}>{f.label}</Text>
                    <Text style={s.supportedDesc}>{f.desc}</Text>
                  </View>
                </View>
              ))}
            </View>

            <Pressable onPress={() => setShowPaste(true)} style={s.pasteToggleBtn}>
              <MaterialIcons name="content-paste" size={14} color={Colors.textSecondary} />
              <Text style={s.pasteToggleBtnText}>Or paste CSV content manually</Text>
              <MaterialIcons name="chevron-right" size={14} color={Colors.textTertiary} />
            </Pressable>

            <View style={s.privacyCard}>
              <MaterialIcons name="lock" size={12} color={Colors.textTertiary} />
              <Text style={s.privacyText}>
                Buyer personal information (emails, addresses) is not stored in SWISH inventory screens.
                Only identifiers needed for order matching are retained. SWISH is the single source
                of inventory truth — eBay APIs maintain live state.
              </Text>
            </View>
          </>
        ) : null}

        {/* Paste modal */}
        {showPaste ? (
          <View style={s.pasteCard}>
            <View style={s.pasteHeader}>
              <View style={s.pasteHeaderIcon}>
                <MaterialIcons name="content-paste" size={16} color={Colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.pasteTitle}>Paste CSV Content</Text>
                <Text style={s.pasteSub}>Copy the entire CSV file and paste below</Text>
              </View>
              <Pressable onPress={() => setShowPaste(false)} hitSlop={8}>
                <MaterialIcons name="close" size={18} color={Colors.textSecondary} />
              </Pressable>
            </View>
            <View style={s.pasteInstrCard}>
              {[
                'Open the CSV in TextEdit (Mac) / Notepad (Windows)',
                'Select All (Cmd+A / Ctrl+A) then Copy (Cmd+C / Ctrl+C)',
                'Paste below (Cmd+V / Ctrl+V)',
              ].map((step, i) => (
                <View key={i} style={s.pasteInstrRow}>
                  <View style={s.pasteInstrNum}><Text style={s.pasteInstrNumText}>{i + 1}</Text></View>
                  <Text style={s.pasteInstrText}>{step}</Text>
                </View>
              ))}
            </View>
            <TextInput
              style={s.pasteInput}
              value={pasteText}
              onChangeText={setPasteText}
              multiline
              textAlignVertical="top"
              placeholder={`Item number,Title,Custom label (SKU),eBay category 1 number,eBay category 1 name\n123456789,"1887 Crown EF",KC-0001,4726,"Coins:Coins:British:British Coins"`}
              placeholderTextColor={Colors.textTertiary}
              autoFocus
            />
            <Text style={s.pasteCount}>{pasteText.split('\n').length} lines · {pasteText.length.toLocaleString()} chars</Text>
            <View style={s.pasteActions}>
              <Pressable onPress={() => { setShowPaste(false); setPasteText(''); }} style={s.cancelBtn}>
                <Text style={s.cancelBtnText}>Cancel</Text>
              </Pressable>
              <Pressable onPress={handlePasteSubmit} disabled={!pasteText.trim()} style={[s.importBtn, !pasteText.trim() && { opacity: 0.45 }]}>
                <MaterialIcons name="analytics" size={14} color={Colors.background} />
                <Text style={s.importBtnText}>Analyse CSV</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {/* Import history */}
        {sessions.length > 0 && stage === 'idle' ? (
          <View style={s.historySection}>
            <Text style={s.historyTitle}>PREVIOUS IMPORTS</Text>
            <View style={s.historyCard}>
              {sessions.map(session => <SessionRow key={session.id} session={session} />)}
            </View>
          </View>
        ) : null}
      </ScrollView>

      <TypeSelectorModal
        visible={showTypeSelector}
        onSelect={type => { setOverrideType(type); setShowTypeSelector(false); }}
        onClose={() => setShowTypeSelector(false)}
      />
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingHorizontal: Spacing.base, paddingBottom: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder,
  },
  backBtn: { width: 34, height: 34, borderRadius: Radius.md, backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.surfaceBorder },
  title: { fontSize: Typography.size.xl, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  subtitle: { fontSize: Typography.size.xs, color: Colors.textTertiary, marginTop: 1 },
  resetBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: Spacing.sm, paddingVertical: 5, backgroundColor: Colors.surface, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.surfaceBorder },
  resetBtnText: { fontSize: Typography.size.xs, color: Colors.textSecondary },
  content: { padding: Spacing.base, gap: Spacing.lg },
  introCard: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md, backgroundColor: Colors.primaryDim, borderRadius: Radius.xxl, padding: Spacing.base, borderWidth: 1, borderColor: Colors.primary + '35' },
  introIcon: { width: 52, height: 52, borderRadius: Radius.md, backgroundColor: Colors.primaryDim, borderWidth: 1, borderColor: Colors.primary + '40', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  introTitle: { fontSize: Typography.size.md, fontWeight: Typography.weight.bold, color: Colors.primary, marginBottom: 4 },
  introText: { fontSize: Typography.size.xs, color: Colors.textSecondary, lineHeight: 18 },
  uploadBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.md, backgroundColor: Colors.primary, borderRadius: Radius.xxl, paddingVertical: Spacing.xl, paddingHorizontal: Spacing.xl, ...Shadow.md },
  uploadBtnText: { fontSize: Typography.size.lg, fontWeight: Typography.weight.extrabold, color: Colors.background },
  uploadBtnSub: { fontSize: Typography.size.xs, color: Colors.background + 'CC', marginTop: 1 },
  supportedCard: { backgroundColor: Colors.surface, borderRadius: Radius.xxl, borderWidth: 1, borderColor: Colors.surfaceBorder, overflow: 'hidden', ...Shadow.sm },
  supportedTitle: { fontSize: 9, fontWeight: Typography.weight.bold, color: Colors.textTertiary, letterSpacing: 0.6, paddingHorizontal: Spacing.base, paddingTop: Spacing.md, paddingBottom: Spacing.sm },
  supportedRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md, paddingHorizontal: Spacing.base, paddingVertical: Spacing.md, borderTopWidth: 1, borderTopColor: Colors.surfaceBorder },
  supportedIcon: { width: 34, height: 34, borderRadius: Radius.sm, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  supportedLabel: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.textPrimary },
  supportedDesc: { fontSize: Typography.size.xs, color: Colors.textTertiary, marginTop: 2, lineHeight: 16 },
  pasteToggleBtn: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surface, borderRadius: Radius.xl, padding: Spacing.md, borderWidth: 1, borderColor: Colors.surfaceBorder },
  pasteToggleBtnText: { flex: 1, fontSize: Typography.size.sm, color: Colors.textSecondary },
  privacyCard: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.xl, padding: Spacing.md },
  privacyText: { flex: 1, fontSize: Typography.size.xs, color: Colors.textTertiary, lineHeight: 16 },
  pasteCard: { backgroundColor: Colors.surface, borderRadius: Radius.xxl, borderWidth: 1, borderColor: Colors.surfaceBorder, padding: Spacing.base, gap: Spacing.md },
  pasteHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  pasteHeaderIcon: { width: 34, height: 34, borderRadius: Radius.md, backgroundColor: Colors.primaryDim, alignItems: 'center', justifyContent: 'center' },
  pasteTitle: { fontSize: Typography.size.md, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  pasteSub: { fontSize: Typography.size.xs, color: Colors.textTertiary, marginTop: 1 },
  pasteInstrCard: { backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.md, padding: Spacing.sm, gap: 6 },
  pasteInstrRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  pasteInstrNum: { width: 18, height: 18, borderRadius: 9, backgroundColor: Colors.primaryDim, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  pasteInstrNumText: { fontSize: 9, fontWeight: Typography.weight.bold, color: Colors.primary },
  pasteInstrText: { flex: 1, fontSize: Typography.size.xs, color: Colors.textSecondary, lineHeight: 16 },
  pasteInput: { backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.surfaceBorder, paddingHorizontal: Spacing.md, paddingVertical: Spacing.md, fontSize: 11, color: Colors.textPrimary, minHeight: 140, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', includeFontPadding: false },
  pasteCount: { fontSize: 9, color: Colors.textTertiary, textAlign: 'right', marginTop: -8 },
  pasteActions: { flexDirection: 'row', gap: Spacing.sm },
  loadingCard: { backgroundColor: Colors.surface, borderRadius: Radius.xxl, padding: Spacing.xxl, alignItems: 'center', gap: Spacing.md, borderWidth: 1, borderColor: Colors.surfaceBorder },
  loadingText: { fontSize: Typography.size.sm, color: Colors.textSecondary },
  progressCard: { backgroundColor: Colors.surface, borderRadius: Radius.xxl, padding: Spacing.xxl, gap: Spacing.md, alignItems: 'center', borderWidth: 1, borderColor: Colors.primary + '40', ...Shadow.sm },
  progressTitle: { fontSize: Typography.size.lg, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  progressCount: { fontSize: Typography.size.md, color: Colors.textSecondary },
  progressTrack: { height: 6, width: '100%', backgroundColor: Colors.surfaceHighlight, borderRadius: Radius.pill, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: Colors.primary, borderRadius: Radius.pill },
  progressPct: { fontSize: Typography.size.sm, color: Colors.primary, fontWeight: Typography.weight.semibold },
  progressNote: { fontSize: Typography.size.xs, color: Colors.textTertiary, textAlign: 'center', lineHeight: 17 },
  previewContainer: { gap: Spacing.md },
  detectionBanner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.successDim, borderRadius: Radius.xl, padding: Spacing.md, borderWidth: 1, borderColor: Colors.success + '35' },
  detectionBannerWarn: { backgroundColor: Colors.warningDim, borderColor: Colors.warning + '35' },
  detectionLabel: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, textTransform: 'uppercase', letterSpacing: 0.3 },
  detectionSub: { fontSize: Typography.size.xs, color: Colors.textTertiary, marginTop: 1 },
  changeTypeBtn: { paddingHorizontal: Spacing.sm, paddingVertical: 4, backgroundColor: Colors.surface, borderRadius: Radius.sm, borderWidth: 1, borderColor: Colors.surfaceBorder },
  changeTypeBtnText: { fontSize: Typography.size.xs, color: Colors.textSecondary, fontWeight: Typography.weight.semibold },
  categoryBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, borderRadius: Radius.xl, padding: Spacing.md, borderWidth: 1 },
  categoryBannerOk: { backgroundColor: Colors.successDim, borderColor: Colors.success + '40' },
  categoryBannerWarn: { backgroundColor: Colors.warningDim, borderColor: Colors.warning + '40' },
  categoryBannerText: { flex: 1, fontSize: Typography.size.xs, lineHeight: 17 },
  statsRow: { flexDirection: 'row', gap: Spacing.sm },
  statBox: { flex: 1, backgroundColor: Colors.surface, borderRadius: Radius.xl, padding: Spacing.md, alignItems: 'center', gap: 3, borderWidth: 1, borderColor: Colors.surfaceBorder, ...Shadow.sm },
  statValue: { fontSize: Typography.size.xl, fontWeight: Typography.weight.extrabold },
  statLabel: { fontSize: 9, color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.3, textAlign: 'center' },
  mappingCard: { backgroundColor: Colors.surface, borderRadius: Radius.xl, padding: Spacing.md, borderWidth: 1, borderColor: Colors.surfaceBorder, gap: 6 },
  mappingTitle: { fontSize: 9, fontWeight: Typography.weight.bold, color: Colors.textTertiary, letterSpacing: 0.5, marginBottom: 2 },
  mappingGrid: { gap: 3 },
  mappingRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  mappingCheckWrap: { width: 14, alignItems: 'center' },
  mappingField: { width: 120, fontSize: Typography.size.xs, color: Colors.textTertiary, textTransform: 'capitalize' },
  mappingCol: { flex: 1, fontSize: Typography.size.xs, color: Colors.primary, fontWeight: Typography.weight.medium },
  mappingWarn: { flexDirection: 'row', alignItems: 'flex-start', gap: 5, backgroundColor: Colors.warningDim, borderRadius: Radius.md, padding: 7 },
  mappingWarnText: { flex: 1, fontSize: Typography.size.xs, color: Colors.warning, lineHeight: 15 },
  sampleCard: { backgroundColor: Colors.surface, borderRadius: Radius.xl, padding: Spacing.md, borderWidth: 1, borderColor: Colors.surfaceBorder, gap: 8 },
  sampleTitle: { fontSize: 9, fontWeight: Typography.weight.bold, color: Colors.textTertiary, letterSpacing: 0.5 },
  unmatchedNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 5, backgroundColor: Colors.infoDim, borderRadius: Radius.md, padding: 7, marginTop: 4 },
  unmatchedNoteText: { flex: 1, fontSize: Typography.size.xs, color: Colors.info, lineHeight: 15 },
  dupeCard: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, backgroundColor: Colors.primaryDim, borderRadius: Radius.xl, padding: Spacing.md, borderWidth: 1, borderColor: Colors.primary + '30' },
  dupeText: { flex: 1, fontSize: Typography.size.xs, color: Colors.textSecondary, lineHeight: 17 },
  importActions: { flexDirection: 'row', gap: Spacing.sm },
  cancelBtn: { flex: 1, paddingVertical: Spacing.md, borderRadius: Radius.md, backgroundColor: Colors.surfaceHighlight, borderWidth: 1, borderColor: Colors.surfaceBorder, alignItems: 'center', justifyContent: 'center' },
  cancelBtnText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.textSecondary },
  importBtn: { flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, paddingVertical: Spacing.md, borderRadius: Radius.md, backgroundColor: Colors.primary },
  importBtnText: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.background },
  historySection: { gap: 6 },
  historyTitle: { fontSize: 9, fontWeight: Typography.weight.bold, color: Colors.textTertiary, letterSpacing: 0.6 },
  historyCard: { backgroundColor: Colors.surface, borderRadius: Radius.xxl, borderWidth: 1, borderColor: Colors.surfaceBorder, overflow: 'hidden', ...Shadow.sm },
});
