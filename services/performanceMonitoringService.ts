// Bounded metadata-only diagnostic ring. Never store request keys, identities, bodies or credentials.
export type PerformanceStage = 'database_read' | 'sync_api' | 'image_upload' | 'image_verify' | 'identification' | 'publication';
export interface PerformanceSample { stage: PerformanceStage; durationMs: number; outcome: 'success' | 'failure'; measuredAt: number }
const samples: PerformanceSample[] = [];
const counters = new Map<string, number>();
export function recordPerformance(stage: PerformanceStage, durationMs: number, outcome: 'success' | 'failure' = 'success') {
 if (!Number.isFinite(durationMs) || durationMs < 0) return;
 samples.push({ stage, durationMs: Math.round(durationMs), outcome, measuredAt: Date.now() });
 if (samples.length > 500) samples.splice(0, samples.length - 500);
}
export function recordPrevention(kind: 'read_flight' | 'sync_flight' | 'unchanged_inventory' | 'photo_flight' | 'publication_flight') { counters.set(kind, (counters.get(kind) ?? 0) + 1); }
export async function measurePerformance<T>(stage: PerformanceStage, operation: () => PromiseLike<T>, failed: (value: T) => boolean = () => false): Promise<T> {
 const started = Date.now();
 try { const value = await operation(); recordPerformance(stage, Date.now() - started, failed(value) ? 'failure' : 'success'); return value; }
 catch (cause) { recordPerformance(stage, Date.now() - started, 'failure'); throw cause; }
}
function percentile(sorted: number[], fraction: number): number | null {
 if (!sorted.length) return null;
 const position = (sorted.length - 1) * fraction, left = Math.floor(position), right = Math.ceil(position);
 return Math.round(sorted[left] + (sorted[right] - sorted[left]) * (position - left));
}
export function readPerformanceDiagnostics() {
 const stages: PerformanceStage[] = ['database_read', 'sync_api', 'image_upload', 'image_verify', 'identification', 'publication'];
 return { window: 'Latest 500 operations in this JS runtime; no native startup or server SQL claim', counters: Object.fromEntries(counters), stages: stages.map(stage => {
  const rows = samples.filter(sample => sample.stage === stage), times = rows.map(sample => sample.durationMs).sort((a,b) => a-b);
  return { stage, samples: rows.length, failures: rows.filter(row => row.outcome === 'failure').length, medianMs: percentile(times, 0.5), p90Ms: percentile(times, 0.9) };
 }) };
}
