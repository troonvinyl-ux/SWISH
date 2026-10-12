// ebayVisualSearchService.ts
// Frontend service for eBay Browse API image-based visual search.
//
// PURPOSE: Additional evidence signal during listing creation.
// - Returns visually similar eBay GB listings.
// - Provides category distribution signals.
// - NEVER replaces SWISH identification.
// - Results are labelled as "similar items", not "confirmed identification".
// - Asking prices are never treated as realised sale prices.
//
// SECURITY: All API calls routed through swish-ebay-browse edge function.
// No eBay credentials exposed to the client.

import { getSupabaseClient } from '@/template';
import { FunctionsHttpError } from '@supabase/supabase-js';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface EbayVisualItem {
  rank: number;
  itemId: string;
  title: string;
  price: { value: number; currency: string };
  image: string | null;
  condition: string;
  conditionId: string;
  listingStatus: string;
  categories: Array<{ id: string; name: string }>;
  primaryCategoryId: string;
  primaryCategoryName: string;
  itemWebUrl: string | null;
  seller: string | null;
  buyingOptions: string[];
  shortDescription: string | null;
}

export interface EbayCategorySignal {
  id: string;
  name: string;
  count: number;
}

export interface EbayVisualSearchResult {
  available: boolean;
  items: EbayVisualItem[];
  totalResults: number;
  topCategory: EbayCategorySignal | null;
  categoryDistribution: EbayCategorySignal[];
  marketplace: string;
  retrievedAt: string;
  error?: string;
  // The image query key — used to avoid re-fetching for same image
  imageHash?: string;
}

export interface VisualSearchInput {
  tenantId: string;
  // Provide one of: imageBase64, imageUri (https://), or imageDataUri (data:image/...)
  imageBase64?: string;      // raw base64 string (no data: prefix)
  imageDataUri?: string;     // data:image/jpeg;base64,... — will be stripped
  imageUri?: string;         // https:// URL — will be fetched and converted
  categoryId?: string;       // optional category filter (use confirmed category only)
  limit?: number;            // default 8, max 20
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/** Convert a data URI or raw base64 to a raw base64 string */
function extractBase64(input: string): string {
  if (input.startsWith('data:')) {
    const comma = input.indexOf(',');
    return comma >= 0 ? input.slice(comma + 1) : input;
  }
  return input;
}

/** Fetch a remote HTTPS image and return it as base64 */
async function fetchImageAsBase64(url: string): Promise<string | null> {
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!resp.ok) return null;
    const blob = await resp.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        resolve(extractBase64(result));
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/** Simple hash for deduplication — first 40 chars of base64 */
function imageHash(b64: string): string {
  return b64.replace(/[^A-Za-z0-9]/g, '').slice(0, 40);
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN FUNCTION
// ─────────────────────────────────────────────────────────────────────────────

export async function searchEbayByImage(
  input: VisualSearchInput,
): Promise<EbayVisualSearchResult> {
  const emptyResult: EbayVisualSearchResult = {
    available: false,
    items: [],
    totalResults: 0,
    topCategory: null,
    categoryDistribution: [],
    marketplace: 'EBAY_GB',
    retrievedAt: new Date().toISOString(),
  };

  // Resolve image to base64
  let b64: string | null = null;

  if (input.imageBase64) {
    b64 = extractBase64(input.imageBase64);
  } else if (input.imageDataUri) {
    b64 = extractBase64(input.imageDataUri);
  } else if (input.imageUri && input.imageUri.startsWith('https://')) {
    b64 = await fetchImageAsBase64(input.imageUri);
  }

  if (!b64 || b64.length < 100) {
    return { ...emptyResult, error: 'Could not obtain a valid image for visual search' };
  }

  const supabase = getSupabaseClient();

  try {
    const { data, error } = await supabase.functions.invoke('swish-ebay-browse', {
      body: {
        route: 'search_by_image',
        tenantId: input.tenantId,
        imageBase64: b64,
        categoryId: input.categoryId,
        limit: input.limit ?? 8,
      },
    });

    if (error) {
      let msg = error.message;
      if (error instanceof FunctionsHttpError) {
        try {
          const txt = await error.context?.text();
          const parsed = txt ? JSON.parse(txt) : null;
          msg = parsed?.error ?? txt ?? msg;
        } catch { /* keep original */ }
      }
      return { ...emptyResult, error: msg };
    }

    // Edge function returns graceful failure with available=false — preserve it
    if (!data) return { ...emptyResult, error: 'No response from eBay visual search' };

    return {
      available: data.available ?? false,
      items: data.items ?? [],
      totalResults: data.totalResults ?? 0,
      topCategory: data.topCategory ?? null,
      categoryDistribution: data.categoryDistribution ?? [],
      marketplace: data.marketplace ?? 'EBAY_GB',
      retrievedAt: data.retrievedAt ?? new Date().toISOString(),
      error: data.error,
      imageHash: imageHash(b64),
    };
  } catch (e: any) {
    return { ...emptyResult, error: e.message ?? 'Unknown error' };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CATEGORY SIGNAL HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Derive a suggested eBay category from visual search results.
 * Returns the most common category if ≥2 items agree.
 */
export function deriveCategorySuggestion(
  result: EbayVisualSearchResult,
): EbayCategorySignal | null {
  if (!result.available || result.items.length === 0) return null;
  if (result.topCategory && result.topCategory.count >= 2) return result.topCategory;
  return null;
}

/**
 * Format a price range label from visual search results.
 * Explicitly marks these as ASKING PRICES, not sold prices.
 */
export function formatAskingPriceRange(items: EbayVisualItem[]): string | null {
  const prices = items
    .map((i) => i.price.value)
    .filter((p) => p > 0)
    .sort((a, b) => a - b);

  if (prices.length === 0) return null;
  if (prices.length === 1) return `£${prices[0].toFixed(2)} (asking)`;

  const low = prices[0];
  const high = prices[prices.length - 1];
  const mid = prices[Math.floor(prices.length / 2)];

  if (low === high) return `£${low.toFixed(2)} (asking)`;
  return `£${low.toFixed(2)}–£${high.toFixed(2)} (asking prices, not sold)`;
}

/**
 * Returns true if the visual search result provides useful category evidence.
 */
export function hasUsefulCategoryEvidence(result: EbayVisualSearchResult): boolean {
  return result.available &&
    result.items.length >= 2 &&
    (result.topCategory?.count ?? 0) >= 2;
}
