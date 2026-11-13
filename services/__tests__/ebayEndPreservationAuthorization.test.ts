const fs = require('node:fs');
const path = require('node:path');

describe('eBay end inventory preservation authorization', () => {
  test('owner preservation is verified server-side before any eBay end request', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../supabase/functions/swish-ebay-list/index.ts'), 'utf8');
    const routeStart = source.indexOf("if (route === 'end')");
    const ownerGuard = source.indexOf("supabase.rpc('swish_owner_for_user'", routeStart);
    const providerCall = source.indexOf('callEbayTradingApi(endXml, callName', routeStart);

    expect(routeStart).toBeGreaterThan(-1);
    expect(ownerGuard).toBeGreaterThan(routeStart);
    expect(ownerGuard).toBeLessThan(providerCall);
    expect(source).toContain("{ p_user_id: auth.userId }");
    expect(source).toContain('ownerError || trustedOwner !== true');
    expect(source).toContain("Owner-only inventory preservation is not authorised.");
  });
});
