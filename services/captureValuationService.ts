import { getSupabaseClient } from '@/template';
import { getItem } from './itemService';
import type { MarketValueResult } from './marketValueService';
export async function saveCaptureValuation(tenantId: string, itemId: string, market: MarketValueResult): Promise<string | null> {
  const original = await getItem(itemId);
  if (original.error || !original.item || original.item.tenantId !== tenantId) return 'Saved item could not be verified for this valuation.';
  const valuation = market.valuation;
  const prices = [valuation.valuationLow, valuation.valuationMid, valuation.valuationHigh, valuation.recommendedListingPrice];
  if (prices.some(value => !Number.isFinite(value) || value < 0) || valuation.valuationLow > valuation.valuationMid || valuation.valuationMid > valuation.valuationHigh) return 'Valuation returned an invalid range. No price was saved.';
  const item = original.item;
  const evidence = { method: valuation.valuationMethod, confidence: valuation.valuationConfidence, warnings: valuation.valuationWarnings, rationale: valuation.listingPriceRationale,
    soldCount: market.soldMarket?.relevantSoldCount ?? 0, askingCount: market.activeAskingPrices?.relevantCount ?? 0,
    // Small, labelled provider records only; images remain URLs, not encoded media.
    comparisons: (market.auditTrail?.topComparables ?? []).slice(0, 12), researchedAt: new Date().toISOString() };
  const { data, error } = await getSupabaseClient().from('items').update({
    valuation_low: valuation.valuationLow, valuation_mid: valuation.valuationMid, valuation_high: valuation.valuationHigh,
    valuation_confidence: valuation.valuationConfidence, expected_selling_price: valuation.recommendedListingPrice,
    attributes: { ...item.attributes, _valuation_evidence: evidence, _valuation_needs_review: false },
  }).eq('id', itemId).eq('tenant_id', tenantId).eq('updated_at', item.updatedAt).select('id').maybeSingle();
  if (error || !data) return error?.message ?? 'The item changed during valuation. Reload it before saving this result.';
  const readback = await getItem(itemId);
  if (readback.error || !readback.item || readback.item.tenantId !== tenantId || readback.item.valuationLow !== valuation.valuationLow || readback.item.valuationMid !== valuation.valuationMid || readback.item.valuationHigh !== valuation.valuationHigh || readback.item.expectedSellingPrice !== valuation.recommendedListingPrice) return 'Valuation save could not be confirmed by persisted readback. Reload this item before listing.';
  return null;
}
