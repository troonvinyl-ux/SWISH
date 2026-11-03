const fs = require('node:fs');
const path = require('node:path');

describe('eBay end inventory preservation authorization', () => {
  test('owner preservation is verified server-side before any eBay end request', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../supabase/functions/swish-ebay-list/index.ts'), 'utf8');
    const routeStart = source.indexOf("if (route === 'end')");
    const ownerGuard = source.indexOf('SWISH_MASTER_ADMIN_EMAIL', routeStart);
    const providerCall = source.indexOf("callEbayTradingApi(endXml, 'EndFixedPriceItem'", routeStart);

    expect(routeStart).toBeGreaterThan(-1);
    expect(ownerGuard).toBeGreaterThan(routeStart);
    expect(ownerGuard).toBeLessThan(providerCall);
    expect(source).toContain("auth.userEmail.trim().toLowerCase() !== configuredOwnerEmail");
    expect(source).toContain("if (!configuredOwnerEmail || !auth.userEmail");
    expect(source).toContain("Owner-only inventory preservation is not authorised.");
  });
});
