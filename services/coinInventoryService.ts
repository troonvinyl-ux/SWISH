// KEENONCOINS — Coin Inventory Service
// Generates KC inventory IDs, handles coin-specific queries,
// and provides the eBay import pipeline logic.

import { getSupabaseClient } from '@/template';

// ── KC Inventory ID generation ────────────────────────────────────────────────

/**
 * Generates the next KC-XXXXXX inventory ID for a tenant.
 * Uses the database function kc_next_inventory_id() for consistency.
 */
export async function generateInventoryId(
  tenantId: string,
): Promise<{ inventoryId: string | null; error: string | null }> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc('kc_next_inventory_id', {
    p_tenant_id: tenantId,
  });
  if (error) return { inventoryId: null, error: error.message };
  return { inventoryId: data as string, error: null };
}

/**
 * Assigns an inventory ID to an existing item that doesn't have one yet.
 */
export async function assignInventoryId(
  itemId: string,
  tenantId: string,
): Promise<{ inventoryId: string | null; error: string | null }> {
  const supabase = getSupabaseClient();

  // Check if already has one
  const { data: existing } = await supabase
    .from('items')
    .select('inventory_id')
    .eq('id', itemId)
    .single();

  if (existing?.inventory_id) {
    return { inventoryId: existing.inventory_id, error: null };
  }

  const { inventoryId, error: genErr } = await generateInventoryId(tenantId);
  if (genErr || !inventoryId) return { inventoryId: null, error: genErr ?? 'Failed to generate ID' };

  const { error: updateErr } = await supabase
    .from('items')
    .update({ inventory_id: inventoryId })
    .eq('id', itemId);

  if (updateErr) return { inventoryId: null, error: updateErr.message };
  return { inventoryId, error: null };
}

// ── Coin-specific search ──────────────────────────────────────────────────────

export interface CoinSearchFilter {
  query?: string;
  folder?: string;
  ruler?: string;
  denomination?: string;
  country?: string;
  period?: string;
  mint?: string;
  status?: string;
  acquisitionId?: string;
}

export async function searchCoins(
  tenantId: string,
  filter: CoinSearchFilter,
  limit = 200,
): Promise<{ items: any[]; error: string | null }> {
  const supabase = getSupabaseClient();
  let query = supabase
    .from('items')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('inventory_id', { ascending: true, nullsFirst: false });

  if (filter.query) {
    const q = filter.query;
    query = query.or(
      `canonical_title.ilike.%${q}%,catalogue_number.ilike.%${q}%,folder_number.ilike.%${q}%,ruler.ilike.%${q}%,denomination.ilike.%${q}%,inventory_id.ilike.%${q}%,mint.ilike.%${q}%`
    );
  }
  if (filter.folder) query = query.ilike('folder_number', `%${filter.folder}%`);
  if (filter.ruler) query = query.ilike('ruler', `%${filter.ruler}%`);
  if (filter.denomination) query = query.ilike('denomination', `%${filter.denomination}%`);
  if (filter.country) query = query.ilike('country_of_origin', `%${filter.country}%`);
  if (filter.period) query = query.ilike('period', `%${filter.period}%`);
  if (filter.mint) query = query.ilike('mint', `%${filter.mint}%`);
  if (filter.status) query = query.eq('status', filter.status);
  if (filter.acquisitionId) query = query.eq('acquisition_id', filter.acquisitionId);

  const { data, error } = await query.limit(limit);
  if (error) return { items: [], error: error.message };
  return { items: data ?? [], error: null };
}

// ── eBay import record creation ───────────────────────────────────────────────

export interface EbayItemSpecific {
  name: string;
  value: string;
}

export interface EbayImportCandidate {
  ebayItemId: string;       // eBay ItemID
  title: string;
  subtitle?: string;
  description: string;
  price: number;
  shippingCost?: number;
  shippingService?: string;
  freeShipping?: boolean;
  photos: string[];
  listedAt?: string;
  endedAt?: string;
  ebayStatus?: 'active' | 'sold' | 'ended';
  // Listing details
  listingType?: string;
  listingDuration?: string;
  conditionId?: string;
  conditionDisplayName?: string;
  conditionDescription?: string;
  categoryId?: string;
  categoryName?: string;
  quantity?: number;
  quantitySold?: number;
  watchCount?: number;
  hitCount?: number;
  returnsPolicy?: string;
  itemSpecifics?: EbayItemSpecific[];
  bestOfferEnabled?: boolean;
  currency?: string;
  sku?: string;
  dispatchTimeMax?: number;
  // Fields user will fill in during review:
  folderNumber: string;
  pocketPosition: string;
  catalogueNumber: string;
  acquisitionId: string;
  // Import status
  status: 'ready' | 'duplicate' | 'missing_info' | 'review';
  duplicateItemId?: string;
  warnings: string[];
}

/**
 * Check which eBay ItemIDs already exist in the database to prevent duplicates.
 */
export async function getExistingEbayItemIds(
  tenantId: string,
): Promise<Set<string>> {
  const supabase = getSupabaseClient();
  const { data } = await supabase
    .from('listings')
    .select('external_listing_id')
    .eq('tenant_id', tenantId)
    .eq('marketplace_id', 'ebay')
    .not('external_listing_id', 'is', null);

  const ids = new Set<string>();
  (data ?? []).forEach(row => {
    if (row.external_listing_id) ids.add(row.external_listing_id);
  });
  return ids;
}

/**
 * Import a single validated candidate: creates inventory item + listing record.
 * Sets listing status based on the eBay status:
 *   active  → listing status 'active', item status 'listed'
 *   sold    → listing status 'sold',   item status 'sold'
 *   ended   → listing status 'ended',  item status 'identified'
 */
export async function importEbayCandidate(
  tenantId: string,
  candidate: EbayImportCandidate,
): Promise<{ itemId: string | null; inventoryId: string | null; error: string | null }> {
  const supabase = getSupabaseClient();

  // Ensure all photo URLs are HTTPS (eBay returns HTTP)
  const securePhotos = (candidate.photos ?? []).map(url =>
    url ? url.replace(/^http:\/\//i, 'https://') : url
  );

  // Map eBay status to DB statuses
  const ebayStatus = candidate.ebayStatus ?? 'active';
  const listingStatus =
    ebayStatus === 'sold' ? 'sold'
    : ebayStatus === 'ended' ? 'ended'
    : 'active';
  const itemStatus =
    ebayStatus === 'sold' ? 'sold'
    : ebayStatus === 'ended' ? 'identified'
    : 'listed';

  // Generate KC inventory ID first
  const { inventoryId, error: idErr } = await generateInventoryId(tenantId);
  if (idErr || !inventoryId) return { itemId: null, inventoryId: null, error: idErr ?? 'ID generation failed' };

  // Build attributes from item specifics + eBay metadata
  // BUG B FIX: Always store _ebay_item_id so swish-image-download can call GetItem
  // and BUG F FIX: Store _ebay_category_id / _ebay_category_name for category resolution
  const attributes: Record<string, string> = {};
  if (candidate.itemSpecifics) {
    for (const spec of candidate.itemSpecifics) {
      if (spec.name && spec.value) {
        attributes[spec.name] = spec.value;
      }
    }
  }
  if (candidate.conditionDisplayName) attributes['eBay Condition'] = candidate.conditionDisplayName;
  if (candidate.categoryName) attributes['eBay Category'] = candidate.categoryName;
  if (candidate.listingType) attributes['Listing Type'] = candidate.listingType === 'Chinese' ? 'Auction' : 'Buy It Now';
  if (candidate.currency && candidate.currency !== 'GBP') attributes['Currency'] = candidate.currency;
  if (candidate.sku) attributes['SKU'] = candidate.sku;

  // CRITICAL — BUG B FIX: _ebay_item_id is required by swish-image-download
  // to call GetItem and retrieve ALL pictures (not just GalleryURL)
  attributes['_ebay_item_id'] = candidate.ebayItemId;
  attributes['_ebay_title'] = candidate.title;
  attributes['_ebay_img_count'] = String(candidate.photos?.length ?? 0);

  // CRITICAL — BUG F FIX: Store category for swish-ebay-list to resolve
  // These are also read by the listing editor for pre-population
  if (candidate.categoryId) {
    attributes['_ebay_category_id'] = candidate.categoryId;
    attributes['ebay_category_id'] = candidate.categoryId;
  }
  if (candidate.categoryName) {
    attributes['_ebay_category_name'] = candidate.categoryName;
    attributes['ebay_category_name'] = candidate.categoryName;
  }

  // Derive coin-specific fields from item specifics where available
  const findSpecific = (names: string[]) => {
    if (!candidate.itemSpecifics) return '';
    for (const name of names) {
      const found = candidate.itemSpecifics.find(
        s => s.name.toLowerCase() === name.toLowerCase()
      );
      if (found) return found.value;
    }
    return '';
  };

  const ruler = findSpecific(['Ruler', 'Monarch', 'Emperor', 'King', 'Leader']);
  const denomination = findSpecific(['Denomination', 'Face Value', 'Value']);
  const yearMade = findSpecific(['Year', 'Date', 'Year of Issue', 'Mint Year']);
  const countryOfOrigin = findSpecific(['Country/Region of Manufacture', 'Country', 'Origin', 'Empire']);
  const material = findSpecific(['Metal', 'Material', 'Composition', 'Silver Purity']);
  const period = findSpecific(['Era', 'Period', 'Dynasty', 'Age', 'Time Period']);
  const mint = findSpecific(['Mint', 'Mint Mark', 'Mint Location']);
  const catalogueNumber = candidate.catalogueNumber || findSpecific(['Certification Number', 'Reference Number', 'Catalogue Number', 'Cat. No.']);

  // Derive specialist_id from item specifics or SKU patterns
  // Default to curiosities_collectibles for generic imports
  function deriveSpecialistId(): string {
    const titleLower = candidate.title.toLowerCase();
    const categoryLower = (candidate.categoryName ?? '').toLowerCase();
    const specificsText = (candidate.itemSpecifics ?? []).map(s => `${s.name} ${s.value}`).join(' ').toLowerCase();
    const combined = `${titleLower} ${categoryLower} ${specificsText}`;
    if (combined.includes('motocross') || combined.includes('enduro') || combined.includes('dirt bike') || combined.includes('off-road') || combined.includes('pit bike') || categoryLower.includes('motorcycle')) return 'motocross';
    if (combined.includes('shirt') || combined.includes('jacket') || combined.includes('dress') || combined.includes('jeans') || combined.includes('hoodie') || combined.includes('clothing') || combined.includes('trainer') || combined.includes('sneaker') || categoryLower.includes('clothing') || categoryLower.includes('fashion')) return 'clothing';
    if (combined.includes('coin') || combined.includes('numismatic') || combined.includes('sovereign') || combined.includes('crown') || combined.includes('penny') || combined.includes('shilling') || categoryLower.includes('coin')) return 'coins';
    if (combined.includes('stamp') || categoryLower.includes('stamp')) return 'stamps';
    if (combined.includes('pokemon') || combined.includes('magic: the gathering') || combined.includes('yu-gi-oh') || categoryLower.includes('trading card')) return 'trading_cards';
    if (combined.includes('banknote') || combined.includes('bank note') || combined.includes('paper money')) return 'banknotes';
    return 'curiosities_collectibles';
  }
  const derivedSpecialistId = deriveSpecialistId();

  // Create the inventory item with all available eBay data
  const { data: itemData, error: itemErr } = await supabase
    .from('items')
    .insert({
      tenant_id: tenantId,
      acquisition_id: candidate.acquisitionId || null,
      canonical_title: candidate.title,
      description: candidate.description || '',
      specialist_id: derivedSpecialistId,
      status: itemStatus,
      disposition_decision: 'sell_individual',
      condition: candidate.conditionDisplayName || '',
      condition_grade: '',
      condition_notes: candidate.conditionDescription || '',
      identification_confidence: 0.6,
      identification_source: 'ebay_import',
      valuation_low: 0,
      valuation_mid: candidate.price,
      valuation_high: 0,
      valuation_confidence: 'medium',
      expected_selling_price: candidate.price,
      expected_net: candidate.price * 0.8725,
      expected_profit: 0,
      sale_prob_30d: 0.5,
      attributes,
      media: securePhotos,
      warnings: [],
      tags: [],
      acquired_cost: 0,
      inventory_id: inventoryId,
      folder_number: candidate.folderNumber || '',
      pocket_position: candidate.pocketPosition || '',
      catalogue_number: catalogueNumber || '',
      sku: candidate.sku || '',
      quantity: candidate.quantity || 1,
      // Coin-specific fields auto-derived from item specifics
      ...(ruler ? { ruler } : {}),
      ...(denomination ? { denomination } : {}),
      ...(yearMade ? { year_made: yearMade } : {}),
      ...(countryOfOrigin ? { country_of_origin: countryOfOrigin } : {}),
      ...(material ? { material } : {}),
      ...(period ? { period } : {}),
      ...(mint ? { mint } : {}),
      ...(ebayStatus === 'sold' ? {
        sold_price: candidate.price,
        sold_at: new Date().toISOString(),
        marketplace: 'ebay',
      } : {}),
    })
    .select('id')
    .single();

  if (itemErr) return { itemId: null, inventoryId: null, error: itemErr.message };

  const itemId = itemData.id;

  // Create the corresponding eBay listing record with full eBay metadata
  // CRITICAL — BUG A FIX: Always persist category_id and category_name
  // so swish-ebay-list can use them during publish/revise without requiring
  // the user to re-select category every time.
  const { error: listingErr } = await supabase
    .from('listings')
    .insert({
      tenant_id: tenantId,
      item_id: itemId,
      marketplace_id: 'ebay',
      external_listing_id: candidate.ebayItemId,
      title: candidate.title,
      description: candidate.description || '',
      price: candidate.price,
      floor_price: 0,
      ceiling_price: candidate.price * 1.5,
      status: listingStatus,
      shipping_cost: candidate.shippingCost ?? 0,
      views: candidate.hitCount ?? 0,
      watchers: candidate.watchCount ?? 0,
      published_at: candidate.listedAt ?? new Date().toISOString(),
      // BUG A FIX: category_id must always be saved from the imported eBay listing
      category_id: candidate.categoryId || null,
      ...(listingStatus === 'ended' || listingStatus === 'sold' ? {
        ended_at: candidate.endedAt ?? new Date().toISOString(),
      } : {}),
    });

  // Log import fields for diagnostics
  console.log(
    `[eBay Import] itemId=${itemId} ebayItemId=${candidate.ebayItemId}` +
    ` descriptionLength=${candidate.description?.length ?? 0}` +
    ` categoryId=${candidate.categoryId ?? '(none)'}` +
    ` categoryName=${candidate.categoryName ?? '(none)'}` +
    ` imageCount=${candidate.photos?.length ?? 0}` +
    ` listingStatus=${listingStatus}`,
  );

  if (listingErr) {
    // Rollback item insert if listing fails
    await supabase.from('items').delete().eq('id', itemId);
    return { itemId: null, inventoryId: null, error: listingErr.message };
  }

  return { itemId, inventoryId, error: null };
}

/**
 * Log a completed import run.
 */
export async function logImportRun(
  tenantId: string,
  stats: {
    totalProcessed: number;
    totalImported: number;
    totalMatched: number;
    totalReview: number;
    totalSkipped: number;
    errors: string[];
  },
): Promise<void> {
  const supabase = getSupabaseClient();
  await supabase.from('ebay_import_log').insert({
    tenant_id: tenantId,
    total_processed: stats.totalProcessed,
    total_imported: stats.totalImported,
    total_matched: stats.totalMatched,
    total_review: stats.totalReview,
    total_skipped: stats.totalSkipped,
    errors: stats.errors,
  });
}

// ── Shipping services ─────────────────────────────────────────────────────────

export interface ShippingService {
  id: string;
  tenantId: string;
  name: string;
  carrier: string;
  price: number;
  weightBandG?: number;
  packageType: string;
  isTracked: boolean;
  isSigned: boolean;
  isInternational: boolean;
  isDefault: boolean;
  isActive: boolean;
  createdAt: string;
}

function mapShippingService(row: any): ShippingService {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    carrier: row.carrier,
    price: Number(row.price ?? 0),
    weightBandG: row.weight_band_g ? Number(row.weight_band_g) : undefined,
    packageType: row.package_type ?? 'large_letter',
    isTracked: !!row.is_tracked,
    isSigned: !!row.is_signed,
    isInternational: !!row.is_international,
    isDefault: !!row.is_default,
    isActive: !!row.is_active,
    createdAt: row.created_at,
  };
}

export async function getShippingServices(
  tenantId: string,
): Promise<{ services: ShippingService[]; error: string | null }> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('shipping_services')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .order('is_default', { ascending: false })
    .order('name');

  if (error) return { services: [], error: error.message };
  return { services: (data ?? []).map(mapShippingService), error: null };
}

export async function createShippingService(
  tenantId: string,
  service: Omit<ShippingService, 'id' | 'tenantId' | 'createdAt'>,
): Promise<{ service: ShippingService | null; error: string | null }> {
  const supabase = getSupabaseClient();

  // If this is the new default, clear existing defaults first
  if (service.isDefault) {
    await supabase
      .from('shipping_services')
      .update({ is_default: false })
      .eq('tenant_id', tenantId);
  }

  const { data, error } = await supabase
    .from('shipping_services')
    .insert({
      tenant_id: tenantId,
      name: service.name,
      carrier: service.carrier,
      price: service.price,
      weight_band_g: service.weightBandG ?? null,
      package_type: service.packageType,
      is_tracked: service.isTracked,
      is_signed: service.isSigned,
      is_international: service.isInternational,
      is_default: service.isDefault,
      is_active: service.isActive,
    })
    .select()
    .single();

  if (error) return { service: null, error: error.message };
  return { service: mapShippingService(data), error: null };
}

export async function updateShippingService(
  serviceId: string,
  tenantId: string,
  updates: Partial<ShippingService>,
): Promise<{ error: string | null }> {
  const supabase = getSupabaseClient();

  if (updates.isDefault) {
    await supabase
      .from('shipping_services')
      .update({ is_default: false })
      .eq('tenant_id', tenantId);
  }

  const { error } = await supabase
    .from('shipping_services')
    .update({
      ...(updates.name !== undefined && { name: updates.name }),
      ...(updates.carrier !== undefined && { carrier: updates.carrier }),
      ...(updates.price !== undefined && { price: updates.price }),
      ...(updates.weightBandG !== undefined && { weight_band_g: updates.weightBandG }),
      ...(updates.packageType !== undefined && { package_type: updates.packageType }),
      ...(updates.isTracked !== undefined && { is_tracked: updates.isTracked }),
      ...(updates.isSigned !== undefined && { is_signed: updates.isSigned }),
      ...(updates.isInternational !== undefined && { is_international: updates.isInternational }),
      ...(updates.isDefault !== undefined && { is_default: updates.isDefault }),
      ...(updates.isActive !== undefined && { is_active: updates.isActive }),
    })
    .eq('id', serviceId);

  return { error: error?.message ?? null };
}

// ── Fulfilment / dispatch ─────────────────────────────────────────────────────

export type FulfilmentStatus =
  | 'awaiting_dispatch'
  | 'packing'
  | 'label_created'
  | 'dispatched'
  | 'delivered'
  | 'completed'
  | 'returned';

export const FULFILMENT_STEPS: FulfilmentStatus[] = [
  'awaiting_dispatch',
  'packing',
  'label_created',
  'dispatched',
  'delivered',
  'completed',
];

export const FULFILMENT_LABELS: Record<FulfilmentStatus, string> = {
  awaiting_dispatch: 'Awaiting Dispatch',
  packing: 'Packing',
  label_created: 'Label Created',
  dispatched: 'Dispatched',
  delivered: 'Delivered',
  completed: 'Completed',
  returned: 'Returned',
};

export async function updateOrderFulfilmentStatus(
  orderId: string,
  status: FulfilmentStatus,
  extra?: { packedAt?: string; shipmentId?: string },
): Promise<{ error: string | null }> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('orders')
    .update({
      fulfilment_status: status,
      ...(extra?.packedAt && { packed_at: extra.packedAt }),
      ...(extra?.shipmentId && { shipment_id: extra.shipmentId }),
    })
    .eq('id', orderId);
  return { error: error?.message ?? null };
}

export interface OrderWithItem {
  id: string;
  tenantId: string;
  itemId?: string;
  listingId?: string;
  marketplaceId: string;
  externalOrderId?: string;
  buyerName?: string;
  buyerAddress: Record<string, any>;
  status: string;
  fulfilmentStatus: FulfilmentStatus;
  salePrice: number;
  marketplaceFee: number;
  shippingCost: number;
  netRevenue: number;
  trackingNumber?: string;
  carrier?: string;
  dispatchedAt?: string;
  dispatchPhotoUrl?: string;
  notes: string;
  createdAt: string;
  // Joined item fields for picking
  inventoryId?: string;
  catalogueNumber?: string;
  folderNumber?: string;
  pocketPosition?: string;
  storageLocation?: string;
  itemTitle?: string;
  itemMedia?: string[];
}

function mapOrder(row: any): OrderWithItem {
  const item = row.items;
  return {
    id: row.id,
    tenantId: row.tenant_id,
    itemId: row.item_id ?? undefined,
    listingId: row.listing_id ?? undefined,
    marketplaceId: row.marketplace_id,
    externalOrderId: row.external_order_id ?? undefined,
    buyerName: row.buyer_name ?? undefined,
    buyerAddress: row.buyer_address ?? {},
    status: row.status,
    fulfilmentStatus: (row.fulfilment_status ?? 'awaiting_dispatch') as FulfilmentStatus,
    salePrice: Number(row.sale_price ?? 0),
    marketplaceFee: Number(row.marketplace_fee ?? 0),
    shippingCost: Number(row.shipping_cost ?? 0),
    netRevenue: Number(row.net_revenue ?? 0),
    trackingNumber: row.tracking_number ?? undefined,
    carrier: row.carrier ?? undefined,
    dispatchedAt: row.dispatched_at ?? undefined,
    dispatchPhotoUrl: row.dispatch_photo_url ?? undefined,
    notes: row.notes ?? '',
    createdAt: row.created_at,
    inventoryId: item?.inventory_id ?? undefined,
    catalogueNumber: item?.catalogue_number ?? undefined,
    folderNumber: item?.folder_number ?? undefined,
    pocketPosition: item?.pocket_position ?? undefined,
    storageLocation: item?.storage_location ?? undefined,
    itemTitle: item?.canonical_title ?? undefined,
    itemMedia: item?.media ?? [],
  };
}

export async function getOrdersToDispatch(
  tenantId: string,
  specialistIds?: string[],
): Promise<{ orders: OrderWithItem[]; error: string | null }> {
  if (specialistIds && specialistIds.length === 0) return { orders: [], error: null };
  const supabase = getSupabaseClient();
  let query = supabase
    .from('orders')
    .select(specialistIds ? '*, items!inner(inventory_id, catalogue_number, folder_number, pocket_position, storage_location, canonical_title, media, specialist_id)' : '*, items(inventory_id, catalogue_number, folder_number, pocket_position, storage_location, canonical_title, media)')
    .eq('tenant_id', tenantId)
    .in('fulfilment_status', ['awaiting_dispatch', 'packing', 'label_created'])
    .order('created_at', { ascending: true });
  if (specialistIds) query = query.in('items.specialist_id', specialistIds);
  const { data, error } = await query;
  if (error) return { orders: [], error: error.message };
  return { orders: (data ?? []).map(mapOrder), error: null };
}

export async function getAllOrders(
  tenantId: string,
  fulfilmentStatus?: FulfilmentStatus,
  specialistIds?: string[],
): Promise<{ orders: OrderWithItem[]; error: string | null }> {
  if (specialistIds && specialistIds.length === 0) return { orders: [], error: null };
  const supabase = getSupabaseClient();
  let query = supabase
    .from('orders')
    .select(specialistIds ? '*, items!inner(inventory_id, catalogue_number, folder_number, pocket_position, storage_location, canonical_title, media, specialist_id)' : '*, items(inventory_id, catalogue_number, folder_number, pocket_position, storage_location, canonical_title, media)')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });
  if (fulfilmentStatus) query = query.eq('fulfilment_status', fulfilmentStatus);
  if (specialistIds) query = query.in('items.specialist_id', specialistIds);
  const { data, error } = await query.limit(200);
  if (error) return { orders: [], error: error.message };
  return { orders: (data ?? []).map(mapOrder), error: null };
}
