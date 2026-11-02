#!/usr/bin/env node
// Explicit, read-only production GET probes. No credentials, AI, eBay mutations or fixtures.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const BACKEND_ORIGIN = 'https://iwgaqieyoahmcjfziwga.backend.onspace.ai';
export const EDGE_SMOKE_FUNCTIONS = [
  'swish-check-subscription', 'swish-coin-image-enhance', 'swish-create-checkout',
  'swish-customer-portal', 'swish-decompose', 'swish-ebay-browse', 'swish-ebay-category',
  'swish-ebay-draft-sync-test', 'swish-ebay-finances', 'swish-ebay-list',
  'swish-ebay-listing-status', 'swish-ebay-messages', 'swish-ebay-oauth', 'swish-ebay-orders',
  'swish-ebay-post-order', 'swish-ebay-sync', 'swish-identify', 'swish-image-download',
  'swish-islamic-identify', 'swish-list-generate', 'swish-market-value',
  'swish-migrate-credentials', 'swish-privacy-policy', 'swish-reprice', 'swish-verify',
];
export async function runEdgeSmoke(fetchRequest = fetch) {
  const results = [];
  // Sequential probes keep production pressure low. No automatic retries.
  for (const functionName of EDGE_SMOKE_FUNCTIONS) {
    const startedAt = new Date().toISOString();
    try {
      const response = await fetchRequest(`${BACKEND_ORIGIN}/functions/v1/${functionName}`, {
        method: 'GET', redirect: 'error', signal: AbortSignal.timeout(15000),
      });
      // Never read or retain provider payloads, redirect URLs, tokens or response headers.
      const passed = functionName === 'swish-privacy-policy'
        ? response.status === 200 : [401, 403, 405].includes(response.status);
      results.push({ functionName, startedAt, completedAt: new Date().toISOString(),
        method: 'GET', inputCategory: 'NO_AUTH_NO_BODY', httpStatus: response.status,
        status: passed ? 'PASSED' : 'FAILED',
        outcome: passed ? (functionName === 'swish-privacy-policy' ? 'PUBLIC_DOCUMENT_AVAILABLE' : 'ANONYMOUS_OR_METHOD_REJECTED') : 'UNEXPECTED_HTTP_STATUS',
        deployedVersion: null });
      try { await response.body?.cancel(); } catch { /* No response payload is logged. */ }
    } catch {
      results.push({ functionName, startedAt, completedAt: new Date().toISOString(),
        method: 'GET', inputCategory: 'NO_AUTH_NO_BODY', httpStatus: null,
        status: 'BLOCKED', outcome: 'NETWORK_OR_REDIRECT_UNAVAILABLE', deployedVersion: null });
    }
  }
  return { schemaVersion: 1, backendOrigin: BACKEND_ORIGIN, mode: 'UNAUTHENTICATED_GET_SMOKE',
    commitSha: /^[0-9a-f]{40}$/i.test(process.env.GITHUB_SHA ?? '') ? process.env.GITHUB_SHA : null,
    checkedAt: new Date().toISOString(), smokePassed: results.every(result => result.status === 'PASSED'),
    productionReady: false, results,
    notCovered: ['Deployment revision parity', 'POST authentication', 'Tenant/niche/paid access',
      'Login/logout', 'Storage uploads', 'AI accuracy', 'eBay OAuth or provider calls',
      'Unpublished offer round-trip', 'Orders/messages/finance reconciliation', 'Web/device parity'] };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.env.SWISH_APPROVED_EDGE_SMOKE !== '1') {
    console.error('BLOCKED: explicit approval required (SWISH_APPROVED_EDGE_SMOKE=1). No requests made.');
    process.exitCode = 1;
  } else {
    const report = await runEdgeSmoke();
    fs.writeFileSync('edge-smoke-evidence.json', JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ smokePassed: report.smokePassed, productionReady: false, results: report.results }));
    if (!report.smokePassed) process.exitCode = 1;
  }
}
