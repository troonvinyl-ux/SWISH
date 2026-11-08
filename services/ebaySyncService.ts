import { FunctionsHttpError } from '@supabase/supabase-js';
import { resolveProductionNiche } from './nicheRouting';
import { invokeScopedSync } from './syncRequestService';
import { backendDataScope, shareBackendRequest } from './backendRequestService';
export interface EbaySyncOptions { isCurrent?: () => boolean; onProgress?: (data: any) => void }
interface OperationResult { data: any; error: string | null; requiresReauth: boolean }
async function invokeOperation(endpoint: string, body: Record<string, unknown>, timeout: number): Promise<OperationResult> {
 try {
  const { data, error } = await invokeScopedSync(endpoint, body, timeout); let payload = data;
  if (error) {
   let detail = error.message;
   if (error instanceof FunctionsHttpError) { try { const text = await error.context.text(); payload = JSON.parse(text); detail = String(payload?.error ?? payload?.message ?? detail); } catch { payload = null; } }
   return { data: payload, error: String(payload?.error ?? detail ?? 'eBay request was not confirmed. Reload before retrying.'), requiresReauth: payload?.requiresReauth === true };
  }
  return { data: payload, error: payload?.success === true ? null : String(payload?.error ?? 'eBay operation was not confirmed.'), requiresReauth: payload?.requiresReauth === true };
 } catch (cause) { return { data: null, error: cause instanceof Error ? cause.message : 'eBay connection unavailable. Existing inventory is preserved.', requiresReauth: false }; }
}
/** Continue new, disjoint six-listing batches; NEVER replay a failed/unknown request. */
export async function runNicheEbayOperation(tenantId: string, nicheId: string, operation: 'sync' | 'token' | 'images', options: EbaySyncOptions = {}): Promise<OperationResult> {
 const niche = resolveProductionNiche(nicheId);
 if (!tenantId || !niche) return { data: null, error: 'Open a verified specialist workspace before syncing.', requiresReauth: false };
 if (operation !== 'sync') return invokeOperation(operation === 'images' ? 'swish-image-download' : 'swish-ebay-sync', operation === 'images' ? { tenantId, nicheId: niche, fixTitles: false } : { tenantId, nicheId: niche, mode: 'refresh_token_only' }, operation === 'token' ? 30000 : 105000);
 try {
  const captured = await backendDataScope();
  return await shareBackendRequest(`ebay-hub-batches:${tenantId}:${niche}`, async () => {
   const totals = { processed: 0, updated: 0, failed: 0, imagesFetched: 0, titlesFixed: 0, blocked: 0 };
   const issues: any[] = []; const seen = new Set<string>(); let cursor: string | null = null; let last: any = null;
   const snapshot = () => ({ ...last, ...totals, issues: [...issues], partial: totals.failed > 0 });
   for (let batch = 0; batch < 834; batch++) {
    if (options.isCurrent?.() === false || await backendDataScope() !== captured) return { data: snapshot(), error: 'Workspace or login changed. Sync stopped before starting the next batch; completed items are retained.', requiresReauth: false };
    const response = await invokeOperation('swish-ebay-sync', { tenantId, nicheId: niche, mode: 'full', batch: true, ...(totals.failed > 0 ? { previousIssues: true } : {}), ...(cursor ? { afterListingId: cursor } : {}) }, 105000);
    last = response.data;
    if (!last) return { ...response, data: snapshot() };
    for (const key of Object.keys(totals) as Array<keyof typeof totals>) { const value = Number(last[key] ?? 0); if (Number.isFinite(value) && value >= 0) totals[key] += value; }
    if (Array.isArray(last.issues)) issues.push(...last.issues);
    if (options.isCurrent?.() !== false) options.onProgress?.(snapshot());
    // Only explicitly accounted-for policy restrictions allow a new batch.
    // An arbitrary batchComplete flag cannot turn transport/readback failure into success.
    const restrictionOnly = last.batchComplete === true && response.requiresReauth === false && Number(last.blocked) > 0 && Number(last.failed) === Number(last.blocked) && Array.isArray(last.issues) && last.issues.length === Number(last.blocked) && last.issues.every((issue: any) => issue?.code === '21920397');
    if (response.error && !restrictionOnly) return { ...response, data: snapshot() };
    const next = last.nextAfterListingId;
    if (next == null) return { data: { ...snapshot(), success: totals.failed === 0 }, error: totals.failed ? `${totals.updated} listing(s) reconciled; ${totals.failed} need attention${totals.blocked ? ' (eBay policy 21920397)' : ''}. Restricted/unconfirmed records and photos are retained. Review the listing issues before retrying.` : response.error, requiresReauth: response.requiresReauth };
    if (last.batchComplete !== true || typeof next !== 'string' || !/^[0-9a-f-]{36}$/i.test(next) || seen.has(next) || Number(last.processed) < 1) return { data: snapshot(), error: 'Sync continuation could not be verified. Completed items are retained; reload before retrying.', requiresReauth: false };
    seen.add(next); cursor = next;
   }
   return { data: snapshot(), error: 'Sync exceeded the supported collection limit. Select a smaller group; completed items are retained.', requiresReauth: false };
  });
 } catch (cause) { return { data: null, error: cause instanceof Error ? cause.message : 'Sync unavailable. Existing records are retained.', requiresReauth: false }; }
}
