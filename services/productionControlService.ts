import bundledRegister from '@/docs/SWISH_FOUNDATION_MASTER_REGISTER.json';
import bundledModules from '@/niche-modules.json';
import { isProductionCommit, validateProductionRegister } from './productionControlEvidence';
import type { ProductionRegister, ProductionNiche, ProductionPullEvidence, ProductionWorkflowJobLike } from './productionControlEvidence';

export const PRODUCTION_REPOSITORY = 'troonvinyl-ux/SWISH';
const api = `https://api.github.com/repos/${PRODUCTION_REPOSITORY}`;
const raw = `https://raw.githubusercontent.com/${PRODUCTION_REPOSITORY}`;
const cacheMs = 5 * 60_000;
const minimumRefreshMs = 60_000;
const hourlyBudget = 45; // Reserve capacity below GitHub's shared unauthenticated 60/hour limit.
const apiAttempts: number[] = [];
let retryAt = 0;
let lastAttempt = 0;
let cached: ProductionSnapshot | null = null;
let pending: Promise<ProductionSnapshot> | null = null;

export interface ProductionRun extends ProductionWorkflowJobLike { id: number; name: string; display_title: string; html_url: string; head_branch: string; head_sha: string; created_at: string; event?: string; head_repository?: { full_name: string } }
export interface ProductionJob extends ProductionWorkflowJobLike { id: number; name: string; steps?: Array<ProductionWorkflowJobLike & { name: string }> }
export interface ProductionArtifact { id: number; name: string; size_in_bytes: number; expired: boolean; expires_at: string }
export interface ProductionPull extends ProductionPullEvidence { number: number; title: string; html_url: string; head: { ref: string; sha: string }; base: { ref: string }; updated_at: string; checkPassed?: number }
export interface ProductionWorkflow { label: string; run: ProductionRun | null; jobs: ProductionJob[]; artifacts: ProductionArtifact[]; errors: string[] }
export interface ProductionSnapshot {
  register: ProductionRegister | null; niches: ProductionNiche[]; mainSha: string;
  source: 'LIVE' | 'CACHED' | 'BUNDLED'; refreshedAt: string; attemptedAt: string;
  pulls: ProductionPull[]; openPullCount: number | null; pullCountTruncated: boolean;
  runs: ProductionRun[]; workflows: ProductionWorkflow[]; errors: string[]; retryAt: number;
}
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const isOutcome = (value: unknown): value is ProductionWorkflowJobLike => isObject(value) && typeof value.status === 'string' && (value.conclusion === null || typeof value.conclusion === 'string');
function isRun(value: unknown): value is ProductionRun {
  return isObject(value) && isOutcome(value) && typeof value.id === 'number' && typeof value.name === 'string' && typeof value.display_title === 'string' && typeof value.html_url === 'string' && typeof value.head_branch === 'string' && isProductionCommit(value.head_sha) && typeof value.created_at === 'string';
}
function isJob(value: unknown): value is ProductionJob {
  return isObject(value) && isOutcome(value) && typeof value.id === 'number' && typeof value.name === 'string' && (value.steps === undefined || (Array.isArray(value.steps) && value.steps.every(step => isObject(step) && isOutcome(step) && typeof step.name === 'string')));
}
function isArtifact(value: unknown): value is ProductionArtifact {
  return isObject(value) && typeof value.id === 'number' && typeof value.name === 'string' && typeof value.expired === 'boolean' && typeof value.size_in_bytes === 'number' && typeof value.expires_at === 'string';
}
function isPull(value: unknown): value is ProductionPull {
  return isObject(value) && typeof value.number === 'number' && typeof value.title === 'string' && typeof value.html_url === 'string' && typeof value.draft === 'boolean' && isObject(value.head) && isProductionCommit(value.head.sha) && typeof value.head.ref === 'string' && isObject(value.base) && typeof value.base.ref === 'string';
}
const workflowDefinitions = [
  { file: 'branded-web-builds.yml', label: 'Ten-niche web builds' },
  { file: 'niche-config-checks.yml', label: 'Regression, security and native bundle' },
  { file: 'production-readiness-register.yml', label: 'Production register validation' },
  { file: 's2-s3-foundation.yml', label: 'S2–S3 foundation acceptance' },
];

export function createProductionSnapshot(): ProductionSnapshot {
  const niches = Object.values(bundledModules.products) as ProductionNiche[];
  const validation = validateProductionRegister(bundledRegister, niches.map(niche => niche.id));
  return {
    register: validation.length ? null : bundledRegister as ProductionRegister, niches, mainSha: '',
    source: 'BUNDLED', refreshedAt: '', attemptedAt: '', pulls: [], openPullCount: null, pullCountTruncated: false,
    runs: [], workflows: [], errors: validation, retryAt: 0,
  };
}

/** No credentials in the client. Timeouts, global request budget and rate-limit backoff are explicit. */
async function getJson<T>(url: string): Promise<T> {
  const now = Date.now();
  if (url.startsWith(api)) {
    while (apiAttempts.length && apiAttempts[0] <= now - 3_600_000) apiAttempts.shift();
    if (now < retryAt || apiAttempts.length >= hourlyBudget) {
      retryAt = Math.max(retryAt, (apiAttempts[0] ?? now) + 3_600_000);
      throw new Error('GitHub request limit reached. Last available evidence is retained.');
    }
    apiAttempts.push(now);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, { headers: { Accept: url.startsWith(api) ? 'application/vnd.github+json' : 'application/json' }, signal: controller.signal });
    if (!response.ok) {
      if (response.status === 429 || (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0')) {
        const reset = Number(response.headers.get('x-ratelimit-reset')) * 1000;
        const seconds = Number(response.headers.get('retry-after'));
        retryAt = Math.max(Date.now() + 60_000, Number.isFinite(reset) && reset > 0 ? reset : Date.now() + (seconds > 0 ? seconds : 3600) * 1000);
        throw new Error('GitHub is rate-limiting requests. Retry after the displayed time.');
      }
      throw new Error(`GitHub source unavailable (HTTP ${response.status}).`);
    }
    return await response.json() as T;
  } catch (error) {
    if (controller.signal.aborted) throw new Error('GitHub source timed out.');
    throw error;
  } finally { clearTimeout(timer); }
}
const message = (error: unknown) => error instanceof Error ? error.message : 'Source unavailable.';

export function selectProductionRun(runs: ProductionRun[]): ProductionRun | null {
  return runs.find(run => isRun(run) && run.head_branch === 'main' && run.event !== 'pull_request' && (!run.head_repository || run.head_repository.full_name === PRODUCTION_REPOSITORY)) ?? null;
}
async function getWorkflow(file: string, label: string): Promise<ProductionWorkflow> {
  const result: ProductionWorkflow = { label, run: null, jobs: [], artifacts: [], errors: [] };
  try {
    const payload = await getJson<{ workflow_runs: ProductionRun[] }>(`${api}/actions/workflows/${file}/runs?branch=main&per_page=5`);
    if (!Array.isArray(payload.workflow_runs)) throw new Error('Invalid workflow response.');
    result.run = selectProductionRun(payload.workflow_runs);
    if (!result.run) return result;
    // Fetch independently: artifact failures must never erase successful job evidence.
    const responses = await Promise.allSettled([
      getJson<{ jobs: ProductionJob[]; total_count: number }>(`${api}/actions/runs/${result.run.id}/jobs?per_page=100&filter=latest`),
      ...(file === 'branded-web-builds.yml' ? [getJson<{ artifacts: ProductionArtifact[]; total_count: number }>(`${api}/actions/runs/${result.run.id}/artifacts?per_page=100`)] : []),
    ]);
    const jobs = responses[0];
    if (jobs.status === 'fulfilled') {
      const payload = jobs.value as { jobs: ProductionJob[]; total_count: number };
      if (!Array.isArray(payload.jobs)) throw new Error('Invalid workflow jobs response.');
      result.jobs = payload.jobs.filter(isJob);
      if (payload.total_count !== result.jobs.length) result.errors.push('Job results are incomplete or malformed; inspect the source workflow.');
    } else result.errors.push(`Jobs: ${message(jobs.reason)}`);
    const artifacts = responses[1];
    if (artifacts?.status === 'fulfilled') {
      const payload = artifacts.value as { artifacts: ProductionArtifact[]; total_count: number };
      if (!Array.isArray(payload.artifacts)) throw new Error('Invalid artifact response.');
      result.artifacts = payload.artifacts.filter(isArtifact);
      if (payload.total_count !== result.artifacts.length) result.errors.push('Artifact results are incomplete or malformed.');
    } else if (artifacts?.status === 'rejected') result.errors.push(`Artifacts: ${message(artifacts.reason)}`);
  } catch (error) { result.errors.push(message(error)); }
  return result;
}
async function getPull(pull: ProductionPull, mainSha: string): Promise<ProductionPull> {
  const responses = await Promise.allSettled([
    getJson<ProductionPull>(`${api}/pulls/${pull.number}`), // List responses do not include mergeability.
    getJson<{ behind_by: number }>(`${api}/compare/${mainSha}...${pull.head.sha}`),
    getJson<{ total_count: number; check_runs: ProductionWorkflowJobLike[] }>(`${api}/commits/${pull.head.sha}/check-runs?per_page=100&filter=latest`),
    getJson<{ total_count: number; statuses: Array<{ state: string; context: string }> }>(`${api}/commits/${pull.head.sha}/status?per_page=100`),
  ]);
  const detail = responses[0].status === 'fulfilled' && isPull(responses[0].value) ? responses[0].value : null;
  // If the branch changed mid-refresh, do not attach checks for the old SHA to a new head.
  if (detail && detail.head.sha !== pull.head.sha) return { ...detail, checksComplete: false };
  const comparison = responses[1].status === 'fulfilled' ? responses[1].value : null;
  const checks = responses[2].status === 'fulfilled' ? responses[2].value : null;
  const statuses = responses[3].status === 'fulfilled' ? responses[3].value : null;
  const checkRows = Array.isArray(checks?.check_runs) ? checks.check_runs.filter(isOutcome) : [];
  const statusRows = Array.isArray(statuses?.statuses) ? statuses.statuses.filter(row => isObject(row) && typeof row.state === 'string' && typeof row.context === 'string') : [];
  return {
    ...pull, mergeable: detail?.mergeable ?? null, draft: detail?.draft ?? pull.draft,
    behindBy: typeof comparison?.behind_by === 'number' ? comparison.behind_by : undefined,
    checksComplete: !!checks && !!statuses && Array.isArray(checks.check_runs) && Array.isArray(statuses.statuses) && checks.total_count === checkRows.length && statuses.total_count === statusRows.length,
    checkTotal: checkRows.length + statusRows.length,
    checkPassed: checkRows.filter(row => row.status === 'completed' && row.conclusion === 'success').length + statusRows.filter(row => row.state === 'success').length,
    checkFailed: checkRows.filter(row => row.status === 'completed' && !['success', 'skipped', 'neutral'].includes(row.conclusion ?? '')).length + statusRows.filter(row => ['failure', 'error'].includes(row.state)).length,
    checkPending: checkRows.filter(row => row.status !== 'completed').length + statusRows.filter(row => row.state === 'pending').length,
  };
}

async function loadSnapshot(): Promise<ProductionSnapshot> {
  lastAttempt = Date.now();
  const previous = cached ?? createProductionSnapshot();
  const errors: string[] = [];
  let mainSha = '';
  try {
    const main = await getJson<{ sha: string }>(`${api}/commits/main`);
    if (!isProductionCommit(main.sha)) throw new Error('GitHub did not report a valid main commit.');
    mainSha = main.sha;
  } catch (error) {
    return { ...previous, source: previous.refreshedAt ? 'CACHED' : 'BUNDLED', attemptedAt: new Date().toISOString(), errors: [message(error)], retryAt };
  }
  const settled = await Promise.allSettled([
    getJson<unknown>(`${raw}/${mainSha}/docs/SWISH_FOUNDATION_MASTER_REGISTER.json`),
    getJson<{ products: Record<string, ProductionNiche> }>(`${raw}/${mainSha}/niche-modules.json`),
    getJson<ProductionPull[]>(`${api}/pulls?state=open&base=main&per_page=100&sort=updated&direction=desc`),
    getJson<{ workflow_runs: ProductionRun[] }>(`${api}/actions/runs?branch=main&per_page=20`),
    ...workflowDefinitions.map(definition => getWorkflow(definition.file, definition.label)),
  ]);
  const data = <T,>(index: number, label: string): T | null => {
    const result = settled[index];
    if (result.status === 'fulfilled') return result.value as T;
    errors.push(`${label}: ${message(result.reason)}`);
    return null;
  };
  const registerJson = data<unknown>(0, 'Register');
  const modules = data<{ products: Record<string, ProductionNiche> }>(1, 'Niche registry');
  const products = modules?.products;
  const niches = products && typeof products === 'object' && !Array.isArray(products) ? Object.values(products) : [];
  const validNiches = niches.length === 10 && Object.entries(products ?? {}).every(([id, niche]) => niche && niche.id === id && typeof niche.name === 'string' && niche.name.trim().length > 0 && typeof niche.entry === 'string' && niche.entry.trim().length > 0) && new Set(niches.map(niche => niche.id)).size === 10;
  const validation = validateProductionRegister(registerJson, validNiches ? niches.map(niche => niche.id) : []);
  if (!validNiches) errors.push('Canonical registry must contain ten complete, unique niche registrations.');
  errors.push(...validation);
  const pulls = data<ProductionPull[]>(2, 'Pull requests');
  const runs = data<{ workflow_runs: ProductionRun[] }>(3, 'Recent workflows');
  const workflows = workflowDefinitions.map((definition, index) => data<ProductionWorkflow>(index + 4, definition.label) ?? { label: definition.label, run: null, jobs: [], artifacts: [], errors: ['Workflow unavailable.'] });
  const validPulls = Array.isArray(pulls) && pulls.every(isPull);
  const enriched = validPulls ? await Promise.all(pulls.slice(0, 2).map(pull => getPull(pull, mainSha))) : [];
  if (!validPulls) errors.push('Open pull-request count is unavailable or malformed.');
  if (!Array.isArray(runs?.workflow_runs)) errors.push('Recent workflow list is unavailable.');
  const liveRegister = validNiches && validation.length === 0;
  const next: ProductionSnapshot = {
    register: liveRegister ? registerJson as ProductionRegister : previous.register,
    niches: liveRegister ? niches : previous.niches,
    // Preserve source pairing: never attach a new SHA to an old register fallback.
    mainSha: liveRegister ? mainSha : previous.mainSha,
    source: liveRegister ? 'LIVE' : previous.refreshedAt ? 'CACHED' : 'BUNDLED',
    refreshedAt: liveRegister ? new Date().toISOString() : previous.refreshedAt,
    attemptedAt: new Date().toISOString(), pulls: enriched,
    openPullCount: validPulls ? pulls.length : null, pullCountTruncated: validPulls && pulls.length === 100,
    runs: Array.isArray(runs?.workflow_runs) ? runs.workflow_runs.filter(isRun) : [], workflows, errors, retryAt,
  };
  cached = next;
  return next;
}

/** Deduplicate overlapping refreshes, including two mounted control panels. */
export function fetchProductionSnapshot(force = false): Promise<ProductionSnapshot> {
  if (pending) return pending;
  const now = Date.now();
  if (cached && !force && now - lastAttempt < cacheMs) return Promise.resolve(cached);
  if (now < retryAt || (lastAttempt > 0 && now - lastAttempt < minimumRefreshMs)) {
    return Promise.resolve({ ...(cached ?? createProductionSnapshot()), retryAt: Math.max(retryAt, lastAttempt + minimumRefreshMs) });
  }
  pending = loadSnapshot().catch(error => ({ ...(cached ?? createProductionSnapshot()), source: (cached?.refreshedAt ? 'CACHED' : 'BUNDLED') as ProductionSnapshot['source'], attemptedAt: new Date().toISOString(), errors: [message(error)], retryAt })).then(snapshot => {
    cached = snapshot;
    return snapshot;
  }).finally(() => { pending = null; });
  return pending;
}
