import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import registerJson from '@/docs/SWISH_FOUNDATION_MASTER_REGISTER.json';
import modules from '@/niche-modules.json';
import { validateProductionRegister } from '../productionControlEvidence';
const validator = path.resolve(__dirname, '../../scripts/validate-production-register.mjs');
const fresh = () => JSON.parse(JSON.stringify(registerJson));

function runValidator(value: unknown) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'swish-register-'));
  try {
    fs.mkdirSync(path.join(directory, 'docs'));
    fs.writeFileSync(path.join(directory, 'docs/SWISH_FOUNDATION_MASTER_REGISTER.json'), JSON.stringify(value));
    fs.writeFileSync(path.join(directory, 'niche-modules.json'), JSON.stringify(modules));
    const before = fs.readFileSync(path.join(directory, 'docs/SWISH_FOUNDATION_MASTER_REGISTER.json'), 'utf8');
    const result = spawnSync(process.execPath, [validator], { cwd: directory, encoding: 'utf8' });
    expect(fs.readFileSync(path.join(directory, 'docs/SWISH_FOUNDATION_MASTER_REGISTER.json'), 'utf8')).toBe(before);
    return result;
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

test('CLI validates the real register without mutating it or declaring production certification', () => {
  const result = runValidator(fresh()); expect(result.status).toBe(0);
  expect(result.stdout).toContain('not production certification');
});
test.each([null, [], { stages: {} }, { stages: [null] }])('CLI handles malformed register without an unhandled TypeError: %p', value => {
  const result = runValidator(value); expect(result.status).toBe(1); expect(result.stderr).toContain('FAILED'); expect(result.stderr).not.toContain('TypeError');
});
test('CLI and runtime both reject a false-green stage', () => {
  const value = fresh(); value.stages[0].status = 'VERIFIED';
  expect(runValidator(value).status).toBe(1); expect(validateProductionRegister(value, Object.keys(modules.products)).length).toBeGreaterThan(0);
});
test('CLI and runtime agree on explicit niche certificate requirements', () => {
  const value = fresh(); value.nicheCertification.records = { coins: { condition: { status: 'VERIFIED', evidence: 'docs/report.md#condition', commitSha: 'a'.repeat(40), verifiedAt: '2026-10-01T10:00:00Z' } } };
  expect(runValidator(value).status).toBe(0); expect(validateProductionRegister(value, Object.keys(modules.products))).toEqual([]);
  value.nicheCertification.records.coins.condition.commitSha = 'short';
  expect(runValidator(value).status).toBe(1); expect(validateProductionRegister(value, Object.keys(modules.products)).length).toBeGreaterThan(0);
});
test('Master Admin and root navigation expose the readiness system explicitly', () => {
  const root = path.resolve(__dirname, '../..');
  expect(fs.readFileSync(path.join(root, 'app/master-admin.tsx'), 'utf8')).toContain("router.push('/production-control'");
  expect(fs.readFileSync(path.join(root, 'app/_layout.tsx'), 'utf8')).toContain('name="production-control"');
  expect(fs.readFileSync(path.join(root, 'master-admin-app/production-control.tsx'), 'utf8')).toContain('@/app/production-control');
  expect(fs.readFileSync(path.join(root, 'master-admin-app/_layout.tsx'), 'utf8')).toContain('name="production-control"');
});
