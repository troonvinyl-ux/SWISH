import { getSupabaseClient } from '@/template';
import { backendRead, shareBackendRequest } from './backendRequestService';
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
  return shareBackendRequest(`module-access:${tenantId}`, async () => {
  const client = getSupabaseClient();
  try {
    // One existing Edge Function verifies membership, owner role and billing. Avoid asking twice.
    const billing = await checkSubscription(tenantId);
    if (billing.error || !billing.status) return { snapshot: null, error: billing.error ?? 'Membership verification unavailable.' };
    // Backward-compatible with an older deployed function that does not return the trusted role.
    const ownerResult = typeof billing.status.platformOwner === 'boolean'
      ? { data: billing.status.platformOwner, error: null }
      : await backendRead('platform-owner', signal => client.rpc('swish_is_platform_owner').abortSignal(signal), 'access');
    if (ownerResult.error) {
      const detail = ownerResult.error.message || 'Owner verification RPC unavailable.';
      return { snapshot: null, error: /schema cache|could not find the function|pgrst202|does not exist/i.test(detail)
        ? 'The SWISH owner-verification database function is missing or the API schema cache is stale. Apply the SWISH backend migrations and reload the database schema. Your access has not been changed.'
        : detail };
    }
    const owner = ownerResult.data === true;
    if (!owner && (billing.error || !billing.status)) return { snapshot: null, error: billing.error ?? 'Membership verification unavailable.' };
    const nicheIds = owner ? [...PRODUCTION_NICHE_IDS] : [...new Set((billing.status?.nicheEntitlements ?? []).filter(isProductionNiche))];
    return { snapshot: { owner, nicheIds, tenantId, billingStatus: billing.status, verifiedAt: Date.now() }, error: null };
  } catch (cause) { return { snapshot: null, error: cause instanceof Error ? cause.message : 'Membership verification could not be reached. Retry.' }; }
  });
}
export async function activateModuleScope(tenantId: string, nicheId: ProductionNicheId | null): Promise<{ error: string | null }> {
  if (!tenantId || (nicheId !== null && !isProductionNiche(nicheId))) return { error: 'Registered account and niche required.' };
  try {
    // swish_open_module remains the only activation command. No automatic retry or cached grant.
    const { data, error } = await backendRead(`open-module:${tenantId}:${nicheId}`, signal => getSupabaseClient().rpc('swish_open_module', { p_tenant_id: tenantId, p_niche_id: nicheId }).abortSignal(signal), 'access');
    return { error: error ? error.message || 'This module could not be authorized. Refresh your memberships and retry.' : data === true ? null : 'Module selection was not confirmed.' };
  } catch (cause) { return { error: cause instanceof Error ? cause.message : 'Module selection could not reach the backend. Retry.' }; }
}
