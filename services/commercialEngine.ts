// SWISH Commercial Intelligence Engine
//
// Unified intelligence layer that orchestrates:
//  - Commercial scoring (per item / per opportunity)
//  - Next-action recommendations
//  - Capital state calculations
//  - Opportunity ranking
//  - Learning signal recording
//
// This module is the single entry point for all commercial intelligence.
// Feature gates ensure private capabilities are not exposed to regular subscribers.

import { getSupabaseClient } from '@/template';
import { calculateProfit, evaluateAcquisition, PROFIT_ENGINE_VERSION, ProfitResult } from './profitEngine';

// ── Feature Entitlements ──────────────────────────────────────────────────────

export type SubscriptionTier = 'starter' | 'basic' | 'pro' | 'operator';

const TIER_WEIGHTS: Record<SubscriptionTier, number> = {
  starter:  0,
  basic:    1,
  pro:      2,
  operator: 3,
};

function tierAtLeast(userTier: SubscriptionTier, required: SubscriptionTier): boolean {
  return (TIER_WEIGHTS[userTier] ?? 0) >= (TIER_WEIGHTS[required] ?? 0);
}

export interface FeatureEntitlements {
  // Basic
  inventoryManagement: boolean;
  ebayListing: boolean;
  basicAnalytics: boolean;
  // Pro
  commercialScoring: boolean;
  opportunityAnalysis: boolean;
  repricingEngine: boolean;
  collectionDecomposition: boolean;
  profitEngine: boolean;
  nextActionEngine: boolean;
  // Operator (private black box)
  privateOpportunityIntelligence: boolean;
  privateAcquisitionEngine: boolean;
  privateLearningLoop: boolean;
  privateCapitalAllocation: boolean;
  advancedPredictionModels: boolean;
}

export function getEntitlements(tier: SubscriptionTier): FeatureEntitlements {
  const atLeast = (t: SubscriptionTier) => tierAtLeast(tier, t);
  return {
    inventoryManagement:            true,
    ebayListing:                    true,
    basicAnalytics:                 true,
    commercialScoring:              atLeast('pro'),
    opportunityAnalysis:            atLeast('pro'),
    repricingEngine:                atLeast('pro'),
    collectionDecomposition:        atLeast('pro'),
    profitEngine:                   atLeast('pro'),
    nextActionEngine:               atLeast('pro'),
    privateOpportunityIntelligence: atLeast('operator'),
    privateAcquisitionEngine:       atLeast('operator'),
    privateLearningLoop:            atLeast('operator'),
    privateCapitalAllocation:       atLeast('operator'),
    advancedPredictionModels:       atLeast('operator'),
  };
}

export async function getTenantTier(tenantId: string): Promise<SubscriptionTier> {
  const supabase = getSupabaseClient();
  const { data } = await supabase
    .from('tenants')
    .select('subscription_tier')
    .eq('id', tenantId)
    .maybeSingle();
  return (data?.subscription_tier as SubscriptionTier) ?? 'starter';
}

// ── Commercial Score ──────────────────────────────────────────────────────────

export interface CommercialScore {
  score: number;          // 0-100
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  label: string;
  colour: string;
  reasoning: string;
  components: {
    label: string;
    value: string;
    contribution: number; // +/- points
    positive: boolean;
  }[];
  confidence: string;
  modelVersion: string;
  calculatedAt: string;
}

export function computeCommercialScore(params: {
  acquisitionCost: number;
  estimatedSalePrice: number;
  daysListed?: number;
  watchers?: number;
  views?: number;
  labourHours?: number;
  specialistId?: string;
  condition?: string;
  hasImages?: boolean;
  imageCount?: number;
  hasDescription?: boolean;
  hasItemSpecifics?: boolean;
  capitalLockUpDays?: number;
  confidence?: string;
}): CommercialScore {
  const {
    acquisitionCost,
    estimatedSalePrice,
    daysListed,
    watchers = 0,
    views = 0,
    labourHours,
    specialistId,
    condition,
    hasImages = false,
    imageCount = 0,
    hasDescription = false,
    hasItemSpecifics = false,
    capitalLockUpDays,
    confidence = 'medium',
  } = params;

  const components: CommercialScore['components'] = [];
  let score = 50; // start at neutral

  // ── Profit / ROI contribution ──────────────────────────────────────────────
  if (acquisitionCost > 0 && estimatedSalePrice > 0) {
    const profit = calculateProfit({
      salePrice: estimatedSalePrice,
      acquisitionCost,
      shippingCost: 3.50,
      packagingCost: 0.80,
      specialistId,
      isEstimate: true,
    });

    const roiPct = profit.roi * 100;
    let roiContrib = 0;
    if (roiPct >= 200)      roiContrib = 30;
    else if (roiPct >= 100) roiContrib = 20;
    else if (roiPct >= 50)  roiContrib = 10;
    else if (roiPct >= 30)  roiContrib = 5;
    else if (roiPct >= 0)   roiContrib = 0;
    else                    roiContrib = -20;

    score += roiContrib;
    components.push({
      label: 'Return on Investment',
      value: `${roiPct.toFixed(0)}% ROI`,
      contribution: roiContrib,
      positive: roiContrib >= 0,
    });

    // Margin
    const marginPct = profit.grossMarginPct * 100;
    let marginContrib = 0;
    if (marginPct >= 50)      marginContrib = 10;
    else if (marginPct >= 30) marginContrib = 5;
    else if (marginPct >= 10) marginContrib = 0;
    else                      marginContrib = -10;
    score += marginContrib;
    components.push({
      label: 'Gross Margin',
      value: `${marginPct.toFixed(0)}% margin`,
      contribution: marginContrib,
      positive: marginContrib >= 0,
    });

    // Profit per hour
    if (labourHours != null && labourHours > 0 && profit.profitPerHour != null) {
      const pph = profit.profitPerHour;
      let pphContrib = 0;
      if (pph >= 50)      pphContrib = 10;
      else if (pph >= 30) pphContrib = 5;
      else if (pph >= 15) pphContrib = 0;
      else                pphContrib = -5;
      score += pphContrib;
      components.push({
        label: 'Profit per Hour',
        value: `£${pph.toFixed(0)}/h`,
        contribution: pphContrib,
        positive: pphContrib >= 0,
      });
    }
  }

  // ── Demand signals ────────────────────────────────────────────────────────
  if (watchers > 10) {
    score += 8;
    components.push({ label: 'Buyer interest', value: `${watchers} watchers`, contribution: 8, positive: true });
  } else if (watchers > 3) {
    score += 4;
    components.push({ label: 'Buyer interest', value: `${watchers} watchers`, contribution: 4, positive: true });
  } else if (watchers === 0 && daysListed != null && daysListed > 30) {
    score -= 5;
    components.push({ label: 'Low demand signal', value: '0 watchers after 30d', contribution: -5, positive: false });
  }

  if (views > 100) {
    score += 5;
    components.push({ label: 'Visibility', value: `${views} views`, contribution: 5, positive: true });
  }

  // ── Listing quality ───────────────────────────────────────────────────────
  if (!hasImages || imageCount === 0) {
    score -= 15;
    components.push({ label: 'Missing images', value: 'No photos', contribution: -15, positive: false });
  } else if (imageCount >= 6) {
    score += 5;
    components.push({ label: 'Good photos', value: `${imageCount} images`, contribution: 5, positive: true });
  }

  if (!hasDescription) {
    score -= 8;
    components.push({ label: 'Missing description', value: 'No description', contribution: -8, positive: false });
  }

  if (!hasItemSpecifics) {
    score -= 5;
    components.push({ label: 'Missing item specifics', value: 'No specifics', contribution: -5, positive: false });
  }

  // ── Stale stock penalty ───────────────────────────────────────────────────
  if (daysListed != null) {
    if (daysListed > 90) {
      score -= 12;
      components.push({ label: 'Stale listing', value: `${daysListed} days listed`, contribution: -12, positive: false });
    } else if (daysListed > 60) {
      score -= 6;
      components.push({ label: 'Getting stale', value: `${daysListed} days listed`, contribution: -6, positive: false });
    }
  }

  // ── Capital velocity ──────────────────────────────────────────────────────
  if (capitalLockUpDays != null) {
    if (capitalLockUpDays <= 14) {
      score += 8;
      components.push({ label: 'Fast capital turnover', value: `~${capitalLockUpDays}d to sell`, contribution: 8, positive: true });
    } else if (capitalLockUpDays > 90) {
      score -= 5;
      components.push({ label: 'Slow capital turnover', value: `~${capitalLockUpDays}d to sell`, contribution: -5, positive: false });
    }
  }

  // ── Confidence adjustment ─────────────────────────────────────────────────
  if (confidence === 'low' || confidence === 'fallback') {
    score = Math.min(score, 65); // cap at 65 for low confidence
    components.push({ label: 'Low confidence data', value: 'Data quality impact', contribution: 0, positive: false });
  }

  // ── Final bounds ──────────────────────────────────────────────────────────
  score = Math.max(0, Math.min(100, Math.round(score)));

  const grade: CommercialScore['grade'] =
    score >= 80 ? 'A' :
    score >= 65 ? 'B' :
    score >= 50 ? 'C' :
    score >= 35 ? 'D' : 'F';

  const label =
    grade === 'A' ? 'Excellent' :
    grade === 'B' ? 'Good' :
    grade === 'C' ? 'Average' :
    grade === 'D' ? 'Weak' : 'Poor';

  const colour =
    grade === 'A' ? '#00C896' :
    grade === 'B' ? '#34C759' :
    grade === 'C' ? '#FF9500' :
    grade === 'D' ? '#FF6B35' : '#FF3B30';

  const positiveComponents = components.filter(c => c.positive);
  const negativeComponents = components.filter(c => !c.positive);

  const reasoningParts: string[] = [];
  if (positiveComponents.length > 0) {
    reasoningParts.push(positiveComponents.slice(0, 2).map(c => c.value).join(', '));
  }
  if (negativeComponents.length > 0) {
    reasoningParts.push(`Needs improvement: ${negativeComponents.slice(0, 2).map(c => c.label.toLowerCase()).join(', ')}`);
  }

  return {
    score,
    grade,
    label,
    colour,
    reasoning: reasoningParts.join('. ') || `Commercial score: ${score}/100`,
    components,
    confidence,
    modelVersion: PROFIT_ENGINE_VERSION,
    calculatedAt: new Date().toISOString(),
  };
}

// ── Next Action Engine ────────────────────────────────────────────────────────

export interface NextAction {
  id?: string;
  actionType: string;
  priority: number;         // 1-100, higher = more urgent
  title: string;
  description: string;
  why: string;
  expectedBenefit: string;
  entityType?: string;
  entityIds?: string[];
  estimatedMinutes?: number;
  confidence: string;
}

export async function computeNextActions(tenantId: string): Promise<NextAction[]> {
  const supabase = getSupabaseClient();
  const actions: NextAction[] = [];

  try {
    // ── Fetch data needed for all recommendations ──────────────────────────
    const [
      draftListingsRes,
      staleListingsRes,
      noImageItemsRes,
      awaitingDispatchRes,
      unlisted7dRes,
      activeListingsRes,
    ] = await Promise.all([
      // Draft listings not yet published
      supabase
        .from('listings')
        .select('id, title, price, items(id, canonical_title)')
        .eq('tenant_id', tenantId)
        .in('status', ['draft', 'needs_correction'])
        .limit(50),

      // Active listings not sold in 60+ days (stale)
      supabase
        .from('listings')
        .select('id, title, price, published_at, external_listing_id')
        .eq('tenant_id', tenantId)
        .eq('status', 'active')
        .lt('published_at', new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString())
        .limit(30),

      // Items with no images
      supabase
        .from('items')
        .select('id, canonical_title, status')
        .eq('tenant_id', tenantId)
        .in('status', ['new', 'identified', 'assessed', 'priced'])
        .is('media', null)
        .limit(20),

      // Orders awaiting dispatch
      supabase
        .from('orders')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .in('fulfilment_status', ['awaiting_dispatch', 'packing']),

      // Items in inventory for 7+ days that have never been listed
      supabase
        .from('items')
        .select('id, canonical_title, valuation_mid')
        .eq('tenant_id', tenantId)
        .in('status', ['identified', 'assessed', 'priced'])
        .lt('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
        .limit(20),

      // Active listings where item was updated after publishing (stale push)
      supabase
        .from('listings')
        .select('id, title, published_at, items(updated_at)')
        .eq('tenant_id', tenantId)
        .eq('status', 'active')
        .not('external_listing_id', 'is', null)
        .limit(50),
    ]);

    // ── 1. Dispatch urgency (highest priority) ─────────────────────────────
    const dispatchCount = awaitingDispatchRes.count ?? 0;
    if (dispatchCount > 0) {
      actions.push({
        actionType: 'dispatch_orders',
        priority: 95,
        title: `${dispatchCount} order${dispatchCount > 1 ? 's' : ''} need dispatching`,
        description: `${dispatchCount} sold item${dispatchCount > 1 ? 's' : ''} awaiting postage`,
        why: 'Dispatching promptly protects your eBay seller metrics and buyer satisfaction.',
        expectedBenefit: 'Maintain 5-star seller rating and avoid late dispatch defect',
        entityType: 'order',
        estimatedMinutes: dispatchCount * 8,
        confidence: 'high',
      });
    }

    // ── 2. Draft listings ready to publish ────────────────────────────────
    const draftCount = draftListingsRes.data?.length ?? 0;
    if (draftCount > 0) {
      const totalValue = draftListingsRes.data?.reduce((s, l) => s + Number(l.price ?? 0), 0) ?? 0;
      actions.push({
        actionType: 'publish_drafts',
        priority: 80,
        title: `Publish ${draftCount} draft listing${draftCount > 1 ? 's' : ''}`,
        description: `${draftCount} item${draftCount > 1 ? 's' : ''} ready for eBay — total value £${totalValue.toFixed(0)}`,
        why: 'Items in draft generate no revenue. Each day unlisted is revenue delayed.',
        expectedBenefit: `£${totalValue.toFixed(0)} in potential sales`,
        entityType: 'listing',
        entityIds: draftListingsRes.data?.map(l => l.id) ?? [],
        estimatedMinutes: Math.ceil(draftCount * 2),
        confidence: 'high',
      });
    }

    // ── 3. Items with no images ───────────────────────────────────────────
    const noImageCount = noImageItemsRes.data?.length ?? 0;
    if (noImageCount > 0) {
      actions.push({
        actionType: 'add_images',
        priority: 70,
        title: `${noImageCount} item${noImageCount > 1 ? 's' : ''} need photos`,
        description: 'Items without images can\'t be listed on eBay and score poorly',
        why: 'eBay requires at least one photo. Items without photos have 0% listing potential.',
        expectedBenefit: 'Enable listing for these items',
        entityType: 'item',
        entityIds: noImageItemsRes.data?.map(i => i.id) ?? [],
        estimatedMinutes: noImageCount * 5,
        confidence: 'high',
      });
    }

    // ── 4. Unlisted items (7+ days in inventory) ──────────────────────────
    const unlistedCount = unlisted7dRes.data?.length ?? 0;
    if (unlistedCount > 0) {
      const estimatedValue = unlisted7dRes.data
        ?.reduce((s, i) => s + Number(i.valuation_mid ?? 0), 0) ?? 0;
      actions.push({
        actionType: 'list_items',
        priority: 65,
        title: `${unlistedCount} unlisted item${unlistedCount > 1 ? 's' : ''} in inventory`,
        description: `${unlistedCount} identified item${unlistedCount > 1 ? 's' : ''} have been in stock 7+ days without a listing`,
        why: 'Unlisted items generate no revenue and tie up capital.',
        expectedBenefit: estimatedValue > 0 ? `Est. £${estimatedValue.toFixed(0)} value to unlock` : 'Free up capital and generate revenue',
        entityType: 'item',
        entityIds: unlisted7dRes.data?.map(i => i.id) ?? [],
        estimatedMinutes: unlistedCount * 10,
        confidence: 'medium',
      });
    }

    // ── 5. Stale listings (60+ days without sale) ─────────────────────────
    const staleCount = staleListingsRes.data?.length ?? 0;
    if (staleCount > 0) {
      actions.push({
        actionType: 'review_stale_listings',
        priority: 55,
        title: `${staleCount} listing${staleCount > 1 ? 's' : ''} unsold for 60+ days`,
        description: 'These listings may need repricing, better photos, or improved descriptions',
        why: 'Stale listings tie up capital. A price adjustment or relist often triggers new buyer interest.',
        expectedBenefit: 'Free up capital and potentially convert stale stock',
        entityType: 'listing',
        entityIds: staleListingsRes.data?.map(l => l.id) ?? [],
        estimatedMinutes: staleCount * 5,
        confidence: 'medium',
      });
    }

    // ── 6. Push updates to eBay (items modified after publish) ────────────
    const stalePushListings = (activeListingsRes.data ?? []).filter(l => {
      const item = l.items as any;
      if (!item?.updated_at || !l.published_at) return false;
      return new Date(item.updated_at) > new Date(l.published_at);
    });
    if (stalePushListings.length > 0) {
      actions.push({
        actionType: 'push_updates_to_ebay',
        priority: 50,
        title: `${stalePushListings.length} listing${stalePushListings.length > 1 ? 's' : ''} have unsent changes`,
        description: 'These items were edited after publishing — eBay doesn\'t have the latest data',
        why: 'New images, better descriptions, and updated specifics improve search ranking and sell-through.',
        expectedBenefit: 'Keep eBay listings accurate and maximise visibility',
        entityType: 'listing',
        entityIds: stalePushListings.map(l => l.id),
        estimatedMinutes: 2,
        confidence: 'high',
      });
    }
  } catch (e: any) {
    console.error('[CommercialEngine] computeNextActions error:', e?.message);
  }

  return actions.sort((a, b) => b.priority - a.priority);
}

// ── Save next actions to DB ───────────────────────────────────────────────────

export async function saveNextActions(
  tenantId: string,
  actions: NextAction[],
): Promise<void> {
  const supabase = getSupabaseClient();
  // Clear existing non-dismissed actions for this tenant first
  await supabase
    .from('next_actions')
    .delete()
    .eq('tenant_id', tenantId)
    .eq('is_dismissed', false);

  if (actions.length === 0) return;

  await supabase.from('next_actions').insert(
    actions.map(a => ({
      tenant_id: tenantId,
      action_type: a.actionType,
      priority: a.priority,
      title: a.title,
      description: a.description,
      why: a.why,
      expected_benefit: a.expectedBenefit,
      entity_type: a.entityType ?? null,
      entity_ids: a.entityIds ?? [],
      estimated_minutes: a.estimatedMinutes ?? null,
      confidence: a.confidence,
      is_dismissed: false,
      model_version: PROFIT_ENGINE_VERSION,
    }))
  );
}

// ── Load next actions from DB ─────────────────────────────────────────────────

export async function loadNextActions(tenantId: string): Promise<NextAction[]> {
  const supabase = getSupabaseClient();
  const { data } = await supabase
    .from('next_actions')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('is_dismissed', false)
    .order('priority', { ascending: false })
    .limit(10);

  return (data ?? []).map(row => ({
    id: row.id,
    actionType: row.action_type,
    priority: row.priority,
    title: row.title,
    description: row.description ?? '',
    why: row.why ?? '',
    expectedBenefit: row.expected_benefit ?? '',
    entityType: row.entity_type ?? undefined,
    entityIds: row.entity_ids ?? [],
    estimatedMinutes: row.estimated_minutes ?? undefined,
    confidence: row.confidence ?? 'medium',
  }));
}

// ── Dismiss a next action ─────────────────────────────────────────────────────

export async function dismissNextAction(actionId: string): Promise<void> {
  const supabase = getSupabaseClient();
  await supabase
    .from('next_actions')
    .update({ is_dismissed: true, dismissed_at: new Date().toISOString() })
    .eq('id', actionId);
}

// ── Record commercial event ───────────────────────────────────────────────────

export type CommercialEventType =
  | 'ITEM_ACQUIRED'
  | 'ITEM_IDENTIFIED'
  | 'ITEM_VALUED'
  | 'LISTING_CREATED'
  | 'LISTING_PUBLISHED'
  | 'PRICE_CHANGED'
  | 'LISTING_VIEWED'
  | 'OFFER_RECEIVED'
  | 'ITEM_SOLD'
  | 'ORDER_COMPLETED'
  | 'PROFIT_REALIZED'
  | 'PREDICTION_MADE'
  | 'PREDICTION_RESOLVED'
  | 'OPPORTUNITY_CREATED'
  | 'OPPORTUNITY_ANALYSED'
  | 'OPPORTUNITY_ACQUIRED'
  | 'ACQUISITION_EVALUATED';

export async function recordCommercialEvent(
  tenantId: string,
  eventType: CommercialEventType,
  entityType: string,
  entityId: string,
  data?: Record<string, any>,
): Promise<void> {
  try {
    const supabase = getSupabaseClient();
    await supabase.from('commercial_events').insert({
      tenant_id: tenantId,
      event_type: eventType,
      entity_type: entityType,
      entity_id: entityId,
      data: data ?? {},
      model_version: PROFIT_ENGINE_VERSION,
    });
  } catch (e: any) {
    // Non-fatal — never break the main flow for event recording
    console.warn('[CommercialEngine] recordCommercialEvent failed:', e?.message);
  }
}

// ── Dashboard intelligence summary ────────────────────────────────────────────
// Fast query for the Command Centre dashboard

export interface IntelligenceSummary {
  // Opportunities
  openOpportunities: number;
  topOpportunityTitle?: string;
  topOpportunityROI?: number;
  // Alerts
  staleListing60d: number;
  itemsNeedingImages: number;
  draftListings: number;
  stalePushCount: number;
  // Capital signal
  estimatedStockValue: number;
  // Actions ready
  nextActionsCount: number;
}

export async function getIntelligenceSummary(tenantId: string): Promise<IntelligenceSummary> {
  const supabase = getSupabaseClient();

  const [
    oppRes,
    staleListingsRes,
    noImageRes,
    draftRes,
    stockValueRes,
    savedActionsRes,
  ] = await Promise.all([
    // Open opportunities
    supabase
      .from('opportunities')
      .select('id, title, estimated_roi')
      .eq('tenant_id', tenantId)
      .eq('status', 'open')
      .order('estimated_roi', { ascending: false })
      .limit(1),

    // Stale listings 60d
    supabase
      .from('listings')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('status', 'active')
      .lt('published_at', new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString()),

    // Items needing images
    supabase
      .from('items')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .in('status', ['new', 'identified', 'assessed', 'priced'])
      .is('media', null),

    // Draft listings
    supabase
      .from('listings')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .in('status', ['draft', 'needs_correction']),

    // Stock value (sum of valuation_mid for active items)
    supabase
      .from('items')
      .select('valuation_mid')
      .eq('tenant_id', tenantId)
      .in('status', ['new', 'identified', 'assessed', 'priced', 'listed', 'relisted']),

    // Saved next actions
    supabase
      .from('next_actions')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('is_dismissed', false),
  ]);

  const estimatedStockValue = (stockValueRes.data ?? [])
    .reduce((s, r) => s + Number(r.valuation_mid ?? 0), 0);

  // Stale push count from active listings
  let stalePushCount = 0;
  try {
    const { data: stalePushData } = await supabase
      .from('listings')
      .select('id, published_at, items(updated_at)')
      .eq('tenant_id', tenantId)
      .eq('status', 'active')
      .not('external_listing_id', 'is', null)
      .limit(100);

    stalePushCount = (stalePushData ?? []).filter(l => {
      const item = l.items as any;
      if (!item?.updated_at || !l.published_at) return false;
      return new Date(item.updated_at) > new Date(l.published_at);
    }).length;
  } catch {}

  const topOpp = oppRes.data?.[0];

  return {
    openOpportunities: oppRes.data?.length ?? 0,
    topOpportunityTitle: topOpp?.title,
    topOpportunityROI: topOpp?.estimated_roi ? Number(topOpp.estimated_roi) : undefined,
    staleListing60d: staleListingsRes.count ?? 0,
    itemsNeedingImages: noImageRes.count ?? 0,
    draftListings: draftRes.count ?? 0,
    stalePushCount,
    estimatedStockValue,
    nextActionsCount: savedActionsRes.count ?? 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ITEM COMMERCIAL INTELLIGENCE
// Answers the six core SWISH questions for a single item.
// Evidence is always displayed separately — never blended invisibly.
// Confidence decays with weak evidence, unknown identity, or unknown condition.
// ─────────────────────────────────────────────────────────────────────────────

export type BuyDecision = 'BUY' | 'BUY_IF_UNDER' | 'WATCH' | 'RESEARCH_FURTHER' | 'DO_NOT_BUY' | 'PASS';
export type SellAction =
  | 'LIST_NOW'
  | 'REPRICE'
  | 'RELIST'
  | 'HOLD'
  | 'BUNDLE'
  | 'SELL_QUICKLY'
  | 'END_LISTING'
  | 'CHECK_AUTHENTICITY'
  | 'CHECK_CONDITION'
  | 'OBTAIN_MORE_PHOTOS'
  | 'RESEARCH_FURTHER'
  | 'AUCTION';

export interface ValuationEvidence {
  soldCount: number;
  relevantSoldCount: number;
  soldMedian: number | null;
  soldRange: [number, number] | null;
  soldDateRange?: string;
  activeCount: number;
  activeMedianAsking: number | null;
  referenceSource?: string;
  referenceValue?: number;
  dataQuality: 'strong' | 'adequate' | 'weak' | 'insufficient';
  dataQualityReason: string;
}

export interface BuyCalculation {
  acquisitionCost: number;
  preparationCost: number;
  sellingFees: number;
  shippingCost: number;
  packagingCost: number;
  totalCost: number;
  expectedSalePrice: number;
  expectedNet: number;
  expectedProfit: number;
  roiPct: number;
  marginPct: number;
  daysToSaleEstimate: number;
  maxBuyPriceFor30PctROI: number;
  maxBuyPriceFor20PctROI: number;
  maxBuyPriceForBreakEven: number;
  decision: BuyDecision;
  decisionReason: string;
  attractiveAt?: number;
  thinMarginAt?: number;
}

export interface ItemCommercialIntelligence {
  identificationConfidence: number;
  identificationTier: 'confirmed' | 'probable' | 'possible' | 'unknown';
  identificationNote: string;
  valuationConfidence: 'high' | 'medium' | 'low' | 'insufficient_data';
  estimatedSalePrice: number;
  estimatedNetSale: number;
  valuationRange: [number, number];
  evidence: ValuationEvidence;
  score: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  gradeLabel: string;
  gradeColor: string;
  scoreReasoning: string[];
  buyCalc: BuyCalculation;
  sellAction: SellAction;
  sellActionReason: string;
  nicheContext: Record<string, string>;
  hasVerifiedOutcome: boolean;
  actualSalePrice?: number;
  actualFees?: number;
  actualDaysToSale?: number;
  modelVersion: string;
  calculatedAt: string;
}

export function computeItemCommercialIntelligence(params: {
  identificationConfidence: number;
  specialistId?: string;
  condition?: string;
  valuationLow: number;
  valuationMid: number;
  valuationHigh: number;
  valuationConfidenceRaw?: string;
  recommendedListingPrice?: number;
  saleProb30d?: number;
  soldCount?: number;
  relevantSoldCount?: number;
  soldMedian?: number | null;
  soldRangeLow?: number | null;
  soldRangeHigh?: number | null;
  soldDateRange?: string;
  activeCount?: number;
  activeMedianAsking?: number | null;
  referenceSource?: string;
  referenceValue?: number;
  acquisitionCost: number;
  preparationCost?: number;
  shippingCost?: number;
  packagingCost?: number;
  daysListed?: number;
  watchers?: number;
  views?: number;
  hasImages: boolean;
  imageCount?: number;
  hasDescription: boolean;
  isListed: boolean;
  isSold: boolean;
  listingPrice?: number;
  labourHours?: number;
  actualSalePrice?: number;
  actualFees?: number;
  actualDaysToSale?: number;
  targetROIPct?: number;
}): ItemCommercialIntelligence {
  const {
    identificationConfidence,
    specialistId,
    condition,
    valuationLow,
    valuationMid,
    valuationHigh,
    valuationConfidenceRaw,
    recommendedListingPrice,
    saleProb30d,
    soldCount = 0,
    relevantSoldCount = 0,
    soldMedian = null,
    soldRangeLow = null,
    soldRangeHigh = null,
    soldDateRange,
    activeCount = 0,
    activeMedianAsking = null,
    referenceSource,
    referenceValue,
    acquisitionCost,
    preparationCost = 0,
    shippingCost,
    packagingCost,
    daysListed,
    watchers = 0,
    views = 0,
    hasImages,
    imageCount = 0,
    hasDescription,
    isListed,
    isSold,
    labourHours,
    actualSalePrice,
    actualFees,
    actualDaysToSale,
    targetROIPct = 30,
  } = params;

  const VERSION = PROFIT_ENGINE_VERSION;
  const now = new Date().toISOString();

  // 1. IDENTIFICATION TIER
  const identificationTier: ItemCommercialIntelligence['identificationTier'] =
    identificationConfidence >= 0.80 ? 'confirmed' :
    identificationConfidence >= 0.60 ? 'probable' :
    identificationConfidence >= 0.35 ? 'possible' : 'unknown';

  const identificationNote =
    identificationTier === 'confirmed' ? 'Identification is well-supported by evidence.' :
    identificationTier === 'probable' ? 'Identification is probable — manual verification recommended before listing at full price.' :
    identificationTier === 'possible' ? 'Identification is uncertain — obtain further evidence before listing.' :
    'Identification insufficient — do not list until identity is established.';

  // 2. EVIDENCE QUALITY
  let dataQuality: ValuationEvidence['dataQuality'] = 'insufficient';
  let dataQualityReason = '';

  if (relevantSoldCount >= 5 && soldMedian && soldMedian > 0) {
    dataQuality = 'strong';
    dataQualityReason = relevantSoldCount + ' relevant sold prices with median ' + (soldMedian ? '£' + soldMedian.toFixed(2) : '—') + '.';
  } else if (relevantSoldCount >= 2 && soldMedian) {
    dataQuality = 'adequate';
    dataQualityReason = relevantSoldCount + ' sold prices found — limited comparables, treat range with caution.';
  } else if ((activeCount >= 3 && activeMedianAsking) || (referenceValue && referenceValue > 0)) {
    dataQuality = 'weak';
    dataQualityReason = relevantSoldCount > 0
      ? 'Only ' + relevantSoldCount + ' sold price found. Asking prices used as secondary reference.'
      : 'No sold data found — valuation based on asking prices only.';
  } else {
    dataQuality = 'insufficient';
    dataQualityReason = 'No reliable market evidence found. Run Re-Value to search for comparable sales.';
  }

  if (identificationTier === 'unknown') {
    dataQuality = 'insufficient';
    dataQualityReason = 'Cannot value an unidentified item reliably. Establish identity first.';
  } else if (identificationTier === 'possible' && dataQuality === 'strong') {
    dataQuality = 'adequate';
    dataQualityReason += ' Confidence reduced due to uncertain identification.';
  }

  const evidence: ValuationEvidence = {
    soldCount,
    relevantSoldCount,
    soldMedian,
    soldRange: soldRangeLow != null && soldRangeHigh != null ? [soldRangeLow, soldRangeHigh] : null,
    soldDateRange,
    activeCount,
    activeMedianAsking,
    referenceSource,
    referenceValue,
    dataQuality,
    dataQualityReason,
  };

  // 3. VALUATION CONFIDENCE
  const rawConfMap: Record<string, 'high' | 'medium' | 'low' | 'insufficient_data'> = {
    high: 'high', medium: 'medium', low: 'low', very_low: 'low',
    insufficient_data: 'insufficient_data', unknown: 'insufficient_data', fallback: 'insufficient_data',
  };
  let valuationConfidence: ItemCommercialIntelligence['valuationConfidence'] =
    rawConfMap[valuationConfidenceRaw ?? 'unknown'] ?? 'insufficient_data';

  if (dataQuality === 'insufficient') valuationConfidence = 'insufficient_data';
  else if (dataQuality === 'weak' && valuationConfidence === 'high') valuationConfidence = 'medium';
  else if (dataQuality === 'adequate' && valuationConfidence === 'high') valuationConfidence = 'medium';

  // Use conservative mid — prefer sold median, never inflate
  const effectiveSalePrice =
    (dataQuality === 'strong' || dataQuality === 'adequate') && soldMedian && soldMedian > 0
      ? soldMedian
      : (recommendedListingPrice ?? valuationMid);

  const hasReliableValuation = valuationMid > 0 && valuationConfidence !== 'insufficient_data';

  // 4. FEES & NET
  const isCoin = (specialistId ?? '').includes('coin') || specialistId === 'stamps' || specialistId === 'banknotes';
  const isMX = specialistId === 'motocross';
  const isClothing = (specialistId ?? '').includes('clothing') || specialistId === 'trainers_sneakers';

  const feeRate = isMX ? 0.125 : isCoin ? 0.129 : isClothing ? 0.135 : 0.129;
  const defaultShipping = shippingCost ?? (isMX ? 50 : isCoin ? 3.50 : isClothing ? 4.50 : 3.50);
  const defaultPackaging = packagingCost ?? (isMX ? 0 : isCoin ? 0.80 : isClothing ? 1.20 : 0.80);
  const salePriceForCalc = effectiveSalePrice > 0 ? effectiveSalePrice : valuationMid;

  const ebayFee = Math.max(0, salePriceForCalc * feeRate);
  const netSale = Math.max(0, salePriceForCalc - ebayFee - defaultShipping - defaultPackaging);
  const profit = Math.max(-acquisitionCost, netSale - acquisitionCost - preparationCost);
  const roiPct = acquisitionCost > 0 ? (profit / acquisitionCost) * 100 : 0;
  const marginPct = salePriceForCalc > 0 ? (profit / salePriceForCalc) * 100 : 0;

  // 5. MAX BUY PRICE
  const grossAfterFees = Math.max(0, salePriceForCalc - ebayFee - defaultShipping - defaultPackaging);
  const maxBuyFor30 = hasReliableValuation ? Math.max(0, grossAfterFees / 1.30 - preparationCost) : 0;
  const maxBuyFor20 = hasReliableValuation ? Math.max(0, grossAfterFees / 1.20 - preparationCost) : 0;
  const maxBuyBreakEven = hasReliableValuation ? Math.max(0, grossAfterFees - preparationCost) : 0;

  const daysToSaleEstimate: number =
    actualDaysToSale != null ? actualDaysToSale :
    saleProb30d != null && saleProb30d > 0 ? Math.round(30 / saleProb30d) : 60;

  // 6. BUY DECISION
  let decision: BuyDecision = 'RESEARCH_FURTHER';
  let decisionReason = '';
  let attractiveAt: number | undefined;
  let thinMarginAt: number | undefined;

  if (!hasReliableValuation) {
    decision = 'RESEARCH_FURTHER';
    decisionReason = 'Insufficient market evidence — run Re-Value to establish a price before committing.';
  } else if (identificationTier === 'unknown') {
    decision = 'RESEARCH_FURTHER';
    decisionReason = 'Cannot recommend a buy price for an unidentified item.';
  } else if (acquisitionCost <= 0) {
    decision = maxBuyFor30 > 0 ? 'BUY_IF_UNDER' : 'WATCH';
    decisionReason = maxBuyFor30 > 0
      ? 'At £' + maxBuyFor30.toFixed(0) + ' or below this hits your ' + targetROIPct + '% ROI target.'
      : 'Record acquisition cost to get a precise buy recommendation.';
    attractiveAt = maxBuyFor30 > 0 ? maxBuyFor30 : undefined;
  } else if (roiPct >= targetROIPct) {
    decision = 'BUY';
    decisionReason = 'At £' + acquisitionCost.toFixed(0) + ' purchase price this is attractive — ' + roiPct.toFixed(0) + '% ROI.';
    attractiveAt = acquisitionCost;
  } else if (roiPct >= 15) {
    decision = 'BUY_IF_UNDER';
    decisionReason = 'Margin is thin at £' + acquisitionCost.toFixed(0) + ' (' + roiPct.toFixed(0) + '% ROI). Max for ' + targetROIPct + '% ROI: £' + maxBuyFor30.toFixed(0) + '.';
    thinMarginAt = acquisitionCost;
    attractiveAt = maxBuyFor30;
  } else if (roiPct >= 0) {
    decision = 'WATCH';
    decisionReason = 'At £' + acquisitionCost.toFixed(0) + ' the margin (' + roiPct.toFixed(0) + '% ROI) is too thin. Price below £' + maxBuyFor30.toFixed(0) + ' for ' + targetROIPct + '% ROI.';
    thinMarginAt = acquisitionCost;
  } else {
    decision = 'DO_NOT_BUY';
    decisionReason = 'At £' + acquisitionCost.toFixed(0) + ' this is loss-making (£' + Math.abs(profit).toFixed(0) + ' estimated loss). Do not buy at this price.';
    thinMarginAt = acquisitionCost;
  }

  // 7. SELL ACTION
  let sellAction: SellAction = 'LIST_NOW';
  let sellActionReason = '';

  if (isSold) {
    sellAction = 'HOLD'; sellActionReason = 'Item is already sold.';
  } else if (identificationTier === 'unknown') {
    sellAction = 'RESEARCH_FURTHER'; sellActionReason = 'Identify the item before listing.';
  } else if (!hasImages) {
    sellAction = 'OBTAIN_MORE_PHOTOS'; sellActionReason = 'eBay requires at least one photo.';
  } else if (!hasDescription) {
    sellAction = 'RESEARCH_FURTHER'; sellActionReason = 'Add a description before listing.';
  } else if (isListed && (daysListed ?? 0) > 60 && (watchers ?? 0) === 0) {
    sellAction = 'REPRICE'; sellActionReason = 'Listing stale after ' + daysListed + ' days with no watchers — reprice to stimulate demand.';
  } else if (isListed && (daysListed ?? 0) > 90) {
    sellAction = 'SELL_QUICKLY'; sellActionReason = 'Listed over 90 days — accept best offer or reduce price to free up capital.';
  } else if (isListed) {
    sellAction = 'HOLD'; sellActionReason = 'Currently listed — monitor watchers and views.';
  } else if (valuationConfidence === 'high' && identificationTier === 'confirmed') {
    if (isMX && (condition === 'Excellent' || condition === 'Good')) {
      sellAction = 'AUCTION'; sellActionReason = 'Good condition MX bikes often achieve stronger prices at auction where multiple bidders compete.';
    } else {
      sellAction = 'LIST_NOW'; sellActionReason = 'Well-identified with strong valuation evidence — ready to list.';
    }
  } else if (valuationConfidence === 'insufficient_data') {
    sellAction = 'RESEARCH_FURTHER'; sellActionReason = 'Market evidence is insufficient — research comparables before listing.';
  } else {
    sellAction = 'LIST_NOW'; sellActionReason = 'Item is identified and valued — proceed with listing.';
  }

  // 8. COMMERCIAL SCORE
  const existingScore = computeCommercialScore({
    acquisitionCost,
    estimatedSalePrice: salePriceForCalc,
    daysListed,
    watchers,
    views,
    labourHours,
    specialistId,
    condition,
    hasImages,
    imageCount,
    hasDescription,
    hasItemSpecifics: false,
    capitalLockUpDays: daysToSaleEstimate,
    confidence: valuationConfidence,
  });

  // 9. SCORE REASONING
  const scoreReasoning: string[] = [];
  if (hasReliableValuation && salePriceForCalc > 0) {
    if (roiPct >= 30) scoreReasoning.push('Strong ROI: ' + roiPct.toFixed(0) + '% at current cost');
    else if (roiPct >= 0) scoreReasoning.push('Thin margin: ' + roiPct.toFixed(0) + '% ROI — below ' + targetROIPct + '% target');
    else if (acquisitionCost > 0) scoreReasoning.push('Loss-making: £' + Math.abs(profit).toFixed(0) + ' loss at current cost');
  }
  if (dataQuality === 'strong') scoreReasoning.push('Strong evidence: ' + relevantSoldCount + ' comparable sales');
  else if (dataQuality === 'adequate') scoreReasoning.push('Limited comparables: ' + relevantSoldCount + ' sales — use wider range');
  else if (dataQuality === 'weak') scoreReasoning.push('Asking prices only — no completed sale data found');
  else scoreReasoning.push('Insufficient market evidence — run Re-Value');
  if (!hasImages) scoreReasoning.push('No photos — cannot list without images');
  if (watchers >= 5) scoreReasoning.push(watchers + ' watchers showing active buyer interest');
  if (daysListed != null && daysListed > 60 && !watchers) scoreReasoning.push(daysListed + ' days listed with no watchers — reprice recommended');
  if (identificationTier !== 'confirmed') scoreReasoning.push(identificationTier + ' identification — ' + Math.round(identificationConfidence * 100) + '% confidence');

  // 10. NICHE CONTEXT
  const nicheContext: Record<string, string> = {};
  if (isMX) {
    nicheContext['Condition impact'] = 'Running bikes command 40-80% premium over non-runners. Engine hours affect value significantly.';
    nicheContext['Marketplace'] = 'eBay Buy-It-Now with Best Offer works well for MX. Facebook Marketplace for local sales to avoid transport cost.';
    nicheContext['Prep cost'] = 'Budget for service, new tyres, plastics, and photos before listing at full price.';
  } else if (isClothing) {
    nicheContext['Authenticity'] = 'Designer pieces require authentication evidence. Document tags, stitching, hardware in photos.';
    nicheContext['Marketplace'] = 'Vinted and Depop for affordable clothing. eBay for vintage and designer. Include measurements.';
  } else if (isCoin) {
    nicheContext['Valuation basis'] = 'eBay sold prices reflect actual market; catalogue values are retail reference only.';
    nicheContext['Condition impact'] = 'One grade difference (VF to EF) can double value. Photograph accurately.';
  }

  const buyCalc: BuyCalculation = {
    acquisitionCost,
    preparationCost,
    sellingFees: ebayFee,
    shippingCost: defaultShipping,
    packagingCost: defaultPackaging,
    totalCost: acquisitionCost + preparationCost + defaultShipping + defaultPackaging,
    expectedSalePrice: salePriceForCalc,
    expectedNet: netSale,
    expectedProfit: profit,
    roiPct,
    marginPct,
    daysToSaleEstimate,
    maxBuyPriceFor30PctROI: maxBuyFor30,
    maxBuyPriceFor20PctROI: maxBuyFor20,
    maxBuyPriceForBreakEven: maxBuyBreakEven,
    decision,
    decisionReason,
    attractiveAt,
    thinMarginAt,
  };

  return {
    identificationConfidence,
    identificationTier,
    identificationNote,
    valuationConfidence,
    estimatedSalePrice: salePriceForCalc,
    estimatedNetSale: netSale,
    valuationRange: [valuationLow, valuationHigh],
    evidence,
    score: existingScore.score,
    grade: existingScore.grade,
    gradeLabel: existingScore.label,
    gradeColor: existingScore.colour,
    scoreReasoning,
    buyCalc,
    sellAction,
    sellActionReason,
    nicheContext,
    hasVerifiedOutcome: actualSalePrice != null,
    actualSalePrice,
    actualFees,
    actualDaysToSale,
    modelVersion: VERSION,
    calculatedAt: now,
  };
}

/**
 * Record a verified commercial outcome against an item.
 * Human-confirmed outcomes carry greater weight than AI predictions in the learning layer.
 */
export async function recordVerifiedOutcome(
  tenantId: string,
  itemId: string,
  outcome: {
    actualSalePrice: number;
    actualFees?: number;
    actualDaysToSale?: number;
    actualAcquisitionCost?: number;
    actualPreparationCost?: number;
    confirmedBy?: 'user' | 'ebay_order' | 'import';
  },
): Promise<void> {
  const supabase = getSupabaseClient();
  try {
    const updates: Record<string, any> = {
      sold_price: outcome.actualSalePrice,
      updated_at: new Date().toISOString(),
    };
    if (outcome.actualAcquisitionCost != null) updates.acquired_cost = outcome.actualAcquisitionCost;
    await supabase.from('items').update(updates).eq('id', itemId);
    await recordCommercialEvent(tenantId, 'PROFIT_REALIZED', 'item', itemId, {
      actual_sale_price: outcome.actualSalePrice,
      actual_fees: outcome.actualFees,
      actual_days_to_sale: outcome.actualDaysToSale,
      actual_acquisition_cost: outcome.actualAcquisitionCost,
      actual_preparation_cost: outcome.actualPreparationCost,
      confirmed_by: outcome.confirmedBy ?? 'user',
      verified_outcome: true,
    });
  } catch (e: any) {
    console.warn('[CommercialEngine] recordVerifiedOutcome failed:', e?.message);
  }
}

// ── Re-export profit engine functions for convenience ─────────────────────────
export {
  calculateProfit,
  evaluateAcquisition,
  PROFIT_ENGINE_VERSION,
  type ProfitResult,
} from './profitEngine';
