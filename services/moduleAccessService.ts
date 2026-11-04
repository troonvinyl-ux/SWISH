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
    const [role, billing] = await Promise.all([client.rpc('swish_is_platform_owner'), checkSubscription(tenantId)]);
    if (role.error) return { snapshot: null, error: role.error.message || 'Owner and membership authorization could not be verified. Retry.' };
    const owner = role.data === true;
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
