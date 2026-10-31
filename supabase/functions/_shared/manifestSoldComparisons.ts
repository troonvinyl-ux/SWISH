export interface ManifestSoldItem {
  id: string;
  title: string;
  price: number;
  currency: 'GBP';
  soldDate: string;
  condition: string;
  url: string;
  imageUrl: string;
}
export interface ManifestSoldComparisons {
  status: 'available' | 'empty' | 'unavailable';
  items: ManifestSoldItem[];
  message: string;
  checkedAt: string;
}
const unavailable = (message = 'Sold prices are unavailable. Check sold listings on eBay instead.'): ManifestSoldComparisons => ({
  status: 'unavailable', items: [], message, checkedAt: new Date().toISOString(),
});
export async function fetchManifestSoldComparisons(clientId: string, clientSecret: string, query: string): Promise<ManifestSoldComparisons> {
  if (!clientId || !clientSecret || typeof query !== 'string' || query.trim().length < 3 || query.length > 100) return unavailable();
  try {
    const tokenResponse = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ grant_type: 'client_credentials', scope: 'https://api.ebay.com/oauth/api_scope/buy.marketplace.insights' }).toString(),
      signal: AbortSignal.timeout(10000),
    });
    if (!tokenResponse.ok) return unavailable();
    const token = await tokenResponse.json();
    if (typeof token.access_token !== 'string' || !token.access_token) return unavailable();
    const params = new URLSearchParams({ q: query.trim().slice(0, 100), limit: '50' });
    const response = await fetch(`https://api.ebay.com/buy/marketplace_insights/v1_beta/item_sales/search?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token.access_token}`, Accept: 'application/json', 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB' },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) return unavailable();
    const data = await response.json();
    const raw = data.itemSales ?? data.itemSummaries ?? data.items ?? data.sales ?? [];
    const seen = new Set<string>();
    const items: ManifestSoldItem[] = (Array.isArray(raw) ? raw : []).flatMap((item: any) => {
      const id = String(item.itemId ?? item.legacyItemId ?? '');
      const title = String(item.title ?? item.itemTitle ?? '').trim().slice(0, 180);
      const soldDate = String(item.lastSoldDate ?? item.soldDate ?? item.saleDate ?? item.lastSoldDateTime ?? '');
      const priceValue = Number(item.lastSoldPrice?.value ?? item.price?.value ?? item.soldPrice?.value ?? 0);
      const currency = String(item.lastSoldPrice?.currency ?? item.price?.currency ?? item.soldPrice?.currency ?? item.currency ?? '');
      if (!id || seen.has(id) || !title || currency !== 'GBP' || !Number.isFinite(priceValue) || priceValue <= 0 || !soldDate || !Number.isFinite(Date.parse(soldDate))) return [];
      seen.add(id);
      return [{
        id, title, price: priceValue, currency: 'GBP' as const, soldDate,
        condition: String(item.condition ?? item.conditionId ?? '').slice(0, 100),
        url: typeof item.itemWebUrl === 'string' ? item.itemWebUrl : typeof item.itemUrl === 'string' ? item.itemUrl : '',
        imageUrl: typeof item.image?.imageUrl === 'string' ? item.image.imageUrl : typeof item.imageUrl === 'string' ? item.imageUrl : '',
      }];
    }).slice(0, 8);
    return {
      status: items.length ? 'available' : 'empty', items, checkedAt: new Date().toISOString(),
      message: items.length ? 'Similar sold items. Check model, condition and quantity.' : 'No comparable sold prices found. Try a shorter product name.',
    };
  } catch {
    return unavailable();
  }
}
