// Injected HTTP fixtures only. These tests never contact production or authenticate real users.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { BACKEND_ORIGIN, isAllowedJwtRequest, loadJwtFixtureConfig, runCommandJwtVerification } from './verify-command-jwt.mjs';
const token = claims => `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.unit-test-only`;
const id = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const sourceSha = 'a'.repeat(40);
function fixtures() {
  const expires = Math.floor(Date.now() / 1000) + 3600;
  return {
    SWISH_APPROVED_JWT_READS: '1', SWISH_APPROVED_DIAGNOSTIC_EVIDENCE: '1', GITHUB_SHA: sourceSha,
    SWISH_ANON_KEY: token({ role: 'anon' }), SWISH_OWNER_USER_ID: id(1), SWISH_SUBSCRIBER_USER_ID: id(2),
    SWISH_OWNER_TENANT_ID: id(3), SWISH_SUBSCRIBER_TENANT_ID: id(4), SWISH_FOREIGN_TENANT_ID: id(5),
    SWISH_OWNER_JWT: token({ sub: id(1), role: 'authenticated', exp: expires }),
    SWISH_SUBSCRIBER_JWT: token({ sub: id(2), role: 'authenticated', exp: expires }), SWISH_SUBSCRIBER_NICHES: 'coins',
  };
}
function transport(env, options = {}) {
  const config = loadJwtFixtureConfig(env).config;
  const calls = [];
  const time = new Date().toISOString();
  const reference = id(100);
  const stages = ['S1','S2','S3','S4','S5','S6','S7'].map(stage => ({ id: stage, name: stage, tasks: [{ id: `${stage}-01`, title: 'Controlled unit fixture' }] }));
  const rows = [`PROGRAMME-DB-${sourceSha}`, `PROGRAMME-AGGREGATES-${sourceSha}`,
    ...stages.map(stage => `READINESS:${stage.id}-01:${sourceSha}`)].map((testId, index) => ({
    id: id(200 + index), test_id: testId, niche_id: null, platform: 'unknown',
    result: index < 2 ? 'PASS' : 'BLOCKED', evidence: index < 2 ? 'Controlled read-only fixture' : 'Full acceptance not executed',
    failure_reason: index < 2 ? null : 'Executor required', reference_id: reference, created_at: time,
  }));
  let denialNumber = 300;
  const fetchRequest = async (url, request) => {
    const target = new URL(url);
    const body = request.body ? JSON.parse(request.body) : null;
    assert.equal(isAllowedJwtRequest(url, request.method, body), true);
    assert.equal(request.redirect, 'error');
    calls.push({ pathname: target.pathname, method: request.method, body });
    const subscriber = request.headers.Authorization === `Bearer ${env.SWISH_SUBSCRIBER_JWT}`;
    const actor = subscriber ? config.subscriber : config.owner;
    const reply = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
    if (target.hostname === 'api.github.com') return reply({ sha: options.changedMain ? 'b'.repeat(40) : sourceSha });
    if (target.hostname === 'raw.githubusercontent.com') return reply({ stages });
    assert.equal(target.origin, BACKEND_ORIGIN);
    assert.equal(request.headers.apikey, env.SWISH_ANON_KEY);
    if (target.pathname === '/auth/v1/user') return reply({ id: options.wrongActor && subscriber ? id(99) : actor.userId, email: 'NEVER_RETAIN_FIXTURE_EMAIL' });
    if (target.pathname === '/rest/v1/rpc/swish_is_platform_owner') return reply(!subscriber);
    if (target.pathname === '/rest/v1/tenant_memberships') return reply([{ tenant_id: actor.tenantId }]);
    if (target.pathname === '/rest/v1/niche_entitlements') return reply([{ niche_id: 'coins', expires_at: new Date(Date.now() + 3600000).toISOString() }]);
    if (target.pathname === '/rest/v1/rpc/swish_current_module') return reply({ tenant_id: actor.tenantId, niche_id: 'coins' });
    if (target.pathname === '/rest/v1/rpc/swish_command_snapshot') {
      const denied = (subscriber && (body.p_platform || body.p_section || body.p_niche_id === 'motocross')) || body.p_tenant_id === config.foreignTenantId;
      if (denied) return reply({ code: '42501', message: env.SWISH_SUBSCRIBER_JWT }, options.denialStatus ?? 403);
      const modules = subscriber ? ['coins'] : config.nicheIds;
      return reply({ verifiedOwner: !subscriber, scope: body.p_platform ? 'platform' : 'tenant',
        tenantId: body.p_platform ? null : actor.tenantId, checkedAt: time,
        registeredUsers: null, activeSubscribers: null, subscriptionRevenue: null,
        modules: (options.extraNiche && subscriber && !body.p_niche_id ? ['coins', 'tech'] : body.p_niche_id ? [body.p_niche_id] : modules).map(niche => ({ id: niche })),
        activity: options.foreignActivity && subscriber ? [{ tenant_id: config.foreignTenantId, niche_id: 'coins' }] : [],
      });
    }
    if (target.pathname === '/functions/v1/swish-verification') {
      if (subscriber || body.tenantId === config.foreignTenantId) return reply({ error: 'Denied', reference: id(denialNumber++) }, 403);
      if (body.action === 'programme') return reply({ verifiedOwner: true, reference, results: rows });
      return reply({ verifiedOwner: true, reference: id(400), results: options.missingHistory ? [] : rows });
    }
    if (target.pathname === '/rest/v1/swish_verification_results') {
      if (subscriber) return reply(options.leakEvidence ? rows : []);
      if (target.searchParams.get('reference_id') !== `eq.${reference}`) return reply([]);
      return reply(rows.map(row => ({ ...row, user_id: config.owner.userId, tenant_id: config.owner.tenantId,
        ...(options.changedEvidence ? { evidence: 'CHANGED_EVIDENCE' } : {}),
      })));
    }
    throw new Error('Unit transport denied unknown route');
  };
  return { calls, fetchRequest };
}

test('missing configuration/approval makes zero requests and never reports acceptance', async () => {
  let calls = 0;
  const report = await runCommandJwtVerification({}, async () => { calls++; throw new Error('Unexpected HTTP'); });
  assert.equal(calls, 0);
  assert.equal(report.acceptancePassed, false);
  assert.equal(report.productionReady, false);
  assert.equal(report.checks[0].result, 'BLOCKED');
});

test('rejects service keys, expired/reused identities and all-niche negative fixtures before HTTP', () => {
  for (const patch of [
    { SWISH_ANON_KEY: token({ role: 'service_role' }) },
    { SWISH_OWNER_JWT: token({ role: 'service_role', sub: id(1), exp: 9999999999 }) },
    { SWISH_SUBSCRIBER_JWT: token({ role: 'authenticated', sub: id(2), exp: 1 }) },
    { SWISH_SUBSCRIBER_USER_ID: id(1) },
    { SWISH_SUBSCRIBER_NICHES: 'coins,coins' },
    { SWISH_FOREIGN_TENANT_ID: id(3) },
  ]) assert.equal(loadJwtFixtureConfig({ ...fixtures(), ...patch }).config, null);
});

test('allowlist refuses seller calls, auth refresh, module writes, table writes and redirects', () => {
  for (const [resource, method, body] of [
    ['/functions/v1/swish-ebay-list', 'POST', { route: 'get_seller_policies' }],
    ['/functions/v1/swish-identify', 'POST', {}],
    ['/auth/v1/token', 'POST', { grant_type: 'refresh_token' }],
    ['/rest/v1/items', 'POST', {}],
    ['/rest/v1/items', 'DELETE', null],
    ['/rest/v1/rpc/swish_open_module', 'POST', {}],
    ['/functions/v1/swish-verification', 'POST', { action: 'ebay', tenantId: id(3) }],
    ['/functions/v1/swish-verification', 'POST', { action: 'run', tenantId: id(3) }],
  ]) assert.equal(isAllowedJwtRequest(`${BACKEND_ORIGIN}${resource}`, method, body), false);
  assert.equal(isAllowedJwtRequest('https://untrusted.invalid/auth/v1/user', 'GET'), false);
});

test('successful unit transport verifies denials and independent persistence without retaining private data', async () => {
  const env = fixtures();
  const mock = transport(env);
  const report = await runCommandJwtVerification(env, mock.fetchRequest);
  assert.equal(report.acceptancePassed, true);
  assert.equal(report.productionReady, false);
  assert.equal(report.diagnosticReference, id(100));
  assert.equal(mock.calls.filter(call => call.pathname === '/functions/v1/swish-verification' && call.body.action === 'programme' && call.body.tenantId === id(3)).length, 1);
  assert.equal(report.checks.find(row => row.id === 'owner-PERSISTED-REFERENCE-RLS-READBACK').result, 'PASS');
  assert.equal(report.checks.find(row => row.id === 'subscriber-PERSISTED-REFERENCE-INVISIBLE').result, 'PASS');
  const serialized = JSON.stringify(report);
  for (const privateValue of [env.SWISH_OWNER_JWT, env.SWISH_SUBSCRIBER_JWT, env.SWISH_ANON_KEY,
    env.SWISH_OWNER_USER_ID, env.SWISH_SUBSCRIBER_USER_ID, env.SWISH_OWNER_TENANT_ID,
    env.SWISH_SUBSCRIBER_TENANT_ID, env.SWISH_FOREIGN_TENANT_ID, 'NEVER_RETAIN_FIXTURE_EMAIL']) assert.equal(serialized.includes(privateValue), false);
});

for (const [name, options] of [
  ['wrong authenticated identity', { wrongActor: true }],
  ['unexpected allowed niche', { extraNiche: true }],
  ['foreign activity leakage', { foreignActivity: true }],
  ['200 is not a permission denial', { denialStatus: 200 }],
  ['401 is not an authenticated 403', { denialStatus: 401 }],
  ['main moved', { changedMain: true }],
]) test(`${name}: fails closed before owner diagnostic persistence`, async () => {
  const env = fixtures(); const mock = transport(env, options);
  const report = await runCommandJwtVerification(env, mock.fetchRequest);
  assert.equal(report.acceptancePassed, false);
  assert.equal(mock.calls.some(call => call.pathname === '/functions/v1/swish-verification' && call.body.action === 'programme' && call.body.tenantId === id(3)), false);
});

for (const [name, options] of [
  ['history missing', { missingHistory: true }],
  ['independent evidence mismatched', { changedEvidence: true }],
  ['subscriber can see owner evidence', { leakEvidence: true }],
]) test(`${name}: cannot report persistence/isolation acceptance`, async () => {
  const env = fixtures(); const mock = transport(env, options);
  const report = await runCommandJwtVerification(env, mock.fetchRequest);
  assert.equal(report.acceptancePassed, false);
  assert.equal(report.checks.some(row => row.result === 'FAIL'), true);
  assert.equal(report.productionReady, false);
});

test('network errors never retain response errors, URLs, JWTs or private fixture values', async () => {
  const env = fixtures();
  const report = await runCommandJwtVerification(env, async () => { throw new Error(`${env.SWISH_OWNER_JWT} https://private.invalid`); });
  assert.equal(report.checks[0].result, 'BLOCKED');
  assert.equal(JSON.stringify(report).includes(env.SWISH_OWNER_JWT), false);
  assert.equal(JSON.stringify(report).includes('private.invalid'), false);
});

test('CLI without approval writes blocked evidence and exits nonzero without credentials', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'swish-jwt-unit-'));
  try {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('./verify-command-jwt.mjs', import.meta.url))], {
      cwd: directory, encoding: 'utf8', env: {},
    });
    assert.equal(result.status, 1);
    const evidence = JSON.parse(fs.readFileSync(path.join(directory, 'command-jwt-evidence.json'), 'utf8'));
    assert.equal(evidence.checks[0].result, 'BLOCKED');
    assert.equal(evidence.acceptancePassed, false);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
