// SWISH Capital Service
// Tracks the complete capital lifecycle: cash → stock → sales → profit → reinvestment.

import { getSupabaseClient } from '@/template';

export interface CapitalTransaction {
  id: string;
  tenantId: string;
  type: 'acquisition_spend' | 'sale_revenue' | 'expense' | 'adjustment' | 'withdrawal' | 'deposit';
  amount: number;
  description: string;
  entityType?: string;
  entityId?: string;
  balanceAfter: number;
  createdAt: string;
}

export interface CapitalState {
  availableCash: number;
  capitalInStock: number;
  totalInventoryValue: number;
  totalInvested: number;
  totalRevenue: number;
  totalProfit: number;
  totalFees: number;
  roi: number;
  capitalVelocity: number; // profit per £ deployed per month
}

function mapTransaction(row: any): CapitalTransaction {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    type: row.type,
    amount: Number(row.amount ?? 0),
    description: row.description,
    entityType: row.entity_type ?? undefined,
    entityId: row.entity_id ?? undefined,
    balanceAfter: Number(row.balance_after ?? 0),
    createdAt: row.created_at,
  };
}

export async function listCapitalTransactions(
  tenantId: string,
  limit = 30
): Promise<{ transactions: CapitalTransaction[]; error: string | null }> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('capital_transactions')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) return { transactions: [], error: error.message };
  return { transactions: (data ?? []).map(mapTransaction), error: null };
}

export async function computeCapitalState(tenantId: string): Promise<CapitalState> {
  const supabase = getSupabaseClient();

  const [acqResult, itemsResult, salesResult, configResult] = await Promise.all([
    supabase.from('acquisitions').select('purchase_price, transport_cost, processing_cost_estimate, labour_estimate, storage_cost').eq('tenant_id', tenantId),
    supabase.from('items').select('valuation_mid, acquired_cost, status').eq('tenant_id', tenantId),
    supabase.from('sales').select('sale_price, marketplace_fee, shipping_cost, profit, sold_at').eq('tenant_id', tenantId),
    supabase.from('business_config').select('starting_capital, available_capital').eq('tenant_id', tenantId).maybeSingle(),
  ]);

  const acquisitions = acqResult.data ?? [];
  const items = itemsResult.data ?? [];
  const sales = salesResult.data ?? [];
  const config = configResult.data;

  // Total capital deployed in acquisitions
  const totalInvested = acquisitions.reduce((s, a) =>
    s + Number(a.purchase_price ?? 0) + Number(a.transport_cost ?? 0) +
    Number(a.processing_cost_estimate ?? 0) + Number(a.labour_estimate ?? 0) +
    Number(a.storage_cost ?? 0), 0);

  // Capital tied up in unsold stock (cost basis)
  const capitalInStock = items
    .filter(i => !['sold', 'disposed', 'scrapped', 'bundled'].includes(i.status))
    .reduce((s, i) => s + Number(i.acquired_cost ?? 0), 0);

  // Total inventory value (market value)
  const totalInventoryValue = items
    .filter(i => !['sold', 'disposed', 'scrapped'].includes(i.status))
    .reduce((s, i) => s + Number(i.valuation_mid ?? 0), 0);

  // Revenue and profit from sales
  const totalRevenue = sales.reduce((s, x) => s + Number(x.sale_price ?? 0), 0);
  const totalFees = sales.reduce((s, x) => s + Number(x.marketplace_fee ?? 0) + Number(x.shipping_cost ?? 0), 0);
  const totalProfit = sales.reduce((s, x) => s + Number(x.profit ?? 0), 0);

  // Available cash = starting capital + revenue - acquisition spends
  const startingCapital = Number(config?.starting_capital ?? 0);
  const availableCash = Math.max(0, startingCapital + totalRevenue - totalInvested);

  // ROI
  const roi = totalInvested > 0 ? totalProfit / totalInvested : 0;

  // Capital velocity: profit per £ deployed per month
  const earliestSale = sales.length > 0
    ? new Date(Math.min(...sales.map(s => new Date(s.sold_at).getTime())))
    : new Date();
  const monthsActive = Math.max(1, (Date.now() - earliestSale.getTime()) / (30 * 24 * 60 * 60 * 1000));
  const capitalVelocity = totalInvested > 0 ? (totalProfit / totalInvested) / monthsActive : 0;

  return {
    availableCash,
    capitalInStock,
    totalInventoryValue,
    totalInvested,
    totalRevenue,
    totalProfit,
    totalFees,
    roi,
    capitalVelocity,
  };
}

export async function recordCapitalTransaction(
  tenantId: string,
  tx: Omit<CapitalTransaction, 'id' | 'tenantId' | 'balanceAfter' | 'createdAt'>
): Promise<{ error: string | null }> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from('capital_transactions').insert({
    tenant_id: tenantId,
    type: tx.type,
    amount: tx.amount,
    description: tx.description,
    entity_type: tx.entityType ?? null,
    entity_id: tx.entityId ?? null,
    balance_after: 0, // will be computed server-side in future
  });
  return { error: error?.message ?? null };
}
