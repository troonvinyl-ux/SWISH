// SWISH Market Value Service
// Client-side: calls swish-market-value edge function to get
// worldwide eBay pricing intelligence and AI recommendation.

import { getSupabaseClient } from '@/template';
import { FunctionsHttpError } from '@supabase/supabase-js';

export interface MarketStats {
  count: number;
  low: number;
  mid: number;
  high: number;
  mean: number;
  auctionWinRate: number;
  medianAuctionPrice: number;
  medianBinPrice: number;
  recentSales: Array<{
    title: string;
    price: number;
    currency: string;
    listingType: string;
    condition: string;
    url: string;
  }>;
  dataQuality: 'high' | 'medium' | 'low' | 'insufficient';
}

export interface PricingRecommendation {
  recommendedFormat: 'Auction' | 'BuyItNow' | 'BuyItNow_WithBestOffer';
  recommendedPrice: number;
  auctionStartPrice?: number;
  confidenceScore: number;
  quickSaleRatio: number;
  reasoning: string;
  keyFactors: string[];
  warningFlags: string[];
}

export interface SoldMarketData {
  verifiedSoldCount: number;
  relevantSoldCount: number;
  excludedSoldCount: number;
  medianPrice: number;
  weightedMedianPrice: number;
  lowPrice: number;
  highPrice: number;
  auctionMedian: number;
  binMedian: number;
  auctionShare: number;
  dateRange: string;
  dataQuality: 'strong' | 'moderate' | 'weak' | 'insufficient';
  dataQualityReason: string;
  exceptionalSales: Array<{ title: string; price: number; date: string }>;
}

export interface ActiveAskingPrices {
  note: string;
  count: number;
  relevantCount: number;
  medianAskingPrice: number;
  lowAskingPrice: number;
  highAskingPrice: number;
}

export interface ValuationResult {
  valuationLow: number;
  valuationMid: number;
  valuationHigh: number;
  valuationConfidence: string;
  valuationMethod: string;
  valuationWarnings: string[];
  fairMarketValue: number;
  currentAskingMarketMid: number;
  recommendedListingPrice: number;
  recommendedListingFormat: 'Auction' | 'BuyItNow' | 'BuyItNow_WithBestOffer';
  auctionStartPrice?: number;
  listingPriceRationale: string;
  saleProb30d: number | null;
  saleProbBasis?: string;
}

export interface MarketValueResult {
  // v3 structure
  valuation: ValuationResult;
  soldMarket: SoldMarketData;
  activeAskingPrices: ActiveAskingPrices;
  numistaSales?: NumistaSalesData | null;
  combinedEvidence?: {
    numistaRelevant: number;
    ebayRelevant: number;
    total: number;
    combinedMedian: number;
    combinedLow: number;
    combinedHigh: number;
  };
  auditTrail: Record<string, any>;
  numista?: {
    title: string;
    typeId?: number;
    numistaN?: string;
    matchScore: number;
    accepted: boolean;
    matchFactors: string[];
    issued_from?: number;
    issued_to?: number;
    composition?: string;
    weight?: number;
    diameter?: number;
    references: string[];
    note: string;
  } | null;
  searchQuery: string;
  autonomousMode: boolean;
  applied: boolean;
  dataSource: {
    findingApiTotal: number;
    browseApiActive: number;
    numistaFound: number;
    currencyConversions: string[];
  };
  // Legacy compatibility
  stats: MarketStats;
  recommendation: PricingRecommendation;
}

export interface NumistaSalesData {
  available: boolean;
  error: string | null;
  numistaN: string;
  numistaUrl: string;
  numistaTitle: string;
  totalFetched: number;
  relevantCount: number;
  median: number;
  low: number;
  high: number;
  recentSales: Array<{
    price: number;
    currency: string;
    originalPrice: number;
    date: string;
    condition: string;
    grade: string;
    marketplace: string;
    description: string;
  }>;
}

export async function getMarketValue(params: {
  tenantId: string;
  itemId?: string;
  title: string;
  specialistId?: string;
  attributes?: Record<string, any>;
  condition?: string;
  identificationConfidence?: number;
  identificationTier?: string;
  numistaTypeId?: number | null;
  numistaMatchScore?: number;
  numistaMatchTier?: string;
  applyToItem?: boolean;
  /** Stored item image URLs to pass for Gemini vision + eBay visual search */
  imageUrls?: string[];
}): Promise<{ result: MarketValueResult | null; error: string | null }> {
  try {
    const supabase = getSupabaseClient();
    // Build clean body — exclude null/undefined numistaTypeId to avoid confusion
    const body: Record<string, any> = { ...params };
    if (!body.numistaTypeId) delete body.numistaTypeId;
    const { data, error } = await supabase.functions.invoke('swish-market-value', {
      body,
    });

    if (error) {
      let msg = error.message;
      if (error instanceof FunctionsHttpError) {
        try {
          const status = error.context?.status ?? 500;
          const text = await error.context?.text();
          msg = `[${status}] ${text || error.message}`;
        } catch { /* use original message */ }
      }
      return { result: null, error: msg };
    }

    return { result: data as MarketValueResult, error: null };
  } catch (e: any) {
    return { result: null, error: e?.message ?? 'Market value lookup failed' };
  }
}

// ── Bulk Re-ID & Value operation ──────────────────────────────────────────────
// Calls swish-identify (if requested) then swish-market-value for each item.
// Returns a stream of progress updates via a callback.

export interface BulkReIdProgress {
  itemId: string;
  title: string;
  stage: 'identifying' | 'valuing' | 'done' | 'error';
  recommendation?: PricingRecommendation;
  stats?: MarketStats;
  error?: string;
}

export async function bulkReValue(
  tenantId: string,
  items: Array<{
    id: string;
    canonical_title: string;
    specialist_id: string;
    condition?: string;
    attributes?: Record<string, any>;
    media?: string[];
  }>,
  options: {
    applyAutonomously: boolean;
  },
  onProgress: (update: BulkReIdProgress) => void,
): Promise<{ processed: number; errors: number }> {
  let processed = 0;
  let errors = 0;

  for (const item of items) {
    const title = item.canonical_title;
    if (!title || title.length < 3) {
      onProgress({ itemId: item.id, title: title || '(untitled)', stage: 'error', error: 'No title — run Re-ID first' });
      errors++;
      continue;
    }

    onProgress({ itemId: item.id, title, stage: 'valuing' });

    const { result, error } = await getMarketValue({
      tenantId,
      itemId: item.id,
      title,
      specialistId: item.specialist_id,
      attributes: item.attributes ?? {},
      condition: item.condition ?? '',
      identificationConfidence: (item as any).identification_confidence ?? 0.5,
      identificationTier: (item as any).identification_tier ?? 'medium',
      numistaTypeId: (item.attributes as any)?.numista_type_id ? Number((item.attributes as any).numista_type_id) : null,
      numistaMatchScore: (item.attributes as any)?.numista_match_score ? Number((item.attributes as any).numista_match_score) : 0,
      numistaMatchTier: (item.attributes as any)?.numista_status ?? 'no_match',
      applyToItem: options.applyAutonomously,
    });

    if (error || !result) {
      onProgress({ itemId: item.id, title, stage: 'error', error: error ?? 'Unknown error' });
      errors++;
    } else {
      onProgress({
        itemId: item.id,
        title,
        stage: 'done',
        recommendation: result.recommendation,
        stats: result.stats,
      });
      processed++;
    }

    // Small delay to avoid hammering the edge function
    await new Promise(r => setTimeout(r, 300));
  }

  return { processed, errors };
}
