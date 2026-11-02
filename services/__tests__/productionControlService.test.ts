import registerJson from '@/docs/SWISH_FOUNDATION_MASTER_REGISTER.json';
import modules from '@/niche-modules.json';

const mainSha = 'a'.repeat(40);
const oldSha = 'b'.repeat(40);
const repository = 'troonvinyl-ux/SWISH';
const run = (id = 1, sha = mainSha) => ({ id, name: 'Renamed workflow', display_title: 'Test run', html_url: `https://github.com/${repository}/actions/runs/${id}`, status: 'completed', conclusion: 'success', head_branch: 'main', head_sha: sha, created_at: '2026-11-01T12:00:00Z', event: 'push' });
const response = (body: unknown, status = 200, headers: Record<string, string> = {}) => ({ ok: status >= 200 && status < 300, status, headers: { get: (name: string) => headers[name] ?? null }, json: async () => body });
const mockFetch = jest.fn();
const originalFetch = global.fetch;
let service: typeof import('../productionControlService');

function routeResponse(url: string) {
  if (url.includes('/commits/main')) return response({ sha: mainSha });
  if (url.endsWith('/SWISH_FOUNDATION_MASTER_REGISTER.json')) return response(registerJson);
  if (url.endsWith('/niche-modules.json')) return response(modules);
  if (url.includes('/pulls?')) return response([]);
  if (url.includes('/actions/workflows/')) return response({ workflow_runs: [run()] });
  if (url.includes('/jobs?')) return response({ jobs: [{ id: 11, name: 'Validate evidence', status: 'completed', conclusion: 'success', steps: [] }], total_count: 1 });
  if (url.includes('/artifacts?')) return response({ artifacts: [{ id: 12, name: 'swish-web-coins', expired: false, size_in_bytes: 1000, expires_at: '2026-11-15T12:00:00Z' }], total_count: 1 });
  if (url.includes('/actions/runs?')) return response({ workflow_runs: [] });
  throw new Error(`Unexpected test URL ${url}`);
}

beforeEach(() => {
  jest.resetModules(); jest.useFakeTimers(); jest.setSystemTime(new Date('2026-11-02T12:00:00Z'));
  global.fetch = mockFetch as typeof fetch; mockFetch.mockReset(); mockFetch.mockImplementation(async (url: string) => routeResponse(url));
  service = require('../productionControlService');
});
afterEach(() => { jest.useRealTimers(); global.fetch = originalFetch; });

test('discovers workflow by filename even when it has fallen outside the recent run list', async () => {
  const snapshot = await service.fetchProductionSnapshot();
  expect(snapshot.source).toBe('LIVE'); expect(snapshot.workflows).toHaveLength(3);
  expect(snapshot.workflows[0].run?.name).toBe('Renamed workflow');
  expect(mockFetch.mock.calls.some(([url]) => url.includes('/workflows/branded-web-builds.yml/runs?branch=main'))).toBe(true);
  const rawUrls = mockFetch.mock.calls.map(([url]) => url).filter(url => url.includes('raw.githubusercontent.com'));
  expect(rawUrls).toHaveLength(2); expect(rawUrls.every(url => url.includes(`/${mainSha}/`))).toBe(true);
});
test('PR-event and non-main runs never substitute for main acceptance', () => {
  expect(service.selectProductionRun([{ ...run(1), event: 'pull_request' }, { ...run(2), head_branch: 'feature' }, run(3, oldSha)])?.id).toBe(3);
});
test('artifact errors preserve jobs and are exposed explicitly', async () => {
  mockFetch.mockImplementation(async (url: string) => url.includes('/artifacts?') ? response({}, 503) : routeResponse(url));
  const snapshot = await service.fetchProductionSnapshot();
  expect(snapshot.workflows[0].jobs).toHaveLength(1); expect(snapshot.workflows[0].artifacts).toHaveLength(0);
  expect(snapshot.workflows[0].errors.join(' ')).toContain('503');
});
test('invalid live register retains a clearly labelled bundled fallback', async () => {
  mockFetch.mockImplementation(async (url: string) => url.endsWith('/SWISH_FOUNDATION_MASTER_REGISTER.json') ? response({ stages: 'invalid' }) : routeResponse(url));
  const snapshot = await service.fetchProductionSnapshot();
  expect(snapshot.source).toBe('BUNDLED'); expect(snapshot.mainSha).toBe(''); expect(snapshot.errors.length).toBeGreaterThan(0);
});
test('failed refresh preserves historical evidence without a live label', async () => {
  const first = await service.fetchProductionSnapshot(); jest.advanceTimersByTime(61_000);
  mockFetch.mockImplementation(async () => response({}, 503));
  const second = await service.fetchProductionSnapshot(true);
  expect(second.source).toBe('CACHED'); expect(second.register).toEqual(first.register); expect(second.refreshedAt).toBe(first.refreshedAt);
});
test('overlapping refreshes share one request and normal refresh reuses cache', async () => {
  const first = service.fetchProductionSnapshot(); const second = service.fetchProductionSnapshot(true);
  expect(first).toBe(second); await first;
  const count = mockFetch.mock.calls.length; await service.fetchProductionSnapshot();
  expect(mockFetch).toHaveBeenCalledTimes(count);
});
test('GitHub rate-limit response establishes backoff and does not display zero live data', async () => {
  const reset = Math.floor(Date.now() / 1000) + 3600;
  mockFetch.mockResolvedValue(response({}, 403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) }));
  const snapshot = await service.fetchProductionSnapshot();
  expect(snapshot.source).toBe('BUNDLED'); expect(snapshot.openPullCount).toBeNull(); expect(snapshot.retryAt).toBe(reset * 1000);
  const count = mockFetch.mock.calls.length; await service.fetchProductionSnapshot(true); expect(mockFetch).toHaveBeenCalledTimes(count);
});
test('hanging requests time out and settle the refresh', async () => {
  mockFetch.mockImplementation((_url: string, options: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new Error('Aborted')));
  }));
  const pending = service.fetchProductionSnapshot(); await jest.advanceTimersByTimeAsync(15_001);
  const snapshot = await pending; expect(snapshot.errors.join(' ')).toContain('timed out'); expect(snapshot.source).toBe('BUNDLED');
});
test('PR head changes invalidate check evidence instead of pairing checks with a different head', async () => {
  const pull = { number: 7, title: 'Test PR', draft: false, mergeable: null, html_url: `https://github.com/${repository}/pull/7`, head: { sha: oldSha, ref: 'feature' }, base: { ref: 'main' }, updated_at: '2026-11-01' };
  mockFetch.mockImplementation(async (url: string) => {
    if (url.includes('/pulls?')) return response([pull]);
    if (url.endsWith('/pulls/7')) return response({ ...pull, head: { sha: mainSha, ref: 'feature' }, mergeable: true });
    if (url.includes('/compare/')) return response({ behind_by: 0 });
    if (url.includes('/check-runs?')) return response({ total_count: 1, check_runs: [{ status: 'completed', conclusion: 'success' }] });
    if (url.includes('/status?')) return response({ total_count: 0, statuses: [] });
    return routeResponse(url);
  });
  const snapshot = await service.fetchProductionSnapshot();
  expect(snapshot.pulls[0].checksComplete).toBe(false); expect(snapshot.pulls[0].checkPassed).toBeUndefined();
});
