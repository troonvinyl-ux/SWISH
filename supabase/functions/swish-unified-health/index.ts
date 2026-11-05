import { createClient } from 'npm:@supabase/supabase-js@2';
import registry from '../_shared/niche-modules.json' with { type: 'json' };
import { corsHeaders } from '../_shared/cors.ts';
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    const authorization = request.headers.get('Authorization') ?? '';
    if (!authorization.startsWith('Bearer ')) return json({ error: 'Authentication required' }, 401);
    const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { auth: { persistSession: false } });
    const { data: { user }, error: authError } = await db.auth.getUser(authorization.slice(7));
    if (authError || !user) return json({ error: 'Invalid session' }, 401);
    const { data: owner, error: ownerError } = await db.rpc('swish_owner_for_user', { p_user_id: user.id });
    if (ownerError) return json({ error: 'Platform role verification unavailable' }, 503);
    if (owner !== true) return json({ error: 'Trusted platform owner required' }, 403);
    const body = await request.json(); const tenantId = body.tenantId;
    const { data: member, error: memberError } = await db.from('tenant_memberships').select('id').eq('tenant_id', tenantId).eq('user_id', user.id).maybeSingle();
    if (memberError || !member) return json({ error: 'Business account access denied' }, 403);
    const client = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } });
    const [tenant, connector, releases, logs, current] = await Promise.all([
      db.from('tenants').select('id').eq('id', tenantId).maybeSingle(),
      db.from('marketplace_connectors').select('status,last_sync_at,access_token_expires_at,can_publish,can_read_orders,policies_cached_at').eq('tenant_id', tenantId).eq('marketplace_id', 'ebay').maybeSingle(),
      db.from('swish_release_catalog').select('platform,channel,version,build_number,runtime_version,source_sha,status,artifact_sha256,certificate_sha256,created_at').order('created_at', { ascending: false }).limit(12),
      db.from('edge_function_logs').select('function_name,outcome,status_code,duration_ms,error_code,created_at').eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(20),
      client.rpc('swish_current_module'),
    ]);
    const [users, memberships, inventoryTotal, identificationActivity, syncRuns, apiErrors, listingStates, loadFailures] = await Promise.all([
      db.from('user_profiles').select('id', { count:'exact', head:true }),
      db.from('niche_entitlements').select('user_id', { count:'exact', head:true }).gt('expires_at', new Date().toISOString()),
      db.from('items').select('id', { count:'exact', head:true }).eq('tenant_id',tenantId),
      db.from('ai_usage').select('id', { count:'exact', head:true }).eq('tenant_id',tenantId),
      db.from('ebay_sync_log').select('id,sync_type,status,started_at,completed_at,records_fetched,records_created,records_updated').eq('tenant_id',tenantId).order('started_at',{ascending:false}).limit(10),
      db.from('ebay_api_log').select('id,operation,http_status,ebay_error_code,created_at').eq('tenant_id',tenantId).eq('success',false).order('created_at',{ascending:false}).limit(10),
      db.from('listings').select('status').eq('tenant_id',tenantId).limit(1000),
      db.from('swish_verification_results').select('id', {count:'exact',head:true}).eq('tenant_id',tenantId).like('test_id','ROUTE-%').eq('result','FAIL'),
    ]);
    const listingCounts: Record<string, number> | null = listingStates.error ? null : {};
    if (listingCounts) for (const row of listingStates.data ?? []) listingCounts[row.status ?? 'unknown'] = (listingCounts[row.status ?? 'unknown'] ?? 0) + 1;
    // One authenticated aggregate replaces 22 per-niche count queries. Tenant scope
    // preserves the existing diagnostic contract; the command home uses platform scope.
    const portfolio = await client.rpc('swish_command_snapshot', { p_tenant_id: tenantId, p_platform: false });
    const modules = Object.entries(registry.products).map(([id, module]) => {
      const row = portfolio.error ? null : portfolio.data?.modules?.find((value: { id: string }) => value.id === id);
      return { id, name: module.name, route: module.modulePath ?? '/' + module.entry.replace(/\.tsx$/, ''), configured: true,
        inventoryCount: row?.inventory ?? null, listingCount: row ? row.live + row.drafts : null,
        dataStatus: row ? 'query_completed' : 'unavailable' };
    });
    let isolation: { status: string; observedCrossNicheRows: number | null } = { status: 'NOT TESTED: open a module first', observedCrossNicheRows: null };
    if (current.data?.niche_id && Object.hasOwn(registry.products, current.data.niche_id)) {
      const module = (registry.products as Record<string, { specialists: string[]; legacySpecialists: string[] }>)[current.data.niche_id];
      const permitted = [...module.specialists, ...module.legacySpecialists];
      const observed = await client.from('items').select('specialist_id').eq('tenant_id', tenantId).limit(500);
      const cross = observed.error ? null : (observed.data ?? []).filter(row => !permitted.includes(row.specialist_id)).length;
      isolation = { status: observed.error ? 'BLOCKED: caller RLS query failed' : cross === 0 ? 'PASS: current-session read sample only' : 'FAIL: out-of-module row observed', observedCrossNicheRows: cross };
    }
    return json({ verifiedOwner: true, checkedAt: new Date().toISOString(), authentication: 'verified_JWT', backend: 'reachable', database: tenant.error || !tenant.data ? 'unavailable' : 'query_completed',
      ebay: connector.error ? { status: 'unavailable', last_sync_at: null } : connector.data ?? { status: 'not_connected', last_sync_at: null },
      overview: { registeredUsers:users.error ? null : users.count, activeNicheMemberships:memberships.error ? null : memberships.count, tenantInventory:inventoryTotal.error ? null : inventoryTotal.count, identificationUsageRows:identificationActivity.error ? null : identificationActivity.count, recordedLoadFailures:loadFailures.error ? null : loadFailures.count },
      ebayDiagnostics: { syncRuns:syncRuns.error ? null : syncRuns.data, apiErrors:apiErrors.error ? null : apiErrors.data, listingCounts, listingSampleLimit:1000 },
      currentModule: current.data ?? null, modules, isolation, releases: releases.error ? [] : releases.data ?? [], logs: logs.error ? [] : logs.data ?? [],
      limitations: ['eBay status is stored connector metadata, not a live marketplace test.', 'Module configuration and counts do not certify installed-device behavior.', 'No native build is inferred from source or JavaScript export.', 'Isolation sample is not multi-account write or end-to-end acceptance.'] });
  } catch { console.error('[Unified health] Read-only diagnostics unavailable'); return json({ error: 'Diagnostics unavailable; no sensitive data returned' }, 503); }
});
