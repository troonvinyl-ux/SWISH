import { FunctionsHttpError } from '@supabase/supabase-js';
import { getSupabaseClient } from '@/template';
import { NICHE_MODULES } from '@/constants/niches';
import { resolveProductionNiche } from './nicheRouting';
import { normaliseAuctionUrl } from './auctionLinkService';

export interface ManifestSoldItem { id: string; title: string; price: number; currency: 'GBP'; soldDate: string; condition: string; url: string; imageUrl: string }
export interface ManifestSoldResult { status: 'available' | 'empty' | 'unavailable'; source: 'ebay_marketplace_insights'; query: string; checkedAt: string; message: string; items: ManifestSoldItem[] }
export function manifestProductQuery(title: string, brand: string): string {
  const words = title.replace(/<[^>]*>/g,' ').replace(/[|:;]+/g,' ').replace(/\s+/g,' ').trim().split(' ').slice(0,10).join(' ');
  return `${brand && !words.toLowerCase().includes(brand.toLowerCase()) ? brand + ' ' : ''}${words}`.slice(0,100).trim();
}
export function parseManifestSoldResult(data: any, query: string): ManifestSoldResult {
  if (data?.source !== 'ebay_marketplace_insights' || !['available','empty','unavailable'].includes(data.status) || !Array.isArray(data.items)) throw new Error('Sold prices could not be checked. Try again.');
  const safeUrl = (value: unknown) => { try { return typeof value === 'string' ? normaliseAuctionUrl(value) : ''; } catch { return ''; } };
  const seen = new Set<string>();
  const items: ManifestSoldItem[] = data.status !== 'available' ? [] : data.items.filter((item: any) => item && typeof item.id === 'string' && typeof item.title === 'string' && item.currency === 'GBP'
    && typeof item.price === 'number' && Number.isFinite(item.price) && item.price > 0 && typeof item.soldDate === 'string' && Number.isFinite(Date.parse(item.soldDate)))
    .filter((item: any) => { if (seen.has(item.id)) return false; seen.add(item.id); return true; })
    .slice(0,8).map((item: any) => ({ id:item.id, title:item.title.slice(0,180), price:item.price, currency:'GBP' as const, soldDate:item.soldDate,
      condition:typeof item.condition === 'string' ? item.condition.slice(0,100) : '', url:safeUrl(item.url), imageUrl:safeUrl(item.imageUrl) }));
  const status = data.status === 'available' && !items.length ? 'empty' : data.status;
  return { status, source:'ebay_marketplace_insights', query, checkedAt:typeof data.checkedAt === 'string' ? data.checkedAt : new Date().toISOString(), items,
    message:status === 'available' ? 'Similar sold items. Check model, condition and quantity.' : status === 'empty' ? 'No comparable sold prices found. Try a shorter product name.'
      : typeof data.message === 'string' ? data.message.slice(0,240) : 'Sold prices are unavailable. Check sold listings on eBay instead.' };
}
export async function searchManifestSold(tenantId: string, nicheId: string, query: string): Promise<ManifestSoldResult> {
  const niche = resolveProductionNiche(nicheId);
  if (!tenantId || !niche || query.trim().length < 3 || query.length > 100) throw new Error('Enter a product name of 3–100 characters.');
  const { data, error } = await getSupabaseClient().functions.invoke('swish-market-value', { body: {
    route:'manifest_sold_comparisons', tenantId, nicheId:niche, specialistId:NICHE_MODULES[niche].defaultSpecialist, title:query.trim(), applyToItem:false,
  } });
  if (error) {
    let detail = error.message;
    if (error instanceof FunctionsHttpError) { try { detail = await error.context.text(); } catch { /* Keep fallback, never expose private provider details. */ } }
    let message = 'Sold prices could not load. Check your connection and try again.';
    try { const body = JSON.parse(detail); if (body.upgradeRequired) message = 'Refresh your subscription access before checking sold prices.'; } catch { /* Non-JSON failure. */ }
    throw new Error(message);
  }
  return parseManifestSoldResult(data,query.trim());
}
