// Static security regressions: inspect source code only, never secret values.
// Run with: npx jest --config jest.config.ci.js --runInBand services/__tests__/serverOnlySecrets.test.ts
import * as fs from 'fs';
import * as path from 'path';

const projectRoot = path.resolve(__dirname, '../..');
const clientDirectories = ['app', 'services', 'hooks', 'contexts', 'components', 'constants', 'template', 'plugins'];
const secretNames = [
  'EBAY_SIGNATURE_KEY_JWE', 'EBAY_SIGNATURE_PRIVATE_KEY',
  'EBAY_CLIENT_SECRET', 'EBAY_CLIENT_ID', 'SWISH_CREDENTIAL_KEY',
  'ONSPACE_AI_API_KEY', 'ONSPACE_AI_KEY', 'STRIPE_SECRET_KEY',
  'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_DB_URL', 'NUMISTA_API_KEY',
];
const allowedPublicVariables = new Set(['EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_ANON_KEY']);

function sourceFiles(directory: string): string[] {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (['__tests__', '__mocks__'].includes(entry.name)) return [];
    const location = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(location);
    return /\.(?:js|jsx|ts|tsx|json)$/.test(entry.name) ? [location] : [];
  });
}

const files = [
  ...clientDirectories.flatMap(directory => sourceFiles(path.join(projectRoot, directory))),
  ...['app.config.js', 'app.json'].map(name => path.join(projectRoot, name)),
];

function findViolations(check: (source: string) => boolean): string[] {
  return files.filter(file => check(fs.readFileSync(file, 'utf8')))
    .map(file => path.relative(projectRoot, file));
}

describe('Server-only API secret boundary', () => {
  test('client source and public Expo config contain no server secret references', () => {
    expect(findViolations(source => secretNames.some(name => source.includes(name)))).toEqual([]);
  });

  test('only Supabase URL and publishable anon key may use EXPO_PUBLIC variables', () => {
    expect(findViolations(source => {
      const names = source.match(/\bEXPO_PUBLIC_[A-Z0-9_]+\b/g) ?? [];
      return names.some(name => !allowedPublicVariables.has(name));
    })).toEqual([]);
  });

  test('client source cannot import Edge Function modules or read Deno secrets', () => {
    expect(findViolations(source =>
      /(?:from\s*|import\s*\(|require\s*\()\s*['"][^'"]*supabase\/functions\//.test(source) ||
      /\bDeno\s*\.\s*env\b/.test(source),
    )).toEqual([]);
  });

  test('eBay signing reads both keys exclusively from server environment variables', () => {
    const signing = fs.readFileSync(path.join(projectRoot, 'supabase/functions/_shared/ebayDigitalSignature.ts'), 'utf8');
    expect(signing).toContain("Deno.env.get('EBAY_SIGNATURE_PRIVATE_KEY')");
    expect(signing).toContain("Deno.env.get('EBAY_SIGNATURE_KEY_JWE')");
    expect(signing).not.toContain('process.env');
    const finances = fs.readFileSync(path.join(projectRoot, 'supabase/functions/swish-ebay-finances/index.ts'), 'utf8');
    expect(finances).toContain("from '../_shared/ebayDigitalSignature.ts'");
    expect(finances).toContain('...hdrs, ...signatureHeaders');
  });
});

describe('SWISH eBay Finances input and refresh safety', () => {
  const functionPath = path.join(projectRoot, 'supabase/functions/swish-ebay-finances/index.ts');
  const source = fs.readFileSync(functionPath, 'utf8');

  test('validates request-object, route, and date-window inputs before calling the eBay API', () => {
    expect(source).toContain('Request body must be a JSON object.');
    expect(source).toContain("new Set(['sync_transactions', 'get_payouts', 'get_funds_summary', 'get_summary'])");
    expect(source).toContain('daysBack < 1 || daysBack > 365');
    expect(source).toContain('Unsupported finances route.');
  });

  test('does not silently ignore a token refresh failure and then use the stale token', () => {
    expect(source).toContain('eBay token refresh failed. Please retry.');
    expect(source).toContain('eBay authorisation is no longer valid. Reconnect eBay and retry.');
    expect(source).not.toMatch(/catch\s*\{\s*\}/);
  });

  test('scopes order lookups and updates by both order ID and tenant ID', () => {
    expect(source).toContain(".eq('id', swishOrderId).eq('tenant_id', tenantId).maybeSingle()");
    expect(source).toContain(".eq('id', swishOrderId).eq('tenant_id', tenantId);");
  });

  test('counts transaction updates only when an existing transaction was found', () => {
    expect(source).toContain(".eq('tenant_id', tenantId)\n            .eq('ebay_transaction_id', txId)");
    expect(source).toContain('else if (existingTx)');
    expect(source).not.toContain("if (ue) { if (ue.code === '23505') updated++");
  });

  test('does not return raw internal failures in the HTTP response', () => {
    expect(source).toContain('Financial request failed. Please retry; contact support if the issue continues.');
    expect(source).not.toContain("return jr({ error: err.message ?? 'Internal error' }, 500)");
  });
});


describe('SWISH eBay finance scope refresh coordination', () => {
  const finance = fs.readFileSync(path.join(projectRoot, 'supabase/functions/swish-ebay-finances/index.ts'), 'utf8');
  const sync = fs.readFileSync(path.join(projectRoot, 'supabase/functions/swish-ebay-sync/index.ts'), 'utf8');

  test('finance API restores broad scopes only when its encrypted marker is absent or token is near expiry', () => {
    expect(finance).toContain("isEncrypted(conn.credential_ref)");
    expect(finance).toContain('needsFinanceScopeRefresh');
    expect(finance).toContain('financeScopeRefreshedAt: new Date().toISOString()');
    expect(finance).toContain('needsRefresh || (needsFinanceScopeRefresh && hasRefreshCredentials)');
  });

  test('scope-restricted sync refresh clears the finance-scope marker', () => {
    expect(sync).toContain("scope: 'https://api.ebay.com/oauth/api_scope/sell.inventory https://api.ebay.com/oauth/api_scope/sell.fulfillment https://api.ebay.com/oauth/api_scope/sell.account'");
    expect(sync).toContain('delete updatedCredentials.financeScopeRefreshedAt');
  });

  test('temporary token-service failures are retryable, not falsely marked as reauthentication-required', () => {
    expect(finance).toContain("Unable to reach eBay token service. Please retry.");
    expect(finance).toContain("requiresReauth: reauth");
    expect(finance).toContain("reauth ? 400 : 503");
  });
});


describe('Niche-scoped Stripe entitlement regression', () => {
  const subscriptionService = fs.readFileSync(
    path.join(projectRoot, 'services/subscriptionService.ts'),
    'utf8',
  );
  const subscriptionHook = fs.readFileSync(
    path.join(projectRoot, 'hooks/useSubscription.ts'),
    'utf8',
  );

  test('preserves only canonical server-reported niche entitlements', () => {
    expect(subscriptionService).toContain('niche_entitlements?: unknown');
    expect(subscriptionService).toContain('isProductionNiche(id)');
    expect(subscriptionService).toContain('nicheEntitlements: ProductionNicheId[]');
  });

  test('does not grant a Stripe subscription premium access to every niche', () => {
    expect(subscriptionService).toContain('return status.nicheEntitlements.includes(activeNicheId);');
    expect(subscriptionService).not.toContain('return status.productId === STRIPE_PRODUCT_ID;');
  });

  test('evaluates Stripe premium access against the active niche', () => {
    expect(subscriptionHook).toContain('activeNicheId');
    expect(subscriptionHook).toContain('isPremiumSubscriber(subscriptionStatus, subscriptionTier, activeNicheId)');
  });
});
