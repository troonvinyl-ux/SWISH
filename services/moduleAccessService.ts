import { getSupabaseClient } from '@/template';
import { checkSubscription, type SubscriptionStatus } from './subscriptionService';
import { PRODUCTION_NICHE_IDS, isProductionNiche, type ProductionNicheId } from '@/constants/niches';

export interface ModuleAccessSnapshot { owner: boolean; nicheIds: ProductionNicheId[]; verifiedAt: number; tenantId: string; billingStatus: SubscriptionStatus | null }
export function membershipDestination(ids: readonly string[], owner: boolean, activeId?: string | null): string {
  if (activeId && ids.includes(activeId)) return '/(tabs)';
  if (owner || ids.length > 1) return '/swish';
  return ids.length === 1 ? '/(tabs)' : '/swish';
}
/** Billing and platform role are verified by existing backend identity, not user metadata. */
export async function loadModuleAccess(tenantId: string): Promise<{ snapshot: ModuleAccessSnapshot | null; error: string | null }> {
  const client = getSupabaseClient();
  try {
    // Read the protected owner row under its own-user RLS policy instead of
    // calling a zero-argument RPC. This avoids a stale PostgREST function-cache
    // entry turning an ordinary membership check into a misleading account error.
    const { data: { user }, error: userError } = await client.auth.getUser();
    if (userError || !user) return { snapshot: null, error: 'Your SWISH sign-in session could not be verified. Sign in again and retry.' };
    const [ownerRow, billing] = await Promise.all([
      client.from('swish_platform_owners').select('user_id').eq('user_id', user.id).maybeSingle(),
      checkSubscription(tenantId),
    ]);
    if (ownerRow.error) return { snapshot: null, error: 'SWISH owner-verification records are unavailable. The backend migration may need applying or its schema cache refreshing. Your access has not been changed.' };
    const owner = Boolean(ownerRow.data);
    if (!owner && (billing.error || !billing.status)) return { snapshot: null, error: billing.error ?? 'Membership verification unavailable.' };
    const nicheIds = owner ? [...PRODUCTION_NICHE_IDS] : [...new Set((billing.status?.nicheEntitlements ?? []).filter(isProductionNiche))];
    return { snapshot: { owner, nicheIds, tenantId, billingStatus: billing.status, verifiedAt: Date.now() }, error: null };
  } catch { return { snapshot: null, error: 'Membership verification could not be reached. Retry.' }; }
}
export async function activateModuleScope(tenantId: string, nicheId: ProductionNicheId | null): Promise<{ error: string | null }> {
  if (!tenantId || (nicheId !== null && !isProductionNiche(nicheId))) return { error: 'Registered account and niche required.' };
  try {
    const { data, error } = await getSupabaseClient().rpc('swish_open_module', { p_tenant_id: tenantId, p_niche_id: nicheId });
    return { error: error ? error.message || 'This module could not be authorized. Refresh your memberships and retry.' : data === true ? null : 'Module selection was not confirmed.' };
  } catch { return { error: 'Module selection could not reach the backend. Retry.' }; }
}
