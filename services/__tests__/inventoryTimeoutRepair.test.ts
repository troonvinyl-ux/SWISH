// Pure/source regressions; not installed-device or authenticated live acceptance.
import fs from 'node:fs';
import { describeInventoryFailure, isBackendUnavailable } from '../backendAvailabilityService';
const read = (file: string) => fs.readFileSync(file, 'utf8');

test.each([
  '[500] 57014: canceling statement due to statement timeout',
  '[504] gateway timeout',
  'Network request failed',
])('inventory outage %s is actionable without exposing database internals', message => {
  expect(isBackendUnavailable(message)).toBe(true);
  expect(describeInventoryFailure(message)).toContain('saved items and photos are unchanged');
  expect(describeInventoryFailure(message)).not.toMatch(/57014|\[500\]|statement|SQL/i);
});
test.each(['[403] Access denied', '42501: Inventory niche access denied', 'Authenticated session changed during backend read.'])('authorization failure %s is not hidden as a timeout', message => {
  expect(describeInventoryFailure(message)).toBe(message);
});
test('no error stays no error, not a synthetic inventory success', () => {
  expect(describeInventoryFailure(null)).toBeNull();
  expect(describeInventoryFailure(undefined)).toBeNull();
});
test('the count RPC scopes slim rows before deduplicating listings and evaluating ledger evidence', () => {
  const sql = read('supabase/migrations/20261119_inventory_count_timeout_repair.sql');
  expect(sql).toContain('security invoker');
  expect(sql).toContain('public.swish_can_access_niche(p_tenant_id,p_niche_id)');
  expect(sql).toContain("errcode='42501'");
  expect(sql).toContain('scoped_items as materialized');
  expect(sql).toContain('ranked_listings as materialized');
  expect(sql).toContain('listing_rows as materialized');
  expect(sql).toContain('where identity_rank=1');
  expect(sql).toContain('from public.items i');
  expect(sql).toContain('i.tenant_id=p_tenant_id and public.swish_specialist_niche(i.specialist_id)=p_niche_id');
  expect(sql).not.toContain('swish_inventory_canonical_rows');
  expect(sql).not.toContain('swish_inventory_listing_rows');
  expect(sql).not.toMatch(/select\s+[il]\.\*\s+from public\.(items|listings)|to_jsonb\([il]\)/i);
  expect(sql).not.toMatch(/security definer|disable row level security|delete from|update public\.|insert into public\.|drop /i);
  expect(sql).toContain("set jit=off");
  expect(sql).toContain('from public.sales s');
  expect(sql).toContain('from public.orders o');
  expect(sql).toContain('from public.ebay_returns r');
  expect(sql).toContain('i.quantity<=1');
  expect(sql).toContain('refund_issued_at is not null');
  expect(sql).toContain("'partially_refunded'");
  expect(sql).toContain("i.remaining='0'");
  expect(sql).toContain('count(distinct item_id)');
  expect(sql).toContain("'live_listings'");
  expect(sql).toContain("'status_counts'");
  expect(sql).toContain("'revision',md5");
  expect(sql).toContain('revoke all on function public.swish_inventory_tab_counts(uuid,text) from public,anon');
});
test('Quick List is below the safe area; embedded dashboards do not reserve a second top inset', () => {
  const shell = read('components/feature/ModuleHome.tsx');
  expect(shell).toContain("<SafeAreaView edges={['top']} style={s.screen}>");
  expect(shell).toContain('<StatusBar style="dark" />');
  expect(shell).toContain('<View style={s.quickCopy}>');
  expect(shell).toContain('<Collectibles embedded/>');
  expect(shell).toContain('<Dashboard nicheId={nicheId} embedded/>');
  const dashboard = read('components/feature/SharedNicheDashboard.tsx');
  expect(dashboard).toContain("edges={embedded ? [] : ['top']}");
  expect(dashboard).toContain('disabled={dashboard.loading}');
  expect(dashboard).toContain('Refreshing inventory…');
});
test('the dashboard maps errors without triggering retries, accepting stale access or inventing zero totals', () => {
  const hook = read('hooks/useNicheDashboard.ts');
  expect(hook).toContain('describeInventoryFailure(inventory.syncError)');
  expect(hook).not.toContain('setInterval');
  expect(hook).not.toContain('setTimeout');
  const inventory = read('hooks/useInventory.ts');
  expect(inventory).toContain('readCanonicalInventoryCounts(tenant.id,niche)');
  expect(inventory).toContain('isBackendUnavailable(failure)?previous.canonical:emptyCanonicalCounts()');
});
