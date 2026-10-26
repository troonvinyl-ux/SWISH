// SWISH Insights Service — OnSpace Cloud backend
// Business metrics, AI insights, and analytics.

import { getSupabaseClient } from '@/template';

export interface BusinessMetrics {
  tenantId: string;
  period: string;
  totalAcquisitions: number;
  totalItems: number;
  listedItems: number;
  soldItems: number;
  totalRevenue: number;
  totalFees: number;
  totalShipping: number;
  totalLabour: number;
  totalProfit: number;
  averageROI: number;
  averageMargin: number;
  capitalInvested: number;
  capitalTiedUp: number;
  cashAvailable: number;
  predictionAccuracy: number;
  sellThroughRate: number;
  averageTimeToSale: number;
  profitPerLabourHour: number;
  topPerformingSpecialist: string;
  staleItemCount: number;
  exceptionCount: number;
}

export interface AIInsight {
  id: string;
  type: 'opportunity' | 'warning' | 'recommendation' | 'anomaly' | 'performance';
  priority: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  detail: string;
  action?: string;
  actionLabel?: string;
  estimatedValue?: number;
  confidence: string;
  isDismissed: boolean;
  createdAt: string;
}

export interface WealthSnapshot {
  totalAssetValue: number;
  profitThisMonth: number;
  capitalGrowth: number;
}

export interface SpecialistPerformance {
  specialistId: string;
  name: string;
  itemCount: number;
  soldCount: number;
  totalRevenue: number;
  averageMargin: number;
  predictionAccuracy: number;
}

export interface CapitalAnalysis {
  available: number;
  tiedInStock: number;
  tiedInAcquisitions: number;
  unrealisedValue: number;
  expectedReturn: number;
  returnOnCapital: number;
}

export interface PredictionPerformance {
  period: string;
  overallAccuracy: number;
  valuationAccuracy: number;
  saleProbAccuracy: number;
  timeToSaleAccuracy: number;
  feeAccuracy: number;
  sampleSize: number;
}

function mapInsight(row: any): AIInsight {
  return {
    id: row.id,
    type: row.type,
    priority: row.priority,
    title: row.title,
    detail: row.detail ?? '',
    action: row.action ?? undefined,
    actionLabel: row.action_label ?? undefined,
    estimatedValue: row.estimated_value ? Number(row.estimated_value) : undefined,
    confidence: row.confidence,
    isDismissed: row.is_dismissed ?? false,
    createdAt: row.created_at,
  };
}

// Fetch AI insights for a tenant
export async function listInsights(
  tenantId: string
): Promise<{ insights: AIInsight[]; error: string | null }> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('ai_insights')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('is_dismissed', false)
    .order('priority', { ascending: true })
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) return { insights: [], error: error.message };
  return { insights: (data ?? []).map(mapInsight), error: null };
}

// Seed initial insights for a new tenant
export async function seedInsightsForTenant(tenantId: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { count } = await supabase
    .from('ai_insights')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', tenantId);

  if ((count ?? 0) > 0) return;

  const seedInsights = [
    {
      tenant_id: tenantId,
      type: 'recommendation',
      priority: 'high',
      title: 'Welcome to SWISH — Start Your First Acquisition',
      detail: 'Add a bulk acquisition to begin. Use "New Acquisition" on the Acquisitions tab, then scan or manually add items to start building your inventory.',
      action: 'open_acquisitions',
      action_label: 'Add Acquisition',
      confidence: 'high',
    },
    {
      tenant_id: tenantId,
      type: 'performance',
      priority: 'medium',
      title: 'AI Prediction Engine Ready',
      detail: 'SWISH will track predictions vs actual outcomes as you sell items. Your AI accuracy score improves with every completed transaction.',
      confidence: 'high',
    },
    {
      tenant_id: tenantId,
      type: 'opportunity',
      priority: 'medium',
      title: 'Connect a Marketplace to Start Selling',
      detail: 'Link your eBay account to enable one-click listing creation and automatic order sync. Go to Settings > Marketplaces to connect.',
      action: 'open_settings',
      action_label: 'Open Settings',
      confidence: 'high',
    },
  ];

  await supabase.from('ai_insights').insert(seedInsights);
}

// Compute business metrics from live data
export async function computeBusinessMetrics(
  tenantId: string
): Promise<{ metrics: BusinessMetrics; error: string | null }> {
  const supabase = getSupabaseClient();

  const [acqResult, itemsResult, salesResult] = await Promise.all([
    supabase.from('acquisitions').select('*').eq('tenant_id', tenantId),
    supabase.from('items').select('status, valuation_mid, acquired_cost, specialist_id, sold_price, sold_at, updated_at').eq('tenant_id', tenantId),
    supabase.from('sales').select('*').eq('tenant_id', tenantId),
  ]);

  const acquisitions = acqResult.data ?? [];
  const items = itemsResult.data ?? [];
  const sales = salesResult.data ?? [];

  const totalItems = items.length;
  const listedItems = items.filter((i) => i.status === 'listed').length;
  const soldItems = items.filter((i) => i.status === 'sold').length;
  const reviewItems = items.filter((i) => i.status === 'review_required').length;

  const totalRevenue = sales.reduce((s, x) => s + Number(x.sale_price ?? 0), 0);
  const totalFees = sales.reduce((s, x) => s + Number(x.marketplace_fee ?? 0), 0);
  const totalShipping = sales.reduce((s, x) => s + Number(x.shipping_cost ?? 0), 0);
  const totalProfit = sales.reduce((s, x) => s + Number(x.profit ?? 0), 0);

  const capitalInvested = acquisitions.reduce((s, a) => s + Number(a.purchase_price ?? 0), 0);
  const capitalTiedUp = items
    .filter((i) => i.status !== 'sold')
    .reduce((s, i) => s + Number(i.acquired_cost ?? 0), 0);
  const cashAvailable = Math.max(0, capitalInvested - capitalTiedUp);

  const totalInventoryValue = items
    .filter((i) => i.status !== 'sold')
    .reduce((s, i) => s + Number(i.valuation_mid ?? 0), 0);

  const sellThroughRate = totalItems > 0 ? soldItems / totalItems : 0;
  const averageMargin = totalRevenue > 0 ? totalProfit / totalRevenue : 0;
  const averageROI = capitalInvested > 0 ? totalProfit / capitalInvested : 0;

  // Stale: listed items not updated in 14+ days
  const staleDate = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const staleItemCount = items.filter(
    (i) => i.status === 'listed' && i.updated_at < staleDate
  ).length;

  // Specialists breakdown
  const specialistCounts: Record<string, number> = {};
  items.forEach((i) => {
    specialistCounts[i.specialist_id] = (specialistCounts[i.specialist_id] ?? 0) + 1;
  });

  const topPerformingSpecialist = Object.entries(specialistCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'coins';

  // Prediction accuracy from sales — use real data only, never fabricate
  const salesWithPredictions = sales.filter((s) => Number(s.predicted_profit ?? 0) > 0 && Number(s.prediction_accuracy ?? 0) > 0);
  const predictionAccuracy = salesWithPredictions.length >= 5
    ? salesWithPredictions.reduce((s, x) => s + Number(s.prediction_accuracy ?? 0), 0) / salesWithPredictions.length
    : 0; // 0 = insufficient data, not a fabricated number

  // Labour efficiency from recorded labour estimates
  const totalLabourHours = acquisitions.reduce((s, a) => s + Number(a.labour_estimate ?? 0), 0);
  const profitPerLabourHour = totalLabourHours > 0 ? totalProfit / totalLabourHours : 0;

  const now = new Date();
  const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  return {
    metrics: {
      tenantId,
      period,
      totalAcquisitions: acquisitions.length,
      totalItems,
      listedItems,
      soldItems,
      totalRevenue,
      totalFees,
      totalShipping,
      totalLabour: 0,
      totalProfit,
      averageROI,
      averageMargin,
      capitalInvested,
      capitalTiedUp,
      cashAvailable,
      predictionAccuracy,
      sellThroughRate,
      averageTimeToSale: soldItems > 0 ? (() => {
        // Calculate real average days-to-sale from items that have sold_at and created_at
        const soldWithDates = items.filter(
          (i) => i.status === 'sold' && i.sold_at && i.updated_at
        );
        if (soldWithDates.length === 0) return 0;
        const totalDays = soldWithDates.reduce((s, i) => {
          const createdMs = new Date(i.updated_at).getTime(); // approximation
          const soldMs = new Date(i.sold_at!).getTime();
          return s + Math.max(0, (soldMs - createdMs) / 86400000);
        }, 0);
        return totalDays / soldWithDates.length;
      })() : 0,
      profitPerLabourHour,
      topPerformingSpecialist,
      staleItemCount,
      exceptionCount: reviewItems,
    },
    error: null,
  };
}

export async function computeWealthSnapshot(
  tenantId: string
): Promise<WealthSnapshot> {
  const supabase = getSupabaseClient();
  const [itemsResult, salesResult] = await Promise.all([
    supabase.from('items').select('valuation_mid, status').eq('tenant_id', tenantId),
    supabase.from('sales').select('profit, sold_at').eq('tenant_id', tenantId),
  ]);

  const items = itemsResult.data ?? [];
  const sales = salesResult.data ?? [];

  const totalAssetValue = items
    .filter((i) => i.status !== 'sold')
    .reduce((s, i) => s + Number(i.valuation_mid ?? 0), 0);

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const profitThisMonth = sales
    .filter((s) => s.sold_at >= startOfMonth)
    .reduce((s, x) => s + Number(x.profit ?? 0), 0);

  const totalProfit = sales.reduce((s, x) => s + Number(x.profit ?? 0), 0);
  const acqRes = await supabase.from('acquisitions').select('purchase_price').eq('tenant_id', tenantId);
  const capitalInvested = (acqRes.data ?? []).reduce((s, a) => s + Number(a.purchase_price ?? 0), 0);
  const capitalGrowth = capitalInvested > 0 ? totalProfit / capitalInvested : 0;

  return { totalAssetValue, profitThisMonth, capitalGrowth };
}

export async function computeCapitalAnalysis(tenantId: string): Promise<CapitalAnalysis> {
  const supabase = getSupabaseClient();
  const [acqResult, itemsResult] = await Promise.all([
    supabase.from('acquisitions').select('purchase_price, expected_net_revenue').eq('tenant_id', tenantId),
    supabase.from('items').select('valuation_mid, acquired_cost, expected_net, status').eq('tenant_id', tenantId),
  ]);

  const acquisitions = acqResult.data ?? [];
  const items = itemsResult.data ?? [];

  const tiedInAcquisitions = acquisitions.reduce((s, a) => s + Number(a.purchase_price ?? 0), 0);
  const tiedInStock = items.filter((i) => i.status !== 'sold').reduce((s, i) => s + Number(i.acquired_cost ?? 0), 0);
  const available = Math.max(0, tiedInAcquisitions - tiedInStock);
  const unrealisedValue = items.filter((i) => i.status !== 'sold').reduce((s, i) => s + Number(i.valuation_mid ?? 0), 0);
  const expectedReturn = items.filter((i) => i.status !== 'sold').reduce((s, i) => s + Number(i.expected_net ?? 0), 0);
  const returnOnCapital = tiedInAcquisitions > 0 ? (expectedReturn - tiedInAcquisitions) / tiedInAcquisitions : 0;

  return { available, tiedInStock, tiedInAcquisitions, unrealisedValue, expectedReturn, returnOnCapital };
}

export async function computeSpecialistPerformance(tenantId: string): Promise<SpecialistPerformance[]> {
  const supabase = getSupabaseClient();
  const { data: items } = await supabase
    .from('items')
    .select('specialist_id, status, sold_price, acquired_cost, valuation_mid')
    .eq('tenant_id', tenantId);

  const grouped: Record<string, { count: number; sold: number; revenue: number; cost: number }> = {};

  (items ?? []).forEach((item) => {
    const sid = item.specialist_id;
    if (!grouped[sid]) grouped[sid] = { count: 0, sold: 0, revenue: 0, cost: 0 };
    grouped[sid].count++;
    grouped[sid].cost += Number(item.acquired_cost ?? 0);
    if (item.status === 'sold' && item.sold_price) {
      grouped[sid].sold++;
      grouped[sid].revenue += Number(item.sold_price);
    }
  });

  const specialistNames: Record<string, string> = {
    coins: 'Coins',
    banknotes: 'Banknotes',
    gold: 'Gold',
    silver: 'Silver',
    jewellery_precious_metals: 'Jewellery',
    antiques: 'Antiques',
    curiosities_collectibles: 'Collectibles',
    pokemon_trading_cards: 'Pokémon Cards',
    stamps: 'Stamps',
    vinyl_records: 'Vinyl',
    books: 'Books',
    clothing: 'Clothing',
    trainers_sneakers: 'Trainers',
    retro_games: 'Retro Games',
    retro_consoles: 'Consoles',
  };

  return Object.entries(grouped).map(([specialistId, data]) => ({
    specialistId,
    name: specialistNames[specialistId] ?? specialistId,
    itemCount: data.count,
    soldCount: data.sold,
    totalRevenue: data.revenue,
    averageMargin: data.revenue > 0 ? (data.revenue - data.cost) / data.revenue : 0,
    predictionAccuracy: 0, // Would come from sales.prediction_accuracy
  }));
}

// ── Dashboard extras ────────────────────────────────────────────────────────

export interface TopItem {
  id: string;
  canonicalTitle: string;
  specialistId: string;
  valuationLow: number;
  valuationMid: number;
  valuationHigh: number;
  identificationConfidence: number;
  status: string;
}

export interface AcquisitionLeaderEntry {
  id: string;
  title: string;
  roi: number;
  profit: number;
  status: string;
}

export interface WeekDay {
  label: string;
  value: number;
}

export async function getTopItems(tenantId: string, limit = 5): Promise<TopItem[]> {
  const supabase = getSupabaseClient();
  const { data } = await supabase
    .from('items')
    .select('id, canonical_title, specialist_id, valuation_low, valuation_mid, valuation_high, identification_confidence, status')
    .eq('tenant_id', tenantId)
    .neq('status', 'sold')
    .order('valuation_mid', { ascending: false })
    .limit(limit);

  return (data ?? []).map((row) => ({
    id: row.id,
    canonicalTitle: row.canonical_title,
    specialistId: row.specialist_id,
    valuationLow: Number(row.valuation_low ?? 0),
    valuationMid: Number(row.valuation_mid ?? 0),
    valuationHigh: Number(row.valuation_high ?? 0),
    identificationConfidence: Number(row.identification_confidence ?? 0),
    status: row.status,
  }));
}

export async function getAcquisitionLeaderboard(tenantId: string): Promise<AcquisitionLeaderEntry[]> {
  const supabase = getSupabaseClient();
  const { data } = await supabase
    .from('acquisitions')
    .select('id, title, actual_roi, actual_profit, expected_roi, expected_profit, status')
    .eq('tenant_id', tenantId)
    .order('actual_roi', { ascending: false })
    .limit(5);

  return (data ?? []).map((row) => {
    const roi = Number(row.actual_roi ?? 0) > 0
      ? Number(row.actual_roi)
      : Number(row.expected_roi ?? 0);
    const profit = Number(row.actual_profit ?? 0) !== 0
      ? Number(row.actual_profit)
      : Number(row.expected_profit ?? 0);
    return {
      id: row.id,
      title: row.title,
      roi,
      profit,
      status: row.status ?? 'pending',
    };
  });
}

export async function getWeeklyRevenue(tenantId: string): Promise<WeekDay[]> {
  const supabase = getSupabaseClient();
  const days: Array<WeekDay & { _start: string; _end: string }> = [];
  const now = new Date();

  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString();
    const dayEnd = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).toISOString();
    const label = i === 0 ? 'Today' : d.toLocaleDateString('en-GB', { weekday: 'short' });
    days.push({ label, value: 0, _start: dayStart, _end: dayEnd });
  }

  const { data: sales } = await supabase
    .from('sales')
    .select('sale_price, sold_at')
    .eq('tenant_id', tenantId)
    .gte('sold_at', days[0]._start)
    .lte('sold_at', days[days.length - 1]._end);

  (sales ?? []).forEach((sale) => {
    const saleDate = new Date(sale.sold_at);
    const dayIdx = days.findIndex((d) => {
      const start = new Date((d as any)['_start']);
      const end = new Date((d as any)['_end']);
      return saleDate >= start && saleDate < end;
    });
    if (dayIdx >= 0) {
      days[dayIdx].value += Number(sale.sale_price ?? 0);
    }
  });

  return days.map(({ label, value }) => ({ label, value }));
}

export async function getActiveListingsCount(tenantId: string): Promise<number> {
  const supabase = getSupabaseClient();
  const { count } = await supabase
    .from('listings')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('status', 'active');
  return count ?? 0;
}

// Real prediction performance derived from actual resolved predictions.
// Returns an empty array when there is insufficient data — never returns fabricated numbers.
export async function getRealPredictionPerformance(
  tenantId: string
): Promise<PredictionPerformance[]> {
  const supabase = getSupabaseClient();
  const { data } = await supabase
    .from('predictions')
    .select('prediction_type, accuracy_score, predicted_value, actual_value, created_at')
    .eq('tenant_id', tenantId)
    .eq('resolved', true)
    .not('accuracy_score', 'is', null)
    .order('created_at', { ascending: false })
    .limit(500);

  if (!data || data.length < 3) return []; // insufficient data

  // Group by month
  const byMonth: Record<string, {
    accuracies: number[];
    valuation: number[];
    saleProb: number[];
    timeToSale: number[];
    fee: number[];
  }> = {};

  data.forEach(row => {
    const d = new Date(row.created_at);
    const key = d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    if (!byMonth[key]) byMonth[key] = { accuracies: [], valuation: [], saleProb: [], timeToSale: [], fee: [] };
    const acc = Number(row.accuracy_score ?? 0);
    byMonth[key].accuracies.push(acc);
    if (row.prediction_type === 'sale_price' || row.prediction_type === 'roi') byMonth[key].valuation.push(acc);
    if (row.prediction_type === 'demand_30d') byMonth[key].saleProb.push(acc);
    if (row.prediction_type === 'time_to_sale') byMonth[key].timeToSale.push(acc);
  });

  const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;

  return Object.entries(byMonth)
    .slice(0, 6)
    .map(([period, d]) => ({
      period,
      overallAccuracy: avg(d.accuracies),
      valuationAccuracy: avg(d.valuation),
      saleProbAccuracy: avg(d.saleProb),
      timeToSaleAccuracy: avg(d.timeToSale),
      feeAccuracy: 0, // requires separate fee prediction tracking
      sampleSize: d.accuracies.length,
    }))
    .filter(p => p.sampleSize >= 3); // only return periods with meaningful data
}
