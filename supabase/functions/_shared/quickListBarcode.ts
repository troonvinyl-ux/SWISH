// eBay Browse product discovery through the existing application-token path.
// Exact barcode leads only: never copy seller photographs, physical condition or asking prices.
export function catalogueGtin(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  let code = value.trim().replace(/[\s-]/g, '');
  if (/^\d{9}[\dX]$/i.test(code)) {
    if (code.split('').reduce((sum, digit, index) => sum + (digit.toUpperCase() === 'X' ? 10 : Number(digit)) * (10 - index), 0) % 11 !== 0) return null;
    const base = '978' + code.slice(0, 9);
    code = base + String((10 - base.split('').reduce((sum, digit, index) => sum + Number(digit) * (index % 2 ? 3 : 1), 0) % 10) % 10);
  }
  if (!/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(code)) return null;
  const digits = code.split('').map(Number), check = digits.pop();
  return (10 - digits.reverse().reduce((sum, digit, index) => sum + digit * (index % 2 === 0 ? 3 : 1), 0) % 10) % 10 === check ? code : null;
}

export async function lookupBarcodeProducts(token: string, gtin: string, requestFetch: typeof fetch = fetch) {
  const unavailable = (message: string) => ({ products: [] as Array<Record<string, any>>, status: 'unavailable', message });
  const requested = catalogueGtin(gtin);
  if (!requested) return { products: [], status: 'invalid', message: 'Valid product GTIN required.' };
  const headers = { Authorization: `Bearer ${token}`, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB', Accept: 'application/json' };
  try {
    const search = async (parameter: 'gtin' | 'q') => {
      const response = await requestFetch(`https://api.ebay.com/buy/browse/v1/item_summary/search?${parameter}=${encodeURIComponent(requested)}&limit=6`, { headers, signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error(`eBay barcode search HTTP ${response.status}. Try again or use photos.`);
      const data = await response.json();
      if (Array.isArray(data.errors) && data.errors.length) throw new Error('eBay could not complete the barcode search. Try again or use photos.');
      return Array.isArray(data.itemSummaries) ? data.itemSummaries.slice(0, 6) : [];
    };
    let summaries = await search('gtin');
    // Some seller listings index the EAN/ISBN in item specifics rather than the GTIN search index.
    // Numeric keyword discovery alone is NEVER sufficient: the item barcode is still verified below.
    if (!summaries.length) summaries = await search('q');
    let failures = 0;
    const details = await Promise.all(summaries.map(async (row: any) => {
      if (typeof row?.itemId !== 'string' || !/^v1\|\d+\|\d+$/.test(row.itemId)) return null;
      try {
        const response = await requestFetch(`https://api.ebay.com/buy/browse/v1/item/${encodeURIComponent(row.itemId)}`, { headers, signal: AbortSignal.timeout(4000) });
        if (!response.ok) { failures++; return null; }
        const item = await response.json();
        if (item.itemId !== row.itemId || typeof item.title !== 'string' || !item.title.trim()) { failures++; return null; }
        const aspects = Array.isArray(item.localizedAspects) ? item.localizedAspects : [];
        const identifiers = [item.gtin, ...aspects.filter((field: any) => /^(?:EAN|UPC|ISBN(?:[ -]?(?:10|13))?|GTIN(?:[ -]?14)?|Barcode)$/i.test(String(field?.name ?? '').trim())).map((field: any) => field.value)]
          .map(catalogueGtin).filter((code): code is string => code !== null);
        // Do not merge contradictory variants even when one of the identifiers happens to match.
        if (!identifiers.length || identifiers.some(code => code.padStart(14, '0') !== requested.padStart(14, '0'))) return null;
        const specifics: Record<string, string> = {};
        for (const field of aspects) if (typeof field?.name === 'string' && typeof field.value === 'string' && field.name.length <= 65 && field.value.length <= 65 && !/condition|seller|warranty/i.test(field.name)) specifics[field.name] = field.value;
        const brand = String(item.brand ?? specifics.Brand ?? ''), model = String(item.mpn ?? specifics.Model ?? '');
        return { id: String(item.itemId), title: item.title.trim().slice(0, 180), gtin: requested, brand, model, categoryId: String(item.categoryId ?? ''), categoryName: String(item.categoryPath ?? ''), specifics, source: 'eBay Browse', url: String(item.itemWebUrl ?? '') };
      } catch { failures++; return null; }
    }));
    const unique = new Map<string, NonNullable<typeof details[number]>>();
    for (const product of details) if (product) {
      const variant = JSON.stringify([product.title, product.brand, product.model, Object.entries(product.specifics).sort(([a], [b]) => a.localeCompare(b))]);
      if (!unique.has(variant)) unique.set(variant, product);
    }
    console.log(`[SWISH barcode] eBay UK: ${summaries.length} listings, ${unique.size} verified leads, ${failures} detail failures`);
    if (!unique.size && failures) return unavailable('eBay results were found but their details could not be loaded. Try again or use photos.');
    return { products: [...unique.values()], status: unique.size ? 'candidates' : 'no_match', source: 'eBay Browse', message: unique.size ? 'eBay UK barcode results. Check the physical item in your photos.' : 'No matching barcode data in eBay UK. Try another barcode or use photos.' };
  } catch (cause) {
    return unavailable(cause instanceof Error && /^eBay /.test(cause.message) ? cause.message : 'eBay barcode lookup timed out or could not connect. Try again or use photos.');
  }
}
