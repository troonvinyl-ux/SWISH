import { getSupabaseClient } from '@/template';
import { FunctionsHttpError } from '@supabase/supabase-js';
export interface UnifiedHealth {
  verifiedOwner: boolean; checkedAt: string; authentication: string; backend: string; database: string;
  ebay: { status: string; last_sync_at: string | null };
  modules: { id: string; name: string; inventoryCount: number | null; listingCount: number | null; dataStatus: string }[];
  isolation: { status: string; observedCrossNicheRows: number | null };
  releases: { platform: string; channel: string; version: string; status: string; source_sha: string; artifact_sha256: string | null }[];
  logs: { function_name: string; outcome: string; status_code: number; duration_ms: number; error_code: string | null; created_at: string }[];
  limitations: string[];
}
export async function loadUnifiedHealth(tenantId: string): Promise<{ health: UnifiedHealth | null; error: string | null }> {
  const { data, error } = await getSupabaseClient().functions.invoke('swish-unified-health', { body: { tenantId } });
  if (error) {
    let message = 'Read-only owner diagnostics are unavailable.';
    if (error instanceof FunctionsHttpError) {
      try { const payload = JSON.parse(await error.context.text()); if (typeof payload.error === 'string') message = payload.error.slice(0, 180); } catch { /* generic safe message */ }
    }
    return { health: null, error: message };
  }
  if (data?.verifiedOwner !== true) return { health: null, error: 'Trusted owner authorization was not confirmed.' };
  return { health: data as UnifiedHealth, error: null };
}
