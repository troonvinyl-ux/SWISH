export type ProductionWorkflowJobState = 'PASSED' | 'FAILED' | 'RUNNING' | 'QUEUED' | 'SKIPPED';

export type ProductionWorkflowJobLike = {
  status: string;
  conclusion: string | null;
};

export type ProductionWorkflowJobSummary = {
  passed: number;
  failed: number;
  running: number;
  queued: number;
  skipped: number;
};

export function classifyProductionWorkflowJob(job: ProductionWorkflowJobLike): ProductionWorkflowJobState {
  if (job.status !== 'completed') {
    return job.status === 'in_progress' ? 'RUNNING' : 'QUEUED';
  }
  if (job.conclusion === 'success') return 'PASSED';
  if (job.conclusion === 'skipped' || job.conclusion === 'neutral') return 'SKIPPED';
  return 'FAILED';
}

export function summarizeProductionWorkflowJobs(jobs: ProductionWorkflowJobLike[]): ProductionWorkflowJobSummary {
  return jobs.reduce<ProductionWorkflowJobSummary>((summary, job) => {
    const state = classifyProductionWorkflowJob(job);
    if (state === 'PASSED') summary.passed += 1;
    else if (state === 'FAILED') summary.failed += 1;
    else if (state === 'RUNNING') summary.running += 1;
    else if (state === 'QUEUED') summary.queued += 1;
    else summary.skipped += 1;
    return summary;
  }, { passed: 0, failed: 0, running: 0, queued: 0, skipped: 0 });
}
