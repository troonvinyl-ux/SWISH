// Source regressions for the targeted agreement-gate removal, not live eBay tests.
import fs from 'node:fs';
import path from 'node:path';
const source = (file: string) => fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8');

describe('Discogs provenance does not block music listing operations', () => {
  const scope = source('supabase/functions/_shared/moduleScope.ts');
  test('middleware does not turn missing agreement approval into a listing denial', () => {
    expect(scope).not.toContain('DISCOGS_COMMERCIAL_USE_APPROVED');
    expect(scope).not.toContain('Music metadata permission check unavailable.');
    expect(scope).not.toContain('Discogs-derived marketplace use awaits');
    expect(scope).not.toContain('attributes?.discogs_release_id');
  });
  test.each(['swish-list-generate', 'swish-ebay-list'])('%s retains the shared authorization wrapper', (name) => {
    expect(source(`supabase/functions/${name}/index.ts`)).toContain('serveModule(');
  });
  test('authentication, entitlement and resource ownership still precede handler execution', () => {
    const handler = scope.indexOf('return handler(new Request(');
    expect(handler).toBeGreaterThan(-1);
    // No provenance rewrites or client-side approval grants accompany removal.
    expect(scope).not.toContain('.update(');
    expect(scope).not.toContain('.insert(');
    for (const guard of ['Session verification failed.', 'Account differs from the active module.', 'Niche differs from the authorized module.', 'Specialist belongs to another module.', 'Active module entitlement could not be verified.', 'Resource is not in the active account and niche.', 'Resource set crosses module boundaries.']) {
      expect(scope.indexOf(guard)).toBeGreaterThan(-1);
      expect(scope.indexOf(guard)).toBeLessThan(handler);
    }
    expect(scope).toContain("rpc('swish_can_access_niche'");
  });
  test('seller actions retain independent stored-item authorization and review', () => {
    for (const name of ['swish-list-generate', 'swish-ebay-list']) {
      const handler = source(`supabase/functions/${name}/index.ts`);
      expect(handler).toContain('await requirePaidNiche(');
      expect(handler).toContain('evaluateSpecialistSafety');
    }
  });
  test('Tunes Flip checkout stays disabled before any Stripe customer or session creation', () => {
    const checkout = source('supabase/functions/swish-create-checkout/index.ts');
    const denial = checkout.indexOf('Tunes Flip is currently free and will remain free');
    expect(denial).toBeGreaterThan(-1);
    expect(denial).toBeLessThan(checkout.indexOf('const stripe = new Stripe('));
    expect(checkout).toContain('["tunes_flip", "tunes-flip", "music", "vinyl_records"].includes(nicheId)');
    expect(checkout).not.toContain('DISCOGS_COMMERCIAL_USE_APPROVED');
  });
  test('catalogue permissions are not fabricated by changing listing access', () => {
    const gateway = source('supabase/functions/swish-discogs/index.ts');
    expect(gateway).toContain("Deno.env.get('DISCOGS_COMMERCIAL_USE_APPROVED')==='true'");
    expect(gateway).toContain('restrictedDataExcluded:true');
    expect(gateway).toContain('DISCOGS_USAGE_REVIEW_REQUIRED');
  });
});
