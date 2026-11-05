import { createClient, FunctionsHttpError } from 'npm:@supabase/supabase-js@2';
import registry from '../_shared/niche-modules.json' with { type: 'json' };
import { corsHeaders } from '../_shared/cors.ts';
type Result = { test_id: string; niche_id: string | null; platform: string; result: 'PASS' | 'FAIL' | 'BLOCKED' | 'NOT TESTED'; evidence: string; failure_reason: string | null };
const respond = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
Deno.serve(async request => {
 if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
 if (request.method !== 'POST') return respond({ error: 'POST required' }, 405);
 const reference = crypto.randomUUID();
 try {
  const authorization = request.headers.get('Authorization') ?? '';
  if (!authorization.startsWith('Bearer ')) return respond({ error: 'Sign in required', reference }, 401);
  const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { auth: { persistSession: false } });
  const { data: { user }, error: authenticationError } = await admin.auth.getUser(authorization.slice(7));
  if (authenticationError || !user) return respond({ error: 'Invalid authentication', reference }, 401);
  const owner = await admin.rpc('swish_owner_for_user', { p_user_id: user.id });
  if (owner.error) return respond({ error: 'Owner verification unavailable', reference }, 503);
  if (owner.data !== true) return respond({ error: 'Trusted platform owner required', reference }, 403);
  const body = await request.json();
  if (typeof body.tenantId !== 'string' || !uuid.test(body.tenantId)) return respond({ error: 'Valid tenant required', reference }, 400);
  const tenantId = body.tenantId;
  const membership = await admin.from('tenant_memberships').select('id').eq('tenant_id', tenantId).eq('user_id', user.id).maybeSingle();
  if (membership.error || !membership.data) return respond({ error: 'Tenant membership required', reference }, 403);
  const action = body.action ?? 'list';
  const client = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } });
  const platform = ['android','ios','web'].includes(body.platform) ? body.platform : 'unknown';
  if (action === 'list') {
   const result = await admin.from('swish_verification_results').select('id,test_id,niche_id,platform,result,evidence,failure_reason,reference_id,created_at').eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(300);
   if (result.error) return respond({ error: 'Verification history unavailable', reference }, 503);
   return respond({ verifiedOwner: true, results: result.data ?? [], reference });
  }
  const results: Result[] = [];
  const add = (id: string, outcome: Result['result'], evidence: string, nicheId: string | null = null, reason: string | null = null) => results.push({ test_id: id, niche_id: nicheId, platform, result: outcome, evidence, failure_reason: reason });
  if (action === 'mounted' || action === 'failed') {
   if (typeof body.nicheId !== 'string' || !Object.hasOwn(registry.products, body.nicheId)) return respond({ error: 'Registered module required', reference }, 400);
   if (action === 'failed') add(`ROUTE-${body.nicheId}`, 'FAIL', 'Client reported module authorization or initialization failure. No request payload logged.', body.nicheId, 'Retry the card and inspect module authorization / settings availability.');
   else {
    const current = await client.rpc('swish_current_module');
    const scope = current.data;
    if (current.error || scope?.tenant_id !== tenantId || scope?.niche_id !== body.nicheId) return respond({ error: 'Rendered module does not match server session', reference }, 409);
    const allowed = await client.rpc('swish_can_access_niche', { p_tenant_id: tenantId, p_niche_id: body.nicheId });
    if (allowed.error || allowed.data !== true) return respond({ error: 'Rendered module entitlement not confirmed', reference }, 403);
    add(`ROUTE-${body.nicheId}`, 'PASS', 'Owner-client observation: specialist dashboard committed after lazy loading, with server session and entitlement matching. This verifies dashboard mounting only, not camera, marketplace operations or another device.', body.nicheId);
   }
  } else if (action === 'programme') {
   // Execute only safe reads. Compiler, camera, sandbox writes and release signing
   // cannot run in this Edge runtime and must remain explicit blockers.
   const stageId = typeof body.stageId === 'string' ? body.stageId : 'ALL';
   if (!['ALL','S1','S2','S3','S4','S5','S6','S7'].includes(stageId) || !/^[a-f0-9]{40}$/i.test(body.sourceSha ?? '')) return respond({ error: 'Valid current source and workstream required', reference }, 400);
   const sourceSha = body.sourceSha;
   const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 12000);
   let programme: { stages: { id: string; name: string; tasks: { id: string; title: string }[] }[] };
   try {
    const main = await fetch('https://api.github.com/repos/troonvinyl-ux/SWISH/commits/main', { signal: controller.signal, headers: { Accept: 'application/vnd.github+json' } });
    if (!main.ok || (await main.json()).sha !== sourceSha) return respond({ error: 'Main changed or could not be confirmed. Refresh evidence before auditing.', reference }, 409);
    const source = await fetch(`https://raw.githubusercontent.com/troonvinyl-ux/SWISH/${sourceSha}/docs/SWISH_FOUNDATION_MASTER_REGISTER.json`, { signal: controller.signal });
    if (!source.ok) return respond({ error: 'Canonical readiness requirements unavailable', reference }, 503);
    programme = await source.json();
    if (!Array.isArray(programme.stages) || programme.stages.length !== 7 || !programme.stages.every(stage => /^S[1-7]$/.test(stage.id) && Array.isArray(stage.tasks) && stage.tasks.every(task => typeof task.id === 'string' && task.id.startsWith(stage.id+'-') && typeof task.title === 'string'))) return respond({ error: 'Canonical programme validation failed', reference }, 503);
   } finally { clearTimeout(timer); }
   const database = await client.from('tenants').select('id').eq('id',tenantId).maybeSingle();
   add(`PROGRAMME-DB-${sourceSha}`, database.error || !database.data ? 'FAIL' : 'PASS', `Actual caller-RLS tenant SELECT executed. Source ${sourceSha}. This is connectivity evidence only.`, null, database.error || !database.data ? 'Caller tenant SELECT failed' : null);
   const report = await client.rpc('swish_command_snapshot', { p_platform: true });
   const identities = Array.isArray(report.data?.modules) ? report.data.modules.map((row: { id: string }) => row.id) : [];
   const registryPassed = !report.error && report.data?.verifiedOwner === true && identities.length === Object.keys(registry.products).length && Object.keys(registry.products).every(id => identities.includes(id));
   add(`PROGRAMME-AGGREGATES-${sourceSha}`, registryPassed ? 'PASS' : 'FAIL', `Actual owner aggregate RPC executed and all canonical module identities compared. Source ${sourceSha}. Not subscriber isolation or marketplace acceptance.`, null, registryPassed ? null : 'Aggregate reporting query or registry mismatch');
   for (const stage of programme.stages.filter(stage => stageId === 'ALL' || stage.id === stageId)) for (const task of stage.tasks) {
    const reason = stage.id==='S1' || stage.id==='S2' ? 'Current-source dependency/static/regression executor and reviewed acceptance evidence required.' : stage.id==='S7' ? 'Current-commit CI, unified signing/artifact, hosted and installed-device verification required. No APK requested by this audit.' : 'Approved isolated fixture, ordinary subscriber sessions and niche workflow/provider/device acceptance required. No production write or paid AI test executed.';
    add(`READINESS:${task.id}:${sourceSha}`, 'BLOCKED', `${task.id} — ${task.title}. Original ${stage.name} requirement retained. Source ${sourceSha}. Safe owner/tenant/aggregate checks above do not fulfill this complete task.`, null, reason);
   }
  } else if (action === 'ebay') {
   const current = await client.rpc('swish_current_module'); const nicheId = current.data?.niche_id;
   if (current.error || current.data?.tenant_id !== tenantId || !nicheId) add('EBAY-LIVE', 'BLOCKED', 'Select an entitled module before the existing seller-policy API probe.', null, 'No active module');
   else {
    const probe = await client.functions.invoke('swish-ebay-list', { body: { route: 'get_seller_policies', tenantId } });
    const confirmed = !probe.error && probe.data?.success === true && probe.data?.diagnostics?.live === true;
    const status = (probe.error instanceof FunctionsHttpError ? probe.error.context.status : null) ?? probe.data?.diagnostics?.httpStatus ?? null;
    add('EBAY-LIVE', confirmed ? 'PASS' : probe.error ? 'FAIL' : 'BLOCKED', confirmed ? 'Existing swish-ebay-list retrieved all three live seller policy endpoints. Credential refresh and policy cache use the established encrypted integration. No listing published or inventory changed.' : `swish-ebay-list live policy read not confirmed${status ? ` (HTTP ${status})` : ''}.`, nicheId, confirmed ? null : 'Check eBay consent, token refresh, account restrictions or deploy the diagnostic-enabled existing listing function.');
   }
  } else if (action === 'antiques') {
   const current = await client.rpc('swish_current_module');
   if (current.error || current.data?.tenant_id !== tenantId || current.data?.niche_id !== 'antiques') return respond({ error: 'Open Antique Flipper before its read-only audit.', reference }, 409);
   const stock = await client.from('items').select('id,specialist_id,media,valuation_mid,attributes').eq('tenant_id',tenantId).limit(500);
   add('ANT-INVENTORY-READ', stock.error ? 'FAIL' : 'PASS', `Caller-RLS read executed: ${stock.data?.length ?? 0} rows (maximum 500); does not test creation, editing or delete.`, 'antiques', stock.error ? 'Inventory SELECT failed' : null);
   const crossing = (stock.data ?? []).some(row => !['antiques','books'].includes(row.specialist_id));
   add('ANT-ISOLATION-READ', stock.error ? 'BLOCKED' : crossing ? 'FAIL' : 'PASS', 'Current-session inventory sample was checked for out-of-Antique specialists; not a separate-user/write penetration test.', 'antiques', crossing ? 'Out-of-module item returned' : stock.error ? 'Inventory read failed' : null);
   const withPhotos = (stock.data ?? []).filter(row => Array.isArray(row.media) && row.media.some((url: unknown) => typeof url === 'string' && url.startsWith('https://'))).length;
   add('ANT-PHOTO-LINKS', stock.error ? 'BLOCKED' : stock.data?.length && !withPhotos ? 'FAIL' : 'NOT TESTED', `${withPhotos} observed items have stored HTTPS photos. URL presence does not verify upload, reachability or image rights.`, 'antiques', stock.data?.length && !withPhotos ? 'Original photos are not linked to sampled inventory.' : null);
   const drafts = await client.from('listings').select('id,category_id,external_listing_id,status').eq('tenant_id',tenantId).limit(100);
   add('ANT-LISTING-READ', drafts.error ? 'FAIL' : 'PASS', `Caller-RLS read executed: ${drafts.data?.length ?? 0} listing rows; not draft creation or eBay reconciliation.`, 'antiques', drafts.error ? 'Listing read failed' : null);
   for (const [id,reason] of [['ANT-CREATE','Approved isolated test item and persisted readback required.'],['ANT-EDIT','Edit/reload a designated test record; audit does not mutate inventory.'],['ANT-IDENTIFY','Supply representative original photographs and run the real specialist workflow.'],['ANT-VALUE','Run market research; inspect real sold vs asking evidence and persistence.'],['ANT-CATEGORY','Select and save a current live leaf category for a reviewed item.'],['ANT-SPECIFICS','Fetch selected-category requirements, edit, save and independently reload all values.'],['ANT-DRAFT','Generate and save a designated test draft; read-only audit does not create drafts.'],['ANT-PUBLISH','Explicit test-item/account/fees authorization required; no publication performed.'],['ANT-RECONCILE','Real returned eBay listing ID and provider retrieval required.'],['ANT-MANAGEMENT','Explicit authorization required for live revision or ending.'],['ANT-PARITY','Installed Android/iOS and browser observations required.']]) add(id,'NOT TESTED',reason,'antiques');
  } else if (action === 'run') {
   add('AUTH-JWT', 'PASS', 'Existing auth.getUser validated the caller JWT for this request.');
   add('OWNER-ROLE', 'PASS', 'Trusted swish_owner_for_user RPC verified the designated owner; tenant membership was independently read.');
   const read = await client.from('tenants').select('id').eq('id', tenantId).maybeSingle();
   add('TENANT-READ', read.error || !read.data ? 'FAIL' : 'PASS', 'Caller-scoped tenant read; no profile or inventory writes.', null, read.error || !read.data ? 'Tenant not readable by this session' : null);
   const current = await client.rpc('swish_current_module');
   const nicheId = current.data?.tenant_id === tenantId && typeof current.data?.niche_id === 'string' && Object.hasOwn(registry.products, current.data.niche_id) ? current.data.niche_id : null;
   if (!nicheId || current.error) { add('INVENTORY-READ', 'BLOCKED', 'Open a specialist then run safe checks from Master Admin.', null, 'No active canonical module'); add('ISOLATION-SAMPLE', 'BLOCKED', 'An active module is required to exercise its RLS boundary.', null, 'No active module'); }
   else {
    const product = (registry.products as Record<string, { specialists: string[]; legacySpecialists: string[] }>)[nicheId];
    const owned = [...product.specialists, ...product.legacySpecialists];
    const observed = await client.from('items').select('id,specialist_id').eq('tenant_id', tenantId).limit(500);
    add('INVENTORY-READ', observed.error ? 'FAIL' : 'PASS', `Caller RLS read ${observed.data?.length ?? 0} rows (500-row maximum); successful zero-row read is not a CRUD test.`, nicheId, observed.error ? 'Inventory read failed' : null);
    const crossing = (observed.data ?? []).filter(row => !owned.includes(row.specialist_id)).length;
    add('ISOLATION-SAMPLE', observed.error ? 'BLOCKED' : crossing ? 'FAIL' : 'PASS', `Caller RLS sample found ${crossing} out-of-module rows. Read sample only; not multi-account/write acceptance.`, nicheId, observed.error ? 'Inventory read unavailable' : crossing ? 'Cross-niche row observed' : null);
    for (const target of Object.keys(registry.products).filter(id => id !== nicheId)) {
     const access = await client.rpc('swish_can_access_niche', { p_tenant_id: tenantId, p_niche_id: target });
     add(`ISOLATION-RPC-${target}`, access.error ? 'BLOCKED' : access.data === false ? 'PASS' : 'FAIL', `From active ${nicheId}, authorization for ${target} ${access.data === false ? 'was denied' : 'was not confirmed denied'}. Does not test a different user.`, nicheId, access.error ? 'Authorization RPC unavailable' : access.data !== false ? 'Cross-module authorization unexpectedly allowed' : null);
    }
    const listings = await client.from('listings').select('id').eq('tenant_id', tenantId).limit(1);
    add('LISTING-READ', listings.error ? 'FAIL' : 'PASS', 'Caller-scoped listing SELECT executed. No draft created or listing published.', nicheId, listings.error ? 'Listing read failed' : null);
   }
   const connector = await admin.from('marketplace_connectors').select('status,last_sync_at,access_token_expires_at').eq('tenant_id', tenantId).eq('marketplace_id', 'ebay').maybeSingle();
   add('EBAY-CONNECTOR-METADATA', connector.error || !connector.data ? 'BLOCKED' : 'PASS', connector.data ? `Stored connection status: ${connector.data.status}; last sync: ${connector.data.last_sync_at ?? 'UNKNOWN'}; expiry: ${connector.data.access_token_expires_at ?? 'UNKNOWN'}. This is a metadata read, not a live eBay test.` : 'No connector metadata readable.', nicheId, connector.error || !connector.data ? 'Connector not available' : null);
   for (const [id, explanation] of [['AUTH-SUBSCRIBER','Requires separate ordinary subscriber sessions; owner JWT cannot prove subscriber permissions.'],['INVENTORY-WRITE','Requires approved isolated test records; safe runner does not mutate business records.'],['AI-IDENTIFY','Use real photos in the active module; no synthetic AI request is submitted.'],['AI-VALUATION','Requires a reviewed real item and evidence retrieval; use the valuation workflow.'],['LISTING-GENERATE','Requires explicit real-item draft creation; safe checks never create or publish listings.'],['PARITY-DEVICES','Requires actual Android, iOS and browser observations for the same source/runtime.'],['UPDATE-COMPATIBILITY','Use App updates to query the configured update service from an installed native build.']]) add(id, 'NOT TESTED', explanation, nicheId);
  } else return respond({ error: 'Unsupported safe test action', reference }, 400);
  const saved = await admin.from('swish_verification_results').insert(results.map(result => ({ ...result, tenant_id: tenantId, user_id: user.id, reference_id: reference }))).select('id,test_id,niche_id,platform,result,evidence,failure_reason,reference_id,created_at');
  if (saved.error) return respond({ error: 'Checks ran but evidence could not be retained; rerun after checking diagnostics storage', reference }, 503);
  return respond({ verifiedOwner: true, results: saved.data ?? [], reference });
 } catch { console.error('[SWISH verification] Safe checks failed', reference); return respond({ error: 'Verification failed; sensitive inputs withheld', reference }, 503); }
});
