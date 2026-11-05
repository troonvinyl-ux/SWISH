import { getSupabaseClient } from '@/template';
import { FunctionsHttpError } from '@supabase/supabase-js';
import type { ProductionNicheId } from '@/constants/niches';
export type VerificationStatus = 'PASS' | 'FAIL' | 'BLOCKED' | 'NOT TESTED';
export interface VerificationResult { id?: string; test_id: string; niche_id: string | null; platform: string; result: VerificationStatus; evidence: string; failure_reason: string | null; reference_id?: string; created_at: string }
async function invoke(body: Record<string, unknown>): Promise<{ results: VerificationResult[]; error: string | null }> {
  try { const { data, error } = await getSupabaseClient().functions.invoke('swish-verification', { body });
    if (error) { let message = 'Owner verification service unavailable.'; if (error instanceof FunctionsHttpError) { try { const payload = JSON.parse(await error.context.text()); message = `[HTTP ${error.context.status}] ${typeof payload.error === 'string' ? payload.error : message}`; } catch { /* no raw response or credentials */ } } return { results: [], error: message }; }
    if (data?.verifiedOwner !== true || !Array.isArray(data.results)) return { results: [], error: 'Owner verification response was not confirmed.' };
    return { results: data.results, error: null };
  } catch { return { results: [], error: 'Verification connection failed; no results were inferred.' }; }
}
export function loadVerificationResults(tenantId: string) { return invoke({ action: 'list', tenantId }); }
export function runSafeVerification(tenantId: string, platform: string) { return invoke({ action: 'run', tenantId, platform }); }
export function runAntiqueVerification(tenantId: string, platform: string) { return invoke({ action: 'antiques', tenantId, platform }); }
export function runEbayVerification(tenantId: string, platform: string) { return invoke({ action: 'ebay', tenantId, platform }); }
export function runProgrammeVerification(tenantId: string, platform: string, sourceSha: string, stageId = 'ALL') { return invoke({ action: 'programme', tenantId, platform, sourceSha, stageId }); }
export function recordModuleObservation(tenantId: string, nicheId: ProductionNicheId, platform: string) { return invoke({ action: 'mounted', tenantId, nicheId, platform }); }
export function recordNavigationFailure(tenantId: string, nicheId: ProductionNicheId) { return invoke({ action: 'failed', tenantId, nicheId, platform: 'unknown' }); }
