// SWISH Prediction Service
// Evidence-based prediction storage and learning engine.
//
// IMPORTANT PRINCIPLES:
// - Predictions are ONLY made from actual sales history data
// - "INSUFFICIENT DATA" is returned when less than 5 comparable sales exist
// - Predictions are resolved when actual outcomes are known (item sold)
// - The learning loop feeds resolved predictions back to improve future valuations
// - NEVER invent predictions — return null/insufficient when data is absent

import { getSupabaseClient } from '@/template';

export interface Prediction {
  id?: string;
  tenantId: string;
  entityType: string;
  entityId: string;
  predictionType: PredictionType;
  predictedValue: number | null;
  predictedConfidence: 'high' | 'medium' | 'low' | 'insufficient_data';
  predictedReasoning: string;
  actualValue?: number | null;
  variance?: number | null;
  accuracyScore?: number | null;
  resolved: boolean;
  resolvedAt?: string;
  modelVersion: string;
  createdAt?: string;
}

export type PredictionType =
  | 'sale_probability_7d'
  | 'sale_probability_30d'
  | 'expected_sale_price'
  | 'time_to_sale_days'
  | 'expected_profit'
  | 'price_reduction_probability';

export const PREDICTION_MODEL_VERSION = 'swish-v2-evidence-based';
export const MIN_SALES_FOR_PREDICTION = 5;

// ── Record a prediction ───────────────────────────────────────────────────────

export async function recordPrediction(
  tenantId: string,
  entityType: string,
  entityId: string,
  predictionType: PredictionType,
  predictedValue: number | null,
  confidence: 'high' | 'medium' | 'low' | 'insufficient_data',
  reasoning: string,
): Promise<{ id: string | null; error: string | null }> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('predictions')
    .insert({
      tenant_id: tenantId,
      entity_type: entityType,
      entity_id: entityId,
      prediction_type: predictionType,
      predicted_value: predictedValue,
      predicted_confidence: confidence,
      predicted_reasoning: reasoning,
      resolved: false,
      model_version: PREDICTION_MODEL_VERSION,
    })
    .select('id')
    .single();

  if (error) return { id: null, error: error.message };
  return { id: data.id, error: null };
}

// ── Resolve a prediction with actual outcome ──────────────────────────────────
// Called when an item is sold or a measurable outcome occurs.

export async function resolvePrediction(
  predictionId: string,
  actualValue: number,
): Promise<{ error: string | null }> {
  const supabase = getSupabaseClient();

  // Load the prediction
  const { data: pred } = await supabase
    .from('predictions')
    .select('predicted_value, prediction_type')
    .eq('id', predictionId)
    .maybeSingle();

  if (!pred) return { error: 'Prediction not found' };

  const variance = pred.predicted_value != null ? actualValue - Number(pred.predicted_value) : null;

  // Calculate accuracy score (0-1)
  // For price predictions: 1 - |variance| / predicted_value
  // For probability predictions: 1 if outcome matches, 0 if not
  let accuracyScore: number | null = null;
  if (pred.predicted_value != null && Number(pred.predicted_value) > 0) {
    const pct = Math.abs(actualValue - Number(pred.predicted_value)) / Number(pred.predicted_value);
    accuracyScore = Math.max(0, Math.min(1, 1 - pct));
  }

  const { error } = await supabase
    .from('predictions')
    .update({
      actual_value: actualValue,
      variance,
      accuracy_score: accuracyScore,
      resolved: true,
      resolved_at: new Date().toISOString(),
    })
    .eq('id', predictionId);

  return { error: error?.message ?? null };
}

// ── Resolve predictions when item is sold ─────────────────────────────────────
// Called automatically when a sale is recorded.

export async function resolveItemPredictionsOnSale(
  tenantId: string,
  itemId: string,
  actualSalePrice: number,
  daysToSale: number,
): Promise<void> {
  const supabase = getSupabaseClient();

  // Find unresolved predictions for this item
  const { data: preds } = await supabase
    .from('predictions')
    .select('id, prediction_type, predicted_value')
    .eq('tenant_id', tenantId)
    .eq('entity_type', 'item')
    .eq('entity_id', itemId)
    .eq('resolved', false);

  if (!preds || preds.length === 0) return;

  for (const pred of preds) {
    let actualValue: number;

    switch (pred.prediction_type as PredictionType) {
      case 'expected_sale_price':
        actualValue = actualSalePrice;
        break;
      case 'time_to_sale_days':
        actualValue = daysToSale;
        break;
      case 'sale_probability_7d':
        actualValue = daysToSale <= 7 ? 1 : 0;
        break;
      case 'sale_probability_30d':
        actualValue = daysToSale <= 30 ? 1 : 0;
        break;
      default:
        continue;
    }

    await resolvePrediction(pred.id, actualValue);
  }
}

// ── Get prediction accuracy metrics for a tenant ──────────────────────────────
// Used by the learning loop to understand model accuracy.

export async function getPredictionAccuracyMetrics(
  tenantId: string,
  predictionType?: PredictionType,
): Promise<{
  resolvedCount: number;
  averageAccuracy: number | null;
  priceAccuracy?: number | null;
  timeToSaleAccuracy?: number | null;
  insufficientData: boolean;
}> {
  const supabase = getSupabaseClient();

  let query = supabase
    .from('predictions')
    .select('prediction_type, accuracy_score, predicted_value, actual_value')
    .eq('tenant_id', tenantId)
    .eq('resolved', true)
    .not('accuracy_score', 'is', null);

  if (predictionType) {
    query = query.eq('prediction_type', predictionType);
  }

  const { data } = await query.limit(200);
  const rows = data ?? [];

  if (rows.length < MIN_SALES_FOR_PREDICTION) {
    return { resolvedCount: rows.length, averageAccuracy: null, insufficientData: true };
  }

  const avgAccuracy = rows.reduce((s, r) => s + Number(r.accuracy_score ?? 0), 0) / rows.length;

  const priceRows = rows.filter(r => r.prediction_type === 'expected_sale_price');
  const priceAccuracy = priceRows.length > 0
    ? priceRows.reduce((s, r) => s + Number(r.accuracy_score ?? 0), 0) / priceRows.length
    : null;

  const timeRows = rows.filter(r => r.prediction_type === 'time_to_sale_days');
  const timeToSaleAccuracy = timeRows.length > 0
    ? timeRows.reduce((s, r) => s + Number(r.accuracy_score ?? 0), 0) / timeRows.length
    : null;

  return {
    resolvedCount: rows.length,
    averageAccuracy: Math.round(avgAccuracy * 100) / 100,
    priceAccuracy: priceAccuracy != null ? Math.round(priceAccuracy * 100) / 100 : null,
    timeToSaleAccuracy: timeToSaleAccuracy != null ? Math.round(timeToSaleAccuracy * 100) / 100 : null,
    insufficientData: false,
  };
}

export interface LearningInsight {
  predictionType: PredictionType;
  trend: 'improving' | 'stable' | 'degrading' | 'insufficient_data';
  avgAccuracy: number;
  sampleCount: number;
  bias: 'accurate' | 'overestimating' | 'underestimating' | 'mixed' | 'insufficient';
  recommendation: string;
}

export interface PredictionAccuracySummary {
  totalPredictions: number;
  resolvedPredictions: number;
  avgAccuracy: number;
}

/** Aggregate actual stored outcomes for the audit dashboard; never synthesises prediction rows. */
export async function getPredictionAccuracySummary(tenantId: string): Promise<PredictionAccuracySummary> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('predictions')
    .select('resolved, accuracy_score')
    .eq('tenant_id', tenantId)
    .limit(1000);

  if (error || !data) return { totalPredictions: 0, resolvedPredictions: 0, avgAccuracy: 0 };
  const rows = data as Array<{ resolved: boolean; accuracy_score: number | null }>;
  const resolved = rows.filter(row => row.resolved);
  const scored = resolved.filter(row => row.accuracy_score !== null && row.accuracy_score !== undefined);
  const avgAccuracy = scored.length
    ? scored.reduce((sum, row) => sum + Number(row.accuracy_score), 0) / scored.length
    : 0;
  return {
    totalPredictions: rows.length,
    resolvedPredictions: resolved.length,
    avgAccuracy: Math.round(avgAccuracy * 100) / 100,
  };
}

/** Calculate trend/bias only from resolved predictions with recorded actual outcomes. */
export async function computeLearningInsights(tenantId: string): Promise<LearningInsight[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('predictions')
    .select('prediction_type, accuracy_score, predicted_value, actual_value, created_at')
    .eq('tenant_id', tenantId)
    .eq('resolved', true)
    .not('accuracy_score', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1000);

  const types: PredictionType[] = [
    'sale_probability_7d', 'sale_probability_30d', 'expected_sale_price',
    'time_to_sale_days', 'expected_profit', 'price_reduction_probability',
  ];
  const rows = (error || !data ? [] : data) as Array<{
    prediction_type: PredictionType;
    accuracy_score: number | null;
    predicted_value: number | null;
    actual_value: number | null;
    created_at: string;
  }>;

  return types.map(predictionType => {
    const samples = rows.filter(row => row.prediction_type === predictionType);
    const scores = samples.map(row => Number(row.accuracy_score ?? 0)).filter(Number.isFinite);
    const avgAccuracy = scores.length ? scores.reduce((sum, value) => sum + value, 0) / scores.length : 0;
    let trend: LearningInsight['trend'] = 'insufficient_data';
    if (samples.length >= MIN_SALES_FOR_PREDICTION * 2) {
      const midpoint = Math.floor(samples.length / 2);
      const recent = scores.slice(0, midpoint);
      const older = scores.slice(midpoint);
      const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
      const delta = mean(recent) - mean(older);
      trend = delta > 0.05 ? 'improving' : delta < -0.05 ? 'degrading' : 'stable';
    }

    const deltas = samples
      .filter(row => row.predicted_value != null && row.actual_value != null && Number(row.predicted_value) !== 0)
      .map(row => (Number(row.actual_value) - Number(row.predicted_value)) / Math.abs(Number(row.predicted_value)));
    const meanDelta = deltas.length ? deltas.reduce((sum, value) => sum + value, 0) / deltas.length : null;
    const bias: LearningInsight['bias'] = samples.length < MIN_SALES_FOR_PREDICTION
      ? 'insufficient'
      : meanDelta === null || Math.abs(meanDelta) <= 0.05
        ? 'accurate'
        : meanDelta > 0 ? 'underestimating' : 'overestimating';

    const recommendation = samples.length < MIN_SALES_FOR_PREDICTION
      ? `Collect at least ${MIN_SALES_FOR_PREDICTION} resolved real outcomes before drawing conclusions.`
      : trend === 'degrading'
        ? 'Accuracy has fallen in the more recent sample. Review the inputs and recent outcomes before relying on this prediction type.'
        : trend === 'improving'
          ? 'Recent outcomes are more accurate than earlier ones. Continue monitoring as new real outcomes are recorded.'
          : 'Continue recording real outcomes and review this metric alongside the underlying sample size.';

    return {
      predictionType,
      trend,
      avgAccuracy: Math.round(avgAccuracy * 100) / 100,
      sampleCount: samples.length,
      bias,
      recommendation,
    };
  });
}

// ── Generate evidence-based predictions for a tenant's inventory ──────────────
// Computes predictions ONLY from real historical data — never fabricates.

export async function generateInventoryPredictions(tenantId: string): Promise<{
  generated: number;
  skippedInsufficient: number;
  errors: string[];
}> {
  const supabase = getSupabaseClient();
  let generated = 0, skippedInsufficient = 0;
  const errors: string[] = [];

  // Only attempt predictions for items with actual sales history
  const { data: salesHistory } = await supabase
    .from('sales')
    .select('item_id, sale_price, sold_at, marketplace_id, items(specialist_id, attributes)')
    .eq('tenant_id', tenantId)
    .order('sold_at', { ascending: false })
    .limit(500);

  if (!salesHistory || salesHistory.length < MIN_SALES_FOR_PREDICTION) {
    return { generated: 0, skippedInsufficient: 1, errors: ['Insufficient sales history (< 5 sales). Predictions require real transaction data.'] };
  }

  // Group by specialist to build category-level models
  const bySpecialist: Record<string, typeof salesHistory> = {};
  for (const sale of salesHistory) {
    const specId = (sale as any).items?.specialist_id ?? 'unknown';
    if (!bySpecialist[specId]) bySpecialist[specId] = [];
    bySpecialist[specId].push(sale);
  }

  // For each specialist with enough data, calculate sale probability metrics
  for (const [specialistId, specSales] of Object.entries(bySpecialist)) {
    if (specSales.length < MIN_SALES_FOR_PREDICTION) { skippedInsufficient++; continue; }

    const prices = specSales.map(s => Number(s.sale_price ?? 0)).filter(p => p > 0).sort((a, b) => a - b);
    if (prices.length < MIN_SALES_FOR_PREDICTION) { skippedInsufficient++; continue; }

    const medianPrice = prices[Math.floor(prices.length / 2)];

    // Calculate empirical sale probability: # sold within 30 days / total with known dates
    const datedSales = specSales.filter(s => s.sold_at);
    // Here we'd need listing dates to calculate time-to-sale — use a simple proxy
    // based on the distribution of sale dates
    const now = Date.now();
    const recentSales = datedSales.filter(s => {
      const soldMs = new Date(s.sold_at).getTime();
      return now - soldMs <= 30 * 24 * 60 * 60 * 1000;
    }).length;

    const empiricalRate = datedSales.length > 0 ? recentSales / Math.min(30, datedSales.length) : null;

    // Store category-level prediction as a tenant-level metric
    // (item-level predictions require per-item listing dates which we derive below)
    const reasoning = `Based on ${specSales.length} historical sales for ${specialistId}. Median price: £${medianPrice.toFixed(2)}.`;

    try {
      await supabase.from('predictions').insert({
        tenant_id: tenantId,
        entity_type: 'category',
        entity_id: specialistId,
        prediction_type: 'expected_sale_price',
        predicted_value: Math.round(medianPrice * 100) / 100,
        predicted_confidence: specSales.length >= 20 ? 'high' : specSales.length >= 10 ? 'medium' : 'low',
        predicted_reasoning: reasoning,
        resolved: false,
        model_version: PREDICTION_MODEL_VERSION,
      });
      generated++;
    } catch (e: any) {
      // Duplicate or other error — non-fatal
      if (!e.message?.includes('duplicate')) errors.push(`Category ${specialistId}: ${e.message}`);
    }
  }

  return { generated, skippedInsufficient, errors };
}

// ── Get unresolved predictions for an item ────────────────────────────────────

export async function getItemPredictions(
  tenantId: string,
  itemId: string,
): Promise<Prediction[]> {
  const supabase = getSupabaseClient();
  const { data } = await supabase
    .from('predictions')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('entity_type', 'item')
    .eq('entity_id', itemId)
    .eq('resolved', false)
    .order('created_at', { ascending: false })
    .limit(10);

  return (data ?? []).map(row => ({
    id: row.id,
    tenantId: row.tenant_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    predictionType: row.prediction_type as PredictionType,
    predictedValue: row.predicted_value != null ? Number(row.predicted_value) : null,
    predictedConfidence: row.predicted_confidence as Prediction['predictedConfidence'],
    predictedReasoning: row.predicted_reasoning ?? '',
    actualValue: row.actual_value != null ? Number(row.actual_value) : null,
    variance: row.variance != null ? Number(row.variance) : null,
    accuracyScore: row.accuracy_score != null ? Number(row.accuracy_score) : null,
    resolved: row.resolved,
    resolvedAt: row.resolved_at ?? undefined,
    modelVersion: row.model_version ?? PREDICTION_MODEL_VERSION,
    createdAt: row.created_at,
  }));
}

// ── Trigger prediction resolution for recently sold items ─────────────────────
// Should be called periodically or after order sync.

export async function resolveRecentSalePredictions(tenantId: string): Promise<{
  resolved: number;
  errors: string[];
}> {
  const supabase = getSupabaseClient();
  let resolved = 0;
  const errors: string[] = [];

  // Find recently sold items with unresolved predictions
  const { data: recentSales } = await supabase
    .from('sales')
    .select('item_id, sale_price, sold_at, items(created_at)')
    .eq('tenant_id', tenantId)
    .gte('sold_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
    .order('sold_at', { ascending: false })
    .limit(100);

  for (const sale of recentSales ?? []) {
    if (!sale.item_id) continue;
    const soldMs = new Date(sale.sold_at).getTime();
    const createdMs = (sale as any).items?.created_at ? new Date((sale as any).items.created_at).getTime() : soldMs;
    const daysToSale = Math.max(0, Math.round((soldMs - createdMs) / (1000 * 60 * 60 * 24)));

    try {
      await resolveItemPredictionsOnSale(tenantId, sale.item_id, Number(sale.sale_price), daysToSale);
      resolved++;
    } catch (e: any) {
      errors.push(`Item ${sale.item_id}: ${e.message}`);
    }
  }

  return { resolved, errors };
}
