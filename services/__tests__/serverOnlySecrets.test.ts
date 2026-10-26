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
    expect(source).toContain(".select('credential_ref, status, access_token_expires_at')");
    expect(source).toContain('conn.access_token_expires_at');
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
    expect(source).toContain('transaction could not be persisted (database constraint).');
    expect(source).toContain('continue;');
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


describe('Checkout request and branded callback regression', () => {
  const checkout = fs.readFileSync(
    path.join(projectRoot, 'supabase/functions/swish-create-checkout/index.ts'),
    'utf8',
  );
  const client = fs.readFileSync(
    path.join(projectRoot, 'services/subscriptionService.ts'),
    'utf8',
  );

  test('rejects unsupported methods and malformed non-empty JSON bodies', () => {
    expect(checkout).toContain('req.method !== "POST"');
    expect(checkout).toContain('JSON.parse(rawBody)');
    expect(checkout).toContain('Invalid checkout request.');
    expect(checkout).toContain('Request body must be a JSON object.');
  });

  test('only accepts canonical product-to-scheme mappings for branded redirects', () => {
    expect(checkout).toContain('expectedSchemeByNiche');
    expect(checkout).toContain('appScheme !== expectedSchemeByNiche[nicheId]');
    expect(checkout).toContain('${callbackScheme}://subscription/success');
    expect(checkout).toContain('${callbackScheme}://subscription/cancel');
    expect(client).toContain('appScheme: Constants.expoConfig?.extra?.swishAppScheme');
  });

  test('does not return raw checkout provider errors to the client', () => {
    expect(checkout).toContain('Unable to start checkout. Please retry or contact support.');
    expect(checkout).not.toContain('JSON.stringify({ error: msg })');
  });
});


describe('Subscription endpoint boundary regression', () => {
  const checker = fs.readFileSync(
    path.join(projectRoot, 'supabase/functions/swish-check-subscription/index.ts'),
    'utf8',
  );

  test('allows only intended methods and requires a bearer token', () => {
    expect(checker).toContain('req.method !== "POST" && req.method !== "GET"');
    expect(checker).toContain('authHeader?.startsWith("Bearer ")');
    expect(checker).toContain('User authentication could not be verified.');
  });

  test('returns a generic client error instead of raw Stripe exception details', () => {
    expect(checker).toContain('Subscription status could not be checked. Please retry.');
    expect(checker).not.toContain('JSON.stringify({ error: msg })');
  });
});


describe('Surplus Flip product-boundary regression', () => {
  const identify = fs.readFileSync(
    path.join(projectRoot, 'supabase/functions/swish-identify/index.ts'),
    'utf8',
  );
  const marketValue = fs.readFileSync(
    path.join(projectRoot, 'supabase/functions/swish-market-value/index.ts'),
    'utf8',
  );

  test('maps Surplus Flip identification requests to their own subscription niche', () => {
    expect(identify).toContain("'surplus_flip' | null");
    expect(identify).toContain("['surplus_flip', 'surplus_trader', 'catalog_flip', 'catalog_surplus'].includes(sid)");
    expect(identify).not.toContain("function nicheForSpecialist(sid: string): 'coins' | 'motocross' | 'bicycles' | 'clothing' | null");
  });

  test('does not classify Surplus Flip valuation items as Coins', () => {
    expect(marketValue).toContain("if (['surplus_flip', 'surplus_trader', 'catalog_flip', 'catalog_surplus'].includes(id)) return 'surplus_flip';");
    expect(marketValue).not.toContain("'jewellery_precious_metals', 'curiosities_collectibles',\n    // Surplus Flip is a distinct product boundary; legacy and current IDs are aliases.\n    'surplus_trader', 'surplus_flip',");
  });
});


describe('SWISH eBay inventory sync tenant write isolation', () => {
  const sync = fs.readFileSync(path.join(projectRoot, 'supabase/functions/swish-ebay-sync/index.ts'), 'utf8');

  test('threads the verified tenant ID through item sync and scopes item/listing writes', () => {
    expect(sync).toContain('existingItem: any,\n  tenantId: string');
    expect(sync).toContain(".eq('item_id', existingItem.id)\n      .eq('tenant_id', tenantId)\n      .eq('marketplace_id', 'ebay')");
    expect(sync).toContain(".eq('id', existingItem.id).eq('tenant_id', tenantId)");
    expect(sync).toContain("syncItemToSwish(supabase, ebay, existingItem, tenantId)");
  });

  test('tenant-scopes orphan listing and item status transitions', () => {
    expect(sync).toContain(".eq('id', l.id).eq('tenant_id', tenantId)");
    expect(sync).toContain(".eq('id', l.item_id).eq('tenant_id', tenantId)");
  });

  test('clears finance scope marker when the restricted eBay sync flow refreshes a token', () => {
    expect(sync).toContain('delete updatedCredentials.financeScopeRefreshedAt');
  });
});


describe('SWISH Stripe account binding', () => {
  const checkout = fs.readFileSync(path.join(projectRoot, 'supabase/functions/swish-create-checkout/index.ts'), 'utf8');
  const subscription = fs.readFileSync(path.join(projectRoot, 'supabase/functions/swish-check-subscription/index.ts'), 'utf8');

  test('checkout creates niche entitlement metadata for the authenticated user and validates product scheme', () => {
    expect(checkout).toContain('metadata: { user_id: user.id, niche_id: nicheId }');
    expect(checkout).toContain('subscription_data:');
    expect(checkout).toContain('if (appScheme && appScheme !== expectedSchemeByNiche[nicheId])');
  });

  test('subscription check refuses a subscription explicitly linked to a different user', () => {
    expect(subscription).toContain('const linkedUserId = sub.metadata?.user_id');
    expect(subscription).toContain('if (linkedUserId && linkedUserId !== user.id)');
    expect(subscription).toContain('Skipping subscription linked to a different user');
  });

  test('subscription lookup never grants access from an email-only Stripe customer match', () => {
    expect(subscription).toContain('stripe.customers.list({ email: user.email, limit: 100 })');
    expect(subscription).toContain('customers.data.find((candidate) => candidate.metadata?.user_id === user.id)');
    expect(subscription).not.toContain('stripe.customers.list({ email: user.email, limit: 1 })');
    expect(subscription).not.toContain('const customerId = customers.data[0].id');
  });

  test('subscription check returns only canonical production niche entitlements', () => {
    expect(subscription).toContain('const allowedNiches = new Set(["coins", "motocross", "bicycles", "clothing", "surplus_flip"])');
    expect(subscription).toContain('niche_entitlements: entitlements');
  });
});


describe('SWISH AI identification tenant and quota safeguards', () => {
  const identify = fs.readFileSync(path.join(projectRoot, 'supabase/functions/swish-identify/index.ts'), 'utf8');

  test('requires a tenant ID and verified membership before performing identification work', () => {
    expect(identify).toContain("typeof bodyTenantId !== 'string' || !bodyTenantId.trim() || bodyTenantId.length > 200");
    expect(identify).toContain(".eq('tenant_id', tenantId)\n      .eq('user_id', user.id)");
    expect(identify).toContain("if (!tenantMembership)");
    expect(identify).toContain("error: 'Access denied for this account.'");
  });

  test('fails closed when the atomic AI usage increment or usage lookup fails', () => {
    expect(identify).toContain("return { count: 0, error: 'Usage tracking is unavailable.' }");
    expect(identify).toContain("error: 'USAGE_TRACKING_UNAVAILABLE'");
    expect(identify).toContain('if (usageCount > FREE_MONTHLY_QUOTA)');
    expect(identify).toContain('The atomic RPC result is authoritative.');
    expect(identify).toContain("if (error) throw new Error('AI usage lookup failed.')");
    expect(identify).not.toContain("return { count: Number(row?.count ?? 1), error: null }");
  });

  test('does not roll quota counters backward over a concurrent request', () => {
    expect(identify).toContain(".eq('count', currentUsage + 1)");
  });

  test('checks active and trialing subscription state and verifies linked user metadata', () => {
    expect(identify).toContain("if (sub.status !== 'active' && sub.status !== 'trialing') continue;");
    expect(identify).toContain('const linkedUserId = sub.metadata?.user_id');
    expect(identify).toContain('if (linkedUserId && linkedUserId !== userId) continue;');
    expect(identify).toContain("if (subscribedNiche === 'surplus_trader') subscribedNiche = 'surplus_flip';");
  });

  test('does not send raw unhandled or AI-provider errors back to the client', () => {
    expect(identify).toContain("error: 'Identification request failed. Please retry.'");
    expect(identify).toContain("error: 'Identification service is temporarily unavailable. Please retry.'");
    expect(identify).not.toContain("JSON.stringify({ error: err.message ?? 'Internal error' })");
  });
});


describe('Credential migration tenant isolation', () => {
  const migration = fs.readFileSync(path.join(projectRoot, 'supabase/functions/swish-migrate-credentials/index.ts'), 'utf8');

  test('requires one tenant ID and rejects cross-tenant migration requests', () => {
    expect(migration).toContain('A tenantId is required. Migrate one tenant at a time.');
    expect(migration).toContain("query = query.eq('tenant_id', tenantId)");
    expect(migration).not.toContain('cross-tenant migration');
    expect(migration).not.toContain(".eq('user_id', user.id)\n      .in('role', ['owner', 'admin'])");
  });
});


describe('Stripe customer portal account isolation', () => {
  const portal = fs.readFileSync(path.join(projectRoot, 'supabase/functions/swish-customer-portal/index.ts'), 'utf8');

  test('requires a verified Bearer token and a Stripe customer linked to the authenticated user', () => {
    expect(portal).toContain('!authHeader.startsWith("Bearer ")');
    expect(portal).toContain('candidate.metadata?.user_id === user.id');
    expect(portal).not.toContain('customers.data[0].id');
  });

  test('does not return provider/internal error messages to clients', () => {
    expect(portal).toContain('Unable to open billing management. Please retry or contact support.');
    expect(portal).not.toContain('JSON.stringify({ error: msg })');
  });
});


describe('Stripe checkout customer isolation', () => {
  const checkout = fs.readFileSync(path.join(projectRoot, 'supabase/functions/swish-create-checkout/index.ts'), 'utf8');

  test('only reuses a Stripe customer linked to this user or an unlinked customer', () => {
    expect(checkout).toContain('candidate.metadata?.user_id === user.id');
    expect(checkout).toContain('!candidate.metadata?.user_id');
    expect(checkout).toContain('metadata: { user_id: user.id }');
    expect(checkout).not.toContain('customers.data[0].id');
  });
});
