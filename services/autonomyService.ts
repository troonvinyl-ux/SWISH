// SWISH Autonomy Controls Service
// Kill switch and individual capability controls for autonomous operations.

import { getSupabaseClient } from '@/template';

export interface AutonomyControls {
  id: string;
  tenantId: string;
  globalPause: boolean;
  globalPauseReason?: string;
  globalPauseAt?: string;
  acquisitionPaused: boolean;
  listingPaused: boolean;
  publishingPaused: boolean;
  repricingPaused: boolean;
  reinvestmentPaused: boolean;
  updatedAt: string;
}

function mapControls(row: any): AutonomyControls {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    globalPause: row.global_pause ?? false,
    globalPauseReason: row.global_pause_reason ?? undefined,
    globalPauseAt: row.global_pause_at ?? undefined,
    acquisitionPaused: row.acquisition_paused ?? false,
    listingPaused: row.listing_paused ?? false,
    publishingPaused: row.publishing_paused ?? false,
    repricingPaused: row.repricing_paused ?? false,
    reinvestmentPaused: row.reinvestment_paused ?? false,
    updatedAt: row.updated_at,
  };
}

export async function getAutonomyControls(
  tenantId: string
): Promise<{ controls: AutonomyControls | null; error: string | null }> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('autonomy_controls')
    .select('*')
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (error) return { controls: null, error: error.message };
  if (!data) {
    // Create default controls
    const { data: created, error: createErr } = await supabase
      .from('autonomy_controls')
      .insert({ tenant_id: tenantId })
      .select()
      .single();
    if (createErr) return { controls: null, error: createErr.message };
    return { controls: mapControls(created), error: null };
  }
  return { controls: mapControls(data), error: null };
}

export async function updateAutonomyControls(
  tenantId: string,
  updates: Partial<Omit<AutonomyControls, 'id' | 'tenantId' | 'updatedAt'>>
): Promise<{ controls: AutonomyControls | null; error: string | null }> {
  const supabase = getSupabaseClient();

  const dbUpdates: Record<string, any> = { updated_at: new Date().toISOString() };
  if (updates.globalPause !== undefined) dbUpdates.global_pause = updates.globalPause;
  if (updates.globalPauseReason !== undefined) dbUpdates.global_pause_reason = updates.globalPauseReason;
  if (updates.globalPauseAt !== undefined) dbUpdates.global_pause_at = updates.globalPauseAt;
  if (updates.acquisitionPaused !== undefined) dbUpdates.acquisition_paused = updates.acquisitionPaused;
  if (updates.listingPaused !== undefined) dbUpdates.listing_paused = updates.listingPaused;
  if (updates.publishingPaused !== undefined) dbUpdates.publishing_paused = updates.publishingPaused;
  if (updates.repricingPaused !== undefined) dbUpdates.repricing_paused = updates.repricingPaused;
  if (updates.reinvestmentPaused !== undefined) dbUpdates.reinvestment_paused = updates.reinvestmentPaused;

  const { data, error } = await supabase
    .from('autonomy_controls')
    .upsert({ tenant_id: tenantId, ...dbUpdates }, { onConflict: 'tenant_id' })
    .select()
    .single();

  if (error) return { controls: null, error: error.message };
  return { controls: mapControls(data), error: null };
}

export async function triggerGlobalKillSwitch(
  tenantId: string,
  reason: string
): Promise<{ error: string | null }> {
  const { error } = await updateAutonomyControls(tenantId, {
    globalPause: true,
    globalPauseReason: reason,
    globalPauseAt: new Date().toISOString(),
    acquisitionPaused: true,
    listingPaused: true,
    publishingPaused: true,
    repricingPaused: true,
    reinvestmentPaused: true,
  });
  return { error };
}

export async function resumeAllAutonomy(tenantId: string): Promise<{ error: string | null }> {
  const { error } = await updateAutonomyControls(tenantId, {
    globalPause: false,
    globalPauseReason: undefined,
    globalPauseAt: undefined,
    acquisitionPaused: false,
    listingPaused: false,
    publishingPaused: false,
    repricingPaused: false,
    reinvestmentPaused: false,
  });
  return { error };
}

// Check if a specific action is permitted
export function isActionPermitted(
  controls: AutonomyControls | null,
  action: 'acquisition' | 'listing' | 'publishing' | 'repricing' | 'reinvestment'
): { permitted: boolean; reason?: string } {
  if (!controls) return { permitted: true };
  if (controls.globalPause) {
    return {
      permitted: false,
      reason: `All autonomous operations are paused${controls.globalPauseReason ? `: ${controls.globalPauseReason}` : ''}`,
    };
  }
  const pausedMap: Record<typeof action, boolean> = {
    acquisition: controls.acquisitionPaused,
    listing: controls.listingPaused,
    publishing: controls.publishingPaused,
    repricing: controls.repricingPaused,
    reinvestment: controls.reinvestmentPaused,
  };
  if (pausedMap[action]) {
    return { permitted: false, reason: `${action} operations are currently paused` };
  }
  return { permitted: true };
}
