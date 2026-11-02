#!/usr/bin/env node
// Approved read-only S3 acceptance. Does not write inventory, send buyer messages or publish listings.
import fs from 'node:fs';
const required = ['S3_BACKEND_URL','S3_ANON_KEY','S3_ACCOUNT_A_EMAIL','S3_ACCOUNT_A_PASSWORD','S3_ACCOUNT_B_EMAIL','S3_ACCOUNT_B_PASSWORD','S3_TENANT_A','S3_TENANT_B','S3_ITEM_A','S3_ITEM_B','S3_NICHE_A','S3_NICHE_B'];
const results = [];
const sessions = [];
const backend = (process.env.S3_BACKEND_URL ?? '').replace(/\/$/, '');
const key = process.env.S3_ANON_KEY;
const check = (name, passed) => { results.push({ name, status: passed ? 'PASSED' : 'FAILED' }); if (!passed) throw new Error(name); };
async function request(route, token, method = 'GET', body) {
  const response = await fetch(backend + route, { method, signal: AbortSignal.timeout(15000), headers: { apikey: key, Authorization: `Bearer ${token || key}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  let data = null;
  try { data = await response.json(); } catch { /* HTTP status remains authoritative. */ }
  return { response, data };
}
try {
  check('Approved fixture configuration', required.every(name => Boolean(process.env[name])) && /^https:\/\//.test(backend));
  check('Fixture tenants and items are distinct', process.env.S3_TENANT_A !== process.env.S3_TENANT_B && process.env.S3_ITEM_A !== process.env.S3_ITEM_B);
  for (const label of ['A','B']) {
    const login = await request('/auth/v1/token?grant_type=password', null, 'POST', { email: process.env[`S3_ACCOUNT_${label}_EMAIL`], password: process.env[`S3_ACCOUNT_${label}_PASSWORD`] });
    check(`${label}: real password authentication`, login.response.ok && Boolean(login.data?.access_token && login.data?.refresh_token && login.data?.user?.id));
    sessions.push(login.data);
  }
  check('Distinct authenticated accounts', sessions[0].user.id !== sessions[1].user.id);
  for (let index = 0; index < 2; index++) {
    const label = index === 0 ? 'A' : 'B'; const other = index === 0 ? 'B' : 'A';
    const refreshed = await request('/auth/v1/token?grant_type=refresh_token', null, 'POST', { refresh_token: sessions[index].refresh_token });
    check(`${label}: session refresh`, refreshed.response.ok && refreshed.data?.user?.id === sessions[index].user.id);
    sessions[index] = refreshed.data;
    const token = sessions[index].access_token;
    const ownTenant = process.env[`S3_TENANT_${label}`]; const ownItem = process.env[`S3_ITEM_${label}`];
    const own = await request(`/rest/v1/items?id=eq.${encodeURIComponent(ownItem)}&tenant_id=eq.${encodeURIComponent(ownTenant)}&select=id,tenant_id,specialist_id`, token);
    check(`${label}: owned fixture visible`, own.response.ok && Array.isArray(own.data) && own.data.length === 1 && own.data[0].id === ownItem && own.data[0].tenant_id === ownTenant);
    const foreign = await request(`/rest/v1/items?id=eq.${encodeURIComponent(process.env[`S3_ITEM_${other}`])}&select=id`, token);
    check(`${label}: foreign item hidden by RLS`, foreign.response.ok && Array.isArray(foreign.data) && foreign.data.length === 0);
    const foreignMembership = await request(`/rest/v1/tenant_memberships?tenant_id=eq.${encodeURIComponent(process.env[`S3_TENANT_${other}`])}&select=id`, token);
    check(`${label}: foreign membership hidden`, foreignMembership.response.ok && Array.isArray(foreignMembership.data) && foreignMembership.data.length === 0);
    const entitlement = await request('/rest/v1/rpc/swish_can_access_niche', token, 'POST', { p_tenant_id: ownTenant, p_niche_id: process.env[`S3_NICHE_${label}`] });
    check(`${label}: trusted owned-niche access`, entitlement.response.ok && entitlement.data === true);
    const denied = await request('/rest/v1/rpc/swish_can_access_niche', token, 'POST', { p_tenant_id: process.env[`S3_TENANT_${other}`], p_niche_id: process.env[`S3_NICHE_${other}`] });
    check(`${label}: cross-tenant niche access denied`, denied.response.ok && denied.data === false);
    const creds = await request(`/rest/v1/marketplace_connectors?tenant_id=eq.${encodeURIComponent(ownTenant)}&select=credential_ref`, token);
    check(`${label}: credential column denied`, [401,403].includes(creds.response.status));
  }
} catch {
  // Never print tokens, account IDs, fixture identifiers, passwords or provider response bodies.
  if (!results.some(result => result.status === 'FAILED')) results.push({ name: 'Live verification request unavailable', status: 'FAILED' });
  process.exitCode = 1;
} finally {
  for (const session of sessions) {
    try { await request('/auth/v1/logout?scope=local', session.access_token, 'POST'); } catch { /* Do not expose session details. */ }
  }
  const report = { schemaVersion: 1, commitSha: process.env.GITHUB_SHA ?? null, backendOrigin: backend || null, checkedAt: new Date().toISOString(), mode: 'READ_ONLY_FIXTURES', complete: results.length > 0 && results.every(result => result.status === 'PASSED'), results, notCovered: ['OTP delivery','media upload','AI provider accuracy','real eBay publish/revise/end','message send','actual order/fee reconciliation','installed device','notification delivery'] };
  fs.writeFileSync('s3-read-only-evidence.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ complete: report.complete, results: report.results, notCovered: report.notCovered }));
}
