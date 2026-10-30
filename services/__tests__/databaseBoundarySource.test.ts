// Source contract tests for the SQL migrations and server-owned write paths tracked in this repository.
import fs from 'node:fs';
import path from 'node:path';

const projectRoot = path.resolve(__dirname, '../..');
const migration = (name: string) => fs.readFileSync(path.resolve(projectRoot, 'supabase/migrations', name), 'utf8');
const edgeFunction = (name: string) => fs.readFileSync(path.resolve(projectRoot, 'supabase/functions', name, 'index.ts'), 'utf8');

describe('Tracked database security contracts', () => {
  test('client credential permission is revoked rather than hidden only by a UI query', () => {
    const source = migration('20261030_security_boundaries.sql');
    expect(source).toContain('revoke select(credential_ref), insert(credential_ref), update(credential_ref)');
    expect(source).toContain('p_user_id is distinct from auth.uid()');
    expect(source).toContain('pg_advisory_xact_lock');
    expect(source).toContain('revoke insert, update on public.tenant_memberships');
  });

  test('inventory tab projection is tenant-scoped and sold evidence takes precedence', () => {
    const source = migration('20261030_inventory_tab_state.sql');
    expect(source).toContain('security_invoker = true');
    expect(source).toContain('as terminal_sold');
    expect(source).toContain("case when i.terminal_sold then 'sold'");
    expect(source).toContain('swish_apply_ebay_listing_status');
    expect(source).toContain('Listing scope mismatch');
  });

  test('publish path uses an atomic claim and only resets its own claim', () => {
    const source = edgeFunction('swish-ebay-list');
    expect(source).toContain("supabase.rpc('swish_claim_listing_publish'");
    expect(source).toContain('publish_claim_id: null');
    expect(source).toContain(".eq('publish_claim_id', claimId)");
    expect(source).toContain('PUBLISH_RECONCILIATION_REQUIRED');
  });

  test('future listing links cannot cross tenant boundaries', () => {
    const source = migration('20261030_listing_tenant_guard.sql');
    expect(source).toContain('i.id=new.item_id and i.tenant_id=new.tenant_id');
    expect(source).toContain('before insert or update of tenant_id,item_id');
  });
});
