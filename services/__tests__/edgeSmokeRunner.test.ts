// Unit tests with an injected transport, not live acceptance or production requests.
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const root = path.resolve(__dirname, '../..');
const moduleUrl = new URL('../../scripts/verify-edge-smoke.mjs', 'file://' + __filename).href;

test('CLI refuses to contact production without explicit approval', () => {
  const result = spawnSync(process.execPath, ['scripts/verify-edge-smoke.mjs'], {
    cwd: root, encoding: 'utf8', env: { ...process.env, SWISH_APPROVED_EDGE_SMOKE: '' },
  });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('No requests made');
});

test('smoke evidence records statuses, not private response payloads or live acceptance', () => {
  const code = `
    import { runEdgeSmoke } from ${JSON.stringify(moduleUrl)};
    let count = 0;
    const report = await runEdgeSmoke(async (url, options) => {
      count++;
      if (options.method !== 'GET' || options.body || options.headers) throw new Error('Unsafe request');
      return { status: url.endsWith('swish-privacy-policy') ? 200 : url.endsWith('swish-identify') ? 500 : 405,
        body: { cancel: async () => {} }, text: async () => { throw new Error('Never read response payload'); } };
    });
    console.log(JSON.stringify({ count, report }));
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: root, encoding: 'utf8' });
  expect(result.status).toBe(0);
  const data = JSON.parse(result.stdout);
  expect(data.count).toBe(25);
  expect(data.report.smokePassed).toBe(false);
  expect(data.report.productionReady).toBe(false);
  expect(data.report.results.find((row: { functionName: string }) => row.functionName === 'swish-identify').httpStatus).toBe(500);
  expect(data.report.results.every((row: { deployedVersion: unknown; startedAt: string }) => row.deployedVersion === null && Boolean(row.startedAt))).toBe(true);
});
