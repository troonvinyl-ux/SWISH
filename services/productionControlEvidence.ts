export type ProductionWorkflowJobState = 'PASSED' | 'FAILED' | 'RUNNING' | 'QUEUED' | 'SKIPPED';
export type ProductionWorkflowJobLike = { status: string; conclusion: string | null };
export type ProductionWorkflowJobSummary = { passed: number; failed: number; running: number; queued: number; skipped: number };
export const PRODUCTION_STATUSES = ['NOT STARTED', 'IN PROGRESS', 'IMPLEMENTED', 'TESTING', 'VERIFIED', 'BLOCKED'] as const;
export type ProductionStatus = typeof PRODUCTION_STATUSES[number];
export interface ProductionTask { id: string; title: string; status: ProductionStatus; evidence?: string }
export interface ProductionStage { id: string; name: string; goal: string; status: ProductionStatus; tasks: ProductionTask[] }
export interface NicheCertificationRecord { status: ProductionStatus; evidence?: string; commitSha?: string; verifiedAt?: string }
export interface ProductionRegister {
  schemaVersion: number; programme: string; repository: string; defaultBranch: string;
  sourcePromptPath?: string; statuses: string[]; rules: Record<string, boolean>;
  stages: ProductionStage[]; knownReleaseRisks: string[];
  nicheCertification: { source: string; requiredAreas: string[]; records?: Record<string, Record<string, NicheCertificationRecord>> };
}
export interface ProductionNiche { id: string; name: string; entry: string }
export const PRODUCTION_RULES = ['noRebuild', 'noNewDatabase', 'noNewAuth', 'preserveExistingEbayArchitecture', 'verifyBeforeComplete', 'failedWorkRemainsOpen', 'stalePullRequestsMustBeRechecked', 'productionRequiresDeviceAndDeploymentEvidence'] as const;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
export function hasProductionEvidence(value: unknown): value is string {
  return text(value) && !/\b(todo|tbd|pending|not verified)\b/i.test(value);
}
export function isProductionCommit(value: unknown): value is string { return typeof value === 'string' && /^[a-f0-9]{40}$/i.test(value); }

/** Validate untrusted repository JSON before the UI can count or display a pass. */
export function validateProductionRegister(value: unknown, nicheIds: readonly string[]): string[] {
  if (!object(value)) return ['Register must be a JSON object.'];
  const errors: string[] = [];
  if (value.schemaVersion !== 1) errors.push('Unsupported register schema.');
  if (!text(value.programme) || !text(value.repository) || !text(value.defaultBranch)) errors.push('Programme, repository and branch are required.');
  const statuses = value.statuses;
  if (!Array.isArray(statuses) || PRODUCTION_STATUSES.some(status => !statuses.includes(status))) errors.push('Register status vocabulary is incomplete.');
  for (const rule of PRODUCTION_RULES) if (!object(value.rules) || value.rules[rule] !== true) errors.push(`Mandatory rule ${rule} must remain enabled.`);
  const stageIds = new Set<string>();
  const taskIds = new Set<string>();
  if (!Array.isArray(value.stages) || value.stages.length !== 7) errors.push('Exactly seven programme stages are required.');
  for (const stage of Array.isArray(value.stages) ? value.stages : []) {
    if (!object(stage)) { errors.push('Stage must be an object.'); continue; }
    if (!text(stage.id) || stageIds.has(stage.id)) errors.push('Missing or duplicate stage ID.');
    if (text(stage.id)) stageIds.add(stage.id);
    if (!text(stage.name) || !text(stage.goal) || !PRODUCTION_STATUSES.includes(stage.status as ProductionStatus)) errors.push(`Invalid stage ${stage.id}.`);
    if (!Array.isArray(stage.tasks) || stage.tasks.length === 0) { errors.push(`Stage ${stage.id} requires tasks.`); continue; }
    for (const task of stage.tasks) {
      if (!object(task)) { errors.push('Task must be an object.'); continue; }
      if (!text(task.id) || taskIds.has(task.id)) errors.push('Missing or duplicate task ID.');
      if (text(task.id)) taskIds.add(task.id);
      if (!text(task.title) || !PRODUCTION_STATUSES.includes(task.status as ProductionStatus)) errors.push(`Invalid task ${task.id}.`);
      if (task.status === 'VERIFIED' && !hasProductionEvidence(task.evidence)) errors.push(`Task ${task.id} lacks resolved verification evidence.`);
    }
    if (stage.status === 'VERIFIED' && stage.tasks.some(task => !object(task) || task.status !== 'VERIFIED' || !hasProductionEvidence(task.evidence))) errors.push(`Stage ${stage.id} is VERIFIED with unfinished tasks.`);
  }
  for (let index = 1; index <= 7; index++) if (!stageIds.has(`S${index}`)) errors.push(`Missing stage S${index}.`);
  if (!taskIds.has('S7-07')) errors.push('Google Play task S7-07 is missing.');
  if (!Array.isArray(value.knownReleaseRisks) || value.knownReleaseRisks.some(risk => !text(risk))) errors.push('Release risks must be a string array.');
  const certification = value.nicheCertification;
  if (!object(certification)) { errors.push('Certification definition is missing.'); return errors; }
  if (certification.source !== 'niche-modules.json') errors.push('Certification must use the canonical niche registry.');
  const areas = Array.isArray(certification.requiredAreas) ? certification.requiredAreas : [];
  if (areas.length < 15 || areas.some(area => !text(area)) || new Set(areas).size !== areas.length || !areas.includes('google-play-store-compliance')) errors.push('Certification areas are incomplete or duplicated.');
  if (certification.records !== undefined && !object(certification.records)) errors.push('Certification records must be an object.');
  for (const [id, records] of Object.entries(object(certification.records) ? certification.records : {})) {
    if (!nicheIds.includes(id) || !object(records)) { errors.push(`Invalid certification niche ${id}.`); continue; }
    for (const [area, record] of Object.entries(records)) {
      if (!areas.includes(area) || !object(record) || !PRODUCTION_STATUSES.includes(record.status as ProductionStatus)) { errors.push(`Invalid certification area ${id}/${area}.`); continue; }
      if (record.status === 'VERIFIED' && (!hasProductionEvidence(record.evidence) || !isProductionCommit(record.commitSha) || !text(record.verifiedAt) || !Number.isFinite(Date.parse(record.verifiedAt)) || Date.parse(record.verifiedAt) > Date.now())) errors.push(`Certification ${id}/${area} requires evidence, a full commit SHA and a past verification timestamp.`);
    }
  }
  return errors;
}

export function classifyProductionWorkflowJob(job: ProductionWorkflowJobLike): ProductionWorkflowJobState {
  if (job.status !== 'completed') return job.status === 'in_progress' ? 'RUNNING' : 'QUEUED';
  if (job.conclusion === 'success') return 'PASSED';
  if (job.conclusion === 'skipped' || job.conclusion === 'neutral') return 'SKIPPED';
  return 'FAILED';
}
export function summarizeProductionWorkflowJobs(jobs: ProductionWorkflowJobLike[]): ProductionWorkflowJobSummary {
  return jobs.reduce<ProductionWorkflowJobSummary>((summary, job) => {
    const state = classifyProductionWorkflowJob(job);
    if (state === 'PASSED') summary.passed++;
    else if (state === 'FAILED') summary.failed++;
    else if (state === 'RUNNING') summary.running++;
    else if (state === 'QUEUED') summary.queued++;
    else summary.skipped++;
    return summary;
  }, { passed: 0, failed: 0, running: 0, queued: 0, skipped: 0 });
}
export function getNicheCertification(register: ProductionRegister | null, nicheId: string, mainSha: string, live: boolean) {
  const records = register?.nicheCertification.records?.[nicheId] ?? {};
  const gates = (register?.nicheCertification.requiredAreas ?? []).map(area => {
    const record = records[area];
    const evidenced = record?.status === 'VERIFIED' && hasProductionEvidence(record.evidence) && isProductionCommit(record.commitSha) && !!record.verifiedAt && Number.isFinite(Date.parse(record.verifiedAt)) && Date.parse(record.verifiedAt) <= Date.now();
    const current = evidenced && live && isProductionCommit(mainSha) && record.commitSha === mainSha;
    return { area, record, status: current ? 'VERIFIED' : evidenced ? 'RECHECK REQUIRED' : record?.status === 'VERIFIED' ? 'EVIDENCE REQUIRED' : record?.status ?? 'NOT STARTED' };
  });
  const verified = gates.filter(gate => gate.status === 'VERIFIED').length;
  return { gates, verified, total: gates.length, certified: gates.length > 0 && verified === gates.length };
}
export interface ProductionPullEvidence {
  draft: boolean; mergeable: boolean | null; behindBy?: number; checkTotal?: number;
  checkPassed?: number; checkFailed?: number; checkPending?: number; checksComplete?: boolean;
}
export function assessProductionPull(pull: ProductionPullEvidence) {
  if (pull.draft) return { label: 'DRAFT', tone: 'muted' as const };
  if (pull.mergeable === false) return { label: 'MERGE CONFLICT', tone: 'bad' as const };
  if (pull.behindBy === undefined) return { label: 'BASE COMPARISON UNKNOWN', tone: 'warn' as const };
  if (pull.behindBy > 0) return { label: 'BEHIND MAIN — RETEST', tone: 'bad' as const };
  if ((pull.checkFailed ?? 0) > 0) return { label: 'CHECKS FAILING', tone: 'bad' as const };
  if ((pull.checkPending ?? 0) > 0) return { label: 'CHECKS RUNNING', tone: 'warn' as const };
  if (!pull.checksComplete || !pull.checkTotal || pull.checkPassed !== pull.checkTotal || pull.mergeable !== true) return { label: 'EVIDENCE INCOMPLETE', tone: 'warn' as const };
  return { label: 'CHECKS PASS — REVIEW REQUIRED', tone: 'good' as const };
}
