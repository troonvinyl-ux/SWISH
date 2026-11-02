// Executes the dependency checker against real source and isolated filesystem fixtures.
// It does not invoke any deployed handler or use credentials.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(__dirname, '../..');
const gate = path.join(root, 'scripts/validate-edge-deployment.mjs');
function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'swish-edge-boundary-'));
  fs.cpSync(path.join(root, 'supabase/functions'), path.join(directory, 'supabase/functions'), { recursive: true });
  fs.cpSync(path.join(root, 'shared'), path.join(directory, 'shared'), { recursive: true });
  fs.copyFileSync(path.join(root, 'niche-modules.json'), path.join(directory, 'niche-modules.json'));
  return directory;
}
function check(directory: string) {
  return spawnSync(process.execPath, [gate], { cwd: directory, encoding: 'utf8' });
}

test('all 25 real Edge Functions have contained local dependencies and canonical asset parity', () => {
  const result = check(root);
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('25 functions');
  expect(result.stdout).toContain('not deployed-version or live acceptance certification');
});

test.each(['outside', 'missing', 'stale'])('rejects %s deployment dependency without executing handlers', failure => {
  const directory = fixture();
  try {
    if (failure === 'stale') {
      fs.appendFileSync(path.join(directory, 'supabase/functions/_shared/nicheAuthorization.ts'), '\n// unauthorized drift\n');
    } else {
      fs.appendFileSync(path.join(directory, 'supabase/functions/swish-identify/index.ts'),
        failure === 'outside' ? "\nimport '../../../shared/nicheAuthorization.ts';\n" : "\nimport '../_shared/absent.ts';\n");
    }
    const result = check(directory);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('FAILED');
    expect(result.stderr).toContain(failure === 'outside' ? 'escapes' : failure === 'missing' ? 'missing deployment dependency' : 'stale');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
