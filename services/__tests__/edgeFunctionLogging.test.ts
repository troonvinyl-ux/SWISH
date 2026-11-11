import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../..');
const instrumentedFunctions = [
  'swish-check-subscription', 'swish-verify', 'swish-decompose', 'swish-reprice',
  'swish-coin-image-enhance', 'swish-ebay-listing-status', 'swish-ebay-oauth',
  'swish-ebay-sync', 'swish-identify', 'swish-migrate-credentials',
  'swish-ebay-messages', 'swish-ebay-list', 'swish-ebay-browse',
  'swish-ebay-orders', 'swish-ebay-finances', 'swish-image-download',
  'swish-list-generate', 'swish-market-value', 'swish-ebay-category',
  'swish-privacy-policy', 'swish-ebay-post-order', 'swish-islamic-identify',
  'swish-ebay-draft-sync-test', 'swish-create-checkout', 'swish-customer-portal',
];

test('every deployed SWISH Edge Function is wrapped by shared invocation telemetry', () => {
  for (const name of instrumentedFunctions) {
    const source = fs.readFileSync(path.join(root, 'supabase/functions', name, 'index.ts'), 'utf8');
    expect(source).toContain(`withEdgeFunctionLogging('${name}'`);
    expect(source).toContain('../_shared/edgeFunctionLogging.ts');
  }
});

test('Edge Function telemetry stores metadata only and does not persist payloads or secrets', () => {
  const source = fs.readFileSync(path.join(root, 'supabase/functions/_shared/edgeFunctionLogging.ts'), 'utf8');
  expect(source).toContain('request.clone().json()');
  expect(source).toContain('contentLength <= 64 * 1024');
  expect(source).toContain('tenant_id: input.tenantId');
  expect(source).toContain('duration_ms: input.durationMs');
  expect(source).not.toContain('request.text()');
  expect(source).not.toContain('response.text()');
  expect(source).not.toContain('authorization:');
  expect(source).not.toContain('credential_ref');
});

test('Edge Function log migration restricts reads to the master owner and uses polling without unsupported Realtime publication', () => {
  const sql = fs.readFileSync(path.join(root, 'supabase/migrations/20261103_edge_function_logs.sql'), 'utf8');
  expect(sql).toContain('enable row level security');
  expect(sql).toContain("'troonvinyl@gmail.com'");
  expect(sql).toContain('Read telemetry by polling');
  expect(sql).not.toMatch(/alter\s+publication\s+supabase_realtime\s+add\s+table\s+public\.edge_function_logs/i);
  expect(sql).toContain('grant insert on public.edge_function_logs to service_role');
});
