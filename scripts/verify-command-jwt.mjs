#!/usr/bin/env node
// CI-only client of existing OnSpace endpoints. Not a server or authentication system.
// The ONLY write-capable call is the approved existing readiness programme, which
// persists diagnostics. No login, refresh, module switch, inventory or seller calls.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const BACKEND_ORIGIN = 'https://iwgaqieyoahmcjfziwga.backend.onspace.ai';
const GITHUB_ORIGIN = 'https://api.github.com';
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const sha = /^[a-f0-9]{40}$/i;
const inspectors = ['users', 'memberships', 'inventory', 'audit', 'incidents', 'sync', 'configuration'];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sorted = values => [...values].sort();
const unique = values => new Set(values).size === values.length;
const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
function jwtClaims(value) {
  try {
    const pieces = value.split('.');
    return pieces.length === 3 ? JSON.parse(Buffer.from(pieces[1], 'base64url').toString('utf8')) : null;
  } catch { return null; }
}

export function loadJwtFixtureConfig(env = process.env, now = Date.now()) {
  const required = ['SWISH_ANON_KEY', 'SWISH_OWNER_JWT', 'SWISH_SUBSCRIBER_JWT',
    'SWISH_OWNER_USER_ID', 'SWISH_SUBSCRIBER_USER_ID', 'SWISH_OWNER_TENANT_ID',
    'SWISH_SUBSCRIBER_TENANT_ID', 'SWISH_FOREIGN_TENANT_ID', 'SWISH_SUBSCRIBER_NICHES', 'GITHUB_SHA'];
  if (env.SWISH_APPROVED_JWT_READS !== '1' || env.SWISH_APPROVED_DIAGNOSTIC_EVIDENCE !== '1') {
    return { config: null, reason: 'EXPLICIT_READ_AND_DIAGNOSTIC_APPROVAL_REQUIRED' };
  }
  if (required.some(key => typeof env[key] !== 'string' || !env[key].trim())) {
    return { config: null, reason: 'SECURE_FIXTURE_CONFIGURATION_MISSING' };
  }
  if (!sha.test(env.GITHUB_SHA) || !['SWISH_OWNER_USER_ID', 'SWISH_SUBSCRIBER_USER_ID',
    'SWISH_OWNER_TENANT_ID', 'SWISH_SUBSCRIBER_TENANT_ID', 'SWISH_FOREIGN_TENANT_ID'].every(key => uuid.test(env[key]))) {
    return { config: null, reason: 'FIXTURE_IDENTIFIERS_OR_SOURCE_INVALID' };
  }
  const owner = jwtClaims(env.SWISH_OWNER_JWT);
  const subscriber = jwtClaims(env.SWISH_SUBSCRIBER_JWT);
  if (!owner || !subscriber || owner.role !== 'authenticated' || subscriber.role !== 'authenticated' ||
    owner.sub !== env.SWISH_OWNER_USER_ID || subscriber.sub !== env.SWISH_SUBSCRIBER_USER_ID ||
    owner.sub === subscriber.sub || !Number.isFinite(owner.exp) || !Number.isFinite(subscriber.exp) ||
    Math.min(owner.exp, subscriber.exp) * 1000 < now + 600000) {
    return { config: null, reason: 'DISTINCT_UNEXPIRED_AUTHENTICATED_FIXTURES_REQUIRED' };
  }
  // Never accept a service-role token as an actor or client API key.
  if (jwtClaims(env.SWISH_ANON_KEY)?.role !== 'anon') {
    return { config: null, reason: 'PROJECT_ANON_KEY_REQUIRED_NO_SERVICE_ROLE' };
  }
  if (env.SWISH_FOREIGN_TENANT_ID === env.SWISH_OWNER_TENANT_ID ||
    env.SWISH_FOREIGN_TENANT_ID === env.SWISH_SUBSCRIBER_TENANT_ID) {
    return { config: null, reason: 'DISTINCT_APPROVED_FOREIGN_TENANT_REQUIRED' };
  }
  let registry;
  try { registry = JSON.parse(fs.readFileSync(new URL('../niche-modules.json', import.meta.url), 'utf8')); }
  catch { return { config: null, reason: 'CANONICAL_REGISTRY_UNAVAILABLE' }; }
  const nicheIds = Object.keys(registry.products ?? {});
  const subscriberNiches = env.SWISH_SUBSCRIBER_NICHES.split(',').map(value => value.trim());
  // Current unified acceptance scope is all thirteen registered products. Keep the
  // denied-niche fixture requirement; adding Tunes Flip must not disable the runner.
  if (nicheIds.length !== 13 || !nicheIds.includes('collectibles') || (!nicheIds.includes('tunes_flip') || !nicheIds.includes('stamps')) || !subscriberNiches.length || !unique(subscriberNiches) ||
    subscriberNiches.some(id => !nicheIds.includes(id)) || subscriberNiches.length >= nicheIds.length) {
    return { config: null, reason: 'FIXTURE_REQUIRES_CANONICAL_ENTITLEMENTS_AND_ONE_DENIED_NICHE' };
  }
  return { reason: null, config: {
    anonKey: env.SWISH_ANON_KEY, sourceSha: env.GITHUB_SHA, nicheIds,
    owner: { jwt: env.SWISH_OWNER_JWT, userId: env.SWISH_OWNER_USER_ID, tenantId: env.SWISH_OWNER_TENANT_ID },
    subscriber: { jwt: env.SWISH_SUBSCRIBER_JWT, userId: env.SWISH_SUBSCRIBER_USER_ID, tenantId: env.SWISH_SUBSCRIBER_TENANT_ID },
    foreignTenantId: env.SWISH_FOREIGN_TENANT_ID, subscriberNiches,
  } };
}

/** Deny every URL/method/action outside this small diagnostic allowlist. */
export function isAllowedJwtRequest(url, method, body = null) {
  try {
    const target = new URL(url);
    if (target.username || target.password || target.hash) return false;
    if (target.origin === GITHUB_ORIGIN) return method === 'GET' && body === null &&
      target.pathname === '/repos/troonvinyl-ux/SWISH/commits/main' && !target.search;
    if (target.origin === 'https://raw.githubusercontent.com') return method === 'GET' && body === null &&
      /^\/troonvinyl-ux\/SWISH\/[a-f0-9]{40}\/docs\/SWISH_FOUNDATION_MASTER_REGISTER\.json$/i.test(target.pathname) && !target.search;
    if (target.origin !== BACKEND_ORIGIN) return false;
    if (method === 'GET' && body === null) return ['/auth/v1/user', '/rest/v1/tenant_memberships',
      '/rest/v1/niche_entitlements', '/rest/v1/swish_verification_results'].includes(target.pathname);
    if (method !== 'POST' || !body || typeof body !== 'object' || target.search) return false;
    if (['/rest/v1/rpc/swish_is_platform_owner', '/rest/v1/rpc/swish_current_module'].includes(target.pathname)) return Object.keys(body).length === 0;
    if (target.pathname === '/rest/v1/rpc/swish_command_snapshot') return Object.keys(body).every(key =>
      ['p_tenant_id', 'p_platform', 'p_section', 'p_niche_id'].includes(key)) && typeof body.p_platform === 'boolean' &&
      (body.p_tenant_id == null || uuid.test(body.p_tenant_id)) &&
      (body.p_section == null || ['portfolio', ...inspectors].includes(body.p_section)) &&
      (body.p_niche_id == null || /^[a-z_]+$/.test(body.p_niche_id));
    if (target.pathname === '/functions/v1/swish-verification') return uuid.test(body.tenantId ?? '') &&
      Object.keys(body).every(key => ['action', 'tenantId', 'platform', 'sourceSha', 'stageId'].includes(key)) &&
      (body.action === 'list' || (body.action === 'programme' && sha.test(body.sourceSha ?? '') &&
        body.platform === 'unknown' && body.stageId === 'ALL'));
    return false;
  } catch { return false; }
}

async function limitedJson(response) {
  const maximum = 1000000;
  if (Number(response.headers?.get?.('content-length')) > maximum) throw new Error('RESPONSE_TOO_LARGE');
  const reader = response.body?.getReader?.();
  if (!reader) {
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > maximum) throw new Error('RESPONSE_TOO_LARGE');
    return text ? JSON.parse(text) : null;
  }
  let length = 0;
  const parts = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximum) throw new Error('RESPONSE_TOO_LARGE');
      parts.push(Buffer.from(value));
    }
    const text = Buffer.concat(parts).toString('utf8');
    return text ? JSON.parse(text) : null;
  } finally { try { await reader.cancel(); } catch { /* Do not log transport errors. */ } }
}

export async function runCommandJwtVerification(env = process.env, fetchRequest = fetch) {
  const startedAt = new Date().toISOString();
  const checks = [];
  const configResult = loadJwtFixtureConfig(env);
  const report = {
    schemaVersion: 1, mode: 'APPROVED_OWNER_SUBSCRIBER_HTTP', startedAt,
    sourceSha: sha.test(env.GITHUB_SHA ?? '') ? env.GITHUB_SHA : null,
    backendOrigin: BACKEND_ORIGIN, productionReady: false, acceptancePassed: false,
    diagnosticReference: null, checks,
    limitations: ['No S1–S7 task or release is certified by these limited probes.',
      'No device, write isolation, ledger accuracy or provider health acceptance.',
      'Deployed contract is tested; deployed source digest is not attested.',
      'Approved foreign tenant provenance is supplied by the operator; no tenant is created.',
      'Only the existing readiness endpoint may persist diagnostic evidence; no cleanup is performed.'],
  };
  const add = (id, result, reason, httpStatus = null, reference = null) => {
    const record = { id, result, reason, httpStatus, reference: uuid.test(reference ?? '') ? reference : null, checkedAt: new Date().toISOString() };
    checks.push(record);
    return result === 'PASS';
  };
  const finish = () => ({ ...report, completedAt: new Date().toISOString(), acceptancePassed: checks.length > 0 && checks.every(row => row.result === 'PASS') });
  if (!configResult.config) {
    add('FIXTURE-CONFIG', 'BLOCKED', configResult.reason);
    return finish();
  }
  const config = configResult.config;
  const request = async (actor, resource, body = null, publicRequest = false) => {
    const method = body === null ? 'GET' : 'POST';
    const url = publicRequest ? resource : `${BACKEND_ORIGIN}${resource}`;
    if (!isAllowedJwtRequest(url, method, body)) return { status: null, data: null, issue: 'REQUEST_OUTSIDE_DIAGNOSTIC_ALLOWLIST' };
    try {
      const response = await fetchRequest(url, {
        method, redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: publicRequest ? { Accept: 'application/json' } : {
          apikey: config.anonKey, Authorization: `Bearer ${config[actor].jwt}`, Accept: 'application/json',
          ...(body === null ? {} : { 'Content-Type': 'application/json' }),
        }, ...(body === null ? {} : { body: JSON.stringify(body) }),
      });
      try { return { status: response.status, data: await limitedJson(response), issue: null }; }
      catch { return { status: response.status, data: null, issue: 'BOUNDED_JSON_RESPONSE_UNAVAILABLE' }; }
    } catch { return { status: null, data: null, issue: 'NETWORK_TIMEOUT_OR_REDIRECT' }; }
  };
  const assert = (id, response, condition, reason, reference = null) => add(id,
    response.issue || [401, 409, 429, 502, 503, 504].includes(response.status) ? 'BLOCKED' : condition ? 'PASS' : 'FAIL',
    response.issue ?? reason, response.status, reference);
  const rpc = (actor, args) => request(actor, '/rest/v1/rpc/swish_command_snapshot', args);
  const readiness = (actor, tenantId, action) => request(actor, '/functions/v1/swish-verification', {
    action, tenantId, ...(action === 'programme' ? { platform: 'unknown', sourceSha: config.sourceSha, stageId: 'ALL' } : {}),
  });
  const selectEvidence = (actor, reference) => request(actor,
    `/rest/v1/swish_verification_results?select=id,test_id,niche_id,platform,result,evidence,failure_reason,reference_id,created_at,tenant_id,user_id&reference_id=eq.${reference}&limit=100`);

  // Confirm the reviewed source before touching authentication endpoints.
  const main = await request('owner', `${GITHUB_ORIGIN}/repos/troonvinyl-ux/SWISH/commits/main`, null, true);
  if (!assert('CURRENT-MAIN', main, main.status === 200 && main.data?.sha === config.sourceSha, 'PINNED_SOURCE_MUST_MATCH_CURRENT_MAIN')) return finish();
  const register = await request('owner', `https://raw.githubusercontent.com/troonvinyl-ux/SWISH/${config.sourceSha}/docs/SWISH_FOUNDATION_MASTER_REGISTER.json`, null, true);
  const stages = register.data?.stages;
  const validRegister = Array.isArray(stages) && same(sorted(stages.map(row => row.id)), ['S1','S2','S3','S4','S5','S6','S7']) &&
    stages.every(stage => Array.isArray(stage.tasks) && stage.tasks.length && stage.tasks.every(task =>
      typeof task.id === 'string' && task.id.startsWith(`${stage.id}-`) && typeof task.title === 'string'));
  if (!assert('CANONICAL-REQUIREMENTS', register, register.status === 200 && validRegister, 'ORIGINAL_SEVEN_WORKSTREAMS_REQUIRED')) return finish();
  const taskIds = stages.flatMap(stage => stage.tasks.map(task => `READINESS:${task.id}:${config.sourceSha}`));
  if (!unique(taskIds)) { add('CANONICAL-TASK-IDS', 'FAIL', 'DUPLICATE_REQUIREMENT_IDS'); return finish(); }
  add('FIXTURE-CONFIG', 'PASS', 'SECURE_DISTINCT_SHORT_LIVED_FIXTURES_VALIDATED_LOCALLY_NOT_AUTHENTICATED_YET');
  const initialModules = {};
  for (const actor of ['owner', 'subscriber']) {
    const identity = await request(actor, '/auth/v1/user');
    if (!assert(`${actor}-JWT`, identity, identity.status === 200 && identity.data?.id === config[actor].userId,
      'SERVER_AUTH_USER_MUST_MATCH_APPROVED_FIXTURE')) return finish();
    const role = await request(actor, '/rest/v1/rpc/swish_is_platform_owner', {});
    if (!assert(`${actor}-ROLE`, role, role.status === 200 && role.data === (actor === 'owner'),
      'TRUSTED_BACKEND_ROLE_REQUIRED_NOT_CLIENT_EMAIL')) return finish();
    const memberships = await request(actor, `/rest/v1/tenant_memberships?select=tenant_id&user_id=eq.${config[actor].userId}&limit=100`);
    if (!assert(`${actor}-MEMBERSHIP`, memberships, memberships.status === 200 && Array.isArray(memberships.data) &&
      memberships.data.length < 100 && memberships.data.some(row => row.tenant_id === config[actor].tenantId) &&
      !memberships.data.some(row => row.tenant_id === config.foreignTenantId), 'OWN_MEMBERSHIP_AND_NONMEMBER_FOREIGN_FIXTURE_REQUIRED')) return finish();
    const current = await request(actor, '/rest/v1/rpc/swish_current_module', {});
    if (!assert(`${actor}-SESSION-BEFORE`, current, current.status === 200, 'CURRENT_MODULE_READ_ONLY_BASELINE')) return finish();
    initialModules[actor] = current.data;
  }
  const entitlements = await request('subscriber', `/rest/v1/niche_entitlements?select=niche_id,expires_at&user_id=eq.${config.subscriber.userId}&limit=100`);
  const active = Array.isArray(entitlements.data) ? entitlements.data.filter(row => timestamp(row.expires_at) &&
    Date.parse(row.expires_at) > Date.now() + 600000).map(row => row.niche_id) : [];
  if (!assert('subscriber-ENTITLEMENTS', entitlements, entitlements.status === 200 && Array.isArray(entitlements.data) &&
    entitlements.data.length < 100 && unique(active) && same(sorted(active), sorted(config.subscriberNiches)),
    'SERVER_ENTITLEMENTS_MUST_MATCH_APPROVED_SCOPE_WITH_TEN_MINUTE_VALIDITY')) return finish();

  const safeSnapshot = (data, platform, tenantId, ids, owner) => data?.verifiedOwner === owner &&
    data.scope === (platform ? 'platform' : 'tenant') && data.tenantId === (platform ? null : tenantId) && timestamp(data.checkedAt) &&
    Array.isArray(data.modules) && same(sorted(data.modules.map(row => row.id)), sorted(ids)) &&
    Array.isArray(data.activity) && (platform || data.activity.every(row => row.tenant_id === tenantId && ids.includes(row.niche_id))) &&
    (platform || (data.registeredUsers === null && data.activeSubscribers === null && data.subscriptionRevenue === null));
  const ownerPortfolio = await rpc('owner', { p_platform: true });
  assert('owner-PLATFORM-12-NICHES', ownerPortfolio, ownerPortfolio.status === 200 &&
    safeSnapshot(ownerPortfolio.data, true, null, config.nicheIds, true), 'OWNER_PLATFORM_CONTRACT_ALL_CANONICAL_NICHES');
  const ownerTenant = await rpc('owner', { p_platform: false, p_tenant_id: config.owner.tenantId });
  assert('owner-TENANT-SCOPE', ownerTenant, ownerTenant.status === 200 &&
    safeSnapshot(ownerTenant.data, false, config.owner.tenantId, config.nicheIds, true), 'OWNER_TENANT_REPORT_ACTIVITY_REMAINS_TENANT_BOUND');
  const subscriberPortfolio = await rpc('subscriber', { p_platform: false, p_tenant_id: config.subscriber.tenantId });
  assert('subscriber-TENANT-NICHE-SCOPE', subscriberPortfolio, subscriberPortfolio.status === 200 &&
    safeSnapshot(subscriberPortfolio.data, false, config.subscriber.tenantId, config.subscriberNiches, false),
    'EXACT_ENTITLEMENT_SET_NO_FOREIGN_ACTIVITY_OR_PLATFORM_COUNTS');
  const allowedNiche = config.subscriberNiches[0];
  const filtered = await rpc('subscriber', { p_platform: false, p_tenant_id: config.subscriber.tenantId, p_niche_id: allowedNiche });
  assert('subscriber-SELECTED-NICHE-SCOPE', filtered, filtered.status === 200 &&
    safeSnapshot(filtered.data, false, config.subscriber.tenantId, [allowedNiche], false), 'EXPLICIT_NICHE_FILTER_CANNOT_RETURN_OTHER_NICHES');

  // An authenticated denial must be HTTP 403, not a login failure or empty success.
  const deniedRpc = async (id, actor, args) => {
    const response = await rpc(actor, args);
    assert(id, response, response.status === 403 && response.data?.code === '42501', 'HTTP_403_POSTGREST_PERMISSION_DENIAL_REQUIRED');
  };
  await deniedRpc('subscriber-PLATFORM-403', 'subscriber', { p_platform: true });
  for (const section of inspectors) {
    await deniedRpc(`subscriber-INSPECTOR-${section}-platform-403`, 'subscriber', { p_platform: true, p_section: section });
    await deniedRpc(`subscriber-INSPECTOR-${section}-tenant-403`, 'subscriber', { p_platform: false, p_tenant_id: config.subscriber.tenantId, p_section: section });
  }
  for (const actor of ['owner', 'subscriber']) await deniedRpc(`${actor}-FOREIGN-TENANT-403`, actor, { p_platform: false, p_tenant_id: config.foreignTenantId });
  const deniedNiche = config.nicheIds.find(id => !config.subscriberNiches.includes(id));
  await deniedRpc('subscriber-UNENTITLED-NICHE-403', 'subscriber', { p_platform: false, p_tenant_id: config.subscriber.tenantId, p_niche_id: deniedNiche });
  for (const action of ['list', 'programme']) {
    const response = await readiness('subscriber', config.subscriber.tenantId, action);
    const validReference = uuid.test(response.data?.reference ?? '');
    assert(`subscriber-READINESS-${action}-403`, response, response.status === 403 && validReference &&
      response.data?.verifiedOwner !== true && !Array.isArray(response.data?.results), 'HTTP_403_OWNER_GATE_WITH_SANITIZED_REFERENCE', response.data?.reference);
  }
  const foreignReadiness = await readiness('owner', config.foreignTenantId, 'list');
  assert('owner-READINESS-FOREIGN-403', foreignReadiness, foreignReadiness.status === 403 &&
    uuid.test(foreignReadiness.data?.reference ?? '') && foreignReadiness.data?.verifiedOwner !== true,
    'OWNER_STILL_REQUIRES_TENANT_MEMBERSHIP', foreignReadiness.data?.reference);

  // Fail before any diagnostic persistence if a read boundary or prerequisite failed.
  if (checks.some(row => row.result !== 'PASS')) {
    add('READINESS-DIAGNOSTIC-PERSISTENCE', 'BLOCKED', 'READ_BOUNDARY_FAILURE_NO_PROGRAMME_WRITE_ATTEMPTED');
    return finish();
  }
  const programme = await readiness('owner', config.owner.tenantId, 'programme');
  const reference = programme.data?.reference;
  const rows = programme.data?.results;
  const expected = sorted([`PROGRAMME-DB-${config.sourceSha}`, `PROGRAMME-AGGREGATES-${config.sourceSha}`, ...taskIds]);
  const validRows = uuid.test(reference ?? '') && Array.isArray(rows) && rows.length < 100 && rows.every(row =>
    uuid.test(row.id ?? '') && row.reference_id === reference && timestamp(row.created_at) && row.platform === 'unknown' &&
    row.niche_id === null && typeof row.evidence === 'string' && row.evidence.length > 0 &&
    (taskIds.includes(row.test_id) ? row.result === 'BLOCKED' : row.result === 'PASS')) &&
    unique(rows.map(row => row.id)) && same(sorted(rows.map(row => row.test_id)), expected);
  if (!assert('owner-READINESS-REAL-DIAGNOSTICS', programme, programme.status === 200 && programme.data?.verifiedOwner === true &&
    validRows, 'SAFE_DB_AND_AGGREGATE_PASS_FULL_REQUIREMENTS_REMAIN_BLOCKED', reference)) return finish();
  report.diagnosticReference = reference;
  const history = await readiness('owner', config.owner.tenantId, 'list');
  const sameRecord = (stored, returned) => ['id','test_id','niche_id','platform','result','evidence','failure_reason','reference_id','created_at'].every(key => same(stored?.[key], returned?.[key]));
  assert('owner-READINESS-HISTORY-READBACK', history, history.status === 200 && history.data?.verifiedOwner === true &&
    Array.isArray(history.data.results) && rows.every(row => sameRecord(history.data.results.find(stored => stored.id === row.id), row)),
    'ALL_RETURNED_DIAGNOSTICS_RETRIEVED_INDEPENDENTLY_BY_EXISTING_LIST_ENDPOINT', reference);
  const databaseRead = await selectEvidence('owner', reference);
  assert('owner-PERSISTED-REFERENCE-RLS-READBACK', databaseRead, databaseRead.status === 200 && Array.isArray(databaseRead.data) &&
    databaseRead.data.length === rows.length && databaseRead.data.every(stored => stored.tenant_id === config.owner.tenantId &&
    stored.user_id === config.owner.userId && sameRecord(stored, rows.find(row => row.id === stored.id))),
    'DIRECT_CALLER_RLS_READ_MATCHES_IDS_RESULTS_EVIDENCE_TIMESTAMPS_AND_RUN_REFERENCE', reference);
  const subscriberRead = await selectEvidence('subscriber', reference);
  assert('subscriber-PERSISTED-REFERENCE-INVISIBLE', subscriberRead, subscriberRead.status === 200 &&
    Array.isArray(subscriberRead.data) && subscriberRead.data.length === 0, 'AUTHENTICATED_RLS_MUST_HIDE_OWNER_DIAGNOSTICS', reference);
  // Denial references are request IDs only. Owner RLS cannot establish whether
  // records exist in a nonmember tenant; never claim absence from an empty read.
  for (const actor of ['owner', 'subscriber']) {
    const current = await request(actor, '/rest/v1/rpc/swish_current_module', {});
    assert(`${actor}-SESSION-UNCHANGED`, current, current.status === 200 && same(current.data, initialModules[actor]),
      'EXISTING_MODULE_SESSION_UNCHANGED_NO_OPEN_MODULE_CALL');
  }
  return finish();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let report;
  try { report = await runCommandJwtVerification(); }
  catch {
    report = { schemaVersion: 1, productionReady: false, acceptancePassed: false,
      checks: [{ id: 'RUNNER', result: 'BLOCKED', reason: 'UNEXPECTED_RUNNER_FAILURE_SENSITIVE_INPUTS_WITHHELD' }] };
  }
  // Only normalized labels, codes, source identity and UUID diagnostic references.
  // Never persist raw HTTP bodies, headers, user IDs, emails or JWTs.
  fs.writeFileSync('command-jwt-evidence.json', JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify({ acceptancePassed: report.acceptancePassed, productionReady: false,
    diagnosticReference: report.diagnosticReference ?? null,
    passed: report.checks.filter(row => row.result === 'PASS').length,
    failed: report.checks.filter(row => row.result === 'FAIL').length,
    blocked: report.checks.filter(row => row.result === 'BLOCKED').length }));
  if (!report.acceptancePassed) process.exitCode = 1;
}
