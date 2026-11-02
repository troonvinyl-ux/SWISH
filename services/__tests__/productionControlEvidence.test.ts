import { classifyProductionWorkflowJob, summarizeProductionWorkflowJobs } from '../productionControlEvidence';

describe('Production Control workflow evidence classification', () => {
  test('only completed successful jobs count as passed', () => {
    expect(classifyProductionWorkflowJob({ status: 'completed', conclusion: 'success' })).toBe('PASSED');
    expect(classifyProductionWorkflowJob({ status: 'in_progress', conclusion: null })).toBe('RUNNING');
    expect(classifyProductionWorkflowJob({ status: 'queued', conclusion: null })).toBe('QUEUED');
  });

  test('completed failures never appear as successful and skipped jobs stay separate', () => {
    expect(classifyProductionWorkflowJob({ status: 'completed', conclusion: 'failure' })).toBe('FAILED');
    expect(classifyProductionWorkflowJob({ status: 'completed', conclusion: 'cancelled' })).toBe('FAILED');
    expect(classifyProductionWorkflowJob({ status: 'completed', conclusion: 'skipped' })).toBe('SKIPPED');
    expect(classifyProductionWorkflowJob({ status: 'completed', conclusion: 'neutral' })).toBe('SKIPPED');
  });

  test('summary keeps passed, failed, running, queued and skipped counts distinct', () => {
    expect(summarizeProductionWorkflowJobs([
      { status: 'completed', conclusion: 'success' },
      { status: 'completed', conclusion: 'failure' },
      { status: 'in_progress', conclusion: null },
      { status: 'queued', conclusion: null },
      { status: 'completed', conclusion: 'skipped' },
    ])).toEqual({ passed: 1, failed: 1, running: 1, queued: 1, skipped: 1 });
  });
});
