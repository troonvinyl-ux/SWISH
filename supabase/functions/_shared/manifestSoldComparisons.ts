// Real sold-item API only. Never substitute Browse asking prices or AI estimates.
export async function fetchManifestSoldComparisons(clientId: string, clientSecret: string, query: string) {
  const empty = { status: 'unavailable', source: 'ebay_marketplace_insights', query, items: [], checkedAt: new Date().toISOString(), message: 'Sold prices are unavailable right now. You can check sold listings on eBay.' };
  try {
    const tokenResponse = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
      method: 'POST', headers: { Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', scope: 'https://api.ebay.com/oauth/api_scope/buy.marketplace.insights' }).toString(),
      signal: AbortSignal.timeout(8000),
    });
    if (!tokenResponse.ok) {
      console.log(`[Manifest sold] Token request HTTP ${tokenResponse.status}`);
      return { ...empty, message: 'eBay sold-price access is not enabled for this app. Check sold listings on eBay instead.' };
    }
    const token = await tokenResponse.json();
    if (!token.access_token) return empty;
    const params = new URLSearchParams({ q: query, limit: '20' });
    const response = await fetch(`https://api.ebay.com/buy/marketplace_insights/v1_beta/item_sales/search?${params}`, {
      headers: { Authorization: `Bearer ${token.access_token}`, Accept: 'application/json', 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB' },
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) {
      console.log(`[Manifest sold] Item sales HTTP ${response.status}`);
      return { ...empty, message: [401,403,404].includes(response.status) ? 'eBay has not made sold-price access available to this app. Check sold listings on eBay instead.' : empty.message };
    }
    const data = await response.json();
    if (!Array.isArray(data.itemSales)) return empty;
    const seen = new Set<string>();
    const items = data.itemSales.map((item: any) => ({
      id: String(item.itemId ?? ''), title: String(item.title ?? '').slice(0,180),
      price: Number(item.lastSoldPrice?.value), currency: String(item.lastSoldPrice?.currency ?? ''),
      soldDate: String(item.lastSoldDate ?? ''), condition: String(item.condition ?? ''),
      url: String(item.itemWebUrl ?? ''), imageUrl: String(item.image?.imageUrl ?? ''),
    })).filter((item: any) => {
      if (!item.id || !item.title || !Number.isFinite(item.price) || item.price <= 0 || item.currency !== 'GBP' || !Number.isFinite(Date.parse(item.soldDate)) || seen.has(item.id)) return false;
      seen.add(item.id); return true;
    }).slice(0,8);
    return { ...empty, status: items.length ? 'available' : 'empty', items,
      message: items.length ? 'Similar sold items. Check the model, condition and quantity; these are not confirmed matches.' : 'No comparable GBP sold prices were returned. Try a shorter product name.' };
  } catch {
    console.error('[Manifest sold] Sold-price search unavailable');
    return empty;
  }
}
