// SWISH Collection Decomposition Service
// Core economic engine: BUY BIG → UNDERSTAND EVERYTHING → BREAK IT DOWN → SELL SMART
// Analyses bulk acquisitions, detects prize items, calculates decomposition uplift,
// recommends optimal exit strategies maximising profit per labour hour.

import { getSupabaseClient } from '@/template';
import { FunctionsHttpError } from '@supabase/supabase-js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ExitStrategy {
  strategy: string;
  itemCount: number;
  expectedRevenue: number;
  expectedLabourHours: number;
  profitPerHour: number;
  rationale: string;
}

export interface SpecialistRoute {
  count: number;
  estimatedValue: number;
  strategy: 'individual' | 'bundle' | 'lot' | 'scrap' | 'hold';
  notes: string;
}

export interface DecompositionResult {
  id: string;
  tenantId: string;
  acquisitionId?: string;
  // Strategy
  suggestedStrategy: string;
  recommendedApproach: 'individual' | 'bulk' | 'mixed' | 'auction' | 'hold';
  // Value analysis
  wholeBundleValue: number;
  decomposedValue: number;
  decompositionUplift: number;
  upliftPct: number;
  // Prize items
  prizeItemCount: number;
  prizeItemsValue: number;
  prizeCoveragePct: number;
  // Labour economics
  individualLabourHours: number;
  bulkLabourHours: number;
  recommendedLabourHours: number;
  individualProfitPerHour: number;
  bulkProfitPerHour: number;
  // Financials
  expectedGrossRevenue: number;
  expectedNetRevenue: number;
  expectedProfit: number;
  expectedROI: number;
  profitPerLabourHour: number;
  // Breakdown
  itemBreakdown: Record<string, number>;
  specialistRoutes: Record<string, SpecialistRoute>;
  exitStrategies: ExitStrategy[];
  // Analysis
  misBundlingDetected: boolean;
  collectionPatterns: string[];
  warnings: string[];
  confidence: string;
  createdAt: string;
}

function mapDecomposition(row: any): DecompositionResult {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    acquisitionId: row.acquisition_id ?? undefined,
    suggestedStrategy: row.suggested_strategy ?? '',
    recommendedApproach: (row.recommended_approach ?? 'mixed') as DecompositionResult['recommendedApproach'],
    wholeBundleValue: Number(row.whole_bundle_value ?? 0),
    decomposedValue: Number(row.decomposed_value ?? 0),
    decompositionUplift: Number(row.decomposition_uplift ?? 0),
    upliftPct: Number(row.uplift_pct ?? 0),
    prizeItemCount: Number(row.prize_item_count ?? 0),
    prizeItemsValue: Number(row.prize_items_value ?? 0),
    prizeCoveragePct: Number(row.prize_coverage_pct ?? 0),
    individualLabourHours: Number(row.individual_labour_hours ?? 0),
    bulkLabourHours: Number(row.bulk_labour_hours ?? 0),
    recommendedLabourHours: Number(row.recommended_labour_hours ?? 0),
    individualProfitPerHour: Number(row.individual_profit_per_hour ?? 0),
    bulkProfitPerHour: Number(row.bulk_profit_per_hour ?? 0),
    expectedGrossRevenue: Number(row.expected_gross_revenue ?? 0),
    expectedNetRevenue: Number(row.expected_net_revenue ?? 0),
    expectedProfit: Number(row.expected_profit ?? 0),
    expectedROI: Number(row.expected_roi ?? 0),
    profitPerLabourHour: Number(row.profit_per_labour_hour ?? 0),
    itemBreakdown: row.item_breakdown ?? {},
    specialistRoutes: row.specialist_routes ?? {},
    exitStrategies: row.exit_strategies ?? [],
    misBundlingDetected: row.mis_bundling_detected ?? false,
    collectionPatterns: row.collection_patterns ?? [],
    warnings: row.warnings ?? [],
    confidence: row.confidence ?? 'medium',
    createdAt: row.created_at,
  };
}

// ── Run AI Decomposition ──────────────────────────────────────────────────────

export interface DecompositionInput {
  acquisitionTitle: string;
  acquisitionDescription?: string;
  acquisitionSource?: string;
  purchasePrice: number;
  itemCount?: number;
  existingItems?: Array<{
    title: string;
    specialist?: string;
    valuationMid?: number;
    condition?: string;
  }>;
  descriptionText?: string;
  categories?: string[];
  tenantContext?: {
    currency?: string;
    riskTolerance?: string;
    minROI?: number;
  };
}

export async function runDecomposition(
  tenantId: string,
  acquisitionId: string,
  input: DecompositionInput
): Promise<{ result: DecompositionResult | null; error: string | null }> {
  const supabase = getSupabaseClient();

  // Call the AI edge function
  const { data, error } = await supabase.functions.invoke('swish-decompose', {
    body: {
      acquisition_title: input.acquisitionTitle,
      acquisition_description: input.acquisitionDescription,
      acquisition_source: input.acquisitionSource,
      purchase_price: input.purchasePrice,
      item_count: input.itemCount,
      existing_items: input.existingItems ?? [],
      description_text: input.descriptionText,
      categories: input.categories ?? [],
      tenant_context: input.tenantContext,
    },
  });

  if (error) {
    let message = error.message;
    if (error instanceof FunctionsHttpError) {
      try {
        const statusCode = error.context?.status ?? 500;
        const text = await error.context?.text();
        message = `[${statusCode}] ${text || error.message}`;
      } catch {
        message = error.message;
      }
    }
    return { result: null, error: message };
  }

  const decomp = data?.decomposition;
  if (!decomp) return { result: null, error: 'No decomposition returned from AI' };

  // Save to database (upsert — one result per acquisition)
  const { data: saved, error: saveError } = await supabase
    .from('decomposition_results')
    .upsert({
      tenant_id: tenantId,
      acquisition_id: acquisitionId,
      suggested_strategy: decomp.suggestedStrategy,
      recommended_approach: decomp.recommendedApproach,
      whole_bundle_value: decomp.wholeBundleValue,
      decomposed_value: decomp.decomposedValue,
      decomposition_uplift: decomp.decompositionUplift,
      uplift_pct: decomp.upliftPct,
      expected_gross_revenue: decomp.expectedGrossRevenue,
      expected_net_revenue: decomp.expectedNetRevenue,
      expected_profit: decomp.expectedProfit,
      expected_roi: decomp.expectedROI,
      individual_labour_hours: decomp.individualLabourHours,
      bulk_labour_hours: decomp.bulkLabourHours,
      recommended_labour_hours: decomp.recommendedLabourHours,
      individual_profit_per_hour: decomp.individualProfitPerHour,
      bulk_profit_per_hour: decomp.bulkProfitPerHour,
      profit_per_labour_hour: decomp.profitPerLabourHour,
      prize_item_count: decomp.prizeItemCount,
      prize_items_value: decomp.prizeItemsValue,
      prize_coverage_pct: decomp.prizeCoveragePct,
      mis_bundling_detected: decomp.misBundlingDetected,
      collection_patterns: decomp.collectionPatterns,
      item_breakdown: decomp.itemBreakdown,
      specialist_routes: decomp.specialistRoutes,
      exit_strategies: decomp.exitStrategies,
      warnings: decomp.warnings,
      confidence: decomp.confidence,
    }, { onConflict: 'acquisition_id' })
    .select()
    .single();

  if (saveError) {
    console.error('Failed to save decomposition:', saveError.message);
    // Return the AI result even if DB save failed
    return {
      result: {
        id: 'temp',
        tenantId,
        acquisitionId,
        ...decomp,
        createdAt: new Date().toISOString(),
      } as DecompositionResult,
      error: null,
    };
  }

  return { result: mapDecomposition(saved), error: null };
}

// ── Get existing decomposition ────────────────────────────────────────────────

export async function getDecomposition(
  acquisitionId: string
): Promise<{ result: DecompositionResult | null; error: string | null }> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('decomposition_results')
    .select('*')
    .eq('acquisition_id', acquisitionId)
    .maybeSingle();

  if (error) return { result: null, error: error.message };
  if (!data) return { result: null, error: null };
  return { result: mapDecomposition(data), error: null };
}

// ── Compute decomposition economics without AI ────────────────────────────────
// Uses already-identified items to calculate basic decomposition metrics

export function computeBasicDecomposition(
  items: Array<{ valuationMid: number; status: string; specialistId: string; dispositionDecision: string }>,
  acquisitionCost: number
): {
  totalIndividualValue: number;
  prizeItems: typeof items;
  prizeItemsValue: number;
  prizeCoveragePct: number;
  misBundlingLikely: boolean;
  specialistBreakdown: Record<string, { count: number; value: number }>;
  recommendedApproach: 'individual' | 'bulk' | 'mixed';
} {
  const totalIndividualValue = items.reduce((s, i) => s + i.valuationMid, 0);

  // Prize items = items where individual value >= acquisition cost
  const prizeItems = items.filter(i => i.valuationMid >= acquisitionCost * 0.8);
  const prizeItemsValue = prizeItems.reduce((s, i) => s + i.valuationMid, 0);
  const prizeCoveragePct = acquisitionCost > 0 ? prizeItemsValue / acquisitionCost : 0;

  // Mis-bundling: total individual value is significantly more than likely bundle price
  const estimatedBundleValue = totalIndividualValue * 0.5; // bundles typically sell at ~50% of sum
  const misBundlingLikely = totalIndividualValue > estimatedBundleValue * 1.5;

  // Specialist breakdown
  const specialistBreakdown: Record<string, { count: number; value: number }> = {};
  items.forEach(item => {
    if (!specialistBreakdown[item.specialistId]) {
      specialistBreakdown[item.specialistId] = { count: 0, value: 0 };
    }
    specialistBreakdown[item.specialistId].count++;
    specialistBreakdown[item.specialistId].value += item.valuationMid;
  });

  // Recommend approach based on value concentration
  const highValueItems = items.filter(i => i.valuationMid > 50);
  const highValueRatio = items.length > 0 ? highValueItems.length / items.length : 0;
  const recommendedApproach: 'individual' | 'bulk' | 'mixed' =
    highValueRatio > 0.5 ? 'individual' :
    highValueRatio > 0.2 ? 'mixed' : 'bulk';

  return {
    totalIndividualValue,
    prizeItems,
    prizeItemsValue,
    prizeCoveragePct,
    misBundlingLikely,
    specialistBreakdown,
    recommendedApproach,
  };
}
