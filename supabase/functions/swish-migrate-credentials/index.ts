// SWISH — swish-migrate-credentials Edge Function
//
// One-tenant-at-a-time admin operation: checks marketplace_connectors rows
// belonging to the explicitly supplied tenant, then re-encrypts plaintext
// credential_ref values with AES-256-GCM via migrateToEncrypted(). The encrypted
// value is persisted immediately so each row is only migrated once.
//
// SECURITY INVARIANTS
//   - Only callable by authenticated tenants whose membership is owner/admin.
//   - credential_ref is NEVER returned to the caller.
//   - Credential contents are NEVER logged — only structural metadata.
//   - Runs server-side only.  No credential material leaves this function.
//
// REQUEST:  POST  { tenantId: string }
//   - tenantId is required. Only an owner/admin of that tenant may migrate its rows.
//   - Cross-tenant migration is deliberately unsupported.
//
// RESPONSE: { migrated: number; alreadyEncrypted: number; failed: number; errors: string[] }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { corsHeaders } from '../_shared/cors.ts';
import { isEncrypted, migrateToEncrypted } from '../_shared/credentialCrypto.ts';

const SUPABASE_URL             = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

// ── Helpers ────────────────────────────────────────────────────────────────────

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function error(msg: string, status = 400) {
  return json({ error: msg }, status);
}

// ── Main ──────────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return error('Method not allowed', 405);
  }

  // ── Authenticate caller ────────────────────────────────────────────────────
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return error('Missing or invalid Authorization header', 401);
  }
  const token = authHeader.replace('Bearer ', '').trim();

  // Create an authed client (respects RLS for membership check)
  const authedClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  // Resolve the calling user
  const { data: { user }, error: userErr } = await authedClient.auth.getUser(token);
  if (userErr || !user) {
    return error('Unauthenticated — valid session required', 401);
  }

  // ── Parse body ─────────────────────────────────────────────────────────────
  let body: { tenantId?: unknown };
  try {
    const parsed: unknown = await req.json();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return error('Request body must be a JSON object containing tenantId', 400);
    }
    body = parsed as { tenantId?: unknown };
  } catch {
    return error('A tenantId is required for credential migration.', 400);
  }
  const tenantId = typeof body.tenantId === 'string' ? body.tenantId.trim() : '';
  if (!tenantId) {
    // Never let a tenant owner trigger a service-role query spanning other tenants.
    return error('A tenantId is required. Migrate one tenant at a time.', 400);
  }

  // ── Verify caller is owner/admin of the specified tenant ───────────────────
  // We use the service-role client for data access, but validate membership
  // using the caller's JWT so the caller cannot migrate another tenant.
  {
    const { data: membership, error: mErr } = await authedClient
      .from('tenant_memberships')
      .select('role, is_owner')
      .eq('tenant_id', tenantId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (mErr || !membership) {
      return error('Not a member of the specified tenant', 403);
    }
    const isPrivileged =
      membership.is_owner === true ||
      membership.role === 'owner' ||
      membership.role === 'admin';
    if (!isPrivileged) {
      return error('Owner or admin role required', 403);
    }
  }

  // ── Service-role client for credential access ──────────────────────────────
  // credential_ref is never accessible to the authed client (excluded from safe
  // column list in marketplaceService.ts), so we use the service-role client
  // exclusively for reading and writing the encrypted value.
  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // ── Fetch connector rows ───────────────────────────────────────────────────
  // Only fetch rows that have a non-empty credential_ref.
  let query = adminClient
    .from('marketplace_connectors')
    .select('id, tenant_id, marketplace_id, credential_ref')
    .not('credential_ref', 'is', null)
    .neq('credential_ref', '');

  query = query.eq('tenant_id', tenantId);

  const { data: rows, error: fetchErr } = await query;
  if (fetchErr) {
    console.error('[swish-migrate-credentials] Database fetch failed:', fetchErr.message);
    return error('Credential migration could not read connector records. Please retry or contact support.', 500);
  }

  if (!rows || rows.length === 0) {
    console.log('[swish-migrate-credentials] No connector rows with credential_ref found.');
    return json({ migrated: 0, alreadyEncrypted: 0, failed: 0, errors: [] });
  }

  // ── Process each row ───────────────────────────────────────────────────────
  let migrated = 0;
  let alreadyEncrypted = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const row of rows) {
    const stored: string = row.credential_ref;

    // Skip already-encrypted rows — migrateToEncrypted returns null for them
    if (isEncrypted(stored)) {
      alreadyEncrypted++;
      continue;
    }

    try {
      const encrypted = await migrateToEncrypted(stored);
      if (encrypted === null) {
        // Already encrypted (defensive check — should not reach here given the
        // isEncrypted() guard above, but handle it gracefully)
        alreadyEncrypted++;
        continue;
      }

      // Persist the encrypted value
      const { error: updateErr } = await adminClient
        .from('marketplace_connectors')
        .update({
          credential_ref: encrypted,
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id)
        .eq('tenant_id', row.tenant_id); // belt-and-braces tenant guard

      if (updateErr) {
        failed++;
        const msg = `Row ${row.id} (${row.marketplace_id}): update failed`;
        errors.push(msg);
        console.error('[swish-migrate-credentials] Row update failed:', { rowId: row.id, marketplace: row.marketplace_id, code: updateErr.code });
      } else {
        migrated++;
        // Log only structural metadata — never the credential content
        console.log(
          `[swish-migrate-credentials] Migrated row id=${row.id} marketplace=${row.marketplace_id} ` +
          `tenant=${row.tenant_id} plaintext_len=${stored.length} encrypted_len=${encrypted.length}`,
        );
      }
    } catch (e: any) {
      failed++;
      const msg = `Row ${row.id} (${row.marketplace_id}): encryption failed`;
      errors.push(msg);
      console.error('[swish-migrate-credentials] Row encryption failed:', { rowId: row.id, marketplace: row.marketplace_id, reason: e instanceof Error ? e.message : 'unknown error' });
    }
  }

  const summary = {
    totalRows: rows.length,
    migrated,
    alreadyEncrypted,
    failed,
    errors,
  };

  console.log('[swish-migrate-credentials] Complete:', JSON.stringify({
    totalRows: summary.totalRows,
    migrated: summary.migrated,
    alreadyEncrypted: summary.alreadyEncrypted,
    failed: summary.failed,
    errorCount: errors.length,
  }));

  return json(summary, failed > 0 ? 207 : 200); // 207 Multi-Status if partial failures
});
