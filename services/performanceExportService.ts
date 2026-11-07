// Aggregate-only projection. Never serialize raw RPCs, telemetry events, item records or errors.
import { getSupabaseClient } from '@/template';
import { backendDataScope, backendRead } from './backendRequestService';
import { verifyPlatformOwner } from './commandCentreService';
import { readPerformanceDiagnostics, type PerformanceStage } from './performanceMonitoringService';
import sqlEvidence from '@/docs/SWISH_BACKEND_PERFORMANCE_EVIDENCE.json';
export const PERFORMANCE_EXPORT_VERSION = 'swish-performance-export-v1';
const functionNames = new Set([
 'swish-check-subscription','swish-coin-image-enhance','swish-create-checkout','swish-customer-portal',
 'swish-decompose','swish-discogs','swish-ebay-browse','swish-ebay-category','swish-ebay-draft-sync-test',
 'swish-ebay-finances','swish-ebay-list','swish-ebay-listing-status','swish-ebay-messages','swish-ebay-oauth',
 'swish-ebay-orders','swish-ebay-post-order','swish-ebay-sync','swish-identify','swish-image-download',
 'swish-islamic-identify','swish-list-generate','swish-market-value','swish-migrate-credentials',
 'swish-privacy-policy','swish-reprice','swish-unified-health','swish-verification','swish-verify','other',
]);
function object(value: unknown): Record<string, unknown> {
 if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid performance measurement contract.');
 return value as Record<string, unknown>;
}
function count(value: unknown): number {
 if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('Invalid performance sample count.');
 return value;
}
function duration(value: unknown): number {
 if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error('Invalid performance duration.');
 return value;
}
function summary(value: Record<string, unknown>) {
 const samples = count(value.samples);
 if (!samples) {
  if (value.medianMs !== null || value.p90Ms !== null) throw new Error('Unmeasured timings must be null.');
  return { samples, medianMs: null, p90Ms: null };
 }
 const medianMs = duration(value.medianMs), p90Ms = duration(value.p90Ms);
 if (p90Ms < medianMs) throw new Error('Invalid performance percentile order.');
 return { samples, medianMs, p90Ms };
}
function iso(value: unknown): string {
 if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new Error('Missing measurement timestamp.');
 return new Date(value).toISOString();
}
/** Explicit field allowlist also strips unexpected fields from future server contracts. */
export function projectServerPerformance(value: unknown) {
 const source = object(value);
 if (source.version !== PERFORMANCE_EXPORT_VERSION || source.verifiedOwner !== true || source.scope !== 'platform') throw new Error('Owner performance export was not authorized.');
 const edge = object(source.edge), sync = object(source.sync), capture = object(source.captureToLive);
 if (edge.windowDays !== 7 || sync.windowDays !== 7 || capture.windowDays !== 30) throw new Error('Unexpected performance measurement window.');
 if (!Array.isArray(edge.functions) || edge.functions.length > functionNames.size) throw new Error('Invalid Edge aggregate.');
 const seen = new Set<string>();
 const functions = edge.functions.map(value => {
  const row = object(value), name = row.functionName;
  if (typeof name !== 'string' || !functionNames.has(name) || seen.has(name)) throw new Error('Unknown Edge aggregate.');
  seen.add(name);
  const records = count(row.records), httpFailures = count(row.httpFailures), timings = summary(row);
  if (httpFailures > records || timings.samples > records) throw new Error('Inconsistent Edge sample counts.');
  return { functionName: name, records, httpFailures, ...timings };
 });
 const edgeRecords = count(edge.records);
 if (functions.reduce((sum, row) => sum + row.records, 0) !== edgeRecords) throw new Error('Incomplete Edge aggregate.');
 const records = count(sync.records), completed = count(sync.completed), failed = count(sync.failed), running = count(sync.running), other = count(sync.other);
 const syncTimings = summary(sync), missingDurationRecords = count(sync.missingDurationRecords);
 if (completed + failed + running + other !== records || syncTimings.samples + missingDurationRecords !== records) throw new Error('Inconsistent sync sample counts.');
 const sessions = count(capture.sessions), publicationAttempts = count(capture.publicationAttempts), confirmedLiveSessions = count(capture.confirmedLiveSessions);
 const captureTimings = summary(capture), excludedConfirmedDurations = count(capture.excludedConfirmedDurations);
 if (publicationAttempts > sessions || confirmedLiveSessions > publicationAttempts || captureTimings.samples + excludedConfirmedDurations !== confirmedLiveSessions) throw new Error('Inconsistent confirmed-live sample counts.');
 return {
  checkedAt: iso(source.checkedAt),
  edge: { windowDays: 7, records: edgeRecords, functions },
  sync: { windowDays: 7, records, completed, failed, running, other, missingDurationRecords, ...syncTimings },
  captureToLive: { windowDays: 30, sessions, publicationAttempts, confirmedLiveSessions, excludedConfirmedDurations, ...captureTimings },
 };
}
const stageNotes: Record<PerformanceStage, string> = {
 database_read: 'Client read elapsed time including queue, network and server work; NOT SQL execution time.',
 sync_api: 'Client elapsed sync gateway request; includes network and server work.',
 image_upload: 'Client elapsed original-photo storage upload; verification is a separate stage.',
 image_verify: 'Client elapsed storage download/readback; not upload or SQL execution time.',
 identification: 'Client bounded identification request; not independent identification accuracy.',
 publication: 'Client publication workflow elapsed time; not capture-to-live and not proof of a confirmed live listing.',
};
const counterNames = ['read_flight','sync_flight','unchanged_inventory','photo_flight','publication_flight'] as const;
export function projectRuntimePerformance(value: unknown) {
 const source = object(value), counters = object(source.counters);
 if (!Array.isArray(source.stages)) throw new Error('Invalid runtime diagnostics.');
 const stages = (Object.keys(stageNotes) as PerformanceStage[]).map(stage => {
  const matches = (source.stages as unknown[]).map(object).filter(row => row.stage === stage);
  if (matches.length !== 1) throw new Error('Incomplete runtime diagnostic stages.');
  const row = matches[0], timings = summary(row), failures = count(row.failures);
  if (failures > timings.samples) throw new Error('Invalid runtime failure count.');
  return { stage, measurement: stageNotes[stage], failures, ...timings };
 });
 const retainedSamples = stages.reduce((sum, row) => sum + row.samples, 0);
 if (retainedSamples > 500) throw new Error('Runtime diagnostic ring exceeds its bound.');
 return {
  scope: 'This JS runtime only; aggregate metadata may span account changes. No identities are retained.',
  window: 'Latest 500 recorded operations; not native startup, not account lifetime, not server SQL.',
  retainedSamples,
  counters: Object.fromEntries(counterNames.map(name => [name, count(counters[name] ?? 0)])),
  counterWindow: 'Since this JS runtime initialized; counters are not limited to the 500-sample ring.',
  stages,
 };
}
function percentile(sorted: number[], fraction: number) {
 if (!sorted.length) return null;
 const position = (sorted.length - 1) * fraction, left = Math.floor(position), right = Math.ceil(position);
 return sorted[left] + (sorted[right] - sorted[left]) * (position - left);
}
function archivedPhase(value: unknown) {
 const source = object(value);
 if (!Array.isArray(source.samplesMs) || source.samplesMs.length !== 5) throw new Error('Invalid archived SQL evidence.');
 const samplesMs = source.samplesMs.map(duration);
 const sorted = [...samplesMs].sort((a, b) => a - b);
 return { samples: samplesMs.length, samplesMs, medianMs: percentile(sorted, 0.5), p90Ms: percentile(sorted, 0.9) };
}
export function buildPerformanceExport(serverValue: unknown, runtimeValue: unknown) {
 const server = projectServerPerformance(serverValue), runtime = projectRuntimePerformance(runtimeValue);
 // Do not spread the archive: its tenant UUID, record counts and unrelated evidence never enter exports.
 return {
  schemaVersion: PERFORMANCE_EXPORT_VERSION,
  generatedAt: new Date().toISOString(), serverCheckedAt: server.checkedAt,
  access: 'Verified platform owner; aggregate platform telemetry only.', unit: 'milliseconds',
  sql: {
   measurement: 'ARCHIVED administrative warm-cache EXPLAIN ANALYZE; not current runtime SQL, network or subscriber RLS latency.',
   source: 'docs/SWISH_BACKEND_PERFORMANCE_EVIDENCE.json', query: 'Canonical inventory tab-count SELECT',
   currentRuntime: { samples: 0, medianMs: null, p90Ms: null, reason: 'No runtime SQL execution-time collector is available.' },
   archivedBefore: archivedPhase(sqlEvidence.before), archivedAfter: archivedPhase(sqlEvidence.after),
  },
  runtimeNetwork: runtime,
  edgeExecution: { ...server.edge, measurement: 'Recorded server handler duration; excludes client network and may exclude telemetry persistence. HTTP failures are status >= 400, not every business failure.' },
  syncWallClock: { ...server.sync, measurement: 'Persisted completed_at minus started_at across all recorded sync types. Missing, unfinished or negative durations are excluded; failures reflect recorded failed/error status.' },
  captureToLive: { ...server.captureToLive, measurement: 'Quick List T7 minus T2 from the latest checkpoint per tenant/session, with matching Active live-confirmation evidence. Includes processing and user review; client wall clocks are not independent verification.' },
  limitations: [
   'Empty timing cohorts have zero samples and null percentiles; no fabricated timings or live-performance certification.',
   'Edge/sync windows cover the last 7 days; Quick List covers the last 30 days; the SQL archive is not a live before/after comparison.',
   'No provider calls, sync claims, publication, inventory writes or fresh EXPLAIN benchmark are triggered by this export.',
   'Only instrumented activity is measured; stage timings may overlap and must not be added together.',
   'Only aggregate allowlisted fields are exported. No credentials, tokens, emails, tenant/user/item/listing IDs, URLs, event bodies or error messages.',
  ],
 };
}
export type PerformanceExport = ReturnType<typeof buildPerformanceExport>;
export interface PreparedPerformanceExport { report: PerformanceExport; authorize: () => Promise<void> }
/** Fresh trusted RPC per export; never fall back to cached data or a client owner flag. */
export async function preparePerformanceExport(expectedUserId: string): Promise<PreparedPerformanceExport> {
 if (!expectedUserId) throw new Error('Sign in as the verified platform owner to export.');
 const client = getSupabaseClient(), session = await client.auth.getSession();
 if (session.error || session.data.session?.user.id !== expectedUserId) throw new Error('Owner session changed. Retry after signing in.');
 const scope = await backendDataScope();
 const runtime = readPerformanceDiagnostics();
 let response;
 try { response = await backendRead('owner-performance-export', signal => client.rpc('swish_performance_export').abortSignal(signal), 'foreground', 15000); }
 catch { throw new Error('Owner performance export could not be verified. No file was exported; check access or connection and retry.'); }
 if (response.error) throw new Error('Owner performance export was not confirmed. No file was exported.');
 if (await backendDataScope() !== scope) throw new Error('Owner session changed. No file was exported.');
 const report = buildPerformanceExport(response.data, runtime);
 const authorize = async () => {
  if (await backendDataScope() !== scope) throw new Error('Owner session changed. No file was exported.');
  const owner = await verifyPlatformOwner();
  if (!owner.allowed || owner.error || await backendDataScope() !== scope) throw new Error('Owner access could not be reverified. No file was exported.');
 };
 return { report, authorize };
}
