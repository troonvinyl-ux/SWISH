// SWISH Acquisition Service — OnSpace Cloud backend
// Handles all acquisition CRUD and decomposition logic.

import { getSupabaseClient } from '@/template';

export type AcquisitionStatus =
  | 'pending'
  | 'processing'
  | 'partially_processed'
  | 'processed'
  | 'selling'
  | 'completed'
  | 'closed';

export interface Acquisition {
  id: string;
  tenantId: string;
  title: string;
  description: string;
  source: string;
  purchasePrice: number;
  transportCost: number;
  processingCostEstimate: number;
  labourEstimate: number;
  storageCost: number;
  acquisitionDate: string;
  location: string;
  itemCount: number;
  processedCount: number;
  listedCount: number;
  soldCount: number;
  expectedGrossRevenue: number;
  expectedNetRevenue: number;
  expectedProfit: number;
  expectedROI: number;
  actualGrossRevenue: number;
  actualNetRevenue: number;
  actualProfit: number;
  actualROI: number;
  status: AcquisitionStatus;
  tags: string[];
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface AcquisitionSummary {
  totalCost: number;
  expectedProfit: number;
  expectedROI: number;
  progressPercent: number;
}

export interface DecompositionResult {
  suggestedStrategy: string;
  itemBreakdown: Record<string, number>;
  expectedProfit: number;
  expectedROI: number;
  profitPerLabourHour: number;
  warnings: string[];
}

function mapAcquisition(row: any): Acquisition {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    title: row.title,
    description: row.description ?? '',
    source: row.source ?? '',
    purchasePrice: Number(row.purchase_price ?? 0),
    transportCost: Number(row.transport_cost ?? 0),
    processingCostEstimate: Number(row.processing_cost_estimate ?? 0),
    labourEstimate: Number(row.labour_estimate ?? 0),
    storageCost: Number(row.storage_cost ?? 0),
    acquisitionDate: row.acquisition_date ?? '',
    location: row.location ?? '',
    itemCount: row.item_count ?? 0,
    processedCount: row.processed_count ?? 0,
    listedCount: row.listed_count ?? 0,
    soldCount: row.sold_count ?? 0,
    expectedGrossRevenue: Number(row.expected_gross_revenue ?? 0),
    expectedNetRevenue: Number(row.expected_net_revenue ?? 0),
    expectedProfit: Number(row.expected_profit ?? 0),
    expectedROI: Number(row.expected_roi ?? 0),
    actualGrossRevenue: Number(row.actual_gross_revenue ?? 0),
    actualNetRevenue: Number(row.actual_net_revenue ?? 0),
    actualProfit: Number(row.actual_profit ?? 0),
    actualROI: Number(row.actual_roi ?? 0),
    status: (row.status ?? 'pending') as AcquisitionStatus,
    tags: row.tags ?? [],
    notes: row.notes ?? '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function calculateAcquisitionSummary(acq: Acquisition): AcquisitionSummary {
  const totalCost =
    acq.purchasePrice +
    acq.transportCost +
    acq.processingCostEstimate +
    acq.labourEstimate +
    acq.storageCost;
  const expectedProfit = acq.expectedNetRevenue - totalCost;
  const expectedROI = totalCost > 0 ? expectedProfit / totalCost : 0;
  const progressPercent = acq.itemCount > 0
    ? Math.min(100, (acq.processedCount / acq.itemCount) * 100)
    : 0;
  return { totalCost, expectedProfit, expectedROI, progressPercent };
}

// List all acquisitions for a tenant
export async function listAcquisitions(
  tenantId: string
): Promise<{ acquisitions: Acquisition[]; error: string | null }> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('acquisitions')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });

  if (error) return { acquisitions: [], error: error.message };
  return { acquisitions: (data ?? []).map(mapAcquisition), error: null };
}

// Get a single acquisition
export async function getAcquisition(
  id: string
): Promise<{ acquisition: Acquisition | null; error: string | null }> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('acquisitions')
    .select('*')
    .eq('id', id)
    .single();

  if (error) return { acquisition: null, error: error.message };
  return { acquisition: mapAcquisition(data), error: null };
}

// Create a new acquisition
export async function createAcquisition(
  tenantId: string,
  input: { title: string; source?: string; purchasePrice?: number; notes?: string; location?: string }
): Promise<{ acquisition: Acquisition | null; error: string | null }> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('acquisitions')
    .insert({
      tenant_id: tenantId,
      title: input.title,
      source: input.source ?? '',
      purchase_price: input.purchasePrice ?? 0,
      notes: input.notes ?? '',
      location: input.location ?? '',
      status: 'pending',
    })
    .select()
    .single();

  if (error) return { acquisition: null, error: error.message };
  return { acquisition: mapAcquisition(data), error: null };
}

// Update an acquisition
export async function updateAcquisition(
  id: string,
  updates: Partial<Omit<Acquisition, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>>
): Promise<{ error: string | null }> {
  const supabase = getSupabaseClient();
  const dbUpdates: Record<string, any> = {};
  if (updates.title !== undefined) dbUpdates.title = updates.title;
  if (updates.status !== undefined) dbUpdates.status = updates.status;
  if (updates.notes !== undefined) dbUpdates.notes = updates.notes;
  if (updates.expectedGrossRevenue !== undefined) dbUpdates.expected_gross_revenue = updates.expectedGrossRevenue;
  if (updates.expectedNetRevenue !== undefined) dbUpdates.expected_net_revenue = updates.expectedNetRevenue;
  if (updates.expectedProfit !== undefined) dbUpdates.expected_profit = updates.expectedProfit;
  if (updates.expectedROI !== undefined) dbUpdates.expected_roi = updates.expectedROI;

  const { error } = await supabase.from('acquisitions').update(dbUpdates).eq('id', id);
  return { error: error?.message ?? null };
}

// Run AI decomposition analysis (mocked — ready for real AI edge function)
export async function runDecomposition(acquisition: Acquisition): Promise<DecompositionResult> {
  await new Promise((r) => setTimeout(r, 2000));

  const totalCost = calculateAcquisitionSummary(acquisition).totalCost;
  const itemCount = Math.max(acquisition.itemCount, 10);

  const individual = Math.round(itemCount * 0.38);
  const bundles = Math.round(itemCount * 0.22);
  const premium = Math.round(itemCount * 0.08);
  const hold = Math.round(itemCount * 0.06);
  const wholesale = Math.round(itemCount * 0.12);
  const bulk = itemCount - individual - bundles - premium - hold - wholesale;

  const expectedGross = totalCost * 2.4;
  const fees = expectedGross * 0.12;
  const shipping = individual * 2.80;
  const expectedNet = expectedGross - fees - shipping;
  const expectedProfit = expectedNet - totalCost;
  const profitPerLabourHour = acquisition.labourEstimate > 0
    ? expectedProfit / (acquisition.labourEstimate / 15)
    : 32;

  return {
    suggestedStrategy:
      `AI recommends prioritising the ${individual} individual-sale items first for fastest capital recovery. ` +
      `Bundle ${bundles} low-value items into ${Math.round(bundles / 8)} job lots. ` +
      `${premium} items identified as premium — hold for specialist listing.`,
    itemBreakdown: {
      individual,
      bundles,
      premium,
      hold,
      wholesale,
      bulk_or_scrap: Math.max(0, bulk),
    },
    expectedProfit: Math.round(expectedProfit),
    expectedROI: totalCost > 0 ? Math.round((expectedProfit / totalCost) * 100) / 100 : 0,
    profitPerLabourHour: Math.round(profitPerLabourHour),
    warnings: acquisition.purchasePrice > 3000
      ? ['High-value acquisition — consider staged processing to manage capital risk']
      : [],
  };
}
