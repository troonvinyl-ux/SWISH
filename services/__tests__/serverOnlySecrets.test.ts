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

describe('Credential encryption fail-closed regression', () => {
  const cryptoSource = fs.readFileSync(
    path.join(projectRoot, 'supabase/functions/_shared/credentialCrypto.ts'),
    'utf8',
  );
  const migrationSource = fs.readFileSync(
    path.join(projectRoot, 'supabase/functions/swish-migrate-credentials/index.ts'),
    'utf8',
  );

  test('normal credential decryption rejects plaintext instead of accepting a legacy fallback', () => {
    expect(cryptoSource).toContain('Plaintext credential_ref rejected');
    expect(cryptoSource).toContain('if (!isEncrypted(stored))');
    expect(cryptoSource).not.toContain('MIGRATION REQUIRED: credential_ref is unencrypted plaintext');
  });

  test('legacy plaintext parsing is confined to the explicit migration helper', () => {
    expect(cryptoSource).toContain('function parseLegacyCredentials');
    expect(cryptoSource).toContain('const credentials = parseLegacyCredentials(stored)');
    expect(migrationSource).toContain('migrateToEncrypted');
    expect(migrationSource).toContain(".eq('tenant_id', row.tenant_id)");
  });

  test('migration errors do not include credential payloads in responses or logs', () => {
    expect(cryptoSource).toContain('Legacy credential payload is not valid JSON object data');
    expect(cryptoSource).not.toContain('console.log(credentials)');
    expect(migrationSource).toContain('Row encryption failed');
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

  test('sync token refresh preserves the consented scope set and records refresh metadata', () => {
    expect(sync).toContain('Omit scope: preserve the full consented permissions, including finances.');
    expect(sync).toContain('financeScopeRefreshedAt: new Date().toISOString()');
    expect(sync).not.toContain('delete updatedCredentials.financeScopeRefreshedAt');
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
    expect(checkout).toContain('requestedScheme !== expectedScheme');
    expect(checkout).toContain('${callbackScheme}://subscription/success');
    expect(checkout).toContain('${callbackScheme}://subscription/cancel');
    expect(client).toContain('const resolvedScheme = appScheme ?? Constants.expoConfig?.extra?.swishAppScheme');
    expect(client).toContain('{ nicheId, appScheme: resolvedScheme }');
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

});


describe('SWISH Stripe account binding', () => {
  const checkout = fs.readFileSync(path.join(projectRoot, 'supabase/functions/swish-create-checkout/index.ts'), 'utf8');
  const subscription = fs.readFileSync(path.join(projectRoot, 'supabase/functions/swish-check-subscription/index.ts'), 'utf8');

  test('checkout creates niche entitlement metadata for the authenticated user and validates product scheme', () => {
    expect(checkout).toContain('metadata: { user_id: user.id, niche_id: nicheId }');
    expect(checkout).toContain('subscription_data:');
    expect(checkout).toContain('if (requestedScheme && requestedScheme !== expectedScheme)');
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

  test('legacy subscription auto-link requires a confirmed account and one unambiguous live SWISH customer', () => {
    expect(subscription).toContain('customers.data.find((candidate) => candidate.metadata?.user_id === user.id)');
    expect(subscription).not.toContain('customers.data[0].id');
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
    expect(identify).toContain("if (membershipError || !tenantMembership)");
    expect(identify).toContain("error: 'Access denied for this account.'");
  });

  test('fails closed when the atomic AI usage increment or usage lookup fails', () => {
    expect(identify).toContain("return { count: 0, error: 'Usage tracking is unavailable.' }");
    expect(identify).toContain("error: 'USAGE_TRACKING_UNAVAILABLE'");
    expect(identify).toContain('if (usageResult.count > FREE_MONTHLY_QUOTA)');
    expect(identify).toContain('The atomic RPC result is authoritative.');
    expect(identify).toContain("if (error) throw new Error('AI usage lookup failed.')");
    expect(identify).not.toContain("return { count: Number(row?.count ?? 1), error: null }");
  });

  test('does not roll quota counters backward over a concurrent request', () => {
    expect(identify).toContain("admin.rpc(\n    'upsert_ai_usage'");
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

  test('legacy billing customer linking is confirmed, subscription-backed, and ambiguity-safe', () => {
    expect(portal).toContain('if (!customer && user.email_confirmed_at)');
    expect(portal).toContain('eligibleLegacyCustomers.length === 1');
    expect(portal).toContain("sub.metadata.user_id === user.id");
    expect(portal).toContain('stripe.customers.update(eligibleLegacyCustomers[0].id');
  });

  test('does not return provider/internal error messages to clients', () => {
    expect(portal).toContain('Unable to open billing management. Please retry or contact support.');
    expect(portal).not.toContain('JSON.stringify({ error: msg })');
  });
});


describe('Stripe checkout customer isolation', () => {
  const checkout = fs.readFileSync(path.join(projectRoot, 'supabase/functions/swish-create-checkout/index.ts'), 'utf8');

  test('checkout reuses only a Stripe customer explicitly linked to this user', () => {
    expect(checkout).toContain('candidate.metadata?.user_id === user.id');
    expect(checkout).toContain('metadata: { user_id: user.id }');
    expect(checkout).not.toContain('!candidate.metadata?.user_id');
    expect(checkout).not.toContain('stripe.customers.update(unlinkedCustomer.id');
    expect(checkout).not.toContain('customers.data[0].id');
  });
});


describe('SWISH eBay OAuth error boundary', () => {
  const oauth = fs.readFileSync(
    path.join(projectRoot, 'supabase/functions/swish-ebay-oauth/index.ts'),
    'utf8',
  );

  test('does not return raw database error details from OAuth setup to clients', () => {
    expect(oauth).toContain("error: 'Unable to save eBay connection setup. Please retry or contact support.'");
    expect(oauth).toContain("error: 'Unable to start eBay authorization. Please retry or contact support.'");
    expect(oauth).not.toContain('error: `Database error: ${upsertErr.message}`');
    expect(oauth).not.toContain('error: `Could not create OAuth session: ${sessionErr.message}`');
  });
});


describe('eBay connector error response safety', () => {
  const messages = fs.readFileSync(path.join(projectRoot, 'supabase/functions/swish-ebay-messages/index.ts'), 'utf8');
  const listing = fs.readFileSync(path.join(projectRoot, 'supabase/functions/swish-ebay-list/index.ts'), 'utf8');
  const fulfilment = fs.readFileSync(path.join(projectRoot, 'supabase/functions/swish-ebay-post-order/index.ts'), 'utf8');

  test('does not include credential-decryption exception text in client errors', () => {
    expect(messages).toContain('Unable to read eBay connection securely.');
    expect(listing).toContain('Unable to read eBay connection securely.');
    expect(fulfilment).toContain('Unable to read eBay connection securely.');
    expect(messages).not.toContain('eBay credentials are corrupted: ${e.message}');
    expect(listing).not.toContain('eBay credentials are corrupted: ${e.message}');
    expect(fulfilment).not.toContain('eBay credentials corrupted: ${e.message}');
  });

  test('uses generic client responses for unhandled provider failures', () => {
    expect(messages).toContain('Unable to complete the eBay messages request.');
    expect(listing).toContain('Unable to complete the eBay listing request.');
    expect(fulfilment).toContain('Unable to complete the eBay fulfilment request.');
    expect(messages).not.toContain("return jsonResponse({ error: e.message ?? 'Internal server error' }, 500)");
    expect(fulfilment).not.toContain("return jsonResponse({ error: err.message ?? 'Internal error' }, 500)");
  });
});


describe('AI Edge Function error response safety', () => {
  const decompose = fs.readFileSync(path.join(projectRoot, 'supabase/functions/swish-decompose/index.ts'), 'utf8');
  const islamicIdentify = fs.readFileSync(path.join(projectRoot, 'supabase/functions/swish-islamic-identify/index.ts'), 'utf8');

  test('decomposition does not return provider error bodies or raw model output', () => {
    expect(decompose).toContain('The decomposition service is temporarily unavailable.');
    expect(decompose).toContain('The decomposition service returned an invalid response.');
    expect(decompose).not.toContain('JSON.stringify({ error: `OnSpace AI: ${errText}` })');
    expect(decompose).not.toContain("JSON.stringify({ error: 'AI returned invalid JSON', raw: rawContent })");
    expect(decompose).not.toContain("JSON.stringify({ error: err.message ?? 'Internal error' })");
  });

  test('Islamic identification does not return provider error bodies or raw exceptions', () => {
    expect(islamicIdentify).toContain('The identification service is temporarily unavailable.');
    expect(islamicIdentify).toContain('Unable to complete Islamic coin identification.');
    expect(islamicIdentify).not.toContain('OnSpace AI error: ${errText}');
    expect(islamicIdentify).not.toContain('OnSpace AI retry error: ${errText}');
    expect(islamicIdentify).not.toContain("JSON.stringify({ error: err.message ?? 'Internal error' })");
  });
});



describe('SWISH rendered coin reference separation', () => {
  const identificationService = fs.readFileSync(
    path.join(projectRoot, 'services/aiIdentificationService.ts'),
    'utf8',
  );

  test('rendered references are stored in attributes and not canonical listing media', () => {
    const start = identificationService.indexOf('export async function saveCoinReferenceImages(');
    const end = identificationService.indexOf('export async function saveIdentifiedItem(', start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const implementation = identificationService.slice(start, end);
    expect(implementation).toContain('attributes: { ...attributes, _coin_reference_images: { ...existing, ...urls } }');
    expect(implementation).toContain(".eq('tenant_id', tenantId)");
    expect(implementation).toContain('/references/');
    expect(implementation).not.toContain('media:');
    expect(implementation).not.toContain("from('ebay'");
  });
});

describe('SWISH market valuation error sanitization', () => {
  const marketValue = fs.readFileSync(
    path.join(projectRoot, 'supabase/functions/swish-market-value/index.ts'),
    'utf8',
  );

  test('does not return raw authentication exceptions or log credential decryption details', () => {
    expect(marketValue).toContain("error: 'Authentication could not be verified.'");
    expect(marketValue).toContain("Credential decryption failed.");
    expect(marketValue).not.toContain('Auth error: ${e.message}');
    expect(marketValue).not.toContain('Credential decrypt error: ${e.message}');
  });
});


describe('SWISH coin image enhancement provider error safety', () => {
  const imageEnhance = fs.readFileSync(
    path.join(projectRoot, 'supabase/functions/swish-coin-image-enhance/index.ts'),
    'utf8',
  );

  test('does not log raw AI provider response bodies', () => {
    expect(imageEnhance).toContain("console.error('[swish-coin-image-enhance] model request failed', response.status)");
    expect(imageEnhance).not.toContain("response.text()).slice(0, 500)");
    expect(imageEnhance).not.toContain("response.status, detail");
  });

  test('requires an authenticated user and bounds image input size', () => {
    expect(imageEnhance).toContain("await userClient.auth.getUser()");
    expect(imageEnhance).toContain('imageDataUrl.length > 8_000_000');
    expect(imageEnhance).toContain("A base64 image data URL is required.");
  });
});


describe('SWISH AI provider error response sanitization', () => {
  const listGenerate = fs.readFileSync(
    path.join(projectRoot, 'supabase/functions/swish-list-generate/index.ts'),
    'utf8',
  );
  const reprice = fs.readFileSync(
    path.join(projectRoot, 'supabase/functions/swish-reprice/index.ts'),
    'utf8',
  );
  const islamicIdentify = fs.readFileSync(
    path.join(projectRoot, 'supabase/functions/swish-islamic-identify/index.ts'),
    'utf8',
  );

  test('listing generation never returns raw AI provider bodies or exception strings', () => {
    expect(listGenerate).toContain("Listing generation is temporarily unavailable. Please retry.");
    expect(listGenerate).toContain("Unable to generate the listing. Please retry.");
    expect(listGenerate).not.toContain('OnSpace AI: ${errText}');
    expect(listGenerate).not.toContain('JSON.stringify({ error: String(err) })');
    expect(listGenerate).not.toContain('rawContent.slice(0, 400)');
  });

  test('repricing never returns raw AI provider bodies or exception strings', () => {
    expect(reprice).toContain("Repricing is temporarily unavailable. Please retry.");
    expect(reprice).toContain("Unable to reprice this listing. Please retry.");
    expect(reprice).not.toContain('OnSpace AI: ${errText}');
    expect(reprice).not.toContain('JSON.stringify({ error: String(err) })');
    expect(reprice).not.toContain("console.error('Failed to parse AI response:', rawContent)");
  });

  test('Islamic identification keeps external search exception details out of results and logs', () => {
    expect(islamicIdentify).toContain("Zeno search is temporarily unavailable.");
    expect(islamicIdentify).toContain("Numista search is temporarily unavailable.");
    expect(islamicIdentify).not.toContain('Network error: ${e.message}');
    expect(islamicIdentify).not.toContain('Numista error: ${e.message}');
    expect(islamicIdentify).not.toContain('Zeno search error for "${query}": ${e.message}');
  });
});


describe('SWISH market valuation provider error sanitization', () => {
  const marketValue = fs.readFileSync(
    path.join(projectRoot, 'supabase/functions/swish-market-value/index.ts'),
    'utf8',
  );

  test('does not return raw provider or runtime exception details', () => {
    expect(marketValue).toContain("Market valuation failed. Please retry.");
    expect(marketValue).toContain("Sold-data lookup is temporarily unavailable.");
    expect(marketValue).toContain("Active-listing lookup is temporarily unavailable.");
    expect(marketValue).not.toContain('details: detail');
    expect(marketValue).not.toContain('Terapeak exception: ${e.message}');
    expect(marketValue).not.toContain('error: e.message');
    expect(marketValue).not.toContain('Gemini error: ${e.message}');
  });
});


describe('SWISH remaining provider diagnostics stay server-safe', () => {
  const marketValue = fs.readFileSync(
    path.join(projectRoot, 'supabase/functions/swish-market-value/index.ts'),
    'utf8',
  );
  const imageEnhance = fs.readFileSync(
    path.join(projectRoot, 'supabase/functions/swish-coin-image-enhance/index.ts'),
    'utf8',
  );
  const identify = fs.readFileSync(
    path.join(projectRoot, 'supabase/functions/swish-identify/index.ts'),
    'utf8',
  );

  test('sold-market and visual lookup errors are generic', () => {
    expect(marketValue).toContain('Marketplace Insights sold-data lookup is unavailable.');
    expect(marketValue).not.toContain('Marketplace Insights: ${e?.message');
    expect(marketValue).not.toContain('Unhandled valuation error:',);
  });

  test('coin image and tier lookup exception details are not logged', () => {
    expect(imageEnhance).toContain("console.error('[swish-coin-image-enhance] request failed.')");
    expect(imageEnhance).not.toContain("error instanceof Error ? error.message");
    expect(identify).toContain("console.error('[swish-identify] Tenant tier lookup failed.')");
    expect(identify).not.toContain('Tenant tier lookup failed: ${e.message}');
  });
});


describe('SWISH image download error sanitization', () => {
  const imageDownload = fs.readFileSync(
    path.join(projectRoot, 'supabase/functions/swish-image-download/index.ts'),
    'utf8',
  );
  const islamicIdentify = fs.readFileSync(
    path.join(projectRoot, 'supabase/functions/swish-islamic-identify/index.ts'),
    'utf8',
  );

  test('image download response does not include raw processing exception text', () => {
    expect(imageDownload).toContain('An item image could not be processed.');
    expect(imageDownload).not.toContain('errors.push(`item=${item.id}: ${e.message}`)');
    expect(imageDownload).not.toContain('processItem exception item=${item.id}: ${e.message}');
  });

  test('direct Numista lookup failures use a generic diagnostic', () => {
    expect(islamicIdentify).toContain("firstError ||= 'Numista direct lookup failed.'");
    expect(islamicIdentify).not.toContain('Numista direct lookup failed: ${e.message}');
    expect(islamicIdentify).toContain(String.raw`referenceText.match(/\bN\s*#\s*(\d{1,9})\b/i)`);
    expect(islamicIdentify).toContain(String.raw`referenceText.match(/numista\.com\/(?:catalogue\/index\.php\?r=)?(\d{1,9})/i)`);
  });

  test('image download and category authentication failures do not expose raw exceptions', () => {
    const category = fs.readFileSync(
      path.join(projectRoot, 'supabase/functions/swish-ebay-category/index.ts'),
      'utf8',
    );
    expect(imageDownload).toContain("Unable to prepare eBay authorisation. Please reconnect and retry.");
    expect(imageDownload).not.toContain('error: isReauth ? \'eBay re-authorisation required.\' : e.message');
    expect(imageDownload).not.toContain('Refresh failed: ${e.message}');
    expect(category).toContain("Authentication required.");
    expect(category).not.toContain('Auth error: ${e.message}');
  });
});


describe('eBay OAuth custom credential privilege boundary', () => {
  const oauthSource = fs.readFileSync(
    path.join(projectRoot, 'supabase/functions/swish-ebay-oauth/index.ts'),
    'utf8',
  );

  test('custom eBay application credentials require tenant owner/admin role', () => {
    expect(oauthSource).toContain(".select('id, role, is_owner')");
    expect(oauthSource).toContain('requireOwnerOrAdmin && !(');
    expect(oauthSource).toContain("membership.role === 'owner'");
    expect(oauthSource).toContain("membership.role === 'admin'");
    const authorizeStart = oauthSource.indexOf('async function handleAuthorize(');
    const callbackStart = oauthSource.indexOf('// ═', authorizeStart);
    const authorizeSource = oauthSource.slice(authorizeStart, callbackStart);
    expect(authorizeSource).toContain('verifyUserAndTenant(authHeader, tenantId, supabase, true)');
  });

  test('normal subscriber authorization keeps the existing tenant-member flow', () => {
    const subscriberStart = oauthSource.indexOf('async function handleSubscriberAuthorization(');
    const authorizeStart = oauthSource.indexOf('async function handleAuthorize(');
    const subscriberSource = oauthSource.slice(subscriberStart, authorizeStart);
    expect(subscriberSource).toContain('verifyUserAndTenant(authHeader, tenantId, supabase)');
    expect(subscriberSource).not.toContain('supabase, true');
  });
});


describe('Tenant-scoped eBay sync writes', () => {
  test('permanent image downloads only update items belonging to the requested tenant', () => {
    const source = fs.readFileSync(
      path.join(projectRoot, 'supabase/functions/swish-image-download/index.ts'),
      'utf8',
    );
    expect(source).toContain(".update(updates).eq('id', item.id).eq('tenant_id', tenantId)");
  });

  test('eBay sync updates listing and inventory rows with tenant guards', () => {
    const source = fs.readFileSync(
      path.join(projectRoot, 'supabase/functions/swish-ebay-sync/index.ts'),
      'utf8',
    );
    expect(source).toContain(".eq('item_id', existingItem.id)");
    expect(source).toContain(".eq('tenant_id', tenantId)");
    expect(source).toContain(".eq('id', existingItem.id).eq('tenant_id', tenantId)");
  });
});
