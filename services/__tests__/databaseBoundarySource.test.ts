// Source contract tests only. Real role-level SQL checks are recorded in the handover.
import fs from 'node:fs';
import path from 'node:path';
const migration = (name: string) => fs.readFileSync(path.resolve(__dirname, '../../supabase/migrations', name), 'utf8');
describe('Tracked database security contracts', () => {
  test('client credential permission is revoked rather than hidden only by a UI query', () => {
    const source = migration('20261030_security_boundaries.sql');
    expect(source).toContain('revoke select(credential_ref), insert(credential_ref), update(credential_ref)');
    expect(source).toContain('p_user_id is distinct from auth.uid()');
    expect(source).toContain('pg_advisory_xact_lock');
    expect(source).toContain('revoke insert, update on public.tenant_memberships');
  });
  test('editor cannot change canonical inventory IDs or specialist associations', () => {
    const source = migration('20261030_editor_disconnect_storage.sql');
    expect(source).toContain('security invoker');
    expect(source).toContain('ebay_item_specifics');
    expect(source).not.toMatch(/set\s+(?:inventory_id|specialist_id|tenant_id)\s*=/i);
    expect(source).toContain('as restrictive for update');
  });
  test('publish claims are server-only and independent of the listing status enum', () => {
    const source = migration('20261030_publish_claim.sql');
    expect(source).toContain('publish_claim_id is null');
    expect(source).toContain('to service_role');
    expect(source).toContain('from public,anon,authenticated');
    expect(source).not.toContain('drop constraint');
  });
  test('future listing links cannot cross tenant boundaries', () => {
    const source = migration('20261030_listing_tenant_guard.sql');
    expect(source).toContain('i.id=new.item_id and i.tenant_id=new.tenant_id');
    expect(source).toContain('before insert or update of tenant_id,item_id');
  });
});
