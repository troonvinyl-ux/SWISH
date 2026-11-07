jest.mock('@/template', () => ({ getSupabaseClient: jest.fn() }));
jest.mock('@/services/backendRequestService', () => ({ backendDataScope: jest.fn(), backendRead: jest.fn() }));
jest.mock('@/services/commandCentreService', () => ({ verifyPlatformOwner: jest.fn() }));
import { getSupabaseClient } from '@/template';
import { backendRead, backendDataScope } from '@/services/backendRequestService';
import { verifyPlatformOwner } from '@/services/commandCentreService';
import { buildPerformanceExport, PERFORMANCE_EXPORT_VERSION, preparePerformanceExport, projectServerPerformance } from '@/services/performanceExportService';
import fs from 'node:fs';
function server() {
 return { version: PERFORMANCE_EXPORT_VERSION, verifiedOwner: true, scope: 'platform', checkedAt: '2026-11-07T12:00:00Z',
  edge: { windowDays: 7, records: 2, functions: [{ functionName: 'swish-ebay-list', records: 2, httpFailures: 1, samples: 2, medianMs: 500, p90Ms: 700 }] },
  sync: { windowDays: 7, records: 3, completed: 1, failed: 1, running: 1, other: 0, samples: 2, missingDurationRecords: 1, medianMs: 1000, p90Ms: 1200 },
  captureToLive: { windowDays: 30, sessions: 3, publicationAttempts: 2, confirmedLiveSessions: 1, samples: 0, excludedConfirmedDurations: 1, medianMs: null, p90Ms: null },
 };
}
function runtime() {
 return { counters: { read_flight: 4 }, stages: ['database_read','sync_api','image_upload','image_verify','identification','publication'].map(stage => ({ stage, samples: 0, failures: 0, medianMs: null, p90Ms: null })) };
}
beforeEach(() => {
 jest.clearAllMocks();
 (backendDataScope as jest.Mock).mockResolvedValue('private-session-scope');
 (verifyPlatformOwner as jest.Mock).mockResolvedValue({ allowed: true, error: null });
 (getSupabaseClient as jest.Mock).mockReturnValue({ auth: { getSession: jest.fn().mockResolvedValue({ data: { session: { user: { id: 'owner' } } }, error: null }) } });
 (backendRead as jest.Mock).mockResolvedValue({ data: server(), error: null });
});
test('explicitly separates historical SQL, client network, server handler, sync and capture timings', () => {
 const report = buildPerformanceExport(server(), runtime());
 expect(report.sql.archivedBefore.samples).toBe(5); expect(report.sql.archivedAfter.samples).toBe(5);
 expect(report.sql.archivedBefore.medianMs).toBeCloseTo(51.121, 3);
 expect(report.sql.archivedAfter.p90Ms).toBeCloseTo(48.4134, 3);
 expect(report.sql.currentRuntime).toMatchObject({ samples: 0, medianMs: null, p90Ms: null });
 expect(report.runtimeNetwork.stages[0].measurement).toContain('NOT SQL');
 expect(report.edgeExecution.functions[0]).toMatchObject({ samples: 2, httpFailures: 1 });
 expect(report.syncWallClock).toMatchObject({ samples: 2, records: 3, missingDurationRecords: 1 });
 expect(report.captureToLive).toMatchObject({ samples: 0, medianMs: null, p90Ms: null });
 expect(report.runtimeNetwork.counters.read_flight).toBe(4);
});
test('confirmed capture durations remain separate from client request measurements', () => {
 const input = server();
 input.captureToLive = { windowDays: 30, sessions: 3, publicationAttempts: 2, confirmedLiveSessions: 1, samples: 1, excludedConfirmedDurations: 0, medianMs: 59000, p90Ms: 59000 } as any;
 const report = buildPerformanceExport(input, runtime());
 expect(report.captureToLive).toMatchObject({ samples: 1, confirmedLiveSessions: 1, medianMs: 59000 });
 expect(report.runtimeNetwork.retainedSamples).toBe(0);
 expect(report.edgeExecution.functions[0].medianMs).toBe(500);
 expect(report.captureToLive.measurement).toContain('T7 minus T2');
 const missing = server(); missing.captureToLive.excludedConfirmedDurations = 0;
 expect(() => projectServerPerformance(missing)).toThrow('confirmed-live sample counts');
});
test('malicious extra fields at every depth cannot reach the export', () => {
 const input: any = server(), client: any = runtime();
 for (const row of [input, input.edge, input.edge.functions[0], input.sync, input.captureToLive, client, client.counters, ...client.stages]) {
  row.access_token = 'SECRET_MARKER'; row.itemPayload = { title: 'ITEM_MARKER', media: ['https://private.invalid/photo'] }; row.tenantId = 'TENANT_MARKER'; row.error = 'RAW_ERROR_MARKER';
 }
 client.window = 'SECRET_MARKER';
 const json = JSON.stringify(buildPerformanceExport(input, client));
 expect(json).not.toMatch(/SECRET_MARKER|ITEM_MARKER|TENANT_MARKER|RAW_ERROR_MARKER|private\.invalid|53d169c0|tenantId|access_token/);
});
test('forged owner, incomplete windows, impossible sample counts and fabricated empty percentiles fail closed', () => {
 expect(() => projectServerPerformance({ ...server(), verifiedOwner: false })).toThrow('not authorized');
 const forged = server(); forged.captureToLive.medianMs = 100 as any;
 expect(() => projectServerPerformance(forged)).toThrow('null');
 const partial = server(); partial.edge.records = 3;
 expect(() => projectServerPerformance(partial)).toThrow('Incomplete');
 const inconsistent = server(); inconsistent.sync.samples = 4;
 expect(() => projectServerPerformance(inconsistent)).toThrow('sync sample');
 const unknown = server(); unknown.edge.functions[0].functionName = 'secret-token';
 expect(() => projectServerPerformance(unknown)).toThrow('Unknown');
});
test('only the authenticated expected user can request a fresh aggregate export', async () => {
 await expect(preparePerformanceExport('subscriber')).rejects.toThrow('session changed');
 expect(backendRead).not.toHaveBeenCalled();
 const prepared = await preparePerformanceExport('owner');
 expect(backendRead).toHaveBeenCalledWith('owner-performance-export', expect.any(Function), 'foreground', 15000);
 await prepared.authorize(); expect(verifyPlatformOwner).toHaveBeenCalledTimes(1);
});
test('network or server owner denial never falls back to a cached export', async () => {
 (backendRead as jest.Mock).mockRejectedValue(new Error('SECRET_ERROR'));
 await expect(preparePerformanceExport('owner')).rejects.toThrow('No file was exported');
 (backendRead as jest.Mock).mockResolvedValue({ data: { ...server(), verifiedOwner: false }, error: null });
 await expect(preparePerformanceExport('owner')).rejects.toThrow('not authorized');
});
test('session replacement or permission revocation before delivery blocks the file', async () => {
 const prepared = await preparePerformanceExport('owner');
 (verifyPlatformOwner as jest.Mock).mockResolvedValue({ allowed: false, error: null });
 await expect(prepared.authorize()).rejects.toThrow('reverified');
 (backendDataScope as jest.Mock).mockResolvedValue('replacement-private-scope');
 await expect(prepared.authorize()).rejects.toThrow('session changed');
});
test('UI is in existing verified Master Admin and does not eagerly load unrelated diagnostics', () => {
 const ui = fs.readFileSync('app/master-admin.tsx', 'utf8');
 expect(ui).toContain("if(item==='performance')return <PerformanceExportPanel enabled={owner.allowed}/>");
 expect(ui).toContain("!['command','inspection','performance'].includes(selectedSection)");
 const hook = fs.readFileSync('hooks/usePerformanceExport.ts', 'utf8');
 expect(hook).toContain('flight.current'); expect(hook).toContain('generation.current');
 expect(hook).toContain('prepared.authorize()');
});
test('SQL uses trusted owner permission and never returns identities or event payloads', () => {
 const sql = fs.readFileSync('supabase/migrations/20261117_owner_performance_export.sql', 'utf8');
 expect(sql).toContain('public.swish_is_platform_owner() is not true');
 expect(sql).toContain('auth.uid() is null'); expect(sql).toContain('from public,anon');
 expect(sql).toContain('security definer'); expect(sql).toContain("set statement_timeout='10s'");
 expect(sql).toContain("e.data->>'listingStatus'='Active'");
 expect(sql).toContain("jsonb_typeof(t.data->'timestamps'->'T2')='number'");
 expect(sql).not.toMatch(/select \*|disable row level security|insert into|update public\.|delete from/i);
 expect(sql).not.toContain("'tenant_id',"); expect(sql).not.toContain("'data',");
});
