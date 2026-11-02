
// KEENONCOINS Item Service — OnSpace Cloud backend
// Canonical inventory item CRUD — one physical item = one inventory record.

import { getSupabaseClient } from '@/template';
import { EvidenceSource, ConfidenceTier, ItemStatus, DispositionDecision } from '@/constants/config';
import { SpecialistId } from '@/constants/specialists';
import { resolveProductionNiche } from './nicheRouting';

export interface Item {
  id: string;
  tenantId: string;
  acquisitionId?: string;
  canonicalTitle: string;
  description: string;
  specialistId: SpecialistId;
  status: ItemStatus;
  dispositionDecision: DispositionDecision;
  condition: string;
  conditionGrade?: string;
  conditionNotes: string;
  identificationConfidence: number;
  identificationSource: EvidenceSource;
  valuationLow: number;
  valuationMid: number;
  valuationHigh: number;
  valuationConfidence: ConfidenceTier;
  expectedSellingPrice: number;
  expectedNet: number;
  expectedProfit: number;
  saleProb30d: number;
  attributes: Record<string, any>;
  media: string[];
  warnings: string[];
  tags: string[];
  acquiredCost: number;
  soldPrice?: number;
  soldAt?: string;
  marketplace?: string;
  // Physical attributes
  weightGrams?: number;
  dimensionsMm?: { length?: number; width?: number; height?: number; diameter?: number };
  material?: string;
  manufacturer?: string;
  yearMade?: string;
  countryOfOrigin?: string;
  quantity?: number;
  sku?: string;
  storageLocation?: string;
  customNotes?: string;
  // Coin-specific inventory fields
  inventoryId?: string;       // KC-000001 — permanent unique identifier
  folderNumber?: string;       // Physical folder number
  pocketPosition?: string;     // Position within folder
  catalogueNumber?: string;    // Dealer/reference catalogue number
  period?: string;             // Historical period (e.g. Roman, Medieval)
  ruler?: string;              // Monarch / Emperor / Ruler
  mint?: string;               // Mint location
  denomination?: string;       // Face value / denomination
  diameterMm?: number;         // Coin diameter in mm
  createdAt: string;
  updatedAt: string;
}

// ── Lifecycle groups ─────────────────────────────────────────────────────────
// Active Inventory = Draft + Live  (what the seller currently needs to deal with)
// History          = Sold + Archived  (permanent records, not shown in active view)

export const ITEM_LIFECYCLE = {
  // Items being prepared — not yet published to any marketplace
  DRAFT_STATUSES: [
    'new', 'captured', 'identifying', 'identified',
    'researching', 'researched', 'assessing', 'assessed',
    'pricing', 'priced', 'listing', 'review_required', 'review', 'error',
  ] as string[],

  // Items confirmed live on a marketplace
  LIVE_STATUSES: ['listed', 'active'] as string[],

  // Items that have sold — removed from active view
  SOLD_STATUSES: ['sold', 'fulfilled', 'completed'] as string[],

  // Items deliberately removed / archived
  ARCHIVED_STATUSES: ['held', 'bundled', 'wholesaled', 'scrapped', 'disposed'] as string[],
} as const;

// Active inventory = Draft + Live (shown on the main Inventory screen)
export const ACTIVE_INVENTORY_STATUSES: string[] = [
  ...ITEM_LIFECYCLE.DRAFT_STATUSES,
  ...ITEM_LIFECYCLE.LIVE_STATUSES,
];

// History statuses (sold/archived — never shown in active view)
export const HISTORY_STATUSES: string[] = [
  ...ITEM_LIFECYCLE.SOLD_STATUSES,
  ...ITEM_LIFECYCLE.ARCHIVED_STATUSES,
];

export function getLifecycleGroup(status: string): 'draft' | 'live' | 'sold' | 'archived' {
  if (ITEM_LIFECYCLE.LIVE_STATUSES.includes(status)) return 'live';
  if (ITEM_LIFECYCLE.SOLD_STATUSES.includes(status)) return 'sold';
  if (ITEM_LIFECYCLE.ARCHIVED_STATUSES.includes(status)) return 'archived';
  return 'draft'; // default — all pre-listed states
}

export interface ItemFilter {
  status?: string;
  statuses?: string[];       // multiple status filter
  lifecycleGroup?: 'active' | 'draft' | 'live' | 'sold' | 'archived' | 'history';
  specialistId?: string;     // single specialist filter
  specialistIds?: string[];  // multiple specialist filter (niche isolation)
  acquisitionId?: string;
  search?: string;
  reviewRequired?: boolean;
}

const EVIDENCE_SOURCES: EvidenceSource[] = ['detected', 'inferred', 'researched', 'user_confirmed', 'verified', 'unknown'];
const CONFIDENCE_TIERS: ConfidenceTier[] = ['very_high', 'high', 'medium', 'low', 'very_low', 'unknown'];

function toEvidenceSource(v: string | null | undefined): EvidenceSource {
  return EVIDENCE_SOURCES.includes(v as EvidenceSource) ? (v as EvidenceSource) : 'unknown';
}

function toConfidenceTier(v: string | null | undefined): ConfidenceTier {
  return CONFIDENCE_TIERS.includes(v as ConfidenceTier) ? (v as ConfidenceTier) : 'unknown';
}

export function mapItem(row: any): Item {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    acquisitionId: row.acquisition_id ?? undefined,
    canonicalTitle: row.canonical_title,
    description: row.description ?? '',
    specialistId: (row.specialist_id ?? 'curiosities_collectibles') as SpecialistId,
    status: (row.status ?? 'new') as ItemStatus,
    dispositionDecision: (row.disposition_decision ?? 'pending') as DispositionDecision,
    condition: row.condition ?? '',
    conditionGrade: row.condition_grade ?? undefined,
    conditionNotes: row.condition_notes ?? '',
    identificationConfidence: Number(row.identification_confidence ?? 0),
    identificationSource: toEvidenceSource(row.identification_source),
    valuationLow: Number(row.valuation_low ?? 0),
    valuationMid: Number(row.valuation_mid ?? 0),
    valuationHigh: Number(row.valuation_high ?? 0),
    valuationConfidence: toConfidenceTier(row.valuation_confidence),
    expectedSellingPrice: Number(row.expected_selling_price ?? 0),
    expectedNet: Number(row.expected_net ?? 0),
    expectedProfit: Number(row.expected_profit ?? 0),
    saleProb30d: Number(row.sale_prob_30d ?? 0),
    attributes: row.attributes ?? {},
    media: row.media ?? [],
    warnings: row.warnings ?? [],
    tags: row.tags ?? [],
    acquiredCost: Number(row.acquired_cost ?? 0),
    soldPrice: row.sold_price ? Number(row.sold_price) : undefined,
    soldAt: row.sold_at ?? undefined,
    marketplace: row.marketplace ?? undefined,
    weightGrams: row.weight_grams ? Number(row.weight_grams) : undefined,
    dimensionsMm: row.dimensions_mm ?? undefined,
    material: row.material ?? undefined,
    manufacturer: row.manufacturer ?? undefined,
    yearMade: row.year_made ?? undefined,
    countryOfOrigin: row.country_of_origin ?? undefined,
    quantity: row.quantity ? Number(row.quantity) : undefined,
    sku: row.sku ?? undefined,
    storageLocation: row.storage_location ?? undefined,
    customNotes: row.custom_notes ?? undefined,
    inventoryId: row.inventory_id ?? undefined,
    folderNumber: row.folder_number ?? undefined,
    pocketPosition: row.pocket_position ?? undefined,
    catalogueNumber: row.catalogue_number ?? undefined,
    period: row.period ?? undefined,
    ruler: row.ruler ?? undefined,
    mint: row.mint ?? undefined,
    denomination: row.denomination ?? undefined,
    diameterMm: row.diameter_mm ? Number(row.diameter_mm) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// List items for a tenant with optional filters
export async function listItems(
  tenantId: string,
  filter: ItemFilter = {}
): Promise<{ items: Item[]; error: string | null }> {
  if (filter.specialistIds?.length === 0) return { items: [], error: null };
  if (!tenantId?.trim()) return { items: [], error: 'tenantId is required' };
  const supabase = getSupabaseClient();
  // Surface entitlement denials as actionable errors rather than an apparently empty stock list.
  const requestedSpecialists=filter.specialistIds ?? (filter.specialistId ? [filter.specialistId] : []);
  const requestedNiches=[...new Set(requestedSpecialists.map(resolveProductionNiche))];
  for(const niche of requestedNiches) {
    const { data:allowed,error:authorizationError }=await supabase.rpc('swish_can_access_niche',{ p_tenant_id:tenantId,p_niche_id:niche });
    if(authorizationError || !allowed) return { items:[],error:authorizationError ? 'Inventory authorization unavailable. Retry shortly.' : 'Verified paid access is required for this inventory niche. Refresh your subscription after checkout.' };
  }
  let query = supabase
    .from('items')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });

  // Lifecycle group filtering (takes precedence over individual status)
  if (filter.lifecycleGroup) {
    let statuses: string[];
    switch (filter.lifecycleGroup) {
      case 'active':   statuses = ACTIVE_INVENTORY_STATUSES; break;
      case 'draft':    statuses = ITEM_LIFECYCLE.DRAFT_STATUSES; break;
      case 'live':     statuses = ITEM_LIFECYCLE.LIVE_STATUSES; break;
      case 'sold':     statuses = ITEM_LIFECYCLE.SOLD_STATUSES; break;
      case 'archived': statuses = ITEM_LIFECYCLE.ARCHIVED_STATUSES; break;
      case 'history':  statuses = HISTORY_STATUSES; break;
      default:         statuses = ACTIVE_INVENTORY_STATUSES;
    }
    query = query.in('status', statuses);
  } else if (filter.statuses && filter.statuses.length > 0) {
    query = query.in('status', filter.statuses);
  } else if (filter.status) {
    query = query.eq('status', filter.status);
  }
  // Niche isolation: filter by specialist_id(s)
  if (filter.specialistIds && filter.specialistIds.length > 0) {
    query = query.in('specialist_id', filter.specialistIds);
  } else if (filter.specialistId) {
    query = query.eq('specialist_id', filter.specialistId);
  }
  if (filter.acquisitionId) query = query.eq('acquisition_id', filter.acquisitionId);
  if (filter.reviewRequired) query = query.eq('status', 'review_required');
  if (filter.search) {
    // PostgREST OR grammar is not a free-text input; remove its control characters.
    const q = filter.search.replace(/[(),%_\\]/g, ' ').trim().slice(0, 120);
    // Search across title, catalogue number, folder, ruler, denomination, inventory ID
    query = query.or(
      `canonical_title.ilike.%${q}%,catalogue_number.ilike.%${q}%,folder_number.ilike.%${q}%,ruler.ilike.%${q}%,denomination.ilike.%${q}%,inventory_id.ilike.%${q}%,mint.ilike.%${q}%,country_of_origin.ilike.%${q}%`
    );
  }

  const { data, error } = await query.limit(500);
  if (error) return { items: [], error: error.message };
  return { items: (data ?? []).map(mapItem), error: null };
}

// Get item counts by status — optionally scoped to niche specialist IDs
export async function getItemStatusCounts(
  tenantId: string,
  specialistIds?: string[]
): Promise<Record<string, number>> {
  if (!tenantId?.trim() || specialistIds?.length === 0) return {};
  const supabase = getSupabaseClient();
  let query = supabase
    .from('items')
    .select('status')
    .eq('tenant_id', tenantId);

  if (specialistIds && specialistIds.length > 0) {
    query = query.in('specialist_id', specialistIds);
  }

  const { data } = await query;
  const counts: Record<string, number> = {};
  (data ?? []).forEach((row) => {
    counts[row.status] = (counts[row.status] ?? 0) + 1;
  });
  return counts;
}

// Create an item
export async function createItem(
  tenantId: string,
  input: Partial<Item> & { canonicalTitle: string; specialistId: SpecialistId }
): Promise<{ item: Item | null; error: string | null }> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('items')
    .insert({
      tenant_id: tenantId,
      acquisition_id: input.acquisitionId ?? null,
      canonical_title: input.canonicalTitle,
      description: input.description ?? '',
      specialist_id: input.specialistId,
      status: input.status ?? 'new',
      disposition_decision: input.dispositionDecision ?? 'pending',
      condition: input.condition ?? '',
      condition_grade: input.conditionGrade ?? '',
      condition_notes: input.conditionNotes ?? '',
      identification_confidence: input.identificationConfidence ?? 0,
      identification_source: input.identificationSource ?? 'unknown',
      valuation_low: input.valuationLow ?? 0,
      valuation_mid: input.valuationMid ?? 0,
      valuation_high: input.valuationHigh ?? 0,
      valuation_confidence: input.valuationConfidence ?? 'low',
      expected_selling_price: input.expectedSellingPrice ?? 0,
      expected_net: input.expectedNet ?? 0,
      expected_profit: input.expectedProfit ?? 0,
      sale_prob_30d: input.saleProb30d ?? 0,
      attributes: input.attributes ?? {},
      catalogue_number: input.catalogueNumber ?? '',
      ruler: input.ruler ?? '', denomination: input.denomination ?? '',
      period: input.period ?? '', mint: input.mint ?? '',
      material: input.material ?? '', manufacturer: input.manufacturer ?? '',
      country_of_origin: input.countryOfOrigin ?? '', year_made: input.yearMade ?? '',
      weight_grams: input.weightGrams ?? null, diameter_mm: input.diameterMm ?? null,
      quantity: input.quantity ?? 1, sku: input.sku ?? '',
      media: input.media ?? [],
      warnings: input.warnings ?? [],
      tags: input.tags ?? [],
      acquired_cost: input.acquiredCost ?? 0,
    })
    .select()
    .single();

  if (error) return { item: null, error: error.message };
  return { item: mapItem(data), error: null };
}

// Get a single item by ID
export async function getItem(
  id: string
): Promise<{ item: Item | null; error: string | null }> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('items')
    .select('*')
    .eq('id', id)
    .single();

  if (error) return { item: null, error: error.message };
  return { item: mapItem(data), error: null };
}

// ── Valuation history ─────────────────────────────────────────────────────────

export interface Valuation {
  id: string;
  itemId: string;
  tenantId: string;
  source: string;
  lowValue: number;
  midValue: number;
  highValue: number;
  confidence: ConfidenceTier;
  basis: string;
  evidence: string[];
  createdAt: string;
}

function mapValuation(row: any): Valuation {
  return {
    id: row.id,
    itemId: row.item_id,
    tenantId: row.tenant_id,
    source: row.source,
    lowValue: Number(row.low_value ?? 0),
    midValue: Number(row.mid_value ?? 0),
    highValue: Number(row.high_value ?? 0),
    confidence: (row.confidence ?? 'medium') as ConfidenceTier,
    basis: row.basis ?? '',
    evidence: row.evidence ?? [],
    createdAt: row.created_at,
  };
}

export async function getItemValuations(
  itemId: string
): Promise<{ valuations: Valuation[]; error: string | null }> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('valuations')
    .select('*')
    .eq('item_id', itemId)
    .order('created_at', { ascending: false });

  if (error) return { valuations: [], error: error.message };
  return { valuations: (data ?? []).map(mapValuation), error: null };
}

// ── Lifecycle transition helpers ─────────────────────────────────────────────

/**
 * Mark an item as SOLD. Records the sale, transitions item status, and
 * removes it from active inventory. The item remains permanently in the DB
 * as historical data accessible via the History view.
 */
export async function markItemSold(
  itemId: string,
  tenantId: string,
  params: {
    soldPrice: number;
    soldAt?: string;
    marketplace?: string;
    externalOrderId?: string;
    triggeredBy?: 'user' | 'ebay_sync' | 'system';
  }
): Promise<{ error: string | null }> {
  if (!tenantId?.trim() || !itemId?.trim()) return { error: 'Item and tenantId are required' };
  if (!Number.isFinite(params.soldPrice) || params.soldPrice < 0) return { error: 'A non-negative sale amount is required' };
  const { data, error } = await getSupabaseClient().rpc('swish_transition_item', {
    p_tenant_id: tenantId, p_item_id: itemId, p_status: 'sold',
    p_notes: params.externalOrderId ? `User-reported sale; order reference: ${params.externalOrderId}` : 'User-reported sale',
    p_sold_price: params.soldPrice, p_sold_at: params.soldAt ?? new Date().toISOString(),
    p_marketplace: params.marketplace ?? 'ebay',
  });
  return { error: error?.message ?? (data === true ? null : 'Sale transition was not confirmed') };
}

/**
 * Archive an item (remove from active inventory without selling).
 * Item remains in DB as historical record.
 */
export async function archiveItem(
  itemId: string,
  tenantId: string,
  reason: string = 'User removed from sale'
): Promise<{ error: string | null }> {
  return transitionItemStatus(itemId, tenantId, 'held', 'user', reason);
}

/**
 * Transition item status with lifecycle event tracking.
 */
export async function transitionItemStatus(
  itemId: string,
  tenantId: string,
  newStatus: ItemStatus,
  triggeredBy: 'user' | 'ebay_sync' | 'system' = 'system',
  notes?: string
): Promise<{ error: string | null }> {
  if (!tenantId?.trim() || !itemId?.trim()) return { error: 'Item and tenantId are required' };
  // The server determines the audit actor from the session; labels are not authorization.
  const { data, error } = await getSupabaseClient().rpc('swish_transition_item', {
    p_tenant_id: tenantId, p_item_id: itemId, p_status: newStatus,
    p_notes: notes ?? `Requested transition (${triggeredBy}); server session determines actor`,
  });
  return { error: error?.message ?? (data === true ? null : 'Item transition was not confirmed') };
}

// Delete an item
// SWISH-005: tenantId is REQUIRED — fails closed if missing or empty.
// The mutation is constrained by both item id AND tenant_id to prevent
// cross-tenant deletes at the application layer (DB RLS enforces this
// too, but defence-in-depth is required by the audit).
export async function deleteItem(
  id: string,
  tenantId: string
): Promise<{ error: string | null }> {
  // Fail closed — never execute an unscoped delete
  if (!tenantId || tenantId.trim() === '') {
    return { error: 'deleteItem: tenantId is required — operation refused' };
  }
  const supabase = getSupabaseClient();
  const { error, count } = await supabase
    .from('items')
    .delete({ count: 'exact' })
    .eq('id', id)
    .eq('tenant_id', tenantId);
  if (error) return { error: error.message };
  // count === 0 means the item either doesn't exist or belongs to another tenant.
  // Return a descriptive error so callers can surface this rather than silently succeeding.
  if (count === 0) return { error: 'Item not found or does not belong to this account' };
  return { error: null };
}

// Update an item
// SWISH-005: tenantId is REQUIRED — fails closed if missing or empty.
// The mutation is constrained by both item id AND tenant_id to prevent
// cross-tenant updates at the application layer (DB RLS enforces this
// too, but defence-in-depth is required by the audit).
export async function updateItem(
  id: string,
  updates: Partial<Item>,
  tenantId?: string
): Promise<{ error: string | null }> {
  // Fail closed for every mutation, including legacy omitted tenant arguments.
  if (!tenantId || tenantId.trim() === '') {
    return { error: 'updateItem: tenantId is required — operation refused' };
  }
  const supabase = getSupabaseClient();
  const dbUpdates: Record<string, any> = {};
  const fieldMap: Record<string, string> = {
    canonicalTitle: 'canonical_title',
    status: 'status',
    dispositionDecision: 'disposition_decision',
    condition: 'condition',
    conditionGrade: 'condition_grade',
    conditionNotes: 'condition_notes',
    identificationConfidence: 'identification_confidence',
    identificationSource: 'identification_source',
    valuationLow: 'valuation_low',
    valuationMid: 'valuation_mid',
    valuationHigh: 'valuation_high',
    valuationConfidence: 'valuation_confidence',
    expectedSellingPrice: 'expected_selling_price',
    expectedNet: 'expected_net',
    expectedProfit: 'expected_profit',
    saleProb30d: 'sale_prob_30d',
    attributes: 'attributes',
    warnings: 'warnings',
    tags: 'tags',
    soldPrice: 'sold_price',
    soldAt: 'sold_at',
    description: 'description',
    acquiredCost: 'acquired_cost',
    weightGrams: 'weight_grams',
    dimensionsMm: 'dimensions_mm',
    material: 'material',
    manufacturer: 'manufacturer',
    yearMade: 'year_made',
    countryOfOrigin: 'country_of_origin',
    quantity: 'quantity',
    sku: 'sku',
    storageLocation: 'storage_location',
    customNotes: 'custom_notes',
    inventoryId: 'inventory_id',
    folderNumber: 'folder_number',
    pocketPosition: 'pocket_position',
    catalogueNumber: 'catalogue_number',
    period: 'period',
    ruler: 'ruler',
    mint: 'mint',
    denomination: 'denomination',
    diameterMm: 'diameter_mm',
  };

  Object.entries(updates).forEach(([key, val]) => {
    const dbKey = fieldMap[key];
    if (dbKey && val !== undefined) dbUpdates[dbKey] = val;
  });

  // Build the query — always scope by id; also scope by tenant_id when provided
  let query = supabase.from('items').update(dbUpdates, { count: 'exact' }).eq('id', id);
  if (tenantId) {
    query = query.eq('tenant_id', tenantId);
  }
  const { error, count } = await query;
  if (error) return { error: error.message };
  // When tenantId was provided, zero rows means item not found or belongs to another tenant
  if (tenantId && count === 0) {
    return { error: 'Item not found or does not belong to this account' };
  }
  return { error: null };
}
