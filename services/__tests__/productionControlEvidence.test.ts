import { assessProductionPull, classifyProductionWorkflowJob, getNicheCertification, summarizeProductionWorkflowJobs, validateProductionRegister } from '../productionControlEvidence';
import type { ProductionRegister } from '../productionControlEvidence';
import registerJson from '@/docs/SWISH_FOUNDATION_MASTER_REGISTER.json';
import modules from '@/niche-modules.json';
const nicheIds = Object.keys(modules.products);
const fresh = () => JSON.parse(JSON.stringify(registerJson)) as ProductionRegister;
const sha = 'a'.repeat(40);

describe('Production Control workflow evidence classification', () => {
  test.each([
    ['completed', 'success', 'PASSED'], ['in_progress', null, 'RUNNING'], ['queued', null, 'QUEUED'],
    ['completed', 'failure', 'FAILED'], ['completed', 'cancelled', 'FAILED'], ['completed', null, 'FAILED'],
    ['completed', 'skipped', 'SKIPPED'], ['completed', 'neutral', 'SKIPPED'],
  ])('%s / %s is %s', (status, conclusion, expected) => {
    expect(classifyProductionWorkflowJob({ status: status as string, conclusion })).toBe(expected);
  });
  test('summary never conflates skipped and passed', () => {
    expect(summarizeProductionWorkflowJobs([
      { status: 'completed', conclusion: 'success' }, { status: 'completed', conclusion: 'failure' },
      { status: 'in_progress', conclusion: null }, { status: 'queued', conclusion: null }, { status: 'completed', conclusion: 'skipped' },
    ])).toEqual({ passed: 1, failed: 1, running: 1, queued: 1, skipped: 1 });
  });
});

describe('Untrusted production register', () => {
  test('current register validates without promoting any status', () => {
    const value = fresh();
    const before = JSON.stringify(value);
    expect(validateProductionRegister(value, nicheIds)).toEqual([]);
    expect(JSON.stringify(value)).toBe(before);
  });
  test.each([null, [], 'invalid', { stages: 'invalid' }, { stages: [null] }])('rejects malformed JSON shapes without crashing: %p', value => {
    expect(validateProductionRegister(value, nicheIds).length).toBeGreaterThan(0);
  });
  test('a verified stage cannot contain unfinished tasks', () => {
    const value = fresh(); value.stages[0].status = 'VERIFIED';
    expect(validateProductionRegister(value, nicheIds).join(' ')).toMatch(/unfinished tasks/);
  });
  test('unresolved verification evidence fails closed', () => {
    const value = fresh(); value.stages[0].tasks[0].evidence = 'TBD';
    expect(validateProductionRegister(value, nicheIds).length).toBeGreaterThan(0);
  });
  test('duplicate IDs and weakened programme rules are rejected', () => {
    const value = fresh(); value.stages[1].tasks[0].id = value.stages[0].tasks[0].id; value.rules.noNewDatabase = false;
    expect(validateProductionRegister(value, nicheIds).length).toBeGreaterThanOrEqual(2);
  });
  test('unknown certification niches and areas cannot be smuggled into the matrix', () => {
    const value = fresh(); value.nicheCertification.records = { unknown: { condition: { status: 'VERIFIED', evidence: 'docs/report.md', commitSha: sha, verifiedAt: '2026-10-01T10:00:00Z' } } };
    expect(validateProductionRegister(value, nicheIds).length).toBeGreaterThan(0);
  });
  test.each([{ commitSha: 'short', verifiedAt: '2026-10-01' }, { commitSha: sha, verifiedAt: 'invalid' }, { commitSha: sha, verifiedAt: '2999-01-01' }])('verified certificates require valid commit and timestamp: %p', fields => {
    const value = fresh(); value.nicheCertification.records = { coins: { condition: { status: 'VERIFIED', evidence: 'docs/report.md#condition', ...fields } } };
    expect(validateProductionRegister(value, nicheIds).length).toBeGreaterThan(0);
  });
});

describe('Niche certification is explicit and commit-bound', () => {
  test('absent records produce open gates, not hard-coded completion', () => {
    const result = getNicheCertification(fresh(), 'coins', sha, true);
    expect(result.total).toBe(15); expect(result.verified).toBe(0); expect(result.certified).toBe(false);
  });
  test('records count only on their tested main commit and never offline', () => {
    const value = fresh(); value.nicheCertification.records = { coins: { condition: { status: 'VERIFIED', evidence: 'docs/report.md#condition', commitSha: sha, verifiedAt: '2026-10-01T10:00:00Z' } } };
    expect(getNicheCertification(value, 'coins', sha, true).verified).toBe(1);
    expect(getNicheCertification(value, 'coins', 'b'.repeat(40), true).verified).toBe(0);
    expect(getNicheCertification(value, 'coins', sha, false).gates.find(gate => gate.area === 'condition')?.status).toBe('RECHECK REQUIRED');
    expect(getNicheCertification(value, 'coins', sha, true).certified).toBe(false);
  });
});

describe('Pull requests require complete evidence', () => {
  const passing = { draft: false, mergeable: true, behindBy: 0, checkTotal: 1, checkPassed: 1, checkFailed: 0, checkPending: 0, checksComplete: true };
  test('known passing checks still require human review', () => { expect(assessProductionPull(passing).label).toBe('CHECKS PASS — REVIEW REQUIRED'); });
  test.each([
    { mergeable: null }, { behindBy: undefined }, { behindBy: 1 }, { checksComplete: false },
    { checkTotal: 0 }, { checkPassed: 0 }, { checkFailed: 1 }, { checkPending: 1 }, { draft: true },
  ])('missing, stale or failed evidence is never green: %p', changes => {
    expect(assessProductionPull({ ...passing, ...changes }).tone).not.toBe('good');
  });
});
